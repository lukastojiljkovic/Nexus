import { describe, expect, it } from "vitest";

import { clamp01, layOutSegments } from "./ProportionBar.js";
import type { ProportionSegment } from "./ProportionBar.js";

const seg = (key: string, fraction: number): ProportionSegment => ({
  key,
  fraction,
  tone: "accent",
  label: key,
});

describe("clamp01", () => {
  it("passes an ordinary fraction through untouched", () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(1)).toBe(1);
  });

  it("clamps both ends", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(4.2)).toBe(1);
  });

  it("turns a non-finite fraction into 0 rather than letting it reach CSS", () => {
    // `NaN%` is a value CSS discards silently: the fill never appears and
    // nothing anywhere says why. An empty denominator — a macro with no goal —
    // is how a 0/0 gets here.
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clamp01(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("layOutSegments", () => {
  it("lays segments end to end, each starting where the last one ended", () => {
    expect(layOutSegments([seg("a", 0.4), seg("b", 0.3)])).toEqual([
      { key: "a", fraction: 0.4, tone: "accent", label: "a", start: 0, width: 0.4 },
      { key: "b", fraction: 0.3, tone: "accent", label: "b", start: 0.4, width: 0.3 },
    ]);
  });

  it("never lets the stack run off the end of the track", () => {
    // The defect this replaced: each segment was clamped on its own but the
    // RUNNING TOTAL was not, so two segments of 0.7 produced `left: 70%;
    // width: 70%` — a fill painting 40% of a track's width past its track,
    // which `.nx-proportion__track` does not clip (and must not: the target
    // mark and the rounded ends depend on that).
    const laid = layOutSegments([seg("a", 0.7), seg("b", 0.7)]);
    expect(laid[0]?.width).toBe(0.7);
    expect(laid[1]?.start).toBe(0.7);
    expect((laid[1]?.start ?? 0) + (laid[1]?.width ?? 0)).toBeLessThanOrEqual(1);
  });

  it("gives a segment past a full track no width rather than a negative one", () => {
    const laid = layOutSegments([seg("a", 1), seg("b", 0.5), seg("c", 0.5)]);
    expect(laid.map((s) => s.width)).toEqual([1, 0, 0]);
    expect(laid.map((s) => s.start)).toEqual([0, 1, 1]);
  });

  it("keeps every segment inside the track for any input at all", () => {
    const laid = layOutSegments([
      seg("a", -2),
      seg("b", Number.NaN),
      seg("c", 0.35),
      seg("d", 9),
      seg("e", 0.25),
    ]);
    for (const s of laid) {
      expect(s.start).toBeGreaterThanOrEqual(0);
      expect(s.width).toBeGreaterThanOrEqual(0);
      expect(s.start + s.width).toBeLessThanOrEqual(1);
    }
  });

  it("still draws the over-budget case the callers actually pass", () => {
    // 210g against a 180g goal is expressed by normalising both against the
    // larger total, which is how the drawing shows the goal AND the overshoot.
    // That has always summed to exactly 1 and must be untouched by the clamp.
    const laid = layOutSegments([seg("within", 180 / 210), seg("over", 30 / 210)]);
    expect(laid[0]?.width).toBeCloseTo(180 / 210, 12);
    expect(laid[1]?.width).toBeCloseTo(30 / 210, 12);
    expect((laid[1]?.start ?? 0) + (laid[1]?.width ?? 0)).toBeCloseTo(1, 12);
  });

  it("carries the segment's own fields through untouched", () => {
    const laid = layOutSegments([{ key: "p", fraction: 0.5, tone: "danger", label: "128 g" }]);
    expect(laid[0]).toMatchObject({ key: "p", tone: "danger", label: "128 g", fraction: 0.5 });
  });

  it("returns nothing for an unmeasured row", () => {
    expect(layOutSegments([])).toEqual([]);
  });
});
