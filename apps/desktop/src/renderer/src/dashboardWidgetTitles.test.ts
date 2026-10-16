import { describe, expect, it } from "vitest";
import { BUILTIN_WIDGET_TITLES, DASHBOARD_DEFAULT_BOARD_NAME } from "../../shared/dashboardWidgetTitles.js";
import { createModuleRegistry } from "../../shared/modules.js";
import { lookupString } from "./dashboardLayout.js";
import { en } from "./strings.en.js";
import { sr } from "./strings.sr.js";

/**
 * The assistant names a built-in widget with the copy in `dashboardWidgetTitles.ts`,
 * because main cannot read the renderer's strings. This pins that copy to the strings
 * the card itself draws, so the two cannot drift apart.
 */

describe("the built-in widget titles", () => {
  it("match the renderer's copy, in both locales", () => {
    for (const [key, pair] of Object.entries(BUILTIN_WIDGET_TITLES)) {
      expect(lookupString(sr, key), key).toBe(pair.sr);
      expect(lookupString(en, key), key).toBe(pair.en);
    }
  });

  it("name the default board as the page does", () => {
    expect(DASHBOARD_DEFAULT_BOARD_NAME.sr).toBe(sr.dashboard.sets.defaultName);
    expect(DASHBOARD_DEFAULT_BOARD_NAME.en).toBe(en.dashboard.sets.defaultName);
  });

  it("cover every built-in widget the registry publishes with a string title", () => {
    for (const manifest of createModuleRegistry().all()) {
      for (const widget of manifest.widgets ?? []) {
        if (typeof widget.title === "string") {
          expect(BUILTIN_WIDGET_TITLES[widget.title], widget.title).toBeDefined();
        }
      }
    }
  });
});
