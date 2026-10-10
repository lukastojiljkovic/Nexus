import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { ModuleToolError, type ModuleToolPack, type ModuleToolsAccess } from "../../../main/moduleTools.js";
import { register } from "./register.js";

/**
 * CHESS through the kit (ADR-090): its ops, the refusals of the wire, and its
 * archive section.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * sender check, the channel allowlist and the three refusals are the host's — so
 * going through `dispatch` tests what actually runs in the app, and a payload the
 * validators refuse is a rejected promise here rather than a surprise on a click.
 *
 * Everything below the wire is real: a real encrypted database, the real
 * migrations, the real store, and a clock the test moves.
 */

const TRUSTED = { trusted: true };
const NOW = "2026-06-01T08:00:00.000Z";
/** Fool's mate with its tags: the shortest real game this file can store. */
const FOOLS_MATE_PGN = `[Event "Fool's mate"]
[Site "?"]
[Date "????.??.??"]
[White "?"]
[Black "?"]
[Result "0-1"]

1. f3 e6 2. g4 Qh4# 0-1
`;

/** The position after Fool's mate — what a saved game in progress would hold. */
const FOOLS_MATE_FEN = "rnb1kbnr/pppp1ppp/4p3/8/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";

let dir: string;
let db: NexusDatabase;
let clock = Date.parse(NOW);
/** The tool access the harness is built with: a machine with no pack installed, unless a case says otherwise. */
let tools: ModuleToolsAccess;

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
    tools,
  };
  const host = new ModuleHost(platform);
  register(host);
  return { host };
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

/** One game saved the way the page saves one, answering the view it produced. */
async function saveGame(
  host: ModuleHost,
  profileId: string,
  overrides: Record<string, unknown> = {},
): Promise<ChessView> {
  return call<ChessView>(host, "chess:saveGame", {
    profileId,
    pgn: FOOLS_MATE_PGN,
    result: "black",
    playedAt: NOW,
    playedColor: "b",
    opponent: "engine",
    level: 3,
    timeControl: "600+5",
    ...overrides,
  });
}

