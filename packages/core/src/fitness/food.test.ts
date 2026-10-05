import { describe, expect, it } from "vitest";
import {
  EMPTY_MACROS,
  FOOD_CATEGORIES,
  foodRefText,
  macrosFor,
  parseFoodRef,
  searchFoods,
  sumMacros,
  validateFoodEntry,
} from "./food.js";
import type { FoodEntry, FoodMacros } from "./food.js";

/** „Šargarepa, sirova" — USDA FDC 170393, verbatim. The one entry every test below starts from. */
const CARROT: FoodEntry = {
  id: "sargarepa-sirova",
  nameEn: "Carrot, raw",
  name: "Šargarepa, sirova",
  category: "povrce",
  per100g: { kcal: 41, protein: 0.93, carbs: 9.58, fat: 0.24, fiber: 2.8, sugar: 4.74, sodiumMg: 69 },
  servings: [{ label: "1 srednja", labelEn: "1 medium", grams: 61 }],
  source: {
    kind: "usda",
    ref: "FDC 170393",
    url: "https://fdc.nal.usda.gov/food-details/170393/nutrients",
  },
  notes: "",
  notesEn: "",
};

function entry(patch: Partial<FoodEntry>): FoodEntry {
  return { ...CARROT, ...patch };
}

function macros(patch: Partial<FoodMacros>): FoodMacros {
  return { ...CARROT.per100g, ...patch };
}

function codes(value: unknown): string[] {
  return validateFoodEntry(value).map((problem) => `${problem.field}:${problem.code}`);
}

describe("validateFoodEntry — shape", () => {
  it("accepts a well-formed entry", () => {
    expect(validateFoodEntry(CARROT)).toEqual([]);
  });

  it("refuses anything that is not an object", () => {
    expect(codes(null)).toEqual(["<root>:shape"]);
    expect(codes("sargarepa")).toEqual(["<root>:shape"]);
    expect(codes([CARROT])).toEqual(["<root>:shape"]);
  });

  it("refuses a missing or non-string name", () => {
    expect(codes(entry({ name: "" }))).toEqual(["name:shape"]);
    expect(codes({ ...CARROT, name: 7 })).toEqual(["name:shape"]);
  });

  it("refuses a name that is only whitespace", () => {
    expect(codes(entry({ name: "   " }))).toEqual(["name:shape"]);
  });

  it("refuses a non-string notes", () => {
    expect(codes({ ...CARROT, notes: null })).toEqual(["notes:shape"]);
  });

  it("accepts every declared category and refuses anything else", () => {
    for (const category of FOOD_CATEGORIES) {
      expect(validateFoodEntry(entry({ category }))).toEqual([]);
    }
    expect(codes({ ...CARROT, category: "vegetables" })).toEqual(["category:category"]);
  });
});

describe("validateFoodEntry — id", () => {
  it("accepts lower-case ASCII kebab-case with digits", () => {
    expect(validateFoodEntry(entry({ id: "hleb-beli-500g" }))).toEqual([]);
  });

  it("refuses upper case, underscores, spaces and diacritics", () => {
    for (const id of ["Sargarepa", "sargarepa_sirova", "sargarepa sirova", "šargarepa"]) {
      expect(codes(entry({ id }))).toEqual(["id:id"]);
    }
  });

  it("refuses leading, trailing and doubled separators", () => {
    for (const id of ["-sargarepa", "sargarepa-", "sargarepa--sirova", ""]) {
      expect(codes(entry({ id }))).toEqual(["id:id"]);
    }
  });
});

