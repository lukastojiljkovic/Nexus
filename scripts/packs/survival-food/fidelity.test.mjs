import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { blocksToMarkdown, blocksToText } from "./lib/blocks.mjs";
import { parseHtml, selectMain, textContent, toMarkdown } from "./lib/html.mjs";
import {
  documentFindings,
  finishLines,
  pageBlocks,
  tableFindings,
  toLines,
} from "./lib/pdf.mjs";
import { normalise, stripMarkup } from "./lib/text.mjs";

/**
 * The pack's central promise, on the fixtures: what the article says is what the
 * source says.
 *
 * THREE CHECKS, and each catches something the others cannot:
 *
 *  1. The article's text, with its markup stripped, equals the source's text —
 *     for the guide, the block list the reader built; for the page, the page's
 *     own DOM text. This is the promise itself.
 *  2. Every TABLE CELL holds the glyph runs that were printed in it, checked one
 *     cell at a time. Check 1 cannot see a number that moved to the neighbouring
 *     column, because both sides would move together.
 *  3. Every glyph run of the page is in exactly one block, checked one run at a
 *     time. Check 1 cannot see a sentence that was dropped AND a sentence that
 *     was duplicated in a way that left the total the same.
 *
 * The build runs all three over the real sources before it writes a byte of
 * pack; these tests run them over the fixtures the repository holds.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

describe("the USDA guide's page 6-15", () => {
  const fixture = JSON.parse(
    readFileSync(join(HERE, "fixtures", "usda-guide6-p15.items.json"), "utf8"),
  );
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
  };
  const blocks = pageBlocks(page, FURNITURE, 11.5);
  const tables = blocks.filter((block) => block.kind === "table");

  it("emits the page's own text, and nothing else", () => {
    expect(normalise(stripMarkup(blocksToMarkdown(blocks, { levelOffset: 0 })))).toBe(
      normalise(blocksToText(blocks)),
    );
  });

  it("checks every table cell against the glyph runs printed in it", () => {
    let cells = 0;
    for (const table of tables) {
      for (const [rowIndex, row] of table.cells.entries()) {
        for (const [columnIndex, cell] of row.entries()) {
          cells += 1;
          // The cell's text is its runs joined in reading order, and nothing more:
          // the same rule the reader used, restated here so that a change to the
          // reader that moved a number would fail this rather than agree with it.
          const runs = [...cell.items].sort((left, right) =>
            left.y === right.y ? left.x - right.x : right.y - left.y,
          );
          expect(
            normalise(cell.text),
            `table ${String(tables.indexOf(table) + 1)} cell ${String(rowIndex)}.${String(columnIndex)}`,
          ).toBe(normalise(runs.map((item) => item.text).join(" ")));
        }
      }
    }
    // A census, so that "every cell passed" cannot be a run over no cells. The
    // count is arithmetic rather than a measurement: two tables, each with a
    // header row and one data row, each row padded to the five columns the page
    // prints — 2 × 2 × 5 = 20.
    expect(cells).toBe(20);
    expect(tables).toHaveLength(2);
  });

  it("checks that every table cell's runs came from the page and no run was dropped", () => {
    expect(tables.flatMap((table) => tableFindings(table))).toEqual([]);
    for (const table of tables) {
      expect(table.sourceItems.length).toBeGreaterThan(0);
    }
  });

  it("accounts for every glyph run of the page exactly once", () => {
    expect(documentFindings([page], FURNITURE, blocks)).toEqual([]);
  });
});

describe("the FSIS power-outage page", () => {
  const root = parseHtml(readFileSync(join(HERE, "fixtures", "fsis-power-outage.html"), "utf8"));
  const main = selectMain(root);
  const markdown = toMarkdown(main, { url: "https://www.fsis.usda.gov/x" });

  it("emits the page's own text, and nothing else", () => {
    expect(normalise(stripMarkup(markdown))).toBe(normalise(textContent(main)));
  });

  it("keeps the quantity in a list item whole", () => {
    // The page wraps this item across two lines of HTML source; the check above
    // is exact, so a missing or doubled space would have failed it already. This
    // one names the sentence, because that is what a reader would miss.
    expect(normalise(stripMarkup(markdown))).toContain(
      "Make sure the refrigerator temperature is at 40 °F or below and the freezer is at 0°F or below.",
    );
  });
});
