import { describe, expect, it } from "vitest";

import {
  focusSessionMinutes,
  formatDurationMinutes,
  formatElapsed,
  formatFocusSessionWhen,
  formatPhaseClock,
} from "./focusFormat.js";

/**
 * `focusFormat.ts` is pure, so every input is spelled out. The one
 * locale-dependent helper (`formatFocusSessionWhen`) is asserted at the SHAPE
 * level only: its weekday and month names come from the host's ICU data and
 * its clock from the host's time zone, neither of which a test may pin.
 */

describe("formatElapsed", () => {
  it("reads mm:ss under an hour, always two digits", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(999)).toBe("00:00"); // sub-second floors away
    expect(formatElapsed(1_000)).toBe("00:01");
    expect(formatElapsed(59_000)).toBe("00:59");
    expect(formatElapsed(60_000)).toBe("01:00");
    expect(formatElapsed(3_599_000)).toBe("59:59");
  });

  it("adds an unpadded hours part at or above one hour", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(3_661_000)).toBe("1:01:01");
    expect(formatElapsed(36_000_000)).toBe("10:00:00");
  });

  it("clamps negative input (clock skew) to zero rather than going backwards", () => {
    expect(formatElapsed(-1)).toBe("00:00");
    expect(formatElapsed(-3_600_000)).toBe("00:00");
  });
});

describe("formatPhaseClock", () => {
  const counting = { elapsedSeconds: 300, remainingSeconds: 1200, overrunSeconds: 0, isPaused: false };
  const openEnded = { elapsedSeconds: 300, remainingSeconds: 0, overrunSeconds: 0, isPaused: false };
  const overrun = { elapsedSeconds: 1560, remainingSeconds: 0, overrunSeconds: 60, isPaused: false };

  it("counts a planned phase DOWN", () => {
    expect(formatPhaseClock(counting, 25)).toBe("20:00");
  });

  it("counts an open-ended phase UP — there is no plan to be short of", () => {
    expect(formatPhaseClock(openEnded, null)).toBe("05:00");
  });

  // The rule the page exists to honour: past its plan, the clock says so out
  // loud rather than resting at 00:00 as if the phase had tidily ended. It has
  // not — ending is a deliberate act — and „+01:00" is what says the difference.
  it("shows OVERRUN with a leading plus rather than sitting at zero", () => {
    expect(formatPhaseClock(overrun, 25)).toBe("+01:00");
    expect(formatPhaseClock({ ...overrun, overrunSeconds: 3_601 }, 25)).toBe("+1:00:01");
  });

  it("shows exactly 00:00 at the planned end, before any overrun has accrued", () => {
    expect(
      formatPhaseClock({ elapsedSeconds: 1500, remainingSeconds: 0, overrunSeconds: 0, isPaused: false }, 25),
    ).toBe("00:00");
  });

  it("reads a paused phase exactly as a running one — the engine froze the numbers, not the format", () => {
    expect(formatPhaseClock({ ...counting, isPaused: true }, 25)).toBe("20:00");
  });
});

describe("formatDurationMinutes", () => {
  it("reads bare minutes under an hour", () => {
    expect(formatDurationMinutes(0)).toBe("0 min");
    expect(formatDurationMinutes(45)).toBe("45 min");
    expect(formatDurationMinutes(59)).toBe("59 min");
  });

  it("always keeps the minutes part once hours appear", () => {
    expect(formatDurationMinutes(60)).toBe("1 h 0 min");
    expect(formatDurationMinutes(65)).toBe("1 h 5 min");
    expect(formatDurationMinutes(125)).toBe("2 h 5 min");
  });

  it("rounds a fractional total and clamps a negative one", () => {
    expect(formatDurationMinutes(44.6)).toBe("45 min");
    expect(formatDurationMinutes(59.6)).toBe("1 h 0 min");
    expect(formatDurationMinutes(-5)).toBe("0 min");
  });
});

