import type Database from "better-sqlite3-multiple-ciphers";
import {
  MAX_ID_LENGTH,
  SCOREBOARD_MAX_NAME_LENGTH,
  SCOREBOARD_MAX_PLAYERS,
  SCOREBOARD_MAX_ROUNDS,
  SCOREBOARD_MAX_SCORE,
  TALLY_MAX_COUNTERS,
  TALLY_MAX_NAME_LENGTH,
  TALLY_MAX_STEP,
  TYPING_LAYOUTS,
  TYPING_LESSONS,
  type ScoreboardBoard,
  type ScoreboardPlayer,
  type ScoreboardRound,
  type TallyCounter,
  type TypingLayoutId,
} from "@nexus/core";
import { DatabaseError } from "../errors.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

/**
 * MINI-APPS' storage (migration 85): one profile, one kept document.
 *
 * **What "kept" means here, and why it is a document.** The module is a grid of
 * nine small tools, and only six of them have anything to remember: the tally
 * counters, the scoreboard's board, the typing tutor's progress, the world
 * clock's cities, the dice history, and which tile was open last. Each of those
 * is authored by the user, read whole, and touched by nothing else in the
 * database - so they travel together as one versioned JSON value, on
 * `pantryStore`'s and `emergencyCardStore`'s precedent. The migration's own
 * comment records why no table per app is worth having.
 *
 * **The two things this store will not let a document do.** It validates every
 * field on the way IN (a page can send anything) and on the way OUT (a document
 * could have been written by a hand-edited database or an older build), through
 * the SAME `parseMiniappsData`, so there is one statement of what a document is
 * and the two directions cannot disagree. And it bounds what may be STORED:
 * the engines' own limits (`TALLY_MAX_*`, `SCOREBOARD_MAX_*`) plus the module's
 * own for the parts no engine owns, so a document cannot grow without bound.
 *
 * **What the store does NOT decide.** Which tile ids are legal is the WIRE's
 * vocabulary (`shared/ipc.ts`'s `MINIAPPS_APP_IDS`), and a lesson id is resolved
 * by the page against the engine's lesson list. Storing a well-formed id this
 * build does not know is therefore not an error here - it reads back as "no app
 * open" or "the first lesson", which is exactly what a fresh profile shows, and
 * it is what keeps a lesson list that changes between versions from bricking a
 * profile. Everything the store CAN check, it does: names, ranges, duplicate
 * ids, a round that names a player who is not on the board, and the JSON itself.
 *
 * **The stacks are not stored.** `tallyReduce` and `scoreboardReduce` keep undo
 * history in `past`/`future`, which is the page's session rather than the user's
 * data; a restore that carried it would restore the ability to undo something
 * that happened in another life. Only the present state travels.
 */

/** The schema of the kept document. A new shape is a new number, never a quiet reinterpretation. */
export const MINIAPPS_EXPORT_VERSION = 1;

/** The longest document this store will write, in JSON characters - the migration's CHECK, restated where it is enforced. */
export const MAX_MINIAPPS_JSON_CHARS = 524_288;

/** The most cities the world clock keeps. Twelve is a wall of clocks, not a page. */
export const MINIAPPS_MAX_CITIES = 12;

/** The most dice and pick results kept. A history is a glance backwards, not a log. */
export const MINIAPPS_MAX_HISTORY = 50;

/** The most typing results kept: one per lesson per layout, and a few to spare. */
export const MINIAPPS_MAX_TYPING_RECORDS = 60;

/** A city name as the world clock stores it: an IANA zone id, bounded like an id. */
export const MINIAPPS_MAX_ZONE_LENGTH = 64;

/**
 * Thrown when a document is not one this module will hold: a version it does not
 * know, a field of the wrong shape, a bound the engines state, a duplicate id, or
 * a stored payload that is not JSON at all.
 */
export class MiniappsValidationError extends DatabaseError {}

