import type { Migration } from "./migrations.js";

/**
 * Migration 23 — task tags: the per-profile label model migration 011 gave
 * notes (ADR-012 / NOTE-002), applied to the TASK module. Deliberately the
 * same two tables with the same constraints, because it is the same feature:
 * a label is a label whichever entity carries it, and a second design for it
 * would only ask the reader to hold two shapes in mind.
 *
 * `task_tags` are per-profile labels; `task_tags_profile_name` makes a tag name
 * unique within a profile (`TaskTagStore`'s get-or-create relies on it, exactly
 * as `NoteOrgStore`'s does on `note_tags_profile_name`). `task_tag_links` is the
 * many-to-many join, keyed `(task_id, tag_id)` so a task carries a tag at most
 * once; both sides cascade, so hard-deleting a task or a tag prunes its links.
 * `task_tag_links_tag` covers the reverse lookup — "which tasks carry this tag".
 *
 * A task's soft delete (`tasks.deleted_at`) leaves its links standing, which is
 * what lets `TaskStore.restore` bring a task back still tagged; only the store's
 * reads filter them out (`TaskTagStore.listTagLinks`), the same arrangement
 * `note_tag_links` has.
 *
 * Unlike `note_tags` this migration adds no column to `tasks`: tagging is
 * entirely the join's business, and unlike foldering there is nothing
 * single-valued to hang on the row itself.
 */
export const migration023: Migration = {
  version: 23,
  up(db) {
    db.exec(`
      CREATE TABLE task_tags (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      CREATE UNIQUE INDEX task_tags_profile_name ON task_tags (profile_id, name);

      CREATE TABLE task_tag_links (
        task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        tag_id   TEXT NOT NULL REFERENCES task_tags(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, tag_id)
      );
      CREATE INDEX task_tag_links_tag ON task_tag_links (tag_id);
    `);
  },
};
