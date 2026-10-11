import { describe, expect, it } from "vitest";
import { refractionDegrees } from "./horizontal.js";
import { sunEquatorial, sunPosition } from "./sun.js";
import { USNO_CELNAV_2026 } from "./fixtures/usnoCelnav.js";
import { placeFor } from "./fixtures/usnoParse.js";

/** One celnav response, as much as the tests read. */
interface CelnavBody {
  readonly object: string;
  readonly almanac_data: {
    readonly dec: number;
    readonly gha: number;
    readonly hc: number;
    readonly zn: number;
  };
  readonly altitude_corrections: { readonly pa: number; readonly refr: number };
}

function celnavBodies(body: string): readonly CelnavBody[] {
  return (JSON.parse(body) as { properties: { data: readonly CelnavBody[] } }).properties.data;
}

function celnavInstant(entry: (typeof USNO_CELNAV_2026)[number]): Date {
  return new Date(`${entry.date}T${entry.time}:00.000Z`);
}

describe("sunEquatorial", () => {
  it("reproduces Meeus's worked example 25.b to the digits he prints", () => {
    // 1992 October 13.0 TD, JDE 2448908.5 (ch. 25, "Solar Coordinates").
    const sun = sunEquatorial(2448908.5);
    expect(sun.apparentLongitude).toBeCloseTo(199.90895, 4);
    expect(sun.rightAscension).toBeCloseTo(198.38083, 3);
    expect(sun.declination).toBeCloseTo(-7.78507, 3);
  });

  it("turns the same instant into the same place from a Date, through UT", () => {
    // The example is stated in TD and the engine's input is UT; at 1992 the
    // difference the engine applies is the ch. 10 polynomial's own answer for
    // that year, so the two agree only to about a hundredth of a degree here.
    // What this test holds is the ORDER of magnitude, not the book's digits.
    const fromDate = sunPosition({ latitude: 44.82, longitude: 20.46 }, Date.parse("1992-10-13T00:00:00Z"));
    expect(fromDate.rightAscension).toBeCloseTo(198.38083, 1);
    expect(fromDate.declination).toBeCloseTo(-7.78507, 1);
  });
});

describe("sunPosition against USNO's celestial navigation data", () => {
  /**
   * `hc` is the GEOCENTRIC altitude and `pa` the parallax in altitude, so
   * `hc - pa` is the topocentric altitude of the body's centre before
   * refraction — which is exactly what `SunPosition.altitude` reports. `zn` is
   * USNO's azimuth from true north. Both are printed to six decimals, so the
   * comparison measures the models rather than the rounding.
   */
  it("matches the published altitude and azimuth at every listed instant", () => {
    const worst = { altitude: 0, azimuth: 0 };
    for (const entry of USNO_CELNAV_2026) {
      const sun = celnavBodies(entry.body).find((body) => body.object === "Sun");
      if (sun === undefined) continue;
      const position = sunPosition(placeFor(entry.place), celnavInstant(entry));
      const topocentric = sun.almanac_data.hc - sun.altitude_corrections.pa;
      worst.altitude = Math.max(worst.altitude, Math.abs(position.altitude - topocentric));
      worst.azimuth = Math.max(worst.azimuth, Math.abs(position.azimuth - sun.almanac_data.zn));
      expect(position.altitude, `${entry.place} ${entry.time} altitude`).toBeCloseTo(topocentric, 1);
      expect(position.azimuth, `${entry.place} ${entry.time} azimuth`).toBeCloseTo(sun.almanac_data.zn, 1);
    }
    // Measured 2026-10-09: 0.002 deg altitude, 0.010 deg azimuth.
    expect(worst.altitude).toBeLessThan(0.05);
    expect(worst.azimuth).toBeLessThan(0.05);
  });

  it("agrees with USNO's declination and hour angle, which is what its sidereal time has to be", () => {
    for (const entry of USNO_CELNAV_2026) {
      const sun = celnavBodies(entry.body).find((body) => body.object === "Sun");
      if (sun === undefined) continue;
      const place = placeFor(entry.place);
      const position = sunPosition(place, celnavInstant(entry));
      expect(position.declination, `${entry.place} ${entry.time} dec`).toBeCloseTo(sun.almanac_data.dec, 1);
      // celnav's Greenwich hour angle plus the longitude is the LOCAL hour angle.
      const localHourAngle = (((sun.almanac_data.gha + place.longitude) % 360) + 540) % 360 - 180;
      expect(position.hourAngle, `${entry.place} ${entry.time} hour angle`).toBeCloseTo(localHourAngle, 1);
    }
  });
});

describe("refractionDegrees", () => {
  it("is Saemundsson's formula, by hand, at two altitudes", () => {
    // Meeus ch. 16: R = 1.02 / tan(h + 10.3/(h + 5.11)) arcminutes.
    //   h = 0: 10.3/5.11 = 2.0156556, tan(2.0156556 deg) = 0.035194347
    //          R = 1.02 / 0.035194347 = 28.981927 arcmin = 0.48303212 deg
    expect(refractionDegrees(0)).toBeCloseTo(0.4830321, 6);
    //   h = 45: 10.3/50.11 = 0.2055478, tan(45.2055478 deg) = 1.007200836
    //           R = 1.02 / 1.007200836 = 1.01270766 arcmin = 0.016878461 deg
    expect(refractionDegrees(45)).toBeCloseTo(0.016878461, 8);
  });

  it("is the same order of size as the refraction USNO applied", () => {
    // Not an identity: USNO does not say whose refraction model it uses, and at
    // 68 degrees the two agree to 0.002 arcminutes while at 3 degrees they are
    // 1.57 arcminutes apart (Belgrade, 03:05 UT) — where the refraction itself is
    // 20 arcminutes. The bar is five, and the point is that the engine's own
    // refraction is not systematically wrong, not that it is USNO's.
    let worst = 0;
    for (const entry of USNO_CELNAV_2026) {
      const sun = celnavBodies(entry.body).find((body) => body.object === "Sun");
      if (sun === undefined) continue;
      const position = sunPosition(placeFor(entry.place), celnavInstant(entry));
      worst = Math.max(worst, Math.abs(refractionDegrees(position.altitude) + sun.altitude_corrections.refr));
      expect(
        Math.abs(refractionDegrees(position.altitude) + sun.altitude_corrections.refr),
        `${entry.place} ${entry.time}`,
      ).toBeLessThan(5 / 60);
    }
    // Measured 2026-10-09: 0.0262 deg, at Belgrade's 03:05 UT sighting 0.9 deg up.
    expect(worst).toBeLessThan(5 / 60);
  });
});
