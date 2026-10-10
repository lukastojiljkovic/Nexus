import { describe, expect, it } from "vitest";

import {
  biasBinding,
  buttonSpacing,
  circleSkirt,
  gatherRatio,
  seamAllowance,
} from "./krojenje.js";

describe("circleSkirt", () => {
  it("draws a full circle skirt from 70 cm of waist", () => {
    // r = 70/(2π) = 11,14085 cm; hem radius 61,14085; hem 2π·61,14085 = 384,159 cm.
    const result = circleSkirt({ waistCm: 70, circle: "full", lengthCm: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.waistRadiusCm).toBeCloseTo(11.14085, 5);
    expect(result.hemRadiusCm).toBeCloseTo(61.14085, 5);
    expect(result.hemCircumferenceCm).toBeCloseTo(384.159, 3);
    expect(result.fabricSquareCm).toBeCloseTo(122.2817, 4);
    // The waist arc IS the waist, at every fraction — the family's property.
    expect(result.waistArcCm).toBeCloseTo(70, 9);
  });

  it("doubles the radius for a half circle and quadruples it for a quarter", () => {
    const half = circleSkirt({ waistCm: 70, circle: "half", lengthCm: 50 });
    const quarter = circleSkirt({ waistCm: 70, circle: "quarter", lengthCm: 50 });
    expect(half.ok).toBe(true);
    expect(quarter.ok).toBe(true);
    if (!half.ok || !quarter.ok) return;
    expect(half.waistRadiusCm).toBeCloseTo(22.28169, 5);
    expect(quarter.waistRadiusCm).toBeCloseTo(44.56338, 5);
  });

  it("refuses a circle that is not one of the three", () => {
    const result = circleSkirt({ waistCm: 70, circle: "third" as never, lengthCm: 50 });
    expect(result).toEqual({ ok: false, reason: "circle" });
  });
});

describe("seamAllowance", () => {
  it("adds an allowance at every seam the dimension crosses", () => {
    const result = seamAllowance({ mode: "toCut", dimensionCm: 100, seams: 2, allowanceCm: 1.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cutCm).toBeCloseTo(103, 9);
    expect(result.totalAddedCm).toBeCloseTo(3, 9);
    expect(result.finishedCm).toBeCloseTo(100, 9);
  });

  it("reads a cut dimension back to the finished one", () => {
    const result = seamAllowance({ mode: "toFinished", dimensionCm: 103, seams: 2, allowanceCm: 1.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finishedCm).toBeCloseTo(100, 9);
  });

  it("refuses a deduction that would eat the whole dimension", () => {
    const result = seamAllowance({ mode: "toFinished", dimensionCm: 3, seams: 2, allowanceCm: 1.5 });
    expect(result).toEqual({ ok: false, reason: "dimension" });
  });
});

describe("biasBinding", () => {
  it("gets 400 cm of 4 cm bias strip out of a 40 cm square", () => {
    // 40²/4 = 400 cm = 4 m; 10 parallel strips; diagonal 40·√2 = 56,5685 cm.
    const result = biasBinding({ squareCm: 40, stripWidthCm: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stripLengthCm).toBeCloseTo(400, 9);
    expect(result.stripLengthM).toBeCloseTo(4, 9);
    expect(result.stripCount).toBe(10);
    expect(result.diagonalCm).toBeCloseTo(56.56854, 4);
  });

  it("refuses a strip wider than the tool reads", () => {
    const result = biasBinding({ squareCm: 40, stripWidthCm: 0.1 });
    expect(result).toEqual({ ok: false, reason: "stripWidth" });
  });
});

describe("gatherRatio", () => {
  it("calls 150 cm gathered into 100 cm a 1,5 ratio", () => {
    const result = gatherRatio({ flatLengthCm: 150, setLengthCm: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratio).toBeCloseTo(1.5, 9);
    expect(result.easePerCm).toBeCloseTo(0.5, 9);
  });

  it("refuses a flatter piece, which is not a gather at all", () => {
    const result = gatherRatio({ flatLengthCm: 100, setLengthCm: 150 });
    expect(result).toEqual({ ok: false, reason: "flatLength" });
  });
});

describe("buttonSpacing", () => {
  it("puts five buttons over 60 cm at 15 cm centres", () => {
    const result = buttonSpacing({ lengthCm: 60, buttons: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spacingCm).toBeCloseTo(15, 9);
    expect(result.positionsCm).toEqual([0, 15, 30, 45, 60]);
  });

  it("refuses a single button: that is a position, not a spacing", () => {
    const result = buttonSpacing({ lengthCm: 60, buttons: 1 });
    expect(result).toEqual({ ok: false, reason: "buttons" });
  });
});
