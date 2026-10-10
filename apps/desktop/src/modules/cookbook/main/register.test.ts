import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { baseManifest, entry, makeKey, writePack } from "../../../main/packs/fixtures.js";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import type { CookbookView, NutritionView, RecipeView } from "../shared/ipc.js";
import { configureCookbook, register, type CookbookHost } from "./register.js";

/**
 * The COOKBOOK module through the kit (ADR-090): its ops, the two pack readers
 * behind them, the photo it asks main to store, and its archive section.
 *
 * Everything here is the real thing: a real encrypted database with the real
 * migrations, the real store, real signed pack folders written by the Packs
 * card's own fixture builder, and the host the app itself dispatches through.
 * Only two things are fakes, and each is a thing a test cannot have: the clock
 * (moved by hand) and the photo host (a native dialog and an encrypted blob
 * write, both of which belong to `main/index.ts`).
 */

const TRUSTED = { trusted: true };

const key = makeKey();
const PHOTO = {
  fileName: "sarma.jpg",
  mime: "image/jpeg",
  sizeBytes: 40_112,
  sha256: "a".repeat(64),
};

let dir: string;
let packsRoot: string;
let db: NexusDatabase;

interface Harness {
  readonly host: ModuleHost;
  readonly toasts: { title: string; body: string }[];
  /** Every photo the module asked main to store, and every hash it asked to release. */
  readonly photos: { picked: number; released: string[] };
  /** Every awake request main was given, in order. */
  readonly awake: boolean[];
  readonly sessionEnd: () => void;
}

function harness(options: { photo?: typeof PHOTO | null; packs?: boolean } = {}): Harness {
  const toasts: Harness["toasts"] = [];
  const photos = { picked: 0, released: [] as string[] };
  const awake: boolean[] = [];
  const host: CookbookHost = {
    pickPhoto: async () => {
      photos.picked += 1;
      return options.photo ?? null;
    },
    releasePhoto: (_profileId, sha256) => {
      photos.released.push(sha256);
    },
    setAwake: (on) => {
      awake.push(on);
    },
  };
  configureCookbook({
    userData: options.packs === false ? join(dir, "no-packs") : packsRoot,
    packsPublicKeyPem: key.publicKeyPem,
    host,
  });

  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    notify: ({ title, body }) => toasts.push({ title, body }),
    schedule: () => () => undefined,
    now: () => Date.parse("2026-06-01T08:00:00.000Z"),
  };
  const moduleHost = new ModuleHost(platform);
  register(moduleHost);
  return {
    host: moduleHost,
    toasts,
    photos,
    awake,
    sessionEnd: () => moduleHost.sessionEnd(),
  };
}

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", "2026-06-01T08:00:00.000Z");
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

/** One ingredient line as the editor hands it over. */
function ingredient(
  name: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    rawText: name,
    quantity: null,
    quantityMax: null,
    unit: null,
    name,
    preparation: null,
    group: null,
    foodRef: null,
    gramsPerUnit: null,
    ...fields,
  };
}

/** A recipe draft that is valid on its own, so a case can change exactly one thing about it. */
function draft(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Sarma",
    description: "",
    cuisine: "",
    course: "main",
    servings: 4,
    prepMinutes: null,
    cookMinutes: null,
    ingredients: [
      ingredient("kupus", { rawText: "1 glavica kupusa", quantity: 1, unit: "head" }),
      ingredient("mleveno meso", { rawText: "500 g mlevenog mesa", quantity: 500, unit: "g" }),
    ],
    steps: [{ text: "Urolati i kuvati.", timerMinutes: 90 }],
    tags: ["zima"],
    rating: null,
    notes: "",
    favourite: false,
    ...fields,
  };
}

