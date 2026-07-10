import type { Migration } from "./migrations.js";

/**
 * Migration 9 — the NOTIFICATIONS module's data layer (PRD NTF-001..005,
 * desktop-local scope; NTF piece a1).
 *
 * `notifications` is a **ledger only** — never a source of truth for what is
 * due. The whole point of the design (`deriveNotificationCandidates`,
 * `@nexus/core`) is that reminders are derived from source tables (documents,
 * exams, study-day aggregates) at check time, never materialized ahead; this
 * table just records what was already delivered/snoozed/dismissed, with a
 * snapshot of the text actually shown (`title`/`body`), so the scheduler can
 * diff fresh candidates against it and never re-deliver the same occurrence.
 * That buys: deleting a source entity simply stops it being derived — the
 * ledger row, if any, is harmless history, never cleaned up on purpose, so
 * the PRD's cleanup contract holds with zero coupling between modules;
 * clock/timezone changes self-heal on the next check, since nothing here
 * drives *what* fires, only *what already did*; and anything that came due
 * while the app was off surfaces on the first check after launch. There is
 * deliberately **no `deleted_at`** — dismissal (`status = 'dismissed'`) is
 * itself a terminal status, so the ledger is a plain history, not a
 * soft-deletable set.
 *
 * `notifications_profile_status_updated` covers the notification center's
 * listing query (newest-updated first, optionally filtered by status).
 * `UNIQUE(profile_id, source, entity_id, occurrence_key)` is the core
 * invariant: an occurrence is recorded once; a re-fire after a snooze goes
 * through `markRefired` on the same row, never a second insert.
 *
 * `ntf_settings` (one row per profile, defaults applied by `NotificationStore`
 * when absent: no quiet hours, morning hour 08:00) and `ntf_source_settings`
 * (one row per profile+source; absent = enabled, mirroring `feature_flags`'s
 * "absent row = default" idiom) hold the user's NTF preferences — both
 * `ON DELETE CASCADE` from `profiles`, like every other per-profile table.
 */
export const migration009: Migration = {
  version: 9,
  up(db) {
    db.exec(`
      CREATE TABLE notifications (
        id              TEXT PRIMARY KEY,
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        source          TEXT NOT NULL CHECK (source IN ('document', 'exam', 'study-day')),
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

      -- The hot path is "this profile's notification center listing".
      CREATE INDEX notifications_profile_status_updated
        ON notifications (profile_id, status, updated_at);

      CREATE TABLE ntf_settings (
        profile_id    TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        quiet_from    TEXT,
        quiet_to      TEXT,
        morning_hour  TEXT NOT NULL DEFAULT '08:00',
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE ntf_source_settings (
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        source      TEXT NOT NULL CHECK (source IN ('document', 'exam', 'study-day')),
        enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        PRIMARY KEY (profile_id, source)
      );
    `);
  },
};