interface ChessView {
  resume: { moves: string[]; fen: string; timeControl: string | null } | null;
  games: { id: string; result: string; pgn?: string; level: number | null }[];
  stats: { level: number; played: number; won: number; drawn: number; lost: number }[];
  pack: {
    id: string;
    version: string;
    fromLevel: number;
    catalogue: string;
    licence: { spdx: string };
    source: { name: string };
  } | null;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-chess-module-"));
  db = openDatabase({ path: join(dir, "chess.db") });
  clock = Date.parse(NOW);
  tools = noTools();
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * The tool access of a machine with nothing installed — which is the product
 * this module has always been: every level played by its own engine.
 */
function noTools(): ModuleToolsAccess {
  return {
    installed: () => [],
    pack: () => null,
    // The capability's own refusal for an id nothing is installed under, which is
    // the code the module maps onto „this level needs a pack“.
    session: () => Promise.reject(new ModuleToolError("unknown-pack", "No tool pack is installed.")),
  };
}

/** The Stockfish pack, as its own manifest describes it, for the cases that need one installed. */
const STOCKFISH: ModuleToolPack = {
  id: "stockfish",
  version: "19.0.0",
  title: { sr: "Stockfish 19", en: "Stockfish 19" },
  protocol: "uci",
  entry: "engine/stockfish-windows-x86-64-universal.exe",
  args: [],
  licence: {
    spdx: "GPL-3.0-or-later",
    attribution: "The Stockfish developers (see AUTHORS in the pack)",
    url: "https://www.gnu.org/licenses/gpl-3.0.html",
  },
  source: {
    name: "Stockfish",
    url: "https://github.com/official-stockfish/Stockfish/releases/tag/sf_19",
  },
};

function stockfishInstalled(): ModuleToolsAccess {
  return {
    installed: () => [STOCKFISH],
    pack: (id) => (id === STOCKFISH.id ? STOCKFISH : null),
    // No case in this file starts a process: the session is where the engine
    // would be, and `engine.test.ts` is where a real one is driven.
    session: () => Promise.reject(new Error("this case never starts an engine")),
  };
}

describe("the chess handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = harness();
    expect(host.channels()).toEqual([
      "chess:list",
      "chess:getGame",
      "chess:saveGame",
      "chess:deleteGame",
      "chess:setResume",
      "chess:clearResume",
      "chess:engineMove",
      "chess:engineClose",
    ]);
  });

  it("answers a read of an empty profile with no game, no games, and eight zero-filled levels", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const view = await call<ChessView>(host, "chess:list", { profileId });

    expect(view.resume).toBeNull();
    expect(view.games).toEqual([]);
    expect(view.stats).toHaveLength(8);
    expect(view.stats.map((entry) => entry.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const entry of view.stats) expect(entry.played).toBe(0);
    // No pack installed: the view says so rather than describing a machine that
    // does not exist, and the page then marks the levels that would need one.
    expect(view.pack).toBeNull();
  });

  it("carries the installed engine pack, licence and source included, when one is there", async () => {
    tools = stockfishInstalled();
    const { host } = harness();
    const profileId = createProfile();
    const view = await call<ChessView>(host, "chess:list", { profileId });
    // The five facts ADR-094 §5 requires wherever the engine is named, plus the
    // two the page acts on: which level the pack takes over, and where a user
    // installs one.
    expect(view.pack).toMatchObject({
      id: "stockfish",
      version: "19.0.0",
      fromLevel: 6,
      catalogue: "settings:packs",
      licence: { spdx: "GPL-3.0-or-later" },
      source: { name: "Stockfish" },
    });
  });

  it("saves a game, moves the ladder record, and reads the PGN back on demand", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const saved = await saveGame(host, profileId);

    // A game the user won with Black at level 3: one game, one win.
    expect(saved.games).toHaveLength(1);
    expect(saved.games[0]).toMatchObject({ result: "black", level: 3 });
    expect(saved.stats[2]).toMatchObject({ level: 3, played: 1, won: 1, drawn: 0, lost: 0 });

    // The list carries no PGN (see `shared/ipc.ts`); `getGame` is where one is read.
    const id = saved.games[0]?.id ?? "";
    expect(saved.games[0]).not.toHaveProperty("pgn");
    const detail = await call<{ pgn: string; result: string } | null>(host, "chess:getGame", {
      profileId,
      id,
    });
    expect(detail?.pgn).toBe(FOOLS_MATE_PGN);
    expect(detail?.result).toBe("black");
  });

  it("answers null for a game that is not there, rather than failing the call", async () => {
    const { host } = harness();
    const profileId = createProfile();
    expect(await call(host, "chess:getGame", { profileId, id: "nema-me" })).toBeNull();
  });

  it("deletes a game, and refuses to delete one that is already gone", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const saved = await saveGame(host, profileId);
    const id = saved.games[0]?.id ?? "";

    const after = await call<ChessView>(host, "chess:deleteGame", { profileId, id });
    expect(after.games).toEqual([]);
    await expect(call(host, "chess:deleteGame", { profileId, id })).rejects.toThrow();
  });

  it("keeps one game in progress per profile, and clears it on request", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const written = await call<ChessView>(host, "chess:setResume", {
      profileId,
      startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      fen: FOOLS_MATE_FEN,
      moves: ["f2f3", "e7e6", "g2g4", "d8h4"],
      playedColor: "w",
      opponent: "human",
      level: null,
      timeControl: "600+5",
    });
    expect(written.resume?.moves).toEqual(["f2f3", "e7e6", "g2g4", "d8h4"]);
    expect(written.resume?.fen).toBe(FOOLS_MATE_FEN);
    expect(written.resume?.timeControl).toBe("600+5");

    const cleared = await call<ChessView>(host, "chess:clearResume", { profileId });
    expect(cleared.resume).toBeNull();
  });

  it("answers a search the pack cannot play with `no-pack`, without starting anything", async () => {
    const { host } = harness();
    const game = "1";
    await expect(
      call(host, "chess:engineMove", {
        game,
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        moves: ["e2e4"],
        level: 8,
      }),
    ).resolves.toEqual({ outcome: "refused", code: "no-pack" });
    // A close for a game whose engine never started is an ordinary answer: the
    // page closes the game it just left, whether or not one was opened.
    await expect(call(host, "chess:engineClose", { game })).resolves.toEqual({ closed: false });
  });

  it("refuses a search payload the engine would have been handed as text", async () => {
    const { host } = harness();
    const base = {
      game: "1",
      fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      moves: [] as string[],
      level: 8,
    };
    // The FEN and the moves travel into a LINE protocol, so the wire is where
    // they stop being free text: a value carrying a newline would be a second
    // command, and a level outside the ladder is a level no engine has.
    await expect(call(host, "chess:engineMove", { ...base, fen: "startpos\ngo infinite" })).rejects.toThrow(
      /"fen" is not a position/,
    );
    await expect(call(host, "chess:engineMove", { ...base, fen: "" })).rejects.toThrow(
      /"fen" must be a non-empty string/,
    );
    await expect(call(host, "chess:engineMove", { ...base, moves: ["e2e4\n"] })).rejects.toThrow(
      /is not a move/,
    );
    await expect(call(host, "chess:engineMove", { ...base, level: 9 })).rejects.toThrow(
      /"level" must be a whole number between 6 and 8/,
    );
    // A level the pack does not play is not a level to hand the pack: the module's
    // own engine plays the weak half of the ladder, and a caller that asked the
    // pack for one would be given a far stronger opponent than it named.
    await expect(call(host, "chess:engineMove", { ...base, level: 5 })).rejects.toThrow(
      /"level" must be a whole number between 6 and 8/,
    );
    await expect(call(host, "chess:engineMove", { ...base, game: " 1 " })).rejects.toThrow(
      /"game" is not a well-formed id/,
    );
    await expect(call(host, "chess:engineClose", { game: "" })).rejects.toThrow(/"game"/);
  });
});

