import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NexusDatabase, RecipeStore, openDatabase, uuidv7 } from "@nexus/db";
import type { Tool, ToolContext } from "@nexus/core";
import { cookbookTools } from "./cookbook.js";

/**
 * The COOKBOOK tools over a real database.
 *
 * The match is the app's own folding table and the order is this file's
 * decision (a title match first), so these tests pin both: that „brasno" finds
 * „Brašno", that an ingredient hit says which ingredient it was, and that a
 * recipe is read out with its own ingredient lines rather than summarised.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-cookbook-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function store(): RecipeStore {
  return new RecipeStore(db.raw, profileId);
}

function context(locale: "sr" | "en"): ToolContext {
  return {
    profileId,
    locale,
    signal: new AbortController().signal,
    confirm: () => Promise.resolve(true),
  };
}

function toolOf(name: string): Tool {
  const found = cookbookTools({ profileDb: (id, open) => open(db.raw, id) }).find(
    (entry) => entry.name === name,
  );
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

/** One seeded recipe: „Pogača", whose second ingredient is the flour the search is about. */
function seedPogaca(): string {
  const recipe = store().create(
    {
      title: "Pogača",
      course: "baking",
      servings: 8,
      prepMinutes: 20,
      cookMinutes: 30,
      ingredients: [
        { name: "kvasac", quantity: 20, unit: "g" },
        { name: "Brašno", quantity: 0.5, unit: "kg", rawText: "0,5 kg brašna" },
      ],
      steps: [{ text: "Zamesi testo." }, { text: "Peci 30 minuta.", timerMinutes: 30 }],
      tags: ["pecivo"],
      source: "own",
    },
    NOW_ISO,
  );
  return recipe.id;
}

describe("cookbook.search", () => {
  it("finds a recipe through an ingredient and says which one it was", async () => {
    seedPogaca();
    const result = await toolOf("cookbook.search").run(
      { query: "brasno" },
      context("sr"),
    );
    expect(result).toEqual({
      ok: true,
      content: [
        "Recepti (1):",
        "- Pogača (Pekara, porcija: 8, 50 min, sastojaka: 2, sastojak „Brašno“)",
      ].join("\n"),
    });
  });

  it("ranks a title match above an ingredient match", async () => {
    seedPogaca();
    store().create(
      {
        title: "Brašnena torta",
        course: "dessert",
        servings: 6,
        ingredients: [{ name: "jaja", quantity: 3 }],
        steps: [{ text: "Umutiti." }],
        source: "own",
      },
      NOW_ISO,
    );

    // „brašn" rather than „brašno": the folded query has to be a substring of BOTH
    // the title („Brašnena torta") and the ingredient („Brašno"), which is what
    // makes this a ranking test rather than a two-query test.
    const result = await toolOf("cookbook.search").run({ query: "brašn" }, context("sr"));
    expect(result.content).toBe(
      [
        "Recepti (2):",
        "- Brašnena torta (Dezert, porcija: 6, sastojaka: 1)",
        "- Pogača (Pekara, porcija: 8, 50 min, sastojaka: 2, sastojak „Brašno“)",
      ].join("\n"),
    );
  });

  it("says the cookbook is empty, and says which query matched nothing", async () => {
    const empty = await toolOf("cookbook.search").run({ query: "hleb" }, context("en"));
    expect(empty).toEqual({ ok: true, content: "The cookbook holds no recipe yet." });

    seedPogaca();
    const none = await toolOf("cookbook.search").run({ query: "pizza" }, context("en"));
    expect(none).toEqual({
      ok: true,
      content:
        "None of the 1 recipes matches the search “pizza” (a title, a tag or an ingredient).",
    });
  });
});

describe("cookbook.recipe", () => {
  it("reads one recipe out with its own ingredient lines and numbered steps", async () => {
    seedPogaca();
    const result = await toolOf("cookbook.recipe").run({ recipe: "Pogača" }, context("sr"));
    expect(result).toEqual({
      ok: true,
      content: [
        "Pogača:",
        "Pekara, porcija: 8",
        "",
        "Sastojci:",
        "- 20 g kvasac",
        "- 0,5 kg Brašno",
        "",
        "Postupak:",
        "1. Zamesi testo.",
        "2. Peci 30 minuta.",
      ].join("\n"),
    });
  });

  it("refuses a recipe it does not have, naming the ones it does", async () => {
    seedPogaca();
    const result = await toolOf("cookbook.recipe").run({ recipe: "Pizza" }, context("en"));
    expect(result).toEqual({
      ok: false,
      content: "Failed: No recipe “Pizza” in the cookbook. The recipes: Pogača.",
    });
  });
});
