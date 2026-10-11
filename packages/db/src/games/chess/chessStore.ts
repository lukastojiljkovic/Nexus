import type Database from "better-sqlite3-multiple-ciphers";
import {
  CHESS_LEVELS,
  MAX_ID_LENGTH,
  isValidFen,
  loadGamePgn,
  replayUci,
} from "@nexus/core";
import type { ChessColor } from "@nexus/core";
import {
  ChessNotFoundError,
  ChessValidationError,
  isUniqueConstraintViolation,
} from "../../errors.js";
import { uuidv7 } from "../../ids.js";
import { isDateTime } from "../../finance/money.js";

type DatabaseHandle = Database.Database;

/** A game was against our own engine or against a person across the board. */
export type ChessOpponent = "engine" | "human";

/**
 * How a game ended, in the ARCHIVE's vocabulary — which is the caller's claim,
 * not the position's. `unfinished` is a game somebody stopped playing: it is kept
 * with whatever was on the board, and it is the one value that never enters the
 * level record.
 */
export type ChessGameResult = "white" | "black" | "draw" | "unfinished";

/**
 * The bound on a stored PGN.
 *
 * A game of 300 moves with comments runs to a few tens of kilobytes, so 32 000
 * characters holds any ordinary game with room to spare, and the column CHECK
 * says the same number. It exists because the PGN arrives from outside — a stage
 * 2 IPC payload — and an unbounded TEXT goes into a row that every archive
 * export then carries.
 */
export const MAX_CHESS_PGN_LENGTH = 32_000;

/** The ladder's top rung. Read from `@nexus/core` so the store and the engine cannot disagree. */
export const MAX_CHESS_LEVEL = CHESS_LEVELS.length;

/** A game in progress is at most this many plies; 600 is 300 full moves. */
export const MAX_CHESS_RESUME_MOVES = 600;

/**
 * A time control is `base+increment` in seconds — `600+5`, `180+2`, `60+0` —
 * and nothing else. A free-text clock would be a field no reader can compute
 * with, and the two bounds are what a person can actually sit through: up to two
 * hours a side and up to five minutes a move.
 */
const TIME_CONTROL = /^([1-9]\d{0,3})\+(\d{1,3})$/;
const MAX_TIME_CONTROL_BASE_SECONDS = 7_200;
const MAX_TIME_CONTROL_INCREMENT_SECONDS = 300;

const RESULTS: readonly ChessGameResult[] = ["white", "black", "draw", "unfinished"];
const OPPONENTS: readonly ChessOpponent[] = ["engine", "human"];
const COLORS: readonly ChessColor[] = ["w", "b"];

