import type Database from "better-sqlite3-multiple-ciphers";
import {
  nextOccurrenceDate,
  occurrenceDatesInRange,
  serializeRecurrenceRule,
  shiftDayKey,
  validateRecurrenceRule,
} from "@nexus/core";
import type { RecurrenceRule } from "@nexus/core";
import {
  FinAccountNotFoundError,
  FinCategoryNotFoundError,
  FinRecurringNotFoundError,
  FinRecurringValidationError,
} from "../errors.js";
import { uuidv7 } from "../ids.js";
import { FIN_COLLATOR, isBareDate, isDateTime, isMinorUnits } from "./money.js";
import { MAX_FIN_NOTE_LENGTH, MAX_FIN_PAYEE_LENGTH } from "./transactionStore.js";

type DatabaseHandle = Database.Database;

export const MAX_FIN_RECURRING_NAME_LENGTH = 60;
/** The furthest ahead a renewal reminder may be asked for — a year, past which „podseti me" stops meaning anything. */
export const MAX_FIN_REMINDER_DAYS = 365;

/**
 * One recurring charge: a transaction TEMPLATE plus an ADR-024 schedule. The
 * template half is exactly the `fin_transactions` row each charge will be, and
 * `amount` is signed the same way — negative leaves `accountId`, positive
 * arrives in it — so a standing salary is as expressible as a Netflix bill.
 *
 * There is no `counterAccountId`: a subscription is never a transfer. A standing
 * order between your own two accounts moves nothing over time, and the point of
 * a template is that every charge it makes is the same kind of thing.
 */
