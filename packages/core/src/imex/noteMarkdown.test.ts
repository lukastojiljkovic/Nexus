import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { renderNoteMarkdown, type NoteMarkdownContext } from "./noteMarkdown.js";

/** A fresh doc whose "default" fragment holds the given top-level blocks, in order (mirrors yjsMerge.test.ts / noteCards.test.ts). */
function docWithBlocks(...blocks: Y.XmlElement[]): Y.Doc {
  const doc = new Y.Doc();
  doc.getXmlFragment("default").push(blocks);
  return doc;
}

/** Encodes `doc`'s full state as a snapshot and destroys it — the doc is single-use per test. */
function snapshotOf(doc: Y.Doc): Uint8Array {
  const snapshot = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return snapshot;
}

const EMPTY_CONTEXT: NoteMarkdownContext = { attachments: new Map(), rootPrefix: "../" };

function markdownOf(doc: Y.Doc, context: NoteMarkdownContext = EMPTY_CONTEXT): string {
  return renderNoteMarkdown(snapshotOf(doc), context);
}

/** A paragraph with a single plain-text run, or no children at all when `text` is empty. */
function paragraph(text: string): Y.XmlElement {
  const el = new Y.XmlElement("paragraph");
  if (text.length > 0) el.insert(0, [new Y.XmlText(text)]);
  return el;
}

/**
 * `Y.XmlElement`'s TS generic defaults every attribute's declared type to
 * `string`, but the real editor also stores `level`/`start` as numbers and
 * `checked` as a boolean — exactly the coercion `noteMarkdown.ts` is built to
 * handle, so the fixtures below need to carry a genuine (non-string) runtime
 * value. The cast is compile-time only: it does not touch the value, so the
 * real number/boolean still round-trips through `getAttribute` unchanged.
 */
function setRawAttribute(el: Y.XmlElement, name: string, value: number | string | boolean): void {
  el.setAttribute(name, value as unknown as string);
}

function heading(level: number | string, text: string): Y.XmlElement {
  const el = new Y.XmlElement("heading");
  setRawAttribute(el, "level", level);
  el.insert(0, [new Y.XmlText(text)]);
  return el;
}

function bulletList(...items: Y.XmlElement[]): Y.XmlElement {
  const el = new Y.XmlElement("bulletList");
  el.insert(0, items);
  return el;
}

function orderedList(start: number | string, ...items: Y.XmlElement[]): Y.XmlElement {
  const el = new Y.XmlElement("orderedList");
  setRawAttribute(el, "start", start);
  el.insert(0, items);
  return el;
}

function listItem(...blocks: Y.XmlElement[]): Y.XmlElement {
  const el = new Y.XmlElement("listItem");
  el.insert(0, blocks);
  return el;
}

function taskList(...items: Y.XmlElement[]): Y.XmlElement {
  const el = new Y.XmlElement("taskList");
  el.insert(0, items);
  return el;
}

function taskItem(checked: boolean | string, ...blocks: Y.XmlElement[]): Y.XmlElement {
  const el = new Y.XmlElement("taskItem");
  setRawAttribute(el, "checked", checked);
  el.insert(0, blocks);
  return el;
}

function blockquote(...blocks: Y.XmlElement[]): Y.XmlElement {
  const el = new Y.XmlElement("blockquote");
  el.insert(0, blocks);
  return el;
}

function codeBlock(text: string, language?: string): Y.XmlElement {
  const el = new Y.XmlElement("codeBlock");
  if (language !== undefined) el.setAttribute("language", language);
  if (text.length > 0) el.insert(0, [new Y.XmlText(text)]);
  return el;
}

function noteLink(label: string, noteId = "note-1"): Y.XmlElement {
  const el = new Y.XmlElement("noteLink");
  el.setAttribute("noteId", noteId);
  el.setAttribute("label", label);
  return el;
}

/** One run of marked text: the text, and the marks a real editor would have written over it. */
interface MarkedRun {
  text: string;
  marks?: Record<string, unknown>;
}

/** Every mark used across the fixtures below, explicitly unset — see `markedParagraphDoc`'s doc comment. */
const NO_MARKS = { bold: null, italic: null, code: null, link: null };

/**
 * A doc holding one paragraph whose text is assembled from marked runs. The
 * element and an empty placeholder `Y.XmlText` are wired into the full tree
 * and attached to the doc BEFORE any insert/format call runs on the text —
 * required so the sequential ops land in the given order rather than all
 * queuing at offset 0, in reverse (the same precaution yjsMerge.test.ts and
 * noteCards.test.ts take: an unintegrated `Y.XmlText`'s pending ops replay in
 * reverse once it is integrated).
 *
 * A run with no `marks` is inserted with every known mark explicitly unset
 * (`null`), not simply omitted — `Y.XmlText.insert` otherwise INHERITS the
 * immediately preceding run's formatting for unformatted text appended right
 * after it (confirmed against yjs's own `toDelta()` output), which a real
 * editor's mark-tracking never lets happen but a hand-built fixture must
 * guard against explicitly.
 */
