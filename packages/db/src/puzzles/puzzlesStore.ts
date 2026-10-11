import type Database from "better-sqlite3-multiple-ciphers";
import {
  BROJ_TARGET_MAX,
  BROJ_TARGET_MIN,
  MAHJONG_FACES,
  NONOGRAM_MAX,
  NONOGRAM_MIN,
  TURTLE_SLOTS,
  checkBrojExpression,
  createBrojPuzzle,
  mahjongGroupOf,
  sudokuSolution,
} from "@nexus/core";
import type { BrojExpression } from "@nexus/core";
import { DatabaseError, isUniqueConstraintViolation } from "../errors.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

/**
 * PUZZLES' storage (migration 088): the game in progress per puzzle and grade,
 * the record per puzzle and grade, and the module's one preference.
 *
 * **Why the module owns its tables rather than sharing the games'.** Migration
 * 090's header states it: the arcade's and the cards' tables key a running total
 * by `(profile, game, variant)` but each states a closed vocabulary and a row
 * SHAPE that a puzzle does not have — a card game's save is a seed plus a move
 * list, and a puzzle is a grid or an arrangement.
 *
 * **The state is the ENGINE's, read back through the engine.** Every puzzle's
 * `state_json` is parsed and checked here, and where the check can be the
 * engine's own it is: a sudoku's givens must admit exactly one completion
 * (`sudokuSolution`), a Broj draw must be the one its seed deals
 * (`createBrojPuzzle`) and its expression must be one the six numbers can really
 * make (`checkBrojExpression`), and a mahjong board's remaining tiles must pair
 * up the way a board that can still be cleared does. Nothing here re-implements
 * a rule the package already owns — the same posture `CardGameStore` takes when
 * it hands a move list to the engine's replay.
 *
 * **What is deliberately NOT checked here: a nonogram's picture.** Proving that
 * the marks belong to a puzzle whose clues are line-solvable means generating
 * the puzzle, which is the expensive half the renderer runs in a web worker
 * precisely because it must not sit in front of a store write. The structural
 * check (the size, the cell count, the three mark values) is this file's, and
 * the picture itself is regenerated — deterministically, from the row's seed —
 * by whoever draws it.
 *
 * **A sudoku carries its givens AND its seed.** That is one deliberate
 * redundancy, and it is the honest one: the board must be checkable on the way
 * in (`sudokuSolution` needs it) and a resumed game must draw without
 * regenerating, which is also heavy. The seed stays the row's own record of
 * where the board came from, and the pair cannot drift in practice because
 * nothing but this store writes either.
 *
 * **Undo history is not stored.** A puzzle resumes at the position it was left
 * at; the stack that steps back through its moves lives in the page that drew
 * them. Storing it would mean a second, order-sensitive value per puzzle whose
 * only reader is one screen, and a resumed game that could step back over moves
 * it never showed is a worse promise than an empty stack (`mahjongUndo` says the
 * same thing one step further in, about a shuffle in between).
 */

/** The four puzzles this module plays. The column CHECK states the same four words. */
export type PuzzleId = "sudoku" | "nonogram" | "mahjong" | "broj";

export const PUZZLE_IDS: readonly PuzzleId[] = ["sudoku", "nonogram", "mahjong", "broj"];

/**
 * The grades and boards a puzzle is played at, in the order the page offers
 * them. `variant` is a key and never a label (a test pins it as an ASCII slug),
 * and the store validates against this table rather than the schema validating
 * against a CHECK, on `note_folders`' palette rule (migration 011): a fifth
 * nonogram size is a constant here and not a migration.
 *
 * A sudoku's variant is the CAP the generator dug to, so the grade a puzzle is
 * played at is also the generator's argument. A nonogram's is its board size. A
 * mahjong solitaire has one layout, and Broj has one draw, so each names the one
 * value it has rather than an empty string: a key that is present is a key a
 * reader can check.
 */
export const PUZZLE_VARIANTS: Readonly<Record<PuzzleId, readonly string[]>> = {
  sudoku: ["easy", "medium", "hard"],
  nonogram: ["5x5", "10x10", "15x15", "20x20"],
  mahjong: ["turtle"],
  broj: ["six"],
};

/**
 * The ceiling on one stored game, in characters of its JSON.
 *
 * The largest state this module writes is a mahjong board: 144 faces, 144
 * flags, an empty move list — well under 4 kB. A sudoku is 81 digits, 81
 * entries and 81 note lists, a few hundred bytes. The ceiling is therefore a
 * bound on untrusted input rather than a limit anybody meets, and it is the
 * schema's own number.
 */
export const MAX_PUZZLE_STATE_BYTES = 32_000;

