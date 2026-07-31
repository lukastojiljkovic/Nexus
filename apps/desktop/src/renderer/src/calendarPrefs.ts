/**
 * The CALENDAR module's device preferences (PRD 04 §5), stored in
 * `localStorage` on the `weekStart.ts` / `taskPrefs.ts` / `notePrefs.ts`
 * recipe: a closed value set, a safe fallback for anything unrecognized, and
 * no IPC — they describe how THIS machine reads and creates a calendar, not
 * what the profile contains.
 *
 * Two of them:
 *
 *  - `defaultDurationMinutes` — how long an event the form seeds runs for, and
 *  - `clock` — which clock every calendar TIME LABEL is drawn in.
 *
 * **Why the label lives here and not beside `formatClock`.**
 * `calendarItems.ts`'s `formatClock` is a SERIALIZER: it builds the `startAt`
 * / `endAt` the store is given and fills `<input type="time">`, so it must stay
 * zero-padded "HH:MM" whatever a label says. `formatClockLabel` is its display
 * twin, and it is deliberately PURE over the preference rather than reading it
 * — that is what lets `dashboardStrip.ts` keep the purity its own header
 * promises (the clock arrives in its input) while the React surfaces read the
 * preference where they render.
 */

import { formatClock } from "./calendarItems.js";
import { strings } from "./strings.js";

const DURATION_KEY = "nexus.calendar.defaultDurationMinutes";
const CLOCK_KEY = "nexus.calendar.clock";

/** The spans the form offers, ascending — half an hour to two hours covers what a day is actually blocked out in. */
export const EVENT_DURATIONS = [30, 60, 90, 120] as const;

/** How long a freshly seeded event runs; the create form's end field is start + this. */
export type EventDurationMinutes = (typeof EVENT_DURATIONS)[number];

/** An hour: the span the form has always seeded, kept as the default so nothing changes for someone who never opens this setting. */
const DEFAULT_EVENT_DURATION: EventDurationMinutes = 60;

/**
 * The stored span, falling back to an hour for anything unrecognized.
 *
 * Blank text is guarded before the number is read, exactly as `autoLock.ts`
 * guards it and for the same reason: `Number("")` is 0, which would seed an
 * event that ends the minute it starts rather than falling back like every
 * other unusable value.
 */
export function readStoredEventDuration(): EventDurationMinutes {
  const stored = localStorage.getItem(DURATION_KEY);
  if (stored === null || stored.trim().length === 0) return DEFAULT_EVENT_DURATION;
  const minutes = Number(stored);
  return EVENT_DURATIONS.find((allowed) => allowed === minutes) ?? DEFAULT_EVENT_DURATION;
}

export function persistEventDuration(minutes: EventDurationMinutes): void {
  localStorage.setItem(DURATION_KEY, String(minutes));
}

/** Which clock every calendar time LABEL is drawn in. Time INPUTS are unaffected — the OS renders those. */
export type ClockPreference = "24h" | "12h";

/** Both clocks, the default first — the order the Settings select draws them in. */
export const CLOCK_PREFERENCES: readonly ClockPreference[] = ["24h", "12h"];

/** 24 hours is how a Serbian calendar is read; the 12-hour clock exists for someone who reads one the other way. */
const DEFAULT_CLOCK: ClockPreference = "24h";

function isClockPreference(value: string | null): value is ClockPreference {
  return value !== null && CLOCK_PREFERENCES.some((clock) => clock === value);
}

export function readStoredClock(): ClockPreference {
  const stored = localStorage.getItem(CLOCK_KEY);
  return isClockPreference(stored) ? stored : DEFAULT_CLOCK;
}

export function persistClock(clock: ClockPreference): void {
  localStorage.setItem(CLOCK_KEY, clock);
}

/**
 * Forgets both keys, so the next read is the module's own default again — the
 * calendar's half of „Izgled“'s „Vrati na podrazumevano“ (SET §5).
 *
 * The two keys are ENUMERATED, never swept by prefix:
 * `nexus.calendar.view.<profile>` and `nexus.calendar.sources.<profile>` sit
 * under the very same prefix and are a profile's own view state — which grid
 * it left off on, which sources it had switched off — not a setting this card
 * offers, and a reset that quietly re-enabled a source somebody had turned off
 * would be reaching past what it says it does.
 */
export function clearStoredCalendarPreferences(): void {
  localStorage.removeItem(DURATION_KEY);
  localStorage.removeItem(CLOCK_KEY);
}

/**
 * Minutes since midnight → the label a calendar surface draws.
 *
 * The 12-hour form is built here rather than handed to `Intl`: the calendar
 * works in minutes-since-midnight everywhere and has no `Date` to give it, the
 * shape is the one `Intl.DateTimeFormat("sr-Latn", { hour: "numeric", minute:
 * "2-digit", hour12: true })` produces anyway ("2:05 PM", "12:09 AM"), and a
 * pure arithmetic rule is testable without depending on which ICU the host
 * shipped. Midnight and noon read as 12, the minute is always padded and the
 * hour never is — the difference a user switching clocks is looking for.
 */
export function formatClockLabel(minutes: number, clock: ClockPreference): string {
  if (clock === "24h") return formatClock(minutes);
  const hours = Math.floor(minutes / 60);
  const half = hours % 12 === 0 ? 12 : hours % 12;
  const marker = hours < 12 ? strings.calendar.clock.am : strings.calendar.clock.pm;
  return `${half}:${String(minutes % 60).padStart(2, "0")} ${marker}`;
}

/** An instant's local wall clock as minutes since midnight — what the two row-time labels that hold a `Date` measure. */
export function localMinutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}
