import type {
  CookbookCourse,
  FoodMacros,
  FoodRef,
  IngredientUnit,
  RecipeLicence,
  RecipeSource,
} from "@nexus/core";
import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * COOKBOOK's contract (ADR-090): the channels it answers on, the payload each
 * one takes, and the API its page calls — declared once, in its own folder.
 *
 * **Why the wire shapes are declared here rather than imported from
 * `@nexus/db`.** The renderer shares this file and may not reach a Node-only
 * package, so the store's row types cannot cross it. `main/register.ts` is the
 * one thing that maps a row onto a view, and the compiler holds the two in step
 * because the row is what it maps FROM. The three value vocabularies a recipe
 * really does share with the rest of the app — the course, the licence and the
 * ingredient unit — come from `@nexus/core` instead, which both halves may read:
 * a second spelling of `COOKBOOK_COURSES` up here would be the drift these types
 * exist to make impossible.
 *
 * **Why the read is split in three rather than one.** A cookbook is a list of
 * recipes, one recipe, and a foreign corpus (the packs). Every mutation answers
 * with the LIST view (`CookbookView`), so the page keeps exactly one way to
 * learn what main holds — but a recipe's own detail is its own read, because a
 * profile with two hundred recipes must not ship every ingredient line on every
 * keypress of a title. `create` is the one op whose answer is not that view: the
 * page has to open the recipe it just made, and the id is the fact only main has.
 *
 * **Nothing here carries a path or a blob's bytes.** A photo is the index row
 * main's content-addressed blob store already keeps (migration 076), and the
 * renderer draws it through `nx-blob://<sha256>` without ever seeing it. That is
 * why `attachPhoto` takes no argument beyond the recipe: main opens the native
 * dialog itself, exactly as every other attachment surface in the app does.
 */

/** The unit vocabulary a recipe is SHOWN in — the module's one preference (ADR-090 §settings). */
export const COOKBOOK_UNIT_SYSTEMS = ["metric", "kitchen"] as const;

export type CookbookUnitSystem = (typeof COOKBOOK_UNIT_SYSTEMS)[number];

/** One ingredient line as it crosses the wire: the parsed fields, and the raw line the author typed. */
export interface RecipeIngredientView {
  readonly id: string;
  readonly quantity: number | null;
  readonly quantityMax: number | null;
  readonly unit: IngredientUnit | null;
  /**
   * The line AS WRITTEN — „2–3 kašike maslinovog ulja, po potrebi". Kept beside
   * the parsed fields rather than derived from them: the parse is lossy by
   * design (a Serbian unit word becomes `tbsp`), and a cookbook that could only
   * show its author's own spelling after a round trip through the parser would
   * quietly rewrite old recipes.
   */
  readonly rawText: string;
  readonly name: string;
  readonly preparation: string | null;
  readonly group: string | null;
  /** The food this line measures into, or null — the user's own choice (see `setFoodMatch`). */
  readonly foodRef: FoodRef | null;
  readonly gramsPerUnit: number | null;
}

/** One step. `timerMinutes` is what the recipe PRINTS („peći 30 minuta"), never a running clock. */
export interface RecipeStepView {
  readonly id: string;
  readonly text: string;
  readonly timerMinutes: number | null;
}

