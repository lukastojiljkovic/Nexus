/**
 * „Nekretnine" — the arithmetic behind the real-estate toolkit's tools.
 *
 * **One file per PACK, not per category** — the rule `pro/gradnja.ts` sets out:
 * a tool several packs share lives in the file of its FIRST pack in `TOOL_PACKS`
 * order, so nobody relitigates ownership per tool. Most of what is here is money
 * and calendar arithmetic, which is why the two hazards these comments spend
 * themselves on are binary rounding and the local time zone.
 *
 * **Nothing here rounds for display, and everything here rounds correctly.**
 * Those are not in tension: every function returns the exact quantity it
 * computed, and `roundHalfUp` below is the single rounding rule the surfaces
 * call. A surface reaching for `toFixed` instead prints 41.59 where the answer
 * is 41.60, because `41.595` is not 41.595 in a double — and it gets that wrong
 * one screen at a time, which is how four copies of one defect happen. A few
 * places round INSIDE the arithmetic rather than leaving it to the display —
 * the pro-rata split, the cost allocation, the loan schedule, the late-payment
 * total and the gross/net conversion — because there the rounding is what makes
 * the parts add up to the whole rather than merely what makes them printable.
 *
 * **Dates are calendar triples, never `Date`.** A `Date` is an instant, and an
 * instant is read in a time zone: `new Date(2027, 2, 1)` in Belgrade is
 * 2027-02-28T23:00Z, and a period crossing the March clock change then measures
 * 30.958 days. Every date here is `{ year, month, day }` and every difference is
 * a whole number of days from Hinnant's civil-days algorithm — integers only.
 *
 * **Nothing here decides anything.** Every rate, index, coefficient, notice
 * period and planning ratio in this file is an INPUT with no default, because
 * each is a number a rule-maker or a contract chose and can change. The tools
 * multiply what the user typed and say which convention they used.
 */

import {
  ceilSnapped,
  fail,
  isInRange,
  isIntegerIn,
  isNonNegative,
  isPositive,
  roundHalfUp,
  type ProResult,
} from "./result.js";
import {
  civilFromDays as devtoolsCivilFromDays,
  daysFromCivil as devtoolsDaysFromCivil,
  daysInMonth as devtoolsDaysInMonth,
  isLeapYear as devtoolsIsLeapYear,
} from "../devtools/datetime.js";

/* ------------------------------------------------------------------ rounding */

/**
 * Half-up rounding of the decimal the user typed, not of the double standing in
 * for it — re-exported here from the shared `@nexus/core/pro/result` kit, under
 * the name every tool in this file (and this file's own tests) is written
 * against.
 *
 * **A private copy used to live here, with an ABSOLUTE `+ 1e-9` nudge added
 * after scaling.** That repairs `41.595` (stored as 41.59499999999999886)
 * because the nudge there is still ~200,000× the representation error it is
 * fixing — but the nudge does not grow with the value, and the representation
 * error does: above a scaled magnitude of about 2^18 (an ordinary six- or
 * seven-figure RSD amount, the very sizes this file's money tools produce) the
 * error overtakes the fixed 1e-9 and the repair silently stops working —
 * `roundHalfUp(583941.565, 2)` answered 583941,56 instead of 583941,57. The
 * shared version scales the nudge to the value instead (4× machine epsilon of
 * the scaled magnitude), which stays ahead of the representation error at every
 * size a double can hold, not only the small ones a first test happens to try.
 */
export { roundHalfUp };

/** Smallest payable unit when the caller names none. A convention, not a rule. */
const DEFAULT_MONEY_STEP = 0.01;

const DEG_PER_RAD = 180 / Math.PI;

/* ------------------------------------------------------------------ calendar */

/**
 * A calendar date, deliberately not a `Date`.
 *
 * `month` is 1..12 with January at 1 — the reading a person types, not the
 * zero-based month a `Date` constructor wants. Nothing in this file ever
 * converts one of these to an instant, so no time zone can shorten a day.
 */
export interface CalendarDate {
  readonly year: number;
  /** 1..12, January is 1. */
  readonly month: number;
  readonly day: number;
}

/**
 * Gregorian rule and month length, from `@nexus/core/devtools/datetime` and NOT
 * reimplemented here. That module already carries `isLeapYear`/`daysInMonth`,
 * tested against an independent oracle over the whole representable timeline —
 * a second hand-written copy of the same rule in this file is exactly the class
 * of defect this project's doctrine calls out by name, and the one place the two
 * could silently disagree is the one nobody would think to check.
 */
export const isLeapYear = devtoolsIsLeapYear;

/** Length of a month. Callers validate `month` first; a bad month answers 0. */
export const lastDayOfMonth = devtoolsDaysInMonth;

/** Whole numbers, a real month, and a day that exists in THAT month. */
export function isCalendarDate(date: CalendarDate): boolean {
  if (!isIntegerIn(date.year, 1, 9999)) return false;
  if (!isIntegerIn(date.month, 1, 12)) return false;
  return isIntegerIn(date.day, 1, lastDayOfMonth(date.year, date.month));
}

/**
 * Days from 1970-01-01, proleptic Gregorian — Howard Hinnant's `days_from_civil`,
 * via `@nexus/core/devtools/datetime`. Only the `{ year, month, day }` calling
 * shape this file uses everywhere is added here; the algorithm itself lives in
 * one place.
 */
function daysFromCivil(date: CalendarDate): number {
  return devtoolsDaysFromCivil(date.year, date.month, date.day);
}

/** The inverse of `daysFromCivil`, from the same shared module. */
function civilFromDays(serial: number): CalendarDate {
  return devtoolsCivilFromDays(serial);
}

/** Whole calendar days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return daysFromCivil(to) - daysFromCivil(from);
}

/** Calendar-day arithmetic. A leap February is covered by the day count itself. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  return civilFromDays(daysFromCivil(date) + days);
}

/**
 * Add (or, with a negative `months`, subtract) whole months.
 *
 * The day is CLAMPED to the last day of the target month, which is the only
 * defensible reading of „31 August plus six months": 31 February does not exist,
 * and rolling into March would silently lengthen the term by three days. The
 * modulus is the mathematical one, so a negative `months` walks backwards
 * correctly instead of landing on month 0.
 */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const total = date.month - 1 + months;
  const year = date.year + Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
  return { year, month, day: Math.min(date.day, lastDayOfMonth(year, month)) };
}

/* ------------------------------------------------------- cashflow: NPV & IRR */

/**
 * Why no internal rate of return was reported. `found` is the only outcome that
 * carries a number; the other three are properties of the series the user typed,
 * not failures of the tool.
 */
export type IrrOutcome = "found" | "noSignChange" | "notUnique" | "outsideSearchRange";

export interface CashflowInput {
  /** CF_0..CF_n, one per period, outflows negative. CF_0 is NOT discounted. */
  readonly cashflows: readonly number[];
  /** Required return per period, in percent. Must be above −100. */
  readonly discountRate: number;
}

export interface CashflowResult {
  readonly npv: number;
  /** CF_t / (1+r)^t for each t, in input order. */
  readonly discounted: readonly number[];
  readonly undiscountedTotal: number;
  /**
   * Periods until the undiscounted cumulative first reaches zero, interpolated.
   * Undefined when the flows never change sign: with nothing ever paid out
   * there is nothing to be paid BACK, and a series that starts non-negative
   * would otherwise read as an (incorrect) instant payback of 0.
   */
  readonly paybackPlain: number | undefined;
  readonly paybackDiscounted: number | undefined;
  /**
   * How many times the undiscounted cumulative crosses the payback threshold
   * over the WHOLE series, not only up to the first crossing `paybackPlain`
   * reports — a series that dips back under water after recovering once
   * crosses more than once, and nothing about that second dip is visible in
   * `paybackPlain` alone.
   */
  readonly paybackPlainCrossings: number;
  /** Same count, taken over the discounted cumulative. */
  readonly paybackDiscountedCrossings: number;
  /** Percent per period, or undefined — read `irrOutcome` for which. */
  readonly irr: number | undefined;
  readonly irrOutcome: IrrOutcome;
  /** Sign changes among the non-zero flows; Descartes' bound on the root count. */
  readonly signChanges: number;
}

/** Bisection bracket. −0.9999 rather than −1 because (1+r) is a divisor. */
const IRR_LOW = -0.9999;
const IRR_HIGH = 10;

/**
 * Net present value, payback and — only when the series admits exactly one — the
 * internal rate of return.
 *
 * **The IRR is withheld deliberately, and that is the feature.** `NPV(x) = 0` is
 * a polynomial in `1/(1+x)`; a series with two sign changes can and routinely
 * does have two roots (−1000, 2500, −1500 has roots at 0% and 50%), and printing
 * whichever one a solver happened to land on is worse than printing nothing.
 * Descartes' rule of signs is applied to the non-zero flows first, and the search
 * runs only when it guarantees at most one root above −100%.
 *
 * Payback interpolates inside the period in which the cumulative first reaches
 * zero: the flow that carries it across is positive by construction, so the
 * division is safe. The zero test carries a relative epsilon because a
 * discounted series that returns exactly its outlay lands at −1.8e−13 rather
 * than at 0, and „never recovered" would be the wrong answer to give for it.
 *
 * **Payback is withheld entirely when the flows never change sign.** A series
 * that is all one sign never had an outlay to recover, so „payback = 0" (the
 * `t = 0` branch would otherwise give, because a non-negative CF_0 already
 * clears the zero test on its first iteration) is not merely unhelpful, it
 * names a quantity — a payback period — for a series that has none. The `t = 0`
 * branch itself stays for the genuine case: a mixed-sign series whose very
 * first flow already covers it.
 *
 * **`paybackPlainCrossings` / `paybackDiscountedCrossings` count every crossing
 * of the payback threshold, not only the first.** A series can climb back
 * above zero and dip under again — `paybackPlain` only ever reports the FIRST
 * such crossing, which is correct as far as it goes but says nothing about a
 * later dip; the crossing count is how a caller learns there is more to the
 * series than the single number.
 */
export function cashflowNpvIrr(input: CashflowInput): ProResult<CashflowResult> {
  const { cashflows, discountRate } = input;
  if (cashflows.length === 0) return fail("cashflows");
  for (const cf of cashflows) {
    if (!Number.isFinite(cf)) return fail("cashflows");
  }
  if (!Number.isFinite(discountRate) || discountRate <= -100) return fail("discountRate");

  const rate = discountRate / 100;
  const discounted = cashflows.map((cf, t) => cf / Math.pow(1 + rate, t));
  const npv = discounted.reduce((sum, value) => sum + value, 0);
  const undiscountedTotal = cashflows.reduce((sum, value) => sum + value, 0);

  const scale = cashflows.reduce((max, cf) => Math.max(max, Math.abs(cf)), 0);
  // Twelve digits of headroom over the double's own 16: enough to absorb the
  // handful of ulps a discount-and-sum accumulates, far too little to hide a cent.
  const zeroBand = scale * 1e-12;

  const signChanges = countSignChanges(cashflows);
  const { irr, irrOutcome } = solveIrr(cashflows, signChanges);

  return {
    ok: true,
    npv,
    discounted,
    undiscountedTotal,
    paybackPlain: payback(cashflows, zeroBand, signChanges),
    paybackDiscounted: payback(discounted, zeroBand, signChanges),
    paybackPlainCrossings: crossingCount(cashflows, zeroBand),
    paybackDiscountedCrossings: crossingCount(discounted, zeroBand),
    irr,
    irrOutcome,
    signChanges,
  };
}

/** Sign flips among the non-zero members; a zero flow is not a change of sign. */
function countSignChanges(flows: readonly number[]): number {
  let previous = 0;
  let changes = 0;
  for (const cf of flows) {
    if (cf === 0) continue;
    const sign = cf > 0 ? 1 : -1;
    if (previous !== 0 && sign !== previous) changes += 1;
    previous = sign;
  }
  return changes;
}

/**
 * First period whose cumulative reaches zero, with linear interpolation inside
 * it. Undefined outright when `signChanges` is 0 — see the note on
 * `cashflowNpvIrr`.
 */
