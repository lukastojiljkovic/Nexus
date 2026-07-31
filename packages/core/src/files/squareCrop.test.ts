import { describe, expect, it } from "vitest";
import { centerSquareCrop, PROFILE_PICTURE_SIZE } from "./squareCrop.js";

describe("PROFILE_PICTURE_SIZE", () => {
  it("is 512 — the edge every stored profile picture is resized to", () => {
    expect(PROFILE_PICTURE_SIZE).toBe(512);
  });
});

describe("centerSquareCrop", () => {
  it("leaves an already-square image whole", () => {
    expect(centerSquareCrop(400, 400)).toEqual({ x: 0, y: 0, width: 400, height: 400 });
  });

  it("takes the middle column of a landscape image", () => {
    expect(centerSquareCrop(1000, 400)).toEqual({ x: 300, y: 0, width: 400, height: 400 });
  });

  it("takes the middle row of a portrait image", () => {
    expect(centerSquareCrop(400, 1000)).toEqual({ x: 0, y: 300, width: 400, height: 400 });
  });

  it("floors the offset on an odd overhang rather than landing between pixels", () => {
    // 1001 - 400 = 601 to share; 300 goes left, 301 right. A half-pixel origin
    // is not a rectangle any decoder can crop to.
    expect(centerSquareCrop(1001, 400)).toEqual({ x: 300, y: 0, width: 400, height: 400 });
    expect(centerSquareCrop(400, 1001)).toEqual({ x: 0, y: 300, width: 400, height: 400 });
  });

  it("never leaves the source's bounds", () => {
    for (const [width, height] of [
      [1, 1],
      [1, 9999],
      [9999, 1],
      [3, 2],
      [2, 3],
      [1920, 1080],
      [1080, 1920],
    ] as const) {
      const rect = centerSquareCrop(width, height);
      expect(rect.width).toBe(rect.height);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(height);
    }
  });

  it("refuses a size that is not a positive whole number of pixels", () => {
    for (const [width, height] of [
      [0, 10],
      [10, 0],
      [-1, 10],
      [10.5, 10],
      [Number.NaN, 10],
      [10, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(() => centerSquareCrop(width, height)).toThrow(RangeError);
    }
  });
});
