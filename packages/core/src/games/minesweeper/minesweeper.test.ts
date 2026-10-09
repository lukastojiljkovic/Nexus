import { describe, expect, it } from "vitest";
import { createSeededRandom } from "../random.js";
import {
  MINESWEEPER_PRESETS,
  MINESWEEPER_PRESET_IDS,
  chordCell,
  createMinesweeper,
  cycleMark,
  minesweeperElapsedMs,
  minesweeperFaces,
  minesweeperFromMines,
  minesweeperIndex,
  minesweeperRemainingMines,
  minesweeperVariant,
  revealCell,
  validateMinesweeperConfig,
} from "./minesweeper.js";
import type { MinesweeperConfig, MinesweeperFace, MinesweeperState } from "./minesweeper.js";

const T1 = "2026-06-01T08:00:00.000Z";
const T2 = "2026-06-01T08:00:30.000Z";
const T3 = "2026-06-01T08:01:00.000Z";

/** A layout written the way a person draws one: `[column, row]` pairs, both zero-based. */
function layout(
  columns: number,
  rows: number,
  mines: ReadonlyArray<readonly [number, number]>,
): boolean[] {
  const cells = new Array<boolean>(columns * rows).fill(false);
  for (const [column, row] of mines) cells[row * columns + column] = true;
  return cells;
}

/**
 * One character per face, so an expectation reads as the board the player sees:
 * a dot for a cell nobody has opened, the DIGIT for a number, and `-` for a
 * revealed zero cell. `*` appears only where the game is over, which is the
 * point of the final reveal.
 */
function symbolOf(state: MinesweeperState, index: number, face: MinesweeperFace): string {
  switch (face) {
    case "hidden":
      return ".";
    case "flag":
      return "F";
    case "question":
      return "?";
    case "empty":
      return "-";
    case "number":
      return String(state.adjacent[index]);
    case "mine":
      return "*";
    case "wrong-flag":
      return "X";
  }
}

function faceRows(state: MinesweeperState): string[] {
  const faces = minesweeperFaces(state);
  const rows: string[] = [];
  for (let row = 0; row < state.config.rows; row += 1) {
    let line = "";
    for (let column = 0; column < state.config.columns; column += 1) {
      const index = minesweeperIndex(state.config, column, row);
      line += symbolOf(state, index, faces[index] as MinesweeperFace);
    }
    rows.push(line);
  }
  return rows;
}

function minesOf(state: MinesweeperState): string[] {
  const rows: string[] = [];
  for (let row = 0; row < state.config.rows; row += 1) {
    let line = "";
    for (let column = 0; column < state.config.columns; column += 1) {
      line += state.mines[minesweeperIndex(state.config, column, row)] === true ? "*" : ".";
    }
    rows.push(line);
  }
  return rows;
}

/**
 * The board the flood-fill and chording tests are drawn on: 5 × 5 with a wall of
 * four mines across the middle row, columns 0–3.
 *
 *     -----   row 0: all zero cells, so a click at (0,0) floods the row
 *     #431#   row 2 carries the mines; (4,2) is the one safe cell beside them
 *     -----   row 4: all zero cells, and unreachable from above
 */
function wallBoard(): MinesweeperState {
  return minesweeperFromMines(
    { columns: 5, rows: 5, mines: 4 },
    layout(5, 5, [
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 2],
    ]),
  );
}

/** A 6 × 4 board with three mines in column 2, rows 0–2 — the wall that leaves a chord something to open. */
function columnBoard(options?: { questions?: boolean }): MinesweeperState {
  return minesweeperFromMines(
    { columns: 6, rows: 4, mines: 3 },
    layout(6, 4, [
      [2, 0],
      [2, 1],
      [2, 2],
    ]),
    options ?? {},
  );
}

