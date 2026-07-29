import type Database from "better-sqlite3-multiple-ciphers";
import { PersonNotFoundError, PersonValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** Closed person-kind domain (migration 020's CHECK); the UI maps each key onto its own Serbian label and glyph. */
export const PERSON_KINDS = ["birthday", "anniversary"] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];

/**
 * A person as the store returns it: camelCase keys. `month`/`day` are the
 * yearless recurring fact (migration 020 explains why they are not a date
 * string); `year` is the separately-known birth/start year, null when the user
 * never supplied one.
 */
export interface Person {
  id: string;
  profileId: string;
  name: string;
  kind: PersonKind;
  month: number;
  day: number;
  year: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating a person; only `year` and `note` are optional (CAL-007). */
export interface CreatePersonInput {
  name: string;
  kind: PersonKind;
  month: number;
  day: number;
  year?: number | null;
  note?: string | null;
}

/**
 * A partial patch of a person's own fields. An omitted key is left untouched;
 * an explicit `null` clears `year`/`note`. Soft delete/restore have their own
 * methods.
 */
export interface UpdatePersonFields {
  name?: string;
  kind?: PersonKind;
  month?: number;
  day?: number;
  year?: number | null;
  note?: string | null;
}

interface PersonRow {
  id: string;
  profile_id: string;
  name: string;
  kind: PersonKind;
  month: number;
  day: number;
  year: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, profile_id, name, kind, month, day, year, note, created_at, updated_at";

/**
 * The window a birth/anniversary year must fall in. A bound, not a prophecy:
 * it exists to catch a typo'd `19858` or a stray `0`, not to model history —
 * nobody in this app's address book was born before 1900, and a date beyond
 * 2100 is a slip rather than a plan.
 */
const MIN_PERSON_YEAR = 1900;
const MAX_PERSON_YEAR = 2100;

/**
 * A leap year, used only to answer "is this (month, day) a real day in SOME
 * year?". Validating against a leap year is what makes 29 February acceptable
 * — leap-day birthdays exist, and `birthdayOccurrencesInRange` (`@nexus/core`)
 * celebrates them on the 28th in the years that lack a 29th.
 */
const LEAP_YEAR = 2024;

/** Accepts a full ISO-8601 date-time (the `now` every mutating method takes) — mirrors noteStore.ts / noteOrgStore.ts / noteTemplateStore.ts. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * People persistence for a single profile, over prepared, parameterized
 * statements (SEC-API-03; every value is bound, never interpolated). Mirrors
 * `EventStore`: construct one per profile, reuse it. Inputs are revalidated
 * here because the renderer is untrusted (SEC-EL-02), and every statement is
 * scoped by `profile_id` so one profile's people are invisible to another's
 * store.
 *
 * Every mutating method takes `now` from its caller rather than reading the
 * clock — the idiom every store added since `NoteStore` follows (`FocusStore`,
 * `PlanStore`, `CardStore`, `NoteOrgStore`, `NoteTemplateStore`,
 * `RestoreStore`), which is what lets a caller stamp one instant across
 * several writes and a test assert an exact timestamp.
 */
export class PeopleStore {
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
      `INSERT INTO people
         (id, profile_id, name, kind, month, day, year, note, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM people
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY name, id`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM people
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateFields = db.prepare(
      `UPDATE people
         SET name = ?, kind = ?, month = ?, day = ?, year = ?, note = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE people SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE people SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
  }

  /**
   * Active people for this profile ordered by `name` — SQLite's default binary
   * collation, which does not tailor Serbian Latin script correctly; the
   * renderer re-sorts with `Intl.Collator(["sr-Latn","sr"])`, the house pattern
   * every other alphabetical list follows (`NoteOrgStore.listFolders`,
   * `NoteTemplateStore.list`). Soft-deleted rows are excluded.
   */
  listActive(): Person[] {
    const rows = this.selectActive.all(this.profileId) as PersonRow[];
    return rows.map(toPerson);
  }

  /** Inserts a person, applying defaults, and returns the stored row (CAL-007). */
  create(input: CreatePersonInput, now: string): Person {
    const at = validateDateTime(now, "now");
    const name = validateName(input.name);
    const kind = validateKind(input.kind);
    const { month, day } = validateMonthDay(input.month, input.day);
    const year = validateYear(input.year);
    const note = normalizeOptional(input.note);
    const id = uuidv7();

    this.insert.run(id, this.profileId, name, kind, month, day, year, note, at, at);

    return { id, profileId: this.profileId, name, kind, month, day, year, note, createdAt: at, updatedAt: at };
  }

  /** Applies a partial field patch to an active person (CAL-007 editing). */
  update(id: string, fields: UpdatePersonFields, now: string): Person {
    const at = validateDateTime(now, "now");
    const current = this.requireActive(id);
    const next: Required<UpdatePersonFields> = {
      name: fields.name !== undefined ? validateName(fields.name) : current.name,
      kind: fields.kind !== undefined ? validateKind(fields.kind) : current.kind,
      // Both halves are re-checked as a PAIR below, never one at a time: a
      // patch that moves only the month onto February would otherwise leave a
      // stored 30 February behind the day it never touched.
      month: fields.month !== undefined ? fields.month : current.month,
      day: fields.day !== undefined ? fields.day : current.day,
      year: fields.year !== undefined ? validateYear(fields.year) : current.year,
      note: fields.note !== undefined ? normalizeOptional(fields.note) : current.note,
    };
    const { month, day } = validateMonthDay(next.month, next.day);

    this.updateFields.run(
      next.name, next.kind, month, day, next.year, next.note, at, id, this.profileId,
    );

    return { ...current, ...next, month, day, updatedAt: at };
  }

  /** Soft-deletes an active person (reversible via `restore`). */
  softDelete(id: string, now: string): void {
    const at = validateDateTime(now, "now");
    const { changes } = this.markDeleted.run(at, at, id, this.profileId);
    if (changes === 0) {
      throw new PersonNotFoundError(`No active person "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted person (undo of a delete). */
  restore(id: string, now: string): void {
    const at = validateDateTime(now, "now");
    const { changes } = this.markRestored.run(at, id, this.profileId);
    if (changes === 0) {
      throw new PersonNotFoundError(`No deleted person "${id}" to restore in this profile.`);
    }
  }

  /** Reads an active person in this profile or throws — enforces scope + existence. */
  private requireActive(id: string): Person {
    const row = this.selectActiveById.get(id, this.profileId) as PersonRow | undefined;
    if (!row) {
      throw new PersonNotFoundError(`No active person "${id}" in this profile.`);
    }
    return toPerson(row);
  }
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    kind: row.kind,
    month: row.month,
    day: row.day,
    year: row.year,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new PersonValidationError("A person's name must not be empty.");
  }
  return trimmed;
}

function validateKind(value: PersonKind): PersonKind {
  if (!(PERSON_KINDS as readonly string[]).includes(value)) {
    throw new PersonValidationError(`"${value}" is not a known person kind.`);
  }
  return value;
}

/**
 * The pair check migration 020's CHECKs cannot express: `(2, 30)` and
 * `(4, 31)` each satisfy both per-column ranges and are still no calendar day.
 * Validated against a leap year, so `(2, 29)` passes — see `LEAP_YEAR`.
 */
function validateMonthDay(month: number, day: number): { month: number; day: number } {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new PersonValidationError(`"month" must be a whole number between 1 and 12 (got ${month}).`);
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new PersonValidationError(`"day" must be a whole number between 1 and 31 (got ${day}).`);
  }
  const probe = new Date(Date.UTC(LEAP_YEAR, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new PersonValidationError(`${day}/${month} is not a calendar day in any year.`);
  }
  return { month, day };
}

function validateYear(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value < MIN_PERSON_YEAR || value > MAX_PERSON_YEAR) {
    throw new PersonValidationError(
      `"year" must be a whole year between ${MIN_PERSON_YEAR} and ${MAX_PERSON_YEAR} (got ${value}).`,
    );
  }
  return value;
}

function validateDateTime(value: string, field: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new PersonValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}

/** Normalizes an optional string: absent/empty/whitespace-only collapses to null. */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim().length === 0) return null;
  return value;
}
