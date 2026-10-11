/**
 * The idle-unload timer: a loaded translation model is released after a few
 * minutes without a translation.
 *
 * **Why unload at all.** Measured on this machine (research run R13, sr→en tiny):
 * resident memory goes from 82.7 MB before loading to about 330 MB with one model
 * loaded, and loading it again costs about 317 ms including the first sentence.
 * Memory that stays for the life of the window is memory a user pays for while
 * they are doing something else, and the reload is under a third of a second —
 * so the trade is worth making as soon as the user has stopped reading.
 *
 * **Why three minutes.** The pause before a reader asks for the next sentence is
 * seconds; the pause between two looks at a page is a minute or two. Three
 * minutes is longer than either and far shorter than a session, and it is a
 * single named constant so the number is one place in the code rather than one
 * per call site. It is deliberately not configurable: a preference for this would
 * be a knob whose value every user would have to guess.
 *
 * **The clock is injected.** `setTimer`/`now` are the same shape `ModulePlatform`
 * gives main, so the same timer can be driven by `setTimeout` in the renderer and
 * by a fake clock in a test, with no second implementation to drift. The timer is
 * armed only while something is loaded, so an idle window with no model holds no
 * pending timer at all.
 */

/** How long a loaded model may sit unused before it is released. See the header for the measurement behind the number. */
export const IDLE_UNLOAD_MS = 3 * 60_000;

/** The clock and timer the idle rule runs on. `ModulePlatform` satisfies this. */
export interface IdleClock {
  now(): number;
  /** Runs `run` once the clock passes `atMs`; answers a cancel function. */
  setTimer(atMs: number, run: () => void): () => void;
}

/** The handle a caller keeps: touch it when the model is used, stop it when it is gone. */
export interface IdleUnload {
  /** Records a use: (re)arms the countdown. */
  touch(): void;
  /** Cancels the countdown and forgets that anything was loaded. */
  stop(): void;
  /** Whether a countdown is armed right now. */
  readonly pending: boolean;
}

/**
 * Builds the timer. `unload` runs once per idle period that elapses, and never
 * while no `touch` has been made — so a caller that never loaded a model can
 * never be told to unload one.
 */
export function createIdleUnload(
  clock: IdleClock,
  unload: () => void,
  idleMs: number = IDLE_UNLOAD_MS,
): IdleUnload {
  if (!(idleMs > 0)) throw new Error(`idle window must be positive, got ${String(idleMs)}`);
  let cancel: (() => void) | null = null;

  const disarm = (): void => {
    cancel?.();
    cancel = null;
  };

  return {
    touch: () => {
      disarm();
      cancel = clock.setTimer(clock.now() + idleMs, () => {
        // Disarmed BEFORE the callback runs, so an `unload` that throws (or that
        // itself calls back in) cannot leave a stale cancel function armed.
        cancel = null;
        unload();
      });
    },
    stop: disarm,
    get pending() {
      return cancel !== null;
    },
  };
}
