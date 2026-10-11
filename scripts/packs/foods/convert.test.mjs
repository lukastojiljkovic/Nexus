// The foods converter's tests, on fixtures cut from the two archives this pack
// is built from (see `fixtures/` and `sources.json` for where each byte came
// from). Every expected number below is either the source's own value or one
// hand calculation written out beside it — never „a number came back".

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { convertFoods, parseCsv, saltFromSodium } from "./convert.mjs";

const FIXTURES = join(import.meta.dirname, "fixtures");
const read = (...parts) => readFileSync(join(FIXTURES, ...parts), "utf8");

const convert = (folder, dataType) =>
  convertFoods({
    foodCsv: read(folder, "food.csv"),
    foodNutrientCsv: read(folder, "food_nutrient.csv"),
    nutrientCsv: read(folder, "nutrient.csv"),
    dataType,
  });

describe("parseCsv", () => {
  it("reads quoted commas, doubled quotes and a newline inside a field", () => {
    // The shape `food_nutrient.csv`'s footnote column actually has, which is
    // why the reader is a character loop and not a `split(",")`.
    const text = '"a","b,c","d""e","f\n g"\r\n"1","2","3","4"\r\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b,c", 'd"e', "f\n g"],
      ["1", "2", "3", "4"],
    ]);
  });

  it("keeps an empty field, and drops only the newline that ends the file", () => {
    expect(parseCsv('"a","","c"\n')).toEqual([["a", "", "c"]]);
  });
});

describe("saltFromSodium", () => {
  it("applies salt = sodium x 2.5 to milligrams per 100 g", () => {
    // Hand calculation, Regulation (EU) No 1169/2011 Annex I point 11:
    // 25 mg x 2.5 = 62.5 mg = 0.0625 g, written to three decimals.
    expect(saltFromSodium(25)).toBe(0.063);
    expect(saltFromSodium(438)).toBe(1.095); // 438 x 2.5 = 1095 mg = 1.095 g
    expect(saltFromSodium(1059)).toBe(2.648); // 1059 x 2.5 = 2647.5 mg = 2.6475 g
  });
});

describe("convertFoods on the Foundation Foods fixture", () => {
  it("writes the eight values, omitting a nutrient the source does not state", () => {
    // 321358 Hummus, commercial: 1008 Energy 229 KCAL, 1003 Protein 7.35 G,
    // 1004 Fat 17.1 G, 1005 Carbohydrate 14.9 G, 1079 Fibre 5.4 G,
    // 1093 Sodium 438 MG (-> salt 1.095 G). No 2000, so no `sugarsG`.
    // 1750337 Soy milk: no 1008, so 2047 Atwater general 38.485 KCAL is used;
    // 1003 3.546875 -> 3.547, 1005 1.293125 -> 1.293, 1079 0.0 -> 0,
    // 1093 34.28 MG -> 0.0857 g -> 0.086 g.
    const { foods, dropped } = convert("foundation", "foundation_food");
    expect(foods).toEqual([
      {
        id: "321358",
        name: { en: "Hummus, commercial" },
        per100g: { energyKcal: 229, proteinG: 7.35, fatG: 17.1, carbsG: 14.9, fibreG: 5.4, saltG: 1.095 },
      },
      {
        id: "1750337",
        name: { en: "Soy milk, unsweetened, plain, shelf stable" },
        per100g: { energyKcal: 38.485, proteinG: 3.547, fatG: 2.125, carbsG: 1.293, fibreG: 0, saltG: 0.086 },
      },
    ]);
    expect(dropped).toEqual({ otherDataType: 0, unnamed: 0, incomplete: 0, noNutrients: 0 });
  });

  it("names no language but English", () => {
    // The brief is explicit: no Serbian name is invented. `name.sr` must be
    // absent, not empty.
    for (const food of convert("foundation", "foundation_food").foods) {
      expect(Object.keys(food.name)).toEqual(["en"]);
    }
  });
});

describe("convertFoods on the SR Legacy fixture", () => {
  it("writes all seven optional and required values", () => {
    // 167512: 1008 307 KCAL, 1003 5.88 G, 1004 13.24 G, 1005 41.18 G,
    // 1079 1.2 G, 2000 5.88 G, 1093 1059 MG -> 2.6475 g -> 2.648 g.
    expect(convert("sr_legacy", "sr_legacy_food").foods).toEqual([
      {
        id: "167512",
        name: { en: "Pillsbury Golden Layer Buttermilk Biscuits, Artificial Flavor, refrigerated dough" },
        per100g: {
          energyKcal: 307,
          proteinG: 5.88,
          fatG: 13.24,
          carbsG: 41.18,
          fibreG: 1.2,
          sugarsG: 5.88,
          saltG: 2.648,
        },
      },
    ]);
  });

  it("keeps only the rows of the archive's own data type", () => {
    // `food.csv` in the Foundation ZIP also carries its supporting tables; the
    // SR Legacy slice is asked for `foundation_food` rows and has none.
    const { foods, dropped } = convert("sr_legacy", "foundation_food");
    expect(foods).toEqual([]);
    expect(dropped.otherDataType).toBe(1);
  });
});

describe("convertFoods refusals", () => {
  const food = '"fdc_id","data_type","description","food_category_id","publication_date"\n'
    + '"1","foundation_food","Example food","1","2020-01-01"\n';
  const nutrient = read("foundation", "nutrient.csv");

  it("refuses a food that does not state energy, protein, fat and carbohydrate", () => {
    const rows = '"id","fdc_id","nutrient_id","amount","data_points","derivation_id","min","max","median","footnote","min_year_acquired"\n'
      + '"1","1","1003","1.0","","","","","","",""\n';
    const { foods, dropped } = convertFoods({
      foodCsv: food,
      foodNutrientCsv: rows,
      nutrientCsv: nutrient,
      dataType: "foundation_food",
    });
    expect(foods).toEqual([]);
    expect(dropped.incomplete).toBe(1);
  });

  it("refuses a nutrient dictionary whose units are not the ones the arithmetic needs", () => {
    // 1093 Sodium is MG in both archives. A release that renumbered or
    // re-united it would silently write salt a thousand times too large.
    const wrong = nutrient.replace('"1093","Sodium, Na","MG"', '"1093","Sodium, Na","G"');
    expect(() =>
      convertFoods({ foodCsv: food, foodNutrientCsv: "", nutrientCsv: wrong, dataType: "foundation_food" }),
    ).toThrow(/1093/);
  });
});
