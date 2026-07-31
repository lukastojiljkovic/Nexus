import { Node, mergeAttributes } from "@tiptap/core";
import type { Editor, Range } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { strings } from "./strings.js";

/**
 * The „Sklopivi odeljak" block (NOTE-011): a `details`/`summary`-shaped pair
 * of nodes — a one-line summary and a `block+` body that folds away under it.
 *
 * Three nodes rather than one so the schema itself states the shape:
 * `toggle` = `toggleSummary toggleContent`, and neither child declares a
 * `group`, so neither can appear anywhere but inside a toggle. That is what
 * makes the Markdown export (`noteMarkdown.ts`) able to ask for "the summary"
 * and "the content" by name instead of guessing at the first child.
 *
 * WHERE THE FOLD STATE LIVES — `collapsed` is a node attribute, so it is
 * written into the Yjs document and travels with the note: through the
 * archive, through version history, and (when collaboration grows past one
 * device) through the shared doc. That is a deliberate choice with a real
 * cost, stated plainly: writing it dispatches a Yjs update like any edit, so
 * folding a section bumps the note's `updated_at` — reading a note can nudge
 * it up the "recently changed" list.
 *
 * It is still the right side of the trade. The editor already stores exactly
 * this kind of user-toggled state in content — `taskItem.checked` is a
 * checkbox, persisted in the document, and nobody would want a checklist that
 * forgot itself. The alternative is renderer-local state, and `NoteEditor`
 * mounts `EditorCanvas` per note id: local state would pop every section of a
 * long note open again on every visit, which is the one thing this block
 * exists to prevent. Storing it out-of-document instead would need a durable
 * per-block identity in the document anyway (the `cardKey` pattern), plus a
 * side table that no export carries — strictly more machinery for a worse
 * result.
 *
 * What is NOT stored: the block writes nothing else, ever. Nothing here
 * derives, caches or snapshots any part of the document.
 */

/**
 * The node names, used by the keyboard handler and the insert helper below —
 * one spelling, checked by the compiler nowhere else. The block's own name is
 * exported because in-note find (`noteFindBar.tsx`) must recognise a collapsed
 * toggle around a match in order to open it, and a magic `"toggle"` string
 * over there would be exactly the drift this constant exists to prevent.
 */
export const TOGGLE_NODE_NAME = "toggle";
/** The folded half — the summary above it stays visible either way, which is what in-note find keys off. */
export const TOGGLE_CONTENT_NODE_NAME = "toggleContent";
const TOGGLE_SUMMARY = "toggleSummary";

export const Toggle = Node.create({
  name: TOGGLE_NODE_NAME,
  group: "block",
  content: "toggleSummary toggleContent",
  defining: true,

  addAttributes() {
    return {
      collapsed: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-collapsed") === "true",
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-collapsed": attributes["collapsed"] === true ? "true" : "false",
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-toggle]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toggle": "" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleView);
  },
});

export const ToggleSummary = Node.create({
  name: TOGGLE_SUMMARY,
  // Above the default 100 so this extension's keymap is consulted before the
  // base one — otherwise `splitBlock` claims Enter first and the summary
  // splits into a second summary the schema does not allow.
  priority: 1000,
  content: "inline*",
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: "div[data-toggle-summary]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toggle-summary": "" }), 0];
  },

  /**
   * Enter anywhere in the summary moves into the body rather than splitting
   * the line: the summary is the block's title, and a two-line title is not a
   * thing this block has. A collapsed toggle expands first — the caret must
   * never land somewhere `display: none` has hidden.
   */
  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => enterFromSummary(editor),
    };
  },
});

export const ToggleContent = Node.create({
  name: TOGGLE_CONTENT_NODE_NAME,
  content: "block+",
  defining: true,
  selectable: false,

  parseHTML() {
    return [{ tag: "div[data-toggle-content]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toggle-content": "" }), 0];
  },
});

