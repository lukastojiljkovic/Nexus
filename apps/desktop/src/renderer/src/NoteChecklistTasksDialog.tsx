import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@nexus/ui";
import type { TaskList } from "../../shared/ipc.js";
import { countUnit, strings } from "./strings.js";

export interface NoteChecklistTasksDialogProps {
  profileId: string;
  /** The note being converted, already resolved to a display title by the caller. */
  noteTitle: string;
  /** How many rows would become tasks — always at least one, or the dialog would not be open. */
  itemCount: number;
  /** The chosen list. The write itself stays with the page, exactly as the delete dialog leaves the delete to it. */
  onConvert: (listId: string) => void;
  onCancel: () => void;
}

/**
 * „Pretvori u zadatke“ (NOTE §6): which list this note's checklist goes into.
 *
 * The house dialog recipe, shared outright with the note-delete question and the
 * recurrence scope question — but with a PRIMARY action, unlike those two: this
 * one asks *where*, not *which of two things it should do*, so there is a
 * default-shaped answer and „Pretvori“ may look like one. Escape, the backdrop
 * and Otkaži all cancel and change nothing.
 *
 * The list picker fetches its own lists: this dialog is the only place in the
 * NOTE module that touches the TASK rail, and threading that state through the
 * notes page would put it there permanently for one menu entry.
 */
export function NoteChecklistTasksDialog({
  profileId,
  noteTitle,
  itemCount,
  onConvert,
  onCancel,
}: NoteChecklistTasksDialogProps) {
  const s = strings.notes.checklistTasks;
  const [lists, setLists] = useState<TaskList[] | null>(null);
  const [listId, setListId] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);
  const titleId = useId();
  const questionId = useId();

  // The Inbox is the default because it is where a task with no named home
  // lands everywhere else in the app (`TaskStore.create`'s own default), and a
  // checklist promoted out of a note is exactly that kind of task.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const snapshot = await window.nexus.listTaskLists(profileId);
        if (!active) return;
        setLists(snapshot.lists);
        const preferred = snapshot.lists.find((list) => list.isInbox) ?? snapshot.lists[0];
        setListId(preferred?.id ?? "");
      } catch (error) {
        if (active) setLists([]);
        console.error("Nexus: failed to load task lists:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  // Focus lands on the picker, not on „Pretvori“: the list is what there is to
  // answer here, and it is answerable from the keyboard without Enter already
  // meaning "and convert into whatever was preselected". Keyed on `lists`, which
  // is set exactly once — changing the selection must not re-grab focus.
  useEffect(() => {
    selectRef.current?.focus();
  }, [lists]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const counted = `${itemCount} ${countUnit(itemCount, s.countOne, s.countFew, s.countMany)}`;

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onCancel} />
      <div
        className="recur-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={questionId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.title}
        </h2>
        <p className="recur-dialog__name">„{noteTitle}“</p>
        <p id={questionId} className="recur-dialog__question">
          {counted}. {s.question} {s.keepNote}
        </p>
        {lists === null ? (
          <p className="recur-dialog__question">{strings.app.loading}</p>
        ) : lists.length === 0 ? (
          <p className="recur-dialog__question">{s.noLists}</p>
        ) : (
          <select
            ref={selectRef}
            className="note__cards-select"
            aria-label={s.listLabel}
            value={listId}
            onChange={(event) => setListId(event.target.value)}
          >
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        )}
        <div className="recur-dialog__actions note__checklist-actions">
          <Button className="recur-dialog__cancel" onClick={onCancel}>
            {s.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={listId.length === 0}
            onClick={() => onConvert(listId)}
          >
            {s.convert}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
