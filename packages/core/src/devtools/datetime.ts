/**
 * The two developer clocks in UTIL's drawer: one INSTANT spelled every way it
 * gets spelled, and one CRONTAB read out loud and run forward.
 *
 * **Nothing here reads the wall clock.** There is no `Date.now()` and no
 * `new Date()` without an argument anywhere in this module, and „now" is a
 * parameter on every function that needs one. A converter whose answer depends
 * on when it was asked cannot be tested exactly, and this one is asked things
 * („is this timestamp the one in the log line?") where being off by an hour is
 * the whole question. The same discipline is why the ISO parser is hand-rolled
 * rather than handed to `Date.parse`: the spec leaves `Date.parse` behaviour
 * implementation-defined for everything outside the ISO grammar and — worse —
 * reads a date-time WITHOUT an offset in the HOST's timezone while reading a
 * date-only string as UTC. That single inconsistency is the most common way a
 * timestamp tool is wrong, so this module never asks the host what zone it is
 * in; a zone is always something the caller named.
 *
 * **Precision is carried, never quietly dropped.** An instant is milliseconds
 * plus a nanosecond remainder, and the numeric epoch parser works in `BigInt`.
 * That is not decoration: a nanosecond timestamp of the present needs 19 digits
 * and the gap between neighbouring doubles up there is 256, so a `Number`-based
 * implementation silently rewrites the last three digits of the value the user
 * pasted in. Refusing to lose them costs one `BigInt` and buys the property
 * that pasting a value in and reading it back gives the same text.
 *
 * **The magnitude ladder is a stated rule, not a hunch.** A bare number could be
 * seconds, milliseconds, microseconds or nanoseconds, and this module picks by
 * the DIGIT COUNT of the integer part — see `guessEpochUnit`, which writes the
 * rule down and is tested at every boundary. It deliberately does NOT guess
 * FILETIME or .NET ticks: a modern FILETIME has 18 digits and so does a modern
 * nanosecond epoch, so nothing in the number separates them and the tool asks
 * instead of being wrong half the time.
 *
 * **Serbian copy lives here rather than in `strings.ts`, on purpose.** The
 * relative form („pre 3 dana") and the cron explanation need plural arithmetic
 * and case selection driven by numbers a flat strings table cannot see, so the
 * words sit beside the logic that inflects them. `Intl.RelativeTimeFormat` was
 * the obvious alternative and was rejected: its output moves between ICU
 * versions and script tailorings, and these strings are asserted in tests.
 *
 * **The cron half exists for one rule.** In Vixie cron, day-of-month and
 * day-of-week are combined with OR, not AND, whenever neither field is a star —
 * `0 0 13 * 5` fires on every Friday AND on the 13th. Nearly every hand-written
 * cron parser gets this backwards, and the schedule it produces looks plausible
 * for weeks. See `dayMatches` for the exact rule, including the part that is
 * subtler still: Vixie tests the FIRST CHARACTER of the field, so a `*` with a
 * step counts as a star and flips the whole expression back to AND.
 */

// ---------------------------------------------------------------------------
// Integer and calendar arithmetic
// ---------------------------------------------------------------------------

/**
 * Floor division and its non-negative remainder, correct for negative
 * numerators. `Math.floor(a / b)` alone drifts by one at the boundaries once `a`
 * is large, so the quotient is corrected against an exactly-computed remainder.
 */
function floorDivMod(a: number, b: number): { q: number; r: number } {
  let q = Math.floor(a / b);
  let r = a - q * b;
  if (r < 0) {
    q -= 1;
    r += b;
  } else if (r >= b) {
    q += 1;
    r -= b;
  }
  return { q, r };
}

/**
 * Zero-padded to `width` — for NON-NEGATIVE values only. `padStart` pads in
 * front of the whole string, sign included, so `pad(-1, 4)` is „00-1" rather
 * than anything a reader or a parser would accept. Every caller here settles
 * what a negative number means before it gets this far: `formatIso8601` takes
 * the absolute value and writes the sign itself, `formatRfc2822` refuses.
 */
function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** Whether `year` is a leap year in the proleptic Gregorian calendar. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** How many days month `month` (1–12) has in `year`; `0` for a month number outside 1–12. */
export function daysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) return 0;
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return MONTH_LENGTHS[month - 1] ?? 0;
}

/** Which day of the year a date is, 1-based — 1 for 1 January, 366 for 31 December of a leap year. */
export function dayOfYear(year: number, month: number, day: number): number {
  let total = day;
  for (let m = 1; m < month; m += 1) total += daysInMonth(year, m);
  return total;
}

/**
 * Days from 1970-01-01 to a proleptic-Gregorian civil date — Howard Hinnant's
 * `days_from_civil` („chrono-Compatible Low-Level Date Algorithms", 2013,
 * public domain).
 *
 * Written out rather than routed through `Date.UTC` because `Date.UTC` maps
 * years 0–99 onto 1900–1999. A .NET tick value near zero lands squarely in that
 * hole and would come back nineteen centuries late, which is the sort of defect
 * that survives a test suite written against the same mistake. That quirk is
 * `Date.UTC`'s alone, and the distinction matters when looking for a reference
 * to check this against: `new Date(ms).toISOString()` renders the same
 * proleptic Gregorian calendar in the same expanded-year notation and IS a
 * usable independent oracle — the tests sweep the whole timeline against it.
 *
 * **The era is floored exactly once.** Hinnant's original is C++, where integer
 * division TRUNCATES toward zero, and its `(y >= 0 ? y : y - 399) / 400` exists
 * for no other reason than to turn that truncation into flooring. `Math.floor`
 * already floors, so a translation that keeps the bias floors twice: the era
 * comes out one too low for every negative `y` except those congruent to −1
 * modulo 400 — where the bias lands exactly on a boundary and cancels — and the
 * answer is then one day early. Year 1 never takes the branch and year 0's
 * January and February are the cancelling case, which is why the mistranslation
 * looked correct everywhere anyone had thought to check. `civilFromDays` had the
 * same bias, written `- 146096`.
 */
export function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** A civil date, the shape `civilFromDays` answers in. */
export interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * The civil date `days` after 1970-01-01 — Hinnant's `civil_from_days`, the exact
 * inverse of `daysFromCivil`.
 *
 * The era is floored once here too, and for the same reason spelled out in
 * `daysFromCivil`: the `- 146096` of the C++ original is a truncation fix that
 * `Math.floor` makes into a second flooring. It cost a day on every date from
 * 0000-02-28 backwards — bar the one day per era where the bias falls exactly on
 * a boundary and cancels — and the formatter's output for those dates, an
 * impossible „-000002-02-29" among them, is text `parseIso8601` then refuses.
 */
