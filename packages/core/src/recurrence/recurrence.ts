/**
 * Pure recurrence engine: one rule language shared by recurring tasks (which
 * advance their own due date in place on completion) and recurring events (one
 * master row the calendar expands virtually). Nothing here knows about either —
 * it turns a rule plus an anchor date into bare dates, and nothing else.
 *
 * Three decisions a reader would otherwise have to reverse-engineer:
 *  - Every date is a bare "YYYY-MM-DD" `DayKey`, parsed and formatted by the
 *    calendar grid's own UTC helpers. The app's dates are zone-less wall-clock
 *    strings, so there is nothing to convert *from*; local-time `Date`
 *    semantics would shift a whole series by a day west of Greenwich.
 *  - Phase is measured from the **anchor**, never from the calendar. "Every 2
 *    weeks" means every second week counting from the anchor's own
 *    Monday-started week (the convention `monthGridDays(…, 1)` lays out), so
 *    moving a series' first date moves the entire series with it.
 *  - A period that cannot hold the pattern is **skipped, never clamped** (RFC
 *    5545 / Google semantics): "the 31st" simply does not happen in April, and
 *    a Feb-29 yearly series only fires in leap years.
 *
 * The anchor is treated like any other candidate: it is an occurrence only when
 * it matches the rule's own pattern. Callers normally anchor a series at its
 * first real date, but a weekly rule anchored on a day outside `days` — or a
 * monthly rule anchored in a month lacking its day — simply opens later.
 *
 * `anchor`, `after` and the range bounds are trusted the way `calendarGrid`
 * trusts its inputs: malformed ones are a programmer error and throw
 * `TypeError`. Untrusted values reach here only through
 * `validateRecurrenceRule` and the IPC/store validators above it.
 */

import { dayKeyToUtcMs, isValidDayKey, utcMsToDayKey, type DayKey } from "../calendar/calendarGrid.js";

/** Weekday index, 0 = Monday … 6 = Sunday — Monday-first, as everything Serbian in Nexus is. */
export type RecurrenceWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Which occurrence of a weekday inside a month; `-1` is the last one. */
export type RecurrenceOrdinal = 1 | 2 | 3 | 4 | -1;

export type RecurrenceFreq =
  /** Every `interval` days from the anchor. */
  | { kind: "daily"; interval: number }
  /** Every Monday–Friday from the anchor; no interval to phase. */
  | { kind: "weekdays" }
  /** Every `interval` weeks from the anchor's week, on the listed weekdays. */
  | { kind: "weekly"; interval: number; days: RecurrenceWeekday[] }
  /** Every `interval` months from the anchor's month, on day 1–31; months without the day are skipped. */
  | { kind: "monthly-date"; interval: number; day: number }
  /** Every `interval` months from the anchor's month, on e.g. the 2nd Tuesday (`-1` = the last one). */
  | { kind: "monthly-ordinal"; interval: number; ordinal: RecurrenceOrdinal; weekday: RecurrenceWeekday }
  /** The anchor's month and day, every `interval` years; a Feb-29 anchor only fires in leap years. */
  | { kind: "yearly"; interval: number };

export type RecurrenceEnd =
  | { kind: "never" }
  /** Inclusive: an occurrence falling exactly on `date` still happens. */
  | { kind: "until"; date: DayKey }
  /** Total occurrences INCLUDING the anchor-side first one. */
  | { kind: "count"; total: number };

export interface RecurrenceRule {
  freq: RecurrenceFreq;
  end: RecurrenceEnd;
}

/** Upper bound on any `interval` — a rule is a habit, not an epoch calculator. */
export const MAX_RECURRENCE_INTERVAL = 99;
/** Upper bound on `end.count.total`; also what bounds a count-terminated scan. */
export const MAX_RECURRENCE_COUNT = 999;
/** `occurrenceDatesInRange`'s default result cap. */
export const DEFAULT_OCCURRENCE_LIMIT = 1000;

const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;
const MONTHS_PER_YEAR = 12;
const MIN_MONTH_DAY = 1;
const MAX_MONTH_DAY = 31;
const WORKWEEK: readonly RecurrenceWeekday[] = [0, 1, 2, 3, 4];