const RECIPES = JSON.stringify({
  layout: 1,
  recipes: [
    {
      id: "sarma",
      title: "Sarma iz paketa",
      language: "sr",
      servings: 6,
      ingredients: ["1 glavica kupusa", "500 g mlevenog mesa"],
      steps: ["Propržiti luk.", "Urolati i kuvati 90 minuta."],
      tags: ["zima"],
      source: {
        title: "Sarma iz Vojvodine",
        url: "https://example.org/sarma",
        licence: "CC-BY-SA-4.0",
        attribution: "Neki Autor, „Sarma iz Vojvodine“, CC BY-SA 4.0",
      },
    },
  ],
});

const FOODS = JSON.stringify({
  layout: 1,
  foods: [
    {
      id: "mleveno-meso",
      name: { sr: "Mleveno meso", en: "Minced meat" },
      // 100 kcal and 20 g of protein per 100 g, so 500 g is 500 kcal and 100 g
      // of protein for the dish — the hand calculation the cases below check.
      per100g: { energyKcal: 100, proteinG: 20, fatG: 5, carbsG: 0 },
    },
    {
      id: "kupus",
      name: { sr: "Kupus", en: "Cabbage" },
      per100g: { energyKcal: 25, proteinG: 1.3, fatG: 0.1, carbsG: 5.8 },
    },
  ],
});

function installPack(
  id: string,
  contents: Record<string, string>,
  overrides: Record<string, unknown> = {},
): void {
  const files = Object.entries(contents).map(([path, text]) => entry(path, text));
  writePack({
    dir: join(packsRoot, "packs", id, "1.0.0"),
    key: key.privateKey,
    manifest: baseManifest(files, {
      id,
      version: "1.0.0",
      kind: "dataset",
      title: { sr: "Srpska kuhinja", en: "Serbian cuisine" },
      description: { sr: "Recepti.", en: "Recipes." },
      source: { name: "Wikibooks", url: "https://en.wikibooks.org/" },
      ...overrides,
    }),
    contents,
  });
}

/**
 * ONE database for the file, emptied between cases.
 *
 * Opening one costs every migration (there are eighty-three), and a case here
 * needs a profile rather than a database: `DELETE FROM profiles` cascades into
 * every cookbook table through migration 076's own foreign keys, which is
 * exactly the cleanup a fresh file would give. The pack folders are rebuilt per
 * case because a case may install a different one.
 */
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-cookbook-module-"));
  db = openDatabase({ path: join(dir, "cookbook.db") });
});

beforeEach(() => {
  packsRoot = join(dir, `user-${String(Math.random()).slice(2, 10)}`);
  db.raw.exec("DELETE FROM profiles");
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the cookbook handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    expect(harness().host.channels()).toEqual([
      "cookbook:list",
      "cookbook:get",
      "cookbook:create",
      "cookbook:update",
      "cookbook:remove",
      "cookbook:setUnitSystem",
      "cookbook:search",
      "cookbook:listRecipesPacks",
      "cookbook:browsePack",
      "cookbook:getPackRecipe",
      "cookbook:savePackRecipe",
      "cookbook:listFoodsPacks",
      "cookbook:suggestFoods",
      "cookbook:setFoodMatch",
      "cookbook:clearFoodMatch",
      "cookbook:nutrition",
      "cookbook:setAwake",
      "cookbook:attachPhoto",
      "cookbook:removePhoto",
    ]);
  });

  it("answers a read with the rows, the tags in use and the module's preference", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await call(host, "cookbook:create", { profileId, recipe: draft() });
    await call(host, "cookbook:create", {
      profileId,
      recipe: draft({ title: "Socivo", tags: ["vegan", "Zima"] }),
    });

    const view = await call<CookbookView>(host, "cookbook:list", { profileId });

    expect(view.recipes.map((recipe) => recipe.title)).toEqual(["Sarma", "Socivo"]);
    expect(view.settings).toEqual({ unitSystem: "metric", updatedAt: null });
    // „Zima" and „zima" are one tag to a person, so the filter offers one.
    expect(view.tags).toEqual(["vegan", "zima"]);
    expect(view.foodMatches).toEqual([]);
  });

  it("refuses a payload the wire should never carry, before the store sees it", async () => {
    const { host } = harness();
    const profileId = createProfile();

    await expect(
      call(host, "cookbook:create", { profileId, recipe: draft({ title: "" }) }),
    ).rejects.toThrow(/must be a non-empty string/);
    await expect(
      call(host, "cookbook:create", { profileId, recipe: draft({ servings: 0 }) }),
    ).rejects.toThrow(/between 1 and 100/);
    await expect(
      call(host, "cookbook:create", { profileId, recipe: draft({ ingredients: "kupus" }) }),
    ).rejects.toThrow(/"ingredients" must be an array/);
    await expect(call(host, "cookbook:get", { profileId, id: "  padded  " })).rejects.toThrow(
      /not a well-formed id/,
    );
    // A food reference that could never resolve is refused as one, not stored.
    await expect(
      call(host, "cookbook:create", {
        profileId,
        recipe: draft({
          ingredients: [ingredient("kupus", { foodRef: { kind: "shop", id: "x" } })],
        }),
      }),
    ).rejects.toThrow(/food reference/);
  });
});

