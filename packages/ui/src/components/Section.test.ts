import { describe, expect, it } from "vitest";

import { sectionCaptionTag } from "./Section.js";

/**
 * Which element a section's caption is. The rule that matters is the first
 * case: a caption without a level is not a heading, so it does not appear in
 * the outline a screen reader builds from the page.
 */
describe("sectionCaptionTag", () => {
  it("draws a caption without a level as a paragraph, outside the outline", () => {
    expect(sectionCaptionTag(undefined)).toBe("p");
  });

  it("maps each allowed level to the heading of the same number", () => {
    expect(sectionCaptionTag(2)).toBe("h2");
    expect(sectionCaptionTag(3)).toBe("h3");
    expect(sectionCaptionTag(4)).toBe("h4");
  });
});
