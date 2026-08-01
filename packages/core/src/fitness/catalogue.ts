/**
 * The two catalogues that ship INSIDE the app (FIT slice a): the foods and the
 * exercises.
 *
 * **These are not database rows and never will be.** Seeding several hundred
 * identical foods into every profile's encrypted database would put app data
 * where user data lives — and from there into every export archive, where a
 * restore would faithfully reproduce a copy of the app's own dataset as though
 * the user had typed it. So a catalogue is a file the build inlines, read by
 * whoever needs it, and `@nexus/db`'s `fit_foods` holds only what the user added
 * themselves. It is the arrangement „Datoteke" already uses one module over
 * (`attachmentIndexStore.ts`): the read is assembled from what exists rather
 * than materialised into a table of its own.
 *
 * Two consequences follow and are load-bearing elsewhere. A logged meal SNAPSHOTS
 * the seven numbers it used — and a logged set snapshots its metric — because
 * these values change when the app updates and a log that silently rewrote
 * yesterday's calories would be a lying log. And `@nexus/db` never reads either
 * file: the caller resolves the entry and hands the store what it needs, so the
 * database layer carries no dependency on app-shipped data.
 *
 * Both JSON files are replaced WHOLESALE as the datasets grow. Nothing here
 * inspects an individual entry, and the one guarantee that a file is fit to ship
 * is its test — `catalogue.test.ts` and `exercises.test.ts`, each of which runs
 * the module's own validator over every entry and refuses a duplicate id. Those
 * tests are what make the assertions below honest.
 */

import catalogueJson from "./data/catalogue.json";
import exercisesJson from "./data/exercises.json";
import type { ExerciseEntry } from "./exercise.js";
import type { FoodEntry } from "./food.js";

/**
 * Every food the app ships with, in file order.
 *
 * The assertion is the ONE place this module trusts the file, and its warrant is
 * `catalogue.test.ts`: every entry is validated there, so a file that reached a
 * build has already been through the same gate a hand-written entry would be. It
 * is asserted rather than parsed at startup on purpose — parsing would either
 * throw inside a bundled app (bricking it over a data typo) or silently drop
 * entries (a catalogue quietly missing foods, which is the worse failure). A
 * red test before the build is the right place for that news.
 */
export const FOOD_CATALOGUE = catalogueJson as readonly FoodEntry[];

/**
 * A catalogue food by its id, or undefined. The reference a logged meal carries
 * is `catalogue:<id>`, and this is what resolves it — undefined for an id this
 * build no longer ships, which a caller must handle rather than assume away: a
 * meal logged under an older catalogue is still a true meal, and its snapshot is
 * exactly why it can still be read.
 */
export function catalogueFood(id: string): FoodEntry | undefined {
  return foodIndex.get(id);
}

const foodIndex = new Map(FOOD_CATALOGUE.map((food) => [food.id, food]));

/**
 * Every exercise the app ships with, in file order — the same arrangement and
 * the same warrant as `FOOD_CATALOGUE`, with `exercises.test.ts` as the gate
 * that validates every entry before a build can reach one.
 */
export const EXERCISE_CATALOGUE = exercisesJson as readonly ExerciseEntry[];

/**
 * A catalogue exercise by its id, or undefined for an id this build no longer
 * ships. A caller must handle the undefined rather than assume it away: a set
 * logged under an older catalogue is still a true set, which is exactly why the
 * log snapshots what it needs instead of resolving the exercise every time it is
 * read.
 */
export function catalogueExercise(id: string): ExerciseEntry | undefined {
  return exerciseIndex.get(id);
}

const exerciseIndex = new Map(EXERCISE_CATALOGUE.map((exercise) => [exercise.id, exercise]));
