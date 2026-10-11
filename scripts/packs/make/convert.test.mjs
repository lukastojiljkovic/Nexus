import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { plainText, stripMarkup, toMarkdown } from "./lib/blocks.mjs";
import { htmlWords, itemsToBlocks, parseItems, sectionItems } from "./lib/html.mjs";
import { documentLines, ocrToBlocks } from "./lib/ocr.mjs";
import { collapse } from "./lib/text.mjs";
import { sectionSource, wikitextToBlocks, wikitextWords } from "./lib/wikitext.mjs";

/**
 * The three converters, against real source data.
 *
 * Each fixture in `fixtures/` is a few kilobytes cut from the file the build
 * reads, so what is asserted here is the source's own text and not a sample
 * somebody typed: the expected values are copied from the source's words, and
 * `fixtures/README.md` records where each one came from and under which licence.
 *
 * The first `it` of each block is a value, not a shape — an exact paragraph, an
 * exact figure caption, an exact Markdown document — because a converter that
 * returns a plausible-looking structure is exactly the defect this file is here
 * to catch.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const fixture = (name) => readFileSync(join(FIXTURES, name), "utf8");

/** The furniture the OCR sources are read with, copied from `sources.json`. */
const FURNITURE = [
  "/^Historic, archived document$/",
  "/^Do not assume content reflects current$/",
  "/^scientific knowledge, policies, or$/",
  "/^scientific knowledge, policies, or practices\\.$/",
  "/^practices\\.$/",
];

describe("a Project Gutenberg edition's HTML", () => {
  const html = fixture("carpentry-chapter-ii.html");

  it("reads the chapter's own words, in order, as the edition prints them", () => {
    const items = parseItems(html).items;
    expect(items[0]).toMatchObject({ kind: "heading", level: 2, text: "CHAPTER II" });
    expect(items[1]).toMatchObject({ kind: "heading", level: 4, text: "HOW TO GRIND AND SHARPEN TOOLS" });
    expect(items[2]).toEqual({
      kind: "paragraph",
      offset: 83,
      text:
        "Care of Tools.\u2014Dull tools indicate the character of the workman. In an experience of over forty years, " +
        "I have never known a good workman to keep poorly sharpened tools. While it is true that the capacity to " +
        "sharpen tools can be acquired only by practice, correct habits at the start will materially assist. In " +
        "doing this part of the artisan's work, it should be understood that there is a right as well as a wrong way.",
    });
  });

  it("keeps each drawing with the caption the edition prints for it", () => {
    const figures = parseItems(html).items.filter((item) => item.kind === "figure");
    expect(figures.map((item) => [item.file, item.caption])).toEqual([
      ["fig10.jpg", "Fig. 10. Fig.10a."],
      ["fig11.jpg", "Fig. 11."],
      ["fig12.jpg", "Fig. 12."],
      ["fig13.jpg", "Fig. 13. Rip-Saw"],
      ["fig14.jpg", "Fig. 14. cross-cut"],
      ["fig15.jpg", "Fig. 15."],
      ["fig16.jpg", "Fig. 16."],
    ]);
  });

  it("drops the digitisation's page numbers and nothing else", () => {
    // The two uncaptioned images are the two-up plates the edition lays out in a
    // table: their captions are kept as the table's own cells, their drawings are
    // not shipped, and `docs/packs/make.md` says so per source.
    expect(parseItems(html).dropped).toEqual({ pageNumbers: 8, uncaptionedImages: 2, comments: 0 });
    expect(htmlWords(html)).not.toContain("[Pg");
  });

  it("writes the outline a reader sees, and nothing else", () => {
    const markdown = toMarkdown(itemsToBlocks(parseItems(html).items));
    expect(markdown.startsWith("### CHAPTER II\n\n#### HOW TO GRIND AND SHARPEN TOOLS\n\nCare of Tools.\u2014Dull tools")).toBe(true);
    expect(markdown).toContain("![Fig. 13. Rip-Saw](images/fig13.jpg)");
    // `—` is one character of the source, and it reaches the page as itself.
    expect(markdown).toContain("Care of Tools.\u2014Dull tools");
  });

  it("cuts an article between two of the book's own headings", () => {
    const items = parseItems(html).items;
    const span = sectionItems(items, "CHAPTER II");
    expect(span.items[0]).toMatchObject({ kind: "heading", text: "CHAPTER II" });
    expect(span.items.every((item) => item.text !== "CHAPTER III")).toBe(true);
    expect(() => sectionItems(items, "CHAPTER XLII")).toThrow(/no heading/);
  });
});

