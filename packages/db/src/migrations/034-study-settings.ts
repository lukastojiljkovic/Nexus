import type { Migration } from "./migrations.js";

/**
 * Migration 34 — the STUDY module's per-profile scheduling preferences
 * (STUDY-007): the FSRS target retention, the daily cap on New cards, and the
 * optional daily cap on reviews. One row per profile, created on first write;
 * `StudySettingsStore.get` answers with defaults while the row is absent,
 * exactly as `dashboard_settings` (migration 030) and `ntf_settings`
 * (migration 009) do — a profile that never opened these settings costs no row,
 * and the defaults live in one place instead of being seeded into every profile
 * at creation.
 *
 * `target_retention` is ts-fsrs's `request_retention`: the probability the
 * scheduler aims for at review time. Its window is 0.70..0.97 — the range the
 * library's own parameter generation is meaningful over. Below 0.70 the
 * intervals grow past what anyone would call "learned"; above 0.97 they collapse
 * to daily drilling. A REAL, not an integer percent, because that is the unit
 * the scheduler takes; the UI offers a handful of presets rather than the whole
 * continuum.
 *
 * `new_per_day` capped at 100 for the reason the reviewer's own `newLimit`
 * always was: an uncapped New section is a session nobody finishes, and 100
 * unseen cards is already more than a day's honest work.
 *
 * `max_reviews_per_day` is NULLABLE, and NULL means UNCAPPED — deliberately not
 * a sentinel like 0 or -1: "no ceiling" is a different kind of answer from "a
 * ceiling of N", and a column that says so in its own type cannot be misread.
 * Its floor is therefore 1, not 0: a cap of zero would be "never review
 * anything", which is what turning the module off is for.
 *
 * `review_log_profile_review` is the index the daily cap's own count needs —
 * "how many reviews did this profile do inside today's local day" runs on every
 * queue fetch, and migration 006's only `review_log` index is keyed by card.
 */
export const migration034: Migration = {
  version: 34,
  up(db) {
    db.exec(`
      CREATE TABLE study_settings (
        profile_id          TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        target_retention    REAL NOT NULL DEFAULT 0.9,
        new_per_day         INTEGER NOT NULL DEFAULT 20,
        max_reviews_per_day INTEGER,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL,
        CHECK (target_retention >= 0.7 AND target_retention <= 0.97),
        CHECK (new_per_day >= 0 AND new_per_day <= 100),
        CHECK (max_reviews_per_day IS NULL
               OR (max_reviews_per_day >= 1 AND max_reviews_per_day <= 1000))
      );

      -- "How many reviews has this profile logged inside today's local day"
      -- (the daily review cap) — a count on every queue fetch.
      CREATE INDEX review_log_profile_review
        ON review_log (profile_id, review);
    `);
  },
};
