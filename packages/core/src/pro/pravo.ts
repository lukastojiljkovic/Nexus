/**
 * „Pravo i pravna praksa" — the arithmetic behind the toolkit's tools.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` explains:
 * a tool several packs share lives in the file of its FIRST pack in `TOOL_PACKS`
 * order, so ownership is a rule rather than a judgement call.
 *
 * **These are pure functions and they refuse rather than repair.** No clock, no
 * locale, no `Date` — every date is a plain `{ year, month, day }` and every
 * instant a caller wants is a parameter. That is what makes a deadline
 * reproducible on a machine whose time zone is not the user's, which is the one
 * defect a legal date calculator cannot survive.
 *
 * **Nothing here decides anything.** Every rate, every statutory fraction, every
 * ratio of credited days, every list of non-working dates and every tariff is an
 * INPUT with no default (`regulated` tier in `TOOL_CONSTANT_TIERS`) — the tool
 * would otherwise be asserting which rule applies to a case it has never seen.
 * What is embedded is only what cannot be revised by anybody: the proleptic
 * Gregorian calendar, the definition of an are, the published check-digit
 * arithmetic of the JMBG and of ISO 7064, and the paucal agreement of Serbian
 * numerals.
 *
 * **Rounding is a computation here, not a display choice.** An amortisation row
 * is built from a rounded instalment; a schedule computed at full precision and
 * rounded afterwards does not close on zero. So money is rounded half-up at two
 * decimals at the point the specification says it is, and rates are returned
 * unrounded because rounding them changes nothing but the screen.
 */

import {
  fail,
  isInRange,
  isIntegerIn,
  isNonNegative,
  isPositive,
  roundHalfUp,
  type ProResult,
} from "./result.js";

// ---------------------------------------------------------------------------
// Decimal arithmetic
//
// A double is binary and money is decimal, so `Math.round(x * 100) / 100` is
// wrong in exactly the cases that matter: `1.005 * 100` is 100.49999999999999
// and rounds DOWN. The two-decimal money rounding this file needs is the
// shared kit's `roundHalfUp`. What stays here is the exact BigInt conversion
// this file needs beyond that — cents, ten-thousandths of a square metre,
// ceiling divisions — built on the decimal the double PRINTS as, the shortest
// decimal that round-trips, which is the number the user typed.
// ---------------------------------------------------------------------------

/** A finite double as `digits × 10^exponent`, both exact. */
interface DecimalParts {
  readonly digits: bigint;
  readonly exponent: number;
}

/** The magnitude of `value` in the decimal it prints as. Sign is the caller's. */
function decimalParts(value: number): DecimalParts | undefined {
  if (!Number.isFinite(value)) return undefined;
  // `toExponential()` with no argument prints as many digits as are needed to
  // identify the double uniquely, and always in `d[.ddd]e±k` form.
  const [mantissa = "0", exponent = "0"] = Math.abs(value).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  return { digits: BigInt(digits), exponent: Number(exponent) - (digits.length - 1) };
}

/** `|value| × 10^decimals`, rounded half-up on the magnitude. */
function scaledMagnitude(value: number, decimals: number): bigint | undefined {
  const parts = decimalParts(value);
  if (parts === undefined) return undefined;
  const shift = parts.exponent + decimals;
  if (shift >= 0) return parts.digits * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  const quotient = parts.digits / divisor;
  const remainder = parts.digits % divisor;
  // Half-up on a non-negative magnitude; the sign is restored by the caller, so
  // −0.005 and +0.005 land the same distance from zero rather than the same
  // direction along the number line.
  return remainder * 2n >= divisor ? quotient + 1n : quotient;
}

/** Half-up on the magnitude, to a whole number. Used where the unit is a cent. */
function roundToInteger(value: number): number {
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value);
  return rounded === 0 ? 0 : rounded;
}

/** True when `value` needs no more than `decimals` places to be written exactly. */
function isExactAt(value: number, decimals: number): boolean {
  const parts = decimalParts(value);
  if (parts === undefined) return false;
  const shift = parts.exponent + decimals;
  return shift >= 0 || parts.digits % 10n ** BigInt(-shift) === 0n;
}

/**
 * How many decimal places `value` actually needs — 0 for an integer. Used to
 * pick a scale from what was typed rather than a fixed guess: a fixed scale
 * either rounds away a finer figure it did not expect or, when it is larger
 * than needed, costs nothing but a few extra zeros.
 */
function typedDecimals(value: number): number {
  const parts = decimalParts(value);
  if (parts === undefined || parts.exponent >= 0) return 0;
  return -parts.exponent;
}

/** Half-up division of non-negative BigInts — used where the unit is not 0.01. */
function halfUpDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

