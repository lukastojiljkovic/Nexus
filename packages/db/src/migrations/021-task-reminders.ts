import type { Migration } from "./migrations.js";

/**
 * Migration 21 — task reminders (ADR-028). Two halves that only make sense
 * together, which is why they are one migration:
 *
 *  - `tasks.reminder_offsets` — a JSON array of whole-DAY lead times before a
 *    task's due date, kept ascending by `TaskStore`. NOT NULL with a `'[]'`
 *    default, exactly like `events.reminder_offsets` (migration 019): every row
 *    always carries at least an empty list, so reading it never has to decide
 *    what a NULL would mean, and every existing task becomes a task with no
 *    reminders. Days, not minutes, because a task carries a bare-date due date
 *    — the document-expiry model, not the event model, where a start INSTANT is
 *    what "15 minutes before" counts back from. No SQL CHECK can express
 *    "unique, at most 8, each 0..365" over JSON; `TaskStore` is the gate (and it
 *    also enforces the pair rule no column can see: a non-empty ladder requires
 *    a bare-date `due_date` to count back from), and `parseImportArchive`
 *    applies the twin rules to an archive — the same division of labour
 *    migrations 018 and 019 set up.
 *
 *  - the `source` domain widens to include `'task'` in BOTH places migration
 *    009 closed it and migration 019 last widened it: the `notifications` ledger
 *    and `ntf_source_settings` (so the user can switch task reminders off like
 *    any other source). SQLite cannot alter a CHECK constraint, so each table is
 *    rebuilt by the standard create-new / copy / drop / rename sequence,
 *    re-creating `notifications_profile_status_updated` afterwards — `DROP
 *    TABLE` takes a table's indexes with it, and `UNIQUE (profile_id, source,
 *    entity_id, occurrence_key)` comes back with the table itself because it is
 *    part of the declaration.
 *
 * **Why no `defer_foreign_keys` around the rebuild.** `runMigrations` runs
 * every migration inside a transaction, and `PRAGMA foreign_keys` is a no-op
 * inside one — so the usual "switch FKs off for the 12-step rebuild" is not
 * available here, and `defer_foreign_keys` is its in-transaction stand-in. It
 * is not needed: both rebuilt tables are pure CHILDREN of `profiles`, and
 * nothing in the schema points back at them (no foreign key, no view, no
 * trigger names either table — the search index of migration 017 covers
 * neither). So the implicit DELETE inside `DROP TABLE` can violate nothing,
 * the `RENAME` has no other table's FK clause to rewrite, and every row copied
 * into the new table carries a `profile_id` that already satisfied this very
 * constraint against a `profiles` table this migration does not touch.
 */
export const migration021: Migration = {
  version: 21,
  up(db) {
    db.exec(`
      ALTER TABLE tasks ADD COLUMN reminder_offsets TEXT NOT NULL DEFAULT '[]';

      CREATE TABLE notifications_new (
        id              TEXT PRIMARY KEY,
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        source          TEXT NOT NULL
                          CHECK (source IN ('document', 'exam', 'study-day', 'event', 'task')),
        entity_id       TEXT NOT NULL,
        occurrence_key  TEXT NOT NULL,
        title           TEXT NOT NULL,
        body            TEXT NOT NULL,
        status          TEXT NOT NULL
                          CHECK (status IN ('delivered', 'snoozed', 'dismissed')),
        snoozed_until   TEXT,
        delivered_at    TEXT NOT NULL,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        UNIQUE (profile_id, source, entity_id, occurrence_key)
      );

      INSERT INTO notifications_new
        (id, profile_id, source, entity_id, occurrence_key, title, body, status,
         snoozed_until, delivered_at, created_at, updated_at)
        SELECT id, profile_id, source, entity_id, occurrence_key, title, body, status,
               snoozed_until, delivered_at, created_at, updated_at
        FROM notifications;

      DROP TABLE notifications;
      ALTER TABLE notifications_new RENAME TO notifications;

      -- Dropped with the old table; re-created verbatim from migration 009.
      CREATE INDEX notifications_profile_status_updated
        ON notifications (profile_id, status, updated_at);

      CREATE TABLE ntf_source_settings_new (
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        source      TEXT NOT NULL
                      CHECK (source IN ('document', 'exam', 'study-day', 'event', 'task')),
        enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        PRIMARY KEY (profile_id, source)
      );

      INSERT INTO ntf_source_settings_new (profile_id, source, enabled)
        SELECT profile_id, source, enabled FROM ntf_source_settings;

      DROP TABLE ntf_source_settings;
      ALTER TABLE ntf_source_settings_new RENAME TO ntf_source_settings;
    `);
  },
};
