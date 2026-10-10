/**
 * The library's four orders, in one place.
 *
 * **Why a shared comparator rather than four `sort` calls in the renderer.**
 * The house rule (CLAUDE.md) is `Intl.Collator(["sr-Latn", "sr"])` for anything
 * a person reads, and plain `"sr"` is not a substitute: it mis-tailors the
 * digraphs and puts `Šuma` after `Zdravlje` in some ICU builds. A store that
 * handed back SQLite's BINARY order and left the renderer to fix it is the
 * arrangement `HabitStore.listActive` documents and rejects, so the store sorts
 * with `sortLibraryItems` too — one collator, one tiebreak, one order, whether
 * the caller re-sorts or not.
 *
 * **The directions are part of the key, and here is why.** A log's useful
 * default is best-and-newest first: „poredano po oceni" that opened with the
 * one-star items would make every caller write the reversal, and the callers
 * would not agree on it. So `title` is ascending (`Ana` before `Žito`) while
 * `year`, `rating` and `activity` are DESCENDING. A caller that wants the other
 * direction reverses the resulting array, which is one line and cannot be wrong.
 *
 * **Every order is total.** A tie on the sort key falls through to `id`, so two
 * items the user gave the same rating cannot swap places between two reads of
 * unchanged data — the `HabitStore` tiebreak, and the reason `id` is part of
 * `LibrarySortableItem`.
 */

/**
 * The one collator for the library's lists, exported so the store and every
 * caller share it: two `Intl.Collator` instances with one configuration are
 * equal in behaviour and not in cost, and a second one is a second thing to
 * keep in step with CLAUDE.md.
 */
export const LIBRARY_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** The four orders a library list can be shown in. Closed, because a fifth would need a direction and a test. */
export const LIBRARY_SORT_KEYS = ["title", "year", "rating", "activity"] as const;
export type LibrarySortKey = (typeof LIBRARY_SORT_KEYS)[number];

/**
 * What sorting reads. A NARROWER shape than `LibraryItem` on purpose, so a
 * caller holding a partial row (a search result, a collection entry) can sort it
 * with the same function — while `LibraryItem` satisfies it structurally, which
 * is what keeps the store's own list on the same order.
 */
export interface LibrarySortableItem {
  readonly id: string;
  readonly title: string;
  readonly year: number | null;
  readonly rating: number | null;
  /** When anything about the item last changed — a pass and a thought bump it, which is what makes „last activity" one column. */
  readonly updatedAt: string;
}

/** A nullable number, largest first, with `null` („not recorded") last: an unknown year is not the year zero. */
function compareNullableDescending(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

/**
 * The three-way comparison of one order, without the tiebreak — exported
 * separately so a caller that already has a total order of its own can compose
 * with it instead of copying the direction rules.
 */
export function compareLibraryItemsBy(
  left: LibrarySortableItem,
  right: LibrarySortableItem,
  key: LibrarySortKey,
): number {
  switch (key) {
    case "title":
      return LIBRARY_COLLATOR.compare(left.title, right.title);
    case "year":
      return compareNullableDescending(left.year, right.year);
    case "rating":
      return compareNullableDescending(left.rating, right.rating);
    case "activity":
      // ISO-8601 date-times compare correctly as text, which is the only reason
      // this needs no parsing (`false`/`true` mapped to -1/1 rather than 0-1,
      // so a strict comparator never claims two different strings are equal).
      if (left.updatedAt === right.updatedAt) return 0;
      return left.updatedAt < right.updatedAt ? 1 : -1;
  }
}

/** The total order for one key: the key's comparison, then `id` ascending so no two rows are ever equal. */
export function compareLibraryItems(
  left: LibrarySortableItem,
  right: LibrarySortableItem,
  key: LibrarySortKey,
): number {
  return (
    compareLibraryItemsBy(left, right, key) || left.id.localeCompare(right.id)
  );
}

/** A new array in one of the four orders. Never mutates its input — the caller's list may be a store read it still needs. */
export function sortLibraryItems<T extends LibrarySortableItem>(
  items: readonly T[],
  key: LibrarySortKey,
): T[] {
  return [...items].sort((left, right) => compareLibraryItems(left, right, key));
}
