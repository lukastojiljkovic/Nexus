import type { Migration } from "./migrations.js";

/**
 * Migration 96 - the LIBRARY module's reading goals and loans (migration 072 is
 * the module's storage; this adds two tables beside it).
 *
 * **A goal is one row per scope, and the scope is a unique index.** A goal
 * covers every kind (`kind` NULL) or one kind. A plain `UNIQUE (profile_id,
 * kind)` would let a profile hold two "every kind" goals, because NULLs never
 * compare equal in a unique index; `IFNULL(kind, '')` folds the NULL scope to a
 * value the index can see, so "one goal per scope" holds for all four scopes.
 * The target carries the same bounds `isLibraryGoalTarget` checks, as the
 * backstop the store's own message sits in front of.
 *
 * **A loan is a child of the item, and the history is the table.** Every
 * lending is a row, and a return sets `returned_on` on that row; nothing is
 * deleted. `library_loans_active` is PARTIAL (`returned_on IS NULL`) so a work
 * can have at most one active loan while any number of returned ones remain as
 * history. The item reference cascades, like the passes' and thoughts', because
 * a loan of a work that no longer exists has nothing to say.
 *
 * **Days are bare local dates validated in the store**, as `culture_visits` and
 * the library's own passes are: `2026-02-30` is a value `length()` cannot judge,
 * so the real-calendar-day rule has one home (`isLibraryDay`).
 *
 * **Neither table is in the library's archive yet, and that is a gap.** The
 * archive is a versioned value (`LIBRARY_EXPORT_VERSION`), and a field added to
 * it changes what an older build refuses to read, so it needs a version bump
 * with a reader for the old one. Until that lands, a restore that replaces the
 * library drops the loans with the works they belong to, and keeps the goals.
 */
export const migration096: Migration = {
  version: 96,
  up(db) {
    db.exec(`
      CREATE TABLE library_goals (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        kind        TEXT CHECK (kind IS NULL OR kind IN ('book', 'film', 'series')),
        target      INTEGER NOT NULL
                      CHECK (typeof(target) = 'integer' AND target >= 1 AND target <= 1000),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE UNIQUE INDEX library_goals_scope
        ON library_goals (profile_id, IFNULL(kind, ''));

      CREATE TABLE library_loans (
        id          TEXT PRIMARY KEY,
        item_id     TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
        to_name     TEXT NOT NULL CHECK (length(to_name) > 0 AND length(to_name) <= 120),
        lent_on     TEXT NOT NULL,
        due_on      TEXT,
        returned_on TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE INDEX library_loans_item ON library_loans (item_id, lent_on, id);

      CREATE UNIQUE INDEX library_loans_active
        ON library_loans (item_id) WHERE returned_on IS NULL;
    `);
  },
};
