/**
 * „Prosveta i nastava" — the arithmetic behind the teaching toolkit's tools.
 *
 * **One file per PACK, not per category**, the rule `pro/gradnja.ts` sets: a
 * tool several packs share lives in the file of its FIRST pack in `TOOL_PACKS`
 * order, so nobody has to relitigate ownership per tool.
 *
 * **Everything a school regulates is an input here.** A pass mark, a grade
 * threshold, the marking scale itself, the length of a lesson, the calendar of
 * non-teaching days: each of those is a number a ministry or an institution
 * chose, each differs between schools, and each changes between years. Not one
 * of them is embedded and not one is defaulted — where the catalogue lists such
 * a number as a „constant" it arrives as a parameter instead. These tools count
 * and divide; what grade the count earns is the teacher's to say, and the
 * functions below never say it.
 *
 * **Marks and money run over integers.** A grade boundary is decided by a
 * comparison, and `0.1 + 0.2 !== 0.3` decides it wrongly: a paper sitting
 * exactly on its threshold has to land on it, and 38 out of 47 must not become
 * the next grade up because its percent rounds to 80.85 and the threshold reads
 * 81. Every points/percent/price comparison in this file is therefore made over
 * hundredths held as integers, and every rounding is left to the surface that
 * prints the number. Combinatorics and fractions go further and use `bigint`,
 * because 21! already passes 2^53 and a double would quietly lose the last
 * digits of an answer whose whole point is that it is exact.
 *
 * **These are pure functions and they refuse rather than repair.** No dates
 * from the clock — the day a calculation is „as of" is a parameter — no
 * randomness, no locale, no text. A refusal names the input that made the
 * answer impossible, as a key the surface's own Serbian table turns into a
 * line.
 */

import {
  fail,
  isInRange,
  isIntegerIn,
  isNonNegative,
  isPositive,
  type ProResult,
} from "./result.js";

/** Rows a list-shaped input may hold before the tool refuses to work at all. */
const MAX_ROWS = 200;

/** Values one statistics run may hold — a year group, not a census. */
const MAX_VALUES = 2000;

/**
 * Exact hundredths of a unit, or `undefined` when the number was not written to
 * two decimals.
 *
 * Refusing a third decimal rather than rounding it away is the same rule as
 * everywhere else here: the tool never edits what the user typed. The tolerance
 * rides the magnitude because a double's spacing does — `100 * 47.12` is
 * `4711.9999999999995`, and at 1e11 the representable neighbours are further
 * apart than a fixed 1e-6 would allow.
 */
function hundredths(value: number): number | undefined {
  if (!Number.isFinite(value) || Math.abs(value) > 1e9) return undefined;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  const tolerance = Math.max(1e-6, Math.abs(scaled) * 8 * Number.EPSILON);
  return Math.abs(scaled - rounded) > tolerance ? undefined : rounded;
}

/** Ceiling of a/b over non-negative integers, without a float in the middle. */
function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b);
}

/* ------------------------------------------------------------------ dates -- */

export interface CalendarDate {
  readonly year: number;
  /** 1..12. */
  readonly month: number;
  /** 1..31, and it has to exist in that month of that year. */
  readonly day: number;
}

/** Gregorian leap rule: every fourth year, minus centuries, plus every 400th. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return MONTH_LENGTHS[month - 1] ?? 0;
}

/** Years this file will do calendar arithmetic over, so a typo cannot run away. */
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

/** Whether a `CalendarDate` exists — the day is checked against ITS OWN month's length. */
export function isValidDate(date: CalendarDate): boolean {
  if (!isIntegerIn(date.year, MIN_YEAR, MAX_YEAR)) return false;
  if (!isIntegerIn(date.month, 1, 12)) return false;
  return isIntegerIn(date.day, 1, daysInMonth(date.year, date.month));
}

/**
 * Days since 1970-01-01, by Howard Hinnant's `days_from_civil`.
 *
 * The shift of the year start to March (`m <= 2 ? y - 1`) is what makes the
 * leap day the LAST day of the internal year, so the 153/5 month-length formula
 * needs no special case for February and the whole thing is branch-free
 * integer arithmetic. Counting elapsed days any other way — month by month, or
 * through a `Date` — is where off-by-one errors and time zones get in.
 *
 * Exported with `isoWeekday` so a caller holding a `CalendarDate` — a surface
 * building its own view of `lessonCountPeriod`'s excluded dates, say — can find
 * that date's weekday and test its place in a period without reimplementing
 * either piece of calendar arithmetic.
 */
