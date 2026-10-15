import { describe, expect, it } from "vitest";

import { ELEMENTS } from "./periodicTable.js";

describe("the periodic table data", () => {
  it("holds 118 elements, numbered 1 to 118 in order, with unique symbols", () => {
    expect(ELEMENTS).toHaveLength(118);
    ELEMENTS.forEach((element, index) => {
      expect(element.number).toBe(index + 1);
    });
    expect(new Set(ELEMENTS.map((element) => element.symbol)).size).toBe(118);
    expect(ELEMENTS.every((element) => /^[A-Z][a-z]?$/.test(element.symbol))).toBe(true);
  });

  it("places the periods by the 2, 8, 8, 18, 18, 32, 32 rule", () => {
    const sizes = [1, 2, 3, 4, 5, 6, 7].map(
      (period) => ELEMENTS.filter((element) => element.period === period).length,
    );
    expect(sizes).toEqual([2, 8, 8, 18, 18, 32, 32]);
  });

  it("gives every element outside the f-block a group from 1 to 18, and the f-block none", () => {
    for (const element of ELEMENTS) {
      const fBlock = element.category === "lanthanide" || element.category === "actinide";
      if (fBlock) {
        expect(element.group, element.symbol).toBeNull();
      } else {
        expect(element.group, element.symbol).toBeGreaterThanOrEqual(1);
        expect(element.group, element.symbol).toBeLessThanOrEqual(18);
      }
    }
    expect(ELEMENTS.filter((element) => element.group === null)).toHaveLength(30);
  });

  it("puts the known landmarks in their known places", () => {
    const at = (symbol: string) => ELEMENTS.find((element) => element.symbol === symbol);
    expect(at("H")).toMatchObject({ group: 1, period: 1, category: "nonmetal" });
    expect(at("He")).toMatchObject({ group: 18, period: 1, category: "noble-gas" });
    expect(at("Fe")).toMatchObject({ group: 8, period: 4, category: "transition-metal" });
    expect(at("Pt")).toMatchObject({ group: 10, period: 6 });
    expect(at("La")).toMatchObject({ group: null, period: 6, category: "lanthanide" });
    expect(at("Og")).toMatchObject({ group: 18, period: 7, category: "noble-gas" });
  });
});
