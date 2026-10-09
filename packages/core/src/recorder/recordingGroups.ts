/**
 * The recorder's pure reads: how recordings group, what a month holds, and what
 * the library costs in bytes and time. No clock, no I/O, no storage — the store
 * answers rows and everything that could be ordered, summed or judged in the
 * renderer happens here, where it is testable data-in/data-out.
 *
 * **A recording has two days and they are not the same day.** The day it was
 * CREATED is the `YYYY-MM-DD` the timestamp carries; the day it was FILED under
 * is the diary date, which a user records at 23:50 and dates tomorrow, or
 * records on the road and dates with the trip's day. Grouping therefore comes in
 * two shapes, and the month summary reads the diary date because a diary month
 * is a calendar of days the user filed, not of days the machine was switched on.
 *
 * **The creation day is the first ten characters of the stored instant**
 * (`createdAt.slice(0, 10)`), which is the house's day-key rule for an instant —
 * `calendarItems.ts` reads an event's day the same way, and stage 2's capture
 * stamps `createdAt` from the same clock the rest of the app writes. Core
 * deliberately does not apply a timezone here: a browser cannot be given one
 * that would agree with what the OS shows, and inventing a second conversion
 * would make this module's day disagree with the calendar page's.
 *
 * **Newest day first, and newest recording first inside it.** A recorder is read
 * backwards, like a diary; the calendar summary is the one place order ascends,
 * because a month is drawn left to right. Ties inside a day break on the id,
 * which is a UUIDv7 and therefore also chronological, so the order is total.
 *
 * **A malformed row throws rather than being skipped or grouped under a
 * plausible day.** Rows here come from the store, which writes nothing else, so
 * an instant with no day, a diary flag with no date and a diary date on a
 * non-diary recording are all corruption — reading them as null would quietly
 * turn a dated entry into an undated one.
 */

import { isValidDayKey, type MonthKey } from "../calendar/calendarGrid.js";
import { RECORDING_KINDS, type RecordingKind } from "./recording.js";

/** The fields these reads need. Structural on purpose: a caller passes the store's own `Recording` without this module importing `@nexus/db`. */
export interface RecorderEntry {
  readonly id: string;
  readonly kind: RecordingKind;
  /** The ISO instant the recording was made. */
  readonly createdAt: string;
  readonly durationMs: number;
  readonly sizeBytes: number;
  readonly isDiary: boolean;
  /** A bare `YYYY-MM-DD`, or null for a memo. */
  readonly diaryDate: string | null;
}

/** One day and the recordings on it. */
export interface RecordingGroup<T> {
  readonly day: string;
  readonly recordings: readonly T[];
}

/** What a calendar month holds: which days carry a diary entry, and how many entries it holds in total. */
export interface RecorderMonthSummary {
  readonly month: MonthKey;
  /** Day keys inside `month` with at least one diary entry, ascending. */
  readonly days: readonly string[];
  readonly entries: number;
}

/** The count, size and running time of a set of recordings — one kind's, or all of them. */
export interface RecordingTotals {
  readonly count: number;
  readonly sizeBytes: number;
  readonly durationMs: number;
}

/** What the library costs, split the way a storage screen shows it: by kind, and in total. */
export interface RecordingStorageSummary {
  readonly audio: RecordingTotals;
  readonly video: RecordingTotals;
  readonly all: RecordingTotals;
}

/** Newest first, the id breaking a same-instant tie (a UUIDv7 sorts chronologically). */
function newestFirst<T extends RecorderEntry>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
    if (left.id !== right.id) return left.id < right.id ? 1 : -1;
    return 0;
  });
}

/** The `YYYY-MM-DD` an instant carries, or a throw naming the row that has none. */
function creationDay(entry: RecorderEntry): string {
  const day = entry.createdAt.slice(0, 10);
  if (!isValidDayKey(day)) {
    throw new TypeError(
      `Recording "${entry.id}" carries a creation instant with no calendar day: "${entry.createdAt}".`,
    );
  }
  return day;
}

/**
 * The diary date of a diary entry, or a throw naming the row. Called for every
 * entry, so the pairing the store enforces is re-stated here rather than
 * assumed: a value that reached this module has been through validation, and a
 * value that violates it anyway is corruption worth stopping on.
 */
