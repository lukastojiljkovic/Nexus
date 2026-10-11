import { describe, expect, it } from "vitest";
import {
  COUNT_UNITS,
  INGREDIENT_UNITS,
  MASS_UNITS,
  VOLUME_UNITS,
  compatibleUnits,
  convertQuantity,
  isIngredientUnit,
  unitFamily,
} from "./units.js";

describe("the unit vocabulary", () => {
  it("is the three families and nothing else, with no name in two of them", () => {
    expect([...INGREDIENT_UNITS]).toEqual([
      ...MASS_UNITS,
      ...VOLUME_UNITS,
      ...COUNT_UNITS,
    ]);
    expect(new Set(INGREDIENT_UNITS).size).toBe(INGREDIENT_UNITS.length);
    expect([...MASS_UNITS]).toEqual(["g", "kg"]);
    expect([...VOLUME_UNITS]).toEqual(["ml", "l", "tsp", "tbsp", "cup", "fl_oz"]);
  });

  it("answers the family of every unit it ships, and of no other spelling", () => {
    expect(unitFamily("g")).toBe("mass");
    expect(unitFamily("kg")).toBe("mass");
    expect(unitFamily("ml")).toBe("volume");
    expect(unitFamily("fl_oz")).toBe("volume");
    expect(unitFamily("clove")).toBe("count");
    expect(unitFamily("packet")).toBe("count");

    expect(isIngredientUnit("tbsp")).toBe(true);
    expect(isIngredientUnit("tablespoon")).toBe(false);
    expect(isIngredientUnit("ounce")).toBe(false);
    expect(isIngredientUnit("")).toBe(false);
  });
});

describe("convertQuantity", () => {
  /**
   * Every expected value below is either an exact definition or a division of
   * one, and each is written out rather than approximated:
   *
   * - 1 in = 25.4 mm exactly (the 1959 international yard and pound agreement),
   *   1 US gallon = 231 in³ exactly (NIST Handbook 44, Appendix C), so
   *   1 gal = 231 × 25.4³ mm³ = 3.785411784 L exactly and 1 US fl oz =
   *   3.785411784 / 128 L = 29.5735295625 mL exactly.
   * - 1 tsp = 1/6 fl oz, 1 tbsp = 1/2 fl oz, 1 cup = 8 fl oz — all exact.
   */
  it("converts within mass, exactly", () => {
    expect(convertQuantity(1, "kg", "g")).toBe(1000);
    expect(convertQuantity(2.5, "kg", "g")).toBe(2500);
    expect(convertQuantity(250, "g", "kg")).toBe(0.25);
    // 1/3 kg is not representable, so this is the nearest double to it.
    expect(convertQuantity(1000 / 3, "g", "kg")).toBe(1 / 3);
  });

  it("converts within volume with the NIST definitions", () => {
    expect(convertQuantity(1, "l", "ml")).toBe(1000);
    expect(convertQuantity(1, "fl_oz", "ml")).toBe(29.5735295625);
    expect(convertQuantity(1, "tsp", "ml")).toBe(4.92892159375);
    expect(convertQuantity(1, "tbsp", "ml")).toBe(14.78676478125);
    expect(convertQuantity(1, "cup", "ml")).toBe(236.5882365);
    expect(convertQuantity(3, "tsp", "tbsp")).toBe(1);
    expect(convertQuantity(1, "tbsp", "tsp")).toBe(3);
    expect(convertQuantity(1, "cup", "tbsp")).toBe(16);
    expect(convertQuantity(1, "cup", "tsp")).toBe(48);
    expect(convertQuantity(1, "cup", "fl_oz")).toBe(8);
    // The reverse of an exact division is the correctly rounded quotient: a
    // teaspoon is 1/48 of a cup, which no double represents, so the assertion is
    // the nearest one rather than a truncation.
    expect(convertQuantity(1, "tsp", "cup")).toBe(1 / 48);
    expect(convertQuantity(2, "cup", "ml")).toBe(473.176473);
  });

  it("refuses to cross families, and refuses a count in anything but itself", () => {
    // A gram is not a millilitre: no density is defined here, and the module
    // adds none (see the file doc).
    expect(convertQuantity(100, "g", "ml")).toBeNull();
    expect(convertQuantity(100, "ml", "g")).toBeNull();
    expect(convertQuantity(1, "clove", "tsp")).toBeNull();
    expect(convertQuantity(2, "clove", "piece")).toBeNull();
    expect(convertQuantity(2, "cup", null)).toBeNull();
  });

  it("treats the same unit as the identity, including a missing one", () => {
    expect(convertQuantity(0.5, "cup", "cup")).toBe(0.5);
    expect(convertQuantity(3, null, null)).toBe(3);
  });

  it("refuses a quantity that is not a finite number, rather than coercing it", () => {
    expect(() => convertQuantity(Number.NaN, "g", "kg")).toThrow(RangeError);
    expect(() => convertQuantity(Infinity, "cup", "ml")).toThrow(RangeError);
  });
});

describe("compatibleUnits", () => {
  it("merges within a family and separates anything else", () => {
    expect(compatibleUnits("g", "kg")).toBe(true);
    expect(compatibleUnits("ml", "cup")).toBe(true);
    expect(compatibleUnits("tbsp", "tsp")).toBe(true);
    expect(compatibleUnits("g", "ml")).toBe(false);
    expect(compatibleUnits("clove", "clove")).toBe(true);
    // A clove and a pinch are both counts and are not the same thing.
    expect(compatibleUnits("clove", "pinch")).toBe(false);
    expect(compatibleUnits("clove", "g")).toBe(false);
    // A missing unit is a count of pieces, and it merges only with itself.
    expect(compatibleUnits(null, null)).toBe(true);
    expect(compatibleUnits(null, "piece")).toBe(false);
    expect(compatibleUnits(null, "g")).toBe(false);
  });
});
