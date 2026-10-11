/**
 * The metronome's look-ahead loop, as pure arithmetic (the page's half of
 * `@nexus/core`'s `beatSchedule`).
 *
 * **Why a look-ahead and never a click per tick.** `setInterval` drifts and is
 * throttled in a hidden window, so a metronome built on it audibly wanders after
 * a minute. The loop that plays a metronome instead wakes often (every
 * `LOOKAHEAD_INTERVAL_MS`) and schedules every click that falls inside a window
 * ahead of the clock (`LOOKAHEAD_HORIZON_SECONDS`), handing each one a time on
 * the audio clock. The audio hardware then plays it exactly, whatever the main
 * thread is doing. That is the standard shape, and it splits into one part that
 * needs a running `AudioContext` (the page) and one that is pure arithmetic
 * (this file, which is therefore testable).
 *
 * **The window rule lives in the engine, and this file's job is the loop around
 * it.** `beatSchedule` answers every click in `[from, to)` and its own comment
 * explains why membership is decided in index space; what it does not answer is
 * where the next window starts, and that is what would go wrong here. Two rules
 * follow from it and are the ones the tests pin: the cursor advances by exactly
 * the window it asked for (so two adjacent windows join with no gap and no
 * repeat), and a cursor that has fallen behind the clock - a suspended machine,
 * a stall, a throttled window - jumps to the clock rather than scheduling a
 * burst of clicks in the past.
 *
 * Time is SECONDS throughout, matching `AudioContext.currentTime`.
 */
import {
  beatSchedule,
  type BeatAccent,
  type MetronomeClick,
  type MetronomeSpec,
} from "@nexus/core";

/** How far ahead of the clock clicks are scheduled, in seconds. */
export const LOOKAHEAD_HORIZON_SECONDS = 0.25;

/** How often the loop wakes, in milliseconds. Well under the horizon, so a late wake is still covered. */
export const LOOKAHEAD_INTERVAL_MS = 50;

export interface MetronomeWindow {
  readonly fromSeconds: number;
  readonly toSeconds: number;
  readonly clicks: readonly MetronomeClick[];
}

/** The window the loop asked for: the clicks in `[from, from + horizon)`. */
export function metronomeWindow(
  spec: MetronomeSpec,
  fromSeconds: number,
  horizonSeconds = LOOKAHEAD_HORIZON_SECONDS,
): MetronomeWindow {
  if (!Number.isFinite(fromSeconds)) throw new RangeError("the cursor must be a finite time");
  if (!Number.isFinite(horizonSeconds) || horizonSeconds <= 0) {
    throw new RangeError("the horizon must be a positive number of seconds");
  }
  const toSeconds = fromSeconds + horizonSeconds;
  return { fromSeconds, toSeconds, clicks: beatSchedule(spec, fromSeconds, toSeconds) };
}

/**
 * Where the next window starts, given where the loop thinks it is and what the
 * audio clock now says.
 *
 * Equal in the ordinary case - the loop is ahead of the clock and simply walks
 * forward one horizon at a time. It moves forward only when the cursor has
 * fallen BEHIND the clock, and then all the way to the clock: a machine that
 * slept through a minute of a metronome must not be handed a minute of clicks to
 * schedule at once, because those instants are already past and every one of
 * them would sound immediately.
 */
export function resumeCursor(cursorSeconds: number, nowSeconds: number): number {
  if (!Number.isFinite(cursorSeconds) || !Number.isFinite(nowSeconds)) {
    throw new RangeError("a cursor is a finite time");
  }
  return Math.max(cursorSeconds, nowSeconds);
}

/**
 * The gain a click is played at: an accented beat is loudest, a plain beat is
 * quieter, and a subdivision between beats is quieter still. Multiplying rather
 * than replacing keeps the subdivision of an accented beat audible above the
 * subdivision of a plain one, which is what a musician counting in subdivisions
 * expects to hear.
 */
export function clickGain(click: MetronomeClick): number {
  const level: Record<BeatAccent, number> = { strong: 1, weak: 0.62, off: 0 };
  return click.onBeat ? level[click.accent] : level[click.accent] * 0.45;
}

/**
 * The click that is SOUNDING at `atSeconds` among the ones already scheduled -
 * what the visual pulse shows.
 *
 * It answers from the scheduled clicks rather than recomputing the grid, so the
 * dot on screen and the click in the ear can never come from two different
 * calculations. `null` means nothing has sounded yet, which is the honest answer
 * a moment after the metronome starts.
 */
export function pulseAt(
  scheduled: readonly MetronomeClick[],
  atSeconds: number,
): MetronomeClick | null {
  let current: MetronomeClick | null = null;
  for (const click of scheduled) {
    if (click.timeSeconds > atSeconds) break;
    current = click;
  }
  return current;
}
