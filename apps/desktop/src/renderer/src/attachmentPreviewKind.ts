import { isInlineImageMime } from "@nexus/core";
import { DOC_TEXT_PREVIEW_MAX_BYTES } from "../../shared/ipc.js";

/**
 * Which preview an attachment row's „Pregledaj" opens (DOC / ADR-064), or
 * `null` when the row offers none and keeps „Otvori" as its only viewer.
 * `"pdf"` goes to the dedicated hardened window (`previewAttachment`); the
 * other three kinds share the one in-app dialog (`attachmentPreview.tsx`).
 *
 * The decision is `isPreviewableMime`'s (image / pdf / text), spelled out here
 * because the renderer needs the finer split that predicate deliberately does
 * not carry — which text pane, and one recorded widening: a row stored BEFORE
 * the text sniff carries `application/octet-stream`, and for those (and only
 * those) a display-only `.txt`/`.md` extension reading may OFFER the preview.
 * The stored mime — and with it what `nx-blob:` serves — stays untouched; a
 * `.txt`-named zip still offers nothing, because the mime rules first.
 */
export type AttachmentPreviewKind = "image" | "pdf" | "text" | "markdown";

export function attachmentPreviewKind(
  mime: string,
  fileName: string,
  sizeBytes: number,
): AttachmentPreviewKind | null {
  if (isInlineImageMime(mime)) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime !== "text/plain" && mime !== "application/octet-stream") return null;
  const byExtension = fileName.toLowerCase().endsWith(".md") ? "markdown" : "text";
  // Past the doc:read-text cap there is nothing to open the dialog WITH — the
  // menu simply does not offer what the channel would refuse.
  if (sizeBytes > DOC_TEXT_PREVIEW_MAX_BYTES) return null;
  if (mime === "text/plain") return byExtension;
  return fileName.toLowerCase().endsWith(".txt") || byExtension === "markdown"
    ? byExtension
    : null;
}