function payback(
  flows: readonly number[],
  zeroBand: number,
  signChanges: number,
): number | undefined {
  if (signChanges === 0) return undefined;
  let cumulative = 0;
  for (let t = 0; t < flows.length; t += 1) {
    const previous = cumulative;
    cumulative += flows[t] ?? 0;
    if (cumulative >= -zeroBand) {
      if (t === 0) return 0;
      const flow = flows[t] ?? 0;
      // `previous` is strictly below −zeroBand and `cumulative` is not, so this
      // period's flow is strictly positive and larger than the shortfall.
      return t - 1 + -previous / flow;
    }
  }
  return undefined;
}

/**
 * How many times the cumulative crosses the `payback` threshold, over the
 * whole series — unlike `payback` itself, this does not stop at the first one.
 */
function crossingCount(flows: readonly number[], zeroBand: number): number {
  let cumulative = 0;
  let previousState: -1 | 1 | undefined;
  let crossings = 0;
  for (const cf of flows) {
    cumulative += cf;
    const state = cumulative >= -zeroBand ? 1 : -1;
    if (previousState !== undefined && state !== previousState) crossings += 1;
    previousState = state;
  }
  return crossings;
}

function solveIrr(
  flows: readonly number[],
  signChanges: number,
): { irr: number | undefined; irrOutcome: IrrOutcome } {
  if (signChanges === 0) return { irr: undefined, irrOutcome: "noSignChange" };
  if (signChanges > 1) return { irr: undefined, irrOutcome: "notUnique" };

  const npvAt = (rate: number): number => {
    let sum = 0;
    for (let t = 0; t < flows.length; t += 1) sum += (flows[t] ?? 0) / Math.pow(1 + rate, t);
    return sum;
  };

  let low = IRR_LOW;
  let high = IRR_HIGH;
  const atLow = npvAt(low);
  const atHigh = npvAt(high);
  if (Number.isNaN(atLow) || Number.isNaN(atHigh)) {
    return { irr: undefined, irrOutcome: "outsideSearchRange" };
  }
  if (atLow === 0) return { irr: low * 100, irrOutcome: "found" };
  if (atHigh === 0) return { irr: high * 100, irrOutcome: "found" };
  if (Math.sign(atLow) === Math.sign(atHigh)) {
    return { irr: undefined, irrOutcome: "outsideSearchRange" };
  }

  const lowSign = Math.sign(atLow);
  let mid = low;
  for (let step = 0; step < 200; step += 1) {
    mid = (low + high) / 2;
    const value = npvAt(mid);
    if (Math.abs(value) < 1e-9) break;
    if (Math.sign(value) === lowSign) low = mid;
    else high = mid;
  }
  return { irr: mid * 100, irrOutcome: "found" };
}

/* ------------------------------------------------------- shared BigInt decimals */

/**
 * A value's digits and decimal exponent, read off its own shortest round-trip
 * text — the decimal a person typed, not the binary residue a double actually
 * holds (0.1 is not 1/10 in a double; its shortest text is).
 */
interface DecimalParts {
  readonly digits: bigint;
  readonly exponent: number;
}

function decimalParts(value: number): DecimalParts | undefined {
  if (!Number.isFinite(value)) return undefined;
  const [mantissa = "0", exponent = "0"] = Math.abs(value).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  return { digits: BigInt(digits), exponent: Number(exponent) - (digits.length - 1) };
}

/** `value` as an exact p/q with q a power of ten — the fraction its text names. */
function exactFraction(value: number): { readonly p: bigint; readonly q: bigint } | undefined {
  const parts = decimalParts(value);
  if (parts === undefined) return undefined;
  if (parts.exponent >= 0) return { p: parts.digits * 10n ** BigInt(parts.exponent), q: 1n };
  return { p: parts.digits, q: 10n ** BigInt(-parts.exponent) };
}

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

/** Divide before multiplying, so the intermediate product never grows without need. */
function lcmBig(a: bigint, b: bigint): bigint {
  if (a === 0n || b === 0n) return 0n;
  const divisor = gcdBig(a, b);
  return divisor === 0n ? 0n : (a / divisor) * b;
}

/* ---------------------------------------------------------- cost allocation */

export interface CostAllocationInput {
  /** The whole to be split. Any real number — a refund (negative) is split too. */
  readonly total: number;
  /** One positive weight per row: square metres, shares, head count, anything. */
  readonly weights: readonly number[];
  /** Smallest payable unit, e.g. 0.01 or 1. Defaults to 0.01. */
  readonly step?: number | undefined;
}

export interface CostAllocationRow {
  /** w_i / Σw as a percent. */
  readonly share: number;
  /** total × w_i / Σw, unrounded. Informative — `amount` is never derived from it. */
  readonly exact: number;
  /** Whole rounding steps this row is owed. */
  readonly units: number;
  readonly amount: number;
  /** True when this row took one of the leftover units under the largest-remainder rule. */
  readonly gotRemainderUnit: boolean;
}

export interface CostAllocationResult {
  readonly rows: readonly CostAllocationRow[];
  /**
   * Σ amount = totalUnits × step — an EXACT identity in the BigInt unit count
   * this is built from, by construction rather than by luck. Its floating-point
   * materialisation (`Number(totalUnits) * step`) can still be a ulp away from
   * `total` (69 units at a 0,01 step is 0.6900000000000001, not 0.69): compare
   * the two with a tolerance, never with `===`.
   */
  readonly checkSum: number;
  /** Units left after the floors; 0 ≤ this < rows.length. */
  readonly remainderUnits: number;
}

/**
 * Split one amount into rows by weight, so the parts add back to the whole exactly.
 *
 * **Every step is exact BigInt arithmetic — no floating quota, and no epsilon.**
 * An earlier draft floored `totalUnits * weight / weightSum + 1e-9`: at a step of
 * 0.01 and amounts in the millions that quota is already past 10^9, exactly where
 * a double's own rounding error lives, so the epsilon is at once too small to help
 * and large enough to flip a genuine `.4999…` up past the half. The whole point of
 * this tool is not trusting binary arithmetic, so it is not trusted here either:
 * weights are read as the EXACT fraction their own decimal text names (`45.50` is
 * `455/10`, never a binary neighbour of it), combined over one common denominator,
 * and every floor/remainder below is an integer division, never a `Math.floor`
 * over a float.
 *
 * `total` is required to be an exact multiple of `step` — 100.005 at a step of
 * 0.01 is refused rather than quietly rewritten to 100.01, because `checkSum`
 * promises to equal the amount the user typed, not the amount the tool rounded it
 * to first. Largest-remainder is decided on the exact integer remainder, so a
 * three-way tie (weights 1, 1, 1) is a REAL tie and not an artefact of which one
 * a float happened to land a hair above the others; the earlier-entered row wins
 * it, because `Array.prototype.sort` is stable and the comparator never looks at
 * the index.
 */
export function costAllocation(input: CostAllocationInput): ProResult<CostAllocationResult> {
  const { total, weights } = input;
  const step = input.step ?? DEFAULT_MONEY_STEP;
  if (!Number.isFinite(total)) return fail("total");
  if (weights.length === 0) return fail("weights");
  if (!isPositive(step)) return fail("step");

  let weightSum = 0;
  for (const weight of weights) {
    if (!isPositive(weight)) return fail("weight");
    weightSum += weight;
  }
  if (!isPositive(weightSum)) return fail("weight");

  const totalFraction = exactFraction(Math.abs(total));
  const stepFraction = exactFraction(step);
  const weightFractions = weights.map(exactFraction);
  if (totalFraction === undefined || stepFraction === undefined) return fail("total");
  for (const fraction of weightFractions) {
    if (fraction === undefined) return fail("weight");
  }

  // U = |total| / step, required to be a whole number of units: (|total|/step) is
  // (totalP·stepQ)/(totalQ·stepP), and it is a unit count only when that division
  // has no remainder.
  const unitsNumerator = totalFraction.p * stepFraction.q;
  const unitsDenominator = totalFraction.q * stepFraction.p;
  if (unitsDenominator === 0n || unitsNumerator % unitsDenominator !== 0n) return fail("total");
  const totalUnits = unitsNumerator / unitsDenominator;
  if (!Number.isSafeInteger(Number(totalUnits))) return fail("total");

  let commonDenominator = 1n;
  for (const fraction of weightFractions) {
    if (fraction !== undefined) commonDenominator = lcmBig(commonDenominator, fraction.q);
  }
  const scaledWeights = weightFractions.map((fraction) =>
    fraction === undefined ? 0n : fraction.p * (commonDenominator / fraction.q),
  );
  const weightTotal = scaledWeights.reduce((sum, value) => sum + value, 0n);
  if (weightTotal <= 0n) return fail("weight");

  const bases = scaledWeights.map((weight) => (totalUnits * weight) / weightTotal);
  const remainders = scaledWeights.map((weight) => (totalUnits * weight) % weightTotal);
  const baseSum = bases.reduce((sum, value) => sum + value, 0n);
  const remainderUnits = totalUnits - baseSum;
  // Guaranteed 0 ≤ R < rows.length by the identity U·W = W·Σfloor + Σremainder
  // with every remainder in [0, W): a violation would mean the arithmetic above
  // it is wrong, not that the user typed something unusual, so it is treated as
  // an internal error rather than a refusal of the input.
  if (remainderUnits < 0n || remainderUnits >= BigInt(weights.length)) {
    throw new Error("costAllocation: remainder-unit invariant violated");
  }

  const order = weights.map((_, index) => index);
  order.sort((a, b) => {
    const left = remainders[a] ?? 0n;
    const right = remainders[b] ?? 0n;
    if (left === right) return 0; // stable sort keeps the earlier-entered row first
    return left > right ? -1 : 1;
  });
  const takers = new Set(order.slice(0, Number(remainderUnits)));

  const sign = total < 0 ? -1 : 1;
  const rows = weights.map((weight, index) => {
    const gotRemainderUnit = takers.has(index);
    const units = (bases[index] ?? 0n) + (gotRemainderUnit ? 1n : 0n);
    return {
      share: (weight / weightSum) * 100,
      exact: (total * weight) / weightSum,
      units: Number(units),
      amount: units === 0n ? 0 : sign * Number(units) * step,
      gotRemainderUnit,
    };
  });

  return {
    ok: true,
    rows,
    checkSum: totalUnits === 0n ? 0 : sign * Number(totalUnits) * step,
    remainderUnits: Number(remainderUnits),
  };
}

/* ---------------------------------------------------- late-payment interest */

/** Day-count base. `actual` is ACT/ACT: each year divided by its own length. */
export type LateInterestBasis = "d365" | "d360" | "actual";

/** Simple pro-rating of the annual rate, or compounding it to the fraction. */
export type LateInterestMethod = "proportional" | "conformal";

export interface ActualYearSegment {
  readonly year: number;
  /** Counted days falling inside this calendar year. */
  readonly days: number;
  /** 366 in a leap year, 365 otherwise — the divisor ACT/ACT uses for it. */
  readonly yearLength: number;
}

export interface LatePaymentInput {
  readonly debt: number;
  /**
   * Annual rate, percent. There is no default and there never will be: the rate
   * for late payment is either agreed in the contract or set and periodically
   * republished by an authority, it changes, and it differs per jurisdiction.
   */
  readonly annualRate: number;
  /**
   * Due date. Required for the `actual` basis, which needs the calendar span.
   * May also be given ALONGSIDE `days`, as the anchor for `impliedPaymentDate` —
   * the cross-check that the two ways of stating the same delay agree.
   */
  readonly dueDate?: CalendarDate | undefined;
  readonly paymentDate?: CalendarDate | undefined;
  /** Used when the dates are absent, or alongside `dueDate` alone; whole days ≥ 0. */
  readonly days?: number | undefined;
  readonly basis: LateInterestBasis;
  readonly method: LateInterestMethod;
}

