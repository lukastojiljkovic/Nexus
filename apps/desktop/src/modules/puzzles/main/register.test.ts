import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBrojPuzzle,
  createMahjongGame,
  mahjongLegalPairs,
  mahjongRemove,
} from "@nexus/core";
import { PUZZLE_VARIANTS, openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import type {
  BrojStateView,
  MahjongStateView,
  NonogramStateView,
  PuzzlesView,
  SudokuStateView,
} from "../shared/ipc.js";
import { register } from "./register.js";

/**
 * The PUZZLES module through the kit (ADR-090): its ops, the four boards it
 * saves and resumes, its record, and its archive section.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals, the sender check and the channel allowlist are all the host's. Going
 * through `dispatch` therefore tests what actually runs in the app.
 *
 * The fixtures are the engines' own: the sudoku is AI Escargot (the grid
 * `sudoku.test.ts` cites from `sudokuwiki.org/Escargot`), the mahjong board is a
 * deal `createMahjongGame` made, and the Broj pool is `createBrojPuzzle`'s draw
 * for a named seed — so „the state came back" is a statement about values that
 * have a source, not about anything this file invented.
 */

const TRUSTED = { trusted: true };
const NOW = Date.parse("2026-06-01T08:00:00.000Z");
const LATER = Date.parse("2026-06-01T09:00:00.000Z");

const ESCARGOT =
  "100007090030020008009600500005300900010080002600004000300000010040000007007000300";
const ESCARGOT_SOLUTION =
  "162857493534129678789643521475312986913586742628794135356478219241935867897261354";

const SUDOKU_SEED = 7;
const MAHJONG_SEED = 11;
const BROJ_SEED = 42;

let dir: string;
let db: NexusDatabase;
let clock = NOW;

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

function sudokuState(): SudokuStateView {
  const givens = [...ESCARGOT].map(Number);
  const solution = [...ESCARGOT_SOLUTION].map(Number);
  return {
    givens,
    // One hole filled, so the saved board is a board mid-game rather than the
    // puzzle as it was dealt.
    entries: givens.map((given, index) => (given === 0 && index === 1 ? (solution[index] ?? null) : null)),
    notes: Array.from({ length: 81 }, (_, index) => (index === 2 ? [4, 6] : [])),
    hintsUsed: 0,
  };
}

function nonogramState(): NonogramStateView {
  // A five-by-five board with one cell filled and one crossed. The store checks
  // this state's shape; the picture itself is the worker's to regenerate.
  const marks = new Array<number>(25).fill(0);
  marks[6] = 1;
  marks[7] = 2;
  return { width: 5, height: 5, marks };
}

function mahjongState(): MahjongStateView {
  const game = createMahjongGame(MAHJONG_SEED);
  // One real move off the engine's own deal: a mid-game board is one with a
  // matching pair taken, and a pair that did not match would leave a group with
  // an odd count — which is exactly what the store refuses.
  const [a, b] = mahjongLegalPairs(game)[0] as readonly [number, number];
  const after = mahjongRemove(game, a, b);
  if (after === null) throw new Error("the engine refused its own legal pair");
  return { faces: [...after.faces], remaining: [...after.remaining], shuffles: 0 };
}

function brojState(): BrojStateView {
  const puzzle = createBrojPuzzle(BROJ_SEED);
  return {
    numbers: [...puzzle.numbers],
    target: puzzle.target,
    expression: { kind: "number", value: puzzle.numbers[0] as number },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-puzzles-module-"));
  db = openDatabase({ path: join(dir, "puzzles.db") });
  clock = NOW;
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the puzzles handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = harness();
    expect(host.channels()).toEqual([
      "puzzles:list",
      "puzzles:save",
      "puzzles:clearSave",
      "puzzles:finish",
      "puzzles:setCheckWhileTyping",
    ]);
  });

  it("answers a read with the three sections, empty for a profile that has played nothing", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const view = await call<PuzzlesView>(host, "puzzles:list", { profileId });
    expect(view.saves).toEqual([]);
    expect(view.stats).toEqual([]);
    // The shipped default: conflicts are marked only when asked for.
    expect(view.settings).toEqual({ checkWhileTyping: false });
    // And the vocabulary the page draws its grade chips from is the STORE's own,
    // read here rather than restated, so the two cannot drift.
    expect(view.variants).toEqual(PUZZLE_VARIANTS);
  });

  it("refuses a payload the wire should never carry, before the store sees it", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const base = {
      profileId,
      puzzle: "sudoku",
      variant: "easy",
      seed: SUDOKU_SEED,
      state: sudokuState(),
      elapsedSeconds: 30,
    };

    await expect(call(host, "puzzles:save", { ...base, puzzle: "poker" })).rejects.toThrow(
      /"puzzle" must be one of/,
    );
    await expect(call(host, "puzzles:save", { ...base, variant: "impossible" })).rejects.toThrow(
      /"variant" for sudoku/,
    );
    await expect(call(host, "puzzles:save", { ...base, seed: 2 ** 31 })).rejects.toThrow(
      /between 0 and 2147483647/,
    );
    await expect(call(host, "puzzles:save", { ...base, elapsedSeconds: 90_000 })).rejects.toThrow(
      /between 0 and 86400/,
    );
    await expect(call(host, "puzzles:save", { ...base, elapsedSeconds: 1.5 })).rejects.toThrow(
      /must be an integer/,
    );
    await expect(call(host, "puzzles:save", { ...base, state: "not a state" })).rejects.toThrow(
      /expected an object/,
    );
    // A field that is not an id at all is refused as an id, not passed on.
    await expect(call(host, "puzzles:list", { profileId: "  padded  " })).rejects.toThrow(
      /not a well-formed id/,
    );
    // And a distance belongs to Broj.
    await expect(
      call(host, "puzzles:finish", {
        profileId,
        puzzle: "sudoku",
        variant: "easy",
        solved: true,
        elapsedSeconds: 10,
        distance: 1,
      }),
    ).rejects.toThrow(/"distance" belongs to Broj/);
    // Nothing landed.
    const view = await call<PuzzlesView>(host, "puzzles:list", { profileId });
    expect(view.saves).toEqual([]);
    expect(view.stats).toEqual([]);
  });
});

