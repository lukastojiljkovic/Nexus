import { describe, expect, it } from "vitest";
import { elapsedSecondsOf, formatClock, formatCount } from "./format.js";

/**
 * The module's own formatting, with the expected string written out.
 *
 * The two locale rows are the point of the file rather than a repetition: a
 * Serbian reader of this app gets a FULL STOP as the thousands separator and no
 * Serbian formatter accepts a comma there, so „1.234" and „1,234" are the two
 * answers and one of them has to be pinned somewhere.
 */
describe("formatCount", () => {
  it("groups digits the way each locale does", () => {
    expect(formatCount(1234, "sr")).toBe("1.234");
    expect(formatCount(1234, "en")).toBe("1,234");
  });

  it("leaves a count below a thousand alone in both locales", () => {
    expect(formatCount(45, "sr")).toBe("45");
    expect(formatCount(45, "en")).toBe("45");
    expect(formatCount(0, "sr")).toBe("0");
  });
});

describe("formatClock", () => {
  it("reads seconds as mm:ss, and hours only when there are any", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(9)).toBe("00:09");
    expect(formatClock(61)).toBe("01:01");
    expect(formatClock(600)).toBe("10:00");
    expect(formatClock(3661)).toBe("1:01:01");
  });

  it("truncates rather than rounds, and never counts below zero", () => {
    // 1.9 seconds is one second spent, not two: the clock is a measurement.
    expect(formatClock(1.9)).toBe("00:01");
    expect(formatClock(-5)).toBe("00:00");
  });
});

describe("elapsedSecondsOf", () => {
  it("adds the run in progress to the seconds already banked", () => {
    // 90 banked + (12 500 ms since the run started) = 90 + 12 = 102.
    expect(elapsedSecondsOf(90, 1_000, 13_500)).toBe(102);
  });

  it("counts only what is banked while the clock is stopped", () => {
    expect(elapsedSecondsOf(90, null, 13_500)).toBe(90);
    // A stopped clock must not read the time it is standing still for.
    expect(elapsedSecondsOf(90, null, 999_999)).toBe(90);
  });

  it("never counts a negative span, whichever way the readings move", () => {
    // `performance.now()` is monotonic, so this is the defensive branch rather
    // than a case the page can reach — and a clock that went backwards would
    // otherwise save a negative time.
    expect(elapsedSecondsOf(90, 13_500, 1_000)).toBe(90);
    expect(elapsedSecondsOf(-5, null, 0)).toBe(0);
  });
});