/** A recipe's photo as the index row migration 076 stores: never the bytes. */
export interface RecipePhotoView {
  readonly fileName: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/** A recipe as the LIST reads it: one row's worth, without the children. */
export interface RecipeSummaryView {
  readonly id: string;
  readonly title: string;
  readonly course: CookbookCourse;
  readonly cuisine: string;
  readonly servings: number;
  readonly prepMinutes: number | null;
  readonly cookMinutes: number | null;
  readonly tags: readonly string[];
  readonly favourite: boolean;
  readonly source: RecipeSource;
  readonly hasPhoto: boolean;
  readonly updatedAt: string;
}

/** One recipe whole: the summary's fields plus everything the editor and the cooking view draw. */
export interface RecipeView extends RecipeSummaryView {
  readonly description: string;
  readonly notes: string;
  readonly rating: number | null;
  readonly photo: RecipePhotoView | null;
  /** All five fields for an imported recipe, null for an own one — migration 076's pair. */
  readonly licence: RecipeLicence | null;
  readonly ingredients: readonly RecipeIngredientView[];
  readonly steps: readonly RecipeStepView[];
  readonly createdAt: string;
}

/** The module's one preference, as the settings card and the page read it. */
export interface CookbookSettingsView {
  readonly unitSystem: CookbookUnitSystem;
}

/** One remembered match: „this ingredient NAME is that food", with the author's own weight per unit when they stated one. */
export interface FoodMatchView {
  readonly name: string;
  readonly foodId: string;
  readonly foodName: string;
  readonly gramsPerUnit: number | null;
}

/** Everything one read of the LIST answers with, and what every mutation answers with too. */
export interface CookbookView {
  /** By title, sr-Latn, the way a person reads them (`Intl.Collator(["sr-Latn", "sr"])`, in the store). */
  readonly recipes: readonly RecipeSummaryView[];
  /** Every tag in use, folded and ordered — what the filter offers. */
  readonly tags: readonly string[];
  readonly settings: CookbookSettingsView;
  /** By name, folded — the ingredient links the user has made. */
  readonly foodMatches: readonly FoodMatchView[];
}

/** An ingredient line as the editor hands it back: the parsed fields AND the raw line. */
export interface RecipeIngredientDraft {
  readonly rawText: string;
  readonly quantity: number | null;
  readonly quantityMax: number | null;
  readonly unit: IngredientUnit | null;
  readonly name: string;
  readonly preparation: string | null;
  readonly group: string | null;
  readonly foodRef: FoodRef | null;
  readonly gramsPerUnit: number | null;
}

export interface RecipeStepDraft {
  readonly text: string;
  readonly timerMinutes: number | null;
}

/** A recipe as a caller supplies it — the whole document, for a create. */
export interface RecipeDraft {
  readonly title: string;
  readonly description: string;
  readonly cuisine: string;
  readonly course: CookbookCourse;
  readonly servings: number;
  readonly prepMinutes: number | null;
  readonly cookMinutes: number | null;
  readonly ingredients: readonly RecipeIngredientDraft[];
  readonly steps: readonly RecipeStepDraft[];
  readonly tags: readonly string[];
  readonly rating: number | null;
  readonly notes: string;
  readonly favourite: boolean;
}

/**
 * A partial change. An omitted key is left as it is; `ingredients` and `steps`,
 * when given, replace the whole list — the store's own rule, restated here
 * because the wire cannot carry the third value (`undefined` meaning „leave it
 * alone", distinct from `null` meaning „clear it") that a per-line patch would
 * need, and JSON does not keep that distinction anyway. `source` and the licence
 * are deliberately not here: an imported recipe keeps its attribution through
 * every edit, which migration 076 states in CHECKs.
 */
export interface RecipePatch {
  readonly title?: string;
  readonly description?: string;
  readonly cuisine?: string;
  readonly course?: CookbookCourse;
  readonly servings?: number;
  readonly prepMinutes?: number | null;
  readonly cookMinutes?: number | null;
  readonly ingredients?: readonly RecipeIngredientDraft[];
  readonly steps?: readonly RecipeStepDraft[];
  readonly tags?: readonly string[];
  readonly rating?: number | null;
  readonly notes?: string;
  readonly favourite?: boolean;
}

/** One installed `dataset` pack that carries a recipes file — what the „iz paketa" list draws. */
export interface RecipesPackView {
  readonly id: string;
  readonly version: string;
  readonly title: { readonly sr: string; readonly en: string };
  readonly description: { readonly sr: string; readonly en: string };
  readonly licence: { readonly spdx: string; readonly attribution: string; readonly url: string };
  readonly source: { readonly name: string; readonly url: string };
  readonly recipeCount: number;
}

/** One pack recipe as a list draws it. */
export interface PackRecipeSummaryView {
  readonly id: string;
  readonly title: string;
  /** The language the pack wrote the recipe in (`sr`, `en`, …) — shown, never translated. */
  readonly language: string;
  readonly servings: number | null;
  readonly tags: readonly string[];
  readonly ingredientCount: number;
  readonly stepCount: number;
}

/** One pack recipe, whole — what „Sačuvaj u moju kuvaricu" copies. */
export interface PackRecipeView extends PackRecipeSummaryView {
  readonly ingredients: readonly string[];
  readonly steps: readonly string[];
  readonly source: {
    readonly title: string;
    readonly url: string;
    readonly licence: string;
    readonly attribution: string;
  };
}

/** One installed `dataset` pack carrying a foods file — the nutrition source. */
export interface FoodsPackView {
  readonly id: string;
  readonly version: string;
  readonly title: { readonly sr: string; readonly en: string };
  readonly foodCount: number;
}

/** One food a suggestion list may offer, named in both languages. */
export interface FoodSuggestionView {
  readonly id: string;
  readonly name: string;
  readonly nameEn: string;
  /** Which installed pack it came from — two packs may both know „jaje". */
  readonly packId: string;
}

/** What one serving carries, and which lines were left out of that answer. */
export interface NutritionView {
  readonly servings: number;
  readonly perServing: FoodMacros;
  readonly countedLines: number;
  readonly uncounted: readonly {
    readonly name: string;
    readonly reason: "unlinked" | "unknown-food" | "unknown-grams";
  }[];
  /** The packs the figures were read from, so the page can say where they came from — empty when none is installed. */
  readonly packIds: readonly string[];
  /** True when no `dataset` pack with a foods file is installed: the honest „there is nothing to measure against". */
  readonly noFoodsPack: boolean;
}

/** One read of the list: whose cookbook is being asked for. */
interface ListPayload {
  profileId: string;
}

/** One recipe of this profile, by its own id. The store scopes it to the profile. */
interface RecipePayload {
  profileId: string;
  id: string;
}

interface CreatePayload {
  profileId: string;
  recipe: RecipeDraft;
}

interface UpdatePayload {
  profileId: string;
  id: string;
  patch: RecipePatch;
}

interface UnitSystemPayload {
  profileId: string;
  unitSystem: CookbookUnitSystem;
}

/**
 * A search over this profile's own recipes, by title, tag or INGREDIENT NAME.
 *
 * It is an op rather than a filter over the list already on screen because the
 * third arm is the one a cookbook is opened for — „what can I make with…" — and
 * the ingredient names live on the recipe's children, which the list does not
 * carry. Main ranks the hits (title, then tag, then ingredient), so the page
 * draws what it is told rather than a second opinion about relevance.
 */
interface SearchPayload {
  profileId: string;
  query: string;
}

/** A pack this build has installed, by the id its folder and its manifest agree on. */
interface PackPayload {
  profileId: string;
  packId: string;
}

interface BrowsePackPayload {
  profileId: string;
  packId: string;
  /** The query — a title, a tag, an ingredient. Empty answers the first page of the pack. */
  query: string;
}

interface SavePackRecipePayload {
  profileId: string;
  packId: string;
  id: string;
}

interface SuggestFoodsPayload {
  profileId: string;
  query: string;
}

/** Remembering „this ingredient name is that food" — the user's own link, per name. */
interface FoodMatchPayload {
  profileId: string;
  name: string;
  foodId: string;
  gramsPerUnit: number | null;
}

interface ClearFoodMatchPayload {
  profileId: string;
  name: string;
}

/**
 * What one nutrition read is about.
 *
 * There is no „for how many servings" here, and that is `nutritionPerServing`'s
 * own rule: scaling changes the AMOUNTS, never what one portion is, so the
 * figures per serving are the same whether the page is showing the recipe for
 * two or for a dozen — main passes the recipe's own serving count.
 */
interface NutritionPayload {
  profileId: string;
  id: string;
}

/**
 * The cooking view asking main to keep the display awake, or telling it that
 * the view closed. A main-process `powerSaveBlocker`, not a renderer API: the
 * screen is the machine's, and this app's one place that owns the machine is
 * main.
 */
interface SetAwakePayload {
  profileId: string;
  awake: boolean;
}

/**
 * The declared ops, as a payload→result map. `ModuleApiOf` turns this into the
 * `nexus.modules.cookbook.*` methods the page calls, and `defineModuleContract`
 * turns the keys into the channels main answers on.
 */
type CookbookOps = {
  list: { request: ListPayload; response: CookbookView };
  get: { request: RecipePayload; response: RecipeView };
  create: { request: CreatePayload; response: { view: CookbookView; recipeId: string } };
  update: { request: UpdatePayload; response: CookbookView };
  remove: { request: RecipePayload; response: CookbookView };
  setUnitSystem: { request: UnitSystemPayload; response: CookbookView };
  search: { request: SearchPayload; response: RecipeSummaryView[] };
  listRecipesPacks: { request: ListPayload; response: RecipesPackView[] };
  browsePack: { request: BrowsePackPayload; response: PackRecipeSummaryView[] };
  getPackRecipe: { request: PackPayload & { id: string }; response: PackRecipeView };
  savePackRecipe: {
    request: SavePackRecipePayload;
    response: { view: CookbookView; recipeId: string };
  };
  listFoodsPacks: { request: ListPayload; response: FoodsPackView[] };
  suggestFoods: { request: SuggestFoodsPayload; response: FoodSuggestionView[] };
  setFoodMatch: { request: FoodMatchPayload; response: CookbookView };
  clearFoodMatch: { request: ClearFoodMatchPayload; response: CookbookView };
  nutrition: { request: NutritionPayload; response: NutritionView };
  setAwake: { request: SetAwakePayload; response: CookbookView };
  attachPhoto: { request: RecipePayload; response: CookbookView };
  removePhoto: { request: RecipePayload; response: CookbookView };
};

/** This module's renderer API: one method per op, named after the op. */
export type CookbookApi = ModuleApiOf<CookbookOps>;

/**
 * The contract the preload builds the bridge from and main refuses foreign ops
 * against. Exported as `contract` because that is the ONE name the kit's globs
 * agree on.
 */
export const contract = defineModuleContract<"cookbook", CookbookOps>("cookbook", [
  "list",
  "get",
  "create",
  "update",
  "remove",
  "setUnitSystem",
  "search",
  "listRecipesPacks",
  "browsePack",
  "getPackRecipe",
  "savePackRecipe",
  "listFoodsPacks",
  "suggestFoods",
  "setFoodMatch",
  "clearFoodMatch",
  "nutrition",
  "setAwake",
  "attachPhoto",
  "removePhoto",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here, so
 * `window.nexus.modules.cookbook.list(...)` is typed in this module's own page,
 * in the dashboard widget and in the settings card with no line in
 * `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    cookbook: CookbookApi;
  }
}
