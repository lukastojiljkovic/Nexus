import { describe, expect, it } from "vitest";

import type { OdometerPoint } from "./odometer.js";
import type { ServiceCategory } from "./vehicle.js";
import {
  costPerDistance,
  distanceCovered,
  fuelCostMinor,
  totalsByCategory,
  totalsByMonth,
  vehicleCosts,
  type CarCost,
} from "./costs.js";

function point(date: string, reading: number, segment = 1): OdometerPoint {
  return { date, reading, segment };
}

describe("fuelCostMinor", () => {
  it("takes the total when the user typed one", () => {
    expect(
      fuelCostMinor({ quantity: 40, pricePerUnitMinor: 18_000, totalMinor: 715_000 }),
    ).toBe(715_000);
  });

  it("derives the total from the price per unit when there is none", () => {
    // 40 L at 180,00 RSD a litre is 7 200,00 RSD — 720 000 minor units.
    expect(fuelCostMinor({ quantity: 40, pricePerUnitMinor: 18_000, totalMinor: null })).toBe(
      720_000,
    );
  });

  it("rounds a fractional total to the nearest minor unit", () => {
    // 42,35 L at 179,95 RSD is 7 620,8825 RSD — 762 088,25 minor units, which
    // rounds to 762 088.
    expect(fuelCostMinor({ quantity: 42.35, pricePerUnitMinor: 17_995, totalMinor: null })).toBe(
      762_088,
    );
  });

  it("answers null when neither the price nor the total is known", () => {
    expect(fuelCostMinor({ quantity: 40, pricePerUnitMinor: null, totalMinor: null })).toBeNull();
  });
});

describe("vehicleCosts", () => {
  it("reads a cost off every priced row and skips the free ones", () => {
    const costs = vehicleCosts(
      [
        serviceRow("2026-01-05", "oil", 450_000, "RSD"),
        serviceRow("2026-02-11", "repair", null, null),
      ],
      [
        fillRow("2026-01-20", "RSD", 40, 18_000, null),
        fillRow("2026-02-01", "RSD", 30, null, null),
      ],
    );
    expect(costs).toEqual([
      { date: "2026-01-05", category: "oil", currency: "RSD", minorUnits: 450_000 },
      { date: "2026-01-20", category: "fuel", currency: "RSD", minorUnits: 720_000 },
    ]);
  });
});

/** A service row as `CarStore` returns one, cut to what the cost reads. */
function serviceRow(
  date: string,
  category: ServiceCategory,
  costMinor: number | null,
  currency: string | null,
): { date: string; category: ServiceCategory; costMinor: number | null; currency: string | null } {
  return { date, category, costMinor, currency };
}

/** A fuel row as `CarStore` returns one, cut to what the cost reads. */
function fillRow(
  date: string,
  currency: string | null,
  quantity: number,
  pricePerUnitMinor: number | null,
  totalMinor: number | null,
): {
  date: string;
  currency: string | null;
  quantity: number;
  pricePerUnitMinor: number | null;
  totalMinor: number | null;
} {
  return { date, currency, quantity, pricePerUnitMinor, totalMinor };
}

describe("totalsByCategory", () => {
  it("adds up per category and per currency, keeping the two apart", () => {
    const totals = totalsByCategory([
      cost("2026-01-05", "oil", "RSD", 100_000),
      cost("2026-03-05", "oil", "RSD", 200_000),
      cost("2026-01-20", "fuel", "RSD", 300_000),
      cost("2026-02-02", "repair", "EUR", 5_000),
    ]);
    // Category order is the module's own vocabulary order, never alphabetical:
    // oil, then repair, then fuel.
    expect(totals).toEqual([
      { category: "oil", currency: "RSD", minorUnits: 300_000, count: 2 },
      { category: "repair", currency: "EUR", minorUnits: 5_000, count: 1 },
      { category: "fuel", currency: "RSD", minorUnits: 300_000, count: 1 },
    ]);
  });

  it("never sums two currencies into one number", () => {
    const totals = totalsByCategory([
      cost("2026-01-05", "oil", "RSD", 100_000),
      cost("2026-01-06", "oil", "EUR", 5_000),
    ]);
    expect(totals).toEqual([
      { category: "oil", currency: "EUR", minorUnits: 5_000, count: 1 },
      { category: "oil", currency: "RSD", minorUnits: 100_000, count: 1 },
    ]);
  });

  it("answers an empty list for an empty year, not a row of zeroes", () => {
    expect(totalsByCategory([])).toEqual([]);
  });
});

