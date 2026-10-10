import { describe, expect, it } from "vitest";
import type { IngredientLine } from "./ingredient.js";
import { buildShoppingList } from "./shopping.js";

/** A scaled ingredient line, with the fields the shopping list does not read left null. */
function line(fields: Partial<IngredientLine> & Pick<IngredientLine, "name">): IngredientLine {
  return {
    quantity: null,
    quantityMax: null,
    unit: null,
    preparation: null,
    group: null,
    foodRef: null,
    gramsPerUnit: null,
    ...fields,
  };
}

describe("buildShoppingList", () => {
  it("answers nothing for nothing", () => {
    expect(buildShoppingList([])).toEqual([]);
  });

  it("sums one thing across recipes, in the unit the first recipe used", () => {
    // 200 g from the first recipe and 1 kg from the second: 1 200 g, because the
    // first line that named the flour named it in grams.
    expect(
      buildShoppingList([
        line({ name: "brašno", quantity: 200, unit: "g" }),
        line({ name: "brašno", quantity: 1, unit: "kg" }),
      ]),
    ).toEqual([{ name: "brašno", quantity: 1200, quantityMax: null, unit: "g" }]);
  });

  it("converts into that unit exactly — three teaspoons are one tablespoon", () => {
    expect(
      buildShoppingList([
        line({ name: "maslinovo ulje", quantity: 2, unit: "tbsp" }),
        line({ name: "maslinovo ulje", quantity: 3, unit: "tsp" }),
      ]),
    ).toEqual([{ name: "maslinovo ulje", quantity: 3, quantityMax: null, unit: "tbsp" }]);

    // One cup plus one tablespoon is 1 1/16 cups, exactly: a tablespoon is a
    // sixteenth of a cup by definition.
    expect(
      buildShoppingList([
        line({ name: "mleko", quantity: 1, unit: "cup" }),
        line({ name: "mleko", quantity: 1, unit: "tbsp" }),
      ]),
    ).toEqual([{ name: "mleko", quantity: 1.0625, quantityMax: null, unit: "cup" }]);
  });

  it("keeps a mass and a volume of the same thing apart", () => {
    // 200 g and a cup of flour are two things to buy, because there is no
    // density that would make them one — the module holds none (units.ts).
    expect(
      buildShoppingList([
        line({ name: "brašno", quantity: 200, unit: "g" }),
        line({ name: "brašno", quantity: 1, unit: "cup" }),
      ]),
    ).toEqual([
      { name: "brašno", quantity: 200, quantityMax: null, unit: "g" },
      { name: "brašno", quantity: 1, quantityMax: null, unit: "cup" },
    ]);
  });

  it("sums a count only with the same count, and orders the collisions by the vocabulary", () => {
    expect(
      buildShoppingList([
        line({ name: "beli luk", quantity: 2, unit: "clove" }),
        line({ name: "beli luk", quantity: 1, unit: "clove" }),
        line({ name: "beli luk", quantity: 1, unit: "head" }),
      ]),
    ).toEqual([
      { name: "beli luk", quantity: 3, quantityMax: null, unit: "clove" },
      { name: "beli luk", quantity: 1, quantityMax: null, unit: "head" },
    ]);

    // A pinch of salt and two grams of salt are two purchases, and grams come
    // before pinches in the unit vocabulary.
    expect(
      buildShoppingList([
        line({ name: "so", quantity: 1, unit: "pinch" }),
        line({ name: "so", quantity: 2, unit: "g" }),
      ]),
    ).toEqual([
      { name: "so", quantity: 2, quantityMax: null, unit: "g" },
      { name: "so", quantity: 1, quantityMax: null, unit: "pinch" },
    ]);
  });

  it("sums a bare count with a bare count", () => {
    expect(
      buildShoppingList([
        line({ name: "jaja", quantity: 2 }),
        line({ name: "jaja", quantity: 3 }),
      ]),
    ).toEqual([{ name: "jaja", quantity: 5, quantityMax: null, unit: null }]);
  });

  it("sums both ends of a range, and treats a single amount as a range of one when it must", () => {
    expect(
      buildShoppingList([
        line({ name: "ulje", quantity: 2, quantityMax: 3, unit: "tbsp" }),
        line({ name: "ulje", quantity: 1, unit: "tbsp" }),
      ]),
    ).toEqual([{ name: "ulje", quantity: 3, quantityMax: 4, unit: "tbsp" }]);

    // No line carries a range, so the answer is a single amount rather than a
    // range that says the same number twice.
    expect(
      buildShoppingList([
        line({ name: "ulje", quantity: 2, unit: "tbsp" }),
        line({ name: "ulje", quantity: 1, unit: "tbsp" }),
      ]),
    ).toEqual([{ name: "ulje", quantity: 3, quantityMax: null, unit: "tbsp" }]);
  });

  it("keeps a line with no amount, and merges two of them into one", () => {
    expect(
      buildShoppingList([
        line({ name: "so", preparation: "po ukusu" }),
        line({ name: "so" }),
        line({ name: "biber", quantity: 1, unit: "pinch" }),
      ]),
    ).toEqual([
      { name: "biber", quantity: 1, quantityMax: null, unit: "pinch" },
      { name: "so", quantity: null, quantityMax: null, unit: null },
    ]);
  });

  it("merges two spellings of one name, and keeps the first one's letters", () => {
    expect(
      buildShoppingList([
        line({ name: "  Brašno  ", quantity: 200, unit: "g" }),
        line({ name: "brašno", quantity: 300, unit: "g" }),
      ]),
    ).toEqual([{ name: "Brašno", quantity: 500, quantityMax: null, unit: "g" }]);
  });

  it("sorts with the Serbian Latin collator, not with code points", () => {
    // Code-point order would put Šargarepa after So and before Brašno; the
    // app's collator puts š after s, ć after c and before d.
    expect(
      buildShoppingList([
        line({ name: "Šargarepa", quantity: 1, unit: "kg" }),
        line({ name: "So", quantity: 1, unit: "packet" }),
        line({ name: "Brašno", quantity: 1, unit: "kg" }),
        line({ name: "Ćešnjak", quantity: 1, unit: "head" }),
      ]).map((entry) => entry.name),
    ).toEqual(["Brašno", "Ćešnjak", "So", "Šargarepa"]);
  });

  it("never merges two different things whose names merely rhyme", () => {
    expect(
      buildShoppingList([
        line({ name: "beli luk", quantity: 2, unit: "clove" }),
        line({ name: "crni luk", quantity: 1, unit: "head" }),
        line({ name: "beli luk u prahu", quantity: 1, unit: "tsp" }),
      ]).map((entry) => entry.name),
    ).toEqual(["beli luk", "beli luk u prahu", "crni luk"]);
  });
});
