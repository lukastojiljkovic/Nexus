import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState } from "@nexus/ui";
import type { NoteFolder, NoteMeta, NoteTag, NoteTagLink } from "../../shared/ipc.js";
import { NoteEditor } from "./NoteEditor.js";
import { NoteOrganizer, type FolderSelection } from "./NoteOrganizer.js";
import { NotePopover } from "./notePopover.js";
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

export interface NotesPageProps {
  profileId: string;
}

/**
 * The NOTE module page (slice a3b, tags in a3b-2): a three-pane workspace —
 * the folder organizer (left, also hosting the tag filter and tag CRUD), the
 * note list filtered by folder then narrowed client-side by the tag filter and
 * ordered pinned-first (middle), and the block editor for the selected note
 * (right). Folders, pinning, foldering, and tagging all go through the note
 * organization IPC allowlist; the editor owns the live Yjs doc, main owns
 * storage. Writes are await-then-refetch (never optimistic), the house style.
 */
export function NotesPage({ profileId }: NotesPageProps) {
  const [folders, setFolders] = useState<NoteFolder[]>([]);
  const [selection, setSelection] = useState<FolderSelection>({ kind: "all" });
  const [notes, setNotes] = useState<NoteMeta[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  const [tags, setTags] = useState<NoteTag[]>([]);
  const [links, setLinks] = useState<NoteTagLink[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);

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

  async function create(): Promise<void> {
    try {
      const created = await window.nexus.createNote(profileId);
      // A note created while a folder is selected belongs to that folder.
      if (selection.kind === "folder") {
        await window.nexus.setNoteFolder(profileId, created.id, selection.id);
      }
      setSelectedId(created.id);
      await loadNotes();
    } catch (error) {
      console.error("Nexus: failed to create note:", error);
    }
  }

  async function remove(note: NoteMeta): Promise<void> {
    try {
      await window.nexus.deleteNote(profileId, note.id);
      if (selectedId === note.id) setSelectedId(null);
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoId(note.id);
      await loadNotes();
    } catch (error) {
      console.error("Nexus: failed to delete note:", error);
    }
  }

  async function undo(): Promise<void> {
    if (!pendingUndoId) return;
    try {
      await window.nexus.restoreNote(profileId, pendingUndoId);
      setPendingUndoId(null);
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

        {pendingUndoId != null && (
          <div className="note__undo" role="status">
            <span className="note__undo-text">{strings.notes.deletedNotice}</span>
            <Button size="sm" className="note__undo-action" onClick={() => void undo()}>
              {strings.notes.undo}
            </Button>
            <Button
              size="sm"
              className="note__undo-dismiss"
              aria-label={strings.notes.dismiss}
              onClick={() => setPendingUndoId(null)}
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
        ) : (
          <ul className="note__list">
            {visibleNotes.map((note) => {
              const noteTagIds = tagsByNote.get(note.id);
              const noteTags =
                noteTagIds && noteTagIds.size > 0
                  ? sortedTags.filter((tag) => noteTagIds.has(tag.id))
                  : [];
              return (
              <li key={note.id} className="note__item-row">
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
                  <span className="note__item-date">{formatNoteDate(note.updatedAt)}</span>
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
              </li>
              );
            })}
          </ul>
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
    </div>
  );
}
