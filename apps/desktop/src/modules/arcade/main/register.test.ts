import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { register } from "./register.js";

/**
 * The ARCADE module through the kit (ADR-090): its two ops, the board key main
 * derives from every result, and its archive section.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals, the sender check and the channel allowlist are all the host's. Going
 * through `dispatch` therefore tests what actually runs in the app - a typo in an
 * op name or a payload the validators refuse is a rejected promise here rather
 * than a surprise on the first click.
 *
 * **The board key is the half worth pinning.** The store's row is keyed by
 * (profile, game, board), and the page never sends a board: it sends the numbers
 * it played with, and this module derives `beginner`, `custom:9x9x11`, `4x4` or
 * `standard` from them. A test that posted the same result twice at two boards
 * and read back one row each is what proves a beginner time cannot land on the
 * expert board.
 */

const TRUSTED = { trusted: true };

let dir: string;
let db: NexusDatabase;
let clock = Date.parse("2026-06-01T08:00:00.000Z");

function harness(database: NexusDatabase = db): ModuleHost {
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => database.raw,
    // Nothing in this module notifies or schedules: there is no clock to arm in
    // main, because a game in progress lives in the page.
    notify: () => undefined,
    schedule: () => () => undefined,
    now: () => clock,
  };
  const host = new ModuleHost(platform);
  register(host);
  return host;
}

function createProfile(database: NexusDatabase = db): string {
  const id = uuidv7();
  database.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date(clock).toISOString());
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

/** The `custom:CxRxM` board a 9 x 9 with 11 mines derives, which no preset matches. */
const CUSTOM = { columns: 9, rows: 9, mines: 11 };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-arcade-module-"));
  db = openDatabase({ path: join(dir, "arcade.db") });
  clock = Date.parse("2026-06-01T08:00:00.000Z");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the arcade handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    expect(harness().channels()).toEqual(["arcade:list", "arcade:record"]);
  });

  it("answers a read with no rows for a profile that has played nothing", async () => {
    const host = harness();
    expect(await call(host, "arcade:list", { profileId: createProfile() })).toEqual({ scores: [] });
  });

  it("refuses a payload the wire should never carry, before the store sees it", async () => {
    const host = harness();
    const profileId = createProfile();

    const bad: unknown[] = [
      // A game this build does not record.
      { game: "chess", variant: "standard", score: 1, lines: 1 },
      // A board whose first click could not be guaranteed safe: 9 x 9 with 80
      // mines leaves one cell for the nine a first click clears.
      { game: "minesweeper", columns: 9, rows: 9, mines: 80, won: false, timeMs: null },
      // A win with no time, which the store refuses for the same reason.
      { game: "minesweeper", columns: 9, rows: 9, mines: 10, won: true, timeMs: null },
      // A board the engine has no shape for.
      { game: "minesweeper", columns: 31, rows: 9, mines: 10, won: false, timeMs: null },
      // A 2048 board the engine does not build.
      { game: "tile2048", size: 7, score: 100, moves: 10, won: false },
      // Numbers that are not whole.
      { game: "blocks", score: 12.5, lines: 1 },
      { game: "snake", score: 10, eaten: 1.5 },
      // A field the game does not have, sent in its place.
      { game: "bricks", score: 10, lines: 3 },
    ];
    for (const result of bad) {
      await expect(
        call(host, "arcade:record", { profileId, result }),
        JSON.stringify(result),
      ).rejects.toThrow();
    }
    // And nothing was written by any of them.
    expect(await call(host, "arcade:list", { profileId })).toEqual({ scores: [] });

    // An id that is not an id is refused as an id rather than passed on.
    await expect(call(host, "arcade:list", { profileId: "  padded  " })).rejects.toThrow();
    // A payload that is not even an object.
    await expect(call(host, "arcade:record", { profileId, result: 7 })).rejects.toThrow();
  });
});

