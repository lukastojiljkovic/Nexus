import { describe, expect, it } from "vitest";

import { MINESWEEPER_PRESETS } from "@nexus/core";
import { readCustomBoard } from "./customBoard.js";

/**
 * The custom-board form. Every expectation is the engine's own rule, worked out
 * by hand: a board is playable when it is 1..30 columns, 1..24 rows, at least one
 * mine, and at least nine cells left over for the mine-free block a first click
 * promises.
 */

describe("readCustomBoard", () => {
  it("reads three numbers into the engine's own config", () => {
    expect(readCustomBoard({ columns: "9", rows: "9", mines: "10" })).toEqual({
      columns: 9,
      rows: 9,
      mines: 10,
    });
    // The largest board the engine takes, and the smallest.
    expect(readCustomBoard({ columns: "30", rows: "24", mines: "300" })).toEqual({
      columns: 30,
      rows: 24,
      mines: 300,
    });
    expect(readCustomBoard({ columns: "4", rows: "4", mines: "7" })).toEqual({
      columns: 4,
      rows: 4,
      mines: 7,
    });
  });

  it("accepts exactly the boards the presets are drawn on", () => {
    for (const preset of Object.values(MINESWEEPER_PRESETS)) {
      expect(
        readCustomBoard({
          columns: String(preset.columns),
          rows: String(preset.rows),
          mines: String(preset.mines),
        }),
      ).toEqual(preset);
    }
  });

  it("refuses a board whose first click could not be safe: nine free cells", () => {
    // 4 x 4 with 7 mines leaves 9 free cells and is taken; the eighth mine would
    // leave 8, which is one short of the block the click clears.
    expect(readCustomBoard({ columns: "4", rows: "4", mines: "8" })).toBeNull();
    // 9 x 9 with 72 mines leaves exactly 9 and is taken; the 73rd does not.
    expect(readCustomBoard({ columns: "9", rows: "9", mines: "72" })).not.toBeNull();
    expect(readCustomBoard({ columns: "9", rows: "9", mines: "73" })).toBeNull();
  });

  it("refuses a field that is not a whole number, and a board the engine has no space for", () => {
    expect(readCustomBoard({ columns: "", rows: "9", mines: "10" })).toBeNull();
    expect(readCustomBoard({ columns: "9", rows: "0", mines: "10" })).toBeNull();
    expect(readCustomBoard({ columns: "9", rows: "9", mines: "0" })).toBeNull();
    expect(readCustomBoard({ columns: "9", rows: "9", mines: "10" })).not.toBeNull();
  });

  it("refuses a number typed as something else, rather than reading part of it", () => {
    for (const bad of ["9,", "9.5", "-9", "9 9", "x", "00"]) {
      expect(readCustomBoard({ columns: bad, rows: "9", mines: "10" }), bad).toBeNull();
    }
    // A single leading zero is a number a person may type; "00" is not.
    expect(readCustomBoard({ columns: "09", rows: "9", mines: "10" })).toEqual({
      columns: 9,
      rows: 9,
      mines: 10,
    });
  });
});
