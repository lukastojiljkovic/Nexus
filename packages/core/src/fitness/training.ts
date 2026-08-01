/**
 * FIT's training arithmetic: the four calculations every surface that reads a
 * workout shares, and — more importantly — what each of them refuses to answer.
 *
 * **Every function here answers `null` rather than a number it cannot stand
 * behind**, which is `calculators.ts`'s stated posture for exactly the same
 * reason: a surface should never have to decide what an `Infinity`, a `NaN` or a
 * plausible-looking zero was supposed to mean. A zero gets summed. A `null`
 * cannot be, so it has to be handled — which is the whole point.
 *
 * **Two things this module deliberately does NOT compute:**
 *
 * - **Calories burned.** Every offline estimate of it is a MET table multiplied
 *   by bodyweight and minutes, and the published spread between individuals at
 *   the same MET value is wider than the difference between the activities the
 *   table distinguishes. Printing „412 kcal" from that would be inventing data
 *   with three significant figures, and FIT's food half already refuses to ship
 *   a number nobody can re-check (`food.ts`, on `stated` sources). A user who
 *   wants the figure has a watch that measures heart rate; this app does not.
 * - **Body-fat percentage.** The skinfold and circumference formulas (Jackson–
 *   Pollock, the US Navy tape) carry a standard error around ±3–4 percentage
 *   points against a DXA scan — bigger than the change a person is trying to see
 *   over a training block. A number whose error bar is wider than the effect it
 *   is measuring is not a measurement, and the trend line it would draw would be
 *   measurement noise with a shape.
 *
 * Nothing here reads a clock, touches a DOM or imports `node:` anything.
 */

import type { ExerciseMetric } from "./exercise.js";

/**
 * What a set was: a real one, or a rehearsal.
 *
 * `working` is the ordinary set. `drop` is the tail of a drop set — the reps
 * done after the weight came off mid-set, logged as its own row because they
 * happened at a different load and the log would otherwise have to average two
 * weights into one that was never on the bar. `failure` is a working set taken
 * to failure, kept distinct because a program that prescribes it wants to see
 * where it was actually done. `warmup` is the one kind that does NOT count: the
 * ramp up to a working weight is preparation, and folding it into volume makes
 * a heavy day look like a big day.
 *
 * English keys, for `ExerciseMetric`'s reason — this is a structural
 * discriminant the arithmetic switches on, not a name in a Serbian dataset.
 */
export const SET_KINDS = ["warmup", "working", "drop", "failure"] as const;

export type SetKind = (typeof SET_KINDS)[number];

/**
 * One logged set, as the arithmetic needs to see it.
 *
 * **It carries its own `metric`** rather than being handed the exercise's,
 * because a logged set is a SNAPSHOT — the same decision a logged meal makes
 * about its macros (`food.ts`). If the catalogue later changes an exercise's
 * metric, the sets recorded under the old one must keep meaning what they meant;
 * a function that looked the metric up live would silently reinterpret a year of
 * history the day an entry was corrected.
 *
 * The four numbers are optional because which of them exist is exactly what the
 * metric decides. A missing number is „not recorded", never zero: `weighted_reps`
 * legitimately carries `weightKg: 0` (an unweighted pull-up on a day the belt
 * stayed off), so zero cannot double as absent.
 */
export interface LoggedSet {
  readonly kind: SetKind;
  readonly metric: ExerciseMetric;
  /** Kilograms. Total load for `weight_reps`/`weight_time`, ADDED load for `weighted_reps`, SUBTRACTED assistance for `assisted_reps`. */
  readonly weightKg?: number;
  readonly reps?: number;
  readonly seconds?: number;
  readonly distanceM?: number;
}

/** Whether a set of this kind counts toward volume. Everything but the warm-up does — see `SET_KINDS`. */
export function countsTowardVolume(kind: SetKind): boolean {
  return kind !== "warmup";
}

/**
 * The sets that count, in input order. Generic over anything carrying a `kind`,
 * so a caller can filter its own richer row type (a stored set with an id, a
 * draft in a form) without first stripping it down to a `LoggedSet` — the same
 * reason `searchFoods` is generic over `{ id, name }`.
 */
