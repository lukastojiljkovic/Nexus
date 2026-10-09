import type { Migration } from "./migrations.js";

/**
 * Migration 82 — the CHESS module's storage: saved games, the one game in
 * progress, and the ladder record.
 *
 * **Three tables, and each answers a different question.** `chess_games` is an
 * ARCHIVE — what a person kept. `chess_resume` is a SLOT, at most one row per
 * profile, because "the game I am in the middle of" is a single fact about a
 * profile and a second row would have to be resolved by a rule nobody stated.
 * `chess_level_stats` is a RECORD — how the player has done against each engine
 * level — and it is deliberately not derived from `chess_games`: the number that
 * tells somebody to move up or down a level is their history against that level,
 * and it must survive the archive being tidied. This is the one place in the
 * module where the same game is counted twice, and the counter is the copy that
 * is allowed to outlive the row.
 *
 * **Only a FINISHED game against the ENGINE enters the record.** A game against
 * a person has no level to be counted under, and `unfinished` is an abandoned
 * game — it is archived with whatever result it had and does not claim to have
 * been played to a conclusion. `CHECK (played = won + drawn + lost)` is what
 * keeps that arithmetic from drifting: the ledger cannot say two different things
 * about the same row.
 *
 * **`level` is nullable, and the pair CHECK is the module's one shape rule.** An
 * engine game is meaningless without the level it was played at, and a level on
 * a game against a person is a number describing nothing. A single `CHECK
 * ((opponent = 'engine') = (level IS NOT NULL))` makes both unwritable. This is
 * exactly the class migration 055's `unit`/`target` pair belongs to, and — like
 * that one — it is a check that reads two columns, so a future sync would need
 * the field-level merge repair for it. Sync is on hold; there is no journal
 * trigger here and no entry in `@nexus/sync`'s map, for the reason the last
 * paragraph gives.
 *
 * **`moves` in `chess_resume` is canonical JSON**, the `habits.schedule`
 * arrangement: `JSON.stringify` of a list of UCI strings, and the store
 * re-validates it on the way out rather than trusting a column it wrote. The row
 * also carries the `fen` the moves produce, and `ChessStore` refuses a write
 * where the two disagree — a resume slot whose position and move list tell
 * different stories is a board showing one game and a clock counting another.
 *
 * **`played_color` is the colour the USER played**, not the colour that won;
 * the result is stored separately and the statistics read both, which is the
 * only way "I lost with black" and "I lost with white" can be told apart later.
 *
 * **No journal triggers, and no entry in `RESTORE_WIPE_TABLES`.** That list and
 * `@nexus/sync`'s collection map are held equal by
 * `sync/collectionGuard.test.ts`, and sync is on hold permanently, so a table
 * added to one without a matching entry in the other is a red gate rather than
 * a decision. These three tables are user content and would belong in both; the
 * pair is added together on the day sync resumes. Until then a profile deletion
 * still takes them, through the `ON DELETE CASCADE` below, which is the path
 * that matters for privacy.
 *
 * **Two indexes.** `chess_games_profile_active` serves the only game read there
 * is — this profile's live games, newest first — and it is partial for the
 * reason every `_profile_active` index here is: the archive list never looks at
 * a soft-deleted row. `chess_resume` and `chess_level_stats` need none: both are
 * looked up by their primary key, which is the whole of the query.
 */
export const migration082: Migration = {
  version: 82,
  up(db) {
    db.exec(`
      CREATE TABLE chess_games (
        id           TEXT PRIMARY KEY,
        profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        pgn          TEXT NOT NULL CHECK (length(pgn) > 0 AND length(pgn) <= 32000),
        result       TEXT NOT NULL CHECK (result IN ('white', 'black', 'draw', 'unfinished')),
        played_at    TEXT NOT NULL,
        played_color TEXT NOT NULL CHECK (played_color IN ('w', 'b')),
        opponent     TEXT NOT NULL CHECK (opponent IN ('engine', 'human')),
        level        INTEGER CHECK (level IS NULL OR (typeof(level) = 'integer' AND level BETWEEN 1 AND 8)),
        time_control TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        deleted_at   TEXT,
        -- An engine game names its level; a game against a person has none.
        CHECK ((opponent = 'engine') = (level IS NOT NULL))
      );

      -- The only game read there is: this profile's live games, newest first.
      CREATE INDEX chess_games_profile_active
        ON chess_games (profile_id, played_at DESC, id DESC)
        WHERE deleted_at IS NULL;

      -- One game in progress per profile. profile_id IS the primary key: a
      -- second slot is not a thing a caller could ask for and get.
      CREATE TABLE chess_resume (
        profile_id   TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        start_fen    TEXT NOT NULL,
        fen          TEXT NOT NULL,
        moves        TEXT NOT NULL,
        played_color TEXT NOT NULL CHECK (played_color IN ('w', 'b')),
        opponent     TEXT NOT NULL CHECK (opponent IN ('engine', 'human')),
        level        INTEGER CHECK (level IS NULL OR (typeof(level) = 'integer' AND level BETWEEN 1 AND 8)),
        time_control TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        CHECK ((opponent = 'engine') = (level IS NOT NULL))
      );

      -- The player's record against each level. played is the SUM of the other
      -- three, and the CHECK is what stops a counter from drifting out of step
      -- with its own parts after a hundred increments.
      CREATE TABLE chess_level_stats (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        level      INTEGER NOT NULL CHECK (typeof(level) = 'integer' AND level BETWEEN 1 AND 8),
        played     INTEGER NOT NULL DEFAULT 0 CHECK (typeof(played) = 'integer' AND played >= 0),
        won        INTEGER NOT NULL DEFAULT 0 CHECK (typeof(won) = 'integer' AND won >= 0),
        drawn      INTEGER NOT NULL DEFAULT 0 CHECK (typeof(drawn) = 'integer' AND drawn >= 0),
        lost       INTEGER NOT NULL DEFAULT 0 CHECK (typeof(lost) = 'integer' AND lost >= 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, level),
        CHECK (played = won + drawn + lost)
      ) WITHOUT ROWID;
    `);
  },
};

