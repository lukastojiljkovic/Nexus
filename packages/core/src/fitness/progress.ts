/**
 * FIT's progression arithmetic (ADR-081 §5): what a training log adds up to over
 * weeks, and — as everywhere in this module — what it refuses to add up.
 *
 * Three rules run through the file:
 *
 * - **Nothing is stored, everything is derived.** A personal record is computed
 *   from the sets every time it is read. A stored „PR" row and a set table can
 *   disagree, and only one of them is the truth; the ADR settles that the sets
 *   are.
 * - **Warm-ups are not volume.** Every aggregate here filters through
 *   `countsTowardVolume` first, which is the same scoping ADR-077's focus
 *   statistics had to be given after break rows silently inflated all four of
 *   them.
 * - **A record only exists where the question does.** „The heaviest set" is a
 *   real question about a bench press and a meaningless one about an assisted
 *   pull-up, where a bigger number is LESS work; „the longest hold" is real
 *   about a plank and not about a squat. Each record is `null` where its
 *   question does not apply, and the surface says nothing rather than printing a
 *   zero.
 *
 * Nothing here reads a clock, touches a DOM or imports `node:` anything.
 *
 * **A fourth aggregate used to live here and does not any more.** `oneRepMaxTrend`
 * returned one estimated-1RM point per day for a single exercise, and its doc
 * reasoned carefully about what a CHART would draw on a day with no defensible
 * estimate — but the chart was never built and nothing outside its own tests ever
 * called it. `estimateOneRepMax` (in `training.ts`) is the piece that is really
 * used: `exerciseRecords` reads it for the `bestOneRm` record, and FIT's exercise
 * detail shows that one number. When a trend chart is actually designed, it can be
 * written against the shape that chart needs rather than against a guess.
 */

import type { ExerciseMetric, MuscleGroup } from "./exercise.js";
import {
  countsTowardVolume,
  estimateOneRepMax,
  setTonnage,
  type OneRepMaxEstimate,
  type SetKind,
} from "./training.js";

/**
 * One logged set as the progression reads it: everything `LoggedSet` carries,
 * plus the three things an aggregate over MANY sessions needs — which exercise
 * it was, what that exercise was called at the time, and which day it happened
 * on.
 *
 * All three come off the stored row rather than being looked up: `exerciseRef`
 * and `label` are the set's own snapshot (migration 060), so a record keeps
 * naming the lift it was set on even after the exercise is renamed or deleted.
 */
export interface ProgressSet {
  readonly exerciseRef: string;
  readonly label: string;
  readonly day: string;
  readonly kind: SetKind;
  readonly metric: ExerciseMetric;
  readonly primaryMuscles: readonly MuscleGroup[];
  readonly weightKg: number | null;
  readonly reps: number | null;
  readonly seconds: number | null;
}

/** A record, and the day it was set on. The day is half the value of a record. */
export interface RecordAt<T> {
  readonly value: T;
  readonly day: string;
}

/**
 * What one exercise's best sets are.
 *
 * Every field is independently `null`, because which of these questions has an
 * answer is decided by the exercise's own `metric`:
 *
 * - `heaviest` — only where a bigger load is more work: `weight_reps`,
 *   `weighted_reps`, `weight_time`. **Never `assisted_reps`**, where the load is
 *   assistance and the number going DOWN is the improvement; a „heaviest
 *   assisted dip" would be the single most misleading figure this module could
 *   print.
 * - `bestOneRm` — only where `estimateOneRepMax` gives an answer, which is a
 *   pure `weight_reps` set of ten reps or fewer (`ONE_RM_MAX_REPS`). A
 *   `weighted_reps` set is deliberately excluded: the belt is not the load, the
 *   body is, and this module does not know what the body weighs.
 * - `mostReps` — wherever reps are counted at all.
 * - `longestHold` — wherever seconds are.
 *
 * `leastAssistance` is `assisted_reps`' own record and the reason that metric
 * exists: the least help you needed, which is the direction of progress there.
 */
export interface ExerciseRecords {
  readonly exerciseRef: string;
  /** The name the exercise carried on the day of the most recent of these sets. */
  readonly label: string;
  readonly metric: ExerciseMetric;
  readonly heaviest: RecordAt<{ readonly weightKg: number; readonly reps: number | null }> | null;
  readonly bestOneRm: RecordAt<OneRepMaxEstimate> | null;
  readonly mostReps: RecordAt<{ readonly reps: number; readonly weightKg: number | null }> | null;
  readonly longestHold: RecordAt<number> | null;
  readonly leastAssistance: RecordAt<{ readonly weightKg: number; readonly reps: number }> | null;
  /** How many counting sets these records were drawn from — what makes „prvi put" and „jedan set" tellable apart. */
  readonly sets: number;
}

