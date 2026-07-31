import type Database from "better-sqlite3-multiple-ciphers";
import { isValidDayKey, occurrenceDatesInRange, shiftDayKey, validateRecurrenceRule } from "@nexus/core";
import { CalendarOverlayValidationError } from "../errors.js";

type DatabaseHandle = Database.Database;

/**
 * Widest span, in days, one overlay read may cover. The calendar's own
 * furthest-reaching surface is the agenda, whose horizon is 31 days back plus
 * 365 ahead (397 keys); 400 covers it with slack while keeping a hostile
 * renderer from asking a daily series to expand over centuries (SEC-EL-02 —
 * the range is renderer input, and expansion cost grows with it).
 */
export const MAX_OVERLAY_RANGE_DAYS = 400;

/**
 * One foreign event as the overlay hands it across the trust boundary
 * (CAL-005 / ADR-058 §5): PRE-MARKED and MINIMIZED. No description, no
 * location, no category, no recurrence — the renderer never even receives
 * what it must not show, and a series arrives already expanded into concrete
 * occurrences (occurrences of one master share its `id`; the day tells them
 * apart, exactly as the viewer's own calendar reads a series).
 */
export interface CalendarOverlayEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  /** Always true — stamped at the source, so no layer above can forget to mark a guest row. */
  foreign: true;
}

interface OverlayRow {
  id: string;
  title: string;
  start_at: string;
  end_at: string | null;
  all_day: number;
  recurrence: string | null;
  recurrence_exdates: string;
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/**
 * Read-only view of ANOTHER profile's events for the calendar overlay
 * (CAL-005, founder decision #4 / ADR-058 §5) — deliberately the ONE
 * two-profile store in the codebase. Every other store is constructed for a
 * single profile and scopes every statement by it; this one exists precisely
 * because the overlay is the system's single sanctioned cross-profile read,
 * so it names BOTH sides explicitly — who is looking (`viewerProfileId`) and
 * whose events are being read (`foreignProfileId`) — and refuses to be built
 * with the two collapsed into one. Anything cross-profile that cannot state
 * both ids this way has no business existing.
 *
 * The rows come back minimized (`CalendarOverlayEvent` — no description,
 * location or category) and pre-expanded: a recurring master becomes one row
 * per occurrence inside the asked range, times preserved, exception dates
 * honoured. A malformed stored row (bad day key, unparseable rule) is SKIPPED
 * rather than thrown on — this is a courtesy surface over somebody else's
 * data, and one corrupt foreign row must not take down the viewer's whole
 * calendar; the owning profile's own surfaces are where that corruption gets
 * reported (`EventStore` throws there by design).
 *
 * Prepared, parameterized statements as everywhere (SEC-API-03); inputs are
 * revalidated here because the renderer is untrusted (SEC-EL-02).
 */
export class CalendarOverlayStore {
  private readonly selectCandidates: Database.Statement;

  constructor(
    db: DatabaseHandle,
    viewerProfileId: string,
    private readonly foreignProfileId: string,
  ) {
    if (viewerProfileId.length === 0 || foreignProfileId.length === 0) {
      throw new CalendarOverlayValidationError("Both profile ids must be non-empty.");
    }
    if (viewerProfileId === foreignProfileId) {
      throw new CalendarOverlayValidationError(
        "The overlay reads ANOTHER profile's events — viewer and foreign profile must differ.",
      );
    }
    // Recurring masters travel regardless of their start (an old anchor still
    // produces occurrences in the range); one-offs are pre-cut to those
    // starting by the range's end, with the precise overlap check in JS where
    // the end-before-start clamp lives.
    this.selectCandidates = db.prepare(
      `SELECT id, title, start_at, end_at, all_day, recurrence, recurrence_exdates
       FROM events
       WHERE profile_id = ? AND deleted_at IS NULL
         AND (recurrence IS NOT NULL OR substr(start_at, 1, 10) <= ?)
       ORDER BY start_at, id`,
    );
  }