describe("the recipes this profile wrote", () => {
  it("creates, patches and removes a recipe, and the list follows every time", async () => {
    const { host } = harness();
    const profileId = createProfile();

    const created = await call<{ view: CookbookView; recipeId: string }>(host, "cookbook:create", {
      profileId,
      recipe: draft(),
    });
    expect(created.view.recipes.map((recipe) => recipe.title)).toEqual(["Sarma"]);

    // A patch changes what it names and nothing else: the ingredients are not
    // sent, so they are not replaced.
    await call(host, "cookbook:update", {
      profileId,
      id: created.recipeId,
      patch: { servings: 6, favourite: true },
    });
    const patched = await call<RecipeView>(host, "cookbook:get", {
      profileId,
      id: created.recipeId,
    });
    expect(patched.servings).toBe(6);
    expect(patched.favourite).toBe(true);
    expect(patched.ingredients).toHaveLength(2);

    const removed = await call<CookbookView>(host, "cookbook:remove", {
      profileId,
      id: created.recipeId,
    });
    expect(removed.recipes).toEqual([]);
  });

  it("keeps the line the author typed beside the fields the parser filled", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const created = await call<{ recipeId: string }>(host, "cookbook:create", {
      profileId,
      recipe: draft(),
    });

    const recipe = await call<RecipeView>(host, "cookbook:get", {
      profileId,
      id: created.recipeId,
    });

    expect(recipe.ingredients[0]).toMatchObject({
      rawText: "1 glavica kupusa",
      name: "kupus",
      quantity: 1,
      unit: "head",
    });
    expect(recipe.steps[0]).toMatchObject({ text: "Urolati i kuvati.", timerMinutes: 90 });
  });

  it("finds a recipe by its title and by its ingredients, best match first", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await call(host, "cookbook:create", { profileId, recipe: draft() });
    await call(host, "cookbook:create", {
      profileId,
      recipe: draft({
        title: "Kupus salata",
        ingredients: [ingredient("kupus", { rawText: "1 glavica kupusa", quantity: 1, unit: "head" })],
        steps: [{ text: "Iseći.", timerMinutes: null }],
      }),
    });

    // „kupus" is one title's prefix and the other recipe's ingredient name, so
    // the title comes first — and an empty box answers nothing at all.
    const found = await call<{ title: string }[]>(host, "cookbook:search", {
      profileId,
      query: "kupus",
    });
    expect(found.map((hit) => hit.title)).toEqual(["Kupus salata", "Sarma"]);
    expect(await call(host, "cookbook:search", { profileId, query: "  " })).toEqual([]);
  });
});