describe("a game saved and resumed, puzzle by puzzle", () => {
  /**
   * The four boards, each with the grade the store accepts for it: the sudoku at
   * an easy grade, a five-by-five nonogram, the turtle, and Broj's six numbers.
   */
  const boards = [
    { puzzle: "sudoku", variant: "easy", seed: SUDOKU_SEED, state: sudokuState },
    { puzzle: "nonogram", variant: "5x5", seed: 3, state: nonogramState },
    { puzzle: "mahjong", variant: "turtle", seed: MAHJONG_SEED, state: mahjongState },
    { puzzle: "broj", variant: "six", seed: BROJ_SEED, state: brojState },
  ] as const;

  for (const board of boards) {
    it(`round-trips a ${board.puzzle} through save and read`, async () => {
      const { host } = harness();
      const profileId = createProfile();
      const state = board.state();

      const saved = await call<PuzzlesView>(host, "puzzles:save", {
        profileId,
        puzzle: board.puzzle,
        variant: board.variant,
        seed: board.seed,
        state,
        elapsedSeconds: 45,
      });
      expect(saved.saves).toHaveLength(1);
      const row = saved.saves[0];
      expect(row?.puzzle).toBe(board.puzzle);
      expect(row?.variant).toBe(board.variant);
      expect(row?.seed).toBe(board.seed);
      expect(row?.elapsedSeconds).toBe(45);
      // The state came back whole, value for value.
      expect(row?.state).toEqual(state);

      // A fresh read answers the same thing, which is what „resumes exactly"
      // means: the page is not holding it, the profile is.
      clock = LATER;
      const again = await call<PuzzlesView>(host, "puzzles:list", { profileId });
      expect(again.saves[0]?.state).toEqual(state);

      // Starting over drops the game and leaves the record alone.
      const cleared = await call<PuzzlesView>(host, "puzzles:clearSave", {
        profileId,
        puzzle: board.puzzle,
        variant: board.variant,
      });
      expect(cleared.saves).toEqual([]);
      expect(cleared.stats).toEqual([]);
    });

    it(`folds a finished ${board.puzzle} into the record and drops its save`, async () => {
      const { host } = harness();
      const profileId = createProfile();
      await call(host, "puzzles:save", {
        profileId,
        puzzle: board.puzzle,
        variant: board.variant,
        seed: board.seed,
        state: board.state(),
        elapsedSeconds: 45,
      });

      const finished = await call<PuzzlesView>(host, "puzzles:finish", {
        profileId,
        puzzle: board.puzzle,
        variant: board.variant,
        solved: true,
        elapsedSeconds: 120,
        ...(board.puzzle === "broj" ? { distance: 0 } : {}),
      });
      // Played one, solved one, best 120 seconds — and only Broj carries a
      // distance.
      expect(finished.stats).toEqual([
        {
          puzzle: board.puzzle,
          variant: board.variant,
          played: 1,
          solved: 1,
          bestTimeSeconds: 120,
          bestDistance: board.puzzle === "broj" ? 0 : null,
          updatedAt: new Date(NOW).toISOString(),
        },
      ]);
      expect(finished.saves).toEqual([]);
    });
  }

  it("stores the module's one preference and answers it on every later read", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const view = await call<PuzzlesView>(host, "puzzles:setCheckWhileTyping", {
      profileId,
      checkWhileTyping: true,
    });
    expect(view.settings).toEqual({ checkWhileTyping: true });
    expect(
      (await call<PuzzlesView>(host, "puzzles:list", { profileId })).settings,
    ).toEqual({ checkWhileTyping: true });
    // And a non-boolean is refused by the wire rather than coerced.
    await expect(
      call(host, "puzzles:setCheckWhileTyping", { profileId, checkWhileTyping: "yes" }),
    ).rejects.toThrow(/must be a boolean/);
  });
});

