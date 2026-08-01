import type Database from "better-sqlite3-multiple-ciphers";
import { macrosFor, parseFoodRef, sumMacros } from "@nexus/core";
import type { FoodMacros } from "@nexus/core";
import { FitMealItemNotFoundError, FitMealValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { isBareDate, isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

/**
 * The five slots a day is eaten in, in the order a day happens. Closed here and
 * in migration 058's CHECK alike: the page draws one section per slot, so a
 * sixth value would be a row with nowhere to be shown.
 */
export const MEAL_SLOTS = ["dorucak", "uzina1", "rucak", "uzina2", "vecera"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const MAX_MEAL_ITEM_LABEL_LENGTH = 80;
/** A single logged portion. Ten kilograms is not a portion, and the number goes into a REAL column every total sums. */
export const MAX_MEAL_ITEM_GRAMS = 10_000;
/** The ceiling on any snapshotted per-100 g nutrient — `MAX_FIT_NUTRIENT`'s twin, restated for the snapshot's own validator. */
export const MAX_MEAL_NUTRIENT = 100_000;
/** How many days one range read spans. Two years of a food diary, which is more than any screen draws at once. */
export const MAX_MEAL_RANGE_DAYS = 732;

/**
 * One logged item: what was eaten, when, in which slot, how much of it — and
 * WHAT IT CARRIED AT THE TIME.
 *
 * **The snapshot is the row's whole point.** `per100g` is copied in when the
 * item is logged and never re-read from the food afterwards. The catalogue ships
 * inside the app and its values change between versions, and a user's own food
 * can be corrected at any moment; a log that silently rewrote yesterday's
 * calories on an update would be a lying log, and the history is the reason
 * anybody keeps one.
 *
 * `foodRef` is provenance rather than a key: `catalogue:<id>` names app-shipped
 * data that is not a table at all, `user:<uuid>` names a `fit_foods` row that may
 * be soft-deleted while this item stays true. `label` is the food's name at the
 * moment of logging, so the item reads correctly with nothing to resolve at all.
 */
export interface FitMealItem {
  id: string;
  profileId: string;
  /** The bare local day, `YYYY-MM-DD`. */
  date: string;
  slot: MealSlot;
  /** `catalogue:<id>` or `user:<uuid>` — see `parseFoodRef` in `@nexus/core`. */
  foodRef: string;
  label: string;
  grams: number;
  per100g: FoodMacros;
  createdAt: string;
  updatedAt: string;
}

/**
 * What logging one item needs. The caller resolves the food and hands over its
 * macros — this store never reads the catalogue, deliberately: `@nexus/db` must
 * not depend on app-shipped data, and the snapshot has to be taken from whatever
 * the caller actually showed the user rather than from a second lookup that
 * could disagree with it.
 */
export interface AddMealItemInput {
  date: string;
  slot: MealSlot;
  foodRef: string;
  label: string;
  grams: number;
  per100g: FoodMacros;
}

/**
 * What may be corrected after the fact: how much, and which meal it belonged to.
 * Never the food, the label or the snapshot — swapping those would be logging a
 * different thing while keeping the row's identity, and „obriši pa dodaj" says
 * that honestly.
 */
export interface UpdateMealItemFields {
  grams?: number;
  slot?: MealSlot;
}

/** One day's items, grouped into the five slots. Every slot is present; an unused one is an empty array. */
export type MealDay = Record<MealSlot, FitMealItem[]>;

/** One day's total, as `rangeTotals` reports it. */
export interface MealDayTotals {
  day: string;
  totals: FoodMacros;
}

/** An inclusive span of local days. */
export interface MealDayRange {
  from: string;
  to: string;
}

interface MealItemRow {
  id: string;
  profile_id: string;
  meal_date: string;
  slot: MealSlot;
  food_ref: string;
  label: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium_mg: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, profile_id, meal_date, slot, food_ref, label, grams, kcal, protein, carbs, fat, " +
  "fiber, sugar, sodium_mg, created_at, updated_at";

/**
 * One profile's food log (FIT slice a, migration 058), over prepared,
 * parameterized statements (SEC-API-03). Construct one per profile and reuse it;
 * every statement is scoped by `profile_id`.
 *
 * **There is no meal ROW.** A meal is a `(date, slot)` grouping of the items
 * below — see migration 058 for why a container table would buy nothing and cost
 * an empty-meal state nobody can see or clean up. `listDay` does the grouping,
 * which is the only place it is needed.
 *
 * **This store never reads the catalogue.** `@nexus/core` ships the food data as
 * JSON and `@nexus/db` deliberately does not import it: the database layer must
 * not depend on app-shipped content, or a catalogue edit would become a data
 * migration. So `addItem` takes the macros as an argument and writes them down.
 * That is also what makes the snapshot honest — the numbers recorded are the
 * ones the caller had in hand and showed the user, not the answer a second
 * lookup would give a moment later.
 *
 * **The arithmetic is `@nexus/core`'s, not this file's.** `macrosFor` and
 * `sumMacros` scale and add; nothing here multiplies by `grams / 100` on its own.
 * A SQL `SUM(grams * kcal / 100)` would be faster and would be a SECOND
 * definition of the same sentence — and the day the two disagreed, the total
 * under a list would stop matching the rows in it.
 */
export class FitMealStore {
  private readonly insert: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly updateFields: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;
  private readonly selectDay: Database.Statement;
  private readonly selectRange: Database.Statement;
  private readonly selectAll: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO fit_meal_items
         (id, profile_id, meal_date, slot, food_ref, label, grams,
          kcal, protein, carbs, fat, fiber, sugar, sodium_mg,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM fit_meal_items
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // Only `grams` and `slot`: the food, its label and its snapshot are what the
    // row IS, and an edit that changed them would be a different meal wearing
    // this one's id.
    this.updateFields = db.prepare(
      `UPDATE fit_meal_items SET grams = ?, slot = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE fit_meal_items SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE fit_meal_items SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    // Ordered by `created_at`, then `id` — migration 058's own index, and NOT by
    // `id` alone. `uuidv7` carries a MILLISECOND timestamp with CSPRNG bytes
    // below it (`ids.ts`), so two items logged inside the same millisecond sort
    // randomly against each other; `created_at` is the instant the caller
    // actually stamped, and `id` is what makes the order TOTAL when two rows
    // share one.
    this.selectDay = db.prepare(
      `SELECT ${COLUMNS} FROM fit_meal_items
        WHERE profile_id = ? AND meal_date = ? AND deleted_at IS NULL
        ORDER BY created_at, id`,
    );
    this.selectRange = db.prepare(
      `SELECT ${COLUMNS} FROM fit_meal_items
        WHERE profile_id = ? AND meal_date >= ? AND meal_date <= ? AND deleted_at IS NULL
        ORDER BY meal_date, created_at, id`,
    );
    // Deliberately UNBOUNDED by day, unlike `selectRange` — see `listAll`.
    this.selectAll = db.prepare(
      `SELECT ${COLUMNS} FROM fit_meal_items
        WHERE profile_id = ? AND deleted_at IS NULL
        ORDER BY meal_date, created_at, id`,
    );
  }

  /** Logs one item and returns the stored row, snapshot included. */
  addItem(input: AddMealItemInput, now: string): FitMealItem {
    const validNow = validateNow(now);
    const date = validateDay(input.date, "date");
    const slot = validateSlot(input.slot);
    const foodRef = validateFoodRef(input.foodRef);
    const label = validateLabel(input.label);
    const grams = validateGrams(input.grams);
    const per100g = validateSnapshot(input.per100g);
    const id = uuidv7();

    this.insert.run(
      id, this.profileId, date, slot, foodRef, label, grams,
      per100g.kcal, per100g.protein, per100g.carbs, per100g.fat,
      per100g.fiber, per100g.sugar, per100g.sodiumMg,
      validNow, validNow,
    );

    return {
      id, profileId: this.profileId, date, slot, foodRef, label, grams, per100g,
      createdAt: validNow, updatedAt: validNow,
    };
  }

  /**
   * Corrects how much was eaten, or which meal it belonged to. The SNAPSHOT is
   * untouched — re-reading the food here would silently restate the row under
   * today's numbers, which is the exact failure the snapshot exists to prevent.
   */
  updateItem(id: string, fields: UpdateMealItemFields, now: string): FitMealItem {
    const validNow = validateNow(now);
    const current = this.requireItem(id);
    const grams = fields.grams === undefined ? current.grams : validateGrams(fields.grams);
    const slot = fields.slot === undefined ? current.slot : validateSlot(fields.slot);

    this.updateFields.run(grams, slot, validNow, id, this.profileId);
    return { ...current, grams, slot, updatedAt: validNow };
  }

  /** Soft-deletes a logged item (reversible via `restoreItem`) — the undo every other list in this app has. */
  removeItem(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new FitMealItemNotFoundError(`No live meal item "${id}" to remove in this profile.`);
    }
  }

  /** Puts a removed item back, exactly as it was logged — snapshot, day and slot included. */
  restoreItem(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new FitMealItemNotFoundError(`No removed meal item "${id}" to restore in this profile.`);
    }
  }

  /**
   * One day's items, grouped into the five slots — the page's own shape, and the
   * only place the „a meal is a grouping, not a row" decision is spent. Every
   * slot is present with an empty array when nothing was logged in it, so the
   * caller draws five sections without asking which exist.
   */
  listDay(day: string): MealDay {
    const validDay = validateDay(day, "day");
    const rows = this.selectDay.all(this.profileId, validDay) as MealItemRow[];
    const grouped = emptyDay();
    for (const row of rows) {
      grouped[row.slot].push(toItem(row));
    }
    return grouped;
  }

  /** Everything eaten on one day, summed. Zero of everything for a day with nothing logged, which is what such a day carried. */
  dayTotals(day: string): FoodMacros {
    const validDay = validateDay(day, "day");
    const rows = this.selectDay.all(this.profileId, validDay) as MealItemRow[];
    return totalOf(rows);
  }

  /**
   * One total per day across an inclusive span, oldest first — what a week strip
   * or a trend chart reads.
   *
   * Days with nothing logged are ABSENT rather than reported as zero. „Nisam
   * jeo" and „nisam upisao" are different facts and this store knows only the
   * second; a zero row would be the app asserting the first. A caller drawing a
   * continuous axis fills the gaps itself, where it also knows which of the two
   * it wants to show.
   */
  rangeTotals(range: MealDayRange): MealDayTotals[] {
    const { from, to } = validateRange(range);
    const rows = this.selectRange.all(this.profileId, from, to) as MealItemRow[];

    const byDay = new Map<string, MealItemRow[]>();
    for (const row of rows) {
      const bucket = byDay.get(row.meal_date);
      if (bucket === undefined) byDay.set(row.meal_date, [row]);
      else bucket.push(row);
    }
    // The query already ordered by day, and a Map keeps insertion order — so
    // this is the SQL order rather than a second sort that could disagree.
    return [...byDay].map(([day, dayRows]) => ({ day, totals: totalOf(dayRows) }));
  }

  /**
   * EVERY live item this profile has, oldest day first — what the EXPORT reads
   * (`gatherProfileData`), and the one read here with no day bound at all.
   *
   * Deliberately not `rangeTotals`' widest window: that read is capped at
   * `MAX_MEAL_RANGE_DAYS` because a screen asking for a decade of totals is a
   * screen with a bug, while „every row this profile has" is exactly what an
   * archive must carry and refusing it would silently truncate somebody's
   * history. A cap here would be the export deciding how far back a backup goes.
   */
  listAll(): FitMealItem[] {
    const rows = this.selectAll.all(this.profileId) as MealItemRow[];
    return rows.map((row) => toItem(row));
  }

  private requireItem(id: string): FitMealItem {
    const row = this.selectActiveById.get(id, this.profileId) as MealItemRow | undefined;
    if (!row) {
      throw new FitMealItemNotFoundError(`No live meal item "${id}" in this profile.`);
    }
    return toItem(row);
  }
}

/** The five slots, each with its own array. A fresh object every call — callers push into it. */
function emptyDay(): MealDay {
  return { dorucak: [], uzina1: [], rucak: [], uzina2: [], vecera: [] };
}

/** Scales each row by its own grams and adds them up — `@nexus/core`'s arithmetic, never a second copy of it. */
function totalOf(rows: readonly MealItemRow[]): FoodMacros {
  return sumMacros(rows.map((row) => macrosFor(snapshotOf(row), row.grams)));
}

function snapshotOf(row: MealItemRow): FoodMacros {
  return {
    kcal: row.kcal,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    fiber: row.fiber,
    sugar: row.sugar,
    sodiumMg: row.sodium_mg,
  };
}

function toItem(row: MealItemRow): FitMealItem {
  return {
    id: row.id,
    profileId: row.profile_id,
    date: row.meal_date,
    slot: row.slot,
    foodRef: row.food_ref,
    label: row.label,
    grams: row.grams,
    per100g: snapshotOf(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateSlot(value: MealSlot): MealSlot {
  if (!(MEAL_SLOTS as readonly string[]).includes(value)) {
    throw new FitMealValidationError(`"slot" must be one of the five meal slots.`);
  }
  return value;
}

/** The grammar is `@nexus/core`'s (`parseFoodRef`) — one definition shared with the interchange reader, never a second regex here. */
function validateFoodRef(value: string): string {
  if (typeof value !== "string" || parseFoodRef(value) === null) {
    throw new FitMealValidationError(
      `"foodRef" must be "catalogue:<id>" or "user:<id>".`,
    );
  }
  return value;
}

function validateLabel(value: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_MEAL_ITEM_LABEL_LENGTH) {
    throw new FitMealValidationError(
      `"label" must be 1-${MAX_MEAL_ITEM_LABEL_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/** Strictly positive: an item weighing nothing is the absence of an item, which is what `removeItem` says. */
function validateGrams(value: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_MEAL_ITEM_GRAMS
  ) {
    throw new FitMealValidationError(
      `"grams" must be a finite number above 0 and at most ${MAX_MEAL_ITEM_GRAMS}.`,
    );
  }
  return value;
}

function validateSnapshot(value: FoodMacros): FoodMacros {
  const read = (field: keyof FoodMacros): number => {
    const raw = value?.[field];
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > MAX_MEAL_NUTRIENT) {
      throw new FitMealValidationError(
        `"per100g.${field}" must be a finite number between 0 and ${MAX_MEAL_NUTRIENT}.`,
      );
    }
    return raw;
  };
  return {
    kcal: read("kcal"),
    protein: read("protein"),
    carbs: read("carbs"),
    fat: read("fat"),
    fiber: read("fiber"),
    sugar: read("sugar"),
    sodiumMg: read("sodiumMg"),
  };
}

function validateDay(value: string, field: string): string {
  if (!isBareDate(value)) {
    throw new FitMealValidationError(`"${field}" must be a real bare date (YYYY-MM-DD).`);
  }
  return value;
}

function validateRange(range: MealDayRange): MealDayRange {
  const from = validateDay(range.from, "from");
  const to = validateDay(range.to, "to");
  if (from > to) {
    throw new FitMealValidationError(`"from" must not be after "to".`);
  }
  if (spanDays(from, to) > MAX_MEAL_RANGE_DAYS) {
    throw new FitMealValidationError(
      `A range must not span more than ${MAX_MEAL_RANGE_DAYS} days.`,
    );
  }
  return { from, to };
}

/** Inclusive day count between two bare dates, read as UTC midnights so no local offset can shift the answer. */
function spanDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new FitMealValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}