export function dayNumber(date: CalendarDate): number {
  const { month, day } = date;
  const y = date.year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/**
 * ISO-8601 weekday, 1 = Monday … 7 = Sunday (ISO 8601-1:2019).
 *
 * The `+ 3` is 1970-01-01 having been a Thursday; the double modulo keeps the
 * answer positive for days before the epoch, which a bare `%` would not.
 */
export function isoWeekday(day: number): number {
  return ((((day + 3) % 7) + 7) % 7) + 1;
}

/* ------------------------------------------------------- average to target -- */

/** Existing marks, either one by one or already counted and summed. */
export type GradeTally =
  | { readonly kind: "grades"; readonly grades: readonly number[] }
  | { readonly kind: "tally"; readonly count: number; readonly sum: number };

/**
 * Which of the five exhaustive cases the target fell into. `E = v - T` decides
 * it: a mark above the target always helps, a mark equal to it never moves the
 * average across it, and a mark below it can only be endured.
 */
export type AverageOutcome =
  /** `extraGrades` more marks of that value reach the target — the smallest such count. */
  | "needed"
  /** Already at or above, and marks of exactly the target's value never move it off. */
  | "anyCount"
  /** The mark equals the target and the average is under it: no number of them helps. */
  | "unreachable"
  /** The mark is under the target and so is the average already. */
  | "alreadyBelow"
  /** The mark is under the target: `extraGrades` is the LAST count that still holds it. */
  | "tolerated";

export interface AverageToTargetInput {
  readonly tally: GradeTally;
  /** The average being aimed at, on the same scale as the marks. */
  readonly target: number;
  /**
   * What one more mark would be worth. Regulated: 1–5, 5–10 and percent scales
   * are all in use, so this package has no idea which scale it is looking at
   * and never assumes one.
   */
  readonly extraGrade: number;
}

export interface AverageToTargetResult {
  readonly count: number;
  readonly currentAverage: number;
  readonly outcome: AverageOutcome;
  /** Undefined for the two outcomes where no count is an answer. */
  readonly extraGrades: number | undefined;
  readonly resultingAverage: number | undefined;
}

/**
 * How many more marks of one value the target average needs — or, when that
 * value is below the target, how many of them the average can still take.
 *
 * **The comparison is never made against a rounded average.** `(S + jv)/(n + j)
 * >= T` is rearranged to `j(v - T) >= Tn - S`, which removes the division
 * entirely, and both sides are then held in hundredths as integers. An average
 * printed as „4,00" that is really 3.9962 has not reached a target of 4, and a
 * tool that compares the printed number says it has.
 */
export function averageToTarget(input: AverageToTargetInput): ProResult<AverageToTargetResult> {
  const { tally } = input;
  let count: number;
  let sumC: number;
  if (tally.kind === "grades") {
    if (tally.grades.length < 1) return fail("grades");
    if (tally.grades.length > MAX_VALUES) return fail("tooManyValues");
    let accumulated = 0;
    for (const grade of tally.grades) {
      const scaled = hundredths(grade);
      if (scaled === undefined) return fail("grades");
      accumulated += scaled;
    }
    count = tally.grades.length;
    sumC = accumulated;
  } else {
    if (!isIntegerIn(tally.count, 1, MAX_VALUES)) return fail("count");
    const scaled = hundredths(tally.sum);
    if (scaled === undefined) return fail("sum");
    count = tally.count;
    sumC = scaled;
  }
  const targetC = hundredths(input.target);
  if (targetC === undefined) return fail("target");
  const valueC = hundredths(input.extraGrade);
  if (valueC === undefined) return fail("extraGrade");

  const currentAverage = sumC / (100 * count);
  /** D = Tn - S: how far the SUM lags the target, in hundredths. */
  const shortfall = targetC * count - sumC;
  /** E = v - T: what one more mark of that value is worth against the target. */
  const lift = valueC - targetC;
  const averageAfter = (extra: number): number => (sumC + extra * valueC) / (100 * (count + extra));
  const base = { ok: true, count, currentAverage } as const;

  if (lift > 0) {
    const extra = shortfall <= 0 ? 0 : ceilDiv(shortfall, lift);
    return {
      ...base,
      outcome: "needed",
      extraGrades: extra,
      resultingAverage: averageAfter(extra),
    };
  }
  if (lift === 0) {
    if (shortfall > 0) {
      return {
        ...base,
        outcome: "unreachable",
        extraGrades: undefined,
        resultingAverage: undefined,
      };
    }
    return { ...base, outcome: "anyCount", extraGrades: 0, resultingAverage: currentAverage };
  }
  if (shortfall > 0) {
    return {
      ...base,
      outcome: "alreadyBelow",
      extraGrades: undefined,
      resultingAverage: undefined,
    };
  }
  // Both sides negative: -D >= 0 is the slack in the sum, -E > 0 is what each
  // weaker mark spends of it, so the floor is the last count that still holds.
  const extra = Math.floor(-shortfall / -lift);
  return {
    ...base,
    outcome: "tolerated",
    extraGrades: extra,
    resultingAverage: averageAfter(extra),
  };
}

/* ------------------------------------------------------------- child age -- */

export interface ChildAgeInput {
  readonly birth: CalendarDate;
  /** The day the age is measured on. A parameter, never the clock. */
  readonly on: CalendarDate;
  /** Optional: which birthday to date. Integer years, 0 or more. */
  readonly milestoneYears?: number | undefined;
}

export interface ChildAgeResult {
  readonly years: number;
  readonly months: number;
  readonly days: number;
  readonly totalMonths: number;
  readonly totalDays: number;
  /** 1..12 — the month whose length paid for the day borrow, undefined when none. */
  readonly borrowedFromMonth: number | undefined;
  readonly borrowedFromMonthDays: number | undefined;
  /** True when the birth day-of-month does not exist in the borrowed month. */
  readonly borrowClamped: boolean;
  readonly milestone: CalendarDate | undefined;
  /** True when the milestone fell on 29 February in a common year and moved. */
  readonly milestoneShifted: boolean;
  /** Days from `on` to the next anniversary of `birth`, 0 when `on` IS that day. */
  readonly daysUntilNextBirthday: number;
}

/**
 * The calendar date a person born on `birth` turns `years` older, in `year`.
 *
 * Shared by the milestone date and by `daysUntilNextBirthday` below so the two
 * can never apply the 29-February rule differently from one another: a birth
 * on the leap day lands on 1 March in every common year, in both places.
 */
function anniversaryDate(birth: CalendarDate, year: number): CalendarDate {
  if (birth.month === 2 && birth.day === 29 && !isLeapYear(year)) {
    return { year, month: 3, day: 1 };
  }
  return { year, month: birth.month, day: birth.day };
}

/**
 * Age in years, months and days on a given day, plus the date of a chosen
 * birthday.
 *
 * **Which month pays for the borrow is a convention, not a fact**, and it is
 * reported rather than hidden: when the day-of-month has not come round yet the
 * borrow takes the length of the month PRECEDING the reference month, so 29
 * February to 13 August borrows July's 31 days and lands on 15 — while
 * borrowing the birth month's 28 would land on 12. Both are defensible and
 * different tools print different numbers, so the tool says which one it ran.
 *
 * The one place that convention breaks on its own is a birth on the 30th or
 * 31st measured on 1 or 2 March: February is too short to pay, and the naive
 * rule returns a NEGATIVE day count. The anchor day is therefore clamped to the
 * borrowed month's last day, which is the same arithmetic everywhere else and
 * the only outcome that is not nonsense here.
 */
export function childAge(input: ChildAgeInput): ProResult<ChildAgeResult> {
  const { birth, on } = input;
  if (!isValidDate(birth)) return fail("birth");
  if (!isValidDate(on)) return fail("on");
  const birthDay = dayNumber(birth);
  const onDay = dayNumber(on);
  // An age is never negative: a reference day before the birth is a typo, and
  // the honest answer is a refusal rather than a minus sign.
  if (onDay < birthDay) return fail("on");
  const { milestoneYears } = input;
  if (milestoneYears !== undefined && !isIntegerIn(milestoneYears, 0, MAX_YEAR - birth.year)) {
    return fail("milestoneYears");
  }

  let years = on.year - birth.year;
  let months = on.month - birth.month;
  let days = on.day - birth.day;
  let borrowedFromMonth: number | undefined;
  let borrowedFromMonthDays: number | undefined;
  let borrowClamped = false;
  if (days < 0) {
    months -= 1;
    const borrowYear = on.month === 1 ? on.year - 1 : on.year;
    const borrowMonth = on.month === 1 ? 12 : on.month - 1;
    const length = daysInMonth(borrowYear, borrowMonth);
    const anchorDay = Math.min(birth.day, length);
    borrowClamped = anchorDay !== birth.day;
    borrowedFromMonth = borrowMonth;
    borrowedFromMonthDays = length;
    days = on.day + (length - anchorDay);
  }
  if (months < 0) {
    months += 12;
    years -= 1;
  }

  let milestone: CalendarDate | undefined;
  let milestoneShifted = false;
  if (milestoneYears !== undefined) {
    const year = birth.year + milestoneYears;
    milestone = anniversaryDate(birth, year);
    // 29 February exists in one year out of four; the same borrow rule that
    // governs the age governs the birthday, and it lands on 1 March. Checked
    // on the BIRTH date, not on the shape of the result — a real 1 March
    // birthday returns the same {month: 3, day: 1} without having shifted.
    milestoneShifted = birth.month === 2 && birth.day === 29 && !isLeapYear(year);
  }

  // The next anniversary is this year's unless it has already passed — and
  // "passed" includes today itself, which is 0 days away rather than 365.
  let nextBirthday = anniversaryDate(birth, on.year);
  if (dayNumber(nextBirthday) < onDay) {
    nextBirthday = anniversaryDate(birth, on.year + 1);
  }

  return {
    ok: true,
    years,
    months,
    days,
    totalMonths: 12 * years + months,
    totalDays: onDay - birthDay,
    borrowedFromMonth,
    borrowedFromMonthDays,
    borrowClamped,
    milestone,
    milestoneShifted,
    daysUntilNextBirthday: dayNumber(nextBirthday) - onDay,
  };
}

/* ---------------------------------------------------------- combinatorics -- */

/**
 * The practical wall on n and k. Past it the exact answer is longer than any
 * screen shows and the bigint work stops being interactive — 100000! alone is
 * some 456 thousand digits.
 */
const COMBINATORICS_MAX = 100000;

/**
 * lo·(lo+1)·…·hi as a balanced product tree, and 1 when the range is empty.
 *
 * A left fold multiplies a half-million-digit accumulator by a five-digit
 * factor a hundred thousand times, which is quadratic in the digit count.
 * Splitting the range keeps both operands about the same size and lets the
 * engine use its sub-quadratic multiply. Identical answer; the difference is
 * between „instant" and „the window stopped repainting".
 */
function productRange(lo: number, hi: number): bigint {
  if (lo > hi) return 1n;
  if (lo === hi) return BigInt(lo);
  const mid = Math.floor((lo + hi) / 2);
  return productRange(lo, mid) * productRange(mid + 1, hi);
}

/**
 * C(n, k) as an exact integer, 0 when k is outside 0..n.
 *
 * The falling factorial of the SMALLER of k and n-k divided by that many
 * factorials is exact — the product of any k consecutive integers is divisible
 * by k! — so there is no remainder to lose and no rounding anywhere.
 */
function binomial(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  const smaller = Math.min(k, n - k);
  return productRange(n - smaller + 1, n) / productRange(1, smaller);
}

/** Exponentiation by squaring; 0^0 is 1 by the empty-product convention. */
function bigPow(base: bigint, exponent: number): bigint {
  let result = 1n;
  let square = base;
  let remaining = exponent;
  while (remaining > 0) {
    if ((remaining & 1) === 1) result *= square;
    square *= square;
    remaining >>= 1;
  }
  return result;
}

export interface CombinatoricsInput {
  readonly n: number;
  /**
   * Still validated when `repeats` is given, but not otherwise USED in that
   * mode: permutations with repetition are computed from `n` and the repeat
   * counts alone.
   */
  readonly k: number;
  /**
   * Optional repetition counts for permutations with repetition — the letter
   * multiplicities of a word, for instance. Each 1 or more, summing to n at
   * most; whatever is left over counts as that many distinct elements.
   */
  readonly repeats?: readonly number[] | undefined;
}

export interface CombinatoricsResult {
  /** n! */
  readonly factorial: bigint;
  /** V(n,k) = n!/(n-k)!, and 0 when k > n. */
  readonly variations: bigint;
  /** C(n,k) = n!/(k!(n-k)!), and 0 when k > n. */
  readonly combinations: bigint;
  /** n^k — variations WITH repetition. */
  readonly variationsWithRepetition: bigint;
  /** C(n+k-1, k) — combinations with repetition. */
  readonly combinationsWithRepetition: bigint;
  /** n!/(n1!·n2!·…), undefined when no repetition counts were given. */
  readonly permutationsWithRepetition: bigint | undefined;
  /**
   * Decimal digit count of `factorial` — the number the wall on `n` exists to
   * bound, and the one whose length a screen cannot just show and let the
   * reader judge.
   */
  readonly factorialDigits: number;
}

/**
 * The five standard counts for n and k, plus the multinomial when repetition
 * counts are given.
 *
 * **Everything is `bigint` and nothing is rounded.** 21! is already larger than
 * 2^53, so a double answer would be wrong in its last digits while looking
 * entirely plausible — and the whole value of a combinatorics tool is that the
 * count is exact. `0! = 1` and `n^0 = 1` are the empty product, not special
 * cases.
 */
export function combinatorics(input: CombinatoricsInput): ProResult<CombinatoricsResult> {
  const { n, k, repeats } = input;
  if (!isIntegerIn(n, 0, COMBINATORICS_MAX)) return fail("n");
  if (!isIntegerIn(k, 0, COMBINATORICS_MAX)) return fail("k");

  let permutationsWithRepetition: bigint | undefined;
  if (repeats !== undefined) {
    if (repeats.length < 1 || repeats.length > MAX_ROWS) return fail("repeats");
    let total = 0;
    let divisor = 1n;
    for (const repeat of repeats) {
      if (!isIntegerIn(repeat, 1, COMBINATORICS_MAX)) return fail("repeats");
      total += repeat;
      if (total > n) return fail("repeats");
      divisor *= productRange(1, repeat);
    }
    permutationsWithRepetition = productRange(1, n) / divisor;
  }

  const factorial = productRange(1, n);
  return {
    ok: true,
    factorial,
    variations: k > n ? 0n : productRange(n - k + 1, n),
    combinations: binomial(n, k),
    variationsWithRepetition: bigPow(BigInt(n), k),
    // An empty set has exactly one multiset of size 0 and none of any other
    // size; C(k-1, k) would say 0 for both, so n = 0 is taken out by hand.
    combinationsWithRepetition: n === 0 ? (k === 0 ? 1n : 0n) : binomial(n + k - 1, k),
    permutationsWithRepetition,
    factorialDigits: factorial.toString().length,
  };
}

/* --------------------------------------------------- fractions & decimals -- */

/** Digits this tool will print of one decimal expansion, and accept as input. */
const MAX_DIGITS = 2000;

const DIGITS_ONLY = /^[0-9]*$/;

export type FractionOperation = "+" | "-" | "*" | "/";

export interface DecimalExpansion {
  readonly negative: boolean;
  /** Digits before the decimal mark, "0" when there is no whole part. */
  readonly integerDigits: string;
  readonly nonRepeatingDigits: string;
  /** Empty when the decimal terminates. */
  readonly repeatingDigits: string;
  readonly nonRepeatingLength: number;
  readonly repeatingLength: number;
}

export interface FractionResult {
  /** Reduced, and carrying the sign — the denominator is always positive. */
  readonly numerator: bigint;
  readonly denominator: bigint;
  /** Mixed number: a signed whole part, then a non-negative part over the denominator. */
  readonly mixedWhole: bigint;
  readonly mixedNumerator: bigint;
  /** Undefined when the expansion runs longer than this tool prints. */
  readonly decimal: DecimalExpansion | undefined;
  /**
   * 100·numerator/denominator, to six decimals of a percent. Undefined when the
   * exact value cannot be represented as a `Number` at all — see `percentOf`.
   */
  readonly percent: number | undefined;
  /**
   * True when `percent` is a TRUNCATION rather than the exact value — six
   * decimals of a percent is eight decimals of the underlying fraction, and
   * ANY fraction whose exact percent needs more digits than that (whether its
   * decimal expansion repeats, or simply terminates further out — 1/512's
   * ninth digit, say) prints a `percent` that is close but not exact. Also
   * true when `percent` is `undefined`: an unknown value is never reported as
   * exact by omission.
   */
  readonly percentIsApproximate: boolean;
}

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x;
}

/**
 * The decimal expansion by long division, with every remainder recorded.
 *
 * The split between the non-repeating and repeating parts falls at the FIRST
 * remainder that comes round a second time — which is provably `max(v2, v5)` of
 * the reduced denominator, so the factorisation is not needed to find it. A
 * remainder of zero means the decimal terminates. The digit wall is what keeps
 * 1/999983 from asking for a million digits nobody can read.
 */
