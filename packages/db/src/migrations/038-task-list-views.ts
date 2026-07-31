import type { Migration } from "./migrations.js";

/**
 * Migration 38 — the four task views (ADR-050). `task_lists.default_view`
 * widens from `('list','kanban')` to `('list','kanban','cards','calendar')`,
 * and the table gains a nullable `view_config` JSON column: what one list
 * remembers about each of those views (its grouping, its sort, its filters).
 * The column has no CHECK to lean on — `TaskListStore.setViewConfig` validates
 * the shape on the way in and normalizes it on the way out
 * (`validateTaskViewConfig` / `parseStoredTaskViewConfig` in `@nexus/core`), the
 * arrangement migration 036's event-template payload already uses.
 *
 * SQLite cannot alter a CHECK, so the table is rebuilt — but `task_lists` is the
 * first PARENT this repository has ever rebuilt, and the create-new / copy /
 * drop / rename sequence of migrations 019, 021 and 037 does NOT survive that
 * unchanged. Those three rebuilt `notifications` and `ntf_source_settings`,
 * which are pure children of `profiles` with nothing in the schema pointing back
 * at them, and each says so in its own header. This table has four inbound
 * references:
 *
 *   - `task_sections.list_id` → `task_lists(id)` **ON DELETE CASCADE**
 *   - `tasks.list_id`         → `task_lists(id)`  (NO ACTION)
 *   - `tasks.section_id`      → `task_sections(id)` (NO ACTION — reached
 *     indirectly, once the cascade above has fired)
 *   - `task_lists.parent_id`  → `task_lists(id)`  (NO ACTION, self)
 *
 * **What the naive sequence actually does**, verified against SQLite 3.53.2
 * before this migration was written rather than reasoned about:
 *
 *  1. `DROP TABLE task_lists` performs an implicit `DELETE FROM task_lists`
 *     whenever the table is referenced — and that delete FIRES FOREIGN KEY
 *     ACTIONS. The cascade empties `task_sections` outright, so every heading in
 *     every list is destroyed, and every `tasks.section_id` pointing at one
 *     becomes a violation.
 *  2. `PRAGMA foreign_keys = OFF`, which the documented 12-step table rebuild
 *     opens with, is a NO-OP inside a transaction, and `runMigrations` runs every
 *     migration inside one. `PRAGMA defer_foreign_keys = ON` is its in-transaction
 *     stand-in (migrations 019/021/037 explain this, and `RestoreStore` uses it
 *     for the same reason) — but it only DEFERS the checking; the cascade still
 *     fires and the deferred counter still climbs.
 *  3. Nothing about `ALTER TABLE task_lists_new RENAME TO task_lists` brings that
 *     counter back down. The rename does rewrite child `REFERENCES` clauses
 *     (`PRAGMA legacy_alter_table` is 0 here — never set, and `openDatabase`
 *     leaves the default), which is why the children still name the right table
 *     afterwards; but a rename is a schema edit, not a row edit, so the
 *     violations recorded in step 1 are still outstanding at COMMIT, and the
 *     whole migration fails with `FOREIGN KEY constraint failed`.
 *
 * **What this migration does instead.** The rows the drop would destroy are
 * parked in two plain hold tables (no constraints, so nothing cascades into or
 * out of them), the SHELL is rebuilt while the table is empty, and the rows are
 * put back AFTER the rename — into the table the children name. That last part
 * is the whole trick: inserting a parent row is what SQLite decrements the
 * deferred counter on, so refilling `task_lists` and then `task_sections`, in
 * that order, resolves every violation the drop recorded, and the transaction
 * commits with `PRAGMA foreign_key_check` empty.
 *
 * The order of the two refills is not cosmetic: `task_sections.list_id` is NOT
 * NULL, so the lists must exist first; `task_lists.parent_id` is self-referencing
 * and deferred, so a child list restored before its parent is merely a violation
 * that closes again a few rows later. Both refills preserve `rowid` order, so a
 * reader that has ever relied on insertion order sees what it saw before.
 *
 * `task_lists` carries no indexes of its own (migration 022 declared none), so
 * unlike the `notifications` rebuilds there is nothing to re-create after the
 * rename; the PRIMARY KEY and the CHECKs come back with the declaration.
 * Nothing in the schema triggers on either table, so the implicit delete (which
 * suppresses triggers anyway) and the refills fire none.
 *
 * `view_config` starts NULL for every existing row: a list that predates this
 * migration has expressed no preference about views that did not exist, and NULL
 * is exactly how the store reads "no preference".
 */
export const migration038: Migration = {
  version: 38,
  up(db) {
    db.exec(`
      PRAGMA defer_foreign_keys = ON;

      -- 1. Park what the drop would destroy. Plain tables, no constraints:
      --    nothing cascades into them and nothing references them.
      CREATE TABLE task_lists_hold (
        id            TEXT,
        profile_id    TEXT,
        parent_id     TEXT,
        name          TEXT,
        is_inbox      INTEGER,
        default_view  TEXT,
        position      INTEGER,
        created_at    TEXT,
        updated_at    TEXT,
        deleted_at    TEXT
      );
      INSERT INTO task_lists_hold
        SELECT id, profile_id, parent_id, name, is_inbox, default_view, position,
               created_at, updated_at, deleted_at
        FROM task_lists ORDER BY rowid;

      CREATE TABLE task_sections_hold (
        id          TEXT,
        list_id     TEXT,
        name        TEXT,
        position    INTEGER,
        created_at  TEXT,
        updated_at  TEXT
      );
      INSERT INTO task_sections_hold
        SELECT id, list_id, name, position, created_at, updated_at
        FROM task_sections ORDER BY rowid;

      -- 2. Rebuild the shell. Migration 022's declaration, with the widened
      --    CHECK and the new column; the self-reference names the NEW table and
      --    the rename below rewrites it back, exactly as it rewrites the
      --    children's clauses.
      CREATE TABLE task_lists_new (
        id            TEXT PRIMARY KEY,
        profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        parent_id     TEXT REFERENCES task_lists_new(id),
        name          TEXT NOT NULL,
        is_inbox      INTEGER NOT NULL DEFAULT 0 CHECK (is_inbox IN (0, 1)),
        default_view  TEXT NOT NULL DEFAULT 'list'
                        CHECK (default_view IN ('list', 'kanban', 'cards', 'calendar')),
        view_config   TEXT,
        position      INTEGER NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        deleted_at    TEXT
      );

      DROP TABLE task_lists;
      ALTER TABLE task_lists_new RENAME TO task_lists;

      -- 3. Put the rows back, parents before children, into the tables the
      --    foreign keys name — which is what clears the deferred violations the
      --    drop recorded (see the header).
      INSERT INTO task_lists
        (id, profile_id, parent_id, name, is_inbox, default_view, view_config, position,
         created_at, updated_at, deleted_at)
        SELECT id, profile_id, parent_id, name, is_inbox, default_view, NULL, position,
               created_at, updated_at, deleted_at
        FROM task_lists_hold ORDER BY rowid;

      INSERT INTO task_sections (id, list_id, name, position, created_at, updated_at)
        SELECT id, list_id, name, position, created_at, updated_at
        FROM task_sections_hold ORDER BY rowid;

      DROP TABLE task_lists_hold;
      DROP TABLE task_sections_hold;
    `);
  },
};
