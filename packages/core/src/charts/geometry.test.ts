import { describe, expect, it } from "vitest";

import {
  areaPath,
  extent,
  heatmapWeeks,
  linePath,
  niceStep,
  niceTicks,
  scaleLinear,
} from "./geometry.js";

describe("extent", () => {
  it("returns null for no values, so a caller cannot silently chart nothing", () => {
    expect(extent([])).toBeNull();
  });

  it("returns the same number twice for a single value", () => {
    expect(extent([7])).toEqual([7, 7]);
  });

  it("finds the bounds regardless of order, and handles negatives", () => {
    expect(extent([3, -8, 0, 12, -8])).toEqual([-8, 12]);
  });

  it("ignores values that are not finite rather than poisoning the range", () => {
    // A NaN reaching a scale turns every coordinate into NaN and the chart
    // silently disappears — the worst failure mode a chart has.
    expect(extent([1, Number.NaN, 5, Number.POSITIVE_INFINITY])).toEqual([1, 5]);
    expect(extent([Number.NaN])).toBeNull();
  });
});

describe("niceStep", () => {
  it("snaps to the 1 / 2 / 5 ladder at every magnitude", () => {
    expect(niceStep(1)).toBe(1);
    expect(niceStep(1.4)).toBe(2);
    expect(niceStep(3)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.03)).toBe(0.05);
    expect(niceStep(230)).toBe(500);
  });
});

describe("niceTicks", () => {
  it("covers the range with round numbers", () => {
    const ticks = niceTicks(0, 97, 5);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(97);
    expect(ticks.every((t) => Number.isFinite(t))).toBe(true);
  });

  it("produces a readable count near the target", () => {
    const ticks = niceTicks(0, 1000, 5);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(9);
  });

  it("does not divide by zero when every value is identical", () => {
    // A flat series is real data (a balance that did not move), not an error.
    expect(niceTicks(5, 5, 4)).toEqual([5]);
  });

  it("spans negative to positive across zero", () => {
    const ticks = niceTicks(-30, 45, 5);
    expect(ticks[0]).toBeLessThanOrEqual(-30);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(45);
    expect(ticks).toContain(0);
  });
});

describe("scaleLinear", () => {
  it("maps the domain onto the range", () => {
    const s = scaleLinear([0, 10], [0, 100]);
    expect(s(0)).toBe(0);
    expect(s(5)).toBe(50);
    expect(s(10)).toBe(100);
  });

  it("inverts when the range does, which is how SVG y axes work", () => {
    const s = scaleLinear([0, 10], [100, 0]);
    expect(s(0)).toBe(100);
    expect(s(10)).toBe(0);
  });

  it("puts a degenerate domain at the range midpoint instead of dividing by zero", () => {
    // Every value equal is common — one measurement, a flat month. The honest
    // answer is a line through the middle, not NaN.
    const s = scaleLinear([5, 5], [0, 100]);
    expect(s(5)).toBe(50);
  });
});

describe("linePath / areaPath", () => {
  it("emits nothing for an empty series, so nothing is drawn", () => {
    expect(linePath([])).toBe("");
    expect(areaPath([], 10)).toBe("");
  });

  it("draws a single point as a zero-length segment so it is still visible", () => {
    // One data point is legitimate; dropping it would tell the user they have
    // no data when they have one.
    expect(linePath([{ x: 4, y: 9 }])).toBe("M4 9L4 9");
  });

  it("joins points in order", () => {
    expect(
      linePath([
        { x: 0, y: 0 },
        { x: 10, y: 5 },
        { x: 20, y: 2 },
      ]),
    ).toBe("M0 0L10 5L20 2");
  });

  it("closes the area back down to the baseline", () => {
    expect(
      areaPath(
        [
          { x: 0, y: 4 },
          { x: 10, y: 1 },
        ],
        20,
      ),
    ).toBe("M0 4L10 1L10 20L0 20Z");
  });

  it("rounds coordinates so the emitted path stays small", () => {
    expect(linePath([{ x: 1.23456, y: 9.87654 }])).toBe("M1.23 9.88L1.23 9.88");
  });
});

describe("heatmapWeeks", () => {
  it("lays a year out in columns of seven, starting on the configured weekday", () => {
    // 2026-01-01 is a Thursday.
    const weeks = heatmapWeeks("2026-01-01", "2026-12-31", 1);
    expect(weeks.length).toBeGreaterThanOrEqual(52);
    expect(weeks.length).toBeLessThanOrEqual(54);
    for (const week of weeks) expect(week).toHaveLength(7);
  });

  it("pads the first column with nulls rather than shifting real days", () => {
    // Monday start, first day is a Thursday -> three leading blanks. Shifting
    // instead of padding would put every day of the year on the wrong weekday
    // row, which is the classic contribution-graph bug.
    const weeks = heatmapWeeks("2026-01-01", "2026-01-31", 1);
    const first = weeks[0];
    expect(first?.slice(0, 3)).toEqual([null, null, null]);
    expect(first?.[3]).toBe("2026-01-01");
  });

  it("honours a Sunday week start", () => {
    const weeks = heatmapWeeks("2026-01-01", "2026-01-31", 0);
    // Sunday start, Thursday first -> four leading blanks.
    expect(weeks[0]?.slice(0, 4)).toEqual([null, null, null, null]);
    expect(weeks[0]?.[4]).toBe("2026-01-01");
  });

  it("emits every date in the range exactly once, in order", () => {
    const weeks = heatmapWeeks("2026-03-01", "2026-04-15", 1);
    const days = weeks.flat().filter((d): d is string => d !== null);
    expect(days[0]).toBe("2026-03-01");
    expect(days[days.length - 1]).toBe("2026-04-15");
    expect(days).toHaveLength(46);
    expect(new Set(days).size).toBe(46);
  });

  it("crosses a leap day without losing or duplicating it", () => {
    const days = heatmapWeeks("2024-02-25", "2024-03-03", 1)
      .flat()
      .filter((d): d is string => d !== null);
    expect(days).toContain("2024-02-29");
    expect(days).toHaveLength(8);
  });

  it("crosses a DST transition without dropping a day", () => {
    // Europe/Belgrade springs forward on 2026-03-29. Date arithmetic done in
    // local time loses or repeats a day here; this is why the walk is UTC.
    const days = heatmapWeeks("2026-03-27", "2026-03-31", 1)
      .flat()
      .filter((d): d is string => d !== null);
    expect(days).toEqual(["2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);
  });

  it("returns nothing when the range is inverted", () => {
    expect(heatmapWeeks("2026-05-01", "2026-04-01", 1)).toEqual([]);
  });
});
