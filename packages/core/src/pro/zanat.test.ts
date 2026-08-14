import { describe, expect, it } from "vitest";

import {
  fabricYardageRepeat,
  glassPaneWeight,
  iso286Fit,
  linearCuttingStock,
  mitreAngles,
  mortarMixQuantity,
  panelCuttingYield,
  sheetMetalBend,
  sheetMetalKFactorFromSample,
  shelfDeflection,
  shelfSpacing,
  tapDrillSize,
  timberVolume,
  wallpaperRolls,
  weldConsumable,
  woodMoistureMovement,
} from "./zanat.js";

/**
 * Every expectation here is worked by hand from the inputs, and the arithmetic
 * is written into the comments so it can be checked without running anything.
 */

describe("fabricYardageRepeat", () => {
  it("cushions, no horizontal repeat: 2 across the roll, alignment adds one repeat, 4.16 m", () => {
    // cut = 50+2×1.5 = 53×53 cm. n_a = floor(140/53) = 2. rows = ceil(12/2) = 6.
    // rowLength = ceil(53/32)×32 = 2×32 = 64. exact = 6×64 = 384; +alignment 32 = 416.
    // usage = 416×1.00/100 = 4.16 m.
    const result = fabricYardageRepeat({
      rows: [{ width: 50, height: 50, count: 12 }],
      rollWidth: 140,
      seamAllowance: 1.5,
      verticalRepeat: 32,
      waste: 0,
      grainMandatory: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.rows[0];
    expect(row?.piecesAcrossRoll).toBe(2);
    expect(row?.cutRows).toBe(6);
    expect(row?.rowLength).toBe(64);
    expect(row?.alignmentAllowance).toBe(32);
    expect(row?.exactLength).toBe(416);
    expect(result.totalLength).toBeCloseTo(4.16, 6);
    expect(result.orderLength).toBeCloseTo(4.2, 6);
    // used = 4.16×1.40 = 5.824; useful = 12×0.5×0.5 = 3.000; waste = 2.824.
    expect(result.usedArea).toBeCloseTo(5.824, 6);
    expect(result.usefulArea).toBeCloseTo(3.0, 6);
    expect(result.wasteArea).toBeCloseTo(2.824, 6);
  });

  it("horizontal repeat centres the WIDTH and shows the alignment allowance the old formula hid", () => {
    // cut = 60+4 × 45+4 = 64×49. Centred across the roll: ceil(64/20)×20 = 80.
    // n_a = floor(145/80) = 1. rows = ceil(8/1) = 8. rowLength = ceil(49/24)×24 = 72.
    // exact = 8×72 = 576; + one alignment repeat (24) = 600; ×1.10 waste = 660 cm = 6.60 m.
    // (The pre-correction total, which hid the alignment repeat inside waste
    // instead of adding it, would have been 576×1.10 = 633.6 cm = 6.34 m.)
    const result = fabricYardageRepeat({
      rows: [{ width: 60, height: 45, count: 8 }],
      rollWidth: 145,
      seamAllowance: 2,
      verticalRepeat: 24,
      horizontalRepeat: 20,
      waste: 10,
      grainMandatory: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.rows[0];
    expect(row?.centeredDimension).toBe("width");
    expect(row?.acrossRoll).toBe(80);
    expect(row?.piecesAcrossRoll).toBe(1);
    expect(row?.alignmentAllowance).toBe(24);
    expect(result.totalLength).toBeCloseTo(6.6, 6);
    expect(row?.usagePerPiece).toBeCloseTo(0.825, 6); // 6.60/8
    expect(result.usedArea).toBeCloseTo(6.6 * 1.45, 6);
    expect(result.usefulArea).toBeCloseTo(2.16, 6); // 60×45×8 / 10000
  });

  it("no repeats, rotation allowed: the smaller of the two orientations is chosen", () => {
    // Normal: n_a = floor(145/64) = 2, rows = ceil(8/2) = 4, row = 49 → 196 cm.
    // Rotated: n_a = floor(145/49) = 2, rows = 4, row = 64 → 256 cm. 196 < 256.
    const result = fabricYardageRepeat({
      rows: [{ width: 64, height: 49, count: 8 }],
      rollWidth: 145,
      seamAllowance: 0,
      verticalRepeat: 0,
      waste: 0,
      grainMandatory: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.rows[0];
    expect(row?.orientation).toBe("normal");
    expect(row?.exactLength).toBe(196);
    expect(row?.alignmentAllowance).toBe(0); // no vertical repeat, no rounding, no alignment cost
    expect(result.totalLength).toBeCloseTo(1.96, 6);
  });

  it("refuses a piece too wide for the roll in both orientations, before dividing by zero pieces-across", () => {
    const result = fabricYardageRepeat({
      rows: [{ width: 500, height: 500, count: 1 }],
      rollWidth: 140,
      seamAllowance: 0,
      verticalRepeat: 0,
      waste: 0,
      grainMandatory: true,
    });
    expect(result).toEqual({ ok: false, reason: "acrossRoll:0" });
  });

  it("refuses an empty row list and an out-of-range piece count", () => {
    expect(
      fabricYardageRepeat({
        rows: [],
        rollWidth: 140,
        seamAllowance: 0,
        verticalRepeat: 0,
        waste: 0,
        grainMandatory: true,
      }),
    ).toEqual({ ok: false, reason: "rows" });
    expect(
      fabricYardageRepeat({
        rows: [{ width: 50, height: 50, count: 0 }],
        rollWidth: 140,
        seamAllowance: 0,
        verticalRepeat: 0,
        waste: 0,
        grainMandatory: true,
      }),
    ).toEqual({ ok: false, reason: "count:0" });
  });
});

/* -----------------------------------------------------------------------
 * glass-pane-weight (life-safety)
 * -------------------------------------------------------------------- */

describe("glassPaneWeight", () => {
  it("insulated 4-16-4, 1600×2400 mm, 2 pieces: the 16 mm gap carries no mass", () => {
    // area = 1.600×2.400 = 3.840 m². massPerArea = 2.5×(4+4) = 20.000 kg/m².
    // massPerPiece = 3.840×20 = 76.80 kg; total = 2×76.80 = 153.60 kg.
    // perimeter = 2×(1.600+2.400) = 8.00 m.
    const result = glassPaneWeight({
      width: 1600,
      height: 2400,
      composition: "insulated",
      plyThicknesses: [4, 4],
      pieces: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.area).toBeCloseTo(3.84, 6);
    expect(result.massPerArea).toBeCloseTo(20.0, 3);
    expect(result.massPerPiece).toBeCloseTo(76.8, 2);
    expect(result.totalMass).toBeCloseTo(153.6, 2);
    expect(result.perimeter).toBeCloseTo(8.0, 6);
  });

  it("laminated 33.2 (3+3 mm glass, 2×0.38 mm PVB), 1000×2000 mm: 31.63 kg", () => {
    // area = 1.000×2.000 = 2.000 m². glass 2.5×6 = 15.000; PVB 1.07×0.76 = 0.8132.
    // massPerArea = 15.8132 kg/m². massPerPiece = 2.000×15.8132 = 31.6264 → 31.63 kg.
    const result = glassPaneWeight({
      width: 1000,
      height: 2000,
      composition: "laminated",
      plyThicknesses: [3, 3],
      pvbLayers: 2,
      pvbLayerThickness: 0.38,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.glassThicknessSum).toBe(6);
    expect(result.pvbThicknessSum).toBeCloseTo(0.76, 6);
    expect(result.massPerArea).toBeCloseTo(15.8132, 4);
    expect(result.massPerPiece).toBeCloseTo(31.63, 2);
  });

  it("tempered glass weighs exactly what annealed glass of the same makeup does — density is untouched", () => {
    // area = 0.900×2.100 = 1.890 m²; massPerArea = 2.5×10 = 25.000 kg/m²;
    // massPerPiece = 1.890×25 = 47.25 kg; total (6 pieces, from UNROUNDED per-piece) = 283.50 kg.
    const result = glassPaneWeight({
      width: 900,
      height: 2100,
      composition: "monolithic",
      plyThicknesses: [10],
      pieces: 6,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.massPerPiece).toBeCloseTo(47.25, 2);
    expect(result.totalMass).toBeCloseTo(283.5, 2);
  });

  it("refuses an empty ply list rather than pricing the pane at 0 kg", () => {
    expect(
      glassPaneWeight({ width: 1000, height: 1000, composition: "monolithic", plyThicknesses: [] }),
    ).toEqual({ ok: false, reason: "plyThicknesses" });
  });

  it("refuses dimensions outside 50–6000 mm", () => {
    expect(
      glassPaneWeight({ width: 10, height: 1000, composition: "monolithic", plyThicknesses: [4] }),
    ).toEqual({ ok: false, reason: "width" });
  });

  it("(life-safety) never returns a verdict, a handling class or a person count", () => {
    const result = glassPaneWeight({
      width: 1600,
      height: 2400,
      composition: "insulated",
      plyThicknesses: [4, 4],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result).not.toHaveProperty("safe");
    expect(result).not.toHaveProperty("handlingClass");
    expect(result).not.toHaveProperty("personsRequired");
    expect(result).not.toHaveProperty("status");
  });
});

/* -----------------------------------------------------------------------
 * iso-286-fits
 * -------------------------------------------------------------------- */

describe("iso286Fit", () => {
  it("Ø40 H7/g6: 40.000/40.025 mm hole, 39.975/39.991 mm shaft, mean clearance 29.5 µm", () => {
    // 40 → range 30–50: IT7 = 25 µm, IT6 = 16 µm, es(g) = −9 µm.
    // Hole: EI=0 → 40.000, ES=+25 → 40.025. Shaft: es=−9 → 39.991, ei=−9−16=−25 → 39.975.
    // Zmax = 25−(−25) = 50 µm; Zmin = 0−(−9) = 9 µm; mean = (50+9)/2 = 29.5 µm.
    const result = iso286Fit({ nominalSize: 40, holeGrade: 7, shaftLetter: "g", shaftGrade: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hole.maxSize).toBeCloseTo(40.025, 6);
    expect(result.hole.minSize).toBeCloseTo(40.0, 6);
    expect(result.shaft.maxSize).toBeCloseTo(39.991, 6);
    expect(result.shaft.minSize).toBeCloseTo(39.975, 6);
    expect(result.maxClearance).toBe(50);
    expect(result.minClearance).toBe(9);
    expect(result.meanClearance).toBe(29.5);
    expect(result.fitDesignation).toBe("H7/g6");
  });

  it("Ø25 H7/h6: contact without clearance (Zmin = 0) is the meaning of an h shaft", () => {
    // 25 → range 18–30: IT7 = 21 µm, IT6 = 13 µm, es(h) = 0.
    const result = iso286Fit({ nominalSize: 25, holeGrade: 7, shaftLetter: "h", shaftGrade: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shaft.upperDeviation).toBe(0);
    expect(result.shaft.lowerDeviation).toBe(-13);
    expect(result.maxClearance).toBe(34); // 21 − (−13)
    expect(result.minClearance).toBe(0); // 0 − 0
  });

  it("the first range is closed at BOTH ends: D=1 still resolves, IT7 = 10 µm", () => {
    const result = iso286Fit({ nominalSize: 1, holeGrade: 7, shaftLetter: "h", shaftGrade: 6 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hole.toleranceWidth).toBe(10);
  });

  it("a half-millimetre step across a range boundary jumps IT7 by 4 µm — the table, not a bug", () => {
    const at30 = iso286Fit({ nominalSize: 30, holeGrade: 7, shaftLetter: "h", shaftGrade: 6 });
    const at305 = iso286Fit({ nominalSize: 30.5, holeGrade: 7, shaftLetter: "h", shaftGrade: 6 });
    expect(at30.ok && at30.hole.toleranceWidth).toBe(21); // 18–30 row
    expect(at305.ok && at305.hole.toleranceWidth).toBe(25); // 30–50 row
  });

  it("a manually entered deviation can overlap — the clearance prints negative, with no refusal and no verdict", () => {
    const result = iso286Fit({
      nominalSize: 40,
      holeDeviations: { upper: 25, lower: 0 },
      shaftDeviations: { upper: 30, lower: 10 }, // shaft's minimum size EXCEEDS the hole's maximum
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.maxClearance).toBe(15); // 25 − 10
    expect(result.minClearance).toBe(-30); // 0 − 30 — interference
    expect(result).not.toHaveProperty("passes");
    expect(result.fitDesignation).toBeUndefined();
  });

  it("refuses a nominal size outside 1–500, a missing shaft specification, and an inverted manual deviation", () => {
    expect(iso286Fit({ nominalSize: 0, shaftLetter: "g", shaftGrade: 6 })).toEqual({
      ok: false,
      reason: "nominalSize",
    });
    expect(iso286Fit({ nominalSize: 40, holeGrade: 7 })).toEqual({
      ok: false,
      reason: "shaftLetter",
    });
    expect(
      iso286Fit({ nominalSize: 40, holeDeviations: { upper: 0, lower: 25 }, shaftLetter: "h", shaftGrade: 6 }),
    ).toEqual({ ok: false, reason: "holeDeviations" });
  });
});

/* -----------------------------------------------------------------------
 * linear-cutting-stock
 * -------------------------------------------------------------------- */

describe("linearCuttingStock", () => {
  it("6 m bar, 3.2 mm kerf: FFD hits the theoretical lower bound of 3 bars", () => {
    // Sorted desc: 1800×4, 1200×3, 900×5. Bar1: three 1800s fit (4th needs 1803.2 > 590.4 left).
    // Bar2: the leftover 1800 + three 1200s. Bar3: five 900s.
    const result = linearCuttingStock({
      items: [
        { length: 1800, count: 4 },
        { length: 1200, count: 3 },
        { length: 900, count: 5 },
      ],
      barLength: 6000,
      kerf: 3.2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.barCount).toBe(3);
    expect(result.bars[0]?.pieces).toHaveLength(3);
    expect(result.bars[0]?.remainder).toBeCloseTo(590.4, 6);
    expect(result.bars[1]?.pieces).toHaveLength(4);
    expect(result.bars[1]?.remainder).toBeCloseTo(587.2, 6);
    expect(result.bars[2]?.pieces).toHaveLength(5);
    expect(result.bars[2]?.remainder).toBeCloseTo(1484.0, 6);
    expect(result.totalCutLength).toBeCloseTo(15300, 6);
    expect(result.wasteIncludingUsable).toBeCloseTo(2700, 6);
    expect(result.wasteIncludingUsablePercent).toBeCloseTo(15.0, 6);
    // LB = ceil((15300 + 12×3.2) / 6000) = ceil(15338.4/6000) = ceil(2.5564) = 3 — FFD hit it.
    expect(result.lowerBoundBars).toBe(3);
  });

  it("splits remnants into usable and waste at the user's own threshold, instead of one waste figure", () => {
    // Same bars as above; remainders 590.4, 587.2, 1484.0. At a 1000 mm threshold
    // only the 1484.0 mm remnant is usable.
    const result = linearCuttingStock({
      items: [
        { length: 1800, count: 4 },
        { length: 1200, count: 3 },
        { length: 900, count: 5 },
      ],
      barLength: 6000,
      kerf: 3.2,
      minUsableRemnant: 1000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bars[0]?.remainderUsable).toBe(false);
    expect(result.bars[1]?.remainderUsable).toBe(false);
    expect(result.bars[2]?.remainderUsable).toBe(true);
    expect(result.usableRemnantLength).toBeCloseTo(1484.0, 6);
    // wasteExcluding = 2700 − 1484 = 1216.0 mm; percent = 1216/18000×100 = 6.7556%.
    expect(result.wasteExcludingUsable).toBeCloseTo(1216.0, 3);
    expect(result.wasteExcludingUsablePercent).toBeCloseTo(6.7556, 3);
  });

  it("start-of-bar trim: 25 mm damaged end, 4 mm kerf — 2 bars, 35 % waste, checked against trim+kerf+remnants", () => {
    // U = 3000−25 = 2975. Bar1: four 700s (2975→2271→1567→863→159); a 550 needs 554 > 159.
    // Bar2: two 550s (2975→2421→1867).
    const result = linearCuttingStock({
      items: [
        { length: 700, count: 4 },
        { length: 550, count: 2 },
      ],
      barLength: 3000,
      kerf: 4,
      startWaste: 25,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.barCount).toBe(2);
    expect(result.bars[0]?.pieces).toHaveLength(4);
    expect(result.bars[0]?.remainder).toBeCloseTo(159.0, 6);
    expect(result.bars[1]?.remainder).toBeCloseTo(1867.0, 6);
    expect(result.wasteIncludingUsablePercent).toBeCloseTo(35.0, 6);
    // Check: 2×25 trim + 6×4 kerf + (159.0+1867.0) remnants = 50+24+2026 = 2100.0 mm.
    expect(result.wasteIncludingUsable).toBeCloseTo(2100.0, 6);
    expect(result.lowerBoundBars).toBe(2);
  });

  it("refuses a piece that can never fit even an empty bar, BEFORE the FFD loop runs", () => {
    const result = linearCuttingStock({
      items: [{ length: 1998, count: 1 }],
      barLength: 2000,
      kerf: 5,
    });
    expect(result).toEqual({ ok: false, reason: "length:0" });
  });

  it("refuses a usable length at or below zero — trim alone consuming the whole bar", () => {
    const result = linearCuttingStock({
      items: [{ length: 10, count: 1 }],
      barLength: 100,
      kerf: 0,
      startWaste: 60,
      endWaste: 60,
    });
    expect(result).toEqual({ ok: false, reason: "usableLength" });
  });
});

/* -----------------------------------------------------------------------
 * mitre-angles
 * -------------------------------------------------------------------- */

describe("mitreAngles", () => {
  it("regular hexagon, flat frame: 30.00° saw setting, and the corrected length uses cos(0)=1", () => {
    // θ = (6−2)×180/6 = 120.00°; m0 = 90−60 = 30.00°.
    // M = atan(cos0°·tan30°) = 30.00°; T = asin(sin0°·cos30°) = 0.00°.
    // outside = 200 + 2×40×cos0°×tan30° = 200 + 80×0.5773503 = 246.19 mm.
    const result = mitreAngles({ sides: 6, pieceWidth: 40, insideLength: 200 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.baseAngle).toBeCloseTo(120.0, 6);
    expect(result.m0).toBeCloseTo(30.0, 6);
    expect(result.simpleMitre).toBeCloseTo(60.0, 6);
    expect(result.sawMitreAngle).toBeCloseTo(30.0, 3);
    expect(result.sawMitreComplement).toBeCloseTo(60.0, 3);
    expect(result.sawBevelAngle).toBeCloseTo(0.0, 6);
    expect(result.outsideLength).toBeCloseTo(246.19, 2);
    expect(result.lengthToShortPoint).toBe(200);
    expect(result.centeredMeasure).toBe("outside width");
  });

  it("crown moulding, 90° corner, 38° spring angle: B = 52°, mitre 31.62°, bevel 33.86°", () => {
    const result = mitreAngles({ baseAngle: 90, springAngle: 38 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slopeUsed).toBe(52);
    expect(result.sawMitreAngle).toBeCloseTo(31.62, 2);
    expect(result.sawBevelAngle).toBeCloseTo(33.86, 2);
  });

  it("a leaning side needs the width PROJECTED through the slope — cos(B), not w alone", () => {
    // 4 sides, slope 15°: m0 = 45°, tan45° = 1.
    // Corrected: 200 + 2×40×cos15°×1 = 200 + 80×0.9659258 = 277.27 mm.
    // (An UNcorrected formula, skipping cos15°, would have given 280.00 mm.)
    const result = mitreAngles({ sides: 4, slope: 15, pieceWidth: 40, insideLength: 200 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sawMitreAngle).toBeCloseTo(44.01, 2);
    expect(result.sawBevelAngle).toBeCloseTo(10.55, 2);
    expect(result.outsideLength).toBeCloseTo(277.27, 1);
    expect(result.outsideLength).not.toBeCloseTo(280.0, 1);
  });

  it("spring angle 45° is its own worked check: M=35.26°, T=30.00° — the 38/52 mix-up this guards against", () => {
    const result = mitreAngles({ baseAngle: 90, springAngle: 45 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.slopeUsed).toBe(45);
    expect(result.sawMitreAngle).toBeCloseTo(35.26, 2);
    expect(result.sawBevelAngle).toBeCloseTo(30.0, 2);
  });

  it("names the length past m0 ≥ 85° instead of withholding it — tan(87.5°) ≈ 22.9038", () => {
    // baseAngle = 5° → m0 = 90 − 2.5 = 87.5° ≥ 85°: lengthsAvailable is now
    // only a caution, not a gate. outside = 200 + 2×40×cos0°×22.9038 = 2032.3.
    // (The old behaviour withheld this as `undefined` — the review clause
    // requires it named, however impractical the resulting cut is.)
    const result = mitreAngles({ baseAngle: 5, pieceWidth: 40, insideLength: 200 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lengthsAvailable).toBe(false);
    expect(result.tanM0).toBeGreaterThan(20); // tan(87.5°) ≈ 22.90
    expect(result.outsideLength).toBeCloseTo(2032.3, 0);
    expect(result.lengthToShortPoint).toBe(200);
  });

  it("refuses ONE of pieceWidth/insideLength given alone, even past m0 ≥ 85° where lengths used to be skipped", () => {
    expect(mitreAngles({ sides: 6, pieceWidth: 40 })).toEqual({ ok: false, reason: "insideLength" });
    expect(mitreAngles({ sides: 6, insideLength: 200 })).toEqual({ ok: false, reason: "pieceWidth" });
    // Past 85° the old code never even validated these — a 1000 mm piece
    // width (max is 500) must now be refused there too, not silently ignored.
    expect(mitreAngles({ baseAngle: 5, pieceWidth: 1000, insideLength: 200 })).toEqual({
      ok: false,
      reason: "pieceWidth",
    });
  });

  it("refuses giving neither sides nor a base angle, and both at once", () => {
    expect(mitreAngles({})).toEqual({ ok: false, reason: "sides" });
    expect(mitreAngles({ sides: 6, baseAngle: 100 })).toEqual({ ok: false, reason: "sides" });
  });

  it("refuses a degenerate slope and an out-of-range side count", () => {
    expect(mitreAngles({ sides: 6, slope: 90 })).toEqual({ ok: false, reason: "slope" });
    expect(mitreAngles({ sides: 2 })).toEqual({ ok: false, reason: "sides" });
  });
});

/* -----------------------------------------------------------------------
 * mortar-mix-quantity
 * -------------------------------------------------------------------- */

describe("mortarMixQuantity", () => {
  it("premixed render, 45.00 m² at 20 mm, 8% waste: 1555.2 kg, 63 bags, 19.8 kg surplus", () => {
    // m = 45.00×1.08×1.6×20 = 48.60×32 = 1555.2 kg; bags = ceil(1555.2/25) = 63.
    // water = 1555.2×0.16 = 248.832 → 248.83 l. fresh V = 45.00×0.020×1.08 = 0.9720 m³.
    const result = mortarMixQuantity({
      mode: "premixed",
      area: 45,
      thickness: 20,
      waste: 8,
      consumption: 1.6,
      bagMass: 25,
      waterPerKg: 0.16,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.mode !== "premixed") return;
    expect(result.mass).toBeCloseTo(1555.2, 3);
    expect(result.bags).toBe(63);
    expect(result.bagSurplus).toBeCloseTo(19.8, 3);
    expect(result.water).toBeCloseTo(248.83, 2);
    expect(result.freshVolume).toBeCloseTo(0.972, 4);
    expect(result.consumptionUnitUsed).toBe("perM2mm"); // the default — echoed, not left implicit
  });

  it("a coverage rate entered as kg/m³ converts the same as kg/(m²·mm) — 1600 kg/m³ = 1.6 kg/(m²·mm)", () => {
    const result = mortarMixQuantity({
      mode: "premixed",
      area: 45,
      thickness: 20,
      waste: 8,
      consumption: 1600,
      consumptionUnit: "perM3",
      bagMass: 25,
      waterPerKg: 0.16,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.mode !== "premixed") return;
    expect(result.consumptionUsed).toBeCloseTo(1.6, 6);
    expect(result.mass).toBeCloseTo(1555.2, 3);
    // The unit as ENTERED (perM3), not the perM2mm it was converted to.
    expect(result.consumptionUnitUsed).toBe("perM3");
  });

  it("on-site 1:4 mix, 18.00 m² at 25 mm, 10% waste, packing factor 1.30: 8 binder bags, 99.10 l water", () => {
    // V = 18.00×0.025 = 0.4500; ×1.10 = 0.4950; Vs = 0.4950×1.30 = 0.6435.
    // Vbinder = 0.6435/5 = 0.1287; Vaggregate = 0.6435×4/5 = 0.5148.
    // massBinder = 0.1287×1400 = 180.18 kg; bags = ceil(180.18/25) = 8, surplus = 19.82 kg.
    // massAggregate = 0.5148×1500 = 772.20 kg. water = 0.55×180.18 = 99.099 → 99.10 l.
    const result = mortarMixQuantity({
      mode: "onsite",
      area: 18,
      thickness: 25,
      waste: 10,
      packingFactor: 1.3,
      ratio: 4,
      binderDensity: 1400,
      aggregateDensity: 1500,
      waterCementRatio: 0.55,
      bagMass: 25,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.mode !== "onsite") return;
    expect(result.compactedVolume).toBeCloseTo(0.6435, 4);
    expect(result.binderVolume).toBeCloseTo(0.1287, 4);
    expect(result.aggregateVolume).toBeCloseTo(0.5148, 4);
    expect(result.binderMass).toBeCloseTo(180.18, 2);
    expect(result.binderBags).toBe(8);
    expect(result.binderBagSurplus).toBeCloseTo(19.82, 2);
    expect(result.aggregateMass).toBeCloseTo(772.2, 2);
    expect(result.waterTheoretical).toBeCloseTo(99.099, 3);
    expect(result.water).toBeCloseTo(99.1, 2);
    // Ingredient volumes sum back to the compacted volume: 0.1287+0.5148 = 0.6435.
    expect(result.binderVolume + result.aggregateVolume).toBeCloseTo(result.compactedVolume, 6);
  });

  it("wet aggregate supplies some of the mix water, and is never allowed to push it negative", () => {
    // moistureWater = 772.20 × 0.03 = 23.166 kg; water = 99.099 − 23.166 = 75.933 → 75.93 l.
    const some = mortarMixQuantity({
      mode: "onsite",
      area: 18,
      thickness: 25,
      waste: 10,
      packingFactor: 1.3,
      ratio: 4,
      binderDensity: 1400,
      aggregateDensity: 1500,
      waterCementRatio: 0.55,
      bagMass: 25,
      aggregateMoisture: 3,
    });
    expect(some.ok).toBe(true);
    if (!some.ok || some.mode !== "onsite") return;
    expect(some.aggregateMoistureWater).toBeCloseTo(23.166, 2);
    expect(some.water).toBeCloseTo(75.93, 2);

    // At 60% moisture the aggregate alone supplies more than the ratio calls for.
    const flooded = mortarMixQuantity({
      mode: "onsite",
      area: 18,
      thickness: 25,
      waste: 10,
      packingFactor: 1.3,
      ratio: 4,
      binderDensity: 1400,
      aggregateDensity: 1500,
      waterCementRatio: 0.55,
      bagMass: 25,
      aggregateMoisture: 60,
    });
    expect(flooded.ok && flooded.mode === "onsite" && flooded.water).toBe(0);
  });

  it("a mixer batch size splits the recipe into whole batches with a per-batch recipe", () => {
    // Vs = 0.6435 m³ = 643.5 l. batches = ceil(643.5/200) = 4.
    const result = mortarMixQuantity({
      mode: "onsite",
      area: 18,
      thickness: 25,
      waste: 10,
      packingFactor: 1.3,
      ratio: 4,
      binderDensity: 1400,
      aggregateDensity: 1500,
      waterCementRatio: 0.55,
      bagMass: 25,
      mixerVolume: 200,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.mode !== "onsite") return;
    expect(result.batches).toBe(4);
    expect(result.batchBinderMass).toBeCloseTo(180.18 / 4, 3);
    expect(result.batchAggregateVolume).toBeCloseTo(0.5148 / 4, 4);
  });

  it("refuses neither area/thickness nor a direct volume, and a packing factor below 1", () => {
    expect(
      mortarMixQuantity({ mode: "onsite", waste: 0, packingFactor: 1.2, ratio: 4, binderDensity: 1400, aggregateDensity: 1500, waterCementRatio: 0.5, bagMass: 25 }),
    ).toEqual({ ok: false, reason: "area" });
    expect(
      mortarMixQuantity({
        mode: "onsite",
        area: 10,
        thickness: 20,
        waste: 0,
        packingFactor: 0.9,
        ratio: 4,
        binderDensity: 1400,
        aggregateDensity: 1500,
        waterCementRatio: 0.5,
        bagMass: 25,
      }),
    ).toEqual({ ok: false, reason: "packingFactor" });
  });
});

/* -----------------------------------------------------------------------
 * panel-cutting-yield
 * -------------------------------------------------------------------- */

describe("panelCuttingYield", () => {
  it("2800×2070 panel, 10 mm trim, 600×400 piece, 4 mm kerf: 20/panel, 82.82% yield, 19 cuts / 15.75 m", () => {
    // A'=2780, B'=2050. Position1: n1=floor(2784/604)=4, m1=floor(2054/404)=5 → 20.
    // Position2: n2=floor(2784/404)=6, m2=floor(2054/604)=3 → 18. Strips contribute 0 either way.
    // mainCuts = (4−1) + 4×(5−1) = 3+16 = 19 cuts; length = 3×2050 + 16×600 = 6150+9600 = 15750 mm = 15.75 m.
    const result = panelCuttingYield({
      panelWidth: 2800,
      panelHeight: 2070,
      pieceWidth: 600,
      pieceHeight: 400,
      piecesNeeded: 90,
      kerf: 4,
      edgeTrim: 10,
      grainMandatory: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.piecesPerPanel).toBe(20);
    expect(result.panelsNeeded).toBe(5);
    expect(result.leftoverOnLastPanel).toBe(10);
    expect(result.yieldPercent).toBeCloseTo(82.82, 2);
    expect(result.wasteArea).toBeCloseTo(0.996, 3);
    expect(result.cutCount).toBe(19);
    expect(result.cutLength).toBeCloseTo(15.75, 3);
    expect(result.totalCutLength).toBeCloseTo(78.75, 3);
  });

  it("2500×1250 panel, no trim, 800×300 piece, 3 mm kerf: 12/panel, 92.16% yield", () => {
    // Position1: n1=floor(2503/803)=3, m1=floor(1253/303)=4 → 12. Position2 gives only 8.
    const result = panelCuttingYield({
      panelWidth: 2500,
      panelHeight: 1250,
      pieceWidth: 800,
      pieceHeight: 300,
      piecesNeeded: 1,
      kerf: 3,
      grainMandatory: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.piecesPerPanel).toBe(12);
    expect(result.yieldPercent).toBeCloseTo(92.16, 2);
    expect(result.cutCount).toBe(11); // (3-1) + 3×(4-1)
    expect(result.cutLength).toBeCloseTo(9.7, 2);
  });

  it("mandatory grain direction: the SAME piece turned 90° yields fewer pieces, and the tool cannot recover the difference", () => {
    // 1000×600 panel, no trim, no kerf, 300×200 piece.
    // Position1 (a=300,b=200): n1=floor(1000/300)=3, m1=floor(600/200)=3 → grid 9;
    //   rA=1000-900=100, rB=600-600=0 — rB is exactly zero, so no strip recovers anything: total 9.
    // Position2 (a=200,b=300, the piece rotated 90°): n1=floor(1000/200)=5, m1=floor(600/300)=2 → 10,
    //   rA=1000-1000=0, rB=600-600=0 — an exact tiling: total 10.
    // Unrestricted, the tool picks the better orientation (10). Grain-mandatory locks it to
    // position1 only (9) — the SAME piece, one fewer per panel, with no strip left to recover it.
    const base = {
      panelWidth: 1000,
      panelHeight: 600,
      pieceWidth: 300,
      pieceHeight: 200,
      piecesNeeded: 1,
      kerf: 0,
    } as const;
    const unrestricted = panelCuttingYield({ ...base, grainMandatory: false });
    expect(unrestricted.ok).toBe(true);
    if (!unrestricted.ok) return;
    expect(unrestricted.piecesPerPanel).toBe(10);

    const mandatory = panelCuttingYield({ ...base, grainMandatory: true });
    expect(mandatory.ok).toBe(true);
    if (!mandatory.ok) return;
    expect(mandatory.piecesPerPanel).toBe(9);
  });

  it("an exactly-consumed right strip is reported EMPTY, not as an intact remnant on top of the piece cut from it", () => {
    // 250×100 panel, no trim, no kerf, 100×50 piece, grain locked to position1.
    // grid: n1=floor(250/100)=2, m1=floor(100/50)=2 → 4. rA=250−200=50, rB=100−100=0.
    // Right strip (50×100) rotated: nRd=floor(50/50)=1, mRd=floor(100/100)=1 → 1 extra
    // piece that is EXACTLY 50×100 — the whole strip, leaving width 0 behind it.
    // total = 5 pieces × (100×50) = 25 000 mm² = the WHOLE 250×100 panel: exact tiling.
    const result = panelCuttingYield({
      panelWidth: 250,
      panelHeight: 100,
      pieceWidth: 100,
      pieceHeight: 50,
      piecesNeeded: 1,
      kerf: 0,
      grainMandatory: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.piecesPerPanel).toBe(5);
    expect(result.yieldPercent).toBeCloseTo(100, 6);
    expect(result.wasteArea).toBeCloseTo(0, 6);
    // The old code reported this strip at its full 50×100 = 0.0050 m² regardless —
    // double-counting the very area the 5th piece was just cut from.
    expect(result.rightStrip.width).toBeCloseTo(0, 6);
    expect(result.rightStrip.area).toBeCloseTo(0, 6);
  });

  it("refuses a piece that does not fit the usable panel in any position", () => {
    const result = panelCuttingYield({
      panelWidth: 500,
      panelHeight: 500,
      pieceWidth: 600,
      pieceHeight: 600,
      piecesNeeded: 1,
      kerf: 0,
      grainMandatory: true,
    });
    expect(result).toEqual({ ok: false, reason: "pieceWidth" });
  });

  it("refuses an edge trim that consumes the whole usable panel", () => {
    const result = panelCuttingYield({
      panelWidth: 300,
      panelHeight: 300,
      pieceWidth: 100,
      pieceHeight: 100,
      piecesNeeded: 1,
      kerf: 0,
      edgeTrim: 200,
    });
    expect(result).toEqual({ ok: false, reason: "edgeTrim" });
  });
});

/* -----------------------------------------------------------------------
 * sheet-metal-bend
 * -------------------------------------------------------------------- */

describe("sheetMetalBend", () => {
  it("one 90° bend: BA = 6.031858 mm, BD = 3.968142 mm, developed length 76.03 mm", () => {
    // BA = (π/180)×90×(3+0.42×2) = 1.5707963×3.84 = 6.031858.
    // setback = (3+2)×tan45° = 5.000; BD = 2×5.000−6.031858 = 3.968142.
    // tangents: 50−5=45, 30−5=25; L = 70 + 6.031858 = 76.031858.
    const result = sheetMetalBend({
      thickness: 2,
      radius: 3,
      angle: 90,
      kFactor: 0.42,
      legs: [50, 30],
      legsAs: "outer",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bendAllowance).toBeCloseTo(6.031858, 5);
    expect(result.setback).toBeCloseTo(5.0, 6);
    expect(result.bendDeduction).toBeCloseTo(3.968142, 5);
    expect(result.developedLength).toBeCloseTo(76.031858, 4);
    expect(result.bendLines[0]?.start).toBeCloseTo(45, 6);
    expect(result.bendLines[0]?.end).toBeCloseTo(51.031858, 4);
  });

  it("U-profile, two 90° bends: 174.79 mm developed, checked against the tangent-length method", () => {
    // BA = (π/180)×90×(1.5+0.44×1.5) = 1.5707963×2.16 = 3.392920 per bend.
    // setback = 3.000; BD = 2×3.000−3.392920 = 2.607080. tangents: 37, 94, 37.
    // L = 168 + 2×3.392920 = 174.785840.
    const result = sheetMetalBend({
      thickness: 1.5,
      radius: 1.5,
      angle: 90,
      kFactor: 0.44,
      legs: [40, 100, 40],
      legsAs: "outer",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bendAllowance).toBeCloseTo(3.39292, 4);
    expect(result.developedLength).toBeCloseTo(174.78584, 3);
    expect(result.bendLines).toHaveLength(2);
    expect(result.bendLines[0]?.start).toBeCloseTo(37, 6);
    expect(result.bendLines[1]?.end).toBeCloseTo(137.78584, 3);
    // Symmetric part: line 2's distance from the opposite edge mirrors line 1's from the start.
    expect(result.bendLines[1]?.startFromOppositeEdge).toBeCloseTo(result.bendLines[0]?.end ?? -1, 4);
  });

  it("refuses a leg shorter than the setback it must clear — before the tangent length goes negative", () => {
    // setback = 5.000; a 4 mm end leg cannot clear even one setback.
    const result = sheetMetalBend({
      thickness: 2,
      radius: 3,
      angle: 90,
      kFactor: 0.42,
      legs: [4, 30],
      legsAs: "outer",
    });
    expect(result).toEqual({ ok: false, reason: "legs:0" });
  });

  it("refuses a non-positive tangent leg when legs are given as tangent measures directly", () => {
    const result = sheetMetalBend({
      thickness: 2,
      radius: 3,
      angle: 90,
      kFactor: 0.42,
      legs: [45, 0],
      legsAs: "tangent",
    });
    expect(result).toEqual({ ok: false, reason: "legs:1" });
  });
});

describe("sheetMetalKFactorFromSample", () => {
  it("divides the shortfall by the bend count — a two-bend sample, not a one-bend approximation", () => {
    // setback = (1.5+1.5)×tan45° = 3.000. tangents 37,94,37 → Σ = 168.
    // shortfall = 175.50 − 168 = 7.50, per bend = 3.750.
    // K = (3.750/1.5707963 − 1.5)/1.5 = (2.387324 − 1.5)/1.5 = 0.591549 → out of the 0–0.5
    // catalogue range, printed as-is rather than clamped — the sample was mis-cut.
    const result = sheetMetalKFactorFromSample({
      thickness: 1.5,
      radius: 1.5,
      angle: 90,
      outerLegs: [40, 100, 40],
      measuredLength: 175.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kFactor).toBeCloseTo(0.591549, 4);
    expect(result.radiusToThickness).toBe(1);
  });

  it("refuses an outer leg too short to clear its own setback", () => {
    const result = sheetMetalKFactorFromSample({
      thickness: 1.5,
      radius: 1.5,
      angle: 90,
      outerLegs: [2, 100, 40],
      measuredLength: 175.5,
    });
    expect(result).toEqual({ ok: false, reason: "outerLegs:0" });
  });
});

/* -----------------------------------------------------------------------
 * shelf-deflection (life-safety)
 * -------------------------------------------------------------------- */

describe("shelfDeflection", () => {
  it("800 mm span, 300×18 mm, 40 kg UDL, E=3000: I=145 800 mm⁴, δ=5.9788 mm, σ=2.421 N/mm²", () => {
    // I = 300×18³/12 = 145 800 mm⁴. F = 40×9.80665 = 392.266 N → q = 392.266/800 = 0.4903325 N/mm.
    // δ = 5×0.4903325×800⁴/(384×3000×145800) = 1.0042010e12/1.679616e11 = 5.9788 mm.
    // M = q×800²/8 = 39226.6 Nmm; W = 300×18²/6 = 16200 mm³; σ = 39226.6/16200 = 2.421 N/mm².
    // R = q×800/2 = 196.133 N = 20.00 kg — exactly half the 40 kg load, as it must be.
    const result = shelfDeflection({
      span: 800,
      width: 300,
      thickness: 18,
      udlMass: 40,
      modulus: 3000,
      deflectionLimit: 800 / 300, // L/300 = 2.6667 mm
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inertia).toBe(145800);
    expect(result.distributedDeflection).toBeCloseTo(5.9788, 3);
    expect(result.maxMoment).toBeCloseTo(39226.6, 1);
    expect(result.stress).toBeCloseTo(2.421, 3);
    expect(result.reactionMass).toBeCloseTo(20.0, 2);
    // ratio = 5.9788/2.6667 = 2.2421 → the number's own worked value.
    expect(result.deflectionRatio).toBeCloseTo(2.2421, 3);
    expect(result.selfWeightDeflection).toBeUndefined(); // no shelfDensity/shelfMass given at all
  });

  it("splits totalDeflection into the shelf's OWN share and the placed load's share, and the two sum back", () => {
    // Same 800 mm / 300×18 mm / E=3000 shelf as above, PLUS its own weight
    // (density 700): selfMass = 0.300×0.018×0.800×700 = 3.024 kg.
    // qUdl = 392.266/800 = 0.4903325 N/mm (the udl-only q from the test above,
    // whose distributedDeflection was 5.9788 mm).
    // qSelf = 3.024×9.80665/800 = 29.65531/800 = 0.03706914 N/mm.
    // δSelf = 5×0.03706914×800⁴/(384×3000×145800) = 0.45199 mm.
    // δTotal(q = qUdl+qSelf) = 6.4308 mm = 5.9788 + 0.45199, exactly the sum.
    const result = shelfDeflection({
      span: 800,
      width: 300,
      thickness: 18,
      udlMass: 40,
      modulus: 3000,
      shelfDensity: 700,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selfWeightMass).toBeCloseTo(3.024, 6);
    expect(result.selfWeightDeflection).toBeCloseTo(0.45199, 3);
    expect(result.distributedDeflection).toBeCloseTo(6.4308, 3);
    expect(result.distributedDeflection - result.selfWeightDeflection!).toBeCloseTo(5.9788, 2);
  });

  it("a point load at the same span carries the SAME moment as an equal-mass UDL, but LESS deflection", () => {
    // F = 20×9.80665 = 196.133 N. δF = 196.133×800³/(48×3000×145800) = 4.7830 mm.
    // M = F×800/4 = 39226.6 Nmm — identical to the 40 kg UDL case above.
    const result = shelfDeflection({
      span: 800,
      width: 300,
      thickness: 18,
      udlMass: 0,
      pointLoadMass: 20,
      modulus: 3000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pointDeflection).toBeCloseTo(4.783, 3);
    expect(result.maxMoment).toBeCloseTo(39226.6, 1);
    expect(result.reactionMass).toBeCloseTo(10.0, 2); // 20 kg / 2
  });

  it("the shelf's own weight loads it even with nothing placed on it — density derives a self-weight deflection", () => {
    // volume = 0.2×0.02×1.0 = 0.004 m³; mass = 0.004×700 = 2.8 kg.
    // q = 2.8×9.80665/1000 = 0.02745862 N/mm.
    // δ = 5×0.02745862×1000⁴/(384×4000×133333.333) = 1.372931e11/2.048e11 = 0.670376 mm.
    // R = q×1000/2 = 13.72931 N = 1.4000 kg — exactly half the shelf's own 2.8 kg.
    const result = shelfDeflection({
      span: 1000,
      width: 200,
      thickness: 20,
      udlMass: 0,
      modulus: 4000,
      shelfDensity: 700,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.selfWeightMass).toBeCloseTo(2.8, 6);
    expect(result.totalDeflection).toBeCloseTo(0.670376, 4);
    expect(result.reactionMass).toBeCloseTo(1.4, 3);
    expect(result.spanOverDeflection).toBeDefined(); // load is nonzero even with nothing placed on it
  });

  it("withholds L/δ, without ever printing infinity, on a genuinely empty and weightless shelf", () => {
    const result = shelfDeflection({ span: 800, width: 300, thickness: 18, udlMass: 0, modulus: 3000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalDeflection).toBe(0);
    expect(result.spanOverDeflection).toBeUndefined();
  });

  it("(life-safety) reports the ratio only with a user limit, and never a verdict field", () => {
    const withLimit = shelfDeflection({
      span: 800,
      width: 300,
      thickness: 18,
      udlMass: 40,
      modulus: 3000,
      stressLimit: 10,
    });
    expect(withLimit.ok).toBe(true);
    if (!withLimit.ok) return;
    expect(withLimit.stressRatio).toBeCloseTo(0.2421, 3);
    expect(withLimit).not.toHaveProperty("passes");
    expect(withLimit).not.toHaveProperty("safe");
    expect(withLimit).not.toHaveProperty("status");

    const withoutLimit = shelfDeflection({ span: 800, width: 300, thickness: 18, udlMass: 40, modulus: 3000 });
    expect(withoutLimit.ok && withoutLimit.stressRatio).toBeUndefined();
    expect(withoutLimit.ok && withoutLimit.deflectionRatio).toBeUndefined();
  });

  it("refuses a non-positive span, width or modulus", () => {
    expect(shelfDeflection({ span: 0, width: 300, thickness: 18, udlMass: 40, modulus: 3000 })).toEqual({
      ok: false,
      reason: "span",
    });
    expect(shelfDeflection({ span: 800, width: 300, thickness: 18, udlMass: 40, modulus: 0 })).toEqual({
      ok: false,
      reason: "modulus",
    });
  });
});

/* -----------------------------------------------------------------------
 * shelf-spacing
 * -------------------------------------------------------------------- */

describe("shelfSpacing", () => {
  it("1800 mm, 4×18 mm shelves, equal clear openings: 345.6 mm each, snapped onto a 32 mm raster", () => {
    // U = 1800−72 = 1728; k=5; s=345.6. Positions: 345.6, 709.2, 1072.8, 1436.4.
    const result = shelfSpacing({
      innerHeight: 1800,
      shelfCount: 4,
      thickness: 18,
      mode: "equal-clear",
      snap: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usableHeight).toBe(1728);
    const expectedEdges = [345.6, 709.2, 1072.8, 1436.4];
    result.shelves.forEach((s, i) => expect(s.bottomEdge).toBeCloseTo(expectedEdges[i]!, 9));
    expect(result.clearOpenings.every((o) => Math.abs(o - 345.6) < 1e-9)).toBe(true);

    // Snapped, raster 32 mm, first hole at 37 mm — matches the hand-worked deviations.
    const snapped = shelfSpacing({
      innerHeight: 1800,
      shelfCount: 4,
      thickness: 18,
      mode: "equal-clear",
      raster: 32,
      firstHoleFromBottom: 37,
      snap: true,
    });
    expect(snapped.ok).toBe(true);
    if (!snapped.ok) return;
    expect(snapped.shelves.map((s) => s.snappedBottomEdge)).toEqual([357, 709, 1061, 1445]);
    const expectedDeviations = [11.4, -0.2, -11.8, 8.6];
    snapped.shelves.forEach((s, i) => expect(s.deviation).toBeCloseTo(expectedDeviations[i]!, 9));
    expect(snapped.snappedClearOpenings).toEqual([357, 334, 334, 366, 337]);
    expect(snapped.snappedClearOpenings?.reduce((a, b) => a + b, 0)).toBeCloseTo(1728, 6);
    expect(snapped.rasterUsed).toBe(32);
  });

  // The surface prints the raster beside the drilling positions, and it used to
  // print `proParse(rasterText) ?? 32` — its own copy of this default. Two
  // copies agree until one moves, and this is a number somebody drills to.
  it("returns the raster it applied, including the one the caller never typed", () => {
    const base = {
      innerHeight: 1800,
      shelfCount: 4,
      thickness: 18,
      mode: "equal-clear",
      firstHoleFromBottom: 37,
      snap: true,
    } as const;
    const defaulted = shelfSpacing(base);
    expect(defaulted.ok).toBe(true);
    if (!defaulted.ok) return;
    expect(defaulted.rasterUsed).toBe(32);

    const explicit = shelfSpacing({ ...base, raster: 25 });
    expect(explicit.ok).toBe(true);
    if (!explicit.ok) return;
    expect(explicit.rasterUsed).toBe(25);

    // Nothing snapped, nothing to state — and `undefined` rather than 32, which
    // would be a raster the arithmetic never touched.
    const unsnapped = shelfSpacing({ ...base, snap: false });
    expect(unsnapped.ok).toBe(true);
    if (!unsnapped.ok) return;
    expect(unsnapped.rasterUsed).toBeUndefined();
  });

  it("derives shelf count from the user's own maximum clear opening: 5 shelves at 350 mm max", () => {
    // n = ceil((2100−350)/(18+350)) = ceil(1750/368) = ceil(4.7554) = 5; s = 2010/6 = 335.0.
    const result = shelfSpacing({
      innerHeight: 2100,
      maxClearOpening: 350,
      thickness: 18,
      mode: "equal-clear",
      snap: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shelfCount).toBe(5);
    expect(result.clearOpenings[0]).toBeCloseTo(335.0, 6);
  });

  it("given a fixed bottom opening: the remaining openings share what's left, each 307.0 mm", () => {
    // U = 1728; s = (1728−500)/4 = 307.0. Positions 500, 825, 1150, 1475.
    const result = shelfSpacing({
      innerHeight: 1800,
      shelfCount: 4,
      thickness: 18,
      mode: "given-first",
      firstOpeningHeight: 500,
      snap: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shelves.map((s) => s.bottomEdge)).toEqual([500, 825, 1150, 1475]);
    expect(result.clearOpenings[4]).toBeCloseTo(307.0, 6);
  });

  it("equal-axis spacing gives HALF-gaps at the ends and FULL gaps in the middle, not one shared number", () => {
    // p = 1000/4 = 250. End gaps = p−t/2 = 240; middle gaps = p−t = 230.
    const result = shelfSpacing({
      innerHeight: 1000,
      shelfCount: 3,
      thickness: 20,
      mode: "equal-axis",
      snap: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clearOpenings).toEqual([240, 230, 230, 240]);
  });

  it("shelfCount = 0 gives ONE opening equal to the whole usable height, not two", () => {
    // U = H − 0×t = 1800. There is no shelf 0, so there is no floor-to-shelf-0
    // opening AND a separate shelf-0-to-top opening — just the one span.
    const result = shelfSpacing({
      innerHeight: 1800,
      shelfCount: 0,
      thickness: 18,
      mode: "equal-clear",
      snap: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usableHeight).toBe(1800);
    expect(result.shelves).toHaveLength(0);
    expect(result.clearOpenings).toEqual([1800]);
  });

  it("refuses a shelf count with no room to fit, and a given-first opening at or past the usable height", () => {
    expect(
      shelfSpacing({ innerHeight: 100, shelfCount: 10, thickness: 18, mode: "equal-clear", snap: false }),
    ).toEqual({ ok: false, reason: "usableHeight" });
    expect(
      shelfSpacing({
        innerHeight: 1800,
        shelfCount: 4,
        thickness: 18,
        mode: "given-first",
        firstOpeningHeight: 2000,
        snap: false,
      }),
    ).toEqual({ ok: false, reason: "firstOpeningHeight" });
  });

  it("refuses snap=true without the user's own first-hole measurement — there is no default", () => {
    const result = shelfSpacing({
      innerHeight: 1800,
      shelfCount: 4,
      thickness: 18,
      mode: "equal-clear",
      snap: true,
    });
    expect(result).toEqual({ ok: false, reason: "firstHoleFromBottom" });
  });
});

/* -----------------------------------------------------------------------
 * tap-drill-size
 * -------------------------------------------------------------------- */

describe("tapDrillSize", () => {
  it("M8, coarse pitch auto-filled, 75% engagement: drill 6.782 mm, core 6.6468 mm", () => {
    // P = 1.25 (ISO 261 coarse for M8). d = 8 − 0.75×1.299038×1.25 = 8−1.2178481 = 6.782 mm.
    // D1 = 8 − 1.082532×1.25 = 8−1.353165 = 6.6468 mm.
    const result = tapDrillSize({ nominalDiameter: 8, desiredEngagement: 75 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pitchUsed).toBe(1.25);
    expect(result.pitchSource).toBe("coarse-auto");
    expect(result.engagementUsed).toBe(75);
    expect(result.drillDiameter).toBeCloseTo(6.782, 3);
    expect(result.coreDiameter).toBeCloseTo(6.6468, 4);
    // Own drill 6.8 mm: h = 100×1.2/1.6237975 = 73.90%; depth = 0.600 mm.
    const withOwn = tapDrillSize({ nominalDiameter: 8, desiredEngagement: 75, ownDrillDiameter: 6.8 });
    expect(withOwn.ok && withOwn.ownDrillEngagement).toBeCloseTo(73.9, 1);
    expect(withOwn.ok && withOwn.ownDrillThreadDepth).toBeCloseTo(0.6, 3);
    expect(withOwn.ok && withOwn.passHoleDiameter).toBe(9.0); // medium series, D=8
  });

  it("a drill diameter not below the core, at exactly 100% engagement, is D1 exactly", () => {
    // M6, P=1.0 (coarse): d(100%) = 6 − 1.299038 = 4.701; D1 = 6 − 1.082532 = 4.9175 — D1 > d(100%).
    const result = tapDrillSize({ nominalDiameter: 6, desiredEngagement: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.engagementUsed).toBe(100);
    expect(result.drillDiameter).toBeCloseTo(4.701, 3);
    expect(result.coreDiameter).toBeCloseTo(4.9175, 4);
    expect(result.coreDiameter).toBeGreaterThan(result.drillDiameter);
  });

  it("engagementUsed echoes the 75% DEFAULT when desiredEngagement is left out — not just when it is given", () => {
    const result = tapDrillSize({ nominalDiameter: 8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.engagementUsed).toBe(75);
  });

  it("minimum blind-hole depth is the AXIAL thread depth plus n_zahoda·P — not the radial threadDepthPerSide", () => {
    // M8, coarse P=1.25, threadDepth=16 (the depth of full thread wanted),
    // chamferedThreads=3: minBlindHoleDepth = 16 + 3×1.25 = 19.75 mm.
    // (threadDepthPerSide, the (D−d)/2 radial figure, is 0.6089 mm here — using
    // IT for this sum would have reported 4.359 mm, short by a whole thread depth.)
    const result = tapDrillSize({ nominalDiameter: 8, chamferedThreads: 3, threadDepth: 16 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.threadDepthPerSide).toBeCloseTo(0.6089, 3);
    expect(result.minBlindHoleDepth).toBeCloseTo(19.75, 6);
  });

  it("refuses chamferedThreads or threadDepth given without the other — a blind-hole depth needs both", () => {
    expect(tapDrillSize({ nominalDiameter: 8, chamferedThreads: 3 })).toEqual({
      ok: false,
      reason: "threadDepth",
    });
    expect(tapDrillSize({ nominalDiameter: 8, threadDepth: 16 })).toEqual({
      ok: false,
      reason: "chamferedThreads",
    });
  });

  it("the review's own ISO 273 rows (1.6, 2, 2.5, 3.5, 18, 22, 27, 30 mm) now return a pass-hole diameter", () => {
    // M18, medium series: table 2 of ISO 273:1979 gives 20 mm — the row this
    // review clause required and the earlier table deliberately left blank.
    const result = tapDrillSize({ nominalDiameter: 18 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.passHoleDiameter).toBe(20);
    const fine = tapDrillSize({ nominalDiameter: 1.6, passHoleSeries: "fine" });
    expect(fine.ok && fine.passHoleDiameter).toBe(1.7);
  });

  it("an untabulated diameter (formula still applies) leaves the pass-hole field empty rather than estimating it", () => {
    // D=6.35 mm, P=1.27 mm — the underlying formula (from the metric derivation) works
    // at any D/P, but 6.35 has no ISO 273 row in the embedded, deliberately incomplete table.
    // d(75%) = 6.35 − 0.75×1.299038×1.27 = 6.35−1.237334 = 5.113 mm.
    const result = tapDrillSize({ nominalDiameter: 6.35, pitch: 1.27, desiredEngagement: 75 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drillDiameter).toBeCloseTo(5.113, 3);
    expect(result.passHoleDiameter).toBeUndefined();
    expect(result.pitchSource).toBe("custom");
  });

  it("refuses ownDrillDiameter at or above the nominal diameter — that is a zero-or-below engagement", () => {
    const result = tapDrillSize({ nominalDiameter: 8, ownDrillDiameter: 8 });
    expect(result).toEqual({ ok: false, reason: "ownDrillDiameter" });
  });

  it("refuses a diameter outside 1.6–30 mm, and one with no coarse-pitch table entry and no explicit pitch", () => {
    expect(tapDrillSize({ nominalDiameter: 1 })).toEqual({ ok: false, reason: "nominalDiameter" });
    expect(tapDrillSize({ nominalDiameter: 6.35 })).toEqual({ ok: false, reason: "pitch" });
  });
});

/* -----------------------------------------------------------------------
 * timber-volume
 * -------------------------------------------------------------------- */

describe("timberVolume", () => {
  it("Huber vs Smalian, both debarked, on the SAME log: Smalian reads higher, and the gap is named", () => {
    // Bark 1 cm each side: d1'=32, d2'=40. A1=π×0.16²=0.0804248, A2=π×0.20²=0.1256637.
    // mean=0.1030443; V = 0.1030443×4.20 = 0.4327858 m³.
    const result = timberVolume({
      mode: { kind: "huber-smalian", meanDiameter: 38, d1: 34, d2: 42, length: 4.2 },
      barkThickness: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.smalianVolume).toBeCloseTo(0.4327858, 5);
    // taper is measured on the AS-MEASURED diameters, before debarking: (42−34)/4.20.
    expect(result.taper).toBeCloseTo(1.904762, 4);
  });

  it("Huber vs Smalian with no bark: Smalian is 1.11% above Huber on a tapering log", () => {
    // Huber: r=0.19, A=π×0.0361=0.1134115, V=0.1134115×4.20=0.4763283.
    // Smalian: A1=π×0.17²=0.0907920, A2=π×0.21²=0.1385442, mean=0.1146681, V=0.4816061.
    const result = timberVolume({
      mode: { kind: "huber-smalian", meanDiameter: 38, d1: 34, d2: 42, length: 4.2 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.huberVolume).toBeCloseTo(0.4763283, 5);
    expect(result.smalianVolume).toBeCloseTo(0.4816061, 5);
    expect(result.volumeDifferencePercent).toBeCloseTo(1.11, 1);
    expect(result.smalianVolume).toBeGreaterThan(result.huberVolume ?? 0);
  });

  it("huber-smalian never elects a total either: BOTH per-formula totals are offered, generic total/mass stay undefined", () => {
    // Same log as above, 100 of them, density 550 kg/m³.
    // totalHuber = 0.4763283×100 = 47.63283 m³; massHuber = 47.63283×550 = 26198.06 kg.
    // totalSmalian = 0.4816061×100 = 48.16061 m³; massSmalian = 48.16061×550 = 26488.34 kg.
    const result = timberVolume({
      mode: { kind: "huber-smalian", meanDiameter: 38, d1: 34, d2: 42, length: 4.2, logCount: 100 },
      density: 550,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalLogVolume).toBeUndefined();
    expect(result.mass).toBeUndefined();
    expect(result.totalLogVolumeHuber).toBeCloseTo(47.63283, 3);
    expect(result.totalLogVolumeSmalian).toBeCloseTo(48.16061, 3);
    expect(result.massHuber).toBeCloseTo(26198.06, 1);
    expect(result.massSmalian).toBeCloseTo(26488.34, 1);
  });

  it("sawn timber: 24×120 mm, 4.00 m, 150 pieces — 1.7280 m³, 950.4 kg, 72.00 m² one-sided", () => {
    const result = timberVolume({
      mode: { kind: "sawn", thickness: 24, width: 120, pieceLength: 4, pieces: 150, section: "rough" },
      density: 550,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalVolume).toBeCloseTo(1.728, 4);
    expect(result.mass).toBeCloseTo(950.4, 1);
    expect(result.surfaceArea).toBeCloseTo(72.0, 2);
    expect(result.sawnSection).toBe("rough");
  });

  it("stacked prm round-trips through the solid volume: 8 prm at 0.65 → 5.20 m³ → back to 8.00 prm", () => {
    const toSolid = timberVolume({ mode: { kind: "stacked-to-solid", stackedVolume: 8, packingCoefficient: 0.65 }, density: 700 });
    expect(toSolid.ok).toBe(true);
    if (!toSolid.ok) return;
    expect(toSolid.totalVolume).toBeCloseTo(5.2, 3);
    expect(toSolid.mass).toBeCloseTo(3640.0, 1);

    const back = timberVolume({ mode: { kind: "solid-to-stacked", solidVolume: 5.2, packingCoefficient: 0.65 } });
    expect(back.ok && back.stackedVolume).toBeCloseTo(8.0, 3);
  });

  it("refuses bark thick enough to consume the whole measured diameter", () => {
    const result = timberVolume({ mode: { kind: "huber", meanDiameter: 10, length: 2 }, barkThickness: 6 });
    expect(result).toEqual({ ok: false, reason: "barkThickness" });
  });

  it("refuses a packing coefficient outside 0.4–0.9", () => {
    const result = timberVolume({ mode: { kind: "stacked-to-solid", stackedVolume: 8, packingCoefficient: 1.0 } });
    expect(result).toEqual({ ok: false, reason: "packingCoefficient" });
  });
});

/* -----------------------------------------------------------------------
 * wallpaper-rolls
 * -------------------------------------------------------------------- */

describe("wallpaperRolls", () => {
  it("three 0.30 m walls at 0.53 m roll width need 3 strips — the PERIMETER (0.90 m) would wrongly give 2", () => {
    // Per-wall: ceil(300/530)=1 each × 3 walls = 3. Perimeter-based ceil(900/530)=ceil(1.698)=2 — wrong.
    const result = wallpaperRolls({
      walls: [{ width: 0.3 }, { width: 0.3 }, { width: 0.3 }],
      height: 2,
      rollWidth: 0.53,
      rollLength: 6,
      repeat: 0,
      matching: "straight",
      allowance: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stripCount).toBe(3);
    expect(result.rollCount).toBe(1);
    expect(result.rolls[0]?.stripCount).toBe(3);
    expect(result.rolls[0]?.remainder).toBeCloseTo(0, 6);
  });

  it("room with a door, straight match, 0.64 m repeat: 28 strips, 10 rolls, 3 per roll, 7.20 m to the pattern", () => {
    // n = ceil((15.60−0.90)×1000/530) = ceil(14700/530) = 28. Hc = 2.80 m = 2800 mm.
    // Sequential sim: 3 strips/roll (d=0,400,400 mm each after the first), remainder 850 mm;
    // 9 full rolls + a 10th with the final single strip. 28 = 9×3 + 1.
    const result = wallpaperRolls({
      walls: [{ width: 15.6, fullHeightOpening: 0.9 }],
      height: 2.7,
      rollWidth: 0.53,
      rollLength: 10.05,
      repeat: 0.64,
      matching: "straight",
      allowance: 0.1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stripCount).toBe(28);
    expect(result.stripLength).toBeCloseTo(3.2, 6); // ceil(2800/640)×640 = 3200 mm
    expect(result.stripsPerRollCheck).toBe(3);
    expect(result.rollCount).toBe(10);
    expect(result.rolls[0]?.stripCount).toBe(3);
    expect(result.rolls[0]?.remainder).toBeCloseTo(0.85, 3);
    expect(result.rolls[9]?.stripCount).toBe(1);
    expect(result.rolls[9]?.remainder).toBeCloseTo(7.25, 3);
    expect(result.totalPatternWaste).toBeCloseTo(7.2, 3);
  });

  it("no pattern at all: 12.00 m wall, 8 rolls, no length lost to matching, and remnants yield spare pieces", () => {
    // n = ceil(12000/530) = 23. l = Hc = 2.60 m; per roll floor(10050/2600) = 3.
    // 7 rolls of 3 (remainder 2.250 m each) + 1 roll of 2 (remainder 4.850 m).
    const result = wallpaperRolls({
      walls: [{ width: 12 }],
      height: 2.5,
      rollWidth: 0.53,
      rollLength: 10.05,
      repeat: 0,
      matching: "straight",
      allowance: 0.1,
      spareStripHeight: 0.3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stripCount).toBe(23);
    expect(result.rollCount).toBe(8);
    expect(result.totalPatternWaste).toBeCloseTo(0, 6);
    expect(result.rolls[7]?.stripCount).toBe(2);
    expect(result.rolls[7]?.remainder).toBeCloseTo(4.85, 3);
    // 7 rolls × floor(2250/300)=7 = 49, plus floor(4850/300)=16 → 65.
    expect(result.sparePiecesFromRemnants).toBe(65);
  });

  it("refuses a door as wide as, or wider than, its own wall", () => {
    const result = wallpaperRolls({
      walls: [{ width: 1, fullHeightOpening: 1 }],
      height: 2.5,
      rollWidth: 0.53,
      rollLength: 10,
      repeat: 0,
      matching: "straight",
      allowance: 0,
    });
    expect(result).toEqual({ ok: false, reason: "walls:0" });
  });

  it("refuses a pasting height that will not even fit one empty roll", () => {
    const result = wallpaperRolls({
      walls: [{ width: 5 }],
      height: 9.6,
      rollWidth: 0.53,
      rollLength: 10,
      repeat: 0,
      matching: "straight",
      allowance: 0.5,
    });
    expect(result).toEqual({ ok: false, reason: "rollLength" });
  });
});

/* -----------------------------------------------------------------------
 * weld-consumable
 * -------------------------------------------------------------------- */

describe("weldConsumable", () => {
  it("fillet z=6 mm, 12 m, 10% reinforcement: 237.60 cm³, 1.865 kg weld, 2.061 kg consumable, 334.4 m of Ø1.0 wire", () => {
    // A = 6²/2 = 18.000; ×1.10 = 19.800 mm². V = 19.800×12000 = 237600 mm³ = 237.60 cm³.
    // mass = 237600e-9×7850 = 1.865160 → 1.865 kg. consumable = 1.865160/0.95×1.05 = 2.061493 → 2.061 kg.
    // wire: massPerMetre = (π×1²/4)×1000e-9×7850 = 0.00616538 kg/m → 2.061493/0.00616538 = 334.4 m.
    const result = weldConsumable({
      seamType: "fillet",
      leg: 6,
      reinforcement: 10,
      weldLength: 12,
      efficiency: 0.95,
      waste: 5,
      wireDiameter: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.crossSectionArea).toBeCloseTo(19.8, 6);
    expect(result.weldVolume).toBeCloseTo(237.6, 3);
    expect(result.weldMass).toBeCloseTo(1.86516, 4);
    expect(result.consumableMass).toBeCloseTo(2.061493, 4);
    expect(result.wireLength).toBeCloseTo(334.4, 1);
    expect(result.weldMassPerMetre).toBeCloseTo(0.15543, 4);
  });

  it("butt V-groove, t=10, α=60°, b=2, c=1.5: 66.6506 mm² reinforced area, 56 electrodes", () => {
    // A = 2×10 + (10−1.5)²×tan30° = 20 + 72.25×0.57735027 = 61.713557; ×1.08 = 66.650642 mm².
    // V = 66.650642×3000 = 199951.92 mm³; mass = 199951.92e-9×7850 = 1.569623 → 1.570 kg.
    // consumable = 1.569623/0.65×1.03 = 2.487248 kg; usable/electrode = 60×0.75 = 45 g.
    // count = ceil(2487.248/45) = ceil(55.272) = 56.
    const result = weldConsumable({
      seamType: "butt-v",
      plateThickness: 10,
      grooveAngle: 60,
      rootGap: 2,
      rootFaceHeight: 1.5,
      reinforcement: 8,
      weldLength: 3,
      efficiency: 0.65,
      waste: 3,
      electrodeMass: 60,
      electrodeUsableFraction: 75,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.crossSectionArea).toBeCloseTo(66.6506, 3);
    expect(result.weldMass).toBeCloseTo(1.5696, 3);
    expect(result.consumableMass).toBeCloseTo(2.48725, 4);
    expect(result.electrodeCount).toBe(56);
  });

  it("the seam count is applied to the mass BEFORE rounding, once — not rounded once per seam and multiplied", () => {
    // Same fillet as above but weldLength = 12.007 m, seamCount = 3.
    // massPerSeam = 19.8×12007×1e-9×7850 = 1.86624801 kg (rounds to 1.866 alone).
    // Correct total = 1.86624801×3 = 5.59874403 → 5.599 kg. A naive round-then-multiply
    // would give 1.866×3 = 5.598 kg — off by a whole gram from rounding three times.
    const result = weldConsumable({
      seamType: "fillet",
      leg: 6,
      reinforcement: 10,
      weldLength: 12.007,
      seamCount: 3,
      efficiency: 1,
      waste: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.weldMass).toBeCloseTo(5.599, 3);
    expect(result.weldMass).not.toBeCloseTo(5.598, 3);
  });

  it("a fillet throat, not a leg, converts as leg = throat×√2 — and halves the area if mistaken for the leg", () => {
    // throat 4.2426 mm → leg = 4.2426×√2 = 6.0000 mm, matching the leg=6 case above.
    const result = weldConsumable({
      seamType: "fillet",
      throat: 4.242641,
      reinforcement: 0,
      weldLength: 1,
      efficiency: 1,
      waste: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.legUsed).toBeCloseTo(6, 4);
    expect(result.crossSectionArea).toBeCloseTo(18, 3); // 6²/2, no reinforcement
  });

  it("refuses a root face height at or above the plate thickness — the groove geometry collapses", () => {
    const result = weldConsumable({
      seamType: "butt-v",
      plateThickness: 10,
      grooveAngle: 60,
      rootGap: 2,
      rootFaceHeight: 10,
      reinforcement: 0,
      weldLength: 1,
      efficiency: 1,
      waste: 0,
    });
    expect(result).toEqual({ ok: false, reason: "rootFaceHeight" });
  });

  it("refuses an electrode mass or usable fraction outside the catalogue range", () => {
    const result = weldConsumable({
      seamType: "fillet",
      leg: 6,
      reinforcement: 0,
      weldLength: 1,
      efficiency: 1,
      waste: 0,
      electrodeMass: 5,
      electrodeUsableFraction: 75,
    });
    expect(result).toEqual({ ok: false, reason: "electrodeMass" });
  });
});

/* -----------------------------------------------------------------------
 * wood-moisture-movement
 * -------------------------------------------------------------------- */

describe("woodMoistureMovement", () => {
  it("oak shelf, W=600 mm, c=0.25 %/%, installed at 10%, room 6–12%: 3.00 mm swell, 6.00 mm shrink, 9.00 mm total", () => {
    const result = woodMoistureMovement({
      initialDimension: 600,
      initialMoisture: 10,
      finalMoisture: 10,
      shrinkageCoefficient: 0.25,
      grainDirection: "tangential",
      installMoisture: 10,
      roomMoistureMin: 6,
      roomMoistureMax: 12,
      elementWidth: 600,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.swellToMax).toBeCloseTo(3.0, 6);
    expect(result.shrinkToMin).toBeCloseTo(6.0, 6);
    expect(result.totalSwing).toBeCloseTo(9.0, 6);
    expect((result.swellToMax ?? 0) + (result.shrinkToMin ?? 0)).toBeCloseTo(result.totalSwing ?? -1, 9);
    expect(result.grainDirection).toBe("tangential");
  });

  it("beech board, total shrinkage 11.8% at FSP 30: derives c = 0.393333, −3.15 mm from 12% to 8%", () => {
    const result = woodMoistureMovement({
      initialDimension: 200,
      initialMoisture: 12,
      finalMoisture: 8,
      totalShrinkage: 11.8,
      grainDirection: "tangential",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.derivedCoefficient).toBeCloseTo(0.393333, 5);
    expect(result.dimensionChange).toBeCloseTo(-3.15, 2);
    expect(result.finalDimension).toBeCloseTo(196.85, 2);
  });

  it("clamps BOTH moisture readings to the fibre saturation point — movement above it does not exist", () => {
    // MC0's own valid range is 0–40, so 38 (not 45) is what stays inside it while still
    // exceeding the FSP: MC0*=min(38,30)=30, MC1*=20 — same clamped pair, same result,
    // as any other MC0 above 30 would give.
    const result = woodMoistureMovement({
      initialDimension: 200,
      initialMoisture: 38,
      finalMoisture: 20,
      totalShrinkage: 11.8,
      grainDirection: "tangential",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clampedInitialMoisture).toBe(30);
    expect(result.dimensionChange).toBeCloseTo(-7.87, 2);
  });

  it("the FSP clamp reaches the install and room readings too, through the same clamp() call as MC0/MC1", () => {
    // The assignment's own ranges make install/room (3–25) and FSP (25–35) meet at exactly
    // 25 — no valid room reading can EXCEED the FSP, so this cannot repeat the previous
    // test's "clamps down" case. What it verifies instead: with FSP pinned to its floor (25)
    // and roomMoistureMax at its ceiling (25), the boundary passes through the same clamp()
    // used for MC0/MC1 rather than a separate, possibly-forgotten code path — and the swell/
    // shrink/total-swing identity still holds off the clamped figures.
    const result = woodMoistureMovement({
      initialDimension: 600,
      initialMoisture: 10,
      finalMoisture: 10,
      shrinkageCoefficient: 0.25,
      grainDirection: "tangential",
      fiberSaturationPoint: 25,
      installMoisture: 20,
      roomMoistureMin: 18,
      roomMoistureMax: 25,
      elementWidth: 600,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clampedInstallMoisture).toBe(20);
    expect(result.clampedRoomMin).toBe(18);
    expect(result.clampedRoomMax).toBe(25);
    // swellToMax = 600×0.0025×(25−20) = 7.5; shrinkToMin = 600×0.0025×(20−18) = 3.0;
    // totalSwing = 600×0.0025×(25−18) = 10.5 = 7.5+3.0.
    expect(result.swellToMax).toBeCloseTo(7.5, 6);
    expect(result.shrinkToMin).toBeCloseTo(3.0, 6);
    expect(result.totalSwing).toBeCloseTo(10.5, 6);
  });

  it("admits the longitudinal direction's much smaller coefficient — the corrected lower bound", () => {
    const result = woodMoistureMovement({
      initialDimension: 2000,
      initialMoisture: 12,
      finalMoisture: 8,
      shrinkageCoefficient: 0.01,
      grainDirection: "longitudinal",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dimensionChange).toBeCloseTo(-0.8, 6); // 2000×0.0001×(-4)
  });

  it("refuses giving both a coefficient and a total-shrinkage figure, and neither", () => {
    expect(
      woodMoistureMovement({
        initialDimension: 200,
        initialMoisture: 12,
        finalMoisture: 8,
        shrinkageCoefficient: 0.25,
        totalShrinkage: 11.8,
        grainDirection: "tangential",
      }),
    ).toEqual({ ok: false, reason: "shrinkageCoefficient" });
    expect(
      woodMoistureMovement({
        initialDimension: 200,
        initialMoisture: 12,
        finalMoisture: 8,
        grainDirection: "tangential",
      }),
    ).toEqual({ ok: false, reason: "shrinkageCoefficient" });
  });
});
