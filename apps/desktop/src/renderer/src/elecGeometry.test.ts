import { describe, expect, it } from "vitest";
import type { ComponentDef, PartRotation } from "@nexus/core";

import {
  clampScale,
  contentBounds,
  dropSpot,
  ELEC_GRID,
  ELEC_MAX_SCALE,
  ELEC_MIN_SCALE,
  fitView,
  partSize,
  partTransform,
  pinDirection,
  pinLayout,
  pinLocal,
  pinPoint,
  pinSides,
  rotateInBox,
  rotatedSize,
  snapToGrid,
  toCircuitPoint,
  viewCentre,
  wirePath,
  zoomAbout,
} from "./elecGeometry.js";

/**
 * Fixtures, not catalogue entries. Every number asserted below was worked out
 * by hand from the constants in `elecGeometry.ts`, so the file is a check on
 * the arithmetic rather than a snapshot of whatever it currently returns.
 */
function componentWith(labels: readonly string[]): ComponentDef {
  return {
    id: "fixture",
    kind: "sensor",
    name: "Fixture",
    summary: "Fixture",
    buses: [],
    pins: labels.map((label) => ({ id: label, label, functions: ["passive"] as const })),
  };
}

/** Three pins: two down the left, one at the BOTTOM right. */
const THREE = componentWith(["VCC", "GND", "OUT"]);
/** Four pins, so both columns are full and the DIP wrap is symmetric. */
const FOUR = componentWith(["A", "B", "C", "D"]);

describe("snapToGrid", () => {
  it("lands on the nearest intersection, in both directions", () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(4)).toBe(0);
    expect(snapToGrid(6)).toBe(ELEC_GRID);
    expect(snapToGrid(-6)).toBe(-ELEC_GRID);
    expect(snapToGrid(123)).toBe(120);
  });
});

describe("pinSides", () => {
  it("gives the odd pin to the LEFT column — pin 1 is at the top left, so the short side is the right one", () => {
    const { left, right } = pinSides(THREE);
    expect(left.map((pin) => pin.id)).toEqual(["VCC", "GND"]);
    expect(right.map((pin) => pin.id)).toEqual(["OUT"]);
  });

  it("splits an even count evenly", () => {
    const { left, right } = pinSides(FOUR);
    expect(left.map((pin) => pin.id)).toEqual(["A", "B"]);
    expect(right.map((pin) => pin.id)).toEqual(["C", "D"]);
  });
});

describe("partSize", () => {
  // Height: PIN_PITCH (24) + one gap of 24 = 48, under the 56 floor, so 56 —
  // then up to the grid, 60. Width: the label columns are 3+3 characters at 6
  // units, plus 9+9 inset and an 18 gap = 72, under the 96 floor, so 96.
  it("is the pin column's height and the label columns' width, each rounded up to the grid", () => {
    expect(partSize(THREE)).toEqual({ width: 100, height: 60 });
  });

  it("grows with the widest label on each side, never with the average", () => {
    // 4 + 4 characters at 6 = 48, plus 18 inset and 18 gap = 84 — still under
    // the floor. Twelve characters a side is what clears it: 12+12 at 6 = 144,
    // plus 36 = 180.
    expect(partSize(componentWith(["MOSI", "MISO"])).width).toBe(100);
    expect(partSize(componentWith(["ABCDEFGHIJKL", "MNOPQRSTUVWX"])).width).toBe(180);
  });

  it("makes a 32-pin board sixteen rows tall", () => {
    const board = componentWith(Array.from({ length: 32 }, (_, index) => `P${index}`));
    // Sixteen a side: 24 + 15 gaps of 24 = 384, rounded up to the grid at 390.
    expect(partSize(board).height).toBe(390);
  });
});

