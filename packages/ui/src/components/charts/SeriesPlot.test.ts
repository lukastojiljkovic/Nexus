import { describe, expect, it } from "vitest";
import { niceTicks, scaleLinear, type Point } from "@nexus/core";

import {
  clampTickLabelY,
  ruleLabelY,
  splitRuns,
  stepExpand,
  tickDomain,
  tickGutter,
} from "./SeriesPlot.js";

/**
 * The gutter has already been wrong in shipped code — it was a fixed 30, and
 * FIN's „120.000" ran 10.4px off the left edge of four figures. These pin the
 * derivation that replaced it, including both clamps, because the failure is
 * silent: the label is not clipped by anything that reports, it is simply
 * painted outside the box the root `<svg>` hides.
 */
describe("tickGutter", () => {
  it("never goes below the house minimum, even with no ticks at all", () => {
    expect(tickGutter([])).toBe(30);
    expect(tickGutter(["0"])).toBe(30);
  });

  it("grows with the widest label, at the tabular digit width", () => {
    // Tick faces are `font-variant-numeric: tabular-nums`, so glyph count is
    // an exact measure for digits and a generous one for separators.
    expect(tickGutter(["0", "25", "50", "75", "100"])).toBeCloseTo(3 * 7.2 + 12, 12);
    expect(tickGutter(["120.000"])).toBeCloseTo(7 * 7.2 + 12, 12);
  });

  it("is sized by the widest label, not the last one", () => {
    expect(tickGutter(["120.000", "0"])).toBe(tickGutter(["0", "120.000"]));
  });

  it("caps the gutter, so a pathological formatter cannot eat the plot", () => {
    expect(tickGutter(["-1.234.567,89"])).toBe(96);
    expect(tickGutter(["x".repeat(200)])).toBe(96);
  });
});

describe("clampTickLabelY", () => {
  const HEIGHT = 160;

  it("leaves an interior tick exactly where the scale put it", () => {
    expect(clampTickLabelY(80, HEIGHT)).toBe(80);
  });

  it("pulls the extreme ticks back inside their half-line", () => {
    // The labels are `dominantBaseline="middle"`, so at a PAD_Y of 6 the top
    // and bottom ticks each hang half a line out of the box — the bottom one
    // landed on top of the chart's caption.
    expect(clampTickLabelY(6, HEIGHT)).toBe(9);
    expect(clampTickLabelY(154, HEIGHT)).toBe(151);
  });

  it("keeps every tick of a real axis inside the drawing", () => {
    for (const y of [-40, 0, 6, 9, 80, 151, 154, 160, 400]) {
      const clamped = clampTickLabelY(y, HEIGHT);
      expect(clamped).toBeGreaterThanOrEqual(9);
      expect(clamped).toBeLessThanOrEqual(HEIGHT - 9);
    }
  });

  it("moves the label and nothing else — the plot's own geometry is untouched", () => {
    // Clamping the LABEL rather than growing PAD_Y is what keeps the data
    // exactly where it was; the tick moves by three pixels, the line does not.
    expect(clampTickLabelY(6, HEIGHT) - 6).toBe(3);
    expect(154 - clampTickLabelY(154, HEIGHT)).toBe(3);
  });
});

/**
 * The clamp above can only be the ±3px guard it claims to be if every tick is
 * already inside the box. It was not: `niceTicks` rounds both ends OUTWARD so
 * the axis contains the data, the plot was scaled to the data extent instead,
 * and the two ticks that fell outside were pinned to the edges on top of their
 * neighbours — FIN's balance flow printed „80.000,00" and „75.000,00" as one
 * smear on four surfaces.
 */
