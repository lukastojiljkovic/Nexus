import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@nexus/ui";
import { strings } from "./strings.js";

/** Which occurrences an edit or a delete reaches (ADR-024). */
export type RecurrenceScope = "this" | "future" | "all";

const SCOPES: readonly RecurrenceScope[] = ["this", "future", "all"];

export interface RecurrenceScopeDialogProps {
  /** Which question to ask; a drag to another day is an edit, so it shares that wording. */
  action: "edit" | "delete";
  onChoose: (scope: RecurrenceScope) => void;
  onCancel: () => void;
}

/**
 * The "Samo ovaj / Ovaj i budući / Svi" choice (PRD 04, ADR-024). One component
 * for all three flows — editing an occurrence, deleting one, and dropping one on
 * another day — because they ask the identical question and only differ in the
 * verb.
 *
 * Deliberately without a default: there is no primary button and Enter picks
 * nothing, since silently reaching a whole series is precisely what this dialog
 * exists to prevent. Escape, the backdrop and Otkaži all cancel. Same overlay
 * recipe as the search palette (backdrop and panel as siblings, never
 * ancestor/descendant, so dimming the page does not wash out the panel), no
 * glow, tokens only.
 */
export function RecurrenceScopeDialog({ action, onChoose, onCancel }: RecurrenceScopeDialogProps) {
  const s = strings.recurrence.scope;
  const choicesRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const questionId = useId();

  // Focus lands on the first choice, not on a default: the dialog opens ready
  // to be answered from the keyboard without any key already meaning "yes".
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

  const label: Record<RecurrenceScope, string> = { this: s.this, future: s.future, all: s.all };

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
          {action === "delete" ? s.questionDelete : s.questionEdit}
        </p>
        <div className="recur-dialog__choices" ref={choicesRef}>
          {SCOPES.map((scope) => (
            <Button key={scope} className="recur-dialog__choice" onClick={() => onChoose(scope)}>
              {label[scope]}
            </Button>
          ))}
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
