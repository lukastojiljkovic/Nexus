/**
 * The food catalogue that ships INSIDE the app (FIT slice a).
 *
 * **These are not database rows and never will be.** Seeding several hundred
 * identical foods into every profile's encrypted database would put app data
 * where user data lives — and from there into every export archive, where a
 * restore would faithfully reproduce a copy of the app's own dataset as though
 * the user had typed it. So the catalogue is a file the build inlines, read by
 * whoever needs it, and `@nexus/db`'s `fit_foods` holds only what the user added
 * themselves. It is the arrangement „Datoteke" already uses one module over
 * (`attachmentIndexStore.ts`): the read is assembled from what exists rather
 * than materialised into a table of its own.
 *
 * Two consequences follow and are load-bearing elsewhere. A logged meal SNAPSHOTS
 * the seven numbers it used, because these values change when the app updates
 * and a log that silently rewrote yesterday's calories would be a lying log. And
 * `@nexus/db` never reads this file: the caller resolves a food and hands the
 * store the macros, so the database layer carries no dependency on app-shipped
 * data.
 *
 * `data/catalogue.json` is replaced WHOLESALE as the dataset grows. Nothing here
 * inspects an individual entry, and the one guarantee that the file is fit to
 * ship is `catalogue.test.ts`, which runs `validateFoodEntry` over every entry
 * and refuses a duplicate id. That test is what makes the assertion below honest.
 */

import catalogueJson from "./data/catalogue.json";
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
  return index.get(id);
}

const index = new Map(FOOD_CATALOGUE.map((food) => [food.id, food]));
