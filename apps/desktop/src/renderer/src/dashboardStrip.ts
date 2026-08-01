import { phaseProgress } from "@nexus/core";
import type { RunningFocusSession } from "../../shared/ipc.js";
import type { CalendarItem } from "./calendarItems.js";
import { formatClockLabel } from "./calendarPrefs.js";
import type { ClockPreference } from "./calendarPrefs.js";
import { formatDurationMinutes } from "./focusFormat.js";
import { strings } from "./strings.js";

/**
 * The dashboard's compact day strip (DASH-009) — the pure half.
 *
 * The greeting header grows one muted line under the date carrying the day's
 * live essentials: the next event still ahead today, and the focus timer when
 * one is running. Per ADR-045's own discipline this is a HEADER element and not
 * a widget — it is not placeable or removable, it is the greeting knowing what
 * time it is — so its logic lives here rather than in `dashboardWidgets.tsx`.
 *
 * Everything below is a pure function of an explicit reading of the clock
 * (`todayKey`, `nowMinutes`, `nowMs`), never of `Date.now()`: the strip is
 * redrawn on a 60s tick, and a selection rule that reads the clock itself
 * cannot be tested at 23:59 or at the minute an event starts.
 *
 * The whole line is absent when it has nothing to say. A strip is not an empty
 * state, so there is deliberately no „nema događaja" filler anywhere here —
 * `null` travels all the way up to the header, which then draws no element.
 */

const MINUTE_MS = 60_000;

/** How the strip's own segments are joined — the house separator (`studyLog`, `SettingsPage`). */
const SEPARATOR = " · ";

/** A calendar item already narrowed to the one kind the strip reads. */
export type StripEventItem = CalendarItem & { kind: "event" };

/**
 * The event the strip announces, plus the reading that decides how it is
 * labelled: minutes from midnight for one that still starts today, `null` for
 * one with no time of day left to announce (an all-day event, or a multi-day
 * span that began before today).
 */
export interface StripEvent {
  readonly item: StripEventItem;
  readonly startMinutes: number | null;
}

/** „Danas"'s own ordering, so the strip and that widget can never disagree on which event comes first. */
function precedes(a: CalendarItem, b: CalendarItem): boolean {
  return (a.sortKey.localeCompare(b.sortKey) || a.id.localeCompare(b.id)) < 0;
}

/**
 * The one event the strip names, out of the merged calendar stream, or `null`
 * when today has nothing left to announce.
 *
 * The rules, in full:
 *
 * - Only events. Birthdays, tasks, exams and blocks are „Danas"'s business;
 *   a strip that says „danas · Rođendan Ane" is not telling you what is next.
 * - Only what covers today: `startKey <= today <= endKey`. Non-recurring rows
 *   flow through `buildCalendarItems` untouched however far outside its range
 *   they fall (see that file's header), so this filter — not the range — is
 *   what makes the strip about *today*.
 * - A TIMED event that starts today qualifies while `startMinutes >= now`.
 *   Inclusive on purpose: a minute is the finest thing the strip shows and it
 *   is redrawn once a minute, so an event starting *this* minute stays up for
 *   the minute it starts rather than blinking away half-way through it. One
 *   already under way does not qualify — „what is next" is a claim about the
 *   future, and the running meeting is on the „Danas" card either way.
 * - Anything else covering today (an all-day event, a span that began earlier)
 *   counts as current until midnight and qualifies all day.
 * - A qualifying TIMED event always wins, earliest first. An all-day event has
 *   no "next" about it — it is ambient — so letting its bare day key sort ahead
 *   of every timed start would mean a day with one all-day entry never showing
 *   the 14:00 meeting at all. It is the FALLBACK: what the strip says once
 *   nothing timed is left.
 * - Ties (two events at the same minute, or two all-day ones) break on
 *   `sortKey` then `id`, exactly as „Danas" orders its rows.
 */
