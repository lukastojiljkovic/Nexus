import type { Migration } from "./migrations.js";

/**
 * Migration 88 — the PUZZLES module's storage (saved games, the per-grade
 * record, and the module's one preference).
 *
 * **Why this is a migration of its own rather than a row in the games tables.**
 * The arcade (080) and the card games (081) each key a running total by
 * `(profile, game, variant)` and it is tempting to hang a sudoku off the same
 * shape — but neither can carry one honestly. `arcade_scores.game` is a CHECK
 * over exactly two games and its row-level CHECKs say a Minesweeper row has no
 * score and a Blocks row cannot be won, so a third game there would have to
 * rewrite the rule that makes those rows trustworthy. `cardgame_saves` is a
 * SEED plus a MOVE LIST, which is what resumes a deal the engine folds from the
 * seed; a sudoku in progress is a grid of pencil marks, a nonogram is a grid of
 * marks and crosses, and a mahjong deal is a 144-tile arrangement — none of them
 * is a move list, and `cardgame_stats.variant` is a rules variant (Spider with
 * one suit) where a puzzle's variant is a DIFFICULTY or a BOARD SIZE, which is
 * the thing its record is about. So the module owns three tables, as the kit's
 * own worked example does.
 *
 * **The key is `(profile_id, puzzle, variant)` on both tables, for 081's
 * reason.** A sudoku is played at a grade, and a grade is not decoration: it is
 * the cap the generator dug to, so „hard" is a different puzzle from „medium"
 * at the same seed and a „best time" across the two means nothing. Keying on the
 * triple is also what makes „one game in progress" true in the only sense it
 * can be — one per puzzle AND grade — so starting a hard sudoku does not throw
 * away an easy one somebody was in the middle of.
 *
 * **`state_json` is the whole game, and the store re-validates it.** The column
 * holds the module's own JSON: the digits, the pencil marks, the marks and
 * crosses, the tiles that are left, the player's expression. It has a size
 * ceiling in the schema (and a sentence in the store) rather than being an
 * unbounded TEXT, because it arrives from outside — a stage 2 IPC payload or a
 * hand-edited archive — and an unbounded TEXT goes into a row every export then
 * carries. Nothing here parses it: a JSON blob validated by a CHECK would be a
 * rule written in SQL that no test can read.
 *
 * **`best_time_seconds`, not milliseconds.** The arcade bills a Minesweeper best
 * in milliseconds because that is the resolution a sweep is timed at; a puzzle
 * sitting is measured in whole seconds (the same unit `elapsed_seconds` carries
 * here and in `cardgame_saves`), and a store that wrote one in ms and the other
 * in seconds is how a factor of a thousand gets shipped.
 *
 * **INTEGERs are checked with `typeof(x) = 'integer'`, never trusted to INTEGER
 * affinity** — the FIN lesson (migration 051): SQLite converts a REAL to an
 * INTEGER only when the conversion is lossless, so `12.5` would sit in a column
 * declared INTEGER and every later read would be a float.
 *
 * **Two coupled CHECKs, safe for 081's stated reason.** `solved <= played` and
 * „only Broj has a distance" tie columns together, which ADR-082 §3 warns about
 * for SYNCED collections; these tables are not synced (sync is on hold, they
 * carry no journal trigger from migration 063), and the only writer is
 * `PuzzlesStore` through methods that maintain both together.
 *
 * **`puzzles_settings` is one row per profile** — the module's one preference,
 * „check while typing" (whether a sudoku marks a conflict as it is played, which
 * ships OFF for the reason the product asks for it only when the user asks).
 * A PROFILE row rather than a device one: main reads it, and it therefore
 * travels in the profile's own archive. `settings()` answers false where there
 * is no row, so a fresh profile needs no seeding.
 */
export const migration088: Migration = {
  version: 88,
  up(db) {
    db.exec(`
      CREATE TABLE puzzles_saves (
        profile_id      TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        puzzle          TEXT NOT NULL CHECK (puzzle IN ('sudoku', 'nonogram', 'mahjong', 'broj')),
        variant         TEXT NOT NULL CHECK (length(variant) > 0 AND length(variant) <= 32),
        -- The seed the puzzle was dealt from. For sudoku the board travels in
        -- state_json as well (see the store's note); for the other three this
        -- is what regenerates the puzzle, so it is the row's only handle on it.
        seed            INTEGER NOT NULL CHECK (typeof(seed) = 'integer' AND seed >= 0),
        state_json      TEXT NOT NULL CHECK (length(state_json) > 0 AND length(state_json) <= 32000),
        elapsed_seconds INTEGER NOT NULL
                          CHECK (typeof(elapsed_seconds) = 'integer'
                                 AND elapsed_seconds >= 0
                                 AND elapsed_seconds <= 86400),
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        PRIMARY KEY (profile_id, puzzle, variant)
      );

      CREATE TABLE puzzles_stats (
        profile_id        TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        puzzle            TEXT NOT NULL CHECK (puzzle IN ('sudoku', 'nonogram', 'mahjong', 'broj')),
        variant           TEXT NOT NULL CHECK (length(variant) > 0 AND length(variant) <= 32),
        played            INTEGER NOT NULL DEFAULT 0
                            CHECK (typeof(played) = 'integer' AND played >= 0),
        solved            INTEGER NOT NULL DEFAULT 0
                            CHECK (typeof(solved) = 'integer' AND solved >= 0),
        -- NULL until a game is finished: a puzzle abandoned in ten seconds is
        -- not a best time, and a grade nobody has finished has none at all.
        best_time_seconds INTEGER
                            CHECK (best_time_seconds IS NULL
                                   OR (typeof(best_time_seconds) = 'integer'
                                       AND best_time_seconds > 0
                                       AND best_time_seconds <= 86400)),
        -- Broj only: how far the closest finished attempt was from the target.
        best_distance     INTEGER
                            CHECK (best_distance IS NULL
                                   OR (typeof(best_distance) = 'integer'
                                       AND best_distance >= 0
                                       AND best_distance <= 1000)),
        updated_at        TEXT NOT NULL,
        PRIMARY KEY (profile_id, puzzle, variant),
        CHECK (solved <= played),
        -- A row carries its own puzzle's numbers and no other puzzle's.
        CHECK (puzzle = 'broj' OR best_distance IS NULL)
      );

      CREATE TABLE puzzles_settings (
        profile_id         TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        check_while_typing INTEGER NOT NULL CHECK (check_while_typing IN (0, 1)),
        updated_at         TEXT NOT NULL
      );
    `);
  },
};
