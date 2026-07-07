import type Database from "better-sqlite3-multiple-ciphers";
import { ExamNotFoundError, ExamValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** Closed exam-type domain (migration 005 CHECK): written, oral, or colloquium. */
export type ExamType = "pismeni" | "usmeni" | "kolokvijum";

/** Exam types in the order the UI offers them; the UI maps them onto a select field. */
export const EXAM_TYPES: readonly ExamType[] = ["pismeni", "usmeni", "kolokvijum"];

/** An exam as the store returns it: camelCase keys, its subject carried by id. */
export interface Exam {
  id: string;
  profileId: string;
  subjectId: string;
  examType: ExamType;
  examDate: string;
  scope: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating an exam; `subjectId`, `examType` and `examDate` are required (STUDY). */
export interface CreateExamInput {
  subjectId: string;
  examType: ExamType;
  examDate: string;
  scope?: string | null;
}

/**
 * A partial patch of an exam's own fields. An omitted key is left untouched; an
 * explicit `null` clears `scope`. Soft delete/restore have their own methods.
 */
export interface UpdateExamFields {
  subjectId?: string;
  examType?: ExamType;
  examDate?: string;
  scope?: string | null;
}

interface ExamRow {
  id: string;
  profile_id: string;
  subject_id: string;
  exam_type: ExamType;
  exam_date: string;
  scope: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, profile_id, subject_id, exam_type, exam_date, scope, created_at, updated_at";

/** Accepts ISO-8601 date ('2026-07-08') or date-time, optionally zoned (PRD §7). */
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Exam persistence for a single profile, over prepared, parameterized statements
 * (SEC-API-03; every value is bound, never interpolated). Mirrors `EventStore`:
 * construct one per profile, reuse it. Inputs are revalidated here because the
 * renderer is untrusted (SEC-EL-02), and every statement is scoped by `profile_id`
 * so one profile's exams are invisible to another's store — including the subject
 * foreign key, which must resolve to a non-deleted subject in THIS profile.
 */
export class ExamStore {
  private readonly insert: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly selectSubject: Database.Statement;
  private readonly updateFields: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO exams
         (id, profile_id, subject_id, exam_type, exam_date, scope,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM exams
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY exam_date, id`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM exams
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectSubject = db.prepare(
      `SELECT id FROM subjects
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateFields = db.prepare(
      `UPDATE exams
         SET subject_id = ?, exam_type = ?, exam_date = ?, scope = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE exams SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE exams SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
  }

  /** Active exams for this profile ordered by exam date (soft-deleted excluded). */
  listActive(): Exam[] {
    const rows = this.selectActive.all(this.profileId) as ExamRow[];
    return rows.map(toExam);
  }

  /** Inserts an exam against a subject in this profile, and returns the stored row (STUDY). */
  create(input: CreateExamInput): Exam {
    const examType = validateExamType(input.examType);
    const examDate = validateExamDate(input.examDate);
    const scope = normalizeOptional(input.scope);
    const subjectId = this.resolveSubject(input.subjectId);
    const now = new Date().toISOString();
    const id = uuidv7();

    this.insert.run(id, this.profileId, subjectId, examType, examDate, scope, now, now);

    return {
      id, profileId: this.profileId, subjectId, examType, examDate, scope,
      createdAt: now, updatedAt: now,
    };
  }

  /** Applies a partial field patch to an active exam (STUDY editing). */
  update(id: string, fields: UpdateExamFields): Exam {
    const current = this.requireActive(id);
    return this.writeFields(current, {
      subjectId:
        fields.subjectId !== undefined
          ? this.resolveSubject(fields.subjectId)
          : current.subjectId,
      examType:
        fields.examType !== undefined ? validateExamType(fields.examType) : current.examType,
      examDate:
        fields.examDate !== undefined ? validateExamDate(fields.examDate) : current.examDate,
      scope: fields.scope !== undefined ? normalizeOptional(fields.scope) : current.scope,
    });
  }

  /** Soft-deletes an active exam (reversible via `restore`). */
  softDelete(id: string): void {
    const now = new Date().toISOString();
    const { changes } = this.markDeleted.run(now, now, id, this.profileId);
    if (changes === 0) {
      throw new ExamNotFoundError(`No active exam "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted exam (undo of a delete). */
  restore(id: string): void {
    const now = new Date().toISOString();
    const { changes } = this.markRestored.run(now, id, this.profileId);
    if (changes === 0) {
      throw new ExamNotFoundError(`No deleted exam "${id}" to restore in this profile.`);
    }
  }

  /** Reads an active exam in this profile or throws — enforces scope + existence. */
  private requireActive(id: string): Exam {
    const row = this.selectActiveById.get(id, this.profileId) as ExamRow | undefined;
    if (!row) {
      throw new ExamNotFoundError(`No active exam "${id}" in this profile.`);
    }
    return toExam(row);
  }

  /** Writes a fully-resolved field set and returns the merged exam. */
  private writeFields(current: Exam, next: Required<UpdateExamFields>): Exam {
    const now = new Date().toISOString();

    this.updateFields.run(
      next.subjectId, next.examType, next.examDate, next.scope, now,
      current.id, this.profileId,
    );

    return { ...current, ...next, updatedAt: now };
  }

  /**
   * Validates a subject id references a non-deleted subject in this profile
   * (mirrors `TaskStore.resolveParent`): the same-profile scope on the lookup is
   * what stops an exam from pointing at another profile's subject.
   */
  private resolveSubject(subjectId: string): string {
    const subject = this.selectSubject.get(subjectId, this.profileId);
    if (!subject) {
      throw new ExamValidationError(
        `subjectId "${subjectId}" does not reference a subject in this profile.`,
      );
    }
    return subjectId;
  }
}

function toExam(row: ExamRow): Exam {
  return {
    id: row.id,
    profileId: row.profile_id,
    subjectId: row.subject_id,
    examType: row.exam_type,
    examDate: row.exam_date,
    scope: row.scope,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateExamType(value: ExamType): ExamType {
  if (!(EXAM_TYPES as readonly string[]).includes(value)) {
    throw new ExamValidationError(`"${value}" is not a known exam type.`);
  }
  return value;
}

function validateExamDate(value: string): string {
  if (!ISO_8601.test(value)) {
    throw new ExamValidationError('"examDate" must be an ISO-8601 date.');
  }
  return value;
}

/** Normalizes an optional string: absent/empty/whitespace-only collapses to null. */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim().length === 0) return null;
  return value;
}
