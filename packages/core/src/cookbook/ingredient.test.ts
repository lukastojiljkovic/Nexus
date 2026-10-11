import { describe, expect, it } from "vitest";
import type { IngredientLine } from "./ingredient.js";
import { roundToKitchen, scaleIngredients } from "./ingredient.js";

/** A line with everything a scalable one carries, so a scaling test can assert the untended fields came through. */
function line(fields: Partial<IngredientLine>): IngredientLine {
  return {
    quantity: null,
    quantityMax: null,
    unit: null,
    name: "sastojak",
    preparation: null,
    group: null,
    foodRef: null,
    gramsPerUnit: null,
    ...fields,
  };
}

describe("roundToKitchen", () => {
  /**
   * The rules, spelled out because the test is the only other place they exist:
   * grams and millilitres to whole numbers below 100 and to 5 at or above;
   * kilograms and litres to 0.01 below 1 and to 0.05 at or above; teaspoons,
   * tablespoons and fluid ounces to 1/4; cups to 1/8; a count (including a line
   * with no unit) to 1/2. A positive amount never comes back as zero.
   */
  it("rounds grams and millilitres to whole numbers below 100, to 5 above", () => {
    expect(roundToKitchen(4.5, "g")).toBe(5);
    expect(roundToKitchen(85.8, "ml")).toBe(86);
    expect(roundToKitchen(60, "g")).toBe(60);
    expect(roundToKitchen(62.4, "g")).toBe(62);
    expect(roundToKitchen(120, "ml")).toBe(120);
    expect(roundToKitchen(124, "ml")).toBe(125);
    expect(roundToKitchen(122, "g")).toBe(120);
  });

  it("rounds kilograms and litres to 0.01 below 1, to 0.05 above", () => {
    expect(roundToKitchen(0.65, "l")).toBe(0.65);
    expect(roundToKitchen(0.653, "kg")).toBe(0.65);
    expect(roundToKitchen(1.125, "kg")).toBe(1.15);
    expect(roundToKitchen(1.12, "l")).toBe(1.1);
  });

  it("rounds teaspoons, tablespoons and fluid ounces to a quarter", () => {
    expect(roundToKitchen(1.3, "tsp")).toBe(1.25);
    expect(roundToKitchen(2 / 3, "tsp")).toBe(0.75);
    expect(roundToKitchen(1.1, "tbsp")).toBe(1);
    expect(roundToKitchen(1.9, "fl_oz")).toBe(2);
  });

  it("rounds cups to an eighth", () => {
    expect(roundToKitchen(1.3, "cup")).toBe(1.25);
    expect(roundToKitchen(0.6, "cup")).toBe(0.625);
    expect(roundToKitchen(2, "cup")).toBe(2);
  });

  it("rounds a count to a half, and a missing unit with it", () => {
    expect(roundToKitchen(4.5, "clove")).toBe(4.5);
    expect(roundToKitchen(4.4, "clove")).toBe(4.5);
    expect(roundToKitchen(2.4, null)).toBe(2.5);
  });

  it("never rounds a positive amount down to zero", () => {
    expect(roundToKitchen(0.05, "g")).toBe(1);
    expect(roundToKitchen(0.1, "clove")).toBe(0.5);
    expect(roundToKitchen(0.001, "kg")).toBe(0.01);
    expect(roundToKitchen(0.01, null)).toBe(0.5);
  });

  it("leaves zero and a negative alone — neither is a quantity this module produces", () => {
    expect(roundToKitchen(0, "g")).toBe(0);
    expect(roundToKitchen(-1, "g")).toBe(-1);
  });
});

describe("scaleIngredients", () => {
  it("multiplies and rounds each quantity, and leaves a line with none untouched", () => {
    const lines = [
      line({ quantity: 200, unit: "g", name: "brašno" }),
      line({ quantity: 3, unit: "clove", name: "beli luk" }),
      line({ name: "so", preparation: "po ukusu" }),
    ];

    const doubled = scaleIngredients(lines, 2);
    expect(doubled).toEqual([
      line({ quantity: 400, unit: "g", name: "brašno" }),
      line({ quantity: 6, unit: "clove", name: "beli luk" }),
      line({ name: "so", preparation: "po ukusu" }),
    ]);
  });

  it("scales both ends of a range, each end by its own rule", () => {
    const ranged = scaleIngredients(
      [line({ quantity: 2, quantityMax: 3, unit: "tbsp", name: "ulje" })],
      2,
    );
    expect(ranged).toEqual([line({ quantity: 4, quantityMax: 6, unit: "tbsp", name: "ulje" })]);

    const thirds = scaleIngredients(
      [line({ quantity: 1, quantityMax: 2, unit: "tsp", name: "šećer" })],
      1.5,
    );
    expect(thirds).toEqual([line({ quantity: 1.5, quantityMax: 3, unit: "tsp", name: "šećer" })]);
  });

  it("rounds to the kitchen rule of the unit the line is written in", () => {
    // 62 g ×2 is 124 g, and grams above 100 come in fives; 1.3 tsp is a quarter
    // above a teaspoon; 1.3 cups is an eighth above a cup.
    expect(scaleIngredients([line({ quantity: 62, unit: "g" })], 2)[0]?.quantity).toBe(125);
    expect(scaleIngredients([line({ quantity: 1, unit: "tsp" })], 1.3)[0]?.quantity).toBe(1.25);
    expect(scaleIngredients([line({ quantity: 1, unit: "cup" })], 1.3)[0]?.quantity).toBe(1.25);
    expect(scaleIngredients([line({ quantity: 0.75, unit: "kg" })], 1.5)[0]?.quantity).toBe(1.15);
  });

  it("is the identity at a factor of one — asking for the recipe at its own servings is the recipe", () => {
    const lines = [
      line({ quantity: 0.3, unit: "tsp", name: "muskatni oraščić" }),
      line({ quantity: 62, unit: "g", name: "šećer" }),
    ];
    expect(scaleIngredients(lines, 1)).toEqual(lines);
    // The lines are handed back, not rebuilt: a caller comparing identity sees
    // the same objects.
    expect(scaleIngredients(lines, 1)[0]).toBe(lines[0]);
  });

  it("keeps every other field of the line, and the line's own order", () => {
    const lines = [
      line({
        quantity: 1,
        unit: "tbsp",
        name: "maslinovo ulje",
        preparation: "sitno seckano",
        group: "Za sos",
        foodRef: { kind: "catalogue", id: "maslinovo-ulje" },
        gramsPerUnit: 13.5,
      }),
    ];
    const scaled = scaleIngredients(lines, 2);
    expect(scaled[0]).toEqual({
      ...lines[0],
      quantity: 2,
    });
  });

  it("refuses a factor that is not a finite positive number", () => {
    expect(() => scaleIngredients([line({ quantity: 1, unit: "g" })], 0)).toThrow(RangeError);
    expect(() => scaleIngredients([line({ quantity: 1, unit: "g" })], -1)).toThrow(RangeError);
    expect(() => scaleIngredients([line({ quantity: 1, unit: "g" })], Number.NaN)).toThrow(
      RangeError,
    );
  });
});
