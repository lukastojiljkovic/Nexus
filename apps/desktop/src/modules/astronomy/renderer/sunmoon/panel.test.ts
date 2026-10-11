import { describe, expect, it } from "vitest";
import {
  compassNorth,
  coordinateText,
  dayLength,
  latitudeText,
  localDateKey,
  longitudeText,
  moonDisk,
  parseCoordinate,
  phaseSequence,
  skyPlace,
  sunMoonReadings,
  twilightRows,
} from "./panel.js";

/**
 * The published values here are USNO's, from
 * `https://aa.usno.navy.mil/api/rstt/oneday?date=DATE&coords=LAT,LON&tz=0` for
 * the place and date beside each one (`tz=0` is what makes the answer Universal
 * Time, the engine's own frame). They are the same responses
 * `packages/core/src/sky/fixtures/usnoOneDay.ts` keeps verbatim and the same
 * tolerances `horizon.test.ts` holds the engine to — a minute for the Sun, two
 * for a twilight limit, three for the Moon, half a minute being USNO's own
 * rounding to the minute. What is under test here is the PANEL's reading of the
 * engine, so the assertions are on what it prints (which row says what, which
 * state replaces a time), not on the engine's own arithmetic.
 */
const BELGRADE = { latDeg: 44.82, lonDeg: 20.46 };
const TROMSO = { latDeg: 69.65, lonDeg: 18.96 };

/** Seconds between two instants, or `null` when exactly one of them is absent. */
function apart(at: Date | null, expected: Date | null): number | null {
  if (at === null || expected === null) return at === null && expected === null ? 0 : null;
  return Math.abs(at.getTime() - expected.getTime()) / 1000;
}

const utc = (text: string): Date => new Date(`${text}:00.000Z`);

describe("sunMoonReadings", () => {
  it("reads Belgrade's first day of 2026 the way USNO published it", () => {
    // USNO: sunrise 06:16 UT, upper transit 10:42, sunset 15:08, civil twilight
    // 05:42 to 15:41, moonset 04:22, moonrise 12:40, 94% illuminated.
    //
    // The instant asked about is 12:00 UT because that is when the day's phase
    // and illumination are quoted: USNO publishes `curphase` and `fracillum` at
    // noon, and the illuminated fraction moves about a third of a percent an
    // hour, so comparing them against midnight would be comparing two different
    // instants. The day-scoped events are the same either way: they belong to
    // the UTC day, not to the instant inside it.
    const readings = sunMoonReadings(skyPlace(BELGRADE), utc("2026-01-01T12:00"));
    expect(apart(readings.sun.rise, utc("2026-01-01T06:16"))).toBeLessThanOrEqual(60);
    expect(apart(readings.sun.transit, utc("2026-01-01T10:42"))).toBeLessThanOrEqual(60);
    expect(apart(readings.sun.set, utc("2026-01-01T15:08"))).toBeLessThanOrEqual(60);
    expect(apart(readings.twilight.civil.dawn, utc("2026-01-01T05:42"))).toBeLessThanOrEqual(120);
    expect(apart(readings.twilight.civil.dusk, utc("2026-01-01T15:41"))).toBeLessThanOrEqual(120);
    expect(apart(readings.moon.set, utc("2026-01-01T04:22"))).toBeLessThanOrEqual(180);
    expect(apart(readings.moon.rise, utc("2026-01-01T12:40"))).toBeLessThanOrEqual(180);
    // USNO prints `fracillum` as 94%, and calls the phase "Waxing Gibbous"; the
    // engine's own octant name for that elongation is `waxing-gibbous`.
    expect(readings.phase.illuminatedFraction).toBeCloseTo(0.94, 2);
    expect(readings.phase.phase).toBe("waxing-gibbous");
    // The day length is the gap between the published rise and set: 06:16 to
    // 15:08 is 8 h 52 min, which is 31 920 seconds.
    expect(Math.abs(readings.sun.dayLengthSeconds - 31_920)).toBeLessThanOrEqual(120);
    // The next full moon: USNO's `closestphase` for that day is Full Moon on
    // 2026-01-03 at 10:03 UT, and a waning Moon after it.
    expect(apart(readings.phases.fullMoon, utc("2026-01-03T10:03"))).toBeLessThanOrEqual(600);
    expect(readings.phases.fullMoon.getTime()).toBeLessThan(readings.phases.lastQuarter.getTime());
    expect(readings.phases.lastQuarter.getTime()).toBeLessThan(readings.phases.newMoon.getTime());
    expect(readings.phases.newMoon.getTime()).toBeLessThan(readings.phases.firstQuarter.getTime());
    for (const phase of Object.values(readings.phases)) {
      const days = (phase.getTime() - Date.parse("2026-01-01T00:00:00Z")) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThanOrEqual(30);
    }
  });

  it("names polar day and polar night instead of a time", () => {
    // USNO for Tromso on 2026-06-21 prints "Object continuously above the
    // Horizon" and "Object continuously above the Twilight Limit"; on 2026-12-21
    // it prints "Object continuously below the Horizon" (with a short civil
    // twilight in the middle of the day).
    const summer = sunMoonReadings(skyPlace(TROMSO), utc("2026-06-21T00:00"));
    expect(summer.sun.state).toBe("always-above");
    expect(summer.sun.rise).toBeNull();
    expect(summer.sun.set).toBeNull();
    expect(summer.sun.dayLengthSeconds).toBe(86_400);
    expect(summer.twilight.civil.state).toBe("always-above");

    const winter = sunMoonReadings(skyPlace(TROMSO), utc("2026-12-21T00:00"));
    expect(winter.sun.state).toBe("always-below");
    expect(winter.sun.rise).toBeNull();
    expect(winter.sun.set).toBeNull();
    expect(winter.sun.dayLengthSeconds).toBe(0);
    expect(winter.twilight.civil.state).toBe("crosses");
  });

  it("puts the Sun due south at its own transit, and at its highest", () => {
    // At upper transit the hour angle is zero, so in Belgrade (44.82 north, and
    // a June declination of about 23.44) the Sun is due south: azimuth 180, and
    // the altitude is 90 - (44.82 - 23.44) = 68.62 degrees.
    const day = sunMoonReadings(skyPlace(BELGRADE), utc("2026-06-21T00:00"));
    const transit = day.sun.transit;
    expect(transit).not.toBeNull();
    const atTransit = sunMoonReadings(skyPlace(BELGRADE), transit!);
    expect(Math.abs(atTransit.sunAzimuth - 180)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(atTransit.sunAltitude - 68.62)).toBeLessThanOrEqual(0.5);
    // Facing the Sun, north is behind you: 180 degrees from straight ahead.
    expect(compassNorth(atTransit.sunAzimuth, 0)).toBeCloseTo(180, 1);
    // With the Sun off the right shoulder, north moves 90 degrees clockwise.
    expect(compassNorth(atTransit.sunAzimuth, 90)).toBeCloseTo(270, 1);
  });
});

