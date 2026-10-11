import { describe, expect, it } from "vitest";

import { dialogKeyIntent, initialFocusIndex } from "./dialogFocus.js";

/**
 * The dialog's two keyboard decisions, pinned to the WAI-ARIA Authoring
 * Practices' dialog (modal) pattern and its alert-dialog note:
 *
 *   - Escape closes the dialog.
 *   - Tab cycles inside it (reported here as `"cycle"`; the DOM half measures
 *     the elements).
 *   - The opening focus goes to the least destructive action.
 */
describe("dialogKeyIntent", () => {
  it("closes on Escape", () => {
    expect(dialogKeyIntent("Escape")).toBe("cancel");
  });

  it("reports Tab so the trap can cycle the panel's own elements", () => {
    expect(dialogKeyIntent("Tab")).toBe("cycle");
  });

  it("answers nothing for Enter, deliberately", () => {
    // The house rule: no default primary, so Enter picks nothing until a
    // button has focus. A confirmation that acts on a bare Enter is a
    // confirmation that deletes what the reader was still reading about.
    expect(dialogKeyIntent("Enter")).toBe("none");
    expect(dialogKeyIntent(" ")).toBe("none");
    expect(dialogKeyIntent("a")).toBe("none");
  });
});

describe("initialFocusIndex", () => {
  /**
   * The panel's two answers in the order `ConfirmDialog` renders them: the
   * cancelling button at index 0, the button that acts at index 1.
   */
  it("puts a destructive act's opening focus on the answer that changes nothing", () => {
    expect(initialFocusIndex(2, true)).toBe(0);
  });

  it("puts a benign act's opening focus on the answer that does the thing", () => {
    // Here the act IS what was asked for, so declining it is the surprise.
    expect(initialFocusIndex(2, false)).toBe(1);
  });

  it("has nothing to choose between with one candidate", () => {
    expect(initialFocusIndex(1, true)).toBe(0);
    expect(initialFocusIndex(1, false)).toBe(0);
  });

  it("is null when the panel holds no candidate at all", () => {
    expect(initialFocusIndex(0, true)).toBeNull();
    expect(initialFocusIndex(-1, false)).toBeNull();
  });
});
