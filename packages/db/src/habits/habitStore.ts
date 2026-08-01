import type Database from "better-sqlite3-multiple-ciphers";
import { serializeHabitSchedule, validateHabitSchedule } from "@nexus/core";
import type { HabitSchedule } from "@nexus/core";
import { HabitNotFoundError, HabitValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { isBareDate, isDateTime } from "../finance/money.js";
import { NOTE_FOLDER_COLORS } from "../notes/noteOrgStore.js";
import type { NoteFolderColor } from "../notes/noteOrgStore.js";

type DatabaseHandle = Database.Database;

export const MAX_HABIT_NAME_LENGTH = 60;
/** „čaša", „km", „strana" — a unit is a word, not a sentence. */
export const MAX_HABIT_UNIT_LENGTH = 16;
/**
 * The ceiling on a `target` and on an entry's `value`. Not a semantic limit —
 * 10 000 koraka is an ordinary daily target and this holds ten times that — but
 * an untrusted caller's number goes into an INTEGER column that every read sums,
 * and a bound is cheaper than discovering the absence of one.
 */
export const MAX_HABIT_COUNT = 100_000;

/**
 * Serbian Latin ordering for the habit list, on `FIN_COLLATOR`'s terms: plain
 * `"sr"` mis-tailors š/č/ć/ž, and SQLite's BINARY collation would put „Šetnja"
 * after „Voda". Sorted here rather than deferred to the renderer for FIN's
 * reason — a store that hands back an order nobody fixes is a bug waiting for
 * slice b to inherit.
 */
const HABIT_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** Wall-clock `HH:MM`, 00:00–23:59 — the shape `ntf_settings`' own times have. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One habit: a name, a schedule, and — for a counted one — a target.
 *
 * **The schedule is HABIT's own language, never ADR-024's**
 * (`packages/core/src/habits/habitSchedule.ts`). Tasks, events and subscriptions
 * all carry a recurrence rule; a habit deliberately does not, because the rule
 * engine answers „when does this next occur" while a habit needs „was this period
 * satisfied", and because the rule language can express schedules over which a
 * streak is undefinable. Two kinds, `days` and `quota`, and no third.
 *
 * `target` is the one nullable column that makes „teretana" and „8 čaša vode" the
 * same model: null means binary and an entry's `value` is 1, non-null means a day
 * counts as done when `value >= target`. `unit` names what the target counts and
 * is meaningless without one, which the schema and this store both refuse.
 *
 * `archivedAt` and `deletedAt` are INDEPENDENT (migration 055, ADR-074's
 * arrangement): a habit you have finished with is not one you deleted — its
 * history is the point, and it must keep answering the stats while staying out of
 * today's list. So an archived habit is still returned by `listActive`, still
 * editable, and can still have its history corrected; the soft delete is what
 * takes it away.
 */
export interface Habit {
  id: string;
  profileId: string;
  name: string;
  /** A `note_folders` swatch key, reused rather than respelled — the app has exactly one palette. */
  color: NoteFolderColor | null;
  schedule: HabitSchedule;
  /** Whole units a day must reach to count, or null for a binary habit. */
  target: number | null;
  /** What `target` counts, or null. Never set without a target. */
  unit: string | null;
  /** Wall-clock `HH:MM` to remind at, or null — slice c's notification source reads it. */
  reminderTime: string | null;
  /** When the user finished with this habit, or null while it is current. Independent of the soft delete. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One day's tick. No `profileId`: an entry is scoped THROUGH its habit, the
 * `note_attachments` arrangement — every statement below resolves the habit in
 * THIS profile before it touches an entry.
 *
 * There is at most one of these per habit per day, and that is the SCHEMA's
 * promise (`UNIQUE (habit_id, entry_date)`) rather than this store's: an index
 * has to be right once, a guard has to be right every time.
 */
export interface HabitEntry {
  id: string;
  habitId: string;
  /** The bare local day, `YYYY-MM-DD`. */
  date: string;
  /** Whole units done that day; 1 for a binary habit. Never zero — an untick is `clearEntry`, not a zero row. */
  value: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateHabitInput {
  name: string;
  color?: NoteFolderColor | null;
  schedule: HabitSchedule;
  target?: number | null;
  unit?: string | null;
  reminderTime?: string | null;
}

/** A partial patch. An omitted key is left untouched; an explicit `null` clears a nullable field. */
export interface UpdateHabitFields {
  name?: string;
  color?: NoteFolderColor | null;
  schedule?: HabitSchedule;
  target?: number | null;
  unit?: string | null;
  reminderTime?: string | null;
}

/** An inclusive span of local days — the window the two entry reads answer over. */
export interface HabitDayRange {
  from: string;
  to: string;
}

interface HabitRow {
  id: string;
  profile_id: string;
  name: string;
  color: string | null;
  schedule: string;
  target: number | null;
  unit: string | null;
  reminder_time: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface HabitEntryRow {
  id: string;
  habit_id: string;
  entry_date: string;
  value: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, profile_id, name, color, schedule, target, unit, reminder_time, archived_at, " +
  "created_at, updated_at";

const ENTRY_COLUMNS = "id, habit_id, entry_date, value, created_at, updated_at";

/**
 * Habits and their daily ticks for a single profile, over prepared,
 * parameterized statements (SEC-API-03). Construct one per profile and reuse it.
 *
 * **Every habit statement is scoped by `profile_id`; every ENTRY statement is
 * scoped through its habit.** `habit_entries` carries no `profile_id` of its own
 * (migration 055, the `note_attachments` arrangement), so `setEntry`,
 * `clearEntry` and `listEntries` all resolve the habit in THIS profile first and
 * refuse when they cannot — an entry write naming another profile's habit is a
 * `HabitNotFoundError`, never a row.
 *
 * **Nothing here computes a week, or a streak.** The streak engine is pure and
 * lives in `@nexus/core` (`computeHabitStreak`), because a week's boundaries come
 * from the DEVICE's first-day-of-week preference — renderer storage, which this
 * package has no business knowing about. This store answers days; the periods
 * they add up to are decided where that preference lives.
 *
 * **Deleting a habit does not delete its history.** `softDelete` is an UPDATE, so
 * the entries stay exactly where they are and `restore` brings the habit back
 * with every tick it ever had. Migration 055's CASCADE reaches them only on a
 * HARD delete, which is what a profile deletion is.
 *
 * `now` is supplied by the caller and validated here — main stamps the clock, the
 * renderer never does.
 */
export class HabitStore {
  private readonly insert: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly updateFields: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;
  private readonly markArchived: Database.Statement;
  private readonly markUnarchived: Database.Statement;
  private readonly upsertEntry: Database.Statement;
  private readonly selectEntry: Database.Statement;
  private readonly deleteEntry: Database.Statement;
  private readonly selectEntriesForHabit: Database.Statement;
  private readonly selectEntriesForProfile: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO habits
         (id, profile_id, name, color, schedule, target, unit, reminder_time,
          archived_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM habits WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    // The one gate every mutation and every entry write passes: live in THIS
    // profile. Deliberately not filtered on `archived_at` — archiving is a fact
    // about today's list, never about whether the row is here (migration 055).
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM habits
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateFields = db.prepare(
      `UPDATE habits
         SET name = ?, color = ?, schedule = ?, target = ?, unit = ?, reminder_time = ?,
             updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE habits SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // Neither touches `archived_at`, deliberately: a habit thrown away while
    // archived comes back archived, because the archiving was never about
    // whether the row was on screen.
    this.markRestored = db.prepare(
      `UPDATE habits SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.markArchived = db.prepare(
      `UPDATE habits SET archived_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL AND archived_at IS NULL`,
    );
    this.markUnarchived = db.prepare(
      `UPDATE habits SET archived_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL AND archived_at IS NOT NULL`,
    );
    // The conflict target names migration 055's unique index and ONLY it, for
    // `FinRecurringStore.insertCharge`'s reason: a second tick of the same day
    // updates the value it carries, while a violated CHECK — a fractional or
    // zero `value` — still throws, which a blanket `INSERT OR IGNORE` would have
    // swallowed. `created_at` is left at the first tick's moment: the row is the
    // same day's answer, corrected.
    this.upsertEntry = db.prepare(
      `INSERT INTO habit_entries (id, habit_id, entry_date, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (habit_id, entry_date)
         DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    );
    this.selectEntry = db.prepare(
      `SELECT ${ENTRY_COLUMNS} FROM habit_entries WHERE habit_id = ? AND entry_date = ?`,
    );
    this.deleteEntry = db.prepare(
      `DELETE FROM habit_entries WHERE habit_id = ? AND entry_date = ?`,
    );
    this.selectEntriesForHabit = db.prepare(
      `SELECT ${ENTRY_COLUMNS} FROM habit_entries
       WHERE habit_id = ? AND entry_date >= ? AND entry_date <= ?
       ORDER BY entry_date`,
    );
    // ONE query for every habit of the profile — the today list and the history
    // grid both want all of them at once, and an N+1 per habit is the obvious
    // wrong shape for a page that draws a month. The join is also the profile
    // scope: `habit_entries` has no `profile_id` to filter on, and a
    // soft-deleted habit's ticks are as invisible here as the habit is in
    // `listActive`.
    this.selectEntriesForProfile = db.prepare(
      `SELECT e.id, e.habit_id, e.entry_date, e.value, e.created_at, e.updated_at
         FROM habit_entries e
         JOIN habits h ON h.id = e.habit_id
        WHERE h.profile_id = ? AND h.deleted_at IS NULL
          AND e.entry_date >= ? AND e.entry_date <= ?
        ORDER BY e.habit_id, e.entry_date`,
    );
  }

  /**
   * This profile's live habits, sr-Latn alphabetical — ARCHIVED ONES INCLUDED,
   * each carrying its own `archivedAt`. The caller decides what to show: today's
   * list wants only the current ones, while the stats and the history grid want
   * the archived ones too, and a store that had already dropped them would make
   * the second view impossible without a second read.
   */
  listActive(): Habit[] {
    const rows = this.selectActive.all(this.profileId) as HabitRow[];
    return rows
      .map((row) => this.toHabit(row))
      .sort((a, b) => HABIT_COLLATOR.compare(a.name, b.name) || a.id.localeCompare(b.id));
  }

  /** Inserts a habit and returns the stored row, its schedule in canonical form. */
  create(input: CreateHabitInput, now: string): Habit {
    const validNow = validateNow(now);
    const resolved = resolve({
      name: input.name,
      color: input.color ?? null,
      schedule: input.schedule,
      target: input.target ?? null,
      unit: input.unit ?? null,
      reminderTime: input.reminderTime ?? null,
    });
    const id = uuidv7();

    this.insert.run(
      id, this.profileId, resolved.name, resolved.color,
      serializeHabitSchedule(resolved.schedule), resolved.target, resolved.unit,
      resolved.reminderTime, validNow, validNow,
    );

    return {
      id, profileId: this.profileId, ...resolved, archivedAt: null,
      createdAt: validNow, updatedAt: validNow,
    };
  }

  /**
   * Applies a partial patch to a habit that is still here. An ARCHIVED habit is
   * edited on exactly these terms — `requireHabit` filters on `deleted_at` alone,
   * and that is right: archiving says „ne pitaj me više za ovo", never „ne diraj
   * me", and being unable to fix the name of something you archived would be a
   * strange thing to enforce.
   *
   * Changing the SCHEDULE does not touch the entries, deliberately: a tick is a
   * fact about a day that happened, and re-reading old days under a new schedule
   * is precisely what makes the streak recompute correctly. There is no cursor
   * here to re-anchor — that is what having no rule engine buys.
   */
  update(id: string, fields: UpdateHabitFields, now: string): Habit {
    const validNow = validateNow(now);
    const current = this.requireHabit(id);

    const resolved = resolve({
      name: fields.name ?? current.name,
      color: "color" in fields ? (fields.color ?? null) : current.color,
      schedule: fields.schedule ?? current.schedule,
      target: "target" in fields ? (fields.target ?? null) : current.target,
      unit: "unit" in fields ? (fields.unit ?? null) : current.unit,
      reminderTime:
        "reminderTime" in fields ? (fields.reminderTime ?? null) : current.reminderTime,
    });

    this.updateFields.run(
      resolved.name, resolved.color, serializeHabitSchedule(resolved.schedule), resolved.target,
      resolved.unit, resolved.reminderTime, validNow, id, this.profileId,
    );
    return { ...current, ...resolved, updatedAt: validNow };
  }

  /** Soft-deletes a live habit (reversible via `restore`). Its entries are UNTOUCHED — see the class comment. */
  softDelete(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new HabitNotFoundError(`No live habit "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted habit, with every tick it ever had. */
  restore(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new HabitNotFoundError(`No deleted habit "${id}" to restore in this profile.`);
    }
  }

  /**
   * Marks a habit as one the user has finished with (migration 055). It leaves
   * today's list and keeps its history — which is the whole reason this is not a
   * delete: the stats a habit accumulated are usually the reason somebody kept
   * it, and „gotov sam s ovim" must not cost them.
   */
  archive(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markArchived.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new HabitNotFoundError(`No unarchived habit "${id}" to archive in this profile.`);
    }
  }

  /** Puts an archived habit back among the current ones. */
  unarchive(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markUnarchived.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new HabitNotFoundError(`No archived habit "${id}" to unarchive in this profile.`);
    }
  }

  /**
   * Records what was done on one day, replacing whatever that day said before.
   * `value` is 1 for a binary habit and the count for a targeted one; whether the
   * day COUNTS is read off the habit's own `target`, never stored here — a target
   * the user later raises must re-judge the days already recorded, which a stored
   * verdict could not.
   *
   * Idempotence is the SCHEMA's (migration 055's `UNIQUE (habit_id, entry_date)`),
   * so a double tap is a value update rather than a second row — see the
   * statement's own comment for why the conflict target names that index.
   */
  setEntry(habitId: string, day: string, value: number, now: string): HabitEntry {
    const validNow = validateNow(now);
    const validDay = validateDay(day, "day");
    const validValue = validateCount(value, "value");
    this.requireHabit(habitId);

    this.upsertEntry.run(uuidv7(), habitId, validDay, validValue, validNow, validNow);
    // Read back rather than reconstructed: on a second tick the row keeps the
    // FIRST one's id and `createdAt`, and only the row itself knows them.
    return this.toEntry(this.selectEntry.get(habitId, validDay) as HabitEntryRow);
  }

  /**
   * Un-ticks a day. Removing a tick that is not there is not an error — the
   * caller asked for a day with no entry and that is what stands afterwards — but
   * naming a habit this profile does not have still is, because that is a
   * question about somebody else's data rather than about an absent row.
   */
  clearEntry(habitId: string, day: string): void {
    const validDay = validateDay(day, "day");
    this.requireHabit(habitId);
    this.deleteEntry.run(habitId, validDay);
  }

  /** One habit's ticks inside an inclusive day window, oldest first. */
  listEntries(habitId: string, range: HabitDayRange): HabitEntry[] {
    const { from, to } = validateRange(range);
    this.requireHabit(habitId);
    const rows = this.selectEntriesForHabit.all(habitId, from, to) as HabitEntryRow[];
    return rows.map((row) => this.toEntry(row));
  }

  /**
   * EVERY live habit's ticks inside an inclusive day window, in one query,
   * grouped by habit and oldest first within each — what the today list and the
   * history grid both read, so neither has to walk `listEntries` per habit.
   */
  listAllEntries(range: HabitDayRange): HabitEntry[] {
    const { from, to } = validateRange(range);
    const rows = this.selectEntriesForProfile.all(this.profileId, from, to) as HabitEntryRow[];
    return rows.map((row) => this.toEntry(row));
  }

  /** Reads a live habit in this profile or throws — the scope check every entry statement runs first. */
  private requireHabit(id: string): Habit {
    const row = this.selectActiveById.get(id, this.profileId) as HabitRow | undefined;
    if (!row) {
      throw new HabitNotFoundError(`No live habit "${id}" in this profile.`);
    }
    return this.toHabit(row);
  }

  private toHabit(row: HabitRow): Habit {
    return {
      id: row.id,
      profileId: row.profile_id,
      name: row.name,
      color: row.color as NoteFolderColor | null,
      schedule: parseStoredSchedule(row.schedule, row.id),
      target: row.target,
      unit: row.unit,
      reminderTime: row.reminder_time,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toEntry(row: HabitEntryRow): HabitEntry {
    return {
      id: row.id,
      habitId: row.habit_id,
      date: row.entry_date,
      value: row.value,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/** The habit's own fields, minus the ones the row rather than the caller decides. */
type ResolvedHabit = Omit<Habit, "id" | "profileId" | "archivedAt" | "createdAt" | "updatedAt">;

/**
 * Validates and resolves a whole habit's fields — the ONE place every refusal
 * lives, so `create` and `update` cannot drift on what a habit is allowed to be.
 */
function resolve(fields: ResolvedHabit): ResolvedHabit {
  const target = fields.target === null ? null : validateCount(fields.target, "target");
  const unit = validateUnit(fields.unit);
  // Migration 055's own pair CHECK, refused here so it is a named domain error
  // rather than a raw constraint failure. REFUSED rather than repaired: clearing
  // a target while leaving „čaša" behind is an edit the caller got wrong, and
  // silently dropping the unit for them would be this store deciding what they
  // meant.
  if (unit !== null && target === null) {
    throw new HabitValidationError(`"unit" needs a "target" to be the unit of.`);
  }
  return {
    name: validateName(fields.name),
    color: validateColor(fields.color),
    schedule: validateSchedule(fields.schedule),
    target,
    unit,
    reminderTime: validateReminderTime(fields.reminderTime),
  };
}

/**
 * Structural validation of a schedule from an untrusted caller, through HABIT's
 * own validator. Returns the CANONICAL form, so the column and the returned row
 * agree on member order and on weekday ordering.
 *
 * An ADR-024 recurrence rule fails here, and that is the module's central
 * decision enforced rather than merely documented: HABIT has one schedule
 * language and it is not that one (`habitSchedule.ts`).
 */
function validateSchedule(value: HabitSchedule): HabitSchedule {
  const schedule = validateHabitSchedule(value);
  if (schedule === null) {
    throw new HabitValidationError(`"schedule" is not a valid habit schedule.`);
  }
  return schedule;
}

/**
 * Reads the stored column back. This store writes only
 * `serializeHabitSchedule` output, so anything that fails to validate is
 * corruption (a hand-edited file, a bad restore) rather than input to be
 * coerced — reading it as null would silently turn „ponedeljak/sreda/petak" into
 * a habit with no schedule at all, so it throws naming the row
 * (`FinRecurringStore`'s own posture).
 */
function parseStoredSchedule(text: string, id: string): HabitSchedule {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const schedule = validateHabitSchedule(parsed);
  if (schedule === null) {
    throw new HabitValidationError(`Habit "${id}" carries a stored schedule that is not valid.`);
  }
  return schedule;
}

function validateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_HABIT_NAME_LENGTH) {
    throw new HabitValidationError(
      `"name" must be 1-${MAX_HABIT_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

/** The folder palette, checked against the folder's own list — one palette, one source (`NoteCategory.color`'s rule). */
function validateColor(value: NoteFolderColor | null): NoteFolderColor | null {
  if (value === null) return null;
  if (!(NOTE_FOLDER_COLORS as readonly string[]).includes(value)) {
    throw new HabitValidationError(`"color" must be one of the folder palette keys.`);
  }
  return value;
}

/** A whole positive count — a target or a day's value. Never a float: „pola čaše" is not something this module records. */
function validateCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_HABIT_COUNT) {
    throw new HabitValidationError(
      `"${field}" must be a whole number between 1 and ${MAX_HABIT_COUNT}.`,
    );
  }
  return value;
}

/** Trims the unit; absent/empty/whitespace-only collapses to null, and an over-long one is refused rather than truncated. */
function validateUnit(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_HABIT_UNIT_LENGTH) {
    throw new HabitValidationError(
      `"unit" must be at most ${MAX_HABIT_UNIT_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateReminderTime(value: string | null): string | null {
  if (value === null) return null;
  if (!HH_MM.test(value)) {
    throw new HabitValidationError(`"reminderTime" must be a wall-clock HH:MM.`);
  }
  return value;
}

function validateDay(value: string, field: string): string {
  if (!isBareDate(value)) {
    throw new HabitValidationError(`"${field}" must be a real bare date (YYYY-MM-DD).`);
  }
  return value;
}

function validateRange(range: HabitDayRange): HabitDayRange {
  const from = validateDay(range.from, "from");
  const to = validateDay(range.to, "to");
  if (from > to) {
    throw new HabitValidationError(`"from" must not be after "to".`);
  }
  return { from, to };
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new HabitValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}
