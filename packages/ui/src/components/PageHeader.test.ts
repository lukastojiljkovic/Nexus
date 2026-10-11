import { describe, expect, it } from "vitest";

import { overflowTriggerProps } from "./PageHeader.js";

/**
 * The header's overflow, whose only screen-reader contract is that its trigger
 * says whether the panel is open and which panel it is. The trigger is
 * icon-only and for the narrow window only, so the two attributes are the whole
 * of what a listener gets.
 */
describe("overflowTriggerProps", () => {
  it("reports the panel closed with the trigger's own control target", () => {
    expect(overflowTriggerProps(false, "hdr-more")).toEqual({
      "aria-expanded": false,
      "aria-controls": "hdr-more",
    });
  });

  it("flips only the expanded flag when the panel opens", () => {
    expect(overflowTriggerProps(true, "hdr-more")).toEqual({
      "aria-expanded": true,
      "aria-controls": "hdr-more",
    });
  });

  it("claims no popup role, because the panel is a disclosure and not a menu", () => {
    // `aria-haspopup="menu"` promises arrow-key roving focus among menu items.
    // The panel holds the page's own controls — a settings gear, a view
    // toggle — and Tab is what moves between them, so the promise would be a
    // lie a keyboard user would act on.
    expect("aria-haspopup" in overflowTriggerProps(true, "hdr-more")).toBe(false);
  });
});
