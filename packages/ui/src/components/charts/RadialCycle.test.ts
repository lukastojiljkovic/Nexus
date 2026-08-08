import { describe, expect, it } from "vitest";

import { angleFor, clamp01, dialSlotsFor, markAnchor, ringGeometry, slotCount } from "./RadialCycle.js";

describe("slotCount", () => {
  it("gives each period its real number of positions", () => {
    expect(slotCount({ kind: "day" })).toBe(24);
    expect(slotCount({ kind: "week", weekStartsOn: 1 })).toBe(7);
    expect(slotCount({ kind: "year" })).toBe(12);
  });

  it("does not vary a week's length with its first day", () => {
    expect(slotCount({ kind: "week", weekStartsOn: 0 })).toBe(
      slotCount({ kind: "week", weekStartsOn: 1 }),
    );
  });
});

describe("angleFor", () => {
  it("puts slot 0 at twelve o'clock", () => {
    // SVG's angle zero points RIGHT. Without the quarter-turn every ring in
    // the product would be rotated and „ponedeljak" would sit at three
    // o'clock — a rotation nobody notices as a bug, only as a chart that
    // reads wrong.
    const a = angleFor(0, 12);
    expect(Math.cos(a)).toBeCloseTo(0, 12);
    expect(Math.sin(a)).toBeCloseTo(-1, 12);
  });

  it("runs clockwise, like a clock face and a compass", () => {
    // A quarter of the way round a 12-slot ring is three o'clock, not nine.
    const quarter = angleFor(3, 12);
    expect(Math.cos(quarter)).toBeCloseTo(1, 12);
    expect(Math.sin(quarter)).toBeCloseTo(0, 12);

    const half = angleFor(6, 12);
    expect(Math.cos(half)).toBeCloseTo(0, 12);
    expect(Math.sin(half)).toBeCloseTo(1, 12);
  });

  it("closes the ring — slot n points the same way as slot 0", () => {
    for (const n of [7, 12, 24]) {
      expect(Math.cos(angleFor(n, n))).toBeCloseTo(Math.cos(angleFor(0, n)), 12);
      expect(Math.sin(angleFor(n, n))).toBeCloseTo(Math.sin(angleFor(0, n)), 12);
    }
  });

  it("spaces a day's hours evenly", () => {
    const step = angleFor(1, 24) - angleFor(0, 24);
    for (let hour = 1; hour < 24; hour += 1) {
      expect(angleFor(hour, 24) - angleFor(hour - 1, 24)).toBeCloseTo(step, 12);
    }
    expect(step).toBeCloseTo((Math.PI * 2) / 24, 12);
  });
});

describe("ringGeometry", () => {
  it("centres the ring and leaves the marks their room outside it", () => {
    expect(ringGeometry(320)).toEqual({ cx: 160, cy: 160, r: 130 });
    expect(ringGeometry(720)).toEqual({ cx: 360, cy: 360, r: 330 });
  });

  it("keeps a mark's dot and label inside the viewBox at both sizes", () => {
    // Marks are drawn at `r + 6` (the dot) and `r + 14` (the label). A radius
    // of `size / 2` would put every one of them outside the box, where the
    // `<svg>` simply does not paint them.
    for (const size of [320, 720] as const) {
      const { r } = ringGeometry(size);
      expect(r + 14).toBeLessThanOrEqual(size / 2);
    }
  });

  it("stays square — the ring is never stretched to its container", () => {
    const { cx, cy } = ringGeometry(720);
    expect(cx).toBe(cy);
  });
});

describe("markAnchor", () => {
  it("runs a label outward from the ring on both sides", () => {
    // Anchoring both sides the same way is how the left half of a ring ends up
    // written over the ring itself.
    expect(markAnchor(1)).toBe("start");
    expect(markAnchor(-1)).toBe("end");
  });

  it("centres the labels nearest the vertical", () => {
    expect(markAnchor(0)).toBe("middle");
    expect(markAnchor(0.2)).toBe("middle");
    expect(markAnchor(-0.2)).toBe("middle");
  });

  it("switches side just outside the dead band", () => {
    // The band is what stops the two labels near twelve o'clock from flipping
    // side on a one-slot difference.
    expect(markAnchor(0.21)).toBe("start");
    expect(markAnchor(-0.21)).toBe("end");
  });

  it("matches the anchor to the real angles of a weekly ring", () => {
    const anchors = Array.from({ length: 7 }, (_, i) => markAnchor(Math.cos(angleFor(i, 7))));
    // Monday sits at the top and is centred; the three days on the right lean
    // right, the three on the left lean left. Seven is the odd count where a
    // naive "first half / second half" rule would be off by one.
    expect(anchors).toEqual(["middle", "start", "start", "start", "end", "end", "end"]);
  });
});

describe("dialSlotsFor", () => {
  it("gives every position in the period a tick by default", () => {
    expect(dialSlotsFor({ kind: "day" }, [])).toHaveLength(24);
    expect(dialSlotsFor({ kind: "year" }, [])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("removes the positions that were never asked of the user", () => {
    // Not the same as a position with no spoke: that one still gets its tick,
    // because it WAS in scope and recorded nothing. `absent` says the position
    // itself was out of scope — the habit is not tracked on weekends.
    expect(dialSlotsFor({ kind: "week", weekStartsOn: 1 }, [5, 6])).toEqual([0, 1, 2, 3, 4]);
  });

  it("ignores an absent index the period does not have", () => {
    expect(dialSlotsFor({ kind: "week", weekStartsOn: 1 }, [99, -1])).toHaveLength(7);
  });

  it("returns an empty dial when everything is absent, rather than a full one", () => {
    expect(dialSlotsFor({ kind: "week", weekStartsOn: 1 }, [0, 1, 2, 3, 4, 5, 6])).toEqual([]);
  });
});

describe("clamp01", () => {
  it("bounds a spoke to the ring's radius without changing the state behind it", () => {
    expect(clamp01(0.6)).toBe(0.6);
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});
