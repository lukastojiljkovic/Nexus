import { describe, expect, it } from "vitest";

import { recipesFrom, sentencesOf } from "./lib/recipes.mjs";

/**
 * The Cookbook's Preserving collection, built from blocks.
 *
 * The blocks below are the shape Guide 6's page produces — an upper-case
 * heading, the ingredient lines under it, then `Procedure:` — with the guide's
 * own sentences as the content, so the expected values are the input's own
 * words. The point of testing it here rather than through the PDF is that the
 * rule being tested is about BLOCKS: which heading opens a recipe, what counts
 * as an ingredient, and where the steps come from.
 */
const SOURCE = {
  title: "Complete Guide to Home Canning, Revised 2015 (AIB No. 539), Guide 6",
  url: "https://nchfp.uga.edu/papers/guide/GUIDE06_HomeCan_rev0715.pdf",
  licence: "public-domain",
  attribution: "USDA. Procedure reproduced unmodified.",
};

const heading = (text) => ({ kind: "heading", level: 3, text });
const paragraph = (text, lines = []) => ({ kind: "paragraph", text, lines });
const line = (text) => ({ text, x: 63, y: 0 });

describe("sentencesOf", () => {
  it("splits at the guide's own full stops and nowhere else", () => {
    // A hand-checkable case: four sentences, one of them containing a
    // parenthesised aside and one ending in a question mark.
    const procedure =
      "Wash asparagus well. Cut stems to fit the jar (about 1/2 inch). Is the water boiling? " +
      "Pour the brine over the spears.";
    expect(sentencesOf(procedure)).toEqual([
      "Wash asparagus well.",
      "Cut stems to fit the jar (about 1/2 inch).",
      "Is the water boiling?",
      "Pour the brine over the spears.",
    ]);
  });

  it("does not split on a decimal point or an abbreviation's full stop", () => {
    // `1.5 cups` and `tsp.` are not sentence ends; the lookahead requires a
    // capital letter or an opening bracket after the space.
    expect(sentencesOf("Add 1.5 cups sugar and 2 tsp. salt. Bring to a boil.")).toEqual([
      "Add 1.5 cups sugar and 2 tsp. salt.",
      "Bring to a boil.",
    ]);
  });
});

describe("recipesFrom", () => {
  const blocks = [
    heading("PICKLED CARROTS"),
    paragraph("2-3/4 lbs peeled carrots", [line("2-3/4 lbs peeled carrots")]),
    paragraph("5-1/2 cups white vinegar (5%) 1 cup water", [
      line("5-1/2 cups white vinegar (5%)"),
      line("1 cup water"),
    ]),
    paragraph("Yield: About 4 pints"),
    paragraph("Procedure: Wash and peel carrots. Cut into rounds. Adjust lids and process."),
    heading("PICKLED BABY CARROTS"),
    paragraph("Procedure: Follow directions for Pickled Carrots."),
  ];

  it("makes one recipe per heading that has both ingredients and a procedure", () => {
    const recipes = recipesFrom(blocks, SOURCE);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].id).toBe("pickled-carrots");
    expect(recipes[0].title).toBe("Pickled carrots");
    expect(recipes[0].language).toBe("en");
  });

  it("keeps the guide's ingredient lines, split at the lines that begin with a quantity", () => {
    // The reader joins consecutive lines of equal leading into one paragraph
    // because the guide sets an ingredient list that way; this is where the
    // lines come apart again, and the quantities are what does it.
    expect(recipesFrom(blocks, SOURCE)[0].ingredients).toEqual([
      "2-3/4 lbs peeled carrots",
      "5-1/2 cups white vinegar (5%)",
      "1 cup water",
    ]);
  });

  it("keeps the procedure's own sentences as the steps", () => {
    expect(recipesFrom(blocks, SOURCE)[0].steps).toEqual([
      "Wash and peel carrots.",
      "Cut into rounds.",
      "Adjust lids and process.",
    ]);
  });

  it("leaves out `Yield:` and the guide's `Procedure:` label", () => {
    const recipe = recipesFrom(blocks, SOURCE)[0];
    expect(JSON.stringify(recipe)).not.toContain("Yield");
    expect(recipe.steps[0]).not.toContain("Procedure:");
  });

  it("refuses a heading with a procedure but no ingredients", () => {
    // "Preparing pickled and fermented foods" is an instruction, not something a
    // person cooks from, and a cookbook entry for it would be a lie about what
    // the guide offers.
    const onlyProcedure = [heading("PICKLED BABY CARROTS"), paragraph("Procedure: Follow directions.")];
    expect(recipesFrom(onlyProcedure, SOURCE)).toEqual([]);
  });

  it("refuses a recipe whose page the reader could not read", () => {
    // A page whose table text is ambiguous is emitted as a block of its own
    // lines; a step assembled out of a page the reader refused to interpret is a
    // step nobody checked.
    const withVerbatimPage = [
      heading("PICKLED BEETS"),
      paragraph("7 lbs of beets", [line("7 lbs of beets")]),
      { kind: "code", lines: ["Recommended process time for Pickled Beets in a boiling-water canner"] },
      paragraph("Procedure: Trim off beet tops. Process."),
    ];
    expect(recipesFrom(withVerbatimPage, SOURCE)).toEqual([]);
  });
});