describe("tickDomain", () => {
  const HEIGHT = 160;
  const PAD_Y = 6;

  it("spans the ladder, not the data the ladder was derived from", () => {
    // 79.045…104.045 is FIN's own range: a step of 5.000 rounds the axis out to
    // 75.000…105.000, and both of those are outside the extent.
    const ticks = niceTicks(79_045, 104_045, 5);
    expect(ticks[0]).toBe(75_000);
    expect(ticks[ticks.length - 1]).toBe(105_000);
    expect(tickDomain(ticks, [79_045, 104_045])).toEqual([75_000, 105_000]);
  });

  it("leaves every tick inside the drawing, which the data extent did not", () => {
    const ticks = niceTicks(79_045, 104_045, 5);
    const before = scaleLinear([79_045, 104_045], [HEIGHT - PAD_Y, PAD_Y]);
    const after = scaleLinear(tickDomain(ticks, [79_045, 104_045]), [HEIGHT - PAD_Y, PAD_Y]);

    // The old scale put the two extremes outside the box, where the clamp had
    // to move them by far more than the three pixels it is documented to.
    expect(before(105_000)).toBeLessThan(PAD_Y);
    expect(before(75_000)).toBeGreaterThan(HEIGHT - PAD_Y);
    expect(clampTickLabelY(before(105_000), HEIGHT) - before(105_000)).toBeGreaterThan(3);

    for (const tick of ticks) {
      expect(after(tick)).toBeGreaterThanOrEqual(PAD_Y);
      expect(after(tick)).toBeLessThanOrEqual(HEIGHT - PAD_Y);
    }
  });

  it("spaces the ticks evenly, so no two labels can land on each other", () => {
    const ticks = niceTicks(79_045, 104_045, 5);
    const scale = scaleLinear(tickDomain(ticks, [79_045, 104_045]), [HEIGHT - PAD_Y, PAD_Y]);
    const gaps = ticks.slice(1).map((tick, i) => scale(ticks[i] ?? 0) - scale(tick));
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(gaps[0] ?? 0, 9);
      // A caption-size line box is about 14px; anything at or under it is the
      // collision this function exists to retire.
      expect(gap).toBeGreaterThan(14);
    }
  });

  it("hands back the caller's own domain when the ladder cannot span anything", () => {
    // A flat series: `niceTicks` answers the single value it has, and inventing
    // a range around it would draw movement that never happened.
    expect(tickDomain(niceTicks(5, 5, 4), [5, 5])).toEqual([5, 5]);
    expect(tickDomain([], [0, 1])).toEqual([0, 1]);
  });
});

describe("ruleLabelY", () => {
  it("writes the label above the rule", () => {
    expect(ruleLabelY(80)).toBe(77);
  });

  it("flips below the rule when above would be off the top of the drawing", () => {
    // A goal line at the very top of a chart is the ordinary case — a goal is
    // usually above the data — so this branch is the common one, not the edge.
    expect(ruleLabelY(10)).toBe(22);
    expect(ruleLabelY(0)).toBe(12);
  });

  it("switches exactly at the half-line, not a pixel either side", () => {
    expect(ruleLabelY(12)).toBe(9);
    expect(ruleLabelY(11.9)).toBeCloseTo(23.9, 12);
  });
});

const p = (x: number, y: number): Point => ({ x, y });

describe("splitRuns", () => {
  it("breaks the path at every gap instead of interpolating across it", () => {
    // This is the whole reason `SeriesPlot` is separate from `ColumnPlot`: a
    // line drawn straight through a missing day claims a measurement that
    // never happened.
    expect(splitRuns([p(1, 1), p(2, 2), null, p(4, 4)])).toEqual([
      [p(1, 1), p(2, 2)],
      [p(4, 4)],
    ]);
  });

  it("swallows leading, trailing and consecutive gaps without emitting empty runs", () => {
    expect(splitRuns([null, null, p(3, 3), null, null, p(6, 6), null])).toEqual([
      [p(3, 3)],
      [p(6, 6)],
    ]);
  });

  it("returns nothing for nothing, and one run when there is no gap", () => {
    expect(splitRuns([])).toEqual([]);
    expect(splitRuns([null, null])).toEqual([]);
    expect(splitRuns([p(1, 1), p(2, 2)])).toEqual([[p(1, 1), p(2, 2)]]);
  });

  it("preserves every real point exactly once, in order", () => {
    const points = [p(1, 1), null, p(3, 3), p(4, 4), null, p(6, 6)];
    expect(splitRuns(points).flat()).toEqual([p(1, 1), p(3, 3), p(4, 4), p(6, 6)]);
  });
});

describe("stepExpand", () => {
  it("holds the previous y until the new x, then rises", () => {
    // Step-AFTER: the value that was in force is drawn right up to the moment
    // it changed. A step-before staircase would show a balance changing before
    // the transaction that changed it.
    expect(stepExpand([p(0, 0), p(1, 5)])).toEqual([p(0, 0), p(1, 0), p(1, 5)]);
  });

  it("emits 2n-1 vertices for n points", () => {
    expect(stepExpand([p(0, 0), p(1, 5), p(2, 2)])).toEqual([
      p(0, 0),
      p(1, 0),
      p(1, 5),
      p(2, 5),
      p(2, 2),
    ]);
  });

  it("passes a single point through, so one reading still draws its dot", () => {
    expect(stepExpand([p(3, 7)])).toEqual([p(3, 7)]);
    expect(stepExpand([])).toEqual([]);
  });

  it("does not mutate the input, which the caller still needs for its dots", () => {
    const input = [p(0, 0), p(1, 5)];
    stepExpand(input);
    expect(input).toEqual([p(0, 0), p(1, 5)]);
  });
});
