import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import type { Move as ChessJsMove } from "chess.js";
import {
  CHESS_LEVELS,
  MATE_SCORE,
  START_FEN,
  chessLevel,
  chooseEngineMove,
  searchPosition,
} from "./index.js";

/**
 * The search's proof is MATE, and the compositions below are this module's own —
 * there is no published position here, and none is needed, because every one of
 * them is PROVED by exhaustive search in this file before the engine is asked
 * about it. `canForceMate` walks the whole legal tree through `chess.js`, so a
 * typo that turns "mate in two" into "mate in one" fails the proof instead of
 * quietly making the engine's answer look wrong.
 *
 * The mate-in-one set is the four ways a game ends in one move — a back rank, a
 * queen in front of its king, a smothered knight and a promotion — plus a queen
 * supported only by its king. The mate-in-two set is five different reasons the
 * first move cannot be the mate: a king that must step out of the way first, a
 * queen that must clear a rank, a defender that only moves once, a pawn that
 * gets to PROMOTE on its one reply, and a king with exactly one square.
 */

/** A small deterministic PRNG (mulberry32), for the self-play walk. */
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

const rng = seeded(0x6d617465);

function uciOf(move: ChessJsMove): string {
  return `${move.from}${move.to}${move.promotion ?? ""}`;
}

/** Every legal move whose play ends the game immediately. */
function matingMoves(chess: Chess): string[] {
  const out: string[] = [];
  for (const move of chess.moves({ verbose: true })) {
    chess.move(move);
    if (chess.isCheckmate()) out.push(uciOf(move));
    chess.undo();
  }
  return out;
}

/**
 * True when the side to move can force mate within `plies` plies (odd counts are
 * the mate-in-N question). Mutates and restores `chess`.
 */
function canForceMate(chess: Chess, plies: number): boolean {
  if (plies <= 0) return false;
  for (const move of chess.moves({ verbose: true })) {
    chess.move(move);
    const mate = chess.isCheckmate() || cannotAvoidMate(chess, plies - 1);
    chess.undo();
    if (mate) return true;
  }
  return false;
}

/** True when the side to move is mated within `plies` plies however it plays. */
function cannotAvoidMate(chess: Chess, plies: number): boolean {
  if (plies <= 0) return false;
  const replies = chess.moves({ verbose: true });
  if (replies.length === 0) return chess.isCheckmate();
  for (const reply of replies) {
    chess.move(reply);
    const doomed = canForceMate(chess, plies - 1);
    chess.undo();
    if (!doomed) return false;
  }
  return true;
}

/** True when `move` keeps a forced mate in two for the side that played it. */
function keepsMateInTwo(chess: Chess, move: string): boolean {
  chess.move(move);
  const kept = cannotAvoidMate(chess, 2);
  chess.undo();
  return kept;
}

const MATE_IN_ONE = [
  // A back rank: g8's king is boxed in by its own three pawns and d8 hits it.
  "6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1",
  // The queen steps in front of the king it is defended by.
  "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1",
  // Smothered: the rook on g8 takes away the last square and the rook's own
  // pawns take away the rest, so the knight on f7 cannot be captured.
  "6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1",
  // Promotion: only the rook and the queen mate on d8 (the knight and bishop
  // promotions do not even check), the king on f6 covers e7, f7 and g7, and the
  // new piece on d8 takes the whole eighth rank. Nothing else here mates.
  "5k2/3P4/5K2/8/8/8/8/B7 w - - 0 1",
  // A queen supported only by its king, on the eighth rank.
  "6k1/8/6K1/8/8/8/8/1Q6 w - - 0 1",
] as const;

/**
 * Mate in two — each of these was FOUND by a generator in this project that
 * walked the legal tree for positions where no mate in one exists, and each is
 * checked here by the same exhaustive walk. The one-line proof beside each is
 * the shortest line the generator reported.
 */
const MATE_IN_TWO = [
  // King and queen against a bare king: the king takes b6 and only b8 is left,
  // and d8 mates. (Also Qd7+ Kb8 Qb7#, and three more keys.)
  "k7/8/2K5/8/3Q4/8/8/8 w - - 0 1",
  // The queen takes the whole second rank, so the king has exactly one square.
  "8/7Q/5K2/8/8/4R3/8/k7 w - - 0 1",
  // Three replies — the pawn's push and two king squares — and h8 mates all.
  "8/8/1p6/7k/8/8/4R3/Q4K2 w - - 0 1",
  // The ONLY key move: c6 frees b8 for the rook and covers a7, so black's one
  // legal reply is to promote — and Rb8 mates whichever piece appears.
  "k7/4N3/8/5K2/8/8/pR6/8 w - - 0 1",
  // Black has two pawn moves and nothing else, and Qb3 mates after either.
  "8/2p5/8/5Q2/2K5/k4N2/8/8 w - - 0 1",
] as const;

