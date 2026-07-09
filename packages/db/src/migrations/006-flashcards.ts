import type { Migration } from "./migrations.js";

/**
 * Migration 6 — the STUDY module's flashcard data layer (PRD: spaced repetition
 * over FSRS, not SM-2; STUDY piece 2a).
 *
 * Three tables, continuing the house style of 005: UUIDv7 text ids, ISO-8601 text
 * dates, `deleted_at` soft delete (except `review_log`, see below), and
 * `ON DELETE CASCADE` down the chain profiles -> subjects -> decks -> cards ->
 * review_log.
 *
 * `decks` is a thin profile-scoped grouping that always belongs to a subject.
 * `cards` carries one column per field of the installed `ts-fsrs@5.4.1` `Card`
 * type (due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
 * reps, lapses, state, last_review) so a row round-trips losslessly through the
 * library's scheduler; `state` is constrained to the four values of `ts-fsrs`'s
 * `State` enum (New=0, Learning=1, Review=2, Relearning=3). `review_log` mirrors
 * `ts-fsrs`'s `ReviewLog` type field-for-field (including the two fields the
 * library marks `@deprecated` for v6 — they are still populated by 5.4.1 and are
 * required to reconstruct a pre-review card via `rollback`), scoped by profile and
 * cascading from its card. Log rows have no `deleted_at`: they are removed only by
 * `CardStore.undoLastReview`, never soft-deleted.
 *
 * Two partial indexes on `cards` cover the two hot paths: the due review queue
 * (profile + due, active only) and the per-deck card listing (profile + deck,
 * active only). `review_log` gets a plain index on (card_id, review) for "latest
 * review of this card" (undo).
 */
export const migration006: Migration = {
  version: 6,
  up(db) {
    db.exec(`
      CREATE TABLE decks (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        subject_id  TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT
      );

      -- The hot path is "active decks for one profile's subject, by name" (the
      -- deck picker). This partial index covers that query and keeps
      -- soft-deleted rows out of it.
      CREATE INDEX decks_profile_active
        ON decks (profile_id, subject_id, name, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE cards (
        id              TEXT PRIMARY KEY,
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        deck_id         TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
        front           TEXT NOT NULL,
        back            TEXT NOT NULL,
        due             TEXT NOT NULL,
        stability       REAL NOT NULL,
        difficulty      REAL NOT NULL,
        elapsed_days    INTEGER NOT NULL,
        scheduled_days  INTEGER NOT NULL,
        learning_steps  INTEGER NOT NULL,
        reps            INTEGER NOT NULL,
        lapses          INTEGER NOT NULL,
        state           INTEGER NOT NULL CHECK (state IN (0, 1, 2, 3)),
        last_review     TEXT,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        deleted_at      TEXT
      );

      -- The review-queue hot path: active cards due for one profile, by due date.
      CREATE INDEX cards_profile_due_active
        ON cards (profile_id, due, id)
        WHERE deleted_at IS NULL;

      -- The deck-listing hot path: active cards of one profile's deck.
      CREATE INDEX cards_profile_deck_active
        ON cards (profile_id, deck_id, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE review_log (
        id                 TEXT PRIMARY KEY,
        profile_id         TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        card_id            TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        rating             INTEGER NOT NULL CHECK (rating IN (1, 2, 3, 4)),
        state              INTEGER NOT NULL CHECK (state IN (0, 1, 2, 3)),
        due                TEXT NOT NULL,
        stability          REAL NOT NULL,
        difficulty         REAL NOT NULL,
        elapsed_days       INTEGER NOT NULL,
        last_elapsed_days  INTEGER NOT NULL,
        scheduled_days     INTEGER NOT NULL,
        learning_steps     INTEGER NOT NULL,
        review             TEXT NOT NULL,
        created_at         TEXT NOT NULL
      );

      -- "Latest review of this card" (undo).
      CREATE INDEX review_log_card_review
        ON review_log (card_id, review);
    `);
  },
};
