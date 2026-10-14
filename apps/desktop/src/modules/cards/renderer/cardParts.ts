import { colourOf, sameCard, type Card, type CardColour } from "@nexus/core";

/**
 * The table's geometry as pure functions (ADR-090): which Pyramid and TriPeaks
 * cards are exposed, and which cards two moves are about.
 *
 * **Why this is not a second copy of the rules.** „Exposed" is the ENGINES' — a
 * position they enumerate moves over — but the page has to know it to draw a card
 * as clickable or as buried, and a card that looked playable and refused would be
 * the one defect a player would read as a bug. The two relations are therefore
 * spelled out here as the deal's own geometry (`TRIPEAKS_COVERS` in
 * `tripeaks.ts` and `PYRAMID_COVERS` in `pyramid.ts` are the same two tables) and
 * pinned by `table.test.ts` against the engines' own move enumeration, so a drift
 * between the picture and the rules fails a test rather than shipping.
 */

/** The colour of a card's suit — the only property a tableau placement asks about. */
export function cardColour(card: Card): CardColour {
  return colourOf(card.suit);
}

export function eq(left: Card, right: Card): boolean {
  return sameCard(left, right);
}

/**
 * Pyramids: 28 slots in row order — row 0 is slot 0, row 6 is slots 21..27 — and
 * each slot is covered by the one or two cards directly BELOW it.
 */
const PYRAMID_COVERS: readonly (readonly number[])[] = (() => {
  const covers: number[][] = Array.from({ length: 28 }, () => []);
  let row = 0;
  let first = 0;
  while (first < 28) {
    const width = row + 1;
    for (let offset = 0; offset < width; offset += 1) {
      covers[first + offset]!.push(first + width + offset, first + width + offset + 1);
    }
    first += width;
    row += 1;
  }
  // The last row has nothing below it, so its entries are dropped rather than
  // pointing at slots that do not exist.
  return covers.map((below) => below.filter((slot) => slot < 28));
})();

/** The row a Pyramid slot sits in, and its position, for the layout. */
export function pyramidRow(index: number): number {
  let row = 0;
  let first = 0;
  while (index >= first + row + 1) {
    first += row + 1;
    row += 1;
  }
  return row;
}

/** Whether a Pyramid card is exposed: neither card below it is still there. */
export function pyramidExposed(cards: readonly (Card | null)[], index: number): boolean {
  return (PYRAMID_COVERS[index] ?? []).every((below) => cards[below] === null);
}

/**
 * TriPeaks' three peaks, as the deal's own geometry: for each slot, the two
 * slots of the row below that cover it, and nothing for the row of ten
 * (`TRIPEAKS_COVERED_BY` in `tripeaks.ts`, slot for slot).
 */
export const TRIPEAKS_COVERED_BY: readonly (readonly number[])[] = [
  [], [], [], [], [], [], [], [], [], [],
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9],
  [10, 11], [11, 12],
  [13, 14], [14, 15],
  [16, 17], [17, 18],
  [19, 20], [21, 22], [23, 24],
];

/** Whether a TriPeaks card is exposed: every card covering it is already played off. */
export function triPeaksExposed(tableau: readonly (Card | null)[], slot: number): boolean {
  return (TRIPEAKS_COVERED_BY[slot] ?? []).every((below) => tableau[below] === null);
}

/**
 * The four rows of TriPeaks, caps first, as the layout draws them: `null` is a
 * card's width of space — one between the pyramids in the row of six, two
 * between the caps — so each centred row lands every card half a card from the
 * two that cover it, the geometry `TRIPEAKS_COVERED_BY` is written from. Drawn
 * top first, so each row lies over the one above it, as the deal does.
 */
export const TRIPEAKS_ROWS: readonly (readonly (number | null)[])[] = [
  [25, null, null, 26, null, null, 27],
  [19, 20, null, 21, 22, null, 23, 24],
  Array.from({ length: 9 }, (_, index) => index + 10),
  Array.from({ length: 10 }, (_, index) => index),
];
