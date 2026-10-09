import {
  BISHOP_OFFSETS,
  KING_OFFSETS,
  KNIGHT_OFFSETS,
  ROOK_OFFSETS,
  isAttacked,
  kingSquare,
  makeMove,
  unmakeMove,
} from "./position.js";
import {
  BISHOP,
  BLACK,
  CASTLE_BLACK_KING,
  CASTLE_BLACK_QUEEN,
  CASTLE_WHITE_KING,
  CASTLE_WHITE_QUEEN,
  KING,
  KNIGHT,
  PAWN,
  QUEEN,
  ROOK,
  WHITE,
  newUndo,
} from "./types.js";
import type { EnginePosition, Side } from "./types.js";
import {
  FLAG_DOUBLE_PUSH,
  FLAG_EN_PASSANT,
  FLAG_KINGSIDE,
  FLAG_NONE,
  FLAG_QUEENSIDE,
  PROMOTION_PIECES,
  encodeMove,
  moveFlag,
  moveFrom,
  movePromotion,
  moveTo,
  moveToUci,
  normalizeUci,
  squareName,
} from "./move.js";
import type { MoveCode } from "./move.js";

export { moveToUci } from "./move.js";
export { squareIndex, squareName } from "./move.js";

/**
 * Move generation, in two layers.
 *
 * `pseudoLegalMoves` emits every move a piece could make if its own king did not
 * matter, and `legalMoves` filters that list by playing each move and asking
 * whether the mover's king is attacked. Generating LEGAL moves directly is
 * possible — it means carrying pins and discovered checks — and it is what a
 * production engine does for speed; here the filter costs one make/unmake per
 * candidate and buys the guarantee that there is exactly one place where
 * legality is decided. A pin that the filter forgets does not exist.
 *
 * `legalMoves` takes an optional array to fill, because the search reuses one
 * per ply: generating a list per node is the allocation the search cannot afford.
 */

/**
 * Emits every move of `position`'s side that does not consider its own check.
 *
 * `capturesOnly` is the quiescence search's request and not a filter applied
 * afterwards: at a quiet leaf only captures, en-passant captures and promotions
 * are worth a node, and generating the other twenty-odd moves to throw them away
 * is most of the cost of the search's busiest function.
 */
export function pseudoLegalMoves(
  position: EnginePosition,
  into: number[] = [],
  capturesOnly = false,
): number[] {
  into.length = 0;
  const board = position.board;
  const side = position.turn;
  for (let square = 0; square < 128; square++) {
    if (square & 0x88) continue;
    const piece = board[square]!;
    if (piece === 0 || (piece > 0 ? WHITE : BLACK) !== side) continue;
    const type = Math.abs(piece);

    if (type === PAWN) {
      pawnMoves(position, square, into, capturesOnly);
      continue;
    }
    if (type === KNIGHT) {
      for (const offset of KNIGHT_OFFSETS) {
        const to = square + offset;
        if (to & 0x88) continue;
        if (board[to] === 0) {
          if (!capturesOnly) into.push(encodeMove(square, to, 0, FLAG_NONE));
        } else if ((board[to]! > 0 ? WHITE : BLACK) !== side) {
          into.push(encodeMove(square, to, 0, FLAG_NONE));
        }
      }
      continue;
    }
    if (type === KING) {
      for (const offset of KING_OFFSETS) {
        const to = square + offset;
        if (to & 0x88) continue;
        if (board[to] === 0) {
          if (!capturesOnly) into.push(encodeMove(square, to, 0, FLAG_NONE));
        } else if ((board[to]! > 0 ? WHITE : BLACK) !== side) {
          into.push(encodeMove(square, to, 0, FLAG_NONE));
        }
      }
      if (!capturesOnly) castlingMoves(position, square, into);
      continue;
    }

    const offsets =
      type === ROOK
        ? ROOK_OFFSETS
        : type === BISHOP
          ? BISHOP_OFFSETS
          : [...ROOK_OFFSETS, ...BISHOP_OFFSETS];
    for (const offset of offsets) {
      for (let to = square + offset; !(to & 0x88); to += offset) {
        const target = board[to]!;
        if (target === 0) {
          if (!capturesOnly) into.push(encodeMove(square, to, 0, FLAG_NONE));
          continue;
        }
        if ((target > 0 ? WHITE : BLACK) !== side) into.push(encodeMove(square, to, 0, FLAG_NONE));
        break;
      }
    }
  }
  return into;
}

/** A pawn's quiet pushes (with every promotion), its captures, and en passant. */
function pawnMoves(
  position: EnginePosition,
  square: number,
  into: number[],
  capturesOnly: boolean,
): number[] {
  const board = position.board;
  const side = position.turn;
  const forward = side * 16;
  const startRank = side === WHITE ? 1 : 6;
  const promotionRank = side === WHITE ? 7 : 0;

  const one = square + forward;
  if (!(one & 0x88) && board[one] === 0) {
    // A promotion is worth a quiescence node even though nothing was captured:
    // the piece that appears is worth more than the pawn that left.
    if (!capturesOnly || one >> 4 === promotionRank) {
      pushPawnMove(square, one, promotionRank, FLAG_NONE, into);
    }
    const two = one + forward;
    if (!capturesOnly && !(two & 0x88) && board[two] === 0 && square >> 4 === startRank) {
      into.push(encodeMove(square, two, 0, FLAG_DOUBLE_PUSH));
    }
  }

  for (const delta of [forward - 1, forward + 1]) {
    const to = square + delta;
    if (to & 0x88) continue;
    const target = board[to]!;
    if (target !== 0) {
      if ((target > 0 ? WHITE : BLACK) !== side) {
        pushPawnMove(square, to, promotionRank, FLAG_NONE, into);
      }
      continue;
    }
    // En passant, and only when the pawn it claims to take is really there: a
    // FEN's ep square is data from outside, and a capture of nothing is a
    // silently wrong board rather than an error.
    if (to === position.ep && board[to - forward] === -side * PAWN) {
      into.push(encodeMove(square, to, 0, FLAG_EN_PASSANT));
    }
  }
  return into;
}