function gcdBig(a: bigint, b: bigint): bigint {
  let [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

/** Divide BEFORE multiplying, so the intermediate never grows without need. */
function lcmBig(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  return (a / gcdBig(a, b)) * b;
}

// ---------------------------------------------------------------------------
// Calendar
//
// Proleptic Gregorian, integer day numbers from 1970-01-01, after Howard
// Hinnant's `days_from_civil`. No `Date`, so no time zone can move a deadline
// across midnight, and no system clock, so the same inputs answer the same on
// every machine and in every year.
// ---------------------------------------------------------------------------

/** A calendar date with no time and no zone. Months and days are 1-based. */
export interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** ISO-8601 numbering: 1 = Monday … 7 = Sunday. Never a name — this is core. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Gregorian leap rule. Definitional to the calendar; nobody revises it. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return MONTH_LENGTHS[month - 1] ?? 0;
}

/** Days since 1970-01-01, negative before it. */
function daysFromCivil(date: CivilDate): number {
  const { year, month, day } = date;
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(days: number): CivilDate {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) / 365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  return { year: year + (month <= 2 ? 1 : 0), month, day };
}

/** 1970-01-01 was a Thursday; everything else follows from the day number. */
function weekdayOf(days: number): Weekday {
  return ((((days % 7) + 10) % 7) + 1) as Weekday;
}

/** Does this date exist at all — the check that is independent of every other. */
function dateExists(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** A usable calendar date inside the band every date tool here works in. */
function isCivilDate(date: CivilDate | undefined): date is CivilDate {
  if (date === undefined) return false;
  if (!isIntegerIn(date.year, 1600, 2400)) return false;
  return dateExists(date.year, date.month, date.day);
}

/**
 * Add whole months, keeping the day of the month where the target month has it
 * and falling back to that month's last day where it does not.
 *
 * That `min()` is what makes month arithmetic non-associative: +1 month twice
 * from 31 January is 28 March, +2 months once is 31 March. Every tool here that
 * adds months says so in its own doc comment, because it is the single thing a
 * reader gets wrong.
 */
function addMonths(date: CivilDate, months: number): CivilDate {
  const total = 12 * date.year + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/** Distinct day numbers of a user's list of dates, ignoring order and repeats. */
function dayNumberSet(dates: readonly CivilDate[]): Set<number> | undefined {
  const set = new Set<number>();
  for (const date of dates) {
    if (!isCivilDate(date)) return undefined;
    set.add(daysFromCivil(date));
  }
  return set;
}

function isWeekdaySet(weekdays: readonly Weekday[]): boolean {
  if (weekdays.length > 7) return false;
  return weekdays.every((day) => isIntegerIn(day, 1, 7));
}

// ---------------------------------------------------------------------------
// Anuitet i otplatni plan
// ---------------------------------------------------------------------------

/**
 * How a yearly rate becomes a rate per instalment period.
 *
 * `proportional` divides (`i = p/m`), `conformal` takes the m-th root
 * (`i = (1+p)^(1/m) − 1`). It is an input rather than an assumption because the
 * same principal, term and yearly rate give a different instalment under each,
 * and the difference is money.
 */
export type RateConversionMethod = "proportional" | "conformal";

/** Instalments per year. Not free-form: these are the periods that are used. */
export type PaymentFrequency = 1 | 2 | 4 | 12;

/**
 * Whether each instalment falls due at the end of its period (an ordinary
 * annuity) or at the start (an annuity due). The published closed form
 * `A = G·i/(1 − (1+i)^(−n))` holds only for `"end"`; `"start"` divides that by
 * one more factor of `(1 + i)`, because every payment then happens one period
 * earlier and so discounts one period less.
 */
export type PaymentTiming = "end" | "start";

export interface AnnuityInput {
  /** Amount borrowed, in currency units. */
  readonly principal: number;
  /** Nominal yearly rate as a percentage — a contractual figure, never ours. */
  readonly annualRatePercent: number;
  readonly instalments: number;
  readonly paymentsPerYear: PaymentFrequency;
  readonly conversion: RateConversionMethod;
  readonly dueTiming: PaymentTiming;
  /**
   * The first instalment's due date. Optional — without it the plan is still
   * complete, since every figure in it is money — but a schedule with no dates
   * cannot be checked against a single bank statement.
   */
  readonly firstInstalmentDate?: CivilDate | undefined;
}

export interface AnnuityRow {
  readonly index: number;
  /** The instalment actually paid — the last row carries the whole rounding. */
  readonly instalment: number;
  readonly interest: number;
  readonly principalPart: number;
  readonly balance: number;
  /** This row's due date, `paymentsPerYear` apart — undefined without `firstInstalmentDate`. */
  readonly date: CivilDate | undefined;
}

/**
 * Where two-decimal rounding could not show the balance shrinking.
 *
 * `otplataₖ ≤ 0` does not mean the debt is unrepayable: the geometric-series
 * identity that defines `A` guarantees `A` exceeds the interest on any
 * balance the schedule can reach, for every `i > −1`. At a large `n` and a
 * high rate the true excess can fall far below a cent, so `round2(A)` and
 * `round2(balance·i)` land on the same figure — this is that collision,
 * reported with the precision two decimals threw away, not a claim that the
 * loan cannot close.
 */
export interface AmortisationNotice {
  /** 1-based row where the collision was first seen. */
  readonly row: number;
  /** The unrounded level instalment `A` — not the two-decimal `A2` paid. */
  readonly exactInstalment: number;
  /** `A − balance·i` at that row, unrounded — strictly positive by identity. */
  readonly shortfall: number;
}

export interface AnnuityPlan {
  /** The rate per period the chosen conversion produced, as a fraction. */
  readonly periodicRate: number;
  /** The level instalment, rounded to two decimals — the figure the plan uses. */
  readonly instalment: number;
  readonly totalPaid: number;
  readonly totalInterest: number;
  readonly conversion: RateConversionMethod;
  readonly dueTiming: PaymentTiming;
  /**
   * The last row's actual instalment minus the level instalment — the one
   * figure that differs from the published rate, and the one a borrower who
   * reconciles the plan against a statement will ask about.
   */
  readonly lastInstalmentAdjustment: number;
  /** Set on the earliest row two-decimal rounding could not amortise; see above. */
  readonly amortisationNotice: AmortisationNotice | undefined;
  readonly rows: readonly AnnuityRow[];
}

/**
 * The level instalment and the whole amortisation schedule.
 *
 * **Two things a reader gets wrong.** First, a zero rate is not the general
 * formula with `i = 0` — the denominator `1 − (1+i)^(−n)` is then exactly zero,
 * so `A = G/n` is a separate branch and not an optimisation. Second, the
 * schedule is built from the ROUNDED instalment and the last row is forced to
 * repay whatever balance is left: that collects the entire rounding drift into
 * one visible instalment instead of smearing it across the plan, and it is why
 * the balance reaches 0.00 exactly rather than 0.004.
 *
 * The `-99 … 1000` band on the rate is not a taste: it is what keeps `1 + p`
 * positive, and the conformal m-th root is undefined without that.
 */
export function annuitySchedule(input: AnnuityInput): ProResult<AnnuityPlan> {
  const { principal, annualRatePercent, instalments, paymentsPerYear, conversion, dueTiming } =
    input;
  if (!isPositive(principal) || principal > 1e12) return fail("principal");
  if (!isInRange(annualRatePercent, -99, 1000)) return fail("annualRatePercent");
  if (!isIntegerIn(instalments, 1, 1200)) return fail("instalments");
  if (![1, 2, 4, 12].includes(paymentsPerYear)) return fail("paymentsPerYear");
  if (dueTiming !== "end" && dueTiming !== "start") return fail("dueTiming");
  const firstInstalmentDate = input.firstInstalmentDate;
  if (firstInstalmentDate !== undefined && !isCivilDate(firstInstalmentDate)) {
    return fail("firstInstalmentDate");
  }

  const yearly = annualRatePercent / 100;
  const periodicRate =
    conversion === "proportional"
      ? yearly / paymentsPerYear
      : (1 + yearly) ** (1 / paymentsPerYear) - 1;

  let instalmentExact: number;
  if (periodicRate === 0) {
    instalmentExact = principal / instalments;
  } else {
    const ordinary = (principal * periodicRate) / (1 - (1 + periodicRate) ** -instalments);
    // Paid at the START of the period, every instalment is one period earlier
    // than the published formula assumes, so it discounts one period less —
    // dividing by one more factor of (1+i) is that whole difference.
    instalmentExact = dueTiming === "end" ? ordinary : ordinary / (1 + periodicRate);
  }
  if (!Number.isFinite(instalmentExact)) return fail("annualRatePercent");

  const unit = 100;
  const instalmentCents = Number(scaledMagnitude(instalmentExact, 2) ?? 0n);
  const principalCents = Number(scaledMagnitude(principal, 2) ?? 0n);
  let balanceCents = principalCents;
  const rows: AnnuityRow[] = [];
  let paidCents = 0;
  let lastRowCents = instalmentCents;
  let amortisationNotice: AmortisationNotice | undefined;
  const monthsPerPeriod = 12 / paymentsPerYear;

  for (let index = 1; index <= instalments; index += 1) {
    const last = index === instalments;
    // In an annuity due the first payment happens BEFORE any period has
    // elapsed, so it carries no interest of its own — interest only starts
    // accruing on the balance it leaves behind.
    const interestCents =
      dueTiming === "start" && index === 1 ? 0 : roundToInteger(balanceCents * periodicRate);
    let principalPartCents = last ? balanceCents : instalmentCents - interestCents;
    // round2(A) landing at or below round2(balance·i) is two-decimal rounding
    // losing the exact excess, never proof the loan cannot close (see
    // `AmortisationNotice`). The row itself repays nothing visible, so its
    // principal part is clamped to zero rather than shown negative.
    if (!last && principalPartCents <= 0) {
      if (amortisationNotice === undefined) {
        amortisationNotice = {
          row: index,
          exactInstalment: instalmentExact,
          shortfall: instalmentExact - (balanceCents / unit) * periodicRate,
        };
      }
      principalPartCents = 0;
    }
    const rowCents = last ? principalPartCents + interestCents : instalmentCents;
    if (last) lastRowCents = rowCents;
    balanceCents -= principalPartCents;
    paidCents += rowCents;
    rows.push({
      index,
      instalment: rowCents / unit,
      interest: interestCents / unit,
      principalPart: principalPartCents / unit,
      balance: balanceCents / unit,
      date:
        firstInstalmentDate === undefined
          ? undefined
          : addMonths(firstInstalmentDate, monthsPerPeriod * (index - 1)),
    });
  }

  return {
    ok: true,
    periodicRate,
    instalment: instalmentCents / unit,
    totalPaid: paidCents / unit,
    totalInterest: (paidCents - principalCents) / unit,
    conversion,
    dueTiming,
    // Kept in integer cents so the difference is exact — subtracting two
    // already-divided doubles can miss 0.01 by a trailing 1e-14.
    lastInstalmentAdjustment: (lastRowCents - instalmentCents) / unit,
    amortisationNotice,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Iznos slovima
//
// The numeral words and the agreement classes are a `published` constant:
// Pravopis srpskoga jezika, Matica srpska, izmenjeno i dopunjeno izdanje (2010).
// They are data with a citation, not app copy — no currency table is embedded,
// and any unit other than the built-in dinar/para is typed in by the user,
// subunit count included: 100 is a fact about the dinar, not about currencies.
// ---------------------------------------------------------------------------

/** Grammatical gender of the noun a numeral agrees with. */
export type NounGender = "m" | "f";

/** The three forms a Serbian noun takes after a numeral, and its gender. */
export interface NounForms {
  /** Paucal class 1 — „jedan dinar". */
  readonly one: string;
  /** Paucal class 2 — „dva dinara". */
  readonly few: string;
  /** Paucal class 3 — „pet dinara". */
  readonly many: string;
  readonly gender: NounGender;
}

const ONES_MASCULINE = ["", "jedan", "dva", "tri", "četiri", "pet", "šest", "sedam", "osam",
  "devet"] as const;
const ONES_FEMININE = ["", "jedna", "dve", "tri", "četiri", "pet", "šest", "sedam", "osam",
  "devet"] as const;
const TEENS = ["deset", "jedanaest", "dvanaest", "trinaest", "četrnaest", "petnaest", "šesnaest",
  "sedamnaest", "osamnaest", "devetnaest"] as const;
const TENS = ["", "", "dvadeset", "trideset", "četrdeset", "pedeset", "šezdeset", "sedamdeset",
  "osamdeset", "devedeset"] as const;
const HUNDREDS = ["", "sto", "dvesta", "trista", "četiristo", "petsto", "šeststo", "sedamsto",
  "osamsto", "devetsto"] as const;

/** Long scale, as Serbian uses it: 10^9 is a milijarda, not a bilion. */
const SCALES: readonly NounForms[] = [
  { one: "hiljada", few: "hiljade", many: "hiljada", gender: "f" },
  { one: "milion", few: "miliona", many: "miliona", gender: "m" },
  { one: "milijarda", few: "milijarde", many: "milijardi", gender: "f" },
  { one: "bilion", few: "biliona", many: "biliona", gender: "m" },
];

const DINAR: NounForms = { one: "dinar", few: "dinara", many: "dinara", gender: "m" };
const PARA: NounForms = { one: "para", few: "pare", many: "para", gender: "f" };

/**
 * Which of the three noun forms a count takes.
 *
 * `t != 11` and `t ∉ {12,13,14}` are the whole reason the rule is not „look at
 * the last digit": 11 takes the same form as 5, not the same form as 1.
 */
function paucalForm(count: number, forms: NounForms): string {
  const tail = count % 100;
  const ones = count % 10;
  if (ones === 1 && tail !== 11) return forms.one;
  if (ones >= 2 && ones <= 4 && (tail < 12 || tail > 14)) return forms.few;
  return forms.many;
}

/** 0–999 in words, in the gender of the noun the group qualifies. */
function groupWords(value: number, gender: NounGender): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const hundredWord = HUNDREDS[hundreds] ?? "";
  if (hundredWord !== "") words.push(hundredWord);
  if (rest >= 10 && rest <= 19) {
    words.push(TEENS[rest - 10] ?? "");
    return words;
  }
  const tensWord = TENS[Math.floor(rest / 10)] ?? "";
  if (tensWord !== "") words.push(tensWord);
  const table = gender === "f" ? ONES_FEMININE : ONES_MASCULINE;
  const onesWord = table[rest % 10] ?? "";
  if (onesWord !== "") words.push(onesWord);
  return words;
}

/**
 * `whole,fraction` or `whole.fraction`, digits only, parsed off the STRING —
 * never through a JS number. `999999999999999,99` is inside the tool's own
 * declared range but becomes exactly `10^15` the instant it is a double, so
 * the one function in this file allowed to touch a `number` for this figure
 * is `Number()` on a single already-validated group of digits, never on the
 * whole amount.
 */
function parseTypedAmount(
  text: string,
): { readonly whole: bigint; readonly fraction: string } | undefined {
  const match = /^(0|[1-9][0-9]{0,14})(?:[,.]([0-9]{1,8}))?$/.exec(text);
  if (match === null) return undefined;
  const whole = match[1];
  if (whole === undefined) return undefined;
  return { whole: BigInt(whole), fraction: match[2] ?? "" };
}

/**
 * How many decimal places a subunit count implies: 100 → 2, 1000 → 3, 0 → the
 * currency has no subunit at all. Anything that is not a power of ten is
 * refused rather than guessed at.
 */
function decimalsFromSubUnits(subUnitsPerUnit: number): number | undefined {
  if (subUnitsPerUnit === 0) return 0;
  if (!Number.isInteger(subUnitsPerUnit) || subUnitsPerUnit < 1) return undefined;
  let remaining = subUnitsPerUnit;
  let decimals = 0;
  while (remaining > 1) {
    if (remaining % 10 !== 0) return undefined;
    remaining /= 10;
    decimals += 1;
  }
  return decimals;
}

/** `value × 10^decimals`, half-up, entirely in BigInt over the typed digits. */
function subunitTicks(whole: bigint, fraction: string, decimals: number): bigint {
  const digits = BigInt(`${whole.toString()}${fraction}`);
  const shift = decimals - fraction.length;
  if (shift >= 0) return digits * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  const quotient = digits / divisor;
  const remainder = digits % divisor;
  return remainder * 2n >= divisor ? quotient + 1n : quotient;
}

/** `ticks` (value × 10^decimals) back to a plain "whole.fraction" string. */
function formatTicks(ticks: bigint, decimals: number): string {
  if (decimals === 0) return ticks.toString();
  const unit = 10n ** BigInt(decimals);
  const whole = ticks / unit;
  const fraction = (ticks % unit).toString().padStart(decimals, "0");
  return `${whole.toString()}.${fraction}`;
}

/** The subunit count over its base, unreduced — "56/100", the way a cheque is written. */
export interface SubUnitFraction {
  readonly numerator: number;
  readonly denominator: number;
}

export interface AmountInWordsInput {
  /**
   * The amount exactly as typed, digits with a comma or dot decimal separator
   * (e.g. `"1234,56"`) — a STRING, never a `number`: see `parseTypedAmount`.
   */
  readonly amountText: string;
  /** Built-in dinar/para wording, or forms the user supplies. */
  readonly currency: "dinar" | "custom";
  readonly mainUnit?: NounForms | undefined;
  readonly subUnit?: NounForms | undefined;
  /**
   * Subunits per main unit, for `currency: "custom"` only — dinar/para fixes
   * this at 100 internally. This is a property of the CURRENCY (some have
   * 1000, some have none at all), never a physical constant, so it is never
   * assumed. Must be 0 (no subunit) or a power of ten.
   */
  readonly subUnitsPerUnit?: number | undefined;
  /** `joined` is the same word sequence with the spaces removed. */
  readonly style: "spaced" | "joined";
  readonly capitalise: boolean;
}

export interface AmountInWords {
  readonly words: string;
  /** Whole units actually converted, after any rounding carry. */
  readonly wholeUnits: bigint;
  /** Subunits actually converted — 0 when the currency has none. */
  readonly subUnits: number;
  /** The amount exactly as typed, as `"whole.fraction"` — echoed, not rounded. */
  readonly typedAmount: string;
  /** The value actually converted, as `"whole.fraction"` — differs from
   * `typedAmount` only when `rounded` is true. */
  readonly convertedAmount: string;
  /** True when the typed amount carried more fraction digits than the currency has. */
  readonly rounded: boolean;
  /** The subunit count as a fraction of its base — undefined when there is no subunit. */
  readonly subUnitFraction: SubUnitFraction | undefined;
}

/**
 * An amount written out in Serbian words, with the noun in the right form.
 *
 * **The exception a reader gets wrong:** a thousands group of exactly 1 is
 * „hiljadu", not „jedna hiljada" — but only when the group is exactly 1, so
 * 21 000 is „dvadeset jedna hiljada". Millions and above always write their 1.
 * A group whose value is zero is skipped WITH its scale, which is why 1 000 001
 * is „jedan milion jedan" and not „jedan milion nula hiljada jedan".
 *
 * The whole part is carried in BigInt because 10^15 does not survive a double.
 */
export function amountInWords(input: AmountInWordsInput): ProResult<AmountInWords> {
  const { currency, style, capitalise } = input;
  const parsed = parseTypedAmount(input.amountText);
  if (parsed === undefined) return fail("amountText");

  const main = currency === "dinar" ? DINAR : input.mainUnit;
  if (main === undefined || main.one === "" || main.few === "" || main.many === "") {
    return fail("mainUnit");
  }
  const decimals =
    currency === "dinar" ? 2 : decimalsFromSubUnits(input.subUnitsPerUnit ?? Number.NaN);
  if (decimals === undefined) return fail("subUnitsPerUnit");
  const sub = currency === "dinar" ? PARA : input.subUnit;
  if (decimals > 0 && (sub === undefined || sub.one === "" || sub.few === "" || sub.many === "")) {
    return fail("subUnit");
  }

  // The carry is the reason the split is not „truncate then round": 1,999
  // becomes 2 whole units and 0 hundredths, not 1 and 100.
  const ticks = subunitTicks(parsed.whole, parsed.fraction, decimals);
  const unit = 10n ** BigInt(decimals);
  const whole = ticks / unit;
  const fraction = decimals === 0 ? 0 : Number(ticks % unit);
  if (whole >= 10n ** 15n) return fail("amountText");

  const groups: number[] = [];
  let rest = whole;
  while (rest > 0n) {
    groups.push(Number(rest % 1000n));
    rest /= 1000n;
  }
  if (groups.length > SCALES.length + 1) return fail("amountText");

  const words: string[] = [];
  for (let index = groups.length - 1; index >= 1; index -= 1) {
    const value = groups[index] ?? 0;
    if (value === 0) continue;
    const scale = SCALES[index - 1];
    if (scale === undefined) return fail("amountText");
    if (index === 1 && value === 1) {
      words.push("hiljadu");
      continue;
    }
    words.push(...groupWords(value, scale.gender), paucalForm(value, scale));
  }
  const unitsGroup = groups[0] ?? 0;
  if (whole === 0n) words.push("nula");
  else if (unitsGroup > 0) words.push(...groupWords(unitsGroup, main.gender));
  words.push(paucalForm(Number(whole % 100n), main));

  if (decimals > 0 && sub !== undefined) {
    words.push("i");
    if (fraction === 0) words.push("nula");
    else words.push(...groupWords(fraction, sub.gender));
    words.push(paucalForm(fraction, sub));
  }

  const joined = words.join(style === "joined" ? "" : " ");
  const text = capitalise ? joined.charAt(0).toUpperCase() + joined.slice(1) : joined;

  // Extra fraction digits beyond `decimals` were rounded away only if at
  // least one of them is not itself a zero — "1234,5600" at 2 decimals is
  // exact, "1234,565" is not.
  const extraDigits = parsed.fraction.slice(decimals);
  const rounded = extraDigits.length > 0 && !/^0*$/.test(extraDigits);

  return {
    ok: true,
    words: text,
    wholeUnits: whole,
    subUnits: fraction,
    typedAmount: `${parsed.whole.toString()}${parsed.fraction === "" ? "" : `.${parsed.fraction}`}`,
    convertedAmount: formatTicks(ticks, decimals),
    rounded,
    subUnitFraction:
      decimals === 0 ? undefined : { numerator: fraction, denominator: Number(unit) },
  };
}

// ---------------------------------------------------------------------------
// Provera JMBG-a
//
// Published structure: 13 digits DD MM GGG RR BBB K, weights 7,6,5,4,3,2 twice
// over the first twelve, modulus 11. Arithmetic only — a matching check digit
// says the record agrees with its own checksum, not that the number was ever
// issued, nor to whom.
// ---------------------------------------------------------------------------

const JMBG_WEIGHTS = [7, 6, 5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

/** Which half of the sequence-number range the record falls in. */
export type JmbgSexRange = "male" | "female";

export interface JmbgInput {
  /** Free-form: spaces, hyphens and dots are stripped before anything else. */
  readonly digits: string;
  /** `check` wants 13 digits, `compute` derives the 13th from 12. */
  readonly mode: "check" | "compute";
}

export interface JmbgRecord {
  /** All thirteen digits, computed check digit included. */
  readonly digits: string;
  /** The weighted sum s. Printed because the tool shows its working. */
  readonly weightedSum: number;
  readonly remainder: number;
  /** m = 11 − (s mod 11). Shown raw: sources disagree about m = 10. */
  readonly m: number;
  readonly checkDigit: number;
  /** Whether the typed 13th digit equals the computed one; absent in `compute`. */
  readonly matches: boolean | undefined;
  readonly date: CivilDate;
  /** The date check is INDEPENDENT of the check digit — both are reported. */
  readonly dateExists: boolean;
  readonly weekday: Weekday | undefined;
  readonly region: number;
  readonly sequence: number;
  readonly sexRange: JmbgSexRange;
  /**
   * Which branch of the century rule produced `date.year` — 1000 for the
   * GGG ≥ 800 branch (1800–1999), 2000 otherwise (2000–2799). The conversion is
   * a convention of the record, not a fact it carries, and a low GGG can land in
   * the future (GGG = 700 → 2700) — this is what lets a reader see that rather
   * than trusting the year alone.
   */
  readonly centuryOffset: 1000 | 2000;
}

/**
 * The check digit of a JMBG, and everything the twelve digits before it encode.
 *
 * **The two answers are independent and both are returned.** A record can carry
 * a correct check digit and a date that does not exist — 29 February of a
 * non-leap year is the standard example — and collapsing that into one verdict
 * would hide the more informative half. `m = 10` maps to a check digit of 0 by
 * the rule this tool applies, and the raw `m` is returned so a reader can see
 * which branch was taken rather than trusting it.
 *
 * **Normalisation strips a Unicode CLASS, not three literal characters.** A
 * JMBG pasted out of a PDF carries a non-breaking space or an en dash where a
 * plain space or hyphen would be, and those are different code points from
 * `" "` and `"-"` — stripping only the literal three would reject a correct
 * number as "not all digits". NFKC first, then every `White_Space` and every
 * `Dash_Punctuation` code point, plus the ASCII dot this record is also typed
 * with.
 */
export function jmbgRecord(input: JmbgInput): ProResult<JmbgRecord> {
  const normalised = input.digits.normalize("NFKC");
  const cleaned = normalised.replace(/[\p{White_Space}\p{Dash_Punctuation}.]/gu, "");
  if (!/^[0-9]+$/.test(cleaned)) return fail("digits");
  const expected = input.mode === "check" ? 13 : 12;
  if (cleaned.length !== expected) return fail("digits");

  let weightedSum = 0;
  for (let index = 0; index < 12; index += 1) {
    weightedSum += (JMBG_WEIGHTS[index] ?? 0) * Number(cleaned.charAt(index));
  }
  const remainder = weightedSum % 11;
  const m = 11 - remainder;
  const checkDigit = m >= 1 && m <= 9 ? m : 0;

  const day = Number(cleaned.slice(0, 2));
  const month = Number(cleaned.slice(2, 4));
  const yearDigits = Number(cleaned.slice(4, 7));
  // 800 and above is the 1800–1999 window; below it, 2000–2799.
  const centuryOffset: 1000 | 2000 = yearDigits >= 800 ? 1000 : 2000;
  const year = centuryOffset + yearDigits;
  const exists = dateExists(year, month, day);
  const region = Number(cleaned.slice(7, 9));
  const sequence = Number(cleaned.slice(9, 12));

  return {
    ok: true,
    digits: input.mode === "check" ? cleaned : `${cleaned}${checkDigit}`,
    weightedSum,
    remainder,
    m,
    checkDigit,
    matches: input.mode === "check" ? Number(cleaned.charAt(12)) === checkDigit : undefined,
    date: { year, month, day },
    dateExists: exists,
    weekday: exists ? weekdayOf(daysFromCivil({ year, month, day })) : undefined,
    region,
    sequence,
    // A property of the number's range, not an assertion about a person.
    sexRange: sequence <= 499 ? "male" : "female",
    centuryOffset,
  };
}

// ---------------------------------------------------------------------------
// Katastarska površina
//
// 1 a = 100 m², 1 ha = 10 000 m². Definitional: the are is the square of a ten
// metre side and cannot be revised.
// ---------------------------------------------------------------------------

/** Ten-thousandths of a square metre — the integer everything is computed in. */
const TENTHOUSANDTHS_PER_M2 = 10000n;
const TENTHOUSANDTHS_PER_ARE = 1000000n;
const TENTHOUSANDTHS_PER_HECTARE = 100000000n;

export interface CadastralAreaInput {
  readonly direction: "toParts" | "toSquareMetres";
  /** For `toParts`: the area in m², at most four decimals. */
  readonly squareMetres?: number | undefined;
  /** For `toSquareMetres`: whole hectares, whole ares, and the m² remainder. */
  readonly hectares?: number | undefined;
  readonly ares?: number | undefined;
  readonly remainderSquareMetres?: number | undefined;
}

export interface CadastralArea {
  readonly hectares: number;
  readonly ares: number;
  /** The m² remainder of the normalised record, to four decimals. */
  readonly remainderSquareMetres: number;
  readonly totalSquareMetres: number;
  /** True when the typed record was not normalised (ares > 99, or m² ≥ 100). */
  readonly wasNormalised: boolean;
  /** True when the typed m² carried more than four decimals. */
  readonly rounded: boolean;
}

/**
 * Hectares, ares and square metres, in either direction.
 *
 * The whole computation runs in ten-thousandths of a square metre as integers,
 * for one reason: a `floor` over a binary double turns 4823.75 m² into 48 a and
 * 23.7499 m². The decimal has to survive the split, so the split is done on an
 * integer and the decimal lives in the remainder.
 */
export function cadastralArea(input: CadastralAreaInput): ProResult<CadastralArea> {
  let total: bigint;
  let wasNormalised = false;
  // No initialiser: both directions assign it, and a `false` here would be a
  // default nothing ever reads — the shape that hides a branch which forgot to.
  let rounded: boolean;

  if (input.direction === "toParts") {
    const value = input.squareMetres;
    if (value === undefined || !isNonNegative(value) || value > 1e10) return fail("squareMetres");
    const scaled = scaledMagnitude(value, 4);
    if (scaled === undefined) return fail("squareMetres");
    total = scaled;
    rounded = !isExactAt(value, 4);
  } else {
    const { hectares, ares, remainderSquareMetres } = input;
    if (hectares === undefined || !isIntegerIn(hectares, 0, 1e6)) return fail("hectares");
    if (ares === undefined || !isIntegerIn(ares, 0, 1e8)) return fail("ares");
    if (remainderSquareMetres === undefined || !isNonNegative(remainderSquareMetres) ||
      remainderSquareMetres > 1e10) {
      return fail("remainderSquareMetres");
    }
    const scaled = scaledMagnitude(remainderSquareMetres, 4);
    if (scaled === undefined) return fail("remainderSquareMetres");
    total = BigInt(hectares) * TENTHOUSANDTHS_PER_HECTARE +
      BigInt(ares) * TENTHOUSANDTHS_PER_ARE + scaled;
    // Not refused — an unnormalised record is a legitimate way to type it, and
    // the normalised form is part of the answer.
    wasNormalised = ares > 99 || scaled >= TENTHOUSANDTHS_PER_ARE;
    rounded = !isExactAt(remainderSquareMetres, 4);
  }

  const hectares = total / TENTHOUSANDTHS_PER_HECTARE;
  const afterHectares = total % TENTHOUSANDTHS_PER_HECTARE;
  const ares = afterHectares / TENTHOUSANDTHS_PER_ARE;
  const afterAres = afterHectares % TENTHOUSANDTHS_PER_ARE;
  const totalSquareMetres = Number(total) / Number(TENTHOUSANDTHS_PER_M2);

  return {
    ok: true,
    hectares: Number(hectares),
    ares: Number(ares),
    remainderSquareMetres: Number(afterAres) / Number(TENTHOUSANDTHS_PER_M2),
    totalSquareMetres,
    wasNormalised,
    rounded,
  };
}

// ---------------------------------------------------------------------------
// Kazna i uračunavanje
// ---------------------------------------------------------------------------

/** A fraction of the term the user types; nothing here is prescribed. */
export interface TermFraction {
  readonly numerator: number;
  readonly denominator: number;
}

export interface SentenceTermInput {
  readonly startDate: CivilDate;
  readonly years: number;
  readonly months: number;
  readonly days: number;
  /** Days of deprivation of liberty being deducted. */
  readonly creditedDays: number;
  /** How many days of the term one credited day removes. Statutory: an input. */
  readonly creditRatio: number;
  /** Whether the first day counts. A counting convention, so also an input. */
  readonly countFirstDay: boolean;
  readonly fraction?: TermFraction | undefined;
}

export interface SentenceTerm {
  /** The calendar end of the term, before the inclusive-counting adjustment. */
  readonly endDate: CivilDate;
  readonly lastDay: CivilDate;
  readonly lastDayWeekday: Weekday;
  readonly totalDays: number;
  /** creditedDays × creditRatio, unrounded — shown next to the floored figure. */
  readonly exactCredit: number;
  readonly creditedDaysApplied: number;
  /** True when the credited days cover the whole term; no date is then given. */
  readonly coversWholeTerm: boolean;
  readonly dateAfterCredit: CivilDate | undefined;
  readonly dateAfterCreditWeekday: Weekday | undefined;
  readonly fractionDays: number | undefined;
  readonly fractionDate: CivilDate | undefined;
  readonly fractionWeekday: Weekday | undefined;
  readonly remainingDays: number | undefined;
}

/**
 * Where a term of years, months and days ends, what the credited days move, and
 * on what date a fraction of the term falls.
 *
 * **The `−1` is the whole difference between the two counting conventions.** If
 * the first day counts, a one-day term beginning 15 January expires on 15
 * January, so the last day is the calendar end minus one. That is a convention a
 * procedure sets, not arithmetic, which is why `countFirstDay` has no default.
 *
 * The fraction is rounded UP in whole days — part of a day is not served — and
 * the deducted days shorten both sides, so `remainingDays` equals
 * `totalDays − fractionDays` by construction. If that identity ever fails, the
 * implementation is wrong.
 */
export function sentenceTerm(input: SentenceTermInput): ProResult<SentenceTerm> {
  const { startDate, years, months, days, creditedDays, creditRatio, countFirstDay } = input;
  if (!isCivilDate(startDate)) return fail("startDate");
  if (!isIntegerIn(years, 0, 100)) return fail("years");
  if (!isIntegerIn(months, 0, 1200)) return fail("months");
  if (!isIntegerIn(days, 0, 36500)) return fail("days");
  if (!isIntegerIn(creditedDays, 0, 1e7)) return fail("creditedDays");
  if (!isPositive(creditRatio) || creditRatio > 1e4) return fail("creditRatio");

  const start = daysFromCivil(startDate);
  const endDate = civilFromDays(daysFromCivil(addMonths(startDate, years * 12 + months)) + days);
  const end = daysFromCivil(endDate);
  const lastDay = end - (countFirstDay ? 1 : 0);
  const totalDays = lastDay - start + (countFirstDay ? 1 : 0);

  const exactCredit = creditedDays * creditRatio;
  const creditedDaysApplied = Math.floor(exactCredit);
  const coversWholeTerm = creditedDaysApplied >= totalDays;
  const afterCredit = lastDay - creditedDaysApplied;

  let fractionDays: number | undefined;
  if (input.fraction !== undefined) {
    const { numerator, denominator } = input.fraction;
    if (!isIntegerIn(numerator, 0, 1e6)) return fail("fraction");
    if (!isIntegerIn(denominator, 1, 1e6)) return fail("fraction");
    // A fraction above one would place the date past the end of the term.
    if (numerator > denominator) return fail("fraction");
    // ceil(U·b/i) over integers, so no decimal is rounded on the way.
    fractionDays = Math.floor((totalDays * numerator + denominator - 1) / denominator);
  }

  if (coversWholeTerm) {
    return {
      ok: true,
      endDate,
      lastDay: civilFromDays(lastDay),
      lastDayWeekday: weekdayOf(lastDay),
      totalDays,
      exactCredit,
      creditedDaysApplied,
      coversWholeTerm,
      dateAfterCredit: undefined,
      dateAfterCreditWeekday: undefined,
      fractionDays,
      fractionDate: undefined,
      fractionWeekday: undefined,
      remainingDays: undefined,
    };
  }

  const fractionDay =
    fractionDays === undefined
      ? undefined
      : start + fractionDays - (countFirstDay ? 1 : 0) - creditedDaysApplied;

  return {
    ok: true,
    endDate,
    lastDay: civilFromDays(lastDay),
    lastDayWeekday: weekdayOf(lastDay),
    totalDays,
    exactCredit,
    creditedDaysApplied,
    coversWholeTerm,
    dateAfterCredit: civilFromDays(afterCredit),
    dateAfterCreditWeekday: weekdayOf(afterCredit),
    fractionDays,
    fractionDate: fractionDay === undefined ? undefined : civilFromDays(fractionDay),
    fractionWeekday: fractionDay === undefined ? undefined : weekdayOf(fractionDay),
    remainingDays: fractionDay === undefined ? undefined : afterCredit - fractionDay,
  };
}

// ---------------------------------------------------------------------------
// Nominalna i efektivna stopa
// ---------------------------------------------------------------------------

export type RateDirection =
  | "nominalToEffective"
  | "effectiveToNominal"
  | "effectiveToPeriodic"
  /**
   * Nominal at one compounding frequency to nominal at another, via the
   * effective rate — comparing two offers quoted at different frequencies is
   * the one reason this tool gets opened, and doing it as two separate calls
   * means hand-copying the intermediate effective rate between them.
   */
  | "nominalAtM1ToNominalAtM2";

export interface RateConversionInput {
  readonly direction: RateDirection;
  /** The yearly rate being converted, as a percentage. Always the user's. */
  readonly ratePercent: number;
  /** m1 in every direction; m2 only matters for `nominalAtM1ToNominalAtM2`. */
  readonly compoundingsPerYear: number;
  /** The SECOND frequency. Required only for `nominalAtM1ToNominalAtM2`. */
  readonly targetCompoundingsPerYear?: number | undefined;
}

export interface RateConversionResult {
  /** The rate asked for, as a percentage: effective, nominal, periodic, or the
   * nominal at m2, depending on `direction`. */
  readonly resultPercent: number;
  /** The rate of one compounding period, as a percentage. */
  readonly periodicPercent: number;
  /**
   * Which formula `periodicPercent` is: `p/m` (`proportional`, when the input
   * was nominal) or the conformal m-th root (when it was effective). The same
   * printed number is a different quantity depending on which ran, so it is
   * named rather than left for the reader to infer from the direction.
   */
  readonly periodicKind: "proportional" | "conformal";
  /** 1 + effective — what one unit grows to over a year. */
  readonly growthFactor: number;
  /** The effective yearly rate every direction passes through, as a percentage. */
  readonly effectivePercent: number;
  /**
   * The m → ∞ bound, as a percentage — and it is NOT the same expression in
   * every direction. Holding a NOMINAL rate fixed and raising `m`, the
   * effective rate rises toward `e^p − 1`; that is the bound for
   * `nominalToEffective`. Holding the EFFECTIVE rate fixed instead — the other
   * three directions — raising `m` sends the nominal rate toward `ln(1+e)`,
   * a different limit entirely: `e^p − 1` is not a lower bound for negative p
   * either, it is the ceiling in both signs, approached from below.
   */
  readonly continuousPercent: number;
}

/**
 * Nominal ↔ effective ↔ periodic, all three of which are the same identity read
 * in different directions, plus nominal-to-nominal across two frequencies.
 *
 * The periodic rate is `p/m` when converting FROM a nominal rate and the m-th
 * root when converting from an effective one — that asymmetry is the definition
 * of the two rates, not a rounding choice. The `-99` floor on the input is what
 * keeps `1 + p/m` and `1 + e` positive; a real m-th root does not exist below
 * it, and the tool refuses rather than returning `NaN`.
 */
export function rateConversion(input: RateConversionInput): ProResult<RateConversionResult> {
  const { direction, ratePercent, compoundingsPerYear: m } = input;
  if (!isInRange(ratePercent, -99, 1000)) return fail("ratePercent");
  if (!isIntegerIn(m, 1, 366)) return fail("compoundingsPerYear");

  const rate = ratePercent / 100;
  let nominal: number;
  let effective: number;
  let periodic: number;
  let periodicKind: "proportional" | "conformal";

  if (direction === "nominalToEffective" || direction === "nominalAtM1ToNominalAtM2") {
    nominal = rate;
    periodic = rate / m;
    effective = (1 + periodic) ** m - 1;
    periodicKind = "proportional";
  } else {
    effective = rate;
    periodic = (1 + rate) ** (1 / m) - 1;
    nominal = m * periodic;
    periodicKind = "conformal";
  }
  if (!Number.isFinite(effective) || !Number.isFinite(periodic)) return fail("ratePercent");

  let resultPercent: number;
  let resultPeriodicPercent = periodic * 100;
  let resultPeriodicKind = periodicKind;
  if (direction === "nominalToEffective") {
    resultPercent = effective * 100;
  } else if (direction === "effectiveToNominal") {
    resultPercent = nominal * 100;
  } else if (direction === "effectiveToPeriodic") {
    resultPercent = periodic * 100;
  } else {
    const m2 = input.targetCompoundingsPerYear;
    if (m2 === undefined || !isIntegerIn(m2, 1, 366)) return fail("targetCompoundingsPerYear");
    const periodic2 = (1 + effective) ** (1 / m2) - 1;
    if (!Number.isFinite(periodic2)) return fail("ratePercent");
    resultPercent = m2 * periodic2 * 100;
    resultPeriodicPercent = periodic2 * 100;
    resultPeriodicKind = "conformal";
  }

  return {
    ok: true,
    resultPercent,
    periodicPercent: resultPeriodicPercent,
    periodicKind: resultPeriodicKind,
    growthFactor: 1 + effective,
    effectivePercent: effective * 100,
    continuousPercent:
      direction === "nominalToEffective"
        ? (Math.exp(nominal) - 1) * 100
        : Math.log(1 + effective) * 100,
  };
}

// ---------------------------------------------------------------------------
// Obračun kamate
// ---------------------------------------------------------------------------

/** One row of the user's rate table: a rate that applies from a date onward. */
export interface RatePeriod {
  readonly from: CivilDate;
  readonly annualRatePercent: number;
}

export type InterestMethod = "conformal" | "proportional";
/** 365, 366, or the length of the calendar year the segment lies in. */
export type DayBasis = 365 | 366 | "actual";

export interface InterestAccrualInput {
  readonly principal: number;
  /** Every rate is typed in; the tool ships none, not even a default of zero. */
  readonly rates: readonly RatePeriod[];
  readonly from: CivilDate;
  readonly to: CivilDate;
  readonly method: InterestMethod;
  readonly dayBasis: DayBasis;
  readonly capitalisation: "none" | "annual";
  /**
   * Where a capitalisation year ends — 1 January, or the anniversary of `from`.
   * No contract writes "1 January" and the choice changes the amount, so it is
   * asked rather than assumed. Required only when `capitalisation` is
   * `"annual"`.
   */
  readonly capitalisationBoundary?: "calendarYear" | "anniversaryOfStart" | undefined;
  readonly includeLastDay: boolean;
}

export interface InterestSegment {
  readonly from: CivilDate;
  readonly to: CivilDate;
  readonly days: number;
  readonly annualRatePercent: number;
  readonly basisDays: number;
  /** The balance the segment accrued on — it moves only under capitalisation. */
  readonly balance: number;
  /** Unrounded, so a reader can see that the sum of segments is not the sum of
   * their rounded displays. */
  readonly interest: number;
}

/** Interest claimed and booked over one calendar year — never a compounding step. */
export interface InterestYearTotal {
  readonly year: number;
  readonly days: number;
  /** Unrounded, same as `InterestSegment.interest` — the segments it sums. */
  readonly interest: number;
}

export interface InterestAccrual {
  readonly totalInterest: number;
  readonly principalPlusInterest: number;
  readonly totalDays: number;
  readonly segments: readonly InterestSegment[];
  /** Rate rows that start after the end of the period and were left out. */
  readonly ignoredRows: number;
  /**
   * The same interest, grouped by calendar year — because it is claimed and
   * booked by year, and the segment table alone does not answer that when the
   * rate changes inside a year. Independent of `capitalisationBoundary`: this
   * grouping is always by 1 January, whichever boundary capitalisation uses.
   */
  readonly yearlyBreakdown: readonly InterestYearTotal[];
}

/**
 * Interest from date to date, over the user's own table of rates.
 *
 * **The time axis is cut, not sampled.** A boundary is placed at every rate
 * change inside the period and — when the basis is the actual year length or
 * interest capitalises yearly — at every 1 January, so that each segment lies
 * inside one calendar year and its basis is unambiguous. Inclusive counting is
 * handled by moving the END one day, not by adding a day to the last segment:
 * that keeps every segment half-open and removes the only place the two rules
 * could disagree.
 *
 * Rounding happens once, at the end. The first rate row must start on or before
 * the beginning of the period — a gap is refused rather than filled with a rate
 * nobody typed.
 */
/** 1 January boundaries strictly inside `[start, end)` — used by `yearSlices`. */
function calendarYearCuts(start: number, end: number): readonly number[] {
  const boundaries: number[] = [];
  const firstYear = civilFromDays(start).year;
  const lastYear = civilFromDays(end).year;
  for (let year = firstYear + 1; year <= lastYear; year += 1) {
    const boundary = daysFromCivil({ year, month: 1, day: 1 });
    if (boundary > start && boundary < end) boundaries.push(boundary);
  }
  return boundaries;
}

/**
 * A segment's interest, attributed to the calendar year(s) it falls in —
 * WITHOUT cutting the segment itself, which stays exactly as computed.
 *
 * A slice's share is the DIFFERENCE of the cumulative interest at its two
 * ends, `G·((1+p)^(dₖ/B) − 1) − G·((1+p)^(dₖ₋₁/B) − 1)`, never a `days`
 * proportion of the total: with compounding, two segments over an unchanged
 * balance yield less than one segment over the combined days, so only the
 * cumulative difference sums back to the segment's own figure. For the
 * proportional method the two forms agree exactly, since it is linear in days.
 */
function yearSlices(
  segmentStart: number,
  segmentEnd: number,
  balance: number,
  decimal: number,
  basis: number,
  method: InterestMethod,
): readonly InterestYearTotal[] {
  const cuts = [segmentStart, ...calendarYearCuts(segmentStart, segmentEnd), segmentEnd];
  const slices: InterestYearTotal[] = [];
  let cumulativePrev = 0;
  for (let index = 0; index + 1 < cuts.length; index += 1) {
    const sliceStart = cuts[index];
    const sliceEnd = cuts[index + 1];
    if (sliceStart === undefined || sliceEnd === undefined) continue;
    const cumulativeDays = sliceEnd - segmentStart;
    const cumulative =
      method === "conformal"
        ? balance * ((1 + decimal) ** (cumulativeDays / basis) - 1)
        : (balance * decimal * cumulativeDays) / basis;
    slices.push({
      year: civilFromDays(sliceStart).year,
      days: sliceEnd - sliceStart,
      interest: cumulative - cumulativePrev,
    });
    cumulativePrev = cumulative;
  }
  return slices;
}

export function interestAccrual(input: InterestAccrualInput): ProResult<InterestAccrual> {
  const { principal, rates, from, to, method, dayBasis, capitalisation, includeLastDay } = input;
  if (!isPositive(principal) || principal > 1e12) return fail("principal");
  if (!isCivilDate(from)) return fail("from");
  if (!isCivilDate(to)) return fail("to");
  if (rates.length < 1 || rates.length > 50) return fail("rates");
  if (dayBasis !== 365 && dayBasis !== 366 && dayBasis !== "actual") return fail("dayBasis");
  if (capitalisation === "annual" && input.capitalisationBoundary === undefined) {
    return fail("capitalisationBoundary");
  }

  const rows: { readonly day: number; readonly rate: number }[] = [];
  for (const row of rates) {
    if (!isCivilDate(row.from)) return fail("rates");
    // −100 % and below makes (1 + p) non-positive and the conformal power
    // undefined over the reals; the band is what keeps it defined.
    if (!isInRange(row.annualRatePercent, -99, 1000)) return fail("rate");
    rows.push({ day: daysFromCivil(row.from), rate: row.annualRatePercent });
  }
  rows.sort((a, b) => a.day - b.day);

  const start = daysFromCivil(from);
  const finish = daysFromCivil(to);
  if (finish < start) return fail("to");
  const end = finish + (includeLastDay ? 1 : 0);

  const firstRow = rows[0];
  if (firstRow === undefined || firstRow.day > start) return fail("rates");
  // A row exactly ON `end` is neither applied (a cut needs day < end) nor, with
  // the old `> finish` test, ever counted as left out when `includeLastDay` is
  // false and `end === finish` — it fell through both. `>= end` closes that.
  const ignoredRows = rows.filter((row) => row.day >= end).length;

  // 1 January cuts are added to the SEGMENT table only when the spec asks for
  // them — `dayBasis === "actual"` needs one to know which basis applies, and
  // `capitalisation === "annual"` needs one to book at the year end. Outside
  // that, cutting here would change the conformal total: two compounding
  // segments over an unchanged balance yield LESS interest than one segment
  // over the combined days, so a cut the user's inputs never asked for is not
  // neutral. `yearlyBreakdown` still wants a per-year figure regardless, so it
  // is computed by `yearSlices` below from the SAME uncut segment, by splitting
  // its cumulative interest — never by cutting the segment itself.
  const calendarYearBoundaries: number[] = [];
  {
    const firstYear = civilFromDays(start).year;
    const lastYear = civilFromDays(end).year;
    for (let year = firstYear + 1; year <= lastYear; year += 1) {
      const boundary = daysFromCivil({ year, month: 1, day: 1 });
      if (boundary > start && boundary < end) calendarYearBoundaries.push(boundary);
    }
  }

  // Where capitalisation actually happens — a DIFFERENT axis from the one
  // above whenever the boundary is the anniversary of `from` rather than
  // 1 January, so the two are kept as separate sets rather than one.
  const capBoundaries = new Set<number>();
  if (capitalisation === "annual") {
    if (input.capitalisationBoundary === "calendarYear") {
      for (const boundary of calendarYearBoundaries) capBoundaries.add(boundary);
    } else {
      for (let k = 1; ; k += 1) {
        const boundary = daysFromCivil(addMonths(from, 12 * k));
        if (boundary >= end) break;
        if (boundary > start) capBoundaries.add(boundary);
      }
    }
  }

  // Only `dayBasis === "actual"` still earns a 1 January cut here: it needs
  // one to know which basis (365 or 366) applies on each side. Capitalisation
  // no longer does — its OWN boundaries are already in `capBoundaries`, added
  // above, and those are a calendar-year cut only when `capitalisationBoundary`
  // says so. Cutting at every 1 January regardless (the old `||
  // capitalisation === "annual"`) inserted a boundary the anniversary
  // convention never asked for: with `capitalisationBoundary:
  // "anniversaryOfStart"`, a 1 January that falls inside a still-open
  // compounding period is not a capitalisation point, and splitting an
  // uncompensated segment there is exactly the non-neutral cut the comment
  // above `calendarYearBoundaries` warns about.
  const boundaries = new Set<number>([start, end, ...capBoundaries]);
  if (dayBasis === "actual") {
    for (const boundary of calendarYearBoundaries) boundaries.add(boundary);
  }
  for (const row of rows) {
    if (row.day > start && row.day < end) boundaries.add(row.day);
  }
  const cuts = [...boundaries].sort((a, b) => a - b);

  const segments: InterestSegment[] = [];
  let balance = principal;
  let yearInterest = 0;
  let total = 0;
  let totalDays = 0;

  for (let index = 0; index + 1 < cuts.length; index += 1) {
    const segmentStart = cuts[index];
    const segmentEnd = cuts[index + 1];
    if (segmentStart === undefined || segmentEnd === undefined) continue;
    const days = segmentEnd - segmentStart;
    if (days <= 0) continue;
    if (capitalisation === "annual" && capBoundaries.has(segmentStart)) {
      // Capitalised interest is BOOKED onto the balance, so it is rounded to
      // the currency here, before it starts earning interest of its own — and
      // `total` books the SAME rounded figure, so a reader who adds up the
      // segment table's own booked years reaches `totalInterest` exactly. Only
      // the final, not-yet-capitalised tail (added once after the loop, below)
      // stays unrounded until the one rounding the review scopes to
      // `capitalisation: "none"`.
      const booked = roundHalfUp(yearInterest, 2);
      balance += booked;
      total += booked;
      yearInterest = 0;
    }
    const startDate = civilFromDays(segmentStart);
    let rate = firstRow.rate;
    for (const row of rows) if (row.day <= segmentStart) rate = row.rate;
    const basis = dayBasis === "actual" ? (isLeapYear(startDate.year) ? 366 : 365) : dayBasis;
    const decimal = rate / 100;
    const interest =
      method === "conformal"
        ? balance * ((1 + decimal) ** (days / basis) - 1)
        : (balance * decimal * days) / basis;
    segments.push({
      from: startDate,
      to: civilFromDays(segmentEnd),
      days,
      annualRatePercent: rate,
      basisDays: basis,
      balance,
      interest,
    });
    yearInterest += interest;
    totalDays += days;
  }
  // The final capitalisation period never reaches its own boundary, so it is
  // added here, unrounded — the "unbooked tail" `total` is built from. When
  // capitalisation is "none" this is the ONLY addition `total` ever gets, over
  // every segment at once — the review's "rounded once, at the end" rule.
  total += yearInterest;

  const byYear = new Map<number, { days: number; interest: number }>();
  for (const segment of segments) {
    const decimal = segment.annualRatePercent / 100;
    const slices = yearSlices(
      daysFromCivil(segment.from),
      daysFromCivil(segment.to),
      segment.balance,
      decimal,
      segment.basisDays,
      method,
    );
    for (const slice of slices) {
      const entry = byYear.get(slice.year) ?? { days: 0, interest: 0 };
      entry.days += slice.days;
      entry.interest += slice.interest;
      byYear.set(slice.year, entry);
    }
  }
  const yearlyBreakdown = [...byYear.entries()]
    .sort(([left], [right]) => left - right)
    .map(([year, entry]) => ({ year, days: entry.days, interest: entry.interest }));

  const totalInterest = roundHalfUp(total, 2);
  return {
    ok: true,
    totalInterest,
    principalPlusInterest: roundHalfUp(principal + total, 2),
    totalDays,
    segments,
    ignoredRows,
    yearlyBreakdown,
  };
}

// ---------------------------------------------------------------------------
// Podela iznosa
// ---------------------------------------------------------------------------

/** A weight in whichever of the three notations the user typed it. */
export type SplitWeight =
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "percent"; readonly value: number }
  | { readonly kind: "fraction"; readonly numerator: number; readonly denominator: number };

/** The smallest amount that may be allocated: a hundredth, a unit, a hundred. */
export type SplitUnit = 0.01 | 1 | 100;

export interface SplitAmountInput {
  readonly totalAmount: number;
  readonly weights: readonly SplitWeight[];
  readonly smallestUnit: SplitUnit;
  /** Which share gets the leftover unit — two rules, two different outputs. */
  readonly remainderRule: "largestRemainder" | "firstFirst";
}

export interface SplitShare {
  readonly index: number;
  /** Whole allocation units — the amount divided by `smallestUnit`. */
  readonly units: number;
  readonly amount: number;
  /** The unrounded proportional share, for the deviation column. */
  readonly exactAmount: number;
  readonly gotRemainderUnit: boolean;
  readonly deviation: number;
}

export interface SplitAmountResult {
  readonly shares: readonly SplitShare[];
  /** The sum of the shares. Equal to the total by construction, shown anyway. */
  readonly checksum: number;
  /** The amount actually distributed: `N × smallestUnit`. */
  readonly total: number;
  /** What was typed in, unchanged — the other half of `roundingDifference`. */
  readonly totalAmountEntered: number;
  /**
   * `total − totalAmountEntered`. Zero whenever `smallestUnit` is 0.01, because
   * then `N × 0.01` reconstructs the typed amount exactly; at a coarser unit
   * (1 or 100) "the shares add up to the whole" is only true of `total`, and
   * this is how far that whole sits from the amount actually typed in.
   */
  readonly roundingDifference: number;
  readonly remainderUnits: number;
  readonly rule: "largestRemainder" | "firstFirst";
}

function weightFraction(weight: SplitWeight): { p: bigint; q: bigint } | undefined {
  let p: bigint;
  let q: bigint;
  if (weight.kind === "fraction") {
    if (!isIntegerIn(weight.numerator, 0, 1e12)) return undefined;
    if (!isIntegerIn(weight.denominator, 1, 1e12)) return undefined;
    p = BigInt(weight.numerator);
    q = BigInt(weight.denominator);
  } else {
    if (!isNonNegative(weight.value) || weight.value > 1e12) return undefined;
    const parts = decimalParts(weight.value);
    if (parts === undefined) return undefined;
    p = parts.digits;
    q = 1n;
    if (parts.exponent >= 0) p *= 10n ** BigInt(parts.exponent);
    else q = 10n ** BigInt(-parts.exponent);
    if (weight.kind === "percent") q *= 100n;
  }
  const divisor = gcdBig(p, q);
  return divisor === 0n ? { p: 0n, q: 1n } : { p: p / divisor, q: q / divisor };
}

/**
 * An amount split by weights so the parts add up to the whole, to the last
 * hundredth.
 *
 * **The weights are reduced to a common denominator FIRST**, because the input
 * mixes three notations and 1/3 : 25 % : 1 only becomes comparable once it is
 * 4 : 3 : 12. Everything after that is integer arithmetic in BigInt — the
 * fractional parts are compared as numerators over the same denominator, never
 * as decimals, and ties are broken by input order so the output is
 * deterministic. A negative total has its sign taken off first, or `floor` would
 * round the wrong way on every share.
 */
export function splitAmount(input: SplitAmountInput): ProResult<SplitAmountResult> {
  const { totalAmount, weights, smallestUnit, remainderRule } = input;
  if (!Number.isFinite(totalAmount) || Math.abs(totalAmount) > 1e12) return fail("totalAmount");
  if (weights.length < 1 || weights.length > 500) return fail("weights");
  if (smallestUnit !== 0.01 && smallestUnit !== 1 && smallestUnit !== 100) {
    return fail("smallestUnit");
  }

  const fractions: { p: bigint; q: bigint }[] = [];
  for (const weight of weights) {
    const fraction = weightFraction(weight);
    if (fraction === undefined) return fail("weights");
    fractions.push(fraction);
  }
  let common = 1n;
  for (const fraction of fractions) common = lcmBig(common, fraction.q);
  let scaled = fractions.map((fraction) => fraction.p * (common / fraction.q));
  // A common factor across every wᵢ (after each fraction was already reduced
  // on its own) cancels out of every ratio wᵢ/W, so dividing it out changes no
  // result — it only keeps 500 rows of mismatched denominators from raising Q
  // into a number with no proportional meaning left in its extra digits.
  const weightGcd = scaled.reduce((gcd, value) => gcdBig(gcd, value), 0n);
  if (weightGcd > 1n) scaled = scaled.map((value) => value / weightGcd);
  const totalWeight = scaled.reduce((sum, value) => sum + value, 0n);
  if (totalWeight === 0n) return fail("weights");

  const sign = totalAmount < 0 ? -1 : 1;
  const cents = scaledMagnitude(totalAmount, 2);
  if (cents === undefined) return fail("totalAmount");
  const unitInCents = BigInt(Math.round(smallestUnit * 100));
  const units = halfUpDiv(cents, unitInCents);

  const base = scaled.map((weight) => (units * weight) / totalWeight);
  const remainders = scaled.map((weight) => (units * weight) % totalWeight);
  const allocated = base.reduce((sum, value) => sum + value, 0n);
  const leftover = Number(units - allocated);

  const order = scaled.map((_, index) => index);
  if (remainderRule === "largestRemainder") {
    order.sort((a, b) => {
      const left = remainders[a] ?? 0n;
      const right = remainders[b] ?? 0n;
      if (left === right) return a - b;
      return left > right ? -1 : 1;
    });
  }
  // A weight of zero is entitled to nothing, in EITHER rule — "first come"
  // would otherwise hand a leftover unit to whoever is listed first even when
  // their own share of the total is zero. R is always smaller than the number
  // of positive weights, so filtering them out can never leave a unit
  // unassigned.
  const eligible = order.filter((index) => (scaled[index] ?? 0n) > 0n);
  const bonus = new Set(eligible.slice(0, leftover));

  const shares: SplitShare[] = [];
  let checksumCents = 0n;
  for (let index = 0; index < scaled.length; index += 1) {
    const allocation = (base[index] ?? 0n) + (bonus.has(index) ? 1n : 0n);
    const amountCents = allocation * unitInCents;
    checksumCents += amountCents;
    const exactUnits =
      Number(base[index] ?? 0n) + Number(remainders[index] ?? 0n) / Number(totalWeight);
    const amount = (sign * Number(amountCents)) / 100;
    const exactAmount = (sign * exactUnits * Number(unitInCents)) / 100;
    shares.push({
      index,
      units: Number(allocation),
      amount,
      exactAmount,
      gotRemainderUnit: bonus.has(index),
      deviation: amount - exactAmount,
    });
  }

  const total = (sign * Number(units * unitInCents)) / 100;
  return {
    ok: true,
    shares,
    checksum: (sign * Number(checksumCents)) / 100,
    total,
    totalAmountEntered: totalAmount,
    roundingDifference: total - totalAmount,
    remainderUnits: leftover,
    rule: remainderRule,
  };
}

// ---------------------------------------------------------------------------
// Račun, IBAN i modul 97 — ISO 7064 MOD 97-10
//
// Computed digit by digit, so no intermediate ever exceeds a small integer and
// no BigInt is needed. A match means the string agrees with its own check
// arithmetic — not that an account exists, is open, or belongs to anyone.
// ---------------------------------------------------------------------------

/** r = (r·10 + digit) mod 97, letters counting as their two-digit value. */
function mod97(text: string): number | undefined {
  let remainder = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code >= 48 && code <= 57) remainder = (remainder * 10 + (code - 48)) % 97;
    else if (code >= 65 && code <= 90) remainder = (remainder * 100 + (code - 55)) % 97;
    else return undefined;
  }
  return remainder;
}

function stripSeparators(text: string): string {
  return text.replace(/[\s.-]/g, "").toUpperCase();
}

/** Four-character groups, the way an account or IBAN is written down. */
function groupsOfFour(text: string): string {
  return (text.match(/.{1,4}/g) ?? []).join(" ");
}

export interface DomesticAccountInput {
  /** 18 digits to check, or 16 (3 bank + 13 account) to compute the check pair. */
  readonly account: string;
  readonly mode: "check" | "compute";
}

export interface DomesticAccountResult {
  readonly digits: string;
  readonly bank: string;
  readonly account: string;
  readonly checkDigits: string;
  /** In `check`, mod 97 of all eighteen digits — 1 exactly when the pair
   * agrees. In `compute`, mod 97 of the payload with „00" appended — the
   * figure `checkDigits` was built from, which is NOT the same as mod 97 of
   * the finished eighteen digits (that is always 1, by construction). */
  readonly remainder: number;
  readonly matches: boolean | undefined;
  readonly grouped: string;
}

/**
 * The two-digit control number of a domestic 3 + 13 + 2 account.
 *
 * The control number is `98 − mod97(bank ‖ account ‖ "00")`, which is always
 * between 2 and 98 — so it is always exactly two digits, and a computed 00 or 01
 * means the implementation is wrong rather than that the account is unusual.
 */
export function domesticAccount(input: DomesticAccountInput): ProResult<DomesticAccountResult> {
  const cleaned = stripSeparators(input.account);
  if (!/^[0-9]+$/.test(cleaned)) return fail("account");
  const expected = input.mode === "check" ? 18 : 16;
  if (cleaned.length !== expected) return fail("account");

  const payload = cleaned.slice(0, 16);
  const computed = mod97(`${payload}00`);
  if (computed === undefined) return fail("account");
  const checkDigits = String(98 - computed).padStart(2, "0");
  const digits = `${payload}${input.mode === "check" ? cleaned.slice(16) : checkDigits}`;
  // In `compute` this would always be 1 — the pair was just built to make it
  // so — telling the reader nothing; `computed`, the payload's own remainder,
  // is the number the check digits were derived FROM.
  const finalRemainder = mod97(digits);
  if (finalRemainder === undefined) return fail("account");

  return {
    ok: true,
    digits,
    bank: payload.slice(0, 3),
    account: payload.slice(3),
    checkDigits,
    remainder: input.mode === "check" ? finalRemainder : computed,
    matches: input.mode === "check" ? finalRemainder === 1 : undefined,
    grouped: groupsOfFour(digits),
  };
}

export interface IbanInput {
  /** An IBAN to check, or the BBAN plus `country` to build one. */
  readonly iban?: string | undefined;
  readonly bban?: string | undefined;
  /** Two letters. No per-country length table is embedded, and none is implied. */
  readonly country?: string | undefined;
  readonly mode: "check" | "compute";
}

export interface IbanResult {
  readonly iban: string;
  readonly grouped: string;
  readonly country: string;
  readonly checkDigits: string;
  /** In `check`, mod 97 over the rearranged string — 1 exactly when the IBAN
   * is consistent. In `compute`, mod 97 of `BBAN ‖ country ‖ "00"` — the
   * figure `checkDigits` was built from, not the (always 1) remainder of the
   * finished IBAN. */
  readonly remainder: number;
  readonly matches: boolean | undefined;
}

/**
 * An IBAN's check digits, for any country.
 *
 * The length table per country is deliberately NOT carried: MOD 97-10 does not
 * need it, so checking the length would be a claim the tool cannot back. Every
 * Serbian account that passes its own domestic check produces RS35, and that is
 * not a coincidence — a valid BBAN is ≡ 1 (mod 97), 10^6 ≡ 27 and „272800" ≡ 36,
 * so the remainder is always 63. Anything else means the arithmetic is broken.
 */
export function ibanRecord(input: IbanInput): ProResult<IbanResult> {
  if (input.mode === "check") {
    const cleaned = stripSeparators(input.iban ?? "");
    if (!/^[A-Z]{2}[0-9]{2}[0-9A-Z]{1,30}$/.test(cleaned)) return fail("iban");
    // MOD 97-10 cannot see the format: it would happily accept "AB0012345"
    // whether or not the middle two characters are check digits at all. ISO
    // 13616 fixes the check pair at positions 3–4 and in range 02–98 — 00 and 01
    // cannot arise from `98 − mod97(...)`, which is exactly the check this adds.
    const checkDigits = Number(cleaned.slice(2, 4));
    if (checkDigits < 2 || checkDigits > 98) return fail("iban");
    const rearranged = `${cleaned.slice(4)}${cleaned.slice(0, 4)}`;
    const remainder = mod97(rearranged);
    if (remainder === undefined) return fail("iban");
    return {
      ok: true,
      iban: cleaned,
      grouped: groupsOfFour(cleaned),
      country: cleaned.slice(0, 2),
      checkDigits: cleaned.slice(2, 4),
      remainder,
      matches: remainder === 1,
    };
  }

  const country = stripSeparators(input.country ?? "");
  const bban = stripSeparators(input.bban ?? "");
  if (!/^[A-Z]{2}$/.test(country)) return fail("country");
  if (!/^[0-9A-Z]{1,30}$/.test(bban)) return fail("bban");
  const remainder = mod97(`${bban}${country}00`);
  if (remainder === undefined) return fail("bban");
  const checkDigits = String(98 - remainder).padStart(2, "0");
  const iban = `${country}${checkDigits}${bban}`;
  return {
    ok: true,
    iban,
    grouped: groupsOfFour(iban),
    country,
    checkDigits,
    remainder,
    matches: undefined,
  };
}

export interface Mod97Input {
  readonly digits: string;
  readonly mode: "check" | "compute";
}

export interface Mod97Result {
  readonly digits: string;
  readonly checkDigits: string;
  /** In `compute`, mod 97 of the payload with „00" appended; in `check`, of the
   * whole string, which is 1 exactly when the pair agrees. */
  readonly remainder: number;
  readonly matches: boolean | undefined;
}

/**
 * The two check digits of an arbitrary digit string under MOD 97-10.
 *
 * Leading zeros are kept: they are part of the record, not of a number, and a
 * string parsed into an integer first would check a different value.
 */
export function mod97CheckDigits(input: Mod97Input): ProResult<Mod97Result> {
  const cleaned = stripSeparators(input.digits);
  if (!/^[0-9]{1,60}$/.test(cleaned)) return fail("digits");
  if (input.mode === "check") {
    if (cleaned.length < 3) return fail("digits");
    const remainder = mod97(cleaned);
    if (remainder === undefined) return fail("digits");
    return {
      ok: true,
      digits: cleaned,
      checkDigits: cleaned.slice(-2),
      remainder,
      matches: remainder === 1,
    };
  }
  const remainder = mod97(`${cleaned}00`);
  if (remainder === undefined) return fail("digits");
  const checkDigits = String(98 - remainder).padStart(2, "0");
  return {
    ok: true,
    digits: `${cleaned}${checkDigits}`,
    checkDigits,
    remainder,
    matches: undefined,
  };
}

// ---------------------------------------------------------------------------
// Radni dani
// ---------------------------------------------------------------------------

export interface WorkingDaysInput {
  readonly from: CivilDate;
  readonly to: CivilDate;
  readonly includeLastDay: boolean;
  /** Which weekdays are non-working. Set by a rule-maker, so: an input. */
  readonly nonWorkingWeekdays: readonly Weekday[];
  /** Dates the user typed. The tool ships no holiday, for any country. */
  readonly nonWorkingDates: readonly CivilDate[];
}

export interface WorkingDaysResult {
  readonly calendarDays: number;
  readonly workingDays: number;
  /** Days that were non-working because of their weekday. */
  readonly weekdayNonWorkingDays: number;
  /** Typed dates that had not ALREADY fallen on a non-working weekday. */
  readonly listedNonWorkingDays: number;
  /** Distinct typed dates that fall inside the range at all. */
  readonly listedDatesInRange: number;
  readonly fullWeeks: number;
  readonly remainderDays: number;
  /** True when the bounds were given the wrong way round and were swapped. */
  readonly reversed: boolean;
  /** The date actually used as the range's last day, after any swap — the
   * original `from` when `reversed` is true, since the swap is not visible in
   * the day count alone. */
  readonly effectiveLastDate: CivilDate;
  /**
   * Typed non-working dates that fell OUTSIDE the range, as dates — a count
   * alone makes a mistyped year in a holiday list disappear; the date itself
   * is what lets a reader spot it.
   */
  readonly datesOutOfRange: readonly CivilDate[];
  readonly firstWorkingDay: CivilDate | undefined;
  readonly lastWorkingDay: CivilDate | undefined;
}

/**
 * Calendar, working and non-working days between two dates.
 *
 * **The order of the three tests is the point.** A day that is both a Saturday
 * and a typed holiday is counted ONCE, in the weekday category — otherwise the
 * three categories would not add up to the calendar count, and that identity is
 * the only thing making the output checkable. Typed dates become a set first, so
 * the same date entered twice is one date.
 */
export function workingDays(input: WorkingDaysInput): ProResult<WorkingDaysResult> {
  const { from, to, includeLastDay, nonWorkingWeekdays, nonWorkingDates } = input;
  if (!isCivilDate(from)) return fail("from");
  if (!isCivilDate(to)) return fail("to");
  if (!isWeekdaySet(nonWorkingWeekdays)) return fail("nonWorkingWeekdays");
  if (nonWorkingDates.length > 400) return fail("nonWorkingDates");
  for (const date of nonWorkingDates) if (!isCivilDate(date)) return fail("nonWorkingDates");

  const first = daysFromCivil(from);
  const second = daysFromCivil(to);
  const reversed = second < first;
  const start = reversed ? second : first;
  const finish = reversed ? first : second;
  const end = finish + (includeLastDay ? 1 : 0);
  const weekend = new Set<number>(nonWorkingWeekdays);

  // Kept as CivilDate, not just a day number set, so an out-of-range entry can
  // still be named rather than merely counted.
  const listed = new Set<number>();
  const outOfRange = new Map<number, CivilDate>();
  for (const date of nonWorkingDates) {
    const day = daysFromCivil(date);
    if (day >= start && day < end) listed.add(day);
    else outOfRange.set(day, date);
  }

  let calendarDays = 0;
  let weekdayNonWorkingDays = 0;
  let listedNonWorkingDays = 0;
  let working = 0;
  let firstWorkingDay: number | undefined;
  let lastWorkingDay: number | undefined;
  for (let day = start; day < end; day += 1) {
    calendarDays += 1;
    if (weekend.has(weekdayOf(day))) weekdayNonWorkingDays += 1;
    else if (listed.has(day)) listedNonWorkingDays += 1;
    else {
      working += 1;
      if (firstWorkingDay === undefined) firstWorkingDay = day;
      lastWorkingDay = day;
    }
  }

  return {
    ok: true,
    calendarDays,
    workingDays: working,
    weekdayNonWorkingDays,
    listedNonWorkingDays,
    listedDatesInRange: listed.size,
    fullWeeks: Math.floor(calendarDays / 7),
    remainderDays: calendarDays % 7,
    reversed,
    effectiveLastDate: civilFromDays(finish),
    datesOutOfRange: [...outOfRange.values()],
    firstWorkingDay: firstWorkingDay === undefined ? undefined : civilFromDays(firstWorkingDay),
    lastWorkingDay: lastWorkingDay === undefined ? undefined : civilFromDays(lastWorkingDay),
  };
}

// ---------------------------------------------------------------------------
// Rok i poslednji dan
// ---------------------------------------------------------------------------

export type DeadlineUnit = "days" | "months" | "years";
/** What happens when the deadline lands on a non-working day. Procedural. */
export type DeadlineShift = "none" | "forward" | "backward";

export interface DeadlineInput {
  readonly startDate: CivilDate;
  readonly length: number;
  readonly unit: DeadlineUnit;
  /** Whether the starting day counts. An explicit switch, not an assumption. */
  readonly countStartDay: boolean;
  readonly nonWorkingWeekdays: readonly Weekday[];
  readonly nonWorkingDates: readonly CivilDate[];
  readonly shift: DeadlineShift;
}

export interface DeadlineResult {
  readonly rawLastDay: CivilDate;
  readonly rawWeekday: Weekday;
  readonly lastDay: CivilDate;
  readonly weekday: Weekday;
  readonly shiftedByDays: number;
  /**
   * Calendar days from the start to the day the deadline finally expires —
   * i.e. to `lastDay`, AFTER the shift, counted the way `countStartDay` says.
   * The same span read before the shift is `totalDaysBeforeShift`; the two
   * numbers answer different questions and neither name says so on its own.
   */
  readonly totalDays: number;
  /** `totalDays`, but to `rawLastDay` — before any non-working-day shift. */
  readonly totalDaysBeforeShift: number;
  /** True when a zero-length inclusive term expires before it begins. */
  readonly expiredBeforeStart: boolean;
}

/** The shift limit exists so a pathological list of dates cannot spin forever. */
const MAX_SHIFT_STEPS = 400;

/**
 * The last day of a term, and where a non-working day moves it.
 *
 * Months are added with the `min(day, daysInMonth)` rule — 31 January plus one
 * month is 28 February — which is why adding months is not associative and why
 * this function takes the whole length at once instead of stepping.
 *
 * The guard that matters: if every weekday is marked non-working there is no
 * working day to move to, and the shifting loop would never end. That is
 * refused up front rather than bounded, because a bound would return a date
 * nobody can justify.
 */
export function deadlineForward(input: DeadlineInput): ProResult<DeadlineResult> {
  const { startDate, length, unit, countStartDay, nonWorkingWeekdays, nonWorkingDates } = input;
  if (!isCivilDate(startDate)) return fail("startDate");
  if (!isIntegerIn(length, 0, 36500)) return fail("length");
  if (!isWeekdaySet(nonWorkingWeekdays)) return fail("nonWorkingWeekdays");
  if (nonWorkingDates.length > 400) return fail("nonWorkingDates");
  const listed = dayNumberSet(nonWorkingDates);
  if (listed === undefined) return fail("nonWorkingDates");

  const start = daysFromCivil(startDate);
  const base =
    unit === "days"
      ? start + length
      : daysFromCivil(addMonths(startDate, unit === "years" ? 12 * length : length));
  const rawLastDay = base - (countStartDay ? 1 : 0);
  const expiredBeforeStart = rawLastDay < start;

  const weekend = new Set<number>(nonWorkingWeekdays);
  const isNonWorking = (day: number): boolean => weekend.has(weekdayOf(day)) || listed.has(day);

  let lastDay = rawLastDay;
  if (input.shift !== "none" && !expiredBeforeStart) {
    if (weekend.size === 7) return fail("nonWorkingWeekdays");
    const step = input.shift === "forward" ? 1 : -1;
    let steps = 0;
    while (isNonWorking(lastDay)) {
      steps += 1;
      if (steps > MAX_SHIFT_STEPS) return fail("nonWorkingDates");
      lastDay += step;
    }
  }

  return {
    ok: true,
    rawLastDay: civilFromDays(rawLastDay),
    rawWeekday: weekdayOf(rawLastDay),
    lastDay: civilFromDays(lastDay),
    weekday: weekdayOf(lastDay),
    shiftedByDays: lastDay - rawLastDay,
    totalDays: lastDay - start + (countStartDay ? 1 : 0),
    totalDaysBeforeShift: rawLastDay - start + (countStartDay ? 1 : 0),
    expiredBeforeStart,
  };
}

export interface DeadlineBackwardInput {
  /** The known end of the term; the tool looks for the starts that reach it. */
  readonly endDate: CivilDate;
  readonly length: number;
  readonly unit: DeadlineUnit;
  readonly countStartDay: boolean;
  readonly nonWorkingWeekdays: readonly Weekday[];
  readonly nonWorkingDates: readonly CivilDate[];
  readonly shift: DeadlineShift;
}

export interface DeadlineBackwardCandidate {
  readonly startDate: CivilDate;
  /** Where THIS candidate's own forward computation lands before any shift. */
  readonly rawLastDay: CivilDate;
  /**
   * Where it lands AFTER the shift — the range alone does not say which
   * candidate's shifted deadline is the one that equals `endDate`, and this is
   * what answers that without a second, separate calculation.
   */
  readonly lastDay: CivilDate;
}

export interface DeadlineBackwardResult {
  /** EVERY start date that produces `endDate` — not one date, and possibly none. */
  readonly candidates: readonly DeadlineBackwardCandidate[];
}

/**
 * Which start dates produce a given last day — a range, not a date.
 *
 * Adding months is not injective: 28, 29 and 30 November all land on 28 February
 * once `min(day, daysInMonth)` has clipped them, so a single answer would be an
 * arbitrary pick among three. It can also be EMPTY — nothing plus two months
 * gives 30 April, because the preimage would have to be 30 February — and an
 * empty list is the honest answer rather than the nearest date.
 *
 * **Each candidate is run back through `deadlineForward` itself**, the same
 * date helper used everywhere else in this file rather than a third copy of
 * the shifting loop, so its raw and shifted last day are both shown next to
 * it — the range on its own does not say which candidate, once its own
 * non-working-day shift is applied, is the one that actually reaches
 * `endDate`.
 */
export function deadlineBackward(
  input: DeadlineBackwardInput,
): ProResult<DeadlineBackwardResult> {
  const { endDate, length, unit, countStartDay, nonWorkingWeekdays, nonWorkingDates, shift } =
    input;
  if (!isCivilDate(endDate)) return fail("endDate");
  if (!isIntegerIn(length, 0, 36500)) return fail("length");
  // Validated HERE, not only inside `deadlineForward` per candidate below: an
  // empty preimage (a real, correct answer — see the class doc comment) skips
  // that loop entirely, and an invalid weekday set or date list would then
  // pass through unreported instead of being refused.
  if (!isWeekdaySet(nonWorkingWeekdays)) return fail("nonWorkingWeekdays");
  if (nonWorkingDates.length > 400) return fail("nonWorkingDates");
  for (const date of nonWorkingDates) if (!isCivilDate(date)) return fail("nonWorkingDates");

  const target = daysFromCivil(endDate) + (countStartDay ? 1 : 0);
  const rawStarts: CivilDate[] = [];
  if (unit === "days") {
    const candidate = civilFromDays(target - length);
    if (!isCivilDate(candidate)) return fail("endDate");
    rawStarts.push(candidate);
  } else {
    const months = unit === "years" ? 12 * length : length;
    const nominal = addMonths(civilFromDays(target), -months);
    const centre = daysFromCivil(nominal);
    // The preimage of a month shift lies within one month of the nominal
    // inverse, so a bounded scan finds all of it and finds it exactly.
    for (let offset = -35; offset <= 35; offset += 1) {
      const candidate = civilFromDays(centre + offset);
      if (!isCivilDate(candidate)) continue;
      if (daysFromCivil(addMonths(candidate, months)) === target) rawStarts.push(candidate);
    }
  }

  const candidates: DeadlineBackwardCandidate[] = [];
  for (const startDate of rawStarts) {
    const forward = deadlineForward({
      startDate,
      length,
      unit,
      countStartDay,
      nonWorkingWeekdays,
      nonWorkingDates,
      shift,
    });
    if (!forward.ok) return forward;
    candidates.push({ startDate, rawLastDay: forward.rawLastDay, lastDay: forward.lastDay });
  }
  return { ok: true, candidates };
}

// ---------------------------------------------------------------------------
// Obračun strana teksta
//
// Characters are Unicode code points with the White_Space property from the
// table the runtime carries (Unicode Standard 17.0 PropList.txt at the time of
// writing). The characters-per-page figure and the price are prescribed by a
// tariff or agreed in a contract, so both are inputs with no default.
// ---------------------------------------------------------------------------

export type PageRounding = "up" | "half" | "exact";

export interface TextPagesInput {
  readonly text: string;
  readonly charactersPerPage: number;
  readonly countSpaces: boolean;
  readonly rounding: PageRounding;
  readonly pricePerPage?: number | undefined;
}

export interface TextPagesResult {
  /** Code points in the ORIGINAL text, before NFC normalisation. */
  readonly charactersBeforeNormalization: number;
  readonly charactersWithSpaces: number;
  readonly charactersWithoutSpaces: number;
  readonly words: number;
  /** Line breaks + 1. Empty text is one line by that formula, and stays one. */
  readonly lines: number;
  readonly exactPages: number;
  readonly pagesRoundedUp: number;
  readonly pagesToHalf: number;
  /** The page count the chosen rounding produced. */
  readonly billedPages: number;
  readonly amount: number | undefined;
}

/**
 * Billing pages for a pasted text.
 *
 * **Code points, never UTF-16 units.** `"👍".length` is 2 and `[..."👍"].length`
 * is 1; the second is the number a person would count. The text is normalised to
 * NFC first, because the same word from two sources can be one code point or two
 * (a letter plus a combining accent) and the two would otherwise bill
 * differently.
 *
 * Empty text is zero pages, not one — the minimum-page rule is a tariff term,
 * and this tool does not carry tariff terms.
 */
export function textPages(input: TextPagesInput): ProResult<TextPagesResult> {
  const { text, charactersPerPage, countSpaces, rounding } = input;
  if (typeof text !== "string" || text.length > 2000000) return fail("text");
  if (!isIntegerIn(charactersPerPage, 1, 100000)) return fail("charactersPerPage");
  if (input.pricePerPage !== undefined && !isNonNegative(input.pricePerPage)) {
    return fail("pricePerPage");
  }

  const charactersBeforeNormalization = [...text].length;
  const normalised = text.normalize("NFC");
  const codePoints = [...normalised];
  const charactersWithSpaces = codePoints.length;
  const charactersWithoutSpaces = codePoints.filter(
    (character) => !/\p{White_Space}/u.test(character),
  ).length;
  const trimmed = normalised.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
  const words = trimmed === "" ? 0 : trimmed.split(/\p{White_Space}+/u).length;
  // CRLF is one break, so the alternation puts it first. A trailing break adds
  // one line by this same formula, for the same reason empty text is one line:
  // it is what "breaks + 1" means, not a special case for either input.
  const lines = (normalised.match(/\r\n|\r|\n/g) ?? []).length + 1;

  const basis = countSpaces ? charactersWithSpaces : charactersWithoutSpaces;
  const exactPages = basis / charactersPerPage;
  // Integer ceiling division, not `Math.ceil` of the displayed float: both
  // operands are safe integers here, and rounding must come from THEM, never
  // from the 6-decimal value a person reads on screen.
  const pagesRoundedUp = Math.floor((basis + charactersPerPage - 1) / charactersPerPage);
  const pagesToHalf = Math.floor((2 * basis + charactersPerPage - 1) / charactersPerPage) / 2;
  const billedPages =
    rounding === "up" ? pagesRoundedUp : rounding === "half" ? pagesToHalf : exactPages;

  return {
    ok: true,
    charactersBeforeNormalization,
    charactersWithSpaces,
    charactersWithoutSpaces,
    words,
    lines,
    exactPages,
    pagesRoundedUp,
    pagesToHalf,
    billedPages,
    amount:
      input.pricePerPage === undefined
        ? undefined
        : roundHalfUp(billedPages * input.pricePerPage, 2),
  };
}

// ---------------------------------------------------------------------------
// Udeli i ciljni imenilac
// ---------------------------------------------------------------------------

export interface ShareFraction {
  readonly numerator: number;
  readonly denominator: number;
}

export interface CoOwnershipInput {
  readonly shares: readonly ShareFraction[];
  readonly totalArea?: number | undefined;
  /** A denominator the user wants the shares expressed over, if any. */
  readonly targetDenominator?: number | undefined;
}

export interface CoOwnershipShare {
  readonly index: number;
  /** The share in lowest terms. */
  readonly numerator: bigint;
  readonly denominator: bigint;
  /** The same share over the common denominator of the whole list. */
  readonly commonNumerator: bigint;
  readonly percent: number;
  readonly area: number | undefined;
  /** The numerator over the target denominator, when it divides exactly. */
  readonly targetNumerator: bigint | undefined;
  readonly fitsTarget: boolean | undefined;
}

export interface CoOwnershipResult {
  readonly shares: readonly CoOwnershipShare[];
  readonly commonDenominator: bigint;
  readonly sumNumerator: bigint;
  /** Integer equality, never a tolerance — this is the answer, not an estimate. */
  readonly isWhole: boolean;
  /** (L − Σ)/L in lowest terms: positive is missing, negative is over the whole. */
  readonly differenceNumerator: bigint;
  readonly differenceDenominator: bigint;
  readonly differencePercent: number;
}

/**
 * Largest-remainder apportionment of `total` indivisible units across integer
 * weights, ties broken by input order — the same rule `splitAmount` uses for
 * money, reused here for the area column so the two tools never disagree
 * about where a leftover unit goes. A zero weight gets none of the leftover:
 * `total` is always smaller than the count of positive weights, so excluding
 * them can never leave a unit unassigned.
 */
function allocateLargestRemainder(total: bigint, weights: readonly bigint[]): readonly bigint[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0n);
  if (totalWeight === 0n) return weights.map(() => 0n);
  const base = weights.map((weight) => (total * weight) / totalWeight);
  const remainders = weights.map((weight) => (total * weight) % totalWeight);
  const allocated = base.reduce((sum, value) => sum + value, 0n);
  const leftover = Number(total - allocated);
  const order = weights.map((_, index) => index);
  order.sort((a, b) => {
    const left = remainders[a] ?? 0n;
    const right = remainders[b] ?? 0n;
    if (left === right) return a - b;
    return left > right ? -1 : 1;
  });
  const eligible = order.filter((index) => (weights[index] ?? 0n) > 0n);
  const bonus = new Set(eligible.slice(0, leftover));
  return base.map((value, index) => value + (bonus.has(index) ? 1n : 0n));
}

/** n/d × 100 as a percentage, rounded half-up at `decimals`, exact in BigInt. */
function percentOf(numerator: bigint, denominator: bigint, decimals: number): number {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const factor = 10n ** BigInt(decimals);
  const scaled = halfUpDiv(magnitude * 100n * factor, denominator);
  const value = Number(scaled) / Number(factor);
  return negative ? -value : value;
}

/**
 * Whether a list of ideal shares is exactly the whole, and what each one is over
 * the common denominator.
 *
 * **All of it is BigInt on purpose.** The lowest common multiple of a handful of
 * denominators clears 2^53 easily (7, 11, 13, 17, 19 and 23 together already
 * matter), and once a double loses a bit, „the sum is exactly one" becomes a
 * statement the tool cannot honestly make. The comparison here is `Σ == L`
 * between integers, so it is an equality and not a judgement.
 *
 * **The area column is apportioned, not independently rounded.** Rounding
 * each share's area on its own can legitimately miss the total — 1/3 of
 * 100.00 m² three times is 33.33 × 3 = 99.99 — so the areas go through the
 * same largest-remainder rule `splitAmount` uses for money, and sum to
 * `totalArea` exactly, to four decimals, by construction.
 */
export function coOwnershipShares(input: CoOwnershipInput): ProResult<CoOwnershipResult> {
  const { shares, totalArea, targetDenominator } = input;
  if (shares.length < 1 || shares.length > 200) return fail("shares");
  if (totalArea !== undefined && (!isPositive(totalArea) || totalArea > 1e9)) {
    return fail("totalArea");
  }
  if (targetDenominator !== undefined && !isIntegerIn(targetDenominator, 1, 1e9)) {
    return fail("targetDenominator");
  }

  const reduced: { numerator: bigint; denominator: bigint }[] = [];
  for (const share of shares) {
    if (!isIntegerIn(share.numerator, 0, 1e12)) return fail("shares");
    if (!isIntegerIn(share.denominator, 1, 1e12)) return fail("shares");
    const numerator = BigInt(share.numerator);
    const denominator = BigInt(share.denominator);
    const divisor = gcdBig(numerator, denominator);
    const factor = divisor === 0n ? denominator : divisor;
    reduced.push({ numerator: numerator / factor, denominator: denominator / factor });
  }

  let common = 1n;
  for (const share of reduced) common = lcmBig(common, share.denominator);
  const target = targetDenominator === undefined ? undefined : BigInt(targetDenominator);

  const commonNumerators = reduced.map((share) => share.numerator * (common / share.denominator));
  let areaUnits: readonly bigint[] | undefined;
  if (totalArea !== undefined) {
    const totalAreaUnits = scaledMagnitude(totalArea, 4);
    if (totalAreaUnits === undefined) return fail("totalArea");
    areaUnits = allocateLargestRemainder(totalAreaUnits, commonNumerators);
  }

  let sumNumerator = 0n;
  const result: CoOwnershipShare[] = [];
  for (let index = 0; index < reduced.length; index += 1) {
    const share = reduced[index];
    if (share === undefined) continue;
    const commonNumerator = commonNumerators[index] ?? 0n;
    sumNumerator += commonNumerator;
    const fits = target === undefined ? undefined : target % share.denominator === 0n;
    result.push({
      index,
      numerator: share.numerator,
      denominator: share.denominator,
      commonNumerator,
      percent: percentOf(share.numerator, share.denominator, 6),
      area: areaUnits === undefined ? undefined : Number(areaUnits[index] ?? 0n) / 10000,
      targetNumerator:
        target === undefined || fits !== true
          ? undefined
          : share.numerator * (target / share.denominator),
      fitsTarget: fits,
    });
  }

  const differenceRaw = common - sumNumerator;
  const divisor = gcdBig(differenceRaw, common);
  const factor = divisor === 0n ? common : divisor;
  return {
    ok: true,
    shares: result,
    commonDenominator: common,
    sumNumerator,
    isWhole: sumNumerator === common,
    differenceNumerator: differenceRaw / factor,
    differenceDenominator: common / factor,
    differencePercent: percentOf(differenceRaw, common, 6),
  };
}

export interface SharePartInput {
  /** A measured part, exactly as typed — e.g. 58.405 m² of a whole area. */
  readonly part: number;
  /** The whole the part is measured against; must not be smaller than `part`. */
  readonly whole: number;
}

export interface SharePartResult {
  /** `part/whole`, reduced to lowest terms. */
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly percent: number;
}

/**
 * The reverse of `coOwnershipShares`: a measured part and its whole, reduced
 * to an ideal share — for when the fraction itself is not what was measured.
 *
 * **Scaled by the decimals actually typed, not a fixed two.** A cadastral
 * measurement commonly carries three (58,405 m²); a fixed ×100 truncates it
 * before the fraction is even formed. `d` is the larger of `part` and
 * `whole`'s own decimal counts, so both scale exactly — the GCD reduction
 * that follows is the only lossy-looking step, and it loses nothing, because
 * reducing a fraction never changes its value.
 */
export function sharePart(input: SharePartInput): ProResult<SharePartResult> {
  const { part, whole } = input;
  if (!isNonNegative(part)) return fail("part");
  if (!isPositive(whole) || part > whole) return fail("whole");

  const scale = Math.max(typedDecimals(part), typedDecimals(whole));
  const partScaled = scaledMagnitude(part, scale);
  const wholeScaled = scaledMagnitude(whole, scale);
  if (partScaled === undefined || wholeScaled === undefined || wholeScaled === 0n) {
    return fail("whole");
  }
  const divisor = gcdBig(partScaled, wholeScaled);
  const factor = divisor === 0n ? wholeScaled : divisor;
  const numerator = partScaled / factor;
  const denominator = wholeScaled / factor;
  return { ok: true, numerator, denominator, percent: percentOf(numerator, denominator, 6) };
}

// ---------------------------------------------------------------------------
// Troškovi srazmerno uspehu
// ---------------------------------------------------------------------------

export interface ProportionalCostsInput {
  /**
   * Either give `claimed` and `awarded` and let the ratio be derived, or type
   * `successPercent` directly. Success is not always the ratio of an amount
   * claimed to an amount awarded, and hard-coding `u = awarded/claimed` as the
   * only path would be this tool asserting a doctrine instead of computing.
   * Give one source, never both.
   */
  readonly claimed?: number | undefined;
  readonly awarded?: number | undefined;
  readonly successPercent?: number | undefined;
  readonly firstPartyCosts: number;
  readonly secondPartyCosts: number;
}

/** Whose side the difference falls on. Never a signed amount — see below. */
export type CostSide = "first" | "second" | "none";

export interface ProportionalCostsResult {
  /** awarded/claimed as a percentage, to four decimals. */
  readonly successPercent: number;
  readonly complementPercent: number;
  readonly firstPartyShare: number;
  readonly secondPartyShare: number;
  /** The magnitude of the difference; the direction is `side`. */
  readonly differenceAmount: number;
  readonly side: CostSide;
}

/**
 * The proportion of success, and the share of each party's own costs it carries.
 *
 * **The rounded percentage is never used to multiply.** 45 000 × 1/3 is 15 000
 * exactly; 45 000 × 0.3333 is 14 998.50, and the second is what a spreadsheet
 * built on the displayed percentage produces. The exact ratio does the
 * arithmetic and the rounded percentage is only shown.
 *
 * The difference comes back as a magnitude plus a side, because a minus sign in
 * front of an amount answers no question anyone was asking.
 */
export function proportionalCosts(
  input: ProportionalCostsInput,
): ProResult<ProportionalCostsResult> {
  const { firstPartyCosts, secondPartyCosts } = input;
  if (!isNonNegative(firstPartyCosts) || firstPartyCosts > 1e12) return fail("firstPartyCosts");
  if (!isNonNegative(secondPartyCosts) || secondPartyCosts > 1e12) return fail("secondPartyCosts");

  let ratio: number;
  if (input.successPercent !== undefined) {
    if (input.claimed !== undefined || input.awarded !== undefined) return fail("successPercent");
    if (!isInRange(input.successPercent, 0, 100)) return fail("successPercent");
    ratio = input.successPercent / 100;
  } else {
    const { claimed, awarded } = input;
    if (claimed === undefined || !isPositive(claimed) || claimed > 1e12) return fail("claimed");
    if (awarded === undefined || !isNonNegative(awarded)) return fail("awarded");
    if (awarded > claimed) return fail("awarded");
    ratio = awarded / claimed;
  }

  const firstPartyShare = roundHalfUp(firstPartyCosts * ratio, 2);
  const secondPartyShare = roundHalfUp(secondPartyCosts * (1 - ratio), 2);
  const difference = firstPartyShare - secondPartyShare;

  return {
    ok: true,
    successPercent: roundHalfUp(ratio * 100, 4),
    complementPercent: roundHalfUp((1 - ratio) * 100, 4),
    firstPartyShare,
    secondPartyShare,
    differenceAmount: Math.abs(difference),
    side: difference > 0 ? "first" : difference < 0 ? "second" : "none",
  };
}

// ---------------------------------------------------------------------------
// Ugovorna kazna
// ---------------------------------------------------------------------------

export interface ContractPenaltyInput {
  readonly base: number;
  /** Percent per day, from the contract. Nothing is embedded or defaulted. */
  readonly dailyRatePercent: number;
  /**
   * Which of `delayDays` or the date pair actually supplies the day count.
   * An explicit choice rather than "whichever fields happen to be filled in":
   * with both present there is no rule for which one wins, so the tool
   * refuses instead of picking silently.
   */
  readonly dataSource: "days" | "dates";
  readonly delayDays?: number | undefined;
  readonly agreedDate?: CivilDate | undefined;
  readonly actualDate?: CivilDate | undefined;
  /** The contractual cap as a percentage of the base, when there is one. */
  readonly capPercent?: number | undefined;
  readonly includeCompletionDay: boolean;
}

export interface ContractPenaltyResult {
  readonly delayDays: number;
  readonly uncappedAmount: number;
  readonly capAmount: number | undefined;
  /** The smaller of the two when a cap was typed; the formula's figure if not. */
  readonly amount: number;
  /** The day of delay on which the cap is reached — undefined at a zero rate. */
  readonly capDay: number | undefined;
  /** `capDay` as a calendar date — only when `dataSource` is `"dates"`. */
  readonly capDate: CivilDate | undefined;
  /** What one day of delay adds: `base × dailyRatePercent / 100`, rounded. */
  readonly dailyAmount: number;
}

/**
 * A delay penalty at a contractual daily rate, and the day its cap is reached.
 *
 * **The cap day does not depend on the debt.** The base appears in both the
 * accrued amount and the cap, so it cancels: the day is `ceil(cap / dailyRate)`,
 * a property of the two percentages alone. That is exactly what somebody with
 * the contract in front of them is checking, which is why it is reported even
 * when the cap has not been reached yet.
 *
 * A zero daily rate has no cap day at all — the cap is never reached — and the
 * tool says so instead of dividing by zero.
 */
export function contractPenalty(
  input: ContractPenaltyInput,
): ProResult<ContractPenaltyResult> {
  const { base, dailyRatePercent, includeCompletionDay, dataSource } = input;
  if (!isPositive(base) || base > 1e12) return fail("base");
  if (!isInRange(dailyRatePercent, 0, 100)) return fail("dailyRatePercent");
  if (input.capPercent !== undefined && !isInRange(input.capPercent, 0, 1000)) {
    return fail("capPercent");
  }

  let delayDays: number;
  let agreedDate: CivilDate | undefined;
  if (dataSource === "dates") {
    if (input.delayDays !== undefined) return fail("dataSource");
    if (!isCivilDate(input.agreedDate)) return fail("agreedDate");
    if (!isCivilDate(input.actualDate)) return fail("actualDate");
    agreedDate = input.agreedDate;
    const raw = daysFromCivil(input.actualDate) - daysFromCivil(input.agreedDate);
    // No delay means no penalty; the tool never returns a negative one.
    delayDays = raw <= 0 ? 0 : raw + (includeCompletionDay ? 1 : 0);
  } else if (dataSource === "days") {
    if (input.agreedDate !== undefined || input.actualDate !== undefined) return fail("dataSource");
    if (!isIntegerIn(input.delayDays ?? Number.NaN, 0, 36500)) return fail("delayDays");
    delayDays = input.delayDays ?? 0;
  } else {
    return fail("dataSource");
  }

  const uncapped = base * (dailyRatePercent / 100) * delayDays;
  const capAmount =
    input.capPercent === undefined ? undefined : roundHalfUp(base * (input.capPercent / 100), 2);
  const uncappedAmount = roundHalfUp(uncapped, 2);
  const amount = capAmount === undefined ? uncappedAmount : Math.min(uncappedAmount, capAmount);

  let capDay: number | undefined;
  if (input.capPercent !== undefined && dailyRatePercent > 0) {
    // ceil(cap/rate) over integers, scaled by 10^d where d is the LARGER of
    // the two operands' own decimal counts — not a fixed 6, which silently
    // rounds any rate or cap typed finer than that before the division ever
    // runs. Both scale exactly at that d, so nothing is lost before the ceil.
    const scale = Math.max(typedDecimals(input.capPercent), typedDecimals(dailyRatePercent));
    const capScaled = scaledMagnitude(input.capPercent, scale);
    const rateScaled = scaledMagnitude(dailyRatePercent, scale);
    if (capScaled === undefined || rateScaled === undefined || rateScaled === 0n) {
      return fail("dailyRatePercent");
    }
    capDay = Number((capScaled + rateScaled - 1n) / rateScaled);
  }
  // `delayDays` reaches `capDay` one calendar day EARLIER under the inclusive
  // convention — `delayDays = actual − agreed + 1` there, against
  // `delayDays = actual − agreed` when exclusive — so the cap date has to
  // subtract the same day `delayDays` added, by the same convention.
  const capDate =
    capDay === undefined || agreedDate === undefined
      ? undefined
      : civilFromDays(
          daysFromCivil(agreedDate) + capDay - (includeCompletionDay ? 1 : 0),
        );

  return {
    ok: true,
    delayDays,
    uncappedAmount,
    capAmount,
    amount,
    capDay,
    capDate,
    dailyAmount: roundHalfUp(base * (dailyRatePercent / 100), 2),
  };
}

// ---------------------------------------------------------------------------
// Zbir perioda
// ---------------------------------------------------------------------------

export interface DatePeriod {
  readonly from: CivilDate;
  readonly to: CivilDate;
}

export interface PeriodOverlap {
  readonly firstIndex: number;
  readonly secondIndex: number;
  readonly from: CivilDate;
  readonly to: CivilDate;
  readonly days: number;
}

export interface PeriodRow {
  readonly index: number;
  readonly days: number;
  /** True when `to` precedes `from`; such a period is flagged and NOT summed. */
  readonly reversed: boolean;
}

export interface SumOfPeriodsResult {
  readonly totalDays: number;
  readonly years: number;
  readonly months: number;
  readonly days: number;
  readonly convention: "30/360" | "calendar";
  readonly rows: readonly PeriodRow[];
  readonly overlaps: readonly PeriodOverlap[];
}

export interface SumOfPeriodsInput {
  readonly periods: readonly DatePeriod[];
  readonly includeLastDay: boolean;
  /** `calendar` needs a single period; 30/360 is applied to the SUM. */
  readonly convention: "30/360" | "calendar";
}

/**
 * The total of a list of periods, its decomposition, and every overlap in it.
 *
 * **All pairs are compared, not just neighbours.** Sorting by start and looking
 * at adjacent pairs misses a short period wholly inside a long one: with
 * 1 Jan–31 Dec, 2–3 Jan and 1–30 Jun, the neighbouring pair after sorting is
 * 2–3 Jan and 1–30 Jun, which do not overlap, while both lie inside the first.
 * At 200 periods that is 19 900 comparisons, which costs nothing.
 *
 * The 30/360 decomposition is applied to the SUM and is named in the output,
 * because the decomposition of a sum and the sum of decompositions are different
 * numbers and neither is wrong.
 */
export function sumOfPeriods(input: SumOfPeriodsInput): ProResult<SumOfPeriodsResult> {
  const { periods, includeLastDay, convention } = input;
  if (periods.length < 1 || periods.length > 200) return fail("periods");

  const bounds: { from: number; to: number; reversed: boolean }[] = [];
  for (const period of periods) {
    if (!isCivilDate(period.from) || !isCivilDate(period.to)) return fail("periods");
    const from = daysFromCivil(period.from);
    const to = daysFromCivil(period.to);
    bounds.push({ from, to, reversed: to < from });
  }

  const inclusive = includeLastDay ? 1 : 0;
  const rows: PeriodRow[] = bounds.map((bound, index) => ({
    index,
    days: bound.reversed ? 0 : bound.to - bound.from + inclusive,
    reversed: bound.reversed,
  }));
  const totalDays = rows.reduce((sum, row) => sum + row.days, 0);

  const overlaps: PeriodOverlap[] = [];
  for (let first = 0; first < bounds.length; first += 1) {
    const left = bounds[first];
    if (left === undefined || left.reversed) continue;
    for (let second = first + 1; second < bounds.length; second += 1) {
      const right = bounds[second];
      if (right === undefined || right.reversed) continue;
      const from = Math.max(left.from, right.from);
      const to = Math.min(left.to, right.to);
      const days = to - from + inclusive;
      if (days <= 0) continue;
      overlaps.push({
        firstIndex: first,
        secondIndex: second,
        from: civilFromDays(from),
        to: civilFromDays(to),
        days,
      });
    }
  }

  if (convention === "calendar") {
    const usable = bounds.filter((bound) => !bound.reversed);
    const only = usable[0];
    // The calendar decomposition is a walk from one date to another; a sum of
    // several periods is a number of days and has no dates to walk between.
    if (usable.length !== 1 || only === undefined) return fail("convention");
    const from = civilFromDays(only.from);
    let years = 0;
    while (daysFromCivil(addMonths(from, 12 * (years + 1))) <= only.to) years += 1;
    let months = 0;
    while (months < 11 && daysFromCivil(addMonths(from, 12 * years + months + 1)) <= only.to) {
      months += 1;
    }
    const anchor = daysFromCivil(addMonths(from, 12 * years + months));
    return {
      ok: true,
      totalDays,
      years,
      months,
      days: only.to - anchor + inclusive,
      convention,
      rows,
      overlaps,
    };
  }

  return {
    ok: true,
    totalDays,
    years: Math.floor(totalDays / 360),
    months: Math.floor((totalDays % 360) / 30),
    days: (totalDays % 360) % 30,
    convention,
    rows,
    overlaps,
  };
}
