import { describe, expect, it, vi } from "vitest";

import { createIdleUnload, IDLE_UNLOAD_MS, type IdleClock } from "./idle.js";

/**
 * The idle-unload rule on a fake clock. A real `setTimeout` would make the test
 * take a quarter of an hour to ask one question, so the clock is a list of
 * armed timers and `advance()` fires the ones that are due — which also makes
 * the assertions about RE-ARMING exact: the point of the rule is that a use
 * pushes the deadline out, and a test that could not see the deadline would
 * accept a timer that never moved.
 */

interface FakeClock extends IdleClock {
  advance(ms: number): void;
  readonly armed: number;
}

function fakeClock(startAt = 1_000_000): FakeClock {
  let now = startAt;
  let serial = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    setTimer: (at, run) => {
      const id = ++serial;
      timers.set(id, { at, run });
      return () => timers.delete(id);
    },
    get armed() {
      return timers.size;
    },
    advance: (ms) => {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.run();
      }
    },
  };
}

describe("createIdleUnload", () => {
  it("does nothing until something is touched", () => {
    const clock = fakeClock();
    const unload = vi.fn();
    const idle = createIdleUnload(clock, unload);

    expect(idle.pending).toBe(false);
    clock.advance(10 * IDLE_UNLOAD_MS);
    expect(unload).not.toHaveBeenCalled();
  });

  it("releases the model once the window passes with no use", () => {
    const clock = fakeClock();
    const unload = vi.fn();
    const idle = createIdleUnload(clock, unload);

    idle.touch();
    expect(idle.pending).toBe(true);
    clock.advance(IDLE_UNLOAD_MS - 1);
    expect(unload).not.toHaveBeenCalled();
    clock.advance(1);
    expect(unload).toHaveBeenCalledTimes(1);
    expect(idle.pending).toBe(false);
    // And it does not fire again: the model is already gone.
    clock.advance(10 * IDLE_UNLOAD_MS);
    expect(unload).toHaveBeenCalledTimes(1);
  });

  it("pushes the deadline out on every use, and keeps exactly one timer", () => {
    const clock = fakeClock();
    const unload = vi.fn();
    const idle = createIdleUnload(clock, unload);

    idle.touch();
    clock.advance(IDLE_UNLOAD_MS - 1);
    idle.touch();
    expect(clock.armed).toBe(1);
    clock.advance(IDLE_UNLOAD_MS - 1);
    expect(unload).not.toHaveBeenCalled();
    clock.advance(1);
    expect(unload).toHaveBeenCalledTimes(1);
  });

  it("stops on request, and can be armed again afterwards", () => {
    const clock = fakeClock();
    const unload = vi.fn();
    const idle = createIdleUnload(clock, unload);

    idle.touch();
    idle.stop();
    expect(idle.pending).toBe(false);
    clock.advance(10 * IDLE_UNLOAD_MS);
    expect(unload).not.toHaveBeenCalled();

    idle.touch();
    clock.advance(IDLE_UNLOAD_MS);
    expect(unload).toHaveBeenCalledTimes(1);
  });

  it("honours a shorter window when one is given, and refuses a window that is not positive", () => {
    const clock = fakeClock();
    const unload = vi.fn();
    const idle = createIdleUnload(clock, unload, 500);
    idle.touch();
    clock.advance(500);
    expect(unload).toHaveBeenCalledTimes(1);
    expect(() => createIdleUnload(clock, unload, 0)).toThrow();
  });
});
