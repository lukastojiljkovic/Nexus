import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyKlondike,
  dealKlondike,
  klondikeMoves,
  type KlondikeMove,
  type KlondikeState,
} from "@nexus/core";
import { MAX_CARD_GAME_MOVES, openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { register } from "./register.js";

/**
 * CARDS through the kit (ADR-090): its ops, the wire's refusals, the record a finished
 * deal moves, and its archive section.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the refusals,
 * the sender check and the channel allowlist are all the host's. Going through
 * `dispatch` therefore tests what actually runs in the app — a typo in an op name or a
 * payload the validators refuse is a rejected promise here, not a surprise on a click.
 *
 * The logs below are built by PLAYING the engine, never by hand: a save's whole promise
 * is that its log is a game the engine will still fold, so a test that fabricated one
 * would be testing something the store exists to refuse.
 */

const TRUSTED = { trusted: true };
const NOW = "2026-06-01T08:00:00.000Z";

let dir: string;
let db: NexusDatabase;

function harness(): ModuleHost {
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    attachFiles: async () => ({ canceled: true }),
    releaseBlob: async () => undefined,
    notify: () => undefined,
    schedule: () => () => undefined,
    now: () => Date.parse(NOW),
  };
  const host = new ModuleHost(platform);
  register(host);
  return host;
}

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

/** A Klondike game played `turns` actions deep, with the log the store will replay. */
function playedKlondike(seed: number, turns: number): KlondikeState {
  let state = dealKlondike("draw1", seed);
  for (let turn = 0; turn < turns; turn += 1) {
    const move: KlondikeMove | undefined = klondikeMoves(state)[0];
    if (move === undefined) break;
    state = applyKlondike(state, move);
  }
  return state;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-cards-module-"));
  db = openDatabase({ path: join(dir, "cards.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the cards handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    expect(harness().channels()).toEqual(["cards:list", "cards:save", "cards:record", "cards:clear"]);
  });

  it("answers a read with every slot zero-filled and nothing saved", async () => {
    const host = harness();
    const profileId = createProfile();
    const view = await call<{ saves: unknown[]; stats: { game: string; played: number }[] }>(
      host,
      "cards:list",
      { profileId },
    );
    expect(view.saves).toEqual([]);
    // Nine games and sixteen variants, each with an empty row to draw.
    expect(view.stats).toHaveLength(16);
    expect(view.stats.every((row) => row.played === 0)).toBe(true);
  });
});

describe("save and resume", () => {
  it("writes a game, reads it back, and replays it to the same position", async () => {
    const host = harness();
    const profileId = createProfile();
    const played = playedKlondike(31, 5);

    const view = await call<{ saves: { game: string; seed: number; moves: unknown[]; score: number }[] }>(
      host,
      "cards:save",
      {
        profileId,
        game: "klondike",
        variant: "draw1",
        seed: 31,
        moves: played.log,
        elapsedSeconds: 7,
      },
    );
    const save = view.saves[0];
    expect(save?.game).toBe("klondike");
    expect(save?.seed).toBe(31);
    expect(save?.moves).toEqual(played.log);
    // The score is the STORE's fold of the log, not a number the page sent.
    expect(save?.score).toBe(played.score);

    // And the log the module answers with is one the engine still folds to the same
    // position — which is the whole promise of storing a seed and a log.
    let replayed = dealKlondike("draw1", 31);
    for (const move of (save?.moves ?? []) as KlondikeMove[]) replayed = applyKlondike(replayed, move);
    expect(JSON.stringify(replayed.board)).toBe(JSON.stringify(played.board));
    expect(replayed.score).toBe(played.score);
  });

  it("replaces the saved game for one slot and leaves the other slots standing", async () => {
    const host = harness();
    const profileId = createProfile();
    const first = playedKlondike(31, 2);
    const second = playedKlondike(31, 6);
    await call(host, "cards:save", {
      profileId,
      game: "klondike",
      variant: "draw1",
      seed: 31,
      moves: first.log,
      elapsedSeconds: 1,
    });
    const view = await call<{ saves: { variant: string; moves: unknown[] }[] }>(
      host,
      "cards:save",
      {
        profileId,
        game: "klondike",
        variant: "draw3",
        seed: 31,
        moves: second.log,
        elapsedSeconds: 2,
      },
    );
    // One saved game per game AND variant, which is the primary key's promise.
    expect(view.saves.map((save) => save.variant).sort()).toEqual(["draw1", "draw3"]);
  });

  it("clears one slot on `clear`, and clearing an empty one is not an error", async () => {
    const host = harness();
    const profileId = createProfile();
    const played = playedKlondike(8, 3);
    await call(host, "cards:save", {
      profileId,
      game: "klondike",
      variant: "draw1",
      seed: 8,
      moves: played.log,
      elapsedSeconds: 0,
    });
    const after = await call<{ saves: unknown[] }>(host, "cards:clear", {
      profileId,
      game: "klondike",
      variant: "draw1",
    });
    expect(after.saves).toEqual([]);
    // Clearing an empty slot answers the same read rather than refusing.
    expect(
      (await call<{ saves: unknown[] }>(host, "cards:clear", {
        profileId,
        game: "spider",
        variant: "suits4",
      })).saves,
    ).toEqual([]);
  });
});

