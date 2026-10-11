import { describe, expect, it } from "vitest";
import { TWILIGHT_LIMITS, dayNightWeights, solarAltitudeDegrees, twilightBand } from "./blend.js";

/**
 * Every number below is a hand calculation, and the ones that matter are the
 * anchors of the ramp: the horizon, each twilight limit, and the subsolar point.
 */

describe("solarAltitudeDegrees", () => {
  it("is 90 degrees at the subsolar point and -90 at its antipode", () => {
    expect(solarAltitudeDegrees({ latDeg: 12, lonDeg: -40 }, { latDeg: 12, lonDeg: -40 })).toBeCloseTo(90, 9);
    expect(solarAltitudeDegrees({ latDeg: -12, lonDeg: 140 }, { latDeg: 12, lonDeg: -40 })).toBeCloseTo(-90, 9);
  });

  it("is 0 on the terminator, 90 degrees of arc away from the subsolar point", () => {
    // Equinox noon: the subsolar point on the equator at Greenwich, so a place
    // 90 degrees east has the Sun exactly on its horizon, and so does the pole.
    const subsolar = { latDeg: 0, lonDeg: 0 };
    expect(solarAltitudeDegrees({ latDeg: 0, lonDeg: 90 }, subsolar)).toBeCloseTo(0, 9);
    expect(solarAltitudeDegrees({ latDeg: 0, lonDeg: -90 }, subsolar)).toBeCloseTo(0, 9);
    expect(solarAltitudeDegrees({ latDeg: 90, lonDeg: 0 }, subsolar)).toBeCloseTo(0, 9);
  });

  it("follows the meridian: the altitude is 90 minus the arc to the subsolar point", () => {
    const subsolar = { latDeg: 20, lonDeg: 30 };
    // 60 degrees due north along the same meridian.
    expect(solarAltitudeDegrees({ latDeg: -40, lonDeg: 30 }, subsolar)).toBeCloseTo(30, 9);
    expect(solarAltitudeDegrees({ latDeg: 10, lonDeg: 30 }, subsolar)).toBeCloseTo(80, 9);
    // One degree of LONGITUDE at 20 north is cos(20) = 0.9397 degrees of arc, so
    // the altitude there is 89.0603 and not 89: the two only coincide on the
    // equator, and this is the case a flat subtraction would get wrong.
    expect(solarAltitudeDegrees({ latDeg: 20, lonDeg: 31 }, subsolar)).toBeCloseTo(89.0603, 3);
  });
});

describe("twilightBand", () => {
  it("names the five bands, with each limit belonging to the band that ends there", () => {
    expect(twilightBand(45)).toBe("day");
    expect(twilightBand(0)).toBe("day");
    expect(twilightBand(-0.001)).toBe("civil");
    expect(twilightBand(-6)).toBe("civil");
    expect(twilightBand(-6.001)).toBe("nautical");
    expect(twilightBand(-12)).toBe("nautical");
    expect(twilightBand(-12.001)).toBe("astronomical");
    expect(twilightBand(-18)).toBe("astronomical");
    expect(twilightBand(-18.001)).toBe("night");
    expect(twilightBand(-90)).toBe("night");
  });

  it("states the three limits the panel's own twilight times are solved against", () => {
    expect(TWILIGHT_LIMITS).toEqual({ civil: -6, nautical: -12, astronomical: -18 });
  });
});

describe("dayNightWeights", () => {
  it("is fully day at the horizon and fully night at the end of astronomical twilight", () => {
    expect(dayNightWeights(45)).toEqual({ day: 1, night: 0 });
    expect(dayNightWeights(0)).toEqual({ day: 1, night: 0 });
    expect(dayNightWeights(-18)).toEqual({ day: 0, night: 1 });
    expect(dayNightWeights(-40)).toEqual({ day: 0, night: 1 });
  });

  it("crosses a third of the way in each band, at each limit", () => {
    expect(dayNightWeights(-6).night).toBeCloseTo(1 / 3, 12);
    expect(dayNightWeights(-12).night).toBeCloseTo(2 / 3, 12);
    expect(dayNightWeights(-3).night).toBeCloseTo(1 / 6, 12);
    expect(dayNightWeights(-9).night).toBeCloseTo(1 / 2, 12);
    expect(dayNightWeights(-15).night).toBeCloseTo(5 / 6, 12);
  });

  it("never goes backwards as the Sun sets, and always sums to one", () => {
    // The ramp is read from the bottom up: at -90 the night image is everything,
    // and each step towards the zenith takes some of it away, so the weight is
    // non-increasing in the altitude and never below zero or above one.
    // The ramp's own ceiling: at -90 degrees the night image is everything, and
    // there is nowhere above it for the weight to have come from.
    let previous = 1;
    for (let altitude = -90; altitude <= 90; altitude += 0.5) {
      const weights = dayNightWeights(altitude);
      expect(weights.night, `night at ${altitude}`).toBeLessThanOrEqual(previous);
      expect(weights.day + weights.night, `sum at ${altitude}`).toBeCloseTo(1, 12);
      expect(weights.night, `range at ${altitude}`).toBeGreaterThanOrEqual(0);
      expect(weights.night, `range at ${altitude}`).toBeLessThanOrEqual(1);
      previous = weights.night;
    }
  });
});