function diaryDay(entry: RecorderEntry): string {
  if (entry.diaryDate === null) {
    throw new TypeError(`Recording "${entry.id}" is a diary entry with no diary date.`);
  }
  if (!isValidDayKey(entry.diaryDate)) {
    throw new TypeError(
      `Recording "${entry.id}" carries a diary date that is not a calendar day: "${entry.diaryDate}".`,
    );
  }
  return entry.diaryDate;
}

/** The diary entries only, each with the day it was filed under — the one pass both diary reads share. */
function filedDiaryEntries<T extends RecorderEntry>(
  entries: readonly T[],
): readonly { entry: T; day: string }[] {
  const filed: { entry: T; day: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDiary) {
      if (entry.diaryDate !== null) {
        throw new TypeError(
          `Recording "${entry.id}" carries a diary date but is not a diary entry.`,
        );
      }
      continue;
    }
    filed.push({ entry, day: diaryDay(entry) });
  }
  return filed;
}

/** Buckets rows by their day key, preserving the order they arrived in inside each bucket. */
function bucketByDay<K>(rows: readonly K[], dayOf: (row: K) => string): Map<string, K[]> {
  const byDay = new Map<string, K[]>();
  for (const row of rows) {
    const day = dayOf(row);
    const bucket = byDay.get(day);
    if (bucket === undefined) byDay.set(day, [row]);
    else bucket.push(row);
  }
  return byDay;
}

/** Newest day first — the order both groupings share. Day keys sort as strings. */
function daysNewestFirst(byDay: ReadonlyMap<string, unknown>): string[] {
  return [...byDay.keys()].sort((left, right) => (left === right ? 0 : left < right ? 1 : -1));
}

/** Every recording, grouped by the day it was created. */
export function groupByCreationDay<T extends RecorderEntry>(
  entries: readonly T[],
): RecordingGroup<T>[] {
  const byDay = bucketByDay(entries, creationDay);
  return daysNewestFirst(byDay).map((day) => ({
    day,
    recordings: newestFirst(byDay.get(day) ?? []),
  }));
}

/**
 * The DIARY entries, grouped by the date they were filed under. A memo is
 * absent: `isDiary` false means there is no diary date for it to belong to, and
 * this read answers a diary, not a library.
 */
export function groupByDiaryDate<T extends RecorderEntry>(
  entries: readonly T[],
): RecordingGroup<T>[] {
  const filed = filedDiaryEntries(entries);
  const byDay = bucketByDay(filed, (row) => row.day);
  return daysNewestFirst(byDay).map((day) => ({
    day,
    recordings: newestFirst((byDay.get(day) ?? []).map((row) => row.entry)),
  }));
}

/**
 * Which days of one calendar month carry a diary entry, and how many entries
 * that month holds. Days ascend because a month is read left to right; a month
 * with nothing in it answers `days: []` rather than being an error, since
 * „nothing on this page“ is an ordinary answer to an ordinary question.
 */
export function diaryMonthSummary<T extends RecorderEntry>(
  entries: readonly T[],
  month: MonthKey,
): RecorderMonthSummary {
  // A month key is valid exactly when its first day is a real calendar day.
  if (!isValidDayKey(`${month}-01`)) {
    throw new TypeError(`Invalid month key: "${month}"`);
  }

  const days = new Set<string>();
  let count = 0;
  for (const { day } of filedDiaryEntries(entries)) {
    if (!day.startsWith(`${month}-`)) continue;
    days.add(day);
    count += 1;
  }

  return { month, days: [...days].sort(), entries: count };
}

/** Total count, size and duration per kind, and across both. */
export function recordingStorageSummary(entries: readonly RecorderEntry[]): RecordingStorageSummary {
  const perKind: Record<RecordingKind, { count: number; sizeBytes: number; durationMs: number }> = {
    audio: { count: 0, sizeBytes: 0, durationMs: 0 },
    video: { count: 0, sizeBytes: 0, durationMs: 0 },
  };

  for (const entry of entries) {
    const totals = perKind[entry.kind];
    totals.count += 1;
    totals.sizeBytes += entry.sizeBytes;
    totals.durationMs += entry.durationMs;
  }

  const all = RECORDING_KINDS.reduce(
    (totals, kind) => ({
      count: totals.count + perKind[kind].count,
      sizeBytes: totals.sizeBytes + perKind[kind].sizeBytes,
      durationMs: totals.durationMs + perKind[kind].durationMs,
    }),
    { count: 0, sizeBytes: 0, durationMs: 0 },
  );

  return { audio: perKind.audio, video: perKind.video, all };
}
