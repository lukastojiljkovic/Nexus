import { describe, expect, it } from "vitest";
import { HORIZON_RADIUS, allStars } from "@nexus/core";
import {
  MAX_ZOOM,
  centredOn,
  clampView,
  fittedView,
  fromPixel,
  namedMagnitude,
  panBy,
  starRadius,
  tintFor,
  toPixel,
  zoomAt,
  type CanvasSize,
} from "./view.js";

/** A canvas like the one the map is given: 720 by 520 CSS pixels. */
const SIZE: CanvasSize = { width: 720, height: 520 };

describe("fittedView", () => {
  it("inscribes the horizon circle in the short side, centred", () => {
    const view = fittedView(SIZE);
    const horizonPixels = HORIZON_RADIUS * view.scale;
    // 0.92 of half the short side, by hand: 0.46 x 520 = 239.2 pixels.
    expect(horizonPixels).toBeCloseTo(239.2, 9);
    expect(view.originX).toBe(360);
    expect(view.originY).toBe(260);
    expect(2 * horizonPixels).toBeLessThan(SIZE.height);
  });

  it("survives a canvas that has not been measured yet", () => {
    // A layout effect runs before the first paint has a size; a scale of zero
    // would make every conversion below a division by zero.
    const view = fittedView({ width: 0, height: 0 });
    expect(view.scale).toBe(0);
    expect(Number.isFinite(view.originX)).toBe(true);
  });
});

describe("toPixel and fromPixel", () => {
  it("flips the y axis exactly once", () => {
    const view = fittedView(SIZE);
    // The plane's +y is up, the canvas's +y is down.
    expect(toPixel(view, { x: 0, y: 1 }).y).toBeLessThan(view.originY);
    expect(toPixel(view, { x: 1, y: 0 }).x).toBeGreaterThan(view.originX);
  });

  it("is its own inverse", () => {
    const view = fittedView(SIZE);
    const point = { x: -0.7, y: 1.4 };
    const pixel = toPixel(view, point);
    const back = fromPixel(view, pixel.x, pixel.y);
    expect(back.x).toBeCloseTo(point.x, 9);
    expect(back.y).toBeCloseTo(point.y, 9);
  });
});

describe("panBy and clampView", () => {
  it("moves the plane with the pointer", () => {
    const view = panBy(fittedView(SIZE), 10, -4);
    expect(view.originX).toBe(370);
    expect(view.originY).toBe(256);
  });

  it("will not let a drag lose the sky", () => {
    const view = fittedView(SIZE);
    const limit = HORIZON_RADIUS * view.scale;
    const dragged = clampView(panBy(view, 10_000, -10_000), SIZE);
    expect(dragged.originX).toBeCloseTo(SIZE.width / 2 + limit, 9);
    expect(dragged.originY).toBeCloseTo(SIZE.height / 2 - limit, 9);
    // And a drag inside the bound is left exactly where it was put.
    const near = clampView(panBy(view, limit / 2, 0), SIZE);
    expect(near.originX).toBeCloseTo(SIZE.width / 2 + limit / 2, 9);
  });
});

describe("zoomAt", () => {
  it("keeps the point under the pointer still", () => {
    const view = fittedView(SIZE);
    const at = { x: 500, y: 140 };
    const before = fromPixel(view, at.x, at.y);
    const zoomed = zoomAt(view, 2.5, SIZE, at);
    const after = fromPixel(zoomed, at.x, at.y);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(zoomed.scale / view.scale).toBeCloseTo(2.5, 9);
  });

  it("stops at the fitted scale and at twelve times it", () => {
    const fitted = fittedView(SIZE);
    expect(zoomAt(fitted, 0.01, SIZE, { x: 0, y: 0 }).scale).toBeCloseTo(fitted.scale, 9);
    expect(zoomAt(fitted, 100, SIZE, { x: 0, y: 0 }).scale).toBeCloseTo(fitted.scale * MAX_ZOOM, 9);
    expect(MAX_ZOOM).toBe(12);
  });
});

describe("centredOn", () => {
  it("puts the point in the middle of the canvas, horizon or not", () => {
    const view = centredOn(fittedView(SIZE), SIZE, { x: 1.2, y: -0.6 });
    const pixel = toPixel(view, { x: 1.2, y: -0.6 });
    expect(pixel.x).toBeCloseTo(SIZE.width / 2, 9);
    expect(pixel.y).toBeCloseTo(SIZE.height / 2, 9);
  });
});

describe("starRadius", () => {
  it("draws a magnitude-0 star at 1.7 pixels and falls off as the square root of the flux", () => {
    // 1.7 * 10^(-0.2 m), by hand: m = 0 -> 1.7; m = 5 -> 1.7 * 0.1 = 0.17,
    // which is under the floor and is drawn at it; m = -1.46 (Sirius) ->
    // 1.7 * 10^0.292 = 1.7 * 1.95884 = 3.3300.
    expect(starRadius(0)).toBeCloseTo(1.7, 9);
    expect(starRadius(-1.46)).toBeCloseTo(3.33, 4);
    expect(starRadius(5)).toBeCloseTo(0.7, 9);
    expect(starRadius(6)).toBeCloseTo(0.7, 9);
  });

  it("never runs away at the bright end", () => {
    expect(starRadius(-30)).toBeCloseTo(4.5, 9);
  });

  it("is monotone over the catalogue's own magnitudes", () => {
    const radii = allStars()
      .map((star) => star.magnitude)
      .sort((a, b) => a - b)
      .map(starRadius);
    for (let index = 1; index < radii.length; index += 1) {
      expect(radii[index]!).toBeLessThanOrEqual(radii[index - 1]!);
    }
  });
});

describe("tintFor", () => {
  it("sorts the catalogue's colour indices into four steps", () => {
    const counts = { hot: 0, solar: 0, warm: 0, red: 0 };
    for (const star of allStars()) {
      counts[tintFor(star.colourIndex)] += 1;
    }
    // The boundary values are the ones in the file's header, and these are the
    // counts they produce over the shipped catalogue.
    expect(counts).toEqual({ hot: 2074, solar: 981, warm: 1497, red: 528 });
  });

  it("gives a star with no colour index the plain ink", () => {
    expect(tintFor(undefined)).toBe("solar");
  });

  it("puts each boundary on the brighter side of itself", () => {
    expect(tintFor(-0.28)).toBe("hot");
    expect(tintFor(0.3)).toBe("solar");
    expect(tintFor(0.89)).toBe("solar");
    expect(tintFor(0.9)).toBe("warm");
    expect(tintFor(1.49)).toBe("warm");
    expect(tintFor(1.5)).toBe("red");
    expect(tintFor(3.86)).toBe("red");
  });
});

describe("namedMagnitude", () => {
  it("names the brightest stars at the fitted scale and all of them at the closest zoom", () => {
    const fitted = fittedView(SIZE);
    expect(namedMagnitude(fitted, SIZE)).toBeCloseTo(2.5, 9);
    const zoomed = zoomAt(fitted, MAX_ZOOM, SIZE, { x: 0, y: 0 });
    expect(namedMagnitude(zoomed, SIZE)).toBeCloseTo(6, 6);
  });

  it("rises with the zoom and never falls", () => {
    const fitted = fittedView(SIZE);
    let previous = namedMagnitude(fitted, SIZE);
    for (const factor of [1.5, 3, 6, 12, 100]) {
      const value = namedMagnitude(zoomAt(fitted, factor, SIZE, { x: 0, y: 0 }), SIZE);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});
