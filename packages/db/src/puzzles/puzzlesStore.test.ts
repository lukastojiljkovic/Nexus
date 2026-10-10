import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrojPuzzle, createMahjongGame, generateSudoku, TURTLE_SLOTS } from "@nexus/core";
import {
  MAX_PUZZLE_ELAPSED_SECONDS,
  PUZZLE_IDS,
  PuzzlesStore,
  PuzzlesValidationError,
  openDatabase,
  uuidv7,
  type NexusDatabase,
} from "../index.js";

/**
 * The PUZZLES store (migration 090).
 *
 * **Every expected value here comes from the engine or from arithmetic in the
 * comment beside it**, never from „it returned something". The sudoku fixture is
 * `generateSudoku`'s own board for a named seed, the Broj draw is
 * `createBrojPuzzle`'s for a named seed, the mahjong board is
 * `createMahjongGame`'s, and the two counters are folded by hand so the upsert's
 * arithmetic is checked rather than its length.
 */

const SUDOKU_SEED = 7;
const BROJ_SEED = 42;
const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-01T08:10:00.000Z";

let dir: string;
let db: NexusDatabase;
let store: PuzzlesStore;
let profileId: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-puzzles-store-"));
  db = openDatabase({ path: join(dir, "puzzles.db") });
  profileId = createProfile();
  store = new PuzzlesStore(db.raw, profileId);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

/** A sudoku save whose board is the engine's own for `SUDOKU_SEED`. */
function sudokuSave(): {
  puzzle: "sudoku";
  variant: string;
  seed: number;
  state: unknown;
  elapsedSeconds: number;
} {
  const puzzle = generateSudoku(SUDOKU_SEED, { difficulty: "easy" });
  return {
    puzzle: "sudoku",
    variant: puzzle.difficulty,
    seed: SUDOKU_SEED,
    elapsedSeconds: 90,
    state: {
      givens: [...puzzle.cells],
      entries: new Array<number | null>(81).fill(null),
      notes: Array.from({ length: 81 }, () => [] as number[]),
      hintsUsed: 0,
    },
  };
}

function brojSave(): {
  puzzle: "broj";
  variant: string;
  seed: number;
  state: unknown;
  elapsedSeconds: number;
} {
  const puzzle = createBrojPuzzle(BROJ_SEED);
  return {
    puzzle: "broj",
    variant: "six",
    seed: BROJ_SEED,
    elapsedSeconds: 12,
    state: { numbers: [...puzzle.numbers], target: puzzle.target, expression: null },
  };
}