describe("the board key main derives", () => {
  it("names a preset for a preset's own dimensions", async () => {
    const host = harness();
    const profileId = createProfile();
    await call(host, "arcade:record", {
      profileId,
      result: { game: "minesweeper", columns: 9, rows: 9, mines: 10, won: true, timeMs: 41_500 },
    });

    const view = await call<{ scores: { game: string; variant: string }[] }>(host, "arcade:list", {
      profileId,
    });
    expect(view.scores).toEqual([expect.objectContaining({ game: "minesweeper", variant: "beginner" })]);
  });

  it("names a custom board by its own dimensions, so two of them are two boards", async () => {
    const host = harness();
    const profileId = createProfile();
    await call(host, "arcade:record", {
      profileId,
      result: { game: "minesweeper", ...CUSTOM, won: false, timeMs: null },
    });
    await call(host, "arcade:record", {
      profileId,
      result: { game: "minesweeper", ...CUSTOM, won: true, timeMs: 12_000 },
    });

    const view = await call<{ scores: { variant: string; played: number; won: number }[] }>(
      host,
      "arcade:list",
      { profileId },
    );
    expect(view.scores).toEqual([
      expect.objectContaining({ variant: "custom:9x9x11", played: 2, won: 1 }),
    ]);
  });

  it("gives the three games with one board the same key, and 2048 its own size", async () => {
    const host = harness();
    const profileId = createProfile();
    const results = [
      { game: "blocks", score: 1200, lines: 12 },
      { game: "snake", score: 120, eaten: 12 },
      { game: "bricks", score: 1500, levels: 3 },
      { game: "tile2048", size: 4, score: 2000, moves: 120, won: true },
    ];
    for (const result of results) {
      await call(host, "arcade:record", { profileId, result });
    }

    const view = await call<{ scores: { game: string; variant: string }[] }>(host, "arcade:list", {
      profileId,
    });
    expect(view.scores.map((row) => `${row.game}/${row.variant}`)).toEqual([
      "blocks/standard",
      "bricks/standard",
      "snake/standard",
      "tile2048/4x4",
    ]);
  });
});

describe("what a finished game is worth", () => {
  it("lowers a Minesweeper best time, and only on a win", async () => {
    const host = harness();
    const profileId = createProfile();
    const play = (won: boolean, timeMs: number | null) =>
      call(host, "arcade:record", {
        profileId,
        result: { game: "minesweeper", columns: 9, rows: 9, mines: 10, won, timeMs },
      });

    await play(true, 41_500);
    await play(true, 50_000);
    await play(false, null);
    const view = await call<{
      scores: { bestTimeMs: number | null; played: number; won: number; currentStreak: number }[];
    }>(host, "arcade:list", { profileId });

    expect(view.scores[0]).toMatchObject({
      bestTimeMs: 41_500,
      played: 3,
      won: 2,
      // The loss ended the run the two wins had started.
      currentStreak: 0,
    });
  });

  it("raises every score game's own numbers, and counts 2048 by the tile it reached", async () => {
    const host = harness();
    const profileId = createProfile();
    const record = (result: unknown) => call(host, "arcade:record", { profileId, result });

    await record({ game: "blocks", score: 1200, lines: 12 });
    await record({ game: "blocks", score: 800, lines: 30 });
    await record({ game: "snake", score: 120, eaten: 40 });
    await record({ game: "bricks", score: 1500, levels: 3 });
    await record({ game: "tile2048", size: 4, score: 2000, moves: 120, won: true });
    await record({ game: "tile2048", size: 4, score: 3000, moves: 200, won: false });

    const view = await call<{
      scores: {
        game: string;
        variant: string;
        bestScore: number | null;
        bestCount: number | null;
        currentStreak: number;
        longestStreak: number;
        won: number;
      }[];
    }>(host, "arcade:list", { profileId });

    expect(view.scores).toEqual([
      expect.objectContaining({ game: "blocks", variant: "standard", bestScore: 1200, bestCount: 30 }),
      expect.objectContaining({ game: "bricks", variant: "standard", bestScore: 1500, bestCount: 3 }),
      expect.objectContaining({ game: "snake", variant: "standard", bestScore: 120, bestCount: 40 }),
      expect.objectContaining({
        game: "tile2048",
        variant: "4x4",
        bestScore: 3000,
        bestCount: 200,
        won: 1,
        longestStreak: 1,
        // The second game did not reach the tile, so the run is over.
        currentStreak: 0,
      }),
    ]);
  });

  it("keeps one profile's scores invisible to another", async () => {
    const host = harness();
    const first = createProfile();
    const second = createProfile();
    await call(host, "arcade:record", { profileId: first, result: { game: "blocks", score: 10, lines: 1 } });

    expect(await call(host, "arcade:list", { profileId: second })).toEqual({ scores: [] });
  });
});

