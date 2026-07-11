import { useEffect, useState } from "react";
import { Button, Card, Checkbox, Chip, TextField } from "@nexus/ui";
import type { ModuleRegistry } from "@nexus/core";
import type { AppInfo, FlagState, NotificationSource } from "../../shared/ipc.js";
import { ALL_NOTIFICATION_SOURCES } from "./notificationFormat.js";
import { NotificationSettingsControls } from "./NotificationSettingsControls.js";
import type { ThemePreference } from "./theme.js";
import { strings } from "./strings.js";

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
}: SettingsPageProps) {
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
