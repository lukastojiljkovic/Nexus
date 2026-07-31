import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { collectChecklistItems } from "./noteChecklist.js";
import type { ChecklistItem } from "./noteChecklist.js";

/** One `taskItem` holding a single paragraph, plus whatever blocks nest under it. */
function item(
  text: string,
  checked: boolean | string | undefined,
  ...nested: Y.XmlElement[]
): Y.XmlElement {
  const element = new Y.XmlElement("taskItem");
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  element.insert(0, [paragraph, ...nested]);
  if (checked !== undefined) element.setAttribute("checked", checked as string);
  return element;
}

/** A `taskList` wrapping the given items. */
function list(...items: Y.XmlElement[]): Y.XmlElement {
  const element = new Y.XmlElement("taskList");
  element.insert(0, items);
  return element;
}

function paragraph(text: string): Y.XmlElement {
  const element = new Y.XmlElement("paragraph");
  element.insert(0, [new Y.XmlText(text)]);
  return element;
}

/** The encoded state of a document whose "default" fragment holds these blocks. */
function snapshotOf(...blocks: Y.XmlElement[]): Uint8Array {
  const doc = new Y.Doc();
  doc.getXmlFragment("default").push(blocks);
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

const collect = (...blocks: Y.XmlElement[]): ChecklistItem[] =>
  collectChecklistItems(snapshotOf(...blocks));

describe("collectChecklistItems", () => {
  it("returns nothing for a document with no checklist", () => {
    expect(collect(paragraph("Samo tekst."))).toEqual([]);
  });

  it("returns every item of a flat list in document order, at depth 0", () => {
    expect(collect(list(item("Mleko", false), item("Hleb", false), item("Kafa", false)))).toEqual([
      { text: "Mleko", checked: false, depth: 0 },
      { text: "Hleb", checked: false, depth: 0 },
      { text: "Kafa", checked: false, depth: 0 },
    ]);
  });

  it("reads the checked state as a boolean and as the string a stored document may carry", () => {
    expect(
      collect(list(item("A", true), item("B", "true"), item("C", false), item("D", undefined))),
    ).toEqual([
      { text: "A", checked: true, depth: 0 },
      { text: "B", checked: true, depth: 0 },
      { text: "C", checked: false, depth: 0 },
      { text: "D", checked: false, depth: 0 },
    ]);
  });

  it("counts a nested item's enclosing items as its depth", () => {
    const deep = list(item("Unuk", false));
    const child = list(item("Dete", false, deep));
    expect(collect(list(item("Roditelj", false, child)))).toEqual([
      { text: "Roditelj", checked: false, depth: 0 },
      { text: "Dete", checked: false, depth: 1 },
      { text: "Unuk", checked: false, depth: 2 },
    ]);
  });

  it("keeps a nested item's text out of its parent's", () => {
    const [parent] = collect(list(item("Roditelj", false, list(item("Dete", false)))));
    expect(parent?.text).toBe("Roditelj");
  });

  it("keeps an item whose text is empty, so a caller can count what it skipped", () => {
    expect(collect(list(item("", false), item("   ", false), item("Ima teksta", false)))).toEqual([
      { text: "", checked: false, depth: 0 },
      { text: "", checked: false, depth: 0 },
      { text: "Ima teksta", checked: false, depth: 0 },
    ]);
  });

  it("finds items inside a callout and inside a collapsed toggle", () => {
    const callout = new Y.XmlElement("callout");
    callout.setAttribute("variant", "tip");
    callout.insert(0, [list(item("U okviru", false))]);

    const summary = new Y.XmlElement("toggleSummary");
    const body = new Y.XmlElement("toggleContent");
    body.insert(0, [list(item("Sklopljeno", true))]);
    const toggle = new Y.XmlElement("toggle");
    toggle.setAttribute("collapsed", "true");
    toggle.insert(0, [summary, body]);

    expect(collect(callout, toggle)).toEqual([
      { text: "U okviru", checked: false, depth: 0 },
      { text: "Sklopljeno", checked: true, depth: 0 },
    ]);
  });

  it("keeps the document order of two separate lists", () => {
    expect(
      collect(list(item("Prvi", false)), paragraph("Između"), list(item("Drugi", false))).map(
        (entry) => entry.text,
      ),
    ).toEqual(["Prvi", "Drugi"]);
  });

  it("drops marks — a bolded item is its words, not <bold>…</bold>", () => {
    const element = new Y.XmlElement("taskItem");
    const block = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    block.insert(0, [text]);
    element.insert(0, [block]);
    const doc = new Y.Doc();
    doc.getXmlFragment("default").push([list(element)]);
    // Marks are applied only once the text is integrated: an unintegrated
    // `Y.XmlText` queues its inserts and keeps reporting length 0.
    text.insert(0, "Kupi ");
    text.insert(text.length, "mleko", { bold: {} });

    expect(collectChecklistItems(Y.encodeStateAsUpdate(doc))).toEqual([
      { text: "Kupi mleko", checked: false, depth: 0 },
    ]);
    doc.destroy();
  });

  it("gives an inline atom no text, exactly as the editor's own textContent does", () => {
    const link = new Y.XmlElement("noteLink");
    link.setAttribute("noteId", "note-1");
    link.setAttribute("label", "Druga beleška");
    const element = new Y.XmlElement("taskItem");
    const block = new Y.XmlElement("paragraph");
    block.insert(0, [new Y.XmlText("Vidi "), link]);
    element.insert(0, [block]);

    expect(collect(list(element))).toEqual([{ text: "Vidi", checked: false, depth: 0 }]);
  });

  it("joins an item's several blocks into one line", () => {
    const element = new Y.XmlElement("taskItem");
    element.insert(0, [paragraph("Prvi red"), paragraph("Drugi red")]);
    expect(collect(list(element))).toEqual([
      { text: "Prvi red Drugi red", checked: false, depth: 0 },
    ]);
  });
});
