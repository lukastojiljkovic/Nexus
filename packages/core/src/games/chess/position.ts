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
} from "./types.js";
import { newUndo } from "./types.js";
import type { EnginePosition, Side, Undo } from "./types.js";
import {
  FLAG_DOUBLE_PUSH,
  FLAG_EN_PASSANT,
  FLAG_KINGSIDE,
  FLAG_QUEENSIDE,
  encodeMove,
  moveFlag,
  moveFrom,
  movePromotion,
  moveTo,
  squareIndex,
  squareName,
} from "./move.js";

/** The position every game starts from, spelled out once. */
export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/**
 * Thrown when a position cannot be parsed, or when a caller asks the engine to
 * play a move that is not legal. The engine's own error, distinct from the
 * database's `ChessValidationError`: this one is raised inside `@nexus/core`,
 * which knows nothing about stores or profiles.
 */
export class ChessError extends Error {}

/** The piece letters a FEN uses, signed: white is positive. */
const PIECE_BY_LETTER: Record<string, number> = {
  P: PAWN,
  N: KNIGHT,
  B: BISHOP,
  R: ROOK,
  Q: QUEEN,
  K: KING,
  p: -PAWN,
  n: -KNIGHT,
  b: -BISHOP,
  r: -ROOK,
  q: -QUEEN,
  k: -KING,
};

/** The letter for a board entry, the inverse of the table above. */
function letterOf(piece: number): string {
  const letters = ["", "p", "n", "b", "r", "q", "k"];
  const letter = letters[Math.abs(piece)]!;
  return piece > 0 ? letter.toUpperCase() : letter;
}

/** Knight and king step offsets, and the four ray directions of each slider. */
const KNIGHT_OFFSETS = [-18, -33, -31, -14, 14, 31, 33, 18] as const;
const KING_OFFSETS = [-17, -16, -15, -1, 1, 15, 16, 17] as const;
const BISHOP_OFFSETS = [-17, -15, 15, 17] as const;
const ROOK_OFFSETS = [-16, -1, 1, 16] as const;

export { KNIGHT_OFFSETS, KING_OFFSETS, BISHOP_OFFSETS, ROOK_OFFSETS };

/** The slot a piece-and-square pair occupies in the Zobrist tables. */
function pieceIndex(piece: number): number {
  return (Math.abs(piece) - 1) * 2 + (piece > 0 ? 0 : 1);
}

/**
 * Zobrist keys, generated once from a fixed seed — never from the clock or a
 * random source, because two runs of the same search have to produce the same
 * game. Two independent 32-bit halves are kept per feature: 32 bits alone start
 * colliding once a table holds tens of thousands of entries, and a transposition
 * hit that is not a transposition is a wrong score reported as a certainty.
 *
 * The generator is an xorshift32, which is not a cryptographic source and does
 * not need to be: nothing here is a secret, and an adversary who can choose a
 * position to force a collision gains one bad move in their own game.
 *
 * The tables are built inside a function and only assigned at module scope, so
 * the module does nothing at import time but compute its own constants
 * (`scripts/package-side-effects.test.mjs`, rule 4).
 */
function zobristTables() {
  let state = 0x1234abcd;
  const next = (): number => {
    let x = state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x >>>= 0;
    x ^= x << 5;
    x >>>= 0;
    state = x;
    return x | 0;
  };
  // A key and then its lock for each index, table after table: the draw order fixes every value.
  const pair = (length: number): [Int32Array, Int32Array] => {
    const keys = new Int32Array(length);
    const locks = new Int32Array(length);
    for (let index = 0; index < length; index++) {
      keys[index] = next();
      locks[index] = next();
    }
    return [keys, locks];
  };
  const pieces = pair(12 * 128);
  const castling = pair(16);
  const ep = pair(8);
  return { pieces, castling, ep, side: [next(), next()] as const };
}

const ZOBRIST = zobristTables();
const [PIECE_KEYS, PIECE_LOCKS] = ZOBRIST.pieces;
const [CASTLING_KEYS, CASTLING_LOCKS] = ZOBRIST.castling;
const [EP_KEYS, EP_LOCKS] = ZOBRIST.ep;
const [sideKey, sideLock] = ZOBRIST.side;