function decimalExpansion(
  negative: boolean,
  magnitude: bigint,
  denominator: bigint,
): DecimalExpansion | undefined {
  const integerDigits = (magnitude / denominator).toString();
  let remainder = magnitude % denominator;
  const seenAt = new Map<bigint, number>();
  const digits: string[] = [];
  while (remainder !== 0n) {
    const previous = seenAt.get(remainder);
    if (previous !== undefined) {
      const nonRepeating = digits.slice(0, previous).join("");
      const repeating = digits.slice(previous).join("");
      return {
        negative,
        integerDigits,
        nonRepeatingDigits: nonRepeating,
        repeatingDigits: repeating,
        nonRepeatingLength: nonRepeating.length,
        repeatingLength: repeating.length,
      };
    }
    if (digits.length >= MAX_DIGITS) return undefined;
    seenAt.set(remainder, digits.length);
    const scaled = remainder * 10n;
    digits.push((scaled / denominator).toString());
    remainder = scaled % denominator;
  }
  const terminating = digits.join("");
  return {
    negative,
    integerDigits,
    nonRepeatingDigits: terminating,
    repeatingDigits: "",
    nonRepeatingLength: terminating.length,
    repeatingLength: 0,
  };
}

/** Six decimals of a percent, taken from the exact ratio rather than a double. */
const PERCENT_SCALE = 1000000n;

/**
 * Six decimals of `100·numerator/denominator`, or `undefined` when that value
 * does not fit in a `Number` at all.
 *
 * The numerator here can carry up to `MAX_DIGITS` (2000) digits — a decimal
 * typed in with that many integer digits is a legitimate input to
 * `decimalToFraction` — and `Number()` on a bigint past roughly 1.8e308
 * overflows silently to `Infinity` rather than throwing. Printed as "percent =
 * Infinity", that is exactly the escape this file's own header warns against:
 * an `ok: true` result standing in for a refusal. `Number.isFinite` catches it
 * before it leaves this function.
 */
