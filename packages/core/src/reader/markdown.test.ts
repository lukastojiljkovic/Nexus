import { describe, expect, it } from "vitest";

import {
  ReaderMarkdownError,
  isAllowedTarget,
  parseReaderMarkdown,
  readerPlainText,
  readerTitleOf,
  textOfInline,
  type ReaderBlock,
  type ReaderInline,
} from "./markdown.js";

/**
 * The Reader's Markdown subset (ADR-100).
 *
 * Every case here states what the block or inline IS, because the page renders
 * these nodes and nothing downstream re-checks them. The two refusals are
 * asserted with the line they name, which is the whole value of refusing: pack
 * text is untrusted, and a reader told "line 4" can fix the pack.
 */

/** The blocks of one source, for the many cases that care about the shape and not the refusal. */
function blocks(source: string): ReaderBlock[] {
  return parseReaderMarkdown(source);
}

function refusal(source: string): ReaderMarkdownError {
  try {
    parseReaderMarkdown(source);
  } catch (error) {
    if (error instanceof ReaderMarkdownError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

/** One inline node rendered back to a debug string, so a nested shape reads in one assertion. */
function inline(node: ReaderInline): string {
  switch (node.type) {
    case "text":
      return node.value;
    case "code":
      return `\`${node.value}\``;
    case "image":
      return `![${node.alt}](${node.src})`;
    case "link":
      return `[${node.children.map(inline).join("")}](${node.href})`;
    case "strong":
      return `**${node.children.map(inline).join("")}**`;
    case "emphasis":
      return `*${node.children.map(inline).join("")}*`;
  }
}

describe("the block subset", () => {
  it("reads ATX headings at every level, and drops a closing run of hashes", () => {
    expect(blocks("# Naslov\n\n### Dublje ###\n")).toEqual([
      { type: "heading", level: 1, children: [{ type: "text", value: "Naslov" }] },
      { type: "heading", level: 3, children: [{ type: "text", value: "Dublje" }] },
    ]);
  });

  it("joins the lines of one paragraph and keeps a blank line as the block boundary", () => {
    expect(blocks("prva linija\ndruga linija\n\ntreca\n")).toEqual([
      { type: "paragraph", children: [{ type: "text", value: "prva linija druga linija" }] },
      { type: "paragraph", children: [{ type: "text", value: "treca" }] },
    ]);
  });

  it("reads a fenced block with its info word, and does not parse markdown inside it", () => {
    expect(blocks("```bash\n**ne** je *markdown*\n```\n")).toEqual([
      { type: "code", language: "bash", text: "**ne** je *markdown*" },
    ]);
  });

  it("runs an unclosed fence to the end rather than refusing the article", () => {
    expect(blocks("~~~\ntekst\n")).toEqual([{ type: "code", language: "", text: "tekst" }]);
  });

  it("reads a blockquote as blocks of its own, with the marker stripped", () => {
    expect(blocks("> citat\n> drugi red\n")).toEqual([
      { type: "quote", children: [{ type: "paragraph", children: [{ type: "text", value: "citat drugi red" }] }] },
    ]);
  });

  it("reads a thematic break, and not as a setext heading underline", () => {
    expect(blocks("tekst\n\n---\n\ndalje\n")[1]).toEqual({ type: "rule" });
  });

  it("reads a bullet list, and a nested one as blocks inside its item", () => {
    const [list] = blocks("- prvo\n- drugo\n  - unutra\n");
    expect(list?.type).toBe("list");
    if (list?.type !== "list") throw new Error("expected a list");
    expect(list.ordered).toBe(false);
    expect(list.items).toHaveLength(2);
    expect(list.items[0]?.[0]).toEqual({ type: "paragraph", children: [{ type: "text", value: "prvo" }] });
    expect(list.items[1]?.[1]).toMatchObject({ type: "list", ordered: false });
  });

  it("reads an ordered list from its own first number", () => {
    const [list] = blocks("3. trece\n4. cetvrto\n");
    expect(list).toMatchObject({ type: "list", ordered: true, start: 3 });
  });

  it("reads a pipe table with a delimiter row into cells", () => {
    const [table] = blocks("| lek | doza |\n| --- | --- |\n| kafa | 2 |\n");
    expect(table?.type).toBe("table");
    if (table?.type !== "table") throw new Error("expected a table");
    expect(table.head.map((cell) => cell.map(textOfInline).join(""))).toEqual(["lek", "doza"]);
    expect(table.rows.map((row) => row.map((cell) => cell.map(textOfInline).join("")))).toEqual([
      ["kafa", "2"],
    ]);
  });

  it("keeps an extra cell rather than dropping the text a drifted pack carries", () => {
    const [table] = blocks("| a | b |\n| --- | --- |\n| 1 | 2 | 3 |\n");
    if (table?.type !== "table") throw new Error("expected a table");
    expect(table.rows[0]?.map((cell) => cell.map(textOfInline).join(""))).toEqual(["1", "2", "3"]);
  });
});

describe("the inline subset", () => {
  it("reads emphasis, strong, code, links and images", () => {
    const [paragraph] = blocks(
      "**jako** i *nagnuto* i `kod` i [link](https://example.org/) i ![slika](slike/a.png)\n",
    );
    if (paragraph?.type !== "paragraph") throw new Error("expected a paragraph");
    expect(paragraph.children.map(inline)).toEqual([
      "**jako**",
      " i ",
      "*nagnuto*",
      " i ",
      "`kod`",
      " i ",
      "[link](https://example.org/)",
      " i ",
      "![slika](slike/a.png)",
    ]);
  });

  it("nests strong inside emphasis, and reads an underscore only at a word boundary", () => {
    const [paragraph] = blocks("*spolja **unutra** spolja*\n\nne_dirati_ovo\n");
    if (paragraph?.type !== "paragraph") throw new Error("expected a paragraph");
    expect(paragraph.children.map(inline)).toEqual(["*spolja **unutra** spolja*"]);
    const [second] = blocks("ne_dirati_ovo\n");
    if (second?.type !== "paragraph") throw new Error("expected a paragraph");
    expect(second.children.map(inline)).toEqual(["ne_dirati_ovo"]);
  });

  it("leaves a half-typed marker as its own text rather than swallowing the line", () => {
    const [paragraph] = blocks("cena je **10 i **20 dinara\n");
    if (paragraph?.type !== "paragraph") throw new Error("expected a paragraph");
    expect(paragraph.children.map(inline).join("")).toContain("dinara");
  });

  it("reads an autolink as a link and a backslash escape as its character", () => {
    const [paragraph] = blocks("<https://example.org/x> i \\*zvezda\\*\n");
    if (paragraph?.type !== "paragraph") throw new Error("expected a paragraph");
    // One text run, because the escaped asterisks are text: nothing re-enters the
    // emphasis branch on a character an escape produced.
    expect(paragraph.children.map(inline)).toEqual([
      "[https://example.org/x](https://example.org/x)",
      " i *zvezda*",
    ]);
  });

  it("marks http(s) targets external and a fragment or a pack path internal", () => {
    const [paragraph] = blocks("[a](https://example.org) [b](#odeljak) [c](poglavlje/dva.md)\n");
    if (paragraph?.type !== "paragraph") throw new Error("expected a paragraph");
    const links = paragraph.children.filter((node) => node.type === "link");
    expect(links.map((node) => (node.type === "link" ? node.external : null))).toEqual([true, false, false]);
  });
});

describe("what the parser refuses", () => {
  it("refuses raw HTML, naming the line", () => {
    const error = refusal("prvi red\n\n<script>alert(1)</script>\n");
    expect(error.refusal).toBe("raw-html");
    expect(error.line).toBe(3);
    // A comment and a doctype are the same rule: anything the renderer would
    // have to interpret as markup rather than as text.
    expect(refusal("<!-- skriveno -->\n").refusal).toBe("raw-html");
    expect(refusal("<!DOCTYPE html>\n").refusal).toBe("raw-html");
  });

  it("refuses a javascript: link rather than rendering it as text", () => {
    const error = refusal("vidi [ovde](javascript:alert(1)) za detalje\n");
    expect(error.refusal).toBe("unsafe-target");
    expect(error.line).toBe(1);
  });

  it("refuses a data:, file: or protocol-relative target, and an unsafe image", () => {
    for (const source of [
      "[a](data:text/html;base64,PHNjcmlwdD4=)\n",
      "[a](file:///C:/Windows/System32/calc.exe)\n",
      "[a](//example.org/x)\n",
      "![a](javascript:x)\n",
    ]) {
      expect(refusal(source).refusal, source).toBe("unsafe-target");
    }
  });

  it("answers the target rules as a predicate, so the page can ask the same question", () => {
    for (const allowed of ["https://example.org/x", "http://example.org", "#odeljak", "slike/a.png", "a.md"]) {
      expect(isAllowedTarget(allowed), allowed).toBe(true);
    }
    for (const refused of ["javascript:alert(1)", "data:text/html,x", "file:///c:/x", "//host/x", "", "  "]) {
      expect(isAllowedTarget(refused), refused).toBe(false);
    }
  });
});

describe("the plain text and the title a reader reads", () => {
  it("flattens the article to the text a search index holds", () => {
    const source = "# Naslov\n\nTelo sa **jako** recju.\n\n- prvo\n- drugo\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    expect(readerPlainText(blocks(source))).toBe(
      "Naslov\n\nTelo sa jako recju.\n\nprvo\ndrugo\n\na b\n1 2",
    );
  });

  it("reads the title from the first heading and nothing when there is none", () => {
    expect(readerTitleOf(blocks("uvod\n\n# Pravi naslov\n"))).toBe("Pravi naslov");
    expect(readerTitleOf(blocks("samo tekst\n"))).toBeNull();
  });
});
