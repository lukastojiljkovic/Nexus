import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState } from "@nexus/ui";
import type { NoteMeta } from "../../shared/ipc.js";
import { NoteEditor } from "./NoteEditor.js";
import { strings } from "./strings.js";

/** Note-list date: compact sr-Latn day + month, degrading to the raw value. */
function formatNoteDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat("sr-Latn", { day: "2-digit", month: "short" }).format(date);
}

export interface NotesPageProps {
  profileId: string;
}

/**
 * The NOTE module page (slice a2): a two-pane workspace — a left list of notes
 * (newest-updated first, straight from the store) and a right-hand block editor
 * for the selected note. New notes are created empty and titled from their
 * content (Notion-style, no separate title field). Every write goes through the
 * notes:* IPC allowlist; the editor owns the live Yjs doc, main owns storage.
 */
export function NotesPage({ profileId }: NotesPageProps) {
  const [notes, setNotes] = useState<NoteMeta[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await window.nexus.listNotes(profileId);
        if (active) setNotes(list);
      } catch (error) {
        if (active) setFailed(true);
        console.error("Nexus: failed to load notes:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  // Refresh after a flush: the edited note's title/updated_at changed, so it
  // re-sorts to the top. Await-then-apply, never optimistic (house style).
  const refreshList = useCallback(async () => {
    try {
      setNotes(await window.nexus.listNotes(profileId));
    } catch (error) {
      console.error("Nexus: failed to refresh notes:", error);
    }
  }, [profileId]);

  async function create(): Promise<void> {
    try {
      const created = await window.nexus.createNote(profileId);
      setNotes((prev) => (prev ? [created, ...prev] : [created]));
      setSelectedId(created.id);
    } catch (error) {
      console.error("Nexus: failed to create note:", error);
    }
  }

  async function remove(note: NoteMeta): Promise<void> {
    try {
      await window.nexus.deleteNote(profileId, note.id);
      setNotes((prev) => prev && prev.filter((current) => current.id !== note.id));
      if (selectedId === note.id) setSelectedId(null);
      // One pending undo at a time — a fresh delete replaces the previous offer.
      setPendingUndoId(note.id);
    } catch (error) {
      console.error("Nexus: failed to delete note:", error);
    }
  }

  async function undo(): Promise<void> {
    if (!pendingUndoId) return;
    try {
      await window.nexus.restoreNote(profileId, pendingUndoId);
      setPendingUndoId(null);
      // Re-fetch so the restored note lands back in updated-order.
      await refreshList();
    } catch (error) {
      console.error("Nexus: failed to restore note:", error);
    }
  }

  return (
    <div className="note">
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
        ) : (
          <ul className="note__list">
            {notes.map((note) => (
              <li key={note.id} className="note__item-row">
                <button
                  type="button"
                  className={
                    note.id === selectedId
                      ? "note__item note__item--active"
                      : "note__item"
                  }
                  aria-current={note.id === selectedId ? "true" : undefined}
                  onClick={() => setSelectedId(note.id)}
                >
                  <span className="note__item-title">
                    {note.title.trim().length > 0 ? note.title : strings.notes.untitled}
                  </span>
                  <span className="note__item-date">{formatNoteDate(note.updatedAt)}</span>
                </button>
                <Button
                  size="sm"
                  className="note__delete"
                  aria-label={strings.notes.deleteLabel}
                  onClick={() => void remove(note)}
                >
                  ×
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="note__editor-pane">
        {selectedId != null ? (
          <NoteEditor
            key={selectedId}
            profileId={profileId}
            noteId={selectedId}
            onSaved={() => void refreshList()}
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
