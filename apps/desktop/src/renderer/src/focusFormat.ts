/**
 * Pure formatting helpers for the STUDY focus timer and stats (piece 4b): a
 * live elapsed readout for the running timer, a duration label shared by the
 * per-subject minute totals and the recent-sessions list, and the recent
 * session's day+time label. Mirrors reviewIntervals.ts's small-pure-helper-
 * module idiom.
 */

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
 * Whole-minute duration of a completed focus session (`endedAt` − `startedAt`),
 * rounded, with an unparseable endpoint reading as 0 like every other unusable
 * input.
 */
export function focusSessionMinutes(session: { startedAt: string; endedAt: string }): number {
  const ms = new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime();
  // An unparseable endpoint makes the difference NaN, and NaN escapes the clamp
  // (`Math.max(0, NaN)` is NaN), so finiteness is decided before it.
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / MINUTE_MS)) : 0;
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
