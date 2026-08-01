/**
 * Pure formatting helpers for the ONE focus timer (STUDY piece 4b, widened by
 * UTIL slice b): the live readout of a running phase, a duration label shared by
 * the per-subject minute totals and every session list, and a session's day+time
 * label. Mirrors reviewIntervals.ts's small-pure-helper-module idiom.
 *
 * Serves both surfaces — „Učenje"'s card and „Fokus"'s page — because they show
 * the same timer, and two formatters would be two ways of writing the same
 * minute.
 */

import type { FocusPhaseProgress } from "@nexus/core";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

/** Zero-pads a non-negative integer to two digits. */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Live elapsed readout for the running focus timer: "mm:ss" under an hour,
 * "h:mm:ss" at or above (hours unpadded, minutes/seconds always two digits).
 * Negative input (a clock skew edge case) clamps to zero.
 */
export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / SECOND_MS));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(minutes)}:${pad2(seconds)}`;
}

/**
 * The big readout on „Fokus" — one string covering all three things a phase's
 * clock can be saying.
 *
 * - **A planned phase counts DOWN**, because what a Pomodoro is about is the
 *   time still to give it.
 * - **An open-ended one counts UP**, because there is nothing for it to be short
 *   of — STUDY's timer has always read this way, and this is the same reading.
 * - **Past the plan it counts up again, with a `+`.** That leading sign is the
 *   whole point: `phaseProgress` pins `remainingSeconds` at 0 the moment the
 *   plan is met and grows `overrunSeconds` instead, and a clock that showed the
 *   pinned zero would look like a phase that had tidily ended. It has not — the
 *   engine deliberately ends nothing, because ending is a deliberate act — so
 *   the readout says how far past it is rather than pretending it is over.
 *
 * A PAUSED phase is formatted exactly like a running one, and nothing here has
 * to know it is paused: the engine has already frozen the numbers at `pausedAt`,
 * so a frozen 20:00 renders as 20:00. The page says „pauzirano" in words and in
 * its styling, which is where that fact belongs.
 */
export function formatPhaseClock(
  progress: FocusPhaseProgress,
  plannedMinutes: number | null,
): string {
  if (plannedMinutes === null) return formatElapsed(progress.elapsedSeconds * SECOND_MS);
  if (progress.overrunSeconds > 0) return `+${formatElapsed(progress.overrunSeconds * SECOND_MS)}`;
  return formatElapsed(progress.remainingSeconds * SECOND_MS);
}

/**
 * Duration label for a whole number of minutes: "45 min" under an hour,
 * "1 h 5 min" at or above (the minutes part is always shown, even at 0, so
 * "2 h 0 min" reads consistently rather than silently dropping a unit).
 */
export function formatDurationMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} h ${rest} min`;
}

/**
 * Whole-minute ATTENTION of a finished focus session: the wall span
 * (`endedAt` − `startedAt`) **less the seconds it spent paused**, rounded, with
 * an unparseable endpoint reading as 0 like every other unusable input.
 *
 * `pausedSeconds` is required rather than optional on purpose. Migration 057
 * made pausing possible, and every caller here sums these minutes into a figure
 * a user reads as „how long I focused" — so a caller that has not thought about
 * pause time should fail to compile rather than quietly over-report it. Every
 * pre-057 row carries 0, so no number anyone has already seen moves.
 */
export function focusSessionMinutes(session: {
  startedAt: string;
  endedAt: string;
  pausedSeconds: number;
}): number {
  const spanMs = new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime();
  // An unparseable endpoint makes the difference NaN, and NaN escapes the clamp
  // (`Math.max(0, NaN)` is NaN), so finiteness is decided before it.
  if (!Number.isFinite(spanMs)) return 0;
  const pausedMs = Number.isFinite(session.pausedSeconds)
    ? Math.max(0, session.pausedSeconds) * SECOND_MS
    : 0;
  return Math.max(0, Math.round((spanMs - pausedMs) / MINUTE_MS));
}

/**
 * Recent-session row label — sr-Latn weekday, day, month and start time, e.g.
 * "sreda, 8. jul, 14:32". `startedAt` is a real instant (not a bare calendar
 * date), so it is parsed and formatted in the host's local time zone, exactly
 * like `formatCardDue`. Raw input on an unparseable string.
 */
export function formatFocusSessionWhen(startedAt: string): string {
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return startedAt;
  const day = new Intl.DateTimeFormat("sr-Latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
  const time = new Intl.DateTimeFormat("sr-Latn", { hour: "2-digit", minute: "2-digit" }).format(date);
  return `${day}, ${time}`;
}
