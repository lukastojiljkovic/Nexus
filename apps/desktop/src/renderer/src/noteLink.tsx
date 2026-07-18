import { createContext, useContext } from "react";
import type { KeyboardEvent } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { strings } from "./strings.js";

/**
 * The wiki-link inline atom (ADR-013 / NOTE-004b). The node's only durable
 * attribute is the target note's `id` — `label` is a presentation snapshot
 * only, never truth. The displayed title is resolved at render time from a
 * live id→title map (`NoteLinkContext`), so renaming a note updates every
 * link label with zero document rewrites.
 */

/** Live navigation context fed by the editor: current titles + how to open a note. */
export interface NoteLinkContextValue {
  /** id -> title, built fresh from `window.nexus.listNotes` on every load/flush. */
  titles: ReadonlyMap<string, string>;
  onOpenNote: (id: string) => void;
}

const NoteLinkContext = createContext<NoteLinkContextValue>({
  titles: new Map(),
  onOpenNote: () => {},
});

export const NoteLinkProvider = NoteLinkContext.Provider;

/**
 * The TipTap node: an inline, atomic, selectable span carrying `noteId`
 * (truth) and `label` (fallback snapshot for missing/unresolvable targets and
 * for clipboard round-trip via its text content).
 */
export const NoteLink = Node.create({
  name: "noteLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      // No meaningful default — every noteLink node must carry a real target id.
      noteId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-note-id"),
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-note-id": attributes["noteId"],
        }),
      },
      label: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-label") ?? element.textContent ?? "",
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-label": attributes["label"],
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-note-link]" }];
  },

  // The label is rendered as the element's text content too, so a link
  // round-trips through the clipboard as readable text.
  renderHTML({ HTMLAttributes }) {
    const label = typeof HTMLAttributes["data-label"] === "string" ? HTMLAttributes["data-label"] : "";
    return ["span", mergeAttributes(HTMLAttributes, { "data-note-link": "" }), label];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteLinkView);
  },
});

/**
 * The inline React view: resolves the live title from context (falling back
 * to the untitled label when it's blank), then the node's own `label`
 * snapshot, then the missing-target string. Click/Enter navigates via
 * `onOpenNote` — an inline atom's accessible affordance is a `role="link"`
 * span with keyboard activation, matching how a real link node would behave
 * without pulling in a full `<button>`'s block-level focus ring.
 */
function NoteLinkView({ node }: NodeViewProps) {
  const { titles, onOpenNote } = useContext(NoteLinkContext);
  const noteId = typeof node.attrs["noteId"] === "string" ? node.attrs["noteId"] : "";
  const label = typeof node.attrs["label"] === "string" ? node.attrs["label"] : "";

  const liveTitle = titles.get(noteId);
  const missing = liveTitle === undefined;
  const text = !missing
    ? liveTitle.trim().length > 0
      ? liveTitle
      : strings.notes.untitled
    : label.trim().length > 0
      ? label
      : strings.notes.wikiLinkMissing;

  // A missing target (soft-deleted or unresolvable) has nowhere to navigate:
  // the chip reads muted and inert (cursor: default), and activating it would
  // only land on the editor's load-error state. Restoring the note revives
  // the link — titles refresh on every load/flush.
  const open = () => {
    if (!missing) onOpenNote(noteId);
  };

  return (
    <NodeViewWrapper
      as="span"
      className={missing ? "note__wikilink note__wikilink--missing" : "note__wikilink"}
      role="link"
      aria-disabled={missing || undefined}
      tabIndex={0}
      onClick={open}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          open();
        }
      }}
    >
      {text}
    </NodeViewWrapper>
  );
}