describe("validateFoodEntry — macros", () => {
  it("refuses a negative value in any of the seven fields", () => {
    expect(codes(entry({ per100g: macros({ sodiumMg: -1 }) }))).toEqual(["per100g.sodiumMg:range"]);
    expect(codes(entry({ per100g: macros({ fiber: -0.1 }) }))).toContain("per100g.fiber:range");
  });

  it("refuses a non-finite or non-numeric value", () => {
    expect(codes(entry({ per100g: macros({ kcal: Number.NaN }) }))).toContain("per100g.kcal:range");
    expect(codes({ ...CARROT, per100g: { ...CARROT.per100g, protein: "0.93" } })).toContain(
      "per100g.protein:shape",
    );
  });

  it("refuses sugar above carbs and accepts sugar equal to carbs", () => {
    expect(codes(entry({ per100g: macros({ sugar: 9.59 }) }))).toEqual(["per100g.sugar:sugar"]);
    expect(validateFoodEntry(entry({ per100g: macros({ sugar: 9.58 }) }))).toEqual([]);
  });

  it("refuses fiber above carbs — `carbs` is carbohydrate BY DIFFERENCE, so fiber sits inside it", () => {
    expect(codes(entry({ per100g: macros({ fiber: 9.59 }) }))).toEqual(["per100g.fiber:fiber"]);
  });

  it("accepts protein + carbs + fat of exactly 100 g and refuses more", () => {
    // Maslinovo ulje: 100 g of fat in 100 g of food is the real boundary, not a
    // rounding artefact — USDA FDC 171413 says exactly that.
    const oil = macros({ kcal: 884, protein: 0, carbs: 0, fat: 100, fiber: 0, sugar: 0 });
    expect(validateFoodEntry(entry({ per100g: oil }))).toEqual([]);
    expect(codes(entry({ per100g: { ...oil, protein: 0.1 } }))).toContain("per100g:mass");
  });
});

