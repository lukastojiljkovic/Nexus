import { describe, expect, it } from "vitest";

import type { TimersCountdownView } from "../shared/ipc.js";
import {
  durationSecondsOf,
  elapsedFraction,
  formatClock,
  formatStopwatch,
  isRunning,
  remainingSecondsOf,
} from "./timing.js";

/**
 * TIMERS' clock arithmetic (ADR-090). What is pinned here is the one property
 * the whole module rests on: every clock is derived from an INSTANT and a `now`,
 * never from a count of ticks — so a page opened halfway through a countdown
 * shows the time that is really left, and a window that was hidden while a timer
 * ran shows the truth rather than the seconds it managed to observe.
 */

const NOW = Date.parse("2026-06-01T08:00:00.000Z");

function countdown(overrides: Partial<TimersCountdownView>): TimersCountdownView {
  return {
    id: "cd-1",
    label: "Pasta",
    durationSeconds: 540,
    endsAt: null,
    remainingSeconds: null,
    createdAt: "2026-06-01T07:59:00.000Z",
    updatedAt: "2026-06-01T07:59:00.000Z",
    ...overrides,
  };
}

describe("formatClock", () => {
  it("reads as mm:ss, and as h:mm:ss only once there is an hour to show", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(9)).toBe("00:09");
    expect(formatClock(90)).toBe("01:30");
    expect(formatClock(3599)).toBe("59:59");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3661)).toBe("1:01:01");
  });

  it("never shows a negative clock", () => {
    expect(formatClock(-5)).toBe("00:00");
  });
});

describe("formatStopwatch", () => {
  it("carries hundredths, and truncates rather than claiming time not yet spent", () => {
    expect(formatStopwatch(0)).toBe("00:00.00");
    expect(formatStopwatch(1234)).toBe("00:01.23");
    expect(formatStopwatch(61_239)).toBe("01:01.23");
    expect(formatStopwatch(3_661_239)).toBe("1:01:01.23");
  });
});

describe("remainingSecondsOf", () => {
  it("counts a RUNNING countdown from the instant it ends, not from how long this page has watched it", () => {
    const running = countdown({ endsAt: "2026-06-01T08:09:00.000Z" });

    expect(remainingSecondsOf(running, NOW)).toBe(540);
    // A page opened five minutes in: no state was ever ticked down to get here.
    expect(remainingSecondsOf(running, NOW + 300_000)).toBe(240);
    // And a page that was never open at all reads the same way.
    expect(remainingSecondsOf(running, NOW + 539_000)).toBe(1);
  });

  it("answers 1 for the last fraction of a second, and 0 only once it is over", () => {
    const running = countdown({ endsAt: "2026-06-01T08:00:01.000Z" });
    expect(remainingSecondsOf(running, NOW + 600)).toBe(1);
    expect(remainingSecondsOf(running, NOW + 1000)).toBe(0);
    expect(remainingSecondsOf(running, NOW + 60_000)).toBe(0);
  });

  it("reads a PAUSED countdown's frozen remainder, whatever the clock says", () => {
    const paused = countdown({ endsAt: null, remainingSeconds: 450 });
    expect(remainingSecondsOf(paused, NOW)).toBe(450);
    expect(isRunning(paused)).toBe(false);
    expect(remainingSecondsOf(paused, NOW + 3_600_000)).toBe(450);
  });

  it("answers 0 for an instant it cannot read, rather than NaN on screen", () => {
    expect(remainingSecondsOf(countdown({ endsAt: "not an instant" }), NOW)).toBe(0);
  });
});

describe("elapsedFraction", () => {
  it("runs from nothing to everything across the countdown's own length", () => {
    const running = countdown({ endsAt: "2026-06-01T08:09:00.000Z" });
    expect(elapsedFraction(running, NOW)).toBe(0);
    expect(elapsedFraction(running, NOW + 270_000)).toBe(0.5);
    expect(elapsedFraction(running, NOW + 540_000)).toBe(1);
    // Past its end it is finished, never more than finished.
    expect(elapsedFraction(running, NOW + 900_000)).toBe(1);
  });
});

describe("durationSecondsOf", () => {
  it("spells one duration out of three fields, with an empty field meaning zero", () => {
    expect(durationSecondsOf({ hours: "", minutes: "5", seconds: "" })).toBe(300);
    expect(durationSecondsOf({ hours: "1", minutes: "", seconds: "30" })).toBe(3630);
    expect(durationSecondsOf({ hours: "0", minutes: "0", seconds: "1" })).toBe(1);
    expect(durationSecondsOf({ hours: "24", minutes: "0", seconds: "0" })).toBe(86_400);
  });

  it("refuses a duration the store could not hold, so the form can say so under the field", () => {
    expect(durationSecondsOf({ hours: "", minutes: "", seconds: "" })).toBeNull();
    expect(durationSecondsOf({ hours: "0", minutes: "0", seconds: "0" })).toBeNull();
    expect(durationSecondsOf({ hours: "24", minutes: "0", seconds: "1" })).toBeNull();
    // A minute field reading 90 is a value nobody meant: it is refused rather than
    // folded into an hour and a half, which is what parsing it as seconds would do.
    expect(durationSecondsOf({ hours: "", minutes: "90", seconds: "" })).toBeNull();
    expect(durationSecondsOf({ hours: "", minutes: "5,5", seconds: "" })).toBeNull();
    expect(durationSecondsOf({ hours: "x", minutes: "", seconds: "" })).toBeNull();
  });
});
