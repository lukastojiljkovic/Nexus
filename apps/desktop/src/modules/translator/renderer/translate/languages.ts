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

/**
 * A row's name in `tags`: the one `Intl` gives, else the FLORES name the table
 * carries, else the code. ICU names most of the 202 languages; the rest are the
 * ones it has no name for, and those are named from the table rather than left
 * blank.
 */
function namer(tags: readonly string[]): (row: NllbLanguage) => string {
  const names = new Intl.DisplayNames([...tags], { type: "language", fallback: "none" });
  return (row) => names.of(row.bcp47) ?? row.fallbackName ?? row.code;
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
