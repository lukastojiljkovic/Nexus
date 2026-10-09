/**
 * „What did I finish this year" — four numbers, computed from rows and stored
 * nowhere.
 *
 * **The count comes from the PASSES, not from the item.** An item carries a
 * `status`, and a status has no date: „done" does not say whether that happened
 * in March or in 2019, and reading the item's `updatedAt` would answer a
 * different question (when the row was last touched, which a corrected rating
 * also moves). The only dated fact about finishing this module keeps is a
 * pass's `finishedOn`, so that is what a year counts — and an item finished
 * twice in one year, which is exactly what a second pass IS, counts once as an
 * ITEM while both of its finishes carry a rating.
 *
 * **The two decisions the brief leaves open, said out loud.**
 *
 * - `pagesRead` sums a finished book's TOTAL pages, and only where the user
 *   recorded one. A book with no `pagesTotal` contributes nothing rather than
 *   zero pages, so the sum is a FLOOR: `pagesCounted` says how many books it is
 *   made of, and a caller that shows „1 240 pages" without it is claiming a
 *   precision the data does not have.
 * - `averageRating` is the mean of the ratings on the passes that finished
 *   inside the year, and it is returned UNROUNDED. Rounding here would make a
 *   year's average disagree with the sum of its own parts (three ratings of
 *   5, 5 and 4 average 4.666…, and a rounded 4.7 is not the mean of anything),
 *   and formatting is the caller's business — the rule the professional drawer's
 *   tools already work under. `ratedPasses` says what the mean is over, so a
 *   single rating is not mistaken for a trend.
 */

import type { LibraryKind } from "./item.js";
import { LIBRARY_MAX_YEAR, LIBRARY_MIN_YEAR } from "./item.js";

/** What the year's report needs from an item. `LibraryItem` satisfies it structurally. */
export interface LibraryStatsItem {
  readonly id: string;
  readonly kind: LibraryKind;
  readonly pagesTotal: number | null;
}

/** What it needs from a pass. `LibraryPass` satisfies it structurally. */
export interface LibraryStatsPass {
  readonly itemId: string;
  readonly finishedOn: string | null;
  readonly rating: number | null;
}

export interface LibraryYearStats {
  readonly year: number;
  /** Distinct items finished in the year, per kind. A kind with nothing finished is a zero, not an absence. */
  readonly finished: Readonly<Record<LibraryKind, number>>;
  /** The pages of the finished books whose total is known — a floor, see the file header. */
  readonly pagesRead: number;
  /** How many books `pagesRead` is made of. */
  readonly pagesCounted: number;
  /** The mean of the ratings on the year's finishing passes, unrounded, or null when none carried one. */
  readonly averageRating: number | null;
  /** How many ratings `averageRating` is over. Zero means there is no average. */
  readonly ratedPasses: number;
}

/**
 * One year's figures. `year` is a caller's number rather than untrusted input,
 * so a year that is not a year is a RangeError naming the bound rather than a
 * report of zeros.
 */
export function libraryYearStats(
  items: readonly LibraryStatsItem[],
  passes: readonly LibraryStatsPass[],
  year: number,
): LibraryYearStats {
  if (!Number.isInteger(year) || year < LIBRARY_MIN_YEAR || year > LIBRARY_MAX_YEAR) {
    throw new RangeError(
      `"year" must be a whole year between ${LIBRARY_MIN_YEAR} and ${LIBRARY_MAX_YEAR}.`,
    );
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const yearKey = String(year);
  const finishedIds = new Set<string>();
  let ratingSum = 0;
  let ratedPasses = 0;

  for (const pass of passes) {
    // A bare day, so its first four characters ARE the year it happened in.
    if (pass.finishedOn === null || pass.finishedOn.slice(0, 4) !== yearKey) continue;
    // A pass whose item is not in `items` is not this report's business: the
    // caller decided which items are in scope, and counting a kind it cannot
    // name would put a figure in the report that nothing above explains.
    if (!byId.has(pass.itemId)) continue;
    finishedIds.add(pass.itemId);
    if (pass.rating !== null) {
      ratingSum += pass.rating;
      ratedPasses += 1;
    }
  }

  const finished: Record<LibraryKind, number> = { book: 0, film: 0, series: 0 };
  let pagesRead = 0;
  let pagesCounted = 0;
  for (const id of finishedIds) {
    const item = byId.get(id);
    if (item === undefined) continue;
    finished[item.kind] += 1;
    if (item.kind === "book" && item.pagesTotal !== null) {
      pagesRead += item.pagesTotal;
      pagesCounted += 1;
    }
  }

  return {
    year,
    finished,
    pagesRead,
    pagesCounted,
    averageRating: ratedPasses === 0 ? null : ratingSum / ratedPasses,
    ratedPasses,
  };
}
