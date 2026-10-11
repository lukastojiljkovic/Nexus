import { describe, expect, it } from "vitest";

import { GcodeParseError, parseGcodeText } from "./gcode.js";

/**
 * The G-code reader, against files small enough to check with a pencil.
 *
 * Every expected number here is written out as the arithmetic that produces it,
 * because that is the only way a path length assertion is worth anything: a
 * fixture whose expected total was copied from a previous run of this parser
 * asserts nothing at all.
 */

/**
 * Two layers of a hand-written Marlin-job-shaped file.
 *
 * The moves and their lengths, in order:
 *
 *  1. `G0 X0 Y0`            travel, no length (the head is already there)
 *  2. `G1 X10 Y0 E1 F1200`  extruding, 10 mm
 *  3. `G0 X10 Y10 F3000`    travel, 10 mm
 *  4. `G1 X0 Y10 E2 F1200`  extruding, 10 mm
 *  5. `G1 Z0.2 F600`        the layer change: a 0.2 mm travel straight up
 *  6. `G1 X5 Y5 E2.5 F600`  extruding, hypot(5, 5) = 7.0710678118654755 mm
 */
const TWO_LAYERS = [
  "; hand-written for the test",
  "G21 ; millimetres",
  "G90 ; absolute",
  "M82 ; absolute extrusion",
  "G1 F1200",
  "G0 X0 Y0",
  "G1 X10 Y0 E1.0 F1200",
  "G0 X10 Y10 F3000",
  "G1 X0 Y10 E2.0 F1200",
  "G1 Z0.2 F600",
  "G1 X5 Y5 E2.5 F600",
  "M82",
  "",
].join("\n");

