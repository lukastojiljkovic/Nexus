/**
 * The renderer's one door to `Intl`.
 *
 * Every date, time, number, unit, file size, percentage and collation the
 * interface draws is produced through the factories below, so all of them
 * follow the ACTIVE interface locale with no call site spelling a tag of its
 * own. `strings.ts`'s `INTL_TAGS` stays the single source of those tags; this
 * module only reads them.
 *
 * WHY FACTORIES RATHER THAN MODULE-SCOPE CONSTANTS. The language switches at
 * runtime without a reload (`applyLocale` rewrites the table in place), and
 * every module is evaluated BEFORE `applyStoredLocale()` runs in `main.tsx`. A
 * module-scope `new Intl.DateTimeFormat("sr-Latn", …)` is therefore Serbian for
 * the life of the process, however the settings row is set: the object captured
 * a locale at import time and nothing can reach it afterwards. Asking for a
 * formatter AT USE TIME is the only shape that follows a switch.
 *
 * Construction is the expensive part of formatting, and several hot paths here
 * (a ledger row per render, a food figure per keystroke) format on every pass,
 * so the factories MEMOISE. The cache key is the active locale AND the options,
 * never the options alone: a formatter cached under the old language must not
 * answer after the switch. The locale is read through `activeLocale()` so the
 * key picks it up automatically, and a switch simply misses the cache and
 * builds fresh ones.
 */

import { activeLocale, intlTags, LOCALES, type Locale } from "./strings.js";

/**
 * A stable key for one locale + one options object.
 *
 * Keys are sorted so `{ month, day }` and `{ day, month }` — the same options
 * written in another order — share one formatter rather than quietly building
 * two. Every `Intl` option value is a primitive, so the string interpolation is
 * total; nothing here reaches into nested objects, which no `Intl` option is.
 */
function cacheKey(locale: Locale, options: object): string {
  const record = options as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `${locale}|${keys.map((key) => `${key}=${String(record[key])}`).join(",")}`;
}

const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

/** A `DateTimeFormat` for the active locale (or `locale`), memoised per locale and options. */
export function dateTimeFormat(
  options: Intl.DateTimeFormatOptions,
  locale: Locale = activeLocale(),
): Intl.DateTimeFormat {
  const key = cacheKey(locale, options);
  const cached = dateTimeFormats.get(key);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat([...intlTags(locale)], options);
  dateTimeFormats.set(key, created);
  return created;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/** A `NumberFormat` for the active locale (or `locale`), memoised per locale and options. */
export function numberFormat(
  options: Intl.NumberFormatOptions = {},
  locale: Locale = activeLocale(),
): Intl.NumberFormat {
  const key = cacheKey(locale, options);
  const cached = numberFormats.get(key);
  if (cached !== undefined) return cached;
  const created = new Intl.NumberFormat([...intlTags(locale)], options);
  numberFormats.set(key, created);
  return created;
}

const collators = new Map<string, Intl.Collator>();

/**
 * A `Collator` for the active locale (or `locale`), memoised per locale and options.
 *
 * The tags are the same list the app's formatters use, `sr-Latn` first, which is
 * what keeps Latin š/č/ć ordered correctly — plain `"sr"` resolves to the
 * Cyrillic tailoring. Because the locale is part of the key, an alphabetical
 * list re-sorts itself the moment the language does.
 */
export function collator(
  options: Intl.CollatorOptions = {},
  locale: Locale = activeLocale(),
): Intl.Collator {
  const key = cacheKey(locale, options);
  const cached = collators.get(key);
  if (cached !== undefined) return cached;
  const created = new Intl.Collator([...intlTags(locale)], options);
  collators.set(key, created);
  return created;
}

/**
 * Case folding in the interface language, for the substring matches the note
 * menus and the avatar initials do. `toLocaleLowerCase`/`toLocaleUpperCase`
 * were spelled `"sr-Latn"`/`["sr-Latn","sr"]` at each site; routing them here
 * keeps Turkish's dotted-İ rules a future locale's problem rather than a silent
 * bug in an English build.
 */
export function lowerCase(text: string, locale: Locale = activeLocale()): string {
  return text.toLocaleLowerCase([...intlTags(locale)]);
}

export function upperCase(text: string, locale: Locale = activeLocale()): string {
  return text.toLocaleUpperCase([...intlTags(locale)]);
}

/**
 * The grouping and decimal characters a locale actually emits, derived from
 * `Intl` rather than hard-coded.
 *
 * Parsers use these to read back what a formatter wrote, which is what makes a
 * value prefilled into an edit field parse to the same value in Serbian
 * („1.234,50") and English („1,234.50"). The characters come from formatting a
 * real number, the only way to learn what this ICU build emits for the locale —
 * a table of our own would be a second opinion that could disagree with the
 * formatter beside it.
 */
const separatorsByLocale = new Map<Locale, { group: string; decimal: string }>();

function separators(locale: Locale): { group: string; decimal: string } {
  const cached = separatorsByLocale.get(locale);
  if (cached !== undefined) return cached;
  const parts = new Intl.NumberFormat([...intlTags(locale)], {
    useGrouping: true,
    minimumFractionDigits: 1,
  }).formatToParts(12345.6);
  let group = ",";
  let decimal = ".";
  for (const part of parts) {
    if (part.type === "group") group = part.value;
    else if (part.type === "decimal") decimal = part.value;
  }
  const found = { group, decimal };
  separatorsByLocale.set(locale, found);
  return found;
}

/** The active locale's (or `locale`'s) grouping character („." in Serbian, „," in English). */
export function groupSeparator(locale: Locale = activeLocale()): string {
  return separators(locale).group;
}

/** The active locale's (or `locale`'s) decimal mark („," in Serbian, „." in English). */
export function decimalSeparator(locale: Locale = activeLocale()): string {
  return separators(locale).decimal;
}

/**
 * Every decimal mark any locale this build can serve writes, deduplicated.
 *
 * A parser that reads back a prefilled value cannot know which locale wrote the
 * text it is looking at, so it accepts the union — today „," and „." — rather
 * than trying to guess a locale from the characters. The set is DERIVED from
 * `Intl`, so a third locale with, say, a decimal point in Arabic-Indic digits
 * adds itself here without an edit.
 */
export function decimalSeparators(): string[] {
  const set = new Set<string>();
  for (const locale of Object.keys(LOCALES) as Locale[]) set.add(decimalSeparator(locale));
  return [...set];
}
