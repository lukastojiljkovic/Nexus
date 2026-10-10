import { describe, expect, it } from "vitest";
import { moonDay, sunDay, sunTwilight } from "./horizon.js";
import { USNO_ONE_DAY_2026 } from "./fixtures/usnoOneDay.js";
import { USNO_TWILIGHT_2026 } from "./fixtures/usnoTwilight.js";
import {
  USNO_PHENOMENON,
  largest,
  oneDayBody,
  phenomenon,
  placeFor,
  secondsApart,
  utcInstant,
  utcInstantCompact,
} from "./fixtures/usnoParse.js";

/**
 * The brief's tolerances, in seconds. USNO prints every event to the minute, so
 * thirty seconds of each bar is USNO's own rounding and not the engine's error.
 */
const SUN_SECONDS = 60;
const TWILIGHT_SECONDS = 120;
const MOON_SECONDS = 180;

describe("the twilight fixture is the one-day fixture's own civil twilight", () => {
  it("agrees with the API for all thirty rows that publish civil twilight", () => {
    const disagreements: string[] = [];
    for (const row of USNO_TWILIGHT_2026) {
      const api = oneDayBody(USNO_ONE_DAY_2026.find((e) => e.place === row.place && e.date === row.date)!);
      const begin = utcInstant(row.date, phenomenon(api, "sundata", USNO_PHENOMENON.beginCivilTwilight)?.time ?? null);
      const end = utcInstant(row.date, phenomenon(api, "sundata", USNO_PHENOMENON.endCivilTwilight)?.time ?? null);
      const table = [utcInstantCompact(row.date, row.civil[0]), utcInstantCompact(row.date, row.civil[1])];
      for (const [index, published] of [begin, end].entries()) {
        const apart = secondsApart(table[index]!, published);
        if (apart === null) {
          if (published !== null || table[index] !== null) disagreements.push(`${row.place} ${row.date}`);
        } else if (apart > 60) {
          disagreements.push(`${row.place} ${row.date} is ${apart} s apart`);
        }
      }
    }
    // One row differs, by the minute USNO's two services disagree by: Sydney on
    // 21 June, 07:21 in the year table against 07:22 in the one-day answer.
    expect(disagreements).toEqual([]);
  });
});

describe("sunDay against USNO", () => {
  it("puts sunrise, sunset and transit within a minute at every place and date", () => {
    const errors = { rise: [], set: [], transit: [] } as Record<string, (number | null)[]>;
    for (const entry of USNO_ONE_DAY_2026) {
      const body = oneDayBody(entry);
      const day = sunDay(placeFor(entry.place), Date.parse(`${entry.date}T00:00:00Z`));
      const expected = {
        rise: utcInstant(entry.date, phenomenon(body, "sundata", USNO_PHENOMENON.rise)?.time ?? null),
        set: utcInstant(entry.date, phenomenon(body, "sundata", USNO_PHENOMENON.set)?.time ?? null),
        transit: utcInstant(entry.date, phenomenon(body, "sundata", USNO_PHENOMENON.upperTransit)?.time ?? null),
      };
      for (const key of ["rise", "set", "transit"] as const) {
        const apart = secondsApart(day[key], expected[key]);
        errors[key]!.push(apart);
        if (apart !== null) {
          expect(apart, `${entry.place} ${entry.date} ${key}`).toBeLessThanOrEqual(SUN_SECONDS);
        }
      }
    }
    // Measured 2026-10-09: the largest is 33 s, at sunrise. USNO prints every
    // time to the nearest minute, so half a minute is the floor of this
    // comparison and the engine is sitting on it.
    for (const key of ["rise", "set", "transit"]) {
      expect(largest(errors[key]!), `${key} worst`).toBeLessThanOrEqual(SUN_SECONDS);
    }
  });

  it("calls polar day and polar night what USNO calls them", () => {
    for (const entry of USNO_ONE_DAY_2026) {
      const body = oneDayBody(entry);
      const day = sunDay(placeFor(entry.place), Date.parse(`${entry.date}T00:00:00Z`));
      const above = phenomenon(body, "sundata", USNO_PHENOMENON.alwaysAboveHorizon);
      const below = phenomenon(body, "sundata", USNO_PHENOMENON.alwaysBelowHorizon);
      const label = `${entry.place} ${entry.date}`;
      if (above !== null) {
        expect(day.state, label).toBe("always-above");
        expect(day.rise, label).toBeNull();
        expect(day.set, label).toBeNull();
        expect(day.dayLengthSeconds, label).toBe(86_400);
      } else if (below !== null) {
        expect(day.state, label).toBe("always-below");
        expect(day.rise, label).toBeNull();
        expect(day.set, label).toBeNull();
        expect(day.dayLengthSeconds, label).toBe(0);
      } else {
        expect(day.state, label).toBe("crosses");
        expect(day.rise, label).not.toBeNull();
        expect(day.set, label).not.toBeNull();
      }
    }
  });

  it("measures its own day length the same way as two published times do", () => {
    for (const entry of USNO_ONE_DAY_2026) {
      const body = oneDayBody(entry);
      const rise = utcInstant(entry.date, phenomenon(body, "sundata", USNO_PHENOMENON.rise)?.time ?? null);
      const set = utcInstant(entry.date, phenomenon(body, "sundata", USNO_PHENOMENON.set)?.time ?? null);
      const day = sunDay(placeFor(entry.place), Date.parse(`${entry.date}T00:00:00Z`));
      if (rise === null || set === null) continue;
      // When the rise comes first, the Sun is down at both ends of the UT day and
      // the daylight is exactly the gap between the two crossings — a statement
      // about the engine's own numbers, so it holds to the millisecond.
      if (rise.getTime() > set.getTime()) continue;
      expect(day.rise, `${entry.place} ${entry.date}`).not.toBeNull();
      expect(day.set, `${entry.place} ${entry.date}`).not.toBeNull();
      expect(
        day.dayLengthSeconds,
        `${entry.place} ${entry.date} against its own rise and set`,
      ).toBeCloseTo((day.set!.getTime() - day.rise!.getTime()) / 1000, 1);
      // Against USNO the same gap is built from two times each rounded to the
      // minute, so a whole minute of the difference is their rounding. Measured
      // 2026-10-09: the worst of the twenty-six is Quito's 1 January at 56 s.
      const published = Math.abs(set.getTime() - rise.getTime()) / 1000;
      expect(
        Math.abs(day.dayLengthSeconds - published),
        `${entry.place} ${entry.date} against USNO`,
      ).toBeLessThanOrEqual(120);
    }
  });
});