/** Which metrics make „the heaviest set" a question about more work rather than less. */
const HEAVIEST_METRICS: readonly ExerciseMetric[] = ["weight_reps", "weighted_reps", "weight_time"];

/**
 * Every exercise's records, keyed by reference, over the sets given.
 *
 * The caller decides the window — a year, a block, everything — because „the
 * best ever" and „the best this block" are both real questions and neither is
 * more correct. Order is by the exercise's most recent counting set, newest
 * first: the list is read as „what have I been doing", not as an alphabet.
 *
 * Warm-ups never contribute, and an exercise with nothing but warm-ups is absent
 * rather than present with five nulls.
 */
export function exerciseRecords(sets: readonly ProgressSet[]): ExerciseRecords[] {
  const byRef = new Map<string, ProgressSet[]>();
  for (const set of sets) {
    if (!countsTowardVolume(set.kind)) continue;
    const bucket = byRef.get(set.exerciseRef);
    if (bucket === undefined) byRef.set(set.exerciseRef, [set]);
    else bucket.push(set);
  }

  const out: ExerciseRecords[] = [];
  for (const [exerciseRef, group] of byRef) {
    // The LATEST set decides both the display name and the sort position: an
    // exercise renamed in June should read as its June name everywhere, and the
    // list is „what have I been doing lately".
    const latest = group.reduce((best, set) => (set.day >= best.day ? set : best));

    let heaviest: ExerciseRecords["heaviest"] = null;
    let bestOneRm: ExerciseRecords["bestOneRm"] = null;
    let mostReps: ExerciseRecords["mostReps"] = null;
    let longestHold: ExerciseRecords["longestHold"] = null;
    let leastAssistance: ExerciseRecords["leastAssistance"] = null;

    for (const set of group) {
      const { weightKg, reps, seconds } = set;

      if (weightKg !== null && HEAVIEST_METRICS.includes(set.metric)) {
        if (heaviest === null || weightKg > heaviest.value.weightKg) {
          heaviest = { value: { weightKg, reps }, day: set.day };
        }
      }

      if (set.metric === "weight_reps" && weightKg !== null && reps !== null) {
        const estimate = estimateOneRepMax(weightKg, reps);
        if (estimate !== null && (bestOneRm === null || estimate.kg > bestOneRm.value.kg)) {
          bestOneRm = { value: estimate, day: set.day };
        }
      }

      if (reps !== null && (mostReps === null || reps > mostReps.value.reps)) {
        mostReps = { value: { reps, weightKg }, day: set.day };
      }

      if (seconds !== null && (longestHold === null || seconds > longestHold.value)) {
        longestHold = { value: seconds, day: set.day };
      }

      // LEAST, not most — and only when reps came with it, so „0 kg of help for
      // one rep" cannot beat „0 kg of help for eight" on a tie the arithmetic
      // cannot see.
      if (set.metric === "assisted_reps" && weightKg !== null && reps !== null) {
        if (
          leastAssistance === null ||
          weightKg < leastAssistance.value.weightKg ||
          (weightKg === leastAssistance.value.weightKg && reps > leastAssistance.value.reps)
        ) {
          leastAssistance = { value: { weightKg, reps }, day: set.day };
        }
      }
    }

    out.push({
      exerciseRef,
      label: latest.label,
      metric: latest.metric,
      heaviest,
      bestOneRm,
      mostReps,
      longestHold,
      leastAssistance,
      sets: group.length,
    });
  }

  return out.sort((left, right) => {
    const leftDay = latestDay(byRef.get(left.exerciseRef));
    const rightDay = latestDay(byRef.get(right.exerciseRef));
    if (leftDay !== rightDay) return leftDay < rightDay ? 1 : -1;
    return left.label.localeCompare(right.label, ["sr-Latn", "sr"]);
  });
}

function latestDay(group: readonly ProgressSet[] | undefined): string {
  let day = "";
  for (const set of group ?? []) if (set.day > day) day = set.day;
  return day;
}

