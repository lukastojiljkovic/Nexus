import { describe, expect, it } from "vitest";

import {
  aspectRatioFit,
  baselineRhythm,
  bookSpine,
  colourDifference,
  columnGrid,
  copyfitting,
  eanBarcode,
  fontMetricsTrim,
  isoPaperSize,
  modularTypeScale,
  paperWeight,
  printResolution,
  rollYield,
  saddleStitchImposition,
  sheetImposition,
  srgbToLab,
  typographicUnits,
} from "./dizajn.js";

/**
 * Every expectation here was worked by hand from the inputs, and the arithmetic
 * is written into the comment above it so a reader can check it without running
 * anything. Two families of numbers are not hand arithmetic and say so: the
 * CIEDE2000 pairs come from the standard's own published test data (the only
 * honest way to test a formula with a hue-rotation term in it), and the
 * ISPRAVKA-only fields (added by the review, not the original catalogue) are
 * marked as such where they replace a stale catalogue vector.
 */

describe("aspectRatioFit", () => {
  it("reduces 1920x1080 to 16:9 and letterboxes it into a portrait frame", () => {
    const fit = aspectRatioFit({
      sourceWidth: 1920,
      sourceHeight: 1080,
      targetWidth: 1080,
      targetHeight: 1350,
      mode: "contain",
      roundTo: "none",
    });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    // Euclid: 1920 = 1*1080 + 840; 1080 = 1*840 + 240; 840 = 3*240 + 120;
    // 240 = 2*120 + 0 -> g = 120, and 1920/120 = 16, 1080/120 = 9.
    expect(fit.ratioWidth).toBe(16);
    expect(fit.ratioHeight).toBe(9);
    expect(fit.decimalRatio).toBeCloseTo(1.777778, 6);
    // contain takes the SMALLER factor: 1080/1920 = 0.5625 against 1350/1080 = 1.25.
    expect(fit.scale).toBe(0.5625);
    expect(fit.outputWidth).toBe(1080);
    expect(fit.outputHeight).toBe(607.5); // 1080 * 0.5625
    // (1350 - 607.5)/2 = 742.5/2 = 371.25 above and below; nothing at the sides.
    expect(fit.barHeight).toBe(371.25);
    expect(fit.barWidth).toBe(0);
    expect(fit.cropWidth).toBeUndefined();
    expect(fit.distortion).toBe(1);
    // roundTo "none": the displayed size equals the raw size, so the rounding
    // remainder is exactly zero on both axes.
    expect(fit.roundingRemainderWidth).toBe(0);
    expect(fit.roundingRemainderHeight).toBe(0);
  });

  it("crops the same pair when it covers, and says how much source that costs", () => {
    const fit = aspectRatioFit({
      sourceWidth: 1920,
      sourceHeight: 1080,
      targetWidth: 1080,
      targetHeight: 1350,
      mode: "cover",
      roundTo: "none",
    });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    // cover takes the LARGER factor: 1.25.
    expect(fit.scale).toBe(1.25);
    expect(fit.outputWidth).toBe(2400); // 1920 * 1.25
    expect(fit.outputHeight).toBe(1350);
    // (2400 - 1080)/2 = 660 per side in frame units; 660/1.25 = 528 in source units.
    expect(fit.cropWidth).toBe(660);
    expect(fit.cropWidthSource).toBe(528);
    expect(fit.cropHeight).toBe(0);
    // 1920 - 2*528 = 864, which is also 1080/1.25.
    expect(fit.visibleSourceWidth).toBe(864);
    expect(fit.visibleSourceHeight).toBe(1080);
    expect(fit.barWidth).toBeUndefined();
  });

  it("honours an exact width and derives the height from the ratio alone", () => {
    const fit = aspectRatioFit({
      sourceWidth: 4000,
      sourceHeight: 3000,
      targetWidth: 1200,
      mode: "exactWidth",
      roundTo: "none",
    });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    // gcd(4000, 3000) = 1000 -> 4:3; 1200/4000 = 0.3; 1200 * 3000/4000 = 900.
    expect(fit.ratioWidth).toBe(4);
    expect(fit.ratioHeight).toBe(3);
    expect(fit.decimalRatio).toBeCloseTo(1.333333, 6);
    expect(fit.scale).toBe(0.3);
    expect(fit.outputHeight).toBe(900);
  });

  it("reports the distortion of a stretch instead of silently picking one factor", () => {
    const fit = aspectRatioFit({
      sourceWidth: 1000,
      sourceHeight: 1000,
      targetWidth: 1600,
      targetHeight: 900,
      mode: "stretch",
      roundTo: "none",
    });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.scaleX).toBe(1.6);
    expect(fit.scaleY).toBe(0.9);
    // 1.6/0.9 = 16/9 = 1.777778 — the same number as a 16:9 ratio, by coincidence
    // of the numbers chosen, which is why the field is named for what it means.
    expect(fit.distortion).toBeCloseTo(1.777778, 6);
    // There is no single scale to report for a stretch, and none is invented.
    expect(fit.scale).toBeUndefined();
  });

  it("rounds the displayed size only, and reports how far that moved each axis", () => {
    const fit = aspectRatioFit({
      sourceWidth: 1920,
      sourceHeight: 1080,
      targetWidth: 1000,
      targetHeight: 1000,
      mode: "contain",
      roundTo: "wholePixel",
    });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    // s = 1000/1920 = 0.5208333…; 1080 * that = 562.5 exactly, which rounds up.
    expect(fit.outputHeight).toBe(562.5);
    expect(fit.displayHeight).toBe(563);
    expect(fit.displayWidth).toBe(1000);
    // 1000/563 = 1.776199, against a true 1.777778 — half a pixel of drift.
    expect(fit.displayRatio).toBeCloseTo(1.776199, 6);
    expect(fit.scale).toBeCloseTo(0.520833, 6);
    // The ISPRAVKA field: displayWidth − outputWidth = 1000 − 1000 = 0 on the
    // width, and 563 − 562.5 = 0.5 on the height that actually moved.
    expect(fit.roundingRemainderWidth).toBeCloseTo(0, 9);
    expect(fit.roundingRemainderHeight).toBeCloseTo(0.5, 9);
  });

  it("offers no integer ratio when a source side is fractional", () => {
    const fit = aspectRatioFit({
      sourceWidth: 1920.5,
      sourceHeight: 1080,
      targetWidth: 1000,
      mode: "exactWidth",
      roundTo: "none",
    });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    // gcd is only defined for whole inputs — a fraction on either side means
    // only the decimal ratio is meaningful.
    expect(fit.ratioWidth).toBeUndefined();
    expect(fit.ratioHeight).toBeUndefined();
    expect(fit.decimalRatio).toBeCloseTo(1.778241, 6);
  });

  it("refuses a non-positive source or a missing target for the chosen mode", () => {
    expect(
      aspectRatioFit({
        sourceWidth: 0,
        sourceHeight: 1080,
        targetWidth: 100,
        targetHeight: 100,
        mode: "contain",
        roundTo: "none",
      }),
    ).toEqual({ ok: false, reason: "sourceWidth" });
    expect(
      aspectRatioFit({
        sourceWidth: 1920,
        sourceHeight: -1,
        targetWidth: 100,
        targetHeight: 100,
        mode: "contain",
        roundTo: "none",
      }),
    ).toEqual({ ok: false, reason: "sourceHeight" });
    expect(
      aspectRatioFit({
        sourceWidth: 1920,
        sourceHeight: 1080,
        mode: "contain",
        roundTo: "none",
      }),
    ).toEqual({ ok: false, reason: "targetWidth" });
    expect(
      aspectRatioFit({
        sourceWidth: 1920,
        sourceHeight: 1080,
        targetWidth: 1000,
        mode: "cover",
        roundTo: "none",
      }),
    ).toEqual({ ok: false, reason: "targetHeight" });
  });

  it("refuses an unrecognised roundTo instead of silently treating it as 'none'", () => {
    expect(
      aspectRatioFit({
        sourceWidth: 100,
        sourceHeight: 100,
        targetWidth: 50,
        targetHeight: 50,
        mode: "contain",
        roundTo: "toNearestInch" as unknown as "none",
      }),
    ).toEqual({ ok: false, reason: "roundTo" });
  });

  it("ISPRAVKA: refuses a NaN display ratio rather than reporting one, when both display axes round to zero", () => {
    // s = min(0.4/1000, 0.4/1000) = 0.0004; outputWidth = outputHeight =
    // 1000*0.0004 = 0.4, and Math.round(0.4) = 0 on BOTH axes, so a plain
    // displayWidth/displayHeight would divide 0 by 0.
    const fit = aspectRatioFit({
      sourceWidth: 1000,
      sourceHeight: 1000,
      targetWidth: 0.4,
      targetHeight: 0.4,
      mode: "contain",
      roundTo: "wholePixel",
    });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.displayWidth).toBe(0);
    expect(fit.displayHeight).toBe(0);
    expect(fit.displayRatio).toBeUndefined();
    // The raw ratio is completely unaffected by the rounding that broke the
    // displayed one.
    expect(fit.decimalRatio).toBe(1);
  });
});

