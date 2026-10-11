import { ChessError, isAttacked, kingSquare, makeMove, parseFen, unmakeMove } from "./position.js";
import { BLACK, PAWN, WHITE, newUndo } from "./types.js";
import type { EnginePosition, Side, Undo } from "./types.js";
import { evaluate, pieceValue } from "./evaluate.js";
import { legalMoves, moveToUci } from "./movegen.js";
import {
  FLAG_EN_PASSANT,
  moveFlag,
  moveFrom,
  movePromotion,
  moveTo,
} from "./move.js";

/**
 * The search: iterative deepening alpha-beta over the move generator, with a
 * quiescence search at the leaves, MVV-LVA capture ordering, two killer moves
 * per ply, and a fixed-size transposition table.
 *
 * **A score is centipawns from the side to move**, and a mate is folded into the
 * number: a move that mates in one scores `MATE_SCORE - 1`, in two
 * `MATE_SCORE - 3`, and so on, so "how soon" survives the minimax as well as
 * "whether". Nothing below `MATE_THRESHOLD` is a mate, which is why the search
 * can stop deepening the moment one is found.
 *
 * **It is interruptible by construction.** Nothing here calls the clock or a
 * random source: `now`, `shouldStop` and `maxNodes` arrive from the caller, and
 * when either budget runs out the partial iteration is DISCARDED — a score that
 * came from a half-searched move list is worse than the answer from the depth
 * before it.
 *
 * **A check extension is deliberately absent.** It is a real strength gain in a
 * mature engine and it multiplies the tree and the explanations; this engine's
 * job is to be sound and readable, and quiescence already sees the tactics that
 * matter at these depths.
 */

/** Any score at or above this is a mate, and carries its distance in plies. */
export const MATE_SCORE = 100_000;
const MATE_THRESHOLD = MATE_SCORE - 1_000;
const INFINITY = MATE_SCORE + 1_000;

/** Beyond this many plies the search answers with the static score instead. */
const MAX_PLY = 64;

/**
 * The transposition table, at a fixed 65 536 entries — the brief asks for a fixed
 * size, and a fixed size is what makes the engine's memory a constant rather
 * than a function of the position. Two 32-bit halves identify a position (see
 * `types.ts`); the depth and a bound type say what the stored score proves.
 *
 * It is cleared at the start of every root search. That is not hygiene: a mate
 * score is stored with the distance from ITS root folded in, so an entry left
 * over from a search that began at another ply would be off by the difference.
 */
const TT_BITS = 16;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const ttKeys = new Int32Array(TT_SIZE);
const ttLocks = new Int32Array(TT_SIZE);
const ttDepths = new Int8Array(TT_SIZE);
const ttFlags = new Int8Array(TT_SIZE);
const ttScores = new Int32Array(TT_SIZE);
const ttMoves = new Int32Array(TT_SIZE);
const TT_EMPTY = 0;
const TT_EXACT = 1;
/** The true score is at least what is stored (a beta cutoff happened here). */
const TT_LOWER = 2;
/** The true score is at most what is stored (every move failed low here). */
const TT_UPPER = 3;

export interface SearchLimits {
  /** The deepest iteration to begin. At least 1. */
  depth: number;
  /** A soft time budget in milliseconds. Enforced only when `options.now` is given. */
  timeMs?: number;
}

export interface SearchOptions {
  /** A seeded `[0, 1)` source. The engine never calls `Math.random`. */
  rng?: () => number;
  /** A monotonic clock in milliseconds. The engine never calls `Date.now`. */
  now?: () => number;
  /** A cooperative stop flag, checked between nodes — what stage 2's worker sets. */
  shouldStop?: () => boolean;
  /** A hard ceiling on visited nodes, on top of the depth and the clock. */
  maxNodes?: number;
}

export interface SearchResult {
  /** The chosen move as UCI text: `"e2e4"`, `"e7e8q"`. */
  move: string;
  /**
   * Centipawns from the mover's point of view, for the move actually returned.
   * When a level picks a move at random it is the score the search had for that
   * move, which may be an upper bound rather than an exact score.
   */
  score: number;
  /** The deepest iteration that COMPLETED. */
  depth: number;
  /** Nodes visited, quiescence included. */
  nodes: number;
  /** The principal variation, best move first, in UCI. */
  pv: string[];
}

interface Context {
  position: EnginePosition;
  nodes: number;
  stopped: boolean;
  /** `Infinity` when no clock was supplied, so the check costs one comparison. */
  deadline: number;
  now: () => number;
  shouldStop: (() => boolean) | undefined;
  maxNodes: number;
  /** One move list and one undo record per ply, so no node allocates either. */
  lists: number[][];
  undos: Undo[];
  /** Two killer moves per ply: the quiet moves that most recently cut a node off. */
  killers: Int32Array;
}

