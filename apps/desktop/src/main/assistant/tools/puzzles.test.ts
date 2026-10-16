import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NexusDatabase, PuzzlesStore, openDatabase, uuidv7 } from "@nexus/db";
import { createMahjongGame, generateSudoku, type Tool, type ToolContext } from "@nexus/core";
import { puzzlesTools } from "./puzzles.js";

/**
 * The PUZZLES tools over a real database.
 *
 * The boards are the engines' own deals (a generated sudoku, a mahjong deal), so the
 * rows the store accepts are the rows the panels write, and the hints are checked
 * against what the engines say about those boards.
 */

const NOW_MS = new Date(2026, 9, 16, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-puzzles-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function store(): PuzzlesStore {
  return new PuzzlesStore(db.raw, profileId);
}

function context(
  locale: "sr" | "en",
  confirm: ToolContext["confirm"] = () => Promise.resolve(true),
): ToolContext {
  return {
    profileId,
    locale,
    signal: new AbortController().signal,
    confirm,
  };
}

function tool(name: string): Tool {
  const found = puzzlesTools({
    profileDb: (id, open) => open(db.raw, id),
    now: () => NOW_MS,
  }).find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

/** A sudoku the panel would have saved: the generated givens, nothing entered. */
function sudokuState(seed: number, difficulty: "easy" | "medium" | "hard") {
  const puzzle = generateSudoku(seed, { difficulty });
  return {
    givens: [...puzzle.cells],
    entries: new Array<number | null>(81).fill(null),
    notes: Array.from({ length: 81 }, () => [] as number[]),
    hintsUsed: 0,
  };
}

function saveSudoku(variant: "easy" | "medium" | "hard", elapsedSeconds: number): void {
  store().saveProgress(
    { puzzle: "sudoku", variant, seed: 11, state: sudokuState(11, variant), elapsedSeconds },
    NOW_ISO,
  );
}

describe("puzzles.stats", () => {
  it("says there is nothing yet, rather than answering with nothing", async () => {
    const result = await tool("puzzles.stats").run({}, context("sr"));
    expect(result).toEqual({ ok: true, content: "Još nema igara ni rezultata." });
  });

  it("lists the game in progress, with its time, and the record by grade", async () => {
    saveSudoku("easy", 65);
    store().finish(
      { puzzle: "sudoku", variant: "medium", solved: true, elapsedSeconds: 300 },
      NOW_ISO,
    );
    const result = await tool("puzzles.stats").run({ puzzle: "sudoku" }, context("en"));
    expect(result).toEqual({
      ok: true,
      content: [
        "In progress:",
        "- Sudoku, easy: 1 min 5 s",
        "Record:",
        "- Sudoku, medium: played 1, solved 1, best 5 min",
      ].join("\n"),
    });
  });
});

describe("puzzles.hint", () => {
  it("gives the engine's next step on a sudoku board, and never the solution", async () => {
    saveSudoku("easy", 0);
    const result = await tool("puzzles.hint").run({ puzzle: "sudoku", variant: "easy" }, context("sr"));
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(/^Sledeći korak: .+\.( Upiši cifru \d+ u polje \d+\.| Iz polja .+| U poljima .+)$/);
  });

  it("gives the pair a mahjong board can still be cleared through", async () => {
    const game = createMahjongGame(5);
    store().saveProgress(
      {
        puzzle: "mahjong",
        variant: "turtle",
        seed: 5,
        state: { faces: [...game.faces], remaining: [...game.remaining], shuffles: 0 },
        elapsedSeconds: 0,
      },
      NOW_ISO,
    );
    const result = await tool("puzzles.hint").run({ puzzle: "mahjong", variant: "turtle" }, context("en"));
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(/^Take this pair: \S+ and \S+\.$|^No pair left on this board still clears it\.$/);
  });

  it("says the page has no hint for Numbers, instead of inventing one", async () => {
    const result = await tool("puzzles.hint").run({ puzzle: "broj", variant: "six" }, context("en"));
    expect(result).toEqual({
      ok: true,
      content:
        "The page has no hint for Numbers. Its best expression appears only when the user gives up the round.",
    });
  });

  it("says so when there is no game in progress to hint at", async () => {
    const result = await tool("puzzles.hint").run({ puzzle: "sudoku", variant: "hard" }, context("sr"));
    expect(result).toEqual({ ok: false, content: "Neuspešno: nema igre u toku: Sudoku, teško." });
  });

  it("refuses a grade the puzzle does not have", async () => {
    const result = await tool("puzzles.hint").run({ puzzle: "broj", variant: "easy" }, context("en"));
    expect(result).toEqual({ ok: false, content: 'Failed: "variant" is not a grade of broj.' });
  });
});

describe("puzzles.start", () => {
  it("asks first, then hands the page an action that opens the grade", async () => {
    const summaries: string[] = [];
    const result = await tool("puzzles.start").run(
      { puzzle: "nonogram", variant: "10x10" },
      context("en", (request) => {
        summaries.push(request.summary);
        return Promise.resolve(true);
      }),
    );
    expect(summaries).toEqual(["Open Nonograms, 10 × 10 on the page?"]);
    expect(result).toEqual({
      ok: true,
      content: "Opening the Nonograms game, 10 × 10.",
      navigateTo: {
        module: "puzzles",
        action: { name: "start", payload: { puzzle: "nonogram", variant: "10x10", fresh: false } },
      },
    });
  });

  it("says a fresh start discards the saved game, and asks that", async () => {
    const summaries: string[] = [];
    await tool("puzzles.start").run(
      { puzzle: "sudoku", variant: "easy", fresh: true },
      context("en", (request) => {
        summaries.push(request.summary);
        return Promise.resolve(false);
      }),
    );
    expect(summaries).toEqual(["Delete the saved game and start a new one: Sudoku, easy?"]);
  });

  it("opens nothing when the user declines", async () => {
    const result = await tool("puzzles.start").run(
      { puzzle: "broj", variant: "six" },
      context("sr", () => Promise.resolve(false)),
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
  });
});

describe("puzzles.clear", () => {
  it("deletes the saved game when the user agrees, and leaves the record alone", async () => {
    saveSudoku("easy", 30);
    const result = await tool("puzzles.clear").run({ puzzle: "sudoku", variant: "easy" }, context("en"));
    expect(result).toEqual({
      ok: true,
      content: "The saved Sudoku game (easy) was deleted.",
      navigateTo: { module: "puzzles" },
    });
    expect(store().listSaves()).toEqual([]);
    expect(store().listStats()).toEqual([]);
  });

  it("keeps the game when the user declines", async () => {
    saveSudoku("medium", 30);
    const result = await tool("puzzles.clear").run(
      { puzzle: "sudoku", variant: "medium" },
      context("en", () => Promise.resolve(false)),
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(store().listSaves()).toHaveLength(1);
  });

  it("says so when there is no saved game to delete", async () => {
    const result = await tool("puzzles.clear").run({ puzzle: "mahjong", variant: "turtle" }, context("sr"));
    expect(result).toEqual({ ok: false, content: "Neuspešno: nema igre u toku: Mahjong, Kornjača." });
  });
});

describe("puzzles.mistakes", () => {
  it("turns the marking of mistakes on when the user agrees, and points at the settings card", async () => {
    const summaries: string[] = [];
    const result = await tool("puzzles.mistakes").run(
      { on: true },
      context("en", (request) => {
        summaries.push(request.summary);
        return Promise.resolve(true);
      }),
    );
    expect(summaries).toEqual(["Mark mistakes while a sudoku is played?"]);
    expect(store().settings()).toEqual({ checkWhileTyping: true });
    expect(result).toEqual({
      ok: true,
      content: "Marking mistakes while a sudoku is played is on.",
      navigateTo: { module: "settings", settings: "puzzles" },
    });
  });

  it("changes nothing when the user declines", async () => {
    const result = await tool("puzzles.mistakes").run(
      { on: true },
      context("sr", () => Promise.resolve(false)),
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(store().settings()).toEqual({ checkWhileTyping: false });
  });

  it("refuses a value that is not a boolean", async () => {
    const result = await tool("puzzles.mistakes").run({ on: "yes" }, context("en"));
    expect(result).toEqual({ ok: false, content: 'Failed: "on" must be a boolean.' });
  });
});
