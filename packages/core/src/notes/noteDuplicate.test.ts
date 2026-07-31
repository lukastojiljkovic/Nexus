import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { duplicateNoteState } from "./noteDuplicate.js";

/** A `noteLink` inline atom, mirroring the TipTap wiki-link node's shape (ADR-013). */
function noteLink(noteId: string): Y.XmlElement {
  const link = new Y.XmlElement("noteLink");
  link.setAttribute("noteId", noteId);
  return link;
}

/** An `attachmentImage` block atom (ADR-014) — the reference a duplicate deliberately leaves alone. */
function attachmentImage(attachmentId: string): Y.XmlElement {
  const image = new Y.XmlElement("attachmentImage");
  image.setAttribute("attachmentId", attachmentId);
  return image;
}

/** Encodes a fresh `Y.Doc`'s full state as one update — what a note's stored snapshot holds. */
function encode(doc: Y.Doc): Uint8Array {
  const snapshot = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return snapshot;
}

/** A structural read of a state's "default" fragment: node names, attributes and text deltas, in document order. */
function structureOf(state: Uint8Array): unknown[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const read = (node: Y.XmlElement | Y.XmlText | Y.XmlHook): unknown => {
    if (node instanceof Y.XmlText) return { kind: "text", delta: node.toDelta() };
    if (node instanceof Y.XmlElement) {
      return {
        kind: "element",
        nodeName: node.nodeName,
        attributes: node.getAttributes(),
        children: node.toArray().map(read),
      };
    }
    return { kind: "hook" };
  };
  const structure = doc.getXmlFragment("default").toArray().map(read);
  doc.destroy();
  return structure;
}

/** Every `cardKey` in a state, in document order (duplicates included — uniqueness is what the tests assert). */
function cardKeysOf(state: Uint8Array): string[] {
  return attributesOf(state, "cardKey");
}

/** Every `noteId` a state's `noteLink` nodes carry, in document order. */
function linkTargetsOf(state: Uint8Array): string[] {
  return attributesOf(state, "noteId");
}

/** Every `attachmentId` a state's `attachmentImage` nodes carry, in document order. */
function attachmentIdsOf(state: Uint8Array): string[] {
  return attributesOf(state, "attachmentId");
}

function attributesOf(state: Uint8Array, attribute: string): string[] {
  const values: string[] = [];
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlHook): void => {
    if (!(node instanceof Y.XmlElement)) return;
    const value = node.getAttribute(attribute);
    if (typeof value === "string") values.push(value);
    for (const child of node.toArray()) walk(child);
  };
  for (const child of doc.getXmlFragment("default").toArray()) walk(child);
  doc.destroy();
  return values;
}

/** A counter-backed mint, so a test can assert exactly which fresh keys were handed out. */
function mintSequence(prefix = "fresh"): () => string {
  let next = 0;
  return () => `${prefix}-${(next += 1)}`;
}

/** One block carrying text, and optionally a `cardKey`. */
function block(nodeName: string, text: string, cardKey?: string): Y.XmlElement {
  const element = new Y.XmlElement(nodeName);
  element.insert(0, [new Y.XmlText(text)]);
  if (cardKey !== undefined) element.setAttribute("cardKey", cardKey);
  return element;
}

/** The house call shape: everything named, so a test reads as the decision it is checking. */
function duplicate(
  state: Uint8Array,
  overrides: Partial<Parameters<typeof duplicateNoteState>[1]> = {},
) {
  return duplicateNoteState(state, {
    sourceNoteId: "note-source",
    newNoteId: "note-copy",
    mintCardKey: mintSequence(),
    titleSuffix: " (kopija)",
    ...overrides,
  });
}

describe("duplicateNoteState — card keys", () => {
  it("re-mints every card key", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([
      block("paragraph", "Pitanje :: odgovor", "key-a"),
      block("heading", "Drugo :: drugo", "key-b"),
    ]);

    const { state } = duplicate(encode(doc));

    expect(cardKeysOf(state)).toEqual(["fresh-1", "fresh-2"]);
  });

  it("gives two blocks that shared one key two DIFFERENT fresh keys", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([
      block("paragraph", "Prvo :: prvo", "shared"),
      block("paragraph", "Drugo :: drugo", "shared"),
    ]);

    const keys = cardKeysOf(duplicate(encode(doc)).state);

    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it("re-mints a card key nested deep inside a list item", () => {
    const doc = new Y.Doc();
    const list = new Y.XmlElement("bulletList");
    const item = new Y.XmlElement("listItem");
    item.insert(0, [block("paragraph", "Duboko :: pitanje", "key-deep")]);
    list.insert(0, [item]);
    doc.getXmlFragment("default").push([block("paragraph", "Naslov"), list]);

    expect(cardKeysOf(duplicate(encode(doc)).state)).toEqual(["fresh-1"]);
  });

  it("leaves a codeBlock's stray key alone — code is never keyed off (collectNoteCards' own rule)", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([
      block("paragraph", "Naslov"),
      block("codeBlock", "std::vector<int> v;", "key-code"),
    ]);

    expect(cardKeysOf(duplicate(encode(doc)).state)).toEqual(["key-code"]);
  });

  it("leaves an empty-string card key alone rather than minting one for a block that has none", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([block("paragraph", "Obična linija", "")]);

    expect(cardKeysOf(duplicate(encode(doc)).state)).toEqual([""]);
  });

  it("mints nothing when the document authors no cards", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([block("paragraph", "Samo tekst")]);
    const mintCardKey = (): string => {
      throw new Error("the mint must not be called for a document with no card keys");
    };

    expect(() => duplicate(encode(doc), { mintCardKey })).not.toThrow();
  });
});

