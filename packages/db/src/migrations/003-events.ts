import type { Migration } from "./migrations.js";

/**
 * Migration 3 — the CAL module's v0 data layer (PRD 04: CAL-001 event fields,
 * agenda/day/week reads over a chronological window).
 *
 * One `events` table, profile-scoped and soft-deletable, mirroring `tasks`:
 * UUIDv7 text ids, ISO-8601 text timestamps, `deleted_at` soft delete, and an
 * ON DELETE CASCADE to `profiles` (ADR-001). `start_at` is required; `end_at` is
 * nullable because an event may be a single point in time. `all_day` is a 0/1
 * INTEGER flag. `category` is free-text (v0 has no closed taxonomy; colour
 * mapping is a later UI concern). No SQL CHECK enforces end ≥ start — comparing
 * ISO strings across mixed zones/formats is fragile, so the store owns that
 * invariant. Recurrence, reminders, status/completion and calendar containers
 * are deferred to their own slices — no speculative columns here.
 */
export const migration003: Migration = {
  version: 3,
  up(db) {
    db.exec(`
      CREATE TABLE events (
        id           TEXT PRIMARY KEY,
        profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        title        TEXT NOT NULL,
        description  TEXT,
        start_at     TEXT NOT NULL,
        end_at       TEXT,
        all_day      INTEGER NOT NULL DEFAULT 0 CHECK (all_day IN (0, 1)),
        location     TEXT,
        category     TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        deleted_at   TEXT
      );

      -- The hot path is "active events for one profile, in chronological order"
      -- (agenda/day/week reads). This partial index covers that query and keeps
      -- soft-deleted rows out of it.
      CREATE INDEX events_profile_active
        ON events (profile_id, start_at, id)
        WHERE deleted_at IS NULL;
    `);
  },
};
