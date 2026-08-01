/**
 * Pure streak computation for the HABIT module — the module's actual product.
 * Turns a habit's schedule plus the bare "YYYY-MM-DD" days it was satisfied on
 * into current/best streaks. No clock reads: `today` is an explicit bare-date
 * input, `studyStats.ts`'s idiom exactly, and every calculation runs at UTC
 * midnight so a bare date never shifts by a day whatever the host's timezone is.
 *
 * **The streak is GENTLE, in exactly the way STUDY's already is.** `computeStreak`
 * promises „a streak only breaks after a full missed day"; this function restates
 * that one promise for two kinds of period. A `days` habit's period is the DAY,
 * so today's untouched tick does not break the run — the day is not over. A
 * `quota` habit's period is the WEEK, so this week's unmet quota does not break
 * it either — the week is not over. That is the same sentence twice, not a second
 * promise, and there is deliberately nothing else: no freeze, no repair, no
 * „streak insurance". A gentle streak is one that is honest about the period
 * still running; it is not one that can be bought back after it ended.
 *
 * **The week start is a PARAMETER, never a guess.** Which day a week opens on is
 * the device's own preference (`WeekStart`, renderer storage), so a quota's
 * period boundaries are supplied by the caller. Nothing in `@nexus/db` needs it,
 * and nothing there computes a week — a habit's storage holds days, and the week
 * exists only here.
 */

import type { WeekStart } from "../calendar/calendarGrid.js";
import type { HabitSchedule } from "./habitSchedule.js";

const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;

/** Current and best streaks — in DAYS for a `days` habit, in WEEKS for a `quota` one, because those are the periods each one is kept in. */
export interface HabitStreakResult {
  current: number;
  best: number;
}

/** UTC-midnight ms for a bare "YYYY-MM-DD" prefix (mirrors `studyStats.ts`'s `utcDayMs`); `NaN` for anything that is not one, which the `<= today` filter then drops. */
function utcDayMs(dateKey: string): number {
  const [yearPart, monthPart, dayPart] = dateKey.slice(0, 10).split("-");
  return Date.UTC(Number(yearPart), Number(monthPart) - 1, Number(dayPart));
}

/** ISO weekday of a UTC-midnight time: 1 = Monday … 7 = Sunday — `HabitSchedule`'s own numbering. */
function isoWeekday(ms: number): number {
  return ((new Date(ms).getUTCDay() + 6) % DAYS_PER_WEEK) + 1;
}

