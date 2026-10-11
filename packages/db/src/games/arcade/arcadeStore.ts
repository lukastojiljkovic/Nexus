import type Database from "better-sqlite3-multiple-ciphers";
import { MAX_ID_LENGTH } from "@nexus/core";
import { ArcadeValidationError } from "../../errors.js";
import { uuidv7 } from "../../ids.js";
import { isDateTime } from "../../finance/money.js";

type DatabaseHandle = Database.Database;

/**
 * The GAMES arcade's scores (migration 080) — one row per profile, game and
 * board, folded forward every time a game ends.
 *
 * **`record` is the whole API of the thing that matters, and it is one
 * transaction.** A finished game moves several numbers at once (played, won, the
 * bests, the two streaks, when) and they have to move TOGETHER: a crash between
 * the „played" write and the „best" write would leave a row that says a game
 * happened and does not know how it went, and the next record would build on
 * that. So the read, the fold and the write are one `db.transaction`.
 *
 * **The row is a running total, so a second game is never a second row.**
 * Migration 080's unique index on (profile, game, variant) is what makes that
 * true, and this store names it as its conflict target — the `HabitStore` /
 * `FinRecurringStore` arrangement: a real update through the index rather than a
 * read-then-branch two callers could race through.
 *
 * **What a game is worth is decided here, not by the caller.** A Minesweeper game
 * sets a best time only when it was WON — a loss has no time worth keeping — and
 * only when it beats the row's best. A Blocks game raises the best score and the
 * best line count and can never win, which the schema states as well as this
 * store. A streak is a run of WINS: a loss ends it, and a game with no win
 * condition never starts one. `longestStreak` is the record the current one is
 * measured against and only ever rises — a later loss cannot take away what
 * somebody did.
 *
 * **The five games measure five different things, and the fold is the same
 * shape for all of them.** Stage 2 added Snake, Bricks and 2048 (the same day,
 * in place - see `ARCADE_GAMES`): the three score games raise `bestScore` and
 * their own second count, 2048 raises its streak when the winning tile appears,
 * and the two rules that were here already - a best only ever improving in its
 * game's own direction, and a win recorded only for a game that has one - carry
 * every arm of the union without a branch per game. The direction is what the
 * caller cannot get wrong: a time is lowered, a score is raised, and a count is
 * raised, and this file is where that is decided rather than a screen.
 *
 * **`exportData`/`importData` are the archive's door, and the import REPLACES.**
 * The export is a versioned plain value — `{ version: 1, scores: [...] }` — and it
 * deliberately carries no `profileId`: a profile archive belongs to the profile it
 * is restored into, and the restore is what retargets it (the `RestoreStore`
 * arrangement). The import validates the WHOLE value before it writes a row,
 * because a half-applied archive is worse than a refused one, and it refuses an
 * unknown version rather than guessing. Replacing rather than merging is the part
 * worth stating: two score tables merged by maximum would produce a streak neither
 * device ever ran, and a „best time" from another profile is not this profile's
 * best at anything.
 *
 * `now` is supplied by the caller and validated here — main stamps the clock, the
 * renderer never does.
 */

/**
 * The games this table holds, in the order the shelf shows them.
 *
 * Extended IN PLACE on 2026-10-10, with migration 080's own CHECK, before either
 * ever shipped: stage 2 of the module added Snake, Bricks and 2048 to the two
 * games stage 1 counted, and the migration header argues why an unreleased
 * migration is edited rather than followed by a second one whose whole content
 * is three words.
 */
export const ARCADE_GAMES = ["minesweeper", "blocks", "snake", "bricks", "tile2048"] as const;
export type ArcadeGame = (typeof ARCADE_GAMES)[number];

/**
 * The games that have no win to count, in one list for the store's own rules.
 *
 * Three of them rather than a `game IN (...)` spelled at each site: the fold,
 * the import's validation and the schema all have to agree that these three
 * never win, and a list with a name is the only shape that can be pointed at.
 * 2048 is deliberately NOT here - the engine sets `won` the moment the tile
 * appears - and neither is Minesweeper.
 */
const WINLESS_GAMES: readonly ArcadeGame[] = ["blocks", "snake", "bricks"];

