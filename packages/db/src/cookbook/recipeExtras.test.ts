import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_FOOD_MATCHES,
  NexusDatabase,
  RecipeStore,
  foldIngredientName,
  openDatabase,
  uuidv7,
} from "../index.js";
import type { CreateRecipeInput } from "../index.js";

/**
 * The COOKBOOK's stage-2 store additions: the raw line the author typed, the
 * module's one preference, the remembered ingredient links, the blob accounting
 * main's GC union reads, and the identity rule an archive write follows.
 *
 * One encrypted database for the file, emptied between cases — `DELETE FROM
 * profiles` cascades into every cookbook table through migration 076's own
 * foreign keys, so a case costs a row rather than eighty-three migrations.
 */

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:00:00.000Z";

const PHOTO = {
  fileName: "sarma.jpg",
  mime: "image/jpeg",
  sizeBytes: 40_112,
  sha256: "a".repeat(64),
};

let dir: string;
let db: NexusDatabase;

function createProfile(name: string): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, NOW);
  return id;
}

function recipe(fields: Partial<CreateRecipeInput> = {}): CreateRecipeInput {
  return {
    title: "Sarma",
    course: "main",
    servings: 4,
    ingredients: [
      {
        name: "kupus",
        rawText: "1 glavica kupusa",
        quantity: 1,
        unit: "head",
      },
    ],
    steps: [{ text: "Kuvati.", timerMinutes: 90 }],
    source: "own",
    ...fields,
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-cookbook-extras-"));
  db = openDatabase({ path: join(dir, "cookbook.db") });
});

beforeEach(() => {
  db.raw.exec("DELETE FROM profiles");
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the raw line", () => {
  it("is stored beside the parsed fields and travels in the archive", () => {
    const profileId = createProfile("A");
    const store = new RecipeStore(db.raw, profileId);
    const created = store.create(
      recipe({
        ingredients: [
          {
            name: "maslinovo ulje",
            rawText: "2–3 kašike maslinovog ulja, po potrebi",
            quantity: 2,
            quantityMax: 3,
            unit: "tbsp",
            preparation: "po potrebi",
          },
        ],
      }),
      NOW,
    );

    expect(created.ingredients[0]).toMatchObject({
      rawText: "2–3 kašike maslinovog ulja, po potrebi",
      name: "maslinovo ulje",
      quantity: 2,
      quantityMax: 3,
      unit: "tbsp",
      preparation: "po potrebi",
    });
    expect(store.exportData().recipes[0]?.ingredients[0]?.rawText).toBe(
      "2–3 kašike maslinovog ulja, po potrebi",
    );
  });

  it("refuses a line longer than the column holds, and empties rather than stores nothing", () => {
    const store = new RecipeStore(db.raw, createProfile("A"));
    expect(() =>
      store.create(
        recipe({ ingredients: [{ name: "kupus", rawText: "x".repeat(501) }] }),
        NOW,
      ),
    ).toThrow(/rawText/);

    const created = store.create(recipe({ ingredients: [{ name: "kupus" }] }), NOW);
    expect(created.ingredients[0]?.rawText).toBe("");
  });
});

describe("the module's one preference", () => {
  it("answers the shipped default with no stored row, and reads back what was stored", () => {
    const store = new RecipeStore(db.raw, createProfile("A"));
    expect(store.settings()).toEqual({ unitSystem: "metric", updatedAt: null });

    expect(store.setUnitSystem("kitchen", NOW)).toEqual({ unitSystem: "kitchen", updatedAt: NOW });
    expect(store.settings()).toEqual({ unitSystem: "kitchen", updatedAt: NOW });

    expect(store.setUnitSystem("metric", LATER)).toEqual({ unitSystem: "metric", updatedAt: LATER });
  });

  it("refuses a value outside its closed vocabulary, rather than storing a third answer", () => {
    const store = new RecipeStore(db.raw, createProfile("A"));
    expect(() => store.setUnitSystem("imperial" as never, NOW)).toThrow(/unitSystem/);
  });
});