function newContext(position: EnginePosition, options: SearchOptions): Context {
  const clock = options.now;
  return {
    position,
    nodes: 0,
    stopped: false,
    deadline: Infinity,
    now: clock ?? (() => 0),
    shouldStop: options.shouldStop,
    maxNodes: options.maxNodes ?? Infinity,
    lists: Array.from({ length: MAX_PLY + 2 }, () => [] as number[]),
    undos: Array.from({ length: MAX_PLY + 2 }, () => newUndo()),
    killers: new Int32Array((MAX_PLY + 2) * 2),
  };
}

/** Whether a budget has run out. Called every 1 024 nodes, never per node. */
function outOfBudget(context: Context): boolean {
  if (context.shouldStop?.() === true) return true;
  if (context.nodes >= context.maxNodes) return true;
  return context.deadline !== Infinity && context.now() >= context.deadline;
}

/** The value the side to move has if it can do nothing: mate or a draw. */
function noMoveScore(position: EnginePosition, ply: number): number {
  const side = position.turn;
  const them: Side = side === WHITE ? BLACK : WHITE;
  const inCheck = isAttacked(position, kingSquare(position, side), them);
  return inCheck ? -MATE_SCORE + ply : 0;
}

/**
 * Quiescence: no evaluation until the position is quiet.
 *
 * A static score taken in the middle of a capture sequence is a score for a
 * position that will not exist, and that is how a search "wins" a piece it lost
 * two moves later. So from a leaf the search plays captures and promotions only,
 * and stops when it can stand pat — unless it is IN CHECK, where standing pat is
 * not an option and it must look at every move that gets out of it.
 */
