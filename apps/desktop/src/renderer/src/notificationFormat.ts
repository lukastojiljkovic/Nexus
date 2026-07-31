/**
 * Pure formatting helpers for the NTF bell/center panel (piece a3): a
 * "HH:MM today, else day + HH:MM" instant label shared by the delivered-at
 * and snoozed-until fields, and the bell's capped unread-count label. Mirrors
 * focusFormat.ts's small-pure-helper-module idiom.
 */
import type { NotificationSource } from "../../shared/ipc.js";

/** The five toggleable NTF sources, in the fixed order every source list/loop uses. */
export const ALL_NOTIFICATION_SOURCES: NotificationSource[] = [
  "document",
  "exam",
  "study-day",
  "event",
  "task",
];

/**
 * The sources that are always on (NTF-007): recorded by the main process when a
 * security-relevant event actually happens, and exempt from quiet hours and
 * from the appetite alike. They never appear in `NotificationSettings.enabledSources`
 * — there is no preference to read — so the settings list renders them from
 * this list instead, with a locked control and a caption saying why.
 */
export const ALWAYS_ON_NOTIFICATION_SOURCES: NotificationSource[] = ["security"];

/** Which appetite tier a preset is — the key both its Serbian label and its button identity are read from. */
export type NotificationPresetKey = "minimal" | "normal" | "all";

export interface NotificationPreset {
  key: NotificationPresetKey;
  sources: NotificationSource[];
}

/**
 * NTF-008: minimalno/normalno/sve map onto growing subsets of the five sources.
 * An event reminder is in every preset, minimalno included — it is the least
 * noisy kind there is, since the user attached it to that one event by hand. A
 * task reminder (ADR-028) joins every tier for exactly the same reason: it
 * exists only because the user set a ladder on that one task by hand.
 *
 * Lives here, beside `ALL_NOTIFICATION_SOURCES`, because two surfaces now write
 * these exact sets: the Settings page's preset row and the one-time appetite
 * dialog (ADR-033). Picking "Normalno" must mean the identical thing in both,
 * and a second copy is precisely how it would stop doing so.
 */
export const NOTIFICATION_PRESETS: NotificationPreset[] = [
  { key: "minimal", sources: ["document", "event", "task"] },
  { key: "normal", sources: ["document", "exam", "event", "task"] },
  { key: "all", sources: ["document", "exam", "study-day", "event", "task"] },
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
  const time = new Intl.DateTimeFormat("sr-Latn", { hour: "2-digit", minute: "2-digit" }).format(
    date,
  );
  if (isSameLocalDay(date, new Date())) return time;
  const day = new Intl.DateTimeFormat("sr-Latn", { day: "numeric", month: "short" }).format(date);
  return `${day}, ${time}`;
}

/** Bell badge text: never shown at zero, capped display at "9+". */
export function bellCountLabel(deliveredCount: number): string | null {
  if (deliveredCount <= 0) return null;
  return deliveredCount > 9 ? "9+" : String(deliveredCount);
}
