import type Database from "better-sqlite3-multiple-ciphers";
import { EventNotFoundError, EventValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

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
}

/**
 * A partial patch of an event's own fields. An omitted key is left untouched; an
 * explicit `null` clears a nullable field. Soft delete/restore have their own
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
}

const COLUMNS =
  "id, profile_id, title, description, start_at, end_at, all_day, " +
  "location, category, created_at, updated_at";

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

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO events
         (id, profile_id, title, description, start_at, end_at, all_day,
          location, category, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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
             all_day = ?, location = ?, category = ?, updated_at = ?
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
    const now = new Date().toISOString();
    const id = uuidv7();

    this.insert.run(
      id, this.profileId, title, description, startAt, endAt,
      allDay ? 1 : 0, location, category, now, now,
    );

    return {
      id, profileId: this.profileId, title, description, startAt, endAt,
      allDay, location, category, createdAt: now, updatedAt: now,
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
    });
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

  /**
   * Writes a fully-resolved field set, re-checking the start/end range against
   * the merged pair — the single place that upholds the end ≥ start invariant the
   * schema deliberately does not CHECK, so a patch that moves only one endpoint is
   * still validated against the other.
   */
  private writeFields(current: Event, next: Required<UpdateEventFields>): Event {
    validateRange(next.startAt, next.endAt);
    const now = new Date().toISOString();

    this.updateFields.run(
      next.title, next.description, next.startAt, next.endAt,
      next.allDay ? 1 : 0, next.location, next.category, now,
      current.id, this.profileId,
    );

    return { ...current, ...next, updatedAt: now };
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
  };
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

/** Normalizes an optional string: absent/empty/whitespace-only collapses to null. */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim().length === 0) return null;
  return value;
}
