import { describe, expect, it } from "vitest";
import type { PuzzleSaveView } from "../shared/ipc.js";
import { savedFor } from "./panelKit.js";

/** A save row with only the fields the pairing reads; the rest is not what this test is about. */
function row(puzzle: PuzzleSaveView["puzzle"], variant: string): PuzzleSaveView {
  return {
    puzzle,
    variant,
    seed: 1,
    state: {} as PuzzleSaveView["state"],
    elapsedSeconds: 0,
    createdAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z",
  };
}

describe("savedFor", () => {
  const saves = [row("sudoku", "hard")];

  it("finds the game in progress for the same puzzle and grade", () => {
    expect(savedFor(saves, "sudoku", "hard")).toBe(saves[0]);
  });

  it("does not count a game at another grade or another puzzle as the one in progress", () => {
    // The new-game question is asked only when this returns a row: asking about an
    // easy sudoku while a hard one is saved would name the wrong game.
    expect(savedFor(saves, "sudoku", "easy")).toBeNull();
    expect(savedFor(saves, "nonogram", "hard")).toBeNull();
  });
});
