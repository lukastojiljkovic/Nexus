/**
 * Pure layout engine for calendar grids (month/week/day) — ADR-020. No DOM,
 * no dependencies: every calculation here is testable data-in/data-out math,
 * with the actual grid/bar/column rendering left to the UI slices that use
 * this module.
 *
 * Two decisions a reader would otherwise have to reverse-engineer:
 *  - All date maths run in UTC (`Date.UTC` / `getUTC*`). The app's day/month
 *    keys are bare, zone-less wall-clock strings, so there is no timezone to
 *    convert *from* — parsing them with local-time `Date` semantics would
 *    make the grid one day off for anyone west of Greenwich. UTC sidesteps
 *    that entirely and gives every developer identical results.
 *  - This module is generic over plain span/timed records (`SpanItem`,
 *    `TimedItem`); it never learns what an event, task, exam or study block
 *    is. Merging domain rows into these shapes is the calendar page's job.
 */

/** A bare calendar day, "YYYY-MM-DD". */
export type DayKey = string;
/** A bare calendar month, "YYYY-MM". */
export type MonthKey = string;
/** The weekday a grid row starts on, in `Date.getUTCDay()` terms: 1 = Monday (the Serbian default), 0 = Sunday. */
export type WeekStart = 0 | 1;

export interface MonthGridDay {
  readonly key: DayKey;
  /** False for the leading/trailing days that only exist to complete a week row. */
  readonly inMonth: boolean;
}

/** An item occupying a whole number of days; `endKey === startKey` for a single-day item. */
export interface SpanItem {
  readonly id: string;
  readonly startKey: DayKey;
  readonly endKey: DayKey;
}

/** One item's bar inside ONE week row. */
export interface MonthBar {
  readonly id: string;
  /** Column where the bar starts in this row, 0-6. */
  readonly dayIndex: number;
  /** Column count the bar covers in this row, 1-7. */
  readonly span: number;
  /** 0-based stacking row inside the cells. */
  readonly lane: number;
  /** The item started before this week row (render a flat left edge). */
  readonly continuesBefore: boolean;
  /** The item continues past this week row (render a flat right edge). */
  readonly continuesAfter: boolean;
}

