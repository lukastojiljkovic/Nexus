import { useCallback, useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button, TextField } from "@nexus/ui";
import type { Profile } from "../../shared/ipc.js";
import { authErrorMessage, formatCountdown } from "./AuthGate.js";
import { profileDisplayName } from "./profilePrefs.js";
import { strings } from "./strings.js";
import { useFocusTrap } from "./useFocusTrap.js";

export interface ProfileSwitchDialogProps {
  /** The profile being switched INTO — named in the dialog, the reset dialog's own idiom. */
  profile: Profile;
  /** The passcode checked out: the caller lands the switch. */
  onVerified: () => void;
  onCancel: () => void;
}

/**
 * The passcode gate in front of every profile switch (ADR-058 / AUTH-024), on
 * the house dialog recipe (`SettingsResetDialog`'s classes): one password
 * field, „Potvrdi“, and no path around it — Escape, the backdrop and „Otkaži“
 * all cancel, and there is deliberately no button that switches without the
 * passcode. Enter submits the FORM, which IS the gate.
 *
 * `verifyProfileSwitch` answers with the unlock's own vocabulary and charges
 * the SAME throttle counter the lock screen uses, so refusals reuse the lock
 * screen's sentences (`authErrorMessage`) and a throttle counts down here
 * exactly as it does there — the `UnlockForm` interval, one tick a second.
 */
export function ProfileSwitchDialog({ profile, onVerified, onCancel }: ProfileSwitchDialogProps) {
  const s = strings.profiles;
  const [passcode, setPasscode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedForMs, setLockedForMs] = useState(0);
  const titleId = useId();
  const questionId = useId();

  // Focus lands on the passcode field — the trap's own default (the first
  // tabbable descendant), which `autoFocus` used to do less reliably (and
  // without cycling Tab inside the panel or returning focus on close).
  const panelRef = useFocusTrap<HTMLDivElement>({ open: true });

  const stillLocked = lockedForMs > 0;

  useEffect(() => {
    if (!stillLocked) return;
    const interval = setInterval(() => {
      setLockedForMs((previous) => Math.max(previous - 1000, 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [stillLocked]);

  // Ignored while a verify is in flight: a cancel that unmounts the dialog
  // mid-call would leave `onVerified` to fire from the settled promise and
  // land a switch the user just called off. The window is one IPC round trip.
  const cancel = useCallback(() => {
    if (!submitting) onCancel();
  }, [submitting, onCancel]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [cancel]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || stillLocked) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await window.nexus.verifyProfileSwitch(passcode);
      if (result.ok) {
        onVerified();
        return;
      }
      setError(authErrorMessage(result.reason));
      if (result.reason === "throttled" && result.lockedForMs != null) {
        setLockedForMs(result.lockedForMs);
      }
    } catch (verifyError) {
      setError(strings.auth.error.generic);
      console.error("Nexus: failed to verify the profile switch:", verifyError);
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="recur-dialog__overlay">
      <div className="recur-dialog__backdrop" onClick={cancel} />
      <div
        ref={panelRef}
        className="recur-dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={questionId}
      >
        <h2 id={titleId} className="recur-dialog__title">
          {s.switchTitle}
        </h2>
        <p className="recur-dialog__name">„{profileDisplayName(profile)}“</p>
        <p id={questionId} className="recur-dialog__question">
          {s.switchQuestion}
        </p>
        <form className="app__profile-dialog-form" onSubmit={(event) => void submit(event)}>
          <TextField
            type="password"
            label={s.switchPasscodeLabel}
            value={passcode}
            required
            disabled={stillLocked}
            onChange={(event) => setPasscode(event.target.value)}
          />
          {stillLocked && (
            <p className="recur-dialog__question">
              {strings.auth.unlock.retryPrefix} {formatCountdown(lockedForMs)}
            </p>
          )}
          {error != null && (
            <p className="set__error" role="alert">
              {error}
            </p>
          )}
          <div className="recur-dialog__actions app__profile-dialog-actions">
            <Button type="button" className="recur-dialog__cancel" disabled={submitting} onClick={cancel}>
              {s.switchCancel}
            </Button>
            <Button type="submit" variant="primary" disabled={submitting || stillLocked}>
              {s.switchConfirm}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