describe("the Cookbook's recipes.json layout", () => {
  /**
   * The file the builder writes is `{ layout: 1, recipes: [...] }`. The rules
   * below are the ones the layout names, applied to the builder's own output
   * over a Guide-6-shaped block list rather than to a file on disk, so this test
   * needs nothing but the repository.
   */
  const blocks = [
    heading("SAUERKRAUT"),
    paragraph("25 lbs cabbage 3/4 cup canning or pickling salt", [
      line("25 lbs cabbage"),
      line("3/4 cup canning or pickling salt"),
    ]),
    paragraph(
      "Procedure: Work with about 5 pounds of cabbage at a time. Discard outer leaves. " +
        "Rinse heads under cold running water and drain. Cut heads in quarters and remove cores.",
    ),
  ];
  const recipes = recipesFrom(blocks, SOURCE);
  const file = { layout: 1, recipes };

  it("is version 1 with at least one recipe in it", () => {
    expect(file.layout).toBe(1);
    expect(file.recipes.length).toBeGreaterThan(0);
  });

  it("gives every recipe the fields the layout names, and no others", () => {
    for (const recipe of file.recipes) {
      expect(Object.keys(recipe).sort()).toEqual([
        "id",
        "ingredients",
        "language",
        "source",
        "steps",
        "tags",
        "title",
      ]);
      expect(recipe.language).toBe("en");
      expect(recipe.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(recipe.ingredients.length).toBeGreaterThan(1);
      expect(recipe.steps.length).toBeGreaterThan(1);
      expect(recipe.tags).toContain("preserving");
      expect(Object.keys(recipe.source).sort()).toEqual(["attribution", "licence", "title", "url"]);
      expect(recipe.source.licence).toBe("public-domain");
    }
  });

  it("keeps sauerkraut's own salt ratio, which is what makes it safe", () => {
    // The research's E45/E46: 3/4 cup of pickling salt to 25 lb of cabbage. It
    // arrives as the guide's own ingredient line, and a recipe that lost it
    // would be a recipe that lost the one figure a fermenter must not cut back.
    expect(recipes[0].ingredients).toContain("3/4 cup canning or pickling salt");
    expect(recipes[0].steps[0]).toBe("Work with about 5 pounds of cabbage at a time.");
  });

  it("has no two recipes under one id", () => {
    const ids = recipes.map((recipe) => recipe.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("invents no Serbian preserve, because none was sourced", () => {
    // The brief is explicit: no ajvar, turšija, slatko or pekmez, because no
    // openly licensed Serbian source for them was found, and a recipe nobody
    // sourced is exactly what must not be invented.
    const text = JSON.stringify(file).toLowerCase();
    for (const word of ["ajvar", "turšija", "tursija", "slatko", "pekmez"]) {
      expect(text).not.toContain(word);
    }
  });
});