describe("baselineRhythm", () => {
  it("sits exactly on an 8px grid: 16px text at 1.5 line-height, column 600px", () => {
    const rhythm = baselineRhythm({
      fontSize: 16,
      lineHeight: 1.5,
      lineHeightUnit: "multiplier",
      gridUnit: 8,
      columnHeight: 600,
      snapMode: "up",
    });
    expect(rhythm.ok).toBe(true);
    if (!rhythm.ok) return;
    // 1.5 * 16 = 24.0000; leading = 24 - 16 = 8; half-leading = 4.
    expect(rhythm.lineHeightPx).toBe(24);
    expect(rhythm.multiplier).toBe(1.5);
    expect(rhythm.leading).toBe(8);
    expect(rhythm.halfLeading).toBe(4);
    // milliLine = 24000, milliGrid = 8000, 24000 % 8000 = 0 -> on grid.
    expect(rhythm.gridRemainder).toBe(0);
    expect(rhythm.onGrid).toBe(true);
    // Already a multiple of 8, so snapping up changes nothing.
    expect(rhythm.snapped).toBe(24);
    expect(rhythm.snappedMultiplier).toBe(1.5);
    // lines = floor(600/24) = 25; used = 25*24 = 600.00; leftover = 0.
    expect(rhythm.column?.lines).toBe(25);
    expect(rhythm.column?.used).toBe(600);
    expect(rhythm.column?.leftover).toBe(0);
  });

  it("sits off an 4px grid and shows both the raw and the snapped column", () => {
    const rhythm = baselineRhythm({
      fontSize: 18,
      lineHeight: 1.4,
      lineHeightUnit: "multiplier",
      gridUnit: 4,
      columnHeight: 700,
      snapMode: "up",
    });
    expect(rhythm.ok).toBe(true);
    if (!rhythm.ok) return;
    // 1.4 * 18 = 25.2000; leading = 25.2 - 18 = 7.2; half-leading = 3.6.
    expect(rhythm.lineHeightPx).toBeCloseTo(25.2, 6);
    expect(rhythm.leading).toBeCloseTo(7.2, 6);
    expect(rhythm.halfLeading).toBeCloseTo(3.6, 6);
    // milliLine = 25200, milliGrid = 4000; 25200 % 4000 = 1200 -> 1.2000, off grid.
    expect(rhythm.gridRemainder).toBeCloseTo(1.2, 6);
    expect(rhythm.onGrid).toBe(false);
    // 25200/4000 = 6.3, ceil = 7 -> snapped = 28.0000; multiplier 28/18 = 1.5556.
    expect(rhythm.snapped).toBe(28);
    expect(rhythm.snappedMultiplier).toBeCloseTo(1.555556, 6);
    expect(rhythm.snappedLeading).toBe(10);
    // Raw column: lines = floor(700/25.2) = floor(27.7778) = 27; used = 27*25.2
    // = 680.40; leftover = 700 - 680.4 = 19.60.
    expect(rhythm.column?.lines).toBe(27);
    expect(rhythm.column?.used).toBeCloseTo(680.4, 6);
    expect(rhythm.column?.leftover).toBeCloseTo(19.6, 6);
    // Snapped column: lines = floor(700/28) = 25; used = 700.00; leftover = 0.
    expect(rhythm.snappedColumn?.lines).toBe(25);
    expect(rhythm.snappedColumn?.used).toBe(700);
    expect(rhythm.snappedColumn?.leftover).toBe(0);
  });

  it("does not clamp negative leading — a display line set tighter than its type", () => {
    const rhythm = baselineRhythm({
      fontSize: 40,
      lineHeight: 0.9,
      lineHeightUnit: "multiplier",
      gridUnit: 8,
      snapMode: "up",
    });
    expect(rhythm.ok).toBe(true);
    if (!rhythm.ok) return;
    // 0.9 * 40 = 36.0000; leading = 36 - 40 = -4; half-leading = -2.
    expect(rhythm.lineHeightPx).toBeCloseTo(36, 6);
    expect(rhythm.leading).toBeCloseTo(-4, 6);
    expect(rhythm.halfLeading).toBeCloseTo(-2, 6);
    // milliLine = 36000, milliGrid = 8000; 36000 % 8000 = 4000 -> 4.0000, off grid.
    expect(rhythm.gridRemainder).toBeCloseTo(4, 6);
    expect(rhythm.onGrid).toBe(false);
    // 36000/8000 = 4.5, ceil = 5 -> snapped = 40.0000.
    expect(rhythm.snapped).toBe(40);
  });

  it("answers exactly 'on grid' for a line height typed directly in px, with no multiplication involved", () => {
    const rhythm = baselineRhythm({
      fontSize: 16,
      lineHeight: 24, // typed directly in px, not as a multiplier this time
      lineHeightUnit: "px",
      gridUnit: 8,
      snapMode: "nearest",
    });
    expect(rhythm.ok).toBe(true);
    if (!rhythm.ok) return;
    expect(rhythm.gridRemainder).toBe(0);
    expect(rhythm.onGrid).toBe(true);
    expect(rhythm.snapped).toBe(24);
  });

  it("ISPRAVKA: answers exactly 'on grid' for the general float-trap case, 45px * 1.4 multiplier against a 3px grid", () => {
    // True value: fontSize 45 * multiplier 1.4 = 63px exactly, and 63/3 = 21
    // grid units exactly. In IEEE 754, `45 * 1.4` evaluates to
    // 62.99999999999999, not 63 — verified directly, not inferred — so a naive
    // `lineHeightPx % gridUnit` would answer "off grid" for a line height that
    // actually sits exactly on it. Milli-pixel rounding (Math.round(62999.99999999999) = 63000)
    // removes the ulp of error before the remainder is taken.
    const rhythm = baselineRhythm({
      fontSize: 45,
      lineHeight: 1.4,
      lineHeightUnit: "multiplier",
      gridUnit: 3,
      snapMode: "nearest",
    });
    expect(rhythm.ok).toBe(true);
    if (!rhythm.ok) return;
    expect(rhythm.onGrid).toBe(true);
    expect(rhythm.gridRemainder).toBe(0);
    // 63000/3000 = 21 exactly -> snapped = 21 * 3 = 63.0000.
    expect(rhythm.snapped).toBe(63);
  });

  it("snaps down and to the nearest unit, not only up", () => {
    const down = baselineRhythm({
      fontSize: 18,
      lineHeight: 1.4,
      lineHeightUnit: "multiplier",
      gridUnit: 4,
      snapMode: "down",
    });
    // floor(25200/4000) = floor(6.3) = 6 -> snapped = 24.0000.
    expect(down.ok).toBe(true);
    if (down.ok) expect(down.snapped).toBe(24);

    const nearest = baselineRhythm({
      fontSize: 18,
      lineHeight: 1.4,
      lineHeightUnit: "multiplier",
      gridUnit: 4,
      snapMode: "nearest",
    });
    // round(6.3) = 6 -> snapped = 24.0000.
    expect(nearest.ok).toBe(true);
    if (nearest.ok) expect(nearest.snapped).toBe(24);
  });

  it("omits the column figures entirely when no column height was given", () => {
    const rhythm = baselineRhythm({
      fontSize: 16,
      lineHeight: 1.5,
      lineHeightUnit: "multiplier",
      gridUnit: 8,
      snapMode: "up",
    });
    expect(rhythm.ok).toBe(true);
    if (!rhythm.ok) return;
    expect(rhythm.column).toBeUndefined();
    expect(rhythm.snappedColumn).toBeUndefined();
  });

  it("refuses a non-positive font size, an unusable line height, or a non-positive grid", () => {
    expect(
      baselineRhythm({
        fontSize: 0,
        lineHeight: 1.5,
        lineHeightUnit: "multiplier",
        gridUnit: 8,
        snapMode: "up",
      }),
    ).toEqual({ ok: false, reason: "fontSize" });
    expect(
      baselineRhythm({
        fontSize: 16,
        lineHeight: Number.NaN,
        lineHeightUnit: "multiplier",
        gridUnit: 8,
        snapMode: "up",
      }),
    ).toEqual({ ok: false, reason: "lineHeight" });
    expect(
      baselineRhythm({
        fontSize: 16,
        lineHeight: -1,
        lineHeightUnit: "multiplier",
        gridUnit: 8,
        snapMode: "up",
      }),
    ).toEqual({ ok: false, reason: "lineHeight" });
    expect(
      baselineRhythm({
        fontSize: 16,
        lineHeight: 1.5,
        lineHeightUnit: "multiplier",
        gridUnit: 0,
        snapMode: "up",
      }),
    ).toEqual({ ok: false, reason: "gridUnit" });
  });

  it("refuses an unrecognised lineHeightUnit or snapMode instead of silently defaulting", () => {
    expect(
      baselineRhythm({
        fontSize: 16,
        lineHeight: 24,
        lineHeightUnit: "vh" as unknown as "px",
        gridUnit: 8,
        snapMode: "up",
      }),
    ).toEqual({ ok: false, reason: "lineHeightUnit" });
    expect(
      baselineRhythm({
        fontSize: 16,
        lineHeight: 1.5,
        lineHeightUnit: "multiplier",
        gridUnit: 8,
        snapMode: "sideways" as unknown as "up",
      }),
    ).toEqual({ ok: false, reason: "snapMode" });
  });

  it("ISPRAVKA: refuses a grid unit that quantises to zero milli-pixels rather than dividing by it", () => {
    // Math.round(0.0004 * 1000) = Math.round(0.4) = 0: isPositive(0.0004) is
    // true, but the milli-pixel quantisation this tool relies on manufactures
    // a zero divisor from it. Left unguarded, milliLine % 0 is NaN and
    // milliLine / 0 is Infinity, both of which would leak into an ok:true result.
    const rhythm = baselineRhythm({
      fontSize: 16,
      lineHeight: 24,
      lineHeightUnit: "px",
      gridUnit: 0.0004,
      snapMode: "nearest",
    });
    expect(rhythm).toEqual({ ok: false, reason: "gridUnit" });
  });

  it("ISPRAVKA: refuses a line height that quantises to zero milli-pixels rather than reporting a false 'on grid'", () => {
    // Math.round(0.0004 * 1000) = 0 on the LINE side this time: unguarded,
    // 0 % 8000 === 0 would report a 0.0004px line as exactly on an 8px grid.
    const rhythm = baselineRhythm({
      fontSize: 16,
      lineHeight: 0.0004,
      lineHeightUnit: "px",
      gridUnit: 8,
      snapMode: "nearest",
    });
    expect(rhythm).toEqual({ ok: false, reason: "lineHeight" });
  });
});

describe("bookSpine", () => {
  it("derives the caliper from grammage and bulk, dimensionally: 80 g/m2 * 1.25 cm3/g / 1000", () => {
    const spine = bookSpine({
      pageCount: 320,
      grammage: 80,
      bulk: 1.25,
      coverCaliper: 0.3,
      extraAllowance: 0,
      coverWidth: 148,
      coverHeight: 210,
      edgeWrap: 0,
      bindingStyle: "soft",
      hingeGroove: 0,
    });
    expect(spine.ok).toBe(true);
    if (!spine.ok) return;
    // 80 * 1.25 / 1000 = 100 / 1000 = 0.1000 mm.
    expect(spine.caliper).toBeCloseTo(0.1, 6);
    expect(spine.caliperSource).toBe("grammage");
    // leaves = ceil(320/2) = 160; block = 160 * 0.1 = 16.000.
    expect(spine.leaves).toBe(160);
    expect(spine.block).toBeCloseTo(16, 6);
    // spine = 16 + 2*0.3 + 0 = 16.60.
    expect(spine.spine).toBeCloseTo(16.6, 6);
    // flatCoverWidth = 2*148 + 16.6 + 2*0 (no wrap, soft cover, no groove) = 312.60.
    expect(spine.flatCoverWidth).toBeCloseTo(312.6, 6);
    expect(spine.flatCoverHeight).toBe(210);
  });

  it("rounds an odd page count up a whole leaf, from a typed caliper", () => {
    const spine = bookSpine({
      pageCount: 97,
      paperCaliper: 0.12,
      coverCaliper: 0.25,
      extraAllowance: 0,
      edgeWrap: 0,
      bindingStyle: "soft",
      hingeGroove: 0,
    });
    expect(spine.ok).toBe(true);
    if (!spine.ok) return;
    // leaves = ceil(97/2) = 49; block = 49 * 0.12 = 5.880; spine = 5.88 + 0.50 = 6.38.
    expect(spine.leaves).toBe(49);
    expect(spine.caliperSource).toBe("typed");
    expect(spine.block).toBeCloseTo(5.88, 6);
    expect(spine.spine).toBeCloseTo(6.38, 6);
  });

  it("derives the caliper by dividing a measured block by its leaf count", () => {
    const spine = bookSpine({
      pageCount: 400, // 200 leaves
      measuredStack: 24,
      coverCaliper: 0,
      extraAllowance: 0,
      edgeWrap: 0,
      bindingStyle: "soft",
      hingeGroove: 0,
    });
    expect(spine.ok).toBe(true);
    if (!spine.ok) return;
    // leaves = ceil(400/2) = 200; caliper = 24/200 = 0.1200; block = 200*0.12 = 24.000.
    expect(spine.leaves).toBe(200);
    expect(spine.caliperSource).toBe("measured");
    expect(spine.caliper).toBeCloseTo(0.12, 6);
    expect(spine.block).toBeCloseTo(24, 6);
  });

  it("ISPRAVKA: a hard case adds a groove either side of the spine, and a wrap widens both outer edges", () => {
    const spine = bookSpine({
      pageCount: 320,
      grammage: 80,
      bulk: 1.25,
      coverCaliper: 0.3,
      extraAllowance: 0,
      coverWidth: 148,
      coverHeight: 210,
      edgeWrap: 15,
      bindingStyle: "hard",
      hingeGroove: 5,
    });
    expect(spine.ok).toBe(true);
    if (!spine.ok) return;
    // Same spine as the soft-cover vector: 16.60 mm.
    expect(spine.spine).toBeCloseTo(16.6, 6);
    // flatCoverWidth = 2*148 + 16.6 + 2*15 (wrap) + 2*5 (hard-case groove)
    //                = 296 + 16.6 + 30 + 10 = 352.60.
    expect(spine.flatCoverWidth).toBeCloseTo(352.6, 6);
    // ISPRAVKA: the wrap is at EVERY outer edge, head and tail included, not
    // only the fore-edges the width figure carries — flatCoverHeight =
    // 210 + 2*15 = 240.00. The groove is spine-axis only, so it does not
    // appear here.
    expect(spine.flatCoverHeight).toBeCloseTo(240, 6);
  });

  it("a soft cover ignores the groove even when one is typed", () => {
    const soft = bookSpine({
      pageCount: 320,
      grammage: 80,
      bulk: 1.25,
      coverCaliper: 0.3,
      extraAllowance: 0,
      coverWidth: 148,
      coverHeight: 210,
      edgeWrap: 0,
      bindingStyle: "soft",
      hingeGroove: 5, // present, but a soft cover has no groove to add it to
    });
    expect(soft.ok).toBe(true);
    if (soft.ok) expect(soft.flatCoverWidth).toBeCloseTo(312.6, 6);
  });

  it("omits the flat cover figures when no cover panel size was given", () => {
    const spine = bookSpine({
      pageCount: 320,
      grammage: 80,
      bulk: 1.25,
      coverCaliper: 0.3,
      extraAllowance: 0,
      edgeWrap: 0,
      bindingStyle: "soft",
      hingeGroove: 0,
    });
    expect(spine.ok).toBe(true);
    if (spine.ok) {
      expect(spine.flatCoverWidth).toBeUndefined();
      expect(spine.flatCoverHeight).toBeUndefined();
    }
  });

  it("refuses an unusable page count, a missing caliper route, or a negative allowance", () => {
    expect(
      bookSpine({
        pageCount: 0,
        paperCaliper: 0.1,
        coverCaliper: 0,
        extraAllowance: 0,
        edgeWrap: 0,
        bindingStyle: "soft",
        hingeGroove: 0,
      }),
    ).toEqual({ ok: false, reason: "pageCount" });
    expect(
      bookSpine({
        pageCount: 100,
        coverCaliper: 0,
        extraAllowance: 0,
        edgeWrap: 0,
        bindingStyle: "soft",
        hingeGroove: 0,
      }),
    ).toEqual({ ok: false, reason: "caliper" });
    expect(
      bookSpine({
        pageCount: 100,
        paperCaliper: 0.1,
        coverCaliper: -1,
        extraAllowance: 0,
        edgeWrap: 0,
        bindingStyle: "soft",
        hingeGroove: 0,
      }),
    ).toEqual({ ok: false, reason: "coverCaliper" });
    expect(
      bookSpine({
        pageCount: 100,
        paperCaliper: 0.1,
        coverCaliper: 0,
        extraAllowance: -1,
        edgeWrap: 0,
        bindingStyle: "soft",
        hingeGroove: 0,
      }),
    ).toEqual({ ok: false, reason: "extraAllowance" });
    expect(
      bookSpine({
        pageCount: 100,
        paperCaliper: 0.1,
        coverCaliper: 0,
        extraAllowance: 0,
        edgeWrap: -1,
        bindingStyle: "soft",
        hingeGroove: 0,
      }),
    ).toEqual({ ok: false, reason: "edgeWrap" });
  });
});

