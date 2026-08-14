/**
 * „Kuhinja i pekara" — the arithmetic behind the toolkit's tools.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` explains:
 * a maintainer asks „where does the baker's percentage live", and
 * `pro/kuhinja.ts` answers it where `pro/materials.ts` would not. A tool several
 * packs share lives in the file of its owning pack, so nobody relitigates
 * ownership per tool.
 *
 * **These are pure functions and they refuse rather than repair.** No clock, no
 * locale, no I/O, no randomness: the „backwards timeline" tool takes the service
 * instant as a string and the „−1 dan" marker falls out of floored division, not
 * out of a `Date`. Everything time-shaped is arithmetic on minutes, which is why
 * every vector below can be checked by hand.
 *
 * **Two tools here compute quantities that a rule could be written about, and
 * neither one is allowed to have an opinion.** `brineSalt` (food-safety) and
 * `solutionConcentration` (life-safety) return masses and percentages, and where
 * the user types a figure of their own, the answer carries `ratioAgainst` and
 * nothing else — no boolean, no status, no severity. A salt percentage is a fact
 * about two masses; whether it preserves anything is a question about a process,
 * a temperature and a time this app has never seen. The same discipline applies
 * to `nutritionPerPortion`: the reference intakes are a rule-maker's numbers and
 * are typed in per nutrient, never embedded.
 *
 * Every constant embedded below is either an SI definition, an exact
 * definitional relation, or the geometry of an operation (a letter fold triples
 * the layers because that is what folding in three does). Nothing here is a
 * measured, tuned or published-and-revisable figure except the four unit
 * definitions cited above their table.
 */

import {
  ceilSnapped,
  fail,
  floorSnapped,
  isInRange,
  isIntegerIn,
  isKeyOf,
  isNonNegative,
  isPositive,
  ratioAgainst,
  roundHalfUp,
  type ProResult,
} from "./result.js";

/** Minutes in an hour and in a day — the arithmetic of the civil clock. */
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 1440;

/** SI prefix: 1 kg = 1000 g, 1 l = 1000 ml, 1 mm = 1000 micrometres. */
const PER_KILO = 1000;

/** The thermochemical calorie is defined as exactly 4.184 joules. */
const KJ_PER_KCAL = 4.184;

/** Freezing point of water at 101.325 kPa, in °C — the Celsius scale's definition. */
const WATER_FREEZING_C = 0;

/** Temperatures a kitchen can measure, in °C. Both ends are this tool's, never a rule's. */
const TEMP_MIN_C = -10;
const TEMP_MAX_C = 60;

/**
 * Round to a multiple of `step`, in multiples rather than by remainder.
 *
 * `value - (value % step)` inherits the binary remainder of a 0.1-style step and
 * drifts a whole step every few hundred lines; counting multiples and
 * multiplying back does not.
 */
