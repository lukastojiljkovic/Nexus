import type Database from "better-sqlite3-multiple-ciphers";
import { MAX_SENSOR_COLUMNS, sensorColumnName } from "@nexus/core";
import { DatabaseError, isUniqueConstraintViolation } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { isDateTime } from "../finance/money.js";

type DatabaseHandle = Database.Database;

/** A log's name is a label on a row, not a sentence. */
export const MAX_LAB_LOG_NAME_LENGTH = 60;

/**
 * How many logs one profile may keep.
 *
 * A bound on a list the user creates rather than a limit anybody meets: each log
 * carries up to `MAX_LAB_SAMPLES` readings, and the profile archive carries them
 * all, so this is the number that decides how large a restored profile can be.
 */
export const MAX_LAB_LOGS = 24;

/**
 * How many readings one log keeps.
 *
 * A LIVE log is a rolling window: a 115 200-baud stream can print thousands of
 * lines a minute, and a module that appended them forever would be a database
 * that only grows. So an append inserts its rows and then deletes the oldest
 * ones beyond this bound, inside the same transaction — the newest readings are
 * the ones a chart is drawn from and the ones an export is made of, and the
 * bound is what makes „the log you are watching" the same thing as „the log
 * that is stored". 5000 lines is well over an hour at one reading a second.
 */
export const MAX_LAB_SAMPLES = 5_000;

/**
 * How many readings one `appendSamples` call may carry.
 *
 * The renderer batches a burst (a device that prints ten lines between two
 * animation frames) rather than calling per line, and this bounds one message.
 */
export const MAX_LAB_APPEND_BATCH = 600;

/** How many readings one read answers with — the tail the page charts and lists. */
export const MAX_LAB_SAMPLES_READ = 600;

/** The schema of the payload `LabStore`'s export/import pair carries. A new shape is a new number. */
export const LAB_EXPORT_VERSION = 1;

/** Thrown when a lab write is refused at the store boundary. */
export class LabValidationError extends DatabaseError {}

/** Thrown when an operation names an id that is not a row of THIS profile. */
export class LabNotFoundError extends DatabaseError {}

