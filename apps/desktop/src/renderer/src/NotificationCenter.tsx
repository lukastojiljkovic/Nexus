import { useEffect, useRef, useState } from "react";
import { Button, Chip } from "@nexus/ui";
import type { NotificationRecord, NotificationSource, SnoozePreset } from "../../shared/ipc.js";
import {
  ALWAYS_ON_NOTIFICATION_SOURCES,
  bellCountLabel,
  formatNotificationWhen,
  SNOOZE_PRESETS,
} from "./notificationFormat.js";
import { NotificationSettingsControls } from "./NotificationSettingsControls.js";
import { strings } from "./strings.js";

/**
 * Deep-link target module per source (NTF a3: exam/study-day → study,
 * document/event → calendar, task → tasks). A security notice (NTF-007) opens
 * Settings — the page holding the PIN, the Recovery Kit and the account list,
 * which is where every one of those events can actually be acted on. A renewal
 * reminder (FIN slice d) opens Finansije, where the subscription lives and
 * where the charge will land. A habit nudge (HABIT slice c) opens Navike, where
 * „Danas" is — the one screen on which the thing it is asking for can be ticked.
 */
const SOURCE_MODULE: Record<NotificationSource, string> = {
  document: "calendar",
  exam: "study",
  "study-day": "study",
  event: "calendar",
  task: "tasks",
  security: "settings",
  subscription: "finance",
  habit: "habits",
};

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
 * a collapsed disclosure that renders `NotificationSettingsControls` (quiet
 * hours / morning hour / per-source toggles — extracted so SET's Settings
 * page can render the identical controls, always expanded, alongside the
 * NTF-008 appetite presets).
 */
export function NotificationCenter({ profileId, onNavigate }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<NotificationRecord[] | null>(null);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function reload(): Promise<void> {
    try {
      setNotifications(await window.nexus.listCenterNotifications(profileId));
    } catch (error) {
      console.error("Nexus: failed to load notifications:", error);
    }
  }

  // Initial load: just the center list — NTF settings are now
  // NotificationSettingsControls's own concern (shared with SettingsPage).
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const nextNotifications = await window.nexus.listCenterNotifications(profileId);
        if (active) setNotifications(nextNotifications);
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
  // offer a preset guaranteed to fail. (Kept in sync with main's `TONIGHT_HOUR`
  // by hand, like every other main/renderer pair: the two never share a module.
  // The plain „Odloži“ button needs no such filter — main falls a default of
  // „Večeras“ forward to tomorrow morning instead, since there is no chip to
  // hide.)
  const pastEvening = new Date().getHours() >= 18;
  const s = strings.notifications;

  /**
   * `preset` omitted is the plain „Odloži“ button: main snoozes by the
   * profile's own default (NTF-009), read at the moment of the click, so this
   * component never has to hold — or refresh — a preference it does not
   * otherwise need.
   */
  async function snooze(id: string, preset?: SnoozePreset): Promise<void> {
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
                    {/*
                      An always-on row (NTF-007) has nothing to snooze: it
                      records something that already happened, so "remind me
                      later" would have nothing to come back for — and the
                      scheduler, which only ever re-fires a snoozed row while
                      its source is still due, would quietly retire it instead.
                      Dismiss stays: clearing it from the center is fine, and
                      the ledger keeps it as history either way.
                    */}
                    <div className="ntf__snooze-presets">
                      {!ALWAYS_ON_NOTIFICATION_SOURCES.includes(notification.source) && (
                        <>
                          {/*
                            NTF-009: the one-click snooze, by the profile's own
                            default. First and primary because it is the answer
                            in the common case; the four explicit presets stay
                            beside it for the times the default is not the one
                            wanted.
                          */}
                          <Button
                            size="sm"
                            variant="primary"
                            className="ntf__snooze-default"
                            onClick={() => void snooze(notification.id)}
                          >
                            {s.snoozeDefaultAction}
                          </Button>
                          {SNOOZE_PRESETS.filter(
                            (preset) => preset !== "tonight" || !pastEvening,
                          ).map((preset) => (
                            <Button
                              key={preset}
                              size="sm"
                              onClick={() => void snooze(notification.id, preset)}
                            >
                              {s.snoozePreset[preset]}
                            </Button>
                          ))}
                        </>
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
            {settingsOpen && <NotificationSettingsControls profileId={profileId} />}
          </div>
        </div>
      )}
    </div>
  );
}
