import { describe, expect, it } from "vitest";
import type { PuzzleId } from "../shared/ipc.js";
import { openRequestOf } from "./intent.js";

const VARIANTS: Record<PuzzleId, readonly string[]> = {
  sudoku: ["easy", "medium", "hard"],
  nonogram: ["5x5", "10x10"],
  mahjong: ["turtle"],
  broj: ["six"],
};

describe("openRequestOf", () => {
  it("reads a grade of a puzzle, and whether the saved game is to be discarded", () => {
    expect(openRequestOf({ puzzle: "sudoku", variant: "hard" }, VARIANTS)).toEqual({
      puzzle: "sudoku",
      variant: "hard",
      fresh: false,
    });
    expect(openRequestOf({ puzzle: "nonogram", variant: "10x10", fresh: true }, VARIANTS)).toEqual({
      puzzle: "nonogram",
      variant: "10x10",
      fresh: true,
    });
  });

  it("refuses a puzzle, a grade or a flag the page does not have", () => {
    expect(openRequestOf({ puzzle: "crossword", variant: "easy" }, VARIANTS)).toBeNull();
    expect(openRequestOf({ puzzle: "sudoku", variant: "5x5" }, VARIANTS)).toBeNull();
    expect(openRequestOf({ puzzle: "broj", variant: "six", fresh: "yes" }, VARIANTS)).toBeNull();
    expect(openRequestOf({ puzzle: "broj" }, VARIANTS)).toBeNull();
    expect(openRequestOf(null, VARIANTS)).toBeNull();
  });
});
