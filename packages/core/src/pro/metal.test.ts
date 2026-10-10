import { describe, expect, it } from "vitest";

import { cuttingSpeed, feedPerTooth, metalWeight, weldThroatLeg } from "./metal.js";

describe("cuttingSpeed", () => {
  it("turns 100 m/min on a 50 mm cutter into 636,62 rpm", () => {
    // n = 1000·100/(π·50) = 636,6198 rpm.
    const result = cuttingSpeed({ diameterMm: 50, mode: "fromSpeed", cuttingSpeedMPerMin: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spindleSpeedRpm).toBeCloseTo(636.6198, 3);
    expect(result.cuttingSpeedMPerMin).toBeCloseTo(100, 9);
  });

  it("turns 3000 rpm on a 10 mm cutter into 94,25 m/min", () => {
    const result = cuttingSpeed({ diameterMm: 10, mode: "fromRpm", spindleSpeedRpm: 3000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cuttingSpeedMPerMin).toBeCloseTo(94.2478, 3);
  });

  it("refuses both inputs at once", () => {
    const result = cuttingSpeed({
      diameterMm: 10,
      mode: "fromRpm",
      spindleSpeedRpm: 3000,
      cuttingSpeedMPerMin: 100,
    });
    expect(result).toEqual({ ok: false, reason: "known" });
  });
});

describe("feedPerTooth", () => {
  it("gives 400 mm/min from four teeth at 0,1 mm and 1000 rpm", () => {
    const result = feedPerTooth({
      toothCount: 4,
      mode: "fromPerTooth",
      feedPerToothMm: 0.1,
      spindleSpeedRpm: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feedPerRevolutionMm).toBeCloseTo(0.4, 9);
    expect(result.feedRateMmPerMin).toBeCloseTo(400, 9);
  });

  it("reads the feed per tooth back out of the table feed", () => {
    const result = feedPerTooth({
      toothCount: 4,
      mode: "fromFeedRate",
      feedRateMmPerMin: 400,
      spindleSpeedRpm: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.feedPerToothMm).toBeCloseTo(0.1, 9);
  });

  it("refuses a tooth count of zero rather than dividing by it", () => {
    const result = feedPerTooth({
      toothCount: 0,
      mode: "fromFeedRate",
      feedRateMmPerMin: 400,
      spindleSpeedRpm: 1000,
    });
    expect(result).toEqual({ ok: false, reason: "toothCount" });
  });
});

describe("metalWeight", () => {
  it("weighs a round steel bar: 20 mm over a metre is 2,466 kg", () => {
    // A = π·20²/4 = 314,1593 mm²; 314,1593e−6 m² · 7850 kg/m³ = 2,46615 kg/m.
    const result = metalWeight({
      shape: "round",
      sizeMm: 20,
      lengthM: 1,
      pieces: 1,
      densityKgM3: 7850,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.crossSectionMm2).toBeCloseTo(314.15927, 4);
    expect(result.massPerMetre).toBeCloseTo(2.46615, 4);
    expect(result.massPerPiece).toBeCloseTo(2.46615, 4);
    expect(result.volumePerPieceM3).toBeCloseTo(3.1415927e-4, 9);
  });

  it("uses the across-the-flats area for hex bar", () => {
    // (√3/2)·10² = 86,60254 mm².
    const result = metalWeight({
      shape: "hex",
      sizeMm: 10,
      lengthM: 1,
      pieces: 1,
      densityKgM3: 7850,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.crossSectionMm2).toBeCloseTo(86.60254, 4);
    expect(result.massPerMetre).toBeCloseTo(0.67983, 5);
  });

  it("takes the bore out of a round tube", () => {
    // π/4·(30² − 26²) = π/4·224 = 175,9292 mm².
    const result = metalWeight({
      shape: "roundTube",
      sizeMm: 30,
      wallMm: 2,
      lengthM: 6,
      pieces: 2,
      densityKgM3: 7850,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.crossSectionMm2).toBeCloseTo(175.92919, 4);
    // A·L·n·ρ = 175,92919e−6 m² · 6 m · 2 · 7850 kg/m³ = 16,5725 kg.
    expect(result.totalMass).toBeCloseTo(16.5725, 4);
  });

  it("reads a plate as a width and a thickness", () => {
    const result = metalWeight({
      shape: "rect",
      sizeMm: 40,
      secondSizeMm: 10,
      lengthM: 1,
      pieces: 1,
      densityKgM3: 7850,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.crossSectionMm2).toBeCloseTo(400, 9);
  });

  it("refuses a wall thicker than half the tube", () => {
    const result = metalWeight({
      shape: "boxTube",
      sizeMm: 40,
      wallMm: 20,
      lengthM: 1,
      pieces: 1,
      densityKgM3: 7850,
    });
    expect(result).toEqual({ ok: false, reason: "wall" });
  });
});

describe("weldThroatLeg", () => {
  it("gives an equal-leg fillet a throat of z/√2", () => {
    const result = weldThroatLeg({ measure: "leg", legMm: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.throatMm).toBeCloseTo(3.5355339, 6);
    expect(result.areaMm2).toBeCloseTo(12.5, 9);
    expect(result.massPerMetre).toBeCloseTo(0.098125, 6);
  });

  it("does NOT give an unequal fillet z·0,707", () => {
    // z₁·z₂/√(z₁² + z₂²) = 48/10 = 4,8 mm — not 6·0,707 = 4,243.
    const result = weldThroatLeg({ measure: "leg", legMm: 6, leg2Mm: 8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.throatMm).toBeCloseTo(4.8, 9);
    expect(result.areaMm2).toBeCloseTo(24, 9);
  });

  it("inverts a throat back to the equal legs that would give it", () => {
    const result = weldThroatLeg({ measure: "throat", throatMm: 3.5355339 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.legMm).toBeCloseTo(5, 6);
    expect(result.throatMm).toBeCloseTo(3.5355339, 6);
  });
});
