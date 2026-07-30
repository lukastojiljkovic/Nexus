import { describe, expect, it } from "vitest";

import {
  focusSessionMinutes,
  formatDurationMinutes,
  formatElapsed,
  formatFocusSessionWhen,
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
      }),
    ).toBe(45);
    // 30 s rounds up, 29 s rounds down — the boundary either side.
    expect(
      focusSessionMinutes({
        startedAt: "2026-07-30T10:00:00.000Z",
        endedAt: "2026-07-30T10:00:30.000Z",
      }),
    ).toBe(1);
    expect(
      focusSessionMinutes({
        startedAt: "2026-07-30T10:00:00.000Z",
        endedAt: "2026-07-30T10:00:29.000Z",
      }),
    ).toBe(0);
  });

  it("clamps an end that precedes its start to zero", () => {
    expect(
      focusSessionMinutes({
        startedAt: "2026-07-30T10:45:00.000Z",
        endedAt: "2026-07-30T10:00:00.000Z",
      }),
    ).toBe(0);
  });

  it("is time-zone independent — an offset spelling equals its UTC instant", () => {
    const utc = focusSessionMinutes({
      startedAt: "2026-07-30T10:00:00.000Z",
      endedAt: "2026-07-30T11:30:00.000Z",
    });
    const offset = focusSessionMinutes({
      startedAt: "2026-07-30T12:00:00.000+02:00",
      endedAt: "2026-07-30T13:30:00.000+02:00",
    });
    expect(offset).toBe(utc);
  });

  // NaN escapes the clamp — `Math.max(0, NaN)` is NaN — so an unparseable
  // endpoint has to be caught before it, or it would leak a NaN into a minute
  // total instead of collapsing to the 0 every other bad input yields.
  it("clamps an unparseable endpoint to 0 rather than yielding NaN", () => {
    expect(focusSessionMinutes({ startedAt: "not-a-date", endedAt: "2026-07-30T10:00:00.000Z" })).toBe(0);
    expect(focusSessionMinutes({ startedAt: "2026-07-30T10:00:00.000Z", endedAt: "not-a-date" })).toBe(0);
    expect(focusSessionMinutes({ startedAt: "", endedAt: "" })).toBe(0);
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
