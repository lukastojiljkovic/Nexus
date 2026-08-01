import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FoodMacros } from "@nexus/core";
import {
  FitFoodNotFoundError,
  FitFoodStore,
  FitFoodValidationError,
  MAX_FIT_FOOD_SERVINGS,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-08-01T08:00:00.000Z";
const LATER = "2026-08-02T09:00:00.000Z";

const AJVAR: FoodMacros = {
  kcal: 120,
  protein: 1.5,
  carbs: 9,
  fat: 8.5,
  fiber: 2.5,
  sugar: 5,
  sodiumMg: 480,
};

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-fit-foods-"));
  db = openDatabase({ path: join(dir, "fit.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

function store(): FitFoodStore {
  return new FitFoodStore(db.raw, createProfile());
}

describe("FitFoodStore.create", () => {
  it("stores a food and returns the row", () => {
    const foods = store();
    const food = foods.create({ name: "Mamin ajvar", category: "povrce", per100g: AJVAR }, NOW);

    expect(food).toMatchObject({
      name: "Mamin ajvar",
      category: "povrce",
      per100g: AJVAR,
      servings: [],
      notes: "",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(foods.list()).toEqual([food]);
  });

  it("keeps servings and trims their labels", () => {
    const foods = store();
    const food = foods.create(
      {
        name: "Mamin ajvar",
        category: "povrce",
        per100g: AJVAR,
        servings: [{ label: "  1 kašika  ", grams: 15 }],
        notes: "Domaći, bez šećera.",
      },
      NOW,
    );

    expect(food.servings).toEqual([{ label: "1 kašika", grams: 15 }]);
    expect(foods.get(food.id).servings).toEqual([{ label: "1 kašika", grams: 15 }]);
    expect(foods.get(food.id).notes).toBe("Domaći, bez šećera.");
  });

  it("trims the name and refuses a blank or over-long one", () => {
    const foods = store();
    expect(foods.create({ name: "  Ajvar  ", category: "povrce", per100g: AJVAR }, NOW).name).toBe(
      "Ajvar",
    );
    expect(() => foods.create({ name: "   ", category: "povrce", per100g: AJVAR }, NOW)).toThrow(
      FitFoodValidationError,
    );
    expect(() =>
      foods.create({ name: "a".repeat(81), category: "povrce", per100g: AJVAR }, NOW),
    ).toThrow(FitFoodValidationError);
  });

  it("refuses a category outside the catalogue's own list", () => {
    const foods = store();
    expect(() =>
      foods.create(
        { name: "Ajvar", category: "vegetables" as never, per100g: AJVAR },
        NOW,
      ),
    ).toThrow(FitFoodValidationError);
  });

  it("refuses a negative, non-finite or absurd nutrient", () => {
    const foods = store();
    for (const per100g of [
      { ...AJVAR, kcal: -1 },
      { ...AJVAR, protein: Number.NaN },
      { ...AJVAR, sodiumMg: Number.POSITIVE_INFINITY },
      { ...AJVAR, fat: 100_001 },
    ]) {
      expect(() => foods.create({ name: "Ajvar", category: "povrce", per100g }, NOW)).toThrow(
        FitFoodValidationError,
      );
    }
  });

  it("accepts a FRACTIONAL nutrient — a food diary is not HABIT's integers", () => {
    const foods = store();
    const food = foods.create(
      { name: "Jaje", category: "jaja", per100g: { ...AJVAR, carbs: 0.72 } },
      NOW,
    );
    expect(foods.get(food.id).per100g.carbs).toBe(0.72);
  });

  it("refuses a blank serving label, a non-positive gram weight and too many servings", () => {
    const foods = store();
    const base = { name: "Ajvar", category: "povrce", per100g: AJVAR } as const;
    expect(() => foods.create({ ...base, servings: [{ label: " ", grams: 15 }] }, NOW)).toThrow(
      FitFoodValidationError,
    );
    expect(() => foods.create({ ...base, servings: [{ label: "1 kašika", grams: 0 }] }, NOW)).toThrow(
      FitFoodValidationError,
    );
    expect(() =>
      foods.create(
        {
          ...base,
          servings: Array.from({ length: MAX_FIT_FOOD_SERVINGS + 1 }, (_, i) => ({
            label: `m${i}`,
            grams: 10,
          })),
        },
        NOW,
      ),
    ).toThrow(FitFoodValidationError);
  });

  it("refuses a `now` that is not an ISO-8601 instant", () => {
    const foods = store();
    expect(() => foods.create({ name: "Ajvar", category: "povrce", per100g: AJVAR }, "2026-08-01")).toThrow(
      FitFoodValidationError,
    );
  });

  it("does NOT apply the catalogue's own gates — a label read the European way is still a food", () => {
    // „UH 7 g, vlakna 34 g" is what a chia packet says, because European labels
    // quote carbohydrate EXCLUDING fibre. `validateFoodEntry` would refuse it
    // (fiber > carbs under carbohydrate by difference); this store must not,
    // because it would be arguing with the label in the user's hand.
    const foods = store();
    const chia: FoodMacros = {
      kcal: 486, protein: 16.5, carbs: 7.7, fat: 30.7, fiber: 34.4, sugar: 0, sodiumMg: 16,
    };
    expect(foods.create({ name: "Čia semenke", category: "orasasti", per100g: chia }, NOW).per100g)
      .toEqual(chia);
  });
});

describe("FitFoodStore.list", () => {
  it("orders sr-Latn, not by code point", () => {
    const foods = store();
    for (const name of ["Zob", "Šargarepa", "Cvekla", "Čvarci"]) {
      foods.create({ name, category: "povrce", per100g: AJVAR }, NOW);
    }
    expect(foods.list().map((food) => food.name)).toEqual([
      "Cvekla",
      "Čvarci",
      "Šargarepa",
      "Zob",
    ]);
  });

  it("never crosses profiles", () => {
    const mine = store();
    const theirs = new FitFoodStore(db.raw, createProfile());
    mine.create({ name: "Ajvar", category: "povrce", per100g: AJVAR }, NOW);
    expect(theirs.list()).toEqual([]);
  });
});

describe("FitFoodStore.update", () => {
  it("applies a partial patch and leaves the rest alone", () => {
    const foods = store();
    const food = foods.create(
      {
        name: "Ajvar",
        category: "povrce",
        per100g: AJVAR,
        servings: [{ label: "1 kašika", grams: 15 }],
      },
      NOW,
    );

    const updated = foods.update(food.id, { name: "Mamin ajvar" }, LATER);
    expect(updated).toMatchObject({
      name: "Mamin ajvar",
      category: "povrce",
      per100g: AJVAR,
      servings: [{ label: "1 kašika", grams: 15 }],
      createdAt: NOW,
      updatedAt: LATER,
    });
    expect(foods.get(food.id)).toEqual(updated);
  });

  it("replaces servings wholesale when they are given", () => {
    const foods = store();
    const food = foods.create(
      {
        name: "Ajvar",
        category: "povrce",
        per100g: AJVAR,
        servings: [{ label: "1 kašika", grams: 15 }],
      },
      NOW,
    );
    expect(foods.update(food.id, { servings: [] }, LATER).servings).toEqual([]);
  });

  it("refuses an unknown, soft-deleted or foreign food", () => {
    const foods = store();
    const theirs = new FitFoodStore(db.raw, createProfile());
    const food = foods.create({ name: "Ajvar", category: "povrce", per100g: AJVAR }, NOW);

    expect(() => foods.update(uuidv7(), { name: "X" }, LATER)).toThrow(FitFoodNotFoundError);
    expect(() => theirs.update(food.id, { name: "X" }, LATER)).toThrow(FitFoodNotFoundError);
    foods.softDelete(food.id, LATER);
    expect(() => foods.update(food.id, { name: "X" }, LATER)).toThrow(FitFoodNotFoundError);
  });
});

describe("FitFoodStore.softDelete / restore", () => {
  it("hides then brings back a food under the SAME id", () => {
    const foods = store();
    const food = foods.create({ name: "Ajvar", category: "povrce", per100g: AJVAR }, NOW);

    foods.softDelete(food.id, LATER);
    expect(foods.list()).toEqual([]);
    expect(() => foods.get(food.id)).toThrow(FitFoodNotFoundError);

    foods.restore(food.id, LATER);
    // The id is unchanged, which is what makes every `user:<id>` reference in the
    // log resolve again.
    expect(foods.list().map((f) => f.id)).toEqual([food.id]);
  });

  it("refuses to delete twice or restore what is not deleted", () => {
    const foods = store();
    const food = foods.create({ name: "Ajvar", category: "povrce", per100g: AJVAR }, NOW);
    expect(() => foods.restore(food.id, LATER)).toThrow(FitFoodNotFoundError);
    foods.softDelete(food.id, LATER);
    expect(() => foods.softDelete(food.id, LATER)).toThrow(FitFoodNotFoundError);
  });
});

describe("FitFoodStore.search", () => {
  function seeded(): FitFoodStore {
    const foods = store();
    for (const name of ["Đuveč", "Šargarepa", "Kisela šargarepa", "Sarma"]) {
      foods.create({ name, category: "jela", per100g: AJVAR }, NOW);
    }
    return foods;
  }

  it("folds the query the way the whole app folds: djuvec finds Đuveč", () => {
    expect(seeded().search("djuvec").map((f) => f.name)).toEqual(["Đuveč"]);
  });

  it("finds Šargarepa from sarg, prefix matches first", () => {
    expect(seeded().search("sarg").map((f) => f.name)).toEqual(["Šargarepa", "Kisela šargarepa"]);
  });

  it("ranks prefixes above substrings and orders sr-Latn inside a rank", () => {
    expect(seeded().search("sar").map((f) => f.name)).toEqual([
      "Sarma",
      "Šargarepa",
      "Kisela šargarepa",
    ]);
  });

  it("honours a limit and answers nothing for a blank query", () => {
    expect(seeded().search("sar", 2).map((f) => f.name)).toEqual(["Sarma", "Šargarepa"]);
    expect(seeded().search("   ")).toEqual([]);
    expect(seeded().search("sar", 0)).toEqual([]);
  });

  it("never returns a soft-deleted or foreign food", () => {
    const foods = seeded();
    const theirs = new FitFoodStore(db.raw, createProfile());
    const sarma = foods.list().find((f) => f.name === "Sarma");
    foods.softDelete(sarma?.id ?? "", LATER);
    expect(foods.search("sarma")).toEqual([]);
    expect(theirs.search("sarma")).toEqual([]);
  });

  it("refuses an over-long query rather than folding a document", () => {
    expect(() => seeded().search("a".repeat(101))).toThrow(FitFoodValidationError);
  });
});