/** One saved game, as the store returns it. */
export interface SavedGame {
  id: string;
  profileId: string;
  /** The whole game, headers and result included. */
  pgn: string;
  result: ChessGameResult;
  /** When the game was played, as an ISO-8601 instant. */
  playedAt: string;
  /** The colour the USER played. */
  playedColor: ChessColor;
  opponent: ChessOpponent;
  /** The engine level, 1..8, or null for a game against a person. */
  level: number | null;
  /** A `base+increment` clock in seconds, or null when the game had no clock. */
  timeControl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveGameInput {
  pgn: string;
  result: ChessGameResult;
  playedAt: string;
  playedColor: ChessColor;
  opponent: ChessOpponent;
  level?: number | null;
  timeControl?: string | null;
}

/**
 * The game in progress: the position it started from, the moves played, and the
 * position those moves produce.
 *
 * All three are stored, and the store refuses a write where the third is not
 * what the first two say. It is the one place in this module where two columns
 * describe the same fact, and the redundancy is deliberate: `fen` is what the
 * board draws without replaying a game, and `moves` is what the move list shows
 * without reconstructing it from a position. A slot that kept only one of them
 * would make the other a computation on every screen.
 */
export interface ResumableGame {
  profileId: string;
  /** The FEN the game began from, so a resumed board knows its own start. */
  startFen: string;
  /** The position after `moves`, and the one the board draws. */
  fen: string;
  /** The moves played so far, in UCI text, in order. */
  moves: string[];
  playedColor: ChessColor;
  opponent: ChessOpponent;
  level: number | null;
  timeControl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SetResumeInput {
  startFen: string;
  fen: string;
  moves: readonly string[];
  playedColor: ChessColor;
  opponent: ChessOpponent;
  level?: number | null;
  timeControl?: string | null;
}

/**
 * The player's record against one level. `played` is always `won + drawn + lost`
 * — the schema says so and the store never writes the four independently.
 */
export interface ChessLevelStats {
  level: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  /** When this level's counter last moved, or null when nothing has been played at it. */
  updatedAt: string | null;
}

/** One game in an exported archive. The row's id travels: a restore is not a re-mint. */
export interface ChessArchiveGame {
  id: string;
  pgn: string;
  result: ChessGameResult;
  playedAt: string;
  playedColor: ChessColor;
  opponent: ChessOpponent;
  level: number | null;
  timeControl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChessArchiveResume {
  startFen: string;
  fen: string;
  moves: string[];
  playedColor: ChessColor;
  opponent: ChessOpponent;
  level: number | null;
  timeControl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChessArchiveStats {
  level: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  updatedAt: string;
}

/**
 * The module's whole content, as plain JSON — what stage 2 hands to the profile
 * archive. `version` gates the reader: a value whose version this build does not
 * know is refused rather than guessed at.
 */
export interface ChessArchive {
  version: 1;
  games: ChessArchiveGame[];
  resume: ChessArchiveResume | null;
  levelStats: ChessArchiveStats[];
}

interface GameRow {
  id: string;
  profile_id: string;
  pgn: string;
  result: string;
  played_at: string;
  played_color: string;
  opponent: string;
  level: number | null;
  time_control: string | null;
  created_at: string;
  updated_at: string;
}

interface ResumeRow {
  profile_id: string;
  start_fen: string;
  fen: string;
  moves: string;
  played_color: string;
  opponent: string;
  level: number | null;
  time_control: string | null;
  created_at: string;
  updated_at: string;
}

interface StatsRow {
  level: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  updated_at: string;
}

const GAME_COLUMNS =
  "id, profile_id, pgn, result, played_at, played_color, opponent, level, time_control, " +
  "created_at, updated_at";

/**
 * Chess for a single profile: the saved games, the one game in progress, and the
 * record against each engine level — over prepared, parameterized statements
 * (SEC-API-03). Construct one per profile and reuse it.
 *
 * **Everything a caller can get wrong is refused here, by name.** Stage 2's IPC
 * layer passes untrusted payloads straight to these methods (SEC-EL-02), so the
 * lengths, the closed vocabularies, the level range and the time-control shape
 * are all checked at this boundary — and the resume slot additionally REPLAYS its
 * move list, because a FEN and a move list that disagree is the one mistake a
 * shape check cannot catch.
 *
 * **The rules come from `@nexus/core`, never from here.** FEN validity, move
 * legality and PGN parsing are `chess.js` through the module's own wrapper, so
 * this store has no opinion about chess beyond what it is willing to store.
 *
 * **A finished engine game moves the ladder record in the same transaction that
 * writes the game.** Two statements that could land one without the other are a
 * record that quietly disagrees with the archive that produced it.
 */
export class ChessStore {
  private readonly insertGame: Database.Statement;
  private readonly selectGames: Database.Statement;
  private readonly selectGame: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;
  private readonly deleteGames: Database.Statement;
  private readonly selectResume: Database.Statement;
  private readonly upsertResume: Database.Statement;
  private readonly deleteResume: Database.Statement;
  private readonly selectStats: Database.Statement;
  private readonly bumpStats: Database.Statement;
  private readonly insertStats: Database.Statement;
  private readonly deleteStats: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertGame = db.prepare(
      `INSERT INTO chess_games
         (id, profile_id, pgn, result, played_at, played_color, opponent, level, time_control,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectGames = db.prepare(
      `SELECT ${GAME_COLUMNS} FROM chess_games
        WHERE profile_id = ? AND deleted_at IS NULL
        ORDER BY played_at DESC, id DESC`,
    );
    // The gate every mutation passes: live, and in THIS profile.
    this.selectGame = db.prepare(
      `SELECT ${GAME_COLUMNS} FROM chess_games
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE chess_games SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE chess_games SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.deleteGames = db.prepare("DELETE FROM chess_games WHERE profile_id = ?");
    this.selectResume = db.prepare(
      `SELECT profile_id, start_fen, fen, moves, played_color, opponent, level, time_control,
              created_at, updated_at
         FROM chess_resume WHERE profile_id = ?`,
    );
    // The slot is keyed by the profile, so setting it twice REPLACES it: there is
    // no second game in progress to keep, and an upsert is what says so.
    this.upsertResume = db.prepare(
      `INSERT INTO chess_resume
         (profile_id, start_fen, fen, moves, played_color, opponent, level, time_control,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         start_fen = excluded.start_fen,
         fen = excluded.fen,
         moves = excluded.moves,
         played_color = excluded.played_color,
         opponent = excluded.opponent,
         level = excluded.level,
         time_control = excluded.time_control,
         updated_at = excluded.updated_at`,
    );
    this.deleteResume = db.prepare("DELETE FROM chess_resume WHERE profile_id = ?");
    this.selectStats = db.prepare(
      `SELECT level, played, won, drawn, lost, updated_at
         FROM chess_level_stats WHERE profile_id = ? ORDER BY level`,
    );
    // One statement moves the whole counter, so the four numbers cannot be
    // written a different number of times than they are read.
    this.bumpStats = db.prepare(
      `INSERT INTO chess_level_stats (profile_id, level, played, won, drawn, lost, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT (profile_id, level) DO UPDATE SET
         played = played + 1,
         won = won + excluded.won,
         drawn = drawn + excluded.drawn,
         lost = lost + excluded.lost,
         updated_at = excluded.updated_at`,
    );
    this.insertStats = db.prepare(
      `INSERT INTO chess_level_stats (profile_id, level, played, won, drawn, lost, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.deleteStats = db.prepare("DELETE FROM chess_level_stats WHERE profile_id = ?");
  }

  /** This profile's live games, newest first. Soft-deleted ones are not here. */
  listGames(): SavedGame[] {
    const rows = this.selectGames.all(this.profileId) as GameRow[];
    return rows.map((row) => this.toGame(row));
  }

  /**
   * Saves a finished — or abandoned — game and returns the stored row.
   *
   * A game whose result is final and whose opponent is the engine also moves the
   * ladder record, in the same transaction: `unfinished` does not, because an
   * abandoned game is not a result, and a game against a person does not, because
   * there is no level to move.
   */
  saveGame(input: SaveGameInput, now: string): SavedGame {
    const validNow = validateNow(now);
    const resolved = resolveGame({ ...input });
    const id = uuidv7();

    this.db.transaction(() => {
      this.insertGame.run(
        id, this.profileId, resolved.pgn, resolved.result, resolved.playedAt,
        resolved.playedColor, resolved.opponent, resolved.level, resolved.timeControl,
        validNow, validNow,
      );
      if (resolved.result !== "unfinished" && resolved.opponent === "engine") {
        const won =
          (resolved.result === "white" && resolved.playedColor === "w") ||
          (resolved.result === "black" && resolved.playedColor === "b");
        const drawn = resolved.result === "draw";
        const lost = !won && !drawn;
        this.bumpStats.run(this.profileId, resolved.level, won ? 1 : 0, drawn ? 1 : 0, lost ? 1 : 0, validNow);
      }
    })();

    return { id, profileId: this.profileId, ...resolved, createdAt: validNow, updatedAt: validNow };
  }

  /** Reads one live game in this profile, or throws. */
  getGame(id: string): SavedGame {
    return this.toGame(this.requireGame(id));
  }

  /** Soft-deletes a saved game; `restoreGame` brings it back untouched. The ladder record does not move. */
  deleteGame(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new ChessNotFoundError(`No live game "${id}" to delete in this profile.`);
    }
  }

  /** Puts a soft-deleted game back in the archive. */
  restoreGame(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new ChessNotFoundError(`No deleted game "${id}" to restore in this profile.`);
    }
  }

  /** The game in progress, or null when there is none. */
  getResume(): ResumableGame | null {
    const row = this.selectResume.get(this.profileId) as ResumeRow | undefined;
    if (!row) return null;
    return this.toResume(row);
  }

  /**
   * Writes the game in progress, replacing whatever was there. The move list is
   * replayed on the starting position and the result must equal `fen`: the two
   * columns describe one game or the write is refused.
   */
  setResume(input: SetResumeInput, now: string): ResumableGame {
    const validNow = validateNow(now);
    const resolved = resolveResume({ ...input, moves: [...input.moves] });

    this.upsertResume.run(
      this.profileId, resolved.startFen, resolved.fen, JSON.stringify(resolved.moves),
      resolved.playedColor, resolved.opponent, resolved.level, resolved.timeControl,
      validNow, validNow,
    );
    return { profileId: this.profileId, ...resolved, createdAt: validNow, updatedAt: validNow };
  }

  /** Empties the slot. Clearing what is not there is not an error. */
  clearResume(): void {
    this.deleteResume.run(this.profileId);
  }

  /**
   * All eight levels, ascending, zero-filled — a ladder with holes would make
   * every caller fill them, and the zero is the honest value for a level nobody
   * has played.
   */
  listLevelStats(): ChessLevelStats[] {
    const byLevel = new Map(this.statsRows().map((row) => [row.level, row]));
    return CHESS_LEVELS.map(({ level }) => {
      const row = byLevel.get(level);
      return {
        level,
        played: row?.played ?? 0,
        won: row?.won ?? 0,
        drawn: row?.drawn ?? 0,
        lost: row?.lost ?? 0,
        updatedAt: row?.updated_at ?? null,
      };
    });
  }

  /**
   * The profile's chess content as a versioned plain JSON value — live games
   * only (a soft-deleted game is not content), the game in progress if there is
   * one, and the ladder record. Nothing here is a database handle, a buffer or a
   * date object: what comes out can go through `JSON.stringify` unchanged, which
   * is what the profile archive does with it.
   */
  exportData(): ChessArchive {
    const resume = this.getResume();
    return {
      version: 1,
      games: this.listGames().map((game) => ({
        id: game.id,
        pgn: game.pgn,
        result: game.result,
        playedAt: game.playedAt,
        playedColor: game.playedColor,
        opponent: game.opponent,
        level: game.level,
        timeControl: game.timeControl,
        createdAt: game.createdAt,
        updatedAt: game.updatedAt,
      })),
      resume:
        resume === null
          ? null
          : {
              startFen: resume.startFen,
              fen: resume.fen,
              moves: [...resume.moves],
              playedColor: resume.playedColor,
              opponent: resume.opponent,
              level: resume.level,
              timeControl: resume.timeControl,
              createdAt: resume.createdAt,
              updatedAt: resume.updatedAt,
            },
      levelStats: this.statsRows().map((row) => ({
        level: row.level,
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        updatedAt: row.updated_at,
      })),
    };
  }

  /**
   * Replaces this profile's chess content with an archive.
   *
   * **The whole value is validated before anything is written**, so a refusal
   * leaves the profile exactly as it was — an archive that is half applied is
   * worse than one that is refused, because the user then has two of everything
   * and no way to tell which game is whose. `version` is the first field read: a
   * value from a future build is refused rather than guessed at.
   *
   * Replace rather than merge is the archive's own semantics (the profile
   * restore wipes and rewrites the same way), and it is what makes an import
   * idempotent: importing the same archive twice leaves the same content.
   */
  importData(value: unknown): void {
    const archive = readChessArchive(value);
    try {
      this.db.transaction(() => {
        this.deleteGames.run(this.profileId);
        this.deleteResume.run(this.profileId);
        this.deleteStats.run(this.profileId);
        for (const game of archive.games) {
          this.insertGame.run(
            game.id, this.profileId, game.pgn, game.result, game.playedAt, game.playedColor,
            game.opponent, game.level, game.timeControl, game.createdAt, game.updatedAt,
          );
        }
        if (archive.resume !== null) {
          this.upsertResume.run(
            this.profileId, archive.resume.startFen, archive.resume.fen,
            JSON.stringify(archive.resume.moves), archive.resume.playedColor,
            archive.resume.opponent, archive.resume.level, archive.resume.timeControl,
            archive.resume.createdAt, archive.resume.updatedAt,
          );
        }
        for (const stats of archive.levelStats) {
          this.insertStats.run(
            this.profileId, stats.level, stats.played, stats.won, stats.drawn, stats.lost,
            stats.updatedAt,
          );
        }
      })();
    } catch (error) {
      // A game id is unique across the whole file, not per profile — the
      // arrangement every content table here keeps (migration 055's `habits`).
      // An archive is restored into the profile it came from, so this is the one
      // way a caller can reach the index, and it is a sentence rather than a
      // driver error. The transaction has rolled back: nothing was written.
      if (isUniqueConstraintViolation(error)) {
        throw new ChessValidationError(
          `The archive carries a game id this database already holds under another profile.`,
        );
      }
      throw error;
    }
  }

  private requireGame(id: string): GameRow {
    const row = this.selectGame.get(id, this.profileId) as GameRow | undefined;
    if (!row) throw new ChessNotFoundError(`No live game "${id}" in this profile.`);
    return row;
  }

  private statsRows(): StatsRow[] {
    return this.selectStats.all(this.profileId) as StatsRow[];
  }

  private toGame(row: GameRow): SavedGame {
    return {
      id: row.id,
      profileId: row.profile_id,
      pgn: row.pgn,
      result: row.result as ChessGameResult,
      playedAt: row.played_at,
      playedColor: row.played_color as ChessColor,
      opponent: row.opponent as ChessOpponent,
      level: row.level,
      timeControl: row.time_control,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toResume(row: ResumeRow): ResumableGame {
    return {
      profileId: row.profile_id,
      startFen: row.start_fen,
      fen: row.fen,
      moves: parseStoredMoves(row.moves, row.profile_id),
      playedColor: row.played_color as ChessColor,
      opponent: row.opponent as ChessOpponent,
      level: row.level,
      timeControl: row.time_control,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

/** A saved game's own fields, minus the ones the row rather than the caller decides. */
type ResolvedGame = Omit<SavedGame, "id" | "profileId" | "createdAt" | "updatedAt">;

/**
 * Validates and resolves one saved game — the ONE place every refusal lives, and
 * the one the archive reader calls too, so a game from a file is held to exactly
 * what a game from the wire is held to. The record is untyped on purpose: this is
 * the boundary where a value stops being unknown.
 */
function resolveGame(input: Record<string, unknown>): ResolvedGame {
  return {
    pgn: validatePgn(input["pgn"]),
    result: validateEnum(input["result"], "result", RESULTS),
    playedAt: validateInstant(input["playedAt"], "playedAt"),
    playedColor: validateEnum(input["playedColor"], "playedColor", COLORS),
    ...validateOpponent(input["opponent"], input["level"]),
    timeControl: validateTimeControl(input["timeControl"]),
  };
}

/** The resume slot's own fields, minus the ones the row decides. */
type ResolvedResume = Omit<ResumableGame, "profileId" | "createdAt" | "updatedAt">;

function resolveResume(input: Record<string, unknown>): ResolvedResume {
  const startFen = validateFenText(input["startFen"], "startFen");
  const moves = validateMoveList(input["moves"]);
  const fen = validateFenText(input["fen"], "fen");

  // The one check a shape cannot make: the move list and the position have to be
  // the same game. `replayUci` refuses an illegal move with the engine's own
  // error, which is renamed here so a caller catches one error family.
  let produced: string;
  try {
    produced = replayUci(startFen, moves).fen;
  } catch {
    throw new ChessValidationError(`"moves" is not a legal continuation of "startFen".`);
  }
  if (produced !== fen) {
    throw new ChessValidationError(`"fen" is not the position "moves" produces.`);
  }

  return {
    startFen,
    fen,
    moves,
    playedColor: validateEnum(input["playedColor"], "playedColor", COLORS),
    ...validateOpponent(input["opponent"], input["level"]),
    timeControl: validateTimeControl(input["timeControl"]),
  };
}

/**
 * The opponent and the level, together, because neither is meaningful alone: an
 * engine game names a level, and a game against a person carries none. This is
 * migration 082's pair CHECK, refused by name rather than left to the database.
 */
function validateOpponent(
  opponent: unknown,
  level: unknown,
): { opponent: ChessOpponent; level: number | null } {
  const validOpponent = validateEnum(opponent, "opponent", OPPONENTS);
  if (validOpponent === "human") {
    if (level !== null && level !== undefined) {
      throw new ChessValidationError(`"level" belongs to an engine game, not a game against a person.`);
    }
    return { opponent: validOpponent, level: null };
  }
  return { opponent: validOpponent, level: asInteger(level, "level", 1, MAX_CHESS_LEVEL) };
}

/**
 * Reads the stored move list back. This store writes only `JSON.stringify` output
 * of a validated list, so anything that fails to parse is corruption — a
 * hand-edited file or a bad restore — rather than input to coerce, and reading it
 * as an empty list would silently throw away somebody's game
 * (`HabitStore.parseStoredSchedule`'s posture).
 */
function parseStoredMoves(text: string, profileId: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed) || parsed.some((move) => typeof move !== "string")) {
    throw new ChessValidationError(
      `The game in progress for profile "${profileId}" carries a stored move list that is not valid.`,
    );
  }
  return parsed as string[];
}

function validatePgn(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_CHESS_PGN_LENGTH) {
    throw new ChessValidationError(
      `"pgn" must be 1-${MAX_CHESS_PGN_LENGTH} characters.`,
    );
  }
  try {
    loadGamePgn(value);
  } catch {
    throw new ChessValidationError(`"pgn" is not a game this build can read.`);
  }
  return value;
}

function validateFenText(value: unknown, field: string): string {
  if (typeof value !== "string" || !isValidFen(value)) {
    throw new ChessValidationError(`"${field}" is not a position.`);
  }
  return value;
}

/** A list of UCI moves, each shaped like one. Whether they are LEGAL is the replay's question. */
function validateMoveList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_CHESS_RESUME_MOVES) {
    throw new ChessValidationError(
      `"moves" must be an array of at most ${MAX_CHESS_RESUME_MOVES} moves.`,
    );
  }
  return value.map((move) => {
    if (typeof move !== "string" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move.toLowerCase())) {
      throw new ChessValidationError(`"${String(move)}" is not a move.`);
    }
    return move.toLowerCase();
  });
}

function validateTimeControl(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new ChessValidationError(`"timeControl" must be a string or null.`);
  }
  const match = TIME_CONTROL.exec(value);
  if (match === null) {
    throw new ChessValidationError(`"timeControl" must be a "base+increment" clock in seconds.`);
  }
  const base = Number(match[1]);
  const increment = Number(match[2]);
  if (base > MAX_TIME_CONTROL_BASE_SECONDS || increment > MAX_TIME_CONTROL_INCREMENT_SECONDS) {
    throw new ChessValidationError(
      `"timeControl" must be at most ${MAX_TIME_CONTROL_BASE_SECONDS}+${MAX_TIME_CONTROL_INCREMENT_SECONDS} seconds.`,
    );
  }
  return value;
}

function validateInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || !isDateTime(value)) {
    throw new ChessValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}

function validateNow(value: string): string {
  return validateInstant(value, "now");
}

function validateEnum<T extends string>(value: unknown, field: string, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ChessValidationError(`"${field}" must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

/**
 * The archive reader. Every field is checked against the same validators the live
 * path uses — a game is no more trustworthy for having arrived in a file — and
 * the result is a value the writer can insert without asking a second question.
 *
 * Ids are bounded and unique within the archive: `MAX_ID_LENGTH` is the same
 * ceiling the rest of this product puts on an identifier, and two games with one
 * id would collide on the primary key halfway through the write.
 *
 * **Exported, and that is the module kit's requirement rather than a widening of
 * this store's surface.** Stage 2 registers an archive section whose `parse` has
 * to read a whole payload and throw on anything it will not take, BEFORE anything
 * is written (`ModuleImport.parse`, ADR-090 §imex) — so the module needs the
 * reader, and the alternative is a second implementation of „what a chess archive
 * is" in the module's own folder, which is the drift this file exists to prevent.
 * `importData` runs the same function a second time on apply, so a payload this
 * reader accepted and the store then refuses is not a state that can be reached.
 */
export function readChessArchive(value: unknown): ChessArchive {
  const record = asRecord(value, "archive");
  if (record["version"] !== 1) {
    throw new ChessValidationError(
      `Unsupported chess archive version ${String(record["version"])}; this build reads version 1.`,
    );
  }

  const games = asArray(record["games"], "games").map((entry, index) => {
    const game = asRecord(entry, `games[${index}]`);
    // The fields go through the SAME resolvers as a live write, so an archive
    // cannot introduce a game the store would have refused.
    const resolved = resolveGame(game);
    return {
      id: asId(game["id"], `games[${index}].id`),
      ...resolved,
      createdAt: validateInstant(game["createdAt"], `games[${index}].createdAt`),
      updatedAt: validateInstant(game["updatedAt"], `games[${index}].updatedAt`),
    };
  });

  const seen = new Set<string>();
  for (const game of games) {
    if (seen.has(game.id)) {
      throw new ChessValidationError(`Two games in the archive share the id "${game.id}".`);
    }
    seen.add(game.id);
  }

  const resumeValue = record["resume"];
  const resume =
    resumeValue === null || resumeValue === undefined
      ? null
      : readArchiveResume(asRecord(resumeValue, "resume"));

  const levelStats = asArray(record["levelStats"], "levelStats").map((entry, index) => {
    const stats = asRecord(entry, `levelStats[${index}]`);
    const level = asInteger(stats["level"], `levelStats[${index}].level`, 1, MAX_CHESS_LEVEL);
    const played = asCount(stats["played"], `levelStats[${index}].played`);
    const won = asCount(stats["won"], `levelStats[${index}].won`);
    const drawn = asCount(stats["drawn"], `levelStats[${index}].drawn`);
    const lost = asCount(stats["lost"], `levelStats[${index}].lost`);
    if (played !== won + drawn + lost) {
      throw new ChessValidationError(
        `levelStats[${index}]: "played" must equal "won" + "drawn" + "lost".`,
      );
    }
    return {
      level,
      played,
      won,
      drawn,
      lost,
      updatedAt: validateInstant(stats["updatedAt"], `levelStats[${index}].updatedAt`),
    };
  });
  const levels = new Set(levelStats.map((stats) => stats.level));
  if (levels.size !== levelStats.length) {
    throw new ChessValidationError(`The archive carries two statistics rows for one level.`);
  }

  return { version: 1, games, resume, levelStats };
}

function readArchiveResume(record: Record<string, unknown>): ChessArchiveResume {
  const resolved = resolveResume(record);
  return {
    ...resolved,
    createdAt: validateInstant(record["createdAt"], "resume.createdAt"),
    updatedAt: validateInstant(record["updatedAt"], "resume.updatedAt"),
  };
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ChessValidationError(`"${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new ChessValidationError(`"${field}" must be an array.`);
  return value;
}

function asId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new ChessValidationError(
      `"${field}" must be a string of 1-${MAX_ID_LENGTH} characters.`,
    );
  }
  return value;
}

function asInteger(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new ChessValidationError(`"${field}" must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

/** A counter in the ladder record: a whole number that cannot be negative. */
function asCount(value: unknown, field: string): number {
  return asInteger(value, field, 0, Number.MAX_SAFE_INTEGER);
}

