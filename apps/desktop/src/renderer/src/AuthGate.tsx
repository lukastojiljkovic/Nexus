import { useEffect, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Button, Card, Checkbox, ListRow, StarField, TextField } from "@nexus/ui";
import { MAX_ACCOUNT_LABEL_LENGTH, PASSCODE_MIN_LENGTH } from "../../shared/ipc.js";
import type { AccountSummary, AuthErrorReason, AuthStatus } from "../../shared/ipc.js";
import { strings } from "./strings.js";

/**
 * The local-account lock screen (ADR-018, extended by ADR-044). Five screens
 * share one shell, mirroring `Onboarding`'s `.onb`/`.onb__card` structure so
 * the first thing a user ever sees matches the second: (a) create an account,
 * (b) the one-time Recovery Kit, (c) unlock, (d) recovery, and (e) the account
 * picker that comes ahead of (c) whenever this device holds more than one.
 * `App` renders this instead of the app shell whenever
 * `status.state !== "unlocked"`.
 */
export interface AuthGateProps {
  status: AuthStatus;
  /** Re-reads status from main; the gate calls it after every successful action. */
  onUnlocked: () => void;
}

type Screen = "picker" | "create" | "recoveryKit" | "unlock" | "recovery";

/**
 * No accounts at all is the only "create" case — everything else opens on the
 * picker when there is a choice to make, and goes straight to the selected
 * account's own form when there is not.
 */
function initialScreen(status: AuthStatus): Screen {
  if (status.accounts.length === 0) return "create";
  if (status.accounts.length > 1) return "picker";
  return status.requiresRecovery ? "recovery" : "unlock";
}

