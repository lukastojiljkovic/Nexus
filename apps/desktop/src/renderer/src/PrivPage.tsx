import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import * as Y from "yjs";
import { Button, Card, Checkbox, EmptyState, PageHeader, TextField } from "@nexus/ui";
import type { PrivNoteListEntry, PrivStatus } from "../../shared/ipc.js";
import { formatCountdown, passcodeMeetsPolicy, RecoveryKitPanel } from "./AuthGate.js";
import { PrivNoteEditor } from "./PrivNoteEditor.js";
import { TypedConfirmDialog } from "./TypedConfirmDialog.js";
import { strings } from "./strings.js";
import { moduleName } from "./moduleName.js";

/**
 * The „Privatno" section page (PRIV v1 / ADR-057 §5): one component, three
 * faces decided by `priv:status` — the honest SETUP screen (first open), the
 * LOCK screen (set up, locked), and the section itself (list + private
 * editor). The DEK never reaches this renderer; every face only ever holds
 * what main answered.
 *
 * The section can lock UNDERNEATH this page — main's idle timer, minimize,
 * an app lock, the panic shortcut — so the page re-reads status on window
 * focus, on the `nexus-priv-locked` event `App` fires after the shortcut,
 * and after any failed data call (`onMaybeLocked`). A stale unlocked face
 * never shows content: main refuses every data call while locked, so the
 * worst a race can produce is an error line and an immediate flip to the
 * lock screen.
 */

/** The custom event `App` dispatches after running the `privLock` shortcut, so a mounted section flips to the lock screen without polling. */
export const PRIV_LOCKED_EVENT = "nexus-priv-locked";

/** How long the clipboard guard waits before its best-effort clear (PRIV-012) — stated in the notice copy. */
const CLIPBOARD_CLEAR_MS = 30_000;

/** Note-list date, `NotesPage`'s own compact recipe. */
function formatNoteDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat("sr-Latn", { day: "2-digit", month: "short" }).format(date);
}

/** A list entry's display title — the untitled fallback is also what a typed confirm matches against. */
function displayTitle(entry: PrivNoteListEntry): string {
  const title = entry.title?.trim() ?? "";
  return title.length > 0 ? title : strings.notes.untitled;
}

export interface PrivPageProps {
  profileId: string;
}

export function PrivPage({ profileId }: PrivPageProps) {
  const [status, setStatus] = useState<PrivStatus | null>(null);
  const [failed, setFailed] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await window.nexus.privStatus(profileId));
      setFailed(false);
    } catch (error) {
      setFailed(true);
      console.error("Nexus: failed to read the private section's status:", error);
    }
  }, [profileId]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // The three out-of-band lock paths (see the module header). Focus is the
  // broad net: main may have auto-locked while the user was away, and the
  // first interaction back must meet the lock screen, not a dead section.
  useEffect(() => {
    const recheck = () => void loadStatus();
    window.addEventListener("focus", recheck);
    window.addEventListener(PRIV_LOCKED_EVENT, recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      window.removeEventListener(PRIV_LOCKED_EVENT, recheck);
    };
  }, [loadStatus]);

  if (failed) {
    return (
      <div className="priv priv--center">
        <EmptyState title={strings.modules.priv ?? "Privatno"} description={strings.priv.section.loadError} />
      </div>
    );
  }
  if (status === null) {
    return (
      <div className="priv priv--center">
        <p className="app__muted">{strings.app.loading}</p>
      </div>
    );
  }
  if (!status.setUp) {
    return <PrivSetup profileId={profileId} onStatusChange={setStatus} />;
  }
  if (!status.unlocked) {
    return <PrivLockScreen profileId={profileId} status={status} onStatusChange={setStatus} />;
  }
  return <PrivSection profileId={profileId} onStatusChange={setStatus} onRecheck={loadStatus} />;
}

// --- Setup (first open) ------------------------------------------------------

interface PrivSetupProps {
  profileId: string;
  onStatusChange: (next: PrivStatus) => void;
}

/**
 * First-time setup: the honest two-sentence explanation, the credential
 * choice, and the Recovery Kit step — either the account regenerate flow
 * (ONE new code that opens both, shown exactly once through the same
 * `RecoveryKitPanel` the account flows use) or the informed opt-out with the
 * dead-end named and confirmed. `AuthGate`'s visual shell, so the screen
 * that guards the most sensitive data looks like the one that guards the
 * account.
 */
