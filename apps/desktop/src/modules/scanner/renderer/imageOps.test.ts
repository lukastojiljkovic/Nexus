import { describe, expect, it } from "vitest";
import {
  binarise,
  composeSelection,
  cropTo,
  grayscale,
  meanLevel,
  prepareForOcr,
  rotateQuarterTurns,
  selectionRect,
  stretchContrast,
  type RgbaImage,
} from "./imageOps.js";

/**
 * The scanner's image arithmetic, on fixtures whose expected bytes are worked
 * out by hand in each test.
 *
 * The whole point of these functions being pure is that they can be checked
 * this way: a rotation, a crop or a threshold that is off by a pixel or a level
 * still draws a picture on the page, and a picture of slightly wrong pixels
 * looks like a picture. So nothing here asserts "it returned something" - every
 * expectation is the exact byte array a person can recompute from the formula
 * written beside it.
 */

/** One row of pixels from raw RGBA quads. */
function image(width: number, height: number, pixels: readonly (readonly number[])[]): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(pixels.flat()) };
}

/** A one-row grey fixture: each value becomes `r = g = b = value`, fully opaque. */
function greys(values: readonly number[]): RgbaImage {
  return image(values.length, 1, values.map((value) => [value, value, value, 255]));
}

/** The fixture the rotation tests turn: four unmistakable colours, one per corner. */
const CORNERS = image(2, 2, [
  [10, 20, 30, 255], // top-left, call it A
  [200, 100, 50, 255], // top-right, B
  [255, 255, 255, 255], // bottom-left, C
  [0, 0, 0, 255], // bottom-right, D
]);

describe("rotateQuarterTurns", () => {
  it("turns A B / C D into C A / D B - the top-left pixel moving to the top-right", () => {
    const turned = rotateQuarterTurns(CORNERS, 1);
    expect({ width: turned.width, height: turned.height }).toEqual({ width: 2, height: 2 });
    // Clockwise: C A on the first row, D B on the second.
    expect([...turned.data]).toEqual([
      255, 255, 255, 255, 10, 20, 30, 255, 0, 0, 0, 255, 200, 100, 50, 255,
    ]);
  });

  it("turns twice into the 180-degree rotation, D C / B A", () => {
    expect([...rotateQuarterTurns(CORNERS, 2).data]).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 200, 100, 50, 255, 10, 20, 30, 255,
    ]);
  });

  it("reduces the count: four turns are no turns, and one turn back is three turns forward", () => {
    expect([...rotateQuarterTurns(CORNERS, 4).data]).toEqual([...CORNERS.data]);
    expect([...rotateQuarterTurns(CORNERS, -1).data]).toEqual([
      ...rotateQuarterTurns(CORNERS, 3).data,
    ]);
  });

  it("turns a wide image into a tall one", () => {
    const strip = image(3, 1, [
      [1, 0, 0, 255],
      [2, 0, 0, 255],
      [3, 0, 0, 255],
    ]);
    const turned = rotateQuarterTurns(strip, 1);
    expect({ width: turned.width, height: turned.height }).toEqual({ width: 1, height: 3 });
    // Leftmost pixel ends up on top, which is what turning the paper right does.
    expect([...turned.data]).toEqual([1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255]);
  });

  it("never writes to the bitmap it was handed", () => {
    const before = [...CORNERS.data];
    rotateQuarterTurns(CORNERS, 1);
    expect([...CORNERS.data]).toEqual(before);
  });
});

describe("selectionRect", () => {
  it("turns percentages into the pixels they name", () => {
    // 10% of 200 is 20, 20% of 100 is 20, 50% of each is 100 and 50.
    expect(selectionRect(image(200, 100, [[0, 0, 0, 255]]), {
      left: 10,
      top: 20,
      width: 50,
      height: 50,
    })).toEqual({ x: 20, y: 20, width: 100, height: 50 });
  });

  it("clamps a selection that hangs off the edge instead of naming pixels that do not exist", () => {
    // 90% of 100 is pixel 90; only 10 pixels are left, so a 50%-wide selection
    // becomes those 10 rather than a rectangle running past the bitmap.
    expect(selectionRect(image(100, 10, [[0, 0, 0, 255]]), {
      left: 90,
      top: 0,
      width: 50,
      height: 100,
    })).toEqual({ x: 90, y: 0, width: 10, height: 10 });
  });

  it("never answers with a rectangle of no pixels", () => {
    const rect = selectionRect(image(10, 10, [[0, 0, 0, 255]]), {
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });
    expect(rect.width).toBe(1);
    expect(rect.height).toBe(1);
  });
});

describe("cropTo", () => {
  const strip = image(3, 1, [
    [10, 10, 10, 255],
    [20, 20, 20, 255],
    [30, 30, 30, 255],
  ]);

  it("answers exactly the pixels inside the rectangle", () => {
    const cropped = cropTo(strip, { x: 1, y: 0, width: 2, height: 1 });
    expect({ width: cropped.width, height: cropped.height }).toEqual({ width: 2, height: 1 });
    expect([...cropped.data]).toEqual([20, 20, 20, 255, 30, 30, 30, 255]);
  });

  it("clamps a rectangle wider than the image to what is there", () => {
    const cropped = cropTo(strip, { x: 2, y: 0, width: 5, height: 3 });
    expect({ width: cropped.width, height: cropped.height }).toEqual({ width: 1, height: 1 });
    expect([...cropped.data]).toEqual([30, 30, 30, 255]);
  });
});

