import {
  type CookbookCourse,
  type FoodMacros,
  type FoodRef,
  type IngredientUnit,
  type RecipeLicence,
  type SearchableFood,
  foldSearchText,
  nutritionPerServing,
  parseFoodRef,
  parseIngredientLine,
  searchFoods,
} from "@nexus/core";
import {
  MAX_INGREDIENT_GROUP_LENGTH,
  MAX_INGREDIENT_NAME_LENGTH,
  MAX_INGREDIENT_PREPARATION_LENGTH,
  MAX_INGREDIENT_QUANTITY,
  MAX_INGREDIENT_RAW_LENGTH,
  MAX_INGREDIENT_UNIT_GRAMS,
  MAX_RECIPE_CUISINE_LENGTH,
  MAX_RECIPE_DESCRIPTION_LENGTH,
  MAX_RECIPE_INGREDIENTS,
  MAX_RECIPE_NOTES_LENGTH,
  MAX_RECIPE_SERVINGS,
  MAX_RECIPE_STEPS,
  MAX_RECIPE_STEP_TEXT_LENGTH,
  MAX_RECIPE_STEP_TIMER_MINUTES,
  MAX_RECIPE_TAGS,
  MAX_RECIPE_TAG_LENGTH,
  MAX_RECIPE_TIME_MINUTES,
  MAX_RECIPE_TITLE_LENGTH,
  RecipeStore,
  foldIngredientName,
  type CookbookExport,
  type CreateRecipeInput,
  type Recipe,
  type RecipeIngredientInput,
  type RecipeUnitSystem,
  type UpdateRecipeFields,
} from "@nexus/db";
import type { ModuleCall, ModuleHostSurface } from "../../../main/moduleIpc.js";
import {
  contract,
  type CookbookView,
  type FoodSuggestionView,
  type FoodsPackView,
  type NutritionView,
  type PackRecipeSummaryView,
  type PackRecipeView,
  type RecipePhotoView,
  type RecipeSummaryView,
  type RecipeView,
  type RecipesPackView,
} from "../shared/ipc.js";
import { buildCookbookExport, emptyCookbookExport, parseCookbookExport } from "./imex.js";
import {
  loadRecipesPacks,
  loadFoodsPacks,
  searchPackRecipes,
  type FoodsDataset,
  type PackFood,
  type PackRecipe,
  type RecipesDataset,
} from "./packData.js";

/**
 * COOKBOOK in the main process (ADR-090): the handlers, the pack readers, and the
 * module's archive section.
 *
 * **The database half is the store's.** Every recipe statement is
 * `RecipeStore`'s — scoped by `profile_id`, validated before its transaction
 * opens, children replaced wholesale — and this file never writes SQL. What it
 * does is read the wire (SEC-EL-02), map rows onto the wire's views, and put the
 * two halves of the module that live outside the database together: the installed
 * content packs (ADR-091) and the app's one blob store, both reached through
 * `CookbookRuntime` rather than imported, because a kit module's `register` is
 * called by the discovery glue with nothing but its host.
 *
 * **Why an ingredient's raw line is kept by the parser's own output.** The field
 * is parsed by `parseIngredientLine` — the module's parser, and the same one the
 * page runs while the user types — and the line as typed is stored beside the
 * fields, so showing a recipe never has to reconstruct the author's spelling out
 * of a lossy parse.
 *
 * **Nutrition is a read, and it says what it could not weigh.** The serving
 * figures come from `nutritionPerServing` (the function the Fitness log already
 * reads a food through), with the pack's own per-100 g rows resolved by the
 * links the user made. A line with no link, a link whose food is gone and a line
 * nobody can weigh are each answered by NAME in `uncounted`, because the one
 * thing this surface must never do is report a number that quietly omits an
 * ingredient.
 */

/** One photo the host stored: the index row, and nothing else about it. */
export interface CookbookHost {
  /**
   * Opens main's native „choose a photo" dialog, reads what the user chose and
   * stores the bytes in the app's ONE content-addressed blob store. Answers the
   * index row, or `null` when the dialog was cancelled.
   *
   * Why a host rather than an import: the blob store is encrypted under the
   * profile's data key, which lives in `main/index.ts` and nowhere else, and the
   * renderer must never be handed a filesystem path to read. So the ONE thing a
   * kit module cannot do for itself arrives injected — and this module never
   * learns a path, a key or a byte.
   */
  pickPhoto(): Promise<RecipePhotoView | null>;
  /** Releases a photo's bytes once no row names them any more (main's own reference count decides). */
  releasePhoto(profileId: string, sha256: string): void;
  /**
   * Keeps the display awake while the cooking view is open, or releases it.
   * `powerSaveBlocker` is a main-process facility; the renderer's own screen wake
   * lock is not something this app relies on.
   */
  setAwake(on: boolean): void;
}

