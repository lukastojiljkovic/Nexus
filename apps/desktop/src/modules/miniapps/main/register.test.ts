import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import type { MiniappsView } from "../shared/ipc.js";
import { register } from "./register.js";

/**
 * The MINI-APPS module through the kit (ADR-090): its ops, the kept document
 * they write, and its archive section.
 *
 * **Why these tests drive the HOST rather than calling the module.** `register`
 * is the only entry point the discovery glue knows, and the refusals, the sender
 * check and the channel allowlist are all the host's - so a typo in an op name
 * or a payload the validators refuse is a rejected promise here rather than a
 * surprise on the first click. Everything else is real: a real encrypted
 * database, the real migrations, the real store.
 *
 * The clock is the harness's, so the `updated_at` a write stamps is a number
 * this test moves instead of the machine's own time.
 */

const TRUSTED = { trusted: true };

let dir: string;
let db: NexusDatabase;
let clock = Date.parse("2026-06-01T08:00:00.000Z");

interface Harness {
  readonly host: ModuleHost;
}

function harness(): Harness {
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    notify: () => undefined,
    schedule: () => () => undefined,
    now: () => clock,
  };
  const host = new ModuleHost(platform);
  register(host);
  return { host };
}

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date(clock).toISOString());
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

const COUNTERS = [
  { id: "c1", name: "Voda", value: 3, step: 1, floorZero: true },
  { id: "c2", name: "Sklopovi", value: 40, step: 5, floorZero: false },
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-miniapps-module-"));
  db = openDatabase({ path: join(dir, "miniapps.db") });
  clock = Date.parse("2026-06-01T08:00:00.000Z");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the mini-apps handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = harness();
    expect(host.channels()).toEqual([
      "miniapps:list",
      "miniapps:setLastApp",
      "miniapps:saveCounters",
      "miniapps:saveScoreboard",
      "miniapps:saveTyping",
      "miniapps:saveCities",
      "miniapps:saveDiceHistory",
    ]);
  });

  it("answers a read with the empty kept state of a fresh profile", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const view = await call<MiniappsView>(host, "miniapps:list", { profileId });

    expect(view).toEqual({
      lastApp: null,
      counters: [],
      scoreboard: { players: [], rounds: [], target: null },
      typing: { layout: "sr-Latn", lessonId: "home-index-inner", records: [] },
      cities: [],
      diceHistory: [],
    });
  });

  it("writes one tool's state and answers with the whole view", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const afterCounters = await call<MiniappsView>(host, "miniapps:saveCounters", {
      profileId,
      counters: COUNTERS,
    });
    expect(afterCounters.counters).toEqual(COUNTERS);

    const afterTile = await call<MiniappsView>(host, "miniapps:setLastApp", {
      profileId,
      app: "tally",
    });
    expect(afterTile.lastApp).toBe("tally");
    // The write that changed the tile did not disturb the counters.
    expect(afterTile.counters).toEqual(COUNTERS);
  });

  it("remembers the tile, and clears it again", async () => {
    const { host } = harness();
    const profileId = createProfile();

    await call(host, "miniapps:setLastApp", { profileId, app: "qr" });
    expect((await call<MiniappsView>(host, "miniapps:list", { profileId })).lastApp).toBe("qr");

    const cleared = await call<MiniappsView>(host, "miniapps:setLastApp", { profileId, app: null });
    expect(cleared.lastApp).toBeNull();
  });

  it("refuses a payload the wire should never carry, before the store sees it", async () => {
    const { host } = harness();
    const profileId = createProfile();

    await expect(call(host, "miniapps:list", { profileId: "  padded  " })).rejects.toThrow(
      /not a well-formed id/,
    );
    await expect(
      call(host, "miniapps:setLastApp", { profileId, app: "solitaire" }),
    ).rejects.toThrow(/not a tile of this module/);
    await expect(
      call(host, "miniapps:saveCounters", {
        profileId,
        counters: [{ id: "c1", name: "x".repeat(61), value: 0, step: 1, floorZero: false }],
      }),
    ).rejects.toThrow(/must not exceed 60 characters/);
    await expect(
      call(host, "miniapps:saveCounters", {
        profileId,
        counters: [{ id: "c1", name: "A", value: 0, step: 0, floorZero: false }],
      }),
    ).rejects.toThrow(/between 1 and 1000/);
    await expect(
      call(host, "miniapps:saveCities", { profileId, cities: ["Mars/Olympus"] }),
    ).rejects.toThrow(/not a known time zone/);
    await expect(
      call(host, "miniapps:saveTyping", {
        profileId,
        progress: { layout: "de-DE", lessonId: "home-index-inner", records: [] },
      }),
    ).rejects.toThrow(/must be one of en-US, sr-Latn/);
    await expect(
      call(host, "miniapps:saveDiceHistory", {
        profileId,
        history: Array.from({ length: 51 }, (_value, index) => ({
          atMs: index,
          label: "d6",
          result: "1",
        })),
      }),
    ).rejects.toThrow(/holds at most 50 entries/);
    await expect(
      call(host, "miniapps:saveCities", {
        profileId,
        // The same city twice is a clock with two identical rows.
        cities: ["Europe/Belgrade", "Europe/Belgrade"],
      }),
    ).rejects.toThrow(/listed twice/);
  });

  it("refuses a board whose round scores a player who is not on it", async () => {
    const { host } = harness();
    const profileId = createProfile();

    await expect(
      call(host, "miniapps:saveScoreboard", {
        profileId,
        board: {
          players: [{ id: "p1", name: "Ana" }],
          rounds: [{ scores: { ghost: 3 } }],
          target: null,
        },
      }),
    ).rejects.toThrow(/scores a player who is not on the board/);
    await expect(
      call(host, "miniapps:saveScoreboard", {
        profileId,
        board: {
          players: [{ id: "p1", name: "Ana" }],
          rounds: [{ scores: {} }],
          target: 0,
        },
      }),
    ).rejects.toThrow(/between 1 and/);
  });
});

