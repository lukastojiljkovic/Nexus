import { daySpanKeys, monthKeyOf, shiftDayKey, shiftMonthKey } from "@nexus/core";
import type { CalendarItem, CalendarRange } from "./calendarItems.js";

/**
 * The Semestar view's maths (CAL-010 / ADR-054): the months it covers — the
 * anchored-month-plus-three slide while no term is set, the term's own months
 * when one is — the ONE range they are merged over, and how much each day of
 * that span holds.
 *
 * A semester overview answers one question — "where in the term is the weight?"
 * — so a day here carries a count and an exam mark, never the items themselves.
 * That is also why the merge is a single `buildCalendarItems` call over the
 * whole span rather than four: one pass, one recurrence expansion, one set of
 * birthdays.
 */

/** Months one screen covers while no term is set: the month the calendar is anchored on plus the next three. */
export const SEMESTER_MONTHS = 4;

/**
 * The most mini-months a SET term renders (ADR-054). A real semester is four
 * to six months; a span past six renders its first six and says so in a
 * caption, because eight tracks of 30px days answer no question a term
 * overview asks.
 */
export const TERM_MONTHS_CAP = 6;

/** The four month keys, ascending, starting at `monthKey` — the sliding, no-term shape. */
export function semesterMonthKeys(monthKey: string): string[] {
  return Array.from({ length: SEMESTER_MONTHS }, (_, index) => shiftMonthKey(monthKey, index));
}

/**
 * Every month of a SET term, ascending, from `start`'s month through `end`'s
 * month — both bare day keys, start never after end (the store's own
 * invariant, thrown on here because a caller passing the pair reversed is a
 * bug, not a state). Capped at `TERM_MONTHS_CAP`.
 */
export function termMonthKeys(start: string, end: string): string[] {
  const firstMonth = monthKeyOf(start);
  const lastMonth = monthKeyOf(end);
  if (start > end) {
    throw new TypeError(`termMonthKeys: start "${start}" is after end "${end}".`);
  }
  const span =
    (Number(lastMonth.slice(0, 4)) - Number(firstMonth.slice(0, 4))) * 12 +
    (Number(lastMonth.slice(5, 7)) - Number(firstMonth.slice(5, 7))) +
    1;
  return Array.from({ length: Math.min(span, TERM_MONTHS_CAP) }, (_, index) =>
    shiftMonthKey(firstMonth, index),
  );
}

/**
 * Whether `dayKey` falls inside the closed term. Plain string comparison on
 * purpose: bare day keys order lexicographically AS dates, the same fact
 * migration 042's pair CHECK leans on.
 */
export function isWithinTerm(dayKey: string, start: string, end: string): boolean {
  return dayKey >= start && dayKey <= end;
}

/** A month list as one inclusive day range: the 1st of the first month through the last day of the last. */
export function monthsRange(months: readonly string[]): CalendarRange {
  const first = months[0];
  const last = months.at(-1);
  if (first === undefined || last === undefined) {
    throw new TypeError("monthsRange: at least one month key is required.");
  }
  return {
    from: `${first}-01`,
    // Day 0 of the month after, which is the only definition of "last day"
    // that needs to know nothing about month lengths or leap years.
    to: shiftDayKey(`${shiftMonthKey(last, 1)}-01`, -1),
  };
}

/** The sliding span as one inclusive day range: the 1st of the anchor month through the last day of the fourth. */
export function semesterRange(monthKey: string): CalendarRange {
  return monthsRange(semesterMonthKeys(monthKey));
}

/** What a mini-month draws on one day: how much it holds, and whether any of it is an exam. */
export interface DayDensity {
  readonly count: number;
  readonly hasExam: boolean;
}

/**
 * The three fields a density read needs — deliberately narrower than
 * `CalendarItem`, which every merged item still satisfies: this module has no
 * business knowing what an event, a task or a birthday is.
 */
export interface DensitySource {
  readonly startKey: string;
  readonly endKey: string;
  readonly kind: CalendarItem["kind"];
}

/**
 * Density per day key over the merged stream. A multi-day item counts on every
 * day it covers — a week-long trip weighs on the whole week, which is exactly
 * what a term overview is being scanned for.
 *
 * Muted items (a done task, a missed study block) still count: the question
 * here is how loaded a day was, not how much of it is still outstanding. What
 * a day holds at all is the source chips' business, and they have already been
 * applied by the time the stream reaches this function.
 */
export function buildDayDensity(items: readonly DensitySource[]): Map<string, DayDensity> {
  const density = new Map<string, DayDensity>();
  for (const item of items) {
    for (const key of daySpanKeys(item.startKey, item.endKey)) {
      const current = density.get(key);
      density.set(key, {
        count: (current?.count ?? 0) + 1,
        hasExam: (current?.hasExam ?? false) || item.kind === "exam",
      });
    }
  }
  return density;
}

/**
 * The intensity step a count draws at: nothing, one thing, a couple, a full
 * day. Three steps rather than a continuous scale — at this size the eye reads
 * "something / a few / a lot" and nothing finer, and a fourth shade would be a
 * difference nobody can see.
 */
export function densityLevel(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  return 3;
}
