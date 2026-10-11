import type { Locale } from "../../../renderer/src/strings.js";

/**
 * PUZZLES' number and clock formatting, as pure functions (ADR-090).
 *
 * **Why the locale is an argument rather than read here.** The page reads the
 * active locale once per render (`activeLocale`) and hands it down, which keeps
 * this file free of the shell and every expected string in its test a value the
 * test states rather than a value the environment happens to hold. The
 * alternative — reading `activeLocale()` inside — would make a test that asks
 * about Serbian depend on whatever the previous test left the shell in.
 *
 * **`sr-Latn`, not `sr`.** CLAUDE.md's rule for sorting has the same reason
 * here: plain `"sr"` is the Cyrillic tail of the tag, and a Serbian reader of
 * this app reads Latin. The two collide on grouping and on the decimal comma,
 * which is exactly what a count and a distance are printed with.
 */

/** A count, a distance or a score, in the reader's own digits. */
export function formatCount(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "sr" ? "sr-Latn" : "en").format(value);
}

/**
 * A length in pixels, with its unit, through `Intl` rather than as a glued
 * string: „22 px" is what the reader's own locale puts between the number and
 * the unit, and a board's cell size is a measurement a person can act on when
 * they are deciding whether the grid is readable yet.
 */
export function formatPixels(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "sr" ? "sr-Latn" : "en", {
    style: "unit",
    unit: "pixel",
    unitDisplay: "short",
  }).format(value);
}

/**
 * `mm:ss`, or `h:mm:ss` past an hour — the shape a clock is read in, never a
 * duration written out in words.
 *
 * Truncated rather than rounded: a clock that showed 0:02 before two seconds had
 * passed would be claiming time nobody has spent yet, which is the same rule the
 * stopwatch in the timers module follows.
 */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const tail = `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return hours > 0 ? `${String(hours)}:${tail}` : tail;
}

/**
 * How long a game has been open, in whole seconds.
 *
 * `banked` is what earlier runs of the clock added up to and `startedAtMs` is
 * the `performance.now()` reading the current run began at, or `null` while the
 * clock is stopped. A delta and not a counter, on the timers module's terms: an
 * interval that a hidden window throttles would make a counter fall behind, and
 * a game saved from a page that was away would carry the wrong time.
 */
export function elapsedSecondsOf(
  bankedSeconds: number,
  startedAtMs: number | null,
  nowMs: number,
): number {
  const current = startedAtMs === null ? 0 : Math.max(0, nowMs - startedAtMs);
  return Math.max(0, Math.floor(bankedSeconds + current / 1000));
}
