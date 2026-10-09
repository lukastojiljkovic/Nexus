import type Database from "better-sqlite3-multiple-ciphers";
import { DatabaseError, isUniqueConstraintViolation } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

/** A preset's name is a label on a button, not a sentence. */
export const MAX_TIMER_NAME_LENGTH = 60;
/**
 * The longest countdown this module will hold: 24 hours.
 *
 * A timer that runs for a week is a calendar entry, and the app already has one
 * of those. The bound is not decoration: a countdown is stored by its end, main
 * arms a timer for that instant, and an arbitrary number typed into a field
 * would otherwise decide how long a `setTimeout` chain lives.
 */
export const MAX_TIMER_DURATION_SECONDS = 86_400;

/**
 * Thrown when a timers write is refused at the store boundary: a blank or
 * over-long name or label, a duration outside 1..`MAX_TIMER_DURATION_SECONDS`,
 * a second preset with a name this profile already carries, or an instant that
 * is not a real ISO-8601 one.
 */
export class TimersValidationError extends DatabaseError {}

/** Thrown when an operation names an id that is not a row of THIS profile. */
export class TimersNotFoundError extends DatabaseError {}

/** A saved countdown: a name and a duration, started with one click. */
export interface TimersPreset {
  id: string;
  profileId: string;
  name: string;
  durationSeconds: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * A countdown that is running, or one that is paused with time still owed.
 *
 * **Exactly one of `endsAt` and `remainingSeconds` is set, and the schema says
 * so.** A running countdown holds the INSTANT it ends (so it keeps running while
 * the window is closed, survives a reload, and needs no tick to be counted
 * down); a paused one holds the whole seconds it still owes. Two nullable
 * columns with a CHECK rather than one column that means "instant while
 * running, duration while paused" — the store would then have to know which, and
 * every reader of a stored row would have to guess with it.
 */
export interface TimersCountdown {
  id: string;
  profileId: string;
  label: string;
  /** What the user asked for, kept so a resume after a pause still says what the timer IS. */
  durationSeconds: number;
  /** The instant it ends, or null while paused. */
  endsAt: string | null;
  /** Whole seconds still owed, or null while running. */
  remainingSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

/** The module's one stored preference. */
export interface TimersSettings {
  /** Whether a finished countdown's OS notification carries the system sound. */
  soundOnEnd: boolean;
}

/**
 * Serbian Latin ordering for the preset list, on `HabitStore`'s terms: plain
 * `"sr"` mis-tailors š/č/ć/ž, and SQLite's BINARY collation would put
 * „Šetnja" after „Kafa".
 */
const TIMERS_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

interface PresetRow {
  id: string;
  profile_id: string;
  name: string;
  duration_seconds: number;
  created_at: string;
  updated_at: string;
}

interface CountdownRow {
  id: string;
  profile_id: string;
  label: string;
  duration_seconds: number;
  ends_at: string | null;
  remaining_seconds: number | null;
  created_at: string;
  updated_at: string;
}

function presetFromRow(row: PresetRow): TimersPreset {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    durationSeconds: row.duration_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function countdownFromRow(row: CountdownRow): TimersCountdown {
  return {
    id: row.id,
    profileId: row.profile_id,
    label: row.label,
    durationSeconds: row.duration_seconds,
    endsAt: row.ends_at,
    remainingSeconds: row.remaining_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * TIMERS' storage (migration 071): the saved presets, the countdowns that are
 * still running, and the module's one preference.
 *
 * **Why the arithmetic lives here rather than in the module's own code.** A
 * countdown's whole state is two instants and a duration, and every one of them
 * is a column: pausing is "how many whole seconds were owed at the instant you
 * paused", extending is "move the end, or the remainder". Keeping that in one
 * place means the renderer never computes a value it then asks main to store,
 * and main never trusts a number the renderer computed (SEC-EL-02). Every method
 * takes `now` explicitly, so a test can move the clock instead of waiting.
 *
 * Whole seconds, never fractions: `Math.ceil` on a pause rounds UP, because
 * rounding down would hand back less time than the user still had (see the
 * test that pins 90.5 seconds in, 450 seconds owed).
 */
export class TimersStore {
  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {}

  // --- Presets --------------------------------------------------------------

  listPresets(): TimersPreset[] {
    const rows = this.db
      .prepare(
        `SELECT id, profile_id, name, duration_seconds, created_at, updated_at
           FROM timers_presets
          WHERE profile_id = ?`,
      )
      .all(this.profileId) as PresetRow[];
    return rows
      .map(presetFromRow)
      .sort((left, right) => TIMERS_COLLATOR.compare(left.name, right.name));
  }

  createPreset(
    input: { name: string; durationSeconds: number },
    now: string,
  ): TimersPreset {
    const name = this.validName(input.name);
    const durationSeconds = this.validDuration(input.durationSeconds);
    const stamp = this.validInstant(now);
    const id = uuidv7();
    try {
      this.db
        .prepare(
          `INSERT INTO timers_presets
             (id, profile_id, name, duration_seconds, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, this.profileId, name, durationSeconds, stamp, stamp);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new TimersValidationError(`A preset named "${name}" already exists.`);
      }
      throw error;
    }
    return this.requirePreset(id);
  }

  renamePreset(id: string, changes: { name: string }, now: string): TimersPreset {
    const name = this.validName(changes.name);
    const stamp = this.validInstant(now);
    try {
      const result = this.db
        .prepare(
          `UPDATE timers_presets
              SET name = ?, updated_at = ?
            WHERE id = ? AND profile_id = ?`,
        )
        .run(name, stamp, id, this.profileId);
      if (result.changes === 0) throw new TimersNotFoundError(`No preset "${id}".`);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new TimersValidationError(`A preset named "${name}" already exists.`);
      }
      throw error;
    }
    return this.requirePreset(id);
  }

  removePreset(id: string): void {
    const result = this.db
      .prepare("DELETE FROM timers_presets WHERE id = ? AND profile_id = ?")
      .run(id, this.profileId);
    if (result.changes === 0) throw new TimersNotFoundError(`No preset "${id}".`);
  }

  /**
   * Replaces this profile's presets and its preference with one archive payload
   * (ADR-090 §imex).
   *
   * **Why this is a store method and not three calls from the module.** What a
   * restore puts back has to be exactly what the archive carried, and it has to
   * happen WHOLE: three calls from the module could fail between the delete and
   * the last insert, leaving a profile holding a fragment of somebody's preset
   * list. One statement's worth of work wrapped in one transaction is the
   * smallest thing that can keep that promise, and it is the store that owns the
   * schema the promise is made in.
   *
   * The rows are re-minted rather than restored by id: a preset's id is this
   * database's own key and no other profile holds it, so the archive carries what
   * the user typed - a name and a duration - and the keys are made here. Rows
   * arrive already validated and normalised by the module's own importer, and
   * every bound is checked again below anyway, because a transaction that is
   * going to roll back is a better answer than a row that violates a CHECK.
   *
   * The countdowns are deliberately NOT touched: they are live clocks, the
   * archive carries none (`main/imex.ts` says why), and a restore that replaced a
   * profile's content says nothing about a timer that is still running.
   */
  replaceFromArchive(
    input: {
      readonly presets: readonly { name: string; durationSeconds: number }[];
      readonly soundOnEnd: boolean;
    },
    now: string,
  ): void {
    const stamp = this.validInstant(now);
    const rows = input.presets.map((preset) => ({
      id: uuidv7(),
      name: this.validName(preset.name),
      durationSeconds: this.validDuration(preset.durationSeconds),
    }));
    const names = new Set(rows.map((row) => row.name));
    if (names.size !== rows.length) {
      throw new TimersValidationError("Two presets in one archive share a name.");
    }
    this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM timers_presets WHERE profile_id = ?")
        .run(this.profileId);
      const insert = this.db.prepare(
        `INSERT INTO timers_presets
           (id, profile_id, name, duration_seconds, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const row of rows) {
        insert.run(row.id, this.profileId, row.name, row.durationSeconds, stamp, stamp);
      }
      this.setSoundOnEnd(input.soundOnEnd, stamp);
    })();
  }

  // --- Countdowns -----------------------------------------------------------

  listCountdowns(): TimersCountdown[] {
    const rows = this.db
      .prepare(
        `SELECT id, profile_id, label, duration_seconds, ends_at, remaining_seconds,
                created_at, updated_at
           FROM timers_countdowns
          WHERE profile_id = ?`,
      )
      .all(this.profileId) as CountdownRow[];
    // Running ones first, by the instant they end; a paused one has no instant
    // and sorts after them, by the name the user gave it.
    return rows
      .map(countdownFromRow)
      .sort((left, right) => {
        if (left.endsAt !== null && right.endsAt !== null) {
          return left.endsAt === right.endsAt
            ? TIMERS_COLLATOR.compare(left.label, right.label)
            : left.endsAt < right.endsAt
              ? -1
              : 1;
        }
        if (left.endsAt !== null) return -1;
        if (right.endsAt !== null) return 1;
        return TIMERS_COLLATOR.compare(left.label, right.label);
      });
  }

  /** Starts a countdown: the end is the only thing stored, computed once, here. */
  createCountdown(
    input: { label: string; durationSeconds: number },
    now: string,
  ): TimersCountdown {
    const label = this.validLabel(input.label);
    const durationSeconds = this.validDuration(input.durationSeconds);
    const startedAt = this.validInstant(now);
    const id = uuidv7();
    this.db
      .prepare(
        `INSERT INTO timers_countdowns
           (id, profile_id, label, duration_seconds, ends_at, remaining_seconds,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        this.profileId,
        label,
        durationSeconds,
        this.shift(startedAt, durationSeconds),
        startedAt,
        startedAt,
      );
    return this.requireCountdown(id);
  }

  /**
   * Freezes a running countdown: the seconds it still owes are computed from its
   * end and the instant it was paused, and rounded UP (see the class comment).
   */
  pauseCountdown(id: string, now: string): TimersCountdown {
    const countdown = this.requireCountdown(id);
    const pausedAt = this.validInstant(now);
    if (countdown.endsAt === null) {
      throw new TimersValidationError(`Countdown "${id}" is already paused.`);
    }
    const remaining = Math.ceil(
      (Date.parse(countdown.endsAt) - Date.parse(pausedAt)) / 1000,
    );
    if (remaining <= 0) {
      throw new TimersValidationError(`Countdown "${id}" has already ended.`);
    }
    this.db
      .prepare(
        `UPDATE timers_countdowns
            SET ends_at = NULL, remaining_seconds = ?, updated_at = ?
          WHERE id = ? AND profile_id = ?`,
      )
      .run(remaining, pausedAt, id, this.profileId);
    return this.requireCountdown(id);
  }

  /** Starts a paused countdown again, from the whole seconds it still owed. */
  resumeCountdown(id: string, now: string): TimersCountdown {
    const countdown = this.requireCountdown(id);
    const resumedAt = this.validInstant(now);
    if (countdown.remainingSeconds === null) {
      throw new TimersValidationError(`Countdown "${id}" is already running.`);
    }
    this.db
      .prepare(
        `UPDATE timers_countdowns
            SET ends_at = ?, remaining_seconds = NULL, updated_at = ?
          WHERE id = ? AND profile_id = ?`,
      )
      .run(this.shift(resumedAt, countdown.remainingSeconds), resumedAt, id, this.profileId);
    return this.requireCountdown(id);
  }

  /**
   * The „+1 min" button: a RUNNING countdown has its end moved, a PAUSED one has
   * the time it owes grown. One method rather than two ops, because the user
   * pressed one button.
   */
  extendCountdown(id: string, seconds: number, now: string): TimersCountdown {
    const countdown = this.requireCountdown(id);
    const extra = this.validDuration(seconds);
    const stampedAt = this.validInstant(now);
    if (countdown.endsAt !== null) {
      const endsAt = new Date(Date.parse(countdown.endsAt) + extra * 1000).toISOString();
      this.db
        .prepare(
          "UPDATE timers_countdowns SET ends_at = ?, updated_at = ? WHERE id = ? AND profile_id = ?",
        )
        .run(endsAt, stampedAt, id, this.profileId);
      return this.requireCountdown(id);
    }
    const remaining = (countdown.remainingSeconds ?? 0) + extra;
    if (remaining > MAX_TIMER_DURATION_SECONDS) {
      throw new TimersValidationError("A countdown may not run for more than 24 hours.");
    }
    this.db
      .prepare(
        `UPDATE timers_countdowns
            SET remaining_seconds = ?, updated_at = ?
          WHERE id = ? AND profile_id = ?`,
      )
      .run(remaining, stampedAt, id, this.profileId);
    return this.requireCountdown(id);
  }

  /**
   * Removes a countdown. Used for both „prekini" and for one that has ENDED:
   * a finished countdown has nothing left to be, and its record is the OS toast
   * it produced.
   */
  cancelCountdown(id: string): void {
    const result = this.db
      .prepare("DELETE FROM timers_countdowns WHERE id = ? AND profile_id = ?")
      .run(id, this.profileId);
    if (result.changes === 0) throw new TimersNotFoundError(`No countdown "${id}".`);
  }

  /** Whether the countdown is one this profile can act on - `null` for the module's own use. */
  countdown(id: string): TimersCountdown | null {
    const row = this.db
      .prepare(
        `SELECT id, profile_id, label, duration_seconds, ends_at, remaining_seconds,
                created_at, updated_at
           FROM timers_countdowns
          WHERE id = ? AND profile_id = ?`,
      )
      .get(id, this.profileId) as CountdownRow | undefined;
    return row === undefined ? null : countdownFromRow(row);
  }

  // --- Settings -------------------------------------------------------------

  settings(): TimersSettings {
    const row = this.db
      .prepare("SELECT sound_on_end FROM timers_settings WHERE profile_id = ?")
      .get(this.profileId) as { sound_on_end: number } | undefined;
    return { soundOnEnd: row === undefined ? true : row.sound_on_end === 1 };
  }

  setSoundOnEnd(soundOnEnd: boolean, now: string): TimersSettings {
    const stamp = this.validInstant(now);
    this.db
      .prepare(
        `INSERT INTO timers_settings (profile_id, sound_on_end, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (profile_id) DO UPDATE SET sound_on_end = excluded.sound_on_end,
                                                updated_at = excluded.updated_at`,
      )
      .run(this.profileId, soundOnEnd ? 1 : 0, stamp);
    return this.settings();
  }

  // --- Internals ------------------------------------------------------------

  private requirePreset(id: string): TimersPreset {
    const row = this.db
      .prepare(
        `SELECT id, profile_id, name, duration_seconds, created_at, updated_at
           FROM timers_presets
          WHERE id = ? AND profile_id = ?`,
      )
      .get(id, this.profileId) as PresetRow | undefined;
    if (row === undefined) throw new TimersNotFoundError(`No preset "${id}".`);
    return presetFromRow(row);
  }

  private requireCountdown(id: string): TimersCountdown {
    const countdown = this.countdown(id);
    if (countdown === null) throw new TimersNotFoundError(`No countdown "${id}".`);
    return countdown;
  }

  /** An ISO instant, as every timestamp in this database is written. */
  private validInstant(value: string): string {
    if (!isDateTime(value)) {
      throw new TimersValidationError(`"${value}" is not an instant.`);
    }
    return value;
  }

  private shift(from: string, seconds: number): string {
    return new Date(Date.parse(from) + seconds * 1000).toISOString();
  }

  private validName(raw: string): string {
    const name = raw.trim();
    if (name.length === 0 || name.length > MAX_TIMER_NAME_LENGTH) {
      throw new TimersValidationError(
        `A name must be 1..${MAX_TIMER_NAME_LENGTH} characters.`,
      );
    }
    return name;
  }

  private validLabel(raw: string): string {
    return this.validName(raw);
  }

  private validDuration(seconds: number): number {
    if (
      !Number.isInteger(seconds) ||
      seconds < 1 ||
      seconds > MAX_TIMER_DURATION_SECONDS
    ) {
      throw new TimersValidationError(
        `A duration must be a whole number of seconds in 1..${MAX_TIMER_DURATION_SECONDS}.`,
      );
    }
    return seconds;
  }
}