describe("the arcade archive section", () => {
  it("round-trips a profile's scores into a fresh profile in a fresh database", async () => {
    const source = harness();
    const sourceProfile = createProfile();
    await call(source, "arcade:record", {
      profileId: sourceProfile,
      result: { game: "minesweeper", columns: 9, rows: 9, mines: 10, won: true, timeMs: 41_500 },
    });
    await call(source, "arcade:record", {
      profileId: sourceProfile,
      result: { game: "snake", score: 120, eaten: 12 },
    });
    const [section] = source.collectExports([sourceProfile]);
    expect(section?.moduleId).toBe("arcade");

    // A second database, because a row's id is a global primary key: the same
    // archive cannot land beside the profile it came from (ADR-023 1).
    const other = openDatabase({ path: join(dir, "other.db") });
    try {
      const target = harness(other);
      const targetProfile = createProfile(other);
      target.applyImports([section!], [targetProfile]);

      const restored = await call<{ scores: { game: string; variant: string; bestScore: number | null }[] }>(
        target,
        "arcade:list",
        { profileId: targetProfile },
      );
      expect(restored.scores.map((row) => `${row.game}/${row.variant}`)).toEqual([
        "minesweeper/beginner",
        "snake/standard",
      ]);
      expect(restored.scores[1]).toMatchObject({ bestScore: 120 });
      // And the target's own export is now the source's.
      expect(target.collectExports([targetProfile])).toEqual([section]);
    } finally {
      other.close();
    }
  });

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {
    const host = harness();
    const profileId = createProfile();
    await call(host, "arcade:record", { profileId, result: { game: "blocks", score: 1200, lines: 12 } });
    const good = (host.collectExports([profileId])[0]?.payload ?? {}) as {
      scores: Record<string, unknown>[];
    };

    const bad: unknown[] = [
      // A version this build does not read.
      { version: 99, scores: [] },
      // A row missing a field.
      { version: 1, scores: [{ ...good.scores[0], played: undefined }] },
      // A Blocks row that claims a win.
      { version: 1, scores: [{ ...good.scores[0], won: 1 }] },
      // The same board twice.
      { version: 1, scores: [good.scores[0], { ...good.scores[0], id: uuidv7() }] },
    ];
    for (const payload of bad) {
      expect(() => host.applyImports([{ moduleId: "arcade", payload }], [profileId])).toThrow();
      const after = await call<{ scores: { bestScore: number | null }[] }>(host, "arcade:list", {
        profileId,
      });
      expect(after.scores).toEqual([expect.objectContaining({ bestScore: 1200 })]);
    }
  });

  it("empties the archived state when the section names no Arcade entry", async () => {
    const host = harness();
    const profileId = createProfile();
    await call(host, "arcade:record", { profileId, result: { game: "blocks", score: 1200, lines: 12 } });

    // A restore replaces the profile whole, so an archive that says nothing about
    // Arcade is this profile's scores going back to empty.
    host.applyImports([], [profileId]);

    expect(await call(host, "arcade:list", { profileId })).toEqual({ scores: [] });
  });

  it("exports an empty payload for a profile that has played nothing, rather than nothing at all", async () => {
    const host = harness();
    const profileId = createProfile();
    expect(host.collectExports([profileId])).toEqual([
      { moduleId: "arcade", payload: { version: 1, scores: [] } },
    ]);
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const host = harness();
    expect(host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});
