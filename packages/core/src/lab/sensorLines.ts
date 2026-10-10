/**
 * The CSV a sketch prints on a serial line — `temp,humidity,pressure` — as
 * numbers, and back out as a CSV file with a header.
 *
 * **The header is the columns, and it is the only place they are named.** An
 * Arduino printing three numbers per line says nothing about which is which, so
 * the page treats the first line that is not numbers as the column names and
 * every later line as values in that order. That rule is what `parseSensorHeader`
 * and `parseSensorLine` are: one line is a header when every comma-separated
 * field is a non-empty token that is not a number, and a data line is one when
 * exactly as many fields as the header names are all finite numbers.
 *
 * **A line that does not fit is refused, not repaired.** A short line, a line
 * with a word in it and a line with one extra field are all `null` at the
 * parser, and the caller decides what to do about it — the page counts them and
 * says so, and main refuses to store one. Silently padding or truncating is how
 * a temperature ends up in the humidity column of somebody's saved log.
 *
 * **Numbers are written the machine-readable way, and read the same way.** The
 * CSV this file produces uses `.` for the decimal separator regardless of the
 * interface's locale, because a CSV is read by a spreadsheet or a script rather
 * than by a person, and `1,5` in a comma-separated file is two fields. The PAGE
 * formats values for the eye through `Intl`, which is where a Serbian decimal
 * comma belongs.
 */

/** How many columns one line of an Arduino's output may describe. */
export const MAX_SENSOR_COLUMNS = 12;

/** How long a column name may be — it is a spreadsheet heading, not a paragraph. */
export const MAX_SENSOR_NAME_LENGTH = 32;

/** How many decimals a written value carries. Enough for a hobby sensor and short enough to read. */
const VALUE_DECIMALS = 4;

/**
 * The column names a header line declares, or `null` when the line is not a
 * header.
 *
 * A field is a name when it is non-empty after trimming and is not a number —
 * `temp`, `t °C`, `vlaga_%`. Anything else makes the whole line not-a-header,
 * which is how a data line is told apart: refusing the line rather than its
 * field is what keeps `23.5,41.2,1009` from becoming three columns called
 * "23.5", "41.2" and "1009".
 *
 * Duplicates are refused for the same reason the store refuses two logs with one
 * name: two columns called `temp` are one column the user cannot tell from the
 * other.
 */
export function parseSensorHeader(line: string): readonly string[] | null {
  const fields = line.split(",");
  if (fields.length === 0 || fields.length > MAX_SENSOR_COLUMNS) return null;
  const names: string[] = [];
  for (const field of fields) {
    const name = sensorColumnName(field);
    if (name === null) return null;
    names.push(name);
  }
  return new Set(names).size === names.length ? names : null;
}

/**
 * One column name, or `null` when the field cannot be one.
 *
 * Exported because three places have to agree on what a column name is: the
 * header line (here), the IPC wire (main validates the names a renderer sends)
 * and the store's own bound on a stored log. A rule spelled once is a rule that
 * cannot disagree with itself, which the three copies of a name would.
 */
export function sensorColumnName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name.length === 0 || name.length > MAX_SENSOR_NAME_LENGTH) return null;
  return isNumeric(name) ? null : name;
}

/**
 * One data line as the values the header's columns describe, or `null` when the
 * line is not a row of `columnCount` numbers.
 *
 * Every field must be a finite number: `-12.5`, `0`, `1e3` and ` 23.5 ` all are,
 * and `nan`, `inf`, an empty field and a word are not. A value's RANGE is not
 * checked here at all — a sensor's own units are the sketch's business, and this
 * file has no idea whether a column is a temperature or a millivolt.
 */
export function parseSensorLine(line: string, columnCount: number): readonly number[] | null {
  if (!Number.isInteger(columnCount) || columnCount < 1 || columnCount > MAX_SENSOR_COLUMNS) {
    return null;
  }
  const fields = line.split(",");
  if (fields.length !== columnCount) return null;
  const values: number[] = [];
  for (const field of fields) {
    const text = field.trim();
    if (text === "" || !isNumeric(text)) return null;
    const value = Number(text);
    if (!Number.isFinite(value)) return null;
    values.push(value);
  }
  return values;
}

/**
 * Whether a field is written as a number.
 *
 * Deliberately a SHAPE rather than `Number()`: `Number("")` is 0, `Number(" ")`
 * is 0 and `Number("0x10")` is 16, so a parser built on `Number` alone accepts
 * an empty field as zero — which is the one substitution a logging tool must
 * never make.
 */
function isNumeric(text: string): boolean {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text);
}

/** One value as it is written to a file: a plain decimal with a `.` point. */
export function formatSensorValue(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError("A sensor value must be a finite number.");
  return value.toFixed(VALUE_DECIMALS);
}

/** One stored sample: when it was logged, and one value per column. */
export interface SensorCsvRow {
  /** An ISO instant, written unchanged — it is already machine-readable. */
  readonly at: string;
  readonly values: readonly number[];
}

/**
 * A whole log as a CSV file: a header naming the columns, then one row per
 * sample, in the order given.
 *
 * The timestamp is a column of its own so that a spreadsheet can sort and plot
 * without guessing; nothing else about the row is reordered. `at` is written as
 * stored rather than reformatted, because an ISO instant is the one spelling
 * every reader agrees on.
 */
export function formatSensorCsv(
  columns: readonly string[],
  rows: readonly SensorCsvRow[],
): string {
  const lines: string[] = [["at", ...columns].map(csvField).join(",")];
  for (const row of rows) {
    if (row.values.length !== columns.length) {
      throw new RangeError("A sample's values must match the log's columns.");
    }
    lines.push(
      [row.at, ...row.values.map(formatSensorValue)].map(csvField).join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * One field, quoted when it has to be.
 *
 * A column name comes from a serial line and may contain a comma, a quote or a
 * leading space; RFC 4180's answer is to wrap the field in quotes and double
 * every quote inside it, which is what every reader expects.
 */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
