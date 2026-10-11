import type { CardLanguage } from "@nexus/core";

/**
 * One bare `YYYY-MM-DD` day, written the way a person reads a date.
 *
 * **Why `sr-Latn` and not `sr`.** `Intl`'s plain `sr` locale is Cyrillic in
 * current ICU, and this product is Latin script in both of its languages
 * (`sr-Latn` is the collator the whole app sorts with for the same reason). A
 * date printed on an emergency card is read by a stranger in a hurry; a script
 * its subject never uses is the last place to be clever.
 *
 * **Why the day is parsed as UTC.** A birth date and a document's expiry are
 * calendar days with no instant and no time zone; formatting one in local time
 * shifts it a day back for every reader west of Greenwich, which is what
 * `examDates.ts` documents one module over. So the day is anchored at UTC and
 * formatted at UTC.
 *
 * **Why it lives in `shared/`.** Main builds the printed sheet and the page
 * draws its on-screen card, and those two have to write `1990-05-04` the same
 * way. One function, two callers.
 */

/** The `Intl` locale for one card language. See the file header for why `sr` is not it. */
const LOCALES: Record<CardLanguage, string> = { sr: "sr-Latn", en: "en-GB" };

/**
 * A bare day as "4. maj 1990." (sr) or "4 May 1990" (en), or the input unchanged
 * when it is not a day - a value the card prints rather than one it refuses to
 * print, because the store's own CHECK is what guarantees a real day reaches it.
 */
export function formatCardDate(day: string, language: CardLanguage): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return day;
  return new Intl.DateTimeFormat(LOCALES[language], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** The two letters a pass is signed with in the app's own copy - "SR" / "EN", never a translated word. */
export function languageTag(language: CardLanguage): string {
  return language.toUpperCase();
}