export interface LatePaymentResult {
  /** Days in arrears: the due date is not counted, the payment date is. */
  readonly days: number;
  /** The fraction of a year the basis makes of those days. */
  readonly yearFraction: number;
  /** Rounded half-up to the cent — see the note in `latePaymentInterest`. */
  readonly interest: number;
  /** debt + `interest` (the ROUNDED one), so the three printed numbers add up. */
  readonly total: number;
  /** Interest over debt for this period, as a percent — from the UNROUNDED interest. */
  readonly ratioToDebt: number;
  /**
   * The UNROUNDED interest divided by `days`, rounded once to the cent — NOT
   * `interest / days`, because `interest` is itself already rounded and
   * dividing an already-rounded cent figure would compound one rounding into
   * another. An average, not a linear rate, under the conformal method: that
   * method compounds, so its per-day share is not the same on day 1 as on day
   * 200. Undefined when `days` is 0, since there is no day to divide by.
   */
  readonly interestPerDay: number | undefined;
  /**
   * True when the conformal method is compounding OVER a year (`yearFraction` >
   * 1). A fact about the arithmetic, not a judgement on whether capitalising
   * interest yearly is something this debt is allowed to do — that question the
   * tool does not answer.
   */
  readonly compoundsAnnually: boolean;
  /** Present only for the `actual` basis, whose divisor differs per year. */
  readonly segments?: readonly ActualYearSegment[] | undefined;
  /**
   * `dueDate` + `days`, computed only when both were given directly (rather than
   * `paymentDate`) — the cross-check that a delay stated as a day count and a
   * delay stated as two dates are the same delay.
   */
  readonly impliedPaymentDate?: CalendarDate | undefined;
}

/**
 * Interest on a late payment, from the rate, base and method the user chose.
 *
 * **The rate is an input with no default, and the tool asserts nothing about it.**
 * It does not know which rule applies to this debt, does not know whether the
 * chosen method is the one that applies, and never calls the answer a statutory
 * amount — it multiplies three numbers the user typed.
 *
 * The counting rule is the one convention baked in: the due date is not counted,
 * the payment date is, which is exactly the difference of two calendar dates.
 * Under ACT/ACT the period is cut at New Year and each part divided by its own
 * year's length — without that rule a period spanning a year end has no defined
 * divisor at all, so it is applied always and reported in `segments`.
 *
 * At a whole year the two methods agree, which is the useful check on both. Below
 * a year the conformal method gives LESS than the proportional one and above a
 * year more; that is what exponentiation does, and it is not a defect.
 *
 * **`interest` is rounded before `total` is built from it — a third place, beside
 * the pro-rata split and the cost allocation, where rounding is part of the
 * arithmetic rather than of the display.** Building `total = debt + interest`
 * from the exact interest and rounding all three independently is how the three
 * printed numbers stop adding up to each other; `ratioToDebt` alone is still
 * taken from the unrounded interest, because it is a ratio of two exact
 * quantities and rounding one side of it first would only move the error.
 */
export function latePaymentInterest(input: LatePaymentInput): ProResult<LatePaymentResult> {
  const { debt, annualRate, dueDate, paymentDate, basis, method } = input;
  if (!isPositive(debt)) return fail("debt");
  if (!isInRange(annualRate, 0, 1000)) return fail("annualRate");

  const hasDates = dueDate !== undefined && paymentDate !== undefined;
  if (basis === "actual" && !hasDates) return fail(dueDate === undefined ? "dueDate" : "paymentDate");

  let days: number;
  let segments: readonly ActualYearSegment[] | undefined;
  let impliedPaymentDate: CalendarDate | undefined;
  if (hasDates) {
    if (!isCalendarDate(dueDate)) return fail("dueDate");
    if (!isCalendarDate(paymentDate)) return fail("paymentDate");
    days = daysBetween(dueDate, paymentDate);
    if (days < 0) return fail("paymentDate");
    if (basis === "actual") segments = actualYearSegments(dueDate, paymentDate);
  } else {
    if (!isIntegerIn(input.days ?? Number.NaN, 0, 400000)) return fail("days");
    days = input.days ?? 0;
    // Both readings of the same delay are cross-checked when they are both
    // available: with an anchor due date and a day count, the payment date the
    // pair implies is handed back rather than silently assumed to agree.
    if (dueDate !== undefined) {
      if (!isCalendarDate(dueDate)) return fail("dueDate");
      impliedPaymentDate = addDays(dueDate, days);
    }
  }

  const yearFraction =
    basis === "d365"
      ? days / 365
      : basis === "d360"
        ? days / 360
        : (segments ?? []).reduce((sum, part) => sum + part.days / part.yearLength, 0);

  const rate = annualRate / 100;
  const rawInterest =
    method === "conformal"
      ? debt * (Math.pow(1 + rate, yearFraction) - 1)
      : debt * rate * yearFraction;
  const interest = roundHalfUp(rawInterest, 2);

  return {
    ok: true,
    days,
    yearFraction,
    interest,
    total: debt + interest,
    ratioToDebt: (rawInterest / debt) * 100,
    interestPerDay: days === 0 ? undefined : roundHalfUp(rawInterest / days, 2),
    compoundsAnnually: method === "conformal" && yearFraction > 1,
    segments,
    impliedPaymentDate,
  };
}

/** The counted days (due + 1 .. payment) split across the calendar years they fall in. */
function actualYearSegments(due: CalendarDate, payment: CalendarDate): readonly ActualYearSegment[] {
  const first = daysFromCivil(due) + 1;
  const last = daysFromCivil(payment);
  const segments: ActualYearSegment[] = [];
  for (let year = due.year; year <= payment.year; year += 1) {
    const yearStart = daysFromCivil({ year, month: 1, day: 1 });
    const yearEnd = daysFromCivil({ year, month: 12, day: 31 });
    const days = Math.min(last, yearEnd) - Math.max(first, yearStart) + 1;
    if (days > 0) segments.push({ year, days, yearLength: isLeapYear(year) ? 366 : 365 });
  }
  return segments;
}

/* ------------------------------------------------------------- lease dates */

/** Whether the notice period the user typed is counted in days or in months. */
export type NoticeUnit = "days" | "months";

export interface LeaseTermInput {
  readonly start: CalendarDate;
  /** Term in whole months, 1..600. */
  readonly months: number;
  /**
   * The notice period from the contract. No default: this tool knows no notice
   * period, proposes none, and checks no contract against any rule.
   */
  readonly noticeAmount?: number | undefined;
  readonly noticeUnit?: NoticeUnit | undefined;
  /** Day of the month instalments fall due, 1..31. Absent means none are listed. */
  readonly installmentDay?: number | undefined;
}

export interface LeaseTermResult {
  /** Start + term. The day is clamped into a shorter month; see `expiryDayClamped`. */
  readonly expiry: CalendarDate;
  readonly expiryDayClamped: boolean;
  /** Expiry − 1 day: the last day the contract is in force. */
  readonly lastValidDay: CalendarDate;
  readonly noticeDeadline?: CalendarDate | undefined;
  /** True when the deadline computed from the typed notice falls before the start. */
  readonly noticeBeforeStart?: boolean | undefined;
  readonly totalDays: number;
  readonly installments: readonly CalendarDate[];
}

/**
 * Expiry, last day in force, notice deadline and the instalment dates.
 *
 * **Every instalment is computed from the first one, never from the previous.**
 * A 31st that was shortened to the 30th in a thirty-day month must not carry that
 * shortening into the next month — chaining the arithmetic would walk the whole
 * schedule backwards one day at a time, which is the classic monthly-recurrence
 * defect. `addMonths` is applied to the anchor month with `j`, always.
 *
 * A notice period longer than the term produces a deadline BEFORE the contract
 * started. That is reported, not hidden and not clamped: it is a true statement
 * about the numbers the user typed, and burying it would be the tool quietly
 * deciding the contract meant something else.
 */
export function leaseTermDates(input: LeaseTermInput): ProResult<LeaseTermResult> {
  const { start, months, noticeAmount, noticeUnit, installmentDay } = input;
  if (!isCalendarDate(start)) return fail("start");
  if (!isIntegerIn(months, 1, 600)) return fail("months");
  if (noticeAmount !== undefined && !isIntegerIn(noticeAmount, 0, 100000)) {
    return fail("noticeAmount");
  }
  if (noticeAmount !== undefined && noticeUnit === undefined) return fail("noticeUnit");
  if (noticeUnit !== undefined && noticeAmount === undefined) return fail("noticeAmount");
  if (installmentDay !== undefined && !isIntegerIn(installmentDay, 1, 31)) {
    return fail("installmentDay");
  }

  const expiry = addMonths(start, months);
  const lastValidDay = addDays(expiry, -1);

  let noticeDeadline: CalendarDate | undefined;
  if (noticeAmount !== undefined && noticeUnit !== undefined) {
    noticeDeadline =
      noticeUnit === "days"
        ? addDays(lastValidDay, -noticeAmount)
        : addMonths(lastValidDay, -noticeAmount);
  }

  return {
    ok: true,
    expiry,
    expiryDayClamped: expiry.day !== start.day,
    lastValidDay,
    noticeDeadline,
    noticeBeforeStart:
      noticeDeadline === undefined ? undefined : daysBetween(start, noticeDeadline) < 0,
    totalDays: daysBetween(start, lastValidDay) + 1,
    installments:
      installmentDay === undefined ? [] : installmentDates(start, months, installmentDay),
  };
}

function installmentDates(
  start: CalendarDate,
  months: number,
  installmentDay: number,
): readonly CalendarDate[] {
  const candidateDay = Math.min(installmentDay, lastDayOfMonth(start.year, start.month));
  const startsThisMonth = candidateDay >= start.day;
  // The anchor carries day 1 so `addMonths` can never clamp it, which is what
  // keeps every later instalment derived from the anchor rather than from a
  // date that has already been shortened once.
  const anchor = addMonths({ year: start.year, month: start.month, day: 1 }, startsThisMonth ? 0 : 1);
  const dates: CalendarDate[] = [];
  for (let index = 0; index < months; index += 1) {
    const month = addMonths(anchor, index);
    dates.push({
      year: month.year,
      month: month.month,
      day: Math.min(installmentDay, lastDayOfMonth(month.year, month.month)),
    });
  }
  return dates;
}

/* -------------------------------------------------------- loan amortisation */

/** Months in a year — used only to turn the nominal annual rate into a monthly one. */
const MONTHS_PER_YEAR = 12;

export interface AmortisationRow {
  /** 1-based instalment number, continuing the original numbering after a prepayment. */
  readonly month: number;
  readonly payment: number;
  readonly interest: number;
  readonly principal: number;
  /** Balance remaining AFTER this instalment. */
  readonly balance: number;
}

/** One of the two ways a lender lets a borrower use a prepayment. */
export interface PrepaymentOption {
  readonly payment: number;
  readonly instalments: number;
  readonly schedule: readonly AmortisationRow[];
  /** Interest paid over the WHOLE loan life with this option: before the prepayment, and after. */
  readonly totalInterest: number;
  /** Everything paid over the whole loan life, INCLUDING the prepayment itself. */
  readonly totalPaid: number;
  /** The original schedule's `totalInterest` minus this option's — positive is a saving. */
  readonly interestSavings: number;
}

/** What a prepayment does, in the two shapes a lender actually offers. */
export type PrepaymentEffect =
  | {
      /** The prepayment covers the whole balance: the loan closes at `payoff`. */
      readonly kind: "closes";
      readonly payoff: number;
    }
  | {
      readonly kind: "options";
      readonly balanceBefore: number;
      readonly balanceAfter: number;
      /** Same instalment, fewer of them — the last one is smaller. */
      readonly shorterTerm: PrepaymentOption & { readonly finalPayment: number };
      /** Same number of instalments, each smaller. */
      readonly lowerPayment: PrepaymentOption;
    };

export interface LoanAmortisationInput {
  readonly principal: number;
  /** Nominal annual rate, percent. Zero is a real case and takes its own branch. */
  readonly annualRate: number;
  /** Number of monthly instalments, 1..600. */
  readonly months: number;
  /** Month whose closing balance is wanted, 0..months. Optional. */
  readonly balanceMonth?: number | undefined;
  /** Amount paid in early, immediately after instalment `prepaymentMonth`. */
  readonly prepayment?: number | undefined;
  readonly prepaymentMonth?: number | undefined;
}