/**
 * One week of training volume, in the TWO figures ADR-081 §5 refuses to
 * conflate.
 *
 * **Hard sets per muscle group** is the figure current training science actually
 * uses for hypertrophy and the one a person can act on („nothing pulled
 * vertically in three weeks"). **Tonnage** means something for the strength
 * lifts and nothing for the rest, so it travels with its own coverage exactly as
 * `sessionTonnage` does. An app that shows one number called „volume" is hiding
 * which of the two it picked.
 *
 * A set counts ONE toward each of its PRIMARY muscles and nothing toward its
 * secondaries. The snapshot carries only primaries (migration 060), and that is
 * the right vocabulary rather than a limitation: counting secondaries would bill
 * one bench press to chest, triceps and front delts alike, and every per-muscle
 * total in the app would read about twice the training that happened.
 */
export interface WeekVolume {
  /** The Monday of the week, as a bare day key. */
  readonly weekStart: string;
  readonly hardSets: Readonly<Partial<Record<MuscleGroup, number>>>;
  /** Total counting sets in the week, whatever muscles they billed. */
  readonly sets: number;
  readonly tonnageKg: number;
  /** Counting sets that HAVE a tonnage; the rest of `sets` had none. */
  readonly tonnageSets: number;
  /** Distinct days trained. */
  readonly days: number;
}

const MS_PER_DAY = 86_400_000;

/** A bare day key and nothing else — the shape every day-keyed read in this package parses. */
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Weekly volume, oldest week first, with a row for every week that HAS training
 * and no row for the weeks that do not.
 *
 * Empty weeks are absent rather than zero-filled for `rangeTotals`' reason: a
 * caller drawing a continuous axis fills its own gaps, where it also knows
 * whether it wants to say „nothing logged" or „nothing done". Those are
 * different facts and this function knows only the first.
 *
 * **Weeks start on MONDAY**, which is the Serbian week and the one the rest of
 * the app already uses. A week keyed by the ISO date of its Monday sorts
 * lexicographically, so nothing here needs a second ordering rule.
 */
export function weeklyVolume(sets: readonly ProgressSet[]): WeekVolume[] {
  const weeks = new Map<string, { hardSets: Map<MuscleGroup, number>; sets: number; kg: number; tonnageSets: number; days: Set<string> }>();

  for (const set of sets) {
    if (!countsTowardVolume(set.kind)) continue;
    const weekStart = mondayOf(set.day);
    if (weekStart === null) continue;
    let week = weeks.get(weekStart);
    if (week === undefined) {
      week = { hardSets: new Map(), sets: 0, kg: 0, tonnageSets: 0, days: new Set() };
      weeks.set(weekStart, week);
    }
    week.sets += 1;
    week.days.add(set.day);
    for (const muscle of set.primaryMuscles) {
      week.hardSets.set(muscle, (week.hardSets.get(muscle) ?? 0) + 1);
    }
    const tonnage = setTonnage({
      kind: set.kind,
      metric: set.metric,
      ...(set.weightKg === null ? {} : { weightKg: set.weightKg }),
      ...(set.reps === null ? {} : { reps: set.reps }),
    });
    if (tonnage !== null) {
      week.kg += tonnage;
      week.tonnageSets += 1;
    }
  }

  return [...weeks]
    .map(([weekStart, week]) => ({
      weekStart,
      hardSets: Object.fromEntries(week.hardSets) as Partial<Record<MuscleGroup, number>>,
      sets: week.sets,
      tonnageKg: week.kg,
      tonnageSets: week.tonnageSets,
      days: week.days.size,
    }))
    .sort((left, right) => (left.weekStart < right.weekStart ? -1 : 1));
}

/**
 * The Monday of the week a day falls in, or `null` for a day that does not
 * exist. UTC throughout, like every bare-date calculation in this package — a
 * local-time one would move a Sunday session into the previous week for half the
 * world.
 */
export function mondayOf(day: string): string | null {
  if (!DAY_KEY_RE.test(day)) return null;
  const [year, month, date] = day.split("-");
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(date));
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day) return null;
  // `getUTCDay` is 0 for Sunday; Monday-first means Sunday is six days into its
  // week, not the start of the next one.
  const weekday = new Date(ms).getUTCDay();
  const back = weekday === 0 ? 6 : weekday - 1;
  return new Date(ms - back * MS_PER_DAY).toISOString().slice(0, 10);
}
