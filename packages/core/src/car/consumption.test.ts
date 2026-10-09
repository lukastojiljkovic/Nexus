import { describe, expect, it } from "vitest";

import { fuelConsumption, type FuelFill } from "./consumption.js";

/** One fill, spelled short — `odometer` omitted means the entry carries none. */
function fill(
  date: string,
  quantity: number,
  odometer: number | null,
  fullTank: boolean,
): FuelFill {
  return { date, quantity, odometer, fullTank };
}

/**
 * The full-tank method, spelled out because every expected value below is read
 * off it: consumption is measured between two fills that BOTH left the tank
 * full, over the distance between their odometers, with every fill in between
 * summed in. The first fill's own fuel is excluded — it is what filled the tank
 * before the measured distance began — and the closing one's is included, which
 * is what makes the two ends symmetric.
 *
 *     per 100 km = (quantity at B + every fill between A and B) / (odo_B − odo_A) × 100
 */
describe("fuelConsumption", () => {
  it("measures two full tanks", () => {
    // 40 L over 500 km: 40 / 500 × 100 = 8.00 L/100 km.
    const result = fuelConsumption(
      [fill("2026-01-01", 45, 10_000, true), fill("2026-01-20", 40, 10_500, true)],
      "km",
    );
    expect(result.segments).toEqual([
      {
        fromDate: "2026-01-01",
        toDate: "2026-01-20",
        distance: 500,
        quantity: 40,
        partialFills: 0,
        per100Km: 8,
        mpg: null,
      },
    ]);
    expect(result.overall).toEqual({ distance: 500, quantity: 40, per100Km: 8, mpg: null });
  });

  it("sums the partial fills in between", () => {
    // 500 km on 20 + 15 + 25 = 60 L: 60 / 500 × 100 = 12.00 L/100 km. The two
    // partial fills carry no odometer of their own, which does not matter —
    // only their litres do.
    const result = fuelConsumption(
      [
        fill("2026-01-01", 45, 10_000, true),
        fill("2026-01-08", 20, 10_200, false),
        fill("2026-01-15", 15, 10_350, false),
        fill("2026-01-20", 25, 10_500, true),
      ],
      "km",
    );
    expect(result.segments).toEqual([
      {
        fromDate: "2026-01-01",
        toDate: "2026-01-20",
        distance: 500,
        quantity: 60,
        partialFills: 2,
        per100Km: 12,
        mpg: null,
      },
    ]);
    expect(result.overall?.per100Km).toBe(12);
  });

  it("measures nothing when only one full fill was ever recorded", () => {
    // One full tank and a partial after it: there is no closing full tank, so
    // there is no measured distance — an empty answer rather than a number
    // computed over a stretch of unknown length.
    const result = fuelConsumption(
      [fill("2026-01-01", 45, 10_000, true), fill("2026-01-08", 20, 10_200, false)],
      "km",
    );
    expect(result.segments).toEqual([]);
    expect(result.overall).toBeNull();
  });

  it("measures nothing when no fill says the tank was full", () => {
    const result = fuelConsumption(
      [fill("2026-01-01", 45, 10_000, false), fill("2026-01-20", 40, 10_500, false)],
      "km",
    );
    expect(result.segments).toEqual([]);
    expect(result.overall).toBeNull();
  });

  it("skips a pair whose ends are not both full tanks, and measures the next one", () => {
    // 1 000 km on 80 L is 8.00 L/100 km — the 40 L of the unmarked fill is
    // inside the interval, so the method sums it whether or not the user
    // remembered to tick "full tank" on it.
    const result = fuelConsumption(
      [
        fill("2026-01-01", 45, 10_000, true),
        fill("2026-01-10", 40, 10_400, false),
        fill("2026-01-20", 40, 11_000, true),
      ],
      "km",
    );
    expect(result.segments).toEqual([
      {
        fromDate: "2026-01-01",
        toDate: "2026-01-20",
        distance: 1_000,
        quantity: 80,
        partialFills: 1,
        per100Km: 8,
        mpg: null,
      },
    ]);
  });

  it("never measures across an odometer segment break", () => {
    // The odometer was replaced on 2026-06-01, so the 100 000 → 300 gap says
    // nothing about distance. Only the pair after the break is measured:
    // 500 km on 50 L = 10.00 L/100 km.
    const result = fuelConsumption(
      [
        fill("2026-01-01", 45, 100_000, true),
        fill("2026-06-01", 30, 300, true),
        fill("2026-06-20", 50, 800, true),
      ],
      "km",
      { segmentStarts: ["2026-06-01"] },
    );
    expect(result.segments).toEqual([
      {
        fromDate: "2026-06-01",
        toDate: "2026-06-20",
        distance: 500,
        quantity: 50,
        partialFills: 0,
        per100Km: 10,
        mpg: null,
      },
    ]);
  });

  it("skips a pair whose odometer went backwards without a recorded break", () => {
    const result = fuelConsumption(
      [fill("2026-01-01", 45, 10_000, true), fill("2026-01-20", 40, 9_000, true)],
      "km",
    );
    expect(result.segments).toEqual([]);
  });

  it("starts a new stretch at the next full fill that carries an odometer", () => {
    // The middle full tank has no odometer, so neither the stretch that ends at
    // it nor the one that begins at it can be measured — the second because its
    // opening end is the missing number. Measurement resumes at the next full
    // tank that has one: 500 km on 45 L = 9.00 L/100 km, and nothing else.
    const result = fuelConsumption(
      [
        fill("2026-01-01", 45, 10_000, true),
        fill("2026-01-15", 20, null, true),
        fill("2026-02-01", 40, 10_750, true),
        fill("2026-02-20", 45, 11_250, true),
      ],
      "km",
    );
    expect(result.segments).toEqual([
      {
        fromDate: "2026-02-01",
        toDate: "2026-02-20",
        distance: 500,
        quantity: 45,
        partialFills: 0,
        per100Km: 9,
        mpg: null,
      },
    ]);
  });

  it("also answers miles per US gallon when the vehicle counts miles", () => {
    // 300 miles on 30 L. One US gallon is 3.785411784 L and one mile is
    // 1.609344 km, so mpg = (300 / 30) × 3.785411784 = 37.85411784, and the
    // metric figure is 30 / (300 × 1.609344) × 100 = 10 / 1.609344
    // = 6.21371192237334 L/100 km.
    const result = fuelConsumption(
      [fill("2026-01-01", 45, 20_000, true), fill("2026-01-20", 30, 20_300, true)],
      "mi",
    );
    const segment = result.segments[0];
    expect(segment?.distance).toBe(300);
    expect(segment?.mpg).toBeCloseTo(37.85411784, 9);
    expect(segment?.per100Km).toBeCloseTo(10 / 1.609344, 9);
    expect(result.overall?.mpg).toBeCloseTo(37.85411784, 9);
  });

  it("leaves the odometer-less and unit-less entries out of the overall figure", () => {
    const result = fuelConsumption(
      [
        // A fill before anything was ever full: it can contribute no distance.
        fill("2025-12-01", 30, 9_800, false),
        fill("2026-01-01", 45, 10_000, true),
        fill("2026-01-20", 40, 10_500, true),
        fill("2026-02-20", 42, 11_000, true),
      ],
      "km",
    );
    // Two segments of 500 km each, 40 L then 42 L: 82 / 1000 × 100 = 8.20.
    expect(result.segments).toHaveLength(2);
    expect(result.overall?.distance).toBe(1_000);
    expect(result.overall?.quantity).toBe(82);
    // Compared with a tolerance because 82 / 1000 × 100 is 8.199999999999999
    // in binary floating point, and the figure is deliberately NOT rounded:
    // rounding belongs where the number is printed, not where it is summed.
    expect(result.overall?.per100Km).toBeCloseTo(8.2, 10);
    expect(result.overall?.mpg).toBeNull();
  });
});
