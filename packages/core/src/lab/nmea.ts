/**
 * NMEA 0183 — the two sentences a GPS puck actually sends, and the checksum
 * that says a sentence arrived whole.
 *
 * **Why this is hand-written rather than a dependency.** The two sentences the
 * LAB needs are `GGA` (position, fix quality, satellites, UTC time) and `RMC`
 * (position, speed, `ddmmyy` date), and both arrive on a serial line at 1 Hz.
 * A parser here is arithmetic over one split string; a package would be a
 * dependency, a licence and a second idea of what a field is. The standard
 * document itself is sold by NMEA rather than published openly, which is why
 * nothing below quotes it — the field order is the one every receiver emits and
 * every parser reads (`docs`-free: see the research note in the task, and the
 * test file for the example sentences and their sources), and the checksum rule
 * is the line's own arithmetic rather than a document.
 *
 * **Checksum, and why a sentence without one is refused.** Every sentence is
 * `$<body>*<CS>` where `CS` is the XOR of every character between the `$` and
 * the `*`, written as two hexadecimal digits. A receiver that drops a byte
 * usually still delivers a parseable line, and a position that is one digit off
 * is the worst kind of wrong: it looks like a place. So `parseNmeaSentence`
 * refuses a sentence that does not carry `*CS` at all — "the checksum is
 * optional" is a reading of the standard that no GPS puck requires.
 *
 * **Which sentences are parsed, and what is deliberately not.** `GGA` and `RMC`
 * only, under any two-character talker id (`GP`, `GN`, `GL`, `GA`, `BD`, …), so
 * `$GPGGA`, `$GNGGA`, `$GPRMC` and `$GNRMC` are all read and a second
 * constellation's sentences are not treated as foreign. `GSV`/`GSA` (satellite
 * geometry), `VTG` (track made good) and `ZDA` (local clock) are not parsed:
 * nothing in this module's page shows them, and a field nobody reads is a field
 * whose bugs nobody finds.
 *
 * **Position is decimal degrees, as the fix reports it.** `4807.038,N` is
 * 48 degrees and 7.038 minutes, so it is `48 + 7.038 / 60`. Nothing is rounded
 * here: rounding belongs where a number is FORMATTED, and a caller that formats
 * through `Intl` gets the locale's own decimals.
 *
 * **The date carries no century, and this file says which one it assumes.**
 * `RMC` field 8 is `ddmmyy`. A two-digit year needs a pivot, and the one used
 * here is the usual convention for this format — 00…79 is 20xx, 80…99 is 19xx —
 * so a receiver reporting today's date reads as today. The raw `ddmmyy` is kept
 * beside the derived ISO date rather than thrown away, because the assumption is
 * this file's and a reader of a stored fix should be able to check it.
 */

/** One `GGA` or `RMC` reading. Every optional field is `null` when the sentence did not carry it. */
export interface NmeaReading {
  /** Which sentence this came from. */
  readonly kind: "GGA" | "RMC";
  /** The talker id as sent: `GP` for GPS, `GN` for a combined constellation, and so on. */
  readonly talker: string;
  /** UTC time of the fix as `hh:mm:ss`, or `null` when the field was empty. */
  readonly utcTime: string | null;
  /** Signed decimal degrees, or `null` when the sentence carried no position. */
  readonly latitude: number | null;
  readonly longitude: number | null;
  /** `GGA`: 0 = no fix, 1 = GPS fix, 2 = differential, … — as the receiver reports it. */
  readonly fixQuality: number | null;
  /** `GGA`: satellites used in the solution. */
  readonly satellites: number | null;
  /** `RMC`: `A` = the position is valid, `V` = the receiver says it is not. */
  readonly status: "A" | "V" | null;
  /** `RMC`: speed over ground in knots. */
  readonly speedKnots: number | null;
  /** `RMC`: the raw `ddmmyy`, kept so the century assumption below is checkable. */
  readonly dateStamp: string | null;
  /** `RMC`: that date as `yyyy-mm-dd`, or `null`. */
  readonly utcDate: string | null;
  /** The sentence as received, without the line ending. */
  readonly raw: string;
}

/** Why a line was not a reading. Closed on purpose: the page turns each one into its own sentence, and a raw exception never reaches the screen. */
export type NmeaProblem =
  | "not-nmea"
  | "unknown-sentence"
  | "missing-checksum"
  | "bad-checksum"
  | "bad-field";

export type NmeaParseResult =
  | { readonly ok: true; readonly reading: NmeaReading }
  | { readonly ok: false; readonly problem: NmeaProblem };

/** The address of a sentence: two talker characters and the three-character sentence form. */
const ADDRESS = /^([A-Z]{2})(GGA|RMC)$/;