export interface LoanAmortisationResult {
  /** The level instalment, rounded half-up to the cent — what the bank actually charges. */
  readonly payment: number;
  readonly schedule: readonly AmortisationRow[];
  readonly totalPaid: number;
  readonly totalInterest: number;
  /** Σ of the schedule's principal column — exactly `principal`, by construction. */
  readonly principalSum: number;
  /** Balance remaining immediately after the k-th instalment, read FROM the table. */
  readonly balanceAt?: number | undefined;
  readonly prepaymentEffect?: PrepaymentEffect | undefined;
}

/**
 * The repayment schedule of a level-instalment loan, plus what a prepayment does.
 *
 * **The monthly rate is the PROPORTIONAL one, `i = NKS / 12`.** That is a
 * convention, not a law of arithmetic: a lender using the conformal convention
 * (`(1 + NKS)^(1/12) − 1`) produces different numbers, and the surface says which
 * one this is. Nothing here can tell which one a given contract uses.
 *
 * **The table is built from the ROUNDED instalment, and every row's interest is
 * rounded to the cent before that row's principal is taken as the remainder.** A
 * table built from the unrounded annuity is a table of payments that never
 * actually happen — the bank charges the rounded instalment every month — and it
 * is also why `principalSum` now equals `principal` EXACTLY rather than to within
 * a cent: each row's principal is `roundedPayment − roundedInterest`, so the
 * balance telescopes to zero and the sum of that column has nowhere else to land.
 * The last instalment absorbs whatever is left, `balance + interest`, so the
 * schedule always ends at exactly zero.
 *
 * **The closed form is downgraded to an internal sanity check, never the answer.**
 * Once the table rounds every row, `P(1+i)^k − A·((1+i)^k−1)/i` stops being the
 * same number as the balance the table actually shows after k rows — usually by a
 * cent, sometimes more over a long term — so `balanceAt` and a prepayment's
 * `balanceBefore` are both read OUT of the table.
 *
 * A zero rate is not an edge to be patched but its own branch everywhere the rate
 * is a divisor: `A = P/n`, and `buildSchedule`'s balance-driven last row already
 * gives `n'` the correct final instalment (`B' − (n′−1)·A`) without a separate case.
 */
export function loanAmortization(
  input: LoanAmortisationInput,
): ProResult<LoanAmortisationResult> {
  const { principal, annualRate, months, balanceMonth, prepayment, prepaymentMonth } = input;
  if (!isPositive(principal)) return fail("principal");
  if (!isInRange(annualRate, 0, 100)) return fail("annualRate");
  if (!isIntegerIn(months, 1, 600)) return fail("months");
  if (balanceMonth !== undefined && !isIntegerIn(balanceMonth, 0, months)) {
    return fail("balanceMonth");
  }
  if (prepayment !== undefined && !isPositive(prepayment)) return fail("prepayment");
  if (prepaymentMonth !== undefined && !isIntegerIn(prepaymentMonth, 0, months - 1)) {
    return fail("prepaymentMonth");
  }
  if (prepayment !== undefined && prepaymentMonth === undefined) return fail("prepaymentMonth");
  if (prepaymentMonth !== undefined && prepayment === undefined) return fail("prepayment");

  const rate = annualRate / 100 / MONTHS_PER_YEAR;
  const payment = roundHalfUp(annuity(principal, rate, months), 2);
  const schedule = buildSchedule(principal, rate, months, payment, 1);
  const totalPaid = schedule.reduce((sum, row) => sum + row.payment, 0);
  const totalInterest = totalPaid - principal;
  const principalSum = schedule.reduce((sum, row) => sum + row.principal, 0);

  let prepaymentEffect: PrepaymentEffect | undefined;
  if (prepayment !== undefined && prepaymentMonth !== undefined) {
    const balanceBefore = scheduleBalanceAt(schedule, principal, prepaymentMonth);
    if (prepayment >= balanceBefore) {
      prepaymentEffect = { kind: "closes", payoff: balanceBefore };
    } else {
      const balanceAfter = balanceBefore - prepayment;
      const remaining = months - prepaymentMonth;
      // Provably unreachable with this tool's own annuity: A > P·i ≥ B_k·i >
      // B'·i, so the logarithm below always has a positive argument. The guard
      // exists so a future caller that supplies its own instalment gets a
      // refusal rather than a NaN that prints as a schedule.
      if (rate > 0 && payment <= balanceAfter * rate) return fail("prepayment");

      // Interest and payments already made, up to and including instalment
      // `prepaymentMonth` — the first part of the WHOLE loan life, needed to
      // compare either option against the no-prepayment total.
      const prefix = schedule.slice(0, prepaymentMonth);
      const interestBefore = prefix.reduce((sum, row) => sum + row.interest, 0);
      const paidBefore = prefix.reduce((sum, row) => sum + row.payment, 0);

      const shortened =
        rate === 0
          ? ceilSnapped(balanceAfter / payment)
          : ceilSnapped(-Math.log(1 - (balanceAfter * rate) / payment) / Math.log(1 + rate));
      const shorterSchedule = buildSchedule(
        balanceAfter,
        rate,
        shortened,
        payment,
        prepaymentMonth + 1,
      );
      const finalRow = shorterSchedule[shorterSchedule.length - 1];
      const shorterTotalInterest =
        interestBefore + shorterSchedule.reduce((sum, row) => sum + row.interest, 0);
      const shorterTotalPaid =
        paidBefore + prepayment + shorterSchedule.reduce((sum, row) => sum + row.payment, 0);

      const lowerRate = roundHalfUp(annuity(balanceAfter, rate, remaining), 2);
      const lowerSchedule = buildSchedule(balanceAfter, rate, remaining, lowerRate, prepaymentMonth + 1);
      const lowerTotalInterest =
        interestBefore + lowerSchedule.reduce((sum, row) => sum + row.interest, 0);
      const lowerTotalPaid =
        paidBefore + prepayment + lowerSchedule.reduce((sum, row) => sum + row.payment, 0);

      prepaymentEffect = {
        kind: "options",
        balanceBefore,
        balanceAfter,
        shorterTerm: {
          instalments: shortened,
          payment,
          finalPayment: finalRow?.payment ?? 0,
          schedule: shorterSchedule,
          totalInterest: shorterTotalInterest,
          totalPaid: shorterTotalPaid,
          interestSavings: totalInterest - shorterTotalInterest,
        },
        lowerPayment: {
          payment: lowerRate,
          instalments: remaining,
          schedule: lowerSchedule,
          totalInterest: lowerTotalInterest,
          totalPaid: lowerTotalPaid,
          interestSavings: totalInterest - lowerTotalInterest,
        },
      };
    }
  }

  return {
    ok: true,
    payment,
    schedule,
    totalPaid,
    totalInterest,
    principalSum,
    balanceAt: balanceMonth === undefined ? undefined : scheduleBalanceAt(schedule, principal, balanceMonth),
    prepaymentEffect,
  };
}

/** A = P·i / (1 − (1+i)^−n), with the zero-rate branch that division needs. */
function annuity(principal: number, rate: number, months: number): number {
  if (rate === 0) return principal / months;
  return (principal * rate) / (1 - Math.pow(1 + rate, -months));
}

/** The table's own balance after `month` instalments — `opening` at month 0. */
function scheduleBalanceAt(
  schedule: readonly AmortisationRow[],
  opening: number,
  month: number,
): number {
  if (month <= 0) return opening;
  // `month` is always validated against the schedule's own length before this is
  // called, so the row exists; the fallback only keeps the return type total.
  return schedule[month - 1]?.balance ?? opening;
}

function buildSchedule(
  opening: number,
  rate: number,
  count: number,
  payment: number,
  firstMonth: number,
): readonly AmortisationRow[] {
  const rows: AmortisationRow[] = [];
  let balance = opening;
  for (let step = 0; step < count; step += 1) {
    const interest = roundHalfUp(balance * rate, 2);
    const isLast = step === count - 1;
    // The last instalment is whatever clears the balance, so the schedule ends
    // at exactly zero instead of at the residue the rounded instalment leaves.
    const rowPayment = isLast ? roundHalfUp(balance + interest, 2) : payment;
    const principalPart = rowPayment - interest;
    balance = isLast ? 0 : balance - principalPart;
    rows.push({
      month: firstMonth + step,
      payment: rowPayment,
      interest,
      principal: principalPart,
      balance,
    });
  }
  return rows;
}

/* ---------------------------------------------------------- ownership shares */

/**
 * A share as an exact reduced fraction plus its percent.
 *
 * The fraction parts are decimal STRINGS, not numbers: a sum of shares has the
 * product of the denominators under it before reduction, which leaves 2^53 behind
 * for perfectly ordinary inputs. A string prints exactly and cannot be silently
 * rounded on the way to the screen or through a serialisation boundary.
 */
export interface ShareFraction {
  readonly numerator: string;
  readonly denominator: string;
  /** Percent of the whole, half-up to four decimals. */
  readonly percent: number;
}

export interface ShareRow {
  readonly numerator: number;
  readonly denominator: number;
}

export interface OwnershipShareRow extends ShareFraction {
  /** This share of the total area, half-up to 2 dp. Absent when no area was given. */
  readonly area?: number | undefined;
  /**
   * This row's numerator once every row is put over `commonDenominator` —
   * `1/3, 1/4, 5/12` read as `4/12, 3/12, 5/12`. This is how shares are actually
   * written into a land-registry extract and compared against one another; a
   * separately-reduced fraction per row does not do that job.
   */
  readonly numeratorAtCommonDenominator: string;
}

export interface OwnershipSharesInput {
  readonly rows: readonly ShareRow[];
  readonly totalArea?: number | undefined;
}

export interface OwnershipSharesResult {
  readonly rows: readonly OwnershipShareRow[];
  readonly sum: ShareFraction;
  /** Decided on the FRACTION, never on the percents. See the note in the function. */
  readonly comparison: "exact" | "short" | "over";
  /** 1 − sum when short, sum − 1 when over, 0/1 when exact. */
  readonly difference: ShareFraction;
  /** LCM of every row's own reduced denominator — see `numeratorAtCommonDenominator`. */
  readonly commonDenominator: string;
  readonly areaCheckSum?: number | undefined;
  /** areaCheckSum − totalArea: the rounding residue, shown rather than absorbed. */
  readonly areaDifference?: number | undefined;
}

const MAX_SHARE_TERM = 1e15;

// gcd(x, 0) = x, which is what makes a zero numerator reduce — `gcdBig` is
// defined once, above, alongside `lcmBig` for `costAllocation`.

function reduceFraction(numerator: bigint, denominator: bigint): ShareFraction {
  const divisor = gcdBig(numerator, denominator);
  const n = divisor === 0n ? 0n : numerator / divisor;
  const d = divisor === 0n ? 1n : denominator / divisor;
  return { numerator: n.toString(), denominator: d.toString(), percent: percentOf(n, d) };
}

/**
 * n/d as a percent with four decimals, half-up, entirely in BigInt.
 *
 * `Number(n) / Number(d)` would lose the exactness the fractions were kept for,
 * and BigInt division truncates — so the half is added before dividing:
 * `(2·n·10^6 + d) / (2·d)` truncated is `n·10^6 / d` rounded half-up. 5/12 is the
 * case that catches a truncating implementation: it must read 41.6667, not 41.6666.
 */
function percentOf(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) return Number.NaN;
  const scaled = (numerator * 2000000n + denominator) / (2n * denominator);
  return Number(scaled) / 10000;
}

/**
 * Co-ownership shares summed as exact fractions, and turned into square metres.
 *
 * **Whether the shares add to the whole is decided on the fraction and never on
 * the percents.** 1/3 + 1/3 + 1/3 is exactly 1; as decimals it is 99.9999% for
 * any number of digits, and a tool that compared the decimals would report a
 * missing sliver of a flat that does not exist. All of the summing is BigInt:
 * a/b + c/d = (ad + cb)/(bd), reduced by Euclid at every step.
 *
 * The areas are rounded per row and their sum is REPORTED next to the total
 * rather than forced onto it. Absorbing the residue into some row would be this
 * tool deciding which co-owner pays for the rounding; a split that must come out
 * exact is what „Raspodela troškova" is for.
 */