/** Where the installed packs live and what verifies them — supplied by `main/index.ts` (see `configureCookbook`). */
export interface CookbookRuntime {
  /** `<userData>`: the packs index hangs off it (`<userData>/packs`, ADR-091 §5). */
  readonly userData: string;
  /** The release key installed packs' manifests are verified against. */
  readonly packsPublicKeyPem: string;
  readonly host: CookbookHost;
}

/**
 * What `main/index.ts` hands the module once, at startup: the two facts and the
 * one capability a kit module cannot reach from its own folder.
 *
 * A module-level slot rather than a parameter of `register(host)`, because the
 * discovery glue calls `register(host)` and nothing else — and it is deliberately
 * not optional-with-a-fallback: a build where this call was forgotten answers „no
 * packs are installed" and refuses a photo with a sentence naming the reason,
 * rather than reaching for a path or a key of its own.
 */
let runtime: CookbookRuntime | null = null;

export function configureCookbook(next: CookbookRuntime): void {
  runtime = next;
}

/** Serbian Latin ordering, the app's one collator spelling — the recipe list is the store's, the tag list is this file's. */
const COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** How many pack recipes one browse answers. A page of results, not the corpus: the UI asks again as the query narrows. */
const PACK_PAGE_SIZE = 50;

/** How many food suggestions one keystroke answers — the food picker's own `limit` one module over. */
const SUGGESTION_LIMIT = 20;

