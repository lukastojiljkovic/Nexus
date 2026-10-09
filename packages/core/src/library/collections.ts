/**
 * Collections: a named list of works a person works through, and the one number
 * that is COMPUTED rather than stored.
 *
 * **Progress is derived, and it is derived here.** „How far through this
 * collection am I" is `items done / all items`, and the brief is explicit that
 * it is never stored — a stored counter is a second copy of a fact that already
 * exists on each item's `status`, and two copies of one fact disagree the first
 * time a write goes through one path and not the other ([[DC-08]]). The store's
 * SQL answers it with one `GROUP BY` so a list of cards costs one query;
 * `collectionProgress` below is the same arithmetic over rows a caller already
 * holds, and the store's test pins the two against each other.
 *
 * **„All items" means the LIVE ones.** A soft-deleted item is not in anybody's
 * collection view, and its link row stays where it is only so that restoring the
 * item puts it back where the user had it. Counting it would make a collection
 * read „7/10" over seven visible works.
 */

import type { LibraryStatus } from "./item.js";

/**
 * A collection a user made. `suggestedId` is what makes an ADOPTED one
 * identifiable: it is the `id` of the curated list it came from, and it is what
 * lets a second adoption of the same list be a no-op rather than a duplicate
 * (see `LibraryStore.adoptSuggestedCollection`).
 */
export interface LibraryCollection {
  readonly id: string;
  readonly profileId: string;
  readonly name: string;
  readonly description: string | null;
  /** The suggested list this collection was adopted from, or null for one the user made. */
  readonly suggestedId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * One work's place in one collection. A row rather than a bare pair, unlike a
 * tag link, because the ORDER is data: `rank` is the user's arrangement
 * (migration 062's fractional rank, the same arithmetic `task_lists` and
 * `dashboard_sets` place rows with), and a pair that carries an order carries
 * something a user can point at.
 */
export interface LibraryCollectionItem {
  readonly id: string;
  readonly collectionId: string;
  readonly itemId: string;
  /** The fractional sort key within the collection. Never renumbered — there is always room between two ranks. */
  readonly rank: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** How far through a collection its owner is. Both numbers are counts of items, and `total` is zero for an empty collection. */
export interface LibraryCollectionProgress {
  readonly done: number;
  readonly total: number;
}

/**
 * The progress of one collection, from the statuses of its LIVE items — see the
 * file header for why „live" is the honest denominator. `dropped` counts as
 * „not done", deliberately: a work somebody put down is not finished, and a
 * progress bar that counted it would claim a collection is complete when half
 * of it was abandoned.
 */
export function collectionProgress(
  statuses: readonly LibraryStatus[],
): LibraryCollectionProgress {
  let done = 0;
  for (const status of statuses) if (status === "done") done += 1;
  return { done, total: statuses.length };
}