export function ownershipShares(input: OwnershipSharesInput): ProResult<OwnershipSharesResult> {
  const { rows, totalArea } = input;
  if (rows.length === 0) return fail("rows");
  for (const row of rows) {
    if (!Number.isInteger(row.numerator) || row.numerator < 0 || row.numerator > MAX_SHARE_TERM) {
      return fail("numerator");
    }
    if (!isIntegerIn(row.denominator, 1, MAX_SHARE_TERM)) return fail("denominator");
  }
  if (totalArea !== undefined && !isPositive(totalArea)) return fail("totalArea");

  let sumNumerator = 0n;
  let sumDenominator = 1n;
  for (const row of rows) {
    const n = BigInt(row.numerator);
    const d = BigInt(row.denominator);
    sumNumerator = sumNumerator * d + n * sumDenominator;
    sumDenominator *= d;
    const divisor = gcdBig(sumNumerator, sumDenominator);
    if (divisor > 1n) {
      sumNumerator /= divisor;
      sumDenominator /= divisor;
    }
  }

  const reducedRows = rows.map((row) => reduceFraction(BigInt(row.numerator), BigInt(row.denominator)));
  let commonDenominator = 1n;
  for (const reduced of reducedRows) commonDenominator = lcmBig(commonDenominator, BigInt(reduced.denominator));

  const resultRows: OwnershipShareRow[] = reducedRows.map((reduced) => {
    const denominator = BigInt(reduced.denominator);
    const numeratorAtCommonDenominator =
      denominator === 0n ? 0n : BigInt(reduced.numerator) * (commonDenominator / denominator);
    const area =
      totalArea === undefined
        ? undefined
        : roundHalfUp((totalArea * Number(reduced.numerator)) / Number(reduced.denominator), 2);
    return { ...reduced, numeratorAtCommonDenominator: numeratorAtCommonDenominator.toString(), area };
  });

  const comparison =
    sumNumerator === sumDenominator ? "exact" : sumNumerator < sumDenominator ? "short" : "over";
  const difference =
    comparison === "exact"
      ? reduceFraction(0n, 1n)
      : comparison === "short"
        ? reduceFraction(sumDenominator - sumNumerator, sumDenominator)
        : reduceFraction(sumNumerator - sumDenominator, sumDenominator);

  const areaCheckSum =
    totalArea === undefined
      ? undefined
      : roundHalfUp(
          resultRows.reduce((sum, row) => sum + (row.area ?? 0), 0),
          2,
        );

  return {
    ok: true,
    rows: resultRows,
    sum: reduceFraction(sumNumerator, sumDenominator),
    comparison,
    difference,
    commonDenominator: commonDenominator.toString(),
    areaCheckSum,
    areaDifference:
      areaCheckSum === undefined || totalArea === undefined
        ? undefined
        : roundHalfUp(areaCheckSum - totalArea, 2),
  };
}

export interface AreaShareInput {
  /** Area of the part, in m², to at most two decimals. */
  readonly partArea: number;
  readonly wholeArea: number;
}

/**
 * The reverse direction: two measured areas back into an exact reduced share.
 *
 * Both areas are scaled to whole square centimetres before the fraction is formed,
 * because 58.40/186.00 as doubles is a repeating binary value and Euclid on it is
 * meaningless. More than two decimals is REFUSED rather than rounded away: the
 * scaling is what defines the fraction, so quietly rounding the input would
 * quietly change the answer.
 *
 * A part larger than the whole yields a fraction above 1. That is a finding about
 * the two numbers typed, and it is returned rather than refused.
 */
export function areaShareFraction(input: AreaShareInput): ProResult<ShareFraction> {
  const { partArea, wholeArea } = input;
  if (!isPositive(partArea)) return fail("partArea");
  if (!isPositive(wholeArea)) return fail("wholeArea");
  const partUnits = Math.round(partArea * 100);
  const wholeUnits = Math.round(wholeArea * 100);
  if (Math.abs(partArea * 100 - partUnits) > 1e-6) return fail("partArea");
  if (Math.abs(wholeArea * 100 - wholeUnits) > 1e-6) return fail("wholeArea");
  if (!Number.isSafeInteger(partUnits)) return fail("partArea");
  if (!Number.isSafeInteger(wholeUnits) || wholeUnits === 0) return fail("wholeArea");
  return { ok: true, ...reduceFraction(BigInt(partUnits), BigInt(wholeUnits)) };
}

/* ------------------------------------------------------------ parcel polygon */

/** 1 ar = 100 m². SI-derived definition of the are, not revisable by anyone. */
const SQM_PER_ARE = 100;
/** 1 ha = 10 000 m². SI-derived definition of the hectare. */
const SQM_PER_HECTARE = 10000;

/**
 * Two coordinates coinciding to within this are the same point.
 *
 * **This is a TOLERANCE, not a rounding nudge — do not fold it into a
 * `Math.floor`/`ceil`/`round` the way `roundHalfUp`'s own epsilon works.** It
 * decides whether two independently-typed coordinates are equal and whether a
 * cross product is small enough to treat as zero; it is never used to recover a
 * value that is one ulp off a whole number.
 */
const POINT_EPS = 1e-9;

export interface PlanePoint {
  /** Rectangular (metric) easting, in metres. Degrees of latitude are not an input. */
  readonly x: number;
  readonly y: number;
}

export interface ParcelEdge {
  /** 1-based index of the edge's start point in the ring the caller typed. */
  readonly from: number;
  /** 1-based index of its end point; wraps to 1 for the closing edge. */
  readonly to: number;
  readonly length: number;
}

export interface ParcelPolygonResult {
  readonly area: number;
  readonly ares: number;
  readonly hectares: number;
  readonly perimeter: number;
  /** Every side, individually — see the note in `parcelPolygonArea`. */
  readonly edges: readonly ParcelEdge[];
  /** Sign of the shoelace sum before the absolute value was taken. */
  readonly orientation: "ccw" | "cw";
}

/**
 * Area and perimeter of a parcel from its boundary points, by the shoelace
 * (surveyor's) formula.
 *
 * **The coordinates must be rectangular and metric** — a state projection, not
 * latitude and longitude. Degrees would produce a number in square degrees that
 * looks like square metres, which is the one wrong answer a user cannot detect.
 * Swapping the Y and X columns — common in the local convention, where a
 * coordinate is read Y first — changes neither the area nor the perimeter, only
 * the sign of `orientation`; it is therefore not a check on whether the columns
 * were entered the right way round.
 *
 * **Every coordinate is translated by the first point before the shoelace sum is
 * taken, and shifted back never matters because area is translation-invariant.**
 * A state-plane easting is commonly seven digits before the decimal point; the
 * cross products in the raw formula then subtract two numbers that agree in
 * their first six or seven digits; and a 20 x 20 m square at a real Serbian
 * state-plane coordinate is that; consequently, this measured about 399.99 m²
 * instead of 400.00 m² before the coordinates were centred on their own first
 * point. Translating first keeps every term of the sum close to the size of the
 * parcel itself, where a double has all its precision to give.
 *
 * **A self-intersecting ring is refused rather than measured, and „intersecting"
 * also covers a touch.** The shoelace sum over a crossed ring is the ALGEBRAIC
 * area — the overlapping lobe subtracts — so a strictly-crossing pair of edges is
 * refused; but a vertex sitting exactly ON another edge, two edges running along
 * the same line for part of their length, or the same point typed twice in a row
 * anywhere in the list all cross-multiply to zero and would sail through a test
 * that only asked "do the signs differ". Those are checked for directly: a
 * repeated point anywhere in the ring is refused outright, and a zero cross
 * product between two non-adjacent edges is followed by a bounding-box test
 * before it is allowed to pass. Every pair of non-adjacent edges is checked; that
 * is O(n²) and n here is of the order of ten.
 *
 * Collinear points are refused too: their area really is zero, and printing
 * „0,00 m²" would read as a measurement rather than as „this is not a polygon".
 */
export function parcelPolygonArea(
  points: readonly PlanePoint[],
): ProResult<ParcelPolygonResult> {
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return fail("points");
  }
  const first = points[0];
  const last = points[points.length - 1];
  // A ring typed with its closing point repeated is the same ring; the duplicate
  // would otherwise contribute a zero-length edge and one spurious "point".
  const ring =
    points.length > 1 && first !== undefined && last !== undefined && samePoint(first, last)
      ? points.slice(0, -1)
      : points;

  if (countDistinct(ring) < 3) return fail("points");
  // A repeated point anywhere else in the list is the same defect as the
  // closing-point duplicate above, just not at the seam — and it is exactly what
  // a mistyped survey list looks like.
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    if (current !== undefined && next !== undefined && samePoint(current, next)) {
      return fail("points");
    }
  }
  if (hasSelfIntersection(ring)) return fail("selfIntersecting");

  const anchor = ring[0];
  if (anchor === undefined) return fail("points");
  const shifted = ring.map((point) => ({ x: point.x - anchor.x, y: point.y - anchor.y }));

  let cross = 0;
  let perimeter = 0;
  const edges: ParcelEdge[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const current = shifted[index];
    const next = shifted[(index + 1) % shifted.length];
    if (current === undefined || next === undefined) continue;
    cross += current.x * next.y - next.x * current.y;
    const length = Math.hypot(next.x - current.x, next.y - current.y);
    perimeter += length;
    edges.push({ from: index + 1, to: ((index + 1) % ring.length) + 1, length });
  }
  if (cross === 0) return fail("collinear");

  const area = Math.abs(cross) / 2;
  return {
    ok: true,
    area,
    ares: area / SQM_PER_ARE,
    hectares: area / SQM_PER_HECTARE,
    perimeter,
    edges,
    orientation: cross > 0 ? "ccw" : "cw",
  };
}

function samePoint(a: PlanePoint, b: PlanePoint): boolean {
  return Math.abs(a.x - b.x) <= POINT_EPS && Math.abs(a.y - b.y) <= POINT_EPS;
}

function countDistinct(points: readonly PlanePoint[]): number {
  let distinct = 0;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (point === undefined) continue;
    let seen = false;
    for (let j = 0; j < i; j += 1) {
      const earlier = points[j];
      if (earlier !== undefined && samePoint(point, earlier)) {
        seen = true;
        break;
      }
    }
    if (!seen) distinct += 1;
  }
  return distinct;
}

/** (a − o) × (b − o): positive when o→a→b turns left. */
function turn(o: PlanePoint, a: PlanePoint, b: PlanePoint): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Whether `p`, already known collinear with `a`→`b`, falls within that segment's span. */
function withinSegmentBounds(a: PlanePoint, b: PlanePoint, p: PlanePoint): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - POINT_EPS &&
    p.x <= Math.max(a.x, b.x) + POINT_EPS &&
    p.y >= Math.min(a.y, b.y) - POINT_EPS &&
    p.y <= Math.max(a.y, b.y) + POINT_EPS
  );
}

function hasSelfIntersection(ring: readonly PlanePoint[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      // Edge 0 and edge n−1 share the first vertex, so they are adjacent too.
      if (i === 0 && j === n - 1) continue;
      const p = ring[i];
      const q = ring[(i + 1) % n];
      const r = ring[j];
      const t = ring[(j + 1) % n];
      if (p === undefined || q === undefined || r === undefined || t === undefined) continue;
      const pqr = turn(p, q, r);
      const pqt = turn(p, q, t);
      const rtp = turn(r, t, p);
      const rtq = turn(r, t, q);
      // A strict crossing: the two endpoints of each edge fall on opposite sides
      // of the other edge's line.
      if (Math.sign(pqr) !== Math.sign(pqt) && Math.sign(rtp) !== Math.sign(rtq)) return true;
      // A touch or an overlap: one edge's line passes exactly through the other
      // edge's endpoint (cross product zero), which a sign comparison alone
      // reads as "no crossing" even when a vertex sits ON the other side, two
      // edges run along the same line for part of their length, or the ring was
      // typed with a duplicate point that survived the adjacency it should have
      // been caught at.
      if (pqr === 0 && withinSegmentBounds(p, q, r)) return true;
      if (pqt === 0 && withinSegmentBounds(p, q, t)) return true;
      if (rtp === 0 && withinSegmentBounds(r, t, p)) return true;
      if (rtq === 0 && withinSegmentBounds(r, t, q)) return true;
    }
  }
  return false;
}

