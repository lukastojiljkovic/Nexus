import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { parseCardBlock } from "@nexus/core";
import { planClozeInsertion } from "./noteClozeInsert.js";

/**
 * Inline flashcards (ADR-017 / NOTE-006c): a single TipTap extension with
 * four independent parts, all built on `@nexus/core`'s `parseCardBlock` so
 * what the user sees highlighted and what gets persisted as a card can never
 * drift apart:
 *
 * (a) a `cardKey` global attribute on `paragraph`/`heading` — the block's
 *     identity, opaque and permanent once assigned. The Collaboration
 *     binding persists node attributes into the Yjs document under their
 *     ProseMirror *names*, which is exactly what `@nexus/core`'s
 *     `collectNoteCards` reads via `element.getAttribute("cardKey")` — not
 *     the rendered `data-card-key`. That equivalence is the contract between
 *     this file and the core package: the attribute's JS name must stay
 *     `cardKey`.
 * (b) a document plugin (`appendTransaction`) that assigns and re-keys it.
 * (c) a view plugin (`decorations`) that highlights card syntax — pure
 *     derived state, recomputed on every transaction, nothing written to
 *     the document.
 * (d) `Mod-Shift-c`, which wraps the selection in a new cloze deletion
 *     (`insertClozeDeletion`, ADR-068) — the one action that has to assign a
 *     number rather than let the author guess one.
 *
 * `countEditorCards` (bottom of file) is a fifth, small export: the same
 * walk as (c), used by the editor to drive the deck-mapping bar's live count.
 */

/**
 * Card syntax only ever lives in a paragraph/heading's own text — the two
 * types §(a) declares `cardKey` on. The check is by type name rather than
 * `isTextblock` on purpose: a textblock that does not declare the attribute
 * would silently drop `setNodeAttribute` (ProseMirror ignores unknown attrs),
 * and the key plugin below would re-assign it on every pass — an unbounded
 * `appendTransaction` loop. Keeping this list identical to §(a)'s `types`
 * makes that unreachable, and keeps all three walks (keys, decorations,
 * `collectNoteCards` over the Yjs doc) agreeing on the same set of blocks.
 * `codeBlock` is excluded separately by each caller's `descendants` return.
 */
function isCardCandidate(node: ProseMirrorNode): boolean {
  return node.type.name === "paragraph" || node.type.name === "heading";
}

/**
 * Assigns a fresh `cardKey` to any block that currently parses as a card and
 * has none, and re-keys duplicates (two blocks sharing one key — typically a
 * copy-paste — would otherwise leave the second silently un-synced, since the
 * database's `(profile, note, source_block_key)` UNIQUE index owns one slot
 * per key). Lives here rather than in an input rule so the invariant holds
 * however the text arrived: typed, pasted, or inserted by a template.
 *
 * Keys are never cleared: a block that stops parsing as a card keeps its key,
 * because clearing it would destroy the card's FSRS review history on a
 * transient edit (delete the `::` for one keystroke past the debounce and the
 * card is gone; retyping mints a new key and a new card). "Is currently a
 * card" is answered by the decoration plugin below, through the parser, never
 * by the stored attribute.
 */
function cardKeyPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("nexusCardKey"),
    appendTransaction(transactions, _oldState, newState) {
      // Nothing to reconcile unless this batch actually changed the doc.
      if (!transactions.some((transaction) => transaction.docChanged)) return null;

      // First pass: find every position that needs a (re-)assigned key, without
      // touching the document yet — keeps the walk itself simple and pure.
      const seenKeys = new Set<string>();
      const assignments: { pos: number; key: string }[] = [];

      newState.doc.descendants((node, pos) => {
        if (node.type.name === "codeBlock") return false; // never descend into or key off of code
        if (!isCardCandidate(node)) return true;
        if (parseCardBlock(node.textContent).cards.length === 0) return true;

        const existingKey = typeof node.attrs["cardKey"] === "string" ? node.attrs["cardKey"] : null;
        if (existingKey !== null && !seenKeys.has(existingKey)) {
          seenKeys.add(existingKey);
          return true;
        }

        // No key yet, or a duplicate already claimed earlier in this pass: mint a fresh one.
        const key = crypto.randomUUID();
        seenKeys.add(key);
        assignments.push({ pos, key });
        return true;
      });

      if (assignments.length === 0) return null;

      const tr = newState.tr;
      for (const assignment of assignments) tr.setNodeAttribute(assignment.pos, "cardKey", assignment.key);
      // The transaction this returns is itself a doc change, so `appendTransaction`
      // runs once more against it; that second pass finds every key already
      // assigned and unique, returns null, and the cycle terminates.
      tr.setMeta("addToHistory", false); // key assignment is bookkeeping, not an undoable edit
      return tr;
    },
  });
}

