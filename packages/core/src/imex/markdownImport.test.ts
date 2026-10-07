import { describe, expect, it } from "vitest";
import { renderNoteMarkdown } from "./noteMarkdown.js";
import { buildNoteUpdate, parseMarkdownNote } from "./markdownImport.js";
import type { MarkdownBlock, MarkdownInline, MarkdownInlineMarks } from "./markdownImport.js";

/** The name a picked file lends a note whose text carries no leading H1 of its own. */
const FALLBACK = "Beleška sa diska";

function text(value: string, marks: MarkdownInlineMarks = {}): MarkdownInline {
  return { type: "text", text: value, marks };
}

const HARD_BREAK: MarkdownInline = { type: "hardBreak" };

function paragraph(...content: MarkdownInline[]): MarkdownBlock {
  return { type: "paragraph", content };
}

function heading(level: 1 | 2 | 3, ...content: MarkdownInline[]): MarkdownBlock {
  return { type: "heading", level, content };
}

/** The parsed title heading (`parseMarkdownNote`'s blocks always open with one). */
function titleHeading(value: string): MarkdownBlock {
  return heading(1, text(value));
}

/** Every block, title heading included — for the cases whose markdown opens with an H1 of its own. */
function blocksOf(markdown: string): MarkdownBlock[] {
  return parseMarkdownNote(markdown, FALLBACK).blocks;
}

/**
 * The parsed BODY: every block after the title heading. The cases below feed
 * markdown with no leading `# ` of its own, so block 0 is the synthetic
 * filename heading and this drops exactly that.
 */
function bodyOf(markdown: string): MarkdownBlock[] {
  return parseMarkdownNote(markdown, FALLBACK).blocks.slice(1);
}

/** The markdown a parsed document renders back to — the export mapping this parser inverts. */
function roundTrip(markdown: string): string {
  const parsed = parseMarkdownNote(markdown, FALLBACK);
  return renderNoteMarkdown(buildNoteUpdate(parsed.blocks), {
    attachments: new Map(),
    rootPrefix: "../",
  });
}

describe("parseMarkdownNote — title", () => {
  it("takes a leading H1 as the title and leaves it standing as the first block", () => {
    const parsed = parseMarkdownNote("# Pravi naslov\n\nTelo.\n", FALLBACK);
    expect(parsed.title).toBe("Pravi naslov");
    expect(parsed.blocks).toEqual([titleHeading("Pravi naslov"), paragraph(text("Telo."))]);
  });

  it("falls back to the file name, materialised as the leading heading", () => {
    const parsed = parseMarkdownNote("Samo pasus.\n", FALLBACK);
    expect(parsed.title).toBe(FALLBACK);
    expect(parsed.blocks).toEqual([titleHeading(FALLBACK), paragraph(text("Samo pasus."))]);
  });

  it("does not treat a deeper heading, or an H1 further down, as the title", () => {
    const parsed = parseMarkdownNote("## Pododeljak\n\n# Kasniji naslov\n", FALLBACK);
    expect(parsed.title).toBe(FALLBACK);
    expect(parsed.blocks[0]).toEqual(titleHeading(FALLBACK));
    expect(parsed.blocks[1]).toEqual(heading(2, text("Pododeljak")));
  });

  it("reads the title through the H1's inline markup, and caps it at 200 characters", () => {
    const parsed = parseMarkdownNote(`# **${"a".repeat(250)}**\n`, FALLBACK);
    expect(parsed.title).toBe("a".repeat(200));
  });

  it("parses an empty document to no blocks at all", () => {
    const parsed = parseMarkdownNote("   \n\n\t\n", FALLBACK);
    expect(parsed.blocks).toEqual([]);
    expect(parsed.title).toBe("");
  });
});

