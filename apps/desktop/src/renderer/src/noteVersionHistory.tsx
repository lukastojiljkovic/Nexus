import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@nexus/ui";
import * as Y from "yjs";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Collaboration } from "@tiptap/extension-collaboration";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import type { NoteAttachment, NoteVersionMeta } from "../../shared/ipc.js";
import { AttachmentImage, NoteAttachmentProvider } from "./noteAttachmentImage.js";
import { NoteLink, NoteLinkProvider } from "./noteLink.js";
import { strings } from "./strings.js";

/**
 * The "Istorija verzija" in-pane mode (ADR-015 / NOTE-008b): browse a note's
 * checkpoints and preview one read-only before restoring it. `NoteEditor`
 * mounts this in place of the live canvas while `mode === "history"`; the
 * live `Y.Doc` and its flush machinery stay untouched underneath.
 */

/** List-row timestamp: sr-Latn day/month/year + time — never plain "sr" (mis-tailors š/č/ć). */
const HISTORY_DATE_FORMATTER = new Intl.DateTimeFormat("sr-Latn", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export interface NoteVersionHistoryProps {
  profileId: string;
  noteId: string;
  titles: ReadonlyMap<string, string>;
  onOpenNote: (id: string) => void;
  attachmentsById: ReadonlyMap<string, NoteAttachment>;
  /** Called with the selected version's already-loaded snapshot bytes. */
  onRestore: (versionSnapshot: Uint8Array) => void;
  /** Disables the restore button while the parent's restore flow runs. */
  restoring: boolean;
}

export function NoteVersionHistory({
  profileId,
  noteId,
  titles,
  onOpenNote,
  attachmentsById,
  onRestore,
  restoring,
}: NoteVersionHistoryProps) {
  const [versions, setVersions] = useState<NoteVersionMeta[] | null>(null);
  const [listError, setListError] = useState(false);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [selectedBytes, setSelectedBytes] = useState<Uint8Array | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Loads the browse list once per note; auto-selects the newest (first,
  // since `listNoteVersions` returns newest-first) checkpoint.
  useEffect(() => {
    let cancelled = false;
    setVersions(null);
    setListError(false);
    setSelectedSeq(null);
    void (async () => {
      try {
        const list = await window.nexus.listNoteVersions(profileId, noteId);
        if (cancelled) return;
        setVersions(list);
        if (list.length > 0) setSelectedSeq(list[0]!.coveredSeq);
      } catch (error) {
        if (!cancelled) setListError(true);
        console.error("Nexus: failed to load note versions:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, noteId]);

  // Loads the selected row's snapshot bytes — no cache, so re-selecting the
  // same row refetches. A failure here is independent from the list failure.
  useEffect(() => {
    if (selectedSeq === null) return;
    let cancelled = false;
    setSelectedBytes(null);
    setLoadError(false);
    void (async () => {
      try {
        const bytes = await window.nexus.loadNoteVersion(profileId, noteId, selectedSeq);
        if (!cancelled) setSelectedBytes(bytes);
      } catch (error) {
        if (!cancelled) setLoadError(true);
        console.error("Nexus: failed to load note version:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, noteId, selectedSeq]);

  if (versions === null) {
    return <p className="nx-hint">{strings.app.loading}</p>;
  }
  if (listError) {
    return (
      <div className="note__history-error" role="status">
        {strings.notes.historyError}
      </div>
    );
  }
  if (versions.length === 0) {
    return <EmptyState variant="inline" title={strings.notes.historyEmpty} />;
  }

  return (
    <div className="note__history">
      <div className="note__history-list">
        <h3 className="note__history-title">
          {strings.notes.historyTitle} ({versions.length})
        </h3>
        {versions.map((version) => {
          const isSelected = version.coveredSeq === selectedSeq;
          return (
            <button
              key={version.coveredSeq}
              type="button"
              className={
                isSelected
                  ? "note__history-item note__history-item--selected"
                  : "note__history-item"
              }
              aria-current={isSelected ? "true" : undefined}
              onClick={() => setSelectedSeq(version.coveredSeq)}
            >
              <span className="note__history-item-time">
                {HISTORY_DATE_FORMATTER.format(new Date(version.createdAt))}
              </span>
              <span className="note__history-item-title">
                {version.title.trim().length > 0 ? version.title : strings.notes.untitled}
              </span>
            </button>
          );
        })}
      </div>
      <div className="note__history-preview">
        {loadError ? (
          <div className="note__history-error" role="status">
            {strings.notes.historyError}
          </div>
        ) : selectedBytes === null ? (
          <p className="nx-hint">{strings.app.loading}</p>
        ) : (
          <VersionPreview
            key={selectedSeq}
            bytes={selectedBytes}
            titles={titles}
            onOpenNote={onOpenNote}
            attachmentsById={attachmentsById}
          />
        )}
      </div>
      <div className="note__history-restore-row">
        <button
          type="button"
          className="note__attach"
          disabled={restoring || selectedBytes === null}
          onClick={() => {
            if (selectedBytes !== null) onRestore(selectedBytes);
          }}
        >
          {strings.notes.historyRestore}
        </button>
        <p className="note__history-note">{strings.notes.historyRestoreNote}</p>
      </div>
    </div>
  );
}

interface VersionPreviewProps {
  bytes: Uint8Array;
  titles: ReadonlyMap<string, string>;
  onOpenNote: (id: string) => void;
  attachmentsById: ReadonlyMap<string, NoteAttachment>;
}

/**
 * The read-only render of one checkpoint. Mounted with `key={selectedSeq}` by
 * the parent so every selection change fully remounts it — a fresh throwaway
 * `Y.Doc` per instance, replayed once from `bytes` and destroyed on unmount.
 * Same content extensions as the live `EditorCanvas`, minus the slash/wiki-link
 * suggestion plugins and `Placeholder` — a preview never takes input.
 */
function VersionPreview({ bytes, titles, onOpenNote, attachmentsById }: VersionPreviewProps) {
  const [previewDoc] = useState(() => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, bytes);
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
      NoteLink,
      AttachmentImage,
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

  return (
    <NoteAttachmentProvider value={{ byId: attachmentsById }}>
      <NoteLinkProvider value={{ titles, onOpenNote }}>
        <EditorContent editor={editor} />
      </NoteLinkProvider>
    </NoteAttachmentProvider>
  );
}