describe("focusSessionMinutes", () => {
  it("is the rounded whole-minute gap between the two instants", () => {
    expect(
      focusSessionMinutes({
        startedAt: "2026-07-30T10:00:00.000Z",
        endedAt: "2026-07-30T10:45:00.000Z",
        pausedSeconds: 0,
      }),
    ).toBe(45);
    // 30 s rounds up, 29 s rounds down — the boundary either side.
    expect(
      focusSessionMinutes({
        startedAt: "2026-07-30T10:00:00.000Z",
        endedAt: "2026-07-30T10:00:30.000Z",
        pausedSeconds: 0,
      }),
    ).toBe(1);
    expect(
      focusSessionMinutes({
        startedAt: "2026-07-30T10:00:00.000Z",
        endedAt: "2026-07-30T10:00:29.000Z",
        pausedSeconds: 0,
      }),
    ).toBe(0);
  });

  // Migration 057 made pausing possible, and these minutes are summed into a
  // figure the user reads as „how long I focused". A paused stretch is wall time
  // that was not attention, so it comes off the span — otherwise a 45-minute
  // session with a 15-minute interruption reports three quarters of an hour of
  // focus that never happened.
  it("subtracts paused seconds from the wall span", () => {
    expect(
      focusSessionMinutes({
        startedAt: "2026-07-30T10:00:00.000Z",
        endedAt: "2026-07-30T10:45:00.000Z",
        pausedSeconds: 900,
      }),
    ).toBe(30);
  });

  it("clamps to zero when the whole span was paused, rather than going negative", () => {
    expect(
      focusSessionMinutes({
        startedAt: "2026-07-30T10:00:00.000Z",
        endedAt: "2026-07-30T10:10:00.000Z",
        pausedSeconds: 6000,
      }),
    ).toBe(0);
  });

  it("clamps an end that precedes its start to zero", () => {
    expect(
      focusSessionMinutes({
        startedAt: "2026-07-30T10:45:00.000Z",
        endedAt: "2026-07-30T10:00:00.000Z",
        pausedSeconds: 0,
      }),
    ).toBe(0);
  });

  it("is time-zone independent — an offset spelling equals its UTC instant", () => {
    const utc = focusSessionMinutes({
      startedAt: "2026-07-30T10:00:00.000Z",
      endedAt: "2026-07-30T11:30:00.000Z",
      pausedSeconds: 0,
    });
    const offset = focusSessionMinutes({
      startedAt: "2026-07-30T12:00:00.000+02:00",
      endedAt: "2026-07-30T13:30:00.000+02:00",
      pausedSeconds: 0,
    });
    expect(offset).toBe(utc);
  });

  // NaN escapes the clamp — `Math.max(0, NaN)` is NaN — so an unparseable
  // endpoint has to be caught before it, or it would leak a NaN into a minute
  // total instead of collapsing to the 0 every other bad input yields. A NaN
  // pause is caught for the same reason and on its own line, since it would
  // otherwise poison an otherwise-valid span.
  it("clamps an unparseable endpoint to 0 rather than yielding NaN", () => {
    expect(
      focusSessionMinutes({ startedAt: "not-a-date", endedAt: "2026-07-30T10:00:00.000Z", pausedSeconds: 0 }),
    ).toBe(0);
    expect(
      focusSessionMinutes({ startedAt: "2026-07-30T10:00:00.000Z", endedAt: "not-a-date", pausedSeconds: 0 }),
    ).toBe(0);
    expect(focusSessionMinutes({ startedAt: "", endedAt: "", pausedSeconds: 0 })).toBe(0);
    expect(
      focusSessionMinutes({
        startedAt: "2026-07-30T10:00:00.000Z",
        endedAt: "2026-07-30T10:45:00.000Z",
        pausedSeconds: Number.NaN,
      }),
    ).toBe(45);
  });
});

describe("formatFocusSessionWhen", () => {
  it("returns the raw input unchanged when it is not a date", () => {
    expect(formatFocusSessionWhen("not-a-date")).toBe("not-a-date");
    expect(formatFocusSessionWhen("")).toBe("");
  });

  it("ends in a comma-separated two-digit clock, whatever the host locale data says", () => {
    const label = formatFocusSessionWhen("2026-07-30T14:32:00.000Z");
    expect(label).not.toBe("2026-07-30T14:32:00.000Z");
    expect(label).toMatch(/^.+,\s\d{2}:\d{2}$/);
  });

  it("formats the same instant identically however it is spelled", () => {
    expect(formatFocusSessionWhen("2026-07-30T12:00:00.000+02:00")).toBe(
      formatFocusSessionWhen("2026-07-30T10:00:00.000Z"),
    );
  });
});
