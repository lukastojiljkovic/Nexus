import { describe, expect, it } from "vitest";

import type { ArcadeGameId, ArcadeScoreView, ArcadeView } from "../shared/ipc.js";
import { minesweeperBoardVariants, rowFor, rowsForGame, summarize } from "./stats.js";

/**
 * What the shelf and the stats table ask of a view (ADR-090).
 *
 * The expectations are the DIRECTIONS, which is the part a reader cannot check
 * from the call site: a time improves downwards and a score and a count upwards,
 * and a profile's rows are per BOARD, so a summary is the best of several boards
 * rather than a sum of them.
 */

const NOW = "2026-06-01T08:00:00.000Z";

function score(
  row: Partial<ArcadeScoreView> & { readonly game: ArcadeGameId; readonly variant: string },
): ArcadeScoreView {
  return {
    played: 1,
    won: 0,
    bestTimeMs: null,
    bestScore: null,
    bestCount: null,
    currentStreak: 0,
    longestStreak: 0,
    lastPlayedAt: NOW,
    ...row,
  };
}

const VIEW: ArcadeView = {
  scores: [
    score({ game: "minesweeper", variant: "beginner", played: 3, won: 2, bestTimeMs: 41_500, currentStreak: 2, longestStreak: 2 }),
    score({ game: "minesweeper", variant: "custom:9x9x11", played: 4, bestTimeMs: 90_000 }),
    score({ game: "minesweeper", variant: "expert", played: 1, bestTimeMs: 300_000, longestStreak: 1 }),
    score({ game: "blocks", variant: "standard", played: 2, bestScore: 1200, bestCount: 30 }),
    score({ game: "snake", variant: "standard", played: 5, bestScore: 120, bestCount: 40 }),
    score({ game: "bricks", variant: "standard", played: 1, bestScore: 1500, bestCount: 3 }),
    score({ game: "tile2048", variant: "4x4", played: 2, won: 1, bestScore: 3000, bestCount: 200, longestStreak: 1 }),
  ],
};

describe("rowsForGame and rowFor", () => {
  it("answers this profile's rows for one game, in the view's own order", () => {
    expect(rowsForGame(VIEW, "minesweeper").map((row) => row.variant)).toEqual([
      "beginner",
      "custom:9x9x11",
      "expert",
    ]);
    expect(rowsForGame({ scores: [] }, "blocks")).toEqual([]);
  });

  it("finds one board's row and nothing else", () => {
    expect(rowFor(VIEW, "blocks", "standard")?.bestScore).toBe(1200);
    expect(rowFor(VIEW, "blocks", "4x4")).toBeNull();
    expect(rowFor(VIEW, "minesweeper", "intermediate")).toBeNull();
  });
});

describe("summarize", () => {
  it("takes the best time of a game's boards, which is the LOWEST", () => {
    // 41,5 s beginner, 90 s custom, 300 s expert: the beginner one is the best.
    const totals = summarize(VIEW, "minesweeper");
    expect(totals.bestTimeMs).toBe(41_500);
    expect(totals.played).toBe(8);
    expect(totals.boards).toBe(3);
    expect(totals.bestScore).toBeNull();
  });

  it("takes the highest score and the highest count, and never the last one seen", () => {
    // Snake is the only game here with two rows' worth of numbers in one row, so
    // the check is the one that matters: a later, worse game must not win.
    const view: ArcadeView = {
      scores: [
        score({ game: "snake", variant: "standard", played: 1, bestScore: 500, bestCount: 60 }),
        score({ game: "snake", variant: "5x5", played: 1, bestScore: 120, bestCount: 90 }),
      ],
    };
    expect(summarize(view, "snake")).toEqual({
      played: 2,
      boards: 2,
      bestTimeMs: null,
      bestScore: 500,
      bestCount: 90,
      longestStreak: 0,
    });
  });

  it("carries the longest streak of the game's boards, which is the record and not a sum", () => {
    const view: ArcadeView = {
      scores: [
        score({ game: "tile2048", variant: "4x4", won: 1, longestStreak: 1, currentStreak: 1, bestScore: 2000, bestCount: 100 }),
        score({ game: "tile2048", variant: "5x5", won: 3, longestStreak: 3, currentStreak: 3, bestScore: 4000, bestCount: 200 }),
      ],
    };
    expect(summarize(view, "tile2048")).toMatchObject({ played: 2, bestScore: 4000, longestStreak: 3 });
  });

  it("answers zeroes for a game nobody has played", () => {
    expect(summarize({ scores: [] }, "bricks")).toEqual({
      played: 0,
      boards: 0,
      bestTimeMs: null,
      bestScore: null,
      bestCount: null,
      longestStreak: 0,
    });
  });
});

describe("minesweeperBoardVariants", () => {
  it("draws the engine's three presets whether or not they have been played, then the custom boards", () => {
    expect(minesweeperBoardVariants(VIEW)).toEqual([
      "beginner",
      "intermediate",
      "expert",
      "custom:9x9x11",
    ]);
    expect(minesweeperBoardVariants({ scores: [] })).toEqual([
      "beginner",
      "intermediate",
      "expert",
    ]);
  });
});
