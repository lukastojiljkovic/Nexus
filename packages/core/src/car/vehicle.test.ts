import { describe, expect, it } from "vitest";

import {
  CAR_COST_CATEGORIES,
  FUEL_TYPES,
  KM_PER_MILE,
  SERVICE_CATEGORIES,
  DISTANCE_UNITS,
  FAULT_STATUSES,
  fuelQuantityUnit,
  fromKilometres,
  normalizeVin,
  toKilometres,
} from "./vehicle.js";

describe("the CAR module's closed vocabularies", () => {
  // Pinned as the brief writes them, so a member added or renamed has to be a
  // decision rather than a drift. The migration spells the same lists out in
  // SQL and the store refuses anything outside them.
  it("names exactly the seven fuel types, two distance units and ten categories", () => {
    expect(FUEL_TYPES).toEqual([
      "petrol",
      "diesel",
      "lpg",
      "cng",
      "hybrid",
      "electric",
      "other",
    ]);
    expect(DISTANCE_UNITS).toEqual(["km", "mi"]);
    expect(FAULT_STATUSES).toEqual(["open", "fixed"]);
    expect(SERVICE_CATEGORIES).toEqual([
      "oil",
      "filters",
      "tyres",
      "brakes",
      "battery",
      "timing-belt",
      "inspection",
      "registration",
      "repair",
      "other",
    ]);
  });

  /** A cost is not only a service: fuel is a cost category too, and it is not a `ServiceCategory`. */
  it("counts fuel among the cost categories and keeps every service category in", () => {
    expect(CAR_COST_CATEGORIES).toEqual([...SERVICE_CATEGORIES, "fuel"]);
  });
});

describe("fuelQuantityUnit", () => {
  it("measures an electric vehicle's fuel in kWh and everything else in litres", () => {
    expect(fuelQuantityUnit("electric")).toBe("kWh");
    for (const fuelType of FUEL_TYPES.filter((each) => each !== "electric")) {
      expect(fuelQuantityUnit(fuelType)).toBe("l");
    }
  });
});

describe("normalizeVin", () => {
  it("takes a 17-character VIN and returns it upper-cased and trimmed", () => {
    expect(normalizeVin("  wvwzzz1jzxw000001 ")).toBe("WVWZZZ1JZXW000001");
  });

  it("refuses I, O and Q, which no VIN alphabet contains", () => {
    expect(normalizeVin("1HGCM82633A00435I")).toBeNull();
    expect(normalizeVin("1HGCM82633A00435O")).toBeNull();
    expect(normalizeVin("1HGCM82633A00435Q")).toBeNull();
  });

  it("refuses anything that is not exactly 17 characters, or not alphanumeric", () => {
    expect(normalizeVin("1HGCM82633A00435")).toBeNull();
    expect(normalizeVin("1HGCM82633A0043529")).toBeNull();
    expect(normalizeVin("1HGCM82633A0043-2")).toBeNull();
    expect(normalizeVin("")).toBeNull();
    expect(normalizeVin("čHGCM82633A004352")).toBeNull();
  });

  /**
   * The North-American check digit is deliberately NOT enforced. The brief says
   * so, and these two are why: `1HGCM82633A004352` is a US VIN whose ninth
   * character is a real check digit, `WVWZZZ1JZXW000001` is a European one
   * where nothing at that position means anything — a rule that recomputed the
   * digit would refuse the second as corrupt.
   */
  it("does not insist on the North-American check digit", () => {
    expect(normalizeVin("1HGCM82633A004352")).toBe("1HGCM82633A004352");
    expect(normalizeVin("WVWZZZ1JZXW000001")).toBe("WVWZZZ1JZXW000001");
  });
});

describe("distance conversion", () => {
  // The mile is defined as exactly 1609.344 m, so this factor is exact rather
  // than a rounded conversion table.
  it("converts miles to kilometres with the defined factor", () => {
    expect(KM_PER_MILE).toBe(1.609344);
    expect(toKilometres(100, "mi")).toBeCloseTo(160.9344, 10);
    expect(toKilometres(100, "km")).toBe(100);
    expect(fromKilometres(160.9344, "mi")).toBeCloseTo(100, 10);
    expect(fromKilometres(200, "km")).toBe(200);
  });

  it("round-trips a distance through the other unit", () => {
    for (const value of [0, 1, 12345.6]) {
      expect(toKilometres(fromKilometres(value, "mi"), "mi")).toBeCloseTo(value, 9);
    }
  });
});
