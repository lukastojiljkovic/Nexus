import { describe, expect, it } from "vitest";

import {
  DRINKING_GALLONS_PER_PERSON_DAY,
  LITRES_PER_US_GALLON,
  MAX_DAYS,
  MAX_PEOPLE,
  MIN_DAYS,
  MIN_PEOPLE,
  WATER_GALLONS_PER_PERSON_DAY,
  isRationCount,
  rationPlan,
} from "./ration.js";

describe("rationPlan", () => {
  it("multiplies people by days, and by the per-person guideline in litres", () => {
    const plan = rationPlan(4, 3);
    expect(plan).not.toBeNull();
    // Twelve person-days: one gallon each is twelve gallons, which is 45.4 litres.
    expect(plan?.foodPersonDays).toBe(12);
    expect(plan?.waterLitres).toBeCloseTo(12 * WATER_GALLONS_PER_PERSON_DAY * LITRES_PER_US_GALLON, 9);
    expect(plan?.waterLitres).toBeCloseTo(45.4249414, 6);
    expect(plan?.drinkingLitres).toBeCloseTo(12 * 0.75 * LITRES_PER_US_GALLON, 9);
  });

  it("keeps the drinking floor below the guideline total for every household", () => {
    for (let people = MIN_PEOPLE; people <= MAX_PEOPLE; people += 1) {
      for (let days = MIN_DAYS; days <= MAX_DAYS; days += 1) {
        const plan = rationPlan(people, days);
        expect(plan?.drinkingLitres).toBeLessThan(plan?.waterLitres ?? 0);
        expect(plan?.drinkingLitres).toBeCloseTo(
          (plan?.waterLitres ?? 0) * DRINKING_GALLONS_PER_PERSON_DAY,
          9,
        );
      }
    }
  });

  it("answers the bounds themselves and refuses one step beyond them", () => {
    expect(rationPlan(MIN_PEOPLE, MIN_DAYS)?.foodPersonDays).toBe(1);
    expect(rationPlan(MAX_PEOPLE, MAX_DAYS)?.foodPersonDays).toBe(MAX_PEOPLE * MAX_DAYS);
    expect(rationPlan(MIN_PEOPLE - 1, 3)).toBeNull();
    expect(rationPlan(MAX_PEOPLE + 1, 3)).toBeNull();
    expect(rationPlan(3, MIN_DAYS - 1)).toBeNull();
    expect(rationPlan(3, MAX_DAYS + 1)).toBeNull();
  });

  it("refuses a count that is not a whole number", () => {
    expect(rationPlan(2.5, 3)).toBeNull();
    expect(rationPlan(2, Number.NaN)).toBeNull();
    expect(rationPlan(Number.POSITIVE_INFINITY, 3)).toBeNull();
  });
});

describe("isRationCount", () => {
  it("accepts whole numbers inside the range, both ends included", () => {
    expect(isRationCount(1, 1, 5)).toBe(true);
    expect(isRationCount(5, 1, 5)).toBe(true);
    expect(isRationCount(0, 1, 5)).toBe(false);
    expect(isRationCount(6, 1, 5)).toBe(false);
    expect(isRationCount(3.5, 1, 5)).toBe(false);
  });
});