describe("the world's cuisines", () => {
  it("lists an installed pack, browses it, and copies a recipe that KEEPS its licence", async () => {
    installPack("wikibooks", { "recipes.json": RECIPES });
    const { host } = harness();
    const profileId = createProfile();

    const packs = await call<{ id: string; recipeCount: number; title: { sr: string } }[]>(
      host,
      "cookbook:listRecipesPacks",
      { profileId },
    );
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({
      id: "wikibooks",
      recipeCount: 1,
      title: { sr: "Srpska kuhinja" },
    });

    const hits = await call<{ id: string }[]>(host, "cookbook:browsePack", {
      profileId,
      packId: "wikibooks",
      query: "mlevenog",
    });
    expect(hits.map((hit) => hit.id)).toEqual(["sarma"]);

    const saved = await call<{ view: CookbookView; recipeId: string }>(
      host,
      "cookbook:savePackRecipe",
      { profileId, packId: "wikibooks", id: "sarma" },
    );
    expect(saved.view.recipes).toHaveLength(1);

    const copy = await call<RecipeView>(host, "cookbook:get", {
      profileId,
      id: saved.recipeId,
    });
    expect(copy.source).toBe("imported");
    // The facts the acceptance turns on: the licence travels whole, the author
    // is the pack manifest's own source name (the layout's `source` object names
    // no author), and the raw lines are the pack's lines.
    expect(copy.licence).toEqual({
      title: "Sarma iz Vojvodine",
      author: "Wikibooks",
      url: "https://example.org/sarma",
      licenceId: "CC-BY-SA-4.0",
      attribution: "Neki Autor, „Sarma iz Vojvodine“, CC BY-SA 4.0",
    });
    expect(copy.ingredients.map((line) => line.rawText)).toEqual([
      "1 glavica kupusa",
      "500 g mlevenog mesa",
    ]);
    expect(copy.servings).toBe(6);

    // And an edit does not cost the attribution: the columns are unreachable
    // from an update, which is migration 076's own pair of CHECKs.
    await call(host, "cookbook:update", {
      profileId,
      id: saved.recipeId,
      patch: { title: "Sarma po mami" },
    });
    const edited = await call<RecipeView>(host, "cookbook:get", {
      profileId,
      id: saved.recipeId,
    });
    expect(edited.licence).toEqual(copy.licence);
  });

  it("refuses a pack this build has not installed, rather than guessing", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await expect(
      call(host, "cookbook:browsePack", { profileId, packId: "ghost", query: "" }),
    ).rejects.toThrow(/No installed pack "ghost"/);
  });
});

