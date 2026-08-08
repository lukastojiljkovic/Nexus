import { describe, expect, it } from "vitest";
import { scaleLinear } from "@nexus/core";

import { fitLabel, laneRow, spanExtent } from "./SpanLanes.js";

describe("fitLabel", () => {
  it("leaves a label that fits exactly as it is", () => {
    expect(fitLabel("Odmor")).toBe("Odmor");
    // Fourteen glyphs is the limit, and the limit itself is not truncated.
    expect(fitLabel("Ispitni rok 12")).toBe("Ispitni rok 12");
  });

  it("truncates to the same total width, ellipsis included", () => {
    // SVG `<text>` does not wrap, does not ellipsise and — because the chart's
    // svg is `overflow: visible` so marks may sit outside the plot — does not
    // even clip. „Zdravstvena knjižica" painted straight across the bars and
    // off the right edge of the figure.
    const fitted = fitLabel("Zdravstvena knjižica");
    expect(fitted).toBe("Zdravstvena k…");
    expect(Array.from(fitted)).toHaveLength(14);
  });

  it("counts Serbian diacritics as one glyph each, not as their code units", () => {
    // „Č" and „ž" are single code points in the strings this product stores,
    // but a naive byte or UTF-16 measure over some other normalisation would
    // shorten this label for the wrong reason.
    expect(fitLabel("Čćžšđ Čćžšđ")).toBe("Čćžšđ Čćžšđ");
  });

  it("never cuts through the middle of a surrogate pair", () => {
    // `Array.from` rather than `slice`: cutting a pair in half produces a lone
    // surrogate, which renders as a replacement box — a truncation that is
    // itself a rendering defect.
    const fitted = fitLabel("🏃".repeat(20));
    expect(Array.from(fitted)).toHaveLength(14);
    expect(fitted.endsWith("…")).toBe(true);
    // A high surrogate with no low one after it, or a low one with no high one
    // before it — the two shapes a cut-through-the-middle leaves behind.
    expect(fitted).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("handles the empty label without inventing an ellipsis", () => {
    expect(fitLabel("")).toBe("");
  });
});

describe("laneRow", () => {
  it("centres the track in its row", () => {
    // Every mark is derived from `trackY`, so a taller lane moves the track
    // and its annotations together or not at all.
    expect(laneRow(0, 26)).toEqual({ rowY: 0, trackY: 8, trackMid: 13 });
    expect(laneRow(3, 26)).toEqual({ rowY: 78, trackY: 86, trackMid: 91 });
  });

  it("leaves the same air above the track as below it, at any lane height", () => {
    for (const laneHeight of [16, 26, 40, 61]) {
      const { rowY, trackY } = laneRow(2, laneHeight);
      const above = trackY - rowY;
      const below = rowY + laneHeight - (trackY + 10);
      expect(above).toBeCloseTo(below, 12);
    }
  });

  it("stacks rows with no overlap and no gap", () => {
    const first = laneRow(0, 26);
    const second = laneRow(1, 26);
    expect(second.rowY - first.rowY).toBe(26);
  });
});

describe("spanExtent", () => {
  // The August chart from the gallery: 31 days across a 320-wide box, with the
  // left 84 units given to the lane labels.
  const xScale = scaleLinear([1, 31], [84, 320]);

  it("maps a closed span onto both its ends", () => {
    const { x, width, open } = spanExtent(5, 20, xScale, 320);
    expect(x).toBeCloseTo(xScale(5), 12);
    expect(width).toBeCloseTo(xScale(20) - xScale(5), 12);
    expect(open).toBe(false);
  });

  it("runs an open span to the frame edge and reports that it is open", () => {
    // An interval that has not ended has no end to map. The `open` flag is
    // what the caller reads back to drop the rounded terminus: an unfinished
    // holiday must not be given a false edge just because the canvas has one.
    const { x, width, open } = spanExtent(22, "open", xScale, 320);
    expect(open).toBe(true);
    expect(x).toBeCloseTo(xScale(22), 12);
    expect(x + width).toBe(320);
  });

  it("runs an open span to the RIGHT it is given, not to the domain's end", () => {
    // In the component those two happen to coincide (the scale's range ends at
    // the frame). Pinning them apart is what keeps a future caller from
    // „simplifying" this into `xScale(domain[1])` and silently reintroducing
    // the false terminus.
    expect(spanExtent(22, "open", xScale, 500).width).toBeCloseTo(500 - xScale(22), 12);
  });

  it("keeps a same-day span visible instead of drawing nothing", () => {
    // A zero-width rect paints nothing, so a one-day holiday would silently
    // vanish from the chart that exists to show it.
    expect(spanExtent(10, 10, xScale, 320).width).toBe(1);
  });

  it("never returns a negative width, whatever order the ends arrive in", () => {
    expect(spanExtent(20, 5, xScale, 320).width).toBe(1);
  });

  it("puts a span that fills the domain across the whole plot", () => {
    const { x, width } = spanExtent(1, 31, xScale, 320);
    expect(x).toBeCloseTo(84, 12);
    expect(x + width).toBeCloseTo(320, 12);
  });
});
