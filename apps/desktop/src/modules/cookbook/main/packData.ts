import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type FoodMacros, foldSearchText, isRecipeLicenceId, parseFoodRef } from "@nexus/core";
import { packVersionDir, readInstalled } from "../../../main/packs/registry.js";
import type { PackManifest } from "../../../main/packs/manifest.js";
import { packPathProblem } from "../../../main/packs/paths.js";

/**
 * The two dataset files a COOKBOOK pack may carry, and the readers for them.
 *
 * **Why this module reads packs at all.** ADR-091 puts installed packs outside
 * the profile database — one folder per pack under `<userData>/packs`, verified
 * once by signature — and says a content reader discovers a corrupted file when
 * something tries to read it. This is that reader for the cookbook's two files:
 * `recipes.json` (a corpus of recipes to browse and copy) and `foods.json` (the
 * per-100 g table nutrition is computed against). It walks the SAME installed
 * index the Packs card draws (`main/packs/registry.ts`), so a folder somebody
 * edited by hand stops being listed here for the same reason it stops being
 * listed there, and it re-checks every path through `packPathProblem` before it
 * joins it — a manifest is signed, but a join is a join.
 *
 * **Both layouts are version 1, and the number is checked rather than guessed.**
 * `{ layout: 1, recipes: [...] }` and `{ layout: 1, foods: [...] }`. A document
 * claiming another layout is refused by name, exactly as a pack manifest with an
 * unknown `format` is: a layout change is the case where reading on would give a
 * field a meaning it does not have.
 *
 * **Strict about what it reads, tolerant of what it does not.** Every field
 * below is validated — its type, its bounds, and (for a food id) the grammar the
 * module will have to store it under — and a document that breaks any rule is
 * refused WHOLE, with the index of the entry that broke it. An extra key is
 * ignored, because the pack's builder is another run of this product and the day
 * it wants to carry a citation nobody reads, refusing the pack would be the
 * wrong kind of strict.
 *
 * **The caps are the STORE's, not decoration.** A recipe read here can always be
 * copied into the user's cookbook: the line counts, the tag count and every
 * length are the ones migration 076's CHECKs and `RecipeStore` enforce. A pack
 * that states 101 steps is refused at the door with a sentence saying so,
 * rather than accepted and then failing at the moment the user presses save.
 *
 * Nothing here reads a pack's CONTENT hashes: ADR-091 §5 re-checks those only
 * when the user asks, and a browse is not that ask. What is verified on the way
 * in is what the index itself verified — the manifest's signature.
 */

/** One content file's name is looked for at any depth; the shallowest listing wins (see `datasetFile`). */
export const RECIPES_FILE_NAME = "recipes.json";
export const FOODS_FILE_NAME = "foods.json";

/** The only layout number this build reads, for both files. */
export const DATASET_LAYOUT_VERSION = 1;

/**
 * How large a dataset JSON may be, before it is refused without being parsed.
 * 64 MiB is roughly two hundred thousand food rows — past anything the USDA
 * build this file is for would ship, and far below the point where reading it
 * into one string would be the interesting part of the operation.
 */
const MAX_DATASET_BYTES = 64 * 1024 * 1024;

/** Bounds on a hostile document: far past a real corpus, far below a file that would make the app unusable. */
const MAX_FOODS = 200_000;
const MAX_RECIPES = 50_000;

/** The caps migration 076 and `RecipeStore` enforce, so a copied recipe can never be refused by the store. */
const MAX_TITLE = 120;
const MAX_TEXT = 500;
const MAX_STEP_TEXT = 2_000;
const MAX_TAGS = 20;
const MAX_TAG = 40;
const MAX_INGREDIENTS = 100;
const MAX_STEPS = 100;
const MAX_SERVINGS = 100;
const MAX_ID = 200;
const MAX_LICENCE_TEXT = 200;
const MAX_LICENCE_URL = 500;
const MAX_ATTRIBUTION = 500;
const MAX_LICENCE_ID = 64;

/** Sodium in one gram of salt, in milligrams. M(Na) 22.99 / M(NaCl) 58.44 = 0.3934 — so 1 g of salt carries 393.4 mg of sodium. */
const SODIUM_MG_PER_SALT_G = 393.4;

/** One food as a `foods.json` pack carries it: what 100 g of it carries, plus its names. */
export interface PackFood {
  readonly id: string;
  /** The Serbian name, or null when the pack carries only the English one. */
  readonly nameSr: string | null;
  readonly nameEn: string;
  readonly per100g: FoodMacros;
}

