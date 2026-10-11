import type { Migration } from "./migrations.js";

/**
 * Migration 80 — the GAMES arcade's scores (task „Minesweeper and Blocks",
 * stage 1). ONE table for the arcade's games, and no more: the card games and
 * chess own their own tables (their runs say so), so every CHECK below may be
 * written about the arcade's own games rather than about a game column that
 * might one day hold something else.
 *
 * **THE GAME LIST WAS EXTENDED IN PLACE on 2026-10-10, before this migration
 * ever shipped.** Stage 2 of the module added Snake, Bricks and 2048 to the two
 * games stage 1 counted, and an UNRELEASED migration is not a historical
 * record: a second migration whose whole content is three more words in a CHECK
 * would rebuild the table for a vocabulary no release note ever described.
 * `081-card-games.ts` extends its own list in place on the same day, for the
 * same reason.
 *
 * **Every game's row carries what THAT game measures.** Two of the five have a
 * win to count and three do not, so the rule is written per game rather than
 * per table:
 *
 *  - `minesweeper` - won games, their best time, and nothing else. The average
 *    player loses more than they win, and a loss has no time worth keeping.
 *  - `blocks` - a score and the lines that earned it. It can never win, so it
 *    never starts a streak.
 *  - `snake` - a score and the food the run ate. Also no win: the snake dies on
 *    a wall or on itself, and a board eaten whole is a freak rather than a
 *    victory the player aims at.
 *  - `bricks` - a score and the levels cleared. Also no win: a wall goes down, a
 *    new one is drawn, and only the third lost ball ends the game.
 *  - `tile2048` - a score, the moves played, and whether 2048 was REACHED. Its
 *    `won` is the one flag among the three new games, and it is honest: the
 *    engine sets it the moment the tile appears and keeps the board playable
 *    afterwards, so a run of games that got there IS a streak.
 *
 * `best_lines` is read per game because of that table, and each game's own
 * reader names what its value holds: lines for Blocks, food for Snake, levels
 * for Bricks, moves for 2048. The alternative is a fourth column per game for
 * four unread numbers.
 *
 * **One row per (profile, game, variant), and the variant is the BOARD.** A
 * Minesweeper best time means nothing across board shapes — 9 × 9 with ten mines
 * against 30 × 16 with ninety-nine — so the key carries the board, and
 * `@nexus/core`'s `minesweeperVariant` derives it from the config (a preset's own
 * name, or `custom:COLUMNSxROWSxMINES`) rather than letting a caller name its own
 * bucket. Blocks has one board, so it has one variant. The UNIQUE index is
 * therefore not only a dedupe: it is the identity of the thing being counted, and
 * it doubles as the table's only read index — every read is „this profile's
 * rows", which is this index's own prefix.
 *
 * **The row is a RUNNING TOTAL, not a game.** No per-game history is kept, and
 * that is the model rather than an omission: nobody wants a ledger of their
 * losses, the numbers a player actually looks at are all aggregates (played, won,
 * the two bests, the two streaks, when), and a history table would be a second
 * thing for the archive to carry and the merge to get wrong.
 * `ArcadeScoreStore.record` folds one finished game into the row in a single
 * transaction.
 *
 * **What the CHECKs below are for.** They are what makes a row that mixes two
 * games' numbers impossible to write at all, and the extension above is what
 * they now cover: three of the five games carry both counts and never a win, and
 * 2048 is the one new game that can win.
 *
 * **A row carries only what its own game measures, and the CHECKs make the mixed
 * row unrepresentable.** A Minesweeper row has no score and no line count; a
 * Blocks row has no time, cannot have won, and always has a score and a line
 * count — a Blocks game is over when a piece cannot be dealt, and the numbers are
 * known at that moment, so a Blocks row without them would be a game nobody
 * finished. `won <= played`, `current_streak <= longest_streak` and
 * `current_streak <= won` are the same idea for the counting columns: a run of
 * wins cannot be longer than the wins it was drawn from, nor than the longest
 * run recorded.
 *
 * **No `deleted_at`.** Every other user-content table in this schema has one, and
 * this one does not, because there is nothing to delete: a score row is a
 * running total nobody points at, no screen offers to remove one, and a soft
 * delete with no undelete path would be a column that only ever holds NULL. A
 * profile deletion takes the row through the ordinary `ON DELETE CASCADE`.
 *
 * **Values are INTEGERs with `typeof(x) = 'integer'` CHECKs**, the FIN lesson
 * (migration 051) applied here as it is in `habits` (055) and `fit_*` (060):
 * SQLite converts a REAL to an INTEGER only when the conversion is lossless, so
 * `12.5` would sit happily in an `INTEGER` column and every later sum over it
 * would be a float.
 *
 * **Bounds are sanity caps, not opinions** (`MAX_HABIT_COUNT`'s arrangement):
 * a game longer than a week is a board somebody left open, a score past a hundred
 * million or a line count past a hundred thousand are numbers no real run of this
 * game reaches. A bound is cheaper than discovering the absence of one.
 *
 * **No sync triggers, deliberately.** Sync is on hold; a new table declares
 * nothing in migration 063's journal, so this one is neither journaled nor
 * mentioned in `@nexus/sync`'s collection map.
 */
