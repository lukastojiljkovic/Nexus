import { describe, expect, it } from "vitest";
import { deltaTSeconds, instantFromJulianEphemerisDay, julianDay, julianEphemerisDay } from "./julian.js";

describe("julianDay", () => {
  it("puts the J2000 epoch on 2451545.0, the day every series here is measured from", () => {
    expect(julianDay(Date.UTC(2000, 0, 1, 12))).toBeCloseTo(2451545.0, 9);
  });

  it("reproduces Meeus's own worked examples (ch. 7)", () => {
    // Example 7.a: 1987 January 27.0.
    expect(julianDay(Date.parse("1987-01-27T00:00:00Z"))).toBeCloseTo(2446822.5, 9);
    // Example 7.b: 1987 June 19.5.
    expect(julianDay(Date.parse("1987-06-19T12:00:00Z"))).toBeCloseTo(2446966.0, 9);
    // The day Sputnik 1 launched, 1957 October 4.81.
    expect(julianDay(Date.parse("1957-10-04T19:26:24Z"))).toBeCloseTo(2436116.31, 6);
  });

  it("takes a Date and epoch milliseconds as the same instant", () => {
    const ms = Date.parse("2026-10-15T04:24:00Z");
    expect(julianDay(ms)).toBe(julianDay(new Date(ms)));
  });
});

describe("deltaTSeconds", () => {
  it("evaluates the published 2005-2050 polynomial by hand (ch. 10)", () => {
    // Espenak & Meeus' expression for 2005 <= y < 2050, with the decimal year
    // the same page defines as y = year + (month - 0.5)/12:
    //
    //   2026-06-21 -> y = 2026 + 5.5/12 = 2026.4583333
    //   t = y - 2000 = 26.4583333
    //   dT = 62.92 + 0.32217 t + 0.005589 t^2
    //      = 62.92 + 8.5240813 + 3.9125426
    //      = 75.3566239 s
    expect(deltaTSeconds(Date.parse("2026-06-21T00:00:00Z"))).toBeCloseTo(75.3566, 3);

    //   2026-01-01 -> y = 2026 + 0.5/12 = 2026.0416667, t = 26.0416667
    //   dT = 62.92 + 8.3898437 + 3.7902832 = 75.1001269 s
    expect(deltaTSeconds(Date.parse("2026-01-01T00:00:00Z"))).toBeCloseTo(75.1001, 3);
  });

  it("crosses 1986 into the other published branch without a jump of its own making", () => {
    // The two expressions meet at 1986 rather than being one curve: the
    // 1961-1986 one at y = 1985.958 reads 45.45 + 1.067(10.958) - 10.958^2/260
    // - 10.958^3/718 = 54.85 s, and the 1986-2005 one at y = 1986.042 reads
    // 54.89 s. Neither value is asserted — what is asserted is that the engine
    // does not add a seam of its own on the way between them.
    const before = deltaTSeconds(Date.parse("1985-12-31T00:00:00Z"));
    const after = deltaTSeconds(Date.parse("1986-01-01T00:00:00Z"));
    expect(Math.abs(after - before)).toBeLessThan(2);
  });
});

describe("julianEphemerisDay", () => {
  it("is the Julian Day plus the TT - UT difference, and inverts back to the instant", () => {
    const at = Date.parse("2026-06-21T10:40:00Z");
    const jde = julianEphemerisDay(at);
    expect(jde - julianDay(at)).toBeCloseTo(75.3566 / 86_400, 9);
    expect(instantFromJulianEphemerisDay(jde).getTime()).toBeCloseTo(at, -2);
  });
});
