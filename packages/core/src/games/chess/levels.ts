import { ChessError } from "./position.js";
import { moveToUci } from "./movegen.js";
import { searchRanked } from "./search.js";
import type { SearchOptions, SearchResult } from "./search.js";

/**
 * The eight levels a person can actually play against, and what makes them
 * different.
 *
 * | level | depth | time | window | blunder |
 * |-------|-------|------|--------|---------|
 * | 1     | 1     | 40ms | 350cp  | 35%     |
 * | 2     | 2     | 80ms | 250cp  | 20%     |
 * | 3     | 2     | 150ms| 150cp  | 10%     |
 * | 4     | 3     | 250ms|  80cp  | —       |
 * | 5     | 4     | 0.5s |  40cp  | —       |
 * | 6     | 5     | 1.5s |  20cp  | —       |
 * | 7     | 6     | 2s   |   —    | —       |
 * | 8     | 7     | 4s   |   —    | —       |
 *
 * **The clocks are sized to the depths, from measurement, not guessed.** On the
 * development machine the whole iterative deepening to each nominal depth from
 * the start position costs about: depth 4, 0.1 s; depth 5, 0.2 s; depth 6,
 * 1.3 s; depth 7, 3.5 s. A budget is a SOFT ceiling — the search discards a
 * half-finished iteration and answers from the depth before it — so a level on a
 * slower machine plays one ply shallower rather than stalling the board, which is
 * the behaviour wanted and why the ceiling never returns no move at all.
 *
 * **Three dials, and each is a different kind of weakness.** `depth` is how far
 * the engine sees; `timeMs` is a soft ceiling so that no level can stall the
 * board (the search returns what it has when the budget runs out, and it is
 * deep enough by level 8 that the ceiling rarely binds); the `window` is the
 * spread of scores within which a level picks UNIFORMLY at random, and
 * `blunderChance` is the probability of playing a uniformly random legal move
 * instead of choosing at all. A beginner does not lose to an engine that
 * searches badly so much as to one that does not always look — which is what
 * `blunderChance` models — and it disappears by level 4, because a person who
 * has reached level 4 is no longer being taught by the engine's mistakes.
 *
 * **Level 1 is meant to be lost to.** One ply of search, a 3.5-pawn window and
 * a better than one-in-three chance of a random legal move: it takes material
 * when the capture is right in front of it and misses almost everything else.
 * **Level 8 is meant to be sound.** Seven plies with quiescence, a full
 * transposition table and no randomness at all: it sees the tactics that decide
 * club games and does not hand back material for nothing.
 *
 * The dials are this project's own choices, set by playing the levels; no value
 * here is measured from another engine.
 */
export interface ChessLevel {
  level: number;
  /** The deepest iteration the search begins. */
  depth: number;
  /** A soft time budget in milliseconds. */
  timeMs: number;
  /** How far below the best score a move may be and still be picked at random. */
  randomCp: number;
  /** The chance of playing a uniformly random legal move instead of choosing. */
  blunderChance: number;
}

export const CHESS_LEVELS: readonly ChessLevel[] = [
  { level: 1, depth: 1, timeMs: 40, randomCp: 350, blunderChance: 0.35 },
  { level: 2, depth: 2, timeMs: 80, randomCp: 250, blunderChance: 0.2 },
  { level: 3, depth: 2, timeMs: 150, randomCp: 150, blunderChance: 0.1 },
  { level: 4, depth: 3, timeMs: 250, randomCp: 80, blunderChance: 0 },
  { level: 5, depth: 4, timeMs: 500, randomCp: 40, blunderChance: 0 },
  { level: 6, depth: 5, timeMs: 1_500, randomCp: 20, blunderChance: 0 },
  { level: 7, depth: 6, timeMs: 2_000, randomCp: 0, blunderChance: 0 },
  { level: 8, depth: 7, timeMs: 4_000, randomCp: 0, blunderChance: 0 },
];

/** The configuration for a level, or a refusal for anything outside 1..8. */
export function chessLevel(level: number): ChessLevel {
  if (!Number.isInteger(level) || level < 1 || level > CHESS_LEVELS.length) {
    throw new ChessError(
      `Chess level must be a whole number from 1 to ${CHESS_LEVELS.length} (got ${level}).`,
    );
  }
  return CHESS_LEVELS[level - 1]!;
}

/**
 * The move a level plays in `fen`, or null when the position is over.
 *
 * The engine's randomness is the caller's: without `options.rng` a level plays
 * its best move, deterministically, which is what a test or a hint wants. Stage
 * 2 supplies a seeded generator, and the same seed then produces the same game.
 *
 * When the level does not play its best move, the principal variation in the
 * result would describe a line the engine is not going to play, so it is
 * replaced by the move actually chosen.
 */
export function chooseEngineMove(
  fen: string,
  level: number,
  options: SearchOptions = {},
): SearchResult | null {
  const config = chessLevel(level);
  // The window is handed to the root so that the moves inside it come back with
  // real scores while the rest cost almost nothing; a level with no window needs
  // no ranking at all.
  const ranked = searchRanked(
    fen,
    { depth: config.depth, timeMs: config.timeMs },
    options,
    config.randomCp,
  );
  if (ranked === null) return null;

  const rng = options.rng;
  let chosen = ranked.move;
  if (rng && ranked.rootMoves.length > 0) {
    const best = ranked.score;
    if (rng() < config.blunderChance) {
      chosen = ranked.rootMoves[Math.floor(rng() * ranked.rootMoves.length)]!.move;
    } else {
      // Only moves the search SCORED may enter the pool: a move that failed low
      // against the window has an upper bound, not a score, and a level that
      // treated the bound as a score would sometimes pick a move the engine
      // knows is worse than the one it found.
      const pool = ranked.rootMoves.filter(
        (entry) => entry.exact && entry.score >= best - config.randomCp,
      );
      chosen = pool[Math.floor(rng() * pool.length)]?.move ?? ranked.move;
    }
  }

  const score = ranked.rootMoves.find((entry) => entry.move === chosen)?.score ?? ranked.score;
  return {
    move: moveToUci(chosen),
    score,
    depth: ranked.depth,
    nodes: ranked.nodes,
    pv: chosen === ranked.move ? ranked.pv.map(moveToUci) : [moveToUci(chosen)],
  };
}

