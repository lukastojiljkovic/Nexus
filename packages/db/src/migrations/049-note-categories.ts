import type { Migration } from "./migrations.js";

/**
 * Migration 49 — a note's CATEGORY (NOTE-002's last third). Migration 011 built
 * the other two axes: `note_folders` says *where* a note lives, `note_tags` say
 * *what it is about*. This one says what KIND of thing it is — sastanak, ideja,
 * dnevnik, recept — and the whole design is the discipline of keeping those
 * three apart.
 *
 * **Flat, deliberately.** `note_categories` is modelled on `note_folders`
 * wherever the two genuinely coincide (a per-profile row, a trimmed name, a
 * nullable `color` key from the same closed palette validated in the store, a
 * created/updated pair) and diverges on the one column that matters: there is no
 * `parent_id`. A hierarchy of categories IS a folder tree, and shipping a second
 * one is exactly the confusion this table exists to avoid. Nothing about the
 * schema invites one back.
 *
 * `note_categories_profile_name` is `note_tags_profile_name`'s rule, applied to
 * the same question: a name is unique within a profile, compared as SQLite
 * compares a BINARY TEXT column, so „Sastanak" and „sastanak" are two categories
 * exactly as they are two tags. The store's create/rename check the same rule
 * first so a collision is a named domain error rather than a raw constraint
 * failure, and this index is what makes that check binding rather than advisory.
 * It also covers the only read there is — "this profile's categories, by name".
 *
 * `notes.category_id` is NULLABLE and `ON DELETE SET NULL`: **a note has at most
 * one category, and deleting a category never deletes a note.** That action is
 * `notes.folder_id`'s from migration 011, chosen for the same reason and with
 * one difference in what the store has to do about it. `NoteOrgStore.deleteFolder`
 * promotes a folder's notes to its PARENT before removing the row, because SET
 * NULL would send them to the root instead of one level up. A flat table has no
 * parent to promote to — "uncategorized" is the only destination there is — so
 * SET NULL already says precisely the right thing, and the store's delete is a
 * plain scoped DELETE like `deleteTag`'s, leaning on this clause rather than
 * re-implementing it.
 *
 * No index on `notes.category_id`, matching `notes.folder_id`, which has none
 * either: the category filter narrows an already-fetched list client-side
 * (exactly as the tag filter does), so there is no query here for an index to
 * serve.
 */
export const migration049: Migration = {
  version: 49,
  up(db) {
    db.exec(`
      CREATE TABLE note_categories (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        color       TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE UNIQUE INDEX note_categories_profile_name ON note_categories (profile_id, name);

      ALTER TABLE notes ADD COLUMN category_id TEXT REFERENCES note_categories(id) ON DELETE SET NULL;
    `);
  },
};
