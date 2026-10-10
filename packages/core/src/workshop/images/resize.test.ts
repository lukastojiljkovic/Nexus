import { describe, expect, it } from "vitest";
import { fitWithinBox, parseScaleNumber, scaleByPercent } from "./resize.js";

/**
 * The resize arithmetic, every expectation a hand calculation.
 *
 * Each `expect` below carries the product it came from, because "the width is
 * 400" is a fact about this file and "1000 × 400/1000" is a fact about the code.
 */

describe("scaleByPercent", () => {
  it("scales both sides by the percentage", () => {
    // 1000 × 25% = 250; 500 × 25% = 125.
    expect(scaleByPercent({ width: 1000, height: 500 }, 25)).toEqual({ width: 250, height: 125 });
  });

  it("rounds a fractional side to the nearest pixel", () => {
    // 1501 × 50% = 750.5 → 751; 1 × 50% = 0.5 → 1 (and never 0).
    expect(scaleByPercent({ width: 1501, height: 1 }, 50)).toEqual({ width: 751, height: 1 });
  });

  it("never produces a zero side", () => {
    // 3 × 33% = 0.99 → 1, not 0: a zero-sized canvas throws.
    expect(scaleByPercent({ width: 3, height: 3 }, 33)).toEqual({ width: 1, height: 1 });
  });

  it("enlarges above 100%", () => {
    // 2 × 400% = 8.
    expect(scaleByPercent({ width: 2, height: 2 }, 400)).toEqual({ width: 8, height: 8 });
  });
});

describe("fitWithinBox", () => {
  it("fits a wide image into a square box without stretching it", () => {
    // scale = min(400/1000, 400/500) = 0.4 → 400 × 200.
    expect(fitWithinBox({ width: 1000, height: 500 }, { width: 400, height: 400 })).toEqual({
      width: 400,
      height: 200,
    });
  });

  it("uses the binding side when the box is tall", () => {
    // scale = min(400/1000, 1000/500) = 0.4 → 400 × 200.
    expect(fitWithinBox({ width: 1000, height: 500 }, { width: 400, height: 1000 })).toEqual({
      width: 400,
      height: 200,
    });
  });

  it("leaves an image smaller than the box alone", () => {
    // scale = min(8, 6, 1) = 1: this mode never enlarges.
    expect(fitWithinBox({ width: 100, height: 100 }, { width: 800, height: 600 })).toEqual({
      width: 100,
      height: 100,
    });
  });

  it("rounds each side independently for tall images", () => {
    // 3 × (5/7) = 2.14 → 2; 7 × (5/7) = 5 exactly.
    expect(fitWithinBox({ width: 3, height: 7 }, { width: 5, height: 5 })).toEqual({
      width: 2,
      height: 5,
    });
    // 7 × (5/7) = 5; 3 × (5/7) = 2.14 → 2.
    expect(fitWithinBox({ width: 7, height: 3 }, { width: 5, height: 5 })).toEqual({
      width: 5,
      height: 2,
    });
  });

  it("keeps a one-pixel side while the other shrinks", () => {
    // scale = min(500, 0.5, 1) = 0.5 → 1 (0.5 rounds to 1) × 500.
    expect(fitWithinBox({ width: 1, height: 1000 }, { width: 500, height: 500 })).toEqual({
      width: 1,
      height: 500,
    });
  });

  it("refuses a size no decoder could have produced", () => {
    expect(() => fitWithinBox({ width: 0, height: 10 }, { width: 5, height: 5 })).toThrow(RangeError);
  });
});

describe("parseScaleNumber", () => {
  it("reads a whole number inside the bounds", () => {
    expect(parseScaleNumber("25", 1, 400)).toBe(25);
    expect(parseScaleNumber(" 400 ", 1, 400)).toBe(400);
    expect(parseScaleNumber("1", 1, 400)).toBe(1);
  });

  it("refuses anything outside the bounds, including the bounds' own neighbours", () => {
    expect(parseScaleNumber("0", 1, 400)).toBeNull();
    expect(parseScaleNumber("401", 1, 400)).toBeNull();
    expect(parseScaleNumber("20001", 1, 20_000)).toBeNull();
  });

  it("refuses text that is not a whole number", () => {
    expect(parseScaleNumber("", 1, 400)).toBeNull();
    expect(parseScaleNumber("abc", 1, 400)).toBeNull();
    expect(parseScaleNumber("12.5", 1, 400)).toBeNull();
    expect(parseScaleNumber("-5", 1, 400)).toBeNull();
    expect(parseScaleNumber("1e2", 1, 400)).toBeNull();
    expect(parseScaleNumber("25%", 1, 400)).toBeNull();
  });
});
