import { describe, expect, it } from "vitest";
import { COASTLINE } from "./coastline.js";
import { landRings } from "./land.js";

/**
 * The counts below are the measurements the table's own header quotes (Natural
 * Earth `ne_110m_land`, fetched 2026-10-10: 128 rings, 4 994 points, quantised
 * to a tenth of a degree), and the two extremes are the source's own: Antarctica
 * reaches the south pole and the northernmost land is 83.6 north (Greenland's
 * north coast).
 */
describe("landRings", () => {
  it("decodes every ring and every point the table was generated with", () => {
    const rings = landRings();
    expect(rings.length).toBe(128);
    expect(rings.reduce((count, ring) => count + ring.length, 0)).toBe(4994);
    expect(COASTLINE.split("\n").length).toBe(128);
  });

  it("starts the first ring where the source's own first ring starts", () => {
    // The table's first line begins with `-596,-800`: 59.6 west, 80 south, the
    // first point of Natural Earth's Antarctic ring.
    expect(landRings()[0]?.[0]).toEqual({ latDeg: -80, lonDeg: -59.6 });
  });

  it("puts every point on the Earth", () => {
    let south = 90;
    let north = -90;
    let west = 180;
    let east = -180;
    for (const ring of landRings()) {
      expect(ring.length, "a ring of fewer than three points is not a ring").toBeGreaterThanOrEqual(3);
      for (const point of ring) {
        expect(Number.isFinite(point.latDeg)).toBe(true);
        expect(Number.isFinite(point.lonDeg)).toBe(true);
        expect(Math.abs(point.latDeg)).toBeLessThanOrEqual(90);
        expect(Math.abs(point.lonDeg)).toBeLessThanOrEqual(180);
        south = Math.min(south, point.latDeg);
        north = Math.max(north, point.latDeg);
        west = Math.min(west, point.lonDeg);
        east = Math.max(east, point.lonDeg);
      }
      // Quantisation removed the repeated points, so no two neighbours are the
      // same place and no ring closes on itself: the canvas closes it.
      for (let index = 1; index < ring.length; index += 1) {
        const previous = ring[index - 1]!;
        const current = ring[index]!;
        expect(previous.latDeg === current.latDeg && previous.lonDeg === current.lonDeg).toBe(false);
      }
      expect(ring[0]).not.toEqual(ring[ring.length - 1]);
    }
    expect(south).toBe(-90);
    expect(north).toBe(83.6);
    expect(west).toBe(-180);
    expect(east).toBe(180);
  });
});
