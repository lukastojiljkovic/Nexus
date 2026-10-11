import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  documentFindings,
  finishLines,
  pageBlocks,
  pageIsAmbiguous,
  tableFindings,
  tableGrid,
  toLines,
} from "./lib/pdf.mjs";

/**
 * The USDA guide reader, on one real page.
 *
 * The fixture is Guide 6's page 6-15 exactly as pdfjs reads it: every glyph run
 * with where it was printed. It is a page of the guide with three process
 * tables, a recipe's prose and the guide's layout marks, which is the smallest
 * thing that exercises the reader's decisions.
 *
 * The expected cell values below are what the guide PRINTS on that page. The
 * page was also rendered to an image and read by eye while this was written,
 * because a table this reader gets wrong is a processing time in the wrong
 * column, and a wrong processing time is the one error in this pack that could
 * hurt somebody.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(HERE, "fixtures", "usda-guide6-p15.items.json"), "utf8"),
);
const BODY_SIZE = 11.5;

/**
 * The page's furniture, named rather than measured.
 *
 * `findFurniture` decides a running head by counting it across a whole
 * document, and a one-page fixture cannot do that: it needs half the pages. The
 * two strings here are the ones the real run finds — the side tab the guide
 * prints in the right edge of every page, and the page's own number stamp.
 */
const FURNITURE = {
  heads: new Set(["Fermented Foods and Pickled Vegetables", "6"]),
  isStamp: (text) => /^\d{1,3}-\d{1,3}$/.test(text),
  isFurniture(line) {
    const key = line.text.replace(/\s+/g, " ").trim();
    return key === "" || FURNITURE.isStamp(key) || FURNITURE.heads.has(key);
  },
};

const page = {
  number: fixture.page,
  lines: finishLines(toLines(fixture.items)),
  pageHeight: fixture.pageHeight,
  pageWidth: fixture.pageWidth,
  figures: [],
};
const blocks = pageBlocks(page, FURNITURE, BODY_SIZE);
const tables = blocks.filter((block) => block.kind === "table");


describe("the guide's page 6-15", () => {
  it("reads its process tables as tables, in the order they are printed", () => {
    expect(tables).toHaveLength(2);
    expect(tableGrid(tables[0])).toEqual([
      ["Style of Pack", "Jar Size", "0– 1,000 ft", "1,001– 6,000 ft", "Above 6,000 ft"],
      ["Raw", "Pints", "5 min", "10", "15"],
    ]);
    expect(tableGrid(tables[1])).toEqual([
      ["Style of Pack", "Jar Size", "0– 1,000 ft", "1,001– 6,000 ft", "Above 6,000 ft"],
      ["Hot", "Half-pints", "15 min", "20", "25"],
    ]);
  });

  it("keeps the table's own caption and spanning header as prose, not as cells", () => {
    // CommonMark has no spanning cell. Folding this sentence into a cell would
    // put words where the guide did not, so it is the paragraph above the table.
    const captions = blocks
      .filter((block) => block.kind === "paragraph")
      .map((block) => block.text);
    expect(captions).toContain("Recommended process time for Pickled Three-Bean Salad in a boiling-water canner");
    expect(captions).toContain("Process Time at Altitudes of");
  });

  it("reads the recipe title as a heading and the rest as prose", () => {
    expect(blocks.some((block) => block.kind === "heading" && block.text === "PICKLED BEETS")).toBe(true);
    expect(
      blocks.some((block) =>
        block.text?.startsWith("Procedure: Trim off beet tops, leaving 1 inch of stem"),
      ),
    ).toBe(true);
  });

  it("accounts for every glyph run of every table, in the cell it was printed in", () => {
    expect(tables.flatMap((table) => tableFindings(table))).toEqual([]);
    expect(tableFindings(tables[0])).toEqual([]);
  });

  it("puts every glyph run of the page in exactly one block", () => {
    const pages = [page];
    expect(documentFindings(pages, FURNITURE, pageBlocks(page, FURNITURE, BODY_SIZE))).toEqual([]);
  });

  it("reads the page as a table page rather than as a page it cannot trust", () => {
    expect(pageIsAmbiguous(page, BODY_SIZE)).toBe(false);
  });
});

describe("the reader's two refusals", () => {
  it("refuses a page where a table line shares the page with prose inside the table's own band", () => {
    // Guide 1's reconstructed pages: the guide's author re-flowed the process
    // tables into the same area as the prose about them. A table header sitting
    // between two lines of a table is the shape; no honest page has it.
    const lines = [
      { y: 400, x: 100, height: 8.7, text: "StyleJar", items: [item("Style", 100, 400), item("Jar", 200, 400)] },
      { y: 380, x: 63, height: 13, text: "Example B: Dial-gauge Pressure Canner", items: [item("Example B", 63, 380, 13)] },
      { y: 370, x: 100, height: 8.7, text: "HotPints", items: [item("Hot", 100, 370), item("Pints", 200, 370)] },
    ];
    expect(pageIsAmbiguous({ lines }, 11.5)).toBe(true);
  });

  it("refuses a page whose text layer holds one table's caption twice", () => {
    // Guide 6's page 6-16 holds each of its tables twice, thirty points apart:
    // the printed page shows one of them. Which copy is the printed one is not
    // recoverable from the text layer, so the page is left unstructured.
    const caption = "Recommended process time for Pickled Beets in a boiling-water canner";
    const lines = [
      { y: 700, x: 107, height: 8.7, text: caption, items: [item(caption, 107, 700)] },
      { y: 520, x: 107, height: 8.7, text: caption, items: [item(caption, 107, 520)] },
    ];
    expect(pageIsAmbiguous({ lines }, 11.5)).toBe(true);
  });

  it("trusts a page whose two tables carry their own captions", () => {
    const lines = [
      {
        y: 700,
        x: 107,
        height: 8.7,
        text: "Recommended process time for Asparagus in a",
        items: [item("Recommended process time for Asparagus in a", 107, 700)],
      },
      { y: 690, x: 107, height: 8.7, text: "dial-gauge pressure canner", items: [item("dial-gauge pressure canner", 107, 690)] },
      {
        y: 500,
        x: 107,
        height: 8.7,
        text: "Recommended process time for Asparagus in a",
        items: [item("Recommended process time for Asparagus in a", 107, 500)],
      },
      { y: 490, x: 107, height: 8.7, text: "weighted-gauge pressure canner", items: [item("weighted-gauge pressure canner", 107, 490)] },
    ];
    expect(pageIsAmbiguous({ lines }, 11.5)).toBe(false);
  });
});

/** A glyph run, with the identity the reader gives it. */
function item(text, x, y, height = 8.7, width = text.length * 4) {
  return { id: `${String(x)}:${String(y)}:${text}`, text, x, y, width, height, eol: false };
}
