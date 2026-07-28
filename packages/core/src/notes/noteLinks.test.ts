import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { extractNoteLinkTargets } from "./noteLinks.js";

/** A `noteLink` inline atom element, mirroring the TipTap wiki-link node's shape. */
function noteLink(noteId: string | null): Y.XmlElement {
  const link = new Y.XmlElement("noteLink");
  if (noteId !== null) link.setAttribute("noteId", noteId);
  return link;
}

/** Encodes a fresh `Y.Doc`'s full state as one update — what a restore-side `.ydoc` file holds. */
function encode(doc: Y.Doc): Uint8Array {
  const snapshot = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return snapshot;
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
