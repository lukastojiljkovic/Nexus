import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@nexus/ui";
import * as Y from "yjs";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Collaboration } from "@tiptap/extension-collaboration";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import type { PrivAttachmentRef, PrivNoteEnvelopePayload, PrivNoteVersionMeta } from "../../shared/ipc.js";
import { NoteLink, NoteLinkProvider } from "./noteLink.js";
import { PrivAttachmentImage, PrivAttachmentProvider } from "./privAttachmentImage.js";
import { strings } from "./strings.js";

/**
 * „Istorija verzija" inside the private section (ADR-057) — `noteVersionHistory.tsx`'s
 * surface, so the two read as one app, constrained by sealing at every point
 * the public one is not:
 *
 *  - the browse list carries the only two CLEARTEXT facts a sealed version row
 *    has (its capture time and its sequence). There is no title column here on
 *    purpose: a private version's title lives INSIDE its container, and opening
 *    every container to label a list would decrypt the whole history to draw
 *    one column. The selected version's title is shown instead, once it is
 *    opened for the preview anyway.
 *  - the renderer never receives a sealed container. Main unseals the selected
 *    version and answers the CLEARTEXT ENVELOPE — exactly what the unlocked
 *    editor already receives for the live note, and nothing more.
 *  - the panel exists only while the section is unlocked: every call behind it
 *    is refused otherwise, and the section unmounts this whole tree on lock.
 */

/** List-row timestamp: sr-Latn day/month/year + time — never plain "sr" (mis-tailors š/č/ć). */
const HISTORY_DATE_FORMATTER = new Intl.DateTimeFormat("sr-Latn", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Wiki-links resolve to nothing here, exactly as in the live private canvas: their targets are PUBLIC notes the section never opens. */
const INERT_NOTE_LINKS = { titles: new Map<string, string>(), onOpenNote: () => {} };

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface PrivVersionHistoryProps {
  profileId: string;
  noteId: string;
  /** Called with the selected version's already-opened envelope — the restore is the parent's edit to make. */
  onRestore: (version: PrivNoteEnvelopePayload) => void;
  /** Disables the restore button while the parent's restore flow runs. */
  restoring: boolean;
  /** Called after any failed call: the section may have locked underneath this panel. */
  onMaybeLocked: () => void;
}

export function PrivVersionHistory({
  profileId,
  noteId,
  onRestore,
  restoring,
  onMaybeLocked,
}: PrivVersionHistoryProps) {
  const s = strings.priv.editor.history;
  const [versions, setVersions] = useState<PrivNoteVersionMeta[] | null>(null);
  const [listError, setListError] = useState(false);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [selected, setSelected] = useState<PrivNoteEnvelopePayload | null>(null);
  const [loadError, setLoadError] = useState(false);

  // The browse list, once per note; the newest version (first — main answers
  // newest-first) is selected on arrival.
  useEffect(() => {
    let cancelled = false;
    setVersions(null);
    setListError(false);
    setSelectedSeq(null);
    void (async () => {
      try {
        const list = await window.nexus.privListVersions(profileId, noteId);
        if (cancelled) return;
        setVersions(list);
        if (list.length > 0) setSelectedSeq(list[0]!.seq);
      } catch (error) {
        if (!cancelled) {
          setListError(true);
          onMaybeLocked();
        }
        console.error("Nexus: failed to list private note versions:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, noteId, onMaybeLocked]);

  // The selected version's cleartext, unsealed by main one selection at a time
  // — no cache, so re-selecting the same row asks again and nothing decrypted
  // lingers in this component beyond the row on screen.
  useEffect(() => {
    if (selectedSeq === null) return;
    let cancelled = false;
    setSelected(null);
    setLoadError(false);
    void (async () => {
      try {
        const envelope = await window.nexus.privReadVersion(profileId, noteId, selectedSeq);
        if (!cancelled) setSelected(envelope);
      } catch (error) {
        if (!cancelled) {
          setLoadError(true);
          onMaybeLocked();
        }
        console.error("Nexus: failed to open a private note version:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, noteId, selectedSeq, onMaybeLocked]);

  if (listError) {
    return (
      <div className="note__history-error" role="status">
        {s.error}
      </div>
    );
  }
  if (versions === null) {
    return <p className="app__muted">{strings.app.loading}</p>;
  }
  if (versions.length === 0) {
    return <EmptyState variant="inline" title={s.empty} />;
  }

  return (
    <div className="note__history">
      <div className="note__history-list">
        <h3 className="note__history-title">
          {s.title} ({versions.length})
        </h3>
        {versions.map((version) => {
          const isSelected = version.seq === selectedSeq;
          return (
            <button
              key={version.seq}
              type="button"
              className={
                isSelected
                  ? "note__history-item note__history-item--selected"
                  : "note__history-item"
              }
              aria-current={isSelected ? "true" : undefined}
              onClick={() => setSelectedSeq(version.seq)}
            >
              <span className="note__history-item-time">
                {HISTORY_DATE_FORMATTER.format(new Date(version.createdAt))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="note__history-preview">
        {loadError ? (
          <div className="note__history-error" role="status">
            {s.error}
          </div>
        ) : selected === null ? (
          <p className="app__muted">{strings.app.loading}</p>
        ) : (
          <>
            <h3 className="note__history-title">{s.previewLabel}</h3>
            <p className="note__history-item-time">
              {selected.title.trim().length > 0 ? selected.title : strings.notes.untitled}
            </p>
            <PrivVersionPreview
              key={selectedSeq}
              yjsState={selected.yjsState}
              attachments={selected.attachments}
            />
          </>
        )}
      </div>
      <div className="note__history-restore-row">
        <button
          type="button"
          className="note__attach"
          disabled={restoring || selected === null}
          onClick={() => {
            if (selected !== null) onRestore(selected);
          }}
        >
          {s.restore}
        </button>
        <p className="note__history-note">{s.restoreNote}</p>
      </div>
    </div>
  );
}

interface PrivVersionPreviewProps {
  yjsState: string;
  attachments: PrivAttachmentRef[];
}

/**
 * The read-only render of one sealed version. Mounted with `key={selectedSeq}`
 * by the parent, so every selection change fully remounts it — a fresh
 * throwaway `Y.Doc` per instance, replayed once and destroyed on unmount.
 * `PrivEditorCanvas`'s content extensions minus everything that takes input,
 * and the private attachment provider so a version's images resolve through
 * `priv-blob://` exactly as the live editor's do.
 */
function PrivVersionPreview({ yjsState, attachments }: PrivVersionPreviewProps) {
  const [previewDoc] = useState(() => {
    const doc = new Y.Doc();
    const seed = fromBase64(yjsState);
    if (seed.byteLength > 0) Y.applyUpdate(doc, seed);
    return doc;
  });

  useEffect(() => {
    return () => previewDoc.destroy();
  }, [previewDoc]);

  const attachmentsById = useMemo(
    () => new Map(attachments.map((ref) => [ref.id, ref])),
    [attachments],
  );

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
      PrivAttachmentImage,
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
    <PrivAttachmentProvider value={{ byId: attachmentsById }}>
      <NoteLinkProvider value={INERT_NOTE_LINKS}>
        <EditorContent editor={editor} />
      </NoteLinkProvider>
    </PrivAttachmentProvider>
  );
}