describe("columnGrid", () => {
  it("computes a 12-column grid and checks the invariant span(columns) = content", () => {
    const grid = columnGrid({ containerWidth: 1200, columns: 12, gutter: 24, outerMargin: 0 });
    expect(grid.ok).toBe(true);
    if (!grid.ok) return;
    expect(grid.contentWidth).toBe(1200);
    // col = (1200 - 11*24)/12 = (1200 - 264)/12 = 936/12 = 78.0000; 78/1200 = 6.5000%.
    expect(grid.columnWidth).toBeCloseTo(78, 6);
    expect(grid.columnPercent).toBeCloseTo(6.5, 6);
    // span(4) = 4*78 + 3*24 = 312 + 72 = 384.0000.
    expect(grid.spans[3]).toBeCloseTo(384, 6);
    // span(12) = 936 + 264 = 1200.0000 = content, the invariant.
    expect(grid.spans[11]).toBeCloseTo(1200, 6);
    // leftEdge(3) = 0 + 2*(78 + 24) = 204.0000.
    expect(grid.leftEdges[2]).toBeCloseTo(204, 6);
  });

  it("carries a fractional column width unrounded, and cross-checks a mid-span against content/2", () => {
    const grid = columnGrid({ containerWidth: 1440, columns: 12, gutter: 32, outerMargin: 80 });
    expect(grid.ok).toBe(true);
    if (!grid.ok) return;
    // content = 1440 - 160 = 1280; col = (1280 - 11*32)/12 = (1280-352)/12 = 928/12 = 77.3333.
    expect(grid.contentWidth).toBe(1280);
    expect(grid.columnWidth).toBeCloseTo(77.333333, 6);
    // span(6) = 6*77.333333 + 5*32 = 464.0000 + 160 = 624.0000, which cross-checks
    // against content/2 - gutter/2 = 640 - 16 = 624.0000.
    expect(grid.spans[5]).toBeCloseTo(624, 6);
    expect(grid.leftEdges[0]).toBeCloseTo(80, 6);
  });

  it("answers the reverse question: how many columns of at least a minimum width fit", () => {
    const grid = columnGrid({
      containerWidth: 1280,
      columns: 5,
      gutter: 24,
      outerMargin: 0,
      minColumnWidth: 200,
    });
    expect(grid.ok).toBe(true);
    if (!grid.ok) return;
    // maxColumns = floor((1280 + 24)/(200 + 24)) = floor(1304/224) = floor(5.8214) = 5;
    // 5*200 + 4*24 = 1000 + 96 = 1096 <= 1280, while 6 would need 1200+120=1320 > 1280.
    expect(grid.maxColumns).toBe(5);
  });

  it("ISPRAVKA: when the gutters alone exceed the content, reports the minimum content width needed instead of a negative column", () => {
    const grid = columnGrid({ containerWidth: 300, columns: 12, gutter: 32, outerMargin: 0 });
    expect(grid.ok).toBe(true);
    if (!grid.ok) return;
    // col = (300 - 11*32)/12 = (300-352)/12 = -4.3333 -> no valid grid.
    expect(grid.columnWidth).toBeUndefined();
    expect(grid.columnPercent).toBeUndefined();
    expect(grid.spans).toEqual([]);
    expect(grid.leftEdges).toEqual([]);
    // The useful answer at the boundary: (columns - 1) * gutter = 11 * 32 = 352 —
    // the content has to exceed 352 before a single pixel is left for a column.
    expect(grid.minRequiredContentWidth).toBe(352);
  });

  it("refuses a non-positive container, an out-of-range column count, or a margin eating the content", () => {
    expect(columnGrid({ containerWidth: 0, columns: 12, gutter: 0, outerMargin: 0 })).toEqual({
      ok: false,
      reason: "containerWidth",
    });
    expect(columnGrid({ containerWidth: 1200, columns: 0, gutter: 0, outerMargin: 0 })).toEqual({
      ok: false,
      reason: "columns",
    });
    expect(columnGrid({ containerWidth: 1200, columns: 12, gutter: -1, outerMargin: 0 })).toEqual({
      ok: false,
      reason: "gutter",
    });
    expect(columnGrid({ containerWidth: 100, columns: 12, gutter: 0, outerMargin: 60 })).toEqual({
      ok: false,
      reason: "outerMargin",
    });
  });
});

describe("copyfitting", () => {
  it("estimates lines, pages and the fill of the last page for a single-column job", () => {
    const fit = copyfitting({
      characterCount: 180000,
      charactersPerLine: 62,
      linesPerColumn: 38,
      columnsPerPage: 1,
    });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    // totalLines = ceil(180000/62) = ceil(2903.2258) = 2904.
    expect(fit.totalLines).toBe(2904);
    expect(fit.linesPerPage).toBe(38);
    // pages = ceil(2904/38) = ceil(76.4211) = 77.
    expect(fit.pages).toBe(77);
    // lines on the last page = 2904 - 76*38 = 2904 - 2888 = 16.
    expect(fit.lastPageLines).toBe(16);
    // lastPageFill = 16/38 = 0.421053 -> 42.1053%.
    expect(fit.lastPageFill).toBeCloseTo(42.105263, 4);
  });

  it("derives characters-per-line and lines-per-column from measured mm dimensions", () => {
    const fit = copyfitting({
      characterCount: 45000,
      columnWidth: 82,
      averageCharacterWidth: 2.05,
      columnHeight: 220,
      lineHeight: 5.5,
      columnsPerPage: 2,
    });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    // cpl = floor(82/2.05) = 40 (2.05 * 40 = 82.0 exactly — this particular
    // ratio happens to floor identically under a naive float division too; see
    // the next test for a vector that actually discriminates between the two).
    expect(fit.charactersPerLine).toBe(40);
    // linesPerColumn = floor(220/5.5) = 40 (5.5 * 40 = 220.0).
    expect(fit.linesPerColumn).toBe(40);
    // totalLines = ceil(45000/40) = 1125; linesPerPage = 80; pages = ceil(1125/80)
    // = ceil(14.0625) = 15; last page lines = 1125 - 14*80 = 5; fill = 5/80 = 6.25%.
    expect(fit.totalLines).toBe(1125);
    expect(fit.linesPerPage).toBe(80);
    expect(fit.pages).toBe(15);
    expect(fit.lastPageLines).toBe(5);
    expect(fit.lastPageFill).toBeCloseTo(6.25, 6);
  });

  it("ISPRAVKA: floors correctly at a general FP-trap ratio where a naive float floor is wrong, 3.3/1.1", () => {
    // Verified directly: 3.3 / 1.1 === 2.9999999999999996 in IEEE 754, so
    // Math.floor(3.3/1.1) naively gives 2. The centi-millimetre integer floor
    // instead computes Math.round(330)/Math.round(110) = 330/110 = 3 exactly
    // (an exact integer division), and floors THAT — giving the correct 3.
    const fit = copyfitting({
      characterCount: 100,
      columnWidth: 3.3,
      averageCharacterWidth: 1.1,
      linesPerColumn: 10,
      columnsPerPage: 1,
    });
    expect(fit.ok).toBe(true);
    if (fit.ok) expect(fit.charactersPerLine).toBe(3);
  });

  it("ISPRAVKA: refuses rather than answering Infinity characters per line when a measured width quantises to zero", () => {
    // Math.round(0.004 * 100) = Math.round(0.4) = 0: isPositive(0.004) is
    // true, but the centi-millimetre quantisation manufactures a zero
    // denominator from it. Unguarded, floorMm would divide by that zero.
    const fit = copyfitting({
      characterCount: 1000,
      columnWidth: 82,
      averageCharacterWidth: 0.004,
      columnHeight: 220,
      lineHeight: 5.5,
      columnsPerPage: 1,
    });
    expect(fit).toEqual({ ok: false, reason: "averageCharacterWidth" });
  });

  it("ISPRAVKA: refuses rather than answering Infinity lines per column when a measured line height quantises to zero", () => {
    const fit = copyfitting({
      characterCount: 1000,
      charactersPerLine: 60,
      columnHeight: 220,
      lineHeight: 0.004,
      columnsPerPage: 1,
    });
    expect(fit).toEqual({ ok: false, reason: "lineHeight" });
  });

  it("answers the reverse question: characters per line needed to land on exactly N pages", () => {
    const fit = copyfitting({
      characterCount: 45000,
      columnWidth: 82,
      averageCharacterWidth: 2.05,
      columnHeight: 220,
      lineHeight: 5.5,
      columnsPerPage: 2,
      targetPages: 12,
    });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    // requiredCPL = ceil(45000/(12*80)) = ceil(45000/960) = ceil(46.875) = 47.
    // Back-check: 47*960 = 45120 >= 45000, while 46*960 = 44160 < 45000.
    expect(fit.requiredCharactersPerLine).toBe(47);
  });

  it("ISPRAVKA: a paragraph count turns the lower bound into an exact upper bound too", () => {
    const fit = copyfitting({
      characterCount: 180000,
      charactersPerLine: 62,
      linesPerColumn: 38,
      columnsPerPage: 1,
      paragraphs: 40,
    });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    // totalLines (lower bound) = 2904, as above; upper bound = 2904 + 40 - 1 = 2943.
    expect(fit.totalLines).toBe(2904);
    expect(fit.totalLinesUpperBound).toBe(2943);
  });

  it("omits the upper bound when no paragraph count was given", () => {
    const fit = copyfitting({
      characterCount: 1000,
      charactersPerLine: 60,
      linesPerColumn: 40,
      columnsPerPage: 1,
    });
    expect(fit.ok).toBe(true);
    if (fit.ok) expect(fit.totalLinesUpperBound).toBeUndefined();
  });

  it("refuses a non-positive character count, an unresolved characters-per-line, or an unresolved lines-per-column", () => {
    expect(
      copyfitting({ characterCount: 0, charactersPerLine: 60, linesPerColumn: 40, columnsPerPage: 1 }),
    ).toEqual({ ok: false, reason: "characterCount" });
    expect(
      copyfitting({ characterCount: 1000, linesPerColumn: 40, columnsPerPage: 1 }),
    ).toEqual({ ok: false, reason: "columnWidth" });
    expect(
      copyfitting({ characterCount: 1000, charactersPerLine: 60, columnsPerPage: 1 }),
    ).toEqual({ ok: false, reason: "columnHeight" });
  });
});

