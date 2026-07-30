import type Database from "better-sqlite3-multiple-ciphers";
import { TaskAttachmentNotFoundError, TaskAttachmentValidationError, TaskNotFoundError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** The wire/store cap on one attachment's byte size (SEC-FILE-02). `MAX_NOTE_ATTACHMENT_BYTES`' own value, copied rather than reinvented: it is the same blob store on the other side, so a second limit would only mean two answers to "how big may a file be". */
export const MAX_TASK_ATTACHMENT_BYTES = 52_428_800; // 50 MB

/** A task attachment's index row as the store returns it — never the bytes themselves (those live on disk, content-addressed by `sha256`; see `apps/desktop/src/main/attachments.ts`). */
export interface TaskAttachment {
  id: string;
  taskId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

/** Fields for a new attachment row; `mime`/`sizeBytes`/`sha256` are all derived by main from the blob itself, never from the renderer's claim (SEC-FILE-02). */
export interface AddTaskAttachmentInput {
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

/** How many attachments one live task carries — the per-row count chip's whole payload. Mirrors `DeckCounts`' shape (one flat row per entity, never a map), so the wire carries something structured-clone-plain. */
export interface TaskAttachmentCount {
  taskId: string;
  count: number;
}

interface TaskAttachmentRow {
  id: string;
  task_id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

interface TaskAttachmentCountRow {
  task_id: string;
  n: number;
}

const COLUMNS = "id, task_id, file_name, mime, size_bytes, sha256, created_at";

const MAX_FILE_NAME_LENGTH = 255;
const MAX_MIME_LENGTH = 100;
const MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Accepts a full ISO-8601 date-time (the `now` every mutating method takes) — mirrors noteAttachmentStore.ts / taskTagStore.ts. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Persistence for the TASK module's attachment index (migration 024). This is
 * `NoteAttachmentStore` applied to tasks — method for method, rule for rule,
 * deliberately — because it is the same feature on a different entity, and a
 * second set of semantics for "a file hanging off a record" would only mean two
 * things for the UI to explain. Construct one per profile, reuse it, over
 * prepared, parameterized statements (SEC-API-03), every value bound, never
 * interpolated. `add`/`list`/`remove` gate on the task being active in THIS
 * profile (`requireActiveTask`, the same check `TaskTagStore.attachTag` uses) —
 * unknown, soft-deleted, or cross-profile all surface as `TaskNotFoundError`.
 * Inputs are revalidated here because the renderer is untrusted (SEC-EL-02).
 *
 * The attachment's bytes never live here — only this index row. `main` owns the
 * content-addressed blob store (`apps/desktop/src/main/attachments.ts`), which
 * is the SAME store notes attach into: two records that happen to hold
 * byte-identical files share one on-disk blob whichever module they belong to.
 * That is why `refCount`/`mimeForHash` are DELIBERATELY profile-agnostic (no
 * `profile_id` in their query, unlike every other method here) — and why main
 * must SUM this store's `refCount` with `NoteAttachmentStore`'s before deciding
 * a blob is orphaned: a file still named by the other table is not garbage.
 *
 * A task's *soft* delete never removes its attachment rows (mirroring
 * `task_tag_links`) — `refCount` is unchanged by it, and `list` works again
 * once the task is restored, which is exactly what lets the undo bar bring a
 * deleted task back still carrying its files. Only a hard delete at the SQL
 * level (`tasks` row removed) cascades the rows away.
 */
export class TaskAttachmentStore {
  private readonly selectActiveTaskById: Database.Statement;
  private readonly insertAttachment: Database.Statement;
  private readonly selectByTask: Database.Statement;
  private readonly selectOneByTaskAndId: Database.Statement;
  private readonly deleteAttachment: Database.Statement;
  private readonly countBySha: Database.Statement;
  private readonly selectMimeBySha: Database.Statement;
  private readonly selectCountsByTask: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectActiveTaskById = db.prepare(
      `SELECT id FROM tasks WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.insertAttachment = db.prepare(
      `INSERT INTO task_attachments (id, task_id, file_name, mime, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectByTask = db.prepare(
      `SELECT ${COLUMNS} FROM task_attachments WHERE task_id = ? ORDER BY created_at ASC, id ASC`,
    );
    this.selectOneByTaskAndId = db.prepare(
      `SELECT ${COLUMNS} FROM task_attachments WHERE id = ? AND task_id = ?`,
    );
    this.deleteAttachment = db.prepare(
      `DELETE FROM task_attachments WHERE id = ? AND task_id = ?`,
    );
    // Deliberately NOT scoped by profile — see the class doc comment.
    this.countBySha = db.prepare(
      `SELECT count(*) AS n FROM task_attachments WHERE sha256 = ?`,
    );
    this.selectMimeBySha = db.prepare(
      `SELECT mime FROM task_attachments WHERE sha256 = ? LIMIT 1`,
    );
    // Scoped through the task, exactly as `TaskTagStore.listTagLinks` is: a
    // soft-deleted task's rows still exist (see the class doc comment) but its
    // count belongs to no row the page draws.
    this.selectCountsByTask = db.prepare(
      `SELECT ta.task_id, count(*) AS n
       FROM task_attachments ta
       JOIN tasks t ON t.id = ta.task_id
       WHERE t.profile_id = ? AND t.deleted_at IS NULL
       GROUP BY ta.task_id
       ORDER BY ta.task_id`,
    );
  }

  /** Adds an attachment row to an active task in this profile, validating every field (SEC-EL-02). */
  add(taskId: string, input: AddTaskAttachmentInput, now: string): TaskAttachment {
    const validNow = validateDateTime(now, "now");
    this.requireActiveTask(taskId);
    const fileName = validateFileName(input.fileName);
    const mime = validateMime(input.mime);
    const sizeBytes = validateSizeBytes(input.sizeBytes);
    const sha256 = validateSha256(input.sha256);

    const id = uuidv7();
    this.insertAttachment.run(id, taskId, fileName, mime, sizeBytes, sha256, validNow);
    return { id, taskId, fileName, mime, sizeBytes, sha256, createdAt: validNow };
  }

  /** An active task's attachments, oldest first (id tiebreak — UUIDv7 sorts chronologically). */
  list(taskId: string): TaskAttachment[] {
    this.requireActiveTask(taskId);
    const rows = this.selectByTask.all(taskId) as TaskAttachmentRow[];
    return rows.map(toTaskAttachment);
  }

  /**
   * Removes one attachment row from an active task in this profile and returns
   * it — the caller (main) uses the returned `sha256` to decide whether the
   * on-disk blob is now orphaned. An attachment id that does not resolve under
   * THIS task — unknown entirely, or a real row that belongs to a different
   * task — throws `TaskAttachmentNotFoundError`.
   */
  remove(taskId: string, attachmentId: string): TaskAttachment {
    this.requireActiveTask(taskId);
    const row = this.selectOneByTaskAndId.get(attachmentId, taskId) as
      | TaskAttachmentRow
      | undefined;
    if (!row) {
      throw new TaskAttachmentNotFoundError(`No attachment "${attachmentId}" on task "${taskId}".`);
    }
    this.deleteAttachment.run(attachmentId, taskId);
    return toTaskAttachment(row);
  }

  /** How many attachment rows (across every task, every profile) reference this hash — deliberately profile-agnostic; see the class doc comment. */
  refCount(sha256: string): number {
    const { n } = this.countBySha.get(sha256) as { n: number };
    return n;
  }

  /** Any row's stored mime for this hash (across profiles), or `null` if no task attachment references it — deliberately profile-agnostic; see the class doc comment. */
  mimeForHash(sha256: string): string | null {
    const row = this.selectMimeBySha.get(sha256) as { mime: string } | undefined;
    return row ? row.mime : null;
  }

  /**
   * One entry per LIVE task of this profile that carries at least one
   * attachment. A task with none is simply absent rather than reported as zero:
   * the count chip is drawn only where there is something to count, so a row of
   * zeroes for every task in the profile would be payload nothing reads.
   */
  countsByTask(): TaskAttachmentCount[] {
    const rows = this.selectCountsByTask.all(this.profileId) as TaskAttachmentCountRow[];
    return rows.map((row) => ({ taskId: row.task_id, count: row.n }));
  }

  /** Confirms an active task exists in this profile or throws — the gate every method above goes through. */
  private requireActiveTask(id: string): void {
    const row = this.selectActiveTaskById.get(id, this.profileId);
    if (!row) {
      throw new TaskNotFoundError(`No active task "${id}" in this profile.`);
    }
  }
}

function toTaskAttachment(row: TaskAttachmentRow): TaskAttachment {
  return {
    id: row.id,
    taskId: row.task_id,
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
    throw new TaskAttachmentValidationError("A file name must not be empty.");
  }
  if (trimmed.length > MAX_FILE_NAME_LENGTH) {
    throw new TaskAttachmentValidationError(
      `A file name must not exceed ${MAX_FILE_NAME_LENGTH} characters after trimming.`,
    );
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new TaskAttachmentValidationError("A file name must not contain path separators.");
  }
  return trimmed;
}

function validateMime(value: string): string {
  if (value.length > MAX_MIME_LENGTH || !MIME_PATTERN.test(value)) {
    throw new TaskAttachmentValidationError(
      `"mime" must be a valid MIME type of at most ${MAX_MIME_LENGTH} characters.`,
    );
  }
  return value;
}

function validateSizeBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TASK_ATTACHMENT_BYTES) {
    throw new TaskAttachmentValidationError(
      `"sizeBytes" must be a positive integer of at most ${MAX_TASK_ATTACHMENT_BYTES} bytes.`,
    );
  }
  return value;
}

function validateSha256(value: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new TaskAttachmentValidationError('"sha256" must be a 64-character lowercase hex string.');
  }
  return value;
}

function validateDateTime(value: string, field: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new TaskAttachmentValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}
