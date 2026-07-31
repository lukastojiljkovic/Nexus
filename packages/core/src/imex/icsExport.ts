/**
 * Pure RFC 5545 (iCalendar) writer for the Nexus calendar — the export half of
 * CAL-008, and the "ICS for calendar" clause IMEX-001 always carried. Hand-rolled
 * rather than taken from a dependency: the format is line-oriented text, and the
 * three things that actually go wrong in it (CRLF, 75-octet folding, TEXT
 * escaping) are each a handful of lines here and each pinned by its own test.
 *
 * Platform-neutral and deterministic, exactly like `buildExportArchive` beside
 * it: no clock read (`options.now` is stamped by the caller and becomes every
 * `DTSTAMP`), no IO, no `node:` imports, and a stable event order — so a test
 * can pin a whole file and two runs over the same profile produce identical
 * bytes. Row shapes are declared as a minimal structural interface (`IcsEvent`)
 * for the reason `exportArchive.ts`'s are: `@nexus/core` must not import
 * `@nexus/db`, and the caller's real `Event`/`ExportEvent` rows satisfy this
 * without adapting.
 *
 * Four decisions a reader would otherwise have to reverse-engineer:
 *
 *  - **Timed events are written as FLOATING local date-times** — `DTSTART:
 *    20260715T093000`, no `Z` and no `TZID`. This is not a shortcut, it is what
 *    the data actually is: Nexus stores a timed start as a zone-less wall-clock
 *    string (`"2026-07-15T09:30"`), and every other module reads it that way
 *    (`startAt.slice(11, 16)`), for the reason `calendarGrid.ts` states — the
 *    app's dates are wall-clock strings with no timezone to convert *from*.
 *    RFC 5545 §3.3.5's form 1 means precisely "this wall clock, in whatever
 *    zone the reader is in", so floating is the lossless mapping and needs no
 *    guess. Converting to a UTC instant would require inventing an offset, and
 *    inventing Europe/Belgrade would move every exported meeting for anyone who
 *    opened the file anywhere else.
 *
 *  - **All-day events use `VALUE=DATE` with an EXCLUSIVE `DTEND`** (RFC 5545
 *    §3.8.2.2). Nexus stores the INCLUSIVE last day (`calendarItems.ts` spans
 *    `startKey..endKey`), so the exclusive end is that day plus one, and a
 *    single-day event ends on the following day.
 *
 *  - **`DTSTAMP` is the only UTC value in the file**, because the RFC requires
 *    it to be one. It is the moment the export was taken, not a property of any
 *    event, so there is nothing wall-clock about it.
 *
 *  - **An anchor the rule does not place an occurrence on is EXDATE'd.** The
 *    recurrence engine treats the anchor like any other candidate (a weekly
 *    Mon-only rule anchored on a Wednesday simply opens later), while every ICS
 *    consumer shows `DTSTART` as an instance of the series. Excluding that one
 *    day outright is what makes the exported series the same series Nexus
 *    shows, rather than the same series plus a phantom first occurrence.
 *
 * A rule that could not be expressed as an `RRULE` would be refused by name in
 * `skipped` rather than written as something it is not; all six `RecurrenceFreq`
 * kinds do map, so today the only refusal is a start date that is not a real
 * calendar day at all.
 */

import { isValidDayKey, shiftDayKey, type DayKey } from "../calendar/calendarGrid.js";
import { occurrenceDatesInRange } from "../recurrence/recurrence.js";
import type { RecurrenceEnd, RecurrenceFreq, RecurrenceRule, RecurrenceWeekday } from "../recurrence/recurrence.js";

/**
 * The event fields this writer reads — a structural subset of `ExportEvent`
 * (and of `@nexus/db`'s `Event`), so either satisfies it as-is. Everything a
 * calendar file cannot carry — the profile scope, the row's own timestamps, the
 * reminder ladder — is deliberately absent rather than optional.
 */
export interface IcsEvent {
  id: string;
  title: string;
  description: string | null;
  /** `"YYYY-MM-DD"` for an all-day event, `"YYYY-MM-DDTHH:MM[:SS]"` (zone-less wall clock) for a timed one. */
  startAt: string;
  /** The INCLUSIVE last day of an all-day span, the end instant of a timed one, or null. */
  endAt: string | null;
  allDay: boolean;
  location: string | null;
  category: string | null;
  recurrence: RecurrenceRule | null;
  /** Bare `YYYY-MM-DD` occurrence dates removed from the series, in any order. */
  recurrenceExdates: readonly string[];
}