/* --------------------------------------------------------- plot density index */

export interface PlotDensityInput {
  readonly plotArea: number;
  /** Gross developed floor area (BRGP), m². Optional. */
  readonly grossFloorArea?: number | undefined;
  /** Area the building covers on the ground, m². Optional. */
  readonly footprint?: number | undefined;
  /**
   * Plot ratio read from the planning document for THIS plot. No default: the
   * tool knows no plan, proposes no ratio and checks nothing against one.
   */
  readonly planRatio?: number | undefined;
  /** Site coverage from the plan, percent, 0 < z ≤ 100. Same rule as `planRatio`. */
  readonly planCoverage?: number | undefined;
}

export interface PlotDensityResult {
  /** BRGP / plot. Absent when no BRGP was given. */
  readonly ratio?: number | undefined;
  /** footprint / plot, percent. Absent when no footprint was given. */
  readonly coverage?: number | undefined;
  /** plot − footprint. NEGATIVE is the arithmetic inconsistency, not an error. */
  readonly freeArea?: number | undefined;
  /** freeArea / plot, as a percent — the same free-area fact the ratio above states in m². */
  readonly freeAreaPercent?: number | undefined;
  /**
   * BRGP / footprint. NOT a storey count: that reading holds only if every floor
   * shares the footprint's gabarit and none of the BRGP sits below ground, both
   * of which are choices the plan or the rulebook makes, not this division. Absent
   * when the footprint is zero — not zero, not infinity.
   */
  readonly floorAreaToFootprintRatio?: number | undefined;
  readonly grossFloorAreaAtPlanRatio?: number | undefined;
  /** `ratio` (the typed BRGP's own computed index) / `planRatio` — a bare quotient, see the function note. */
  readonly ratioAgainstPlan?: number | undefined;
  /** BRGP allowed by the typed ratio minus the BRGP typed; signed. */
  readonly grossFloorAreaDifference?: number | undefined;
  readonly footprintAtPlanCoverage?: number | undefined;
  readonly coverageAgainstPlan?: number | undefined;
  /** Footprint allowed by the typed coverage minus the footprint typed; signed. */
  readonly footprintDifference?: number | undefined;
}

/**
 * Plot ratio, site coverage, free area and the BRGP/footprint quotient — and the
 * reverse: what a typed ratio and coverage permit on this plot.
 *
 * **Every index here is the user's, read off their own planning document.** The
 * tool holds none, defaults none, and returns the computed number next to the
 * typed one — and their bare quotient — without a word about whether the pair is
 * allowed. „Allowed" is a question about a specific plan for a specific plot, and
 * this file has never seen either; a field named after a verdict would be this
 * tool claiming it had.
 *
 * What counts INSIDE the BRGP figure — terraces, loggias, garages, a basement —
 * is likewise a question for the plan or the rulebook the user is working to,
 * never a definition this division supplies.
 *
 * A footprint larger than the plot is not refused: it produces a negative free
 * area, which is precisely the statement that the two numbers cannot both be
 * true. That is arithmetic, and it is left visible rather than turned into a verdict.
 */
export function plotDensityIndex(input: PlotDensityInput): ProResult<PlotDensityResult> {
  const { plotArea, grossFloorArea, footprint, planRatio, planCoverage } = input;
  if (!isPositive(plotArea)) return fail("plotArea");
  if (grossFloorArea !== undefined && !isNonNegative(grossFloorArea)) return fail("grossFloorArea");
  if (footprint !== undefined && !isNonNegative(footprint)) return fail("footprint");
  if (planRatio !== undefined && !isPositive(planRatio)) return fail("planRatio");
  if (planCoverage !== undefined && !(isInRange(planCoverage, 0, 100) && planCoverage > 0)) {
    return fail("planCoverage");
  }

  const ratio = grossFloorArea === undefined ? undefined : grossFloorArea / plotArea;
  const coverage = footprint === undefined ? undefined : (footprint / plotArea) * 100;
  const atPlanRatio = planRatio === undefined ? undefined : plotArea * planRatio;
  const atPlanCoverage = planCoverage === undefined ? undefined : (plotArea * planCoverage) / 100;
  const freeArea = footprint === undefined ? undefined : plotArea - footprint;
  return {
    ok: true,
    ratio,
    coverage,
    freeArea,
    freeAreaPercent: freeArea === undefined ? undefined : (freeArea / plotArea) * 100,
    floorAreaToFootprintRatio:
      grossFloorArea === undefined || footprint === undefined || footprint === 0
        ? undefined
        : grossFloorArea / footprint,
    grossFloorAreaAtPlanRatio: atPlanRatio,
    // The bare quotient of the two ratios, never a verdict about it: the typed
    // index and the one the tool computed from BRGP and plot, side by side.
    ratioAgainstPlan: ratio === undefined || planRatio === undefined ? undefined : ratio / planRatio,
    grossFloorAreaDifference:
      atPlanRatio === undefined || grossFloorArea === undefined
        ? undefined
        : atPlanRatio - grossFloorArea,
    footprintAtPlanCoverage: atPlanCoverage,
    coverageAgainstPlan:
      coverage === undefined || planCoverage === undefined ? undefined : coverage / planCoverage,
    footprintDifference:
      atPlanCoverage === undefined || footprint === undefined ? undefined : atPlanCoverage - footprint,
  };
}

/* -------------------------------------------------------------- pro-rata days */

/**
 * Day-count base for the split. `act` counts calendar days; `e30360` is the
 * 30E/360 (Eurobond) convention as defined in the ISDA 2006 Definitions,
 * section 4.16 — a named convention the user picks explicitly, never a guess.
 */
export type ProRataBasis = "act" | "e30360";

/** 30E/360: a year is 360 days, a month 30, both day-of-month values capped at 30. */
const E30360_DAYS_PER_YEAR = 360;
const E30360_DAYS_PER_MONTH = 30;

export interface ProRataInput {
  readonly total: number;
  readonly periodStart: CalendarDate;
  /** Last day of the period, INCLUSIVE. */
  readonly periodEnd: CalendarDate;
  /** Handover: the first day belonging to the second party. */
  readonly handover: CalendarDate;
  /** Defaults to `act`, which is the identity „count the days there are". */
  readonly basis?: ProRataBasis | undefined;
}

export interface ProRataResult {
  readonly daysFirst: number;
  readonly daysSecond: number;
  readonly totalDays: number;
  readonly amountFirst: number;
  /** total − amountFirst, by difference. Never rounded on its own. */
  readonly amountSecond: number;
  /** amountFirst + amountSecond — equal to `total` because the second is a remainder. */
  readonly checkSum: number;
  readonly basis: ProRataBasis;
}

/**
 * Split one period's amount between two occupiers at a handover date.
 *
 * **The second amount is a REMAINDER, not a second rounding.** Rounding both
 * shares independently leaves the pair a cent away from the whole about half the
 * time, and that cent then has to be explained to two people who each have a
 * correct-looking calculation. Rounding once and subtracting makes the sum exact
 * by construction.
 *
 * The one rounding that does happen is half-up on the exact decimal: 41.595 is
 * stored below its own value, so a naive `Math.round(x * 100)` gives a cent less
 * than is owed. `roundHalfUp` is the whole pack's single answer to that.
 *
 * Dates are calendar triples throughout. Through a local time zone the March
 * clock change makes a 31-day March 30.958 days long, and the split then depends
 * on where the computer is.
 */
export function proRataDays(input: ProRataInput): ProResult<ProRataResult> {
  const { total, periodStart, periodEnd, handover } = input;
  const basis = input.basis ?? "act";
  if (!isNonNegative(total)) return fail("total");
  if (!isCalendarDate(periodStart)) return fail("periodStart");
  if (!isCalendarDate(periodEnd)) return fail("periodEnd");
  if (!isCalendarDate(handover)) return fail("handover");
  if (daysBetween(periodStart, periodEnd) < 0) return fail("periodEnd");

  const dayAfterEnd = addDays(periodEnd, 1);
  if (daysBetween(periodStart, handover) < 0 || daysBetween(handover, dayAfterEnd) < 0) {
    return fail("handover");
  }

  // N must span the WHOLE period (periodEnd + 1 day), not "one calendar month from
  // the start": those coincide only when the period IS exactly one month, and for
  // any other length (a 45-day handover, a quarter) the denominator would silently
  // stop matching the numerator's period, and the two shares would stop summing
  // to the whole. A prior draft used `addMonths(periodStart, 1)` here, which is
  // exactly that bug.
  const totalDays =
    basis === "e30360"
      ? e30360Days(periodStart, addDays(periodEnd, 1))
      : daysBetween(periodStart, periodEnd) + 1;
  const daysFirst =
    basis === "e30360"
      ? e30360Days(periodStart, handover)
      : daysBetween(periodStart, handover);
  if (totalDays <= 0) return fail("periodEnd");

  const amountFirst = roundHalfUp((total * daysFirst) / totalDays, 2);
  const amountSecond = total - amountFirst;
  return {
    ok: true,
    daysFirst,
    daysSecond: totalDays - daysFirst,
    totalDays,
    amountFirst,
    amountSecond,
    checkSum: amountFirst + amountSecond,
    basis,
  };
}

/** 360(y2−y1) + 30(m2−m1) + (min(d2,30) − min(d1,30)). ISDA 2006, section 4.16. */
function e30360Days(from: CalendarDate, to: CalendarDate): number {
  return (
    E30360_DAYS_PER_YEAR * (to.year - from.year) +
    E30360_DAYS_PER_MONTH * (to.month - from.month) +
    (Math.min(to.day, 30) - Math.min(from.day, 30))
  );
}

/* ---------------------------------------------------------- rent escalation */

export interface RentEscalationInput {
  /** Rent for the first period, before any indexation. */
  readonly baseRent: number;
  readonly periods: number;
  /**
   * Escalation per period, percent: one fixed number, or a list of length
   * `periods` whose FIRST entry is ignored because period 1 is not indexed. Never
   * defaulted — a price index is published by somebody else and changes.
   */
  readonly index: number | readonly number[];
  /** Discount rate per period, percent. Optional; above −100. */
  readonly discountRate?: number | undefined;
}

export interface RentEscalationResult {
  readonly rents: readonly number[];
  readonly total: number;
  readonly average: number;
  /** The closed-form total, as a check on the term-by-term sum. Fixed non-zero index only. */
  readonly closedFormTotal?: number | undefined;
  readonly presentValue?: number | undefined;
}

/**
 * Rent per period once the index the user typed is applied, its total, and its
 * present value.
 *
 * Two conventions, both reported by the surface: the first period is NOT indexed
 * (escalation starts with the second), and payment falls at the START of the
 * period — which is why the discount exponent is `t − 1` and not `t`.
 *
 * The total is always summed term by term. The closed form
 * `R0 · ((1+p)^n − 1) / p` divides by the index, so at p = 0 it is not a shortcut
 * but a division by zero; it is returned alongside as a CHECK on the sum, never
 * as its source.
 */