describe("validateFoodEntry — the energy rule", () => {
  it("accepts a food whose Atwater estimate lands inside ±10%, with nothing said", () => {
    // Jaje: 4·12.6 + 4·0.72 + 9·9.51 = 138.87 against 143 kcal — 2.9% under.
    const egg = macros({ kcal: 143, protein: 12.6, carbs: 0.72, fat: 9.51, fiber: 0, sugar: 0.37 });
    expect(validateFoodEntry(entry({ per100g: egg, category: "jaja", notes: "" }))).toEqual([]);
  });

  it("refuses an unexplained estimate more than 10% above the published calories", () => {
    // 4·0 + 4·30 + 9·0 = 120 against 100 kcal — 20% over.
    const wrong = macros({ kcal: 100, protein: 0, carbs: 30, fat: 0, fiber: 0, sugar: 0 });
    expect(codes(entry({ per100g: wrong, notes: "" }))).toEqual(["per100g:energy"]);
  });

  it("refuses an unexplained estimate more than 10% below the published calories", () => {
    // 4·0 + 4·20 + 9·0 = 80 against 100 kcal — 20% under.
    const wrong = macros({ kcal: 100, protein: 0, carbs: 20, fat: 0, fiber: 0, sugar: 0 });
    expect(codes(entry({ per100g: wrong, notes: "" }))).toEqual(["per100g:energy"]);
  });

  it("accepts a zero-calorie food whose macros are all zero", () => {
    const salt = macros({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodiumMg: 38758 });
    expect(validateFoodEntry(entry({ per100g: salt, category: "zacini", notes: "" }))).toEqual([]);
  });

  it("refuses an unexplained zero-calorie food that carries macros", () => {
    const wrong = macros({ kcal: 0, protein: 0, carbs: 5, fat: 0, fiber: 0, sugar: 0 });
    expect(codes(entry({ per100g: wrong, notes: "" }))).toEqual(["per100g:energy"]);
  });

  it("lets a sentence license any deviation — pivo, whose ethanol the macros cannot see", () => {
    // USDA FDC 168746: 4·0.46 + 4·3.55 = 16.04 against a published 43, because
    // 3.9 g of ethanol carries the missing 27 kcal and is none of the three
    // macros. 63% out, and not an error.
    const beer = macros({ kcal: 43, protein: 0.46, carbs: 3.55, fat: 0, fiber: 0, sugar: 0, sodiumMg: 4 });
    expect(codes(entry({ per100g: beer, category: "pica", notes: "" }))).toEqual(["per100g:energy"]);
    expect(
      validateFoodEntry(
        entry({ per100g: beer, category: "pica", notes: "Razliku nosi etanol, 7 kcal/g." }),
      ),
    ).toEqual([]);
  });

  it("licenses USDA's own food-specific Atwater factors the same way", () => {
    // Limun (USDA FDC 167746) deviates by 53%: 4·1.1 + 4·9.32 + 9·0.3 = 44.38
    // against a published 29, because its carbohydrate by difference is largely
    // citric acid and USDA bills it with specific factors rather than 4/4/9.
    // Rewriting kcal to close the gap would ship a number USDA does not publish,
    // so the note is what passes it.
    const lemon = macros({ kcal: 29, protein: 1.1, carbs: 9.32, fat: 0.3, fiber: 2.8, sugar: 2.5, sodiumMg: 2 });
    expect(codes(entry({ per100g: lemon, category: "voce", notes: "" }))).toEqual(["per100g:energy"]);
    expect(
      validateFoodEntry(
        entry({ per100g: lemon, category: "voce", notes: "USDA koristi specifične Atwater faktore." }),
      ),
    ).toEqual([]);
  });

  it("treats whitespace-only notes as saying nothing", () => {
    const wrong = macros({ kcal: 100, protein: 0, carbs: 30, fat: 0, fiber: 0, sugar: 0 });
    expect(codes(entry({ per100g: wrong, notes: "   " }))).toEqual(["per100g:energy"]);
  });

  it("never applies the band to a recipe component, which has no note of its own", () => {
    // 4·0 + 4·30 + 9·0 = 120 against 100 kcal on the COMPONENT: unexplained, and
    // still not a problem — the containment rules are what guard a component.
    const off = macros({ kcal: 100, protein: 0, carbs: 30, fat: 0, fiber: 0, sugar: 0 });
    expect(
      validateFoodEntry(
        entry({
          notes: "",
          category: "jela",
          source: {
            kind: "derived",
            yieldGrams: 100,
            recipe: [{ what: "X", grams: 100, per100g: off, url: "https://x.example/1" }],
          },
        }),
      ),
    ).toEqual([]);
  });
});

describe("validateFoodEntry — servings", () => {
  it("refuses a non-array", () => {
    expect(codes({ ...CARROT, servings: null })).toEqual(["servings:shape"]);
  });

  it("accepts an empty list — a food nobody measures in pieces has no serving to invent", () => {
    expect(validateFoodEntry(entry({ servings: [] }))).toEqual([]);
  });

  it("refuses a blank label and a non-positive gram weight", () => {
    expect(codes(entry({ servings: [{ label: " ", labelEn: "1 medium", grams: 61 }] }))).toEqual([
      "servings[0].label:shape",
    ]);
    expect(
      codes(entry({ servings: [{ label: "1 srednja", labelEn: "1 medium", grams: 0 }] })),
    ).toEqual([
      "servings[0].grams:range",
    ]);
  });

  // The English half is a required part of the shape, not a decoration: an
  // English interface drops a row with no `nameEn`/`labelEn`, so the gate has to
  // refuse one before a build can ship it.
  it("refuses a missing or blank English name, note key or serving label", () => {
    expect(codes({ ...CARROT, nameEn: "  " })).toEqual(["nameEn:shape"]);
    expect(codes({ ...CARROT, nameEn: undefined })).toEqual(["nameEn:shape"]);
    expect(codes({ ...CARROT, notesEn: undefined })).toEqual(["notesEn:shape"]);
    expect(
      codes(entry({ servings: [{ label: "1 srednja", labelEn: " ", grams: 61 }] })),
    ).toEqual(["servings[0].labelEn:shape"]);
  });
});

