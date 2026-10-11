import { solarSystemAt, type SolarSystemSnapshot, type Vector3 } from "@nexus/core";
import { describe, expect, it } from "vitest";

import { solarPalette } from "./palette.js";
import { MOON_ORBIT_SAMPLES, moonOrbitPath, orbitPaths } from "./orbits.js";
import { buildSolarScene } from "./scene.js";
import {
  KM_PER_AU,
  SATELLITE_CLEARANCE_UNITS,
  satelliteClearanceUnits,
  satelliteOffsetUnits,
  type SolarScale,
} from "./scale.js";

/**
 * The drawn orbits, and the one that is not like the others.
 *
 * The Moon's path is the gap wave 1 left: its dot was placed beside its enlarged
 * planet while its line was drawn from the heliocentric radial map, so in
 * readable scale the dot stood off its own orbit. What is pinned here is the fix
 * — the path is geocentric offsets with a named parent, and the dot is exactly ON
 * the drawn line in both layouts, because the two go through one transform.
 */

/** 2026-10-10T20:30Z, the instant the module's other tests use. */
const AT = Date.UTC(2026, 9, 10, 20, 30);

describe("moonOrbitPath", () => {
  it("samples geocentric offsets over one sidereal month, and closes the loop", () => {
    const path = moonOrbitPath(AT);
    expect(path.id).toBe("moon");
    // The one field `contract.ts` added for this path: its points are the Moon
    // minus the Earth, so a view must draw them around the Earth.
    expect(path.parent).toBe("earth");
    expect(path.points).toHaveLength(MOON_ORBIT_SAMPLES + 1);

    // Every offset is the Moon's own distance from the Earth at that instant.
    // NASA's Moon fact sheet gives a perigee of 356 500 km and an apogee of
    // 406 700 km, so every sample must sit inside 0.002383 … 0.002719 au; the
    // small allowance is for the engine's own approximation rather than a claim
    // that the true range is wider.
    const perigee = 356_500 / KM_PER_AU;
    const apogee = 406_700 / KM_PER_AU;
    for (const point of path.points) {
      const length = Math.hypot(point[0], point[1], point[2]);
      expect(length, "perigee").toBeGreaterThan(perigee - 0.00002);
      expect(length, "apogee").toBeLessThan(apogee + 0.00002);
    }
  });

  it("is the only path with a parent, and every planet's is heliocentric", () => {
    const paths = orbitPaths(AT);
    expect(paths.map((path) => path.id)).toEqual([
      "mercury",
      "venus",
      "earth",
      "mars",
      "jupiter",
      "saturn",
      "uranus",
      "neptune",
      "pluto",
      "moon",
    ]);
    for (const path of paths) {
      expect(path.parent ?? null, path.id).toBe(path.id === "moon" ? "earth" : null);
    }
  });
});

describe("the Moon's dot and the Moon's line", () => {
  it("use one transform, so the dot lies exactly on the line in both layouts", () => {
    const snapshot = solarSystemAt(AT);
    const orbits = orbitPaths(AT);
    for (const scale of ["readable", "true"] as const) {
      const scene = buildSolarScene({ snapshot, orbits, scale, palette: solarPalette("dan") });
      const moon = scene.bodies.find((handle) => handle.id === "moon");
      const earth = scene.bodies.find((handle) => handle.id === "earth");
      if (moon?.orbit == null || earth === undefined) throw new Error("no Moon orbit in the graph");

      expect(moon.orbitParent, scale).toBe("earth");
      // The line's own transform is the parent's drawn position …
      expect(moon.orbit.position.toArray(), scale).toEqual(earth.group.position.toArray());
      // … and its vertices are the offsets the dot was placed with.
      const positions = moon.orbit.geometry.getAttribute("position");
      let closest = Number.POSITIVE_INFINITY;
      for (let index = 0; index < positions.count; index += 1) {
        closest = Math.min(
          closest,
          Math.hypot(
            moon.group.position.x - (moon.orbit.position.x + positions.getX(index)),
            moon.group.position.y - (moon.orbit.position.y + positions.getY(index)),
            moon.group.position.z - (moon.orbit.position.z + positions.getZ(index)),
          ),
        );
      }
      // The path's first sample IS the current instant, so the closest vertex is
      // the dot itself. The vertices live in a `Float32Array` (three.js's own
      // attribute for a line), so a value a couple of units from the line's
      // origin agrees to float32's epsilon — 1e-7 — and not to float64's. That is
      // seven orders of magnitude below the Moon's drawn radius (0.85 units) and
      // five below the sample step.
      expect(closest, scale).toBeLessThan(1e-6);

      if (scale === "readable") {
        // And the readable layout really did need the rule: the gap the radial
        // map would have left is well inside the drawn planet.
        const separation = moon.group.position.distanceTo(earth.group.position);
        expect(separation).toBeCloseTo(
          moon.mesh.scale.x + earth.mesh.scale.x + SATELLITE_CLEARANCE_UNITS,
          9,
        );
      }
    }
  });
});