describe("duplicateNoteState — links and attachments", () => {
  it("repoints a self-link at the new note", () => {
    const doc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Naslov "), noteLink("note-source")]);
    doc.getXmlFragment("default").push([paragraph]);

    expect(linkTargetsOf(duplicate(encode(doc)).state)).toEqual(["note-copy"]);
  });

  it("leaves a link to another note exactly as it was", () => {
    const doc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Naslov "), noteLink("note-other")]);
    doc.getXmlFragment("default").push([paragraph]);

    expect(linkTargetsOf(duplicate(encode(doc)).state)).toEqual(["note-other"]);
  });

  it("repoints every self-link and leaves every foreign one, in one pass", () => {
    const doc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [
      new Y.XmlText("Naslov "),
      noteLink("note-source"),
      noteLink("note-other"),
      noteLink("note-source"),
    ]);
    doc.getXmlFragment("default").push([paragraph]);

    expect(linkTargetsOf(duplicate(encode(doc)).state)).toEqual([
      "note-copy",
      "note-other",
      "note-copy",
    ]);
  });

  it("repoints a self-link nested deep inside a blockquote inside a list item", () => {
    const doc = new Y.Doc();
    const list = new Y.XmlElement("bulletList");
    const item = new Y.XmlElement("listItem");
    const quote = new Y.XmlElement("blockquote");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [noteLink("note-source")]);
    quote.insert(0, [paragraph]);
    item.insert(0, [quote]);
    list.insert(0, [item]);
    doc.getXmlFragment("default").push([block("paragraph", "Naslov"), list]);

    expect(linkTargetsOf(duplicate(encode(doc)).state)).toEqual(["note-copy"]);
  });

  it("leaves every attachment reference untouched — the rows are remapped by the caller, not here", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([
      block("paragraph", "Naslov"),
      attachmentImage("att-1"),
      attachmentImage("att-2"),
    ]);

    expect(attachmentIdsOf(duplicate(encode(doc)).state)).toEqual(["att-1", "att-2"]);
  });
});

describe("duplicateNoteState — the document is otherwise identical", () => {
  it("changes nothing but the card keys, the self-link and the title suffix", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const heading = new Y.XmlElement("heading");
    const paragraph = new Y.XmlElement("paragraph");
    const boldText = new Y.XmlText();
    const link = noteLink("note-other");
    const image = attachmentImage("att-1");

    // Attach first: a `Y.XmlText`'s length is only well-defined once its
    // ancestry is integrated (the ceremony `yjsRestore.test.ts` documents).
    fragment.push([heading, paragraph, link, image]);
    heading.setAttribute("level", "2");
    heading.insert(0, [new Y.XmlText("Naslov")]);
    paragraph.insert(0, [boldText]);
    boldText.insert(0, "Podebljano", { bold: true });
    boldText.insert(boldText.length, " i obično");
    link.setAttribute("label", "Vidi belešku");

    const snapshot = encode(doc);
    const before = structureOf(snapshot);
    const after = structureOf(duplicate(snapshot).state);

    // The suffix lands at the end of the heading (the title block); nothing
    // else in the document may move.
    expect(JSON.stringify(after)).toBe(
      JSON.stringify(before).replace('"Naslov"', '"Naslov (kopija)"'),
    );
  });

  it("keeps the text of a document whose first block takes no suffix byte-for-byte", () => {
    const doc = new Y.Doc();
    const list = new Y.XmlElement("bulletList");
    const item = new Y.XmlElement("listItem");
    item.insert(0, [block("paragraph", "Prva stavka")]);
    list.insert(0, [item]);
    doc.getXmlFragment("default").push([list]);

    const snapshot = encode(doc);

    expect(structureOf(duplicate(snapshot).state)).toEqual(structureOf(snapshot));
  });
});