/** The one line under an account's label in the picker: why it cannot simply be opened, in the order that decides what the user has to do about it. */
function accountStateLine(account: AccountSummary, keystoreAvailable: boolean): string {
  if (!keystoreAvailable) return strings.auth.picker.stateKeystoreUnavailable;
  if (account.requiresRecovery) return strings.auth.picker.stateRecovery;
  return strings.auth.picker.stateLocked;
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

/** `lockedForMs` as a live "m:ss" countdown — sidesteps Serbian's three-way plural for "second" entirely. Exported so the profile-switch gate (ADR-058) counts the SAME throttle down the same way. */
export function formatCountdown(ms: number): string {
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
  /** True when this device already holds accounts: the copy changes, a way back to the picker appears, and the call goes to `createAdditionalAccount` (which locks whatever is open first). */
  additional: boolean;
  onBack: () => void;
  onCreated: (recoveryCode: string) => void;
}

/**
 * Screen (a): name the account, set its passcode — or, when the OS keystore is
 * unavailable, an explanation with no form at all (ADR-018: never a silent
 * PIN-only downgrade).
 *
 * One form serves the first account and every later one (ADR-044): the fields
 * are identical, and only the copy, the way back and which channel it calls
 * differ. The name comes FIRST because it is the thing the user is deciding —
 * the passcode is how they protect the decision.
 */
function CreateForm({ status, additional, onBack, onCreated }: CreateFormProps) {
  const [label, setLabel] = useState("");
  const [passcode, setPasscode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status.keystoreAvailable) {
    return (
      <>
        <h1 className="auth__title">{strings.auth.keystoreUnavailable.title}</h1>
        <p className="auth__note">{strings.auth.keystoreUnavailable.description}</p>
        {additional && (
          <Button variant="ghost" size="sm" type="button" onClick={onBack}>
            {strings.auth.picker.back}
          </Button>
        )}
      </>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    if (label.trim().length === 0) {
      setError(strings.auth.validation.labelRequired);
      return;
    }
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
      const result = additional
        ? await window.nexus.createAdditionalAccount(label, passcode)
        : await window.nexus.createAccount(label, passcode);
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
      <h1 className="auth__title">
        {additional ? strings.auth.create.additionalTitle : strings.auth.create.title}
      </h1>
      <p className="auth__note">
        {additional ? strings.auth.create.additionalIntro : strings.auth.create.intro}
      </p>
      <TextField
        label={strings.auth.create.labelLabel}
        placeholder={strings.auth.create.labelPlaceholder}
        value={label}
        maxLength={MAX_ACCOUNT_LABEL_LENGTH}
        autoFocus
        required
        onChange={(event) => setLabel(event.target.value)}
      />
      <p className="auth__note">{strings.auth.create.labelNote}</p>
      <TextField
        type="password"
        label={strings.auth.create.passcodeLabel}
        placeholder={strings.auth.create.passcodePlaceholder}
        value={passcode}
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
      {additional && (
        <Button variant="ghost" size="sm" type="button" disabled={submitting} onClick={onBack}>
          {strings.auth.picker.back}
        </Button>
      )}
    </form>
  );
}

interface AccountPickerProps {
  status: AuthStatus;
  /** A rename or a delete answers with the whole status; the gate holds it so the list redraws without another round trip. */
  onStatusChange: (next: AuthStatus) => void;
  /** Main has switched: the gate decides whether that account wants the passcode form or the recovery one. */
  onSelected: (next: AuthStatus) => void;
  onAdd: () => void;
  /** The account just deleted was the last one: there is no picker left to redraw, so the gate has to move to the create screen itself (ADR-048). */
  onEmptied: () => void;
}

/**
 * Screen (e): the account picker (ADR-044 section 5). Every account this device
 * holds, each with the one line that says why it is not simply open, plus a
 * rename — labels live in the plaintext registry, so renaming one needs no
 * unlock at all, which is exactly what makes it possible from here.
 *
 * Built from the house list recipe (`ListRow`), with the account's own NAME as
 * the button that opens it: the row's action and its identity are the same
 * thing, so there is nothing to label „Otvori" separately, and the row needs no
 * click handler competing with the „Preimenuj" and „Obriši" beside it. Both of
 * those take over the whole card in the `.auth__form` shape every other screen
 * here uses, rather than cramming a field and two buttons into one row.
 *
 * Deletion (ADR-048) lives here and nowhere else: it is a thing you do to an
 * account you are NOT in, from the one screen that lists them all. Its gate is
 * typing the account's own label — no passcode, because an account that
 * `requiresRecovery` could never answer one on this device, and the accounts
 * users most want gone are exactly those.
 */
function AccountPicker({ status, onStatusChange, onSelected, onAdd, onEmptied }: AccountPickerProps) {
  const [renaming, setRenaming] = useState<AccountSummary | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [deleting, setDeleting] = useState<AccountSummary | null>(null);
  const [draftConfirm, setDraftConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function select(accountId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onSelected(await window.nexus.selectAccount(accountId));
    } catch (selectError) {
      setError(strings.auth.error.generic);
      console.error("Nexus: failed to select an account:", selectError);
    } finally {
      setBusy(false);
    }
  }

  async function submitRename(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || renaming === null) return;
    setError(null);
    if (draftLabel.trim().length === 0) {
      setError(strings.auth.validation.labelRequired);
      return;
    }
    setBusy(true);
    try {
      onStatusChange(await window.nexus.renameAccount(renaming.id, draftLabel));
      setRenaming(null);
    } catch (renameError) {
      setError(strings.auth.picker.renameError);
      console.error("Nexus: failed to rename an account:", renameError);
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || deleting === null || draftConfirm.trim() !== deleting.label) return;
    setError(null);
    setBusy(true);
    try {
      const next = await window.nexus.deleteAccount(deleting.id);
      onStatusChange(next);
      // The picker cannot show an empty list — and the gate picks its screen
      // once, at mount, so a fresh status alone would strand the user on one.
      if (next.accounts.length === 0) onEmptied();
      setDeleting(null);
    } catch (deleteError) {
      setError(strings.auth.picker.deleteError);
      console.error("Nexus: failed to delete an account:", deleteError);
    } finally {
      setBusy(false);
    }
  }

  if (deleting !== null) {
    return (
      <form
        className="auth__form"
        onSubmit={(event) => void submitDelete(event)}
        onKeyDown={(event) => {
          // Guarded on `busy` like every other cancel on this screen: Escape
          // must not walk away from a delete already in flight.
          if (event.key === "Escape" && !busy) setDeleting(null);
        }}
      >
        <h1 className="auth__title">{strings.auth.picker.deleteTitle}</h1>
        <p className="auth__note">
          <strong>{deleting.label}</strong> — {strings.auth.picker.deleteWarning}
        </p>
        <p className="auth__note">{strings.auth.picker.deleteExportNote}</p>
        <TextField
          label={strings.auth.picker.deleteConfirmLabel}
          placeholder={strings.auth.picker.deleteConfirmPlaceholder}
          value={draftConfirm}
          maxLength={MAX_ACCOUNT_LABEL_LENGTH}
          autoFocus
          required
          onChange={(event) => setDraftConfirm(event.target.value)}
        />
        {error != null && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}
        {/* The typed label is a UX gate only: main re-checks the account id
            against the registry, which is the check that actually matters. */}
        <Button type="submit" variant="danger" disabled={busy || draftConfirm.trim() !== deleting.label}>
          {strings.auth.picker.deleteSubmit}
        </Button>
        <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => setDeleting(null)}>
          {strings.auth.picker.deleteCancel}
        </Button>
      </form>
    );
  }

  // The rename overlay gets the same Escape its sibling forty lines up has had
  // all along. Two overlays that replace the same account picker, one of which
  // could be backed out of with a key and one of which could not.
  if (renaming !== null) {
    return (
      <form
        className="auth__form"
        onSubmit={(event) => void submitRename(event)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) setRenaming(null);
        }}
      >
        <h1 className="auth__title">{strings.auth.picker.rename}</h1>
        <p className="auth__note">{strings.auth.create.labelNote}</p>
        <TextField
          label={strings.auth.picker.renameFieldLabel}
          value={draftLabel}
          maxLength={MAX_ACCOUNT_LABEL_LENGTH}
          autoFocus
          required
          onChange={(event) => setDraftLabel(event.target.value)}
        />
        {error != null && (
          <p className="auth__error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {strings.auth.picker.renameSave}
        </Button>
        <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => setRenaming(null)}>
          {strings.auth.picker.renameCancel}
        </Button>
      </form>
    );
  }

  return (
    <div className="auth__form">
      <h1 className="auth__title">{strings.auth.picker.title}</h1>
      <p className="auth__note">{strings.auth.picker.description}</p>
      <div>
        {status.accounts.map((account) => (
          <ListRow
            key={account.id}
            trailing={
              <span className="auth__row-actions">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setRenaming(account);
                    setDraftLabel(account.label);
                    setError(null);
                  }}
                >
                  {strings.auth.picker.rename}
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setDeleting(account);
                    setDraftConfirm("");
                    setError(null);
                  }}
                >
                  {strings.auth.picker.delete}
                </Button>
              </span>
            }
          >
            {/* The name IS the button, with its state carried inside it: one
                control per account, so the label and the line about it can
                never drift apart on their own baselines. `.nx-button`'s own
                gap does the spacing. */}
            <Button disabled={busy} onClick={() => void select(account.id)}>
              {account.label}
              <span className="auth__note">
                {accountStateLine(account, status.keystoreAvailable)}
              </span>
            </Button>
          </ListRow>
        ))}
      </div>
      {error != null && (
        <p className="auth__error" role="alert">
          {error}
        </p>
      )}
      <Button type="button" disabled={busy} onClick={onAdd}>
        {strings.auth.picker.add}
      </Button>
    </div>
  );
}

