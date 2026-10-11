import { describe, expect, it } from "vitest";

import { boardFoot } from "./stolarija.js";

/**
 * One board foot is 144 in³ by definition and the international inch is exactly
 * 25,4 mm, so 144 × 25,4³ = 2 359 737,216 mm³ — the literal the vectors below
 * divide by, written out rather than trusted.
 */
const BOARD_FOOT_MM3 = 144 * 25.4 ** 3;

describe("boardFoot", () => {
  it("counts two 50 × 100 mm pieces of 2,4 m as 10,17 board feet", () => {
    // One piece is 50·100·2400 = 12 000 000 mm³ = 5,085319 bd ft; two are 10,170638.
    const result = boardFoot({
      mode: "pieces",
      thicknessMm: 50,
      widthMm: 100,
      lengthMm: 2400,
      pieces: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.boardFeetPerPiece).toBeCloseTo(12000000 / BOARD_FOOT_MM3, 9);
    expect(result.boardFeet).toBeCloseTo(10.170624, 5);
    expect(result.volumeM3).toBeCloseTo(0.024, 9);
    // 24 000 000 mm³ / (12³ · 25,4³) = 0,847551 ft³.
    expect(result.volumeFt3).toBeCloseTo(0.847552, 6);
  });

  it("converts a cubic metre into 423,78 board feet", () => {
    const result = boardFoot({ mode: "volume", volumeM3: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.boardFeet).toBeCloseTo(423.776, 3);
    expect(result.volumeFt3).toBeCloseTo(35.31467, 5);
  });

  it("converts board feet back into cubic metres", () => {
    const result = boardFoot({ mode: "boardFeet", boardFeet: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.volumeM3).toBeCloseTo(0.23597372, 8);
  });

  it("refuses a zero thickness rather than weighing nothing", () => {
    const result = boardFoot({
      mode: "pieces",
      thicknessMm: 0,
      widthMm: 100,
      lengthMm: 2400,
      pieces: 1,
    });
    expect(result).toEqual({ ok: false, reason: "thickness" });
  });
});
