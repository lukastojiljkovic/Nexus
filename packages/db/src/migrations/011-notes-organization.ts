import type { Migration } from "./migrations.js";

/**
 * Migration 11 — the NOTE module's organization layer (ADR-012 / PRD 09
 * NOTE-002; NOTE slice a3a). The Yjs substrate (migration 010) stores what a
 * note *is*; this migration stores how notes are *organized*: nested folders,
 * many-to-many tags, plus per-note foldering and pinning.
 *
 * `note_folders` is a self-referential tree: `parent_id` points at another
 * folder (NULL at the root) and cascades on the parent's delete, so deleting a
 * subtree at the SQL level removes its descendants — the store's `deleteFolder`
 * deliberately promotes children first so nothing is lost through the UI.
 * `color` is a nullable design-token key (validated to a closed palette in the
 * store, not the schema, so the palette can evolve without a migration).
 * `note_folders_profile_parent` covers the hot path — "this profile's folders
 * under this parent".
 *
 * `note_tags` are per-profile labels; `note_tags_profile_name` makes a tag name
 * unique within a profile (the store's get-or-create relies on it). `note_tag_links`
 * is the many-to-many join, keyed `(note_id, tag_id)` so a note carries a tag at
 * most once; both sides cascade, so deleting a note or a tag prunes its links.
 * `note_tag_links_tag` covers the reverse lookup — "which notes carry this tag".
 *
 * Two columns join `notes`: `folder_id` (which folder the note lives in, NULL at
 * the root, SET NULL when its folder row is deleted directly) and `pinned` (a
 * 0/1 flag the active-notes list orders first). Foldering and pinning are
 * organizational, not content edits, so the store never bumps `updated_at` for
 * them.
 */
export const migration011: Migration = {
  version: 11,
  up(db) {
    db.exec(`
      CREATE TABLE note_folders (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        parent_id   TEXT REFERENCES note_folders(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        color       TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX note_folders_profile_parent ON note_folders (profile_id, parent_id);

      CREATE TABLE note_tags (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      CREATE UNIQUE INDEX note_tags_profile_name ON note_tags (profile_id, name);

      CREATE TABLE note_tag_links (
        note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        tag_id   TEXT NOT NULL REFERENCES note_tags(id) ON DELETE CASCADE,
        PRIMARY KEY (note_id, tag_id)
      );
      CREATE INDEX note_tag_links_tag ON note_tag_links (tag_id);

      ALTER TABLE notes ADD COLUMN folder_id TEXT REFERENCES note_folders(id) ON DELETE SET NULL;
      ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));
    `);
  },
};
