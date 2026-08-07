import { sessionTonnage } from "@nexus/core";
import type { LoggedSet, TonnageTotal } from "@nexus/core";
import type {
  ExerciseMetric,
  FitExerciseOption,
  FitLastPerformed,
  FitRoutine,
  FitWorkoutSet,
} from "../../shared/ipc.js";

/**
 * „Trening"'s pure half (FIT slice c): what a session IS, before anything draws
 * it.
 *
 * Four rules run through the whole file, and each of them is one of ADR-081 §1's
 * five points made into code rather than left to a component to remember:
 *
 * - **The metric decides the fields, and there is exactly one table saying so.**
 *   `SET_FIELDS` is that table. A form, a summary line and a „prošli put" row all
 *   read it, so a plank can never be offered kilograms on one surface and seconds
 *   on another. Copying this three ways is exactly the defect class the ledger
 *   calls „a rule written twice".
 * - **`assisted_reps` is not `weighted_reps` with a minus sign.** It carries its
 *   own field (`assist`) writing the same `weightKg` column, because assistance
 *   getting SMALLER is the improvement — and a progression indicator that did not
 *   know it would draw a lifter getting stronger as a lifter getting worse.
 * - **A missing number is „not recorded", never zero.** `weighted_reps`
 *   legitimately carries `weightKg: 0` (a pull-up on a day the belt stayed off),
 *   so a zero cannot double as absent anywhere in here.
 * - **Nothing is invented.** Tonnage comes from `@nexus/core`'s `sessionTonnage`
 *   together with its own coverage counts, so a total that covered fourteen of
 *   eighteen sets says so instead of implying it covered everything.
 *
 * Nothing here reads a clock of its own: `now` is passed in wherever time
 * matters, which is what makes the rest countdown testable at all.
 */

/**
 * The one input a set of a given metric needs, named by what it MEANS rather
 * than by which column it lands in.
 *
 * `weight` and `assist` both write `weightKg` — the schema has one column for
 * the kilograms on the bar — and they are two names because they are two
 * quantities: one is load added, the other is load taken away. The store keeps
 * both as a non-negative magnitude (migration 060), so the sign lives in the
 * metric and never in the number.
 */
export type SetField = "weight" | "assist" | "reps" | "seconds" | "distance";

/**
 * Which fields each metric records, in the order a form draws them — the load
 * first, then what was done with it.
 *
 * This is ADR-081 §3's table, and it is the module's single answer to „what does
 * one set of this record". Every closed metric appears; `Record` rather than a
 * lookup with a fallback, so a metric added to `@nexus/core` fails the build here
 * instead of quietly rendering as a set with no fields at all.
 */
export const SET_FIELDS: Readonly<Record<ExerciseMetric, readonly SetField[]>> = {
  weight_reps: ["weight", "reps"],
  reps: ["reps"],
  weighted_reps: ["weight", "reps"],
  assisted_reps: ["assist", "reps"],
  time: ["seconds"],
  weight_time: ["weight", "seconds"],
  distance_time: ["distance", "seconds"],
};

/** Which `FitWorkoutSet` number each field carries. `weight` and `assist` share one, deliberately — see `SetField`. */
export const SET_FIELD_COLUMN: Readonly<
  Record<SetField, "weightKg" | "reps" | "seconds" | "distanceM">
> = {
  weight: "weightKg",
  assist: "weightKg",
  reps: "reps",
  seconds: "seconds",
  distance: "distanceM",
};

/**
 * Whether a field counts whole things rather than measuring a quantity. Reps are
 * counted — „8,5 ponavljanja" is not a thing that happened — and so are the
 * seconds and metres this module records, which nobody times a plank or paces a
 * carry more finely than.
 *
 * Only the load is measured, because half-kilo plates exist.
 */
export function isWholeField(field: SetField): boolean {
  return field !== "weight" && field !== "assist";
}

/**
 * One logged set as `@nexus/core`'s arithmetic needs to see it.
 *
 * The wire's four numbers are `number | null` and `LoggedSet`'s are optional;
 * the difference is not cosmetic. `null` on the wire and „absent" in the
 * arithmetic are the same claim — this set does not record that quantity — and
 * this is the ONE place the two spellings meet, so nothing downstream has to
 * decide whether a `null` weight meant zero.
 */
export function toLoggedSet(set: FitWorkoutSet): LoggedSet {
  return {
    kind: set.kind,
    metric: set.metric,
    ...(set.weightKg === null ? {} : { weightKg: set.weightKg }),
    ...(set.reps === null ? {} : { reps: set.reps }),
    ...(set.seconds === null ? {} : { seconds: set.seconds }),
    ...(set.distanceM === null ? {} : { distanceM: set.distanceM }),
  };
}

/** A session's tonnage WITH its coverage — `@nexus/core`'s, never re-derived here. */
export function workoutTonnage(sets: readonly FitWorkoutSet[]): TonnageTotal {
  return sessionTonnage(sets.map((set) => toLoggedSet(set)));
}

/**
 * One exercise inside a session: what it is, what the routine asked for, and
 * every set logged against it so far.
 *
 * `metric` is `null` only for a routine line whose reference no longer resolves
 * (`FitRoutineItem`) — a line the page can still name and must not offer to log,
 * because there is nothing to say what one set of it would record.
 */