describe("dayLength", () => {
  it("splits seconds into whole hours and minutes, rounding up", () => {
    expect(dayLength(86_400)).toEqual({ hours: 24, minutes: 0 });
    expect(dayLength(0)).toEqual({ hours: 0, minutes: 0 });
    expect(dayLength(31_920)).toEqual({ hours: 8, minutes: 52 });
    expect(dayLength(45_060)).toEqual({ hours: 12, minutes: 31 });
    // A whole day minus one second is still a whole day: rounding down would
    // print 23 h 59 min for the longest day the engine can report.
    expect(dayLength(86_399)).toEqual({ hours: 24, minutes: 0 });
    expect(dayLength(-5)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe("twilightRows", () => {
  it("keeps the reader's order, and carries each limit beside its window", () => {
    const readings = sunMoonReadings(skyPlace(BELGRADE), utc("2026-01-01T00:00"));
    const rows = twilightRows(readings.twilight);
    expect(rows.map((row) => row.band)).toEqual(["civil", "nautical", "astronomical"]);
    expect(rows.map((row) => row.limit)).toEqual([-6, -12, -18]);
    expect(rows[0]?.dawn.at).toEqual(readings.twilight.civil.dawn);
    expect(rows[0]?.dusk.at).toEqual(readings.twilight.civil.dusk);
    expect(rows[2]?.dawn.at).toEqual(readings.twilight.astronomical.dawn);
    // The three limits are the map's own, so the picture and the panel cannot
    // come to draw two different sets of lines.
    for (const row of rows) {
      expect(row.dawn.state).toBe(readings.twilight[row.band].state);
    }
  });
});

describe("moonDisk", () => {
  it("is a half-lit disk at the quarters, and the terminator's own sign decides the shape", () => {
    const disk = (elongation: number, illuminatedFraction: number): ReturnType<typeof moonDisk> =>
      moonDisk({
        phase: "new",
        elongation,
        illuminatedFraction,
        phaseAngle: 180 - elongation,
        ageDays: 0,
      });
    expect(disk(180, 1)).toEqual({ litOnRight: false, terminator: 1, illuminatedFraction: 1 });
    expect(disk(0, 0)).toEqual({ litOnRight: true, terminator: -1, illuminatedFraction: 0 });
    expect(disk(90, 0.5).terminator).toBeCloseTo(0, 12);
    expect(disk(270, 0.5).terminator).toBeCloseTo(0, 12);
    expect(disk(90, 0.25).terminator).toBeCloseTo(-0.5, 12);
    // Waxing lights the right-hand limb, waning the left: the two quarters are
    // mirror images of each other and must not draw the same disk.
    expect(disk(90, 0.5).litOnRight).toBe(true);
    expect(disk(270, 0.5).litOnRight).toBe(false);
  });
});

describe("localDateKey", () => {
  it("separates two instants that are one local day apart, in the zone it is given", () => {
    const utcDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const sameDay = utc("2026-01-01T23:30");
    const nextDay = utc("2026-01-02T00:30");
    expect(localDateKey(sameDay, utcDay)).toBe("2026-01-01");
    expect(localDateKey(nextDay, utcDay)).toBe("2026-01-02");
    expect(localDateKey(sameDay, utcDay)).not.toBe(localDateKey(nextDay, utcDay));
    // And the same instant in another zone is another day, which is the whole
    // reason the key is asked of `Intl` rather than computed from milliseconds.
    const belgradeDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Belgrade",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    expect(localDateKey(sameDay, belgradeDay)).toBe("2026-01-02");
  });
});

describe("skyPlace", () => {
  it("renames the contract's two numbers into the engine's two names", () => {
    expect(skyPlace({ latDeg: 44.833, lonDeg: 20.5 })).toEqual({ latitude: 44.833, longitude: 20.5 });
  });
});

describe("phaseSequence", () => {
  it("orders the four phases by when they happen, not by how they are named", () => {
    // From the readings above: the full moon is on 3 January and the new moon a
    // fortnight later, so the list a reader sees runs full, last quarter, new,
    // first quarter.
    const readings = sunMoonReadings(skyPlace(BELGRADE), utc("2026-01-01T00:00"));
    const sequence = phaseSequence(readings.phases);
    expect(sequence.map((entry) => entry.name)).toEqual([
      "fullMoon",
      "lastQuarter",
      "newMoon",
      "firstQuarter",
    ]);
    for (let index = 1; index < sequence.length; index += 1) {
      expect(sequence[index]!.at.getTime()).toBeGreaterThan(sequence[index - 1]!.at.getTime());
    }
    for (const entry of sequence) {
      expect(entry.at.getTime()).toBe(readings.phases[entry.name].getTime());
    }
  });
});

describe("coordinateText", () => {
  const words = { degrees: "°", north: "N", south: "S", east: "E", west: "W" };
  const format = (value: number): string => value.toFixed(2);

  it("spends the sign on the hemisphere, in the words it is given", () => {
    expect(latitudeText(44.833, words, format)).toBe("44.83° N");
    expect(latitudeText(-33.867, words, format)).toBe("33.87° S");
    expect(longitudeText(20.5, words, format)).toBe("20.50° E");
    expect(longitudeText(-21.9, words, format)).toBe("21.90° W");
    expect(coordinateText(0, "N", "S", words, format)).toBe("0.00° N");
    expect(coordinateText(-0.001, "N", "S", words, format)).toBe("0.00° S");
  });

  it("takes the Serbian letters as readily as the English ones", () => {
    const serbian = { degrees: "°", north: "S", south: "J", east: "I", west: "Z" };
    expect(latitudeText(44.833, serbian, format)).toBe("44.83° S");
    expect(latitudeText(-33.867, serbian, format)).toBe("33.87° J");
    expect(longitudeText(20.5, serbian, format)).toBe("20.50° I");
    expect(longitudeText(-21.9, serbian, format)).toBe("21.90° Z");
  });
});

describe("parseCoordinate", () => {
  const separators = [",", "."];

  it("reads either decimal mark, because the two locales write different ones", () => {
    expect(parseCoordinate("44,82", 90, separators)).toBeCloseTo(44.82, 12);
    expect(parseCoordinate("44.82", 90, separators)).toBeCloseTo(44.82, 12);
    expect(parseCoordinate("  -33.867  ", 90, separators)).toBeCloseTo(-33.867, 12);
    expect(parseCoordinate("+20.5", 180, separators)).toBeCloseTo(20.5, 12);
    expect(parseCoordinate("-21,9", 180, separators)).toBeCloseTo(-21.9, 12);
    expect(parseCoordinate("0", 90, separators)).toBe(0);
  });

  it("refuses what is not a coordinate, rather than guessing at it", () => {
    expect(parseCoordinate("", 90, separators)).toBeNull();
    expect(parseCoordinate("   ", 90, separators)).toBeNull();
    expect(parseCoordinate("Beograd", 90, separators)).toBeNull();
    expect(parseCoordinate("44.82.1", 90, separators)).toBeNull();
    // A grouped number has four digits before the mark, and no coordinate does:
    // `1.234,5` is a typo or a copy-paste, not a latitude to round.
    expect(parseCoordinate("1.234,5", 90, separators)).toBeNull();
    expect(parseCoordinate("90.0001", 90, separators)).toBeNull();
    expect(parseCoordinate("Infinity", 90, separators)).toBeNull();
    // And the limit is the field's own, which is what stops a swapped pair.
    expect(parseCoordinate("91", 90, separators)).toBeNull();
    expect(parseCoordinate("91", 180, separators)).toBe(91);
    expect(parseCoordinate("-180", 180, separators)).toBe(-180);
    expect(parseCoordinate("-180.1", 180, separators)).toBeNull();
    expect(parseCoordinate("90", 90, separators)).toBe(90);
  });
});