export function workingSets<T extends { readonly kind: SetKind }>(sets: readonly T[]): readonly T[] {
  return sets.filter((set) => countsTowardVolume(set.kind));
}

/**
 * The kilograms this set actually moved, or `null` when the question does not
 * apply to it.
 *
 * **Tonnage is defined for `weight_reps` and for nothing else**, and the „and
 * for nothing else" is the honest half:
 *
 * - `reps`, `weighted_reps`, `assisted_reps` — the load is the body, and this
 *   module does not know what the body weighs. Counting only the belt would
 *   bill five weighted pull-ups at +20 kg as 100 kg against a five-rep 100 kg
 *   squat's 500 kg, and summing the two would be adding two different
 *   quantities. Passing bodyweight in would fix the pull-up and not the push-up,
 *   which loads some fraction of the body that varies with the exercise and that
 *   nobody publishes — a per-entry leverage factor would be invented data.
 * - `time`, `weight_time` — nothing was moved a countable number of times. A
 *   40-second farmer's walk at 2 × 32 kg is 64 kg held; `64 × 40` is 2 560 kg·s,
 *   which is a different unit and not a tonnage.
 * - `distance_time` — a run's work is not kilograms.
 *
 * The answer is `null` rather than 0 because the two are different claims: 0
 * says „this set moved nothing", which is false about a plank and about a
 * pull-up alike, and a caller that summed it would print a total that quietly
 * omitted half the session with no sign it had. `sessionTonnage` is what turns
 * these refusals into something a screen can say out loud.
 *
 * Says nothing about `kind`: a warm-up set has a perfectly real tonnage, and
 * whether it should be counted is the aggregate's decision rather than this
 * one's.
 */
export function setTonnage(set: LoggedSet): number | null {
  if (set.metric !== "weight_reps") return null;
  const { weightKg, reps } = set;
  if (weightKg === undefined || reps === undefined) return null;
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps)) return null;
  if (weightKg < 0 || reps < 0) return null;
  return weightKg * reps;
}

/**
 * A session's tonnage together with its own coverage.
 *
 * The three counts are not diagnostics — they are what lets a surface write
 * „tonaža sa 14 od 18 serija" instead of implying the total covered everything.
 * A tonnage figure that silently drops the pull-ups and the plank is the exact
 * failure `setTonnage`'s `null` exists to prevent, and it would come straight
 * back if the aggregate reported only a number.
 */
export interface TonnageTotal {
  /** Kilograms, unrounded — rounding is the surface's own step, as everywhere else in FIT. */
  readonly kg: number;
  /** Counted sets: those that count toward volume AND have a tonnage. */
  readonly counted: number;
  /** Sets that count toward volume but have no tonnage — a plank, a run, a pull-up. */
  readonly uncounted: number;
  /** Warm-up sets, excluded before either of the two above. */
  readonly warmup: number;
}

/** The tonnage of every counting set with a tonnage, and how much of the session that was. */
export function sessionTonnage(sets: readonly LoggedSet[]): TonnageTotal {
  let kg = 0;
  let counted = 0;
  let uncounted = 0;
  let warmup = 0;
  for (const set of sets) {
    if (!countsTowardVolume(set.kind)) {
      warmup += 1;
      continue;
    }
    const tonnage = setTonnage(set);
    if (tonnage === null) {
      uncounted += 1;
      continue;
    }
    kg += tonnage;
    counted += 1;
  }
  return { kg, counted, uncounted, warmup };
}

/**
 * The two published one-rep-max formulas this module will use.
 *
 * - `epley` — `w × (1 + r/30)`.
 * - `brzycki` — `w × 36/(37 − r)`.
 */
export const ONE_RM_FORMULAS = ["epley", "brzycki"] as const;

export type OneRepMaxFormula = (typeof ONE_RM_FORMULAS)[number];

/**
 * Epley when nobody has chosen. It is the more common convention in lifting
 * software, and it is the one that stays finite everywhere — Brzycki's
 * denominator does not (see `ONE_RM_MAX_REPS`).
 */
export const ONE_RM_DEFAULT_FORMULA: OneRepMaxFormula = "epley";

