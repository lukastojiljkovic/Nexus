import { dayNightAt, solarSystemAt, sunPosition, type SkyPlace } from "@nexus/core";
import { describe, expect, it } from "vitest";

/**
 * The terminator's direction, in two places: the engine's sub-solar point, and
 * the 3D globe's own lighting geometry.
 *
 * The first is a definition anybody can check by hand — at the point the Sun is
 * overhead of, the Sun's altitude is 90 degrees — and it is the seam between the
 * day-and-night map's engine (`earthView.ts`) and the Sun's own (`sun.ts`): the
 * two are computed by different routes, and this is the statement that they
 * agree.
 *
 * The second is the 3D view's. `night.ts` measures each fragment's angle to the
 * world origin, which is where the view puts its one light, so the direction of
 * the drawn terminator is the Earth's pole against the direction from the Earth
 * to the Sun. That sub-solar latitude must be the engine's own, or the globe's
 * night side would disagree with the map beside it.
 */

/** 2026-10-10T20:30Z, the instant the module's other tests use. */
const AT = Date.UTC(2026, 9, 10, 20, 30);

describe("the sub-solar point, measured by the engine's own Sun", () => {
  it("has the Sun at the zenith, which is what the point means", () => {
    const { subsolar } = dayNightAt(AT);
    const place: SkyPlace = { latitude: subsolar.latDeg, longitude: subsolar.lonDeg };
    const sun = sunPosition(place, AT);
    // The engine's sub-solar point is GEOMETRIC and `sunPosition` is the APPARENT
    // Sun, so the two differ by the arcminutes the engine documents — the Sun's
    // own motion in the eight minutes its light takes plus 20.5" of aberration.
    // Measured on this instant: 0.0027 deg of altitude.
    expect(sun.altitude).toBeGreaterThan(89.5);
    // And the longitude's SIGN is what this test is really for. These are
    // `LatLon`s on both sides, and `LatLon.lonDeg` is east-positive everywhere
    // else in the package (`cities.ts`, `zoneLocation.ts`, the USNO celnav
    // fixtures); the mirrored longitude is a midnight Sun rather than noon, and
    // it is invisible against the Horizons sub-solar fixture, every epoch of
    // which sits near the date line. The mirror's hour angle is twice this
    // longitude away from noon, which is what the second assertion measures.
    const mirrored = sunPosition({ latitude: subsolar.latDeg, longitude: -subsolar.lonDeg }, AT);
    expect(sun.hourAngle).toBeCloseTo(0, 1);
    expect(Math.abs(mirrored.hourAngle)).toBeGreaterThan(80);
  });
});

describe("the 3D globe's terminator", () => {
  it("is tilted to the engine's own sub-solar latitude", () => {
    const { subsolar } = dayNightAt(AT);
    const snapshot = solarSystemAt(AT);
    const earth = snapshot.bodies.find((body) => body.id === "earth");
    if (earth === undefined) throw new Error("the engine has no Earth");

    // The view puts the Sun at the world origin and the Earth at its own
    // heliocentric position, so this is the direction `night.ts` builds per
    // fragment: `normalize(-worldPosition)`, normalised here once.
    const toSun = unit([-earth.position[0], -earth.position[1], -earth.position[2]]);
    const pole = unit([earth.northPole[0], earth.northPole[1], earth.northPole[2]]);
    const subsolarLatitude = 90 - (Math.acos(clamp(dot(toSun, pole))) * 180) / Math.PI;

    // The Earth's pole is the IAU model's ICRF pole rotated into the ecliptic of
    // J2000, while `subsolar.latDeg` is the Sun's declination in the equinox of
    // DATE; the two differ by precession since J2000, which is under half a
    // degree. One degree is the same bar `earthView.test.ts` uses for the
    // declination itself, and it is tight enough that a flipped sign fails.
    expect(Math.abs(subsolarLatitude - subsolar.latDeg)).toBeLessThan(1);
  });
});

function unit(v: readonly [number, number, number]): readonly [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The engine's own `clampUnit`, written here for a two-line test rather than imported from a package-private module. */
function clamp(value: number): number {
  return Math.min(1, Math.max(-1, value));
}
