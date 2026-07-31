import { useEffect, useState } from "react";
import { Button, Checkbox, TextField } from "@nexus/ui";
import type { NotificationSettings, NotificationSource, SnoozePreset } from "../../shared/ipc.js";
import {
  ALL_NOTIFICATION_SOURCES,
  ALWAYS_ON_NOTIFICATION_SOURCES,
  SNOOZE_PRESETS,
} from "./notificationFormat.js";
import { strings } from "./strings.js";

export interface NotificationSettingsControlsProps {
  profileId: string;
  /**
   * Bumped by a caller that writes NTF settings out from under this
   * component (SettingsPage's appetite presets) so the fetch effect below
   * re-runs and the displayed inputs/checkboxes pick up the fresh state.
   * NotificationCenter renders this with no refresh source of its own, so it
   * simply never changes there — the prop is optional for that reason.
   */
  refreshToken?: number;
}

/**
 * The NTF settings body — quiet hours, morning hour, per-source toggles —
 * extracted from NotificationCenter's collapsed disclosure (piece a3) so
 * SettingsPage can render the exact same controls, always expanded, under
 * its appetite-preset shortcuts (NTF-008). Self-contained: fetches and owns
 * its own settings state exactly as the original inline code did, so neither
 * caller needs to hold NTF settings itself.
 */
export function NotificationSettingsControls({
  profileId,
  refreshToken,
}: NotificationSettingsControlsProps) {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [quietFromInput, setQuietFromInput] = useState("");
  const [quietToInput, setQuietToInput] = useState("");
  const [quietError, setQuietError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const s = strings.notifications;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await window.nexus.getNotificationSettings(profileId);
        if (!active) return;
        setSettings(next);
        setQuietFromInput(next.quietFrom ?? "");
        setQuietToInput(next.quietTo ?? "");
      } catch (error) {
        console.error("Nexus: failed to load notification settings:", error);
      }
    })();
    return () => {
      active = false;
    };
    // refreshToken carries no meaning of its own — it exists only so an
    // outside write (SettingsPage's presets) can force this effect to re-run.
  }, [profileId, refreshToken]);

  async function saveQuietHours(): Promise<void> {
    const from = quietFromInput.trim();
    const to = quietToInput.trim();
    if ((from.length === 0) !== (to.length === 0)) {
      setQuietError(s.settings.quietPairingError);
      return;
    }
    setQuietError(null);
    setSettingsError(null);
    try {
      const next = await window.nexus.updateNotificationSettings(profileId, {
        quietFrom: from.length > 0 ? from : null,
        quietTo: to.length > 0 ? to : null,
      });
      setSettings(next);
      setQuietFromInput(next.quietFrom ?? "");
      setQuietToInput(next.quietTo ?? "");
    } catch (error) {
      setSettingsError(s.settings.saveError);
      console.error("Nexus: failed to update quiet hours:", error);
    }
  }

  async function clearQuietHours(): Promise<void> {
    setQuietError(null);
    setSettingsError(null);
    try {
      const next = await window.nexus.updateNotificationSettings(profileId, {
        quietFrom: null,
        quietTo: null,
      });
      setSettings(next);
      setQuietFromInput("");
      setQuietToInput("");
    } catch (error) {
      setSettingsError(s.settings.saveError);
      console.error("Nexus: failed to clear quiet hours:", error);
    }
  }

  async function saveMorningHour(hour: string): Promise<void> {
    setSettingsError(null);
    try {
      setSettings(await window.nexus.updateNotificationSettings(profileId, { morningHour: hour }));
    } catch (error) {
      setSettingsError(s.settings.saveError);
      console.error("Nexus: failed to update morning hour:", error);
    }
  }

  async function saveSnoozeDefault(preset: SnoozePreset): Promise<void> {
    setSettingsError(null);
    try {
      setSettings(
        await window.nexus.updateNotificationSettings(profileId, { snoozeDefault: preset }),
      );
    } catch (error) {
      setSettingsError(s.settings.saveError);
      console.error("Nexus: failed to update the default snooze preset:", error);
    }
  }

  async function toggleSource(source: NotificationSource, enabled: boolean): Promise<void> {
    setSettingsError(null);
    try {
      await window.nexus.setNotificationSourceEnabled(profileId, source, enabled);
      setSettings(await window.nexus.getNotificationSettings(profileId));
    } catch (error) {
      setSettingsError(s.settings.saveError);
      console.error("Nexus: failed to update notification source:", error);
    }
  }

  if (settings == null) return null;

  return (
    <div className="ntf__settings-body">
      <div className="ntf__settings-row">
        <TextField
          type="time"
          label={s.settings.quietFromLabel}
          className="ntf__settings-time"
          value={quietFromInput}
          onChange={(event) => setQuietFromInput(event.target.value)}
        />
        <TextField
          type="time"
          label={s.settings.quietToLabel}
          className="ntf__settings-time"
          value={quietToInput}
          onChange={(event) => setQuietToInput(event.target.value)}
        />
        <Button size="sm" onClick={() => void saveQuietHours()}>
          {s.settings.quietSave}
        </Button>
        <Button size="sm" onClick={() => void clearQuietHours()}>
          {s.settings.quietClear}
        </Button>
      </div>
      {quietError != null && <p className="ntf__settings-error">{quietError}</p>}
      <p className="ntf__settings-hint">{s.settings.quietHint}</p>

      <TextField
        type="time"
        label={s.settings.morningHourLabel}
        className="ntf__settings-time"
        value={settings.morningHour}
        onChange={(event) => void saveMorningHour(event.target.value)}
      />

      {/*
        NTF-009: which preset the center's plain „Odloži“ button reaches for.
        Drawn as the Settings page's own preset row — active = primary, the
        rest ghost — so a choice-of-four looks the same wherever it is made,
        and rendered right after the morning hour because both answer "when
        does Nexus come back to me".
      */}
      <div className="ntf__settings-field">
        <span className="ntf__settings-label">{s.settings.snoozeDefaultLabel}</span>
        <div className="ntf__settings-presets">
          {SNOOZE_PRESETS.map((preset) => (
            <Button
              key={preset}
              size="sm"
              variant={settings.snoozeDefault === preset ? "primary" : "ghost"}
              aria-pressed={settings.snoozeDefault === preset}
              onClick={() => void saveSnoozeDefault(preset)}
            >
              {s.snoozePreset[preset]}
            </Button>
          ))}
        </div>
        <p className="ntf__settings-hint">{s.settings.snoozeDefaultHint}</p>
      </div>

      <div className="ntf__settings-sources">
        {ALL_NOTIFICATION_SOURCES.map((source) => (
          <Checkbox
            key={source}
            checked={settings.enabledSources.includes(source)}
            onChange={(event) => void toggleSource(source, event.target.checked)}
          >
            {s.settings.sourceToggle[source]}
          </Checkbox>
        ))}
        {/*
          NTF-007: shown in the same list as the toggles it sits beside, but
          forced on and disabled — the same way SET-007 renders a module that
          cannot be switched off. There is no preference behind it to read (it
          never appears in `enabledSources`) and nothing to write: main, the
          store and the table's own CHECK all refuse a security toggle.
        */}
        {ALWAYS_ON_NOTIFICATION_SOURCES.map((source) => (
          <Checkbox key={source} checked disabled readOnly>
            {s.settings.sourceToggle[source]}
          </Checkbox>
        ))}
      </div>
      <p className="ntf__settings-hint">{s.settings.alwaysOnCaption}</p>

      {settingsError != null && <p className="ntf__settings-error">{settingsError}</p>}
    </div>
  );
}
