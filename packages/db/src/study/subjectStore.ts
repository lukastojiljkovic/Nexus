import type Database from "better-sqlite3-multiple-ciphers";
import { SubjectNotFoundError, SubjectValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** Closed subject-colour domain (migration 005 CHECK); the UI maps each key onto a design token. */
export type SubjectColor =
  | "jade"
  | "gold"
  | "bronze"
  | "burgundy"
  | "crimson"
  | "graphite";

/** Subject colours in the order the UI offers them; the palette itself is founder-open (STUDY). */
export const SUBJECT_COLORS: readonly SubjectColor[] = [
  "jade",
  "gold",
  "bronze",
  "burgundy",
  "crimson",
  "graphite",
];

/**
 * A subject as the store returns it: camelCase keys. `archived` is decoded from
 * the 0/1 column; an archived subject stays in the active list — it is hidden by
 * the UI, not deleted.
 */
export interface Subject {
  id: string;
  profileId: string;
  name: string;
  color: SubjectColor;
  semester: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating a subject; only `name` is required, colour defaults to 'jade' (STUDY). */
export interface CreateSubjectInput {
  name: string;
  color?: SubjectColor;
  semester?: string | null;
}

/**
 * A partial patch of a subject's own fields. An omitted key is left untouched; an
 * explicit `null` clears `semester`. Soft delete/restore have their own methods.
 */
export interface UpdateSubjectFields {
  name?: string;
  color?: SubjectColor;
  semester?: string | null;
  archived?: boolean;
}

interface SubjectRow {
  id: string;
  profile_id: string;
  name: string;
  color: SubjectColor;
  semester: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, profile_id, name, color, semester, archived, created_at, updated_at";

/**
 * Subject persistence for a single profile, over prepared, parameterized
 * statements (SEC-API-03; every value is bound, never interpolated). Mirrors
 * `EventStore`: construct one per profile, reuse it. Inputs are revalidated here
 * because the renderer is untrusted (SEC-EL-02), and every statement is scoped by
 * `profile_id` so one profile's subjects are invisible to another's store.
 */
export class SubjectStore {
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
      `INSERT INTO subjects
         (id, profile_id, name, color, semester, archived, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM subjects
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY name, id`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM subjects
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateFields = db.prepare(
      `UPDATE subjects
         SET name = ?, color = ?, semester = ?, archived = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE subjects SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE subjects SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
  }

  /** Active subjects for this profile ordered by name (archived included; soft-deleted excluded). */
  listActive(): Subject[] {
    const rows = this.selectActive.all(this.profileId) as SubjectRow[];
    return rows.map(toSubject);
  }

  /** Inserts a subject, applying defaults, and returns the stored row (STUDY). */
  create(input: CreateSubjectInput): Subject {
    const name = validateName(input.name);
    const color = validateColor(input.color ?? "jade");
    const semester = normalizeOptional(input.semester);
    const now = new Date().toISOString();
    const id = uuidv7();

    this.insert.run(id, this.profileId, name, color, semester, 0, now, now);

    return {
      id, profileId: this.profileId, name, color, semester,
      archived: false, createdAt: now, updatedAt: now,
    };
  }

  /** Applies a partial field patch to an active subject (STUDY editing). */
  update(id: string, fields: UpdateSubjectFields): Subject {
    const current = this.requireActive(id);
    return this.writeFields(current, {
      name: fields.name !== undefined ? validateName(fields.name) : current.name,
      color: fields.color !== undefined ? validateColor(fields.color) : current.color,
      semester:
        fields.semester !== undefined ? normalizeOptional(fields.semester) : current.semester,
      archived: fields.archived !== undefined ? fields.archived : current.archived,
    });
  }

  /** Soft-deletes an active subject (reversible via `restore`). */
  softDelete(id: string): void {
    const now = new Date().toISOString();
    const { changes } = this.markDeleted.run(now, now, id, this.profileId);
    if (changes === 0) {
      throw new SubjectNotFoundError(`No active subject "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted subject (undo of a delete). */
  restore(id: string): void {
    const now = new Date().toISOString();
    const { changes } = this.markRestored.run(now, id, this.profileId);
    if (changes === 0) {
      throw new SubjectNotFoundError(`No deleted subject "${id}" to restore in this profile.`);
    }
  }

  /** Reads an active subject in this profile or throws — enforces scope + existence. */
  private requireActive(id: string): Subject {
    const row = this.selectActiveById.get(id, this.profileId) as SubjectRow | undefined;
    if (!row) {
      throw new SubjectNotFoundError(`No active subject "${id}" in this profile.`);
    }
    return toSubject(row);
  }

  /** Writes a fully-resolved field set and returns the merged subject. */
  private writeFields(current: Subject, next: Required<UpdateSubjectFields>): Subject {
    const now = new Date().toISOString();

    this.updateFields.run(
      next.name, next.color, next.semester, next.archived ? 1 : 0, now,
      current.id, this.profileId,
    );

    return { ...current, ...next, updatedAt: now };
  }
}

function toSubject(row: SubjectRow): Subject {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    color: row.color,
    semester: row.semester,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new SubjectValidationError("Subject name must not be empty.");
  }
  return trimmed;
}

function validateColor(value: SubjectColor): SubjectColor {
  if (!(SUBJECT_COLORS as readonly string[]).includes(value)) {
    throw new SubjectValidationError(`"${value}" is not a known subject colour.`);
  }
  return value;
}

/** Normalizes an optional string: absent/empty/whitespace-only collapses to null. */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim().length === 0) return null;
  return value;
}