/**
 * The most reps an estimate will accept — ten, and not as a round number.
 *
 * At exactly ten reps the two formulas AGREE: Epley gives `w × (1 + 10/30)` and
 * Brzycki gives `w × 36/27`, both of which are `4w/3`. Below ten they stay
 * within about four percent of each other. Above ten they part company fast —
 * at twenty reps Epley says `1.67w` and Brzycki says `2.12w`, a 27 % spread on
 * the same set — and Brzycki's denominator `37 − r` reaches zero at
 * thirty-seven reps and turns NEGATIVE beyond it, so a fifty-rep set of
 * push-ups would be handed a negative one-rep max.
 *
 * Ten is therefore the last rep count at which the published estimates still
 * describe the same lift. Past it there is no defensible number to print, and
 * this module prints none — the same posture `food.ts` takes when the Atwater
 * estimate cannot explain a food's calories: the estimate does not get to
 * pretend it is the measurement.
 */
export const ONE_RM_MAX_REPS = 10;

/**
 * An estimated one-rep max, with the working attached.
 *
 * The formula and the rep count travel WITH the number because two apps
 * disagreeing about the same set is otherwise unexplainable, and because a
 * 5-rep estimate and a 10-rep estimate deserve different amounts of trust from
 * whoever reads them. It is `LoanPlan`'s arrangement in `calculators.ts`, which
 * reports the monthly rate it used for exactly this reason: a figure that can be
 * checked rather than one that has to be trusted.
 */
export interface OneRepMaxEstimate {
  readonly kg: number;
  readonly formula: OneRepMaxFormula;
  /** The rep count the estimate was made from — 1 means it is not an estimate at all. */
  readonly reps: number;
}

/**
 * What `reps` at `weightKg` suggests a single rep would be, or `null` when
 * there is no answer worth printing.
 *
 * Refuses a non-positive or non-finite weight (there is nothing to extrapolate
 * from), a rep count that is not a whole number at least 1, and — the refusal
 * that matters — anything above `ONE_RM_MAX_REPS`. `null` rather than a thrown
 * error, matching `calculators.ts`: this is a question about a set the user
 * legitimately did, and „no estimate from a set of twenty" is an answer to show
 * them, not a bug to crash on.
 *
 * **A single rep returns the weight itself, whichever formula was asked for.**
 * Brzycki already does (`36/36`); Epley does not — `w × (1 + 1/30)` would report
 * a 100 kg single as a 103.3 kg maximum, which is an ESTIMATE of a number that
 * was actually measured. Handing back a figure the lifter never lifted, on the
 * one input where the true answer is known exactly, would be the worst thing
 * this function could do.
 */
export function estimateOneRepMax(
  weightKg: number,
  reps: number,
  formula: OneRepMaxFormula = ONE_RM_DEFAULT_FORMULA,
): OneRepMaxEstimate | null {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (!Number.isInteger(reps) || reps < 1 || reps > ONE_RM_MAX_REPS) return null;
  if (reps === 1) return { kg: weightKg, formula, reps };

  const kg = formula === "epley" ? weightKg * (1 + reps / 30) : (weightKg * 36) / (37 - reps);
  return { kg, formula, reps };
}

/** One day's reading of something measured daily — body weight, in the only use this has so far. */
export interface DailyReading {
  /** A bare "YYYY-MM-DD" day. */
  readonly day: string;
  readonly value: number;
}

/** A day, what was read on it, and the trend through it. */
export interface TrendPoint {
  readonly day: string;
  /** The reading itself — the dot the chart draws. A day read more than once carries the mean of its readings. */
  readonly value: number;
  /** The window's mean, or `null` when the window held fewer than `minSamples` days. */
  readonly average: number | null;
  /** How many READING DAYS the window held, this one included. */
  readonly samples: number;
}

/** The window body weight is read over: seven days, so a week's shape is one point rather than seven. */
export const BODY_WEIGHT_WINDOW_DAYS = 7;

/**
 * The fewest days a body-weight window may average. Two, because one reading
 * averaged with itself is the reading — a line drawn through it would look like
 * a trend and be the raw number wearing a trend's clothes.
 */
