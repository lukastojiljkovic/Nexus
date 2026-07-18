import { createContext, useContext } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { isInlineImageMime } from "@nexus/core";
import type { NoteAttachment } from "../../shared/ipc.js";
import { strings } from "./strings.js";

/**
 * The attachment-image block atom (ADR-014 / NOTE-003b), mirroring
 * `noteLink.tsx`'s identity pattern: the node's only durable attribute is the
 * attachment row's `id` — the live row (and its `nx-blob:` bytes) is resolved
 * at render time from a live id->row map (`NoteAttachmentContext`), so the
 * document never embeds bytes or a snapshot of the file's metadata. Removing
 * the attachment from the Prilozi panel is the only way to detach it; deleting
 * this block from the document never removes the underlying attachment.
 */

/** Live lookup context fed by the editor: every attachment currently on this note. */
export interface NoteAttachmentContextValue {
  /** attachment id -> row, rebuilt from `window.nexus.listNoteAttachments` on every load/flush. */
  byId: ReadonlyMap<string, NoteAttachment>;
}

const NoteAttachmentContext = createContext<NoteAttachmentContextValue>({
  byId: new Map(),
});

export const NoteAttachmentProvider = NoteAttachmentContext.Provider;

/**
 * The TipTap node: a block, atomic, selectable node carrying only
 * `attachmentId` (truth). Unlike `noteLink`, it has no text/label content — an
 * image is not text, so there is nothing meaningful to round-trip via the
 * clipboard as a fallback.
 */
export const AttachmentImage = Node.create({
  name: "attachmentImage",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      // No meaningful default — every attachmentImage node must carry a real attachment id.
      attachmentId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-attachment-id"),
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-attachment-id": attributes["attachmentId"],
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-attachment-image]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-attachment-image": "" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AttachmentImageView);
  },
});

/**
 * The block React view: resolves the live row from context. A found row with
 * an inline-previewable mime renders its `nx-blob:` bytes; a removed
 * attachment (or a non-image mime that somehow reached this node) renders a
 * muted placeholder instead. No click handlers, no toolbar — the Prilozi
 * panel owns every attachment action.
 */
function AttachmentImageView({ node }: NodeViewProps) {
  const { byId } = useContext(NoteAttachmentContext);
  const attachmentId =
    typeof node.attrs["attachmentId"] === "string" ? node.attrs["attachmentId"] : "";
  const row = byId.get(attachmentId);

  return (
    <NodeViewWrapper as="div" className="note__attachment-image">
      {row !== undefined && isInlineImageMime(row.mime) ? (
        <img src={`nx-blob://${row.sha256}`} alt={row.fileName} />
      ) : (
        <span className="note__attachment-image--missing">{strings.notes.attachmentMissing}</span>
      )}
    </NodeViewWrapper>
  );
}