describe("the mini-apps archive section", () => {
  it("round-trips every stored tool between two profiles", async () => {
    const kit = harness();
    const source = createProfile();
    const target = createProfile();
    await call(kit.host, "miniapps:setLastApp", { profileId: source, app: "dice" });
    await call(kit.host, "miniapps:saveCounters", { profileId: source, counters: COUNTERS });
    await call(kit.host, "miniapps:saveScoreboard", {
      profileId: source,
      board: {
        players: [
          { id: "p1", name: "Ana" },
          { id: "p2", name: "Bojan" },
        ],
        rounds: [{ scores: { p1: 12, p2: 7 } }],
        target: 100,
      },
    });
    await call(kit.host, "miniapps:saveTyping", {
      profileId: source,
      progress: {
        layout: "en-US",
        lessonId: "home-pinky",
        records: [
          { layout: "en-US", lessonId: "home-pinky", netWpm: 38.4, accuracy: 0.96, atMs: 1_700_000 },
        ],
      },
    });
    await call(kit.host, "miniapps:saveCities", {
      profileId: source,
      cities: ["Europe/Belgrade", "America/New_York"],
    });
    await call(kit.host, "miniapps:saveDiceHistory", {
      profileId: source,
      history: [{ atMs: 1_700_001, label: "2d6+3", result: "11" }],
    });

    const [section] = kit.host.collectExports([source]);
    expect(section?.moduleId).toBe("miniapps");
    kit.host.applyImports([section!], [target]);

    const restored = await call<MiniappsView>(kit.host, "miniapps:list", { profileId: target });
    expect(restored.lastApp).toBe("dice");
    expect(restored.counters).toEqual(COUNTERS);
    expect(restored.scoreboard.players.map((player) => player.name)).toEqual(["Ana", "Bojan"]);
    expect(restored.scoreboard.rounds).toEqual([{ scores: { p1: 12, p2: 7 } }]);
    expect(restored.scoreboard.target).toBe(100);
    expect(restored.typing.layout).toBe("en-US");
    expect(restored.typing.records).toEqual([
      { layout: "en-US", lessonId: "home-pinky", netWpm: 38.4, accuracy: 0.96, atMs: 1_700_000 },
    ]);
    expect(restored.cities).toEqual(["Europe/Belgrade", "America/New_York"]);
    expect(restored.diceHistory).toEqual([{ atMs: 1_700_001, label: "2d6+3", result: "11" }]);
  });

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {
    const kit = harness();
    const profileId = createProfile();
    await call(kit.host, "miniapps:saveCounters", { profileId, counters: COUNTERS });

    const intact: MiniappsView = await call<MiniappsView>(kit.host, "miniapps:list", {
      profileId,
    });
    // Three shapes a later build (or a hand-edited archive) could produce: a
    // version this module does not know, a counter whose name the engine would
    // refuse, and a round that is missing a player's score.
    const base = {
      version: 1,
      lastApp: null,
      counters: COUNTERS,
      scoreboard: { players: [{ id: "p1", name: "Ana" }], rounds: [], target: null },
      typing: { layout: "sr-Latn", lessonId: "home-index-inner", records: [] },
      cities: [],
      diceHistory: [],
    };
    for (const payload of [
      { ...base, version: 99 },
      { ...base, counters: [{ id: "c1", name: "x".repeat(61), value: 0, step: 1, floorZero: false }] },
      {
        ...base,
        scoreboard: { players: [{ id: "p1", name: "Ana" }], rounds: [{ scores: {} }], target: null },
      },
    ]) {
      expect(() => kit.host.applyImports([{ moduleId: "miniapps", payload }], [profileId])).toThrow();
      const after = await call<MiniappsView>(kit.host, "miniapps:list", { profileId });
      expect(after).toEqual(intact);
    }
  });

  it("reads a tile id this build does not know as no tile open, rather than a broken page", async () => {
    const kit = harness();
    const profileId = createProfile();

    kit.host.applyImports(
      [
        {
          moduleId: "miniapps",
          payload: {
            version: 1,
            // A tile a LATER build added: the store keeps a bounded string, and
            // the wire is what decides whether it names a page.
            lastApp: "hologram",
            counters: [],
            scoreboard: { players: [], rounds: [], target: null },
            typing: { layout: "sr-Latn", lessonId: "home-index-inner", records: [] },
            cities: [],
            diceHistory: [],
          },
        },
      ],
      [profileId],
    );

    const view = await call<MiniappsView>(kit.host, "miniapps:list", { profileId });
    expect(view.lastApp).toBeNull();
  });

  it("empties the archived state when the section names no Mini-apps entry", async () => {
    const kit = harness();
    const profileId = createProfile();
    await call(kit.host, "miniapps:saveCounters", { profileId, counters: COUNTERS });
    await call(kit.host, "miniapps:setLastApp", { profileId, app: "tally" });
    // What a profile with no row answers: the empty document, read from the
    // module rather than restated here.
    const rowless = await call<MiniappsView>(kit.host, "miniapps:list", {
      profileId: createProfile(),
    });

    // An archive with no Mini-apps entry is what a restore of a pre-module
    // archive hands over, and a restore replaces the profile whole.
    kit.host.applyImports([], [profileId]);

    expect(await call<MiniappsView>(kit.host, "miniapps:list", { profileId })).toEqual(rowless);
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const kit = harness();
    expect(kit.host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});
