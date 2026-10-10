import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COOKBOOK_EXPORT_VERSION,
  NexusDatabase,
  RecipeNotFoundError,
  RecipeStore,
  RecipeValidationError,
  openDatabase,
  uuidv7,
} from "../index.js";
import type { CreateRecipeInput, Recipe, RecipeIngredientInput } from "../index.js";

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:00:00.000Z";

const PHOTO = {
  fileName: "sarma.jpg",
  mime: "image/jpeg",
  sizeBytes: 40_112,
  sha256: "a".repeat(64),
};

const LICENCE = {
  title: "Sarma iz Vojvodine",
  author: "Neki Autor",
  url: "https://example.org/sarma",
  licenceId: "CC-BY-SA-4.0",
  attribution: "Neki Autor, „Sarma iz Vojvodine“, CC BY-SA 4.0",
};

function ingredient(fields: Partial<RecipeIngredientInput> & { name: string }): RecipeIngredientInput {
  return { quantity: null, unit: null, ...fields };
}

/** A recipe that is valid on its own, so a case can change exactly one thing about it. */
function recipe(fields: Partial<CreateRecipeInput> = {}): CreateRecipeInput {
  return {
    title: "Sarma",
    course: "main",
    servings: 4,
    ingredients: [ingredient({ name: "kupus", quantity: 1, unit: "head" })],
    steps: [{ text: "Urolati i kuvati." }],
    source: "own",
    ...fields,
  };
}

let dir: string;
let db: NexusDatabase;
let profileId: string;
let recipes: RecipeStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-cookbook-"));
  db = openDatabase({ path: join(dir, "cookbook.db") });
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "P", NOW);
  recipes = new RecipeStore(db.raw, profileId);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A second profile in the same file, for the scoping cases. */
function otherStore(): RecipeStore {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "Q", NOW);
  return new RecipeStore(db.raw, id);
}

