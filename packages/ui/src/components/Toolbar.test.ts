import { describe, expect, it } from "vitest";

import { toolbarAria } from "./Toolbar.js";

/**
 * The row's ARIA. It is a named group and never a toolbar, which is the one
 * property worth pinning: the role decides what a keyboard user is promised.
 */
describe("toolbarAria", () => {
  it("names the row as a group", () => {
    expect(toolbarAria("Prikaz")).toEqual({ role: "group", "aria-label": "Prikaz" });
  });

  it("never claims the toolbar role, whose arrow-key behaviour this row does not have", () => {
    expect(toolbarAria("Prikaz").role).not.toBe("toolbar");
  });
});
