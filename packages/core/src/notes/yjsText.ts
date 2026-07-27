import * as Y from "yjs";

/**
 * The one fact about Yjs text that every note walk needs, extracted so it can
 * never be got wrong twice: `Y.XmlText.toString()` serializes marks as
 * pseudo-XML tags (text carrying a `bold` mark renders as `<bold>text</bold>`,
 * a link as `<link href="…">text</link>`), which is markup, not content.
 *
 * The walks above this — `yjsMerge.ts`'s plaintext derivation and
 * `noteCards.ts`'s card parsing — stay deliberately separate because they
 * disagree about *structure* (one wants a readable line per block, the other
 * has to mirror ProseMirror's own `textContent` so the editor's decorations
 * and the persisted cards agree). They do not disagree about this, and the one
 * time they both open-coded it, they were both wrong.
 */

/**
 * One `Y.XmlText`'s content with its marks dropped: `toDelta()`'s segments
 * concatenated, skipping any non-string insert (a delta insert can be an
 * embedded object, which is never text — defensive, since nothing in a note
 * embeds one, but a silently-wrong body is worse than a silently-dropped
 * embed).
 */
export function xmlTextContent(text: Y.XmlText): string {
  let out = "";
  for (const op of text.toDelta() as { insert?: unknown }[]) {
    if (typeof op.insert === "string") out += op.insert;
  }
  return out;
}