/** One stored sensor log: what it is called, which columns its readings carry, and how many there are. */
export interface LabLog {
  id: string;
  profileId: string;
  name: string;
  columns: readonly string[];
  /** How many readings are stored — the page says „N readings" without reading them. */
  sampleCount: number;
  /** The instant of the newest reading, or `null` while the log is empty. */
  lastAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One reading: when it arrived, and one value per column of its log. */
export interface LabSample {
  id: string;
  logId: string;
  at: string;
  values: readonly number[];
}

/** One device in the off-grid list. */
export interface LabOffGridDevice {
  name: string;
  watts: number;
  hoursPerDay: number;
}

/** The profile's off-grid budget as one value: the devices and the three numbers the arithmetic needs. */
export interface LabOffGrid {
  devices: readonly LabOffGridDevice[];
  batteryWh: number;
  depthOfDischarge: number;
  sunHours: number;
}

/**
 * Serbian Latin ordering for the log list, on `TimersStore`'s terms: plain `"sr"`
 * mis-tailors š/č/ć/ž, and SQLite's BINARY collation would put „Škola" after
 * „Radionica".
 */
const LAB_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** How many devices one off-grid budget may list — a bound on a list read from a form. */
export const MAX_LAB_DEVICES = 24;

/** A device's name is a label in a table, not a sentence. */
export const MAX_LAB_DEVICE_NAME_LENGTH = 60;

/** The largest single draw the budget will take, in watts: an electric kettle is 3000, and ten times that is a typo rather than a device. */
export const MAX_LAB_DEVICE_WATTS = 100_000;

/** The largest pack the budget will take, in watt-hours: 1 MWh is a house bank. */
export const MAX_LAB_BATTERY_WH = 1_000_000;

interface LogRow {
  id: string;
  profile_id: string;
  name: string;
  columns: string;
  sample_count: number;
  last_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SampleRow {
  id: string;
  log_id: string;
  at: string;
  values_json: string;
}

function logFromRow(row: LogRow): LabLog {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    columns: readColumns(row.columns),
    sampleCount: row.sample_count,
    lastAt: row.last_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sampleFromRow(row: SampleRow): LabSample {
  return { id: row.id, logId: row.log_id, at: row.at, values: readValues(row.values_json) };
}

/**
 * The LAB's storage (migration 089): the sensor logs, the readings inside them,
 * and the off-grid budget.
 *
 * **Why the validation lives here and not only on the wire.** Main re-validates
 * every payload (SEC-EL-02), and this store re-validates again because the two
 * boundaries are different ones: the archive reader is a second caller that
 * never goes through the wire at all, and a JSON column's SHAPE is a rule about
 * this module's own data rather than about a message. So every method takes
 * plain values, checks them against the same bounds the module's own `parse`
 * uses, and throws a sentence naming the field.
 *
 * **Why the retention delete is in the append transaction.** A bound enforced by
 * a later sweep is a bound the user can exceed for as long as the sweep is
 * behind; enforcing it where the rows arrive is what makes „at most N readings"
 * a fact about the table rather than about a schedule.
 *
 * Every method takes `now` explicitly, so a test can move the clock rather than
 * wait — the same arrangement `TimersStore` has, and for the same reason: main
 * stamps every write from the clock the kit injects.
 */
export class LabStore {
  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {}

  // --- Logs -----------------------------------------------------------------

  /** This profile's logs, by name, each with its reading count and its newest instant. */
  listLogs(): LabLog[] {
    const rows = this.db
      .prepare(
        `SELECT l.id, l.profile_id, l.name, l.columns, l.created_at, l.updated_at,
                (SELECT count(*) FROM lab_samples s WHERE s.log_id = l.id) AS sample_count,
                (SELECT max(s.at) FROM lab_samples s WHERE s.log_id = l.id) AS last_at
           FROM lab_logs l
          WHERE l.profile_id = ?`,
      )
      .all(this.profileId) as LogRow[];
    return rows
      .map(logFromRow)
      .sort((left, right) => LAB_COLLATOR.compare(left.name, right.name));
  }

  /** One log by its own id, or `null` when it is not this profile's. */
  log(id: string): LabLog | null {
    const row = this.db
      .prepare(
        `SELECT l.id, l.profile_id, l.name, l.columns, l.created_at, l.updated_at,
                (SELECT count(*) FROM lab_samples s WHERE s.log_id = l.id) AS sample_count,
                (SELECT max(s.at) FROM lab_samples s WHERE s.log_id = l.id) AS last_at
           FROM lab_logs l
          WHERE l.id = ? AND l.profile_id = ?`,
      )
      .get(id, this.profileId) as LogRow | undefined;
    return row === undefined ? null : logFromRow(row);
  }

  /**
   * A new log: a name and the columns its lines will carry, both of which come
   * from the device's own header line.
   */
  createLog(input: { name: string; columns: readonly string[] }, now: string): LabLog {
    const name = this.validName(input.name);
    const columns = this.validColumns(input.columns);
    const stamp = this.validInstant(now);
    const count = this.db
      .prepare("SELECT count(*) AS n FROM lab_logs WHERE profile_id = ?")
      .get(this.profileId) as { n: number };
    if (count.n >= MAX_LAB_LOGS) {
      throw new LabValidationError(`At most ${MAX_LAB_LOGS} logs may be kept.`);
    }
    const id = uuidv7();
    try {
      this.db
        .prepare(
          `INSERT INTO lab_logs (id, profile_id, name, columns, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, this.profileId, name, JSON.stringify(columns), stamp, stamp);
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new LabValidationError(`A log named "${name}" already exists.`);
      }
      throw error;
    }
    return this.requireLog(id);
  }

  /** Removes a log and, by the schema's own cascade, every reading inside it. */
  removeLog(id: string): void {
    const result = this.db
      .prepare("DELETE FROM lab_logs WHERE id = ? AND profile_id = ?")
      .run(id, this.profileId);
    if (result.changes === 0) throw new LabNotFoundError(`No log "${id}".`);
  }

  // --- Readings -------------------------------------------------------------

  /**
   * Appends readings to a log: every row is checked against the log's own
   * columns, all of them are written in ONE transaction, and the oldest ones are
   * dropped beyond `MAX_LAB_SAMPLES`.
   *
   * The returned count is how many rows were written — not how many the log
   * holds, which the caller reads from `listLogs`.
   */
  appendSamples(
    input: { logId: string; rows: readonly { at: string; values: readonly number[] }[] },
    now: string,
  ): number {
    const log = this.requireLog(input.logId);
    const stamp = this.validInstant(now);
    if (input.rows.length === 0) return 0;
    if (input.rows.length > MAX_LAB_APPEND_BATCH) {
      throw new LabValidationError(`At most ${MAX_LAB_APPEND_BATCH} readings may be written at once.`);
    }
    const prepared = input.rows.map((row) => ({
      id: uuidv7(),
      at: this.validInstant(row.at),
      values: this.validValues(row.values, log.columns.length),
    }));
    this.db.transaction(() => {
      const insert = this.db.prepare(
        `INSERT INTO lab_samples (id, log_id, at, values_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const row of prepared) {
        insert.run(row.id, log.id, row.at, JSON.stringify(row.values), stamp);
      }
      // The rolling window: the newest readings are the ones that survive.
      //
      // A ROW-VALUE comparison against the boundary row rather than a
      // `NOT IN (… LIMIT …)`: the `NOT IN` form makes SQLite materialise the
      // whole surviving set on every append, which is a quadratic cost on a
      // stream that is exactly what this table is for. Comparing against the
      // newest row that is still allowed turns the delete into an indexed range,
      // and it keeps the same order — `(at, id)`, which is the index's own.
      // When the log holds fewer readings than the window, the subquery answers
      // NULL and the comparison deletes nothing.
      this.db
        .prepare(
          `DELETE FROM lab_samples
            WHERE log_id = ?
              AND (at, id) < (
                SELECT at, id FROM lab_samples
                 WHERE log_id = ?
                 ORDER BY at DESC, id DESC
                 LIMIT 1 OFFSET ?
              )`,
        )
        .run(log.id, log.id, MAX_LAB_SAMPLES - 1);
      this.db
        .prepare("UPDATE lab_logs SET updated_at = ? WHERE id = ? AND profile_id = ?")
        .run(stamp, log.id, this.profileId);
    })();
    return prepared.length;
  }

  /**
   * A log's newest readings, in time order — what the chart and the row list are
   * drawn from. `limit` is clamped to `MAX_LAB_SAMPLES_READ`, because a read is
   * a message and an unbounded one is a message nobody sized.
   */
  readSamples(logId: string, limit = MAX_LAB_SAMPLES_READ): LabSample[] {
    const log = this.requireLog(logId);
    const take = Math.max(1, Math.min(Math.trunc(limit), MAX_LAB_SAMPLES_READ));
    const rows = this.db
      .prepare(
        `SELECT id, log_id, at, values_json
           FROM lab_samples
          WHERE log_id = ?
          ORDER BY at DESC, id DESC
          LIMIT ?`,
      )
      .all(log.id, take) as SampleRow[];
    // Read newest-first so the LIMIT takes the tail, then hand back the order a
    // chart draws in.
    return rows.reverse().map(sampleFromRow);
  }

  /** Every reading of every one of this profile's logs, for an export. */
  readAllSamples(): LabSample[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.log_id, s.at, s.values_json
           FROM lab_samples s
           JOIN lab_logs l ON l.id = s.log_id
          WHERE l.profile_id = ?
          ORDER BY l.name, s.at, s.id`,
      )
      .all(this.profileId) as SampleRow[];
    return rows.map(sampleFromRow);
  }

  /**
   * Every reading of ONE log, in time order — what the CSV export writes, and
   * the reason it is not `readSamples`: a read is bounded by the message it
   * travels in, and an export is a file the user asked for whole.
   */
  readLogSamples(logId: string): LabSample[] {
    const log = this.requireLog(logId);
    const rows = this.db
      .prepare(
        `SELECT id, log_id, at, values_json
           FROM lab_samples
          WHERE log_id = ?
          ORDER BY at, id`,
      )
      .all(log.id) as SampleRow[];
    return rows.map(sampleFromRow);
  }

  // --- The off-grid budget --------------------------------------------------

  /** The profile's budget, or `null` while it has never filled one in — the page's form then starts empty rather than at numbers this store invented. */
  offGrid(): LabOffGrid | null {
    const row = this.db
      .prepare(
        `SELECT devices, battery_wh, depth_of_discharge, sun_hours
           FROM lab_offgrid WHERE profile_id = ?`,
      )
      .get(this.profileId) as
      | { devices: string; battery_wh: number; depth_of_discharge: number; sun_hours: number }
      | undefined;
    if (row === undefined) return null;
    return {
      devices: readDevices(row.devices),
      batteryWh: row.battery_wh,
      depthOfDischarge: row.depth_of_discharge,
      sunHours: row.sun_hours,
    };
  }

  /** Writes the whole budget, replacing whatever was there — a budget is computed from the list as a whole. */
  setOffGrid(input: LabOffGrid, now: string): LabOffGrid {
    const devices = this.validDevices(input.devices);
    const batteryWh = this.validNumber(input.batteryWh, "batteryWh", 0, MAX_LAB_BATTERY_WH);
    const depthOfDischarge = this.validNumber(input.depthOfDischarge, "depthOfDischarge", 0, 1, false);
    const sunHours = this.validNumber(input.sunHours, "sunHours", 0, 24, false);
    const stamp = this.validInstant(now);
    this.db
      .prepare(
        `INSERT INTO lab_offgrid
           (profile_id, devices, battery_wh, depth_of_discharge, sun_hours, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (profile_id) DO UPDATE SET devices = excluded.devices,
                                                battery_wh = excluded.battery_wh,
                                                depth_of_discharge = excluded.depth_of_discharge,
                                                sun_hours = excluded.sun_hours,
                                                updated_at = excluded.updated_at`,
      )
      .run(this.profileId, JSON.stringify(devices), batteryWh, depthOfDischarge, sunHours, stamp);
    return { devices, batteryWh, depthOfDischarge, sunHours };
  }

  // --- The archive (ADR-090 §imex) ------------------------------------------

  /**
   * Replaces this profile's logs, their readings and the budget with one archive
   * payload, WHOLE.
   *
   * **Why this is one method and not four calls from the module.** A restore that
   * failed between the delete and the last insert would leave a profile holding a
   * fragment of somebody's log — readings with no log, or a log with no columns
   * — and only a transaction can promise that it does not happen. The rows are
   * re-minted rather than restored by id, on `TimersStore.replaceFromArchive`'s
   * terms: an id is this database's key, and the archive carries what the user
   * had.
   *
   * `offGrid: null` is an archive that carried no budget, and it DELETES the row
   * rather than writing zeros: a zeroed budget is a computed answer (zero days of
   * power) about a list nobody entered, which is worse than an absent one.
   */
  replaceFromArchive(
    input: {
      readonly logs: readonly {
        readonly name: string;
        readonly columns: readonly string[];
        readonly samples: readonly { readonly at: string; readonly values: readonly number[] }[];
      }[];
      readonly offGrid: LabOffGrid | null;
    },
    now: string,
  ): void {
    const stamp = this.validInstant(now);
    if (input.logs.length > MAX_LAB_LOGS) {
      throw new LabValidationError(`At most ${MAX_LAB_LOGS} logs may be restored.`);
    }
    const logs = input.logs.map((log) => ({
      name: this.validName(log.name),
      columns: this.validColumns(log.columns),
      samples: log.samples.map((sample) => ({
        at: this.validInstant(sample.at),
        values: this.validValues(sample.values, log.columns.length),
      })),
    }));
    const names = new Set(logs.map((log) => log.name));
    if (names.size !== logs.length) {
      throw new LabValidationError("Two logs in one archive share a name.");
    }
    // Validated before the transaction opens, so a refused archive never has a
    // DELETE to undo.
    const offGrid =
      input.offGrid === null
        ? null
        : {
            devices: this.validDevices(input.offGrid.devices),
            batteryWh: this.validNumber(input.offGrid.batteryWh, "batteryWh", 0, MAX_LAB_BATTERY_WH),
            depthOfDischarge: this.validNumber(
              input.offGrid.depthOfDischarge,
              "depthOfDischarge",
              0,
              1,
              false,
            ),
            sunHours: this.validNumber(input.offGrid.sunHours, "sunHours", 0, 24, false),
          };

    this.db.transaction(() => {
      // The logs go whole: their readings cascade with them, and the archive is
      // what puts both back.
      this.db.prepare("DELETE FROM lab_logs WHERE profile_id = ?").run(this.profileId);
      const insertLog = this.db.prepare(
        `INSERT INTO lab_logs (id, profile_id, name, columns, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const insertSample = this.db.prepare(
        `INSERT INTO lab_samples (id, log_id, at, values_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const log of logs) {
        const logId = uuidv7();
        insertLog.run(logId, this.profileId, log.name, JSON.stringify(log.columns), stamp, stamp);
        for (const sample of log.samples) {
          insertSample.run(uuidv7(), logId, sample.at, JSON.stringify(sample.values), stamp);
        }
      }
      if (offGrid === null) {
        this.db.prepare("DELETE FROM lab_offgrid WHERE profile_id = ?").run(this.profileId);
        return;
      }
      this.db
        .prepare(
          `INSERT INTO lab_offgrid
             (profile_id, devices, battery_wh, depth_of_discharge, sun_hours, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (profile_id) DO UPDATE SET devices = excluded.devices,
                                                  battery_wh = excluded.battery_wh,
                                                  depth_of_discharge = excluded.depth_of_discharge,
                                                  sun_hours = excluded.sun_hours,
                                                  updated_at = excluded.updated_at`,
        )
        .run(
          this.profileId,
          JSON.stringify(offGrid.devices),
          offGrid.batteryWh,
          offGrid.depthOfDischarge,
          offGrid.sunHours,
          stamp,
        );
    })();
  }

  // --- Internals ------------------------------------------------------------

  private requireLog(id: string): LabLog {
    const log = this.log(id);
    if (log === null) throw new LabNotFoundError(`No log "${id}".`);
    return log;
  }

  private validName(raw: string): string {
    const name = raw.trim();
    if (name.length === 0 || name.length > MAX_LAB_LOG_NAME_LENGTH) {
      throw new LabValidationError(`A log name must be 1..${MAX_LAB_LOG_NAME_LENGTH} characters.`);
    }
    return name;
  }

  /** The column names, by the SAME rule the header line is read by (`@nexus/core`'s `sensorColumnName`). */
  private validColumns(raw: readonly string[]): string[] {
    if (raw.length === 0 || raw.length > MAX_SENSOR_COLUMNS) {
      throw new LabValidationError(`A log must carry 1..${MAX_SENSOR_COLUMNS} columns.`);
    }
    const columns: string[] = [];
    for (const value of raw) {
      const name = sensorColumnName(value);
      if (name === null) throw new LabValidationError(`"${String(value)}" is not a column name.`);
      columns.push(name);
    }
    if (new Set(columns).size !== columns.length) {
      throw new LabValidationError("Two columns of one log share a name.");
    }
    return columns;
  }

  private validValues(raw: readonly number[], expected: number): number[] {
    if (raw.length !== expected) {
      throw new LabValidationError(`A reading must carry ${expected} values.`);
    }
    const values: number[] = [];
    for (const value of raw) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new LabValidationError("A reading's value must be a finite number.");
      }
      values.push(value);
    }
    return values;
  }

  private validDevices(raw: readonly LabOffGridDevice[]): LabOffGridDevice[] {
    if (raw.length > MAX_LAB_DEVICES) {
      throw new LabValidationError(`At most ${MAX_LAB_DEVICES} devices may be listed.`);
    }
    return raw.map((device) => {
      const name = device.name.trim();
      if (name.length === 0 || name.length > MAX_LAB_DEVICE_NAME_LENGTH) {
        throw new LabValidationError(
          `A device name must be 1..${MAX_LAB_DEVICE_NAME_LENGTH} characters.`,
        );
      }
      return {
        name,
        watts: this.validNumber(device.watts, "watts", 0, MAX_LAB_DEVICE_WATTS),
        hoursPerDay: this.validNumber(device.hoursPerDay, "hoursPerDay", 0, 24),
      };
    });
  }

  /** A number inside a range, optionally refusing the range's own lower end (`aboveZero`). */
  private validNumber(value: number, field: string, min: number, max: number, aboveZero = true): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new LabValidationError(`"${field}" must be a finite number.`);
    }
    if (aboveZero ? value < min : value <= min) {
      throw new LabValidationError(`"${field}" must be above ${min}.`);
    }
    if (value > max) throw new LabValidationError(`"${field}" must be at most ${max}.`);
    return value;
  }

  /** An ISO instant, as every timestamp in this database is written. */
  private validInstant(value: string): string {
    if (!isDateTime(value)) throw new LabValidationError(`"${value}" is not an instant.`);
    return value;
  }
}

/**
 * A stored columns array, read back.
 *
 * The store is the only writer of this column, so a value it cannot read is
 * corruption rather than input — and it throws, because a log whose columns
 * cannot be read is a log whose readings cannot be interpreted at all.
 */
function readColumns(json: string): readonly string[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) throw new LabValidationError("A stored columns value is not an array.");
  return value.map((name) => {
    const column = sensorColumnName(name);
    if (column === null) throw new LabValidationError("A stored column name is not a name.");
    return column;
  });
}

/** A stored values array, read back — the same rule `validValues` writes by. */
function readValues(json: string): readonly number[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) throw new LabValidationError("A stored values value is not an array.");
  return value.map((each) => {
    if (typeof each !== "number" || !Number.isFinite(each)) {
      throw new LabValidationError("A stored reading is not a finite number.");
    }
    return each;
  });
}

/** A stored device list, read back. */
function readDevices(json: string): readonly LabOffGridDevice[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) throw new LabValidationError("A stored device list is not an array.");
  return value.map((each) => {
    if (typeof each !== "object" || each === null) {
      throw new LabValidationError("A stored device is not an object.");
    }
    const device = each as Record<string, unknown>;
    if (
      typeof device["name"] !== "string" ||
      typeof device["watts"] !== "number" ||
      typeof device["hoursPerDay"] !== "number"
    ) {
      throw new LabValidationError("A stored device has no name, watts and hours.");
    }
    return {
      name: device["name"],
      watts: device["watts"],
      hoursPerDay: device["hoursPerDay"],
    };
  });
}
