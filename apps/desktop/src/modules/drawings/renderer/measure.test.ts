import { describe, expect, it } from "vitest";
import {
  angleDegrees,
  delta,
  distance,
  drawingPointAt,
  viewOf,
  windowView,
  type OrthoView,
  type Viewport,
} from "./measure.js";

/**
 * The measuring arithmetic, with every expected value hand-calculated in the
 * comment beside it.
 *
 * A test that only asked "is this a number" would pass on a projection that was
 * wrong by a factor of two, which is exactly the failure this file exists to
 * catch: every distance and angle the page prints comes through `drawingPointAt`.
 */

describe("distance, delta and angle", () => {
  it("measures the 3-4-5 triangle", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(distance({ x: 3, y: 4 }, { x: 0, y: 0 })).toBe(5);
    expect(distance({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });

  it("answers the vector's components in the drawing's own axes", () => {
    expect(delta({ x: 10, y: 5 }, { x: 4, y: 9 })).toEqual({ x: -6, y: 4 });
  });

  it("measures angles counter-clockwise from +X, in 0..360", () => {
    // atan2 of each direction, in degrees: 0, 45, 90, 180, 270 - and the
    // negative branch is why the +360 exists rather than a modulo.
    expect(angleDegrees({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0);
    expect(angleDegrees({ x: 0, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(45, 10);
    expect(angleDegrees({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe(90);
    expect(angleDegrees({ x: 0, y: 0 }, { x: -1, y: 0 })).toBe(180);
    expect(angleDegrees({ x: 0, y: 0 }, { x: 0, y: -1 })).toBe(270);
    // A direction of exactly -135 degrees: -135 + 360 = 225.
    expect(angleDegrees({ x: 0, y: 0 }, { x: -1, y: -1 })).toBeCloseTo(225, 10);
  });
});

describe("drawingPointAt", () => {
  /**
   * A camera looking at a drawing whose own origin is at (1000, 2000), zoomed to
   * 2 and centred on the scene point (10, 20), with a frustum 200 wide and 150
   * tall - so ONE scene unit is 4 device pixels across and 4 down, and the
   * canvas is 800x600 CSS pixels.
   */
  const viewport: Viewport = { width: 800, height: 600 };
  const view: OrthoView = {
    left: -100,
    right: 100,
    top: 75,
    bottom: -75,
    zoom: 2,
    centerX: 10,
    centerY: 20,
  };
  const origin = { x: 1000, y: 2000 };

  it("reads the centre of the canvas as the centre of the view, plus the origin", () => {
    // ndc (0, 0) -> scene (10, 20) -> drawing (1010, 2020).
    expect(drawingPointAt({ x: 400, y: 300 }, viewport, view, origin)).toEqual({
      x: 1010,
      y: 2020,
    });
  });

  it("flips the y axis and scales by the zoom", () => {
    // The top-right corner: ndc (1, 1) -> x = 10 + 1*200/(2*2) = 60,
    // y = 20 + 1*150/(2*2) = 57.5 -> drawing (1060, 2057.5).
    expect(drawingPointAt({ x: 800, y: 0 }, viewport, view, origin)).toEqual({
      x: 1060,
      y: 2057.5,
    });
    // The bottom-left corner: ndc (-1, -1) -> (10 - 50, 20 - 37.5) -> (960, 1982.5).
    expect(drawingPointAt({ x: 0, y: 600 }, viewport, view, origin)).toEqual({
      x: 960,
      y: 1982.5,
    });
  });

  it("follows a panned camera, because the centre is the camera's position", () => {
    // The same pixel, with the view moved 30 units right and 5 up.
    const panned: OrthoView = { ...view, centerX: 40, centerY: 25 };
    expect(drawingPointAt({ x: 400, y: 300 }, viewport, panned, origin)).toEqual({
      x: 1040,
      y: 2025,
    });
  });
});

describe("viewOf", () => {
  it("reads the five numbers off a camera", () => {
    expect(
      viewOf({
        left: -8,
        right: 8,
        top: 6,
        bottom: -6,
        zoom: 1.5,
        position: { x: 3, y: -4 },
      }),
    ).toEqual({ left: -8, right: 8, top: 6, bottom: -6, zoom: 1.5, centerX: 3, centerY: -4 });
  });
});

describe("windowView", () => {
  it("shows a box that is wider than it is tall, with a 2% margin", () => {
    // 100 wide against a 50-tall box on a 2:1 canvas: the box needs 50*2 = 100
    // of width to fit vertically, which is exactly its own width - so 100, plus
    // the margin -> 102.
    expect(windowView({ minX: 0, maxX: 100, minY: 0, maxY: 50 }, 2)).toEqual({
      center: { x: 50, y: 25 },
      width: 102,
    });
  });

  it("widens for a box that is taller than the canvas can show at its own width", () => {
    // 10 wide against a 40-tall box on a 2:1 canvas: 40 * 2 = 80 of width is
    // what the height demands, so the WIDTH follows the height -> 81.6.
    expect(windowView({ minX: 0, maxX: 10, minY: 0, maxY: 40 }, 2)).toEqual({
      center: { x: 5, y: 20 },
      width: 81.6,
    });
  });

  it("never asks for a zero width, which would collapse the view", () => {
    // Two clicks at the same point: there is no box, and a view of width 0 is a
    // division by zero inside the library's own aspect arithmetic.
    expect(windowView({ minX: 5, maxX: 5, minY: 5, maxY: 5 }, 2)).toEqual({
      center: { x: 5, y: 5 },
      width: 1.02,
    });
  });
});
