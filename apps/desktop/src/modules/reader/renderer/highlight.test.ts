import { describe, expect, it } from "vitest";

import { highlightSegments } from "./highlight.js";

/**
 * The `<mark>` segments a search hit is painted from.
 *
 * The ranges come from `buildSearchSnippet` (core) and index into the string
 * they are handed; the cases below are the three shapes that matter: a match in
 * the middle, a match at either end, and a range that is wrong (which must cost a
 * highlight rather than a broken page).
 */
describe("highlightSegments", () => {
  it("splits a string into the matched part and the parts around it", () => {
    // "Hladi opekotinu vodom": `vodom` starts at index 16.
    expect(highlightSegments("Hladi opekotinu vodom", [[16, 21]])).toEqual([
      { text: "Hladi opekotinu ", match: false },
      { text: "vodom", match: true },
    ]);
  });

  it("answers one unmatched segment when nothing matched", () => {
    expect(highlightSegments("Krvarenje", [])).toEqual([{ text: "Krvarenje", match: false }]);
  });

  it("handles a match at the start and at the end", () => {
    expect(highlightSegments("Voda i elektroliti", [[0, 4]])).toEqual([
      { text: "Voda", match: true },
      { text: " i elektroliti", match: false },
    ]);
    expect(highlightSegments("pij vodu", [[4, 8]])).toEqual([
      { text: "pij ", match: false },
      { text: "vodu", match: true },
    ]);
  });

  it("takes several ranges, in order", () => {
    expect(highlightSegments("voda i voda", [[0, 4], [7, 11]])).toEqual([
      { text: "voda", match: true },
      { text: " i ", match: false },
      { text: "voda", match: true },
    ]);
  });

  it("skips a range that is out of bounds, inverted or overlapping, rather than trusting it", () => {
    for (const ranges of [
      [[10, 20]],
      [[5, 2]],
      [[0, 0]],
      [[3, 6], [4, 8]],
    ] as const) {
      const segments = highlightSegments("kratko", [...ranges]);
      expect(segments.every((segment) => segment.text.length > 0), JSON.stringify(ranges)).toBe(true);
      // Whatever it did with the bad range, the text is still the whole string.
      expect(segments.map((segment) => segment.text).join(""), JSON.stringify(ranges)).toContain(
        "kratko",
      );
    }
  });
});
