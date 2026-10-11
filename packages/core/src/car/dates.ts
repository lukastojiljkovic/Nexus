/**
 * The bare-day (`YYYY-MM-DD`) arithmetic CAR runs on: a whole number of days
 * between two local days, and a month step that clamps to the end of a shorter
 * month.
 *
 * **Why these are written here instead of imported.** `@nexus/core`'s
 * professional toolkit has an `addMonths` and two of its packs carry their own
 * copy, but that whole tree sits behind the `./pro/*` subpath on purpose: it is
 * a pack of business calculators the renderer pulls in only where a tool needs
 * it, and CAR's page would be importing a law-office calendar to work out when
 * the oil is due. So this is a fourth small copy, and the duplication is the
 * price of the subpath boundary — the alternative is a shared module that every
 * bundle then carries, which is exactly what that boundary exists to prevent.
 *
 * UTC throughout, never local time: `new Date("2026-03-01")` and a local
 * `getDate()` disagree about what day it is for half the world's timezones, and
 * a service deadline that moves by a day depending on where it is read is worse
 * than one nobody can compute.
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/**
 * The day's number since 1970-01-01, or `null` for anything that is not a real
 * calendar day — `2026-02-30` parses happily into March, which is precisely the
 * corrupt-but-parseable value a service history must refuse.
 */
export function dayNumber(date: string): number | null {
  if (!DAY_PATTERN.test(date)) return null;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const ms = Date.UTC(year, month - 1, day);
  return new Date(ms).toISOString().slice(0, 10) === date ? ms / MS_PER_DAY : null;
}

/** Whole days from `from` to `to`, signed — `null` when either end is not a real day. */
export function daysBetween(from: string, to: string): number | null {
  const start = dayNumber(from);
  const end = dayNumber(to);
  return start === null || end === null ? null : end - start;
}

/** How many days the given month of the given year has — the clamp below needs it. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * `date` advanced by whole months, clamped to the last day of the target month:
 * 31 January plus one month is 28 February, or 29 in a leap year. Clamping is
 * the right rule for an interval whose baseline the user recorded on a month's
 * last day — the due date is the end of that month, not the 3rd of the next,
 * which is what a roll-over would produce.
 */
export function addMonthsClamped(date: string, months: number): string | null {
  const start = dayNumber(date);
  if (start === null) return null;
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));

  const months12 = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(months12 / 12);
  const targetMonth = (months12 % 12) + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));

  return `${String(targetYear).padStart(4, "0")}-${String(targetMonth).padStart(2, "0")}-${String(
    targetDay,
  ).padStart(2, "0")}`;
}
