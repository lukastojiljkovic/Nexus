import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { mergeFigures, toBlocks } from "./article.mjs";
import { plainText, stripMarkup, toMarkdown } from "./blocks.mjs";
import { articleHtml, articleText, htmlToBlocks } from "./html-source.mjs";
import { collapse, normalisePage } from "./normalise.mjs";
import { captionFor, isFigureImage } from "./pdf-source.mjs";

/**
 * The converter, tested on the fixtures: two real pages of the two Army PDFs
 * and one real page of FoodSafety.gov, so the awkward cases â€” a figure whose
 * caption is printed under it, an entry whose illustration is printed above it,
 * a table with a header row and a cell that spans two rows â€” are the source's
 * own awkward cases and not invented ones.
 *
 * The fidelity test this proves is the pack's central promise, and it is proved
 * twice: positively, on the fixtures; and negatively, by showing that a changed
 * word is refused.
 */

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

function pdfFixture(name, vocabulary) {
  const fixture = JSON.parse(readFileSync(`${FIXTURES}/${name}.json`, "utf8"));
  const page = normalisePage(
    { index: fixture.page, width: fixture.width, height: fixture.height, items: fixture.items },
    { vocabulary },
  );
  const figures = fixture.images
    .filter((image) => isFigureImage({ box: image.box }, { width: fixture.width, height: fixture.height }))
    .map((image, index) => ({
      page: fixture.page,
      index,
      box: image.box,
      file: `${fixture.source}-p${String(fixture.page)}-${String(index)}.png`,
      caption: captionFor({ box: image.box }, page.lines.filter((line) => line.page === fixture.page)),
    }));
  return { fixture, lines: page.lines, figures };
}

function fidelity(lines, figures, title) {
  const blocks = toBlocks({ lines, figures, title });
  const markdown = toMarkdown(blocks);
  return {
    blocks,
    markdown,
    fromMarkdown: collapse(stripMarkup(markdown)),
    fromBlocks: collapse(plainText(blocks)),
    fromSource: collapse(mergeFigures(lines, figures).map((item) => (item.kind === "figure" ? item.figure.caption : item.line.text)).join(" ")),
  };
}

describe("ATP 3-50.21, page 2-6", () => {
  const { lines, figures } = pdfFixture("atp-3-50-21-p24", ["ATP 3-50.21", "6HSWHPEHU", "2018"]);
  const result = fidelity(lines, figures, "Figure 2-1. Jaw Thrust Method");

  it("finds the page's one figure-sized image and its caption", () => {
    // The page draws eight images: seven change bars in the margin (21.5 by
    // 8.6 points) and the figure (283 by 145).
    expect(figures).toHaveLength(1);
    expect(figures[0].box.width).toBeCloseTo(283, 0);
    expect(figures[0].box.height).toBeCloseTo(145.4, 0);
    expect(figures[0].caption).toBe("Figure 2-1. Jaw Thrust Method");
  });

  it("writes the caption once, as the image's alt text, not twice", () => {
    expect(result.markdown).toContain("![Figure 2-1. Jaw Thrust Method](images/atp-3-50-21-p24-0.png)");
    // A caption the source prints under the figure is the same words as the
    // image's alt text, and an article that carried both would show it twice.
    expect(result.markdown.match(/Figure 2-1\. Jaw Thrust Method/g)).toHaveLength(1);
  });

  it("writes the page's bullets as a list and rejoins wrapped paragraphs", () => {
    expect(result.markdown).toContain("- Look for the chest to rise and fall.\n- Listen for escaping air during exhalation.\n- Feel for flow of air on your cheek.");
    expect(result.markdown).toContain(
      "With the casualty's airway open, pinch their nose closed with your thumb and forefinger and blow two complete breaths into their lungs.",
    );
    // A bullet whose text wrapped keeps its continuation on the same item.
    expect(result.markdown).toContain(
      "- Position the tube of the NPA so that the bevel (pointed end) of the NPA faces toward the septum (the partition inside the nose that separates the nostrils).",
    );
    // An all-caps line set a fifth larger than the body is a heading.
    expect(result.markdown).toContain("\n### DIRECT PRESSURE\n");
  });

  it("holds the fidelity the brief asks for", () => {
    expect(result.fromMarkdown).toBe(result.fromBlocks);
    expect(result.fromBlocks).toBe(result.fromSource);
  });

  it("refuses a Markdown that has lost a word", () => {
    const tampered = result.markdown.replace("pinch their nose closed", "pinch their nose");
    expect(collapse(stripMarkup(tampered))).not.toBe(result.fromBlocks);
  });
});