describe("pinLayout", () => {
  it("runs down the left edge and back UP the right one — the DIP the parts are printed as", () => {
    // In the component's OWN pin order, which is what the list is: A and B down
    // the left, then C at the bottom right and D above it — the four corners of
    // a DIP-4, numbered the way the package is printed.
    expect(pinLayout(FOUR)).toEqual([
      { pin: FOUR.pins[0], side: "left", x: 0, y: 18 },
      { pin: FOUR.pins[1], side: "left", x: 0, y: 42 },
      { pin: FOUR.pins[2], side: "right", x: 100, y: 42 },
      { pin: FOUR.pins[3], side: "right", x: 100, y: 18 },
    ]);
  });

  /**
   * The defect this pins down. Measuring the right column against its own
   * LENGTH rather than against the column height hangs a short side from the
   * top, so a three-pin part draws „OUT" opposite „VCC" — where the silkscreen
   * puts it opposite „GND".
   */
  it("hangs a short right column from the BOTTOM, not from the top", () => {
    const out = pinLocal(THREE, "OUT");
    const gnd = pinLocal(THREE, "GND");
    expect(out?.y).toBe(42);
    expect(out?.y).toBe(gnd?.y);
  });

  it("centres the column in a box the grid rounded up", () => {
    // 60 tall, one 24 gap: 18 of slack above and 18 below.
    const [first] = pinLayout(THREE);
    expect(first?.y).toBe(18);
    expect(partSize(THREE).height - 42).toBe(18);
  });

  it("answers nothing for a pin the component does not have", () => {
    expect(pinLocal(THREE, "SDA")).toBeUndefined();
  });
});

describe("rotation", () => {
  it("keeps every quarter turn inside its own box", () => {
    const size = partSize(FOUR);
    for (const rotation of [0, 90, 180, 270] as const) {
      const box = rotatedSize(size, rotation);
      for (const placed of pinLayout(FOUR)) {
        const point = rotateInBox({ x: placed.x, y: placed.y }, size, rotation);
        expect(point.x, `${rotation}° x`).toBeGreaterThanOrEqual(0);
        expect(point.y, `${rotation}° y`).toBeGreaterThanOrEqual(0);
        expect(point.x, `${rotation}° x`).toBeLessThanOrEqual(box.width);
        expect(point.y, `${rotation}° y`).toBeLessThanOrEqual(box.height);
      }
    }
  });

  it("sends the left edge to the top edge at 90°, read right to left", () => {
    // The box is 100×60. (0, 18) is 18 down the left edge; after a quarter turn
    // clockwise that edge IS the top one, and 18 down becomes 60 − 18 = 42 across.
    expect(rotateInBox({ x: 0, y: 18 }, { width: 100, height: 60 }, 90)).toEqual({ x: 42, y: 0 });
  });

  it("swaps the axes on the quarter turns and leaves them alone on the half", () => {
    const size = { width: 100, height: 60 };
    expect(rotatedSize(size, 0)).toEqual(size);
    expect(rotatedSize(size, 180)).toEqual(size);
    expect(rotatedSize(size, 90)).toEqual({ width: 60, height: 100 });
    expect(rotatedSize(size, 270)).toEqual({ width: 60, height: 100 });
  });

  /**
   * The invariant the whole file exists for: what the SVG DRAWS and what the
   * wire arithmetic COMPUTES are the same point. They are derived from one
   * table, and this is the assertion that says so — re-applying the transform
   * by hand and comparing it against `pinPoint`.
   */
  it("draws a pin where it computes one, at every angle", () => {
    const origin = { x: 200, y: 300 };
    const size = partSize(FOUR);
    for (const rotation of [0, 90, 180, 270] as const) {
      const transform = partTransform(origin, size, rotation);
      const match = /^translate\((-?[\d.]+) (-?[\d.]+)\) rotate\((\d+)\)$/.exec(transform);
      expect(match, transform).not.toBeNull();
      const tx = Number(match?.[1]);
      const ty = Number(match?.[2]);
      expect(Number(match?.[3])).toBe(rotation);

      for (const placed of pinLayout(FOUR)) {
        // SVG's rotate(θ): x' = x·cosθ − y·sinθ, y' = x·sinθ + y·cosθ.
        const radians = (rotation * Math.PI) / 180;
        const drawn = {
          x: tx + placed.x * Math.cos(radians) - placed.y * Math.sin(radians),
          y: ty + placed.x * Math.sin(radians) + placed.y * Math.cos(radians),
        };
        const computed = pinPoint(origin, FOUR, placed.pin.id, rotation);
        expect(computed?.x, `${rotation}° ${placed.pin.id}`).toBeCloseTo(drawn.x, 6);
        expect(computed?.y, `${rotation}° ${placed.pin.id}`).toBeCloseTo(drawn.y, 6);
      }
    }
  });

  it("answers nothing for a pin the component does not have", () => {
    expect(pinPoint({ x: 0, y: 0 }, THREE, "SDA", 0)).toBeUndefined();
  });
});

