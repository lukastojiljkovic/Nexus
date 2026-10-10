import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MINESWEEPER_PRESETS, minesweeperVariant } from "@nexus/core";
import {
  ARCADE_EXPORT_VERSION,
  ArcadeScoreStore,
  ArcadeValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../../index.js";
import type { ArcadeExport, ArcadeResult } from "../../index.js";

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:30:00.000Z";

let dir: string;
let db: NexusDatabase;
/**
 * A second database file, because a profile archive's row ids are GLOBAL primary
 * keys and preserved by design (ADR-023 §1) — so an archive can only be restored
 * where its ids are free, never beside the profile it came from. The import tests
 * that need a second profile therefore need a second database, exactly as
 * `restoreStore.test.ts` does.
 */
let freshDb: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-arcade-"));
  db = openDatabase({ path: join(dir, "arcade.db") });
  freshDb = openDatabase({ path: join(dir, "fresh.db") });
});

afterEach(() => {
  db.close();
  freshDb.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A profile in the second database — a „fresh install", its own profile id. */
function createFreshProfile(name = "B"): string {
  const id = uuidv7();
  freshDb.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, NOW);
  return id;
}

function createProfile(name = "P"): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, NOW);
  return id;
}

function store(profileId = createProfile()): ArcadeScoreStore {
  return new ArcadeScoreStore(db.raw, profileId);
}

/** A won beginner game of the preset's own variant key, which is what the engine derives from the board. */
function won(timeMs: number): ArcadeResult {
  return {
    game: "minesweeper",
    variant: minesweeperVariant(MINESWEEPER_PRESETS.beginner),
    won: true,
    timeMs,
  };
}

function lost(): ArcadeResult {
  return {
    game: "minesweeper",
    variant: minesweeperVariant(MINESWEEPER_PRESETS.beginner),
    won: false,
    timeMs: null,
  };
}

function blocks(score: number, lines: number): ArcadeResult {
  return { game: "blocks", variant: "standard", score, lines };
}