export interface FinRecurring {
  id: string;
  profileId: string;
  accountId: string;
  categoryId: string | null;
  name: string;
  /** Minor units, INTEGER, never zero. */
  amount: number;
  payee: string | null;
  note: string | null;
  /** ADR-024's rule language — the very one `tasks.recurrence` and `events.recurrence` carry. */
  recurrence: RecurrenceRule;
  /** The bare day the rule phases from, and the series' first possible charge. */
  startDate: string;
  /**
   * The first occurrence NOT yet charged, or null once the series is spent.
   * A CURSOR, never a promise: nothing is written for it until that day has
   * actually arrived (`generateDue`).
   */
  nextRun: string | null;
  /** Whole days before a charge to remind, or null for „ne podsećaj me". */
  reminderDays: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFinRecurringInput {
  accountId: string;
  categoryId?: string | null;
  name: string;
  amount: number;
  payee?: string | null;
  note?: string | null;
  recurrence: RecurrenceRule;
  startDate: string;
  reminderDays?: number | null;
}

/**
 * A partial patch. An omitted key is left untouched; an explicit `null` clears a
 * nullable field. Changing `startDate` or `recurrence` re-anchors the cursor —
 * see `update`.
 */
export interface UpdateFinRecurringFields {
  accountId?: string;
  categoryId?: string | null;
  name?: string;
  amount?: number;
  payee?: string | null;
  note?: string | null;
  recurrence?: RecurrenceRule;
  startDate?: string;
  reminderDays?: number | null;
}

/**
 * One renewal the SCHEDULE says is coming — derived from the rule on every read
 * and never stored, which is the whole reason nothing is posted into the future.
 * Carries the account's currency because an amount without one is a number, not
 * money.
 */
export interface FinUpcomingRenewal {
  recurringId: string;
  /** The bare day the charge falls on. */
  date: string;
  name: string;
  accountId: string;
  currency: string;
  categoryId: string | null;
  amount: number;
}

/** An inclusive span of local days — the window `upcoming` answers over. */
export interface FinRenewalWindow {
  from: string;
  to: string;
}

interface FinRecurringRow {
  id: string;
  profile_id: string;
  account_id: string;
  category_id: string | null;
  name: string;
  amount: number;
  payee: string | null;
  note: string | null;
  recurrence: string;
  anchor_date: string;
  next_run: string | null;
  reminder_days: number | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, profile_id, account_id, category_id, name, amount, payee, note, recurrence, " +
  "anchor_date, next_run, reminder_days, created_at, updated_at";

/**
 * Finance subscriptions — recurring charges — for a single profile, over
 * prepared, parameterized statements (SEC-API-03). Construct one per profile and
 * reuse it. Every statement is scoped by `profile_id`, and the account and
 * category a subscription names are resolved THROUGH that scope.
 *
 * **The schedule is ADR-024's, verbatim.** `validateRecurrenceRule` /
 * `serializeRecurrenceRule` / `nextOccurrenceDate` / `occurrenceDatesInRange`
 * are the same four functions `TaskStore` and `EventStore` use, over the same
 * canonical JSON migration 018 stores. There is no second rule language for
 * money and there will not be one: daily / weekdays / weekly-by-days /
 * monthly-date / monthly-ordinal / yearly, with intervals and never/until/count
 * ends, under skip-never-clamp semantics, is already more schedule than any
 * subscription has ever needed, and it already has a hundred table tests.
 *
 * **A charge is an ORDINARY transaction.** `generateDue` writes plain
 * `fin_transactions` rows carrying a `recurring_id`, so the derived balance, the
 * `fin_flows` transfer-free view, the month report and the archive all keep
 * working with no special case — and the row is editable, deletable and
 * restorable exactly like a typed one, because it IS one.
 *
 * **Nothing is ever generated into the future.** `generateDue` charges
 * occurrences up to and including `today` and stops. A charge that has not
 * happened is not a transaction, it is an expectation, and posting it would turn
 * the balance into a forecast. What is coming is read from the RULE instead
 * (`upcoming`), which is also what the calendar and the dashboard draw.
 *
 * **Idempotence is the SCHEMA's** (migration 053): `UNIQUE (recurring_id,
 * tx_date)` over the rows that name a subscription. The insert below targets
 * that exact index with `ON CONFLICT … DO NOTHING`, so a re-run, a crash between
 * the insert and the cursor advance, or a restored archive whose cursor
 * disagrees with its rows all cost nothing — while every other constraint still
 * fails loudly. A cursor the code maintains has to be right every time; an index
 * has to be right once.
 *
 * `now` and `today` are supplied by the caller and validated here — main stamps
 * the clock, the renderer never does.
 */
export class FinRecurringStore {
  private readonly insert: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly selectDue: Database.Statement;
  private readonly updateFields: Database.Statement;
  private readonly updateCursor: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;
  private readonly selectAccount: Database.Statement;
  private readonly selectCategory: Database.Statement;
  private readonly insertCharge: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO fin_recurring
         (id, profile_id, account_id, category_id, name, amount, payee, note, recurrence,
          anchor_date, next_run, reminder_days, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM fin_recurring
       WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM fin_recurring
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // The generator's own read: the live subscriptions whose cursor has already
    // arrived. A NULL cursor is a spent series and is out by construction.
    this.selectDue = db.prepare(
      `SELECT ${COLUMNS} FROM fin_recurring
       WHERE profile_id = ? AND deleted_at IS NULL
         AND next_run IS NOT NULL AND next_run <= ?
       ORDER BY next_run, id`,
    );
    this.updateFields = db.prepare(
      `UPDATE fin_recurring
         SET account_id = ?, category_id = ?, name = ?, amount = ?, payee = ?, note = ?,
             recurrence = ?, anchor_date = ?, next_run = ?, reminder_days = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateCursor = db.prepare(
      `UPDATE fin_recurring SET next_run = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE fin_recurring SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE fin_recurring SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.selectAccount = db.prepare(
      `SELECT id, currency FROM fin_accounts
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectCategory = db.prepare(
      `SELECT id FROM fin_categories WHERE id = ? AND profile_id = ?`,
    );
    // The conflict target names migration 053's partial index and ONLY it: an
    // occurrence already charged is a no-op, while a violated CHECK or foreign
    // key still throws (which a blanket `INSERT OR IGNORE` would have swallowed).
    this.insertCharge = db.prepare(
      `INSERT INTO fin_transactions
         (id, profile_id, account_id, counter_account_id, category_id, tx_date, amount,
          payee, note, created_at, updated_at, deleted_at, recurring_id)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT (recurring_id, tx_date) WHERE recurring_id IS NOT NULL DO NOTHING`,
    );
  }

  /** This profile's live subscriptions, sr-Latn alphabetical by name. */
  listActive(): FinRecurring[] {
    const rows = this.selectActive.all(this.profileId) as FinRecurringRow[];
    return rows
      .map((row) => this.toFinRecurring(row))
      .sort((a, b) => FIN_COLLATOR.compare(a.name, b.name) || a.id.localeCompare(b.id));
  }

  /** Inserts a subscription with its cursor opened on its own start date, and returns the stored row. */
  create(input: CreateFinRecurringInput, now: string): FinRecurring {
    const validNow = validateNow(now);
    const resolved = this.resolve({
      accountId: input.accountId,
      categoryId: input.categoryId ?? null,
      name: input.name,
      amount: input.amount,
      payee: input.payee ?? null,
      note: input.note ?? null,
      recurrence: input.recurrence,
      startDate: input.startDate,
      reminderDays: input.reminderDays ?? null,
    });
    const id = uuidv7();
    const nextRun = firstOccurrence(resolved.recurrence, resolved.startDate);

    this.insert.run(
      id, this.profileId, resolved.accountId, resolved.categoryId, resolved.name, resolved.amount,
      resolved.payee, resolved.note, serializeRecurrenceRule(resolved.recurrence),
      resolved.startDate, nextRun, resolved.reminderDays, validNow, validNow,
    );

    return {
      id, profileId: this.profileId, ...resolved, nextRun,
      createdAt: validNow, updatedAt: validNow,
    };
  }

  /**
   * Applies a partial patch to a live subscription. Changing the SCHEDULE — the
   * rule or the start date — re-anchors the cursor to the new start date: a
   * different schedule is a different series, and keeping a position inside one
   * that no longer exists would charge dates the new rule never names. Charges
   * already generated are untouched, because they are money that already moved.
   */
  update(id: string, fields: UpdateFinRecurringFields, now: string): FinRecurring {
    const validNow = validateNow(now);
    const current = this.requireActive(id);

    const resolved = this.resolve({
      accountId: fields.accountId ?? current.accountId,
      categoryId: "categoryId" in fields ? (fields.categoryId ?? null) : current.categoryId,
      name: fields.name ?? current.name,
      amount: fields.amount ?? current.amount,
      payee: "payee" in fields ? (fields.payee ?? null) : current.payee,
      note: "note" in fields ? (fields.note ?? null) : current.note,
      recurrence: fields.recurrence ?? current.recurrence,
      startDate: fields.startDate ?? current.startDate,
      reminderDays:
        "reminderDays" in fields ? (fields.reminderDays ?? null) : current.reminderDays,
    });

    const rescheduled = fields.startDate !== undefined || fields.recurrence !== undefined;
    const nextRun = rescheduled
      ? firstOccurrence(resolved.recurrence, resolved.startDate)
      : current.nextRun;

    this.updateFields.run(
      resolved.accountId, resolved.categoryId, resolved.name, resolved.amount, resolved.payee,
      resolved.note, serializeRecurrenceRule(resolved.recurrence), resolved.startDate, nextRun,
      resolved.reminderDays, validNow, id, this.profileId,
    );
    return { ...current, ...resolved, nextRun, updatedAt: validNow };
  }

  /** Soft-deletes a live subscription (reversible via `restore`); generation skips it immediately, and its past charges stay. */
  softDelete(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new FinRecurringNotFoundError(
        `No active subscription "${id}" to delete in this profile.`,
      );
    }
  }

  /** Restores a soft-deleted subscription. Its cursor is where it was, so the next pass catches up whatever came due meanwhile. */
  restore(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new FinRecurringNotFoundError(
        `No deleted subscription "${id}" to restore in this profile.`,
      );
    }
  }

  /**
   * Charges every occurrence that has come due, up to and INCLUDING `today`, and
   * returns how many rows were actually written. Idempotent by construction (see
   * the class comment): running it twice cannot double-charge, and a charge the
   * user deleted does not come back — its soft-deleted row still holds its day
   * in migration 053's unique index.
   *
   * One transaction per subscription: the charges and the cursor advance land
   * together or not at all. Per subscription rather than per pass so one broken
   * row cannot cost another's catch-up.
   */
  generateDue(now: string, today: string): number {
    const validNow = validateNow(now);
    const validToday = validateDay(today, "today");

    const due = this.selectDue.all(this.profileId, validToday) as FinRecurringRow[];
    let written = 0;

    for (const row of due) {
      const subscription = this.toFinRecurring(row);
      written += this.db.transaction(() => {
        let cursor = subscription.nextRun;
        let count = 0;
        // A hard bound on one pass: the engine itself refuses to walk further
        // than `MAX_SCAN_PERIODS`, and a daily subscription untouched for years
        // is the honest worst case — it catches up over several passes rather
        // than holding one transaction open across thousands of inserts.
        for (let step = 0; step < MAX_CATCH_UP_CHARGES && cursor !== null && cursor <= validToday; step += 1) {
          const { changes } = this.insertCharge.run(
            uuidv7(), this.profileId, subscription.accountId, subscription.categoryId,
            cursor, subscription.amount,
            // A charge with no payee of its own is filed under the
            // subscription's own name: a ledger row reading „—" would say less
            // than the row already knows.
            subscription.payee ?? subscription.name, subscription.note,
            validNow, validNow, subscription.id,
          );
          count += changes;
          cursor = nextOccurrenceDate(subscription.recurrence, subscription.startDate, cursor);
        }
        this.updateCursor.run(cursor, validNow, subscription.id, this.profileId);
        return count;
      })();
    }

    return written;
  }

  /**
   * The renewals the SCHEDULE places inside an inclusive window, soonest first —
   * derived from each rule on every call, never read from a row. This is what
   * the calendar's „Pretplate" source and the dashboard's upcoming-renewals card
   * draw, and it is why nothing is ever posted ahead of time.
   *
   * A soft-deleted subscription contributes nothing, and a series' own
   * `until`/`count` end bounds it exactly as it bounds a recurring event.
   */
  upcoming(window: FinRenewalWindow): FinUpcomingRenewal[] {
    const from = validateDay(window.from, "from");
    const to = validateDay(window.to, "to");
    if (from > to) {
      throw new FinRecurringValidationError(`"from" must not be after "to".`);
    }

    const renewals: FinUpcomingRenewal[] = [];
    for (const subscription of this.listActive()) {
      const account = this.selectAccount.get(subscription.accountId, this.profileId) as
        | { id: string; currency: string }
        | undefined;
      // A subscription whose account was soft-deleted has no currency to state
      // its amount in, so it draws nothing — the same skip-not-throw discipline
      // the calendar merge keeps for a malformed row.
      if (account === undefined) continue;

      for (const date of occurrenceDatesInRange(
        subscription.recurrence,
        subscription.startDate,
        { from, to },
      )) {
        renewals.push({
          recurringId: subscription.id,
          date,
          name: subscription.name,
          accountId: subscription.accountId,
          currency: account.currency,
          categoryId: subscription.categoryId,
          amount: subscription.amount,
        });
      }
    }

    return renewals.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        FIN_COLLATOR.compare(a.name, b.name) ||
        a.recurringId.localeCompare(b.recurringId),
    );
  }

  /** Reads a live subscription in this profile or throws. */
  private requireActive(id: string): FinRecurring {
    const row = this.selectActiveById.get(id, this.profileId) as FinRecurringRow | undefined;
    if (!row) {
      throw new FinRecurringNotFoundError(`No active subscription "${id}" in this profile.`);
    }
    return this.toFinRecurring(row);
  }

  /**
   * Validates and resolves a whole subscription's fields — the ONE place every
   * refusal lives, so `create` and `update` cannot drift on what a schedule is
   * allowed to be.
   */
  private resolve(fields: {
    accountId: string;
    categoryId: string | null;
    name: string;
    amount: number;
    payee: string | null;
    note: string | null;
    recurrence: RecurrenceRule;
    startDate: string;
    reminderDays: number | null;
  }): Omit<FinRecurring, "id" | "profileId" | "nextRun" | "createdAt" | "updatedAt"> {
    return {
      accountId: this.requireAccount(fields.accountId).id,
      categoryId:
        fields.categoryId === null ? null : this.requireCategory(fields.categoryId).id,
      name: validateName(fields.name),
      amount: validateAmount(fields.amount),
      payee: validateOptionalText(fields.payee, "payee", MAX_FIN_PAYEE_LENGTH),
      note: validateOptionalText(fields.note, "note", MAX_FIN_NOTE_LENGTH),
      recurrence: validateRecurrence(fields.recurrence),
      startDate: validateDay(fields.startDate, "startDate"),
      reminderDays: validateReminderDays(fields.reminderDays),
    };
  }

  /** Resolves an account id to a live account in THIS profile — the scope check that stops a row naming another profile's account. */
  private requireAccount(id: string): { id: string; currency: string } {
    const row = this.selectAccount.get(id, this.profileId) as
      | { id: string; currency: string }
      | undefined;
    if (!row) {
      throw new FinAccountNotFoundError(`No active account "${id}" in this profile.`);
    }
    return row;
  }

  /** Resolves a category id to a category in THIS profile, on the same terms. */
  private requireCategory(id: string): { id: string } {
    const row = this.selectCategory.get(id, this.profileId) as { id: string } | undefined;
    if (!row) {
      throw new FinCategoryNotFoundError(`No category "${id}" in this profile.`);
    }
    return row;
  }

  private toFinRecurring(row: FinRecurringRow): FinRecurring {
    return {
      id: row.id,
      profileId: row.profile_id,
      accountId: row.account_id,
      categoryId: row.category_id,
      name: row.name,
      amount: row.amount,
      payee: row.payee,
      note: row.note,
      recurrence: parseStoredRecurrence(row.recurrence, row.id),
      startDate: row.anchor_date,
      nextRun: row.next_run,
      reminderDays: row.reminder_days,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/**
 * Where a fresh cursor opens: the first date the rule ACTUALLY places on or
 * after the start date — not the start date itself.
 *
 * The distinction is the whole of it. ADR-024's engine treats the anchor as a
 * candidate like any other, so „prva naplata 10. aprila, mesečno 5-og" opens on
 * 5 May, not on 10 April: the April period's own date is behind the anchor and
 * is dropped, exactly as it would be for a recurring event. Seeding the cursor
 * with the raw start date would have charged a day the schedule never names —
 * and, because `generateDue` walks forward from wherever the cursor is, that
 * phantom charge would have been indistinguishable from a real one afterwards.
 *
 * `null` when the rule places nothing at all (an `until` before the anchor):
 * a series spent before it began, which is what a null cursor means everywhere
 * else too.
 */
function firstOccurrence(rule: RecurrenceRule, startDate: string): string | null {
  // "Strictly after the day before" IS "on or after", and it is the only
  // formulation that needs no upper bound — the engine's own scan cap decides
  // how far it looks.
  return nextOccurrenceDate(rule, startDate, shiftDayKey(startDate, -1));
}

/**
 * How many charges ONE pass may write for ONE subscription. Not a semantic
 * limit: a daily subscription left ungenerated for three years needs about a
 * thousand, and every coarser rule needs far fewer. It exists so a corrupt
 * cursor far in the past cannot hold a write transaction open indefinitely — the
 * remainder simply catches up on the next pass, which is a minute away.
 */
const MAX_CATCH_UP_CHARGES = 1200;

/**
 * Structural validation of a rule from an untrusted caller, through ADR-024's
 * own validator — the same gate `TaskStore` and `EventStore` use. Returns the
 * CANONICAL form, so the column and the returned row agree on member order.
 */
function validateRecurrence(value: RecurrenceRule): RecurrenceRule {
  const rule = validateRecurrenceRule(value);
  if (rule === null) {
    throw new FinRecurringValidationError(`"recurrence" is not a valid recurrence rule.`);
  }
  return rule;
}

/**
 * Reads the stored column back. This store writes only
 * `serializeRecurrenceRule` output, so anything that fails to validate is
 * corruption (a hand-edited file, a bad restore) rather than input to be
 * coerced — reading it as null would silently turn a subscription into a
 * one-off charge, so it throws naming the row (`TaskStore`'s own posture).
 */
function parseStoredRecurrence(text: string, id: string): RecurrenceRule {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const rule = validateRecurrenceRule(parsed);
  if (rule === null) {
    throw new FinRecurringValidationError(
      `Subscription "${id}" carries a stored recurrence rule that is not valid.`,
    );
  }
  return rule;
}

function validateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_FIN_RECURRING_NAME_LENGTH) {
    throw new FinRecurringValidationError(
      `"name" must be 1-${MAX_FIN_RECURRING_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateAmount(value: number): number {
  if (!isMinorUnits(value) || value === 0) {
    throw new FinRecurringValidationError(
      `"amount" must be a non-zero safe INTEGER of minor units — money is never a float.`,
    );
  }
  return value;
}

function validateDay(value: string, field: string): string {
  if (!isBareDate(value)) {
    throw new FinRecurringValidationError(`"${field}" must be a real bare date (YYYY-MM-DD).`);
  }
  return value;
}

function validateReminderDays(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > MAX_FIN_REMINDER_DAYS) {
    throw new FinRecurringValidationError(
      `"reminderDays" must be a whole number of days between 0 and ${MAX_FIN_REMINDER_DAYS}, or null.`,
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
    throw new FinRecurringValidationError(
      `"${field}" must be at most ${maxLength} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new FinRecurringValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}
