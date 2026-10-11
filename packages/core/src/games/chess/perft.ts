import { makeMove, parseFen, unmakeMove } from "./position.js";
import type { EnginePosition } from "./types.js";
import { newUndo } from "./types.js";
import { legalMoves } from "./movegen.js";

/**
 * Perft: the number of leaf nodes in the legal move tree of `position` at
 * `depth`.
 *
 * It is the move generator's whole proof. A count of 197 281 plies at depth 4
 * from the start position is not something a generator with a wrong promotion,
 * a missing en passant or a castling that ignores check can reach by accident,
 * and the number is published by several independent sources — which is why the
 * tests assert the literal counts rather than comparing the generator with
 * itself.
 *
 * Depth 0 is 1: the empty tree has one leaf, the position itself. That is the
 * definition every published count is built on, and returning 0 would make
 * `perft(fen, n)` look right at depth 1 for the wrong reason.
 */
export function perftAt(position: EnginePosition, depth: number): number {
  if (depth <= 0) return 1;
  const moves = legalMoves(position);
  if (depth === 1) return moves.length;
  const undo = newUndo();
  let nodes = 0;
  for (const move of moves) {
    makeMove(position, move, undo);
    nodes += perftAt(position, depth - 1);
    unmakeMove(position, undo);
  }
  return nodes;
}

/**
 * `perftAt` from a FEN. A position that does not parse is zero rather than a
 * throw: this is the counting helper the tests and any future tuning harness
 * call in a loop, and there is no count for a position that is not one.
 */
export function perft(fen: string, depth: number): number {
  const position = parseFen(fen);
  if (position === null) return 0;
  return perftAt(position, depth);
}

