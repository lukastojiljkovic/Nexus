import { foldSearchText } from "@nexus/core";
import { dateTimeFormat, numberFormat } from "../../../renderer/src/intl.js";
import type { Locale } from "../../../renderer/src/strings.js";

/**
 * The RECORDER's reads of the list it draws, as pure functions (ADR-090): what a
 * row is CALLED, what its day and time read as, what its bytes cost, and whether
 * it answers a search.
 *
 * **Why the locale is a parameter rather than a reach for `activeLocale()`**.
 * Every formatter here goes through `renderer/intl.ts`, which follows the live
 * language — but taking the tag as an argument is what makes these testable in
 * both languages, and it keeps a language switch from changing what a row's
 * date MEANS. Nothing here holds a formatter of its own.
 *
 * **The day and the time are read in two different frames, and both are the
 * app's own rules.** A row's DAY comes from `@nexus/core`'s `groupByCreationDay`,
 * which is the first ten characters of the stored instant — the house's day-key
 * rule for an instant, and the same one the calendar page reads — so a day
 * heading is formatted in UTC, exactly as `HabitsPage`'s history cells are. A
 * row's TIME is the moment somebody pressed record, so it is the user's own
 * clock, formatted in the machine's zone. Formatting the day locally would slide
 * a recording made at 00:30 under the previous day's heading, which is not the
 * day the list grouped it under.
 */

/**
 * What a row is called: the title the user gave it, or — for the common case of
 * a recording nobody has named yet — the instant it was made, written out in the
 * language being read.
 *
 * The default is COPY rather than data, which is why the store keeps an empty
 * title and this function draws the words: an entry recorded on a Serbian
 * interface and read on an English one gets an English default (see
 * `RecorderStore`'s own note that the date-and-time default is stage 2's copy).
 */
export function entryTitle(title: string, createdAt: string, locale: Locale): string {
  const trimmed = title.trim();
  if (trimmed !== "") return trimmed;
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return createdAt;
  return dateTimeFormat({ dateStyle: "medium", timeStyle: "short" }, locale).format(at);
}

/** The moment the recording was made, as a clock: what tells two recordings of one day apart. */
export function formatTimeOfDay(createdAt: string, locale: Locale): string {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return "";
  return dateTimeFormat({ hour: "2-digit", minute: "2-digit" }, locale).format(at);
}

/**
 * One day key (`YYYY-MM-DD`) in words, formatted in UTC — see this file's header
 * for why the day is read in UTC and the time is not.
 */
export function formatDayKey(day: string, locale: Locale): string {
  const at = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return day;
  return dateTimeFormat({ weekday: "long", day: "numeric", month: "long" }, locale).format(at);
}

/**
 * A day on the user's OWN calendar, as the bare key a diary date is filed under
 * (`YYYY-MM-DD`) — what the form's date field is filled with when a recording is
 * filed in the diary.
 *
 * Read from the local calendar fields rather than from an ISO string, because
 * „which day is it" is the user's question and `toISOString` would answer it in
 * UTC: at 00:30 in Belgrade the answers differ, and the diary date is the one
 * the user means.
 */
export function localDayKey(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/** The unit a size is read in, by the magnitude of the size itself. */
function sizeUnit(bytes: number): "byte" | "kilobyte" | "megabyte" | "gigabyte" {
  if (bytes < 1_000) return "byte";
  if (bytes < 1_000_000) return "kilobyte";
  if (bytes < 1_000_000_000) return "megabyte";
  return "gigabyte";
}

/** The decimal scale of each unit — 1 000 rather than 1 024, because the unit names are `Intl`'s own and those are decimal. */
const UNIT_SCALE = {
  byte: 1,
  kilobyte: 1_000,
  megabyte: 1_000_000,
  gigabyte: 1_000_000_000,
} as const;

/**
 * A recording's size in the units and grouping of the language being read:
 * „54,9 MB" in Serbian, „54.9 MB" in English.
 *
 * One digit after the point for everything but bytes, and no digits at all for
 * bytes: these figures are read to see which of two recordings is the big one,
 * and a byte count answers that question far worse than a megabyte count does.
 *
 * **Bytes are read with `unitDisplay: "long"` because the short form is wrong in
 * English** — measured on this machine's ICU (Node 24.19.0): the short form of
 * 512 bytes is „512 byte" while the long form is „512 bytes" (and „512
 * bajtova" in Serbian). So the one unit whose abbreviation is a word gets the
 * word, and the four abbreviations everybody reads at a glance keep theirs.
 */
export function formatBytes(bytes: number, locale: Locale): string {
  const unit = sizeUnit(bytes);
  return numberFormat(
    {
      style: "unit",
      unit,
      unitDisplay: unit === "byte" ? "long" : "short",
      maximumFractionDigits: unit === "byte" ? 0 : 1,
    },
    locale,
  ).format(bytes / UNIT_SCALE[unit]);
}

/** The fields a row's search reads. */
export interface SearchableEntry {
  readonly title: string;
  readonly tags: readonly string[];
  readonly notes: string;
}

/**
 * Whether a recording answers a search: every term the user typed appears
 * somewhere in the row's title, tags or note.
 *
 * **Diacritics are the point here, not a nicety.** Both sides go through
 * `@nexus/core`'s `foldSearchText`, so „setnja" finds „Šetnja" — the same
 * grammar the launcher and the palette search with, and the reason a Serbian
 * user never has to think about which letter their keyboard produced.
 *
 * An empty query matches everything: the box is a filter, and nothing typed is
 * not a filter that matches nothing.
 */
export function matchesQuery(entry: SearchableEntry, query: string): boolean {
  const terms = foldSearchText(query.trim())
    .split(/\s+/)
    .filter((term) => term !== "");
  if (terms.length === 0) return true;
  const haystack = foldSearchText([entry.title, ...entry.tags, entry.notes].join("\n"));
  return terms.every((term) => haystack.includes(term));
}

/**
 * The tags field's text as the names the store takes: split on commas, trimmed,
 * empty pieces dropped, and the list cut at `cap` — the cap the store sent in
 * the view, never a number this file holds.
 *
 * A comma is the ONE separator, which is why the field can be a single line:
 * „glas, napolju" is two tags and „napolju" is one. Cutting at the cap keeps the
 * form's draft usable while the user pastes a long list (the refusal under the
 * field is what says the list was too long).
 */
export function splitTags(text: string, cap: number): string[] {
  return text
    .split(",")
    .map((piece) => piece.trim())
    .filter((piece) => piece !== "")
    .slice(0, cap);
}

/** The inverse, for filling the field when an entry is edited: `["glas", "napolju"]` → `"glas, napolju"`. */
export function joinTags(tags: readonly string[]): string {
  return tags.join(", ");
}
