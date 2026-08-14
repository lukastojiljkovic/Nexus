/**
 * „Trening i sport" — the arithmetic behind the toolkit's tools.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` explains:
 * the rail groups by category and the profile filters by pack, but a maintainer
 * asks „where does the plate calculator live", and `pro/trening.ts` answers it.
 *
 * **These are pure functions and they refuse rather than repair.** No clock, no
 * locale, no randomness, no I/O. A surface owns its own state, and every number
 * it prints comes from here — which is why the test vectors are ones a person can
 * check by hand rather than snapshots of whatever the code happened to produce.
 *
 * **Nothing here decides anything about a body.** Not one function in this pack
 * says whether a percentage is healthy, a heart rate is safe, a weight cut is
 * advisable or a fatigue index is bad. Two of the tools carry a number a rule-
 * maker owns — the symmetry threshold and the weight-class limit — and both are
 * INPUTS with no default, because a federation changes its own categories and a
 * clinic chooses its own return-to-play criterion. The output hands back the
 * quantity and the user's own number, never a word about the pair.
 *
 * **Rounding lives at the display, with two deliberate exceptions.** Everything
 * returned here is unrounded, so the surface can round once, at the end. The
 * exceptions are quantities that are integral by nature: a target heart rate is a
 * whole beat, and a loadable barbell weight is a whole number of steps. Those are
 * rounded here because rounding IS the computation, not the presentation.
 *
 * **Clock strings are digits and colons, never words.** Where the tool's answer
 * is a duration in a fixed clock layout, the string is produced here rather than
 * in the surface, so the „minutes past 60 simply grow" rule is written once and
 * tested once instead of being re-derived at four call sites. Anything with a
 * decimal fraction of a second stays a number, because the decimal separator is a
 * locale decision and this package has no locale.
 */

import { estimateOneRepMax, ONE_RM_MAX_REPS } from "../fitness/training.js";
import {
  ceilSnapped,
  fail,
  isInRange,
  isIntegerIn,
  isNonNegative,
  isPositive,
  type ProResult,
  roundHalfUp,
} from "./result.js";

/** Standard gravity, m/s². 3rd CGPM (1901) — fixed by definition, not measured. */
const G = 9.80665;

/** Centimetres in a metre. SI prefix definition. */
const CM_PER_M = 100;

/** Metres in a kilometre. SI prefix definition. */
const M_PER_KM = 1000;

/** Seconds in a minute; sexagesimal time. */
const SEC_PER_MIN = 60;

/** Seconds in an hour; sexagesimal time. */
const SEC_PER_HOUR = 3600;

/** Days in a week; calendar definition. */
const DAYS_PER_WEEK = 7;

/** km/h per m/s — 3600 s/h over 1000 m/km, a unit identity and not a measurement. */
const KMH_PER_MPS = 3.6;

/**
 * The international mile in metres. International yard and pound agreement
 * (1959): 1 yd = 0,9144 m exactly, hence 1 mi = 1609,344 m exactly.
 */
const M_PER_MILE = 1609.344;

/**
 * A technical ceiling on every mass in kilograms, not a policy about athletes.
 *
 * Two tools do their arithmetic in integer hundredths of a kilogram to keep a
 * tie-break exact, and the products they form stay inside `Number.MAX_SAFE_INTEGER`
 * only while the inputs stay below this. Above it the integers would silently
 * stop being exact, which is the one failure mode worse than a refusal.
 */
const MAX_KG = 1e6;

/** A whole count above zero: reps, sets, beats. `isIntegerIn` wants a ceiling; these lack one. */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** A whole count of zero or more — days, seconds of rest, pairs of plates. */
function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * At or above zero and strictly below 100. Exactly 100 divides by zero
 * downstream — but zero itself is a legitimate reading (0 % measured, or a
 * target of 0 %), so it is not refused the way the two ends once both were.
 */
