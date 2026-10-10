import { describe, expect, it } from "vitest";
import { newSeed } from "./seed.js";

/**
 * The seed a new game starts from. Two properties, and both are ones a game
 * breaks without: the value has to be one the store accepts, and pressing „Nova
 * igra" twice in a millisecond has to deal two different puzzles.
 */
describe("newSeed", () => {
  it("stays inside the 31 bits the store and the engines both take", () => {
    for (const now of [0, 1, 1_700_000_000_000, Number.MAX_SAFE_INTEGER]) {
      const seed = newSeed(now);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      // 2^31 - 1, the bound `puzzles_saves.seed` carries as MAX_PUZZLE_SEED.
      expect(seed).toBeLessThanOrEqual(2_147_483_647);
    }
  });

  it("deals a different puzzle for two presses inside one millisecond", () => {
    // The same clock reading twice: only the counter can tell them apart, which
    // is exactly what it is for.
    expect(newSeed(1_700_000_000_000)).not.toBe(newSeed(1_700_000_000_000));
  });
});