describe("the presets", () => {
  it("names the three classic boards, and expert is WIDER than it is tall", () => {
    expect(MINESWEEPER_PRESETS).toEqual({
      beginner: { columns: 9, rows: 9, mines: 10 },
      intermediate: { columns: 16, rows: 16, mines: 40 },
      expert: { columns: 30, rows: 16, mines: 99 },
    });
  });

  it("every preset is a config this module accepts", () => {
    for (const id of MINESWEEPER_PRESET_IDS) {
      expect(validateMinesweeperConfig(MINESWEEPER_PRESETS[id])).toEqual({
        ok: true,
        config: MINESWEEPER_PRESETS[id],
      });
    }
  });
});

describe("validateMinesweeperConfig", () => {
  it("accepts a custom board and returns a copy, never the caller's own object", () => {
    const config = { columns: 9, rows: 10, mines: 10 };
    const result = validateMinesweeperConfig(config);

    expect(result).toEqual({ ok: true, config });
    expect(result.ok && result.config).not.toBe(config);
  });

  it("accepts the largest board the module allows, and one mine on it", () => {
    expect(validateMinesweeperConfig({ columns: 30, rows: 24, mines: 1 })).toEqual({
      ok: true,
      config: { columns: 30, rows: 24, mines: 1 },
    });
  });

  it("accepts the exact floor: nine free cells and not one fewer", () => {
    // 5 × 5 = 25 cells; 16 mines leave exactly 9. The first click promises the
    // clicked cell and its eight neighbours are clear, which is those nine.
    expect(validateMinesweeperConfig({ columns: 5, rows: 5, mines: 16 })).toEqual({
      ok: true,
      config: { columns: 5, rows: 5, mines: 16 },
    });
    expect(validateMinesweeperConfig({ columns: 5, rows: 5, mines: 17 })).toEqual({
      ok: false,
      field: "mines",
    });
  });

  it.each([
    ["a value that is not a record", 42, null],
    ["a missing key", { columns: 9, rows: 9 }, null],
    ["an unknown extra key", { columns: 9, rows: 9, mines: 10, theme: "dark" }, null],
    ["a fractional column count", { columns: 9.5, rows: 9, mines: 10 }, "columns"],
    ["a zero column count", { columns: 0, rows: 9, mines: 10 }, "columns"],
    ["a board wider than the module allows", { columns: 31, rows: 9, mines: 10 }, "columns"],
    ["a board taller than the module allows", { columns: 9, rows: 25, mines: 10 }, "rows"],
    ["no mines at all", { columns: 9, rows: 9, mines: 0 }, "mines"],
    ["more mines than cells", { columns: 3, rows: 3, mines: 9 }, "mines"],
    ["nine cells in total, which cannot spare nine free ones", { columns: 1, rows: 9, mines: 1 }, "mines"],
  ])("refuses %s", (_label, value, field) => {
    expect(validateMinesweeperConfig(value)).toEqual({ ok: false, field });
  });
});

describe("minesweeperVariant", () => {
  it("names a preset config after its preset", () => {
    expect(minesweeperVariant(MINESWEEPER_PRESETS.beginner)).toBe("beginner");
    expect(minesweeperVariant(MINESWEEPER_PRESETS.expert)).toBe("expert");
  });

  it("keys a custom board by its own dimensions", () => {
    // A best time over 9 × 10 says nothing about 10 × 9, so the two must not
    // share a column, and neither may borrow the beginner board's.
    expect(minesweeperVariant({ columns: 9, rows: 10, mines: 10 })).toBe("custom:9x10x10");
    expect(minesweeperVariant({ columns: 10, rows: 9, mines: 10 })).toBe("custom:10x9x10");
  });
});

