import * as Y from "yjs";

import { xmlTextContent } from "./yjsText.js";

/**
 * Pure "duplicate this note" for one note's merged Yjs state (NOTE-010) — the
 * document half of an operation whose row half lives in the desktop app's main
 * process. The copy must be a genuinely INDEPENDENT note, and that is a
 * statement about what the document embeds, not only about which rows get
 * inserted:
 *
 * - **Card keys are re-minted.** A block's `cardKey` (ADR-017) is a flashcard's
 *   identity — the slot its FSRS history hangs on. Two notes carrying the same
 *   key are two notes claiming one card's history, so every key is replaced
 *   with a fresh one from a caller-supplied mint. The traversal is
 *   `remapNoteState`'s (`noteLinks.ts`): one recursive descent over the
 *   "default" fragment (ADR-012's fixed contract), because id- and key-bearing
 *   nodes sit at any depth — inside list items, blockquotes, callouts.
 * - **Wiki-links are KEPT.** They name other notes, and those notes still
 *   exist: a copy that pointed nowhere would be a worse copy. The ONE exception
 *   is a link to the note being duplicated — a self-link, which the editor
 *   never writes but a restore or an import can carry — and it follows the
 *   copy, because "see this note" must keep meaning the note the reader is in.
 * - **Attachment references are KEPT.** The blob is content-addressed and
 *   therefore shared, but the `note_attachments` ROWS are per-note, so the copy
 *   gets rows of its own with new ids. This module cannot know those ids (they
 *   do not exist until the rows are inserted), so it deliberately leaves every
 *   `attachmentImage` alone and the caller finishes the job with
 *   `remapNoteState` and the map its own inserts produced. One rewrite, in the
 *   module that already owns id remapping, rather than a second copy of it here.
 *
 * Pure like every other `@nexus/core` module: no uuid import, no clock, no
 * database — `mintCardKey` is injected, exactly as `planForeignImport` injects
 * `mintId`. The rewrite is a FORWARD edit inside one transaction, the same
 * discipline `replaceNoteContent` and `remapNoteState` apply for the same
 * reason: Yjs state is monotone, so a document is changed by writing over it,
 * never by re-encoding some edited copy of its bytes.
 */

/** `notes.title`'s own cap, mirrored from the editor's `deriveTitle` so a copy's title is what the editor would derive. */
const MAX_TITLE_LENGTH = 200;

/**
 * The blocks the copy's „(kopija)" mark is written INTO. A note has no title
 * field — its title IS its first non-empty block (`deriveTitle`, NoteEditor.tsx)
 * — so a suffix written only into the `notes.title` column would vanish the
 * moment its owner typed one character (`markdownImport.ts` states the same
 * rule for the same reason). Writing it into the document is what makes it
 * durable.
 *
 * Narrowed to the two single-line text blocks, which is what a note's first
 * block virtually always is, and which is `noteFlashcard.ts`'s own
 * "card candidate" set for the same underlying reason — these are the blocks
 * whose text is one line the user reads as a heading. Anything else is left
 * alone on purpose:
 *
 * - a `codeBlock` is code, and appending a Serbian word to somebody's snippet
 *   to decorate a list row is not a trade this app makes (the „code is code"
 *   rule `collectNoteCards` states);
 * - a list or a quote derives its title from SEVERAL nested blocks, so there is
 *   no single line the mark could join without landing at the end of whichever
 *   item happens to be last.
 *
 * For those, the suffix rides in the returned `title` alone — visible in the
 * list immediately, and honestly transient: the copy's first edit re-derives
 * the title from the document and the mark goes with it.
 */
const SUFFIXABLE_BLOCKS = new Set(["paragraph", "heading"]);

export interface DuplicateNoteStateInput {
  /** The note being duplicated. A `noteLink` naming it is a self-link, and follows the copy. */
  sourceNoteId: string;
  /** The copy's own id — already minted by the caller, because the copy's row exists before its document does. */
  newNoteId: string;
  /** Mints one fresh ADR-017 block key. Called once per keyed block, in document order. */
  mintCardKey: () => string;
  /** The „ (kopija)" mark. Passed in rather than spelled here: user-facing copy is the app's, never a pure module's. */
  titleSuffix: string;
}

export interface DuplicatedNoteState {
  /** The copy's full document state, as one Yjs update — what the caller appends through `NoteStore.appendUpdate`. */
  state: Uint8Array;
  /**
   * The title to stamp on the copy's row: what the editor's own `deriveTitle`
   * reads off `state` (first non-empty top-level block, trimmed, capped), with
   * the suffix already in it. Returned rather than re-derived by the caller
   * because only this function knows whether the mark went into the document or
   * only into the column — see `SUFFIXABLE_BLOCKS`.
   */
  title: string;
}

