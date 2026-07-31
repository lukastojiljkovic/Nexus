import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Collaboration } from "@tiptap/extension-collaboration";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { isInlineImageMime, mergeNoteState, replaceNoteContent } from "@nexus/core";
import { EmptyState } from "@nexus/ui";
import {
  PRIV_ATTACHMENTS_MAX_COUNT,
  PRIV_PLAINTEXT_MAX_BYTES,
  PRIV_STATE_MAX_BYTES,
  PRIV_TITLE_MAX_BYTES,
  type PrivAttachmentRef,
  type PrivNoteEnvelopePayload,
} from "../../shared/ipc.js";
import { Callout } from "./noteCallout.js";
import { createNoteFindExtension, NoteFindBar } from "./noteFindBar.js";
import { NoteLink, NoteLinkProvider } from "./noteLink.js";
import { readStoredNoteMarkdownShortcuts } from "./notePrefs.js";
import { createSlashExtension, SlashMenu, type SlashRenderState } from "./noteSlashMenu.js";
import { NoteTableOfContents } from "./noteTableOfContents.js";
import { Toggle, ToggleContent, ToggleSummary } from "./noteToggle.js";
import { PrivAttachmentImage, PrivAttachmentProvider } from "./privAttachmentImage.js";
import { PrivVersionHistory } from "./privVersionHistory.js";
import { strings } from "./strings.js";

/**
 * The private editor (PRIV v1 / ADR-057): `NoteEditor.tsx`'s TipTap surface
 * over a PRIVATE storage adapter. One fresh `Y.Doc` per open note, seeded
 * from the envelope's whole `yjsState`; on the same 800 ms debounce the
 * public editor uses, the WHOLE envelope is re-serialized and `privWrite`n —
 * no update log, no checkpoints of its own: whole-envelope writes are the
 * design (main captures sealed versions on its own cadence).
 *
 * „Istorija verzija" IS here (ADR-057), as its own in-pane mode exactly like
 * the public editor's: the panel browses the note's sealed versions and
 * previews one read-only, and restoring is an ORDINARY EDIT — the current
 * state is captured as a version first, then the version's content is written
 * forward through the normal write path, so the step the user just took is
 * itself undoable by restoring what that capture holds.
 *
 * What is deliberately NOT here, and why (each is a coupling to a PUBLIC
 * store the private section must never touch):
 *  - the `[[` wiki-link MENU and backlinks (they query public notes) — the
 *    `noteLink` NODE is registered so a moved-in note's links still render,
 *    resolving to their label snapshot, inert;
 *  - inline flashcards and the deck bar (they sync into STUDY decks);
 *  - templates and the Šabloni pane (public template rows);
 *  - open-externally / save-as for attachments (the recorded v1 limit: no
 *    plaintext temp copies — files open only inside, said in the copy).
 */

/** Debounce after the last keystroke before the whole envelope is re-written — the public editor's own cadence. */
const FLUSH_DEBOUNCE_MS = 800;

