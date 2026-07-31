import type Database from "better-sqlite3-multiple-ciphers";
import {
  FinBudgetNotFoundError,
  FinBudgetValidationError,
  FinCategoryNotFoundError,
  FinCategoryValidationError,
} from "../errors.js";
import { uuidv7 } from "../ids.js";
import { FIN_COLLATOR, isCurrencyCode, isDateTime, isMinorUnits } from "./money.js";

type DatabaseHandle = Database.Database;

/** Closed category-kind domain (migration 051's CHECK): money coming in, or money going out. */
export type FinCategoryKind = "income" | "expense";

/** The kinds in the order the UI offers them. */
export const FIN_CATEGORY_KINDS: readonly FinCategoryKind[] = ["income", "expense"];

export const MAX_FIN_CATEGORY_NAME_LENGTH = 60;

/**
 * A category as the store returns it. FLAT by construction — there is no
 * `parentId` to read and none to write (ADR-072's argument for note categories,
 * applied unchanged: a category tree IS a folder tree, and one tree per app is
 * enough).
 */
export interface FinCategory {
  id: string;
  profileId: string;
  name: string;
  kind: FinCategoryKind;
  createdAt: string;
  updatedAt: string;
}

/** A category's monthly allowance in ONE currency. Per currency because there is no FX to fold two of them with. */
export interface FinBudget {
  id: string;
  profileId: string;
  categoryId: string;
  currency: string;
  /** Minor units, INTEGER, always positive — a limit of nothing is `clearBudget`, not a zero. */
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SetFinBudgetInput {
  categoryId: string;
  currency: string;
  amount: number;
}

interface FinCategoryRow {
  id: string;
  profile_id: string;
  name: string;
  kind: FinCategoryKind;
  created_at: string;
  updated_at: string;
}

interface FinBudgetRow {
  id: string;
  profile_id: string;
  category_id: string;
  currency: string;
  amount: number;
  created_at: string;
  updated_at: string;
}

const CATEGORY_COLUMNS = "id, profile_id, name, kind, created_at, updated_at";
const BUDGET_COLUMNS = "id, profile_id, category_id, currency, amount, created_at, updated_at";

/**
 * Finance categories and their budgets for a single profile, over prepared,
 * parameterized statements (SEC-API-03). One class for the two tables because a
 * budget IS a category's monthly amount — it has no identity of its own, it
 * cascades with its category, and splitting them would put the "is this category
 * an expense category?" question on the wrong side of a store boundary.
 *
 * **Flat, with a kind.** Uniqueness is `(profile_id, kind, name)`, which is
 * `note_categories`' `(profile_id, name)` plus the one column that genuinely
 * differs: „Pokloni" is an ordinary EXPENSE category (gifts given) and an
 * equally ordinary INCOME one (gifts received), the two never share a picker,
 * and collapsing them would refuse a distinction real ledgers make. Comparison
 * is exact and BINARY, exactly as the tag and note-category stores compare:
 * „Hrana" and „hrana" ARE two categories here, because that is what the index
 * says and what the foreign-import absorb rule then has to agree with.
 *
 * **A budget is a spending LIMIT, so it may only be set on an EXPENSE
 * category.** An income category would want a TARGET, which compares in the
 * opposite direction — falling short of a target is bad, falling short of a
 * budget is good — and one row meaning both would leave every reader asking
 * which way is good and answering it with a join. The refusal is named
 * (`FinBudgetValidationError`); if income targets are wanted later they get
 * their own row shape, decided deliberately rather than inherited by accident.
 */
export class FinCategoryStore {
  private readonly insertCategory: Database.Statement;
  private readonly selectCategories: Database.Statement;
  private readonly selectCategoryById: Database.Statement;
  private readonly selectNameCollision: Database.Statement;
  private readonly updateCategoryFields: Database.Statement;
  private readonly deleteCategoryRow: Database.Statement;
  private readonly insertBudget: Database.Statement;
  private readonly selectBudgets: Database.Statement;
  private readonly selectBudgetFor: Database.Statement;
  private readonly updateBudgetAmount: Database.Statement;
  private readonly deleteBudgetRow: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertCategory = db.prepare(
      `INSERT INTO fin_categories (id, profile_id, name, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.selectCategories = db.prepare(
      `SELECT ${CATEGORY_COLUMNS} FROM fin_categories WHERE profile_id = ?`,
    );
    this.selectCategoryById = db.prepare(
      `SELECT ${CATEGORY_COLUMNS} FROM fin_categories WHERE id = ? AND profile_id = ?`,
    );
    this.selectNameCollision = db.prepare(
      `SELECT id FROM fin_categories
       WHERE profile_id = ? AND kind = ? AND name = ? AND id <> ?`,
    );
    this.updateCategoryFields = db.prepare(
      `UPDATE fin_categories SET name = ?, updated_at = ? WHERE id = ? AND profile_id = ?`,
    );
    this.deleteCategoryRow = db.prepare(
      `DELETE FROM fin_categories WHERE id = ? AND profile_id = ?`,
    );
    this.insertBudget = db.prepare(
      `INSERT INTO fin_budgets
         (id, profile_id, category_id, currency, amount, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectBudgets = db.prepare(
      `SELECT ${BUDGET_COLUMNS} FROM fin_budgets WHERE profile_id = ?`,
    );
    this.selectBudgetFor = db.prepare(
      `SELECT ${BUDGET_COLUMNS} FROM fin_budgets
       WHERE profile_id = ? AND category_id = ? AND currency = ?`,
    );
    this.updateBudgetAmount = db.prepare(
      `UPDATE fin_budgets SET amount = ?, updated_at = ? WHERE id = ? AND profile_id = ?`,
    );
    this.deleteBudgetRow = db.prepare(
      `DELETE FROM fin_budgets WHERE profile_id = ? AND category_id = ? AND currency = ?`,
    );
  }

  /** This profile's categories, sr-Latn alphabetical by name. Both kinds together — the caller's picker filters to the one it needs. */
  list(): FinCategory[] {
    const rows = this.selectCategories.all(this.profileId) as FinCategoryRow[];
    return rows
      .map(toFinCategory)
      .sort((a, b) => FIN_COLLATOR.compare(a.name, b.name) || a.id.localeCompare(b.id));
  }

  /**
   * Creates a category, trimming its name. REFUSES a name this profile already
   * holds UNDER THE SAME KIND, rather than returning the existing row the way
   * `NoteOrgStore.createTag` does: a category is only ever made from an explicit
   * „Nova kategorija" form, where silently handing back somebody else's row
   * would show the user no new row and no error, which reads as a bug.
   */
  create(input: { name: string; kind: FinCategoryKind }, now: string): FinCategory {
    const validNow = validateNow(now);
    const name = validateName(input.name);
    const kind = validateKind(input.kind);
    this.requireNameFree(name, kind, "");

    const id = uuidv7();
    this.insertCategory.run(id, this.profileId, name, kind, validNow, validNow);
    return { id, profileId: this.profileId, name, kind, createdAt: validNow, updatedAt: validNow };
  }

  /**
   * Renames a category; renaming to its own current name is a no-op, not a
   * collision. The KIND is deliberately not patchable: flipping „Plata" from
   * income to expense would silently re-classify every transaction ever filed
   * under it, and the honest way to say that is a new category the user moves
   * things to.
   */
  rename(id: string, name: string, now: string): FinCategory {
    const validNow = validateNow(now);
    const trimmed = validateName(name);
    const current = this.requireCategory(id);
    this.requireNameFree(trimmed, current.kind, id);

    this.updateCategoryFields.run(trimmed, validNow, id, this.profileId);
    return { ...current, name: trimmed, updatedAt: validNow };
  }

  /**
   * Deletes a category. Its transactions are NOT deleted — migration 051's
   * `ON DELETE SET NULL` leaves each of them standing and uncategorized, which
   * is the whole of what "this label no longer exists" should mean. Its budgets
   * DO go, by CASCADE: an allowance for a category that is gone is nothing.
   */
  delete(id: string): void {
    this.requireCategory(id);
    this.deleteCategoryRow.run(id, this.profileId);
  }

  /** This profile's budgets, ordered by currency then by the category's own name. */
  listBudgets(): FinBudget[] {
    const rows = this.selectBudgets.all(this.profileId) as FinBudgetRow[];
    const nameOf = new Map(this.list().map((category) => [category.id, category.name]));
    return rows
      .map(toFinBudget)
      .sort(
        (a, b) =>
          a.currency.localeCompare(b.currency) ||
          FIN_COLLATOR.compare(nameOf.get(a.categoryId) ?? "", nameOf.get(b.categoryId) ?? "") ||
          a.id.localeCompare(b.id),
      );
  }

  /**
   * Sets (or raises/lowers) one category's allowance in one currency. An
   * existing allowance for the same `(category, currency)` keeps its id and
   * `createdAt` and takes the new amount — a second row for the same pair is
   * what migration 051's UNIQUE index exists to make impossible, and re-setting
   * a limit is not a new limit.
   */
  setBudget(input: SetFinBudgetInput, now: string): FinBudget {
    const validNow = validateNow(now);
    const currency = validateBudgetCurrency(input.currency);
    const amount = validateBudgetAmount(input.amount);
    const category = this.requireCategory(input.categoryId);

    if (category.kind !== "expense") {
      throw new FinBudgetValidationError(
        `A budget is a spending limit, so it can only be set on an expense category; ` +
          `"${category.name}" is an income category. An income target compares in the ` +
          `opposite direction and would need its own shape.`,
      );
    }

    const existing = this.selectBudgetFor.get(this.profileId, category.id, currency) as
      | FinBudgetRow
      | undefined;
    if (existing) {
      this.updateBudgetAmount.run(amount, validNow, existing.id, this.profileId);
      return { ...toFinBudget(existing), amount, updatedAt: validNow };
    }

    const id = uuidv7();
    this.insertBudget.run(
      id, this.profileId, category.id, currency, amount, validNow, validNow,
    );
    return {
      id, profileId: this.profileId, categoryId: category.id, currency, amount,
      createdAt: validNow, updatedAt: validNow,
    };
  }

  /** Clears one category's allowance in ONE currency, leaving any allowance it has in another currency standing. */
  clearBudget(categoryId: string, currency: string): void {
    const validCurrency = validateBudgetCurrency(currency);
    const category = this.requireCategory(categoryId);
    const { changes } = this.deleteBudgetRow.run(this.profileId, category.id, validCurrency);
    if (changes === 0) {
      throw new FinBudgetNotFoundError(
        `No ${validCurrency} budget on category "${categoryId}" in this profile.`,
      );
    }
  }

  /** Reads a category in this profile or throws — the gate every category reference goes through. */
  private requireCategory(id: string): FinCategory {
    const row = this.selectCategoryById.get(id, this.profileId) as FinCategoryRow | undefined;
    if (!row) {
      throw new FinCategoryNotFoundError(`No category "${id}" in this profile.`);
    }
    return toFinCategory(row);
  }

  /** The `(profile_id, kind, name)` uniqueness, checked first so a collision is a named domain error rather than a raw driver error. */
  private requireNameFree(name: string, kind: FinCategoryKind, exceptId: string): void {
    const collision = this.selectNameCollision.get(this.profileId, kind, name, exceptId);
    if (collision) {
      throw new FinCategoryValidationError(
        `A ${kind} category named "${name}" already exists in this profile.`,
      );
    }
  }
}

function toFinCategory(row: FinCategoryRow): FinCategory {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    kind: row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFinBudget(row: FinBudgetRow): FinBudget {
  return {
    id: row.id,
    profileId: row.profile_id,
    categoryId: row.category_id,
    currency: row.currency,
    amount: row.amount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FIN_CATEGORY_NAME_LENGTH) {
    throw new FinCategoryValidationError(
      `"name" must be 1-${MAX_FIN_CATEGORY_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateKind(value: FinCategoryKind): FinCategoryKind {
  if (!(FIN_CATEGORY_KINDS as readonly string[]).includes(value)) {
    throw new FinCategoryValidationError(`"${value}" is not a known category kind.`);
  }
  return value;
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new FinCategoryValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}

function validateBudgetCurrency(value: string): string {
  if (!isCurrencyCode(value)) {
    throw new FinBudgetValidationError(
      `"currency" must be a three-letter upper-case ISO-4217 code (got "${value}").`,
    );
  }
  return value;
}

function validateBudgetAmount(value: number): number {
  if (!isMinorUnits(value) || value <= 0) {
    throw new FinBudgetValidationError(
      `"amount" must be a positive safe INTEGER of minor units — money is never a float.`,
    );
  }
  return value;
}
