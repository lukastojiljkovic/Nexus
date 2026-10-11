import { describe, expect, it } from "vitest";
import type { IngredientLine } from "./ingredient.js";
import { parseIngredientLine } from "./parse.js";

/** The line a case expects, with everything the parser never invents left null. */
function parsed(
  fields: Partial<IngredientLine> & Pick<IngredientLine, "name">,
): IngredientLine {
  return {
    quantity: null,
    unit: null,
    quantityMax: null,
    preparation: null,
    group: null,
    foodRef: null,
    gramsPerUnit: null,
    ...fields,
  };
}

describe("parseIngredientLine", () => {
  it("answers nothing for a blank line — an empty box is not an ingredient", () => {
    expect(parseIngredientLine("")).toBeNull();
    expect(parseIngredientLine("   \t ")).toBeNull();
  });

  /**
   * The table the brief asks for: the lines a Serbian and an English kitchen
   * actually write, and exactly what each one becomes. Every expected value is
   * read off the line by hand — the point of a parser test is that a human
   * agreed with each answer, so nothing here is asserted as "some object".
   */
  it.each([
    // --- English ------------------------------------------------------------
    ["a range and a preparation note", "2–3 tbsp olive oil, divided",
      parsed({ quantity: 2, quantityMax: 3, unit: "tbsp", name: "olive oil", preparation: "divided" })],
    ["a metric weight", "200 g flour", parsed({ quantity: 200, unit: "g", name: "flour" })],
    ["a halved cup", "1/2 cup sugar", parsed({ quantity: 0.5, unit: "cup", name: "sugar" })],
    ["a vulgar fraction", "½ cup milk", parsed({ quantity: 0.5, unit: "cup", name: "milk" })],
    ["a mixed number with a vulgar fraction", "1½ tsp vanilla extract",
      parsed({ quantity: 1.5, unit: "tsp", name: "vanilla extract" })],
    ["a mixed number written out", "1 1/2 cups flour",
      parsed({ quantity: 1.5, unit: "cup", name: "flour" })],
    ["a quarter teaspoon", "1/4 tsp black pepper",
      parsed({ quantity: 0.25, unit: "tsp", name: "black pepper" })],
    ["a count with no unit", "3 large eggs", parsed({ quantity: 3, name: "large eggs" })],
    ["a clove", "2 cloves garlic", parsed({ quantity: 2, unit: "clove", name: "garlic" })],
    ["a sprig", "1 sprig rosemary", parsed({ quantity: 1, unit: "sprig", name: "rosemary" })],
    ["a packet", "1 packet instant yeast",
      parsed({ quantity: 1, unit: "packet", name: "instant yeast" })],
    ["an article standing for one", "a pinch of salt",
      parsed({ quantity: 1, unit: "pinch", name: "salt" })],
    ["the word half", "half a lemon", parsed({ quantity: 0.5, name: "lemon" })],
    ["a word of", "2 tbsp of olive oil", parsed({ quantity: 2, unit: "tbsp", name: "olive oil" })],
    ["to taste", "salt to taste", parsed({ name: "salt", preparation: "to taste" })],
    ["a trailing note after a comma", "400 g cherry tomatoes, halved",
      parsed({ quantity: 400, unit: "g", name: "cherry tomatoes", preparation: "halved" })],
    ["a metric litre", "1 l vegetable stock", parsed({ quantity: 1, unit: "l", name: "vegetable stock" })],
    ["a fluid ounce", "4 fl oz double cream",
      parsed({ quantity: 4, unit: "fl_oz", name: "double cream" })],

    // --- Serbian ------------------------------------------------------------
    ["a metric weight", "200 g brašna", parsed({ quantity: 200, unit: "g", name: "brašna" })],
    ["grams spelled out", "100 grama šećera",
      parsed({ quantity: 100, unit: "g", name: "šećera" })],
    ["kilograms", "1 kg krompira", parsed({ quantity: 1, unit: "kg", name: "krompira" })],
    ["millilitres", "500 ml mleka", parsed({ quantity: 500, unit: "ml", name: "mleka" })],
    ["litres", "1 litar mleka", parsed({ quantity: 1, unit: "l", name: "mleka" })],
    ["a decimal comma", "1,5 l vode", parsed({ quantity: 1.5, unit: "l", name: "vode" })],
    ["tablespoons", "2 kašike maslinovog ulja",
      parsed({ quantity: 2, unit: "tbsp", name: "maslinovog ulja" })],
    ["teaspoons", "2 kašičice soli", parsed({ quantity: 2, unit: "tsp", name: "soli" })],
    ["a spoon with no amount", "kašika meda", parsed({ unit: "tbsp", name: "meda" })],
    ["a cup", "1 šolja brašna", parsed({ quantity: 1, unit: "cup", name: "brašna" })],
    ["a pinch", "prstohvat soli", parsed({ unit: "pinch", name: "soli" })],
    ["a head", "glavica crnog luka", parsed({ unit: "head", name: "crnog luka" })],
    ["a can", "1 konzerva pelata", parsed({ quantity: 1, unit: "can", name: "pelata" })],
    ["a slice", "2 kriške hleba", parsed({ quantity: 2, unit: "slice", name: "hleba" })],
    ["a bunch", "1 veza peršuna", parsed({ quantity: 1, unit: "bunch", name: "peršuna" })],
    ["a piece", "1 komad đumbira", parsed({ quantity: 1, unit: "piece", name: "đumbira" })],
    ["a stick", "2 štapića cimeta", parsed({ quantity: 2, unit: "stick", name: "cimeta" })],
    ["a range with do", "2 do 3 čena belog luka",
      parsed({ quantity: 2, quantityMax: 3, unit: "clove", name: "belog luka" })],
    ["a range with a dash and no unit", "3-4 srednja krompira, oljuštena",
      parsed({ quantity: 3, quantityMax: 4, name: "srednja krompira", preparation: "oljuštena" })],
    ["half written as pola", "pola kašičice soli",
      parsed({ quantity: 0.5, unit: "tsp", name: "soli" })],
    ["to taste at the end", "biber po ukusu", parsed({ name: "biber", preparation: "po ukusu" })],
    ["nothing at all but a name and a note", "so po ukusu",
      parsed({ name: "so", preparation: "po ukusu" })],
    ["a trailing parenthetical", "2 kašike ulja (maslinovog)",
      parsed({ quantity: 2, unit: "tbsp", name: "ulja", preparation: "maslinovog" })],
    ["a parenthetical that is itself a note", "1 kašičica soli (po ukusu)",
      parsed({ quantity: 1, unit: "tsp", name: "soli", preparation: "po ukusu" })],
    ["an unspaced range", "200-300 ml mleka",
      parsed({ quantity: 200, quantityMax: 300, unit: "ml", name: "mleka" })],
  ])("reads %s: „%s“", (_label, text, expected) => {
    expect(parseIngredientLine(text)).toEqual(expected);
  });

  it("collapses the whitespace a typed line arrives with", () => {
    expect(parseIngredientLine("  200    g     brašna  ")).toEqual(
      parsed({ quantity: 200, unit: "g", name: "brašna" }),
    );
  });

  it("drops a trailing full stop — a sentence's punctuation is not part of a name", () => {
    expect(parseIngredientLine("200 g brašna.")).toEqual(
      parsed({ quantity: 200, unit: "g", name: "brašna" }),
    );
  });

  it("keeps a group heading whole — it is the caller's to recognise, not this parser's", () => {
    // „Za sos:" is a heading, and this function's contract is one INGREDIENT
    // line; guessing here would turn a heading into a nameless ingredient. The
    // caller decides, which is why the name is handed back exactly as typed.
    expect(parseIngredientLine("Za sos:")).toEqual(parsed({ name: "Za sos:" }));
  });

  it("does not read a unit out of the middle of a name", () => {
    expect(parseIngredientLine("2 lampaca")).toEqual(parsed({ quantity: 2, name: "lampaca" }));
    expect(parseIngredientLine("1 kutija")).toEqual(parsed({ quantity: 1, name: "kutija" }));
  });

  it("does not invent a unit for an unknown one", () => {
    expect(parseIngredientLine("2 zrna bibera")).toEqual(
      parsed({ quantity: 2, name: "zrna bibera" }),
    );
  });
});