/**
 * Both hash halves, computed from the board rather than carried. `makeMove` keeps
 * them incrementally for speed; this is the definition, and
 * `verifyPositionHash` uses it to prove the incremental version has not drifted
 * over a long game.
 */
export function computeKeys(position: EnginePosition): { key: number; lock: number } {
  let key = 0;
  let lock = 0;
  for (let square = 0; square < 128; square++) {
    if (square & 0x88) continue;
    const piece = position.board[square]!;
    if (piece === 0) continue;
    const index = pieceIndex(piece) * 128 + square;
    key ^= PIECE_KEYS[index]!;
    lock ^= PIECE_LOCKS[index]!;
  }
  key ^= CASTLING_KEYS[position.castling]!;
  lock ^= CASTLING_LOCKS[position.castling]!;
  if (position.ep !== -1) {
    key ^= EP_KEYS[position.ep & 7]!;
    lock ^= EP_LOCKS[position.ep & 7]!;
  }
  if (position.turn === BLACK) {
    key ^= sideKey;
    lock ^= sideLock;
  }
  return { key, lock };
}

/** True when the position's carried hash still matches the board it describes. */
export function verifyPositionHash(position: EnginePosition): boolean {
  const { key, lock } = computeKeys(position);
  return key === position.key && lock === position.lock;
}

/** Where `side`'s king stands in this position. */
export function kingSquare(position: EnginePosition, side: Side): number {
  return side === WHITE ? position.kings[0] : position.kings[1];
}

/**
 * Whether `bySide` attacks `square` — the single question every legality test
 * is built out of. Pawns are looked up BACKWARDS from the square (a white pawn
 * attacks `s + 15` and `s + 17`, so a white pawn attacking `s` stands on
 * `s - 15` or `s - 17`), and the sliders walk outwards until the first piece.
 */
export function isAttacked(position: EnginePosition, square: number, bySide: Side): boolean {
  const board = position.board;

  // A white pawn on `s` attacks `s + 15` and `s + 17`, so the pawn that attacks
  // `s` stands one of the two offsets below away from it, backwards.
  for (const delta of bySide === WHITE ? [-15, -17] : [15, 17]) {
    const from = square + delta;
    if (!(from & 0x88) && board[from] === bySide * PAWN) return true;
  }

  for (const offset of KNIGHT_OFFSETS) {
    const from = square + offset;
    if (!(from & 0x88) && board[from] === bySide * KNIGHT) return true;
  }

  for (const offset of KING_OFFSETS) {
    const from = square + offset;
    if (!(from & 0x88) && board[from] === bySide * KING) return true;
  }

  for (const offset of ROOK_OFFSETS) {
    for (let from = square + offset; !(from & 0x88); from += offset) {
      const piece = board[from]!;
      if (piece === 0) continue;
      if (piece === bySide * ROOK || piece === bySide * QUEEN) return true;
      break;
    }
  }
  for (const offset of BISHOP_OFFSETS) {
    for (let from = square + offset; !(from & 0x88); from += offset) {
      const piece = board[from]!;
      if (piece === 0) continue;
      if (piece === bySide * BISHOP || piece === bySide * QUEEN) return true;
      break;
    }
  }

  return false;
}

/**
 * Parses a FEN, or returns null.
 *
 * **Two fields are enough.** Every human writes a position as placement plus
 * side to move, and often with the castling and en-passant fields and without
 * the clocks — the brief's Kiwipete among them. An absent field takes its
 * documented default: `-` for castling and en passant, `0` and `1` for the
 * clocks. Six fields is the whole of what is accepted; an abbreviated form with
 * a ninth rank, two consecutive digits, or a king missing is not a position and
 * gets the same null as any other nonsense.
 *
 * **A position whose side NOT to move is in check is refused**, which `chess.js`
 * does not refuse. The rules engine can be handed any text; the SEARCH cannot be
 * handed a position that cannot arise, because its mate scores and its legality
 * filter both assume the last move was legal.
 */
