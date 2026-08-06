import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@nexus/ui";
import { strings } from "./strings.js";

export interface FocusDiscardDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * „Odbaci" (UTIL slice b), asked before it runs. Discarding a running focus
 * phase writes nothing at all — unlike „Završi", which the row survives as
 * history, a discard loses the elapsed time outright and there is no undo to
 * offer afterwards. That asymmetry is exactly why this one asks first.
 *
 * The house dialog recipe, shared outright with the settings-reset question;
 * only the wording differs. Deliberately without a default: no primary
 * button, Enter picks nothing, and Escape, the backdrop and Otkaži all cancel
 * and change nothing.
 *
 * Shared by FocusPage and StudyPage — one running phase, one discard act,
 * whichever page is showing it.
 */
export function FocusDiscardDialog({ onConfirm, onCancel }: FocusDiscardDialogProps) {
  const s = strings.focus.running.discardDialog;
  const choicesRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const questionId = useId();

  // Focus lands on the one choice, not on a default: answerable from the
  // keyboard without any key already meaning "yes".
  useEffect(() => {
    choicesRef.current?.querySelector("button")?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

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
        <p id={questionId} className="recur-dialog__question">
          {s.question}
        </p>
        <div className="recur-dialog__choices" ref={choicesRef}>
          <Button className="recur-dialog__choice" onClick={onConfirm}>
            {s.confirm}
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