export interface SessionExercise {
  readonly ref: string;
  readonly label: string;
  readonly metric: ExerciseMetric | null;
  /** From the routine this session started from, or `null` for anything added by hand. */
  readonly target: {
    readonly sets: number | null;
    readonly repsMin: number | null;
    readonly repsMax: number | null;
  } | null;
  /** In the order they were logged. Empty for a routine line nobody has started yet. */
  readonly sets: readonly FitWorkoutSet[];
}

/**
 * The session's exercises, in the order the page lists them: **the routine's
 * shape first, then whatever else actually happened.**
 *
 * That order is the whole point of starting from a routine — the plan is the
 * page, and it stays in its own order whether or not a line has been touched yet.
 * Anything logged that the routine does not name (a substitution, an extra
 * movement, an ad-hoc session with no routine at all) follows in the order its
 * FIRST set was logged, which is the order it happened in.
 *
 * `added` is what the user picked from the exercise picker but has not logged
 * yet. It comes last for the same reason: it has not happened, and putting it
 * among the logged work would claim it had. An entry already present as a
 * routine line or a logged exercise is not repeated.
 *
 * The routine's `metric` and label are used for a line with no sets; the moment a
 * set exists the SET's snapshot wins, because that is what was actually lifted
 * (`FitWorkoutSet`). The two agree except across an exercise correction, and
 * across one the set is the truth.
 */
export function sessionExercises(
  sets: readonly FitWorkoutSet[],
  routine: FitRoutine | null,
  added: readonly FitExerciseOption[],
): SessionExercise[] {
  const byRef = new Map<string, FitWorkoutSet[]>();
  const loggedOrder: string[] = [];
  for (const set of sets) {
    const existing = byRef.get(set.exerciseRef);
    if (existing === undefined) {
      byRef.set(set.exerciseRef, [set]);
      loggedOrder.push(set.exerciseRef);
    } else {
      existing.push(set);
    }
  }

  const seen = new Set<string>();
  const out: SessionExercise[] = [];
  const push = (exercise: SessionExercise): void => {
    if (seen.has(exercise.ref)) return;
    seen.add(exercise.ref);
    out.push(exercise);
  };

  for (const item of routine?.items ?? []) {
    const logged = byRef.get(item.exerciseRef) ?? [];
    push({
      ref: item.exerciseRef,
      label: logged[0]?.label ?? item.label,
      metric: logged[0]?.metric ?? item.metric,
      target: {
        sets: item.targetSets,
        repsMin: item.targetRepsMin,
        repsMax: item.targetRepsMax,
      },
      sets: logged,
    });
  }

  for (const ref of loggedOrder) {
    const logged = byRef.get(ref) ?? [];
    const first = logged[0];
    if (first === undefined) continue;
    push({
      ref,
      label: first.label,
      metric: first.metric,
      target: null,
      sets: logged,
    });
  }

  for (const option of added) {
    push({ ref: option.ref, label: option.name, metric: option.metric, target: null, sets: [] });
  }

  return out;
}

/**
 * What the log form for this exercise should start filled with — the single most
 * used interaction in the module (ADR-081 §1.1), which is why it is a function
 * with a stated rule rather than a component's improvisation.
 *
 * In order: **the last set logged for it in THIS session**, because a second set
 * is nearly always the first one repeated; then **the last set of the last
 * FINISHED session it appeared in**, because the first set of the day is nearly
 * always where the last one left off; then nothing, because there is nothing to
 * know.
 *
 * The `kind` is deliberately NOT carried over. A warm-up prefilling the next set
 * as a warm-up would quietly keep a whole session out of every volume total, and
 * a form that defaults to the one kind that does not count is a trap. The caller
 * starts from `working` every time.
 */
export function prefillSet(
  exercise: SessionExercise,
  lastTime: FitLastPerformed | undefined,
): FitWorkoutSet | null {
  const thisSession = exercise.sets.at(-1);
  if (thisSession !== undefined) return thisSession;
  return lastTime?.sets.at(-1) ?? null;
}

/**
 * A rest countdown's remaining whole seconds, floored at zero — the negative
 * side is „it is over" rather than „it is overdue by nine seconds", which is a
 * number nobody set a rest timer to learn.
 *
 * An unparseable instant answers 0 for the same reason: a countdown that cannot
 * say how long is left is finished as far as the screen is concerned.
 */
export function restRemainingSeconds(endsAt: string, now: number): number {
  const ends = Date.parse(endsAt);
  if (!Number.isFinite(ends)) return 0;
  return Math.max(0, Math.ceil((ends - now) / 1000));
}

/**
 * One item moved one place up or down, or the list unchanged when it is already
 * at that end.
 *
 * Generic and here rather than inside the routine editor because ORDER IS
 * POSITION on this wire (`FitRoutineSaveRequest`): what this returns is what
 * gets written, so an off-by-one would silently reorder somebody's training
 * without any error to notice. That deserves a test more than a form does.
 */
export function movedByOne<T>(items: readonly T[], index: number, step: 1 | -1): T[] {
  const target = index + step;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const moved = next[index];
  const displaced = next[target];
  if (moved === undefined || displaced === undefined) return next;
  next[index] = displaced;
  next[target] = moved;
  return next;
}

/**
 * How long a session has been running, in whole minutes, or `null` when the
 * arithmetic cannot be done.
 *
 * `null` rather than 0 for a clock that ran backwards or an instant that will not
 * parse: a session showing „0 min" an hour in would be a lie, while a session
 * showing nothing is visibly a session whose length is not being claimed.
 */
export function elapsedMinutes(startedAt: string, now: number): number | null {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started) || now < started) return null;
  return Math.floor((now - started) / 60_000);
}
