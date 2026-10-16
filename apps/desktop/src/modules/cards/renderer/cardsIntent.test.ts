import { describe, expect, it } from "vitest";
import { startDealOf } from "./cardsIntent.js";

describe("startDealOf", () => {
  it("reads a deal the assistant named", () => {
    expect(startDealOf({ game: "hearts", variant: "standard", level: "hard", seed: 4_000_000_000 })).toEqual({
      game: "hearts",
      variant: "standard",
      level: "hard",
      seed: 4_000_000_000,
    });
  });

  it("reads a FreeCell deal by its deal number, not a 32-bit seed", () => {
    expect(startDealOf({ game: "freecell", variant: "classic", level: "medium", seed: 617 })?.seed).toBe(617);
    expect(startDealOf({ game: "freecell", variant: "classic", level: "medium", seed: 32_001 })).toBeNull();
  });

  it("refuses a variant the game does not have, an unknown level, and a missing seed", () => {
    expect(startDealOf({ game: "spider", variant: "draw1", level: "medium", seed: 1 })).toBeNull();
    expect(startDealOf({ game: "golf", variant: "classic", level: "expert", seed: 1 })).toBeNull();
    expect(startDealOf({ game: "golf", variant: "classic", level: "medium" })).toBeNull();
  });

  it("refuses anything that is not an object", () => {
    expect(startDealOf(null)).toBeNull();
    expect(startDealOf("klondike")).toBeNull();
  });
});
