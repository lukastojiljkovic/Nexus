import { BISHOP, KNIGHT, QUEEN, ROOK } from "./types.js";

/**
 * A move is a single integer, because the search makes and unmakes millions of
 * them: `from` and `to` are 0x88 squares (7 bits each), the promotion piece is
 * a type code, and three bits say which of the four special moves this is.
 *
 *     bits  0..6   from
 *     bits  7..13  to
 *     bits 14..16  promotion piece type (0 when the move does not promote)
 *     bits 17..19  flag
 *
 * Every field is written by `encodeMove` and read by the four readers below, so
 * the layout exists in one place. A number is not a `Move` object because the
 * hot path cannot afford one allocation per generated move; the type alias
 * `MoveCode` is what keeps that from being invisible at the call sites.
 */
export type MoveCode = number;

/** A quiet move, or any move whose special case the flag bits do not name. */
export const FLAG_NONE = 0;
/** The pawn moved to the en-passant square; the pawn it takes stands BEHIND that square. */
export const FLAG_EN_PASSANT = 1;
/** The king went two files towards its h-file rook. */
export const FLAG_KINGSIDE = 2;
/** The king went two files towards its a-file rook. */
export const FLAG_QUEENSIDE = 3;
/** A pawn went two squares and left an en-passant square behind it. */
export const FLAG_DOUBLE_PUSH = 4;

const PROMOTION_SHIFT = 14;
const FLAG_SHIFT = 17;

/** The four pieces a pawn may become, in the order the generator emits them. */
export const PROMOTION_PIECES = [QUEEN, ROOK, BISHOP, KNIGHT] as const;

/** `"q"`-style letters for the promotion pieces, and the UCI text's last field. */
const PROMOTION_LETTERS: Record<number, string> = {
  [QUEEN]: "q",
  [ROOK]: "r",
  [BISHOP]: "b",
  [KNIGHT]: "n",
};

/** Builds the integer a generator hands to `makeMove`. */
export function encodeMove(from: number, to: number, promotion: number, flag: number): MoveCode {
  return from | (to << 7) | (promotion << PROMOTION_SHIFT) | (flag << FLAG_SHIFT);
}

export function moveFrom(move: MoveCode): number {
  return move & 0x7f;
}

export function moveTo(move: MoveCode): number {
  return (move >> 7) & 0x7f;
}

/** The piece type a pawn becomes, or 0 for a move that does not promote. */
export function movePromotion(move: MoveCode): number {
  return (move >> PROMOTION_SHIFT) & 0x7;
}

export function moveFlag(move: MoveCode): number {
  return (move >> FLAG_SHIFT) & 0x7;
}

/** The 0x88 square for `"e4"`, or -1 when the text is not a square. */
export function squareIndex(name: string): number {
  if (name.length !== 2) return -1;
  const file = name.charCodeAt(0) - 97;
  const rank = name.charCodeAt(1) - 49;
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return -1;
  return rank * 16 + file;
}

/** `"e4"` for a 0x88 square. */
export function squareName(square: number): string {
  return String.fromCharCode(97 + (square & 7), 49 + (square >> 4));
}

/** The move as the UCI text stage 2 puts on the wire: `"e2e4"`, `"e7e8q"`. */
export function moveToUci(move: MoveCode): string {
  const promotion = movePromotion(move);
  return `${squareName(moveFrom(move))}${squareName(moveTo(move))}${
    promotion === 0 ? "" : PROMOTION_LETTERS[promotion]!
  }`;
}

/**
 * Reads UCI text back to the same canonical spelling, or null. Deliberately a
 * pure string check: whether the move is LEGAL is `uciToMove`'s question, and a
 * text parser that answered both would be two refusals wearing one name.
 */
export function normalizeUci(uci: string): string | null {
  const text = uci.trim().toLowerCase();
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(text)) return null;
  return text;
}

