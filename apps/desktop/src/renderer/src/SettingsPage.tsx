import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Button, Card, Checkbox, Chip, TextField } from "@nexus/ui";
import {
  chordAccelerator,
  chordFromEvent,
  findChordConflict,
  formatChord,
  isModifierKey,
  MODULE_NAV_CONFLICT,
  validateArchivePassphrase,
  type ModuleRegistry,
} from "@nexus/core";
import { ACCENT_IDS, type AccentId } from "@nexus/tokens";
import { MAX_BACKGROUND_DIM } from "../../shared/ipc.js";
import type {
  AppInfo,
  DashboardSettings,
  FlagState,
  ImportPreview,
  ImportSkipReason,
  NotificationSource,
  RestoreModuleCounts,
  RestorePreview,
  RestoreProblem,
} from "../../shared/ipc.js";
import { authErrorMessage, passcodeMeetsPolicy, RecoveryKitPanel } from "./AuthGate.js";
import { ALL_NOTIFICATION_SOURCES, NOTIFICATION_PRESETS } from "./notificationFormat.js";
import { NotificationSettingsControls } from "./NotificationSettingsControls.js";
import type { ThemePreference } from "./theme.js";
import { AUTO_LOCK_MINUTES, type AutoLockMinutes } from "./autoLock.js";
import {
  isGlobalShortcutAction,
  resolveShortcuts,
  shortcutActionLabel,
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  type ShortcutOverrides,
} from "./shortcuts.js";
import { Kbd } from "./ShortcutsDialog.js";
import { persistAccent, readStoredAccent } from "./accent.js";
import { persistWeekStart, readStoredWeekStart, type WeekStartPreference } from "./weekStart.js";
import {
  buildSettingsSearchEntries,
  foldSettingsQuery,
  matchSettings,
  moduleEntryId,
  shortcutEntryId,
} from "./settingsSearch.js";
import {
  NOTE_WIDTHS,
  persistNoteMarkdownShortcuts,
  persistNoteWidth,
  readStoredNoteMarkdownShortcuts,
  readStoredNoteWidth,
  type NoteWidth,
} from "./notePrefs.js";
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

/** PRD 04 §5, Ponedeljak first — the default, and the order a Serbian week is read in. */
const WEEK_START_OPTIONS: WeekStartPreference[] = ["monday", "sunday"];

/**
 * SET-014 hit styling: a matched control label goes gold + semibold, exactly
 * like every other active state in the app. Never a background wash or a glow.
 */
function labelClass(base: string, hit: boolean): string {
  return hit ? `${base} set__hit` : base;
}

/**
 * SET-014 section visibility: a filtered-out card hides with CSS instead of
 * unmounting, so in-progress state — a restore preview holding its archive
 * open, a half-typed passcode, unsaved quiet-hours edits — survives a
 * keystroke in the filter box.
 */
function sectionClass(visible: boolean): string {
  return visible ? "set__section" : "set__section set__section--hidden";
}

/** The home surface and this page itself can never be disabled — someone has to render the toggles. */
const LOCKED_MODULES = new Set(["dashboard", "settings"]);

function sameSourceSet(a: readonly NotificationSource[], b: readonly NotificationSource[]): boolean {
  return a.length === b.length && a.every((source) => b.includes(source));
}

const NAME_MAX = 80;

interface ProfileSectionProps {
  profileId: string;
  initialName: string;
  onProfileRenamed: (name: string) => void;
  /** SET-014 search hits; the section reads only its own entry ids out of it. */
  hits: ReadonlySet<string>;
}

