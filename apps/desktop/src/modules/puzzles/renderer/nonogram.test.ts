import { describe, expect, it } from "vitest";
import { generateNonogram } from "@nexus/core";
import type { NonogramPuzzle } from "@nexus/core";
import {
  MARK_CROSSED,
  MARK_FILLED,
  MARK_UNKNOWN,
  ZOOM_CELL_SIZES,
  applyMark,
  completedLines,
  emptyMarks,
  isSolved,
  lineIsDone,
  nonogramSizeOf,
  progressOf,
  zoomCellSize,
} from "./nonogram.js";

/**
 * Nonograms' marks and the clue readout, against a two-by-three picture written
 * out here so a reader can count it:
 *
 *     # # .
 *     # . .
 *
 * Its row clues are [2] and [1]; its column clues are [2], [1] and [] (the third
 * column is empty, and an empty line's clue is the empty list — `cluesOf`'s own
 * rule, which the engine's test pins).
 */
const PICTURE: NonogramPuzzle = {
  width: 3,
  height: 2,
  rowClues: [[2], [1]],
  colClues: [[2], [1], []],
  solution: [true, true, false, true, false, false],
  seed: 1,
  attempts: 1,
};

describe("the nonogram marks", () => {
  it("applies the tool, clears the same mark, and replaces the other one", () => {
    let marks = emptyMarks(3, 2);
    expect(marks).toEqual([0, 0, 0, 0, 0, 0]);

    marks = applyMark(marks, 1, "fill");
    expect(marks).toEqual([0, 1, 0, 0, 0, 0]);
    // The same tool on the same cell clears it.
    expect(applyMark(marks, 1, "fill")).toEqual([0, 0, 0, 0, 0, 0]);
    // The other tool takes the cell over rather than stacking on it.
    expect(applyMark(marks, 1, "cross")).toEqual([0, MARK_CROSSED, 0, 0, 0, 0]);
  });

  it("reads a line as done exactly when its filled cells match its clue", () => {
    expect(lineIsDone([MARK_FILLED, MARK_FILLED, MARK_UNKNOWN], [2])).toBe(true);
    expect(lineIsDone([MARK_FILLED, MARK_FILLED, MARK_UNKNOWN], [3])).toBe(false);
    // A cross is not a fill, so a crossed cell in the middle splits the run.
    expect(lineIsDone([MARK_FILLED, MARK_CROSSED, MARK_FILLED], [2])).toBe(false);
    expect(lineIsDone([MARK_FILLED, MARK_CROSSED, MARK_FILLED], [1, 1])).toBe(true);
    // An empty line's clue is the empty list, and a blank line is exactly that.
    expect(lineIsDone([MARK_UNKNOWN, MARK_UNKNOWN], [])).toBe(true);
    expect(lineIsDone([MARK_UNKNOWN, MARK_FILLED], [])).toBe(false);
  });

  it("crosses off the rows and columns the picture accounts for", () => {
    const marks = [MARK_FILLED, MARK_FILLED, MARK_UNKNOWN, MARK_FILLED, MARK_UNKNOWN, MARK_UNKNOWN];
    expect(completedLines(marks, PICTURE)).toEqual({
      rows: [true, true],
      columns: [true, true, true],
    });
    // One cell short in the first row: the row is not done, and neither is the
    // column that needed two filled cells.
    const short = [MARK_FILLED, MARK_UNKNOWN, MARK_UNKNOWN, MARK_FILLED, MARK_UNKNOWN, MARK_UNKNOWN];
    expect(completedLines(short, PICTURE)).toEqual({
      rows: [false, true],
      columns: [true, false, true],
    });
  });

  it("counts progress and completion through the engine, not through a second rule", () => {
    const right = [MARK_FILLED, MARK_FILLED, MARK_UNKNOWN, MARK_FILLED, MARK_UNKNOWN, MARK_UNKNOWN];
    expect(progressOf(right, PICTURE)).toEqual({ progress: 3, wrong: 0 });
    expect(isSolved(right, PICTURE)).toBe(true);

    // A cell filled that the picture leaves empty: two of the picture's three
    // cells are filled and one of the player's is wrong.
    const mistaken = [MARK_FILLED, MARK_FILLED, MARK_FILLED, MARK_UNKNOWN, MARK_UNKNOWN, MARK_UNKNOWN];
    expect(progressOf(mistaken, PICTURE)).toEqual({ progress: 2, wrong: 1 });
    expect(isSolved(mistaken, PICTURE)).toBe(false);
    // Crosses are not fills: the same board with the third cell crossed is still
    // incomplete but no longer wrong.
    const crossed = [MARK_FILLED, MARK_FILLED, MARK_CROSSED, MARK_UNKNOWN, MARK_UNKNOWN, MARK_UNKNOWN];
    expect(progressOf(crossed, PICTURE)).toEqual({ progress: 2, wrong: 0 });
    expect(isSolved(crossed, PICTURE)).toBe(false);
  });

  it("reads a variant into a board size, and refuses a key that is not one", () => {
    expect(nonogramSizeOf("5x5")).toEqual({ width: 5, height: 5 });
    expect(nonogramSizeOf("10x10")).toEqual({ width: 10, height: 10 });
    expect(nonogramSizeOf("20x20")).toEqual({ width: 20, height: 20 });
    expect(nonogramSizeOf("nonsense")).toBeNull();
    // Outside the engine's own 5..20 range: the generator would refuse it, so
    // this is not a size rather than a size to clamp.
    expect(nonogramSizeOf("4x4")).toBeNull();
    expect(nonogramSizeOf("21x21")).toBeNull();
  });

  it("steps the zoom between three sizes and stays at the ends", () => {
    expect(ZOOM_CELL_SIZES).toEqual([16, 22, 28]);
    expect(zoomCellSize(0)).toBe(16);
    expect(zoomCellSize(1)).toBe(22);
    expect(zoomCellSize(2)).toBe(28);
    expect(zoomCellSize(-3)).toBe(16);
    expect(zoomCellSize(9)).toBe(28);
  });

  it("solves a generated board's own picture when it is marked in", () => {
    // A generated puzzle, marked exactly as its own solution: the engine's
    // completion answer is the one that decides, so this is the readout that has
    // to agree with it.
    const puzzle = generateNonogram(5, 5, 5);
    const marks = puzzle.solution.map((filled) => (filled ? MARK_FILLED : MARK_CROSSED));
    expect(isSolved(marks, puzzle)).toBe(true);
    expect(progressOf(marks, puzzle)).toEqual({
      progress: puzzle.solution.filter(Boolean).length,
      wrong: 0,
    });
  });
});
