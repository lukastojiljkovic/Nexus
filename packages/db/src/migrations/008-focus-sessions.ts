import type { Migration } from "./migrations.js";

/**
 * Migration 8 — the STUDY module's focus-session data layer (PRD: honest study
 * stats + gentle streaks; STUDY piece 4a).
 *
 * One table, continuing the house style of 006/007: a UUIDv7 text id, ISO-8601
 * text dates, `deleted_at` soft delete (a mistaken session can be deleted with
 * undo), and `ON DELETE CASCADE` down the chain profiles -> subjects ->
 * focus_sessions.
 *
 * `focus_sessions` rows are completed study-timer sessions only. A *running*
 * session is deliberately never written here — it lives as main-process
 * runtime state (a `Map` keyed by profile id; see the desktop main process),
 * so a crash loses the in-progress timer honestly instead of persisting a
 * fabricated duration, and there is no stale-open-row cleanup to get wrong.
 * The `ended_at > started_at` CHECK enforces that every persisted session has
 * a genuine, positive duration.
 *
 * `focus_sessions_profile_started` is the hot path: "this profile's active
 * sessions in a date range" (stats aggregation, `StatsStore`).
 */
export const migration008: Migration = {
  version: 8,
  up(db) {
    db.exec(`
      CREATE TABLE focus_sessions (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        subject_id  TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        started_at  TEXT NOT NULL,
        ended_at    TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT,
        CHECK (ended_at > started_at)
      );

      CREATE INDEX focus_sessions_profile_started
        ON focus_sessions (profile_id, started_at)
        WHERE deleted_at IS NULL;
    `);
  },
};
