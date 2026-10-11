import type Database from "better-sqlite3-multiple-ciphers";
import {
  BOARDS_GAMES,
  boardEngine,
  isBoardSeatKind,
  isBoardsGame,
  normalizeBoardState,
  replayBoard,
  turnSeat,
} from "@nexus/core";
import type { BoardEvent, BoardSeatKind, BoardsGame } from "@nexus/core";
import { DatabaseError } from "../../errors.js";
import { isDateTime } from "../../finance/money.js";

type DatabaseHandle = Database.Database;

/**
 * The most events one game may hold.
 *
 * A bound on untrusted input rather than a limit anybody meets: the longest of
 * these games (ludo, four tokens a seat) runs to a few hundred moves, and every
 * event costs a JSON value inside a column every archive then carries.
 */
export const MAX_BOARDS_EVENTS = 512;

/** The longest canonical state this module will store — the column's own CHECK, stated where a caller can read it. */
export const MAX_BOARDS_STATE_CHARS = 16_384;

/** The longest serialized event log this module will store. */
export const MAX_BOARDS_EVENTS_CHARS = 40_000;

/** The seed is an unsigned 32-bit integer, the width of the engines' own generator state. */
export const MAX_BOARDS_SEED = 4_294_967_295;

/** The schema of the payload `exportData` writes; a new shape is a new number, never a quiet reinterpretation. */
export const BOARDS_ARCHIVE_VERSION = 1;

/**
 * Thrown when a board-game write is refused at the store boundary: a game outside
 * the closed six, a seat list of the wrong length or with an unknown kind, a level
 * that does not belong to the seats that were sent, a state the engine will not
 * read, an event log that is not shaped like one, or — the pair that matters most
 * — a position and a log that do not describe the same game.
 *
 * The store revalidates because stage 2's IPC layer hands it untrusted renderer
 * input (SEC-EL-02), and it validates the WHOLE value before a row is written
 * because a half-applied archive is worse than a refused one.
 */
export class BoardsValidationError extends DatabaseError {}

/** Thrown when a board-game operation names a slot this profile does not have. */
export class BoardsNotFoundError extends DatabaseError {}

/** One game in progress, as the store returns it. The state and the log are JSON, never objects. */
export interface BoardSave {
  profileId: string;
  game: BoardsGame;
  /** The engine's canonical JSON — the position the board is drawn from. */
  state: unknown;
  /** The move log, most recent last — what the move list is drawn from. */
  events: BoardEvent[];
  seed: number;
  level: number | null;
  seats: BoardSeatKind[];
  /** How many of the events are MOVES (a roll, a pass and a double are not moves). */
  moves: number;
  startedAt: string;
  updatedAt: string;
}

export interface BoardSaveInput {
  game: BoardsGame;
  state: unknown;
  events: readonly unknown[];
  seed: number;
  level: number | null;
  seats: readonly unknown[];
}

/**
 * How a game was brought to an end, in the archive's vocabulary — which is the
 * caller's claim about the MATCH, not about the position.
 *
 * `position` is the ordinary case and the one the store does not take on trust:
 * the engines' own `result(state)` says who won, and a game that is still in
 * progress is refused. The other three are the endings only the page can judge —
 * a resign, a doubling cube the opponent refused (which is a win for the doubler
 * without moving a checker), and a game somebody simply stopped playing.
 */
export type BoardEnding = "position" | "resigned" | "cube-declined" | "abandoned";

export interface BoardFinishInput {
  game: BoardsGame;
  state: unknown;
  events: readonly unknown[];
  seed: number;
  level: number | null;
  seats: readonly unknown[];
  ending: BoardEnding;
}

/** The player's record at one level of one game. `played` is always `won + drawn + lost`. */
export interface BoardStats {
  game: BoardsGame;
  /** `""` for a game without variants; `english`/`russian` for draughts. */
  variant: string;
  level: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  /** When this level's counter last moved, or null when nothing has been played at it. */
  updatedAt: string | null;
}