/**
 * Maps a textblock's own text onto document positions: `positions[i]` is
 * where character `i` of `text` lives in the document. Atoms (wiki-links,
 * attachment images) occupy positions but contribute no text, so they are
 * skipped rather than mapped — `parseCardBlock`'s offsets and this map both
 * describe the same `text`, and the two must stay consistent.
 *
 * Exported because in-note find (`noteFindBar.tsx`) needs the identical walk:
 * both features turn "a textblock's plain text" into document ranges, and a
 * second copy of this would be a second place for the atom rule to drift.
 */
export function blockTextAndPositions(
  node: ProseMirrorNode,
  pos: number,
): { text: string; positions: number[] } {
  const positions: number[] = [];
  let text = "";
  node.forEach((child, offset) => {
    if (!child.isText) return; // atoms contribute no text — their positions are skipped
    const value = child.text ?? "";
    for (let i = 0; i < value.length; i += 1) positions.push(pos + 1 + offset + i);
    text += value;
  });
  return { text, positions };
}

/** One `CardSyntaxSpan` kind's decoration class. A labelled run's `cN::` head sits INSIDE its own `{{…}}` span and only quiets it down (ADR-068). */
const SPAN_CLASS = {
  separator: "note__card-sep",
  cloze: "note__card-cloze",
  "cloze-label": "note__card-cloze-num",
} as const;

/**
 * Highlights what the parser found — decorations only, nothing stored. A
 * card-bearing block gets an accent left rule (`note__card-block`); each
 * `::` separator and `{{…}}` span gets its own inline decoration, and a
 * labelled deletion's number is muted inside its run so the answer reads as
 * the answer and the number as a marker.
 */
function cardDecorationPlugin(): Plugin {
  return new Plugin({
    key: new PluginKey("nexusCardDecorations"),
    props: {
      decorations(state) {
        const decorations: Decoration[] = [];

        state.doc.descendants((node, pos) => {
          if (node.type.name === "codeBlock") return false;
          if (!isCardCandidate(node)) return true;

          const { text, positions } = blockTextAndPositions(node, pos);
          const { cards, spans } = parseCardBlock(text);
          if (cards.length === 0) return true;

          decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "note__card-block" }));
          for (const span of spans) {
            const from = positions[span.start];
            const to = positions[span.end - 1];
            // noUncheckedIndexedAccess: an out-of-range lookup means skip the
            // span rather than decorate the wrong range.
            if (from === undefined || to === undefined) continue;
            decorations.push(Decoration.inline(from, to + 1, { class: SPAN_CLASS[span.kind] }));
          }
          return true;
        });

        return DecorationSet.create(state.doc, decorations);
      },
    },
  });
}

/**
 * Wraps the selection — or, with none, the caret — in a NEW cloze deletion and
 * spells out the number of every run in this block that carries none yet
 * (ADR-068). Returns false, changing nothing, when there is nowhere sensible to
 * put one: outside a card-capable block, across two blocks, over an inline
 * atom, or overlapping a deletion already there.
 *
 * Which number the deletion takes is `@nexus/core`'s `clozeDeletionEdits`, and
 * turning its text offsets into document positions is `planClozeInsertion` —
 * the pure half, testable without an editor. What is left here is the part that
 * genuinely needs ProseMirror: reading the block, and dispatching. The
 * insertions arrive DESCENDING, which is what lets them ride one transaction
 * without re-mapping — every position behind the one being written is still
 * valid.
 *
 * Materialising the other runs' numbers is safe by construction — an
 * unlabelled run's number IS its position + 1 — and it is what stops the new
 * deletion from shifting every later card onto different content.
 */
export function insertClozeDeletion(editor: Editor): boolean {
  const { state } = editor;
  const { $from, $to, from, to } = state.selection;
  if (!$from.sameParent($to) || !isCardCandidate($from.parent)) return false;

  const blockPos = $from.before($from.depth);
  const { text, positions } = blockTextAndPositions($from.parent, blockPos);
  const plan = planClozeInsertion({ text, positions, blockPos }, from, to);
  if (plan === null) return false;

  const tr = state.tr;
  for (const insert of plan.inserts) tr.insertText(insert.text, insert.at);
  tr.setSelection(TextSelection.create(tr.doc, plan.selection.from, plan.selection.to));

  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export const NoteFlashcard = Extension.create({
  name: "noteFlashcard",

  addKeyboardShortcuts() {
    return {
      // Anki's own shortcut for the same act, and free here: the note editor
      // has no toolbar and StarterKit binds Mod-e / Mod-Shift-b / Mod-Shift-x,
      // never this one.
      "Mod-Shift-c": ({ editor }) => insertClozeDeletion(editor),
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          cardKey: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-card-key"),
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes["cardKey"] === "string" ? { "data-card-key": attributes["cardKey"] } : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [cardKeyPlugin(), cardDecorationPlugin()];
  },
});

/** How many cards the open document currently yields — the same parse the decorations use. */
export function countEditorCards(doc: ProseMirrorNode): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === "codeBlock") return false;
    if (!isCardCandidate(node)) return true;
    count += parseCardBlock(node.textContent).cards.length;
    return true;
  });
  return count;
}
