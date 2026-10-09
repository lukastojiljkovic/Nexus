import type Database from "better-sqlite3-multiple-ciphers";
import {
  CARD_GAMES,
  CARD_GAME_VARIANTS,
  isCardGameId,
  isCardGameVariant,
  isCardSeed,
  isFreeCellDeal,
  replayFreeCell,
  replayKlondike,
  replaySpider,
  type CardGameId,
  type CardGameVariant,
  type FreeCellVariant,
  type FreeCellMove,
  type GameLogEntry,
  type KlondikeMove,
  type KlondikeVariant,
  type SpiderMove,
  type SpiderVariant,
} from "@nexus/core";
import { CardGameValidationError } from "../../errors.js";
import { isDateTime } from "../../finance/money.js";

type DatabaseHandle = Database.Database;

/**
 * The ceiling on one saved game's move list. A Klondike game is a few hundred
 * moves and a Spider game with heavy undo use is still under a thousand, so this
 * is four times the worst real one; what it stops is an untrusted caller parking
 * a megabyte of JSON in a column every read then parses.
 */
export const MAX_CARD_GAME_MOVES = 4_000;

/**
 * And the ceiling on that list's TEXT. The count alone does not bound the size —
 * one entry can be arbitrarily long — and the text is what the column carries.
 * Measured in characters of the JSON, which for a move list is bytes: every
 * character a move can contain is ASCII (a suit name, a column index, a count).
 */
export const MAX_CARD_GAME_MOVES_BYTES = 262_144;

/**
 * Play time, in whole seconds, and a ceiling of twenty-four hours. A single
 * sitting longer than that is not a card game, and the bound is what stops an
 * untrusted caller putting an arbitrary integer into a column every reader sums.
 */
export const MAX_CARD_GAME_ELAPSED_SECONDS = 86_400;

/** The version on `CardGameData`, and the only one `importData` accepts. */
export const CARD_GAME_ARCHIVE_VERSION = 1;

/**
 * One game's record, per variant: how many deals were finished, how many were
 * won, the best time and score, and the two streaks.
 *
 * `bestTimeSeconds` and `bestScore` are NULL until the first WIN, and that is the
 * definition rather than an omission: a best is a result somebody achieved, and a
 * deal abandoned at 300 points is not a best score. Both are raised, never
 * lowered.
 */
export interface CardGameStats {
  readonly game: CardGameId;
  readonly variant: CardGameVariant;
  readonly played: number;
  readonly won: number;
  readonly bestTimeSeconds: number | null;
  readonly bestScore: number | null;
  readonly currentStreak: number;
  readonly longestStreak: number;
  /** When this row was last written; null while there is no row at all. */
  readonly updatedAt: string | null;
}

/** One finished deal, as the game reports it. `score` is the engine's own running total. */
export interface CardGameResultInput {
  readonly game: CardGameId;
  readonly variant: CardGameVariant;
  readonly won: boolean;
  readonly elapsedSeconds: number;
  readonly score: number;
}

/** A game in progress: the seed it was dealt from, and every action since. */
export interface CardGameProgressInput {
  readonly game: CardGameId;
  readonly variant: CardGameVariant;
  readonly seed: number;
  readonly moves: readonly unknown[];
  readonly elapsedSeconds: number;
}

/**
 * A saved game read back, as a union the caller can switch on — which is what
 * makes resume a one-line call into the engine (`replayKlondike`, `replayFreeCell`
 * or `replaySpider`) rather than a cast. Each branch carries the moves in its own
 * game's vocabulary because the store validated them with that game's engine.
 */
export type CardGameProgress =
  | {
      readonly game: "klondike";
      readonly variant: KlondikeVariant;
      readonly seed: number;
      readonly moves: readonly GameLogEntry<KlondikeMove>[];
      readonly elapsedSeconds: number;
      readonly score: number;
      readonly updatedAt: string;
    }
  | {
      readonly game: "freecell";
      readonly variant: FreeCellVariant;
      readonly seed: number;
      readonly moves: readonly GameLogEntry<FreeCellMove>[];
      readonly elapsedSeconds: number;
      readonly score: number;
      readonly updatedAt: string;
    }
  | {
      readonly game: "spider";
      readonly variant: SpiderVariant;
      readonly seed: number;
      readonly moves: readonly GameLogEntry<SpiderMove>[];
      readonly elapsedSeconds: number;
      readonly score: number;
      readonly updatedAt: string;
    };