/** Locale-aware one-decimal formatter for `formatBytes` — `NoteEditor.tsx`'s own recipe, module-local there too. */
const BYTES_FORMATTER = new Intl.NumberFormat("sr-Latn", { maximumFractionDigits: 1 });

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${BYTES_FORMATTER.format(kb)} KB`;
  return `${BYTES_FORMATTER.format(kb / 1024)} MB`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** UTF-8 byte length without allocating an encoded copy per keystroke beyond the one TextEncoder makes. */
const UTF8 = new TextEncoder();

/** Truncates `value` to at most `maxBytes` of UTF-8, never splitting a code point — the honest cap for the plaintext search mirror. */
function capUtf8Bytes(value: string, maxBytes: number): string {
  if (UTF8.encode(value).length <= maxBytes) return value;
  let result = "";
  let bytes = 0;
  for (const char of value) {
    const size = UTF8.encode(char).length;
    if (bytes + size > maxBytes) break;
    result += char;
    bytes += size;
  }
  return result;
}

/**
 * The note's title: the first non-empty line of the derived plaintext,
 * trimmed, capped at 200 characters (the public store's own title rule) and
 * at the envelope's byte bound. The plaintext's lines ARE the document's
 * blocks in order (`mergeNoteState`'s walk), so this matches the public
 * editor's first-non-empty-block derivation without a second tree walk.
 */
function deriveTitle(plaintext: string): string {
  for (const line of plaintext.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return capUtf8Bytes(trimmed.slice(0, 200), PRIV_TITLE_MAX_BYTES);
  }
  return "";
}

export interface PrivNoteEditorProps {
  profileId: string;
  noteId: string;
  /** Called after each successful whole-envelope write, so the page can refresh the list's titles. */
  onSaved: () => void;
  /** Called after any failed IPC call: the section may have locked underneath this editor, and only the page can find out and swap the lock screen in. */
  onMaybeLocked: () => void;
}

export function PrivNoteEditor({ profileId, noteId, onSaved, onMaybeLocked }: PrivNoteEditorProps) {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveError, setSaveError] = useState<"generic" | "tooLarge" | null>(null);
  const [attachments, setAttachments] = useState<PrivAttachmentRef[]>([]);
  const [attachmentError, setAttachmentError] = useState<
    "generic" | "tooLarge" | "tooMany" | null
  >(null);
  const [attaching, setAttaching] = useState(false);
  const [mode, setMode] = useState<"edit" | "history">("edit");
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState(false);

  const docRef = useRef<Y.Doc | null>(null);
  const dirtyRef = useRef(false);
  const inFlightRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());
  // `flush` runs from the unmount cleanup too, after React stops re-rendering
  // — every mutable value it reads goes through a ref (NoteEditor's own rule).
  const attachmentsRef = useRef<PrivAttachmentRef[]>([]);
  const onSavedRef = useRef(onSaved);
  const onMaybeLockedRef = useRef(onMaybeLocked);
  useEffect(() => {
    onSavedRef.current = onSaved;
    onMaybeLockedRef.current = onMaybeLocked;
  }, [onSaved, onMaybeLocked]);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, FLUSH_DEBOUNCE_MS);
  }, []);

  const flush = useCallback(async () => {
    if (!dirtyRef.current || inFlightRef.current) return;
    const liveDoc = docRef.current;
    if (liveDoc === null) return;
    // The whole prologue is synchronous, BEFORE any await: the unmount
    // cleanup calls this and then destroys the doc, so nothing may read it
    // past the first suspension point.
    const state = Y.encodeStateAsUpdate(liveDoc);
    const yjsState = toBase64(state);
    // The derived plaintext IS the search mirror; `mergeNoteState` is the one
    // core walker the public pipeline indexes with (SEC-ZK-05 stays a mirror
    // of the same walk, sealed instead of indexed).
    const plaintext = capUtf8Bytes(mergeNoteState(state, []).plaintext, PRIV_PLAINTEXT_MAX_BYTES);
    if (yjsState.length > PRIV_STATE_MAX_BYTES) {
      // Left dirty: a later edit (presumably a deletion) retries.
      setSaveError("tooLarge");
      return;
    }
    const envelope = {
      title: deriveTitle(plaintext),
      yjsState,
      plaintext,
      attachments: attachmentsRef.current,
    };
    dirtyRef.current = false;
    inFlightRef.current = true;
    try {
      await window.nexus.privWrite(profileId, noteId, envelope);
      setSaveError(null);
      onSavedRef.current();
      if (dirtyRef.current) scheduleFlush();
    } catch (error) {
      dirtyRef.current = true; // never drop — the next edit or flush retries
      setSaveError("generic");
      console.error("Nexus: failed to persist private note:", error);
      onMaybeLockedRef.current();
    } finally {
      inFlightRef.current = false;
    }
  }, [profileId, noteId, scheduleFlush]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Best-effort final flush before the window unloads (the prologue is sync).
  useEffect(() => {
    const onBeforeUnload = () => void flushRef.current();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Load: one fresh doc, seeded from the envelope, listener attached AFTER
  // seeding so hydration never marks the note dirty.
  useEffect(() => {
    let cancelled = false;
    let created: Y.Doc | null = null;
    let handler: (() => void) | null = null;
    setDoc(null);
    setLoadFailed(false);
    setSaveError(null);
    setAttachmentError(null);
    dirtyRef.current = false;
    attachmentsRef.current = [];
    setAttachments([]);

    void (async () => {
      try {
        const envelope = await window.nexus.privRead(profileId, noteId);
        if (cancelled) return;
        const next = new Y.Doc();
        const seed = fromBase64(envelope.yjsState);
        if (seed.byteLength > 0) Y.applyUpdate(next, seed);
        handler = () => {
          dirtyRef.current = true;
          scheduleFlush();
        };
        next.on("update", handler);
        created = next;
        docRef.current = next;
        attachmentsRef.current = envelope.attachments;
        setAttachments(envelope.attachments);
        setDoc(next);
      } catch (error) {
        if (!cancelled) {
          setLoadFailed(true);
          onMaybeLockedRef.current();
        }
        console.error("Nexus: failed to load private note:", error);
      }
    })();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Final flush on unmount/switch — its prologue reads the doc before
      // this cleanup destroys it (see `flush`) — and then the CLOSE CAPTURE
      // (ADR-057): the surface is being left, so what was written since the
      // last capture becomes a version, the flush included. Best-effort, like
      // the flush itself: main refuses while locked, which costs nothing —
      // every lock path captures on its own way out.
      void flushRef.current()
        .then(() => window.nexus.privCaptureVersion(profileId, noteId))
        .catch((error: unknown) => {
          console.error("Nexus: failed to capture a closing private note version:", error);
        });
      if (created !== null && handler !== null) created.off("update", handler);
      if (created !== null) created.destroy();
      if (docRef.current === created) docRef.current = null;
    };
  }, [profileId, noteId, scheduleFlush]);

  /**
   * Restore (ADR-057): flush the pending keystrokes so the checkpoint below
   * includes them, capture the CURRENT state as a version, then rewrite the
   * live doc forward to the chosen one — `replaceNoteContent` deletes and
   * re-inserts the "default" fragment's children in one transaction, so this
   * is an ordinary edit the normal write path persists, never a destructive
   * load of old bytes. The version's own attachment references are merged into
   * the live envelope's, because the restored content's images resolve through
   * that list and dropping them would restore a note with broken pictures; the
   * envelope's own cap is respected, current references first.
   */
  const restoreVersion = useCallback(
    async (version: PrivNoteEnvelopePayload) => {
      const liveDoc = docRef.current;
      if (restoring || liveDoc === null) return;
      setRestoring(true);
      setRestoreError(false);
      try {
        await flushRef.current();
        await window.nexus.privCaptureVersion(profileId, noteId);
        // Re-checked after the awaits: a note switched away in the meantime
        // destroyed that doc, and writing into it would be an edit to a note
        // nobody is looking at anymore.
        if (docRef.current !== liveDoc) return;
        const merged = [...attachmentsRef.current];
        for (const ref of version.attachments) {
          if (merged.length >= PRIV_ATTACHMENTS_MAX_COUNT) break;
          if (!merged.some((existing) => existing.id === ref.id)) merged.push(ref);
        }
        attachmentsRef.current = merged;
        setAttachments(merged);
        replaceNoteContent(liveDoc, fromBase64(version.yjsState));
        dirtyRef.current = true;
        await flushRef.current();
        setMode("edit");
      } catch (error) {
        setRestoreError(true);
        console.error("Nexus: failed to restore a private note version:", error);
        onMaybeLockedRef.current();
      } finally {
        setRestoring(false);
      }
    },
    [profileId, noteId, restoring],
  );

  /** „Priloži": main picks and seals, the reference lands in the envelope through an IMMEDIATE flush — a reference that waited out a debounce could die with a crash. */
  const attachFile = useCallback(async () => {
    if (attaching) return;
    setAttachmentError(null);
    if (attachmentsRef.current.length >= PRIV_ATTACHMENTS_MAX_COUNT) {
      setAttachmentError("tooMany");
      return;
    }
    setAttaching(true);
    try {
      const result = await window.nexus.privPickAttachment(profileId);
      if (result.status === "rejected") {
        setAttachmentError(result.code === "too-large" ? "tooLarge" : "generic");
        return;
      }
      if (result.status !== "ok") return; // canceled
      const next = [...attachmentsRef.current, result.ref];
      attachmentsRef.current = next;
      setAttachments(next);
      dirtyRef.current = true;
      await flushRef.current();
    } catch (error) {
      setAttachmentError("generic");
      console.error("Nexus: failed to attach a private file:", error);
      onMaybeLockedRef.current();
    } finally {
      setAttaching(false);
    }
  }, [attaching, profileId]);

  const attachmentsById = useMemo(
    () => new Map(attachments.map((ref) => [ref.id, ref])),
    [attachments],
  );

  if (loadFailed) {
    return (
      <div className="note__editor-empty">
        <EmptyState title={strings.notes.untitled} description={strings.priv.editor.loadError} />
      </div>
    );
  }

  if (doc === null) {
    return (
      <div className="note__editor-empty">
        <p className="app__muted">{strings.app.loading}</p>
      </div>
    );
  }

  return (
    <>
      {saveError !== null && (
        <div className="note__save-error" role="status">
          {saveError === "tooLarge" ? strings.priv.editor.saveTooLarge : strings.priv.editor.saveError}
        </div>
      )}
      {restoreError && (
        <div className="note__history-error" role="status">
          {strings.priv.editor.history.error}
        </div>
      )}
      <div className="note__editor-body">
        <div className="note__editor-tools">
          <button
            type="button"
            className="note__attach"
            onClick={() => setMode(mode === "edit" ? "history" : "edit")}
          >
            {mode === "edit"
              ? strings.priv.editor.history.open
              : strings.priv.editor.history.back}
          </button>
        </div>
        {mode === "history" ? (
          // The live `Y.Doc` and its flush machinery stay mounted underneath:
          // a restore rewrites that doc, and leaving history is a state change,
          // never a reload.
          <PrivVersionHistory
            profileId={profileId}
            noteId={noteId}
            onRestore={(version) => void restoreVersion(version)}
            restoring={restoring}
            onMaybeLocked={onMaybeLocked}
          />
        ) : (
          <>
            <PrivEditorCanvas doc={doc} attachmentsById={attachmentsById} />
            <section className="note__attachments" aria-label={strings.priv.editor.attachmentsTitle}>
              <div className="note__attachments-head">
                <h3 className="note__attachments-title">
                  {strings.priv.editor.attachmentsTitle}
                  {attachments.length > 0 ? ` (${attachments.length})` : ""}
                </h3>
                <button
                  type="button"
                  className="note__attach"
                  disabled={attaching}
                  onClick={() => void attachFile()}
                >
                  {strings.priv.editor.attach}
                </button>
              </div>
              <p className="note__menu-caption priv__attachments-note">
                {strings.priv.editor.attachmentsNote}
              </p>
              {attachmentError !== null && (
                <div className="note__attachment-error" role="status">
                  {attachmentError === "tooLarge"
                    ? strings.priv.editor.attachmentTooLarge
                    : attachmentError === "tooMany"
                      ? strings.notes.moveToPriv.tooManyAttachments
                      : strings.priv.editor.attachmentError}
                </div>
              )}
              {attachments.map((ref) => (
                <div key={ref.id} className="note__attachment">
                  {isInlineImageMime(ref.mime) && (
                    <img
                      className="note__attachment-thumb"
                      src={`priv-blob://${ref.id}`}
                      alt={ref.fileName}
                    />
                  )}
                  <span className="note__attachment-name">{ref.fileName}</span>
                  <span className="note__attachment-size">{formatBytes(ref.sizeBytes)}</span>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </>
  );
}