/** The module's one stored preference. */
export interface BoardsSettings {
  /** The level a new game against the computer opens on. */
  defaultLevel: number;
}

/** One game in an exported archive. The row's own timestamps travel: a restore is not a re-stamp. */
export interface BoardArchiveSave {
  game: BoardsGame;
  state: unknown;
  events: BoardEvent[];
  seed: number;
  level: number | null;
  seats: BoardSeatKind[];
  moves: number;
  startedAt: string;
  updatedAt: string;
}

export interface BoardArchiveStats {
  game: BoardsGame;
  variant: string;
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
export interface BoardsArchive {
  version: number;
  saves: BoardArchiveSave[];
  stats: BoardArchiveStats[];
  settings: BoardsSettings | null;
}

/** How a finished match counted for the person at this machine, or null when it counted for nobody. */
export type BoardRecordedOutcome = "won" | "lost" | "drawn" | null;

interface SaveRow {
  profile_id: string;
  game: string;
  state: string;
  events: string;
  seed: number;
  level: number | null;
  seats: string;
  moves: number;
  started_at: string;
  updated_at: string;
}

interface StatsRow {
  game: string;
  variant: string;
  level: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  updated_at: string;
}

/**
 * The board games for one profile: the game in progress for each game, the record
 * against each level, and the module's one preference — over prepared,
 * parameterized statements (SEC-API-03). Construct one per profile and reuse it.
 *
 * **The rules come from `@nexus/core`, never from here.** What a legal move is,
 * what a position means, who has won and what the dice show are the six engines'
 * own answers; this store has no opinion about draughts beyond what it is willing
 * to remember. Its one piece of arithmetic is the replay in `resolveGame`, and
 * even that is `replayBoard` — it exists here to REFUSE, not to decide.
 *
 * **A save is a pair that must agree.** The row carries the position the board
 * draws AND the log the move list draws, and the two are checked against each
 * other on the way in: folding the log through the engines must produce exactly
 * the position that was sent. A row where they disagree is a board showing one
 * game and a move list describing another, which is the one mistake a shape check
 * cannot see (`chess_resume`'s own reason for replaying its FEN).
 */
export class BoardsStore {
  private readonly upsertSave: Database.Statement;
  private readonly selectSaves: Database.Statement;
  private readonly selectSave: Database.Statement;
  private readonly deleteSave: Database.Statement;
  private readonly deleteAllSaves: Database.Statement;
  private readonly selectStats: Database.Statement;
  private readonly bumpStats: Database.Statement;
  private readonly insertStats: Database.Statement;
  private readonly deleteStats: Database.Statement;
  private readonly selectSettings: Database.Statement;
  private readonly upsertSettings: Database.Statement;
  private readonly deleteSettings: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    // The slot is keyed by (profile, game), so saving twice REPLACES the game in
    // progress — there is no second one to keep, and an upsert is what says so.
    // `started_at` is deliberately NOT updated: it is when this game began, and a
    // later save moves nothing but `updated_at`.
    this.upsertSave = db.prepare(
      `INSERT INTO boards_saves
         (profile_id, game, state, events, seed, level, seats, moves, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (profile_id, game) DO UPDATE SET
         state = excluded.state,
         events = excluded.events,
         seed = excluded.seed,
         level = excluded.level,
         seats = excluded.seats,
         moves = excluded.moves,
         updated_at = excluded.updated_at`,
    );
    this.selectSaves = db.prepare(
      `SELECT profile_id, game, state, events, seed, level, seats, moves, started_at, updated_at
         FROM boards_saves WHERE profile_id = ? ORDER BY updated_at DESC, game`,
    );
    this.selectSave = db.prepare(
      `SELECT profile_id, game, state, events, seed, level, seats, moves, started_at, updated_at
         FROM boards_saves WHERE profile_id = ? AND game = ?`,
    );
    this.deleteSave = db.prepare("DELETE FROM boards_saves WHERE profile_id = ? AND game = ?");
    this.deleteAllSaves = db.prepare("DELETE FROM boards_saves WHERE profile_id = ?");
    this.selectStats = db.prepare(
      `SELECT game, variant, level, played, won, drawn, lost, updated_at
         FROM boards_stats WHERE profile_id = ?`,
    );
    // One statement moves the whole counter, so the four numbers cannot be
    // written a different number of times than they are read.
    this.bumpStats = db.prepare(
      `INSERT INTO boards_stats (profile_id, game, variant, level, played, won, drawn, lost, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT (profile_id, game, variant, level) DO UPDATE SET
         played = played + 1,
         won = won + excluded.won,
         drawn = drawn + excluded.drawn,
         lost = lost + excluded.lost,
         updated_at = excluded.updated_at`,
    );
    this.insertStats = db.prepare(
      `INSERT INTO boards_stats (profile_id, game, variant, level, played, won, drawn, lost, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.deleteStats = db.prepare("DELETE FROM boards_stats WHERE profile_id = ?");
    this.selectSettings = db.prepare(
      "SELECT default_level FROM boards_settings WHERE profile_id = ?",
    );
    this.upsertSettings = db.prepare(
      `INSERT INTO boards_settings (profile_id, default_level, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET default_level = excluded.default_level,
                                              updated_at = excluded.updated_at`,
    );
    this.deleteSettings = db.prepare("DELETE FROM boards_settings WHERE profile_id = ?");
  }

  /** This profile's games in progress, most recently played first. */
  listSaves(): BoardSave[] {
    const rows = this.selectSaves.all(this.profileId) as SaveRow[];
    return rows.map((row) => this.toSave(row));
  }

  /** One game in progress, or null — what the page resumes with. */
  getSave(game: BoardsGame): BoardSave | null {
    const row = this.selectSave.get(this.profileId, game) as SaveRow | undefined;
    return row === undefined ? null : this.toSave(row);
  }

  /**
   * Writes the game in progress for its game id, replacing whatever was there, and
   * returns the stored row.
   *
   * Everything is validated before a row is touched, and the two halves that must
   * agree are checked against each other (see the class comment). The stored state
   * is the engine's CANONICAL JSON rather than the caller's bytes, so two equal
   * positions are one value and the comparison above means what it says.
   */
  save(input: BoardSaveInput, now: string): BoardSave {
    const resolved = resolveGame(input);
    const stamp = validateNow(now);
    const startedAt =
      (this.selectSave.get(this.profileId, resolved.game) as SaveRow | undefined)?.started_at ??
      stamp;
    this.upsertSave.run(
      this.profileId,
      resolved.game,
      JSON.stringify(resolved.state),
      JSON.stringify(resolved.events),
      resolved.seed,
      resolved.level,
      JSON.stringify(resolved.seats),
      resolved.moves,
      startedAt,
      stamp,
    );
    return { profileId: this.profileId, ...resolved, startedAt, updatedAt: stamp };
  }

  /** Empties one game's slot. Clearing what is not there is not an error. */
  remove(game: BoardsGame): void {
    this.deleteSave.run(this.profileId, readGame(game));
  }

  /**
   * Ends a game: the slot goes, and a match against the computer at a level moves
   * the record for that game, variant and level.
   *
   * Only a finished game against the ENGINE enters the record: a game against
   * another person has no level to be counted under, an abandoned game is not a
   * result, and a game at a seat count above two is not one person against one
   * engine. The variant is DERIVED from the position (draughts' own rule set),
   * never sent by the caller, and the winner of a `position` ending is the
   * engine's own answer rather than the renderer's claim about it.
   *
   * The delete and the increment are one transaction: two statements that could
   * land one without the other are a record that disagrees with the game that
   * produced it.
   */
  finish(input: BoardFinishInput, now: string): BoardRecordedOutcome {
    const resolved = resolveGame(input);
    const ending = readEnding(input.ending);
    const stamp = validateNow(now);
    // The engines read a state that has passed back through `fromJSON` and not
    // the stored JSON: one of the six writes a shape its own rules derive more
    // from (`protocol.ts`'s note), and a result read off the stored bytes would
    // be a result about half a position. The replay here is a second one — the
    // first, in `resolveGame`, is what refuses a log that does not add up — and it
    // is a fold over at most `MAX_BOARDS_EVENTS` events of pure functions.
    const live = normalizeBoardState(resolved.game, resolved.state);
    const result = this.outcomeFor(live, resolved, ending);

    this.db.transaction(() => {
      this.deleteSave.run(this.profileId, resolved.game);
      if (result === null) return;
      this.bumpStats.run(
        this.profileId,
        resolved.game,
        boardEngine(resolved.game).variant(live),
        resolved.level,
        result === "won" ? 1 : 0,
        result === "drawn" ? 1 : 0,
        result === "lost" ? 1 : 0,
        stamp,
      );
    })();
    return result;
  }

  /**
   * The record, zero-filled over every game and level — a ladder with holes would
   * make every caller fill them, and the zero is the honest value for a level
   * nobody has played. Ordered the way the module's own list is, so the page reads
   * it as one table and does not have to sort it.
   */
  listStats(): BoardStats[] {
    const rows = this.statsRows();
    const byKey = new Map(rows.map((row) => [statsKey(row.game, row.variant, row.level), row]));
    const stats: BoardStats[] = [];
    for (const game of BOARDS_GAMES) {
      // The variants a game can be recorded under: none for the five, and the two
      // printed rule sets for draughts. A level nobody has played still has a row,
      // which is why this list is stated here rather than read off the table.
      const variants = game === "draughts" ? ["english", "russian"] : [""];
      for (const variant of variants) {
        for (let level = 1; level <= boardEngine(game).levels; level += 1) {
          const row = byKey.get(statsKey(game, variant, level));
          stats.push({
            game,
            variant,
            level,
            played: row?.played ?? 0,
            won: row?.won ?? 0,
            drawn: row?.drawn ?? 0,
            lost: row?.lost ?? 0,
            updatedAt: row?.updated_at ?? null,
          });
        }
      }
    }
    return stats;
  }

  /** The module's preference, or the shipped default when this profile has no row. */
  settings(): BoardsSettings {
    const row = this.selectSettings.get(this.profileId) as { default_level: number } | undefined;
    return { defaultLevel: row?.default_level ?? 2 };
  }

  setDefaultLevel(level: number, now: string): BoardsSettings {
    const stamp = validateNow(now);
    this.upsertSettings.run(this.profileId, readDefaultLevel(level), stamp);
    return this.settings();
  }

  /**
   * The profile's board games as a versioned plain JSON value: the games in
   * progress, the record, and the preference. Nothing here is a database handle,
   * a buffer or a date object — what comes out can go through `JSON.stringify`
   * unchanged, which is what the profile archive does with it.
   */
  exportData(): BoardsArchive {
    return {
      version: BOARDS_ARCHIVE_VERSION,
      saves: this.listSaves().map((save) => ({
        game: save.game,
        state: save.state,
        events: save.events,
        seed: save.seed,
        level: save.level,
        seats: save.seats,
        moves: save.moves,
        startedAt: save.startedAt,
        updatedAt: save.updatedAt,
      })),
      stats: this.statsRows().map((row) => ({
        game: row.game as BoardsGame,
        variant: row.variant,
        level: row.level,
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        updatedAt: row.updated_at,
      })),
      settings: this.hasSettings() ? this.settings() : null,
    };
  }

  /**
   * Replaces this profile's board games with an archive — the whole value
   * validated before anything is written, so a refusal leaves the profile exactly
   * as it was. Replace rather than merge is the archive's own semantics, and it is
   * what makes an import idempotent.
   */
  importData(value: unknown): void {
    const archive = readBoardsArchive(value);
    this.db.transaction(() => {
      this.deleteAllSaves.run(this.profileId);
      this.deleteStats.run(this.profileId);
      this.deleteSettings.run(this.profileId);
      for (const save of archive.saves) {
        this.upsertSave.run(
          this.profileId,
          save.game,
          JSON.stringify(save.state),
          JSON.stringify(save.events),
          save.seed,
          save.level,
          JSON.stringify(save.seats),
          save.moves,
          save.startedAt,
          save.updatedAt,
        );
      }
      for (const stats of archive.stats) {
        this.insertStats.run(
          this.profileId,
          stats.game,
          stats.variant,
          stats.level,
          stats.played,
          stats.won,
          stats.drawn,
          stats.lost,
          stats.updatedAt,
        );
      }
      if (archive.settings !== null) {
        this.upsertSettings.run(
          this.profileId,
          archive.settings.defaultLevel,
          archive.saves[0]?.updatedAt ?? archive.stats[0]?.updatedAt ?? EPOCH,
        );
      }
    })();
  }

  // --- Internals ------------------------------------------------------------

  private hasSettings(): boolean {
    return this.selectSettings.get(this.profileId) !== undefined;
  }

  /**
   * How one ending counts for the person at this machine, or `null` when it counts
   * for nobody.
   *
   * The record is that person's own: one seat is human and the other is the
   * engine, and there is a level to count under. Everything else — two people
   * sharing the machine, three or four seats at ludo, a game with no level — is a
   * game the module plays and does not keep score of.
   */
  private outcomeFor(
    live: unknown,
    saved: ResolvedGame,
    ending: BoardEnding,
  ): BoardRecordedOutcome {
    if (ending === "abandoned" || saved.level === null) return null;
    if (saved.seats.length !== 2) return null;
    const human = saved.seats.indexOf("human");
    if (human < 0 || saved.seats.indexOf("computer") < 0) return null;
    if (ending === "resigned") return "lost";
    if (ending === "cube-declined") {
      // The doubler takes the stake as it stood, and the doubler is the side that
      // was to move when the offer was made — which `applyDouble` leaves in place,
      // so this reads the same whether the offer came from the person or from the
      // engine.
      return turnSeat(live) === human ? "won" : "lost";
    }
    const outcome = boardEngine(saved.game).outcome(live);
    if (outcome.status === "in_progress") {
      throw new BoardsValidationError(
        `"${saved.game}" is not over, so there is no result to record. Resign it, or save it.`,
      );
    }
    if (outcome.status === "draw") return "drawn";
    return outcome.winner === human ? "won" : "lost";
  }

  private statsRows(): StatsRow[] {
    return this.selectStats.all(this.profileId) as StatsRow[];
  }

  private toSave(row: SaveRow): BoardSave {
    return {
      profileId: row.profile_id,
      game: readGame(row.game),
      state: parseJson(row.state, `the position of the "${row.game}" game in progress`),
      events: readEvents(
        parseJson(row.events, `the move log of the "${row.game}" game in progress`),
      ),
      seed: row.seed,
      level: row.level,
      seats: readSeats(
        parseJson(row.seats, `the seats of the "${row.game}" game in progress`),
        row.game,
      ),
      moves: row.moves,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
    };
  }
}

/** The instant an archive carrying no timestamps at all is stamped with — see `importData`. */
const EPOCH = "1970-01-01T00:00:00.000Z";

/** One validated save, without the fields the row rather than the caller decides. */
type ResolvedGame = Omit<BoardSave, "profileId" | "startedAt" | "updatedAt">;

function statsKey(game: string, variant: string, level: number): string {
  return `${game}|${variant}|${level}`;
}

/**
 * Validates and resolves one save — the ONE place every refusal on the live path
 * lives, and the one the archive reader calls too, so a game from a file is held
 * to exactly what a game from the wire is held to.
 */
function resolveGame(input: BoardSaveInput): ResolvedGame {
  const game = readGame(input.game);
  const seats = readSeats(input.seats, game);
  const level = readLevel(input.level, seats, game);
  const seed = readSeed(input.seed);
  const events = readEvents(input.events);
  const state = readState(input.state, game);
  assertReplay(game, seed, events, state);
  return {
    game,
    state,
    events,
    seed,
    level,
    seats,
    moves: events.filter((event) => event.kind === "move").length,
  };
}

/**
 * Folds a game's log through the engines and insists that it arrives where the
 * caller says it did.
 *
 * A state the engine will not read, an event it will not apply, a roll it did not
 * make and a log that simply ends somewhere else are four different refusals and
 * one sentence, because from here they are one fact: this row could not be trusted
 * to describe one game. The engine's own error rides along as the cause, so a
 * developer reading a log can see which of the four it was.
 */
function assertReplay(
  game: BoardsGame,
  seed: number,
  events: readonly BoardEvent[],
  state: unknown,
): void {
  let replayed: unknown;
  try {
    replayed = replayBoard(game, seed, events, state);
  } catch (error) {
    throw new BoardsValidationError(
      `The move log of this "${game}" game is not a game the rules allow.`,
      { cause: error },
    );
  }
  const engine = boardEngine(game);
  if (JSON.stringify(engine.json(replayed)) !== JSON.stringify(state)) {
    throw new BoardsValidationError(
      `The position of this "${game}" game is not the position its move log produces.`,
    );
  }
}

function readGame(value: unknown): BoardsGame {
  if (!isBoardsGame(value)) {
    throw new BoardsValidationError(`"${String(value)}" is not one of this module's games.`);
  }
  return value;
}

/** The seats, checked against what the game is played with: two for five of them, two to four for ludo. */
function readSeats(value: unknown, game: string): BoardSeatKind[] {
  if (!Array.isArray(value)) {
    throw new BoardsValidationError('"seats" must be an array of "human" and "computer".');
  }
  const seats: BoardSeatKind[] = [];
  for (const entry of value) {
    if (!isBoardSeatKind(entry)) {
      throw new BoardsValidationError('A seat must be "human" or "computer".');
    }
    seats.push(entry);
  }
  const allowed = isBoardsGame(game) ? boardEngine(game).seats : [];
  if (!allowed.includes(seats.length)) {
    throw new BoardsValidationError(
      `"${game}" is played with ${allowed.join(" or ")} seats, not ${seats.length}.`,
    );
  }
  return seats;
}

/**
 * The level, and the pair rule the schema cannot state: a game with a computer in
 * it names the level it is played at, and a game against people names none.
 */
function readLevel(value: unknown, seats: readonly BoardSeatKind[], game: string): number | null {
  const levels = isBoardsGame(game) ? boardEngine(game).levels : 0;
  const hasComputer = seats.includes("computer");
  if (value === null || value === undefined) {
    if (hasComputer) {
      throw new BoardsValidationError(
        `A game against the computer must name a level (1..${levels}).`,
      );
    }
    return null;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > levels) {
    throw new BoardsValidationError(`"level" must be a whole number from 1 to ${levels}.`);
  }
  if (!hasComputer) {
    throw new BoardsValidationError("A game against another person has no level to play at.");
  }
  return value;
}

/** The level a new game opens at — the module's preference, which is always in range. */
function readDefaultLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 3) {
    throw new BoardsValidationError('"defaultLevel" must be a whole number from 1 to 3.');
  }
  return value;
}

