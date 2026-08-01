import type { WeekStart } from "@nexus/core";

import type { Habit, HabitEntry } from "../../shared/ipc.js";

/**
 * What „urađeno" means for a habit, in ONE place.
 *
 * `computeHabitStreak`'s doc comment hands this derivation to its caller on
 * purpose: the target lives on the habit row and the engine is about periods,
 * not values. That leaves the renderer holding a rule three separate surfaces
 * need — the „Danas" ticks, the history grid, and the streak pair — and three
 * inline copies of it is exactly how they stop agreeing. A day counts when the
 * habit is BINARY and has an entry at all, or when a MEASURED one's entry
 * reaches its target; everything below is that sentence applied to a day, a
 * week, or a window.
 *
 * Every calculation runs at UTC midnight over bare „YYYY-MM-DD" keys, the idiom
 * `habitStreak.ts` and `examDates.ts` already share, so a bare date never shifts
 * by a day whatever the host's timezone is.
 *
 * **`today` and `weekStart` are always PARAMETERS.** Nothing here reads a clock
 * or a preference: which day it is comes from the page (and, for a write, from
 * main), and which day a week opens on is the device's own setting — the very
 * reason the streak engine takes it rather than guessing it.
 */

const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;

/** How many days back the completion figure looks. Thirty: long enough to be a habit's shape, short enough to still be about now. */
export const HABIT_WINDOW_DAYS = 30;

/** How the history grid draws one cell. */
export type HabitDayState =
  /** The day counted. */
  | "satisfied"
  /** The schedule asked for this day, the day is over, and nothing was recorded. */
  | "missed"
  /** The schedule never asked for this day — it neither extends a streak nor breaks one. */
  | "unexpected"
  /**
   * There is no verdict to draw: the day is before the habit existed, after
   * today, or IS today and not yet satisfied. The last of those is the streak
   * engine's own gentleness restated for a cell — an open period that is not
   * satisfied is skipped rather than counted as a miss, because it is not over.
   */
  | "unjudged";

/** Each habit's ticks, by day — built once from the flat range read. */
export type HabitEntryIndex = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** A quota habit's progress through the week `today` falls in. */
export interface HabitQuotaProgress {
  done: number;
  perWeek: number;
}

/**
 * The completion figure over the last `HABIT_WINDOW_DAYS`. Stated in the unit
 * the habit is KEPT in — days for a `days` habit, weeks for a `quota` one — and
 * always as a fraction of what the schedule actually expected, never as a
 * percentage of something unmeasured.
 */
