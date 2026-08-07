import { describe, expect, it } from "vitest";

import {
  firstFocusableIndex,
  lastFocusableIndex,
  nextFocusableIndex,
  type FocusCandidate,
} from "./focusOrder.js";

/**
 * `focusOrder.ts` is the arithmetic behind both the modal focus trap
 * (Tab/Shift+Tab) and the `notePopover.tsx` menu's roving focus
 * (ArrowDown/ArrowUp, Home/End) — pure, because Vitest runs with no DOM in
 * this repo (see `apps/desktop/vitest.config.ts`), so the only part of either
 * feature that can be pinned by a test is the index math, not the DOM
 * traversal that feeds it.
 */

function candidate(overrides: Partial<FocusCandidate> = {}): FocusCandidate {
  return { tabIndex: 0, disabled: false, hidden: false, ...overrides };
}

describe("nextFocusableIndex", () => {
  it("moves forward by one", () => {
    const list = [candidate(), candidate(), candidate()];
    expect(nextFocusableIndex(list, 0, 1)).toBe(1);
    expect(nextFocusableIndex(list, 1, 1)).toBe(2);
  });

  it("moves backward by one", () => {
    const list = [candidate(), candidate(), candidate()];
    expect(nextFocusableIndex(list, 2, -1)).toBe(1);
    expect(nextFocusableIndex(list, 1, -1)).toBe(0);
  });

  it("wraps forward from the last candidate to the first", () => {
    const list = [candidate(), candidate(), candidate()];
    expect(nextFocusableIndex(list, 2, 1)).toBe(0);
  });

  it("wraps backward from the first candidate to the last", () => {
    const list = [candidate(), candidate(), candidate()];
    expect(nextFocusableIndex(list, 0, -1)).toBe(2);
  });

  it("returns null for an empty list", () => {
    expect(nextFocusableIndex([], 0, 1)).toBeNull();
    expect(nextFocusableIndex([], -1, -1)).toBeNull();
  });

  it("wraps a single candidate back to itself in either direction", () => {
    const list = [candidate()];
    expect(nextFocusableIndex(list, 0, 1)).toBe(0);
    expect(nextFocusableIndex(list, 0, -1)).toBe(0);
  });

  it("returns null when every candidate is disabled, hidden, or untabbable", () => {
    const list = [
      candidate({ disabled: true }),
      candidate({ hidden: true }),
      candidate({ tabIndex: -1 }),
    ];
    expect(nextFocusableIndex(list, 0, 1)).toBeNull();
    expect(nextFocusableIndex(list, 0, -1)).toBeNull();
  });

  it("skips disabled candidates while moving forward", () => {
    const list = [candidate(), candidate({ disabled: true }), candidate()];
    expect(nextFocusableIndex(list, 0, 1)).toBe(2);
  });

  it("skips hidden candidates while moving backward", () => {
    const list = [candidate(), candidate({ hidden: true }), candidate()];
    expect(nextFocusableIndex(list, 2, -1)).toBe(0);
  });

  it("skips candidates excluded from the tab order (tabIndex -1)", () => {
    const list = [candidate(), candidate({ tabIndex: -1 }), candidate()];
    expect(nextFocusableIndex(list, 0, 1)).toBe(2);
  });

  it("wraps past a run of skippable candidates at the boundary", () => {
    const list = [candidate({ disabled: true }), candidate({ hidden: true }), candidate()];
    // From the last (reachable) candidate, moving forward must wrap all the
    // way around the two skippable ones at the front and land back on itself.
    expect(nextFocusableIndex(list, 2, 1)).toBe(2);
  });

  it("finds the first reachable candidate from an unfocused start (-1)", () => {
    const list = [candidate({ disabled: true }), candidate(), candidate()];
    expect(nextFocusableIndex(list, -1, 1)).toBe(1);
  });

  /**
   * The mirror of the case above, and it was wrong when this module first
   * landed: `-1` was fed straight into the modulo, so moving BACKWARD from
   * „nothing focused" landed on `count - 2` — one short of the end, silently,
   * and only in the narrow case where focus sits inside the container but not
   * on a candidate (a `contenteditable`, an element the tabbable selector does
   * not name, or a panel that was clicked rather than arrowed into).
   */
  it("finds the LAST reachable candidate moving backward from an unfocused start", () => {
    const three = [candidate(), candidate(), candidate()];
    expect(nextFocusableIndex(three, -1, -1)).toBe(2);
    const trailingSkippable = [candidate(), candidate(), candidate({ disabled: true })];
    expect(nextFocusableIndex(trailingSkippable, -1, -1)).toBe(1);
    // Two candidates is where the off-by-one hid: count - 2 is 0, which is a
    // valid index and a plausible-looking answer, so nothing looked broken.
    expect(nextFocusableIndex([candidate(), candidate()], -1, -1)).toBe(1);
  });

  it("treats an index past the end as unfocused rather than wrapping from it", () => {
    const list = [candidate(), candidate(), candidate()];
    expect(nextFocusableIndex(list, 9, 1)).toBe(0);
    expect(nextFocusableIndex(list, 9, -1)).toBe(2);
  });
});

describe("firstFocusableIndex", () => {
  it("returns the first candidate when it is reachable", () => {
    expect(firstFocusableIndex([candidate(), candidate()])).toBe(0);
  });

  it("skips leading disabled and hidden candidates", () => {
    const list = [candidate({ disabled: true }), candidate({ hidden: true }), candidate()];
    expect(firstFocusableIndex(list)).toBe(2);
  });

  it("returns null for an empty list", () => {
    expect(firstFocusableIndex([])).toBeNull();
  });

  it("returns null when every candidate is skippable", () => {
    expect(firstFocusableIndex([candidate({ disabled: true }), candidate({ hidden: true })])).toBeNull();
  });
});

describe("lastFocusableIndex", () => {
  it("returns the last candidate when it is reachable", () => {
    expect(lastFocusableIndex([candidate(), candidate()])).toBe(1);
  });

  it("skips trailing disabled and hidden candidates", () => {
    const list = [candidate(), candidate({ disabled: true }), candidate({ hidden: true })];
    expect(lastFocusableIndex(list)).toBe(0);
  });

  it("returns null for an empty list", () => {
    expect(lastFocusableIndex([])).toBeNull();
  });

  it("returns null when every candidate is skippable", () => {
    expect(lastFocusableIndex([candidate({ tabIndex: -1 }), candidate({ disabled: true })])).toBeNull();
  });
});