/** One result the dice tool remembers: what was asked, what came out, and when. */
export interface MiniappsDiceEntry {
  /** Epoch milliseconds, as the page's clock read it. */
  atMs: number;
  /** What the user asked for, already written out by the page ("2d6+3", a coin, a list). */
  label: string;
  /** The answer, already formatted ("11", "tails", "3 / 7 / 9"). */
  result: string;
}

/** One finished typing run. `accuracy` is a fraction in 0..1, `netWpm` whole words a minute. */
export interface MiniappsTypingRecord {
  layout: TypingLayoutId;
  lessonId: string;
  netWpm: number;
  accuracy: number;
  atMs: number;
}

/** The typing tutor's progress: the layout and lesson last drilled, and the best runs kept. */
export interface MiniappsTypingProgress {
  layout: TypingLayoutId;
  lessonId: string;
  records: MiniappsTypingRecord[];
}

/** Everything the module keeps, as one value - what the page renders and what the archive carries. */
export interface MiniappsData {
  version: number;
  /** The tile that was open last, or `null` for the grid. The legal ids are the wire's. */
  lastApp: string | null;
  counters: TallyCounter[];
  scoreboard: ScoreboardBoard;
  typing: MiniappsTypingProgress;
  cities: string[];
  diceHistory: MiniappsDiceEntry[];
}

interface StateRow {
  payload: string;
}

/** The engine's layout ids at runtime, without a second hand-written list. */
const TYPING_LAYOUT_IDS = Object.keys(TYPING_LAYOUTS) as TypingLayoutId[];

/** The first lesson of the Serbian layout - the lesson a fresh profile opens on. */
function defaultLessonId(): string {
  const first = TYPING_LESSONS["sr-Latn"][0] ?? TYPING_LESSONS["en-US"][0];
  // The tables are static data with at least one lesson each; the fallback keeps
  // the return type honest rather than asserting one exists.
  return first?.id ?? "";
}

/** The document a profile with nothing kept answers: no counters, no board, nothing picked. */
export function emptyMiniappsData(): MiniappsData {
  return {
    version: MINIAPPS_EXPORT_VERSION,
    lastApp: null,
    counters: [],
    scoreboard: { players: [], rounds: [], target: null },
    typing: { layout: "sr-Latn", lessonId: defaultLessonId(), records: [] },
    cities: [],
    diceHistory: [],
  };
}

