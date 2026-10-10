import type { Migration } from "./migrations.js";

/**
 * Migration 91 — the BOARD GAMES module's storage: the game a profile is in the
 * middle of, its record against the computer, and the module's one preference.
 *
 * **Three tables, and each answers a different question.** `boards_saves` is a
 * SLOT — at most one row per (profile, game), because "the game I am in the
 * middle of" is a single fact about a game and a second row would have to be
 * resolved by a rule nobody stated (`chess_resume`'s arrangement, one game over).
 * `boards_stats` is a RECORD — how the player has done against each level of each
 * game — and it is deliberately not derived from the saves: the number that tells
 * somebody to move up or down a level is their history at that level, and a saved
 * game that is abandoned or replaced must not take it away. `boards_settings` is
 * the module's one preference.
 *
 * **The state and the event log are JSON, and the invariant between them is the
 * store's, not this file's.** `state` is the engine's own `toJSON` output — the
 * canonical shape every board engine in `packages/core/src/games/` documents and
 * accepts back through `fromJSON`, so a resumed game is read by the very engine
 * that will play it. `events` is the move log the page draws as the move list, in
 * the module's own tagged vocabulary; `BoardsStore` REPLAYS it and refuses a write
 * whose result is not `state`, which is the one check a shape cannot make (a
 * position and a move list that disagree is a board showing one game and a move
 * list describing another). Both are TEXT holding `JSON.stringify` output and
 * nothing else — `habits.schedule`'s arrangement — and both carry a length bound,
 * because these values arrive from the renderer and every archive export then
 * carries them.
 *
 * **`seed` is the game's dice stream and the reason a game is replayable.** The
 * board engines never call `Math.random`; they draw from a seeded source the
 * caller holds (`games/random.ts`), so a game is a seed plus an input log. The
 * stream position itself is NOT stored here: a save carries the seed, and the
 * page re-reads the dice from the position the replayed log reaches, which is why
 * replaying the log is what makes a resumed game's dice the same dice.
 *
 * **`level` is nullable and the pair rule is the store's.** A game against the
 * computer names its level; a game against a person on the same machine has no
 * level to name. Whether a level is required follows from the SEATS, which are
 * JSON (`seats`, a list of `"human"`/`"computer"`, two for every game and two to
 * four for ludo), so this cannot be a table CHECK the way migration 082's
 * `((opponent = 'engine') = (level IS NOT NULL))` is. `BoardsStore` refuses both
 * halves of the pair.
 *
 * **No journal triggers, and no entry in `RESTORE_WIPE_TABLES`.** That list and
 * `@nexus/sync`'s collection map are held equal by `sync/collectionGuard.test.ts`,
 * and sync is on hold permanently, so a table added to one without a matching
 * entry in the other is a red gate rather than a decision (`chess_games`' exact
 * position since migration 082). These tables are user content and would belong in
 * both; the pair is added together on the day sync resumes. Until then a profile
 * deletion still takes them through the `ON DELETE CASCADE` below, which is the
 * path privacy depends on.
 *
 * **Two indexes.** `boards_saves_profile` covers the module's whole read — this
 * profile's saves, most recently touched first. `boards_stats` needs none: it is
 * read by its primary key's prefix and written by its primary key.
 */
export const migration091: Migration = {
  version: 91,
  up(db) {
    db.exec(`
      CREATE TABLE boards_saves (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        game       TEXT NOT NULL
                     CHECK (game IN ('reversi', 'draughts', 'mlin', 'backgammon',
                                     'four-in-a-row', 'ludo')),
        -- The engine's own toJSON output, canonical JSON.
        state      TEXT NOT NULL CHECK (length(state) BETWEEN 2 AND 16384),
        -- The move log, canonical JSON. Bounded for the reason state is: it
        -- comes off the wire and every archive carries it.
        events     TEXT NOT NULL CHECK (length(events) BETWEEN 2 AND 40000),
        -- The game's seeded dice stream, an unsigned 32-bit integer.
        seed       INTEGER NOT NULL
                     CHECK (typeof(seed) = 'integer' AND seed BETWEEN 0 AND 4294967295),
        level      INTEGER
                     CHECK (level IS NULL
                            OR (typeof(level) = 'integer' AND level BETWEEN 1 AND 3)),
        -- The seat kinds, JSON: ["human", "computer", ...].
        seats      TEXT NOT NULL CHECK (length(seats) BETWEEN 2 AND 128),
        moves      INTEGER NOT NULL
                     CHECK (typeof(moves) = 'integer' AND moves BETWEEN 0 AND 512),
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        -- One game in progress per game. The pair IS the primary key: a second
        -- slot is not a thing a caller could ask for and get.
        PRIMARY KEY (profile_id, game)
      ) WITHOUT ROWID;

      -- The only save read there is: this profile's games, most recently moved in
      -- first.
      CREATE INDEX boards_saves_profile ON boards_saves (profile_id, updated_at DESC);

      -- The player's record against each level of each game. played is the SUM of
      -- the other three, and the CHECK is what stops a counter from drifting out
      -- of step with its own parts after a hundred increments.
      --
      -- variant is '' for every game that has no variants, and the drawn rule set
      -- for draughts ('english' / 'russian'): the variant is DERIVED from the
      -- stored state by the store, never sent by the renderer, so an English game
      -- and a Russian one are two records rather than one.
      CREATE TABLE boards_stats (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        game       TEXT NOT NULL
                     CHECK (game IN ('reversi', 'draughts', 'mlin', 'backgammon',
                                     'four-in-a-row', 'ludo')),
        variant    TEXT NOT NULL DEFAULT ''
                     CHECK (variant IN ('', 'english', 'russian')),
        level      INTEGER NOT NULL
                     CHECK (typeof(level) = 'integer' AND level BETWEEN 1 AND 3),
        played     INTEGER NOT NULL DEFAULT 0
                     CHECK (typeof(played) = 'integer' AND played >= 0),
        won        INTEGER NOT NULL DEFAULT 0
                     CHECK (typeof(won) = 'integer' AND won >= 0),
        drawn      INTEGER NOT NULL DEFAULT 0
                     CHECK (typeof(drawn) = 'integer' AND drawn >= 0),
        lost       INTEGER NOT NULL DEFAULT 0
                     CHECK (typeof(lost) = 'integer' AND lost >= 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (profile_id, game, variant, level),
        CHECK (played = won + drawn + lost)
      ) WITHOUT ROWID;

      CREATE TABLE boards_settings (
        profile_id    TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        default_level INTEGER NOT NULL
                        CHECK (typeof(default_level) = 'integer'
                               AND default_level BETWEEN 1 AND 3),
        updated_at    TEXT NOT NULL
      );
    `);
  },
};
