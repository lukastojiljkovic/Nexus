import { MLIN_LAYOUT, draughts, ludo, reversi } from "@nexus/core";

/**
 * Where a board's cells are DRAWN (ADR-090 stage 2) — one place per game, so a
 * component places a piece with a grid coordinate and nothing else.
 *
 * **Why this is separate from the rules, and why it is a table.** A picture of a
 * board is not a rule: the engines know which squares are adjacent and who may
 * stand where, and nothing here says a word about either. What it does say is
 * which grid cell a point occupies, and it says it ONCE per game, because the
 * failure this shape prevents is the expensive one — a piece drawn one square away
 * from the square the move list names. Every function below is total and pure, so
 * the relationship between a game's numbering and the picture is a thing a test
 * can check rather than a thing a reader has to reconstruct from JSX.
 *
 * **Grid rows are counted from the TOP, like CSS.** The engines count rows from
 * the bottom (`row 0 at the bottom` in reversi, draughts and four in a row) and
 * from the top in the morris lattice, so each function flips where it has to; the
 * flip lives here and nowhere else.
 */

/** A position on a CSS grid: both are 1-based once they reach `gridColumn`/`gridRow`. */
export interface GridCell {
  readonly column: number;
  readonly row: number;
}

// --- Reversi and draughts: the same 8x8 board, two numberings ---------------

export const EIGHT_GRID = reversi.REVERSI_SIZE;

/**
 * A reversi cell as a grid position. The engine puts row 0 at the BOTTOM, so the
 * drawn row is `EIGHT_GRID - row`.
 */
export function reversiCell(cell: number): GridCell {
  const column = cell % reversi.REVERSI_SIZE;
  const row = Math.floor(cell / reversi.REVERSI_SIZE);
  return { column: column + 1, row: EIGHT_GRID - row };
}

/**
 * A draughts square as a grid position, from the engine's own row and column —
 * which are the only two numbers that say where a square is.
 */
export function draughtsCell(square: number): GridCell {
  return {
    column: draughts.draughtsColumn(square) + 1,
    row: EIGHT_GRID - draughts.draughtsRow(square),
  };
}

// --- Four in a row ----------------------------------------------------------
//
// There is deliberately no cell helper here. The four board is drawn as seven
// COLUMNS of six, not as a grid, because that is what its interaction is: a
// column is a button and a disc falls to `fourColumnHeight`'s row inside it — so
// the engine's `fourIndex` is the whole of the arithmetic and a second mapping
// would be a second thing to keep in step.

// --- Nine men's morris ------------------------------------------------------

/**
 * A morris point as a grid position, straight out of `MLIN_LAYOUT` — the table
 * `@nexus/core` exports for exactly this, so the picture and the point's NAME
 * (`a7` … `g1`) are read off one source and cannot disagree.
 */
export function mlinCell(point: number): GridCell {
  const at = MLIN_LAYOUT[point];
  if (at === undefined) throw new RangeError(`mlin: no point ${point}`);
  return { column: at[0] + 1, row: at[1] + 1 };
}

/** The morris board's lattice is 7 by 7. */
export const MLIN_GRID = 7;

// --- Backgammon -------------------------------------------------------------

/**
 * The backgammon board as it is printed: two rows of twelve points with the bar
 * between them, and each row split into its two halves by the bar.
 *
 * The columns run 1…13, where column 7 IS the bar. Seat 0's home board (points
 * 1…6, indices 0…5) is the bottom-RIGHT quadrant and seat 1's (points 19…24,
 * indices 18…23) the top-right one, which is what makes the two players' checkers
 * travel the same way round the board rather than towards each other.
 */
export const BACKGAMMON_BAR_COLUMN = 7;
export const BACKGAMMON_COLUMNS = 13;

