import { describe, expect, it } from "vitest";
import { northFromSun, sunOrientation } from "./orientation.js";
import { sunPosition } from "./sun.js";
import { USNO_CELNAV_2026 } from "./fixtures/usnoCelnav.js";
import { placeFor } from "./fixtures/usnoParse.js";

describe("northFromSun", () => {
  it("counts clockwise from straight ahead to true north, by hand", () => {
    // Facing the Sun due south, north is behind you.
    expect(northFromSun(180)).toBeCloseTo(180, 9);
    // Facing the Sun due east, north is a quarter turn anti-clockwise: 270 degrees
    // clockwise.
    expect(northFromSun(90)).toBeCloseTo(270, 9);
    // Facing the Sun due north, north is straight ahead.
    expect(northFromSun(0)).toBeCloseTo(0, 9);
    expect(northFromSun(359)).toBeCloseTo(1, 9);
  });

  it("takes the Sun's place in the view into account", () => {
    // The Sun due south is 90 degrees to your right, so you face east: north is
    // a three-quarter turn clockwise from straight ahead.
    expect(northFromSun(180, 90)).toBeCloseTo(270, 9);
    // The same Sun 90 degrees to your left: you face west, and north is a
    // quarter turn clockwise.
    expect(northFromSun(180, -90)).toBeCloseTo(90, 9);
    // A sighting due north with the Sun to your right: you face west too.
    expect(northFromSun(0, 90)).toBeCloseTo(90, 9);
  });
});

describe("sunOrientation", () => {
  it("is the same reading as the engine's own azimuth, plus the geometry above", () => {
    for (const entry of USNO_CELNAV_2026) {
      const place = placeFor(entry.place);
      const at = new Date(`${entry.date}T${entry.time}:00.000Z`);
      for (const offset of [0, 40, -40]) {
        const reading = sunOrientation(place, at, offset);
        expect(reading.sunAzimuth).toBeCloseTo(sunPosition(place, at).azimuth, 9);
        expect(reading.northFromStraightAhead).toBeCloseTo(northFromSun(reading.sunAzimuth, offset), 9);
      }
    }
  });

  it("reads due north from a southern-hemisphere noon, where the Sun is due north", () => {
    // Sydney on 1 January 2026: the Sun's upper transit is at 01:59 UT, when
    // USNO's own azimuth for it is 0.02 degrees — that is, due north, which is
    // what "south" means from the southern hemisphere. With the Sun straight
    // ahead, true north is straight ahead too.
    const reading = sunOrientation({ latitude: -33.87, longitude: 151.21 }, Date.parse("2026-01-01T01:59:00Z"));
    // 0.57 degrees west of due north: the published transit is 01:59 to the
    // minute, and the Sun's azimuth moves about a quarter of a degree a minute
    // there, so the minute's rounding is most of the difference.
    expect(Math.min(reading.sunAzimuth, 360 - reading.sunAzimuth)).toBeLessThan(1);
    expect(reading.northFromStraightAhead).toBeLessThan(1);
    // ...and the northern hemisphere's answer is the opposite one: Belgrade at
    // its own transit sees the Sun due south, so north is behind the observer.
    const opposite = sunOrientation({ latitude: 44.82, longitude: 20.46 }, Date.parse("2026-06-21T10:40:00Z"));
    expect(opposite.sunAzimuth).toBeCloseTo(180, 0);
    expect(opposite.northFromStraightAhead).toBeCloseTo(180, 0);
  });
});