function readSeed(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_BOARDS_SEED
  ) {
    throw new BoardsValidationError(`"seed" must be a whole number from 0 to ${MAX_BOARDS_SEED}.`);
  }
  return value;
}

/** A position the engine will read, in its own canonical shape. */
function readState(value: unknown, game: BoardsGame): unknown {
  let state: unknown;
  try {
    state = boardEngine(game).json(value);
  } catch (error) {
    throw new BoardsValidationError(`This "${game}" position is not one the rules allow.`, {
      cause: error,
    });
  }
  if (JSON.stringify(state).length > MAX_BOARDS_STATE_CHARS) {
    throw new BoardsValidationError(
      `A "${game}" position may hold at most ${MAX_BOARDS_STATE_CHARS} characters.`,
    );
  }
  return state;
}

/**
 * The move log, checked for SHAPE here and for legality by the engines' own
 * `applyMove` when it is folded back (see `assertReplay`).
 *
 * Only the shape belongs at this line: `kind` is a closed set, a roll's dice are
 * one to four faces of a die, and a move carries a value for the engine to judge.
 * Everything a shape cannot see — that this placement was legal, that these dice
 * are the dice — is answered by the replay, which is the point of replaying.
 */
function readEvents(value: unknown): BoardEvent[] {
  if (!Array.isArray(value)) throw new BoardsValidationError('"events" must be an array.');
  if (value.length > MAX_BOARDS_EVENTS) {
    throw new BoardsValidationError(`A game may hold at most ${MAX_BOARDS_EVENTS} events.`);
  }
  const events: BoardEvent[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new BoardsValidationError("Every event must be an object.");
    }
    const record = entry as Record<string, unknown>;
    const kind = record["kind"];
    if (kind === "move") {
      const move = record["move"];
      if (typeof move !== "object" || move === null || Array.isArray(move)) {
        throw new BoardsValidationError("A move event must carry the move itself.");
      }
      events.push({ kind: "move", move });
      continue;
    }
    if (kind === "roll") {
      const dice = record["dice"];
      if (!Array.isArray(dice) || dice.length === 0 || dice.length > 4) {
        throw new BoardsValidationError("A roll carries one to four dice.");
      }
      for (const die of dice) {
        if (typeof die !== "number" || !Number.isInteger(die) || die < 1 || die > 6) {
          throw new BoardsValidationError("Every die shows a whole number from 1 to 6.");
        }
      }
      events.push({ kind: "roll", dice: dice as number[] });
      continue;
    }
    if (kind === "pass" || kind === "double") {
      events.push({ kind });
      continue;
    }
    throw new BoardsValidationError(
      `An event is one of move, roll, pass, double — not "${String(kind)}".`,
    );
  }
  if (JSON.stringify(events).length > MAX_BOARDS_EVENTS_CHARS) {
    throw new BoardsValidationError(
      `A move log may hold at most ${MAX_BOARDS_EVENTS_CHARS} characters.`,
    );
  }
  return events;
}

