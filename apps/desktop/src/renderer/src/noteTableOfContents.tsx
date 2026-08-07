import { Node, mergeAttributes } from "@tiptap/core";
import { EmptyState } from "@nexus/ui";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeViewWrapper, ReactNodeViewRenderer, useEditorState } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { strings } from "./strings.js";

/**
 * The „Sadržaj" block (NOTE-011): a block atom that renders the note's
 * headings and stores NOTHING. Not the entries, not their order, not their
 * text — a stored table of contents is a copy that starts lying the moment a
 * heading is renamed, and it would additionally have to be written back into
 * the document from a view, which is a write loop nothing in this editor does
 * (see `noteFlashcard.ts`: its highlighting is decorations, never content).
 *
 * Live-ness comes from `useEditorState`, TipTap's own subscription: the
 * selector re-runs on every transaction and the view re-renders only when the
 * selected value actually differs (its default comparison is a deep equal).
 * Positions are deliberately NOT part of that value — they shift on every
 * keystroke anywhere above a heading, which would re-render the list
 * constantly AND would leave a stale number behind whenever the comparison
 * correctly said "nothing changed". So the rendered entries carry level and
 * text only, and a click re-walks the live document for the position it
 * needs. One walk, `docHeadings`, answers both questions, so the two can
 * never disagree about which heading is the n-th.
 *
 * Nothing here writes to the document, which is also what makes it safe under
 * Yjs: every peer derives the same list from the shared state, and none of
 * them broadcasts an update for having looked at it.
 */

export const NoteTableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: "div[data-toc]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toc": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsView);
  },
});

/** One heading as the block sees it: where it is, how deep it is, and what it says. */
interface DocHeading {
  pos: number;
  level: number;
  text: string;
}

/** What the rendered list needs — `DocHeading` minus the position, so equality is stable across unrelated edits. */
type TocEntry = Omit<DocHeading, "pos">;

/**
 * Every heading in `doc` that has something to show, in document order. A
 * heading with no text is skipped rather than rendered as an empty row —
 * the same call the Markdown export makes when it drops a heading whose
 * inline content is empty.
 */
function docHeadings(doc: ProseMirrorNode): DocHeading[] {
  const headings: DocHeading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    const text = node.textContent.trim();
    if (text.length > 0) {
      const rawLevel: unknown = node.attrs["level"];
      headings.push({ pos, level: typeof rawLevel === "number" ? rawLevel : 1, text });
    }
    return false; // a heading holds inline content only — nothing to descend into
  });
  return headings;
}

/**
 * Scrolls the n-th heading into view, resolving its position from the live
 * document at click time. `block: "start"` (rather than `reveal.ts`'s
 * `"nearest"`) because this is an explicit jump: a heading already half in
 * view still belongs at the top of the reading area afterwards. No `behavior`,
 * so the scroll takes the computed `scroll-behavior` — which no stylesheet
 * sets to `smooth` and which the reduced-motion rule in `@nexus/ui`'s
 * styles.css pins to `auto`. Nothing to opt out of.
 */
function scrollToHeading(editor: Editor, index: number): void {
  const heading = docHeadings(editor.state.doc)[index];
  if (heading === undefined) return;
  const dom = editor.view.nodeDOM(heading.pos);
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start" });
}

function TableOfContentsView({ editor }: NodeViewProps) {
  const entries = useEditorState<TocEntry[]>({
    editor,
    selector: ({ editor: live }) =>
      docHeadings(live.state.doc).map(({ level, text }) => ({ level, text })),
  });

  return (
    <NodeViewWrapper as="nav" className="note__toc" aria-label={strings.notes.tocTitle}>
      <div className="note__toc-title">{strings.notes.tocTitle}</div>
      {entries.length === 0 ? (
        <EmptyState variant="inline" title={strings.notes.tocEmpty} />
      ) : (
        entries.map((entry, index) => (
          <button
            // The n-th entry IS its identity here: the list is a projection of
            // document order, with no stable id to key off of.
            key={index}
            type="button"
            className={`note__toc-item note__toc-item--l${clampLevel(entry.level)}`}
            // Keeps the click from dragging the selection onto this atom before
            // the scroll runs.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => scrollToHeading(editor, index)}
          >
            {entry.text}
          </button>
        ))
      )}
    </NodeViewWrapper>
  );
}

/** The editor offers heading levels 1-3 (StarterKit is configured that way); anything else indents as level 1. */
function clampLevel(level: number): 1 | 2 | 3 {
  if (level === 2) return 2;
  if (level === 3) return 3;
  return 1;
}
