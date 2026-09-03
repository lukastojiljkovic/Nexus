import type { Migration } from "./migrations.js";

/**
 * Migration 24 — the TASK module's attachment index: migration 013's
 * `note_attachments` applied to tasks, table for table and constraint for
 * constraint, because it is the same feature on a different entity. A file
 * hanging off a task is the same thing as a file hanging off a note — one
 * content-addressed blob plus one index row — and a second shape for it would
 * only ask the reader to hold two in mind.
 *
 * The attachment's *bytes* never live in SQLite: they sit content-addressed in
 * the encrypted blob store (`<userData>/blobs`, ADR-019), owned entirely by
 * `apps/desktop/src/main/attachments.ts` — the SAME store notes use, not a
 * second one. That is why the two tables must be read together wherever a
 * blob's reference count is computed: a blob is orphaned only when NEITHER
 * table names it anymore, and a GC that consulted just one would delete a file
 * the other still points at.
 *
 * `task_attachments_task` covers the hot path — "this task's attachments". The
 * ORDER is `TaskAttachmentStore`'s `ORDER BY created_at ASC, id ASC`, not the
 * id — a UUIDv7 is chronological only to the millisecond, and below that it is
 * CSPRNG, so a multi-file drop sorts randomly within itself. See migration 058,
 * which corrected the same claim where it WAS load-bearing.
 *
 * `task_attachments_sha` covers the reverse lookup the blob store's GC and the
 * `nx-blob:` protocol both need — "how many/which rows reference this hash" —
 * deliberately NOT scoped by profile, exactly as `note_attachments_sha` is not:
 * the blob store is content-addressed across the whole database, so a reference
 * count must see every row.
 *
 * `size_bytes` is denormalized from the blob (rather than re-derived with a
 * filesystem stat on every read) and CHECKed positive — a zero-byte
 * "attachment" is not a real file. `mime` is the main-process sniffed type at
 * attach time (SEC-FILE-02), never a claim from the renderer, and is what the
 * `nx-blob:` protocol serves back as `Content-Type`.
 *
 * Deleting a task cascades its attachment rows; the store never SQL-deletes an
 * attachment on a task *soft* delete (`tasks.deleted_at`) — which is precisely
 * what lets the undo bar bring a deleted task back still carrying its files,
 * the same arrangement `task_tag_links` has.
 */
export const migration024: Migration = {
  version: 24,
  up(db) {
    db.exec(`
      CREATE TABLE task_attachments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX task_attachments_task ON task_attachments (task_id);
      CREATE INDEX task_attachments_sha ON task_attachments (sha256);
    `);
  },
};
