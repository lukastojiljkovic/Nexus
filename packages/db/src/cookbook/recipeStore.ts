import type Database from "better-sqlite3-multiple-ciphers";
import {
  COOKBOOK_COURSES,
  INGREDIENT_UNITS,
  RECIPE_SOURCES,
  foodRefText,
  isRecipeLicenceId,
  parseFoodRef,
} from "@nexus/core";
import type {
  CookbookCourse,
  FoodRef,
  IngredientLine,
  IngredientUnit,
  RecipeLicence,
  RecipeSource,
  RecipeStep,
} from "@nexus/core";
import { RecipeNotFoundError, RecipeValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

export const MAX_RECIPE_TITLE_LENGTH = 120;
export const MAX_RECIPE_DESCRIPTION_LENGTH = 2_000;
export const MAX_RECIPE_CUISINE_LENGTH = 60;
export const MAX_RECIPE_NOTES_LENGTH = 8_000;
/** A recipe for more people than this is a banquet, not a recipe — and the number goes into an INTEGER every scaling read multiplies. */
export const MAX_RECIPE_SERVINGS = 100;
/**
 * The ceiling on a prep or cook time, in minutes: one week. Not a semantic limit
 * — a fermenting dough really does take three days — but an untrusted number goes
 * into an INTEGER a page formats as a duration, and a bound is cheaper than
 * discovering the absence of one.
 */
export const MAX_RECIPE_TIME_MINUTES = 10_080;
/** Past this many ingredients a recipe stops being a recipe and starts being a spreadsheet. */
export const MAX_RECIPE_INGREDIENTS = 100;
export const MAX_RECIPE_STEPS = 100;
export const MAX_RECIPE_TAGS = 20;
export const MAX_RECIPE_TAG_LENGTH = 40;
export const MAX_RECIPE_STEP_TEXT_LENGTH = 2_000;
/** A timer nobody will watch for longer than a day is a number somebody typed into the wrong field (migration 076's CHECK). */
export const MAX_RECIPE_STEP_TIMER_MINUTES = 1_440;
export const MAX_INGREDIENT_NAME_LENGTH = 120;
export const MAX_INGREDIENT_PREPARATION_LENGTH = 120;
export const MAX_INGREDIENT_GROUP_LENGTH = 60;
/** The ceiling on an amount: „100 000 g" is a hundred kilograms and holds every batch this app will see. */
export const MAX_INGREDIENT_QUANTITY = 100_000;
/** A unit that weighs more than this is a sack of it, not a portion — `MAX_FIT_SERVING_GRAMS`' rule one module over. */
export const MAX_INGREDIENT_UNIT_GRAMS = 10_000;
export const MAX_LICENCE_TEXT_LENGTH = 200;
export const MAX_LICENCE_URL_LENGTH = 500;
export const MAX_LICENCE_ATTRIBUTION_LENGTH = 500;
/**
 * The wire/store cap on one recipe photo's byte size, mirroring
 * `MAX_NOTE_ATTACHMENT_BYTES` — the same limit, declared on both sides so
 * neither module imports the other's number.
 */
export const MAX_RECIPE_PHOTO_BYTES = 52_428_800; // 50 MB

/**
 * Serbian Latin ordering for the recipe list, the app's one collator spelling:
 * plain `"sr"` mis-tailors š/č/ć/ž, and SQLite's BINARY collation would put
 * „Šopska" after „Pasulj". Sorted here rather than deferred to the renderer for
 * `HabitStore`'s reason — a store that hands back an order nobody fixes is a bug
 * waiting for the next slice to inherit.
 */
const RECIPE_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

const MAX_FILE_NAME_LENGTH = 255;
const MAX_MIME_LENGTH = 100;
const MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
/** A citation has to be openable: `http(s)` only, or a „source" is a hole (`@nexus/core`'s own rule for a food's source url). */
const HTTP_URL_PATTERN = /^https?:\/\/\S+$/;
/** The id length bound `check:ids` names as a class: an id is an identifier, not a document. */
const MAX_ID_LENGTH = 200;

/**
 * One ingredient line as the store holds it: the model's own fields, plus the
 * row's identity and where it sits in the recipe. `position` is derived from the
 * array order on every write rather than sent by a caller (see the class doc).
 */
export interface RecipeIngredient extends IngredientLine {
  id: string;
  recipeId: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** One step as the store holds it — the model plus the same four row fields. */
export interface RecipeStepRow extends RecipeStep {
  id: string;
  recipeId: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A recipe's photo as the store holds it: the attachment INDEX row and never the
 * bytes, which sit content-addressed on disk and belong to main's blob store
 * (migration 013's arrangement, reused — see migration 076's file doc).
 */
export interface RecipePhoto {
  fileName: string;
  /** The main-process sniffed type at attach time (SEC-FILE-02), never the renderer's claim. */
  mime: string;
  sizeBytes: number;
  sha256: string;
}

/** A recipe as the store returns it, its children in their stored order. */
export interface Recipe {
  id: string;
  profileId: string;
  title: string;
  description: string;
  /** Free text: „srpska", „italijanska" — see migration 076. */
  cuisine: string;
  course: CookbookCourse;
  servings: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  ingredients: RecipeIngredient[];
  steps: RecipeStepRow[];
  tags: string[];
  rating: number | null;
  notes: string;
  favourite: boolean;
  source: RecipeSource;
  /** All five fields for an imported recipe, null for an own one — the schema states the pair. */
  licence: RecipeLicence | null;
  photo: RecipePhoto | null;
  createdAt: string;
  updatedAt: string;
}

/** A line as a caller supplies it — no id, no position, all of it validated here. */
export interface RecipeIngredientInput {
  name: string;
  quantity?: number | null;
  quantityMax?: number | null;
  unit?: IngredientUnit | null;
  preparation?: string | null;
  group?: string | null;
  foodRef?: FoodRef | null;
  gramsPerUnit?: number | null;
}

/** A step as a caller supplies it. */
export interface RecipeStepInput {
  text: string;
  timerMinutes?: number | null;
}

export interface CreateRecipeInput {
  title: string;
  description?: string;
  cuisine?: string;
  course: CookbookCourse;
  servings: number;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  ingredients: readonly RecipeIngredientInput[];
  steps: readonly RecipeStepInput[];
  tags?: readonly string[];
  rating?: number | null;
  notes?: string;
  favourite?: boolean;
  source: RecipeSource;
  /** Required for `imported` and refused for `own`; never changeable afterwards. */
  licence?: RecipeLicence | null;
  photo?: RecipePhoto | null;
}

/**
 * A partial patch. An omitted key is left untouched; an explicit `null` clears a
 * nullable field. `ingredients` and `steps` are replaced WHOLESALE when given,
 * for `FitRoutineStore`'s reason: a per-line patch would need a third value
 * meaning „leave this alone", distinct from `null` meaning „clear this", and that
 * third value is `undefined` — a distinction JSON does not keep across the IPC
 * boundary. `source` and the licence are deliberately NOT here: an imported
 * recipe keeps its attribution through every edit (migration 076).
 */
export interface UpdateRecipeFields {
  title?: string;
  description?: string;
  cuisine?: string;
  course?: CookbookCourse;
  servings?: number;
  prepMinutes?: number | null;
  cookMinutes?: number | null;
  ingredients?: readonly RecipeIngredientInput[];
  steps?: readonly RecipeStepInput[];
  tags?: readonly string[];
  rating?: number | null;
  notes?: string;
  favourite?: boolean;
  photo?: RecipePhoto | null;
}

/** One exported ingredient: the model, its id, and nothing else — the array's order IS the order. */
export interface ExportedIngredient extends IngredientLine {
  id: string;
}

/** One exported step, same arrangement. */
export interface ExportedStep extends RecipeStep {
  id: string;
}

/** One recipe as the archive carries it: no `profileId` (the import is into one) and no `position` (the array says it). */
export interface ExportedRecipe {
  id: string;
  title: string;
  description: string;
  cuisine: string;
  course: CookbookCourse;
  servings: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  ingredients: ExportedIngredient[];
  steps: ExportedStep[];
  tags: string[];
  rating: number | null;
  notes: string;
  favourite: boolean;
  source: RecipeSource;
  licence: RecipeLicence | null;
  photo: RecipePhoto | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The export format's version, and the ONLY one `importData` accepts. A version
 * this build does not know is a refusal rather than a best effort: an archive
 * written by a later Nexus may carry a field whose absence here means something
 * different, and importing half of it would be guessing.
 */
export const COOKBOOK_EXPORT_VERSION = 1;

/** What one profile's cookbook exports: a version, and every live recipe with its children. */
export interface CookbookExport {
  version: typeof COOKBOOK_EXPORT_VERSION;
  recipes: ExportedRecipe[];
}

interface RecipeRow {
  id: string;
  profile_id: string;
  title: string;
  description: string;
  cuisine: string;
  course: string;
  servings: number;
  prep_minutes: number | null;
  cook_minutes: number | null;
  tags_json: string;
  rating: number | null;
  notes: string;
  favourite: number;
  source: string;
  licence_title: string | null;
  licence_author: string | null;
  licence_url: string | null;
  licence_id: string | null;
  licence_attribution: string | null;
  photo_file_name: string | null;
  photo_mime: string | null;
  photo_size_bytes: number | null;
  photo_sha256: string | null;
  created_at: string;
  updated_at: string;
}

interface IngredientRow {
  id: string;
  recipe_id: string;
  position: number;
  group_heading: string | null;
  quantity: number | null;
  quantity_max: number | null;
  unit: string | null;
  name: string;
  preparation: string | null;
  food_ref: string | null;
  grams_per_unit: number | null;
  created_at: string;
  updated_at: string;
}

interface StepRow {
  id: string;
  recipe_id: string;
  position: number;
  text: string;
  timer_minutes: number | null;
  created_at: string;
  updated_at: string;
}

const RECIPE_COLUMNS =
  "id, profile_id, title, description, cuisine, course, servings, prep_minutes, cook_minutes, " +
  "tags_json, rating, notes, favourite, source, licence_title, licence_author, licence_url, " +
  "licence_id, licence_attribution, photo_file_name, photo_mime, photo_size_bytes, photo_sha256, " +
  "created_at, updated_at";

const INGREDIENT_COLUMNS =
  "id, recipe_id, position, group_heading, quantity, quantity_max, unit, name, preparation, " +
  "food_ref, grams_per_unit, created_at, updated_at";

const STEP_COLUMNS = "id, recipe_id, position, text, timer_minutes, created_at, updated_at";

/** A recipe's own fields, resolved and validated — what both a create and an update write. */
interface ResolvedRecipe {
  title: string;
  description: string;
  cuisine: string;
  course: CookbookCourse;
  servings: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  tags: string[];
  rating: number | null;
  notes: string;
  favourite: boolean;
  photo: RecipePhoto | null;
}

/** One validated child row, before the store mints it an id and a position. */
interface ResolvedIngredient extends IngredientLine {
  /** The wire text the column holds, or null — validated through `parseFoodRef`. */
  foodRefText: string | null;
}

/**
 * The profile's cookbook (COOK, migration 076), over prepared, parameterized
 * statements (SEC-API-03; every value is bound, never interpolated). Construct
 * one per profile and reuse it.
 *
 * **Every recipe statement is scoped by `profile_id`, and every child statement
 * is scoped through its recipe.** `cookbook_ingredients` and `cookbook_steps`
 * carry no `profile_id` of their own, the `note_attachments` arrangement, so
 * nothing here ever names a child id on its own: every child read and every child
 * delete runs through a `recipe_id` this store resolved in THIS profile first.
 *
 * **Ingredients and steps are replaced WHOLESALE, and `position` is derived from
 * the array's order — never sent by a caller.** A whole-list write has no
 * ambiguity between „clear this" and „leave this alone", and the screen that
 * edits a recipe already holds every line (migration 076's own argument for the
 * column). A create or an update that writes children is ONE transaction: a
 * recipe left with half its ingredients after a crash mid-write is not a saved
 * recipe.
 *
 * **Validation happens BEFORE the transaction opens**, in `resolveRecipe` and its
 * helpers, which are the one place every refusal lives so that `create`, `update`
 * and `importData` cannot drift on what a recipe is allowed to be. That ordering
 * is the property `importData` needs: it validates the whole archive value and
 * only then replaces anything, so a value with one bad recipe in it leaves the
 * profile's cookbook exactly as it was.
 *
 * `now` is supplied by the caller and validated here — main stamps the clock, the
 * renderer never does.
 */
export class RecipeStore {
  private readonly insertRecipe: Database.Statement;
  private readonly selectActiveRecipes: Database.Statement;
  private readonly selectActiveRecipeById: Database.Statement;
  private readonly updateRecipeFields: Database.Statement;
  private readonly updateRecipePhoto: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;
  private readonly insertIngredient: Database.Statement;
  private readonly selectIngredientsByRecipe: Database.Statement;
  private readonly selectIngredientsForProfile: Database.Statement;
  private readonly deleteIngredientsByRecipe: Database.Statement;
  private readonly insertStep: Database.Statement;
  private readonly selectStepsByRecipe: Database.Statement;
  private readonly selectStepsForProfile: Database.Statement;
  private readonly deleteStepsByRecipe: Database.Statement;
  private readonly deleteRecipesByProfile: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertRecipe = db.prepare(
      `INSERT INTO cookbook_recipes
         (id, profile_id, title, description, cuisine, course, servings, prep_minutes,
          cook_minutes, tags_json, rating, notes, favourite, source, licence_title,
          licence_author, licence_url, licence_id, licence_attribution, photo_file_name,
          photo_mime, photo_size_bytes, photo_sha256, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActiveRecipes = db.prepare(
      `SELECT ${RECIPE_COLUMNS} FROM cookbook_recipes
        WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    // The one gate every mutation passes: live in THIS profile.
    this.selectActiveRecipeById = db.prepare(
      `SELECT ${RECIPE_COLUMNS} FROM cookbook_recipes
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateRecipeFields = db.prepare(
      `UPDATE cookbook_recipes
          SET title = ?, description = ?, cuisine = ?, course = ?, servings = ?,
              prep_minutes = ?, cook_minutes = ?, tags_json = ?, rating = ?, notes = ?,
              favourite = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // The photo moves as its own four columns, so an update can never set the
    // mime without the hash beside it — which migration 076's CHECKs refuse
    // anyway, but as a constraint failure rather than as this store's answer.
    this.updateRecipePhoto = db.prepare(
      `UPDATE cookbook_recipes
          SET photo_file_name = ?, photo_mime = ?, photo_size_bytes = ?, photo_sha256 = ?,
              updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE cookbook_recipes SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE cookbook_recipes SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.insertIngredient = db.prepare(
      `INSERT INTO cookbook_ingredients
         (id, recipe_id, position, group_heading, quantity, quantity_max, unit, name,
          preparation, food_ref, grams_per_unit, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectIngredientsByRecipe = db.prepare(
      `SELECT ${INGREDIENT_COLUMNS} FROM cookbook_ingredients
        WHERE recipe_id = ? ORDER BY position, id`,
    );
    // ONE query for every live recipe's lines, joined to the recipe for the
    // profile scope this table does not carry — an N+1 per recipe is the obvious
    // wrong shape for a list page.
    this.selectIngredientsForProfile = db.prepare(
      `SELECT i.id AS id, i.recipe_id AS recipe_id, i.position AS position,
              i.group_heading AS group_heading, i.quantity AS quantity,
              i.quantity_max AS quantity_max, i.unit AS unit, i.name AS name,
              i.preparation AS preparation, i.food_ref AS food_ref,
              i.grams_per_unit AS grams_per_unit, i.created_at AS created_at,
              i.updated_at AS updated_at
         FROM cookbook_ingredients i
         JOIN cookbook_recipes r ON r.id = i.recipe_id
        WHERE r.profile_id = ? AND r.deleted_at IS NULL
        ORDER BY i.recipe_id, i.position, i.id`,
    );
    // Scoped through the recipe, whose live-ness the caller checked in THIS
    // profile first — a child id alone never reaches another profile's row.
    this.deleteIngredientsByRecipe = db.prepare(
      `DELETE FROM cookbook_ingredients WHERE recipe_id = ?`,
    );
    this.insertStep = db.prepare(
      `INSERT INTO cookbook_steps
         (id, recipe_id, position, text, timer_minutes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectStepsByRecipe = db.prepare(
      `SELECT ${STEP_COLUMNS} FROM cookbook_steps WHERE recipe_id = ? ORDER BY position, id`,
    );
    this.selectStepsForProfile = db.prepare(
      `SELECT s.id AS id, s.recipe_id AS recipe_id, s.position AS position, s.text AS text,
              s.timer_minutes AS timer_minutes, s.created_at AS created_at,
              s.updated_at AS updated_at
         FROM cookbook_steps s
         JOIN cookbook_recipes r ON r.id = s.recipe_id
        WHERE r.profile_id = ? AND r.deleted_at IS NULL
        ORDER BY s.recipe_id, s.position, s.id`,
    );
    this.deleteStepsByRecipe = db.prepare(`DELETE FROM cookbook_steps WHERE recipe_id = ?`);
    // The import's one destructive statement, and it is scoped by THIS profile:
    // the cascade takes the two child tables with it, and no other profile's
    // cookbook is touched.
    this.deleteRecipesByProfile = db.prepare(`DELETE FROM cookbook_recipes WHERE profile_id = ?`);
  }

  /** This profile's live recipes, sr-Latn alphabetical by title, each with its ingredients and steps in order. */
  list(): Recipe[] {
    const rows = this.selectActiveRecipes.all(this.profileId) as RecipeRow[];
    const ingredients = groupByRecipe(
      this.selectIngredientsForProfile.all(this.profileId) as IngredientRow[],
    );
    const steps = groupByRecipe(this.selectStepsForProfile.all(this.profileId) as StepRow[]);

    return rows
      .map((row) =>
        toRecipe(
          row,
          (ingredients.get(row.id) ?? []).map(toIngredient),
          (steps.get(row.id) ?? []).map(toStep),
        ),
      )
      .sort(
        (left, right) =>
          RECIPE_COLLATOR.compare(left.title, right.title) || left.id.localeCompare(right.id),
      );
  }

  /** One live recipe with its children, or throws (`requireRecipe`). */
  get(id: string): Recipe {
    return this.requireRecipe(id);
  }

  /** Inserts a recipe and its children, and returns the stored row. */
  create(input: CreateRecipeInput, now: string): Recipe {
    const validNow = validateNow(now);
    const licence = validateLicence(input.source, input.licence ?? null);
    const resolved = resolveRecipe({
      title: input.title,
      description: input.description ?? "",
      cuisine: input.cuisine ?? "",
      course: input.course,
      servings: input.servings,
      prepMinutes: input.prepMinutes ?? null,
      cookMinutes: input.cookMinutes ?? null,
      tags: input.tags ?? [],
      rating: input.rating ?? null,
      notes: input.notes ?? "",
      favourite: input.favourite ?? false,
      photo: input.photo ?? null,
    });
    const ingredients = validateIngredients(input.ingredients);
    const steps = validateSteps(input.steps);
    const id = uuidv7();

    return this.db.transaction((): Recipe => {
      this.insertRecipe.run(
        id, this.profileId, resolved.title, resolved.description, resolved.cuisine,
        resolved.course, resolved.servings, resolved.prepMinutes, resolved.cookMinutes,
        JSON.stringify(resolved.tags), resolved.rating, resolved.notes,
        resolved.favourite ? 1 : 0, input.source, licence?.title ?? null,
        licence?.author ?? null, licence?.url ?? null, licence?.licenceId ?? null,
        licence?.attribution ?? null, resolved.photo?.fileName ?? null,
        resolved.photo?.mime ?? null, resolved.photo?.sizeBytes ?? null,
        resolved.photo?.sha256 ?? null, validNow, validNow,
      );
      this.writeIngredients(id, ingredients, validNow);
      this.writeSteps(id, steps, validNow);

      return {
        id,
        profileId: this.profileId,
        ...resolved,
        ingredients: this.readIngredients(id),
        steps: this.readSteps(id),
        source: input.source,
        licence,
        createdAt: validNow,
        updatedAt: validNow,
      };
    })();
  }

  /**
   * Applies a partial patch. A given `ingredients` or `steps` replaces the whole
   * list inside the same transaction as the recipe's own fields, and the photo
   * moves as one unit or not at all.
   *
   * `source` and the licence are unreachable from here, deliberately: where a
   * recipe came from is not something an edit changes, which is what keeps an
   * edited imported recipe's attribution intact.
   */
  update(id: string, fields: UpdateRecipeFields, now: string): Recipe {
    const validNow = validateNow(now);
    const current = this.requireRecipe(id);

    const resolved = resolveRecipe({
      title: fields.title ?? current.title,
      description: fields.description ?? current.description,
      cuisine: fields.cuisine ?? current.cuisine,
      course: fields.course ?? current.course,
      servings: fields.servings ?? current.servings,
      prepMinutes: "prepMinutes" in fields ? (fields.prepMinutes ?? null) : current.prepMinutes,
      cookMinutes: "cookMinutes" in fields ? (fields.cookMinutes ?? null) : current.cookMinutes,
      tags: fields.tags ?? current.tags,
      rating: "rating" in fields ? (fields.rating ?? null) : current.rating,
      notes: fields.notes ?? current.notes,
      favourite: fields.favourite ?? current.favourite,
      photo: "photo" in fields ? (fields.photo ?? null) : current.photo,
    });
    const ingredients =
      fields.ingredients === undefined ? null : validateIngredients(fields.ingredients);
    const steps = fields.steps === undefined ? null : validateSteps(fields.steps);

    return this.db.transaction((): Recipe => {
      this.updateRecipeFields.run(
        resolved.title, resolved.description, resolved.cuisine, resolved.course,
        resolved.servings, resolved.prepMinutes, resolved.cookMinutes,
        JSON.stringify(resolved.tags), resolved.rating, resolved.notes,
        resolved.favourite ? 1 : 0, validNow, id, this.profileId,
      );
      if ("photo" in fields) {
        this.updateRecipePhoto.run(
          resolved.photo?.fileName ?? null, resolved.photo?.mime ?? null,
          resolved.photo?.sizeBytes ?? null, resolved.photo?.sha256 ?? null,
          validNow, id, this.profileId,
        );
      }
      if (ingredients !== null) {
        this.deleteIngredientsByRecipe.run(id);
        this.writeIngredients(id, ingredients, validNow);
      }
      if (steps !== null) {
        this.deleteStepsByRecipe.run(id);
        this.writeSteps(id, steps, validNow);
      }

      return {
        ...current,
        ...resolved,
        ingredients: this.readIngredients(id),
        steps: this.readSteps(id),
        updatedAt: validNow,
      };
    })();
  }

  /** Soft-deletes a live recipe (reversible via `restore`). Its children are UNTOUCHED — see the class doc. */
  softDelete(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new RecipeNotFoundError(`No live recipe "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted recipe, its ingredients and its steps included. */
  restore(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new RecipeNotFoundError(`No deleted recipe "${id}" to restore in this profile.`);
    }
  }

  /**
   * Every live recipe with its children, as a versioned plain JSON value — what
   * stage 2 hands to the profile archive.
   *
   * Ids and timestamps are the stored ones, because an archive that lost them
   * could not be imported back over the same profile without minting new
   * identities for rows a restore is supposed to reproduce. Soft-deleted recipes
   * are NOT exported: an archive carries what the profile has, and the delete is
   * a local fact about the list (`RESTORE_WIPE_TABLES`' own reading of every
   * module's content).
   */
  exportData(): CookbookExport {
    return {
      version: COOKBOOK_EXPORT_VERSION,
      recipes: this.list().map((entry) => ({
        id: entry.id,
        title: entry.title,
        description: entry.description,
        cuisine: entry.cuisine,
        course: entry.course,
        servings: entry.servings,
        prepMinutes: entry.prepMinutes,
        cookMinutes: entry.cookMinutes,
        ingredients: entry.ingredients.map((line) => ({
          id: line.id,
          quantity: line.quantity,
          quantityMax: line.quantityMax,
          unit: line.unit,
          name: line.name,
          preparation: line.preparation,
          group: line.group,
          foodRef: line.foodRef,
          gramsPerUnit: line.gramsPerUnit,
        })),
        steps: entry.steps.map((step) => ({
          id: step.id,
          text: step.text,
          timerMinutes: step.timerMinutes,
        })),
        tags: [...entry.tags],
        rating: entry.rating,
        notes: entry.notes,
        favourite: entry.favourite,
        source: entry.source,
        licence: entry.licence === null ? null : { ...entry.licence },
        photo: entry.photo === null ? null : { ...entry.photo },
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
    };
  }

  /**
   * Replaces this profile's cookbook with an exported value, in ONE transaction,
   * after validating the WHOLE value — nothing is written if anything in it is
   * refused, which is the only behaviour that leaves a caller able to retry after
   * fixing one recipe.
   *
   * The ids travel with the rows (see `exportData`), and the array order is the
   * order: a stored `position` is derived here rather than trusted, so a value
   * whose order and positions disagreed could not produce a half-ordered recipe.
   * An unknown `version` is refused outright rather than interpreted.
   */
  importData(value: unknown): void {
    const archive = parseCookbookExport(value);

    this.db.transaction((): void => {
      this.deleteRecipesByProfile.run(this.profileId);
      for (const recipe of archive.recipes) {
        this.insertRecipe.run(
          recipe.id, this.profileId, recipe.title, recipe.description, recipe.cuisine,
          recipe.course, recipe.servings, recipe.prepMinutes, recipe.cookMinutes,
          JSON.stringify(recipe.tags), recipe.rating, recipe.notes,
          recipe.favourite ? 1 : 0, recipe.source, recipe.licence?.title ?? null,
          recipe.licence?.author ?? null, recipe.licence?.url ?? null,
          recipe.licence?.licenceId ?? null, recipe.licence?.attribution ?? null,
          recipe.photo?.fileName ?? null, recipe.photo?.mime ?? null,
          recipe.photo?.sizeBytes ?? null, recipe.photo?.sha256 ?? null,
          recipe.createdAt, recipe.updatedAt,
        );
        recipe.ingredients.forEach((line, index) => {
          this.insertIngredient.run(
            line.id, recipe.id, index, line.group, line.quantity, line.quantityMax,
            line.unit, line.name, line.preparation, line.foodRefText,
            line.gramsPerUnit, recipe.createdAt, recipe.updatedAt,
          );
        });
        recipe.steps.forEach((step, index) => {
          this.insertStep.run(
            step.id, recipe.id, index, step.text, step.timerMinutes,
            recipe.createdAt, recipe.updatedAt,
          );
        });
      }
    })();
  }

  /** Reads a live recipe in this profile or throws — the gate every mutation and child write runs first. */
  private requireRecipe(id: string): Recipe {
    const row = this.selectActiveRecipeById.get(id, this.profileId) as RecipeRow | undefined;
    if (!row) {
      throw new RecipeNotFoundError(`No live recipe "${id}" in this profile.`);
    }
    return toRecipe(row, this.readIngredients(id), this.readSteps(id));
  }

  private writeIngredients(
    recipeId: string,
    lines: readonly ResolvedIngredient[],
    now: string,
  ): void {
    lines.forEach((line, index) => {
      this.insertIngredient.run(
        uuidv7(), recipeId, index, line.group, line.quantity, line.quantityMax, line.unit,
        line.name, line.preparation, line.foodRefText, line.gramsPerUnit, now, now,
      );
    });
  }

  private writeSteps(recipeId: string, steps: readonly RecipeStep[], now: string): void {
    steps.forEach((step, index) => {
      this.insertStep.run(uuidv7(), recipeId, index, step.text, step.timerMinutes, now, now);
    });
  }

  private readIngredients(recipeId: string): RecipeIngredient[] {
    const rows = this.selectIngredientsByRecipe.all(recipeId) as IngredientRow[];
    return rows.map(toIngredient);
  }

  private readSteps(recipeId: string): RecipeStepRow[] {
    const rows = this.selectStepsByRecipe.all(recipeId) as StepRow[];
    return rows.map(toStep);
  }
}

/** Index a child table's rows by the recipe they belong to, keeping each list's own order. */
function groupByRecipe<T extends { recipe_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.recipe_id);
    if (bucket === undefined) grouped.set(row.recipe_id, [row]);
    else bucket.push(row);
  }
  return grouped;
}

function toRecipe(
  row: RecipeRow,
  ingredients: RecipeIngredient[],
  steps: RecipeStepRow[],
): Recipe {
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    description: row.description,
    cuisine: row.cuisine,
    course: row.course as CookbookCourse,
    servings: row.servings,
    prepMinutes: row.prep_minutes,
    cookMinutes: row.cook_minutes,
    ingredients,
    steps,
    tags: parseStoredTags(row.tags_json, row.id),
    rating: row.rating,
    notes: row.notes,
    favourite: row.favourite !== 0,
    source: row.source as RecipeSource,
    licence: toLicence(row),
    photo: toPhoto(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The five licence columns as one value, or null. The schema ties them together, so this reads either all or none. */
function toLicence(row: RecipeRow): RecipeLicence | null {
  if (row.licence_id === null) return null;
  return {
    title: row.licence_title ?? "",
    author: row.licence_author ?? "",
    url: row.licence_url ?? "",
    licenceId: row.licence_id,
    attribution: row.licence_attribution ?? "",
  };
}

function toPhoto(row: RecipeRow): RecipePhoto | null {
  if (row.photo_sha256 === null) return null;
  return {
    fileName: row.photo_file_name ?? "",
    mime: row.photo_mime ?? "",
    sizeBytes: row.photo_size_bytes ?? 0,
    sha256: row.photo_sha256,
  };
}

function toIngredient(row: IngredientRow): RecipeIngredient {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    position: row.position,
    quantity: row.quantity,
    quantityMax: row.quantity_max,
    unit: row.unit as IngredientUnit | null,
    name: row.name,
    preparation: row.preparation,
    group: row.group_heading,
    foodRef: storedFoodRef(row.food_ref, row.id),
    gramsPerUnit: row.grams_per_unit,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStep(row: StepRow): RecipeStepRow {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    position: row.position,
    text: row.text,
    timerMinutes: row.timer_minutes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Reads a stored `food_ref` back. This store writes only `foodRefText` output, so
 * anything that fails to parse is corruption (a hand-edited file, a bad restore)
 * rather than input to coerce — reading it as null would silently drop a link the
 * user made, so it throws naming the row (`HabitStore.parseStoredSchedule`'s
 * posture).
 */
function storedFoodRef(text: string | null, id: string): FoodRef | null {
  if (text === null) return null;
  const ref = parseFoodRef(text);
  if (ref === null) {
    throw new RecipeValidationError(`Ingredient "${id}" carries a food reference that is not one.`);
  }
  return ref;
}

/**
 * Reads the stored `tags_json` back. As above: this store writes only
 * `JSON.stringify` of a validated list, so anything else is corruption rather
 * than input to coerce.
 */
function parseStoredTags(text: string, id: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RecipeValidationError(`Recipe "${id}" carries tags that are not valid JSON.`);
  }
  if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== "string")) {
    throw new RecipeValidationError(`Recipe "${id}" carries tags that are not a list of names.`);
  }
  return parsed as string[];
}

/**
 * Validates and resolves a recipe's own scalar fields — the ONE place those
 * refusals live, so `create`, `update` and an import cannot drift on what a
 * recipe is allowed to be.
 */
function resolveRecipe(fields: {
  title: string;
  description: string;
  cuisine: string;
  course: CookbookCourse;
  servings: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  tags: readonly string[];
  rating: number | null;
  notes: string;
  favourite: boolean;
  photo: RecipePhoto | null;
}): ResolvedRecipe {
  return {
    title: validateText(fields.title, "title", MAX_RECIPE_TITLE_LENGTH),
    description: validateBoundedText(
      fields.description,
      "description",
      MAX_RECIPE_DESCRIPTION_LENGTH,
    ),
    cuisine: validateOptionalText(fields.cuisine, "cuisine", MAX_RECIPE_CUISINE_LENGTH) ?? "",
    course: validateCourse(fields.course),
    servings: validateServings(fields.servings),
    prepMinutes: validateMinutes(fields.prepMinutes, "prepMinutes"),
    cookMinutes: validateMinutes(fields.cookMinutes, "cookMinutes"),
    tags: validateTags(fields.tags),
    rating: validateRating(fields.rating),
    notes: validateBoundedText(fields.notes, "notes", MAX_RECIPE_NOTES_LENGTH),
    favourite: validateFavourite(fields.favourite),
    photo: validatePhoto(fields.photo),
  };
}

/**
 * Validates the licence against the source, the pair migration 076 states in
 * CHECKs: an own recipe carries none, an imported one carries all five.
 *
 * Refused rather than repaired, in both directions. An own recipe with an
 * attribution is a recipe somebody is about to credit to the wrong person, and an
 * imported one without it is exactly what the field exists to prevent — so this
 * store does not get to decide the caller meant „own".
 */
function validateLicence(
  source: RecipeSource,
  licence: RecipeLicence | null,
): RecipeLicence | null {
  if (!(RECIPE_SOURCES as readonly string[]).includes(source)) {
    throw new RecipeValidationError(`"source" must be one of ${RECIPE_SOURCES.join(", ")}.`);
  }
  if (source === "own") {
    if (licence !== null) {
      throw new RecipeValidationError('An "own" recipe carries no licence to attribute.');
    }
    return null;
  }
  if (licence === null || typeof licence !== "object") {
    throw new RecipeValidationError('An "imported" recipe must carry its source and licence.');
  }
  const licenceId = licence.licenceId;
  if (typeof licenceId !== "string" || !isRecipeLicenceId(licenceId)) {
    throw new RecipeValidationError(
      '"licence.licenceId" must be an SPDX identifier or "public-domain".',
    );
  }
  const url = licence.url;
  if (
    typeof url !== "string" ||
    url.length > MAX_LICENCE_URL_LENGTH ||
    !HTTP_URL_PATTERN.test(url)
  ) {
    throw new RecipeValidationError('"licence.url" must be an http(s) url.');
  }
  return {
    title: validateText(licence.title, "licence.title", MAX_LICENCE_TEXT_LENGTH),
    author: validateText(licence.author, "licence.author", MAX_LICENCE_TEXT_LENGTH),
    url,
    licenceId,
    attribution: validateText(
      licence.attribution,
      "licence.attribution",
      MAX_LICENCE_ATTRIBUTION_LENGTH,
    ),
  };
}

/**
 * Validates the photo index row — the attachment's metadata, never its bytes.
 * The mime, size and hash are what main derived from the blob itself rather than
 * whatever the renderer claimed (SEC-FILE-02), and this store re-checks them
 * because a store is never the place that assumes its caller did.
 */
function validatePhoto(photo: RecipePhoto | null): RecipePhoto | null {
  if (photo === null) return null;
  const fileName = typeof photo.fileName === "string" ? photo.fileName.trim() : "";
  if (fileName.length === 0 || fileName.length > MAX_FILE_NAME_LENGTH) {
    throw new RecipeValidationError(
      `"photo.fileName" must be 1-${MAX_FILE_NAME_LENGTH} characters after trimming.`,
    );
  }
  if (fileName.includes("/") || fileName.includes("\\")) {
    throw new RecipeValidationError('"photo.fileName" must not contain path separators.');
  }
  if (
    typeof photo.mime !== "string" ||
    photo.mime.length > MAX_MIME_LENGTH ||
    !MIME_PATTERN.test(photo.mime)
  ) {
    throw new RecipeValidationError('"photo.mime" must be a valid MIME type.');
  }
  if (
    !Number.isSafeInteger(photo.sizeBytes) ||
    photo.sizeBytes <= 0 ||
    photo.sizeBytes > MAX_RECIPE_PHOTO_BYTES
  ) {
    throw new RecipeValidationError(
      `"photo.sizeBytes" must be a positive integer of at most ${MAX_RECIPE_PHOTO_BYTES} bytes.`,
    );
  }
  if (typeof photo.sha256 !== "string" || !SHA256_PATTERN.test(photo.sha256)) {
    throw new RecipeValidationError('"photo.sha256" must be a 64-character lowercase hex string.');
  }
  return { fileName, mime: photo.mime, sizeBytes: photo.sizeBytes, sha256: photo.sha256 };
}

function validateIngredients(lines: readonly RecipeIngredientInput[]): ResolvedIngredient[] {
  if (!Array.isArray(lines)) {
    throw new RecipeValidationError('"ingredients" must be an array.');
  }
  if (lines.length > MAX_RECIPE_INGREDIENTS) {
    throw new RecipeValidationError(
      `A recipe may hold at most ${MAX_RECIPE_INGREDIENTS} ingredients (got ${lines.length}).`,
    );
  }
  return lines.map((line, index) => {
    const path = `ingredients[${index}]`;
    const name = validateText(line?.name, `${path}.name`, MAX_INGREDIENT_NAME_LENGTH);
    const quantity = validateOptionalQuantity(line?.quantity ?? null, `${path}.quantity`);
    const quantityMax = validateOptionalQuantity(line?.quantityMax ?? null, `${path}.quantityMax`);
    // Migration 076's pair CHECKs, refused here so that a malformed line is a
    // named domain error rather than a raw constraint failure: an upper bound
    // with no lower one, or a range that runs backwards, is a caller's mistake.
    if (quantityMax !== null && quantity === null) {
      throw new RecipeValidationError(`"${path}.quantityMax" needs a "quantity" to be the end of.`);
    }
    if (quantityMax !== null && quantity !== null && quantityMax < quantity) {
      throw new RecipeValidationError(
        `"${path}.quantityMax" must not be below "${path}.quantity".`,
      );
    }
    const foodRef = validateFoodRef(line?.foodRef ?? null, `${path}.foodRef`);
    const gramsPerUnit = validateGramsPerUnit(line?.gramsPerUnit ?? null, `${path}.gramsPerUnit`);
    if (gramsPerUnit !== null && foodRef === null) {
      throw new RecipeValidationError(
        `"${path}.gramsPerUnit" needs a "foodRef" to be the weight of.`,
      );
    }
    return {
      quantity,
      quantityMax,
      unit: validateUnit(line?.unit ?? null, `${path}.unit`),
      name,
      preparation: validateOptionalText(
        line?.preparation ?? null,
        `${path}.preparation`,
        MAX_INGREDIENT_PREPARATION_LENGTH,
      ),
      group: validateOptionalText(line?.group ?? null, `${path}.group`, MAX_INGREDIENT_GROUP_LENGTH),
      foodRef,
      foodRefText: foodRef === null ? null : foodRefText(foodRef),
      gramsPerUnit,
    };
  });
}

function validateSteps(steps: readonly RecipeStepInput[]): RecipeStep[] {
  if (!Array.isArray(steps)) {
    throw new RecipeValidationError('"steps" must be an array.');
  }
  if (steps.length > MAX_RECIPE_STEPS) {
    throw new RecipeValidationError(
      `A recipe may hold at most ${MAX_RECIPE_STEPS} steps (got ${steps.length}).`,
    );
  }
  return steps.map((step, index) => ({
    text: validateText(step?.text, `steps[${index}].text`, MAX_RECIPE_STEP_TEXT_LENGTH),
    timerMinutes: validateTimer(step?.timerMinutes ?? null, `steps[${index}].timerMinutes`),
  }));
}

/** The course vocabulary, checked against `@nexus/core`'s list rather than respelled — one list, one source. */
function validateCourse(value: CookbookCourse): CookbookCourse {
  if (!(COOKBOOK_COURSES as readonly string[]).includes(value)) {
    throw new RecipeValidationError('"course" must be one of the recipe courses.');
  }
  return value;
}

/** A whole number of servings in range — never a float, which no scaling read should have to decide about. */
function validateServings(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RECIPE_SERVINGS) {
    throw new RecipeValidationError(
      `"servings" must be a whole number between 1 and ${MAX_RECIPE_SERVINGS}.`,
    );
  }
  return value;
}

function validateMinutes(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_RECIPE_TIME_MINUTES) {
    throw new RecipeValidationError(
      `"${field}" must be a whole number of minutes between 1 and ${MAX_RECIPE_TIME_MINUTES}.`,
    );
  }
  return value;
}

function validateTimer(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_RECIPE_STEP_TIMER_MINUTES) {
    throw new RecipeValidationError(
      `"${field}" must be a whole number of minutes between 1 and ${MAX_RECIPE_STEP_TIMER_MINUTES}.`,
    );
  }
  return value;
}

function validateRating(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1 || value > 10) {
    throw new RecipeValidationError('"rating" must be a whole number between 1 and 10.');
  }
  return value;
}

/**
 * The tags, trimmed, deduplicated case-insensitively, in the order given. The
 * first spelling of a tag is the one kept: „Zima" and „zima" are one tag to a
 * person, and folding the case here is what stops a picker offering both.
 */
function validateTags(tags: readonly string[]): string[] {
  if (!Array.isArray(tags)) {
    throw new RecipeValidationError('"tags" must be an array.');
  }
  if (tags.length > MAX_RECIPE_TAGS) {
    throw new RecipeValidationError(`"tags" must hold at most ${MAX_RECIPE_TAGS} names.`);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const name = validateText(tag, "tags", MAX_RECIPE_TAG_LENGTH);
    const folded = name.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push(name);
  }
  return out;
}

function validateFavourite(value: boolean): boolean {
  if (typeof value !== "boolean") {
    throw new RecipeValidationError('"favourite" must be a boolean.');
  }
  return value;
}

/** Trimmed, 1..`max` — a field that must say something. */
function validateText(value: string, field: string, max: number): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new RecipeValidationError(`"${field}" must be 1-${max} characters after trimming.`);
  }
  return trimmed;
}

/** Trimmed, 0..`max` — free prose that may legitimately say nothing. */
function validateBoundedText(value: string, field: string, max: number): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length > max) {
    throw new RecipeValidationError(`"${field}" must be at most ${max} characters.`);
  }
  return trimmed;
}

/** Absent, empty and whitespace-only all collapse to null; an over-long one is refused rather than truncated. */
function validateOptionalText(value: string | null, field: string, max: number): string | null {
  if (value === null) return null;
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    throw new RecipeValidationError(`"${field}" must be at most ${max} characters after trimming.`);
  }
  return trimmed;
}

function validateOptionalQuantity(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_INGREDIENT_QUANTITY
  ) {
    throw new RecipeValidationError(
      `"${field}" must be a number above 0 and at most ${MAX_INGREDIENT_QUANTITY}.`,
    );
  }
  return value;
}