export const BODY_WEIGHT_MIN_SAMPLES = 2;

const MS_PER_DAY = 86_400_000;

/** A bare day key and nothing else — mirrors the shape `studyStats.ts` and `habitStreak.ts` parse. */
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A moving average through a daily series — the honest read of body weight,
 * which swings a kilogram or two a day on water and food alone. The raw readings
 * are drawn as dots and this line is drawn through them; neither replaces the
 * other, which is why every point carries both.
 *
 * **The window is CALENDAR days, not the last N entries, and that is the whole
 * design decision.** Nobody weighs themselves every morning. Over a series with
 * gaps, „the last seven entries" quietly stops meaning seven days: for someone
 * who steps on the scale twice a month it averages a quarter of a year and still
 * calls itself a weekly mean, and — worse — the window's real length changes
 * with how diligent the user was, so the line gets smoother exactly where the
 * data got thinner. A calendar window keeps „seven days" meaning seven days;
 * what changes with a gap is `samples`, which is reported rather than hidden.
 *
 * Below `minSamples` days in the window, `average` is `null` — the start of a
 * series has no trend yet, and drawing one from a single reading would be
 * drawing the reading twice.
 *
 * The output has one point per day that HAS a reading, in ascending day order.
 * Emitting a point for every calendar day in the range would mean inventing
 * readings for days nobody stepped on the scale.
 *
 * Rows with an unparseable day or a non-finite value are dropped, the way
 * `computeStreak` drops days it cannot read: one bad row is not a reason to
 * refuse a whole chart, and a `NaN` allowed through would poison every window it
 * touched. A day appearing twice is collapsed to the mean of its readings first,
 * so it weighs once — which is what makes `samples` countable as days.
 *
 * Throws on a nonsensical window, following `macrosFor`: the caller chooses the
 * window in code, so a zero-day one is a programming error, and answering an
 * empty series would hide it inside a blank chart.
 */
export function movingAverage(
  readings: readonly DailyReading[],
  windowDays: number,
  minSamples: number,
): readonly TrendPoint[] {
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new RangeError(`"windowDays" must be a whole number of at least 1 (got ${String(windowDays)}).`);
  }
  if (!Number.isInteger(minSamples) || minSamples < 1) {
    throw new RangeError(`"minSamples" must be a whole number of at least 1 (got ${String(minSamples)}).`);
  }

  const byDay = new Map<string, { sum: number; count: number }>();
  for (const reading of readings) {
    if (!isRealDay(reading.day) || !Number.isFinite(reading.value)) continue;
    const bucket = byDay.get(reading.day);
    if (bucket === undefined) {
      byDay.set(reading.day, { sum: reading.value, count: 1 });
      continue;
    }
    bucket.sum += reading.value;
    bucket.count += 1;
  }

  const days = [...byDay.entries()]
    .map(([day, bucket]) => ({ day, ms: utcDayMs(day), value: bucket.sum / bucket.count }))
    .sort((left, right) => left.ms - right.ms);

  const span = (windowDays - 1) * MS_PER_DAY;
  const points: TrendPoint[] = [];
  let first = 0;
  let sum = 0;
  for (let last = 0; last < days.length; last += 1) {
    const current = days[last]!;
    sum += current.value;
    while (days[first]!.ms < current.ms - span) {
      sum -= days[first]!.value;
      first += 1;
    }
    const samples = last - first + 1;
    points.push({
      day: current.day,
      value: current.value,
      average: samples >= minSamples ? sum / samples : null,
      samples,
    });
  }
  return points;
}

/** UTC midnight for a bare "YYYY-MM-DD" — mirrors `studyStats.ts`'s `utcDayMs`. */
function utcDayMs(dateKey: string): number {
  const [year, month, day] = dateKey.split("-");
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

/**
 * Whether this is a day that exists. The regex alone would accept „2026-02-30",
 * which `Date.UTC` silently rolls forward into March — the point would then be
 * labelled one day and positioned on another, which is worse than dropping it.
 */
function isRealDay(day: string): boolean {
  if (!DAY_KEY_RE.test(day)) return false;
  const ms = utcDayMs(day);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day;
}
