/**
 * Pure RFC 5545 (iCalendar) reader for the Nexus calendar (ADR-061) — the
 * import half of what `icsExport.ts` writes, and the translator that turns
 * somebody else's calendar into the event rows `planForeignImport` merges.
 * Hand-rolled for the exporter's own reason: the format is line-oriented text,
 * and the things that go wrong in it (unfolding, TEXT escaping, the two
 * date-time forms) are each a handful of lines here and each pinned by its own
 * test.
 *
 * The split is the one every importer in this package makes. `parseIcsCalendar`
 * consumes the untrusted TEXT and answers with plain rows and counted losses —
 * target-independent, so main can hold the PARSED events in its pending session
 * and drop the raw text the moment this returns. `translateIcsEvents` then
 * stamps those rows for one profile with an injected `now`; the planner's id
 * map re-mints every id below.
 *
 * Four decisions a reader would otherwise have to reverse-engineer:
 *
 *  - **A floating local date-time maps VERBATIM onto Nexus's zone-less
 *    wall-clock strings** — `DTSTART:20260715T093000` becomes
 *    `"2026-07-15T09:30"`, no conversion, because form 1 of §3.3.5 means
 *    precisely "this wall clock, wherever the reader is", which is exactly what
 *    the app stores and exactly what `icsExport.ts` writes.
 *
 *  - **A UTC instant (`…Z`) or a `TZID=`-zoned value converts to the MACHINE'S
 *    local wall clock at import time.** The app stores no zones, so a zoned
 *    value has to become somebody's wall clock — and an import is a one-time
 *    reading, which makes the machine it runs on the only honest reference:
 *    "when is this meeting, here, now" is the question the user is actually
 *    asking. This is the module's ONE deliberate impurity — the local `Date`
 *    getters and `Intl`'s zone database are what "the machine's wall clock"
 *    MEANS — and `now` stays injected like every other module's.
 *
 *  - **A rule that outgrows the six ADR-024 shapes imports its master as a
 *    ONE-OFF event, counted as `recurrence-unmappable`** — a silently
 *    simplified series would be a lie and a refused event a loss, so one
 *    occurrence is the truthful minimum. What fits, maps exactly; the finished
 *    rule is re-checked through `validateRecurrenceRule` — core's own gate on
 *    the rule language — so nothing this module builds can disagree with what
 *    the engine will actually do. A workweek `BYDAY` at interval 1 maps onto
 *    the `weekdays` shape, which is the same series and the very RRULE the
 *    exporter writes for it.
 *
 *  - **`LOCATION` lands on the event's own `location` column** — the exact
 *    inverse of what the export writes from that column, and what makes the
 *    round-trip test's "every exportable event re-imports to an equivalent
 *    row" hold field for field. The one asymmetry is the reminder ladder: ICS
 *    does not carry Nexus's reminder offsets (a `VALARM` is a different,
 *    consumer-side thing, counted below like any other component), so every
 *    imported event starts with the default of none.
 *
 * Salvage discipline throughout, on the `.apkg` translator's terms: nothing is
 * dropped silently. Components that are not events — `VTODO`, `VJOURNAL`,
 * `VTIMEZONE`, a `VALARM` inside an event, anything unknown — are counted BY
 * NAME; per-event losses and trims are counted by code; and a file with no
 * `VCALENDAR` in it at all is refused whole, which is the only whole-file
 * refusal there is.
 */

import { dayKeyToUtcMs, isValidDayKey, shiftDayKey, type DayKey } from "../calendar/calendarGrid.js";
import { validateRecurrenceRule } from "../recurrence/recurrence.js";
import type { RecurrenceRule, RecurrenceWeekday } from "../recurrence/recurrence.js";
import type { ExportEvent, ProfileData } from "./exportArchive.js";

/** One component the file carried and this import does not read, counted by its own `BEGIN` name — first-seen order, exactly as it sat in the file. */
export interface IcsSkippedComponent {
  name: string;
  count: number;
}

/**
 * Why something a VEVENT carried is not (or not wholly) in the result. The
 * first three REFUSE the event; the rest trim it and say so. None of them ever
 * refuses the file, which only `not-a-calendar` does.
 */
export type IcsImportSkipCode =
  | "invalid-start"
  | "unknown-timezone"
  | "empty-summary"
  | "invalid-end"
  | "invalid-exdate"
  | "recurrence-unmappable"
  | "detached-override"
  | "categories-dropped";

