/**
 * NOTE-007 / CANV-005: a note drawn as a diagram. Its headings become boxes
 * nested as a tree, and its wiki-links become arrows to the notes they name.
 *
 * **Why this reads the note's document, not its text.** A note's body is a Yjs
 * document (ADR-012), and a heading or a wiki-link is an element of it with a
 * level or a target — the plaintext the search index keeps has lost both. So the
 * outline walks the same fragment `yjsMerge.ts` walks, and `noteOutlineSketch`
 * is a pure function of the items that walk found.
 *
 * **The caps are the sketch's own cap, spent deliberately.** A canvas sketch
 * holds at most `MAX_CANVAS_SKETCH_NODES` boxes, and the outline spends them in
 * this order: the note's own box, then up to `MAX_OUTLINE_HEADINGS` headings in
 * document order, then one „+N more" box if the note has more headings, then up
 * to `MAX_OUTLINE_LINKS` distinct linked notes. The two numbers are policy
 * choices that add up to the sketch cap (1 + 50 + 1 + 8 = 60), not measurements
 * of anything. A linked note past the cap is left out rather than drawn over
 * the limit; its arrow is never invented.
 */

import * as Y from "yjs";
import type { CanvasSketch, CanvasSketchEdge, CanvasSketchNode } from "./canvasSketch.js";
import { xmlTextContent } from "../notes/yjsText.js";

/** Headings drawn before the rest are summarised in one „+N more" box. */
export const MAX_OUTLINE_HEADINGS = 50;
/** Distinct linked notes drawn. */
export const MAX_OUTLINE_LINKS = 8;

/** One thing the note's document says, in document order. */
export type NoteOutlineItem =
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "link"; readonly target: string; readonly label: string };

/** Walks a note's stored state (its snapshot and trailing updates, as `NoteStore` keeps them) for its headings and wiki-links. */
export function noteOutlineItems(
  snapshot: Uint8Array | null,
  updates: readonly Uint8Array[],
): NoteOutlineItem[] {
  const doc = new Y.Doc();
  try {
    if (snapshot !== null) Y.applyUpdate(doc, snapshot);
    for (const update of updates) Y.applyUpdate(doc, update);
    const items: NoteOutlineItem[] = [];
    collect(doc.getXmlFragment("default").toArray(), items);
    return items;
  } finally {
    doc.destroy();
  }
}

function collect(
  children: readonly (Y.XmlElement | Y.XmlText | Y.XmlHook)[],
  items: NoteOutlineItem[],
): void {
  for (const child of children) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === "heading") {
      items.push({ kind: "heading", level: headingLevel(child), text: textOf(child).trim() });
    } else if (child.nodeName === "noteLink") {
      const target = child.getAttribute("noteId");
      if (typeof target === "string" && target.length > 0) {
        items.push({ kind: "link", target, label: child.getAttribute("label") ?? target });
      }
    }
    collect(child.toArray(), items);
  }
}

function headingLevel(element: Y.XmlElement): number {
  const level = Number(element.getAttribute("level"));
  return Number.isInteger(level) && level >= 1 && level <= 6 ? level : 1;
}

/** A block's visible text, with a wiki-link's label standing for the link. */
function textOf(element: Y.XmlElement): string {
  let text = "";
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlText) text += xmlTextContent(child);
    else if (child instanceof Y.XmlElement) {
      text += child.nodeName === "noteLink" ? (child.getAttribute("label") ?? "") : textOf(child);
    }
  }
  return text;
}

/**
 * The sketch of one note: the note's title as the root box, its headings as a
 * tree beneath it, and an arrow from the section each wiki-link sits in to a box
 * for the note it names. `title` must be non-empty; the caller supplies the
 * fallback it shows for an untitled note.
 */
export function noteOutlineSketch(title: string, items: readonly NoteOutlineItem[]): CanvasSketch {
  const headings = items.filter(
    (item): item is Extract<NoteOutlineItem, { kind: "heading" }> => item.kind === "heading",
  );
  const shown = headings.slice(0, MAX_OUTLINE_HEADINGS);
  const hidden = headings.length - shown.length;

  const nodes: CanvasSketchNode[] = [{ id: "note", label: clip(title), shape: "rect" }];
  const edges: CanvasSketchEdge[] = [];
  // The box a heading (by its place in `headings`) is drawn as, if it is drawn.
  const boxOf = (position: number): string => (position < shown.length ? `h${position}` : "more");

  // The nearest open heading above each one, by level: the stack a tree is built on.
  const open: { level: number; id: string }[] = [];
  shown.forEach((heading, position) => {
    const id = `h${position}`;
    while (open.length > 0 && (open[open.length - 1]?.level ?? 0) >= heading.level) open.pop();
    nodes.push({ id, label: clip(heading.text || "…"), shape: "rect" });
    edges.push({ from: open[open.length - 1]?.id ?? "note", to: id });
    open.push({ level: heading.level, id });
  });

  if (hidden > 0) {
    nodes.push({ id: "more", label: `+${hidden} more`, shape: "rect" });
    edges.push({ from: "note", to: "more" });
  }

  // Linked notes, one box each. An arrow leaves the section the link sits in:
  // the last heading above it, or the note itself before the first heading.
  const linked = new Map<string, string>();
  let section = -1;
  for (const item of items) {
    if (item.kind === "heading") {
      section += 1;
      continue;
    }
    let to = linked.get(item.target);
    if (to === undefined) {
      if (linked.size === MAX_OUTLINE_LINKS) continue;
      to = `l${linked.size}`;
      linked.set(item.target, to);
      nodes.push({ id: to, label: clip(item.label || item.target), shape: "ellipse" });
    }
    edges.push({ from: section < 0 ? "note" : boxOf(section), to });
  }

  return { nodes, edges, layout: "tree" };
}

/** A label past the sketch's length ceiling is cut, never refused: a long heading still belongs in the picture. */
function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= 200 ? trimmed : `${trimmed.slice(0, 199)}…`;
}
