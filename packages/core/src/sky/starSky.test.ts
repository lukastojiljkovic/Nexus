import { describe, expect, it } from "vitest";
import { STAR_ORACLE, STAR_ORACLE_PLACE } from "./fixtures/starOracle.js";
import { allStars, skyFrame, starPlacement } from "./stars.js";

/** The brief's bar: one arcminute, in degrees. */
const ARCMINUTE = 1 / 60;

/** The gap between two right ascensions, walking the shorter way round the clock. */
function rightAscensionGap(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 360 - raw);
}

describe("the star map's geometry against an independent oracle", () => {
  it("agrees with Skyfield on five named stars at two instants, inside an arcminute", () => {
    // See `fixtures/starOracle.ts` for exactly what produced the expected
    // numbers: Skyfield 1.55 with JPL DE421, given the SAME catalogue positions
    // this package ships, so the comparison measures the coordinate chain and
    // not two catalogues against each other.
    let worstAltitude = 0;
    let worstAzimuth = 0;
    let worstDeclination = 0;
    let checked = 0;
    for (const instant of STAR_ORACLE) {
      const frame = skyFrame(STAR_ORACLE_PLACE, Date.parse(instant.instant));
      for (const row of instant.rows) {
        const star = allStars().find((candidate) => candidate.hr === row.hr);
        expect(star, `HR ${row.hr} is in the catalogue`).toBeDefined();
        // The catalogue still holds the position the oracle was handed.
        expect(star!.raDeg).toBeCloseTo(row.raDeg, 5);
        expect(star!.decDeg).toBeCloseTo(row.decDeg, 5);
        const placement = starPlacement(star!, frame);
        const label = `${row.name} at ${instant.instant}`;
        const altitudeGap = Math.abs(placement.altitude - row.altitude);
        const azimuthGap = Math.abs(placement.azimuth - row.azimuth);
        const declinationGap = Math.abs(placement.direction.declination - row.apparentDecDeg);
        const ascensionGap = rightAscensionGap(placement.direction.rightAscension, row.apparentRaDeg);
        checked += 1;
        expect(altitudeGap, `${label} altitude`).toBeLessThan(ARCMINUTE);
        expect(azimuthGap, `${label} azimuth`).toBeLessThan(ARCMINUTE);
        // The apparent place itself, not just where it was drawn: a wrong
        // azimuth is easy to notice, a right ascension that is 20 arcseconds out
        // and a sidereal time that compensates for it is not.
        expect(ascensionGap, `${label} right ascension`).toBeLessThan(ARCMINUTE);
        expect(declinationGap, `${label} declination`).toBeLessThan(ARCMINUTE);
        worstAltitude = Math.max(worstAltitude, altitudeGap);
        worstAzimuth = Math.max(worstAzimuth, azimuthGap);
        worstDeclination = Math.max(worstDeclination, declinationGap);
      }
    }
    expect(checked).toBe(10);
    // And what the chain actually achieves, MEASURED over these ten cases on
    // 2026-10-10: 1.05 arcseconds of altitude, 1.74 of azimuth and 0.10 of
    // declination - a fiftieth of the bar. The azimuth figure is the largest of
    // the three because Capella is 7.5 degrees from the zenith at one of the
    // instants, where an arcsecond of position is seven of azimuth. A wrong
    // sign anywhere - aberration the other way, nutation added instead of
    // subtracted, the nutation matrix's two obliquities swapped - is worth 20
    // arcseconds or more and fails these bounds loudly.
    expect(worstAltitude).toBeLessThan(2 / 3600);
    expect(worstAzimuth).toBeLessThan(3 / 3600);
    expect(worstDeclination).toBeLessThan(0.5 / 3600);
  });
});