/** An item occupying part of one day, in minutes from that day's midnight. */
export interface TimedItem {
  readonly id: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/** One timed item's placement inside its overlap cluster. */
export interface TimedColumn {
  readonly id: string;
  /** 0-based column within the cluster. */
  readonly column: number;
  /** Total columns in this item's cluster — every member of one cluster reports the same number. */
  readonly columns: number;
  /** Possibly clamped (see MIN_TIMED_MINUTES / MINUTES_PER_DAY) — the renderer positions from these, not from its input. */
  readonly startMinutes: number;
  readonly endMinutes: number;
}

export const MINUTES_PER_DAY = 1440;
/** Shortest rendered height for a timed item, so a zero-length or 5-minute event stays clickable. */
export const MIN_TIMED_MINUTES = 30;
/** Guard against absurd data: a span longer than this is truncated rather than allowed to allocate forever. */
export const MAX_SPAN_DAYS = 366;

const MS_PER_DAY = 86_400_000;
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;

/** Shape AND calendar reality: "2026-02-30" is not a day, however parseable it looks. */
export function isValidDayKey(key: string): boolean {
  if (!DAY_KEY_RE.test(key)) return false;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

/** The throwing form of `isValidDayKey`, naming the offending value. */
function assertValidDayKey(key: DayKey): void {
  if (!isValidDayKey(key)) {
    throw new TypeError(`Invalid day key: "${key}"`);
  }
}

function assertValidMonthKey(key: MonthKey): void {
  if (!MONTH_KEY_RE.test(key)) {
    throw new TypeError(`Invalid month key: "${key}"`);
  }
  const month = Number(key.slice(5, 7));
  if (month < 1 || month > 12) {
    throw new TypeError(`Invalid month key: "${key}"`);
  }
}

function assertIntegerArg(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Invalid ${label}: ${value}`);
  }
}

/** UTC-midnight ms for a bare day key; throws TypeError on anything that is not a real calendar day. */
export function dayKeyToUtcMs(key: DayKey): number {
  assertValidDayKey(key);
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  return Date.UTC(year, month - 1, day);
}

/** Formats UTC-midnight ms back into a bare day key — the inverse of `dayKeyToUtcMs`. */
export function utcMsToDayKey(ms: number): DayKey {
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthKeyOf(dayKey: DayKey): MonthKey {
  assertValidDayKey(dayKey);
  return dayKey.slice(0, 7);
}

export function shiftDayKey(key: DayKey, days: number): DayKey {
  assertIntegerArg(days, "days");
  return utcMsToDayKey(dayKeyToUtcMs(key) + days * MS_PER_DAY);
}

export function shiftMonthKey(monthKey: MonthKey, months: number): MonthKey {
  assertValidMonthKey(monthKey);
  assertIntegerArg(months, "months");
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7)); // 1-indexed
  const totalMonths = year * 12 + (month - 1) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonthIndex = totalMonths - newYear * 12; // 0-indexed, always in [0, 11]
  return `${String(newYear).padStart(4, "0")}-${String(newMonthIndex + 1).padStart(2, "0")}`;
}

export function monthGridDays(monthKey: MonthKey, firstDayOfWeek: WeekStart): MonthGridDay[] {
  assertValidMonthKey(monthKey);
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7)); // 1-indexed

  const firstMs = Date.UTC(year, month - 1, 1);
  const lastMs = Date.UTC(year, month, 0); // day 0 of next month = last day of this month

  const leadOffset = (new Date(firstMs).getUTCDay() - firstDayOfWeek + 7) % 7;
  const trailOffset = (firstDayOfWeek + 6 - new Date(lastMs).getUTCDay() + 7) % 7;

  const startMs = firstMs - leadOffset * MS_PER_DAY;
  const endMs = lastMs + trailOffset * MS_PER_DAY;
  const totalDays = Math.round((endMs - startMs) / MS_PER_DAY) + 1;

  return Array.from({ length: totalDays }, (_, i) => {
    const ms = startMs + i * MS_PER_DAY;
    return { key: utcMsToDayKey(ms), inMonth: ms >= firstMs && ms <= lastMs };
  });
}

export function weekDayKeys(dayKey: DayKey, firstDayOfWeek: WeekStart): DayKey[] {
  const ms = dayKeyToUtcMs(dayKey);
  const offset = (new Date(ms).getUTCDay() - firstDayOfWeek + 7) % 7;
  const startMs = ms - offset * MS_PER_DAY;
  return Array.from({ length: 7 }, (_, i) => utcMsToDayKey(startMs + i * MS_PER_DAY));
}

export function daySpanKeys(startKey: DayKey, endKey: DayKey): DayKey[] {
  const startMs = dayKeyToUtcMs(startKey);
  const endMs = dayKeyToUtcMs(endKey);
  if (endMs < startMs) return [startKey];

  const maxEndMs = startMs + (MAX_SPAN_DAYS - 1) * MS_PER_DAY;
  const clampedEndMs = Math.min(endMs, maxEndMs);
  const days = Math.round((clampedEndMs - startMs) / MS_PER_DAY) + 1;
  return Array.from({ length: days }, (_, i) => utcMsToDayKey(startMs + i * MS_PER_DAY));
}

/**
 * Validates a week row and returns its UTC bounds. The row must be exactly 7
 * *consecutive* day keys — merely ascending is not enough: `dayIndex` and
 * `span` below are derived from the distance to `startMs`, so a row with a gap
 * in it would silently produce bars pointing past column 6 instead of failing.
 */
function weekRowBounds(weekKeys: readonly DayKey[]): { startMs: number; endMs: number } {
  const first = weekKeys[0];
  if (weekKeys.length !== 7 || first === undefined) {
    throw new TypeError(`Invalid week row: expected 7 day keys, got ${weekKeys.length}`);
  }
  const startMs = dayKeyToUtcMs(first);
  for (let index = 1; index < 7; index++) {
    const key = weekKeys[index];
    if (key === undefined || dayKeyToUtcMs(key) !== startMs + index * MS_PER_DAY) {
      throw new TypeError(
        `Invalid week row: expected 7 consecutive day keys, got "${String(key)}" at index ${index}`,
      );
    }
  }
  return { startMs, endMs: startMs + 6 * MS_PER_DAY };
}

export function layoutMonthBars(
  items: readonly SpanItem[],
  weekKeys: readonly DayKey[],
): MonthBar[] {
  const { startMs: rowStartMs, endMs: rowEndMs } = weekRowBounds(weekKeys);

  interface Candidate {
    readonly id: string;
    readonly startKey: DayKey;
    readonly dayIndex: number;
    readonly span: number;
    readonly continuesBefore: boolean;
    readonly continuesAfter: boolean;
  }

  const candidates: Candidate[] = [];
  for (const item of items) {
    const itemStartMs = dayKeyToUtcMs(item.startKey);
    const itemEndMs = dayKeyToUtcMs(item.endKey);
    if (itemEndMs < rowStartMs || itemStartMs > rowEndMs) continue; // no intersection

    const clippedStartMs = Math.max(itemStartMs, rowStartMs);
    const clippedEndMs = Math.min(itemEndMs, rowEndMs);
    candidates.push({
      id: item.id,
      startKey: item.startKey,
      dayIndex: Math.round((clippedStartMs - rowStartMs) / MS_PER_DAY),
      span: Math.round((clippedEndMs - clippedStartMs) / MS_PER_DAY) + 1,
      continuesBefore: itemStartMs < rowStartMs,
      continuesAfter: itemEndMs > rowEndMs,
    });
  }

  candidates.sort((a, b) => {
    if (a.startKey !== b.startKey) return a.startKey < b.startKey ? -1 : 1;
    if (a.span !== b.span) return b.span - a.span; // longer span first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const laneOccupancy: boolean[][] = [];
  return candidates.map((candidate) => {
    let lane = laneOccupancy.findIndex((cols) =>
      cols.slice(candidate.dayIndex, candidate.dayIndex + candidate.span).every((occupied) => !occupied),
    );
    if (lane === -1) {
      lane = laneOccupancy.length;
      laneOccupancy.push(new Array(7).fill(false));
    }
    const cols = laneOccupancy[lane];
    if (cols) {
      for (let i = candidate.dayIndex; i < candidate.dayIndex + candidate.span; i++) {
        cols[i] = true;
      }
    }
    return {
      id: candidate.id,
      dayIndex: candidate.dayIndex,
      span: candidate.span,
      lane,
      continuesBefore: candidate.continuesBefore,
      continuesAfter: candidate.continuesAfter,
    };
  });
}

/** Clamps one item's minutes per the MIN_TIMED_MINUTES / MINUTES_PER_DAY rules; throws on bad raw input. */
function clampTimedItem(item: TimedItem): { id: string; startMinutes: number; endMinutes: number } {
  if (!Number.isInteger(item.startMinutes) || !Number.isInteger(item.endMinutes)) {
    throw new TypeError(
      `Invalid timed item minutes for "${item.id}": ${item.startMinutes}-${item.endMinutes}`,
    );
  }
  const start = Math.min(Math.max(item.startMinutes, 0), MINUTES_PER_DAY);
  const end = Math.min(Math.max(item.endMinutes, start + MIN_TIMED_MINUTES), MINUTES_PER_DAY);
  // Pull the start back if the end clamp left less than a minimum-length gap.
  const clampedStart = Math.min(start, end - MIN_TIMED_MINUTES);
  return { id: item.id, startMinutes: clampedStart, endMinutes: end };
}

export function layoutTimedColumns(items: readonly TimedItem[]): TimedColumn[] {
  const clamped = items.map(clampTimedItem);
  clamped.sort((a, b) => {
    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    if (a.endMinutes !== b.endMinutes) return a.endMinutes - b.endMinutes;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const result: TimedColumn[] = [];
  let clusterStart = 0;
  let runningMaxEnd = -Infinity;

  const flushCluster = (endIndex: number) => {
    const columnEnds: number[] = [];
    const columnOf: number[] = [];
    for (let i = clusterStart; i < endIndex; i++) {
      const member = clamped[i];
      if (!member) continue;
      let column = columnEnds.findIndex((end) => end <= member.startMinutes);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(member.endMinutes);
      } else {
        columnEnds[column] = member.endMinutes;
      }
      // Indexed, never pushed: the skip above would otherwise shift every
      // later member onto the wrong column.
      columnOf[i - clusterStart] = column;
    }
    const columns = columnEnds.length;
    for (let i = clusterStart; i < endIndex; i++) {
      const member = clamped[i];
      const column = columnOf[i - clusterStart];
      if (!member || column === undefined) continue;
      result.push({
        id: member.id,
        column,
        columns,
        startMinutes: member.startMinutes,
        endMinutes: member.endMinutes,
      });
    }
  };

  clamped.forEach((member, index) => {
    if (index === clusterStart) {
      runningMaxEnd = member.endMinutes;
      return;
    }
    if (member.startMinutes < runningMaxEnd) {
      runningMaxEnd = Math.max(runningMaxEnd, member.endMinutes);
      return;
    }
    flushCluster(index);
    clusterStart = index;
    runningMaxEnd = member.endMinutes;
  });
  if (clamped.length > 0) flushCluster(clamped.length);

  return result;
}
