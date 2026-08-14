/**
 * „Biznis i kancelarija" — the arithmetic behind the toolkit's tools.
 *
 * **One file per PACK, not per category** (`pro/gradnja.ts` carries the full
 * reasoning). A tool several packs share lives in the file of its FIRST pack in
 * `TOOL_PACKS` order, which is a rule with no judgement in it.
 *
 * **Money is counted in whole smallest units wherever a total has to close.**
 * `depositInstalments` and `shareAllocation` both promise that the parts add up
 * to the whole exactly, and no sequence of decimal roundings gives that: the one
 * construction that does is to divide an integer count of paras and hand the
 * remainder out a single unit at a time. Everywhere else the exact quotient comes
 * back unrounded and the two decimals are the surface's, because a number rounded
 * here and multiplied there is the defect this catalogue keeps naming — a day
 * rate built from a rounded hourly rate drifts further with every day billed.
 *
 * **No rate, no term, no holiday and no tariff is embedded.** A statutory
 * interest rate, a payment term, the list of public holidays and a commission
 * scale are `regulated`-tier constants: somebody else legislates or negotiates
 * them and changes them without telling this app, so an embedded copy is wrong
 * from its first edit. They are inputs with no default, and a tool that was not
 * given one does not guess it.
 *
 * **Nothing here decides anything.** `paymentDueDate` computes a date and a count
 * of days; whether a right has lapsed is for the lawyer holding the contract.
 * `ibanCheck`, `paymentReferenceVerify` and `taxIdVerify` state whether a string
 * satisfies a checksum — never that an account exists, is open, is correctly
 * routed, or belongs to anybody.
 */

import {
  fail,
  floorSnapped,
  isInRange,
  isIntegerIn,
  isNonNegative,
  isPositive,
  roundHalfUp,
  type ProResult,
} from "./result.js";

/* -------------------------------------------------------------------------- */
/* Calendar arithmetic, shared by three tools                                  */
/* -------------------------------------------------------------------------- */

/**
 * A date with no clock, no zone and no `Date` object anywhere near it.
 *
 * Three tools here take dates, and every one of them would be impure the moment
 * a `Date` appeared: `new Date("2026-03-12")` is midnight UTC, prints as the 11th
 * west of Greenwich, and shifts again twice a year. Whole days over the Julian
 * day number have none of that, and the arithmetic is exact in integers.
 */
export interface CalendarDate {
  readonly year: number;
  /** 1–12. January is 1, not 0 — the `Date` convention is a defect magnet. */
  readonly month: number;
  readonly day: number;
}

/** The Gregorian calendar's first full year; before it these formulas do not apply. */
const MIN_YEAR = 1583;
const MAX_YEAR = 9999;

/** Divisible by 4, except centuries that are not divisible by 400. */
const isLeapYear = (year: number): boolean =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** Length of a month. A month outside 1–12 gets 0, so every day in it is invalid. */
function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  const length = MONTH_LENGTHS[month - 1];
  return length === undefined ? 0 : length;
}

function isValidDate(date: CalendarDate): boolean {
  if (!isIntegerIn(date.year, MIN_YEAR, MAX_YEAR)) return false;
  if (!isIntegerIn(date.month, 1, 12)) return false;
  return isIntegerIn(date.day, 1, daysInMonth(date.year, date.month));
}

/** Julian day number of a Gregorian date — the standard integer-only conversion. */
function dateToJdn(date: CalendarDate): number {
  const a = Math.floor((14 - date.month) / 12);
  const y = date.year + 4800 - a;
  const m = date.month + 12 * a - 3;
  return (
    date.day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

/** The exact inverse of `dateToJdn`, so „+ N days" needs no month bookkeeping. */
function jdnToDate(jdn: number): CalendarDate {
  const a = jdn + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  };
}

/**
 * 0 = Monday … 6 = Sunday. A number, because the day's NAME is the surface's.
 *
 * The anchor is 01.01.2000, JDN 2451545, and 2451545 mod 7 = 5 — which under this
 * mapping is Saturday, and 01.01.2000 was a Saturday.
 */
const weekdayFromJdn = (jdn: number): number => jdn % 7;

/** Which way a computed date on a non-working day moves. */
export type ShiftDirection = "forward" | "backward";

/** A list of thirty consecutive non-working days caps the walk instead of looping. */
const MAX_SHIFT_STEPS = 30;

/**
 * Walk a Julian day number off a weekend and a holiday list, one day at a
 * time, capped at `MAX_SHIFT_STEPS` — shared by `paymentDueDate` and
 * `depositInstalments`, which both move a computed date away from days a
 * calendar the user supplies marks as closed, and neither of which is
 * entitled to its own copy of the walk.
 */
function shiftOffNonWorkingDays(
  startJdn: number,
  weekend: ReadonlySet<number>,
  closed: ReadonlySet<number>,
  direction: ShiftDirection,
): { readonly jdn: number; readonly shiftedDays: number; readonly capReached: boolean } {
  const step = direction === "forward" ? 1 : -1;
  let jdn = startJdn;
  let shiftedDays = 0;
  let capReached = false;
  while (weekend.has(weekdayFromJdn(jdn)) || closed.has(jdn)) {
    if (shiftedDays >= MAX_SHIFT_STEPS) {
      capReached = true;
      break;
    }
    jdn += step;
    shiftedDays += 1;
  }
  return { jdn, shiftedDays, capReached };
}

/**
 * Add whole months, keeping the day of the month and clamping to the target
 * month's last day (31.01 + 1 month = 28.02, never 03.03).
 *
 * Callers must always measure from the ORIGINAL date rather than chaining month
 * by month: chaining passes through February once and the day is stuck on 28 for
 * every later step.
 */
function addMonthsClamped(date: CalendarDate, months: number): CalendarDate {
  const total = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12 + 1;
  return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}

/* -------------------------------------------------------------------------- */
/* Checksum arithmetic, shared by three tools                                  */
/* -------------------------------------------------------------------------- */

const CODE_ZERO = 48;
const CODE_NINE = 57;
const CODE_A = 65;
const CODE_Z = 90;

/**
 * Strip the separators a person types — space, non-breaking space (`\s`
 * already covers both), hyphen and dot — and fold to upper case (locale-free).
 */
const normalizeAlnum = (text: string): string => text.replace(/[\s.-]/g, "").toUpperCase();

/**
 * MOD 97-10 (ISO/IEC 7064:2003) over digits and capitals, letters expanded
 * A=10 … Z=35 as TWO digits, computed one character at a time.
 *
 * The loop is the whole point: after the letter expansion an IBAN is up to 40
 * digits long, `Number("...")` would silently drop everything past 2^53, and the
 * tool would answer with a wrong check pair and no error on screen.
 * Returns undefined when a character is outside 0-9 A-Z.
 */
function mod97OverAlnum(text: string): number | undefined {
  let remainder = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= CODE_ZERO && code <= CODE_NINE) {
      remainder = (remainder * 10 + (code - CODE_ZERO)) % 97;
    } else if (code >= CODE_A && code <= CODE_Z) {
      remainder = (remainder * 100 + (code - 55)) % 97;
    } else {
      return undefined;
    }
  }
  return remainder;
}

/** MOD 97-10 over a string already known to hold nothing but digits. */
function mod97OverDigits(digits: string): number {
  let remainder = 0;
  for (let i = 0; i < digits.length; i += 1) {
    remainder = (remainder * 10 + (digits.charCodeAt(i) - CODE_ZERO)) % 97;
  }
  return remainder;
}

/** Separators removed; undefined when anything other than a digit survives. */
function digitsOnly(text: string): string | undefined {
  const stripped = text.replace(/[\s-]/g, "");
  return /^[0-9]+$/.test(stripped) ? stripped : undefined;
}

const pad2 = (value: number): string => (value < 10 ? `0${value}` : String(value));

/* -------------------------------------------------------------------------- */
/* Allocation arithmetic, shared by two tools                                  */
/* -------------------------------------------------------------------------- */

interface UnitAllocation {
  readonly units: readonly number[];
  /** Which rows (by index into the weights list) received one of the leftover units. */
  readonly extraUnitIndices: ReadonlySet<number>;
}

/**
 * The largest-remainder method (Hare/Hamilton), over whole UNITS, so the parts
 * always sum to `total` exactly. `depositInstalments` and `shareAllocation` are
 * the same allocator applied to two different weight lists — N equal weights
 * for equal instalments, the user's own weights for a share split — and
 * writing the remainder rule twice was the four-copies-of-the-arithmetic
 * defect at the scale of a single file.
 *
 * **Weights are scaled to integers before a remainder is compared.** Two equal
 * weights computed as floating-point quotients do not reliably produce two
 * IDENTICAL remainders — binary floating point is not required to compute
 * `1000·1/3` the same way twice — and a largest-remainder method that cannot
 * tell a real tie from a rounding artefact answers a different, unreproducible
 * order every time it runs. Scaling every weight by the same power of ten
 * (from the longest decimal any of them was typed with) and dividing with
 * `BigInt` makes every remainder exact, so equal weights are exactly equal
 * remainders and the documented tie-break — earlier row wins — is the thing
 * that actually decides.
 *
 * Returns `undefined` for an empty list, a negative or non-finite weight, a
 * weight written in exponential notation (scaling it by decimal count would be
 * wrong), or a list that sums to zero.
 */
function allocateWholeUnits(
  total: number,
  weights: readonly number[],
): UnitAllocation | undefined {
  if (weights.length === 0) return undefined;
  let maxDecimals = 0;
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight < 0) return undefined;
    const text = weight.toString();
    if (text.includes("e") || text.includes("E")) return undefined;
    const dot = text.indexOf(".");
    const decimals = dot === -1 ? 0 : text.length - dot - 1;
    if (decimals > maxDecimals) maxDecimals = decimals;
  }

  const scale = 10 ** maxDecimals;
  const scaledWeights = weights.map((weight) => Math.round(weight * scale));
  const sumScaled = scaledWeights.reduce((sum, weight) => sum + weight, 0);
  if (sumScaled <= 0) return undefined;

  const totalUnits = BigInt(Math.round(total));
  const sumBig = BigInt(sumScaled);
  const bases: bigint[] = [];
  const remainders: bigint[] = [];
  for (const weight of scaledWeights) {
    const weightBig = BigInt(weight);
    const base = (totalUnits * weightBig) / sumBig;
    bases.push(base);
    remainders.push(totalUnits * weightBig - base * sumBig);
  }
  const allocatedBig = bases.reduce((sum, base) => sum + base, 0n);
  const leftover = Number(totalUnits - allocatedBig);

  // Largest remainder first; equal remainders keep the order they were given
  // in, so the result is reproducible and never depends on sort stability.
  const order = remainders
    .map((remainder, index) => ({ index, remainder }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );

  const units = bases.map((base) => Number(base));
  const extraUnitIndices = new Set<number>();
  for (let i = 0; i < leftover && i < order.length; i += 1) {
    const row = order[i];
    if (row !== undefined) {
      units[row.index] = (units[row.index] ?? 0) + 1;
      extraUnitIndices.add(row.index);
    }
  }
  return { units, extraUnitIndices };
}

