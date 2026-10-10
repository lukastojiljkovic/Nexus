/**
 * The engine's vocabulary: what a board entry is, what a side is, and the two
 * records the search passes between its own modules.
 *
 * This file imports nothing, on purpose. `position`, `move`, `movegen`,
 * `evaluate` and `search` all speak these names, and any one of them importing
 * another to reach a constant would make the import graph a cycle that works
 * until the day one of the constants moves.
 */

/** Pawn, knight, bishop, rook, queen, king — the magnitude of a board entry. */
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

/** White is `+1` and black is `-1`: the SIGN of a board entry is its side. */
export const WHITE = 1;
export const BLACK = -1;
export type Side = 1 | -1;

/** Castling rights, one bit each, in the order `KQkq` of a FEN. */
export const CASTLE_WHITE_KING = 1;
export const CASTLE_WHITE_QUEEN = 2;
export const CASTLE_BLACK_KING = 4;
export const CASTLE_BLACK_QUEEN = 8;

/**
 * A position on the 0x88 board, and the state the rules need beyond the
 * thirty-two pieces.
 *
 * **Why 0x88 rather than a mailbox or bitboards.** A square is `rank * 16 +
 * file`, so the low three bits are the file and bits 4–6 are the rank; a square
 * is off the board exactly when `square & 0x88` is non-zero. That single test
 * replaces both the file and the rank bound check at every step of every sliding
 * ray, which is the bulk of move generation, and it also makes the sixteen-wide
 * layout line up with the two-square pawn push. Bitboards would be faster still,
 * but their cost is that every rule becomes a shift mask, and this engine is
 * read far more often than it is benchmarked.
 *
 * The two hash halves are kept incrementally by `makeMove` and verified from
 * scratch by `verifyPositionHash`, which the tests run over random play.
 */
export interface EnginePosition {
  /** 128 entries; 0 is empty, `±PAWN..±KING` a piece. Only `& 0x88 === 0` squares are used. */
  board: Int8Array;
  /** Whose turn it is. */
  turn: Side;
  /** A mask of the four `CASTLE_*` bits. */
  castling: number;
  /** The square a pawn may capture onto en passant, or -1. */
  ep: number;
  /** Plies since the last capture or pawn move — the fifty-move rule's clock. */
  halfmove: number;
  /** The move number, as a FEN carries it: 1 to start. */
  fullmove: number;
  /** Where the two kings stand, `[white, black]`, so legality never has to scan. */
  kings: [number, number];
  /** The transposition table's first half — the index. */
  key: number;
  /** The transposition table's second half — what makes a hit a fact. */
  lock: number;
}

/**
 * What `makeMove` leaves behind for `unmakeMove`: one of these per ply, written
 * into the caller's own record so a search allocates none of them.
 */
export interface Undo {
  move: number;
  /** The captured piece, or 0. */
  captured: number;
  /** Where it stood — not always the destination, because en passant captures behind. */
  capturedSquare: number;
  castling: number;
  ep: number;
  halfmove: number;
  fullmove: number;
  key: number;
  lock: number;
  /** The rook's two squares when the move was a castle, or -1. */
  rookFrom: number;
  rookTo: number;
}

/** A fresh `Undo` record. `makeMove` writes every field, so only `move` matters here. */
export function newUndo(): Undo {
  return {
    move: 0,
    captured: 0,
    capturedSquare: 0,
    castling: 0,
    ep: -1,
    halfmove: 0,
    fullmove: 1,
    key: 0,
    lock: 0,
    rookFrom: -1,
    rookTo: -1,
  };
}