describe("composeSelection", () => {
  it("maps a box drawn on a cropped view back into the full picture", () => {
    // The outer crop is the middle half: left 25%, top 25%, 50% wide and tall.
    // The inner box is the top-left quarter OF THAT VIEW: 0/0, 50x50.
    //   left   = 25 + 0 * 50 / 100     = 25
    //   top    = 25 + 0 * 50 / 100     = 25
    //   width  = 50 * 50 / 100         = 25
    //   height = 50 * 50 / 100         = 25
    expect(
      composeSelection(
        { left: 25, top: 25, width: 50, height: 50 },
        { left: 0, top: 0, width: 50, height: 50 },
      ),
    ).toEqual({ left: 25, top: 25, width: 25, height: 25 });
  });

  it("offsets an inner box that does not start at the view's corner", () => {
    //   left   = 25 + 50 * 50 / 100 = 50; top = 25 + 20 * 50 / 100 = 35
    //   width  = 25 * 50 / 100      = 12,5; height = 100 * 50 / 100 = 50
    expect(
      composeSelection(
        { left: 25, top: 25, width: 50, height: 50 },
        { left: 50, top: 20, width: 25, height: 100 },
      ),
    ).toEqual({ left: 50, top: 35, width: 12.5, height: 50 });
  });

  it("is the identity when the outer selection is the whole picture", () => {
    const inner = { left: 12, top: 34, width: 56, height: 78 };
    expect(composeSelection({ left: 0, top: 0, width: 100, height: 100 }, inner)).toEqual(inner);
  });
});

describe("grayscale", () => {
  it("uses Rec. 601 luma, rounded", () => {
    // 0.299*10 + 0.587*20 + 0.114*30 = 2.99 + 11.74 + 3.42 = 18.15 -> 18
    // 0.299*255 = 76.245 -> 76; 0.587*255 = 149.685 -> 150; 0.114*255 = 29.07 -> 29
    const grey = grayscale(image(4, 1, [
      [10, 20, 30, 255],
      [255, 0, 0, 200],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
    ]));
    expect([...grey.data]).toEqual([
      18, 18, 18, 255, 76, 76, 76, 200, 150, 150, 150, 255, 29, 29, 29, 255,
    ]);
  });
});

describe("stretchContrast", () => {
  it("maps the 2nd and 98th percentile tones to black and white and scales what is between", () => {
    // Four greys: [0, 50, 200, 255]. Sorted, n - 1 = 3.
    //   2%  -> index floor(3 * 0.02) = 0 -> 0
    //   98% -> index floor(3 * 0.98) = 2 -> 200
    //   scale = 255 / (200 - 0) = 1.275
    //   0 -> 0; 50 -> round(63.75) = 64; 200 -> 255; 255 -> round(325.125) clamped to 255
    const stretched = stretchContrast(greys([0, 50, 200, 255]));
    expect([...stretched.data]).toEqual([
      0, 0, 0, 255, 64, 64, 64, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]);
  });

  it("answers a flat image unchanged rather than inventing a curve for it", () => {
    const flat = greys([128, 128, 128]);
    expect([...stretchContrast(flat).data]).toEqual([...flat.data]);
  });
});

describe("binarise", () => {
  it("uses the mean luma when no level is given", () => {
    // Mean of [0, 64, 255, 255] = 574 / 4 = 143.5 -> 144 (round half up).
    const source = greys([0, 64, 255, 255]);
    expect(meanLevel(source)).toBe(144);
    expect([...binarise(source).data]).toEqual([
      0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]);
  });

  it("keeps a pixel ON the level", () => {
    // >= level is white: 64 stays white at level 64, so exactly one pixel flips.
    expect([...binarise(greys([0, 64, 255, 255]), 64).data]).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]);
  });
});

describe("prepareForOcr", () => {
  it("greys, stretches and thresholds in that order", () => {
    const source = greys([10, 60, 200, 250]);
    // Grey (the values are already grey), then the stretch from the test above's
    // arithmetic: low = 10, high = 200, scale = 255 / 190 = 1.3421...
    //   10 -> 0; 60 -> round(50 * 1.3421) = round(67.105) = 67; 200 -> 255; 250 -> clamped 255
    const stretched = stretchContrast(grayscale(source));
    expect([...stretched.data]).toEqual([
      0, 0, 0, 255, 67, 67, 67, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]);
    // The level is the mean of THAT image: (0 + 67 + 255 + 255) / 4 = 144.25 -> 144.
    expect(meanLevel(stretched)).toBe(144);
    expect([...prepareForOcr(source).data]).toEqual([
      0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]);
  });

  it("leaves the bitmap it was handed alone", () => {
    const source = greys([10, 60, 200, 250]);
    const before = [...source.data];
    prepareForOcr(source);
    expect([...source.data]).toEqual(before);
  });
});