/** Where a pack recipe came from — the citation a copy keeps, in the layout's own four fields. */
export interface PackRecipeSource {
  readonly title: string;
  readonly url: string;
  readonly licence: string;
  readonly attribution: string;
}

/** One recipe as a `recipes.json` pack carries it: strings, because a pack is data rather than a document. */
export interface PackRecipe {
  readonly id: string;
  readonly title: string;
  readonly language: string;
  readonly servings: number | null;
  readonly ingredients: readonly string[];
  readonly steps: readonly string[];
  readonly tags: readonly string[];
  readonly source: PackRecipeSource;
}

/** One installed `dataset` pack, with its folder and its manifest. */
export interface InstalledDataset {
  readonly manifest: PackManifest;
  readonly dir: string;
}

/** A `dataset` pack that carries recipes, read and validated. */
export interface RecipesDataset extends InstalledDataset {
  readonly recipes: readonly PackRecipe[];
}

/** A `dataset` pack that carries foods, read and validated. */
export interface FoodsDataset extends InstalledDataset {
  readonly foods: readonly PackFood[];
}

/**
 * Every installed `dataset` pack, with the folder each one lives in.
 *
 * The kind filter is the first gate and it is deliberate: a `zim` or a `map`
 * pack is content this module has no business opening, and asking the index —
 * rather than walking `<userData>/packs` — is what makes „installed" mean what
 * the Packs card means by it.
 */
export function installedDatasets(userData: string, publicKeyPem: string): InstalledDataset[] {
  return readInstalled(userData, publicKeyPem)
    .filter((pack) => pack.manifest.kind === "dataset")
    .map((pack) => ({
      manifest: pack.manifest,
      dir: packVersionDir(userData, pack.manifest.id, pack.manifest.version),
    }));
}

/**
 * The file in a pack that a reader is looking for, or null when the pack lists
 * none.
 *
 * The comparison is on the LAST path segment, so a pack may keep its data at the
 * root or under `data/`; the shallowest match wins so a pack that carries both
 * `foods.json` and `vendor/foods.json` reads the one it wrote for this app
 * rather than the one it vendored.
 */
export function datasetFile(manifest: PackManifest, fileName: string): string | null {
  const matches = manifest.files
    .map((file) => file.path)
    .filter((path) => path.split("/").at(-1) === fileName);
  matches.sort((left, right) => left.split("/").length - right.split("/").length);
  return matches[0] ?? null;
}

/** One pack's recipes, or null when this pack carries no recipes file. */
export function readRecipesDataset(dataset: InstalledDataset): RecipesDataset | null {
  const path = datasetFile(dataset.manifest, RECIPES_FILE_NAME);
  if (path === null) return null;
  const value = readDatasetJson(dataset.dir, path, dataset.manifest.id);
  return { ...dataset, recipes: parseRecipesLayout(value, dataset.manifest.id) };
}

/** One pack's foods, or null when this pack carries no foods file. */
export function readFoodsDataset(dataset: InstalledDataset): FoodsDataset | null {
  const path = datasetFile(dataset.manifest, FOODS_FILE_NAME);
  if (path === null) return null;
  const value = readDatasetJson(dataset.dir, path, dataset.manifest.id);
  return { ...dataset, foods: parseFoodsLayout(value, dataset.manifest.id) };
}

/** Every installed recipes pack, in the index's own order. */
export function loadRecipesPacks(userData: string, publicKeyPem: string): RecipesDataset[] {
  const packs: RecipesDataset[] = [];
  for (const dataset of installedDatasets(userData, publicKeyPem)) {
    const read = readRecipesDataset(dataset);
    if (read !== null) packs.push(read);
  }
  return packs;
}

/** Every installed foods pack, in the index's own order. */
export function loadFoodsPacks(userData: string, publicKeyPem: string): FoodsDataset[] {
  const packs: FoodsDataset[] = [];
  for (const dataset of installedDatasets(userData, publicKeyPem)) {
    const read = readFoodsDataset(dataset);
    if (read !== null) packs.push(read);
  }
  return packs;
}

/**
 * One JSON file out of a pack folder, read whole and parsed.
 *
 * The path is checked again here even though the manifest it came from was
 * validated at install time: this is the JOIN, and `packPathProblem` is the one
 * statement of what a pack path may be. The size is taken from the file itself
 * before the bytes are read, so a file that lies about its size in the manifest
 * is refused rather than loaded.
 */
