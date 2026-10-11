import { describe, expect, it } from "vitest";

import { dialogAria } from "./ConfirmDialog.js";

/**
 * The ARIA a modal panel wears, as one value. Every dialog in the app is a
 * `role="dialog"` with `aria-modal`, named by its heading and described by its
 * question — and the failure mode this pins is the quiet one: `aria-describedby`
 * left off, so the panel announces a title and nothing else.
 */
describe("dialogAria", () => {
  it("names the panel by its heading and describes it with its question", () => {
    expect(dialogAria({ titleId: "dlg-title", describedById: "dlg-question" })).toEqual({
      role: "dialog",
      "aria-modal": true,
      "aria-labelledby": "dlg-title",
      "aria-describedby": "dlg-question",
    });
  });

  it("is not an alertdialog, so it does not interrupt", () => {
    // `alertdialog` makes some screen readers cut across whatever is being
    // read. Every dialog the product already ships is a plain `dialog` (the
    // renderer's own shared recipe among them), and a shared component that
    // announced itself differently would be the odd one out for no reason a
    // user could name.
    expect(dialogAria({ titleId: "t", describedById: "q" }).role).toBe("dialog");
  });
});
