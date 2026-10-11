import { describe, expect, it } from "vitest";

import { toastAnnouncement } from "./Toast.js";

/**
 * A toast's live region is the whole of its screen-reader behaviour: there is
 * no control to focus and nothing to tab into, so what matters is whether the
 * news waits for a pause or interrupts, and whether the state has a second
 * channel besides the ink.
 */
describe("toastAnnouncement", () => {
  it("announces an accepted act politely, with a shape beside the ink", () => {
    expect(toastAnnouncement("info")).toEqual({
      role: "status",
      "aria-live": "polite",
      icon: "check",
    });
  });

  it("interrupts for a failure, and says so with the error glyph", () => {
    // "The save did not land" is worth cutting across a sentence: the reader
    // believes their data is safe, and every second they keep believing it is
    // a second they are not retrying.
    expect(toastAnnouncement("error")).toEqual({
      role: "alert",
      "aria-live": "assertive",
      icon: "error",
    });
  });

  it("keeps the two kinds apart in BOTH channels, never in colour alone", () => {
    expect(toastAnnouncement("info").role).not.toBe(toastAnnouncement("error").role);
    expect(toastAnnouncement("info").icon).not.toBe(toastAnnouncement("error").icon);
  });
});