describe("typographicUnits", () => {
  it("converts 16px through every unit, at the root font size it was given", () => {
    const units = typographicUnits({
      value: 16,
      fromUnit: "px",
      rootFontSize: 16,
      parentFontSize: 16,
      assetScale: 1,
    });
    expect(units.ok).toBe(true);
    if (!units.ok) return;
    // pt = 16 * 72/96 = 16 * 0.75 = 12.0000; pc = 12/12 = 1.0000.
    expect(units.pt).toBeCloseTo(12, 6);
    expect(units.pc).toBeCloseTo(1, 6);
    // in = 16/96 = 0.166667; mm = 0.1666667 * 25.4 = 4.2333.
    expect(units.inch).toBeCloseTo(0.166667, 6);
    expect(units.mm).toBeCloseTo(4.2333, 4);
    // rem at root 16 = 1.0000.
    expect(units.rem).toBeCloseTo(1, 6);
    // Q = 4.2333/0.25 = 16.9333.
    expect(units.q).toBeCloseTo(16.9333, 4);
    expect(units.rootFontSizeUsed).toBe(16);
  });

  it("converts 210mm to px and pt, and to device pixels at a given density", () => {
    const units = typographicUnits({
      value: 210,
      fromUnit: "mm",
      rootFontSize: 16,
      parentFontSize: 16,
      deviceDpi: 300,
      assetScale: 1,
    });
    expect(units.ok).toBe(true);
    if (!units.ok) return;
    // px = 210 * 96 / 25.4 = 20160 / 25.4 = 793.7008.
    expect(units.px).toBeCloseTo(793.7008, 4);
    // in = 210/25.4 = 8.267717; pt = 8.267717 * 72 = 595.2756.
    expect(units.inch).toBeCloseTo(8.267717, 6);
    expect(units.pt).toBeCloseTo(595.2756, 4);
    // At deviceDpi 300: 210 * 300 / 25.4 = 63000 / 25.4 = 2480.31 -> 2480 device px.
    expect(units.devicePx).toBe(2480);
    expect(units.deviceDpiUsed).toBe(300);
  });

  it("scales the export sizes from the unrounded px, at 1.5rem", () => {
    const units = typographicUnits({
      value: 1.5,
      fromUnit: "rem",
      rootFontSize: 16,
      parentFontSize: 16,
      assetScale: 2,
    });
    expect(units.ok).toBe(true);
    if (!units.ok) return;
    // 1.5rem at root 16 = 24.0000px = 18.0000pt = 0.250000in = 6.3500mm.
    expect(units.px).toBeCloseTo(24, 6);
    expect(units.pt).toBeCloseTo(18, 6);
    expect(units.inch).toBeCloseTo(0.25, 6);
    expect(units.mm).toBeCloseTo(6.35, 6);
    // @2x export = 48px, @3x = 72px — computed from the raw px either way.
    expect(units.assetPx2x).toBe(48);
    expect(units.assetPx3x).toBe(72);
    expect(units.assetPx).toBe(48); // assetScale 2
  });

  it("converts a quarter-millimetre unit: 40 Q", () => {
    const units = typographicUnits({
      value: 40,
      fromUnit: "Q",
      rootFontSize: 16,
      parentFontSize: 16,
      assetScale: 1,
    });
    expect(units.ok).toBe(true);
    if (!units.ok) return;
    // 40 Q = 40 * 0.25 = 10.0000mm = 10/25.4 = 0.393701in = 0.393701*96 = 37.7953px
    // = 28.3465pt.
    expect(units.mm).toBeCloseTo(10, 6);
    expect(units.inch).toBeCloseTo(0.393701, 6);
    expect(units.px).toBeCloseTo(37.7953, 4);
    expect(units.pt).toBeCloseTo(28.3465, 4);
  });

  it("converts Android dp both at a given device density and at the 160dpi CSS baseline", () => {
    const units = typographicUnits({
      value: 48,
      fromUnit: "dp",
      rootFontSize: 16,
      parentFontSize: 16,
      deviceDpi: 320,
      assetScale: 1,
    });
    expect(units.ok).toBe(true);
    if (!units.ok) return;
    // CSS px at the 160dpi baseline: 48 * 96/160 = 48 * 0.6 = 28.8000.
    expect(units.px).toBeCloseTo(28.8, 6);
    // device px at 320dpi: 48 * 320/160 = 96.
    expect(units.devicePx).toBe(96);
  });

  it("omits the device row entirely when no density was given, never defaulting to 96", () => {
    const units = typographicUnits({
      value: 16,
      fromUnit: "px",
      rootFontSize: 16,
      parentFontSize: 16,
      assetScale: 1,
    });
    expect(units.ok).toBe(true);
    if (!units.ok) return;
    expect(units.devicePx).toBeUndefined();
    expect(units.deviceDpiUsed).toBeUndefined();
  });

  it("refuses a non-finite value or a non-positive root/parent font size", () => {
    expect(
      typographicUnits({
        value: Number.NaN,
        fromUnit: "px",
        rootFontSize: 16,
        parentFontSize: 16,
        assetScale: 1,
      }),
    ).toEqual({ ok: false, reason: "value" });
    expect(
      typographicUnits({
        value: 16,
        fromUnit: "rem",
        rootFontSize: 0,
        parentFontSize: 16,
        assetScale: 1,
      }),
    ).toEqual({ ok: false, reason: "rootFontSize" });
    expect(
      typographicUnits({
        value: 16,
        fromUnit: "em",
        rootFontSize: 16,
        parentFontSize: -1,
        assetScale: 1,
      }),
    ).toEqual({ ok: false, reason: "parentFontSize" });
  });
});

describe("colourDifference", () => {
  it("is zero for two identical colours, without NaN from the achromatic branch", () => {
    const diff = colourDifference({
      colour1: { l: 50, a: 0, b: 0 },
      colour2: { l: 50, a: 0, b: 0 },
      de94Application: "graphicArts",
    });
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    // C1' = C2' = 0, so the standard's own achromatic branches fix Δh' = 0 and
    // hbar' = h1' + h2' — every difference is then exactly zero, not NaN.
    expect(diff.deltaE76).toBe(0);
    expect(diff.deltaE94).toBe(0);
    expect(diff.deltaE00).toBe(0);
  });

  it("hand-checks a bare lightness step: ΔE*ab = 1, ΔE00 = 0.9992 from a non-unit SL", () => {
    const diff = colourDifference({
      colour1: { l: 50, a: 0, b: 0 },
      colour2: { l: 51, a: 0, b: 0 },
      de94Application: "graphicArts",
    });
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    expect(diff.deltaE76).toBe(1);
    // Lbar' = 50.5, (Lbar'-50)^2 = 0.25; SL = 1 + 0.015*0.25/sqrt(20.25)
    // = 1 + 0.00375/4.5 = 1.000833. Chroma and hue terms are 0, RT = 0.
    expect(diff.deltaE00).toBeCloseTo(0.9992, 4);
    // Achromatic pair: ΔE94's chroma/hue terms are also 0, so ΔE94 = ΔL/kL94 = 1
    // exactly for graphic arts (kL94 = 1).
    expect(diff.deltaE94).toBe(1);
  });

  it("ISPRAVKA: the textile application LOCKS kL94 to 2, ignoring a typed kL override", () => {
    const diff = colourDifference({
      colour1: { l: 50, a: 0, b: 0 },
      colour2: { l: 51, a: 0, b: 0 },
      de94Application: "textiles",
      kL: 1, // an override that must NOT reach kL94 — it is CIEDE2000's own kL
    });
    expect(diff.ok).toBe(true);
    if (!diff.ok) return;
    // Textiles locks kL94 = 2 regardless of the typed kL, so ΔE94 = ΔL/2 = 0.5.
    expect(diff.kL94Used).toBe(2);
    expect(diff.deltaE94).toBe(0.5);
    // The typed kL of 1 is still the CIEDE2000 kL — it does not move ΔE00's SL
    // term away from the reference value used in the previous test.
    expect(diff.deltaE00).toBeCloseTo(0.9992, 4);
    expect(diff.kLUsed).toBe(1);
  });

  it("matches the published CIEDE2000 test data for two near-black hue pairs", () => {
    const pair1 = colourDifference({
      colour1: { l: 50, a: 2.6772, b: -79.7751 },
      colour2: { l: 50, a: 0, b: -82.7485 },
      de94Application: "graphicArts",
    });
    expect(pair1.ok).toBe(true);
    if (pair1.ok) {
      // Δa = -2.6772, Δa² = 7.16740; Δb = -2.9734, Δb² = 8.84111;
      // ΔE*ab = sqrt(16.00851) = 4.0011 (hand calculation).
      expect(pair1.deltaE76).toBeCloseTo(4.0011, 4);
      // ΔE00 = 2.0425 — CIE 142-2001 published test data, pair 1.
      expect(pair1.deltaE00).toBeCloseTo(2.0425, 4);
    }

    const pair2 = colourDifference({
      colour1: { l: 50, a: 2.49, b: -0.001 },
      colour2: { l: 50, a: -2.49, b: 0.0009 },
      de94Application: "graphicArts",
    });
    expect(pair2.ok).toBe(true);
    if (pair2.ok) {
      // Δa = -4.98, Δa² = 24.8004; Δb = 0.0019, Δb² ≈ 0; ΔE*ab = sqrt(24.8004) = 4.9800.
      expect(pair2.deltaE76).toBeCloseTo(4.98, 4);
      // ΔE00 = 7.1792 — published test data; the pair either side of a* = 0.
      expect(pair2.deltaE00).toBeCloseTo(7.1792, 4);
    }
  });

  it("ISPRAVKA: a neighbour 0.0001 away on b* catches the quadrant rule for hbar'", () => {
    // (50; 2.49; -0.001) -> (50; -2.49; 0.0011), one ten-thousandth away from the
    // 7.1792 pair above on b*, published at ΔE00 = 7.2195 — the review's own
    // check that the hbar' branch selection (not just Δh') is implemented right.
    const diff = colourDifference({
      colour1: { l: 50, a: 2.49, b: -0.001 },
      colour2: { l: 50, a: -2.49, b: 0.0011 },
      de94Application: "graphicArts",
    });
    expect(diff.ok).toBe(true);
    if (diff.ok) expect(diff.deltaE00).toBeCloseTo(7.2195, 4);
  });

  it("refuses an out-of-range lightness or a non-finite a*/b*, and a non-positive parametric factor", () => {
    expect(
      colourDifference({
        colour1: { l: 150, a: 0, b: 0 },
        colour2: { l: 50, a: 0, b: 0 },
        de94Application: "graphicArts",
      }),
    ).toEqual({ ok: false, reason: "colour1" });
    expect(
      colourDifference({
        colour1: { l: 50, a: 0, b: 0 },
        colour2: { l: 50, a: Number.NaN, b: 0 },
        de94Application: "graphicArts",
      }),
    ).toEqual({ ok: false, reason: "colour2" });
    expect(
      colourDifference({
        colour1: { l: 50, a: 0, b: 0 },
        colour2: { l: 51, a: 0, b: 0 },
        de94Application: "graphicArts",
        kL: 0,
      }),
    ).toEqual({ ok: false, reason: "kL" });
  });

  it("ISPRAVKA: refuses an unrecognised de94Application instead of silently computing the graphicArts condition", () => {
    // Unlike a display-only rounding mode, this selects between two DIFFERENT
    // published K1/K2/kL conditions, so a bad value must not silently pick one.
    expect(
      colourDifference({
        colour1: { l: 50, a: 0, b: 0 },
        colour2: { l: 51, a: 0, b: 0 },
        de94Application: "leather" as unknown as "graphicArts",
      }),
    ).toEqual({ ok: false, reason: "de94Application" });
  });
});

describe("srgbToLab", () => {
  it("converts sRGB white and black to their D65 Lab endpoints", () => {
    const white = srgbToLab({ r: 255, g: 255, b: 255 });
    expect(white.ok).toBe(true);
    if (white.ok) {
      expect(white.l).toBeCloseTo(100, 3);
      expect(white.a).toBeCloseTo(0, 3);
      expect(white.b).toBeCloseTo(0, 3);
      expect(white.illuminant).toBe("D65");
    }
    const black = srgbToLab({ r: 0, g: 0, b: 0 });
    expect(black.ok).toBe(true);
    if (black.ok) {
      expect(black.l).toBe(0);
      expect(black.a).toBe(0);
      expect(black.b).toBe(0);
    }
  });

  it("converts sRGB primary red to its well-known D65 Lab reading", () => {
    const red = srgbToLab({ r: 255, g: 0, b: 0 });
    expect(red.ok).toBe(true);
    if (!red.ok) return;
    // The standard reference conversion of sRGB (255,0,0) under D65: roughly
    // L* 53.24, a* 80.09, b* 67.20 — the commonly published figure for this
    // primary, reproduced here by the matrix and transfer function above.
    expect(red.l).toBeCloseTo(53.24, 1);
    expect(red.a).toBeCloseTo(80.09, 1);
    expect(red.b).toBeCloseTo(67.2, 1);
  });

  it("refuses a channel outside 0-255", () => {
    expect(srgbToLab({ r: 256, g: 0, b: 0 })).toEqual({ ok: false, reason: "r" });
    expect(srgbToLab({ r: 0, g: -1, b: 0 })).toEqual({ ok: false, reason: "g" });
    expect(srgbToLab({ r: 0, g: 0, b: 300 })).toEqual({ ok: false, reason: "b" });
  });
});

