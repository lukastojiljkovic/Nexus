import type Database from "better-sqlite3-multiple-ciphers";
import {
  FinAccountNotFoundError,
  FinCategoryNotFoundError,
  FinTransactionNotFoundError,
  FinTransactionValidationError,
} from "../errors.js";
import { uuidv7 } from "../ids.js";
import {
  FIN_COLLATOR,
  isBareDate,
  isDateTime,
  isMinorUnits,
  type FinCurrencyTotal,
} from "./money.js";
import type { FinCategoryKind } from "./categoryStore.js";

type DatabaseHandle = Database.Database;

export const MAX_FIN_PAYEE_LENGTH = 120;
export const MAX_FIN_NOTE_LENGTH = 500;

/**
 * One movement of money. A TRANSFER between the user's own accounts is this
 * SAME row with `counterAccountId` filled — never a pair of rows: `amount` is
 * signed from `accountId`'s point of view, so the counter account receives
 * `-amount`, and the two halves of a transfer are one fact that cannot fall out
 * of step with itself.
 */
export interface FinTransaction {
  id: string;
  profileId: string;
  accountId: string;
  /** The other side of a transfer, or null for an ordinary income/expense row. */
  counterAccountId: string | null;
  /** Always null on a transfer (migration 051's CHECK): a transfer is neither income nor expense. */
  categoryId: string | null;
  /** The LOCAL day, as a bare `YYYY-MM-DD` — the way this codebase already stores bare dates. */
  date: string;
  /** Minor units, INTEGER, never zero. Negative leaves `accountId`, positive arrives in it. */
  amount: number;
  payee: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFinTransactionInput {
  accountId: string;
  counterAccountId?: string | null;
  categoryId?: string | null;
  date: string;
  amount: number;
  payee?: string | null;
  note?: string | null;
}

/** A partial patch. An omitted key is left untouched; an explicit `null` clears a nullable field. */
export interface UpdateFinTransactionFields {
  accountId?: string;
  counterAccountId?: string | null;
  categoryId?: string | null;
  date?: string;
  amount?: number;
  payee?: string | null;
  note?: string | null;
}

/** An inclusive span of local days — the shape every FIN report is asked over. */
export interface FinPeriod {
  from: string;
  to: string;
}

/**
 * What one category cost over a period, in ONE currency. Per currency because
 * an account carries the currency and there is no FX: „Hrana" spent from an RSD
 * account and from a EUR account are two lines, never one invented sum.
 */
export interface FinCategorySpend {
  /** Null is the uncategorized line — real spending the user has not labelled, which must be reported rather than dropped. */
  categoryId: string | null;
  currency: string;
  /** Minor units spent, POSITIVE for ordinary spending; a period whose refunds outweigh its purchases reports a negative line and says so. */
  minorUnits: number;
}

interface FinTransactionRow {
  id: string;
  profile_id: string;
  account_id: string;
  counter_account_id: string | null;
  category_id: string | null;
  tx_date: string;
  amount: number;
  payee: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface SpendRow {
  category_id: string | null;
  currency: string;
  minor_units: number;
}

interface IncomeRow {
  currency: string;
  minor_units: number;
}

const COLUMNS =
  "id, profile_id, account_id, counter_account_id, category_id, tx_date, amount, " +
  "payee, note, created_at, updated_at";

/**
 * Finance transactions for a single profile, over prepared, parameterized
 * statements (SEC-API-03). Construct one per profile and reuse it. Every
 * statement is scoped by `profile_id`, and every account or category a row names
 * is resolved THROUGH that scope — which is what stops a transaction from
 * pointing at another profile's account.
 *
 * **A transfer is one row, excluded from income/expense aggregates by
 * construction.** `spendByCategory` and `incomeByCurrency` read `fin_flows`
 * (migration 051), a view of the live, non-transfer rows that does not project
 * `counter_account_id` at all — so this store cannot filter transfers wrongly,
 * cannot forget to, and cannot even ask. The raw table is read only by CRUD and
 * by the balance derivation (`FinAccountStore`), which is the one read that
 * genuinely wants both sides.
 *
 * **Money is an INTEGER in minor units**, here as everywhere: `amount` is
 * validated as a non-zero safe integer, every aggregate is an integer sum of
 * integers, and no decimal is produced anywhere in this file. Formatting one is
 * the display edge's job.
 *
 * `now` is supplied by the caller and validated here — main stamps the clock,
 * the renderer never does.
 */
export class FinTransactionStore {
  private readonly insert: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly updateFields: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;
  private readonly selectAccount: Database.Statement;
  private readonly selectCategory: Database.Statement;
  private readonly selectSpend: Database.Statement;
  private readonly selectIncome: Database.Statement;
  /** Category names, for ordering `spendByCategory`'s answer the way a Serbian reader expects. */
  private readonly selectCategoryNames: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO fin_transactions
         (id, profile_id, account_id, counter_account_id, category_id, tx_date, amount,
          payee, note, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM fin_transactions
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY tx_date DESC, id DESC`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM fin_transactions
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateFields = db.prepare(
      `UPDATE fin_transactions
         SET account_id = ?, counter_account_id = ?, category_id = ?, tx_date = ?,
             amount = ?, payee = ?, note = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE fin_transactions SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE fin_transactions SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.selectAccount = db.prepare(
      `SELECT id, name, currency FROM fin_accounts
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectCategory = db.prepare(
      `SELECT id, kind FROM fin_categories WHERE id = ? AND profile_id = ?`,
    );
    // Over the VIEW, never the table (see the class comment). The account join
    // is what supplies the currency — money's unit lives on the account, so a
    // spend line without it would be a number with no meaning.
    this.selectSpend = db.prepare(
      `SELECT f.category_id AS category_id, a.currency AS currency,
              -SUM(f.amount) AS minor_units
         FROM fin_flows f
         JOIN fin_accounts a ON a.id = f.account_id
         LEFT JOIN fin_categories c ON c.id = f.category_id
        WHERE f.profile_id = ? AND f.tx_date >= ? AND f.tx_date <= ?
          AND (f.category_id IS NULL OR c.kind = 'expense')
        GROUP BY f.category_id, a.currency`,
    );
    // The mirror, over the same view: income categories, `+SUM`. The join to
    // `fin_categories` is INNER on purpose — a row with no category belongs to
    // the spending side, which `spendByCategory` already reports as the
    // uncategorized line. Between them the two reads PARTITION the view: every
    // live non-transfer row is counted exactly once, by exactly one of them.
    this.selectIncome = db.prepare(
      `SELECT a.currency AS currency, SUM(f.amount) AS minor_units
         FROM fin_flows f
         JOIN fin_accounts a ON a.id = f.account_id
         JOIN fin_categories c ON c.id = f.category_id
        WHERE f.profile_id = ? AND f.tx_date >= ? AND f.tx_date <= ?
          AND c.kind = 'income'
        GROUP BY a.currency`,
    );
    this.selectCategoryNames = db.prepare(
      `SELECT id, name FROM fin_categories WHERE profile_id = ?`,
    );
  }

  /** This profile's live transactions, newest day first (soft-deleted excluded). */
  listActive(): FinTransaction[] {
    const rows = this.selectActive.all(this.profileId) as FinTransactionRow[];
    return rows.map(toFinTransaction);
  }

  /** Inserts a transaction — or a transfer, when `counterAccountId` is given — and returns the stored row. */
  create(input: CreateFinTransactionInput, now: string): FinTransaction {
    const validNow = validateNow(now);
    const resolved = this.resolve({
      accountId: input.accountId,
      counterAccountId: input.counterAccountId ?? null,
      categoryId: input.categoryId ?? null,
      date: input.date,
      amount: input.amount,
      payee: input.payee ?? null,
      note: input.note ?? null,
    });
    const id = uuidv7();

    this.insert.run(
      id, this.profileId, resolved.accountId, resolved.counterAccountId, resolved.categoryId,
      resolved.date, resolved.amount, resolved.payee, resolved.note, validNow, validNow,
    );

    return { id, profileId: this.profileId, ...resolved, createdAt: validNow, updatedAt: validNow };
  }

  /**
   * Applies a partial patch to a live transaction. The merged row is re-checked
   * WHOLE rather than field by field, because every transfer rule is about a
   * combination: a patch that only adds `counterAccountId` can still produce a
   * same-account transfer, a cross-currency one, or a categorized one, and none
   * of those is visible from the patched field alone.
   */
  update(id: string, fields: UpdateFinTransactionFields, now: string): FinTransaction {
    const validNow = validateNow(now);
    const current = this.requireActive(id);

    const resolved = this.resolve({
      accountId: fields.accountId ?? current.accountId,
      counterAccountId:
        "counterAccountId" in fields
          ? (fields.counterAccountId ?? null)
          : current.counterAccountId,
      categoryId: "categoryId" in fields ? (fields.categoryId ?? null) : current.categoryId,
      date: fields.date ?? current.date,
      amount: fields.amount ?? current.amount,
      payee: "payee" in fields ? (fields.payee ?? null) : current.payee,
      note: "note" in fields ? (fields.note ?? null) : current.note,
    });

    this.updateFields.run(
      resolved.accountId, resolved.counterAccountId, resolved.categoryId, resolved.date,
      resolved.amount, resolved.payee, resolved.note, validNow, id, this.profileId,
    );
    return { ...current, ...resolved, updatedAt: validNow };
  }

  /** Soft-deletes a live transaction (reversible via `restore`); the balance derivation stops counting it immediately. */
  softDelete(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new FinTransactionNotFoundError(
        `No active transaction "${id}" to delete in this profile.`,
      );
    }
  }

  /** Restores a soft-deleted transaction. */
  restore(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new FinTransactionNotFoundError(
        `No deleted transaction "${id}" to restore in this profile.`,
      );
    }
  }

  /**
   * What each EXPENSE category cost over an inclusive span of local days, per
   * currency — plus one line for the uncategorized spending, which is real money
   * and must be reported rather than dropped.
   *
   * Transfers are absent by construction (the read is over `fin_flows`), income
   * categories are out because this answers a spending question, and a REFUND
   * nets off the line it was refunded on: `minorUnits` is `-SUM(amount)`, so an
   * ordinary period is positive and one whose refunds outweighed its purchases
   * is negative and says so, rather than being clamped into a lie.
   *
   * The income side is `incomeByCurrency`, this method's exact mirror; the two
   * partition the view between them (see that method).
   */
  spendByCategory(period: FinPeriod): FinCategorySpend[] {
    const { from, to } = validatePeriod(period);

    const rows = this.selectSpend.all(this.profileId, from, to) as SpendRow[];
    const nameOf = new Map(
      (
        this.selectCategoryNames.all(this.profileId) as { id: string; name: string }[]
      ).map((row) => [row.id, row.name]),
    );
    return rows
      .map((row) => ({
        categoryId: row.category_id,
        currency: row.currency,
        minorUnits: row.minor_units,
      }))
      .sort(
        (a, b) =>
          a.currency.localeCompare(b.currency) ||
          // The uncategorized line last: it is the leftover, not a category.
          Number(a.categoryId === null) - Number(b.categoryId === null) ||
          FIN_COLLATOR.compare(
            nameOf.get(a.categoryId ?? "") ?? "",
            nameOf.get(b.categoryId ?? "") ?? "",
          ),
      );
  }

  /**
   * What ARRIVED over an inclusive span of local days, per currency — the exact
   * mirror of `spendByCategory`, and a LIST rather than a number for the reason
   * `totalsByCurrency` is one: there is no exchange rate, so a cross-currency
   * total could only be invented, and no method here can produce one.
   *
   * Transfers are absent by construction (`fin_flows` again), and only INCOME
   * categories count: a row with no category is the spending side's
   * uncategorized line, so the two reads partition the view rather than
   * overlapping on it. A clawback nets off the income it was taken from — the
   * same rule as a refund on the spending side, since the kind classifies and
   * the sign carries direction.
   *
   * Per currency and NOT per category: the month report states income as one
   * figure per currency, and a breakdown nothing draws would be a read nobody
   * calls.
   */
  incomeByCurrency(period: FinPeriod): FinCurrencyTotal[] {
    const { from, to } = validatePeriod(period);

    const rows = this.selectIncome.all(this.profileId, from, to) as IncomeRow[];
    return rows
      .map((row) => ({ currency: row.currency, minorUnits: row.minor_units }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }

  /** Reads a live transaction in this profile or throws. */
  private requireActive(id: string): FinTransaction {
    const row = this.selectActiveById.get(id, this.profileId) as FinTransactionRow | undefined;
    if (!row) {
      throw new FinTransactionNotFoundError(`No active transaction "${id}" in this profile.`);
    }
    return toFinTransaction(row);
  }

  /**
   * Validates and resolves a whole transaction's fields — the ONE place every
   * refusal lives, so `create` and `update` cannot drift on what a transfer is
   * allowed to be.
   */
  private resolve(fields: {
    accountId: string;
    counterAccountId: string | null;
    categoryId: string | null;
    date: string;
    amount: number;
    payee: string | null;
    note: string | null;
  }): Omit<FinTransaction, "id" | "profileId" | "createdAt" | "updatedAt"> {
    const date = validateDate(fields.date);
    const amount = validateAmount(fields.amount);
    const payee = validateOptionalText(fields.payee, "payee", MAX_FIN_PAYEE_LENGTH);
    const note = validateOptionalText(fields.note, "note", MAX_FIN_NOTE_LENGTH);
    const account = this.requireAccount(fields.accountId);

    if (fields.counterAccountId === null) {
      return {
        accountId: account.id,
        counterAccountId: null,
        categoryId: fields.categoryId === null ? null : this.requireCategory(fields.categoryId).id,
        date, amount, payee, note,
      };
    }

    // --- The three transfer refusals ------------------------------------
    const counter = this.requireAccount(fields.counterAccountId);
    if (counter.id === account.id) {
      throw new FinTransactionValidationError(
        `A transfer's two sides must be different accounts; "${account.name}" is both.`,
      );
    }
    if (counter.currency !== account.currency) {
      throw new FinTransactionValidationError(
        `A transfer cannot cross currencies: "${account.name}" is in ${account.currency} and ` +
          `"${counter.name}" is in ${counter.currency}. Nexus holds no exchange rate — it has ` +
          `no honest source for one offline, and a stale invented rate would quietly falsify ` +
          `both balances. Record two ordinary transactions instead.`,
      );
    }
    if (fields.categoryId !== null) {
      throw new FinTransactionValidationError(
        `A transfer carries no category: moving money between your own accounts is neither ` +
          `income nor expense, so no category could honestly describe it.`,
      );
    }

