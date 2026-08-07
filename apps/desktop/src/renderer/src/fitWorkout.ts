import { sessionTonnage } from "@nexus/core";
import type { LoggedSet, ProgressSet, TonnageTotal } from "@nexus/core";
import type {
  ExerciseMetric,
  FitExerciseOption,
  FitLastPerformed,
  FitRoutine,
  FitWorkout,
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
 * Every set of every session, flattened and stamped with the DAY of the session
 * it belongs to — the shape `@nexus/core`'s progression arithmetic reads.
 *
 * The day comes from the WORKOUT and never from the set: a set has no day of its
 * own (migration 060), and a session back-dated to last Tuesday moves all of its
 * sets with it, which is the whole point of being able to back-date one.
 *
 * Unfinished sessions are dropped. „Napredak" is about training that happened;
 * a session still open is one in the middle of happening, and letting it into a
 * weekly total would make this week's figure climb while somebody is still in
 * the gym and then be compared against completed weeks.
 */
export function progressSets(workouts: readonly FitWorkout[]): ProgressSet[] {
  const out: ProgressSet[] = [];
  for (const workout of workouts) {
    if (workout.endedAt === null) continue;
    for (const set of workout.sets) {
      out.push({
        exerciseRef: set.exerciseRef,
        label: set.label,
        day: workout.day,
        kind: set.kind,
        metric: set.metric,
        primaryMuscles: set.primaryMuscles,
        weightKg: set.weightKg,
        reps: set.reps,
        seconds: set.seconds,
      });
    }
  }
  return out;
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
  readonly target: SessionTarget | null;
  /**
   * The rest THIS line prescribes, in seconds, or `null` for a line that
   * prescribes none.
   *
   * Not part of `target`, because it is not something you do — it is the gap
   * between two things you do, and `targetText` must never read it out as if
   * it were part of the set. Zero is a real prescription („nema odmora,
   * superserija") and is not the same as `null`, which means the line says
   * nothing and the session's own preset applies.
   */
  readonly restSeconds: number | null;
  /** In the order they were logged. Empty for a routine line nobody has started yet. */
  readonly sets: readonly FitWorkoutSet[];
}

/**
 * Everything a routine line prescribes ABOUT A SET, in the shape `targetText`
 * reads.
 *
 * Every field is stated rather than optional, and that is deliberate: this is
 * built from a `FitRoutineItem`, which always carries all six columns
 * (migration 061), so `null` here always means „the user set no target" and
 * never „this code forgot to copy the field across". `RoutineLineTarget` in
 * `fitWorkoutCopy.ts` keeps four of them optional because it also serves the
 * routine EDITOR, where a line being built genuinely has not decided yet.
 */
export interface SessionTarget {
  readonly sets: number | null;
  readonly repsMin: number | null;
  readonly repsMax: number | null;
  readonly seconds: number | null;
  readonly weightKg: number | null;
  readonly distanceM: number | null;
  readonly metric: ExerciseMetric | null;
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
      // The line's METRIC travels with its targets rather than the set's,
      // because the targets were written against it: a line prescribing „45 s"
      // is a line whose metric was `time` when somebody typed it, and reading
      // those seconds through a corrected `weight_reps` metric would print a
      // hold as a weight.
      target: {
        sets: item.targetSets,
        repsMin: item.targetRepsMin,
        repsMax: item.targetRepsMax,
        seconds: item.targetSeconds,
        weightKg: item.targetWeightKg,
        distanceM: item.targetDistanceM,
        metric: item.metric,
      },
      restSeconds: item.restSeconds,
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
      restSeconds: null,
      sets: logged,
    });
  }

  for (const option of added) {
    push({
      ref: option.ref,
      label: option.name,
      metric: option.metric,
      target: null,
      restSeconds: null,
      sets: [],
    });
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
 * What ONE target field asks for, as a number the log form can start from, or
 * `null` where the line asks for nothing.
 *
 * The rep answer is the LOWER bound. A range is a commitment with a floor and a
 * ceiling, and the floor is the number that is always meaningful on its own —
 * „bar osam" is an instruction, „najviše dvanaest" is not one you can start
 * from. Where only the ceiling was written it is used, because one stated bound
 * beats an empty field either way.
 *
 * `weight` and `assist` both read `weightKg`, exactly as they both WRITE it —
 * the schema has one column for the kilograms and the sign lives in the metric
 * (`SetField`).
 */
function plannedValue(field: SetField, target: SessionTarget | null): number | null {
  if (target === null) return null;
  switch (field) {
    case "weight":
    case "assist":
      return target.weightKg;
    case "reps":
      return target.repsMin ?? target.repsMax;
    case "seconds":
      return target.seconds;
    case "distance":
      return target.distanceM;
  }
}

/**
 * What the log form for this exercise starts filled with — the module's single
 * most used interaction (ADR-081 §1.1), and now a THREE-rank rule rather than
 * two.
 *
 * Per FIELD, in order: **what was logged for it last** (this session's last set,
 * then the last finished session's — `prefillSet`), and failing that **what the
 * routine asks for**. What you actually did outranks what was planned, always:
 * the plan is where a session starts and the log is what happened, and a form
 * that re-suggested the plan after you had already gone heavier would be
 * arguing with you.
 *
 * The fallback is per field rather than per source on purpose. A set logged
 * before an exercise's metric was corrected can carry reps and no load; the
 * load then falls back to the plan instead of the whole prefill collapsing to
 * one source or the other.
 *
 * This is what closes migration 061's loop: „Rutine" could prescribe a hold, a
 * load and a distance, and until now the session never read any of them back,
 * which made a prescription a note to self rather than a plan the app runs.
 */
export function prefillValues(
  exercise: SessionExercise,
  lastTime: FitLastPerformed | undefined,
): Partial<Record<SetField, number>> {
  const metric = exercise.metric;
  if (metric === null) return {};
  const previous = prefillSet(exercise, lastTime);
  const values: Partial<Record<SetField, number>> = {};
  for (const field of SET_FIELDS[metric]) {
    const logged = previous === null ? null : previous[SET_FIELD_COLUMN[field]];
    // `null` is „this set does not record that quantity", not zero — and a
    // legitimate `weightKg: 0` (a pull-up with the belt off) must NOT fall
    // through to the plan, so the test is against null and never falsiness.
    const value = logged ?? plannedValue(field, exercise.target);
    if (value !== null) values[field] = value;
  }
  return values;
}

/**
 * How many sets counted against a prescription of N.
 *
 * WORKING sets only, and this is the whole reason the function exists rather
 * than `sets.length`: a warm-up is the ramp up to the work, so a routine asking
 * for three sets is asking for three WORKING ones, and counting the ramp would
 * let somebody finish „3/3" without having done a single one of them. It is the
 * same line `countsTowardVolume` draws in `@nexus/core` — restated here because
 * a progress figure and a volume figure disagreeing about what a set is would
 * be worse than either being wrong alone.
 *
 * Drop sets and sets to failure DO count: both are work, both are taken to or
 * past the point the prescription was about.
 */
export function workingSetCount(sets: readonly FitWorkoutSet[]): number {
  return sets.filter((set) => set.kind !== "warmup").length;
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
