import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, Card, Checkbox, Chip, TextField } from "@nexus/ui";
import { validateArchivePassphrase, type ModuleRegistry } from "@nexus/core";
import { ACCENT_IDS, type AccentId } from "@nexus/tokens";
import type {
  AppInfo,
  FlagState,
  NotificationSource,
  RestoreModuleCounts,
  RestorePreview,
  RestoreProblem,
} from "../../shared/ipc.js";
import { authErrorMessage, passcodeMeetsPolicy, RecoveryKitPanel } from "./AuthGate.js";
import { ALL_NOTIFICATION_SOURCES } from "./notificationFormat.js";
import { NotificationSettingsControls } from "./NotificationSettingsControls.js";
import type { ThemePreference } from "./theme.js";
import { AUTO_LOCK_MINUTES, type AutoLockMinutes } from "./autoLock.js";
import { persistAccent, readStoredAccent } from "./accent.js";
import { dayUnit, strings } from "./strings.js";

/** Sidebar/page display name for a module id; mirrors App.tsx's private helper (kept local — App renders this page, so importing it back would be circular). */
function moduleName(id: string): string {
  return strings.modules[id] ?? id;
}

const THEME_OPTIONS: ThemePreference[] = ["system", "dan", "noc"];

function themeOptionLabel(option: ThemePreference): string {
  if (option === "system") return strings.settings.appearance.system;
  return option === "dan" ? strings.app.themeDan : strings.app.themeNoc;
}

/** The home surface and this page itself can never be disabled — someone has to render the toggles. */
const LOCKED_MODULES = new Set(["dashboard", "settings"]);

interface NotificationPreset {
  key: "minimal" | "normal" | "all";
  sources: NotificationSource[];
}

/**
 * NTF-008: minimalno/normalno/sve map onto growing subsets of the five sources.
 * An event reminder is in every preset, minimalno included — it is the least
 * noisy kind there is, since the user attached it to that one event by hand. A
 * task reminder (ADR-028) joins every tier for exactly the same reason: it
 * exists only because the user set a ladder on that one task by hand.
 */
const NOTIFICATION_PRESETS: NotificationPreset[] = [
  { key: "minimal", sources: ["document", "event", "task"] },
  { key: "normal", sources: ["document", "exam", "event", "task"] },
  { key: "all", sources: ["document", "exam", "study-day", "event", "task"] },
];

function sameSourceSet(a: readonly NotificationSource[], b: readonly NotificationSource[]): boolean {
  return a.length === b.length && a.every((source) => b.includes(source));
}

const NAME_MAX = 80;

interface ProfileSectionProps {
  profileId: string;
  initialName: string;
  onProfileRenamed: (name: string) => void;
}

/** Profil section: renames the active profile (same 1–80-char rule as Onboarding). */
function ProfileSection({ profileId, initialName, onProfileRenamed }: ProfileSectionProps) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= NAME_MAX;

  async function save(): Promise<void> {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await window.nexus.renameProfile(profileId, trimmed);
      setName(trimmed);
      onProfileRenamed(trimmed);
    } catch (renameError) {
      setError(strings.settings.profile.saveError);
      console.error("Nexus: failed to rename profile:", renameError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="set__row">
        <TextField
          label={strings.settings.profile.nameLabel}
          value={name}
          maxLength={NAME_MAX}
          onChange={(event) => setName(event.target.value)}
        />
        <Button size="sm" variant="primary" disabled={!valid || saving} onClick={() => void save()}>
          {strings.settings.profile.save}
        </Button>
      </div>
      {error != null && <p className="set__error">{error}</p>}
    </>
  );
}

interface BackupSectionProps {
  profileId: string;
}

/**
 * Rezervna kopija section (IMEX slice a1, extended by ADR-022): a full-export
 * button over `window.nexus.exportData`, gated by an encrypt-by-default
 * choice. Checked (default): a passphrase pair, validated the same way main
 * will re-validate it. Unchecked: the plaintext path stays reachable only
 * through its own separate, unchecked-by-default confirmation — the export
 * button is disabled until that box is ticked, so shipping data in the clear
 * is always something the user opts into, never something they click past.
 */