    return {
      accountId: account.id,
      counterAccountId: counter.id,
      categoryId: null,
      date, amount, payee, note,
    };
  }

  /** Resolves an account id to a live account in THIS profile — the scope check that stops a row naming another profile's account. */
  private requireAccount(id: string): { id: string; name: string; currency: string } {
    const row = this.selectAccount.get(id, this.profileId) as
      | { id: string; name: string; currency: string }
      | undefined;
    if (!row) {
      throw new FinAccountNotFoundError(`No active account "${id}" in this profile.`);
    }
    return row;
  }

  /** Resolves a category id to a category in THIS profile, on the same terms. */
  private requireCategory(id: string): { id: string; kind: FinCategoryKind } {
    const row = this.selectCategory.get(id, this.profileId) as
      | { id: string; kind: FinCategoryKind }
      | undefined;
    if (!row) {
      throw new FinCategoryNotFoundError(`No category "${id}" in this profile.`);
    }
    return row;
  }
}

function toFinTransaction(row: FinTransactionRow): FinTransaction {
  return {
    id: row.id,
    profileId: row.profile_id,
    accountId: row.account_id,
    counterAccountId: row.counter_account_id,
    categoryId: row.category_id,
    date: row.tx_date,
    amount: row.amount,
    payee: row.payee,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateDate(value: string): string {
  if (!isBareDate(value)) {
    throw new FinTransactionValidationError(`"date" must be a real bare date (YYYY-MM-DD).`);
  }
  return value;
}

/** The ONE period check both aggregates go through, so neither can drift on what a span may be. */
function validatePeriod(period: FinPeriod): FinPeriod {
  const from = validatePeriodDay(period.from, "from");
  const to = validatePeriodDay(period.to, "to");
  if (from > to) {
    throw new FinTransactionValidationError(`"from" must not be after "to".`);
  }
  return { from, to };
}

function validatePeriodDay(value: string, field: string): string {
  if (!isBareDate(value)) {
    throw new FinTransactionValidationError(`"${field}" must be a real bare date (YYYY-MM-DD).`);
  }
  return value;
}

function validateAmount(value: number): number {
  if (!isMinorUnits(value) || value === 0) {
    throw new FinTransactionValidationError(
      `"amount" must be a non-zero safe INTEGER of minor units — money is never a float.`,
    );
  }
  return value;
}

/** Trims an optional string; absent/empty/whitespace-only collapses to null, and an over-long one is refused rather than truncated. */
function validateOptionalText(
  value: string | null,
  field: string,
  maxLength: number,
): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new FinTransactionValidationError(
      `"${field}" must be at most ${maxLength} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new FinTransactionValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}
