import { describe, expect, it } from "vitest";
import { EMPTY_MACROS, type FoodMacros, type FoodRef } from "../fitness/food.js";
import type { NutritionLine } from "./nutrition.js";
import { nutritionPerServing } from "./nutrition.js";

/**
 * Two linked foods, with figures chosen so every step of the arithmetic is
 * EXACT in binary floating point: 200 g is a doubling of the per-100 g row, one
 * 50 g egg is a halving, and four servings divide by four. That is what lets
 * every expectation below be a literal a reader can check against the row it
 * came from, instead of a number this test computed the way the code does.
 */
const FLOUR: FoodMacros = {
  kcal: 360,
  protein: 12,
  carbs: 74,
  fat: 1,
  fiber: 2.5,
  sugar: 0.5,
  sodiumMg: 2,
};
const EGG: FoodMacros = {
  kcal: 144,
  protein: 12.5,
  carbs: 0.5,
  fat: 10,
  fiber: 0,
  sugar: 0.25,
  sodiumMg: 128,
};

const FLOUR_REF: FoodRef = { kind: "catalogue", id: "belo-brasno" };
const EGG_REF: FoodRef = { kind: "catalogue", id: "jaje-celo-sirovo" };
const GONE_REF: FoodRef = { kind: "user", id: "obrisana-namirnica" };

/** The catalogue side of the link: two foods that resolve, everything else unknown. */
function resolve(ref: FoodRef): FoodMacros | null {
  if (ref.kind === "catalogue" && ref.id === FLOUR_REF.id) return FLOUR;
  if (ref.kind === "catalogue" && ref.id === EGG_REF.id) return EGG;
  return null;
}

function line(fields: Partial<NutritionLine>): NutritionLine {
  return {
    quantity: null,
    quantityMax: null,
    unit: null,
    name: "sastojak",
    foodRef: null,
    gramsPerUnit: null,
    ...fields,
  };
}

describe("nutritionPerServing", () => {
  it("scales each linked line by its own grams and adds them up, per serving", () => {
    const lines = [
      // 200 g against a per-100 g row: exactly twice the row.
      line({ name: "brašno", quantity: 200, unit: "g", foodRef: FLOUR_REF }),
      // One egg weighs what the line says it weighs: exactly half the row.
      line({ name: "jaje", quantity: 1, unit: "piece", foodRef: EGG_REF, gramsPerUnit: 50 }),
    ];

    const result = nutritionPerServing(lines, 4, resolve);

    // Totals, then divided by four; every figure below is exact.
    //   kcal      720 +  72 =  792 → 198
    //   protein    24 + 6.25 = 30.25 → 7.5625
    //   carbs     148 + 0.25 = 148.25 → 37.0625
    //   fat         2 +    5 = 7 → 1.75
    //   fiber       5 +    0 = 5 → 1.25
    //   sugar       1 + 0.125 = 1.125 → 0.28125
    //   sodium      4 +   64 = 68 → 17
    expect(result.perServing).toEqual({
      kcal: 198,
      protein: 7.5625,
      carbs: 37.0625,
      fat: 1.75,
      fiber: 1.25,
      sugar: 0.28125,
      sodiumMg: 17,
    });
    expect(result.countedLines).toBe(2);
    expect(result.uncounted).toEqual([]);
  });

  it("never guesses a line it cannot weigh, and says why each one was left out", () => {
    const lines = [
      line({ name: "brašno", quantity: 200, unit: "g", foodRef: FLOUR_REF }),
      line({ name: "so" }),
      line({ name: "maslinovo ulje", quantity: 2, unit: "tbsp", foodRef: FLOUR_REF }),
      line({ name: "puter", quantity: 50, unit: "g", foodRef: GONE_REF }),
      line({ name: "mleko", quantity: 100, unit: "ml" }),
      line({ name: "jaje", quantity: 1, unit: "piece", foodRef: EGG_REF, gramsPerUnit: 50 }),
    ];

    const result = nutritionPerServing(lines, 1, resolve);

    // The two lines that could be weighed are the two that were counted.
    expect(result.countedLines).toBe(2);
    expect(result.perServing).toEqual({
      kcal: 792,
      protein: 30.25,
      carbs: 148.25,
      fat: 7,
      fiber: 5,
      sugar: 1.125,
      sodiumMg: 68,
    });
    expect(result.uncounted).toEqual([
      // No link at all: „so" is not something the app can look up.
      { name: "so", reason: "unlinked" },
      // A link, and no way to know what two tablespoons of oil weigh: the
      // module holds no densities, so it says so rather than guessing one.
      { name: "maslinovo ulje", reason: "unknown-grams" },
      // A link to a food that is not there any more (a deleted user food).
      { name: "puter", reason: "unknown-food" },
      // Without a link, a volume is not a mass either.
      { name: "mleko", reason: "unlinked" },
    ]);
  });

  it("weighs a mass unit without being told, and refuses a volume without a density", () => {
    const result = nutritionPerServing(
      [
        // 0.5 kg is 500 g, which is five times the row.
        line({ name: "brašno", quantity: 0.5, unit: "kg", foodRef: FLOUR_REF }),
        // A cup is a volume: only a stated weight of one can make it countable.
        line({ name: "brašno", quantity: 1, unit: "cup", foodRef: FLOUR_REF }),
      ],
      1,
      resolve,
    );

    expect(result.perServing).toEqual({
      kcal: 1800,
      protein: 60,
      carbs: 370,
      fat: 5,
      fiber: 12.5,
      sugar: 2.5,
      sodiumMg: 10,
    });
    expect(result.uncounted).toEqual([{ name: "brašno", reason: "unknown-grams" }]);
  });

  it("counts a range at its LOWER end — the amount certainly in the pot", () => {
    const result = nutritionPerServing(
      [
        line({
          name: "jaje",
          quantity: 2,
          quantityMax: 3,
          unit: "piece",
          foodRef: EGG_REF,
          gramsPerUnit: 50,
        }),
      ],
      1,
      resolve,
    );

    // 2 × 50 g = 100 g against the row, not 150 g and not an average of the two.
    expect(result.perServing).toEqual({
      kcal: 144,
      protein: 12.5,
      carbs: 0.5,
      fat: 10,
      fiber: 0,
      sugar: 0.25,
      sodiumMg: 128,
    });
    expect(result.countedLines).toBe(1);
  });

  it("answers zero of everything for a recipe with nothing weighable", () => {
    const result = nutritionPerServing([line({ name: "so" })], 2, resolve);
    expect(result.perServing).toEqual(EMPTY_MACROS);
    expect(result.countedLines).toBe(0);
    expect(result.uncounted).toEqual([{ name: "so", reason: "unlinked" }]);
  });

  it("refuses a serving count that is not a positive number", () => {
    expect(() => nutritionPerServing([], 0, resolve)).toThrow(RangeError);
    expect(() => nutritionPerServing([], Number.NaN, resolve)).toThrow(RangeError);
  });
});