/**
 * Everything GAMES stores for one profile, versioned and plain — what
 * `importData` accepts and what stage 2 puts in the profile archive beside the
 * other modules' data.
 */
export interface CardGameData {
  readonly version: number;
  readonly stats: readonly CardGameStats[];
  readonly saves: readonly {
    readonly game: CardGameId;
    readonly variant: CardGameVariant;
    readonly seed: number;
    readonly moves: readonly unknown[];
    readonly elapsedSeconds: number;
  }[];
}

interface StatRow {
  profile_id: string;
  game: string;
  variant: string;
  played: number;
  won: number;
  best_time_seconds: number | null;
  best_score: number | null;
  current_streak: number;
  longest_streak: number;
  updated_at: string;
}

interface SaveRow {
  profile_id: string;
  game: string;
  variant: string;
  seed: number;
  moves_json: string;
  elapsed_seconds: number;
  created_at: string;
  updated_at: string;
}

const STAT_COLUMNS =
  "game, variant, played, won, best_time_seconds, best_score, current_streak," +
  " longest_streak, updated_at";

/** Timestamps for imported rows whose archive carries none; an archive's own times travel with it when they exist. */
const FALLBACK_TIMESTAMP = "1970-01-01T00:00:00.000Z";

/**
 * GAMES' card tables for a single profile, over prepared, parameterized
 * statements (SEC-API-03). Construct one per profile and reuse it.
 *
 * **Every statement is scoped by `profile_id`**, which for these two tables is
 * also half of the primary key — so a write naming another profile's game cannot
 * even be expressed as an update: it is an insert of a row that is not there.
 *
 * **The store's validation is the ENGINE's validation.** Lengths, enums, ranges
 * and required fields are checked here, and then the whole move list is handed to
 * `replayKlondike`/`replayFreeCell`/`replaySpider`, which folds it from its own
 * seed and refuses anything the rules would not have allowed. That is what makes
 * „stage 2 may pass untrusted input straight in" true rather than hopeful: a
 * forged move list, a seed outside the deal range and a truncated log all come
 * back as `CardGameValidationError`, from the same engine the UI's own moves go
 * through. The replay is linear in the move list and the list is capped, so the
 * cost is bounded — the test measures it.
 *
 * **`now` is supplied by the caller and validated here** — main stamps the clock,
 * the renderer never does.
 */
