import { describe, expect, it } from "vitest";

import { noticeAnnouncement } from "./Notice.js";

/**
 * What one inline notice says to a screen reader, and what it says besides its
 * colour.
 *
 * Two properties, and both are the reason the component exists rather than the
 * ink: a refusal the user just caused interrupts, a state they are looking at
 * waits for a pause; and every kind carries a GLYPH, so a reader who cannot
 * tell the danger ink from the muted one still gets the difference.
 */
describe("noticeAnnouncement", () => {
  it("interrupts for a failure the user just caused", () => {
    expect(noticeAnnouncement("danger")).toEqual({
      role: "alert",
      "aria-live": "assertive",
      icon: "error",
    });
  });

  it("waits for a pause for a warning", () => {
    expect(noticeAnnouncement("warning")).toEqual({
      role: "status",
      "aria-live": "polite",
      icon: "warning",
    });
  });

  it("waits for a pause for information", () => {
    expect(noticeAnnouncement("info")).toEqual({
      role: "status",
      "aria-live": "polite",
      icon: "info",
    });
  });

  it("keeps the three kinds apart in BOTH channels, never in colour alone", () => {
    const kinds = [noticeAnnouncement("info"), noticeAnnouncement("warning"), noticeAnnouncement("danger")];
    expect(new Set(kinds.map((kind) => kind.icon)).size).toBe(3);
    expect(kinds.filter((kind) => kind.role === "alert")).toHaveLength(1);
  });
});