describe("validateFoodEntry — source", () => {
  it("refuses a missing ref or url on a cited source", () => {
    expect(codes(entry({ source: { kind: "usda", ref: "", url: "https://x.example/1" } }))).toEqual([
      "source.ref:shape",
    ]);
    expect(codes(entry({ source: { kind: "official", ref: "R", url: "" } }))).toEqual([
      "source.url:shape",
    ]);
  });

  it("refuses a url that is not http(s) — a citation nobody can open is not provenance", () => {
    expect(codes(entry({ source: { kind: "usda", ref: "R", url: "javascript:alert(1)" } }))).toEqual([
      "source.url:shape",
    ]);
  });

  it("refuses an unknown source kind", () => {
    expect(codes({ ...CARROT, source: { kind: "guess", ref: "R", url: "https://x.example/1" } })).toEqual(
      ["source.kind:shape"],
    );
  });

  // `stated` is the founder-decided kind for a food no public table measures
  // (kajmak, and so far only kajmak). It carries no url on purpose — inventing
  // one would be the pretence the kind exists to avoid — so what it must carry
  // instead is the basis and the published range. A stated number with its
  // uncertainty stripped off is indistinguishable from a measured one, which is
  // the only way this exception could quietly become a loophole.
  it("accepts a stated source that declares both its basis and its range", () => {
    expect(
      validateFoodEntry(
        entry({
          source: { kind: "stated", basis: "Odluka osnivača: 50% masti.", range: "40–55% mlad." },
        }),
      ),
    ).toEqual([]);
  });

  it("refuses a stated source missing either half of its uncertainty", () => {
    expect(codes(entry({ source: { kind: "stated", basis: "", range: "40–55%" } }))).toEqual([
      "source.basis:shape",
    ]);
    expect(codes(entry({ source: { kind: "stated", basis: "Odluka.", range: "   " } }))).toEqual([
      "source.range:shape",
    ]);
    // Neither half present: not even a well-typed `stated` source, so it goes in
    // untyped the way the unknown-kind case above does.
    expect(codes({ ...CARROT, source: { kind: "stated" } })).toEqual([
      "source.basis:shape",
      "source.range:shape",
    ]);
  });


  it("accepts a derived source whose components each carry their own numbers and url", () => {
    expect(
      validateFoodEntry(
        entry({
          category: "jela",
          source: {
            kind: "derived",
            yieldGrams: 900,
            recipe: [
              {
                what: "Šargarepa, sirova",
                grams: 300,
                per100g: CARROT.per100g,
                url: "https://fdc.nal.usda.gov/food-details/170393/nutrients",
              },
            ],
          },
        }),
      ),
    ).toEqual([]);
  });

  it("refuses a derived source with no components or a non-positive yield", () => {
    expect(codes(entry({ source: { kind: "derived", yieldGrams: 900, recipe: [] } }))).toEqual([
      "source.recipe:shape",
    ]);
    expect(
      codes(
        entry({
          source: {
            kind: "derived",
            yieldGrams: 0,
            recipe: [
              { what: "X", grams: 1, per100g: CARROT.per100g, url: "https://x.example/1" },
            ],
          },
        }),
      ),
    ).toEqual(["source.yieldGrams:range"]);
  });

  it("refuses a component whose own macros are impossible", () => {
    expect(
      codes(
        entry({
          source: {
            kind: "derived",
            yieldGrams: 100,
            recipe: [
              {
                what: "X",
                grams: 100,
                per100g: macros({ sugar: 99 }),
                url: "https://x.example/1",
              },
            ],
          },
        }),
      ),
    ).toEqual(["source.recipe[0].per100g.sugar:sugar"]);
  });
});

