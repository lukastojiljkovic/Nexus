import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backgammon,
  boardEngine,
  createSeededRandom,
  draughts,
  fourInARow,
  ludo,
  mlin,
  moveEvent,
  reversi,
  rollEvent,
} from "@nexus/core";
import type { BoardEvent, BoardSeatKind, BoardsGame } from "@nexus/core";
import { openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { register } from "./register.js";

/**
 * BOARDS through the kit (ADR-090): its ops, the wire's refusals, the record a
 * finished game moves, and its archive section.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals, the sender check and the channel allowlist are all the host's. Going
 * through `dispatch` therefore tests what actually runs in the app — a typo in an
 * op name or a payload the validators refuse is a rejected promise here, not a
 * surprise on the first click.
 *
 * The logs below are built by PLAYING the engines, never by hand: a save's whole
 * promise is that its position and its log describe one game, so a test that
 * fabricated the log would be testing something the store exists to refuse.
 */

const TRUSTED = { trusted: true };
const NOW = "2026-06-01T08:00:00.000Z";

let dir: string;
let db: NexusDatabase;

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
    now: () => Date.parse(NOW),
  };
  const host = new ModuleHost(platform);
  register(host);
  return { host };
}

function createProfile(name = "P"): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, NOW);
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

/** Plays `turns` of a game's own turn loop, which is what a save's log has to be. */
function play(
  game: BoardsGame,
  seed: number,
  turns: number,
  from?: unknown,
): { state: unknown; events: BoardEvent[] } {
  const engine = boardEngine(game);
  const rng = createSeededRandom(seed);
  let state = engine.fromJSON(from ?? opening(game));
  const events: BoardEvent[] = [];
  for (let turn = 0; turn < turns; turn += 1) {
    if (engine.outcome(state).status !== "in_progress") break;
    if (engine.needsRoll(state)) {
      state = engine.roll(state, rng);
      events.push(rollEvent(game, state));
      if (engine.needsRoll(state)) continue;
    }
    const moves = engine.legalMoves(state);
    if (moves.length === 0) {
      events.push({ kind: "pass" });
      state = engine.step(state, { kind: "pass" });
      continue;
    }
    const event = moveEvent(game, state, moves[0]);
    events.push(event);
    state = engine.step(state, event);
  }
  return { state, events };
}

/**
 * A game's opening position, per game — because three of the six engines read
 * their shape off one (draughts' rule set, ludo's seats, backgammon's cube) and a
 * test that handed them nothing would be testing a crash.
 */
function opening(game: BoardsGame): unknown {
  switch (game) {
    case "reversi":
      return reversi.toJSON(reversi.initialState());
    case "draughts":
      return draughts.toJSON(draughts.initialState({ kind: "english" }));
    case "mlin":
      return mlin.toJSON(mlin.initialState());
    case "backgammon":
      return backgammon.toJSON(backgammon.initialState());
    case "four-in-a-row":
      return fourInARow.toJSON(fourInARow.initialState());
    case "ludo":
      return ludo.toJSON(ludo.initialState({ seats: 2 }));
  }
}

