import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { replaceNoteContent } from "./yjsRestore.js";

/** A fresh doc whose "default" fragment holds one plain paragraph per given text. */
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

/**
 * A version doc exercising every node shape restore must survive: a heading
 * (element attribute), a paragraph holding a formatted `Y.XmlText` (bold
 * mark), and the two ADR-013/ADR-014 inline atoms — `noteLink` and
 * `attachmentImage` — each carrying their own attribute.
 */
function buildVersionDoc(): Y.Doc {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");

  const heading = new Y.XmlElement("heading");
  const paragraph = new Y.XmlElement("paragraph");
  const boldText = new Y.XmlText();
  const noteLink = new Y.XmlElement("noteLink");
  const attachmentImage = new Y.XmlElement("attachmentImage");

  // Integrate the tree into the doc first — `boldText.length` below is only
  // well-defined once its ancestry is attached (Yjs warns on a premature read
  // otherwise, even though prelim content makes the write itself safe).
  fragment.push([heading, paragraph, noteLink, attachmentImage]);
  paragraph.insert(0, [boldText]);

  heading.setAttribute("level", "1");
  heading.insert(0, [new Y.XmlText("Naslov verzije")]);

  boldText.insert(0, "Podebljano", { bold: true });
  boldText.insert(boldText.length, " i obično");

  noteLink.setAttribute("noteId", "note-xyz");
  attachmentImage.setAttribute("attachmentId", "att-abc");

  return doc;
}

/** A structural snapshot of one XML node: node name, attributes, and (for text) its formatted delta. */
function snapshotNode(node: Y.XmlElement | Y.XmlText | Y.XmlHook): unknown {
  if (node instanceof Y.XmlText) {
    return { kind: "text", delta: node.toDelta() };
  }
  if (node instanceof Y.XmlElement) {
    return {
      kind: "element",
      nodeName: node.nodeName,
      attributes: node.getAttributes(),
      children: node.toArray().map(snapshotNode),
    };
  }
  return { kind: "hook", hookName: node.hookName };
}

/** A structural snapshot of a whole fragment's children, for deep content comparisons. */
function snapshotFragment(fragment: Y.XmlFragment): unknown[] {
  return fragment.toArray().map(snapshotNode);
}

describe("replaceNoteContent", () => {
  it("rewrites the live fragment to deep-match the version's node names, attributes, and text formatting", () => {
    const versionDoc = buildVersionDoc();
    const versionSnapshot = Y.encodeStateAsUpdate(versionDoc);
    const liveDoc = docWithParagraphs("Staro", "Sadržaj koji nestaje");

    replaceNoteContent(liveDoc, versionSnapshot);

    expect(snapshotFragment(liveDoc.getXmlFragment("default"))).toEqual(
      snapshotFragment(versionDoc.getXmlFragment("default")),
    );
  });

  it("produces new persistable state: the post-restore diff is non-empty and a peer converges by applying it", () => {
    const versionDoc = buildVersionDoc();
    const versionSnapshot = Y.encodeStateAsUpdate(versionDoc);

    const liveDoc = docWithParagraphs("Staro");
    const preRestoreState = Y.encodeStateAsUpdate(liveDoc);
    const beforeVector = Y.encodeStateVector(liveDoc);

    replaceNoteContent(liveDoc, versionSnapshot);

    const diff = Y.encodeStateAsUpdate(liveDoc, beforeVector);
    expect(diff.byteLength).toBeGreaterThan(0);

    // A peer that only ever saw the pre-restore state converges once the diff lands.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, preRestoreState);
    Y.applyUpdate(peer, diff);

    expect(snapshotFragment(peer.getXmlFragment("default"))).toEqual(
      snapshotFragment(versionDoc.getXmlFragment("default")),
    );
  });

  it("restores onto an empty doc", () => {
    const versionDoc = buildVersionDoc();
    const versionSnapshot = Y.encodeStateAsUpdate(versionDoc);
    const liveDoc = new Y.Doc();

    replaceNoteContent(liveDoc, versionSnapshot);

    expect(snapshotFragment(liveDoc.getXmlFragment("default"))).toEqual(
      snapshotFragment(versionDoc.getXmlFragment("default")),
    );
  });

  it("clears the live doc when restoring an empty version", () => {
    const emptyVersionDoc = new Y.Doc();
    const emptySnapshot = Y.encodeStateAsUpdate(emptyVersionDoc);
    const liveDoc = docWithParagraphs("Sadržaj koji nestaje");

    replaceNoteContent(liveDoc, emptySnapshot);

    expect(liveDoc.getXmlFragment("default").length).toBe(0);
  });

  it("rewrites the whole fragment in exactly one transaction (one update event)", () => {
    const versionDoc = buildVersionDoc();
    const versionSnapshot = Y.encodeStateAsUpdate(versionDoc);
    const liveDoc = docWithParagraphs("Staro", "Još staro");

    const updates: Uint8Array[] = [];
    liveDoc.on("update", (update: Uint8Array) => updates.push(update));

    replaceNoteContent(liveDoc, versionSnapshot);

    expect(updates).toHaveLength(1);
  });
});
