/**
 * HABIT's counted-noun phrasing — the `focusFormat.ts` / `notificationFormat.ts`
 * idiom: a small pure module holding the copy decisions two surfaces both make.
 *
 * There is exactly one decision in here and it is a Serbian one: a streak is
 * counted in the PERIOD the habit is kept in — days for a `days` habit, weeks
 * for a `quota` one, which is what `HabitStreakResult` already says — and the
 * two nouns do not inflect alike. „Dan" takes two forms and „nedelja" takes
 * three, so they go through the house's two different agreement helpers rather
 * than through one that would be wrong for half the numbers.
 *
 * It lives beside the page rather than inside it since slice c, when „Navike
 * danas" started drawing the same niz on the dashboard. A chip reading „Niz: 3"
 * on one screen and „Niz: 3 nedelje" on the other would be the same fact told
 * two ways, and the shorter one is genuinely ambiguous: three WHAT is exactly
 * the thing a quota habit's reader cannot guess.
 */

import { countUnit, dayUnit, strings } from "./strings.js";

/** „12 nedelja" — three forms (1 / 2–4 / 5+), which „nedelja" genuinely needs. */
export function habitWeekPhrase(count: number): string {
  const s = strings.habits.detail;
  return `${count} ${countUnit(count, s.weekUnitOne, s.weekUnitFew, s.weekUnitMany)}`;
}

/** „30 dana" — two forms are enough here, exactly as `dayUnit`'s own comment has it. */
export function habitDayPhrase(count: number): string {
  const s = strings.habits.detail;
  return `${count} ${dayUnit(count, s.dayUnitOne, s.dayUnitMany)}`;
}

/** A streak, in the period its habit is KEPT in — the one place that mapping is made. */
export function habitPeriodPhrase(count: number, kind: "days" | "quota"): string {
  return kind === "quota" ? habitWeekPhrase(count) : habitDayPhrase(count);
}
