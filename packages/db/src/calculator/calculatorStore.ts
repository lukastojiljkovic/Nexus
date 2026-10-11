import type Database from "better-sqlite3-multiple-ciphers";
import {
  CALCULATOR_ANGLE_MODES,
  CALCULATOR_PRECISIONS,
  MAX_CALCULATOR_VALUE_LENGTH,
  MAX_EXPRESSION_LENGTH,
  emptyCalculatorSession,
  parseCalculatorSession,
  serializeCalculatorSession,
} from "@nexus/core";
import type { CalculatorAngleMode, CalculatorPrecision, CalculatorSession } from "@nexus/core";
import { CalcHistoryNotFoundError, CalculatorValidationError } from "../errors.js";
import { isDateTime } from "../finance/money.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/**
 * How long one entry's RESULT text may be.
 *
 * The result is the display string the engine produced, and the engine's own
 * bounds are what set the ceiling: a matrix at the element bound renders to tens
 * of kilobytes, an ordinary number to a dozen characters, and four kilobytes is
 * comfortably past every result a person reads while still refusing a paste of
 * something else entirely.
 */
export const MAX_CALC_HISTORY_RESULT_LENGTH = 4096;

/**
 * How many UNPINNED entries a profile keeps.
 *
 * Two hundred is a long afternoon of calculating: far more than a list anybody
 * scrolls, few enough that the table stays a list rather than a log. The cap is
 * enforced on every write that adds a row, in the same transaction, never by a
 * sweep — a history over its cap between two writes is a state no crash may
 * leave behind (the `SearchHistoryStore` arrangement). PINNED entries are not
 * counted and never evicted: that is the whole difference the flag makes.
 */
export const CALC_HISTORY_UNPINNED_LIMIT = 200;

/**
 * The most entries one `listHistory` read will hand back.
 *
 * The table can hold more than the cap (pinned rows are unbounded by it), and
 * the caller is main's IPC layer, which passes an untrusted number straight
 * through: a bound is cheaper than discovering the absence of one.
 */
export const MAX_CALC_HISTORY_READ = 1000;

/**
 * The most entries an imported archive may carry.
 *
 * Ten thousand is fifty times what the store itself would ever keep, so a file
 * this large cannot have come from a calculator's history; it is refused before
 * anything is written rather than validated row by row and then thrown away.
 */
export const MAX_CALC_HISTORY_IMPORT_ENTRIES = 10_000;

/** The version `exportData` writes and `importData` is willing to read. An unknown version is refused whole. */
export const CALCULATOR_EXPORT_VERSION = 1;

/**
 * The module's two preferences (migration 079's `calc_settings`).
 *
 * Both are CLOSED sets the engine owns - `deg`/`rad`/`grad` and
 * `float`/`bignumber` - so this type is core's own unions rather than a third
 * spelling of them, and the migration's CHECKs state the same values in SQL.
 */
export interface CalculatorSettings {
  readonly angleMode: CalculatorAngleMode;
  readonly precision: CalculatorPrecision;
}

/**
 * What a profile that has never changed one of them answers, and it is the
 * ENGINE's own default in both cases (`engine.ts`: DEG, „because that is what a
 * school calculator opens on"; the float mode is what a calculator shows a price
 * in). A row's ABSENCE means this - never a written row that could drift from
 * the engine - which is the same rule `emptyCalculatorSession` follows for a
 * profile with no session.
 */
export const DEFAULT_CALCULATOR_SETTINGS: CalculatorSettings = {
  angleMode: "deg",
  precision: "float",
};

