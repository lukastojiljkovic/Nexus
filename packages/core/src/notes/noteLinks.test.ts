import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { extractNoteLinkTargets, remapNoteState } from "./noteLinks.js";

/** A `noteLink` inline atom element, mirroring the TipTap wiki-link node's shape. */
function noteLink(noteId: string | null): Y.XmlElement {
  const link = new Y.XmlElement("noteLink");
  if (noteId !== null) link.setAttribute("noteId", noteId);
  return link;
}

/** An `attachmentImage` block atom element (ADR-014), the other id-bearing node a foreign import must rewrite. */
function attachmentImage(attachmentId: string | null): Y.XmlElement {
  const image = new Y.XmlElement("attachmentImage");
  if (attachmentId !== null) image.setAttribute("attachmentId", attachmentId);
  return image;
}

/** Encodes a fresh `Y.Doc`'s full state as one update — what a restore-side `.ydoc` file holds. */
function encode(doc: Y.Doc): Uint8Array {
  const snapshot = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return snapshot;
}

/** A structural read of a snapshot's "default" fragment: node names, attributes and formatted text deltas, in document order. */
function structureOf(snapshot: Uint8Array): unknown[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);
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

/** Every `attachmentId` attribute in the doc, in document order — `extractNoteLinkTargets`' twin for the other node. */
function attachmentIdsOf(snapshot: Uint8Array): string[] {
  const ids: string[] = [];
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);
  const walk = (node: Y.XmlElement | Y.XmlText | Y.XmlHook): void => {
    if (!(node instanceof Y.XmlElement)) return;
    if (node.nodeName === "attachmentImage") {
      const id = node.getAttribute("attachmentId");
      if (typeof id === "string") ids.push(id);
    }
    for (const child of node.toArray()) walk(child);
  };
  for (const child of doc.getXmlFragment("default").toArray()) walk(child);
  doc.destroy();
  return ids;
}

describe("extractNoteLinkTargets", () => {
  it("returns an empty array for an empty document", () => {
    const doc = new Y.Doc();
    expect(extractNoteLinkTargets(encode(doc))).toEqual([]);
  });

  it("collects one link", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Vidi "), noteLink("note-1"), new Y.XmlText(" ovde.")]);
    fragment.push([paragraph]);

    expect(extractNoteLinkTargets(encode(doc))).toEqual(["note-1"]);
  });

  it("collects several distinct links across separate blocks, in document order", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const first = new Y.XmlElement("paragraph");
    first.insert(0, [noteLink("note-a")]);
    const second = new Y.XmlElement("paragraph");
    second.insert(0, [noteLink("note-b"), noteLink("note-c")]);
    fragment.push([first, second]);

    expect(extractNoteLinkTargets(encode(doc))).toEqual(["note-a", "note-b", "note-c"]);
  });

  it("dedupes a repeated link, keeping first-appearance order", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const first = new Y.XmlElement("paragraph");
    first.insert(0, [noteLink("note-a"), noteLink("note-b")]);
    const second = new Y.XmlElement("paragraph");
    second.insert(0, [noteLink("note-b"), noteLink("note-a")]);
    fragment.push([first, second]);

    expect(extractNoteLinkTargets(encode(doc))).toEqual(["note-a", "note-b"]);
  });

  it("walks a noteLink nested deep inside a blockquote inside a list item", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const list = new Y.XmlElement("bulletList");
    const item = new Y.XmlElement("listItem");
    const quote = new Y.XmlElement("blockquote");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [noteLink("note-deep")]);
    quote.insert(0, [paragraph]);
    item.insert(0, [quote]);
    list.insert(0, [item]);
    fragment.push([list]);

    expect(extractNoteLinkTargets(encode(doc))).toEqual(["note-deep"]);
  });

  it("ignores a noteLink with a missing noteId attribute", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [noteLink(null), noteLink("note-real")]);
    fragment.push([paragraph]);

    expect(extractNoteLinkTargets(encode(doc))).toEqual(["note-real"]);
  });

  it("ignores a noteLink with an empty-string noteId attribute", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [noteLink(""), noteLink("note-real")]);
    fragment.push([paragraph]);

    expect(extractNoteLinkTargets(encode(doc))).toEqual(["note-real"]);
  });
});