describe("the first click", () => {
  it("leaves the board unmined and the clock unstarted until it happens", () => {
    const state = createMinesweeper(MINESWEEPER_PRESETS.beginner);

    expect(state.status).toBe("ready");
    expect(state.minesPlaced).toBe(false);
    expect(state.mines.some(Boolean)).toBe(false);
    expect(state.startedAt).toBeNull();
    expect(minesweeperElapsedMs(state, T1)).toBeNull();
    expect(faceRows(state).every((row) => /^\.+$/.test(row))).toBe(true);
  });

  it("is safe over 10 000 seeded boards of every preset, and deals exactly the right number of mines", () => {
    for (const id of MINESWEEPER_PRESET_IDS) {
      const config = MINESWEEPER_PRESETS[id];
      for (let seed = 1; seed <= 10_000; seed += 1) {
        // The clicked cell walks the board with the seed, so corners, edges and
        // the interior are all first-clicked a few dozen times each.
        const clicked = seed % (config.columns * config.rows);
        const column = clicked % config.columns;
        const row = Math.floor(clicked / config.columns);

        const opened = revealCell(
          createMinesweeper(config),
          clicked,
          createSeededRandom(seed),
          T1,
        );

        const unsafe: string[] = [];
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const x = column + dx;
            const y = row + dy;
            if (x < 0 || y < 0 || x >= config.columns || y >= config.rows) continue;
            const index = minesweeperIndex(config, x, y);
            if (opened.mines[index] === true) unsafe.push(`${x},${y}`);
          }
        }
        if (unsafe.length > 0 || opened.mines.filter(Boolean).length !== config.mines) {
          throw new Error(
            `${id} seed ${seed} clicked ${column},${row}: mines ${opened.mines
              .filter(Boolean)
              .length}/${config.mines}, unsafe neighbours [${unsafe.join(" ")}]`,
          );
        }
      }
    }
  });

  it("draws the same board for the same seed and click, and a different one for another seed", () => {
    const click = 40;
    const first = revealCell(
      createMinesweeper(MINESWEEPER_PRESETS.beginner),
      click,
      createSeededRandom(7),
      T1,
    );
    const again = revealCell(
      createMinesweeper(MINESWEEPER_PRESETS.beginner),
      click,
      createSeededRandom(7),
      T1,
    );
    const other = revealCell(
      createMinesweeper(MINESWEEPER_PRESETS.beginner),
      click,
      createSeededRandom(8),
      T1,
    );

    expect(minesOf(again)).toEqual(minesOf(first));
    expect(minesOf(other)).not.toEqual(minesOf(first));
  });
});

describe("the flood fill", () => {
  it("opens the zero cell's whole region and stops at the numbers beside the wall", () => {
    // Row-major on a 5 × 5 board: the wall is indexes 10–13, so a click on
    // index 0 opens rows 0 and 1 (ten cells: five zero cells, then the five
    // numbers the flood reveals from them) and nothing below.
    const opened = revealCell(wallBoard(), 0, createSeededRandom(1), T1);

    expect(faceRows(opened)).toEqual(["-----", "23321", ".....", ".....", "....."]);
    expect(opened.status).toBe("playing");
    expect(opened.startedAt).toBe(T1);
    expect(opened.endedAt).toBeNull();
  });

  it("is iterative: a 30 × 24 board with one mine opens 719 cells without touching the stack", () => {
    // The mine sits in the last corner, one cell from the far end of a
    // row-major walk. A recursive fill would stand 719 frames deep here.
    const config: MinesweeperConfig = { columns: 30, rows: 24, mines: 1 };
    const state = minesweeperFromMines(config, layout(30, 24, [[29, 23]]));
    const opened = revealCell(state, 0, createSeededRandom(1), T1);

    expect(opened.cells.filter((cell) => cell.revealed)).toHaveLength(30 * 24 - 1);
    expect(opened.status).toBe("won");
  });
});

