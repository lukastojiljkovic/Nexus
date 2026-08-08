import { describe, expect, it } from "vitest";

import { columnBands, columnDomain, slotLabelPlacement } from "./ColumnPlot.js";
import type { ColumnPlotSeries } from "./ColumnPlot.js";

const series = (key: string, values: readonly (number | null)[]): ColumnPlotSeries => ({
  key,
  tone: "accent",
  values,
});

describe("columnBands", () => {
  it("divides the width evenly and takes the gap out of the drawn band", () => {
    const { bandStep, bandWidth, barWidth } = columnBands(320, 7, 1, false);
    expect(bandStep).toBeCloseTo(320 / 7, 12);
    expect(bandWidth).toBeCloseTo(320 / 7 - 8, 12);
    // One series occupies its whole band whether or not "grouped" was asked
    // for — there is nothing to stand beside.
    expect(barWidth).toBe(bandWidth);
  });

  it("splits a grouped band between the series, with a hairline between them", () => {
    const { bandStep, bandWidth, barWidth } = columnBands(720, 12, 2, true);
    expect(bandStep).toBe(60);
    expect(bandWidth).toBe(52);
    // 52 units of band, one unit of hairline, two bars: 25.5 each.
    expect(barWidth).toBe(25.5);
    expect(barWidth * 2 + 1).toBe(bandWidth);
  });

  it("gives three grouped series exactly the band minus its two hairlines", () => {
    const { bandWidth, barWidth } = columnBands(720, 6, 3, true);
    expect(barWidth * 3 + 2).toBeCloseTo(bandWidth, 12);
  });

  it("floors every width at 1, because a zero-width rect draws nothing at all", () => {
    // More slots than pixels: the honest degradation is a dense picket fence,
    // not an empty box that reads as a failed load.
    const dense = columnBands(100, 200, 1, false);
    expect(dense.bandStep).toBe(0.5);
    expect(dense.bandWidth).toBe(1);
    expect(dense.barWidth).toBe(1);

    const denseGrouped = columnBands(100, 50, 4, true);
    expect(denseGrouped.barWidth).toBe(1);
  });

  it("does not divide by zero when there are no slots", () => {
    expect(columnBands(320, 0, 1, false)).toEqual({
      bandStep: 320,
      bandWidth: 312,
      barWidth: 312,
    });
  });
});

describe("columnDomain", () => {
  it("stacks a slot's series into one total", () => {
    expect(columnDomain(2, [series("a", [3, 2]), series("b", [4, 1])], false, "zero")).toEqual([
      0, 7,
    ]);
  });

  it("does not stack grouped series — the tallest single bar sets the ceiling", () => {
    // Summing them would leave headroom no bar ever reaches, and would make a
    // grouped chart's axis disagree with the same data drawn stacked.
    expect(columnDomain(2, [series("a", [3, 2]), series("b", [4, 1])], true, "zero")).toEqual([
      0, 4,
    ]);
  });

  it("skips nulls rather than treating them as zero", () => {
    // A day with nothing logged is not a 0 day — and a 0 contributes nothing
    // to a sum anyway, so the visible difference is only ever in the drawing.
    expect(columnDomain(2, [series("a", [5, null]), series("b", [null, 5])], false, "zero")).toEqual(
      [0, 5],
    );
  });

  it("hinges a signed chart symmetrically about zero", () => {
    // Symmetric on purpose: the two directions must be measured with the same
    // ruler or a small loss beside a large gain reads as no loss at all.
    expect(
      columnDomain(7, [series("kcal", [420, 180, -150, 260, -300, 90, 310])], false, "signed"),
    ).toEqual([-420, 420]);
    expect(columnDomain(2, [series("kcal", [-10, -30])], false, "signed")).toEqual([-30, 30]);
  });

  it("sums each slot's directions independently on a signed chart", () => {
    // +5 and -9 in the same slot are two stacks from a shared baseline, not a
    // net of -4: the axis has to hold the taller of the two.
    expect(
      columnDomain(1, [series("a", [5]), series("b", [-9])], false, "signed"),
    ).toEqual([-9, 9]);
  });

  it("gives negatives no room on a zero-baseline chart", () => {
    // "zero" is the counts chart, and a count is not negative. Data that goes
    // below the line asks for `baseline="signed"`; asking for "zero" and
    // getting a clipped bar is the caller's statement, not a silent rescale.
    expect(columnDomain(2, [series("a", [-4, -9])], false, "zero")).toEqual([0, 1]);
  });

  it("falls back to a span of 1 when there is nothing to scale", () => {
    // Not 0: a zero-span domain sends `scaleLinear` to the middle of the range
    // and every bar would be drawn from the centre of the box.
    expect(columnDomain(0, [], false, "zero")).toEqual([0, 1]);
    expect(columnDomain(3, [series("a", [null, null, null])], false, "zero")).toEqual([0, 1]);
    expect(columnDomain(2, [series("a", [0, 0])], false, "signed")).toEqual([-1, 1]);
  });

  it("honours a caller's ceiling above and below the data", () => {
    // Above: a goal-relative chart whose axis must not shrink on a bad week.
    expect(columnDomain(2, [series("a", [3, 5])], false, "zero", 20)).toEqual([0, 20]);
    // Below: the caller has capped the axis and accepts the clipping.
    expect(columnDomain(2, [series("a", [100, 5])], false, "zero", 10)).toEqual([0, 10]);
  });
});

describe("slotLabelPlacement", () => {
  const bandStep = 320 / 7;

  it("centres a label over its own band", () => {
    expect(slotLabelPlacement(3, 7, bandStep, 320)).toEqual({
      x: 3 * bandStep + bandStep / 2,
      anchor: "middle",
    });
  });

  it("anchors the two end labels to the edges they sit against", () => {
    // A centred end label reaches past the drawing and is cut in half by the
    // `<svg>`'s own clip — measured at twelve weekly slots on a 720 box, where
    // the band is 60 units wide and „31.12." is nearly 40.
    expect(slotLabelPlacement(0, 7, bandStep, 320)).toEqual({ x: 0, anchor: "start" });
    expect(slotLabelPlacement(6, 7, bandStep, 320)).toEqual({ x: 320, anchor: "end" });
  });

  it("keeps a lone slot centred, since there is no neighbour to crowd", () => {
    expect(slotLabelPlacement(0, 1, 320, 320)).toEqual({ x: 160, anchor: "middle" });
  });

  it("treats two slots as two ends and nothing in between", () => {
    expect(slotLabelPlacement(0, 2, 160, 320).anchor).toBe("start");
    expect(slotLabelPlacement(1, 2, 160, 320).anchor).toBe("end");
  });

  it("never places a label outside the drawing", () => {
    for (let i = 0; i < 7; i += 1) {
      const { x } = slotLabelPlacement(i, 7, bandStep, 320);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(320);
    }
  });
});
