import { describe, expect, it } from "vitest";

import { FLASH_MS, flashDurationMs, netElapsedMs, planTicks, repeatCount, resumeAt } from "./loop.js";

/**
 * ARCADE's frame arithmetic (ADR-090). Every value below is worked out by hand
 * from the constants the function is handed, so the assertions are the sums and
 * not a description of the code:
 *
 *   planTicks:  tick 16 ms - 15 ms owes 0, 16 ms owes 1, 79 ms owes 4 (79/16 =
 *               4.94, floored), and 10 000 ms owes the cap rather than 625.
 *   repeatCount at DAS 133 / ARR 33: 132 ms -> 0; 133 -> 1 (the DAS move);
 *               165 -> 1 (133 + 32 is 1 ms short of the second interval);
 *               166 -> 2; 298 -> 6 (1 + floor(165 / 33) = 1 + 5).
 */

describe("planTicks", () => {
  it("counts whole ticks between two readings", () => {
    expect(planTicks(0, 0, 16, 4)).toBe(0);
    expect(planTicks(0, 15, 16, 4)).toBe(0);
    expect(planTicks(0, 16, 16, 4)).toBe(1);
    expect(planTicks(0, 31, 16, 4)).toBe(1);
    expect(planTicks(0, 32, 16, 4)).toBe(2);
    expect(planTicks(0, 79, 16, 4)).toBe(4);
  });

  it("caps what one frame may owe, so a suspended window is not paid back in ticks", () => {
    expect(planTicks(0, 10_000, 16, 4)).toBe(4);
    expect(planTicks(0, 10_000, 16, 64)).toBe(64);
  });

  it("owes nothing for a reading at or before the last one, so a stalling clock cannot run backwards", () => {
    expect(planTicks(500, 500, 16, 4)).toBe(0);
    expect(planTicks(500, 400, 16, 4)).toBe(0);
  });

  it("refuses a tick or a cap that is not a tick or a cap", () => {
    expect(() => planTicks(0, 100, 0, 4)).toThrow(RangeError);
    expect(() => planTicks(0, 100, -16, 4)).toThrow(RangeError);
    expect(() => planTicks(0, 100, 16, 0)).toThrow(RangeError);
    expect(() => planTicks(0, 100, 16, 1.5)).toThrow(RangeError);
  });
});

describe("repeatCount", () => {
  it("holds the key still for the whole delay, then repeats at the rate", () => {
    expect(repeatCount(0, 133, 33)).toBe(0);
    expect(repeatCount(132, 133, 33)).toBe(0);
    expect(repeatCount(133, 133, 33)).toBe(1);
    expect(repeatCount(165, 133, 33)).toBe(1);
    expect(repeatCount(166, 133, 33)).toBe(2);
    expect(repeatCount(298, 133, 33)).toBe(6);
    expect(repeatCount(331, 133, 33)).toBe(7);
  });

  it("repeats from the first millisecond when there is no delay, which is what a soft drop wants", () => {
    expect(repeatCount(0, 0, 40)).toBe(1);
    expect(repeatCount(39, 0, 40)).toBe(1);
    expect(repeatCount(40, 0, 40)).toBe(2);
    expect(repeatCount(120, 0, 40)).toBe(4);
  });

  it("refuses a rate under a millisecond and a negative delay", () => {
    expect(() => repeatCount(100, 133, 0)).toThrow(RangeError);
    expect(() => repeatCount(100, -1, 33)).toThrow(RangeError);
  });
});

describe("resumeAt", () => {
  it("moves a game's last-step reading to now and leaves everything else alone", () => {
    const state = { lastTickAt: 1_000, score: 12, board: [1, 2] };
    const resumed = resumeAt(state, 8_000);

    expect(resumed).toEqual({ lastTickAt: 8_000, score: 12, board: [1, 2] });
    expect(state.lastTickAt).toBe(1_000);
  });
});

describe("netElapsedMs", () => {
  it("takes the paused time out of the span the engine measured", () => {
    expect(netElapsedMs(41_500, 0)).toBe(41_500);
    expect(netElapsedMs(41_500, 1_500)).toBe(40_000);
    expect(netElapsedMs(41_500, 41_500)).toBe(1);
  });

  it("never reports the zero the store refuses, however long the window was away", () => {
    expect(netElapsedMs(900, 5_000)).toBe(1);
    expect(netElapsedMs(1, 0)).toBe(1);
  });

  it("rounds a sub-millisecond span rather than truncating it to nothing", () => {
    expect(netElapsedMs(1_000.4, 0)).toBe(1_000);
    expect(netElapsedMs(1_000.6, 0)).toBe(1_001);
  });
});

describe("flashDurationMs", () => {
  it("disables the flash under reduced motion rather than shortening it", () => {
    expect(flashDurationMs(true)).toBe(0);
    expect(flashDurationMs(false)).toBe(FLASH_MS);
  });
});
