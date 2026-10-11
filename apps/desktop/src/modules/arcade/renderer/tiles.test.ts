import { describe, expect, it } from "vitest";

import { tileStep } from "./tiles.js";

/**
 * The four steps a 2048 tile is drawn at. The bands double with the tile, so the
 * boundaries are the powers of two where the value leaves one band: 4 -> 8,
 * 16 -> 32 and 64 -> 128.
 */
describe("tileStep", () => {
  it("steps up exactly at the tile that doubles the band", () => {
    expect(tileStep(2)).toBe(0);
    expect(tileStep(4)).toBe(0);
    expect(tileStep(8)).toBe(1);
    expect(tileStep(16)).toBe(1);
    expect(tileStep(32)).toBe(2);
    expect(tileStep(64)).toBe(2);
    expect(tileStep(128)).toBe(3);
  });

  it("holds the strongest step past the last band, and the weakest for an empty cell", () => {
    expect(tileStep(256)).toBe(3);
    expect(tileStep(2048)).toBe(3);
    expect(tileStep(65536)).toBe(3);
    expect(tileStep(0)).toBe(0);
  });
});