export function civilFromDays(days: number): CivilDate {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp + (mp < 10 ? 3 : -9);
  return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/**
 * The ISO-8601 weekday of a date: 1 = Monday … 7 = Sunday.
 *
 * Anchored on the fact that day 0 of the Unix epoch — 1970-01-01 — was a
 * Thursday, ISO weekday 4, which is what the `+ 3` encodes. The second modulo
 * is what keeps the answer right for dates before 1970, where the day count is
 * negative and `%` in JavaScript is a remainder rather than a modulus.
 */
export function isoWeekday(year: number, month: number, day: number): number {
  return ((((daysFromCivil(year, month, day) + 3) % 7) + 7) % 7) + 1;
}

/** An ISO-8601 week-date: the week-numbering year, the week, and the weekday within it. */
export interface IsoWeekDate {
  /** The WEEK-numbering year, which is not always the calendar year — 2021-01-01 belongs to 2020-W53. */
  readonly year: number;
  /** 1–53. */
  readonly week: number;
  /** 1 = Monday … 7 = Sunday. */
  readonly weekday: number;
}

/**
 * The ISO-8601 week a date falls in.
 *
 * The definition that makes this four lines instead of forty: week 1 is the week
 * containing the first Thursday of January, so the week number of ANY date is
 * decided by the Thursday of its own week. Shift to that Thursday and the week
 * number is its day-of-year divided into sevens — and its calendar year is the
 * week-numbering year, which is how 2021-01-01 correctly comes back as 2020-W53
 * rather than 2021-W01.
 */
export function isoWeek(year: number, month: number, day: number): IsoWeekDate {
  const weekday = isoWeekday(year, month, day);
  const thursday = civilFromDays(daysFromCivil(year, month, day) + (4 - weekday));
  const week = Math.floor((dayOfYear(thursday.year, thursday.month, thursday.day) - 1) / 7) + 1;
  return { year: thursday.year, week, weekday };
}

// ---------------------------------------------------------------------------
// The instant
// ---------------------------------------------------------------------------

/** The lowest instant a JavaScript time value can hold, ECMA-262 §21.4.1.1 — about 271821 BC. */
export const MIN_EPOCH_MS = -8_640_000_000_000_000;

/** The highest instant a JavaScript time value can hold, ECMA-262 §21.4.1.1 — about 275760 AD. */
export const MAX_EPOCH_MS = 8_640_000_000_000_000;

/**
 * One point on the timeline, to the nanosecond.
 *
 * Split into whole milliseconds and a remainder rather than kept as one number
 * because a nanosecond count of the present day needs 19 digits and a double
 * carries about 16 — see the module comment. `epochMs` alone is exactly what
 * every time-value API wants, and it stays an ordinary safe integer.
 */
export interface Instant {
  /** Whole milliseconds since 1970-01-01T00:00:00Z, FLOORED — negative for earlier instants. */
  readonly epochMs: number;
  /** Nanoseconds past `epochMs`, 0–999 999. Never negative, not even before the epoch. */
  readonly subNs: number;
}

/**
 * An instant, or `null` for parts that do not describe one: a non-integer, an
 * `epochMs` outside the representable range, or a `subNs` outside 0–999 999.
 *
 * The floor convention is the point of the guard. Truncating toward zero would
 * let one nanosecond before the epoch be written `{ epochMs: 0, subNs: -1 }` —
 * two spellings of neighbouring instants that no longer compare or subtract
 * correctly. Here there is exactly one spelling of every instant.
 */
export function makeInstant(epochMs: number, subNs = 0): Instant | null {
  if (!Number.isInteger(epochMs) || !Number.isInteger(subNs)) return null;
  if (epochMs < MIN_EPOCH_MS || epochMs > MAX_EPOCH_MS) return null;
  if (subNs < 0 || subNs > 999_999) return null;
  return { epochMs, subNs };
}

/** Negative when `a` is earlier, positive when later, `0` when they are the same instant. */
export function compareInstants(a: Instant, b: Instant): number {
  return a.epochMs === b.epochMs ? a.subNs - b.subNs : a.epochMs - b.epochMs;
}

const NS_PER_MS = 1_000_000n;

/** An instant as one nanosecond count since the epoch — the form the numeric converters work in. */
function instantToNs(instant: Instant): bigint {
  return BigInt(instant.epochMs) * NS_PER_MS + BigInt(instant.subNs);
}

/** A nanosecond count back to an instant, flooring so `subNs` stays non-negative. */
function instantFromNs(totalNs: bigint): Instant | null {
  let ms = totalNs / NS_PER_MS;
  let rest = totalNs - ms * NS_PER_MS;
  if (rest < 0n) {
    ms -= 1n;
    rest += NS_PER_MS;
  }
  if (ms < BigInt(MIN_EPOCH_MS) || ms > BigInt(MAX_EPOCH_MS)) return null;
  return { epochMs: Number(ms), subNs: Number(rest) };
}

// ---------------------------------------------------------------------------
// Numeric epochs
// ---------------------------------------------------------------------------

/** The four Unix ladders a bare number can be counted in. */
export const NUMERIC_EPOCH_UNITS = [
  "seconds",
  "milliseconds",
  "microseconds",
  "nanoseconds",
] as const;

export type NumericEpochUnit = (typeof NUMERIC_EPOCH_UNITS)[number];

/**
 * Every numeric encoding the tool offers. The last two are here because they are
 * exactly the ones nobody converts in their head: Windows FILETIME counts
 * 100-nanosecond intervals from 1601-01-01, .NET ticks count the same intervals
 * from 0001-01-01, and both arrive as an undifferentiated wall of digits.
 */
export const EPOCH_SOURCES = [...NUMERIC_EPOCH_UNITS, "filetime", "ticks"] as const;

export type EpochSource = (typeof EPOCH_SOURCES)[number];

/** How many nanoseconds one tick of each encoding is worth. */
const NS_PER_EPOCH_UNIT: Readonly<Record<EpochSource, bigint>> = {
  seconds: 1_000_000_000n,
  milliseconds: 1_000_000n,
  microseconds: 1_000n,
  nanoseconds: 1n,
  filetime: 100n,
  ticks: 100n,
};

/**
 * Where each encoding's zero sits on the Unix timeline, in nanoseconds.
 *
 * FILETIME: 1601-01-01 to 1970-01-01 is 134 774 days — 369 years of 365 days
 * plus 89 leap days (92 multiples of four, less 1700, 1800 and 1900) — which is
 * 11 644 473 600 seconds.
 *
 * .NET ticks: 0001-01-01 to 1970-01-01 is 719 162 days — 1969 × 365 plus 477
 * leap days (492 − 19 + 4) — which is 62 135 596 800 seconds.
 */
const EPOCH_ORIGIN_NS: Readonly<Record<EpochSource, bigint>> = {
  seconds: 0n,
  milliseconds: 0n,
  microseconds: 0n,
  nanoseconds: 0n,
  filetime: -11_644_473_600_000_000_000n,
  ticks: -62_135_596_800_000_000_000n,
};

/** Sign, integer digits, and at most one fractional group — comma or dot, both the decimal point. */
const DECIMAL_NUMBER = /^([+-]?)(\d+)(?:[.,](\d+))?$/;

/** A hexadecimal count, the form a FILETIME is usually dumped in. */
const HEX_NUMBER = /^0[xX]([0-9a-fA-F]+)$/;

/**
 * Which Unix ladder a bare number is counted in, by the DIGIT COUNT of its
 * integer part; `null` for a number too long to be any of them.
 *
 * **The rule, written down so it can be argued with rather than guessed at.**
 * An instant is assumed to fall between 1973-03-03T09:46:40Z and
 * 5138-11-16T09:46:40Z — the window from 10¹¹ to 10¹⁴ milliseconds after the
 * epoch. Because each rung of the ladder is exactly a thousand times the one
 * below, that single window slices the digit counts cleanly:
 *
 * - up to 11 digits → seconds     (2001-09-09 is 1 000 000 000)
 * - 12 to 14 digits → milliseconds
 * - 15 to 17 digits → microseconds
 * - 18 to 20 digits → nanoseconds
 *
 * Numbers below 10⁸ fall through to seconds, which is what makes `0` the epoch
 * rather than a refusal. A leading sign, leading zeros and any fractional part
 * are ignored — a sub-unit fraction says nothing about which unit was meant.
 *
 * **FILETIME and ticks are deliberately not on this ladder.** A FILETIME of the
 * present has 18 digits and so does a nanosecond epoch of the present; nothing
 * in the number separates them, so the tool asks rather than being wrong half
 * the time.
 */
export function guessEpochUnit(text: string): NumericEpochUnit | null {
  const match = DECIMAL_NUMBER.exec(text.trim());
  if (match === null) return null;
  const digits = (match[2] ?? "").replace(/^0+(?=\d)/, "").length;
  if (digits <= 11) return "seconds";
  if (digits <= 14) return "milliseconds";
  if (digits <= 17) return "microseconds";
  if (digits <= 20) return "nanoseconds";
  return null;
}

/**
 * A numeric timestamp read in the encoding the caller NAMED, or `null` when the
 * text is not a number this grammar admits or the instant lands outside the
 * representable range.
 *
 * Decimal with an optional sign and fraction, or hexadecimal with an `0x`
 * prefix (unsigned, no fraction) — the form Windows tooling prints a FILETIME
 * in. A fraction finer than the encoding's own tick is REFUSED rather than
 * rounded: `1.5` seconds is 1 500 000 000 ns and fine, `1.5` nanoseconds is not
 * a quantity this can hold and saying so beats halving it or doubling it.
 */
export function parseEpochValue(text: string, source: EpochSource): Instant | null {
  const trimmed = text.trim();
  const nsPerUnit = NS_PER_EPOCH_UNIT[source];

  const hex = HEX_NUMBER.exec(trimmed);
  if (hex !== null) {
    return instantFromNs(BigInt(`0x${hex[1] ?? ""}`) * nsPerUnit + EPOCH_ORIGIN_NS[source]);
  }

  const match = DECIMAL_NUMBER.exec(trimmed);
  if (match === null) return null;
  const [, sign = "", whole = "", fraction] = match;

  let magnitudeNs = BigInt(whole) * nsPerUnit;
  if (fraction !== undefined) {
    const scale = 10n ** BigInt(fraction.length);
    const scaled = BigInt(fraction) * nsPerUnit;
    if (scaled % scale !== 0n) return null;
    magnitudeNs += scaled / scale;
  }

  const signed = sign === "-" ? -magnitudeNs : magnitudeNs;
  return instantFromNs(signed + EPOCH_ORIGIN_NS[source]);
}

/**
 * An instant written back out in one of the numeric encodings.
 *
 * Exact, always: when the instant carries more precision than the encoding's own
 * tick — a nanosecond value shown as FILETIME, say — the surplus appears as a
 * decimal fraction instead of being cut off. A truncated FILETIME is a different
 * instant that looks like the one you asked for, which is the failure this whole
 * module is built to avoid.
 */
export function formatEpochValue(instant: Instant, source: EpochSource): string {
  const raw = instantToNs(instant) - EPOCH_ORIGIN_NS[source];
  const nsPerUnit = NS_PER_EPOCH_UNIT[source];
  const negative = raw < 0n;
  const magnitude = negative ? -raw : raw;
  const whole = magnitude / nsPerUnit;
  const rest = magnitude - whole * nsPerUnit;
  const sign = negative ? "-" : "";
  if (rest === 0n) return `${sign}${whole}`;
  const width = String(nsPerUnit).length - 1;
  const fraction = String(rest).padStart(width, "0").replace(/0+$/, "");
  return `${sign}${whole}.${fraction}`;
}

// ---------------------------------------------------------------------------
// Civil breakdown and offsets
// ---------------------------------------------------------------------------

/** An instant broken into the fields a human reads, at some offset from UTC. */
export interface CivilDateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  /** Nanoseconds past the second, 0–999 999 999. */
  readonly nanosecond: number;
}

const MS_PER_DAY = 86_400_000;

/** An instant's civil fields at a given offset east of UTC, in whole minutes. */
export function civilFromInstant(instant: Instant, offsetMinutes = 0): CivilDateTime {
  const local = instant.epochMs + offsetMinutes * 60_000;
  const { q: days, r: msOfDay } = floorDivMod(local, MS_PER_DAY);
  const date = civilFromDays(days);
  const secondOfDay = Math.floor(msOfDay / 1000);
  return {
    year: date.year,
    month: date.month,
    day: date.day,
    hour: Math.floor(secondOfDay / 3600),
    minute: Math.floor(secondOfDay / 60) % 60,
    second: secondOfDay % 60,
    nanosecond: (msOfDay % 1000) * 1_000_000 + instant.subNs,
  };
}

/**
 * A UTC offset as `±HH:MM`. Whole minutes only — every zone offset in force
 * since the 1930s is one, and `zoneOffsetMinutes` refuses to hand back anything
 * else (see there for the pre-standard-time case `±HH:MM` cannot spell).
 */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;
}

// ---------------------------------------------------------------------------
// ISO 8601
// ---------------------------------------------------------------------------

/**
 * The ISO 8601 / RFC 3339 shapes this admits — EXTENDED format only.
 *
 * Basic format (`20260809T120000Z`) is refused on purpose: `20260809` is also a
 * perfectly plausible epoch-seconds figure, and a tool that guessed between two
 * readings of the same eight digits would be silently wrong for whoever meant
 * the other. Refusing sends the user back to say which, which is cheap.
 *
 * Expanded years (`±YYYYYY`) are accepted because the formatter emits them for
 * instants outside 0000–9999, and a formatter whose output its own parser
 * rejects is a broken pair rather than two strict components.
 */