describe("eanBarcode", () => {
  it("computes the EAN-13 check digit, weight 3 on the EVEN positions counted from the left", () => {
    // Odd positions d1,d3,d5,d7,d9,d11 = 4,0,3,1,3,9 -> 20. Even positions
    // d2,d4,d6,d8,d10,d12 = 0,6,8,3,3,3 -> 23. sum = 20 + 3*23 = 89;
    // 89 mod 10 = 9; check = (10-9) mod 10 = 1.
    const ean = eanBarcode({ digits: "400638133393", symbology: "ean13", xDimension: 0.33 });
    expect(ean.ok).toBe(true);
    if (!ean.ok) return;
    expect(ean.weightedSum).toBe(89);
    expect(ean.checkDigit).toBe(1);
    expect(ean.code).toBe("4006381333931");
  });

  it("computes a second EAN-13 check digit", () => {
    // Odd = 5,0,2,4,2,4 -> 17. Even = 9,1,3,1,3,5 -> 22. sum = 17+66 = 83;
    // check = (10-3) mod 10 = 7.
    const ean = eanBarcode({ digits: "590123412345", symbology: "ean13", xDimension: 0.33 });
    expect(ean.ok).toBe(true);
    if (ean.ok) expect(ean.code).toBe("5901234123457");
  });

  it("computes the EAN-8 check digit, weight 3 on the ODD positions — the odd-length case", () => {
    // 3*(9+3+5+7) + (6+8+0) = 3*24 + 14 = 86; 86 mod 10 = 6; check = 4.
    const ean = eanBarcode({ digits: "9638507", symbology: "ean8", xDimension: 0.33 });
    expect(ean.ok).toBe(true);
    if (ean.ok) expect(ean.code).toBe("96385074");
  });

  it("computes the UPC-A check digit, also weight 3 on the odd positions", () => {
    // Odd d1,d3,d5,d7,d9,d11 = 0,6,0,2,1,5 -> 14, times 3 = 42. Even d2,d4,d6,d8,d10
    // = 3,0,0,9,4 -> 16. sum = 58; 58 mod 10 = 8; check = 2.
    const ean = eanBarcode({ digits: "03600029145", symbology: "upca", xDimension: 0.33 });
    expect(ean.ok).toBe(true);
    if (ean.ok) expect(ean.code).toBe("036000291452");
  });

  it("turns a sum ending in 0 into a check digit of 0, not 10 — the reason for the outer mod", () => {
    const ean = eanBarcode({ digits: "000000000000", symbology: "ean13", xDimension: 0.33 });
    expect(ean.ok).toBe(true);
    if (ean.ok) {
      expect(ean.weightedSum).toBe(0);
      expect(ean.checkDigit).toBe(0);
    }
  });

  it("computes symbol geometry at the nominal X-dimension and at a reduced one", () => {
    const nominal = eanBarcode({ digits: "400638133393", symbology: "ean13", xDimension: 0.33 });
    expect(nominal.ok).toBe(true);
    if (nominal.ok) {
      // width = 113 * 0.330 = 37.290mm; left quiet = 11*0.330 = 3.630mm;
      // right = 7*0.330 = 2.310mm; encoded = 95*0.330 = 31.350mm, and
      // 31.350 + 3.630 + 2.310 = 37.290mm. Bar height 22.85mm, magnification 100%.
      expect(nominal.totalModules).toBe(113);
      expect(nominal.symbolWidth).toBeCloseTo(37.29, 6);
      expect(nominal.leftQuietZone).toBeCloseTo(3.63, 6);
      expect(nominal.rightQuietZone).toBeCloseTo(2.31, 6);
      expect(nominal.encodedWidth).toBeCloseTo(31.35, 6);
      expect(nominal.magnification).toBeCloseTo(100, 6);
      expect(nominal.barHeight).toBeCloseTo(22.85, 6);
      // ISPRAVKA: the total height including the human-readable digits, GS1's
      // own nominal 25.93mm at 100% magnification.
      expect(nominal.totalHeight).toBeCloseTo(25.93, 6);
    }

    const reduced = eanBarcode({ digits: "400638133393", symbology: "ean13", xDimension: 0.264 });
    expect(reduced.ok).toBe(true);
    if (reduced.ok) {
      // magnification = 0.264/0.330 = 80.0%; width = 113*0.264 = 29.832mm;
      // bar height = 22.85*0.80 = 18.28mm.
      expect(reduced.magnification).toBeCloseTo(80, 6);
      expect(reduced.symbolWidth).toBeCloseTo(29.832, 6);
      expect(reduced.barHeight).toBeCloseTo(18.28, 6);
    }
  });

  it("ISPRAVKA: accepts a magnification percentage in place of an X-dimension, and reports both", () => {
    const ean = eanBarcode({
      digits: "400638133393",
      symbology: "ean13",
      magnificationPercent: 85,
    });
    expect(ean.ok).toBe(true);
    if (!ean.ok) return;
    // xDimension = 0.85 * 0.330 = 0.2805mm; magnification derived back from
    // THAT xDimension is exactly 85, never a value rounded and re-multiplied.
    expect(ean.xDimension).toBeCloseTo(0.2805, 6);
    expect(ean.magnification).toBeCloseTo(85, 6);
    // barHeight = 22.85 * 0.85 = 19.4225; totalHeight = 25.93 * 0.85 = 22.0405.
    expect(ean.barHeight).toBeCloseTo(19.4225, 4);
    expect(ean.totalHeight).toBeCloseTo(22.0405, 4);
  });

  it("ISPRAVKA: refuses xDimension and magnificationPercent typed together rather than silently discarding one", () => {
    const ean = eanBarcode({
      digits: "400638133393",
      symbology: "ean13",
      xDimension: 0.33,
      magnificationPercent: 85,
    });
    expect(ean).toEqual({ ok: false, reason: "magnificationPercent" });
  });

  it("compares a printed check digit against the computed one, as two digits and nothing more", () => {
    const ean = eanBarcode({
      digits: "400638133393",
      symbology: "ean13",
      xDimension: 0.33,
      verifyDigits: "4006381333931",
    });
    expect(ean.ok).toBe(true);
    if (ean.ok) {
      expect(ean.verification).toEqual({ typed: 1, computed: 1, matches: true });
    }

    const mismatch = eanBarcode({
      digits: "400638133393",
      symbology: "ean13",
      xDimension: 0.33,
      verifyDigits: "4006381333939",
    });
    expect(mismatch.ok).toBe(true);
    if (mismatch.ok) {
      expect(mismatch.verification).toEqual({ typed: 9, computed: 1, matches: false });
    }
  });

  it("ISPRAVKA: refuses a verifyDigits length that does not match the SELECTED symbology", () => {
    // 12 digits is a whole UPC-A code and also a whole EAN-13 without its check
    // digit — accepting it here would check an EAN-13 label with the UPC-A
    // parity rule (11 digits) and answer wrong.
    const ean = eanBarcode({
      digits: "400638133393",
      symbology: "ean13",
      xDimension: 0.33,
      verifyDigits: "036000291452", // valid length for UPC-A, not for EAN-13
    });
    expect(ean).toEqual({ ok: false, reason: "verifyDigits" });
  });

  it("refuses digits of the wrong length, non-digit characters, and a missing xDimension/magnification", () => {
    expect(eanBarcode({ digits: "12345", symbology: "ean13", xDimension: 0.33 })).toEqual({
      ok: false,
      reason: "digits",
    });
    expect(eanBarcode({ digits: "40063813339X", symbology: "ean13", xDimension: 0.33 })).toEqual({
      ok: false,
      reason: "digits",
    });
    expect(eanBarcode({ digits: "400638133393", symbology: "ean13" })).toEqual({
      ok: false,
      reason: "xDimension",
    });
  });
});

describe("fontMetricsTrim", () => {
  it("computes the trim margins and confirms the invariant trimTop + cap + trimBottom = lineHeight", () => {
    const trim = fontMetricsTrim({
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      lineGap: 0,
      capHeight: 700,
      fontSize: 32,
      lineHeight: 48,
      metricSource: "hhea",
    });
    expect(trim.ok).toBe(true);
    if (!trim.ok) return;
    // s = 32/1000 = 0.032; contentArea = (800+200+0)*0.032 = 32.000000;
    // halfLeading = (48-32)/2 = 8.000000; gapHalf = 0; capPx = 700*0.032 = 22.400000;
    // trimTop = 8 + 0 + (800-700)*0.032 = 8 + 3.2 = 11.200000;
    // trimBottom = 8 + 0 + 200*0.032 = 8 + 6.4 = 14.400000.
    expect(trim.unitScale).toBeCloseTo(0.032, 6);
    expect(trim.contentArea).toBeCloseTo(32, 6);
    expect(trim.halfLeading).toBeCloseTo(8, 6);
    expect(trim.capHeightPx).toBeCloseTo(22.4, 6);
    expect(trim.trimTop).toBeCloseTo(11.2, 6);
    expect(trim.trimBottom).toBeCloseTo(14.4, 6);
    // Invariant check: 11.2 + 22.4 + 14.4 = 48.000000 = lineHeight.
    expect(trim.trimTop + trim.capHeightPx + trim.trimBottom).toBeCloseTo(48, 6);
    expect(trim.marginTop).toBeCloseTo(-11.2, 6);
    expect(trim.marginBottom).toBeCloseTo(-14.4, 6);
    expect(trim.metricSourceUsed).toBe("hhea");
  });

  it("computes em-relative trims from a TrueType 2048-unit face", () => {
    const trim = fontMetricsTrim({
      unitsPerEm: 2048,
      ascender: 1854,
      descender: -434,
      lineGap: 67,
      capHeight: 1462,
      fontSize: 16,
      lineHeight: 24,
      metricSource: "os2Typo",
    });
    expect(trim.ok).toBe(true);
    if (!trim.ok) return;
    // s = 16/2048 = 0.0078125; contentArea = 2355*0.0078125 = 18.398438;
    // halfLeading = (24 - 18.398438)/2 = 2.800781; gapHalf = 67*0.0078125/2 = 0.261719;
    // capPx = 1462*0.0078125 = 11.421875;
    // trimTop = 2.800781 + 0.261719 + 392*0.0078125 = 3.0625 + 3.0625 = 6.125000 px
    //         = 6.125/16 = 0.382813 em;
    // trimBottom = 2.800781 + 0.261719 + 434*0.0078125 = 3.0625 + 3.390625 = 6.453125 px
    //            = 0.403320 em.
    expect(trim.contentArea).toBeCloseTo(18.398438, 5);
    expect(trim.halfLeading).toBeCloseTo(2.800781, 5);
    expect(trim.capHeightPx).toBeCloseTo(11.421875, 5);
    expect(trim.trimTop).toBeCloseTo(6.125, 5);
    expect(trim.trimTopEm).toBeCloseTo(0.382813, 5);
    expect(trim.trimBottom).toBeCloseTo(6.453125, 5);
    expect(trim.trimBottomEm).toBeCloseTo(0.40332, 5);
    // Invariant: 6.125 + 11.421875 + 6.453125 = 24.000000 = lineHeight.
    expect(trim.trimTop + trim.capHeightPx + trim.trimBottom).toBeCloseTo(24, 5);
  });

  it("does not clamp a negative half-leading or a negative top trim", () => {
    const trim = fontMetricsTrim({
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      lineGap: 0,
      capHeight: 700,
      fontSize: 32,
      lineHeight: 24, // shorter than the 32px content area
      metricSource: "hhea",
    });
    expect(trim.ok).toBe(true);
    if (!trim.ok) return;
    // contentArea = 32.000000; halfLeading = (24-32)/2 = -4.000000 (not clamped);
    // trimTop = -4 + 3.2 = -0.800000; trimBottom = -4 + 6.4 = 2.400000.
    expect(trim.halfLeading).toBeCloseTo(-4, 6);
    expect(trim.trimTop).toBeCloseTo(-0.8, 6);
    expect(trim.trimBottom).toBeCloseTo(2.4, 6);
    // Check: -0.8 + 22.4 + 2.4 = 24.000000.
    expect(trim.trimTop + trim.capHeightPx + trim.trimBottom).toBeCloseTo(24, 6);
  });

  it("ISPRAVKA: the lineGap cancels out of both trims exactly, regardless of its value", () => {
    const noGap = fontMetricsTrim({
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      lineGap: 0,
      capHeight: 700,
      fontSize: 32,
      lineHeight: 48,
      metricSource: "hhea",
    });
    const bigGap = fontMetricsTrim({
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      lineGap: 300, // a rival convention's much larger line gap
      capHeight: 700,
      fontSize: 32,
      lineHeight: 48,
      metricSource: "hhea",
    });
    expect(noGap.ok && bigGap.ok).toBe(true);
    if (!noGap.ok || !bigGap.ok) return;
    // halfLeading + gapHalf reduces algebraically to (lineHeight - asc - desc)/2,
    // with lineGapPx cancelled — so the trims are identical however large the gap.
    expect(bigGap.trimTop).toBeCloseTo(noGap.trimTop, 9);
    expect(bigGap.trimBottom).toBeCloseTo(noGap.trimBottom, 9);
    // Only the reported content area differs, since IT includes the gap.
    expect(bigGap.contentArea).not.toBeCloseTo(noGap.contentArea, 3);
  });

  it("echoes the declared metric source without it affecting the arithmetic", () => {
    const win = fontMetricsTrim({
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      lineGap: 0,
      capHeight: 700,
      fontSize: 32,
      lineHeight: 48,
      metricSource: "os2Win",
    });
    expect(win.ok).toBe(true);
    if (win.ok) expect(win.metricSourceUsed).toBe("os2Win");
  });

  it("refuses a non-positive ascender, a zero descender, an unknown metric source, or a cap height above the em box", () => {
    expect(
      fontMetricsTrim({
        unitsPerEm: 1000,
        ascender: 0,
        descender: -200,
        lineGap: 0,
        capHeight: 700,
        fontSize: 32,
        lineHeight: 48,
        metricSource: "hhea",
      }),
    ).toEqual({ ok: false, reason: "ascender" });
    expect(
      fontMetricsTrim({
        unitsPerEm: 1000,
        ascender: 800,
        descender: 0,
        lineGap: 0,
        capHeight: 700,
        fontSize: 32,
        lineHeight: 48,
        metricSource: "hhea",
      }),
    ).toEqual({ ok: false, reason: "descender" });
    expect(
      fontMetricsTrim({
        unitsPerEm: 1000,
        ascender: 800,
        descender: -200,
        lineGap: 0,
        capHeight: 700,
        fontSize: 32,
        lineHeight: 48,
        metricSource: "os2" as unknown as "hhea",
      }),
    ).toEqual({ ok: false, reason: "metricSource" });
  });
});