export function rentEscalation(input: RentEscalationInput): ProResult<RentEscalationResult> {
  const { baseRent, periods, discountRate } = input;
  if (!isPositive(baseRent)) return fail("baseRent");
  if (!isIntegerIn(periods, 1, 600)) return fail("periods");

  const fixedIndex = typeof input.index === "number" ? input.index : undefined;
  const indexList = typeof input.index === "number" ? undefined : input.index;
  if (fixedIndex !== undefined && (!Number.isFinite(fixedIndex) || fixedIndex <= -100)) {
    return fail("index");
  }
  if (indexList !== undefined) {
    if (indexList.length < periods) return fail("index");
    for (let t = 1; t < periods; t += 1) {
      const value = indexList[t];
      if (value === undefined || !Number.isFinite(value) || value <= -100) return fail("index");
    }
  }
  if (discountRate !== undefined && (!Number.isFinite(discountRate) || discountRate <= -100)) {
    return fail("discountRate");
  }

  const rents: number[] = [];
  let rent = baseRent;
  for (let t = 0; t < periods; t += 1) {
    if (t > 0) {
      // No `?? 0` default: `indexList[t]` was checked above for every
      // t in 1..periods−1, so this is unreachable today — but a defaulted
      // price index reads as "no escalation this period" instead of the
      // refusal a missing regulated quantity deserves, so a future loosening
      // of that validation gets a refusal here rather than a silent 0%.
      const percent = fixedIndex ?? indexList?.[t];
      if (percent === undefined) return fail("index");
      rent *= 1 + percent / 100;
    }
    rents.push(rent);
  }

  const total = rents.reduce((sum, value) => sum + value, 0);
  const growth = fixedIndex === undefined ? 0 : fixedIndex / 100;
  return {
    ok: true,
    rents,
    total,
    average: total / periods,
    closedFormTotal:
      fixedIndex === undefined || growth === 0
        ? undefined
        : (baseRent * (Math.pow(1 + growth, periods) - 1)) / growth,
    presentValue:
      discountRate === undefined
        ? undefined
        : rents.reduce(
            (sum, value, t) => sum + value / Math.pow(1 + discountRate / 100, t),
            0,
          ),
  };
}

/* --------------------------------------------------------- rent gross / net */

export interface RentGrossNetInput {
  /** The contracted amount. Give this or `net`; if both, the gross wins. */
  readonly gross?: number | undefined;
  /** The amount that remains. */
  readonly net?: number | undefined;
  /** Recognised-cost percentage deducted from the gross, 0 ≤ n < 100. No default. */
  readonly costPercent: number;
  /** Rate applied to the base, percent, 0..100. Set by law and changed by law: no default. */
  readonly taxRate: number;
}

export interface RentGrossNetResult {
  readonly base: number;
  readonly taxAmount: number;
  /** Rounded gross − rounded `taxAmount` — see the note on why this is not the exact subtraction. */
  readonly net: number;
  readonly gross: number;
  /** gross − taxAmount, unrounded — the control value `net` is built to stay close to. */
  readonly exactNet: number;
  /** `net` − `exactNet`: the cent the rounded subtraction can be out by, shown rather than hidden. */
  readonly netRoundingResidual: number;
  /** (1 − n) × s as a percent — computed algebraically, never from rounded amounts. */
  readonly effectiveShare: number;
  /**
   * 1 − (typed net / typed gross) as a percent, present only when the caller gave
   * BOTH raw amounts. A bare quotient set beside `effectiveShare` — comparing the
   * two is the only reason to fill in both boxes at once, and it is a ratio, not
   * a verdict on which figure is right.
   */
  readonly impliedEffectiveShare?: number | undefined;
  readonly computedFrom: "gross" | "net";
  /** The rate the caller typed, echoed back so the printed result is self-checking. */
  readonly taxRate: number;
  readonly costPercent: number;
}

/**
 * The contracted amount converted to what remains, and back.
 *
 * **The tool knows no rate and no cost percentage.** Both are set by law and
 * changed by law; it does not know which law applies to this user, and it does
 * not claim the amount it prints is anybody's liability. It multiplies the base
 * by the rate — `taxAmount = base × s` — never the gross by the rate directly,
 * which is the mistake this tool exists to prevent.
 *
 * **`net` is built from the ROUNDED gross and the ROUNDED tax amount, not
 * subtracted first and rounded after.** Rounding all three independently is how
 * three printed rows stop summing to each other on some inputs while happening to
 * agree on others; building `net` from the other two displayed figures makes the
 * row's own arithmetic checkable with a calculator. The untouched value is kept
 * in `exactNet`, and `netRoundingResidual` is the (usually zero, occasionally one
 * cent) gap between the two — printed rather than absorbed.
 *
 * The effective share is derived algebraically as `(1 − n)·s` rather than from the
 * rounded amounts, because the reverse direction divides by `1 − e` and a share
 * built from two rounded figures would not invert the forward direction exactly.
 */
export function rentGrossNet(input: RentGrossNetInput): ProResult<RentGrossNetResult> {
  const { costPercent, taxRate } = input;
  if (!isNonNegative(costPercent) || costPercent >= 100) return fail("costPercent");
  if (!isInRange(taxRate, 0, 100)) return fail("taxRate");
  if (input.gross !== undefined && !isPositive(input.gross)) return fail("gross");
  if (input.net !== undefined && !isPositive(input.net)) return fail("net");
  if (input.gross === undefined && input.net === undefined) return fail("gross");

  const costs = costPercent / 100;
  const rate = taxRate / 100;
  const effective = (1 - costs) * rate;

  const computedFrom = input.gross !== undefined ? "gross" : "net";
  let gross: number;
  if (input.gross !== undefined) {
    gross = input.gross;
  } else {
    // e = 1 needs s = 1 and n = 0, and then the net is zero for every gross:
    // the reverse direction has no answer rather than a large one.
    if (effective >= 1) return fail("taxRate");
    gross = (input.net ?? 0) / (1 - effective);
  }

  const base = gross * (1 - costs);
  const taxAmount = base * rate;
  const exactNet = gross - taxAmount;
  const roundedGross = roundHalfUp(gross, 2);
  const roundedTax = roundHalfUp(taxAmount, 2);
  const net = roundedGross - roundedTax;

  return {
    ok: true,
    base,
    taxAmount,
    net,
    gross,
    exactNet,
    netRoundingResidual: roundHalfUp(net - exactNet, 2),
    effectiveShare: effective * 100,
    impliedEffectiveShare:
      input.gross === undefined || input.net === undefined
        ? undefined
        : (1 - input.net / input.gross) * 100,
    computedFrom,
    taxRate,
    costPercent,
  };
}

/* -------------------------------------------------------------- rental yield */

export interface RentalYieldInput {
  /** Purchase price or value. Absent when only the reverse direction is wanted. */
  readonly price?: number | undefined;
  readonly monthlyRent: number;
  /** Occupancy percent, 0..100. Defaults to 100 — the identity, not an estimate. */
  readonly occupancy?: number | undefined;
  /** Monthly costs. Absent means the user entered none, which adds nothing. */
  readonly monthlyCosts?: number | undefined;
  readonly annualCosts?: number | undefined;
  /** Capitalisation rate for the reverse direction, percent above zero. */
  readonly capRate?: number | undefined;
}

export interface RentalYieldResult {
  /** Gross potential income: rent × 12, before any vacancy. */
  readonly grossPotentialIncome: number;
  readonly effectiveGrossIncome: number;
  /** Net operating income: effective income less the costs, at their full amount. */
  readonly netOperatingIncome: number;
  readonly grossYield?: number | undefined;
  /** NOI / price as a percent — this is the capitalisation rate. */
  readonly netYield?: number | undefined;
  /** price / gross potential income. */
  readonly grossRentMultiplier?: number | undefined;
  readonly paybackYears?: number | undefined;
  readonly valueAtCapRate?: number | undefined;
  /**
   * The occupancy this run applied, % — see `ShelfSpacingResult.rasterUsed`. It
   * is the difference between the potential and the effective income, so an
   * echo printing its own 100 while the arithmetic used something else would
   * contradict the two figures directly above it.
   */
  readonly occupancyUsed: number;
}

/**
 * Yields, multiplier and payback from a price, a rent and the costs typed in.
 *
 * **Costs are not scaled by occupancy, and the surface says so.** An empty flat
 * still pays its own charges; scaling them with the vacancy would flatter the net
 * yield exactly when the property is doing worst. Every cost here is the user's
 * own entry — the tool adds none of its own and assumes none.
 *
 * When the costs exceed the income the NOI is negative, and payback and the
 * reverse direction are withheld rather than printed as a negative number of
 * years. That is arithmetic refusing to answer, not a judgement about the deal.
 */
export function rentalYield(input: RentalYieldInput): ProResult<RentalYieldResult> {
  const { price, monthlyRent, capRate } = input;
  const occupancy = input.occupancy ?? 100;
  const monthlyCosts = input.monthlyCosts ?? 0;
  const annualCosts = input.annualCosts ?? 0;
  if (price !== undefined && !isPositive(price)) return fail("price");
  if (!isNonNegative(monthlyRent)) return fail("monthlyRent");
  if (!isInRange(occupancy, 0, 100)) return fail("occupancy");
  if (!isNonNegative(monthlyCosts)) return fail("monthlyCosts");
  if (!isNonNegative(annualCosts)) return fail("annualCosts");
  if (capRate !== undefined && !isPositive(capRate)) return fail("capRate");

  const grossPotentialIncome = monthlyRent * MONTHS_PER_YEAR;
  const effectiveGrossIncome = (grossPotentialIncome * occupancy) / 100;
  const netOperatingIncome =
    effectiveGrossIncome - monthlyCosts * MONTHS_PER_YEAR - annualCosts;

  return {
    ok: true,
    grossPotentialIncome,
    effectiveGrossIncome,
    netOperatingIncome,
    grossYield: price === undefined ? undefined : (grossPotentialIncome / price) * 100,
    netYield: price === undefined ? undefined : (netOperatingIncome / price) * 100,
    grossRentMultiplier:
      price === undefined || grossPotentialIncome === 0
        ? undefined
        : price / grossPotentialIncome,
    paybackYears:
      price === undefined || netOperatingIncome <= 0 ? undefined : price / netOperatingIncome,
    valueAtCapRate:
      capRate === undefined || netOperatingIncome <= 0
        ? undefined
        : netOperatingIncome / (capRate / 100),
    occupancyUsed: occupancy,
  };
}

/* ------------------------------------------------------------- room quadrangle */

export interface RoomQuadInput {
  /** Side A→B, metres. */
  readonly a: number;
  /** Side B→C. */
  readonly b: number;
  /** Side C→D. */
  readonly c: number;
  /** Side D→A. */
  readonly d: number;
  /** Diagonal A→C, measured INSIDE the room — that is what a tape between two corners is. */
  readonly e: number;
}

export interface RoomQuadResult {
  readonly area: number;
  readonly triangleAbc: number;
  readonly triangleAcd: number;
  /** Angle at corner B, between sides a and b, in degrees. */
  readonly angleB: number;
  /** angleB − 90, signed: how far out of square that corner is. */
  readonly deviationFrom90: number;
  /**
   * Angle at corner D, between sides c and d, in degrees — the OTHER corner the
   * diagonal touches. A room is out of square in general at every corner, not
   * only at B, and the diagonal happens to give this one for free.
   */
  readonly angleD: number;
  readonly deviationFrom90AtD: number;
}

/**
 * Area of a room from four measured walls and one diagonal, because a room is
 * almost never the rectangle its plan says it is.
 *
 * Four sides do not determine a quadrilateral — a hinged frame of four bars has a
 * whole family of shapes and areas. The diagonal is what fixes it, splitting ABCD
 * into two triangles that Heron then measures. This is also why the refusal names
 * WHICH measurement cannot be right: when the diagonal will not fit against a pair
 * of sides, one of the three numbers is mistyped or mis-measured, and saying which
 * pair failed is the difference between a usable answer and „invalid input".
 *
 * **Both corners the diagonal touches are reported, B and D.** The reason this
 * tool exists is that the room is not a rectangle, which is true at every corner
 * at once — a diagonal drawn to check squareness reveals the angle at each end it
 * lands on, and reporting only one of the two throws away the second for free.
 *
 * The radicand is clamped at zero and the cosine argument at ±1 before the square
 * root and the arc cosine: at a nearly degenerate triangle both fall a few ulps
 * outside their domain and would return NaN for a shape that is merely flat.
 *
 * The arithmetic assumes the diagonal lies inside the room. A room with a re-entrant
 * corner has to be cut into two quadrilaterals and measured twice.
 */
