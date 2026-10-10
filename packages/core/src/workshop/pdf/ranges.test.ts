import { describe, expect, it } from "vitest";
import {
  PAGE_RANGE_MAX_LENGTH,
  PAGE_RANGE_MAX_PAGES,
  parsePageRanges,
  type PageRangeRefusal,
} from "./ranges.js";

/**
 * The page-selection grammar, pinned value by value.
 *
 * Every expectation below is the value the grammar in `ranges.ts` states — the
 * expansion is written out rather than described, because "1-3,5,8-" and
 * "[1,2,3,5,8,9,10]" are the two halves of the same sentence and only one of
 * them is a fact about the code.
 */

/** The refusal code of a result the test asserts will not parse. */
function refusal(text: string, pageCount: number): PageRangeRefusal {
  const result = parsePageRanges(text, pageCount);
  if (result.ok) throw new Error(`"${text}" parsed as ${result.pages.join(",")}`);
  return result.reason;
}

/** The pages of a result the test asserts will parse. */
function pages(text: string, pageCount: number): readonly number[] {
  const result = parsePageRanges(text, pageCount);
  if (!result.ok) throw new Error(`"${text}" was refused as ${result.reason}`);
  return result.pages;
}

describe("parsePageRanges", () => {
  it("expands a range, a single page and an open-ended range", () => {
    expect(pages("1-3,5,8-", 10)).toEqual([1, 2, 3, 5, 8, 9, 10]);
  });

  it("reads a single page as a one-page range", () => {
    expect(pages("7", 10)).toEqual([7]);
    expect(pages("8-", 8)).toEqual([8]);
  });

  it("keeps the order as written, so an expression can reorder a document", () => {
    expect(pages("3,1", 5)).toEqual([3, 1]);
    expect(pages("2,1-2", 5)).toEqual([2, 1]);
  });

  it("ignores a page named twice, first occurrence first", () => {
    expect(pages("3,1,3", 5)).toEqual([3, 1]);
    expect(pages("1-2,2-3", 5)).toEqual([1, 2, 3]);
  });

  it("tolerates whitespace around pieces, bounds and commas", () => {
    expect(pages(" 2 , 4 ", 5)).toEqual([2, 4]);
    expect(pages("1 - 3", 5)).toEqual([1, 2, 3]);
  });

  it("refuses an empty expression", () => {
    expect(refusal("", 5)).toBe("empty");
    expect(refusal("   ", 5)).toBe("empty");
  });

  it("refuses an empty piece, which is what a trailing or doubled comma is", () => {
    expect(refusal(",", 5)).toBe("syntax");
    expect(refusal("1,,2", 5)).toBe("syntax");
    expect(refusal("1,", 5)).toBe("syntax");
  });

  it("refuses a piece that is not digits, a dash and digits", () => {
    expect(refusal("abc", 5)).toBe("syntax");
    expect(refusal("1-a", 5)).toBe("syntax");
    expect(refusal("-3", 5)).toBe("syntax");
    expect(refusal("1--3", 5)).toBe("syntax");
    expect(refusal("1.5", 5)).toBe("syntax");
    expect(refusal("+1", 5)).toBe("syntax");
  });

  it("refuses a range written backwards", () => {
    expect(refusal("3-1", 5)).toBe("reversed");
    expect(refusal("4-2,1", 5)).toBe("reversed");
  });

  it("refuses a page outside the document, at either end of a piece", () => {
    expect(refusal("0", 5)).toBe("out-of-range");
    expect(refusal("1-0", 5)).toBe("out-of-range");
    expect(refusal("6", 5)).toBe("out-of-range");
    expect(refusal("4-6", 5)).toBe("out-of-range");
    expect(refusal("6-", 5)).toBe("out-of-range");
    expect(refusal("1", 0)).toBe("out-of-range");
  });

  it("refuses an expression longer than the cap", () => {
    expect(refusal("1".repeat(PAGE_RANGE_MAX_LENGTH + 1), 5)).toBe("too-long");
    // The cap itself is accepted: the boundary is a length, not an off-by-one.
    const atCap = `${"1,".repeat(149)}1`;
    expect(atCap.length).toBe(PAGE_RANGE_MAX_LENGTH - 1);
    expect(pages(atCap, 5)).toEqual([1]);
  });

  it("refuses an expansion beyond the page cap", () => {
    expect(refusal("1-", PAGE_RANGE_MAX_PAGES + 1)).toBe("too-many");
    expect(pages("1-", PAGE_RANGE_MAX_PAGES)).toHaveLength(PAGE_RANGE_MAX_PAGES);
  });
});
