import { describe, expect, it } from "vitest";

import { intervalLabel, isDueWithinSession } from "./reviewIntervals.js";

/**
 * Both helpers take two ISO instants and never read a clock, so every case
 * here is a fixed pair. The labels themselves are ASCII unit abbreviations
 * baked into the module (not `strings.ts`, not `Intl`), so they are safe to
 * assert literally — nothing about them depends on the host.
 */

const NOW = "2026-07-30T10:00:00.000Z";

/** `NOW` plus a number of milliseconds, as an ISO instant. */
function after(ms: number): string {
  return new Date(Date.parse(NOW) + ms).toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("intervalLabel", () => {
  it("clamps a due date at or before now to the sub-minute label", () => {
    expect(intervalLabel(NOW, NOW)).toBe("<1 min");
    expect(intervalLabel(NOW, after(-DAY))).toBe("<1 min");
    expect(intervalLabel(NOW, after(29_000))).toBe("<1 min"); // rounds to 0 min
  });

  it("reports minutes, then hours, then days, then months, then years", () => {
    expect(intervalLabel(NOW, after(30_000))).toBe("1 min"); // rounds up to 1
    expect(intervalLabel(NOW, after(5 * MINUTE))).toBe("5 min");
    expect(intervalLabel(NOW, after(59 * MINUTE))).toBe("59 min");
    expect(intervalLabel(NOW, after(HOUR))).toBe("1 h");
    expect(intervalLabel(NOW, after(23 * HOUR))).toBe("23 h");
    expect(intervalLabel(NOW, after(DAY))).toBe("1 d");
    expect(intervalLabel(NOW, after(29 * DAY))).toBe("29 d");
    expect(intervalLabel(NOW, after(30 * DAY))).toBe("1 mes");
    expect(intervalLabel(NOW, after(180 * DAY))).toBe("6 mes");
    expect(intervalLabel(NOW, after(365 * DAY))).toBe("1 god");
    expect(intervalLabel(NOW, after(730 * DAY))).toBe("2 god");
  });

  it("promotes a value that would round into its own unit's ceiling", () => {
    // The module's own documented cases: 59.6 min must not read "60 min",
    // and 23.6 h must not read "24 h".
    expect(intervalLabel(NOW, after(59.6 * MINUTE))).toBe("1 h");
    expect(intervalLabel(NOW, after(23.6 * HOUR))).toBe("1 d");
  });

  it("is time-zone independent — an offset spelling equals its UTC instant", () => {
    expect(intervalLabel("2026-07-30T12:00:00.000+02:00", "2026-07-30T13:00:00.000+02:00")).toBe(
      intervalLabel(NOW, after(HOUR)),
    );
  });
});

describe("isDueWithinSession", () => {
  it("is true up to and including the 15-minute re-queue threshold", () => {
    expect(isDueWithinSession(NOW, after(-DAY))).toBe(true);
    expect(isDueWithinSession(NOW, NOW)).toBe(true);
    expect(isDueWithinSession(NOW, after(15 * MINUTE))).toBe(true);
  });

  it("is false one millisecond past it", () => {
    expect(isDueWithinSession(NOW, after(15 * MINUTE + 1))).toBe(false);
    expect(isDueWithinSession(NOW, after(DAY))).toBe(false);
  });
});
