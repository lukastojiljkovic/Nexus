import { describe, expect, it } from "vitest";

import {
  listDetailFocusIndex,
  listDetailKeyIntent,
  listDetailRowProps,
  listDetailStep,
} from "./listDetailKeys.js";

/**
 * The master-detail list's keyboard and ARIA model, pinned to the WAI-ARIA
 * Authoring Practices' listbox pattern (single-select, selection following
 * focus): ↓/↑ move between options and wrap at both ends, Enter selects the
 * option the keyboard is standing on, Escape closes the detail and leaves the
 * keyboard where it was. Exactly one option is in the page's Tab order.
 */
describe("listDetailKeyIntent", () => {
  it("walks the list with the vertical arrows", () => {
    expect(listDetailKeyIntent("ArrowDown")).toBe("next");
    expect(listDetailKeyIntent("ArrowUp")).toBe("previous");
  });

  it("opens the row under the keyboard on Enter", () => {
    expect(listDetailKeyIntent("Enter")).toBe("select");
  });

  it("closes the detail on Escape", () => {
    expect(listDetailKeyIntent("Escape")).toBe("close");
  });

  it("leaves every other key — including Space — to the page", () => {
    // Space means the same as Enter in a single-select listbox, and an
    // unhandled Space scrolls the page. Answering it here would take a
    // page-level key away to repeat what Enter already does.
    expect(listDetailKeyIntent(" ")).toBe("none");
    expect(listDetailKeyIntent("Home")).toBe("none");
    expect(listDetailKeyIntent("PageDown")).toBe("none");
    expect(listDetailKeyIntent("a")).toBe("none");
  });
});

describe("listDetailStep", () => {
  it("moves one row and wraps at both ends", () => {
    expect(listDetailStep(0, 3, 1)).toBe(1);
    expect(listDetailStep(2, 3, 1)).toBe(0);
    expect(listDetailStep(0, 3, -1)).toBe(2);
  });

  it("enters the list from nothing focused, from the correct end", () => {
    expect(listDetailStep(-1, 3, 1)).toBe(0);
    expect(listDetailStep(-1, 3, -1)).toBe(2);
  });

  it("answers null for an empty list rather than pretending to move", () => {
    expect(listDetailStep(-1, 0, 1)).toBeNull();
  });
});

describe("listDetailRowProps", () => {
  const base = { baseId: "ld1", rowId: "n-2", index: 1, focusIndex: 1, selected: true };

  it("makes the row an option, selected, and the list's one tab stop", () => {
    expect(listDetailRowProps(base)).toEqual({
      id: "ld1-n-2",
      role: "option",
      "aria-selected": true,
      tabIndex: 0,
    });
  });

  it("takes every other row out of the tab order", () => {
    expect(listDetailRowProps({ ...base, index: 2, selected: false }).tabIndex).toBe(-1);
    expect(listDetailRowProps({ ...base, index: 2, selected: false })["aria-selected"]).toBe(false);
  });

  it("falls back to the first row when the keyboard has nowhere to stand", () => {
    // `focusIndex` is -1 for an empty list and for the frame before anything
    // has moved; the row that must stay reachable is still the first one.
    expect(listDetailRowProps({ ...base, index: 0, focusIndex: -1 }).tabIndex).toBe(0);
    expect(listDetailRowProps({ ...base, index: 1, focusIndex: -1 }).tabIndex).toBe(-1);
  });
});

describe("listDetailFocusIndex", () => {
  const ids = ["a", "b", "c"];

  it("follows the selection when there is one", () => {
    expect(listDetailFocusIndex(ids, "c", -1)).toBe(2);
    expect(listDetailFocusIndex(ids, "b", 2)).toBe(1);
  });

  it("starts at the first row when nothing is selected and nothing has moved", () => {
    expect(listDetailFocusIndex(ids, null, -1)).toBe(0);
  });

  it("keeps the keyboard where it was while the list changes under it", () => {
    expect(listDetailFocusIndex(ids, null, 2)).toBe(2);
  });

  it("clamps rather than pointing at a row that no longer exists", () => {
    // The selected row was filtered away, or deleted: the next render must not
    // leave `focusIndex` on 2 of a two-row list.
    expect(listDetailFocusIndex(["a", "b"], "gone", 2)).toBe(1);
    expect(listDetailFocusIndex([], "gone", 2)).toBe(-1);
  });
});
