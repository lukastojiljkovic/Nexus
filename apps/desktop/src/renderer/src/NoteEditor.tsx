import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { Collaboration } from "@tiptap/extension-collaboration";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { EmptyState } from "@nexus/ui";
import { NOTE_UPDATE_MAX_BYTES } from "../../shared/ipc.js";
import { createSlashExtension, SlashMenu, type SlashRenderState } from "./noteSlashMenu.js";
import { strings } from "./strings.js";

/**
 * The TipTap editor for one open note (NOTE slice a2 / ADR-012). One `Y.Doc`
 * per note is the single source of truth: main returns the persisted snapshot +
 * updates, the renderer replays them onto a fresh doc, then binds the editor to
 * the doc's "default" XML fragment (TipTap Collaboration's default — a fixed
 * contract with `@nexus/core`'s plaintext derivation). Local edits are batched
 * and debounced back to main as opaque Yjs update blobs. No toolbar and no drag
 * handles: input is markdown shortcuts + the Serbian slash menu only.
 *
 * Mounted with `key={noteId}` by the page, so switching notes fully remounts
 * this component — its cleanup performs the final flush and destroys the doc.
 */

/** Debounce after the last keystroke before a batch of updates is sent. */
const FLUSH_DEBOUNCE_MS = 800;

/** A single collected update that alone exceeds the wire cap (e.g. a giant paste). */
class OversizeUpdateError extends Error {}

/**
 * Persists a batch of Yjs updates. The batch is merged into one blob when it
 * fits the wire cap; otherwise the individual updates are sent in order. A lone
 * update that still exceeds the cap cannot be persisted — surfaced honestly
 * rather than dropped. Yjs updates are idempotent, so a retry that re-sends an
 * already-stored update never corrupts the document.
 */
async function sendBatch(
  profileId: string,
  noteId: string,
  batch: readonly Uint8Array[],
  title: string,
): Promise<void> {
  const merged = Y.mergeUpdates([...batch]);
  if (merged.byteLength <= NOTE_UPDATE_MAX_BYTES) {
    await window.nexus.appendNoteUpdate(profileId, noteId, merged, title);
    return;
  }
  for (const update of batch) {
    if (update.byteLength > NOTE_UPDATE_MAX_BYTES) throw new OversizeUpdateError();
    await window.nexus.appendNoteUpdate(profileId, noteId, update, title);
  }
}

/** The concatenated text of one XML node (leaf text, or its children in order). */
function nodeText(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) return node.toString();
  if (node instanceof Y.XmlElement) {
    let text = "";
    for (const child of node.toArray()) text += nodeText(child);
    return text;
  }
  return "";
}

/**
 * Derives the note title from the document: the first non-empty top-level
 * block's plain text, trimmed and sliced to 200 chars ("" allowed). Reads the
 * same "default" fragment main walks for plaintext, so title and search text
 * stay consistent.
 */
function deriveTitle(doc: Y.Doc | null): string {
  if (doc === null) return "";
  for (const child of doc.getXmlFragment("default").toArray()) {
    const text = nodeText(child).trim();
    if (text.length > 0) return text.slice(0, 200);
  }
  return "";
}

export interface NoteEditorProps {
  profileId: string;
  noteId: string;
  /** Called after each successful flush so the page can refresh the note list. */
  onSaved: () => void;
}