const REVERSI_SEATS: readonly BoardSeatKind[] = ["human", "computer"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-boards-module-"));
  db = openDatabase({ path: join(dir, "boards.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the boards handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = harness();
    expect(host.channels()).toEqual([
      "boards:list",
      "boards:save",
      "boards:remove",
      "boards:finish",
      "boards:setDefaultLevel",
    ]);
  });

  it("answers a read with the module's preference, and keeps what is written", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const before = await call<{ settings: { defaultLevel: number }; saves: unknown[] }>(
      host,
      "boards:list",
      { profileId },
    );
    // The shipped default, read from the store rather than restated here.
    expect(before.saves).toEqual([]);
    expect(before.settings).toEqual({ defaultLevel: 2 });

    const view = await call<{ settings: { defaultLevel: number } }>(
      host,
      "boards:setDefaultLevel",
      { profileId, level: 3 },
    );
    expect(view.settings).toEqual({ defaultLevel: 3 });
  });

  it("saves a game and reads it back, position, log, seed and all", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const played = play("backgammon", 13, 3);

    const view = await call<{ saves: { game: string; state: unknown; events: BoardEvent[]; seed: number; moves: number }[] }>(
      host,
      "boards:save",
      {
        profileId,
        game: "backgammon",
        state: played.state,
        events: played.events,
        seed: 13,
        level: 2,
        seats: [...REVERSI_SEATS],
      },
    );

    expect(view.saves).toHaveLength(1);
    const save = view.saves[0];
    expect(save?.game).toBe("backgammon");
    expect(save?.seed).toBe(13);
    expect(save?.events).toEqual(played.events);
    expect(save?.moves).toBe(played.events.filter((event) => event.kind === "move").length);
    // The position that comes back is the position the engines will accept, which
    // is what makes a resumed game a game rather than a picture of one.
    expect(() => boardEngine("backgammon").fromJSON(save?.state)).not.toThrow();
  });

  it("empties a slot on `remove`, and clearing an empty one is not an error", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const played = play("reversi", 3, 2);
    await call(host, "boards:save", {
      profileId,
      game: "reversi",
      state: played.state,
      events: played.events,
      seed: 3,
      level: 1,
      seats: [...REVERSI_SEATS],
    });

    const view = await call<{ saves: unknown[] }>(host, "boards:remove", { profileId, game: "reversi" });
    expect(view.saves).toEqual([]);
    await expect(call(host, "boards:remove", { profileId, game: "reversi" })).resolves.toBeTruthy();
  });

  it("refuses a payload the wire should never carry, before the store sees it", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const played = play("reversi", 3, 2);
    const good = {
      profileId,
      game: "reversi",
      state: played.state,
      events: played.events as readonly unknown[],
      seed: 3,
      level: 1 as number | null,
      seats: [...REVERSI_SEATS] as readonly unknown[],
    };

    // One refusal per channel, so a channel nobody validated would be a test that
    // passed here and a hole in the app.
    await expect(call(host, "boards:list", { profileId: "  padded  " })).rejects.toThrow(
      /not a well-formed id/,
    );
    await expect(call(host, "boards:save", { ...good, game: "chess" })).rejects.toThrow(
      /not one of this module's games/,
    );
    await expect(call(host, "boards:save", { ...good, seed: -1 })).rejects.toThrow(
      /between 0 and 4294967295/,
    );
    await expect(call(host, "boards:save", { ...good, level: 4 })).rejects.toThrow(
      /between 1 and 3/,
    );
    await expect(call(host, "boards:save", { ...good, state: "not a position" })).rejects.toThrow(
      /expected an object/,
    );
    await expect(call(host, "boards:save", { ...good, events: "not a log" })).rejects.toThrow(
      /must be an array/,
    );
    await expect(call(host, "boards:save", { ...good, seats: "not seats" })).rejects.toThrow(
      /must be an array/,
    );
    await expect(call(host, "boards:remove", { profileId, game: "go" })).rejects.toThrow(
      /not one of this module's games/,
    );
    await expect(call(host, "boards:finish", { ...good, ending: "whenever" })).rejects.toThrow(
      /is not a way a game ends/,
    );
    await expect(call(host, "boards:setDefaultLevel", { profileId, level: 0 })).rejects.toThrow(
      /between 1 and 3/,
    );
    // And the two the HOST owns: a message from somewhere else, and a channel no
    // module answers.
    await expect(host.dispatch("boards:list", { trusted: false }, { profileId })).rejects.toThrow(
      /did not come from this app/,
    );
    await expect(call(host, "boards:nonsense", { profileId })).rejects.toThrow(
      /No module answers channel/,
    );
  });

  it("refuses a position its own log does not produce, rather than storing both", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const played = play("reversi", 3, 4);
    // The position this game passed through two turns earlier: a real position of
    // the same game, and not the one the whole log produces.
    const earlier = play("reversi", 3, 2);

    // Two ways for a save to be a lie, and the store names each: a log that is not
    // a game at all (a move dropped from the middle of it), and a log that is one
    // but leads somewhere other than the position sent with it.
    await expect(
      call(host, "boards:save", {
        profileId,
        game: "reversi",
        state: played.state,
        events: played.events.slice(1),
        seed: 3,
        level: 1,
        seats: [...REVERSI_SEATS],
      }),
    ).rejects.toThrow(/not a game the rules allow/);
    await expect(
      call(host, "boards:save", {
        profileId,
        game: "reversi",
        state: earlier.state,
        events: played.events,
        seed: 3,
        level: 1,
        seats: [...REVERSI_SEATS],
      }),
    ).rejects.toThrow(/not the position its move log produces/);
    const after = await call<{ saves: unknown[] }>(host, "boards:list", { profileId });
    expect(after.saves).toEqual([]);
  });
});

