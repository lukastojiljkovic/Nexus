/**
 * The pure date labels the calendar, the dashboard, the document list and the
 * finance ledger draw.
 *
 * They lived as private helpers inside four page components, which made the one
 * thing worth testing — that each reads in the ACTIVE interface locale, Serbian
 * „8. jul 2026." and English „8 July 2026" from the same call — untestable
 * without a DOM. Collected here they are pure functions over a date key, so a
 * test can switch language and assert both. Every formatter is asked for at use
 * time through `intl.ts`, so a runtime switch is followed rather than frozen at
 * import.
 *
 * A bare calendar day is parsed and formatted in UTC everywhere here: `new
 * Date("YYYY-MM-DD")` is UTC midnight, and formatting it in a negative-offset
 * timezone would shift the label back a day.
 */

import { dateTimeFormat } from "./intl.js";

/** The dashboard's date line — „petak, 2. oktobar" / "Friday, 2 October". */
export function formatDashboardDate(now: Date): string {
  return dateTimeFormat({ weekday: "long", day: "numeric", month: "long" }).format(now);
}

/** Month navigation label — „jul 2026." / "July 2026". */
export function formatCalendarMonthLabel(key: string): string {
  const date = new Date(key);
  return Number.isNaN(date.getTime())
    ? key
    : dateTimeFormat({ month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

/** Bare month name — „avgust" / "August"; the key's month digits on bad input. */
export function formatCalendarMonthName(key: string): string {
  const date = new Date(key);
  return Number.isNaN(date.getTime())
    ? key.slice(5, 7)
    : dateTimeFormat({ month: "long", timeZone: "UTC" }).format(date);
}

/** A bare day + month with the locale's own punctuation — „9. avgust" / "9 August". */
export function formatCalendarDayMonth(key: string): string {
  const date = new Date(key);
  return Number.isNaN(date.getTime())
    ? key
    : dateTimeFormat({ day: "numeric", month: "long", timeZone: "UTC" }).format(date);
}

/**
 * Week navigation label: „3 — 9. avgust 2026" within one month, „31. avgust —
 * 6. septembar 2026" across a boundary; English reads „3 — 9 August 2026" and
 * „31 August — 6 September 2026". The day+month halves come from `Intl` so the
 * period after the day is Serbian-only, and the year is appended by hand because
 * the combined day+month+year pattern trails a period after the year.
 */
export function formatCalendarWeekLabel(weekKeys: readonly string[]): string {
  const start = weekKeys[0];
  const end = weekKeys[6];
  if (start === undefined || end === undefined) return "";
  const startDay = Number(start.slice(8, 10));
  const year = end.slice(0, 4);
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${startDay} — ${formatCalendarDayMonth(end)} ${year}`;
  }
  return `${formatCalendarDayMonth(start)} — ${formatCalendarDayMonth(end)} ${year}`;
}

/**
 * Semester navigation label: „jul — oktobar 2026" within one year, „novembar
 * 2026 — februar 2027" across a year end. Composed from bare month names for the
 * same reason `formatCalendarWeekLabel` is — the combined month+year pattern
 * trails a period this header does not want in either locale.
 */
export function formatCalendarSemesterLabel(monthKeys: readonly string[]): string {
  const first = monthKeys[0];
  const last = monthKeys.at(-1);
  if (first === undefined || last === undefined) return "";
  const firstYear = first.slice(0, 4);
  const lastYear = last.slice(0, 4);
  const opening =
    firstYear === lastYear
      ? formatCalendarMonthName(first)
      : `${formatCalendarMonthName(first)} ${firstYear}`;
  return `${opening} — ${formatCalendarMonthName(last)} ${lastYear}`;
}

/** Day navigation label — „sreda, 8. jul 2026." / "Wednesday, 8 July 2026". */
export function formatCalendarDayLabel(key: string): string {
  const date = new Date(key);
  return Number.isNaN(date.getTime())
    ? key
    : dateTimeFormat({
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

/** Agenda day-section header — „sreda, 8. jul" / "Wednesday, 8 July". */
export function formatCalendarAgendaDay(key: string): string {
  const date = new Date(key);
  return Number.isNaN(date.getTime())
    ? key
    : dateTimeFormat({
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }).format(date);
}

/** A tracked document's expiry — „8. jul 2026." / "8 July 2026"; the raw string on bad input. */
export function formatDocumentDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : dateTimeFormat({
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

/** The ledger's dated rule — „ČET, 7. AVG 2026." / "Thu, 7 Aug 2026"; the key itself on bad input. */
export function formatLedgerDay(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? dayKey
    : dateTimeFormat({
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}
