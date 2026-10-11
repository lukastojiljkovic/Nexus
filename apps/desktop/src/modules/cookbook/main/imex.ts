import {
  COOKBOOK_EXPORT_VERSION,
  DEFAULT_UNIT_SYSTEM,
  parseCookbookExport,
  type CookbookExport,
  type RecipeStore,
} from "@nexus/db";

/**
 * COOKBOOK's archive section (ADR-090 §imex): what one module puts in
 * `data/modules.ndjson`, and the only reader of it.
 *
 * **Why this file is thin, and that is the point.** The store already owns the
 * format: stage 1 built `RecipeStore.exportData`/`importData` around
 * `COOKBOOK_EXPORT_VERSION`, with every field validated whole before anything
 * is written. So the module's section IS that value — a version, the recipes,
 * the module's one preference and the remembered ingredient links — rather than
 * a second envelope wrapped around it, which would be a second version number
 * and a second shape to keep in step.
 *
 * **`parse` is the store's own reader**, the same `parseCookbookExport` that
 * `importData` runs one moment later. The kit requires `parse` to be pure and
 * total and runs it twice — at the preview, so the user hears a refusal before
 * confirming a restore that replaces their profile, and again before any module
 * writes. Handing that job to the store's validator is what makes „the preview
 * accepted it" and „the write accepted it" the same sentence.
 *
 * **`undefined` is EMPTY, not „unchanged".** A restore replaces a profile whole,
 * so an archive that names no cookbook section restores to a profile with no
 * recipes, the shipped preference and no links — which is what `apply` writes.
 */

/** What `exportData` hands the archive: this module's whole payload, read from the store. */
export function buildCookbookExport(store: RecipeStore): CookbookExport {
  return store.exportData();
}

/** The payload a restore with no COOKBOOK section leaves behind: empty, with the shipped preference. */
export function emptyCookbookExport(): CookbookExport {
  return {
    version: COOKBOOK_EXPORT_VERSION,
    recipes: [],
    settings: { unitSystem: DEFAULT_UNIT_SYSTEM, updatedAt: null },
    foodMatches: [],
  };
}

/** The pure half: the store's own whole-payload reader, exported for the host to run at the preview. */
export { parseCookbookExport };
