import type { Migration } from "./migrations.js";

/**
 * Migration 10 — the NOTE module's Yjs document substrate (ADR-012 / ADR-001;
 * NOTE slice a1).
 *
 * Notes are CRDT documents, not row-shaped records: the source of truth is a
 * binary Yjs update log plus a periodically merged snapshot, and the store
 * stays CRDT-agnostic — opaque blobs with transactional guarantees; the merge
 * semantics live in the caller (`mergeNoteState`, `@nexus/core`), the same
 * pure-logic/storage seam IMEX uses.
 *
 * `notes` carries only metadata: a denormalized `title` (the renderer derives
 * it from the first non-empty line; it exists so listing never decodes a
 * document) and the house soft-delete/timestamps idiom. `notes_profile_active`
 * covers the hot path — "this profile's active notes, newest updated first".
 *
 * `note_updates` is the append-only update log, keyed `(note_id, seq)` with a
 * per-note monotonic `seq` the store assigns — never the renderer. Rows are
 * scoped through their note (`requireActive` first, the `document_renewals`
 * pattern), so they carry no `profile_id` of their own.
 *
 * `note_snapshots` holds at most one merged snapshot per note plus the
 * plaintext derived from it (for future SRCH indexing) and `covered_seq`, the
 * highest update seq the snapshot already contains: `load` replays only
 * updates past it, and compaction deletes the ones at or below it in the same
 * transaction. Version history (NOTE-008) later turns this single row into a
 * retention policy — the shape (keyed by note, `covered_seq`) anticipates that.
 */
export const migration010: Migration = {
  version: 10,
  up(db) {
    db.exec(`
      CREATE TABLE notes (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        title       TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT
      );

      -- The hot path is "this profile's active notes, newest updated first".
      CREATE INDEX notes_profile_active
        ON notes (profile_id, updated_at, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE note_updates (
        note_id      TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        seq          INTEGER NOT NULL,
        update_blob  BLOB NOT NULL,
        created_at   TEXT NOT NULL,
        PRIMARY KEY (note_id, seq)
      );

      CREATE TABLE note_snapshots (
        note_id      TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
        snapshot     BLOB NOT NULL,
        plaintext    TEXT NOT NULL,
        covered_seq  INTEGER NOT NULL,
        updated_at   TEXT NOT NULL
      );
    `);
  },
};
