import { createContext, useContext } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { isInlineImageMime } from "@nexus/core";
import type { PrivAttachmentRef } from "../../shared/ipc.js";
import { strings } from "./strings.js";

/**
 * The PRIVATE editor's `attachmentImage` node (PRIV v1 / ADR-057) — the SAME
 * node name and attribute `noteAttachmentImage.tsx` declares, deliberately: a
 * note moved between the public and private stores keeps its image blocks,
 * and `remapNoteState` rewrites only the id they carry. Only the VIEW
 * differs: the row resolves from the envelope's own reference list, and the
 * bytes come through `priv-blob:` — decrypted by main strictly while the
 * section is unlocked — never `nx-blob:`.
 */

export interface PrivAttachmentContextValue {
  /** reference id -> reference, rebuilt from the open envelope on every change. */
  byId: ReadonlyMap<string, PrivAttachmentRef>;
}

const PrivAttachmentContext = createContext<PrivAttachmentContextValue>({ byId: new Map() });

export const PrivAttachmentProvider = PrivAttachmentContext.Provider;

export const PrivAttachmentImage = Node.create({
  name: "attachmentImage",
  group: "block",
  atom: true,
  selectable: true,

  addAttributes() {
    return {
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
    return ReactNodeViewRenderer(PrivAttachmentImageView);
  },
});

/** Resolves the live reference; anything unresolvable (or not an image) renders the public editor's own missing-attachment placeholder. */
function PrivAttachmentImageView({ node }: NodeViewProps) {
  const { byId } = useContext(PrivAttachmentContext);
  const attachmentId =
    typeof node.attrs["attachmentId"] === "string" ? node.attrs["attachmentId"] : "";
  const ref = byId.get(attachmentId);

  return (
    <NodeViewWrapper as="div" className="note__attachment-image">
      {ref !== undefined && isInlineImageMime(ref.mime) ? (
        <img src={`priv-blob://${ref.id}`} alt={ref.fileName} />
      ) : (
        <span className="note__attachment-image--missing">{strings.notes.attachmentMissing}</span>
      )}
    </NodeViewWrapper>
  );
}