describe("a scanned bulletin's OCR text", () => {
  const ocr = fixture("abcs-of-mending.txt");

  it("reads the bulletin's own lines as the paragraphs they were set in", () => {
    const blocks = ocrToBlocks(ocr, { furniture: FURNITURE });
    expect(blocks[0]).toEqual({ kind: "paragraph", text: "FARMERS' BULLETIN No. 1925 U.S. DEPARTMENT OF AGRICULTURE" });
    expect(blocks[2]).toEqual({ kind: "heading", level: 3, text: "ABCs of MENDING" });
    expect(blocks[5]).toEqual({
      kind: "paragraph",
      text:
        "A TINY HOLE can make a garment practically useless. A well-done mend can make it \"like new\" again. Such is " +
        "the magic of the art of Uiendipg ... ao art any homemaker can master easily.",
    });
    expect(blocks[7]).toEqual({ kind: "heading", level: 3, text: "Plan Your Mending" });
  });

  it("takes out the scanning library's own furniture, and counts it", () => {
    expect([...documentLines(ocr, FURNITURE).dropped]).toEqual([
      ["/^Historic, archived document$/", 1],
      ["/^Do not assume content reflects current$/", 1],
      ["/^scientific knowledge, policies, or$/", 1],
      ["/^scientific knowledge, policies, or practices\\.$/", 0],
      ["/^practices\\.$/", 1],
      ["page-number", 3],
    ]);
    expect(collapse(plainText(ocrToBlocks(ocr, { furniture: FURNITURE })))).not.toContain("Historic, archived document");
  });

  it("refuses a pattern that matches nothing, rather than trusting the list", () => {
    expect(() => documentLines("a page with no banner in it", ["/^Historic, archived document$/"])).not.toThrow();
    expect([...documentLines("a page", ["/^nope$/"]).dropped]).toEqual([["/^nope$/", 0]]);
    expect(() => documentLines("x", ["not a pattern"])).toThrow(/not \/pattern\/flags/);
  });
});

describe("a Wikibooks page's wikitext", () => {
  it("converts the inline forms a page uses and never invents a word", () => {
    const source = "A ''thin'' needle, a [[w:Thimble|thimble]], and '''two''' pins.\n";
    const { blocks } = wikitextToBlocks(source);
    expect(blocks).toEqual([{ kind: "paragraph", text: "A thin needle, a thimble, and two pins." }]);
    expect(toMarkdown(blocks)).toBe("A thin needle, a thimble, and two pins.\n");
    expect(wikitextWords(source)).toBe("A thin needle, a thimble, and two pins.");
  });

  it("writes a pipe table as the table the Reader draws", () => {
    const source = ["{|", "|-", "! Wick type || Wax type", "|-", "| CD wicks || Paraffin", "|}"].join("\n");
    const { blocks } = wikitextToBlocks(source);
    expect(blocks).toEqual([{ kind: "table", rows: [["Wick type", "Wax type"], ["CD wicks", "Paraffin"]] }]);
    expect(toMarkdown(blocks)).toBe("| Wick type | Wax type |\n| --- | --- |\n| CD wicks | Paraffin |\n");
  });

  it("reads a definition list as the words it holds", () => {
    const source = ";Tools: a needle\n:A thimble\n";
    expect(wikitextToBlocks(source).blocks).toEqual([{ kind: "paragraph", text: "Tools a needle A thimble" }]);
  });

  it("drops a template, records its name, and refuses a parser function", () => {
    const dropped = wikitextToBlocks("Text.\n\n{{BookCat}}\n");
    expect(dropped.dropped.templates).toEqual(["BookCat"]);
    expect(dropped.blocks).toEqual([{ kind: "paragraph", text: "Text." }]);
    // A parser function's VALUE is not in the wikitext, so dropping it would be
    // losing text: the converter refuses the page instead.
    expect(() => wikitextToBlocks("Melt at {{#expr: 1+1}} degrees.\n")).toThrow(/parser function/);
    expect(() => wikitextToBlocks("As [[File:Seam.png|thumb|A plain seam]] shows.\n")).toThrow(/file link/);
  });

  it("survives a self-closing citation instead of swallowing the page", () => {
    const source = "A claim.<ref name=\"a\"/> And the page goes on.\n";
    expect(wikitextToBlocks(source).blocks).toEqual([
      { kind: "paragraph", text: "A claim. And the page goes on." },
    ]);
  });

  it("reads the real page: headings, a table, and the template it dropped", () => {
    const wikitext = fixture("candlemaking.wikitext");
    const { blocks, dropped } = wikitextToBlocks(wikitext);
    expect(blocks[0]).toEqual({ kind: "heading", level: 3, text: "1. Make at least five of the following" });
    expect(blocks[1]).toEqual({ kind: "heading", level: 4, text: "a. Free-form sand candle" });
    expect(blocks.filter((block) => block.kind === "table")).toEqual([]);
    expect(dropped.templates).toEqual(["honor_header"]);
    expect(wikitextWords(wikitext)).toContain("Break wax up in chunks and place in a cheese tin");
  });

  it("cuts one section of a page by the heading the page prints", () => {
    const source = "== One ==\nThe first.\n\n== Two ==\nThe second.\n";
    expect(sectionSource(source, "Two")).toBe("== Two ==\nThe second.\n");
    expect(sectionSource(source)).toBe(source);
    expect(() => sectionSource(source, "Three")).toThrow(/no section/);
  });
});

describe("the Markdown writer and the reader that undoes it", () => {
  it("round-trips the marks a source's own text contains", () => {
    const text = "2. Slip-stitch [x] the *thing* and press; see <it> and a | b.";
    const blocks = [{ kind: "paragraph", text }];
    const markdown = toMarkdown(blocks);
    expect(markdown).not.toBe(text);
    expect(stripMarkup(markdown)).toBe(text);
    expect(plainText(blocks)).toBe(text);
  });

  it("keeps a paragraph that opens with a number from becoming a list", () => {
    // The Reader's parser reads `2. ` at the start of a line as an ordered list
    // item, which would drop the number from the sentence it belongs to.
    const markdown = toMarkdown([{ kind: "paragraph", text: "2. Slip-stitch the shield." }]);
    expect(markdown).toBe("2\\. Slip-stitch the shield.\n");
    expect(stripMarkup(markdown)).toBe("2. Slip-stitch the shield.");
  });
});
