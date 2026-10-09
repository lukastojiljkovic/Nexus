import { describe, expect, it } from "vitest";
import { moonEcliptic, moonPosition } from "./moon.js";
import { USNO_CELNAV_2026 } from "./fixtures/usnoCelnav.js";
import { oneDayEntries, placeFor } from "./fixtures/usnoParse.js";

interface CelnavBody {
  readonly object: string;
  readonly almanac_data: {
    readonly dec: number;
    readonly gha: number;
    readonly hc: number;
    readonly zn: number;
  };
  readonly altitude_corrections: { readonly pa: number };
}

function celnavBodies(body: string): readonly CelnavBody[] {
  return (JSON.parse(body) as { properties: { data: readonly CelnavBody[] } }).properties.data;
}

describe("moonEcliptic", () => {
  it("reproduces Meeus's worked example 47.a to the digits he prints", () => {
    // 1992 April 12.0 TD, JDE 2448724.5 (ch. 47, "Position of the Moon").
    const moon = moonEcliptic(2448724.5);
    expect(moon.longitude).toBeCloseTo(133.162655, 4);
    expect(moon.latitude).toBeCloseTo(-3.229126, 4);
    expect(moon.distanceKm).toBeCloseTo(368409.7, 1);
  });
});

describe("moonPosition against USNO's celestial navigation data", () => {
  it("matches the published altitude and azimuth wherever USNO publishes the Moon", () => {
    let checked = 0;
    for (const entry of USNO_CELNAV_2026) {
      const moon = celnavBodies(entry.body).find((body) => body.object === "Moon");
      if (moon === undefined) continue;
      checked += 1;
      const position = moonPosition(placeFor(entry.place), new Date(`${entry.date}T${entry.time}:00.000Z`));
      // The Moon's parallax is about a degree, so this comparison is the whole
      // point of the fixture: `hc` alone is the geocentre's view of the Moon,
      // which is a degree away from the one an observer has.
      expect(position.altitude, `${entry.place} ${entry.time} altitude`).toBeCloseTo(
        moon.almanac_data.hc - moon.altitude_corrections.pa,
        1,
      );
      expect(position.azimuth, `${entry.place} ${entry.time} azimuth`).toBeCloseTo(moon.almanac_data.zn, 1);
      expect(position.declination, `${entry.place} ${entry.time} dec`).toBeCloseTo(moon.almanac_data.dec, 1);
    }
    // Measured 2026-10-09 over the seven instants that publish a Moon:
    // 0.001 deg altitude, 0.003 deg azimuth, 0.001 deg declination.
    expect(checked).toBe(7);
  });
});

describe("moonPosition's illuminated fraction", () => {
  it("matches the percentage USNO prints for the same noon, within its own rounding", () => {
    // USNO's `fracillum` is the lit fraction at 12:00 UT on the requested day,
    // rounded to a whole percent, so a half-percent is the most this can hold.
    for (const entry of oneDayEntries()) {
      const position = moonPosition(placeFor(entry.place), new Date(`${entry.date}T12:00:00.000Z`));
      const published = Number(entry.body.fracillum.replace("%", "")) / 100;
      expect(position.illuminatedFraction, `${entry.place} ${entry.date}`).toBeCloseTo(published, 2);
    }
  });
});
