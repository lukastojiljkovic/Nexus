import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { fidelity } from "./build.mjs";
import { assertReaderSubset, plainText, stripMarkup, toMarkdown } from "./lib/blocks.mjs";
import { htmlWords, itemsToBlocks, parseItems } from "./lib/html.mjs";
import { ocrToBlocks, ocrWords } from "./lib/ocr.mjs";
import { collapse } from "./lib/text.mjs";
import { wikitextToBlocks, wikitextWords } from "./lib/wikitext.mjs";

/**
 * The fidelity test, on real source data.
 *
 * The pack may ship a source's text and change only its markup, and this is the
 * file that proves it: for each of the three source kinds, the article's blocks
 * are compared BOTH ways the brief asks —
 *
 *   stripMarkup(toMarkdown(blocks)) === plainText(blocks)   (markup only)
 *   plainText(blocks) === the source span's own words        (nothing moved)
 *
 * — with the word counts pinned as values, so a converter that starts dropping
 * a paragraph is a failing test rather than a smaller article. The negative
 * cases at the end are the point of the positive ones: a comparison that cannot
 * fail proves nothing, so each of the three ways to lose a word is shown to be
 * caught.
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

/**
 * One fixture as the article the builder would make of it.
 *
 * `sourceText` is the oracle: the same source read by a separate, cruder pass
 * (`htmlWords`, `ocrWords`, `wikitextWords`) that has no notion of a block, so
 * the second comparison catches a converter that moved a word rather than one
 * that changed a heading's size.
 */
function articleOf(testCase) {
  const text = fixture(testCase.file);
  if (testCase.kind === "html") {
    return { id: testCase.id, blocks: itemsToBlocks(parseItems(text).items), sourceText: htmlWords(text) };
  }
  if (testCase.kind === "ocr") {
    return { id: testCase.id, blocks: ocrToBlocks(text, { furniture: FURNITURE }), sourceText: ocrWords(text, { furniture: FURNITURE }) };
  }
  return { id: testCase.id, blocks: wikitextToBlocks(text).blocks, sourceText: wikitextWords(text) };
}

const CASES = [
  { id: "carpentry-chapter-ii", kind: "html", file: "carpentry-chapter-ii.html", blocks: 32, words: 8157 },
  { id: "abcs-of-mending", kind: "ocr", file: "abcs-of-mending.txt", blocks: 38, words: 5634 },
  { id: "candlemaking", kind: "wikitext", file: "candlemaking.wikitext", blocks: 7, words: 3071 },
];

describe("every article is the source's own text", () => {
  for (const testCase of CASES) {
    it(`${testCase.id}: the markup round-trips and the words are the source's`, () => {
      const article = articleOf(testCase);
      const markdown = fidelity(article);
      expect(article.blocks).toHaveLength(testCase.blocks);
      expect(collapse(article.sourceText)).toHaveLength(testCase.words);
      expect(collapse(stripMarkup(markdown))).toBe(collapse(plainText(article.blocks)));
      expect(collapse(article.sourceText)).toBe(collapse(plainText(article.blocks)));
    });

    it(`${testCase.id}: a word removed from a block is caught`, () => {
      const article = articleOf(testCase);
      const broken = { ...article, blocks: article.blocks.map((block) => ({ ...block })) };
      const paragraph = broken.blocks.find((block) => block.kind === "paragraph");
      paragraph.text = paragraph.text.replace(/\s\S+/, "");
      expect(() => fidelity(broken)).toThrow(/disagree/);
    });

    it(`${testCase.id}: a block dropped from the article is caught`, () => {
      const article = articleOf(testCase);
      const broken = { ...article, blocks: article.blocks.filter((block) => block.kind !== "paragraph") };
      expect(() => fidelity(broken)).toThrow(/disagree/);
    });

    it(`${testCase.id}: a paragraph cut in half is caught`, () => {
      const article = articleOf(testCase);
      const words = collapse(article.sourceText).split(" ");
      const broken = { ...article, sourceText: words.slice(0, Math.floor(words.length / 2)).join(" ") };
      expect(() => fidelity(broken)).toThrow(/disagree/);
    });
  }
});

describe("the Markdown a pack ships is inside the Reader's subset", () => {
  it("escapes a `<` that would otherwise open a tag", () => {
    // The Reader REFUSES raw HTML rather than rendering it, so an article that
    // carried a source's `<` unescaped would be an article it cannot show.
    expect(() => assertReaderSubset("a sentence with <b> in it")).toThrow(/raw HTML/);
    const markdown = toMarkdown([{ kind: "paragraph", text: "a sentence with <b> in it" }]);
    expect(() => assertReaderSubset(markdown)).not.toThrow();
    expect(stripMarkup(markdown)).toBe("a sentence with <b> in it");
  });

  it("holds for every fixture", () => {
    for (const testCase of CASES) {
      expect(() => assertReaderSubset(toMarkdown(articleOf(testCase).blocks))).not.toThrow();
    }
  });
});
