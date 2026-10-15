import { describe, expect, it } from "vitest";

import { segmentedOptionState } from "./Segmented.js";

/**
 * What one entry of a segmented control says about itself.
 *
 * The rule is that „which one is on" is ONE fact: the entry states it in
 * `aria-pressed`, and the shared class paints from exactly that attribute. Both
 * failure modes are quiet — a modifier class beside the shared one starts a
 * second way of saying „selected", and an entry that is painted selected while
 * announcing `false` is a screen reader telling the user the opposite of the
 * screen.
 */
describe("segmentedOptionState", () => {
  it("announces the entry that is on", () => {
    expect(segmentedOptionState(true)).toEqual({
      className: "nx-segmented__option",
      "aria-pressed": true,
    });
  });

  it("announces the entries that are not", () => {
    expect(segmentedOptionState(false)).toEqual({
      className: "nx-segmented__option",
      "aria-pressed": false,
    });
  });

  it("carries no selected modifier for a caller to style instead", () => {
    // One class for both states: the paint lives in the `aria-pressed` rule, so
    // there is nothing a call site could reach for that would disagree with it.
    expect(segmentedOptionState(true).className).toBe(segmentedOptionState(false).className);
  });
});
