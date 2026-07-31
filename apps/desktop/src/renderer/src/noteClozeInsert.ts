import { clozeDeletionEdits } from "@nexus/core";

/**
 * The pure half of „napravi prazninu" in the note editor (ADR-068), split out
 * of `noteFlashcard.ts` for exactly the reason `noteFind.ts` is split out of
 * the find bar: it never touches ProseMirror, only a textblock's plain text
 * plus the position array the editor's own walk hands it — so every rule below
 * is testable under node, with no editor and no DOM in sight.
 *
 * What it decides is the TRANSLATION, and nothing else. Which number the new
 * deletion takes, and which existing runs get their number spelled out, is
 * `@nexus/core`'s `clozeDeletionEdits` — one grammar, one numbering rule, no
 * second copy anywhere near the editor.
 */

/** One textblock as `blockTextAndPositions` describes it, plus the document position of the block node itself. */
export interface ClozeInsertBlock {
  /** The block's own plain text — atoms contribute nothing, exactly as the card parser sees it. */
  text: string;
  /** `positions[i]` is where character `i` of `text` lives in the document. */
  positions: readonly number[];
  /** The position of the block node itself, so an EMPTY block still has one spot to write at. */
  blockPos: number;
}

export interface ClozeInsertion {
  /** Text insertions in DESCENDING document position — apply them in order and nothing behind needs re-mapping. */
  inserts: readonly { at: number; text: string }[];
  /** Where the wrapped answer ends up, as a document range, so the caret can follow it. */
  selection: { from: number; to: number };
}

/**
 * Plans the insertion of a new cloze deletion around the document range
 * `[from, to)` of `block` — or at the caret, when the two are equal.
 *
 * `null`, changing nothing, whenever the range does not describe a stretch of
 * this block's own text: outside it, or across an inline atom (which occupies
 * document positions but contributes no text, so the two ranges would measure
 * different things), or overlapping a deletion that is already there — a
 * deletion cannot nest inside another.
 */
export function planClozeInsertion(
  block: ClozeInsertBlock,
  from: number,
  to: number,
): ClozeInsertion | null {
  const { text, positions, blockPos } = block;
  const last = positions[positions.length - 1];
  /** The one position no character occupies but a caret still names: just past the block's text (and, in an empty block, the block's only spot). */
  const endPos = (last === undefined ? blockPos : last) + 1;

  const offsetOf = (pos: number): number | null => {
    const index = positions.indexOf(pos);
    if (index !== -1) return index;
    return pos === endPos ? positions.length : null;
  };
  const docPosOf = (offset: number): number => positions[offset] ?? endPos;

  const textFrom = offsetOf(from);
  const textTo = offsetOf(to);
  if (textFrom === null || textTo === null) return null;
  // An atom INSIDE the selection: both ends map, but the two ranges differ in
  // length, which means the selection covers something that is not text.
  if (to - from !== textTo - textFrom) return null;

  const edits = clozeDeletionEdits(text, textFrom, textTo);
  if (edits === null) return null;

  // Where the answer ends up: the opening's own length past where it was
  // written, plus every label materialised BEFORE it — those edits sit at lower
  // offsets, are applied after the opening, and push it right.
  const opening = edits.find((edit) => edit.at === textFrom && edit.text.startsWith("{{"));
  const shift = edits
    .filter((edit) => edit.at < textFrom)
    .reduce((total, edit) => total + edit.text.length, 0);
  const answerFrom = docPosOf(textFrom) + (opening?.text.length ?? 0) + shift;

  return {
    inserts: edits.map((edit) => ({ at: docPosOf(edit.at), text: edit.text })),
    selection: { from: answerFrom, to: answerFrom + (to - from) },
  };
}
