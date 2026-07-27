import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { collectNoteLinkIds, mergeNoteState } from "./yjsMerge.js";

/** A fresh doc whose "default" fragment holds one paragraph per given text. */
function docWithParagraphs(...texts: string[]): Y.Doc {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");
  for (const text of texts) {
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText(text)]);
    fragment.push([paragraph]);
  }
  return doc;
}

/** The full state of `doc` as one Yjs update — what a snapshot or a single big update looks like. */
function encode(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/** Plaintext of a doc's "default" fragment through `mergeNoteState` itself (single source of the walk). */
function plaintextOf(doc: Y.Doc): string {
  return mergeNoteState(null, [encode(doc)]).plaintext;
}

describe("mergeNoteState", () => {
  it("returns an empty snapshot and empty plaintext for no inputs", () => {
    const merged = mergeNoteState(null, []);
    expect(merged.plaintext).toBe("");
    // The empty snapshot must itself be a valid update: applying it is a no-op.
    const doc = new Y.Doc();
    expect(() => Y.applyUpdate(doc, merged.snapshot)).not.toThrow();
    expect(doc.getXmlFragment("default").length).toBe(0);
  });

  it("merges a snapshot alone", () => {
    const source = docWithParagraphs("Prvi red");
    const merged = mergeNoteState(encode(source), []);
    expect(merged.plaintext).toBe("Prvi red");
  });

  it("merges updates alone, in order", () => {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on("update", (update: Uint8Array) => updates.push(update));

    const fragment = doc.getXmlFragment("default");
    const first = new Y.XmlElement("paragraph");
    first.insert(0, [new Y.XmlText("Jedan")]);
    fragment.push([first]);
    const second = new Y.XmlElement("paragraph");
    second.insert(0, [new Y.XmlText("Dva")]);
    fragment.push([second]);

    expect(updates.length).toBeGreaterThanOrEqual(2);
    const merged = mergeNoteState(null, updates);
    expect(merged.plaintext).toBe("Jedan\nDva");
  });

  it("merges snapshot + updates to the same state as a doc built directly", () => {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on("update", (update: Uint8Array) => updates.push(update));

    const fragment = doc.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Osnova")]);
    fragment.push([paragraph]);

    const snapshot = encode(doc); // covers everything so far
    updates.length = 0; // updates after the snapshot only

    const more = new Y.XmlElement("paragraph");
    more.insert(0, [new Y.XmlText("Nastavak")]);
    fragment.push([more]);

    const merged = mergeNoteState(snapshot, updates);
    expect(merged.plaintext).toBe("Osnova\nNastavak");

    // Byte-for-byte the same encoded state as the doc that was edited directly.
    expect(merged.snapshot).toEqual(encode(doc));
  });

  it("derives plaintext from a multi-block fragment, one line per top-level block", () => {
    const doc = docWithParagraphs("Naslov", "Pasus jedan", "Pasus dva");
    expect(plaintextOf(doc)).toBe("Naslov\nPasus jedan\nPasus dva");
  });

  it("walks nested elements recursively when deriving plaintext", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const list = new Y.XmlElement("bulletList");
    const item = new Y.XmlElement("listItem");
    const inner = new Y.XmlElement("paragraph");
    inner.insert(0, [new Y.XmlText("Stavka")]);
    item.insert(0, [inner]);
    list.insert(0, [item]);
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Kraj")]);
    fragment.push([list, paragraph]);

    expect(plaintextOf(doc)).toBe("Stavka\nKraj");
  });

  it("derives marked text with no pseudo-XML mark tags leaking in", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    paragraph.insert(0, [text]);
    fragment.push([paragraph]);
    // A Y.XmlText must be integrated into the doc before `.length` reflects
    // real content — otherwise these three inserts all queue at index 0
    // (pending until integration) and land in reverse order.
    text.insert(0, "važan", { bold: {} });
    text.insert(text.length, " sastanak", { italic: {} });
    text.insert(text.length, " kod", { code: {} });

    expect(plaintextOf(doc)).toBe("važan sastanak kod");
  });

  it("derives a link's text with no <link> wrapper", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, "otvori vezu", { link: { href: "https://example.com" } });
    paragraph.insert(0, [text]);
    fragment.push([paragraph]);

    expect(plaintextOf(doc)).toBe("otvori vezu");
  });

  it("derives a bulletList's listItems as three separate lines, not fused", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const list = new Y.XmlElement("bulletList");
    const items = ["mleko", "hleb", "jaja"].map((word) => {
      const item = new Y.XmlElement("listItem");
      const paragraph = new Y.XmlElement("paragraph");
      paragraph.insert(0, [new Y.XmlText(word)]);
      item.insert(0, [paragraph]);
      return item;
    });
    list.insert(0, items);
    fragment.push([list]);

    expect(plaintextOf(doc)).toBe("mleko\nhleb\njaja");
  });

  it("derives a blockquote's two paragraphs as two separate lines", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const quote = new Y.XmlElement("blockquote");
    const first = new Y.XmlElement("paragraph");
    first.insert(0, [new Y.XmlText("Prvi citat")]);
    const second = new Y.XmlElement("paragraph");
    second.insert(0, [new Y.XmlText("Drugi citat")]);
    quote.insert(0, [first, second]);
    fragment.push([quote]);

    expect(plaintextOf(doc)).toBe("Prvi citat\nDrugi citat");
  });

  it("derives hardBreak as a newline, not fusing the words on either side", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [
      new Y.XmlText("Prva"),
      new Y.XmlElement("hardBreak"),
      new Y.XmlText("druga"),
    ]);
    fragment.push([paragraph]);

    expect(plaintextOf(doc)).toBe("Prva\ndruga");
  });

  it("derives a noteLink's label as part of its surrounding paragraph's line", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    const link = new Y.XmlElement("noteLink");
    link.setAttribute("noteId", "note-1");
    link.setAttribute("label", "Moja beleška");
    paragraph.insert(0, [new Y.XmlText("Vidi "), link, new Y.XmlText(" ovde.")]);
    fragment.push([paragraph]);

    expect(plaintextOf(doc)).toBe("Vidi Moja beleška ovde.");
  });

  it("derives an attachmentImage block as contributing no text", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const before = new Y.XmlElement("paragraph");
    before.insert(0, [new Y.XmlText("Pre slike")]);
    const image = new Y.XmlElement("attachmentImage");
    image.setAttribute("attachmentId", "att-1");
    const after = new Y.XmlElement("paragraph");
    after.insert(0, [new Y.XmlText("Posle slike")]);
    fragment.push([before, image, after]);

    expect(plaintextOf(doc)).toBe("Pre slike\nPosle slike");
  });

  it("produces no blank line for an empty paragraph between two non-empty ones", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const first = new Y.XmlElement("paragraph");
    first.insert(0, [new Y.XmlText("Prvi")]);
    const empty = new Y.XmlElement("paragraph"); // no children at all
    const second = new Y.XmlElement("paragraph");
    second.insert(0, [new Y.XmlText("Drugi")]);
    fragment.push([first, empty, second]);

    expect(plaintextOf(doc)).toBe("Prvi\nDrugi");
  });

  it("returns a merged snapshot that is itself re-applicable (round-trip)", () => {
    const source = docWithParagraphs("A", "B");
    const merged = mergeNoteState(encode(source), []);

    const again = mergeNoteState(merged.snapshot, []);
    expect(again.plaintext).toBe("A\nB");
    expect(again.snapshot).toEqual(merged.snapshot);
  });

  it("converges regardless of concurrent-update arrival order", () => {
    // Two peers start from the same base and edit concurrently.
    const base = docWithParagraphs("Baza");
    const baseState = encode(base);

    const peerA = new Y.Doc();
    Y.applyUpdate(peerA, baseState);
    const peerB = new Y.Doc();
    Y.applyUpdate(peerB, baseState);

    const updatesA: Uint8Array[] = [];
    peerA.on("update", (update: Uint8Array) => updatesA.push(update));
    const updatesB: Uint8Array[] = [];
    peerB.on("update", (update: Uint8Array) => updatesB.push(update));

    const fromA = new Y.XmlElement("paragraph");
    fromA.insert(0, [new Y.XmlText("Od A")]);
    peerA.getXmlFragment("default").push([fromA]);

    const fromB = new Y.XmlElement("paragraph");
    fromB.insert(0, [new Y.XmlText("Od B")]);
    peerB.getXmlFragment("default").push([fromB]);

    const abOrder = mergeNoteState(baseState, [...updatesA, ...updatesB]);
    const baOrder = mergeNoteState(baseState, [...updatesB, ...updatesA]);

    expect(abOrder.plaintext).toBe(baOrder.plaintext);
    expect(abOrder.plaintext).toContain("Baza");
    expect(abOrder.plaintext).toContain("Od A");
    expect(abOrder.plaintext).toContain("Od B");
    // The two merge orders converge to the same encoded state.
    const docAb = new Y.Doc();
    Y.applyUpdate(docAb, abOrder.snapshot);
    const docBa = new Y.Doc();
    Y.applyUpdate(docBa, baOrder.snapshot);
    expect(Y.encodeStateVector(docAb)).toEqual(Y.encodeStateVector(docBa));
  });
});

