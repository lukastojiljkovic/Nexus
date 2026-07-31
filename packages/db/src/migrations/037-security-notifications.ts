import type { Migration } from "./migrations.js";

/**
 * Migration 37 — security notifications (NTF-007). The `notifications.source`
 * domain widens once more, to `'security'`: the ledger now also records the
 * four security-relevant events that already happen locally (an unlock throttle
 * that tripped, a passcode change, a Recovery Kit reissue, another account's
 * deletion). SQLite cannot alter a CHECK constraint, so the table is rebuilt by
 * the same create-new / copy / drop / rename sequence migrations 019 and 021
 * used, re-creating `notifications_profile_status_updated` afterwards — `DROP
 * TABLE` takes a table's indexes with it, while `UNIQUE (profile_id, source,
 * entity_id, occurrence_key)` comes back with the table itself because it is
 * part of the declaration.
 *
 * **Why `ntf_source_settings` is deliberately NOT widened.** Both previous
 * widenings moved the two CHECKs together, because a new reminder source is
 * also a new thing to switch off. This one is the opposite by design: a
 * security notification cannot be silenced (see `ALWAYS_ON_SOURCES` in
 * `@nexus/core`), so there is no preference to store — and leaving that table's
 * narrower CHECK in place makes the schema itself the last line of enforcement.
 * A row saying "security: off" cannot be written at all: not by a hostile
 * renderer, not by a hand-edited archive, not by a future bug in the settings
 * UI.
 *
 * **Why no `defer_foreign_keys` around the rebuild** — unchanged from migration
 * 021, and re-verified against the schema as it stands: `notifications` is a
 * pure child of `profiles`, and nothing in the schema points back at it (no
 * foreign key, no view, no trigger — the search index of migration 017 does not
 * touch it). So the implicit DELETE inside `DROP TABLE` can violate nothing, the
 * `RENAME` has no other table's FK clause to rewrite, and every copied row
 * carries a `profile_id` that already satisfied this very constraint against a
 * `profiles` table this migration does not touch.
 */
export const migration037: Migration = {
  version: 37,
  up(db) {
    db.exec(`
      CREATE TABLE notifications_new (
        id              TEXT PRIMARY KEY,
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        source          TEXT NOT NULL
                          CHECK (source IN ('document', 'exam', 'study-day', 'event', 'task',
                                            'security')),
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
    `);
  },
};
