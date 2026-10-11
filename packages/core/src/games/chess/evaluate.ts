import { BISHOP, BLACK, KING, KNIGHT, PAWN, QUEEN, ROOK, WHITE } from "./types.js";
import type { EnginePosition, Side } from "./types.js";

/**
 * The engine's opinion of a position, in centipawns, from the point of view of
 * the side to move.
 *
 * **Every number below is this project's own.** Nothing here is copied from, or
 * fitted to, another engine: the strong open engines are GPL (see the module
 * doc), and a table lifted from one would be both a licence problem and a
 * number this project cannot explain. The values are chosen so that the terms
 * DECIDE TIES rather than overrule material — a positional bonus is at most a
 * fifth of a pawn — which is why the engine plays sound but unspectacular
 * chess, and why every term below says what it is for.
 *
 * Material follows the classic ratios (a pawn is the unit; a knight is worth
 * about three of them, a rook five, a queen nine). Those ratios are not a
 * measurement of anything here: they are the arithmetic of how many squares a
 * piece can reach from the centre against how many of those squares it can
 * actually use, and they are what every chess player is taught.
 */
const MATERIAL: Record<number, number> = {
  [PAWN]: 100,
  [KNIGHT]: 320,
  [BISHOP]: 335,
  [ROOK]: 500,
  [QUEEN]: 900,
  [KING]: 0,
};

/** Two bishops cover both colours, which one bishop on its own never can. */
const BISHOP_PAIR = 30;

/** How much a knight and a bishop gain from standing nearer the centre, per step. */
const KNIGHT_CENTRALITY = 2;
const BISHOP_CENTRALITY = 1;

/**
 * A passed pawn's worth climbs with the rank that stands between it and
 * promotion, counted in steps from its own side's first rank (index 0 is a pawn
 * still on its home rank). The last entry is 0 because a pawn ON the eighth
 * rank is a promoted piece, not a pawn.
 */
const PASSED_PAWN = [0, 4, 8, 15, 25, 40, 60, 0] as const;

/** A pawn with no friendly pawn beside it cannot be defended by one. */
const ISOLATED_PAWN = 14;
/** A second pawn on a file can defend the first and blocks it in equal measure. */
const DOUBLED_PAWN = 12;

/** A rook on a file with no pawns at all, and on one with none of its owner's. */
const ROOK_OPEN_FILE = 12;
const ROOK_SEMI_OPEN_FILE = 6;

/** The king wants the centre once the board has emptied, and its own corner before. */
const KING_MIDGAME_CENTRALITY = 8;
const KING_ENDGAME_CENTRALITY = 6;
/** Each friendly pawn standing in front of the king, while the board is full. */
const KING_PAWN_SHIELD = 6;

/** The side to move has the initiative, and saying so breaks a large class of ties. */
const TEMPO = 10;

/** The material (pawns excluded, kings worth nothing) of a full board. */
const FULL_PHASE = 2 * (2 * MATERIAL[KNIGHT]! + 2 * MATERIAL[BISHOP]! + 2 * MATERIAL[ROOK]! + MATERIAL[QUEEN]!);

/**
 * How central a square is, from 0 on the rim to 7 in the middle of the four
 * centre squares. The distance is measured to the point where those four
 * squares meet, so the four score the same and the two file-centres are
 * symmetric.
 */
function centrality(square: number): number {
  const file = square & 7;
  const rank = square >> 4;
  return 7 - (Math.abs(file - 3.5) + Math.abs(rank - 3.5));
}

/** Scratch counters for the pawn-file terms; module scope so an eval allocates nothing. */
const whitePawnFiles = new Int32Array(8);
const blackPawnFiles = new Int32Array(8);

/**
 * The score. Two passes: the first sums material and the pawn-file counts, the
 * second asks the questions that need the whole board (passed pawns, which
 * files are open, what stands in front of a king).
 */
