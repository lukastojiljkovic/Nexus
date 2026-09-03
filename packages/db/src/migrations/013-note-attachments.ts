import type { Migration } from "./migrations.js";

/**
 * Migration 13 — the NOTE module's attachment index (ADR-014 / NOTE-003;
 * NOTE slice 003-a). The attachment's *bytes* never live in SQLite: they sit
 * content-addressed on disk at `<userData>/attachments/<sha256[0:2]>/<sha256>`
 * (fanout by the hash's first two hex characters), owned entirely by
 * `apps/desktop/src/main/attachments.ts`. This table is the *index* over
 * those blobs — one row per attachment a note carries, joining a note to a
 * hash plus the metadata the UI and the `nx-blob:` protocol need without
 * touching the filesystem.
 *
 * `note_attachments_note` covers the hot path — "this note's attachments". The
 * ORDER is `NoteAttachmentStore`'s `ORDER BY created_at ASC, id ASC`, not the
 * id: this line used to say a UUIDv7 sorts by insertion order, and migration 058
 * corrected that — the timestamp in its high bits is a MILLISECOND and the bytes
 * below it are CSPRNG, so five files dropped at once sort randomly against each
 * other. The store never relied on the id; only this sentence did.
 *
 * `note_attachments_sha` covers the reverse lookup the blob store's GC and the
 * `nx-blob:` protocol both need — "how many/which rows reference this hash" —
 * deliberately NOT scoped by profile: the blob store is content-addressed across
 * the whole database (two notes, even in different profiles, that attach
 * byte-identical files share one on-disk blob), so a reference count must see
 * every row, not just one profile's. `NoteAttachmentStore` documents this same
 * choice on `refCount`/`mimeForHash`.
 *
 * `size_bytes` is denormalized from the blob (rather than re-derived with a
 * filesystem stat on every read) and CHECKed positive — a zero-byte
 * "attachment" is not a real file. `mime` is the main-process sniffed type at
 * attach time (SEC-FILE-02), never the renderer's claim, and is what the
 * `nx-blob:` protocol serves back as `Content-Type`.
 *
 * Deleting a note cascades its attachment rows; the store never SQL-deletes
 * an attachment on a note *soft*-delete (`notes.deleted_at`) — only a hard
 * delete at the SQL level removes the row, mirroring every other NOTE child
 * table's cascade-on-hard-delete-only convention.
 */
export const migration013: Migration = {
  version: 13,
  up(db) {
    db.exec(`
      CREATE TABLE note_attachments (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX note_attachments_note ON note_attachments (note_id);
      CREATE INDEX note_attachments_sha ON note_attachments (sha256);
    `);
  },
};
