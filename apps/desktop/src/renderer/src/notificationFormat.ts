/**
 * Pure formatting helpers for the NTF bell/center panel (piece a3): a
 * "HH:MM today, else day + HH:MM" instant label shared by the delivered-at
 * and snoozed-until fields, and the bell's capped unread-count label. Mirrors
 * focusFormat.ts's small-pure-helper-module idiom.
 */
import type { NotificationSource, SnoozePreset } from "../../shared/ipc.js";
import { formatClockTime } from "./timeFormat.js";

/** The seven toggleable NTF sources, in the fixed order every source list/loop uses. */
export const ALL_NOTIFICATION_SOURCES: NotificationSource[] = [
  "document",
  "exam",
  "study-day",
  "event",
  "task",
  "subscription",
  "habit",
];

/**
 * The sources that are always on (NTF-007): recorded by the main process when a
 * security-relevant event actually happens, and exempt from quiet hours and
 * from the appetite alike. They never appear in `NotificationSettings.enabledSources`
 * — there is no preference to read — so the settings list renders them from
 * this list instead, with a locked control and a caption saying why.
 */
export const ALWAYS_ON_NOTIFICATION_SOURCES: NotificationSource[] = ["security"];

/**
 * The four snooze presets, shortest first — the order the center's row offers
 * them and the settings' „Podrazumevano odlaganje“ choice lists them in.
 * Beside `ALL_NOTIFICATION_SOURCES` for the same reason it is: two surfaces
 * render this exact list, and a second copy is how they would drift apart.
 * Mirrors `SNOOZE_PRESETS` in `@nexus/db` (which the renderer never imports)
 * and migration 041's CHECK.
 */
export const SNOOZE_PRESETS: SnoozePreset[] = ["10m", "1h", "tonight", "tomorrow-morning"];

/** Which appetite tier a preset is — the key both its Serbian label and its button identity are read from. */
export type NotificationPresetKey = "minimal" | "normal" | "all";

export interface NotificationPreset {
  key: NotificationPresetKey;
  sources: NotificationSource[];
}

/**
 * NTF-008: minimalno/normalno/sve map onto growing subsets of the seven sources.
 * An event reminder is in every preset, minimalno included — it is the least
 * noisy kind there is, since the user attached it to that one event by hand. A
 * task reminder (ADR-028) joins every tier for exactly the same reason: it
 * exists only because the user set a ladder on that one task by hand. And a
 * SUBSCRIPTION renewal (FIN slice d) is in every tier on the identical
 * argument, sharpened: a subscription reminds only when its own `reminderDays`
 * was set by hand — the shipped value is „bez podsetnika" — so a profile on
 * „minimalno" hears about a charge exactly when it asked to, and about money
 * leaving an account, which is the one thing nobody wants to find out
 * afterwards.
 *
 * A HABIT reminder (slice c) is in every tier too, on that same argument and
 * against the one objection worth answering. The argument first: a habit ships
 * with NO reminder — `reminder_time` is empty until somebody types an hour into
 * it — so the only habit that ever fires is one whose owner named the habit, the
 * schedule AND the minute. Leaving it out of „minimalno" would mean silently
 * ignoring a time the user typed, which is the exact failure „it only fires
 * because the user set it by hand" exists to prevent.
 *
 * The objection: unlike a task's ladder, a habit reminder RECURS — potentially
 * every day — and „minimalno" ought to mean almost nothing. What answers it is
 * that this is the only source in the app that switches itself off: it does not
 * fire on a day the schedule never asked for, and it does not fire once the
 * habit is done (`habitReminderInputs`). So a habit kept is a habit that stops
 * nagging, and the daily case only persists while the user is genuinely not
 * doing the thing they asked to be reminded about.
 *
 * Lives here, beside `ALL_NOTIFICATION_SOURCES`, because two surfaces now write
 * these exact sets: the Settings page's preset row and the one-time appetite
 * dialog (ADR-033). Picking "Normalno" must mean the identical thing in both,
 * and a second copy is precisely how it would stop doing so.
 */
export const NOTIFICATION_PRESETS: NotificationPreset[] = [
  { key: "minimal", sources: ["document", "event", "task", "subscription", "habit"] },
  { key: "normal", sources: ["document", "exam", "event", "task", "subscription", "habit"] },
  {
    key: "all",
    sources: ["document", "exam", "study-day", "event", "task", "subscription", "habit"],
  },
];

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * An instant for display: bare "HH:MM" when it falls on today's local
 * calendar day, "D. mon, HH:MM" otherwise (sr-Latn, mirrors CalendarPage's
 * formatTime). Raw input on an unparseable string.
 */
export function formatNotificationWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = formatClockTime(date);
  if (isSameLocalDay(date, new Date())) return time;
  const day = new Intl.DateTimeFormat("sr-Latn", { day: "numeric", month: "short" }).format(date);
  return `${day}, ${time}`;
}

/** Bell badge text: never shown at zero, capped display at "9+". */
export function bellCountLabel(deliveredCount: number): string | null {
  if (deliveredCount <= 0) return null;
  return deliveredCount > 9 ? "9+" : String(deliveredCount);
}