/* -------------------------------------------------------------------------- */
/* billable-hours                                                              */
/* -------------------------------------------------------------------------- */

/** Which way a part-interval is taken to a whole one. */
export type RoundingRule = "up" | "nearest" | "down";

/** Whether each entry is rounded, or only their sum. These are two numbers. */
export type RoundingPlace = "perItem" | "total";

export interface DurationParse {
  /** Whole minutes. Everything downstream counts minutes, never fractional hours. */
  readonly minutes: number;
}

/**
 * One typed time entry, in whole minutes.
 *
 * Three notations, and the one that decides the others is the bare number: „45"
 * with no unit and no colon is DECIMAL HOURS, not 45 minutes, because „1,75" has
 * to mean an hour and three quarters. Minutes standing alone must carry their
 * unit („45min"). A decimal is converted to minutes first and rounded once, half
 * up, so 1,005 h is 60 minutes rather than 60,3 — every later step is integer.
 */
export function parseDurationMinutes(text: string): ProResult<DurationParse> {
  const compact = text.replace(/\s+/g, "").toLowerCase();
  if (compact.length === 0) return fail("entry");

  const colon = /^(\d+):(\d{1,2})$/.exec(compact);
  if (colon !== null) {
    const hours = Number(colon[1]);
    const minutes = Number(colon[2]);
    // 1:75 is a typo, not 2:15 — in H:MM the minute field is a clock field.
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes > 59) return fail("entry");
    return { ok: true, minutes: hours * 60 + minutes };
  }

  const unit = /^(?:(\d+(?:[.,]\d+)?)h)?(?:(\d+(?:[.,]\d+)?)(?:min|m))?$/.exec(compact);
  if (unit !== null && (unit[1] !== undefined || unit[2] !== undefined)) {
    const hours = unit[1] === undefined ? 0 : Number(unit[1].replace(",", "."));
    const minutes = unit[2] === undefined ? 0 : Number(unit[2].replace(",", "."));
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fail("entry");
    return { ok: true, minutes: Math.round(hours * 60 + minutes) };
  }

  if (/^\d+(?:[.,]\d+)?$/.test(compact)) {
    const hours = Number(compact.replace(",", "."));
    if (!Number.isFinite(hours)) return fail("entry");
    return { ok: true, minutes: Math.round(hours * 60) };
  }
  return fail("entry");
}

/**
 * Round whole minutes onto an interval. `interval` of 0 means no rounding.
 *
 * Written with floor and a remainder rather than `ceil`, so that the „exactly
 * half" decision is visible: at half an interval the nearest rule goes UP. That
 * is a decision, not a consequence, and it is the one a client argues about.
 * The interval need not divide 60 — 7-minute billing works out of the same lines.
 */
function roundToInterval(minutes: number, interval: number, rule: RoundingRule): number {
  if (interval <= 0) return minutes;
  const whole = Math.floor(minutes / interval) * interval;
  const rest = minutes - whole;
  if (rule === "down" || rest === 0) return whole;
  if (rule === "up") return whole + interval;
  return rest * 2 >= interval ? whole + interval : whole;
}

const formatHhmm = (minutes: number): string =>
  `${Math.floor(minutes / 60)}:${pad2(minutes % 60)}`;

export interface BillableHoursInput {
  /** One typed entry per line; a blank line is refused rather than skipped. */
  readonly entries: readonly string[];
  /** Rounding interval in minutes, 1–120. Absent or 0 means no rounding at all. */
  readonly intervalMinutes?: number | undefined;
  readonly rule: RoundingRule;
  readonly place: RoundingPlace;
  /** Money per hour. Zero is allowed — an unbilled log is still a time sheet. */
  readonly rate: number;
}

export interface BillableHoursResult {
  /** Whole minutes per entry, as typed. */
  readonly entryMinutes: readonly number[];
  /** What each entry contributes; identical to `entryMinutes` when rounding the total. */
  readonly entryBilledMinutes: readonly number[];
  readonly actualMinutes: number;
  readonly actualHours: number;
  /** The actual total as H:MM. Hours are not capped at 24. */
  readonly actualHhmm: string;
  readonly billedMinutes: number;
  readonly billedHours: number;
  readonly billedHhmm: string;
  /** What the time actually spent would come to, for comparison. */
  readonly actualAmount: number;
  readonly amount: number;
  /**
   * The billing interval this run applied, minutes — 0 meaning „bill the exact
   * time". See `ShelfSpacingResult.rasterUsed`: the echo restated its own `"0"`
   * for an empty field while the arithmetic applied this one, and this is the
   * number that decides every rounded entry above it.
   */
  readonly intervalMinutesUsed: number;
  /** Billed minus actual: positive when rounding added time, negative when it took some. */
  readonly deltaMinutes: number;
  readonly deltaAmount: number;
}

/**
 * A time sheet totalled, rounded onto the contracted interval and priced.
 *
 * **Where the rounding happens is an input because it changes the invoice.** The
 * same three entries rounded up per item and rounded up on the sum differ by a
 * quarter of an hour on this catalogue's own vector; the tool refuses to pick one
 * silently. Both totals come back — actual and billed — so what the rounding did
 * is a number on the screen rather than a discrepancy the client finds.
 *
 * The amount is computed from whole minutes, never from the decimal hours the
 * surface prints to four places.
 */
export function billableHours(input: BillableHoursInput): ProResult<BillableHoursResult> {
  const interval = input.intervalMinutes ?? 0;
  if (interval !== 0 && !isIntegerIn(interval, 1, 120)) return fail("intervalMinutes");
  if (!isNonNegative(input.rate)) return fail("rate");

  const entryMinutes: number[] = [];
  for (const entry of input.entries) {
    const parsed = parseDurationMinutes(entry);
    if (!parsed.ok) return fail("entries");
    entryMinutes.push(parsed.minutes);
  }

  const perItem = input.place === "perItem";
  const entryBilledMinutes = entryMinutes.map((minutes) =>
    perItem ? roundToInterval(minutes, interval, input.rule) : minutes,
  );
  const actualMinutes = entryMinutes.reduce((sum, minutes) => sum + minutes, 0);
  const summed = entryBilledMinutes.reduce((sum, minutes) => sum + minutes, 0);
  const billedMinutes = perItem ? summed : roundToInterval(summed, interval, input.rule);

  const actualAmount = (actualMinutes / 60) * input.rate;
  const amount = (billedMinutes / 60) * input.rate;
  return {
    ok: true,
    entryMinutes,
    entryBilledMinutes,
    actualMinutes,
    actualHours: actualMinutes / 60,
    actualHhmm: formatHhmm(actualMinutes),
    billedMinutes,
    billedHours: billedMinutes / 60,
    billedHhmm: formatHhmm(billedMinutes),
    actualAmount,
    amount,
    deltaMinutes: billedMinutes - actualMinutes,
    deltaAmount: amount - actualAmount,
    intervalMinutesUsed: interval,
  };
}

/* -------------------------------------------------------------------------- */
/* break-even                                                                  */
/* -------------------------------------------------------------------------- */

export interface BreakEvenInput {
  readonly fixedCosts: number;
  readonly price: number;
  readonly variableCost: number;
  /**
   * Absent means no profit goal was set — not a goal of zero. Must be for the
   * SAME period as `fixedCosts`: an annual goal added to a monthly fixed-cost
   * figure sums two different time bases as though they were one number, and
   * that mistake is invisible in the arithmetic — it can only be caught by
   * whoever typed the two figures in. SURFACE: the field's own label must say
   * which period, because this is a mistake the arithmetic cannot catch.
   */
  readonly targetProfit?: number | undefined;
  /**
   * Optional, and only for the margin of safety. Zero or negative is treated
   * the same as absent — a plan of zero units is not a plan, and the margin
   * fields simply stay unset rather than making the whole computation refuse
   * an otherwise complete input over an unused optional field.
   */
  readonly plannedUnits?: number | undefined;
}

export interface BreakEvenResult {
  readonly contributionMargin: number;
  readonly contributionMarginPercent: number;
  /** The unrounded count, so it is visible how much rounding up added. */
  readonly exactUnits: number;
  readonly units: number;
  /** fixedCosts / kmProcenat — revenue at the EXACT, unrounded break-even point. */
  readonly breakEvenRevenue: number;
  /** `units` (the whole, sellable count) times price — what actually gets billed. */
  readonly revenueAtUnits: number;
  /** units·contributionMargin − fixedCosts — what rounding UP the unit count buys. */
  readonly surplusAtUnits: number;
  /** The unrounded unit count for the profit goal, alongside the rounded one below. */
  readonly exactUnitsForProfit: number | undefined;
  readonly unitsForProfit: number | undefined;
  /** unitsForProfit × price, symmetric with `revenueAtUnits`. */
  readonly revenueForProfit: number | undefined;
  /** Negative when the plan sits below break-even; shown as the number it is. */
  readonly marginOfSafetyPercent: number | undefined;
  readonly marginOfSafetyUnits: number | undefined;
  readonly marginOfSafetyAmount: number | undefined;
}

/**
 * Break-even in units and in revenue, from fixed costs and one unit's economics.
 *
 * **Rounding up is the only correct direction and the exact figure is returned
 * beside it.** Rounded down, the last unit does not cover the fixed costs — 200
 * units at a 499 margin leave 200 of a 100.000 block uncovered — so the answer is
 * `ceil`, and the exact quotient is there so the „up" is not invisible.
 * `revenueAtUnits` and `surplusAtUnits` say exactly what that rounding bought:
 * nobody sells 200,4 units, so the revenue and the cushion at the SELLABLE count
 * are the numbers that matter next to the textbook `breakEvenRevenue`, which is
 * revenue at a unit count nobody can actually reach.
 *
 * **A contribution margin of exactly zero and a negative one are different
 * facts, not the same refusal spelled twice.** At zero, every further unit
 * leaves the loss sitting exactly at the fixed costs — it does not widen it —
 * while a negative margin makes every further unit worse. The two get distinct
 * reason keys because this layer has no sentence to draw that distinction with;
 * only the reason key can.
 */