export const migration080: Migration = {
  version: 80,
  up(db) {
    db.exec(`
      CREATE TABLE arcade_scores (
        id             TEXT PRIMARY KEY,
        profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        game           TEXT NOT NULL CHECK (game IN (
                         'minesweeper', 'blocks', 'snake', 'bricks', 'tile2048')),
        variant        TEXT NOT NULL CHECK (length(variant) > 0 AND length(variant) <= 32),
        played         INTEGER NOT NULL
                         CHECK (typeof(played) = 'integer' AND played >= 0),
        won            INTEGER NOT NULL
                         CHECK (typeof(won) = 'integer' AND won >= 0),
        best_time_ms   INTEGER
                         CHECK (best_time_ms IS NULL OR
                                (typeof(best_time_ms) = 'integer' AND
                                 best_time_ms > 0 AND best_time_ms <= 604800000)),
        best_score     INTEGER
                         CHECK (best_score IS NULL OR
                                (typeof(best_score) = 'integer' AND
                                 best_score >= 0 AND best_score <= 100000000)),
        best_lines     INTEGER
                         CHECK (best_lines IS NULL OR
                                (typeof(best_lines) = 'integer' AND
                                 best_lines >= 0 AND best_lines <= 100000)),
        current_streak INTEGER NOT NULL
                         CHECK (typeof(current_streak) = 'integer' AND current_streak >= 0),
        longest_streak INTEGER NOT NULL
                         CHECK (typeof(longest_streak) = 'integer' AND longest_streak >= 0),
        last_played_at TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        -- A run of wins cannot be longer than the wins, and a win is a game.
        CHECK (current_streak <= longest_streak),
        CHECK (current_streak <= won),
        CHECK (won <= played),
        -- A row carries its own game's numbers and no other game's. The three
        -- winless games are one rule written three times rather than a list
        -- column, so the day one of them gains a win its own line changes.
        CHECK (game <> 'minesweeper' OR (best_score IS NULL AND best_lines IS NULL)),
        CHECK (game <> 'blocks' OR
               (best_time_ms IS NULL AND won = 0 AND current_streak = 0 AND
                longest_streak = 0 AND best_score IS NOT NULL AND best_lines IS NOT NULL)),
        CHECK (game <> 'snake' OR
               (best_time_ms IS NULL AND won = 0 AND current_streak = 0 AND
                longest_streak = 0 AND best_score IS NOT NULL AND best_lines IS NOT NULL)),
        CHECK (game <> 'bricks' OR
               (best_time_ms IS NULL AND won = 0 AND current_streak = 0 AND
                longest_streak = 0 AND best_score IS NOT NULL AND best_lines IS NOT NULL)),
        -- 2048 is the one new game with a win, and the one without a time.
        CHECK (game <> 'tile2048' OR
               (best_time_ms IS NULL AND best_score IS NOT NULL AND best_lines IS NOT NULL))
      );

      -- The row's identity AND the table's only read index: every query is
      -- scoped to one profile and wants that profile's rows.
      CREATE UNIQUE INDEX arcade_scores_profile_game
        ON arcade_scores (profile_id, game, variant);
    `);
  },
};