function percentOf(numerator: bigint, denominator: bigint): number | undefined {
  const value = Number((numerator * 100n * PERCENT_SCALE) / denominator) / Number(PERCENT_SCALE);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Whether `100·numerator/denominator` divides the scale EXACTLY — whether
 * `percentOf` returned the true value rather than a truncation of it.
 *
 * A TERMINATING decimal is not automatically exact here. 1/512 terminates at
 * nine digits (0.001953125), one digit past what six decimals of a percent
 * (eight decimals of the underlying fraction) can carry, so its percent is
 * truncated exactly as a repeating expansion's would be — `100·1·10^6 = 10^8`,
 * and `10^8 mod 512 = 256 ≠ 0`. Testing the remainder of the very product
 * `percentOf` divides is therefore the only test that is equivalent to
 * "truncated"; `decimal.repeatingLength > 0` catches only the repeating half
 * of that set.
 */
function percentIsExact(numerator: bigint, denominator: bigint): boolean {
  return (numerator * 100n * PERCENT_SCALE) % denominator === 0n;
}

/** Reduce, put the sign in the numerator, and derive every view of the value. */
function fractionView(rawNumerator: bigint, rawDenominator: bigint): FractionResult {
  let numerator = rawNumerator;
  let denominator = rawDenominator;
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  if (numerator === 0n) {
    denominator = 1n;
  } else {
    const divisor = gcdBig(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
  }
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const decimal = decimalExpansion(negative, magnitude, denominator);
  const percent = percentOf(numerator, denominator);
  return {
    numerator,
    denominator,
    // BigInt division truncates toward zero, which is what a mixed number wants:
    // -19/12 is -1 and 7/12, not -2 and 5/12.
    mixedWhole: numerator / denominator,
    mixedNumerator: magnitude % denominator,
    decimal,
    percent,
    percentIsApproximate: percent === undefined || !percentIsExact(numerator, denominator),
  };
}

export interface FractionArithmeticInput {
  readonly a: number;
  readonly b: number;
  readonly operation: FractionOperation;
  readonly c: number;
  readonly d: number;
}

/**
 * One operation on two fractions, reduced, as a mixed number and as a decimal
 * with its period marked.
 *
 * **All of it is integer arithmetic.** `1/3` has no double, so a tool that goes
 * through floating point cannot answer „is 3/4 + 5/6 exactly 19/12" — it can
 * only answer „about". Reduction happens once, at the end, on the product of
 * the two denominators, which is why no common-denominator search is needed.
 */
export function fractionArithmetic(input: FractionArithmeticInput): ProResult<FractionResult> {
  const { a, b, c, d, operation } = input;
  if (operation !== "+" && operation !== "-" && operation !== "*" && operation !== "/") {
    return fail("operation");
  }
  if (!Number.isSafeInteger(a)) return fail("a");
  if (!Number.isSafeInteger(b) || b === 0) return fail("b");
  if (!Number.isSafeInteger(c)) return fail("c");
  if (!Number.isSafeInteger(d) || d === 0) return fail("d");
  const an = BigInt(a);
  const bn = BigInt(b);
  const cn = BigInt(c);
  const dn = BigInt(d);
  if (operation === "/") {
    // Dividing by c/d multiplies by d/c, so a zero numerator on the right is a
    // zero denominator on the way out.
    if (cn === 0n) return fail("c");
    return { ok: true, ...fractionView(an * dn, bn * cn) };
  }
  const numerator =
    operation === "+" ? an * dn + cn * bn : operation === "-" ? an * dn - cn * bn : an * cn;
  return { ok: true, ...fractionView(numerator, bn * dn) };
}

export interface DecimalToFractionInput {
  readonly negative: boolean;
  /** Digits before the decimal mark; "" reads as 0. */
  readonly integerDigits: string;
  /** Digits after the mark and before the period; leading zeros are significant. */
  readonly nonRepeatingDigits: string;
  /** The repeating block, without its brackets; "" for a terminating decimal. */
  readonly repeatingDigits: string;
}

/**
 * A written decimal, periodic or not, back into an exact fraction.
 *
 * `(I·10^(n+r) + N·10^r + R - (I·10^n + N)) / (10^(n+r) - 10^n)` is the two
 * shifted copies subtracted from one another, which is why the period cancels.
 * **Leading zeros in the non-repeating part are carried by its LENGTH**, not by
 * its value: 0,0(3) and 0,(3) both read N as zero and differ only in n, and a
 * parser that drops the length answers 1/3 for both.
 */
export function decimalToFraction(input: DecimalToFractionInput): ProResult<FractionResult> {
  const { integerDigits, nonRepeatingDigits, repeatingDigits } = input;
  if (!DIGITS_ONLY.test(integerDigits) || integerDigits.length > MAX_DIGITS) {
    return fail("integerDigits");
  }
  if (!DIGITS_ONLY.test(nonRepeatingDigits)) return fail("nonRepeatingDigits");
  if (!DIGITS_ONLY.test(repeatingDigits)) return fail("repeatingDigits");
  if (integerDigits === "" && nonRepeatingDigits === "" && repeatingDigits === "") {
    return fail("digits");
  }
  const n = nonRepeatingDigits.length;
  const r = repeatingDigits.length;
  if (n + r > MAX_DIGITS) return fail("digits");

  const whole = integerDigits === "" ? 0n : BigInt(integerDigits);
  const nonRepeating = nonRepeatingDigits === "" ? 0n : BigInt(nonRepeatingDigits);
  const repeating = repeatingDigits === "" ? 0n : BigInt(repeatingDigits);
  const shiftN = 10n ** BigInt(n);
  const shiftR = 10n ** BigInt(r);
  const lower = whole * shiftN + nonRepeating;
  if (r === 0) {
    return { ok: true, ...fractionView(input.negative ? -lower : lower, shiftN) };
  }
  const upper = lower * shiftR + repeating;
  const numerator = upper - lower;
  return {
    ok: true,
    ...fractionView(input.negative ? -numerator : numerator, shiftN * shiftR - shiftN),
  };
}

/* ------------------------------------------------------ grade scale points -- */

export interface GradeScaleInput {
  /** Maximum points on the paper. Two decimals at most. */
  readonly maxPoints: number;
  /**
   * Marking step, in points — typically 1 or 0.5. The catalogue's default of 1
   * is a FORM default and stays in the surface: this package is given the value
   * or it refuses, because a substituted step silently moves every boundary.
   */
  readonly step: number;
  /**
   * Grade thresholds as percents of the maximum, in any order. Regulated: a
   * school's or a ministry's rulebook sets them and they change, so there is no
   * built-in scale here. The LABELS stay in the surface — this package holds no
   * text — and a row is identified by its index into this array.
   */
  readonly thresholds: readonly number[];
  /** Optional: points actually scored, to be placed in the scale. */
  readonly scoredPoints?: number | undefined;
}

export interface GradeScaleRow {
  /** Index into the input `thresholds`, so the surface can find its label. */
  readonly index: number;
  readonly percent: number;
  readonly minPoints: number;
  /** What that minimum actually carries, as a percent of the maximum. */
  readonly minPercent: number;
  /**
   * False when the minimum overshoots the maximum, which a step that does not
   * divide the maximum can produce. Such a row takes no range.
   */
  readonly reachable: boolean;
  /**
   * The band this row covers. Two thresholds that land on the same step leave
   * the lower one an EMPTY band, and it comes back with `rangeFrom` above
   * `rangeTo` — the arithmetic saying so rather than a tool hiding it.
   */
  readonly rangeFrom: number | undefined;
  readonly rangeTo: number | undefined;
}

export interface GradeScaleResult {
  /** Descending by threshold percent. */
  readonly rows: readonly GradeScaleRow[];
  /** The band under the lowest row, which carries no grade; undefined when none. */
  readonly unlabelledFrom: number | undefined;
  readonly unlabelledTo: number | undefined;
  readonly scoredPercent: number | undefined;
  /** Index of the row the scored points reach, undefined when below every row. */
  readonly scoredIndex: number | undefined;
}

/**
 * Percent thresholds turned into whole marking steps on a paper of a given
 * maximum, with the band each grade covers.
 *
 * **The rounding is upward and the comparison is over integers.** A threshold
 * of 81% of 47 points is 38.07 points, and 38 does not reach it — the minimum
 * is 39. Printed as percents that reads „38 is 80.85%, and 80.85 is nearly 81",
 * which is exactly the mistake: `100·o >= p·B` is checked as `10000·oc >=
 * pc·Bc` in hundredths, never against a percent that has been rounded for
 * display.
 */
export function gradeScalePoints(input: GradeScaleInput): ProResult<GradeScaleResult> {
  const maxC = hundredths(input.maxPoints);
  if (maxC === undefined || maxC <= 0 || maxC > 1e8) return fail("maxPoints");
  const stepC = hundredths(input.step);
  if (stepC === undefined || stepC <= 0 || stepC > maxC) return fail("step");
  if (input.thresholds.length < 1) return fail("thresholds");
  if (input.thresholds.length > MAX_ROWS) return fail("tooManyRows");

  const scaled: { readonly index: number; readonly percent: number; readonly percentC: number }[] =
    [];
  const seen = new Set<number>();
  for (let i = 0; i < input.thresholds.length; i += 1) {
    const percent = input.thresholds[i];
    if (percent === undefined) return fail("thresholds");
    const percentC = hundredths(percent);
    if (percentC === undefined || percentC < 0 || percentC > 10000) return fail("thresholds");
    // Two rows on the same threshold leave no band between them, so there is no
    // scale to draw — a refusal, not a silent merge.
    if (seen.has(percentC)) return fail("duplicateThreshold");
    seen.add(percentC);
    scaled.push({ index: i, percent, percentC });
  }
  scaled.sort((left, right) => right.percentC - left.percentC);

  // m·kc/100 points is the smallest whole number of steps carrying at least
  // p percent of B: 10000·m·kc >= pc·Bc.
  const perStep = 10000 * stepC;
  const minima = scaled.map((row) => ceilDiv(row.percentC * maxC, perStep) * stepC);

  const rows: GradeScaleRow[] = [];
  let lowestReachableC: number | undefined;
  for (let i = 0; i < scaled.length; i += 1) {
    const row = scaled[i];
    const minC = minima[i];
    if (row === undefined || minC === undefined) return fail("thresholds");
    const reachable = minC <= maxC;
    if (reachable && (lowestReachableC === undefined || minC < lowestReachableC)) {
      lowestReachableC = minC;
    }
    // Only a reachable row above bounds this one's band; an unreachable row
    // occupies nothing and must not cut a band short.
    let aboveC: number | undefined;
    for (let j = i - 1; j >= 0; j -= 1) {
      const candidate = minima[j];
      if (candidate !== undefined && candidate <= maxC) {
        aboveC = candidate;
        break;
      }
    }
    rows.push({
      index: row.index,
      percent: row.percent,
      minPoints: minC / 100,
      minPercent: (100 * minC) / maxC,
      reachable,
      rangeFrom: reachable ? minC / 100 : undefined,
      rangeTo: reachable ? (aboveC === undefined ? maxC : aboveC - stepC) / 100 : undefined,
    });
  }

  let unlabelledFrom: number | undefined;
  let unlabelledTo: number | undefined;
  if (lowestReachableC === undefined) {
    unlabelledFrom = 0;
    unlabelledTo = maxC / 100;
  } else if (lowestReachableC > 0) {
    unlabelledFrom = 0;
    unlabelledTo = (lowestReachableC - stepC) / 100;
  }

  let scoredPercent: number | undefined;
  let scoredIndex: number | undefined;
  const { scoredPoints } = input;
  if (scoredPoints !== undefined) {
    const scoredC = hundredths(scoredPoints);
    if (scoredC === undefined || scoredC < 0 || scoredC > maxC) return fail("scoredPoints");
    scoredPercent = (100 * scoredC) / maxC;
    for (let i = 0; i < scaled.length; i += 1) {
      const row = scaled[i];
      const minC = minima[i];
      if (row === undefined || minC === undefined) return fail("thresholds");
      // A row whose own minimum overshoots B took no band at all — see
      // `reachable` above — so scored points can never land IN a band that
      // does not exist, whatever the raw percent product says on its own.
      if (minC > maxC) continue;
      if (10000 * scoredC >= row.percentC * maxC) {
        scoredIndex = row.index;
        break;
      }
    }
  }

  return { ok: true, rows, unlabelledFrom, unlabelledTo, scoredPercent, scoredIndex };
}

/* -------------------------------------------------------- grade statistics -- */

/**
 * The quartile rule used, as a key for the surface's own label. Nine methods
 * are in common use and they disagree on Q1 for the same list, so the answer
 * carries the name of the one that produced it.
 */
export const QUARTILE_METHOD = "moore-mccabe-exclusive";

/** A value written in Serbian: an optional sign, digits, and a comma OR a dot. */
const NUMERIC_TOKEN = /^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/;

/**
 * Splits a typed list into numbers, reading the comma as a DECIMAL MARK and
 * never as a separator.
 *
 * „3,5" is one value in Serbian. A parser that splits on commas turns it into a
 * 3 and a 5, which adds a value, lowers the mean and is invisible in the
 * output. Separators are therefore whitespace and the semicolon only.
 *
 * The refusal names the offending token by its 1-based position, as
 * `"token:3"` — „a value is not a number" is useless without which one, and the
 * surface's own copy fills the ordinal in.
 */
export function parseValueList(text: string): ProResult<{ readonly values: readonly number[] }> {
  const tokens = text.split(/[\s;]+/).filter((token) => token.length > 0);
  if (tokens.length === 0) return fail("values");
  if (tokens.length > MAX_VALUES) return fail("tooManyValues");
  const values: number[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined || !NUMERIC_TOKEN.test(token)) return fail(`token:${i + 1}`);
    const value = Number(token.replace(",", "."));
    if (!Number.isFinite(value)) return fail(`token:${i + 1}`);
    values.push(value);
  }
  return { ok: true, values };
}

export interface GradeStatisticsInput {
  readonly values: readonly number[];
  /**
   * Optional pass mark, on the same scale as the values. Regulated: the line
   * between a pass and a fail is drawn by an institution and moves, so this
   * package neither knows it nor assumes one — with no threshold the count is
   * simply not reported.
   */
  readonly passThreshold?: number | undefined;
}

export interface FrequencyRow {
  readonly value: number;
  readonly count: number;
  /** Percent of all values. */
  readonly share: number;
}

export interface GradeStatisticsResult {
  readonly count: number;
  readonly sum: number;
  readonly mean: number;
  readonly min: number;
  readonly max: number;
  readonly range: number;
  readonly median: number;
  /** Undefined for a single value, where neither half exists. */
  readonly q1: number | undefined;
  readonly q3: number | undefined;
  readonly iqr: number | undefined;
  /**
   * True below n = 4, where the exclusive method's split is too thin to mean
   * what „quartile" usually means: n = 1 leaves both halves empty (q1/q3 are
   * `undefined` above), n = 2 puts a single value on each side, and n = 3
   * splits 1/1/1 with the middle excluded from both. q1/q3 above are still the
   * method's own numbers for n = 2 and n = 3 — this says whether to trust them
   * as quartiles rather than hiding them.
   */
  readonly quartilesDegenerate: boolean;
  readonly populationVariance: number;
  readonly populationDeviation: number;
  /** Undefined for a single value: n-1 is zero. */
  readonly sampleVariance: number | undefined;
  readonly sampleDeviation: number | undefined;
  /**
   * Every value tied for the highest frequency, ascending. EMPTY when all
   * distinct values occur equally often — a list with no mode, not a list whose
   * mode is „all of them".
   */
  readonly modes: readonly number[];
  readonly frequencies: readonly FrequencyRow[];
  readonly quartileMethod: typeof QUARTILE_METHOD;
  readonly atOrAbove: number | undefined;
  readonly atOrAbovePercent: number | undefined;
}

/** Median of a half-open slice of an already sorted list; undefined when empty. */
function medianOf(sorted: readonly number[], from: number, to: number): number | undefined {
  const length = to - from;
  if (length <= 0) return undefined;
  const upper = sorted[from + Math.floor(length / 2)];
  if (upper === undefined) return undefined;
  if (length % 2 === 1) return upper;
  const lower = sorted[from + Math.floor(length / 2) - 1];
  return lower === undefined ? undefined : (lower + upper) / 2;
}

/**
 * The whole descriptive summary of a list of marks or scores.
 *
 * **Quartiles are Moore & McCabe's exclusive rule** — the middle value of an
 * odd-length list belongs to NEITHER half — and the method name travels with
 * the answer, because the nine rules in circulation return different Q1 values
 * for the same ten numbers and a bare „Q1 = 3" is not reproducible without it.
 *
 * The pass count is a count against the line the user drew, nothing more: the
 * comparison is made on the values as typed, never on a rounded mean, and no
 * row of this result says whether the list is good.
 */
export function gradeStatistics(input: GradeStatisticsInput): ProResult<GradeStatisticsResult> {
  const { values } = input;
  if (values.length < 1) return fail("values");
  if (values.length > MAX_VALUES) return fail("tooManyValues");
  for (const value of values) {
    if (!Number.isFinite(value)) return fail("values");
  }
  const { passThreshold } = input;
  if (passThreshold !== undefined && !Number.isFinite(passThreshold)) return fail("passThreshold");

  const count = values.length;
  const sorted = [...values].sort((left, right) => left - right);
  const min = sorted[0];
  const max = sorted[count - 1];
  const median = medianOf(sorted, 0, count);
  if (min === undefined || max === undefined || median === undefined) return fail("values");

  let sum = 0;
  for (const value of values) sum += value;
  const mean = sum / count;
  // Two passes rather than the sum-of-squares shortcut: subtracting two large
  // nearly equal numbers is where a variance loses all of its digits.
  let squares = 0;
  for (const value of values) squares += (value - mean) * (value - mean);

  const q1 = medianOf(sorted, 0, Math.floor(count / 2));
  const q3 = medianOf(sorted, Math.ceil(count / 2), count);
  const populationVariance = squares / count;
  const sampleVariance = count > 1 ? squares / (count - 1) : undefined;

  const tally = new Map<number, number>();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
  const frequencies: FrequencyRow[] = [...tally.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([value, occurrences]) => ({
      value,
      count: occurrences,
      share: (100 * occurrences) / count,
    }));
  // "No mode" is reserved for every value occurring exactly once — NOT for
  // every distinct value occurring the same number of times. {1,1,2,2} ties
  // at a highest frequency of 2 and has a mode, {1,1} does too; only when the
  // highest frequency is 1 does "most frequent" fail to pick anything out.
  const highest = Math.max(...frequencies.map((row) => row.count));
  const modes =
    highest === 1 ? [] : frequencies.filter((row) => row.count === highest).map((row) => row.value);

  let atOrAbove: number | undefined;
  let atOrAbovePercent: number | undefined;
  if (passThreshold !== undefined) {
    atOrAbove = values.filter((value) => value >= passThreshold).length;
    atOrAbovePercent = (100 * atOrAbove) / count;
  }

  return {
    ok: true,
    count,
    sum,
    mean,
    min,
    max,
    range: max - min,
    median,
    q1,
    q3,
    iqr: q1 === undefined || q3 === undefined ? undefined : q3 - q1,
    quartilesDegenerate: count < 4,
    populationVariance,
    populationDeviation: Math.sqrt(populationVariance),
    sampleVariance,
    sampleDeviation: sampleVariance === undefined ? undefined : Math.sqrt(sampleVariance),
    modes,
    frequencies,
    quartileMethod: QUARTILE_METHOD,
    atOrAbove,
    atOrAbovePercent,
  };
}

/* ----------------------------------------------------- guessing correction -- */

export interface GuessingCorrectionInput {
  readonly questions: number;
  readonly right: number;
  readonly wrong: number;
  readonly unanswered: number;
  /** Answers offered per question. Two or more, or the penalty divides by zero. */
  readonly options: number;
  /** Points one question carries. A writing choice, so the surface supplies it. */
  readonly pointsPerQuestion: number;
}

export interface GuessingCorrectionResult {
  /** R - W/(k-1), in questions. Negative when wrong answers outweigh right ones. */
  readonly corrected: number;
  readonly points: number;
  readonly percentOfMax: number;
  /**
   * Q/k — the expected number of RAW correct answers before this tool's own
   * correction is applied. Not the same statement as `corrected`: a pure
   * guesser expects this many raw right answers, but the correction brings
   * that same guesser's SCORE to exactly zero — see `expectedAfterCorrection`.
   * Printing the two side by side without their labels is what a paper's own
   * S = 0 for a guesser and this Q/k figure look like they disagree.
   */
  readonly expectedCorrectBeforeCorrection: number;
  /** What pure guessing is worth AFTER the correction — always 0, by construction. */
  readonly expectedAfterCorrection: 0;
  /** R + W + U - Q. Zero when the counts add up; the answer stands either way. */
  readonly answeredMismatch: number;
}

/**
 * The classical guessing correction, `S = R - W/(k-1)`.
 *
 * **The penalty is derived from k, never typed in.** Someone answering A
 * questions at random over k options expects A/k right and A(k-1)/k wrong, so
 * the expected score is `A/k - [A(k-1)/k]/(k-1) = 0` — the correction is
 * calibrated so that pure guessing is worth nothing, and 1/(k-1) is the only
 * value that does it. A negative result is returned as it stands: clipping it
 * at zero would flatter a paper that scored below chance.
 */
export function guessingCorrection(
  input: GuessingCorrectionInput,
): ProResult<GuessingCorrectionResult> {
  const { questions, right, wrong, unanswered, options, pointsPerQuestion } = input;
  if (!isIntegerIn(questions, 1, 100000)) return fail("questions");
  if (!isIntegerIn(right, 0, 100000)) return fail("right");
  if (!isIntegerIn(wrong, 0, 100000)) return fail("wrong");
  if (!isIntegerIn(unanswered, 0, 100000)) return fail("unanswered");
  if (!isIntegerIn(options, 2, 100000)) return fail("options");
  if (!isPositive(pointsPerQuestion)) return fail("pointsPerQuestion");

  const corrected = right - wrong / (options - 1);
  return {
    ok: true,
    corrected,
    points: corrected * pointsPerQuestion,
    percentOfMax: (100 * corrected) / questions,
    expectedCorrectBeforeCorrection: questions / options,
    expectedAfterCorrection: 0,
    answeredMismatch: right + wrong + unanswered - questions,
  };
}

/* ---------------------------------------------------------- item analysis -- */

export interface ItemGroup {
  readonly correct: number;
  readonly size: number;
}

export interface ItemAnalysisInput {
  readonly correct: number;
  /** Students who actually attempted the item — the N the catalogue text uses in p = C/N. */
  readonly students: number;
  /**
   * Students on the roster who never attempted the item at all, if the caller
   * wants them folded in. Absent means `students` already IS the roster the
   * caller wants N to be.
   */
  readonly unanswered?: number | undefined;
  /**
   * How `unanswered` enters N. `"asIncorrect"` adds them to N as wrong
   * answers (N grows, `correct` does not); `"excluded"` leaves N as
   * `students`. Required together with `unanswered` — the two field lists in
   * the catalogue named two different N's, and this is the choice that
   * resolves which one a given call means.
   */
  readonly unansweredTreatment?: "asIncorrect" | "excluded" | undefined;
  /** Optional: the stronger group, as the user split it. */
  readonly upper?: ItemGroup | undefined;
  /** Optional: the weaker group. */
  readonly lower?: ItemGroup | undefined;
}

export interface ItemAnalysisResult {
  /** p = C/N. HIGHER means EASIER — see the note on the function. */
  readonly facility: number;
  readonly facilityPercent: number;
  /** The N that actually entered `facility` — `students`, or `students + unanswered`. */
  readonly n: number;
  readonly upperRate: number | undefined;
  readonly lowerRate: number | undefined;
  /** D = upper - lower, from -1 to 1; undefined unless both groups were given. */
  readonly discrimination: number | undefined;
  /** (N_g + N_s)/N in %, undefined unless both groups were given — see the function note. */
  readonly groupCoveragePercent: number | undefined;
}

/**
 * Facility and discrimination for one test item.
 *
 * **`facility` runs the opposite way to its usual name.** The literature calls
 * p the „difficulty index" while a larger p means MORE students got it right,
 * that is an EASIER item; the field is named for what it measures so nobody
 * reads 0.90 as „very hard".
 *
 * The split into a stronger and a weaker group is the user's — this tool does
 * not choose the cut, does not require the groups to be the same size, and has
 * no threshold for what makes an item good, because no such threshold is
 * defined anywhere; they are conventions, and adopting one would be this app
 * grading somebody's test paper design.
 *
 * **Which N enters p is a choice the caller states, not one this file
 * assumes.** `unanswered` students either widen N as wrong answers or are left
 * out of it entirely — the catalogue's own input list and computation
 * paragraph named two different N's, and `n` is echoed back so a reader of
 * the result never has to guess which one produced `facility`.
 *
 * **Each group is cross-checked against the whole, alone and together.**
 * `N_g > N` or `C_g > C` describes one group that alone claims more students,
 * or more correct answers, than the item had — refused as soon as that group
 * is read, before a second group is even in the picture. `N_g + N_s > N` or
 * `C_g + C_s > C` catches the same impossibility split across both groups.
 * Either way it is an impossible input, refused rather than turned into a D
 * that contradicts the p beside it.
 */
export function itemAnalysis(input: ItemAnalysisInput): ProResult<ItemAnalysisResult> {
  const { correct, students, upper, lower, unanswered, unansweredTreatment } = input;
  if (!isIntegerIn(students, 1, 1000000)) return fail("students");
  if (!isIntegerIn(correct, 0, students)) return fail("correct");
  if ((unanswered === undefined) !== (unansweredTreatment === undefined)) {
    return fail("unansweredTreatment");
  }
  if (unanswered !== undefined && !isIntegerIn(unanswered, 0, 1000000)) return fail("unanswered");
  const n = unanswered !== undefined && unansweredTreatment === "asIncorrect"
    ? students + unanswered
    : students;

  let upperRate: number | undefined;
  if (upper !== undefined) {
    if (!isIntegerIn(upper.size, 1, 1000000)) return fail("upper");
    if (!isIntegerIn(upper.correct, 0, upper.size)) return fail("upper");
    // One group alone cannot describe more students or more correct answers
    // than the item actually had — the same impossible pair `groups` below
    // refuses for two groups together, checked here per group so a lone
    // `upper` cannot smuggle it through.
    if (upper.size > n || upper.correct > correct) return fail("upper");
    upperRate = upper.correct / upper.size;
  }
  let lowerRate: number | undefined;
  if (lower !== undefined) {
    if (!isIntegerIn(lower.size, 1, 1000000)) return fail("lower");
    if (!isIntegerIn(lower.correct, 0, lower.size)) return fail("lower");
    if (lower.size > n || lower.correct > correct) return fail("lower");
    lowerRate = lower.correct / lower.size;
  }
  if (upper !== undefined && lower !== undefined) {
    // A split cannot describe more students or more correct answers than the
    // item actually had — that is not two groups of the same item, it is a
    // typo that would otherwise print a D no p on the same screen can back up.
    if (upper.size + lower.size > n) return fail("groups");
    if (upper.correct + lower.correct > correct) return fail("groups");
  }

  const facility = correct / n;
  return {
    ok: true,
    facility,
    facilityPercent: 100 * facility,
    n,
    upperRate,
    lowerRate,
    discrimination:
      upperRate === undefined || lowerRate === undefined ? undefined : upperRate - lowerRate,
    groupCoveragePercent:
      upper === undefined || lower === undefined
        ? undefined
        : (100 * (upper.size + lower.size)) / n,
  };
}

/* ------------------------------------------------------ lessons in a period -- */

export interface WeekdayLessons {
  /** ISO-8601 weekday: 1 = Monday … 7 = Sunday (ISO 8601-1:2019). */
  readonly weekday: number;
  /** Lessons of this subject on that day, 1..10. */
  readonly lessons: number;
}

/**
 * A single date the ministry's calendar moves onto another weekday's
 * timetable — the compensation days a school calendar routinely prescribes
 * around a public holiday. `date` follows `followsWeekday`'s schedule instead
 * of its own.
 */
export interface MakeupDay {
  readonly date: CalendarDate;
  /** The weekday whose lesson count applies on `date` instead of its own. */
  readonly followsWeekday: number;
}

/** A typed exclusion that removed an actual session, and the weekday it fell on. */
export interface AppliedExclusion {
  readonly date: CalendarDate;
  readonly weekday: number;
}

/**
 * Why a typed exclusion changed nothing: it fell outside the period, it
 * repeated a date already typed, or it landed on a weekday the subject does
 * not run on at all.
 */
export type IgnoredExclusionReason = "offPeriod" | "duplicate" | "offWeekday";

export interface IgnoredExclusion {
  readonly date: CalendarDate;
  readonly reason: IgnoredExclusionReason;
}

export interface LessonCountInput {
  /** First day of the period, included. */
  readonly start: CalendarDate;
  /** Last day of the period, included. */
  readonly end: CalendarDate;
  readonly weekdays: readonly WeekdayLessons[];
  /**
   * Non-teaching days the user typed. Regulated: the ministry publishes a
   * calendar of holidays and school breaks for every school year, and this
   * package ships NONE of it — only the dates entered here are subtracted.
   */
  readonly excludedDates: readonly CalendarDate[];
  /**
   * Dates that run to a DIFFERENT weekday's timetable — a Friday made up on a
   * Monday's schedule, say. A date here must not also appear in
   * `excludedDates`: the two say opposite things about the same day.
   */
  readonly makeupDays?: readonly MakeupDay[] | undefined;
  /** Minutes in one lesson. Regulated: an institution sets it. */
  readonly lessonMinutes: number;
  /**
   * The syllabus's own prescribed hour count for this period, if the caller
   * wants it compared. Regulated: no default, and no judgement is drawn from
   * the comparison — only the plain difference and ratio.
   */
  readonly prescribedHours?: number | undefined;
}

export interface WeekdayCount {
  readonly weekday: number;
  readonly lessons: number;
  /** How many times that weekday falls inside the period, before any adjustment. */
  readonly occurrences: number;
  /** Typed exclusions that landed on this weekday. */
  readonly excluded: number;
  /** Dates converted AWAY from this weekday onto another one's timetable. */
  readonly makeupAway: number;
  /** Dates from OTHER weekdays converted onto this one's timetable. */
  readonly makeupInto: number;
  /** occurrences − excluded − makeupAway + makeupInto, floored at zero. */
  readonly sessions: number;
}

export interface LessonCountResult {
  /** In the order the weekdays were given. */
  readonly days: readonly WeekdayCount[];
  readonly totalSessions: number;
  readonly totalLessons: number;
  readonly totalExcluded: number;
  readonly totalMinutes: number;
  readonly hours: number;
  readonly minutes: number;
  /** The lesson length that was typed in, echoed for a reader of the totals. */
  readonly lessonMinutes: number;
  /** Typed exclusions inside the period, on a weekday the subject does not run on. */
  readonly ignoredOffWeekday: number;
  /** Typed exclusions outside the period, or repeating a date already typed. */
  readonly ignoredOffPeriod: number;
  /** Every typed exclusion that actually removed a session, with its weekday. */
  readonly appliedExclusions: readonly AppliedExclusion[];
  /** Every typed exclusion that changed nothing, and which of the three reasons why. */
  readonly ignoredExclusions: readonly IgnoredExclusion[];
  /** The syllabus figure, echoed back. */
  readonly prescribedHours: number | undefined;
  /** totalLessons − prescribedHours. */
  readonly hoursDifference: number | undefined;
  /** totalLessons / prescribedHours. */
  readonly hoursRatio: number | undefined;
}

/**
 * How many lessons of one subject a period holds, given which weekdays it runs
 * on and which dates are off.
 *
 * **Counted, not walked.** The first occurrence of weekday w on or after the
 * start is `start + ((w - isoWeekday(start) + 7) mod 7)`, and the rest are one
 * arithmetic step apart — so a period of any length costs the same, and no loop
 * over 120 days can drift. The whole calculation runs over day numbers, which
 * is also why it has no time zone and no daylight saving in it.
 *
 * An excluded date that lands on a weekday the subject does not run on changes
 * nothing, and is not an error: it is a holiday on a day with no lesson.
 *
 * **A makeup day moves one date's session from its own weekday to another's,
 * by name.** It is looked up by day number exactly as an exclusion is, so the
 * two can be checked against each other: the same date in both lists is a
 * contradiction (holiday, or working a different timetable — never both), and
 * is refused rather than guessed at.
 */
export function lessonCountPeriod(input: LessonCountInput): ProResult<LessonCountResult> {
  if (!isValidDate(input.start)) return fail("start");
  if (!isValidDate(input.end)) return fail("end");
  const startDay = dayNumber(input.start);
  const endDay = dayNumber(input.end);
  if (endDay < startDay) return fail("end");
  if (!isIntegerIn(input.lessonMinutes, 1, 600)) return fail("lessonMinutes");
  if (input.weekdays.length < 1 || input.weekdays.length > 7) return fail("weekdays");
  if (input.prescribedHours !== undefined && !isPositive(input.prescribedHours)) {
    return fail("prescribedHours");
  }

  const chosen = new Set<number>();
  for (const entry of input.weekdays) {
    if (!isIntegerIn(entry.weekday, 1, 7) || chosen.has(entry.weekday)) return fail("weekdays");
    if (!isIntegerIn(entry.lessons, 1, 10)) return fail("lessons");
    chosen.add(entry.weekday);
  }

  if (input.excludedDates.length > MAX_ROWS) return fail("tooManyRows");
  const excludedDays = new Set<number>();
  const appliedExclusions: AppliedExclusion[] = [];
  const ignoredExclusions: IgnoredExclusion[] = [];
  let ignoredOffPeriod = 0;
  let ignoredOffWeekday = 0;
  for (const date of input.excludedDates) {
    if (!isValidDate(date)) return fail("excludedDates");
    const day = dayNumber(date);
    if (day < startDay || day > endDay) {
      ignoredOffPeriod += 1;
      ignoredExclusions.push({ date, reason: "offPeriod" });
      continue;
    }
    if (excludedDays.has(day)) {
      ignoredOffPeriod += 1;
      ignoredExclusions.push({ date, reason: "duplicate" });
      continue;
    }
    excludedDays.add(day);
    const weekday = isoWeekday(day);
    if (chosen.has(weekday)) {
      appliedExclusions.push({ date, weekday });
    } else {
      ignoredOffWeekday += 1;
      ignoredExclusions.push({ date, reason: "offWeekday" });
    }
  }

  const makeupDays = input.makeupDays ?? [];
  if (makeupDays.length > MAX_ROWS) return fail("tooManyRows");
  // day number -> the weekday it now follows, so both the "away" and the
  // "into" side of the move can be read off the same map.
  const makeupByDay = new Map<number, number>();
  for (const makeup of makeupDays) {
    if (!isValidDate(makeup.date)) return fail("makeupDays");
    if (!isIntegerIn(makeup.followsWeekday, 1, 7)) return fail("makeupDays");
    const day = dayNumber(makeup.date);
    if (day < startDay || day > endDay) return fail("makeupDays");
    if (excludedDays.has(day) || makeupByDay.has(day)) return fail("makeupDays");
    makeupByDay.set(day, makeup.followsWeekday);
  }

  const startWeekday = isoWeekday(startDay);
  const days: WeekdayCount[] = [];
  let totalSessions = 0;
  let totalLessons = 0;
  let totalExcluded = 0;
  for (const entry of input.weekdays) {
    const first = startDay + ((entry.weekday - startWeekday + 7) % 7);
    const occurrences = first > endDay ? 0 : Math.floor((endDay - first) / 7) + 1;
    let excluded = 0;
    for (const day of excludedDays) {
      if (isoWeekday(day) === entry.weekday) excluded += 1;
    }
    let makeupAway = 0;
    let makeupInto = 0;
    for (const [day, followsWeekday] of makeupByDay) {
      if (isoWeekday(day) === entry.weekday) makeupAway += 1;
      if (followsWeekday === entry.weekday) makeupInto += 1;
    }
    const sessions = Math.max(0, occurrences - excluded - makeupAway + makeupInto);
    days.push({
      weekday: entry.weekday,
      lessons: entry.lessons,
      occurrences,
      excluded,
      makeupAway,
      makeupInto,
      sessions,
    });
    totalSessions += sessions;
    totalLessons += sessions * entry.lessons;
    totalExcluded += excluded;
  }

  const totalMinutes = totalLessons * input.lessonMinutes;
  const { prescribedHours } = input;
  return {
    ok: true,
    days,
    totalSessions,
    totalLessons,
    totalExcluded,
    totalMinutes,
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
    lessonMinutes: input.lessonMinutes,
    ignoredOffWeekday,
    ignoredOffPeriod,
    appliedExclusions,
    ignoredExclusions,
    prescribedHours,
    hoursDifference: prescribedHours === undefined ? undefined : totalLessons - prescribedHours,
    hoursRatio: prescribedHours === undefined ? undefined : totalLessons / prescribedHours,
  };
}

/* --------------------------------------------------------- lesson timeline -- */

/** Minutes in a civil day. Leap seconds are not shown on a civil clock. */
const MINUTES_PER_DAY = 1440;

export interface ClockTime {
  /** 0..23. */
  readonly hour: number;
  /** 0..59. */
  readonly minute: number;
  /** Whole days past the starting day — 1 is the „+1 dan" mark. */
  readonly dayOffset: number;
}

export interface LessonTimelineInput {
  /** 0..23. */
  readonly startHour: number;
  /** 0..59. */
  readonly startMinute: number;
  /** Activity lengths in whole minutes, in order. Names stay in the surface. */
  readonly durations: readonly number[];
  /** Optional lesson length to measure against. Regulated: an institution sets it. */
  readonly lessonMinutes?: number | undefined;
}

export interface TimelineRow {
  readonly index: number;
  readonly duration: number;
  readonly start: ClockTime;
  readonly end: ClockTime;
  /** Minutes from midnight of the starting day, so rows stay orderable past midnight. */
  readonly startMinutes: number;
  readonly endMinutes: number;
  /** Percent of the total. */
  readonly share: number;
}

export interface LessonTimelineResult {
  readonly rows: readonly TimelineRow[];
  readonly totalMinutes: number;
  readonly end: ClockTime;
  readonly endMinutes: number;
  /**
   * Lesson length minus the total. POSITIVE is time left, NEGATIVE is the
   * overrun — one signed number rather than two half-empty fields, and
   * undefined when no lesson length was given.
   */
  readonly slack: number | undefined;
}

/** Minutes from the starting midnight, as a wall clock plus a day count. */
function clockOf(minutes: number): ClockTime {
  const withinDay = minutes % MINUTES_PER_DAY;
  return {
    hour: Math.floor(withinDay / 60),
    minute: withinDay % 60,
    dayOffset: Math.floor(minutes / MINUTES_PER_DAY),
  };
}

/**
 * A lesson plan laid out on the clock, with each activity's share of the total.
 *
 * **Everything but the shares is integer minutes**, and the clock is derived at
 * the end rather than carried through: an activity that crosses midnight is
 * `1450` minutes from the starting midnight, which prints as 00:10 with a
 * „+1 day" mark, and never as a negative or a wrapped-around 24:10.
 *
 * Shares are rounded independently by whoever prints them, so four of them can
 * total 99.99 rather than 100. That is a property of rounding percentages, not
 * an error, and the surface says so instead of nudging one row to make the
 * column add up.
 */
export function lessonTimeline(input: LessonTimelineInput): ProResult<LessonTimelineResult> {
  const { startHour, startMinute, durations } = input;
  if (!isIntegerIn(startHour, 0, 23)) return fail("startHour");
  if (!isIntegerIn(startMinute, 0, 59)) return fail("startMinute");
  if (durations.length < 1) return fail("durations");
  if (durations.length > MAX_ROWS) return fail("tooManyRows");
  for (const duration of durations) {
    if (!isIntegerIn(duration, 0, 100000)) return fail("durations");
  }
  const { lessonMinutes } = input;
  if (lessonMinutes !== undefined && !isIntegerIn(lessonMinutes, 1, 600)) {
    return fail("lessonMinutes");
  }

  let total = 0;
  for (const duration of durations) total += duration;
  // Every activity at zero minutes (or a table nobody filled in) divides by
  // zero in the very share the tool exists to print — a refusal, not a blank
  // column.
  if (total === 0) return fail("durations");

  const startMinutes = 60 * startHour + startMinute;
  const rows: TimelineRow[] = [];
  let cursor = startMinutes;
  for (let i = 0; i < durations.length; i += 1) {
    const duration = durations[i];
    if (duration === undefined) return fail("durations");
    const end = cursor + duration;
    rows.push({
      index: i,
      duration,
      start: clockOf(cursor),
      end: clockOf(end),
      startMinutes: cursor,
      endMinutes: end,
      share: (100 * duration) / total,
    });
    cursor = end;
  }

  return {
    ok: true,
    rows,
    totalMinutes: total,
    end: clockOf(cursor),
    endMinutes: cursor,
    slack: lessonMinutes === undefined ? undefined : lessonMinutes - total,
  };
}

/* --------------------------------------------------------- split into groups -- */

export type GroupSplit =
  /** Fix the number of groups and let the sizes settle. */
  | { readonly kind: "byGroups"; readonly groups: number }
  /** Fix the group size and let the count settle. */
  | { readonly kind: "bySize"; readonly size: number };

export interface SplitIntoGroupsInput {
  readonly students: number;
  readonly split: GroupSplit;
  /**
   * The smallest group size the split may produce. Absent means no floor at
   * all — a lone student in a group of one is then an ordinary answer rather
   * than a refusal.
   */
  readonly minGroupSize?: number | undefined;
}

export interface GroupTallyRow {
  readonly size: number;
  readonly count: number;
}

export interface SplitIntoGroupsResult {
  readonly groups: number;
  /** Sizes in descending order, as „count × size" rows. */
  readonly tally: readonly GroupTallyRow[];
  /** Σ size·count, which equals the roll by construction — the check, shown. */
  readonly checkSum: number;
  /** Groups that come out empty because more were asked for than there are people. */
  readonly emptyGroups: number;
  /** groups − emptyGroups, the other half of the same count. */
  readonly groupsWithMembers: number;
  /** By size only: groups of exactly the requested size if nothing is evened out. */
  readonly fullGroups: number | undefined;
  /** By size only: people left over from that uneven split. */
  readonly remainder: number | undefined;
  /**
   * By size only: `fullGroups·g + remainder`, which equals the roll by
   * construction. This is a DIFFERENT split from `tally` above (nothing is
   * evened out here) and carries its own check for exactly that reason.
   */
  readonly fullCheckSum: number | undefined;
  /** By size only: whether the evened-out split kept every group at or under `g`. */
  readonly largestGroupWithinSize: boolean | undefined;
}

/**
 * A class split into groups, either into a fixed number of them or into groups
 * of a fixed size.
 *
 * **The sizes are evened out, and the check that they add up is part of the
 * answer.** `r` groups of `q+1` and `k-r` of `q` sum to `kq + r = N` by
 * construction, so the check can never fail — which is exactly why it is worth
 * printing: it is the reader's proof that nobody was dropped.
 *
 * Asking for more groups than there are pupils is answered rather than refused
 * — UNLESS `minGroupSize` says otherwise: `N` groups of one and the rest empty
 * is what the arithmetic says, `emptyGroups` says it out loud instead of
 * quietly returning fewer groups than were asked for, and a floor on the
 * smallest group turns that same answer into a refusal when the caller has
 * said a group that small is not usable.
 *
 * **`bySize` mode carries two DIFFERENT splits, not two views of one.** The
 * evened-out `tally` never exceeds `g` per group (`groups = ceil(N/g)` by
 * construction, so `largestGroupWithinSize` is always true); the „full groups
 * + remainder" view is the same size run to exhaustion with nothing evened
 * out, and its own `fullCheckSum` is what proves IT adds up, separately from
 * `checkSum`.
 */
export function splitIntoGroups(input: SplitIntoGroupsInput): ProResult<SplitIntoGroupsResult> {
  const { students, split } = input;
  if (!isIntegerIn(students, 1, 100000)) return fail("students");
  if (input.minGroupSize !== undefined && !isIntegerIn(input.minGroupSize, 1, 100000)) {
    return fail("minGroupSize");
  }

  let groups: number;
  let fullGroups: number | undefined;
  let remainder: number | undefined;
  let fullCheckSum: number | undefined;
  let largestGroupWithinSize: boolean | undefined;
  if (split.kind === "byGroups") {
    if (!isIntegerIn(split.groups, 1, 100000)) return fail("groups");
    groups = split.groups;
  } else {
    if (!isIntegerIn(split.size, 1, 100000)) return fail("size");
    groups = ceilDiv(students, split.size);
    fullGroups = Math.floor(students / split.size);
    remainder = students % split.size;
    fullCheckSum = fullGroups * split.size + remainder;
  }

  const base = Math.floor(students / groups);
  const larger = students % groups;
  // `larger` is a remainder mod `groups`, so it is always strictly less than
  // `groups` — some group is always exactly `base`, which is therefore always
  // the smallest one produced.
  if (input.minGroupSize !== undefined && base < input.minGroupSize) {
    return fail("minGroupSize");
  }
  if (split.kind === "bySize") {
    largestGroupWithinSize = base + (larger > 0 ? 1 : 0) <= split.size;
  }

  const tally: GroupTallyRow[] = [];
  if (larger > 0) tally.push({ size: base + 1, count: larger });
  if (groups - larger > 0) tally.push({ size: base, count: groups - larger });

  let checkSum = 0;
  for (const row of tally) checkSum += row.size * row.count;
  const emptyGroups = base === 0 ? groups - larger : 0;

  return {
    ok: true,
    groups,
    tally,
    checkSum,
    emptyGroups,
    groupsWithMembers: groups - emptyGroups,
    fullGroups,
    remainder,
    fullCheckSum,
    largestGroupWithinSize,
  };
}

/* ----------------------------------------------------------- standard score -- */

/**
 * The T scale, mean 50 and standard deviation 10, as defined by W. A. McCall,
 * How to Measure in Education (1922). These two numbers ARE the definition of a
 * T score — not a threshold somebody revises — which is why they are embedded
 * here with their source rather than taken as input.
 */
const T_SCALE_MEAN = 50;
const T_SCALE_DEVIATION = 10;

export interface TargetScale {
  readonly mean: number;
  /** Must be above zero, or the scale has no spread to map onto. */
  readonly deviation: number;
}

/**
 * Whether `deviation` is the POPULATION figure (divisor n) or the SAMPLE
 * figure (divisor n−1). The two differ for the same list of marks, `z` is
 * linear in `deviation`, and there is no way to recover which one a caller
 * meant from the number alone — so it travels with the input and is echoed
 * back rather than assumed.
 */
export type DeviationKind = "population" | "sample";

export interface StandardScoreInput {
  readonly raw: number;
  readonly mean: number;
  /** Standard deviation of the group. Zero is refused, not printed as infinity. */
  readonly deviation: number;
  readonly deviationKind: DeviationKind;
  /** Optional: any other standardised scale, e.g. mean 100 with deviation 15. */
  readonly target?: TargetScale | undefined;
  /** Optional: a z value to turn back into a raw score. */
  readonly zForRaw?: number | undefined;
  /** Optional: a T score to turn back into a raw score, via z = (T − 50)/10. */
  readonly tScoreForRaw?: number | undefined;
  /** Optional: a value on `target`'s scale to turn back into a raw score. Requires `target`. */
  readonly targetScoreForRaw?: number | undefined;
}

export interface StandardScoreResult {
  readonly z: number;
  readonly tScore: number;
  readonly targetScore: number | undefined;
  readonly rawFromZ: number | undefined;
  readonly rawFromTScore: number | undefined;
  readonly rawFromTargetScore: number | undefined;
  /**
   * `mean`, `deviation` and `target` as given — the reference group a bare z
   * means nothing without.
   */
  readonly mean: number;
  readonly deviation: number;
  readonly deviationKind: DeviationKind;
  readonly target: TargetScale | undefined;
}

/**
 * A raw score as a z value and a T score, on the mean and deviation the user
 * supplied.
 *
 * **No percentile.** Turning z into „better than 84% of the group" assumes the
 * scores are normally distributed, and a single score is not evidence of that —
 * a tool cannot check the assumption it would be relying on, so it does not
 * make it. z comes back to four decimals because at two, scores a whole T point
 * apart look identical.
 *
 * **The reverse runs from all three scales, not only from z.** A teacher as
 * often has a T score or a scaled score in hand and wants the raw mark back;
 * each reverse first recovers z on that scale's own definition (`z = (T −
 * 50)/10`, `z = (y − M)/S`) and then applies the same `raw = μ + z·σ` as
 * `zForRaw` does, so all three routes agree by construction.
 */
export function standardScore(input: StandardScoreInput): ProResult<StandardScoreResult> {
  const { raw, mean, deviation, deviationKind, target, zForRaw, tScoreForRaw, targetScoreForRaw } =
    input;
  if (!Number.isFinite(raw)) return fail("raw");
  if (!Number.isFinite(mean)) return fail("mean");
  if (!isPositive(deviation)) return fail("deviation");
  if (deviationKind !== "population" && deviationKind !== "sample") return fail("deviationKind");
  if (target !== undefined) {
    if (!Number.isFinite(target.mean)) return fail("targetMean");
    if (!isPositive(target.deviation)) return fail("targetDeviation");
  }
  if (zForRaw !== undefined && !Number.isFinite(zForRaw)) return fail("zForRaw");
  if (tScoreForRaw !== undefined && !Number.isFinite(tScoreForRaw)) return fail("tScoreForRaw");
  if (targetScoreForRaw !== undefined) {
    if (target === undefined) return fail("targetScoreForRaw");
    if (!Number.isFinite(targetScoreForRaw)) return fail("targetScoreForRaw");
  }

  const z = (raw - mean) / deviation;
  const rawFromTargetScore =
    targetScoreForRaw === undefined || target === undefined
      ? undefined
      : mean + ((targetScoreForRaw - target.mean) / target.deviation) * deviation;
  return {
    ok: true,
    z,
    tScore: T_SCALE_MEAN + T_SCALE_DEVIATION * z,
    targetScore: target === undefined ? undefined : target.mean + target.deviation * z,
    rawFromZ: zForRaw === undefined ? undefined : mean + zForRaw * deviation,
    rawFromTScore:
      tScoreForRaw === undefined
        ? undefined
        : mean + ((tScoreForRaw - T_SCALE_MEAN) / T_SCALE_DEVIATION) * deviation,
    rawFromTargetScore,
    mean,
    deviation,
    deviationKind,
    target,
  };
}

/* ------------------------------------------------------------- test printing -- */

/** A sheet of paper has two sides. */
const SIDES_PER_SHEET = 2;

/**
 * Test pages assumed printed one logical page per physical side. A booklet
 * imposition (e.g. four A5 pages per A4 sheet) is a different, smaller sheet
 * count that this tool does not compute — the assumption is returned rather
 * than buried in a comment, so a surface always has the fact in hand to show.
 */
const PAGES_PER_SHEET_SIDE = 1;

export interface TestPrintingInput {
  readonly pages: number;
  readonly copies: number;
  readonly duplex: boolean;
  /** Sheets in one pack, as printed on the wrapper. */
  readonly sheetsPerPack: number;
  /**
   * Optional price of one sheet, in whatever currency the user works in. A
   * market number: this app has no network, no price list, and no business
   * knowing it — it multiplies what was typed and nothing else.
   */
  readonly pricePerSheet?: number | undefined;
}

export interface TestPrintingResult {
  readonly sheetsPerCopy: number;
  readonly totalPages: number;
  readonly totalSheets: number;
  /** Sides left blank by duplexing an odd page count; 0 when printing one-sided. */
  readonly blankBacks: number;
  readonly packs: number;
  readonly leftInLastPack: number;
  /** Hundredths of the currency unit — the exact figure, before any display rounding. */
  readonly amountMinor: number | undefined;
  readonly amount: number | undefined;
  /** The imposition this run assumed — see `PAGES_PER_SHEET_SIDE`. */
  readonly pagesPerSheetSide: typeof PAGES_PER_SHEET_SIDE;
}

/**
 * Paper and cost for a run of a test.
 *
 * **The halving is PER COPY, and that is the whole calculation.** Two pupils'
 * pages are never printed on the same sheet, so three pages duplexed is two
 * sheets each — 56 sheets for 28 copies. Halving the 84 total pages instead
 * gives 42 and is short by fourteen sheets, which is the error discovered at
 * the photocopier.
 *
 * The amount is the sheets times the price typed, held in hundredths as an
 * integer so nothing is added in floating point. No tax, no rate, no currency
 * conversion — none of those are this tool's to apply.
 */
export function testPrinting(input: TestPrintingInput): ProResult<TestPrintingResult> {
  const { pages, copies, duplex, sheetsPerPack } = input;
  if (!isIntegerIn(pages, 1, 100000)) return fail("pages");
  if (!isIntegerIn(copies, 1, 1000000)) return fail("copies");
  if (!isIntegerIn(sheetsPerPack, 1, 1000000)) return fail("sheetsPerPack");

  const sheetsPerCopy = duplex ? ceilDiv(pages, SIDES_PER_SHEET) : pages;
  const totalSheets = sheetsPerCopy * copies;
  const totalPages = pages * copies;

  let amountMinor: number | undefined;
  const { pricePerSheet } = input;
  if (pricePerSheet !== undefined) {
    const priceC = hundredths(pricePerSheet);
    if (priceC === undefined || priceC < 0) return fail("pricePerSheet");
    amountMinor = totalSheets * priceC;
  }

  const packs = ceilDiv(totalSheets, sheetsPerPack);
  return {
    ok: true,
    sheetsPerCopy,
    totalPages,
    totalSheets,
    blankBacks: duplex ? SIDES_PER_SHEET * totalSheets - totalPages : 0,
    packs,
    leftInLastPack: packs * sheetsPerPack - totalSheets,
    amountMinor,
    amount: amountMinor === undefined ? undefined : amountMinor / 100,
    pagesPerSheetSide: PAGES_PER_SHEET_SIDE,
  };
}

/* ------------------------------------------------------ topic hour allocation -- */

/** The apportionment rule used, as a key for the surface's own label. */
export const ALLOCATION_METHOD = "largest-remainder-hamilton";

export interface TopicHourInput {
  /**
   * Total lessons to share out. Regulated: the yearly allocation per subject is
   * set by the syllabus, so it is typed in rather than known here.
   */
  readonly totalHours: number;
  /**
   * One weight per topic, in input order. They need not add up to 100.
   *
   * Held to two decimals, like every other points/percent value in this file —
   * see `hundredths`. The catalogue's own computation paragraph describes
   * weights being scaled by 100 and ROUNDED to a whole number instead
   * (`W_i = round(100·w_i)`), which would silently accept something like
   * 33.333 by rounding away its third decimal; this file refuses it instead,
   * per the house rule that a value the user typed is never edited. A weight
   * with more precision than two decimals has to be rewritten by the caller,
   * not repaired here.
   */
  readonly weights: readonly number[];
}

export interface TopicHourRow {
  readonly index: number;
  /** The exact share before rounding, in hours. */
  readonly quota: number;
  /** Whole hours allotted. */
  readonly hours: number;
  /** What those whole hours actually carry, as a percent of the total. */
  readonly share: number;
  /** True when this row took one of the leftover hours. */
  readonly extraHour: boolean;
}

export interface TopicHourResult {
  /** In input order. */
  readonly rows: readonly TopicHourRow[];
  /** Σ hours, which equals `totalHours` — the check, shown. */
  readonly checkSum: number;
  /** How many rows took a leftover hour. */
  readonly extraHourCount: number;
  readonly method: typeof ALLOCATION_METHOD;
}

/**
 * A lesson allocation shared out over topics by weight, in whole hours that add
 * up exactly to the allocation.
 *
 * **Largest remainder (Hamilton), and the tie-break is written down.** Rounding
 * each quota on its own gives a column that adds up to 71 or 73 rather than 72;
 * the floors are handed out first and the leftover hours go to the largest
 * fractional parts. Those fractions are compared as integer REMAINDERS of
 * `T·W_i mod ΣW`, never as doubles, so two topics with the same weight can
 * never be separated by a representation artefact — the stated tie-break
 * (greater weight, then earlier row) is what separates them, and the output is
 * therefore identical on every run.
 *
 * A weight of zero takes a quota of zero and can never take a leftover hour:
 * strictly more rows have a positive remainder than there are hours to hand
 * out, so a zero remainder never reaches the front of the queue.
 */
export function topicHourAllocation(input: TopicHourInput): ProResult<TopicHourResult> {
  const { totalHours, weights } = input;
  if (!isIntegerIn(totalHours, 1, 100000)) return fail("totalHours");
  if (weights.length < 1) return fail("weights");
  if (weights.length > MAX_ROWS) return fail("tooManyRows");

  const scaled: number[] = [];
  let weightSum = 0;
  for (const weight of weights) {
    if (!isInRange(weight, 0, 1e6)) return fail("weights");
    const value = hundredths(weight);
    if (value === undefined) return fail("weights");
    scaled.push(value);
    weightSum += value;
  }
  if (weightSum <= 0) return fail("weights");

  const floors: number[] = [];
  const remainders: number[] = [];
  let allotted = 0;
  for (const value of scaled) {
    const product = totalHours * value;
    const whole = Math.floor(product / weightSum);
    floors.push(whole);
    remainders.push(product - whole * weightSum);
    allotted += whole;
  }
  const leftover = totalHours - allotted;

  const order = scaled.map((_, index) => index).sort((left, right) => {
    const byRemainder = (remainders[right] ?? 0) - (remainders[left] ?? 0);
    if (byRemainder !== 0) return byRemainder;
    const byWeight = (scaled[right] ?? 0) - (scaled[left] ?? 0);
    return byWeight !== 0 ? byWeight : left - right;
  });
  const takesExtra = new Set(order.slice(0, leftover));

  const rows: TopicHourRow[] = [];
  let checkSum = 0;
  for (let index = 0; index < scaled.length; index += 1) {
    const value = scaled[index];
    const whole = floors[index];
    if (value === undefined || whole === undefined) return fail("weights");
    const extraHour = takesExtra.has(index);
    const hours = whole + (extraHour ? 1 : 0);
    checkSum += hours;
    rows.push({
      index,
      quota: (totalHours * value) / weightSum,
      hours,
      share: (100 * hours) / totalHours,
      extraHour,
    });
  }

  return { ok: true, rows, checkSum, extraHourCount: leftover, method: ALLOCATION_METHOD };
}

/* ------------------------------------------------------------ weighted grade -- */

export interface WeightedComponent {
  readonly scored: number;
  readonly max: number;
  /**
   * Weight of this component. Regulated: an institution or a syllabus sets the
   * split between coursework and exam, so there is no default distribution here.
   */
  readonly weight: number;
}

export interface PendingComponent {
  readonly max: number;
  readonly weight: number;
}

export type TargetOutcome =
  /** The target needs `requiredPoints` on the pending component, and they exist. */
  | "reachable"
  /** The target is already met with the pending component at zero. */
  | "alreadyMet"
  /** The target needs more than the pending component is worth. */
  | "unreachable";

export interface WeightedGradeInput {
  readonly components: readonly WeightedComponent[];
  /** Optional: a point total the weighted result is mapped onto. */
  readonly totalPoints?: number | undefined;
  /** Optional: the overall percent being aimed at, 0..100. */
  readonly targetPercent?: number | undefined;
  /** Optional: the component not sat yet, which the target would be reached on. */
  readonly pending?: PendingComponent | undefined;
}

export interface WeightedRow {
  readonly index: number;
  /** 100·scored/max. */
  readonly percent: number;
  /** 100·weight/Σweight, where Σ INCLUDES the pending component. */
  readonly normalizedWeight: number;
}

export interface WeightedGradeResult {
  readonly rows: readonly WeightedRow[];
  /**
   * The weighted percent so far. With a pending component this is a LOWER
   * BOUND, not a result: the pending component counts at zero until it has a
   * mark.
   */
  readonly totalPercent: number;
  readonly mappedPoints: number | undefined;
  readonly pendingWeight: number | undefined;
  /**
   * Points needed on the pending component, UNCLAMPED — negative when the
   * target is already met, above its maximum when it cannot be. `targetOutcome`
   * says which of the three it is.
   */
  readonly requiredPoints: number | undefined;
  readonly targetOutcome: TargetOutcome | undefined;
}

/**
 * Components with different maxima and different weights folded into one
 * percent, and what the component still to come has to carry.
 *
 * **The pending component is inside Σweight from the start.** Leaving it out
 * until it has a mark makes the running total look like a finished result — a
 * course sitting at 42% of the whole would print as 84%, which is the number a
 * student would plan around and the one that is wrong. It sits in the
 * denominator at a ratio of zero, so the total is honestly a floor.
 */
export function weightedGrade(input: WeightedGradeInput): ProResult<WeightedGradeResult> {
  const { components, pending } = input;
  if (components.length < 1) return fail("components");
  if (components.length > MAX_ROWS) return fail("tooManyRows");

  let weightSum = 0;
  let weightedRatio = 0;
  const ratios: number[] = [];
  for (const component of components) {
    if (!isPositive(component.max)) return fail("componentMax");
    if (!isNonNegative(component.scored) || component.scored > component.max) {
      return fail("componentScored");
    }
    if (!isNonNegative(component.weight)) return fail("componentWeight");
    const ratio = component.scored / component.max;
    ratios.push(ratio);
    weightSum += component.weight;
    weightedRatio += component.weight * ratio;
  }
  if (pending !== undefined) {
    if (!isPositive(pending.max)) return fail("pendingMax");
    if (!isPositive(pending.weight)) return fail("pendingWeight");
    weightSum += pending.weight;
  }
  if (!isPositive(weightSum)) return fail("weights");

  const rows: WeightedRow[] = [];
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    const ratio = ratios[index];
    if (component === undefined || ratio === undefined) return fail("components");
    rows.push({
      index,
      percent: 100 * ratio,
      normalizedWeight: (100 * component.weight) / weightSum,
    });
  }

  const { totalPoints, targetPercent } = input;
  if (totalPoints !== undefined && !isPositive(totalPoints)) return fail("totalPoints");
  if (targetPercent !== undefined && !isInRange(targetPercent, 0, 100)) {
    return fail("targetPercent");
  }

  let requiredPoints: number | undefined;
  let targetOutcome: TargetOutcome | undefined;
  if (pending !== undefined && targetPercent !== undefined) {
    // From (Σ_{i≠t} w_i·r_i + w_t·a_t/m_t)/Σw = P/100.
    requiredPoints =
      (((targetPercent / 100) * weightSum - weightedRatio) * pending.max) / pending.weight;
    targetOutcome =
      requiredPoints < 0
        ? "alreadyMet"
        : requiredPoints > pending.max
          ? "unreachable"
          : "reachable";
  }

  return {
    ok: true,
    rows,
    totalPercent: (100 * weightedRatio) / weightSum,
    mappedPoints: totalPoints === undefined ? undefined : (totalPoints * weightedRatio) / weightSum,
    pendingWeight: pending === undefined ? undefined : (100 * pending.weight) / weightSum,
    requiredPoints,
    targetOutcome,
  };
}
