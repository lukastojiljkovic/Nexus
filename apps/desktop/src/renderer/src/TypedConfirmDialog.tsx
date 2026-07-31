import { useEffect, useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, TextField } from "@nexus/ui";

/**
 * The typed-name confirmation dialog (PRIV v1 / ADR-057), extracted because
 * three flows ask the same shape of question with different copy: the private
 * hard delete, „Premesti u Privatno" and „Premesti u Beleške". The idiom is
 * the account-delete form's (`AuthGate`) inside the house dialog frame
 * (`recur-dialog__*`): the warning is read BEFORE the field, the destructive
 * button stays disabled until the typed text matches `confirmValue` exactly,
 * and Escape/backdrop/Otkaži all cancel and change nothing. The typed match
 * is a UX gate only — main re-validates every id it is handed.
 */
export interface TypedConfirmDialogProps {
  title: string;
  /** The entity's own display name, quoted under the title. */
  name: string;
  warning: string;
  /** An optional second, non-warning sentence (what deliberately survives, say). */
  note?: string;
  confirmLabel: string;
  confirmPlaceholder: string;
  /** What must be typed — the caller resolves the display title fallback. */
  confirmValue: string;
  submitLabel: string;
  cancelLabel: string;
  /** Transient error line under the field (a failed IPC call), or null. */
  error?: string | null;
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export function TypedConfirmDialog({
  title,
  name,
  warning,
  note,
  confirmLabel,
  confirmPlaceholder,
  confirmValue,
  submitLabel,
  cancelLabel,
  error,
  busy = false,
  danger = false,
  onConfirm,
  onCancel,
  children,
}: TypedConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const titleId = useId();
  const matches = typed.trim() === confirmValue;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy || !matches) return;
    onConfirm();
  }

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={onCancel} />
      <form
        className="recur-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {title}
        </h2>
        <p className="recur-dialog__name">„{name}“</p>
        <p className="recur-dialog__question">{warning}</p>
        {note != null && <p className="recur-dialog__question">{note}</p>}
        <TextField
          label={confirmLabel}
          placeholder={confirmPlaceholder}
          value={typed}
          autoFocus
          required
          onChange={(event) => setTyped(event.target.value)}
        />
        {error != null && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}
        {children}
        <div className="recur-dialog__actions">
          <Button
            type="submit"
            variant={danger ? "danger" : "primary"}
            disabled={busy || !matches}
          >
            {submitLabel}
          </Button>
          <Button type="button" className="recur-dialog__cancel" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
