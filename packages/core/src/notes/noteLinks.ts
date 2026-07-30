import * as Y from "yjs";

import { collectNoteLinkIds } from "./yjsMerge.js";

/**
 * Wraps `collectNoteLinkIds` for a caller that only has an encoded snapshot,
 * not a live `Y.Doc` — a restore (IMEX-002) writes each note's Yjs state
 * straight from an archive's `.ydoc` bytes and has no renderer running to
 * derive the note's outbound link set the ordinary way (the editor reporting
 * it at flush time, `NoteStore.appendUpdate`'s `noteLinks` parameter). The
 * walk itself is not duplicated here — `collectNoteLinkIds` already is the
 * one place that knows what a `noteLink` node looks like — only the
 * decode/destroy ceremony `mergeNoteState` also does.
 */
export function extractNoteLinkTargets(snapshot: Uint8Array): string[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);
  const ids = collectNoteLinkIds(doc);
  doc.destroy();
  return ids;
}

/**
 * The two id-bearing node shapes a note's document can hold, as
 * `(nodeName, attribute)` pairs. Spelled exactly as the renderer's TipTap
 * nodes declare them (`noteLink.tsx`'s `noteId`, ADR-013; and
 * `noteAttachmentImage.tsx`'s `attachmentId`, ADR-014) and exactly as
 * `collectNoteLinkIds` and `noteMarkdown.ts` already read them — a respelling
 * here would silently stop rewriting a whole class of reference.
 */
const ID_ATTRIBUTES: readonly { nodeName: string; attribute: string }[] = [
  { nodeName: "noteLink", attribute: "noteId" },
  { nodeName: "attachmentImage", attribute: "attachmentId" },
];

/**
 * Rewrites every id a note's Yjs document embeds — a `noteLink`'s `noteId` and
 * an `attachmentImage`'s `attachmentId` — through `idMap`, and re-encodes.
 *
 * A foreign import (ADR-043) mints a new id for every row it merges into a
 * profile that already has data, so the references buried INSIDE a note's CRDT
 * state have to travel too: nothing else in the archive can see them, and a
 * note whose wiki-links still name the source profile's ids would render as a
 * page of dead links pointing at rows that belong to somebody else's data.
 *
 * An id that is NOT in the map is left exactly as it is — it becomes today's
 * ordinary unresolved wiki-link, which is honest, where inventing a target
 * would not be. The rewrite is a FORWARD edit inside one transaction, the same
 * discipline `replaceNoteContent` (`yjsRestore.ts`) applies for the same
 * reason: Yjs state is monotone, so a document is changed by writing over it,
 * never by re-encoding some edited copy of its bytes.
 */
export function remapNoteState(snapshot: Uint8Array, idMap: ReadonlyMap<string, string>): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);

  // The same recursive descent `collectNoteLinkIds` walks — id-bearing nodes
  // are inline/block atoms nested at any depth (paragraphs, list items,
  // blockquotes), and text leaves and hooks carry no attributes at all.
  function walk(node: Y.XmlElement | Y.XmlText | Y.XmlHook): void {
    if (!(node instanceof Y.XmlElement)) return;
    for (const { nodeName, attribute } of ID_ATTRIBUTES) {
      if (node.nodeName !== nodeName) continue;
      const current = node.getAttribute(attribute);
      if (typeof current !== "string") continue;
      const replacement = idMap.get(current);
      if (replacement !== undefined) node.setAttribute(attribute, replacement);
    }
    for (const child of node.toArray()) walk(child);
  }

  doc.transact(() => {
    for (const child of doc.getXmlFragment("default").toArray()) walk(child);
  });

  const remapped = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return remapped;
}