/** Documents already read this session, keyed by path (see `readDatasetJson`). Small: one entry per dataset file. */
const JSON_CACHE = new Map<string, { key: string; value: unknown }>();

export function readDatasetJson(dir: string, relPath: string, packId: string): unknown {
  const problem = packPathProblem(relPath);
  if (problem !== null) {
    throw new Error(`Pack "${packId}" names a file this build will not open (${problem}).`);
  }
  const path = join(dir, ...relPath.split("/"));
  let size: number;
  let stamp: number;
  try {
    const stats = statSync(path);
    size = stats.size;
    stamp = stats.mtimeMs;
  } catch {
    throw new Error(`Pack "${packId}" does not carry ${relPath} any more; reinstall the pack.`);
  }
  if (size > MAX_DATASET_BYTES) {
    throw new Error(
      `Pack "${packId}": ${relPath} is ${String(size)} bytes, over this build's ${String(MAX_DATASET_BYTES)}-byte limit.`,
    );
  }
  // Parsed documents are memoised by path and by size+mtime, and the stamp is
  // what makes that safe: a pack reinstalled under the same path is a different
  // file, and a cache keyed on the path alone would keep serving yesterday's
  // nutrition until the app restarted. `foods.json` is the case that matters —
  // the picker asks on every keystroke.
  const cacheKey = `${String(size)}:${String(stamp)}`;
  const cached = JSON_CACHE.get(path);
  if (cached !== undefined && cached.key === cacheKey) return cached.value;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Pack "${packId}": ${relPath} could not be read.`);
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    JSON_CACHE.set(path, { key: cacheKey, value: parsed });
    return parsed;
  } catch {
    throw new Error(`Pack "${packId}": ${relPath} is not JSON.`);
  }
}

/**
 * Reads a `foods.json` document, whole.
 *
 * `energyKcal`, `proteinG`, `fatG` and `carbsG` are required; `fibreG`,
 * `sugarsG` and `saltG` are not, and an absent one is a genuine zero rather than
 * a guess (a food the dataset does not state fibre for carries no fibre figure,
 * and the store's `FoodMacros` has no „unknown"). `saltG` becomes `sodiumMg` by
 * the molar ratio above, because the store's table — the one the Fitness log
 * already reads — carries sodium and not salt, and leaving the field out would
 * report a zero for every food that names salt and no sodium.
 */
export function parseFoodsLayout(value: unknown, packId = "foods.json"): PackFood[] {
  const record = asRecord(value, packId, "<root>");
  requireLayout(record, packId);
  const rawFoods = record["foods"];
  if (!Array.isArray(rawFoods)) {
    throw refusal(packId, '"foods" must be an array.');
  }
  if (rawFoods.length > MAX_FOODS) {
    throw refusal(packId, `the file lists ${String(rawFoods.length)} foods; at most ${String(MAX_FOODS)} may be read.`);
  }
  const seen = new Set<string>();
  const foods: PackFood[] = [];
  rawFoods.forEach((raw, index) => {
    const field = `foods[${String(index)}]`;
    const entry = asRecord(raw, packId, field);
    const id = asText(entry["id"], packId, `${field}.id`, MAX_ID);
    // The id is what a remembered match stores (`food_ref`), and that column's
    // grammar is @nexus/core's `parseFoodRef` — so a food the module could see
    // but never remember is refused HERE, where the message can name the file.
    if (parseFoodRef(`catalogue:${id}`) === null) {
      throw refusal(packId, `"${field}.id" must be a lowercase kebab-case slug, so a match can store it.`);
    }
    if (seen.has(id)) throw refusal(packId, `"${field}.id" repeats "${id}".`);
    seen.add(id);

    const names = asRecord(entry["name"], packId, `${field}.name`);
    const nameEn = asText(names["en"], packId, `${field}.name.en`, MAX_TITLE);
    const nameSr =
      names["sr"] === undefined ? null : asText(names["sr"], packId, `${field}.name.sr`, MAX_TITLE);
    const per100g = asRecord(entry["per100g"], packId, `${field}.per100g`);
    const saltG =
      per100g["saltG"] === undefined
        ? 0
        : asNumber(per100g["saltG"], packId, `${field}.per100g.saltG`);
    foods.push({
      id,
      nameSr,
      nameEn,
      per100g: {
        kcal: asNumber(per100g["energyKcal"], packId, `${field}.per100g.energyKcal`),
        protein: asNumber(per100g["proteinG"], packId, `${field}.per100g.proteinG`),
        fat: asNumber(per100g["fatG"], packId, `${field}.per100g.fatG`),
        carbs: asNumber(per100g["carbsG"], packId, `${field}.per100g.carbsG`),
        fiber:
          per100g["fibreG"] === undefined
            ? 0
            : asNumber(per100g["fibreG"], packId, `${field}.per100g.fibreG`),
        sugar:
          per100g["sugarsG"] === undefined
            ? 0
            : asNumber(per100g["sugarsG"], packId, `${field}.per100g.sugarsG`),
        sodiumMg: saltG * SODIUM_MG_PER_SALT_G,
      },
    });
  });
  return foods;
}

/**
 * Reads a `recipes.json` document, whole.
 *
 * The ingredient and step ARRAYS are read as the strings they are: parsing a
 * line into an ingredient is the module's own parser (`parseIngredientLine`) and
 * it runs on the way into the user's cookbook, where the copy keeps the raw line
 * anyway. What is enforced here is that the copy CAN be made — the counts and
 * the lengths migration 076 holds a recipe to.
 */
export function parseRecipesLayout(value: unknown, packId = "recipes.json"): PackRecipe[] {
  const record = asRecord(value, packId, "<root>");
  requireLayout(record, packId);
  const rawRecipes = record["recipes"];
  if (!Array.isArray(rawRecipes)) {
    throw refusal(packId, '"recipes" must be an array.');
  }
  if (rawRecipes.length > MAX_RECIPES) {
    throw refusal(packId, `the file lists ${String(rawRecipes.length)} recipes; at most ${String(MAX_RECIPES)} may be read.`);
  }
  const seen = new Set<string>();
  return rawRecipes.map((raw, index) => {
    const field = `recipes[${String(index)}]`;
    const entry = asRecord(raw, packId, field);
    const id = asText(entry["id"], packId, `${field}.id`, MAX_ID);
    if (seen.has(id)) throw refusal(packId, `"${field}.id" repeats "${id}".`);
    seen.add(id);

    const servings = entry["servings"];
    const source = asRecord(entry["source"], packId, `${field}.source`);
    const licence = asText(source["licence"], packId, `${field}.source.licence`, MAX_LICENCE_ID);
    if (!isRecipeLicenceId(licence)) {
      throw refusal(packId, `"${field}.source.licence" must be an SPDX identifier or "public-domain".`);
    }
    const url = asText(source["url"], packId, `${field}.source.url`, MAX_LICENCE_URL);
    if (!/^https?:\/\/\S+$/.test(url)) {
      throw refusal(packId, `"${field}.source.url" must be an http(s) url.`);
    }
    return {
      id,
      title: asText(entry["title"], packId, `${field}.title`, MAX_TITLE),
      language: asLanguage(entry["language"], packId, `${field}.language`),
      servings:
        servings === undefined ? null : asInteger(servings, packId, `${field}.servings`, 1, MAX_SERVINGS),
      ingredients: asTextArray(entry["ingredients"], packId, `${field}.ingredients`, MAX_INGREDIENTS, MAX_TEXT),
      steps: asTextArray(entry["steps"], packId, `${field}.steps`, MAX_STEPS, MAX_STEP_TEXT),
      tags: asTextArray(entry["tags"], packId, `${field}.tags`, MAX_TAGS, MAX_TAG),
      source: {
        title: asText(source["title"], packId, `${field}.source.title`, MAX_LICENCE_TEXT),
        url,
        licence,
        attribution: asText(source["attribution"], packId, `${field}.source.attribution`, MAX_ATTRIBUTION),
      },
    };
  });
}

/** The layout number, checked before any other field is believed. */
function requireLayout(record: Record<string, unknown>, packId: string): void {
  if (record["layout"] !== DATASET_LAYOUT_VERSION) {
    throw refusal(
      packId,
      `the file claims layout ${String(record["layout"])}; this build reads layout ${String(DATASET_LAYOUT_VERSION)}.`,
    );
  }
}

function refusal(packId: string, what: string): Error {
  return new Error(`Pack "${packId}": ${what}`);
}

function asRecord(value: unknown, packId: string, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw refusal(packId, `"${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** A non-empty, trimmed, capped string — the shape every name and citation in both layouts has. */
function asText(value: unknown, packId: string, field: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length === 0 || text.length > max) {
    throw refusal(packId, `"${field}" must be 1-${String(max)} characters.`);
  }
  return text;
}

