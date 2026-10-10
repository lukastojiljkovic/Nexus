/**
 * The one bounded search behind „is this solitaire position winnable?“, shared by
 * Pyramid and Golf because in both the question and the answer have the same
 * shape.
 *
 * **The search is exact where it finishes, and it says when it did not.** A card
 * that leaves the table never comes back in either game, so the positions form a
 * directed acyclic graph and a depth-first walk with a memo of the positions it
 * has already refuted is a proof rather than a heuristic: a position that has
 * been refuted once cannot be won by reaching it a second time. The graph is
 * still far larger than any search may visit, so the walk stops at
 * `SOLVER_NODE_BOUND` positions and reports which of the three things it learned —
 * `winnable` (a line was found), `unwinnable` (every line was refuted) or
 * `unknown` (the budget ran out first, which a caller must not read as a loss).
 *
 * **The memo's key must be the whole position.** Two positions that differ in
 * anything a move can read are different keys, or the memo refutes a state the
 * deeper one might have won from; `key` is the caller's contract and each engine
 * spells its own out, including the pass count a redeal turns on.
 *
 * A search is a probe, not a rule: nothing in the engines calls this, and no
 * verdict a person ever sees comes from it. It exists for the tests that pin a
 * winnable and an unwinnable deal, and for a hint that wants to know whether the
 * position is still alive.
 */

/** How many positions one `solveSolitaire` call may visit before it gives up. */
export const SOLVER_NODE_BOUND = 250_000;

/** What one game hands the shared search: its moves, its transition, its goal and a position key. */
export interface SolitaireSolver<S, M> {
  /** Every move the position allows, in a fixed order — the search tries them in it. */
  moves(state: S): readonly M[];
  /** Pure: returns a new position, never mutates `state`. */
  apply(state: S, move: M): S;
  /** True exactly when the position is won. */
  isWon(state: S): boolean;
  /**
   * A key that is equal for two positions exactly when every future move sequence
   * is the same in both. A weaker key turns a proof into a guess.
   */
  key(state: S): string;
}

export type SolverVerdict = "winnable" | "unwinnable" | "unknown";

export interface SolverAnswer<M> {
  readonly verdict: SolverVerdict;
  /** A winning line from the position handed in, when the verdict is `winnable`; empty otherwise. */
  readonly line: readonly M[];
  /** Positions visited. Never more than `bound`. */
  readonly nodes: number;
  /** The budget this call was given, so a report can state it. */
  readonly bound: number;
}

export function solveSolitaire<S, M>(
  game: SolitaireSolver<S, M>,
  state: S,
  bound: number = SOLVER_NODE_BOUND,
): SolverAnswer<M> {
  const refuted = new Set<string>();
  const line: M[] = [];
  let nodes = 0;
  let exhausted = false;

  const walk = (position: S): boolean => {
    // Once the budget is gone the walk is over: without this the siblings of every
    // position still on the stack would each be visited and counted, and `nodes`
    // would depend on the branching factor rather than on the bound.
    if (exhausted) return false;
    if (game.isWon(position)) return true;
    const key = game.key(position);
    // Refuted already: a position that has been walked to its end without a win
    // cannot win the second time, because the graph has no cycles.
    if (refuted.has(key)) return false;
    refuted.add(key);
    nodes += 1;
    if (nodes > bound) {
      exhausted = true;
      return false;
    }
    for (const move of game.moves(position)) {
      line.push(move);
      if (walk(game.apply(position, move))) return true;
      line.pop();
    }
    return false;
  };

  const winnable = walk(state);
  if (winnable) return { verdict: "winnable", line: [...line], nodes, bound };
  return { verdict: exhausted ? "unknown" : "unwinnable", line: [], nodes, bound };
}