/** Moves the caret out of a summary and into its sibling content, expanding the toggle if it was folded. False when the caret is not in a summary at all, so Enter keeps its normal meaning everywhere else. */
function enterFromSummary(editor: Editor): boolean {
  const { state, view } = editor;
  const { $from } = state.selection;
  // `depth > 1` because a summary always has its toggle one level above it
  // (the schema allows it nowhere else), and `before(0)` has no position.
  for (let depth = $from.depth; depth > 1; depth -= 1) {
    if ($from.node(depth).type.name !== TOGGLE_SUMMARY) continue;
    const tr = state.tr;
    if ($from.node(depth - 1).attrs["collapsed"] === true) {
      // An attribute change moves no positions, so the selection computed
      // below stays correct in the same transaction.
      tr.setNodeAttribute($from.before(depth - 1), "collapsed", false);
    }
    // `after(depth)` is where the summary ends and the content node begins;
    // `near(…, 1)` walks forward to the first real text position inside it.
    const target = TextSelection.near(tr.doc.resolve($from.after(depth)), 1);
    view.dispatch(tr.setSelection(target).scrollIntoView());
    return true;
  }
  return false;
}

/**
 * Inserts an empty toggle at the caret and leaves the caret in its summary,
 * ready to be titled. Called by the slash menu, which deletes the typed
 * "/query" first — an ordinary local edit from there on, exactly like a
 * template insert.
 */
export function insertToggle(editor: Editor, range: Range): void {
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent({
      type: TOGGLE_NODE_NAME,
      attrs: { collapsed: false },
      content: [
        { type: TOGGLE_SUMMARY },
        { type: TOGGLE_CONTENT_NODE_NAME, content: [{ type: "paragraph" }] },
      ],
    })
    .run();
  focusSummaryOfEnclosingToggle(editor);
}

/**
 * After the insert above, the caret sits inside the new toggle's body. Walking
 * up its own depth chain finds the toggle without any position arithmetic
 * over what `insertContent` did or did not replace; `before(depth) + 2` steps
 * into the toggle and then into its summary. A caret that ended up somewhere
 * else leaves everything alone rather than guessing.
 */
function focusSummaryOfEnclosingToggle(editor: Editor): void {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name !== TOGGLE_NODE_NAME) continue;
    editor.commands.setTextSelection($from.before(depth) + 2);
    return;
  }
}

/**
 * The block view: a chevron button beside the summary+content column. The
 * chevron is drawn in CSS (a bordered triangle rotated by a transform — no
 * icon library, no glyph font), and the blanket reduced-motion rule in
 * `@nexus/ui`'s styles.css collapses its transition to 1ms for anyone who
 * asked for that; the marker itself still turns, because the rotation IS the
 * state, not decoration.
 */
function ToggleView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const collapsed = node.attrs["collapsed"] === true;

  const toggleFold = () => {
    if (!collapsed) moveCaretOutOfContent(editor, getPos(), node.nodeSize);
    updateAttributes({ collapsed: !collapsed });
  };

  return (
    <NodeViewWrapper
      as="div"
      className={collapsed ? "note__toggle note__toggle--collapsed" : "note__toggle"}
    >
      <button
        type="button"
        className="note__toggle-mark"
        // The wrapper keeps a contentDOM, so this subtree is inside the
        // editable region: without this the caret could be placed "in" the
        // chevron. (The table-of-contents block needs no such flag — a leaf
        // node view has no contentDOM, and ProseMirror marks it itself.)
        contentEditable={false}
        aria-expanded={!collapsed}
        aria-label={collapsed ? strings.notes.toggleExpand : strings.notes.toggleCollapse}
        // Without this the mousedown moves the selection into the block first,
        // so the caret lands in content the click is about to hide.
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggleFold}
      />
      <NodeViewContent className="note__toggle-body" />
    </NodeViewWrapper>
  );
}

/** Before folding: if the caret is anywhere inside this toggle, park it in the summary — the one part that stays visible. */
function moveCaretOutOfContent(editor: Editor, pos: number | undefined, nodeSize: number): void {
  if (pos === undefined) return;
  const { from } = editor.state.selection;
  if (from <= pos || from >= pos + nodeSize) return;
  editor.commands.setTextSelection(pos + 2);
}
