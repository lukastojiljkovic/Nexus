/**
 * The rest of the PDF tools' pure arithmetic: a page's rotation, the text a page
 * number draws, and the page order the thumbnail grid rearranges.
 *
 * The range grammar lives next door in `ranges.ts`; this file holds the three
 * things the screen computes that are not about parsing an expression, and each
 * is here for the same reason — the worker draws it with pdf-lib, and pdf-lib is
 * a library no test can call without a document, while "what is −90° normalised
 * to?" is a question with one answer.
 */

/**
 * One quarter turn, in degrees, and the only amount the rotate buttons move a
 * page by.
 *
 * PDF stores a page's rotation as `/Rotate`, which PDF 32000-1 §7.7.3.3 defines
 * as clockwise and as a multiple of 90; pdf-lib exposes exactly that as
 * `page.setRotation(degrees(n))`. A reader therefore shows the angle modulo a
 * full turn, which is what `normalizeRotation` answers.
 */
export const QUARTER_TURN_DEGREES = 90;

/**
 * `degrees` reduced to `0 | 90 | 180 | 270`, clockwise.
 *
 * Negative angles are the ordinary case rather than an edge: "rotate left" is
 * `−90`, and a page already at 0 that is turned left twice is at 180. Anything
 * that is not a whole number of quarter turns is refused, because `/Rotate` has
 * no other values — a number like 45 would be written as a page whose displayed
 * angle no PDF reader agrees about.
 */
export function normalizeRotation(degrees: number): number {
  if (!Number.isInteger(degrees) || degrees % QUARTER_TURN_DEGREES !== 0) {
    throw new RangeError("A page rotation is a whole number of quarter turns.");
  }
  return ((degrees % 360) + 360) % 360;
}

/** The two ways a page number can be written. */
export const PAGE_NUMBER_FORMATS = ["plain", "of-total"] as const;

export type PageNumberFormat = (typeof PAGE_NUMBER_FORMATS)[number];

/** Where on the page the number is drawn. */
export const PAGE_NUMBER_POSITIONS = ["bottom-centre", "bottom-right"] as const;

export type PageNumberPosition = (typeof PAGE_NUMBER_POSITIONS)[number];

/**
 * The text one page draws: `7`, or `7 / 12`.
 *
 * The separator is a spaced ASCII slash in both locales, which is deliberate: a
 * fraction bar a Serbian reader reads and an English one does not is not a
 * thing, and `7 / 12` is what every page-number stamp in the world looks like.
 */
export function pageNumberText(format: PageNumberFormat, page: number, total: number): string {
  return format === "of-total" ? `${page} / ${total}` : `${page}`;
}

/**
 * The order of a document whose pages have not been touched: every page, once,
 * counting from zero.
 *
 * The order is a list of 0-BASED indices into the file the user picked, and the
 * screen's grid is that list rendered in sequence — so deleting a page is
 * dropping an entry, and reordering is moving one. Keeping the indices (rather
 * than the pages themselves) is what lets the grid say "this tile is page 4 of
 * the file" after a move.
 */
export function pageOrder(pageCount: number): number[] {
  return Array.from({ length: Math.max(0, pageCount) }, (_, index) => index);
}

/**
 * `order` with the entry at `from` moved to `to`.
 *
 * `to` is the index the entry should END UP at, and it is clamped into the
 * list: a drag that lands past the last tile means the end, which is the same
 * statement a drop below the last row makes. An out-of-range `from` answers the
 * order unchanged rather than throwing — a drag event can carry an index from a
 * render whose list has since been shortened, and a pure helper that throws on
 * a stale index turns a dropped tile into a broken page.
 */
export function moveOrderEntry(order: readonly number[], from: number, to: number): number[] {
  if (!Number.isInteger(from) || from < 0 || from >= order.length) return [...order];
  const next = [...order];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...order];
  const target = Math.max(0, Math.min(Math.trunc(to), next.length));
  next.splice(target, 0, moved);
  return next;
}

/**
 * `order` without the entry at `index` — the delete button on a tile.
 *
 * The last remaining page cannot be removed: a PDF with no pages is a file
 * pdf-lib refuses to save, so an order of one page answers itself unchanged.
 * That is a rule about the FORMAT rather than about the tool, and it is stated
 * here so the screen does not have to guess which of its buttons to disable.
 */
export function removeOrderEntry(order: readonly number[], index: number): number[] {
  if (order.length <= 1) return [...order];
  if (!Number.isInteger(index) || index < 0 || index >= order.length) return [...order];
  return order.filter((_, at) => at !== index);
}