describe("the puzzles archive section", () => {
  it("round-trips the games, the record and the preference between two profiles", async () => {
    const { host } = harness();
    const source = createProfile();
    const target = createProfile();
    await call(host, "puzzles:save", {
      profileId: source,
      puzzle: "nonogram",
      variant: "5x5",
      seed: 3,
      state: nonogramState(),
      elapsedSeconds: 45,
    });
    await call(host, "puzzles:finish", {
      profileId: source,
      puzzle: "sudoku",
      variant: "medium",
      solved: false,
      elapsedSeconds: 300,
    });
    await call(host, "puzzles:setCheckWhileTyping", { profileId: source, checkWhileTyping: true });

    const [section] = host.collectExports([source]);
    expect(section?.moduleId).toBe("puzzles");
    host.applyImports([section!], [target]);

    const restored = await call<PuzzlesView>(host, "puzzles:list", { profileId: target });
    expect(restored.saves).toHaveLength(1);
    expect(restored.saves[0]?.state).toEqual(nonogramState());
    expect(restored.saves[0]?.elapsedSeconds).toBe(45);
    expect(restored.stats).toEqual([
      {
        puzzle: "sudoku",
        variant: "medium",
        played: 1,
        solved: 0,
        bestTimeSeconds: null,
        bestDistance: null,
        updatedAt: new Date(NOW).toISOString(),
      },
    ]);
    expect(restored.settings).toEqual({ checkWhileTyping: true });
  });

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await call(host, "puzzles:save", {
      profileId,
      puzzle: "nonogram",
      variant: "5x5",
      seed: 3,
      state: nonogramState(),
      elapsedSeconds: 45,
    });
    const before = await call<PuzzlesView>(host, "puzzles:list", { profileId });

    // Four shapes a later build (or a hand-edited archive) could produce: a
    // version this module does not know, rows that are not arrays, a save whose
    // board is not a sudoku, and a preference that is not a boolean.
    for (const payload of [
      { version: 99, saves: [], stats: [], settings: null },
      { version: 1, saves: {}, stats: [], settings: null },
      {
        version: 1,
        saves: [
          {
            puzzle: "nonogram",
            variant: "5x5",
            seed: 3,
            state: { width: 5, height: 5, marks: [1, 2] },
            elapsedSeconds: 1,
            createdAt: new Date(NOW).toISOString(),
            updatedAt: new Date(NOW).toISOString(),
          },
        ],
        stats: [],
        settings: null,
      },
      { version: 1, saves: [], stats: [], settings: { checkWhileTyping: "yes" } },
    ]) {
      expect(() => host.applyImports([{ moduleId: "puzzles", payload }], [profileId])).toThrow();
      const after = await call<PuzzlesView>(host, "puzzles:list", { profileId });
      expect(after).toEqual(before);
    }
  });

  it("empties the archived state when the section names no Puzzles entry", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await call(host, "puzzles:save", {
      profileId,
      puzzle: "broj",
      variant: "six",
      seed: BROJ_SEED,
      state: brojState(),
      elapsedSeconds: 12,
    });
    await call(host, "puzzles:setCheckWhileTyping", { profileId, checkWhileTyping: true });
    // What the module answers for a profile with no preferences row: the value an
    // emptied profile has to show, read from the store rather than restated here.
    const rowless = await call<PuzzlesView>(host, "puzzles:list", {
      profileId: createProfile(),
    });

    // An archive with no Puzzles entry is what a restore of an older archive
    // hands over, and a restore replaces the profile whole.
    host.applyImports([], [profileId]);

    const after = await call<PuzzlesView>(host, "puzzles:list", { profileId });
    expect(after.saves).toEqual([]);
    expect(after.stats).toEqual([]);
    expect(after.settings).toEqual(rowless.settings);
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const { host } = harness();
    expect(host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});