function PrivSetup({ profileId, onStatusChange }: PrivSetupProps) {
  const s = strings.priv.setup;
  const [useAccountPasscode, setUseAccountPasscode] = useState(false);
  const [credential, setCredential] = useState("");
  const [confirm, setConfirm] = useState("");
  const [regenerateKit, setRegenerateKit] = useState(true);
  const [optOutConfirmed, setOptOutConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedForMs, setLockedForMs] = useState(0);
  // The one-time code + the status that becomes current once it is confirmed
  // as written down — held until `RecoveryKitPanel`'s continue.
  const [pendingKit, setPendingKit] = useState<{ code: string; status: PrivStatus } | null>(null);

  useCountdown(lockedForMs, setLockedForMs);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || lockedForMs > 0) return;
    setError(null);
    if (!useAccountPasscode) {
      if (!passcodeMeetsPolicy(credential)) {
        setError(s.weak);
        return;
      }
      if (credential !== confirm) {
        setError(s.mismatch);
        return;
      }
    }
    if (!regenerateKit && !optOutConfirmed) {
      setError(s.kitOptOutNote);
      return;
    }
    setSubmitting(true);
    try {
      const result = await window.nexus.privSetup(
        profileId,
        credential,
        useAccountPasscode,
        regenerateKit,
      );
      if (result.ok) {
        if (result.recoveryCode !== null) {
          setPendingKit({ code: result.recoveryCode, status: result.status });
        } else {
          onStatusChange(result.status);
        }
        return;
      }
      switch (result.reason) {
        case "alreadySetUp":
          setError(s.alreadySetUp);
          onStatusChange(await window.nexus.privStatus(profileId));
          return;
        case "weakCredential":
          setError(s.weak);
          return;
        case "wrongPasscode":
          setError(strings.auth.error.wrongPasscode);
          return;
        case "throttled":
          setError(strings.auth.error.throttled);
          setLockedForMs(result.lockedForMs);
          return;
      }
    } catch (submitError) {
      setError(strings.auth.error.generic);
      console.error("Nexus: private setup failed:", submitError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="priv priv--center">
      <div className="auth priv__gate">
        <Card className="auth__card">
          <div className="auth__shell">
            <span className="auth__brand" aria-hidden="true">
              ✦
            </span>
            {pendingKit !== null ? (
              <RecoveryKitPanel
                code={pendingKit.code}
                onContinue={() => onStatusChange(pendingKit.status)}
              />
            ) : (
              <form className="auth__form" onSubmit={(event) => void submit(event)}>
                <h1 className="auth__title">{s.title}</h1>
                <p className="auth__note">{s.intro}</p>
                <p className="auth__note">{s.introSecond}</p>

                <fieldset className="priv__choice" role="radiogroup" aria-label={s.credentialLabel}>
                  <legend className="auth__note">{s.credentialLabel}</legend>
                  <label className="priv__choice-row">
                    <input
                      type="radio"
                      name="priv-credential"
                      checked={!useAccountPasscode}
                      onChange={() => setUseAccountPasscode(false)}
                    />
                    <span>
                      {s.useSeparate}
                      <span className="auth__note">{s.useSeparateNote}</span>
                    </span>
                  </label>
                  <label className="priv__choice-row">
                    <input
                      type="radio"
                      name="priv-credential"
                      checked={useAccountPasscode}
                      onChange={() => setUseAccountPasscode(true)}
                    />
                    <span>
                      {s.useAccountPasscode}
                      <span className="auth__note">{s.useAccountPasscodeNote}</span>
                    </span>
                  </label>
                </fieldset>

                {useAccountPasscode ? (
                  <TextField
                    type="password"
                    label={s.accountPasscodeLabel}
                    placeholder={s.accountPasscodePlaceholder}
                    value={credential}
                    required
                    onChange={(event) => setCredential(event.target.value)}
                  />
                ) : (
                  <>
                    <TextField
                      type="password"
                      label={s.passphraseLabel}
                      placeholder={s.passphrasePlaceholder}
                      value={credential}
                      required
                      onChange={(event) => setCredential(event.target.value)}
                    />
                    <TextField
                      type="password"
                      label={s.confirmLabel}
                      placeholder={s.confirmPlaceholder}
                      value={confirm}
                      required
                      onChange={(event) => setConfirm(event.target.value)}
                    />
                  </>
                )}

                <fieldset className="priv__choice" role="radiogroup" aria-label={s.kitLabel}>
                  <legend className="auth__note">{s.kitLabel}</legend>
                  <label className="priv__choice-row">
                    <input
                      type="radio"
                      name="priv-kit"
                      checked={regenerateKit}
                      onChange={() => setRegenerateKit(true)}
                    />
                    <span>
                      {s.kitRegenerate}
                      <span className="auth__note">{s.kitRegenerateNote}</span>
                    </span>
                  </label>
                  <label className="priv__choice-row">
                    <input
                      type="radio"
                      name="priv-kit"
                      checked={!regenerateKit}
                      onChange={() => setRegenerateKit(false)}
                    />
                    <span>
                      {s.kitOptOut}
                      <span className="auth__note">{s.kitOptOutNote}</span>
                    </span>
                  </label>
                </fieldset>
                {!regenerateKit && (
                  <Checkbox
                    checked={optOutConfirmed}
                    onChange={(event) => setOptOutConfirmed(event.target.checked)}
                  >
                    {s.kitOptOutConfirm}
                  </Checkbox>
                )}

                {lockedForMs > 0 && (
                  <p className="auth__note">
                    {strings.auth.unlock.retryPrefix} {formatCountdown(lockedForMs)}
                  </p>
                )}
                {error != null && (
                  <p className="auth__error" role="alert">
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  disabled={submitting || lockedForMs > 0 || (!regenerateKit && !optOutConfirmed)}
                >
                  {s.submit}
                </Button>
              </form>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// --- Lock screen -------------------------------------------------------------

interface PrivLockScreenProps {
  profileId: string;
  status: PrivStatus;
  onStatusChange: (next: PrivStatus) => void;
}

/** Set up but locked: one credential field, the lock screen's own countdown idiom while throttled. */
function PrivLockScreen({ profileId, status, onStatusChange }: PrivLockScreenProps) {
  const s = strings.priv.lock;
  const [credential, setCredential] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedForMs, setLockedForMs] = useState(0);
  const account = status.usesAccountPasscode;

  useCountdown(lockedForMs, setLockedForMs);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || lockedForMs > 0) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await window.nexus.privUnlock(profileId, credential);
      if (result.ok) {
        onStatusChange(result.status);
        return;
      }
      switch (result.reason) {
        case "notSetUp":
          onStatusChange(await window.nexus.privStatus(profileId));
          return;
        case "wrongCredential":
          setError(account ? s.wrongPasscode : s.wrongCredential);
          return;
        case "throttled":
          setError(strings.auth.error.throttled);
          setLockedForMs(result.lockedForMs);
          return;
      }
    } catch (unlockError) {
      setError(s.error);
      console.error("Nexus: failed to unlock the private section:", unlockError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="priv priv--center">
      <div className="auth priv__gate">
        <Card className="auth__card">
          <div className="auth__shell">
            <span className="auth__brand" aria-hidden="true">
              ✦
            </span>
            <form className="auth__form" onSubmit={(event) => void submit(event)}>
              <h1 className="auth__title">{s.title}</h1>
              <p className="auth__note">{account ? s.descriptionAccount : s.description}</p>
              <TextField
                type="password"
                label={account ? s.fieldLabelAccount : s.fieldLabel}
                placeholder={account ? s.placeholderAccount : s.placeholder}
                value={credential}
                autoFocus
                required
                disabled={lockedForMs > 0}
                onChange={(event) => setCredential(event.target.value)}
              />
              {lockedForMs > 0 && (
                <p className="auth__note">
                  {strings.auth.unlock.retryPrefix} {formatCountdown(lockedForMs)}
                </p>
              )}
              {error != null && (
                <p className="auth__error" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" variant="primary" disabled={submitting || lockedForMs > 0}>
                {s.submit}
              </Button>
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
}

/** The throttle countdown, ticking a `lockedForMs` state down by the second — `UnlockForm`'s own arrangement, shared by both PRIV credential forms. */
function useCountdown(lockedForMs: number, onChange: Dispatch<SetStateAction<number>>): void {
  const active = lockedForMs > 0;
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      onChange((previous) => Math.max(previous - 1000, 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [active, onChange]);
}

// --- The unlocked section ----------------------------------------------------

interface PrivSectionProps {
  profileId: string;
  onStatusChange: (next: PrivStatus) => void;
  /** Re-reads status from main — called after any data-call failure, since the likeliest cause is a lock underneath this page. */
  onRecheck: () => void;
}

function PrivSection({ profileId, onStatusChange, onRecheck }: PrivSectionProps) {
  const s = strings.priv.section;
  const [entries, setEntries] = useState<PrivNoteListEntry[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listError, setListError] = useState(false);
  const [query, setQuery] = useState("");
  // Ranked ids for the ACTIVE query, or null while nothing is typed.
  const [searchIds, setSearchIds] = useState<string[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PrivNoteListEntry | null>(null);
  const [pendingMoveOut, setPendingMoveOut] = useState<PrivNoteListEntry | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  // The clipboard guard's armed timer + its visible notice (PRIV-012).
  const [clipboardArmed, setClipboardArmed] = useState(false);
  const clipboardTimerRef = useRef<number | null>(null);

  const loadEntries = useCallback(async () => {
    try {
      setEntries(await window.nexus.privList(profileId));
      setListError(false);
    } catch (error) {
      setListError(true);
      console.error("Nexus: failed to list private notes:", error);
      onRecheck();
    }
  }, [profileId, onRecheck]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  // The quiet in-section search (title-tier results): ranked ids from main's
  // in-memory index over decrypted envelopes, re-run as the query settles.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setSearchIds(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const ids = await window.nexus.privSearch(profileId, trimmed);
          if (!cancelled) setSearchIds(ids);
        } catch (error) {
          console.error("Nexus: private search failed:", error);
          if (!cancelled) onRecheck();
        }
      })();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, profileId, onRecheck]);

  const lock = useCallback(async () => {
    try {
      await window.nexus.privLock();
      onStatusChange(await window.nexus.privStatus(profileId));
    } catch (error) {
      console.error("Nexus: failed to lock the private section:", error);
      onRecheck();
    }
  }, [onStatusChange, profileId, onRecheck]);

  async function create(): Promise<void> {
    try {
      // A fresh note is an EMPTY document sealed like any other — the doc is
      // created here only to encode a genuine (if tiny) Yjs state.
      const doc = new Y.Doc();
      const state = Y.encodeStateAsUpdate(doc);
      doc.destroy();
      let base64 = "";
      for (const byte of state) base64 += String.fromCharCode(byte);
      const { id } = await window.nexus.privWrite(profileId, null, {
        title: "",
        yjsState: btoa(base64),
        plaintext: "",
        attachments: [],
      });
      await loadEntries();
      setSelectedId(id);
    } catch (error) {
      setListError(true);
      console.error("Nexus: failed to create a private note:", error);
      onRecheck();
    }
  }

  async function confirmDelete(entry: PrivNoteListEntry): Promise<void> {
    setDialogBusy(true);
    setDialogError(null);
    try {
      await window.nexus.privDelete(profileId, entry.id);
      if (selectedId === entry.id) setSelectedId(null);
      setPendingDelete(null);
      await loadEntries();
    } catch (error) {
      setDialogError(strings.priv.deleteDialog.error);
      console.error("Nexus: failed to delete a private note:", error);
      onRecheck();
    } finally {
      setDialogBusy(false);
    }
  }

  async function confirmMoveOut(entry: PrivNoteListEntry): Promise<void> {
    setDialogBusy(true);
    setDialogError(null);
    try {
      const result = await window.nexus.privMoveOut(profileId, entry.id);
      if (!result.ok) {
        setDialogError(strings.priv.moveOutDialog.tooLarge);
        return;
      }
      if (selectedId === entry.id) setSelectedId(null);
      setPendingMoveOut(null);
      await loadEntries();
    } catch (error) {
      setDialogError(strings.priv.moveOutDialog.error);
      console.error("Nexus: failed to move a private note out:", error);
      onRecheck();
    } finally {
      setDialogBusy(false);
    }
  }

  /**
   * The best-effort clipboard guard (PRIV-012): every copy inside the section
   * arms one 30-second clear, replacing any previous arm. The clear runs only
   * with the document focused — `writeText` would reject otherwise, and a
   * clipboard the user has since filled elsewhere is theirs, but a focused
   * clear of OUR 30-second-old copy is the promise the notice makes.
   */
  const onSectionCopy = useCallback(() => {
    if (clipboardTimerRef.current !== null) window.clearTimeout(clipboardTimerRef.current);
    setClipboardArmed(true);
    clipboardTimerRef.current = window.setTimeout(() => {
      clipboardTimerRef.current = null;
      setClipboardArmed(false);
      if (!document.hasFocus()) return;
      navigator.clipboard.writeText("").catch(() => {
        // Best-effort by design — the notice's own copy says so.
      });
    }, CLIPBOARD_CLEAR_MS);
  }, []);

  const cancelClipboardClear = useCallback(() => {
    if (clipboardTimerRef.current !== null) {
      window.clearTimeout(clipboardTimerRef.current);
      clipboardTimerRef.current = null;
    }
    setClipboardArmed(false);
  }, []);

  useEffect(
    () => () => {
      if (clipboardTimerRef.current !== null) window.clearTimeout(clipboardTimerRef.current);
    },
    [],
  );

  // The visible list: every entry, or — while a query is active — the ranked
  // matches in rank order (unreadable rows are unsearchable by construction).
  const visible =
    entries === null
      ? null
      : searchIds === null
        ? entries
        : searchIds
            .map((id) => entries.find((entry) => entry.id === id))
            .filter((entry): entry is PrivNoteListEntry => entry !== undefined);

  return (
    <div className="priv" onCopy={onSectionCopy}>
      <PageHeader
        title={moduleName("priv")}
        actions={
          <>
            <TextField
              className="priv__search"
              value={query}
              aria-label={s.searchLabel}
              placeholder={s.searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
            />
            {/* The persistent manual lock — the header's one promise (ADR-057 §5). */}
            <Button size="sm" onClick={() => void lock()}>
              {s.lockNow}
            </Button>
          </>
        }
      />

      {clipboardArmed && (
        <div className="priv__clipboard" role="status">
          <span>{strings.priv.clipboard.notice}</span>
          <Button size="sm" onClick={cancelClipboardClear}>
            {strings.priv.clipboard.cancel}
          </Button>
        </div>
      )}

      <div className="priv__body">
        <div className="note__list-pane">
          <Button variant="primary" className="note__new" onClick={() => void create()}>
            {s.newNote}
          </Button>
          {listError ? (
            <EmptyState title={s.emptyTitle} description={s.loadError} />
          ) : visible === null ? (
            <p className="app__muted">{strings.app.loading}</p>
          ) : visible.length === 0 ? (
            <EmptyState
              title={s.emptyTitle}
              description={searchIds === null ? s.emptyDescription : s.searchEmpty}
            />
          ) : (
            <ul className="note__list">
              {visible.map((entry) => (
                <li key={entry.id} className="note__item-row">
                  {entry.unreadable ? (
                    // A named dead row: the container no longer opens, and a
                    // click could only show an error — delete is its one action.
                    <span className="note__item priv__item--dead">
                      <span className="note__item-title">{s.unreadable}</span>
                      <span className="note__item-date">{formatNoteDate(entry.updatedAt)}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className={
                        entry.id === selectedId ? "note__item note__item--active" : "note__item"
                      }
                      aria-current={entry.id === selectedId ? "true" : undefined}
                      onClick={() => setSelectedId(entry.id)}
                    >
                      <span className="note__item-title">{displayTitle(entry)}</span>
                      <span className="note__item-date">{formatNoteDate(entry.updatedAt)}</span>
                    </button>
                  )}
                  <span className="priv__row-actions">
                    {!entry.unreadable && (
                      <button
                        type="button"
                        className="note__attach"
                        onClick={() => {
                          setDialogError(null);
                          setPendingMoveOut(entry);
                        }}
                      >
                        {s.moveOut}
                      </button>
                    )}
                    <button
                      type="button"
                      className="note__attach priv__delete"
                      onClick={() => {
                        setDialogError(null);
                        setPendingDelete(entry);
                      }}
                    >
                      {s.deleteLabel}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="note__editor-pane">
          {selectedId !== null ? (
            <PrivNoteEditor
              key={selectedId}
              profileId={profileId}
              noteId={selectedId}
              onSaved={() => void loadEntries()}
              onMaybeLocked={onRecheck}
            />
          ) : (
            <div className="note__editor-empty">
              <EmptyState title={s.noSelectionTitle} description={s.noSelectionDescription} />
            </div>
          )}
        </div>
      </div>

      {pendingDelete !== null && (
        <TypedConfirmDialog
          title={strings.priv.deleteDialog.title}
          name={displayTitle(pendingDelete)}
          warning={strings.priv.deleteDialog.warning}
          confirmLabel={strings.priv.deleteDialog.confirmLabel}
          confirmPlaceholder={strings.priv.deleteDialog.confirmPlaceholder}
          confirmValue={displayTitle(pendingDelete)}
          submitLabel={strings.priv.deleteDialog.submit}
          cancelLabel={strings.priv.deleteDialog.cancel}
          error={dialogError}
          busy={dialogBusy}
          danger
          onConfirm={() => void confirmDelete(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingMoveOut !== null && (
        <TypedConfirmDialog
          title={strings.priv.moveOutDialog.title}
          name={displayTitle(pendingMoveOut)}
          warning={strings.priv.moveOutDialog.warning}
          confirmLabel={strings.priv.moveOutDialog.confirmLabel}
          confirmPlaceholder={strings.priv.moveOutDialog.confirmPlaceholder}
          confirmValue={displayTitle(pendingMoveOut)}
          submitLabel={strings.priv.moveOutDialog.submit}
          cancelLabel={strings.priv.moveOutDialog.cancel}
          error={dialogError}
          busy={dialogBusy}
          onConfirm={() => void confirmMoveOut(pendingMoveOut)}
          onCancel={() => setPendingMoveOut(null)}
        />
      )}
    </div>
  );
}
