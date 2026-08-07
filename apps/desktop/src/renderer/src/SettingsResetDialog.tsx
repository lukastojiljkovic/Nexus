import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { Button } from "@nexus/ui";
import { strings } from "./strings.js";
import { useFocusTrap } from "./useFocusTrap.js";

export interface SettingsResetDialogProps {
  /** The card being reset, by its own title — the dialog names it rather than describing it in prose. */
  sectionTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * „Vrati na podrazumevano“ (SET §5) — asked before it happens, on the house
 * dialog recipe shared outright with the recurrence-scope question and the
 * note-cards question; only the wording differs.
 *
 * Deliberately without a default: no primary button, Enter picks nothing, and
 * Escape, the backdrop and Otkaži all cancel and change nothing. A reset is
 * cheap to redo but tedious — eight accent swatches and a theme are a minute
 * of somebody's afternoon — so it is never one stray keystroke away.
 *
 * The card is named, not described, because the reset's whole promise is that
 * it reaches exactly that card: a sentence per section would be five sentences
 * saying the same thing, and the one thing that actually differs is the name.
 */
export function SettingsResetDialog({
  sectionTitle,
  onConfirm,
  onCancel,
}: SettingsResetDialogProps) {
  const s = strings.settings.reset;
  const titleId = useId();
  const questionId = useId();

  // Focus lands on the one choice, not on a default: answerable from the
  // keyboard without any key already meaning "yes" — the trap's own default
  // (the first tabbable descendant), since the choice comes before „Otkaži".
  // It also cycles Tab within the panel and hands focus back on close.
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

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
        <p className="recur-dialog__name">„{sectionTitle}“</p>
        <p id={questionId} className="recur-dialog__question">
          {s.question}
        </p>
        <div className="recur-dialog__choices">
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