export interface IcsCalendarOptions {
  /** ISO-8601 instant, stamped by the caller — this module never reads a clock. Becomes every `DTSTAMP`. */
  now: string;
}

/** Why an event produced no `VEVENT`. A union of one today; a rule variant that outgrew `RRULE` would land here rather than be written as a lie. */
export type IcsSkipReason = "invalid-start";

export interface IcsSkippedEvent {
  id: string;
  reason: IcsSkipReason;
}

export interface IcsCalendar {
  /** The whole `.ics` file, CRLF-terminated. */
  text: string;
  /** Events that could not be written, by id — never silently dropped. */
  skipped: IcsSkippedEvent[];
}

const CRLF = "\r\n";
/** RFC 5545 §3.1: a content line SHOULD NOT exceed 75 octets, excluding the line break. */
const MAX_LINE_OCTETS = 75;
const PRODID = "-//Nexus//Nexus Desktop//SR";
/** The `UID` suffix: the app's own `appId` (`rs.stojiljkovic.nexus`) read as a domain, so a Nexus uid is globally unique without naming a host that must exist. */
const UID_DOMAIN = "nexus.stojiljkovic.rs";

/** Monday-first, exactly as `RecurrenceWeekday` is indexed. */
const ICS_WEEKDAY: Record<RecurrenceWeekday, string> = {
  0: "MO", 1: "TU", 2: "WE", 3: "TH", 4: "FR", 5: "SA", 6: "SU",
};

/**
 * One `DTSTART`/`DTEND`/`EXDATE` value in the two forms this file uses: a bare
 * DATE (`time === null`) or a floating local DATE-TIME. The pair is carried
 * around together because the RFC ties the value types of a `VEVENT`'s date
 * properties — and of its `UNTIL` — to `DTSTART`'s.
 */
interface IcsMoment {
  day: DayKey;
  /** `"HHMMSS"`, or null when this is a DATE. */
  time: string | null;
}

/** `"2026-07-15"` -> `"20260715"`. */
function compactDay(day: DayKey): string {
  return day.replace(/-/g, "");
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

/** The caller's `now` as the UTC date-time `DTSTAMP` must be. Throws on a value that is not an instant — a programmer error, exactly as the recurrence engine treats a malformed day key. */
function utcStamp(now: string): string {
  const ms = Date.parse(now);
  if (!Number.isFinite(ms)) throw new TypeError(`Invalid ICS timestamp: ${now}`);
  const at = new Date(ms);
  return (
    `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1, 2)}${pad(at.getUTCDate(), 2)}` +
    `T${pad(at.getUTCHours(), 2)}${pad(at.getUTCMinutes(), 2)}${pad(at.getUTCSeconds(), 2)}Z`
  );
}

// --- Reading the stored strings --------------------------------------------

/** `YYYY-MM-DD` followed by a time of day; the separator is `T` or a space, matching what `EventStore` accepts. */
const TIMED_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

function parseDay(value: string): IcsMoment | null {
  const day = value.slice(0, 10);
  return isValidDayKey(day) ? { day, time: null } : null;
}

function parseTimed(value: string): IcsMoment | null {
  const match = TIMED_PATTERN.exec(value);
  if (match === null) return null;
  const [, day = "", hours = "", minutes = "", seconds = "00"] = match;
  if (!isValidDayKey(day)) return null;
  if (Number(hours) > 23 || Number(minutes) > 59 || Number(seconds) > 59) return null;
  return { day, time: `${hours}${minutes}${seconds}` };
}

/**
 * The event's start as a value the file can carry. A row flagged `allDay` is a
 * DATE; a timed row is a DATE-TIME — unless it carries no time of day at all
 * (which `EventStore` permits), in which case it is read as the DATE it
 * actually is rather than refused over a clock it never had.
 */
function parseStart(event: IcsEvent): IcsMoment | null {
  return (event.allDay ? null : parseTimed(event.startAt)) ?? parseDay(event.startAt);
}

/** Ascending order over two moments of the same value type. */
function isAfter(later: IcsMoment, earlier: IcsMoment): boolean {
  if (later.day !== earlier.day) return later.day > earlier.day;
  return (later.time ?? "") > (earlier.time ?? "");
}

/**
 * The event's `DTEND`, or null when there is none to write. An all-day event
 * always has one — the day after its inclusive last day, which is its own day
 * when `endAt` is missing or unusable. A timed event's end is written only when
 * it is strictly later than the start, as §3.8.2.2 requires; anything else
 * (absent, malformed, not after the start) simply leaves the property out,
 * which the RFC reads as an event that takes up no time.
 */
function eventEnd(event: IcsEvent, start: IcsMoment): IcsMoment | null {
  if (start.time === null) {
    const parsed = event.endAt !== null ? parseDay(event.endAt) : null;
    const lastDay = parsed !== null && parsed.day > start.day ? parsed.day : start.day;
    return { day: shiftDayKey(lastDay, 1), time: null };
  }
  if (event.endAt === null) return null;
  const end = parseTimed(event.endAt);
  return end !== null && isAfter(end, start) ? end : null;
}

// --- Property text ----------------------------------------------------------

/** Exactly the octets RFC 5545's TEXT grammar excludes: the C0 controls other than HTAB, plus DEL. */
// eslint-disable-next-line no-control-regex -- the character class IS the point of this constant.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * RFC 5545 §3.3.11: a TEXT value escapes backslash, semicolon and comma, and
 * carries a line break as a literal `\n`. Backslash goes first, or the escapes
 * added after it would themselves be escaped. Control characters are dropped
 * last — after the newlines they might otherwise have swallowed have already
 * become `\n`.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|[\r\n]/g, "\\n")
    .replace(CONTROL_CHARACTERS, "");
}

