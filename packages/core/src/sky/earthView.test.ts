import { describe, expect, it } from "vitest";
import { acosDeg, clampUnit, cosDeg, sinDeg } from "./angles.js";
import { dayNightAt, TERMINATOR_ANGULAR_RADIUS_DEG, TWILIGHT_ANGULAR_RADII_DEG } from "./earthView.js";
import { HORIZONS_SUBSOLAR } from "./fixtures/horizons.js";
import { nextMoonPhases } from "./phases.js";
import type { LatLon } from "./contract.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The great-circle distance between two places on the sphere, degrees (Meeus ch. 13). */
function arcBetween(a: LatLon, b: LatLon): number {
  return acosDeg(
    clampUnit(
      sinDeg(a.latDeg) * sinDeg(b.latDeg) +
        cosDeg(a.latDeg) * cosDeg(b.latDeg) * cosDeg(a.lonDeg - b.lonDeg),
    ),
  );
}

/** One fixture line's UT instant, its Horizons west-positive longitude and its latitude. */
interface SubsolarLine {
  readonly at: number;
  readonly westLongitude: number;
  readonly latitude: number;
}

function subsolarLines(): readonly SubsolarLine[] {
  const lines: SubsolarLine[] = [];
  for (const line of HORIZONS_SUBSOLAR.rows.replace(/\r/g, "").split("\n")) {
    const parsed =
      /^\s*(\d{4})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(line);
    if (parsed === null) continue;
    lines.push({
      at: Date.UTC(
        Number(parsed[1]),
        MONTHS.indexOf(parsed[2]!),
        Number(parsed[3]),
        Number(parsed[4]),
        Number(parsed[5]),
        Number(parsed[6]),
      ),
      westLongitude: Number(parsed[7]),
      latitude: Number(parsed[8]),
    });
  }
  return lines;
}

describe("dayNightAt's sub-solar point against JPL Horizons", () => {
  it("agrees with Horizons' own SunSub-LAT and SunSub-LON, and says what longitude cannot pin", () => {
    // Horizons' `SunSub-LON` is the apparent planetodetic longitude of the Sun on
    // the target and is written WEST-positive, so the engine's east-positive
    // longitude is its negative; `SunSub-LAT` is the matching latitude. Measured
    // 2026-10-10 over these ten epochs: 0.14 deg of latitude and 3.86 of
    // longitude. The latitude is the constant 20.5" of aberration the engine's
    // geometric Sun does not carry.
    //
    // **The longitude's bar is loose on purpose, and this test cannot pin the
    // SIGN of the convention.** Every epoch of this fixture is at 00:00 UT on
    // 1-2 January, when the sub-solar point sits within four degrees of the date
    // line (182.9 ... 177.1 west): a longitude and its mirror are then a few
    // degrees apart, which is exactly the size of the residual, so a sign error
    // passes here — it passed for months (the astronomy module's
    // `terminator.test.ts` is the measurement that caught it, checking the point
    // against `sunPosition`, whose east-positive longitude is held by the USNO
    // celnav fixtures). The bar is what is left after the convention was fixed,
    // and it fails if the residual grows; the exact measured pair is printed.
    let worstLatitude = 0;
    let worstLongitude = 0;
    for (const line of subsolarLines()) {
      const view = dayNightAt(line.at);
      const expectedLongitude = -line.westLongitude;
      const latitudeError = view.subsolar.latDeg - line.latitude;
      const longitudeError = ((((view.subsolar.lonDeg - expectedLongitude) % 360) + 540) % 360) - 180;
      worstLatitude = Math.max(worstLatitude, Math.abs(latitudeError));
      worstLongitude = Math.max(worstLongitude, Math.abs(longitudeError));
    }
    console.log("worst sub-solar latitude error", worstLatitude.toFixed(4), "longitude", worstLongitude.toFixed(4));
    expect(worstLatitude).toBeLessThan(0.2);
    expect(worstLongitude).toBeLessThan(4);
  });

  it("puts the sub-solar latitude within a degree of the apparent declination that defines it", () => {
    // The physical statement: the sub-solar latitude IS the Sun's declination, to
    // whatever the geometric and the apparent place differ by. On the ten fixture
    // epochs the geometric pair differ by 0.14 degrees of latitude, which is one
    // light-day of the Sun's own declination drift, and that is the bar.
    for (const line of subsolarLines()) {
      const view = dayNightAt(line.at);
      expect(Math.abs(view.subsolar.latDeg - line.latitude)).toBeLessThan(1);
    }
  });
});

