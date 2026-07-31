import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as Y from "yjs";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Collaboration } from "@tiptap/extension-collaboration";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { buildNoteUpdate, parseMarkdownNote } from "@nexus/core";
import { Button } from "@nexus/ui";
import type { DocAttachmentModule, DocTextContent } from "../../shared/ipc.js";
import type { AttachmentPreviewKind } from "./attachmentPreviewKind.js";
import { Callout } from "./noteCallout.js";
import { NoteTableOfContents } from "./noteTableOfContents.js";
import { Toggle, ToggleContent, ToggleSummary } from "./noteToggle.js";
import { strings } from "./strings.js";

/**
 * The „Pregledaj" dialog (DOC tier 0, ADR-064): ONE house preview component
 * for the three public attachment surfaces — an image lightbox around the
 * existing `nx-blob:` URL, an escaped `<pre>` for `.txt`, and a read-only
 * TipTap render for `.md`. PDF rows never reach this dialog: their „Pregledaj"
 * calls `previewAttachment` (the dedicated hardened window) instead, which is
 * why `kind` here excludes `"pdf"` by type.
 *
 * Text and markdown content arrives over `doc:read-text` as a structured
 * reply, never a renderer fetch — the packaged CSP's `connect-src 'self'`
 * blocks `nx-blob:` fetches, and the house posture (the attachment's bytes
 * never cross this boundary as bytes) stays intact. Images need no channel at
 * all: `<img src="nx-blob://…">` is the same served URL the Prilozi thumbnails
 * already use.
 *
 * Chrome is the house dialog recipe (backdrop and panel as siblings, Escape
 * and the backdrop close, focus returned on close — `ShortcutsDialog`'s own
 * ritual), widened and scrolling in its body.
 */

/** The index-row fields every attachment table shares that the dialog needs — `NoteAttachment`/`TaskAttachment`/`SubjectAttachment` all satisfy it structurally. */
export interface PreviewableAttachment {
  id: string;
  fileName: string;
  sha256: string;
}

export interface AttachmentPreviewDialogProps {
  profileId: string;
  module: DocAttachmentModule;
  /** The owning record — the note, task or subject the attachment hangs off. */
  ownerId: string;
  attachment: PreviewableAttachment;
  /** Never `"pdf"` — that kind opens the dedicated window, not this dialog. */
  kind: Exclude<AttachmentPreviewKind, "pdf">;
  onClose: () => void;
}

export function AttachmentPreviewDialog({
  profileId,
  module,
  ownerId,
  attachment,
  kind,
  onClose,
}: AttachmentPreviewDialogProps) {
  const actionsRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // Focus goes to the only control there is, and back where it came from on
  // close — ShortcutsDialog's rule, so dismissing the preview never strands
  // the keyboard on a portal that no longer exists.
  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    actionsRef.current?.querySelector("button")?.focus();
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onClose} />
      <div
        className="recur-dialog__panel doc-preview__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="recur-dialog__title doc-preview__title">
          {attachment.fileName}
        </h2>
        <div className="doc-preview__body">
          {kind === "image" ? (
            <img
              className="doc-preview__image"
              src={`nx-blob://${attachment.sha256}`}
              alt={attachment.fileName}
            />
          ) : (
            <TextualPreview
              profileId={profileId}
              module={module}
              ownerId={ownerId}
              attachmentId={attachment.id}
              kind={kind}
            />
          )}
        </div>
        <div className="recur-dialog__actions" ref={actionsRef}>
          <Button className="recur-dialog__cancel" onClick={onClose}>
            {strings.attachmentPreview.close}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface TextualPreviewProps {
  profileId: string;
  module: DocAttachmentModule;
  ownerId: string;
  attachmentId: string;
  kind: "text" | "markdown";
}

/** Loads the attachment's decoded text over `doc:read-text` once per mount, then hands it to the pane its kind names. */
function TextualPreview({ profileId, module, ownerId, attachmentId, kind }: TextualPreviewProps) {
  const [content, setContent] = useState<DocTextContent | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setFailed(false);
    void (async () => {
      try {
        const loaded = await window.nexus.readAttachmentText(
          profileId,
          module,
          ownerId,
          attachmentId,
        );
        if (!cancelled) setContent(loaded);
      } catch (error) {
        if (!cancelled) setFailed(true);
        console.error("Nexus: failed to read attachment text:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, module, ownerId, attachmentId]);

  if (failed) {
    return (
      <div className="doc-preview__error" role="status">
        {strings.attachmentPreview.error}
      </div>
    );
  }
  if (content === null) {
    return <p className="app__muted">{strings.app.loading}</p>;
  }
  if (kind === "text") {
    // React escapes the interpolated text, so this stays an inert <pre>
    // whatever the file contains.
    return <pre className="doc-preview__text">{content.text}</pre>;
  }
  return <MarkdownPreview name={content.name} text={content.text} />;
}

/**
 * The read-only render of a `.md` attachment: `parseMarkdownNote` (the
 * complete, tested IMEX-007 parser) composed with `buildNoteUpdate` into a
 * throwaway `Y.Doc`, replayed through the same read-only editor recipe
 * `noteVersionHistory`'s `VersionPreview` uses — built once per mount and
 * destroyed on unmount. The extension set is the parser's OUTPUT vocabulary:
 * everything `buildNoteUpdate` can emit (StarterKit's blocks, task lists, the
 * three NOTE-011 containers, the ToC marker) and nothing it cannot —
 * wiki-links and attachment images deliberately degrade to plain text in the
 * parser itself, so their extensions have nothing to render here.
 */
function MarkdownPreview({ name, text }: { name: string; text: string }) {
  const [previewDoc] = useState(() => {
    const doc = new Y.Doc();
    // The parser's contract: the fallback title is the file name without its
    // extension, materialised as a leading heading when the text has none.
    const parsed = parseMarkdownNote(text, name.replace(/\.[^.]+$/, ""));
    Y.applyUpdate(doc, buildNoteUpdate(parsed.blocks));
    return doc;
  });

  useEffect(() => {
    return () => previewDoc.destroy();
  }, [previewDoc]);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        undoRedo: false,
        heading: { levels: [1, 2, 3] },
        strike: false,
        underline: false,
        dropcursor: { color: "var(--nx-accent)", width: 2 },
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Collaboration.configure({ document: previewDoc, field: "default" }),
      Callout,
      Toggle,
      ToggleSummary,
      ToggleContent,
      NoteTableOfContents,
    ],
    [previewDoc],
  );

  const editor = useEditor(
    {
      extensions,
      editable: false,
      immediatelyRender: false,
      editorProps: { attributes: { class: "note__prosemirror" } },
    },
    [previewDoc],
  );

  return <EditorContent editor={editor} />;
}