describe("searchFoods", () => {
  const DJUVEC: FoodEntry = entry({ id: "djuvec", name: "Đuveč", category: "jela" });
  const SARMA: FoodEntry = entry({ id: "sarma", name: "Sarma", category: "jela" });
  const KISELA: FoodEntry = entry({ id: "kisela-sargarepa", name: "Kisela šargarepa" });
  const ENTRIES = [CARROT, DJUVEC, SARMA, KISELA];

  it("finds Đuveč from an ASCII `djuvec` — đ is one code point and NFD leaves it whole", () => {
    expect(searchFoods(ENTRIES, "djuvec", 10).map((food) => food.id)).toEqual(["djuvec"]);
  });

  it("finds Šargarepa from `sarg`", () => {
    expect(searchFoods(ENTRIES, "sarg", 10).map((food) => food.id)).toEqual([
      "sargarepa-sirova",
      "kisela-sargarepa",
    ]);
  });

  it("finds an entry by its English name, and keeps its Serbian name searchable", () => {
    // Built explicitly rather than from `entry()`, whose spread would hand both
    // rows the same English name.
    const carrot: FoodEntry = { ...CARROT, id: "carrot", nameEn: "Carrot, raw" };
    const chips: FoodEntry = { ...CARROT, id: "chips", name: "Cips, od krompira", nameEn: "Potato chips, salted" };
    const pool = [carrot, chips];
    // The active language's name finds it...
    expect(searchFoods(pool, "potato", 10).map((food) => food.id)).toEqual(["chips"]);
    expect(searchFoods(pool, "carrot", 10).map((food) => food.id)).toEqual(["carrot"]);
    // ...and the Serbian name stays searchable under the same query language.
    expect(searchFoods(pool, "cips", 10).map((food) => food.id)).toEqual(["chips"]);
    expect(searchFoods(pool, "sarg", 10).map((food) => food.id)).toEqual(["carrot"]);
  });

  it("is case- and diacritic-insensitive in both directions", () => {
    expect(searchFoods(ENTRIES, "ĐUVEČ", 10).map((food) => food.id)).toEqual(["djuvec"]);
    expect(searchFoods(ENTRIES, "Šarga", 10).map((food) => food.id)).toEqual([
      "sargarepa-sirova",
      "kisela-sargarepa",
    ]);
  });

  it("ranks prefix matches above substring matches", () => {
    // „Sarma" and „Šargarepa, sirova" both START with the query, so they lead —
    // in sr-Latn order, which puts s before š. „Kisela šargarepa" only contains
    // it, and follows however early in the alphabet its own name falls.
    expect(searchFoods(ENTRIES, "sar", 10).map((food) => food.id)).toEqual([
      "sarma",
      "sargarepa-sirova",
      "kisela-sargarepa",
    ]);
  });

  it("breaks ties by sr-Latn order, not by code point", () => {
    const cacak: FoodEntry = entry({ id: "cacak", name: "Cacak" });
    const cvarci: FoodEntry = entry({ id: "cvarci", name: "Čvarci" });
    const cokolada: FoodEntry = entry({ id: "cokolada", name: "Ćokolada" });
    // Folded, all three begin "c"; sr-Latn orders c < č < ć, which a plain
    // code-point sort would get backwards for the two accented ones.
    expect(searchFoods([cokolada, cvarci, cacak], "c", 10).map((food) => food.name)).toEqual([
      "Cacak",
      "Čvarci",
      "Ćokolada",
    ]);
  });

  it("honours the limit and returns the highest-ranked matches", () => {
    expect(searchFoods(ENTRIES, "sar", 2).map((food) => food.id)).toEqual([
      "sarma",
      "sargarepa-sirova",
    ]);
    expect(searchFoods(ENTRIES, "sar", 0)).toEqual([]);
  });

  it("answers nothing for a blank query", () => {
    expect(searchFoods(ENTRIES, "", 10)).toEqual([]);
    expect(searchFoods(ENTRIES, "   ", 10)).toEqual([]);
  });

  it("answers nothing when nothing matches", () => {
    expect(searchFoods(ENTRIES, "kivi", 10)).toEqual([]);
  });

  it("ranks a MERGED pool as one list, whatever each half is (FIT slice b's picker)", () => {
    // The picker draws the catalogue and the profile's own foods together, and
    // a user's food is a different type by construction — it carries no
    // `source`, deliberately. Two ranked lists merged by the caller would be a
    // second definition of „best match"; this is the one ranking, over whatever
    // pool it is handed.
    const pool = [
      { id: "catalogue:sarma", name: "Sarma" },
      { id: "user:0197c3d5-0000-7000-8000-000000000001", name: "Sarma po maminom" },
      { id: "catalogue:kisela-sargarepa", name: "Kisela šargarepa" },
    ];
    expect(searchFoods(pool, "sar", 10).map((food) => food.id)).toEqual([
      "catalogue:sarma",
      "user:0197c3d5-0000-7000-8000-000000000001",
      "catalogue:kisela-sargarepa",
    ]);
  });

  it("hands back the pool's OWN objects, so a caller can carry whatever it needs on them", () => {
    const mine = { id: "user:a", name: "Ajvar", mine: true };
    const [hit] = searchFoods([mine], "ajv", 10);
    expect(hit).toBe(mine);
  });
});

