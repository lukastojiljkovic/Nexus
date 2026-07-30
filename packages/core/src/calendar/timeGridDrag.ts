/**
 * Pointer-drag maths for the week/day hour grids (ADR-034). The renderer owns
 * the pointer events, the capture and the ghost; everything it has to *decide*
 * — how many minutes a pixel offset is, where the 15-minute grid puts it, what
 * still fits inside the day, which column the pointer is over — is this module,
 * pure and clock-free, so it can be pinned by tests instead of by eye.
 *
 * Two rules a reader would otherwise have to reverse-engineer:
 *  - A day here ends at **23:59**, not at 24:00. Times travel as bare
 *    "YYYY-MM-DDTHH:MM" wall-clock strings and a timed event must keep its end
 *    on its own day (`endKey === startKey`), so 24:00 is not something the app
 *    can write down at all: the last representable end is
 *    `TIME_GRID_MAX_END_MINUTES`. A move therefore stops one grid step earlier
 *    than the bottom of the column when that is what keeps its span inside the
 *    day, and a resize dragged to the floor lands on 23:59.
 *  - Nothing here throws on a *span* the store forbids (an end before its
 *    start): a drag handler is not the place to discover corrupt data, so such
 *    a span is moved as a point. Genuinely unusable input — a NaN pixel
 *    delta, a zero px-per-hour scale, a column count of 0 — does throw
 *    `TypeError`, exactly as `calendarGrid` does.
 */

import { MINUTES_PER_DAY } from "./calendarGrid.js";

const MINUTES_PER_HOUR = 60;

/** The grid a drag snaps to: quarter hours, both for a move's start and a resize's end. */
export const TIME_GRID_SNAP_MINUTES = 15;

/** Shortest event a resize may leave behind. Not the shortest *rendered* height — that is `MIN_TIMED_MINUTES`. */
export const TIME_GRID_MIN_EVENT_MINUTES = 15;

/** 23:59 — see the file header on why a day ends a minute early. */
export const TIME_GRID_MAX_END_MINUTES = MINUTES_PER_DAY - 1;

/** Pointer travel that separates a click on an event from a drag of it. */
export const TIME_GRID_DRAG_THRESHOLD_PX = 4;

/** A timed event's span in minutes from its day's midnight; a null end is an event with no end at all. */
export interface TimeGridSpan {
  readonly startMinutes: number;
  readonly endMinutes: number | null;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Invalid ${label}: ${value}`);
  }
}

/** A vertical pixel offset as minutes at a given px-per-hour scale. Unsnapped — the caller decides that next. */
export function timeGridPixelsToMinutes(pixels: number, hourHeightPx: number): number {
  assertFinite(pixels, "pixel offset");
  if (!Number.isFinite(hourHeightPx) || hourHeightPx <= 0) {
    throw new TypeError(`Invalid hour height: ${hourHeightPx}`);
  }
  return (pixels / hourHeightPx) * MINUTES_PER_HOUR;
}

/** The nearest quarter hour. Clamping into the day is the resolvers' job, not this one's. */
export function snapTimeGridMinutes(minutes: number): number {
  assertFinite(minutes, "minutes");
  return Math.round(minutes / TIME_GRID_SNAP_MINUTES) * TIME_GRID_SNAP_MINUTES;
}

/** The largest quarter hour at or below `minutes` — what a clamp uses, so a clamped value stays on the grid. */
function floorToSnap(minutes: number): number {
  return Math.floor(minutes / TIME_GRID_SNAP_MINUTES) * TIME_GRID_SNAP_MINUTES;
}

/**
 * Has the pointer travelled far enough for this gesture to be a drag rather
 * than a click? A non-finite delta never has: an unusable coordinate must not
 * be what turns a click into a move.
 */
export function exceedsTimeGridDragThreshold(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > TIME_GRID_DRAG_THRESHOLD_PX;
}

/**
 * Where a MOVE lands: the start snaps to the grid, the duration is preserved,
 * and the whole span is clamped inside the day (`floorToSnap` on the clamp so
 * an event pushed against the bottom still sits on a grid line rather than at
 * some remainder minute). An event with no end moves as a point.
 */
export function resolveTimeGridMove(span: TimeGridSpan, proposedStartMinutes: number): TimeGridSpan {
  assertFinite(span.startMinutes, "span start");
  if (span.endMinutes !== null) assertFinite(span.endMinutes, "span end");
  assertFinite(proposedStartMinutes, "proposed start");

  const duration = span.endMinutes === null ? 0 : Math.max(span.endMinutes - span.startMinutes, 0);
  const maxStart = Math.max(floorToSnap(TIME_GRID_MAX_END_MINUTES - duration), 0);
  const startMinutes = Math.min(Math.max(snapTimeGridMinutes(proposedStartMinutes), 0), maxStart);

  return {
    startMinutes,
    // The second clamp only ever bites on a span longer than a whole day, which
    // the grid cannot draw in the first place — but a silent 24:00 would be far
    // worse than a shortened absurdity.
    endMinutes:
      span.endMinutes === null
        ? null
        : Math.min(startMinutes + duration, TIME_GRID_MAX_END_MINUTES),
  };
}

/**
 * Where a RESIZE lands: the end snaps to the grid, never comes closer than
 * `TIME_GRID_MIN_EVENT_MINUTES` to the (untouched) start, and never crosses
 * midnight. When those two disagree — a start so late that no minimum fits —
 * midnight wins, because an event that ends tomorrow is not the same event.
 */
export function resolveTimeGridResize(startMinutes: number, proposedEndMinutes: number): number {
  assertFinite(startMinutes, "start");
  assertFinite(proposedEndMinutes, "proposed end");

  const snapped = snapTimeGridMinutes(proposedEndMinutes);
  const atLeastMinimum = Math.max(snapped, startMinutes + TIME_GRID_MIN_EVENT_MINUTES);
  return Math.min(atLeastMinimum, TIME_GRID_MAX_END_MINUTES);
}

/**
 * Which day column the pointer is over, given the columns strip's own live
 * rect. Equal-width columns (the grid's flex layout), and a pointer that has
 * left the strip belongs to the nearest edge column — a drag does not stop
 * meaning something because the hand overshot.
 */
export function resolveTimeGridColumn(
  pointerX: number,
  columnsLeft: number,
  columnsWidth: number,
  columnCount: number,
): number {
  assertFinite(pointerX, "pointer x");
  assertFinite(columnsLeft, "columns left");
  assertFinite(columnsWidth, "columns width");
  if (!Number.isInteger(columnCount) || columnCount < 1) {
    throw new TypeError(`Invalid column count: ${columnCount}`);
  }
  // A collapsed strip (mid-layout, or a hidden grid) has no column under the
  // pointer to speak of; the first one is the honest answer, not a division by
  // zero that would poison every later clamp.
  if (columnsWidth <= 0) return 0;

  const index = Math.floor(((pointerX - columnsLeft) / columnsWidth) * columnCount);
  return Math.min(Math.max(index, 0), columnCount - 1);
}