export function breakEven(input: BreakEvenInput): ProResult<BreakEvenResult> {
  const { fixedCosts, price, variableCost } = input;
  if (!isNonNegative(fixedCosts)) return fail("fixedCosts");
  if (!isPositive(price)) return fail("price");
  if (!isNonNegative(variableCost)) return fail("variableCost");
  if (input.targetProfit !== undefined && !isNonNegative(input.targetProfit)) {
    return fail("targetProfit");
  }
  if (input.plannedUnits !== undefined && !Number.isFinite(input.plannedUnits)) {
    return fail("plannedUnits");
  }

  const contributionMargin = price - variableCost;
  if (contributionMargin === 0) return fail("contributionMarginZero");
  if (contributionMargin < 0) return fail("contributionMarginNegative");

  const exactUnits = fixedCosts / contributionMargin;
  const units = Math.ceil(exactUnits);
  const target = input.targetProfit;
  // A planned quantity of zero or less is not a plan to measure against — it
  // is treated as no plan was typed rather than refusing an otherwise
  // complete input over an optional field nobody meant to fill in.
  const planned =
    input.plannedUnits !== undefined && input.plannedUnits > 0 ? input.plannedUnits : undefined;
  const exactUnitsForProfit =
    target === undefined ? undefined : (fixedCosts + target) / contributionMargin;
  const unitsForProfit =
    exactUnitsForProfit === undefined ? undefined : Math.ceil(exactUnitsForProfit);
  return {
    ok: true,
    contributionMargin,
    contributionMarginPercent: (contributionMargin / price) * 100,
    exactUnits,
    units,
    // Algebraically fixedCosts / (contributionMargin / price); computed as the
    // exact unit count times the price, which is the same quantity with one
    // division fewer and no rounded percentage anywhere in it.
    breakEvenRevenue: exactUnits * price,
    revenueAtUnits: units * price,
    surplusAtUnits: units * contributionMargin - fixedCosts,
    exactUnitsForProfit,
    unitsForProfit,
    revenueForProfit: unitsForProfit === undefined ? undefined : unitsForProfit * price,
    marginOfSafetyPercent:
      planned === undefined ? undefined : ((planned - exactUnits) / planned) * 100,
    marginOfSafetyUnits: planned === undefined ? undefined : planned - exactUnits,
    marginOfSafetyAmount: planned === undefined ? undefined : (planned - exactUnits) * price,
  };
}

/* -------------------------------------------------------------------------- */
/* chained-discount                                                            */
/* -------------------------------------------------------------------------- */

/**
 * `roundHalfUp(value, 2)` (from `./result.js`) is used below for
 * `totalDiscount` only — the one place in this file where rounding is not the
 * surface's job. Everywhere else a figure is returned unrounded, but
 * `totalDiscount` is a printed total that has to reconcile with two OTHER
 * printed numbers, and no amount of surface-side rounding discipline can make
 * that true on its own — see the note on `totalDiscount` below.
 */

export interface ChainedDiscountInput {
  readonly basePrice: number;
  /** Percent per step. A negative step is a surcharge and has no lower bound. */
  readonly steps: readonly number[];
}

export interface ChainedDiscountResult {
  /** The price after each step, unrounded; the surface prints two decimals. */
  readonly stepPrices: readonly number[];
  /** What each step removed (positive) or added (negative), vs. the price before it. */
  readonly stepDeltas: readonly number[];
  readonly finalPrice: number;
  /**
   * `basePrice` minus the ROUNDED `finalPrice`, not the unrounded one. The
   * unrounded subtraction is exact by construction, but the surface prints
   * `finalPrice` and `totalDiscount` at two decimals SEPARATELY: 2.500 chained
   * through 15 % and 7,5 % gives 1.965,625, which prints as 1.965,63, while
   * 2.500 − 1.965,625 = 534,375 prints as 534,38 — and 1.965,63 + 534,38 =
   * 2.500,01, a cent that does not exist. Subtracting the already-rounded
   * final price is what makes the two printed numbers add back to the printed
   * base price.
   */
  readonly totalDiscount: number;
  /** The product of (1 − d) over every step. Above 1 means a net SURCHARGE. */
  readonly factor: number;
  /**
   * The single discount equivalent to the whole chain, in percent to 4
   * decimals: 15 % chained with 7,5 % is exactly 21,3750 %, and two decimals
   * would assert 21,38 % — a different number. NEGATIVE means the chain is a
   * net surcharge rather than a net discount; the surface renames the field
   * accordingly, this stays the signed number it is.
   */
  readonly equivalentDiscountPercent: number;
}

/**
 * A chain of discounts and surcharges, and the one discount equivalent to it.
 *
 * **Every step multiplies the unrounded price**, and `stepPrices` reports every
 * intermediate unrounded too. Rounding each intermediate to two decimals and
 * carrying that forward gives a different final amount, and it is the single
 * most common error in the spreadsheet that does this by hand.
 *
 * **The final price does not depend on the order of the steps — the factor is a
 * product, and multiplication commutes — but every intermediate does**, which is
 * why `stepDeltas` reports what each individual step took or added rather than
 * leaving the reader to infer it from reordering `stepPrices`.
 *
 * A step above 100 % is refused; it would make the price negative. A step of
 * exactly 100 % is allowed and zeroes the factor, so no LATER step — discount or
 * surcharge alike — has any further effect on the final price.
 */
export function chainedDiscount(input: ChainedDiscountInput): ProResult<ChainedDiscountResult> {
  if (!isNonNegative(input.basePrice)) return fail("basePrice");
  for (const step of input.steps) {
    if (!Number.isFinite(step) || step > 100) return fail("steps");
  }

  let factor = 1;
  let previous = input.basePrice;
  const stepPrices: number[] = [];
  const stepDeltas: number[] = [];
  for (const step of input.steps) {
    factor *= 1 - step / 100;
    const price = input.basePrice * factor;
    stepPrices.push(price);
    stepDeltas.push(previous - price);
    previous = price;
  }
  const finalPrice = input.basePrice * factor;
  return {
    ok: true,
    stepPrices,
    stepDeltas,
    finalPrice,
    totalDiscount: input.basePrice - roundHalfUp(finalPrice, 2),
    factor,
    equivalentDiscountPercent: (1 - factor) * 100,
  };
}

/* -------------------------------------------------------------------------- */
/* deposit-instalments                                                         */
/* -------------------------------------------------------------------------- */

/** A deposit typed as a percentage of the contract, or as a plain amount. */
export type DepositKind = "percent" | "amount";

/** How large a milestone row is. Percent is always of the CONTRACT VALUE. */
export type InstalmentRowInput =
  | {
      readonly kind: "percent";
      /** Percent of the contract value — never of what is left after the deposit. */
      readonly percent: number;
      readonly date: CalendarDate;
    }
  | { readonly kind: "fixed"; readonly amount: number; readonly date: CalendarDate }
  | { readonly kind: "equal"; readonly date: CalendarDate };

/**
 * The non-working-day fields every schedule variant shares. All four are
 * optional and default to off/empty/forward, so a caller that never mentions
 * them gets exactly yesterday's behaviour — every date lands where
 * `addMonthsClamped` or the row itself put it, unmoved.
 */
interface NonWorkingDayFields {
  /** Whether an instalment date landing on a non-working day moves at all. */
  readonly shiftOffNonWorkingDays?: boolean;
  /** Weekdays treated as non-working, 0 = Monday … 6 = Sunday. Saturday and
   *  Sunday is the common case but is a convention, not a property of the
   *  calendar — see `paymentDueDate`'s field of the same name. */
  readonly weekendDays?: readonly number[];
  /** The user's own holidays; this tool has no holiday calendar of any country. */
  readonly nonWorkingDays?: readonly CalendarDate[];
  /** Which way a closed date moves — forward to the next working day, or
   *  back to the preceding one. Defaults to forward. */
  readonly shiftDirection?: ShiftDirection;
}

/**
 * Equal instalments spaced by `stepMonths` from `firstDate` (the `"equal"`
 * schedule, `schedule` omitted or `"equal"`), or explicit milestone `rows` — the
 * merge with the event pack's „Rate i avansi" proposal: every row carries its
 * own date and its own sizing rule (a fixed amount, a percent of the contract,
 * or an equal share of whatever the fixed and percent rows left). Both schedules
 * share the same avans, the same allocator and the same calendar.
 */
export type DepositInstalmentsInput =
  | ({
      readonly schedule?: "equal";
      readonly contractValue: number;
      readonly depositKind: DepositKind;
      /** Percent 0–100, or an amount between 0 and the contract value. */
      readonly deposit: number;
      readonly instalments: number;
      readonly firstDate: CalendarDate;
      readonly stepMonths: number;
      /** The smallest unit money is written in — 0,01 for paras, 1 for whole dinars. */
      readonly unit: number;
    } & NonWorkingDayFields)
  | ({
      readonly schedule: "rows";
      readonly contractValue: number;
      readonly depositKind: DepositKind;
      readonly deposit: number;
      /** At least one row; fixed and percent rows are sized independently of
       *  each other and of the deposit, so together they can overshoot the
       *  contract — see `depositInstalments`'s note on `rowsExceedContract`. */
      readonly rows: readonly InstalmentRowInput[];
      readonly unit: number;
    } & NonWorkingDayFields);

export interface Instalment {
  /** 1-based. */
  readonly index: number;
  /** The final date, after any non-working-day shift. */
  readonly date: CalendarDate;
  /** The date before the shift; equal to `date` when shifting is off or idle. */
  readonly dateBeforeShift: CalendarDate;
  /** How many days the shift moved this instalment; 0 when off or idle. */
  readonly shiftedDays: number;
  readonly amount: number;
  /** The same amount in whole smallest units — where the exactness actually lives. */
  readonly units: number;
  /** Still owed after this instalment. */
  readonly remaining: number;
}

export interface DepositInstalmentsResult {
  readonly depositAmount: number;
  readonly depositUnits: number;
  readonly instalments: readonly Instalment[];
  /** Deposit plus every instalment, in whole units. */
  readonly checkSumUnits: number;
  /** The same total in money: the contract value expressed in whole units. */
  readonly checkSum: number;
  /** True when shifting some instalment off a non-working day used all 30 of
   *  its steps without landing on a working one — see `paymentDueDate`'s
   *  field of the same name for what that means for the date it stopped at. */
  readonly capReached: boolean;
}