export function roomQuadArea(input: RoomQuadInput): ProResult<RoomQuadResult> {
  const { a, b, c, d, e } = input;
  if (!isPositive(a)) return fail("a");
  if (!isPositive(b)) return fail("b");
  if (!isPositive(c)) return fail("c");
  if (!isPositive(d)) return fail("d");
  if (!isPositive(e)) return fail("e");
  if (e >= a + b) return fail("diagonalTooLongAB");
  if (e <= Math.abs(a - b)) return fail("diagonalTooShortAB");
  if (e >= c + d) return fail("diagonalTooLongCD");
  if (e <= Math.abs(c - d)) return fail("diagonalTooShortCD");

  const triangleAbc = heron(a, b, e);
  if (triangleAbc === 0) return fail("collinearABC");
  const triangleAcd = heron(c, d, e);
  if (triangleAcd === 0) return fail("collinearACD");

  const cosineB = Math.min(1, Math.max(-1, (a * a + b * b - e * e) / (2 * a * b)));
  const angleB = Math.acos(cosineB) * DEG_PER_RAD;
  const cosineD = Math.min(1, Math.max(-1, (c * c + d * d - e * e) / (2 * c * d)));
  const angleD = Math.acos(cosineD) * DEG_PER_RAD;
  return {
    ok: true,
    area: triangleAbc + triangleAcd,
    triangleAbc,
    triangleAcd,
    angleB,
    deviationFrom90: angleB - 90,
    angleD,
    deviationFrom90AtD: angleD - 90,
  };
}

/**
 * Heron's formula in the numerically stable ORDERED form, radicand clamped.
 *
 * The naive `s(s−a)(s−b)(s−c)` subtracts nearly-equal numbers on a sliver
 * triangle — exactly what a narrow room produces, which is this tool's whole
 * reason to exist — and loses most of its significant digits doing it. Sorting
 * the three sides `a ≥ b ≥ c` and using `¼√((a+(b+c))(c−(a−b))(c+(a−b))(a+(b−c)))`
 * (Kahan's form) keeps every factor a sum of positive quantities, so no
 * cancellation happens before the square root.
 */
function heron(p: number, q: number, r: number): number {
  const a = Math.max(p, q, r);
  const c = Math.min(p, q, r);
  const b = p + q + r - a - c;
  const radicand = (a + (b + c)) * (c - (a - b)) * (c + (a - b)) * (a + (b - c));
  return 0.25 * Math.sqrt(Math.max(0, radicand));
}

/* ---------------------------------------------------------- walls and ceiling */

export interface WallOpening {
  readonly width: number;
  readonly height: number;
  /** How many identical openings of these dimensions. Whole number, at least 1. */
  readonly count: number;
}

export interface WallCeilingInput {
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly openings: readonly WallOpening[];
  /** Defaults to false — a ceiling is a separate job as often as not. */
  readonly includeCeiling?: boolean | undefined;
  /**
   * m² per litre or per kilogram FOR ONE COAT, from the product's own
   * declaration. No default — and no correction for a declaration that already
   * states a two-coat figure; the caller reads the tin.
   */
  readonly coverage?: number | undefined;
  /** Number of coats, 1..10. Defaults to 1. */
  readonly coats?: number | undefined;
  /** Size of one container, in the same unit as `coverage`. Optional. */
  readonly packageSize?: number | undefined;
  /**
   * Perimeter override, in m — for a room that is not a rectangle (an L-shape,
   * say), where `2 × (length + width)` is not the true wall run. When given, it
   * replaces the computed perimeter everywhere below; `length` and `width` still
   * fix the ceiling.
   */
  readonly perimeterOverride?: number | undefined;
  /** Depth of the reveal (špaletna) around each opening, in m. Optional. */
  readonly revealDepth?: number | undefined;
}

export interface WallCeilingResult {
  readonly perimeter: number;
  readonly wallsGross: number;
  readonly openingsArea: number;
  readonly wallsNet: number;
  /**
   * `roundHalfUp(wallsGross) − roundHalfUp(openingsArea) − roundHalfUp(wallsNet)`:
   * the cent the DISPLAYED subtraction can be out by. `wallsNet` itself stays the
   * exact figure; this is the disclosure the review asked for, as a number rather
   * than a sentence.
   */
  readonly wallsNetRoundingGap: number;
  /** Always computed, so the surface can show it even when it is not in the total. */
  readonly ceiling: number;
  readonly ceilingIncluded: boolean;
  readonly total: number;
  /** Quantity in the unit the coverage was given in. Absent when no coverage was typed. */
  readonly material?: number | undefined;
  /** ceil(material / packageSize) — cans are bought whole. Absent without both figures. */
  readonly packageCount?: number | undefined;
  /**
   * Σ 2×(width+height)×depth×count over every opening — the jamb area a flush
   * net-wall figure leaves out entirely. A window's sill side is often left
   * unfinished; that is a site decision the number does not make.
   */
  readonly revealArea?: number | undefined;
}

/**
 * Net wall and ceiling area with the openings taken out, and how much material
 * that is at the coverage printed on the tin.
 *
 * **This is the rounding case the whole pack is built around.** 46.8 − 5.205 is
 * 41.594999999999999 in a double, so `Math.round(x * 100) / 100` prints 41.59
 * where the answer is 41.60 — a square-metre-and-a-half of paint over a flat.
 * The values returned here are exact and the surface prints them through
 * `roundHalfUp`, which is the one place that repair lives. `wallsNetRoundingGap`
 * states the OTHER half of that fact: even done correctly, rounding `wallsGross`
 * and `openingsArea` independently for display does not always leave `wallsNet`
 * equal to their rounded difference, and this is that gap, computed rather than
 * hidden.
 *
 * **Every opening is checked against the room it sits in, not only the running
 * total.** A 3 m tall door in a 2.6 m room fails no aggregate test — the sum of
 * openings can still be well under the gross wall area — so each opening's own
 * height is checked against the room height and its own width against the wider
 * of the two walls.
 *
 * Openings that add up to the whole wall are refused rather than answered with
 * zero: a wall that is entirely door has been mistyped, and „0,00 m²" would look
 * like a result.
 *
 * The material figure is the bare geometric quantity. It contains no allowance for
 * waste, overlap or what stays in the roller.
 */
export function wallCeilingArea(input: WallCeilingInput): ProResult<WallCeilingResult> {
  const { length, width, height, openings, coverage, revealDepth, packageSize } = input;
  const coats = input.coats ?? 1;
  const includeCeiling = input.includeCeiling ?? false;
  if (!isPositive(length)) return fail("length");
  if (!isPositive(width)) return fail("width");
  if (!isPositive(height)) return fail("height");
  if (!isIntegerIn(coats, 1, 10)) return fail("coats");
  if (coverage !== undefined && !isPositive(coverage)) return fail("coverage");
  if (input.perimeterOverride !== undefined && !isPositive(input.perimeterOverride)) {
    return fail("perimeterOverride");
  }
  if (revealDepth !== undefined && !isPositive(revealDepth)) return fail("revealDepth");
  if (packageSize !== undefined && !isPositive(packageSize)) return fail("packageSize");

  const longerWall = Math.max(length, width);
  let openingsArea = 0;
  let revealArea = 0;
  for (const opening of openings) {
    if (!isPositive(opening.width)) return fail("openingWidth");
    if (!isPositive(opening.height)) return fail("openingHeight");
    if (!isIntegerIn(opening.count, 1, 1000)) return fail("openingCount");
    // Checked per opening, not only in aggregate: a tall door in a low room can
    // pass an aggregate-area test easily while being physically impossible.
    if (opening.height > height) return fail("openingHeight");
    if (opening.width > longerWall) return fail("openingWidth");
    openingsArea += opening.width * opening.height * opening.count;
    if (revealDepth !== undefined) {
      revealArea += 2 * (opening.width + opening.height) * revealDepth * opening.count;
    }
  }

  const perimeter = input.perimeterOverride ?? 2 * (length + width);
  const wallsGross = perimeter * height;
  if (openingsArea >= wallsGross) return fail("openings");

  const wallsNet = wallsGross - openingsArea;
  const ceiling = length * width;
  const total = wallsNet + (includeCeiling ? ceiling : 0);
  const material = coverage === undefined ? undefined : (total * coats) / coverage;
  return {
    ok: true,
    perimeter,
    wallsGross,
    openingsArea,
    wallsNet,
    wallsNetRoundingGap: roundHalfUp(
      roundHalfUp(wallsGross, 2) - roundHalfUp(openingsArea, 2) - roundHalfUp(wallsNet, 2),
      2,
    ),
    ceiling,
    ceilingIncluded: includeCeiling,
    total,
    material,
    packageCount:
      material === undefined || packageSize === undefined
        ? undefined
        : ceilSnapped(material / packageSize),
    revealArea: revealDepth === undefined ? undefined : revealArea,
  };
}

/* -------------------------------------------------------------- weighted area */

export interface WeightedAreaRow {
  /** The part's area in m². Give this, or `length` and `width`. */
  readonly area?: number | undefined;
  readonly length?: number | undefined;
  readonly width?: number | undefined;
  /**
   * The coefficient for this part, 0..5. Set by the contract or by whichever
   * rulebook the parties adopted: the tool knows none, offers none, checks none.
   */
  readonly coefficient: number;
}

export interface WeightedAreaRowResult {
  readonly area: number;
  readonly coefficient: number;
  /** area × coefficient. */
  readonly contribution: number;
}

export interface WeightedAreaInput {
  readonly rows: readonly WeightedAreaRow[];
  /** Price per m² of WEIGHTED area. Optional. */
  readonly pricePerSquareMetre?: number | undefined;
}

export interface WeightedAreaResult {
  readonly rows: readonly WeightedAreaRowResult[];
  /** Σ area — the plain sum, before any coefficient. */
  readonly netArea: number;
  /** Σ area × coefficient — the area the price is charged on. */
  readonly weightedArea: number;
  readonly totalPrice?: number | undefined;
  /**
   * `totalPrice` / `netArea` — the price per square metre of NET area, the
   * figure a listing quotes, standing beside `pricePerSquareMetre` which is per
   * square metre of the CONTRACTED (weighted) area. The two are different
   * numbers for the same flat whenever any coefficient is not 1, which is
   * exactly why this tool exists.
   */
  readonly pricePerNetSquareMetre?: number | undefined;
}

/**
 * Weighted (chargeable) area: each part's measured area times its coefficient.
 *
 * **The coefficients are the user's**, out of their contract or the rulebook they
 * are working to. This tool holds none, suggests none and verifies none — a
 * balcony at 0.5 is a term somebody negotiated, not a fact about balconies.
 *
 * A coefficient of zero is allowed and is not a mistake: the part counts toward
 * the net area and contributes nothing to the chargeable one, which is exactly
 * how a basement store is often treated. Both sums come from the unrounded areas,
 * so the surface never adds rounded rows.
 */
export function weightedArea(input: WeightedAreaInput): ProResult<WeightedAreaResult> {
  const { rows, pricePerSquareMetre } = input;
  if (rows.length === 0) return fail("rows");
  if (pricePerSquareMetre !== undefined && !isNonNegative(pricePerSquareMetre)) {
    return fail("pricePerSquareMetre");
  }

  const resolved: WeightedAreaRowResult[] = [];
  for (const row of rows) {
    if (!isInRange(row.coefficient, 0, 5)) return fail("coefficient");
    let area: number;
    if (row.area !== undefined) {
      if (!isPositive(row.area)) return fail("area");
      area = row.area;
    } else {
      if (!isPositive(row.length ?? Number.NaN)) return fail("length");
      if (!isPositive(row.width ?? Number.NaN)) return fail("width");
      area = (row.length ?? 0) * (row.width ?? 0);
    }
    resolved.push({ area, coefficient: row.coefficient, contribution: area * row.coefficient });
  }

  const netArea = resolved.reduce((sum, row) => sum + row.area, 0);
  const weighted = resolved.reduce((sum, row) => sum + row.contribution, 0);
  const totalPrice = pricePerSquareMetre === undefined ? undefined : weighted * pricePerSquareMetre;
  return {
    ok: true,
    rows: resolved,
    netArea,
    weightedArea: weighted,
    totalPrice,
    pricePerNetSquareMetre: totalPrice === undefined ? undefined : totalPrice / netArea,
  };
}
