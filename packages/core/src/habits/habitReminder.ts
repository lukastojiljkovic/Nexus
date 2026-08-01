/**
 * Which habits are worth reminding about TODAY (HABIT slice c) — the filter
 * behind the notification engine's `"habit"` source.
 *
 * It lives here rather than in the desktop scheduler for the reason every other
 * rule in this package does: it is a decision, not a mechanism. Main reads the
 * clock and the two stores; everything below is pure, takes `today` and the
 * week's first day as explicit parameters, and never touches a `Date.now()` —
 * `computeHabitStreak`'s own posture, restated for the one question the streak
 * engine cannot be asked.
 *
 * **Two rules decide it, and both are load-bearing.**
 *
 * - It fires only on a day the schedule EXPECTS. A `days` habit is expected on
 *   its own weekdays and on no others. A `quota` habit is expected EVERY day
 *   until its week's quota is met — any day counts towards a quota, so any day
 *   is a day you could do it — and on no day afterwards: the week is finished,
 *   and a nudge then would be nagging somebody about something they have already
 *   achieved.
 * - It does not fire if the habit is already satisfied today. A reminder to do
 *   what you have done is the fastest way to teach somebody to ignore reminders,
 *   and it is the reason this filter reads the day's ENTRIES rather than only
 *   the schedule.
 *
 * A habit with no `reminderTime` produces nothing, which is every habit as
 * shipped: the field is empty until somebody types a time into it. An ARCHIVED
 * habit produces nothing either — „gotov sam s ovim" means it is no longer
 * expected, and its history staying readable is a different fact. A SOFT-DELETED
 * one never reaches this function at all: `HabitStore.listActive` drops it,
 * exactly as it drops it from every other read.
 */

import type { WeekStart } from "../calendar/calendarGrid.js";
import type { HabitReminderInput } from "../notify/notificationEngine.js";
import { countsAsDone } from "./habitDone.js";
import type { HabitSchedule } from "./habitSchedule.js";

const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;

/**
 * One habit as this filter reads it — the `Habit` row's reminder-relevant fields
 * plus the days it was recorded on, which is what „already done" and „the week's
 * quota" are both answered from.
 *
 * `entries` is a day → value map, exactly the shape a flat range read groups
 * into. It needs to cover the week `today` falls in and nothing more; a caller
 * that hands over more is simply reading days this function never asks about.
 */
export interface HabitReminderSource {
  id: string;
  /** Wall-clock "HH:MM", or null for a habit that reminds about nothing (the shipped state). */
  reminderTime: string | null;
  schedule: HabitSchedule;
  /** Whole units a day must reach to count, or null for a binary habit. */
  target: number | null;
  /** When the user finished with this habit, or null while it is current. */
  archivedAt: string | null;
  /** What was recorded, by bare "YYYY-MM-DD" day. An absent day is 0, which is „nothing recorded". */
  entries: ReadonlyMap<string, number>;
}

/** UTC-midnight ms for a bare "YYYY-MM-DD" prefix (mirrors `habitStreak.ts`'s own). */
function utcDayMs(dateKey: string): number {
  const [yearPart, monthPart, dayPart] = dateKey.slice(0, 10).split("-");
  return Date.UTC(Number(yearPart), Number(monthPart) - 1, Number(dayPart));
}

/** The bare day key for a UTC-midnight time. */
function dayKey(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

/** ISO weekday of a UTC-midnight time: 1 = Monday … 7 = Sunday — `HabitSchedule`'s own numbering. */
function isoWeekday(ms: number): number {
  return ((new Date(ms).getUTCDay() + 6) % DAYS_PER_WEEK) + 1;
}

/**
 * How many days of the week `today` falls in already COUNT. The week's
 * boundaries come from `weekStart` and are never guessed, which is the whole
 * reason `computeHabitStreak` takes the same parameter.
 */
function satisfiedThisWeek(habit: HabitReminderSource, today: string, weekStart: WeekStart): number {
  const todayMs = utcDayMs(today);
  const offset = (new Date(todayMs).getUTCDay() - weekStart + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const opens = todayMs - offset * MS_PER_DAY;
  let done = 0;
  for (let index = 0; index < DAYS_PER_WEEK; index += 1) {
    const day = dayKey(opens + index * MS_PER_DAY);
    if (countsAsDone(habit.target, habit.entries.get(day) ?? 0)) done += 1;
  }
  return done;
}

/** Whether the schedule asks for this habit today — see the file header for both halves. */
function expectedToday(habit: HabitReminderSource, today: string, weekStart: WeekStart): boolean {
  if (habit.schedule.kind === "quota") {
    return satisfiedThisWeek(habit, today, weekStart) < habit.schedule.perWeek;
  }
  return habit.schedule.weekdays.includes(isoWeekday(utcDayMs(today)));
}

/**
 * The habits that should remind today, in the order they were handed in —
 * `subscriptionReminderInputs`' contract, restated: the ENGINE is told what is
 * due and never why, so every reason a reminder is withheld is decided (and
 * tested) exactly once, here.
 */
export function habitReminderInputs(
  habits: readonly HabitReminderSource[],
  today: string,
  weekStart: WeekStart,
): HabitReminderInput[] {
  const rows: HabitReminderInput[] = [];
  for (const habit of habits) {
    const reminderTime = habit.reminderTime;
    if (reminderTime === null || habit.archivedAt !== null) continue;
    if (countsAsDone(habit.target, habit.entries.get(today) ?? 0)) continue;
    if (!expectedToday(habit, today, weekStart)) continue;
    rows.push({ id: habit.id, reminderTime });
  }
  return rows;
}