export class CardGameStore {
  private readonly selectStats: Database.Statement;
  private readonly selectAllStats: Database.Statement;
  private readonly upsertStats: Database.Statement;
  private readonly deleteAllStats: Database.Statement;
  private readonly selectSave: Database.Statement;
  private readonly selectAllSaves: Database.Statement;
  private readonly upsertSave: Database.Statement;
  private readonly deleteSave: Database.Statement;
  private readonly deleteAllSaves: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectStats = db.prepare(
      `SELECT ${STAT_COLUMNS} FROM cardgame_stats
        WHERE profile_id = ? AND game = ? AND variant = ?`,
    );
    this.selectAllStats = db.prepare(
      `SELECT ${STAT_COLUMNS} FROM cardgame_stats WHERE profile_id = ?`,
    );
    // The conflict target names the primary key and only it, so a violated CHECK
    // — a float count, a win without a play — still throws rather than being
    // swallowed by a blanket „ignore".
    this.upsertStats = db.prepare(
      `INSERT INTO cardgame_stats
         (profile_id, game, variant, played, won, best_time_seconds, best_score,
          current_streak, longest_streak, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id, game, variant) DO UPDATE SET
         played = excluded.played,
         won = excluded.won,
         best_time_seconds = excluded.best_time_seconds,
         best_score = excluded.best_score,
         current_streak = excluded.current_streak,
         longest_streak = excluded.longest_streak,
         updated_at = excluded.updated_at`,
    );
    this.deleteAllStats = db.prepare("DELETE FROM cardgame_stats WHERE profile_id = ?");
    this.selectSave = db.prepare(
      `SELECT profile_id, game, variant, seed, moves_json, elapsed_seconds, created_at, updated_at
         FROM cardgame_saves WHERE profile_id = ? AND game = ? AND variant = ?`,
    );
    this.selectAllSaves = db.prepare(
      `SELECT profile_id, game, variant, seed, moves_json, elapsed_seconds, created_at, updated_at
         FROM cardgame_saves WHERE profile_id = ?`,
    );
    // `created_at` is left at the first save's moment, on `HabitStore.upsertEntry`'s
    // terms: the row is the same game in progress, continued.
    this.upsertSave = db.prepare(
      `INSERT INTO cardgame_saves
         (profile_id, game, variant, seed, moves_json, elapsed_seconds, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id, game, variant) DO UPDATE SET
         seed = excluded.seed,
         moves_json = excluded.moves_json,
         elapsed_seconds = excluded.elapsed_seconds,
         updated_at = excluded.updated_at`,
    );
    this.deleteSave = db.prepare(
      "DELETE FROM cardgame_saves WHERE profile_id = ? AND game = ? AND variant = ?",
    );
    this.deleteAllSaves = db.prepare("DELETE FROM cardgame_saves WHERE profile_id = ?");
  }

  /**
   * One game's record. A pair that has never been played answers ZEROES rather
   * than null — a page wants a row to draw either way — with `updatedAt` null,
   * which is the one field that can say „nothing has happened yet".
   */
  getStats(game: CardGameId, variant: CardGameVariant): CardGameStats {
    const { game: validGame, variant: validVariant } = resolveKey(game, variant);
    const row = this.selectStats.get(this.profileId, validGame, validVariant) as
      | StatRow
      | undefined;
    return row === undefined ? emptyStats(validGame, validVariant) : toStats(row);
  }

  /**
   * Every row this profile has, in the vocabulary's own order — Klondike, then
   * FreeCell, then Spider, each in the order `CARD_GAME_VARIANTS` lists. Sorted
   * here rather than in SQL for `HabitStore`'s reason: the order is a fact about
   * the closed vocabulary, not about the alphabet, and a caller that had to fix
   * the order itself is a bug waiting to be inherited.
   */
  listStats(): CardGameStats[] {
    const rows = this.selectAllStats.all(this.profileId) as StatRow[];
    const byKey = new Map(rows.map((row) => [`${row.game}/${row.variant}`, toStats(row)]));
    const out: CardGameStats[] = [];
    for (const game of CARD_GAMES) {
      for (const variant of CARD_GAME_VARIANTS[game]) {
        out.push(byKey.get(`${game}/${variant}`) ?? emptyStats(game, variant));
      }
    }
    return out;
  }

  /**
   * Records one finished deal. `played` goes up whatever happened; `won`, the two
   * bests and the streaks move only when it was won. A loss ends the current
   * streak — the longest is never lowered, because a record of what somebody did
   * is not something a later loss can take away.
   */
  recordResult(input: CardGameResultInput, now: string): CardGameStats {
    const validNow = validateNow(now);
    const { game, variant } = resolveKey(input.game, input.variant);
    if (typeof input.won !== "boolean") {
      throw new CardGameValidationError(`"won" must be a boolean.`);
    }
    const elapsedSeconds = validateElapsed(input.elapsedSeconds);
    const score = validateScore(input.score);

    const current = this.getStats(game, variant);
    const currentStreak = input.won ? current.currentStreak + 1 : 0;
    const bestTimeSeconds =
      input.won && (current.bestTimeSeconds === null || elapsedSeconds < current.bestTimeSeconds)
        ? elapsedSeconds
        : current.bestTimeSeconds;
    const bestScore =
      input.won && (current.bestScore === null || score > current.bestScore)
        ? score
        : current.bestScore;

    this.upsertStats.run(
      this.profileId,
      game,
      variant,
      current.played + 1,
      current.won + (input.won ? 1 : 0),
      bestTimeSeconds,
      bestScore,
      currentStreak,
      Math.max(current.longestStreak, currentStreak),
      validNow,
    );
    return this.getStats(game, variant);
  }

  /**
   * Stores the game in progress, replacing whatever that pair had — „one saved
   * game per game and variant" is the PRIMARY KEY's promise rather than this
   * method's care. The move list is validated and replayed before anything is
   * written, so a row only ever holds a game that can be resumed.
   */
  saveProgress(input: CardGameProgressInput, now: string): CardGameProgress {
    const validNow = validateNow(now);
    const { game, variant } = resolveKey(input.game, input.variant);
    const seed = resolveSeed(game, input.seed);
    const elapsedSeconds = validateElapsed(input.elapsedSeconds);
    const { text } = validateMoves(game, variant, seed, input.moves);

    this.upsertSave.run(
      this.profileId,
      game,
      variant,
      seed,
      text,
      elapsedSeconds,
      validNow,
      validNow,
    );
    const progress = this.getProgress(game, variant);
    if (progress === null) {
      // Unreachable: the row was written one statement ago, in the same profile.
      throw new CardGameValidationError(`The saved ${game} game could not be read back.`);
    }
    return progress;
  }

  /** The saved game for one pair, or null. A stored row that no longer replays is CORRUPTION and throws. */
  getProgress(game: CardGameId, variant: CardGameVariant): CardGameProgress | null {
    const { game: validGame, variant: validVariant } = resolveKey(game, variant);
    const row = this.selectSave.get(this.profileId, validGame, validVariant) as SaveRow | undefined;
    return row === undefined ? null : this.toProgress(row);
  }

  /**
   * Every game in progress, in the vocabulary's order like `listStats`. Each row
   * is replayed as it is read, so a page listing three saved games pays for three
   * replays — measured, and small (see the test).
   */
  listProgress(): CardGameProgress[] {
    const order = new Map<string, number>();
    CARD_GAMES.forEach((game) =>
      CARD_GAME_VARIANTS[game].forEach((variant, index) =>
        order.set(`${game}/${variant}`, CARD_GAMES.indexOf(game) * 10 + index),
      ),
    );
    return (this.selectAllSaves.all(this.profileId) as SaveRow[])
      .sort(
        (left, right) =>
          (order.get(`${left.game}/${left.variant}`) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(`${right.game}/${right.variant}`) ?? Number.MAX_SAFE_INTEGER),
      )
      .map((row) => this.toProgress(row));
  }

  /**
   * Forgets the game in progress. Removing one that is not there is not an error —
   * the caller asked for a pair with no saved game and that is what stands
   * afterwards (`HabitStore.clearEntry`'s rule). A finished game is cleared this
   * way and nothing else has to happen: the statistics were recorded by
   * `recordResult` when the deal ended.
   */
  clearProgress(game: CardGameId, variant: CardGameVariant): void {
    const { game: validGame, variant: validVariant } = resolveKey(game, variant);
    this.deleteSave.run(this.profileId, validGame, validVariant);
  }

  /**
   * Everything this profile has, as plain JSON with a version on it — what the
   * archive carries.
   *
   * Only rows that EXIST travel: `listStats` answers a zero row for a pair nobody
   * has played so a page has something to draw, and exporting those would turn one
   * profile's display into another profile's data (six rows of zeroes, with a
   * timestamp the archive invented). The filter is on `updatedAt`, which is exactly
   * the field that distinguishes „a row that says zero" from „no row at all".
   */
  exportData(): CardGameData {
    const saves = (this.selectAllSaves.all(this.profileId) as SaveRow[])
      .map((row) => this.parseRow(row))
      .map((row) => ({
        game: row.game,
        variant: row.variant,
        seed: row.seed,
        moves: row.moves,
        elapsedSeconds: row.elapsedSeconds,
      }));
    const stats = this.listStats().filter((row) => row.updatedAt !== null);
    return { version: CARD_GAME_ARCHIVE_VERSION, stats, saves };
  }

  /**
   * Replaces this profile's card-game data with an exported value.
   *
   * **The whole value is validated before anything is written**, and the version
   * is the first check: an archive written by a later Nexus must not be half
   * imported into an earlier one. Only then does one transaction delete this
   * profile's rows and insert the archive's, so a refusal leaves the profile
   * exactly as it was.
   */
  importData(value: unknown): void {
    const parsed = parseCardGameData(value);
    this.db.transaction(() => {
      this.deleteAllSaves.run(this.profileId);
      this.deleteAllStats.run(this.profileId);
      for (const row of parsed.stats) {
        this.upsertStats.run(
          this.profileId,
          row.game,
          row.variant,
          row.played,
          row.won,
          row.bestTimeSeconds,
          row.bestScore,
          row.currentStreak,
          row.longestStreak,
          row.updatedAt ?? FALLBACK_TIMESTAMP,
        );
      }
      for (const row of parsed.saves) {
        this.upsertSave.run(
          this.profileId,
          row.game,
          row.variant,
          row.seed,
          row.text,
          row.elapsedSeconds,
          FALLBACK_TIMESTAMP,
          FALLBACK_TIMESTAMP,
        );
      }
    })();
  }

  /** Reads one stored row back into plain values, refusing a row that no longer replays. */
  private parseRow(row: SaveRow): {
    game: CardGameId;
    variant: CardGameVariant;
    seed: number;
    moves: readonly unknown[];
    score: number;
    elapsedSeconds: number;
    updatedAt: string;
  } {
    const { game, variant } = resolveKey(row.game, row.variant);
    const seed = resolveSeed(game, row.seed);
    const elapsedSeconds = validateElapsed(row.elapsed_seconds);
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.moves_json);
    } catch {
      parsed = null;
    }
    const { moves, score } = validateMoves(game, variant, seed, parsed);
    return { game, variant, seed, moves, score, elapsedSeconds, updatedAt: row.updated_at };
  }

  private toProgress(row: SaveRow): CardGameProgress {
    const parsed = this.parseRow(row);
    // The cast is the validation's own conclusion: the branch was chosen from the
    // game, and that game's engine is the only thing that could have accepted the
    // move list it just folded.
    switch (parsed.game) {
      case "klondike":
        return {
          game: "klondike",
          // The variant was resolved against this game's own list, so the branch
          // and the variant agree by construction (`resolveKey` is the only door).
          variant: parsed.variant as KlondikeVariant,
          seed: parsed.seed,
          moves: parsed.moves as readonly GameLogEntry<KlondikeMove>[],
          elapsedSeconds: parsed.elapsedSeconds,
          score: parsed.score,
          updatedAt: parsed.updatedAt,
        };
      case "freecell":
        return {
          game: "freecell",
          variant: parsed.variant as FreeCellVariant,
          seed: parsed.seed,
          moves: parsed.moves as readonly GameLogEntry<FreeCellMove>[],
          elapsedSeconds: parsed.elapsedSeconds,
          score: parsed.score,
          updatedAt: parsed.updatedAt,
        };
      case "spider":
        return {
          game: "spider",
          variant: parsed.variant as SpiderVariant,
          seed: parsed.seed,
          moves: parsed.moves as readonly GameLogEntry<SpiderMove>[],
          elapsedSeconds: parsed.elapsedSeconds,
          score: parsed.score,
          updatedAt: parsed.updatedAt,
        };
    }
  }
}

