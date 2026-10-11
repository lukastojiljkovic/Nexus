import { describe, expect, it } from "vitest";

import { entryLabel, formatBytes, localeTag, progressPercent } from "./zimView.js";

/**
 * The page's pure half.
 *
 * `formatBytes` is asserted with EXACT strings in both languages, because the
 * thing being pinned is that the number goes through `Intl`: Serbian writes a
 * decimal comma where English writes a point, and a hand-rolled `toFixed(1)`
 * would make the two locales disagree about the same file.
 */
describe("the wiki page's formatters", () => {
  it("writes a byte count in the unit a person reads it in", () => {
    expect(formatBytes(3_624_747, "sr-Latn")).toBe("3,5 MB");
    expect(formatBytes(3_624_747, "en")).toBe("3.5 MB");
    expect(formatBytes(2_029_773_550, "sr-Latn")).toBe("1,9 GB");
    expect(formatBytes(152_865, "en")).toBe("149 KB");
    expect(formatBytes(4096, "en")).toBe("4 KB");
    expect(formatBytes(900, "sr-Latn")).toBe("900 B");
    expect(formatBytes(0, "en")).toBe("0 B");
  });

  it("caps a download's completion at both ends", () => {
    expect(progressPercent(0, 100)).toBe(0);
    expect(progressPercent(50, 100)).toBe(50);
    expect(progressPercent(99, 100)).toBe(99);
    expect(progressPercent(150, 100)).toBe(100);
    // A total a feed got wrong must not divide by zero or run past the bar.
    expect(progressPercent(10, 0)).toBe(0);
    expect(progressPercent(10, Number.NaN)).toBe(0);
  });

  it("names an entry by its title, falling back to its path", () => {
    expect(entryLabel("Kafa", "A/Kafa.html")).toBe("Kafa");
    expect(entryLabel("", "I/m/pix.png")).toBe("I/m/pix.png");
  });

  it("gives Intl the Latin-script tag for Serbian", () => {
    expect(localeTag("sr")).toBe("sr-Latn");
    expect(localeTag("en")).toBe("en");
  });
});