describe("mate in one", () => {
  for (const fen of MATE_IN_ONE) {
    it(`finds the mate in ${fen}`, () => {
      const composed = new Chess(fen);
      const mating = matingMoves(composed);
      // The composition is what it claims to be, or the rest proves nothing.
      expect(mating.length).toBeGreaterThan(0);

      const found = chooseEngineMove(fen, 8);
      expect(found).not.toBeNull();
      expect(mating).toContain(found!.move);
      expect(found!.score).toBeGreaterThanOrEqual(MATE_SCORE - 1);
    });
  }
});

describe("mate in two", () => {
  for (const fen of MATE_IN_TWO) {
    it(`finds the mate in ${fen}`, () => {
      const composed = new Chess(fen);
      expect(canForceMate(composed, 1)).toBe(false);
      expect(canForceMate(composed, 3)).toBe(true);

      const found = chooseEngineMove(fen, 8);
      expect(found).not.toBeNull();
      // The move has to KEEP the forced mate, which is stronger than merely
      // being legal: after it, every black reply still allows mate in one.
      expect({ fen, move: found!.move, keeps: keepsMateInTwo(new Chess(fen), found!.move) }).toEqual({
        fen,
        move: found!.move,
        keeps: true,
      });
      expect(found!.score).toBeGreaterThanOrEqual(MATE_SCORE - 3);
    });
  }
});

describe("the engine at play", () => {
  it("plays 1000 seeded self-play moves and never returns an illegal one", () => {
    const illegal: { ply: number; fen: string; move: string }[] = [];
    let ply = 0;
    const clock = () => performance.now();

    // Every level takes a turn, so both the randomised ones and the sound ones
    // are asked for a thousand moves between them. The node ceiling is the
    // test's, not the level's: it keeps the walk to seconds on a shared machine
    // while leaving the ordering, the search and the legal-move plumbing real.
    while (ply < 1000) {
      const chess = new Chess();
      while (!chess.isGameOver() && ply < 1000) {
        const fen = chess.fen();
        const level = 1 + (ply % CHESS_LEVELS.length);
        const found = chooseEngineMove(fen, level, { rng, now: clock, maxNodes: 800 });
        expect(found).not.toBeNull();
        const legal = chess.moves({ verbose: true }).map(uciOf);
        if (!legal.includes(found!.move)) {
          illegal.push({ ply, fen, move: found!.move });
        } else {
          chess.move(found!.move);
        }
        ply += 1;
      }
    }

    expect(illegal).toEqual([]);
    expect(ply).toBe(1000);
  }, 180_000);

  it("stops when the caller asks, and still answers with a legal move", () => {
    const started = performance.now();
    const found = searchPosition(START_FEN, { depth: 6 }, { shouldStop: () => true });
    const elapsed = performance.now() - started;

    expect(found).not.toBeNull();
    expect(new Chess().moves({ verbose: true }).map(uciOf)).toContain(found!.move);
    // The whole point of the flag: a stopped search is not a slow one.
    expect(found!.nodes).toBeLessThan(100);
    expect(elapsed).toBeLessThan(2000);
  });

  it("honours a time budget", () => {
    const started = performance.now();
    const found = searchPosition(
      START_FEN,
      { depth: 8, timeMs: 80 },
      { now: () => performance.now(), rng },
    );
    expect(found).not.toBeNull();
    expect(found!.depth).toBeGreaterThanOrEqual(1);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("answers nothing when there is nothing to play", () => {
    // Checkmate and stalemate alike: no legal move, so no move to report.
    expect(searchPosition("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1", { depth: 3 })).toBeNull();
    expect(searchPosition("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", { depth: 3 })).toBeNull();
  });

  it("refuses a FEN that is not a position, rather than answering for one", () => {
    // A caller that cannot tell "no move to play" from "I could not read the
    // question" is a caller that shows the wrong one of the two.
    expect(() => searchPosition("nonsense", { depth: 2 })).toThrow();
    expect(() => chooseEngineMove("8/8/8/8/8/8/8/8 w - - 0 1", 1)).toThrow();
    expect(() => chessLevel(0)).toThrow();
  });
});

describe("the level ladder", () => {
  it("is eight levels, from a beginner's to none of the crutches", () => {
    expect(CHESS_LEVELS.map((level) => level.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(CHESS_LEVELS.map((level) => level.depth)).toEqual([1, 2, 2, 3, 4, 5, 6, 7]);
    // Depth never goes backwards, the search never gets slower to start up, and
    // the randomness that makes the low levels loseable is gone by the top.
    for (const level of CHESS_LEVELS) {
      const previous = CHESS_LEVELS[level.level - 2];
      if (previous) expect(level.depth).toBeGreaterThanOrEqual(previous.depth);
      expect(level.timeMs).toBeGreaterThan(0);
    }
    expect(CHESS_LEVELS.at(-1)!.randomCp).toBe(0);
    expect(CHESS_LEVELS.at(-1)!.blunderChance).toBe(0);
    expect(CHESS_LEVELS[0]!.blunderChance).toBeGreaterThan(0);
  });

  it("refuses a level outside 1..8, including a fractional one", () => {
    for (const bad of [0, 9, -1, 1.5, Number.NaN]) {
      expect(() => chessLevel(bad)).toThrow();
    }
    expect(chessLevel(1).level).toBe(1);
    expect(chessLevel(8).level).toBe(8);
  });
});