describe("the record a finished game moves", () => {
  /** A four-in-a-row game seat 0 wins on move seven: four discs dropped into column 0. */
  function wonFour(): { state: unknown; events: BoardEvent[] } {
    const engine = boardEngine("four-in-a-row");
    let state = engine.fromJSON(fourInARow.toJSON(fourInARow.initialState()));
    const events: BoardEvent[] = [];
    for (const column of [0, 1, 0, 1, 0, 1, 0]) {
      const event = moveEvent("four-in-a-row", state, { column });
      events.push(event);
      state = engine.step(state, event);
    }
    return { state, events };
  }

  it("counts a finished game against the computer, and takes the slot away", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const game = wonFour();
    await call(host, "boards:save", {
      profileId,
      game: "four-in-a-row",
      state: game.state,
      events: game.events,
      seed: 1,
      level: 3,
      seats: [...REVERSI_SEATS],
    });

    const view = await call<{
      saves: unknown[];
      stats: { game: string; level: number; played: number; won: number }[];
    }>(host, "boards:finish", {
      profileId,
      game: "four-in-a-row",
      state: game.state,
      events: game.events,
      seed: 1,
      level: 3,
      seats: [...REVERSI_SEATS],
      ending: "position",
    });

    expect(view.saves).toEqual([]);
    const row = view.stats.find((stats) => stats.game === "four-in-a-row" && stats.level === 3);
    expect(row).toMatchObject({ played: 1, won: 1 });
  });

  it("refuses an ending by position on a game that is still in progress", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const played = play("reversi", 3, 2);
    await expect(
      call(host, "boards:finish", {
        profileId,
        game: "reversi",
        state: played.state,
        events: played.events,
        seed: 3,
        level: 1,
        seats: [...REVERSI_SEATS],
        ending: "position",
      }),
    ).rejects.toThrow(/not over/);
  });
});

describe("the boards archive section", () => {
  it("round-trips a saved game, the record and the preference between two profiles", async () => {
    const { host } = harness();
    const source = createProfile("A");
    const target = createProfile("B");
    const played = play("reversi", 8, 3);
    await call(host, "boards:save", {
      profileId: source,
      game: "reversi",
      state: played.state,
      events: played.events,
      seed: 8,
      level: 2,
      seats: [...REVERSI_SEATS],
    });
    await call(host, "boards:setDefaultLevel", { profileId: source, level: 3 });

    const [section] = host.collectExports([source]);
    expect(section?.moduleId).toBe("boards");
    host.applyImports([section!], [target]);

    const restored = await call<{
      saves: { game: string; state: unknown; events: BoardEvent[] }[];
      settings: { defaultLevel: number };
    }>(host, "boards:list", { profileId: target });
    expect(restored.saves.map((save) => save.game)).toEqual(["reversi"]);
    expect(restored.saves[0]?.events).toEqual(played.events);
    expect(restored.settings).toEqual({ defaultLevel: 3 });
    // The restored profile's save is a game the engines will read back, which is
    // the half a byte-for-byte copy could not promise on its own.
    expect(readablePosition(restored.saves[0]?.state)).toBe(true);
  });

  it("empties the archived state when the section names no board games entry", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const played = play("reversi", 8, 3);
    await call(host, "boards:save", {
      profileId,
      game: "reversi",
      state: played.state,
      events: played.events,
      seed: 8,
      level: 2,
      seats: [...REVERSI_SEATS],
    });

    // A restore of an archive written before this module existed: a restore
    // replaces a profile whole, so this profile has no board games at all.
    host.applyImports([], [profileId]);

    const after = await call<{ saves: unknown[] }>(host, "boards:list", { profileId });
    expect(after.saves).toEqual([]);
  });

  it("refuses an archive it cannot read, leaving the profile exactly as it found it", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const played = play("reversi", 8, 3);
    await call(host, "boards:save", {
      profileId,
      game: "reversi",
      state: played.state,
      events: played.events,
      seed: 8,
      level: 2,
      seats: [...REVERSI_SEATS],
    });
    const exported = host.collectExports([profileId]);
    const payload = exported[0]?.payload as Record<string, unknown>;

    for (const broken of [
      { ...payload, version: 99 },
      { ...payload, saves: [{ ...(payload["saves"] as Record<string, unknown>[])[0], events: [] }] },
      { ...payload, settings: { defaultLevel: 9 } },
    ]) {
      expect(() => host.applyImports([{ moduleId: "boards", payload: broken }], [profileId])).toThrow();
      const after = await call<{ saves: { events: BoardEvent[] }[] }>(host, "boards:list", {
        profileId,
      });
      expect(after.saves[0]?.events).toEqual(played.events);
    }
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const { host } = harness();
    expect(host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});

/** Whether a state the wire handed over is one the engines accept — the check a byte copy could not make. */
function readablePosition(state: unknown): boolean {
  try {
    reversi.fromJSON(state);
    return true;
  } catch {
    return false;
  }
}