describe("the puzzles store", () => {
  it("round-trips a sudoku save and reads it back through the engine's own board", () => {
    const saved = store.saveProgress(sudokuSave(), NOW);
    expect(saved.puzzle).toBe("sudoku");
    expect(saved.seed).toBe(SUDOKU_SEED);
    expect(saved.createdAt).toBe(NOW);
    expect(saved.elapsedSeconds).toBe(90);

    const [read] = store.listSaves();
    // The board that comes back is the board that went in, cell for cell: 81
    // givens, no entries, no notes.
    const state = read?.state as { givens: number[]; entries: (number | null)[] };
    expect(state.givens).toEqual(generateSudoku(SUDOKU_SEED, { difficulty: "easy" }).cells);
    expect(state.entries.every((entry) => entry === null)).toBe(true);
    // A second write replaces the first rather than adding a game.
    store.saveProgress({ ...sudokuSave(), elapsedSeconds: 120 }, LATER);
    expect(store.listSaves()).toHaveLength(1);
    expect(store.listSaves()[0]?.elapsedSeconds).toBe(120);
    expect(store.listSaves()[0]?.updatedAt).toBe(LATER);
  });

  it("refuses a state the engine cannot be a part of, before anything is written", () => {
    const base = sudokuSave();
    const state = base.state as { givens: number[]; entries: unknown[]; notes: unknown[] };

    // A board with no completion at all: two 1s in the first row. The engine's
    // own counter answers zero completions, so this is not „a puzzle".
    const broken = [...state.givens];
    broken[1] = 1;
    expect(() =>
      store.saveProgress({ ...base, state: { ...state, givens: broken } }, NOW),
    ).toThrow(PuzzlesValidationError);

    // An entry on a cell the puzzle fills itself, and a note beside a digit.
    const given = state.givens.findIndex((cell) => cell !== 0);
    const entries = new Array<number | null>(81).fill(null);
    entries[given] = 5;
    expect(() =>
      store.saveProgress({ ...base, state: { ...state, entries } }, NOW),
    ).toThrow(/stands on a cell the puzzle fills itself/);

    // A grade the puzzle does not have, and a seed outside the 32-bit range.
    expect(() => store.saveProgress({ ...base, variant: "impossible" }, NOW)).toThrow(
      /"variant" for sudoku/,
    );
    expect(() => store.saveProgress({ ...base, seed: 2 ** 31 }, NOW)).toThrow(/"seed"/);
    // Nothing reached the table.
    expect(store.listSaves()).toEqual([]);
  });

  it("holds a Broj round to the draw its seed deals and to an expression the six numbers can make", () => {
    const base = brojSave();
    const state = base.state as { numbers: number[]; target: number };
    const puzzle = createBrojPuzzle(BROJ_SEED);

    expect(store.saveProgress(base, NOW).puzzle).toBe("broj");

    // A draw that is not the seed's is a row about a different game. The three
    // numbers below are the fixture's own, so the refusal names the mismatch
    // rather than a range.
    const wrongTarget = { ...state, target: puzzle.target + 1 };
    expect(() =>
      store.saveProgress({ ...base, state: wrongTarget }, NOW),
    ).toThrow(/are not the draw seed 42 deals/);

    // An expression using a number that is not in the pool: `99 + 1` where the
    // pool holds neither. `checkBrojExpression` refuses it as `unknown-number`.
    const expression = {
      kind: "operation",
      operation: "+",
      left: { kind: "number", value: 99 },
      right: { kind: "number", value: 1 },
    };
    expect(() =>
      store.saveProgress({ ...base, state: { ...state, expression } }, NOW),
    ).toThrow(/unknown-number/);
  });

  it("holds a mahjong board to the layout's tile count and to tiles that still pair up", () => {
    const game = createMahjongGame(11);
    const state = {
      faces: [...game.faces],
      remaining: [...game.remaining],
      shuffles: 0,
    };
    const save = {
      puzzle: "mahjong" as const,
      variant: "turtle",
      seed: 11,
      state,
      elapsedSeconds: 30,
    };
    expect(store.saveProgress(save, NOW).state).toEqual(state);
    expect(TURTLE_SLOTS).toHaveLength(144);

    // One tile lifted out of a pair leaves an odd count in its group, which no
    // arrangement of the faces can clear — the invariant `mahjongShuffle`
    // asserts before it re-deals.
    const remaining = [...game.remaining];
    remaining[0] = false;
    expect(() =>
      store.saveProgress({ ...save, state: { ...state, remaining } }, NOW),
    ).toThrow(/odd number of/);

    // And a board of the wrong length is not this layout at all.
    expect(() =>
      store.saveProgress({ ...save, state: { ...state, faces: [game.faces[0] as string] } }, NOW),
    ).toThrow(/must hold 144 tiles/);

    // A face the traditional set does not hold is not a tile, so a board that
    // carries one is refused rather than drawn.
    const faces = [...game.faces];
    faces[0] = "not-a-tile";
    expect(() =>
      store.saveProgress({ ...save, state: { ...state, faces } }, NOW),
    ).toThrow(/is not a mahjong tile/);
  });

  it("folds finished games into the record by hand, and drops the save with them", () => {
    store.saveProgress(sudokuSave(), NOW);
    // Game one: solved in 90 seconds. played 1, solved 1, best 90.
    const first = store.finish(
      { puzzle: "sudoku", variant: "easy", solved: true, elapsedSeconds: 90 },
      NOW,
    );
    expect(first).toEqual({
      puzzle: "sudoku",
      variant: "easy",
      played: 1,
      solved: 1,
      bestTimeSeconds: 90,
      bestDistance: null,
      updatedAt: NOW,
    });
    // The game it concluded is no longer offered to resume.
    expect(store.listSaves()).toEqual([]);

    // Game two: abandoned after 300 seconds. played 2, solved 1, best still 90
    // (a loss has no time to record), and the row's timestamp moved.
    const second = store.finish(
      { puzzle: "sudoku", variant: "easy", solved: false, elapsedSeconds: 300 },
      LATER,
    );
    expect(second.played).toBe(2);
    expect(second.solved).toBe(1);
    expect(second.bestTimeSeconds).toBe(90);
    expect(second.updatedAt).toBe(LATER);

    // Game three: solved in 45, which is the new best.
    const third = store.finish(
      { puzzle: "sudoku", variant: "easy", solved: true, elapsedSeconds: 45 },
      LATER,
    );
    expect(third).toEqual({
      puzzle: "sudoku",
      variant: "easy",
      played: 3,
      solved: 2,
      bestTimeSeconds: 45,
      bestDistance: null,
      updatedAt: LATER,
    });
  });

  it("keeps Broj's distance and refuses one on any other puzzle", () => {
    const miss = store.finish(
      { puzzle: "broj", variant: "six", solved: false, elapsedSeconds: 60, distance: 7 },
      NOW,
    );
    expect(miss.bestDistance).toBe(7);
    // A closer miss replaces it; a farther one does not.
    expect(
      store.finish(
        { puzzle: "broj", variant: "six", solved: false, elapsedSeconds: 30, distance: 3 },
        LATER,
      ).bestDistance,
    ).toBe(3);
    expect(
      store.finish(
        { puzzle: "broj", variant: "six", solved: false, elapsedSeconds: 30, distance: 9 },
        LATER,
      ).bestDistance,
    ).toBe(3);
    expect(() =>
      store.finish(
        { puzzle: "nonogram", variant: "5x5", solved: false, elapsedSeconds: 10, distance: 1 },
        LATER,
      ),
    ).toThrow(/"distance" belongs to Broj/);
  });

  it("records no best time for a solve the clock could not measure", () => {
    // A solve in under a second is the clock's resolution, not a time anybody
    // spent; `best_time_seconds`' CHECK refuses anything below one second.
    const row = store.finish(
      { puzzle: "nonogram", variant: "5x5", solved: true, elapsedSeconds: 0 },
      NOW,
    );
    expect(row.bestTimeSeconds).toBeNull();
    expect(row.solved).toBe(1);
  });

  it("clears a save without complaint and stores the module's one preference", () => {
    store.saveProgress(brojSave(), NOW);
    store.clearSave("broj", "six");
    expect(store.listSaves()).toEqual([]);
    // Clearing what is not there is not an error: a new game is the same act.
    expect(() => store.clearSave("broj", "six")).not.toThrow();
    expect(() => store.clearSave("sudoku", "hard")).not.toThrow();

    // The shipped default is off, and a stored value is what it is.
    expect(store.settings()).toEqual({ checkWhileTyping: false });
    expect(store.setCheckWhileTyping(true, NOW)).toEqual({ checkWhileTyping: true });
    expect(store.settings()).toEqual({ checkWhileTyping: true });
  });

  it("refuses a row that is not this profile's, and an elapsed time past a day", () => {
    const other = createProfile();
    const theirs = new PuzzlesStore(db.raw, other);
    theirs.saveProgress(sudokuSave(), NOW);
    expect(store.listSaves()).toEqual([]);
    expect(theirs.listSaves()).toHaveLength(1);

    expect(() =>
      store.saveProgress({ ...sudokuSave(), elapsedSeconds: MAX_PUZZLE_ELAPSED_SECONDS + 1 }, NOW),
    ).toThrow(/elapsedSeconds/);
    expect(() => store.finish(
      { puzzle: "broj", variant: "six", solved: true, elapsedSeconds: 1.5 },
      NOW,
    )).toThrow(/whole number/);
    expect(() => store.finish(
      { puzzle: "broj", variant: "six", solved: true, elapsedSeconds: 1 },
      "yesterday",
    )).toThrow(/is not an instant/);
  });

  it("names every puzzle the schema does, so the two lists cannot drift", () => {
    // The migration's CHECK lists four words; this is the four the store
    // accepts, and a fifth would be a puzzle the column refuses.
    expect([...PUZZLE_IDS]).toEqual(["sudoku", "nonogram", "mahjong", "broj"]);
    const check = (
      db.raw
        .prepare("SELECT sql FROM sqlite_master WHERE name = 'puzzles_saves'")
        .get() as { sql: string }
    ).sql;
    for (const id of PUZZLE_IDS) expect(check).toContain(`'${id}'`);
  });

  it("reads nothing for a profile that holds nothing, and refuses a save it cannot read back", () => {
    const empty = new PuzzlesStore(db.raw, createProfile());
    expect(empty.listSaves()).toEqual([]);
    expect(empty.listStats()).toEqual([]);
    // A row read through a state this build cannot parse is loud rather than
    // silently empty: corruption is what a hand-edited file leaves behind.
    db.raw
      .prepare(
        `INSERT INTO puzzles_saves
           (profile_id, puzzle, variant, seed, state_json, elapsed_seconds, created_at, updated_at)
         VALUES (?, 'sudoku', 'easy', 1, '{"givens":[]}', 5, ?, ?)`,
      )
      .run(profileId, NOW, NOW);
    expect(() => store.listSaves()).toThrow(/must hold 81 cells/);
    db.raw.prepare("DELETE FROM puzzles_saves WHERE profile_id = ?").run(profileId);
  });
});

