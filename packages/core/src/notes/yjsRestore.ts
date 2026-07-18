import * as Y from "yjs";

/**
 * Pure restore for one note's live Yjs document (ADR-015). Yjs state is
 * monotone — applying an *old* snapshot onto a doc that already contains
 * later edits is a silent no-op (its ops are already known) — so restoring a
 * prior version can never be "load the old bytes back". It must instead be a
 * **forward edit**: delete the live "default" fragment's children and insert
 * deep clones of the version's, in one transaction. The collaboration
 * binding sees this as an ordinary (if large) remote change and rebuilds the
 * view; the normal debounced flush then persists it as a regular update, so
 * title/plaintext/wiki-link derivation all re-run through the existing
 * pipeline, unchanged.
 */

/**
 * Rewrites `doc`'s "default" fragment to match `versionSnapshot`'s content.
 * `versionSnapshot` is decoded onto a throwaway `Y.Doc` (read once, destroyed
 * immediately after) — `doc` itself is never replaced, only its fragment's
 * children. The v1 block set never emits `Y.XmlHook` nodes (ADR-012), so the
 * cast to `insert`'s narrower element/text signature is safe without a
 * runtime filter.
 */
export function replaceNoteContent(doc: Y.Doc, versionSnapshot: Uint8Array): void {
  const versionDoc = new Y.Doc();
  Y.applyUpdate(versionDoc, versionSnapshot);
  const clones = versionDoc
    .getXmlFragment("default")
    .toArray()
    .map((node) => node.clone()) as (Y.XmlElement | Y.XmlText)[];

  doc.transact(() => {
    const fragment = doc.getXmlFragment("default");
    fragment.delete(0, fragment.length);
    fragment.insert(0, clones);
  });

  versionDoc.destroy();
}