/** Every skip code, in the order the preview lists them: what was lost outright first, what was merely trimmed after. */
export const ICS_IMPORT_SKIP_CODES: readonly IcsImportSkipCode[] = [
  "invalid-start",
  "unknown-timezone",
  "empty-summary",
  "invalid-end",
  "invalid-exdate",
  "recurrence-unmappable",
  "detached-override",
  "categories-dropped",
];

export interface IcsImportSkip {
  code: IcsImportSkipCode;
  count: number;
}

/**
 * One event as the calendar file described it, already in the app's own value
 * language — wall-clock strings, an ADR-024 rule, bare exdate days — but not
 * yet anybody's row: no id, no profile, no timestamps. Exactly the shape main's
 * pending session holds between preview and apply, so re-planning under a
 * different duplicate answer never re-reads (or re-holds) the file's text.
 */
export interface IcsParsedEvent {
  title: string;
  description: string | null;
  /** `"YYYY-MM-DD"` for an all-day event, `"YYYY-MM-DDTHH:MM[:SS]"` (zone-less wall clock) for a timed one. */
  startAt: string;
  /** The INCLUSIVE last day of an all-day span, the end instant of a timed one, or null for a point event. */
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  category: string | null;
  recurrence: RecurrenceRule | null;
  /** Bare `YYYY-MM-DD` days excluded from the series, ascending and duplicate-free; always empty when `recurrence` is null. */
  recurrenceExdates: string[];
}

export interface IcsParsedCalendar {
  /** VEVENTs the file carried, refused ones included — what `events.length` is honestly measured against. */
  sourceEvents: number;
  events: readonly IcsParsedEvent[];
  components: readonly IcsSkippedComponent[];
  /** Every named per-event loss or trim, in `ICS_IMPORT_SKIP_CODES` order, zero-count lines omitted. */
  skips: readonly IcsImportSkip[];
}

/** The one whole-file refusal: text with no `VCALENDAR` in it is not a calendar at all. */
export type IcsCalendarProblem = "not-a-calendar";

export type IcsParseResult =
  | { status: "failed"; code: IcsCalendarProblem }
  | { status: "ok"; calendar: IcsParsedCalendar };

// --- Content lines -----------------------------------------------------------

/** One unfolded content line: `NAME[;PARAM=VALUE…]:value`, names uppercased (§2 makes them case-insensitive), parameter values unquoted. */
interface ContentLine {
  name: string;
  params: ReadonlyMap<string, string>;
  value: string;
}

const PROPERTY_NAME = /^[A-Za-z0-9-]+$/;

/** Splits `text` on `separator` wherever it sits OUTSIDE double quotes — the one piece of state the §3.1 grammar has. */
function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (character === '"') inQuotes = !inQuotes;
    if (character === separator && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts;
}

/** One raw line as a content line, or null for anything the grammar cannot read — a junk line is passed over, never fatal. */
function parseContentLine(line: string): ContentLine | null {
  const [head = "", ...valueParts] = splitOutsideQuotes(line, ":");
  if (valueParts.length === 0) return null;
  const value = valueParts.join(":");
  const [rawName = "", ...rawParams] = splitOutsideQuotes(head, ";");
  if (!PROPERTY_NAME.test(rawName)) return null;
  const params = new Map<string, string>();
  for (const rawParam of rawParams) {
    const equals = rawParam.indexOf("=");
    if (equals <= 0) continue;
    const key = rawParam.slice(0, equals).toUpperCase();
    let parameterValue = rawParam.slice(equals + 1);
    if (parameterValue.startsWith('"') && parameterValue.endsWith('"') && parameterValue.length >= 2) {
      parameterValue = parameterValue.slice(1, -1);
    }
    if (!params.has(key)) params.set(key, parameterValue);
  }
  return { name: rawName.toUpperCase(), params, value };
}

/**
 * RFC 5545 §3.1 unfolding: a line break followed by one space or HTAB is not a
 * break at all. CRLF and bare LF are both accepted — the RFC writes the former,
 * half the tools in the world the latter — and a leading BOM is stripped
 * rather than read into the first property's name.
 */
function unfoldContentLines(text: string): ContentLine[] {
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const unfolded: string[] = [];
  for (const rawLine of source.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
      continue;
    }
    unfolded.push(line);
  }
  const lines: ContentLine[] = [];
  for (const line of unfolded) {
    if (line.length === 0) continue;
    const parsed = parseContentLine(line);
    if (parsed !== null) lines.push(parsed);
  }
  return lines;
}

// --- TEXT values (§3.3.11) ---------------------------------------------------