describe("sunTwilight against USNO", () => {
  it("puts civil, nautical and astronomical dawn and dusk within two minutes", () => {
    const errors: (number | null)[] = [];
    for (const row of USNO_TWILIGHT_2026) {
      const twilight = sunTwilight(placeFor(row.place), Date.parse(`${row.date}T00:00:00Z`));
      const label = `${row.place} ${row.date}`;
      const limits = { civil: row.civil, nautical: row.nautical, astronomical: row.astronomical } as const;
      for (const limit of ["civil", "nautical", "astronomical"] as const) {
        const published = limits[limit];
        const dawn = utcInstantCompact(row.date, published[0]);
        const dusk = utcInstantCompact(row.date, published[1]);
        if (dawn === null && dusk === null) {
          // USNO prints //// when the Sun never reaches that limit from above:
          // the engine must not invent a time.
          expect(twilight[limit].state, `${label} ${limit}`).not.toBe("crosses");
          expect(twilight[limit].dawn, `${label} ${limit}`).toBeNull();
          expect(twilight[limit].dusk, `${label} ${limit}`).toBeNull();
          continue;
        }
        expect(twilight[limit].state, `${label} ${limit}`).toBe("crosses");
        for (const [actual, expected] of [
          [twilight[limit].dawn, dawn],
          [twilight[limit].dusk, dusk],
        ] as const) {
          const apart = secondsApart(actual, expected);
          errors.push(apart);
          expect(apart, `${label} ${limit}`).not.toBeNull();
          expect(apart, `${label} ${limit}`).toBeLessThanOrEqual(TWILIGHT_SECONDS);
        }
      }
    }
    // Measured 2026-10-09: the largest is 33.3 s, at dusk — again USNO's own
    // minute of rounding.
    expect(largest(errors)!).toBeLessThanOrEqual(TWILIGHT_SECONDS);
  });

  it("reads the Twilight Limit USNO names out of the one-day answer", () => {
    for (const entry of USNO_ONE_DAY_2026) {
      const body = oneDayBody(entry);
      if (phenomenon(body, "sundata", USNO_PHENOMENON.alwaysAboveTwilight) === null) continue;
      const twilight = sunTwilight(placeFor(entry.place), Date.parse(`${entry.date}T00:00:00Z`));
      expect(twilight.civil.state, `${entry.place} ${entry.date}`).toBe("always-above");
    }
  });
});

describe("moonDay against USNO", () => {
  it("puts moonrise, moonset and the upper transit within three minutes", () => {
    const errors: (number | null)[] = [];
    for (const entry of USNO_ONE_DAY_2026) {
      const body = oneDayBody(entry);
      const day = moonDay(placeFor(entry.place), Date.parse(`${entry.date}T00:00:00Z`));
      const label = `${entry.place} ${entry.date}`;
      const published = {
        rise: utcInstant(entry.date, phenomenon(body, "moondata", USNO_PHENOMENON.rise)?.time ?? null),
        set: utcInstant(entry.date, phenomenon(body, "moondata", USNO_PHENOMENON.set)?.time ?? null),
        transit: utcInstant(entry.date, phenomenon(body, "moondata", USNO_PHENOMENON.upperTransit)?.time ?? null),
      };
      for (const key of ["rise", "set", "transit"] as const) {
        const apart = secondsApart(day[key], published[key]);
        errors.push(apart);
        if (apart !== null) expect(apart, `${label} ${key}`).toBeLessThanOrEqual(MOON_SECONDS);
      }
    }
    // Measured 2026-10-09: the largest is 30 s, at the Moon's upper transit.
    expect(largest(errors)!).toBeLessThanOrEqual(MOON_SECONDS);
  });

  it("agrees with USNO about a Moon that does not rise, or does not set, or never sets", () => {
    for (const entry of USNO_ONE_DAY_2026) {
      const body = oneDayBody(entry);
      const day = moonDay(placeFor(entry.place), Date.parse(`${entry.date}T00:00:00Z`));
      const label = `${entry.place} ${entry.date}`;
      const above = phenomenon(body, "moondata", USNO_PHENOMENON.alwaysAboveHorizon);
      const below = phenomenon(body, "moondata", USNO_PHENOMENON.alwaysBelowHorizon);
      if (above !== null) expect(day.state, label).toBe("always-above");
      else if (below !== null) expect(day.state, label).toBe("always-below");
      else expect(day.state, label).toBe("crosses");
      // A published event the engine reports as missing, or the other way round,
      // is a failure whichever way the state reads.
      for (const key of ["rise", "set"] as const) {
        const published = phenomenon(body, "moondata", USNO_PHENOMENON[key === "rise" ? "rise" : "set"]);
        if (published === null || published.time === null) {
          expect(day[key], `${label} ${key} published as absent`).toBeNull();
        } else {
          expect(day[key], `${label} ${key} published`).not.toBeNull();
        }
      }
    }
  });
});
