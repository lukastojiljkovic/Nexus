import type { Migration } from "./migrations.js";

/**
 * Migration 71 - the TIMERS module's storage (ADR-090's worked example).
 *
 * **Three tables, and the shape of each is the module's whole design.**
 *
 * `timers_presets` is what the module's name promises: a countdown you saved,
 * started again with one click. `UNIQUE (profile_id, name)` is the model rather
 * than an optimisation - two presets called "Kafa" are one preset the user
 * cannot tell from the other, and the index makes that unrepresentable instead
 * of leaving the store to remember (`habit_entries`' arrangement). The store
 * still translates the violated index into a sentence, because an index is the
 * guarantee and a store is the message (`isUniqueConstraintViolation`).
 *
 * `timers_countdowns` is built around ONE decision: **a countdown is stored by
 * the instant it ends, not by a remaining time.** That is what makes it survive a
 * reload, keep running while the page is closed, and need no tick to be counted
 * down - and it is the only shape in which "when does this end" is answerable by
 * the database rather than by whoever last looked at it. A PAUSED countdown has
 * no end instant at all: it holds the whole seconds it still owes, which is the
 * same fact stated the other way round.
 *
 * So the two columns are `ends_at` and `remaining_seconds`, each nullable, with a
 * CHECK that they are NEVER both set and never both null. A single column meaning
 * "instant while running, duration while paused" was the obvious alternative and
 * is worse in a way that costs every reader: the store would have to know which
 * it was holding and so would every query, and `WHERE ends_at < now` - the one
 * read this table exists for - would silently count paused rows.
 *
 * `timers_settings` is one row per profile, and its column is the module's one
 * preference: whether a finished countdown's OS notification carries the system
 * sound. It is a PROFILE fact rather than a device one because main is what
 * shows the toast and main reads this row; `settings()` answers `true` when
 * there is no row, which is the shipped default, so a fresh profile needs no
 * seeding and an archive restored without it keeps behaving as it always did.
 *
 * **Whole seconds, and `typeof(x) = 'integer'` rather than INTEGER affinity** -
 * the FIN lesson migration 051 records: SQLite stores a REAL in an INTEGER
 * column happily when the conversion is lossless, so `90.5` would sit there and
 * every later read would be a float. Nothing in this module counts in fractions.
 *
 * **Plain `CREATE TABLE`, and three new tables with no referenced-parent
 * hazard**: `timers_presets` and `timers_countdowns` reference `profiles` only,
 * and nothing references them, so a later column may still land by
 * `ALTER TABLE ... ADD COLUMN` (ADR-042) - which is the rule that matters the day
 * one of them becomes a parent.
 *
 * Two indexes, both earned. `timers_presets_profile` covers the only preset read
 * ("this profile's presets, by name") and is not strictly needed beside the
 * UNIQUE below, which is also `(profile_id, name)` - kept because the UNIQUE is a
 * RULE and this is a READ, and a later change to the rule must not silently
 * drop the read's index. `timers_countdowns_profile` covers the only countdown
 * read: this profile's countdowns, in the order they end.
 */
export const migration071: Migration = {
  version: 71,
  up(db) {
    db.exec(`
      CREATE TABLE timers_presets (
        id               TEXT PRIMARY KEY,
        profile_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name             TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 60),
        duration_seconds INTEGER NOT NULL
                           CHECK (typeof(duration_seconds) = 'integer'
                                  AND duration_seconds > 0
                                  AND duration_seconds <= 86400),
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );

      -- The only preset read there is: "this profile's presets, by name".
      CREATE INDEX timers_presets_profile ON timers_presets (profile_id, name, id);

      -- Two presets with one name are one preset the user cannot tell from the
      -- other; see the file doc.
      CREATE UNIQUE INDEX timers_presets_profile_name ON timers_presets (profile_id, name);

      CREATE TABLE timers_countdowns (
        id                TEXT PRIMARY KEY,
        profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        label             TEXT NOT NULL CHECK (length(label) > 0 AND length(label) <= 60),
        duration_seconds  INTEGER NOT NULL
                            CHECK (typeof(duration_seconds) = 'integer'
                                   AND duration_seconds > 0
                                   AND duration_seconds <= 86400),
        -- Running: the instant it ends. Paused: NULL.
        ends_at           TEXT,
        -- Paused: the whole seconds still owed. Running: NULL.
        remaining_seconds INTEGER
                            CHECK (remaining_seconds IS NULL
                                   OR (typeof(remaining_seconds) = 'integer'
                                       AND remaining_seconds > 0)),
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        -- Exactly one of the two, always: a countdown is running or it is
        -- paused, and a row that is neither has no state to be counted from.
        CHECK ((ends_at IS NULL) <> (remaining_seconds IS NULL))
      );

      -- The only countdown read there is: this profile's, in the order they end.
      CREATE INDEX timers_countdowns_profile ON timers_countdowns (profile_id, ends_at);

      CREATE TABLE timers_settings (
        profile_id   TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        sound_on_end INTEGER NOT NULL CHECK (sound_on_end IN (0, 1)),
        updated_at   TEXT NOT NULL
      );
    `);
  },
};