/** The inverse of the export's `escapeText`: `\n`/`\N` back to a line break, `\\` `\;` `\,` back to their characters. A backslash before anything else is literal text, as it was typed. */
function unescapeText(value: string): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value.charAt(index);
    if (character !== "\\") {
      out += character;
      continue;
    }
    const next = value.charAt(index + 1);
    if (next === "n" || next === "N") {
      out += "\n";
      index += 1;
    } else if (next === "\\" || next === ";" || next === ",") {
      out += next;
      index += 1;
    } else {
      out += character;
    }
  }
  return out;
}

/** A multi-valued TEXT property's values: split on UNESCAPED commas first, then unescaped — an escaped comma is part of one value, not a separator. */
function splitTextValues(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value.charAt(index);
    if (character === "\\") {
      current += character + value.charAt(index + 1);
      index += 1;
      continue;
    }
    if (character === ",") {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => unescapeText(part).trim()).filter((part) => part.length > 0);
}

/** A TEXT property as a nullable field: unescaped, and null when there is nothing but whitespace to say. */
function textOrNull(line: ContentLine | undefined): string | null {
  if (line === undefined) return null;
  const value = unescapeText(line.value);
  return value.trim().length === 0 ? null : value;
}

// --- Date-times --------------------------------------------------------------

/** One value of a date property, already on the machine's wall clock: a bare day, or a day with a `"HHMMSS"` time. The exporter's own `IcsMoment`, read back. */
interface WallMoment {
  day: DayKey;
  time: string | null;
}

type MomentOutcome =
  | { ok: true; moment: WallMoment }
  | { ok: false; reason: "invalid" | "unknown-timezone" };

const INVALID_MOMENT: MomentOutcome = { ok: false, reason: "invalid" };

const DATE_VALUE = /^(\d{4})(\d{2})(\d{2})$/;
/** §3.3.5's DATE-TIME. Seconds are lenient-optional — the RFC always writes them, some producers do not — and a trailing `Z` is form 2. */
const DATE_TIME_VALUE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/**
 * One `Intl.DateTimeFormat` per TZID, cached — including the negative answer,
 * so an unknown zone is asked about once. `Intl` IS the machine's zone
 * database; refusing what it cannot name (rather than guessing an offset) is
 * what keeps a zoned value from quietly landing hours off.
 */
const zoneFormatters = new Map<string, Intl.DateTimeFormat | null>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = zoneFormatters.get(timeZone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    formatter = null;
  }
  zoneFormatters.set(timeZone, formatter);
  return formatter;
}

/** The zone's own wall clock at instant `ms`, re-read as a UTC timestamp — the two differ by exactly the zone's offset at that instant. */
function zoneWallClockAsUtcMs(formatter: Intl.DateTimeFormat, ms: number): number {
  const fields = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of formatter.formatToParts(new Date(ms))) {
    if (part.type in fields) fields[part.type as keyof typeof fields] = Number(part.value);
  }
  return Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
}

/**
 * The instant at which `timeZone`'s wall clock reads the given fields, or null
 * for a zone this machine cannot name. Two passes, because the offset can only
 * be asked about an instant and the instant is what is being solved for — the
 * standard fixpoint, which lands exactly for every real time and picks one
 * side of a DST fold.
 */
function zonedEpochMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number | null {
  // RFC 7808's globally-unique TZIDs carry a leading solidus; the IANA name follows it.
  const formatter = zoneFormatter(timeZone.replace(/^\//, ""));
  if (formatter === null) return null;
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = naive - (zoneWallClockAsUtcMs(formatter, naive) - naive);
  return naive - (zoneWallClockAsUtcMs(formatter, first) - first);
}

/** Instant `ms` on THIS machine's wall clock — the local `Date` getters are the definition, not an approximation (see the module header). */
function localWallMoment(ms: number): WallMoment | null {
  const at = new Date(ms);
  const day = `${pad(at.getFullYear(), 4)}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  if (!isValidDayKey(day)) return null;
  return { day, time: `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}` };
}

/**
 * One date value in the three forms §3.3.5 has: a bare DATE, a floating local
 * DATE-TIME (kept verbatim), or an instant — `Z`-suffixed or `TZID=`-zoned —
 * converted to the machine's wall clock. `VALUE=DATE` pins the first form; a
 * bare-date value without the parameter is still read as the DATE it actually
 * is, the same leniency the exporter's own `parseStart` extends.
 */
function readMoment(raw: string, params: ReadonlyMap<string, string>): MomentOutcome {
  const value = raw.trim();
  const dateMatch = DATE_VALUE.exec(value);
  if (dateMatch !== null) {
    const [, year = "", month = "", day = ""] = dateMatch;
    const key = `${year}-${month}-${day}`;
    return isValidDayKey(key) ? { ok: true, moment: { day: key, time: null } } : INVALID_MOMENT;
  }
  if ((params.get("VALUE") ?? "").toUpperCase() === "DATE") return INVALID_MOMENT;

  const match = DATE_TIME_VALUE.exec(value);
  if (match === null) return INVALID_MOMENT;
  const [, year = "", month = "", day = "", hour = "", minute = "", second = "00", zulu] = match;
  const key = `${year}-${month}-${day}`;
  if (!isValidDayKey(key)) return INVALID_MOMENT;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return INVALID_MOMENT;

  const timeZone = params.get("TZID") ?? null;
  if (zulu === undefined && timeZone === null) {
    return { ok: true, moment: { day: key, time: `${hour}${minute}${second}` } };
  }

  let ms: number | null;
  if (zulu !== undefined) {
    ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  } else {
    ms = zonedEpochMs(
      Number(year), Number(month), Number(day),
      Number(hour), Number(minute), Number(second),
      timeZone ?? "",
    );
    if (ms === null) return { ok: false, reason: "unknown-timezone" };
  }
  const moment = Number.isFinite(ms) ? localWallMoment(ms) : null;
  return moment === null ? INVALID_MOMENT : { ok: true, moment };
}

/** `{ day: "2026-07-15", time: "093000" }` -> `"2026-07-15T09:30"`; zero seconds are dropped, which is the form the app itself writes. */
function momentToStored(moment: WallMoment): string {
  if (moment.time === null) return moment.day;
  const base = `${moment.day}T${moment.time.slice(0, 2)}:${moment.time.slice(2, 4)}`;
  const seconds = moment.time.slice(4, 6);
  return seconds === "00" ? base : `${base}:${seconds}`;
}

/** A timed moment as zone-LESS milliseconds — plain arithmetic over the wall clock, which is what adding a DURATION to one means. */
function wallToMs(moment: WallMoment): number {
  const time = moment.time ?? "000000";
  return (
    dayKeyToUtcMs(moment.day) +
    (Number(time.slice(0, 2)) * 3600 + Number(time.slice(2, 4)) * 60 + Number(time.slice(4, 6))) * 1000
  );
}

/** The inverse of `wallToMs`, through the UTC getters — the same zone-less arithmetic, never the machine's zone. */
function msToWall(ms: number): WallMoment | null {
  const at = new Date(ms);
  const day = `${pad(at.getUTCFullYear(), 4)}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
  if (!isValidDayKey(day)) return null;
  return {
    day,
    time: `${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}`,
  };
}

// --- DURATION (§3.3.6) -------------------------------------------------------

const DURATION_VALUE = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** A duration as milliseconds, or null when it is malformed, negative (an event cannot end before it starts) or names no unit at all. */
function readDurationMs(raw: string): number | null {
  const match = DURATION_VALUE.exec(raw.trim());
  if (match === null) return null;
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  if (sign === "-") return null;
  if (
    weeks === undefined && days === undefined && hours === undefined &&
    minutes === undefined && seconds === undefined
  ) {
    return null;
  }
  const totalDays = Number(weeks ?? 0) * 7 + Number(days ?? 0);
  const totalSeconds =
    Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
  return (totalDays * 86_400 + totalSeconds) * 1000;
}

// --- RRULE (§3.3.10) onto the six shapes (ADR-024) ---------------------------

const ICS_WEEKDAY_INDEX: Record<string, RecurrenceWeekday> = {
  MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6,
};

/** The RRULE parts this mapping can even consider. A part outside this set says something the six shapes cannot, so its rule is unmappable by construction. */
const KNOWN_RRULE_PARTS = new Set([
  "FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS", "WKST",
]);

interface ByDayToken {
  ordinal: number | null;
  weekday: RecurrenceWeekday;
}

const BYDAY_TOKEN = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/;

function parseByDay(value: string): ByDayToken[] | null {
  const tokens: ByDayToken[] = [];
  for (const part of value.split(",")) {
    const match = BYDAY_TOKEN.exec(part.trim().toUpperCase());
    if (match === null) return null;
    const [, ordinal, name = ""] = match;
    const weekday = ICS_WEEKDAY_INDEX[name];
    if (weekday === undefined) return null;
    tokens.push({ ordinal: ordinal === undefined ? null : Number(ordinal), weekday });
  }
  return tokens.length > 0 ? tokens : null;
}

function strictInt(value: string): number | null {
  return /^-?\d+$/.test(value.trim()) ? Number(value.trim()) : null;
}

/** A single-integer part, or null when the part is absent; `undefined` marks a part present but unreadable, which makes the whole rule unmappable. */
function singleInt(value: string | undefined): number | null | undefined {
  if (value === undefined) return null;
  if (value.includes(",")) return undefined;
  const parsed = strictInt(value);
  return parsed === null ? undefined : parsed;
}

/** Everything about the anchor an RRULE's defaults borrow: §3.3.10 fills a missing BY-part from `DTSTART`. */
interface RruleAnchor {
  day: DayKey;
  weekday: RecurrenceWeekday;
  monthDay: number;
  month: number;
  /** `"HHMMSS"` for a timed series, null for an all-day one — what an UNTIL instant's time of day is measured against. */
  startTime: string | null;
}

const NO_PARAMS: ReadonlyMap<string, string> = new Map();

/**
 * An UNTIL value's inclusive last DAY. The rule model's `until` is a whole
 * day, so an instant-formed UNTIL keeps its day only when its time of day
 * still admits the series' own occurrence — one earlier ends the series the
 * day before, which is what the instant actually said. A UTC UNTIL converts
 * like any UTC instant first.
 */
function untilDay(raw: string, startTime: string | null): DayKey | null {
  const outcome = readMoment(raw, NO_PARAMS);
  if (!outcome.ok) return null;
  const { day, time } = outcome.moment;
  if (time === null || startTime === null) return day;
  return time < startTime ? shiftDayKey(day, -1) : day;
}

/**
 * One RRULE into the six shapes, or null for a rule that outgrows them —
 * BYSETPOS beyond one ordinal, BYMONTHDAY lists, WKST games at a phased
 * interval, HOURLY/MINUTELY, a part this mapping has no reading of. The built
 * candidate goes through `validateRecurrenceRule` LAST, so every bound the
 * engine enforces (intervals, counts, ordinals, real UNTIL days) is enforced
 * here by the same code, and what comes back is the canonical rule.
 */
function mapRrule(value: string, anchor: RruleAnchor): RecurrenceRule | null {
  const parts = new Map<string, string>();
  for (const piece of value.split(";")) {
    const equals = piece.indexOf("=");
    if (equals <= 0) return null;
    const key = piece.slice(0, equals).toUpperCase();
    if (parts.has(key) || !KNOWN_RRULE_PARTS.has(key)) return null;
    parts.set(key, piece.slice(equals + 1));
  }

  const intervalPart = singleInt(parts.get("INTERVAL"));
  if (intervalPart === undefined) return null;
  const interval = intervalPart ?? 1;

  const frequency = parts.get("FREQ")?.trim().toUpperCase();
  const byDayRaw = parts.get("BYDAY");
  const byDay = byDayRaw === undefined ? null : parseByDay(byDayRaw);
  if (byDayRaw !== undefined && byDay === null) return null;
  const byMonthDay = singleInt(parts.get("BYMONTHDAY"));
  const byMonth = singleInt(parts.get("BYMONTH"));
  const bySetPos = singleInt(parts.get("BYSETPOS"));
  if (byMonthDay === undefined || byMonth === undefined || bySetPos === undefined) return null;

  // WKST phases nothing the six shapes express except a week-counted interval,
  // where a non-Monday start would shift which weeks fire.
  const weekStart = parts.get("WKST")?.trim().toUpperCase() ?? "MO";
  if (weekStart !== "MO" && frequency === "WEEKLY" && interval > 1) return null;

  let freq: unknown;
  switch (frequency) {
    case "DAILY": {
      if (byDay !== null || byMonthDay !== null || byMonth !== null || bySetPos !== null) return null;
      freq = { kind: "daily", interval };
      break;
    }
    case "WEEKLY": {
      if (byMonthDay !== null || byMonth !== null || bySetPos !== null) return null;
      if (byDay !== null && byDay.some((token) => token.ordinal !== null)) return null;
      // Deduplicated and sorted HERE, not left to the validator: the validator
      // REFUSES a duplicated weekday, and a file writing `FR,WE,FR` means the
      // two days, not an error.
      const days =
        byDay === null
          ? [anchor.weekday]
          : [...new Set(byDay.map((token) => token.weekday))].sort((a, b) => a - b);
      freq = { kind: "weekly", interval, days };
      break;
    }
    case "MONTHLY": {
      if (byMonth !== null) return null;
      if (byMonthDay !== null) {
        if (byDay !== null || bySetPos !== null) return null;
        freq = { kind: "monthly-date", interval, day: byMonthDay };
        break;
      }
      if (byDay !== null) {
        const token = byDay.length === 1 ? byDay[0] : undefined;
        if (token === undefined) return null;
        const ordinal = token.ordinal ?? bySetPos;
        if (ordinal === null || (token.ordinal !== null && bySetPos !== null)) return null;
        freq = { kind: "monthly-ordinal", interval, ordinal, weekday: token.weekday };
        break;
      }
      if (bySetPos !== null) return null;
      freq = { kind: "monthly-date", interval, day: anchor.monthDay };
      break;
    }
    case "YEARLY": {
      if (byDay !== null || bySetPos !== null) return null;
      // A YEARLY that restates the anchor's own month and day is the same
      // series; one that names any OTHER month or day is not expressible.
      if (byMonth !== null && byMonth !== anchor.month) return null;
      if (byMonthDay !== null && byMonthDay !== anchor.monthDay) return null;
      freq = { kind: "yearly", interval };
      break;
    }
    default:
      return null;
  }

  const countRaw = parts.get("COUNT");
  const untilRaw = parts.get("UNTIL");
  if (countRaw !== undefined && untilRaw !== undefined) return null;
  let end: unknown = { kind: "never" };
  if (countRaw !== undefined) {
    const total = strictInt(countRaw);
    if (total === null) return null;
    end = { kind: "count", total };
  } else if (untilRaw !== undefined) {
    const date = untilDay(untilRaw, anchor.startTime);
    if (date === null) return null;
    end = { kind: "until", date };
  }

  const rule = validateRecurrenceRule({ freq, end });
  if (rule === null) return null;
  // The workweek at interval 1 IS the weekdays shape — and the exact RRULE the
  // exporter writes for it, so the collapse is what makes the round trip land.
  if (
    rule.freq.kind === "weekly" &&
    rule.freq.interval === 1 &&
    rule.freq.days.join(",") === "0,1,2,3,4"
  ) {
    return { freq: { kind: "weekdays" }, end: rule.end };
  }
  return rule;
}

// --- The parse ---------------------------------------------------------------

/** Collects skips by code, so the report is a set of named lines rather than a running commentary — the `.apkg` translator's own ledger. */
class SkipLedger {
  private readonly counts = new Map<IcsImportSkipCode, number>();

  add(code: IcsImportSkipCode, count = 1): void {
    if (count <= 0) return;
    this.counts.set(code, (this.counts.get(code) ?? 0) + count);
  }

  toReport(): IcsImportSkip[] {
    return ICS_IMPORT_SKIP_CODES.filter((code) => (this.counts.get(code) ?? 0) > 0).map((code) => ({
      code,
      count: this.counts.get(code) ?? 0,
    }));
  }
}

/** One VEVENT's lines as collected: single-valued properties first-wins (§3.8 allows each once; a duplicate is the file's error, not a choice), EXDATE accumulating because the RFC lets it repeat. */
interface RawVevent {
  props: Map<string, ContentLine>;
  exdates: ContentLine[];
}

/** The end as `endAt`, or null for a point event. Every unusable end is COUNTED (`invalid-end`) and the event still imports — losing a duration is a trim, not a reason to lose the appointment. */
function resolveEnd(
  start: WallMoment,
  dtend: ContentLine | undefined,
  duration: ContentLine | undefined,
  ledger: SkipLedger,
): string | null {
  if (start.time === null) {
    if (dtend !== undefined) {
      const end = readMoment(dtend.value, dtend.params);
      if (!end.ok || end.moment.day <= start.day) {
        ledger.add("invalid-end");
        return null;
      }
      // §3.8.2.2's DTEND is EXCLUSIVE; the stored end is the inclusive last
      // day, and a single-day span stores no end at all.
      const lastDay = shiftDayKey(end.moment.day, -1);
      return lastDay > start.day ? lastDay : null;
    }
    if (duration !== undefined) {
      const ms = readDurationMs(duration.value);
      if (ms === null) {
        ledger.add("invalid-end");
        return null;
      }
      const days = Math.floor(ms / 86_400_000);
      return days > 1 ? shiftDayKey(start.day, days - 1) : null;
    }
    return null;
  }

  if (dtend !== undefined) {
    const end = readMoment(dtend.value, dtend.params);
    if (!end.ok || end.moment.time === null) {
      ledger.add("invalid-end");
      return null;
    }
    const startMs = wallToMs(start);
    const endMs = wallToMs(end.moment);
    if (endMs < startMs) {
      ledger.add("invalid-end");
      return null;
    }
    // Equal to the start is a point event by the decision's own reading — not
    // an error, so not a count.
    return endMs > startMs ? momentToStored(end.moment) : null;
  }
  if (duration !== undefined) {
    const ms = readDurationMs(duration.value);
    if (ms === null) {
      ledger.add("invalid-end");
      return null;
    }
    if (ms === 0) return null;
    const end = msToWall(wallToMs(start) + ms);
    if (end === null) {
      ledger.add("invalid-end");
      return null;
    }
    return momentToStored(end);
  }
  return null;
}

/** Every EXDATE value as a bare day, ascending and duplicate-free; each unreadable value is counted and the readable rest kept. */
function readExdates(lines: readonly ContentLine[], ledger: SkipLedger): string[] {
  const days = new Set<string>();
  for (const line of lines) {
    for (const value of line.value.split(",")) {
      if (value.trim().length === 0) continue;
      const outcome = readMoment(value, line.params);
      if (!outcome.ok) {
        ledger.add("invalid-exdate");
        continue;
      }
      days.add(outcome.moment.day);
    }
  }
  return [...days].sort();
}

/** Monday-first weekday of a day key — the recurrence engine's own indexing. */
function weekdayOf(day: DayKey): RecurrenceWeekday {
  return (((new Date(dayKeyToUtcMs(day)).getUTCDay() + 6) % 7)) as RecurrenceWeekday;
}

/** One collected VEVENT as a parsed event, or null when a refusal (already counted) keeps it out. */
function buildEvent(raw: RawVevent, ledger: SkipLedger): IcsParsedEvent | null {
  const summary = raw.props.get("SUMMARY");
  const title = summary === undefined ? "" : unescapeText(summary.value).trim();
  if (title.length === 0) {
    ledger.add("empty-summary");
    return null;
  }

  const dtstart = raw.props.get("DTSTART");
  if (dtstart === undefined) {
    ledger.add("invalid-start");
    return null;
  }
  const start = readMoment(dtstart.value, dtstart.params);
  if (!start.ok) {
    ledger.add(start.reason === "unknown-timezone" ? "unknown-timezone" : "invalid-start");
    return null;
  }

  const endAt = resolveEnd(start.moment, raw.props.get("DTEND"), raw.props.get("DURATION"), ledger);

  const categories = raw.props.get("CATEGORIES");
  let category: string | null = null;
  if (categories !== undefined) {
    const values = splitTextValues(categories.value);
    category = values[0] ?? null;
    // CAL has ONE category per event; the first value arrives and the loss of
    // the rest is a counted fact, never a silent one.
    if (values.length > 1) ledger.add("categories-dropped");
  }

  let recurrence: RecurrenceRule | null = null;
  let recurrenceExdates: string[] = [];
  const rrule = raw.props.get("RRULE");
  if (raw.props.has("RECURRENCE-ID")) {
    // A detached override is one reshaped occurrence of somebody else's
    // series. Nexus's series have no per-occurrence overrides, so it arrives
    // as its own one-off — the occurrence is kept, the series membership is
    // the counted loss. Any RRULE riding on it describes the master, not this
    // row, and is not read.
    ledger.add("detached-override");
  } else if (rrule !== undefined) {
    const anchor: RruleAnchor = {
      day: start.moment.day,
      weekday: weekdayOf(start.moment.day),
      monthDay: Number(start.moment.day.slice(8, 10)),
      month: Number(start.moment.day.slice(5, 7)),
      startTime: start.moment.time,
    };
    recurrence = mapRrule(rrule.value, anchor);
    if (recurrence === null) {
      // The master imports as a ONE-OFF — see the module header. Its EXDATEs
      // fall with the series; the one count covers the whole trim.
      ledger.add("recurrence-unmappable");
    } else {
      recurrenceExdates = readExdates(raw.exdates, ledger);
    }
  }
  // An EXDATE without a series excludes nothing and is dropped without a
  // count — there is no occurrence it could have removed.

  return {
    title,
    description: textOrNull(raw.props.get("DESCRIPTION")),
    startAt: momentToStored(start.moment),
    endAt,
    allDay: start.moment.time === null,
    location: textOrNull(raw.props.get("LOCATION")),
    category,
    recurrence,
    recurrenceExdates,
  };
}

/**
 * One `.ics` text as parsed events and an honest account of everything that
 * did not survive the reading. The walk is deliberately lenient about
 * STRUCTURE — a stray END is passed over, an event still open at end of file
 * is finished — because a half-damaged calendar losing its readable events
 * over a bracket would be the wrong trade; only text with no `VCALENDAR` at
 * all is refused whole.
 */
export function parseIcsCalendar(text: string): IcsParseResult {
  const lines = unfoldContentLines(text);
  const ledger = new SkipLedger();
  const componentCounts = new Map<string, number>();
  const events: IcsParsedEvent[] = [];
  let sourceEvents = 0;
  let sawCalendar = false;
  let inCalendar = false;
  let current: RawVevent | null = null;
  /** Depth inside a counted, skipped component — its own nested components belong to it and are not counted again. */
  let skipDepth = 0;

  const finish = (raw: RawVevent): void => {
    const event = buildEvent(raw, ledger);
    if (event !== null) events.push(event);
  };

  for (const line of lines) {
    if (skipDepth > 0) {
      if (line.name === "BEGIN") skipDepth += 1;
      else if (line.name === "END") skipDepth -= 1;
      continue;
    }
    if (line.name === "BEGIN") {
      const component = line.value.trim().toUpperCase();
      if (!inCalendar) {
        if (component === "VCALENDAR") {
          sawCalendar = true;
          inCalendar = true;
        }
        continue;
      }
      if (current === null && component === "VEVENT") {
        sourceEvents += 1;
        current = { props: new Map(), exdates: [] };
        continue;
      }
      componentCounts.set(component, (componentCounts.get(component) ?? 0) + 1);
      skipDepth = 1;
      continue;
    }
    if (line.name === "END") {
      const component = line.value.trim().toUpperCase();
      if (current !== null && component === "VEVENT") {
        finish(current);
        current = null;
      } else if (current === null && component === "VCALENDAR") {
        inCalendar = false;
      }
      continue;
    }
    if (current !== null) {
      if (line.name === "EXDATE") {
        current.exdates.push(line);
        continue;
      }
      if (!current.props.has(line.name)) current.props.set(line.name, line);
    }
  }
  if (current !== null) finish(current);

  if (!sawCalendar) return { status: "failed", code: "not-a-calendar" };

  return {
    status: "ok",
    calendar: {
      sourceEvents,
      events,
      components: [...componentCounts].map(([name, count]) => ({ name, count })),
      skips: ledger.toReport(),
    },
  };
}

// --- Translation -------------------------------------------------------------

export interface IcsTranslateTarget {
  /** The profile every row is stamped with — never anything of the file's, because an `.ics` has none. */
  profileId: string;
  /** ISO-8601, injected: this module reads no clock. Every row's `createdAt`/`updatedAt`. */
  now: string;
}

/**
 * Parsed events as the profile data an import inserts. The shape of the answer
 * is deliberately narrow, exactly as `translateApkg`'s is: an `.ics` carries
 * events and NOTHING else this app models, so every other member of
 * `ProfileData` is planned empty. Written as one object literal typed
 * `ProfileData` for the reason `planForeignImport`'s pass 2 is — a member
 * added to that interface later fails to compile here rather than silently
 * arriving absent.
 *
 * `reminderOffsets` is the empty default on every row — the named asymmetry of
 * the round trip: a reminder ladder does not travel in ICS, so an imported
 * event starts without one, exactly as a hand-made event does.
 */
export function translateIcsEvents(
  calendar: IcsParsedCalendar,
  target: IcsTranslateTarget,
): ProfileData {
  const events: ExportEvent[] = calendar.events.map((event, index) => ({
    id: `ics:event:${index}`,
    profileId: target.profileId,
    title: event.title,
    description: event.description,
    startAt: event.startAt,
    endAt: event.endAt,
    allDay: event.allDay,
    location: event.location,
    category: event.category,
    createdAt: target.now,
    updatedAt: target.now,
    recurrence: event.recurrence,
    recurrenceExdates: [...event.recurrenceExdates],
    reminderOffsets: [],
  }));

  return {
    tasks: [],
    taskLists: [],
    taskSections: [],
    taskTags: [],
    taskTagLinks: [],
    taskAttachments: [],
    taskTemplates: [],
    taskDependencies: [],
    events,
    eventTemplates: [],
    documents: [],
    renewals: [],
    people: [],
    calendarSettings: [],
    subjects: [],
    subjectAttachments: [],
    subjectNoteLinks: [],
    exams: [],
    decks: [],
    cards: [],
    reviewLog: [],
    examTopics: [],
    plans: [],
    blocks: [],
    focusSessions: [],
    studySettings: [],
    notifications: [],
    notes: [],
    noteFolders: [],
    noteTags: [],
    noteCategories: [],
    noteTagLinks: [],
    noteTemplates: [],
    noteAttachments: [],
    noteVersions: [],
    dashboardSettings: [],
    dashboardSets: [],
    dashboardWidgets: [],
    // An .ics calendar carries no ledger (migration 051): empty, like every
    // other module this importer does not read.
    finAccounts: [],
    finCategories: [],
    finRecurring: [],
    finTransactions: [],
    finBudgets: [],
    // Nor any habits (migration 055): empty, like every other module this
    // importer does not read.
    habits: [],
    habitEntries: [],
  };
}
