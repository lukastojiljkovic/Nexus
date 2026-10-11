import { afterEach, describe, expect, it } from "vitest";

import { applyLocale } from "../../../renderer/src/strings.js";
import { formatArchiveInstant } from "../../../renderer/src/timeFormat.js";
import type { ArcadeGameId, ArcadeScoreView, ArcadeView } from "../shared/ipc.js";
import { boardFacts, boardHeadline, countLabel, gameName, shelfDetail, shelfFigure } from "./labels.js";

/**
 * The words around the numbers (ADR-090).
 *
 * What is pinned here is the composition: which figure a shelf item leads with
 * (a time, read downwards), which second fact it carries (its game's own count,
 * or the streak of a game that has one), and what a board's row in the stats
 * table is made of. The formatted values are `format.ts`'s business and are
 * asserted there; these assertions are about which value was chosen and which
 * word names it.
 */

const NOW = "2026-06-01T08:00:00.000Z";

afterEach(() => {
  applyLocale("sr");
});

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
    score({ game: "minesweeper", variant: "beginner", played: 3, bestTimeMs: 41_500 }),
    score({ game: "minesweeper", variant: "expert", played: 4, bestTimeMs: 300_000 }),
    score({ game: "blocks", variant: "standard", played: 2, bestScore: 1200, bestCount: 30 }),
    score({ game: "snake", variant: "standard", played: 5, bestScore: 120, bestCount: 40 }),
    score({ game: "bricks", variant: "standard", played: 1, bestScore: 1500, bestCount: 3 }),
    score({
      game: "tile2048",
      variant: "4x4",
      played: 2,
      won: 1,
      bestScore: 3000,
      bestCount: 200,
      currentStreak: 1,
      longestStreak: 1,
    }),
  ],
};

describe("gameName and countLabel", () => {
  it("names the five games, and each game's own second count", () => {
    expect(gameName("minesweeper")).toBe("Minolovac");
    expect(gameName("blocks")).toBe("Kocke");
    expect(gameName("tile2048")).toBe("2048");
    expect(countLabel("blocks")).toBe("Najviše linija");
    expect(countLabel("snake")).toBe("Najduža zmija");
    expect(countLabel("bricks")).toBe("Najviše nivoa");
    expect(countLabel("tile2048")).toBe("Najviše poteza");
  });
});

describe("shelfFigure", () => {
  it("leads a Minesweeper item with the fastest win over its boards", () => {
    expect(shelfFigure(VIEW, "minesweeper")).toBe("41,5 s");
  });

  it("leads a score game with its highest score, and says so when there is none", () => {
    expect(shelfFigure(VIEW, "blocks")).toBe("1.200");
    expect(shelfFigure(VIEW, "snake")).toBe("120");
    expect(shelfFigure(VIEW, "tile2048")).toBe("3.000");
    expect(shelfFigure({ scores: [] }, "bricks")).toBe("nema");
  });
});

describe("shelfDetail", () => {
  it("says a game has not been played when it has no rows at all", () => {
    expect(shelfDetail({ scores: [] }, "bricks")).toBe("Nije odigrano");
  });

  it("counts the games played for Minesweeper, whose figure is a time", () => {
    expect(shelfDetail(VIEW, "minesweeper")).toBe("Odigrano 7");
  });

  it("names a score game's own count, and a streak game's longest run", () => {
    expect(shelfDetail(VIEW, "blocks")).toBe("Najviše linija 30");
    expect(shelfDetail(VIEW, "snake")).toBe("Najduža zmija 40");
    expect(shelfDetail(VIEW, "bricks")).toBe("Najviše nivoa 3");
    expect(shelfDetail(VIEW, "tile2048")).toBe("Najduži niz 1");
  });
});

describe("boardFacts", () => {
  it("has nothing to say about a board nobody has played", () => {
    expect(boardFacts(null, "minesweeper")).toEqual([]);
  });

  it("gives a Minesweeper board the games played, the streak it is on and the record", () => {
    const row = score({
      game: "minesweeper",
      variant: "beginner",
      played: 3,
      won: 2,
      bestTimeMs: 41_500,
      currentStreak: 2,
      longestStreak: 2,
    });
    const facts = boardFacts(row, "minesweeper");

    expect(facts).toEqual([
      { label: "Odigrano", value: "3" },
      { label: "Niz", value: "2" },
      { label: "Najduži niz", value: "2" },
      // The when is the shell's own formatter, so this pins the wiring rather
      // than a second implementation of it.
      { label: "Poslednja partija", value: formatArchiveInstant(NOW) },
    ]);
  });

  it("gives a score game its own count and no streak, because it cannot win one", () => {
    const facts = boardFacts(score({ game: "blocks", variant: "standard", played: 2, bestScore: 1200, bestCount: 30 }), "blocks");

    expect(facts.map((fact) => fact.label)).toEqual([
      "Odigrano",
      "Najviše linija",
      "Poslednja partija",
    ]);
    expect(facts.map((fact) => fact.value)).toEqual(["2", "30", formatArchiveInstant(NOW)]);
  });

  it("gives 2048 both its count and both streaks, because it is the score game that can win", () => {
    const facts = boardFacts(
      score({
        game: "tile2048",
        variant: "4x4",
        played: 2,
        won: 1,
        bestScore: 3000,
        bestCount: 200,
        currentStreak: 1,
        longestStreak: 1,
      }),
      "tile2048",
    );

    expect(facts.map((fact) => fact.label)).toEqual([
      "Odigrano",
      "Najviše poteza",
      "Niz",
      "Najduži niz",
      "Poslednja partija",
    ]);
  });
});

describe("boardHeadline", () => {
  it("is a time for Minesweeper, a score for the rest, and `nema` for a board never played", () => {
    expect(boardHeadline(score({ game: "minesweeper", variant: "expert", bestTimeMs: 300_000 }), "minesweeper")).toBe(
      "5:00 min",
    );
    expect(boardHeadline(score({ game: "snake", variant: "standard", bestScore: 120 }), "snake")).toBe("120");
    // A board that has been played but never won has no time at all.
    expect(boardHeadline(score({ game: "minesweeper", variant: "expert", played: 2 }), "minesweeper")).toBe("nema");
    expect(boardHeadline(null, "tile2048")).toBe("nema");
  });
});