describe("parseGcodeText", () => {
  it("reads two layers, the extruding and travelling millimetres, and the filament", () => {
    const model = parseGcodeText(TWO_LAYERS);

    expect(model.units).toBe("mm");
    expect(model.layers.length).toBe(2);
    expect(model.layers.map((layer) => layer.zMm)).toEqual([0, 0.2]);
    // Five drawn segments: two extruding and one travelling on the first layer,
    // the 0.2 mm Z move that starts the second, and one extruding move on it
    // (the zero-length moves draw nothing).
    expect(model.segmentCount).toBe(5);
    // 10 + 10 on the first layer, hypot(5, 5) on the second.
    expect(model.extrusionMm).toBe(20 + Math.hypot(5, 5));
    // The 10 mm rapid across the first layer, and the 0.2 mm of Z.
    expect(model.travelMm).toBeCloseTo(10.2, 9);
    // The positive E deltas: 1.0, then 1.0 more, then 0.5 more.
    expect(model.filamentMm).toBe(2.5);
    expect(model.layers[0]?.extrusionMm).toBe(20);
    expect(model.layers[1]?.extrusionMm).toBeCloseTo(7.071067811865476, 12);
    expect(model.bounds.size).toEqual([10, 10, 0.2]);
    expect(model.warnings).toEqual([]);
  });

  it("estimates the time as length over feed, and says what that leaves out", () => {
    const model = parseGcodeText(TWO_LAYERS);

    // 10 mm at 1200 mm/min = 10/1200 min = 0.5 s
    // 10 mm at 3000 mm/min = 0.2 s
    // 10 mm at 1200 mm/min = 0.5 s
    // 0.2 mm at 600 mm/min = 0.02 s
    // hypot(5,5) at 600 mm/min = 0.7071067811865476 s
    const expected =
      (10 / 1200) * 60 +
      (10 / 3000) * 60 +
      (10 / 1200) * 60 +
      (0.2 / 600) * 60 +
      (Math.hypot(5, 5) / 600) * 60;
    expect(model.estimatedSeconds).toBeCloseTo(expected, 12);
    // The layer's own share, and the total before it, so a slider can say "an
    // hour in" without adding the whole file up again.
    expect(model.layers[1]?.startsAfterSeconds).toBeCloseTo(
      (10 / 1200) * 60 + (10 / 3000) * 60 + (10 / 1200) * 60 + (0.2 / 600) * 60,
      12,
    );
    expect(model.layers[1]?.estimatedSeconds).toBeCloseTo((Math.hypot(5, 5) / 600) * 60, 12);
  });

  it("reads the same file in inches when G20 says so, converting the feed rate too", () => {
    // One inch at 60 inches per minute: 25.4 mm, and a feed of 1524 mm/min.
    const model = parseGcodeText(
      ["G20", "G90", "M82", "G1 F60", "G1 X1 Y0 E0.1", ""].join("\n"),
    );

    expect(model.units).toBe("inch");
    expect(model.extrusionMm).toBeCloseTo(25.4, 9);
    expect(model.bounds.size[0]).toBeCloseTo(25.4, 9);
    // 25.4 mm at 60 in/min = 25.4 mm at 1524 mm/min = 1 s.
    expect(model.estimatedSeconds).toBeCloseTo(1, 9);
  });

  it("takes each E as a delta in M83 mode, and counts only the positive ones", () => {
    const model = parseGcodeText(
      [
        "G21",
        "G90",
        "M83",
        "G1 F1200",
        "G1 X10 Y0 E0.4",
        "G1 X10 Y10 E0", // a travel move in relative mode: no extrusion
        "G1 E-1.2", // retraction: backwards, so not filament used
        "G1 X0 Y10 E0.3",
        "",
      ].join("\n"),
    );

    // 0.4 + 0.3, with the retraction excluded.
    expect(model.filamentMm).toBeCloseTo(0.7, 9);
  });

  it("reads a G2 arc's length as the arc, and lands its segments on the circle", () => {
    // A quarter turn of the R spelling: from (0, 0) to (10, 0) with R = 5 is a
    // semicircle about (5, 0) - the two ends are 10 apart, which is a diameter.
    const model = parseGcodeText(["G21", "G90", "M82", "G1 F600", "G2 X10 Y0 I5 J0 E1", ""].join("\n"));

    // A semicircle of radius 5, so the arc length is half of 2 pi r: 5 pi.
    const expected = Math.PI * 5;
    expect(model.extrusionMm).toBeCloseTo(expected, 9);
    expect(model.estimatedSeconds).toBeCloseTo((expected / 600) * 60, 9);
    // 64 segments to a turn, so a half turn is 32, and the last one ends exactly
    // on the target.
    const segment = model.layers[0]?.extrusion ?? new Float32Array();
    expect(segment.length / 6).toBe(32);
    expect([segment[segment.length - 3], segment[segment.length - 2]]).toEqual([10, 0]);
    // Every drawn point is on the circle of radius 5 about (5, 0) - the one
    // property that says the arc maths, not just the endpoints, is right.
    for (let index = 0; index < segment.length; index += 3) {
      const x = segment[index] as number;
      const y = segment[index + 1] as number;
      expect(Math.hypot(x - 5, y), `${x},${y}`).toBeCloseTo(5, 6);
    }
  });

  it("solves the R spelling's two answers from its sign: positive is the minor arc", () => {
    // From (0, 0) to (10, 0) with R = 5 is a semicircle (above), so use a chord
    // shorter than the diameter: R = 5 over a chord of 6 gives two centres, and
    // the minor arc is shorter than the major one by exactly the difference
    // between 2 pi - 2 asin(0.6) and 2 asin(0.6).
    const minor = parseGcodeText(["G21", "G90", "M82", "G1 F600", "G3 X6 Y0 R5 E1", ""].join("\n"));
    const major = parseGcodeText(["G21", "G90", "M82", "G1 F600", "G3 X6 Y0 R-5 E1", ""].join("\n"));

    // asin(3/5) = 0.6435011087932844 rad, so the minor arc is 2 x that x 5 mm.
    const minorLength = 2 * Math.asin(3 / 5) * 5;
    expect(minor.extrusionMm).toBeCloseTo(minorLength, 9);
    expect(major.extrusionMm).toBeCloseTo(Math.PI * 2 * 5 - minorLength, 9);
    expect(minor.extrusionMm).toBeLessThan(major.extrusionMm);
  });

  it("turns a full circle out of I/J with the start and end at one point", () => {
    const model = parseGcodeText(["G21", "G90", "M82", "G1 F600", "G3 X0 Y0 I5 J0 E1", ""].join("\n"));
    expect(model.segmentCount).toBe(64);
    expect(model.extrusionMm).toBeCloseTo(Math.PI * 2 * 5, 9);
  });

  it("mentions a move with no feed rate rather than counting it as instant", () => {
    const model = parseGcodeText(["G21", "G90", "M82", "G1 X10 Y0 E1", ""].join("\n"));
    expect(model.warnings).toContain("missing-feed");
    expect(model.estimatedSeconds).toBe(0);
    expect(model.extrusionMm).toBe(10);
  });

  it("mentions an arc with no centre rather than inventing one", () => {
    const model = parseGcodeText(["G21", "G90", "M82", "G1 F600", "G2 X10 Y0 E1", ""].join("\n"));
    expect(model.warnings).toContain("arc-without-centre");
    // The move is still drawn - as the straight move the firmware would make.
    expect(model.extrusionMm).toBe(10);
  });

  it("reads G92 as a position without a move", () => {
    const model = parseGcodeText(
      ["G21", "G90", "M82", "G92 X10 Y0", "G1 F600 X20 Y0 E1", ""].join("\n"),
    );
    // From (10, 0) to (20, 0): ten millimetres, not twenty.
    expect(model.extrusionMm).toBeCloseTo(10, 9);
  });

  it("ignores the commands it does not draw, and the comments in all three styles", () => {
    const model = parseGcodeText(
      [
        "; a semicolon comment",
        "M104 S210 ; hot end",
        "G21 (a parenthesised comment) G90",
        "M82",
        "N42 G1 F600 X10 Y0 E1 *71 K",
        "",
      ].join("\n"),
    );
    expect(model.extrusionMm).toBe(10);
    expect(model.layers.length).toBe(1);
  });

  it("refuses a file that holds no motion command", () => {
    expect(() => parseGcodeText("this is not a toolpath\njust some prose\n")).toThrow(GcodeParseError);
    try {
      parseGcodeText("");
    } catch (error) {
      expect((error as GcodeParseError).problem).toBe("not-gcode");
    }
  });
});
