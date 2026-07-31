import type { Migration } from "./migrations.js";

/**
 * Migration 14 — the NOTE module's version history checkpoints (ADR-015;
 * NOTE slice 008-a). `note_snapshots` (migration 010) is a mutable, hot,
 * single-row-per-note *cache* — every compaction overwrites it. Version
 * history needs the opposite lifecycle: immutable, append-only checkpoints
 * that survive compaction and can be browsed and restored, so it lives in
 * this sibling table rather than a retention flag bolted onto the cache row.
 *
 * A checkpoint is a full merged snapshot (`Y.encodeStateAsUpdate`, exactly
 * what compaction already computes) plus `covered_seq` — the highest
 * `note_updates.seq` it contains — and the note's `title` at capture time (so
 * the browse list never decodes a document just to label its rows).
 *
 * `PRIMARY KEY (note_id, covered_seq)` does double duty: it is the browse
 * index (`ORDER BY covered_seq DESC`) and the dedupe guard — two captures of
 * the same state (same `covered_seq`) collapse to one row via
 * `INSERT OR IGNORE`, so a spammed explicit checkpoint never grows the table
 * for zero new edits. Rows are scoped through their note (`requireActive`
 * first, the `note_updates`/`note_attachments` pattern), so they carry no
 * `profile_id` of their own; `ON DELETE CASCADE` clears a note's history when
 * the note itself is hard-deleted.
 *
 * Retention is enforced by `NoteStore`, not by this schema — the same division
 * of labour as compaction's threshold living in `main/notes.ts` rather than in
 * SQL. It is a tiered age schedule (`thinNoteVersions`, `@nexus/core`): every
 * checkpoint from the last day, one per hour for a week, one per day for a
 * month, one per week beyond, never the note's oldest, and never more than
 * `MAX_NOTE_VERSIONS` in total.
 */
export const migration014: Migration = {
  version: 14,
  up(db) {
    db.exec(`
      CREATE TABLE note_versions (
        note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        covered_seq INTEGER NOT NULL,
        snapshot    BLOB NOT NULL,
        title       TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        PRIMARY KEY (note_id, covered_seq)
      );
    `);
  },
};
