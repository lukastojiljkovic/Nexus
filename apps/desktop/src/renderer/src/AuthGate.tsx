import { useEffect, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Button, Card, Checkbox, TextField } from "@nexus/ui";
import { PASSCODE_MIN_LENGTH } from "../../shared/ipc.js";
import type { AuthErrorReason, AuthStatus } from "../../shared/ipc.js";
import { strings } from "./strings.js";

/**
 * The local-account lock screen (ADR-018). Four screens share one shell,
 * mirroring `Onboarding`'s `.onb`/`.onb__card` structure so the first thing a
 * user ever sees matches the second: (a) create the passcode, (b) the
 * one-time Recovery Kit, (c) unlock, (d) recovery. `App` renders this instead
 * of the app shell whenever `status.state !== "unlocked"`.
 */
export interface AuthGateProps {
  status: AuthStatus;
  /** Re-reads status from main; the gate calls it after every successful action. */
  onUnlocked: () => void;
}

type Screen = "create" | "recoveryKit" | "unlock" | "recovery";

function initialScreen(status: AuthStatus): Screen {
  if (status.state === "uninitialized") return "create";
  if (status.requiresRecovery) return "recovery";
  return "unlock";
}

// Mirrors @nexus/core/auth's own Unicode-aware check (HAS_LETTER/HAS_DIGIT) —
// a client-side pre-check only; the server result stays authoritative.
const HAS_LETTER = /\p{L}/u;
const HAS_DIGIT = /\p{N}/u;

/** Client-side pre-check for the passcode policy (a letter, a digit, `PASSCODE_MIN_LENGTH` characters). Exported so Settings' change-passcode form uses the identical rule. */
export function passcodeMeetsPolicy(value: string): boolean {
  return value.length >= PASSCODE_MIN_LENGTH && HAS_LETTER.test(value) && HAS_DIGIT.test(value);
}

/** Every `AuthErrorReason` mapped to its own Serbian sentence — the `default` only guards against a reason this build does not know about yet. Exported so Settings' security actions share the same mapping. */
export function authErrorMessage(reason: AuthErrorReason): string {
  const messages = strings.auth.error;
  switch (reason) {
    case "notInitialized":
      return messages.notInitialized;
    case "alreadyInitialized":
      return messages.alreadyInitialized;
    case "wrongPasscode":
      return messages.wrongPasscode;
    case "wrongRecoveryCode":
      return messages.wrongRecoveryCode;
    case "throttled":
      return messages.throttled;
    case "weakPasscode":
      return messages.weakPasscode;
    case "keystoreUnavailable":
      return messages.keystoreUnavailable;
    case "otherDevice":
      return messages.otherDevice;
    case "corruptKeychain":
      return messages.corruptKeychain;
    default:
      return messages.generic;
  }
}

/** `lockedForMs` as a live "m:ss" countdown — sidesteps Serbian's three-way plural for "second" entirely. */
function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export interface RecoveryKitPanelProps {
  code: string;
  /** Enabled only once the confirm checkbox is ticked — the code is never shown again after this. */
  onContinue: () => void;
}

/**
 * The one-time Recovery Kit display: a selectable monospace code block, a
 * clipboard button, and a confirm checkbox gating the continue action. Used
 * both here (screen b, right after account creation) and by `SettingsPage`'s
 * "Novi kod za oporavak" action — one component, so the two never drift.
 */
export function RecoveryKitPanel({ code, onContinue }: RecoveryKitPanelProps) {
  const [confirmed, setConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch (error) {
      console.error("Nexus: failed to copy the recovery code:", error);
    }
  }

  return (
    <div className="auth__recovery-kit">
      <h1 className="auth__title">{strings.auth.recoveryKit.title}</h1>
      <p className="auth__note">{strings.auth.recoveryKit.description}</p>
      <pre className="auth__code">{code}</pre>
      <Button size="sm" onClick={() => void copy()}>
        {copied ? strings.auth.recoveryKit.copied : strings.auth.recoveryKit.copy}
      </Button>
      <Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}>
        {strings.auth.recoveryKit.confirmCheckbox}
      </Checkbox>
      <Button variant="primary" disabled={!confirmed} onClick={onContinue}>
        {strings.auth.recoveryKit.continue}
      </Button>
    </div>
  );
}

interface CreateFormProps {
  status: AuthStatus;
  onCreated: (recoveryCode: string) => void;
}

