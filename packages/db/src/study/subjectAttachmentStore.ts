import type Database from "better-sqlite3-multiple-ciphers";
import {
  SubjectAttachmentNotFoundError,
  SubjectAttachmentValidationError,
  SubjectNotFoundError,
} from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** The wire/store cap on one material's byte size (SEC-FILE-02). `MAX_TASK_ATTACHMENT_BYTES`' own value, copied rather than reinvented: it is the same blob store on the other side, so a second limit would only mean two answers to "how big may a file be". */
export const MAX_SUBJECT_ATTACHMENT_BYTES = 52_428_800; // 50 MB

/** A subject material's index row as the store returns it — never the bytes themselves (those live on disk, content-addressed by `sha256`; see `apps/desktop/src/main/attachments.ts`). */
export interface SubjectAttachment {
  id: string;
  subjectId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

/** Fields for a new material row; `mime`/`sizeBytes`/`sha256` are all derived by main from the blob itself, never from the renderer's claim (SEC-FILE-02). */
export interface AddSubjectAttachmentInput {
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

interface SubjectAttachmentRow {
  id: string;
  subject_id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

const COLUMNS = "id, subject_id, file_name, mime, size_bytes, sha256, created_at";

const MAX_FILE_NAME_LENGTH = 255;
const MAX_MIME_LENGTH = 100;
const MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Accepts a full ISO-8601 date-time (the `now` every mutating method takes) — mirrors taskAttachmentStore.ts / noteAttachmentStore.ts. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Persistence for the STUDY module's material index (migration 035, STUDY-001).
 * This is `TaskAttachmentStore` applied to subjects — method for method, rule
 * for rule, deliberately — because it is the same feature on a different
 * entity, and a second set of semantics for "a file hanging off a record" would
 * only mean two things for the UI to explain. Construct one per profile, reuse
 * it, over prepared, parameterized statements (SEC-API-03), every value bound,
 * never interpolated. `add`/`list`/`remove` gate on the subject being active in
 * THIS profile (`requireActiveSubject`) — unknown, soft-deleted, or
 * cross-profile all surface as `SubjectNotFoundError`. Inputs are revalidated
 * here because the renderer is untrusted (SEC-EL-02).
 *
 * The material's bytes never live here — only this index row. `main` owns the
 * content-addressed blob store (`apps/desktop/src/main/attachments.ts`), which
 * is the SAME store notes, tasks and the dashboard background use: two records
 * that happen to hold byte-identical files share one on-disk blob whichever
 * module they belong to. That is why `refCount`/`mimeForHash` are DELIBERATELY
 * profile-agnostic (no `profile_id` in their query, unlike every other method
 * here) — and why main must SUM this store's `refCount` with the other three
 * before deciding a blob is orphaned: a file still named by another table is not
 * garbage.
 *
 * A subject's *soft* delete never removes its material rows (mirroring
 * `task_attachments` under a soft-deleted task) — `refCount` is unchanged by it,
 * and `list` works again once the subject is restored, which is exactly what
 * lets the undo bar bring a deleted subject back still carrying its files. Only
 * a hard delete at the SQL level (`subjects` row removed) cascades the rows
 * away.
 *
 * **The mirror of `TaskAttachmentStore` stops short of one method.** A
 * `countsBySubject` was copied over with the rest and was never called outside
 * its own tests — `countsByTask` exists because the task LIST draws a paperclip
 * badge per row, and STUDY's subject cards draw no such badge. Copying a method
 * because its twin has one is how a store grows a surface nobody asked for, so
 * this one is gone until a page actually wants it.
 */
export class SubjectAttachmentStore {
  private readonly selectActiveSubjectById: Database.Statement;
  private readonly insertAttachment: Database.Statement;
  private readonly selectBySubject: Database.Statement;
  private readonly selectOneBySubjectAndId: Database.Statement;
  private readonly deleteAttachment: Database.Statement;
  private readonly countBySha: Database.Statement;
  private readonly selectMimeBySha: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectActiveSubjectById = db.prepare(
      `SELECT id FROM subjects WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.insertAttachment = db.prepare(
      `INSERT INTO subject_attachments (id, subject_id, file_name, mime, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectBySubject = db.prepare(
      `SELECT ${COLUMNS} FROM subject_attachments WHERE subject_id = ? ORDER BY created_at ASC, id ASC`,
    );
    this.selectOneBySubjectAndId = db.prepare(
      `SELECT ${COLUMNS} FROM subject_attachments WHERE id = ? AND subject_id = ?`,
    );
    this.deleteAttachment = db.prepare(
      `DELETE FROM subject_attachments WHERE id = ? AND subject_id = ?`,
    );
    // Deliberately NOT scoped by profile — see the class doc comment.
    this.countBySha = db.prepare(
      `SELECT count(*) AS n FROM subject_attachments WHERE sha256 = ?`,
    );
    this.selectMimeBySha = db.prepare(
      `SELECT mime FROM subject_attachments WHERE sha256 = ? LIMIT 1`,
    );
  }

  /** Adds a material row to an active subject in this profile, validating every field (SEC-EL-02). */
  add(subjectId: string, input: AddSubjectAttachmentInput, now: string): SubjectAttachment {
    const validNow = validateDateTime(now, "now");
    this.requireActiveSubject(subjectId);
    const fileName = validateFileName(input.fileName);
    const mime = validateMime(input.mime);
    const sizeBytes = validateSizeBytes(input.sizeBytes);
    const sha256 = validateSha256(input.sha256);

    const id = uuidv7();
    this.insertAttachment.run(id, subjectId, fileName, mime, sizeBytes, sha256, validNow);
    return { id, subjectId, fileName, mime, sizeBytes, sha256, createdAt: validNow };
  }

  /** An active subject's materials, oldest first (id tiebreak — UUIDv7 sorts chronologically). */
  list(subjectId: string): SubjectAttachment[] {
    this.requireActiveSubject(subjectId);
    const rows = this.selectBySubject.all(subjectId) as SubjectAttachmentRow[];
    return rows.map(toSubjectAttachment);
  }

  /**
   * Removes one material row from an active subject in this profile and returns
   * it — the caller (main) uses the returned `sha256` to decide whether the
   * on-disk blob is now orphaned. A material id that does not resolve under THIS
   * subject — unknown entirely, or a real row that belongs to a different
   * subject — throws `SubjectAttachmentNotFoundError`.
   */
  remove(subjectId: string, attachmentId: string): SubjectAttachment {
    this.requireActiveSubject(subjectId);
    const row = this.selectOneBySubjectAndId.get(attachmentId, subjectId) as
      | SubjectAttachmentRow
      | undefined;
    if (!row) {
      throw new SubjectAttachmentNotFoundError(
        `No material "${attachmentId}" on subject "${subjectId}".`,
      );
    }
    this.deleteAttachment.run(attachmentId, subjectId);
    return toSubjectAttachment(row);
  }

  /** How many material rows (across every subject, every profile) reference this hash — deliberately profile-agnostic; see the class doc comment. */
  refCount(sha256: string): number {
    const { n } = this.countBySha.get(sha256) as { n: number };
    return n;
  }

  /** Any row's stored mime for this hash (across profiles), or `null` if no material references it — deliberately profile-agnostic; see the class doc comment. */
  mimeForHash(sha256: string): string | null {
    const row = this.selectMimeBySha.get(sha256) as { mime: string } | undefined;
    return row ? row.mime : null;
  }

  /** Confirms an active subject exists in this profile or throws — the gate every method above goes through. */
  private requireActiveSubject(id: string): void {
    const row = this.selectActiveSubjectById.get(id, this.profileId);
    if (!row) {
      throw new SubjectNotFoundError(`No active subject "${id}" in this profile.`);
    }
  }
}

function toSubjectAttachment(row: SubjectAttachmentRow): SubjectAttachment {
  return {
    id: row.id,
    subjectId: row.subject_id,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

function validateFileName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new SubjectAttachmentValidationError("A file name must not be empty.");
  }
  if (trimmed.length > MAX_FILE_NAME_LENGTH) {
    throw new SubjectAttachmentValidationError(
      `A file name must not exceed ${MAX_FILE_NAME_LENGTH} characters after trimming.`,
    );
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new SubjectAttachmentValidationError("A file name must not contain path separators.");
  }
  return trimmed;
}

function validateMime(value: string): string {
  if (value.length > MAX_MIME_LENGTH || !MIME_PATTERN.test(value)) {
    throw new SubjectAttachmentValidationError(
      `"mime" must be a valid MIME type of at most ${MAX_MIME_LENGTH} characters.`,
    );
  }
  return value;
}

function validateSizeBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_SUBJECT_ATTACHMENT_BYTES) {
    throw new SubjectAttachmentValidationError(
      `"sizeBytes" must be a positive integer of at most ${MAX_SUBJECT_ATTACHMENT_BYTES} bytes.`,
    );
  }
  return value;
}

function validateSha256(value: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new SubjectAttachmentValidationError(
      '"sha256" must be a 64-character lowercase hex string.',
    );
  }
  return value;
}

function validateDateTime(value: string, field: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new SubjectAttachmentValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}