describe("the wire's refusals", () => {
  it("refuses a game, a variant, a seed and a clock the store would not take, before it sees them", async () => {
    const host = harness();
    const profileId = createProfile();
    const played = playedKlondike(2, 3);
    const base = {
      profileId,
      game: "klondike",
      variant: "draw1",
      seed: 2,
      moves: played.log,
      elapsedSeconds: 0,
    };

    await expect(call(host, "cards:save", { ...base, game: "solitaire" })).rejects.toThrow(
      /"game" must be one of/,
    );
    // FreeCell's own seed check fires first: a Klondike seed of 2 IS a deal number,
    // so the case is made with one outside the classic set.
    await expect(
      call(host, "cards:save", { ...base, game: "freecell", variant: "classic", seed: 32_001 }),
    ).rejects.toThrow(/FreeCell deal number/);
    await expect(call(host, "cards:save", { ...base, variant: "draw2" })).rejects.toThrow(
      /"variant" must be one of/,
    );
    await expect(call(host, "cards:save", { ...base, seed: -1 })).rejects.toThrow(
      /32-bit unsigned integer/,
    );
    await expect(call(host, "cards:save", { ...base, elapsedSeconds: 90_000 })).rejects.toThrow(
      /elapsedSeconds/,
    );
    await expect(call(host, "cards:save", { ...base, moves: "not a list" })).rejects.toThrow(
      /"moves" must be an array/,
    );
    await expect(
      call(host, "cards:save", { ...base, moves: [...played.log, { kind: "recycle" }] }),
    ).rejects.toThrow();
    // A field that is not an id at all is refused as an id, not passed on.
    await expect(call(host, "cards:list", { profileId: "  padded  " })).rejects.toThrow(/id/);
  });

  it("refuses a move list over its ceiling without folding it", async () => {
    const host = harness();
    const profileId = createProfile();
    const moves = Array.from({ length: MAX_CARD_GAME_MOVES + 1 }, () => ({ kind: "draw" }));
    await expect(
      call(host, "cards:save", {
        profileId,
        game: "klondike",
        variant: "draw1",
        seed: 1,
        moves,
        elapsedSeconds: 0,
      }),
    ).rejects.toThrow(/at most/);
  });

  it("refuses an entry that is not a move object at all", async () => {
    const host = harness();
    const profileId = createProfile();
    await expect(
      call(host, "cards:save", {
        profileId,
        game: "klondike",
        variant: "draw1",
        seed: 1,
        moves: ["draw"],
        elapsedSeconds: 0,
      }),
    ).rejects.toThrow(/must be an object with a "kind"/);
  });

  it("refuses a finished deal whose `won` is not a boolean", async () => {
    const host = harness();
    const profileId = createProfile();
    await expect(
      call(host, "cards:record", {
        profileId,
        game: "klondike",
        variant: "draw1",
        seed: 1,
        moves: [],
        elapsedSeconds: 0,
        won: "yes",
      }),
    ).rejects.toThrow(/"won" must be a boolean/);
  });
});