function isPercentBelowHundred(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value < 100;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * mm:ss. The minute field is NOT capped at 60 — a 75-minute block reads `75:00`,
 * because introducing an hour into a field the user asked for in minutes is a
 * silent change of unit. Seconds are rounded half up first, so 119,6 s reads
 * `02:00` rather than `01:59`.
 */
function clockMmSs(seconds: number): string {
  const whole = roundHalfUp(seconds, 0);
  return `${pad2(Math.floor(whole / SEC_PER_MIN))}:${pad2(whole % SEC_PER_MIN)}`;
}

/** h:mm:ss — the hour field unpadded, minutes and seconds padded to two digits. */
function clockHMmSs(seconds: number): string {
  const whole = roundHalfUp(seconds, 0);
  const minutes = Math.floor(whole / SEC_PER_MIN) % SEC_PER_MIN;
  return `${Math.floor(whole / SEC_PER_HOUR)}:${pad2(minutes)}:${pad2(whole % SEC_PER_MIN)}`;
}

/**
 * Exact integer floor division for safe integers.
 *
 * `Math.floor(a/b)` is not enough: once `a/b` is not representable the quotient
 * can land a hair on the wrong side of an exact multiple, and the whole reason
 * these divisions are done in integers is that a tie has to be decided exactly.
 */
function floorDiv(a: number, b: number): number {
  let q = Math.floor(a / b);
  if (q * b > a) q -= 1;
  else if ((q + 1) * b <= a) q += 1;
  return q;
}

/** Exact integer ceiling division; `b` must be above zero. */
function ceilDiv(a: number, b: number): number {
  return -floorDiv(-a, b);
}

/**
 * Speed in m/s from a pace in seconds per `referenceMetres`, or the reverse pace
 * from a speed — `distance/time` is the same division either way, so ONE
 * function serves both directions and both the kilometre and the mile pace
 * fields, rather than a fresh `1000/v` written out at each call site. Cadence
 * and running pace both read this relation; a third, everyday speed tool
 * outside this pack should read the same one rather than its own copy.
 */
function paceSpeedRelation(secondsOrMetresPerSecond: number, referenceMetres: number): number {
  return referenceMetres / secondsOrMetresPerSecond;
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/* ------------------------------------------------------------------ barbell */

export interface PlateStock {
  /** Mass of ONE plate, in kg — the number stamped on it, not the pair. */
  readonly mass: number;
  /**
   * How many PAIRS are available, because a barbell is loaded symmetrically.
   * Absent means unlimited: the mass ladder (25/20/15/10/5/2,5/1,25 kg) is
   * equipment that exists, but how many of each a given gym owns is a fact
   * about the gym this function has never seen. `0` still means „none of this
   * plate" and drops it from the inventory — only an EMPTY field is unbounded.
   */
  readonly pairs?: number | undefined;
}

export interface BarbellInput {
  /** Total load wanted, bar included, in kg. */
  readonly target: number;
  /**
   * Mass of the bar in front of the user, in kg. A measurable object rather than
   * a standard: 20 kg, 15 kg, 25 kg and 10 kg bars all exist, so the surface
   * pre-fills 20 and this function never assumes one.
   */
  readonly bar: number;
  /** Mass of ONE collar, in kg; both collars are counted. */
  readonly collar: number;
  /** The gym's inventory. Duplicate masses are merged by summing their pairs. */
  readonly plates: readonly PlateStock[];
}

export interface BarbellSidePlate {
  /** Mass of one plate, in kg. */
  readonly mass: number;
  /** How many of this plate go on ONE side. */
  readonly count: number;
}

export interface BarbellLoad {
  /**
   * Mass of the bar this load was built on, kg — echoed from the input. 20 kg is
   * a common assumption and not a certainty (women's bars are 15 kg, and half the
   * bars in a commercial gym are neither), so the achieved total is meaningless
   * without this sitting beside it.
   */
  readonly bar: number;
  /** Plates for one side, heaviest first — the order they are loaded in. */
  readonly perSide: readonly BarbellSidePlate[];
  /** Mass on one side, in kg, collars excluded. */
  readonly perSideMass: number;
  /** How many plates go on one side. */
  readonly plateCount: number;
  /** Bar + both collars + both sides, in kg. */
  readonly achieved: number;
  /** achieved − target, in kg, signed — negative means the bar is lighter than asked. */
  readonly difference: number;
}

/**
 * Ceiling on the DP's work, so an inventory too fine for the target refuses
 * instead of hanging. This is reached by real inventories, not only
 * pathological ones — an unlimited count of every plate down to 0,5 kg pushes
 * a large target well past it — which is why it fails with its own reason
 * (`"tooManyOperations"`) rather than `"plates"`: the row itself was fine, the
 * search it produced was not, and a surface should be able to tell the two apart.
 */
const MAX_PLATE_OPERATIONS = 1_000_000;

/** Ceiling on distinct plate masses; a rack holds a dozen, not a thousand. */
const MAX_PLATE_TYPES = 32;

interface PlateCandidate {
  /** Plates on one side. */
  readonly count: number;
  /** Pairs taken of each type, in the types' descending-mass order. */
  readonly mult: readonly number[];
}

/**
 * Strictly better under the assignment's tie-break: fewest plates first, then the
 * lexicographically greater descending multiset.
 *
 * Comparing the multiplicity vectors index by index IS comparing the flattened
 * descending plate lists, because the types are held in descending mass order and
 * the two lists being compared have the same length (equal plate counts). Where
 * one vector takes more of the heavier type, its list carries that heavier plate
 * at the position where the other has already dropped to a lighter one.
 */
function betterPlateCandidate(a: PlateCandidate, b: PlateCandidate): boolean {
  if (a.count !== b.count) return a.count < b.count;
  for (let i = 0; i < a.mult.length; i += 1) {
    const av = a.mult[i] ?? 0;
    const bv = b.mult[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return false;
}

/**
 * Which plates to put on one side for a wanted total, and by how much the closest
 * reachable load misses it.
 *
 * **Everything is done in integer hundredths of a kilogram.** Nothing is halved —
 * plates go on in pairs and the per-side sum is doubled, never divided — so no
 * fractional hundredth can appear, and the „is this load closer than that one"
 * comparison is `|R − 2s|` on integers rather than on floats that are a hair
 * apart. That matters because the answer is frequently a tie and the tie is
 * decided by a rule, not by rounding noise.
 *
 * A bounded-knapsack pass enumerates every per-side sum the inventory can reach
 * and keeps, for each one, the multiset with the fewest plates and — among those —
 * the lexicographically greatest descending list, so 25+15 is chosen over 20+20
 * and the heaviest plate always goes on first. Ties on distance are broken toward
 * the SMALLER sum, so an unreachable target rounds down to the lighter bar rather
 * than silently handing the lifter more than they asked for.
 *
 * The state space is indexed in units of the greatest common divisor of the plate
 * masses: every reachable sum is a multiple of it, so an inventory of 1,25 kg
 * multiples costs a hundred and twenty-five times fewer cells than hundredths.
 */
export function barbellPlateLoading(input: BarbellInput): ProResult<BarbellLoad> {
  const { target, bar, collar, plates } = input;
  if (!isPositive(target) || target > MAX_KG) return fail("target");
  if (!isNonNegative(bar) || bar > MAX_KG) return fail("bar");
  if (!isNonNegative(collar) || collar > MAX_KG) return fail("collar");
  if (plates.length > MAX_PLATE_TYPES) return fail("plates");

  // `undefined` means unlimited; merging two rows of the same mass stays
  // unlimited if EITHER one was, and only sums when both gave a count.
  const merged = new Map<number, number | undefined>();
  for (const stock of plates) {
    if (!isPositive(stock.mass) || stock.mass > MAX_KG) return fail("plates");
    if (stock.pairs !== undefined && !isNonNegativeInteger(stock.pairs)) return fail("plates");
    const massH = Math.round(stock.mass * 100);
    // A plate under half a gram rounds to nothing and would give the DP a zero
    // step, which is an infinite loop rather than an answer.
    if (massH <= 0) return fail("plates");
    if (stock.pairs === 0) continue;
    const existing = merged.get(massH);
    const nextPairs = !merged.has(massH)
      ? stock.pairs
      : existing === undefined || stock.pairs === undefined
        ? undefined
        : existing + stock.pairs;
    merged.set(massH, nextPairs);
  }

  const targetH = Math.round(target * 100);
  const barH = Math.round(bar * 100);
  const collarH = Math.round(collar * 100);
  // What has to sit on the two sides together. Negative means the bar and its
  // collars already weigh more than the target, and there is no honest answer.
  const remainder = targetH - barH - 2 * collarH;
  if (remainder < 0) return fail("belowBar");

  const types = [...merged.entries()].sort((a, b) => b[0] - a[0]);
  const step = types.reduce((acc, [massH]) => gcd(acc, massH), 0) || 1;
  const heaviest = types[0]?.[0] ?? 0;
  // An unlimited plate contributes an unlimited amount of "available" mass —
  // `capH` still ends up finite because it is also bounded by the target side.
  const available = types.reduce(
    (acc, [massH, pairs]) => acc + massH * (pairs ?? Number.POSITIVE_INFINITY),
    0,
  );
  const capH = Math.max(0, Math.min(Math.floor(remainder / 2) + heaviest, available));
  const cap = Math.floor(capH / step);

  let operations = 0;
  for (const [massH, pairs] of types) {
    // Beyond floor(cap / massIdx) pairs of one plate alone exceed the whole
    // per-side cap, so that is the real bound whether the count was typed or
    // left open — the DP loop below never needs to see `pairs` as Infinity.
    const bound = pairs === undefined ? Math.floor(cap / (massH / step)) : Math.min(pairs, cap);
    operations += (cap + 1) * (bound + 1);
  }
  if (operations > MAX_PLATE_OPERATIONS) return fail("tooManyOperations");

  let reach: (PlateCandidate | undefined)[] = new Array<PlateCandidate | undefined>(cap + 1);
  reach[0] = { count: 0, mult: new Array<number>(types.length).fill(0) };
  for (let j = 0; j < types.length; j += 1) {
    const entry = types[j];
    if (entry === undefined) continue;
    const [massH, pairs] = entry;
    const massIdx = massH / step;
    const boundedPairs = pairs === undefined ? Math.floor(cap / massIdx) : pairs;
    const next = new Array<PlateCandidate | undefined>(cap + 1);
    for (let s = 0; s <= cap; s += 1) {
      const from = reach[s];
      if (from === undefined) continue;
      for (let k = 0; k <= boundedPairs; k += 1) {
        const to = s + k * massIdx;
        if (to > cap) break;
        const mult = [...from.mult];
        mult[j] = k;
        const candidate: PlateCandidate = { count: from.count + k, mult };
        const current = next[to];
        if (current === undefined || betterPlateCandidate(candidate, current)) next[to] = candidate;
      }
    }
    reach = next;
  }

  // Ascending, replacing only on a strictly smaller miss, so a tie keeps the
  // smaller sum — the „round down to the lighter load" half of the rule.
  let bestSum = 0;
  let best = reach[0] ?? { count: 0, mult: [] };
  let bestMiss = Math.abs(remainder);
  for (let s = 1; s <= cap; s += 1) {
    const candidate = reach[s];
    if (candidate === undefined) continue;
    const miss = Math.abs(remainder - 2 * s * step);
    if (miss < bestMiss) {
      bestMiss = miss;
      bestSum = s;
      best = candidate;
    }
  }

  const perSide: BarbellSidePlate[] = [];
  for (let j = 0; j < types.length; j += 1) {
    const count = best.mult[j] ?? 0;
    const entry = types[j];
    if (count > 0 && entry !== undefined) perSide.push({ mass: entry[0] / 100, count });
  }

  const perSideH = bestSum * step;
  const achievedH = barH + 2 * collarH + 2 * perSideH;
  return {
    ok: true,
    bar,
    perSide,
    perSideMass: perSideH / 100,
    plateCount: best.count,
    achieved: achievedH / 100,
    // Subtracted in hundredths and divided once, so the sign and the magnitude
    // are exact rather than the residue of two float subtractions.
    difference: (achievedH - targetH) / 100,
  };
}

/* ------------------------------------------------------- body composition */

export interface BodyCompositionInput {
  /** Body mass, kg. */
  readonly mass: number;
  /** Measured body-fat percentage — caliper, BIA or DEXA. This tool estimates none. */
  readonly bodyFat: number;
  /** Wanted body-fat percentage. */
  readonly target: number;
}

export interface BodyComposition {
  /** Fat mass, kg. */
  readonly fatMass: number;
  /** Lean body mass, kg. */
  readonly leanMass: number;
  /** Body mass at the target percentage, kg, with lean mass held constant. */
  readonly targetMass: number;
  /** targetMass − mass, kg, signed. */
  readonly change: number;
  /** Fat mass at the target percentage, kg. */
  readonly targetFatMass: number;
}

/**
 * Fat mass, lean mass, and the mass the same body would have at another fat
 * percentage.
 *
 * **The one thing to get wrong is what is held constant.** `targetMass` is
 * `LBM/(1 − p/100)`, which assumes lean mass does not move — that assumption is
 * the whole content of the answer and the surface prints it beside the number.
 * The tool is arithmetic on a measurement, not a prediction of what a diet or a
 * training block will do, and it never says whether any percentage is good.
 *
 * A target of exactly 100 % is refused rather than clamped: the denominator is
 * zero there and the honest answer is that the question has none.
 */
export function bodyComposition(input: BodyCompositionInput): ProResult<BodyComposition> {
  const { mass, bodyFat, target } = input;
  if (!isPositive(mass)) return fail("mass");
  if (!isPercentBelowHundred(bodyFat)) return fail("bodyFat");
  if (!isPercentBelowHundred(target)) return fail("target");

  const fatMass = (mass * bodyFat) / 100;
  const leanMass = mass - fatMass;
  const targetMass = leanMass / (1 - target / 100);
  return {
    ok: true,
    fatMass,
    leanMass,
    targetMass,
    change: targetMass - mass,
    targetFatMass: (targetMass * target) / 100,
  };
}

/* ------------------------------------------------------------ body indices */

export interface BodyIndicesInput {
  /** Body mass, kg. */
  readonly mass: number;
  /** Standing height, cm. */
  readonly height: number;
  /** Waist circumference, cm. Absent means the two waist rows are not computed. */
  readonly waist?: number | undefined;
  /** Hip circumference, cm. */
  readonly hip?: number | undefined;
}

export interface BodyIndices {
  /** kg/m². */
  readonly bmi: number;
  /** Ponderal index, kg/m³. */
  readonly ponderal: number;
  /** Waist ÷ height, unit-free. Undefined when the waist was not measured. */
  readonly waistToHeight: number | undefined;
  /** Waist ÷ hip, unit-free. Undefined unless both were measured. */
  readonly waistToHip: number | undefined;
}

/**
 * BMI, the ponderal index and the two waist ratios — four numbers and not one
 * category.
 *
 * **No classification is computed anywhere in this function, on purpose.** A BMI
 * band is a table somebody revises, it differs by population and by the body it
 * is applied to, and printing „normalno" beside 25,9 would be this app asserting
 * which table applies to a person it has never seen. The number is the answer;
 * the interpretation belongs to whoever took the measurement.
 *
 * The waist ratios are deliberately computed from the centimetre values as typed:
 * both sides carry the same unit, so the ratio is unit-free and converting would
 * only add a place to lose precision.
 */
export function bodyIndices(input: BodyIndicesInput): ProResult<BodyIndices> {
  const { mass, height, waist, hip } = input;
  if (!isPositive(mass)) return fail("mass");
  if (!isPositive(height)) return fail("height");
  if (waist !== undefined && !isPositive(waist)) return fail("waist");
  if (hip !== undefined && !isPositive(hip)) return fail("hip");

  const heightM = height / CM_PER_M;
  return {
    ok: true,
    bmi: mass / (heightM * heightM),
    ponderal: mass / (heightM * heightM * heightM),
    waistToHeight: waist === undefined ? undefined : waist / height,
    waistToHip: waist === undefined || hip === undefined ? undefined : waist / hip,
  };
}

/* ---------------------------------------------------------------- cadence */

/** How the speed field was typed. `pacePerKm` carries SECONDS per kilometre. */
export type SpeedUnit = "mps" | "kmh" | "pacePerKm";

export interface SpeedEntry {
  readonly unit: SpeedUnit;
  /** m/s, km/h, or seconds per kilometre, according to `unit`. */
  readonly value: number;
}

export interface CadenceInput {
  /** Steps per minute, both legs. Absent means „compute this one". */
  readonly cadence?: number | undefined;
  /** Length of ONE step in metres — not of a whole stride. */
  readonly stepLength?: number | undefined;
  readonly speed?: SpeedEntry | undefined;
}

export interface CadenceResult {
  readonly cadence: number;
  /** Length of one step, m. */
  readonly stepLength: number;
  readonly speedMps: number;
  readonly speedKmh: number;
  /** Seconds per kilometre. */
  readonly pacePerKm: number;
  readonly stepsPerKm: number;
}

/**
 * Cadence, step length and speed: give any two and this returns the third.
 *
 * **`stepLength` is one step, never a stride.** The same tape measure gives
 * either number depending on which is meant, and the two differ by a factor of
 * two — so the surface states it beside the field and the doc comment states it
 * here, rather than leaving a reader to guess which convention the 60 belongs to.
 *
 * Exactly one of the three fields must be empty. Two empty fields have no unique
 * answer and zero empty fields is an over-determined system whose numbers would
 * quietly disagree, so both are refused instead of being reconciled.
 */
export function cadenceStride(input: CadenceInput): ProResult<CadenceResult> {
  const { cadence, stepLength, speed } = input;
  const given = [cadence !== undefined, stepLength !== undefined, speed !== undefined];
  if (given.filter(Boolean).length !== 2) return fail("fields");

  if (cadence !== undefined && !isPositive(cadence)) return fail("cadence");
  if (stepLength !== undefined && !isPositive(stepLength)) return fail("stepLength");
  if (speed !== undefined && !isPositive(speed.value)) return fail("speed");

  let speedMps: number;
  if (speed === undefined) {
    if (cadence === undefined || stepLength === undefined) return fail("fields");
    speedMps = (cadence * stepLength) / SEC_PER_MIN;
  } else if (speed.unit === "mps") speedMps = speed.value;
  else if (speed.unit === "kmh") speedMps = speed.value / KMH_PER_MPS;
  else speedMps = paceSpeedRelation(speed.value, M_PER_KM);
  if (!isPositive(speedMps)) return fail("speed");

  const resolvedCadence =
    cadence !== undefined
      ? cadence
      : stepLength === undefined
        ? Number.NaN
        : (SEC_PER_MIN * speedMps) / stepLength;
  const resolvedStep =
    stepLength !== undefined
      ? stepLength
      : cadence === undefined
        ? Number.NaN
        : (SEC_PER_MIN * speedMps) / cadence;
  if (!isPositive(resolvedCadence)) return fail("cadence");
  if (!isPositive(resolvedStep)) return fail("stepLength");

  return {
    ok: true,
    cadence: resolvedCadence,
    stepLength: resolvedStep,
    speedMps,
    speedKmh: speedMps * KMH_PER_MPS,
    pacePerKm: paceSpeedRelation(speedMps, M_PER_KM),
    stepsPerKm: M_PER_KM / resolvedStep,
  };
}

/* -------------------------------------------------------------- erg split */

/**
 * Concept2's published relation between pace and power for its performance
 * monitors: watts = 2,80/(seconds per metre)³, with the 500 m split as the
 * monitor's own display unit. This is the manufacturer's definition of what its
 * instrument shows, not a figure an authority revises — and it describes the
 * DISPLAY, not the athlete's metabolic cost.
 */
const CONCEPT2_COEFFICIENT = 2.8;

/** Metres in the reference split, Concept2's display unit for the same monitor. */
const SPLIT_METRES = 500;

export interface ErgInput {
  /** Seconds per 500 m. Absent means „compute it from the power". */
  readonly split?: number | undefined;
  /** Watts. Absent means „compute it from the split". */
  readonly power?: number | undefined;
  /** Distance the split is projected over, metres. */
  readonly distance: number;
}

export interface ErgResult {
  readonly power: number;
  /** Seconds per 500 m. */
  readonly split: number;
  /** Seconds per metre — the quantity the published relation is actually written in. */
  readonly pace: number;
  /** Seconds the distance takes if the split is held. */
  readonly projected: number;
  /**
   * The coefficient the relation was computed with — echoed rather than left
   * implicit, because it is the one trace that the power figure comes from
   * Concept2's own published pace-to-power relation and not from a measurement.
   */
  readonly coefficient: number;
  /** The split's reference distance, m — 500 m is the RowErg/SkiErg monitor's own display unit, not a universal split length. */
  readonly referenceMetres: number;
}

/**
 * Split ↔ watts on the published Concept2 relation, and what the entered distance
 * costs at that split.
 *
 * **The projected time is not a prediction.** It is the arithmetic of holding one
 * split for the whole distance, which is what the athlete asked for and not what
 * they will row; the surface says so beside the number.
 *
 * The inverse takes `Math.cbrt` rather than `** (1/3)`. The exponent form returns
 * `NaN` for a negative base in JavaScript, and while the guards make the base
 * positive here, the cube root is the operation that is meant and the one that
 * stays correct if a guard is ever loosened.
 */
export function ergSplitWatts(input: ErgInput): ProResult<ErgResult> {
  const { split, power, distance } = input;
  const given = [split !== undefined, power !== undefined];
  if (given.filter(Boolean).length !== 1) return fail("fields");
  if (!isPositive(distance)) return fail("distance");
  if (split !== undefined && !isPositive(split)) return fail("split");
  if (power !== undefined && !isPositive(power)) return fail("power");

  const pace =
    split !== undefined ? split / SPLIT_METRES : Math.cbrt(CONCEPT2_COEFFICIENT / (power ?? 0));
  if (!isPositive(pace)) return fail("split");

  return {
    ok: true,
    power: CONCEPT2_COEFFICIENT / (pace * pace * pace),
    split: SPLIT_METRES * pace,
    pace,
    projected: distance * pace,
    coefficient: CONCEPT2_COEFFICIENT,
    referenceMetres: SPLIT_METRES,
  };
}

/* ------------------------------------------------------- heart-rate zones */

/**
 * The default table: 50–100 % in 5-point steps. An arithmetic progression, not a
 * named zone model — the table is the reason this tool clears the bar of being
 * more than „one percentage plus an addition", so an absent `percents` gets the
 * whole table rather than a single row.
 */
const HR_DEFAULT_PERCENTS = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100] as const;

export interface HeartRateInput {
  /** Measured maximum heart rate, beats per minute. Never derived from an age. */
  readonly hrMax: number;
  /** Resting heart rate, beats per minute. */
  readonly hrRest: number;
  /**
   * Percentages to tabulate, 0–100. Absent means the default 50–100 % ladder in
   * 5-point steps; an explicitly empty array means „no table", for a caller that
   * wants the reverse direction alone.
   */
  readonly percents?: readonly number[] | undefined;
  /** A heart rate to run backwards through both methods. */
  readonly measuredHr?: number | undefined;
}

export interface HeartRateRow {
  readonly percent: number;
  /** HRrest + p × HRR, whole beats. */
  readonly karvonen: number;
  /** p × HRmax, whole beats. */
  readonly percentOfMax: number;
}

export interface HeartRateResult {
  /** Heart-rate reserve, HRmax − HRrest, beats. */
  readonly reserve: number;
  readonly rows: readonly HeartRateRow[];
  /** Where the measured rate sits in the reserve, %. Unrounded; may be negative. */
  readonly measuredPercentOfReserve: number | undefined;
  /** Measured rate over HRmax, %. Unrounded. */
  readonly measuredPercentOfMax: number | undefined;
}

/**
 * Target heart rates by Karvonen and by percentage of maximum, and the reverse
 * for a rate that was actually measured.
 *
 * **There is no age formula anywhere in this tool and that is the design.**
 * `220 − age`, Tanaka and every other regression is a population fit with a
 * standard deviation of ten-odd beats around it; applying one to an individual
 * and calling the output „your maximum" is the error the tool exists to avoid.
 * HRmax is a measurement the user types, or the tool has no answer.
 *
 * Zones are not named, not coloured and not recommended — only the numbers the
 * entered percentages produce. The two columns disagree by construction (Karvonen
 * starts from the resting rate), which is why each carries its method's name.
 *
 * A measured rate below the resting rate yields a negative reserve percentage and
 * is reported as computed: clamping it to zero would hide a mistyped resting rate.
 */
export function heartRateZones(input: HeartRateInput): ProResult<HeartRateResult> {
  const { hrMax, hrRest, measuredHr } = input;
  if (!isPositiveInteger(hrRest)) return fail("hrRest");
  if (!isPositiveInteger(hrMax) || hrMax <= hrRest) return fail("hrMax");
  const percents = input.percents ?? HR_DEFAULT_PERCENTS;
  for (const percent of percents) if (!isInRange(percent, 0, 100)) return fail("percents");
  if (measuredHr !== undefined && !isPositive(measuredHr)) return fail("measuredHr");

  const reserve = hrMax - hrRest;
  const rows = percents.map((percent) => ({
    percent,
    // Whole beats, because a target heart rate is a beat count and not a
    // fraction of one — this is the rounding that IS the computation.
    karvonen: roundHalfUp(hrRest + (percent / 100) * reserve, 0),
    percentOfMax: roundHalfUp((percent / 100) * hrMax, 0),
  }));

  return {
    ok: true,
    reserve,
    rows,
    measuredPercentOfReserve:
      measuredHr === undefined ? undefined : (100 * (measuredHr - hrRest)) / reserve,
    measuredPercentOfMax: measuredHr === undefined ? undefined : (100 * measuredHr) / hrMax,
  };
}

/* ------------------------------------------------------- interval session */

export type IntervalRest =
  | { readonly kind: "seconds"; readonly seconds: number }
  /** A work:rest ratio, e.g. 1:2 — `work` is the left member, `rest` the right. */
  | { readonly kind: "ratio"; readonly work: number; readonly rest: number };

/**
 * How one repetition's work was specified. `tempo` absorbs the retired „Tempo
 * serije" tool as an input MODE rather than a second implementation: the four
 * phases sum to the repetition's duration, and the rest BETWEEN repetitions is
 * fixed at zero, because the phases already are one whole repetition and there is
 * nothing left over to rest during.
 */
export type IntervalWork =
  | { readonly kind: "seconds"; readonly seconds: number }
  | {
      readonly kind: "tempo";
      /** Eccentric phase, whole seconds. */
      readonly eccentric: number;
      /** Pause at the bottom, whole seconds. */
      readonly pauseBottom: number;
      /** Concentric phase, whole seconds. */
      readonly concentric: number;
      /** Pause at the top, whole seconds. */
      readonly pauseTop: number;
    };

export interface IntervalInput {
  readonly work: IntervalWork;
  /**
   * Rest between repetitions. Required when `work` is `seconds`; ignored when
   * `work` is `tempo`, where the inter-repetition rest is always zero.
   */
  readonly rest?: IntervalRest | undefined;
  /** Repetitions in one set. */
  readonly reps: number;
  /** Number of sets. */
  readonly sets: number;
  /** Rest between sets, seconds. */
  readonly restBetweenSets: number;
  /** Warm-up, seconds. Counted in the session total and in nothing else. */
  readonly warmup: number;
  /** Cool-down, seconds. */
  readonly cooldown: number;
}

export interface IntervalResult {
  /** Rest between repetitions, seconds — resolved, whether typed, given as a ratio, or forced to zero by a tempo. */
  readonly rest: number;
  readonly setDuration: number;
  readonly setDurationClock: string;
  readonly totalWork: number;
  readonly totalWorkClock: string;
  readonly totalRest: number;
  readonly totalRestClock: string;
  readonly total: number;
  readonly totalClock: string;
  /**
   * x in „1:x" for ONE repetition — rest ÷ work. Matches a typed ratio exactly,
   * which `sessionRestRatio` below deliberately does not.
   */
  readonly repRestRatio: number;
  /**
   * x in „1:x" across the WHOLE session — total rest ÷ total work, unrounded. A
   * different quantity from `repRestRatio`: it also carries the rest between
   * sets, so a user who typed a 1:2 ratio and reads „1:2,33" here has not been
   * shown a wrong number, but a different one — which is why both are returned.
   */
  readonly sessionRestRatio: number;
}

/**
 * The shared timeline arithmetic behind both „Intervalni trening" and „Tempo
 * serije": a repetition, a rest that sits BETWEEN repetitions, and a rest that
 * sits between sets. „Tempo serije" is this with the inter-repetition rest fixed
 * at zero and no warm-up or cool-down — which is why the two tools can share one
 * function rather than one of them bending its numbers to fit the other's.
 */
interface TempoTimeline {
  readonly setDuration: number;
  readonly totalWork: number;
  readonly totalRest: number;
  readonly total: number;
}

function tempoTimeline(
  work: number,
  restWithinRep: number,
  reps: number,
  sets: number,
  restBetweenSets: number,
  warmup: number,
  cooldown: number,
): TempoTimeline {
  const setDuration = reps * work + (reps - 1) * restWithinRep;
  const totalWork = sets * reps * work;
  const totalRest = sets * (reps - 1) * restWithinRep + (sets - 1) * restBetweenSets;
  const total = sets * setDuration + (sets - 1) * restBetweenSets + warmup + cooldown;
  return { setDuration, totalWork, totalRest, total };
}

/**
 * How long an interval session takes, and what its real work-to-rest ratio is.
 *
 * **Rest sits BETWEEN repetitions, not after each one**, which is the single most
 * common error in a session plan: `reps × work + (reps − 1) × rest`, so a set of
 * one repetition is exactly the work and nothing else. The same rule applies
 * between sets, so a single set has no trailing rest.
 *
 * **Warm-up and cool-down are not rest.** They are in the session total and out of
 * `totalRest` and out of the ratio — otherwise a ten-minute warm-up would quietly
 * make a hard session look like an easy one.
 *
 * **`work: "tempo"` is „Tempo serije" entered here instead.** Both tools resolve
 * through `tempoTimeline`, so the two can never quietly disagree about the same
 * numbers.
 */
export function intervalSession(input: IntervalInput): ProResult<IntervalResult> {
  const { work, reps, sets, restBetweenSets, warmup, cooldown } = input;
  if (!isPositiveInteger(reps)) return fail("reps");
  if (!isPositiveInteger(sets)) return fail("sets");
  if (!isNonNegative(restBetweenSets)) return fail("restBetweenSets");
  if (!isNonNegative(warmup)) return fail("warmup");
  if (!isNonNegative(cooldown)) return fail("cooldown");

  let workSeconds: number;
  let restSeconds: number;
  if (work.kind === "tempo") {
    const phases: readonly [number, number, number, number] = [
      work.eccentric,
      work.pauseBottom,
      work.concentric,
      work.pauseTop,
    ];
    for (const phase of phases) if (!isNonNegativeInteger(phase)) return fail("tempo");
    workSeconds = phases[0] + phases[1] + phases[2] + phases[3];
    // All four phases at zero is a repetition of no duration, which has nothing
    // to be a rest between.
    if (workSeconds <= 0) return fail("tempo");
    restSeconds = 0;
  } else {
    if (!isPositive(work.seconds)) return fail("work");
    workSeconds = work.seconds;
    const rest = input.rest;
    if (rest === undefined) return fail("rest");
    if (rest.kind === "seconds") {
      if (!isNonNegative(rest.seconds)) return fail("rest");
      restSeconds = rest.seconds;
    } else {
      // A ratio's left member divides, so zero is a division by zero rather than
      // „no rest"; a user who wants no rest types 0 seconds, not 1:0.
      if (!isPositive(rest.work) || !isPositive(rest.rest)) return fail("restRatio");
      restSeconds = (workSeconds * rest.rest) / rest.work;
    }
  }

  const { setDuration, totalWork, totalRest, total } = tempoTimeline(
    workSeconds,
    restSeconds,
    reps,
    sets,
    restBetweenSets,
    warmup,
    cooldown,
  );

  return {
    ok: true,
    rest: restSeconds,
    setDuration,
    setDurationClock: clockMmSs(setDuration),
    totalWork,
    totalWorkClock: clockMmSs(totalWork),
    totalRest,
    totalRestClock: clockMmSs(totalRest),
    total,
    totalClock: clockHMmSs(total),
    // workSeconds and totalWork are both above zero by construction here, so
    // neither division below needs a further guard.
    repRestRatio: restSeconds / workSeconds,
    sessionRestRatio: totalRest / totalWork,
  };
}

/* ------------------------------------------------------------ jump height */

export interface JumpInput {
  /** Flight time, seconds. Absent means „compute it from the height". */
  readonly flightTime?: number | undefined;
  /** Jump height, centimetres. Absent means „compute it from the flight time". */
  readonly height?: number | undefined;
  /** Ground-contact time, seconds. Absent simply omits the RSI. */
  readonly contactTime?: number | undefined;
  /** Local gravitational acceleration, m/s². Defaults to standard gravity. */
  readonly gravity?: number | undefined;
}

export interface JumpResult {
  /** Jump height, cm. */
  readonly height: number;
  /** The same height in metres — what the RSI is defined on. */
  readonly heightM: number;
  readonly flightTime: number;
  /** Velocity at take-off, m/s. */
  readonly takeoff: number;
  /** Reactive strength index, JUMP-HEIGHT definition, m/s. Undefined without a contact time. */
  readonly rsi: number | undefined;
  /**
   * Gravitational acceleration actually used, m/s² — the input if one was given,
   * otherwise the standard 9,80665. A changed g changes every height printed here
   * with no other trace, and 9,80665 is only ever a default in this function, not
   * a guarantee about where the jump happened.
   */
  readonly gravity: number;
}

/**
 * Jump height from flight time and back, plus the reactive strength index.
 *
 * **The flight-time method assumes the flight is symmetric** — the athlete leaves
 * the ground and lands at the same height, so the time splits into t/2 up and t/2
 * down and `h = g(t/2)²/2 = g t²/8`. Tucking the legs on landing lengthens the
 * flight without raising the centre of mass, and the number then describes
 * something other than the jump. The surface prints that condition beside the
 * result, because it is the assumption that makes the answer meaningful.
 *
 * RSI here is height ÷ contact time — the jump-height definition. The flight-time
 * ÷ contact-time variant is a different number with the same three letters, which
 * is why the output names which one it is.
 */
export function jumpHeight(input: JumpInput): ProResult<JumpResult> {
  const { flightTime, height, contactTime } = input;
  const gravity = input.gravity ?? G;
  const given = [flightTime !== undefined, height !== undefined];
  if (given.filter(Boolean).length !== 1) return fail("fields");
  if (!isPositive(gravity)) return fail("gravity");
  if (flightTime !== undefined && !isPositive(flightTime)) return fail("flightTime");
  if (height !== undefined && !isPositive(height)) return fail("height");
  if (contactTime !== undefined && !isPositive(contactTime)) return fail("contactTime");

  const heightM =
    height !== undefined
      ? height / CM_PER_M
      : (gravity * (flightTime ?? 0) * (flightTime ?? 0)) / 8;
  const time = flightTime ?? Math.sqrt((8 * heightM) / gravity);

  return {
    ok: true,
    height: heightM * CM_PER_M,
    heightM,
    flightTime: time,
    takeoff: (gravity * time) / 2,
    rsi: contactTime === undefined ? undefined : heightM / contactTime,
    gravity,
  };
}

/* ----------------------------------------------------------- limb symmetry */

export interface LimbSymmetryInput {
  /** Value on the tested side, in whatever unit was measured. */
  readonly involved: number;
  /** Value on the reference side, in the SAME unit — nothing is converted. */
  readonly reference: number;
  /**
   * The symmetry ratio the user is working to, %.
   *
   * A `regulated`-tier number with no default anywhere in this file. Every
   * published threshold on this ratio is somebody's chosen rule, they disagree
   * with each other, and the number decides whether a person loads a limb — so an
   * embedded default would be this app making a clinical decision. The user types
   * their own, and the output says the number is theirs.
   */
  readonly target: number;
  /**
   * The unit both values were measured in — free text, typed by the user, never
   * validated or converted. Passed straight through so the surface can print it
   * beside every number; this tool holds kilograms, centimetres, newtons and
   * degrees all alike, so a number without its unit is unusable.
   */
  readonly unit?: string | undefined;
}

export interface LimbSymmetry {
  /** 100 × involved/reference, %. */
  readonly ratio: number;
  /** 100 − ratio, %, signed — negative when the tested side is the stronger one. */
  readonly shortfall: number;
  /** What the tested side would read at the entered target, in the input unit. */
  readonly needed: number;
  /** needed − involved, signed, in the input unit. */
  readonly gap: number;
  /** The unit as typed, echoed straight through — data, not copy authored here. */
  readonly unit: string | undefined;
}

/**
 * The two sides as a percentage, and what the tested side would have to reach for
 * a ratio the user chose.
 *
 * **Units are never converted and never checked.** The two values are treated as
 * bare numbers, because the same tool serves kilograms, centimetres, newtons and
 * degrees, and a conversion this tool invented would be wrong for three of them.
 * The output states the condition instead.
 *
 * Nothing here says whether the ratio is acceptable. That judgement needs the
 * test, the tissue, the time since surgery and a clinician; this returns four
 * numbers and no opinion.
 */
export function limbSymmetry(input: LimbSymmetryInput): ProResult<LimbSymmetry> {
  const { involved, reference, target } = input;
  if (!isNonNegative(involved)) return fail("involved");
  if (!isPositive(reference)) return fail("reference");
  if (!isPositive(target)) return fail("target");

  const ratio = (100 * involved) / reference;
  const needed = (reference * target) / 100;
  return { ok: true, ratio, shortfall: 100 - ratio, needed, gap: needed - involved, unit: input.unit };
}

/* --------------------------------------------------------------- one-rep max */

/**
 * Epley's divisor, needed here only for the TABLE's exact-fraction base — the
 * two DISPLAYED estimates below are never computed from this constant directly.
 * They call `estimateOneRepMax` from `@nexus/core/fitness`, the same function
 * every other FIT surface uses, so this tool cannot quietly disagree with them
 * about the same set. That function returns a float, though, and the table's
 * tie-break has to be exact (see the function doc below) — which is the one
 * reason the published formula's own integers (30, and Brzycki's 36⁄37) still
 * appear here, spelled out again as an exact rational rather than trusted to a
 * `Number`. Boyd Epley, „Poundage Chart" (Boyd Epley Workout), Body Enterprises,
 * Lincoln NE, 1985: 1RM = w × (1 + r/30).
 */
const EPLEY_DIVISOR = 30;

/**
 * Brzycki's numerator and denominator base, for the same exact-fraction reason.
 * Matt Brzycki, „Strength Testing — Predicting a One-Rep Max from Reps-to-
 * Fatigue", JOPERD 64(1), 1993: 1RM = w × 36/(37 − r).
 */
const BRZYCKI_NUMERATOR = 36;
const BRZYCKI_BASE = 37;

/**
 * The table's own percentages, held in TENTHS so 77,5 % would be the integer
 * 775. A uniform 5-point ladder from 100 down to 50 — the old 13-row version
 * additionally carried 77,5 % and 72,5 %, which were somebody's programme
 * preference smuggled in as if they were structural; `customPercent` below
 * covers every such preference without embedding any one of them.
 */
const ONE_RM_PERCENT_TENTHS = [1000, 950, 900, 850, 800, 750, 700, 650, 600, 550, 500];

/**
 * Ceiling on `customPercent`, comfortably above any real programme (a back-off
 * set past 1000 % of a 1RM is not a training decision anyone makes). Every
 * other number this function multiplies is already bounded by `MAX_KG`; an
 * unbounded percentage was the one gap, and above this the row's own integer
 * arithmetic (`2 × baseNum × tenths`) is what stops being exact, not merely
 * large — the same failure `MAX_KG` exists to keep out everywhere else.
 */
const MAX_CUSTOM_PERCENT = 1000;

export type OneRmFormula = "epley" | "brzycki";

export interface OneRmInput {
  /** Load of the set, kg. */
  readonly load: number;
  /** Repetitions completed, a whole number 1–10. */
  readonly reps: number;
  /** Which estimator feeds the table. Both are always reported. */
  readonly formula: OneRmFormula;
  /** Rounding step for the loadable column, kg — the smallest pair of plates on hand. */
  readonly step: number;
  /** A measured 1RM. When present the table is built from it and neither formula runs. */
  readonly known1Rm?: number | undefined;
  /**
   * One extra percentage beyond the uniform 5 % ladder — any programme's own
   * preference (77,5 %, a deload's 60 %, anything) without that preference ever
   * being built into the tool. Rounded to the nearest tenth of a percent, the
   * table's own resolution.
   */
  readonly customPercent?: number | undefined;
}

export interface OneRmRow {
  /** 100, 95, 90 … 50 — or the entered `customPercent`. */
  readonly percent: number;
  /** The unrounded load for this percentage, kg. */
  readonly exact: number;
  /** The nearest whole multiple of the step, kg, with an exact half resolved DOWN. */
  readonly loadable: number;
}

export interface OneRmResult {
  /** Epley's estimate, kg, unrounded — from `estimateOneRepMax`, not reimplemented here. */
  readonly epley: number;
  /** Brzycki's estimate, kg, unrounded — likewise. */
  readonly brzycki: number;
  /** The unrounded number the table was built from, kg. */
  readonly base: number;
  readonly rows: readonly OneRmRow[];
}

/**
 * Both published one-rep-max estimates and a percentage table rounded to the
 * plates the lifter owns.
 *
 * **The two displayed estimates are not this tool's own arithmetic.** Both call
 * `estimateOneRepMax` (`@nexus/core/fitness/training`) — the same function every
 * other FIT surface reads a one-rep max from — so the domain refusal above ten
 * repetitions, the reason for it (a 27 % disagreement between the formulas by
 * twenty reps, and Brzycki's denominator reaching zero at thirty-seven), and the
 * override that returns the entered load unchanged at one repetition are all
 * inherited rather than re-derived, and cannot drift from what that function
 * does elsewhere in the app.
 *
 * **The table is exact integer arithmetic, and that is not fussiness.** Epley's
 * 116,666… kg is not representable in hundredths, so a percentage of it can land
 * exactly on a half-step; deciding that half from `estimateOneRepMax`'s floating
 * result would resolve it by rounding noise instead of by the rule. The base is
 * carried here as the fraction `num/den` in hundredths of a kilogram and the
 * step count is `ceil(exact/step − ½)` evaluated in integers, so an exact half
 * always resolves DOWN to the lighter bar — this table is the one place in the
 * tool that still needs the published formula's own integers spelled out.
 */
export function oneRepMaxTable(input: OneRmInput): ProResult<OneRmResult> {
  const { load, reps, formula, step, known1Rm, customPercent } = input;
  if (!isPositive(load) || load > MAX_KG) return fail("load");
  if (!isIntegerIn(reps, 1, ONE_RM_MAX_REPS)) return fail("reps");
  if (!isPositive(step) || step > MAX_KG) return fail("step");
  if (known1Rm !== undefined && (!isPositive(known1Rm) || known1Rm > MAX_KG)) {
    return fail("known1Rm");
  }
  if (
    customPercent !== undefined &&
    (!isPositive(customPercent) || customPercent > MAX_CUSTOM_PERCENT)
  ) {
    return fail("customPercent");
  }

  const loadH = Math.round(load * 100);
  const stepH = Math.round(step * 100);
  if (loadH <= 0) return fail("load");
  if (stepH <= 0) return fail("step");

  const epleyEstimate = estimateOneRepMax(load, reps, "epley");
  const brzyckiEstimate = estimateOneRepMax(load, reps, "brzycki");
  // The guards above mirror exactly what `estimateOneRepMax` itself checks, so
  // this is unreachable in practice — kept as a refusal rather than an assertion
  // because a `null` here is a disagreement about the domain, not a crash.
  if (epleyEstimate === null || brzyckiEstimate === null) return fail("reps");

  let baseNum: number;
  let baseDen: number;
  if (known1Rm !== undefined) {
    baseNum = Math.round(known1Rm * 100);
    baseDen = 1;
    if (baseNum <= 0) return fail("known1Rm");
  } else if (reps === 1) {
    baseNum = loadH;
    baseDen = 1;
  } else if (formula === "epley") {
    baseNum = loadH * (EPLEY_DIVISOR + reps);
    baseDen = EPLEY_DIVISOR;
  } else {
    baseNum = loadH * BRZYCKI_NUMERATOR;
    baseDen = BRZYCKI_BASE - reps;
  }

  const customTenths = customPercent === undefined ? undefined : Math.round(customPercent * 10);
  const percentTenths =
    customTenths === undefined || ONE_RM_PERCENT_TENTHS.includes(customTenths)
      ? ONE_RM_PERCENT_TENTHS
      : [...ONE_RM_PERCENT_TENTHS, customTenths].sort((a, b) => b - a);

  const halfStep = 1000 * baseDen * stepH;
  const rows = percentTenths.map((tenths) => {
    const steps = ceilDiv(2 * baseNum * tenths - halfStep, 2 * halfStep);
    return {
      percent: tenths / 10,
      exact: (baseNum * tenths) / (1000 * baseDen * 100),
      loadable: (steps * stepH) / 100,
    };
  });

  return {
    ok: true,
    epley: epleyEstimate.kg,
    brzycki: brzyckiEstimate.kg,
    base: baseNum / (baseDen * 100),
    rows,
  };
}

/* ------------------------------------------------------------ running pace */

export type DistanceUnit = "m" | "km" | "mile";

export interface DistanceEntry {
  readonly unit: DistanceUnit;
  readonly value: number;
}

export type PaceUnit = "perKm" | "perMile";

export interface PaceEntry {
  readonly unit: PaceUnit;
  /** Seconds per kilometre or per mile, according to `unit`. */
  readonly seconds: number;
}

export interface RunInput {
  /** Absent means „compute the distance". */
  readonly distance?: DistanceEntry | undefined;
  /** Total time in seconds. Absent means „compute the time". */
  readonly time?: number | undefined;
  /** Absent means „compute the pace". */
  readonly pace?: PaceEntry | undefined;
  /** Split table step, metres. */
  readonly splitStep: number;
}

export interface RunSplit {
  /** 1-based row number. */
  readonly index: number;
  /** Cumulative distance, metres — the last row is the whole distance, not a full step. */
  readonly distance: number;
  /** Cumulative time, seconds, unrounded. */
  readonly seconds: number;
  /** The same time as h:mm:ss. */
  readonly clock: string;
}

export interface RunResult {
  /** Distance, metres. */
  readonly distance: number;
  /** Time, seconds. */
  readonly time: number;
  /** Seconds per kilometre. */
  readonly pacePerKm: number;
  /** Seconds per mile. */
  readonly pacePerMile: number;
  /** Seconds per 100 m. */
  readonly pacePer100m: number;
  readonly speedMps: number;
  readonly speedKmh: number;
  readonly splits: readonly RunSplit[];
}

/** Ceiling on split rows, so a step of a millimetre refuses instead of allocating for ever. */
const MAX_SPLIT_ROWS = 2000;

/**
 * Distance, time and pace: give any two and this returns the third, with an even
 * split table.
 *
 * **Every split is computed from the unrounded ratio t/d and formatted only at
 * the end.** Accumulating a rounded per-kilometre pace ten times puts up to five
 * seconds of drift into a marathon table and makes the last row disagree with the
 * time that was typed. Computing `min(kS, d) × t/d` per row makes the final row
 * equal the entered time exactly, by construction.
 *
 * The last row is short whenever the step does not divide the distance — that is
 * the point of it, not a defect: a 1500 m race in 100 m steps ends on 1500, and a
 * marathon in kilometres ends on a 195 m fragment.
 *
 * Exactly one of distance, time and pace must be empty; zero or two empty fields
 * are refused rather than reconciled.
 */
export function runningPace(input: RunInput): ProResult<RunResult> {
  const { distance, time, pace, splitStep } = input;
  const given = [distance !== undefined, time !== undefined, pace !== undefined];
  if (given.filter(Boolean).length !== 2) return fail("fields");
  if (!isPositive(splitStep)) return fail("step");
  if (distance !== undefined && !isPositive(distance.value)) return fail("distance");
  if (time !== undefined && !isPositive(time)) return fail("time");
  if (pace !== undefined && !isPositive(pace.seconds)) return fail("pace");

  const paceMetres = pace === undefined ? 0 : pace.unit === "perKm" ? M_PER_KM : M_PER_MILE;
  // speed = referenceMetres/paceSeconds — the same relation `cadenceStride`
  // reads for its own pace field, through the one shared helper.
  const paceSpeedMps = pace === undefined ? undefined : paceSpeedRelation(pace.seconds, paceMetres);
  const metres =
    distance === undefined
      ? paceSpeedMps === undefined || time === undefined
        ? Number.NaN
        : paceSpeedMps * time
      : distance.unit === "m"
        ? distance.value
        : distance.unit === "km"
          ? distance.value * M_PER_KM
          : distance.value * M_PER_MILE;
  if (!isPositive(metres)) return fail("distance");

  const derivedTime =
    pace === undefined || paceSpeedMps === undefined ? Number.NaN : metres / paceSpeedMps;
  const seconds = time === undefined ? derivedTime : time;
  if (!isPositive(seconds)) return fail("time");

  // `metres` on the derived-distance path is a float PRODUCT
  // (paceSpeedMps × time), which can overshoot the true value by a few ulps —
  // e.g. 10000,000000000002 instead of 10000. Ceiling that straight would push
  // the row count up by a whole extra row before the guard below ever runs,
  // because the guard compares against the SAME inflated `metres`. `ceilSnapped`
  // removes exactly that representation error before the ceiling, without
  // touching any distance that is genuinely a fraction of a step short.
  const ratio = metres / splitStep;
  let rowCount = ceilSnapped(ratio);
  // Belt and braces for the opposite drift direction: a rounded-down ratio
  // that still leaves the last row short of the real distance.
  if (rowCount > 1 && (rowCount - 1) * splitStep >= metres) rowCount -= 1;
  if (!Number.isFinite(rowCount) || rowCount > MAX_SPLIT_ROWS) return fail("tooManyRows");
  rowCount = Math.max(1, rowCount);

  const splits: RunSplit[] = [];
  for (let k = 1; k <= rowCount; k += 1) {
    const covered = Math.min(k * splitStep, metres);
    const cumulative = (covered * seconds) / metres;
    splits.push({
      index: k,
      distance: covered,
      seconds: cumulative,
      clock: clockHMmSs(cumulative),
    });
  }

  const speedMps = metres / seconds;
  return {
    ok: true,
    distance: metres,
    time: seconds,
    pacePerKm: paceSpeedRelation(speedMps, M_PER_KM),
    pacePerMile: paceSpeedRelation(speedMps, M_PER_MILE),
    pacePer100m: paceSpeedRelation(speedMps, 100),
    speedMps,
    speedKmh: KMH_PER_MPS * speedMps,
    splits,
  };
}

/* ------------------------------------------------------------- set tempo */

export interface SetTempoInput {
  /** Eccentric phase, whole seconds. */
  readonly eccentric: number;
  /** Pause at the bottom, whole seconds. */
  readonly pauseBottom: number;
  /** Concentric phase, whole seconds. */
  readonly concentric: number;
  /** Pause at the top, whole seconds. */
  readonly pauseTop: number;
  readonly reps: number;
  readonly sets: number;
  /** Rest between sets, whole seconds. */
  readonly restBetweenSets: number;
}

export interface SetTempoResult {
  /** One repetition, seconds. */
  readonly perRep: number;
  /** Time under tension in one set, seconds. */
  readonly tutPerSet: number;
  readonly tutPerSetClock: string;
  readonly totalTut: number;
  readonly totalTutClock: string;
  /** Sets plus the rest between them, seconds. */
  readonly block: number;
  readonly blockClock: string;
}

/**
 * Time under tension for a four-number tempo, and how long the block takes.
 *
 * **„X" is not accepted as a phase.** A tempo written 3-1-X-0 means „as fast as
 * possible", which is not a duration — and a tool that quietly read it as 0 or 1
 * would report a time under tension the athlete never spent. The user types the
 * number of seconds they actually mean, or the tool has no answer.
 *
 * The rest is BETWEEN sets, so a single set has no trailing rest. `tutPerSet` and
 * `totalTut` grow past sixty minutes rather than becoming hours (a 75-minute set
 * reads 75:00), matching `intervalSession`'s own per-set and total-work fields —
 * but `block` is formatted h:mm:ss, matching `intervalSession`'s session total,
 * because the SAME 4 500 s block reading „75:00" here and „1:15:00" there, in the
 * same pack, is the bug this alignment exists to prevent.
 *
 * The arithmetic itself runs through `tempoTimeline` — the same function
 * `intervalSession` calls for its own `work: "tempo"` mode — so the two tools
 * can never quietly disagree about the same numbers.
 */
export function setTempoTut(input: SetTempoInput): ProResult<SetTempoResult> {
  const { eccentric, pauseBottom, concentric, pauseTop, reps, sets, restBetweenSets } = input;
  const phases: readonly [number, number, number, number] = [
    eccentric,
    pauseBottom,
    concentric,
    pauseTop,
  ];
  for (const phase of phases) if (!isNonNegativeInteger(phase)) return fail("tempo");
  if (!isPositiveInteger(reps)) return fail("reps");
  if (!isPositiveInteger(sets)) return fail("sets");
  if (!isNonNegativeInteger(restBetweenSets)) return fail("restBetweenSets");

  const perRep = eccentric + pauseBottom + concentric + pauseTop;
  // All four phases at zero is a repetition of no duration, which has no time
  // under tension to report.
  if (perRep <= 0) return fail("tempo");

  // No rest within a repetition, no warm-up, no cool-down — the four phases are
  // the whole repetition, and this tool has neither of the other two.
  const { setDuration: tutPerSet, totalWork: totalTut, total: block } = tempoTimeline(
    perRep,
    0,
    reps,
    sets,
    restBetweenSets,
    0,
    0,
  );
  return {
    ok: true,
    perRep,
    tutPerSet,
    tutPerSetClock: clockMmSs(tutPerSet),
    totalTut,
    totalTutClock: clockMmSs(totalTut),
    block,
    blockClock: clockHMmSs(block),
  };
}

/* ------------------------------------------------------- splits & fatigue */

export interface SplitSeriesResult {
  readonly count: number;
  /** Sum of the times, seconds. */
  readonly total: number;
  readonly mean: number;
  /** Middle value of the sorted list, or the mean of the two middle ones. */
  readonly median: number;
  /** Fastest time, seconds. */
  readonly best: number;
  /** Slowest time, seconds. */
  readonly worst: number;
  readonly range: number;
  /**
   * 100 × (worst − best)/best, %: the decline against the BEST time. A second,
   * equally-published definition divides the same numerator by the SLOWEST time
   * instead, which is a different figure that happens to share this one's name.
   */
  readonly fatigueIndex: number;
  /** Sprint decrement, 100 × (total/(n × best) − 1), %. */
  readonly decrement: number;
}

/**
 * The summary of a set of repeated efforts: totals, spread, and the two decline
 * measures.
 *
 * **The decrement and the fatigue index answer different questions.** The fatigue
 * index compares the two extremes and is decided by a single bad rep; the sprint
 * decrement compares the whole set against what holding the best time would have
 * produced, so it moves with every rep. Both are arithmetic on the typed numbers
 * and neither carries a normative band — this tool does not say whether a decline
 * is large.
 *
 * Sorting happens for the median alone. Sum, best and worst do not depend on
 * order, so the returned figures never depend on how the rows were typed.
 */
export function splitSeries(times: readonly number[]): ProResult<SplitSeriesResult> {
  // Fewer than two efforts has no decline to measure — one time is its own best
  // and worst, and the two indices would be a constant zero pretending to be data.
  if (times.length < 2) return fail("times");
  for (const time of times) if (!isPositive(time)) return fail("times");

  const sorted = [...times].sort((a, b) => a - b);
  const count = sorted.length;
  const total = times.reduce((sum, time) => sum + time, 0);
  const middle = Math.floor(count / 2);
  const upper = sorted[middle] ?? 0;
  const lower = sorted[middle - 1] ?? upper;
  const median = count % 2 === 1 ? upper : (lower + upper) / 2;
  const best = sorted[0] ?? 0;
  const worst = sorted[count - 1] ?? 0;

  return {
    ok: true,
    count,
    total,
    mean: total / count,
    median,
    best,
    worst,
    range: worst - best,
    fatigueIndex: (100 * (worst - best)) / best,
    decrement: 100 * (total / (count * best) - 1),
  };
}

/* -------------------------------------------------------------- sweat rate */

export interface SweatInput {
  /** Mass before the session, kg. */
  readonly preMass: number;
  /** Mass after the session, kg. */
  readonly postMass: number;
  /** Fluid drunk during the session, mL. */
  readonly drunk: number;
  /**
   * Food and gels eaten during the session, g. Enters the balance exactly like
   * fluid drunk — anything swallowed as mass is mass gained the same way, and a
   * session with a fuelled athlete is wrong by every gram of it without this.
   */
  readonly food: number;
  /** Urine and any other measured loss, mL. */
  readonly urine: number;
  /** Session duration, minutes. */
  readonly duration: number;
  /** Share of the loss the user plans to replace, %. */
  readonly replacementPercent: number;
}

export interface SweatResult {
  /** pre − post, kg, signed. */
  readonly massLost: number;
  /** 100 × massLost/pre, %. */
  readonly percentBodyMass: number;
  /**
   * Sweat loss over the session, in GRAMS — what the scale actually measured,
   * independent of any density convention.
   */
  readonly sweatGrams: number;
  /**
   * The same figure in millilitres, under the 1 g = 1 mL convention this method
   * uses. Real water at 37 °C is 0,993 g/mL, so this column is a convention and
   * `sweatGrams` above is the measurement.
   */
  readonly sweatMl: number;
  /** mL per hour. */
  readonly ratePerHour: number;
  /** The same rate in litres per hour. */
  readonly litresPerHour: number;
  /** The rate scaled by the entered replacement percentage, mL per hour. */
  readonly replacementPerHour: number;
}

/**
 * Sweat loss and sweat rate from the mass balance over a session.
 *
 * The balance is `Δmass = drunk + food − sweat − urine`, which rearranges to
 * `sweat = massLost × 1000 + drunk + food − urine` with one gram of mass change
 * counted as one millilitre of body water. That 1 g/mL is the method's own
 * convention rather than a physical constant of sweat, so `sweatGrams` — the
 * scale's own reading — is the figure this function leads with, and `sweatMl` is
 * the same number relabelled under the convention.
 *
 * A negative sweat figure is reported as computed. It means more was taken in
 * than the mass change allows, which is a mistyped mass far more often than it
 * is physiology, and clamping it to zero would hide exactly that.
 *
 * The tool says nothing about how much to drink and nothing about hydration
 * status; it reports the loss that was measured.
 */
export function sweatRate(input: SweatInput): ProResult<SweatResult> {
  const { preMass, postMass, drunk, food, urine, duration, replacementPercent } = input;
  if (!isPositive(preMass)) return fail("preMass");
  if (!isPositive(postMass)) return fail("postMass");
  if (!isNonNegative(drunk)) return fail("drunk");
  if (!isNonNegative(food)) return fail("food");
  if (!isNonNegative(urine)) return fail("urine");
  if (!isPositive(duration)) return fail("duration");
  if (!isPositive(replacementPercent)) return fail("replacementPercent");

  const massLost = preMass - postMass;
  const sweatGrams = massLost * 1000 + drunk + food - urine;
  const ratePerHour = (SEC_PER_MIN * sweatGrams) / duration;
  return {
    ok: true,
    massLost,
    percentBodyMass: (100 * massLost) / preMass,
    sweatGrams,
    sweatMl: sweatGrams,
    ratePerHour,
    litresPerHour: ratePerHour / 1000,
    replacementPerHour: (ratePerHour * replacementPercent) / 100,
  };
}

/* ---------------------------------------------------------- volume & load */

export interface VolumeRow {
  readonly sets: number;
  /** Repetitions per set, not for the whole row. */
  readonly reps: number;
  /** Load, kg. Zero is allowed — an empty bar is a real prescription. */
  readonly load: number;
  /**
   * THIS ROW's own one-rep max, kg. Absent omits this row's intensity.
   *
   * Deliberately per row and not once for the whole program: a row has no
   * exercise identity, so a single top-level 1RM would apply a squat maximum to
   * a bench row the moment a program mixed lifts — the exact error this field
   * exists to make impossible. Rows count toward one grouped average ONLY when
   * their entered maxima are exactly equal.
   */
  readonly oneRm?: number | undefined;
}

export interface VolumeRowResult {
  /** sets × reps for this row. */
  readonly reps: number;
  /** reps × load for this row, kg. */
  readonly tonnage: number;
  /** 100 × this row's own mean load/this row's own 1RM, %. Undefined without a row 1RM. */
  readonly intensity: number | undefined;
}

export interface VolumeInput {
  readonly rows: readonly VolumeRow[];
}

/** One group of rows that share exactly the same entered 1RM, with its own tonnage-weighted mean. */
export interface VolumeIntensityGroup {
  readonly oneRm: number;
  /** 100 × the GROUP's tonnage-weighted mean load/oneRm, %. */
  readonly meanIntensity: number;
}

export interface VolumeResult {
  readonly rows: readonly VolumeRowResult[];
  readonly totalSets: number;
  readonly totalReps: number;
  /** Total tonnage, kg. */
  readonly tonnage: number;
  /** Tonnage-weighted mean load, kg, across every row regardless of 1RM. Undefined when there are no repetitions. */
  readonly meanLoad: number | undefined;
  /** One entry per distinct 1RM actually entered, in the order it first appeared. Empty when no row carries one. */
  readonly intensityGroups: readonly VolumeIntensityGroup[];
}

/**
 * Repetitions, tonnage and mean intensity for a written program.
 *
 * **Nothing is weighted, scaled or discounted.** `meanLoad` is tonnage over
 * repetitions — the tonnage-weighted mean, which is exactly what a coach
 * reproduces on paper. No effort model, no fatigue adjustment, no verdict on
 * whether the program is any good; those are choices a coach makes and this tool
 * must not smuggle in.
 *
 * Every intensity figure is computed from the UNROUNDED mean load, so none of
 * them disagree with what a reader gets by dividing the two displayed numbers by
 * more than the display's own last digit.
 *
 * **An empty program refuses rather than answering `0`.** A sum over zero rows
 * IS legitimately zero, but "0,0 kg tonnage" is what this would print for a
 * program that was never entered, not for one that was entered and came to
 * nothing — the same distinction `fail` exists to preserve everywhere else in
 * this pack.
 */
export function trainingVolumeLoad(input: VolumeInput): ProResult<VolumeResult> {
  const { rows } = input;
  if (rows.length === 0) return fail("rows");

  const computed: VolumeRowResult[] = [];
  let totalSets = 0;
  let totalReps = 0;
  let tonnage = 0;
  // Keyed by the exact 1RM value typed — two rows share a mean only because the
  // NUMBER they were given agrees, never because this function guesses they are
  // the same lift.
  const groups = new Map<number, { tonnage: number; reps: number }>();
  for (const row of rows) {
    if (!isPositiveInteger(row.sets)) return fail("rows");
    if (!isPositiveInteger(row.reps)) return fail("rows");
    if (!isNonNegative(row.load)) return fail("rows");
    if (row.oneRm !== undefined && !isPositive(row.oneRm)) return fail("rows");

    const reps = row.sets * row.reps;
    const rowTonnage = reps * row.load;
    const rowMeanLoad = rowTonnage / reps;
    computed.push({
      reps,
      tonnage: rowTonnage,
      intensity: row.oneRm === undefined ? undefined : (100 * rowMeanLoad) / row.oneRm,
    });
    totalSets += row.sets;
    totalReps += reps;
    tonnage += rowTonnage;

    if (row.oneRm !== undefined) {
      const bucket = groups.get(row.oneRm) ?? { tonnage: 0, reps: 0 };
      bucket.tonnage += rowTonnage;
      bucket.reps += reps;
      groups.set(row.oneRm, bucket);
    }
  }

  // With no rows there are no repetitions, and a mean over nothing is not zero —
  // it does not exist. The sums are still the honest answer.
  const meanLoad = totalReps === 0 ? undefined : tonnage / totalReps;
  const intensityGroups: VolumeIntensityGroup[] = [...groups.entries()].map(([oneRm, bucket]) => ({
    oneRm,
    meanIntensity: (100 * (bucket.tonnage / bucket.reps)) / oneRm,
  }));

  return { ok: true, rows: computed, totalSets, totalReps, tonnage, meanLoad, intensityGroups };
}

/* ------------------------------------------------------------ weight class */

export interface WeightCutInput {
  /** Current body mass, kg. */
  readonly mass: number;
  /**
   * The category limit, kg.
   *
   * A `regulated`-tier number with no default: the competing federation owns its
   * own categories and changes them, they differ by sport, by age group and by
   * year, and being wrong about one is a disqualification. The user copies the
   * number out of the competition rules and the output says the number is theirs.
   */
  readonly limit: number;
  /** Whole days until the weigh-in. Zero is allowed and shows no rate. */
  readonly days: number;
}

export interface WeightCut {
  /** mass − limit, kg, signed — negative means the athlete is under the limit. */
  readonly difference: number;
  /** 100 × difference/mass, %, signed — of the CURRENT mass, not of the limit. */
  readonly percentOfMass: number;
  /** difference/days, kg. Undefined when the athlete is at or under the limit, or days is 0. */
  readonly perDay: number | undefined;
  /** 7 × difference/days, kg. Undefined on the same conditions. */
  readonly perWeek: number | undefined;
  /**
   * Whole days until the weigh-in, echoed straight from the input. `perDay`
   * means nothing without it sitting beside it — shifting this by a single day
   * changes every printed daily figure with no other trace, and the weigh-in day
   * itself is not one of the days the difference is divided across.
   */
  readonly days: number;
  /**
   * Whether `perWeek` reaches PAST the entered horizon — true whenever fewer
   * than seven days remain. A weekly rate over three days is a rate that will
   * never actually happen; this flag is what lets the surface say so rather than
   * print it as if it were ordinary. Undefined whenever there is no rate to
   * reach past anything (see `perDay`/`perWeek`).
   */
  readonly perWeekExtrapolated: boolean | undefined;
}

/**
 * How far the athlete is from a limit they typed, and what that difference works
 * out to per day.
 *
 * **`perDay` is a division, not a plan.** It is what the difference becomes if it
 * is spread evenly, and the surface says exactly that. This tool recommends no
 * rate, no method and no schedule, and it does not claim any figure is safe — a
 * weight cut is a medical question and the tool is a subtraction.
 *
 * At or under the limit there is no rate at all, only the margin: dividing a
 * negative difference across days would print a „rate" for something nobody is
 * doing. With zero days there is likewise nothing to divide by, and the tool
 * returns the difference alone rather than an infinity.
 */
export function weightClassCut(input: WeightCutInput): ProResult<WeightCut> {
  const { mass, limit, days } = input;
  if (!isPositive(mass)) return fail("mass");
  if (!isPositive(limit)) return fail("limit");
  if (!isNonNegativeInteger(days)) return fail("days");

  const difference = mass - limit;
  const spread = difference > 0 && days > 0;
  return {
    ok: true,
    difference,
    percentOfMass: (100 * difference) / mass,
    perDay: spread ? difference / days : undefined,
    perWeek: spread ? (DAYS_PER_WEEK * difference) / days : undefined,
    days,
    perWeekExtrapolated: spread ? days < DAYS_PER_WEEK : undefined,
  };
}