/** Profil section: renames the active profile (same 1–80-char rule as Onboarding). */
function ProfileSection({ profileId, initialName, onProfileRenamed, hits }: ProfileSectionProps) {
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
          // The hit class lands on the field WRAPPER (that is where TextField
          // puts className), so the stylesheet reaches the label through it —
          // colouring the wrapper itself would bleed into the input's own text.
          className={hits.has("profile-name") ? "set__hit-field" : ""}
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

/** The archive modules, in the order both the restore table and the import report show them. */
const ARCHIVE_MODULES: (keyof RestoreModuleCounts)[] = [
  "tasks",
  "calendar",
  "study",
  "notifications",
  "notes",
  "dashboard",
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
  /** SET-014 search hits; the section reads only its own entry ids out of it. */
  hits: ReadonlySet<string>;
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
function RestoreSection({ profileId, hits }: RestoreSectionProps) {
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
      <h3 className={labelClass("set__module-group-title", hits.has("backup-restore"))}>{s.title}</h3>
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
              {ARCHIVE_MODULES.map((key) => (
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

/**
 * The import flow's state, phase for phase the same machine `RestoreState` is:
 * the two flows differ in what they DO, never in how they are driven, and one
 * shape means one set of buttons-per-phase to reason about. Only the preview
 * type differs, because only the preview says anything different.
 */
type ImportState =
  | { phase: "idle"; error: string | null }
  | {
      phase: "picked";
      pick: PickedArchive;
      needsPassphrase: boolean;
      busy: boolean;
      error: string | null;
    }
  | { phase: "invalid"; pick: PickedArchive; problems: RestoreProblem[] }
  | { phase: "ready"; pick: PickedArchive; preview: ImportPreview; error: string | null }
  | { phase: "applying"; pick: PickedArchive; preview: ImportPreview }
  | { phase: "applied" };

/** One named group of rows the import will not write: its Serbian reason, then the module it belonged to and how many rows it covers. */
function ImportSkipRow({ reason }: { reason: ImportSkipReason }) {
  const s = strings.settings.import;
  const moduleLabel = reason.module === null ? null : strings.settings.restore.modules[reason.module];
  return (
    <li className="set__import-skip">
      {s.skips[reason.code]}{" "}
      <span className="set__import-skip-meta">
        {moduleLabel !== null && <>{moduleLabel} · </>}
        {reason.count}
      </span>
    </li>
  );
}

interface ImportSectionProps {
  profileId: string;
  /** SET-014 search hits; the section reads only its own entry ids out of it. */
  hits: ReadonlySet<string>;
}

/**
 * Uvoz iz arhive (ADR-043 §5): pick somebody else's archive — or your own other
 * profile's — dry-run it against THIS profile, and merge it in.
 *
 * Deliberately the restore section's twin: the same pick → passphrase →
 * preview → confirm machine, the same busy and error states, the same `set__`
 * recipes, so the two cards read as siblings and the user learns one flow. What
 * differs is the contract and therefore the preview. A restore REPLACES, so its
 * preview compares current with incoming; an import ADDS, so nothing is being
 * replaced and the only honest numbers are per-module arithmetic — what the
 * archive carried, what will be inserted, what merged onto something already
 * here, and what will not arrive at all, every last one of those NAMED before
 * anything is written.
 *
 * As with a restore, main reloads this renderer after a successful apply, so
 * nothing here depends on its own state surviving; the undo banner the reloaded
 * app shows is driven by `restoreStatus` in App.tsx, which serves both
 * operations from one slot.
 */
function ImportSection({ profileId, hits }: ImportSectionProps) {
  const s = strings.settings.import;
  // The half of the flow that is identical to a restore's, read from where it
  // is already spelled rather than spelled a second time.
  const shared = strings.settings.restore;

  const [state, setState] = useState<ImportState>({ phase: "idle", error: null });
  // Outside the state machine for the reason `RestoreSection`'s is: a wrong
  // passphrase comes back as a status, not a rejection, and the user corrects
  // the value already typed rather than retyping it.
  const [passphrase, setPassphrase] = useState("");
  // Read by the unmount cleanup only. An apply in flight must never be
  // cancelled from here: main is copying blobs out of the very archive
  // `cancelImport` would close under it.
  const applying = useRef(false);

  // Leaving the page while an archive is picked still has to release it — an
  // opened archive keeps the user's file locked on Windows. After an apply main
  // has already dropped the pick, so this is a no-op.
  useEffect(() => {
    return () => {
      if (applying.current) return;
      void window.nexus.cancelImport().catch((error: unknown) => {
        console.error("Nexus: failed to release the picked import archive:", error);
      });
    };
  }, []);

  async function runPreview(pick: PickedArchive, phrase: string | null): Promise<void> {
    setState({ phase: "picked", pick, needsPassphrase: phrase !== null, busy: true, error: null });
    try {
      const result = await window.nexus.previewImport(profileId, phrase);
      switch (result.status) {
        case "ready":
          // Main holds the opened archive now; nothing after this point ever
          // needs the passphrase again (`BackupSection`'s own hygiene rule).
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
            // An archive that turns out to want a passphrase gets the field even
            // if the pick did not say so — otherwise the message asks for
            // something this screen offers no way to give.
            needsPassphrase: pick.encrypted || result.code === "passphrase-required",
            busy: false,
            error: shared.unreadable[result.code],
          });
          return;
        case "no-file":
          setState({ phase: "idle", error: shared.noFileError });
          return;
      }
    } catch (previewError) {
      setState({
        phase: "picked",
        pick,
        needsPassphrase: pick.encrypted,
        busy: false,
        error: shared.readError,
      });
      console.error("Nexus: failed to preview an import archive:", previewError);
    }
  }

  /** Picking from any phase starts over — main closes the superseded pick itself. */
  async function choose(): Promise<void> {
    setState({ phase: "idle", error: null });
    setPassphrase("");
    try {
      const picked = await window.nexus.pickImportArchive();
      if (picked.canceled) return;
      const pick: PickedArchive = { fileName: picked.fileName, encrypted: picked.encrypted };
      if (pick.encrypted) {
        setState({ phase: "picked", pick, needsPassphrase: true, busy: false, error: null });
        return;
      }
      // Nothing left to ask for: a plain archive previews itself on the spot.
      await runPreview(pick, null);
    } catch (pickError) {
      setState({ phase: "idle", error: shared.readError });
      console.error("Nexus: failed to pick an import archive:", pickError);
    }
  }

  async function apply(pick: PickedArchive, preview: ImportPreview): Promise<void> {
    applying.current = true;
    setState({ phase: "applying", pick, preview });
    try {
      await window.nexus.applyImport(profileId, preview.token);
      // Main reloads this renderer moments after the reply lands, so the
      // success line simply stands until the whole screen is replaced.
      setState({ phase: "applied" });
    } catch (applyError) {
      // A failed apply leaves the plan — and the token main accepts —
      // untouched, so the screen goes back to it rather than to idle.
      setState({ phase: "ready", pick, preview, error: s.error });
      console.error("Nexus: failed to apply an import:", applyError);
    } finally {
      applying.current = false;
    }
  }

  async function cancel(): Promise<void> {
    setState({ phase: "idle", error: null });
    setPassphrase("");
    try {
      await window.nexus.cancelImport();
    } catch (cancelError) {
      console.error("Nexus: failed to release the picked import archive:", cancelError);
    }
  }

  const previewing = state.phase === "ready" || state.phase === "applying";

  return (
    <div className="set__import-block">
      <h3 className={labelClass("set__module-group-title", hits.has("backup-import"))}>{s.title}</h3>
      <p className="app__muted">{s.description}</p>

      {!previewing && state.phase !== "applied" && (
        <Button
          size="sm"
          variant="primary"
          disabled={state.phase === "picked" && state.busy}
          onClick={() => void choose()}
        >
          {shared.pickButton}
        </Button>
      )}

      {state.phase === "idle" && state.error != null && <p className="set__error">{state.error}</p>}

      {state.phase === "picked" && (
        <>
          <p className="set__section-caption">
            {shared.pickedPrefix} <span className="app__path">{state.pick.fileName}</span>
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
                label={shared.passphraseLabel}
                value={passphrase}
                disabled={state.busy}
                onChange={(event) => setPassphrase(event.target.value)}
              />
              <Button type="submit" size="sm" variant="primary" disabled={state.busy || passphrase === ""}>
                {shared.previewButton}
              </Button>
            </form>
          )}
          {state.busy && <p className="app__muted">{shared.previewRunning}</p>}
          {state.error != null && <p className="set__error">{state.error}</p>}
        </>
      )}

      {state.phase === "invalid" && (
        <>
          <p className="set__section-caption">
            {shared.pickedPrefix} <span className="app__path">{state.pick.fileName}</span>
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
            {state.preview.encrypted && <Chip>{s.encryptedBadge}</Chip>}
            <span className="set__restore-meta">
              {shared.createdLabel}: {formatArchiveInstant(state.preview.createdAt)}
            </span>
            <span className="set__restore-meta">
              {shared.versionLabel}: {state.preview.appVersion}
            </span>
            <span className="set__restore-meta">
              {shared.sourceLabel}: {state.preview.sourceProfileName}
            </span>
            <span className="set__restore-meta">
              {s.targetLabel}: {state.preview.targetProfileName}
            </span>
          </div>

          <table className="set__restore-table set__import-table">
            <thead>
              <tr>
                {/* The row-header column's own corner cell: a module name needs no heading. */}
                <td />
                <th scope="col">{s.columnParsed}</th>
                <th scope="col">{s.columnImported}</th>
                <th scope="col">{s.columnMerged}</th>
                <th scope="col">{s.columnSkipped}</th>
              </tr>
            </thead>
            <tbody>
              {ARCHIVE_MODULES.map((key) => {
                const counts = state.preview.report.modules[key];
                return (
                  <tr key={key}>
                    <th scope="row">{shared.modules[key]}</th>
                    <td>{counts.parsed}</td>
                    <td>{counts.imported}</td>
                    <td>{counts.merged}</td>
                    <td>{counts.skipped}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="set__section-caption">{s.tableCaption}</p>

          {state.preview.report.skips.length > 0 && (
            <>
              <h4 className="set__module-group-title">{s.skipsTitle}</h4>
              <ul className="set__restore-problems">
                {state.preview.report.skips.map((reason) => (
                  <ImportSkipRow
                    key={`${reason.code}-${reason.module ?? ""}-${reason.type ?? ""}`}
                    reason={reason}
                  />
                ))}
              </ul>
            </>
          )}

          {state.preview.warnings.length > 0 && (
            <>
              <h4 className="set__module-group-title">{s.warningsTitle}</h4>
              <ul className="set__restore-problems">
                {state.preview.warnings.map((warning, index) => (
                  <RestoreProblemRow key={`${warning.code}-${index}`} problem={warning} tone="muted" />
                ))}
              </ul>
            </>
          )}
          {state.preview.corruptBlobs > 0 && (
            <p className="set__section-caption">
              {shared.corruptBlobsPrefix} {state.preview.corruptBlobs}{" "}
              {dayUnit(state.preview.corruptBlobs, shared.corruptBlobsUnitOne, shared.corruptBlobsUnitMany)}{" "}
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
              {shared.cancelButton}
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

interface DashboardSectionProps {
  profileId: string;
  /** SET-014 hit ids — the dim label highlights under `"dashboard-dim"`; the picker entries steer section visibility only. */
  hits: ReadonlySet<string>;
}

/**
 * Kontrolna tabla section (SET-006 / ADR-041): the dashboard's own background
 * image and the dim that holds it behind the widgets.
 *
 * The renderer validates nothing about the file and never sees one — every
 * button here is a request to main, which owns the picker, the size gate, the
 * MIME sniff and the blob store (SEC-EL). A refused pick comes back as a NAMED
 * reason and is shown as such; nothing is silently converted to fit.
 *
 * The slider is hidden while no background is set, because a dim with nothing
 * to dim is a control that does nothing. It commits on every change rather than
 * behind a save button: the value is one small integer, the effect is visual,
 * and a "Sačuvaj" between the two would only put a step between the user and
 * what they are looking at.
 */
function DashboardSection({ profileId, hits }: DashboardSectionProps) {
  const s = strings.settings.dashboard;
  const [settings, setSettings] = useState<DashboardSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await window.nexus.dashboardSettings(profileId);
        if (active) setSettings(next);
      } catch (loadError) {
        if (active) setError(strings.settings.dashboard.error);
        console.error("Nexus: failed to load dashboard settings:", loadError);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  async function pick(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await window.nexus.pickDashboardBackground(profileId);
      if (result.status === "ok") setSettings(result.settings);
      else if (result.status === "rejected") setError(s.rejected[result.code]);
    } catch (pickError) {
      setError(s.error);
      console.error("Nexus: failed to pick a dashboard background:", pickError);
    } finally {
      setBusy(false);
    }
  }

  async function clear(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setSettings(await window.nexus.clearDashboardBackground(profileId));
    } catch (clearError) {
      setError(s.error);
      console.error("Nexus: failed to clear the dashboard background:", clearError);
    } finally {
      setBusy(false);
    }
  }

  // Optimistic on purpose: the slider must track the pointer, so the local
  // value moves first and main confirms after. A drag fires one write per step,
  // and their replies can land out of order — `latestDim` is what stops a slow
  // earlier reply from snapping the slider back over a newer position. Only the
  // reply to the CURRENT value is ever adopted; the rest are dropped, which
  // costs nothing since each carries the same row.
  const latestDim = useRef<number | null>(null);

  async function changeDim(dim: number): Promise<void> {
    latestDim.current = dim;
    setSettings((current) => (current === null ? current : { ...current, backgroundDim: dim }));
    setError(null);
    try {
      const next = await window.nexus.setDashboardDim(profileId, dim);
      if (latestDim.current === dim) setSettings(next);
    } catch (dimError) {
      setError(s.error);
      console.error("Nexus: failed to set the dashboard dim:", dimError);
    }
  }

  if (settings === null) {
    return error != null ? <p className="set__error">{error}</p> : <p className="app__muted">{strings.app.loading}</p>;
  }

  const backgroundHash = settings.backgroundHash;

  return (
    <>
      <p className="set__section-caption">{s.caption}</p>

      <div className="set__dash-row">
        {backgroundHash !== null && (
          <img className="set__dash-thumb" src={`nx-blob://${backgroundHash}`} alt={s.thumbnailAlt} />
        )}
        <div className="set__dash-actions">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void pick()}>
            {s.pick}
          </Button>
          {backgroundHash !== null && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void clear()}>
              {s.clear}
            </Button>
          )}
        </div>
      </div>

      {backgroundHash !== null && (
        <div className="set__dash-dim">
          <label
            className={labelClass("set__dash-dim-label", hits.has("dashboard-dim"))}
            htmlFor="set-dash-dim"
          >
            {s.dimLabel}
            <span className="set__dash-dim-value">{settings.backgroundDim}%</span>
          </label>
          <input
            id="set-dash-dim"
            className="set__dash-slider"
            type="range"
            min={0}
            max={MAX_BACKGROUND_DIM}
            step={5}
            value={settings.backgroundDim}
            onChange={(event) => void changeDim(Number(event.target.value))}
          />
          <p className="set__section-caption">{s.dimHint}</p>
        </div>
      )}

      {error != null && <p className="set__error">{error}</p>}
    </>
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
  /** SET-014 search hits; the section reads only its own entry ids out of it. */
  hits: ReadonlySet<string>;
}

/**
 * Sigurnost section (ADR-018 / AUTH): change the passcode, regenerate the
 * Recovery Kit (reusing `AuthGate`'s own panel — never a second one), and the
 * idle auto-lock preference. Auth is whole-account, not per-profile, so unlike
 * every other section here this one takes no `profileId`.
 */
function SecuritySection({ autoLockMinutes, onAutoLockChange, hits }: SecuritySectionProps) {
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
        <h3 className={labelClass("set__module-group-title", hits.has("security-passcode"))}>
          {s.changeTitle}
        </h3>
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
        <h3 className={labelClass("set__module-group-title", hits.has("security-recovery"))}>
          {s.recoveryTitle}
        </h3>
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
        <h3 className={labelClass("set__module-group-title", hits.has("security-auto-lock"))}>
          {s.autoLockTitle}
        </h3>
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

interface ShortcutsSectionProps {
  overrides: ShortcutOverrides;
  onChange: (overrides: ShortcutOverrides) => void;
  /** Opens the reference overlay App owns — the same one F1 and the palette command open. */
  onShowAll: () => void;
  /** TASK-002: the system refused the global row's chord to another application. */
  globalTaken: boolean;
  /** SET-014 hit ids — each action row highlights its label under `shortcutEntryId(action.id)`. */
  hits: ReadonlySet<string>;
}

/**
 * Prečice section (ADR-040 / SET-013): the remappable core set, each row
 * showing what it is bound to right now.
 *
 * „Promeni" turns that row's own button into the capture surface — one
 * control, so focus is already where the keystroke must be read and losing it
 * cancels, with no second element to keep in sync. The listener itself sits on
 * `window` in the CAPTURE phase, which is what lets a user record Ctrl+K
 * without also opening the palette: it runs strictly before the app's own
 * bubble-phase global handler and stops the event there.
 *
 * A combination that is not bindable, or that something else already holds, is
 * refused with the reason named and capture stays open. Nothing is ever
 * swapped out from under another action.
 *
 * The global row (TASK-002) carries one extra rule and one extra state. The
 * rule: its chord also has to be expressible as an OS accelerator, refused here
 * so a chord that could never be registered is never stored in the first place.
 * The state: the system can hand the combination to whoever asked first, which
 * is not something capture can foresee — that one is reported after the fact,
 * from `globalTaken`.
 */
function ShortcutsSection({
  overrides,
  onChange,
  onShowAll,
  globalTaken,
  hits,
}: ShortcutsSectionProps) {
  const s = strings.shortcuts;
  const [capturing, setCapturing] = useState<ShortcutActionId | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const bindings = resolveShortcuts(overrides);
  const hasOverrides = SHORTCUT_ACTIONS.some((action) => overrides[action.id] !== undefined);

  useEffect(() => {
    const actionId = capturing;
    if (actionId === null) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      // A modifier on its own is the combination still being assembled.
      if (isModifierKey(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setCapturing(null);
        setRefusal(null);
        return;
      }
      const chord = chordFromEvent(event);
      if (chord === null) {
        setRefusal(s.refuseUnbindable);
        return;
      }
      // The OS binds a physical key, so punctuation and layout-specific
      // characters would print one chord in Settings and fire from another
      // (`chordAccelerator`). Refused here rather than after a failed
      // registration, so what is stored is always registrable.
      if (isGlobalShortcutAction(actionId) && chordAccelerator(chord) === null) {
        setRefusal(s.refuseGlobal);
        return;
      }
      // `bindings` is this render's, and `overrides` — what it is derived from
      // — is in the dependency list below, so it is never a stale map.
      const conflict = findChordConflict(actionId, chord, bindings);
      if (conflict !== null) {
        setRefusal(
          s.takenPrefix +
            (conflict === MODULE_NAV_CONFLICT ? s.moduleNavLabel : shortcutActionLabel(conflict)),
        );
        return;
      }
      onChange({ ...overrides, [actionId]: chord });
      setCapturing(null);
      setRefusal(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // `bindings` is a pure derivation of `overrides` (already listed), and `s`
    // is a frozen module constant — neither would ever change when the other
    // dependencies did not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, overrides, onChange]);

  function reset(actionId: ShortcutActionId): void {
    const next = { ...overrides };
    delete next[actionId];
    onChange(next);
  }

  return (
    <>
      <div className="set__shortcut-list">
        {SHORTCUT_ACTIONS.map((action) => {
          const isCapturing = capturing === action.id;
          return (
            <div className="set__shortcut-item" key={action.id}>
              <div className="set__shortcut-row">
                <span className={labelClass("set__shortcut-label", hits.has(shortcutEntryId(action.id)))}>
                  {action.label}
                </span>
                <Kbd>{formatChord(bindings[action.id])}</Kbd>
                <div className="set__shortcut-actions">
                  <Button
                    size="sm"
                    variant={isCapturing ? "primary" : "ghost"}
                    aria-pressed={isCapturing}
                    onClick={() => {
                      setRefusal(null);
                      setCapturing(isCapturing ? null : action.id);
                    }}
                    onBlur={() => {
                      if (isCapturing) {
                        setCapturing(null);
                        setRefusal(null);
                      }
                    }}
                  >
                    {isCapturing ? s.capturePrompt : s.change}
                  </Button>
                  {overrides[action.id] !== undefined && (
                    <Button size="sm" variant="ghost" onClick={() => reset(action.id)}>
                      {s.reset}
                    </Button>
                  )}
                </div>
              </div>
              {isCapturing && (
                <p className={refusal !== null ? "set__error" : "set__section-caption"} role="status">
                  {refusal ?? s.captureHint}
                </p>
              )}
              {/* The „globalna" marker, said rather than drawn: what makes this
                  row different is a behaviour, so it is written out under it
                  instead of dressed up as a badge. */}
              {action.global && <p className="set__section-caption">{s.globalHint}</p>}
              {action.global && globalTaken && (
                <p className="set__error" role="status">
                  {s.globalTaken}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="set__section-caption">{s.cardCaption}</p>
      <div className="set__shortcut-footer">
        <Button size="sm" variant="primary" onClick={onShowAll}>
          {s.showAll}
        </Button>
        <Button size="sm" variant="ghost" disabled={!hasOverrides} onClick={() => onChange({})}>
          {s.resetAll}
        </Button>
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
  /** Remapped shortcuts (ADR-040), owned by App the way `autoLockMinutes` is. */
  shortcutOverrides: ShortcutOverrides;
  onShortcutOverridesChange: (overrides: ShortcutOverrides) => void;
  /** TASK-002: main's answer to the last global registration — false whenever the system granted it. */
  globalShortcutTaken: boolean;
  onShowShortcuts: () => void;
}

/**
 * SET (lite): profile rename, theme preference (Sistemski/Dan/Noć), the accent
 * palette, the first day of the week (PRD 04 §5), the module gallery
 * (per-category enable/disable, SET-007), NTF-008's appetite presets over the
 * shared quiet-hours/source controls, and a read-only "O aplikaciji" info
 * panel. Every write goes through IPC methods that already exist
 * (`renameProfile`, `setFlag`, `setNotificationSourceEnabled`, …) or through
 * the localStorage helpers the shell already uses for the theme and accent —
 * this page is renderer-only wiring, no DB/IPC/main changes.
 *
 * SET-014 layers a filter on top: the field below the title narrows the page to
 * the sections that answer the query (`settingsSearch.ts` owns what is
 * searchable) and marks the matched labels typographically. An empty query is
 * the page exactly as it was before the filter existed.
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
  shortcutOverrides,
  onShortcutOverridesChange,
  globalShortcutTaken,
  onShowShortcuts,
}: SettingsPageProps) {
  const [accent, setAccent] = useState<AccentId>(() => readStoredAccent());
  const [weekStart, setWeekStart] = useState<WeekStartPreference>(() => readStoredWeekStart());
  // SET-014: the raw query. Empty means "render everything exactly as before" —
  // the filter is additive, it never becomes the page's normal state.
  const [query, setQuery] = useState("");
  // ADR-036. Both are device preferences read straight out of localStorage,
  // exactly like `accent` above — no IPC, no profile row, no loading state.
  const [noteWidth, setNoteWidth] = useState<NoteWidth>(() => readStoredNoteWidth());
  const [markdownShortcuts, setMarkdownShortcuts] = useState(() =>
    readStoredNoteMarkdownShortcuts(),
  );
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

  // SET-014: the searchable index is a function of the registry alone, so it is
  // built once per registry rather than on every keystroke; the match itself is
  // a dozen string comparisons and needs no memo of its own.
  const searchEntries = useMemo(() => buildSettingsSearchEntries(registry), [registry]);
  const { sections, hits } = matchSettings(searchEntries, foldSettingsQuery(query));
  const a = strings.settings.appearance;

  return (
    <div className="set">
      <h1 className="set__title">{moduleName("settings")}</h1>

      <TextField
        className="set__search"
        value={query}
        aria-label={strings.settings.searchPlaceholder}
        placeholder={strings.settings.searchPlaceholder}
        onChange={(event) => setQuery(event.target.value)}
      />
      {sections.size === 0 && <p className="set__section-caption">{strings.search.emptyResults}</p>}

      <Card title={strings.settings.sectionTitle.profile} className={sectionClass(sections.has("profile"))}>
        <ProfileSection
          profileId={profileId}
          initialName={profileName}
          onProfileRenamed={onProfileRenamed}
          hits={hits}
        />
      </Card>

      <Card title={strings.settings.sectionTitle.security} className={sectionClass(sections.has("security"))}>
        <SecuritySection
          autoLockMinutes={autoLockMinutes}
          onAutoLockChange={onAutoLockChange}
          hits={hits}
        />
      </Card>

      <Card title={strings.settings.sectionTitle.appearance} className={sectionClass(sections.has("appearance"))}>
        <p className={labelClass("set__section-caption", hits.has("appearance-theme"))}>
          {a.themeLabel}
        </p>
        <div className="set__segmented" role="group" aria-label={a.themeLabel}>
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
        <p className={labelClass("set__section-caption", hits.has("appearance-accent"))}>
          {a.accentLabel} — {a.accentNames[accent] ?? accent}
        </p>
        <div className="set__accent-row" role="group" aria-label={a.accentLabel}>
          {ACCENT_IDS.map((id) => {
            const name = a.accentNames[id] ?? id;
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
        {/* PRD 04 §5. The calendar reads this on mount, so a change here shows
            the next time that page is opened — page switching remounts it. */}
        <p className={labelClass("set__section-caption", hits.has("appearance-week-start"))}>
          {a.weekStartLabel}
        </p>
        <div className="set__segmented" role="group" aria-label={a.weekStartLabel}>
          {WEEK_START_OPTIONS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={weekStart === option ? "primary" : "ghost"}
              aria-pressed={weekStart === option}
              onClick={() => {
                persistWeekStart(option);
                setWeekStart(option);
              }}
            >
              {a.weekStartOptions[option]}
            </Button>
          ))}
        </div>
      </Card>

      <Card title={strings.settings.sectionTitle.notes} className={sectionClass(sections.has("notes"))}>
        <p className={labelClass("set__section-caption", hits.has("note-width"))}>
          {strings.settings.notes.widthLabel}
        </p>
        <div className="set__segmented" role="group" aria-label={strings.settings.notes.widthLabel}>
          {NOTE_WIDTHS.map((width) => (
            <Button
              key={width}
              size="sm"
              variant={noteWidth === width ? "primary" : "ghost"}
              aria-pressed={noteWidth === width}
              onClick={() => {
                persistNoteWidth(width);
                setNoteWidth(width);
              }}
            >
              {strings.settings.notes.widthNames[width] ?? width}
            </Button>
          ))}
        </div>
        <div className="set__module-row">
          <div className="set__module-info">
            <span className={labelClass("set__module-name", hits.has("note-markdown-shortcuts"))}>
              {strings.settings.notes.markdownLabel}
            </span>
            <span className="set__module-desc">{strings.settings.notes.markdownCaption}</span>
          </div>
          <Checkbox
            checked={markdownShortcuts}
            aria-label={strings.settings.notes.markdownLabel}
            onChange={(event) => {
              persistNoteMarkdownShortcuts(event.target.checked);
              setMarkdownShortcuts(event.target.checked);
            }}
          />
        </div>
      </Card>

      <Card title={strings.settings.sectionTitle.shortcuts} className={sectionClass(sections.has("shortcuts"))}>
        <ShortcutsSection
          overrides={shortcutOverrides}
          onChange={onShortcutOverridesChange}
          onShowAll={onShowShortcuts}
          globalTaken={globalShortcutTaken}
          hits={hits}
        />
      </Card>

      <Card
        title={strings.settings.sectionTitle.dashboard}
        className={sectionClass(sections.has("dashboard"))}
      >
        <DashboardSection profileId={profileId} hits={hits} />
      </Card>

      <Card title={strings.settings.sectionTitle.modules} className={sectionClass(sections.has("modules"))}>
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
                      <span
                        className={labelClass(
                          "set__module-name",
                          hits.has(moduleEntryId(manifest.id)),
                        )}
                      >
                        {moduleName(manifest.id)}
                      </span>
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

      <Card title={strings.settings.sectionTitle.notifications} className={sectionClass(sections.has("notifications"))}>
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

      <Card title={strings.settings.sectionTitle.backup} className={sectionClass(sections.has("backup"))}>
        <BackupSection profileId={profileId} />
        <RestoreSection profileId={profileId} hits={hits} />
        <ImportSection profileId={profileId} hits={hits} />
      </Card>

      <Card title={strings.settings.sectionTitle.about} className={sectionClass(sections.has("about"))}>
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
