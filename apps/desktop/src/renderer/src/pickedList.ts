/**
 * Which item of a named list a page should be showing.
 *
 * Two decisions, shared by every module that opens one document at a time out
 * of a switcher — „Tabla" and „Elektronika" today. They were written for boards
 * and typed to `CanvasBoard`, and neither ever looked at more than the `id`;
 * copying them into the circuits page would have been the same arithmetic in two
 * files, which is how the two answers to „where do I land after a delete" start
 * to differ. They live here instead, over the only field they read.
 *
 * Pure, and tested without a page (`focusPhases.ts`'s arrangement).
 */

/** The least any list this module can decide about has to carry. */
interface Identified {
  id: string;
}

/**
 * Which item to show once `deletedId` is gone.
 *
 * The NEIGHBOUR rather than the head, and rather than nothing: deleting the
 * third of five and landing on the first would scroll the list away from where
 * the user was working, while landing on nothing would make a delete feel like a
 * crash. The one after it, or the one before it when there is no after, or null
 * when that was the last one there was.
 *
 * `items` is the list as it stood BEFORE the delete — the caller has it already,
 * and computing from it is what makes „the one after" mean anything.
 */
export function neighbourAfterDelete(
  items: readonly Identified[],
  deletedId: string,
): string | null {
  const index = items.findIndex((item) => item.id === deletedId);
  if (index < 0) return items[0]?.id ?? null;
  return items[index + 1]?.id ?? items[index - 1]?.id ?? null;
}

/**
 * Which item to show given a list and whatever the page was showing before.
 *
 * Keeps the current one whenever it is still there — a refresh after a rename or
 * a save must not move the user — and otherwise falls to the first, which is the
 * sr-Latn alphabetical head the store already sorted.
 */
export function resolveOpenItem(
  items: readonly Identified[],
  current: string | null,
): string | null {
  if (current !== null && items.some((item) => item.id === current)) return current;
  return items[0]?.id ?? null;
}