/**
 * Safety bound on how many *periods* one scan may walk. Not a semantic limit:
 * the sparsest valid rule — a Feb-29 yearly series at `MAX_RECURRENCE_COUNT`
 * occurrences, one hit every four years — needs roughly 4 000 periods, and
 * every other rule needs far fewer, so no valid rule can reach this. It exists
 * so a corrupt rule that slipped past validation cannot spin forever.
 */
const MAX_SCAN_PERIODS = 10_000;

// --- Bare-date primitives ---------------------------------------------------

/** Monday-first weekday index of a UTC-midnight time; `getUTCDay()` is Sunday-first, hence the +6. */
function weekdayIndex(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % DAYS_PER_WEEK;
}

/** Day 0 of the next month is the last day of this one. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Day-of-month of the `ordinal`-th `weekday`, or null when the month is too
 * short to hold it. Only a 5th ordinal could ever be missing, and the rule
 * language has none — `-1` asks for the last one instead — but the check stays
 * so the contract reads the same as `monthly-date`'s.
 */
function ordinalWeekdayDay(
  year: number,
  month: number,
  ordinal: RecurrenceOrdinal,
  weekday: RecurrenceWeekday,
): number | null {
  const lastDay = daysInMonth(year, month);
  if (ordinal === -1) {
    const lastIndex = weekdayIndex(Date.UTC(year, month - 1, lastDay));
    return lastDay - ((lastIndex - weekday + DAYS_PER_WEEK) % DAYS_PER_WEEK);
  }
  const firstIndex = weekdayIndex(Date.UTC(year, month - 1, 1));
  const day =
    1 + ((weekday - firstIndex + DAYS_PER_WEEK) % DAYS_PER_WEEK) + (ordinal - 1) * DAYS_PER_WEEK;
  return day <= lastDay ? day : null;
}

// --- The series shapes ------------------------------------------------------

/**
 * A rule expanded into numbered *periods* — a day for `daily`, a week for
 * `weekly`/`weekdays`, a month for both monthly kinds, a year for `yearly`.
 * Period 0 always contains the anchor. Splitting it this way is what lets a
 * scan jump straight to a far-away range instead of walking there one
 * occurrence at a time.
 */
interface Series {
  /** The series' earliest possible date; anything the pattern places before it is dropped. */
  readonly anchorMs: number;
  /** UTC-midnight times the pattern places in `period`, ascending; empty when the pattern skips it. */
  datesInPeriod(period: number): number[];
  /** Lower bound: the first period that can hold a date ≥ `dayMs`. Never over-estimates — the scan filters. */
  periodAtOrAfter(dayMs: number): number;
}

function dailySeries(anchorMs: number, interval: number): Series {
  const stepMs = interval * MS_PER_DAY;
  return {
    anchorMs,
    datesInPeriod: (period) => [anchorMs + period * stepMs],
    periodAtOrAfter: (dayMs) => Math.max(0, Math.ceil((dayMs - anchorMs) / stepMs)),
  };
}

function weeklySeries(
  anchorMs: number,
  interval: number,
  days: readonly RecurrenceWeekday[],
): Series {
  // Sorted and deduplicated here too, not only in `validateRecurrenceRule`:
  // the result array's ascending order must not depend on how a caller happened
  // to build the (already typed, but not necessarily validated) rule.
  const orderedDays = canonicalDays(days);
  const week0Ms = anchorMs - weekdayIndex(anchorMs) * MS_PER_DAY;
  const stepMs = interval * DAYS_PER_WEEK * MS_PER_DAY;
  return {
    anchorMs,
    datesInPeriod: (period) => {
      const weekStartMs = week0Ms + period * stepMs;
      return orderedDays.map((day) => weekStartMs + day * MS_PER_DAY);
    },
    periodAtOrAfter: (dayMs) => {
      const weekStartMs = dayMs - weekdayIndex(dayMs) * MS_PER_DAY;
      return Math.max(0, Math.ceil((weekStartMs - week0Ms) / stepMs));
    },
  };
}