describe("parseMarkdownNote — blocks", () => {
  it("maps ATX headings 1-3 and clamps anything deeper to 3", () => {
    expect(blocksOf("# A\n\n## B\n\n### C\n\n#### D\n\n###### E\n")).toEqual([
      heading(1, text("A")),
      heading(2, text("B")),
      heading(3, text("C")),
      heading(3, text("D")),
      heading(3, text("E")),
    ]);
  });

  it("closes an ATX heading's optional trailing hashes", () => {
    expect(bodyOf("## Naslov ##\n")).toEqual([heading(2, text("Naslov"))]);
  });

  it("reads setext underlines as headings 1 and 2", () => {
    expect(blocksOf("Prvi\n====\n\nDrugi\n-----\n")).toEqual([
      heading(1, text("Prvi")),
      heading(2, text("Drugi")),
    ]);
  });

  it("joins a soft-wrapped paragraph with a space and splits paragraphs on a blank line", () => {
    expect(bodyOf("Prvi red\ndrugi red\n\nDrugi pasus.\n")).toEqual([
      paragraph(text("Prvi red drugi red")),
      paragraph(text("Drugi pasus.")),
    ]);
  });

  it("reads both hard-break spellings — a trailing backslash and two trailing spaces", () => {
    expect(bodyOf("Prvi\\\ndrugi\n")).toEqual([paragraph(text("Prvi"), HARD_BREAK, text("drugi"))]);
    expect(bodyOf("Prvi  \ndrugi\n")).toEqual([paragraph(text("Prvi"), HARD_BREAK, text("drugi"))]);
  });

  it("maps a thematic break in each of its spellings", () => {
    expect(bodyOf("a\n\n---\n\nb\n\n***\n\n___\n")).toEqual([
      paragraph(text("a")),
      { type: "horizontalRule" },
      paragraph(text("b")),
      { type: "horizontalRule" },
      { type: "horizontalRule" },
    ]);
  });

  it("maps a fenced code block with its language, verbatim", () => {
    expect(bodyOf("```ts\nconst a = `x`;\n  indented\n```\n")).toEqual([
      { type: "codeBlock", language: "ts", text: "const a = `x`;\n  indented" },
    ]);
  });

  it("accepts a tilde fence and a longer backtick fence, and keeps an unlabelled one language-free", () => {
    expect(bodyOf("~~~\nplain\n~~~\n")).toEqual([{ type: "codeBlock", language: "", text: "plain" }]);
    expect(bodyOf("````\n```\n````\n")).toEqual([{ type: "codeBlock", language: "", text: "```" }]);
  });

  it("runs an unterminated fence to the end of the document rather than losing it", () => {
    expect(bodyOf("```\nbez kraja\n")).toEqual([
      { type: "codeBlock", language: "", text: "bez kraja" },
    ]);
  });

  it("maps a blockquote, including its own nested blocks", () => {
    expect(bodyOf("> Citat.\n>\n> - stavka\n")).toEqual([
      {
        type: "blockquote",
        content: [
          paragraph(text("Citat.")),
          { type: "bulletList", items: [[paragraph(text("stavka"))]] },
        ],
      },
    ]);
  });

  it("maps a bullet list, with nested lists riding the item's indentation", () => {
    expect(bodyOf("- prva\n- druga\n  - ugnježdena\n")).toEqual([
      {
        type: "bulletList",
        items: [
          [paragraph(text("prva"))],
          [
            paragraph(text("druga")),
            { type: "bulletList", items: [[paragraph(text("ugnježdena"))]] },
          ],
        ],
      },
    ]);
  });

  it("maps an ordered list and keeps the number it starts counting from", () => {
    expect(bodyOf("3. treća\n4. četvrta\n")).toEqual([
      {
        type: "orderedList",
        start: 3,
        items: [[paragraph(text("treća"))], [paragraph(text("četvrta"))]],
      },
    ]);
  });

  it("maps a task list, checked and unchecked", () => {
    expect(bodyOf("- [ ] otvoreno\n- [x] gotovo\n")).toEqual([
      {
        type: "taskList",
        items: [
          { checked: false, content: [paragraph(text("otvoreno"))] },
          { checked: true, content: [paragraph(text("gotovo"))] },
        ],
      },
    ]);
  });

  it("starts a new list when the marker kind changes", () => {
    expect(bodyOf("- [x] zadatak\n- obična\n")).toEqual([
      { type: "taskList", items: [{ checked: true, content: [paragraph(text("zadatak"))] }] },
      { type: "bulletList", items: [[paragraph(text("obična"))]] },
    ]);
  });

  it("keeps a list item's second block, indented past its marker", () => {
    expect(bodyOf("- prva\n\n  drugi pasus\n- druga\n")).toEqual([
      {
        type: "bulletList",
        items: [
          [paragraph(text("prva")), paragraph(text("drugi pasus"))],
          [paragraph(text("druga"))],
        ],
      },
    ]);
  });
});