describe("the nutrition, and the foods it reads", () => {
  it("computes the figures per serving from an installed foods pack", async () => {
    installPack("usda", { "foods.json": FOODS });
    const { host } = harness();
    const profileId = createProfile();
    const created = await call<{ recipeId: string }>(host, "cookbook:create", {
      profileId,
      recipe: draft({
        servings: 2,
        ingredients: [
          ingredient("mleveno meso", {
            rawText: "500 g mlevenog mesa",
            quantity: 500,
            unit: "g",
          }),
          ingredient("so", { rawText: "so" }),
        ],
      }),
    });
    const suggested = await call<{ id: string }[]>(host, "cookbook:suggestFoods", {
      profileId,
      query: "mleveno",
    });
    expect(suggested.map((food) => food.id)).toEqual(["mleveno-meso"]);
    await call(host, "cookbook:setFoodMatch", {
      profileId,
      name: "mleveno meso",
      foodId: "mleveno-meso",
      gramsPerUnit: null,
    });

    const view = await call<NutritionView>(host, "cookbook:nutrition", {
      profileId,
      id: created.recipeId,
    });

    // 500 g of a food carrying 100 kcal and 20 g of protein per 100 g is 500 kcal
    // and 100 g of protein for the dish, and the recipe is for two servings.
    expect(view.servings).toBe(2);
    expect(view.perServing.kcal).toBe(250);
    expect(view.perServing.protein).toBe(50);
    expect(view.countedLines).toBe(1);
    expect(view.uncounted).toEqual([{ name: "so", reason: "unlinked" }]);
    expect(view.packIds).toEqual(["usda"]);
    expect(view.noFoodsPack).toBe(false);
  });

  it("remembers a link per NAME, so the second recipe that says it needs no second answer", async () => {
    installPack("usda", { "foods.json": FOODS });
    const { host } = harness();
    const profileId = createProfile();
    await call(host, "cookbook:setFoodMatch", {
      profileId,
      name: "Mleveno meso",
      foodId: "mleveno-meso",
      gramsPerUnit: null,
    });
    const created = await call<{ recipeId: string }>(host, "cookbook:create", {
      profileId,
      recipe: draft({
        ingredients: [
          ingredient("mleveno meso", {
            rawText: "500 g mlevenog mesa",
            quantity: 500,
            unit: "g",
          }),
        ],
      }),
    });

    const view = await call<NutritionView>(host, "cookbook:nutrition", {
      profileId,
      id: created.recipeId,
    });
    expect(view.perServing.kcal).toBe(125);

    const list = await call<CookbookView>(host, "cookbook:list", { profileId });
    expect(list.foodMatches).toEqual([
      {
        name: "Mleveno meso",
        foodId: "mleveno-meso",
        foodName: "Mleveno meso",
        gramsPerUnit: null,
      },
    ]);
    await call(host, "cookbook:clearFoodMatch", { profileId, name: "mleveno meso" });
    const after = await call<CookbookView>(host, "cookbook:list", { profileId });
    expect(after.foodMatches).toEqual([]);
  });

  it("says there is no foods pack rather than inventing figures", async () => {
    const { host } = harness({ packs: false });
    const profileId = createProfile();
    const created = await call<{ recipeId: string }>(host, "cookbook:create", {
      profileId,
      recipe: draft(),
    });

    const view = await call<NutritionView>(host, "cookbook:nutrition", {
      profileId,
      id: created.recipeId,
    });

    expect(view.noFoodsPack).toBe(true);
    expect(view.countedLines).toBe(0);
    expect(view.perServing.kcal).toBe(0);
  });

  it("refuses a link to a food no installed pack carries", async () => {
    const { host } = harness({ packs: false });
    const profileId = createProfile();
    await expect(
      call(host, "cookbook:setFoodMatch", {
        profileId,
        name: "kupus",
        foodId: "kupus",
        gramsPerUnit: null,
      }),
    ).rejects.toThrow(/No installed pack carries the food/);
  });
});

describe("the photo and the screen", () => {
  it("stores a photo through main, keeps the index row, and lets the replaced bytes go", async () => {
    const kit = harness({ photo: PHOTO });
    const profileId = createProfile();
    const created = await call<{ recipeId: string }>(kit.host, "cookbook:create", {
      profileId,
      recipe: draft(),
    });

    await call(kit.host, "cookbook:attachPhoto", { profileId, id: created.recipeId });
    const withPhoto = await call<RecipeView>(kit.host, "cookbook:get", {
      profileId,
      id: created.recipeId,
    });
    expect(withPhoto.photo).toEqual(PHOTO);
    // Nothing to release: the recipe had no photo before this one.
    expect(kit.photos.released).toEqual([]);

    await call(kit.host, "cookbook:removePhoto", { profileId, id: created.recipeId });
    const without = await call<RecipeView>(kit.host, "cookbook:get", {
      profileId,
      id: created.recipeId,
    });
    expect(without.photo).toBeNull();
    expect(kit.photos.released).toEqual([PHOTO.sha256]);
  });

  it("treats a cancelled dialog as nothing happening at all", async () => {
    const kit = harness({ photo: null });
    const profileId = createProfile();
    const created = await call<{ recipeId: string }>(kit.host, "cookbook:create", {
      profileId,
      recipe: draft(),
    });

    await call(kit.host, "cookbook:attachPhoto", { profileId, id: created.recipeId });

    const recipe = await call<RecipeView>(kit.host, "cookbook:get", {
      profileId,
      id: created.recipeId,
    });
    expect(recipe.photo).toBeNull();
    expect(kit.photos.picked).toBe(1);
    expect(kit.photos.released).toEqual([]);
  });

  it("asks main to keep the screen awake, and lets it go when the session ends", async () => {
    const kit = harness();
    const profileId = createProfile();

    await call(kit.host, "cookbook:setAwake", { profileId, awake: true });
    expect(kit.awake).toEqual([true]);

    kit.sessionEnd();
    expect(kit.awake).toEqual([true, false]);
  });
});