describe("marks", () => {
  it("cycles none → flag → none when the question mark is off", () => {
    let state = columnBoard();
    state = cycleMark(state, 20);
    expect(faceRows(state)[3]?.[2]).toBe("F");

    state = cycleMark(state, 20);
    expect(faceRows(state)[3]?.[2]).toBe(".");
  });

  it("cycles none → flag → question → none when the player asked for questions", () => {
    let state = columnBoard({ questions: true });
    state = cycleMark(state, 20);
    expect(faceRows(state)[3]?.[2]).toBe("F");

    state = cycleMark(state, 20);
    expect(faceRows(state)[3]?.[2]).toBe("?");

    state = cycleMark(state, 20);
    expect(faceRows(state)[3]?.[2]).toBe(".");
  });

  it("does not start the clock — a flag made before the first reveal is not a game yet", () => {
    const marked = cycleMark(createMinesweeper(MINESWEEPER_PRESETS.beginner), 0);

    expect(marked.status).toBe("ready");
    expect(marked.startedAt).toBeNull();
  });

  it("counts flags against the mine total, and goes negative when the player over-flags", () => {
    let state = columnBoard();
    expect(minesweeperRemainingMines(state)).toBe(3);

    state = cycleMark(state, 2);
    state = cycleMark(state, 8);
    expect(minesweeperRemainingMines(state)).toBe(1);

    state = cycleMark(state, 20);
    state = cycleMark(state, 21);
    expect(minesweeperRemainingMines(state)).toBe(-1);
  });

  it("refuses a click on a flagged cell and on an open one, handing back the same state", () => {
    const state = revealCell(columnBoard(), 0, createSeededRandom(1), T1);
    const flagged = cycleMark(state, 20);

    expect(revealCell(flagged, 20, createSeededRandom(1), T2)).toBe(flagged);
    expect(revealCell(state, 0, createSeededRandom(1), T2)).toBe(state);
    expect(cycleMark(state, 0)).toBe(state);
    expect(faceRows(state)).toEqual(["-2....", "-3....", "-2....", "-1...."]);
  });
});

describe("the chord", () => {
  /**
   * After a click at (0,0) on the 6 × 4 board, columns 0 and 1 are open and
   * columns 2–5 are not — the mine wall stops the flood at (1,0), (1,1), (1,2)
   * and (1,3), which are numbers and therefore reveal nothing beyond themselves.
   * The three mines are hidden, because the game is still running:
   *
   *     -2....
   *     -3....
   *     -2....
   *     -1....
   *
   * (1,3) shows 1 and has one flagged neighbour, so chording it opens (2,3).
   */
  it("opens the unflagged neighbours of a number whose flags add up", () => {
    let state = revealCell(columnBoard(), 0, createSeededRandom(1), T1);
    state = cycleMark(state, 14);
    state = chordCell(state, 19, T2);

    expect(faceRows(state)).toEqual(["-2....", "-3....", "-2F...", "-11..."]);
    expect(state.status).toBe("playing");
    expect(minesweeperElapsedMs(state, T2)).toBe(30_000);
  });

  it("does nothing at all when the flags do not match the number", () => {
    const state = revealCell(columnBoard(), 0, createSeededRandom(1), T1);

    // (1,1) shows 3 and has no flagged neighbours.
    expect(chordCell(state, 7, T2)).toBe(state);
  });

  it("loses the game when the flags were wrong, and marks the wrong flag", () => {
    let state = revealCell(columnBoard(), 0, createSeededRandom(1), T1);
    // (2,3) is safe and IS one of (1,3)'s neighbours, so flagging it satisfies
    // the chord and sends it into the mine at (2,2).
    state = cycleMark(state, 20);
    state = chordCell(state, 19, T2);

    expect(state.status).toBe("lost");
    expect(state.endedAt).toBe(T2);
    expect(faceRows(state)).toEqual(["-2*...", "-3*...", "-2*...", "-1X..."]);
    expect(minesweeperFaces(state)[20]).toBe("wrong-flag");
    expect(minesweeperFaces(state)[14]).toBe("mine");
  });
});

