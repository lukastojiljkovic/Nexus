/**
 * Pure formatting helpers for the NTF bell/center panel (piece a3): a
 * "HH:MM today, else day + HH:MM" instant label shared by the delivered-at
 * and snoozed-until fields, and the bell's capped unread-count label. Mirrors
 * focusFormat.ts's small-pure-helper-module idiom.
 */
import type { NotificationSource } from "../../shared/ipc.js";

/** The three NTF sources, in the fixed order every source list/loop uses. */
export const ALL_NOTIFICATION_SOURCES: NotificationSource[] = ["document", "exam", "study-day"];

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
