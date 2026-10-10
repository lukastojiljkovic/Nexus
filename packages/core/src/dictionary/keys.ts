/**
 * The dictionary's index KEY — one function, and the two decisions inside it.
 *
 * **Why a key rather than the word.** A dictionary is looked up, and the
 * twelve ways a person can spell a word they heard are not twelve entries:
 * ćevapčići, Đorđe and Čačak are typed with a
 * keyboard that does not always have the Serbian letters, and the same word is
 * also written in Cyrillic — Serbian is digraphic, so the same headword has two
 * spellings before anybody mistypes anything. So the pack's index is keyed by
 * one folded form and a query is folded the same way before it is searched.
 *
 * That fold is `search/searchText.ts`'s, reused rather than re-derived: it
 * lowercases, maps the Serbian Cyrillic alphabet to Latin, and strips
 * diacritics (č ć š ž by decomposition, đ from its own hand
 * table because the stroke is part of the letter rather than a combining mark),
 * so ćevapčići, its Cyrillic spelling and `cevapcici` all fold to
 * the same key. The app already folds every search query and every indexed
 * document through it (ADR-021), and a second fold here would be a second
 * answer to "do these two strings mean the same word".
 *
 * **What folding must not do here: hide a collision.** The fold is lossy —
 * č and ć both become `c` — which is why a pack entry keeps the word
 * the source gave it beside the key, and why two headwords that fold together
 * stay two entries under one key rather than collapsing into one.
 */

import { cyrillicToLatin } from "../devtools/text.js";
import { foldSearchText } from "../search/searchText.js";

/**
 * The key one headword or query is indexed and searched under.
 *
 * The trim happens BEFORE the fold, so a query typed with a trailing space
 * looks up the word rather than the word plus a space. An input that folds to
 * nothing answers the empty key, and every caller treats that as "nothing to
 * look for" rather than as a key that matches everything — the rule is stated
 * once, in `matchDictionaryKeys`.
 */
export function dictionaryKey(word: string): string {
  return foldSearchText(word.trim());
}

/**
 * The order the pack's index is WRITTEN and SEARCHED in, and it is deliberately
 * not a collator.
 *
 * The house rule is `Intl.Collator(["sr-Latn", "sr"])` for anything a person
 * reads (CLAUDE.md), and the index is not such a thing: it is sorted by this
 * comparison so the searcher can binary-search it without reading it, and a
 * collator's order is a tailoring rule that differs between ICU builds while
 * a code-unit order is one the builder and the reader compute identically. The
 * lists a person actually reads — search results, recent lookups, phrasebook
 * topics — are ordered with the collator at the surface, where the sorting is
 * for a reader rather than for a search.
 */
export function compareDictionaryKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Whether a piece of text carries a letter only Serbian uses: the five Latin
 * ones (č ć š ž đ, either case) or any Cyrillic letter.
 *
 * **What this is for.** A dictionary with two directions has to decide which
 * one a query is in before it can look anything up. `hello` against `zdravo` is
 * not a question the index can answer — both fold to plain Latin letters, so
 * both are plausible keys in both directions — but a query that CARRIES one of
 * these is not an English headword, and no Serbian word is spelled `hello`. So
 * the script decides when it can, and the index decides only when it cannot
 * (`main/register.ts`'s `auto` direction states that order).
 *
 * The Cyrillic half is the whole block the Serbian alphabet lives in rather
 * than the thirty letters of that alphabet spelled out: a Cyrillic query in
 * this app is never an English headword, whichever Slavic language it came
 * from, and a hand-kept letter list is the shape that goes stale silently.
 */
export function looksSerbian(text: string): boolean {
  return SERBIAN_MARK.test(text);
}

/**
 * The Latin diacritics English does not use, in both cases, plus Cyrillic.
 *
 * Written as escapes so the source of a matching rule is readable and
 * diffable: a character class holding invisible-in-most-editors codepoints is
 * how a letter gets dropped by a well-meant edit, and `check:invisibles` exists
 * for the same family of mistakes.
 */
const SERBIAN_MARK = /[\u010c\u010d\u0106\u0107\u0160\u0161\u017d\u017e\u0110\u0111\u0400-\u04ff]/u;

/**
 * A Serbian word spelled in Latin with its diacritics kept: the Cyrillic
 * headword as a reader of the Latin interface reads it.
 *
 * This is `devtools/text.ts`'s transliteration, reused rather than restated —
 * it is the one the app's text tools use, it restores case, and it chooses between Lj and LJ by looking at the letter that follows, which a table with one uppercase spelling per letter never does. It is NOT the
 * fold: a spelling keeps č and đ, a search key drops them.
 */
export function serbianLatin(word: string): string {
  return cyrillicToLatin(word);
}