/** A finite, non-negative number — a composition table has no negative grams. */
function asNumber(value: unknown, packId: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw refusal(packId, `"${field}" must be a number of at least 0.`);
  }
  return value;
}

function asInteger(
  value: unknown,
  packId: string,
  field: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw refusal(packId, `"${field}" must be a whole number between ${String(min)} and ${String(max)}.`);
  }
  return value;
}

/**
 * The language a recipe was written in. Shape-checked rather than listed: a pack
 * may carry any language a publisher works in, and a closed list here would
 * refuse the first corpus that is not Serbian or English — while the value ends
 * up in a `<span lang="…">`, which is why it is checked at all.
 */
function asLanguage(value: unknown, packId: string, field: string): string {
  const text = asText(value, packId, field, 20);
  if (!/^[A-Za-z]{2}(?:[-_][A-Za-z0-9]{2,8})*$/.test(text)) {
    throw refusal(packId, `"${field}" must be a language tag such as "sr" or "en-GB".`);
  }
  return text;
}

function asTextArray(
  value: unknown,
  packId: string,
  field: string,
  maxCount: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) throw refusal(packId, `"${field}" must be an array.`);
  if (value.length > maxCount) {
    throw refusal(packId, `"${field}" may hold at most ${String(maxCount)} entries.`);
  }
  return value.map((entry, index) =>
    asText(entry, packId, `${field}[${String(index)}]`, maxLength),
  );
}