// --- Reading one value off the wire or off a disk, the same way -----------------

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MiniappsValidationError(`Mini-apps data: "${field}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new MiniappsValidationError(`Mini-apps data: "${field}" must be an array.`);
  }
  return value;
}

function asId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new MiniappsValidationError(`Mini-apps data: "${field}" must be a non-empty id.`);
  }
  if (value.length > MAX_ID_LENGTH) {
    throw new MiniappsValidationError(`Mini-apps data: "${field}" is too long to be an id.`);
  }
  return value;
}

function asName(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new MiniappsValidationError(`Mini-apps data: "${field}" must be a string.`);
  }
  const name = value.trim();
  if (name.length === 0 || name.length > max) {
    throw new MiniappsValidationError(
      `Mini-apps data: "${field}" must be 1..${max} characters.`,
    );
  }
  return name;
}

function asWholeNumber(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new MiniappsValidationError(
      `Mini-apps data: "${field}" must be a whole number between ${min} and ${max}.`,
    );
  }
  return value;
}

function asMetric(value: unknown, field: string, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    throw new MiniappsValidationError(
      `Mini-apps data: "${field}" must be a number between 0 and ${max}.`,
    );
  }
  return value;
}

function parseCounters(value: unknown): TallyCounter[] {
  const raw = asArray(value, "counters");
  if (raw.length > TALLY_MAX_COUNTERS) {
    throw new MiniappsValidationError(
      `Mini-apps data: at most ${TALLY_MAX_COUNTERS} counters may be kept.`,
    );
  }
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    const counter = asRecord(entry, `counters[${index}]`);
    const id = asId(counter.id, `counters[${index}].id`);
    if (seen.has(id)) {
      throw new MiniappsValidationError(`Mini-apps data: two counters share the id "${id}".`);
    }
    seen.add(id);
    if (typeof counter.floorZero !== "boolean") {
      throw new MiniappsValidationError(
        `Mini-apps data: "counters[${index}].floorZero" must be a boolean.`,
      );
    }
    return {
      id,
      name: asName(counter.name, `counters[${index}].name`, TALLY_MAX_NAME_LENGTH),
      value: asWholeNumber(
        counter.value,
        `counters[${index}].value`,
        Number.MIN_SAFE_INTEGER,
        Number.MAX_SAFE_INTEGER,
      ),
      step: asWholeNumber(counter.step, `counters[${index}].step`, 1, TALLY_MAX_STEP),
      floorZero: counter.floorZero,
    };
  });
}

function parseBoard(value: unknown): ScoreboardBoard {
  const board = asRecord(value, "scoreboard");
  const rawPlayers = asArray(board.players, "scoreboard.players");
  if (rawPlayers.length > SCOREBOARD_MAX_PLAYERS) {
    throw new MiniappsValidationError(
      `Mini-apps data: at most ${SCOREBOARD_MAX_PLAYERS} players may be on one board.`,
    );
  }
  const playerIds = new Set<string>();
  const players: ScoreboardPlayer[] = rawPlayers.map((entry, index) => {
    const player = asRecord(entry, `scoreboard.players[${index}]`);
    const id = asId(player.id, `scoreboard.players[${index}].id`);
    if (playerIds.has(id)) {
      throw new MiniappsValidationError(`Mini-apps data: two players share the id "${id}".`);
    }
    playerIds.add(id);
    return {
      id,
      name: asName(player.name, `scoreboard.players[${index}].name`, SCOREBOARD_MAX_NAME_LENGTH),
    };
  });

  const rawRounds = asArray(board.rounds, "scoreboard.rounds");
  if (rawRounds.length > SCOREBOARD_MAX_ROUNDS) {
    throw new MiniappsValidationError(
      `Mini-apps data: a board holds ${SCOREBOARD_MAX_ROUNDS} rounds at most.`,
    );
  }
  const rounds: ScoreboardRound[] = rawRounds.map((entry, index) => {
    const scores = asRecord(
      asRecord(entry, `scoreboard.rounds[${index}]`).scores,
      `scoreboard.rounds[${index}].scores`,
    );
    const kept: Record<string, number> = {};
    for (const [playerId, score] of Object.entries(scores)) {
      // The engine's own invariant, restated where a stored document is read:
      // every player of the board is present in every round, and nobody else is.
      if (!playerIds.has(playerId)) {
        throw new MiniappsValidationError(
          `Mini-apps data: a round names the unknown player "${playerId}".`,
        );
      }
      kept[playerId] = asWholeNumber(
        score,
        `scoreboard.rounds[${index}].scores.${playerId}`,
        -SCOREBOARD_MAX_SCORE,
        SCOREBOARD_MAX_SCORE,
      );
    }
    for (const playerId of playerIds) {
      if (!Object.hasOwn(kept, playerId)) {
        throw new MiniappsValidationError(
          `Mini-apps data: a round is missing a score for "${playerId}".`,
        );
      }
    }
    return { scores: kept };
  });

  const target =
    board.target === null
      ? null
      : asWholeNumber(board.target, "scoreboard.target", 1, Number.MAX_SAFE_INTEGER);
  return { players, rounds, target };
}

function parseTyping(value: unknown): MiniappsTypingProgress {
  const typing = asRecord(value, "typing");
  const layout = typing.layout;
  if (typeof layout !== "string" || !TYPING_LAYOUT_IDS.includes(layout as TypingLayoutId)) {
    throw new MiniappsValidationError(
      `Mini-apps data: "typing.layout" must be one of ${TYPING_LAYOUT_IDS.join(", ")}.`,
    );
  }
  const rawRecords = asArray(typing.records, "typing.records");
  if (rawRecords.length > MINIAPPS_MAX_TYPING_RECORDS) {
    throw new MiniappsValidationError(
      `Mini-apps data: at most ${MINIAPPS_MAX_TYPING_RECORDS} typing results may be kept.`,
    );
  }
  const records = rawRecords.map((entry, index) => {
    const record = asRecord(entry, `typing.records[${index}]`);
    const recordLayout = record.layout;
    if (
      typeof recordLayout !== "string" ||
      !TYPING_LAYOUT_IDS.includes(recordLayout as TypingLayoutId)
    ) {
      throw new MiniappsValidationError(
        `Mini-apps data: "typing.records[${index}].layout" must be one of ${TYPING_LAYOUT_IDS.join(", ")}.`,
      );
    }
    return {
      layout: recordLayout as TypingLayoutId,
      lessonId: asId(record.lessonId, `typing.records[${index}].lessonId`),
      netWpm: asMetric(record.netWpm, `typing.records[${index}].netWpm`, 1000),
      accuracy: asMetric(record.accuracy, `typing.records[${index}].accuracy`, 1),
      atMs: asWholeNumber(record.atMs, `typing.records[${index}].atMs`, 0, Number.MAX_SAFE_INTEGER),
    } satisfies MiniappsTypingRecord;
  });
  return {
    layout: layout as TypingLayoutId,
    lessonId: asId(typing.lessonId, "typing.lessonId"),
    records,
  };
}

function parseCities(value: unknown): string[] {
  const raw = asArray(value, "cities");
  if (raw.length > MINIAPPS_MAX_CITIES) {
    throw new MiniappsValidationError(
      `Mini-apps data: at most ${MINIAPPS_MAX_CITIES} cities may be kept.`,
    );
  }
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    const zone = entry;
    if (
      typeof zone !== "string" ||
      zone.length === 0 ||
      zone.length > MINIAPPS_MAX_ZONE_LENGTH ||
      /\s/.test(zone)
    ) {
      throw new MiniappsValidationError(
        `Mini-apps data: "cities[${index}]" must be a time zone id.`,
      );
    }
    if (seen.has(zone)) {
      throw new MiniappsValidationError(`Mini-apps data: "${zone}" is listed twice.`);
    }
    seen.add(zone);
    return zone;
  });
}

function parseHistory(value: unknown): MiniappsDiceEntry[] {
  const raw = asArray(value, "diceHistory");
  if (raw.length > MINIAPPS_MAX_HISTORY) {
    throw new MiniappsValidationError(
      `Mini-apps data: at most ${MINIAPPS_MAX_HISTORY} results may be kept.`,
    );
  }
  return raw.map((entry, index) => {
    const item = asRecord(entry, `diceHistory[${index}]`);
    return {
      atMs: asWholeNumber(item.atMs, `diceHistory[${index}].atMs`, 0, Number.MAX_SAFE_INTEGER),
      label: asName(item.label, `diceHistory[${index}].label`, 120),
      result: asName(item.result, `diceHistory[${index}].result`, 200),
    };
  });
}

/**
 * Reads one kept document, completely, or throws.
 *
 * Total and pure: no database, no clock, and nothing written. That is what lets
 * the archive's own reader call it at the preview (where a refusal must cost
 * nothing) and the store call it again at the write, so the two can never
 * disagree about what a document is.
 */
export function parseMiniappsData(value: unknown): MiniappsData {
  const record = asRecord(value, "payload");
  if (record.version !== MINIAPPS_EXPORT_VERSION) {
    throw new MiniappsValidationError(
      `Mini-apps data was written by another version of this module (found ${String(
        record.version,
      )}, expected ${MINIAPPS_EXPORT_VERSION}).`,
    );
  }
  let lastApp: string | null = null;
  if (record.lastApp !== null) {
    const raw = record.lastApp;
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 32) {
      throw new MiniappsValidationError(
        'Mini-apps data: "lastApp" must be null or a short tile id.',
      );
    }
    lastApp = raw;
  }
  return {
    version: MINIAPPS_EXPORT_VERSION,
    lastApp,
    counters: parseCounters(record.counters),
    scoreboard: parseBoard(record.scoreboard),
    typing: parseTyping(record.typing),
    cities: parseCities(record.cities),
    diceHistory: parseHistory(record.diceHistory),
  };
}

/** MINI-APPS' one table, as the module's main half reaches it. */
export class MiniappsStore {
  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {}

  /**
   * The kept document, validated. A profile with no row answers the empty
   * document rather than an error: "nothing kept yet" is a fresh profile's
   * state, not a failure.
   */
  read(): MiniappsData {
    const row = this.db
      .prepare("SELECT payload FROM miniapps_state WHERE profile_id = ?")
      .get(this.profileId) as StateRow | undefined;
    if (row === undefined) return emptyMiniappsData();
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload);
    } catch (error) {
      throw new MiniappsValidationError(
        `The mini-apps document for this profile is not valid JSON.`,
        { cause: error },
      );
    }
    return parseMiniappsData(parsed);
  }

  /** Validates a document and stores it whole. Every write goes through here. */
  write(data: unknown, now: string): MiniappsData {
    const stamp = this.validInstant(now);
    const document = parseMiniappsData(data);
    const payload = JSON.stringify(document);
    if (payload.length > MAX_MINIAPPS_JSON_CHARS) {
      throw new MiniappsValidationError(
        `The mini-apps document may not exceed ${MAX_MINIAPPS_JSON_CHARS} characters.`,
      );
    }
    this.db
      .prepare(
        `INSERT INTO miniapps_state (profile_id, payload, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (profile_id) DO UPDATE SET payload = excluded.payload,
                                                updated_at = excluded.updated_at`,
      )
      .run(this.profileId, payload, stamp);
    return document;
  }

  /** Remembers which tile is open, leaving everything else exactly as it was. */
  setLastApp(app: string | null, now: string): MiniappsData {
    return this.write({ ...this.read(), lastApp: app }, now);
  }

  /** Replaces the counters, keeping every other tool's state. */
  saveCounters(counters: unknown, now: string): MiniappsData {
    return this.write({ ...this.read(), counters }, now);
  }

  /** Replaces the scoreboard's board, keeping every other tool's state. */
  saveScoreboard(board: unknown, now: string): MiniappsData {
    return this.write({ ...this.read(), scoreboard: board }, now);
  }

  /** Replaces the typing tutor's progress, keeping every other tool's state. */
  saveTyping(typing: unknown, now: string): MiniappsData {
    return this.write({ ...this.read(), typing }, now);
  }

  /** Replaces the picked cities, keeping every other tool's state. */
  saveCities(cities: unknown, now: string): MiniappsData {
    return this.write({ ...this.read(), cities }, now);
  }

  /** Replaces the dice history, keeping every other tool's state. */
  saveDiceHistory(history: unknown, now: string): MiniappsData {
    return this.write({ ...this.read(), diceHistory: history }, now);
  }

  /**
   * Replaces the whole document from an archive section (ADR-090 section 6).
   *
   * `undefined` is an archive that says nothing about this module, and for a
   * restore that replaces a profile whole that means EMPTY: the row is deleted,
   * so the profile answers the empty document and nothing is left of what was
   * there. Written as a delete rather than as a write of the empty document, on
   * `TimersStore.replaceFromArchive`'s terms: "no row" is the one place the
   * empty state is written down.
   */
  replaceFromArchive(data: unknown, now: string): void {
    if (data === undefined) {
      this.db.prepare("DELETE FROM miniapps_state WHERE profile_id = ?").run(this.profileId);
      return;
    }
    this.write(data, now);
  }

  /** The instant a write is stamped with, validated like every other timestamp in this database. */
  private validInstant(value: string): string {
    if (!isDateTime(value)) {
      throw new MiniappsValidationError(`"${value}" is not an instant.`);
    }
    return value;
  }
}
