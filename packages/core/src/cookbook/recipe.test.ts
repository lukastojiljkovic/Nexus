import { describe, expect, it } from "vitest";
import {
  COOKBOOK_COURSES,
  PUBLIC_DOMAIN_LICENCE_ID,
  RECIPE_SOURCES,
  isRecipeLicenceId,
} from "./recipe.js";

describe("the recipe vocabulary", () => {
  it("is the eleven courses the module ships, closed and distinct", () => {
    expect([...COOKBOOK_COURSES]).toEqual([
      "breakfast",
      "starter",
      "soup",
      "main",
      "side",
      "salad",
      "dessert",
      "baking",
      "drink",
      "preserve",
      "other",
    ]);
    expect(new Set(COOKBOOK_COURSES).size).toBe(COOKBOOK_COURSES.length);
  });

  it("has exactly two provenances, because a recipe is either yours or somebody else's", () => {
    expect([...RECIPE_SOURCES]).toEqual(["own", "imported"]);
  });
});

describe("isRecipeLicenceId", () => {
  it("accepts the SPDX identifiers a recipe source actually carries", () => {
    expect(isRecipeLicenceId("MIT")).toBe(true);
    expect(isRecipeLicenceId("CC-BY-SA-4.0")).toBe(true);
    expect(isRecipeLicenceId("CC0-1.0")).toBe(true);
    expect(isRecipeLicenceId("0BSD")).toBe(true);
    expect(isRecipeLicenceId("GPL-3.0-or-later")).toBe(true);
    expect(isRecipeLicenceId("Apache-2.0")).toBe(true);
    // SPDX spells a licence nobody has published yet this way, and a source
    // that carries one is being honest rather than citing something it is not.
    expect(isRecipeLicenceId("LicenseRef-PublicDomain")).toBe(true);
  });

  it("accepts the module's own name for a work with no licence to cite", () => {
    expect(isRecipeLicenceId(PUBLIC_DOMAIN_LICENCE_ID)).toBe(true);
  });

  it("refuses anything that is not an identifier", () => {
    expect(isRecipeLicenceId("")).toBe(false);
    expect(isRecipeLicenceId(" CC-BY-SA-4.0")).toBe(false);
    expect(isRecipeLicenceId("CC BY SA")).toBe(false);
    expect(isRecipeLicenceId("-MIT")).toBe(false);
    expect(isRecipeLicenceId("MIT/")).toBe(false);
    expect(isRecipeLicenceId("https://example.org/licence")).toBe(false);
    expect(isRecipeLicenceId("x".repeat(65))).toBe(false);
  });
});