/** The UTC midnight the containing week opens on, under the DEVICE's first-day preference (`WeekStart` is in `getUTCDay()` terms: 1 = Monday, 0 = Sunday). */
function weekStartMs(ms: number, weekStart: WeekStart): number {
  const offset = (new Date(ms).getUTCDay() - weekStart + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return ms - offset * MS_PER_DAY;
}

/**
 * The satisfied days, deduplicated and with anything after `todayMs` dropped —
 * `computeStreak`'s own posture towards its input: unsorted is fine, repeated is
 * fine, and a day in the future is not a fact about a streak (a malformed key
 * parses to `NaN`, which this same comparison drops, so nothing downstream ever
 * sees one).
 */
function satisfiedMsSet(satisfiedDays: readonly string[], todayMs: number): Set<number> {
  const days = new Set<number>();
  for (const day of satisfiedDays) {
    const ms = utcDayMs(day);
    if (ms <= todayMs) days.add(ms);
  }
  return days;
}

/** The earliest day in a non-empty set, walked rather than spread — `Math.min(...set)` has an argument ceiling, and a decade of daily ticks should not be near a limit nobody documented. */
function earliest(days: ReadonlySet<number>): number {
  let min = Infinity;
  for (const ms of days) min = Math.min(min, ms);
  return min;
}

/**
 * Both streaks over a series of consecutive PERIODS, oldest first, each either
 * satisfied or not. The one place the gentleness lives, which is why both kinds
 * share it: `currentOpen` marks the last period as the one still running, and a
 * running period that is not yet satisfied is SKIPPED rather than counted as a
 * miss — it is not over, so it has broken nothing.
 *
 * `best` is the longest run anywhere in the series; `current` is the run ending
 * at the last CLOSED period, extended by the running one when that is already
 * satisfied. `best` is therefore never below `current`, by construction rather
 * than by a clamp.
 */
function runsOver(periods: readonly boolean[], currentOpen: boolean): HabitStreakResult {
  let best = 0;
  let run = 0;
  for (const satisfied of periods) {
    run = satisfied ? run + 1 : 0;
    best = Math.max(best, run);
  }

  let index = periods.length - 1;
  if (currentOpen && index >= 0 && periods[index] === false) index -= 1;
  let current = 0;
  while (index >= 0 && periods[index] === true) {
    current += 1;
    index -= 1;
  }

  return { current, best };
}

/**
 * A `days` habit's periods: every day the schedule EXPECTS, from the first
 * satisfied day up to `today`, oldest first. Unscheduled days are not in the
 * series at all — they neither extend a streak nor break one, which is what „gym
 * Mon/Wed/Fri" has to mean for the Tuesday in between to cost nothing.
 *
 * The window opens at the first satisfied day rather than at some epoch: before
 * a habit was ever ticked there is no history to have a streak over, and walking
 * back further would only add expected-but-unsatisfied days that were never
 * expected of anybody.
 */
function expectedDayPeriods(
  weekdays: readonly number[],
  days: ReadonlySet<number>,
  todayMs: number,
): boolean[] {
  const expected = new Set(weekdays);
  const periods: boolean[] = [];
  let ms = earliest(days);
  while (ms <= todayMs) {
    if (expected.has(isoWeekday(ms))) periods.push(days.has(ms));
    ms += MS_PER_DAY;
  }
  return periods;
}

/**
 * A `quota` habit's periods: every week from the one holding the first satisfied
 * day through the one holding `today`, oldest first, each satisfied when it holds
 * at least `perWeek` satisfying days. Counted off the deduplicated day set, so
 * two ticks of the same day are one day towards the quota — which is also what
 * the schema guarantees (`UNIQUE (habit_id, entry_date)`), stated again here
 * because this function is handed a list, not a table.
 */
function quotaWeekPeriods(
  perWeek: number,
  days: ReadonlySet<number>,
  todayMs: number,
  weekStart: WeekStart,
): boolean[] {
  const countByWeek = new Map<number, number>();
  for (const ms of days) {
    const key = weekStartMs(ms, weekStart);
    countByWeek.set(key, (countByWeek.get(key) ?? 0) + 1);
  }

  const periods: boolean[] = [];
  const lastWeekMs = weekStartMs(todayMs, weekStart);
  for (
    let weekMs = weekStartMs(earliest(days), weekStart);
    weekMs <= lastWeekMs;
    weekMs += DAYS_PER_WEEK * MS_PER_DAY
  ) {
    periods.push((countByWeek.get(weekMs) ?? 0) >= perWeek);
  }
  return periods;
}

/**
 * The current and best streaks of one habit.
 *
 * `satisfiedDays` are the days that COUNT — for a binary habit every day with an
 * entry, for a targeted one every day whose entry reached the target. Deciding
 * which days those are is the caller's, because the target lives on the habit
 * row and this function is about periods, not values.
 *
 * A habit with nothing satisfied yet has no streak in either sense, and says so
 * with `{ current: 0, best: 0 }` rather than with a period series that would be
 * about days nobody was ever asked for.
 */
export function computeHabitStreak(
  schedule: HabitSchedule,
  satisfiedDays: readonly string[],
  today: string,
  weekStart: WeekStart,
): HabitStreakResult {
  const todayMs = utcDayMs(today);
  const days = satisfiedMsSet(satisfiedDays, todayMs);
  if (days.size === 0) return { current: 0, best: 0 };

  if (schedule.kind === "quota") {
    // The last period is the week `today` falls in, and it is still running —
    // this week's unmet quota leaves the streak standing until Sunday closes it.
    return runsOver(quotaWeekPeriods(schedule.perWeek, days, todayMs, weekStart), true);
  }

  const periods = expectedDayPeriods(schedule.weekdays, days, todayMs);
  // Only OPEN when today is itself an expected day: a day the schedule never
  // asked for is not in the series at all, so there is nothing running to
  // forgive, and the last period in it is a closed one that had to be satisfied.
  const todayIsExpected = schedule.weekdays.includes(isoWeekday(todayMs));
  return runsOver(periods, todayIsExpected);
}
