import { describe, expect, it } from "vitest";

import { wrappedStep } from "./focusCycle.js";

/**
 * The one index arithmetic behind both keyboard cycles in this package: the
 * dialog's Tab/Shift+Tab wrap (WAI-ARIA APG, dialog pattern: "Tab ... moves
 * focus to the next element in the dialog; if focus is on the last element,
 * moves focus to the first") and the master-detail list's ↑/↓ walk (APG,
 * listbox pattern: arrow keys move and wrap).
 *
 * Every expectation below is the arithmetic written out, so a failure names
 * the value rather than the shape.
 */
describe("wrappedStep", () => {
  it("steps forward, and wraps from the last candidate to the first", () => {
    expect(wrappedStep(0, 3, 1)).toBe(1);
    expect(wrappedStep(1, 3, 1)).toBe(2);
    // (2 + 1) % 3
    expect(wrappedStep(2, 3, 1)).toBe(0);
  });

  it("steps backward, and wraps from the first candidate to the last", () => {
    expect(wrappedStep(2, 3, -1)).toBe(1);
    // (0 - 1 + 3) % 3
    expect(wrappedStep(0, 3, -1)).toBe(2);
  });

  it("reads `-1` — nothing focused yet — as before-the-first going forward", () => {
    expect(wrappedStep(-1, 3, 1)).toBe(0);
  });

  it("reads `-1` going BACKWARD as after-the-last, not as one short of it", () => {
    // The normalisation this rule exists for: start becomes `count` (3), so
    // (3 - 1) % 3 is the last index. Without it, (-1 - 1 + 3) % 3 would land on
    // 1 — the middle of a three-item list, silently.
    expect(wrappedStep(-1, 3, -1)).toBe(2);
    // A single candidate has one answer in both directions.
    expect(wrappedStep(-1, 1, -1)).toBe(0);
    expect(wrappedStep(-1, 1, 1)).toBe(0);
  });

  it("wraps an index past the end rather than running off it", () => {
    // Stale positions arrive after a list changes under the keyboard.
    expect(wrappedStep(9, 3, 1)).toBe(0);
    expect(wrappedStep(9, 3, -1)).toBe(2);
  });

  it("answers null — not 0 — when there is no candidate at all", () => {
    expect(wrappedStep(0, 0, 1)).toBeNull();
    expect(wrappedStep(-1, 0, -1)).toBeNull();
  });
});
