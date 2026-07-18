import type Database from "better-sqlite3-multiple-ciphers";
import { NoteAttachmentNotFoundError, NoteAttachmentValidationError, NoteNotFoundError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** The wire/store cap on one attachment's byte size (SEC-FILE-02); mirrored as `NOTE_ATTACHMENT_MAX_BYTES` on the desktop app's IPC contract — the same limit, declared on both sides so neither imports the other. */
export const MAX_NOTE_ATTACHMENT_BYTES = 52_428_800; // 50 MB

/** A note attachment's index row as the store returns it — never the bytes themselves (those live on disk, content-addressed by `sha256`; see `apps/desktop/src/main/attachments.ts`). */
export interface NoteAttachment {
  id: string;
  noteId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

/** Fields for a new attachment row; `mime`/`sizeBytes`/`sha256` are all derived by main from the blob itself, never from the renderer's claim (SEC-FILE-02). */
export interface AddNoteAttachmentInput {
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

interface NoteAttachmentRow {
  id: string;
  note_id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

const COLUMNS = "id, note_id, file_name, mime, size_bytes, sha256, created_at";

const MAX_FILE_NAME_LENGTH = 255;
const MAX_MIME_LENGTH = 100;
const MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Accepts a full ISO-8601 date-time (the `now` every mutating method takes) — mirrors noteStore.ts / noteOrgStore.ts. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Persistence for the NOTE module's attachment index (ADR-014 / NOTE-003,
 * slice 003-a). Mirrors `NoteOrgStore`: construct one per profile, reuse it,
 * over prepared, parameterized statements (SEC-API-03), every value bound,
 * never interpolated. `add`/`list`/`remove` gate on the note being active in
 * THIS profile (`requireActiveNote`, the same check `NoteOrgStore.attachTag`
 * uses) — unknown, soft-deleted, or cross-profile all surface as
 * `NoteNotFoundError`. Inputs are revalidated here because the renderer is
 * untrusted (SEC-EL-02): `fileName`/`mime`/`sizeBytes`/`sha256` are all
 * re-checked even though main validates too.
 *
 * The attachment's bytes never live here — only this index row. `main` owns
 * the content-addressed blob store (`apps/desktop/src/main/attachments.ts`)
 * and calls `refCount`/`mimeForHash` to decide whether a blob is still
 * referenced and what to serve it as. Both are DELIBERATELY profile-agnostic
 * (no `profile_id` in their query, unlike every other method here): the blob
 * store is content-addressed across the WHOLE database — two notes that
 * happen to attach byte-identical files, even across two different profiles,
 * share one on-disk blob — so garbage collection must count every reference
 * regardless of which profile holds it, and the `nx-blob:` protocol's serve
 * gate only ever needs to know "is this hash a registered attachment at all".
 * Local-profile confidentiality of attachment content is not a v1 boundary;
 * AUTH revisits this once profiles carry real access control.
 *
 * A note's *soft* delete never removes its attachment rows (mirroring every
 * other NOTE child table) — `refCount` is unchanged by it, and `list` works
 * again once the note is restored. Only a hard delete at the SQL level
 * (`notes` row removed) cascades the rows away.
 */
export class NoteAttachmentStore {
  private readonly selectActiveNoteById: Database.Statement;
  private readonly insertAttachment: Database.Statement;
  private readonly selectByNote: Database.Statement;
  private readonly selectOneByNoteAndId: Database.Statement;
  private readonly deleteAttachment: Database.Statement;
  private readonly countBySha: Database.Statement;
  private readonly selectMimeBySha: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectActiveNoteById = db.prepare(
      `SELECT id FROM notes WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.insertAttachment = db.prepare(
      `INSERT INTO note_attachments (id, note_id, file_name, mime, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectByNote = db.prepare(
      `SELECT ${COLUMNS} FROM note_attachments WHERE note_id = ? ORDER BY created_at ASC, id ASC`,
    );
    this.selectOneByNoteAndId = db.prepare(
      `SELECT ${COLUMNS} FROM note_attachments WHERE id = ? AND note_id = ?`,
    );
    this.deleteAttachment = db.prepare(
      `DELETE FROM note_attachments WHERE id = ? AND note_id = ?`,
    );
    // Deliberately NOT scoped by profile — see the class doc comment.
    this.countBySha = db.prepare(
      `SELECT count(*) AS n FROM note_attachments WHERE sha256 = ?`,
    );
    this.selectMimeBySha = db.prepare(
      `SELECT mime FROM note_attachments WHERE sha256 = ? LIMIT 1`,
    );
  }

  /** Adds an attachment row to an active note in this profile, validating every field (SEC-EL-02). */
  add(noteId: string, input: AddNoteAttachmentInput, now: string): NoteAttachment {
    const validNow = validateDateTime(now, "now");
    this.requireActiveNote(noteId);
    const fileName = validateFileName(input.fileName);
    const mime = validateMime(input.mime);
    const sizeBytes = validateSizeBytes(input.sizeBytes);
    const sha256 = validateSha256(input.sha256);

    const id = uuidv7();
    this.insertAttachment.run(id, noteId, fileName, mime, sizeBytes, sha256, validNow);
    return { id, noteId, fileName, mime, sizeBytes, sha256, createdAt: validNow };
  }

  /** An active note's attachments, oldest first (id tiebreak — UUIDv7 sorts chronologically). */
  list(noteId: string): NoteAttachment[] {
    this.requireActiveNote(noteId);
    const rows = this.selectByNote.all(noteId) as NoteAttachmentRow[];
    return rows.map(toNoteAttachment);
  }

  /**
   * Removes one attachment row from an active note in this profile and
   * returns it — the caller (main) uses the returned `sha256` to decide
   * whether the on-disk blob is now orphaned via `refCount`. An attachment id
   * that does not resolve under THIS note — unknown entirely, or a real row
   * that belongs to a different note — throws `NoteAttachmentNotFoundError`.
   */
  remove(noteId: string, attachmentId: string): NoteAttachment {
    this.requireActiveNote(noteId);
    const row = this.selectOneByNoteAndId.get(attachmentId, noteId) as
      | NoteAttachmentRow
      | undefined;
    if (!row) {
      throw new NoteAttachmentNotFoundError(`No attachment "${attachmentId}" on note "${noteId}".`);
    }
    this.deleteAttachment.run(attachmentId, noteId);
    return toNoteAttachment(row);
  }

  /** How many attachment rows (across every note, every profile) reference this hash — deliberately profile-agnostic; see the class doc comment. */
  refCount(sha256: string): number {
    const { n } = this.countBySha.get(sha256) as { n: number };
    return n;
  }

  /** Any row's stored mime for this hash (across profiles), or `null` if no attachment references it — deliberately profile-agnostic; see the class doc comment. */
  mimeForHash(sha256: string): string | null {
    const row = this.selectMimeBySha.get(sha256) as { mime: string } | undefined;
    return row ? row.mime : null;
  }

  /** Confirms an active note exists in this profile or throws — the gate every method above goes through. */
  private requireActiveNote(id: string): void {
    const row = this.selectActiveNoteById.get(id, this.profileId);
    if (!row) {
      throw new NoteNotFoundError(`No active note "${id}" in this profile.`);
    }
  }
}

function toNoteAttachment(row: NoteAttachmentRow): NoteAttachment {
  return {
    id: row.id,
    noteId: row.note_id,
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
    throw new NoteAttachmentValidationError("A file name must not be empty.");
  }
  if (trimmed.length > MAX_FILE_NAME_LENGTH) {
    throw new NoteAttachmentValidationError(
      `A file name must not exceed ${MAX_FILE_NAME_LENGTH} characters after trimming.`,
    );
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new NoteAttachmentValidationError("A file name must not contain path separators.");
  }
  return trimmed;
}

function validateMime(value: string): string {
  if (value.length > MAX_MIME_LENGTH || !MIME_PATTERN.test(value)) {
    throw new NoteAttachmentValidationError(
      `"mime" must be a valid MIME type of at most ${MAX_MIME_LENGTH} characters.`,
    );
  }
  return value;
}

function validateSizeBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_NOTE_ATTACHMENT_BYTES) {
    throw new NoteAttachmentValidationError(
      `"sizeBytes" must be a positive integer of at most ${MAX_NOTE_ATTACHMENT_BYTES} bytes.`,
    );
  }
  return value;
}

function validateSha256(value: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new NoteAttachmentValidationError('"sha256" must be a 64-character lowercase hex string.');
  }
  return value;
}

function validateDateTime(value: string, field: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new NoteAttachmentValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}
