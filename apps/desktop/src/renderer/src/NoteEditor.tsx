import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import * as Y from "yjs";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Collaboration } from "@tiptap/extension-collaboration";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import {
  collectNoteCards,
  collectNoteLinkIds,
  isInlineImageMime,
  replaceNoteContent,
  xmlTextContent,
} from "@nexus/core";
import { EmptyState, LoadingState, SaveIndicator, Select, type SaveStatus } from "@nexus/ui";
import {
  NOTE_ATTACHMENT_MAX_BYTES,
  NOTE_CARDS_MAX_COUNT,
  NOTE_LINKS_MAX_COUNT,
  NOTE_UPDATE_MAX_BYTES,
  type Deck,
  type NoteAttachment,
  type NoteCardSpec,
  type NoteMeta,
  type Subject,
} from "../../shared/ipc.js";
import { AttachmentImage, NoteAttachmentProvider } from "./noteAttachmentImage.js";
import { AttachmentPreviewDialog } from "./attachmentPreview.js";
import { attachmentPreviewKind, type AttachmentPreviewKind } from "./attachmentPreviewKind.js";
import { Callout } from "./noteCallout.js";
import { createNoteFindExtension, NoteFindBar } from "./noteFindBar.js";
import { countEditorCards, NoteFlashcard } from "./noteFlashcard.js";
import { NoteLink, NoteLinkProvider } from "./noteLink.js";
import { createNoteLinkExtension, NoteLinkMenu, type NoteLinkRenderState } from "./noteLinkMenu.js";
import { NotePopover } from "./notePopover.js";
import { readStoredNoteMarkdownShortcuts } from "./notePrefs.js";
import { createSlashExtension, SlashMenu, type SlashRenderState } from "./noteSlashMenu.js";
import { NoteTableOfContents } from "./noteTableOfContents.js";
import { NoteTemplatePane } from "./noteTemplatePane.js";
import { Toggle, ToggleContent, ToggleSummary } from "./noteToggle.js";
import { mergeTemplateEntries, stripAttachmentNodes, type TemplateEntry } from "./noteTemplates.js";
import { NoteVersionHistory } from "./noteVersionHistory.js";
import { formatClockTime } from "./timeFormat.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { registerOpenEditor } from "./openEditors.js";
import { OwedWrites } from "./owedWrites.js";
import { fill, strings } from "./strings.js";
import { reportUnsavedExit } from "./unsavedExits.js";

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

/** What a write owes: the updates, and the title they leave the note with. */
interface OwedNote {
  readonly updates: readonly Uint8Array[];
  readonly title: string;
}

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

/**
 * The concatenated text of one XML node (leaf text, or its children in order).
 * Leaf text goes through `xmlTextContent`, never `Y.XmlText.toString()` — the
 * latter serializes marks as `<bold>…</bold>` markup, which would land
 * literally in a derived title (the exact defect `yjsText.ts` exists to
 * prevent, found while building note duplication).
 */
function nodeText(node: Y.XmlElement | Y.XmlText | Y.XmlHook): string {
  if (node instanceof Y.XmlText) return xmlTextContent(node);
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

/**
 * Sends again what a note's last write, made as it was left, could not land —
 * the shell's „Pokušaj ponovo" (DC-148). The note is no longer open, so there
 * is no live document to read the title from, and the title the failed write
 * carried is not the one to send: a later edit of the same note may have
 * replaced it. It is derived from what the note will BE once the updates land,
 * its stored state and the owed updates merged. Links and generated cards are
 * not reported again — the note's next save reconciles both
 * (`lastSentLinksRef` and `lastSentCardsRef` start null on every mount), as it
 * does when either report fails inside the editor.
 */
async function resendOwed(
  profileId: string,
  noteId: string,
  updates: readonly Uint8Array[],
): Promise<void> {
  const stored = await window.nexus.loadNote(profileId, noteId);
  const doc = new Y.Doc();
  try {
    if (stored.snapshot !== null) Y.applyUpdate(doc, stored.snapshot);
    for (const update of stored.updates) Y.applyUpdate(doc, update);
    for (const update of updates) Y.applyUpdate(doc, update);
    await sendBatch(profileId, noteId, updates, deriveTitle(doc));
  } finally {
    doc.destroy();
  }
}

/** Locale-aware one-decimal formatter for the KB/MB branches of `formatBytes`. */
const BYTES_FORMATTER = new Intl.NumberFormat("sr-Latn", { maximumFractionDigits: 1 });

/** sr-Latn collation for the deck-mapping bar's subject/deck names — plain "sr" mis-tailors Latin š/č/ć. */
const CARD_DECK_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/**
 * Human-readable file size for the Prilozi panel: whole bytes under 1 KB,
 * otherwise KB/MB with at most one decimal — no fabricated precision beyond
 * what `Intl.NumberFormat` already rounds to.
 */
function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  const kb = sizeBytes / 1024;
  if (kb < 1024) return `${BYTES_FORMATTER.format(kb)} KB`;
  return `${BYTES_FORMATTER.format(kb / 1024)} MB`;
}

/**
 * Ordered-set equality for the outbound wiki-link report (NOTE-004b): `null`
 * (unknown — e.g. the first flush after mount) is never equal, so the first
 * successful flush always sends. Otherwise the two id lists (already deduped
 * by `collectNoteLinkIds`) must match position-for-position.
 */
function sameLinkSet(previous: string[] | null, next: readonly string[]): boolean {
  if (previous === null) return false;
  if (previous.length !== next.length) return false;
  return previous.every((id, index) => id === next[index]);
}