/** The point at `index` — near row is seat 0's own, far row is seat 1's. */
export function backgammonCell(index: number): GridCell {
  if (index < 12) {
    // Bottom row, right to left: point 1 (index 0) sits hard against the right
    // edge, and index 5 (point 6) on the bar's left.
    return { column: index < 6 ? 13 - index : 12 - index, row: 2 };
  }
  // Top row, left to right: index 12 (point 13) at the far left, index 23 (point
  // 24) at the far right.
  const step = index - 12;
  return { column: step < 6 ? step + 1 : step + 2, row: 1 };
}

/** The bar's two slots: the near one for seat 0's checkers, the far one for seat 1's. */
export function backgammonBarCell(seat: number): GridCell {
  return { column: BACKGAMMON_BAR_COLUMN, row: seat === 0 ? 2 : 1 };
}

// --- Ludo -------------------------------------------------------------------

/**
 * The ludo track as the engine NUMBERS it: 52 squares, thirteen to a side, seat
 * 0's entry square first.
 *
 * **The ring, not the printed cross.** The engine numbers the track 0…51 with the
 * four seats entering thirteen apart (`ludoEntry`), and its `ludoSquare` maps a
 * token's progress onto that numbering. Drawing the printed cross instead would
 * mean inventing a second mapping — from 0…51 to the arms of a cross — that no
 * engine could check, and a wrong guess there would put a token on a square the
 * rules do not agree with. So the board is drawn as the ring the engine numbers,
 * thirteen cells a side, with each seat's own six-square home run leading inward
 * from the corner it enters at: the picture says what the numbering says.
 */
export const LUDO_GRID = 14;
const LUDO_SIDE = 13;

/** The grid cell of one track square: up the left edge, across the top, down the right, back along the bottom. */
export function ludoTrackCell(square: number): GridCell {
  const wrapped = ((square % ludo.LUDO_TRACK) + ludo.LUDO_TRACK) % ludo.LUDO_TRACK;
  if (wrapped < LUDO_SIDE) return { column: 1, row: LUDO_GRID - wrapped };
  if (wrapped < 2 * LUDO_SIDE) return { column: 1 + (wrapped - LUDO_SIDE), row: 1 };
  if (wrapped < 3 * LUDO_SIDE) return { column: LUDO_GRID, row: 1 + (wrapped - 2 * LUDO_SIDE) };
  return { column: LUDO_GRID - (wrapped - 3 * LUDO_SIDE), row: LUDO_GRID };
}

/**
 * The six squares of one seat's home run, `step` 0…5, entered from the track
 * square just before that seat's own entry — which is how every printed board
 * works and the reason the runs start where they do.
 */
export function ludoHomeCell(seat: number, step: number): GridCell {
  if (seat === 0) return { column: 2 + step, row: 13 };
  if (seat === 1) return { column: 2 + step, row: 2 };
  if (seat === 2) return { column: 13 - step, row: 2 };
  return { column: 13 - step, row: 13 };
}

/**
 * One of a seat's four tokens, while it is still in the yard: a two-by-two block
 * of cells just inside that seat's corner, which is the one part of the board a
 * printed ludo board leaves empty too.
 */
export function ludoYardCell(seat: number, token: number): GridCell {
  const origin = seat === 0 ? { column: 3, row: 9 } : seat === 1 ? { column: 3, row: 3 } : seat === 2 ? { column: 10, row: 3 } : { column: 10, row: 9 };
  return {
    column: origin.column + (token % 2),
    row: origin.row + (Math.floor(token / 2) % 2),
  };
}

/**
 * Where one token is drawn, from its seat, its own index and its progress.
 *
 * `0` is the yard (the token's own slot in the block), `1…51` is the track
 * (`ludoSquare` says which square, and every token on that square is drawn in the
 * same cell), and `52…57` is the home run, whose last square is home itself.
 */
export function ludoTokenCell(seat: number, token: number, progress: number): GridCell {
  if (progress <= 0) return ludoYardCell(seat, token);
  if (progress <= 51) return ludoTrackCell(ludo.ludoSquare(seat, progress) ?? 0);
  return ludoHomeCell(seat, Math.min(5, progress - 52));
}
