import type { FitWorkoutSet } from "../../shared/ipc.js";
import { SET_FIELDS, type SessionExercise, type SetField } from "./fitWorkout.js";
import { countUnit, strings } from "./strings.js";

/**
 * „Trening"'s words: the one place a set, a target or a refusal becomes Serbian
 * text.
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
 * One number as text — at most one decimal, Serbian, grouped. Loads land on
 * halves and quarters and nothing finer, a rep count is whole anyway, and a body
 * weight is read off a scale to a tenth: one formatter serves all of them, which
 * is why „Merenja" reads its figures through this file too rather than minting a
 * second `Intl.NumberFormat` that would drift.
 */
const numberFormat = new Intl.NumberFormat("sr-Latn", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/** Any FIT figure as text. The one place a number in this module becomes something a person reads. */
export function figureText(value: number): string {
  return numberFormat.format(value);
}

/** A recorded quantity, or the em dash that says it was not recorded. Never a zero standing in for absent. */
function figure(value: number | null): string {
  return value === null ? strings.fitness.training.set.missing : numberFormat.format(value);
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
  return numberFormat.format(Math.round(kg));
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
 * A routine line's target: „3 × 8–12", „3 serije", „8–12".
 *
 * Every half is independently optional, because every one of them is a real
 * prescription on its own — „bench, koliko serija treba" and „raspon 8–12, ne
 * brojim serije" are both things people write down. An absent half is simply not
 * drawn; nothing here invents a bound the user did not set.
 */
export function targetText(target: SessionExercise["target"]): string {
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
  if (target.sets === null) return reps;
  // With a rep range the sets read as a multiplier („3 × 8–12"); alone they need
  // their noun, because a bare „3" beside an exercise says nothing.
  return reps === "" ? setCountText(target.sets) : `${String(target.sets)} × ${reps}`;
}

/**
 * Maps a store or IPC failure onto Serbian copy by matching the message the
 * store itself raised — `fitErrorMessage`'s shape in „Ishrana", and
 * `habitErrorMessage`'s before it.
 *
 * UX only. The store stays the authority on what is refused; nothing here
 * decides anything, and an unrecognised failure falls through to the generic
 * line rather than being guessed at.
 */
export function fitTrainingError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const t = strings.fitness.training;
  if (message.includes("A session is already open")) return t.start.alreadyOpen;
  if (message.includes("another session is already open")) return t.history.reopenBlocked;
  if (message.includes("would resurrect a second open session")) return t.history.reopenBlocked;
  if (message.includes(`"primaryMuscles" must not be empty`)) return t.exercises.needsPrimary;
  if (message.includes(`"name" must`)) return t.exercises.invalidName;
  if (message.includes("names no exercise this build ships")) return t.routines.missingExercise;
  if (message.includes("No live exercise")) return t.routines.missingExercise;
  return t.exercises.actionError;
}