const ISO_8601 =
  /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?(Z|z|[+-]\d{2}(?::?\d{2})?)?)?$/;

/** What a successful parse learned about the text it read. */
export interface ParsedInstant {
  readonly instant: Instant;
  /** Which grammar admitted the text. */
  readonly kind: "epoch" | "iso8601" | "rfc2822";
  /** For `epoch`, the ladder rung `guessEpochUnit` chose; `null` for the other grammars. */
  readonly unit: NumericEpochUnit | null;
  /** The offset the TEXT itself carried, in whole minutes; `null` when it carried none. */
  readonly offsetMinutes: number | null;
}

/** `Z`, `±HH`, `±HHMM` or `±HH:MM` in whole minutes, or `null` when the offset is out of range. */
function parseOffsetToken(token: string): number | null {
  if (token === "Z" || token === "z") return 0;
  const sign = token.startsWith("-") ? -1 : 1;
  const rest = token.slice(1).replace(":", "");
  const hours = Number(rest.slice(0, 2));
  const minutes = rest.length > 2 ? Number(rest.slice(2)) : 0;
  if (hours > 23 || minutes > 59) return null;
  return sign * (hours * 60 + minutes);
}

/**
 * An ISO 8601 date or date-time, or `null`.
 *
 * **A date-time with no offset is read as UTC, and that is a decision.**
 * ECMAScript reads it in the host's zone, which makes the same string mean
 * different instants on two machines — unusable in a tool whose job is to say
 * what a log line meant. UTC is stated, portable and reversible; a caller who
 * knows the zone passes it and gets the offset spelled out.
 *
 * Refused rather than repaired: a day the month does not have (2026-02-30), an
 * hour of 24 (legal ISO for end-of-day, but it would be printed back as the next
 * day's 00:00 and the round trip would silently change the text), a leap second
 * (`:60`, which no representation here can hold), and basic format.
 */
export function parseIso8601(text: string): ParsedInstant | null {
  const match = ISO_8601.exec(text.trim());
  if (match === null) return null;
  const [
    ,
    yearText = "",
    monthText = "",
    dayText = "",
    hourText,
    minuteText,
    secondText,
    fractionText,
    offsetText,
  ] = match;

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;

  const hour = hourText === undefined ? 0 : Number(hourText);
  const minute = minuteText === undefined ? 0 : Number(minuteText);
  const second = secondText === undefined ? 0 : Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) return null;

  const nanosecond = fractionText === undefined ? 0 : Number(fractionText.padEnd(9, "0"));
  const offsetMinutes = offsetText === undefined ? null : parseOffsetToken(offsetText);
  if (offsetText !== undefined && offsetMinutes === null) return null;

  const epochMs =
    (daysFromCivil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second) * 1000 -
    (offsetMinutes ?? 0) * 60_000 +
    Math.floor(nanosecond / 1_000_000);
  const instant = makeInstant(epochMs, nanosecond % 1_000_000);
  if (instant === null) return null;
  return { instant, kind: "iso8601", unit: null, offsetMinutes };
}

/** How many digits of the second `formatIso8601` writes. */
export type IsoFractionDigits = 0 | 3 | 6 | 9 | "auto";

export interface IsoFormatOptions {
  /** Whole minutes east of UTC; `0` (the default) renders as `Z`. */
  readonly offsetMinutes?: number;
  /**
   * `"auto"` (the default) picks the SHORTEST width that loses nothing — no
   * fraction at all for a whole second, otherwise 3, 6 or 9 digits. A fixed
   * width truncates whatever will not fit, which is the caller explicitly
   * choosing to; `"auto"` never does.
   */
  readonly fractionDigits?: IsoFractionDigits;
}

/**
 * An instant as ISO 8601, at a chosen offset.
 *
 * Years outside 0000–9999 come out in the expanded `±YYYYYY` form, matching both
 * what `Date.prototype.toISOString` produces and what `parseIso8601` reads back.
 */
export function formatIso8601(instant: Instant, options: IsoFormatOptions = {}): string {
  const offsetMinutes = options.offsetMinutes ?? 0;
  const civil = civilFromInstant(instant, offsetMinutes);
  const requested = options.fractionDigits ?? "auto";
  const ns = civil.nanosecond;
  const width =
    requested !== "auto"
      ? requested
      : ns === 0
        ? 0
        : ns % 1_000_000 === 0
          ? 3
          : ns % 1_000 === 0
            ? 6
            : 9;

  const year =
    civil.year >= 0 && civil.year <= 9999
      ? pad(civil.year, 4)
      : `${civil.year < 0 ? "-" : "+"}${pad(Math.abs(civil.year), 6)}`;
  const fraction = width === 0 ? "" : `.${pad(ns, 9).slice(0, width)}`;
  const zone = offsetMinutes === 0 ? "Z" : formatOffset(offsetMinutes);

  return (
    `${year}-${pad(civil.month, 2)}-${pad(civil.day, 2)}` +
    `T${pad(civil.hour, 2)}:${pad(civil.minute, 2)}:${pad(civil.second, 2)}${fraction}${zone}`
  );
}

// ---------------------------------------------------------------------------
// RFC 2822
// ---------------------------------------------------------------------------

const RFC_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const RFC_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * The obsolete alphabetic zones RFC 2822 §4.3 still defines, in minutes east of
 * UTC. The single-letter military zones are NOT here: the same section records
 * that they were given the wrong sign in an earlier RFC and instructs receivers
 * to treat them as `-0000`, so admitting them would mean admitting a value the
 * standard itself says is untrustworthy.
 */
const RFC_ZONE_NAMES: Readonly<Record<string, number>> = {
  UT: 0,
  GMT: 0,
  Z: 0,
  EST: -300,
  EDT: -240,
  CST: -360,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
};

const RFC_2822 =
  /^(?:([A-Za-z]{3}),\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+([+-]\d{4}|[A-Za-z]{1,3})$/;

/** Case-insensitive index of a three-letter name in a vocabulary, or `-1`. */
function indexOfName(names: readonly string[], token: string): number {
  const wanted = token.toLowerCase();
  return names.findIndex((name) => name.toLowerCase() === wanted);
}

/**
 * An email-style date (`Fri, 21 Nov 1997 09:55:06 -0600`), or `null`.
 *
 * A trailing parenthesised comment — the `(CST)` mail agents append — is stripped
 * before parsing, per RFC 2822's CFWS rule. Two- and three-digit years follow
 * the obsolete-syntax rule the RFC states in §4.3: 00–49 mean 2000–2049, 50–99
 * mean 1950–1999, three digits are offset from 1900. That is not a guess, it is
 * the specified reading.
 *
 * **A day-of-week that contradicts the date is REFUSED**, and this is a
 * deliberate departure from the RFC, which tells receivers to ignore the
 * mismatch. Ignoring it is right for a mail agent, whose job is to deliver the
 * message anyway. It is wrong for a developer tool, where „this `Date:` header
 * disagrees with itself" is the most useful thing the tool could say.
 */
export function parseRfc2822(text: string): ParsedInstant | null {
  const withoutComment = text
    .trim()
    .replace(/\s*\([^()]*\)$/, "")
    .trim();
  const match = RFC_2822.exec(withoutComment);
  if (match === null) return null;
  const [
    ,
    weekdayText,
    dayText = "",
    monthText = "",
    yearText = "",
    hourText = "",
    minuteText = "",
    secondText,
    zoneText = "",
  ] = match;

  const monthIndex = indexOfName(RFC_MONTHS, monthText);
  if (monthIndex < 0) return null;
  const month = monthIndex + 1;

  const rawYear = Number(yearText);
  const year =
    yearText.length === 4
      ? rawYear
      : yearText.length === 3
        ? 1900 + rawYear
        : rawYear < 50
          ? 2000 + rawYear
          : 1900 + rawYear;

  const day = Number(dayText);
  if (day < 1 || day > daysInMonth(year, month)) return null;

  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = secondText === undefined ? 0 : Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) return null;

  if (weekdayText !== undefined) {
    const stated = indexOfName(RFC_WEEKDAYS, weekdayText);
    if (stated < 0 || stated + 1 !== isoWeekday(year, month, day)) return null;
  }

  const offsetMinutes = /^[+-]\d{4}$/.test(zoneText)
    ? parseOffsetToken(zoneText)
    : (RFC_ZONE_NAMES[zoneText.toUpperCase()] ?? null);
  if (offsetMinutes === null) return null;

  const epochMs =
    (daysFromCivil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second) * 1000 -
    offsetMinutes * 60_000;
  const instant = makeInstant(epochMs);
  if (instant === null) return null;
  return { instant, kind: "rfc2822", unit: null, offsetMinutes };
}

/**
 * An instant as an RFC 2822 date, at a chosen offset — or `""` for an instant
 * whose year the grammar cannot spell.
 *
 * The names stay ASCII English — `Fri`, `Nov` — because they are protocol
 * tokens, not user-facing copy. A Serbian „Pet, 21 Nov" would be an invalid
 * `Date:` header, and this is the one string in the module a machine reads.
 *
 * Sub-second precision has nowhere to go in this grammar and is dropped, which
 * is exactly why the ISO renderer is the one to reach for when the fraction
 * matters.
 *
 * **The year must fall in 0000–9999, and outside it the answer is `""`.** A
 * `Date:` header has no notation at all for a negative year: zero-padding one
 * keeps the sign in front of the zeros, so year −1 came out as the string
 * „00-1", which is not a date in any grammar. Past 9999 the refusal
 * is this module's own — RFC 5322 writes `4*DIGIT` and would take five, but
 * `parseRfc2822` reads at most four, because the obsolete two- and three-digit
 * years are told apart from a full one by LENGTH and a longer year would make
 * that rule ambiguous. Emitting text its own parser rejects is the broken pair
 * this module refuses to be, so both ends refuse instead, the same way
 * `formatDurationCompact` answers `""` for a figure it has no spelling for. An
 * instant outside the range is not unrepresentable — `formatIso8601` spells
 * every one of them, in the expanded year form.
 */