/** One line of the history: what was typed, what it showed, and what the user did with it. */
export interface CalcHistoryEntry {
  id: string;
  profileId: string;
  /** The expression exactly as it was typed, outer whitespace aside. */
  expression: string;
  /** The display string the engine produced for it — the reader's form, which is not a text that can be re-parsed. */
  result: string;
  /**
   * The same result in mathjs's own lexical form, which is the form that can be
   * substituted into a new expression. Migration 079's header argues the pair:
   * `result` is read, `value` is re-parsed, and a page that had only the first
   * could not tell a Serbian decimal comma from a group separator.
   */
  value: string;
  /** Protected from the cap. An unpinned entry is evicted by age; a pinned one is only ever removed by name. */
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddCalcHistoryInput {
  expression: string;
  result: string;
  value: string;
}

/** One history row as an archive carries it. The id is deliberately not here — see `exportData`. */
export interface CalcHistoryExportEntry {
  expression: string;
  result: string;
  value: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The calculator's whole content for one profile, in the shape stage 2 puts in the profile archive. */
export interface CalculatorExport {
  version: typeof CALCULATOR_EXPORT_VERSION;
  /** Oldest first, which is the order it was lived in and the order a replay reads it in. */
  history: readonly CalcHistoryExportEntry[];
  session: CalculatorSession;
  /** The profile's two preferences, or the engine's defaults when it never set one. */
  settings: CalculatorSettings;
}

interface HistoryRow {
  id: string;
  profile_id: string;
  expression: string;
  result: string;
  value: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  session: string;
}

interface SettingsRow {
  angle_mode: string;
  number_mode: string;
}

const COLUMNS = "id, profile_id, expression, result, value, pinned, created_at, updated_at";

/**
 * The calculator's history, saved session and two preferences for one profile
 * (migration 079), over prepared, parameterized statements (SEC-API-03; every
 * value is bound, never interpolated). Constructed one per profile and reused,
 * like every other store here; every statement is scoped by `profile_id`.
 *
 * **Nothing here evaluates anything.** The engine lives in `@nexus/core` and
 * this store never sees a value it computed: an entry is a string the user
 * typed, and the result in BOTH forms — what the reader was shown and the
 * engine's own lexical text, which is what a `#3` reuse substitutes. The session
 * is core's own JSON, re-validated on the way in and on the way out
 * (`parseCalculatorSession`) — which is what keeps `@nexus/db` free of mathjs.
 *
 * **The history is a LOG, and a log line is deleted, not hidden.** There is no
 * `deleted_at` here, deliberately, and the rest of the codebase is the reason
 * rather than an exception to it: the tables that keep one (`note_folders`,
 * `habits`, `canvas_boards`, …) do so because they are DOCUMENTS somebody made
 * and can want back, while a history line is a record that this expression was
 * evaluated once. Nothing references the row, no archive replays a tombstone for
 * it, and a soft delete would make the cap count rows the user cannot see.
 * `SearchHistoryStore` made the same call for the same reason.
 *
 * **The session's column carries no CHECK.** Its shape is JSON, and SQL can
 * only bound the length of a document it cannot parse; the cap that matters is
 * per ENTRY and lives in core's validator (`MAX_CALCULATOR_VALUE_LENGTH` and
 * friends), which the store runs on the way in and on the way out. A second
 * bound written in SQL could only drift from it.
 *
 * **A session's `ans` is stored with the rest.** It is the previous result, in
 * the same lexical form a variable holds, because the next expression the user
 * types may well be `ans * 2` and a restored session that had forgotten it would
 * refuse an expression the user could see on their own screen a moment ago.
 */
export class CalculatorStore {
  private readonly selectRecent: Database.Statement;
  private readonly selectAll: Database.Statement;
  private readonly selectById: Database.Statement;
  private readonly insertHistory: Database.Statement;
  private readonly evictUnpinned: Database.Statement;
  private readonly updatePinned: Database.Statement;
  private readonly deleteEntry: Database.Statement;
  private readonly deleteAll: Database.Statement;
  private readonly deleteUnpinned: Database.Statement;
  private readonly selectSession: Database.Statement;
  private readonly upsertSession: Database.Statement;
  private readonly deleteSession: Database.Statement;
  private readonly selectSettings: Database.Statement;
  private readonly upsertSettings: Database.Statement;
  private readonly deleteSettings: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.selectRecent = db.prepare(
      `SELECT ${COLUMNS} FROM calc_history
        WHERE profile_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
    );
    // The archive's order: oldest first, so a reader can replay it and a diff
    // between two exports reads as the history the user actually lived.
    this.selectAll = db.prepare(
      `SELECT ${COLUMNS} FROM calc_history
        WHERE profile_id = ?
        ORDER BY created_at ASC, id ASC`,
    );
    this.selectById = db.prepare(
      `SELECT ${COLUMNS} FROM calc_history WHERE id = ? AND profile_id = ?`,
    );
    this.insertHistory = db.prepare(
      `INSERT INTO calc_history
         (id, profile_id, expression, result, value, pinned, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // "Keep the newest N unpinned of THIS profile" — the subquery repeats the
    // profile scope, so a busy profile can never evict another's rows.
    this.evictUnpinned = db.prepare(
      `DELETE FROM calc_history
        WHERE profile_id = ? AND pinned = 0
          AND id NOT IN (
            SELECT id FROM calc_history
             WHERE profile_id = ? AND pinned = 0
             ORDER BY created_at DESC, id DESC
             LIMIT ?
          )`,
    );
    this.updatePinned = db.prepare(
      `UPDATE calc_history SET pinned = ?, updated_at = ?
        WHERE id = ? AND profile_id = ?`,
    );
    this.deleteEntry = db.prepare(`DELETE FROM calc_history WHERE id = ? AND profile_id = ?`);
    this.deleteAll = db.prepare(`DELETE FROM calc_history WHERE profile_id = ?`);
    this.deleteUnpinned = db.prepare(
      `DELETE FROM calc_history WHERE profile_id = ? AND pinned = 0`,
    );
    this.selectSession = db.prepare(`SELECT session FROM calc_sessions WHERE profile_id = ?`);
    this.upsertSession = db.prepare(
      `INSERT INTO calc_sessions (profile_id, session, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         session = excluded.session,
         updated_at = excluded.updated_at`,
    );
    this.deleteSession = db.prepare(`DELETE FROM calc_sessions WHERE profile_id = ?`);
    this.selectSettings = db.prepare(
      `SELECT angle_mode, number_mode FROM calc_settings WHERE profile_id = ?`,
    );
    this.upsertSettings = db.prepare(
      `INSERT INTO calc_settings (profile_id, angle_mode, number_mode, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (profile_id) DO UPDATE SET
         angle_mode = excluded.angle_mode,
         number_mode = excluded.number_mode,
         updated_at = excluded.updated_at`,
    );
    this.deleteSettings = db.prepare(`DELETE FROM calc_settings WHERE profile_id = ?`);
  }

  /**
   * This profile's history, newest first, capped at
   * {@link MAX_CALC_HISTORY_READ} rows. Pinned entries are mixed into the order
   * rather than hoisted: this is a log, and the flag protects a row from the cap
   * rather than deciding where it sits. A surface that wants the pinned ones
   * first has `pinned` on every row to sort by.
   */
  listHistory(options?: { limit?: number }): CalcHistoryEntry[] {
    const rows = this.selectRecent.all(this.profileId, validateLimit(options?.limit)) as HistoryRow[];
    return rows.map(toEntry);
  }

  /**
   * Records one evaluation and evicts the oldest unpinned row if the cap is now
   * passed, in ONE transaction — the `SearchHistoryStore.record` arrangement,
   * for its reason: a history over its cap is a state no crash may leave behind.
   */
  addEntry(input: AddCalcHistoryInput, now: string): CalcHistoryEntry {
    const expression = validateExpression(input.expression);
    const result = validateResult(input.result);
    const value = validateValue(input.value);
    const validNow = validateNow(now);
    const id = uuidv7();

    this.db.transaction((): void => {
      this.insertHistory.run(id, this.profileId, expression, result, value, 0, validNow, validNow);
      this.evictUnpinned.run(this.profileId, this.profileId, CALC_HISTORY_UNPINNED_LIMIT);
    })();

    return {
      id,
      profileId: this.profileId,
      expression,
      result,
      value,
      pinned: false,
      createdAt: validNow,
      updatedAt: validNow,
    };
  }

  /**
   * Pins or unpins one entry. An id this profile does not have is refused rather
   * than ignored: unlike a removal, this is a request that names a row the user
   * is looking at, and a silent no-op would leave the flag drawn wrong.
   */
  setPinned(id: string, pinned: boolean, now: string): CalcHistoryEntry {
    const validNow = validateNow(now);
    if (typeof pinned !== "boolean") {
      throw new CalculatorValidationError(`"pinned" must be a boolean.`);
    }
    const { changes } = this.updatePinned.run(pinned ? 1 : 0, validNow, id, this.profileId);
    if (changes === 0) {
      throw new CalcHistoryNotFoundError(`No history entry "${id}" in this profile.`);
    }
    const row = this.selectById.get(id, this.profileId) as HistoryRow | undefined;
    if (row === undefined) {
      throw new CalcHistoryNotFoundError(`No history entry "${id}" in this profile.`);
    }
    return toEntry(row);
  }

  /**
   * Forgets one entry. Removing something that is not there is DONE, not an
   * error — the surface that asks can be a keystroke stale, and a failure the
   * user has to read would be about our bookkeeping rather than about anything
   * they did (`SearchHistoryStore.remove`).
   */
  removeEntry(id: string): void {
    this.deleteEntry.run(id, this.profileId);
  }

  /**
   * Empties the history, optionally leaving the pinned rows, and returns how
   * many entries went — what a "Obriši istoriju" control reports.
   */
  clearHistory(options?: { keepPinned?: boolean }): number {
    const statement = options?.keepPinned === true ? this.deleteUnpinned : this.deleteAll;
    return statement.run(this.profileId).changes;
  }

  /**
   * This profile's saved session, or an empty one when it never saved any.
   *
   * A column that no longer parses THROWS rather than reading as empty: silently
   * discarding somebody's variables is the worse of the two failures, and the
   * tablet is the one place the difference is visible. `clearSession` is the way
   * out of it (`HabitStore`'s posture on a stored schedule it cannot read).
   */
  getSession(): CalculatorSession {
    const row = this.selectSession.get(this.profileId) as SessionRow | undefined;
    if (row === undefined) return emptyCalculatorSession();
    const session = parseCalculatorSession(parseJson(row.session));
    if (session === null) {
      throw new CalculatorValidationError(
        `The calculator session stored for this profile is not a session.`,
      );
    }
    return session;
  }

  /** Replaces the saved session with a validated copy of `session`. */
  saveSession(session: CalculatorSession, now: string): CalculatorSession {
    const valid = validateSession(session);
    const validNow = validateNow(now);
    this.upsertSession.run(this.profileId, serializeCalculatorSession(valid), validNow);
    return valid;
  }

  /** Forgets the session. The next `getSession` answers an empty one. */
  clearSession(): void {
    this.deleteSession.run(this.profileId);
  }

  /**
   * This profile's two preferences, or the engine's defaults when it never set
   * one. A row's absence IS the default rather than a third state - the
   * `getSession` arrangement one method up - so a profile that has never touched
   * the page answers exactly what `createCalculatorEngine` does with no argument.
   */
  settings(): CalculatorSettings {
    const row = this.selectSettings.get(this.profileId) as SettingsRow | undefined;
    if (row === undefined) return DEFAULT_CALCULATOR_SETTINGS;
    // A column holding something else is corruption rather than a preference:
    // the table's CHECKs make it unreachable, and answering the default silently
    // would hide a schema that had drifted from this file.
    return validateSettings({ angleMode: row.angle_mode, precision: row.number_mode });
  }

  /** Writes both preferences, validated, and answers what it wrote. */
  saveSettings(settings: CalculatorSettings, now: string): CalculatorSettings {
    const valid = validateSettings(settings);
    this.upsertSettings.run(this.profileId, valid.angleMode, valid.precision, validateNow(now));
    return valid;
  }

  /** Forgets the preferences, so the next `settings` answers the engine's defaults. */
  clearSettings(): void {
    this.deleteSettings.run(this.profileId);
  }

  /**
   * The profile's whole calculator content, as the versioned plain value stage 2
   * puts in the archive.
   *
   * **The ids are not in it.** A history id is this file's bookkeeping — nothing
   * references it, no archive replays it — and carrying a uuid into an archive
   * only to have to decide what to do with a collision would be inventing a
   * merge problem for a log line. What travels is the expression, the result,
   * the flag and the two timestamps, which is the whole of what a person made.
   */
  exportData(): CalculatorExport {
    const rows = this.selectAll.all(this.profileId) as HistoryRow[];
    return {
      version: CALCULATOR_EXPORT_VERSION,
      history: rows.map((row) => ({
        expression: row.expression,
        result: row.result,
        value: row.value,
        pinned: row.pinned === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      session: this.getSession(),
      settings: this.settings(),
    };
  }

  /**
   * Replaces the profile's calculator content with a value of unknown shape.
   *
   * **The whole value is validated before anything is written**, so a file with
   * one bad row leaves the profile exactly as it was; an unknown version is
   * refused whole for the reason every other archive reader here refuses one — a
   * later version may hold shapes this reader would silently drop. The cap is
   * applied after the insert (an archive written by a build that had a different
   * cap still restores to this one's invariant), and the session is written in
   * the same transaction as the history, because a profile restored halfway is a
   * profile nobody can explain.
   *
   * `now` is supplied by the caller, like every other write in this package:
   * main stamps the clock and the renderer never does. It is the SESSION row's
   * `updated_at` alone — the history's own timestamps come from the archive,
   * because they are when the user typed the expressions rather than when this
   * file was written. The settings row is written like any other, defaults
   * included: a restore states the profile's whole calculator state, so an
   * archive that carries no preference leaves the profile on the engine's
   * defaults rather than on whatever it happened to hold.
   */
  importData(value: unknown, now: string): void {
    const validNow = validateNow(now);
    const parsed = parseExport(value);

    this.db.transaction((): void => {
      this.deleteAll.run(this.profileId);
      this.deleteSession.run(this.profileId);
      this.deleteSettings.run(this.profileId);
      for (const entry of parsed.history) {
        this.insertHistory.run(
          uuidv7(),
          this.profileId,
          entry.expression,
          entry.result,
          entry.value,
          entry.pinned ? 1 : 0,
          entry.createdAt,
          entry.updatedAt,
        );
      }
      this.evictUnpinned.run(this.profileId, this.profileId, CALC_HISTORY_UNPINNED_LIMIT);
      this.upsertSession.run(this.profileId, serializeCalculatorSession(parsed.session), validNow);
      this.upsertSettings.run(
        this.profileId,
        parsed.settings.angleMode,
        parsed.settings.precision,
        validNow,
      );
    })();
  }
}

function toEntry(row: HistoryRow): CalcHistoryEntry {
  return {
    id: row.id,
    profileId: row.profile_id,
    expression: row.expression,
    result: row.result,
    value: row.value,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The whole export, validated — the ONE place an imported value is judged, so the refusals cannot drift from the writes. */
function parseExport(value: unknown): CalculatorExport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CalculatorValidationError("A calculator export must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (record["version"] !== CALCULATOR_EXPORT_VERSION) {
    throw new CalculatorValidationError(
      `A calculator export must be version ${CALCULATOR_EXPORT_VERSION}.`,
    );
  }
  const history = record["history"];
  if (!Array.isArray(history)) {
    throw new CalculatorValidationError(`A calculator export must carry a "history" array.`);
  }
  if (history.length > MAX_CALC_HISTORY_IMPORT_ENTRIES) {
    throw new CalculatorValidationError(
      `A calculator export may carry at most ${MAX_CALC_HISTORY_IMPORT_ENTRIES} history entries.`,
    );
  }
  return {
    version: CALCULATOR_EXPORT_VERSION,
    history: history.map(parseExportEntry),
    session: validateSession(record["session"]),
    settings: validateSettings(record["settings"]),
  };
}

function parseExportEntry(value: unknown): CalcHistoryExportEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CalculatorValidationError("Every history entry must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record["pinned"] !== "boolean") {
    throw new CalculatorValidationError(`A history entry's "pinned" must be a boolean.`);
  }
  return {
    expression: validateExpression(record["expression"]),
    result: validateResult(record["result"]),
    value: validateValue(record["value"]),
    pinned: record["pinned"],
    createdAt: validateTimestamp(record["createdAt"], "createdAt"),
    updatedAt: validateTimestamp(record["updatedAt"], "updatedAt"),
  };
}

/**
 * Core's own session validator, with this store's error type on top: the shape
 * is core's business (the engine produced it and the engine reads it), and the
 * refusal being a named error is this package's (SEC-EL-02's second boundary).
 */
function validateSession(value: unknown): CalculatorSession {
  const session = parseCalculatorSession(value);
  if (session === null) {
    throw new CalculatorValidationError(
      "A calculator session must be a version-1 object of text values and named functions.",
    );
  }
  return session;
}

/**
 * The two preferences, each narrowed to the set the ENGINE names.
 *
 * The unions are core's own (`CALCULATOR_ANGLE_MODES`, `CALCULATOR_PRECISIONS`),
 * which is what makes this the second statement of the same closed set rather
 * than a second closed set: the migration's CHECKs are the first, and SQL cannot
 * read a TypeScript union.
 */
function validateSettings(value: unknown): CalculatorSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CalculatorValidationError("Calculator settings must be an object.");
  }
  const record = value as Record<string, unknown>;
  const angleMode = record["angleMode"];
  const precision = record["precision"];
  if (!isAngleMode(angleMode)) {
    throw new CalculatorValidationError(
      `"angleMode" must be one of ${CALCULATOR_ANGLE_MODES.join(", ")}.`,
    );
  }
  if (!isPrecision(precision)) {
    throw new CalculatorValidationError(
      `"precision" must be one of ${CALCULATOR_PRECISIONS.join(", ")}.`,
    );
  }
  return { angleMode, precision };
}

function isAngleMode(value: unknown): value is CalculatorAngleMode {
  return typeof value === "string" && (CALCULATOR_ANGLE_MODES as readonly string[]).includes(value);
}

function isPrecision(value: unknown): value is CalculatorPrecision {
  return typeof value === "string" && (CALCULATOR_PRECISIONS as readonly string[]).includes(value);
}

function validateExpression(value: unknown): string {
  if (typeof value !== "string") {
    throw new CalculatorValidationError(`"expression" must be a string.`);
  }
  const text = value.trim();
  if (text.length === 0) {
    throw new CalculatorValidationError(
      "A history entry must carry an expression; empty and whitespace-only expressions are never recorded.",
    );
  }
  if (text.length > MAX_EXPRESSION_LENGTH) {
    throw new CalculatorValidationError(
      `"expression" must be at most ${MAX_EXPRESSION_LENGTH} characters.`,
    );
  }
  return text;
}

function validateResult(value: unknown): string {
  if (typeof value !== "string") {
    throw new CalculatorValidationError(`"result" must be a string.`);
  }
  const text = value.trim();
  if (text.length === 0) {
    throw new CalculatorValidationError("A history entry must carry the result that was shown.");
  }
  if (text.length > MAX_CALC_HISTORY_RESULT_LENGTH) {
    throw new CalculatorValidationError(
      `"result" must be at most ${MAX_CALC_HISTORY_RESULT_LENGTH} characters.`,
    );
  }
  return text;
}

/**
 * The result in the engine's own lexical form, held to the engine's own bound.
 *
 * `MAX_CALCULATOR_VALUE_LENGTH` is core's (`session.ts`), not a number of this
 * package's: a history value and a session value are the same kind of text, and
 * the engine refuses to hold one it produced that exceeded that bound
 * (`renderValue`). A store with a narrower cap would therefore reject its own
 * output, and one with a wider cap would hold a text the engine will not read
 * back.
 */
function validateValue(value: unknown): string {
  if (typeof value !== "string") {
    throw new CalculatorValidationError(`"value" must be a string.`);
  }
  const text = value.trim();
  if (text.length === 0) {
    throw new CalculatorValidationError("A history entry must carry the value it computed.");
  }
  if (text.length > MAX_CALCULATOR_VALUE_LENGTH) {
    throw new CalculatorValidationError(
      `"value" must be at most ${MAX_CALCULATOR_VALUE_LENGTH} characters.`,
    );
  }
  return text;
}

function validateTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !isDateTime(value)) {
    throw new CalculatorValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}

function validateNow(value: unknown): string {
  return validateTimestamp(value, "now");
}

function validateLimit(limit: number | undefined): number {
  const value = limit ?? MAX_CALC_HISTORY_READ;
  if (!Number.isInteger(value) || value <= 0) {
    throw new CalculatorValidationError(`limit must be a positive integer, got ${value}.`);
  }
  return Math.min(value, MAX_CALC_HISTORY_READ);
}

/** `JSON.parse` that answers `undefined` instead of throwing — the caller is the one that names the corruption. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