describe("FM 21-76, page B-8", () => {
  const { lines, figures } = pdfFixture("fm-21-76-p372", ["FM 21-76"]);
  const result = fidelity(lines, figures, "Asparagus");

  it("finds the entry's illustration and gives it the caption the source prints", () => {
    // The page draws two images: a decorative rule (324 by 50 points) and the
    // illustration (330 by 249). The 1992 reprint numbers no figure, so the
    // illustration keeps no caption rather than one this pack wrote.
    expect(figures).toHaveLength(1);
    expect(figures[0].box.width).toBeCloseTo(329.8, 0);
    expect(figures[0].caption).toBe("");
    expect(result.markdown).toContain("![](images/fm-21-76-p372-0.png)");
  });

  it("keeps the entry's own fields, its size rule and its prose", () => {
    expect(result.markdown).toContain("## Asparagus");
    expect(result.markdown).toContain("Asparagus officinalis");
    expect(result.markdown).toContain(
      "Description: The spring growth of this plant resembles a cluster of green fingers.",
    );
    expect(result.markdown).toContain("Edible Parts: Eat the young stems before leaves form.");
  });

  it("holds the fidelity", () => {
    expect(result.fromMarkdown).toBe(result.fromBlocks);
    expect(result.fromBlocks).toBe(result.fromSource);
  });
});

describe("FoodSafety.gov, safe minimum internal temperatures", () => {
  const fragment = readFileSync(`${FIXTURES}/foodsafety-temperatures.html`, "utf8");
  const blocks = htmlToBlocks(fragment);
  const text = collapse(articleText(fragment));
  const table = blocks.find((block) => block.kind === "table");

  it("is the page's article element, and its text is exactly the page's text", () => {
    expect(articleHtml(fragment)).toBe(fragment.trimEnd());
    expect(collapse(plainText(blocks))).toBe(text);
    // The words after the table are the ones the first version of the tokeniser
    // dropped: they follow a closing `</table>`, and the cell it was still
    // holding swallowed them.
    expect(text).toContain("Date Last Reviewed November 21, 2024");
    expect(collapse(plainText(blocks))).toContain("Date Last Reviewed November 21, 2024");
  });

  it("converts the chart's table with its header row and every reading", () => {
    expect(table.rows).toHaveLength(17);
    expect(table.rows[0]).toEqual(["Food", "Type", "Internal Temperature (\u00B0F/\u00B0C)"]);
    // Read off the page (USDA FSIS, page reviewed 21 November 2024): a whole
    // cut's 145 F / 63 C, ground meat's 160 F / 71 C, poultry and casseroles
    // 165 F / 74 C.
    expect(table.rows.flat().join(" ")).toContain("145\u00B0F (63\u00B0C)");
    expect(table.rows.flat().join(" ")).toContain("160\u00B0F (71\u00B0C)");
    expect(table.rows.flat().join(" ")).toContain("165\u00B0F (74\u00B0C)");
    expect(table.rows.at(-1)).toEqual(["Clams, oysters, mussels", "Cook until shells open during cooking"]);
  });

  it("writes the table as CommonMark and reads it back as the same words", () => {
    const markdown = toMarkdown(blocks);
    expect(markdown).toContain("| Food | Type | Internal Temperature (\u00B0F/\u00B0C) |");
    expect(markdown).toContain("| --- | --- | --- |");
    expect(collapse(stripMarkup(markdown))).toBe(collapse(plainText(blocks)));
  });
});

describe("the writer's escapes", () => {
  it("escapes what CommonMark would read as markup and nothing else", () => {
    const blocks = [
      { kind: "paragraph", text: "- day depends on the latitude." },
      { kind: "paragraph", text: "1. Tundra 2. Coniferous forest" },
      { kind: "paragraph", text: "hurricane_facts_570,00.html and a <tag>" },
    ];
    const markdown = toMarkdown(blocks);
    expect(markdown).toBe(
      "\\- day depends on the latitude.\n\n1\\. Tundra 2. Coniferous forest\n\nhurricane\\_facts\\_570,00.html and a \\<tag\\>\n",
    );
    // The escapes are the writer's, not the source's: reading it back gives the
    // source's own words.
    expect(collapse(stripMarkup(markdown))).toBe(collapse(plainText(blocks)));
  });
});
