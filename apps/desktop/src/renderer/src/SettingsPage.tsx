import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Button, Card, Checkbox, Chip, TextField } from "@nexus/ui";
import { validateArchivePassphrase, type ModuleRegistry } from "@nexus/core";
import { ACCENT_IDS, type AccentId } from "@nexus/tokens";
import type { AppInfo, FlagState, NotificationSource } from "../../shared/ipc.js";
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

/** NTF-008: minimalno/normalno/sve map onto growing subsets of the three sources. */
const NOTIFICATION_PRESETS: NotificationPreset[] = [
  { key: "minimal", sources: ["document"] },
  { key: "normal", sources: ["document", "exam"] },
  { key: "all", sources: ["document", "exam", "study-day"] },
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