function emptyStats(game: CardGameId, variant: CardGameVariant): CardGameStats {
  return {
    game,
    variant,
    played: 0,
    won: 0,
    bestTimeSeconds: null,
    bestScore: null,
    currentStreak: 0,
    longestStreak: 0,
    updatedAt: null,
  };
}

function toStats(row: StatRow): CardGameStats {
  const { game, variant } = resolveKey(row.game, row.variant);
  return {
    game,
    variant,
    played: row.played,
    won: row.won,
    bestTimeSeconds: row.best_time_seconds,
    bestScore: row.best_score,
    currentStreak: row.current_streak,
    longestStreak: row.longest_streak,
    updatedAt: row.updated_at,
  };
}

/**
 * The ONE place a (game, variant) pair is judged, so that no method can be right
 * about the vocabulary while another is wrong. The list itself is
 * `@nexus/core`'s, not a copy that could drift from what the engines deal.
 */
function resolveKey(
  game: unknown,
  variant: unknown,
): { game: CardGameId; variant: CardGameVariant } {
  if (!isCardGameId(game)) {
    throw new CardGameValidationError(
      `"game" must be one of ${CARD_GAMES.join(", ")}, got ${JSON.stringify(game)}.`,
    );
  }
  if (!isCardGameVariant(game, variant)) {
    throw new CardGameValidationError(
      `"variant" must be one of ${CARD_GAME_VARIANTS[game].join(", ")} for ${game}.`,
    );
  }
  return { game, variant };
}