describe("remapNoteState", () => {
  it("rewrites a noteLink's noteId through the map", () => {
    const doc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [noteLink("old-note")]);
    doc.getXmlFragment("default").push([paragraph]);

    const remapped = remapNoteState(encode(doc), new Map([["old-note", "new-note"]]));

    expect(extractNoteLinkTargets(remapped)).toEqual(["new-note"]);
  });

  it("rewrites an attachmentImage's attachmentId through the map", () => {
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([attachmentImage("old-att")]);

    const remapped = remapNoteState(encode(doc), new Map([["old-att", "new-att"]]));

    expect(attachmentIdsOf(remapped)).toEqual(["new-att"]);
  });

  it("leaves an id absent from the map exactly as it was", () => {
    const doc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [noteLink("stranger")]);
    doc.getXmlFragment("default").push([paragraph, attachmentImage("unknown-att")]);

    const remapped = remapNoteState(encode(doc), new Map([["someone-else", "irrelevant"]]));

    expect(extractNoteLinkTargets(remapped)).toEqual(["stranger"]);
    expect(attachmentIdsOf(remapped)).toEqual(["unknown-att"]);
  });

  it("rewrites some ids and leaves the rest, in one pass", () => {
    const doc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [noteLink("known"), noteLink("stranger")]);
    doc.getXmlFragment("default").push([paragraph]);

    const remapped = remapNoteState(encode(doc), new Map([["known", "known-new"]]));

    expect(extractNoteLinkTargets(remapped)).toEqual(["known-new", "stranger"]);
  });

  it("rewrites a noteLink nested deep inside a blockquote inside a list item", () => {
    const doc = new Y.Doc();
    const list = new Y.XmlElement("bulletList");
    const item = new Y.XmlElement("listItem");
    const quote = new Y.XmlElement("blockquote");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [noteLink("deep")]);
    quote.insert(0, [paragraph]);
    item.insert(0, [quote]);
    list.insert(0, [item]);
    doc.getXmlFragment("default").push([list]);

    const remapped = remapNoteState(encode(doc), new Map([["deep", "deep-new"]]));

    expect(extractNoteLinkTargets(remapped)).toEqual(["deep-new"]);
  });

  it("rewrites every occurrence of a repeated target", () => {
    const doc = new Y.Doc();
    const first = new Y.XmlElement("paragraph");
    first.insert(0, [noteLink("twice")]);
    const second = new Y.XmlElement("paragraph");
    second.insert(0, [noteLink("twice")]);
    doc.getXmlFragment("default").push([first, second]);

    const remapped = remapNoteState(encode(doc), new Map([["twice", "twice-new"]]));
    const readBack = new Y.Doc();
    Y.applyUpdate(readBack, remapped);
    const ids: string[] = [];
    for (const block of readBack.getXmlFragment("default").toArray()) {
      if (!(block instanceof Y.XmlElement)) continue;
      for (const child of block.toArray()) {
        if (child instanceof Y.XmlElement && child.nodeName === "noteLink") {
          const id = child.getAttribute("noteId");
          if (typeof id === "string") ids.push(id);
        }
      }
    }
    readBack.destroy();

    expect(ids).toEqual(["twice-new", "twice-new"]);
  });

  it("leaves everything that is not one of the two id attributes untouched", () => {
    // Every node shape a note's document can hold — a heading with its own
    // attribute, a formatted text run, and the two id-bearing atoms, one of
    // which also carries a `label` the rewrite must not touch.
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const heading = new Y.XmlElement("heading");
    const paragraph = new Y.XmlElement("paragraph");
    const boldText = new Y.XmlText();
    const link = noteLink("old-note");
    const image = attachmentImage("old-att");

    // Attach first: `boldText.length` is only well-defined once its ancestry is
    // integrated (the ceremony `yjsRestore.test.ts` documents).
    fragment.push([heading, paragraph, link, image]);
    paragraph.insert(0, [boldText]);
    heading.setAttribute("level", "2");
    heading.insert(0, [new Y.XmlText("Naslov")]);
    boldText.insert(0, "Podebljano", { bold: true });
    boldText.insert(boldText.length, " i obično");
    link.setAttribute("label", "Vidi belešku");

    const snapshot = encode(doc);
    const before = structureOf(snapshot);
    const after = structureOf(
      remapNoteState(
        snapshot,
        new Map([
          ["old-note", "new-note"],
          ["old-att", "new-att"],
        ]),
      ),
    );

    // Identical in every respect except the two ids — asserted by rewriting the
    // "before" structure the same way and demanding an exact match.
    expect(after).toEqual(
      JSON.parse(
        JSON.stringify(before).replaceAll('"old-note"', '"new-note"').replaceAll('"old-att"', '"new-att"'),
      ),
    );
  });

  it("never reads a noteId off a non-noteLink node, nor an attachmentId off a non-attachmentImage node", () => {
    const doc = new Y.Doc();
    const impostor = new Y.XmlElement("paragraph");
    doc.getXmlFragment("default").push([impostor]);
    impostor.setAttribute("noteId", "old-note");
    impostor.setAttribute("attachmentId", "old-att");

    const remapped = remapNoteState(
      encode(doc),
      new Map([
        ["old-note", "new-note"],
        ["old-att", "new-att"],
      ]),
    );

    const readBack = new Y.Doc();
    Y.applyUpdate(readBack, remapped);
    const first = readBack.getXmlFragment("default").get(0);
    const attributes = first instanceof Y.XmlElement ? first.getAttributes() : {};
    readBack.destroy();

    expect(attributes).toEqual({ noteId: "old-note", attachmentId: "old-att" });
  });

  it("tolerates an id-bearing node that carries no id attribute at all", () => {
    const doc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [noteLink(null)]);
    doc.getXmlFragment("default").push([paragraph, attachmentImage(null)]);

    const remapped = remapNoteState(encode(doc), new Map([["old-note", "new-note"]]));

    expect(extractNoteLinkTargets(remapped)).toEqual([]);
    expect(attachmentIdsOf(remapped)).toEqual([]);
  });

  it("returns decodable state for an empty document and an empty map", () => {
    const doc = new Y.Doc();
    expect(extractNoteLinkTargets(remapNoteState(encode(doc), new Map()))).toEqual([]);
  });
});
