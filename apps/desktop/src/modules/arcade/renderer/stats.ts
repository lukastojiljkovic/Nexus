import { MINESWEEPER_PRESETS, minesweeperVariant } from "@nexus/core";
import type { ArcadeGameId, ArcadeScoreView, ArcadeView } from "../shared/ipc.js";

/**
 * What the shelf and the stats table ask of a view (ADR-090), as pure functions.
 *
 * **The store's rows are per BOARD, and this module never pretends otherwise.**
 * A best time over a 9 x 9 board says nothing about a 30 x 16 one, which is why
 * the store keys by board in the first place - so "the game's best time" is the
 * best of its boards and is only ever shown as that, and a streak, which is a run
 * on ONE board, is read from a row and never summed.
 *
 * **Directions are per game.** A time improves downwards, a score upwards, and
 * a count upwards: the three functions below are where that is stated once, and
 * the store is the authority they mirror rather than a second opinion.
 */

/** The rows this profile has for one game, in the store's own order (game, then board). */
export function rowsForGame(view: ArcadeView, game: ArcadeGameId): readonly ArcadeScoreView[] {
  return view.scores.filter((row) => row.game === game);
}

/** One board's row, or null when this profile has never finished a game of it. */
export function rowFor(
  view: ArcadeView,
  game: ArcadeGameId,
  variant: string,
): ArcadeScoreView | null {
  return view.scores.find((row) => row.game === game && row.variant === variant) ?? null;
}

/** One game as the shelf reads it: its totals, and the best of each number its boards carry. */
export interface GameSummary {
  /** Finished games across every board of this game. */
  readonly played: number;
  /** How many boards this profile has a row for. */
  readonly boards: number;
  /** The fastest won game over its boards, or null. */
  readonly bestTimeMs: number | null;
  /** The highest score over its boards, or null. */
  readonly bestScore: number | null;
  /** The highest second count over its boards, or null. */
  readonly bestCount: number | null;
  /** The longest run of wins any of its boards has recorded, or 0. Only a game with a win to count ever moves it. */
  readonly longestStreak: number;
}

export function summarize(view: ArcadeView, game: ArcadeGameId): GameSummary {
  const rows = rowsForGame(view, game);
  let bestTimeMs: number | null = null;
  let bestScore: number | null = null;
  let bestCount: number | null = null;
  let longestStreak = 0;
  let played = 0;
  for (const row of rows) {
    played += row.played;
    longestStreak = Math.max(longestStreak, row.longestStreak);
    // A time improves downwards and the two counts upwards; a null on either
    // side means the number is simply not there yet rather than zero.
    if (row.bestTimeMs !== null && (bestTimeMs === null || row.bestTimeMs < bestTimeMs)) {
      bestTimeMs = row.bestTimeMs;
    }
    if (row.bestScore !== null && (bestScore === null || row.bestScore > bestScore)) {
      bestScore = row.bestScore;
    }
    if (row.bestCount !== null && (bestCount === null || row.bestCount > bestCount)) {
      bestCount = row.bestCount;
    }
  }
  return { played, boards: rows.length, bestTimeMs, bestScore, bestCount, longestStreak };
}

/**
 * The boards the stats table always draws for Minesweeper, whether or not a row
 * exists for them.
 *
 * The three presets come from the ENGINE and not from a list here, so a preset
 * added to `MINESWEEPER_PRESETS` appears in this table the day it exists. Custom
 * boards cannot be listed - they are whatever a player typed - so those rows
 * appear only once one has been played, which is the honest reading of a table of
 * bests.
 */
export function minesweeperBoardVariants(view: ArcadeView): readonly string[] {
  // Typed as strings because they are compared against the keys a stored row
  // carries: a variant off the wire is a string, whatever the engine could mint.
  const presets: readonly string[] = Object.values(MINESWEEPER_PRESETS).map((config) =>
    minesweeperVariant(config),
  );
  const custom = view.scores
    .filter((row) => row.game === "minesweeper" && !presets.includes(row.variant))
    .map((row) => row.variant);
  return [...presets, ...custom];
}