export function formatRfc2822(instant: Instant, offsetMinutes = 0): string {
  const civil = civilFromInstant(instant, offsetMinutes);
  if (civil.year < 0 || civil.year > 9999) return "";
  const weekday = RFC_WEEKDAYS[isoWeekday(civil.year, civil.month, civil.day) - 1] ?? "";
  const month = RFC_MONTHS[civil.month - 1] ?? "";
  const zone = formatOffset(offsetMinutes).replace(":", "");
  return (
    `${weekday}, ${pad(civil.day, 2)} ${month} ${pad(civil.year, 4)} ` +
    `${pad(civil.hour, 2)}:${pad(civil.minute, 2)}:${pad(civil.second, 2)} ${zone}`
  );
}

// ---------------------------------------------------------------------------
// The one-field parser
// ---------------------------------------------------------------------------

/**
 * Whatever the user pasted, read as an instant — or `null`.
 *
 * Tried in order: a bare number (through `guessEpochUnit`'s magnitude ladder),
 * then ISO 8601, then RFC 2822. FILETIME and ticks are never reached from here —
 * see `guessEpochUnit` for why they cannot be told apart from a nanosecond epoch
 * by looking — so `116444736000000000` comes back as a nanosecond count
 * (1970-01-02), NOT as the FILETIME of the Unix epoch it also is. The tool's
 * source picker is how you say you meant the other one.
 */
export function parseInstant(text: string): ParsedInstant | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  if (DECIMAL_NUMBER.test(trimmed)) {
    const unit = guessEpochUnit(trimmed);
    if (unit === null) return null;
    const instant = parseEpochValue(trimmed, unit);
    return instant === null ? null : { instant, kind: "epoch", unit, offsetMinutes: null };
  }

  return parseIso8601(trimmed) ?? parseRfc2822(trimmed);
}

// ---------------------------------------------------------------------------
// IANA time zones
// ---------------------------------------------------------------------------

/**
 * One formatter per zone, built once and remembered — including the failures, so
 * a bad zone id costs one `RangeError` rather than one per call.
 *
 * `hourCycle: "h23"` rather than `hour12: false`: the latter has a long history
 * of yielding hour „24" for midnight in ICU, which would put every midnight on
 * the previous day here. `hour12` is deliberately not passed alongside — it wins
 * over `hourCycle` when both are present, which would quietly undo the fix.
 */
const ZONE_FORMATTERS = new Map<string, Intl.DateTimeFormat | null>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat | null {
  const cached = ZONE_FORMATTERS.get(timeZone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat | null;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    // An unknown zone id is user input, not a caller bug: `Intl` throws, this
    // remembers the refusal and every caller gets `null`.
    formatter = null;
  }
  ZONE_FORMATTERS.set(timeZone, formatter);
  return formatter;
}

/** Wall-clock fields with no offset attached — what a clock in some zone reads. */
interface WallTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * Below this instant — two days into 1 AD — the era becomes ambiguous in ICU's
 * output (year „1" is both 1 AD and 1 BC, told apart only by an era field this
 * deliberately does not read), so zone conversion refuses rather than risk an
 * answer 730 000 days out. .NET tick 0 sits just under it.
 */
const ZONED_MIN_EPOCH_MS = -62_135_596_800_000 + 2 * MS_PER_DAY;