describe("parseMarkdownNote — inline", () => {
  it("maps bold, italic and inline code", () => {
    expect(bodyOf("**podebljano** *kurziv* `kod`\n")).toEqual([
      paragraph(
        text("podebljano", { bold: true }),
        text(" "),
        text("kurziv", { italic: true }),
        text(" "),
        text("kod", { code: true }),
      ),
    ]);
  });

  it("nests emphasis marks", () => {
    expect(bodyOf("**spolja *unutra* kraj**\n")).toEqual([
      paragraph(
        text("spolja ", { bold: true }),
        text("unutra", { bold: true, italic: true }),
        text(" kraj", { bold: true }),
      ),
    ]);
  });

  it("reads `_` as emphasis only at a word boundary, so snake_case survives", () => {
    expect(bodyOf("_kurziv_ i zmija_slucaj_ostaje\n")).toEqual([
      paragraph(text("kurziv", { italic: true }), text(" i zmija_slucaj_ostaje")),
    ]);
  });

  it("keeps an inline code span verbatim, unwrapping CommonMark's padding space", () => {
    expect(bodyOf("`` `x` ``\n")).toEqual([paragraph(text("`x`", { code: true }))]);
  });

  it("maps an inline link and an angle-bracketed destination", () => {
    expect(bodyOf("[Nexus](https://example.com) i [drugo](<https://example.com/a b>)\n")).toEqual([
      paragraph(
        text("Nexus", { link: "https://example.com" }),
        text(" i "),
        text("drugo", { link: "https://example.com/a b" }),
      ),
    ]);
  });

  it("links a bare URL and an autolink, trimming trailing sentence punctuation", () => {
    expect(bodyOf("Vidi https://example.com/a. Kraj\n")).toEqual([
      paragraph(
        text("Vidi "),
        text("https://example.com/a", { link: "https://example.com/a" }),
        text(". Kraj"),
      ),
    ]);
    expect(bodyOf("<https://example.com>\n")).toEqual([
      paragraph(text("https://example.com", { link: "https://example.com" })),
    ]);
  });

  it("honours backslash escapes, so an escaped construct arrives as literal text", () => {
    expect(bodyOf("\\# nije naslov \\*ne kurziv\\* \\\\\n")).toEqual([
      paragraph(text("# nije naslov *ne kurziv* \\")),
    ]);
  });

  it("leaves an unclosed delimiter as literal text rather than swallowing the line", () => {
    expect(bodyOf("2 * 3 * 4 i **nedovrseno\n")).toEqual([
      paragraph(text("2 "), text(" 3 ", { italic: true }), text(" 4 i **nedovrseno")),
    ]);
  });

  it("keeps a wiki-link's brackets as literal text — an id-less target cannot be resolved here", () => {
    expect(bodyOf("Vidi [[Druga beleška]].\n")).toEqual([
      paragraph(text("Vidi [[Druga beleška]].")),
    ]);
  });
});

describe("parseMarkdownNote — NOTE-011 containers", () => {
  it("reads a colon fence as a callout, normalising an unknown variant", () => {
    expect(bodyOf("::: warning\nPazi.\n:::\n")).toEqual([
      { type: "callout", variant: "warning", content: [paragraph(text("Pazi."))] },
    ]);
    expect(bodyOf("::: izmisljeno\nTekst.\n:::\n")).toEqual([
      { type: "callout", variant: "info", content: [paragraph(text("Tekst."))] },
    ]);
  });

  it("reads `::: toggle` as an expanded toggle carrying its summary", () => {
    expect(bodyOf("::: toggle Naslov odeljka\nSadržaj.\n:::\n")).toEqual([
      {
        type: "toggle",
        summary: [text("Naslov odeljka")],
        content: [paragraph(text("Sadržaj."))],
      },
    ]);
  });

  it("nests containers, the longer fence closing the inner one", () => {
    expect(bodyOf("::: tip\nSpolja.\n\n:::: danger\nUnutra.\n::::\n:::\n")).toEqual([
      {
        type: "callout",
        variant: "tip",
        content: [
          paragraph(text("Spolja.")),
          { type: "callout", variant: "danger", content: [paragraph(text("Unutra."))] },
        ],
      },
    ]);
  });

  it("closes an unterminated container at the end of the document", () => {
    expect(bodyOf("::: info\nBez kraja.\n")).toEqual([
      { type: "callout", variant: "info", content: [paragraph(text("Bez kraja."))] },
    ]);
  });

  it("reads the table-of-contents marker back as the block it stands for", () => {
    expect(bodyOf("<!-- toc -->\n")).toEqual([{ type: "tableOfContents" }]);
  });
});

