import { describe, expect, it } from "vitest";
import type { SudokuStateView } from "../shared/ipc.js";
import {
  clearCell,
  conflictCells,
  enterDigit,
  filledCount,
  hintFacts,
  hintFor,
  isSolved,
  mergedCells,
  sameDigitCells,
  toggleNote,
  unitsOf,
} from "./sudoku.js";

/**
 * Sudoku's editing rules, against a published grid.
 *
 * **The fixture is AI Escargot**, the puzzle Arto Inkala published in 2006 as the
 * hardest then known, taken from the same two constants `sudoku.test.ts` uses
 * (`sudokuwiki.org/Escargot`) — so the board and its solution are a cited source
 * rather than nine rows this file invented, and every expectation below is a
 * value counted off those two strings or off the engine's own answer about them.
 */
const ESCARGOT =
  "100007090030020008009600500005300900010080002600004000300000010040000007007000300";
const ESCARGOT_SOLUTION =
  "162857493534129678789643521475312986913586742628794135356478219241935867897261354";

const GIVENS = [...ESCARGOT].map(Number);
const SOLUTION = [...ESCARGOT_SOLUTION].map(Number);

/** The board at the moment it is opened: the published givens, nothing entered, no marks. */
function opened(): SudokuStateView {
  return {
    givens: GIVENS,
    entries: new Array<number | null>(81).fill(null),
    notes: Array.from({ length: 81 }, () => [] as number[]),
    hintsUsed: 0,
  };
}

/** Every hole filled with the published solution. */
function finished(): SudokuStateView {
  const state = opened();
  return {
    ...state,
    entries: state.givens.map((given, index) => (given === 0 ? (SOLUTION[index] ?? null) : null)),
  };
}

describe("the sudoku board helpers", () => {
  it("reads a cell's unit as its row, its column and its box, together and in order", () => {
    // Hand-counted from the engine's own `SUDOKU_UNITS`: row 0 is 0..8, column 0
    // is every ninth cell, box 0 is the first three of the first three rows.
    // 9 + 9 + 9 - the cell counted three times - 4 shared members = 21 cells.
    expect(unitsOf(0)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 18, 19, 20, 27, 36, 45, 54, 63, 72,
    ]);
    expect(unitsOf(80)).toEqual([
      8, 17, 26, 35, 44, 53, 60, 61, 62, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80,
    ]);
  });

  it("overlays what the player entered onto the givens", () => {
    const state = opened();
    // Escargot's first row is 1 0 0 0 0 7 0 9 0, so cell 1 is its first hole
    // and the published solution puts a 6 there.
    expect(state.givens[1]).toBe(0);
    expect(mergedCells(enterDigit(state, 1, 6))[1]).toBe(6);
    // A given is what it is, whatever a payload claimed about it.
    expect(enterDigit(state, 0, 9)).toBe(state);
    expect(mergedCells(state)[0]).toBe(1);
  });

  it("counts the filled cells and finds the nine that share a digit", () => {
    const state = finished();
    // Every row of the published solution holds each digit exactly once, so nine
    // cells carry the 1 that stands in cell 0.
    const ones = sameDigitCells(state, 0);
    expect(ones).toHaveLength(9);
    expect(ones.every((cell) => mergedCells(state)[cell] === 1)).toBe(true);

    // The opened board is the givens and nothing else: Escargot's own count.
    const givens = [...ESCARGOT].filter((ch) => ch !== "0").length;
    expect(filledCount(opened())).toBe(givens);
    expect(filledCount(state)).toBe(81);
  });

  it("calls a board solved only when every cell holds the right digit", () => {
    expect(isSolved(finished(), SOLUTION)).toBe(true);
    expect(isSolved(opened(), SOLUTION)).toBe(false);
    // A full board with one digit changed is finished-looking and wrong.
    const wrong = finished();
    const entries = [...wrong.entries];
    // Cell 1 is a hole in the published board, so this is a cell the player
    // can really change.
    entries[1] = 9;
    expect(isSolved({ ...wrong, entries }, SOLUTION)).toBe(false);
  });

  it("clears a cell when the same digit is entered twice, and never a given", () => {
    const once = enterDigit(opened(), 1, 6);
    expect(once.entries[1]).toBe(6);
    const twice = enterDigit(once, 1, 6);
    expect(twice.entries[1]).toBeNull();
    expect(clearCell(once, 1).entries[1]).toBeNull();
    // Neither gesture can touch a cell the puzzle fills itself.
    expect(enterDigit(once, 0, 3)).toBe(once);
    expect(clearCell(once, 0)).toBe(once);
  });

  it("toggles pencil marks in order, and refuses them on a cell that holds a digit", () => {
    let state = opened();
    state = toggleNote(state, 1, 9);
    state = toggleNote(state, 1, 3);
    expect(state.notes[1]).toEqual([3, 9]);
    state = toggleNote(state, 1, 9);
    expect(state.notes[1]).toEqual([3]);
    // A given has no marks to toggle and answers the same state back.
    expect(toggleNote(state, 0, 4)).toBe(state);

    // A placement clears the cell's OWN marks — a cell shows a digit or its
    // marks, never both — and leaves the marks beside it exactly as written.
    const marked = toggleNote(state, 6, 2);
    const placed = enterDigit(marked, 1, 6);
    expect(placed.notes[1]).toEqual([]);
    expect(placed.notes[6]).toEqual([2]);
    expect(toggleNote(placed, 1, 8)).toBe(placed);
  });

  it("shows conflicts only when asked, and marks every cell of the offending group", () => {
    const state = opened();
    // Cell 1 is a hole in a row that already holds a 1 at cell 0, so entering a
    // second 1 there makes cells 0 and 1 the offending pair.
    const conflicting = enterDigit(state, 1, 1);
    expect(conflictCells(conflicting, false)).toEqual([]);
    // Both cells of the row AND cell 37, the given 1 in the same column: the
    // engine marks every cell of every offending unit, which is what a board
    // has to draw to be useful.
    expect(conflictCells(conflicting, true)).toEqual([0, 1, 37]);
    expect(conflictCells(state, true)).toEqual([]);
  });

  it("reads the ladder's next step into the four facts a panel draws", () => {
    // One hole left in the published solution is the simplest naked single
    // there is, and the engine answers it from its own solution.
    const state = finished();
    const entries = [...state.entries];
    // Cell 1 is a hole in Escargot's first row; everything else holds a digit.
    const open = 1;
    entries[open] = null;
    const hint = hintFor({ ...state, entries });
    if (hint === null) throw new Error("one hole in a solved board is a naked single");
    expect(hintFacts(hint)).toEqual({
      technique: "naked-single",
      action: "fill",
      cell: open,
      digit: SOLUTION[open],
      cells: [open],
      pattern: [open],
      digits: [SOLUTION[open]],
    });
    // A finished board has no next step.
    expect(hintFor(finished())).toBeNull();
  });
});