function readEnding(value: unknown): BoardEnding {
  if (
    value === "position" ||
    value === "resigned" ||
    value === "cube-declined" ||
    value === "abandoned"
  ) {
    return value;
  }
  throw new BoardsValidationError(`"${String(value)}" is not a way a game ends.`);
}

/**
 * Reads a JSON column back. This store writes only its own `JSON.stringify`
 * output, so anything that fails to parse is corruption — a hand-edited file, a
 * bad restore — rather than input to coerce, and a silent empty value would throw
 * somebody's game away (`HabitStore.parseStoredSchedule`'s posture).
 */
function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BoardsValidationError(`The database holds ${what} that is not valid JSON.`);
  }
}

function validateNow(value: string): string {
  if (typeof value !== "string" || !isDateTime(value)) {
    throw new BoardsValidationError(`"${String(value)}" is not an instant.`);
  }
  return value;
}

/**
 * The archive reader. Every field is checked against the same validators the live
 * path uses — a game is no more trustworthy for having arrived in a file — and the
 * whole value is read before the writer runs.
 *
 * Exported because the module's own `main/imex.ts` uses it as the pure half of the
 * kit's import pair: `parse` must read the whole payload and write nothing, and
 * the way to make that true rather than promised is for the parser and the writer
 * to be this one reader and `importData`. Sync is not the only caller of a value
 * that came off a file.
 */
