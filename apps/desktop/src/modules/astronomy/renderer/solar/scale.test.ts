import { describe, expect, it } from "vitest";
import type { BodyState, SolarSystemSnapshot, Vector3 } from "@nexus/core";

import {
  KM_PER_AU,
  SATELLITE_CLEARANCE_UNITS,
  TRUE_UNITS_PER_AU,
  bodyRadiusUnits,
  placeBodies,
  readableDistanceUnits,
  readableRadiusUnits,
  scenePosition,
  trueDistanceUnits,
  trueRadiusUnits,
} from "./scale.js";

/**
 * The two layouts, pinned by values rather than by how a picture looked.
 *
 * The oracles are logarithms anybody can check by hand — ln 2 and ln 10 — and
 * the properties the brief fixes: the order and the direction of every body
 * survive the compression. With `READABLE_UNITS_PER_LOG = 20` and
 * `READABLE_AU_REF = 0.05`, a distance of exactly 0.05 au is exactly 20·ln 2
 * units and 0.45 au is exactly 20·ln 10 units.
 */

const LN_2 = 0.6931471805599453;
const LN_10 = 2.302585092994046;

/** The Earth's volumetric mean radius, 6371.0 km — the value beside the Moon's own on the NASA fact sheet. */
const EARTH_RADIUS_KM = 6371;
const MOON_RADIUS_KM = 1737.4;
/**
 * The Moon's mean distance from the Earth: 384 400 km (NASA Moon fact sheet,
 * `https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html`), in au.
 */
const MOON_MEAN_DISTANCE_AU = 384_400 / KM_PER_AU;

function body(id: BodyState["id"], position: Vector3, radiusKm: number): BodyState {
  return {
    id,
    position,
    radiusKm,
    rotationDeg: 0,
    northPole: [0, 1, 0],
    distanceFromEarthAu: 0,
  };
}

/** The Earth at 1 au along +X with the Moon 384 400 km further out, for the satellite rule. */
function earthAndMoon(): SolarSystemSnapshot {
  return {
    instantMs: 0,
    bodies: [
      body("sun", [0, 0, 0], 696_000),
      body("earth", [1, 0, 0], EARTH_RADIUS_KM),
      body("moon", [1 + MOON_MEAN_DISTANCE_AU, 0, 0], MOON_RADIUS_KM),
    ],
  };
}

describe("true scale", () => {
  it("is one multiplication for distance and the same measure for a radius", () => {
    expect(trueDistanceUnits(1)).toBe(TRUE_UNITS_PER_AU);
    expect(trueDistanceUnits(2)).toBe(2 * TRUE_UNITS_PER_AU);
    // One au of radius is one au of distance: 149 597.8707 km is a thousandth of
    // an au, so it is exactly one unit at this scale.
    expect(trueRadiusUnits(KM_PER_AU)).toBe(TRUE_UNITS_PER_AU);
    expect(trueRadiusUnits(KM_PER_AU / TRUE_UNITS_PER_AU)).toBeCloseTo(1, 12);
  });

  it("keeps the order of the bodies", () => {
    const distances = [0.39, 0.72, 1, 1.52, 5.2, 9.54, 19.19, 30.07, 39.48];
    for (let index = 1; index < distances.length; index += 1) {
      const previous = distances[index - 1] ?? 0;
      const current = distances[index] ?? 0;
      expect(trueDistanceUnits(current)).toBeGreaterThan(trueDistanceUnits(previous));
    }
  });
});

describe("readable scale", () => {
  it("maps the origin to the origin", () => {
    expect(readableDistanceUnits(0)).toBe(0);
  });

  it("is 20·ln 2 units at the reference distance, and 20·ln 10 an octave and a half out", () => {
    // 0.05 au is the reference, so the argument is 1 and the log is ln 2.
    expect(readableDistanceUnits(0.05)).toBeCloseTo(20 * LN_2, 10);
    // 0.45 au is nine times the reference: ln(1 + 9) = ln 10.
    expect(readableDistanceUnits(0.45)).toBeCloseTo(20 * LN_10, 10);
  });

  it("compresses the system without reordering it", () => {
    const distances = [0, 0.39, 0.72, 1, 1.52, 5.2, 9.54, 19.19, 30.07, 39.48];
    for (let index = 1; index < distances.length; index += 1) {
      const previous = distances[index - 1] ?? 0;
      const current = distances[index] ?? 0;
      expect(readableDistanceUnits(current)).toBeGreaterThan(readableDistanceUnits(previous));
    }
    // Mercury to Pluto spans 100× in reality and about 3× on screen, which is the
    // whole point of the mode.
    const inner = readableDistanceUnits(0.39);
    const outer = readableDistanceUnits(39.48);
    expect(outer / inner).toBeLessThan(5);
    expect(trueDistanceUnits(39.48) / trueDistanceUnits(0.39)).toBeGreaterThan(90);
  });

  it("enlarges radii, keeps them ordered, and still lets Mercury's orbit clear the Sun", () => {
    // 2000 km is the reference radius, so the argument is 1: ln 2. 18000 km is
    // nine times it: ln 10.
    expect(readableRadiusUnits(2000)).toBeCloseTo(LN_2, 10);
    expect(readableRadiusUnits(18_000)).toBeCloseTo(LN_10, 10);
    const radii = [1188, 2440, 6371, 69_911, 696_000];
    for (let index = 1; index < radii.length; index += 1) {
      const previous = radii[index - 1] ?? 0;
      const current = radii[index] ?? 0;
      expect(readableRadiusUnits(current)).toBeGreaterThan(readableRadiusUnits(previous));
    }
    // The Sun's mean radius is 696 000 km (NASA Sun fact sheet,
    // `https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html`) — the
    // largest body in the contract, and still under a quarter of Mercury's orbit.
    expect(readableRadiusUnits(696_000)).toBeLessThan(readableDistanceUnits(0.387) / 4);
  });
})