export function NoteEditor({ profileId, noteId, onSaved }: NoteEditorProps) {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveError, setSaveError] = useState<"generic" | "tooLarge" | null>(null);

  const pendingRef = useRef<Uint8Array[]>([]);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const docRef = useRef<Y.Doc | null>(null);
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, FLUSH_DEBOUNCE_MS);
  }, []);

  const flush = useCallback(async () => {
    if (pendingRef.current.length === 0) return;
    // In-flight guard: updates arriving mid-flush are re-queued and re-sent by
    // the success branch below (Yjs updates commute, so ordering is safe).
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const batch = pendingRef.current;
    pendingRef.current = [];
    const title = deriveTitle(docRef.current);
    try {
      await sendBatch(profileId, noteId, batch, title);
      setSaveError(null);
      onSavedRef.current();
      if (pendingRef.current.length > 0) scheduleFlush();
    } catch (error) {
      // Never drop: put the batch back (chronological) to retry on the next edit.
      pendingRef.current = [...batch, ...pendingRef.current];
      if (error instanceof OversizeUpdateError) {
        setSaveError("tooLarge");
      } else {
        setSaveError("generic");
        console.error("Nexus: failed to persist note update:", error);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [profileId, noteId, scheduleFlush]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Flush before the window unloads (best-effort — the sync prologue captures
  // the batch and title before any await).
  useEffect(() => {
    const onBeforeUnload = () => void flushRef.current();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Load + hydrate the doc, then attach the local-edit listener. Order matters:
  // snapshot + stored updates are applied BEFORE the listener is attached, so
  // hydration replay never re-enqueues already-persisted updates.
  useEffect(() => {
    let cancelled = false;
    let created: Y.Doc | null = null;
    let handler: ((update: Uint8Array) => void) | null = null;
    setDoc(null);
    setLoadFailed(false);
    setSaveError(null);
    pendingRef.current = [];

    void (async () => {
      try {
        const payload = await window.nexus.loadNote(profileId, noteId);
        if (cancelled) return;
        const next = new Y.Doc();
        if (payload.snapshot !== null) Y.applyUpdate(next, payload.snapshot);
        for (const update of payload.updates) Y.applyUpdate(next, update);
        handler = (update: Uint8Array) => {
          pendingRef.current.push(update);
          scheduleFlush();
        };
        next.on("update", handler);
        created = next;
        docRef.current = next;
        setDoc(next);
      } catch (error) {
        if (!cancelled) setLoadFailed(true);
        console.error("Nexus: failed to load note:", error);
      }
    })();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Final flush for a note switch / unmount (captures pending before the
      // doc is torn down); the pending update bytes were already collected.
      void flushRef.current();
      if (created !== null && handler !== null) created.off("update", handler);
      if (created !== null) created.destroy();
      if (docRef.current === created) docRef.current = null;
    };
  }, [profileId, noteId, scheduleFlush]);

  if (loadFailed) {
    return (
      <div className="note__editor-empty">
        <EmptyState title={strings.notes.untitled} description={strings.notes.editorLoadError} />
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
          {saveError === "tooLarge" ? strings.notes.saveTooLarge : strings.notes.saveError}
        </div>
      )}
      <EditorCanvas doc={doc} />
    </>
  );
}

/**
 * The bound editor surface. Mounts only once its `doc` is hydrated, so
 * `useEditor` always binds Collaboration to a ready document. StarterKit is
 * trimmed to the v1 block set; its undo/redo is disabled because Yjs owns undo
 * through Collaboration (Mod-Z / Mod-Y).
 */
function EditorCanvas({ doc }: { doc: Y.Doc }) {
  const [slash, setSlash] = useState<SlashRenderState | null>(null);
  const slashKeydownRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        // Yjs owns history via Collaboration — the kit's own undo/redo must be off.
        undoRedo: false,
        heading: { levels: [1, 2, 3] },
        // Outside the v1 block set — disabled deliberately.
        strike: false,
        underline: false,
        // A CSS var string is fine here (the grep gate only scans for raw values).
        dropcursor: { color: "var(--nx-accent)", width: 2 },
        // Autolink/paste only; clicking must never navigate inside Electron.
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
      }),
      TaskList,
      // Visual checkboxes only — deliberately NOT TASK items (PRD 09 §6).
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: strings.notes.placeholder }),
      Collaboration.configure({ document: doc, field: "default" }),
      createSlashExtension({
        onStart: setSlash,
        onUpdate: setSlash,
        onExit: () => {
          setSlash(null);
          slashKeydownRef.current = null;
        },
        onKeyDown: (event) => slashKeydownRef.current?.(event) ?? false,
      }),
    ],
    [doc],
  );

  const editor = useEditor(
    {
      extensions,
      // Avoids a first-render/StrictMode mismatch with the collaborative doc.
      immediatelyRender: false,
      editorProps: { attributes: { class: "note__prosemirror" } },
    },
    [doc],
  );

  return (
    <div className="note__editor">
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
  );
}
