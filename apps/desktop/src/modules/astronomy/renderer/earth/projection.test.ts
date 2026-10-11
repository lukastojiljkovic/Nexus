import { describe, expect, it } from "vitest";
import { mapPoint, mapX, mapY, pointAt, unwrapLongitudes, type MapRect } from "./projection.js";

/**
 * The projection is four multiplications, so every expectation here is a hand
 * calculation rather than a recorded output: a 360 x 180 box is one pixel per
 * degree, which makes the arithmetic readable.
 */
const WORLD: MapRect = { width: 360, height: 180 };

describe("mapPoint", () => {
  it("puts the four corners and the centre where an atlas puts them", () => {
    expect(mapPoint({ latDeg: 90, lonDeg: -180 }, WORLD)).toEqual({ x: 0, y: 0 });
    expect(mapPoint({ latDeg: 90, lonDeg: 180 }, WORLD)).toEqual({ x: 360, y: 0 });
    expect(mapPoint({ latDeg: -90, lonDeg: -180 }, WORLD)).toEqual({ x: 0, y: 180 });
    expect(mapPoint({ latDeg: -90, lonDeg: 180 }, WORLD)).toEqual({ x: 360, y: 180 });
    expect(mapPoint({ latDeg: 0, lonDeg: 0 }, WORLD)).toEqual({ x: 180, y: 90 });
  });

  it("scales with the box, so the same place is in the same part of any canvas", () => {
    expect(mapX(0, 1000)).toBe(500);
    expect(mapY(45, 500)).toBe(125);
    expect(mapX(-90, 720)).toBe(180);
    expect(mapPoint({ latDeg: 45, lonDeg: 90 }, { width: 720, height: 360 })).toEqual({ x: 540, y: 90 });
  });
});

describe("pointAt", () => {
  it("is the inverse of mapPoint, corners included", () => {
    expect(pointAt(0, 0, WORLD)).toEqual({ latDeg: 90, lonDeg: -180 });
    expect(pointAt(360, 180, WORLD)).toEqual({ latDeg: -90, lonDeg: 180 });
    for (const point of [
      { latDeg: 0, lonDeg: 0 },
      { latDeg: 44.833, lonDeg: 20.5 },
      { latDeg: -33.867, lonDeg: 151.217 },
      { latDeg: 64.14, lonDeg: -21.9 },
    ]) {
      const pixel = mapPoint(point, { width: 1200, height: 600 });
      const back = pointAt(pixel.x, pixel.y, { width: 1200, height: 600 });
      expect(back.latDeg).toBeCloseTo(point.latDeg, 10);
      expect(back.lonDeg).toBeCloseTo(point.lonDeg, 10);
    }
  });

  it("reads the pixel CENTRE as the place a raster pixel is", () => {
    // A 360 x 180 raster's first pixel centre is half a degree in from the
    // corner: 89.5 north, 179.5 west. The blend loop relies on this.
    expect(pointAt(0.5, 0.5, WORLD)).toEqual({ latDeg: 89.5, lonDeg: -179.5 });
  });
});

describe("unwrapLongitudes", () => {
  it("leaves a path that never wraps exactly as it found it", () => {
    const points = [
      { latDeg: 0, lonDeg: -10 },
      { latDeg: 5, lonDeg: 10 },
      { latDeg: 0, lonDeg: 0 },
    ];
    expect(unwrapLongitudes(points)).toEqual(points);
  });

  it("walks on past the antimeridian instead of jumping the width of the map", () => {
    expect(unwrapLongitudes([
      { latDeg: 0, lonDeg: 170 },
      { latDeg: 10, lonDeg: -170 },
    ])).toEqual([
      { latDeg: 0, lonDeg: 170 },
      { latDeg: 10, lonDeg: 190 },
    ]);
    expect(unwrapLongitudes([
      { latDeg: 0, lonDeg: -170 },
      { latDeg: 0, lonDeg: 170 },
    ])).toEqual([
      { latDeg: 0, lonDeg: -170 },
      { latDeg: 0, lonDeg: -190 },
    ]);
  });

  it("carries a path around the whole world, one world wide at the end", () => {
    const circuit = [0, 90, 180, -90, 0].map((lonDeg) => ({ latDeg: 0, lonDeg }));
    expect(unwrapLongitudes(circuit).map((point) => point.lonDeg)).toEqual([0, 90, 180, 270, 360]);
  });

  it("leaves no step wider than half a world in a sampled terminator", () => {
    // A terminator sampled every five degrees of its own arc, given the way the
    // engine hands one over: folded into (-180, 180], so it jumps at the seam.
    const samples = Array.from({ length: 73 }, (_, index) => {
      const meridian = index * 5;
      return {
        latDeg: 20 * Math.cos((meridian * Math.PI) / 180),
        lonDeg: meridian > 180 ? meridian - 360 : meridian,
      };
    });
    const unwrapped = unwrapLongitudes(samples);
    for (let index = 1; index < unwrapped.length; index += 1) {
      const gap = Math.abs(unwrapped[index]!.lonDeg - unwrapped[index - 1]!.lonDeg);
      expect(gap, `step ${index}`).toBeLessThanOrEqual(180);
    }
    // The arc runs off the east edge once, so its last longitude is a whole
    // world past its first: that is what the three drawn copies put back.
    expect(unwrapped[unwrapped.length - 1]!.lonDeg).toBe(360);
  });
});
