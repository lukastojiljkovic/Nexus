import { useEffect, useId, useRef } from "react";

import { Button } from "./Button.js";
import { initialFocusIndex } from "./dialogFocus.js";
import { useFocusTrap } from "./useFocusTrap.js";

/** The panel's ARIA, derived from the two ids the component renders. */
export function dialogAria(input: {
  readonly titleId: string;
  readonly describedById: string;
}): {
  role: "dialog";
  "aria-modal": true;
  "aria-labelledby": string;
  "aria-describedby": string;
} {
  return {
    role: "dialog",
    "aria-modal": true,
    "aria-labelledby": input.titleId,
    "aria-describedby": input.describedById,
  };
}

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
 * The house confirmation, as one component instead of one markup recipe.
 *
 * The recipe had been re-typed by hand in the renderer — the overlay, the
 * backdrop, the focus trap, the Escape listener and the same six class names —
 * and a rule written that many times has already begun to drift. This is the
 * statement of it: `role="dialog"`, `aria-modal`, the focus trap from
 * `useFocusTrap.ts`, Escape and the backdrop both cancelling, and the two
 * answers in one row with the cancelling one first in the DOM.
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
  const titleId = useId();
  const questionId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  // 0 is the cancelling answer and 1 the acting one: the same order the row is
  // written in, which is why the index can be stated rather than searched for.
  const wanted = initialFocusIndex(2, destructive);
  const initialFocusRef = wanted === 0 ? cancelRef : confirmRef;
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true, initialFocusRef });

  // A document listener rather than the panel's own handler: Escape has to
  // cancel even in the frame before focus has settled inside the panel, and
  // every dialog in the app answers Escape the same way.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel]);

  return (
    // Rendered where it is written, without a portal: the shell's scrolling
    // column creates no containing block (no transform, filter or containment
    // on it), so a `position: fixed` panel here is already positioned against
    // the window and already paints at the dialog layer — and this package
    // deliberately does not depend on `react-dom`, which is what a portal
    // would cost it.
    <div className="nx-dialog__overlay">
      <div className="nx-dialog__backdrop" onClick={onCancel} />
      <div ref={panelRef} className="nx-dialog__panel" {...dialogAria({ titleId, describedById: questionId })}>
        <h2 id={titleId} className="nx-dialog__title">
          {title}
        </h2>
        {name != null && <p className="nx-dialog__name">„{name}“</p>}
        <p id={questionId} className="nx-hint nx-dialog__question">
          {question}
        </p>
        {note != null && <p className="nx-hint">{note}</p>}
        <div className="nx-dialog__actions">
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
        </div>
      </div>
    </div>
  );
}