/** What a handler and a session have in common: both open a profile's database the same way, so the code below can be one shape rather than two. */
type StoreBearer = Pick<ModuleCall, "profileDb">;

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  function store(bearer: StoreBearer, profileId: string): RecipeStore {
    return bearer.profileDb(profileId, (db, id) => new RecipeStore(db, id));
  }

  /** The installed packs, or null when this build was never configured with them (see `configureCookbook`). */
  function packs(): CookbookRuntime | null {
    return runtime;
  }

  function requireHost(): CookbookHost {
    if (runtime === null) {
      throw new Error("This build has no photo importer wired up; reinstall Nexus.");
    }
    return runtime.host;
  }

  // --- The views ------------------------------------------------------------

  function summaryOf(recipe: Recipe): RecipeSummaryView {
    return {
      id: recipe.id,
      title: recipe.title,
      course: recipe.course,
      cuisine: recipe.cuisine,
      servings: recipe.servings,
      prepMinutes: recipe.prepMinutes,
      cookMinutes: recipe.cookMinutes,
      tags: [...recipe.tags],
      favourite: recipe.favourite,
      source: recipe.source,
      hasPhoto: recipe.photo !== null,
      updatedAt: recipe.updatedAt,
    };
  }

  function recipeViewOf(recipe: Recipe): RecipeView {
    return {
      ...summaryOf(recipe),
      description: recipe.description,
      notes: recipe.notes,
      rating: recipe.rating,
      photo: recipe.photo === null ? null : { ...recipe.photo },
      licence: recipe.licence === null ? null : { ...recipe.licence },
      ingredients: recipe.ingredients.map((line) => ({
        id: line.id,
        quantity: line.quantity,
        quantityMax: line.quantityMax,
        unit: line.unit,
        rawText: line.rawText,
        name: line.name,
        preparation: line.preparation,
        group: line.group,
        foodRef: line.foodRef,
        gramsPerUnit: line.gramsPerUnit,
      })),
      steps: recipe.steps.map((step) => ({
        id: step.id,
        text: step.text,
        timerMinutes: step.timerMinutes,
      })),
      createdAt: recipe.createdAt,
    };
  }

  /** Every tag in use, folded once, in sr-Latn order — what the page's filter offers. */
  function tagsOf(recipes: readonly Recipe[]): string[] {
    const seen = new Map<string, string>();
    for (const recipe of recipes) {
      for (const tag of recipe.tags) {
        const key = foldIngredientName(tag);
        if (!seen.has(key)) seen.set(key, tag);
      }
    }
    return [...seen.values()].sort((left, right) => COLLATOR.compare(left, right));
  }

  function viewOf(bearer: StoreBearer, profileId: string): CookbookView {
    const recipes = store(bearer, profileId);
    const rows = recipes.list();
    return {
      recipes: rows.map(summaryOf),
      tags: tagsOf(rows),
      settings: recipes.settings(),
      foodMatches: recipes.listFoodMatches().map((match) => ({
        name: match.name,
        foodId: match.foodRef.id,
        foodName: match.foodName,
        gramsPerUnit: match.gramsPerUnit,
      })),
    };
  }

  // --- Instant and the wire -------------------------------------------------

  /** The instant the store writes, from the clock the kit injected. */
  function instant(atMs: number): string {
    return new Date(atMs).toISOString();
  }

  function optionalMinutes(call: ModuleCall, value: unknown, field: string): number | null {
    if (value === null || value === undefined) return null;
    return call.as.asBoundedInteger(value, field, 1, MAX_RECIPE_TIME_MINUTES);
  }

  function optionalNumber(value: unknown, max: number, field: string): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > max) {
      throw new Error(`Invalid IPC payload: "${field}" must be a number above 0 and at most ${String(max)}.`);
    }
    return value;
  }

  /**
   * A food reference off the wire, in `@nexus/core`'s own grammar.
   *
   * Validated by PARSING it rather than by reading two fields: the grammar is
   * what the store will apply again, and a reference that could never resolve is
   * refused here, where the message can name the field the renderer sent.
   */
  function foodRefOf(call: ModuleCall, value: unknown, field: string): FoodRef | null {
    if (value === null || value === undefined) return null;
    const record = call.as.asRecord(value);
    const kind = call.as.asNonEmptyString(record.kind, `${field}.kind`);
    const id = call.as.asId(record.id, `${field}.id`);
    const ref = parseFoodRef(`${kind}:${id}`);
    if (ref === null) {
      throw new Error(
        `Invalid IPC payload: "${field}" must be a catalogue or user food reference.`,
      );
    }
    return ref;
  }

  /** One ingredient line off the wire, in the shape the store takes. */
  function ingredientOf(call: ModuleCall, value: unknown, index: number): RecipeIngredientInput {
    const path = `ingredients[${index}]`;
    const record = call.as.asRecord(value);
    return {
      name: call.as.asCappedChars(
        call.as.asNonEmptyString(record.name, `${path}.name`),
        `${path}.name`,
        MAX_INGREDIENT_NAME_LENGTH,
      ),
      rawText: call.as.asCappedChars(
        call.as.asString(record.rawText ?? "", `${path}.rawText`),
        `${path}.rawText`,
        MAX_INGREDIENT_RAW_LENGTH,
      ),
      quantity: optionalNumber(record.quantity ?? null, MAX_INGREDIENT_QUANTITY, `${path}.quantity`),
      quantityMax: optionalNumber(
        record.quantityMax ?? null,
        MAX_INGREDIENT_QUANTITY,
        `${path}.quantityMax`,
      ),
      unit: (record.unit ?? null) as IngredientUnit | null,
      preparation: nullableCapped(call, record.preparation ?? null, MAX_INGREDIENT_PREPARATION_LENGTH, `${path}.preparation`),
      group: nullableCapped(call, record.group ?? null, MAX_INGREDIENT_GROUP_LENGTH, `${path}.group`),
      foodRef: foodRefOf(call, record.foodRef ?? null, `${path}.foodRef`),
      gramsPerUnit: optionalNumber(
        record.gramsPerUnit ?? null,
        MAX_INGREDIENT_UNIT_GRAMS,
        `${path}.gramsPerUnit`,
      ),
    };
  }

  function nullableCapped(
    call: ModuleCall,
    value: unknown,
    max: number,
    field: string,
  ): string | null {
    const text = call.as.asNullableString(value, field);
    return text === null ? null : call.as.asCappedChars(text, field, max);
  }

  function ingredientsOf(call: ModuleCall, value: unknown): RecipeIngredientInput[] {
    if (!Array.isArray(value)) {
      throw new Error('Invalid IPC payload: "ingredients" must be an array.');
    }
    if (value.length > MAX_RECIPE_INGREDIENTS) {
      throw new Error(
        `Invalid IPC payload: "ingredients" must hold at most ${String(MAX_RECIPE_INGREDIENTS)} lines.`,
      );
    }
    return value.map((line, index) => ingredientOf(call, line, index));
  }

  function stepsOf(call: ModuleCall, value: unknown): { text: string; timerMinutes: number | null }[] {
    if (!Array.isArray(value)) {
      throw new Error('Invalid IPC payload: "steps" must be an array.');
    }
    if (value.length > MAX_RECIPE_STEPS) {
      throw new Error(
        `Invalid IPC payload: "steps" must hold at most ${String(MAX_RECIPE_STEPS)} steps.`,
      );
    }
    return value.map((step, index) => {
      const record = call.as.asRecord(step);
      return {
        text: call.as.asCappedChars(
          call.as.asNonEmptyString(record.text, `steps[${index}].text`),
          `steps[${index}].text`,
          MAX_RECIPE_STEP_TEXT_LENGTH,
        ),
        timerMinutes:
          record.timerMinutes === null || record.timerMinutes === undefined
            ? null
            : call.as.asBoundedInteger(
                record.timerMinutes,
                `steps[${index}].timerMinutes`,
                1,
                MAX_RECIPE_STEP_TIMER_MINUTES,
              ),
      };
    });
  }

  function tagsOfPayload(call: ModuleCall, value: unknown): string[] {
    if (!Array.isArray(value)) {
      throw new Error('Invalid IPC payload: "tags" must be an array.');
    }
    if (value.length > MAX_RECIPE_TAGS) {
      throw new Error(
        `Invalid IPC payload: "tags" must hold at most ${String(MAX_RECIPE_TAGS)} names.`,
      );
    }
    return value.map((tag, index) =>
      call.as.asCappedChars(
        call.as.asNonEmptyString(tag, `tags[${index}]`),
        `tags[${index}]`,
        MAX_RECIPE_TAG_LENGTH,
      ),
    );
  }

  /** One recipe as a caller supplies it: the whole document, for a create. */
  function draftOf(call: ModuleCall, value: unknown): CreateRecipeInput {
    const record = call.as.asRecord(value);
    return {
      title: call.as.asCappedChars(
        call.as.asNonEmptyString(record.title, "title"),
        "title",
        MAX_RECIPE_TITLE_LENGTH,
      ),
      description: call.as.asCappedChars(
        call.as.asString(record.description ?? "", "description"),
        "description",
        MAX_RECIPE_DESCRIPTION_LENGTH,
      ),
      cuisine: call.as.asCappedChars(
        call.as.asString(record.cuisine ?? "", "cuisine"),
        "cuisine",
        MAX_RECIPE_CUISINE_LENGTH,
      ),
      course: call.as.asNonEmptyString(record.course, "course") as CookbookCourse,
      servings: call.as.asBoundedInteger(record.servings, "servings", 1, MAX_RECIPE_SERVINGS),
      prepMinutes: optionalMinutes(call, record.prepMinutes ?? null, "prepMinutes"),
      cookMinutes: optionalMinutes(call, record.cookMinutes ?? null, "cookMinutes"),
      ingredients: ingredientsOf(call, record.ingredients),
      steps: stepsOf(call, record.steps),
      tags: tagsOfPayload(call, record.tags ?? []),
      rating:
        record.rating === null || record.rating === undefined
          ? null
          : call.as.asBoundedInteger(record.rating, "rating", 1, 10),
      notes: call.as.asCappedChars(
        call.as.asString(record.notes ?? "", "notes"),
        "notes",
        MAX_RECIPE_NOTES_LENGTH,
      ),
      favourite: call.as.asBoolean(record.favourite ?? false, "favourite"),
      // An own recipe, always: a recipe is „imported" only when it came out of a
      // pack, and that path is `savePackRecipe` — the renderer cannot type a
      // licence, which is what keeps an attribution a fact about provenance
      // rather than a field somebody filled in.
      source: "own",
    };
  }

  /**
   * A partial change off the wire.
   *
   * Presence is asked with `Object.hasOwn` rather than by truthiness, and that is
   * load-bearing: the store's `UpdateRecipeFields` distinguishes an omitted key
   * („leave it") from an explicit `null` („clear it"), and a validator that read
   * `undefined` as absent would fold the two together.
   */
  function patchOf(call: ModuleCall, value: unknown): UpdateRecipeFields {
    const record = call.as.asRecord(value);
    const patch: UpdateRecipeFields = {};
    if (Object.hasOwn(record, "title")) {
      patch.title = call.as.asCappedChars(
        call.as.asNonEmptyString(record.title, "title"),
        "title",
        MAX_RECIPE_TITLE_LENGTH,
      );
    }
    if (Object.hasOwn(record, "description")) {
      patch.description = call.as.asCappedChars(
        call.as.asString(record.description, "description"),
        "description",
        MAX_RECIPE_DESCRIPTION_LENGTH,
      );
    }
    if (Object.hasOwn(record, "cuisine")) {
      patch.cuisine = call.as.asCappedChars(
        call.as.asString(record.cuisine, "cuisine"),
        "cuisine",
        MAX_RECIPE_CUISINE_LENGTH,
      );
    }
    if (Object.hasOwn(record, "course")) {
      patch.course = call.as.asNonEmptyString(record.course, "course") as CookbookCourse;
    }
    if (Object.hasOwn(record, "servings")) {
      patch.servings = call.as.asBoundedInteger(record.servings, "servings", 1, MAX_RECIPE_SERVINGS);
    }
    if (Object.hasOwn(record, "prepMinutes")) {
      patch.prepMinutes = optionalMinutes(call, record.prepMinutes, "prepMinutes");
    }
    if (Object.hasOwn(record, "cookMinutes")) {
      patch.cookMinutes = optionalMinutes(call, record.cookMinutes, "cookMinutes");
    }
    if (Object.hasOwn(record, "ingredients")) {
      patch.ingredients = ingredientsOf(call, record.ingredients);
    }
    if (Object.hasOwn(record, "steps")) {
      patch.steps = stepsOf(call, record.steps);
    }
    if (Object.hasOwn(record, "tags")) {
      patch.tags = tagsOfPayload(call, record.tags);
    }
    if (Object.hasOwn(record, "rating")) {
      patch.rating =
        record.rating === null ? null : call.as.asBoundedInteger(record.rating, "rating", 1, 10);
    }
    if (Object.hasOwn(record, "notes")) {
      patch.notes = call.as.asCappedChars(
        call.as.asString(record.notes, "notes"),
        "notes",
        MAX_RECIPE_NOTES_LENGTH,
      );
    }
    if (Object.hasOwn(record, "favourite")) {
      patch.favourite = call.as.asBoolean(record.favourite, "favourite");
    }
    return patch;
  }

  // --- The packs ------------------------------------------------------------

  function recipesPacks(): RecipesDataset[] {
    const configured = packs();
    if (configured === null) return [];
    return loadRecipesPacks(configured.userData, configured.packsPublicKeyPem);
  }

  function foodsPacks(): FoodsDataset[] {
    const configured = packs();
    if (configured === null) return [];
    return loadFoodsPacks(configured.userData, configured.packsPublicKeyPem);
  }

  /**
   * Every food any installed pack carries, by id — the table a match resolves
   * through.
   *
   * The FIRST pack in the index's order wins when two carry the same id, and
   * that is written down rather than left to a merge: a match stores the food's
   * id and not the pack it came from (the reference grammar has two halves), so
   * an id two packs disagree about is a figure that depends on install order.
   * The suggestion list is where the user chose, and it lists both.
   */
  function foodsById(packsIn: readonly FoodsDataset[]): Map<string, PackFood> {
    const table = new Map<string, PackFood>();
    for (const pack of packsIn) {
      for (const food of pack.foods) {
        if (!table.has(food.id)) table.set(food.id, food);
      }
    }
    return table;
  }

  // --- The handlers ---------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId);
  });

  ctx.handle("get", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const id = call.as.asId(payload.id, "id");
    return recipeViewOf(store(call, profileId).get(id));
  });

  ctx.handle("create", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const recipes = store(call, profileId);
    const created = recipes.create(draftOf(call, payload.recipe), instant(call.now()));
    return { view: viewOf(call, profileId), recipeId: created.id };
  });

  ctx.handle("update", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).update(
      call.as.asId(payload.id, "id"),
      patchOf(call, payload.patch),
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("remove", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    store(call, profileId).softDelete(call.as.asId(payload.id, "id"), instant(call.now()));
    return viewOf(call, profileId);
  });

  ctx.handle("setUnitSystem", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    // The wire checks that it is a string; the store checks which strings exist
    // (`validateUnitSystem`), so the closed vocabulary stays in one place.
    const unitSystem = call.as.asNonEmptyString(
      payload.unitSystem,
      "unitSystem",
    ) as RecipeUnitSystem;
    store(call, profileId).setUnitSystem(
      unitSystem,
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("search", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const query = call.as.asCappedChars(call.as.asString(payload.query, "query"), "query", 120);
    return searchOwnRecipes(store(call, profileId).list(), query).map(summaryOf);
  });

  ctx.handle("listRecipesPacks", (payload, call) => {
    call.as.asId(payload.profileId, "profileId");
    return recipesPacks().map((pack): RecipesPackView => viewOfRecipesPack(pack));
  });

  ctx.handle("browsePack", (payload, call) => {
    call.as.asId(payload.profileId, "profileId");
    const packId = call.as.asId(payload.packId, "packId");
    const query = call.as.asCappedChars(call.as.asString(payload.query, "query"), "query", 120);
    const pack = recipesPacks().find((candidate) => candidate.manifest.id === packId);
    if (pack === undefined) {
      throw new Error(`No installed pack "${packId}" carries recipes.`);
    }
    return searchPackRecipes(pack.recipes, query, PACK_PAGE_SIZE).map(packSummaryOf);
  });

  ctx.handle("getPackRecipe", (payload, call) => {
    call.as.asId(payload.profileId, "profileId");
    const pack = requireRecipesPack(call, payload.packId);
    const recipe = requirePackRecipe(call, pack, payload.id);
    return packRecipeViewOf(recipe);
  });

  ctx.handle("savePackRecipe", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const pack = requireRecipesPack(call, payload.packId);
    const recipe = requirePackRecipe(call, pack, payload.id);
    const recipes = store(call, profileId);
    const copy = packRecipeInput(pack, recipe);
    const created = recipes.create(copy, instant(call.now()));
    return { view: viewOf(call, profileId), recipeId: created.id };
  });

  ctx.handle("listFoodsPacks", (payload, call) => {
    call.as.asId(payload.profileId, "profileId");
    return foodsPacks().map(
      (pack): FoodsPackView => ({
        id: pack.manifest.id,
        version: pack.manifest.version,
        title: { ...pack.manifest.title },
        foodCount: pack.foods.length,
      }),
    );
  });

  ctx.handle("suggestFoods", (payload, call) => {
    call.as.asId(payload.profileId, "profileId");
    const query = call.as.asCappedChars(call.as.asString(payload.query, "query"), "query", 120);
    const pools = foodsPacks();
    const entries: (SearchableFood & { packId: string; name: string; nameEn: string })[] = [];
    for (const pack of pools) {
      for (const food of pack.foods) {
        entries.push({
          id: food.id,
          // The Serbian name where the pack has one, the English one otherwise —
          // `searchFoods` searches both and ranks the first name it is given, and
          // a suggestion list has to be rankable in the language being read.
          name: food.nameSr ?? food.nameEn,
          nameEn: food.nameEn,
          packId: pack.manifest.id,
        });
      }
    }
    return searchFoods(entries, query, SUGGESTION_LIMIT).map(
      (entry): FoodSuggestionView => ({
        id: entry.id,
        name: entry.name,
        nameEn: entry.nameEn,
        packId: entry.packId,
      }),
    );
  });

  ctx.handle("setFoodMatch", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const name = call.as.asCappedChars(
      call.as.asNonEmptyString(payload.name, "name"),
      "name",
      MAX_INGREDIENT_NAME_LENGTH,
    );
    const foodId = call.as.asId(payload.foodId, "foodId");
    const gramsPerUnit = optionalNumber(
      payload.gramsPerUnit ?? null,
      MAX_INGREDIENT_UNIT_GRAMS,
      "gramsPerUnit",
    );
    const table = foodsById(foodsPacks());
    const food = table.get(foodId);
    if (food === undefined) {
      throw new Error(
        `No installed pack carries the food "${foodId}"; install the dataset pack that holds it.`,
      );
    }
    store(call, profileId).setFoodMatch(
      {
        name,
        foodRef: { kind: "catalogue", id: foodId },
        // The name is taken from the pack rather than from the renderer: the
        // row is what the page shows beside the ingredient, and a name that
        // arrived over the wire could disagree with the food it points at.
        foodName: food.nameSr ?? food.nameEn,
        gramsPerUnit,
      },
      instant(call.now()),
    );
    return viewOf(call, profileId);
  });

  ctx.handle("clearFoodMatch", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const name = call.as.asCappedChars(
      call.as.asNonEmptyString(payload.name, "name"),
      "name",
      MAX_INGREDIENT_NAME_LENGTH,
    );
    store(call, profileId).clearFoodMatch(name);
    return viewOf(call, profileId);
  });

  ctx.handle("nutrition", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const recipes = store(call, profileId);
    const recipe = recipes.get(call.as.asId(payload.id, "id"));
    const pools = foodsPacks();
    const table = foodsById(pools);
    const matches = new Map(
      recipes.listFoodMatches().map((match) => [match.nameKey, match] as const),
    );

    // A line's own link wins over the one remembered for its name: the line is
    // the more specific statement, and the memory is what fills the gap for the
    // lines nobody has linked yet.
    const lines = recipe.ingredients.map((line) => {
      const match = matches.get(foldIngredientName(line.name));
      return {
        name: line.name,
        quantity: line.quantity,
        quantityMax: line.quantityMax,
        unit: line.unit,
        foodRef: line.foodRef ?? match?.foodRef ?? null,
        gramsPerUnit: line.gramsPerUnit ?? match?.gramsPerUnit ?? null,
      };
    });
    const resolved = nutritionPerServing(lines, recipe.servings, (ref): FoodMacros | null => {
      if (ref.kind !== "catalogue") return null;
      return table.get(ref.id)?.per100g ?? null;
    });
    const view: NutritionView = {
      servings: recipe.servings,
      perServing: resolved.perServing,
      countedLines: resolved.countedLines,
      uncounted: resolved.uncounted.map((line) => ({ name: line.name, reason: line.reason })),
      packIds: pools.map((pack) => pack.manifest.id),
      noFoodsPack: pools.length === 0,
    };
    return view;
  });

  // Declared before the two photo ops, in the contract's own order, so the two
  // lists stay the same list (the kit registers one dispatcher per `handle`
  // call, and `host.channels()` is the order they were made in).
  ctx.handle("setAwake", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const awake = call.as.asBoolean(payload.awake, "awake");
    if (runtime !== null) runtime.host.setAwake(awake);
    return viewOf(call, profileId);
  });

  ctx.handle("attachPhoto", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const id = call.as.asId(payload.id, "id");
    const recipes = store(call, profileId);
    const before = recipes.get(id).photo;
    const row = await requireHost().pickPhoto();
    if (row === null) return viewOf(call, profileId);
    recipes.update(id, { photo: row }, instant(call.now()));
    releaseIfReplaced(profileId, before?.sha256 ?? null, row.sha256);
    return viewOf(call, profileId);
  });

  ctx.handle("removePhoto", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const id = call.as.asId(payload.id, "id");
    const recipes = store(call, profileId);
    const before = recipes.get(id).photo;
    recipes.update(id, { photo: null }, instant(call.now()));
    releaseIfReplaced(profileId, before?.sha256 ?? null, null);
    return viewOf(call, profileId);
  });

  /**
   * Lets the previous photo's bytes go, when the row that named them no longer
   * does. Main's own reference count decides — this module cannot see the other
   * tables that may name the same hash — so the host is asked, and a failure
   * here is logged rather than thrown: the recipe was already saved, and a blob
   * that outlives its row is a file to sweep, not a lost write.
   */
  function releaseIfReplaced(
    profileId: string,
    previous: string | null,
    next: string | null,
  ): void {
    if (previous === null || previous === next || runtime === null) return;
    try {
      runtime.host.releasePhoto(profileId, previous);
    } catch (error) {
      console.error(
        `Nexus: a replaced recipe photo could not be released — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** The pack that carries recipes, or a refusal naming the id the caller sent. */
  function requireRecipesPack(call: ModuleCall, value: unknown): RecipesDataset {
    const packId = call.as.asId(value, "packId");
    const pack = recipesPacks().find((candidate) => candidate.manifest.id === packId);
    if (pack === undefined) {
      throw new Error(`No installed pack "${packId}" carries recipes.`);
    }
    return pack;
  }

  function requirePackRecipe(
    call: ModuleCall,
    pack: RecipesDataset,
    value: unknown,
  ): PackRecipe {
    const id = call.as.asId(value, "id");
    const recipe = pack.recipes.find((candidate) => candidate.id === id);
    if (recipe === undefined) {
      throw new Error(`Pack "${pack.manifest.id}" carries no recipe "${id}".`);
    }
    return recipe;
  }

  // --- The session ----------------------------------------------------------

  ctx.onSessionEnd(() => {
    // The cooking view is what asked for the screen, and the session it belonged
    // to is over: releasing here is what keeps a lock from leaving the display
    // awake with nothing on it.
    if (runtime !== null) runtime.host.setAwake(false);
  });

  // --- The archive (ADR-090 §imex) -----------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    return buildCookbookExport(store(session, profileId));
  });

  ctx.importData({
    // The store's own whole-payload reader: validated once, at the preview, and
    // again by `importData` before a single row is written.
    parse: parseCookbookExport,
    // `undefined` is an archive that says nothing about the cookbook, which for
    // a restore that replaces a profile whole means EMPTY — no recipes, the
    // shipped units and no remembered links.
    apply: (payload, session) => {
      const value = payload ?? emptyCookbookExport();
      for (const profileId of session.profileIds) {
        store(session, profileId).importData(value);
      }
    },
  });

  // The blob hook (ADR-108): a recipe's photo is the one file this module keeps
  // in the shared store, and these four answers are what main builds its blob
  // union, its mime lookup and the archive's `blobs/` list from - one
  // registration in this module's own folder rather than two lines naming
  // COOK's tables in `main/index.ts`.
  ctx.blobs({
    refCount: (session, profileId, sha256) => store(session, profileId).refCount(sha256),
    mimeForHash: (session, profileId, sha256) => store(session, profileId).mimeForHash(sha256),
    exportBlobs: (session) => {
      const profileId = soleProfile(session.profileIds);
      return profileId === null ? [] : photoBlobs(store(session, profileId).exportData());
    },
    importBlobs: (payload) =>
      photoBlobs((payload as CookbookExport | undefined) ?? emptyCookbookExport()),
  });
}

/**
 * Every photo one COOKBOOK section names, with the size its row states - read
 * off the EXPORT value rather than the raw table, so the list is exactly the
 * recipes the archive carries (a soft-deleted one is in neither).
 */
function photoBlobs(section: CookbookExport): { sha256: string; sizeBytes: number }[] {
  return section.recipes.flatMap((recipe) =>
    recipe.photo === null
      ? []
      : [{ sha256: recipe.photo.sha256, sizeBytes: recipe.photo.sizeBytes }],
  );
}

/**
 * The one profile a session is about, or `null` when it names none or several.
 * An archive is written one profile at a time, so „several" is not a shape the
 * exporter meets — and answering `null` rather than guessing keeps that true
 * (the same rule Timers' own `soleProfile` states).
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The order a hit sorts in: the title first, then a tag, then an ingredient — a prefix beats a substring at every level. */
const RANK_TITLE_PREFIX = 0;
const RANK_TITLE_HIT = 1;
const RANK_TAG_HIT = 2;
const RANK_INGREDIENT_HIT = 3;

/**
 * This profile's recipes whose title, tags or INGREDIENTS match `query`, best
 * first — the „what can I make with…" half of the search box.
 *
 * The fold is `foldSearchText`'s, the app's one folding table, so „djuvec" finds
 * „đuveč" here as it does everywhere else. A blank query answers nothing rather
 * than everything (`searchFoods`' own rule): the page shows the full list when
 * its box is empty, and a ranked answer of every recipe would dress „the whole
 * cookbook" up as a set of matches.
 */
function searchOwnRecipes(recipes: readonly Recipe[], query: string): Recipe[] {
  const needle = foldSearchText(query.trim());
  if (needle.length === 0) return [];
  const hits: { recipe: Recipe; rank: number }[] = [];
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
    if (recipe.ingredients.some((line) => foldSearchText(line.name).includes(needle))) {
      hits.push({ recipe, rank: RANK_INGREDIENT_HIT });
    }
  }
  hits.sort(
    (left, right) =>
      left.rank - right.rank ||
      COLLATOR.compare(left.recipe.title, right.recipe.title) ||
      left.recipe.id.localeCompare(right.recipe.id),
  );
  return hits.map((hit) => hit.recipe);
}

/** One installed recipes pack as the page lists it. */
function viewOfRecipesPack(pack: RecipesDataset): RecipesPackView {
  return {
    id: pack.manifest.id,
    version: pack.manifest.version,
    title: { ...pack.manifest.title },
    description: { ...pack.manifest.description },
    licence: { ...pack.manifest.licence },
    source: { ...pack.manifest.source },
    recipeCount: pack.recipes.length,
  };
}

/** One pack recipe as a list draws it — the counts, and never the text a page has not asked for. */
function packSummaryOf(recipe: PackRecipe): PackRecipeSummaryView {
  return {
    id: recipe.id,
    title: recipe.title,
    language: recipe.language,
    servings: recipe.servings,
    tags: [...recipe.tags],
    ingredientCount: recipe.ingredients.length,
    stepCount: recipe.steps.length,
  };
}

function packRecipeViewOf(recipe: PackRecipe): PackRecipeView {
  return {
    ...packSummaryOf(recipe),
    ingredients: [...recipe.ingredients],
    steps: [...recipe.steps],
    source: { ...recipe.source },
  };
}

/**
 * One pack recipe as a cookbook row, with its citation KEPT.
 *
 * The four fields the layout carries become the store's five, and the fifth is
 * the one the format has no place for: `RecipeLicence.author`. It is filled from
 * the PACK MANIFEST's `source.name` — who published the corpus — because that is
 * the only name the format states, and the licence columns exist to say where a
 * recipe came from. The attribution sentence, which most open licences actually
 * require, is copied whole, and the licence identifier and the url with it.
 *
 * The ingredient STRINGS are parsed here by `parseIngredientLine`, the module's
 * own parser, and each line keeps its raw text — so a copy made in 2026 still
 * reads the way the pack wrote it after the parser learns something new.
 */
function packRecipeInput(pack: RecipesDataset, recipe: PackRecipe): CreateRecipeInput {
  const lines: RecipeIngredientInput[] = recipe.ingredients.map((text) => {
    const parsed = parseIngredientLine(text);
    if (parsed === null) {
      throw new Error(`Pack "${pack.manifest.id}": recipe "${recipe.id}" holds an empty ingredient line.`);
    }
    return {
      rawText: text,
      quantity: parsed.quantity,
      quantityMax: parsed.quantityMax,
      unit: parsed.unit,
      name: parsed.name,
      preparation: parsed.preparation,
      group: parsed.group,
      foodRef: null,
      gramsPerUnit: null,
    };
  });
  const licence: RecipeLicence = {
    title: recipe.source.title,
    author: pack.manifest.source.name,
    url: recipe.source.url,
    licenceId: recipe.source.licence,
    attribution: recipe.source.attribution,
  };
  return {
    title: recipe.title,
    // The description stays empty rather than repeating the source: the licence
    // block is what names where this came from, and a pack's one line of copy
    // would be a second answer to that question.
    description: "",
    cuisine: "",
    course: "other",
    // A pack that states no servings is one serving — the honest default for
    // „nobody said", and the food figures are per serving of what it yields.
    servings: recipe.servings ?? 1,
    ingredients: lines,
    steps: recipe.steps.map((text) => ({ text, timerMinutes: null })),
    tags: [...recipe.tags],
    rating: null,
    notes: "",
    favourite: false,
    source: "imported",
    licence,
  };
}

