import { useCallback, useEffect, useMemo, useState } from "react";
import type { JSONContent } from "@tiptap/core";
import type { CardsViewConfig, CollectionSchema } from "@nexus/core";
import { Button, CardsView, EmptyState } from "@nexus/ui";
import type {
  NoteCardDisposition,
  NoteFolder,
  NoteFolderView,
  NoteMeta,
  NoteTag,
  NoteTagLink,
} from "../../shared/ipc.js";
import { NoteCardsDeleteDialog } from "./NoteCardsDeleteDialog.js";
import { NoteEditor } from "./NoteEditor.js";
import { NoteOrganizer, type FolderSelection } from "./NoteOrganizer.js";
import { formatNotificationWhen } from "./notificationFormat.js";
import { NotePopover } from "./notePopover.js";
import { persistRootNoteView, readStoredRootNoteView } from "./notePrefs.js";
import { mergeTemplateEntries } from "./noteTemplates.js";
import { strings } from "./strings.js";

/** sr-Latn collation for the move-to-folder menu — plain "sr" mis-tailors š/č/ć. */
const collator = new Intl.Collator(["sr-Latn", "sr"]);

/** Note-list date: compact sr-Latn day + month, degrading to the raw value. */
function formatNoteDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat("sr-Latn", { day: "2-digit", month: "short" }).format(date);
}

/** The two shapes the middle pane can draw, in toggle order (NOTE-002). */
const VIEW_OPTIONS: readonly { value: NoteFolderView; label: string }[] = [
  { value: "list", label: strings.notes.viewNames.list },
  { value: "cards", label: strings.notes.viewNames.cards },
];

/**
 * `NoteMeta` through a structurally identical mapped type — `CardsView`'s bound
 * is `Record<string, unknown>`, which an interface does not satisfy but a mapped
 * type does (the `TaskFields` arrangement, TasksPage).
 */
type NoteFields = { [K in keyof NoteMeta]: NoteMeta[K] };

/**
 * The note fields the views engine could order by. Declared because `CardsView`
 * takes a schema, not because anything sorts through it: the config below
 * carries NO sort spec, so `applySort` returns its input untouched and the cards
 * land in exactly the order `listNotes` handed over — pinned first, then most
 * recently touched. That order is the feature, and re-deriving it from a sort
 * spec would be one place for the two views to disagree.
 */
const NOTE_SCHEMA: CollectionSchema = {
  fields: [
    { key: "title", type: "text", titleKey: "notes.field.title" },
    { key: "pinned", type: "boolean", titleKey: "notes.field.pinned" },
    { key: "createdAt", type: "date", titleKey: "notes.field.createdAt" },
    { key: "updatedAt", type: "date", titleKey: "notes.field.updatedAt" },
  ],
};

/**
 * No sort, no filters. The tag filter has already narrowed the array by the time
 * it reaches a view (a filter is what the pane SHOWS), and the view is only how
 * the pane DRAWS it — which is why a tag-filtered or search-revealed pane
 * renders as cards exactly as an unfiltered one does.
 */
const CARDS_CONFIG: CardsViewConfig = { type: "cards" };

/** The `listNotes` filter for a folder selection: `undefined` = all, else scoped. */
function filterFor(selection: FolderSelection): { folderId?: string | null } | undefined {
  switch (selection.kind) {
    case "all":
      return undefined;
    case "unfiled":
      return { folderId: null };
    case "folder":
      return { folderId: selection.id };
  }
}

/** A pending deep-link target (021-e): reveal one note, or create a fresh one. Also backs the STUDY -> a note cross-module link (ADR-017), the app's first. */
export type NotesIntent = { kind: "reveal"; noteId: string } | { kind: "create" };

export interface NotesPageProps {
  profileId: string;
  intent?: NotesIntent | null;
  /** Reports that `intent` above has been acted on, so the caller (App.tsx) can clear it. */
  onIntentHandled?: () => void;
}