function markedParagraphDoc(runs: readonly MarkedRun[]): Y.Doc {
  const doc = new Y.Doc();
  const el = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  el.insert(0, [text]);
  doc.getXmlFragment("default").push([el]);

  for (const run of runs) {
    text.insert(text.length, run.text, run.marks ?? NO_MARKS);
  }
  return doc;
}

describe("renderNoteMarkdown — document and paragraphs", () => {
  it("renders an empty document as an empty string", () => {
    expect(markdownOf(new Y.Doc())).toBe("");
  });

  it("joins paragraphs with a blank line", () => {
    const doc = docWithBlocks(paragraph("Prvi"), paragraph("Drugi"));
    expect(markdownOf(doc)).toBe("Prvi\n\nDrugi\n");
  });

  it("produces no block for an empty paragraph between two non-empty ones", () => {
    const doc = docWithBlocks(paragraph("Prvi"), paragraph(""), paragraph("Drugi"));
    expect(markdownOf(doc)).toBe("Prvi\n\nDrugi\n");
  });
});

describe("renderNoteMarkdown — headings", () => {
  it("renders headings at levels 1-3 with the matching number of #s", () => {
    const doc = docWithBlocks(heading(1, "Jedan"), heading(2, "Dva"), heading(3, "Tri"));
    expect(markdownOf(doc)).toBe("# Jedan\n\n## Dva\n\n### Tri\n");
  });

  it("clamps an out-of-range heading level down to 6", () => {
    const doc = docWithBlocks(heading(9, "Previse"));
    expect(markdownOf(doc)).toBe("###### Previse\n");
  });

  it("clamps an out-of-range heading level up to 1", () => {
    const doc = docWithBlocks(heading(0, "Premalo"));
    expect(markdownOf(doc)).toBe("# Premalo\n");
  });

  it("coerces a string-typed level attribute", () => {
    const doc = docWithBlocks(heading("2", "Dva"));
    expect(markdownOf(doc)).toBe("## Dva\n");
  });
});

describe("renderNoteMarkdown — inline marks", () => {
  it("renders bold, italic, code and link marks, including a bold+italic combination", () => {
    const doc = markedParagraphDoc([
      { text: "obicno " },
      { text: "podebljano", marks: { bold: {} } },
      { text: " " },
      { text: "kurziv", marks: { italic: {} } },
      { text: " " },
      { text: "kod", marks: { code: {} } },
      { text: " " },
      { text: "veza", marks: { link: { href: "https://example.com" } } },
      { text: " " },
      { text: "sve", marks: { bold: {}, italic: {} } },
    ]);
    expect(markdownOf(doc)).toBe(
      "obicno **podebljano** *kurziv* `kod` [veza](https://example.com) ***sve***\n",
    );
  });

  it("wraps a link href containing a space in angle brackets", () => {
    const doc = markedParagraphDoc([
      { text: "otvori", marks: { link: { href: "https://example.com/a b" } } },
    ]);
    expect(markdownOf(doc)).toBe("[otvori](<https://example.com/a b>)\n");
  });

  it("pads inline code with a space when the text itself starts or ends with a backtick", () => {
    const doc = markedParagraphDoc([{ text: "`cmd`", marks: { code: {} } }]);
    expect(markdownOf(doc)).toBe("`` `cmd` ``\n");
  });

  it("never leaks toString()'s pseudo-XML mark tags into the rendered text", () => {
    const doc = markedParagraphDoc([
      { text: "vazan", marks: { bold: {} } },
      { text: " " },
      { text: "sastanak", marks: { italic: {} } },
    ]);
    const md = markdownOf(doc);
    expect(md).not.toContain("<bold>");
    expect(md).not.toContain("<italic>");
    expect(md).toBe("**vazan** *sastanak*\n");
  });
});

describe("renderNoteMarkdown — lists", () => {
  it("renders a bullet list", () => {
    const doc = docWithBlocks(bulletList(listItem(paragraph("mleko")), listItem(paragraph("hleb"))));
    expect(markdownOf(doc)).toBe("- mleko\n- hleb\n");
  });

  it("renders an ordered list counting from its start attribute", () => {
    const doc = docWithBlocks(
      orderedList(3, listItem(paragraph("prvo")), listItem(paragraph("drugo"))),
    );
    expect(markdownOf(doc)).toBe("3. prvo\n4. drugo\n");
  });

  it("indents a nested list's lines past its parent item's marker", () => {
    const doc = docWithBlocks(
      bulletList(listItem(paragraph("spoljna"), bulletList(listItem(paragraph("unutrasnja"))))),
    );
    // The blank line separating the item's two blocks stays bare — no
    // continuation indent, so the file carries no trailing whitespace.
    expect(markdownOf(doc)).toBe("- spoljna\n\n  - unutrasnja\n");
  });

  it("renders a task list with checked and unchecked items", () => {
    const doc = docWithBlocks(
      taskList(taskItem(true, paragraph("uradjeno")), taskItem(false, paragraph("nije"))),
    );
    expect(markdownOf(doc)).toBe("- [x] uradjeno\n- [ ] nije\n");
  });

  it("treats the string \"true\" the same as boolean true for checked", () => {
    const doc = docWithBlocks(taskList(taskItem("true", paragraph("uradjeno"))));
    expect(markdownOf(doc)).toBe("- [x] uradjeno\n");
  });
});