export interface HabitWindowScore {
  kind: "days" | "weeks";
  done: number;
  expected: number;
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

/** The UTC midnight the containing week opens on, under the DEVICE's first-day preference (`WeekStart` is in `getUTCDay()` terms: 1 = Monday, 0 = Sunday). */
export function weekStartKey(day: string, weekStart: WeekStart): string {
  const ms = utcDayMs(day);
  const offset = (new Date(ms).getUTCDay() - weekStart + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return dayKey(ms - offset * MS_PER_DAY);
}

/** The bare day key `days` after `day` (negative shifts back). */
export function shiftDay(day: string, days: number): string {
  return dayKey(utcDayMs(day) + days * MS_PER_DAY);
}

/**
 * The day a habit's history opens on: the bare day of its `createdAt`. Nothing
 * before it is judged — a habit made on Wednesday must not show eleven weeks of
 * misses behind it, which is the one way a history grid could accuse somebody of
 * failing at something they had not started.
 */
export function habitStartDay(habit: Habit): string {
  return habit.createdAt.slice(0, 10);
}

/**
 * THE rule. `value` is 0 when the day has no entry at all, which is why a binary
 * habit reads `> 0` rather than „an entry exists": the two say the same thing
 * and only one of them needs the caller to hold the entry.
 */
export function countsAsDone(target: number | null, value: number): boolean {
  return target === null ? value > 0 : value >= target;
}

/**
 * The flat `habits:entries` answer, grouped by habit and day. One pass, so the
 * page never walks the whole list per habit — the same reason the read is one
 * call rather than one per habit.
 */
export function indexHabitEntries(entries: readonly HabitEntry[]): HabitEntryIndex {
  const index = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    let days = index.get(entry.habitId);
    if (days === undefined) {
      days = new Map<string, number>();
      index.set(entry.habitId, days);
    }
    days.set(entry.date, entry.value);
  }
  return index;
}

/** What was recorded for one habit on one day — 0 when nothing was, which every rule here treats as „not done". */
export function valueOn(index: HabitEntryIndex, habitId: string, day: string): number {
  return index.get(habitId)?.get(day) ?? 0;
}

/** True when the habit's schedule asks for this particular day. A quota asks for no day in particular, and says so. */
function expectsDay(habit: Habit, day: string): boolean {
  return (
    habit.schedule.kind === "days" && habit.schedule.weekdays.includes(isoWeekday(utcDayMs(day)))
  );
}

/**
 * The days of one habit that COUNT, ascending — `computeHabitStreak`'s
 * `satisfiedDays` input, built from the one derivation above so the streak and
 * the grid can never disagree about what „done" means.
 *
 * Deliberately unfiltered by schedule: a tick on a day the schedule did not ask
 * for is still a day that was done, and the engine drops it from a `days`
 * habit's series itself while counting it towards a `quota`.
 */
export function satisfiedDaysOf(habit: Habit, index: HabitEntryIndex): string[] {
  const days = index.get(habit.id);
  if (days === undefined) return [];
  const satisfied: string[] = [];
  for (const [day, value] of days) {
    if (countsAsDone(habit.target, value)) satisfied.push(day);
  }
  return satisfied.sort();
}

/**
 * One cell per day, in the order the days were handed in — the history grid's
 * whole vocabulary. See `HabitDayState` for what each one means and, in
 * particular, why today is `unjudged` until it is done.
 */
export function habitDayStates(
  habit: Habit,
  index: HabitEntryIndex,
  days: readonly string[],
  today: string,
): HabitDayState[] {
  const start = habitStartDay(habit);
  return days.map((day) => {
    if (countsAsDone(habit.target, valueOn(index, habit.id, day))) return "satisfied";
    if (day < start || day >= today) return "unjudged";
    return expectsDay(habit, day) ? "missed" : "unexpected";
  });
}

/**
 * „2/3 ove nedelje" — how far into its quota a habit is in the week `today`
 * falls in, or null for a habit that keeps no quota. Counts DAYS that count, so
 * a measured habit's half-finished day is not one of them, and the week's
 * boundaries are the device's.
 */
export function quotaWeekProgress(
  habit: Habit,
  index: HabitEntryIndex,
  today: string,
  weekStart: WeekStart,
): HabitQuotaProgress | null {
  if (habit.schedule.kind !== "quota") return null;
  const opens = weekStartKey(today, weekStart);
  let done = 0;
  for (const day of satisfiedDaysOf(habit, index)) {
    if (day >= opens && day < shiftDay(opens, DAYS_PER_WEEK)) done += 1;
  }
  return { done, perWeek: habit.schedule.perWeek };
}

/**
 * The honest 30-day figure: of the periods the schedule EXPECTED inside the
 * window, how many were satisfied.
 *
 * Two rules make it honest rather than flattering, and both are the streak
 * engine's own restated:
 *
 * - a period the habit did not yet exist for was never expected of anybody, so
 *   it is outside both halves of the fraction;
 * - the RUNNING period — today, or this week — is skipped unless it is already
 *   satisfied, because it is not over and a period that is not over has not
 *   been missed.
 *
 * It is a fraction and never a percentage: „11/13 dana" says what was counted,
 * while „85%" invites the reading that something was measured continuously.
 */
export function habitWindowScore(
  habit: Habit,
  index: HabitEntryIndex,
  today: string,
  weekStart: WeekStart,
): HabitWindowScore {
  const from = shiftDay(today, -(HABIT_WINDOW_DAYS - 1));
  const start = habitStartDay(habit);

  if (habit.schedule.kind === "quota") {
    // Every week that OPENS inside the window and on or after the habit's first
    // day; a week the habit only existed for part of would be judged on days
    // nobody was asked for.
    const perWeek = habit.schedule.perWeek;
    const satisfied = satisfiedDaysOf(habit, index);
    const thisWeek = weekStartKey(today, weekStart);
    let done = 0;
    let expected = 0;
    for (
      let opens = weekStartKey(from, weekStart);
      opens <= thisWeek;
      opens = shiftDay(opens, DAYS_PER_WEEK)
    ) {
      if (opens < from || opens < start) continue;
      const closes = shiftDay(opens, DAYS_PER_WEEK);
      const met =
        satisfied.filter((day) => day >= opens && day < closes).length >= perWeek;
      if (!met && opens === thisWeek) continue;
      expected += 1;
      if (met) done += 1;
    }
    return { kind: "weeks", done, expected };
  }

  let done = 0;
  let expected = 0;
  for (let day = from; day <= today; day = shiftDay(day, 1)) {
    if (day < start || !expectsDay(habit, day)) continue;
    const satisfied = countsAsDone(habit.target, valueOn(index, habit.id, day));
    if (!satisfied && day === today) continue;
    expected += 1;
    if (satisfied) done += 1;
  }
  return { kind: "days", done, expected };
}