/** The longest one sitting this store will hold — `cardgame_saves`' own bound, and its reason: a puzzle open for a day is a puzzle somebody left open. */
export const MAX_PUZZLE_ELAPSED_SECONDS = 86_400;

/** A seed is a positive 32-bit integer, which is what `games/random.ts` takes. */
export const MAX_PUZZLE_SEED = 2_147_483_647;

/** How many hints one game may record having asked for. A bound on a counter, not a limit anybody meets. */
export const MAX_PUZZLE_HINTS = 1_000;

/** How many times one mahjong board may be dealt out again. */
export const MAX_PUZZLE_SHUFFLES = 1_000;

/** The longest a tile face is: `characters-9` is twelve. */
const MAX_TILE_FACE_LENGTH = 16;

/** Thrown when a puzzles write is refused at the store boundary: an unknown puzzle or grade, a malformed state, a counter outside its bound, or an instant that is not one. */
export class PuzzlesValidationError extends DatabaseError {}

/** A sudoku as it is played: the board it was dealt, what has been entered, and the pencil marks. */
export interface SudokuState {
  /** Eighty-one cells, row-major, `0` where the puzzle is empty — the givens, which are also what makes the board checkable. */
  givens: number[];
  /** What the player has entered, by cell: a digit, or `null`. A given cell is always `null` here. */
  entries: (number | null)[];
  /** Pencil marks per cell, ascending and deduplicated; empty where a digit stands. */
  notes: number[][];
  hintsUsed: number;
}

/** A nonogram as it is played: the board's size and one mark per cell. */
export interface NonogramState {
  width: number;
  height: number;
  /** `0` untouched, `1` filled, `2` crossed — the three states a player marks, and the only three the column may hold. */
  marks: number[];
}

/** A mahjong solitaire board as it stands: the faces, what is left of them, and how many times they have been dealt out again. */
export interface MahjongState {
  faces: string[];
  remaining: boolean[];
  shuffles: number;
}

/** A Broj round: the drawn pool, the target, and the expression the player has built so far. */
export interface BrojState {
  numbers: number[];
  target: number;
  expression: BrojExpression | null;
}

export type PuzzleState = SudokuState | NonogramState | MahjongState | BrojState;

/** One game in progress, as the store returns it. */
export interface PuzzleSave {
  profileId: string;
  puzzle: PuzzleId;
  variant: string;
  seed: number;
  state: PuzzleState;
  elapsedSeconds: number;
  createdAt: string;
  updatedAt: string;
}

/** The record for one puzzle at one grade. */
export interface PuzzlesStats {
  puzzle: PuzzleId;
  variant: string;
  /** Games finished — won or abandoned. */
  played: number;
  solved: number;
  /** The fastest finished game, in whole seconds, or null until one is finished. */
  bestTimeSeconds: number | null;
  /** Broj only: the closest a finished attempt came to the target, or null. */
  bestDistance: number | null;
  /** When this row last moved, or null when it does not exist yet. */
  updatedAt: string | null;
}

/** The module's one preference. */
export interface PuzzlesSettings {
  /** Whether a sudoku marks a conflict while it is played, rather than only when asked. Ships off. */
  checkWhileTyping: boolean;
}

/** One save as an archive carries it. The row has no id of its own — the triple is the key — so nothing here is re-minted. */
export interface PuzzleSaveExport {
  puzzle: PuzzleId;
  variant: string;
  seed: number;
  state: PuzzleState;
  elapsedSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface PuzzlesStatsExport {
  puzzle: PuzzleId;
  variant: string;
  played: number;
  solved: number;
  bestTimeSeconds: number | null;
  bestDistance: number | null;
  updatedAt: string;
}

/** What a finished game contributes to the record. */
export interface FinishPuzzleInput {
  puzzle: PuzzleId;
  variant: string;
  solved: boolean;
  elapsedSeconds: number;
  /** Broj only, and only when the player's submitted expression missed: how far it was. */
  distance?: number | null;
}

export interface SavePuzzleInput {
  puzzle: PuzzleId;
  variant: string;
  seed: number;
  state: unknown;
  elapsedSeconds: number;
}

interface SaveRow {
  profile_id: string;
  puzzle: string;
  variant: string;
  seed: number;
  state_json: string;
  elapsed_seconds: number;
  created_at: string;
  updated_at: string;
}

interface StatsRow {
  puzzle: string;
  variant: string;
  played: number;
  solved: number;
  best_time_seconds: number | null;
  best_distance: number | null;
  updated_at: string;
}

/**
 * PUZZLES for a single profile: the games in progress, the record, and the one
 * preference — over prepared, parameterized statements (SEC-API-03).
 *
 * **Everything a caller can get wrong is refused here, by name.** Stage 2's IPC
 * layer hands untrusted payloads straight to these methods (SEC-EL-02), so the
 * puzzle, the grade, the seed, the elapsed time and the whole state are checked
 * at this boundary before a row moves.
 */
export class PuzzlesStore {
  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {}