/** Serbian Latin ordering, the app's one collator spelling — plain `"sr"` mis-tailors the Latin š/č/ć/ž a Serbian corpus is full of. */
const PACK_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** The order a hit sorts in: the title first, then a tag, then an ingredient — and a prefix beats a substring at every level. */
const RANK_TITLE_PREFIX = 0;
const RANK_TITLE_HIT = 1;
const RANK_TAG_HIT = 2;
const RANK_INGREDIENT_HIT = 3;

/**
 * The recipes in a pack whose title, tags or INGREDIENTS match `query`, best
 * first, at most `limit` of them.
 *
 * The ingredient arm is the one that makes this a cookbook search rather than a
 * title filter: „what can I make with…" is the question a corpus of foreign
 * recipes is opened to answer, and an index over the ingredient strings answers
 * it without parsing a single line — a browse is not a save.
 *
 * Folding is `foldSearchText`'s, the app's one folding table, so „djuvec" finds
 * „đuveč" here exactly as it does in the search index. A blank query answers the
 * pack's first `limit` recipes by title, because a browse with an empty box has
 * nothing to rank and „the top of the corpus" is what a reader opened it onto.
 */
export function searchPackRecipes(
  recipes: readonly PackRecipe[],
  query: string,
  limit: number,
): PackRecipe[] {
  const needle = foldSearchText(query.trim());
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  if (cap === 0) return [];
  const byTitle = [...recipes].sort(
    (left, right) => PACK_COLLATOR.compare(left.title, right.title) || left.id.localeCompare(right.id),
  );
  if (needle.length === 0) return byTitle.slice(0, cap);

  const hits: { recipe: PackRecipe; rank: number }[] = [];
  for (const recipe of recipes) {
    const title = foldSearchText(recipe.title);
    if (title.startsWith(needle)) {
      hits.push({ recipe, rank: RANK_TITLE_PREFIX });
      continue;
    }
    if (title.includes(needle)) {
      hits.push({ recipe, rank: RANK_TITLE_HIT });
      continue;
    }
    if (recipe.tags.some((tag) => foldSearchText(tag).includes(needle))) {
      hits.push({ recipe, rank: RANK_TAG_HIT });
      continue;
    }
    if (recipe.ingredients.some((line) => foldSearchText(line).includes(needle))) {
      hits.push({ recipe, rank: RANK_INGREDIENT_HIT });
    }
  }
  hits.sort(
    (left, right) =>
      left.rank - right.rank ||
      PACK_COLLATOR.compare(left.recipe.title, right.recipe.title) ||
      left.recipe.id.localeCompare(right.recipe.id),
  );
  return hits.slice(0, cap).map((hit) => hit.recipe);
}