describe("dayNightAt's moments of midnight", () => {
  it("puts the sub-solar point near the anti-meridian at 00:00 UT", () => {
    // The Earth turns a full circle a day relative to the Sun, so at Greenwich
    // midnight the Sun is overhead at the date line. This is the check that a
    // longitude's SIGN is wrong rather than its size: a formula that is 180
    // degrees out lands on the prime meridian here and nowhere else in the day.
    const view = dayNightAt(Date.parse("2020-06-21T00:00:00Z"));
    const fromDateLine = Math.abs((((view.subsolar.lonDeg - 180) % 360) + 540) % 360 - 180);
    expect(fromDateLine).toBeLessThan(2);
  });
});

describe("dayNightAt's circles", () => {
  it("closes each edge with samples + 1 points, the last repeating the first", () => {
    const view = dayNightAt(Date.parse("2026-10-10T00:00:00Z"), 90);
    for (const edge of [
      view.terminator,
      view.twilight.civil,
      view.twilight.nautical,
      view.twilight.astronomical,
    ]) {
      expect(edge.length).toBe(91);
      expect(edge[0]).toEqual(edge[90]);
    }
  });

  it("holds every point of the terminator 90 degrees of arc from the sub-solar point", () => {
    // The definition the contract fixes: the Sun's CENTRE on the geometric
    // horizon. Sixteen samples is enough to catch a circle that is built from the
    // wrong pole, and the tolerance is the polygon's own chord slack.
    const view = dayNightAt(Date.parse("2026-10-10T00:00:00Z"), 16);
    for (const point of view.terminator) {
      expect(arcBetween(point, view.subsolar)).toBeCloseTo(TERMINATOR_ANGULAR_RADIUS_DEG, 4);
    }
  });

  it("spaces the three twilights at the Sun's own 6, 12 and 18 degrees below the horizon", () => {
    const view = dayNightAt(Date.parse("2026-10-10T00:00:00Z"), 16);
    for (const point of view.twilight.civil) {
      expect(arcBetween(point, view.subsolar)).toBeCloseTo(TWILIGHT_ANGULAR_RADII_DEG.civil, 4);
    }
    for (const point of view.twilight.nautical) {
      expect(arcBetween(point, view.subsolar)).toBeCloseTo(TWILIGHT_ANGULAR_RADII_DEG.nautical, 4);
    }
    for (const point of view.twilight.astronomical) {
      expect(arcBetween(point, view.subsolar)).toBeCloseTo(TWILIGHT_ANGULAR_RADII_DEG.astronomical, 4);
    }
  });

  it("draws the sub-lunar point as the Moon's own overhead place, near the sub-solar one at new moon", () => {
    // At a new moon the Moon is within a couple of degrees of the Sun in the sky,
    // so the two overhead points are close; at a full moon the Moon is opposite
    // the Sun, so they are half a world apart. The two instants are the engine's
    // own principal phases -- `nextMoonPhases` from a start the tests fix -- which
    // is deliberate: `earthView` and the phase finder disagreeing is exactly the
    // defect this would catch. The fifteen-degree bar is the Moon's own 5 degrees
    // of ecliptic latitude plus the hour the phase finder allows itself.
    const start = Date.parse("2026-05-10T00:00:00Z");
    const phases = nextMoonPhases(start);
    const newMoon = dayNightAt(phases.newMoon);
    expect(arcBetween(newMoon.subsolar, newMoon.sublunar)).toBeLessThan(15);
    const fullMoon = dayNightAt(phases.fullMoon);
    expect(arcBetween(fullMoon.subsolar, fullMoon.sublunar)).toBeGreaterThan(150);
  });
});
