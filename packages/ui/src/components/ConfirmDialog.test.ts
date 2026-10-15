import { describe, expect, it } from "vitest";

import { confirmFocus } from "./ConfirmDialog.js";

/**
 * Which answer a confirmation opens on.
 *
 * The failure this pins is the one a keyboard user meets first: focus landing
 * on the DELETING button, so the key pressed without reading the panel is the
 * key that destroys. The WAI-ARIA Authoring Practices' alert-dialog note is the
 * rule — „the initial focus should be placed on the least destructive action" —
 * and for a single act with a single cost the least destructive action is
 * always the cancelling one.
 */
describe("confirmFocus", () => {
  const cancelRef = { current: null };
  const confirmRef = { current: null };

  it("opens a destructive act on the cancelling answer", () => {
    expect(confirmFocus(true, cancelRef, confirmRef)).toBe(cancelRef);
  });

  it("opens a harmless act on the answer that does the thing", () => {
    // Here the act IS what was asked for, so declining it is the surprise.
    expect(confirmFocus(false, cancelRef, confirmRef)).toBe(confirmRef);
  });

  it("never opens a destructive act on the acting answer", () => {
    expect(confirmFocus(true, cancelRef, confirmRef)).not.toBe(confirmRef);
  });
});
