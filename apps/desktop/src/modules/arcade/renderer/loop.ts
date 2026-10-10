import { useCallback, useEffect, useRef, useState } from "react";

/**
 * ARCADE's frame arithmetic and the two things every game here pauses for
 * (ADR-090): how much of a frame is owed to an engine, how a held key repeats,
 * and what a window that lost focus costs the clock.
 *
 * **Why the maths is here rather than in a component.** Five games step five
 * engines, and every one of them needs the same three answers: is a tick due, how
 * many keystrokes has a held key earned, and where does the clock stand when the
 * window comes back. Those are pure functions of numbers, so they are tested as
 * numbers; what is left in the components is only what needs a canvas, a listener
 * and a `setState`.
 *
 * **The clock is the caller's, and it is monotonic.** Every function below takes
 * a reading of the same clock the engines take (`performance.now()`, or a
 * requestAnimationFrame timestamp, which is that plus the frame's own offset) and
 * only DIFFERENCES matter. A system clock that steps backwards moves no game
 * here, because no game reads one: `Date.now()` appears only where a duration is
 * reported to main as a finished fact.
 *
 * **A pause DROPS the backlog rather than replaying it.** `resumeAt` moves a
 * game's last-step reading forward to now, so the frames it spent behind a
 * blurred window are gone. The alternative - letting the engine catch up - would
 * drop eleven rows of Blocks on the player who came back, and the engine's own
 * `SNAKE_MAX_TICKS_PER_STEP` states the same policy one level down: past a few
 * ticks, the honest answer is the clock the caller now has.
 */

/** How long a cleared row stays lit when the system allows motion. */
export const FLASH_MS = 180;

/**
 * The whole ticks between two readings, never more than `maxTicks` and never
 * negative.
 *
 * A reading at or before the last one owes nothing: a frame that arrives with the
 * same timestamp, or a clock that stepped back, is a step with no time in it, and
 * saying so is what lets a caller skip the engine entirely and hand React the
 * state it already had.
 */
export function planTicks(lastTickAt: number, now: number, tickMs: number, maxTicks: number): number {
  if (!Number.isFinite(tickMs) || tickMs <= 0) {
    throw new RangeError(`planTicks: the tick must be a positive number of ms, got ${String(tickMs)}`);
  }
  if (!Number.isInteger(maxTicks) || maxTicks < 1) {
    throw new RangeError(`planTicks: maxTicks must be a whole number of at least 1, got ${String(maxTicks)}`);
  }
  const elapsed = now - lastTickAt;
  if (elapsed < tickMs) return 0;
  return Math.min(maxTicks, Math.floor(elapsed / tickMs));
}

/**
 * How many REPEATS a held key has earned by `heldMs`, not counting the press
 * itself: nothing before `dasMs`, one at `dasMs`, and one every `arrMs` after it.
 *
 * This is the arithmetic behind delayed auto shift, and it is a function of the
 * clock rather than of a frame: the caller keeps how many it has already
 * delivered, and delivers `repeatCount(...) - delivered` more. A frame that was
 * late therefore delivers the keystrokes it owed, and a frame that arrived early
 * delivers none - the two halves of "a held key repeats at a rate, not at a
 * frame rate".
 */
export function repeatCount(heldMs: number, dasMs: number, arrMs: number): number {
  if (!Number.isFinite(arrMs) || arrMs < 1) {
    throw new RangeError(`repeatCount: the auto-repeat rate must be at least 1 ms, got ${String(arrMs)}`);
  }
  if (!Number.isFinite(dasMs) || dasMs < 0) {
    throw new RangeError(`repeatCount: the delay must not be negative, got ${String(dasMs)}`);
  }
  if (heldMs < dasMs) return 0;
  return 1 + Math.floor((heldMs - dasMs) / arrMs);
}

/**
 * A game whose window lost focus, moved forward to `now`.
 *
 * The state is untouched but for its own last-step reading, which is the whole
 * of "the frames you were away are not owed to you" (see the file header). Typed
 * as a spread rather than per engine, because all three engines carry that
 * reading under the same name and none of them is special here.
 */
export function resumeAt<S extends { readonly lastTickAt: number }>(state: S, now: number): S {
  return { ...state, lastTickAt: now };
}

/**
 * A finished game's time as the store records it: the span the engine measured,
 * less the time the window was not in front, and never below one millisecond
 * (the store's own floor, migration 080).
 *
 * The engine's number is wall-clock between two instants and stays its own -
 * this is the page's one deduction, and it exists because a Minesweeper clock
 * that kept running while the app was behind another window would make the
 * recorded best a fact about the player's interruptions rather than about the
 * board.
 */
export function netElapsedMs(rawElapsedMs: number, pausedMs: number): number {
  return Math.max(1, Math.round(rawElapsedMs - Math.max(0, pausedMs)));
}