  /** The foreign profile's events overlapping the inclusive day range, series expanded, minimized. */
  listRange(from: string, to: string): CalendarOverlayEvent[] {
    validateBound(from, "from");
    validateBound(to, "to");
    if (to < from) {
      throw new CalendarOverlayValidationError(`Range end "${to}" precedes its start "${from}".`);
    }
    if (daysBetween(from, to) > MAX_OVERLAY_RANGE_DAYS) {
      throw new CalendarOverlayValidationError(
        `Range wider than ${MAX_OVERLAY_RANGE_DAYS} days is refused.`,
      );
    }

    const rows = this.selectCandidates.all(this.foreignProfileId, to) as OverlayRow[];
    const events: CalendarOverlayEvent[] = [];
    for (const row of rows) {
      const startKey = row.start_at.slice(0, 10);
      if (!DAY_KEY_RE.test(startKey)) continue; // malformed — skip, never crash (see class doc)

      if (row.recurrence === null) {
        // Same clamp as the viewer's own calendar: a bad end, or one before
        // the start, collapses to a single-day span.
        let endKey = row.end_at === null ? startKey : row.end_at.slice(0, 10);
        if (!DAY_KEY_RE.test(endKey) || endKey < startKey) endKey = startKey;
        if (startKey <= to && endKey >= from) events.push(toOverlayEvent(row, row.start_at, row.end_at));
        continue;
      }

      const rule = parseStoredRule(row.recurrence);
      const exdates = parseStoredExdates(row.recurrence_exdates);
      if (rule === null || exdates === null || !isValidDayKey(startKey)) continue;
      for (const date of occurrenceDatesInRange(rule, startKey, { from, to }, exdates)) {
        const delta = daysBetween(startKey, date);
        events.push(
          toOverlayEvent(row, shiftDayParts(row.start_at, delta), shiftEnd(row.end_at, delta)),
        );
      }
    }
    return events;
  }
}

/** Builds the minimized wire row — the ONLY place an overlay object is shaped, so the key set cannot drift per branch. */
function toOverlayEvent(row: OverlayRow, startAt: string, endAt: string | null): CalendarOverlayEvent {
  return {
    id: row.id,
    title: row.title,
    startAt,
    endAt,
    allDay: row.all_day === 1,
    foreign: true,
  };
}

function validateBound(value: string, field: string): void {
  if (!isValidDayKey(value)) {
    throw new CalendarOverlayValidationError(
      `"${field}" must be a real calendar day (got "${value}").`,
    );
  }
}

/** Whole-day delta between two bare day keys — UTC-midnight math, no timezone drift. */
function daysBetween(fromKey: string, toKey: string): number {
  const from = Date.UTC(
    Number(fromKey.slice(0, 4)),
    Number(fromKey.slice(5, 7)) - 1,
    Number(fromKey.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toKey.slice(0, 4)),
    Number(toKey.slice(5, 7)) - 1,
    Number(toKey.slice(8, 10)),
  );
  return Math.round((to - from) / MS_PER_DAY);
}

/** The timestamp moved `delta` whole days: the day part shifts, the "T09:00" tail does not. */
function shiftDayParts(value: string, delta: number): string {
  return shiftDayKey(value.slice(0, 10), delta) + value.slice(10);
}

function shiftEnd(endAt: string | null, delta: number): string | null {
  if (endAt === null || !isValidDayKey(endAt.slice(0, 10))) return endAt;
  return shiftDayParts(endAt, delta);
}

/** Stored rule → validated rule, or null for anything unusable (skip, never throw — see the class doc). */
function parseStoredRule(text: string): ReturnType<typeof validateRecurrenceRule> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return validateRecurrenceRule(parsed);
}

/** Stored exception list → a day-key set, or null for anything unusable. */
function parseStoredExdates(text: string): Set<string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const entries: readonly unknown[] = parsed;
  const exdates = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string" || !isValidDayKey(entry)) return null;
    exdates.add(entry);
  }
  return exdates;
}
