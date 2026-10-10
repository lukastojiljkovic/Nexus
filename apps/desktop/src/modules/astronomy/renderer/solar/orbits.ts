import { orbitPath, solarSystemAt, type BodyId, type OrbitPath, type Vector3 } from "@nexus/core";

/**
 * The orbit paths the 3D view draws, one per body that has a path at all.
 *
 * **Planets come from the engine; the Moon does not, and cannot.** `orbitPath`
 * is JPL's own Keplerian route — elements, mean anomaly, Kepler's equation —
 * and the table behind it carries the eight planets and Pluto. The Moon has no
 * orbital elements there, and `orbitPath("moon", …)` throws for that reason.
 * Nor would a heliocentric sampling of the Moon be a useful orbit: over one
 * sidereal month the Earth travels about 27 degrees along its own orbit, so the
 * Moon's heliocentric path is an ARC of the Earth's orbit with small wiggles
 * rather than a closed loop around its planet.
 *
 * **So the Moon's path is sampled geocentrically and marked with its parent.**
 * Each point is the engine's own `moon − earth` offset at that instant
 * (`solarSystemAt`, the same call the dot comes from), and the path names
 * `earth` as its `parent` — the one thing `contract.ts` added for this. The view
 * then draws the offset around the Earth with the SAME stretched transform it
 * places the dot with (`scale.ts`), which is what makes the dot lie on the line
 * in the readable layout as well as in true scale.
 *
 * **The period is the sidereal month, and it is a fact with a source.** NASA's
 * Moon fact sheet gives the sidereal orbit period as 27.321661 days
 * (`https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html`), which is
 * the time the Moon takes to return to the same direction as seen from the
 * Earth — the loop this draws — rather than the synodic month the phases use.
 */

/** The bodies whose orbit the engine can sample heliocentrically, in the contract's own order minus the Sun (a point) and the Moon (a satellite). */
export const ORBIT_BODIES: readonly BodyId[] = [
  "mercury",
  "venus",
  "earth",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
];

/**
 * How many points each planet's path is sampled at.
 *
 * One period per point budget: Mercury's year is 88 days and Pluto's 248 years,
 * so this is the resolution of the longest path drawn, and 256 points is a
 * smooth curve at the frame the whole system opens in.
 */
export const ORBIT_SAMPLES = 256;

/** The Moon's sidereal orbit period, in days (NASA Moon fact sheet). */
export const MOON_SIDEREAL_PERIOD_DAYS = 27.321661;

/**
 * How many points the Moon's geocentric loop is sampled at.
 *
 * Fewer than a planet's, because the loop is drawn a couple of units across at
 * readable scale and each sample is a full `solarSystemAt` call rather than one
 * body's position — 181 points close the circle with a smooth seam.
 */
export const MOON_ORBIT_SAMPLES = 181;

const MS_PER_DAY = 86_400_000;

/**
 * The Moon's orbit as the view draws it: geocentric offsets, one sidereal month
 * long, closed by repeating the first point.
 *
 * The offsets are the engine's own (Moon minus Earth at the same instant), so
 * the loop is the Moon's real path around its planet including the orbit's own
 * inclination, rather than a circle somebody drew.
 */
export function moonOrbitPath(
  instantMs: number,
  samples: number = MOON_ORBIT_SAMPLES,
): OrbitPath {
  const periodMs = MOON_SIDEREAL_PERIOD_DAYS * MS_PER_DAY;
  const points: Vector3[] = [];
  for (let index = 0; index <= samples; index += 1) {
    const snapshot = solarSystemAt(instantMs + (periodMs * index) / samples);
    const earth = snapshot.bodies.find((body) => body.id === "earth");
    const moon = snapshot.bodies.find((body) => body.id === "moon");
    if (earth === undefined || moon === undefined) continue;
    points.push([
      moon.position[0] - earth.position[0],
      moon.position[1] - earth.position[1],
      moon.position[2] - earth.position[2],
    ]);
  }
  return { id: "moon", points, parent: "earth" };
}

/** Every path the view draws for one instant: the planets heliocentrically, the Moon around the Earth. */
export function orbitPaths(
  instantMs: number,
  samples: number = ORBIT_SAMPLES,
): readonly OrbitPath[] {
  return [
    ...ORBIT_BODIES.map((id) => orbitPath(id, instantMs, samples)),
    moonOrbitPath(instantMs),
  ];
}
