import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ArcadeScoreStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import type { Tool, ToolContext } from "@nexus/core";
import { arcadeTools } from "./arcade.js";

/**
 * The ARCADE tools over a real database.
 *
 * What this suite pins is the answer: one line per board the profile has played,
 * named the way the page names it, with the figures the store keeps (a time for
 * Minesweeper, a score for the rest), and a play request that opens the game and
 * never asks the user for anything, because it writes nothing.
 */

const NOW_ISO = "2026-10-10T07:00:00.000Z";

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-arcade-"));
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

function store(): ArcadeScoreStore {
  return new ArcadeScoreStore(db.raw, profileId);
}

function context(locale: "sr" | "en", confirm = (): Promise<boolean> => Promise.resolve(true)): ToolContext {
  return {
    profileId,
    locale,
    signal: new AbortController().signal,
    confirm,
  };
}

function tool(name: string): Tool {
  const found = arcadeTools({ profileDb: (id, open) => open(db.raw, id) }).find(
    (entry) => entry.name === name,
  );
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

function seed(): void {
  store().record({ game: "minesweeper", variant: "beginner", won: true, timeMs: 61_000 }, NOW_ISO);
  store().record({ game: "minesweeper", variant: "beginner", won: false, timeMs: null }, NOW_ISO);
  store().record({ game: "minesweeper", variant: "expert", won: true, timeMs: 200_000 }, NOW_ISO);
  store().record({ game: "blocks", variant: "standard", score: 1200, lines: 34 }, NOW_ISO);
  store().record({ game: "tile2048", variant: "4x4", score: 2048, moves: 90, won: true }, NOW_ISO);
}

describe("arcade.stats", () => {
  it("answers one line per board, with the figures the store keeps", async () => {
    seed();
    const result = await tool("arcade.stats").run({}, context("en"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Arcade — scores:",
        "- Blocks, Standard board: played 1, best score 1,200",
        "- Minesweeper, Beginner: played 2, won 1, best time 1 min 1 s",
        "- Minesweeper, Expert: played 1, won 1, best time 3 min 20 s",
        "- 2048, 4×4: played 1, best score 2,048",
      ].join("\n"),
    });
  });

  it("answers in Serbian and names a custom board by its dimensions", async () => {
    store().record(
      { game: "minesweeper", variant: "custom:9x9x10", won: false, timeMs: null },
      NOW_ISO,
    );
    const result = await tool("arcade.stats").run({}, context("sr"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Arkada — rezultati:",
        "- Minolovac, Prilagođeno 9×9×10: odigrano 1, pobeda 0, najbolje vreme nema",
      ].join("\n"),
    });
  });

  it("answers only for the game it is asked about", async () => {
    seed();
    const result = await tool("arcade.stats").run({ game: "blocks" }, context("en"));
    expect(result).toEqual({
      ok: true,
      content: "Arcade — scores:\n- Blocks, Standard board: played 1, best score 1,200",
    });
  });

  it("says a profile with no scores has none, and for the asked game too", async () => {
    const empty = await tool("arcade.stats").run({}, context("en"));
    expect(empty).toEqual({ ok: true, content: "The arcade has no scores yet." });
    seed();
    const snake = await tool("arcade.stats").run({ game: "snake" }, context("en"));
    expect(snake).toEqual({ ok: true, content: "The arcade has no scores yet." });
  });

  it("refuses a game the arcade does not have, by name", async () => {
    const result = await tool("arcade.stats").run({ game: "chess" }, context("en"));
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"game" must be one of');
  });
});

describe("arcade.play", () => {
  it("opens a Minesweeper preset as an item the page reveals", async () => {
    const result = await tool("arcade.play").run(
      { game: "minesweeper", variant: "expert" },
      context("en"),
    );
    expect(result).toEqual({
      ok: true,
      content: "Opening Minesweeper, Expert.",
      navigateTo: { module: "arcade", item: "minesweeper/expert" },
    });
  });

  it("opens another game by its own name, in Serbian", async () => {
    const result = await tool("arcade.play").run({ game: "snake" }, context("sr"));
    expect(result).toEqual({
      ok: true,
      content: "Otvaram Zmija.",
      navigateTo: { module: "arcade", item: "snake" },
    });
  });

  it("refuses a board for a game that has none, and a custom board it cannot name", async () => {
    const onSnake = await tool("arcade.play").run(
      { game: "snake", variant: "expert" },
      context("en"),
    );
    expect(onSnake).toEqual({
      ok: false,
      content: "Failed: A board can only be chosen for Minesweeper.",
    });
    const custom = await tool("arcade.play").run(
      { game: "minesweeper", variant: "custom" },
      context("en"),
    );
    expect(custom.ok).toBe(false);
  });

  it("never asks the user, because opening a game writes nothing", async () => {
    const asked = await tool("arcade.play").run(
      { game: "bricks" },
      context("en", () => {
        throw new Error("opening a game must not ask");
      }),
    );
    expect(asked.ok).toBe(true);
  });
});
