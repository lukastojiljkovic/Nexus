import type { Migration } from "./migrations.js";

/**
 * Migration 43 — named dashboards (DASH-008 / ADR-055). One profile gains any
 * number of named widget boards („table“): a `dashboard_sets` row per named
 * board, a nullable `set_id` on every widget placement saying which board it
 * belongs to, and a nullable `active_set_id` on the settings row saying which
 * board the profile is currently looking at.
 *
 * **`set_id NULL` IS the default board.** The default dashboard („Početna“ in
 * copy) is deliberately NOT a row: every placement written before this
 * migration — and every placement of a profile that never names a board —
 * carries NULL, which is exactly what `ADD COLUMN` backfills. That is what
 * keeps ADR-045's whole get-or-default / first-edit-materialization machinery
 * working untouched on the NULL set, and what makes „Početna“ undeletable and
 * un-renamable by construction: there is nothing to delete or rename.
 *
 * **`ADD COLUMN`, not migration 038's parent rebuild — and deliberately its
 * counterexample.** Migration 038 rebuilt `task_lists` because SQLite cannot
 * ALTER a CHECK, and its header documents at length what dropping a PARENT
 * table does to the children referencing it (the implicit DELETE fires cascades;
 * deferred violations survive the rename). None of that machinery is needed
 * here, because nothing here alters an existing constraint and no table is
 * dropped: `dashboard_sets` is a NEW table, and the two altered tables each
 * gain a nullable column with a NULL default — precisely the case `ADD COLUMN`
 * exists for. `dashboard_widgets` becomes a CHILD of `dashboard_sets` (SQLite
 * allows a REFERENCES clause on an added column so long as its default is
 * NULL), and gaining a parent is safe in exactly the way 038's losing one was
 * not: no row is touched, no cascade can fire, and every existing row satisfies
 * the new constraint vacuously.
 *
 * `active_set_id` carries NO REFERENCES clause, on migration 028's
 * `default_template_id` argument: it is a preference, not structure. A delete
 * clears it in the same transaction (`DashboardSetStore.delete`), and a value
 * that somehow dangles anyway costs the user a fallback to „Početna“, never a
 * failed write — which is the right price for a pointer whose target the user
 * can delete out from under it.
 *
 * `dashboard_sets.position` is the sparse gap-1024 idiom of migration 022
 * (`TASK_ORDER_GAP`), for the reason every ordered scope here uses it; `name`
 * is deliberately NOT unique — a board's identity is its id, and two boards
 * named „Fakultet“ are the user's own affair, exactly as two identical chores
 * are two chores (migration 027).
 *
 * **Superseded by migration 062**, which replaced this column with a
 * fractional `rank` TEXT: an integer gap can run out, and the whole-scope
 * renumber that recovered from it is a mass UPDATE that a two-device merge
 * cannot tell apart from an intentional reordering. Everything above is
 * what this migration DID; none of it is the shape on disk today.
 *
 * `dashboard_sets_profile_position` covers the only read there is — one
 * profile's boards in order — mirroring `dashboard_widgets_profile_position`
 * one table over.
 */
export const migration043: Migration = {
  version: 43,
  up(db) {
    db.exec(`
      CREATE TABLE dashboard_sets (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        position    INTEGER NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX dashboard_sets_profile_position
        ON dashboard_sets (profile_id, position);

      ALTER TABLE dashboard_widgets ADD COLUMN set_id TEXT NULL REFERENCES dashboard_sets(id);
      ALTER TABLE dashboard_settings ADD COLUMN active_set_id TEXT NULL;
    `);
  },
};