describe("isoPaperSize", () => {
  it("builds A4 by the halve-and-floor recurrence from the A0 anchor", () => {
    // A0 841x1189 -> A1 floor(1189/2)=594,841 -> A2 floor(841/2)=420,594 ->
    // A3 floor(594/2)=297,420 -> A4 floor(420/2)=210,297.
    const a4 = isoPaperSize({ series: "A", index: 4, matchTolerance: 2 });
    expect(a4.ok).toBe(true);
    if (!a4.ok) return;
    expect(a4.shortEdge).toBe(210);
    expect(a4.longEdge).toBe(297);
    // Area = 210*297 = 62370mm² = 0.062370m² = 623.70cm².
    expect(a4.areaM2).toBeCloseTo(0.06237, 6);
    expect(a4.areaCm2).toBeCloseTo(623.7, 6);
    // Diagonal = sqrt(44100+88209) = sqrt(132309) = 363.743mm.
    expect(a4.diagonal).toBeCloseTo(363.743, 3);
    // Actual ratio 297/210 = 1.414286, drifted off √2 = 1.414214 by the floors.
    expect(a4.ratio).toBeCloseTo(1.414286, 6);
    expect(a4.nominalRatio).toBeCloseTo(Math.SQRT2, 9);
    // A4's flat envelope is C4 and its folded-once envelope is C5.
    expect(a4.envelopeFlat).toMatchObject({ shortEdge: 229, longEdge: 324 });
    expect(a4.envelopeFoldedOnce).toMatchObject({ shortEdge: 162, longEdge: 229 });
  });

  it("floors TWICE on B5, exactly matching the published 176x250", () => {
    // B0 1000x1414 -> B1 floor(1414/2)=707,1000 -> B2 floor(1000/2)=500,707 ->
    // B3 floor(707/2)=353 (353.5 down),500 -> B4 floor(500/2)=250,353 ->
    // B5 floor(353/2)=176 (176.5 down),250.
    const b5 = isoPaperSize({ series: "B", index: 5, matchTolerance: 2 });
    expect(b5.ok).toBe(true);
    if (b5.ok) {
      expect(b5.shortEdge).toBe(176);
      expect(b5.longEdge).toBe(250);
    }
  });

  it("builds C5, the envelope that takes A5 flat and A4 folded once", () => {
    // C0 917x1297 -> C1 648,917 -> C2 458,648 -> C3 324,458 -> C4 229,324 ->
    // C5 162,229.
    const c5 = isoPaperSize({ series: "C", index: 5, matchTolerance: 2 });
    expect(c5.ok).toBe(true);
    if (c5.ok) {
      expect(c5.shortEdge).toBe(162);
      expect(c5.longEdge).toBe(229);
    }
  });

  it("computes the same-series copier scale A4->A3 and its inverse A3->A4", () => {
    const upscale = isoPaperSize({
      series: "A",
      index: 4,
      targetSeries: "A",
      targetIndex: 3,
      matchTolerance: 2,
    });
    expect(upscale.ok).toBe(true);
    if (upscale.ok) {
      // min(297/210, 420/297)*100 = min(1.414286, 1.414141)*100 = 141.4141% -> 141%.
      expect(upscale.copierScale).toBeCloseTo(141.4141, 3);
      expect(upscale.copierScaleRounded).toBe(141);
      // Nominal count is same-series-only and requires target AFTER source: undefined here.
      expect(upscale.nominalCount).toBeUndefined();
    }

    const downscale = isoPaperSize({
      series: "A",
      index: 3,
      targetSeries: "A",
      targetIndex: 4,
      matchTolerance: 2,
    });
    expect(downscale.ok).toBe(true);
    if (downscale.ok) {
      // min(210/297, 297/420)*100 = min(0.707071, 0.707143)*100 = 70.7071% -> 71%.
      expect(downscale.copierScale).toBeCloseTo(70.7071, 3);
      expect(downscale.copierScaleRounded).toBe(71);
    }
  });

  it("computes A5->A3 exactly at 200%, the vector where the min-ratio picks the exact axis", () => {
    const scale = isoPaperSize({
      series: "A",
      index: 5,
      targetSeries: "A",
      targetIndex: 3,
      matchTolerance: 2,
    });
    expect(scale.ok).toBe(true);
    if (!scale.ok) return;
    // A5 = 148x210, A3 = 297x420. min(297/148, 420/210)*100 = min(2.006757, 2.000000)*100
    // = 200.0000%.
    expect(scale.copierScale).toBeCloseTo(200, 3);
    expect(scale.copierScaleRounded).toBe(200);
  });

  it("ISPRAVKA: computes a CROSS-series copier scale, A4 -> C4, as 109% rather than the same-series 100%", () => {
    const scale = isoPaperSize({
      series: "A",
      index: 4,
      targetSeries: "C",
      targetIndex: 4,
      matchTolerance: 2,
    });
    expect(scale.ok).toBe(true);
    if (!scale.ok) return;
    // A4 = 210x297, C4 = 229x324. min(229/210, 324/297)*100
    // = min(1.090476, 1.090909)*100 = 109.0476%.
    expect(scale.copierScale).toBeCloseTo(109.0476, 3);
    expect(scale.copierScaleRounded).toBe(109);
  });

  it("counts how many A4 sheets nominally fit an A0, and flags the caveat with A1/A2", () => {
    const a0 = isoPaperSize({ series: "A", index: 0, targetIndex: 4, matchTolerance: 2 });
    expect(a0.ok).toBe(true);
    // Nominal count of A4 inside A0: 2^(4-0) = 16.
    if (a0.ok) expect(a0.nominalCount).toBe(16);

    // Cutting check: A1 is 594x841, two A2 (420x594) side by side are
    // 840x594 — one millimetre narrower, exactly as the floor rule implies.
    const a1 = isoPaperSize({ series: "A", index: 1, matchTolerance: 2 });
    const a2 = isoPaperSize({ series: "A", index: 2, matchTolerance: 2 });
    expect(a1.ok && a2.ok).toBe(true);
    if (a1.ok && a2.ok) expect(2 * a2.shortEdge).toBeLessThan(a1.longEdge);
  });

  it("ISPRAVKA: matches a measured sheet by the WORST axis, not the summed error", () => {
    // 211x296 against A4 (210x297): deltaShort = 1, deltaLong = -1, both axes
    // equally off. max(|1|,|-1|) = 1, inside a tolerance of 2.
    const close = isoPaperSize({
      series: "A",
      index: 4,
      matchTolerance: 2,
      measuredWidth: 211,
      measuredHeight: 296,
    });
    expect(close.ok).toBe(true);
    if (close.ok) {
      expect(close.match).toMatchObject({ series: "A", index: 4 });
    }

    // The same sheet against a tolerance of 0.5: the worst axis (1mm) exceeds
    // it, so there is no match — even though the SUM (2mm) would have been
    // within a looser, sum-based tolerance of the same number.
    const tooTight = isoPaperSize({
      series: "A",
      index: 4,
      matchTolerance: 0.5,
      measuredWidth: 211,
      measuredHeight: 296,
    });
    expect(tooTight.ok).toBe(true);
    if (tooTight.ok) expect(tooTight.match).toBeUndefined();
  });

  it("ISPRAVKA: recognises the RA and SRA series, built by the identical halve-and-floor rule", () => {
    // SRA0 900x1280 -> SRA1 floor(1280/2)=640,900 -> SRA2 floor(900/2)=450,640 ->
    // SRA3 floor(640/2)=320,450 — the sheet the sheet-imposition tool's own
    // test vector uses.
    const sra3 = isoPaperSize({ series: "SRA", index: 3, matchTolerance: 2 });
    expect(sra3.ok).toBe(true);
    if (sra3.ok) {
      expect(sra3.shortEdge).toBe(320);
      expect(sra3.longEdge).toBe(450);
    }
    // RA0 860x1220 -> RA1 floor(1220/2)=610,860.
    const ra1 = isoPaperSize({ series: "RA", index: 1, matchTolerance: 2 });
    expect(ra1.ok).toBe(true);
    if (ra1.ok) {
      expect(ra1.shortEdge).toBe(610);
      expect(ra1.longEdge).toBe(860);
    }
  });

  it("refuses an out-of-range index or an out-of-range match tolerance", () => {
    expect(isoPaperSize({ series: "A", index: 11, matchTolerance: 2 })).toEqual({
      ok: false,
      reason: "index",
    });
    expect(isoPaperSize({ series: "A", index: -1, matchTolerance: 2 })).toEqual({
      ok: false,
      reason: "index",
    });
    expect(isoPaperSize({ series: "A", index: 4, matchTolerance: 11 })).toEqual({
      ok: false,
      reason: "matchTolerance",
    });
  });
});

