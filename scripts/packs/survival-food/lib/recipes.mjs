// The Cookbook's "Preserving" collection, cut out of Guide 6.
//
// WHY GUIDE 6 AND NOTHING ELSE. The brief for this pack is the research's
// findings: the only preserving instruction set that can be both shipped and
// defended is the USDA guide's own, and the only sauerkraut procedure with a
// public-domain source is the guide's. There is deliberately no ajvar, turšija,
// slatko or pekmez here — no Serbian preserving source was found with a licence
// that permits shipping, and a recipe nobody sourced is exactly what the pack's
// rules forbid inventing.
//
// WHAT A RECIPE IS, READ OFF THE GUIDE'S OWN LAYOUT. A recipe is an upper-case
// heading ("PICKLED CARROTS"), the ingredient lines under it, an optional
// "Yield:" line, and a "Procedure:" paragraph. The steps are the procedure's own
// sentences: the guide writes them as sentences and this splits at its full
// stops and nowhere else, so every step is a string the guide printed.

import { normalise } from "./text.mjs";

/** The sentences of a procedure, split at its own full stops and nowhere else. */
export function sentencesOf(procedure) {
  const parts = procedure
    .split(/(?<=[.!?])\s+(?=[A-Z“"(])/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return parts;
}

/**
 * The recipes of a converted guide.
 *
 * `blocks` is Guide 6's block list; `source` is the recipe's provenance, which
 * is the guide itself. A candidate is kept only when it has BOTH an ingredient
 * list and a procedure — a heading with a procedure but no ingredients is a
 * general instruction ("Preparing pickled and fermented foods"), not something a
 * person cooks from, and a cookbook entry for it would be a lie about what the
 * guide offers.
 */
export function recipesFrom(blocks, source) {
  const recipes = [];
  let current = null;
  const flush = () => {
    if (current === null) return;
    const ingredients = current.lines.filter((line) => line.ingredient);
    const procedure = current.procedure.join(" ").trim();
    if (ingredients.length >= 2 && procedure !== "") {
      const steps = sentencesOf(procedure);
      if (steps.length >= 2) {
        recipes.push({
          id: current.id,
          title: current.title,
          language: "en",
          ingredients: ingredients.map((line) => line.text),
          steps,
          tags: ["preserving", "home-canning", "usda-complete-guide"],
          source,
        });
      }
    }
    current = null;
  };
  for (const block of blocks) {
    if (block.kind === "heading" && block.level >= 3) {
      flush();
      current = {
        id: slugOf(block.text),
        title: titleOf(block.text),
        lines: [],
        procedure: [],
      };
      continue;
    }
    if (current === null) continue;
    if (block.kind === "code") {
      // A page whose layout the reader refused to interpret also refuses to
      // yield a recipe: a step assembled from a page the reader could not read
      // is a step nobody checked.
      flush();
      continue;
    }
    const text = block.kind === "table" ? "" : (block.text ?? "");
    if (text === "") continue;
    if (/^Procedure:\s*/.test(text)) {
      current.procedure.push(text.replace(/^Procedure:\s*/, ""));
      continue;
    }
    if (/^Yield:/.test(text) || /^Quantity:|^Quality:|^Caution:|^Note,/.test(text)) continue;
    if (current.procedure.length > 0) {
      // Text after the procedure belongs to the next recipe's preamble or to the
      // guide's own notes; it is not an ingredient.
      continue;
    }
    // A paragraph of a recipe page may hold SEVERAL ingredient lines: the guide
    // sets them one under another at the same leading as a wrapped sentence, so
    // the reader joins them and this splits them again — at the lines that begin
    // with a quantity, which is what makes an ingredient an ingredient.
    const lines = block.lines ?? [];
    if (lines.length > 1 && lines.some((line) => isIngredient(line.text))) {
      for (const line of lines) {
        current.lines.push({ text: line.text, ingredient: isIngredient(line.text) });
      }
      continue;
    }
    current.lines.push({ text, ingredient: isIngredient(text) });
  }
  flush();
  return recipes;
}

/**
 * Whether a line reads like an ingredient.
 *
 * The guide's ingredient lines begin with a quantity — `2-3/4 lbs peeled
 * carrots`, `1 cup water`, `8 tsp mustard seed` — and its other lines begin with
 * a capitalised word that is not a unit. The test is deliberately shallow: it
 * decides only whether a line joins the ingredient list, and a line it gets
 * wrong is still in the article the pack ships, verbatim.
 */
function isIngredient(text) {
  return /^(\d|one|two|three|four|five|six|seven|eight|nine|ten|half|about|up to|\d+\s*(?:to|-)\s*\d+)/i.test(
    text,
  );
}

/** `PICKLED BABY CARROTS` → `pickled-baby-carrots`. */
function slugOf(text) {
  return normalise(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** `PICKLED BABY CARROTS` → `Pickled baby carrots`, the register of a recipe title. */
function titleOf(text) {
  const lower = normalise(text).toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