/**
 * A seed is a 32-bit unsigned integer, and for FreeCell it is a DEAL NUMBER: the
 * classic set is 1 to 32 000, so zero and 32 001 are refused here by the same
 * predicate the deal refuses them with, rather than at replay time with a message
 * about a table nobody asked for.
 */
function resolveSeed(game: CardGameId, seed: unknown): number {
  if (game === "freecell") {
    if (!isFreeCellDeal(seed)) {
      throw new CardGameValidationError(`"seed" must be a FreeCell deal number, 1 to 32000.`);
    }
    return seed;
  }
  if (!isCardSeed(seed)) {
    throw new CardGameValidationError(`"seed" must be a 32-bit unsigned integer.`);
  }
  return seed;
}

/**
 * The move list: a list at all, within both ceilings, and then a log the game's
 * own engine folds without complaint. The refusal's `detail` is the engine's, so
 * the sentence a developer reads names the entry and the rule that refused it.
 */
function validateMoves(
  game: CardGameId,
  variant: CardGameVariant,
  seed: number,
  moves: unknown,
): { moves: readonly unknown[]; score: number; text: string } {
  if (!Array.isArray(moves)) {
    throw new CardGameValidationError(`"moves" must be a list of moves.`);
  }
  if (moves.length > MAX_CARD_GAME_MOVES) {
    throw new CardGameValidationError(
      `A saved game may hold at most ${MAX_CARD_GAME_MOVES} moves, got ${moves.length}.`,
    );
  }
  const text = JSON.stringify(moves);
  if (text.length > MAX_CARD_GAME_MOVES_BYTES) {
    throw new CardGameValidationError(
      `A saved game's move list may hold at most ${MAX_CARD_GAME_MOVES_BYTES} characters.`,
    );
  }
  switch (game) {
    case "klondike": {
      const replayed = replayKlondike(variant as KlondikeVariant, seed, moves);
      if (!replayed.ok) throw new CardGameValidationError(replayed.refusal.detail);
      return { moves, score: replayed.state.score, text };
    }
    case "freecell": {
      const replayed = replayFreeCell(seed, moves);
      if (!replayed.ok) throw new CardGameValidationError(replayed.refusal.detail);
      return { moves, score: replayed.state.score, text };
    }
    case "spider": {
      const replayed = replaySpider(variant as SpiderVariant, seed, moves);
      if (!replayed.ok) throw new CardGameValidationError(replayed.refusal.detail);
      return { moves, score: replayed.state.score, text };
    }
  }
}

