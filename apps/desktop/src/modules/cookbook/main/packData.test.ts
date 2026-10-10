import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseManifest, entry, makeKey, writePack } from "../../../main/packs/fixtures.js";
import type { PackManifest } from "../../../main/packs/manifest.js";
import {
  DATASET_LAYOUT_VERSION,
  datasetFile,
  installedDatasets,
  loadFoodsPacks,
  loadRecipesPacks,
  parseFoodsLayout,
  parseRecipesLayout,
  readDatasetJson,
  searchPackRecipes,
} from "./packData.js";

/**
 * The COOKBOOK's two pack readers (ADR-091's content, the module's own formats).
 *
 * Every fixture below is a REAL signed pack folder written by the same helper
 * the Packs card's own tests use — `makeKey`/`writePack` — because that is what
 * makes „this build reads an installed pack" a property rather than a claim:
 * the pack is discovered through `main/packs/registry.ts`, so a folder that
 * verifies for the Packs card verifies here too, and one whose signature does
 * not verify is invisible to both.
 */

const key = makeKey();
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nexus-cookbook-packs-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Installs one signed `dataset` pack at `<root>/packs/<id>/1.0.0`. */
function install(id: string, contents: Record<string, string>, overrides: Record<string, unknown> = {}): void {
  const files = Object.entries(contents).map(([path, text]) => entry(path, text));
  writePack({
    dir: join(root, "packs", id, "1.0.0"),
    key: key.privateKey,
    manifest: baseManifest(files, {
      id,
      version: "1.0.0",
      kind: "dataset",
      title: { sr: "Kuhinja", en: "Cuisine" },
      description: { sr: "Recepti.", en: "Recipes." },
      source: { name: "Wikibooks", url: "https://en.wikibooks.org/" },
      ...overrides,
    }),
    contents,
  });
}

const RECIPES = JSON.stringify({
  layout: DATASET_LAYOUT_VERSION,
  recipes: [
    {
      id: "sarma",
      title: "Sarma",
      language: "sr",
      servings: 6,
      ingredients: ["1 glavica kupusa", "500 g mlevenog mesa", "2 kašike pirinča"],
      steps: ["Propržiti luk.", "Urolati i kuvati 90 minuta."],
      tags: ["zima", "svinjetina"],
      source: {
        title: "Sarma iz Vojvodine",
        url: "https://example.org/sarma",
        licence: "CC-BY-SA-4.0",
        attribution: "Neki Autor, „Sarma iz Vojvodine“, CC BY-SA 4.0",
      },
    },
    {
      id: "socivo",
      title: "Socivo",
      language: "sr",
      ingredients: ["300 g sociva"],
      steps: ["Kuvati."],
      tags: ["vegan"],
      source: {
        title: "Socivo",
        url: "https://example.org/socivo",
        licence: "public-domain",
        attribution: "Javno dobro",
      },
    },
  ],
});

