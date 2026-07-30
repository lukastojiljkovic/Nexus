import type { Migration } from "./migrations.js";

/**
 * Migration 33 — problem cards (ADR-046). ONE column on `cards`, and NO third
 * card kind: a problem card is a `basic` card that also carries a worked
 * solution, and a problem card minus its steps IS a basic card. `kind` keeps
 * its two values, so every reader written against migration 031 — the search
 * index triggers of 017, `listByDeck`, `dueQueue`, `review`, every export that
 * reads `front`/`back` — keeps working with no knowledge of this feature.
 *
 *  - `problem_steps` — the full solution in the in-band `--` grammar of
 *    `@nexus/core`'s `problemSteps.ts`, the SOURCE `back` is derived from and
 *    the only text the user edits. NULL for a card with no worked solution,
 *    which is every card that existed before this migration and every card
 *    created without one afterwards. No default and no backfill: NULL already
 *    means exactly what those rows are.
 *
 * The CHECK says two things at once, both of which an archive restore writes
 * these columns directly enough to need enforced in SQL rather than left to
 * the store. `kind = 'basic'` is the ADR's "no third kind" rule made
 * unbreakable — a cloze card's sides come from its template, so steps on one
 * would be a second, contradicting source for the same `back`. `length(…) > 0`
 * refuses the empty string, which would be a third state ("has a solution, but
 * it is nothing") beside NULL and a real solution; the store trims before
 * writing, so an all-whitespace solution never reaches here as anything but
 * the empty string this refuses.
 *
 * **Why `ALTER TABLE ADD COLUMN` and not a table rebuild** — migration 031
 * settled that for good, and this migration respects the record it left:
 * `review_log` references `cards(id)` `ON DELETE CASCADE`, so the implicit
 * DELETE inside a `DROP TABLE cards` would take every row of a user's FSRS
 * review history with it, and `PRAGMA foreign_keys` is a no-op inside the
 * transaction `runMigrations` wraps each migration in. `cards` can never be
 * rebuilt. That is precisely why this column arrives with its CHECK attached:
 * SQLite applies a CHECK on an ADDED column to every row written from here on,
 * and no later migration will ever be able to add one.
 */
export const migration033: Migration = {
  version: 33,
  up(db) {
    db.exec(`
      ALTER TABLE cards ADD COLUMN problem_steps TEXT NULL
        CHECK (problem_steps IS NULL OR (kind = 'basic' AND length(problem_steps) > 0));
    `);
  },
};
