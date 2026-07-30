/**
 * The dashboard layout's pure arithmetic (ADR-045 slice b) — the two questions
 * the edit mode asks that are not about rendering: "which two placements does
 * this one land between?" and "what does this widget's title key resolve to?".
 *
 * They live here rather than inside `DashboardPage.tsx` because this repo's
 * Vitest runs without a DOM (see `vitest.config.ts`): a helper that takes an
 * array and answers with a pair is testable, and a React component is not.
 */

/**
 * The two placements a moved widget lands BETWEEN — the pair
 * `dashboard:widgets-move` takes, either end null at an end of the layout.
 * Same shape, and the same reasoning, as `TaskListStore`'s move pair: positions
 * are sparse sort keys, so "one place up" is a statement about neighbours and
 * not arithmetic on an index.
 */
export interface LayoutNeighbours {
  beforeId: string | null;
  afterId: string | null;
}

/**
 * The neighbours the entry at `from` lands between when it moves to index `to`
 * of the same order — or null when that is not a move (either index outside the
 * order, or the entry already there).
 *
 * ONE helper for all three gestures, because they only differ in where `to`
 * comes from: „Pomeri gore" is `from - 1`, „Pomeri dole" is `from + 1`, and a
 * drop is the index of the card dropped on. The moved entry is taken out of the
 * order first, so the answer is always a pair of OTHER placements — dragging a
 * card downward therefore lands it after the card it was dropped on, and
 * dragging it upward lands it before, which is what the gesture looks like.
 *
 * `order` is the order actually DRAWN, i.e. the visible widgets only: an entry
 * whose module is switched off draws nothing (ADR-045 section 3), and stepping
 * a card "up" over a card nobody can see would be a write with nothing to show
 * for it.
 */
export function moveNeighbours(
  order: readonly string[],
  from: number,
  to: number,
): LayoutNeighbours | null {
  if (from < 0 || from >= order.length) return null;
  if (to < 0 || to >= order.length || to === from) return null;
  const rest = order.filter((_, index) => index !== from);
  return { beforeId: rest[to - 1] ?? null, afterId: rest[to] ?? null };
}

/**
 * Resolves a dotted `strings` path to its Serbian text, or null when the path
 * names nothing — the convention `WidgetContract.title` documents, applied.
 * A widget's title crosses `@nexus/core` as the KEY `"dashboard.today.title"`
 * so the copy can stay in `strings.ts`; this is what turns it back into „Danas".
 *
 * `root` is a parameter rather than a hard-wired import of `strings` so the
 * function stays pure and testable against a small object.
 */
export function lookupString(root: unknown, path: string): string | null {
  const value = path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[key]
          : undefined,
      root,
    );
  return typeof value === "string" ? value : null;
}