/** Both monthly kinds share their phasing and differ only in which day they pick. */
function monthlySeries(
  anchorMs: number,
  interval: number,
  dayOfMonth: (year: number, month: number) => number | null,
): Series {
  const anchor = new Date(anchorMs);
  const anchorMonth = anchor.getUTCFullYear() * MONTHS_PER_YEAR + anchor.getUTCMonth();
  return {
    anchorMs,
    datesInPeriod: (period) => {
      const absoluteMonth = anchorMonth + period * interval;
      const year = Math.floor(absoluteMonth / MONTHS_PER_YEAR);
      const month = absoluteMonth - year * MONTHS_PER_YEAR + 1; // 1-indexed
      const day = dayOfMonth(year, month);
      return day === null ? [] : [Date.UTC(year, month - 1, day)];
    },
    periodAtOrAfter: (dayMs) => {
      const date = new Date(dayMs);
      const absoluteMonth = date.getUTCFullYear() * MONTHS_PER_YEAR + date.getUTCMonth();
      return Math.max(0, Math.ceil((absoluteMonth - anchorMonth) / interval));
    },
  };
}

function yearlySeries(anchorMs: number, interval: number): Series {
  const anchor = new Date(anchorMs);
  const anchorYear = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth() + 1;
  const day = anchor.getUTCDate();
  return {
    anchorMs,
    datesInPeriod: (period) => {
      const year = anchorYear + period * interval;
      return day <= daysInMonth(year, month) ? [Date.UTC(year, month - 1, day)] : [];
    },
    periodAtOrAfter: (dayMs) =>
      Math.max(0, Math.ceil((new Date(dayMs).getUTCFullYear() - anchorYear) / interval)),
  };
}

function buildSeries(freq: RecurrenceFreq, anchorMs: number): Series {
  switch (freq.kind) {
    case "daily":
      return dailySeries(anchorMs, freq.interval);
    case "weekdays":
      return weeklySeries(anchorMs, 1, WORKWEEK);
    case "weekly":
      return weeklySeries(anchorMs, freq.interval, freq.days);
    case "monthly-date":
      return monthlySeries(anchorMs, freq.interval, (year, month) =>
        freq.day <= daysInMonth(year, month) ? freq.day : null,
      );
    case "monthly-ordinal":
      return monthlySeries(anchorMs, freq.interval, (year, month) =>
        ordinalWeekdayDay(year, month, freq.ordinal, freq.weekday),
      );
    case "yearly":
      return yearlySeries(anchorMs, freq.interval);
  }
}

/** Yields the series' occurrence times ascending from `fromPeriod`, bounded by `MAX_SCAN_PERIODS`. */
function* scanOccurrences(series: Series, fromPeriod: number): Generator<number> {
  const lastPeriod = fromPeriod + MAX_SCAN_PERIODS;
  for (let period = fromPeriod; period < lastPeriod; period++) {
    for (const ms of series.datesInPeriod(period)) {
      // Past year 275760 `Date.UTC` returns NaN, which compares false against
      // every bound below and would leak "NaN-NaN-NaN" into a result instead of
      // ending the scan. Unreachable from a four-digit day key; cheap to close.
      if (!Number.isFinite(ms)) return;
      if (ms >= series.anchorMs) yield ms;
    }
  }
}

// --- Public API -------------------------------------------------------------

export function nextOccurrenceDate(
  rule: RecurrenceRule,
  anchor: DayKey,
  after: DayKey,
): DayKey | null {
  const anchorMs = dayKeyToUtcMs(anchor);
  const afterMs = dayKeyToUtcMs(after);
  const series = buildSeries(rule.freq, anchorMs);
  const untilMs = rule.end.kind === "until" ? dayKeyToUtcMs(rule.end.date) : null;
  const total = rule.end.kind === "count" ? rule.end.total : null;

  // A count makes every occurrence's ordinal matter, so the scan has to start at
  // the anchor and tally the ones nobody asked about; otherwise it jumps
  // straight to the period that can hold the day after `after`.
  const fromPeriod = total === null ? series.periodAtOrAfter(afterMs + MS_PER_DAY) : 0;

  let seen = 0;
  for (const ms of scanOccurrences(series, fromPeriod)) {
    seen += 1;
    if (total !== null && seen > total) return null;
    if (untilMs !== null && ms > untilMs) return null;
    if (ms > afterMs) return utcMsToDayKey(ms);
  }
  return null;
}