/**
 * Rewrites `snapshot` into the copy's document state and derives the title that
 * goes with it.
 */
export function duplicateNoteState(
  snapshot: Uint8Array,
  input: DuplicateNoteStateInput,
): DuplicatedNoteState {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot);

  const fragment = doc.getXmlFragment("default");
  let suffixed = false;

  doc.transact(() => {
    for (const child of fragment.toArray()) rewrite(child, input);

    const titleBlock = firstTextBlock(fragment);
    if (titleBlock !== null && SUFFIXABLE_BLOCKS.has(titleBlock.nodeName)) {
      const run = lastTextRun(titleBlock);
      if (run !== null) {
        // No explicit formatting: `Y.XmlText.insert` inherits what is already
        // active at the insertion point, so the mark reads exactly as it would
        // had the user typed it at the end of that line — bold after bold text,
        // plain after plain.
        run.insert(run.length, input.titleSuffix);
        suffixed = true;
      }
    }
  });

  const derived = deriveTitle(fragment);
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();

  // The suffix is already in `derived` when it went into the document. When it
  // did not — and only when there is a title for it to mark at all — it is
  // appended here, and capped by the same rule, so an over-long title loses its
  // tail rather than its mark's spelling.
  const title = suffixed || derived.length === 0 ? derived : capTitle(derived + input.titleSuffix);
  return { state, title };
}

/**
 * One node's contribution to the copy: a fresh card key, and a self-link
 * repointed. Then its children, at any depth — the descent `remapNoteState`
 * walks, for the same reason.
 */
function rewrite(
  node: Y.XmlElement | Y.XmlText | Y.XmlHook,
  input: DuplicateNoteStateInput,
): void {
  if (!(node instanceof Y.XmlElement)) return; // text leaves and hooks carry no attributes

  // A `codeBlock` is never keyed off (`collectNoteCards`'s own rule: code is
  // code), so a stray key on one authors no card in either note and is left
  // exactly as it is. Its children are still walked — a rewrite that skipped a
  // subtree could only ever miss something.
  if (node.nodeName !== "codeBlock") {
    const cardKey = node.getAttribute("cardKey");
    // The same "non-empty string" test `collectNoteCards` reads a key with: a
    // block whose key is "" authors nothing, so there is nothing to re-mint.
    if (typeof cardKey === "string" && cardKey.length > 0) {
      node.setAttribute("cardKey", input.mintCardKey());
    }
  }

  if (node.nodeName === "noteLink" && node.getAttribute("noteId") === input.sourceNoteId) {
    node.setAttribute("noteId", input.newNoteId);
  }

  for (const child of node.toArray()) rewrite(child, input);
}

/** The first top-level block whose text is non-empty — the block a note's title comes from (`deriveTitle`). */
function firstTextBlock(fragment: Y.XmlFragment): Y.XmlElement | null {
  for (const child of fragment.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (blockText(child).trim().length > 0) return child;
  }
  return null;
}

/** The title `deriveTitle` (NoteEditor.tsx) would read off this document: the first non-empty block's text, trimmed and capped. */
function deriveTitle(fragment: Y.XmlFragment): string {
  const block = firstTextBlock(fragment);
  return block === null ? "" : capTitle(blockText(block).trim());
}

function capTitle(value: string): string {
  return value.slice(0, MAX_TITLE_LENGTH);
}

/**
 * One block's plain text, its own text runs concatenated in document order.
 * Read through `xmlTextContent` rather than `Y.XmlText.toString()`, which
 * serializes marks as pseudo-XML (that helper's whole reason for existing), so
 * a bold title reads as its words rather than as `<bold>…</bold>`. An inline
 * atom — a `noteLink`, an `attachmentImage` — contributes nothing, exactly as
 * it contributes nothing to the editor's own derivation.
 */
function blockText(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) return xmlTextContent(node);
  if (!(node instanceof Y.XmlElement)) return "";
  let text = "";
  for (const child of node.toArray()) text += blockText(child);
  return text;
}

/**
 * The last text run inside a block that actually holds text — the end of
 * everything the title is derived FROM, which is what the mark has to follow.
 * A block ending in an inline atom (a wiki-link, an image) therefore takes the
 * suffix just before that atom rather than after it: the atom contributes no
 * text to the title, so appending past it would put the mark somewhere the
 * derived title does not go.
 */
function lastTextRun(node: Y.XmlElement): Y.XmlText | null {
  let found: Y.XmlText | null = null;
  const walk = (current: Y.XmlElement | Y.XmlText | Y.XmlHook): void => {
    if (current instanceof Y.XmlText) {
      if (current.length > 0) found = current;
      return;
    }
    if (!(current instanceof Y.XmlElement)) return;
    for (const child of current.toArray()) walk(child);
  };
  walk(node);
  return found;
}
