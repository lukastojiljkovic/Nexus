import type { Migration } from "./migrations.js";

/**
 * Migration 94 — a per-subject and per-deck target retention (STUDY-007). ONE
 * nullable column on each of `subjects` and `decks`, and NULL means "inherit":
 * a deck with no value of its own is scheduled at its subject's, and a subject
 * with none at the profile's `study_settings` value (migration 34). The chain
 * is resolved in one place, `StudySettingsStore.retentionFor`, so the scheduler
 * never has to know which of the three a card's number came from.
 *
 * `ALTER TABLE ... ADD COLUMN` and not a table rebuild, for the reason migration
 * 33 gives for `cards`: `review_log` cascades from the card, and `decks` is the
 * parent of every card, so a DROP inside the migration would take the review
 * history with it. Every existing row gains NULL, which is exactly "no override",
 * so nothing is rescheduled.
 *
 * The CHECK repeats migration 34's window, 0.70..0.97, because the archive
 * restore writes these columns directly; the store's own validation is the
 * friendly path, and this is the one that holds for every row.
 */
export const migration094: Migration = {
  version: 94,
  up(db) {
    db.exec(`
      ALTER TABLE subjects ADD COLUMN target_retention REAL NULL
        CHECK (target_retention IS NULL OR (target_retention >= 0.7 AND target_retention <= 0.97));
      ALTER TABLE decks ADD COLUMN target_retention REAL NULL
        CHECK (target_retention IS NULL OR (target_retention >= 0.7 AND target_retention <= 0.97));
    `);
  },
};