export function parseFen(fen: string): EnginePosition | null {
  const fields = fen.trim().split(/\s+/);
  if (fields.length < 2 || fields.length > 6) return null;
  const placement = fields[0]!;
  const turnField = fields[1]!;
  const castlingField = fields[2] ?? "-";
  const epField = fields[3] ?? "-";
  const halfmoveField = fields[4] ?? "0";
  const fullmoveField = fields[5] ?? "1";
  if (turnField !== "w" && turnField !== "b") return null;
  if (castlingField !== "-" && !/^K?Q?k?q?$/.test(castlingField)) return null;
  if (!/^\d+$/.test(halfmoveField) || !/^\d+$/.test(fullmoveField)) return null;

  const board = new Int8Array(128);
  const ranks = placement.split("/");
  if (ranks.length !== 8) return null;
  const kings: [number, number] = [-1, -1];
  for (let row = 0; row < 8; row++) {
    let file = 0;
    let previousWasDigit = false;
    for (const character of ranks[row]!) {
      const digit = character >= "1" && character <= "8";
      // `44` and `91` are not FEN, however they add up: one digit per gap.
      if (digit && previousWasDigit) return null;
      previousWasDigit = digit;
      if (digit) {
        file += Number(character);
        continue;
      }
      const piece = PIECE_BY_LETTER[character];
      if (piece === undefined || file > 7) return null;
      const square = (7 - row) * 16 + file;
      board[square] = piece;
      if (piece === KING) kings[0] = square;
      else if (piece === -KING) kings[1] = square;
      file += 1;
    }
    if (file !== 8) return null;
  }
  if (kings[0] < 0 || kings[1] < 0) return null;

  let ep = -1;
  if (epField !== "-") {
    ep = squareIndex(epField);
    if (ep < 0) return null;
  }

  let castling = 0;
  if (castlingField.includes("K")) castling |= CASTLE_WHITE_KING;
  if (castlingField.includes("Q")) castling |= CASTLE_WHITE_QUEEN;
  if (castlingField.includes("k")) castling |= CASTLE_BLACK_KING;
  if (castlingField.includes("q")) castling |= CASTLE_BLACK_QUEEN;

  const turn: Side = turnField === "w" ? WHITE : BLACK;
  const position: EnginePosition = {
    board,
    turn,
    castling,
    ep,
    halfmove: Number(halfmoveField),
    fullmove: Number(fullmoveField),
    kings,
    key: 0,
    lock: 0,
  };
  // The side that is NOT to move has just moved, and it may not have left its
  // own king in check: nothing about that position is reachable, and every mate
  // score below assumes reachability. The side to move being in check is
  // ordinary — that is what a check is.
  const them: Side = turn === WHITE ? BLACK : WHITE;
  if (isAttacked(position, kingSquare(position, them), turn)) return null;

  const { key, lock } = computeKeys(position);
  position.key = key;
  position.lock = lock;
  return position;
}

/** The `KQkq` field of a FEN, or `-`. */
function castlingText(castling: number): string {
  let text = "";
  if (castling & CASTLE_WHITE_KING) text += "K";
  if (castling & CASTLE_WHITE_QUEEN) text += "Q";
  if (castling & CASTLE_BLACK_KING) text += "k";
  if (castling & CASTLE_BLACK_QUEEN) text += "q";
  return text === "" ? "-" : text;
}

/**
 * The en-passant field.
 *
 * A FEN prints the square only when the capture is actually available — both the
 * capturing pawn and the pawn it would take must be there, and the capture must
 * not leave its own king in check. `chess.js` prints it on exactly those terms
 * (`chess.js`'s `fen()`), and this has to agree with it to the character: the
 * cross-check test compares whole FENs, and a field that is printed one move too
 * often would read as a rules disagreement that is not there.
 */
