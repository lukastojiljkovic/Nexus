import { describe, expect, it } from "vitest";

import {
  escapeParagraph,
  escapeInline,
  escapeText,
  markdownTable,
  normalise,
  slug,
  stripMarkup,
  textToBlocks,
} from "./lib/text.mjs";

/**
 * The pair the whole pack is checked with.
 *
 * These are the cheap tests over the shared vocabulary of `lib/text.mjs`. They
 * earn their place because both the converter and the fidelity check call into
 * this file: a rule here that ate a character would make the converter's output
 * and its reference agree while both were wrong, and the tests below pin the
 * cases that actually cost time while this pack was built — an escaped asterisk
 * read back as emphasis, a bullet rule that ate the line break after `2.`, and a
 * fenced block whose content was read as Markdown.
 */
describe("stripMarkup", () => {
  it("returns the source's own characters for every escape the converter writes", () => {
    // Expected values are the input's own characters: the point of an escape is
    // that it is invisible to the text a reader sees.
    expect(stripMarkup(String.raw`\* \_ \| \# \[ \] \``)).toBe("* _ | # [ ] `");
  });

  it("keeps a literal asterisk that arrives escaped, even where emphasis would match", () => {
    const text = "Fruits commonly packed in syrup** and a second mark ** here";
    expect(stripMarkup(escapeText(text))).toBe(text);
  });

  it("reads a fenced block as the page's own lines", () => {
    // Guide 2's page carries `*Select cantaloupe…` inside a fenced block; the
    // bullet rule took two characters off it before fences were skipped.
    const markdown = ["```", "*Select cantaloupe that are full size", "1. Chops", "```"].join("\n");
    expect(stripMarkup(markdown)).toBe("*Select cantaloupe that are full size\n1. Chops");
  });

  it("does not eat the line break after a paragraph that is only `2.`", () => {
    // TM 10-405's OCR has pages of one-line paragraphs, several of them a bare
    // `2.`; a bullet rule written with `\s+` swallowed both the marker and the
    // newline that separated it from the next paragraph.
    expect(stripMarkup("4 pounds\n\n2.\n\nRolled 3 pounds\n")).toBe("4 pounds\n\n2.\n\nRolled 3 pounds\n");
  });

  it("drops an image whole, including the alt text the builder wrote", () => {
    expect(stripMarkup("before ![](images/x.jpg) after")).toBe("before  after");
  });

  it("keeps a link's label and drops its target, parentheses and all", () => {
    expect(stripMarkup("[section 114(a)](https://example.invalid/a_(b)_c) rest")).toBe("section 114(a) rest");
  });
});

describe("normalise", () => {
  it("collapses the whitespace a PDF text layer and a Markdown file disagree about", () => {
    // One instruction, three ways of writing it: a line break from the column
    // edge, a no-break space from the PDF's own space character, and a run of
    // spaces. All three are the same instruction to a reader.
    expect(normalise("Store\u00a0at least\n\n a   several-day")).toBe("Store at least a several-day");
  });

  it("composes the accents a PDF text layer leaves decomposed", () => {
    expect(normalise("Jalapen\u0303o")).toBe("Jalapeño");
  });
});

describe("escapeParagraph", () => {
  it("escapes only a line's first character, leaving the markup around it alone", () => {
    // The link's own brackets were escaped before this rule was narrowed, which
    // turned every CDC page's `[Español](…)` into `\[Español\](…)`.
    expect(escapeParagraph("[Español](https://example.invalid/es)")).toBe("[Español](https://example.invalid/es)");
    expect(escapeParagraph("1. Chops")).toBe("1\\. Chops");
    expect(escapeParagraph("- 2 cups sugar")).toBe("\\- 2 cups sugar");
    // `*` is not this rule's business: it is escaped at the leaf, with the rest
    // of the characters CommonMark reads as markup, and `escapeText` is the two
    // of them together.
    expect(escapeParagraph("*Select cantaloupe")).toBe("*Select cantaloupe");
    expect(escapeText("*Select cantaloupe")).toBe("\\*Select cantaloupe");
  });

  it("is the identity on an ordinary sentence", () => {
    expect(escapeText("Low-acid foods have pH values higher than 4.6.")).toBe(
      "Low-acid foods have pH values higher than 4.6.",
    );
  });
});

describe("markdownTable", () => {
  it("writes a header, a delimiter row and one row per line of the source", () => {
    expect(markdownTable(["Style of Pack", "Jar Size"], [["Raw", "Pints"]])).toBe(
      ["| Style of Pack | Jar Size |", "| --- | --- |", "| Raw | Pints |"].join("\n"),
    );
  });

  it("pads a short row rather than letting its columns shift", () => {
    expect(markdownTable(["a", "b", "c"], [["1"]])).toBe(
      ["| a | b | c |", "| --- | --- | --- |", "| 1 |  |  |"].join("\n"),
    );
  });

  it("escapes the pipe a cell may not carry literally", () => {
    expect(markdownTable(["a"], [["1 | 2"]])).toContain(String.raw`| 1 \| 2 |`);
  });
});

describe("textToBlocks and slug", () => {
  it("splits a scan into the paragraphs its own blank lines mark", () => {
    expect(textToBlocks("One line\nwrapped.\n\nSecond.\n")).toEqual([
      { kind: "paragraph", text: "One line wrapped." },
      { kind: "paragraph", text: "Second." },
    ]);
  });

  it("keeps a scan's own punctuation untouched", () => {
    const text = "Caution: drain and discard liquid. 2) Then — carefully — rinse.";
    expect(textToBlocks(text).map((block) => block.text)).toEqual([text]);
  });

  it("makes a kebab-case id out of a heading, accents folded", () => {
    expect(slug("PICKLED JALAPEÑO PEPPER RINGS")).toBe("pickled-jalapeno-pepper-rings");
    expect(slug("Crème brûlée")).toBe("creme-brulee");
  });
});

describe("escapeInline", () => {
  it("escapes a backslash before the characters it would otherwise escape", () => {
    expect(escapeInline("a\\*b")).toBe(String.raw`a\\\*b`);
  });
});
