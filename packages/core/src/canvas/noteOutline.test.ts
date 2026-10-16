import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { parseCanvasSketch } from "./canvasSketch.js";
import {
  MAX_OUTLINE_HEADINGS,
  MAX_OUTLINE_LINKS,
  noteOutlineItems,
  noteOutlineSketch,
  type NoteOutlineItem,
} from "./noteOutline.js";

const heading = (level: number, text: string): NoteOutlineItem => ({ kind: "heading", level, text });
const link = (target: string, label = target): NoteOutlineItem => ({ kind: "link", target, label });

/** The PRD's acceptance note (docs/prd/09-notes.md, NOTE-007): five headings and three wiki-links. */
const PRD_NOTE: NoteOutlineItem[] = [
  heading(1, "Intro"),
  link("note-a", "Alpha"),
  heading(2, "Setup"),
  heading(2, "Usage"),
  heading(3, "Tips"),
  link("note-b", "Beta"),
  heading(1, "Appendix"),
  link("note-c", "Gamma"),
];

describe("noteOutlineSketch", () => {
  it("draws the PRD acceptance note: 5 headings as a tree and 3 wiki-links as arrows", () => {
    const sketch = noteOutlineSketch("Project", PRD_NOTE);
    expect(sketch.nodes).toHaveLength(9);
    expect(sketch.edges).toHaveLength(8);
    expect(sketch.layout).toBe("tree");

    const edge = (from: string, to: string): boolean =>
      sketch.edges.some((candidate) => candidate.from === from && candidate.to === to);
    // Headings nest by level: Setup and Usage under Intro, Tips under Usage, Appendix under the note.
    expect(edge("note", "h0")).toBe(true);
    expect(edge("h0", "h1")).toBe(true);
    expect(edge("h0", "h2")).toBe(true);
    expect(edge("h2", "h3")).toBe(true);
    expect(edge("note", "h4")).toBe(true);
    // Each link leaves the section it sits in.
    expect(edge("h0", "l0")).toBe(true);
    expect(edge("h3", "l1")).toBe(true);
    expect(edge("h4", "l2")).toBe(true);
  });

  it("is a valid sketch the board will accept", () => {
    expect(() => parseCanvasSketch(noteOutlineSketch("Project", PRD_NOTE))).not.toThrow();
  });

  it("caps headings at MAX_OUTLINE_HEADINGS and summarises the rest in one box", () => {
    const items = Array.from({ length: 200 }, (_, i) => heading(2, `Section ${i}`));
    const sketch = noteOutlineSketch("Long", items);
    expect(MAX_OUTLINE_HEADINGS).toBe(50);
    const more = sketch.nodes.find((node) => node.id === "more");
    expect(more?.label).toBe("+150 more");
    expect(sketch.nodes.filter((node) => node.id.startsWith("h"))).toHaveLength(50);
    expect(() => parseCanvasSketch(sketch)).not.toThrow();
  });

  it("draws no summary box when every heading fits", () => {
    const sketch = noteOutlineSketch("Short", [heading(1, "One"), heading(1, "Two")]);
    expect(sketch.nodes.some((node) => node.id === "more")).toBe(false);
  });

  it("keeps the first distinct linked notes up to the cap and drops the rest", () => {
    const links = Array.from({ length: MAX_OUTLINE_LINKS + 3 }, (_, i) => link(`n${i}`));
    const sketch = noteOutlineSketch("Hub", links);
    const linkNodes = sketch.nodes.filter((node) => node.shape === "ellipse");
    expect(linkNodes).toHaveLength(MAX_OUTLINE_LINKS);
    expect(sketch.edges).toHaveLength(MAX_OUTLINE_LINKS);
    expect(() => parseCanvasSketch(sketch)).not.toThrow();
  });

  it("draws one box for a note linked twice, with an arrow for each link", () => {
    const sketch = noteOutlineSketch("Twice", [heading(1, "A"), link("same", "Same"), heading(1, "B"), link("same", "Same")]);
    expect(sketch.nodes.filter((node) => node.shape === "ellipse")).toHaveLength(1);
    expect(sketch.edges.filter((edge) => edge.to === "l0")).toHaveLength(2);
  });
});

describe("noteOutlineItems", () => {
  /** A note's document as the editor writes it: headings with a level, and wiki-links inside a paragraph. */
  function noteState(): Uint8Array {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("default");
    const title = new Y.XmlElement("heading");
    title.setAttribute("level", "2");
    title.insert(0, [new Y.XmlText("Plan")]);
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("See ")]);
    const wikiLink = new Y.XmlElement("noteLink");
    wikiLink.setAttribute("noteId", "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b");
    wikiLink.setAttribute("label", "Budget");
    paragraph.insert(1, [wikiLink]);
    fragment.insert(0, [title, paragraph]);
    return Y.encodeStateAsUpdate(doc);
  }

  it("reads headings with their levels and wiki-links with their targets, in document order", () => {
    expect(noteOutlineItems(noteState(), [])).toEqual([
      { kind: "heading", level: 2, text: "Plan" },
      { kind: "link", target: "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", label: "Budget" },
    ]);
  });

  it("reads a note with no structure as no items", () => {
    expect(noteOutlineItems(null, [])).toEqual([]);
  });
});