/**
 * The NOTE module page (slice a3b, tags in a3b-2): a three-pane workspace —
 * the folder organizer (left, also hosting the tag filter and tag CRUD), the
 * note list filtered by folder then narrowed client-side by the tag filter and
 * ordered pinned-first (middle), and the block editor for the selected note
 * (right). Folders, pinning, foldering, and tagging all go through the note
 * organization IPC allowlist; the editor owns the live Yjs doc, main owns
 * storage. Writes are await-then-refetch (never optimistic), the house style.
 *
 * The middle pane draws in one of two shapes (NOTE-002): the rows above, or the
 * views engine's `CardsView`. Which one is a property of the SELECTION — a
 * folder remembers its own on its row, the root in a device preference — and
 * never of what the pane is currently showing, so a tag-filtered or a
 * search-revealed pane renders in exactly the shape an unfiltered one does.
 */
export function NotesPage({ profileId, intent, onIntentHandled }: NotesPageProps) {
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [selection, setSelection] = useState<FolderSelection>({ kind: "all" });
  const [notes, setNotes] = useState<NoteMeta[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The delete that can still be taken back, and whether it took the note's
  // generated cards with it — the undo bar names what it would bring back.
  const [pendingUndo, setPendingUndo] = useState<{ id: string; withCards: boolean } | null>(null);
  // The note whose generated cards need a decision before it can be deleted
  // (PRD 09 §7); null whenever nothing is being asked.
  const [pendingDelete, setPendingDelete] = useState<{ note: NoteMeta; cardCount: number } | null>(
    null,
  );
  const [tags, setTags] = useState<NoteTag[]>([]);
  const [links, setLinks] = useState<NoteTagLink[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  // ADR-036's create-then-apply hand-off: the blocks a freshly created note
  // should open with, tagged with the note they belong to so a slow round trip
  // can never drop them into whichever note happens to be selected by then.
  const [pendingTemplate, setPendingTemplate] = useState<
    { noteId: string; blocks: JSONContent[] } | null
  >(null);
  // The ROOT's shape (NOTE-002) — "Sve beleške" and "Bez fascikle", the two
  // selections with no folder row to remember one in. Read once from the device
  // preference; a folder's own shape comes off its row instead.
  const [rootView, setRootView] = useState<NoteFolderView>(readStoredRootNoteView);

  const loadFolders = useCallback(async () => {
    try {
      setFolders(await window.nexus.listNoteFolders(profileId));
    } catch (error) {
      console.error("Nexus: failed to load folders:", error);
    }
  }, [profileId]);

  const loadNotes = useCallback(async () => {
    try {
      const filter = filterFor(selection);
      const list =
        filter === undefined
          ? await window.nexus.listNotes(profileId)
          : await window.nexus.listNotes(profileId, filter);
      setNotes(list);
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: failed to load notes:", error);
    }
  }, [profileId, selection]);

  // Fetches tags and links together, then prunes the active filter of ids the
  // profile no longer has — deleting a tag can never leave a ghost filter.
  const loadTags = useCallback(async () => {
    try {
      const [tagList, linkList] = await Promise.all([
        window.nexus.listNoteTags(profileId),
        window.nexus.listNoteTagLinks(profileId),
      ]);
      setTags(tagList);
      setLinks(linkList);
      const validIds = new Set(tagList.map((tag) => tag.id));
      setTagFilter((current) => current.filter((id) => validIds.has(id)));
    } catch (error) {
      console.error("Nexus: failed to load tags:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  // Consumes a pending deep-link (021-e): "create" starts a fresh note;
  // "reveal" (also the STUDY -> a note cross-module link, ADR-017) selects an
  // existing one and resets both filters to "all"/none — otherwise the note
  // opens in the editor pane while an active folder/tag filter leaves the
  // middle pane showing no matching row.
  useEffect(() => {
    if (!intent) return;
    if (intent.kind === "create") {
      // `create()` is async (it awaits the IPC round trip and refetches), but
      // the intent is reported handled right away — the caller only needs to
      // know it was consumed, not that the note has finished being created.
      // `withoutContext`: this create came from the palette (021-e), so the
      // quick-capture folder, not the organizer's selection, is its home.
      void create({ withoutContext: true });
      onIntentHandled?.();
      return;
    }
    setSelectedId(intent.noteId);
    setSelection({ kind: "all" });
    setTagFilter([]);
    onIntentHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, onIntentHandled]);

  // Stable identity on purpose: it ends up in the dep array of the canvas's
  // apply-effect, which inserts blocks. A callback that changed identity on
  // every render would put a re-fire of that effect one stray re-render away
  // from appending the same template twice.
  const clearPendingTemplate = useCallback(() => setPendingTemplate(null), []);

  // A folder mutation may have promoted children/notes — refetch both panes.
  const onFoldersChanged = useCallback(async () => {
    await loadFolders();
    await loadNotes();
  }, [loadFolders, loadNotes]);

  const tagsByNote = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const link of links) {
      const set = map.get(link.noteId) ?? new Set<string>();
      set.add(link.tagId);
      map.set(link.noteId, set);
    }
    return map;
  }, [links]);

  // Folder scoping already happened via IPC; the tag filter narrows further,
  // client-side, with AND semantics (a note must carry every selected tag).
  const visibleNotes = useMemo(() => {
    if (notes === null) return [];
    if (tagFilter.length === 0) return notes;
    return notes.filter((note) => tagFilter.every((id) => tagsByNote.get(note.id)?.has(id)));
  }, [notes, tagFilter, tagsByNote]);

  function onToggleTag(id: string): void {
    setTagFilter((current) =>
      current.includes(id) ? current.filter((tagId) => tagId !== id) : [...current, id],
    );
  }

  function onClearTagFilter(): void {
    setTagFilter([]);
  }

  async function toggleNoteTag(note: NoteMeta, tagId: string, attached: boolean): Promise<void> {
    try {
      if (attached) {
        await window.nexus.detachNoteTag(profileId, note.id, tagId);
      } else {
        await window.nexus.attachNoteTag(profileId, note.id, tagId);
      }
      await loadTags();
    } catch (error) {
      console.error("Nexus: failed to toggle note tag:", error);
    }
  }

  /**
   * Resolves a folder's default template to the blocks to append (ADR-036), or
   * null when there is nothing to apply.
   *
   * The template list is fetched here, at create time, rather than held in
   * state: one more round trip on a path that already makes several, and always
   * current — which is also what implements ADR-036's dangling-id rule for
   * free. An id whose template has since been deleted simply matches no entry,
   * and the note is created blank instead of the folder refusing to create it.
   */
  async function templateBlocksFor(folder: NoteFolder | undefined): Promise<JSONContent[] | null> {
    if (folder?.defaultTemplateId == null) return null;
    try {
      const entries = mergeTemplateEntries(await window.nexus.listNoteTemplates(profileId));
      const entry = entries.find((candidate) => candidate.id === folder.defaultTemplateId);
      const blocks = entry?.content?.content ?? null;
      return blocks !== null && blocks.length > 0 ? blocks : null;
    } catch (error) {
      // A template that cannot be read must never cost the user their note.
      console.error("Nexus: failed to resolve a folder's default template:", error);
      return null;
    }
  }

  /**
   * Creates a note and files it, then hands its folder's default template to
   * the editor (ADR-036 — the two features compose: the capture folder's
   * template applies just as any other folder's does).
   *
   * `withoutContext` is what the palette's "Nova beleška" passes: that command
   * is issued from the palette, not from the organizer, so it has no selected
   * folder to mean anything — which is exactly the case the quick-capture mark
   * exists for. The in-page button never passes it, so creating under "Sve
   * beleške" or "Bez fascikle" stays blank and unfiled, as before.
   */
  async function create(options: { withoutContext?: boolean } = {}): Promise<void> {
    try {
      // Read fresh rather than from `folders` state: a palette create (021-e)
      // can land on a NotesPage that is still mounting, whose folder state is
      // therefore an empty array — and silently ignoring the quick-capture
      // folder because a fetch had not returned yet is exactly the kind of
      // "works except when it matters" this feature cannot afford.
      const current = await window.nexus.listNoteFolders(profileId);
      const captureFolder = options.withoutContext
        ? current.find((folder) => folder.isCaptureDefault)
        : undefined;
      const targetId = captureFolder?.id ?? (selection.kind === "folder" ? selection.id : null);

      const created = await window.nexus.createNote(profileId);
      if (targetId !== null) {
        await window.nexus.setNoteFolder(profileId, created.id, targetId);
      }
      // The capture folder is not necessarily the one on screen, and a note the
      // middle list filters away reads as a create that did nothing — so the
      // pane follows the note, the same reasoning the "reveal" intent uses when
      // it resets both filters.
      if (captureFolder !== undefined) {
        setSelection({ kind: "folder", id: captureFolder.id });
        setTagFilter([]);
      }

      const blocks = await templateBlocksFor(
        current.find((folder) => folder.id === targetId),
      );
      setPendingTemplate(blocks === null ? null : { noteId: created.id, blocks });
      setSelectedId(created.id);
      await loadNotes();
    } catch (error) {
      console.error("Nexus: failed to create note:", error);
    }
  }

  /**
   * Deleting a note asks what becomes of the flashcards it generated (PRD 09
   * §7) — but only when there are any. A note that generated none is deleted
   * on the spot, exactly as it always was: no dialog, no new friction.
   *
   * A failed count leaves the note alone rather than guessing a disposition:
   * the two answers do different things to the user's review history, which is
   * precisely why they are asked for.
   */
  async function remove(note: NoteMeta): Promise<void> {
    try {
      const cardCount = await window.nexus.countNoteCards(profileId, note.id);
      if (cardCount === 0) {
        await performDelete(note, "keep");
        return;
      }
      setPendingDelete({ note, cardCount });
    } catch (error) {
      console.error("Nexus: failed to count a note's cards:", error);
    }
  }

  async function performDelete(note: NoteMeta, cards: NoteCardDisposition): Promise<void> {
    try {
      await window.nexus.deleteNote(profileId, note.id, cards);
      if (selectedId === note.id) setSelectedId(null);
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndo({ id: note.id, withCards: cards === "delete" });
      await loadNotes();
    } catch (error) {
      console.error("Nexus: failed to delete note:", error);
    }
  }

  /**
   * Undo of the whole act: main restores the note and, when the cards went
   * with it, exactly those cards — matched on the stamp that delete wrote, so
   * cards an earlier edit removed stay removed. Cards the user chose to KEEP
   * are deliberately never touched here: keeping them was the point, and the
   * note comes back unmapped from its deck so it cannot regenerate copies of
   * them.
   */
  async function undo(): Promise<void> {
    if (!pendingUndo) return;
    try {
      await window.nexus.restoreNote(profileId, pendingUndo.id);
      setPendingUndo(null);
      await loadNotes();
    } catch (error) {
      console.error("Nexus: failed to restore note:", error);
    }
  }

  async function togglePin(note: NoteMeta): Promise<void> {
    try {
      await window.nexus.setNotePinned(profileId, note.id, !note.pinned);
      await loadNotes();
    } catch (error) {
      console.error("Nexus: failed to pin note:", error);
    }
  }

  async function moveNote(note: NoteMeta, folderId: string | null): Promise<void> {
    try {
      await window.nexus.setNoteFolder(profileId, note.id, folderId);
      await loadNotes();
    } catch (error) {
      console.error("Nexus: failed to move note:", error);
    }
  }

  const sortedFolders = folders.slice().sort((a, b) => collator.compare(a.name, b.name));
  const sortedTags = tags.slice().sort((a, b) => collator.compare(a.name, b.name));

  /**
   * WHICH SHAPE the middle pane draws (NOTE-002). A folder remembers its own —
   * the answer travels with the profile, because "this is a folder of recipes,
   * show me cards" is a property of what is filed there — while the root's is a
   * device preference (`notePrefs.ts`), since neither rootless selection has a
   * row to hang a column on.
   *
   * The fallback covers the first paint, before `listNoteFolders` has returned:
   * "list" is what every folder opens as by default, so the pane never flashes a
   * shape the folder did not ask for.
   */
  const selectedFolder =
    selection.kind === "folder" ? folders.find((folder) => folder.id === selection.id) : undefined;
  const view: NoteFolderView =
    selection.kind === "folder" ? (selectedFolder?.defaultView ?? "list") : rootView;

  /** Remembers the shape this selection opens in — the store for a folder, the device for the root. */
  async function selectView(next: NoteFolderView): Promise<void> {
    if (view === next) return;
    if (selection.kind !== "folder") {
      persistRootNoteView(next);
      setRootView(next);
      return;
    }
    const folderId = selection.id;
    try {
      await window.nexus.setNoteFolderView(profileId, folderId, next);
      // Patched in place rather than refetched: a folder's view changes nothing
      // about the tree, and the whole point of the toggle is that it is instant.
      setFolders((prev) =>
        prev.map((folder) => (folder.id === folderId ? { ...folder, defaultView: next } : folder)),
      );
    } catch (error) {
      console.error("Nexus: failed to remember the folder view:", error);
    }
  }

  /**
   * One note, drawn identically in both shapes (NOTE-002): the pin, the button
   * that opens it (title, tag chips, timestamp) and the "⋯" menu — the same
   * markup, so a card is a second RENDERING of the row rather than a second
   * design of it.
   *
   * The card face therefore keeps every management affordance the row has, and
   * keeps them just as quiet: the "⋯" is already hover-revealed
   * (`.note__item-row:hover .note__row-menu`), and reusing the row's own wrapper
   * class gives a card that treatment with no second rule. The alternative —
   * a card that only opens the note, with move/tag/delete left to the organizer
   * — was rejected because the organizer has no per-note menu at all, so cards
   * would have been a view you cannot manage notes from.
   *
   * Only the TIMESTAMP differs, and by design: a row in a dense column says
   * „28. jul“, while a card has room for the instant label the dashboard's recent
   * notes and the search results already use.
   */
  function renderNoteEntry(note: NoteMeta, timestamp: string) {
    const noteTagIds = tagsByNote.get(note.id);
    const noteTags =
      noteTagIds && noteTagIds.size > 0 ? sortedTags.filter((tag) => noteTagIds.has(tag.id)) : [];
    return (
      <>
        <button
          type="button"
          className={`note__pin${note.pinned ? " note__pin--on" : ""}`}
          aria-label={note.pinned ? strings.notes.unpin : strings.notes.pin}
          aria-pressed={note.pinned}
          onClick={() => void togglePin(note)}
        >
          {note.pinned ? "★" : "☆"}
        </button>
        <button
          type="button"
          className={note.id === selectedId ? "note__item note__item--active" : "note__item"}
          aria-current={note.id === selectedId ? "true" : undefined}
          onClick={() => setSelectedId(note.id)}
        >
          <span className="note__item-title">
            {note.title.trim().length > 0 ? note.title : strings.notes.untitled}
          </span>
          {noteTags.length > 0 && (
            <span className="note__item-tags">
              {noteTags.map((tag) => (
                <span key={tag.id} className="note__item-tag">
                  {tag.name}
                </span>
              ))}
            </span>
          )}
          <span className="note__item-date">{timestamp}</span>
        </button>
        <NotePopover label={strings.notes.noteMenuLabel} triggerClassName="note__row-menu">
          {(close) => (
            <>
              <span className="note__menu-label">{strings.notes.moveToFolder}</span>
              <button
                className="note__menu-item"
                role="menuitem"
                type="button"
                onClick={() => {
                  void moveNote(note, null);
                  close();
                }}
              >
                {strings.notes.unfiled}
              </button>
              {sortedFolders.map((folder) => (
                <button
                  key={folder.id}
                  className="note__menu-item"
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    void moveNote(note, folder.id);
                    close();
                  }}
                >
                  {folder.name}
                </button>
              ))}
              {sortedTags.length > 0 && (
                <>
                  <div className="note__menu-sep" role="separator" />
                  <span className="note__menu-label">{strings.notes.tagsLabel}</span>
                  {sortedTags.map((tag) => {
                    const attached = tagsByNote.get(note.id)?.has(tag.id) ?? false;
                    return (
                      <button
                        key={tag.id}
                        className="note__menu-item note__menu-item--check"
                        role="menuitemcheckbox"
                        type="button"
                        aria-checked={attached}
                        onClick={() => void toggleNoteTag(note, tag.id, attached)}
                      >
                        <span
                          className={`note__menu-check${attached ? "" : " note__menu-check--hidden"}`}
                          aria-hidden="true"
                        >
                          ✓
                        </span>
                        {tag.name}
                      </button>
                    );
                  })}
                </>
              )}
              <div className="note__menu-sep" role="separator" />
              <button
                className="note__menu-item note__menu-item--danger"
                role="menuitem"
                type="button"
                onClick={() => {
                  void remove(note);
                  close();
                }}
              >
                {strings.notes.deleteLabel}
              </button>
            </>
          )}
        </NotePopover>
      </>
    );
  }

  return (
    <div className="note">
      <NoteOrganizer
        profileId={profileId}
        folders={folders}
        selection={selection}
        onSelect={setSelection}
        onChanged={onFoldersChanged}
        tags={tags}
        tagFilter={tagFilter}
        onToggleTag={onToggleTag}
        onClearTagFilter={onClearTagFilter}
        onTagsChanged={loadTags}
      />

      <div className="note__list-pane">
        <Button variant="primary" className="note__new" onClick={() => void create()}>
          {strings.notes.newNote}
        </Button>

        {/* The shape toggle (NOTE-002). Always drawn: it is a property of the
            SELECTION, not of what happens to be in it, so an empty folder is
            still a folder whose shape can be set. */}
        <div className="note__list-head">
          <div className="note__views" role="group" aria-label={strings.notes.viewLabel}>
            {VIEW_OPTIONS.map(({ value, label }) => (
              <Button
                key={value}
                size="sm"
                className={view === value ? "note__view note__view--active" : "note__view"}
                aria-pressed={view === value}
                onClick={() => void selectView(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        {pendingUndo != null && (
          <div className="note__undo" role="status">
            <span className="note__undo-text">
              {pendingUndo.withCards
                ? strings.notes.deletedWithCardsNotice
                : strings.notes.deletedNotice}
            </span>
            <Button size="sm" className="note__undo-action" onClick={() => void undo()}>
              {strings.notes.undo}
            </Button>
            <Button
              size="sm"
              className="note__undo-dismiss"
              aria-label={strings.notes.dismiss}
              onClick={() => setPendingUndo(null)}
            >
              ×
            </Button>
          </div>
        )}

        {failed ? (
          <EmptyState title={strings.notes.listEmptyTitle} description={strings.notes.loadError} />
        ) : notes === null ? (
          <p className="app__muted">{strings.app.loading}</p>
        ) : notes.length === 0 ? (
          <EmptyState
            title={strings.notes.listEmptyTitle}
            description={strings.notes.listEmptyDescription}
          />
        ) : visibleNotes.length === 0 ? (
          <EmptyState
            title={strings.notes.listEmptyTitle}
            description={strings.notes.tagFilterEmptyDescription}
          />
        ) : view === "list" ? (
          <ul className="note__list">
            {visibleNotes.map((note) => (
              <li key={note.id} className="note__item-row">
                {renderNoteEntry(note, formatNoteDate(note.updatedAt))}
              </li>
            ))}
          </ul>
        ) : (
          // The same notes, one card each, in the same order (the config
          // carries no sort — see CARDS_CONFIG). The wrapper owns the scroll the
          // <ul> owns in the other shape; the grid, the card frame and its
          // padding are the UI package's.
          <div className="note__cards">
            <CardsView<NoteFields>
              items={visibleNotes}
              schema={NOTE_SCHEMA}
              config={CARDS_CONFIG}
              itemKey={(note) => note.id}
              renderItem={(note) => (
                <div className="note__item-row">
                  {renderNoteEntry(note, formatNotificationWhen(note.updatedAt))}
                </div>
              )}
            />
          </div>
        )}
      </div>

      <div className="note__editor-pane">
        {selectedId != null ? (
          <NoteEditor
            key={selectedId}
            profileId={profileId}
            noteId={selectedId}
            onSaved={() => void loadNotes()}
            onOpenNote={setSelectedId}
            // Handed over only to the note it was resolved for, and dropped the
            // moment the editor reports it applied — otherwise navigating away
            // and back to that note would append the template a second time.
            initialTemplate={
              pendingTemplate?.noteId === selectedId ? pendingTemplate.blocks : null
            }
            onInitialTemplateApplied={clearPendingTemplate}
          />
        ) : (
          <div className="note__editor-empty">
            <EmptyState
              title={strings.notes.noSelectionTitle}
              description={strings.notes.noSelectionDescription}
            />
          </div>
        )}
      </div>

      {pendingDelete != null && (
        <NoteCardsDeleteDialog
          noteTitle={
            pendingDelete.note.title.trim().length > 0
              ? pendingDelete.note.title
              : strings.notes.untitled
          }
          cardCount={pendingDelete.cardCount}
          onChoose={(disposition) => {
            const { note } = pendingDelete;
            setPendingDelete(null);
            void performDelete(note, disposition);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