/** A `noteLink` inline atom element, mirroring the TipTap wiki-link node's shape. */
function noteLink(noteId: string | null): Y.XmlElement {
  const link = new Y.XmlElement("noteLink");
  if (noteId !== null) link.setAttribute("noteId", noteId);
  return link;
}

describe("collectNoteLinkIds", () => {
  it("returns an empty array for a doc with no fragment content", () => {
    const doc = new Y.Doc();
    expect(collectNoteLinkIds(doc)).toEqual([]);
  });

  it("returns an empty array when the default fragment has content but no links", () => {
    const doc = docWithParagraphs("Obična beleška bez veza.");
    expect(collectNoteLinkIds(doc)).toEqual([]);
  });

  it("collects a noteLink nested inline inside a paragraph", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Vidi "), noteLink("note-1"), new Y.XmlText(" ovde.")]);
    fragment.push([paragraph]);

    expect(collectNoteLinkIds(doc)).toEqual(["note-1"]);
  });

  it("collects a noteLink nested inside a list item's paragraph", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const list = new Y.XmlElement("bulletList");
    const item = new Y.XmlElement("listItem");
    const inner = new Y.XmlElement("paragraph");
    inner.insert(0, [noteLink("note-nested")]);
    item.insert(0, [inner]);
    list.insert(0, [item]);
    fragment.push([list]);

    expect(collectNoteLinkIds(doc)).toEqual(["note-nested"]);
  });

  it("dedupes repeated links, keeping first-seen document order", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const first = new Y.XmlElement("paragraph");
    first.insert(0, [noteLink("note-a"), noteLink("note-b")]);
    const second = new Y.XmlElement("paragraph");
    second.insert(0, [noteLink("note-b"), noteLink("note-a"), noteLink("note-c")]);
    fragment.push([first, second]);

    expect(collectNoteLinkIds(doc)).toEqual(["note-a", "note-b", "note-c"]);
  });

  it("ignores noteLink elements without a noteId attribute", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [noteLink(null), noteLink("note-real")]);
    fragment.push([paragraph]);

    expect(collectNoteLinkIds(doc)).toEqual(["note-real"]);
  });

  it("preserves document order across multiple top-level blocks", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const first = new Y.XmlElement("paragraph");
    first.insert(0, [noteLink("note-z")]);
    const second = new Y.XmlElement("paragraph");
    second.insert(0, [noteLink("note-y")]);
    const third = new Y.XmlElement("paragraph");
    third.insert(0, [noteLink("note-x")]);
    fragment.push([first, second, third]);

    expect(collectNoteLinkIds(doc)).toEqual(["note-z", "note-y", "note-x"]);
  });
});