/** Resolved, validated non-working-day settings, ready to apply to a date. */
interface ShiftSettings {
  readonly active: boolean;
  readonly weekend: ReadonlySet<number>;
  readonly closed: ReadonlySet<number>;
  readonly direction: ShiftDirection;
}

function resolveShiftSettings(fields: NonWorkingDayFields): ProResult<ShiftSettings> {
  const weekendDays = fields.weekendDays ?? [];
  for (const weekday of weekendDays) {
    if (!isIntegerIn(weekday, 0, 6)) return fail("weekendDays");
  }
  const closed = new Set<number>();
  for (const day of fields.nonWorkingDays ?? []) {
    if (!isValidDate(day)) return fail("nonWorkingDays");
    closed.add(dateToJdn(day));
  }
  return {
    ok: true,
    active: fields.shiftOffNonWorkingDays ?? false,
    weekend: new Set(weekendDays),
    closed,
    direction: fields.shiftDirection ?? "forward",
  };
}

/** Apply (or skip) the shift for one instalment date. */
function shiftInstalmentDate(
  date: CalendarDate,
  shift: ShiftSettings,
): { readonly date: CalendarDate; readonly shiftedDays: number; readonly capReached: boolean } {
  if (!shift.active) return { date, shiftedDays: 0, capReached: false };
  const startJdn = dateToJdn(date);
  const walked = shiftOffNonWorkingDays(startJdn, shift.weekend, shift.closed, shift.direction);
  return {
    date: jdnToDate(walked.jdn),
    shiftedDays: walked.shiftedDays,
    capReached: walked.capReached,
  };
}

/**
 * The milestone schedule: each row is sized on its own — a fixed amount, a
 * percent of the CONTRACT VALUE, or an equal share of what the fixed and
 * percent rows left — and keeps the date the caller gave it.
 *
 * **An overshoot is REPORTED, never scaled away.** Nothing here divides a row
 * down to make the numbers fit: `fixed 20.000 + 30 % + 70 %` on a 100.000
 * contract commits 120.000, and silently shrinking every row to 100.000/120.000
 * of itself would be an amount the user never typed printed as though it were.
 * The same applies to an undershoot with no `"equal"` row to absorb it — the
 * plan is refused rather than left short of the contract value.
 */
function depositInstalmentsRows(
  totalUnits: number,
  depositUnits: number,
  rows: readonly InstalmentRowInput[],
  unit: number,
  shift: ShiftSettings,
): ProResult<DepositInstalmentsResult> {
  if (rows.length === 0) return fail("rows");
  const available = totalUnits - depositUnits;

  const rowUnits = new Array<number>(rows.length).fill(0);
  const equalIndices: number[] = [];
  let committed = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row === undefined || !isValidDate(row.date)) return fail("rows");
    if (row.kind === "fixed") {
      if (!isNonNegative(row.amount)) return fail("rows");
      const units = Math.round(row.amount / unit);
      rowUnits[i] = units;
      committed += units;
    } else if (row.kind === "percent") {
      if (!isInRange(row.percent, 0, 100)) return fail("rows");
      const units = Math.round((totalUnits * row.percent) / 100);
      rowUnits[i] = units;
      committed += units;
    } else {
      equalIndices.push(i);
    }
  }
  if (committed > available) return fail("rowsExceedContract");

  const leftover = available - committed;
  if (equalIndices.length === 0) {
    if (leftover !== 0) return fail("rowsIncomplete");
  } else {
    const allocation = allocateWholeUnits(leftover, equalIndices.map(() => 1));
    if (allocation === undefined) return fail("rows");
    equalIndices.forEach((rowIndex, orderIndex) => {
      rowUnits[rowIndex] = allocation.units[orderIndex] ?? 0;
    });
  }

  const out: Instalment[] = [];
  let left = available;
  let capReached = false;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row === undefined) return fail("rows");
    const units = rowUnits[i] ?? 0;
    left -= units;
    const moved = shiftInstalmentDate(row.date, shift);
    if (moved.capReached) capReached = true;
    out.push({
      index: i + 1,
      date: moved.date,
      dateBeforeShift: row.date,
      shiftedDays: moved.shiftedDays,
      amount: units * unit,
      units,
      remaining: left * unit,
    });
  }

  return {
    ok: true,
    depositAmount: depositUnits * unit,
    depositUnits,
    instalments: out,
    checkSumUnits: totalUnits,
    checkSum: totalUnits * unit,
    capReached,
  };
}

/**
 * A deposit and instalments whose sum is exactly the contract value.
 *
 * **The remainder goes onto the FIRST instalments, not the last**, in the equal
 * schedule. Dividing 1.000 into seven parts, a last instalment carrying the
 * remainder is 148 against six of 142 — six units out of step; handing one unit
 * each to the first six makes no instalment differ from another by more than a
 * single unit.
 *
 * **The contract value must itself be a whole multiple of `unit`.** Every step
 * downstream is integer arithmetic over units, and `Math.round(contractValue /
 * unit)` silently drops or invents a fraction of a unit the moment it is not:
 * 1.050,40 at a whole-dinar unit rounds to 1.050 and forty para vanish with no
 * error on screen, which is worse than the refusal.
 *
 * Every step is integer arithmetic over the smallest unit, so the control sum
 * does not depend on the order the amounts are added in. In the equal schedule,
 * dates are always measured from the FIRST date: chaining month by month passes
 * through February once and then the day is stuck on the 28th forever.
 *
 * **Shifting off a non-working day only ever moves the DATE, never the
 * money.** `shiftOffNonWorkingDays`/`weekendDays`/`nonWorkingDays`/
 * `shiftDirection` are the same rule `paymentDueDate` uses, off by default and
 * shared through `shiftOffNonWorkingDays` (the calendar helper, not the flag
 * of the same name) — Saturday and Sunday is a convention this tool assumes
 * nothing about, and a milestone falling on a closed day only moves when the
 * caller says so and says which way.
 */
export function depositInstalments(
  input: DepositInstalmentsInput,
): ProResult<DepositInstalmentsResult> {
  const { contractValue, unit } = input;
  if (!isPositive(contractValue)) return fail("contractValue");
  if (!isPositive(unit)) return fail("unit");

  const percentMode = input.depositKind === "percent";
  const limit = percentMode ? 100 : contractValue;
  if (!isInRange(input.deposit, 0, limit)) return fail("deposit");
  const depositRaw = percentMode ? (contractValue * input.deposit) / 100 : input.deposit;

  const totalUnitsExact = contractValue / unit;
  const totalUnits = Math.round(totalUnitsExact);
  // A TOLERANCE, not a rounding nudge: it decides whether the exact quotient
  // is close enough to a whole unit count to treat as one, and it must scale
  // with the count itself because floating-point division error grows with
  // the dividend — a fixed absolute 1e-6 band falsely refuses a legitimate
  // whole multiple once the unit count passes roughly 1e10 (a contract near
  // 100 million at para precision; the file's own vectors below stay under
  // that and are unaffected either way).
  if (Math.abs(totalUnitsExact - totalUnits) > 1e-6 * Math.max(1, totalUnits)) {
    return fail("contractValue");
  }
  const depositUnits = Math.round(depositRaw / unit);

  const shift = resolveShiftSettings(input);
  if (!shift.ok) return shift;

  if (input.schedule === "rows") {
    return depositInstalmentsRows(totalUnits, depositUnits, input.rows, unit, shift);
  }

  const { instalments, firstDate, stepMonths } = input;
  if (!isIntegerIn(instalments, 1, 600)) return fail("instalments");
  if (!isValidDate(firstDate)) return fail("firstDate");
  if (!isIntegerIn(stepMonths, 1, 120)) return fail("stepMonths");

  const remainingUnits = totalUnits - depositUnits;
  // Equal instalments are `allocateWholeUnits` with every weight the same 1 —
  // the shared largest-remainder allocator that also drives `shareAllocation`,
  // rather than a second, hand-written copy of the same remainder rule.
  const allocation = allocateWholeUnits(remainingUnits, new Array<number>(instalments).fill(1));
  if (allocation === undefined) return fail("instalments");

  const rows: Instalment[] = [];
  let left = remainingUnits;
  let capReached = false;
  for (let i = 1; i <= instalments; i += 1) {
    const units = allocation.units[i - 1] ?? 0;
    const dateBeforeShift = addMonthsClamped(firstDate, (i - 1) * stepMonths);
    if (!isValidDate(dateBeforeShift)) return fail("schedule");
    const moved = shiftInstalmentDate(dateBeforeShift, shift);
    if (moved.capReached) capReached = true;
    left -= units;
    rows.push({
      index: i,
      date: moved.date,
      dateBeforeShift,
      shiftedDays: moved.shiftedDays,
      amount: units * unit,
      units,
      remaining: left * unit,
    });
  }

  return {
    ok: true,
    depositAmount: depositUnits * unit,
    depositUnits,
    instalments: rows,
    checkSumUnits: totalUnits,
    checkSum: totalUnits * unit,
    capReached,
  };
}

/* -------------------------------------------------------------------------- */
/* hourly-rate-target                                                          */
/* -------------------------------------------------------------------------- */

/** Months in a year — the calendar's definition, not an accounting convention. */
const MONTHS_PER_YEAR = 12;

export interface HourlyRateTargetInput {
  /** What the year should earn before tax. The tool knows no tax rate whatsoever. */
  readonly targetEarnings: number;
  readonly businessCosts: number;
  /** Weeks actually worked, 1–53. Leave and holidays are the user's choice to make. */
  readonly workWeeks: number;
  readonly hoursPerWeek: number;
  /** Share of working time that is actually invoiced, above 0 and up to 100. */
  readonly billablePercent: number;
  readonly hoursPerDay: number;
}

export interface HourlyRateTargetResult {
  readonly billableHoursPerYear: number;
  readonly requiredRevenue: number;
  readonly hourlyRate: number;
  readonly dayRate: number;
  readonly monthlyRevenue: number;
}