describe("duplicateNoteState — the copy's title", () => {
  it("appends the suffix to a leading heading, in the document", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([block("heading", "Sastanak"), block("paragraph", "Telo")]);

    const { state, title } = duplicate(encode(doc));

    expect(title).toBe("Sastanak (kopija)");
    expect(structureOf(state)).toEqual(structureOf(encode(buildDoc("heading", "Sastanak (kopija)", "Telo"))));
  });

  it("appends the suffix to a leading paragraph", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([block("paragraph", "Ideje"), block("paragraph", "Telo")]);

    expect(duplicate(encode(doc)).title).toBe("Ideje (kopija)");
  });

  it("skips leading blocks with no text, exactly as the editor's own derivation does", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([
      new Y.XmlElement("horizontalRule"),
      block("paragraph", "   "),
      block("paragraph", "Pravi naslov"),
    ]);

    expect(duplicate(encode(doc)).title).toBe("Pravi naslov (kopija)");
  });

  it("appends into the last text run, so the suffix reads as typed at the end of the line", () => {
    const doc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    doc.getXmlFragment("default").push([paragraph]);
    const text = new Y.XmlText();
    paragraph.insert(0, [text]);
    text.insert(0, "Naslov");

    const { state, title } = duplicate(encode(doc));

    expect(title).toBe("Naslov (kopija)");
    // One text run, not two: the suffix joined the run it follows.
    expect(structureOf(state)).toEqual([
      {
        kind: "element",
        nodeName: "paragraph",
        attributes: {},
        children: [{ kind: "text", delta: [{ insert: "Naslov (kopija)" }] }],
      },
    ]);
  });

  it("leaves a leading codeBlock alone and carries the suffix in the title only", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([block("codeBlock", "const x = 1;")]);

    const { state, title } = duplicate(encode(doc));

    expect(title).toBe("const x = 1; (kopija)");
    expect(structureOf(state)).toEqual(structureOf(encode(buildDoc("codeBlock", "const x = 1;"))));
  });

  it("leaves a leading list alone and carries the suffix in the title only", () => {
    const doc = new Y.Doc();
    const list = new Y.XmlElement("bulletList");
    const item = new Y.XmlElement("listItem");
    item.insert(0, [block("paragraph", "Prva stavka")]);
    list.insert(0, [item]);
    doc.getXmlFragment("default").push([list]);

    expect(duplicate(encode(doc)).title).toBe("Prva stavka (kopija)");
  });

  it("gives an empty document an empty title rather than a bare suffix", () => {
    const doc = new Y.Doc();

    const { state, title } = duplicate(encode(doc));

    expect(title).toBe("");
    expect(structureOf(state)).toEqual([]);
  });

  it("gives a document of blank blocks an empty title", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([block("paragraph", "  "), new Y.XmlElement("paragraph")]);

    expect(duplicate(encode(doc)).title).toBe("");
  });

  it("caps the title at 200 characters, suffix included", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([block("heading", "N".repeat(250))]);

    const { title } = duplicate(encode(doc));

    expect(title).toHaveLength(200);
    expect(title).toBe("N".repeat(200));
  });

  it("trims the derived title the way the editor does", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([block("heading", "  Naslov  ")]);

    expect(duplicate(encode(doc)).title).toBe("Naslov   (kopija)");
  });

  it("reads a title through its marks rather than around them", () => {
    const doc = new Y.Doc();
    const heading = new Y.XmlElement("heading");
    doc.getXmlFragment("default").push([heading]);
    const text = new Y.XmlText();
    heading.insert(0, [text]);
    text.insert(0, "Podebljano", { bold: true });

    expect(duplicate(encode(doc)).title).toBe("Podebljano (kopija)");
  });

  it("does not count a wiki-link's label as the title's own text (the editor's derivation does not either)", () => {
    const doc = new Y.Doc();
    const first = new Y.XmlElement("paragraph");
    const link = noteLink("note-other");
    first.insert(0, [link]);
    doc.getXmlFragment("default").push([first, block("paragraph", "Pravi naslov")]);
    link.setAttribute("label", "Vidi");

    expect(duplicate(encode(doc)).title).toBe("Pravi naslov (kopija)");
  });
});

/** A one-block (or two-block) document, for the "identical apart from the suffix" comparisons. */
function buildDoc(nodeName: string, text: string, second?: string): Y.Doc {
  const doc = new Y.Doc();
  const blocks = [block(nodeName, text)];
  if (second !== undefined) blocks.push(block("paragraph", second));
  doc.getXmlFragment("default").push(blocks);
  return doc;
}