describe("recording a finished deal", () => {
  it("moves the record, keeps the best in the game's own direction, and clears the saved game", async () => {
    const host = harness();
    const profileId = createProfile();
    const played = playedKlondike(17, 5);
    // Golf counts the cards left, so a SMALLER score is the better result; Hearts
    // counts penalties, and the direction table is what decides which one is kept.
    await call(host, "cards:record", {
      profileId,
      game: "golf",
      variant: "classic",
      seed: 3,
      moves: [],
      elapsedSeconds: 60,
      won: true,
    });
    await call(host, "cards:record", {
      profileId,
      game: "golf",
      variant: "classic",
      seed: 4,
      moves: [],
      elapsedSeconds: 30,
      won: true,
    });
    const view = await call<{
      stats: { game: string; variant: string; played: number; won: number; bestTimeMs: number; currentStreak: number }[];
      saves: unknown[];
    }>(host, "cards:record", {
      profileId,
      game: "klondike",
      variant: "draw1",
      seed: 17,
      moves: played.log,
      elapsedSeconds: 12,
      won: true,
    });
    const golf = view.stats.find((row) => row.game === "golf");
    expect(golf).toMatchObject({ played: 2, won: 2, currentStreak: 2 });
    // Two wins make the faster one the best time, in milliseconds.
    expect(golf?.bestTimeMs).toBe(30_000);
    const klondike = view.stats.find((row) => row.game === "klondike");
    expect(klondike?.played).toBe(1);
    // A finished deal leaves no game to resume.
    expect(view.saves.some((save) => (save as { game: string }).game === "klondike")).toBe(false);
  });

  it("ends a winning streak on a loss and never lowers the longest", async () => {
    const host = harness();
    const profileId = createProfile();
    for (const won of [true, true, false]) {
      await call(host, "cards:record", {
        profileId,
        game: "spider",
        variant: "suits1",
        seed: 1,
        moves: [],
        elapsedSeconds: 10,
        won,
      });
    }
    const view = await call<{ stats: { game: string; currentStreak: number; longestStreak: number; played: number; won: number }[] }>(
      host,
      "cards:list",
      { profileId },
    );
    const row = view.stats.find((entry) => entry.game === "spider");
    expect(row).toMatchObject({ played: 3, won: 2, currentStreak: 0, longestStreak: 2 });
  });
});

describe("the cards archive section", () => {
  it("round-trips the record and the saved games through the module", async () => {
    const host = harness();
    const source = createProfile();
    const target = createProfile();
    const played = playedKlondike(6, 4);
    await call(host, "cards:save", {
      profileId: source,
      game: "klondike",
      variant: "draw1",
      seed: 6,
      moves: played.log,
      elapsedSeconds: 5,
    });
    await call(host, "cards:record", {
      profileId: source,
      game: "hearts",
      variant: "standard",
      seed: 1,
      moves: [],
      elapsedSeconds: 100,
      won: true,
    });

    const [section] = host.collectExports([source]);
    expect(section?.moduleId).toBe("cards");
    host.applyImports([section!], [target]);

    const restored = await call<{
      saves: { game: string; variant: string; seed: number; moves: unknown[] }[];
      stats: { game: string; played: number; won: number }[];
    }>(host, "cards:list", { profileId: target });
    expect(restored.saves).toHaveLength(1);
    expect(restored.saves[0]).toMatchObject({ game: "klondike", variant: "draw1", seed: 6 });
    expect(restored.saves[0]?.moves).toEqual(played.log);
    expect(restored.stats.find((row) => row.game === "hearts")).toMatchObject({ played: 1, won: 1 });
  });

  it("empties the archived state when the section names no Cards entry", async () => {
    const host = harness();
    const profileId = createProfile();
    const played = playedKlondike(6, 2);
    await call(host, "cards:save", {
      profileId,
      game: "klondike",
      variant: "draw1",
      seed: 6,
      moves: played.log,
      elapsedSeconds: 0,
    });

    // A restore replaces a profile whole, so an archive with no Cards section means
    // empty: no saved games and no record.
    host.applyImports([], [profileId]);
    const after = await call<{ saves: unknown[]; stats: { played: number }[] }>(host, "cards:list", {
      profileId,
    });
    expect(after.saves).toEqual([]);
    expect(after.stats.every((row) => row.played === 0)).toBe(true);
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    expect(harness().collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});