/** One pawn move, once per promotion piece when it reaches the last rank. */
function pushPawnMove(
  from: number,
  to: number,
  promotionRank: number,
  flag: number,
  into: number[],
): void {
  if (to >> 4 === promotionRank) {
    for (const promotion of PROMOTION_PIECES) into.push(encodeMove(from, to, promotion, flag));
    return;
  }
  into.push(encodeMove(from, to, 0, flag));
}

/**
 * Castling, on the four conditions the rules actually state: the right is still
 * held, the squares between are empty (all three on the queenside, because the
 * rook has to pass b1), the king is not in check, and the square it crosses is
 * not attacked. The king's own destination is checked by `legalMoves`' filter
 * like any other move.
 */
function castlingMoves(position: EnginePosition, square: number, into: number[]): number[] {
  const board = position.board;
  const side = position.turn;
  const them = side === WHITE ? BLACK : WHITE;
  const rank = side === WHITE ? 0 : 7;

  if (square !== rank * 16 + 4) return into;
  if (isAttacked(position, square, them)) return into;

  const kingSide = side === WHITE ? CASTLE_WHITE_KING : CASTLE_BLACK_KING;
  const queenSide = side === WHITE ? CASTLE_WHITE_QUEEN : CASTLE_BLACK_QUEEN;
  const rook = side * ROOK;

  if (
    position.castling & kingSide &&
    board[rank * 16 + 7] === rook &&
    board[rank * 16 + 5] === 0 &&
    board[rank * 16 + 6] === 0 &&
    !isAttacked(position, rank * 16 + 5, them) &&
    !isAttacked(position, rank * 16 + 6, them)
  ) {
    into.push(encodeMove(square, rank * 16 + 6, 0, FLAG_KINGSIDE));
  }
  if (
    position.castling & queenSide &&
    board[rank * 16] === rook &&
    board[rank * 16 + 1] === 0 &&
    board[rank * 16 + 2] === 0 &&
    board[rank * 16 + 3] === 0 &&
    !isAttacked(position, rank * 16 + 3, them) &&
    !isAttacked(position, rank * 16 + 2, them)
  ) {
    into.push(encodeMove(square, rank * 16 + 2, 0, FLAG_QUEENSIDE));
  }
  return into;
}

/**
 * Where `pseudoLegalMoves` puts its list before it is filtered. Module scope and
 * reused on every call, deliberately: generation never recurses, so one scratch
 * array is enough, and the alternative is an allocation per node.
 */
const PSEUDO_SCRATCH: number[] = [];

/** Every legal move of `position`'s side, the pseudo-legal list filtered by check. */
export function legalMoves(
  position: EnginePosition,
  into: number[] = [],
  capturesOnly = false,
): number[] {
  const pseudo = pseudoLegalMoves(position, PSEUDO_SCRATCH, capturesOnly);
  into.length = 0;
  const side = position.turn;
  const them: Side = side === WHITE ? BLACK : WHITE;
  const undo = newUndo();
  for (const move of pseudo) {
    makeMove(position, move, undo);
    const attacked = isAttacked(position, kingSquare(position, side), them);
    unmakeMove(position, undo);
    if (!attacked) into.push(move);
  }
  return into;
}

/**
 * The legal move whose UCI text is `uci`, or null. An illegal move is a null
 * here and not a thrown error: this is the lookup the caller uses to decide, and
 * throwing would make "is this legal" a control flow made of exceptions.
 */
export function uciToMove(position: EnginePosition, uci: string): MoveCode | null {
  const text = normalizeUci(uci);
  if (text === null) return null;
  for (const move of legalMoves(position)) {
    if (moveToUci(move) === text) return move;
  }
  return null;
}

/**
 * Plays a legal move, named in UCI, on `position`. False when the move is not
 * legal here — the position is then untouched, which is what makes this usable
 * as a validator as well as a play.
 */
export function playMove(position: EnginePosition, uci: string): boolean {
  const move = uciToMove(position, uci);
  if (move === null) return false;
  makeMove(position, move, newUndo());
  return true;
}

/** The three fields of a move in algebraic terms — what a UI draws from. */
export interface MoveSquares {
  from: string;
  to: string;
  promotion: "q" | "r" | "b" | "n" | null;
}

const PROMOTION_NAMES: Record<number, "q" | "r" | "b" | "n"> = {
  [QUEEN]: "q",
  [ROOK]: "r",
  [BISHOP]: "b",
  [KNIGHT]: "n",
};

export function moveSquares(move: MoveCode): MoveSquares {
  const promotion = movePromotion(move);
  return {
    from: squareName(moveFrom(move)),
    to: squareName(moveTo(move)),
    promotion: promotion === 0 ? null : PROMOTION_NAMES[promotion]!,
  };
}

/** Whether `move` takes a piece — the question the quiescence search asks. */
export function isCapture(position: EnginePosition, move: MoveCode): boolean {
  return position.board[moveTo(move)] !== 0 || moveFlag(move) === FLAG_EN_PASSANT;
}

