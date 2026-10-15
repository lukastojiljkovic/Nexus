/**
 * The trusted side of a logged food or set: turns a reference the caller named
 * into the label, the numbers and the metric the row is stamped with.
 *
 * This is the module's security boundary, and it lives here so the IPC handlers
 * in `main/index.ts` and the assistant's fitness tools draw it the same way. A
 * caller supplies a reference and a quantity; it never supplies macros, a metric
 * or a muscle list. Both take the store they resolve against, so a test runs the
 * real rule over a real database.
 */

import {
  EXERCISE_CATALOGUE,
  FOOD_CATALOGUE,
  catalogueExercise,
  catalogueFood,
  exerciseRefText,
  foodRefText,
  parseExerciseRef,
  parseFoodRef,
} from "@nexus/core";
import type {
  ExerciseEntry,
  ExerciseMetric,
  FoodEntry,
  FoodMacros,
  MuscleGroup,
} from "@nexus/core";
import type { FitExercise, FitExerciseStore, FitFood, FitFoodStore } from "@nexus/db";
import { mainLocale } from "../locale.js";

/**
 * Turns the reference the renderer sent into the label, the metric and the
 * muscle list the set (or routine item) will be stamped with. **The module's
 * security boundary** — see the block comment above.
 *
 * `catalogue:<slug>` is looked up in the app's own shipped data; a slug this
 * build no longer ships is refused rather than logged as a name with no meaning.
 * `user:<uuid>` goes through the exercise store, which answers only for a LIVE
 * exercise in THIS profile — so a soft-deleted exercise cannot be logged afresh,
 * while every set already logged with it stays exactly as it was.
 */
/**
 * A catalogue or user exercise's label in the language main is serving.
 *
 * A workout set and a routine item SNAPSHOT the name they were logged under, so
 * this is written at the moment of the write, in the language `mainLocale()`
 * holds — the same source the dialogs and notifications read. A user's own
 * exercise may carry no English name, in which case its own name stands.
 */
function localizedExerciseName(name: string, nameEn: string | undefined): string {
  return mainLocale() === "en" && nameEn !== undefined && nameEn.trim().length > 0 ? nameEn : name;
}

export function resolveLoggedExercise(
  exercises: FitExerciseStore,
  reference: unknown,
): { exerciseRef: string; label: string; metric: ExerciseMetric; primaryMuscles: MuscleGroup[] } {
  if (typeof reference !== "string") {
    throw new Error(`Invalid IPC payload: "exerciseRef" must be a string.`);
  }
  const parsed = parseExerciseRef(reference);
  if (parsed === null) {
    throw new Error(
      `Invalid IPC payload: "exerciseRef" must be "catalogue:<slug>" or "user:<id>".`,
    );
  }
  if (parsed.kind === "catalogue") {
    const entry = catalogueExercise(parsed.id);
    if (entry === undefined) {
      throw new Error(`Invalid IPC payload: "exerciseRef" names no exercise this build ships.`);
    }
    return {
      exerciseRef: reference,
      label: localizedExerciseName(entry.name, entry.nameEn),
      metric: entry.metric,
      primaryMuscles: [...entry.primaryMuscles],
    };
  }
  const own = exercises.get(parsed.id);
  return {
    exerciseRef: reference,
    label: localizedExerciseName(own.name, own.nameEn),
    metric: own.metric,
    primaryMuscles: own.primaryMuscles,
  };
}

/**
 * The same lookup `resolveLoggedExercise` performs, in the shape a READ needs:
 * it answers `null` instead of throwing, and it reads the profile's own
 * exercises ONCE for however many references the caller is about to resolve.
 *
 * Both differences are the difference between a write and a read.
 *
 * - **A write must refuse.** Logging a set against an exercise that does not
 *   exist would put a name with no meaning in the history, so
 *   `resolveLoggedExercise` throws and the act fails.
 * - **A read must not.** A routine is allowed to name an exercise the user
 *   deleted afterwards — nothing stops them, `exercise_ref` is text with no
 *   foreign key by design — and answering that whole routine with an exception
 *   would take a working page down over one stale line. `null` is what lets
 *   „Trening" draw that one line as unusable and the other eleven as usable.
 * - **One `list()` for the batch.** `fit:routines-list` resolves every item of
 *   every routine; a per-item store call would be the N+1 `fit:last-performed`
 *   exists to avoid, on a read that happens on every mount of the page.
 */
