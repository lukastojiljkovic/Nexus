import type { ExerciseMetric, FitWorkoutSet } from "../../shared/ipc.js";
import { SET_FIELDS, type SetField } from "./fitWorkout.js";
import { numberFormat } from "./intl.js";
import { countUnit, strings } from "./strings.js";

/**
 * „Trening"'s words: the one place a set, a target or a refusal becomes text.
 *
 * It sits between `fitWorkout.ts` (which knows what a set IS and imports no
 * copy) and the three components that draw one. Three surfaces read a set — the
 * session list, the „prošli put" line and the history detail — and a set read
 * three ways is how „60 kg × 10" ends up written as „60x10" on one of them.
 *
 * **The metric decides the reading, and the reading comes from `SET_FIELDS`.**
 * Nothing here switches on the metric itself, so a metric added to the core
 * vocabulary gets a reading here for free rather than silently falling through
 * to a default that would print a plank as kilograms.
 */

/** Rest lengths the countdown offers, in seconds. Between 60 and 180 is what ADR-081 §7 describes; three minutes covers a heavy single. */
export const REST_PRESETS = [60, 90, 120, 180] as const;

/**
 * Any FIT figure as text — at most one decimal, grouped, in the ACTIVE locale
 * (`intl.ts`). Loads land on halves and quarters and nothing finer, a rep count
 * is whole anyway, and a body weight is read off a scale to a tenth: one
 * formatter serves all of them, which is why „Merenja" reads its figures
 * through this file too rather than minting a second `Intl.NumberFormat` that
 * would drift.
 */