describe("the puzzles export and import", () => {
  it("round-trips the saves, the record and the preference into another profile", () => {
    store.saveProgress(sudokuSave(), NOW);
    store.finish({ puzzle: "broj", variant: "six", solved: true, elapsedSeconds: 55 }, NOW);
    store.setCheckWhileTyping(true, NOW);

    const exported = store.exportData();
    expect(exported.saves).toHaveLength(1);
    expect(exported.stats).toEqual([
      {
        puzzle: "broj",
        variant: "six",
        played: 1,
        solved: 1,
        bestTimeSeconds: 55,
        bestDistance: null,
        updatedAt: NOW,
      },
    ]);
    expect(exported.settings).toEqual({ checkWhileTyping: true });

    const target = new PuzzlesStore(db.raw, createProfile());
    target.replaceFromArchive(exported, LATER);
    expect(target.exportData()).toEqual(exported);
  });

  it("empties the archived state when the section names no preference", () => {
    store.saveProgress(sudokuSave(), NOW);
    store.setCheckWhileTyping(true, NOW);
    store.replaceFromArchive({ saves: [], stats: [], settings: null }, LATER);
    expect(store.listSaves()).toEqual([]);
    expect(store.listStats()).toEqual([]);
    // `null` is an archive that carried no preference: the row goes, and the
    // profile answers the store's own default rather than a boolean restated
    // here.
    expect(store.settings()).toEqual({ checkWhileTyping: false });
    const row = db.raw
      .prepare("SELECT count(*) AS n FROM puzzles_settings")
      .get() as { n: number };
    expect(row.n).toBe(0);
  });

  it("refuses a whole archive rather than half-writing one", () => {
    store.saveProgress(sudokuSave(), NOW);
    const before = store.exportData();
    for (const bad of [
      { saves: [sudokuSave()], stats: [], settings: "yes" },
      {
        saves: [sudokuSave(), sudokuSave()],
        stats: [],
        settings: { checkWhileTyping: false },
      },
      {
        saves: [
          {
            ...sudokuSave(),
            state: { givens: [1], entries: [], notes: [], hintsUsed: 0 },
          },
        ],
        stats: [],
        settings: { checkWhileTyping: false },
      },
    ]) {
      expect(() => store.replaceFromArchive(bad as never, LATER)).toThrow(PuzzlesValidationError);
      expect(store.exportData()).toEqual(before);
    }
  });
});