/**
 * Ordered-set equality for the outbound card report (NOTE-006c / ADR-017),
 * mirroring `sameLinkSet` above: `null` (nothing sent yet this mount) is
 * never equal, otherwise equal length and equal `key`/`front`/`back` at
 * every index.
 */
function sameCardSet(previous: NoteCardSpec[] | null, next: readonly NoteCardSpec[]): boolean {
  if (previous === null) return false;
  if (previous.length !== next.length) return false;
  return previous.every((card, index) => {
    const other = next[index];
    return (
      other !== undefined &&
      card.key === other.key &&
      card.front === other.front &&
      card.back === other.back
    );
  });
}

export interface NoteEditorProps {
  profileId: string;
  noteId: string;
  /** Called after each successful flush so the page can refresh the note list. */
  onSaved: () => void;
  /** Navigates to another note — wired from wiki-links and the backlinks panel. */
  onOpenNote: (id: string) => void;
  /**
   * Blocks from the folder's default template, for a note that was just created
   * in it (ADR-036). Read ONCE, at mount — see the state below. `null` for
   * every other mount, which is all of them but the one.
   */
  initialTemplate?: JSONContent[] | null;
  /** Reports that `initialTemplate` has been applied, so the page can drop its copy. */
  onInitialTemplateApplied?: () => void;
}