function oneDecimal(): Intl.NumberFormat {
  return numberFormat({ minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

export function figureText(value: number): string {
  return oneDecimal().format(value);
}

/** A recorded quantity, or the em dash that says it was not recorded. Never a zero standing in for absent. */
function figure(value: number | null): string {
  return value === null ? strings.fitness.training.set.missing : oneDecimal().format(value);
}

/**
 * A count of sets with its Serbian noun agreed — „1 serija", „2 serije", „5
 * serija", and the teens as `many` throughout.
 *
 * One function for every place the section counts sets, because it is one noun.
 * Four hand-written copies would be four chances to write „2 serija", which is
 * the sort of thing that makes an app read as machine-made.
 */
export function setCountText(count: number): string {
  const u = strings.fitness.training.setsUnit;
  return `${String(count)} ${countUnit(count, u.one, u.few, u.many)}`;
}

/** A session's tonnage, whole kilograms and grouped — „4.280". Nothing finer: a tenth of a kilo beside a four-digit total is noise. */
export function tonnageText(kg: number): string {
  return oneDecimal().format(Math.round(kg));
}

/**
 * One field of a set as text, with its unit and — for the two loads that point
 * in opposite directions — its sign.
 *
 * `+` and `−` are the whole reason `assist` and `weight` are separate fields:
 * ten kilograms hung off a belt and ten kilograms of machine help are the same
 * column and the opposite fact, and a reading that dropped the sign would let a
 * lifter getting stronger and one getting weaker print identically.
 */
function fieldText(field: SetField, set: FitWorkoutSet): string {
  const s = strings.fitness.training.set;
  switch (field) {
    case "weight":
      // `weighted_reps` is load ADDED to a bodyweight movement, so it is signed;
      // `weight_reps` and `weight_time` are the whole load and are not.
      return set.metric === "weighted_reps"
        ? `${s.addedPrefix}${figure(set.weightKg)} ${s.unitKg}`
        : `${figure(set.weightKg)} ${s.unitKg}`;
    case "assist":
      return `${s.assistPrefix}${figure(set.weightKg)} ${s.unitKg}`;
    case "reps":
      return `${figure(set.reps)} ${s.unitReps}`;
    case "seconds":
      return `${figure(set.seconds)} ${s.unitSeconds}`;
    case "distance":
      return `${figure(set.distanceM)} ${s.unitMeters}`;
  }
}

/**
 * One logged set in a line: „60 kg × 10", „−15 kg × 8", „45 s", „400 m · 40 s".
 *
 * The separator says which relationship the two numbers are in. A load and a rep
 * count are MULTIPLIED — that product is the tonnage — so they take `×`.
 * Anything else is two facts about the same set and takes a middle dot, because
 * „400 m × 40 s" would be a quantity nobody has a name for.
 */
export function setText(set: FitWorkoutSet): string {
  const parts = SET_FIELDS[set.metric].map((field) => fieldText(field, set));
  const separator = SET_FIELDS[set.metric].includes("reps")
    ? ` ${strings.fitness.training.set.times} `
    : " · ";
  return parts.join(separator);
}

/**
 * Everything a routine line might prescribe, however much of it a given
 * caller actually knows. `SessionExercise["target"]` — sets and a rep range,
 * nothing else — is the narrow case this widens: „Rutine"'s own summary
 * passes every migration-061 target alongside the metric that says which of
 * them apply, so `targetText` can serve both without becoming two functions
 * that could read the same line two different ways.
 */
export interface RoutineLineTarget {
  readonly sets: number | null;
  readonly repsMin: number | null;
  readonly repsMax: number | null;
  readonly seconds?: number | null;
  readonly weightKg?: number | null;
  readonly distanceM?: number | null;
  /** Absent, or `null` for an unresolved reference, reads as sets-and-reps only — there is no `SET_FIELDS` entry to look up. */
  readonly metric?: ExerciseMetric | null;
}

/**
 * One target field's text, in the same units and with the same sign a LOGGED
 * set of it would print (`fieldText`) — a target and what will one day match
 * it have to read as the same quantity. Never called for `reps`: a target
 * range is two numbers, not the one this returns, and `targetText` keeps that
 * formatting to itself.
 */
function targetFieldText(
  field: Exclude<SetField, "reps">,
  target: RoutineLineTarget,
  metric: ExerciseMetric,
): string | null {
  const s = strings.fitness.training.set;
  switch (field) {
    case "weight":
      if (target.weightKg == null) return null;
      return metric === "weighted_reps"
        ? `${s.addedPrefix}${figureText(target.weightKg)} ${s.unitKg}`
        : `${figureText(target.weightKg)} ${s.unitKg}`;
    case "assist":
      return target.weightKg == null
        ? null
        : `${s.assistPrefix}${figureText(target.weightKg)} ${s.unitKg}`;
    case "seconds":
      return target.seconds == null ? null : `${figureText(target.seconds)} ${s.unitSeconds}`;
    case "distance":
      return target.distanceM == null ? null : `${figureText(target.distanceM)} ${s.unitMeters}`;
  }
}

/**
 * A routine line's target: „3 × 8–12", „3 serije", „8–12", „3 × 45 s",
 * „3 × 60 kg × 8–12".
 *
 * Every half is independently optional, because every one of them is a real
 * prescription on its own — „bench, koliko serija treba" and „raspon 8–12, ne
 * brojim serije" are both things people write down. An absent half is simply not
 * drawn; nothing here invents a bound the user did not set.
 *
 * Without a `metric` the reading is sets-and-reps only, exactly as before —
 * `SessionExercise["target"]` never carries one. WITH one, every field
 * `SET_FIELDS[metric]` names joins the reading, in that table's own order and
 * with its own separator (`×` where a rep count is one of the fields, `·`
 * where the fields are independent facts) — `setText`'s own rule for a
 * LOGGED set, so a plank's routine line and a plank's logged set agree on how
 * a hold is written, and a plank reads as its hold rather than as nothing.
 */
export function targetText(target: RoutineLineTarget | null): string {
  if (target === null) return "";
  const t = strings.fitness.training.target;
  const reps =
    target.repsMin !== null && target.repsMax !== null
      ? `${String(target.repsMin)}${t.repsRange}${String(target.repsMax)}`
      : target.repsMin !== null
        ? `${String(target.repsMin)}+`
        : target.repsMax !== null
          ? `≤${String(target.repsMax)}`
          : "";

  const metric = target.metric ?? null;
  const measure =
    metric === null
      ? reps
      : SET_FIELDS[metric]
          .map((field) => (field === "reps" ? reps : targetFieldText(field, target, metric)))
          .filter((text): text is string => text !== null && text !== "")
          .join(SET_FIELDS[metric].includes("reps") ? ` ${strings.fitness.training.set.times} ` : " · ");

  if (target.sets === null) return measure;
  // With a measure the sets read as a multiplier („3 × 8–12", „3 × 45 s");
  // alone they need their noun, because a bare „3" beside an exercise says
  // nothing.
  return measure === "" ? setCountText(target.sets) : `${String(target.sets)} × ${measure}`;
}

/**
 * Maps a store or IPC failure onto Serbian copy by matching the message the
 * store itself raised — `fitErrorMessage`'s shape in „Ishrana", and
 * `habitErrorMessage`'s before it.
 *
 * UX only. The store stays the authority on what is refused; nothing here
 * decides anything, and an unrecognised failure falls through to `fallback`
 * rather than being guessed at.
 *
 * **`fallback` is REQUIRED, and that is the whole point of the parameter.** It
 * used to be `t.exercises.actionError` — one sentence, „Radnja nije uspela.
 * Pokušaj ponovo." — for every caller. But the five messages below are the
 * RECOGNISED refusals, and a store failure that is not one of them is not
 * necessarily a nameless action: a set that would not save and a workout that
 * would not start are the two things a person does most here, and the caller
 * knows which one it was while this function does not. Two such sentences were
 * written for exactly that and both shipped unread — one for a set that would
 * not save („Serija nije upisana. Pokušaj ponovo.") and one for a workout that
 * would not start („Trening nije mogao da se započne. Pokušaj ponovo.") —
 * because the default answered for every caller and made the question
 * invisible. A default is what let that happen, so there is none.
 */
export function fitTrainingError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  const t = strings.fitness.training;
  if (message.includes("A session is already open")) return t.start.alreadyOpen;
  if (message.includes("another session is already open")) return t.history.reopenBlocked;
  if (message.includes("would resurrect a second open session")) return t.history.reopenBlocked;
  if (message.includes(`"primaryMuscles" must not be empty`)) return t.exercises.needsPrimary;
  if (message.includes(`"name" must`)) return t.exercises.invalidName;
  if (message.includes("names no exercise this build ships")) return t.routines.missingExercise;
  if (message.includes("No live exercise")) return t.routines.missingExercise;
  // The backstop for the range the routine form now catches before the round
  // trip. Kept as well as the client-side check, not instead of it: an
  // interchange import reaches the store without passing that form.
  if (message.includes("rep range that runs backwards")) return t.routines.invalidRange;
  return fallback;
}