function validateGramsPerUnit(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_INGREDIENT_UNIT_GRAMS
  ) {
    throw new RecipeValidationError(
      `"${field}" must be a number above 0 and at most ${MAX_INGREDIENT_UNIT_GRAMS}.`,
    );
  }
  return value;
}

/** The closed unit vocabulary, checked against `@nexus/core`'s list rather than respelled — one vocabulary, one source. */
function validateUnit(value: IngredientUnit | null, field: string): IngredientUnit | null {
  if (value === null) return null;
  if (!(INGREDIENT_UNITS as readonly string[]).includes(value)) {
    throw new RecipeValidationError(`"${field}" must be one of the ingredient units.`);
  }
  return value;
}

/**
 * A link into the nutrition food table, checked through the SAME grammar the
 * fitness log stores its own references with (`parseFoodRef`): a reference that
 * could never resolve is refused where it enters rather than where it is read.
 */
function validateFoodRef(value: FoodRef | null, field: string): FoodRef | null {
  if (value === null) return null;
  if (typeof value !== "object" || typeof value.kind !== "string" || typeof value.id !== "string") {
    throw new RecipeValidationError(`"${field}" must be a food reference.`);
  }
  const parsed = parseFoodRef(foodRefText(value));
  if (parsed === null) {
    throw new RecipeValidationError(`"${field}" must be a catalogue or user food reference.`);
  }
  return parsed;
}