describe("RecipeStore.create", () => {
  it("stores a recipe with nothing but a title, a course, servings and a step", () => {
    const created = recipes.create(recipe({ ingredients: [], steps: [{ text: "Skuvati." }] }), NOW);

    expect(created).toMatchObject({
      title: "Sarma",
      description: "",
      cuisine: "",
      course: "main",
      servings: 4,
      prepMinutes: null,
      cookMinutes: null,
      tags: [],
      rating: null,
      notes: "",
      favourite: false,
      source: "own",
      licence: null,
      photo: null,
      ingredients: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(recipes.list()).toEqual([created]);
  });

  it("stores the ingredients in the order given, with their groups, ranges and links", () => {
    const created = recipes.create(
      recipe({
        ingredients: [
          ingredient({ name: "kupus", quantity: 1, unit: "head", group: "Za sarmu" }),
          ingredient({
            name: "mleveno meso",
            quantity: 500,
            unit: "g",
            group: "Za sarmu",
            foodRef: { kind: "catalogue", id: "mleveno-meso-junece" },
            preparation: "samleveno",
          }),
          ingredient({ name: "pirinač", quantity: 2, quantityMax: 3, unit: "tbsp" }),
          ingredient({ name: "so", preparation: "po ukusu" }),
        ],
        steps: [
          { text: "Propržiti luk." },
          { text: "Kuvati.", timerMinutes: 90 },
        ],
      }),
      NOW,
    );

    expect(created.ingredients.map((line) => line.position)).toEqual([0, 1, 2, 3]);
    expect(created.steps.map((step) => step.position)).toEqual([0, 1]);
    expect(created.ingredients).toMatchObject([
      { name: "kupus", quantity: 1, quantityMax: null, unit: "head", group: "Za sarmu", preparation: null, foodRef: null },
      {
        name: "mleveno meso",
        quantity: 500,
        unit: "g",
        preparation: "samleveno",
        foodRef: { kind: "catalogue", id: "mleveno-meso-junece" },
        gramsPerUnit: null,
      },
      { name: "pirinač", quantity: 2, quantityMax: 3, unit: "tbsp" },
      { name: "so", quantity: null, unit: null, preparation: "po ukusu" },
    ]);
    expect(created.steps).toMatchObject([
      { text: "Propržiti luk.", timerMinutes: null },
      { text: "Kuvati.", timerMinutes: 90 },
    ]);
    // Every child row is minted an id of its own, and the two lists do not share one.
    const ids = [...created.ingredients, ...created.steps].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps an imported recipe's attribution, and keeps it through an edit", () => {
    const created = recipes.create(
      recipe({ source: "imported", licence: LICENCE, tags: ["Zima"] }),
      NOW,
    );
    expect(created.source).toBe("imported");
    expect(created.licence).toEqual(LICENCE);

    const edited = recipes.update(created.id, { title: "Sarma po mami", servings: 6 }, LATER);
    expect(edited.title).toBe("Sarma po mami");
    expect(edited.servings).toBe(6);
    // The whole reason the licence is not part of an update: the source is a
    // fact about where the recipe came from, and no edit changes where it came
    // from.
    expect(edited.licence).toEqual(LICENCE);
    expect(recipes.get(created.id).licence).toEqual(LICENCE);
  });

  it("stores a photo as an index row and nothing but an index row", () => {
    const created = recipes.create(recipe({ photo: PHOTO }), NOW);
    expect(created.photo).toEqual(PHOTO);
    // No bytes anywhere: the attachment's blob lives on disk, owned by main's
    // content-addressed store (migration 013's arrangement), and this table is
    // the index over it.
    expect(
      db.raw
        .prepare("SELECT count(*) AS n FROM cookbook_recipes WHERE photo_sha256 = ?")
        .get(PHOTO.sha256),
    ).toEqual({ n: 1 });
  });

  it("trims the title and the text fields, and folds two spellings of one tag together", () => {
    const created = recipes.create(
      recipe({
        title: "  Sarma  ",
        description: "  Zimsko jelo  ",
        cuisine: "  srpska ",
        tags: ["Zima", "zima", " Slava "],
        ingredients: [ingredient({ name: "  kupus ", quantity: 1, unit: "head" })],
        steps: [{ text: "  Kuvati.  " }],
      }),
      NOW,
    );
    expect(created.title).toBe("Sarma");
    expect(created.description).toBe("Zimsko jelo");
    expect(created.cuisine).toBe("srpska");
    expect(created.tags).toEqual(["Zima", "Slava"]);
    expect(created.ingredients[0]?.name).toBe("kupus");
    expect(created.steps[0]?.text).toBe("Kuvati.");
  });

  it.each([
    ["an empty title", recipe({ title: "   " })],
    ["an over-long title", recipe({ title: "x".repeat(121) })],
    ["an unknown course", recipe({ course: "brunch" as never })],
    ["zero servings", recipe({ servings: 0 })],
    ["a fractional serving count", recipe({ servings: 2.5 })],
    ["more servings than anyone cooks", recipe({ servings: 101 })],
    ["a zero prep time", recipe({ prepMinutes: 0 })],
    ["a fractional prep time", recipe({ prepMinutes: 2.5 })],
    ["a zero cook time", recipe({ cookMinutes: 0 })],
    ["a cooking time longer than a week", recipe({ cookMinutes: 10_081 })],
    ["a rating of zero", recipe({ rating: 0 })],
    ["a rating of eleven", recipe({ rating: 11 })],
    ["a fractional rating", recipe({ rating: 7.5 })],
    ["more tags than the module holds", recipe({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })],
    ["an over-long tag", recipe({ tags: ["x".repeat(41)] })],
    ["a tag that is only whitespace", recipe({ tags: ["  "] })],
    ["an over-long note", recipe({ notes: "x".repeat(8001) })],
    ["a favourite flag that is not a boolean", recipe({ favourite: "yes" as never })],
    ["an unknown source", recipe({ source: "magazine" as never })],
    ["an own recipe carrying a licence", recipe({ source: "own", licence: LICENCE })],
    ["an imported recipe with no licence", recipe({ source: "imported" })],
    ["an imported recipe with half a licence", recipe({ source: "imported", licence: { ...LICENCE, url: "" } })],
    ["an imported recipe with a licence id that is not one", recipe({ source: "imported", licence: { ...LICENCE, licenceId: "CC BY SA" } })],
    ["an imported recipe with a url that is not openable", recipe({ source: "imported", licence: { ...LICENCE, url: "nexus://sarma" } })],
    ["an ingredient with no name", recipe({ ingredients: [ingredient({ name: "  " })] })],
    ["an over-long ingredient name", recipe({ ingredients: [ingredient({ name: "x".repeat(121) })] })],
    ["a zero quantity", recipe({ ingredients: [ingredient({ name: "kupus", quantity: 0 })] })],
    ["a unit outside the vocabulary", recipe({ ingredients: [ingredient({ name: "kupus", unit: "handfuls" as never })] })],
    ["an upper bound with no lower one", recipe({ ingredients: [ingredient({ name: "pirinač", quantityMax: 3, unit: "tbsp" })] })],
    ["a range that runs backwards", recipe({ ingredients: [ingredient({ name: "pirinač", quantity: 3, quantityMax: 2, unit: "tbsp" })] })],
    ["an over-long preparation note", recipe({ ingredients: [ingredient({ name: "kupus", preparation: "x".repeat(121) })] })],
    ["an over-long group heading", recipe({ ingredients: [ingredient({ name: "kupus", group: "x".repeat(61) })] })],
    [
      "a food reference that is not one",
      recipe({ ingredients: [ingredient({ name: "kupus", foodRef: { kind: "shop", id: "kupus" } as never })] }),
    ],
    [
      "a weight of one unit with nothing to weigh into",
      recipe({ ingredients: [ingredient({ name: "kupus", quantity: 1, unit: "head", gramsPerUnit: 900 })] }),
    ],
    [
      "an absurd weight of one unit",
      recipe({
        ingredients: [
          ingredient({
            name: "kupus",
            foodRef: { kind: "catalogue", id: "kupus" },
            gramsPerUnit: 10_001,
          }),
        ],
      }),
    ],
    ["more ingredients than a recipe holds", recipe({ ingredients: Array.from({ length: 101 }, (_, i) => ingredient({ name: `s${i}` })) })],
    ["more steps than a recipe holds", recipe({ steps: Array.from({ length: 101 }, (_, i) => ({ text: `k${i}` })) })],
    ["a step with no text", recipe({ steps: [{ text: "   " }] })],
    ["a step timer of zero", recipe({ steps: [{ text: "Kuvati.", timerMinutes: 0 }] })],
    ["a step timer longer than a day", recipe({ steps: [{ text: "Kuvati.", timerMinutes: 1441 }] })],
    ["a fractional step timer", recipe({ steps: [{ text: "Kuvati.", timerMinutes: 2.5 }] })],
    [
      "a photo with no mime",
      recipe({ photo: { ...PHOTO, mime: "" } }),
    ],
    ["a photo that weighs nothing", recipe({ photo: { ...PHOTO, sizeBytes: 0 } })],
    ["a photo with a hash that is not one", recipe({ photo: { ...PHOTO, sha256: "abc" } })],
    ["a file name that is a path", recipe({ photo: { ...PHOTO, fileName: "C:\\slike\\sarma.jpg" } })],
  ])("refuses %s", (_label, input) => {
    // The cast is the point: these are the shapes an untrusted caller can send,
    // and the store is what refuses them (SEC-EL-02).
    expect(() => recipes.create(input as never, NOW)).toThrow(RecipeValidationError);
  });

  it("refuses a malformed `now` — main stamps the clock, the renderer never does", () => {
    expect(() => recipes.create(recipe(), "juče")).toThrow(RecipeValidationError);
  });
});

describe("RecipeStore.update", () => {
  it("applies a partial patch and leaves every omitted field alone", () => {
    const created = recipes.create(
      recipe({ cuisine: "srpska", cookMinutes: 120, rating: 9, notes: "Omiljeno", favourite: true }),
      NOW,
    );

    const updated = recipes.update(created.id, { title: "Sarma 2" }, LATER);
    expect(updated).toMatchObject({
      title: "Sarma 2",
      cuisine: "srpska",
      cookMinutes: 120,
      rating: 9,
      notes: "Omiljeno",
      favourite: true,
      createdAt: NOW,
      updatedAt: LATER,
    });
    expect(recipes.get(created.id)).toEqual(updated);
  });

  it("replaces the whole ingredient list when one is given, renumbering from zero", () => {
    const created = recipes.create(
      recipe({
        ingredients: [
          ingredient({ name: "kupus", quantity: 1, unit: "head" }),
          ingredient({ name: "pirinač", quantity: 100, unit: "g" }),
          ingredient({ name: "so" }),
        ],
      }),
      NOW,
    );

    const updated = recipes.update(
      created.id,
      {
        ingredients: [
          ingredient({ name: "so" }),
          ingredient({ name: "kupus", quantity: 2, unit: "head", group: "Za sarmu" }),
        ],
      },
      LATER,
    );

    expect(updated.ingredients.map((line) => line.name)).toEqual(["so", "kupus"]);
    expect(updated.ingredients.map((line) => line.position)).toEqual([0, 1]);
    expect(updated.ingredients[1]).toMatchObject({ quantity: 2, unit: "head", group: "Za sarmu" });
    // „pirinač" was dropped and does not come back: the list IS the recipe's.
    expect(
      db.raw
        .prepare("SELECT count(*) AS n FROM cookbook_ingredients WHERE recipe_id = ?")
        .get(created.id),
    ).toEqual({ n: 2 });
    expect(updated.steps.map((step) => step.position)).toEqual([0]);
  });

  it("clears a nullable field with an explicit null, and only with one", () => {
    const created = recipes.create(recipe({ rating: 8, prepMinutes: 20, photo: PHOTO }), NOW);

    // An omitted key leaves the field as it was — the difference `undefined`
    // cannot carry across the IPC boundary, which is why the patch speaks null.
    const kept = recipes.update(created.id, { title: "Sarma" }, LATER);
    expect(kept.rating).toBe(8);
    expect(kept.photo).toEqual(PHOTO);

    const cleared = recipes.update(created.id, { rating: null, prepMinutes: null, photo: null }, LATER);
    expect(cleared.rating).toBeNull();
    expect(cleared.prepMinutes).toBeNull();
    expect(cleared.photo).toBeNull();
  });

  it("refuses a patch that breaks a rule, and writes nothing of it", () => {
    const created = recipes.create(recipe(), NOW);

    expect(() => recipes.update(created.id, { servings: 0 }, LATER)).toThrow(RecipeValidationError);
    expect(() =>
      recipes.update(
        created.id,
        { ingredients: [ingredient({ name: "kupus", quantityMax: 2, unit: "head" })] },
        LATER,
      ),
    ).toThrow(RecipeValidationError);
    // The refusing update left the stored recipe exactly as it was, children
    // included — validation happens before the transaction opens.
    expect(recipes.get(created.id)).toEqual(created);
  });

  it("refuses to touch a recipe that is not live in this profile", () => {
    const created = recipes.create(recipe(), NOW);
    recipes.softDelete(created.id, LATER);
    expect(() => recipes.update(created.id, { title: "Ne" }, LATER)).toThrow(RecipeNotFoundError);
    expect(() => recipes.get(created.id)).toThrow(RecipeNotFoundError);

    const other = otherStore().create(recipe({ title: "Tuđa" }), NOW);
    expect(() => recipes.update(other.id, { title: "Ne" }, LATER)).toThrow(RecipeNotFoundError);
    expect(() => recipes.get(other.id)).toThrow(RecipeNotFoundError);
  });
});

describe("RecipeStore.softDelete and restore", () => {
  it("hides a recipe without touching its ingredients or steps, and brings both back", () => {
    const created = recipes.create(
      recipe({ ingredients: [ingredient({ name: "kupus", quantity: 1, unit: "head" })], steps: [{ text: "Kuvati." }] }),
      NOW,
    );

    recipes.softDelete(created.id, LATER);
    expect(recipes.list()).toEqual([]);
    // The rows are still there — a soft delete is an UPDATE, and a hard delete
    // (which is what removing a profile is) is the only thing the cascade reaches.
    expect(
      db.raw
        .prepare("SELECT count(*) AS n FROM cookbook_ingredients WHERE recipe_id = ?")
        .get(created.id),
    ).toEqual({ n: 1 });
    expect(
      db.raw.prepare("SELECT count(*) AS n FROM cookbook_steps WHERE recipe_id = ?").get(created.id),
    ).toEqual({ n: 1 });

    recipes.restore(created.id, LATER);
    expect(recipes.get(created.id)).toMatchObject({
      ingredients: [{ name: "kupus", quantity: 1, unit: "head" }],
      steps: [{ text: "Kuvati." }],
    });
  });

  it("refuses to delete or restore a recipe that is not in the state named", () => {
    const created = recipes.create(recipe(), NOW);
    expect(() => recipes.restore(created.id, LATER)).toThrow(RecipeNotFoundError);
    recipes.softDelete(created.id, LATER);
    expect(() => recipes.softDelete(created.id, LATER)).toThrow(RecipeNotFoundError);
    expect(() => recipes.softDelete(uuidv7(), LATER)).toThrow(RecipeNotFoundError);
  });

  it("carries a photo's blob reference through a soft delete, because the row still holds it", () => {
    const created = recipes.create(recipe({ photo: PHOTO }), NOW);
    recipes.softDelete(created.id, LATER);
    expect(
      db.raw
        .prepare("SELECT count(*) AS n FROM cookbook_recipes WHERE photo_sha256 = ?")
        .get(PHOTO.sha256),
    ).toEqual({ n: 1 });
  });
});

describe("RecipeStore.list", () => {
  it("answers this profile's live recipes, Serbian-collated by title", () => {
    for (const title of ["Šopska salata", "Burek", "Ćevapi", "Pasulj"]) {
      recipes.create(recipe({ title, tags: [] }), NOW);
    }
    expect(recipes.list().map((entry) => entry.title)).toEqual([
      "Burek",
      "Ćevapi",
      "Pasulj",
      "Šopska salata",
    ]);
  });

  it("never answers another profile's recipes", () => {
    const mine = recipes.create(recipe({ title: "Moja" }), NOW);
    const theirs = otherStore().create(recipe({ title: "Njegova" }), NOW);
    expect(recipes.list().map((entry) => entry.id)).toEqual([mine.id]);
    expect(recipes.list().map((entry) => entry.id)).not.toContain(theirs.id);
  });
});

describe("RecipeStore reading a row it did not write", () => {
  it("refuses a stored tag list or food reference that is not one, rather than reading it as nothing", () => {
    const created = recipes.create(
      recipe({
        ingredients: [
          ingredient({
            name: "kupus",
            quantity: 1,
            unit: "head",
            foodRef: { kind: "catalogue", id: "kupus" },
          }),
        ],
      }),
      NOW,
    );

    // A hand-edited file, or a restore that wrote something else. Reading either
    // as null would silently drop a link the user made — so the store throws,
    // the `HabitStore.parseStoredSchedule` posture.
    db.raw
      .prepare("UPDATE cookbook_recipes SET tags_json = ? WHERE id = ?")
      .run("nije json", created.id);
    expect(() => recipes.list()).toThrow(RecipeValidationError);
    db.raw
      .prepare("UPDATE cookbook_recipes SET tags_json = ? WHERE id = ?")
      .run("[1]", created.id);
    expect(() => recipes.list()).toThrow(RecipeValidationError);
    db.raw
      .prepare("UPDATE cookbook_recipes SET tags_json = ? WHERE id = ?")
      .run('["Zima"]', created.id);

    db.raw
      .prepare("UPDATE cookbook_ingredients SET food_ref = ? WHERE recipe_id = ?")
      .run("prodavnica:kupus", created.id);
    expect(() => recipes.get(created.id)).toThrow(RecipeValidationError);
  });
});

describe("RecipeStore.exportData and importData", () => {
  /** Two recipes with children, tags, a range, a link and a photo — enough that a lost field shows. */
  function seed(): Recipe[] {
    return [
      recipes.create(
        recipe({
          title: "Sarma",
          description: "Zimsko jelo",
          cuisine: "srpska",
          cookMinutes: 180,
          tags: ["Zima"],
          rating: 9,
          notes: "Omiljeno",
          favourite: true,
          photo: PHOTO,
          ingredients: [
            ingredient({ name: "kupus", quantity: 1, unit: "head", group: "Za sarmu" }),
            ingredient({
              name: "mleveno meso",
              quantity: 500,
              unit: "g",
              foodRef: { kind: "catalogue", id: "mleveno-meso-junece" },
              gramsPerUnit: 1,
            }),
            ingredient({ name: "pirinač", quantity: 2, quantityMax: 3, unit: "tbsp" }),
          ],
          steps: [
            { text: "Propržiti luk." },
            { text: "Kuvati.", timerMinutes: 90 },
          ],
        }),
        NOW,
      ),
      recipes.create(
        recipe({
          title: "Burek",
          course: "baking",
          servings: 6,
          source: "imported",
          licence: LICENCE,
          ingredients: [ingredient({ name: "kore", quantity: 500, unit: "g" })],
          steps: [{ text: "Peći.", timerMinutes: 40 }],
        }),
        LATER,
      ),
    ];
  }

  it("answers a versioned plain JSON value, children and all", () => {
    const [sarma, burek] = seed();
    const exported = recipes.exportData();

    expect(exported.version).toBe(COOKBOOK_EXPORT_VERSION);
    // Collated by title, and the store's own order — never the order the
    // recipes happened to be created in.
    expect(exported.recipes.map((entry) => entry.title)).toEqual(["Burek", "Sarma"]);
    expect(exported.recipes.find((entry) => entry.id === sarma?.id)).toMatchObject({
      title: "Sarma",
      course: "main",
      servings: 4,
      cookMinutes: 180,
      tags: ["Zima"],
      rating: 9,
      favourite: true,
      source: "own",
      licence: null,
      photo: PHOTO,
      ingredients: [
        { name: "kupus", quantity: 1, quantityMax: null, unit: "head", group: "Za sarmu", preparation: null, foodRef: null, gramsPerUnit: null },
        {
          name: "mleveno meso",
          quantity: 500,
          unit: "g",
          foodRef: { kind: "catalogue", id: "mleveno-meso-junece" },
          gramsPerUnit: 1,
        },
        { name: "pirinač", quantity: 2, quantityMax: 3, unit: "tbsp" },
      ],
      steps: [
        { text: "Propržiti luk.", timerMinutes: null },
        { text: "Kuvati.", timerMinutes: 90 },
      ],
    });
    expect(exported.recipes.find((entry) => entry.id === burek?.id)?.licence).toEqual(LICENCE);
    // Plain JSON: no class, no Date, no Map — what an archive can carry.
    expect(JSON.parse(JSON.stringify(exported))).toEqual(exported);
  });

  it("round-trips: export, change everything, import, and get the same value back", () => {
    seed();
    const snapshot = recipes.exportData();

    recipes.create(recipe({ title: "Pasulj" }), LATER);
    const doomed = recipes.list()[0];
    if (doomed === undefined) throw new Error("the fixture seeded nothing");
    recipes.softDelete(doomed.id, LATER);

    recipes.importData(snapshot);

    expect(recipes.exportData()).toEqual(snapshot);
    expect(recipes.list().map((entry) => entry.title)).toEqual(["Burek", "Sarma"]);
  });

  it("imports only into its own profile", () => {
    seed();
    const theirStore = otherStore();
    const theirs = theirStore.create(recipe({ title: "Njegova" }), NOW);
    const snapshot = recipes.exportData();

    const second = new RecipeStore(db.raw, profileId);
    second.importData(snapshot);

    expect(recipes.list().map((entry) => entry.title)).toEqual(["Burek", "Sarma"]);
    expect(theirStore.list().map((entry) => entry.title)).toEqual(["Njegova"]);
    expect(theirStore.list()[0]?.id).toBe(theirs.id);
  });

  it("refuses a version it does not know, without writing anything", () => {
    const kept = seed();
    const before = recipes.exportData();

    expect(() => recipes.importData({ version: 2, recipes: [] })).toThrow(RecipeValidationError);
    expect(() => recipes.importData({ recipes: [] })).toThrow(RecipeValidationError);
    expect(() => recipes.importData("{}")).toThrow(RecipeValidationError);
    expect(recipes.list().map((entry) => entry.id).sort()).toEqual(
      [kept[0]?.id, kept[1]?.id].sort(),
    );
    expect(recipes.exportData()).toEqual(before);
  });

  it("validates the WHOLE value before it writes any of it", () => {
    const kept = seed();
    const snapshot = recipes.exportData();

    // The second recipe is the broken one, so a writer that validated as it
    // went would have written the first.
    const broken = {
      ...snapshot,
      recipes: [snapshot.recipes[0], { ...snapshot.recipes[1], course: "brunch" }],
    };
    expect(() => recipes.importData(broken)).toThrow(RecipeValidationError);
    expect(recipes.list().map((entry) => entry.id).sort()).toEqual(
      [kept[0]?.id, kept[1]?.id].sort(),
    );

    // The same for a duplicate id, which the primary key would otherwise refuse
    // from inside the transaction, after half the value had landed.
    const duplicated = { ...snapshot, recipes: [snapshot.recipes[0], snapshot.recipes[0]] };
    expect(() => recipes.importData(duplicated)).toThrow(RecipeValidationError);
    expect(recipes.exportData()).toEqual(snapshot);
  });

  it("takes the array's order as the order, and renumbers positions on the way in", () => {
    seed();
    const snapshot = recipes.exportData();
    const first = snapshot.recipes.find((entry) => entry.title === "Sarma");
    const second = snapshot.recipes.find((entry) => entry.title === "Burek");
    if (first === undefined || second === undefined) throw new Error("the fixture seeded nothing");

    const shuffled = {
      version: COOKBOOK_EXPORT_VERSION,
      recipes: [
        { ...first, ingredients: [...first.ingredients].reverse(), steps: [...first.steps].reverse() },
        second,
      ],
    };
    recipes.importData(shuffled);

    const reimported = recipes.exportData();
    const sarma = reimported.recipes.find((entry) => entry.title === "Sarma");
    expect(sarma?.ingredients.map((line) => line.name)).toEqual([
      "pirinač",
      "mleveno meso",
      "kupus",
    ]);
    expect(sarma?.steps.map((step) => step.text)).toEqual([
      "Kuvati.",
      "Propržiti luk.",
    ]);
    expect(
      db.raw
        .prepare("SELECT position FROM cookbook_ingredients ORDER BY position")
        .all(),
    ).toEqual([{ position: 0 }, { position: 0 }, { position: 1 }, { position: 2 }]);
  });

  it("refuses a value whose recipe has no id, or whose child has none", () => {
    seed();
    const snapshot = recipes.exportData();
    const first = snapshot.recipes[0];
    if (first === undefined) throw new Error("the fixture seeded nothing");

    expect(() => recipes.importData({ ...snapshot, recipes: [{ ...first, id: "" }] })).toThrow(
      RecipeValidationError,
    );
    expect(() =>
      recipes.importData({
        ...snapshot,
        recipes: [{ ...first, ingredients: [{ ...first.ingredients[0], id: "" }] }],
      }),
    ).toThrow(RecipeValidationError);
    expect(() =>
      recipes.importData({
        ...snapshot,
        recipes: [
          first,
          { ...first, id: "another", ingredients: [{ ...first.ingredients[0] }] },
        ],
      }),
    ).toThrow(RecipeValidationError);
  });
});