/** Screen (a): the passcode-creation form, or — when the OS keystore is unavailable — an explanation with no form at all (ADR-018: never a silent PIN-only downgrade). */
function CreateForm({ status, onCreated }: CreateFormProps) {
  const [passcode, setPasscode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status.keystoreAvailable) {
    return (
      <>
        <h1 className="auth__title">{strings.auth.keystoreUnavailable.title}</h1>
        <p className="auth__note">{strings.auth.keystoreUnavailable.description}</p>
      </>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (!passcodeMeetsPolicy(passcode)) {
      setError(strings.auth.validation.tooWeak);
      return;
    }
    if (passcode !== confirm) {
      setError(strings.auth.validation.mismatch);
      return;
    }
    setSubmitting(true);
    try {
      const result = await window.nexus.createAccount(passcode);
      if (result.ok && result.recoveryCode) {
        onCreated(result.recoveryCode);
        return;
      }
      setError(result.ok ? strings.auth.error.generic : authErrorMessage(result.reason));
    } catch (createError) {
      setError(strings.auth.error.generic);
      console.error("Nexus: failed to create the local account:", createError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth__form" onSubmit={(event) => void submit(event)}>
      <h1 className="auth__title">{strings.auth.create.title}</h1>
      <p className="auth__note">{strings.auth.create.intro}</p>
      <TextField
        type="password"
        label={strings.auth.create.passcodeLabel}
        placeholder={strings.auth.create.passcodePlaceholder}
        value={passcode}
        autoFocus
        required
        onChange={(event) => setPasscode(event.target.value)}
      />
      <TextField
        type="password"
        label={strings.auth.create.confirmLabel}
        placeholder={strings.auth.create.confirmPlaceholder}
        value={confirm}
        required
        onChange={(event) => setConfirm(event.target.value)}
      />
      <p className="auth__note">{strings.auth.create.note}</p>
      {error != null && (
        <p className="auth__error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={submitting}>
        {strings.auth.create.submit}
      </Button>
    </form>
  );
}

interface UnlockFormProps {
  /** Lifted to `AuthGate` (not local state) so a detour through "Zaboravio sam kod" and back does not reset an in-progress throttle countdown to the gate's original mount-time value. */
  lockedForMs: number;
  onLockedForMsChange: Dispatch<SetStateAction<number>>;
  onForgot: () => void;
  onUnlocked: () => void;
}

/** Screen (c): a single passcode field. Throttled attempts disable the form and count the wait down locally, re-enabling it without another round-trip once it reaches zero. */
function UnlockForm({ lockedForMs, onLockedForMsChange, onForgot, onUnlocked }: UnlockFormProps) {
  const [passcode, setPasscode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stillLocked = lockedForMs > 0;

  // One interval per throttle window: created when a wait starts, ticking
  // down by a second at a time via a functional update (immune to this
  // closure going stale), and cleaned up either on unmount or the moment
  // `stillLocked` flips back to false (it never recreates itself mid-
  // countdown, since the dependency only changes at the two edges).
  useEffect(() => {
    if (!stillLocked) return;
    const interval = setInterval(() => {
      onLockedForMsChange((previous) => Math.max(previous - 1000, 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [stillLocked, onLockedForMsChange]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || stillLocked) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await window.nexus.unlockWithPasscode(passcode);
      if (result.ok) {
        onUnlocked();
        return;
      }
      setError(authErrorMessage(result.reason));
      if (result.reason === "throttled" && result.lockedForMs != null) {
        onLockedForMsChange(result.lockedForMs);
      }
    } catch (unlockError) {
      setError(strings.auth.error.generic);
      console.error("Nexus: failed to unlock:", unlockError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth__form" onSubmit={(event) => void submit(event)}>
      <h1 className="auth__title">{strings.auth.unlock.title}</h1>
      <p className="auth__note">{strings.auth.unlock.description}</p>
      <TextField
        type="password"
        label={strings.auth.unlock.passcodeLabel}
        placeholder={strings.auth.unlock.passcodePlaceholder}
        value={passcode}
        autoFocus
        required
        disabled={stillLocked}
        onChange={(event) => setPasscode(event.target.value)}
      />
      {stillLocked && (
        <p className="auth__note">
          {strings.auth.unlock.retryPrefix} {formatCountdown(lockedForMs)}
        </p>
      )}
      {error != null && (
        <p className="auth__error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={submitting || stillLocked}>
        {strings.auth.unlock.submit}
      </Button>
      <Button variant="ghost" size="sm" type="button" onClick={onForgot}>
        {strings.auth.unlock.forgot}
      </Button>
    </form>
  );
}

interface RecoveryFormProps {
  /** True when reached because `status.requiresRecovery` forced it — the passcode form was never an option, so there is no back link and the copy explains why (ADR-018's device-migration case). */
  forced: boolean;
  onBack: () => void;
  onUnlocked: () => void;
}

/** Screen (d): recovery-code + new passcode + confirm. */
function RecoveryForm({ forced, onBack, onUnlocked }: RecoveryFormProps) {
  const [code, setCode] = useState("");
  const [passcode, setPasscode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (!passcodeMeetsPolicy(passcode)) {
      setError(strings.auth.validation.tooWeak);
      return;
    }
    if (passcode !== confirm) {
      setError(strings.auth.validation.mismatch);
      return;
    }
    setSubmitting(true);
    try {
      const result = await window.nexus.unlockWithRecovery(code, passcode);
      if (result.ok) {
        onUnlocked();
        return;
      }
      setError(authErrorMessage(result.reason));
    } catch (recoverError) {
      setError(strings.auth.error.generic);
      console.error("Nexus: failed to recover access:", recoverError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth__form" onSubmit={(event) => void submit(event)}>
      <h1 className="auth__title">{strings.auth.recovery.title}</h1>
      <p className="auth__note">
        {forced ? strings.auth.recovery.descriptionOtherDevice : strings.auth.recovery.descriptionForgot}
      </p>
      <TextField
        label={strings.auth.recovery.codeLabel}
        placeholder={strings.auth.recovery.codePlaceholder}
        value={code}
        autoFocus
        required
        onChange={(event) => setCode(event.target.value)}
      />
      <TextField
        type="password"
        label={strings.auth.recovery.newPasscodeLabel}
        placeholder={strings.auth.recovery.newPasscodePlaceholder}
        value={passcode}
        required
        onChange={(event) => setPasscode(event.target.value)}
      />
      <TextField
        type="password"
        label={strings.auth.recovery.confirmLabel}
        placeholder={strings.auth.recovery.confirmPlaceholder}
        value={confirm}
        required
        onChange={(event) => setConfirm(event.target.value)}
      />
      {error != null && (
        <p className="auth__error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={submitting}>
        {strings.auth.recovery.submit}
      </Button>
      {!forced && (
        <Button variant="ghost" size="sm" type="button" onClick={onBack}>
          {strings.auth.recovery.back}
        </Button>
      )}
    </form>
  );
}

export function AuthGate({ status, onUnlocked }: AuthGateProps) {
  const [screen, setScreen] = useState<Screen>(() => initialScreen(status));
  // Fixed at mount: whether screen (d) was forced by `requiresRecovery` (no
  // back link) or reached manually from (c) via "Zaboravio sam kod" (back
  // link present). `status` itself never changes under a mounted AuthGate —
  // App only re-renders it after a full unlock/lock cycle, which unmounts it.
  const [recoveryForced] = useState(status.requiresRecovery);
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState<string | null>(null);
  // See `UnlockFormProps.lockedForMs`'s doc comment for why this lives here
  // rather than inside `UnlockForm` itself.
  const [lockedForMs, setLockedForMs] = useState(status.lockedForMs);

  return (
    <div className="auth">
      <Card className="auth__card">
        <div className="auth__shell">
          <span className="auth__brand" aria-hidden="true">
            ✦
          </span>
          {screen === "create" && (
            <CreateForm
              status={status}
              onCreated={(code) => {
                setPendingRecoveryCode(code);
                setScreen("recoveryKit");
              }}
            />
          )}
          {screen === "recoveryKit" && pendingRecoveryCode != null && (
            <RecoveryKitPanel code={pendingRecoveryCode} onContinue={onUnlocked} />
          )}
          {screen === "unlock" && (
            <UnlockForm
              lockedForMs={lockedForMs}
              onLockedForMsChange={setLockedForMs}
              onForgot={() => setScreen("recovery")}
              onUnlocked={onUnlocked}
            />
          )}
          {screen === "recovery" && (
            <RecoveryForm forced={recoveryForced} onBack={() => setScreen("unlock")} onUnlocked={onUnlocked} />
          )}
        </div>
      </Card>
    </div>
  );
}