/**
 * The page rebuilds its paths once per `ORBIT_REFRESH_MS` (ten minutes,
 * `Page.tsx`) so a per-second clock cannot reallocate the whole scene graph
 * every second. That means the line a dot is compared against may have been
 * sampled a full window earlier than the dot itself, and this is that worst
 * case for the one path whose phase matters.
 */
describe("the ten-minute refresh between the dot and its line", () => {
  const WINDOW_MS = 600_000;

  /** The Moon's geocentric offset at `atMs`, as the path samples it. */
  function moonOffset(snapshot: SolarSystemSnapshot): Vector3 {
    const moon = snapshot.bodies.find((body) => body.id === "moon");
    const earth = snapshot.bodies.find((body) => body.id === "earth");
    if (moon === undefined || earth === undefined) throw new Error("no Moon and Earth");
    return [
      moon.position[0] - earth.position[0],
      moon.position[1] - earth.position[1],
      moon.position[2] - earth.position[2],
    ];
  }

  /** The distance from a point to the polyline, through the transform the view draws with. */
  function distanceToLine(
    point: Vector3,
    offsets: readonly Vector3[],
    clearance: number,
    scale: SolarScale,
  ): number {
    const vertices = offsets.map((offset) => satelliteOffsetUnits(offset, clearance, scale));
    let closest = Number.POSITIVE_INFINITY;
    for (let index = 1; index < vertices.length; index += 1) {
      const a = vertices[index - 1];
      const b = vertices[index];
      if (a === undefined || b === undefined) continue;
      const ab: Vector3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ap: Vector3 = [point[0] - a[0], point[1] - a[1], point[2] - a[2]];
      const lengthSquared = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      const t = Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / lengthSquared));
      closest = Math.min(
        closest,
        Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t),
      );
    }
    return closest;
  }

  it("keeps the dot within a thousandth of a unit of a line up to a full window old", () => {
    // The page rebuilds at `floor(t / WINDOW)`, so the age of the line an
    // opening sees is uniform over the window; the worst case is therefore a
    // sweep of the window's own offsets, and of the month's worth of instants
    // the Moon's own orbital speed varies over.
    const monthMs = 27.321661 * 86_400_000;
    let worst = 0;
    let worstAt = "";
    for (let k = 0; k < 5; k += 1) {
      const instant = AT + (monthMs * k) / 5;
      const snapshot = solarSystemAt(instant);
      const moon = snapshot.bodies.find((body) => body.id === "moon");
      const earth = snapshot.bodies.find((body) => body.id === "earth");
      if (moon === undefined || earth === undefined) throw new Error("no Moon and Earth");
      for (let step = 0; step <= 3; step += 1) {
        const ageMs = (WINDOW_MS * step) / 3;
        const stale = moonOrbitPath(instant - ageMs).points;
        for (const scale of ["readable", "true"] as const) {
          const clearance = satelliteClearanceUnits(earth, moon, scale);
          const dot = satelliteOffsetUnits(moonOffset(snapshot), clearance, scale);
          const measured = distanceToLine(dot, stale, clearance, scale);
          if (measured > worst) {
            worst = measured;
            worstAt = `${scale}, ${String(Math.round(ageMs / 1000))} s old, ${new Date(instant).toISOString()}`;
          }
        }
      }
    }
    // Measured on 2026-10-10 over this sweep: 8.7e-5 units (readable, a line a
    // full window old). The bar is five times that, and it is a claim about the
    // page rather than about this fixture: `Page.tsx`'s `ORBIT_REFRESH_MS` states
    // the same bound in words.
    console.log("worst dot to stale line", worst.toExponential(3), worstAt);
    expect(worst).toBeLessThan(5e-4);
  });
});
