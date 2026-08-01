import type { Migration } from "./migrations.js";

/**
 * Migration 56 — the habit reminder becomes a notification source (HABIT slice
 * c). No new table and no new column: `habits.reminder_time` has existed since
 * migration 055 and nothing read it. This is the other half of that column —
 * the two CHECKs that decide whether a reminder derived from it may be RECORDED
 * and whether it may be SILENCED.
 *
 * **The source widens to `'habit'`** in both places migration 009 closed it and
 * migrations 019/021/037/053 last widened it: the `notifications` ledger and
 * `ntf_source_settings`. It goes into the NARROWER settings CHECK too, exactly
 * as `'subscription'` did and unlike migration 037's `'security'`: a habit nudge
 * is silenceable. „Podseti me na vodu u 20:00" is a preference somebody set and
 * may unset — the always-on exemption belongs to the one class of notification
 * where „you were not told" is itself the failure, and a habit is not it.
 *
 * SQLite cannot alter a CHECK, so each table is rebuilt by the standard
 * create-new / copy / drop / rename sequence, re-creating
 * `notifications_profile_status_updated` afterwards — `DROP TABLE` takes a
 * table's indexes with it, while `UNIQUE (profile_id, source, entity_id,
 * occurrence_key)` comes back with the table because it is part of the
 * declaration. That UNIQUE is what makes „one nudge per habit per day"
 * unrepresentable rather than deduplicated in code: a habit occurrence is keyed
 * by its own bare day (`habitOccurrences` in `@nexus/core`).
 *
 * **Why the rebuild is safe here, re-verified rather than inherited.** ADR-042
 * proved what a rebuild costs when the dropped table is a referenced PARENT: the
 * implicit DELETE inside `DROP TABLE` fires every `ON DELETE CASCADE` that points
 * at it, and `PRAGMA foreign_keys` is a NO-OP inside the transaction
 * `runMigrations` wraps each migration in, so it cannot be switched off — which
 * is why migration 047 chose three UPDATEs over a rebuild of `cards`. The schema
 * has been re-read as it stands at version 55, three migrations after 053 last
 * made this claim: nothing anywhere declares `REFERENCES notifications` or
 * `REFERENCES ntf_source_settings`, no view selects from either, and migration
 * 017's search-index triggers and views name neither. Both are still pure
 * CHILDREN of `profiles`, which this migration does not touch, so every copied
 * row's `profile_id` already satisfied the very constraint it is re-checked
 * against. `migrations.test.ts` proves it rather than asserting it: a fixture at
 * version 55 seeding EVERY source the old CHECK allowed is migrated and every row
 * counted back.
 */
export const migration056: Migration = {
  version: 56,
  up(db) {
    db.exec(`
      CREATE TABLE notifications_new (
        id              TEXT PRIMARY KEY,
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        source          TEXT NOT NULL
                          CHECK (source IN ('document', 'exam', 'study-day', 'event', 'task',
                                            'security', 'subscription', 'habit')),
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
                      CHECK (source IN ('document', 'exam', 'study-day', 'event', 'task',
                                        'subscription', 'habit')),
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