export function occurrenceDatesInRange(
  rule: RecurrenceRule,
  anchor: DayKey,
  range: { from: DayKey; to: DayKey },
  exdates?: ReadonlySet<DayKey>,
  limit: number = DEFAULT_OCCURRENCE_LIMIT,
): DayKey[] {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new TypeError(`Invalid occurrence limit: ${limit}`);
  }
  const anchorMs = dayKeyToUtcMs(anchor);
  const fromMs = dayKeyToUtcMs(range.from);
  const toMs = dayKeyToUtcMs(range.to);
  if (toMs < fromMs || limit === 0) return [];

  const series = buildSeries(rule.freq, anchorMs);
  const untilMs = rule.end.kind === "until" ? dayKeyToUtcMs(rule.end.date) : null;
  const total = rule.end.kind === "count" ? rule.end.total : null;
  const fromPeriod = total === null ? series.periodAtOrAfter(fromMs) : 0;

  const dates: DayKey[] = [];
  let seen = 0;
  for (const ms of scanOccurrences(series, fromPeriod)) {
    seen += 1;
    if (total !== null && seen > total) break;
    if (untilMs !== null && ms > untilMs) break;
    if (ms > toMs) break;
    if (ms < fromMs) continue;
    const key = utcMsToDayKey(ms);
    // Exclusions are applied last, so a "deleted this one" still spends its
    // slot in the count rather than shifting the rest of the series forward.
    if (exdates?.has(key)) continue;
    dates.push(key);
    if (dates.length >= limit) break;
  }
  return dates;
}

// --- Canonical form ---------------------------------------------------------

/** Ascending and duplicate-free — the order both the weekly expansion and `serializeRecurrenceRule` depend on. */
function canonicalDays(days: readonly RecurrenceWeekday[]): RecurrenceWeekday[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

function canonicalizeFreq(freq: RecurrenceFreq): RecurrenceFreq {
  switch (freq.kind) {
    case "daily":
      return { kind: "daily", interval: freq.interval };
    case "weekdays":
      return { kind: "weekdays" };
    case "weekly":
      return { kind: "weekly", interval: freq.interval, days: canonicalDays(freq.days) };
    case "monthly-date":
      return { kind: "monthly-date", interval: freq.interval, day: freq.day };
    case "monthly-ordinal":
      return {
        kind: "monthly-ordinal",
        interval: freq.interval,
        ordinal: freq.ordinal,
        weekday: freq.weekday,
      };
    case "yearly":
      return { kind: "yearly", interval: freq.interval };
  }
}

function canonicalizeEnd(end: RecurrenceEnd): RecurrenceEnd {
  switch (end.kind) {
    case "never":
      return { kind: "never" };
    case "until":
      return { kind: "until", date: end.date };
    case "count":
      return { kind: "count", total: end.total };
  }
}

/**
 * Rebuilds a rule in fixed member order. The single authority on what
 * "canonical" means — `validateRecurrenceRule` finishes through it too, so the
 * validator and the serializer cannot drift apart.
 */
function canonicalizeRule(rule: RecurrenceRule): RecurrenceRule {
  return { freq: canonicalizeFreq(rule.freq), end: canonicalizeEnd(rule.end) };
}

export function serializeRecurrenceRule(rule: RecurrenceRule): string {
  return JSON.stringify(canonicalizeRule(rule));
}

// --- Validation -------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Exactly these own keys, no more and no fewer. An unknown key means the value
 * was not produced by this module, so it is rejected rather than quietly
 * dropped — a rule that carries a member this engine ignores is a rule whose
 * serialized form would no longer describe what actually happens.
 */
function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(record);
  return own.length === keys.length && own.every((key) => keys.includes(key));
}

function intInRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

function validateInterval(value: unknown): number | null {
  return intInRange(value, 1, MAX_RECURRENCE_INTERVAL);
}

const RECURRENCE_WEEKDAYS: readonly RecurrenceWeekday[] = [0, 1, 2, 3, 4, 5, 6];
const RECURRENCE_ORDINALS: readonly RecurrenceOrdinal[] = [1, 2, 3, 4, -1];