describe("the remembered ingredient links", () => {
  it("keys a link by the FOLDED name and keeps the spelling the user first used", () => {
    const store = new RecipeStore(db.raw, createProfile("A"));
    const match = store.setFoodMatch(
      { name: "Mleveno meso", foodRef: { kind: "catalogue", id: "mleveno-meso" }, foodName: "Mleveno meso" },
      NOW,
    );

    expect(match).toEqual({
      name: "Mleveno meso",
      nameKey: foldIngredientName("Mleveno meso"),
      foodRef: { kind: "catalogue", id: "mleveno-meso" },
      foodName: "Mleveno meso",
      gramsPerUnit: null,
      createdAt: NOW,
      updatedAt: NOW,
    });

    // A second spelling of one name REPLACES the first answer rather than
    // adding a second row that disagrees with it.
    store.setFoodMatch(
      {
        name: "mleveno meso",
        foodRef: { kind: "catalogue", id: "mleveno-meso" },
        foodName: "Mleveno meso",
        gramsPerUnit: 15,
      },
      LATER,
    );
    const matches = store.listFoodMatches();
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ name: "mleveno meso", gramsPerUnit: 15, updatedAt: LATER });

    expect(store.clearFoodMatch("MLEVENO MESO")).toBe(true);
    expect(store.clearFoodMatch("mleveno meso")).toBe(false);
    expect(store.listFoodMatches()).toEqual([]);
  });

  it("refuses a link with nothing to point at, and a weight with no meaning", () => {
    const store = new RecipeStore(db.raw, createProfile("A"));
    expect(() =>
      store.setFoodMatch(
        { name: "so", foodRef: null as never, foodName: "So" },
        NOW,
      ),
    ).toThrow(/must name a food/);
    expect(() =>
      store.setFoodMatch(
        {
          name: "so",
          foodRef: { kind: "catalogue", id: "so" },
          foodName: "So",
          gramsPerUnit: 10_001,
        },
        NOW,
      ),
    ).toThrow(/gramsPerUnit/);
  });

  it("holds at most its own cap of links, replacing one it already has", () => {
    const store = new RecipeStore(db.raw, createProfile("A"));
    for (let index = 0; index < MAX_FOOD_MATCHES; index += 1) {
      store.setFoodMatch(
        {
          name: `namirnica ${String(index)}`,
          foodRef: { kind: "catalogue", id: "so" },
          foodName: "So",
        },
        NOW,
      );
    }
    expect(store.listFoodMatches()).toHaveLength(MAX_FOOD_MATCHES);
    expect(() =>
      store.setFoodMatch(
        { name: "jedna više", foodRef: { kind: "catalogue", id: "so" }, foodName: "So" },
        NOW,
      ),
    ).toThrow(/at most 500/);
    // Replacing one of the five hundred is not adding one.
    expect(() =>
      store.setFoodMatch(
        { name: "namirnica 0", foodRef: { kind: "catalogue", id: "kupus" }, foodName: "Kupus" },
        NOW,
      ),
    ).not.toThrow();
  });
});

describe("the blob accounting main sums", () => {
  it("counts a hash across every profile, and names the mime one of them registered", () => {
    const first = new RecipeStore(db.raw, createProfile("A"));
    const second = new RecipeStore(db.raw, createProfile("B"));
    first.create(recipe({ photo: PHOTO, title: "Sarma A" }), NOW);
    const other = { ...PHOTO, fileName: "sarma-2.jpg", sha256: "b".repeat(64) };
    second.create(recipe({ photo: other, title: "Sarma B" }), NOW);
    // A second row naming the FIRST hash, in the other profile: the store is
    // content-addressed across the whole database, so the count is too.
    second.create(recipe({ photo: PHOTO, title: "Sarma B2" }), NOW);

    expect(first.refCount(PHOTO.sha256)).toBe(2);
    expect(second.refCount(PHOTO.sha256)).toBe(2);
    expect(first.mimeForHash(PHOTO.sha256)).toBe("image/jpeg");
    expect(first.refCount("c".repeat(64))).toBe(0);
    expect(first.mimeForHash("c".repeat(64))).toBeNull();
  });
});

describe("restoring one profile's archive into another", () => {
  it("re-mints the ids the target profile already holds, and keeps them when it holds none", () => {
    const source = new RecipeStore(db.raw, createProfile("A"));
    const creation = source.create(recipe(), NOW);
    const archive = source.exportData();

    // Into the SAME profile: the ids travel, because the rows they name were
    // just deleted and the archive is what reproduces them.
    source.importData(archive);
    expect(source.list()[0]?.id).toBe(creation.id);

    // Into a second profile of the same device, which holds its own recipe under
    // an id of its own: the archived ids are global primary keys, so the ones
    // this profile does not hold travel and the ones it does are re-minted.
    const target = new RecipeStore(db.raw, createProfile("B"));
    const own = target.create(recipe({ title: "Sarma B" }), NOW);
    target.importData(archive);

    const restored = target.list();
    expect(restored.map((entry) => entry.title)).toEqual(["Sarma"]);
    expect(restored[0]?.id).not.toBe(creation.id);
    expect(restored[0]?.id).not.toBe(own.id);
    // The children follow their recipe: a re-minted recipe never keeps an
    // ingredient id that would point at another profile's row.
    expect(restored[0]?.ingredients[0]?.recipeId).toBe(restored[0]?.id);
    expect(restored[0]?.ingredients[0]?.rawText).toBe("1 glavica kupusa");
    expect(restored[0]?.steps[0]?.timerMinutes).toBe(90);
    // And the profile the archive came FROM is untouched: a replace is scoped to
    // the profile being restored, and re-minting is what keeps the two rows —
    // one per profile — from being one row.
    expect(source.list().map((entry) => entry.id)).toEqual([creation.id]);
  });

  it("carries the preference and the links, and empties both when the archive has neither", () => {
    const source = new RecipeStore(db.raw, createProfile("A"));
    source.setUnitSystem("kitchen", NOW);
    source.setFoodMatch(
      { name: "so", foodRef: { kind: "catalogue", id: "so" }, foodName: "So", gramsPerUnit: 5 },
      NOW,
    );

    const target = new RecipeStore(db.raw, createProfile("B"));
    target.importData(source.exportData());
    expect(target.settings().unitSystem).toBe("kitchen");
    expect(target.listFoodMatches()).toHaveLength(1);

    // An archive whose preference is the shipped default deletes the row rather
    // than writing the default into it: the profile then reads exactly what a
    // profile that never opened the card reads.
    target.importData({
      version: 1,
      recipes: [],
      settings: { unitSystem: "metric", updatedAt: null },
      foodMatches: [],
    });
    expect(target.settings()).toEqual({ unitSystem: "metric", updatedAt: null });
    expect(target.listFoodMatches()).toEqual([]);
  });
});