export function fitExerciseLookup(
  exercises: FitExerciseStore,
): (reference: string) => { label: string; metric: ExerciseMetric } | null {
  let own: Map<string, FitExercise> | null = null;
  return (reference) => {
    const parsed = parseExerciseRef(reference);
    if (parsed === null) return null;
    if (parsed.kind === "catalogue") {
      const entry = catalogueExercise(parsed.id);
      return entry === undefined
        ? null
        : { label: localizedExerciseName(entry.name, entry.nameEn), metric: entry.metric };
    }
    // Read on first use rather than eagerly: a profile with no routines, or one
    // whose routines are all catalogue movements, never touches the table.
    own ??= new Map(exercises.list().map((entry) => [entry.id, entry]));
    const entry = own.get(parsed.id);
    return entry === undefined
      ? null
      : { label: localizedExerciseName(entry.name, entry.nameEn), metric: entry.metric };
  };
}

/**
 * Turns the reference the renderer sent into the label and the seven numbers the
 * item will be stamped with. **The module's security boundary** — see the block
 * comment above.
 *
 * `catalogue:<id>` is looked up in the app's own shipped data; an id this build
 * no longer ships is refused rather than logged as a name with no numbers.
 * `user:<uuid>` goes through the food store, which answers only for a LIVE food
 * in THIS profile — so a soft-deleted food cannot be logged afresh, while every
 * item already logged with it stays exactly as it was.
 */
export function resolveLoggedFood(
  foods: FitFoodStore,
  reference: unknown,
): { foodRef: string; label: string; per100g: FoodMacros } {
  if (typeof reference !== "string") {
    throw new Error(`Invalid IPC payload: "foodRef" must be a string.`);
  }
  const parsed = parseFoodRef(reference);
  if (parsed === null) {
    throw new Error(`Invalid IPC payload: "foodRef" must be "catalogue:<id>" or "user:<id>".`);
  }
  if (parsed.kind === "catalogue") {
    const food = catalogueFood(parsed.id);
    if (food === undefined) {
      throw new Error(`Invalid IPC payload: "foodRef" names no food this build ships.`);
    }
    // The snapshot label is what a diary row reads for the rest of its life, so
    // it is written in the language main is serving — the same `mainLocale()`
    // the dialogs and notifications follow. The user-food path below has no
    // English text to choose from.
    const label = mainLocale() === "en" ? (food.nameEn ?? food.name) : food.name;
    return { foodRef: reference, label, per100g: food.per100g };
  }
  const food = foods.get(parsed.id);
  return { foodRef: reference, label: food.name, per100g: food.per100g };
}

/** One candidate a food search ranks: a catalogue entry or one of the profile's own foods, told apart by the field it carries. */
export type FoodCandidate =
  | { id: string; name: string; nameEn?: string; catalogue: FoodEntry }
  | { id: string; name: string; nameEn?: string; user: FitFood };

/**
 * The pool a food search ranks, in one list: the catalogue that ships in the app
 * and this profile's live foods. One pool and one ranking, because two lists
 * merged afterwards would be a second definition of „best match" — see
 * `searchFoods`.
 */
export function foodCandidates(foods: FitFoodStore): FoodCandidate[] {
  return [
    ...FOOD_CATALOGUE.map((food) => ({
      id: foodRefText({ kind: "catalogue", id: food.id }),
      name: food.name,
      nameEn: food.nameEn,
      catalogue: food,
    })),
    ...foods.list().map((food) => ({
      id: foodRefText({ kind: "user", id: food.id }),
      name: food.name,
      user: food,
    })),
  ];
}

/** One candidate an exercise search ranks: a catalogue movement or one of the profile's own. */
export type ExerciseCandidate =
  | { id: string; name: string; nameEn: string; catalogue: ExerciseEntry }
  | { id: string; name: string; nameEn: string; own: FitExercise };

/** The exercise pool a search ranks, catalogue and own movements in one list, for the same reason as `foodCandidates`. */
export function exerciseCandidates(exercises: FitExerciseStore): ExerciseCandidate[] {
  return [
    ...EXERCISE_CATALOGUE.map((entry) => ({
      id: exerciseRefText({ kind: "catalogue", id: entry.id }),
      name: entry.name,
      nameEn: entry.nameEn,
      catalogue: entry,
    })),
    ...exercises.list().map((entry) => ({
      id: exerciseRefText({ kind: "user", id: entry.id }),
      name: entry.name,
      nameEn: entry.nameEn,
      own: entry,
    })),
  ];
}
