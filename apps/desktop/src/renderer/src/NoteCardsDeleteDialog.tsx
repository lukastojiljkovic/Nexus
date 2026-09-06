import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { Button } from "@nexus/ui";
import type { NoteCardDisposition } from "../../shared/ipc.js";
import { countUnit, strings } from "./strings.js";
import { useFocusTrap } from "./useFocusTrap.js";

export interface NoteCardsDeleteDialogProps {
  /** The note being deleted, already resolved to a display title by the caller. */
  noteTitle: string;
  /** How many live cards this note generates — always at least one, or the dialog would not be open. */
  cardCount: number;
  onChoose: (disposition: NoteCardDisposition) => void;
  onCancel: () => void;
}

/**
 * „Šta sa njima?“ — the two things deleting a note with generated flashcards
 * can mean (PRD 09 §7), asked rather than assumed, because they lose different
 * things: one leaves the cards studiable with their whole FSRS history, the
 * other takes them out of study with the note. Review history is sacred
 * (ADR-031/046), so it is never spent on the user's behalf.
 *
 * The house dialog recipe, shared outright with the recurrence scope question
 * and the task-list delete question; only the wording differs. Deliberately
 * without a default: no primary button, Enter picks nothing, and Escape, the
 * backdrop and Otkaži all cancel and change nothing.
 */
export function NoteCardsDeleteDialog({
  noteTitle,
  cardCount,
  onChoose,
  onCancel,
}: NoteCardsDeleteDialogProps) {
  const s = strings.notes.cardsDialog;
  const titleId = useId();
  const questionId = useId();

  // Focus lands on the first choice, not on a default: answerable from the
  // keyboard without any key already meaning "and the cards too" — the
  // trap's own default (the first tabbable descendant), since the choices
  // come before „Otkaži". It also cycles Tab and hands focus back on close.
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const counted = `${cardCount} ${countUnit(cardCount, s.countOne, s.countFew, s.countMany)}`;

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onCancel} />
      <div
        ref={panelRef}
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
        <p id={questionId} className="nx-hint">
          {counted}. {s.question} {s.keepNote}
        </p>
        <div className="recur-dialog__choices">
          <Button className="recur-dialog__choice" onClick={() => onChoose("keep")}>
            {s.keep}
          </Button>
          <Button className="recur-dialog__choice" onClick={() => onChoose("delete")}>
            {s.deleteCards}
          </Button>
        </div>
        <div className="recur-dialog__actions">
          <Button className="recur-dialog__cancel" onClick={onCancel}>
            {s.cancel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
