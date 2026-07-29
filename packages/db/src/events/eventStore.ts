import type Database from "better-sqlite3-multiple-ciphers";
import { isValidDayKey, serializeRecurrenceRule, shiftDayKey, validateRecurrenceRule } from "@nexus/core";
import type { RecurrenceRule } from "@nexus/core";
import { EventNotFoundError, EventValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/**
 * CAL-006: the longest lead time one reminder may carry — 30 days, in minutes.
 * Exported (and re-exported from the package barrel) so the IPC validator that
 * guards this store from an untrusted renderer checks the very same bound
 * rather than a second copy of it.
 */
export const MAX_EVENT_REMINDER_MINUTES = 43_200;

/** CAL-006: how many reminders one event may carry. Exported for the same reason as the cap above. */
export const MAX_EVENT_REMINDERS = 8;

/**
 * A calendar event as the store returns it: camelCase keys that map straight
 * onto a views engine `CollectionSchema` (title → text, startAt/endAt → date,
 * allDay → boolean) with no adapter. `allDay` is decoded from the 0/1 column.
 */
export interface Event {
  id: string;
  profileId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  category: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * The rule that makes this row a **series master** the calendar expands
   * virtually (ADR-024), or null for a one-off. Anchored on `startAt`'s own
   * day, so a master's start must be a day the engine can phase from.
   */
  recurrence: RecurrenceRule | null;
  /**
   * Bare `YYYY-MM-DD` occurrence dates the user removed from the series
   * (deleted or detached into their own event), ascending. Empty whenever
   * `recurrence` is null — an exception without a series means nothing.
   * Settable only through `addRecurrenceExdate`, never through create/update.
   */
  recurrenceExdates: string[];
  /**
   * Whole minutes before an occurrence's start at which to remind (CAL-006),
   * ascending. Unlike `recurrenceExdates` these ARE ordinary user input — a
   * ladder like a document's — so create/update set them, and they are
   * independent of `recurrence`: a one-off event reminds too.
   */
  reminderOffsets: number[];
}

/** Fields accepted when creating an event; only `title` and `startAt` are required (CAL-001). */
export interface CreateEventInput {
  title: string;
  startAt: string;
  endAt?: string | null;
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
  category?: string | null;
  recurrence?: RecurrenceRule | null;
  reminderOffsets?: number[];
}

/**
 * A partial patch of an event's own fields. An omitted key is left untouched; an
 * explicit `null` clears a nullable field. Soft delete/restore and the two
 * series operations (`addRecurrenceExdate`, `splitRecurrence`) have their own
 * methods.
 */
export interface UpdateEventFields {
  title?: string;
  startAt?: string;
  endAt?: string | null;
  allDay?: boolean;
  location?: string | null;
  description?: string | null;
  category?: string | null;
  recurrence?: RecurrenceRule | null;
  reminderOffsets?: number[];
}

interface EventRow {
  id: string;
  profile_id: string;
  title: string;
  description: string | null;
  start_at: string;
  end_at: string | null;
  all_day: number;
  location: string | null;
  category: string | null;
  created_at: string;
  updated_at: string;
  recurrence: string | null;
  recurrence_exdates: string;
  reminder_offsets: string;
}

const COLUMNS =
  "id, profile_id, title, description, start_at, end_at, all_day, " +
  "location, category, created_at, updated_at, recurrence, recurrence_exdates, reminder_offsets";

/** Accepts ISO-8601 date ('2026-07-08') or date-time, optionally zoned (PRD §7). */
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Event persistence for a single profile, over prepared, parameterized statements
 * (SEC-API-03; every value is bound, never interpolated). Mirrors `TaskStore`:
 * construct one per profile, reuse it. Inputs are revalidated here because the
 * renderer is untrusted (SEC-EL-02), and every statement is scoped by
 * `profile_id` so one profile's events are invisible to another's store.
 */
export class EventStore {
  private readonly insert: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly updateFields: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;
  private readonly updateExdates: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    // A brand-new series has no exceptions yet, so `recurrence_exdates` is the
    // literal empty list here rather than a bound value: it is not an input.
    // `reminder_offsets` IS one, so it is bound like every other field.
    this.insert = db.prepare(
      `INSERT INTO events
         (id, profile_id, title, description, start_at, end_at, all_day,
          location, category, created_at, updated_at, recurrence, recurrence_exdates,
          reminder_offsets, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM events
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY start_at, id`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM events
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateFields = db.prepare(
      `UPDATE events
         SET title = ?, description = ?, start_at = ?, end_at = ?,
             all_day = ?, location = ?, category = ?, recurrence = ?,
             recurrence_exdates = ?, reminder_offsets = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE events SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE events SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.updateExdates = db.prepare(
      `UPDATE events SET recurrence_exdates = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
  }

  /** Active events for this profile in chronological order (soft-deleted excluded). */
  listActive(): Event[] {
    const rows = this.selectActive.all(this.profileId) as EventRow[];
    return rows.map(toEvent);
  }

  /** Inserts an event, applying defaults, and returns the stored row (CAL-001). */
  create(input: CreateEventInput): Event {
    const title = validateTitle(input.title);
    const startAt = validateRequiredDate(input.startAt, "startAt");
    const endAt = validateNullableDate(input.endAt, "endAt");
    validateRange(startAt, endAt);
    const allDay = input.allDay ?? false;
    const description = normalizeOptional(input.description);
    const location = normalizeOptional(input.location);
    const category = normalizeOptional(input.category);
    const recurrence = validateRecurrence(input.recurrence);
    assertRecurrenceAnchor(recurrence, startAt);
    const reminderOffsets = validateReminderOffsets(input.reminderOffsets);
    const now = new Date().toISOString();
    const id = uuidv7();

    this.insert.run(
      id, this.profileId, title, description, startAt, endAt,
      allDay ? 1 : 0, location, category, now, now, serializeRecurrence(recurrence),
      JSON.stringify(reminderOffsets),
    );

    return {
      id, profileId: this.profileId, title, description, startAt, endAt,
      allDay, location, category, createdAt: now, updatedAt: now,
      recurrence, recurrenceExdates: [], reminderOffsets,
    };
  }

  /** Applies a partial field patch to an active event (CAL-001 editing). */
  update(id: string, fields: UpdateEventFields): Event {
    const current = this.requireActive(id);
    return this.writeFields(current, {
      title: fields.title !== undefined ? validateTitle(fields.title) : current.title,
      startAt:
        fields.startAt !== undefined
          ? validateRequiredDate(fields.startAt, "startAt")
          : current.startAt,
      endAt:
        fields.endAt !== undefined ? validateNullableDate(fields.endAt, "endAt") : current.endAt,
      allDay: fields.allDay !== undefined ? fields.allDay : current.allDay,
      location:
        fields.location !== undefined ? normalizeOptional(fields.location) : current.location,
      description:
        fields.description !== undefined
          ? normalizeOptional(fields.description)
          : current.description,
      category:
        fields.category !== undefined ? normalizeOptional(fields.category) : current.category,
      recurrence:
        fields.recurrence !== undefined
          ? validateRecurrence(fields.recurrence)
          : current.recurrence,
      reminderOffsets:
        fields.reminderOffsets !== undefined
          ? validateReminderOffsets(fields.reminderOffsets)
          : current.reminderOffsets,
    });
  }

  /**
   * Excepts one occurrence date from a series (ADR-024) — the user deleted that
   * occurrence, or detached it into its own event. Idempotent: adding a date
   * the series already excepts returns the row untouched, without restamping
   * `updated_at`. Stored ascending, so the column is canonical however the
   * exceptions were made.
   */
  addRecurrenceExdate(id: string, date: string, now: string): Event {
    const current = this.requireRecurring(id);
    const exdate = validateExdate(date, "date");
    if (current.recurrenceExdates.includes(exdate)) return current;

    // Day keys are fixed-width, so a plain lexicographic sort IS chronological.
    const recurrenceExdates = [...current.recurrenceExdates, exdate].sort();
    this.updateExdates.run(JSON.stringify(recurrenceExdates), now, id, this.profileId);
    return { ...current, recurrenceExdates, updatedAt: now };
  }

  /**
   * The "this and future occurrences" primitive (ADR-024): truncates the master
   * so its last occurrence is the day before `occurrenceDate`, and returns it.
   * Creating the new master that carries the edited fields forward is the
   * caller's job, through the ordinary `create` — this method only truncates,
   * so a split, a "delete from here on", and a "change the rule from here on"
   * are all the same one operation plus whatever the caller does next.
   *
   * Splitting at the master's own first occurrence would leave an `until`
   * before its start: a series with no occurrences at all. Rather than leave
   * that unreachable row in the table (invisible to the calendar, visible to
   * every list), the master is soft-deleted instead, and the returned row is
   * that master as it now stands — rule untouched, since there is no truncated
   * `until` to report.
   */
  splitRecurrence(id: string, occurrenceDate: string, now: string): Event {
    const current = this.requireRecurring(id);
    const occurrence = validateExdate(occurrenceDate, "occurrenceDate");
    const until = shiftDayKey(occurrence, -1);

    if (until < anchorDayOf(current.startAt)) {
      this.markDeleted.run(now, now, id, this.profileId);
      return { ...current, updatedAt: now };
    }

    return this.writeFields(
      current,
      {
        ...ownFields(current),
        recurrence: { freq: current.recurrence.freq, end: { kind: "until", date: until } },
      },
      now,
    );
  }

  /** Soft-deletes an active event (PRD delete semantics; reversible via `restore`). */
  softDelete(id: string): void {
    const now = new Date().toISOString();
    const { changes } = this.markDeleted.run(now, now, id, this.profileId);
    if (changes === 0) {
      throw new EventNotFoundError(`No active event "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted event (undo of a delete). */
  restore(id: string): void {
    const now = new Date().toISOString();
    const { changes } = this.markRestored.run(now, id, this.profileId);
    if (changes === 0) {
      throw new EventNotFoundError(`No deleted event "${id}" to restore in this profile.`);
    }
  }

  /** Reads an active event in this profile or throws — enforces scope + existence. */
  private requireActive(id: string): Event {
    const row = this.selectActiveById.get(id, this.profileId) as EventRow | undefined;
    if (!row) {
      throw new EventNotFoundError(`No active event "${id}" in this profile.`);
    }
    return toEvent(row);
  }

  /** As `requireActive`, plus the series precondition both operations above share — narrowing `recurrence` to non-null for the caller, without a cast. */
  private requireRecurring(id: string): Event & { recurrence: RecurrenceRule } {
    const current = this.requireActive(id);
    const { recurrence } = current;
    if (recurrence === null) {
      throw new EventValidationError(`Event "${id}" carries no recurrence rule.`);
    }
    return { ...current, recurrence };
  }

  /**
   * Writes a fully-resolved field set, re-checking the start/end range against
   * the merged pair — the single place that upholds the end ≥ start invariant the
   * schema deliberately does not CHECK, so a patch that moves only one endpoint is
   * still validated against the other. The rule's anchor is checked against the
   * same merged pair, for the same reason: moving a master's start off a real
   * calendar day would strand its whole series.
   *
   * `at` defaults to the wall clock; `splitRecurrence` passes its caller's `now`.
   */
  private writeFields(
    current: Event,
    next: Required<UpdateEventFields>,
    at: string = new Date().toISOString(),
  ): Event {
    validateRange(next.startAt, next.endAt);
    assertRecurrenceAnchor(next.recurrence, next.startAt);
    // Exceptions belong to a series: clearing the rule clears them with it.
    const recurrenceExdates = next.recurrence === null ? [] : current.recurrenceExdates;

    this.updateFields.run(
      next.title, next.description, next.startAt, next.endAt,
      next.allDay ? 1 : 0, next.location, next.category,
      serializeRecurrence(next.recurrence), JSON.stringify(recurrenceExdates),
      JSON.stringify(next.reminderOffsets), at,
      current.id, this.profileId,
    );

    return { ...current, ...next, recurrenceExdates, updatedAt: at };
  }
}

function toEvent(row: EventRow): Event {
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    description: row.description,
    startAt: row.start_at,
    endAt: row.end_at,
    allDay: row.all_day === 1,
    location: row.location,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recurrence: parseStoredRecurrence(row.recurrence, row.id),
    recurrenceExdates: parseStoredExdates(row.recurrence_exdates, row.id),
    reminderOffsets: parseStoredOffsets(row.reminder_offsets, row.id),
  };
}

/** An event's own patchable fields as they currently stand — the base every full-row write starts from. */
function ownFields(event: Event): Required<UpdateEventFields> {
  return {
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    allDay: event.allDay,
    location: event.location,
    description: event.description,
    category: event.category,
    recurrence: event.recurrence,
    reminderOffsets: event.reminderOffsets,
  };
}

/**
 * The day a series phases from: the date part of `startAt`, exactly as
 * `calendarItems.ts` derives an event's day key. The app's timestamps are
 * zone-less wall-clock strings, so re-interpreting them through `Date` would
 * put a master's anchor on a different day than the one the calendar draws it
 * on — the two must agree or the expansion lands beside the event.
 */
function anchorDayOf(startAt: string): string {
  return startAt.slice(0, 10);
}

function validateTitle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new EventValidationError("Event title must not be empty.");
  }
  return trimmed;
}

function validateRequiredDate(value: string, field: string): string {
  if (!ISO_8601.test(value)) {
    throw new EventValidationError(`"${field}" must be an ISO-8601 date or date-time.`);
  }
  return value;
}

function validateNullableDate(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (!ISO_8601.test(value)) {
    throw new EventValidationError(`"${field}" must be an ISO-8601 date or date-time.`);
  }
  return value;
}

/** Rejects a finite range whose end precedes its start; an open-ended event is always valid. */
function validateRange(startAt: string, endAt: string | null): void {
  if (endAt !== null && new Date(endAt).getTime() < new Date(startAt).getTime()) {
    throw new EventValidationError("Event end must not be before its start.");
  }
}

/**
 * Structural validation of a recurrence rule from an untrusted caller
 * (SEC-EL-02), returning the canonical form the column stores. An already-typed
 * rule object goes through the validator too: the type says nothing about an
 * interval of 0 or an empty weekday list.
 */
function validateRecurrence(value: RecurrenceRule | null | undefined): RecurrenceRule | null {
  if (value === undefined || value === null) return null;
  const rule = validateRecurrenceRule(value);
  if (rule === null) {
    throw new EventValidationError('"recurrence" is not a valid recurrence rule.');
  }
  return rule;
}

/** A master phases from its own start day, so that day has to exist — `2026-02-30T09:00Z` parses but is nothing to anchor on. */
function assertRecurrenceAnchor(rule: RecurrenceRule | null, startAt: string): void {
  if (rule === null) return;
  if (!isValidDayKey(anchorDayOf(startAt))) {
    throw new EventValidationError(
      `A recurring event's startAt must begin with a real calendar date (got "${startAt}").`,
    );
  }
}

/**
 * A reminder ladder from an untrusted caller (SEC-EL-02), returning the
 * canonical form the column stores: ascending, so the ladder reads the same
 * however the user entered it. Absent means "no reminders", the default. The
 * rules — unique, whole minutes, 0..`MAX_EVENT_REMINDER_MINUTES`, at most
 * `MAX_EVENT_REMINDERS` of them — cannot be a SQL CHECK over a JSON column, so
 * this function is the gate (with `parseImportArchive`'s twin covering the one
 * other way a value reaches the column).
 */
function validateReminderOffsets(value: readonly number[] | undefined): number[] {
  if (value === undefined) return [];
  if (value.length > MAX_EVENT_REMINDERS) {
    throw new EventValidationError(
      `An event may carry at most ${MAX_EVENT_REMINDERS} reminders (got ${value.length}).`,
    );
  }
  for (const offset of value) {
    if (!isReminderOffset(offset)) {
      throw new EventValidationError(
        `"reminderOffsets" must hold whole minutes between 0 and ${MAX_EVENT_REMINDER_MINUTES} (got ${offset}).`,
      );
    }
  }
  if (new Set(value).size !== value.length) {
    throw new EventValidationError('"reminderOffsets" must not repeat the same lead time.');
  }
  return [...value].sort((a, b) => a - b);
}

/** One lead time's own shape — shared by the write validator above and the stored-value reader below. */
function isReminderOffset(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_EVENT_REMINDER_MINUTES;
}

/** An exception (or split point) names one occurrence DATE — a bare, real calendar day, never an instant. */
function validateExdate(value: string, field: string): string {
  if (!isValidDayKey(value)) {
    throw new EventValidationError(`"${field}" must be a bare calendar date (got "${value}").`);
  }
  return value;
}

function serializeRecurrence(rule: RecurrenceRule | null): string | null {
  return rule === null ? null : serializeRecurrenceRule(rule);
}

/**
 * Reads the stored rule back. This store writes only `serializeRecurrenceRule`
 * output, so anything that fails to validate is corruption (a hand-edited file,
 * a bad restore) rather than input to be coerced — reading it as `null` would
 * silently turn a user's series into a one-off, so it throws naming the row.
 */
function parseStoredRecurrence(text: string | null, id: string): RecurrenceRule | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const rule = validateRecurrenceRule(parsed);
  if (rule === null) {
    throw new EventValidationError(
      `Event "${id}" carries a stored recurrence rule that is not valid.`,
    );
  }
  return rule;
}

/** Same reasoning as `parseStoredRecurrence`: only this store writes the column, and it writes an array of day keys. */
function parseStoredExdates(text: string, id: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const invalid = new EventValidationError(
    `Event "${id}" carries stored recurrence exceptions that are not a list of calendar dates.`,
  );
  if (!Array.isArray(parsed)) throw invalid;
  const entries: readonly unknown[] = parsed;
  const exdates: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || !isValidDayKey(entry)) throw invalid;
    exdates.push(entry);
  }
  return exdates;
}

/** Same reasoning as `parseStoredExdates`: only this store writes the column, and it writes a list of whole-minute lead times. */
function parseStoredOffsets(text: string, id: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const invalid = new EventValidationError(
    `Event "${id}" carries stored reminder offsets that are not a list of whole-minute lead times.`,
  );
  if (!Array.isArray(parsed)) throw invalid;
  const entries: readonly unknown[] = parsed;
  const offsets: number[] = [];
  for (const entry of entries) {
    if (typeof entry !== "number" || !isReminderOffset(entry)) throw invalid;
    offsets.push(entry);
  }
  return offsets;
}

/** Normalizes an optional string: absent/empty/whitespace-only collapses to null. */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim().length === 0) return null;
  return value;
}
