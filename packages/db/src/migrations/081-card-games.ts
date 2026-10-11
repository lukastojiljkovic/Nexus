import type { Migration } from "./migrations.js";

/**
 * Migration 81 — the GAMES card module's storage (stage 1 of the module).
 *
 * Two tables and one key, and everything else is a decision written into the
 * schema rather than left to a store to remember.
 *
 * **The key is `(profile_id, game, variant)` on both tables.** A card game is
 * played in a variant: Klondike draw-one is not draw-three, Spider with one suit
 * is not Spider with four, and a „win" over one of them says nothing about the
 * other. Statistics and the saved game in progress therefore hang off the same
 * triple, which is also what makes „one saved game per game" true in the only
 * sense it can be — one per game AND variant, so starting a draw-three game does
 * not throw away a draw-one game somebody was in the middle of. The primary key
 * is the only index either table needs: every read in the store is by profile,
 * then by game, then by variant, and that is the key's own order.
 *
 * **There is no `deleted_at`, and no `rank`.** The soft delete is for user
 * CONTENT — a note, a habit, a document — where an undo is owed to the person who
 * wrote it. A counter of wins is not a thing anybody wrote, and a saved game is
 * a snapshot whose whole purpose is to be replaced or dropped; `clearProgress`
 * hard-deletes it, and the profile cascade takes both tables with it. Nothing
 * here is hand-ordered either, so migration 062's fractional rank has nothing to
 * express.
 *
 * **Integers are checked with `typeof(x) = 'integer'`, never trusted to INTEGER
 * affinity** — the FIN lesson (migration 051): SQLite converts a REAL to an
 * INTEGER only when the conversion is lossless, so `12.5` would sit in a column
 * declared INTEGER and every total over it would be a float from then on. The
 * test beside this migration records the other half of that affinity rule so the
 * next reader does not have to rediscover it: a NUMERIC STRING (`'480'`) is
 * converted to the integer it spells and passes, which is why the case the test
 * refuses is a string that is not a number at all. Elapsed
 * seconds carry a ceiling for the same reason it exists in `HabitStore`: an
 * untrusted caller's number goes into a column, and a bound is one line whereas
 * discovering its absence is a release. Twenty-four hours of one sitting is
 * already absurd for a card game.
 *
 * **Two coupled CHECKs, and they are safe here because nothing merges rows.**
 * `won <= played` and `current_streak <= longest_streak` tie two columns
 * together, which ADR-082 §3 warns about — a field-level merge can produce a
 * combination the database refuses. That warning is about SYNCED collections, and
 * these tables are not synced: sync is on hold, they carry no journal trigger
 * from migration 063, and they are absent from `RESTORE_WIPE_TABLES` and from
 * `@nexus/sync`'s map, so the only writer is `CardGameStore` through one method
 * that maintains both pairs. The day these tables sync, the ledger in
 * `@nexus/sync` and a repair are owed with it.
 *
 * **`game` is a CHECK and `variant`'s SHAPE is one; `variant`'s vocabulary is
 * not.** `game` is the closed list of games the engines deal, so the schema states
 * it exactly as `arcade_scores` states its two — and it was extended IN PLACE on
 * 2026-10-10, before this migration ever shipped, when Pyramid, TriPeaks, Golf,
 * Hearts, Spades and Tablić joined Klondike, FreeCell and Spider: an unreleased
 * migration is not a historical record, and a second migration adding six words
 * to a CHECK would mean rebuilding the table for a vocabulary the release notes
 * never described. `variant` is a per-game vocabulary
 * the store validates against `@nexus/core`'s `CARD_GAME_VARIANTS`, exactly as
 * `note_folders`' palette is validated in the store rather than in the schema
 * (migration 011's choice, made so that a palette — or a Spider variant — can
 * evolve without a migration). One definition, in the package both sides already
 * import; what the schema can bound without knowing the vocabulary is its length,
 * and it carries the same `1..32` bound `arcade_scores.variant` carries.
 *
 * **The counts and the time are spelled as `arcade_scores` spells them** —
 * `played`, `won`, `best_time_ms`, `current_streak`, `longest_streak` — so the two
 * games tables read with one vocabulary. The elapsed time a SAVED game carries
 * stays in whole seconds (`cardgame_saves.elapsed_seconds`): that is the game's
 * own clock rather than a best, and only the recorded best is billed in
 * milliseconds, as the arcade's is.
 *
 * **`moves_json` is the whole saved game.** A move list is what resumes a deal
 * (`replayKlondike`/`replayFreeCell`/`replaySpider` fold it from the seed), so the
 * column holds a JSON array of the engine's own move shape and the store
 * re-validates every entry and the whole replay on the way in. It has a size
 * ceiling in the store rather than in SQL, because the sentence a user needs —
 * „this saved game is too long to keep" — cannot come out of a CHECK.
 */
export const migration081: Migration = {
  version: 81,
  up(db) {
    db.exec(`
      CREATE TABLE cardgame_stats (
        profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        game              TEXT NOT NULL CHECK (game IN (
                            'klondike', 'freecell', 'spider',
                            'pyramid', 'tripeaks', 'golf',
                            'hearts', 'spades', 'tablic')),
        variant           TEXT NOT NULL CHECK (length(variant) > 0 AND length(variant) <= 32),
        played            INTEGER NOT NULL DEFAULT 0
                            CHECK (typeof(played) = 'integer' AND played >= 0),
        won               INTEGER NOT NULL DEFAULT 0
                            CHECK (typeof(won) = 'integer' AND won >= 0),
        -- NULL until the first win: a deal abandoned at 300 points is not a best
        -- score, and a game nobody has won has no best time at all.
        best_time_ms      INTEGER
                            CHECK (best_time_ms IS NULL
                                   OR (typeof(best_time_ms) = 'integer' AND best_time_ms >= 0)),
        -- No floor: Spider's published score starts at 500 and loses a point a
        -- move, so a long win can end below zero.
        best_score        INTEGER
                            CHECK (best_score IS NULL OR typeof(best_score) = 'integer'),
        current_streak    INTEGER NOT NULL DEFAULT 0
                            CHECK (typeof(current_streak) = 'integer' AND current_streak >= 0),
        longest_streak    INTEGER NOT NULL DEFAULT 0
                            CHECK (typeof(longest_streak) = 'integer' AND longest_streak >= 0),
        updated_at        TEXT NOT NULL,
        PRIMARY KEY (profile_id, game, variant),
        CHECK (won <= played),
        CHECK (current_streak <= longest_streak)
      );

      CREATE TABLE cardgame_saves (
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        game            TEXT NOT NULL,
        variant         TEXT NOT NULL,
        -- The seed a deal is dealt from; for FreeCell it is the deal NUMBER, so
        -- the same column carries „game 617" and „a shuffled Spider table".
        seed            INTEGER NOT NULL CHECK (typeof(seed) = 'integer' AND seed >= 0),
        moves_json      TEXT NOT NULL CHECK (length(moves_json) > 0),
        elapsed_seconds INTEGER NOT NULL
                          CHECK (typeof(elapsed_seconds) = 'integer'
                                 AND elapsed_seconds >= 0
                                 AND elapsed_seconds <= 86400),
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        PRIMARY KEY (profile_id, game, variant)
      );
    `);
  },
};
