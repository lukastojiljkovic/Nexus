import type Database from "better-sqlite3-multiple-ciphers";
import { FocusNotFoundError, FocusValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** A completed focus (study-timer) session as the store returns it: camelCase keys. */
export interface FocusSession {
  id: string;
  profileId: string;
  subjectId: string;
  startedAt: string;
  endedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when persisting a completed session; all three are required. */
export interface CreateFocusSessionInput {
  subjectId: string;
  startedAt: string;
  endedAt: string;
}

interface FocusSessionRow {
  id: string;
  profile_id: string;
  subject_id: string;
  started_at: string;
  ended_at: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "id, profile_id, subject_id, started_at, ended_at, created_at, updated_at";

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts a full ISO-8601 date-time (the `now`/`startedAt`/`endedAt` every method takes). */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Focus-session persistence for a single profile, over prepared, parameterized
 * statements (SEC-API-03; every value is bound, never interpolated). Mirrors
 * `PlanStore`/`ExamStore`: construct one per profile, reuse it. Inputs are
 * revalidated here because the renderer is untrusted (SEC-EL-02), and every
 * statement is scoped by `profile_id` — including the subject foreign key,
 * which must resolve to a non-deleted subject in THIS profile.
 *
 * Only completed sessions are ever persisted here, via `create`. A *running*
 * session is deliberately never a row — it lives as main-process runtime state
 * (see the desktop main process), so a crash loses the in-progress timer
 * honestly instead of this store fabricating a duration.
 */
export class FocusStore {
  private readonly insert: Database.Statement;
  private readonly selectSubjectActive: Database.Statement;
  private readonly selectInRange: Database.Statement;
  private readonly selectAllActive: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO focus_sessions
         (id, profile_id, subject_id, started_at, ended_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectSubjectActive = db.prepare(
      `SELECT id FROM subjects WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectInRange = db.prepare(
      `SELECT ${COLUMNS} FROM focus_sessions
       WHERE profile_id = ? AND deleted_at IS NULL
         AND date(started_at, 'localtime') BETWEEN ? AND ?
       ORDER BY started_at DESC, id DESC`,
    );
    this.selectAllActive = db.prepare(
      `SELECT ${COLUMNS} FROM focus_sessions
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY started_at, id`,
    );
    this.markDeleted = db.prepare(
      `UPDATE focus_sessions SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE focus_sessions SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
  }

  /**
   * Persists a completed session against an active subject of this profile.
   * Rejects a malformed `now`/`startedAt`/`endedAt`, an `endedAt` that does not
   * strictly follow `startedAt`, and a `subjectId` that does not resolve to an
   * active subject in this profile.
   */
  create(input: CreateFocusSessionInput, now: string): FocusSession {
    const validNow = validateDateTime(now, "now");
    const startedAt = validateDateTime(input.startedAt, "startedAt");
    const endedAt = validateDateTime(input.endedAt, "endedAt");
    if (endedAt <= startedAt) {
      throw new FocusValidationError('"endedAt" must be strictly after "startedAt".');
    }
    const subjectId = this.resolveSubject(input.subjectId);
    const id = uuidv7();

    this.insert.run(id, this.profileId, subjectId, startedAt, endedAt, validNow, validNow);

    return {
      id,
      profileId: this.profileId,
      subjectId,
      startedAt,
      endedAt,
      createdAt: validNow,
      updatedAt: validNow,
    };
  }

  /**
   * Active sessions of this profile whose local start day falls in
   * `[fromDate, toDate]`, newest first (started_at then id, both descending).
   */
  listRange(fromDate: string, toDate: string): FocusSession[] {
    const validFrom = validateBareDate(fromDate, "fromDate");
    const validTo = validateBareDate(toDate, "toDate");
    const rows = this.selectInRange.all(this.profileId, validFrom, validTo) as FocusSessionRow[];
    return rows.map(toFocusSession);
  }

  /**
   * Every active session of this profile, no date bounds (IMEX full export),
   * ordered by start time then id — unlike `listRange`, never filtered to a
   * local-day window.
   */
  listActive(): FocusSession[] {
    const rows = this.selectAllActive.all(this.profileId) as FocusSessionRow[];
    return rows.map(toFocusSession);
  }

  /** Soft-deletes an active session (reversible via `restore`). */
  softDelete(id: string, now: string): void {
    const validNow = validateDateTime(now, "now");
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new FocusNotFoundError(`No active focus session "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted session (undo of a delete). */
  restore(id: string, now: string): void {
    const validNow = validateDateTime(now, "now");
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new FocusNotFoundError(`No deleted focus session "${id}" to restore in this profile.`);
    }
  }

  /**
   * Validates a subject id references a non-deleted subject in this profile
   * (mirrors `ExamStore.resolveSubject`): the same-profile scope on the lookup
   * is what stops a session from pointing at another profile's subject.
   * Public so the desktop main process can check a subject before recording a
   * running timer, without duplicating this query.
   */
  resolveSubject(subjectId: string): string {
    const subject = this.selectSubjectActive.get(subjectId, this.profileId);
    if (!subject) {
      throw new FocusValidationError(
        `subjectId "${subjectId}" does not reference a subject in this profile.`,
      );
    }
    return subjectId;
  }
}

function toFocusSession(row: FocusSessionRow): FocusSession {
  return {
    id: row.id,
    profileId: row.profile_id,
    subjectId: row.subject_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateBareDate(value: string, field: string): string {
  if (!BARE_DATE.test(value)) {
    throw new FocusValidationError(`"${field}" must be a bare YYYY-MM-DD date.`);
  }
  return value;
}

function validateDateTime(value: string, field: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new FocusValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}