describe("renderNoteMarkdown — blockquote and code", () => {
  it("renders a blockquote's two paragraphs with an empty '>' line between them", () => {
    const doc = docWithBlocks(blockquote(paragraph("Prvi citat"), paragraph("Drugi citat")));
    expect(markdownOf(doc)).toBe("> Prvi citat\n>\n> Drugi citat\n");
  });

  it("renders a fenced code block with its language, unescaped", () => {
    const doc = docWithBlocks(codeBlock("const x = 1;", "ts"));
    expect(markdownOf(doc)).toBe("```ts\nconst x = 1;\n```\n");
  });

  it("lengthens the fence past a triple-backtick line inside the code", () => {
    const doc = docWithBlocks(codeBlock("before\n```\nafter"));
    expect(markdownOf(doc)).toBe("````\nbefore\n```\nafter\n````\n");
  });

  it("renders a horizontal rule", () => {
    const doc = docWithBlocks(new Y.XmlElement("horizontalRule"), paragraph("posle"));
    expect(markdownOf(doc)).toBe("---\n\nposle\n");
  });
});

describe("renderNoteMarkdown — hardBreak and wiki-links", () => {
  it("renders a hardBreak as a backslash-newline inside a paragraph", () => {
    const el = new Y.XmlElement("paragraph");
    el.insert(0, [new Y.XmlText("Prva"), new Y.XmlElement("hardBreak"), new Y.XmlText("druga")]);
    const doc = docWithBlocks(el);
    expect(markdownOf(doc)).toBe("Prva\\\ndruga\n");
  });

  it("renders a noteLink as a wiki-link", () => {
    const el = new Y.XmlElement("paragraph");
    el.insert(0, [new Y.XmlText("Vidi "), noteLink("Moja beleska"), new Y.XmlText(" ovde.")]);
    const doc = docWithBlocks(el);
    expect(markdownOf(doc)).toBe("Vidi [[Moja beleska]] ovde.\n");
  });

  it("falls back to escaped text for a wiki-link label containing ]", () => {
    const el = new Y.XmlElement("paragraph");
    el.insert(0, [noteLink("Naslov]cudan")]);
    const doc = docWithBlocks(el);
    expect(markdownOf(doc)).toBe("Naslov\\]cudan\n");
  });
});

describe("renderNoteMarkdown — attachment images", () => {
  it("renders an attachment image via the context's map and rootPrefix", () => {
    const attachmentEl = new Y.XmlElement("attachmentImage");
    attachmentEl.setAttribute("attachmentId", "att-1");
    const doc = docWithBlocks(attachmentEl);
    const context: NoteMarkdownContext = {
      attachments: new Map([["att-1", { fileName: "slika.png", sha256: "abc123" }]]),
      rootPrefix: "../../",
    };
    expect(markdownOf(doc, context)).toBe("![slika.png](../../blobs/abc123)\n");
  });

  it("renders nothing for an attachment image whose id is not in the context map", () => {
    const attachmentEl = new Y.XmlElement("attachmentImage");
    attachmentEl.setAttribute("attachmentId", "missing");
    const doc = docWithBlocks(paragraph("pre"), attachmentEl, paragraph("posle"));
    expect(markdownOf(doc)).toBe("pre\n\nposle\n");
  });
});

describe("renderNoteMarkdown — text escaping", () => {
  it("escapes *, [ and ], and only escapes _ at a word boundary", () => {
    const doc = docWithBlocks(paragraph("a*b [c] snake_case _emphasis_ end"));
    expect(markdownOf(doc)).toBe("a\\*b \\[c\\] snake_case \\_emphasis\\_ end\n");
  });

  it("escapes a paragraph line beginning with a heading-like #", () => {
    const doc = docWithBlocks(paragraph("# ne naslov"));
    expect(markdownOf(doc)).toBe("\\# ne naslov\n");
  });

  it("escapes a paragraph line beginning with an ordered-list-like digit-dot, backslashing the dot", () => {
    // Not `\1.` — CommonMark only honours a backslash before ASCII
    // punctuation, so that would render the backslash itself.
    const doc = docWithBlocks(paragraph("1. nije lista"));
    expect(markdownOf(doc)).toBe("1\\. nije lista\n");
  });

  it("escapes a paragraph line beginning with a list-like dash", () => {
    const doc = docWithBlocks(paragraph("- nije stavka"));
    expect(markdownOf(doc)).toBe("\\- nije stavka\n");
  });
});

describe("renderNoteMarkdown — unknown elements", () => {
  it("recurses into an unknown block element's children without fusing sibling blocks", () => {
    const wrapper = new Y.XmlElement("mysteryBlock");
    wrapper.insert(0, [paragraph("unutra")]);
    const doc = docWithBlocks(paragraph("pre"), wrapper, paragraph("posle"));
    expect(markdownOf(doc)).toBe("pre\n\nunutra\n\nposle\n");
  });
});
