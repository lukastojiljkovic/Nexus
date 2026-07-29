import type { Migration } from "./migrations.js";

/**
 * Migration 19 — event reminders (CAL-006, ADR-025). Two halves that only make
 * sense together, which is why they are one migration:
 *
 *  - `events.reminder_offsets` — a JSON array of whole-minute lead times before
 *    an occurrence's start, kept ascending by `EventStore`. NOT NULL with a
 *    `'[]'` default, exactly like `recurrence_exdates` (migration 018): every
 *    row always carries at least an empty list, so reading it never has to
 *    decide what a NULL would mean, and every existing event becomes an event
 *    with no reminders. Minutes, not days, because an event reminder is a
 *    "15 minutes before" affair — unlike a document's expiry ladder, which is
 *    day-granular. No SQL CHECK can express "unique, at most 8, each 0..43200"
 *    over JSON; `EventStore` is the gate, and `parseImportArchive` applies the
 *    twin rule to an archive, the same division of labour migration 018 set up
 *    for recurrence rules.
 *
 *  - the `source` domain widens to include `'event'` in BOTH places migration
 *    009 closed it: the `notifications` ledger and `ntf_source_settings` (so
 *    the user can switch event reminders off like any other source). SQLite
 *    cannot alter a CHECK constraint, so each table is rebuilt by the standard
 *    create-new / copy / drop / rename sequence, re-creating
 *    `notifications_profile_status_updated` afterwards — `DROP TABLE` takes a
 *    table's indexes with it, and `UNIQUE (profile_id, source, entity_id,
 *    occurrence_key)` comes back with the table itself because it is part of
 *    the declaration.
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
export const migration019: Migration = {
  version: 19,
  up(db) {
    db.exec(`
      ALTER TABLE events ADD COLUMN reminder_offsets TEXT NOT NULL DEFAULT '[]';

      CREATE TABLE notifications_new (
        id              TEXT PRIMARY KEY,
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        source          TEXT NOT NULL
                          CHECK (source IN ('document', 'exam', 'study-day', 'event')),
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
                      CHECK (source IN ('document', 'exam', 'study-day', 'event')),
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
