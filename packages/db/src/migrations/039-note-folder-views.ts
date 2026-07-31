import type { Migration } from "./migrations.js";

/**
 * Migration 39 — a note folder's default view (NOTE-002). ONE column on
 * `note_folders`: the shape the middle pane opens in when that folder is
 * selected, `list` (today's rows) or `cards` (the views engine's `CardsView`,
 * ADR-050).
 *
 * `'list'` as the constant default is the status quo made explicit: every
 * folder that existed before this migration opened as rows, so backfilling them
 * to anything else would be inventing a preference their owner never expressed.
 *
 * **Why `ALTER TABLE ADD COLUMN` and not a table rebuild.** `note_folders` is a
 * PARENT three times over — `note_folders.parent_id` (self), `notes.folder_id`,
 * and the partial unique index migration 028 hangs off it — and migration 038
 * settled at length what a `DROP TABLE` of a referenced parent costs: the
 * implicit DELETE fires foreign-key actions, `PRAGMA foreign_keys = OFF` is a
 * no-op inside the transaction `runMigrations` wraps each migration in, and the
 * deferred violations are still outstanding at COMMIT. None of that is worth
 * paying for one enum column, and it does not have to be: SQLite accepts a
 * CHECK on an ADDED column as long as the DEFAULT is constant, which is exactly
 * the shape migration 033 used for `cards.problem_steps` and 028 used for
 * `note_folders.is_capture_default` — the two nearest precedents, one of them on
 * this very table.
 *
 * The CHECK is attached here rather than left to the store for the reason 033
 * gives: an archive restore writes this column directly (`RestoreStore`,
 * `ForeignImportStore`), and a later migration will never be able to add one.
 * `NoteOrgStore.setFolderView` validates the same closed set on the way in, so a
 * bad value is a named store error rather than a raw SQLite constraint failure
 * — the CHECK is the floor, not the gate.
 *
 * The ROOT of the tree — "Sve beleške" and "Bez fascikle", the two selections
 * with no folder row — deliberately gets NO storage here. It has nothing to hang
 * a column on, and its view is a device preference (`notePrefs.ts`) rather than
 * profile content: a folder's view travels with the profile because the folder
 * does, while the root is a place in the UI, not a thing the profile contains.
 */
export const migration039: Migration = {
  version: 39,
  up(db) {
    db.exec(`
      ALTER TABLE note_folders ADD COLUMN default_view TEXT NOT NULL DEFAULT 'list'
        CHECK (default_view IN ('list', 'cards'));
    `);
  },
};
