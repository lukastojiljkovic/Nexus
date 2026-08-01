import { describe, expect, it } from "vitest";
import { catalogueFood, FOOD_CATALOGUE } from "./catalogue.js";
import { FOOD_CATEGORIES, validateFoodEntry } from "./food.js";

/**
 * THE gate on `data/catalogue.json`.
 *
 * That file is replaced wholesale as the dataset grows — several hundred entries
 * produced away from this repository — and nothing else between it and a shipped
 * build looks at a single number in it. So this suite is not a formality: it is
 * the reason `FOOD_CATALOGUE` may assert its type instead of parsing at startup,
 * and the reason dropping an unreviewed dataset in here is a safe thing to do.
 *
 * It deliberately asserts NOTHING about which foods are present. A test that
 * expected „Šargarepa" would fail the next time somebody reorganised the
 * dataset, and would be teaching the file to hold still rather than to be right.
 */
describe("the shipped food catalogue", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(FOOD_CATALOGUE)).toBe(true);
    expect(FOOD_CATALOGUE.length).toBeGreaterThan(0);
  });

  it("carries no entry that fails validateFoodEntry", () => {
    const failures = FOOD_CATALOGUE.flatMap((food, index) =>
      validateFoodEntry(food).map(
        (problem) =>
          `[${index}] ${String((food as { id?: unknown }).id)} — ${problem.field}: ${problem.code}`,
      ),
    );
    expect(failures).toEqual([]);
  });

  it("carries no duplicate id — the reference a logged meal keeps must resolve to one food", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const food of FOOD_CATALOGUE) {
      if (seen.has(food.id)) duplicates.push(food.id);
      seen.add(food.id);
    }
    expect(duplicates).toEqual([]);
  });

  it("uses only declared categories", () => {
    const unknown = FOOD_CATALOGUE.map((food) => food.category).filter(
      (category) => !(FOOD_CATEGORIES as readonly string[]).includes(category),
    );
    expect(unknown).toEqual([]);
  });

  it("cites an openable source for every entry, components included", () => {
    const bad: string[] = [];
    for (const food of FOOD_CATALOGUE) {
      // A `stated` food carries no url on purpose — it is a founder-decided
      // figure where no public source exists, and a url would imply a
      // measurement nobody made. It is held to its own requirement below.
      if (food.source.kind === "stated") continue;
      const urls =
        food.source.kind === "derived"
          ? food.source.recipe.map((component) => component.url)
          : [food.source.url];
      for (const url of urls) {
        if (!/^https:\/\//.test(url)) bad.push(`${food.id}: ${url}`);
      }
    }
    expect(bad).toEqual([]);
  });

  // The `stated` kind is the one place the catalogue ships a number nobody
  // published, so it is the one place the uncertainty has to travel WITH the
  // value. Stripped of its basis or its range, a stated food is indistinguishable
  // from a measured one — which is exactly how an exception becomes a loophole.
  it("makes every stated food declare its basis, its range, and its variance in the note", () => {
    const stated = FOOD_CATALOGUE.filter((food) => food.source.kind === "stated");
    // Kajmak is the only one, and a second arriving without a founder decision
    // behind it should make somebody read this test before changing the number.
    expect(stated.map((food) => food.id)).toEqual(["kajmak"]);
    for (const food of stated) {
      if (food.source.kind !== "stated") continue;
      expect(food.source.basis.trim().length).toBeGreaterThan(0);
      expect(food.source.range.trim().length).toBeGreaterThan(0);
      // The user has to be told on the screen, not only in the type.
      expect(food.notes).toMatch(/varira|postavljena/i);
      // And it must carry no url: a citation here would claim a measurement
      // that does not exist, which is the whole thing this kind refuses to do.
      expect("url" in food.source).toBe(false);
    }
  });

  it("resolves every one of its own ids, and nothing else", () => {
    for (const food of FOOD_CATALOGUE) {
      expect(catalogueFood(food.id)).toBe(food);
    }
    expect(catalogueFood("nema-ovoga")).toBeUndefined();
  });
});