function BackupSection({ profileId }: BackupSectionProps) {
  const s = strings.settings.backup;

  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState<{
    path: string;
    totalRecords: number;
    missingAttachments: number;
    encrypted: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [encrypt, setEncrypt] = useState(true);
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [plaintextConfirmed, setPlaintextConfirmed] = useState(false);

  async function runExport(): Promise<void> {
    if (running) return;
    setError(null);
    setSaved(null);

    if (encrypt) {
      const problem = validateArchivePassphrase(passphrase);
      if (problem === "tooShort") {
        setError(s.passphraseTooShort);
        return;
      }
      if (problem === "tooLong") {
        setError(s.passphraseTooLong);
        return;
      }
      if (passphrase !== confirmPassphrase) {
        setError(s.passphraseMismatch);
        return;
      }
    }

    setRunning(true);
    try {
      const outcome = await window.nexus.exportData(profileId, encrypt ? passphrase : null);
      if (!outcome.canceled) {
        setSaved({
          path: outcome.path,
          totalRecords: outcome.totalRecords,
          missingAttachments: outcome.missingAttachments,
          encrypted: outcome.encrypted,
        });
      }
    } catch (exportError) {
      setError(s.error);
      console.error("Nexus: failed to export data:", exportError);
    } finally {
      setRunning(false);
      // A used passphrase has no business surviving in component state,
      // whether the export succeeded, was canceled, or failed.
      setPassphrase("");
      setConfirmPassphrase("");
      // The plaintext confirmation is consumed along with it. Left standing,
      // it would arm the NEXT export too: one click, another copy of every
      // note in the clear, with the deliberate act it was meant to require
      // already spent on a different file.
      setPlaintextConfirmed(false);
    }
  }

  const disabled = running || (!encrypt && !plaintextConfirmed);

  return (
    <>
      <p className="app__muted">{s.description}</p>
      <Checkbox
        checked={encrypt}
        onChange={(event) => {
          setEncrypt(event.target.checked);
          // Turning encryption back on drops any plaintext confirmation with
          // it: otherwise it survives as hidden state and silently re-arms the
          // button the moment the box is unticked again.
          if (event.target.checked) setPlaintextConfirmed(false);
        }}
      >
        {s.encryptLabel}
      </Checkbox>
      {encrypt ? (
        <>
          <div className="set__security-form">
            <TextField
              type="password"
              label={s.passphraseLabel}
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
            <TextField
              type="password"
              label={s.passphraseConfirmLabel}
              value={confirmPassphrase}
              onChange={(event) => setConfirmPassphrase(event.target.value)}
            />
          </div>
          <p className="set__section-caption">{s.passphraseHint}</p>
          <p className="app__muted">{s.encryptedNotice}</p>
        </>
      ) : (
        <>
          <p className="app__muted">{s.plaintextNotice}</p>
          <Checkbox
            checked={plaintextConfirmed}
            onChange={(event) => setPlaintextConfirmed(event.target.checked)}
          >
            {s.plaintextConfirmLabel}
          </Checkbox>
        </>
      )}
      <Button size="sm" variant="primary" disabled={disabled} onClick={() => void runExport()}>
        {s.exportButton}
      </Button>
      {saved != null && (
        <p className="set__section-caption">
          {s.savedPrefix} <span className="app__path">{saved.path}</span> (
          {saved.totalRecords} {dayUnit(saved.totalRecords, s.recordsUnitOne, s.recordsUnitMany)}
          {saved.encrypted ? <> · {s.savedEncryptedSuffix}</> : null})
        </p>
      )}
      {saved != null && saved.missingAttachments > 0 && (
        <p className="set__error">
          {s.missingAttachmentsPrefix} {saved.missingAttachments}{" "}
          {dayUnit(saved.missingAttachments, s.missingAttachmentsUnitOne, s.missingAttachmentsUnitMany)}{" "}
          {s.missingAttachmentsSuffix}
        </p>
      )}
      {error != null && <p className="set__error">{error}</p>}
    </>
  );
}

/** The picked archive as this section remembers it. Never a path: main holds the pick, and the renderer refers to it without naming it (SEC-EL). */
interface PickedArchive {
  fileName: string;
  /** Straight from the pick — an `NXA1` container needs a passphrase, a plain `.nexus.zip` does not, so one is asked for only when it is actually needed. */
  encrypted: boolean;
}

/**
 * The restore flow's entire state, as one discriminated union rather than a
 * handful of independent booleans: "picked but not previewed", "previewed and
 * refused" and "previewed and ready" are then mutually exclusive by
 * construction, and one phase's buttons can never render over another's data.
 */
type RestoreState =
  | { phase: "idle"; error: string | null }
  | {
      phase: "picked";
      pick: PickedArchive;
      needsPassphrase: boolean;
      busy: boolean;
      error: string | null;
    }
  | { phase: "invalid"; pick: PickedArchive; problems: RestoreProblem[] }
  | { phase: "ready"; pick: PickedArchive; preview: RestorePreview; error: string | null }
  | { phase: "applying"; pick: PickedArchive; preview: RestorePreview }
  | { phase: "applied" };

/** The counts table's five rows, in the order they are shown. */
const RESTORE_MODULES: (keyof RestoreModuleCounts)[] = [
  "tasks",
  "calendar",
  "study",
  "notifications",
  "notes",
];

/**
 * An instant as a full sr-Latn day + time label ("8. jul 2026. 14:32").
 * Mirrors `focusFormat.ts`'s `formatFocusSessionWhen`, but carries the year:
 * a focus session is recent by nature, while a restore archive can have been
 * written at any time and its age is exactly what the user is judging.
 * Exported for App.tsx's undo banner, which formats the same kind of instant
 * (the `AuthGate` precedent: a helper lives with the screen that owns it and
 * is imported, never re-spelled). Raw input on an unparseable string.
 */
export function formatArchiveInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = new Intl.DateTimeFormat("sr-Latn", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("sr-Latn", { hour: "2-digit", minute: "2-digit" }).format(date);
  return `${day} ${time}`;
}

/** The machine-readable half of a problem — `data/tasks.ndjson:12 · <detail>` — or empty when it carries none. */
function problemFragment(problem: RestoreProblem): string {
  const parts: string[] = [];
  if (problem.path != null) {
    parts.push(problem.line != null ? `${problem.path}:${problem.line}` : problem.path);
  } else if (problem.line != null) {
    parts.push(String(problem.line));
  }
  if (problem.detail != null) parts.push(problem.detail);
  return parts.join(" · ");
}

/** One problem row: the code's Serbian sentence, plus its muted machine fragment when it has one. Shared by the refusal list and the preview's warnings, which differ only in tone. */
function RestoreProblemRow({ problem, tone }: { problem: RestoreProblem; tone: "error" | "muted" }) {
  const fragment = problemFragment(problem);
  return (
    <li className={tone === "error" ? "set__error" : "set__section-caption"}>
      {strings.settings.restore.problems[problem.code]}
      {fragment !== "" && <span className="set__restore-fragment"> {fragment}</span>}
    </li>
  );
}

interface RestoreSectionProps {
  profileId: string;
}

/**
 * Vraćanje iz arhive (IMEX slice 3d, ADR-023): pick an archive, dry-run it,
 * and — only from the preview the user actually saw — replace this profile's
 * entire contents with it.
 *
 * The preview IS the confirmation screen: a restore is destructive, so what
 * makes it safe is seeing the archive's own facts beside the target profile's
 * current counts, not another "are you sure" on top. A second dialog would add
 * a click and no information.
 *
 * After a successful apply main reloads this renderer (ADR-023) — which is why
 * nothing here navigates, clears, or otherwise depends on its own state
 * surviving. The undo banner the reloaded app shows is driven by
 * `restoreStatus` in App.tsx, never by this component.
 */
function RestoreSection({ profileId }: RestoreSectionProps) {
  const s = strings.settings.restore;

  const [state, setState] = useState<RestoreState>({ phase: "idle", error: null });
  // Deliberately outside the state machine: a wrong passphrase comes back as a
  // status, not a rejection, and puts the section back in "picked" — where the
  // user corrects the value already typed rather than retyping it.
  const [passphrase, setPassphrase] = useState("");
  // Read by the unmount cleanup only. An apply in flight must never be
  // cancelled from here: main is copying blobs out of the very archive
  // `cancelRestore` would close under it.
  const applying = useRef(false);

  // Backing out of a restore by leaving the page still has to release the
  // picked file — an opened archive keeps it locked on Windows. Once an apply
  // has completed, main has already dropped the pick, so this is a no-op.
  useEffect(() => {
    return () => {
      if (applying.current) return;
      void window.nexus.cancelRestore().catch((error: unknown) => {
        console.error("Nexus: failed to release the picked archive:", error);
      });
    };
  }, []);

  async function runPreview(pick: PickedArchive, phrase: string | null): Promise<void> {
    setState({ phase: "picked", pick, needsPassphrase: phrase !== null, busy: true, error: null });
    try {
      const result = await window.nexus.previewRestore(profileId, phrase);
      switch (result.status) {
        case "ready":
          // The passphrase has done its job — main holds the opened archive
          // now, and nothing after this point ever needs it again
          // (`BackupSection`'s own hygiene rule).
          setPassphrase("");
          setState({ phase: "ready", pick, preview: result.preview, error: null });
          return;
        case "invalid":
          setState({ phase: "invalid", pick, problems: result.problems });
          return;
        case "unreadable":
          setState({
            phase: "picked",
            pick,
            // An archive that turns out to want a passphrase gets the field
            // even if the pick did not say so — otherwise the message asks for
            // something this screen offers no way to give.
            needsPassphrase: pick.encrypted || result.code === "passphrase-required",
            busy: false,
            error: s.unreadable[result.code],
          });
          return;
        case "no-file":
          setState({ phase: "idle", error: s.noFileError });
          return;
      }
    } catch (previewError) {
      setState({
        phase: "picked",
        pick,
        needsPassphrase: pick.encrypted,
        busy: false,
        error: s.readError,
      });
      console.error("Nexus: failed to preview a restore archive:", previewError);
    }
  }

  /** Picking from any phase starts over — main closes the superseded pick itself. */
  async function choose(): Promise<void> {
    setState({ phase: "idle", error: null });
    setPassphrase("");
    try {
      const picked = await window.nexus.pickRestoreArchive();
      if (picked.canceled) return;
      const pick: PickedArchive = { fileName: picked.fileName, encrypted: picked.encrypted };
      if (pick.encrypted) {
        setState({ phase: "picked", pick, needsPassphrase: true, busy: false, error: null });
        return;
      }
      // Nothing left to ask for: a plain archive previews itself on the spot.
      await runPreview(pick, null);
    } catch (pickError) {
      setState({ phase: "idle", error: s.readError });
      console.error("Nexus: failed to pick a restore archive:", pickError);
    }
  }

  async function apply(pick: PickedArchive, preview: RestorePreview): Promise<void> {
    applying.current = true;
    setState({ phase: "applying", pick, preview });
    try {
      await window.nexus.applyRestore(profileId, preview.token);
      // Main reloads this renderer moments after the reply lands, so the
      // success line simply stands until the whole screen is replaced.
      setState({ phase: "applied" });
    } catch (applyError) {
      // A failed apply leaves the preview — and the token main accepts —
      // untouched, so the screen goes back to it rather than to idle.
      setState({ phase: "ready", pick, preview, error: s.error });
      console.error("Nexus: failed to apply a restore:", applyError);
    } finally {
      applying.current = false;
    }
  }

  async function cancel(): Promise<void> {
    setState({ phase: "idle", error: null });
    setPassphrase("");
    try {
      await window.nexus.cancelRestore();
    } catch (cancelError) {
      console.error("Nexus: failed to release the picked archive:", cancelError);
    }
  }

  const previewing = state.phase === "ready" || state.phase === "applying";

  return (
    <div className="set__restore-block">
      <h3 className="set__module-group-title">{s.title}</h3>
      <p className="app__muted">{s.description}</p>

      {!previewing && state.phase !== "applied" && (
        <Button
          size="sm"
          variant="primary"
          disabled={state.phase === "picked" && state.busy}
          onClick={() => void choose()}
        >
          {s.pickButton}
        </Button>
      )}

      {state.phase === "idle" && state.error != null && <p className="set__error">{state.error}</p>}

      {state.phase === "picked" && (
        <>
          <p className="set__section-caption">
            {s.pickedPrefix} <span className="app__path">{state.pick.fileName}</span>
          </p>
          {state.needsPassphrase && (
            <form
              className="set__security-form"
              onSubmit={(event) => {
                event.preventDefault();
                void runPreview(state.pick, passphrase);
              }}
            >
              <TextField
                type="password"
                label={s.passphraseLabel}
                value={passphrase}
                disabled={state.busy}
                onChange={(event) => setPassphrase(event.target.value)}
              />
              <Button type="submit" size="sm" variant="primary" disabled={state.busy || passphrase === ""}>
                {s.previewButton}
              </Button>
            </form>
          )}
          {state.busy && <p className="app__muted">{s.previewRunning}</p>}
          {state.error != null && <p className="set__error">{state.error}</p>}
        </>
      )}

      {state.phase === "invalid" && (
        <>
          <p className="set__section-caption">
            {s.pickedPrefix} <span className="app__path">{state.pick.fileName}</span>
          </p>
          <ul className="set__restore-problems">
            {state.problems.map((problem, index) => (
              <RestoreProblemRow key={`${problem.code}-${index}`} problem={problem} tone="error" />
            ))}
          </ul>
        </>
      )}

      {previewing && (
        <>
          <div className="set__restore-head">
            <span className="app__path">{state.preview.fileName}</span>
            <span className="set__restore-meta">
              {s.createdLabel}: {formatArchiveInstant(state.preview.createdAt)}
            </span>
            <span className="set__restore-meta">
              {s.versionLabel}: {state.preview.appVersion}
            </span>
            <span className="set__restore-meta">
              {s.sourceLabel}: {state.preview.sourceProfileName}
            </span>
          </div>

          <p className="set__restore-warning">
            {s.replaceWarningPrefix} <strong>{state.preview.targetProfileName}</strong>{" "}
            {s.replaceWarningSuffix}
          </p>

          <table className="set__restore-table">
            <thead>
              <tr>
                {/* The row-header column's own corner cell: a module name needs no heading. */}
                <td />
                <th scope="col">{s.columnCurrent}</th>
                <th scope="col">{s.columnIncoming}</th>
              </tr>
            </thead>
            <tbody>
              {RESTORE_MODULES.map((key) => (
                <tr key={key}>
                  <th scope="row">{s.modules[key]}</th>
                  <td>{state.preview.current[key]}</td>
                  <td>{state.preview.incoming[key]}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {state.preview.warnings.length > 0 && (
            <ul className="set__restore-problems">
              {state.preview.warnings.map((warning, index) => (
                <RestoreProblemRow key={`${warning.code}-${index}`} problem={warning} tone="muted" />
              ))}
            </ul>
          )}
          {state.preview.corruptBlobs > 0 && (
            <p className="set__section-caption">
              {s.corruptBlobsPrefix} {state.preview.corruptBlobs}{" "}
              {dayUnit(state.preview.corruptBlobs, s.corruptBlobsUnitOne, s.corruptBlobsUnitMany)}{" "}
              {s.corruptBlobsSuffix}
            </p>
          )}

          <div className="set__restore-actions">
            <Button
              size="sm"
              variant="primary"
              disabled={state.phase === "applying"}
              onClick={() => void apply(state.pick, state.preview)}
            >
              {s.applyButton}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={state.phase === "applying"}
              onClick={() => void cancel()}
            >
              {s.cancelButton}
            </Button>
          </div>

          {state.phase === "applying" && <p className="app__muted">{s.applying}</p>}
          {state.phase === "ready" && state.error != null && <p className="set__error">{state.error}</p>}
        </>
      )}

      {state.phase === "applied" && <p className="set__section-caption">{s.applied}</p>}
    </div>
  );
}

/** A settings-form result line: green-ish caption on success, `.set__error` on failure — same idiom as `ProfileSection`/`BackupSection`, just shared across the two Sigurnost sub-forms. */
interface SecurityMessage {
  text: string;
  failed: boolean;
}

interface SecuritySectionProps {
  autoLockMinutes: AutoLockMinutes;
  onAutoLockChange: (value: AutoLockMinutes) => void;
}

/**
 * Sigurnost section (ADR-018 / AUTH): change the passcode, regenerate the
 * Recovery Kit (reusing `AuthGate`'s own panel — never a second one), and the
 * idle auto-lock preference. Auth is whole-account, not per-profile, so unlike
 * every other section here this one takes no `profileId`.
 */
function SecuritySection({ autoLockMinutes, onAutoLockChange }: SecuritySectionProps) {
  const [currentPasscode, setCurrentPasscode] = useState("");
  const [nextPasscode, setNextPasscode] = useState("");
  const [confirmPasscode, setConfirmPasscode] = useState("");
  const [changing, setChanging] = useState(false);
  const [changeMessage, setChangeMessage] = useState<SecurityMessage | null>(null);

  async function submitChange(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (changing) return;
    setChangeMessage(null);
    if (!passcodeMeetsPolicy(nextPasscode)) {
      setChangeMessage({ text: strings.auth.validation.tooWeak, failed: true });
      return;
    }
    if (nextPasscode !== confirmPasscode) {
      setChangeMessage({ text: strings.auth.validation.mismatch, failed: true });
      return;
    }
    setChanging(true);
    try {
      const result = await window.nexus.changePasscode(currentPasscode, nextPasscode);
      if (result.ok) {
        setChangeMessage({ text: strings.settings.security.changeSuccess, failed: false });
        setCurrentPasscode("");
        setNextPasscode("");
        setConfirmPasscode("");
      } else {
        setChangeMessage({ text: authErrorMessage(result.reason), failed: true });
      }
    } catch (error) {
      setChangeMessage({ text: strings.auth.error.generic, failed: true });
      console.error("Nexus: failed to change the passcode:", error);
    } finally {
      setChanging(false);
    }
  }

  const [regenerating, setRegenerating] = useState(false);
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  async function regenerate(): Promise<void> {
    if (regenerating) return;
    setRegenerating(true);
    setRecoveryError(null);
    try {
      const result = await window.nexus.regenerateRecoveryCode();
      if (result.ok && result.recoveryCode) {
        setNewRecoveryCode(result.recoveryCode);
      } else {
        setRecoveryError(result.ok ? strings.auth.error.generic : authErrorMessage(result.reason));
      }
    } catch (error) {
      setRecoveryError(strings.auth.error.generic);
      console.error("Nexus: failed to regenerate the recovery code:", error);
    } finally {
      setRegenerating(false);
    }
  }

  const s = strings.settings.security;

  return (
    <>
      <div className="set__security-block">
        <h3 className="set__module-group-title">{s.changeTitle}</h3>
        <form className="set__security-form" onSubmit={(event) => void submitChange(event)}>
          <TextField
            type="password"
            label={s.currentLabel}
            value={currentPasscode}
            required
            onChange={(event) => setCurrentPasscode(event.target.value)}
          />
          <TextField
            type="password"
            label={s.newLabel}
            value={nextPasscode}
            required
            onChange={(event) => setNextPasscode(event.target.value)}
          />
          <TextField
            type="password"
            label={s.confirmLabel}
            value={confirmPasscode}
            required
            onChange={(event) => setConfirmPasscode(event.target.value)}
          />
          <Button type="submit" size="sm" variant="primary" disabled={changing}>
            {s.save}
          </Button>
        </form>
        {changeMessage != null && (
          <p className={changeMessage.failed ? "set__error" : "set__section-caption"}>
            {changeMessage.text}
          </p>
        )}
      </div>

      <div className="set__security-block">
        <h3 className="set__module-group-title">{s.recoveryTitle}</h3>
        {newRecoveryCode != null ? (
          <RecoveryKitPanel code={newRecoveryCode} onContinue={() => setNewRecoveryCode(null)} />
        ) : (
          <>
            <p className="set__section-caption">{s.recoveryWarning}</p>
            <Button size="sm" variant="primary" disabled={regenerating} onClick={() => void regenerate()}>
              {s.regenerate}
            </Button>
            {recoveryError != null && <p className="set__error">{recoveryError}</p>}
          </>
        )}
      </div>

      <div className="set__security-block">
        <h3 className="set__module-group-title">{s.autoLockTitle}</h3>
        <p className="set__section-caption">{s.autoLockHint}</p>
        <select
          className="set__select"
          value={autoLockMinutes}
          aria-label={s.autoLockTitle}
          onChange={(event) => onAutoLockChange(Number(event.target.value) as AutoLockMinutes)}
        >
          {AUTO_LOCK_MINUTES.map((minutes) => (
            <option key={minutes} value={minutes}>
              {s.autoLockOptions[String(minutes)] ?? String(minutes)}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

export interface SettingsPageProps {
  profileId: string;
  profileName: string;
  info: AppInfo | null;
  flags: FlagState;
  onFlagsChanged: (flags: FlagState) => void;
  onProfileRenamed: (name: string) => void;
  preference: ThemePreference;
  onPreferenceChange: (preference: ThemePreference) => void;
  registry: ModuleRegistry;
  autoLockMinutes: AutoLockMinutes;
  onAutoLockChange: (value: AutoLockMinutes) => void;
}

/**
 * SET (lite): profile rename, theme preference (Sistemski/Dan/Noć), the
 * module gallery (per-category enable/disable, SET-007), NTF-008's appetite
 * presets over the shared quiet-hours/source controls, and a read-only
 * "O aplikaciji" info panel. Every write goes through IPC methods that
 * already exist (`renameProfile`, `setFlag`, `setNotificationSourceEnabled`,
 * …) — this slice is renderer-only wiring, no DB/IPC/main changes.
 */
export function SettingsPage({
  profileId,
  profileName,
  info,
  flags,
  onFlagsChanged,
  onProfileRenamed,
  preference,
  onPreferenceChange,
  registry,
  autoLockMinutes,
  onAutoLockChange,
}: SettingsPageProps) {
  const [accent, setAccent] = useState<AccentId>(() => readStoredAccent());
  const [modulesError, setModulesError] = useState<string | null>(null);
  const [notificationSources, setNotificationSources] = useState<NotificationSource[] | null>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  // Bumped after a preset write. Both the effect below (this page's own
  // active-preset highlight) and NotificationSettingsControls's fetch effect
  // (via its `refreshToken` prop) depend on it, so one write refreshes both.
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const settings = await window.nexus.getNotificationSettings(profileId);
        if (active) setNotificationSources(settings.enabledSources);
      } catch (error) {
        console.error("Nexus: failed to load notification settings:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId, refreshToken]);

  async function toggleModule(moduleId: string, enabled: boolean): Promise<void> {
    setModulesError(null);
    try {
      await window.nexus.setFlag(profileId, moduleId, enabled);
      onFlagsChanged(await window.nexus.getFlags(profileId));
    } catch (error) {
      setModulesError(strings.settings.modulesToggleError);
      console.error("Nexus: failed to update module flag:", error);
    }
  }

  async function applyPreset(sources: NotificationSource[]): Promise<void> {
    setPresetError(null);
    try {
      await Promise.all(
        ALL_NOTIFICATION_SOURCES.map((source) =>
          window.nexus.setNotificationSourceEnabled(profileId, source, sources.includes(source)),
        ),
      );
      setRefreshToken((token) => token + 1);
    } catch (error) {
      setPresetError(strings.notifications.settings.saveError);
      console.error("Nexus: failed to apply notification preset:", error);
    }
  }

  const activePreset =
    notificationSources != null
      ? NOTIFICATION_PRESETS.find((preset) => sameSourceSet(preset.sources, notificationSources))
      : undefined;

  return (
    <div className="set">
      <h1 className="set__title">{moduleName("settings")}</h1>

      <Card title={strings.settings.sectionTitle.profile} className="set__section">
        <ProfileSection
          profileId={profileId}
          initialName={profileName}
          onProfileRenamed={onProfileRenamed}
        />
      </Card>

      <Card title={strings.settings.sectionTitle.security} className="set__section">
        <SecuritySection autoLockMinutes={autoLockMinutes} onAutoLockChange={onAutoLockChange} />
      </Card>

      <Card title={strings.settings.sectionTitle.appearance} className="set__section">
        <div className="set__segmented" role="group" aria-label={strings.settings.sectionTitle.appearance}>
          {THEME_OPTIONS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={preference === option ? "primary" : "ghost"}
              aria-pressed={preference === option}
              onClick={() => onPreferenceChange(option)}
            >
              {themeOptionLabel(option)}
            </Button>
          ))}
        </div>
        <p className="set__section-caption">
          {strings.settings.appearance.accentLabel} — {strings.settings.appearance.accentNames[accent] ?? accent}
        </p>
        <div className="set__accent-row" role="group" aria-label={strings.settings.appearance.accentLabel}>
          {ACCENT_IDS.map((id) => {
            const name = strings.settings.appearance.accentNames[id] ?? id;
            const selected = accent === id;
            return (
              <button
                key={id}
                type="button"
                className={`set__accent-swatch${selected ? " set__accent-swatch--selected" : ""}`}
                aria-pressed={selected}
                title={name}
                aria-label={name}
                style={{ background: `var(--nx-swatch-${id})` }}
                onClick={() => {
                  persistAccent(id);
                  setAccent(id);
                }}
              />
            );
          })}
        </div>
      </Card>

      <Card title={strings.settings.sectionTitle.modules} className="set__section">
        {[...registry.byCategory()].map(([category, members]) => (
          <div key={category} className="set__module-group">
            <h3 className="set__module-group-title">
              {strings.settings.moduleCategories[category] ?? category}
            </h3>
            <div className="set__module-list">
              {members.map((manifest) => {
                const locked = LOCKED_MODULES.has(manifest.id);
                const enabled = flags[manifest.id] ?? manifest.defaultEnabled;
                return (
                  <div className="set__module-row" key={manifest.id}>
                    <div className="set__module-info">
                      <span className="set__module-name">{moduleName(manifest.id)}</span>
                      <span className="set__module-desc">
                        {strings.settings.moduleDescriptions[manifest.id] ?? ""}
                      </span>
                    </div>
                    {locked ? (
                      <Chip>{strings.settings.modulesAlwaysOn}</Chip>
                    ) : (
                      <Checkbox
                        checked={enabled}
                        aria-label={moduleName(manifest.id)}
                        onChange={(event) => void toggleModule(manifest.id, event.target.checked)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {modulesError != null && <p className="set__error">{modulesError}</p>}
      </Card>

      <Card title={strings.settings.sectionTitle.notifications} className="set__section">
        <div className="set__preset-row">
          {NOTIFICATION_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              size="sm"
              variant={activePreset?.key === preset.key ? "primary" : "ghost"}
              onClick={() => void applyPreset(preset.sources)}
            >
              {strings.settings.notificationPresets[preset.key]}
            </Button>
          ))}
        </div>
        <p className="set__section-caption">{strings.settings.notificationPresets.caption}</p>
        {presetError != null && <p className="set__error">{presetError}</p>}
        <NotificationSettingsControls profileId={profileId} refreshToken={refreshToken} />
      </Card>

      <Card title={strings.settings.sectionTitle.backup} className="set__section">
        <BackupSection profileId={profileId} />
        <RestoreSection profileId={profileId} />
      </Card>

      <Card title={strings.settings.sectionTitle.about} className="set__section">
        {info ? (
          <dl className="app__facts">
            <div>
              <dt>{strings.settings.about.version}</dt>
              <dd>
                {info.name} {info.version}
              </dd>
            </div>
            <div>
              <dt>{strings.settings.about.electron}</dt>
              <dd>{info.versions.electron}</dd>
            </div>
            <div>
              <dt>{strings.settings.about.chromium}</dt>
              <dd>{info.versions.chrome}</dd>
            </div>
            <div>
              <dt>{strings.settings.about.node}</dt>
              <dd>{info.versions.node}</dd>
            </div>
            <div>
              <dt>{strings.settings.about.dataLocation}</dt>
              <dd className="app__path">{info.userDataPath}</dd>
            </div>
          </dl>
        ) : (
          <p className="app__muted">{strings.app.loading}</p>
        )}
      </Card>
    </div>
  );
}