/**
 * What a variant key may look like: lower-case alphanumeric words joined by
 * colons — `beginner`, `expert`, `standard`, `custom:9x9x10`. The SHAPE is
 * checked here; the MEANING is `@nexus/core`'s (`minesweeperVariant` derives it
 * from the board, so no caller invents a bucket), which is why this store keeps no
 * list of the keys it accepts.
 */
const VARIANT_SHAPE = /^[a-z0-9]+(?::[a-z0-9]+)*$/;
export const MAX_ARCADE_VARIANT_LENGTH = 32;

/**
 * Bounds, not opinions — `MAX_HABIT_COUNT`'s arrangement. A week is longer than a
 * game of Minesweeper takes and short enough that a corrupt value cannot pretend
 * to be one; a hundred million points and a hundred thousand lines are past
 * anything a real run of Blocks reaches.
 */
export const MAX_ARCADE_TIME_MS = 604_800_000;
export const MAX_ARCADE_SCORE = 100_000_000;
export const MAX_ARCADE_LINES = 100_000;

/**
 * Serbian Latin ordering, the house collator (`FIN_COLLATOR`'s terms — plain
 * `"sr"` mis-tailors š/č/ć/ž). Variant keys are ASCII today, and the day one is
 * not, this is already right.
 */
const ARCADE_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** One board's running total. */
export interface ArcadeScore {
  id: string;
  profileId: string;
  game: ArcadeGame;
  /** The board this row counts: a Minesweeper preset or `custom:CxRxM`, a 2048 board's `4x4`, or the one board Blocks, Snake and Bricks each have, which is `standard`. */
  variant: string;
  /** Finished games. */
  played: number;
  won: number;
  /** The fastest WON Minesweeper game in milliseconds, or null — never a loss's time. */
  bestTimeMs: number | null;
  /** The best score the game ever reached; always null for Minesweeper, which has no score. */
  bestScore: number | null;
  /** The best of the game's own second count in one game: lines for Blocks, food for Snake, levels for Bricks, moves for 2048. Always null for Minesweeper. */
  bestLines: number | null;
  /** The current run of consecutive wins. A loss ends it; the three winless games never start one. */
  currentStreak: number;
  /** The longest run of consecutive wins ever recorded; only ever rises. */
  longestStreak: number;
  lastPlayedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One finished game, in the shape its own game has.
 *
 * The union is the point: every arm carries exactly the fields its game measures
 * and no others, which is what keeps the store from having to interpret a
 * number. Three of the five cannot win at all, so a caller still cannot hand Blocks a
 * „won" and make this store the only thing between that and a nonsensical row.
 */
export type ArcadeResult =
  | {
      game: "minesweeper";
      variant: string;
      won: boolean;
      /** Milliseconds the game took, or null. Required for a win: a win with no time has no best time to keep. */
      timeMs: number | null;
    }
  | {
      game: "blocks";
      variant: string;
      score: number;
      lines: number;
    }
  | {
      game: "snake";
      variant: string;
      score: number;
      /** Food eaten: how far past its opening four cells the snake grew. */
      eaten: number;
    }
  | {
      game: "bricks";
      variant: string;
      score: number;
      /** Levels whose wall was cleared before the three lives ran out. */
      levels: number;
    }
  | {
      game: "tile2048";
      variant: string;
      score: number;
      /** Moves that changed the board; a direction that moves nothing is not one. */
      moves: number;
      /** True once 2048 appeared, whether or not the player carried on afterwards. */
      won: boolean;
    };

/** One row as the archive carries it: everything but the profile, which the restore supplies. */
export interface ArcadeExportScore {
  id: string;
  game: ArcadeGame;
  variant: string;
  played: number;
  won: number;
  bestTimeMs: number | null;
  bestScore: number | null;
  bestLines: number | null;
  currentStreak: number;
  longestStreak: number;
  lastPlayedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** The arcade's slice of a profile archive. `version` is the ONLY compatibility gate, so it is checked first and refused loudly. */
export interface ArcadeExport {
  version: 1;
  scores: readonly ArcadeExportScore[];
}

/** The archive shape this build writes, and the only one it reads. */
export const ARCADE_EXPORT_VERSION = 1;

interface ArcadeScoreRow {
  id: string;
  profile_id: string;
  game: string;
  variant: string;
  played: number;
  won: number;
  best_time_ms: number | null;
  best_score: number | null;
  best_lines: number | null;
  current_streak: number;
  longest_streak: number;
  last_played_at: string;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, profile_id, game, variant, played, won, best_time_ms, best_score, best_lines, " +
  "current_streak, longest_streak, last_played_at, created_at, updated_at";

/** The archive's field list, and the whole of what an imported entry may carry. */
const EXPORT_KEYS: ReadonlyArray<keyof ArcadeExportScore> = [
  "id",
  "game",
  "variant",
  "played",
  "won",
  "bestTimeMs",
  "bestScore",
  "bestLines",
  "currentStreak",
  "longestStreak",
  "lastPlayedAt",
  "createdAt",
  "updatedAt",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateNow(value: unknown): string {
  if (typeof value !== "string" || !isDateTime(value)) {
    throw new ArcadeValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}

function validateGame(value: unknown): ArcadeGame {
  if (typeof value !== "string" || !(ARCADE_GAMES as readonly string[]).includes(value)) {
    throw new ArcadeValidationError(
      `"game" must be one of ${ARCADE_GAMES.join(" / ")}, got ${JSON.stringify(value)}.`,
    );
  }
  return value as ArcadeGame;
}

function validateVariant(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ARCADE_VARIANT_LENGTH ||
    !VARIANT_SHAPE.test(value)
  ) {
    throw new ArcadeValidationError(
      `"variant" must be a lower-case key of at most ${MAX_ARCADE_VARIANT_LENGTH} ` +
        `characters — the board's own name, like "beginner" or "custom:9x9x10".`,
    );
  }
  return value;
}

function validateId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new ArcadeValidationError(
      `"id" must be a non-empty string of at most ${MAX_ID_LENGTH} characters.`,
    );
  }
  return value;
}

/** A whole number inside `[min, max]`, `typeof`-checked the way the columns' CHECKs are: a float in an INTEGER column is the FIN defect (migration 051). */
function validateCount(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ArcadeValidationError(
      `"${field}" must be a whole number between ${min} and ${max}, got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/** A count that may honestly be absent — a Minesweeper row with no win yet has no best time. */
function nullableCount(value: unknown, field: string, min: number, max: number): number | null {
  if (value === null || value === undefined) return null;
  return validateCount(value, field, min, max);
}

/**
 * A score game's own second count, read from the field its game names it by.
 *
 * One field per game rather than one shared name: the ROW keeps one column, and
 * the WIRE keeps each game's own words - Blocks counts lines, Snake food,
 * Bricks levels, 2048 moves - so a caller that read `result.eaten` on a Blocks
 * result is a compile error rather than a silent zero. The bound is
 * `MAX_ARCADE_LINES` for all four, because all four are one game's tally of a
 * hundred thousand of a thing nobody counts past.
 */
function countOf(result: ArcadeResult): number | null {
  switch (result.game) {
    case "blocks":
      return validateCount(result.lines, "lines", 0, MAX_ARCADE_LINES);
    case "snake":
      return validateCount(result.eaten, "eaten", 0, MAX_ARCADE_LINES);
    case "bricks":
      return validateCount(result.levels, "levels", 0, MAX_ARCADE_LINES);
    case "tile2048":
      return validateCount(result.moves, "moves", 0, MAX_ARCADE_LINES);
    case "minesweeper":
      return null;
  }
}

function validateStamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !isDateTime(value)) {
    throw new ArcadeValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}

export class ArcadeScoreStore {
  private readonly selectRow: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly upsertRow: Database.Statement;
  private readonly insertExact: Database.Statement;
  private readonly deleteProfile: Database.Statement;
  private readonly selectForeignId: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectRow = db.prepare(
      `SELECT ${COLUMNS} FROM arcade_scores WHERE profile_id = ? AND game = ? AND variant = ?`,
    );
    this.selectAll = db.prepare(`SELECT ${COLUMNS} FROM arcade_scores WHERE profile_id = ?`);
    // The conflict target names migration 080's unique index and ONLY it, so a
    // violated CHECK on the way in still throws instead of being swallowed as a
    // duplicate. `created_at` is left alone on the update: the row is the same
    // board's answer, folded forward.
    this.upsertRow = db.prepare(
      `INSERT INTO arcade_scores
         (id, profile_id, game, variant, played, won, best_time_ms, best_score, best_lines,
          current_streak, longest_streak, last_played_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id, game, variant) DO UPDATE SET
         played         = excluded.played,
         won            = excluded.won,
         best_time_ms   = excluded.best_time_ms,
         best_score     = excluded.best_score,
         best_lines     = excluded.best_lines,
         current_streak = excluded.current_streak,
         longest_streak = excluded.longest_streak,
         last_played_at = excluded.last_played_at,
         updated_at     = excluded.updated_at`,
    );
    // The restore path: every field is written as it was exported, `created_at`
    // included, so an archive round trip gives back the rows it took.
    this.insertExact = db.prepare(
      `INSERT INTO arcade_scores
         (id, profile_id, game, variant, played, won, best_time_ms, best_score, best_lines,
          current_streak, longest_streak, last_played_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.deleteProfile = db.prepare(`DELETE FROM arcade_scores WHERE profile_id = ?`);
    // Row ids are GLOBAL primary keys here as they are in every other table
    // (ADR-023 §1), so an archive's rows land only where their ids are free —
    // never beside the profile they came from. Probed rather than left to the
    // driver so the refusal is a sentence instead of `SQLITE_CONSTRAINT`.
    this.selectForeignId = db.prepare(
      `SELECT id FROM arcade_scores WHERE profile_id <> ? AND id = ?`,
    );
  }

  /**
   * Folds one finished game into its board's row and returns the row as it now
   * stands. The read, the fold and the write are one transaction (see the class
   * doc), and everything the fold depends on is validated BEFORE the transaction
   * opens — so an invalid result changes nothing at all.
   */
  record(result: ArcadeResult, now: string): ArcadeScore {
    const stamp = validateNow(now);
    const game = validateGame(result.game);
    const variant = validateVariant(result.variant);

    let won = false;
    let timeMs: number | null = null;
    let score: number | null = null;
    let lines: number | null = null;
    if (result.game === "minesweeper") {
      if (typeof result.won !== "boolean") {
        throw new ArcadeValidationError(`"won" must be true or false.`);
      }
      won = result.won;
      timeMs = nullableCount(result.timeMs, "timeMs", 1, MAX_ARCADE_TIME_MS);
      if (won && timeMs === null) {
        throw new ArcadeValidationError(
          `A won Minesweeper game must carry its "timeMs" — a win with no time has no best time to keep.`,
        );
      }
    } else {
      score = validateCount(result.score, "score", 0, MAX_ARCADE_SCORE);
      lines = countOf(result);
      // 2048 alone among the score games can win, and its `won` is the engine's
      // own: the tile appeared, whether or not the player carried on.
      if (result.game === "tile2048") {
        if (typeof result.won !== "boolean") {
          throw new ArcadeValidationError(`"won" must be true or false.`);
        }
        won = result.won;
      }
    }

    const fold = this.db.transaction((): void => {
      const existing = this.selectRow.get(this.profileId, game, variant) as
        | ArcadeScoreRow
        | undefined;
      const faster =
        won && timeMs !== null && (existing?.best_time_ms == null || timeMs < existing.best_time_ms);
      const currentStreak = won ? (existing?.current_streak ?? 0) + 1 : 0;
      this.upsertRow.run(
        uuidv7(),
        this.profileId,
        game,
        variant,
        (existing?.played ?? 0) + 1,
        // General because it can be: the three winless games always arrive with
        // `won` false, so their column stays where the schema requires it.
        (existing?.won ?? 0) + (won ? 1 : 0),
        faster ? timeMs : (existing?.best_time_ms ?? null),
        score === null ? null : Math.max(score, existing?.best_score ?? 0),
        lines === null ? null : Math.max(lines, existing?.best_lines ?? 0),
        currentStreak,
        Math.max(existing?.longest_streak ?? 0, currentStreak),
        stamp,
        existing?.created_at ?? stamp,
        stamp,
      );
    });
    fold();

    return this.toScore(this.mustRow(game, variant));
  }

  /** One board's row, or null when this profile has never finished a game of it. */
  get(game: ArcadeGame, variant: string): ArcadeScore | null {
    const row = this.selectRow.get(this.profileId, validateGame(game), validateVariant(variant)) as
      | ArcadeScoreRow
      | undefined;
    return row === undefined ? null : this.toScore(row);
  }

  /** Every row this profile has, ordered by game and then board (see the collator). */
  list(): ArcadeScore[] {
    const rows = this.selectAll.all(this.profileId) as ArcadeScoreRow[];
    return rows
      .map((row) => this.toScore(row))
      .sort(
        (left, right) =>
          ARCADE_COLLATOR.compare(left.game, right.game) ||
          ARCADE_COLLATOR.compare(left.variant, right.variant) ||
          left.id.localeCompare(right.id),
      );
  }

  /**
   * This profile's scores as a versioned plain value, ready for a profile archive.
   * No `profileId` rides in it (see the class doc), and the row ids DO: a round
   * trip through an archive has to give back the rows it took, not equivalent ones
   * under new names.
   */
  exportData(): ArcadeExport {
    return {
      version: ARCADE_EXPORT_VERSION,
      scores: this.list().map((score) => ({
        id: score.id,
        game: score.game,
        variant: score.variant,
        played: score.played,
        won: score.won,
        bestTimeMs: score.bestTimeMs,
        bestScore: score.bestScore,
        bestLines: score.bestLines,
        currentStreak: score.currentStreak,
        longestStreak: score.longestStreak,
        lastPlayedAt: score.lastPlayedAt,
        createdAt: score.createdAt,
        updatedAt: score.updatedAt,
      })),
    };
  }

  /**
   * Replaces this profile's rows with `value`, which is validated IN FULL before
   * anything is written — a refused archive leaves the table exactly as it was.
   *
   * Replace rather than merge, for the class doc's reason, and the wipe and the
   * inserts are one transaction so a failure partway leaves the previous rows
   * standing rather than an empty table.
   *
   * An archive's row ids are preserved, which is ADR-023 §1's arrangement and the
   * reason this refuses an archive whose ids this database already holds under
   * another profile: a restore lands where its ids are free, exactly as every
   * other module's does.
   */
  importData(value: unknown): void {
    const scores = parseArcadeExport(value);
    for (const score of scores) {
      const taken = this.selectForeignId.get(this.profileId, score.id) as { id: string } | undefined;
      if (taken !== undefined) {
        throw new ArcadeValidationError(
          `The row ${score.id} already exists in this database under another profile, so this ` +
            `archive cannot be restored beside the profile it came from.`,
        );
      }
    }
    const replace = this.db.transaction((): void => {
      this.deleteProfile.run(this.profileId);
      for (const score of scores) {
        this.insertExact.run(
          score.id,
          this.profileId,
          score.game,
          score.variant,
          score.played,
          score.won,
          score.bestTimeMs,
          score.bestScore,
          score.bestLines,
          score.currentStreak,
          score.longestStreak,
          score.lastPlayedAt,
          score.createdAt,
          score.updatedAt,
        );
      }
    });
    replace();
  }

  private mustRow(game: ArcadeGame, variant: string): ArcadeScoreRow {
    const row = this.selectRow.get(this.profileId, game, variant) as ArcadeScoreRow | undefined;
    // Unreachable through the public door: every caller has just written the row
    // it reads back, and the profile scope is this store's own.
    if (row === undefined) {
      throw new ArcadeValidationError(
        `The arcade row for ${game}/${variant} was missing between its write and its read.`,
      );
    }
    return row;
  }

  private toScore(row: ArcadeScoreRow): ArcadeScore {
    return {
      id: row.id,
      profileId: row.profile_id,
      game: row.game as ArcadeGame,
      variant: row.variant,
      played: row.played,
      won: row.won,
      bestTimeMs: row.best_time_ms,
      bestScore: row.best_score,
      bestLines: row.best_lines,
      currentStreak: row.current_streak,
      longestStreak: row.longest_streak,
      lastPlayedAt: row.last_played_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/**
 * The whole of `importData`'s gate, and it is deliberately all-or-nothing: every
 * entry is checked against the rules the live path enforces, the per-game rules
 * migration 080 states are restated here so a hand-edited archive gets a sentence
 * rather than a raw constraint failure, and the two ways one archive can
 * contradict itself — the same board twice, or the same row id twice — are
 * refused as well, because neither has a meaning a writer could repair.
 *
 * EXPORTED, and that is the module kit's requirement rather than this store's
 * convenience: `ModuleImport.parse` has to run the WHOLE read at the preview,
 * before anybody confirms a restore, and it has to write nothing. The module's
 * `main/imex.ts` hands this function straight to the kit and `importData`
 * revalidates through it, so a payload the preview accepted cannot be refused
 * later by a different rule living in the same file.
 */
export function parseArcadeExport(value: unknown): ArcadeExportScore[] {
  if (!isRecord(value)) {
    throw new ArcadeValidationError(`An arcade export must be an object carrying a "version".`);
  }
  if (value["version"] !== ARCADE_EXPORT_VERSION) {
    throw new ArcadeValidationError(
      `Arcade export version ${JSON.stringify(value["version"])} is not one this build reads ` +
        `(this build writes and reads ${ARCADE_EXPORT_VERSION}).`,
    );
  }
  const scores = value["scores"];
  if (!Array.isArray(scores)) {
    throw new ArcadeValidationError(`An arcade export must carry a "scores" array.`);
  }

  const out: ArcadeExportScore[] = [];
  const seenBoards = new Set<string>();
  const seenIds = new Set<string>();
  for (const entry of scores as unknown[]) {
    if (!isRecord(entry)) throw new ArcadeValidationError(`Every arcade score must be an object.`);
    if (
      Object.keys(entry).length !== EXPORT_KEYS.length ||
      EXPORT_KEYS.some((key) => !(key in entry))
    ) {
      throw new ArcadeValidationError(
        `An arcade score carries exactly these fields: ${EXPORT_KEYS.join(", ")}.`,
      );
    }

    const id = validateId(entry["id"]);
    const game = validateGame(entry["game"]);
    const variant = validateVariant(entry["variant"]);
    const played = validateCount(entry["played"], "played", 0, Number.MAX_SAFE_INTEGER);
    const won = validateCount(entry["won"], "won", 0, played);
    const currentStreak = validateCount(entry["currentStreak"], "currentStreak", 0, won);
    const longestStreak = validateCount(
      entry["longestStreak"],
      "longestStreak",
      0,
      Number.MAX_SAFE_INTEGER,
    );
    if (longestStreak < currentStreak) {
      throw new ArcadeValidationError(`"longestStreak" must not be smaller than "currentStreak".`);
    }
    const bestTimeMs = nullableCount(entry["bestTimeMs"], "bestTimeMs", 1, MAX_ARCADE_TIME_MS);
    const bestScore = nullableCount(entry["bestScore"], "bestScore", 0, MAX_ARCADE_SCORE);
    const bestLines = nullableCount(entry["bestLines"], "bestLines", 0, MAX_ARCADE_LINES);
    const lastPlayedAt = validateStamp(entry["lastPlayedAt"], "lastPlayedAt");
    const createdAt = validateStamp(entry["createdAt"], "createdAt");
    const updatedAt = validateStamp(entry["updatedAt"], "updatedAt");

    if (game === "minesweeper" && (bestScore !== null || bestLines !== null)) {
      throw new ArcadeValidationError(
        `A Minesweeper row carries no score and no count; ${id} carries one.`,
      );
    }
    if (
      WINLESS_GAMES.includes(game) &&
      (won !== 0 ||
        currentStreak !== 0 ||
        longestStreak !== 0 ||
        bestTimeMs !== null ||
        bestScore === null ||
        bestLines === null)
    ) {
      throw new ArcadeValidationError(
        `A ${game} row never wins, has no time, and always carries a score and a count; ${id} does not.`,
      );
    }
    if (
      game === "tile2048" &&
      (bestTimeMs !== null || bestScore === null || bestLines === null)
    ) {
      throw new ArcadeValidationError(
        `A 2048 row has no time and always carries a score and a move count; ${id} does not.`,
      );
    }

    const board = `${game}/${variant}`;
    if (seenBoards.has(board)) {
      throw new ArcadeValidationError(`An arcade export cannot carry ${board} twice.`);
    }
    if (seenIds.has(id)) {
      throw new ArcadeValidationError(`An arcade export cannot carry the id ${id} twice.`);
    }
    seenBoards.add(board);
    seenIds.add(id);

    out.push({
      id,
      game,
      variant,
      played,
      won,
      bestTimeMs,
      bestScore,
      bestLines,
      currentStreak,
      longestStreak,
      lastPlayedAt,
      createdAt,
      updatedAt,
    });
  }
  return out;
}