describe("food references", () => {
  it("round-trips both kinds", () => {
    expect(foodRefText({ kind: "catalogue", id: "jaje-celo-sirovo" })).toBe(
      "catalogue:jaje-celo-sirovo",
    );
    expect(parseFoodRef("catalogue:jaje-celo-sirovo")).toEqual({
      kind: "catalogue",
      id: "jaje-celo-sirovo",
    });
    expect(foodRefText({ kind: "user", id: "0197c3d5-0000-7000-8000-000000000001" })).toBe(
      "user:0197c3d5-0000-7000-8000-000000000001",
    );
    expect(parseFoodRef("user:0197c3d5-0000-7000-8000-000000000001")).toEqual({
      kind: "user",
      id: "0197c3d5-0000-7000-8000-000000000001",
    });
  });

  it("holds a catalogue reference to the catalogue's own slug rule", () => {
    expect(parseFoodRef("catalogue:Jaje")).toBeNull();
    expect(parseFoodRef("catalogue:jaje celo")).toBeNull();
    expect(parseFoodRef("catalogue:")).toBeNull();
  });

  it("refuses an unknown kind, a missing separator and an over-long reference", () => {
    expect(parseFoodRef("shipped:jaje")).toBeNull();
    expect(parseFoodRef("jaje-celo-sirovo")).toBeNull();
    expect(parseFoodRef(":jaje")).toBeNull();
    expect(parseFoodRef(`user:${"a".repeat(200)}`)).toBeNull();
  });
});

describe("macrosFor", () => {
  it("scales every field by grams/100", () => {
    expect(macrosFor(CARROT.per100g, 200)).toEqual({
      kcal: 82,
      protein: 1.86,
      carbs: 19.16,
      fat: 0.48,
      fiber: 5.6,
      sugar: 9.48,
      sodiumMg: 138,
    });
  });

  it("answers all zeros for zero grams", () => {
    expect(macrosFor(CARROT.per100g, 0)).toEqual(EMPTY_MACROS);
  });

  it("refuses a negative or non-finite gram weight", () => {
    expect(() => macrosFor(CARROT.per100g, -1)).toThrow(RangeError);
    expect(() => macrosFor(CARROT.per100g, Number.NaN)).toThrow(RangeError);
  });
});

describe("sumMacros", () => {
  it("adds field by field", () => {
    expect(sumMacros([macrosFor(CARROT.per100g, 100), macrosFor(CARROT.per100g, 100)])).toEqual(
      macrosFor(CARROT.per100g, 200),
    );
  });

  it("answers all zeros for an empty list", () => {
    expect(sumMacros([])).toEqual(EMPTY_MACROS);
  });
});
