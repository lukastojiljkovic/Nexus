import type { TimersCountdownView } from "../shared/ipc.js";

/**
 * TIMERS' clock arithmetic, as pure functions (ADR-090).
 *
 * **Why every clock on the page is derived from an INSTANT.** A countdown is
 * stored by the moment it ends, and this module's whole promise is that it keeps
 * running while the page is closed. A renderer that counted ticks down from a
 * starting number would therefore be wrong twice over: wrong while the window is
 * hidden (browsers throttle timers, so the seconds it counted would fall behind
 * the real clock), and wrong the moment the page reloads. So nothing here counts
 * anything - `remainingSecondsOf` answers from `endsAt` and a `now` the page
 * reads, which is the same rule `focusFormat`/`phaseProgress` follow one module
 * over and the same one the store's own maths follows.
 *
 * **Why it lives in the module's folder.** The maths is this module's, and the
 * kit's rule is that a module's files are its own. It is also the half of the
 * page that can be tested without a DOM, which is why it is not written inline
 * in the component.
 */

/** `mm:ss`, or `h:mm:ss` past an hour — the shape a timer is read in, never a duration written out in words. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const tail = `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return hours > 0 ? `${String(hours)}:${tail}` : tail;
}

/**
 * The stopwatch readout: `mm:ss.cc`, or `h:mm:ss.cc`.
 *
 * Hundredths, because a stopwatch whose splits cannot tell one lap from another
 * is not measuring what a stopwatch is for. Truncated rather than rounded, on
 * `Math.floor`'s terms: a clock that showed 12.35 before 12.35 had happened
 * would be claiming time the user has not spent yet.
 */
export function formatStopwatch(elapsedMs: number): string {
  const centiseconds = Math.max(0, Math.floor(elapsedMs / 10));
  const hundredths = String(centiseconds % 100).padStart(2, "0");
  return `${formatClock(Math.floor(centiseconds / 100))}.${hundredths}`;
}

/** Whether a countdown's clock runs: the schema's own rule (`endsAt` set ⇔ running), never a local opinion about it. */
export function isRunning(countdown: TimersCountdownView): boolean {
  return countdown.endsAt !== null;
}

/**
 * What a countdown has left, in whole seconds.
 *
 * A RUNNING countdown is measured against the instant it ends, so the number is
 * the same whether this page has been open the whole time, was just opened, or
 * was never open at all. `Math.ceil` rather than a floor: with 0.4 seconds left
 * the honest answer is "1 second to go", where a floor would show 0 and read as
 * finished while the toast is still coming.
 *
 * A PAUSED one holds the seconds it still owes (`remainingSeconds`), which is the
 * same fact stated the other way round - see migration 071's CHECK.
 */
export function remainingSecondsOf(countdown: TimersCountdownView, nowMs: number): number {
  if (countdown.endsAt === null) return Math.max(0, countdown.remainingSeconds ?? 0);
  const endsAtMs = Date.parse(countdown.endsAt);
  // An unreadable instant answers 0 rather than NaN: a row that cannot be parsed
  // is one this page cannot count, and `NaN` on screen is worse than a zero that
  // the next read will correct.
  if (Number.isNaN(endsAtMs)) return 0;
  return Math.max(0, Math.ceil((endsAtMs - nowMs) / 1000));
}

/** How much of a countdown is behind us, as a fraction in `0..1` — what its track is filled to. */
export function elapsedFraction(countdown: TimersCountdownView, nowMs: number): number {
  const total = Math.max(1, countdown.durationSeconds);
  const remaining = remainingSecondsOf(countdown, nowMs);
  return Math.min(1, Math.max(0, (total - remaining) / total));
}

/** The countdown form's three fields, as text, because a half-typed number is not a value. */
export interface DurationFields {
  readonly hours: string;
  readonly minutes: string;
  readonly seconds: string;
}

/**
 * The form's three fields as one duration in whole seconds, or `null` when they
 * do not spell one this module accepts.
 *
 * The bounds are the STORE's (`1..86 400` seconds, migration 071's CHECK), and
 * so are the per-field ones: a minute field holding "90" is a value the user
 * cannot have meant, and answering `null` is what lets the form refuse it under
 * the field rather than silently storing 90 minutes as an hour and a half.
 *
 * An empty field is zero, which is what makes „5 min" typeable as one number in
 * one box.
 */
export function durationSecondsOf(fields: DurationFields): number | null {
  const hours = wholeNumber(fields.hours);
  const minutes = wholeNumber(fields.minutes);
  const seconds = wholeNumber(fields.seconds);
  if (hours === null || minutes === null || seconds === null) return null;
  if (hours > 24 || minutes > 59 || seconds > 59) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return total >= 1 && total <= 86_400 ? total : null;
}

/** A field as a whole number, or `null`. An empty field is 0; anything that is not digits is `null`. */
function wholeNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  return Number(trimmed);
}