const FOODS = JSON.stringify({
  layout: DATASET_LAYOUT_VERSION,
  foods: [
    {
      id: "piletina-prsa",
      name: { sr: "Piletina, prsa", en: "Chicken, breast" },
      per100g: {
        energyKcal: 120,
        proteinG: 22.5,
        fatG: 2.6,
        carbsG: 0,
        fibreG: 0,
        sugarsG: 0,
        saltG: 0.15,
      },
    },
    {
      id: "so",
      name: { en: "Salt" },
      per100g: { energyKcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
    },
  ],
});

describe("parseRecipesLayout", () => {
  it("reads a layout-1 document into the module's own entries", () => {
    const recipes = parseRecipesLayout(JSON.parse(RECIPES), "wikibooks");

    expect(recipes).toHaveLength(2);
    expect(recipes[0]).toEqual({
      id: "sarma",
      title: "Sarma",
      language: "sr",
      servings: 6,
      ingredients: ["1 glavica kupusa", "500 g mlevenog mesa", "2 kašike pirinča"],
      steps: ["Propržiti luk.", "Urolati i kuvati 90 minuta."],
      tags: ["zima", "svinjetina"],
      source: {
        title: "Sarma iz Vojvodine",
        url: "https://example.org/sarma",
        licence: "CC-BY-SA-4.0",
        attribution: "Neki Autor, „Sarma iz Vojvodine“, CC BY-SA 4.0",
      },
    });
    // A recipe that states no servings answers null rather than a guess.
    expect(recipes[1]?.servings).toBeNull();
  });

  it("refuses a document this build cannot read, naming what is wrong", () => {
    const bad = (recipe: Record<string, unknown>): unknown => ({
      layout: 1,
      recipes: [
        {
          id: "x",
          title: "X",
          language: "sr",
          ingredients: ["1 jaje"],
          steps: ["Kuvati."],
          tags: [],
          source: {
            title: "T",
            url: "https://example.org/x",
            licence: "CC-BY-SA-4.0",
            attribution: "A",
          },
          ...recipe,
        },
      ],
    });

    for (const [what, value, pattern] of [
      ["a later layout", { layout: 2, recipes: [] }, /layout 2/],
      ["no recipes array", { layout: 1 }, /"recipes" must be an array/],
      ["a title that says nothing", bad({ title: "   " }), /"recipes\[0\].title"/],
      ["a licence that is not an identifier", bad({ source: { title: "T", url: "https://e.org", licence: "CC BY SA", attribution: "A" } }), /SPDX/],
      ["a url that is not openable", bad({ source: { title: "T", url: "nexus://x", licence: "MIT", attribution: "A" } }), /http\(s\) url/],
      ["a language that is not a tag", bad({ language: "serbian" }), /language tag/],
      ["zero servings", bad({ servings: 0 }), /between 1 and 100/],
      ["a step longer than the store holds", bad({ steps: ["x".repeat(2001)] }), /steps\[0\]/],
      ["more ingredients than the store holds", bad({ ingredients: Array.from({ length: 101 }, (_, index) => `${String(index)} g x`) }), /at most 100/],
    ] as const) {
      expect(() => parseRecipesLayout(value, "wikibooks"), what).toThrow(pattern);
    }
  });

  it("refuses two recipes under one id rather than letting one shadow the other", () => {
    const value = JSON.parse(RECIPES) as { recipes: unknown[] };
    const first = value.recipes[0];
    value.recipes.push(first);
    expect(() => parseRecipesLayout(value, "wikibooks")).toThrow(/repeats "sarma"/);
  });
});

describe("parseFoodsLayout", () => {
  it("reads a layout-1 document, and derives sodium from salt", () => {
    const foods = parseFoodsLayout(JSON.parse(FOODS), "usda");

    expect(foods[0]).toEqual({
      id: "piletina-prsa",
      nameSr: "Piletina, prsa",
      nameEn: "Chicken, breast",
      per100g: {
        kcal: 120,
        protein: 22.5,
        fat: 2.6,
        carbs: 0,
        fiber: 0,
        sugar: 0,
        // 0.15 g of salt × 393.4 mg of sodium per gram = 59.01 mg.
        sodiumMg: 0.15 * 393.4,
      },
    });
    // The English-only food carries no Serbian name, and every field it does not
    // state is a zero rather than a guess.
    expect(foods[1]).toMatchObject({ id: "so", nameSr: null, per100g: { kcal: 0, sodiumMg: 0 } });
  });

  it("refuses a food the module could never remember a match to", () => {
    const value = {
      layout: 1,
      foods: [{ id: "Piletina", name: { en: "Chicken" }, per100g: { energyKcal: 1, proteinG: 1, fatG: 1, carbsG: 1 } }],
    };
    expect(() => parseFoodsLayout(value, "usda")).toThrow(/kebab-case/);
  });

  it("refuses a number a composition table cannot carry", () => {
    const value = {
      layout: 1,
      foods: [{ id: "x", name: { en: "X" }, per100g: { energyKcal: 1, proteinG: -1, fatG: 1, carbsG: 1 } }],
    };
    expect(() => parseFoodsLayout(value, "usda")).toThrow(/at least 0/);
  });
});

describe("the installed packs", () => {
  it("reads only the dataset packs that carry the file a caller asked for", () => {
    install("wikibooks", { "recipes.json": RECIPES });
    install("usda", { "foods.json": FOODS });
    // A pack of another kind is content this module has no business opening.
    install("wikipedia", { "wiki.zim": "zim" }, { kind: "zim" });
    // And a dataset pack that carries neither file is simply not a source.
    install("maps", { "map.pmtiles": "map" });

    expect(installedDatasets(root, key.publicKeyPem).map((pack) => pack.manifest.id)).toEqual([
      "maps",
      "usda",
      "wikibooks",
    ]);
    expect(loadRecipesPacks(root, key.publicKeyPem).map((pack) => pack.manifest.id)).toEqual([
      "wikibooks",
    ]);
    expect(loadFoodsPacks(root, key.publicKeyPem).map((pack) => pack.manifest.id)).toEqual(["usda"]);
  });

  it("sees nothing at all when no pack is installed, which is not a failure", () => {
    expect(loadRecipesPacks(root, key.publicKeyPem)).toEqual([]);
    expect(loadFoodsPacks(root, key.publicKeyPem)).toEqual([]);
  });

  it("prefers the file the pack wrote for this app over one it vendored", () => {
    const manifest = baseManifest([
      entry("vendor/foods.json", "{}"),
      entry("foods.json", "{}"),
      entry("data/deep/foods.json", "{}"),
    ]);
    // `baseManifest` answers a plain record so a test can break any field; the
    // reader only reads `files`, so the cast is the fixture's own looseness.
    expect(datasetFile(manifest as unknown as PackManifest, "foods.json")).toBe("foods.json");
  });

  it("refuses to open a path outside the pack, even one a caller hands it directly", () => {
    expect(() => readDatasetJson(root, "../foods.json", "usda")).toThrow(/will not open/);
    expect(() => readDatasetJson(root, "C:/foods.json", "usda")).toThrow(/will not open/);
  });
});

describe("searchPackRecipes", () => {
  const recipes = parseRecipesLayout(JSON.parse(RECIPES), "wikibooks");

  it("finds a recipe by its title, its tag and its ingredients", () => {
    expect(searchPackRecipes(recipes, "sarma", 10).map((recipe) => recipe.id)).toEqual(["sarma"]);
    expect(searchPackRecipes(recipes, "vegan", 10).map((recipe) => recipe.id)).toEqual(["socivo"]);
    // The question a corpus of foreign recipes is opened to answer: what can I
    // make with what is in the fridge.
    expect(searchPackRecipes(recipes, "kupusa", 10).map((recipe) => recipe.id)).toEqual(["sarma"]);
  });

  it("ranks a title above a tag above an ingredient", () => {
    const ranked = searchPackRecipes(
      [
        { ...recipes[0]!, id: "ingredient", title: "Drugo", tags: [], ingredients: ["1 socivo"] },
        { ...recipes[0]!, id: "tag", title: "Drugo", tags: ["socivo"], ingredients: [] },
        { ...recipes[0]!, id: "title", title: "Socivo", tags: [], ingredients: [] },
      ],
      "socivo",
      10,
    );
    expect(ranked.map((recipe) => recipe.id)).toEqual(["title", "tag", "ingredient"]);
  });

  it("answers an empty query with the corpus' first page, in title order", () => {
    expect(searchPackRecipes(recipes, "", 1).map((recipe) => recipe.id)).toEqual(["sarma"]);
    expect(searchPackRecipes(recipes, "   ", 10).map((recipe) => recipe.id)).toEqual([
      "sarma",
      "socivo",
    ]);
  });
});
