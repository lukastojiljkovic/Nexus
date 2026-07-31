import type Database from "better-sqlite3-multiple-ciphers";
import { FinAccountNotFoundError, FinAccountValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import {
  FIN_COLLATOR,
  isCurrencyCode,
  isDateTime,
  isMinorUnits,
  type FinCurrencyTotal,
} from "./money.js";

type DatabaseHandle = Database.Database;

/** Closed account-kind domain (migration 051's CHECK): cash in hand, a current account, a card, or savings. */
export type FinAccountKind = "cash" | "current" | "card" | "savings";

/** The kinds in the order the UI offers them. */
export const FIN_ACCOUNT_KINDS: readonly FinAccountKind[] = [
  "cash",
  "current",
  "card",
  "savings",
];

export const MAX_FIN_ACCOUNT_NAME_LENGTH = 60;

/**
 * An account as the store returns it. There is deliberately NO `balance` field:
 * a balance is derived (`listBalances`), never stored — see the class comment.
 */
export interface FinAccount {
  id: string;
  profileId: string;
  name: string;
  kind: FinAccountKind;
  /** ISO-4217, upper-case. An account's currency is the ONLY place a currency is decided; nothing converts between two of them. */
  currency: string;
  /** Minor units, INTEGER. A fact about the day the account was added; it never changes as money moves. */
  openingBalance: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFinAccountInput {
  name: string;
  kind: FinAccountKind;
  currency: string;
  /** Minor units; absent means 0 — an account opened at nothing. */
  openingBalance?: number;
}

/** A partial patch of an account's own fields. An omitted key is left untouched; the soft delete has its own methods. */
export interface UpdateFinAccountFields {
  name?: string;
  kind?: FinAccountKind;
  currency?: string;
  openingBalance?: number;
  archived?: boolean;
}

/** One account's DERIVED balance: opening plus everything that moved, in that account's own currency. */
export interface FinAccountBalance {
  accountId: string;
  currency: string;
  minorUnits: number;
}

interface FinAccountRow {
  id: string;
  profile_id: string;
  name: string;
  kind: FinAccountKind;
  currency: string;
  opening_balance: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

interface BalanceRow {
  id: string;
  name: string;
  currency: string;
  minor_units: number;
}

interface TotalRow {
  currency: string;
  minor_units: number;
}

const COLUMNS =
  "id, profile_id, name, kind, currency, opening_balance, archived, created_at, updated_at";

/**
 * The SQL both derived reads are built from, and the reason a transfer can be
 * ONE row: `amount` is signed from `account_id`'s point of view, so the account
 * a transfer moves TO simply receives `-amount`. Adding the first sum and
 * subtracting the second is the whole of it — no pair of rows to keep in step,
 * and therefore no way for the two halves of a transfer to disagree.
 *
 * Soft-deleted transactions are excluded from both halves: a trashed row is not
 * money that moved.
 */
const DERIVED_BALANCE = `
  a.opening_balance
    + COALESCE((SELECT SUM(t.amount) FROM fin_transactions t
                 WHERE t.account_id = a.id AND t.deleted_at IS NULL), 0)
    - COALESCE((SELECT SUM(t.amount) FROM fin_transactions t
                 WHERE t.counter_account_id = a.id AND t.deleted_at IS NULL), 0)
`;

/**
 * Finance accounts for a single profile, over prepared, parameterized statements
 * (SEC-API-03; every value is bound, never interpolated). Construct one per
 * profile and reuse it. Inputs are revalidated here because the renderer is
 * untrusted (SEC-EL-02), and every statement is scoped by `profile_id`, so one
 * profile's accounts are invisible to a store scoped to another.
 *
 * **A balance is DERIVED, never stored.** There is no `balance` column and no
 * method that writes one: `listBalances` computes each account's figure from its
 * `opening_balance` plus its live transactions, every time it is asked. A stored
 * mutable balance is the classic drift bug — one write that fails halfway and
 * the number lies forever, with nothing anywhere able to notice — and the cost of
 * avoiding it is one indexed sum per account.
 *
 * **Totals are per CURRENCY, and there is no cross-currency total.** An account
 * carries a currency; converting between two of them would need an exchange rate
 * this app has no honest source for, and a stale invented rate is worse than no
 * total. So `totalsByCurrency` answers with a LIST of `{currency, minorUnits}`
 * and there is deliberately no `total()` beside it — a caller cannot ask for a
 * cross-currency sum by accident, because the call does not exist.
 *
 * `now` is supplied by the caller and validated here: main stamps the clock, the
 * renderer never does.
 */
export class FinAccountStore {
  private readonly insert: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly updateFields: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;
  private readonly selectBalances: Database.Statement;
  private readonly selectTotals: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO fin_accounts
         (id, profile_id, name, kind, currency, opening_balance, archived,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM fin_accounts
       WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM fin_accounts
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateFields = db.prepare(
      `UPDATE fin_accounts
         SET name = ?, kind = ?, currency = ?, opening_balance = ?, archived = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE fin_accounts SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE fin_accounts SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    // Archived accounts ARE listed here: a closed account still has a balance,
    // and a screen showing it is telling the truth. `totalsByCurrency` below
    // makes the opposite choice, for its own stated reason.
    this.selectBalances = db.prepare(
      `SELECT a.id AS id, a.name AS name, a.currency AS currency,
              ${DERIVED_BALANCE} AS minor_units
         FROM fin_accounts a
        WHERE a.profile_id = ? AND a.deleted_at IS NULL`,
    );
    // Net worth, and therefore LIVE accounts only: an archived account is one
    // the user has closed, and folding its balance into today's total would
    // report money they no longer consider theirs to spend.
    this.selectTotals = db.prepare(
      `SELECT a.currency AS currency, SUM(${DERIVED_BALANCE}) AS minor_units
         FROM fin_accounts a
        WHERE a.profile_id = ? AND a.deleted_at IS NULL AND a.archived = 0
        GROUP BY a.currency`,
    );
  }

  /** This profile's live accounts, sr-Latn alphabetical by name (soft-deleted excluded; archived included and flagged). */
  listActive(): FinAccount[] {
    const rows = this.selectActive.all(this.profileId) as FinAccountRow[];
    return rows
      .map(toFinAccount)
      .sort((a, b) => FIN_COLLATOR.compare(a.name, b.name) || a.id.localeCompare(b.id));
  }

  /** Inserts an account and returns the stored row. */
  create(input: CreateFinAccountInput, now: string): FinAccount {
    const validNow = validateNow(now);
    const name = validateName(input.name);
    const kind = validateKind(input.kind);
    const currency = validateCurrency(input.currency);
    const openingBalance = validateOpeningBalance(input.openingBalance ?? 0);
    const id = uuidv7();

    this.insert.run(
      id, this.profileId, name, kind, currency, openingBalance, 0, validNow, validNow,
    );

    return {
      id, profileId: this.profileId, name, kind, currency, openingBalance,
      archived: false, createdAt: validNow, updatedAt: validNow,
    };
  }

  /** Applies a partial field patch to a live account and returns the merged row. */
  update(id: string, fields: UpdateFinAccountFields, now: string): FinAccount {
    const validNow = validateNow(now);
    const current = this.requireActive(id);

    const next: FinAccount = {
      ...current,
      name: fields.name !== undefined ? validateName(fields.name) : current.name,
      kind: fields.kind !== undefined ? validateKind(fields.kind) : current.kind,
      currency:
        fields.currency !== undefined ? validateCurrency(fields.currency) : current.currency,
      openingBalance:
        fields.openingBalance !== undefined
          ? validateOpeningBalance(fields.openingBalance)
          : current.openingBalance,
      archived: fields.archived !== undefined ? fields.archived : current.archived,
      updatedAt: validNow,
    };

    this.updateFields.run(
      next.name, next.kind, next.currency, next.openingBalance, next.archived ? 1 : 0,
      validNow, id, this.profileId,
    );
    return next;
  }

  /** Soft-deletes a live account (reversible via `restore`). Its transactions stay on disk and come back with it. */
  softDelete(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new FinAccountNotFoundError(`No active account "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted account. */
  restore(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new FinAccountNotFoundError(`No deleted account "${id}" to restore in this profile.`);
    }
  }

  /**
   * Each live account's DERIVED balance, in that account's own currency, in the
   * same sr-Latn name order `listActive` uses. Never a stored figure — see the
   * class comment for why the column does not exist.
   */
  listBalances(): FinAccountBalance[] {
    const rows = this.selectBalances.all(this.profileId) as BalanceRow[];
    return rows
      .sort((a, b) => FIN_COLLATOR.compare(a.name, b.name) || a.id.localeCompare(b.id))
      .map((row) => ({
        accountId: row.id,
        currency: row.currency,
        minorUnits: row.minor_units,
      }));
  }

  /**
   * Net worth PER CURRENCY, across this profile's live, non-archived accounts —
   * one entry per currency, ordered by code so a caller drawing it gets a stable
   * answer.
   *
   * There is no sibling method returning a single number, and that absence is
   * the design: with no exchange rate available, a cross-currency total could
   * only be invented, and this store makes inventing one impossible rather than
   * merely discouraged.
   */
  totalsByCurrency(): FinCurrencyTotal[] {
    const rows = this.selectTotals.all(this.profileId) as TotalRow[];
    return rows
      .map((row) => ({ currency: row.currency, minorUnits: row.minor_units }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
  }

  /** Reads a live account in this profile or throws — the gate every account reference goes through. */
  private requireActive(id: string): FinAccount {
    const row = this.selectActiveById.get(id, this.profileId) as FinAccountRow | undefined;
    if (!row) {
      throw new FinAccountNotFoundError(`No active account "${id}" in this profile.`);
    }
    return toFinAccount(row);
  }
}

function toFinAccount(row: FinAccountRow): FinAccount {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    kind: row.kind,
    currency: row.currency,
    openingBalance: row.opening_balance,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FIN_ACCOUNT_NAME_LENGTH) {
    throw new FinAccountValidationError(
      `"name" must be 1-${MAX_FIN_ACCOUNT_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateKind(value: FinAccountKind): FinAccountKind {
  if (!(FIN_ACCOUNT_KINDS as readonly string[]).includes(value)) {
    throw new FinAccountValidationError(`"${value}" is not a known account kind.`);
  }
  return value;
}

/** ISO-4217, upper-case, exactly as stored — never up-cased here, because a caller sending „rsd" has a bug this store should name rather than paper over. */
function validateCurrency(value: string): string {
  if (!isCurrencyCode(value)) {
    throw new FinAccountValidationError(
      `"currency" must be a three-letter upper-case ISO-4217 code (got "${value}").`,
    );
  }
  return value;
}

function validateOpeningBalance(value: number): number {
  if (!isMinorUnits(value)) {
    throw new FinAccountValidationError(
      `"openingBalance" must be a safe INTEGER of minor units — money is never a float.`,
    );
  }
  return value;
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new FinAccountValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}