/**
 * The hourly and daily rate a year's earnings and costs imply.
 *
 * **The day rate comes from the unrounded hourly rate.** Multiplying the printed
 * two-decimal rate by the hours in a day is a different number — three para a day
 * on this catalogue's own vector — and the gap grows with the length of the
 * engagement.
 *
 * What comes back is revenue to INVOICE, not take-home pay: no tax rate and no
 * contribution is built in, because those are numbers the state sets and changes,
 * and „before tax" is the name of a field rather than a claim that the tool knows
 * what comes off it.
 *
 * SURFACE: that distinction belongs IN the result block next to `hourlyRate`
 * and `dayRate`, not in a tooltip a reader may never open — this is the whole
 * point of the tool and the one fact most likely to be misread as pay.
 */
export function hourlyRateTarget(
  input: HourlyRateTargetInput,
): ProResult<HourlyRateTargetResult> {
  if (!isNonNegative(input.targetEarnings)) return fail("targetEarnings");
  if (!isNonNegative(input.businessCosts)) return fail("businessCosts");
  if (!isInRange(input.workWeeks, 1, 53)) return fail("workWeeks");
  if (!isPositive(input.hoursPerWeek)) return fail("hoursPerWeek");
  if (!isPositive(input.billablePercent) || input.billablePercent > 100) {
    return fail("billablePercent");
  }
  if (!isPositive(input.hoursPerDay)) return fail("hoursPerDay");

  const billableHoursPerYear = input.workWeeks * input.hoursPerWeek * (input.billablePercent / 100);
  // Each factor is already positive, so this can only vanish by underflow — but a
  // zero here would print an infinite rate, which is worse than a refusal.
  if (!isPositive(billableHoursPerYear)) return fail("billableHours");

  const requiredRevenue = input.targetEarnings + input.businessCosts;
  const hourlyRate = requiredRevenue / billableHoursPerYear;
  return {
    ok: true,
    billableHoursPerYear,
    requiredRevenue,
    hourlyRate,
    dayRate: hourlyRate * input.hoursPerDay,
    monthlyRevenue: requiredRevenue / MONTHS_PER_YEAR,
  };
}

/* -------------------------------------------------------------------------- */
/* iban-check                                                                  */
/* -------------------------------------------------------------------------- */

/** Groups of four characters, the paper format of ISO 13616-1:2020. */
function groupsOfFour(text: string): string {
  const groups: string[] = [];
  for (let i = 0; i < text.length; i += 4) groups.push(text.slice(i, i + 4));
  return groups.join(" ");
}

export interface IbanCheckResult {
  /** Separators removed, upper case. */
  readonly normalized: string;
  readonly length: number;
  readonly countryCode: string;
  /** The two check digits as typed. */
  readonly checkDigits: string;
  readonly bban: string;
  /** MOD 97-10 of the rearranged string. */
  readonly remainder: number;
  /** Whether that remainder is 1 — a fact about the arithmetic and nothing else. */
  readonly remainderIsOne: boolean;
  /** The check digits this country code and BBAN would need. */
  readonly expectedCheckDigits: string;
  /** countryCode + expectedCheckDigits + bban — the WHOLE number to re-copy, not just the pair. */
  readonly correctedIban: string;
  readonly correctedPaperFormat: string;
  readonly paperFormat: string;
}

/**
 * The MOD 97-10 check of a typed IBAN, and the check digits its BBAN would need.
 *
 * **The per-country length is deliberately not checked.** That register is kept by
 * SWIFT and changes whenever a country joins or reformats; a table compiled here
 * would be wrong at its first amendment. The arithmetic never changes, so the
 * arithmetic is what is checked and the length is merely reported as a number.
 * A structural check runs first regardless: the first two characters must be
 * letters and the next two digits, which is the shape of every IBAN ever
 * issued and catches a string that was never an IBAN before MOD 97-10 is asked
 * to make sense of it.
 *
 * **Both answers are returned because they are not the same question.** The
 * remainder being 1 is the classical check, but it is not equivalent to the check
 * digits being the ones ISO 13616 derives: where the BBAN's own remainder is 0 a
 * pair of „01" also leaves remainder 1, and where it is 1 so does „00", even
 * though 98 − r can never produce either (nor can „99" — r ≤ 96, so 98 − r ≥ 2).
 * `correctedIban` carries `expectedCheckDigits` all the way into a whole number,
 * because a person re-typing this into a payment order copies the account
 * number, not two isolated digits.
 */
export function ibanCheck(iban: string): ProResult<IbanCheckResult> {
  const normalized = normalizeAlnum(iban);
  if (!isInRange(normalized.length, 5, 34)) return fail("iban");
  if (!/^[A-Z]{2}[0-9]{2}[0-9A-Z]+$/.test(normalized)) return fail("iban");

  const countryCode = normalized.slice(0, 2);
  const checkDigits = normalized.slice(2, 4);
  const bban = normalized.slice(4);
  const remainder = mod97OverAlnum(bban + normalized.slice(0, 4));
  const zeroed = mod97OverAlnum(`${bban}${countryCode}00`);
  if (remainder === undefined || zeroed === undefined) return fail("iban");

  const expectedCheckDigits = pad2(98 - zeroed);
  const correctedIban = `${countryCode}${expectedCheckDigits}${bban}`;
  return {
    ok: true,
    normalized,
    length: normalized.length,
    countryCode,
    checkDigits,
    bban,
    remainder,
    remainderIsOne: remainder === 1,
    expectedCheckDigits,
    correctedIban,
    correctedPaperFormat: groupsOfFour(correctedIban),
    paperFormat: groupsOfFour(normalized),
  };
}

export interface IbanComposeResult {
  readonly checkDigits: string;
  readonly iban: string;
  readonly paperFormat: string;
  readonly length: number;
}

/**
 * An IBAN built from a country code and a domestic account number.
 *
 * The country code is typed by the user: this tool holds no list of countries and
 * asserts nothing about how long that country's IBAN should be. It moves the
 * country and „00" to the end, takes the remainder mod 97, and writes 98 − r.
 */
export function ibanCompose(countryCode: string, bban: string): ProResult<IbanComposeResult> {
  const country = normalizeAlnum(countryCode);
  const account = normalizeAlnum(bban);
  if (!/^[A-Z]{2}$/.test(country)) return fail("countryCode");
  if (!/^[0-9A-Z]{1,30}$/.test(account)) return fail("bban");

  const remainder = mod97OverAlnum(`${account}${country}00`);
  if (remainder === undefined) return fail("bban");
  const checkDigits = pad2(98 - remainder);
  const iban = `${country}${checkDigits}${account}`;
  return {
    ok: true,
    checkDigits,
    iban,
    paperFormat: groupsOfFour(iban),
    length: iban.length,
  };
}

/* -------------------------------------------------------------------------- */
/* margin-markup                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Which two of the four quantities the user actually has.
 *
 * A discriminated union, deliberately: it is what makes the five formula sets
 * unrepresentable in the wrong combination, which a single object with all
 * four fields and a same-object `mode` flag would not. SURFACE: `mode` must
 * be DERIVED from which two fields the form has populated, and the form must
 * never render a mode selector as a second, independent source of truth for
 * the same choice — nothing in this type enforces that; it is checked here.
 */
export type MarginMarkupInput =
  | { readonly mode: "costMarkup"; readonly cost: number; readonly markupPercent: number }
  | { readonly mode: "costMargin"; readonly cost: number; readonly marginPercent: number }
  | { readonly mode: "costPrice"; readonly cost: number; readonly price: number }
  | { readonly mode: "priceMargin"; readonly price: number; readonly marginPercent: number }
  | { readonly mode: "priceMarkup"; readonly price: number; readonly markupPercent: number };

export interface MarginMarkupResult {
  readonly cost: number;
  readonly price: number;
  /** Price minus cost, per unit. Negative when the price is below the cost. */
  readonly profit: number;
  /** Profit as a share of the SELLING price. */
  readonly marginPercent: number;
  /** Profit as a share of the PURCHASE price. */
  readonly markupPercent: number;
}

const derivePricing = (
  cost: number,
  price: number,
  margin: number,
  markup: number,
): ProResult<MarginMarkupResult> => ({
  ok: true,
  cost,
  price,
  profit: price - cost,
  marginPercent: margin * 100,
  markupPercent: markup * 100,
});

/**
 * The two quantities the user did not type, from the two they did.
 *
 * Margin is a share of the SELLING price and markup a share of the PURCHASE
 * price; they are the same money seen from two ends, which is why a 25 % markup
 * is a 20 % margin and why quoting one for the other is a real loss.
 *
 * A margin of 100 % or more is refused — it would divide by zero or by a negative
 * price — and so is a markup of −100 % or less, for the same reason. Negative
 * results are reported as the numbers they are: a price under cost is a fact
 * about the two figures, not something to be prevented.
 */
export function marginMarkup(input: MarginMarkupInput): ProResult<MarginMarkupResult> {
  switch (input.mode) {
    case "costMarkup": {
      if (!isPositive(input.cost)) return fail("cost");
      if (!Number.isFinite(input.markupPercent) || input.markupPercent <= -100) {
        return fail("markupPercent");
      }
      const markup = input.markupPercent / 100;
      return derivePricing(input.cost, input.cost * (1 + markup), markup / (1 + markup), markup);
    }
    case "costMargin": {
      if (!isPositive(input.cost)) return fail("cost");
      if (!Number.isFinite(input.marginPercent) || input.marginPercent >= 100) {
        return fail("marginPercent");
      }
      const margin = input.marginPercent / 100;
      return derivePricing(input.cost, input.cost / (1 - margin), margin, margin / (1 - margin));
    }
    case "costPrice": {
      if (!isPositive(input.cost)) return fail("cost");
      if (!isPositive(input.price)) return fail("price");
      const profit = input.price - input.cost;
      return derivePricing(input.cost, input.price, profit / input.price, profit / input.cost);
    }
    case "priceMargin": {
      if (!isPositive(input.price)) return fail("price");
      if (!Number.isFinite(input.marginPercent) || input.marginPercent >= 100) {
        return fail("marginPercent");
      }
      const margin = input.marginPercent / 100;
      return derivePricing(input.price * (1 - margin), input.price, margin, margin / (1 - margin));
    }
    case "priceMarkup": {
      if (!isPositive(input.price)) return fail("price");
      if (!Number.isFinite(input.markupPercent) || input.markupPercent <= -100) {
        return fail("markupPercent");
      }
      const markup = input.markupPercent / 100;
      return derivePricing(input.price / (1 + markup), input.price, markup / (1 + markup), markup);
    }
    default:
      return fail("mode");
  }
}

export interface MaxDiscountInput {
  readonly cost: number;
  readonly price: number;
  /** The smallest margin to be kept, in % of the discounted selling price. */
  readonly minMarginPercent: number;
}