describe("the cookbook archive section", () => {
  it("round-trips recipes WITH their photos, the raw lines, the preference and the links", async () => {
    installPack("usda", { "foods.json": FOODS });
    const kit = harness({ photo: PHOTO });
    const source = createProfile();
    const target = createProfile();
    const created = await call<{ recipeId: string }>(kit.host, "cookbook:create", {
      profileId: source,
      recipe: draft(),
    });
    await call(kit.host, "cookbook:attachPhoto", { profileId: source, id: created.recipeId });
    await call(kit.host, "cookbook:setUnitSystem", { profileId: source, unitSystem: "kitchen" });
    await call(kit.host, "cookbook:setFoodMatch", {
      profileId: source,
      name: "mleveno meso",
      foodId: "mleveno-meso",
      gramsPerUnit: 15,
    });

    const [section] = kit.host.collectExports([source]);
    expect(section?.moduleId).toBe("cookbook");
    kit.host.applyImports([section!], [target]);

    const restored = await call<CookbookView>(kit.host, "cookbook:list", { profileId: target });
    expect(restored.settings.unitSystem).toBe("kitchen");
    expect(restored.foodMatches).toEqual([
      {
        name: "mleveno meso",
        foodId: "mleveno-meso",
        foodName: "Mleveno meso",
        gramsPerUnit: 15,
      },
    ]);
    const recipe = await call<RecipeView>(kit.host, "cookbook:get", {
      profileId: target,
      id: restored.recipes[0]?.id ?? "",
    });
    expect(recipe.photo).toEqual(PHOTO);
    expect(recipe.ingredients[0]?.rawText).toBe("1 glavica kupusa");
    expect(recipe.ingredients[1]?.rawText).toBe("500 g mlevenog mesa");
    expect(recipe.steps[0]?.timerMinutes).toBe(90);
  });

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {
    const kit = harness();
    const profileId = createProfile();
    await call(kit.host, "cookbook:create", { profileId, recipe: draft() });

    for (const payload of [
      {
        version: 99,
        recipes: [],
        settings: { unitSystem: "metric", updatedAt: null },
        foodMatches: [],
      },
      {
        version: 1,
        recipes: [],
        settings: { unitSystem: "furlongs", updatedAt: null },
        foodMatches: [],
      },
      {
        version: 1,
        recipes: [],
        settings: { unitSystem: "metric", updatedAt: null },
        foodMatches: [
          {
            name: "so",
            nameKey: "NOT the fold of so",
            foodRef: { kind: "catalogue", id: "so" },
            foodName: "So",
            gramsPerUnit: null,
            createdAt: "2026-06-01T08:00:00.000Z",
            updatedAt: "2026-06-01T08:00:00.000Z",
          },
        ],
      },
    ]) {
      expect(() => kit.host.applyImports([{ moduleId: "cookbook", payload }], [profileId])).toThrow();
      const after = await call<CookbookView>(kit.host, "cookbook:list", { profileId });
      expect(after.recipes.map((recipe) => recipe.title)).toEqual(["Sarma"]);
    }
  });

  it("empties the archived state when the section names no cookbook entry", async () => {
    const kit = harness();
    const profileId = createProfile();
    await call(kit.host, "cookbook:create", { profileId, recipe: draft() });
    await call(kit.host, "cookbook:setUnitSystem", { profileId, unitSystem: "kitchen" });

    // A restore replaces a profile whole, so an archive with no cookbook section
    // is an empty cookbook with the shipped preference — not "leave it alone".
    kit.host.applyImports([], [profileId]);

    const after = await call<CookbookView>(kit.host, "cookbook:list", { profileId });
    expect(after.recipes).toEqual([]);
    expect(after.settings).toEqual({ unitSystem: "metric", updatedAt: null });
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    expect(harness().host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});