function epField(position: EnginePosition): string {
  const ep = position.ep;
  if (ep === -1) return "-";
  const side = position.turn;
  const back = side === WHITE ? -16 : 16;
  // `ep + back` is the square the pawn that may be captured FROM stands on: the
  // double push passed over `ep`, so the pawn is one step behind it, on the far
  // side from the capture.
  if (position.board[ep + back] !== -side * PAWN) return "-";
  for (const delta of [-1, 1]) {
    const from = ep + back + delta;
    if (from & 0x88) continue;
    if (position.board[from] !== side * PAWN) continue;
    const undo = newUndo();
    makeMove(position, encodeMove(from, ep, 0, FLAG_EN_PASSANT), undo);
    const legal = !isAttacked(position, kingSquare(position, side), side === WHITE ? BLACK : WHITE);
    unmakeMove(position, undo);
    if (legal) return squareName(ep);
  }
  return "-";
}

/** The position as a six-field FEN, in the canonical spelling `chess.js` writes. */
export function toFen(position: EnginePosition): string {
  const rows: string[] = [];
  for (let row = 0; row < 8; row++) {
    let text = "";
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const piece = position.board[(7 - row) * 16 + file]!;
      if (piece === 0) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        text += empty;
        empty = 0;
      }
      text += letterOf(piece);
    }
    if (empty > 0) text += empty;
    rows.push(text);
  }
  const turn = position.turn === WHITE ? "w" : "b";
  return `${rows.join("/")} ${turn} ${castlingText(position.castling)} ${epField(position)} ${position.halfmove} ${position.fullmove}`;
}

/**
 * Plays `move` on `position`, recording what `unmakeMove` needs into `undo`.
 *
 * Every special case is handled here and nowhere else: the en-passant capture
 * removes a pawn BEHIND the destination, a castle moves a rook the generator
 * never mentioned, a promotion replaces the pawn that arrived, and both halves of
 * the Zobrist key are carried forward field by field.
 */
