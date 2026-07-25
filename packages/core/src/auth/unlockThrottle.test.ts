import { describe, expect, it } from "vitest";
import {
  FREE_ATTEMPTS,
  INITIAL_ATTEMPT_STATE,
  registerFailedAttempt,
  remainingLockMs,
  type AttemptState,
} from "./unlockThrottle.js";

const T0 = "2026-07-26T12:00:00.000Z";

function afterMs(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

describe("INITIAL_ATTEMPT_STATE / FREE_ATTEMPTS", () => {
  it("starts unlocked with zero failures", () => {
    expect(INITIAL_ATTEMPT_STATE).toEqual({ failedAttempts: 0, lockedUntil: null });
  });

  it("allows 4 free attempts before any waiting starts", () => {
    expect(FREE_ATTEMPTS).toBe(4);
  });
});

describe("registerFailedAttempt", () => {
  it("does not lock during the free attempts", () => {
    let state: AttemptState = INITIAL_ATTEMPT_STATE;
    for (let i = 0; i < FREE_ATTEMPTS; i++) {
      state = registerFailedAttempt(state, T0);
      expect(state.lockedUntil).toBeNull();
    }
    expect(state.failedAttempts).toBe(FREE_ATTEMPTS);
  });

  it("follows the escalating schedule: 5s, 15s, 60s, 5min, 15min after the free attempts", () => {
    let state: AttemptState = INITIAL_ATTEMPT_STATE;
    for (let i = 0; i < FREE_ATTEMPTS; i++) state = registerFailedAttempt(state, T0);

    const schedule = [5_000, 15_000, 60_000, 5 * 60_000, 15 * 60_000];
    for (const delayMs of schedule) {
      state = registerFailedAttempt(state, T0);
      expect(state.lockedUntil).toBe(afterMs(T0, delayMs));
    }
  });

  it("caps every further failure at the last schedule entry (15 min)", () => {
    let state: AttemptState = INITIAL_ATTEMPT_STATE;
    // Drive well past the schedule's end.
    for (let i = 0; i < FREE_ATTEMPTS + 5 + 10; i++) {
      state = registerFailedAttempt(state, T0);
    }
    expect(state.lockedUntil).toBe(afterMs(T0, 15 * 60_000));
  });

  it("stamps the deadline from the given `now`, not a stored clock", () => {
    let state: AttemptState = INITIAL_ATTEMPT_STATE;
    for (let i = 0; i < FREE_ATTEMPTS; i++) state = registerFailedAttempt(state, T0);
    const later = afterMs(T0, 60 * 60_000);
    state = registerFailedAttempt(state, later);
    expect(state.lockedUntil).toBe(afterMs(later, 5_000));
  });
});

describe("remainingLockMs", () => {
  it("is 0 when never locked", () => {
    expect(remainingLockMs(INITIAL_ATTEMPT_STATE, T0)).toBe(0);
  });

  it("is the exact remaining span while inside the lock window", () => {
    const state: AttemptState = { failedAttempts: 5, lockedUntil: afterMs(T0, 5_000) };
    expect(remainingLockMs(state, afterMs(T0, 2_000))).toBe(3_000);
  });

  it("is 0 exactly at and after the deadline", () => {
    const state: AttemptState = { failedAttempts: 5, lockedUntil: afterMs(T0, 5_000) };
    expect(remainingLockMs(state, afterMs(T0, 5_000))).toBe(0);
    expect(remainingLockMs(state, afterMs(T0, 6_000))).toBe(0);
  });

  it("is never negative when the clock jumps forward past the deadline", () => {
    const state: AttemptState = { failedAttempts: 5, lockedUntil: afterMs(T0, 5_000) };
    expect(remainingLockMs(state, afterMs(T0, 10_000_000))).toBe(0);
  });

  it("is never negative when the clock jumps backward before the lock was set — it only waits longer", () => {
    const state: AttemptState = { failedAttempts: 5, lockedUntil: afterMs(T0, 5_000) };
    const remaining = remainingLockMs(state, afterMs(T0, -1_000));
    expect(remaining).toBe(6_000);
    expect(remaining).toBeGreaterThanOrEqual(0);
  });

  it("treats a malformed lockedUntil as 'not locked' rather than throwing — a corrupt guard file must not brick unlocking", () => {
    const state: AttemptState = { failedAttempts: 5, lockedUntil: "not-a-date" };
    expect(() => remainingLockMs(state, T0)).not.toThrow();
    expect(remainingLockMs(state, T0)).toBe(0);
  });
});