interface PrivEditorCanvasProps {
  doc: Y.Doc;
  attachmentsById: ReadonlyMap<string, PrivAttachmentRef>;
}

/** Wiki-links resolve to nothing here on purpose: their targets are PUBLIC notes, and the private section neither lists nor opens them — the node renders its label snapshot, inert. */
const INERT_NOTE_LINKS = { titles: new Map<string, string>(), onOpenNote: () => {} };

/**
 * The bound private canvas — `EditorCanvas`'s construction minus every
 * public-store coupling (see the module header). Built once per `doc`, the
 * same `[doc]` keying the public editor uses.
 */
function PrivEditorCanvas({ doc, attachmentsById }: PrivEditorCanvasProps) {
  const [slash, setSlash] = useState<SlashRenderState | null>(null);
  const slashKeydownRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findFocusNonce, setFindFocusNonce] = useState(0);
  const findOpenRef = useRef(false);
  useEffect(() => {
    findOpenRef.current = findOpen;
  }, [findOpen]);
  const closeFind = useCallback(() => setFindOpen(false), []);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // Yjs owns history via Collaboration — the kit's own undo/redo must be off.
        undoRedo: false,
        heading: { levels: [1, 2, 3] },
        strike: false,
        underline: false,
        dropcursor: { color: "var(--nx-accent)", width: 2 },
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: strings.notes.placeholder }),
      Collaboration.configure({ document: doc, field: "default" }),
      NoteLink,
      PrivAttachmentImage,
      Callout,
      Toggle,
      ToggleSummary,
      ToggleContent,
      NoteTableOfContents,
      createNoteFindExtension({
        onOpen: () => {
          setFindOpen(true);
          setFindFocusNonce((nonce) => nonce + 1);
        },
        onEscape: () => {
          if (!findOpenRef.current) return false;
          setFindOpen(false);
          return true;
        },
      }),
      // The block commands stay; the template section is empty by
      // construction — templates are public rows the private section never
      // reads.
      createSlashExtension(
        {
          onStart: setSlash,
          onUpdate: setSlash,
          onExit: () => {
            setSlash(null);
            slashKeydownRef.current = null;
          },
          onKeyDown: (event) => slashKeydownRef.current?.(event) ?? false,
        },
        () => [],
      ),
    ],
    [doc],
  );

  const editor = useEditor(
    {
      extensions,
      // The same device preference the public editor reads at construction
      // time (ADR-036) — the two editors must not disagree about typing.
      enableInputRules: readStoredNoteMarkdownShortcuts(),
      immediatelyRender: false,
      editorProps: { attributes: { class: "note__prosemirror" } },
    },
    [doc],
  );

  return (
    <PrivAttachmentProvider value={{ byId: attachmentsById }}>
      <NoteLinkProvider value={INERT_NOTE_LINKS}>
        <div className="note__editor">
          {findOpen && editor !== null && (
            <NoteFindBar editor={editor} focusNonce={findFocusNonce} onClose={closeFind} />
          )}
          <EditorContent editor={editor} />
          {slash !== null && (
            <SlashMenu
              state={slash}
              registerKeydown={(handler) => {
                slashKeydownRef.current = handler;
              }}
            />
          )}
        </div>
      </NoteLinkProvider>
    </PrivAttachmentProvider>
  );
}