describe("the wire's refusals", () => {
  it("refuses a payload that is not an object, on every channel it answers", async () => {
    const { host } = harness();
    for (const channel of host.channels()) {
      await expect(call(host, channel, null)).rejects.toThrow(/expected an object/);
      await expect(call(host, channel, "nope")).rejects.toThrow(/expected an object/);
    }
  });

  it("refuses a profile id or a row id that is not one, by name", async () => {
    const { host } = harness();
    const profileId = createProfile();

    await expect(call(host, "chess:list", { profileId: "" })).rejects.toThrow(
      /"profileId" must be a non-empty string/,
    );
    await expect(call(host, "chess:list", { profileId: " padded " })).rejects.toThrow(
      /"profileId" is not a well-formed id/,
    );
    await expect(call(host, "chess:getGame", { profileId, id: "" })).rejects.toThrow(/"id"/);
    await expect(call(host, "chess:deleteGame", { profileId, id: " x " })).rejects.toThrow(
      /"id" is not a well-formed id/,
    );
    await expect(call(host, "chess:clearResume", {})).rejects.toThrow(/"profileId"/);
  });

  it("refuses every field of a saved game the store could not hold", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ pgn: "" }, /"pgn" must be a non-empty string/],
      [{ pgn: "ovo nije partija" }, /"pgn" is not a game this build can read/],
      [{ result: "1-0" }, /"result" must be one of/],
      [{ playedColor: "white" }, /"playedColor" must be one of/],
      [{ opponent: "computer" }, /"opponent" must be one of/],
      [{ level: 9 }, /"level" must be a whole number between 1 and 8/],
      [{ level: 2.5 }, /"level" must be an integer/],
      [{ timeControl: 5 }, /"timeControl" must be a string/],
      [{ timeControl: "600-5" }, /"timeControl" must be a "base\+increment" clock/],
      [{ playedAt: "" }, /"playedAt" must be a non-empty string/],
      [{ playedAt: "juče" }, /"playedAt" must be an ISO-8601 date-time/],
      // A game against a person carries no level, which is migration 082's pair
      // CHECK and is refused by the store's own resolver.
      [{ opponent: "human", level: 2 }, /"level" belongs to an engine game/],
      [{ level: null }, /"level" must be a whole number/],
    ];
    for (const [overrides, expected] of cases) {
      await expect(saveGame(host, profileId, overrides), JSON.stringify(overrides)).rejects.toThrow(
        expected,
      );
    }
  });

  it("refuses a resume the store cannot replay, before it is written", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const startFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const payload = (overrides: Record<string, unknown>) => ({
      profileId,
      startFen,
      fen: FOOLS_MATE_FEN,
      moves: ["f2f3", "e7e6", "g2g4", "d8h4"],
      playedColor: "w",
      opponent: "human",
      level: null,
      timeControl: null,
      ...overrides,
    });

    await expect(call(host, "chess:setResume", payload({ moves: "f2f3" }))).rejects.toThrow(
      /"moves" must be an array/,
    );
    // A list of well-formed moves that cannot be played is the STORE's refusal:
    // the replay is the only thing that can say so.
    await expect(
      call(host, "chess:setResume", payload({ moves: ["e2e5"], fen: FOOLS_MATE_FEN })),
    ).rejects.toThrow(/"moves" is not a legal continuation of "startFen"/);
    await expect(call(host, "chess:setResume", payload({ fen: startFen }))).rejects.toThrow(
      /"fen" is not the position "moves" produces/,
    );
    await expect(call(host, "chess:setResume", payload({ startFen: "nije pozicija" }))).rejects.toThrow(
      /"startFen" is not a position/,
    );
    // Beyond the store's own ceiling, refused at the wire rather than by a row.
    const tooMany = Array.from({ length: 601 }, () => "e2e4");
    await expect(call(host, "chess:setResume", payload({ moves: tooMany }))).rejects.toThrow(
      /"moves" must hold at most 600 moves/,
    );
  });
});

