import type Database from "better-sqlite3-multiple-ciphers";
import { FOOD_CATEGORIES, foldSearchText } from "@nexus/core";
import type { FoodCategory, FoodMacros, FoodServing } from "@nexus/core";
import { FitFoodNotFoundError, FitFoodValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

export const MAX_FIT_FOOD_NAME_LENGTH = 80;
export const MAX_FIT_FOOD_NOTES_LENGTH = 500;
/** „1 kašika", „1 kriška", „1 pakovanje" — past a dozen the list stops being a shortcut and starts being a form. */
export const MAX_FIT_FOOD_SERVINGS = 12;
export const MAX_FIT_SERVING_LABEL_LENGTH = 40;
/**
 * The ceiling on any single nutrient per 100 g. Not a semantic limit — so
 * carries 38 758 mg of sodium per 100 g and is an ordinary food — but an
 * untrusted number goes into a REAL column that every day total sums, and a
 * bound is cheaper than discovering the absence of one.
 */
export const MAX_FIT_NUTRIENT = 100_000;
/** A serving weighs something a person eats, not a sack of it. */
export const MAX_FIT_SERVING_GRAMS = 10_000;
/** Longest query this store will fold — a search box, not a document (`MAX_ATTACHMENT_QUERY_LENGTH`'s rule at this list's scale). */
export const MAX_FIT_FOOD_QUERY_LENGTH = 100;
/** How many foods one search answers with. A picker's list, not a browse surface. */
export const MAX_FIT_FOOD_RESULTS = 50;

/**
 * Serbian Latin ordering for the food list, the app's one collator spelling:
 * plain `"sr"` mis-tailors š/č/ć/ž, and SQLite's BINARY collation would put
 * „Šargarepa" after „Zob". Sorted here rather than deferred to the renderer for
 * `HabitStore`'s reason — a store that hands back an order nobody fixes is a bug
 * waiting for slice b to inherit.
 */
const FIT_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/**
 * One food the USER added. NOT a catalogue entry: the catalogue ships inside the
 * app as JSON (`@nexus/core`'s `fitness/catalogue.ts`) and is deliberately not a
 * table, so this row exists precisely for what the catalogue does not have —
 * „mamin ajvar", a local brand, a supplement.
 *
 * It carries no `source`, and that absence is the point rather than an omission.
 * A catalogue entry must cite a url anyone can re-check, because the app is
 * asserting the number; a user's own food is their claim about their own food,
 * and demanding a citation for it would be asking them to prove something to
 * their own diary.
 */
export interface FitFood {
  id: string;
  profileId: string;
  name: string;
  category: FoodCategory;
  /** What 100 g carries — the same seven numbers a catalogue entry has, in the same order. */
  per100g: FoodMacros;
  /** Household measures, or empty. Brašno is weighed; inventing „1 komad" for it would be inventing data. */
  servings: FoodServing[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFitFoodInput {
  name: string;
  category: FoodCategory;
  per100g: FoodMacros;
  servings?: readonly FoodServing[];
  notes?: string;
}

/** A partial patch. An omitted key is left untouched; `servings` and `notes` are replaced wholesale when given. */
export interface UpdateFitFoodFields {
  name?: string;
  category?: FoodCategory;
  per100g?: FoodMacros;
  servings?: readonly FoodServing[];
  notes?: string;
}

interface FoodRow {
  id: string;
  profile_id: string;
  name: string;
  category: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium_mg: number;
  servings_json: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

/** Search rows carry one extra column: whether the match was at the very start of the name. */
interface FoodSearchRow extends FoodRow {
  is_prefix: number;
}

const COLUMNS =
  "id, profile_id, name, category, kcal, protein, carbs, fat, fiber, sugar, sodium_mg, " +
  "servings_json, notes, created_at, updated_at";

/**
 * The profile's OWN foods (FIT slice a, migration 058), over prepared,
 * parameterized statements (SEC-API-03). Construct one per profile and reuse it;
 * every statement is scoped by `profile_id`.
 *
 * **This store knows nothing about the catalogue, on purpose.** The several
 * hundred foods the app ships with live as JSON in `@nexus/core` and are never
 * rows here — see migration 058's own doc for why seeding them would make app
 * data masquerade as user data. A caller that wants „every food I can log"
 * merges this list with `FOOD_CATALOGUE` itself, which is one line at the call
 * site and keeps `@nexus/db` free of any dependency on app-shipped data.
 *
 * **The catalogue's sanity gates are deliberately NOT enforced here.**
 * `validateFoodEntry` refuses an entry whose macros cannot explain its calories
 * without a written reason, and refuses `sugar > carbs` and `fiber > carbs` —
 * rules that are right for a curated dataset transcribed from USDA rows. A user
 * typing what is printed on a packet is in a different position: European labels
 * quote carbohydrate EXCLUDING fibre, so „UH 7 g, vlakna 34 g" is a correct
 * reading of a chia packet and would be refused by a rule written for
 * carbohydrate by difference. Refusing somebody's own food because the app
 * prefers a different convention would be the app arguing with the label in
 * their hand. What IS enforced is what cannot be anything but wrong: a negative
 * or non-finite number, an absurd magnitude, a blank name.
 *
 * `now` is supplied by the caller and validated here — main stamps the clock,
 * the renderer never does.
 */
export class FitFoodStore {
  private readonly insert: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly updateFields: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;
  private readonly searchActive: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO fit_foods
         (id, profile_id, name, category, kcal, protein, carbs, fat, fiber, sugar, sodium_mg,
          servings_json, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM fit_foods WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    // The one gate every mutation passes: live in THIS profile.
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM fit_foods
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateFields = db.prepare(
      `UPDATE fit_foods
         SET name = ?, category = ?, kcal = ?, protein = ?, carbs = ?, fat = ?, fiber = ?,
             sugar = ?, sodium_mg = ?, servings_json = ?, notes = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE fit_foods SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE fit_foods SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    // Filtered in SQL rather than in memory, for `AttachmentIndexStore`'s exact
    // reason: the cap has to apply to the MATCHES, and a list narrowed after the
    // LIMIT would answer with fewer foods than the profile actually has matching.
    // `nx_fold` is the same folding `foldSearchText` does on the query side
    // (`database.ts` registers it from that very function), so „djuvec" reaches
    // „Đuveč" here exactly as it does in `searchFoods`.
    //
    // The prefix/substring RANK is computed in SQL because the cut depends on it;
    // the sr-Latn order inside a rank is applied in JS below, because SQLite has
    // no Serbian collation and `ORDER BY name` here would be BINARY.
    this.searchActive = db.prepare(
      `SELECT ${COLUMNS}, (instr(nx_fold(name), ?) = 1) AS is_prefix
         FROM fit_foods
        WHERE profile_id = ? AND deleted_at IS NULL AND instr(nx_fold(name), ?) > 0
        ORDER BY is_prefix DESC, id
        LIMIT ?`,
    );
  }

  /** This profile's live foods, sr-Latn alphabetical. */
  list(): FitFood[] {
    const rows = this.selectActive.all(this.profileId) as FoodRow[];
    return rows.map((row) => toFood(row)).sort(byName);
  }

  /** One live food in this profile, or throws. */
  get(id: string): FitFood {
    return this.requireFood(id);
  }

  /**
   * The live foods whose names match `query`, prefix matches first, sr-Latn
   * within each rank. A blank query answers NOTHING rather than the whole list,
   * `searchFoods`' rule: an empty box has nothing to rank, and „the top of your
   * list" dressed up as „your best matches" is a different claim.
   */
  search(query: string, limit: number = MAX_FIT_FOOD_RESULTS): FitFood[] {
    if (query.length > MAX_FIT_FOOD_QUERY_LENGTH) {
      throw new FitFoodValidationError(
        `A query must not exceed ${MAX_FIT_FOOD_QUERY_LENGTH} characters.`,
      );
    }
    const needle = foldSearchText(query.trim());
    const cap = Math.min(Math.max(0, Math.floor(limit)), MAX_FIT_FOOD_RESULTS);
    if (needle.length === 0 || cap === 0) return [];

    const rows = this.searchActive.all(
      needle,
      this.profileId,
      needle,
      cap,
    ) as FoodSearchRow[];
    return rows
      .map((row) => ({ food: toFood(row), prefix: row.is_prefix !== 0 }))
      .sort(
        (a, b) =>
          Number(b.prefix) - Number(a.prefix) ||
          FIT_COLLATOR.compare(a.food.name, b.food.name) ||
          a.food.id.localeCompare(b.food.id),
      )
      .map((hit) => hit.food);
  }

  /** Inserts a food and returns the stored row. */
  create(input: CreateFitFoodInput, now: string): FitFood {
    const validNow = validateNow(now);
    const resolved = resolve({
      name: input.name,
      category: input.category,
      per100g: input.per100g,
      servings: [...(input.servings ?? [])],
      notes: input.notes ?? "",
    });
    const id = uuidv7();

    this.insert.run(
      id, this.profileId, resolved.name, resolved.category,
      resolved.per100g.kcal, resolved.per100g.protein, resolved.per100g.carbs,
      resolved.per100g.fat, resolved.per100g.fiber, resolved.per100g.sugar,
      resolved.per100g.sodiumMg, JSON.stringify(resolved.servings), resolved.notes,
      validNow, validNow,
    );

    return { id, profileId: this.profileId, ...resolved, createdAt: validNow, updatedAt: validNow };
  }

  /**
   * Applies a partial patch to a live food.
   *
   * Editing a food does NOT touch anything already logged with it: every meal
   * item carries its own snapshot (migration 058), so correcting a number today
   * changes what you log from now on and leaves last Tuesday exactly as it was.
   * That is the whole reason the snapshot exists, and it is enforced by there
   * being no statement here that could reach a meal item.
   */
  update(id: string, fields: UpdateFitFoodFields, now: string): FitFood {
    const validNow = validateNow(now);
    const current = this.requireFood(id);

    const resolved = resolve({
      name: fields.name ?? current.name,
      category: fields.category ?? current.category,
      per100g: fields.per100g ?? current.per100g,
      servings: [...(fields.servings ?? current.servings)],
      notes: fields.notes ?? current.notes,
    });

    this.updateFields.run(
      resolved.name, resolved.category,
      resolved.per100g.kcal, resolved.per100g.protein, resolved.per100g.carbs,
      resolved.per100g.fat, resolved.per100g.fiber, resolved.per100g.sugar,
      resolved.per100g.sodiumMg, JSON.stringify(resolved.servings), resolved.notes,
      validNow, id, this.profileId,
    );
    return { ...current, ...resolved, updatedAt: validNow };
  }

  /**
   * Soft-deletes a live food (reversible via `restore`). Meal items that named
   * it are UNTOUCHED and stay readable: `food_ref` is text with no foreign key,
   * and the item's `label` and snapshot are what make it legible — see migration
   * 057. Deleting „mamin ajvar" is a statement about the food list, never about
   * what was eaten.
   */
  softDelete(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new FitFoodNotFoundError(`No live food "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted food. Its id is unchanged, so every meal item that named it resolves again. */
  restore(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new FitFoodNotFoundError(`No deleted food "${id}" to restore in this profile.`);
    }
  }

  private requireFood(id: string): FitFood {
    const row = this.selectActiveById.get(id, this.profileId) as FoodRow | undefined;
    if (!row) {
      throw new FitFoodNotFoundError(`No live food "${id}" in this profile.`);
    }
    return toFood(row);
  }
}

/** The food's own fields, minus the ones the row rather than the caller decides. */
type ResolvedFood = Omit<FitFood, "id" | "profileId" | "createdAt" | "updatedAt">;

function byName(a: FitFood, b: FitFood): number {
  return FIT_COLLATOR.compare(a.name, b.name) || a.id.localeCompare(b.id);
}

function toFood(row: FoodRow): FitFood {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    category: row.category as FoodCategory,
    per100g: {
      kcal: row.kcal,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
      fiber: row.fiber,
      sugar: row.sugar,
      sodiumMg: row.sodium_mg,
    },
    servings: parseStoredServings(row.servings_json, row.id),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Validates and resolves a whole food's fields — the ONE place every refusal
 * lives, so `create` and `update` cannot drift on what a food is allowed to be.
 */
function resolve(fields: ResolvedFood): ResolvedFood {
  return {
    name: validateName(fields.name),
    category: validateCategory(fields.category),
    per100g: validateMacros(fields.per100g),
    servings: validateServings(fields.servings),
    notes: validateNotes(fields.notes),
  };
}

function validateName(value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_FIT_FOOD_NAME_LENGTH) {
    throw new FitFoodValidationError(
      `"name" must be 1-${MAX_FIT_FOOD_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/** The catalogue's own closed list, checked against it rather than respelled — one set of shelves, one source. */
function validateCategory(value: FoodCategory): FoodCategory {
  if (!(FOOD_CATEGORIES as readonly string[]).includes(value)) {
    throw new FitFoodValidationError(`"category" must be one of the food categories.`);
  }
  return value;
}

function validateMacros(value: FoodMacros): FoodMacros {
  return {
    kcal: validateNutrient(value?.kcal, "per100g.kcal"),
    protein: validateNutrient(value?.protein, "per100g.protein"),
    carbs: validateNutrient(value?.carbs, "per100g.carbs"),
    fat: validateNutrient(value?.fat, "per100g.fat"),
    fiber: validateNutrient(value?.fiber, "per100g.fiber"),
    sugar: validateNutrient(value?.sugar, "per100g.sugar"),
    sodiumMg: validateNutrient(value?.sodiumMg, "per100g.sodiumMg"),
  };
}

/** Finite, non-negative, and bounded. NOT whole: 0.72 g of carbohydrate per 100 g is what a real source publishes (contrast migration 055's integers). */
function validateNutrient(value: number | undefined, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_FIT_NUTRIENT) {
    throw new FitFoodValidationError(
      `"${field}" must be a finite number between 0 and ${MAX_FIT_NUTRIENT}.`,
    );
  }
  return value;
}

function validateServings(value: readonly FoodServing[]): FoodServing[] {
  if (!Array.isArray(value)) {
    throw new FitFoodValidationError(`"servings" must be an array.`);
  }
  if (value.length > MAX_FIT_FOOD_SERVINGS) {
    throw new FitFoodValidationError(`"servings" must hold at most ${MAX_FIT_FOOD_SERVINGS} entries.`);
  }
  return value.map((serving, index) => {
    const label = typeof serving?.label === "string" ? serving.label.trim() : "";
    if (label.length === 0 || label.length > MAX_FIT_SERVING_LABEL_LENGTH) {
      throw new FitFoodValidationError(
        `"servings[${index}].label" must be 1-${MAX_FIT_SERVING_LABEL_LENGTH} characters after trimming.`,
      );
    }
    const grams = serving?.grams;
    if (
      typeof grams !== "number" ||
      !Number.isFinite(grams) ||
      grams <= 0 ||
      grams > MAX_FIT_SERVING_GRAMS
    ) {
      throw new FitFoodValidationError(
        `"servings[${index}].grams" must be a finite number above 0 and at most ${MAX_FIT_SERVING_GRAMS}.`,
      );
    }
    return { label, grams };
  });
}

function validateNotes(value: string): string {
  if (typeof value !== "string" || value.length > MAX_FIT_FOOD_NOTES_LENGTH) {
    throw new FitFoodValidationError(
      `"notes" must be a string of at most ${MAX_FIT_FOOD_NOTES_LENGTH} characters.`,
    );
  }
  return value;
}

/**
 * Reads the stored `servings_json` back. This store writes only
 * `validateServings` output, so anything that fails to parse is corruption (a
 * hand-edited file, a bad restore) rather than input to coerce — reading it as
 * an empty list would silently drop „1 kašika" from a food that has one, so it
 * throws naming the row (`HabitStore.parseStoredSchedule`'s posture).
 */
function parseStoredServings(text: string, id: string): FoodServing[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new FitFoodValidationError(`Food "${id}" carries servings that are not valid JSON.`);
  }
  if (!Array.isArray(parsed)) {
    throw new FitFoodValidationError(`Food "${id}" carries servings that are not a list.`);
  }
  return validateServings(parsed as readonly FoodServing[]);
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new FitFoodValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}