function roundToStep(value: number, step: number): number {
  return roundHalfUp(roundHalfUp(value / step, 0) * step, 6);
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * Largest-remainder (Hare) apportionment of pre-computed exact `weights` onto
 * whole multiples of `step`, summing to exactly `targetSteps * step`.
 *
 * **The caller decides `targetSteps`, and that choice is not a detail.** A
 * column that must reproduce a DISPLAYED rounded total (bakers' percentage,
 * recipe scaling) wants `targetSteps = round(total/step)`; a column that
 * reports a genuinely discrete quantity with a leftover that may not divide
 * evenly (ratio split) wants `targetSteps = floor(total/step)` and its own
 * unallocated remainder printed alongside. Baking the wrong one in here would
 * make one of the two callers wrong, so it is not this function's decision.
 *
 * A weight of zero is never bumped: a ratio member typed as `0`, or an
 * ingredient line of zero quantity, stays exactly zero rather than winning a
 * coin toss on ties.
 */
function largestRemainderSteps(
  weights: readonly number[],
  targetSteps: number,
  step: number,
): readonly number[] {
  const scaled = weights.map((weight) => {
    const quotient = weight / step;
    const whole = floorSnapped(quotient);
    return { whole, fraction: quotient - whole };
  });
  const flooredSum = scaled.reduce((sum, entry) => sum + entry.whole, 0);
  // `targetSteps` is always at least `flooredSum` here: each entry's own floor
  // is at most its exact share, so their sum is at most the exact total over
  // the step, and `targetSteps` (floor or round of that same total) is never
  // below that sum's own floor.
  const residue = targetSteps - flooredSum;
  const eligible = scaled
    .map((entry, index) => ({ index, fraction: entry.fraction, weight: weights[index] ?? 0 }))
    .filter((entry) => entry.weight > 0)
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  const bumped = new Set(eligible.slice(0, Math.max(0, residue)).map((entry) => entry.index));
  return scaled.map((entry, index) => (entry.whole + (bumped.has(index) ? 1 : 0)) * step);
}

/**
 * `portions = floor(usable / portion)` and the leftover that floor leaves
 * behind — the one engine „Porcije iz pakovanja" and „Randman i kalo" both
 * need, per the review that found them computing the same shape twice. Two
 * tools sharing this cannot round or floor differently by accident.
 */
function usablePortions(
  usable: number,
  portion: number,
): { readonly portions: number; readonly leftover: number } {
  const portions = floorSnapped(usable / portion);
  return { portions, leftover: usable - portions * portion };
}

/* -------------------------------------------------------------------------- */
/* backwards-timeline                                                          */
/* -------------------------------------------------------------------------- */

/** Days from 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's algorithm). */
function daysFromCivil(year: number, month: number, day: number): number {
  const shifted = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** The inverse of `daysFromCivil`, so a day count can become a date again. */
function civilFromDays(days: number): CivilDate {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  return { year: year + (month <= 2 ? 1 : 0), month, day };
}

function isoFromDays(days: number): string {
  const civil = civilFromDays(days);
  const year = `${civil.year}`.padStart(4, "0");
  return `${year}-${pad2(civil.month)}-${pad2(civil.day)}`;
}

/** "HH:MM" or "H:MM" on a 24-hour clock, as minutes since midnight. */
function parseClock(text: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (match === null) return undefined;
  const [, hours, minutes] = match;
  if (hours === undefined || minutes === undefined) return undefined;
  const h = Number(hours);
  const m = Number(minutes);
  if (h > 23 || m > 59) return undefined;
  return h * MINUTES_PER_HOUR + m;
}

/** "YYYY-MM-DD" as a day count, validated by round-tripping it through the calendar. */
function parseIsoDate(text: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return undefined;
  const [, yearText, monthText, dayText] = match;
  if (yearText === undefined || monthText === undefined || dayText === undefined) return undefined;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const days = daysFromCivil(year, month, day);
  const back = civilFromDays(days);
  return back.year === year && back.month === month && back.day === day ? days : undefined;
}

export interface TimelineStep {
  readonly name: string;
  /**
   * As typed: a bare number ("12") is minutes, a colon reading ("12:00") is
   * H:MM. The two disagree by a factor of 60, so the notation is load-bearing
   * and is parsed by `parseStepDuration` rather than guessed.
   */
  readonly duration: string;
}

export interface BackwardsTimelineInput {
  /** Wall-clock time of service, "HH:MM" on a 24-hour clock. */
  readonly serviceTime: string;
  /** "YYYY-MM-DD". Absent means the day marker stays a count of days, never today's date. */
  readonly serviceDate?: string | undefined;
  /** Steps in EXECUTION order: the last one ends at service, minus the buffer. */
  readonly steps: readonly TimelineStep[];
  /**
   * Slack the user wants between the last step and service, in whole minutes.
   * Present means the user typed a number — even `0` — and gets its OWN row
   * from service − buffer to service; absent means there is no buffer row at
   * all, and the last step ends exactly at service.
   */
  readonly buffer?: number | undefined;
}

/**
 * „12" is twelve minutes; „12:00" is twelve hours. The two readings of the
 * same digits differ by a factor of 60, so the rule is the colon and nothing
 * softer: its presence selects H:MM, its absence selects bare minutes.
 *
 * A fractional minute count („12.5") is accepted and rounded to the nearest
 * whole minute before it ever reaches the sum — durations are rounded at
 * input, never the offsets built from them, which is what keeps the printed
 * total equal to the sum of the printed steps.
 */
function parseStepDuration(text: string): number | undefined {
  const trimmed = text.trim();
  const clock = /^(\d{1,3}):(\d{2})$/.exec(trimmed);
  if (clock !== null) {
    const [, hours, minutes] = clock;
    if (hours === undefined || minutes === undefined) return undefined;
    const m = Number(minutes);
    if (m > 59) return undefined;
    return Number(hours) * MINUTES_PER_HOUR + m;
  }
  const plain = trimmed.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(plain)) return undefined;
  return roundHalfUp(Number(plain), 0);
}

export interface TimelineMoment {
  /** Minutes since midnight OF THE DAY THIS MOMENT FALLS ON, 0..1439. */
  readonly minuteOfDay: number;
  /** "HH:MM", zero-padded. A 24-hour clock has no language, so this is not copy. */
  readonly clock: string;
  /** 0 on the day of service, −1 the day before, and so on. Floored, never truncated. */
  readonly dayOffset: number;
  /** "YYYY-MM-DD" when a service date was given, otherwise undefined. */
  readonly date: string | undefined;
}

export interface TimelineRow {
  readonly kind: "step" | "buffer";
  /** The step's own name, as typed. Empty for the buffer row, which the surface names. */
  readonly name: string;
  /** The duration this row was built from, in minutes — echoed back as parsed. */
  readonly minutes: number;
  readonly start: TimelineMoment;
  readonly end: TimelineMoment;
}

export interface BackwardsTimeline {
  /** Every step IN ORDER, followed by the buffer row when one was given. */
  readonly rows: readonly TimelineRow[];
  /** When the whole job starts — the start of the first step. */
  readonly start: TimelineMoment;
  /** Buffer plus every step, in minutes. */
  readonly totalMinutes: number;
  /** The same total as "H:MM", hours unbounded: a 30-hour lead time prints "30:00". */
  readonly totalLabel: string;
}

function momentAt(
  serviceMinute: number,
  offset: number,
  serviceDay: number | undefined,
): TimelineMoment {
  const absolute = serviceMinute + offset;
  // Floored division, not truncated, and this is the whole trick of the tool:
  // `-205 / 1440` truncates to 0 and would print the previous evening as if it
  // were today, which is the one mistake that costs a service.
  const dayOffset = Math.floor(absolute / MINUTES_PER_DAY);
  const minuteOfDay = absolute - dayOffset * MINUTES_PER_DAY;
  return {
    minuteOfDay,
    clock: `${pad2(Math.floor(minuteOfDay / MINUTES_PER_HOUR))}:${pad2(
      minuteOfDay % MINUTES_PER_HOUR,
    )}`,
    dayOffset,
    date: serviceDay === undefined ? undefined : isoFromDays(serviceDay + dayOffset),
  };
}

/**
 * Every preparation step placed backwards from the moment of service.
 *
 * **Wall time only.** No time zone and no daylight-saving rule is embedded: a
 * step that spans a clock change is not adjusted, because adjusting it would
 * need a zone database the app does not carry and a claim about where the
 * kitchen is. The surface says so beneath the table.
 *
 * Durations are whole minutes on purpose — the output is a wall clock, and a
 * fractional minute would print an hour that does not exist.
 */
export function backwardsTimeline(
  input: BackwardsTimelineInput,
): ProResult<BackwardsTimeline> {
  const service = parseClock(input.serviceTime);
  if (service === undefined) return fail("serviceTime");
  let serviceDay: number | undefined;
  if (input.serviceDate !== undefined) {
    serviceDay = parseIsoDate(input.serviceDate);
    if (serviceDay === undefined) return fail("serviceDate");
  }
  if (input.steps.length === 0) return fail("steps");
  // Present means the user typed a number, even 0 — a deliberate „no slack" is
  // not the same statement as never having asked the question.
  const buffer = input.buffer;
  if (buffer !== undefined && (!Number.isInteger(buffer) || buffer < 0)) return fail("buffer");

  const minutes: number[] = [];
  for (const [index, step] of input.steps.entries()) {
    const parsed = parseStepDuration(step.duration);
    if (parsed === undefined || parsed < 0) return fail(`stepDuration:${index}`);
    minutes.push(parsed);
  }

  const rows: TimelineRow[] = [];
  // With a buffer, the last STEP ends short of service by exactly the buffer —
  // the buffer is what fills the gap up to service, and gets its own row doing
  // it, rather than being an unexplained silence between 11:45 and 12:00.
  let endOffset = buffer === undefined ? 0 : -buffer;
  if (buffer !== undefined) {
    rows.push({
      kind: "buffer",
      name: "",
      minutes: buffer,
      start: momentAt(service, -buffer, serviceDay),
      end: momentAt(service, 0, serviceDay),
    });
  }
  for (let index = input.steps.length - 1; index >= 0; index -= 1) {
    const step = input.steps[index];
    const stepMinutes = minutes[index];
    if (step === undefined || stepMinutes === undefined) continue;
    const startOffset = endOffset - stepMinutes;
    rows.unshift({
      kind: "step",
      name: step.name,
      minutes: stepMinutes,
      start: momentAt(service, startOffset, serviceDay),
      end: momentAt(service, endOffset, serviceDay),
    });
    endOffset = startOffset;
  }
  const totalMinutes = -endOffset;
  return {
    ok: true,
    rows,
    start: momentAt(service, endOffset, serviceDay),
    totalMinutes,
    totalLabel: `${Math.floor(totalMinutes / MINUTES_PER_HOUR)}:${pad2(
      totalMinutes % MINUTES_PER_HOUR,
    )}`,
  };
}

/* -------------------------------------------------------------------------- */
/* bakers-percentage                                                           */
/* -------------------------------------------------------------------------- */

/** How far a flour-role percentage sum may miss 100 before mode 2 refuses it — float slack only. */
const FLOUR_PERCENT_TOLERANCE = 1e-6;

/** The display step every mass in this pack rounds to, g — 2 decimal places. */
const WEIGHT_STEP_G = 0.01;

/**
 * What a line IS, chosen by the user per line. The tool never infers it from a
 * name. `preferment` exists only to be REFUSED on sight (see
 * `bakersPercentage`) — it names the one shape a line can honestly have that
 * none of the other three roles describes, without pretending the tool knows
 * how to split it.
 */
export type BakersRole = "flour" | "water" | "other" | "preferment";

export type BakersMode = "weightsToPercent" | "percentToWeights";

export interface BakersLine {
  readonly name: string;
  readonly role: BakersRole;
  /** Grams in `weightsToPercent`, percent of the flour in `percentToWeights`. */
  readonly value: number;
}

export interface BakersInput {
  readonly mode: BakersMode;
  readonly lines: readonly BakersLine[];
  /** Target dough mass, g — `percentToWeights` only, and not needed when pieces are given. */
  readonly doughMass?: number | undefined;
  /** Number of pieces; with the baked piece mass and the bake loss it replaces `doughMass`. */
  readonly pieces?: number | undefined;
  readonly bakedPieceMass?: number | undefined;
  /** Bake loss in %, 0 <= L < 100, measured by the baker on their own oven. */
  readonly bakeLoss?: number | undefined;
}

export interface BakersRow {
  readonly name: string;
  readonly role: BakersRole;
  /** Baker's percentage: this line over the flour total. */
  readonly percent: number;
  /** Exact weight in g. */
  readonly weight: number;
  /**
   * The weight as printed — 2 decimals, by largest-remainder apportionment so
   * the column sums exactly to the displayed dough mass. The same distributor
   * `ratioSplit` and `recipeScale` use, per the review that found this pack
   * printing three different „who gets the leftover cent" rules for what is
   * one rounding problem.
   */
  readonly weightRounded: number;
}

export interface BakersFormula {
  readonly rows: readonly BakersRow[];
  readonly totalPercent: number;
  readonly flourWeight: number;
  readonly doughMass: number;
  /** Water-role lines over flour-role lines, in %. ONLY the lines the user marked as water. */
  readonly hydration: number;
  /** Raw (unbaked) mass of one piece, g — present only in the pieces mode. */
  readonly rawPieceMass: number | undefined;
}

/**
 * A formula in baker's percentages, either direction, with the flour as 100%.
 *
 * **Roles are the user's, per line, always.** Inferring „mleko" or „jaja" as
 * water is the one thing that would make the hydration figure a lie, and it is
 * the figure a baker acts on. Several flour lines are allowed and are summed;
 * that sum is the 100%.
 *
 * **A preferment or starter line is refused rather than mis-split.** Its own
 * mass is part flour and part water, and neither `flour` nor `water` nor
 * `other` describes it honestly — marking it `flour` overstates F and marking
 * it `water` inflates the hydration by exactly the flour the starter is
 * carrying. `role: "preferment"` exists in the type for exactly one purpose:
 * to be caught here and refused, rather than leaving a starter with nowhere
 * honest to go except a role that quietly mis-splits it. Split the starter into
 * its own flour and water first with `levainSplit` (or the „Hidratacija i
 * starter" tool this pack ships for exactly that), then enter the two results
 * as ordinary `flour`/`water` lines here — which is also why this function
 * never calls `levainSplit` itself: once a line is `flour` or `water`, there is
 * nothing left to split.
 *
 * **Mode 2 REFUSES rather than normalizes a flour-role sum that is not
 * exactly 100.** `F = D/(Σp/100)` is the dough's flour mass only under that
 * convention; two flour lines typed as 70% and 40% are not „140% flour", they
 * are a formula somebody mistyped, and silently accepting them would print a
 * confidently wrong flour weight and a wrong hydration for every line after it.
 *
 * The rounded column is computed here rather than in the surface, by the same
 * largest-remainder distributor `ratioSplit` uses: 2-decimal weights that each
 * round independently do not add up to the dough mass printed above them, and
 * a baker reading a column that does not sum stops trusting the tool.
 */
export function bakersPercentage(input: BakersInput): ProResult<BakersFormula> {
  const { lines, mode } = input;
  if (lines.length === 0) return fail("lines");
  for (const line of lines) {
    if (!isNonNegative(line.value)) return fail("lineValue");
  }
  // A preferment is neither flour nor water nor "other" — see the note above —
  // so it is refused here rather than silently counted as whichever of the
  // three it least resembles.
  if (lines.some((line) => line.role === "preferment")) return fail("preferment");
  const sumOfRole = (role: BakersRole): number =>
    lines.reduce((sum, line) => (line.role === role ? sum + line.value : sum), 0);
  // In mode 1 this is a mass, in mode 2 a percentage; either way it is the
  // denominator every percentage in the formula is expressed against.
  const flourBasis = sumOfRole("flour");
  if (!isPositive(flourBasis)) return fail("flour");
  const hydration = (sumOfRole("water") / flourBasis) * 100;

  let doughMass: number;
  let flourWeight: number;
  let totalPercent: number;
  let rawPieceMass: number | undefined;

  if (mode === "weightsToPercent") {
    doughMass = lines.reduce((sum, line) => sum + line.value, 0);
    flourWeight = flourBasis;
    totalPercent = (doughMass / flourBasis) * 100;
  } else {
    if (input.pieces !== undefined) {
      if (!isIntegerIn(input.pieces, 1, 1000000)) return fail("pieces");
      const baked = input.bakedPieceMass;
      if (baked === undefined || !isPositive(baked)) return fail("bakedPieceMass");
      const loss = input.bakeLoss;
      // L = 100 makes the raw mass infinite and L > 100 makes it negative; both
      // are refused rather than clamped, because the baker measured something
      // that cannot be a bake loss.
      if (loss === undefined || !isNonNegative(loss) || loss >= 100) return fail("bakeLoss");
      rawPieceMass = baked / (1 - loss / 100);
      doughMass = input.pieces * rawPieceMass;
    } else {
      const target = input.doughMass;
      if (target === undefined || !isPositive(target)) return fail("doughMass");
      doughMass = target;
    }
    // F = D/(Σp/100) is the flour mass only under the convention that the
    // flour-role lines themselves sum to 100 — two flour lines mistyped as
    // 70% and 40% are a formula error, not „140% flour", and dividing through
    // them anyway would print a confidently wrong weight on every line.
    if (Math.abs(flourBasis - 100) > FLOUR_PERCENT_TOLERANCE) return fail("flourPercentSum");
    totalPercent = lines.reduce((sum, line) => sum + line.value, 0);
    flourWeight = doughMass / (totalPercent / 100);
  }

  const weights = lines.map((line) =>
    mode === "weightsToPercent" ? line.value : (flourWeight * line.value) / 100,
  );
  const percents = lines.map((line) =>
    mode === "weightsToPercent" ? (line.value / flourBasis) * 100 : line.value,
  );
  const roundedWeights = largestRemainderSteps(
    weights,
    roundHalfUp(doughMass / WEIGHT_STEP_G, 0),
    WEIGHT_STEP_G,
  );

  const rows: BakersRow[] = lines.map((line, index) => ({
    name: line.name,
    role: line.role,
    percent: percents[index] ?? 0,
    weight: weights[index] ?? 0,
    weightRounded: roundedWeights[index] ?? 0,
  }));

  return { ok: true, rows, totalPercent, flourWeight, doughMass, hydration, rawPieceMass };
}

/* -------------------------------------------------------------------------- */
/* brine-salt — FOOD SAFETY: quantities only, never a verdict                   */
/* -------------------------------------------------------------------------- */

export type BrineMode = "brine" | "dryCure" | "concentration";

/**
 * Which denominator the typed percentage means. Both conventions are in use in
 * recipes and they differ by about 2.6% of the salt mass at 2.5%, which is why
 * the answer always prints the brine on both.
 */
export type BrineBasis = "foodAndWater" | "totalWithSalt";

export interface BrineInput {
  readonly mode: BrineMode;
  /** Meat or vegetables, g. Not used in `concentration`. */
  readonly foodMass?: number | undefined;
  /** Water as a MASS, g — a volume would need a density that moves with temperature. */
  readonly waterMass?: number | undefined;
  /** The percentage the user's own recipe asks for, 0 < p < 100. Never preset. */
  readonly saltPercent?: number | undefined;
  readonly basis: BrineBasis;
  /** Salt already dissolved in an existing brine, g — `concentration` only. */
  readonly dissolvedSalt?: number | undefined;
  /** Sugar on the same basis; computed independently of the salt. */
  readonly sugarPercent?: number | undefined;
  /**
   * A figure of the user's own to sit beside the computed one. No default and no
   * embedded maximum: what counts as a limit here depends on a process and a
   * rule this app has never seen.
   */
  readonly percentLimit?: number | undefined;
}

export interface BrineResult {
  /** Salt to weigh out, g. In `concentration` mode it is the salt already in the brine. */
  readonly saltMass: number;
  readonly sugarMass: number | undefined;
  /** Everything that ends up on the scale: food + water + salt + sugar. */
  readonly totalMass: number;
  /** Salt over the food and water alone, %. */
  readonly percentOfBase: number;
  /**
   * Salt over EVERYTHING that ends up on the scale — food, water, salt and, if
   * typed, sugar too (`saltMass / totalMass`). Not food+water+salt alone: on
   * the total-including-salt basis this is the figure the equation above was
   * solved to reproduce exactly, and leaving sugar out of the denominator here
   * while it was in the denominator that built `saltMass` would make this
   * field disagree with the mass the tool actually calls for.
   */
  readonly percentOfTotal: number;
  /**
   * The percentage on the basis the user selected, over the figure they typed.
   * A ratio and nothing else — no word about what the ratio means.
   */
  readonly percentRatio: number | undefined;
}

/**
 * Salt (and optionally sugar) for a brine, a dry cure, or the concentration of a
 * brine that already exists.
 *
 * **Both bases, always.** `S = (M + W) * p/100` and `S = (M + W) * p/(100 − p)`
 * are two different recipes for the same words „2.5% salt": the second is the S
 * that satisfies `S / (M + W + S) = p/100` exactly. Printing only one of them is
 * how a recipe gets read at the wrong strength.
 *
 * **Salt and sugar are independent on the food-and-water basis, and share one
 * denominator on the total-including-salt basis — and that is not a choice,
 * it is what „percent of the total" means once there are two additives in the
 * total.** Applying the single-substance equation to each separately on that
 * basis overstates both; see the note inside for the worked correction.
 *
 * There is no nitrite, nitrate or curing-salt arithmetic in this tool at all,
 * and no percentage is preset: a cure is a process, and this function is a
 * scale.
 */
export function brineSalt(input: BrineInput): ProResult<BrineResult> {
  const { mode, basis } = input;
  let base: number;
  let saltMass: number;
  let sugarMass: number | undefined;

  if (mode === "concentration") {
    const water = input.waterMass;
    // p_water = S/W needs a water mass; with none there is no concentration to
    // report, and „use the dry cure" is the surface's line, not this one's.
    if (water === undefined || !isPositive(water)) return fail("waterMass");
    const dissolved = input.dissolvedSalt;
    if (dissolved === undefined || !isNonNegative(dissolved)) return fail("dissolvedSalt");
    base = water;
    saltMass = dissolved;
  } else {
    const food = input.foodMass;
    if (food === undefined || !isPositive(food)) return fail("foodMass");
    let water = 0;
    if (mode === "brine") {
      const entered = input.waterMass;
      if (entered === undefined || !isPositive(entered)) return fail("waterMass");
      water = entered;
    }
    const percent = input.saltPercent;
    // p >= 100 has no solution on the total-including-salt basis, and p <= 0 is
    // not a percentage of anything.
    if (percent === undefined || !isInRange(percent, 0, 100) || percent <= 0 || percent >= 100) {
      return fail("saltPercent");
    }
    base = food + water;
    const sugarPercent = input.sugarPercent;
    if (sugarPercent !== undefined && (!isNonNegative(sugarPercent) || sugarPercent >= 100)) {
      return fail("sugarPercent");
    }
    // On the total-including-salt basis, salt and sugar share ONE denominator
    // — each is in the total the other is measured against — so they cannot be
    // solved one at a time: applying S = base·p/(100−p) to salt and sugar
    // separately overstates BOTH, because each equation's own "100" silently
    // excludes the other additive. Solving them together (T = base/(1 − Σp/100))
    // reduces to the single-substance formula exactly when the other is 0, so
    // it replaces it rather than sitting beside it.
    if (basis === "totalWithSalt") {
      const combined = percent + (sugarPercent ?? 0);
      if (combined >= 100) return fail("saltPercent");
      const total = base / (1 - combined / 100);
      saltMass = (total * percent) / 100;
      sugarMass = sugarPercent === undefined ? undefined : (total * sugarPercent) / 100;
    } else {
      saltMass = (base * percent) / 100;
      sugarMass = sugarPercent === undefined ? undefined : (base * sugarPercent) / 100;
    }
  }

  // The denominator here MUST be the actual total on the scale — food, water,
  // salt AND sugar — not just food+water+salt. On the total-including-salt
  // basis, `total` above was solved so that `saltMass / total === percent/100`
  // EXACTLY; dividing by anything less than the real total (i.e. leaving sugar
  // out) reproduces neither the user's own typed percentage nor the basis this
  // brine was actually built on.
  const totalMass = base + saltMass + (sugarMass ?? 0);
  const percentOfBase = (saltMass / base) * 100;
  const percentOfTotal = (saltMass / totalMass) * 100;
  return {
    ok: true,
    saltMass,
    sugarMass,
    totalMass,
    percentOfBase,
    percentOfTotal,
    // Compared on the basis the user chose, so the two conventions are never
    // silently mixed inside a single ratio.
    percentRatio: ratioAgainst(
      basis === "totalWithSalt" ? percentOfTotal : percentOfBase,
      input.percentLimit,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* coffee-extraction                                                           */
/* -------------------------------------------------------------------------- */

export interface CoffeeInput {
  /** Dry ground coffee, g. */
  readonly dose: number;
  /** What was weighed in the cup, g. */
  readonly beverageMass: number;
  /**
   * Refractometer reading, % dissolved solids BY MASS, 0 < TDS < 100 —
   * already corrected by whatever coffee/instrument factor the user's own
   * refractometer applies. This is not a Brix reading and none is converted
   * here: a Brix scale is calibrated on sucrose solutions, and applying it to
   * coffee is exactly the correction the instrument (or the user) already made
   * before this number was typed in.
   */
  readonly tds: number;
  /** Brew water, g. Absent on an espresso, where it is not weighed. */
  readonly brewWater?: number | undefined;
  /** The x of a target 1:x, applied to the WATER ratio. */
  readonly targetRatio?: number | undefined;
}

export interface CoffeeExtraction {
  /** Brew water over dose — the filter figure. Undefined when no water was weighed. */
  readonly waterRatio: number | undefined;
  /** Beverage over dose — the figure an espresso recipe means. */
  readonly beverageRatio: number;
  /** Dissolved solids in the cup over the dry coffee, %. */
  readonly extractionYield: number;
  /** Dissolved solids in the cup, g. */
  readonly dissolved: number;
  /** Water left in the grounds, g: a measured difference, never an absorption factor. */
  readonly retained: number | undefined;
  /** How much the beverage outweighs the brew water — the two weighings contradict. */
  readonly weighingShortfall: number | undefined;
  /** Water for the target ratio, g. */
  readonly waterForTarget: number | undefined;
}

/**
 * The two brew ratios, the extraction yield, and what the grounds kept.
 *
 * **Two ratios exist and conflating them is the classic error.** Water-to-dose
 * is what a filter recipe means; beverage-to-dose is what an espresso recipe
 * means, and on the same shot they differ by everything the puck absorbed. Both
 * are computed and both are labelled.
 *
 * Retention is `brew water − beverage`, a difference between two weighings. When
 * it comes out negative the two weighings contradict each other, and the tool
 * reports the shortfall as a quantity rather than printing a negative retention
 * or quietly assuming an absorption factor it does not have.
 */
export function coffeeExtraction(input: CoffeeInput): ProResult<CoffeeExtraction> {
  const { dose, beverageMass, tds } = input;
  if (!isPositive(dose)) return fail("dose");
  if (!isPositive(beverageMass)) return fail("beverageMass");
  if (!isInRange(tds, 0, 100) || tds <= 0 || tds >= 100) return fail("tds");
  const brewWater = input.brewWater;
  if (brewWater !== undefined && !isPositive(brewWater)) return fail("brewWater");
  const targetRatio = input.targetRatio;
  if (targetRatio !== undefined && !isPositive(targetRatio)) return fail("targetRatio");

  const dissolved = (beverageMass * tds) / 100;
  const difference = brewWater === undefined ? undefined : brewWater - beverageMass;
  return {
    ok: true,
    waterRatio: brewWater === undefined ? undefined : brewWater / dose,
    beverageRatio: beverageMass / dose,
    extractionYield: (dissolved / dose) * 100,
    dissolved,
    retained: difference === undefined || difference < 0 ? undefined : difference,
    weighingShortfall: difference === undefined || difference >= 0 ? undefined : -difference,
    waterForTarget: targetRatio === undefined ? undefined : dose * targetRatio,
  };
}

/* -------------------------------------------------------------------------- */
/* dough-water-temp                                                            */
/* -------------------------------------------------------------------------- */

export type DoughTempMode = "waterTemperature" | "frictionFactor";

export interface DoughTempInput {
  readonly mode: DoughTempMode;
  /** Measured, °C. */
  readonly flourTemp: number;
  /** Measured, °C. */
  readonly roomTemp: number;
  /** Measured, °C. Its presence is what makes the multiplier 4 instead of 3. */
  readonly prefermentTemp?: number | undefined;
  /** Desired dough temperature, °C — `waterTemperature` mode. */
  readonly desiredDoughTemp?: number | undefined;
  /** Measured on the baker's own mixer, °C, 0..40 — `waterTemperature` mode. */
  readonly frictionFactor?: number | undefined;
  /**
   * N (3 or 4) at the batch `frictionFactor` was itself measured from — same
   * mixer, same speed, same batch size, same N. Required alongside
   * `frictionFactor` and checked against THIS batch's own N: a friction factor
   * measured without a preferment (N=3) applied to a batch that has one (N=4)
   * shares only its unit with the right answer, not its size.
   */
  readonly frictionFactorMeasuredAtN?: number | undefined;
  readonly measuredDoughTemp?: number | undefined;
  readonly measuredWaterTemp?: number | undefined;
  /** The hottest water the user actually has, °C. Optional, and never assumed. */
  readonly availableWaterTemp?: number | undefined;
}

export interface DoughTempResult {
  /** N — the count of temperatures being averaged. Structural, never tuned. */
  readonly multiplier: number;
  /** Exactly the temperatures that went into the sum, in the order they were added. */
  readonly components: readonly number[];
  /**
   * The TARGET water temperature — the identity weights flour, room, any
   * preferment and friction equally, which is a bakery convention and not a
   * thermodynamic derivation. A repeated miss means re-measuring friction on
   * this mixer, not doubting this number.
   */
  readonly waterTemp: number | undefined;
  readonly frictionFactor: number | undefined;
  /** Water below 0 °C is not liquid at 101.325 kPa: a physical fact, not a view on the bake. */
  readonly belowFreezingPoint: boolean;
  /** Required minus available, °C. Two numbers side by side; the reading is the user's. */
  readonly availableDelta: number | undefined;
}

/**
 * The water temperature that lands the dough on its desired temperature — and
 * the same equation run backwards to measure a mixer's friction factor.
 *
 * **N is a count, not a coefficient.** It is 1 (the water) plus the number of
 * other components being averaged: flour and room make 3, adding a preferment
 * makes 4. There is nothing to tune in it, which is why it cannot be an input
 * and why N < 3 is unrepresentable here — flour and room are required fields.
 *
 * **The friction factor is always the user's own measurement.** It depends on
 * the mixer, the speed, the batch size and the mix time, so no value is embedded
 * and none is offered: the second mode exists precisely so a baker can measure
 * theirs from a batch they already made.
 *
 * A required water temperature below zero is returned as the number it is,
 * marked with the physical note. It is never clamped to 0 and this tool
 * deliberately does not compute an ice quantity: replacing water with ice
 * changes the mass balance of the dough, which is a different calculation.
 */
export function doughWaterTemperature(input: DoughTempInput): ProResult<DoughTempResult> {
  const { flourTemp, roomTemp } = input;
  if (!isInRange(flourTemp, TEMP_MIN_C, TEMP_MAX_C)) return fail("flourTemp");
  if (!isInRange(roomTemp, TEMP_MIN_C, TEMP_MAX_C)) return fail("roomTemp");
  const preferment = input.prefermentTemp;
  if (preferment !== undefined && !isInRange(preferment, TEMP_MIN_C, TEMP_MAX_C)) {
    return fail("prefermentTemp");
  }
  const base = [flourTemp, roomTemp, ...(preferment === undefined ? [] : [preferment])];
  const multiplier = base.length + 1;

  if (input.mode === "waterTemperature") {
    const desired = input.desiredDoughTemp;
    if (desired === undefined || !isInRange(desired, TEMP_MIN_C, TEMP_MAX_C)) {
      return fail("desiredDoughTemp");
    }
    const friction = input.frictionFactor;
    if (friction === undefined || !isInRange(friction, 0, 40)) return fail("frictionFactor");
    // Friction is a measurement of ONE mixer at ONE N — applying a factor
    // measured at N=3 to a batch that carries a preferment (N=4) mixes two
    // different sizes that merely share a unit, so the batch it was measured
    // on has to match the batch it is applied to.
    const frictionN = input.frictionFactorMeasuredAtN;
    if (frictionN === undefined || !isIntegerIn(frictionN, 3, 4)) {
      return fail("frictionFactorMeasuredAtN");
    }
    if (frictionN !== multiplier) return fail("frictionFactorMeasuredAtN");
    const components = [...base, friction];
    const waterTemp =
      multiplier * desired - components.reduce((sum, value) => sum + value, 0);
    const available = input.availableWaterTemp;
    if (available !== undefined && !isInRange(available, TEMP_MIN_C, TEMP_MAX_C)) {
      return fail("availableWaterTemp");
    }
    return {
      ok: true,
      multiplier,
      components,
      waterTemp,
      frictionFactor: friction,
      belowFreezingPoint: waterTemp < WATER_FREEZING_C,
      availableDelta: available === undefined ? undefined : waterTemp - available,
    };
  }

  const dough = input.measuredDoughTemp;
  if (dough === undefined || !isInRange(dough, TEMP_MIN_C, TEMP_MAX_C)) {
    return fail("measuredDoughTemp");
  }
  const water = input.measuredWaterTemp;
  if (water === undefined || !isInRange(water, TEMP_MIN_C, TEMP_MAX_C)) {
    return fail("measuredWaterTemp");
  }
  const components = [...base, water];
  return {
    ok: true,
    multiplier,
    components,
    waterTemp: undefined,
    // A long intensive mix legitimately produces a large friction factor, so
    // this is not bounded from above by the tool.
    frictionFactor: multiplier * dough - components.reduce((sum, value) => sum + value, 0),
    belowFreezingPoint: false,
    availableDelta: undefined,
  };
}

/* -------------------------------------------------------------------------- */
/* ice-cream-overrun                                                           */
/* -------------------------------------------------------------------------- */

export type OverrunMode = "fromWeighings" | "fromTarget";

export interface OverrunInput {
  readonly mode: OverrunMode;
  /** The container filled with mix, g. */
  readonly grossMixMass?: number | undefined;
  /** THE SAME container filled with the finished product, g. */
  readonly grossFrozenMass?: number | undefined;
  /**
   * Container tare, g — REQUIRED in `fromWeighings`, never defaulted to 0.
   * `(m_mix − m_frozen)/(m_frozen + t)` with the tare left in both masses is
   * strictly LESS than the true overrun, and silently in the flattering
   * direction: „already net" has to be an assertion the user makes on
   * purpose, typed as 0, not a value nobody supplied.
   */
  readonly tare?: number | undefined;
  /** Target overrun, %, > −100 — `fromTarget` mode. */
  readonly targetOverrun?: number | undefined;
  /** Mix volume, l. */
  readonly mixVolume?: number | undefined;
  /** Measured mix density, kg/l. */
  readonly mixDensity?: number | undefined;
  /** Tub volume, l. */
  readonly tubVolume?: number | undefined;
}

export interface OverrunResult {
  readonly overrun: number;
  readonly netMixMass: number | undefined;
  readonly netFrozenMass: number | undefined;
  /** Volume of finished product from the mix volume, l. */
  readonly frozenVolume: number | undefined;
  readonly finishedDensity: number | undefined;
  /** The same density as g/l, which is what a spec sheet quotes. */
  readonly finishedMassPerLitre: number | undefined;
  /** Net weight of one tub, g. */
  readonly tubNetWeight: number | undefined;
}

/**
 * Overrun from two weighings of the same container — or the volume and pack
 * weights implied by a target overrun.
 *
 * **The same container, filled to the same level, is the entire method.**
 * Because the volume is identical in both weighings, the difference in mass is
 * entirely the air that was beaten in, and no volumetric measurement is
 * needed. A tare that exceeds either gross mass means the two weighings were
 * not of the same vessel, so it is refused rather than subtracted into a
 * negative net.
 *
 * A negative overrun is a legitimate answer — a dense mix can lose volume — and
 * is returned as a negative number. Only −100% or below is refused, because at
 * that point the product has no volume left to have.
 */
export function iceCreamOverrun(input: OverrunInput): ProResult<OverrunResult> {
  let overrun: number;
  let netMixMass: number | undefined;
  let netFrozenMass: number | undefined;

  if (input.mode === "fromWeighings") {
    const grossMix = input.grossMixMass;
    const grossFrozen = input.grossFrozenMass;
    if (grossMix === undefined || !isPositive(grossMix)) return fail("grossMixMass");
    if (grossFrozen === undefined || !isPositive(grossFrozen)) return fail("grossFrozenMass");
    const tare = input.tare;
    if (tare === undefined || !isNonNegative(tare)) return fail("tare");
    if (tare >= grossMix || tare >= grossFrozen) return fail("tare");
    netMixMass = grossMix - tare;
    netFrozenMass = grossFrozen - tare;
    overrun = ((netMixMass - netFrozenMass) / netFrozenMass) * 100;
  } else {
    const target = input.targetOverrun;
    if (target === undefined || !Number.isFinite(target) || target <= -100) {
      return fail("targetOverrun");
    }
    overrun = target;
  }

  const expansion = 1 + overrun / 100;
  const mixVolume = input.mixVolume;
  if (mixVolume !== undefined && !isPositive(mixVolume)) return fail("mixVolume");
  const mixDensity = input.mixDensity;
  if (mixDensity !== undefined && !isPositive(mixDensity)) return fail("mixDensity");
  const tubVolume = input.tubVolume;
  if (tubVolume !== undefined && !isPositive(tubVolume)) return fail("tubVolume");
  // A tub weight is a density times a volume; without a measured mix density
  // there is no honest number to print.
  if (tubVolume !== undefined && mixDensity === undefined) return fail("mixDensity");

  const finishedDensity = mixDensity === undefined ? undefined : mixDensity / expansion;
  const finishedMassPerLitre =
    finishedDensity === undefined ? undefined : finishedDensity * PER_KILO;
  return {
    ok: true,
    overrun,
    netMixMass,
    netFrozenMass,
    frozenVolume: mixVolume === undefined ? undefined : mixVolume * expansion,
    finishedDensity,
    finishedMassPerLitre,
    tubNetWeight:
      tubVolume === undefined || finishedMassPerLitre === undefined
        ? undefined
        : tubVolume * finishedMassPerLitre,
  };
}

/* -------------------------------------------------------------------------- */
/* lamination-layers                                                           */
/* -------------------------------------------------------------------------- */

export type FoldKind = "letter" | "book" | "half";

/**
 * What each fold geometrically does to the layer count. These are definitions of
 * the operation — folding in three gives three — and not measured or tuned
 * figures that could ever be revised.
 */
const FOLD_MULTIPLIER: Record<FoldKind, number> = { letter: 3, book: 4, half: 2 };

/** Enough folds for any laminated dough, and low enough that the count stays exact. */
const MAX_FOLDS = 20;

export interface LaminationInput {
  /** The folds in the order they are performed. At least one. */
  readonly folds: readonly FoldKind[];
  /** Fat layers before the first fold. Absent is 1: one block of butter enclosed in dough. */
  readonly startingFatLayers?: number | undefined;
  /** Mass of the fat block enclosed, g — see `laminationLayers` for why this is now required. */
  readonly fatMass: number;
  /** Mass of the dough enclosing it, g. */
  readonly doughMass: number;
  /** Thickness of the finished sheet, mm. */
  readonly finalThickness: number;
  /** Thickness before the FIRST fold, mm. Required only to report the roll-out passes. */
  readonly startThickness?: number | undefined;
  /** Length of the strip before the first fold, cm. */
  readonly startLength?: number | undefined;
  /**
   * The thickness the strip is rolled out to immediately AFTER each fold, mm —
   * same length as `folds`. An entry may be `undefined` for a fold that was
   * not rolled before the next one, in which case that fold's own row reports
   * the fold-only thickness and length, and no roll-out is claimed for it.
   */
  readonly rollThicknesses?: readonly (number | undefined)[] | undefined;
}

export interface LaminationPass {
  readonly fold: FoldKind;
  /** Thickness right after this fold, before any roll-out, mm — thickness × the fold's own multiplier. */
  readonly foldedThickness: number;
  /** Length right after this fold, before any roll-out, cm — length ÷ the fold's own multiplier. */
  readonly foldedLength: number;
  /** Thickness after rolling out, mm — equal to `foldedThickness` when this fold was not rolled. */
  readonly rolledThickness: number;
  /** Length after rolling out, cm — equal to `foldedLength` when this fold was not rolled. */
  readonly rolledLength: number;
}

export interface LaminationResult {
  readonly fatLayers: number;
  readonly doughLayers: number;
  /** Thickness of one fat layer at the final sheet thickness, micrometres. */
  readonly fatLayerMicrons: number;
  readonly doughLayerMicrons: number;
  /**
   * The fold-by-fold, ALTERNATING fold-then-roll chain — see `laminationLayers`.
   * Empty when no starting thickness and length were given, since there is
   * then no chain to walk at all.
   */
  readonly passes: readonly LaminationPass[];
}

/**
 * Layer counts and layer thicknesses for a laminated dough, plus the
 * fold-by-fold thickness and length of the strip as it is worked.
 *
 * **The counts are integer arithmetic on purpose.** B grows fast — eight letter
 * folds are 6561 layers — and a floating multiplication would eventually print
 * 6560.999. A layer count is a count.
 *
 * `doughLayers = fatLayers + 1` for a block of butter enclosed in dough: it
 * starts as one fat layer between two dough layers, and every fold preserves the
 * relation.
 *
 * **A layer's thickness is NOT `finalThickness / count`.** That divides the
 * whole cross-section by one phase's own layer count, which silently assumes
 * the fat fills the entire slab — at 3.5 mm and 27/28 layers it prints 129.6 µm
 * and 125.0 µm whose sum, 27×129.6 + 28×125.0 = 6999 µm, is DOUBLE the actual
 * 3.5 mm strip. The fat's true share of the cross-section, φ, is taken from the
 * masses that were actually weighed out (fat and dough have close enough
 * density that a mass ratio stands in for the volume ratio a cross-section
 * needs): `fatLayerThickness = finalThickness × φ / B` and
 * `doughLayerThickness = finalThickness × (1 − φ) / D`, which by construction
 * satisfy `B × fatLayerThickness + D × doughLayerThickness = finalThickness`
 * exactly, unlike the naive division.
 *
 * **Rolling at constant width conserves volume, and a fold is a separate
 * operation from a roll.** A fold of multiplier f stacks the strip onto
 * itself: thickness ×f, length ÷f, always, deterministically, from the
 * fold's own geometry. A roll-out to a thickness the baker actually chose is
 * a SECOND, independent step with its own inverse relation on length, and
 * without a chosen roll-out thickness for a given fold there is nothing to
 * report for it beyond the fold-only numbers — the two are never conflated
 * into one figure.
 *
 * A roll-out thicker than the fold it follows, or a `finalThickness` past the
 * thickness reached at the end of the chain, is refused: that is not rolling
 * out, and the comparison is always against the thickness immediately before
 * that step, never the very first one — the strip is genuinely thicker right
 * after a fold than it was before it.
 */
export function laminationLayers(input: LaminationInput): ProResult<LaminationResult> {
  const { folds, finalThickness, fatMass, doughMass } = input;
  if (folds.length === 0 || folds.length > MAX_FOLDS) return fail("folds");
  const start = input.startingFatLayers ?? 1;
  if (!isIntegerIn(start, 1, 1000000)) return fail("startingFatLayers");
  if (!isPositive(finalThickness)) return fail("finalThickness");
  if (!isPositive(fatMass)) return fail("fatMass");
  if (!isPositive(doughMass)) return fail("doughMass");

  let fatLayers = start;
  for (const fold of folds) fatLayers *= FOLD_MULTIPLIER[fold];
  if (!Number.isSafeInteger(fatLayers)) return fail("folds");
  const doughLayers = fatLayers + 1;
  // The fat's share of the cross-section, from the two masses actually
  // weighed out — see the note above for why mass stands in for volume here.
  const fatShare = fatMass / (fatMass + doughMass);

  const startThickness = input.startThickness;
  const startLength = input.startLength;
  if (startThickness !== undefined && !isPositive(startThickness)) return fail("startThickness");
  if (startLength !== undefined && !isPositive(startLength)) return fail("startLength");

  const passes: LaminationPass[] = [];
  if (startThickness !== undefined && startLength !== undefined) {
    const rolls = input.rollThicknesses ?? [];
    let thickness = startThickness;
    let length = startLength;
    for (const [index, fold] of folds.entries()) {
      const multiplier = FOLD_MULTIPLIER[fold];
      const foldedThickness = thickness * multiplier;
      const foldedLength = length / multiplier;
      let rolledThickness = foldedThickness;
      let rolledLength = foldedLength;
      const target = rolls[index];
      if (target !== undefined) {
        // Rolling THINS the strip — a target at or above the folded thickness
        // is not a roll-out at all.
        if (!isPositive(target) || target >= foldedThickness) return fail(`rollThickness:${index}`);
        rolledThickness = target;
        rolledLength = foldedLength * (foldedThickness / target);
      }
      passes.push({ fold, foldedThickness, foldedLength, rolledThickness, rolledLength });
      thickness = rolledThickness;
      length = rolledLength;
    }
    // Compared against the thickness reached at the END of the chain — the
    // state immediately before the implicit final roll-out to `finalThickness`
    // — never against the very first `startThickness`.
    if (finalThickness > thickness) return fail("finalThickness");
  }

  return {
    ok: true,
    fatLayers,
    doughLayers,
    fatLayerMicrons: ((finalThickness * fatShare) / fatLayers) * PER_KILO,
    doughLayerMicrons: ((finalThickness * (1 - fatShare)) / doughLayers) * PER_KILO,
    passes,
  };
}

/* -------------------------------------------------------------------------- */
/* levain-hydration                                                            */
/* -------------------------------------------------------------------------- */

export interface LevainSplit {
  readonly flour: number;
  readonly water: number;
}

/**
 * The flour and the water inside a mass of levain at a known hydration.
 *
 * `f = S / (1 + h/100)` and `w = S − f` — the single identity this whole tool is
 * built from, applied four times. Exported because a surface that has to say „by
 * how much the levain overshoots" needs the same split the refusal was computed
 * from, and recomputing it by hand in the renderer is how the two drift apart.
 */
export function levainSplit(mass: number, hydration: number): ProResult<LevainSplit> {
  if (!isNonNegative(mass)) return fail("mass");
  // A flour-only mass has no hydration figure, so 0% is not „dry", it is „no
  // answer" — and dividing by 1 + 0 would silently call the whole mass flour.
  if (!isPositive(hydration)) return fail("hydration");
  const flour = mass / (1 + hydration / 100);
  return { ok: true, flour, water: mass - flour };
}

export type LevainMode = "correctDough" | "buildLevain";

export interface LevainInput {
  readonly mode: LevainMode;
  /** All the flour in the finished dough, INCLUDING the flour inside the levain, g. */
  readonly totalFlour?: number | undefined;
  /** Target hydration of the whole dough, %. */
  readonly targetHydration?: number | undefined;
  readonly levainMass?: number | undefined;
  readonly levainHydration?: number | undefined;
  /** Seed (the spoonful you start from), g — `buildLevain`. */
  readonly seedMass?: number | undefined;
  readonly seedHydration?: number | undefined;
  readonly targetLevainMass?: number | undefined;
  readonly targetLevainHydration?: number | undefined;
}

export interface LevainResult {
  /** Flour the levain (or, when building, the seed) already carries, g. */
  readonly levainFlour: number;
  readonly levainWater: number;
  readonly addedFlour: number;
  readonly addedWater: number;
  /** Flour + water, excluding salt and add-ins, g. `correctDough` only. */
  readonly doughMass: number | undefined;
  /** Recomputed from the result as a check; it must equal the target. */
  readonly achievedHydration: number;
}

/**
 * How much flour and water still have to go in, once the levain's own flour and
 * water are counted.
 *
 * **The levain is not an ingredient, it is flour and water in disguise**, and
 * every hydration error in sourdough comes from adding it as if it were neither.
 * `totalFlour` therefore INCLUDES the flour inside the levain, which is the one
 * thing a reader gets wrong.
 *
 * A negative „still to add" is refused with the side that is over — never
 * clamped to zero and never printed as a negative weight. Use `levainSplit` to
 * show by how much: the refusal carries a key, not a quantity.
 */
export function levainHydration(input: LevainInput): ProResult<LevainResult> {
  if (input.mode === "buildLevain") {
    const seedMass = input.seedMass;
    const seedHydration = input.seedHydration;
    const targetMass = input.targetLevainMass;
    const targetHydration = input.targetLevainHydration;
    if (seedMass === undefined || !isNonNegative(seedMass)) return fail("seedMass");
    if (seedHydration === undefined || !isPositive(seedHydration)) return fail("seedHydration");
    if (targetMass === undefined || !isPositive(targetMass)) return fail("targetLevainMass");
    if (targetHydration === undefined || !isPositive(targetHydration)) {
      return fail("targetLevainHydration");
    }
    if (targetMass <= seedMass) return fail("targetLevainMass");
    const seed = levainSplit(seedMass, seedHydration);
    if (!seed.ok) return seed;
    const target = levainSplit(targetMass, targetHydration);
    if (!target.ok) return target;
    const addedFlour = target.flour - seed.flour;
    const addedWater = target.water - seed.water;
    if (addedFlour < 0) return fail("flourOver");
    if (addedWater < 0) return fail("waterOver");
    return {
      ok: true,
      levainFlour: seed.flour,
      levainWater: seed.water,
      addedFlour,
      addedWater,
      doughMass: undefined,
      achievedHydration: (target.water / target.flour) * 100,
    };
  }

  const totalFlour = input.totalFlour;
  const targetHydration = input.targetHydration;
  const levainMass = input.levainMass;
  const levainHydrationPercent = input.levainHydration;
  if (totalFlour === undefined || !isPositive(totalFlour)) return fail("totalFlour");
  if (targetHydration === undefined || !isPositive(targetHydration)) return fail("targetHydration");
  if (levainMass === undefined || !isNonNegative(levainMass)) return fail("levainMass");
  if (levainHydrationPercent === undefined || !isPositive(levainHydrationPercent)) {
    return fail("levainHydration");
  }
  const split = levainSplit(levainMass, levainHydrationPercent);
  if (!split.ok) return split;
  const totalWater = (totalFlour * targetHydration) / 100;
  const doughMass = totalFlour + totalWater;
  if (levainMass > doughMass) return fail("levainMass");
  const addedFlour = totalFlour - split.flour;
  const addedWater = totalWater - split.water;
  if (addedFlour < 0) return fail("flourOver");
  if (addedWater < 0) return fail("waterOver");
  return {
    ok: true,
    levainFlour: split.flour,
    levainWater: split.water,
    addedFlour,
    addedWater,
    doughMass,
    // Recomputed from the numbers just produced rather than echoed from the
    // input: an arithmetic slip shows up here as a mismatch.
    achievedHydration: ((split.water + addedWater) / (split.flour + addedFlour)) * 100,
  };
}

/* -------------------------------------------------------------------------- */
/* nutrition-per-portion                                                       */
/* -------------------------------------------------------------------------- */

export type NutritionDirection = "per100ToPortion" | "portionToPer100";

export type EnergyUnit = "kJ" | "kcal";

export interface NutritionRow {
  readonly name: string;
  readonly value: number;
  /**
   * The reference daily intake THE USER typed for this nutrient. The tool holds
   * none: reference intakes are set by whichever labelling rule applies to the
   * user and are revised from time to time.
   */
  readonly reference?: number | undefined;
}

export interface NutritionInput {
  readonly direction: NutritionDirection;
  /** Energy in whichever unit the user typed; the other is derived, never both typed. */
  readonly energy: number;
  readonly energyUnit: EnergyUnit;
  readonly nutrients: readonly NutritionRow[];
  readonly portionMass: number;
  readonly packageMass?: number | undefined;
  readonly portionsPerPackage?: number | undefined;
}

export interface NutritionEnergy {
  readonly per100gKJ: number;
  readonly per100gKcal: number;
  readonly perPortionKJ: number;
  readonly perPortionKcal: number;
  readonly perPackageKJ: number | undefined;
  readonly perPackageKcal: number | undefined;
}

export interface NutritionResultRow {
  readonly name: string;
  readonly per100g: number;
  readonly perPortion: number;
  readonly perPackage: number | undefined;
  /** The PORTION figure over the reference the user typed, in %. */
  readonly percentOfReference: number | undefined;
}

export interface NutritionTable {
  readonly energy: NutritionEnergy;
  readonly rows: readonly NutritionResultRow[];
  readonly portionsPerPackage: number | undefined;
}

/** How far, in g, a package mass and a portion count may disagree before it is a contradiction. */
const PACKAGE_TOLERANCE_G = 1;

/**
 * One nutrition table in three columns, and the exact kJ/kcal pairing.
 *
 * **Nothing in the answer comes from the tool.** There is no food composition
 * table, no Atwater factor and no reference intake here: a composition table is
 * a database somebody must maintain, and the reference intakes belong to a
 * rule-maker who can change them. Every number the user sees is a number the
 * user typed, rearranged.
 *
 * The energy pairing is a pure unit change on ONE number: whichever unit was
 * typed stays exact and the other is derived at exactly 4.184 kJ per kcal. Both
 * typed and silently reconciled is how a declaration ends up internally
 * inconsistent.
 *
 * The result is an aid to a calculation, not a declaration: what must appear on
 * a package is set by a rule this tool neither knows nor checks.
 */
export function nutritionPerPortion(input: NutritionInput): ProResult<NutritionTable> {
  const { portionMass, direction } = input;
  if (!isPositive(portionMass)) return fail("portionMass");
  if (!isNonNegative(input.energy)) return fail("energy");
  for (const nutrient of input.nutrients) {
    if (!isNonNegative(nutrient.value)) return fail("nutrientValue");
    if (nutrient.reference !== undefined && !isNonNegative(nutrient.reference)) {
      return fail("reference");
    }
  }
  const packageMass = input.packageMass;
  if (packageMass !== undefined && !isPositive(packageMass)) return fail("packageMass");
  const portionsPerPackage = input.portionsPerPackage;
  if (portionsPerPackage !== undefined && !isIntegerIn(portionsPerPackage, 1, 1000000)) {
    return fail("portionsPerPackage");
  }
  // Two statements about the same package that do not agree are a contradiction
  // in the input, and resolving it by preferring one of them would be this tool
  // deciding which of the user's two measurements was the wrong one.
  if (packageMass !== undefined && portionsPerPackage !== undefined) {
    if (Math.abs(packageMass - portionsPerPackage * portionMass) > PACKAGE_TOLERANCE_G) {
      return fail("package");
    }
  }

  const fromCount =
    portionsPerPackage === undefined ? undefined : portionsPerPackage * portionMass;
  const packageBasis = packageMass ?? fromCount;
  const toPer100 = (typed: number): number =>
    direction === "per100ToPortion" ? typed : (typed * 100) / portionMass;
  const scale = (per100: number, mass: number): number => (per100 * mass) / 100;

  const energyPer100 = toPer100(input.energy);
  const kJPer100 =
    input.energyUnit === "kJ" ? energyPer100 : energyPer100 * KJ_PER_KCAL;
  const kcalPer100 =
    input.energyUnit === "kcal" ? energyPer100 : energyPer100 / KJ_PER_KCAL;

  const rows: NutritionResultRow[] = input.nutrients.map((nutrient) => {
    const per100g = toPer100(nutrient.value);
    const perPortion = scale(per100g, portionMass);
    const ratio = ratioAgainst(perPortion, nutrient.reference);
    return {
      name: nutrient.name,
      per100g,
      perPortion,
      perPackage: packageBasis === undefined ? undefined : scale(per100g, packageBasis),
      percentOfReference: ratio === undefined ? undefined : ratio * 100,
    };
  });

  return {
    ok: true,
    energy: {
      per100gKJ: kJPer100,
      per100gKcal: kcalPer100,
      perPortionKJ: scale(kJPer100, portionMass),
      perPortionKcal: scale(kcalPer100, portionMass),
      perPackageKJ: packageBasis === undefined ? undefined : scale(kJPer100, packageBasis),
      perPackageKcal: packageBasis === undefined ? undefined : scale(kcalPer100, packageBasis),
    },
    rows,
    portionsPerPackage:
      portionsPerPackage ??
      (packageMass === undefined ? undefined : packageMass / portionMass),
  };
}

/* -------------------------------------------------------------------------- */
/* pan-area-volume                                                             */
/* -------------------------------------------------------------------------- */

/** Every dimension is in cm, so no unit conversion happens inside the formulae. */
export type PanShape =
  | { readonly kind: "circle"; readonly diameter: number }
  | { readonly kind: "square"; readonly side: number }
  | { readonly kind: "rect"; readonly a: number; readonly b: number }
  | { readonly kind: "ring"; readonly outer: number; readonly inner: number };

export interface PanAreaResult {
  /** Base area, cm². */
  readonly area: number;
}

/** The base area of one tin, in cm². A ring whose hole is not smaller than the tin is refused. */
export function panArea(shape: PanShape): ProResult<PanAreaResult> {
  switch (shape.kind) {
    case "circle":
      if (!isPositive(shape.diameter)) return fail("diameter");
      return { ok: true, area: Math.PI * (shape.diameter / 2) ** 2 };
    case "square":
      if (!isPositive(shape.side)) return fail("side");
      return { ok: true, area: shape.side ** 2 };
    case "rect":
      if (!isPositive(shape.a)) return fail("a");
      if (!isPositive(shape.b)) return fail("b");
      return { ok: true, area: shape.a * shape.b };
    default:
      if (!isPositive(shape.outer)) return fail("outer");
      if (!isPositive(shape.inner)) return fail("inner");
      // d >= D is a zero or negative annulus: not a tin, a refusal.
      if (shape.inner >= shape.outer) return fail("inner");
      return {
        ok: true,
        area: Math.PI * ((shape.outer / 2) ** 2 - (shape.inner / 2) ** 2),
      };
  }
}

export interface PanInput {
  readonly shapeA: PanShape;
  /** The tin being swapped TO. */
  readonly shapeB?: PanShape | undefined;
  /** Fill height, cm. */
  readonly fillHeight?: number | undefined;
  /** Target volume, l — the inverse question about height. */
  readonly targetVolume?: number | undefined;
  /** Batter that fills tin A, g. */
  readonly batterMassA?: number | undefined;
}

export interface PanConversion {
  readonly areaA: number;
  readonly areaB: number | undefined;
  /** A_B / A_A — for two circles this reduces to (d_B/d_A)². */
  readonly swapFactor: number | undefined;
  /** Batter for tin B, g. Valid ONLY at equal batter depth, which the surface states. */
  readonly massB: number | undefined;
  /** Volume of tin A at the fill height, l. */
  readonly volumeAtHeight: number | undefined;
  /** Fill height in tin A for the target volume, cm. */
  readonly heightForVolume: number | undefined;
}

/**
 * Areas, the swap factor between two tins, and the volume/height pair.
 *
 * **The swap factor is an area ratio and nothing more.** `mass_B = mass_A ×
 * A_B/A_A` holds only if the batter stands at the same depth in both tins; the
 * surface says so beside the number, because a deeper tin bakes differently even
 * when the arithmetic is right.
 *
 * A target volume taller than the tin's own wall is still computed and returned
 * as a height: the tool does not know the wall height unless it is told, and
 * „it will overflow" would be a judgement about a tin it has never seen.
 *
 * **`volume = area × height` treats the vessel as straight-walled**, which is
 * exact for a cake tin or a stock pot and an OVERESTIMATE for anything that
 * tapers — a gugelhupf or bundt mould measured at the rim, or a cone. This
 * tool invents no taper factor for that case; a genuinely tapered vessel is
 * `frustumVolume` below, which needs the two diameters rather than one.
 *
 * **For a `ring` shape specifically, `area × height` is exact only if the
 * inner tube runs the FULL height of the pan.** A bundt or angel-food tin
 * whose centre post stops short of the rim is not an annulus all the way up —
 * the part above the post is a plain circle, not a ring — and this tool has no
 * way to know the post's own height unless a taper or a second measurement is
 * given; it takes the ring area at face value for the whole height it is told.
 */
export function panConversion(input: PanInput): ProResult<PanConversion> {
  const a = panArea(input.shapeA);
  if (!a.ok) return a;
  let areaB: number | undefined;
  if (input.shapeB !== undefined) {
    const b = panArea(input.shapeB);
    if (!b.ok) return b;
    areaB = b.area;
  }
  const fillHeight = input.fillHeight;
  if (fillHeight !== undefined && !isPositive(fillHeight)) return fail("fillHeight");
  const targetVolume = input.targetVolume;
  if (targetVolume !== undefined && !isPositive(targetVolume)) return fail("targetVolume");
  const batterMassA = input.batterMassA;
  if (batterMassA !== undefined && !isPositive(batterMassA)) return fail("batterMassA");

  const swapFactor = areaB === undefined ? undefined : areaB / a.area;
  return {
    ok: true,
    areaA: a.area,
    areaB,
    swapFactor,
    massB:
      swapFactor === undefined || batterMassA === undefined
        ? undefined
        : batterMassA * swapFactor,
    volumeAtHeight: fillHeight === undefined ? undefined : (a.area * fillHeight) / PER_KILO,
    heightForVolume:
      targetVolume === undefined ? undefined : (targetVolume * PER_KILO) / a.area,
  };
}

export interface FrustumInput {
  /** Diameter at the top, cm. */
  readonly topDiameter: number;
  /** Diameter at the bottom, cm. */
  readonly bottomDiameter: number;
  readonly height: number;
}

/**
 * The exact volume of a tapered vessel — a cone or a frustum — from its two
 * diameters and its height, `V = πh(R² + Rr + r²)/3`.
 *
 * **This exists because `area × height` is wrong for this shape**, not as a
 * convenience: a bundt or gugelhupf mould measured at its widest rim and
 * multiplied straight through by its height overestimates its true volume, and
 * the wrong number looks exactly as authoritative as the right one. No taper
 * FACTOR is invented for the straight-walled tools above — a taper is only
 * ever computed here, from the two diameters actually measured.
 */
export function frustumVolume(input: FrustumInput): ProResult<{ readonly volume: number }> {
  const { topDiameter, bottomDiameter, height } = input;
  if (!isPositive(topDiameter)) return fail("topDiameter");
  if (!isPositive(bottomDiameter)) return fail("bottomDiameter");
  if (!isPositive(height)) return fail("height");
  const r = topDiameter / 2;
  const R = bottomDiameter / 2;
  const volumeCm3 = (Math.PI * height * (R * R + R * r + r * r)) / 3;
  return { ok: true, volume: volumeCm3 / PER_KILO };
}

/* -------------------------------------------------------------------------- */
/* plate-cost                                                                  */
/* -------------------------------------------------------------------------- */

export type PlateUnit = "g" | "ml" | "piece";

/** g and ml are priced per kg and per l; a piece is priced per piece. */
const PLATE_UNIT_DIVISOR: Record<PlateUnit, number> = { g: PER_KILO, ml: PER_KILO, piece: 1 };

export interface PlateLine {
  readonly name: string;
  /** NET quantity that reaches the plate, in `unit`. */
  readonly quantity: number;
  readonly unit: PlateUnit;
  /** Purchase price per kg, per l or per piece. */
  readonly unitPrice: number;
  /**
   * Usable share of what is bought, %, 0 < y <= 100. The SAME combined
   * convention `yieldTrimCook` returns as `combinedYield` (cleaning yield ×
   * cooking yield): a yield from only the cleaning stage understates this
   * line's true cost by the cook's own shrinkage, which is exactly the gap
   * the review of this pack found between its yield-shaped tools. Pipe
   * `yieldTrimCook`'s `combinedYield` straight into this field rather than
   * re-deriving it.
   */
  readonly yieldPercent: number;
}

export interface PlateCostInput {
  readonly lines: readonly PlateLine[];
  readonly portions: number;
  /** The food-cost target, %, 0 < fc <= 100 — a business decision the user makes. */
  readonly targetFoodCost: number;
  /** Packaging and extras, per portion, in currency. */
  readonly extraPerPortion?: number | undefined;
}

export interface PlateCostRow {
  readonly name: string;
  /**
   * The unit BOTH quantities below are in — echoed from the line rather than
   * left for the caller to pair back up by index. A surface that prints the
   * quantity without it prints a number in whichever unit it assumed, and the
   * assumption is invisible: 200 ml of stock read as 200 g is not an obviously
   * wrong figure on the screen, it is just the wrong one.
   */
  readonly unit: PlateUnit;
  /** What reaches the plate — the quantity as typed. */
  readonly usedQuantity: number;
  /** What has to be bought for it: quantity ÷ yield. */
  readonly purchasedQuantity: number;
  readonly cost: number;
  /** This line's share of the recipe, %. Undefined when the recipe costs nothing. */
  readonly share: number | undefined;
}

export interface PlateCost {
  readonly rows: readonly PlateCostRow[];
  readonly total: number;
  readonly costPerPortion: number;
  /**
   * NET of any tax — see the note below. A Serbian menu prices WITH tax, so
   * this number is a costing input, not a menu-ready price, until whichever
   * rate applies is added by a separate percentage tool.
   */
  readonly sellingPrice: number;
  readonly margin: number;
}

/**
 * What one plate costs, and what it has to sell for at the food-cost the user
 * chose.
 *
 * **Dividing by the yield is the whole tool.** A purchase price is a price for
 * what comes through the door, and 180 g of trimmed meat on a plate at 82% yield
 * cost 219.5 g of purchase. A kitchen that costs by the net weight underprices
 * every dish by the trim.
 *
 * **No tax of any kind is applied, embedded or stored.** Every rate is a
 * rule-maker's number that changes; the price here is a net amount, and a user
 * who wants a rate in the figure types it into the percentage tool.
 *
 * Shares are computed from unrounded line costs, so the printed column adds to
 * 100.0 rather than to 99.9.
 */
export function plateCost(input: PlateCostInput): ProResult<PlateCost> {
  const { lines } = input;
  if (lines.length === 0) return fail("lines");
  if (!isIntegerIn(input.portions, 1, 1000000)) return fail("portions");
  if (!isPositive(input.targetFoodCost) || input.targetFoodCost > 100) {
    return fail("targetFoodCost");
  }
  const extra = input.extraPerPortion ?? 0;
  if (!isNonNegative(extra)) return fail("extraPerPortion");

  const costs: number[] = [];
  const purchased: number[] = [];
  for (const line of lines) {
    if (!isNonNegative(line.quantity)) return fail("quantity");
    if (!isNonNegative(line.unitPrice)) return fail("unitPrice");
    if (!isPositive(line.yieldPercent) || line.yieldPercent > 100) return fail("yieldPercent");
    // Without this the divisor is `undefined`, the division is `NaN`, and the
    // `NaN` reaches costPerPortion and sellingPrice on an `ok: true` result.
    if (!isKeyOf(line.unit, PLATE_UNIT_DIVISOR)) return fail("unit");
    const inPricingUnit = line.quantity / PLATE_UNIT_DIVISOR[line.unit];
    const gross = line.quantity / (line.yieldPercent / 100);
    purchased.push(gross);
    costs.push((inPricingUnit * line.unitPrice) / (line.yieldPercent / 100));
  }
  const total = costs.reduce((sum, cost) => sum + cost, 0);
  const costPerPortion = total / input.portions + extra;
  const sellingPrice = costPerPortion / (input.targetFoodCost / 100);

  const rows: PlateCostRow[] = lines.map((line, index) => ({
    name: line.name,
    unit: line.unit,
    usedQuantity: line.quantity,
    purchasedQuantity: purchased[index] ?? 0,
    cost: costs[index] ?? 0,
    // A recipe that costs nothing has no shares; 0.0% would be a number where
    // there is no answer.
    share: total > 0 ? ((costs[index] ?? 0) / total) * 100 : undefined,
  }));

  return {
    ok: true,
    rows,
    total,
    costPerPortion,
    sellingPrice,
    margin: sellingPrice - costPerPortion,
  };
}

/* -------------------------------------------------------------------------- */
/* portions-from-pack                                                          */
/* -------------------------------------------------------------------------- */

export type PackUnit = "g" | "kg" | "ml" | "l" | "piece";

export type PackDimension = "mass" | "volume" | "count";

interface PackUnitFacts {
  readonly dimension: PackDimension;
  /** How many base units (g, ml, pieces) one of these is. */
  readonly base: number;
}

const PACK_UNITS: Record<PackUnit, PackUnitFacts> = {
  g: { dimension: "mass", base: 1 },
  kg: { dimension: "mass", base: PER_KILO },
  ml: { dimension: "volume", base: 1 },
  l: { dimension: "volume", base: PER_KILO },
  piece: { dimension: "count", base: 1 },
};

export interface PortionsFromPackInput {
  readonly packQuantity: number;
  readonly packUnit: PackUnit;
  readonly portionQuantity: number;
  readonly portionUnit: PackUnit;
  /** Loss inside the pack, %, 0 <= L < 100 — drained weight, spillage, measured by the user. */
  readonly lossPercent: number;
  readonly portionsNeeded?: number | undefined;
  readonly packPrice?: number | undefined;
}

export interface PortionsFromPack {
  readonly portionsPerPack: number;
  /** What is left in the pack, in the PACK's own unit. */
  readonly leftover: number;
  /**
   * `100 − lossPercent`, printed alongside the loss it came from. This pack
   * uses „yield %" as its own convention elsewhere (`yieldTrimCook`,
   * `plateCost`) because a kitchen measures what remains, not what left; this
   * tool's own input is a loss (`gubitak u pakovanju`, its own spec's name),
   * so the pair is shown together rather than one silently retyped as the
   * other.
   */
  readonly yieldPercent: number;
  readonly packsNeeded: number | undefined;
  /** Portions bought over portions needed. */
  readonly surplusPortions: number | undefined;
  readonly totalCost: number | undefined;
  readonly pricePerPortion: number | undefined;
  /** Price per kg, per l or per piece of the pack as purchased. */
  readonly unitPrice: number | undefined;
}

/**
 * How many portions a pack yields, how many packs a service needs, and what a
 * portion costs.
 *
 * **Mass and volume are never interconverted**, in either direction: that needs
 * a density which is a property of the ingredient, not a constant. A pack in
 * litres against a portion in grams is refused.
 *
 * `pricePerPortion = packPrice / portionsPerPack` charges the leftover to the
 * portions that were actually served, which is the conservative reading and the
 * one a costing needs.
 *
 * A portion larger than the usable content is refused rather than answered with
 * zero: „0 portions" would make the packs needed and the portion price a
 * division by zero, and the user needs to know it is the portion that does not
 * fit, not the arithmetic that failed.
 */
export function portionsFromPack(input: PortionsFromPackInput): ProResult<PortionsFromPack> {
  // Indexed before it is checked, and `Record<PackUnit, …>` indexed by a
  // `PackUnit` is believed by TypeScript to be defined — so `noUncheckedIndexedAccess`
  // does not force the check here and `.dimension` on `undefined` throws. The
  // union is a compile-time claim; the table is the runtime fact.
  if (!isKeyOf(input.packUnit, PACK_UNITS)) return fail("packUnit");
  if (!isKeyOf(input.portionUnit, PACK_UNITS)) return fail("portionUnit");
  const pack = PACK_UNITS[input.packUnit];
  const portion = PACK_UNITS[input.portionUnit];
  if (pack.dimension !== portion.dimension) return fail("unitMismatch");
  if (!isPositive(input.packQuantity)) return fail("packQuantity");
  if (!isPositive(input.portionQuantity)) return fail("portionQuantity");
  if (pack.dimension === "count") {
    if (!Number.isInteger(input.packQuantity)) return fail("packQuantity");
    if (!Number.isInteger(input.portionQuantity)) return fail("portionQuantity");
  }
  if (!isNonNegative(input.lossPercent) || input.lossPercent >= 100) return fail("lossPercent");
  const needed = input.portionsNeeded;
  if (needed !== undefined && !isIntegerIn(needed, 1, 1000000)) return fail("portionsNeeded");
  const price = input.packPrice;
  if (price !== undefined && !isNonNegative(price)) return fail("packPrice");

  const packBase = input.packQuantity * pack.base;
  const portionBase = input.portionQuantity * portion.base;
  const usable = packBase * (1 - input.lossPercent / 100);
  const { portions: portionsPerPack, leftover } = usablePortions(usable, portionBase);
  if (portionsPerPack < 1) return fail("portionLargerThanPack");
  const packsNeeded = needed === undefined ? undefined : ceilSnapped(needed / portionsPerPack);
  const pricingQuantity =
    pack.dimension === "count" ? input.packQuantity : packBase / PER_KILO;

  return {
    ok: true,
    portionsPerPack,
    leftover: leftover / pack.base,
    yieldPercent: 100 - input.lossPercent,
    packsNeeded,
    surplusPortions:
      packsNeeded === undefined || needed === undefined
        ? undefined
        : packsNeeded * portionsPerPack - needed,
    totalCost: packsNeeded === undefined || price === undefined ? undefined : packsNeeded * price,
    pricePerPortion: price === undefined ? undefined : price / portionsPerPack,
    unitPrice: price === undefined ? undefined : price / pricingQuantity,
  };
}

/* -------------------------------------------------------------------------- */
/* ratio-split                                                                 */
/* -------------------------------------------------------------------------- */

export interface ParsedRatio {
  readonly parts: readonly number[];
}

/**
 * „3:2:1" as numbers, with a decimal comma accepted.
 *
 * The refusal is the key `ratio` and not the offending text: `@nexus/core` holds
 * no user-facing strings, and the surface already has the text it passed in.
 */
export function parseRatio(text: string): ProResult<ParsedRatio> {
  const pieces = text.split(":");
  if (pieces.length < 2) return fail("ratio");
  const parts: number[] = [];
  for (const piece of pieces) {
    const trimmed = piece.trim().replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return fail("ratio");
    parts.push(Number(trimmed));
  }
  return { ok: true, parts };
}

export interface RatioSplitInput {
  readonly total: number;
  /** Two or more members, each >= 0 and at least one > 0. */
  readonly parts: readonly number[];
  /** Rounding step in the same unit, e.g. 1, 5, 0.1. The form presets 0.01. */
  readonly step?: number | undefined;
}

/** The step percentages are apportioned to, so a printed column sums to exactly 100.0%. */
const PERCENT_STEP = 0.1;

export interface RatioSplitRow {
  /** total × r_i / Σr, before any rounding. */
  readonly exact: number;
  /** On the step, after the largest-remainder correction. A zero-weight member is always exactly 0. */
  readonly amount: number;
  /** Share of the whole, %, largest-remainder apportioned to sum to exactly 100.0. */
  readonly share: number;
}

export interface RatioSplitResult {
  readonly rows: readonly RatioSplitRow[];
  /** The printed amounts added up — at most `total`, and equal to it when `total` is a multiple of `step`. */
  readonly total: number;
  /**
   * `total` minus the amounts actually printed — the part no whole number of
   * steps can express. Zero whenever `total` divides evenly by `step`.
   * Printed as its own line rather than folded into a part, because a division
   * that leaves 20 g over 30 g steps has nowhere honest to put that 20 g as
   * „amount".
   */
  readonly unallocated: number;
}

/**
 * A quantity divided by a ratio, rounded so the printed column still adds up.
 *
 * **Largest-remainder (Hare), not per-part rounding.** Three equal parts of
 * 1000 g rounded independently to whole grams give 999 g, and a user who weighs
 * out the column is a gram short with no idea where it went. The residue is
 * handed to the parts with the largest fractional remainder, ties broken by the
 * order they were typed, so the answer is deterministic and reproducible.
 *
 * **The target is `floor(total/step)` steps, not `round(total/step)`.** 110 g
 * split 1:1 on a 30 g step has an exact half-share of 55 g = 1.833 steps per
 * part; rounding the TOTAL first (round(110/30) = 4 steps) asks for more steps
 * than either part's own floor can supply without inventing a step from
 * nothing, and printed 60 g + 60 g = 120 g, more than was ever there. Flooring
 * the total instead bounds the distributed steps by what the parts actually
 * contain, and whatever step's worth is left over is `unallocated`.
 *
 * A ratio member of exactly `0` never receives a bumped step: it stays exactly
 * zero, which is what „0" in a ratio means.
 *
 * Shares are apportioned by the SAME method onto a 0.1 step, so the printed
 * column sums to exactly 100.0% rather than 99.9% — the identical rounding
 * problem this whole function exists to solve, applied to itself.
 */
export function ratioSplit(input: RatioSplitInput): ProResult<RatioSplitResult> {
  const { total, parts } = input;
  if (!isPositive(total)) return fail("total");
  if (parts.length < 2) return fail("ratio");
  for (const part of parts) {
    if (!isNonNegative(part)) return fail("ratio");
  }
  const weight = parts.reduce((sum, part) => sum + part, 0);
  if (!isPositive(weight)) return fail("ratio");
  const step = input.step ?? 0.01;
  if (!isPositive(step)) return fail("step");
  if (step > total) return fail("step");

  const exact = parts.map((part) => (total * part) / weight);
  const amounts = largestRemainderSteps(exact, floorSnapped(total / step), step);
  const percents = parts.map((part) => (part / weight) * 100);
  const shares = largestRemainderSteps(percents, floorSnapped(100 / PERCENT_STEP), PERCENT_STEP);

  const rows: RatioSplitRow[] = parts.map((_part, index) => ({
    exact: exact[index] ?? 0,
    amount: amounts[index] ?? 0,
    share: shares[index] ?? 0,
  }));
  const printedTotal = roundHalfUp(rows.reduce((sum, row) => sum + row.amount, 0), 6);
  return { ok: true, rows, total: printedTotal, unallocated: roundHalfUp(total - printedTotal, 6) };
}

/* -------------------------------------------------------------------------- */
/* recipe-scale                                                                */
/* -------------------------------------------------------------------------- */

export interface ParsedQuantity {
  readonly value: number;
}

/**
 * „1 1/2", „1/2" or „1,5" as a number.
 *
 * Anything else is refused rather than repaired to zero — a silently zeroed
 * ingredient is the one scaling error nobody notices until the dough is on the
 * bench.
 */
export function parseQuantity(text: string): ProResult<ParsedQuantity> {
  const trimmed = text.trim();
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(trimmed);
  if (mixed !== null) {
    const [, whole, numerator, denominator] = mixed;
    if (whole === undefined || numerator === undefined || denominator === undefined) {
      return fail("quantity");
    }
    if (Number(denominator) === 0) return fail("quantity");
    return { ok: true, value: Number(whole) + Number(numerator) / Number(denominator) };
  }
  const fraction = /^(\d+)\/(\d+)$/.exec(trimmed);
  if (fraction !== null) {
    const [, numerator, denominator] = fraction;
    if (numerator === undefined || denominator === undefined) return fail("quantity");
    if (Number(denominator) === 0) return fail("quantity");
    return { ok: true, value: Number(numerator) / Number(denominator) };
  }
  const decimal = trimmed.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(decimal)) return fail("quantity");
  return { ok: true, value: Number(decimal) };
}

/** `other` is a spoon, a cup, a „dl" — scaled, never converted into anything else. */
export type RecipeUnit = "g" | "kg" | "ml" | "l" | "piece" | "other";

export type RecipeScaleMode = "portions" | "factor" | "targetMass";

const RECIPE_MASS_UNITS: Record<RecipeUnit, number | undefined> = {
  g: 1,
  kg: PER_KILO,
  ml: undefined,
  l: undefined,
  piece: undefined,
  other: undefined,
};

export interface RecipeLine {
  readonly name: string;
  /** Already a number: text like „1 1/2" goes through `parseQuantity` first. */
  readonly quantity: number;
  readonly unit: RecipeUnit;
  /**
   * This LINE's own rounding step, in its own unit. A single step cannot serve
   * a list that mixes grams, millilitres, whole pieces and spoons — „0.875
   * kašičica" is not a usable line, and a piece line wants a step of 1 while a
   * spice line wants 0.1 g. Absent falls back to `RecipeScaleInput.step`.
   *
   * Only `portions`/`factor` scaling honours a per-line step; `targetMass`
   * mode redistributes its residue on ONE shared step (see `recipeScale`),
   * since the exact-sum guarantee needs a common unit of adjustment across
   * every mass line.
   */
  readonly step?: number | undefined;
}

export interface RecipeScaleInput {
  readonly mode: RecipeScaleMode;
  readonly lines: readonly RecipeLine[];
  readonly originalPortions?: number | undefined;
  readonly targetPortions?: number | undefined;
  readonly factor?: number | undefined;
  /** Target total mass, g — only valid when every line is a mass. */
  readonly targetMass?: number | undefined;
  /** The default step, in each line's own unit, for a line with none of its own. Presets to 0.01. */
  readonly step?: number | undefined;
}

export interface RecipeScaleRow {
  readonly name: string;
  readonly unit: RecipeUnit;
  /** Scaled, before the step. */
  readonly quantity: number;
  /** On the step — and carrying the residue when this is the largest mass line. */
  readonly rounded: number;
  /** The same amount for reading: g becomes kg and ml becomes l above 1000. */
  readonly displayQuantity: number;
  readonly displayUnit: RecipeUnit;
  /**
   * This line's own rounded mass over the recipe's total mass, % — the printed
   * amounts, largest-remainder apportioned onto a 0.1 step so the column sums
   * to exactly 100.0 the same way `ratioSplit`'s own share column does.
   * Undefined whenever a share needs a common dimension the recipe does not
   * have: any volume, count or `other` line makes `totalMass` itself undefined,
   * and a total that costs nothing (every line at zero quantity) has no shares
   * either, per the same convention `plateCost` uses.
   */
  readonly share: number | undefined;
}

export interface RecipeScaleResult {
  readonly factor: number;
  readonly rows: readonly RecipeScaleRow[];
  /** Sum of the rounded mass lines, g. Undefined when any line is not a mass. */
  readonly totalMass: number | undefined;
}

/**
 * A whole ingredient list moved to another number of portions, a factor, or a
 * target total mass.
 *
 * **Units are never converted between mass and volume**, because that needs a
 * density per ingredient. `other` exists for the spoons and „dl" of a written
 * recipe: they scale like anything else and convert to nothing.
 *
 * **The exact-sum residue in target-total-mass mode is apportioned by the SAME
 * largest-remainder distributor `ratioSplit` uses**, replacing the earlier
 * „give it all to the biggest line" rule this pack's review found disagreeing
 * with `ratioSplit`'s own answer for the identical rounding problem — one
 * distributor now serves every exact-sum mode in the pack. A user who wants
 * the ratio-NOTATION surface of the retired standalone tool — typing „3:2:1"
 * as text — gets the same numbers by typing the ratio's parts as this
 * function's own lines, or by using `parseRatio` and `ratioSplit` directly,
 * which already own that parsing; a second parser here would be the very
 * „four copies of the arithmetic" defect this pack's distributor consolidation
 * exists to prevent. What this function DOES print, on every line, is that
 * line's own share of the recipe's total mass — the percentage half of the
 * absorbed tool's job — using the same distributor so the column sums to
 * exactly 100.0%.
 */
export function recipeScale(input: RecipeScaleInput): ProResult<RecipeScaleResult> {
  const { lines } = input;
  if (lines.length === 0) return fail("lines");
  for (const line of lines) {
    if (!isNonNegative(line.quantity)) return fail("lineQuantity");
    if (line.step !== undefined && !isPositive(line.step)) return fail("lineStep");
  }
  const defaultStep = input.step ?? 0.01;
  if (!isPositive(defaultStep)) return fail("step");

  let factor: number;
  let targetMass: number | undefined;
  if (input.mode === "portions") {
    const original = input.originalPortions;
    const target = input.targetPortions;
    if (original === undefined || !isIntegerIn(original, 1, 1000000)) {
      return fail("originalPortions");
    }
    if (target === undefined || !isIntegerIn(target, 1, 1000000)) return fail("targetPortions");
    factor = target / original;
  } else if (input.mode === "factor") {
    const typed = input.factor;
    if (typed === undefined || !isPositive(typed)) return fail("factor");
    factor = typed;
  } else {
    targetMass = input.targetMass;
    if (targetMass === undefined || !isPositive(targetMass)) return fail("targetMass");
    let sum = 0;
    for (const line of lines) {
      const grams = RECIPE_MASS_UNITS[line.unit];
      // A volume or a count in the column makes „total mass" a claim the tool
      // cannot support without a density.
      if (grams === undefined) return fail("unitMismatch");
      sum += line.quantity * grams;
    }
    if (!isPositive(sum)) return fail("lines");
    factor = targetMass / sum;
  }

  const scaled = lines.map((line) => line.quantity * factor);
  let rounded: number[];
  if (targetMass !== undefined) {
    // One shared step for every line: the exact-sum guarantee needs a common
    // unit of adjustment, which a per-line step cannot offer across lines in
    // different units.
    const gramsPerLine = lines.map(
      (line, index) => (scaled[index] ?? 0) * (RECIPE_MASS_UNITS[line.unit] ?? 1),
    );
    rounded = largestRemainderSteps(
      gramsPerLine,
      roundHalfUp(targetMass / defaultStep, 0),
      defaultStep,
    ).map((grams, index) => grams / (RECIPE_MASS_UNITS[lines[index]?.unit ?? "g"] ?? 1));
  } else {
    rounded = lines.map((line, index) =>
      roundToStep(scaled[index] ?? 0, line.step ?? defaultStep),
    );
  }

  const massOnly = lines.every((line) => RECIPE_MASS_UNITS[line.unit] !== undefined);
  const gramsPerRow = massOnly
    ? rounded.map((value, index) => value * (RECIPE_MASS_UNITS[lines[index]?.unit ?? "g"] ?? 1))
    : undefined;
  const totalMass = gramsPerRow?.reduce((sum, value) => sum + value, 0);
  // Shares go through the SAME largest-remainder distributor `ratioSplit` uses
  // for its own share column, onto the same 0.1 step, so this column also sums
  // to exactly 100.0% rather than 99.9%. A recipe with no mass at all (every
  // line at zero) has no shares, the same convention `plateCost` uses for a
  // recipe that costs nothing.
  const shares =
    gramsPerRow !== undefined && totalMass !== undefined && totalMass > 0
      ? largestRemainderSteps(
          gramsPerRow.map((grams) => (grams / totalMass) * 100),
          floorSnapped(100 / PERCENT_STEP),
          PERCENT_STEP,
        )
      : undefined;

  const rows: RecipeScaleRow[] = lines.map((line, index) => {
    const value = rounded[index] ?? 0;
    const scalesUp =
      (line.unit === "g" || line.unit === "ml") && value >= PER_KILO;
    return {
      name: line.name,
      unit: line.unit,
      quantity: scaled[index] ?? 0,
      rounded: value,
      displayQuantity: scalesUp ? value / PER_KILO : value,
      displayUnit: scalesUp ? (line.unit === "g" ? "kg" : "l") : line.unit,
      share: shares?.[index],
    };
  });

  return { ok: true, factor, rows, totalMass };
}

/* -------------------------------------------------------------------------- */
/* solution-concentration — LIFE SAFETY: quantities only, never a verdict       */
/* -------------------------------------------------------------------------- */

export type SolutionMode = "blend" | "blendAddSecond" | "dilute" | "concentrate" | "addSolute";

export interface SolutionInput {
  readonly mode: SolutionMode;
  /**
   * Concentration of what you start from, % BY MASS — never % by volume (ABV)
   * and never a mass/volume reading. Converting either of those into percent
   * by mass needs a density this tool does not carry, so both are refused by
   * construction: there is no field for them, only for a mass-basis percent.
   */
  readonly c1: number;
  /** Concentration of the second component, % by mass — `blend`/`blendAddSecond`. */
  readonly c2?: number | undefined;
  /** Where you want to end up, % by mass. */
  readonly targetConcentration: number;
  /** The mass you start from, g — every mode except `blend`. */
  readonly mass?: number | undefined;
  /** Total mass to end up with, g — `blend` only. */
  readonly targetMass?: number | undefined;
  /**
   * A limit of the user's own, % by mass. No default and no embedded maximum:
   * which rule applies, and to what, is not something this app can know.
   */
  readonly concentrationLimit?: number | undefined;
}

export interface SolutionResult {
  /** Component 1 to weigh out, g — `blend` (given), `blendAddSecond` (echoes `mass`). */
  readonly componentMass1: number | undefined;
  /** Component 2 to weigh out or add, g — `blend`, `blendAddSecond`. */
  readonly componentMass2: number | undefined;
  /** Pure solvent to add, g — `dilute`. */
  readonly solventAdded: number | undefined;
  /** Solvent to drive off, g — `concentrate`. Assumes only the solvent evaporates. */
  readonly massRemoved: number | undefined;
  /** Pure solute to add, g — `addSolute`. */
  readonly soluteAdded: number | undefined;
  readonly totalMass: number;
  /**
   * Recomputed from the ROUNDED masses actually printed above (2 decimals),
   * not from the unrounded internal values — because those are the numbers
   * the user puts on the scale, and this check is a check on the batch, not
   * on the arithmetic.
   */
  readonly achievedConcentration: number;
  /** The achieved concentration over the user's own limit. A ratio, nothing more. */
  readonly concentrationRatio: number | undefined;
  /**
   * `c1 − c2` (or `target − c2` in `blendAddSecond`) as a plain number, printed
   * with no threshold and no verdict. This IS the formula's own divisor: as the
   * two concentrations converge, the same measurement error in c1 or c2 swings
   * the computed mass by more and more, and the number that shows that is this
   * one. `undefined` outside the two blend modes, which have no second
   * concentration to compare against.
   */
  readonly concentrationSpread: number | undefined;
}

/**
 * One mass balance, solved five ways: blend two to a target total, blend to a
 * target by adding only as much of the second component as needed, dilute,
 * concentrate, or add pure solute.
 *
 * **Solute mass is conserved in every mode**, and every formula here is that
 * single statement rearranged. `blendAddSecond` is the same balance solved for
 * `m2` given `m1` instead of for both given a target total — the shape most
 * recipes are actually in: a fixed amount of component 1 already on the
 * counter, and no target TOTAL mass in mind at all.
 *
 * **Percent BY MASS throughout, confirmed at the type, not just in prose.**
 * There is no field for percent by volume (ABV) or for a mass/volume reading —
 * both need a density this tool does not carry, and inventing one for a
 * `life-safety` tool is worse than refusing the input outright.
 *
 * **`achievedConcentration` is recomputed from the ROUNDED masses**, at 2
 * decimals, because those are the numbers that go on the scale — checking
 * against the unrounded internals would verify the arithmetic while saying
 * nothing about the batch that gets built from the printed numbers.
 *
 * A target outside the range the two inputs can reach is refused with the
 * reason; it is never quietly pulled to the nearest reachable value. And the
 * result is a set of quantities: whether a concentration is appropriate,
 * permitted or safe for any use is not a question this function answers.
 */
export function solutionConcentration(input: SolutionInput): ProResult<SolutionResult> {
  const { c1, targetConcentration: target } = input;
  if (!isInRange(c1, 0, 100)) return fail("c1");
  if (!isInRange(target, 0, 100)) return fail("targetConcentration");
  const r2 = (value: number): number => roundHalfUp(value, 2);

  let componentMass1: number | undefined;
  let componentMass2: number | undefined;
  let solventAdded: number | undefined;
  let massRemoved: number | undefined;
  let soluteAdded: number | undefined;
  let totalMass: number;
  let displayedSoluteMass: number;
  let concentrationSpread: number | undefined;

  if (input.mode === "blend") {
    const c2 = input.c2;
    const totalTarget = input.targetMass;
    if (c2 === undefined || !isInRange(c2, 0, 100)) return fail("c2");
    if (totalTarget === undefined || !isPositive(totalTarget)) return fail("targetMass");
    // Two components of the same strength make only that strength; the division
    // below would be by zero, and „blend them" would be an answer to a different
    // question.
    if (c1 === c2) return fail("equalConcentrations");
    if (target < Math.min(c1, c2) || target > Math.max(c1, c2)) return fail("targetOutOfRange");
    componentMass1 = r2((totalTarget * (target - c2)) / (c1 - c2));
    componentMass2 = r2(totalTarget - componentMass1);
    totalMass = componentMass1 + componentMass2;
    displayedSoluteMass = (componentMass1 * c1) / 100 + (componentMass2 * c2) / 100;
    concentrationSpread = c1 - c2;
  } else if (input.mode === "blendAddSecond") {
    // The same balance solved for m2 given a fixed m1: how much of component 2
    // to add to what is already on the counter, rather than to a target total
    // that has not been decided yet.
    const c2 = input.c2;
    const mass1 = input.mass;
    if (c2 === undefined || !isInRange(c2, 0, 100)) return fail("c2");
    if (mass1 === undefined || !isPositive(mass1)) return fail("mass");
    if (target === c2) return fail("equalConcentrations");
    if (!(target > Math.min(c1, c2) && target < Math.max(c1, c2))) return fail("targetOutOfRange");
    componentMass1 = mass1;
    componentMass2 = r2((mass1 * (c1 - target)) / (target - c2));
    totalMass = componentMass1 + componentMass2;
    displayedSoluteMass = (componentMass1 * c1) / 100 + (componentMass2 * c2) / 100;
    concentrationSpread = target - c2;
  } else {
    const mass = input.mass;
    if (mass === undefined || !isPositive(mass)) return fail("mass");
    if (input.mode === "dilute") {
      // c2 = 0 would need infinite solvent, and a target at or above c1 is not a
      // dilution at all.
      if (target <= 0 || target >= c1) return fail("targetConcentration");
      solventAdded = r2(mass * (c1 / target - 1));
      totalMass = mass + solventAdded;
      displayedSoluteMass = (mass * c1) / 100;
    } else if (input.mode === "concentrate") {
      // Only the SOLVENT is assumed to evaporate — the solute is assumed not
      // to be lost at all, which is what „concentrate" means here and nowhere
      // beyond it.
      if (c1 <= 0 || target <= c1) return fail("targetConcentration");
      massRemoved = r2(mass * (1 - c1 / target));
      totalMass = mass - massRemoved;
      displayedSoluteMass = (mass * c1) / 100;
    } else {
      // At c2 = 100 the denominator vanishes: no finite amount of solute makes a
      // mixture that is pure solute.
      if (target <= c1 || target >= 100) return fail("targetConcentration");
      soluteAdded = r2((mass * (target - c1)) / (100 - target));
      totalMass = mass + soluteAdded;
      displayedSoluteMass = (mass * c1) / 100 + soluteAdded;
    }
  }

  const achievedConcentration = (displayedSoluteMass / totalMass) * 100;
  return {
    ok: true,
    componentMass1,
    componentMass2,
    solventAdded,
    massRemoved,
    soluteAdded,
    totalMass,
    achievedConcentration,
    concentrationRatio: ratioAgainst(achievedConcentration, input.concentrationLimit),
    concentrationSpread,
  };
}

/* -------------------------------------------------------------------------- */
/* us-customary-kitchen-units                                                  */
/* -------------------------------------------------------------------------- */

export type UsSourceUnit =
  /** The exact US legal/customary cup: 1/16 of the US gallon, 236.5882365 ml. */
  | "usCupLegal"
  /** The rounded US cup used on nutrition labels and in many US recipes: 240 ml exactly. */
  | "usCupDeclared"
  /** The metric cup used in Australia, New Zealand and elsewhere: 250 ml exactly. */
  | "auNzCup"
  | "usFlOz"
  | "usTbsp"
  | "usTsp"
  | "usPint"
  | "usQuart"
  | "usGallon"
  | "impFlOz"
  | "impPint"
  | "impQuart"
  | "impGallon"
  | "metricTbsp"
  | "metricTsp"
  | "ozAvoirdupois"
  | "pound"
  | "degF"
  | "degC";

export type MetricTargetUnit = "ml" | "l" | "g" | "kg" | "degC" | "degF";

export type UnitDimension = "volume" | "mass" | "temperature";

/** A unit with a fixed size — everything except the two spoons and the two scales. */
type ScaleUnit = Exclude<UsSourceUnit, "degF" | "degC" | "metricTbsp" | "metricTsp">;

interface ScaleUnitFacts {
  readonly dimension: "volume" | "mass";
  /** Millilitres for a volume, grams for a mass. Exact by definition. */
  readonly perUnit: number;
}

/**
 * Exact millilitres and grams per unit.
 *
 * Every US volume is an exact fraction of the US gallon of 3.785411784 L, which
 * is 231 cubic inches with the inch fixed by the International Yard and Pound
 * Agreement (1959). Every imperial volume is an exact fraction of the imperial
 * gallon of 4.54609 L, Weights and Measures Act 1985 (United Kingdom),
 * Schedule 1. Mass: 1 lb = 453.59237 g exactly, same 1959 agreement.
 *
 * **„Cup" is three different units and a recipe that just says „cup" is not
 * naming one of them.** `usCupLegal` (236.5882365 ml, 1/16 US gallon) is the
 * exact customary unit; `usCupDeclared` (240 ml) is the rounded figure US
 * nutrition labels and many US recipes actually use; `auNzCup` (250 ml) is the
 * metric cup of Australia, New Zealand and other metric countries. Folding the
 * three into one „cup" with a silently chosen size is how this tool would be
 * wrong on a third of its own recipes without anyone able to catch it.
 *
 * `stone` is deliberately absent: it does not appear in a kitchen, and this
 * pack is a kitchen tool, not a general imperial-unit converter — see the
 * review note on this tool for why lb/g, oz/g and °F/°C stay even though they
 * overlap the everyday unit converter: a foreign recipe mixes all of these on
 * one page, and that overlap is deliberate rather than accidental scope creep.
 *
 * The factors are written out in full and applied ONCE: chaining
 * cup -> fl oz -> ml introduces a rounding the definitions do not have.
 */
const SCALE_UNITS: Record<ScaleUnit, ScaleUnitFacts> = {
  usGallon: { dimension: "volume", perUnit: 3785.411784 },
  usQuart: { dimension: "volume", perUnit: 946.352946 },
  usPint: { dimension: "volume", perUnit: 473.176473 },
  usFlOz: { dimension: "volume", perUnit: 29.5735295625 },
  usCupLegal: { dimension: "volume", perUnit: 236.5882365 },
  usCupDeclared: { dimension: "volume", perUnit: 240 },
  auNzCup: { dimension: "volume", perUnit: 250 },
  usTbsp: { dimension: "volume", perUnit: 14.78676478125 },
  usTsp: { dimension: "volume", perUnit: 4.92892159375 },
  impGallon: { dimension: "volume", perUnit: 4546.09 },
  impQuart: { dimension: "volume", perUnit: 1136.5225 },
  impPint: { dimension: "volume", perUnit: 568.26125 },
  impFlOz: { dimension: "volume", perUnit: 28.4130625 },
  pound: { dimension: "mass", perUnit: 453.59237 },
  ozAvoirdupois: { dimension: "mass", perUnit: 28.349523125 },
};

/** Every `UsSourceUnit` that has a fixed size in `SCALE_UNITS` — everything but the two spoons and the two temperatures. */
/**
 * Whether `unit` has a row in the scale table — asked of the table, not deduced
 * from the four units that do not.
 *
 * It used to be `unit !== "degF" && unit !== "degC" && …`, which narrows by
 * EXCLUSION: everything that is not one of the four named becomes a `ScaleUnit`,
 * including a string that is in no union at all. `SCALE_UNITS[that].perUnit`
 * then throws. A guard that says „not those" cannot establish „one of these".
 */
function isScaleUnit(unit: UsSourceUnit): unit is ScaleUnit {
  return isKeyOf(unit, SCALE_UNITS);
}

export interface UsUnitInput {
  readonly value: number;
  readonly from: UsSourceUnit;
  readonly to: MetricTargetUnit;
  /**
   * The metric tablespoon is a kitchen CONVENTION, not a defined unit — 15 ml in
   * Serbia, 20 ml in Australia — so its volume is typed in. The 15/5 preset
   * belongs to the form, which is where a preset can be seen and changed.
   */
  readonly tablespoonMl?: number | undefined;
  readonly teaspoonMl?: number | undefined;
}

export interface UsUnitResult {
  readonly value: number;
  readonly dimension: UnitDimension;
  /** ml or g per one source unit. Undefined for a temperature, whose relation is affine. */
  readonly factor: number | undefined;
}

/** The dimension of a source unit, or `undefined` for a unit that is not one. */
function sourceDimension(unit: UsSourceUnit): UnitDimension | undefined {
  if (unit === "degF" || unit === "degC") return "temperature";
  if (unit === "metricTbsp" || unit === "metricTsp") return "volume";
  return isScaleUnit(unit) ? SCALE_UNITS[unit].dimension : undefined;
}

/**
 * The dimension of a target unit — and `undefined` rather than „volume" for one
 * that names no unit. The final branch used to be an unconditional „volume", so
 * an unrecognised target matched a millilitre and skipped the /1000 that makes a
 * litre a litre.
 */
function targetDimension(unit: MetricTargetUnit): UnitDimension | undefined {
  if (unit === "degC" || unit === "degF") return "temperature";
  if (unit === "g" || unit === "kg") return "mass";
  return unit === "ml" || unit === "l" ? "volume" : undefined;
}

/**
 * One US customary or imperial kitchen unit into metric — and a flat refusal to
 * turn a volume into a mass.
 *
 * **A cup is not a weight.** A cup of flour and a cup of honey differ by more
 * than a factor of two, so a density table would be the tool inventing the one
 * number that matters. Cross-dimension requests are rejected before any
 * arithmetic runs.
 *
 * A US pint is 473.176473 ml and an imperial pint is 568.26125 ml. They share a
 * name and nothing else, which is why they are separate units here rather than
 * one unit with a „system" switch that somebody would eventually leave wrong.
 */
export function usCustomaryUnit(input: UsUnitInput): ProResult<UsUnitResult> {
  const dimension = sourceDimension(input.from);
  if (dimension === undefined) return fail("from");
  if (dimension !== targetDimension(input.to)) return fail("targetUnit");
  if (!Number.isFinite(input.value)) return fail("value");

  if (dimension === "temperature") {
    if (input.from === input.to) {
      return { ok: true, value: input.value, dimension, factor: undefined };
    }
    const value =
      input.from === "degF" ? ((input.value - 32) * 5) / 9 : (input.value * 9) / 5 + 32;
    return { ok: true, value, dimension, factor: undefined };
  }

  // A negative cup of anything is not a measurement.
  if (!isNonNegative(input.value)) return fail("value");
  let factor: number;
  if (input.from === "metricTbsp") {
    const spoon = input.tablespoonMl;
    if (spoon === undefined || !isPositive(spoon)) return fail("tablespoonMl");
    factor = spoon;
  } else if (input.from === "metricTsp") {
    const spoon = input.teaspoonMl;
    if (spoon === undefined || !isPositive(spoon)) return fail("teaspoonMl");
    factor = spoon;
  } else if (isScaleUnit(input.from)) {
    factor = SCALE_UNITS[input.from].perUnit;
  } else {
    return fail("from");
  }
  const base = input.value * factor;
  const value = input.to === "l" || input.to === "kg" ? base / PER_KILO : base;
  return { ok: true, value, dimension, factor };
}

/* -------------------------------------------------------------------------- */
/* yield-trim-cook                                                             */
/* -------------------------------------------------------------------------- */

export type YieldMode = "forward" | "inverse";

export interface YieldInput {
  readonly mode: YieldMode;
  /** As-purchased mass, g — `forward`. */
  readonly apMass?: number | undefined;
  /** Trimming yield, %, 0 < y1 <= 100. Measured by this kitchen on its own raw material. */
  readonly cleaningYield: number;
  /** Cooking yield, %, > 0 and allowed above 100: rice and pasta absorb water. */
  readonly cookingYield: number;
  /** Portion mass, cooked, g. */
  readonly portionMass: number;
  readonly portionsNeeded?: number | undefined;
  /** Price per kg of the raw material as purchased. */
  readonly pricePerKgAp?: number | undefined;
}

export interface YieldResult {
  readonly cleanedMass: number | undefined;
  readonly cookedMass: number | undefined;
  /** y1 × y2, in %. This pack's own convention: a kitchen measures what remains, not what left. */
  readonly combinedYield: number;
  /** `100 − combinedYield` — the paired loss figure, so „4% loss" and „96% yield" are never retyped as each other. */
  readonly combinedLossPercent: number;
  readonly portions: number | undefined;
  readonly leftover: number | undefined;
  /** As-purchased mass to buy, kg — `inverse`. */
  readonly apNeeded: number | undefined;
  readonly pricePerKgCooked: number | undefined;
  readonly pricePerPortion: number | undefined;
}

/**
 * From as-purchased to portions on the pass, through trimming and cooking — and
 * back again.
 *
 * **A yield above 100% is accepted for the cooking step and refused for the
 * trimming step.** Absorption genuinely adds mass (dry rice more than doubles);
 * trimming cannot, so `y1 > 100` is an input error rather than an unusual
 * ingredient.
 *
 * **Costing divides by the combined yield, and that is where kitchens lose
 * money.** One kilogram of cooked product consumes 1/y kilograms of purchase, so
 * at 61.5% combined yield a 1200/kg purchase is 1951.22 per kilogram on the
 * plate.
 *
 * The tool holds no yield table of any kind. A yield depends on the supplier,
 * the season, the cut and the cook; publishing one would be inventing data.
 *
 * **Shares its floor/leftover engine with `portionsFromPack`** (`usablePortions`):
 * the two tools are the same skeleton — usable quantity, floor to whole
 * portions, print the leftover — asked from two different directions (a yield
 * question here, an ordering question there), and the review of this pack
 * found them computing that skeleton twice, which is exactly how the two would
 * eventually round differently by accident.
 */
export function yieldTrimCook(input: YieldInput): ProResult<YieldResult> {
  const { cleaningYield, cookingYield, portionMass } = input;
  if (!isPositive(cleaningYield) || cleaningYield > 100) return fail("cleaningYield");
  if (!isPositive(cookingYield)) return fail("cookingYield");
  if (!isPositive(portionMass)) return fail("portionMass");
  const price = input.pricePerKgAp;
  if (price !== undefined && !isNonNegative(price)) return fail("pricePerKgAp");
  const combined = (cleaningYield / 100) * (cookingYield / 100);

  let cleanedMass: number | undefined;
  let cookedMass: number | undefined;
  let portions: number | undefined;
  let leftover: number | undefined;
  let apNeeded: number | undefined;

  if (input.mode === "forward") {
    const ap = input.apMass;
    if (ap === undefined || !isPositive(ap)) return fail("apMass");
    cleanedMass = (ap * cleaningYield) / 100;
    cookedMass = (cleanedMass * cookingYield) / 100;
    // A portion bigger than the whole cooked mass is zero portions and the whole
    // mass as leftover — an honest answer, not an error. The same floor/leftover
    // engine `portionsFromPack` uses, so the two never round differently.
    ({ portions, leftover } = usablePortions(cookedMass, portionMass));
  } else {
    const needed = input.portionsNeeded;
    if (needed === undefined || !isIntegerIn(needed, 1, 1000000)) return fail("portionsNeeded");
    apNeeded = (needed * portionMass) / combined / PER_KILO;
  }

  return {
    ok: true,
    cleanedMass,
    cookedMass,
    combinedYield: combined * 100,
    combinedLossPercent: 100 - combined * 100,
    portions,
    leftover,
    apNeeded,
    pricePerKgCooked: price === undefined ? undefined : price / combined,
    pricePerPortion:
      price === undefined ? undefined : (price * (portionMass / PER_KILO)) / combined,
  };
}
