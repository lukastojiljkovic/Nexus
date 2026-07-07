import type { Migration } from "./migrations.js";

/**
 * Migration 5 — the STUDY module's structural data layer (PRD: the subject and
 * exam skeleton the rest of Study Hub hangs off).
 *
 * Two tables, mirroring `events`: UUIDv7 text ids, ISO-8601 text dates,
 * `deleted_at` soft delete, and an ON DELETE CASCADE to `profiles` (ADR-001).
 * `subjects` is a profile-scoped catalogue with a closed `color` enum (CHECK; the
 * UI maps each key onto a design token) and an `archived` 0/1 flag — an archived
 * subject is still an active row, not a deleted one. `exams` references its
 * subject with a same-profile foreign key that also cascades; it carries a closed
 * `exam_type` enum, an `exam_date`, and a free-text `scope`. Decks / cards /
 * reviews (spaced repetition) and the exam planner land in later STUDY pieces —
 * this piece is the subject/exam structure only, so no speculative columns here.
 */
export const migration005: Migration = {
  version: 5,
  up(db) {
    db.exec(`
      CREATE TABLE subjects (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        color       TEXT NOT NULL DEFAULT 'jade'
                      CHECK (color IN ('jade', 'gold', 'bronze',
                                       'burgundy', 'crimson', 'graphite')),
        semester    TEXT,
        archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT
      );

      -- The hot path is "active subjects for one profile, by name" (the subject
      -- catalogue). This partial index covers that query and keeps soft-deleted
      -- rows out of it.
      CREATE INDEX subjects_profile_active
        ON subjects (profile_id, name, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE exams (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        subject_id  TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        exam_type   TEXT NOT NULL CHECK (exam_type IN
                      ('pismeni', 'usmeni', 'kolokvijum')),
        exam_date   TEXT NOT NULL,
        scope       TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT
      );

      -- The hot path is "active exams for one profile, by date" (the exam
      -- agenda). This partial index covers that query and keeps soft-deleted
      -- rows out of it.
      CREATE INDEX exams_profile_active
        ON exams (profile_id, exam_date, id)
        WHERE deleted_at IS NULL;
    `);
  },
};