export function NoteEditor({
  profileId,
  noteId,
  onSaved,
  onOpenNote,
  initialTemplate,
  onInitialTemplateApplied,
}: NoteEditorProps) {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveError, setSaveError] = useState<"generic" | "tooLarge" | null>(null);
  /**
   * What the editor says about its own persistence.
   *
   * The counterpart to `saveError`, and its absence was the whole finding
   * behind the canvas report: this editor announced every refusal and never
   * once announced a write, so a note you had just typed looked exactly like
   * a note that had failed to save quietly. `savedAt` is the instant of the
   * last successful flush and the line carries it, because a bare
   * „Sačuvano" is still on screen an hour later and therefore proves
   * nothing.
   */
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const [backlinks, setBacklinks] = useState<NoteMeta[]>([]);
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<"generic" | "tooLarge" | null>(null);
  /** The attachment a „Ukloni prilog" click is asking about; null when nothing is being asked. */
  const [pendingAttachmentDelete, setPendingAttachmentDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  // „Pregledaj" (DOC / ADR-064): which attachment the in-app dialog is showing,
  // and as what. PDF rows never land here — their menu item opens the dedicated
  // window over IPC instead.
  const [preview, setPreview] = useState<{
    attachment: NoteAttachment;
    kind: Exclude<AttachmentPreviewKind, "pdf">;
  } | null>(null);
  const [dropActive, setDropActive] = useState(false);
  // Inline flashcards (NOTE-006c / ADR-017): this note's deck mapping, the
  // profile's decks/subjects for the picker, the live card count, and a
  // transient error channel of its own — see the deck bar below.
  const [cardDeckId, setCardDeckId] = useState<string | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [cardCount, setCardCount] = useState(0);
  const [cardError, setCardError] = useState(false);
  // Reveals the unmapped form for one re-pick, without touching `cardDeckId`
  // until a new deck is actually chosen.
  const [changingDeck, setChangingDeck] = useState(false);
  const [mode, setMode] = useState<"edit" | "history" | "templates">("edit");
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState(false);
  // The Šabloni pane's pending hand-off (ADR-016): the chosen template's block
  // array, applied by `EditorCanvas` once it remounts in edit mode, and the
  // open note's content as of the moment the pane was opened (the pane itself
  // has no live editor to read from).
  //
  // Seeded from `initialTemplate` (ADR-036) so a note created in a folder with
  // a default template opens through the very same hand-off the Šabloni pane
  // uses — one insert path, one set of edge cases. Reading it at mount is
  // enough because `NotesPage` keys this component by note id: a newly created
  // note is always a fresh mount, so the initializer runs exactly once for it.
  const [pendingTemplate, setPendingTemplate] = useState<JSONContent[] | null>(
    initialTemplate ?? null,
  );
  // Whether the pending blocks above came from that hand-off, so the applied
  // callback reports only the one the page is waiting on — a later insert from
  // the Šabloni pane is the pane's business, not the page's.
  const initialTemplatePendingRef = useRef(initialTemplate != null);
  const [templateSource, setTemplateSource] = useState<JSONContent | null>(null);
  // Feeds the slash menu's live template list (NOTE-009c) — see `loadTemplates`
  // below for the refresh-on-edit-entry policy.
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);

  const pendingRef = useRef<Uint8Array[]>([]);
  const timerRef = useRef<number | null>(null);
  /**
   * Whether this editor is still on screen. A write that fails after it is not
   * has no save line left to say so, so it goes to the shell
   * (`unsavedExits.ts`). Set by the load effect, cleared first thing in its
   * cleanup.
   */
  const openRef = useRef(false);
  const failedRef = useRef<(owed: OwedNote, error: unknown) => void>(() => undefined);
  // One instance per mount, and a mount is one note: what a failed write owed
  // is carried onto the next write of THIS note and no other. Lazy state, so it
  // is built once.
  const [writes] = useState(
    () =>
      new OwedWrites<OwedNote>({
        carry: (failed, next) => ({
          updates: [...failed.updates, ...next.updates],
          title: next.title,
        }),
        onFailed: (owed, error) => failedRef.current(owed, error),
      }),
  );
  const docRef = useRef<Y.Doc | null>(null);
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The outbound wiki-link set as of the last successful `setNoteLinks` call —
  // `null` means unknown (nothing sent yet this mount), which always triggers
  // a send on the first flush.
  const lastSentLinksRef = useRef<string[] | null>(null);
  // Same idea, for the generated card set (NOTE-006c).
  const lastSentCardsRef = useRef<NoteCardSpec[] | null>(null);
  // `flush` reads the chosen deck through a ref, like every other mutable
  // value that path reads — it is called from the unmount cleanup, after
  // React has stopped re-rendering this component with fresh state. Kept in
  // step with the *resolved* mapping (see `mappedDeck` below), never with the
  // raw id.
  const cardDeckRef = useRef<string | null>(null);
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  // Refreshes the id->title map (every active note of the profile), this
  // note's backlinks, and its attachments. Failures keep the previous state —
  // this is derived, read-only data, never a save error.
  const loadMeta = useCallback(async () => {
    try {
      const [notes, backlinkNotes, noteAttachments] = await Promise.all([
        window.nexus.listNotes(profileId),
        window.nexus.listNoteBacklinks(profileId, noteId),
        window.nexus.listNoteAttachments(profileId, noteId),
      ]);
      setTitles(new Map(notes.map((note) => [note.id, note.title])));
      setBacklinks(backlinkNotes);
      setAttachments(noteAttachments);
      // The card-deck mapping rides along with `listNotes` (NOTE-006c) — every
      // row already carries `cardDeckId`, so no separate IPC call is needed.
      const self = notes.find((note) => note.id === noteId);
      if (self !== undefined) setCardDeckId(self.cardDeckId);
    } catch (error) {
      console.error("Nexus: failed to load note titles/backlinks/attachments:", error);
    }
  }, [profileId, noteId]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  // Feeds the deck bar's picker (NOTE-006c): every deck grouped by subject.
  // Failure keeps the previous list and logs — like `loadMeta`, this is
  // derived, read-only data, never a save error.
  const loadDecks = useCallback(async () => {
    try {
      const [deckRows, subjectRows] = await Promise.all([
        window.nexus.listDecks(profileId),
        window.nexus.listSubjects(profileId),
      ]);
      setDecks(deckRows);
      setSubjects(subjectRows);
    } catch (error) {
      console.error("Nexus: failed to load decks:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void loadDecks();
  }, [loadDecks]);

  // Feeds the slash menu (NOTE-009c). Failure keeps the previous list and
  // logs — like `loadMeta`, this is derived, read-only data, never a save
  // error. Fetched whenever edit mode is entered rather than only on mount:
  // that single rule is what makes returning from the Šabloni pane after a
  // save, rename, or delete refresh the slash list too, with no second call
  // site and no cross-component invalidation.
  const loadTemplates = useCallback(async () => {
    try {
      const rows = await window.nexus.listNoteTemplates(profileId);
      setTemplates(mergeTemplateEntries(rows));
    } catch (error) {
      console.error("Nexus: failed to load note templates:", error);
    }
  }, [profileId]);

  useEffect(() => {
    if (mode !== "edit") return;
    void loadTemplates();
  }, [loadTemplates, mode]);

  const attachmentsById = useMemo(
    () => new Map(attachments.map((attachment) => [attachment.id, attachment])),
    [attachments],
  );

  // The deck bar's picker groups by subject (NOTE-006c), sr-Latn ordered;
  // decks within a subject get the same ordering. Subjects with no decks of
  // their own contribute no optgroup.
  const decksBySubject = useMemo(() => {
    const map = new Map<string, Deck[]>();
    for (const deck of decks) {
      const list = map.get(deck.subjectId);
      if (list === undefined) map.set(deck.subjectId, [deck]);
      else list.push(deck);
    }
    for (const list of map.values()) list.sort((a, b) => CARD_DECK_COLLATOR.compare(a.name, b.name));
    return map;
  }, [decks]);
  const orderedSubjects = useMemo(
    () => [...subjects].sort((a, b) => CARD_DECK_COLLATOR.compare(a.name, b.name)),
    [subjects],
  );

  // The mapping is resolved against the *live* deck list, never trusted as a
  // bare id: STUDY soft-deletes a deck, and `notes.card_deck_id`'s
  // ON DELETE SET NULL fires only on a hard delete, so a note can outlive the
  // deck it points at. An unresolvable mapping therefore reads as unmapped —
  // the picker comes back instead of every flush syncing into a deck that no
  // longer exists. (`decks` is empty until `loadDecks` resolves, which only
  // delays the bar by one round-trip.)
  const mappedDeck = useMemo(
    () => (cardDeckId === null ? undefined : decks.find((deck) => deck.id === cardDeckId)),
    [cardDeckId, decks],
  );
  useEffect(() => {
    cardDeckRef.current = mappedDeck?.id ?? null;
  }, [mappedDeck]);

  // Maps (or re-maps) this note's cards onto a deck, then syncs immediately
  // (ADR-017): choosing a deck must not wait for the next keystroke. Failure
  // covers both the mapping call and the sync that follows it — either way
  // the note's own content is untouched, so it surfaces on `cardError`, never
  // `saveError`.
  const chooseDeck = useCallback(
    async (deckId: string) => {
      setCardError(false);
      try {
        await window.nexus.setNoteCardDeck(profileId, noteId, deckId);
        setCardDeckId(deckId);
        cardDeckRef.current = deckId;
        if (docRef.current !== null) {
          const cards = collectNoteCards(docRef.current).slice(0, NOTE_CARDS_MAX_COUNT);
          await window.nexus.syncNoteCards(profileId, noteId, deckId, cards);
          lastSentCardsRef.current = cards;
        }
      } catch (error) {
        setCardError(true);
        console.error("Nexus: failed to map note cards:", error);
      }
    },
    [profileId, noteId],
  );

  // Attaches one or more files sequentially (drag-drop or the file picker).
  // A pre-flight size check skips oversize files without an IPC round-trip;
  // an attached image additionally gets an `attachmentImage` block inserted
  // at the caret. `attachmentError` is a separate, transient channel from
  // `saveError` (the content-save path) and is cleared at the start of every
  // new attach round.
  const attachFiles = useCallback(
    async (files: FileList | File[]) => {
      setAttachmentError(null);
      for (const file of Array.from(files)) {
        if (file.size > NOTE_ATTACHMENT_MAX_BYTES) {
          setAttachmentError("tooLarge");
          continue;
        }
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const name = file.name.trim().length > 0 ? file.name.slice(0, 255) : "prilog";
          const created = await window.nexus.attachNoteFile(profileId, noteId, name, bytes);
          // Optimistic append so the block inserted below resolves its row
          // immediately — without it the image renders the removed-attachment
          // placeholder until the whole round's final loadMeta lands.
          setAttachments((previous) => [...previous, created]);
          if (isInlineImageMime(created.mime)) {
            editorRef.current
              ?.chain()
              .focus()
              .insertContent({ type: "attachmentImage", attrs: { attachmentId: created.id } })
              .run();
          }
        } catch (error) {
          setAttachmentError("generic");
          console.error("Nexus: failed to attach file:", error);
        }
      }
      await loadMeta();
    },
    [profileId, noteId, loadMeta],
  );

  const openAttachment = useCallback(
    async (attachmentId: string) => {
      try {
        await window.nexus.openNoteAttachment(profileId, noteId, attachmentId);
      } catch (error) {
        setAttachmentError("generic");
        console.error("Nexus: failed to open attachment:", error);
      }
    },
    [profileId, noteId],
  );

  // The PDF half of „Pregledaj" (ADR-064): asks main to open the dedicated
  // preview window — the renderer names ids only, and the dialog above never
  // sees a PDF row.
  const previewPdfAttachment = useCallback(
    async (attachmentId: string) => {
      try {
        await window.nexus.previewAttachment(profileId, "note", noteId, attachmentId);
      } catch (error) {
        setAttachmentError("generic");
        console.error("Nexus: failed to preview attachment:", error);
      }
    },
    [profileId, noteId],
  );

  const saveAttachmentAs = useCallback(
    async (attachmentId: string) => {
      try {
        await window.nexus.saveNoteAttachmentAs(profileId, noteId, attachmentId);
      } catch (error) {
        setAttachmentError("generic");
        console.error("Nexus: failed to save attachment as:", error);
      }
    },
    [profileId, noteId],
  );

  const removeAttachment = useCallback(
    async (attachmentId: string) => {
      try {
        await window.nexus.removeNoteAttachment(profileId, noteId, attachmentId);
        await loadMeta();
      } catch (error) {
        setAttachmentError("generic");
        console.error("Nexus: failed to remove attachment:", error);
      }
    },
    [profileId, noteId, loadMeta],
  );

  // Restore flow (ADR-015 / NOTE-008b): flush pending keystrokes first so the
  // safety checkpoint below includes them, capture that checkpoint, then
  // rewrite the live doc forward to the selected version — `replaceNoteContent`
  // deletes+re-inserts the "default" fragment's children in one transaction;
  // the binding rebuilds the view and the normal debounced flush persists it,
  // so this is never a destructive load of old bytes. `docRef.current === null`
  // aborts silently (nothing to restore into); `restoring` ignores re-entry.
  const restoreVersion = useCallback(
    async (versionSnapshot: Uint8Array) => {
      if (restoring || docRef.current === null) return;
      setRestoring(true);
      setRestoreError(false);
      try {
        await flushRef.current();
        // A checkpoint taken without the edits that did not save would make the
        // restore the one step that cannot be undone.
        if (writes.owesFailure) {
          throw new Error("the edits the safety checkpoint must hold did not save");
        }
        await window.nexus.captureNoteVersion(profileId, noteId);
        replaceNoteContent(docRef.current, versionSnapshot);
        setMode("edit");
      } catch (error) {
        setRestoreError(true);
        console.error("Nexus: failed to restore note version:", error);
      } finally {
        setRestoring(false);
      }
    },
    [profileId, noteId, restoring, writes],
  );

  // Stable identity so `EditorCanvas`'s apply-effect (below) doesn't re-fire
  // on every render — it clears the hand-off once the insert is applied.
  const onTemplateApplied = useCallback(() => {
    setPendingTemplate(null);
    if (initialTemplatePendingRef.current) {
      initialTemplatePendingRef.current = false;
      onInitialTemplateApplied?.();
    }
  }, [onInitialTemplateApplied]);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void flushRef.current();
    }, FLUSH_DEBOUNCE_MS);
  }, []);

  // A write failed and no later one was asked for to carry it (`OwedWrites`).
  // On screen the save line says it, and the next edit sends it again; once the
  // note is closed the shell says it, naming the note. A retry is offered only
  // where it can help: an oversize update can never land. `subject: null`,
  // because two failed exits of one note owe two different edits.
  const onWriteFailed = useCallback(
    (owed: OwedNote, error: unknown) => {
      const tooLarge = error instanceof OversizeUpdateError;
      if (!tooLarge) console.error("Nexus: failed to persist note update:", error);
      if (openRef.current) {
        setSaveStatus("error");
        setSaveError(tooLarge ? "tooLarge" : "generic");
        return;
      }
      reportUnsavedExit({
        profileId,
        subject: null,
        message: fill(
          tooLarge ? strings.app.unsavedExit.noteTooLarge : strings.app.unsavedExit.note,
          { title: owed.title === "" ? strings.notes.untitled : owed.title },
        ),
        retry: tooLarge ? null : () => resendOwed(profileId, noteId, owed.updates),
      });
    },
    [profileId, noteId],
  );

  useEffect(() => {
    failedRef.current = onWriteFailed;
  }, [onWriteFailed]);

  const flush = useCallback((): Promise<void> => {
    const liveDoc = docRef.current;
    if (liveDoc === null || (pendingRef.current.length === 0 && !writes.owesFailure)) {
      return writes.settled();
    }
    const updates = pendingRef.current;
    pendingRef.current = [];
    // Everything the write reports — the title, the outbound link ids AND the
    // generated card set — is taken here, with the batch, while the doc is
    // alive: the cleanup flush on unmount destroys it on the next line, and a
    // write that waits its turn behind one still out can no longer read it.
    // (Each store rejects a raw array over its cap; a doc genuinely over it
    // indexes only its first capped entries, in document order.)
    const title = deriveTitle(liveDoc);
    const ids = collectNoteLinkIds(liveDoc).slice(0, NOTE_LINKS_MAX_COUNT);
    const cards = collectNoteCards(liveDoc).slice(0, NOTE_CARDS_MAX_COUNT);
    if (openRef.current) setSaveStatus("saving");
    // Edits made while a write is out each scheduled a flush of their own, and
    // it now queues behind that write instead of returning. A failure is
    // carried onto the next write by `OwedWrites`, so nothing is put back here.
    return writes.send({ updates, title }, async (owed) => {
      await sendBatch(profileId, noteId, owed.updates, owed.title);
      if (openRef.current) {
        setSaveError(null);
        setSavedAt(new Date().toISOString());
        setSaveStatus("saved");
        void loadMeta();
      }
      onSavedRef.current();

      // Outbound wiki-links are reported only when the set changed since the
      // last successful send.
      if (!sameLinkSet(lastSentLinksRef.current, ids)) {
        try {
          await window.nexus.setNoteLinks(profileId, noteId, ids);
          lastSentLinksRef.current = ids;
        } catch (error) {
          // Never a content-save failure — the document itself was already
          // persisted above. Leave the ref stale so the next flush retries.
          console.error("Nexus: failed to update note links:", error);
        }
      }

      // Generated cards sync the same way as the link report above (ADR-017 /
      // NOTE-006c): only once a deck is chosen, and only when the set changed
      // since the last successful send.
      const deckId = cardDeckRef.current;
      if (deckId !== null && !sameCardSet(lastSentCardsRef.current, cards)) {
        try {
          await window.nexus.syncNoteCards(profileId, noteId, deckId, cards);
          lastSentCardsRef.current = cards;
        } catch (error) {
          // Never a content-save failure — the document itself was already
          // persisted above. Leave the ref stale so the next flush retries.
          console.error("Nexus: failed to sync note cards:", error);
        }
      }
    });
  }, [profileId, noteId, writes, loadMeta]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // DC-149: every exit — a lock, the panic shortcut, closing the window — waits
  // for this editor's flush through the registry before it tears down what the
  // write goes through. This replaces a best-effort `beforeunload` flush, which
  // ran after main had already begun to.
  useEffect(() => registerOpenEditor(() => flushRef.current()), []);

  // Load + hydrate the doc, then attach the local-edit listener. Order matters:
  // snapshot + stored updates are applied BEFORE the listener is attached, so
  // hydration replay never re-enqueues already-persisted updates.
  useEffect(() => {
    let cancelled = false;
    let created: Y.Doc | null = null;
    let handler: ((update: Uint8Array) => void) | null = null;
    openRef.current = true;
    setDoc(null);
    setLoadFailed(false);
    setSaveError(null);
    pendingRef.current = [];
    lastSentLinksRef.current = null;
    lastSentCardsRef.current = null;

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
      openRef.current = false;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // Final flush for a note switch / unmount. It takes the batch and
      // everything its write reports while the doc is alive, and the write waits
      // behind any still out, so destroying the doc on the next line costs it
      // nothing. If that write fails there is no page left to say so: the shell
      // does (`onWriteFailed`).
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
        <LoadingState label={strings.app.loading} rows={4} />
      </div>
    );
  }

  return (
    <>
      <SaveIndicator
        status={saveStatus}
        savingLabel={strings.app.saveSaving}
        savedLabel={`${strings.app.saveSavedPrefix} ${formatClockTime(savedAt ?? "")}`}
        errorLabel={
          saveError === "tooLarge" ? strings.notes.saveTooLarge : strings.notes.saveError
        }
      />
      <div
        className={dropActive ? "note__editor-body note__editor-body--drop" : "note__editor-body"}
        onDragOver={(event) => {
          // Neither pane mode (history or templates) has anything to attach
          // into — the file-drop surface only activates in edit mode.
          if (mode !== "edit") return;
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            setDropActive(true);
          }
        }}
        onDragLeave={(event) => {
          // Leaving to a child keeps the drop state (KanbanView's guard) —
          // only a real exit from the wrapper clears it.
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropActive(false);
          }
        }}
        onDrop={(event) => {
          if (mode !== "edit") return;
          if (event.dataTransfer.files.length > 0) {
            event.preventDefault();
            setDropActive(false);
            void attachFiles(event.dataTransfer.files);
          }
        }}
      >
        {restoreError && (
          <div className="note__history-error" role="status">
            {strings.notes.historyError}
          </div>
        )}
        <div className="note__editor-tools">
          {mode === "edit" ? (
            <>
              <button
                type="button"
                className="note__attach"
                onClick={() => {
                  // Captured here, while EditorCanvas is still mounted: the
                  // Šabloni pane unmounts it, so this click handler is the only
                  // place the note's current content can be read for "Sačuvaj
                  // kao šablon" (ADR-016).
                  setTemplateSource(
                    editorRef.current ? stripAttachmentNodes(editorRef.current.getJSON()) : null,
                  );
                  setMode("templates");
                  setDropActive(false);
                }}
              >
                {strings.notes.templatesOpen}
              </button>
              <button
                type="button"
                className="note__attach"
                onClick={() => {
                  setMode("history");
                  setDropActive(false);
                }}
              >
                {strings.notes.historyOpen}
              </button>
            </>
          ) : (
            <button type="button" className="note__attach" onClick={() => setMode("edit")}>
              {strings.notes.backToEditing}
            </button>
          )}
        </div>
        {mode === "edit" && cardCount > 0 && (
          <>
            {cardError && (
              <div className="note__cards-error" role="status">
                {strings.notes.cardsError}
              </div>
            )}
            <div className="note__cards-bar">
              {mappedDeck !== undefined && !changingDeck ? (
                <>
                  <span>
                    {`${strings.notes.cardsLabel} (${cardCount}) · ${strings.notes.cardsDeckPrefix}${mappedDeck.name}`}
                  </span>
                  <button type="button" className="note__attach" onClick={() => setChangingDeck(true)}>
                    {strings.notes.cardsChangeDeck}
                  </button>
                </>
              ) : (
                <>
                  {/* Re-picking keeps naming the current deck: the "no deck yet"
                      copy would be a lie for a note that already has one. */}
                  <span>
                    {mappedDeck !== undefined
                      ? `${strings.notes.cardsLabel} (${cardCount}) · ${strings.notes.cardsDeckPrefix}${mappedDeck.name}`
                      : strings.notes.cardsUnmapped}
                  </span>
                  {decks.length === 0 ? (
                    <span>{strings.notes.cardsNoDecks}</span>
                  ) : (
                    // `inline`: this select lives in a one-line status bar
                    // beside the "already mapped to X" / "not mapped" text —
                    // the same bar it used to announce itself into by
                    // `aria-label` alone, with nothing on screen saying what
                    // the control was for.
                    <Select
                      layout="inline"
                      label={strings.notes.cardsDeckSelectLabel}
                      value=""
                      onChange={(event) => {
                        const deckId = event.target.value;
                        if (deckId.length === 0) return;
                        setChangingDeck(false);
                        void chooseDeck(deckId);
                      }}
                    >
                      <option value="" disabled>
                        {strings.notes.cardsDeckPlaceholder}
                      </option>
                      {orderedSubjects.map((subject) => {
                        const subjectDecks = decksBySubject.get(subject.id);
                        if (subjectDecks === undefined) return null;
                        return (
                          <optgroup key={subject.id} label={subject.name}>
                            {subjectDecks.map((deck) => (
                              <option key={deck.id} value={deck.id}>
                                {deck.name}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </Select>
                  )}
                  {/* An accidental "Promeni špil" must have a way back — without
                      this the bar can only be left by picking a deck. */}
                  {changingDeck && (
                    <button
                      type="button"
                      className="note__attach"
                      onClick={() => setChangingDeck(false)}
                    >
                      {strings.notes.cardsCancelChange}
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        )}
        {mode === "history" ? (
          <NoteVersionHistory
            profileId={profileId}
            noteId={noteId}
            titles={titles}
            onOpenNote={onOpenNote}
            attachmentsById={attachmentsById}
            onRestore={(versionSnapshot) => void restoreVersion(versionSnapshot)}
            restoring={restoring}
          />
        ) : mode === "templates" ? (
          <NoteTemplatePane
            profileId={profileId}
            titles={titles}
            onOpenNote={onOpenNote}
            noteContent={templateSource}
            onInsert={(blocks) => {
              setPendingTemplate(blocks);
              setMode("edit");
            }}
          />
        ) : (
          <>
            <EditorCanvas
              doc={doc}
              profileId={profileId}
              noteId={noteId}
              titles={titles}
              onOpenNote={onOpenNote}
              attachmentsById={attachmentsById}
              editorRef={editorRef}
              pendingTemplate={pendingTemplate}
              onTemplateApplied={onTemplateApplied}
              templates={templates}
              onCardCount={setCardCount}
            />
            <section className="note__attachments" aria-label={strings.notes.attachmentsTitle}>
              <div className="note__attachments-head">
                <h3 className="note__attachments-title">
                  {strings.notes.attachmentsTitle}
                  {attachments.length > 0 ? ` (${attachments.length})` : ""}
                </h3>
                <button
                  type="button"
                  className="note__attach"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {strings.notes.attach}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    const { files } = event.target;
                    if (files !== null && files.length > 0) void attachFiles(files);
                    event.target.value = "";
                  }}
                />
              </div>
              {attachmentError !== null && (
                <div className="note__attachment-error" role="status">
                  {attachmentError === "tooLarge"
                    ? strings.notes.attachmentTooLarge
                    : strings.notes.attachmentError}
                </div>
              )}
              {attachments.map((attachment) => {
                // „Pregledaj" is offered only where the stored mime (plus the
                // ADR-064 extension reading for pre-sniff text rows) says the
                // app can render the file itself.
                const previewKind = attachmentPreviewKind(
                  attachment.mime,
                  attachment.fileName,
                  attachment.sizeBytes,
                );
                return (
                  <div key={attachment.id} className="note__attachment">
                    {isInlineImageMime(attachment.mime) && (
                      <img
                        className="note__attachment-thumb"
                        src={`nx-blob://${attachment.sha256}`}
                        alt={attachment.fileName}
                      />
                    )}
                    <span className="note__attachment-name">{attachment.fileName}</span>
                    <span className="note__attachment-size">
                      {formatBytes(attachment.sizeBytes)}
                    </span>
                    <NotePopover label={strings.notes.attachmentMenuLabel}>
                      {(close) => (
                        <>
                          {previewKind !== null && (
                            <button
                              type="button"
                              className="note__menu-item"
                              role="menuitem"
                              onClick={() => {
                                if (previewKind === "pdf") void previewPdfAttachment(attachment.id);
                                else setPreview({ attachment, kind: previewKind });
                                close();
                              }}
                            >
                              {strings.notes.attachmentPreview}
                            </button>
                          )}
                          <button
                            type="button"
                            className="note__menu-item"
                            role="menuitem"
                            onClick={() => {
                              void openAttachment(attachment.id);
                              close();
                            }}
                          >
                            {strings.notes.attachmentOpen}
                          </button>
                          <button
                            type="button"
                            className="note__menu-item"
                            role="menuitem"
                            onClick={() => {
                              void saveAttachmentAs(attachment.id);
                              close();
                            }}
                          >
                            {strings.notes.attachmentSaveAs}
                          </button>
                          <div className="note__menu-sep" role="separator" />
                          <button
                            type="button"
                            className="note__menu-item note__menu-item--danger"
                            role="menuitem"
                            onClick={() => {
                              // Asks first: this deletes the row AND the
                              // encrypted copy on disk, and there is no undo
                              // behind it — see `strings.app.attachmentDelete`.
                              setPendingAttachmentDelete({
                                id: attachment.id,
                                name: attachment.fileName,
                              });
                              close();
                            }}
                          >
                            {strings.notes.attachmentRemove}
                          </button>
                        </>
                      )}
                    </NotePopover>
                  </div>
                );
              })}
            </section>
            {backlinks.length > 0 && (
              <section className="note__backlinks" aria-label={strings.notes.backlinksTitle}>
                <h3 className="note__backlinks-title">
                  {strings.notes.backlinksTitle} ({backlinks.length})
                </h3>
                {backlinks.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className="note__backlink"
                    onClick={() => onOpenNote(note.id)}
                  >
                    {note.title.trim().length > 0 ? note.title : strings.notes.untitled}
                  </button>
                ))}
              </section>
            )}
          </>
        )}
      </div>
      {preview !== null && (
        <AttachmentPreviewDialog
          profileId={profileId}
          module="note"
          ownerId={noteId}
          attachment={preview.attachment}
          kind={preview.kind}
          onClose={() => setPreview(null)}
        />
      )}
      {pendingAttachmentDelete !== null && (
        <ConfirmDialog
          title={strings.app.attachmentDelete.title}
          name={pendingAttachmentDelete.name}
          question={strings.app.attachmentDelete.question}
          note={strings.app.attachmentDelete.note}
          confirmLabel={strings.app.attachmentDelete.confirm}
          cancelLabel={strings.app.attachmentDelete.cancel}
          onConfirm={() => {
            const doomed = pendingAttachmentDelete;
            setPendingAttachmentDelete(null);
            void removeAttachment(doomed.id);
          }}
          onCancel={() => setPendingAttachmentDelete(null)}
        />
      )}
    </>
  );
}

interface EditorCanvasProps {
  doc: Y.Doc;
  profileId: string;
  noteId: string;
  titles: ReadonlyMap<string, string>;
  onOpenNote: (id: string) => void;
  attachmentsById: ReadonlyMap<string, NoteAttachment>;
  /** Set from the live `useEditor` instance below, so the parent's attach flow can insert blocks. */
  editorRef: MutableRefObject<Editor | null>;
  /** A chosen template's blocks, awaiting insertion (ADR-016 hand-off) — `null` when nothing is pending. */
  pendingTemplate: JSONContent[] | null;
  /** Clears `pendingTemplate` once the apply effect below has run it. */
  onTemplateApplied: () => void;
  /** The live template list for the slash menu (NOTE-009c) — read through a ref, see below. */
  templates: TemplateEntry[];
  /** Reports the document's current card count on every create/update (NOTE-006c) — read through a ref, see below. */
  onCardCount: (count: number) => void;
}

/**
 * The bound editor surface. Mounts only once its `doc` is hydrated, so
 * `useEditor` always binds Collaboration to a ready document. StarterKit is
 * trimmed to the v1 block set; its undo/redo is disabled because Yjs owns undo
 * through Collaboration (Mod-Z / Mod-Y). The slash menu (`/`) and the
 * wiki-link menu (`[[`) are independent suggestion plugins — distinct plugin
 * keys, distinct render state — so only one is ever open at a time but
 * neither depends on the other's lifecycle.
 */
function EditorCanvas({
  doc,
  profileId,
  noteId,
  titles,
  onOpenNote,
  attachmentsById,
  editorRef,
  pendingTemplate,
  onTemplateApplied,
  templates,
  onCardCount,
}: EditorCanvasProps) {
  const [slash, setSlash] = useState<SlashRenderState | null>(null);
  const slashKeydownRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);
  const [linkMenu, setLinkMenu] = useState<NoteLinkRenderState | null>(null);
  const linkMenuKeydownRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);

  // „Pronađi u belešci" (NOTE-005): whether the find bar is docked above the
  // canvas, and a counter that re-arms its query field on every Ctrl+F. The
  // ref is what lets the extension — built once, below — read the current
  // value from inside a closure that can never be rebuilt, the same discipline
  // `templatesRef` follows.
  const [findOpen, setFindOpen] = useState(false);
  const [findFocusNonce, setFindFocusNonce] = useState(0);
  const findOpenRef = useRef(false);
  useEffect(() => {
    findOpenRef.current = findOpen;
  }, [findOpen]);
  const closeFind = useCallback(() => setFindOpen(false), []);

  // The slash extension's `getTemplates` closure reads this ref, never the
  // `templates` prop directly: `useEditor`'s dep array below is `[doc]`, so
  // an extension array that changed identity on every template edit would
  // not rebuild the editor anyway. The ref is what keeps the live list
  // visible to an extension instance that is built exactly once per editor.
  const templatesRef = useRef<TemplateEntry[]>(templates);
  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);

  // Same discipline for `onCardCount` (NOTE-006c): `useEditor`'s options
  // object below is likewise built once per `[doc]`, so its `onCreate`/
  // `onUpdate` callbacks must read the live prop through a ref rather than
  // close over whichever `onCardCount` was in scope when the editor was built.
  const onCardCountRef = useRef(onCardCount);
  useEffect(() => {
    onCardCountRef.current = onCardCount;
  }, [onCardCount]);

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
      NoteLink,
      AttachmentImage,
      NoteFlashcard,
      // NOTE-011's three container blocks. All three are ordinary schema
      // nodes, so they ride the same Collaboration binding as everything
      // above: `@nexus/core`'s plaintext walk descends into them for the
      // search index, and its Markdown export gives each one a mapping.
      Callout,
      Toggle,
      ToggleSummary,
      ToggleContent,
      NoteTableOfContents,
      // In-note find/replace (NOTE-005). Its handlers close over nothing but
      // state setters and the ref above, so this extension — built once per
      // note like every other one here — stays correct for the life of the
      // editor.
      createNoteFindExtension({
        onOpen: () => {
          setFindOpen(true);
          setFindFocusNonce((nonce) => nonce + 1);
        },
        // Escape reaches here only when focus is already in the editor (the
        // bar handles its own), so there is nothing to hand focus back to.
        onEscape: () => {
          if (!findOpenRef.current) return false;
          setFindOpen(false);
          return true;
        },
      }),
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
        () => templatesRef.current,
      ),
      createNoteLinkExtension(
        {
          onStart: setLinkMenu,
          onUpdate: setLinkMenu,
          onExit: () => {
            setLinkMenu(null);
            linkMenuKeydownRef.current = null;
          },
          onKeyDown: (event) => linkMenuKeydownRef.current?.(event) ?? false,
        },
        { profileId, currentNoteId: noteId },
      ),
    ],
    // `templates` is deliberately NOT a dep: `useEditor` below keys off
    // `[doc]` alone, so rebuilding this array on every template edit would
    // not rebuild the editor anyway. `templatesRef` (above) is what keeps the
    // slash extension's view of the template list live instead — do not "fix"
    // this into a `templates` prop dep.
    [doc, profileId, noteId],
  );

  const editor = useEditor(
    {
      extensions,
      // ADR-036: the markdown-shortcut preference, read from localStorage at
      // editor-construction time. A mount read is enough — `useEditor` keys off
      // `[doc]`, and the doc changes whenever another note (or another page) is
      // opened, so the editor is rebuilt on the very next note the user opens
      // after flipping the switch. Nothing stale can be typed into: the setting
      // lives on the Settings page, which is not the note editor.
      //
      // TipTap's own flag, rather than disabling extensions: the slash menu and
      // the `[[` link menu are Suggestion plugins, not input rules, so they go
      // on working with this off — which is exactly the promised behaviour.
      enableInputRules: readStoredNoteMarkdownShortcuts(),
      // Avoids a first-render/StrictMode mismatch with the collaborative doc.
      immediatelyRender: false,
      editorProps: { attributes: { class: "note__prosemirror" } },
      // Live card count for the deck bar (NOTE-006c) — the same parse the
      // decoration plugin uses, recomputed on every create/update.
      onCreate: ({ editor: created }) => onCardCountRef.current(countEditorCards(created.state.doc)),
      onUpdate: ({ editor: updated }) => onCardCountRef.current(countEditorCards(updated.state.doc)),
    },
    [doc],
  );

  // Publishes the live editor instance to the parent's ref, so its attach
  // flow can insert an `attachmentImage` block at the caret.
  useEffect(() => {
    editorRef.current = editor;
    return () => {
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [editor, editorRef]);

  // The ADR-016 hand-off: the Šabloni pane has no live editor of its own (this
  // canvas is unmounted while it's open), so a chosen template's blocks are
  // applied here, once the canvas remounts in edit mode. Always appended at
  // the end, never at the caret, so applying a template never replaces or
  // displaces existing content (PRD 09 §7). An ordinary local edit from here
  // on — the ambient "update" listener enqueues it and the debounced flush
  // persists it, same as any keystroke.
  useEffect(() => {
    if (editor === null || pendingTemplate === null) return;
    editor.chain().focus("end").insertContent(pendingTemplate).run();
    onTemplateApplied();
  }, [editor, pendingTemplate, onTemplateApplied]);

  return (
    <NoteAttachmentProvider value={{ byId: attachmentsById }}>
      <NoteLinkProvider value={{ titles, onOpenNote }}>
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
          {linkMenu !== null && (
            <NoteLinkMenu
              state={linkMenu}
              registerKeydown={(handler) => {
                linkMenuKeydownRef.current = handler;
              }}
            />
          )}
        </div>
      </NoteLinkProvider>
    </NoteAttachmentProvider>
  );
}
