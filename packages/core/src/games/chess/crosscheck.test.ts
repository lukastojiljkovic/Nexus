import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import type { Move as ChessJsMove } from "chess.js";
import {
  START_FEN,
  legalMoves,
  moveToUci,
  parseFen,
  playMove,
  toFen,
} from "./index.js";
import { verifyPositionHash } from "./position.js";

/**
 * The generator against `chess.js`, over random play.
 *
 * PERFT proves a generator's COUNTS; it cannot see a move that is generated
 * twice, or one whose name is right and whose destination is not, because two
 * compensating mistakes keep the total. So this walks both engines through the
 * same seeded games and compares, at every position, the two SETS of legal
 * moves — as UCI text, so a disagreement names the move.
 *
 * The seed is a constant rather than the clock, so a failure here is
 * reproducible on the next run and can be minimised by hand.
 */

/** A small deterministic PRNG (mulberry32). The test's own, not the engine's. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One generator for the whole file, so the walk is a single reproducible sequence. */
const rng = seeded(0x63686573);

function uciOf(move: ChessJsMove): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

interface Mismatch {
  ply: number;
  fen: string;
  ours: string[];
  theirs: string[];
}

describe("legal moves against chess.js over random play", () => {
  it("agrees on all 500 positions the brief asks for, with zero mismatches", () => {
    const target = 500;
    const mismatches: Mismatch[] = [];
    let compared = 0;
    let plies = 0;

    while (compared < target) {
      const chess = new Chess();
      const position = parseFen(START_FEN)!;
      expect(toFen(position)).toBe(chess.fen());

      // One game, then a fresh one: random play reaches a draw or a mate
      // quickly in the endgame, and a comparison needs a position with moves.
      while (!chess.isGameOver() && compared < target) {
        plies += 1;
        const ours = legalMoves(position).map(moveToUci).sort();
        const theirs = chess.moves({ verbose: true }).map(uciOf).sort();
        if (ours.join(" ") !== theirs.join(" ")) {
          mismatches.push({ ply: plies, fen: chess.fen(), ours, theirs });
        }
        compared += 1;

        const chosen = theirs[Math.floor(rng() * theirs.length)]!;
        expect(playMove(position, chosen)).toBe(true);
        chess.move(chosen);
        // The position has to agree after the move too, not only before it:
        // castling rights that were dropped too early and an en-passant square
        // that was left standing both show up here and nowhere else.
        expect({ ply: plies, fen: toFen(position) }).toEqual({ ply: plies, fen: chess.fen() });
        // And the transposition table's key has to still describe the board it
        // claims to: it is carried incrementally by `makeMove`, so a field left
        // out of that bookkeeping would otherwise only show up as a search that
        // occasionally trusts the wrong entry.
        expect({ ply: plies, hash: verifyPositionHash(position) }).toEqual({ ply: plies, hash: true });
      }
    }

    expect(mismatches).toEqual([]);
    expect(compared).toBe(target);
  });
});