  // --- The game in progress -------------------------------------------------

  /**
   * Every game this profile has in progress, in the module's own order: the
   * four puzzles as `PUZZLE_IDS` lists them, and each puzzle's grades as its
   * `PUZZLE_VARIANTS` lists them. That is the order the page draws them in, so
   * the order is decided here rather than by whatever SQLite happened to return.
   */
  listSaves(): PuzzleSave[] {
    const rows = this.db
      .prepare(
        `SELECT profile_id, puzzle, variant, seed, state_json, elapsed_seconds, created_at, updated_at
           FROM puzzles_saves
          WHERE profile_id = ?`,
      )
      .all(this.profileId) as SaveRow[];
    return rows
      .map((row) => this.toSave(row))
      .sort((left, right) => variantOrder(left.puzzle, left.variant) - variantOrder(right.puzzle, right.variant));
  }

  /**
   * Writes the game in progress, replacing whatever was there, and returns the
   * row. The state is read by `readPuzzleState` before the column is written, so
   * a state this module cannot draw is refused rather than stored.
   */
  saveProgress(input: SavePuzzleInput, now: string): PuzzleSave {
    const stamp = this.validInstant(now);
    const puzzle = readPuzzleId(input.puzzle);
    const variant = readVariant(puzzle, input.variant);
    const seed = readSeed(input.seed);
    const elapsedSeconds = readElapsed(input.elapsedSeconds);
    const state = readPuzzleState(puzzle, seed, input.state);
    const json = stateJson(state);
    this.db
      .prepare(
        `INSERT INTO puzzles_saves
           (profile_id, puzzle, variant, seed, state_json, elapsed_seconds, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (profile_id, puzzle, variant) DO UPDATE SET
           seed = excluded.seed,
           state_json = excluded.state_json,
           elapsed_seconds = excluded.elapsed_seconds,
           updated_at = excluded.updated_at`,
      )
      .run(this.profileId, puzzle, variant, seed, json, elapsedSeconds, stamp, stamp);
    return this.requireSave(puzzle, variant);
  }

  /** Drops the game in progress for one puzzle and grade. Clearing what is not there is not an error — `ChessStore.clearResume`'s rule, for its reason: a new game is the same act whether or not one was open. */
  clearSave(puzzle: PuzzleId, variant: string): void {
    this.db
      .prepare("DELETE FROM puzzles_saves WHERE profile_id = ? AND puzzle = ? AND variant = ?")
      .run(this.profileId, readPuzzleId(puzzle), readVariant(puzzle, variant));
  }

  // --- The record -----------------------------------------------------------

  /**
   * The record for every puzzle and grade that has one, in the module's own
   * order (see `listSaves`). A grade nobody has finished has no row rather than
   * a row of zeroes: the page draws „no games yet" from the absence, and a
   * zero-filled row would be a game nobody played.
   */
  listStats(): PuzzlesStats[] {
    const rows = this.db
      .prepare(
        `SELECT puzzle, variant, played, solved, best_time_seconds, best_distance, updated_at
           FROM puzzles_stats
          WHERE profile_id = ?`,
      )
      .all(this.profileId) as StatsRow[];
    return rows
      .map((row) => toStats(row))
      .sort((left, right) => variantOrder(left.puzzle, left.variant) - variantOrder(right.puzzle, right.variant));
  }

