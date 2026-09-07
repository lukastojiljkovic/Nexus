/**
 * The HABIT module's device preference (HABIT slice c), stored in `localStorage`
 * on the `financePrefs.ts` / `taskPrefs.ts` recipe: one key, a safe fallback for
 * anything unrecognized, and no IPC.
 *
 * **What this is, and what it deliberately is not.** A habit's reminder lives on
 * the HABIT row (`reminder_time`, migration 055) and nowhere else — that is what
 * the notification source reads, and a second, machine-level „the reminder"
 * would be a fact competing with it. What this key holds is strictly narrower:
 * the hour the „Nova navika" form FILLS IN at the moment the user switches a
 * reminder on.
 *
 * It does NOT turn reminders on. Every habit ships silent — the form's switch
 * starts off whatever this says — and nothing fires until somebody puts a time
 * on a particular habit. That is the difference between a default and a policy,
 * and the reason this preference can exist without changing what the app does to
 * a user who never opens the settings card.
 *
 * It changes no stored row, it is read by one form, and forgetting it changes
 * nothing that already exists — which is exactly what a device preference is,
 * and is why „Navike" earns the „Vrati na podrazumevano" link that a
 * profile-stored card cannot have (SET §5).
 *
 * The default is 20:00 for one honest reason and not a researched one: it is the
 * evening, which is when a day's habits are either done or not, and it is late
 * enough to be a last call rather than an interruption. Nothing here claims it is
 * optimal — a user who disagrees moves it, which is the entire point of the card.
 */
import { clearStoredOverviewOpen } from "./overviewPrefs.js";

const DEFAULT_REMINDER_KEY = "nexus.habits.defaultReminder";

/** The hour a fresh install fills in when a reminder is switched on. */
export const DEFAULT_HABIT_REMINDER_TIME = "20:00";

/**
 * A wall-clock time as the schema spells it (`habits.reminder_time`, migration
 * 055): `HH:MM`, 24-hour, zero-padded. The same shape `HabitStore`'s own
 * `validateReminderTime` enforces — restated rather than imported, because the
 * renderer never imports DB code, exactly as `isCurrencyCode` restates
 * migration 051's.
 */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isReminderTime(value: string): boolean {
  return HH_MM.test(value);
}

export function readStoredDefaultReminder(): string {
  const stored = localStorage.getItem(DEFAULT_REMINDER_KEY);
  return stored !== null && isReminderTime(stored) ? stored : DEFAULT_HABIT_REMINDER_TIME;
}

export function persistDefaultReminder(time: string): void {
  localStorage.setItem(DEFAULT_REMINDER_KEY, time);
}

/** Forgets this card's one key, so the next read opens on 20:00 again — „Navike"'s „Vrati na podrazumevano" (SET §5). */
export function clearStoredHabitPreferences(): void {
  localStorage.removeItem(DEFAULT_REMINDER_KEY);
  clearStoredOverviewOpen("habits");
}
