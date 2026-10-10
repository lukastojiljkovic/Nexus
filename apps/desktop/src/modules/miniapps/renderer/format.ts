/**
 * The formatters the page reads its numbers and dates through.
 *
 * **Why every one of them goes through `Intl`.** A Serbian reader writes
 * `1.234,5` where an English one writes `1,234.5`, and a date is `17. 5. 2026.`
 * to one and `5/17/2026` to the other. Hand-built formatting would be two
 * branches here and a third the day a locale is added, so the arithmetic stays
 * in the engines and the presentation goes through the platform's own
 * formatters.
 *
 * **Why the locale is `sr-Latn` and not `sr`.** The interface's Serbian is the
 * Latin script, and plain `"sr"` mis-tailors it - the same reason every
 * `Intl.Collator` in this repository names the script (CLAUDE.md's house rule).
 */
import { activeLocale } from "../../../renderer/src/moduleKit/moduleSurface.js";

/** The BCP-47 tag the active interface language formats in. */
export function intlLocale(): string {
  return activeLocale() === "en" ? "en-US" : "sr-Latn";
}

/** A quantity in the active locale, with the caller's own options. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(intlLocale(), options).format(value);
}

/** A whole count - a tally, a score, a number of days. */
export function formatCount(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

/** A fraction in `0..1` as a percentage, at most one decimal - what accuracy is read as. */
export function formatPercent(fraction: number): string {
  return formatNumber(fraction, { style: "percent", maximumFractionDigits: 1 });
}

/** A typing speed, one decimal at most: `41,5` in Serbian, `41.5` in English. */
export function formatSpeed(value: number): string {
  return formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** A span in whole seconds, rounded up so a run of 12.1 s reads as 13 s rather than 12. */
export function formatSeconds(seconds: number): string {
  return `${formatCount(Math.max(0, Math.ceil(seconds)))} s`;
}

/** The local `YYYY-MM-DD` key of a `Date` - the shape the date calculator works in, and never a UTC one. */
export function dayKeyOf(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today, as the date calculator's own key. */
export function todayKey(): string {
  return dayKeyOf(new Date());
}

/**
 * A date key back as a `Date`, or `null` for a text that is not one.
 *
 * Noon rather than midnight, deliberately: a wall-clock reading taken at
 * midnight is the hour a daylight-saving change lands on in some zones, and a
 * date that shifted by a day because a clock changed would be a calculator
 * nobody could trust. Noon is twelve hours from either edge.
 */
export function dateOfDayKey(dayKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  // A key that names a day the calendar does not have (2026-02-30) rolls over
  // rather than throwing, so the round trip is what decides.
  return dayKeyOf(date) === dayKey ? date : null;
}

/** A date as the user reads it, in the active locale. */
export function formatDay(dayKey: string): string {
  const date = dateOfDayKey(dayKey);
  if (date === null) return dayKey;
  return new Intl.DateTimeFormat(intlLocale(), { dateStyle: "long" }).format(date);
}

/** A date's weekday name - what tells a user that 1 May 2026 is a Friday. */
export function weekdayName(dayKey: string): string {
  const date = dateOfDayKey(dayKey);
  if (date === null) return "";
  return new Intl.DateTimeFormat(intlLocale(), { weekday: "long" }).format(date);
}

/** An instant as a clock reading in the active locale's own zone. */
export function formatHourMinute(atMs: number): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(atMs));
}

/** An instant as a clock reading in UTC - the one zone every reader shares. */
export function formatUtcHourMinute(atMs: number): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(atMs));
}

/** A minute of the day (`540`) as a clock reading (`09:00`), for the hours a form takes and shows. */
export function formatMinuteOfDay(minuteOfDay: number): string {
  const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const minutes = String(minuteOfDay % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** A clock reading the user typed (`"09:00"`) as a minute of the day, or `null`. */
export function parseMinuteOfDay(text: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text.trim());
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** An instant as a short date and time, for the dice history. */
export function formatStamp(atMs: number): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(atMs));
}