/** How many UTF-8 octets one code point costs — the unit the fold limit is actually measured in. */
function octetsOf(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * RFC 5545 §3.1 folding: break a long content line into pieces of at most 75
 * OCTETS, each continuation beginning with a single space (which counts toward
 * its own 75). Iteration is by code point — `for…of` over a string yields whole
 * surrogate pairs — so a fold never lands inside a character, which is the
 * failure a naive byte-slice produces the moment a summary is written in
 * Serbian.
 */
function foldLine(line: string): string {
  const pieces: string[] = [];
  let current = "";
  let used = 0;
  let budget = MAX_LINE_OCTETS;
  for (const character of line) {
    const size = octetsOf(character.codePointAt(0) ?? 0);
    if (used + size > budget) {
      pieces.push(current);
      current = "";
      used = 0;
      budget = MAX_LINE_OCTETS - 1; // the continuation's leading space
    }
    current += character;
    used += size;
  }
  pieces.push(current);
  return pieces.join(`${CRLF} `);
}

/** `NAME:value` or `NAME;PARAM:value`. */
function property(name: string, value: string, parameters?: string): string {
  return parameters === undefined ? `${name}:${value}` : `${name};${parameters}:${value}`;
}

/** A DATE property carries its value type; a DATE-TIME is the default and says nothing. */
function momentProperty(name: string, values: readonly string[], kind: IcsMoment): string {
  const joined = values.join(",");
  return kind.time === null ? property(name, joined, "VALUE=DATE") : property(name, joined);
}

/** One moment's own value text: `20260715` or `20260715T093000`. */
function momentValue(moment: IcsMoment): string {
  return moment.time === null ? compactDay(moment.day) : `${compactDay(moment.day)}T${moment.time}`;
}

// --- RRULE ------------------------------------------------------------------

function intervalPart(interval: number): string[] {
  return interval > 1 ? [`INTERVAL=${interval}`] : [];
}

/** Ascending and duplicate-free, matching `serializeRecurrenceRule`'s canonical order, so the same rule always writes the same BYDAY. */
function byDayList(days: readonly RecurrenceWeekday[]): string {
  return [...new Set(days)]
    .sort((a, b) => a - b)
    .map((day) => ICS_WEEKDAY[day])
    .join(",");
}

/**
 * The `FREQ`/`INTERVAL`/`BY…` parts of one rule. Every kind maps exactly:
 * `yearly` and `monthly-date`'s skip-never-clamp behaviour is the RFC's own
 * ("recurrence instances with an invalid date MUST be ignored"), and Nexus's
 * Monday-first weeks match `WKST`'s default of `MO`, so neither needs saying.
 */
function freqParts(freq: RecurrenceFreq): string[] {
  switch (freq.kind) {
    case "daily":
      return ["FREQ=DAILY", ...intervalPart(freq.interval)];
    case "weekdays":
      return ["FREQ=WEEKLY", "BYDAY=MO,TU,WE,TH,FR"];
    case "weekly":
      return ["FREQ=WEEKLY", ...intervalPart(freq.interval), `BYDAY=${byDayList(freq.days)}`];
    case "monthly-date":
      return ["FREQ=MONTHLY", ...intervalPart(freq.interval), `BYMONTHDAY=${freq.day}`];
    case "monthly-ordinal":
      return [
        "FREQ=MONTHLY",
        ...intervalPart(freq.interval),
        `BYDAY=${freq.ordinal}${ICS_WEEKDAY[freq.weekday]}`,
      ];
    case "yearly":
      return ["FREQ=YEARLY", ...intervalPart(freq.interval)];
  }
}

/**
 * The rule's end. §3.3.10 ties `UNTIL`'s value type to `DTSTART`'s: a DATE
 * start ends on a DATE, and a floating date-time start ends on a floating
 * date-time — at `235959`, because the rule model's `until` is an inclusive
 * DAY and an occurrence anywhere in it still happens.
 */
function endParts(end: RecurrenceEnd, start: IcsMoment): string[] {
  switch (end.kind) {
    case "never":
      return [];
    case "count":
      return [`COUNT=${end.total}`];
    case "until":
      if (!isValidDayKey(end.date)) return [];
      return [`UNTIL=${start.time === null ? compactDay(end.date) : `${compactDay(end.date)}T235959`}`];
  }
}

/**
 * Every excluded occurrence, as values of `DTSTART`'s own type: the row's own
 * exdates (real calendar days only), plus `DTSTART`'s day when the rule does
 * not actually place an occurrence there — see this file's header on why. A
 * timed series' exclusions happen at the series' time of day, which is the only
 * time any of its occurrences ever has.
 */
function exdateValues(event: IcsEvent, rule: RecurrenceRule, start: IcsMoment): string[] {
  const days = new Set(event.recurrenceExdates.filter((day) => isValidDayKey(day)));
  // The probe asks about the PATTERN only, so the rule's end is neutralised
  // first: "does the anchor's own day match?" is a question `freq` answers
  // alone, and a rule that ends before its anchor would otherwise report an
  // empty series and earn a meaningless exclusion.
  const pattern: RecurrenceRule = { freq: rule.freq, end: { kind: "never" } };
  if (occurrenceDatesInRange(pattern, start.day, { from: start.day, to: start.day }, undefined, 1).length === 0) {
    days.add(start.day);
  }
  return [...days].sort().map((day) => momentValue({ day, time: start.time }));
}

// --- Assembly ---------------------------------------------------------------

/** A TEXT property, emitted only when there is something to say. */
function textProperty(name: string, value: string | null): string[] {
  if (value === null || value.trim().length === 0) return [];
  return [property(name, escapeText(value))];
}

function vevent(event: IcsEvent, start: IcsMoment, dtstamp: string): string[] {
  const end = eventEnd(event, start);
  const out = [
    "BEGIN:VEVENT",
    property("UID", `${escapeText(event.id)}@${UID_DOMAIN}`),
    property("DTSTAMP", dtstamp),
    momentProperty("DTSTART", [momentValue(start)], start),
    ...(end === null ? [] : [momentProperty("DTEND", [momentValue(end)], end)]),
    property("SUMMARY", escapeText(event.title)),
    ...textProperty("DESCRIPTION", event.description),
    ...textProperty("LOCATION", event.location),
    ...textProperty("CATEGORIES", event.category),
  ];
  if (event.recurrence !== null) {
    const rule = event.recurrence;
    out.push(property("RRULE", [...freqParts(rule.freq), ...endParts(rule.end, start)].join(";")));
    const exdates = exdateValues(event, rule, start);
    if (exdates.length > 0) out.push(momentProperty("EXDATE", exdates, start));
  }
  out.push("END:VEVENT");
  return out;
}

/** Start then id, both as plain string comparisons — these are ISO strings and uuids, not text a reader sorts by language. */
function compareEvents(a: IcsEvent, b: IcsEvent): number {
  if (a.startAt !== b.startAt) return a.startAt < b.startAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * One profile's events as an RFC 5545 calendar (CAL-008 / IMEX-001). Used twice
 * over the exact same code path: by the standalone „Izvezi kalendar“ action, and
 * by `buildExportArchive`, which drops the result into the archive as
 * `data/calendar.ics`.
 */
export function buildIcsCalendar(
  events: readonly IcsEvent[],
  options: IcsCalendarOptions,
): IcsCalendar {
  const dtstamp = utcStamp(options.now);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", property("PRODID", PRODID), "CALSCALE:GREGORIAN"];
  const skipped: IcsSkippedEvent[] = [];

  for (const event of [...events].sort(compareEvents)) {
    const start = parseStart(event);
    if (start === null) {
      skipped.push({ id: event.id, reason: "invalid-start" });
      continue;
    }
    lines.push(...vevent(event, start, dtstamp));
  }

  lines.push("END:VCALENDAR");
  return { text: `${lines.map(foldLine).join(CRLF)}${CRLF}`, skipped };
}
