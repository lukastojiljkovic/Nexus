/**
 * THE DOCK'S PURE RULES: how wide it is, when a turn's places open, and whether
 * the thread is still at its bottom.
 *
 * **Why these are not inline.** Each one is a decision that is easy to get subtly
 * wrong and that the page and the dock both depend on: a location that opens
 * twice, a width that is remembered out of range, a thread that yanks the reader
 * back down while they read something above the stream. None needs React to be
 * stated, so each is stated here and tested without rendering anything.
 */

/**
 * The dock's width bounds and its first width, in CSS pixels. These are policy
 * choices, not measurements: narrow enough to leave the page beside it a measure
 * to read, wide enough for a tool line to stay on one row.
 */
export const DOCK_WIDTH = { min: 320, max: 640, initial: 380 } as const;

/** The device preference's key. A width is a property of the screen, not of the profile. */
export const DOCK_WIDTH_KEY = "nexus.assistantDockWidth";

/** The width, held inside the bounds: a remembered value from a larger screen cannot push the page off it. */
export function clampDockWidth(width: number): number {
  return Math.min(DOCK_WIDTH.max, Math.max(DOCK_WIDTH.min, Math.round(width)));
}

/** The width the device remembers, or the first width when nothing usable is stored. */
export function readStoredDockWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(DOCK_WIDTH_KEY));
    return stored > 0 ? clampDockWidth(stored) : DOCK_WIDTH.initial;
  } catch {
    return DOCK_WIDTH.initial;
  }
}

/** Remembers the width. A storage that refuses the write keeps the width for this session only. */
export function writeStoredDockWidth(width: number): void {
  try {
    window.localStorage.setItem(DOCK_WIDTH_KEY, String(clampDockWidth(width)));
  } catch {
    // The width still applies for this session; the next launch starts at the first width.
  }
}

/**
 * When a tool result's place is opened. A docked assistant stays mounted while the
 * page beside it changes, so the turn carries on and the place opens as the result
 * arrives. The full page unmounts when it leaves, so it keeps the end-of-turn rule:
 * the answer is saved before the view moves (`turnLocations.ts`). This is the one
 * helper that says which rule applies, so the two cannot both fire for one place.
 */
export type LocationTiming = "as-it-arrives" | "at-turn-end";

export function locationTiming(docked: boolean): LocationTiming {
  return docked ? "as-it-arrives" : "at-turn-end";
}

/**
 * How far above the bottom a reader may be and still count as reading the stream.
 * A policy choice: about one line of the thread's own text, so a small scroll that
 * the reader did not mean to make does not switch following off.
 */
export const FOLLOW_SLACK_PX = 24;

/** Whether a thread is scrolled to its bottom, within `slack`. Read on a scroll, so a reader who scrolls up stops the follow. */
export function isNearBottom(
  scroll: { readonly scrollTop: number; readonly scrollHeight: number; readonly clientHeight: number },
  slack: number = FOLLOW_SLACK_PX,
): boolean {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight <= slack;
}