  /**
   * Folds one finished game into the record and drops the game in progress for
   * that puzzle and grade — in ONE transaction, because a finished game that
   * left its own save behind is a board the page would offer to resume after the
   * user had already finished it.
   *
   * The best time is kept only from a SOLVED game, and only from one that took
   * at least a second to measure: a best of „0 s" is the clock's resolution
   * rather than a time anybody spent. The best distance is Broj's alone, and the
   * schema refuses one on any other puzzle (`puzzles_stats`' CHECK), so the rule
   * is stated in both places on purpose — the column is what the row may hold,
   * this is what the store will offer it.
   */
  finish(input: FinishPuzzleInput, now: string): PuzzlesStats {
    const stamp = this.validInstant(now);
    const puzzle = readPuzzleId(input.puzzle);
    const variant = readVariant(puzzle, input.variant);
    const elapsedSeconds = readElapsed(input.elapsedSeconds);
    const solved = input.solved === true;
    const bestTimeSeconds = solved && elapsedSeconds >= 1 ? elapsedSeconds : null;
    const bestDistance = readDistance(puzzle, input.distance ?? null);

    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO puzzles_stats
             (profile_id, puzzle, variant, played, solved, best_time_seconds, best_distance, updated_at)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?)
           ON CONFLICT (profile_id, puzzle, variant) DO UPDATE SET
             played = played + 1,
             solved = solved + excluded.solved,
             best_time_seconds =
               CASE
                 WHEN excluded.best_time_seconds IS NULL THEN best_time_seconds
                 WHEN best_time_seconds IS NULL THEN excluded.best_time_seconds
                 ELSE MIN(best_time_seconds, excluded.best_time_seconds)
               END,
             best_distance =
               CASE
                 WHEN excluded.best_distance IS NULL THEN best_distance
                 WHEN best_distance IS NULL THEN excluded.best_distance
                 ELSE MIN(best_distance, excluded.best_distance)
               END,
             updated_at = excluded.updated_at`,
        )
        .run(
          this.profileId,
          puzzle,
          variant,
          solved ? 1 : 0,
          bestTimeSeconds,
          bestDistance,
          stamp,
        );
      this.db
        .prepare("DELETE FROM puzzles_saves WHERE profile_id = ? AND puzzle = ? AND variant = ?")
        .run(this.profileId, puzzle, variant);
    })();
    return this.requireStats(puzzle, variant);
  }

  // --- Settings -------------------------------------------------------------

  /** The module's one preference. `false` where there is no row, which is the shipped default and why a fresh profile needs no seeding. */
  settings(): PuzzlesSettings {
    const row = this.db
      .prepare("SELECT check_while_typing FROM puzzles_settings WHERE profile_id = ?")
      .get(this.profileId) as { check_while_typing: number } | undefined;
    return { checkWhileTyping: row === undefined ? false : row.check_while_typing === 1 };
  }

  setCheckWhileTyping(checkWhileTyping: boolean, now: string): PuzzlesSettings {
    if (typeof checkWhileTyping !== "boolean") {
      throw new PuzzlesValidationError(`"checkWhileTyping" must be a boolean.`);
    }
    const stamp = this.validInstant(now);
    this.db
      .prepare(
        `INSERT INTO puzzles_settings (profile_id, check_while_typing, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (profile_id) DO UPDATE SET
           check_while_typing = excluded.check_while_typing,
           updated_at = excluded.updated_at`,
      )
      .run(this.profileId, checkWhileTyping ? 1 : 0, stamp);
    return this.settings();
  }

  // --- The archive ----------------------------------------------------------

  /** This profile's whole puzzles content, as the module's archive section carries it. */
  exportData(): {
    saves: PuzzleSaveExport[];
    stats: PuzzlesStatsExport[];
    settings: PuzzlesSettings;
  } {
    return {
      saves: this.listSaves().map((save) => ({
        puzzle: save.puzzle,
        variant: save.variant,
        seed: save.seed,
        state: save.state,
        elapsedSeconds: save.elapsedSeconds,
        createdAt: save.createdAt,
        updatedAt: save.updatedAt,
      })),
      stats: this.listStats().map((row) => ({
        puzzle: row.puzzle,
        variant: row.variant,
        played: row.played,
        solved: row.solved,
        bestTimeSeconds: row.bestTimeSeconds,
        bestDistance: row.bestDistance,
        // A row that exists carries a timestamp — `puzzles_stats.updated_at` is
        // NOT NULL — so the export's `string` is what the row already holds,
        // and the `null` `listStats` answers is the shape of a row that is not
        // there rather than of one this map carries.
        updatedAt: row.updatedAt as string,
      })),
      settings: this.settings(),
    };
  }

  /**
   * Replaces this profile's puzzles content with an archive section.
   *
   * **Every entry is read again through the readers the live path uses** — the
   * module's own `parse` has already run once at the preview and once before this
   * write, but a store that trusted the shape of its argument would be one cast
   * away from a check that only exists in the other process. `settings: null` is
   * an archive that carried no preference (what a section that names no Puzzles
   * entry means), and it DELETES the row so the profile answers the store's own
   * default rather than a boolean restated here.
   */
  replaceFromArchive(
    input: {
      readonly saves: readonly PuzzleSaveExport[];
      readonly stats: readonly PuzzlesStatsExport[];
      readonly settings: PuzzlesSettings | null;
    },
    now: string,
  ): void {
    const stamp = this.validInstant(now);
    const saves = input.saves.map((entry) => readSaveExport(entry));
    const stats = input.stats.map((entry) => readStatsExport(entry));
    // Read before the transaction opens, so a preference this build cannot read
    // is refused while the profile is still untouched rather than after the
    // deletes are inside a transaction waiting to roll back.
    const settings = input.settings === null ? null : readSettings(input.settings);
    const seen = new Set(saves.map((save) => `${save.puzzle}\u0000${save.variant}`));
    if (seen.size !== saves.length) {
      throw new PuzzlesValidationError("Two saves in one archive name the same puzzle and grade.");
    }
    const seenStats = new Set(stats.map((row) => `${row.puzzle}\u0000${row.variant}`));
    if (seenStats.size !== stats.length) {
      throw new PuzzlesValidationError("Two statistics rows in one archive name the same puzzle and grade.");
    }
    try {
      this.db.transaction(() => {
        this.db.prepare("DELETE FROM puzzles_saves WHERE profile_id = ?").run(this.profileId);
        this.db.prepare("DELETE FROM puzzles_stats WHERE profile_id = ?").run(this.profileId);
        const insertSave = this.db.prepare(
          `INSERT INTO puzzles_saves
             (profile_id, puzzle, variant, seed, state_json, elapsed_seconds, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const save of saves) {
          insertSave.run(
            this.profileId,
            save.puzzle,
            save.variant,
            save.seed,
            stateJson(save.state),
            save.elapsedSeconds,
            save.createdAt,
            save.updatedAt,
          );
        }
        const insertStats = this.db.prepare(
          `INSERT INTO puzzles_stats
             (profile_id, puzzle, variant, played, solved, best_time_seconds, best_distance, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const row of stats) {
          insertStats.run(
            this.profileId,
            row.puzzle,
            row.variant,
            row.played,
            row.solved,
            row.bestTimeSeconds,
            row.bestDistance,
            row.updatedAt,
          );
        }
        if (settings === null) {
          this.db.prepare("DELETE FROM puzzles_settings WHERE profile_id = ?").run(this.profileId);
        } else {
          this.db
            .prepare(
              `INSERT INTO puzzles_settings (profile_id, check_while_typing, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT (profile_id) DO UPDATE SET
                 check_while_typing = excluded.check_while_typing,
                 updated_at = excluded.updated_at`,
            )
            .run(this.profileId, settings.checkWhileTyping ? 1 : 0, stamp);
        }
      })();
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new PuzzlesValidationError(
          "The archive carries two rows for one puzzle and grade.",
        );
      }
      throw error;
    }
  }

  // --- Internals ------------------------------------------------------------

  private requireSave(puzzle: PuzzleId, variant: string): PuzzleSave {
    const row = this.db
      .prepare(
        `SELECT profile_id, puzzle, variant, seed, state_json, elapsed_seconds, created_at, updated_at
           FROM puzzles_saves
          WHERE profile_id = ? AND puzzle = ? AND variant = ?`,
      )
      .get(this.profileId, puzzle, variant) as SaveRow | undefined;
    if (row === undefined) {
      // A row the store just wrote and cannot read, or a state read of a row
      // that is gone: either way it is this module's own inconsistency rather
      // than a caller's mistake, and it is loud for that reason.
      throw new PuzzlesValidationError(`No save for "${puzzle}:${variant}".`);
    }
    return this.toSave(row);
  }

  private requireStats(puzzle: PuzzleId, variant: string): PuzzlesStats {
    const row = this.db
      .prepare(
        `SELECT puzzle, variant, played, solved, best_time_seconds, best_distance, updated_at
           FROM puzzles_stats
          WHERE profile_id = ? AND puzzle = ? AND variant = ?`,
      )
      .get(this.profileId, puzzle, variant) as StatsRow | undefined;
    if (row === undefined) {
      throw new PuzzlesValidationError(`No statistics for "${puzzle}:${variant}".`);
    }
    return toStats(row);
  }

  private toSave(row: SaveRow): PuzzleSave {
    const puzzle = readPuzzleId(row.puzzle);
    return {
      profileId: row.profile_id,
      puzzle,
      variant: row.variant,
      seed: row.seed,
      state: readStoredState(puzzle, row.seed, row.state_json, row.profile_id),
      elapsedSeconds: row.elapsed_seconds,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private validInstant(value: string): string {
    if (!isDateTime(value)) throw new PuzzlesValidationError(`"${value}" is not an instant.`);
    return value;
  }
}

function toStats(row: StatsRow): PuzzlesStats {
  return {
    puzzle: readPuzzleId(row.puzzle),
    variant: row.variant,
    played: row.played,
    solved: row.solved,
    bestTimeSeconds: row.best_time_seconds,
    bestDistance: row.best_distance,
    updatedAt: row.updated_at,
  };
}

/**
 * The order the module draws its rows in: the puzzle first, then the grade in
 * the order `PUZZLE_VARIANTS` lists it. A single number per (puzzle, variant)
 * keeps the two `sort` calls in `listSaves`/`listStats` one expression.
 */
function variantOrder(puzzle: PuzzleId, variant: string): number {
  const puzzleIndex = PUZZLE_IDS.indexOf(puzzle);
  const variantIndex = PUZZLE_VARIANTS[puzzle].indexOf(variant);
  return puzzleIndex * 100 + (variantIndex === -1 ? 99 : variantIndex);
}

/** A puzzle id off a wire, a row or an archive. */
export function readPuzzleId(value: unknown): PuzzleId {
  if (typeof value !== "string" || !(PUZZLE_IDS as readonly string[]).includes(value)) {
    throw new PuzzlesValidationError(
      `"puzzle" must be one of ${PUZZLE_IDS.join(", ")}, got ${JSON.stringify(value)}.`,
    );
  }
  return value as PuzzleId;
}

/** A puzzle's grade, held to that puzzle's own list. */
export function readVariant(puzzle: PuzzleId, value: unknown): string {
  const allowed = PUZZLE_VARIANTS[puzzle];
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new PuzzlesValidationError(
      `"variant" for ${puzzle} must be one of ${allowed.join(", ")}, got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/** A seed: a positive 32-bit integer, which is what every generator here takes. */
export function readSeed(value: unknown): number {
  return readInteger(value, "seed", 0, MAX_PUZZLE_SEED);
}

/** Whole seconds one sitting took, bounded as `puzzles_saves.elapsed_seconds` bounds it. */
export function readElapsed(value: unknown): number {
  return readInteger(value, "elapsedSeconds", 0, MAX_PUZZLE_ELAPSED_SECONDS);
}

/**
 * A Broj distance, or `null`. `distance` is Broj's own field: a sudoku has no
 * distance to the target, and `puzzles_stats`' CHECK says so, which is why this
 * refuses one rather than storing it.
 */
function readDistance(puzzle: PuzzleId, value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (puzzle !== "broj") {
    throw new PuzzlesValidationError(`"distance" belongs to Broj, not to ${puzzle}.`);
  }
  return readInteger(value, "distance", 0, 1_000);
}

/**
 * One game's state, read by the puzzle it belongs to.
 *
 * The reader is chosen by the puzzle id rather than the state carrying its own
 * tag: a state that named itself could disagree with the row it arrived in, and
 * the row's `puzzle` column is the fact.
 */
export function readPuzzleState(puzzle: PuzzleId, seed: number, value: unknown): PuzzleState {
  switch (puzzle) {
    case "sudoku":
      return readSudokuState(value);
    case "nonogram":
      return readNonogramState(value);
    case "mahjong":
      return readMahjongState(value);
    case "broj":
      return readBrojState(seed, value);
  }
}

/** A stored state's JSON, parsed and read. Corruption is loud here — a hand-edited file or a bad restore is not input to coerce (`ChessStore.parseStoredMoves`' posture). */
function readStoredState(
  puzzle: PuzzleId,
  seed: number,
  text: string,
  profileId: string,
): PuzzleState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PuzzlesValidationError(
      `The saved ${puzzle} game for profile "${profileId}" carries a state that is not valid JSON.`,
    );
  }
  return readPuzzleState(puzzle, seed, parsed);
}

function readSudokuState(value: unknown): SudokuState {
  const record = asRecord(value, "state");
  const givens = asArray(record.givens, "state.givens").map((cell, index) =>
    readInteger(cell, `state.givens[${index}]`, 0, 9),
  );
  if (givens.length !== 81) {
    throw new PuzzlesValidationError(`"state.givens" must hold 81 cells, got ${givens.length}.`);
  }
  // The board is a puzzle only if it has exactly one completion: the same
  // counter the generator proves its own puzzles with, asked from the outside.
  if (sudokuSolution(givens) === null) {
    throw new PuzzlesValidationError(
      `"state.givens" is not a puzzle with exactly one completion.`,
    );
  }
  const entries = asArray(record.entries, "state.entries").map((cell, index) => {
    if (cell === null) return null;
    return readInteger(cell, `state.entries[${index}]`, 1, 9);
  });
  if (entries.length !== 81) {
    throw new PuzzlesValidationError(`"state.entries" must hold 81 cells, got ${entries.length}.`);
  }
  for (let index = 0; index < 81; index += 1) {
    if ((givens[index] as number) !== 0 && entries[index] !== null) {
      throw new PuzzlesValidationError(
        `"state.entries[${index}]" stands on a cell the puzzle fills itself.`,
      );
    }
  }
  const notes = asArray(record.notes, "state.notes").map((cell, index) =>
    readDigits(cell, `state.notes[${index}]`),
  );
  if (notes.length !== 81) {
    throw new PuzzlesValidationError(`"state.notes" must hold 81 cells, got ${notes.length}.`);
  }
  for (let index = 0; index < 81; index += 1) {
    if (entries[index] !== null && (notes[index] as number[]).length > 0) {
      throw new PuzzlesValidationError(
        `"state.notes[${index}]" carries pencil marks for a cell that holds a digit.`,
      );
    }
  }
  return {
    givens,
    entries,
    notes,
    hintsUsed: readInteger(record.hintsUsed, "state.hintsUsed", 0, MAX_PUZZLE_HINTS),
  };
}

function readNonogramState(value: unknown): NonogramState {
  const record = asRecord(value, "state");
  const width = readInteger(record.width, "state.width", NONOGRAM_MIN, NONOGRAM_MAX);
  const height = readInteger(record.height, "state.height", NONOGRAM_MIN, NONOGRAM_MAX);
  const marks = asArray(record.marks, "state.marks").map((mark, index) =>
    readInteger(mark, `state.marks[${index}]`, 0, 2),
  );
  if (marks.length !== width * height) {
    throw new PuzzlesValidationError(
      `"state.marks" must hold ${width * height} cells for a ${width}x${height} puzzle, got ${marks.length}.`,
    );
  }
  return { width, height, marks };
}

function readMahjongState(value: unknown): MahjongState {
  const record = asRecord(value, "state");
  const slots = TURTLE_SLOTS.length;
  const faces = asArray(record.faces, "state.faces").map((face, index) => {
    if (typeof face !== "string" || face.length === 0 || face.length > MAX_TILE_FACE_LENGTH) {
      throw new PuzzlesValidationError(
        `"state.faces[${index}]" must be 1-${MAX_TILE_FACE_LENGTH} characters.`,
      );
    }
    // The set is the traditional 144 and it ships with the application, so a
    // face off it is not a tile — which makes this the one check that turns a
    // hand-edited archive into a refusal here rather than a page drawing a
    // shape for a face nobody can match.
    if (!MAHJONG_FACES.includes(face)) {
      throw new PuzzlesValidationError(`"state.faces[${index}]" is not a mahjong tile.`);
    }
    return face;
  });
  if (faces.length !== slots) {
    throw new PuzzlesValidationError(`"state.faces" must hold ${slots} tiles, got ${faces.length}.`);
  }
  const remaining = asArray(record.remaining, "state.remaining").map((present, index) => {
    if (typeof present !== "boolean") {
      throw new PuzzlesValidationError(`"state.remaining[${index}]" must be a boolean.`);
    }
    return present;
  });
  if (remaining.length !== slots) {
    throw new PuzzlesValidationError(
      `"state.remaining" must hold ${slots} tiles, got ${remaining.length}.`,
    );
  }
  // What is left has to pair up within each face group — the invariant
  // `mahjongShuffle` asserts before it re-deals, and the one that says a board
  // can still be cleared at all.
  const counts = new Map<string, number>();
  for (let index = 0; index < slots; index += 1) {
    if (remaining[index] !== true) continue;
    const group = mahjongGroupOf(faces[index] as string);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  for (const [group, count] of counts) {
    if (count % 2 !== 0) {
      throw new PuzzlesValidationError(
        `"state.faces" leaves an odd number of ${group} tiles, which no arrangement can clear.`,
      );
    }
  }
  return {
    faces,
    remaining,
    shuffles: readInteger(record.shuffles, "state.shuffles", 0, MAX_PUZZLE_SHUFFLES),
  };
}

function readBrojState(seed: number, value: unknown): BrojState {
  const record = asRecord(value, "state");
  const numbers = asArray(record.numbers, "state.numbers").map((number, index) =>
    readInteger(number, `state.numbers[${index}]`, 1, 1_000_000),
  );
  if (numbers.length !== 6) {
    throw new PuzzlesValidationError(`"state.numbers" must hold six numbers, got ${numbers.length}.`);
  }
  const target = readInteger(record.target, "state.target", BROJ_TARGET_MIN, BROJ_TARGET_MAX);
  // The draw is a function of the seed, so a row whose numbers are not the ones
  // its seed deals is a row about a different game than the one it claims.
  const drawn = createBrojPuzzle(seed);
  if (
    drawn.target !== target ||
    drawn.numbers.length !== numbers.length ||
    drawn.numbers.some((number, index) => number !== numbers[index])
  ) {
    throw new PuzzlesValidationError(
      `"state.numbers"/"state.target" are not the draw seed ${seed} deals.`,
    );
  }
  const expression =
    record.expression === null || record.expression === undefined
      ? null
      : readExpression(record.expression, "state.expression", 0);
  if (expression !== null) {
    const check = checkBrojExpression(numbers, target, expression);
    if (!check.valid) {
      throw new PuzzlesValidationError(
        `"state.expression" is not an expression the six numbers can make (${check.refusal ?? "refused"}).`,
      );
    }
  }
  return { numbers, target, expression };
}

/**
 * One Broj expression tree, from a wire or an archive.
 *
 * The depth is capped rather than counted against the pool: six numbers make at
 * most five operations, so a deeper tree is not a longer solution but a payload
 * that would make every reader of it recursive, and a bound is one line where a
 * stack overflow is a release.
 */
export function readExpression(value: unknown, field: string, depth: number): BrojExpression {
  if (depth > 8) throw new PuzzlesValidationError(`"${field}" is nested too deeply.`);
  const record = asRecord(value, field);
  const kind = record.kind;
  if (kind === "number") {
    return { kind: "number", value: readInteger(record.value, `${field}.value`, 1, 1_000_000) };
  }
  if (kind !== "operation") {
    throw new PuzzlesValidationError(`"${field}.kind" must be "number" or "operation".`);
  }
  const operation = record.operation;
  if (operation !== "+" && operation !== "-" && operation !== "*" && operation !== "/") {
    throw new PuzzlesValidationError(`"${field}.operation" must be one of + - * /.`);
  }
  return {
    kind: "operation",
    operation,
    left: readExpression(record.left, `${field}.left`, depth + 1),
    right: readExpression(record.right, `${field}.right`, depth + 1),
  };
}

/** One archive save, read whole through the readers the live path uses. */
export function readSaveExport(value: unknown): PuzzleSaveExport {
  const record = asRecord(value, "save");
  const puzzle = readPuzzleId(record.puzzle);
  const variant = readVariant(puzzle, record.variant);
  const seed = readSeed(record.seed);
  return {
    puzzle,
    variant,
    seed,
    state: readPuzzleState(puzzle, seed, record.state),
    elapsedSeconds: readElapsed(record.elapsedSeconds),
    createdAt: readInstant(record.createdAt, "save.createdAt"),
    updatedAt: readInstant(record.updatedAt, "save.updatedAt"),
  };
}

/** One archive statistics row. `played`/`solved` are counters; the two bests are the same coupled columns the schema holds. */
export function readStatsExport(value: unknown): PuzzlesStatsExport {
  const record = asRecord(value, "stats");
  const puzzle = readPuzzleId(record.puzzle);
  const variant = readVariant(puzzle, record.variant);
  const played = readInteger(record.played, "stats.played", 0, Number.MAX_SAFE_INTEGER);
  const solved = readInteger(record.solved, "stats.solved", 0, Number.MAX_SAFE_INTEGER);
  if (solved > played) {
    throw new PuzzlesValidationError(`"stats.solved" cannot exceed "stats.played".`);
  }
  const bestTimeSeconds =
    record.bestTimeSeconds === null || record.bestTimeSeconds === undefined
      ? null
      : readInteger(record.bestTimeSeconds, "stats.bestTimeSeconds", 1, MAX_PUZZLE_ELAPSED_SECONDS);
  const bestDistance = readDistance(puzzle, record.bestDistance ?? null);
  return {
    puzzle,
    variant,
    played,
    solved,
    bestTimeSeconds,
    bestDistance,
    updatedAt: readInstant(record.updatedAt, "stats.updatedAt"),
  };
}

/** One archive preference row. */
export function readSettings(value: unknown): PuzzlesSettings {
  const record = asRecord(value, "settings");
  if (typeof record.checkWhileTyping !== "boolean") {
    throw new PuzzlesValidationError(`"settings.checkWhileTyping" must be a boolean.`);
  }
  return { checkWhileTyping: record.checkWhileTyping };
}

/** A state as the column holds it, refused before the write rather than by the CHECK: the sentence a caller needs is „this game is too large to keep", which SQL cannot say. */
function stateJson(state: PuzzleState): string {
  const json = JSON.stringify(state);
  if (json.length > MAX_PUZZLE_STATE_BYTES) {
    throw new PuzzlesValidationError(
      `A puzzle's state must be at most ${MAX_PUZZLE_STATE_BYTES} characters.`,
    );
  }
  return json;
}

/** A pencil-mark list: digits `1..9`, ascending and without repeats, which is the only shape the page draws. */
function readDigits(value: unknown, field: string): number[] {
  const digits = asArray(value, field).map((digit, index) =>
    readInteger(digit, `${field}[${index}]`, 1, 9),
  );
  for (let index = 1; index < digits.length; index += 1) {
    if ((digits[index] as number) <= (digits[index - 1] as number)) {
      throw new PuzzlesValidationError(`"${field}" must be ascending and without repeats.`);
    }
  }
  return digits;
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PuzzlesValidationError(`"${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new PuzzlesValidationError(`"${field}" must be an array.`);
  return value;
}

function readInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new PuzzlesValidationError(`"${field}" must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function readInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || !isDateTime(value)) {
    throw new PuzzlesValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}