describe("the end of a game", () => {
  it("wins when the last safe cell opens, and the clock stops at that instant", () => {
    let state = wallBoard();
    state = revealCell(state, 0, createSeededRandom(1), T1);
    expect(state.status).toBe("playing");

    state = revealCell(state, 20, createSeededRandom(1), T2);
    expect(state.status).toBe("playing");
    expect(minesweeperElapsedMs(state, T2)).toBe(30_000);

    state = revealCell(state, 14, createSeededRandom(1), T3);

    // Rows 0 and 4 are zero cells; rows 1 and 3 are the numbers beside the wall;
    // row 2 is four mines, drawn as the flags the solved board implies, and (4,2)
    // is the single safe cell in that row.
    expect(faceRows(state)).toEqual(["-----", "23321", "FFFF1", "23321", "-----"]);
    expect(state.status).toBe("won");
    expect(state.startedAt).toBe(T1);
    expect(state.endedAt).toBe(T3);
    // A minute to the second: 08:01:00 − 08:00:00.
    expect(minesweeperElapsedMs(state, "2026-06-01T09:00:00.000Z")).toBe(60_000);
  });

  it("loses on a mine, and the final board shows every mine and every honest flag", () => {
    let state = revealCell(columnBoard(), 0, createSeededRandom(1), T1);
    state = cycleMark(state, 8);
    state = revealCell(state, 14, createSeededRandom(1), T2);

    expect(faceRows(state)).toEqual(["-2*...", "-3F...", "-2*...", "-1...."]);
    expect(state.status).toBe("lost");
    expect(state.startedAt).toBe(T1);
    expect(state.endedAt).toBe(T2);
    // A click on a mine after the game is over cannot change anything.
    expect(revealCell(state, 3, createSeededRandom(1), T3)).toBe(state);
    expect(chordCell(state, 7, T3)).toBe(state);
    expect(cycleMark(state, 3)).toBe(state);
  });

  it("records a first click that lands on a mine of an explicit board as a zero-length loss", () => {
    const state = revealCell(columnBoard(), 14, createSeededRandom(1), T1);

    expect(state.status).toBe("lost");
    expect(minesweeperElapsedMs(state, T3)).toBe(0);
  });
});

describe("the state as a value", () => {
  it("never mutates the state it is handed", () => {
    const state = columnBoard();
    const before = JSON.stringify(state);

    revealCell(state, 0, createSeededRandom(1), T1);
    cycleMark(state, 20);
    chordCell(state, 7, T2);

    expect(JSON.stringify(state)).toBe(before);
  });

  it("keeps the caller's config out of its own state", () => {
    const config = { columns: 9, rows: 9, mines: 10 };
    const state = createMinesweeper(config);

    config.mines = 11;

    expect(state.config).toEqual({ columns: 9, rows: 9, mines: 10 });
  });

  it("refuses a click outside the board rather than ignoring it", () => {
    const state = columnBoard();

    expect(() => revealCell(state, 24, createSeededRandom(1), T1)).toThrow(RangeError);
    expect(() => cycleMark(state, -1)).toThrow(RangeError);
    expect(() => cycleMark(state, 1.5)).toThrow(RangeError);
  });

  it("refuses an instant with no zone, which two machines would read differently", () => {
    const state = columnBoard();

    expect(() => revealCell(state, 0, createSeededRandom(1), "2026-06-01T08:00:00")).toThrow(
      TypeError,
    );
    expect(() => revealCell(state, 0, createSeededRandom(1), "juče")).toThrow(TypeError);
  });

  it("keeps one spelling of an instant: the same moment in another zone is the same state", () => {
    const utc = revealCell(columnBoard(), 0, createSeededRandom(1), "2026-06-01T08:00:00.000Z");
    const belgrade = revealCell(columnBoard(), 0, createSeededRandom(1), "2026-06-01T10:00:00+02:00");

    expect(belgrade.startedAt).toBe(utc.startedAt);
  });
});

describe("minesweeperFromMines", () => {
  it("refuses a layout of the wrong size or with the wrong number of mines", () => {
    const config = { columns: 5, rows: 5, mines: 4 };

    expect(() => minesweeperFromMines(config, layout(5, 5, []) )).toThrow(RangeError);
    expect(() => minesweeperFromMines(config, new Array<boolean>(24).fill(false))).toThrow(
      RangeError,
    );
  });
});