describe("totalsByMonth", () => {
  it("adds up per calendar month and currency, oldest month first", () => {
    const totals = totalsByMonth([
      cost("2026-02-05", "oil", "RSD", 100_000),
      cost("2026-01-05", "fuel", "RSD", 300_000),
      cost("2026-01-20", "oil", "RSD", 50_000),
      cost("2026-02-06", "oil", "EUR", 5_000),
    ]);
    expect(totals).toEqual([
      { month: "2026-01", currency: "RSD", minorUnits: 350_000, count: 2 },
      { month: "2026-02", currency: "EUR", minorUnits: 5_000, count: 1 },
      { month: "2026-02", currency: "RSD", minorUnits: 100_000, count: 1 },
    ]);
  });
});

describe("distanceCovered", () => {
  const READINGS = [
    point("2026-01-01", 10_000),
    point("2026-01-31", 10_500),
    point("2026-02-28", 11_500),
  ];

  it("is the odometer's own span inside the window", () => {
    expect(distanceCovered(READINGS, "2026-01-01", "2026-01-31")).toBe(500);
    expect(distanceCovered(READINGS, "2026-01-01", "2026-02-28")).toBe(1_500);
    expect(distanceCovered(READINGS, "2026-01-31", "2026-02-28")).toBe(1_000);
  });

  it("is null when the window holds fewer than two readings", () => {
    expect(distanceCovered(READINGS, "2026-02-01", "2026-03-01")).toBeNull();
    expect(distanceCovered([], "2026-01-01", "2026-12-31")).toBeNull();
  });

  it("is null when the window spans an odometer replacement", () => {
    const replaced = [point("2026-01-01", 100_000, 1), point("2026-06-01", 300, 2)];
    expect(distanceCovered(replaced, "2025-12-01", "2026-07-01")).toBeNull();
    expect(distanceCovered(replaced, "2026-06-01", "2026-07-01")).toBeNull();
  });
});

describe("costPerDistance", () => {
  it("divides each currency's window total by the distance driven in it", () => {
    const result = costPerDistance({
      costs: [cost("2026-01-05", "oil", "RSD", 600_000), cost("2026-01-20", "fuel", "RSD", 600_000)],
      readings: [point("2026-01-01", 10_000), point("2026-02-28", 13_000)],
      from: "2026-01-01",
      to: "2026-02-28",
    });
    // 1 200 000 minor units over 3 000 km is 400 minor units a kilometre.
    expect(result).toEqual([
      { currency: "RSD", minorUnits: 1_200_000, distance: 3_000, perDistance: 400 },
    ]);
  });

  it("leaves the figure null when the odometer cannot answer for the window", () => {
    expect(
      costPerDistance({
        costs: [cost("2026-01-05", "oil", "RSD", 600_000)],
        readings: [point("2026-01-01", 10_000)],
        from: "2026-01-01",
        to: "2026-02-28",
      }),
    ).toEqual([
      { currency: "RSD", minorUnits: 600_000, distance: null, perDistance: null },
    ]);
  });

  it("ignores money dated outside the window and answers an empty list for nothing spent", () => {
    expect(
      costPerDistance({
        costs: [cost("2025-12-31", "oil", "RSD", 600_000)],
        readings: [point("2026-01-01", 10_000), point("2026-01-31", 10_500)],
        from: "2026-01-01",
        to: "2026-01-31",
      }),
    ).toEqual([]);
  });

  it("keeps two currencies in two rows over one distance", () => {
    const result = costPerDistance({
      costs: [cost("2026-01-05", "oil", "RSD", 100_000), cost("2026-01-06", "tyres", "EUR", 5_000)],
      readings: [point("2026-01-01", 10_000), point("2026-01-31", 10_500)],
      from: "2026-01-01",
      to: "2026-01-31",
    });
    // 500 km: 100 000 / 500 = 200 minor units a kilometre in RSD, 5 000 / 500
    // = 10 in EUR.
    expect(result).toEqual([
      { currency: "EUR", minorUnits: 5_000, distance: 500, perDistance: 10 },
      { currency: "RSD", minorUnits: 100_000, distance: 500, perDistance: 200 },
    ]);
  });
});

function cost(
  date: string,
  category: CarCost["category"],
  currency: string,
  minorUnits: number,
): CarCost {
  return { date, category, currency, minorUnits };
}
