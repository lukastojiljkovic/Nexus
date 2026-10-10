import type { ReaderIndexView, ReaderTocViewNode } from "../shared/ipc.js";

/**
 * The reading view's own arithmetic, as pure functions (ADR-090).
 *
 * Three decisions live here rather than in the component: which article a book
 * opens on, how far the index has got, and how a size is written. All three are
 * answers a person can check, and none of them needs a DOM to be wrong - which is
 * why they are testable exactly.
 */

/**
 * The article a pack opens on: where the reader left off when that article is
 * still in the pack, and the first article otherwise.
 *
 * The fallback is the point. A pack that was updated, renamed or reinstalled can
 * have lost the article a position names, and the honest answer to "open this
 * book" is then its beginning - not an error, and not a blank page. `null` only
 * when the pack has no articles at all, which a `content` pack may legally be.
 */
export function pickStartArticle(
  toc: readonly ReaderTocViewNode[],
  position: string | null,
): string | null {
  if (position !== null && containsArticle(toc, position)) return position;
  return firstArticle(toc);
}

function containsArticle(nodes: readonly ReaderTocViewNode[], id: string): boolean {
  for (const node of nodes) {
    if (node.kind === "article" && node.id === id) return true;
    if (containsArticle(node.children, id)) return true;
  }
  return false;
}

/** The first article in reading order: the tree's leftmost leaf. */
export function firstArticle(nodes: readonly ReaderTocViewNode[]): string | null {
  for (const node of nodes) {
    if (node.kind === "article") return node.id;
    const inner = firstArticle(node.children);
    if (inner !== null) return inner;
  }
  return null;
}

/**
 * How far a pack's index has got, as a fraction in `0..1`, or `null` when there
 * is nothing to show: a ready index is not progress, and a pack with no articles
 * has no fraction to compute (a division by zero would draw a full bar for an
 * empty book).
 */
export function indexProgress(view: ReaderIndexView): number | null {
  if (view.state !== "building" || view.articlesTotal === 0) return null;
  return Math.min(1, Math.max(0, view.articlesDone / view.articlesTotal));
}

