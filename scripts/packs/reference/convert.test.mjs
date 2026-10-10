// The converter, tested on the three fixtures and on the cases the fixtures
// cannot show.
//
// THE FIXTURES ARE REAL BYTES. Each one is a slice of the document its pack
// ships — a UN page, an Official Journal file, a gazette act's text layer — cut
// by `build.mjs --fixtures` from the fetched source, so a converter that stops
// working on a real page stops this file rather than a build months later. The
// expected values below were read off the fixture by hand, not recorded from a
// run: a test that asserts whatever the code did is a test of nothing.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseHtml, findAll, findFirst, classList, textContent } from "./lib/html.mjs";
import {
  blocksFromElement,
  blocksFromLines,
  blocksToText,
  convertDocument,
  normalizeText,
  slug,
  stripMarkdown,
  toMarkdown,
} from "./lib/convert.mjs";
import { PACKS } from "./sources.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => readFileSync(join(FIXTURES, name));
const documentOf = (id) => PACKS["reference-en"].documents.find((entry) => entry.id === id);

describe("the HTML reader", () => {
  it("decodes the entities the sources use, and leaves an unknown one as written", () => {
    const tree = parseHtml("<p>a &amp; b &#8212; c &nbsp;d &notanentity;</p>");
    // `textContent` separates block-level neighbours with a space, so the value
    // is compared after the same normalisation every consumer applies.
    expect(normalizeText(textContent(tree))).toBe("a & b \u2014 c d &notanentity;");
  });

  it("closes a paragraph when the next block starts, the way a browser does", () => {
    const tree = parseHtml("<div><p>first<p>second<ul><li>one<li>two</ul></div>");
    const paragraphs = findAll(tree, { tag: "p" }).map((node) => textContent(node));
    expect(paragraphs).toEqual(["first", "second"]);
    expect(findAll(tree, { tag: "li" }).map((node) => textContent(node))).toEqual(["one", "two"]);
  });

  it("drops a comment, a doctype and a processing instruction instead of reading them as text", () => {
    const tree = parseHtml('<?xml version="1.0"?><!DOCTYPE html><!-- CONVEX # converter_version:9.2.0 --><p>kept</p>');
    expect(normalizeText(textContent(tree))).toBe("kept");
  });

  it("selects by class, keeps document order, and records byte offsets", () => {
    const source = '<body><p class="drop">x</p><p class="keep">y</p></body>';
    const tree = parseHtml(source);
    const kept = findFirst(tree, { class: "keep" });
    expect(textContent(kept)).toBe("y");
    expect(source.slice(kept.start, kept.end)).toBe('<p class="keep">y</p>');
    expect(classList(findAll(tree, { tag: "p" })[0])).toEqual(["drop"]);
  });
});

describe("the block walker", () => {
  it("reads a class as a heading level only where the source says so", () => {
    const tree = parseHtml('<div><p class="ti-section-1">PART ONE</p><p class="normal">text</p></div>');
    const blocks = blocksFromElement(tree, { headingClasses: { "ti-section-1": 2 } });
    expect(blocks).toEqual([
      { kind: "heading", level: 2, text: "PART ONE", marker: "ti-section-1" },
      { kind: "para", text: "text" },
    ]);
  });

  it("keeps a list's items and a table's cells in order", () => {
    const tree = parseHtml("<div><ol><li>one</li><li>two</li></ol><table><tr><td>a</td><td>b</td></tr><tr><td>c</td></tr></table></div>");
    const blocks = blocksFromElement(tree);
    expect(blocks[0]).toEqual({ kind: "list", ordered: true, items: [{ text: "one", depth: 0 }, { text: "two", depth: 0 }] });
    expect(blocks[1]).toEqual({ kind: "table", rows: [["a", "b"], ["c"]] });
  });
});

describe("the line reader, for a text layer with no markup", () => {
  it("joins a soft-hyphenated word without a space and every other break with one", () => {
    const blocks = blocksFromLines(["Ovi\u00adm zakonom", "ure\u0111uje se", "delatnost."]);
    expect(blocks).toEqual([{ kind: "para", text: "Ovim zakonom ure\u0111uje se delatnost." }]);
  });

  it("reads an article marker and an all-capitals line as headings", () => {
    const blocks = blocksFromLines(["I. \u041e\u0421\u041d\u041e\u0412\u041d\u0415 \u041e\u0414\u0420\u0415\u0414\u0411\u0415", "\u0427\u043b\u0430\u043d 1.", "Text of the article."]);
    expect(blocks.map((block) => [block.kind, block.level ?? 0, block.text])).toEqual([
      ["heading", 3, "I. \u041e\u0421\u041d\u041e\u0412\u041d\u0415 \u041e\u0414\u0420\u0415\u0414\u0411\u0415"],
      ["heading", 4, "\u0427\u043b\u0430\u043d 1."],
      ["para", 0, "Text of the article."],
    ]);
  });

  it("treats a short title as a heading only when what follows it is a heading", () => {
    const heading = blocksFromLines(["\u0421\u043e\u0446\u0438\u0458\u0430\u043b\u043d\u0430 \u0437\u0430\u0448\u0442\u0438\u0442\u0430", "\u0427\u043b\u0430\u043d 2.", "Text."]);
    expect(heading[0]).toEqual({ kind: "heading", level: 3, text: "\u0421\u043e\u0446\u0438\u0458\u0430\u043b\u043d\u0430 \u0437\u0430\u0448\u0442\u0438\u0442\u0430" });
    const prose = blocksFromLines(["\u0434\u0440\u0443\u0448\u0442\u0432\u0435\u043d\u0430 \u0434\u0435\u043b\u0430\u0442\u043d\u043e\u0441\u0442", "\u043e\u0434 \u0458\u0430\u0432\u043d\u043e\u0433 \u0438\u043d\u0442\u0435\u0440\u0435\u0441\u0430."]);
    expect(prose).toEqual([{ kind: "para", text: "\u0434\u0440\u0443\u0448\u0442\u0432\u0435\u043d\u0430 \u0434\u0435\u043b\u0430\u0442\u043d\u043e\u0441\u0442 \u043e\u0434 \u0458\u0430\u0432\u043d\u043e\u0433 \u0438\u043d\u0442\u0435\u0440\u0435\u0441\u0430." }]);
  });
});

