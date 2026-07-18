import * as Y from "yjs";

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
  /** Plaintext derived from the document's "default" XML fragment, for future SRCH indexing. */
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
 * Walks the TipTap collaboration fragment ("default" is the fixed fragment
 * name, a contract per ADR-012) and derives plaintext: text content is
 * concatenated recursively, and top-level block elements are separated by a
 * newline. An empty document yields "".
 */
function fragmentPlaintext(fragment: Y.XmlFragment): string {
  const blocks: string[] = [];
  for (const child of fragment.toArray()) {
    blocks.push(nodeText(child));
  }
  return blocks.join("\n");
}

/** The concatenated text of one XML node: a text leaf's content, or its children's text in order. */
function nodeText(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) return node.toString();
  if (node instanceof Y.XmlElement) {
    let text = "";
    for (const child of node.toArray()) text += nodeText(child);
    return text;
  }
  return ""; // Y.XmlHook carries no text
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