describe("record — Minesweeper", () => {
  it("counts a first win, and stamps the row with the clock it was given", () => {
    const scores = store();
    const row = scores.record(won(41_500), NOW);

    expect(row).toMatchObject({
      game: "minesweeper",
      variant: "beginner",
      played: 1,
      won: 1,
      bestTimeMs: 41_500,
      bestScore: null,
      bestLines: null,
      currentStreak: 1,
      longestStreak: 1,
      lastPlayedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(row.id.length).toBeGreaterThan(0);
    expect(scores.list()).toEqual([row]);
  });

  it("counts a loss as a play, keeps the best time, and ends the streak", () => {
    const scores = store();
    scores.record(won(41_500), NOW);
    scores.record(lost(), LATER);

    expect(scores.get("minesweeper", "beginner")).toMatchObject({
      played: 2,
      won: 1,
      bestTimeMs: 41_500,
      currentStreak: 0,
      longestStreak: 1,
      lastPlayedAt: LATER,
      createdAt: NOW,
      updatedAt: LATER,
    });
  });

  it("lowers the best time only when a win is faster", () => {
    const scores = store();
    scores.record(won(41_500), NOW);
    scores.record(won(50_000), LATER);
    expect(scores.get("minesweeper", "beginner")?.bestTimeMs).toBe(41_500);

    scores.record(won(39_000), LATER);
    expect(scores.get("minesweeper", "beginner")).toMatchObject({
      bestTimeMs: 39_000,
      played: 3,
      won: 3,
      currentStreak: 3,
      longestStreak: 3,
    });
  });

  it("lifts the longest streak only when the current one passes it", () => {
    const scores = store();
    scores.record(won(41_500), NOW);
    scores.record(won(39_000), LATER);
    expect(scores.get("minesweeper", "beginner")).toMatchObject({
      currentStreak: 2,
      longestStreak: 2,
    });

    // A loss ends the current run and leaves the record where it was.
    scores.record(lost(), LATER);
    expect(scores.get("minesweeper", "beginner")).toMatchObject({
      currentStreak: 0,
      longestStreak: 2,
    });

    // Two wins fall one short of the record, so the longest does not move.
    scores.record(won(45_000), LATER);
    scores.record(won(44_000), LATER);
    expect(scores.get("minesweeper", "beginner")).toMatchObject({
      currentStreak: 2,
      longestStreak: 2,
    });

    // The third one passes it.
    scores.record(won(43_000), LATER);
    expect(scores.get("minesweeper", "beginner")).toMatchObject({
      currentStreak: 3,
      longestStreak: 3,
    });
  });

  it("keeps a separate row for every board shape, custom ones included", () => {
    const scores = store();
    scores.record(won(10_000), NOW);
    scores.record(
      { game: "minesweeper", variant: "expert", won: true, timeMs: 300_000 },
      NOW,
    );
    scores.record(
      { game: "minesweeper", variant: "custom:9x10x10", won: false, timeMs: null },
      NOW,
    );

    expect(scores.list().map((row) => row.variant)).toEqual([
      "beginner",
      "custom:9x10x10",
      "expert",
    ]);
    expect(scores.get("minesweeper", "custom:9x10x10")).toMatchObject({
      played: 1,
      won: 0,
      bestTimeMs: null,
      currentStreak: 0,
      longestStreak: 0,
    });
  });
});

describe("record — Blocks", () => {
  it("raises the best score and line count, and never wins anything", () => {
    const scores = store();
    scores.record(blocks(1200, 12), NOW);
    expect(scores.get("blocks", "standard")).toMatchObject({
      played: 1,
      won: 0,
      currentStreak: 0,
      longestStreak: 0,
      bestTimeMs: null,
      bestScore: 1200,
      bestLines: 12,
    });

    scores.record(blocks(800, 30), LATER);
    // A worse score with more lines moves one number and not the other.
    expect(scores.get("blocks", "standard")).toMatchObject({
      played: 2,
      bestScore: 1200,
      bestLines: 30,
      updatedAt: LATER,
    });
  });

  it("keeps the two games' rows apart in one store", () => {
    const scores = store();
    scores.record(won(41_500), NOW);
    scores.record(blocks(1200, 12), NOW);

    expect(scores.list().map((row) => `${row.game}/${row.variant}`)).toEqual([
      "blocks/standard",
      "minesweeper/beginner",
    ]);
  });
});

describe("the store's own gates", () => {
  it.each([
    ["an unknown game", { game: "chess", variant: "standard", score: 1, lines: 0 }],
    ["an upper-case variant", { game: "blocks", variant: "Standard", score: 1, lines: 0 }],
    ["an empty variant", { game: "blocks", variant: "", score: 1, lines: 0 }],
    ["an over-long variant", { game: "blocks", variant: `a:${"b".repeat(31)}`, score: 1, lines: 0 }],
    ["a variant with a space in it", { game: "blocks", variant: "custom 9", score: 1, lines: 0 }],
    ["a fractional score", { game: "blocks", variant: "standard", score: 12.5, lines: 1 }],
    ["a negative score", { game: "blocks", variant: "standard", score: -1, lines: 1 }],
    ["a fractional line count", { game: "blocks", variant: "standard", score: 1, lines: 1.5 }],
    ["a score past the bound", { game: "blocks", variant: "standard", score: 100_000_001, lines: 1 }],
    ["a fractional time", { game: "minesweeper", variant: "beginner", won: true, timeMs: 41.5 }],
    ["a zero time", { game: "minesweeper", variant: "beginner", won: true, timeMs: 0 }],
    ["a time past the bound", { game: "minesweeper", variant: "beginner", won: true, timeMs: 604_800_001 }],
    ["a win with no time to record", { game: "minesweeper", variant: "beginner", won: true, timeMs: null }],
    ["a win flag that is not a boolean", { game: "minesweeper", variant: "beginner", won: "yes", timeMs: 1 }],
  ])("refuses %s", (_label, result) => {
    const scores = store();
    // The cast is the point of the test: these are the shapes an untrusted caller
    // can send, and the store is what refuses them.
    expect(() => scores.record(result as never, NOW)).toThrow(ArcadeValidationError);
    expect(scores.list()).toEqual([]);
  });

  it("refuses a malformed now, and writes nothing when it does", () => {
    const scores = store();
    expect(() => scores.record(won(1000), "juče")).toThrow(ArcadeValidationError);
    expect(() => scores.record(won(1000), "08:00")).toThrow(ArcadeValidationError);

    scores.record(won(41_500), NOW);
    expect(() => scores.record(won(1000), "")).toThrow(ArcadeValidationError);
    expect(scores.get("minesweeper", "beginner")).toMatchObject({ played: 1, bestTimeMs: 41_500 });
  });

  it("refuses a row that mixes the two games' columns, in the schema as well as the store", () => {
    const profileId = createProfile();
    const insert = db.raw.prepare(
      `INSERT INTO arcade_scores
         (id, profile_id, game, variant, played, won, best_time_ms, best_score, best_lines,
          current_streak, longest_streak, last_played_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // A Blocks row that claims a win: the schema refuses it.
    const row = [
      uuidv7(), profileId, "blocks", "standard", 1, 1, null, 10, 1, 1, 1, NOW, NOW, NOW,
    ];
    expect(() => insert.run(...row)).toThrow(/CHECK/);

    // A Minesweeper row with a score on it.
    expect(() =>
      insert.run(
        uuidv7(), profileId, "minesweeper", "beginner", 1, 1, 1000, 5, null, 1, 1, NOW, NOW, NOW,
      ),
    ).toThrow(/CHECK/);
    // A current streak longer than the record, and one longer than the wins.
    expect(() =>
      insert.run(
        uuidv7(), profileId, "minesweeper", "beginner", 3, 3, 1000, null, null, 2, 1, NOW, NOW, NOW,
      ),
    ).toThrow(/CHECK/);
    expect(() =>
      insert.run(
        uuidv7(), profileId, "minesweeper", "beginner", 1, 0, 1000, null, null, 1, 1, NOW, NOW, NOW,
      ),
    ).toThrow(/CHECK/);
    // And a row that is what the game actually produces lands.
    insert.run(
      uuidv7(), profileId, "minesweeper", "beginner", 2, 1, 1000, null, null, 1, 1, NOW, NOW, NOW,
    );
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM arcade_scores").get()).toEqual({ n: 1 });
  });
});

describe("profiles", () => {
  it("keeps one profile's scores invisible to another", () => {
    const first = store();
    const second = store();
    first.record(won(41_500), NOW);

    expect(first.list()).toHaveLength(1);
    expect(second.list()).toEqual([]);
    expect(second.get("minesweeper", "beginner")).toBeNull();
  });
});

describe("export and import", () => {
  function played(scores: ArcadeScoreStore): void {
    scores.record(won(41_500), NOW);
    scores.record(lost(), LATER);
    scores.record({ game: "minesweeper", variant: "expert", won: true, timeMs: 300_000 }, LATER);
    scores.record(blocks(1200, 12), LATER);
  }

  it("round-trips a profile's scores into a fresh database, ids and all", () => {
    const source = store();
    played(source);
    const exported = source.exportData();

    const profileB = createFreshProfile();
    const target = new ArcadeScoreStore(freshDb.raw, profileB);
    target.importData(exported);

    expect(target.exportData()).toEqual(exported);
    // The rows are the TARGET profile's, and the ids came along unchanged.
    expect(target.list().map((row) => row.id)).toEqual(source.list().map((row) => row.id));
    expect(new Set(target.list().map((row) => row.profileId))).toEqual(new Set([profileB]));
  });

  it("refuses an archive whose ids this database already holds, without writing", () => {
    const source = store();
    played(source);

    // A second profile in the SAME database: the archive's rows are global primary
    // keys that the source profile still holds, so there is nowhere for them to
    // land. Named rather than left to the driver, and nothing is written.
    const other = store();
    expect(() => other.importData(source.exportData())).toThrow(ArcadeValidationError);
    expect(other.list()).toEqual([]);
  });

  it("writes the version it reads, and the archive carries no profile", () => {
    const scores = store();
    played(scores);

    const exported = scores.exportData();
    expect(exported.version).toBe(ARCADE_EXPORT_VERSION);
    expect(exported.scores).toHaveLength(3);
    expect(Object.keys(exported.scores[0] as object)).not.toContain("profileId");
  });

  it("replaces what a profile already had, rather than merging the two", () => {
    const source = store();
    played(source);

    const target = new ArcadeScoreStore(freshDb.raw, createFreshProfile());
    target.record({ game: "minesweeper", variant: "expert", won: true, timeMs: 10 }, NOW);
    target.importData(source.exportData());

    // The expert best is the archive's 300 s, not the 10 s the target had: an
    // import is a restore of a whole state, not a fold of two.
    expect(target.get("minesweeper", "expert")?.bestTimeMs).toBe(300_000);
    expect(target.exportData()).toEqual(source.exportData());
  });

  it("refuses an unknown version", () => {
    const scores = store();
    for (const version of [2, 0, "1", null]) {
      expect(() => scores.importData({ version, scores: [] })).toThrow(ArcadeValidationError);
    }
    expect(() => scores.importData({ scores: [] })).toThrow(ArcadeValidationError);
    expect(() => scores.importData(null)).toThrow(ArcadeValidationError);
  });

  it("validates the whole archive before writing a single row", () => {
    const scores = store();
    played(scores);
    const before = scores.exportData();

    // A Minesweeper row, because the mixed-columns rule below is stated per game.
    const good = before.scores.find((score) => score.game === "minesweeper") as
      ArcadeExport["scores"][number];
    expect(() =>
      scores.importData({
        version: 1,
        scores: [good, { ...good, id: uuidv7(), played: 1.5 }],
      }),
    ).toThrow(ArcadeValidationError);

    // The same board twice, and a Minesweeper row carrying a score.
    expect(() => scores.importData({ version: 1, scores: [good, { ...good, id: uuidv7() }] })).toThrow(
      ArcadeValidationError,
    );
    expect(() =>
      scores.importData({ version: 1, scores: [{ ...good, bestScore: 1 }] }),
    ).toThrow(ArcadeValidationError);
    expect(() =>
      scores.importData({ version: 1, scores: [{ ...good, extra: true }] }),
    ).toThrow(ArcadeValidationError);

    expect(scores.exportData()).toEqual(before);
  });

  it("imports an empty archive as a clean slate", () => {
    const scores = store();
    played(scores);
    scores.importData({ version: 1, scores: [] });

    expect(scores.list()).toEqual([]);
  });
});