export interface MaxDiscountResult {
  /** Floored to 0,01 % and never below zero — see the note on `maxDiscountForMargin`. */
  readonly maxDiscountPercent: number;
  /** The raw d_max in %, unfloored and unclamped. Negative means the price is
   *  already under the margin that was asked for. */
  readonly exactDiscountPercent: number;
  readonly priceAfterDiscount: number;
  /**
   * The margin actually left by `maxDiscountPercent` — the proof the floor
   * held. Undefined when `priceAfterDiscount` is zero, which happens once the
   * floored discount reaches exactly 100 % (cost negligible next to price) —
   * a margin over a zero price is not a number, not a defect in the discount.
   */
  readonly marginAfterDiscountPercent: number | undefined;
}

/**
 * Floor a percentage onto whole hundredths, allowing for binary representation.
 *
 * `floorSnapped` (from `./result.js`) is `Math.floor` with the representation
 * error taken out first, RELATIVE to the value's own magnitude rather than a
 * fixed absolute band: an exactly-20 % discount computed as 1 − 800/1000 is
 * 19.999999999999996 in binary floating point, and a plain floor would print
 * 19,99 % — a visible defect. A fixed absolute nudge would be wrong at both
 * ends of the range this field can hold — invisible on a discount near
 * 0,01 % and large enough to swallow a real hundredth on one near a much
 * larger figure — so the snap scales to nine significant digits instead,
 * which reaches exactly the representation error and nothing a real discount
 * could mean.
 */
const floorToHundredth = (percent: number): number => floorSnapped(percent * 100) / 100;

/**
 * The largest discount that still leaves a given margin.
 *
 * **This one figure is rounded DOWN.** Together with `roundHalfUp` on
 * `chainedDiscount`'s total, above, it is one of only two roundings this file
 * performs internally rather than leaving to the surface — both for the same
 * reason: a printed figure here has to reconcile with another printed figure,
 * and no amount of surface-side rounding discipline can make that true on its
 * own. Rounded up, the discount breaks through the very margin the user set as
 * the floor: on the catalogue's vector 16,66 % leaves 20,0064 % while 16,67 %
 * leaves 19,9968 %, and the second is below the line that was drawn.
 *
 * When the cost already exceeds the discounted price the expression is negative;
 * the actionable answer is then 0,00 %, and the raw negative figure comes back
 * beside it so the shortfall is stated rather than hidden.
 */