/** An id a caller supplied: non-empty and bounded — the unbounded-id class `check:ids` names. */
function validateId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new RecipeValidationError(`"${field}" must be a non-empty identifier.`);
  }
  return value;
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new RecipeValidationError('"now" must be an ISO-8601 date-time.');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One exported ingredient once it has passed: the model, its id, and the wire text its column holds. */
interface ParsedIngredient extends IngredientLine {
  id: string;
  foodRefText: string | null;
}

/** One exported recipe once it has passed — what the writer can insert without deciding anything. */
interface ParsedRecipe extends Omit<ExportedRecipe, "ingredients" | "steps"> {
  ingredients: ParsedIngredient[];
  steps: (RecipeStep & { id: string })[];
}

/**
 * Validates an export value WHOLE, and hands back the resolved rows a writer can
 * insert. Nothing here writes, and nothing here is tolerant: a version this build
 * does not know, a missing field, a value outside its closed list, an id
 * duplicated anywhere in the value — each is a refusal, because the alternative
 * is a half-imported cookbook that the caller can neither retry nor reason about.
 *
 * The `unknown` parameter is the point: this is the archive boundary, where a
 * value comes from a file somebody could have edited.
 */
function parseCookbookExport(value: unknown): { recipes: ParsedRecipe[] } {
  if (!isRecord(value)) {
    throw new RecipeValidationError("The cookbook export must be an object.");
  }
  if (value["version"] !== COOKBOOK_EXPORT_VERSION) {
    throw new RecipeValidationError(
      `Unsupported cookbook export version ${String(value["version"])}; ` +
        `this build reads version ${COOKBOOK_EXPORT_VERSION}.`,
    );
  }
  const rawRecipes = value["recipes"];
  if (!Array.isArray(rawRecipes)) {
    throw new RecipeValidationError('"recipes" must be an array.');
  }

  // Three sets, because a duplicated id is refused as a VALUE problem rather
  // than discovered as a primary-key failure halfway through the transaction.
  const recipeIds = new Set<string>();
  const ingredientIds = new Set<string>();
  const stepIds = new Set<string>();
  const recipes: ParsedRecipe[] = [];

  rawRecipes.forEach((raw, index) => {
    const path = `recipes[${index}]`;
    if (!isRecord(raw)) {
      throw new RecipeValidationError(`"${path}" must be an object.`);
    }
    const id = validateId(raw["id"], `${path}.id`);
    if (recipeIds.has(id)) {
      throw new RecipeValidationError(`"${path}.id" names a recipe the value already carries.`);
    }
    recipeIds.add(id);

    const source = raw["source"] as RecipeSource;
    const resolved = resolveRecipe({
      title: raw["title"] as string,
      description: (raw["description"] ?? "") as string,
      cuisine: (raw["cuisine"] ?? "") as string,
      course: raw["course"] as CookbookCourse,
      servings: raw["servings"] as number,
      prepMinutes: (raw["prepMinutes"] ?? null) as number | null,
      cookMinutes: (raw["cookMinutes"] ?? null) as number | null,
      tags: (raw["tags"] ?? []) as readonly string[],
      rating: (raw["rating"] ?? null) as number | null,
      notes: (raw["notes"] ?? "") as string,
      favourite: (raw["favourite"] ?? false) as boolean,
      photo: (raw["photo"] ?? null) as RecipePhoto | null,
    });
    const licence = validateLicence(source, (raw["licence"] ?? null) as RecipeLicence | null);
    const lines = validateIngredients(raw["ingredients"] as readonly RecipeIngredientInput[]);
    const steps = validateSteps(raw["steps"] as readonly RecipeStepInput[]);
    const rawLines = Array.isArray(raw["ingredients"]) ? raw["ingredients"] : [];
    const rawSteps = Array.isArray(raw["steps"]) ? raw["steps"] : [];

    recipes.push({
      id,
      ...resolved,
      ingredients: lines.map((line, lineIndex) => {
        const lineId = validateId(
          (rawLines[lineIndex] as { id?: unknown } | undefined)?.id,
          `${path}.ingredients[${lineIndex}].id`,
        );
        if (ingredientIds.has(lineId)) {
          throw new RecipeValidationError(
            `"${path}.ingredients[${lineIndex}].id" names an ingredient the value already carries.`,
          );
        }
        ingredientIds.add(lineId);
        return { ...line, id: lineId };
      }),
      steps: steps.map((step, stepIndex) => {
        const stepId = validateId(
          (rawSteps[stepIndex] as { id?: unknown } | undefined)?.id,
          `${path}.steps[${stepIndex}].id`,
        );
        if (stepIds.has(stepId)) {
          throw new RecipeValidationError(
            `"${path}.steps[${stepIndex}].id" names a step the value already carries.`,
          );
        }
        stepIds.add(stepId);
        return { ...step, id: stepId };
      }),
      source,
      licence,
      createdAt: validateDateTime(raw["createdAt"], `${path}.createdAt`),
      updatedAt: validateDateTime(raw["updatedAt"], `${path}.updatedAt`),
    });
  });

  return { recipes };
}

/**
 * A stored timestamp, validated on the way IN from an archive. `validateNow`
 * reads a caller's clock; this reads a row's, and both mean „an ISO-8601
 * date-time" — one function so an import cannot accept a shape a live write
 * would refuse.
 */
function validateDateTime(value: unknown, field: string): string {
  if (typeof value !== "string" || !isDateTime(value)) {
    throw new RecipeValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}