export function makeMove(position: EnginePosition, move: number, undo: Undo): void {
  const board = position.board;
  const from = moveFrom(move);
  const to = moveTo(move);
  const promotion = movePromotion(move);
  const flag = moveFlag(move);
  const side = position.turn;
  const piece = board[from]!;
  // The board entry is SIGNED, so a black king is `-KING`: every question about
  // what a piece IS asks the magnitude, and only a question about whose it is
  // reads the sign.
  const type = Math.abs(piece);

  let captured = board[to]!;
  let capturedSquare = to;
  if (flag === FLAG_EN_PASSANT) {
    capturedSquare = to - side * 16;
    captured = board[capturedSquare]!;
  }

  undo.move = move;
  undo.captured = captured;
  undo.capturedSquare = capturedSquare;
  undo.castling = position.castling;
  undo.ep = position.ep;
  undo.halfmove = position.halfmove;
  undo.fullmove = position.fullmove;
  undo.key = position.key;
  undo.lock = position.lock;
  undo.rookFrom = -1;
  undo.rookTo = -1;

  let key = position.key;
  let lock = position.lock;
  // Everything the OLD state contributed comes out first, and the new state's
  // terms go in at the end: one place per field, so the two halves cannot drift.
  if (position.ep !== -1) {
    key ^= EP_KEYS[position.ep & 7]!;
    lock ^= EP_LOCKS[position.ep & 7]!;
  }
  key ^= CASTLING_KEYS[position.castling]!;
  lock ^= CASTLING_LOCKS[position.castling]!;
  key ^= sideKey;
  lock ^= sideLock;

  if (captured !== 0) {
    const index = pieceIndex(captured) * 128 + capturedSquare;
    key ^= PIECE_KEYS[index]!;
    lock ^= PIECE_LOCKS[index]!;
    board[capturedSquare] = 0;
  }
  const fromIndex = pieceIndex(piece) * 128 + from;
  key ^= PIECE_KEYS[fromIndex]!;
  lock ^= PIECE_LOCKS[fromIndex]!;
  board[from] = 0;

  const placed = promotion === 0 ? piece : side * promotion;
  const toIndex = pieceIndex(placed) * 128 + to;
  key ^= PIECE_KEYS[toIndex]!;
  lock ^= PIECE_LOCKS[toIndex]!;
  board[to] = placed;

  if (type === KING) {
    if (side === WHITE) position.kings[0] = to;
    else position.kings[1] = to;
  }

  if (flag === FLAG_KINGSIDE || flag === FLAG_QUEENSIDE) {
    const rank = side === WHITE ? 0 : 7;
    const rookFrom = rank * 16 + (flag === FLAG_KINGSIDE ? 7 : 0);
    const rookTo = rank * 16 + (flag === FLAG_KINGSIDE ? 5 : 3);
    const rook = side * ROOK;
    undo.rookFrom = rookFrom;
    undo.rookTo = rookTo;
    const outIndex = pieceIndex(rook) * 128 + rookFrom;
    const inIndex = pieceIndex(rook) * 128 + rookTo;
    key ^= PIECE_KEYS[outIndex]! ^ PIECE_KEYS[inIndex]!;
    lock ^= PIECE_LOCKS[outIndex]! ^ PIECE_LOCKS[inIndex]!;
    board[rookFrom] = 0;
    board[rookTo] = rook;
  }

  // A right is lost when the king moves, when a rook leaves its corner, or when
  // the corner is captured — the last one is why this reads `capturedSquare` and
  // not only the moving piece.
  let castling = position.castling;
  if (type === KING) {
    castling &= side === WHITE
      ? ~(CASTLE_WHITE_KING | CASTLE_WHITE_QUEEN)
      : ~(CASTLE_BLACK_KING | CASTLE_BLACK_QUEEN);
  } else if (type === ROOK) {
    if (from === 0) castling &= ~CASTLE_WHITE_QUEEN;
    else if (from === 7) castling &= ~CASTLE_WHITE_KING;
    else if (from === 112) castling &= ~CASTLE_BLACK_QUEEN;
    else if (from === 119) castling &= ~CASTLE_BLACK_KING;
  }
  if (capturedSquare === 0) castling &= ~CASTLE_WHITE_QUEEN;
  else if (capturedSquare === 7) castling &= ~CASTLE_WHITE_KING;
  else if (capturedSquare === 112) castling &= ~CASTLE_BLACK_QUEEN;
  else if (capturedSquare === 119) castling &= ~CASTLE_BLACK_KING;
  castling &= 0xf;

  const ep = flag === FLAG_DOUBLE_PUSH ? (from + to) / 2 : -1;
  position.halfmove = Math.abs(piece) === PAWN || captured !== 0 ? 0 : position.halfmove + 1;
  if (side === BLACK) position.fullmove += 1;
  position.turn = side === WHITE ? BLACK : WHITE;
  position.castling = castling;
  position.ep = ep;

  if (ep !== -1) {
    key ^= EP_KEYS[ep & 7]!;
    lock ^= EP_LOCKS[ep & 7]!;
  }
  key ^= CASTLING_KEYS[castling]!;
  lock ^= CASTLING_LOCKS[castling]!;
  position.key = key;
  position.lock = lock;
}

/**
 * Takes back the move `undo` was written for. `position` has to be in the exact
 * state `makeMove` left it in — the search's own discipline, and the reason the
 * hash is restored outright rather than unwound by a second XOR sequence that
 * would have to mirror every step above.
 */
export function unmakeMove(position: EnginePosition, undo: Undo): void {
  const board = position.board;
  const move = undo.move;
  const from = moveFrom(move);
  const to = moveTo(move);
  const side = position.turn === WHITE ? BLACK : WHITE;
  const piece = board[to]!;
  const original = movePromotion(move) === 0 ? piece : side * PAWN;

  board[to] = 0;
  board[from] = original;
  if (undo.captured !== 0) board[undo.capturedSquare] = undo.captured;
  if (undo.rookFrom !== -1) {
    board[undo.rookTo] = 0;
    board[undo.rookFrom] = side * ROOK;
  }
  if (Math.abs(original) === KING) {
    if (side === WHITE) position.kings[0] = from;
    else position.kings[1] = from;
  }

  position.turn = side;
  position.castling = undo.castling;
  position.ep = undo.ep;
  position.halfmove = undo.halfmove;
  position.fullmove = undo.fullmove;
  position.key = undo.key;
  position.lock = undo.lock;
}

