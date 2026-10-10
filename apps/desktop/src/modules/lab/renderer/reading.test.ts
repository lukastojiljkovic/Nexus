import { describe, expect, it } from "vitest";

import {
  fixQualityCode,
  formatCoordinate,
  formatDurationMs,
  formatInstant,
  formatMeasure,
  formatPercent,
  hiddenLineCount,
  readingSeries,
  visibleLines,
} from "./reading.js";

/**
 * The expectations below are the values `Intl` produces for the two locales this
 * app ships, written as the STRINGS a reader sees. They are pinned because the
 * alternative — asserting that a formatter returns a string — passes for a
 * formatter that returns `[object Object]`.
 */
describe("the page's formatters", () => {
  it("writes a coordinate with six decimals and the locale's own separator", () => {
    expect(formatCoordinate(48.1173, "en")).toBe("48.117300");
    expect(formatCoordinate(-11.5166, "en")).toBe("-11.516600");
    expect(formatCoordinate(48.1173, "sr-Latn")).toBe("48,117300");
  });

  it("writes a measure at the decimals its unit deserves", () => {
    expect(formatMeasure(23.456, 1, "sr-Latn")).toBe("23,5");
    expect(formatMeasure(23.456, 1, "en")).toBe("23.5");
    expect(formatMeasure(1009, 0, "en")).toBe("1,009");
  });

  it("writes a ratio as a percentage", () => {
    // 81 000 / 90 000 is exactly nine tenths.
    expect(formatPercent(0.9, "en")).toBe("90.0%");
    expect(formatPercent(0.916, "sr-Latn")).toBe("91,6%");
  });

  it("writes an instant in the reader's own date and time, and leaves an unreadable one alone", () => {
    const formatted = formatInstant("2026-10-10T08:00:00.000Z", "sr-Latn");
    // The YEAR is asserted rather than the whole string: the wall-clock part of
    // a localised instant depends on the machine's zone, and a test that pinned
    // „10:00" would fail on a runner in another one without telling anybody
    // anything about this function. What the assertion does pin is that the
    // storage format is gone — an ISO instant still readable as itself would
    // mean this formatter did nothing at all.
    expect(formatted).toContain("2026");
    expect(formatted).not.toContain("2026-10-10");
    expect(formatInstant("not-an-instant", "en")).toBe("not-an-instant");
  });

  it("writes a duration as the two largest units it needs, in the locale's own abbreviations", () => {
    // 9 584 000 ms is the 2 h 39 min the battery report's own entry spans.
    expect(formatDurationMs(9_584_000, "en")).toBe("2h 39m");
    expect(formatDurationMs(90_000, "en")).toBe("1m 30s");
    expect(formatDurationMs(4_000, "en")).toBe("4s");
    // Serbian calls an hour a „čas", and `Intl` is where that is known — which
    // is the whole reason this goes through it rather than through arithmetic.
    expect(formatDurationMs(9_584_000, "sr-Latn")).toBe("2 č 39 m");
    // Never negative, whatever a report says: a duration below zero is not a
    // duration, and a page should show the smallest real one rather than "-1 s".
    expect(formatDurationMs(-5_000, "en")).toBe("0s");
  });
});

describe("fixQualityCode", () => {
  it("maps the standard's nine codes and refuses anything else", () => {
    expect(fixQualityCode(0)).toBe("none");
    expect(fixQualityCode(1)).toBe("gps");
    expect(fixQualityCode(2)).toBe("dgps");
    expect(fixQualityCode(4)).toBe("rtk");
    expect(fixQualityCode(5)).toBe("floatRtk");
    expect(fixQualityCode(8)).toBe("simulation");
    expect(fixQualityCode(null)).toBe("none");
    expect(fixQualityCode(9)).toBe("none");
    expect(fixQualityCode(1.5)).toBe("none");
  });
});

describe("readingSeries", () => {
  const samples = [
    { at: "a", values: [1, 10] },
    { at: "b", values: [2, 20] },
    { at: "c", values: [3, 30] },
    { at: "d", values: [4, 40] },
  ];

  it("draws the newest window of one column, against the reading index", () => {
    const series = readingSeries(samples, 0, 3);
    expect(series?.points).toEqual([
      { x: 0, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 4 },
    ]);
    expect(series?.domain).toEqual([0, 2]);
  });

  it("takes the other column by its index, and is null when there is nothing to plot", () => {
    expect(readingSeries(samples, 1, 2)?.points).toEqual([
      { x: 0, y: 30 },
      { x: 1, y: 40 },
    ]);
    // One reading is not a change, and a column that does not exist is not a
    // series of zeroes.
    expect(readingSeries(samples.slice(0, 1), 0, 10)).toBeNull();
    expect(readingSeries(samples, 2, 10)).toBeNull();
    expect(readingSeries(samples, -1, 10)).toBeNull();
    expect(readingSeries([], 0, 10)).toBeNull();
  });
});

describe("visibleLines", () => {
  const lines = ["a", "b", "c", "d"];

  it("shows the newest lines and counts what it left out", () => {
    expect(visibleLines(lines, 2)).toEqual(["c", "d"]);
    expect(hiddenLineCount(lines, 2)).toBe(2);
    expect(visibleLines(lines, 10)).toEqual(lines);
    expect(hiddenLineCount(lines, 10)).toBe(0);
    expect(visibleLines(lines, 0)).toEqual([]);
  });
});
