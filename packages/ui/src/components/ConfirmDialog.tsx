import { useRef, type RefObject } from "react";

import { Button } from "./Button.js";
import { Dialog } from "./Dialog.js";
import { initialFocusIndex } from "./dialogFocus.js";

export interface ConfirmDialogProps {
  /** The question, as the panel's heading. */
  title: string;
  /**
   * The thing itself — a row's label, a file's name. Rendered between the
   * heading and the question, in full-strength text, so the one fact a reader
   * needs before answering is the one thing that is read first.
   */
  name?: string | undefined;
  /** What answering costs, in one sentence. */
  question: string;
  /**
   * The part that is NOT lost, when there is one — „the note itself stays in
   * its folder". A dialog that only says what is lost trains people to skip it.
   */
  note?: string | undefined;
  confirmLabel: string;
  cancelLabel: string;
  /**
   * True when the act destroys something. It moves the OPENING focus to the
   * cancelling answer, so the key a keyboard user presses without reading is
   * the one that changes nothing — the APG's „least destructive action" rule,
   * and the reason this is a field rather than something the caller arranges
   * by reordering children.
   */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Which of the two answers takes the opening focus, as the ref the trap lands
 * on.
 *
 * The indices are the row's OWN order, which the component beneath writes: the
 * cancelling answer at 0, the answer that acts at 1. „The least destructive
 * action" is therefore index 0 whenever the act destroys something, and index 1
 * when it does not — there the act IS what was asked for, so declining it is
 * the surprise. Stated here as a function rather than inline because it is the
 * rule `dialogFocus.ts` states in the abstract, and the one place the rule and
 * the row's markup are held together.
 */
export function confirmFocus(
  destructive: boolean,
  cancelRef: RefObject<HTMLElement | null>,
  confirmRef: RefObject<HTMLElement | null>,
): RefObject<HTMLElement | null> {
  return initialFocusIndex(2, destructive) === 0 ? cancelRef : confirmRef;
}

/**
 * The house confirmation, as one component instead of one markup recipe.
 *
 * The recipe had been re-typed by hand in the renderer — the overlay, the
 * backdrop, the focus trap, the Escape listener and the same six class names —
 * and a rule written that many times has already begun to drift. This is the
 * statement of the answers: `Dialog` draws the frame, the trap, Escape and the
 * backdrop it belongs to, and this component adds the two buttons the question
 * is answered with — the cancelling one first in the DOM, so that „the least
 * destructive action" and the row's own reading order are the same fact.
 *
 * **Deliberately without a default.** Nothing here is a filled primary and
 * Enter therefore picks nothing until a button has focus: a confirmation that
 * acts on a bare Enter is a confirmation that deletes what the user was still
 * reading about. The confirming button is the danger variant when the act is
 * destructive and the quiet one when it is not, so the weight on screen is the
 * weight of the act.
 *
 * For an unrecoverable delete that takes OTHER rows with it, this is the wrong
 * component and the app has the right one: `TypedConfirmDialog`, whose typed
 * name is what makes that class of answer deliberate. This is for a single act
 * with a single cost — removing one row, discarding one draft.
 */
export function ConfirmDialog({
  title,
  name,
  question,
  note,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  return (
    <Dialog
      title={title}
      subject={name}
      description={question}
      onClose={onCancel}
      initialFocusRef={confirmFocus(destructive, cancelRef, confirmRef)}
      actions={
        <>
          <Button ref={cancelRef} className="nx-dialog__cancel" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant={destructive ? "danger" : "primary"}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {note != null && <p className="nx-hint">{note}</p>}
    </Dialog>
  );
}