describe("modularTypeScale", () => {
  it("builds a geometric scale from the raw base, never compounding a rounded step into the next", () => {
    const scale = modularTypeScale({
      baseSize: 16,
      baseUnit: "px",
      ratio: 1.25,
      stepsUp: 5,
      stepsDown: 0,
      rootFontSize: 16,
      rounding: "pixel",
    });
    expect(scale.ok).toBe(true);
    if (!scale.ok) return;
    expect(scale.basePx).toBe(16);
    // step5 = 16 * 1.25^5 = 16 * 3.0517578125 = 48.828125 — computed straight
    // from the base, not by repeatedly multiplying a rounded previous step (a
    // compounding implementation would drift by the time it reaches step 5).
    const step5 = scale.steps[5];
    expect(step5?.step).toBe(5);
    expect(step5?.px).toBeCloseTo(48.828125, 9);
    expect(step5?.roundedPx).toBe(49);
    // rem/pt are derived from the RAW px, not the rounded column.
    expect(step5?.rem).toBeCloseTo(48.828125 / 16, 9);
    expect(step5?.pt).toBeCloseTo(48.828125 * 0.75, 9);
  });

  it("is symmetric about the base: a negative step is 1/ratio^n, not repeated division", () => {
    const scale = modularTypeScale({
      baseSize: 16,
      baseUnit: "px",
      ratio: 2,
      stepsUp: 1,
      stepsDown: 1,
      rootFontSize: 16,
      rounding: "none",
    });
    expect(scale.ok).toBe(true);
    if (!scale.ok) return;
    const down = scale.steps.find((s) => s.step === -1);
    const up = scale.steps.find((s) => s.step === 1);
    // 16/2 = 8 and 16*2 = 32 — the base sits at the geometric midpoint (8*32=256=16^2).
    expect(down?.px).toBeCloseTo(8, 9);
    expect(up?.px).toBeCloseTo(32, 9);
  });

  it("applies each rounding mode independently to the same raw step", () => {
    // Base 10, ratio 1.5 (perfectFifth), step 2 raw = 10 * 1.5^2 = 22.5.
    const raw = { baseSize: 10, baseUnit: "px" as const, ratio: 1.5, rootFontSize: 16 };
    const pixel = modularTypeScale({ ...raw, stepsUp: 2, stepsDown: 0, rounding: "pixel" });
    const half = modularTypeScale({ ...raw, stepsUp: 2, stepsDown: 0, rounding: "halfPixel" });
    const four = modularTypeScale({ ...raw, stepsUp: 2, stepsDown: 0, rounding: "fourPixel" });
    expect(pixel.ok && half.ok && four.ok).toBe(true);
    if (!pixel.ok || !half.ok || !four.ok) return;
    // Math.round(22.5) = 23 (rounds .5 up).
    expect(pixel.steps[2]?.roundedPx).toBe(23);
    // 22.5 is already a half-pixel: round(22.5*2)/2 = round(45)/2 = 45/2 = 22.5.
    expect(half.steps[2]?.roundedPx).toBeCloseTo(22.5, 9);
    // round(22.5/4)*4 = round(5.625)*4 = 6*4 = 24.
    expect(four.steps[2]?.roundedPx).toBe(24);
  });

  it("ISPRAVKA: converts a pt base to px by dividing by 0.75, not multiplying — base 12pt, ratio 4/3", () => {
    const scale = modularTypeScale({
      baseSize: 12,
      baseUnit: "pt",
      ratio: 4 / 3,
      stepsUp: 3,
      stepsDown: 0,
      rootFontSize: 16,
      rounding: "none",
    });
    expect(scale.ok).toBe(true);
    if (!scale.ok) return;
    // basePx = 12pt / 0.75 = 12 * 96/72 = 16.000000px — the correct direction:
    // a pt base is DIVIDED by 0.75 to reach px (equivalently, multiplied by
    // 96/72), never multiplied by 0.75 the other way round.
    expect(scale.basePx).toBeCloseTo(16, 9);
    const step3 = scale.steps[3];
    // step3 = 16 * (4/3)^3 = 16 * 64/27 = 1024/27 = 37.925926px;
    // pt = 37.925926 / (96/72) = 37.925926 * 0.75 = 28.444444pt.
    expect(step3?.px).toBeCloseTo(37.925926, 5);
    expect(step3?.pt).toBeCloseTo(28.444444, 5);
  });

  it("refuses an unrecognised baseUnit or rounding mode instead of silently defaulting", () => {
    const base = {
      baseSize: 16,
      baseUnit: "px" as const,
      ratio: 1.25,
      stepsUp: 2,
      stepsDown: 2,
      rootFontSize: 16,
      rounding: "none" as const,
    };
    expect(modularTypeScale({ ...base, baseUnit: "vw" as unknown as "px" })).toEqual({
      ok: false,
      reason: "baseUnit",
    });
    expect(modularTypeScale({ ...base, rounding: "eighthPixel" as unknown as "none" })).toEqual({
      ok: false,
      reason: "rounding",
    });
  });

  it("refuses a non-positive base, a ratio at or below 1, out-of-range steps, or a non-positive root", () => {
    const base = {
      baseSize: 16,
      baseUnit: "px" as const,
      ratio: 1.25,
      stepsUp: 2,
      stepsDown: 2,
      rootFontSize: 16,
      rounding: "none" as const,
    };
    expect(modularTypeScale({ ...base, baseSize: 0 })).toEqual({ ok: false, reason: "baseSize" });
    expect(modularTypeScale({ ...base, ratio: 1 })).toEqual({ ok: false, reason: "ratio" });
    expect(modularTypeScale({ ...base, stepsUp: 13 })).toEqual({ ok: false, reason: "stepsUp" });
    expect(modularTypeScale({ ...base, stepsDown: -1 })).toEqual({
      ok: false,
      reason: "stepsDown",
    });
    expect(modularTypeScale({ ...base, rootFontSize: 0 })).toEqual({
      ok: false,
      reason: "rootFontSize",
    });
  });
});

