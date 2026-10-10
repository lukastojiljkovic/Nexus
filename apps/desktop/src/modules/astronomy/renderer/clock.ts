/**
 * The one clock the four views share, as data and pure functions.
 *
 * **Why one clock at all.** The corner's whole promise is that its four views
 * agree: the planet the solar view draws, the terminator the day-and-night map
 * draws, the sky the star map draws and the rise and set the panel prints are
 * the same instant seen four ways. Four independent `Date.now()` reads would be
 * four instants a second apart, and the moment the user pins a time they would
 * still be four different times.
 *
 * **Two states, and one of them ticks.** `now` follows the wall clock — the page
 * re-reads `Date.now()` once a second and hands it here — and `fixed` stands
 * still at the moment the user picked. `now` is one click away from either, which
 * is the other half of the promise: a pinned moment is a lens, never a place the
 * page silently stays.
 *
 * The functions are pure so the arithmetic — which state a tick advances, what a
 * `datetime-local` field value means, and that the two round-trip — is testable
 * without a DOM (`clock.test.ts`).
 */

export interface SkyClock {
  /** Whether the clock follows the machine or stands at a chosen instant. */
  readonly mode: "now" | "fixed";
  /** Epoch milliseconds of the instant on screen. */
  readonly instantMs: number;
}

/** The clock following the machine, read at `atMs`. */
export function nowClock(atMs: number): SkyClock {
  return { mode: "now", instantMs: atMs };
}

/** The clock standing at one instant. */
export function fixedClock(atMs: number): SkyClock {
  return { mode: "fixed", instantMs: atMs };
}

/**
 * One second's tick: a machine-following clock moves, a pinned one does not.
 *
 * A pinned clock is deliberately NOT re-based to the machine on a tick — the
 * whole point of pinning is that time passes and the picture does not.
 */
export function tickClock(clock: SkyClock, nowMs: number): SkyClock {
  return clock.mode === "now" ? nowClock(nowMs) : clock;
}

/** Whether the clock is following the machine — what the Now button keys its own state off. */
export function isFollowing(clock: SkyClock): boolean {
  return clock.mode === "now";
}

/** The two digits a date or time part is written with. */
function two(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The `datetime-local` value for an instant, in the MACHINE's own zone.
 *
 * The local getters rather than `toISOString`: a `datetime-local` field has no
 * zone in it, and the value the user reads back must be the wall-clock time
 * their other clocks show. Minutes are the field's own resolution, so seconds
 * are dropped rather than rounded.
 */
export function datetimeLocalValue(atMs: number): string {
  const at = new Date(atMs);
  return (
    `${String(at.getFullYear()).padStart(4, "0")}-${two(at.getMonth() + 1)}-${two(at.getDate())}` +
    `T${two(at.getHours())}:${two(at.getMinutes())}`
  );
}

/**
 * A `datetime-local` value as an instant, or `null`.
 *
 * The shape is checked before `Date` sees it, and the check is the point rather
 * than pedantry: an empty string is what a field holds mid-edit and `new
 * Date("")` is the day before the epoch, so a page that handed it on would jump
 * the whole corner to 1969 on every backspace. A date WITHOUT a time
 * (`2026-10-10`) is refused too, because `Date` reads that form as UTC while it
 * reads the full form as local time — two meanings for one field.
 */
export function parseDatetimeLocal(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (match === null) return null;
  const [, year = "", month = "", day = "", hour = "", minute = "", second = "0"] = match;
  const at = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (Number.isNaN(at.getTime())) return null;
  // `Date` rolls a day outside the month over (February 30 becomes March 2), so
  // the fields are read back: a value that did not survive the round trip is not
  // a value this field can hold.
  return datetimeLocalValue(at.getTime()) === `${year}-${month}-${day}T${hour}:${minute}`
    ? at.getTime()
    : null;
}