function validateElapsed(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_CARD_GAME_ELAPSED_SECONDS
  ) {
    throw new CardGameValidationError(
      `"elapsedSeconds" must be a whole number of seconds in 0 to ${MAX_CARD_GAME_ELAPSED_SECONDS}.`,
    );
  }
  return value;
}

function validateScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new CardGameValidationError(`"score" must be a whole number.`);
  }
  return value;
}

/** A count a CHECK also states, as a whole non-negative integer. */
function validateCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new CardGameValidationError(`"${field}" must be a whole number of zero or more.`);
  }
  return value;
}

function validateNow(value: unknown): string {
  if (typeof value !== "string" || !isDateTime(value)) {
    throw new CardGameValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}

/**
 * Validates a whole exported value: the version first, then every stat and every
 * save through the SAME resolvers the live methods use — including replaying each
 * move list — and only then hands back what may be written. Nothing here touches
 * the database, which is what makes „refuses before writing anything" literal.
 */
function parseCardGameData(value: unknown): {
  stats: readonly CardGameStats[];
  saves: readonly {
    game: CardGameId;
    variant: CardGameVariant;
    seed: number;
    text: string;
    elapsedSeconds: number;
  }[];
} {
  if (typeof value !== "object" || value === null) {
    throw new CardGameValidationError("The card-game data must be an object.");
  }
  const candidate = value as { version?: unknown; stats?: unknown; saves?: unknown };
  if (candidate.version !== CARD_GAME_ARCHIVE_VERSION) {
    throw new CardGameValidationError(
      `Card-game data version ${String(candidate.version)} is not version ${CARD_GAME_ARCHIVE_VERSION}.`,
    );
  }
  if (!Array.isArray(candidate.stats) || !Array.isArray(candidate.saves)) {
    throw new CardGameValidationError(`Card-game data needs a "stats" and a "saves" list.`);
  }

  const stats: CardGameStats[] = [];
  const seenStats = new Set<string>();
  for (const raw of candidate.stats as unknown[]) {
    if (typeof raw !== "object" || raw === null) {
      throw new CardGameValidationError("Every statistics row must be an object.");
    }
    const row = raw as Record<string, unknown>;
    const { game, variant } = resolveKey(row["game"], row["variant"]);
    const key = `${game}/${variant}`;
    // Two rows for one pair would silently keep the last one, which is an archive
    // that says two different things about the same game.
    if (seenStats.has(key)) {
      throw new CardGameValidationError(`The statistics list names ${key} twice.`);
    }
    seenStats.add(key);
    const played = validateCount(row["played"], "played");
    const won = validateCount(row["won"], "won");
    if (won > played) {
      throw new CardGameValidationError(`"won" must not exceed "played".`);
    }
    const currentStreak = validateCount(row["currentStreak"], "currentStreak");
    const longestStreak = validateCount(row["longestStreak"], "longestStreak");
    if (currentStreak > longestStreak) {
      throw new CardGameValidationError(`"currentStreak" must not exceed "longestStreak".`);
    }
    const bestTimeSeconds =
      row["bestTimeSeconds"] === null
        ? null
        : validateCount(row["bestTimeSeconds"], "bestTimeSeconds");
    const bestScore = row["bestScore"] === null ? null : validateScore(row["bestScore"]);
    const updatedAt = row["updatedAt"] === null ? null : validateNow(row["updatedAt"]);
    stats.push({
      game,
      variant,
      played,
      won,
      bestTimeSeconds,
      bestScore,
      currentStreak,
      longestStreak,
      updatedAt,
    });
  }

  const saves: {
    game: CardGameId;
    variant: CardGameVariant;
    seed: number;
    text: string;
    elapsedSeconds: number;
  }[] = [];
  const seenSaves = new Set<string>();
  for (const raw of candidate.saves as unknown[]) {
    if (typeof raw !== "object" || raw === null) {
      throw new CardGameValidationError("Every saved game must be an object.");
    }
    const row = raw as Record<string, unknown>;
    const { game, variant } = resolveKey(row["game"], row["variant"]);
    const key = `${game}/${variant}`;
    if (seenSaves.has(key)) {
      throw new CardGameValidationError(`The saves list names ${key} twice.`);
    }
    seenSaves.add(key);
    const seed = resolveSeed(game, row["seed"]);
    const elapsedSeconds = validateElapsed(row["elapsedSeconds"]);
    const { text } = validateMoves(game, variant, seed, row["moves"]);
    saves.push({ game, variant, seed, text, elapsedSeconds });
  }
  return { stats, saves };
}
