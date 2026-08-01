import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FoodMacros } from "@nexus/core";
import {
  FitMealItemNotFoundError,
  FitMealStore,
  FitMealValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";
import type { AddMealItemInput } from "../index.js";

const NOW = "2026-08-01T08:00:00.000Z";
const LATER = "2026-08-01T13:00:00.000Z";
const DAY = "2026-08-01";
const NEXT_DAY = "2026-08-02";

/** „Pileće belo meso, pečeno" — USDA FDC 171477, the snapshot a caller hands in. */
const CHICKEN: FoodMacros = {
  kcal: 165,
  protein: 31,
  carbs: 0,
  fat: 3.57,
  fiber: 0,
  sugar: 0,
  sodiumMg: 74,
};

/** „Pirinač, beli, kuvan" — USDA FDC 169757. */
const RICE: FoodMacros = {
  kcal: 130,
  protein: 2.69,
  carbs: 28.2,
  fat: 0.28,
  fiber: 0.4,
  sugar: 0.05,
  sodiumMg: 1,
};

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-fit-meals-"));
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

function store(): FitMealStore {
  return new FitMealStore(db.raw, createProfile());
}

function chicken(patch: Partial<AddMealItemInput> = {}): AddMealItemInput {
  return {
    date: DAY,
    slot: "rucak",
    foodRef: "catalogue:pilece-belo-meso-peceno",
    label: "Pileće belo meso, pečeno",
    grams: 200,
    per100g: CHICKEN,
    ...patch,
  };
}

describe("FitMealStore.addItem", () => {
  it("stores an item with the snapshot it was handed", () => {
    const meals = store();
    const item = meals.addItem(chicken(), NOW);

    expect(item).toMatchObject({
      date: DAY,
      slot: "rucak",
      foodRef: "catalogue:pilece-belo-meso-peceno",
      label: "Pileće belo meso, pečeno",
      grams: 200,
      per100g: CHICKEN,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(meals.listDay(DAY).rucak).toEqual([item]);
  });

  it("accepts both reference kinds and refuses anything else", () => {
    const meals = store();
    const userId = uuidv7();
    expect(meals.addItem(chicken({ foodRef: `user:${userId}` }), NOW).foodRef).toBe(`user:${userId}`);
    for (const foodRef of ["", "pilece", "shipped:x", "catalogue:Pilece", "catalogue:"]) {
      expect(() => meals.addItem(chicken({ foodRef }), NOW)).toThrow(FitMealValidationError);
    }
  });

  it("refuses a slot outside the five", () => {
    const meals = store();
    expect(() => meals.addItem(chicken({ slot: "brunch" as never }), NOW)).toThrow(
      FitMealValidationError,
    );
  });

  it("refuses a blank label — the item must read with nothing to resolve", () => {
    const meals = store();
    expect(() => meals.addItem(chicken({ label: "  " }), NOW)).toThrow(FitMealValidationError);
  });

  it("refuses a non-positive, non-finite or absurd gram weight", () => {
    const meals = store();
    for (const grams of [0, -5, Number.NaN, 10_001]) {
      expect(() => meals.addItem(chicken({ grams }), NOW)).toThrow(FitMealValidationError);
    }
  });

  it("accepts a fractional gram weight", () => {
    const meals = store();
    expect(meals.addItem(chicken({ grams: 87.5 }), NOW).grams).toBe(87.5);
  });

  it("refuses a snapshot carrying a negative or non-finite nutrient", () => {
    const meals = store();
    expect(() => meals.addItem(chicken({ per100g: { ...CHICKEN, fat: -1 } }), NOW)).toThrow(
      FitMealValidationError,
    );
    expect(() => meals.addItem(chicken({ per100g: { ...CHICKEN, kcal: Number.NaN } }), NOW)).toThrow(
      FitMealValidationError,
    );
  });

  it("refuses a day that is not a real calendar day", () => {
    const meals = store();
    for (const date of ["2026-02-30", "01-08-2026", "2026-8-1"]) {
      expect(() => meals.addItem(chicken({ date }), NOW)).toThrow(FitMealValidationError);
    }
  });
});

describe("FitMealStore.listDay", () => {
  it("groups into all five slots, empty ones included", () => {
    const meals = store();
    meals.addItem(chicken(), NOW);
    meals.addItem(chicken({ slot: "dorucak", label: "Jaje", foodRef: "catalogue:jaje-celo-sirovo" }), NOW);

    const day = meals.listDay(DAY);
    expect(Object.keys(day)).toEqual(["dorucak", "uzina1", "rucak", "uzina2", "vecera"]);
    expect(day.dorucak.map((i) => i.label)).toEqual(["Jaje"]);
    expect(day.uzina1).toEqual([]);
    expect(day.rucak.map((i) => i.label)).toEqual(["Pileće belo meso, pečeno"]);
  });

  it("keeps a slot in the order things were logged, by `created_at` rather than by id", () => {
    const meals = store();
    // Added LATER first, so a read that leaned on `uuidv7` ordering would put
    // them the wrong way round — and `uuidv7`'s sub-millisecond bits are random
    // anyway (`ids.ts`), which is exactly why the order is `created_at`'s.
    const second = meals.addItem(chicken({ label: "Drugo" }), LATER);
    const first = meals.addItem(chicken({ label: "Prvo" }), NOW);
    expect(meals.listDay(DAY).rucak.map((i) => i.id)).toEqual([first.id, second.id]);
  });

  it("answers only for the day asked about, and only for this profile", () => {
    const meals = store();
    const theirs = new FitMealStore(db.raw, createProfile());
    meals.addItem(chicken(), NOW);
    expect(meals.listDay(NEXT_DAY).rucak).toEqual([]);
    expect(theirs.listDay(DAY).rucak).toEqual([]);
  });
});

describe("FitMealStore.dayTotals", () => {
  it("scales each item by its own grams and adds them up", () => {
    const meals = store();
    meals.addItem(chicken({ grams: 200 }), NOW);
    meals.addItem(
      chicken({ slot: "rucak", grams: 150, label: "Pirinač", foodRef: "catalogue:pirinac-beli-kuvan", per100g: RICE }),
      NOW,
    );

    const totals = meals.dayTotals(DAY);
    // 165·2 + 130·1.5 = 330 + 195
    expect(totals.kcal).toBeCloseTo(525, 6);
    // 31·2 + 2.69·1.5 = 62 + 4.035
    expect(totals.protein).toBeCloseTo(66.035, 6);
    // 0 + 28.2·1.5
    expect(totals.carbs).toBeCloseTo(42.3, 6);
    expect(totals.sodiumMg).toBeCloseTo(149.5, 6);
  });

  it("answers zero of everything for a day with nothing logged", () => {
    expect(store().dayTotals(DAY)).toEqual({
      kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodiumMg: 0,
    });
  });
});

describe("FitMealStore.rangeTotals", () => {
  it("answers one total per day with anything logged, oldest first", () => {
    const meals = store();
    meals.addItem(chicken({ date: NEXT_DAY, grams: 100 }), NOW);
    meals.addItem(chicken({ date: DAY, grams: 200 }), NOW);

    const totals = meals.rangeTotals({ from: DAY, to: NEXT_DAY });
    expect(totals.map((entry) => entry.day)).toEqual([DAY, NEXT_DAY]);
    expect(totals[0]?.totals.kcal).toBeCloseTo(330, 6);
    expect(totals[1]?.totals.kcal).toBeCloseTo(165, 6);
  });

  it("OMITS days with nothing logged rather than reporting them as zero", () => {
    const meals = store();
    meals.addItem(chicken(), NOW);
    // „nisam jeo" and „nisam upisao" are different facts; the store knows only
    // the second, so it says nothing about the gap.
    expect(meals.rangeTotals({ from: DAY, to: "2026-08-05" }).map((e) => e.day)).toEqual([DAY]);
  });

  it("refuses a backwards or over-long range", () => {
    const meals = store();
    expect(() => meals.rangeTotals({ from: NEXT_DAY, to: DAY })).toThrow(FitMealValidationError);
    expect(() => meals.rangeTotals({ from: "2020-01-01", to: "2026-01-01" })).toThrow(
      FitMealValidationError,
    );
  });
});

describe("FitMealStore.listAll", () => {
  it("answers every live item, oldest day first, with no day bound at all", () => {
    const meals = store();
    const later = meals.addItem(chicken({ date: "2028-01-01" }), NOW);
    const earlier = meals.addItem(chicken({ date: "1990-01-01" }), NOW);
    const middle = meals.addItem(chicken({ date: DAY }), NOW);
    // Three different DAYS, so the day column alone decides — the `created_at`
    // tiebreak below it never comes into play here.

    // A range read would refuse this span (`MAX_MEAL_RANGE_DAYS`); the export's
    // read must not, or a backup would silently truncate somebody's history.
    expect(meals.listAll().map((i) => i.id)).toEqual([earlier.id, middle.id, later.id]);
  });

  it("omits removed items and never crosses profiles", () => {
    const meals = store();
    const theirs = new FitMealStore(db.raw, createProfile());
    const item = meals.addItem(chicken(), NOW);
    meals.removeItem(item.id, LATER);
    expect(meals.listAll()).toEqual([]);
    expect(theirs.listAll()).toEqual([]);
  });
});

describe("FitMealStore.updateItem", () => {
  it("corrects grams and slot and leaves the snapshot untouched", () => {
    const meals = store();
    const item = meals.addItem(chicken(), NOW);

    const updated = meals.updateItem(item.id, { grams: 150, slot: "vecera" }, LATER);
    expect(updated).toMatchObject({
      grams: 150,
      slot: "vecera",
      per100g: CHICKEN,
      label: "Pileće belo meso, pečeno",
      createdAt: NOW,
      updatedAt: LATER,
    });
    expect(meals.listDay(DAY).rucak).toEqual([]);
    expect(meals.listDay(DAY).vecera).toEqual([updated]);
  });

  it("refuses a bad grams or slot without touching the row", () => {
    const meals = store();
    const item = meals.addItem(chicken(), NOW);
    expect(() => meals.updateItem(item.id, { grams: 0 }, LATER)).toThrow(FitMealValidationError);
    expect(() => meals.updateItem(item.id, { slot: "brunch" as never }, LATER)).toThrow(
      FitMealValidationError,
    );
    expect(meals.listDay(DAY).rucak[0]?.grams).toBe(200);
  });

  it("refuses an unknown, removed or foreign item", () => {
    const meals = store();
    const theirs = new FitMealStore(db.raw, createProfile());
    const item = meals.addItem(chicken(), NOW);

    expect(() => meals.updateItem(uuidv7(), { grams: 10 }, LATER)).toThrow(FitMealItemNotFoundError);
    expect(() => theirs.updateItem(item.id, { grams: 10 }, LATER)).toThrow(FitMealItemNotFoundError);
    meals.removeItem(item.id, LATER);
    expect(() => meals.updateItem(item.id, { grams: 10 }, LATER)).toThrow(FitMealItemNotFoundError);
  });
});

describe("FitMealStore.removeItem / restoreItem", () => {
  it("takes an item out of the day and its totals, then puts it back exactly", () => {
    const meals = store();
    const item = meals.addItem(chicken(), NOW);

    meals.removeItem(item.id, LATER);
    expect(meals.listDay(DAY).rucak).toEqual([]);
    expect(meals.dayTotals(DAY).kcal).toBe(0);

    meals.restoreItem(item.id, LATER);
    expect(meals.listDay(DAY).rucak.map((i) => i.id)).toEqual([item.id]);
    expect(meals.listDay(DAY).rucak[0]?.per100g).toEqual(CHICKEN);
  });

  it("refuses to remove twice or restore what is not removed", () => {
    const meals = store();
    const item = meals.addItem(chicken(), NOW);
    expect(() => meals.restoreItem(item.id, LATER)).toThrow(FitMealItemNotFoundError);
    meals.removeItem(item.id, LATER);
    expect(() => meals.removeItem(item.id, LATER)).toThrow(FitMealItemNotFoundError);
  });
});

describe("the snapshot", () => {
  it("survives the food it came from being changed or deleted", () => {
    // The store holds no reference to a food row at all — `food_ref` is text with
    // no foreign key — so an item logged against a user food that later vanishes
    // still reads, and still totals, exactly as it did.
    const meals = store();
    const ghost = uuidv7();
    const item = meals.addItem(chicken({ foodRef: `user:${ghost}`, label: "Mamin ajvar" }), NOW);

    expect(meals.listDay(DAY).rucak[0]).toMatchObject({
      foodRef: `user:${ghost}`,
      label: "Mamin ajvar",
      per100g: CHICKEN,
    });
    expect(meals.dayTotals(DAY).kcal).toBeCloseTo(330, 6);
    expect(item.per100g).toEqual(CHICKEN);
  });
});