describe("pinDirection", () => {
  it("points a leg out of the edge it belongs to, turned with the part", () => {
    expect(pinDirection("left", 0)).toEqual({ x: -1, y: 0 });
    expect(pinDirection("right", 0)).toEqual({ x: 1, y: 0 });
    // At 90° the left edge is the top one, so its legs point up.
    expect(pinDirection("left", 90)).toEqual({ x: 0, y: -1 });
    expect(pinDirection("right", 90)).toEqual({ x: 0, y: 1 });
    expect(pinDirection("left", 180)).toEqual({ x: 1, y: 0 });
    expect(pinDirection("right", 270)).toEqual({ x: 0, y: -1 });
    // Never a negative zero. It is the same direction and `Object.is` says it
    // is not, which is the sort of disagreement that shows up months later as
    // „this one wire is drawn backwards".
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const side of ["left", "right"] as const) {
        const direction = pinDirection(side, rotation);
        expect(Object.is(direction.x, -0), `${side} ${rotation}°`).toBe(false);
        expect(Object.is(direction.y, -0), `${side} ${rotation}°`).toBe(false);
      }
    }
  });
});

describe("wirePath", () => {
  const anchor = (x: number, y: number, out: { x: number; y: number }) => ({ x, y, out });

  it("leaves each pin along its own leg", () => {
    // 300 apart, so the reach is 300 × 0.35 = 105 and the sag is capped at 26.
    const path = wirePath(anchor(0, 0, { x: 1, y: 0 }), anchor(300, 0, { x: -1, y: 0 }));
    expect(path).toBe("M 0.00 0.00 C 105.00 26.00, 195.00 26.00, 300.00 0.00");
  });

  it("holds the reach to its floor on a short hop and its ceiling on a long one", () => {
    const short = wirePath(anchor(0, 0, { x: 1, y: 0 }), anchor(10, 0, { x: -1, y: 0 }));
    // 10 × 0.35 = 3.5, under the 26 floor; the sag is 10 × 0.1 = 1.
    expect(short).toBe("M 0.00 0.00 C 26.00 1.00, -16.00 1.00, 10.00 0.00");

    const long = wirePath(anchor(0, 0, { x: 1, y: 0 }), anchor(1000, 0, { x: -1, y: 0 }));
    // 1000 × 0.35 = 350, over the 140 ceiling.
    expect(long).toBe("M 0.00 0.00 C 140.00 26.00, 860.00 26.00, 1000.00 0.00");
  });

  it("starts and ends exactly on the two pins", () => {
    const path = wirePath(anchor(12.5, -7.25, { x: 0, y: 1 }), anchor(90, 40, { x: 0, y: -1 }));
    expect(path.startsWith("M 12.50 -7.25 ")).toBe(true);
    expect(path.endsWith(", 90.00 40.00")).toBe(true);
  });
});

describe("contentBounds", () => {
  const sizeOf = () => ({ width: 100, height: 60 });

  it("has nothing to say about an empty circuit", () => {
    expect(contentBounds([], sizeOf)).toBeNull();
  });

  it("pads all four sides by a leg, so a turned part's pins are inside the frame", () => {
    expect(contentBounds([{ x: 0, y: 0, rotation: 0 }], sizeOf)).toEqual({
      minX: -8,
      minY: -8,
      maxX: 108,
      maxY: 68,
    });
    // Turned, the same part is 60 wide and 100 tall.
    expect(contentBounds([{ x: 0, y: 0, rotation: 90 }], sizeOf)).toEqual({
      minX: -8,
      minY: -8,
      maxX: 68,
      maxY: 108,
    });
  });

  it("covers every part, wherever they are", () => {
    const parts: { x: number; y: number; rotation: PartRotation }[] = [
      { x: -400, y: 200, rotation: 0 },
      { x: 900, y: -50, rotation: 0 },
    ];
    expect(contentBounds(parts, sizeOf)).toEqual({
      minX: -408,
      minY: -58,
      maxX: 1008,
      maxY: 268,
    });
  });
});

