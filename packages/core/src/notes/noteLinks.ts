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