/** `hhmmss` with an optional fraction — what both sentences carry in their first field. */
const UTC_TIME = /^(\d{2})(\d{2})(\d{2})(?:\.\d+)?$/;

/** `ddmm.mmm…` for latitude, `dddmm.mmm…` for longitude. */
const LATITUDE = /^(\d{2})(\d{2}(?:\.\d+)?)$/;
const LONGITUDE = /^(\d{3})(\d{2}(?:\.\d+)?)$/;

/** `ddmmyy`. */
const DATE_STAMP = /^(\d{2})(\d{2})(\d{2})$/;

/**
 * The XOR of a sentence's body — every character between the `$` and the `*`.
 *
 * The caller passes the body WITHOUT the `*CS`; `nmeaChecksumOf` below takes a
 * whole line and finds it. Exported because a test asserts exact values for
 * known sentences, and because a checksum computed by a second implementation
 * is the only way to check this one.
 */
export function nmeaChecksum(body: string): number {
  let sum = 0;
  for (let index = 0; index < body.length; index += 1) {
    sum ^= body.charCodeAt(index) & 0xff;
  }
  return sum;
}

/**
 * The body and the checksum of a line, or `null` when the line does not carry
 * exactly one `*` followed by two hex digits.
 */
function sentenceBody(line: string): { body: string; checksum: number } | null {
  const star = line.lastIndexOf("*");
  if (star < 0) return null;
  const text = line.slice(star + 1).trim();
  if (!/^[0-9A-Fa-f]{2}$/.test(text)) return null;
  return { body: line.slice(1, star), checksum: Number.parseInt(text, 16) };
}

/**
 * One line of a serial stream as a reading, or the reason it is not one.
 *
 * The line is trimmed first, because a receiver's line ending is configuration
 * rather than data — the page sets it, and `\r`, `\n`, `\r\n` and nothing are
 * all the same sentence. Everything after that is strict: a missing or wrong
 * checksum is refused, an empty mandatory field is `bad-field`, and a field
 * that is not the number the standard puts there is `bad-field` too.
 */
export function parseNmeaSentence(line: string): NmeaParseResult {
  const trimmed = line.trim();
  if (!trimmed.startsWith("$")) return { ok: false, problem: "not-nmea" };
  const body = sentenceBody(trimmed);
  if (body === null) return { ok: false, problem: "missing-checksum" };
  if (nmeaChecksum(body.body) !== body.checksum) return { ok: false, problem: "bad-checksum" };

  const fields = body.body.split(",");
  const address = ADDRESS.exec(fields[0] ?? "");
  if (address === null) return { ok: false, problem: "unknown-sentence" };
  const talker = address[1] as string;
  const kind = address[2] as "GGA" | "RMC";

  try {
    const reading =
      kind === "GGA"
        ? readGga(talker, fields, trimmed)
        : readRmc(talker, fields, trimmed);
    return { ok: true, reading };
  } catch {
    return { ok: false, problem: "bad-field" };
  }
}

/** `GGA`: time, position, fix quality, satellites — the sentence a fix panel is built from. */
function readGga(talker: string, fields: readonly string[], raw: string): NmeaReading {
  const utcTime = readUtcTime(fields[1]);
  const { latitude, longitude } = readPosition(fields[2], fields[3], fields[4], fields[5]);
  return {
    kind: "GGA",
    talker,
    utcTime,
    latitude,
    longitude,
    fixQuality: readWhole(fields[6], 0, 8),
    satellites: readWhole(fields[7], 0, 32),
    status: null,
    speedKnots: null,
    dateStamp: null,
    utcDate: null,
    raw,
  };
}

/** `RMC`: position, validity, speed and the date the fix belongs to. */
function readRmc(talker: string, fields: readonly string[], raw: string): NmeaReading {
  const utcTime = readUtcTime(fields[1]);
  const statusField = (fields[2] ?? "").trim();
  if (statusField !== "A" && statusField !== "V") throw new RangeError("status");
  const { latitude, longitude } = readPosition(fields[3], fields[4], fields[5], fields[6]);
  const speed = readDecimal(fields[7], 0, 10_000);
  const dateStamp = (fields[9] ?? "").trim();
  return {
    kind: "RMC",
    talker,
    utcTime,
    latitude,
    longitude,
    fixQuality: null,
    satellites: null,
    status: statusField,
    speedKnots: speed,
    dateStamp: dateStamp === "" ? null : dateStamp,
    utcDate: dateStamp === "" ? null : toIsoDate(dateStamp),
    raw,
  };
}

/**
 * The position from an `RMC`/`GGA` pair of value/hemisphere fields.
 *
 * An empty latitude with an empty longitude is a fix the receiver does not have
 * yet, and that is `null` — not a refusal — because a puck sends exactly that
 * before it has a lock and the page wants to say "no fix yet" rather than
 * "garbage". Half a position is a field error.
 */
