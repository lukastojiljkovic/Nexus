import { describe, expect, it } from "vitest";

import { settingsRowAria } from "./SettingsRow.js";

/**
 * The row is a group named by its label, described by its hint. The hint is
 * pointed at only when one is drawn, so the description never names an id that
 * no element carries.
 */
describe("settingsRowAria", () => {
  it("names the row by its label and describes it with its hint", () => {
    expect(settingsRowAria({ labelId: "row-label", hintId: "row-hint" })).toEqual({
      role: "group",
      "aria-labelledby": "row-label",
      "aria-describedby": "row-hint",
    });
  });

  it("describes nothing when the row has no hint", () => {
    const aria = settingsRowAria({ labelId: "row-label" });
    expect(aria).toEqual({ role: "group", "aria-labelledby": "row-label" });
    expect("aria-describedby" in aria).toBe(false);
  });
});