describe("the Markdown writer", () => {
  it("escapes what would otherwise be markup and strips back to the same text", () => {
    const tricky = ["*", "_", "|", "<b>", "`", "\\", "# heading", "- item", "1. item"].join(" ");
    const markdown = toMarkdown([{ kind: "para", text: tricky }]);
    expect(markdown).toContain("\\*");
    expect(markdown).toContain("\\|");
    expect(markdown).toContain("\\<b\\>");
    expect(normalizeText(stripMarkdown(markdown))).toBe(normalizeText(tricky));
  });

  it("joins two adjacent tables of one width and keeps two of different widths apart", () => {
    const markdown = toMarkdown([
      { kind: "table", rows: [["a", "1"]] },
      { kind: "table", rows: [["b", "2"]] },
      { kind: "table", rows: [["c", "3", "extra"]] },
    ]);
    expect(markdown.split("\n").filter((line) => line.includes("---"))).toHaveLength(2);
    expect(markdown).toContain("| a | 1 |\n| --- | --- |\n| b | 2 |");
  });

  it("writes an id the pack can use as a file name", () => {
    expect(slug("TITLE III PROVISIONS ON THE INSTITUTIONS")).toBe("title-iii-provisions-on-the-institutions");
    expect(slug("\u0423\u0441\u0442\u0430\u0432 \u0420\u0435\u043f\u0443\u0431\u043b\u0438\u043a\u0435 \u0421\u0440\u0431\u0438\u0458\u0435")).toBe("ustav-republike-srbije");
  });
});

describe("the UN page fixture", () => {
  const spec = { ...documentOf("un-charter") };
  delete spec.endAt; // the fixture is the top of the page, so the closing marker is not in it
  const { sections } = convertDocument(spec, fixture("un-charter.html"), { linesOfPdf: null });

  it("keeps the document's own headings and drops the page's stylesheet", () => {
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Preamble and Chapters I\u2013XIX");
    const blocks = sections[0].blocks;
    expect(blocks[0]).toEqual({ kind: "heading", level: 2, text: "Preamble", marker: null });
    expect(blocks[1]).toEqual({ kind: "heading", level: 3, text: "WE THE PEOPLES OF THE UNITED NATIONS DETERMINED", marker: null });
    // The fixture's <style> element is never content, and the "Print This Page"
    // links and the page's note box are not this document: none of their text is
    // anywhere in the conversion.
    expect(blocksToText(blocks)).not.toContain("list-style-type");
    expect(blocksToText(blocks)).not.toContain("Print This Page");
  });

  it("keeps Article 1's four purposes as an ordered list, verbatim", () => {
    const blocks = sections[0].blocks;
    const list = blocks.find((block) => block.kind === "list");
    expect(list.ordered).toBe(true);
    expect(list.items).toHaveLength(4);
    expect(list.items[0].text.startsWith("To maintain international peace and security, and to that end:")).toBe(true);
    expect(list.items[3].text).toBe("To be a centre for harmonizing the actions of nations in the attainment of these common ends.");
    expect(toMarkdown([list]).startsWith("1. To maintain international peace and security")).toBe(true);
  });

  it("ends the preamble with the paragraph the source prints, unchanged", () => {
    const blocks = sections[0].blocks;
    expect(blocksToText(blocks)).toContain("but this principle shall not prejudice the application of enforcement measures under Chapter Vll.");
  });

  it("reads the same document when a checkout hands it back with CRLF line endings", () => {
    // `* text=auto` is in .gitattributes, so these fixtures arrive with the
    // platform's line endings. A fixture that converted differently on Windows
    // and on CI would be a test that certifies one machine.
    const crlf = Buffer.from(fixture("un-charter.html").toString("utf8").replace(/\r?\n/g, "\r\n"), "utf8");
    const fromCrlf = convertDocument(spec, crlf, { linesOfPdf: null });
    expect(fromCrlf.sections[0].blocks).toEqual(sections[0].blocks);
  });
});