function wallInZone(epochMs: number, timeZone: string): WallTime | null {
  if (epochMs < ZONED_MIN_EPOCH_MS || epochMs > MAX_EPOCH_MS) return null;
  const formatter = zoneFormatter(timeZone);
  if (formatter === null) return null;

  const fields: Record<string, number> = {};
  for (const part of formatter.formatToParts(epochMs)) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  const { year, month, day, hour, minute, second } = fields;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

/** Milliseconds since the epoch of a wall time read as if it were already UTC. */
function wallAsUtcMs(wall: WallTime): number {
  return (
    (daysFromCivil(wall.year, wall.month, wall.day) * 86_400 +
      wall.hour * 3600 +
      wall.minute * 60 +
      wall.second) *
    1000
  );
}

/** A zone's offset from UTC at an instant, in milliseconds; `null` for an unknown zone or an instant out of range. */
function zoneOffsetMsAt(epochMs: number, timeZone: string): number | null {
  const wall = wallInZone(epochMs, timeZone);
  if (wall === null) return null;
  // Floored to the second, because the wall fields carry no sub-second part and
  // the subtraction would otherwise fold the milliseconds into the offset.
  return wallAsUtcMs(wall) - floorDivMod(epochMs, 1000).q * 1000;
}

/**
 * The offset a zone was on at an instant, in whole minutes east of UTC — or
 * `null` for an unknown zone, an instant out of range, or an offset that is not
 * a whole number of minutes.
 *
 * That last refusal exists because before a place adopted standard time (1884 in
 * much of Europe, later elsewhere) IANA carries its LOCAL MEAN TIME, which is an
 * offset with SECONDS in it — Amsterdam's is recorded as +00:19:32. Whether a
 * given runtime hands those seconds back or has already flattened them is not
 * something to depend on, so the guard is written against the value rather than
 * against a list of zones: `±HH:MM` cannot spell a fractional minute, and
 * shortening one would move the instant.
 *
 * Computed from `Intl` at the instant asked about, never from a table: a table
 * of zone rules goes stale the moment a government changes its mind, and one
 * shipped inside an offline app would go stale silently.
 */
export function zoneOffsetMinutes(instant: Instant, timeZone: string): number | null {
  const offsetMs = zoneOffsetMsAt(instant.epochMs, timeZone);
  if (offsetMs === null || offsetMs % 60_000 !== 0) return null;
  return offsetMs / 60_000;
}

/** An instant's fields as a clock in `timeZone` reads them, with the offset in force at that moment. */
export interface ZonedFields extends CivilDateTime {
  readonly timeZone: string;
  readonly offsetMinutes: number;
}

/** An instant read in an IANA zone, or `null` when the zone or the instant is out of reach. */
export function zonedFields(instant: Instant, timeZone: string): ZonedFields | null {
  const offsetMinutes = zoneOffsetMinutes(instant, timeZone);
  if (offsetMinutes === null) return null;
  return { ...civilFromInstant(instant, offsetMinutes), timeZone, offsetMinutes };
}

/** An instant as ISO 8601 in an IANA zone, or `null` when the zone is unknown. */
export function formatInZone(
  instant: Instant,
  timeZone: string,
  options: Omit<IsoFormatOptions, "offsetMinutes"> = {},
): string | null {
  const offsetMinutes = zoneOffsetMinutes(instant, timeZone);
  if (offsetMinutes === null) return null;
  const fractionDigits = options.fractionDigits;
  return formatIso8601(
    instant,
    fractionDigits === undefined ? { offsetMinutes } : { offsetMinutes, fractionDigits },
  );
}

/**
 * The instant at which a clock in `timeZone` reads exactly this wall time, or
 * `null` when no such instant exists.
 *
 * **Both daylight-saving edges are real cases and both are handled explicitly.**
 * A wall time inside the hour a spring-forward skips never happens — Belgrade
 * has no 02:30 on the last Sunday in March — and this answers `null` for it
 * rather than inventing 01:30 or 03:30. A wall time inside the hour an autumn
 * fall-back repeats happens TWICE, and this answers the EARLIER of the two,
 * which is what keeps a generated schedule strictly increasing.
 *
 * The mechanism, since the obvious one is wrong: guessing an offset from the
 * wall time itself and correcting once fails on the repeated hour, because the
 * corrected instant reports the post-transition offset and the earlier
 * occurrence is never found at all. Instead the offsets in force a day either
 * side are probed — no zone has two transitions within 48 hours — every
 * candidate they imply is converted BACK to wall time, and only the ones that
 * reproduce the requested reading survive. Zero survivors means the time does
 * not exist; two means it happened twice, and the earlier wins.
 */
function wallToInstant(wall: WallTime, timeZone: string): Instant | null {
  const guessMs = wallAsUtcMs(wall);
  const candidates = new Set<number>();
  for (const probe of [guessMs - MS_PER_DAY, guessMs, guessMs + MS_PER_DAY]) {
    const offsetMs = zoneOffsetMsAt(probe, timeZone);
    if (offsetMs !== null) candidates.add(guessMs - offsetMs);
  }

  let best: number | null = null;
  for (const candidate of candidates) {
    const roundTrip = wallInZone(candidate, timeZone);
    if (roundTrip === null) continue;
    if (
      roundTrip.year !== wall.year ||
      roundTrip.month !== wall.month ||
      roundTrip.day !== wall.day ||
      roundTrip.hour !== wall.hour ||
      roundTrip.minute !== wall.minute ||
      roundTrip.second !== wall.second
    ) {
      continue;
    }
    if (best === null || candidate < best) best = candidate;
  }

  return best === null ? null : makeInstant(best);
}

// ---------------------------------------------------------------------------
// Serbian plural arithmetic
// ---------------------------------------------------------------------------

type PluralForm = "one" | "few" | "other";

/**
 * Which of Serbian's three plural forms a count takes, by the CLDR rule for
 * `sr`: `one` for anything ending in 1 except 11, `few` for 2–4 except 12–14,
 * `other` for the rest. It is why „21 sat", „22 sata" and „25 sati" are all
 * correct and all different, and why picking one form and living with it is what
 * makes an interface read as machine translation.
 */
function srPlural(count: number): PluralForm {
  const abs = Math.abs(count);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return "one";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
  return "other";
}

/** The units a duration or a relative span is expressed in. */
export const RELATIVE_UNITS = ["second", "minute", "hour", "day", "week", "month", "year"] as const;

export type RelativeUnit = (typeof RELATIVE_UNITS)[number];

type CountableUnit = RelativeUnit | "millisecond";

const SR_NOUNS: Readonly<Record<CountableUnit, Readonly<Record<PluralForm, string>>>> = {
  millisecond: { one: "milisekunda", few: "milisekunde", other: "milisekundi" },
  second: { one: "sekunda", few: "sekunde", other: "sekundi" },
  minute: { one: "minut", few: "minuta", other: "minuta" },
  hour: { one: "sat", few: "sata", other: "sati" },
  day: { one: "dan", few: "dana", other: "dana" },
  week: { one: "nedelja", few: "nedelje", other: "nedelja" },
  month: { one: "mesec", few: "meseca", other: "meseci" },
  year: { one: "godina", few: "godine", other: "godina" },
};

/** Grammatical gender, which the determiner „svaki / svaka / svake" agrees with. */
const SR_MASCULINE: ReadonlySet<CountableUnit> = new Set<CountableUnit>([
  "minute",
  "hour",
  "day",
  "month",
]);

/** „3 dana", „1 sat", „22 minuta" — a count with the noun form Serbian gives it. */
function srCount(count: number, unit: CountableUnit): string {
  return `${count} ${SR_NOUNS[unit][srPlural(count)]}`;
}

/**
 * „svakih 15 minuta", „svaka 2 sata", „svake 2 sekunde" — the determiner in
 * front of a cron step.
 *
 * Serbian does not have one word for „every N": the genitive plural takes
 * „svakih", the paucal (2–4) takes „svaka" for masculine nouns and „svake" for
 * feminine ones, and the singular takes „svaki"/„svaka". Using „svakih" for all
 * of them is the single most recognisable tell of a machine-written Serbian
 * interface, so the gender is carried and the form is chosen.
 */
function srEvery(step: number, unit: CountableUnit): string {
  const form = srPlural(step);
  const masculine = SR_MASCULINE.has(unit);
  const determiner =
    form === "other"
      ? "svakih"
      : form === "few"
        ? masculine
          ? "svaka"
          : "svake"
        : masculine
          ? "svaki"
          : "svaka";
  return `${determiner} ${srCount(step, unit)}`;
}

/** „a, b i c" — the Serbian list, which takes no comma before the final „i". */
function joinSr(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} i ${parts[parts.length - 1] ?? ""}`;
}

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

/** How far one instant is from another, in the largest unit that still gives a whole count. */
export interface RelativeSpan {
  readonly direction: "past" | "future" | "now";
  readonly unit: RelativeUnit;
  /** Whole units, TRUNCATED — see `relativeSpan`. `0` only when the direction is `now`. */
  readonly count: number;
}

/** Whole calendar months from `earlier` to `later`, both read as UTC civil date-times. */
function wholeMonthsBetween(earlier: CivilDateTime, later: CivilDateTime): number {
  let months = (later.year - earlier.year) * 12 + (later.month - earlier.month);
  const earlierTime = earlier.hour * 3600 + earlier.minute * 60 + earlier.second;
  const laterTime = later.hour * 3600 + later.minute * 60 + later.second;
  if (later.day < earlier.day || (later.day === earlier.day && laterTime < earlierTime)) {
    months -= 1;
  }
  return Math.max(months, 0);
}

/**
 * How far `instant` is from `now`, as a count and a unit. Resolved to the
 * millisecond; a difference under one millisecond is `now`.
 *
 * **Truncated, never rounded.** Something 47 hours old is „1 day", not „2 days":
 * the count is a floor, so it always reads as „at least this much" and never
 * overstates. Rounding would report an event 90 minutes old as two hours, which
 * is the kind of small lie that makes a log timeline stop lining up with itself.
 *
 * Months and years are counted on the CALENDAR rather than off an average month
 * length — the span from 31 January to 1 March is a month and a day, and no
 * 30.44-day constant says so. Weeks fill the gap between one week and the first
 * whole calendar month, so 30 days that do not make a month come back as four
 * weeks rather than as nothing.
 */
export function relativeSpan(instant: Instant, now: Instant): RelativeSpan {
  const diff = instant.epochMs - now.epochMs;
  const abs = Math.abs(diff);
  if (abs < 1000) return { direction: "now", unit: "second", count: 0 };
  const direction = diff < 0 ? "past" : "future";

  const seconds = Math.floor(abs / 1000);
  if (seconds < 60) return { direction, unit: "second", count: seconds };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { direction, unit: "minute", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { direction, unit: "hour", count: hours };
  const days = Math.floor(hours / 24);
  if (days < 7) return { direction, unit: "day", count: days };

  const earlier = civilFromInstant(diff < 0 ? instant : now);
  const later = civilFromInstant(diff < 0 ? now : instant);
  const months = wholeMonthsBetween(earlier, later);
  if (months >= 12) return { direction, unit: "year", count: Math.floor(months / 12) };
  if (months >= 1) return { direction, unit: "month", count: months };
  return { direction, unit: "week", count: Math.floor(days / 7) };
}

/**
 * The nouns after „pre" and after „za", which are NOT the same words.
 *
 * This is the reason there are three noun tables in this module rather than one.
 * A duration is a bare quantity and takes the citation form („1 sat 30
 * minuta"), but a relative span is governed by a preposition: „pre" takes the
 * genitive („pre 1 sata") and „za" takes the accusative („za 1 sat"). Reusing
 * the duration's nouns for both directions yields „pre 1 sekunda" — a nominative
 * where the sentence demands a genitive, and the single most conspicuous way a
 * Serbian interface announces that it was written in English first. The forms
 * follow CLDR's `sr` relative-time patterns.
 */
const SR_RELATIVE_PAST: Readonly<Record<RelativeUnit, Readonly<Record<PluralForm, string>>>> = {
  second: { one: "sekunde", few: "sekunde", other: "sekundi" },
  minute: { one: "minuta", few: "minuta", other: "minuta" },
  hour: { one: "sata", few: "sata", other: "sati" },
  day: { one: "dana", few: "dana", other: "dana" },
  week: { one: "nedelje", few: "nedelje", other: "nedelja" },
  month: { one: "meseca", few: "meseca", other: "meseci" },
  year: { one: "godine", few: "godine", other: "godina" },
};

const SR_RELATIVE_FUTURE: Readonly<Record<RelativeUnit, Readonly<Record<PluralForm, string>>>> = {
  second: { one: "sekundu", few: "sekunde", other: "sekundi" },
  minute: { one: "minut", few: "minuta", other: "minuta" },
  hour: { one: "sat", few: "sata", other: "sati" },
  day: { one: "dan", few: "dana", other: "dana" },
  week: { one: "nedelju", few: "nedelje", other: "nedelja" },
  month: { one: "mesec", few: "meseca", other: "meseci" },
  year: { one: "godinu", few: "godine", other: "godina" },
};

/** „pre 3 dana", „za 2 sata", „upravo sada" — `relativeSpan` said in Serbian. */
export function formatRelativeSr(instant: Instant, now: Instant): string {
  const span = relativeSpan(instant, now);
  if (span.direction === "now") return "upravo sada";
  const past = span.direction === "past";
  const noun = (past ? SR_RELATIVE_PAST : SR_RELATIVE_FUTURE)[span.unit][srPlural(span.count)];
  return `${past ? "pre" : "za"} ${span.count} ${noun}`;
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

const DURATION_UNIT_MS: Readonly<Record<string, number>> = {
  w: 604_800_000,
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  s: 1000,
  ms: 1,
};

/**
 * A duration like `1h30m`, `90m`, `5400s`, `1,5h` or `-2h` as milliseconds, or
 * `null`.
 *
 * Units may appear in any order but never twice: `1h1h` is a typo, not three
 * hours minus doubt. A fraction is allowed — comma or dot, as everywhere else in
 * the drawer — and must come out to a whole number of milliseconds: `0,5s` is
 * 500 ms and fine, `0,0000001s` is not a duration this can hold and is refused
 * rather than flattened to zero.
 *
 * **The colon form is deliberately not admitted.** `5:30` is five and a half
 * hours to one reader and five and a half minutes to another, and there is
 * nothing in the string to settle it. The whole drawer refuses input with two
 * readings rather than picking one.
 *
 * The regex is rebuilt per call rather than hoisted: a sticky pattern carries
 * `lastIndex` as mutable state, and a shared one turns a second caller into a
 * heisenbug. Note the alternation order — `ms` before `m`, because a regex takes
 * the first branch that matches and `m|ms` reads „500ms" as 500 MINUTES followed
 * by a stray „s", which is the classic bug in this parser.
 */
export function parseDuration(text: string): number | null {
  const trimmed = text.trim();
  const negative = trimmed.startsWith("-");
  const body = (negative || trimmed.startsWith("+") ? trimmed.slice(1) : trimmed).replace(
    /\s+/g,
    "",
  );
  if (body === "") return null;

  const part = /(\d+(?:[.,]\d+)?)(ms|w|d|h|m|s)/y;
  const seen = new Set<string>();
  let total = 0;
  let consumed = 0;
  let match = part.exec(body);
  while (match !== null) {
    const [, amountText = "", unit = ""] = match;
    if (seen.has(unit)) return null;
    seen.add(unit);
    const scale = DURATION_UNIT_MS[unit];
    if (scale === undefined) return null;

    // „Is this a whole number of milliseconds?" is a question about the DIGITS
    // the user wrote, and it is answered on them — never on the product of two
    // doubles. `1.1 * 3_600_000` is 3960000.0000000005, so `Number.isInteger`
    // refused „1.1h", a duration that is exactly 3 960 000 ms; „1.5h" passed
    // only because it happens to land on a double exactly, which is the worst
    // possible way for a rule to look like it works. This is the same technique
    // `parseEpochValue` uses on its fraction: read whole and fractional digits
    // as one integer, scale by 10ⁿ for the n digits after the point, and require
    // the division to come out exact.
    const [wholeText = "", fractionText = ""] = amountText.split(/[.,]/);
    const scaled = BigInt(wholeText + fractionText) * BigInt(scale);
    const divisor = 10n ** BigInt(fractionText.length);
    if (scaled % divisor !== 0n) return null;
    total += Number(scaled / divisor);
    // How far the scan got has to be recorded HERE. A sticky regex resets
    // `lastIndex` to 0 the moment a match fails, so reading it after the loop
    // reports „consumed nothing" for every input — including the ones that
    // parsed perfectly — and the whole parser answers `null`.
    consumed = part.lastIndex;
    match = part.exec(body);
  }

  // A sticky regex stops at the first character it cannot consume; anything left
  // over means the text was not entirely a duration.
  if (consumed !== body.length) return null;
  return negative ? -total : total;
}

/** The units the two formatters decompose into, largest first. */
const DURATION_BREAKDOWN = [
  ["d", 86_400_000, "day"],
  ["h", 3_600_000, "hour"],
  ["m", 60_000, "minute"],
  ["s", 1000, "second"],
  ["ms", 1, "millisecond"],
] as const;

function breakDown(ms: number): { unit: string; noun: CountableUnit; count: number }[] {
  let rest = Math.abs(ms);
  const parts: { unit: string; noun: CountableUnit; count: number }[] = [];
  for (const [unit, scale, noun] of DURATION_BREAKDOWN) {
    const count = Math.floor(rest / scale);
    rest -= count * scale;
    if (count > 0) parts.push({ unit, noun, count });
  }
  return parts;
}

/**
 * A duration as the shortest text `parseDuration` reads back to the same number
 * — 5 400 000 becomes `1h30m`, `0` becomes `0s`.
 *
 * Weeks are ACCEPTED on input but never emitted: `90d` would otherwise come back
 * as `12w6d`, which is arithmetically right and useless to read. So the round
 * trip holds in the direction that matters — `parse(format(x)) === x` — while
 * `format(parse(x))` NORMALISES: `90m` comes back as `1h30m`, the same duration
 * said once.
 *
 * A value that is not a whole number of milliseconds gets an empty string, the
 * same answer `toolNumberInputValue` gives a figure with no spelling its own
 * parser would accept.
 */
export function formatDurationCompact(ms: number): string {
  if (!Number.isInteger(ms)) return "";
  if (ms === 0) return "0s";
  const sign = ms < 0 ? "-" : "";
  return (
    sign +
    breakDown(ms)
      .map((part) => `${part.count}${part.unit}`)
      .join("")
  );
}

/** The same duration in Serbian words — „1 sat 30 minuta", „0 sekundi". */
export function formatDurationSr(ms: number): string {
  if (!Number.isInteger(ms)) return "";
  if (ms === 0) return srCount(0, "second");
  const sign = ms < 0 ? "-" : "";
  return (
    sign +
    breakDown(ms)
      .map((part) => srCount(part.count, part.noun))
      .join(" ")
  );
}

// ---------------------------------------------------------------------------
// Cron: the grammar
// ---------------------------------------------------------------------------

/** The six positions a crontab line can carry, in the order they are written. */
export const CRON_FIELD_NAMES = [
  "second",
  "minute",
  "hour",
  "dayOfMonth",
  "month",
  "dayOfWeek",
] as const;

export type CronFieldName = (typeof CRON_FIELD_NAMES)[number];

/**
 * What each field accepts, plus the three-letter names it also answers to and
 * the number the FIRST of those names stands for — January is 1 but Sunday is 0,
 * and a shared vocabulary with no base would silently shift one of them.
 */
const CRON_FIELD_RANGES: Readonly<
  Record<CronFieldName, { min: number; max: number; names: readonly string[]; nameBase: number }>
> = {
  second: { min: 0, max: 59, names: [], nameBase: 0 },
  minute: { min: 0, max: 59, names: [], nameBase: 0 },
  hour: { min: 0, max: 23, names: [], nameBase: 0 },
  dayOfMonth: { min: 1, max: 31, names: [], nameBase: 0 },
  month: { min: 1, max: 12, names: RFC_MONTHS, nameBase: 1 },
  // 7 is Sunday as well as 0 — the Vixie allowance, normalised to 0 after parsing.
  dayOfWeek: {
    min: 0,
    max: 7,
    names: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
    nameBase: 0,
  },
};

/** Serbian names for the fields, so a refusal can say WHICH field it refused. */
const CRON_FIELD_LABELS_SR: Readonly<Record<CronFieldName, string>> = {
  second: "sekunda",
  minute: "minut",
  hour: "sat",
  dayOfMonth: "dan u mesecu",
  month: "mesec",
  dayOfWeek: "dan u nedelji",
};

/** The `@`-macros crontab defines, each with the five-field expression it stands for. */
export const CRON_MACROS: Readonly<Record<string, string>> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

/** Why a crontab expression was refused. */
export interface CronError {
  readonly code:
    | "empty"
    | "field-count"
    | "unknown-macro"
    | "reboot"
    | "syntax"
    | "range"
    | "range-order"
    | "step";
  /** The field the refusal is about, when it is about one. */
  readonly field: CronFieldName | null;
  /** The exact text refused, so a surface can point at it. */
  readonly token: string;
  /** Serbian, and it always names the field — a refusal that does not is one you have to bisect for. */
  readonly message: string;
}

/** A parsed crontab expression: every field expanded to the values it matches. */
export interface CronSpec {
  /** 5 for a classic crontab line, 6 when a leading seconds field was given. */
  readonly fieldCount: 5 | 6;
  /** Always populated — `[0]` for a five-field expression, which is what lets both shapes run through one matcher. */
  readonly seconds: readonly number[];
  readonly minutes: readonly number[];
  readonly hours: readonly number[];
  readonly daysOfMonth: readonly number[];
  readonly months: readonly number[];
  /** 0–6, Sunday first; a written `7` is normalised to `0` here. */
  readonly daysOfWeek: readonly number[];
  /** Whether the day-of-month field BEGAN with `*` (or was `?`) — see `dayMatches`. */
  readonly dayOfMonthStar: boolean;
  /** Whether the day-of-week field BEGAN with `*` (or was `?`) — see `dayMatches`. */
  readonly dayOfWeekStar: boolean;
  /** The macro this was written as, if it was. */
  readonly macro: string | null;
}

export type CronParseResult = { ok: true; spec: CronSpec } | { ok: false; error: CronError };

function cronFailure(
  code: CronError["code"],
  field: CronFieldName | null,
  token: string,
  message: string,
): CronParseResult {
  return { ok: false, error: { code, field, token, message } };
}

/** A number or a three-letter name, resolved against a field's vocabulary; `null` when it is neither. */
function cronValue(token: string, names: readonly string[], nameBase: number): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  const index = indexOfName(names, token);
  return index < 0 ? null : index + nameBase;
}

interface ParsedField {
  readonly values: readonly number[];
  readonly star: boolean;
}

function isCronError(value: ParsedField | CronError): value is CronError {
  return "code" in value;
}

function parseCronField(text: string, field: CronFieldName): ParsedField | CronError {
  const label = CRON_FIELD_LABELS_SR[field];
  const { min, max, names, nameBase } = CRON_FIELD_RANGES[field];
  const bad = (code: CronError["code"], token: string, message: string): CronError => ({
    code,
    field,
    token,
    message,
  });

  if (text.includes("?")) {
    if (field !== "dayOfMonth" && field !== "dayOfWeek") {
      return bad("syntax", text, `Znak „?" sme samo u poljima za dan; polje „${label}" ga ne prima.`);
    }
    // „?" means „no opinion about this field"; combining it with anything else in
    // the same field is a contradiction rather than a shorthand.
    if (text !== "?") {
      return bad("syntax", text, `Znak „?" u polju „${label}" mora stajati sam.`);
    }
  }

  const values = new Set<number>();
  for (const item of text.split(",")) {
    if (item === "") return bad("syntax", text, `Polje „${label}" ima praznu stavku u listi.`);

    const slices = item.split("/");
    if (slices.length > 2) {
      return bad("syntax", item, `Polje „${label}" ima više od jednog koraka u „${item}".`);
    }
    const [rangeText = "", stepText] = slices;

    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) < 1) {
        return bad(
          "step",
          item,
          `Korak u polju „${label}" mora biti ceo broj veći od nule, a dobio je „${stepText}".`,
        );
      }
      step = Number(stepText);
    }

    let from: number;
    let to: number;
    if (rangeText === "*" || rangeText === "?") {
      from = min;
      to = max;
    } else if (rangeText.includes("-")) {
      const bounds = rangeText.split("-");
      const start = bounds.length === 2 ? cronValue(bounds[0] ?? "", names, nameBase) : null;
      const end = bounds.length === 2 ? cronValue(bounds[1] ?? "", names, nameBase) : null;
      if (start === null || end === null) {
        return bad("syntax", item, `Polje „${label}" ne razume opseg „${rangeText}".`);
      }
      if (start < min || start > max || end < min || end > max) {
        return bad(
          "range",
          item,
          `Polje „${label}" prihvata ${min}–${max}, a dobilo je „${rangeText}".`,
        );
      }
      if (start > end) {
        // Vixie cron does not wrap a range around the end of a field and neither
        // does this: „22-4" would have to mean either nothing or two ranges, and
        // guessing which would silently change a schedule.
        return bad("range-order", item, `Opseg u polju „${label}" ide unazad: „${rangeText}".`);
      }
      from = start;
      to = end;
    } else {
      const value = cronValue(rangeText, names, nameBase);
      if (value === null) {
        return bad("syntax", item, `Polje „${label}" ne razume „${rangeText}".`);
      }
      if (value < min || value > max) {
        return bad(
          "range",
          item,
          `Polje „${label}" prihvata ${min}–${max}, a dobilo je „${rangeText}".`,
        );
      }
      from = value;
      // A bare value with a step — „5/15" — runs from there to the end of the
      // field. Classic Vixie has no such form; every cron written since does, and
      // reading it as a single value would drop most of the schedule.
      to = stepText === undefined ? value : max;
    }

    for (let value = from; value <= to; value += step) values.add(value);
  }

  return {
    values: [...values].sort((a, b) => a - b),
    star: text.startsWith("*") || text === "?",
  };
}