export function nextStripEvent(
  items: readonly CalendarItem[],
  todayKey: string,
  nowMinutes: number,
): StripEvent | null {
  let timedItem: StripEventItem | null = null;
  let timedMinutes = 0;
  let dayLongItem: StripEventItem | null = null;

  for (const item of items) {
    if (item.kind !== "event") continue;
    if (item.startKey > todayKey || item.endKey < todayKey) continue;

    // A span that began before today has already used up its start time; what
    // is left of it here is a day, not an hour.
    const minutes = item.startKey === todayKey ? item.startMinutes : null;
    if (minutes === null) {
      if (dayLongItem === null || precedes(item, dayLongItem)) dayLongItem = item;
      continue;
    }
    if (minutes < nowMinutes) continue;
    if (
      timedItem === null ||
      minutes < timedMinutes ||
      (minutes === timedMinutes && precedes(item, timedItem))
    ) {
      timedItem = item;
      timedMinutes = minutes;
    }
  }

  if (timedItem !== null) return { item: timedItem, startMinutes: timedMinutes };
  return dayLongItem !== null ? { item: dayLongItem, startMinutes: null } : null;
}

/** „14:00 · Sastanak sa mentorom", or „danas · Godišnjica" when there is no hour to name. */
function eventSegment(next: StripEvent, clock: ClockPreference): string {
  const when =
    next.startMinutes === null
      ? strings.dashboard.strip.dayLong
      : formatClockLabel(next.startMinutes, clock);
  return `${when}${SEPARATOR}${next.item.event.title}`;
}

/**
 * „Fokus u toku: 25 min" — the running phase, in whole elapsed minutes; or
 * „Fokus je pauziran: 25 min" while it is paused.
 *
 * Minutes rather than the „mm:ss" readout the pages tick: the strip is redrawn
 * once a minute, so a seconds field would spend most of its life wrong, and a
 * counter running in the header would be a moving thing in the one place on the
 * page that is meant to be still. Under a minute the duration is left off
 * entirely — „0 min" says less than the bare fact that a timer is on. The
 * elapsed part is FLOORED, never rounded: 25 min 40 s has not been 26 minutes.
 *
 * The elapsed figure comes from `phaseProgress` since UTIL slice b, which is
 * what makes the paused wording true rather than decorative: the engine freezes
 * the clock at `pausedAt`, so a phase paused twenty minutes ago still reads the
 * number it read when it was paused. Measuring from `startedAt` here would have
 * put a growing figure under the word „pauziran".
 */
function focusSegment(focus: RunningFocusSession, nowMs: number): string {
  const progress = phaseProgress(focus, new Date(nowMs).toISOString());
  const label = progress.isPaused
    ? strings.dashboard.strip.focusPaused
    : strings.dashboard.strip.focusRunning;
  const minutes = Math.floor((progress.elapsedSeconds * 1000) / MINUTE_MS);
  return minutes === 0 ? label : `${label}: ${formatDurationMinutes(minutes)}`;
}

/** Everything the strip is drawn from — one explicit reading of the clock, plus what was read off disk. */
export interface DayStripInput {
  /** Today's calendar stream, merged by `buildCalendarItems` (events only — the strip asks for nothing else). */
  readonly items: readonly CalendarItem[];
  readonly todayKey: string;
  /** Minutes since local midnight. */
  readonly nowMinutes: number;
  /** The same instant in epoch milliseconds — what the running timer's elapsed is measured against. */
  readonly nowMs: number;
  /**
   * Which clock the event's time is written in (CAL §5). It arrives here for
   * the same reason the readings above do: this module is pure by contract, so
   * the device preference is READ by the page and named in the input rather
   * than fetched out of `localStorage` half-way down a formatter.
   */
  readonly clock: ClockPreference;
  /** The main-process focus phase, or `null` when none runs (or both owning modules are off). */
  readonly focus: RunningFocusSession | null;
}

/**
 * The whole strip as one line, or `null` when there is nothing to say — which
 * is the header drawing no element at all rather than a filler sentence.
 */
export function dayStripLine(input: DayStripInput): string | null {
  const segments: string[] = [];
  const next = nextStripEvent(input.items, input.todayKey, input.nowMinutes);
  if (next !== null) segments.push(eventSegment(next, input.clock));
  if (input.focus !== null) segments.push(focusSegment(input.focus, input.nowMs));
  return segments.length > 0 ? segments.join(SEPARATOR) : null;
}
