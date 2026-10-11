/**
 * The Morse lamp's one question: at this instant, is the lamp on?
 *
 * **Why this is a function of an instant rather than a list of timeouts.** The
 * page drives the lamp from a `requestAnimationFrame` loop, which is the shape
 * that stops when the window is hidden, catches up without drift when the
 * renderer was throttled, and needs no timer per mark. A chain of `setTimeout`s
 * would instead queue a flash per mark and keep firing them after the user
 * pressed stop, which for a photosensitivity-relevant surface is the failure
 * that matters.
 *
 * **The schedule is `@nexus/core`'s own signals engine**, so the timing here is
 * the PARIS standard the Morse alphabet is sent at (`morseSchedule`,
 * `signals/morse.ts`) and not a second idea of what a dash is. This file adds
 * only the instant-to-state lookup, which is deliberately total: a schedule has
 * a finite length, and an instant past its end is OFF rather than a wrap.
 */

import type { MorseInterval } from "../signals/morse.js";

/**
 * Whether a schedule's lamp is lit `atMs` after it started.
 *
 * The boundaries belong to the interval that STARTS at them: at exactly the end
 * of a mark the following silence has begun, and at exactly the end of a silence
 * the next mark has begun. That is the reading a caller wants when it asks
 * "should this frame be lit", and it is what makes a zero-length interval
 * impossible to hang on.
 */
export function lampOnAt(intervals: readonly MorseInterval[], atMs: number): boolean {
  if (!Number.isFinite(atMs) || atMs < 0) return false;
  let cursor = 0;
  for (const interval of intervals) {
    cursor += interval.ms;
    if (atMs < cursor) return interval.on;
  }
  return false;
}