/**
 * A crontab expression, expanded — or a refusal that names the field.
 *
 * Five fields (`m h dom mon dow`) or six (a leading seconds field). Accepted in
 * every field: `*`, a value, a range `a-b`, a step written with `/`, and any
 * comma-separated list of those. Month and day-of-week also answer to their
 * three-letter English names, case-insensitively. `?` is accepted in the two day
 * fields, where it means „no opinion" and behaves as `*` does.
 *
 * `@reboot` parses to a refusal rather than to an error-free spec with no fire
 * times: it is a valid crontab line with a real meaning — run at boot — that
 * simply has no place on a timeline, and saying so is more useful than answering
 * „never".
 */
export function parseCron(text: string): CronParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return cronFailure("empty", null, text, "Cron izraz je prazan.");

  let macro: string | null = null;
  let body = trimmed;
  if (trimmed.startsWith("@")) {
    const key = trimmed.toLowerCase();
    if (key === "@reboot") {
      return cronFailure(
        "reboot",
        null,
        trimmed,
        `„@reboot" se pokreće pri podizanju sistema i nema vreme okidanja.`,
      );
    }
    const expansion = CRON_MACROS[key];
    if (expansion === undefined) {
      return cronFailure("unknown-macro", null, trimmed, `Nepoznat makro „${trimmed}".`);
    }
    macro = key;
    body = expansion;
  }

  const parts = body.split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    return cronFailure(
      "field-count",
      null,
      trimmed,
      `Cron izraz mora imati 5 ili 6 polja, a ima ${parts.length}.`,
    );
  }
  const fieldCount = parts.length === 6 ? 6 : 5;
  const names: readonly CronFieldName[] =
    fieldCount === 6 ? CRON_FIELD_NAMES : CRON_FIELD_NAMES.slice(1);

  const parsed: Partial<Record<CronFieldName, ParsedField>> = {};
  for (let index = 0; index < names.length; index += 1) {
    const field = names[index];
    const token = parts[index];
    if (field === undefined || token === undefined) continue;
    const result = parseCronField(token, field);
    if (isCronError(result)) return { ok: false, error: result };
    parsed[field] = result;
  }

  const daysOfWeek = [...new Set((parsed.dayOfWeek?.values ?? []).map((day) => day % 7))].sort(
    (a, b) => a - b,
  );

  return {
    ok: true,
    spec: {
      fieldCount,
      seconds: parsed.second?.values ?? [0],
      minutes: parsed.minute?.values ?? [],
      hours: parsed.hour?.values ?? [],
      daysOfMonth: parsed.dayOfMonth?.values ?? [],
      months: parsed.month?.values ?? [],
      daysOfWeek,
      dayOfMonthStar: parsed.dayOfMonth?.star ?? true,
      dayOfWeekStar: parsed.dayOfWeek?.star ?? true,
      macro,
    },
  };
}