export function evaluate(position: EnginePosition): number {
  const board = position.board;
  whitePawnFiles.fill(0);
  blackPawnFiles.fill(0);

  let score = 0;
  let phase = 0;
  let whiteBishops = 0;
  let blackBishops = 0;

  for (let square = 0; square < 128; square++) {
    if (square & 0x88) continue;
    const piece = board[square]!;
    if (piece === 0) continue;
    const type = Math.abs(piece);
    const side: Side = piece > 0 ? WHITE : BLACK;
    const signed = side === WHITE ? 1 : -1;
    score += signed * MATERIAL[type]!;
    if (type !== PAWN && type !== KING) phase += MATERIAL[type]!;
    if (type === PAWN) {
      const files = side === WHITE ? whitePawnFiles : blackPawnFiles;
      files[square & 7] = files[square & 7]! + 1;
    } else if (type === KNIGHT) {
      score += signed * KNIGHT_CENTRALITY * centrality(square);
    } else if (type === BISHOP) {
      score += signed * BISHOP_CENTRALITY * centrality(square);
      if (side === WHITE) whiteBishops += 1;
      else blackBishops += 1;
    }
  }

  if (whiteBishops >= 2) score += BISHOP_PAIR;
  if (blackBishops >= 2) score -= BISHOP_PAIR;

  // 1 while the board is full, 0 when nothing but pawns and kings is left.
  const phaseFraction = Math.min(1, phase / FULL_PHASE);

  for (let square = 0; square < 128; square++) {
    if (square & 0x88) continue;
    const piece = board[square]!;
    if (piece === 0) continue;
    const type = Math.abs(piece);
    const side: Side = piece > 0 ? WHITE : BLACK;
    const signed = side === WHITE ? 1 : -1;
    const file = square & 7;
    const rank = square >> 4;

    if (type === PAWN) {
      const ownFiles = side === WHITE ? whitePawnFiles : blackPawnFiles;
      if (ownFiles[file]! > 1) score += signed * -DOUBLED_PAWN;
      const left = file === 0 ? 0 : ownFiles[file - 1]!;
      const right = file === 7 ? 0 : ownFiles[file + 1]!;
      if (left + right === 0) score += signed * -ISOLATED_PAWN;
      if (isPassedPawn(position, square, side)) {
        // The bonus depends on how far the pawn has come, from ITS side's view:
        // for black the same square is one rank further from promotion.
        score += signed * PASSED_PAWN[side === WHITE ? rank : 7 - rank]!;
      }
      continue;
    }

    if (type === ROOK) {
      let own = 0;
      let any = 0;
      for (let row = 0; row < 8; row++) {
        const pieceAhead = board[row * 16 + file]!;
        if (pieceAhead === 0) continue;
        if (Math.abs(pieceAhead) === PAWN) {
          any += 1;
          if (pieceAhead > 0 === (side === WHITE)) own += 1;
        }
      }
      if (any === 0) score += signed * ROOK_OPEN_FILE;
      else if (own === 0) score += signed * ROOK_SEMI_OPEN_FILE;
      continue;
    }

    if (type === KING) {
      const centre = centrality(square);
      score +=
        signed *
        centre *
        (KING_ENDGAME_CENTRALITY * (1 - phaseFraction) - KING_MIDGAME_CENTRALITY * phaseFraction);
      // The pawns in front of the king: the three files beside it, one rank
      // ahead of wherever it stands, while there is still an enemy queen to
      // make a draughty king worth attacking.
      let shield = 0;
      const forward = side === WHITE ? 1 : -1;
      const ahead = rank + forward;
      if (ahead >= 0 && ahead <= 7) {
        for (const across of [file - 1, file, file + 1]) {
          if (across < 0 || across > 7) continue;
          if (board[ahead * 16 + across] === side * PAWN) shield += 1;
        }
      }
      score += signed * KING_PAWN_SHIELD * shield * phaseFraction;
    }
  }

  return score * position.turn + TEMPO;
}

/**
 * Whether the pawn on `square` has a clear road: no enemy pawn on its own file
 * or either neighbouring one, anywhere ahead of it. Pawns only move forwards,
 * so "ahead" is the direction of the pawn's own side.
 */
function isPassedPawn(position: EnginePosition, square: number, side: Side): boolean {
  const file = square & 7;
  const rank = square >> 4;
  const forward = side === WHITE ? 1 : -1;
  for (const across of [file - 1, file, file + 1]) {
    if (across < 0 || across > 7) continue;
    for (let row = rank + forward; row >= 0 && row <= 7; row += forward) {
      if (position.board[row * 16 + across] === -side * PAWN) return false;
    }
  }
  return true;
}

/** The material balance alone, for a caller that wants no positional opinion. */
export function materialBalance(position: EnginePosition): number {
  let score = 0;
  for (let square = 0; square < 128; square++) {
    if (square & 0x88) continue;
    const piece = position.board[square]!;
    if (piece === 0) continue;
    score += piece > 0 ? MATERIAL[Math.abs(piece)]! : -MATERIAL[Math.abs(piece)]!;
  }
  return score * position.turn;
}

/** The piece values, so the search's move ordering and this file cannot disagree. */
export function pieceValue(type: number): number {
  return MATERIAL[type] ?? 0;
}

