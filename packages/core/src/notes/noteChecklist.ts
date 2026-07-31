import * as Y from "yjs";

import { xmlTextContent } from "./yjsText.js";

/**
 * The checklist a note's document currently authors (NOTE §6's „Pretvori u
 * zadatke"). The editor's checkboxes are deliberately VISUAL only — `TaskItem`
 * is configured in `NoteEditor.tsx` with the comment saying exactly that — so a
 * ticked box in a note is a mark on the page and nothing more. This walker is
 * what lets the user promote that page into real TASK rows, once, by hand.
 *
 * The walk is `collectNoteCards`'s: one recursive descent over the "default"
 * fragment (ADR-012's fixed contract), because a checklist may sit at any depth
 * — inside a callout, inside a collapsed toggle, inside a blockquote — and a
 * folded section's items are items all the same.
 *
 * Two rules make the result honest:
 *
 * - **A nested item's text is its own.** `ownText` stops at every `taskList` /
 *   `taskItem` boundary, so a parent's title is the line the user typed on the
 *   parent's row and never that row plus everything indented under it.
 * - **An empty item is still an item.** It is reported with an empty `text`
 *   rather than dropped, because the caller has to be able to say how many rows
 *   it skipped — and because a blank row with children still marks where its
 *   children's nesting begins.
 *
 * Pure like every other `@nexus/core` note module: a `Uint8Array` in, plain
 * values out, and the `Y.Doc` it decodes into is its own and destroyed here —
 * the caller never gets one to leak, and the note itself is never touched.
 */

/** One row of a note's checklist. */
export interface ChecklistItem {
  /**
   * The row's own text as one line: marks dropped, inline atoms (a `noteLink`,
   * an `attachmentImage`) contributing nothing — the `xmlTextContent` rule the
   * card walker and the duplicate walker already read text by. Several blocks
   * in one row join with a single space; `""` for a row with no text at all.
   */
  text: string;
  /** Whether the box is ticked. */
  checked: boolean;
  /** How many `taskItem`s enclose this one: 0 at the top of a list, +1 per level of nesting. */
  depth: number;
}

const TASK_ITEM = "taskItem";
const TASK_LIST = "taskList";

/** Every `taskItem` in `snapshot`, in document order. */
export function collectChecklistItems(snapshot: Uint8Array): ChecklistItem[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);
  const items: ChecklistItem[] = [];

  function walk(node: Y.XmlElement | Y.XmlText | Y.XmlHook, depth: number): void {
    if (!(node instanceof Y.XmlElement)) return; // text leaves and hooks hold no items
    const isItem = node.nodeName === TASK_ITEM;
    if (isItem) items.push({ text: itemText(node), checked: isChecked(node), depth });
    for (const child of node.toArray()) walk(child, isItem ? depth + 1 : depth);
  }

  for (const child of doc.getXmlFragment("default").toArray()) walk(child, 0);
  doc.destroy();
  return items;
}

/**
 * One row's line: each of its own blocks' text, trimmed, empties dropped, joined
 * by a single space. A row is virtually always one paragraph; the join is what
 * keeps the rare two-block row from fusing into „Prvi redDrugi red" once it
 * becomes a task title.
 */
function itemText(item: Y.XmlElement): string {
  const parts: string[] = [];
  for (const child of item.toArray()) {
    const text = ownText(child).trim();
    if (text.length > 0) parts.push(text);
  }
  return parts.join(" ");
}

/**
 * A node's text with any checklist below it left out — those rows are items of
 * their own and are collected as such. Text runs go through `xmlTextContent`
 * (marks are markup, not content) and every non-text node contributes nothing,
 * which is ProseMirror's own `textContent` rule and therefore the same string
 * the editor shows on that row.
 */
function ownText(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) return xmlTextContent(node);
  if (!(node instanceof Y.XmlElement)) return ""; // Y.XmlHook carries no text
  if (node.nodeName === TASK_LIST || node.nodeName === TASK_ITEM) return "";
  let text = "";
  for (const child of node.toArray()) text += ownText(child);
  return text;
}

/**
 * `Y.XmlElement`'s default TS generic types every attribute as `string`, but a
 * real document may store `checked` as a genuine boolean — widen to `unknown`
 * before comparing rather than trusting the too-narrow type. The same read
 * `noteMarkdown.ts` does for the same attribute.
 */
function isChecked(item: Y.XmlElement): boolean {
  const value: unknown = item.getAttribute("checked");
  return value === true || value === "true";
}