// ---------------------------------------------------------------------------
// Cron: matching and the next fire times
// ---------------------------------------------------------------------------

/**
 * Whether a date is a day this expression fires on — the rule the cron half of
 * this module exists for.
 *
 * **Day-of-month and day-of-week are combined with OR, not AND.** In Vixie cron
 * — the crontab every Linux box runs — `0 0 13 * 5` fires on the 13th of every
 * month AND on every Friday, not on Friday the 13th. Written as an intersection
 * it produces a schedule that looks plausible, tests green against its own
 * assumption, and fires roughly a twentieth as often as intended; the mistake
 * usually surfaces months later.
 *
 * **The switch is the leading `*`, not „is this field restricted".** Vixie's
 * `entry.c` sets its `DOM_STAR`/`DOW_STAR` flags by looking at the FIRST
 * CHARACTER of the field, then takes the AND branch if either flag is set and
 * the OR branch otherwise. So a day-of-month written as a star with a step
 * counts as a star even though it restricts the schedule to half the days, and
 * pairing it with a weekday gives an INTERSECTION: odd days that are also
 * Fridays. Reimplementing the rule as „both fields restricted" is a
 * reasonable-sounding paraphrase that disagrees with the running system on
 * exactly that input, so the flag is stored as the flag and named after it.
 * `?`, which Vixie does not have, counts as a star for the same purpose — that
 * is what it means everywhere it does exist.
 */
function dayMatches(spec: CronSpec, year: number, month: number, day: number): boolean {
  const byMonthDay = spec.daysOfMonth.includes(day);
  const byWeekDay = spec.daysOfWeek.includes(isoWeekday(year, month, day) % 7);
  return spec.dayOfMonthStar || spec.dayOfWeekStar
    ? byMonthDay && byWeekDay
    : byMonthDay || byWeekDay;
}

/** The next in-day time at or after a cursor, or `null` when the day has none left. */
function nextTimeInDay(
  spec: CronSpec,
  from: WallTime,
): Pick<WallTime, "hour" | "minute" | "second"> | null {
  for (const hour of spec.hours) {
    if (hour < from.hour) continue;
    const minuteFloor = hour === from.hour ? from.minute : 0;
    for (const minute of spec.minutes) {
      if (minute < minuteFloor) continue;
      const secondFloor = hour === from.hour && minute === from.minute ? from.second : 0;
      const second = spec.seconds.find((value) => value >= secondFloor);
      if (second !== undefined) return { hour, minute, second };
    }
  }
  return null;
}

function nextDay(wall: WallTime): WallTime {
  const date = civilFromDays(daysFromCivil(wall.year, wall.month, wall.day) + 1);
  return { ...date, hour: 0, minute: 0, second: 0 };
}

function nextMonth(wall: WallTime): WallTime {
  const year = wall.month === 12 ? wall.year + 1 : wall.year;
  const month = wall.month === 12 ? 1 : wall.month + 1;
  return { year, month, day: 1, hour: 0, minute: 0, second: 0 };
}

function addSecond(wall: WallTime): WallTime {
  const total = wall.hour * 3600 + wall.minute * 60 + wall.second + 1;
  if (total >= 86_400) return nextDay(wall);
  return {
    year: wall.year,
    month: wall.month,
    day: wall.day,
    hour: Math.floor(total / 3600),
    minute: Math.floor(total / 60) % 60,
    second: total % 60,
  };
}

export interface CronScheduleOptions {
  /** IANA zone the crontab's wall clock runs on. Defaults to UTC — a cron with no stated zone has no zone. */
  readonly timeZone?: string;
}

/**
 * How many day- or month-steps the walk takes before giving up. A crontab can be
 * perfectly well-formed and never fire — `0 0 30 2 *` asks for 30 February — so
 * the search is bounded rather than trusted to terminate. Two thousand steps
 * covers more than five years, far past any schedule a person is reasoning about.
 */
const CRON_CALENDAR_STEP_LIMIT = 2000;

/** A second bound, on total iterations, so a fall-back hour full of rejected candidates cannot spin. */
const CRON_ITERATION_LIMIT = 100_000;

/**
 * The next `count` instants this expression fires at, STRICTLY after `after`.
 * `null` for an unknown time zone; a SHORT list (possibly empty) when the
 * expression cannot fire that many more times inside the search window.
 *
 * The walk runs on the wall clock of the chosen zone and each candidate is
 * converted back through `wallToInstant`, which is what makes daylight saving
 * behave: a fire time inside a skipped spring-forward hour is dropped (it never
 * happens) and one inside a repeated autumn hour fires at the earlier of the two
 * (it happens twice, and firing twice would be worse). Both are policy choices,
 * and both are the ones that keep the returned list strictly increasing.
 */
