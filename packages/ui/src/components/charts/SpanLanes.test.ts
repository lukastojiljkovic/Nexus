import { describe, expect, it } from "vitest";
import { scaleLinear } from "@nexus/core";

import { fitLabel, laneRow, ruleLabelPlacement, spanExtent } from "./SpanLanes.js";

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

describe("ruleLabelPlacement", () => {
  it("sits to the right of the rule while there is room", () => {
    // 320-wide box, rule a third across, a four-character label: 4 * 6.5 = 26px
    // needed and 213 available, so nothing has to move.
    expect(ruleLabelPlacement(100, "sada", 320)).toEqual({ x: 103, anchor: "start" });
  });

  it("flips to the left when the rule is at the right edge", () => {
    // „sada" on FOKUS's „Trake pažnje" — the rule is AT the end of the axis
    // whenever the last logged phase is the most recent thing that happened,
    // which is the normal case, and the label ran 112.5px outside the svg.
    expect(ruleLabelPlacement(320, "sada", 320)).toEqual({ x: 317, anchor: "end" });
  });

  it("flips as soon as the label would not fit whole, not once it has left", () => {
    // 300 + 3 + 26 = 329 > 320. The old code only looked wrong once the text
    // was already outside; the boundary is where it stops FITTING.
    expect(ruleLabelPlacement(300, "sada", 320).anchor).toBe("end");
    expect(ruleLabelPlacement(290, "sada", 320).anchor).toBe("start");
  });

  it("keeps a rule near the LEFT edge on the right-hand side, where the room is", () => {
    // Worth pinning because it is the case the flip must not overreact to: at
    // x = 2 in a 320 box there is 315px of room to the right, so flipping would
    // push the label off the left edge to solve a problem that is not there.
    expect(ruleLabelPlacement(2, "sada", 320)).toEqual({ x: 5, anchor: "start" });
  });

  it("does not leave by the other edge when the box is too small for either side", () => {
    // A 20px box cannot hold a 26px label anywhere. The clamp is what keeps the
    // failure symmetrical — the label starts at the left edge instead of at
    // x = -1, so what is lost is the tail rather than the first letters.
    const placed = ruleLabelPlacement(2, "sada", 20);
    expect(placed.anchor).toBe("end");
    expect(placed.x).toBe(26);
  });

  it("gives a longer label more room before it flips", () => {
    expect(ruleLabelPlacement(250, "rok", 320).anchor).toBe("start");
    expect(ruleLabelPlacement(250, "krajnji rok", 320).anchor).toBe("end");
  });
});
