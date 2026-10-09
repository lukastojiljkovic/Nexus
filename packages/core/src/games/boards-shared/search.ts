/**
 * The alpha-beta search the perfect-information games in `games/` share.
 *
 * One negamax with alpha-beta, iterative deepening and a HARD node budget, so
 * that a move can never take long: the budget is counted as each node is
 * entered, the search aborts when it is reached, and what comes back is the
 * best move of the deepest COMPLETED depth â€” never half of a deeper one. That
 * is the whole reason `bestMove` can be handed to a worker and be relied on.
 *
 * A game supplies four functions and nothing else: its moves, its transition,
 * its terminal test, and an evaluation from the side to move. `evaluate` is
 * called both at the leaves and on terminal states, so it must return a mate
 * score for a finished game; each game documents its scale below.
 *
 * The caller's `random` shuffles the ROOT moves once per call. Alpha-beta's
 * value does not depend on move order â€” only which of two equally valued moves
 * gets reported does â€” so the shuffle adds variety between games without making
 * the result a coin flip, and the same seed still replays the same choice. The
 * search never reads `Math.random`.
 */

import type { Rng } from "./rng.js";
import { shuffled } from "./rng.js";

/** The function set a game hands to `search`. */
export interface SearchGame<S, M> {
  /** Every move the side to move may make; never empty for a non-terminal state. */
  legalMoves(state: S): readonly M[];
  /** Pure: returns a new state, never mutates `state`. */
  applyMove(state: S, move: M): S;
  /** True exactly when the game is over. */
  isTerminal(state: S): boolean;
  /**
   * Score for the side to move, in whatever units the game documents. Must be
   * a mate score on a finished game, and larger is better for the mover.
   */
  evaluate(state: S): number;
  /** Optional: a better-first ordering widens alpha-beta's cuts. */
  orderMoves?(state: S, moves: readonly M[]): readonly M[];
}

/** What a call to `search` is allowed to spend. */
export interface SearchLimits {
  /** Maximum plies searched below the root. */
  readonly depth: number;
  /**
   * Hard cap on nodes visited across the whole call, root and deepening
   * included. The returned `nodes` never exceeds it.
   */
  readonly nodeBudget: number;
}

/** The move `search` picked, with what it cost to pick it. */
export interface Choice<M> {
  /** `null` only when the position is terminal and there is nothing to play. */
  readonly move: M | null;
  /** Score of `move`; meaningless when `move` is `null`. */
  readonly score: number;
  /** The deepest depth fully completed; `0` when even depth 1 was cut short. */
  readonly depth: number;
  /** Nodes visited, budget-capped. */
  readonly nodes: number;
  /** True when the node budget stopped the search before `limits.depth`. */
  readonly cut: boolean;
}

/** Thrown internally to unwind out of a cut-short search; never escapes `search`. */
class NodeBudgetReached extends Error {}

const NEG_INFINITY = Number.NEGATIVE_INFINITY;

/**
 * The best move `state`'s side can make, searched to `limits.depth` unless the
 * node budget says otherwise first.
 */
export function search<S, M>(
  game: SearchGame<S, M>,
  state: S,
  limits: SearchLimits,
  random?: Rng,
): Choice<M> {
  const budget = Math.max(1, Math.floor(limits.nodeBudget));
  const maxDepth = Math.max(1, Math.floor(limits.depth));
  let nodes = 0;

  const rootMoves = (): M[] => {
    const moves = game.orderMoves
      ? game.orderMoves(state, game.legalMoves(state)).slice()
      : game.legalMoves(state).slice();
    return random === undefined ? moves : shuffled(random, moves);
  };

  if (game.isTerminal(state)) {
    return { move: null, score: game.evaluate(state), depth: 0, nodes: 0, cut: false };
  }
  const moves = rootMoves();
  if (moves.length === 0) {
    return { move: null, score: game.evaluate(state), depth: 0, nodes: 0, cut: false };
  }

  const descend = (child: S, depth: number, alpha: number, beta: number): number => {
    nodes += 1;
    if (nodes >= budget) throw new NodeBudgetReached();
    if (depth <= 0 || game.isTerminal(child)) return game.evaluate(child);
    const replies = game.legalMoves(child);
    if (replies.length === 0) return game.evaluate(child);
    const ordered = game.orderMoves ? game.orderMoves(child, replies) : replies;
    let best = alpha;
    for (const reply of ordered) {
      const score = -descend(game.applyMove(child, reply), depth - 1, -beta, -best);
      if (score >= beta) return score;
      if (score > best) best = score;
    }
    return best;
  };

  let bestMove = moves[0] as M;
  let bestScore = NEG_INFINITY;
  let reached = 0;
  let cut = false;
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    let alpha = NEG_INFINITY;
    let iterationMove = bestMove;
    let iterationScore = NEG_INFINITY;
    try {
      for (const move of moves) {
        const score = -descend(game.applyMove(state, move), depth - 1, NEG_INFINITY, -alpha);
        // Strictly better only: a tie keeps the earlier move, which is why the
        // seeded shuffle above is what makes equal moves vary between games.
        if (score > iterationScore) {
          iterationScore = score;
          iterationMove = move;
        }
        if (score > alpha) alpha = score;
      }
    } catch (error) {
      if (error instanceof NodeBudgetReached) {
        cut = true;
        break;
      }
      throw error;
    }
    bestMove = iterationMove;
    bestScore = iterationScore;
    reached = depth;
  }
  return { move: bestMove, score: bestScore, depth: reached, nodes, cut };
}