interface UnlockFormProps {
  /** Lifted to `AuthGate` (not local state) so a detour through "Zaboravio sam kod" and back does not reset an in-progress throttle countdown to the gate's original mount-time value. */
  lockedForMs: number;
  onLockedForMsChange: Dispatch<SetStateAction<number>>;
  /** The label of the account this form unlocks — shown only when there is more than one, where "which one is this" is a real question. */
  accountLabel: string | null;
  /** Back to the picker; null when this device holds a single account and there is nothing to choose between. */
  onOtherAccount: (() => void) | null;
  onForgot: () => void;
  onUnlocked: () => void;
}

/** Screen (c): a single passcode field. Throttled attempts disable the form and count the wait down locally, re-enabling it without another round-trip once it reaches zero. */
function UnlockForm({
  lockedForMs,
  onLockedForMsChange,
  accountLabel,
  onOtherAccount,
  onForgot,
  onUnlocked,
}: UnlockFormProps) {
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
      <h1 className="auth__title">{accountLabel ?? strings.auth.unlock.title}</h1>
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
      {onOtherAccount != null && (
        <Button variant="ghost" size="sm" type="button" onClick={onOtherAccount}>
          {strings.auth.unlock.otherAccount}
        </Button>
      )}
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

export function AuthGate({ status: initialStatus, onUnlocked }: AuthGateProps) {
  // Owned here rather than read from the prop on every render (ADR-044):
  // selecting an account and renaming one both answer with a whole fresh
  // status, and the gate has to redraw from it without a lock/unlock cycle
  // (the only thing that used to change `status` under a mounted gate).
  const [status, setStatus] = useState(initialStatus);
  const [screen, setScreen] = useState<Screen>(() => initialScreen(initialStatus));
  // Whether screen (d) was forced by `requiresRecovery` (no back link) or
  // reached manually from (c) via "Zaboravio sam kod" (back link present).
  // Re-decided on every account switch, since it is a fact about the account
  // now selected and not about this mount.
  const [recoveryForced, setRecoveryForced] = useState(initialStatus.requiresRecovery);
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState<string | null>(null);
  // See `UnlockFormProps.lockedForMs`'s doc comment for why this lives here
  // rather than inside `UnlockForm` itself.
  const [lockedForMs, setLockedForMs] = useState(initialStatus.lockedForMs);

  const multipleAccounts = status.accounts.length > 1;
  const selectedLabel =
    status.accounts.find((account) => account.id === status.selectedAccountId)?.label ?? null;

  /** Main has switched accounts: adopt its answer wholesale, including the throttle window and whether the passcode is usable on this device at all. */
  function adoptSelection(next: AuthStatus): void {
    setStatus(next);
    setLockedForMs(next.lockedForMs);
    setRecoveryForced(next.requiresRecovery);
    setScreen(next.requiresRecovery ? "recovery" : "unlock");
  }

  return (
    // `--sky` is what says „this is the full-window screen". The bare `.auth`
    // shell is reused nested inside the private section's gate, on a page that
    // scrolls, where a sky would travel with the content.
    <div className="auth auth--sky">
      {/* The first screen anyone ever sees, and until now the only large
          surface in the product that showed none of it. The sky is allowed
          here by `StarField`'s own rule — it may sit on surfaces that do not
          scroll, and this one is a fixed, centred grid. `enabled` is left at
          its default because the lock screen has no theme state of its own;
          Dan resolves the material to `none` and paints paper instead. */}
      <StarField />
      <Card className="auth__card">
        <div className="auth__shell">
          <span className="auth__brand" aria-hidden="true">
            ✦
          </span>
          {screen === "picker" && (
            <AccountPicker
              status={status}
              onStatusChange={setStatus}
              onSelected={adoptSelection}
              onAdd={() => setScreen("create")}
              onEmptied={() => setScreen("create")}
            />
          )}
          {screen === "create" && (
            <CreateForm
              status={status}
              additional={status.accounts.length > 0}
              onBack={() => setScreen("picker")}
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
              accountLabel={multipleAccounts ? selectedLabel : null}
              onOtherAccount={multipleAccounts ? () => setScreen("picker") : null}
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