export function maxDiscountForMargin(input: MaxDiscountInput): ProResult<MaxDiscountResult> {
  if (!isPositive(input.cost)) return fail("cost");
  if (!isPositive(input.price)) return fail("price");
  if (!Number.isFinite(input.minMarginPercent) || input.minMarginPercent >= 100) {
    return fail("minMarginPercent");
  }

  const minMargin = input.minMarginPercent / 100;
  const exact = 1 - input.cost / (input.price * (1 - minMargin));
  const maxDiscountPercent = Math.max(0, floorToHundredth(exact * 100));
  const priceAfterDiscount = input.price * (1 - maxDiscountPercent / 100);
  return {
    ok: true,
    maxDiscountPercent,
    exactDiscountPercent: exact * 100,
    priceAfterDiscount,
    marginAfterDiscountPercent: isPositive(priceAfterDiscount)
      ? ((priceAfterDiscount - input.cost) / priceAfterDiscount) * 100
      : undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* payment-due-date                                                            */
/* -------------------------------------------------------------------------- */

/** How the term is counted. All three are ordinary; none is assumed. */
export type DueDateMode = "daysFromDate" | "daysFromEndOfMonth" | "monthsFromDate";

export interface PaymentDueDateInput {
  readonly issueDate: CalendarDate;
  readonly mode: DueDateMode;
  /** N — days or months, depending on the mode. Whose term this is, is the user's. */
  readonly term: number;
  /**
   * Whether the issue/receipt date itself counts as one of the `term` days.
   * `false` gives `issue + term` — the ordinary reading, in which the term
   * starts running the day AFTER issue — and `true` gives `issue + term − 1`:
   * counting the issue day itself as day one of the term means day N is one
   * day EARLIER than the ordinary reading, not later (day one is issue, day
   * two is issue+1, …, day N is issue+(N−1)). The two readings are a whole
   * day apart and both are ordinary practice somewhere; a tool classified
   * `legal-procedure` does not pick one silently.
   *
   * Only `daysFromDate` and `daysFromEndOfMonth` are day counts; the flag is
   * inert under `monthsFromDate`, which counts calendar months and whose
   * month-end clamping (see below) a day added on top would otherwise break —
   * 31.01 + 1 month is 28.02, and one more day on top would print 01.03.
   */
  readonly countIssueDate: boolean;
  /** Whether a due date landing on a non-working day moves at all. */
  readonly shiftOffNonWorkingDays: boolean;
  /**
   * Weekdays treated as non-working, in the SAME 0 = Monday … 6 = Sunday
   * numbering as `dueWeekday`. Saturday and Sunday is the common case but is a
   * convention, not a property of the calendar — an empty list means no day of
   * the week is automatically closed and only `nonWorkingDays` below applies.
   */
  readonly weekendDays: readonly number[];
  /** The user's own holidays; this tool has no holiday calendar of any country. */
  readonly nonWorkingDays?: readonly CalendarDate[] | undefined;
  /**
   * Most contracts shift a due date FORWARD to the next working day; some shift
   * it BACKWARD to the preceding one instead. That is the contract's rule, not
   * an assumption this tool is entitled to make.
   */
  readonly shiftDirection: ShiftDirection;
  /** „Today" is typed, never read off a clock — that is what keeps this pure. */
  readonly referenceDate: CalendarDate;
}

export interface PaymentDueDateResult {
  readonly dueDate: CalendarDate;
  /** 0 = Monday … 6 = Sunday. The name of the day belongs to the surface. */
  readonly dueWeekday: number;
  readonly dueDateBeforeShift: CalendarDate;
  /** How many days the non-working-day rule added; 0 when it was off or idle. */
  readonly shiftedDays: number;
  /**
   * True when the walk used all 30 of its steps without landing on a working
   * day. `dueDate` is then the LAST date the walk reached, not a working one —
   * a dispute over thirty-plus consecutive closed days gets the exact date and
   * step count the tool stopped at, not a bare refusal with nothing to point to.
   */
  readonly capReached: boolean;
  /** Days from the issue date to the final due date. */
  readonly totalDays: number;
  readonly daysLate: number;
  readonly daysUntilDue: number;
}

/**
 * A due date from a date and a term the user supplies, plus the day counts around it.
 *
 * **Every rule in play here is the user's.** The length of the term, whether the
 * issue date itself counts, which weekdays are non-working, which way a due date
 * shifts, and which days are holidays are all things a statute or a contract
 * fixes and revises; a holiday list — or a Saturday/Sunday assumption — compiled
 * in code is wrong the moment it is not. So every one of them is typed: the
 * shift is off unless switched on, `weekendDays` and `nonWorkingDays` are lists
 * the user enters, and `countIssueDate`/`shiftDirection` are explicit choices
 * with no default reading.
 *
 * „N months" measures from the ORIGINAL date and clamps to the month's last day:
 * 31.01 + 1 month is 28.02, never 03.03, and + 2 months is 31.03 rather than the
 * 28.03 that chaining month by month would produce.
 */
export function paymentDueDate(input: PaymentDueDateInput): ProResult<PaymentDueDateResult> {
  if (!isValidDate(input.issueDate)) return fail("issueDate");
  if (!isValidDate(input.referenceDate)) return fail("referenceDate");
  if (!isIntegerIn(input.term, 0, 100000)) return fail("term");
  for (const weekday of input.weekendDays) {
    if (!isIntegerIn(weekday, 0, 6)) return fail("weekendDays");
  }

  const issueJdn = dateToJdn(input.issueDate);
  let dueJdn: number;
  if (input.mode === "daysFromDate") {
    dueJdn = issueJdn + input.term;
  } else if (input.mode === "daysFromEndOfMonth") {
    const { year, month } = input.issueDate;
    dueJdn = dateToJdn({ year, month, day: daysInMonth(year, month) }) + input.term;
  } else {
    dueJdn = dateToJdn(addMonthsClamped(input.issueDate, input.term));
  }
  if (input.countIssueDate && input.mode !== "monthsFromDate") dueJdn -= 1;
  const beforeShift = jdnToDate(dueJdn);
  if (!isValidDate(beforeShift)) return fail("term");

  const closed = new Set<number>();
  for (const day of input.nonWorkingDays ?? []) {
    if (!isValidDate(day)) return fail("nonWorkingDays");
    closed.add(dateToJdn(day));
  }
  const weekend = new Set(input.weekendDays);

  let shiftedDays = 0;
  let capReached = false;
  if (input.shiftOffNonWorkingDays) {
    const walked = shiftOffNonWorkingDays(dueJdn, weekend, closed, input.shiftDirection);
    dueJdn = walked.jdn;
    shiftedDays = walked.shiftedDays;
    capReached = walked.capReached;
  }

  const dueDate = jdnToDate(dueJdn);
  if (!isValidDate(dueDate)) return fail("term");
  const referenceJdn = dateToJdn(input.referenceDate);
  return {
    ok: true,
    dueDate,
    dueWeekday: weekdayFromJdn(dueJdn),
    dueDateBeforeShift: beforeShift,
    shiftedDays,
    capReached,
    totalDays: dueJdn - issueJdn,
    daysLate: Math.max(0, referenceJdn - dueJdn),
    daysUntilDue: Math.max(0, dueJdn - referenceJdn),
  };
}

/* -------------------------------------------------------------------------- */
/* payment-reference-97                                                        */
/* -------------------------------------------------------------------------- */

export interface PaymentReferenceResult {
  /** Arithmetically always between 2 and 98, because K = 98 − r and r ≤ 96. */
  readonly checkDigits: number;
  readonly checkDigitsText: string;
  /** The reference with separators removed; leading zeros are significant. */
  readonly reference: string;
  /** „KK-" followed by the reference as the user typed it, separators kept. */
  readonly formatted: string;
  /**
   * Past the 20-digit field NBS's payment-order form allows. MOD 97-10 itself
   * has no length limit — this is a fact about a form's field width, which NBS
   * can revise without the check procedure changing, so it is reported rather
   * than enforced as a refusal.
   */
  readonly overTwentyDigits: boolean;
}

/** The MOD 97-10 pair for a reference: r over the digits, then (r·100) mod 97. */
function referenceCheckDigits(digits: string): number {
  return 98 - ((mod97OverDigits(digits) * 100) % 97);
}

/**
 * The check pair of a Serbian „poziv na broj", by ISO/IEC 7064:2003 MOD 97-10.
 *
 * The remainder is accumulated digit by digit and the string is never handed to
 * `Number`: a twenty-digit reference is past 2^53, where the low digits would be
 * quietly altered and the tool would return a wrong pair with no error at all.
 *
 * 00 and 01 cannot come out of 98 − r, so the range 02–98 is a consequence of the
 * procedure rather than a list somebody prescribed.
 */
export function paymentReferenceCompute(reference: string): ProResult<PaymentReferenceResult> {
  const digits = digitsOnly(reference);
  if (digits === undefined || !isInRange(digits.length, 1, 40)) return fail("reference");
  const checkDigits = referenceCheckDigits(digits);
  return {
    ok: true,
    checkDigits,
    checkDigitsText: pad2(checkDigits),
    reference: digits,
    formatted: `${pad2(checkDigits)}-${reference.trim()}`,
    overTwentyDigits: digits.length > 20,
  };
}

export interface PaymentReferenceVerifyResult {
  readonly enteredCheckDigits: number;
  readonly computedCheckDigits: number;
  /** Whether the two pairs are the same pair. */
  readonly matches: boolean;
  readonly reference: string;
  /** MOD 97-10 over the digits with the check pair moved to the end. */
  readonly remainder: number;
  /** Past the 20-digit field NBS's form allows — see `paymentReferenceCompute`. */
  readonly overTwentyDigits: boolean;
}

/**
 * An existing „poziv na broj" against the pair its reference implies.
 *
 * **The comparison is between the two pairs, not between the remainder and 1.**
 * Those differ: for the reference „97" the derived pair is 98, and yet „01-97"
 * also leaves remainder 1, so a tool that reports „remainder is 1" would accept a
 * call number no bank would have issued. Both figures come back; only `matches`
 * answers whether the pair written on the slip is the pair the procedure gives.
 *
 * The match is a statement about MOD 97-10 and nothing more — never that a
 * payment exists, is routed correctly, or is expected by anyone.
 */
export function paymentReferenceVerify(value: string): ProResult<PaymentReferenceVerifyResult> {
  const digits = digitsOnly(value);
  if (digits === undefined || !isInRange(digits.length, 3, 42)) return fail("value");
  const entered = Number(digits.slice(0, 2));
  const reference = digits.slice(2);
  const computed = referenceCheckDigits(reference);
  return {
    ok: true,
    enteredCheckDigits: entered,
    computedCheckDigits: computed,
    matches: entered === computed,
    reference,
    remainder: mod97OverDigits(reference + digits.slice(0, 2)),
    overTwentyDigits: reference.length > 20,
  };
}

/* -------------------------------------------------------------------------- */
/* share-allocation                                                            */
/* -------------------------------------------------------------------------- */

export interface ShareAllocationInput {
  readonly total: number;
  /** Weights or percentages; they need not add up to 100. */
  readonly shares: readonly number[];
  /** The smallest unit money is written in — 0,01 / 1 / 10. */
  readonly unit: number;
}

export interface AllocationRow {
  readonly index: number;
  readonly share: number;
  readonly percent: number;
  readonly units: number;
  readonly amount: number;
  /** Whether this row received one of the leftover units. */
  readonly gotExtraUnit: boolean;
}

export interface ShareAllocationResult {
  readonly rows: readonly AllocationRow[];
  /** How many single units were handed out by the remainder rule. */
  readonly extraUnits: number;
  /**
   * The sum of the entered shares — every row's `percent` is that row's share
   * divided by THIS, not by 100, so it is shown alongside the split it
   * normalises rather than left for the reader to re-add by hand.
   */
  readonly shareSum: number;
  readonly checkSumUnits: number;
  readonly checkSum: number;
}

/**
 * An amount split by shares so the parts add up to the whole, to the last para.
 *
 * The largest-remainder method (Hare/Hamilton) over whole units, via the
 * `allocateWholeUnits` helper this tool shares with `depositInstalments`.
 * Rounding each share on its own is what loses a para: 1.000,00 into three
 * equal parts rounds to 999,99, and no amount of decimal care fixes it, because
 * the shortfall is a property of the rounding and not of the precision.
 *
 * **`checkSum` is the sum of the ROUNDED total** — `Math.round(total / unit)` —
 * and not a proof that it equals the entered `total`: when `total` is not an
 * exact multiple of `unit` those two differ by less than one unit, and this
 * name says which one the parts actually add up to.
 *
 * **Ties go to the row entered first**, so the result is reproducible and does not
 * depend on a sort implementation. The leftover is always strictly smaller than
 * the number of rows WITH a positive remainder, so a row with a zero share never
 * receives an extra unit and no row can receive two.
 */
export function shareAllocation(input: ShareAllocationInput): ProResult<ShareAllocationResult> {
  if (!isNonNegative(input.total)) return fail("total");
  if (!isPositive(input.unit)) return fail("unit");
  if (input.shares.length === 0) return fail("shares");
  let sum = 0;
  for (const share of input.shares) {
    if (!isNonNegative(share)) return fail("shares");
    sum += share;
  }
  if (sum <= 0) return fail("shares");

  const totalUnits = Math.round(input.total / input.unit);
  const allocation = allocateWholeUnits(totalUnits, input.shares);
  if (allocation === undefined) return fail("shares");

  const rows = input.shares.map((share, index) => {
    const units = allocation.units[index] ?? 0;
    return {
      index,
      share,
      percent: (share / sum) * 100,
      units,
      amount: units * input.unit,
      gotExtraUnit: allocation.extraUnitIndices.has(index),
    };
  });
  return {
    ok: true,
    rows,
    extraUnits: allocation.extraUnitIndices.size,
    shareSum: sum,
    checkSumUnits: totalUnits,
    checkSum: totalUnits * input.unit,
  };
}

/* -------------------------------------------------------------------------- */
/* simple-interest-days                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Day count conventions. ACT/365 Fixed divides actual days by 365; ACT/360
 * divides actual days by the 360-day year of the 2006 ISDA Definitions, section
 * 4.16; 30E/360 (Eurobond Basis, same section) shortens every 31st to a 30th and
 * treats every month as 30 days.
 */
export type DayCountBasis = "act365" | "act360" | "e30360";

/**
 * The ACT/365 Fixed divisor. Despite the name this is a CONVENTION and not a
 * fact about the calendar: ACT/365 Fixed divides by 365 even across a leap
 * year, so — unlike `isLeapYear` below, which really is physical — this is
 * `published` tier, from the same source as `CONVENTIONAL_YEAR`: 2006 ISDA
 * Definitions, section 4.16.
 */
const DAYS_PER_YEAR = 365;
/** The conventional 360-day year: 2006 ISDA Definitions, section 4.16. */
const CONVENTIONAL_YEAR = 360;

export interface SimpleInterestInput {
  readonly principal: number;
  /** Annual rate in %. No statutory or contractual rate is known to this tool. */
  readonly annualRatePercent: number;
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  readonly basis: DayCountBasis;
  /**
   * Whether the actual-day count includes BOTH `from` and `to`. Plain
   * `JDN(to) − JDN(from)` counts the `from` day and not the `to` day — the
   * ordinary convention — but a claim's term is sometimes counted the other
   * way round, and a `financial` tool does not pick that silently. Applies to
   * ACT/365 and ACT/360 only: 30E/360 already has its own day-count baked into
   * D1/D2 and this flag does not alter it.
   */
  readonly countBothEnds: boolean;
}

export interface SimpleInterestResult {
  /** Days under the chosen basis AND `countBothEnds` — see `calendarDays` for
   *  the number that is independent of both. */
  readonly days: number;
  /**
   * `JDN(to) − JDN(from)`, ALWAYS the true calendar day count, regardless of
   * `basis` or `countBothEnds`. Shown beside `days` so a convention's effect —
   * 30E/360 folding a 31st into a 30th, or `countBothEnds` adding a day — reads
   * as the convention it is, rather than as a gap that looks like a bug.
   */
  readonly calendarDays: number;
  /** The divisor the basis uses: 365 or 360. */
  readonly divisor: number;
  readonly interest: number;
  readonly dailyInterest: number;
  readonly total: number;
}

/**
 * Simple interest between two dates, on the basis the user chooses.
 *
 * **The basis is an input with no default**, because it is worth real money: the
 * same amount over the same six weeks is 45 days under ACT/365 and 46 under
 * 30E/360, and the two answers differ by more than a rounding.
 *
 * Simple interest only: no compounding, no conformal method. That is a different
 * figure and a different choice, and showing both as though they were the same
 * thing would be the tool making it.
 */
export function simpleInterestDays(input: SimpleInterestInput): ProResult<SimpleInterestResult> {
  if (!isNonNegative(input.principal)) return fail("principal");
  if (!isNonNegative(input.annualRatePercent)) return fail("annualRatePercent");
  if (!isValidDate(input.from)) return fail("from");
  if (!isValidDate(input.to)) return fail("to");
  const fromJdn = dateToJdn(input.from);
  const toJdn = dateToJdn(input.to);
  if (toJdn < fromJdn) return fail("to");
  const calendarDays = toJdn - fromJdn;

  let days: number;
  let divisor: number;
  if (input.basis === "e30360") {
    const d1 = Math.min(input.from.day, 30);
    const d2 = Math.min(input.to.day, 30);
    days =
      CONVENTIONAL_YEAR * (input.to.year - input.from.year) +
      30 * (input.to.month - input.from.month) +
      (d2 - d1);
    divisor = CONVENTIONAL_YEAR;
  } else {
    days = calendarDays + (input.countBothEnds ? 1 : 0);
    divisor = input.basis === "act365" ? DAYS_PER_YEAR : CONVENTIONAL_YEAR;
  }

  const yearly = input.principal * (input.annualRatePercent / 100);
  const interest = (yearly * days) / divisor;
  return {
    ok: true,
    days,
    calendarDays,
    divisor,
    interest,
    // From the unrounded yearly figure: a rounded daily amount multiplied by the
    // days is a different total, and the gap grows with the length of the delay.
    dailyInterest: yearly / divisor,
    total: input.principal + interest,
  };
}

/** One rate over one span, inside a `simpleInterestSegments` schedule. */
export interface SimpleInterestSegmentInput {
  /** Annual rate in % for THIS segment only — see `SimpleInterestInput.annualRatePercent`. */
  readonly annualRatePercent: number;
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}

export interface SimpleInterestSegmentsInput {
  readonly principal: number;
  /** At least one row. Rows need not be contiguous or sorted — each is its
   *  own independent calculation, so a gap or an overlap between them is the
   *  caller's fact to state, not this tool's to assume away. */
  readonly segments: readonly SimpleInterestSegmentInput[];
  readonly basis: DayCountBasis;
  readonly countBothEnds: boolean;
}

export interface SimpleInterestSegmentsResult {
  /** One full `simpleInterestDays` result per segment, in the order given. */
  readonly segments: readonly SimpleInterestResult[];
  readonly totalDays: number;
  readonly totalInterest: number;
  readonly total: number;
}

/**
 * Simple interest over several segments, each at its own rate.
 *
 * **A rate change mid-term is not one calculation, it is several.** Simple
 * interest computed once over the whole span, at either the old rate or the
 * new one, is a different and wrong number the moment the rate actually
 * changed partway through — the only correct arithmetic is `simpleInterestDays`
 * run once per `from; to; rate` row, on the SAME principal every time (simple
 * interest never compounds an earlier segment's interest into a later
 * segment's base), with the day counts and the interest summed across rows.
 *
 * A segment that itself fails — a bad date, a span running backwards — fails
 * the whole schedule with `reason: "segments"`, because a partial answer to a
 * multi-row calculation is not a smaller version of the right answer.
 */
export function simpleInterestSegments(
  input: SimpleInterestSegmentsInput,
): ProResult<SimpleInterestSegmentsResult> {
  if (!isNonNegative(input.principal)) return fail("principal");
  if (input.segments.length === 0) return fail("segments");

  const segments: SimpleInterestResult[] = [];
  let totalDays = 0;
  let totalInterest = 0;
  for (const segment of input.segments) {
    const result = simpleInterestDays({
      principal: input.principal,
      annualRatePercent: segment.annualRatePercent,
      from: segment.from,
      to: segment.to,
      basis: input.basis,
      countBothEnds: input.countBothEnds,
    });
    if (!result.ok) return fail("segments");
    segments.push(result);
    totalDays += result.days;
    totalInterest += result.interest;
  }
  return {
    ok: true,
    segments,
    totalDays,
    totalInterest,
    total: input.principal + totalInterest,
  };
}

/* -------------------------------------------------------------------------- */
/* tax-id-check                                                                */
/* -------------------------------------------------------------------------- */

/**
 * ISO/IEC 7064:2003 MOD 11,10 over a prefix of digits.
 *
 * The `s = 0 → s = 10` line is part of the published procedure, not a patch
 * somebody added: without it `p` becomes 0 and the chain sticks there for every
 * remaining digit.
 */
function mod1110CheckDigit(prefix: string): number {
  let product = 10;
  for (let i = 0; i < prefix.length; i += 1) {
    const step = (product + (prefix.charCodeAt(i) - CODE_ZERO)) % 10;
    const sum = step === 0 ? 10 : step;
    product = (2 * sum) % 11;
  }
  return (11 - product) % 10;
}

export interface TaxIdComputeResult {
  readonly checkDigit: number;
  /** The prefix with the check digit appended. */
  readonly number: string;
}

/**
 * The MOD 11,10 check digit for a typed prefix.
 *
 * **No identifier length is built in.** How many digits a PIB has is a choice
 * of whoever keeps that register, not a consequence of the arithmetic — MOD
 * 11,10 is published for the check digit alone and says nothing about which
 * identifiers use it or how long they run, so the expected length is typed and
 * a prefix of the wrong length is refused rather than answered, otherwise an
 * identifier missing a digit would receive a tidy, wrong answer.
 */
export function taxIdCompute(totalDigits: number, prefix: string): ProResult<TaxIdComputeResult> {
  if (!isIntegerIn(totalDigits, 2, 40)) return fail("totalDigits");
  const digits = prefix.replace(/\s/g, "");
  if (!/^[0-9]+$/.test(digits)) return fail("prefix");
  if (digits.length !== totalDigits - 1) return fail("length");
  const checkDigit = mod1110CheckDigit(digits);
  return { ok: true, checkDigit, number: `${digits}${checkDigit}` };
}

export interface TaxIdVerifyResult {
  readonly checkDigit: number;
  readonly enteredCheckDigit: number;
  /** Whether the last digit is the one MOD 11,10 derives, and nothing beyond that. */
  readonly matches: boolean;
  readonly prefix: string;
  /** prefix + the COMPUTED check digit — the whole corrected number to re-copy. */
  readonly correctedNumber: string;
}

/**
 * A whole identifier against its own last digit.
 *
 * A match means the string satisfies MOD 11,10 and only that. No register is
 * consulted, nothing is claimed about the number being assigned or to whom, and
 * no activity, seat or other detail is inferred from it. Leading zeros are
 * significant and the string is never converted to a number.
 */
export function taxIdVerify(totalDigits: number, value: string): ProResult<TaxIdVerifyResult> {
  if (!isIntegerIn(totalDigits, 2, 40)) return fail("totalDigits");
  const digits = value.replace(/\s/g, "");
  if (!/^[0-9]+$/.test(digits)) return fail("number");
  if (digits.length !== totalDigits) return fail("length");
  const prefix = digits.slice(0, -1);
  const checkDigit = mod1110CheckDigit(prefix);
  const entered = Number(digits.slice(-1));
  return {
    ok: true,
    checkDigit,
    enteredCheckDigit: entered,
    matches: checkDigit === entered,
    prefix,
    correctedNumber: `${prefix}${checkDigit}`,
  };
}

/* -------------------------------------------------------------------------- */
/* tiered-commission                                                           */
/* -------------------------------------------------------------------------- */

/** Marginal charges each slice at its own rate; flat charges the whole base at one. */
export type CommissionMode = "marginal" | "flat";

export interface CommissionTier {
  /** Lower bound, inclusive. The lowest tier must start at 0. */
  readonly from: number;
  readonly ratePercent: number;
}

export interface CommissionSlice {
  readonly from: number;
  /** Upper bound, or undefined for the open top tier. */
  readonly to: number | undefined;
  readonly ratePercent: number;
  /** How much of the base fell into this slice. */
  readonly amount: number;
  readonly commission: number;
}

export interface TieredCommissionInput {
  readonly base: number;
  /** The user's own scale, row by row. This tool knows no tariff of any kind. */
  readonly tiers: readonly CommissionTier[];
  readonly mode: CommissionMode;
  readonly minCommission?: number | undefined;
  readonly maxCommission?: number | undefined;
}

export interface TieredCommissionResult {
  readonly slices: readonly CommissionSlice[];
  /** The commission the scale gives, before any floor or cap is applied. */
  readonly commissionBeforeLimits: number;
  readonly commission: number;
  /** Which sorted tier the flat mode used; undefined in marginal mode. */
  readonly appliedTierIndex: number | undefined;
  /** Commission over base, in %. Undefined at a base of zero — division by zero. */
  readonly effectiveRatePercent: number | undefined;
  readonly remainder: number;
}

/**
 * Commission from a scale the user types, either marginal or flat.
 *
 * **A threshold belongs to the tier above it.** A base sitting exactly on 1.000.000
 * is charged at that tier's rate: under the marginal method that costs nothing,
 * but under the flat method it doubles the answer, which is why the rule is
 * written down rather than left to the comparison operator someone happens to use.
 *
 * The slices are summed unrounded and the total rounded once by the surface —
 * otherwise the printed slices would not add up to the printed total, and that
 * discrepancy is discovered on the invoice.
 */
export function tieredCommission(
  input: TieredCommissionInput,
): ProResult<TieredCommissionResult> {
  if (!isNonNegative(input.base)) return fail("base");
  if (input.tiers.length === 0) return fail("tiers");
  const sorted = [...input.tiers].sort((a, b) => a.from - b.from);
  for (let i = 0; i < sorted.length; i += 1) {
    const tier = sorted[i];
    if (tier === undefined) return fail("tiers");
    if (!isNonNegative(tier.from) || !isNonNegative(tier.ratePercent)) return fail("tiers");
    const previous = sorted[i - 1];
    if (previous !== undefined && previous.from === tier.from) return fail("tiers");
  }
  // A scale that starts above zero says nothing about the amounts below it.
  if (sorted[0]?.from !== 0) return fail("tiers");

  const floor = input.minCommission;
  const cap = input.maxCommission;
  if (floor !== undefined && !isNonNegative(floor)) return fail("minCommission");
  if (cap !== undefined && !isNonNegative(cap)) return fail("maxCommission");
  // Applied in the other order the two limits would silently decide the outcome.
  if (floor !== undefined && cap !== undefined && floor > cap) return fail("maxCommission");

  const marginal = input.mode === "marginal";
  let appliedTierIndex: number | undefined;
  let slices: CommissionSlice[];
  if (marginal) {
    slices = sorted.map((tier, index) => {
      const next = sorted[index + 1];
      const to = next === undefined ? undefined : next.from;
      const upper = to === undefined ? input.base : Math.min(input.base, to);
      const amount = Math.max(0, upper - tier.from);
      return {
        from: tier.from,
        to,
        ratePercent: tier.ratePercent,
        amount,
        commission: (amount * tier.ratePercent) / 100,
      };
    });
  } else {
    let index = 0;
    for (let i = 0; i < sorted.length; i += 1) {
      const tier = sorted[i];
      if (tier !== undefined && tier.from <= input.base) index = i;
    }
    const tier = sorted[index];
    if (tier === undefined) return fail("tiers");
    appliedTierIndex = index;
    slices = [
      {
        from: tier.from,
        to: undefined,
        ratePercent: tier.ratePercent,
        amount: input.base,
        commission: (input.base * tier.ratePercent) / 100,
      },
    ];
  }

  const before = slices.reduce((sum, slice) => sum + slice.commission, 0);
  let commission = before;
  if (floor !== undefined) commission = Math.max(commission, floor);
  if (cap !== undefined) commission = Math.min(commission, cap);
  return {
    ok: true,
    slices,
    commissionBeforeLimits: before,
    commission,
    appliedTierIndex,
    // commission·100/base rather than commission/base·100: the same value with
    // one fewer chance for the division to land off a representable percent.
    effectiveRatePercent: input.base > 0 ? (commission * 100) / input.base : undefined,
    remainder: input.base - commission,
  };
}
