import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Chip, TextField } from "@nexus/ui";
import type {
  NotificationRecord,
  NotificationSettings,
  NotificationSource,
  SnoozePreset,
} from "../../shared/ipc.js";
import { bellCountLabel, formatNotificationWhen } from "./notificationFormat.js";
import { strings } from "./strings.js";

/** Deep-link target module per source (NTF a3: exam/study-day → study, document → calendar). */
const SOURCE_MODULE: Record<NotificationSource, string> = {
  document: "calendar",
  exam: "study",
  "study-day": "study",
};

const SNOOZE_PRESETS: SnoozePreset[] = ["10m", "1h", "tonight", "tomorrow-morning"];
const ALL_SOURCES: NotificationSource[] = ["document", "exam", "study-day"];

export interface NotificationCenterProps {
  profileId: string;
  /** Switches the shell's active module (same setter the sidebar nav uses). */
  onNavigate: (moduleId: string) => void;
}

/**
 * The NTF bell + center panel (piece a3) — the sidebar footer affordance over
 * a1/a2's ledger and scheduler. The bell shows an unread (`delivered`-status)
 * count, capped "9+"; the panel lists `delivered`/`snoozed` rows (dismissed
 * stays in the ledger as history but never resurfaces here), each with
 * snooze-preset/dismiss actions and a deep link into its source module, plus
 * a collapsed settings section for quiet hours / morning hour / per-source
 * toggles. Every mutation re-fetches rather than guessing the next state
 * locally (`updateNotificationSettings` returns the resolved settings;
 * `setNotificationSourceEnabled` returns void, so that path re-fetches via
 * `getNotificationSettings` instead of reconstructing the array by hand).
 */
export function NotificationCenter({ profileId, onNavigate }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<NotificationRecord[] | null>(null);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [quietFromInput, setQuietFromInput] = useState("");
  const [quietToInput, setQuietToInput] = useState("");
  const [quietError, setQuietError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  async function reload(): Promise<void> {
    try {
      setNotifications(await window.nexus.listCenterNotifications(profileId));
    } catch (error) {
      console.error("Nexus: failed to load notifications:", error);
    }
  }

  // Initial load: the center list plus settings (so opening the settings
  // disclosure never needs its own fetch).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [nextNotifications, nextSettings] = await Promise.all([
          window.nexus.listCenterNotifications(profileId),
          window.nexus.getNotificationSettings(profileId),
        ]);
        if (!active) return;
        setNotifications(nextNotifications);
        setSettings(nextSettings);
        setQuietFromInput(nextSettings.quietFrom ?? "");
        setQuietToInput(nextSettings.quietTo ?? "");
      } catch (error) {
        console.error("Nexus: failed to load notification center:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  // The scheduler (or another window) can change the ledger at any time. The
  // subscription is per profile; `reload` closes over the same profileId.
  useEffect(() => {
    return window.nexus.onNotificationsChanged(() => {
      void reload();
    });
  }, [profileId]);

  // Esc / outside click close the panel; the bell itself toggles it.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const deliveredCount = (notifications ?? []).filter((n) => n.status === "delivered").length;
  const centerRows = (notifications ?? []).filter(
    (n) => n.status === "delivered" || n.status === "snoozed",
  );
  const countLabel = bellCountLabel(deliveredCount);
  // main rejects "tonight" once 18:00 local has passed — hide it rather than
  // offer a preset guaranteed to fail.
  const pastEvening = new Date().getHours() >= 18;
  const s = strings.notifications;

  async function snooze(id: string, preset: SnoozePreset): Promise<void> {
    try {
      await window.nexus.snoozeNotification(profileId, id, preset);
      await reload();
    } catch (error) {
      console.error("Nexus: failed to snooze notification:", error);
    }
  }

  async function dismiss(id: string): Promise<void> {
    try {
      await window.nexus.dismissNotification(profileId, id);
      await reload();
    } catch (error) {
      console.error("Nexus: failed to dismiss notification:", error);
    }
  }

  function navigate(record: NotificationRecord): void {
    onNavigate(SOURCE_MODULE[record.source]);
    setOpen(false);
  }

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

  return (
    <div className="app__sidebar-footer" ref={containerRef}>
      <Button
        className={open ? "ntf__bell ntf__bell--open" : "ntf__bell"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{s.bellLabel}</span>
        {countLabel != null && <span className="ntf__bell-count">{countLabel}</span>}
      </Button>

      {open && (
        <div className="ntf__panel" role="region" aria-label={s.bellLabel}>
          <div className="ntf__list">
            {centerRows.length === 0 ? (
              <p className="ntf__empty">{s.empty}</p>
            ) : (
              centerRows.map((notification) => (
                <div className="ntf__row" key={notification.id}>
                  <button
                    type="button"
                    className="ntf__row-open"
                    onClick={() => navigate(notification)}
                  >
                    <div className="ntf__row-header">
                      <span className="ntf__row-title">{notification.title}</span>
                      <Chip>{s.sourceTag[notification.source]}</Chip>
                    </div>
                    <p className="ntf__row-body">{notification.body}</p>
                    <div className="ntf__row-meta">
                      <span>{formatNotificationWhen(notification.deliveredAt)}</span>
                      {notification.status === "snoozed" && notification.snoozedUntil != null && (
                        <Chip variant="accent">
                          {s.snoozedUntil} {formatNotificationWhen(notification.snoozedUntil)}
                        </Chip>
                      )}
                    </div>
                  </button>
                  <div className="ntf__row-actions">
                    <div className="ntf__snooze-presets">
                      {SNOOZE_PRESETS.filter((preset) => preset !== "tonight" || !pastEvening).map(
                        (preset) => (
                          <Button
                            key={preset}
                            size="sm"
                            onClick={() => void snooze(notification.id, preset)}
                          >
                            {s.snoozePreset[preset]}
                          </Button>
                        ),
                      )}
                    </div>
                    <Button
                      size="sm"
                      className="ntf__dismiss"
                      aria-label={s.dismissLabel}
                      onClick={() => void dismiss(notification.id)}
                    >
                      ×
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="ntf__settings">
            <Button
              size="sm"
              className="ntf__settings-toggle"
              onClick={() => setSettingsOpen((value) => !value)}
            >
              {settingsOpen ? s.settings.hide : s.settings.show}
            </Button>
            {settingsOpen && settings && (
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

                <div className="ntf__settings-sources">
                  {ALL_SOURCES.map((source) => (
                    <Checkbox
                      key={source}
                      checked={settings.enabledSources.includes(source)}
                      onChange={(event) => void toggleSource(source, event.target.checked)}
                    >
                      {s.settings.sourceToggle[source]}
                    </Checkbox>
                  ))}
                </div>

                {settingsError != null && <p className="ntf__settings-error">{settingsError}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