export function readBoardsArchive(value: unknown): BoardsArchive {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BoardsValidationError('"archive" must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record["version"] !== BOARDS_ARCHIVE_VERSION) {
    throw new BoardsValidationError(
      `Unsupported board games archive version ${String(record["version"])}; this build reads version ${BOARDS_ARCHIVE_VERSION}.`,
    );
  }
  const savesValue = record["saves"];
  const statsValue = record["stats"];
  if (!Array.isArray(savesValue) || !Array.isArray(statsValue)) {
    throw new BoardsValidationError('An archive carries "saves" and "stats" arrays.');
  }
  const saves = savesValue.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new BoardsValidationError(`saves[${index}] must be an object.`);
    }
    const save = entry as Record<string, unknown>;
    const resolved = resolveGame({
      game: save["game"] as BoardsGame,
      state: save["state"],
      events: Array.isArray(save["events"]) ? (save["events"] as unknown[]) : [],
      seed: save["seed"] as number,
      level: save["level"] as number | null,
      seats: Array.isArray(save["seats"]) ? (save["seats"] as unknown[]) : [],
    });
    return {
      ...resolved,
      startedAt: readInstant(save["startedAt"], `saves[${index}].startedAt`),
      updatedAt: readInstant(save["updatedAt"], `saves[${index}].updatedAt`),
    };
  });
  const games = new Set(saves.map((save) => save.game));
  if (games.size !== saves.length) {
    throw new BoardsValidationError("An archive carries two games in progress for one game.");
  }

  const stats = statsValue.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new BoardsValidationError(`stats[${index}] must be an object.`);
    }
    const row = entry as Record<string, unknown>;
    const game = readGame(row["game"]);
    const variant = row["variant"];
    if (variant !== "" && variant !== "english" && variant !== "russian") {
      throw new BoardsValidationError(`stats[${index}].variant is not one this module writes.`);
    }
    const levels = boardEngine(game).levels;
    const level = row["level"];
    if (typeof level !== "number" || !Number.isSafeInteger(level) || level < 1 || level > levels) {
      throw new BoardsValidationError(
        `stats[${index}].level must be a whole number from 1 to ${levels}.`,
      );
    }
    const played = readCount(row["played"], `stats[${index}].played`);
    const won = readCount(row["won"], `stats[${index}].won`);
    const drawn = readCount(row["drawn"], `stats[${index}].drawn`);
    const lost = readCount(row["lost"], `stats[${index}].lost`);
    if (played !== won + drawn + lost) {
      throw new BoardsValidationError(
        `stats[${index}]: "played" must equal "won" + "drawn" + "lost".`,
      );
    }
    return {
      game,
      variant,
      level,
      played,
      won,
      drawn,
      lost,
      updatedAt: readInstant(row["updatedAt"], `stats[${index}].updatedAt`),
    };
  });
  const keys = new Set(stats.map((row) => statsKey(row.game, row.variant, row.level)));
  if (keys.size !== stats.length) {
    throw new BoardsValidationError("An archive carries two records for one game and level.");
  }

  const settingsValue = record["settings"];
  const settings =
    settingsValue === null || settingsValue === undefined
      ? null
      : {
          defaultLevel: readDefaultLevel(
            (settingsValue as Record<string, unknown>)["defaultLevel"],
          ),
        };
  return { version: BOARDS_ARCHIVE_VERSION, saves, stats, settings };
}

function readInstant(value: unknown, field: string): string {
  if (typeof value !== "string" || !isDateTime(value)) {
    throw new BoardsValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}

/** A counter in the record: a whole number that cannot be negative. */
function readCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new BoardsValidationError(`"${field}" must be a whole number that is not negative.`);
  }
  return value;
}