/** Membership against a closed numeric list, narrowing without an assertion (see `importArchive.ts`'s `enumInt`). */
function validateWeekday(value: unknown): RecurrenceWeekday | null {
  if (typeof value !== "number") return null;
  for (const candidate of RECURRENCE_WEEKDAYS) {
    if (candidate === value) return candidate;
  }
  return null;
}

function validateOrdinal(value: unknown): RecurrenceOrdinal | null {
  if (typeof value !== "number") return null;
  for (const candidate of RECURRENCE_ORDINALS) {
    if (candidate === value) return candidate;
  }
  return null;
}

/** Non-empty, in range, and free of duplicates; ordering is left to `canonicalizeFreq`. */
function validateWeekdays(value: unknown): RecurrenceWeekday[] | null {
  if (!Array.isArray(value)) return null;
  const entries: readonly unknown[] = value;
  if (entries.length === 0) return null;
  const days: RecurrenceWeekday[] = [];
  for (const entry of entries) {
    const day = validateWeekday(entry);
    if (day === null || days.includes(day)) return null;
    days.push(day);
  }
  return days;
}

function validateFreq(value: unknown): RecurrenceFreq | null {
  if (!isRecord(value)) return null;
  switch (value["kind"]) {
    case "daily": {
      if (!hasExactKeys(value, ["kind", "interval"])) return null;
      const interval = validateInterval(value["interval"]);
      return interval === null ? null : { kind: "daily", interval };
    }
    case "weekdays":
      return hasExactKeys(value, ["kind"]) ? { kind: "weekdays" } : null;
    case "weekly": {
      if (!hasExactKeys(value, ["kind", "interval", "days"])) return null;
      const interval = validateInterval(value["interval"]);
      const days = validateWeekdays(value["days"]);
      return interval === null || days === null ? null : { kind: "weekly", interval, days };
    }
    case "monthly-date": {
      if (!hasExactKeys(value, ["kind", "interval", "day"])) return null;
      const interval = validateInterval(value["interval"]);
      const day = intInRange(value["day"], MIN_MONTH_DAY, MAX_MONTH_DAY);
      return interval === null || day === null ? null : { kind: "monthly-date", interval, day };
    }
    case "monthly-ordinal": {
      if (!hasExactKeys(value, ["kind", "interval", "ordinal", "weekday"])) return null;
      const interval = validateInterval(value["interval"]);
      const ordinal = validateOrdinal(value["ordinal"]);
      const weekday = validateWeekday(value["weekday"]);
      return interval === null || ordinal === null || weekday === null
        ? null
        : { kind: "monthly-ordinal", interval, ordinal, weekday };
    }
    case "yearly": {
      if (!hasExactKeys(value, ["kind", "interval"])) return null;
      const interval = validateInterval(value["interval"]);
      return interval === null ? null : { kind: "yearly", interval };
    }
    default:
      return null;
  }
}

function validateEnd(value: unknown): RecurrenceEnd | null {
  if (!isRecord(value)) return null;
  switch (value["kind"]) {
    case "never":
      return hasExactKeys(value, ["kind"]) ? { kind: "never" } : null;
    case "until": {
      if (!hasExactKeys(value, ["kind", "date"])) return null;
      const date = value["date"];
      // A real calendar day, not merely a parseable one: `2026-02-30` would
      // otherwise roll into March and end the series a day late.
      return typeof date === "string" && isValidDayKey(date) ? { kind: "until", date } : null;
    }
    case "count": {
      if (!hasExactKeys(value, ["kind", "total"])) return null;
      const total = intInRange(value["total"], 1, MAX_RECURRENCE_COUNT);
      return total === null ? null : { kind: "count", total };
    }
    default:
      return null;
  }
}

/** Structural validation of an untrusted value into a canonical rule, or null. Never returns any part of the input. */
export function validateRecurrenceRule(value: unknown): RecurrenceRule | null {
  if (!isRecord(value) || !hasExactKeys(value, ["freq", "end"])) return null;
  const freq = validateFreq(value["freq"]);
  const end = validateEnd(value["end"]);
  if (freq === null || end === null) return null;
  return canonicalizeRule({ freq, end });
}