export function nextFireTimes(
  spec: CronSpec,
  after: Instant,
  count: number,
  options: CronScheduleOptions = {},
): Instant[] | null {
  if (!Number.isInteger(count) || count < 1) return [];
  const timeZone = options.timeZone ?? "UTC";
  const start = wallInZone(after.epochMs, timeZone);
  if (start === null) return null;

  const results: Instant[] = [];
  let cursor = addSecond(start);
  let calendarSteps = 0;
  let iterations = 0;

  while (
    results.length < count &&
    calendarSteps < CRON_CALENDAR_STEP_LIMIT &&
    iterations < CRON_ITERATION_LIMIT
  ) {
    iterations += 1;
    if (!spec.months.includes(cursor.month)) {
      cursor = nextMonth(cursor);
      calendarSteps += 1;
      continue;
    }
    if (!dayMatches(spec, cursor.year, cursor.month, cursor.day)) {
      cursor = nextDay(cursor);
      calendarSteps += 1;
      continue;
    }
    const time = nextTimeInDay(spec, cursor);
    if (time === null) {
      cursor = nextDay(cursor);
      calendarSteps += 1;
      continue;
    }
    cursor = { year: cursor.year, month: cursor.month, day: cursor.day, ...time };
    const instant = wallToInstant(cursor, timeZone);
    // `null` here is a wall time daylight saving skipped over: not a wrong
    // schedule, just a reading of the clock that never occurs. The comparison
    // guards the other edge — during a repeated hour the earlier occurrence can
    // already be behind `after`.
    if (instant !== null && compareInstants(instant, after) > 0) results.push(instant);
    cursor = addSecond(cursor);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Cron: the explanation
// ---------------------------------------------------------------------------

/** The shapes a field's value set can take, which is what decides how it is worded. */
type FieldShape =
  | { kind: "all" }
  | { kind: "single"; value: number }
  | { kind: "range"; from: number; to: number }
  | { kind: "step"; step: number }
  | { kind: "list"; values: readonly number[] };

/**
 * Which shape a field's expanded values make.
 *
 * Read off the VALUES rather than off the text they came from, which is what
 * makes `0,15,30,45` and a star with a step of 15 describe identically — they
 * are the same schedule, and an explanation that worded them differently would
 * be describing the typing rather than the job.
 *
 * The two DAY fields are the exception, and the exception is not this function's
 * to make: there the leading star is a FLAG that `dayMatches` branches on, so
 * two fields with identical values can be two different schedules. `describeDays`
 * settles that question before it asks this one.
 *
 * A progression is only WORDED as a step when it runs from the field's own start
 * and out past its end. „Every second minute" is a true reading of 0, 2, 4 … 58
 * and a misleading one of 0, 2, 4 alone, which is a list that happens to be
 * evenly spaced — so anything that does not span the field falls back to being
 * enumerated.
 */
function classifyField(values: readonly number[], min: number, max: number): FieldShape {
  if (values.length === max - min + 1) return { kind: "all" };
  const first = values[0];
  const last = values[values.length - 1];
  if (first === undefined || last === undefined) return { kind: "list", values };
  if (values.length === 1) return { kind: "single", value: first };

  const step = (values[1] ?? first) - first;
  const arithmetic = values.every((value, index) => value === first + index * step);
  if (!arithmetic) return { kind: "list", values };
  if (step === 1) return { kind: "range", from: first, to: last };
  if (first === min && last + step > max) return { kind: "step", step };
  return { kind: "list", values };
}

const SR_MONTHS_LOCATIVE = [
  "januaru",
  "februaru",
  "martu",
  "aprilu",
  "maju",
  "junu",
  "julu",
  "avgustu",
  "septembru",
  "oktobru",
  "novembru",
  "decembru",
] as const;

const SR_MONTHS_GENITIVE = [
  "januara",
  "februara",
  "marta",
  "aprila",
  "maja",
  "juna",
  "jula",
  "avgusta",
  "septembra",
  "oktobra",
  "novembra",
  "decembra",
] as const;

/** „ponedeljkom" — the instrumental, which is how Serbian says „on Mondays". Sunday first, as cron numbers them. */
const SR_WEEKDAYS_INSTRUMENTAL = [
  "nedeljom",
  "ponedeljkom",
  "utorkom",
  "sredom",
  "četvrtkom",
  "petkom",
  "subotom",
] as const;

/** The genitive, for „od ponedeljka do petka". */
const SR_WEEKDAYS_GENITIVE = [
  "nedelje",
  "ponedeljka",
  "utorka",
  "srede",
  "četvrtka",
  "petka",
  "subote",
] as const;

function ordinalSr(value: number): string {
  return `${value}.`;
}

function describeSeconds(shape: FieldShape): string {
  switch (shape.kind) {
    case "all":
      return "svake sekunde";
    case "single":
      return `u ${ordinalSr(shape.value)} sekundi`;
    case "range":
      return `od ${ordinalSr(shape.from)} do ${ordinalSr(shape.to)} sekunde`;
    case "step":
      return srEvery(shape.step, "second");
    case "list":
      return `u sekundama ${joinSr(shape.values.map(String))}`;
  }
}

function describeMinutes(shape: FieldShape): string {
  switch (shape.kind) {
    case "all":
      return "svakog minuta";
    case "single":
      return `u ${ordinalSr(shape.value)} minutu`;
    case "range":
      return `od ${ordinalSr(shape.from)} do ${ordinalSr(shape.to)} minuta`;
    case "step":
      return srEvery(shape.step, "minute");
    case "list":
      return `u minutima ${joinSr(shape.values.map(String))}`;
  }
}

function describeHours(shape: FieldShape): string {
  switch (shape.kind) {
    case "all":
      return "svakog sata";
    case "single":
      return `u ${srCount(shape.value, "hour")}`;
    case "range":
      return `od ${shape.from} do ${shape.to} sati`;
    case "step":
      return srEvery(shape.step, "hour");
    case "list":
      return `u ${joinSr(shape.values.map(String))} sati`;
  }
}

function describeDaysOfMonth(shape: FieldShape): string {
  switch (shape.kind) {
    case "all":
      return "";
    case "single":
      return `${ordinalSr(shape.value)} u mesecu`;
    case "range":
      return `od ${ordinalSr(shape.from)} do ${ordinalSr(shape.to)} u mesecu`;
    case "step":
      return `svaki ${ordinalSr(shape.step)} dan u mesecu`;
    case "list":
      return `${joinSr(shape.values.map(ordinalSr))} u mesecu`;
  }
}

function describeDaysOfWeek(shape: FieldShape): string {
  const instrumental = (day: number): string => SR_WEEKDAYS_INSTRUMENTAL[day] ?? "";
  const genitive = (day: number): string => SR_WEEKDAYS_GENITIVE[day] ?? "";
  switch (shape.kind) {
    case "all":
      return "";
    case "single":
      return instrumental(shape.value);
    case "range":
      return `od ${genitive(shape.from)} do ${genitive(shape.to)}`;
    case "step":
      return `svaki ${ordinalSr(shape.step)} dan u nedelji`;
    case "list":
      return joinSr(shape.values.map(instrumental));
  }
}

function describeMonths(shape: FieldShape): string {
  const locative = (month: number): string => SR_MONTHS_LOCATIVE[month - 1] ?? "";
  const genitive = (month: number): string => SR_MONTHS_GENITIVE[month - 1] ?? "";
  switch (shape.kind) {
    case "all":
      return "";
    case "single":
      return `u ${locative(shape.value)}`;
    case "range":
      return `od ${genitive(shape.from)} do ${genitive(shape.to)}`;
    case "step":
      return `svaki ${ordinalSr(shape.step)} mesec`;
    case "list":
      return `u ${joinSr(shape.values.map(locative))}`;
  }
}

/** How many clock times an explanation spells out before it falls back to describing the fields. */
const CLOCK_TIME_BUDGET = 8;

function describeTimeOfDay(spec: CronSpec): string {
  const seconds = classifyField(spec.seconds, 0, 59);
  const minutes = classifyField(spec.minutes, 0, 59);
  const hours = classifyField(spec.hours, 0, 23);
  const secondsAreDefault = spec.seconds.length === 1 && spec.seconds[0] === 0;

  if (seconds.kind === "all" && minutes.kind === "all" && hours.kind === "all") {
    return "svake sekunde";
  }
  if (secondsAreDefault && minutes.kind === "all" && hours.kind === "all") {
    return "svakog minuta";
  }
  // „every hour at :15" is how a single-minute schedule is actually read, and it
  // is shorter and clearer than enumerating twenty-four clock times.
  if (secondsAreDefault && minutes.kind === "single" && hours.kind === "all") {
    return `svakog sata u :${pad(minutes.value, 2)}`;
  }

  // Purely a question of HOW MANY times there would be, not of what shape the
  // fields are: a handful of clock times is always the clearest reading, and a
  // set wide enough to matter is always too long to list.
  const enumerable =
    spec.seconds.length === 1 &&
    spec.minutes.length * spec.hours.length <= CLOCK_TIME_BUDGET;
  if (enumerable) {
    const second = spec.seconds[0] ?? 0;
    const times: string[] = [];
    for (const hour of spec.hours) {
      for (const minute of spec.minutes) {
        times.push(
          `${pad(hour, 2)}:${pad(minute, 2)}${secondsAreDefault ? "" : `:${pad(second, 2)}`}`,
        );
      }
    }
    return `u ${joinSr(times)}`;
  }

  // A field that is wide open adds nothing once a finer one has been narrowed:
  // „svakih 15 minuta, svakog sata" says the second half twice.
  const parts: string[] = [];
  if (!secondsAreDefault) parts.push(describeSeconds(seconds));
  if (minutes.kind !== "all" || secondsAreDefault) parts.push(describeMinutes(minutes));
  if (hours.kind !== "all") parts.push(describeHours(hours));
  return parts.join(", ");
}

/**
 * The day clause, which is the one place a field's own text — not its values —
 * decides what the sentence may leave out.
 *
 * `classifyField` reads the VALUES, which is right everywhere else and not
 * enough here: „1-31" and „*" expand to the same 31 days, so both arrive as
 * `all` and both used to be dropped from the sentence as saying nothing. They do
 * not say the same thing. Only „*" sets Vixie's star flag, and it is the flag
 * that picks the branch in `dayMatches` — so „0 0 1-31 * 5" takes the OR branch
 * and fires EVERY day, while the explanation deleted the „1-31" and said
 * „petkom", which is the opposite of the schedule.
 *
 * So the question asked first is the one `dayMatches` actually answers: do these
 * two fields between them leave every day matching? Under the OR branch one
 * wide-open field is enough; under the AND branch both must be. When they do,
 * two literal stars — the ordinary case — need no words, and anything else gets
 * „svakog dana", because a field the user narrowed on purpose and that turns out
 * to change nothing is exactly what they are looking for an explanation of.
 *
 * Below that the old reading is sound: a field whose values are `all` really
 * does add nothing to an AND, which is the only branch that can still reach it.
 */
function describeDays(spec: CronSpec): string {
  const monthShape = classifyField(spec.daysOfMonth, 1, 31);
  const weekShape = classifyField(spec.daysOfWeek, 0, 6);
  const everyDay =
    spec.dayOfMonthStar || spec.dayOfWeekStar
      ? monthShape.kind === "all" && weekShape.kind === "all"
      : monthShape.kind === "all" || weekShape.kind === "all";
  if (everyDay) {
    return spec.dayOfMonthStar && spec.dayOfWeekStar ? "" : "svakog dana";
  }

  const monthPart = describeDaysOfMonth(monthShape);
  const weekPart = describeDaysOfWeek(weekShape);
  if (monthPart === "") return weekPart;
  if (weekPart === "") return monthPart;
  // „ili" and „i" are not decoration here: they are the union and the
  // intersection of `dayMatches`, said out loud. Telling the two apart in one
  // word is most of what makes this explanation worth reading at all.
  const union = !spec.dayOfMonthStar && !spec.dayOfWeekStar;
  return `${monthPart} ${union ? "ili" : "i"} ${weekPart}`;
}

/**
 * A crontab expression read out in Serbian — „u 00:00, 13. u mesecu ili petkom".
 *
 * The conjunction between the two day clauses is the payload: „ili" where the
 * expression is the union Vixie actually runs, „i" where a leading star has
 * flipped it into an intersection. A reader who takes nothing else from the
 * sentence should take away which of the two they wrote.
 */
export function explainCronSr(spec: CronSpec): string {
  return [
    describeTimeOfDay(spec),
    describeDays(spec),
    describeMonths(classifyField(spec.months, 1, 12)),
  ]
    .filter((clause) => clause !== "")
    .join(", ");
}