function quiescence(context: Context, alpha: number, beta: number, ply: number): number {
  const position = context.position;
  if ((context.nodes & 1023) === 0 && outOfBudget(context)) {
    context.stopped = true;
    return alpha;
  }
  context.nodes += 1;
  if (position.halfmove >= 100) return 0;
  if (ply >= MAX_PLY) return evaluate(position);

  const side = position.turn;
  const them: Side = side === WHITE ? BLACK : WHITE;
  const inCheck = isAttacked(position, kingSquare(position, side), them);

  let best: number;
  if (inCheck) {
    best = -INFINITY;
  } else {
    best = evaluate(position);
    if (best >= beta) return best;
    if (best > alpha) alpha = best;
  }

  // Out of check only captures and promotions are searched; IN check, standing
  // pat is not an option, so every way out of the check has to be tried.
  const moves = legalMoves(position, context.lists[ply]!, !inCheck);
  if (moves.length === 0) return inCheck ? -MATE_SCORE + ply : 0;
  orderMoves(position, moves, 0, ply, context);

  const undo = context.undos[ply]!;
  for (const move of moves) {
    makeMove(position, move, undo);
    const score = -quiescence(context, -beta, -alpha, ply + 1);
    unmakeMove(position, undo);
    if (context.stopped) return alpha;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

/** Alpha-beta with a transposition table. Returns the score from the mover's view. */
function alphaBeta(context: Context, depth: number, alpha: number, beta: number, ply: number): number {
  if (context.stopped) return alpha;
  if ((context.nodes & 1023) === 0 && outOfBudget(context)) {
    context.stopped = true;
    return alpha;
  }

  const position = context.position;
  if (depth <= 0) return quiescence(context, alpha, beta, ply);
  context.nodes += 1;
  // The fifty-move rule is a real draw, and the evaluation cannot see it: a
  // position that can never be won is worth zero whatever the material says.
  if (position.halfmove >= 100) return 0;
  if (ply >= MAX_PLY) return evaluate(position);

  const slot = position.key & TT_MASK;
  let tableMove = 0;
  if (ttFlags[slot] !== TT_EMPTY && ttKeys[slot] === position.key && ttLocks[slot] === position.lock) {
    tableMove = ttMoves[slot]!;
    if (ttDepths[slot]! >= depth) {
      const raw = ttScores[slot]!;
      // The distance was stored from the root it was found at, so it is
      // converted back to a distance from HERE before it is used or returned.
      const score =
        raw > MATE_THRESHOLD ? raw - ply : raw < -MATE_THRESHOLD ? raw + ply : raw;
      const flag = ttFlags[slot]!;
      if (flag === TT_EXACT) return score;
      if (flag === TT_LOWER && score >= beta) return score;
      if (flag === TT_UPPER && score <= alpha) return score;
    }
  }

  const moves = legalMoves(position, context.lists[ply]!);
  if (moves.length === 0) return noMoveScore(position, ply);
  orderMoves(position, moves, tableMove, ply, context);

  const started = alpha;
  let best = -INFINITY;
  let bestMove = 0;
  const undo = context.undos[ply]!;

  for (const move of moves) {
    makeMove(position, move, undo);
    const score = -alphaBeta(context, depth - 1, -beta, -alpha, ply + 1);
    unmakeMove(position, undo);
    if (context.stopped) return alpha;
    if (score > best) {
      best = score;
      bestMove = move;
    }
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      // A quiet move that refutes this node becomes a killer: it is likely to
      // refute a sibling too, and it costs nothing to try it first there.
      if (movePromotion(move) === 0 && position.board[moveTo(move)] === 0) {
        const base = ply * 2;
        if (context.killers[base] !== move) {
          context.killers[base + 1] = context.killers[base]!;
          context.killers[base] = move;
        }
      }
      break;
    }
  }

  const stored = best > MATE_THRESHOLD ? best + ply : best < -MATE_THRESHOLD ? best - ply : best;
  ttKeys[slot] = position.key;
  ttLocks[slot] = position.lock;
  ttDepths[slot] = depth;
  ttFlags[slot] = best <= started ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
  ttScores[slot] = stored;
  ttMoves[slot] = bestMove;
  return best;
}

/** Scratch for the ordering scores, so ordering a node allocates nothing. */
const ORDER_SCORES = new Int32Array(256);

/**
 * Puts the moves in the order they will be tried, in place. The order is the
 * whole of alpha-beta's speed: the table's own move first (it was best here
 * before), then promotions, then captures by MVV-LVA — taking the most valuable
 * victim with the least valuable attacker — then the ply's killer moves, and
 * then everything else.
 */
function orderMoves(
  position: EnginePosition,
  moves: number[],
  tableMove: number,
  ply: number,
  context: Context,
): void {
  const count = Math.min(moves.length, ORDER_SCORES.length);
  for (let index = 0; index < count; index++) {
    ORDER_SCORES[index] = scoreMove(position, moves[index]!, tableMove, ply, context);
  }
  // Insertion sort: 30-ish moves in a nearly sorted list, and no allocation.
  for (let index = 1; index < count; index++) {
    const move = moves[index]!;
    const score = ORDER_SCORES[index]!;
    let scan = index - 1;
    while (scan >= 0 && ORDER_SCORES[scan]! < score) {
      moves[scan + 1] = moves[scan]!;
      ORDER_SCORES[scan + 1] = ORDER_SCORES[scan]!;
      scan -= 1;
    }
    moves[scan + 1] = move;
    ORDER_SCORES[scan + 1] = score;
  }
}

function scoreMove(
  position: EnginePosition,
  move: number,
  tableMove: number,
  ply: number,
  context: Context,
): number {
  if (move === tableMove) return 1_000_000;
  const promotion = movePromotion(move);
  const attacker = pieceValue(Math.abs(position.board[moveFrom(move)]!));
  if (promotion !== 0) return 900_000 + pieceValue(promotion) - attacker;
  if (moveFlag(move) === FLAG_EN_PASSANT) return 800_000 + pieceValue(PAWN) * 16 - attacker;
  const victim = position.board[moveTo(move)]!;
  if (victim !== 0) return 800_000 + pieceValue(Math.abs(victim)) * 16 - attacker;
  const base = ply * 2;
  if (context.killers[base] === move) return 700_000;
  if (context.killers[base + 1] === move) return 690_000;
  return 0;
}

/**
 * The principal variation, read back out of the table: from the root, follow
 * the stored best move for as long as the entry still describes the position in
 * hand. The position is restored before returning — the caller's object is the
 * same one the search ran on.
 */
function principalVariation(position: EnginePosition, depth: number): number[] {
  const pv: number[] = [];
  const undos: Undo[] = [];
  for (let index = 0; index < depth; index++) {
    const slot = position.key & TT_MASK;
    if (ttFlags[slot] === TT_EMPTY || ttKeys[slot] !== position.key || ttLocks[slot] !== position.lock) break;
    const move = ttMoves[slot]!;
    if (move === 0 || !legalMoves(position).includes(move)) break;
    const undo = newUndo();
    makeMove(position, move, undo);
    undos.push(undo);
    pv.push(move);
  }
  while (undos.length > 0) unmakeMove(position, undos.pop()!);
  return pv;
}

interface RootResult {
  move: number;
  score: number;
  depth: number;
  nodes: number;
  pv: number[];
  /**
   * Every root move with the score it earned, for the level ladder's choice.
   * `exact` is false when the move failed low against the window: its score is
   * then only an UPPER BOUND, and a caller that ranked it beside an exact score
   * would be offering a move the search proved nothing about.
   */
  rootMoves: { move: number; score: number; exact: boolean }[];
}

/**
 * Iterative deepening, from one ply to `limits.depth`.
 *
 * **`rootWindow` is how the root stays cheap while still being able to RANK its
 * moves.** A level that picks among near-best moves has to know which moves are
 * within its window of the best, and a plain narrowing search cannot tell it:
 * every move that fails low comes back as a bound rather than a score. So the
 * root searches at `alpha = best - window - 1`: anything above that is scored
 * exactly, anything below is PROVED to be outside the window and needs no score
 * at all. With no window the root narrows the ordinary way, which is what makes
 * a deep search fast.
 */
function searchRoot(
  position: EnginePosition,
  limits: SearchLimits,
  options: SearchOptions,
  rootWindow: number,
): RootResult | null {
  if (!Number.isInteger(limits.depth) || limits.depth < 1) {
    throw new ChessError(`Search depth must be a whole number of plies, at least 1 (got ${limits.depth}).`);
  }
  const rootMoves = legalMoves(position);
  if (rootMoves.length === 0) return null;

  ttFlags.fill(TT_EMPTY);
  const context = newContext(position, options);
  if (limits.timeMs !== undefined && options.now) {
    context.deadline = options.now() + limits.timeMs;
  }

  const fallback: RootResult = {
    move: rootMoves[0]!,
    score: 0,
    depth: 0,
    nodes: 0,
    pv: [],
    rootMoves: [],
  };
  let complete = fallback;
  let previousBest = rootMoves[0]!;
  const undo = context.undos[0]!;

  for (let depth = 1; depth <= limits.depth; depth++) {
    putFirst(rootMoves, previousBest);
    const scored: { move: number; score: number; exact: boolean }[] = [];
    let alpha = -INFINITY;
    let bestMove = previousBest;
    let bestScore = -INFINITY;

    for (const move of rootMoves) {
      const alphaUsed = alpha;
      makeMove(position, move, undo);
      const score = -alphaBeta(context, depth - 1, -INFINITY, -alpha, 1);
      unmakeMove(position, undo);
      if (context.stopped) break;
      scored.push({ move, score, exact: score > alphaUsed });
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      alpha = rootWindow > 0 ? bestScore - rootWindow - 1 : Math.max(alpha, score);
    }

    if (context.stopped) break;
    previousBest = bestMove;
    complete = {
      move: bestMove,
      score: bestScore,
      depth,
      nodes: context.nodes,
      pv: principalVariation(position, depth),
      rootMoves: scored,
    };
    // Deeper cannot improve on a mate already found, and this is also what makes
    // a mate-in-one position answer in a fraction of the level's budget.
    if (bestScore >= MATE_THRESHOLD) break;
  }

  return complete;
}

/** Moves `move` to the front of the list, keeping the rest in order. */
function putFirst(moves: number[], move: number): void {
  const index = moves.indexOf(move);
  if (index <= 0) return;
  moves.splice(index, 1);
  moves.unshift(move);
}

/**
 * The best move the engine can find in `fen`, or null when the position is over
 * (checkmate or stalemate — there is nothing to play).
 *
 * Throws `ChessError` for a FEN that is not a position: a caller that cannot
 * tell "no answer" from "I could not read the question" is a caller that will
 * show the wrong one.
 */
export function searchPosition(
  fen: string,
  limits: SearchLimits,
  options: SearchOptions = {},
): SearchResult | null {
  const position = parseFen(fen);
  if (position === null) throw new ChessError(`Not a position: "${fen}".`);
  const root = searchRoot(position, limits, options, 0);
  if (root === null) return null;
  return {
    move: moveToUci(root.move),
    score: root.score,
    depth: root.depth,
    nodes: root.nodes,
    pv: root.pv.map(moveToUci),
  };
}

/**
 * The root search, for the level ladder: `rootWindow` is the level's randomness
 * window, and passing it is what makes the root able to rank its moves at all.
 */
export function searchRanked(
  fen: string,
  limits: SearchLimits,
  options: SearchOptions = {},
  rootWindow = 0,
): RootResult | null {
  const position = parseFen(fen);
  if (position === null) throw new ChessError(`Not a position: "${fen}".`);
  return searchRoot(position, limits, options, rootWindow);
}

export type { RootResult };