describe("paperWeight", () => {
  it("computes sheet and job mass from grammage, and reverses to a measured grammage", () => {
    // A4 210x297mm: area = 210*297/1e6 = 0.06237 m². Sheet mass at 80gsm =
    // 80*0.06237 = 4.9896g. 500 sheets = 2494.8g = 2.4948kg.
    const result = paperWeight({
      grammage: 80,
      sheetWidth: 210,
      sheetHeight: 297,
      sheetCount: 500,
      measuredMass: 2500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.areaM2).toBeCloseTo(0.06237, 6);
    expect(result.sheetMass).toBeCloseTo(4.9896, 6);
    expect(result.totalMass).toBeCloseTo(2494.8, 6);
    expect(result.totalMassKg).toBeCloseTo(2.4948, 6);
    // measuredGrammage = measuredMass / (sheetCount * areaM2) = 2500 / (500*0.06237)
    // = 2500 / 31.185 = 80.166746...
    expect(result.measuredGrammage).toBeCloseTo(80.166746, 5);
  });

  it("reverses a weighed roll to a running length", () => {
    // rollLength = rollMass_kg * 1e6 / (grammage * rollWidth) = 50*1e6/(80*1000)
    // = 50000000/80000 = 625m, exactly.
    const result = paperWeight({
      grammage: 80,
      sheetWidth: 210,
      sheetHeight: 297,
      sheetCount: 1,
      rollWidth: 1000,
      rollMass: 50,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rollLength).toBeCloseTo(625, 9);
  });

  it("ISPRAVKA-guarded: a width without a mass (or a mass without a width) cannot give a length, so it refuses rather than guesses", () => {
    const base = { grammage: 80, sheetWidth: 210, sheetHeight: 297, sheetCount: 1 };
    expect(paperWeight({ ...base, rollWidth: 1000 })).toEqual({ ok: false, reason: "rollMass" });
    expect(paperWeight({ ...base, rollMass: 50 })).toEqual({ ok: false, reason: "rollWidth" });
  });

  it("refuses non-positive grammage, sheet dimensions, or an out-of-range sheet count", () => {
    const base = { grammage: 80, sheetWidth: 210, sheetHeight: 297, sheetCount: 500 };
    expect(paperWeight({ ...base, grammage: 0 })).toEqual({ ok: false, reason: "grammage" });
    expect(paperWeight({ ...base, sheetWidth: -1 })).toEqual({ ok: false, reason: "sheetWidth" });
    expect(paperWeight({ ...base, sheetCount: 0 })).toEqual({ ok: false, reason: "sheetCount" });
  });
});

describe("printResolution", () => {
  it("converts px to size and reports the artboard rounded UP so it never comes up short of the bleed", () => {
    // A4 210mm at 300ppi -> round(210*300/25.4) = round(2480.31496) = 2480px —
    // the "2480px A4" the module's own docstring cites.
    const px = printResolution({
      widthPx: 2480,
      heightPx: 2480,
      resolution: 300,
      direction: "pxToSize",
      bleed: 0,
      scaleDenominator: 1,
      channels: 3,
      bitsPerChannel: 8,
    });
    expect(px.ok).toBe(true);
    if (!px.ok) return;
    // widthMm = 2480*25.4/300 = 62992/300 = 209.973333...mm, the exact figure
    // the docstring names.
    expect(px.widthMm).toBeCloseTo(209.973333, 5);
    expect(px.megapixels).toBeCloseTo((2480 * 2480) / 1e6, 9);

    const withBleed = printResolution({
      widthPx: 1000,
      heightPx: 1000,
      resolution: 300,
      direction: "pxToSize",
      bleed: 3,
      scaleDenominator: 1,
      channels: 3,
      bitsPerChannel: 8,
    });
    expect(withBleed.ok).toBe(true);
    if (!withBleed.ok) return;
    // widthMm = 1000*25.4/300 = 84.666667mm; artboardWidthMm = +6 = 90.666667mm.
    // artboardWidthPx = ceil(90.666667*300/25.4) = ceil(27200/25.4) = ceil(1070.8661)
    // = 1071 — one more than plain rounding (1071) would coincidentally also give
    // here, so this is re-checked against a bleed that DOES cross a boundary below.
    expect(withBleed.artboardWidthMm).toBeCloseTo(90.666667, 5);
    expect(withBleed.artboardWidthPx).toBe(1071);
    expect(withBleed.bytes).toBe(1000 * 1000 * 3 * 8 * 0.125);
    expect(withBleed.mebibytes).toBeCloseTo(3000000 / 1048576, 9);
  });

  it("ISPRAVKA-adjacent: the artboard ceils even when plain rounding would floor", () => {
    // Pick a size where round() and ceil() of the raw px genuinely disagree:
    // widthMm=100, ppi=300 -> raw px = 100*300/25.4 = 1181.10236... round()
    // would give 1181, but ceil() (the artboard rule) must give 1182.
    const result = printResolution({
      physicalWidth: 100,
      physicalHeight: 100,
      resolution: 300,
      direction: "sizeToPx",
      bleed: 0,
      scaleDenominator: 1,
      channels: 1,
      bitsPerChannel: 8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.widthPx).toBe(1181); // informative read-out: plain round().
    expect(result.artboardWidthPx).toBe(1182); // artboard: ceil().
  });

  it("computes effective ppi per axis and flags disagreement rather than averaging", () => {
    // A4-ish scan: 2480x3508px over 210x297mm.
    // ppiWidth = 2480*25.4/210 = 62992/210 = 299.961905
    // ppiHeight = 3508*25.4/297 = 89103.2/297 = 300.010774
    const result = printResolution({
      widthPx: 2480,
      heightPx: 3508,
      physicalWidth: 210,
      physicalHeight: 297,
      direction: "effectivePpi",
      bleed: 0,
      scaleDenominator: 1,
      channels: 3,
      bitsPerChannel: 8,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ppiWidth).toBeCloseTo(299.961905, 5);
    expect(result.ppiHeight).toBeCloseTo(300.010774, 5);
    // |ppiWidth - ppiHeight| = 0.048869 > 0.01 -> axes disagree.
    expect(result.axesDisagree).toBe(true);
  });

  it("reads physical units other than mm through the same mm-anchored identity", () => {
    // 1 inch at 96ppi = 96px exactly: widthMm = 1*25.4 = 25.4mm,
    // px = round(25.4*96/25.4) = round(96) = 96.
    const result = printResolution({
      physicalWidth: 1,
      physicalHeight: 1,
      physicalUnit: "in",
      resolution: 96,
      direction: "sizeToPx",
      bleed: 0,
      scaleDenominator: 1,
      channels: 1,
      bitsPerChannel: 8,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.widthPx).toBe(96);
      expect(result.widthMm).toBeCloseTo(25.4, 9);
    }
  });

  it("refuses negative bleed, a scale denominator below 1, an out-of-range channel count, an unsupported bit depth, and an unknown direction", () => {
    const base = {
      widthPx: 100,
      heightPx: 100,
      resolution: 300,
      direction: "pxToSize" as const,
      bleed: 0,
      scaleDenominator: 1,
      channels: 3,
      bitsPerChannel: 8,
    };
    expect(printResolution({ ...base, bleed: -1 })).toEqual({ ok: false, reason: "bleed" });
    expect(printResolution({ ...base, scaleDenominator: 0.5 })).toEqual({
      ok: false,
      reason: "scaleDenominator",
    });
    expect(printResolution({ ...base, channels: 9 })).toEqual({ ok: false, reason: "channels" });
    expect(printResolution({ ...base, bitsPerChannel: 4 as unknown as 8 })).toEqual({
      ok: false,
      reason: "bitsPerChannel",
    });
    expect(printResolution({ ...base, direction: "sideways" as unknown as "pxToSize" })).toEqual({
      ok: false,
      reason: "direction",
    });
  });
});

describe("rollYield", () => {
  it("packs pieces across the web and rows down the length using the shared packCount rule", () => {
    // usableWidth = 1000 - 0 = 1000. across = floor(1000/200) = 5
    // (5*200=1000<=1000; 6*200=1200>1000). rows = ceil(10/5) = 2.
    // lengthMm = 2*(300+0) - 0 + 2*0 = 600mm = 0.6m. produced = 10.
    const result = rollYield({
      rollWidth: 1000,
      pieceWidth: 200,
      pieceHeight: 300,
      sideMargin: 0,
      gutter: 0,
      leadTrailMargin: 0,
      quantity: 10,
      allowRotation: true,
      rollLength: 1,
      pricePerMetre: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usableWidth).toBe(1000);
    expect(result.upright.across).toBe(5);
    expect(result.upright.leftoverWidth).toBe(0);
    expect(result.upright.rows).toBe(2);
    expect(result.upright.lengthMm).toBeCloseTo(600, 9);
    expect(result.upright.produced).toBe(10);
    // rowsPerRoll = floor(1000/300) = 3 (900<=1000<1200); rolls = ceil(2/3) = 1.
    expect(result.upright.rolls).toBe(1);
    expect(result.upright.cost).toBeCloseTo(0.6 * 3, 9);

    // Rotated: across = floor(1000/300) = 3, rows = ceil(10/3) = 4,
    // lengthMm = 4*200 = 800mm > upright's 600mm -> upright is shorter.
    expect(result.rotated?.across).toBe(3);
    expect(result.rotated?.lengthMm).toBeCloseTo(800, 9);
    expect(result.shorter).toBe("upright");
  });

  it("ISPRAVKA: a piece wider than the usable web reports zero across and the full leftover, never a division artefact", () => {
    const result = rollYield({
      rollWidth: 1000,
      pieceWidth: 1500,
      pieceHeight: 300,
      sideMargin: 0,
      gutter: 0,
      leadTrailMargin: 0,
      quantity: 1,
      allowRotation: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.upright.across).toBe(0);
    expect(result.upright.leftoverWidth).toBe(1000);
    expect(result.upright.rows).toBeUndefined();
    expect(result.upright.rolls).toBeUndefined();
    expect(result.shorter).toBeUndefined();
  });

  it("refuses a non-positive roll or piece dimension, an out-of-range quantity, and a non-positive roll length", () => {
    const base = {
      rollWidth: 1000,
      pieceWidth: 200,
      pieceHeight: 300,
      sideMargin: 0,
      gutter: 0,
      leadTrailMargin: 0,
      quantity: 10,
      allowRotation: false,
    };
    expect(rollYield({ ...base, rollWidth: 0 })).toEqual({ ok: false, reason: "rollWidth" });
    expect(rollYield({ ...base, pieceWidth: -5 })).toEqual({ ok: false, reason: "pieceWidth" });
    expect(rollYield({ ...base, quantity: 0 })).toEqual({ ok: false, reason: "quantity" });
    expect(rollYield({ ...base, rollLength: 0 })).toEqual({ ok: false, reason: "rollLength" });
  });

  it("ISPRAVKA: the roll count is built from the WHOLE physical roll length, since lead/trail waste is a job-level cost applied once, not a per-roll one", () => {
    // rollLength 1m = 1000mm physical roll. rowsPerRoll = floor(1000/300) = 3
    // (900<=1000<1200) — leadTrailMargin does NOT reduce a roll's usable
    // length, because the field's own doc is that it is waste "at the start
    // and at the end of the job", applied once, exactly as lengthMm applies
    // it below — never a cost repeated at every splice.
    const result = rollYield({
      rollWidth: 1000,
      pieceWidth: 200,
      pieceHeight: 300,
      sideMargin: 0,
      gutter: 0,
      leadTrailMargin: 200,
      quantity: 100,
      allowRotation: false,
      rollLength: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // across = floor(1000/200) = 5; rows = ceil(100/5) = 20.
    expect(result.upright.across).toBe(5);
    expect(result.upright.rows).toBe(20);
    // rolls = ceil(20/3) = 7. (The superseded per-roll-subtraction reading
    // would have given rowsPerRoll = floor(600/300) = 2 and rolls = ceil(20/2)
    // = 10 — a different job than the one lengthMm below describes.)
    expect(result.upright.rolls).toBe(7);
    // lengthMm is unaffected by the roll-count fix: 20*300 - 0 + 2*200 = 6400mm.
    expect(result.upright.lengthMm).toBeCloseTo(6400, 9);
  });
});

describe("saddleStitchImposition", () => {
  it("pairs pages for a single saddle-stitched booklet (S = 4), each pair summing to P4 + 1", () => {
    // 8 pages, S=4: P4=8, blanks=0, sheets=2. k=1: front=(8-2+2,1)=8|1;
    // back=(2,8-2+1)=2|7. k=2: front=(8-4+2,3)=6|3; back=(4,8-4+1)=4|5.
    const result = saddleStitchImposition({ pageCount: 8, signatureSize: 4, startPage: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pagesRoundedToFour).toBe(8);
    expect(result.blanks).toBe(0);
    expect(result.sheets).toBe(2);
    expect(result.signatures).toBe(1);
    expect(result.plan).toEqual([
      { sheet: 1, signature: 1, frontLeft: 8, frontRight: 1, backLeft: 2, backRight: 7 },
      { sheet: 2, signature: 1, frontLeft: 6, frontRight: 3, backLeft: 4, backRight: 5 },
    ]);
    for (const sheet of result.plan) {
      expect(sheet.frontLeft + sheet.frontRight).toBe(9);
      expect(sheet.backLeft + sheet.backRight).toBe(9);
    }
  });

  it("pads a non-multiple-of-4 page count with END-of-book blanks, never mid-book", () => {
    // 14 pages, S=4: P4=16, blanks=2, sheets=4, firstBlankPage=15.
    const result = saddleStitchImposition({ pageCount: 14, signatureSize: 4, startPage: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pagesRoundedToFour).toBe(16);
    expect(result.blanks).toBe(2);
    expect(result.firstBlankPage).toBe(15);
    expect(result.plan).toEqual([
      { sheet: 1, signature: 1, frontLeft: 16, frontRight: 1, backLeft: 2, backRight: 15 },
      { sheet: 2, signature: 1, frontLeft: 14, frontRight: 3, backLeft: 4, backRight: 13 },
      { sheet: 3, signature: 1, frontLeft: 12, frontRight: 5, backLeft: 6, backRight: 11 },
      { sheet: 4, signature: 1, frontLeft: 10, frontRight: 7, backLeft: 8, backRight: 9 },
    ]);
  });

  it("ISPRAVKA: pads to a full SECTION (not the book) when signatureSize does not divide P4, and offsets pages inside it", () => {
    // 24 pages in 8-page signatures: P4=24 (already a multiple of 4), sheets=6,
    // signatures=ceil(24/8)=3. Signature 2 covers pages 9-16, offset=8:
    // k=1: front=(8-2+2,1)=8|1 -> +8 -> 16|9; back=(2,7) -> +8 -> 10|15.
    // k=2: front=(8-4+2,3)=6|3 -> +8 -> 14|11; back=(4,5) -> +8 -> 12|13.
    const result = saddleStitchImposition({ pageCount: 24, signatureSize: 8, startPage: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sheets).toBe(6);
    expect(result.signatures).toBe(3);
    expect(result.pagesPerSignature).toBe(8);
    expect(result.plan).toEqual(
      expect.arrayContaining([
        { sheet: 3, signature: 2, frontLeft: 16, frontRight: 9, backLeft: 10, backRight: 15 },
        { sheet: 4, signature: 2, frontLeft: 14, frontRight: 11, backLeft: 12, backRight: 13 },
      ]),
    );
    for (const sheet of result.plan.filter((s) => s.signature === 2)) {
      expect(sheet.frontLeft + sheet.frontRight).toBe(25); // S + 1 + 2*offset = 9 + 16.
      expect(sheet.backLeft + sheet.backRight).toBe(25);
    }
  });

  it("ISPRAVKA: startPage shifts every printed number without changing the pairing", () => {
    // Same 8-page booklet as above but startPage=5, offset=4: every number
    // shifts by 4, so the pair-sum invariant becomes P4+1+2*4 = 9+8 = 17.
    const result = saddleStitchImposition({ pageCount: 8, signatureSize: 4, startPage: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan[0]).toEqual({
      sheet: 1,
      signature: 1,
      frontLeft: 12,
      frontRight: 5,
      backLeft: 6,
      backRight: 11,
    });
    for (const sheet of result.plan) {
      expect(sheet.frontLeft + sheet.frontRight).toBe(17);
      expect(sheet.backLeft + sheet.backRight).toBe(17);
    }
  });

  it("refuses an out-of-range page count, a signatureSize that is not a multiple of 4, and an out-of-range startPage", () => {
    expect(saddleStitchImposition({ pageCount: 0, signatureSize: 4, startPage: 1 })).toEqual({
      ok: false,
      reason: "pageCount",
    });
    expect(saddleStitchImposition({ pageCount: 8, signatureSize: 6, startPage: 1 })).toEqual({
      ok: false,
      reason: "signatureSize",
    });
    expect(saddleStitchImposition({ pageCount: 8, signatureSize: 4, startPage: 0 })).toEqual({
      ok: false,
      reason: "startPage",
    });
  });
});

describe("sheetImposition", () => {
  it("packs a card onto SRA3 upright and rotated, picking the rotated layout because it yields more", () => {
    // SRA3 320x450, card 90x50, no margins/gutter. Upright: across=floor(320/90)=3,
    // down=floor(450/50)=9 -> 27. Rotated (50x90): across=floor(320/50)=6,
    // down=floor(450/90)=5 -> 30. Best=30, rotated.
    const result = sheetImposition({
      sheetWidth: 320,
      sheetHeight: 450,
      pieceWidth: 90,
      pieceHeight: 50,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      gutter: 0,
      allowRotation: true,
      requiredQuantity: 100,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.upright).toMatchObject({ across: 3, down: 9, count: 27 });
    expect(result.rotated).toMatchObject({ across: 6, down: 5, count: 30 });
    expect(result.best.count).toBe(30);
    expect(result.bestOrientation).toBe("rotated");
    // Used area = 30*90*50 = 135000mm² of 320*450 = 144000mm² -> 93.75% used, 6.25% waste.
    expect(result.usedPercent).toBeCloseTo(93.75, 6);
    expect(result.wastePercent).toBeCloseTo(6.25, 6);
    // No margins, so usable area equals the whole sheet: the two waste figures agree.
    expect(result.usedPercentOfUsable).toBeCloseTo(93.75, 6);
    expect(result.wastePercentOfUsable).toBeCloseTo(6.25, 6);
    // leftover width = 320 - 6*50 = 20.00mm, leftover height = 450 - 5*90 = 0.00mm.
    expect(result.rotated?.leftoverWidth).toBeCloseTo(20, 9);
    expect(result.rotated?.leftoverHeight).toBeCloseTo(0, 9);
    // sheets = ceil(100/30) = 4.
    expect(result.sheets).toBe(4);
  });

  it("ISPRAVKA: the gutter term is exact — proved on a 5mm-gutter press-sheet vector", () => {
    // 700x1000 sheet, A5 148x210 piece, 10mm margins, 5mm gutter. usable=680x980.
    // Upright: across=floor(685/153)=4 (612<=685<765), down=floor(985/215)=4
    // (860<=985<1075) -> 16. Rotated (210x148): across=floor(685/215)=3
    // (645<=685<860), down=floor(985/153)=6 (918<=985<1071) -> 18. Best 18, rotated.
    const result = sheetImposition({
      sheetWidth: 700,
      sheetHeight: 1000,
      pieceWidth: 148,
      pieceHeight: 210,
      marginTop: 10,
      marginBottom: 10,
      marginLeft: 10,
      marginRight: 10,
      gutter: 5,
      allowRotation: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.usableWidth).toBe(680);
    expect(result.usableHeight).toBe(980);
    expect(result.upright).toMatchObject({ across: 4, down: 4, count: 16 });
    expect(result.rotated).toMatchObject({ across: 3, down: 6, count: 18 });
    expect(result.best.count).toBe(18);
    // leftover width = 680 - (3*210 + 2*5) = 680 - 640 = 40.00mm.
    expect(result.rotated?.leftoverWidth).toBeCloseTo(40, 9);
    // usedPercentOfUsable = 18*210*148 / (680*980) * 100 = 559440/666400*100
    // = 83.9496%, well short of the whole-sheet figure (79.92%) because the
    // margins are excluded here.
    expect(result.usedPercentOfUsable).toBeCloseTo(83.9496, 3);
    expect(result.usedPercent).toBeCloseTo(79.92, 2);
  });

  it("ISPRAVKA: a piece wider than the usable width reports zero pieces and the untouched usable strip, not a negative or oversized leftover", () => {
    const result = sheetImposition({
      sheetWidth: 100,
      sheetHeight: 100,
      pieceWidth: 150,
      pieceHeight: 50,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      gutter: 0,
      allowRotation: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.upright.across).toBe(0);
    expect(result.upright.count).toBe(0);
    expect(result.upright.leftoverWidth).toBe(100);
    expect(result.best.count).toBe(0);
    expect(result.usedPercent).toBeUndefined();
    expect(result.wastePercent).toBeUndefined();
    expect(result.usedPercentOfUsable).toBeUndefined();
  });

  it("refuses a non-positive sheet or piece dimension, a negative margin, and an out-of-range required quantity", () => {
    const base = {
      sheetWidth: 320,
      sheetHeight: 450,
      pieceWidth: 90,
      pieceHeight: 50,
      marginTop: 0,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      gutter: 0,
      allowRotation: true,
    };
    expect(sheetImposition({ ...base, sheetWidth: 0 })).toEqual({
      ok: false,
      reason: "sheetWidth",
    });
    expect(sheetImposition({ ...base, marginTop: -1 })).toEqual({
      ok: false,
      reason: "marginTop",
    });
    expect(sheetImposition({ ...base, requiredQuantity: 0 })).toEqual({
      ok: false,
      reason: "requiredQuantity",
    });
  });
});