describe("the chess archive section", () => {
  it("round-trips the games, the ladder record and the game in progress", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await saveGame(host, profileId);
    await call(host, "chess:setResume", {
      profileId,
      startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      fen: FOOLS_MATE_FEN,
      moves: ["f2f3", "e7e6", "g2g4", "d8h4"],
      playedColor: "w",
      opponent: "engine",
      level: 3,
      timeControl: "600+5",
    });

    const [section] = host.collectExports([profileId]);
    expect(section?.moduleId).toBe("chess");

    // A restore REPLACES a profile whole, and it is read back into the profile it
    // came from: a game's id is unique across the whole database rather than per
    // profile (migration 082's primary key), so a row restored under somebody
    // else's name is exactly what the store refuses. Emptying first is what a
    // restore does, and it is what makes the ids free again.
    host.applyImports([], [profileId]);
    const emptied = await call<ChessView>(host, "chess:list", { profileId });
    expect(emptied.games).toEqual([]);
    expect(emptied.resume).toBeNull();

    host.applyImports([section!], [profileId]);
    const restored = await call<ChessView>(host, "chess:list", { profileId });
    expect(restored.games).toHaveLength(1);
    expect(restored.games[0]).toMatchObject({ result: "black", level: 3 });
    expect(restored.stats[2]).toMatchObject({ level: 3, played: 1, won: 1 });
    expect(restored.resume?.moves).toEqual(["f2f3", "e7e6", "g2g4", "d8h4"]);

    // The PGN travels too, which is the half a row of numbers would lose.
    const id = restored.games[0]?.id ?? "";
    const detail = await call<{ pgn: string } | null>(host, "chess:getGame", {
      profileId,
      id,
    });
    expect(detail?.pgn).toBe(FOOLS_MATE_PGN);
  });

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await saveGame(host, profileId, { result: "draw" });

    const payloads: unknown[] = [
      // A version this build does not read.
      { version: 99, games: [], resume: null, levelStats: [] },
      // A game whose PGN is not a game.
      {
        version: 1,
        games: [
          {
            id: "game-1",
            pgn: "ovo nije partija",
            result: "white",
            playedAt: NOW,
            playedColor: "w",
            opponent: "human",
            level: null,
            timeControl: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        resume: null,
        levelStats: [],
      },
      // A ladder row whose four numbers do not add up.
      {
        version: 1,
        games: [],
        resume: null,
        levelStats: [
          { level: 3, played: 1, won: 0, drawn: 0, lost: 0, updatedAt: NOW },
        ],
      },
    ];
    for (const payload of payloads) {
      expect(() =>
        host.applyImports([{ moduleId: "chess", payload }], [profileId]),
      ).toThrow();
      const after = await call<ChessView>(host, "chess:list", { profileId });
      expect(after.games).toHaveLength(1);
      expect(after.games[0]?.result).toBe("draw");
    }
  });

  it("empties the archived state when the archive names no chess entry", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await saveGame(host, profileId);
    await call(host, "chess:setResume", {
      profileId,
      startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      fen: FOOLS_MATE_FEN,
      moves: ["f2f3", "e7e6", "g2g4", "d8h4"],
      playedColor: "w",
      opponent: "human",
      level: null,
      timeControl: null,
    });

    // A restore replaces a profile whole, so an archive with no chess section is
    // a profile that holds no chess — not one that keeps what it had.
    host.applyImports([], [profileId]);

    const after = await call<ChessView>(host, "chess:list", { profileId });
    expect(after.games).toEqual([]);
    expect(after.resume).toBeNull();
    expect(after.stats.every((entry) => entry.played === 0)).toBe(true);
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const { host } = harness();
    expect(host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});