function readPosition(
  rawLatitude: string | undefined,
  hemisphereLatitude: string | undefined,
  rawLongitude: string | undefined,
  hemisphereLongitude: string | undefined,
): { latitude: number | null; longitude: number | null } {
  const lat = (rawLatitude ?? "").trim();
  const lon = (rawLongitude ?? "").trim();
  if (lat === "" && lon === "") return { latitude: null, longitude: null };
  if (lat === "" || lon === "") throw new RangeError("position");
  const latitude = toDecimalDegrees(LATITUDE, lat, hemisphereLatitude, "N", "S");
  const longitude = toDecimalDegrees(LONGITUDE, lon, hemisphereLongitude, "E", "W");
  return { latitude, longitude };
}

/** Degrees and minutes of arc as signed decimal degrees. */
function toDecimalDegrees(
  shape: RegExp,
  value: string,
  hemisphere: string | undefined,
  positive: string,
  negative: string,
): number {
  const match = shape.exec(value);
  if (match === null) throw new RangeError("degrees");
  const degrees = Number(match[1]);
  const minutes = Number(match[2]);
  if (!(minutes < 60)) throw new RangeError("minutes");
  const mark = (hemisphere ?? "").trim().toUpperCase();
  if (mark !== positive && mark !== negative) throw new RangeError("hemisphere");
  const sign = mark === negative ? -1 : 1;
  return sign * (degrees + minutes / 60);
}

/** `hhmmss(.sss)` as `hh:mm:ss`, or `null` for an empty field. */
function readUtcTime(field: string | undefined): string | null {
  const value = (field ?? "").trim();
  if (value === "") return null;
  const match = UTC_TIME.exec(value);
  if (match === null) throw new RangeError("time");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (hours > 23 || minutes > 59 || seconds > 60) throw new RangeError("time");
  return `${match[1]}:${match[2]}:${match[3]}`;
}

/** A whole-number field inside `min`…`max`, or `null` when the sentence left it empty. */
function readWhole(field: string | undefined, min: number, max: number): number | null {
  const value = (field ?? "").trim();
  if (value === "") return null;
  if (!/^\d+$/.test(value)) throw new RangeError("whole");
  const number = Number(value);
  if (number < min || number > max) throw new RangeError("whole");
  return number;
}

/** A decimal field inside `min`…`max`, or `null` when the sentence left it empty. */
function readDecimal(field: string | undefined, min: number, max: number): number | null {
  const value = (field ?? "").trim();
  if (value === "") return null;
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new RangeError("decimal");
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new RangeError("decimal");
  return number;
}

/** `ddmmyy` as `yyyy-mm-dd`, on the pivot the file header states. */
function toIsoDate(stamp: string): string {
  const match = DATE_STAMP.exec(stamp);
  if (match === null) throw new RangeError("date");
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12) throw new RangeError("date");
  const century = year <= 79 ? 2000 : 1900;
  const two = (value: number): string => value.toString().padStart(2, "0");
  return `${century + year}-${two(month)}-${two(day)}`;
}

/** The fix the page shows: the newest field each sentence carried, nothing invented. */
export interface NmeaFix {
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly fixQuality: number | null;
  readonly satellites: number | null;
  readonly utcTime: string | null;
  readonly utcDate: string | null;
  readonly speedKnots: number | null;
  /** When the newest reading arrived, from the caller's clock — not from the satellite. */
  readonly at: string;
}

/**
 * Folds one reading into the fix on screen.
 *
 * GGA and RMC alternate at the same rate and each carries half of what a panel
 * wants, so they are merged rather than shown in turn: a field is taken from the
 * reading that carried it and kept when the next one does not. A position is
 * taken as a PAIR — a fix never acquires half a position from a sentence that
 * had none.
 */
export function mergeNmeaFix(current: NmeaFix | null, reading: NmeaReading, at: string): NmeaFix {
  const keep = current ?? {
    latitude: null,
    longitude: null,
    fixQuality: null,
    satellites: null,
    utcTime: null,
    utcDate: null,
    speedKnots: null,
    at,
  };
  const hasPosition = reading.latitude !== null && reading.longitude !== null;
  return {
    latitude: hasPosition ? reading.latitude : keep.latitude,
    longitude: hasPosition ? reading.longitude : keep.longitude,
    fixQuality: reading.fixQuality ?? keep.fixQuality,
    satellites: reading.satellites ?? keep.satellites,
    utcTime: reading.utcTime ?? keep.utcTime,
    utcDate: reading.utcDate ?? keep.utcDate,
    speedKnots: reading.speedKnots ?? keep.speedKnots,
    at,
  };
}

