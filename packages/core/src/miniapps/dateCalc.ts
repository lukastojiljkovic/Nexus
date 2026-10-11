/**
 * The date calculator (mini-apps, stage 1): adding and subtracting days, weeks,
 * months and years, the distance between two dates, and working days in Serbia.
 *
 * Dates are bare `YYYY-MM-DD` keys and all arithmetic runs on whole days, the
 * same convention `calendar/calendarGrid.ts` uses, so nothing here shifts by a
 * day because of the machine's timezone. No clock is read: the page supplies its
 * own today.
 *
 * **Months clamp, they never roll over.** 31 January plus one month is the last
 * day of February — the task states it, and it is also the only rule that makes
 * the two directions agree: `dateDifference` looks for the largest whole years
 * and months that `addToDate` can walk back, so the three numbers it returns
 * always add back up to the second date. (Rolling into March would produce a
 * date that no month arithmetic would ever name.)
 *
 * **Serbia's non-working days, as the law states them.** The "Zakon o državnim i
 * drugim praznicima u Republici Srbiji" ("Službeni glasnik RS", br. 43/2001,
 * 101/2007 i 92/2011), consolidated text:
 * https://www.pravno-informacioni-sistem.rs/SlGlasnikPortal/eli/rep/sgrs/skupstina/zakon/2001/43/1/reg
 * (that portal renders through JavaScript, so the text was read from the
 * publisher's mirror of the same consolidated law) says:
 *
 * - Art. 1 and 1a: the state holidays are Sretenje (15 and 16 February), Nova
 *   godina (1 and 2 January), Praznik rada (1 and 2 May), Dan pobede (9 May) and
 *   Dan primirja u Prvom svetskom ratu (11 November).
 * - Art. 2: the religious holidays are the first day of Božić (7 January) and
 *   the Vaskrs holidays from Good Friday through the second day of Easter.
 * - Art. 3: nothing works on those days "except on Dan pobede, which is
 *   celebrated working" — so 9 May is a holiday but not a day off, and
 *   `serbianHolidays` carries it with `nonWorking: false`.
 * - Art. 3a: if one of the dates when the STATE holidays of the Republic of
 *   Serbia are celebrated falls on a Sunday, the first following working day is
 *   not worked. Two exclusions follow from that wording and are implemented as
 *   written: religious holidays are not named (a Sunday Božić or Vaskrs earns
 *   nothing), and Dan pobede is a state holiday that is worked, so it has no day
 *   off to move. Both hold in the published calendars — 8 January 2024 (the
 *   Monday after Božić fell on a Sunday) and 10 May 2021 (the Monday after Dan
 *   pobede fell on a Sunday) were working days.
 *
 * "The first following working day" is read strictly, which is what the
 * Ministry of Labour's own opinion for 2021 says happened: 2 May 2021 fell on a
 * Sunday, but Monday 3 May was already Vaskrsni ponedeljak, so the second day of
 * Praznik rada moved to Tuesday 4 May — the transfer skips days that were
 * already non-working rather than landing on the first one. Saturday is not such
 * a day: the law names only Sunday and the holidays, so the first day of
 * Praznik rada on a Saturday is not moved and earns nothing.
 *
 * Orthodox Easter is the Julian computus (Meeus, Astronomical Algorithms, 2nd
 * ed., ch. 8) converted to the Gregorian calendar by counting days in the Julian
 * calendar rather than by adding a constant 13, so it stays right either side of
 * 2100.
 */

import { civilFromDays, daysFromCivil, daysInMonth } from "../devtools/datetime.js";

export const SERBIAN_HOLIDAY_IDS = [
  "nova-godina",
  "bozic",
  "sretenje",
  "vaskrs",
  "praznik-rada",
  "dan-pobede",
  "dan-primirja",
] as const;

/** Stable ids; stage 2 maps each to its own copy in Serbian and English. */
export type SerbianHolidayId = (typeof SERBIAN_HOLIDAY_IDS)[number];

export interface SerbianHoliday {
  readonly id: SerbianHolidayId;
  readonly kind: "state" | "religious";
  /** Every date the holiday covers this year, in order. */
  readonly dates: readonly string[];
  /** False only for Dan pobede, the holiday the law says is celebrated working. */
  readonly nonWorking: boolean;
}

export interface DateUnits {
  readonly years?: number;
  readonly months?: number;
  readonly weeks?: number;
  readonly days?: number;
}