describe("the Official Journal fixture", () => {
  const spec = documentOf("eu-teu");
  const { sections } = convertDocument(spec, fixture("oj-c202-teu.xhtml"), { linesOfPdf: null });

  it("drops the OJ page header and keeps the document title and one contents row", () => {
    const first = sections[0];
    expect(first.title).toBe("Table of contents");
    expect(first.blocks[0]).toEqual({ kind: "heading", level: 1, text: "CONSOLIDATED VERSION OF THE TREATY ON EUROPEAN UNION", marker: "doc-ti" });
    expect(first.blocks[1]).toEqual({ kind: "heading", level: 2, text: "Table of Contents", marker: "ti-tbl" });
    expect(first.blocks[2]).toEqual({ kind: "table", rows: [["CONSOLIDATED VERSION OF THE TREATY ON EUROPEAN UNION", "13"]] });
    expect(blocksToText(first.blocks)).not.toContain("Official Journal of the European Union C 202/1");
  });

  it("splits at the section marker and names the section from the heading beside it", () => {
    expect(sections.map((section) => section.title)).toEqual(["Table of contents", "TITLE I COMMON PROVISIONS"]);
  });

  it("keeps a footnote marker's own number and drops the link's target", () => {
    const preamble = sections[0].blocks.map((block) => block.text ?? "").join(" ");
    expect(preamble).toContain("HER MAJESTY THE QUEEN OF THE UNITED KINGDOM OF GREAT BRITAIN AND NORTHERN IRELAND, (1)");
    expect(preamble).not.toContain("ntc1-C_2016202EN");
  });

  it("writes Article 1 and its sub-article headings at their own levels", () => {
    const body = sections[1].blocks;
    expect(body.slice(0, 4)).toEqual([
      { kind: "heading", level: 3, text: "COMMON PROVISIONS", marker: "ti-section-2" },
      { kind: "heading", level: 4, text: "Article 1", marker: "ti-art" },
      { kind: "heading", level: 4, text: "(ex Article 1 TEU) (2)", marker: "sti-art" },
      { kind: "para", text: "By this Treaty, the HIGH CONTRACTING PARTIES establish among themselves a EUROPEAN UNION, hereinafter called \u2018the Union\u2019, on which the Member States confer competences to attain objectives they have in common." },
    ]);
  });
});

describe("the gazette fixture", () => {
  const { sections } = convertDocument({ id: "gazette", kind: "text", title: "Zakon" }, fixture("gazette-socijalna-zastita.txt"), { linesOfPdf: null });
  const blocks = sections[0].blocks;

  it("keeps the promulgation decree, the gazette line and the act's own article markers", () => {
    expect(blocks.map((block) => `${block.kind}:${block.kind === "heading" ? block.level : ""}`)).toEqual([
      "para:", "heading:3", "heading:3", "heading:4", "para:",
      "heading:3", "heading:4", "para:", "heading:3", "heading:4", "para:",
      "heading:3", "heading:4", "para:", "heading:3", "heading:4", "para:",
    ]);
    expect(blocks[0].text.startsWith("\u041d\u0430 \u043e\u0441\u043d\u043e\u0432\u0443 \u0447\u043b\u0430\u043d\u0430 112. \u0441\u0442\u0430\u0432 1. \u0442\u0430\u0447\u043a\u0430 2. \u0423\u0441\u0442\u0430\u0432\u0430 \u0420\u0435\u043f\u0443\u0431\u043b\u0438\u043a\u0435 \u0421\u0440\u0431\u0438\u0458\u0435")).toBe(true);
    // The gazette's own sentence, with the two lines it was broken across joined
    // by one space: no soft hyphen, because this act's text layer has none.
    expect(blocks[0].text).toContain("\u0443 \"\u0421\u043b\u0443\u0436\u0431\u0435\u043d\u043e\u043c \u0433\u043b\u0430\u0441\u043d\u0438\u043a\u0443 \u0420\u0421\", \u0431\u0440. 24/2011 \u043e\u0434 4.4.2011. \u0433\u043e\u0434\u0438\u043d\u0435.");
  });

  it("writes the act's Cyrillic unchanged, with its article marker as a heading", () => {
    const indices = blocks.map((block, index) => (block.kind === "heading" && block.text === "\u0427\u043b\u0430\u043d 1." ? index : -1)).filter((index) => index >= 0);
    expect(indices).toEqual([3]);
    expect(blocks[4].text.startsWith("\u041e\u0432\u0438\u043c \u0437\u0430\u043a\u043e\u043d\u043e\u043c \u0443\u0440\u0435\u0452\u0443\u0458\u0435 \u0441\u0435 \u0434\u0435\u043b\u0430\u0442\u043d\u043e\u0441\u0442 \u0441\u043e\u0446\u0438\u0458\u0430\u043b\u043d\u0435 \u0437\u0430\u0448\u0442\u0438\u0442\u0435")).toBe(true);
    expect(toMarkdown([blocks[3]])).toBe("#### \u0427\u043b\u0430\u043d 1.");
  });
});