describe("parseMarkdownNote — honest degradation", () => {
  it("turns an image into plain text carrying its alt and URL, and counts it", () => {
    const parsed = parseMarkdownNote("![Dijagram](slike/a.png)\n", FALLBACK);
    expect(parsed.blocks.slice(1)).toEqual([paragraph(text("Dijagram (slike/a.png)"))]);
    expect(parsed.imagesAsText).toBe(1);
  });

  it("keeps an alt-less image's URL, and counts an inline one too", () => {
    const parsed = parseMarkdownNote("Pre ![](a.png) posle\n", FALLBACK);
    expect(parsed.blocks.slice(1)).toEqual([paragraph(text("Pre a.png posle"))]);
    expect(parsed.imagesAsText).toBe(1);
  });

  it("keeps unknown HTML as literal text instead of dropping it", () => {
    expect(bodyOf("<div class=\"x\">sadržaj</div>\n")).toEqual([
      paragraph(text('<div class="x">sadržaj</div>')),
    ]);
  });

  it("degrades a table to one paragraph per row, dropping only its delimiter rule", () => {
    expect(bodyOf("| a | b |\n| --- | --- |\n| 1 | 2 |\n")).toEqual([
      paragraph(text("| a | b |")),
      paragraph(text("| 1 | 2 |")),
    ]);
  });
});

describe("buildNoteUpdate", () => {
  it("builds a document the Markdown export renders back to the same source", () => {
    const source = [
      "# Naslov",
      "",
      "Pasus sa **podebljanim**, *kurzivom*, `kodom` i [vezom](https://example.com).",
      "",
      "## Drugi nivo",
      "",
      "- prva",
      "- druga",
      "",
      "  - ugnježdena",
      "",
      "1. jedan",
      "2. dva",
      "",
      "- [ ] otvoreno",
      "- [x] gotovo",
      "",
      "> Citat.",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "---",
      "",
      "::: warning",
      "Pazi.",
      ":::",
      "",
      "::: toggle Naslov odeljka",
      "Sadržaj.",
      ":::",
      "",
      "<!-- toc -->",
      "",
    ].join("\n");
    expect(roundTrip(source)).toBe(source);
  });

  it("round-trips a hard break and keeps it a hardBreak node", () => {
    expect(roundTrip("# N\n\nPrvi\\\ndrugi\n")).toBe("# N\n\nPrvi\\\ndrugi\n");
  });

  it("gives a list item that opens with a nested list the paragraph the schema requires", () => {
    const parsed = parseMarkdownNote("# N\n\n- - duboko\n", FALLBACK);
    expect(renderNoteMarkdown(buildNoteUpdate(parsed.blocks), {
      attachments: new Map(),
      rootPrefix: "../",
    })).toBe("# N\n\n- - duboko\n");
  });

  it("renders nothing for a document with no blocks", () => {
    expect(renderNoteMarkdown(buildNoteUpdate([]), { attachments: new Map(), rootPrefix: "../" })).toBe(
      "",
    );
  });
});
/**
 * A bare URL's sentence punctuation used to be trimmed with a `[.,;:!?)\]}'"»…]+$`
 * pattern, which re-walked the run from every position in it: a URL of a
 * megabyte of dots with a letter after them took minutes. The set and the
 * backward scan answer the same thing, and the reader's cap is what says so.
 */
describe("a bare URL's punctuation is trimmed in one pass", () => {
  it("leaves the punctuation the sentence owns behind the link", () => {
    expect(blocksOf("see http://example.com/a... and x")[1]).toEqual(
      paragraph(
        text("see "),
        text("http://example.com/a", { link: "http://example.com/a" }),
        text("... and x"),
      ),
    );
    // A URL that IS punctuation keeps nothing, and one with a trailing slash
    // keeps the slash: only the class's own characters come off.
    expect(blocksOf("http://example.com/a/")[1]).toEqual(
      paragraph(text("http://example.com/a/", { link: "http://example.com/a/" })),
    );
  });

  it("parses a document at the reader's cap in linear time", () => {
    const cap = 1024 * 1024;
    const started = performance.now();
    const parsed = parseMarkdownNote(`http://${".".repeat(cap - 8)}x`, FALLBACK);
    expect(performance.now() - started).toBeLessThan(200);
    expect(parsed.blocks.length).toBeGreaterThan(0);
  });
});
