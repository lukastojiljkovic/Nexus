import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { Button } from "@nexus/ui";
import { useFocusTrap } from "./useFocusTrap.js";

export interface ConfirmDialogProps {
  /** What is being asked, as a heading. */
  title: string;
  /** The thing itself — a file name, a row's label. Quoted, and omitted when the title already names it. */
  name?: string;
  /** The question, and what answering it costs. One sentence. */
  question: string;
  /** A second line under the question for the part that is NOT lost, when there is one. */
  note?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The house confirmation, as a component rather than a shape people re-type.
 *
 * The recipe is `FocusDiscardDialog`'s verbatim, and that is the point: this
 * markup had been written out by hand in four separate files, each with its own
 * copy of the focus trap, the Escape listener, the portal and the six class
 * names. A rule written four times is a rule that has already begun to drift.
 *
 * **Deliberately without a default.** No primary button, so Enter picks nothing
 * until a choice is focused; Escape, the backdrop and „Otkaži" all cancel and
 * change nothing. Focus lands on the one choice — the trap's own default, since
 * the choice precedes the cancel in the DOM.
 *
 * For an unrecoverable delete that takes OTHER rows with it, this is the wrong
 * component: `TypedConfirmDialog` is, because typing the name back is what makes
 * that class of answer deliberate. This one is for a single act with a single
 * cost — removing one file, discarding one phase.
 */
export function ConfirmDialog({
  title,
  name,
  question,
  note,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const questionId = useId();
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel]);

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
          {title}
        </h2>
        {name != null && <p className="recur-dialog__name">„{name}“</p>}
        <p id={questionId} className="nx-hint">
          {question}
        </p>
        {note != null && <p className="nx-hint">{note}</p>}
        <div className="recur-dialog__choices">
          <Button className="recur-dialog__choice" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
        <div className="recur-dialog__actions">
          <Button className="recur-dialog__cancel" onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
