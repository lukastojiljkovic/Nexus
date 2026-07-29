/**
 * Birthday/anniversary expansion for CAL-007 (ADR-026) — pure, platform-free,
 * and deliberately NOT the recurrence engine.
 *
 * A person's date is a recurring *fact* with no year attached, and it recurs
 * forever: there is no `until`, no `count`, and no way to end it short of
 * deleting the person. That alone would fit `recurrence.ts`'s `yearly` rule,
 * but one case makes the two genuinely different. A yearly series anchored on
 * 29 February fires only in leap years — correct for an event (a meeting on
 * the 29th simply does not happen in 2027) and wrong for a person (someone
 * born on the 29th has a birthday every year, and the household celebrates it
 * on the 28th). So this module clamps rather than skips, and stays its own
 * thing rather than adding a person-shaped exception to a rule engine events
 * depend on.
 *
 * Both functions are kind-agnostic: a birthday and an anniversary recur by the
 * same arithmetic, and `ageAtOccurrence` reads as "years since" for either.
 * `kind` rides along on the input because every caller renders it.
 */

import { dayKeyToUtcMs, isValidDayKey, type DayKey } from "./calendarGrid.js";

/** The minimum a person must carry for their dates to be expanded — a structural subset of `@nexus/db`'s `Person` row. */
export interface BirthdayPerson {
  readonly id: string;
  readonly kind: "birthday" | "anniversary";
  /** 1-12. */
  readonly month: number;
  /** 1-31, and a real day of `month` in some year — 29 February is allowed. */
  readonly day: number;
  /** The year the person was born / the anniversary began, or null when unknown. */
  readonly year: number | null;
}

/**
 * One bare date per year of the closed range `[from, to]` on which this
 * person's (month, day) falls, ascending. A 29 February person celebrates on
 * 28 February in non-leap years (see the module comment): they have a
 * birthday EVERY year, never a gap.
 *
 * Trusts its inputs the way the grid engine does — the range keys are
 * validated (TypeError on anything that is not a real calendar day), the
 * person's own (month, day) is not, because `PeopleStore` and
 * `parseImportArchive` are the two gates every stored person passes through.
 */
export function birthdayOccurrencesInRange(
  person: BirthdayPerson,
  range: { from: DayKey; to: DayKey },
): DayKey[] {
  // Validation only — the comparisons below are lexicographic, which IS
  // chronological for fixed-width day keys.
  dayKeyToUtcMs(range.from);
  dayKeyToUtcMs(range.to);
  if (range.to < range.from) return [];

  const firstYear = Number(range.from.slice(0, 4));
  const lastYear = Number(range.to.slice(0, 4));

  const occurrences: DayKey[] = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    const key = celebrationDayKey(person, year);
    if (key >= range.from && key <= range.to) occurrences.push(key);
  }
  return occurrences;
}

/**
 * How many years this occurrence marks — `occurrenceYear - year` — or null
 * when the birth year is unknown. Never negative: a mistyped future year
 * would otherwise render as "-3 godine", so an occurrence that precedes the
 * birth year reports nothing at all rather than nonsense.
 */
export function ageAtOccurrence(person: BirthdayPerson, occurrenceDate: DayKey): number | null {
  if (!isValidDayKey(occurrenceDate)) {
    throw new TypeError(`Invalid day key: "${occurrenceDate}"`);
  }
  if (person.year === null) return null;
  const age = Number(occurrenceDate.slice(0, 4)) - person.year;
  return age < 0 ? null : age;
}

/**
 * The day this person is celebrated on in `year`. Only 29 February clamps, and
 * only to the 28th of the same month: every other (month, day) either exists
 * in every year or was refused at the store boundary, so a generic "clamp to
 * the last day of the month" rule would silently repair corrupt data instead
 * of surfacing it.
 */
function celebrationDayKey(person: BirthdayPerson, year: number): DayKey {
  const isLeapDay = person.month === 2 && person.day === 29;
  const day = isLeapDay && !isValidDayKey(`${pad(year, 4)}-02-29`) ? 28 : person.day;
  return `${pad(year, 4)}-${pad(person.month, 2)}-${pad(day, 2)}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