export interface DateDifference {
  /** Whole days from the first date to the second; negative when the second is earlier. */
  readonly totalDays: number;
  /** Calendar difference, largest unit first. */
  readonly years: number;
  readonly months: number;
  readonly days: number;
}

/** The largest unit any function here accepts, in either direction. */
const MAX_UNITS = 100_000;

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** A date on the calendar, as the day count the rest of the file works in. */
function dayNumberOf(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) throw new RangeError(`not a YYYY-MM-DD date: ${date}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) throw new RangeError(`no month ${month} in ${date}`);
  if (day < 1 || day > daysInMonth(year, month)) throw new RangeError(`no day ${day} in ${date}`);
  return daysFromCivil(year, month, day);
}

/** A day count as the bare date it names. */
function dateOfDayNumber(days: number): string {
  const { year, month, day } = civilFromDays(days);
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * The ISO weekday of a date: 1 Monday through 7 Sunday, the convention
 * `devtools/datetime.ts`'s `isoWeekday` uses. Day 0 of the Unix epoch,
 * 1970-01-01, was a Thursday — ISO weekday 4 — and the second modulo keeps the
 * answer right before 1970, where `%` in JavaScript is a remainder.
 */
export function weekdayOf(date: string): number {
  return ((((dayNumberOf(date) + 3) % 7) + 7) % 7) + 1;
}

function assertUnits(units: DateUnits): void {
  for (const value of [units.years, units.months, units.weeks, units.days]) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || Math.abs(value) > MAX_UNITS) {
      throw new RangeError(`a unit must be a whole number of at most ${MAX_UNITS}`);
    }
  }
}

/**
 * The date this many years, months, weeks and days away — applied in that order,
 * which is the order `dateDifference` reverses. A month shift with no such day
 * lands on that month's last day.
 */
export function addToDate(date: string, units: DateUnits): string {
  assertUnits(units);
  const { year, month, day } = civilFromDays(dayNumberOf(date));

  let shiftedYear = year + (units.years ?? 0);
  let shiftedMonth = month + (units.months ?? 0);
  while (shiftedMonth > 12) {
    shiftedMonth -= 12;
    shiftedYear += 1;
  }
  while (shiftedMonth < 1) {
    shiftedMonth += 12;
    shiftedYear -= 1;
  }
  if (shiftedYear < 1 || shiftedYear > 9999) throw new RangeError("the result leaves the calendar");

  const clampedDay = Math.min(day, daysInMonth(shiftedYear, shiftedMonth));
  const days = daysFromCivil(shiftedYear, shiftedMonth, clampedDay);
  return dateOfDayNumber(days + (units.weeks ?? 0) * 7 + (units.days ?? 0));
}

/**
 * The distance between two dates: the whole days, and the calendar difference as
 * the largest whole years, then the largest whole months, then the days left —
 * each measured with `addToDate`, so adding the three back to the first date
 * lands exactly on the second.
 */
export function dateDifference(from: string, to: string): DateDifference {
  const fromDays = dayNumberOf(from);
  const toDays = dayNumberOf(to);
  const forwards = toDays >= fromDays;
  const start = forwards ? from : to;
  const end = forwards ? to : from;

  let years = 0;
  while (addToDate(start, { years: years + 1 }) <= end) years += 1;
  let months = 0;
  while (addToDate(start, { years, months: months + 1 }) <= end) months += 1;
  const days = dayNumberOf(end) - dayNumberOf(addToDate(start, { years, months }));

  // `0` and not `-0`, so a "same month, same day" answer is the zero a caller
  // compares against rather than a negative zero that is equal to it but not
  // identical to it.
  const signed = (value: number): number => (forwards || value === 0 ? value : -value);
  return {
    totalDays: toDays - fromDays,
    years: signed(years),
    months: signed(months),
    days: signed(days),
  };
}

/**
 * The day count of a date in the JULIAN calendar, from the Unix epoch.
 *
 * The offset is calibrated on a date whose Julian and Gregorian positions are
 * both known: Julian 1969-12-19 is Gregorian 1970-01-01 (the Julian calendar ran
 * thirteen days behind in the 20th century), so it must come out as day 0.
 * Checked against two more: Julian 2000-01-01 is Gregorian 2000-01-14, day
 * 10970, and Julian 2026-03-30 is Gregorian 2026-04-12, day 20555.
 */
const JULIAN_EPOCH_DAYS = 719_470;

function julianDayNumberOf(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(shiftedYear / 4);
  const yearOfEra = shiftedYear - era * 4;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return era * 1461 + yearOfEra * 365 + dayOfYear - JULIAN_EPOCH_DAYS;
}

/** The Gregorian date of Orthodox Easter, which the Orthodox churches keep on the Julian calendar. */
export function orthodoxEaster(year: number): string {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new RangeError("a year is a whole number from 1 to 9999");
  }
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return dateOfDayNumber(julianDayNumberOf(year, month, day));
}

function civil(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Every holiday of a year, in calendar order, with the days each one covers. */
export function serbianHolidays(year: number): SerbianHoliday[] {
  const easter = dayNumberOf(orthodoxEaster(year));
  return [
    {
      id: "nova-godina",
      kind: "state",
      dates: [civil(year, 1, 1), civil(year, 1, 2)],
      nonWorking: true,
    },
    { id: "bozic", kind: "religious", dates: [civil(year, 1, 7)], nonWorking: true },
    {
      id: "sretenje",
      kind: "state",
      dates: [civil(year, 2, 15), civil(year, 2, 16)],
      nonWorking: true,
    },
    {
      id: "vaskrs",
      kind: "religious",
      dates: [-2, -1, 0, 1].map((offset) => dateOfDayNumber(easter + offset)),
      nonWorking: true,
    },
    {
      id: "praznik-rada",
      kind: "state",
      dates: [civil(year, 5, 1), civil(year, 5, 2)],
      nonWorking: true,
    },
    { id: "dan-pobede", kind: "state", dates: [civil(year, 5, 9)], nonWorking: false },
    { id: "dan-primirja", kind: "state", dates: [civil(year, 11, 11)], nonWorking: true },
  ];
}

/** A year's non-working days as a set, built once: computing them is a few calendar walks, not a query. */
const NON_WORKING_CACHE = new Map<number, Set<string>>();

function nonWorkingSet(year: number): ReadonlySet<string> {
  const cached = NON_WORKING_CACHE.get(year);
  if (cached !== undefined) return cached;

  const holidays = serbianHolidays(year);
  const days = new Set(
    holidays.filter((holiday) => holiday.nonWorking).flatMap((holiday) => [...holiday.dates]),
  );
  const substitutable = holidays
    .filter((holiday) => holiday.kind === "state" && holiday.nonWorking)
    .flatMap((holiday) => [...holiday.dates]);

  for (const date of substitutable) {
    if (weekdayOf(date) !== 7) continue;
    let candidate = dayNumberOf(date) + 1;
    while (weekdayOf(dateOfDayNumber(candidate)) === 7 || days.has(dateOfDayNumber(candidate))) {
      candidate += 1;
    }
    days.add(dateOfDayNumber(candidate));
  }

  NON_WORKING_CACHE.set(year, days);
  return days;
}

/**
 * Every date of a year that is not worked, in order: the state and religious
 * holidays except Dan pobede, plus the substitute day Art. 3a grants when a
 * STATE holiday's date falls on a Sunday. The substitute is the first following
 * day that is neither a Sunday nor already a holiday, which is why Sretenje on
 * Sunday 15 February 2026 moved the day off to Tuesday the 17th — the 16th is
 * already a holiday.
 *
 * Saturday is a working day to this rule, as it is to the law: only Sunday and a
 * holiday are named.
 */
export function serbianNonWorkingDays(year: number): string[] {
  return [...nonWorkingSet(year)].sort();
}

/** True for a Serbian holiday date that is not worked, substitute days included — not for weekends. */
export function isSerbianHoliday(date: string): boolean {
  return nonWorkingSet(civilFromDays(dayNumberOf(date)).year).has(date);
}

/**
 * The working days in `[from, to)`: weekends and the non-working holidays above
 * are skipped, and the window is half-open so two adjacent windows join without
 * counting a day twice. A reversed window counts the same days and answers a
 * negative number, so a page whose two date fields are filled in either order
 * stays honest.
 */
export function workdaysBetween(from: string, to: string): number {
  const fromDays = dayNumberOf(from);
  const toDays = dayNumberOf(to);
  const forwards = toDays >= fromDays;
  const start = forwards ? fromDays : toDays;
  const end = forwards ? toDays : fromDays;

  let workdays = 0;
  for (let day = start; day < end; day += 1) {
    const date = dateOfDayNumber(day);
    const weekday = weekdayOf(date);
    if (weekday === 6 || weekday === 7) continue;
    if (nonWorkingSet(Number(date.slice(0, 4))).has(date)) continue;
    workdays += 1;
  }
  return forwards ? workdays : -workdays;
}
