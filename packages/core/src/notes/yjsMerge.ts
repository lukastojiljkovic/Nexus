import * as Y from "yjs";

import { xmlTextContent } from "./yjsText.js";

/**
 * Pure CRDT merge for one note's persisted Yjs state (ADR-012 / ADR-001).
 * The storage side (`@nexus/db`'s `NoteStore`) treats snapshots and updates as
 * opaque blobs with transactional guarantees; the CRDT semantics — how those
 * blobs combine into a document — live here, platform-free (`yjs` is pure JS,
 * no Node APIs), so the desktop main process's compaction and any future
 * caller (SRCH indexing, SHARE) merge identically.
 */

/** The result of merging a note's snapshot + trailing updates: a new snapshot and its derived plaintext. */
export interface MergedNoteState {
  /** The full merged state as one Yjs update (`Y.encodeStateAsUpdate`) — the next snapshot blob. */
  snapshot: Uint8Array;
  /**
   * Plaintext derived from the document's "default" XML fragment — this IS
   * the note's searchable body: migration 017's `search_source_note` view
   * feeds it straight into the FTS5 index, and it is what the Ctrl+K palette
   * renders as a result snippet (ADR-021 / SRCH).
   */
  plaintext: string;
}

/**
 * Applies `snapshot` (when present) and then every update, in order, to a
 * fresh `Y.Doc`, and returns the re-encoded full state plus its derived
 * plaintext. Order-independent for concurrent edits — Yjs updates commute —
 * so any interleaving of the same updates converges to the same state.
 */
export function mergeNoteState(
  snapshot: Uint8Array | null,
  updates: readonly Uint8Array[],
): MergedNoteState {
  const doc = new Y.Doc();
  if (snapshot !== null) Y.applyUpdate(doc, snapshot);
  for (const update of updates) Y.applyUpdate(doc, update);

  const merged: MergedNoteState = {
    snapshot: Y.encodeStateAsUpdate(doc),
    plaintext: fragmentPlaintext(doc.getXmlFragment("default")),
  };
  doc.destroy();
  return merged;
}

/**
 * TipTap inline nodes that appear as siblings of a `Y.XmlText` run within a
 * block's children (y-prosemirror's XML tree mirrors ProseMirror's schema
 * one-to-one, so a paragraph's children are a straight mix of text runs and
 * these). Deliberately an allow-list, not a deny-list: anything NOT named
 * here is walked as a further BLOCK (see `collectLines`). Forgetting a future
 * *block* node here would silently fuse its text into whatever it is nested
 * in — exactly the bulletList/blockquote bug this rewrite fixes. Forgetting a
 * future *inline* node instead merely breaks its line early, a visible,
 * cheap mistake — the direction it is safer to be wrong in.
 */
const INLINE_ELEMENT_NAMES = new Set(["noteLink", "hardBreak"]);

/**
 * Walks the TipTap collaboration fragment ("default" is the fixed fragment
 * name, a contract per ADR-012) and derives the note's plaintext: one line
 * per non-empty block, in document order, so a `bulletList`'s `listItem`s (or
 * a `blockquote`'s paragraphs) read as separate lines rather than fusing into
 * one unsearchable run. An empty document yields "".
 */
function fragmentPlaintext(fragment: Y.XmlFragment): string {
  const lines: string[] = [];
  collectLines(fragment.toArray(), lines);
  return lines.join("\n");
}

/**
 * Appends zero or more lines to `lines` for one block's (or the document
 * root's) direct children. A text run (read via `xmlTextContent`, never
 * `Y.XmlText.toString()` — see that helper's comment) and the inline allow-list
 * above accumulate into `line`, the block in progress. Anything else is a
 * nested block (`bulletList` > `listItem` > `paragraph`, `blockquote` >
 * `paragraph`, …): it flushes `line` first — so sibling blocks never fuse —
 * then recurses to push its own line(s) straight into the shared `lines`
 * array, after which accumulation resumes into a fresh, empty `line`. A
 * `line` that stays empty is never pushed, so an empty paragraph — or a
 * childless block atom like `attachmentImage`, which contributes no text on
 * purpose: SRCH already indexes an attachment by its own filename, so it
 * needs no second copy polluting its note's body — silently contributes
 * nothing.
 */
function collectLines(
  children: readonly (Y.XmlElement | Y.XmlText | Y.XmlHook)[],
  lines: string[],
): void {
  let line = "";
  for (const child of children) {
    if (child instanceof Y.XmlText) {
      line += xmlTextContent(child);
    } else if (child instanceof Y.XmlHook) {
      // carries no text
    } else if (!INLINE_ELEMENT_NAMES.has(child.nodeName)) {
      // Not on the inline allow-list => a nested block.
      if (line.length > 0) lines.push(line);
      line = "";
      collectLines(child.toArray(), lines);
    } else if (child.nodeName === "hardBreak") {
      line += "\n";
    } else {
      // noteLink: its `label` is the wiki-link's visible text (ADR-013 / NOTE-004).
      const label = child.getAttribute("label");
      if (typeof label === "string") line += label;
    }
  }
  if (line.length > 0) lines.push(line);
}

/**
 * All distinct `noteId` attrs of `noteLink` elements in the doc's "default"
 * fragment, in document order (ADR-013 / NOTE-004b). Wiki-link nodes are
 * inline atoms nested inside block elements (paragraphs, list items, …), so
 * the walk is recursive; the same target linked more than once is deduped,
 * keeping its first-seen position.
 */
export function collectNoteLinkIds(doc: Y.Doc): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  function walk(node: Y.XmlElement | Y.XmlText | Y.XmlHook): void {
    if (!(node instanceof Y.XmlElement)) return; // text leaves/hooks carry no links
    if (node.nodeName === "noteLink") {
      const noteId = node.getAttribute("noteId");
      if (typeof noteId === "string" && noteId.length > 0 && !seen.has(noteId)) {
        seen.add(noteId);
        ids.push(noteId);
      }
    }
    for (const child of node.toArray()) walk(child);
  }

  for (const child of doc.getXmlFragment("default").toArray()) walk(child);
  return ids;
}
