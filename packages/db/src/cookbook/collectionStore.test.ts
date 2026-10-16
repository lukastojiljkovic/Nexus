import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollectionStore, NexusDatabase, RecipeNotFoundError, RecipeStore, openDatabase, uuidv7 } from "../index.js";
import { RecipeValidationError } from "../errors.js";

/**
 * The COOKBOOK's collections (migration 095): CRUD on the shelves, membership
 * on both ends, the pack seed that must not duplicate, and the rule that
 * deleting a shelf never takes a recipe with it.
 */

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:00:00.000Z";

let dir: string;
let db: NexusDatabase;

function createProfile(name: string): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, NOW);
  return id;
}

function createRecipe(profileId: string, title: string): string {
  return new RecipeStore(db.raw, profileId).create(
    { title, course: "main", servings: 2, ingredients: [], steps: [], source: "own" },
    NOW,
  ).id;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-cookbook-collections-"));
  db = openDatabase({ path: join(dir, "cookbook.db") });
});

beforeEach(() => {
  db.raw.exec("DELETE FROM profiles");
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("collection CRUD", () => {
  it("creates a shelf the user made, with no pack behind it", () => {
    const profileId = createProfile("A");
    const shelves = new CollectionStore(db.raw, profileId);
    const made = shelves.create("  Zimnica  ", NOW);

    expect(made).toMatchObject({
      profileId,
      name: "Zimnica",
      sourcePack: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(shelves.list()).toEqual([{ ...made, recipeIds: [] }]);
  });

  it("renames a shelf and stamps the change", () => {
    const profileId = createProfile("A");
    const shelves = new CollectionStore(db.raw, profileId);
    const made = shelves.create("Zimnica", NOW);

    const renamed = shelves.rename(made.id, "Zimska zaliha", LATER);
    expect(renamed).toMatchObject({ id: made.id, name: "Zimska zaliha", updatedAt: LATER });
    expect(renamed.createdAt).toBe(NOW);
  });

  it("refuses a blank name and a name over the cap, and names the field", () => {
    const shelves = new CollectionStore(db.raw, createProfile("A"));
    expect(() => shelves.create("   ", NOW)).toThrow(RecipeValidationError);
    expect(() => shelves.create("n".repeat(61), NOW)).toThrow(RecipeValidationError);
    expect(() => shelves.create("n".repeat(60), NOW)).not.toThrow();
  });

  it("lists shelves by name, and two shelves may share one", () => {
    const shelves = new CollectionStore(db.raw, createProfile("A"));
    shelves.create("Zimnica", NOW);
    shelves.create("Brza", NOW);
    shelves.create("Brza", NOW);
    expect(shelves.list().map((shelf) => shelf.name)).toEqual(["Brza", "Brza", "Zimnica"]);
  });

  it("deletes a shelf and its memberships, and leaves every recipe on it", () => {
    const profileId = createProfile("A");
    const shelves = new CollectionStore(db.raw, profileId);
    const recipeId = createRecipe(profileId, "Ajvar");
    const shelf = shelves.create("Zimnica", NOW);
    shelves.setMember(shelf.id, recipeId, true, NOW);

    shelves.remove(shelf.id);

    expect(shelves.list()).toEqual([]);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM cookbook_collection_recipes").get()).toEqual({
      n: 0,
    });
    expect(new RecipeStore(db.raw, profileId).get(recipeId).title).toBe("Ajvar");
  });

  it("throws a not-found for a shelf this profile does not hold", () => {
    const owner = new CollectionStore(db.raw, createProfile("A"));
    const other = new CollectionStore(db.raw, createProfile("B"));
    const shelf = owner.create("Zimnica", NOW);

    expect(() => other.rename(shelf.id, "Ukradeno", NOW)).toThrow(RecipeNotFoundError);
    expect(() => other.remove(shelf.id)).toThrow(RecipeNotFoundError);
    expect(owner.list()).toHaveLength(1);
  });
});

describe("membership", () => {
  it("puts a recipe on several shelves and takes it off one at a time", () => {
    const profileId = createProfile("A");
    const shelves = new CollectionStore(db.raw, profileId);
    const recipeId = createRecipe(profileId, "Sarma");
    const winter = shelves.create("Zima", NOW);
    const family = shelves.create("Porodično", NOW);

    shelves.setMember(winter.id, recipeId, true, NOW);
    shelves.setMember(family.id, recipeId, true, NOW);
    shelves.setMember(family.id, recipeId, true, LATER);
    expect(shelves.list().map((shelf) => shelf.recipeIds)).toEqual([[recipeId], [recipeId]]);

    // Shelves come back by name: "Porodično" before "Zima".
    shelves.setMember(winter.id, recipeId, false, NOW);
    expect(shelves.list().map((shelf) => shelf.recipeIds)).toEqual([[recipeId], []]);
  });

  it("refuses a recipe or a shelf that is not live in this profile", () => {
    const mine = createProfile("A");
    const theirs = createProfile("B");
    const shelves = new CollectionStore(db.raw, mine);
    const shelf = shelves.create("Zimnica", NOW);
    const foreign = createRecipe(theirs, "Tuđi recept");

    expect(() => shelves.setMember(shelf.id, foreign, true, NOW)).toThrow(RecipeNotFoundError);
    expect(() => shelves.setMember("nema-takvog", foreign, true, NOW)).toThrow(RecipeNotFoundError);
  });

  it("hides a soft-deleted recipe from its shelves and restores it to them", () => {
    const profileId = createProfile("A");
    const recipes = new RecipeStore(db.raw, profileId);
    const shelves = new CollectionStore(db.raw, profileId);
    const recipeId = createRecipe(profileId, "Sarma");
    const shelf = shelves.create("Zimnica", NOW);
    shelves.setMember(shelf.id, recipeId, true, NOW);

    recipes.softDelete(recipeId, LATER);
    expect(shelves.list()[0]?.recipeIds).toEqual([]);

    recipes.restore(recipeId, LATER);
    expect(shelves.list()[0]?.recipeIds).toEqual([recipeId]);
  });
});

describe("the pack seed", () => {
  it("creates the pack's shelf once, and a second copy finds it rather than making another", () => {
    const profileId = createProfile("A");
    const shelves = new CollectionStore(db.raw, profileId);

    const first = shelves.seed("recipes-fixture", "Konzervisanje", NOW);
    const again = shelves.seed("recipes-fixture", "Konzervisanje", LATER);

    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ name: "Konzervisanje", sourcePack: "recipes-fixture" });
    expect(shelves.list()).toHaveLength(1);
  });

  it("keeps a rename: the seed is found by its pack, not its name", () => {
    const profileId = createProfile("A");
    const shelves = new CollectionStore(db.raw, profileId);
    const seeded = shelves.seed("recipes-fixture", "Konzervisanje", NOW);
    shelves.rename(seeded.id, "Moje konzerve", LATER);

    const found = shelves.seed("recipes-fixture", "Konzervisanje", LATER);
    expect(found).toMatchObject({ id: seeded.id, name: "Moje konzerve" });
    expect(shelves.list()).toHaveLength(1);
  });

  it("gives each profile its own seeded shelf for the same pack", () => {
    const first = new CollectionStore(db.raw, createProfile("A")).seed("recipes-fixture", "Konzervisanje", NOW);
    const second = new CollectionStore(db.raw, createProfile("B")).seed("recipes-fixture", "Konzervisanje", NOW);
    expect(second.id).not.toBe(first.id);
  });
});
