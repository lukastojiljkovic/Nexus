import { describe, expect, it } from "vitest";
import { contentMarker, leadSection, parseMarkdownUnits, parsePage } from "./markup.js";

const PAGE = [
  "---",
  "id: podesavanja",
  'title: "Podesavanja: opcije"',
  "location:",
  "  module: settings",
  "  settings: data",
  "keywords: [podesavanja, opcije]",
  "stages:",
  "  - prva",
  "  - druga",
  "---",
  "# Podesavanja",
  "",
  "Gde se sta menja.",
  "",
].join("\n");

describe("parsePage", () => {
  it("reads flat and one-level keys, quoted scalars and both list shapes", () => {
    const parsed = parsePage(PAGE);

    expect(parsed.frontMatter?.scalars.get("id")).toBe("podesavanja");
    // The colon inside the quotes is part of the title, not a second key.
    expect(parsed.frontMatter?.scalars.get("title")).toBe("Podesavanja: opcije");
    expect(parsed.frontMatter?.scalars.get("location.module")).toBe("settings");
    expect(parsed.frontMatter?.scalars.get("location.settings")).toBe("data");
    expect(parsed.frontMatter?.lists.get("keywords")).toEqual(["podesavanja", "opcije"]);
    expect(parsed.frontMatter?.lists.get("stages")).toEqual(["prva", "druga"]);
    expect(parsed.body.startsWith("# Podesavanja")).toBe(true);
    expect(parsed.body.includes("---")).toBe(false);
  });

  it("treats a document with no front matter as all body", () => {
    const parsed = parsePage("# Samo tekst\n\nNesto.");
    expect(parsed.frontMatter).toBeNull();
    expect(parsed.body).toBe("# Samo tekst\n\nNesto.");
  });

  it("treats an UNCLOSED block as body rather than swallowing the document", () => {
    // A half-written page is a page somebody must still be able to read.
    const source = "---\nid: x\n\n# Tekst\n\nNesto.";
    const parsed = parsePage(source);
    expect(parsed.frontMatter).toBeNull();
    expect(parsed.body).toBe(source);
  });

  it("skips whole-line comments and empty lines inside the block", () => {
    const parsed = parsePage(["---", "# a comment", "", "id: x", "---", "body"].join("\n"));
    expect(parsed.frontMatter?.scalars.get("id")).toBe("x");
    expect(parsed.frontMatter?.scalars.size).toBe(1);
    expect(parsed.body).toBe("body");
  });
});

describe("parseMarkdownUnits", () => {
  it("keeps paragraphs, lists, code, quotes and tables apart, with the heading path above each", () => {
    const body = [
      "# A",
      "para one",
      "continued",
      "",
      "- item one",
      "- item two",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "## B",
      "> quoted line",
      "",
      "| a | b |",
      "| - | - |",
    ].join("\n");

    expect(parseMarkdownUnits(body)).toEqual([
      { text: "para one continued", headings: ["A"] },
      { text: "- item one\n- item two", headings: ["A"] },
      { text: "const x = 1;", headings: ["A"] },
      { text: "quoted line", headings: ["A", "B"] },
      { text: "| a | b |\n| - | - |", headings: ["A", "B"] },
    ]);
  });

  it("drops a heading's own text and a heading with nothing under it", () => {
    expect(parseMarkdownUnits("# Only a heading")).toEqual([]);
  });
});

describe("leadSection", () => {
  it("reads the prose between the title and the next heading", () => {
    const text = "# Title\n\nPrva recenica. Druga.\n\n## Odeljak\n\nDublje.";
    expect(leadSection(text, 1_000)).toBe("Prva recenica. Druga.");
  });

  it("reads the whole article when no other heading follows, up to the cap", () => {
    const text = "Nema naslova uopste, samo tekst.";
    expect(leadSection(text, 1_000)).toBe("Nema naslova uopste, samo tekst.");
    // The cap cuts at the character, not at a word: ten characters is ten
    // characters, and the caller's cap is the only thing that decides.
    expect(leadSection(text, 10)).toBe("Nema naslo");
  });
});

describe("contentMarker", () => {
  it("is stable for the same parts and different for a changed one", () => {
    const first = contentMarker(["a", "b"]);
    expect(first).toBe(contentMarker(["a", "b"]));
    expect(first).not.toBe(contentMarker(["a", "c"]));
    // 16 hex characters: the marker is stored in a TEXT column and compared, never parsed.
    expect(first).toMatch(/^[0-9a-f]{16}$/);
  });

  it("does not confuse a boundary with a concatenation", () => {
    // "ab" + "c" and "a" + "bc" are different files, and must be different markers.
    expect(contentMarker(["ab", "c"])).not.toBe(contentMarker(["a", "bc"]));
  });
});
