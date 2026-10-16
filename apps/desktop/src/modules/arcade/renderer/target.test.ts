import { describe, expect, it } from "vitest";
import { arcadeTargetOf } from "./target.js";

/**
 * The item an assistant request names, read by the arcade page (ADR-117).
 *
 * The page opens the game and the board the item spells; an item it cannot honour
 * is `null`, so the page reports it handled and changes nothing.
 */
describe("arcadeTargetOf", () => {
  it("reads a Minesweeper preset as the game and the board", () => {
    expect(arcadeTargetOf("minesweeper/expert")).toEqual({
      game: "minesweeper",
      preset: "expert",
    });
  });

  it("reads a bare game as the game, keeping the board the page has", () => {
    expect(arcadeTargetOf("snake")).toEqual({ game: "snake", preset: null });
    expect(arcadeTargetOf("minesweeper")).toEqual({ game: "minesweeper", preset: null });
  });

  it("refuses what the page cannot honour", () => {
    expect(arcadeTargetOf("chess")).toBeNull();
    expect(arcadeTargetOf("")).toBeNull();
    expect(arcadeTargetOf("snake/expert")).toBeNull();
    expect(arcadeTargetOf("minesweeper/custom:9x9x10")).toBeNull();
    expect(arcadeTargetOf("minesweeper/expert/extra")).toBeNull();
  });
});
