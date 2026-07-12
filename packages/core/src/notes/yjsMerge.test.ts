import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { mergeNoteState } from "./yjsMerge.js";

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
