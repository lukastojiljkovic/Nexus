import { foldSearchText } from "@nexus/core";

import { NLLB_LANGUAGES, type NllbLanguage } from "../../shared/languages.js";

/**
 * One language as the pickers show it: the table's row, its name in the page's
 * locale, and its English name, which the search matches as well.
 */
export interface LanguageEntry {
  readonly row: NllbLanguage;
  readonly name: string;
  readonly english: string;
}

/** How many of the table's rows share each value of `key`. */
function countBy(key: (row: NllbLanguage) => string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const row of NLLB_LANGUAGES) counts.set(key(row), (counts.get(key(row)) ?? 0) + 1);
  return counts;
}
const languageOf = (row: NllbLanguage): string => row.bcp47.split("-")[0] ?? row.bcp47;
const PER_TAG = countBy((row) => row.bcp47);
const PER_LANGUAGE = countBy(languageOf);

/**
 * A row's name in `tags`. A tag two rows share is named from the table's FLORES
 * name, because ICU names both alike (Akan and Twi are both `ak-Latn`). A
 * language the table has in two scripts is named with its script ("Traditional
 * Chinese"); any other without it, since "German (Latin)" tells the reader
 * nothing. Where ICU has no name, which in Electron is 52 of the 202, the FLORES
 * name the table carries for every row.
 */
function namer(tags: readonly string[]): (row: NllbLanguage) => string {
  const names = new Intl.DisplayNames([...tags], { type: "language", fallback: "none" });
  return (row) => {
    if ((PER_TAG.get(row.bcp47) ?? 0) > 1) return row.fallbackName;
    const tag = (PER_LANGUAGE.get(languageOf(row)) ?? 0) > 1 ? row.bcp47 : languageOf(row);
    return names.of(tag) ?? row.fallbackName;
  };
}

/**
 * Every language, named in `tags` and sorted by that name. The tags are the
 * interface's own list (`intlTags`), whose first entry is what keeps Latin š, č
 * and ć in the right place for Serbian.
 */
export function languageEntries(tags: readonly string[]): LanguageEntry[] {
  const compare = new Intl.Collator([...tags]).compare;
  const [name, english] = [namer(tags), namer(["en"])];
  return NLLB_LANGUAGES.map((row) => ({ row, name: name(row), english: english(row) })).sort((left, right) =>
    compare(left.name, right.name),
  );
}

/**
 * The entries a query finds: any whose name, English name or NLLB code contains
 * it, ignoring case and diacritics. An empty query finds every entry.
 */
export function matchLanguages(entries: readonly LanguageEntry[], query: string): LanguageEntry[] {
  const needle = foldSearchText(query.trim());
  if (needle === "") return [...entries];
  return entries.filter((entry) =>
    [entry.name, entry.english, entry.row.code].some((text) => foldSearchText(text).includes(needle)),
  );
}