/**
 * How long a cleared-row flash lasts: nothing when the system asks for less
 * motion, and `FLASH_MS` otherwise.
 *
 * Disabled rather than shortened, which is the design system's own rule for
 * reduced motion - and it is a real value rather than a CSS class because the
 * flash is painted on a canvas.
 */
export function flashDurationMs(reduceMotion: boolean): number {
  return reduceMotion ? 0 : FLASH_MS;
}

/**
 * A seed for a fresh game.
 *
 * Not a secret and not a replay log: the engines keep their own deterministic
 * stream from here, and a game is reproduced from the seed plus the inputs, which
 * is what a report of a game would carry. This is only where the first number
 * comes from, and a game started twice in the same millisecond must not be the
 * same game - hence both readings.
 */
export function newSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x1_0000_0000)) >>> 0;
}

/** What a game knows about the window: whether it is in front, and how long it was not. */
export interface WindowFocus {
  readonly paused: boolean;
  /** Milliseconds this game has spent paused since `resetPause`, which is the deduction its clock owes. */
  readonly pausedMs: number;
  resume(): void;
  /** Forgets the accumulated pause, for a game that has just been restarted. */
  resetPause(): void;
}

/**
 * Whether the window is in front, and how long it has not been.
 *
 * Both signals are watched, and they are not the same one: `blur` fires when
 * another window takes focus (the OS-level "you are somewhere else") and
 * `visibilitychange` when this document is hidden or shown (the renderer's own
 * "throttle everything"). A game that watched only one would keep stepping in the
 * case the other describes.
 *
 * Pausing is the caller's decision, not this hook's: it reports, and a game that
 * is already over or not started yet simply ignores it.
 */
export function useWindowFocus(): WindowFocus {
  const [paused, setPaused] = useState(false);
  const [pausedMs, setPausedMs] = useState(0);
  /** When the current pause began, or null while the window is in front. */
  const pausedSince = useRef<number | null>(null);

  const pause = useCallback(() => {
    if (pausedSince.current !== null) return;
    pausedSince.current = performance.now();
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    const since = pausedSince.current;
    if (since === null) return;
    pausedSince.current = null;
    setPausedMs((total) => total + (performance.now() - since));
    setPaused(false);
  }, []);

  const resetPause = useCallback(() => {
    pausedSince.current = null;
    setPausedMs(0);
    setPaused(false);
  }, []);

  useEffect(() => {
    const onBlur = (): void => pause();
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") pause();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pause]);

  return { paused, pausedMs, resume, resetPause };
}

/**
 * Whether the operating system asks for less motion, kept current.
 *
 * The design system's one product-wide CSS rule already collapses every
 * transition; this is for the one animation that is painted onto a canvas and
 * therefore cannot be reached by a stylesheet.
 */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => prefersReducedMotion());

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (): void => setReduce(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduce;
}

/** The media query read once, for the first render (the hook above subscribes afterwards). */
function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A flag that is true for one flash after `value` changes, and false otherwise.
 *
 * This is the whole of the page's animation: a cleared line brightens the count
 * that just moved, and nothing else in these five games moves except the game
 * itself. It is a flag rather than a drawn effect so that the product-wide
 * reduced-motion rule in `@nexus/ui`'s stylesheet reaches it as well as
 * `flashDurationMs` does - and with `reduceMotion` the flag is never set at all,
 * which is the design system's "disabled, not shortened".
 */
export function useFlash(value: number, reduceMotion: boolean): boolean {
  const [flashing, setFlashing] = useState(false);
  /** The value the last commit saw, so the FIRST render is not a change. */
  const previous = useRef(value);

  useEffect(() => {
    const duration = flashDurationMs(reduceMotion);
    const changed = previous.current !== value;
    previous.current = value;
    if (!changed) {
      // Not a change: the only thing left to honour is a preference that turned
      // reduced motion on while a flash was still lit.
      if (duration === 0) setFlashing(false);
      return;
    }
    if (duration === 0) {
      setFlashing(false);
      return;
    }
    setFlashing(true);
    const handle = window.setTimeout(() => setFlashing(false), duration);
    return () => window.clearTimeout(handle);
  }, [value, reduceMotion]);

  return flashing;
}

/**
 * Runs `run` on every animation frame while `running`, with the frame's own
 * monotonic timestamp.
 *
 * `run` is expected to be stable (a `useCallback` whose body reads refs) and is a
 * dependency of the effect, so a game that rebuilds its callback every render
 * restarts the loop every render - one rAF, no leak, and no way to lose a frame.
 * The loop stops by simply not being scheduled: a paused or finished game has no
 * frame pending at all, which is what keeps a blurred window from burning a
 * core's worth of `setState` calls.
 */
export function useFrameLoop(run: (now: number) => void, running: boolean): void {
  useEffect(() => {
    if (!running) return;
    let handle = requestAnimationFrame(function frame(time: number): void {
      run(time);
      handle = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(handle);
  }, [run, running]);
}