describe("scenePosition", () => {
  it("scales by a function of the distance alone, so the direction is exact", () => {
    const position: Vector3 = [3, -4, 12];
    const length = Math.hypot(3, 4, 12);
    for (const scale of ["true", "readable"] as const) {
      const mapped = scenePosition(position, scale);
      const mappedLength = Math.hypot(mapped[0], mapped[1], mapped[2]);
      const expected =
        scale === "true" ? trueDistanceUnits(length) : readableDistanceUnits(length);
      expect(mappedLength).toBeCloseTo(expected, 10);
      // Parallel and pointing the same way: the cross product is zero and the
      // dot product is positive.
      expect(mapped[0] * position[1] - mapped[1] * position[0]).toBeCloseTo(0, 10);
      expect(mapped[0] * position[0] + mapped[1] * position[1] + mapped[2] * position[2]).toBeGreaterThan(0);
    }
  });

  it("keeps the Sun at the origin in both layouts", () => {
    expect(scenePosition([0, 0, 0], "true")).toEqual([0, 0, 0]);
    expect(scenePosition([0, 0, 0], "readable")).toEqual([0, 0, 0]);
  });
})

describe("placeBodies", () => {
  it("is the plain radial map at true scale", () => {
    const placed = placeBodies(earthAndMoon(), "true");
    expect(placed.get("earth")).toEqual([TRUE_UNITS_PER_AU, 0, 0]);
    expect(placed.get("moon")?.[0]).toBeCloseTo(
      TRUE_UNITS_PER_AU * (1 + MOON_MEAN_DISTANCE_AU),
      9,
    );
  });

  it("pushes the Moon clear of the enlarged Earth, keeping its direction from the Earth", () => {
    const snapshot = earthAndMoon();
    const placed = placeBodies(snapshot, "readable");
    const earth = placed.get("earth");
    const moon = placed.get("moon");
    if (earth === undefined || moon === undefined) throw new Error("the fixture is missing a body");

    const earthBody = snapshot.bodies.find((candidate) => candidate.id === "earth");
    const moonBody = snapshot.bodies.find((candidate) => candidate.id === "moon");
    if (earthBody === undefined || moonBody === undefined) throw new Error("fixture");
    const earthRadius = bodyRadiusUnits(earthBody, "readable");
    const moonRadius = bodyRadiusUnits(moonBody, "readable");
    const separation = Math.hypot(moon[0] - earth[0], moon[1] - earth[1], moon[2] - earth[2]);
    expect(separation).toBeCloseTo(earthRadius + moonRadius + SATELLITE_CLEARANCE_UNITS, 10);
    // The mapped radial gap between the two is about 0.049 units — a twentieth
    // of the drawn Earth's radius — so without the rule the Moon would be inside
    // the planet rather than beside it.
    const mappedGap = readableDistanceUnits(1 + MOON_MEAN_DISTANCE_AU) - readableDistanceUnits(1);
    expect(mappedGap).toBeLessThan(0.1);
    expect(separation).toBeGreaterThan(10 * mappedGap);
    // Still on the same ray from the Earth.
    expect(moon[1]).toBeCloseTo(0, 12);
    expect(moon[2]).toBeCloseTo(0, 12);
    expect(moon[0]).toBeGreaterThan(earth[0]);
  });

  it("leaves the other bodies to the radial map", () => {
    const placed = placeBodies(earthAndMoon(), "readable");
    expect(placed.get("sun")).toEqual([0, 0, 0]);
    expect(placed.get("earth")?.[0]).toBeCloseTo(readableDistanceUnits(1), 10);
  });
});