describe("the view", () => {
  it("clamps a scale to what the bench allows", () => {
    expect(clampScale(0.001)).toBe(ELEC_MIN_SCALE);
    expect(clampScale(99)).toBe(ELEC_MAX_SCALE);
    expect(clampScale(0.75)).toBe(0.75);
  });

  it("answers the identity view before the surface has been laid out", () => {
    expect(fitView({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, { width: 0, height: 0 })).toEqual({
      tx: 0,
      ty: 0,
      scale: 1,
    });
    expect(fitView(null, { width: 800, height: 600 })).toEqual({ tx: 0, ty: 0, scale: 1 });
  });

  it("centres the content and never zooms past a comfortable reading", () => {
    // A 100×100 circuit in an 800×600 window would fit at 4.88×; the fit stops
    // at 1.2, because three parts on an empty bench blown up is a magnifier.
    const view = fitView({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, { width: 800, height: 600 });
    expect(view.scale).toBe(1.2);
    expect(view.tx).toBe(400 - 50 * 1.2);
    expect(view.ty).toBe(300 - 50 * 1.2);
  });

  it("zooms out to hold a circuit bigger than the window", () => {
    // 2000 wide in 800 minus 112 of padding: 0.344.
    const view = fitView({ minX: 0, minY: 0, maxX: 2000, maxY: 200 }, { width: 800, height: 600 });
    expect(view.scale).toBeCloseTo((800 - 112) / 2000, 6);
    expect(toCircuitPoint({ x: 400, y: 300 }, view).x).toBeCloseTo(1000, 6);
  });

  it("keeps the point under the pointer still while zooming", () => {
    const before = { tx: 30, ty: -12, scale: 0.8 };
    const pointer = { x: 240, y: 180 };
    const anchored = toCircuitPoint(pointer, before);
    const after = zoomAbout(before, pointer, 1.25);
    expect(after.scale).toBeCloseTo(1, 6);
    const still = toCircuitPoint(pointer, after);
    expect(still.x).toBeCloseTo(anchored.x, 6);
    expect(still.y).toBeCloseTo(anchored.y, 6);
  });

  it("refuses to zoom past the bench's own limits, however hard it is pushed", () => {
    let view = { tx: 0, ty: 0, scale: 1 };
    for (let step = 0; step < 40; step += 1) view = zoomAbout(view, { x: 0, y: 0 }, 1.2);
    expect(view.scale).toBe(ELEC_MAX_SCALE);
    for (let step = 0; step < 80; step += 1) view = zoomAbout(view, { x: 0, y: 0 }, 0.8);
    expect(view.scale).toBe(ELEC_MIN_SCALE);
  });

  it("puts a newly picked part on a grid intersection in the middle of what is visible", () => {
    const centre = viewCentre({ tx: 0, ty: 0, scale: 1 }, { width: 803, height: 607 });
    expect(centre).toEqual({ x: 400, y: 300 });
    expect(centre.x % ELEC_GRID).toBe(0);
    expect(centre.y % ELEC_GRID).toBe(0);
  });
});

describe("dropSpot", () => {
  it("takes the middle of the view when nothing is there", () => {
    expect(dropSpot({ x: 400, y: 300 }, [])).toEqual({ x: 400, y: 300 });
  });

  it("snaps whatever it is handed, so a spot is always on the grid", () => {
    const spot = dropSpot({ x: 403, y: 297 }, []);
    expect(spot).toEqual({ x: 400, y: 300 });
  });

  /**
   * The whole reason the function exists: five parts picked in a row must not be
   * five parts on one pair of coordinates, which looks exactly like a palette
   * that does nothing.
   */
  it("steps down and right past every spot already taken", () => {
    const taken: { x: number; y: number }[] = [];
    for (let n = 0; n < 5; n += 1) taken.push(dropSpot({ x: 400, y: 300 }, taken));
    expect(taken).toEqual([
      { x: 400, y: 300 },
      { x: 420, y: 320 },
      { x: 440, y: 340 },
      { x: 460, y: 360 },
      { x: 480, y: 380 },
    ]);
  });

  it("steps only past what is genuinely in the way, not past every part on the bench", () => {
    expect(dropSpot({ x: 400, y: 300 }, [{ x: 40, y: 40 }, { x: 900, y: 20 }])).toEqual({
      x: 400,
      y: 300,
    });
  });

  it("lands on the first free spot rather than the last taken one", () => {
    // The middle and the SECOND step are taken; the first step is not.
    const taken = [
      { x: 400, y: 300 },
      { x: 440, y: 340 },
    ];
    expect(dropSpot({ x: 400, y: 300 }, taken)).toEqual({ x: 420, y: 320 });
  });
});
