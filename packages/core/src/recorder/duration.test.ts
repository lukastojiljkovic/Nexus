import { describe, expect, it } from "vitest";
import { formatRecordingDuration } from "./duration.js";

/**
 * Every expectation below is a hand calculation on the seconds, spelled out
 * beside it: the fractional second is discarded (5 999 ms is fifty-nine
 * seconds and not a minute), which is the only rounding rule this module has.
 */
describe("formatRecordingDuration", () => {
  it.each([
    [0, "0:00"],
    [1, "0:00"],
    [999, "0:00"],
    [1_000, "0:01"],
    [1_500, "0:01"], // 1.5 s truncates to one second
    [59_000, "0:59"],
    [59_999, "0:59"], // 59.999 s is still not a minute
    [60_000, "1:00"],
    [61_000, "1:01"],
    [599_000, "9:59"],
    [600_000, "10:00"],
    [3_599_999, "59:59"],
  ])("formats %i ms as m:ss", (durationMs, expected) => {
    expect(formatRecordingDuration(durationMs)).toBe(expected);
  });

  it.each([
    [3_600_000, "1:00:00"], // exactly one hour switches to the h:mm:ss shape
    [3_661_000, "1:01:01"], // 1 h 1 min 1 s
    [45_296_000, "12:34:56"], // 12 h 34 min 56 s
    [100_000_000, "27:46:40"], // 27 h 46 min 40 s — hours are not capped
  ])("formats %i ms as h:mm:ss", (durationMs, expected) => {
    expect(formatRecordingDuration(durationMs)).toBe(expected);
  });

  it.each([
    ["a negative duration", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("reads %s as no elapsed time rather than poisoning the arithmetic", (_label, durationMs) => {
    expect(formatRecordingDuration(durationMs)).toBe("0:00");
  });
});
