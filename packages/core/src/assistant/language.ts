/**
 * The reply's language and script, decided by the loop rather than asked of the
 * model.
 *
 * A 2-5B model follows "answer in the language the user writes in" about as far
 * as the language of the text it has just read: the passages of a Serbian
 * Wikipedia are Cyrillic, and a question asked in English came back in Cyrillic
 * for exactly that reason. So the loop decides here, in one place, and both the
 * prompt and the streamed answer obey the decision: the prompt states it as a
 * fact, and a Latin answer is transliterated on the way out
 * ({@link transliterateToLatin}) so the script is ENFORCED and not requested.
 *
 * **Three kinds of evidence, in the order a reader would use them.** Cyrillic
 * letters are the script question answered outright. A Serbian letter that
 * English does not have is the next strongest thing after them. Only then come
 * the word lists, which are the weak evidence and are kept short on purpose: a
 * long list is a place where a real word goes missing, and one wrong entry moves
 * a decision that changes the whole answer.
 *
 * **The word lists are matched folded.** Lower-cased, `đ` folded to `dj`, the
 * combining marks stripped - the same normalisation `toolChoice.ts` folds a
 * question with, so this module's Serbian entries are written without their
 * diacritics (`sta` for `šta`). `đ` is folded by hand because it is the one
 * Serbian letter no decomposition takes apart: it is a `d` with a stroke, not a
 * `d` with a mark.
 *
 * **The fold is also what {@link contentWords} hands the citation filter.** The
 * answer's words and a passage's words have to be commensurable, and a Cyrillic
 * passage and a Latin answer are not until the transliteration runs too.
 */

import { CYRILLIC_TO_LATIN } from "../pro/tekst.js";
import type { AssistantLocale } from "./contract.js";

/** What the reply is written in. English has one script; Serbian has two. */
export interface ReplyLanguage {
  readonly language: AssistantLocale;
  readonly script: "latin" | "cyrillic";
}

/**
 * Frequent Serbian and English words, FOLDED (see the file header).
 *
 * Articles, pronouns, auxiliaries, question words and the common prepositions,
 * and nothing else. The list is deliberately short and deliberately one-sided:
 * an entry a Serbian sentence reaches for first is worth having, a word both
 * languages spell as a whole word (`do`, `to`, `pre`) is not, and a Serbian word
 * spelled in Latin is evidence for exactly one language and for no script.
 */
const SERBIAN_MARKERS: ReadonlySet<string> = new Set([
  "je", "da", "li", "se", "su", "bio", "bila", "nije", "nisu", "sam", "smo",
  "ste", "koji", "koja", "koje", "sta", "kako", "gde", "zasto", "kada",
  "zadatak", "zadatke", "u", "na", "za", "od", "sa", "ali", "ili", "jer",
  "znam", "molim",
]);

const ENGLISH_MARKERS: ReadonlySet<string> = new Set([
  "the", "what", "who", "is", "are", "was", "were", "how", "why", "where",
  "when", "which", "you", "your", "i", "can", "do", "does", "of", "in", "on",
  "at", "by", "for", "from", "with", "have", "has", "this", "that", "not",
  "there", "it", "and", "to",
]);

/**
 * The letters Serbian Latin has and English does not - `č ć š ž đ` in both
 * cases. Written as a class rather than as five characters so the count and the
 * test walk the same list, and because these letters have to be named
 * somewhere: the house check refuses a Serbian letter in a string literal
 * outside a Serbian table, and a regular expression is not one.
 */
const SERBIAN_LETTERS = /[čćšžđČĆŠŽĐ]/u;

/** One letter of one of the two scripts this module has to tell apart. */
const LETTER = /\p{L}/u;
const CYRILLIC_LETTER = /\p{Script=Cyrillic}/u;

/**
 * The language and script one turn's reply is written in.
 *
 * Cyrillic letters are the whole of the first answer, and "most" is a simple
 * majority of the letters: a Serbian answer quoting one Latin name is still
 * Cyrillic. After them, a Serbian letter decides Latin Serbian on its own, and
 * only a message with no distinctive letter at all reaches the word lists -
 * where the LARGER count wins and a tie is not evidence, because a message of
 * two words is a message this cannot read. Nothing at all (an empty message, a
 * message of digits) falls back to the app's own language.
 */
export function replyLanguage(text: string, fallback: AssistantLocale): ReplyLanguage {
  const folded = fold(text);
  let letters = 0;
  let cyrillic = 0;
  for (const character of text) {
    if (!LETTER.test(character)) continue;
    letters += 1;
    if (CYRILLIC_LETTER.test(character)) cyrillic += 1;
  }
  if (cyrillic * 2 > letters) return { language: "sr", script: "cyrillic" };
  if (SERBIAN_LETTERS.test(text)) return { language: "sr", script: "latin" };

  let serbian = 0;
  let english = 0;
  for (const word of folded.split(/[^a-z0-9]+/)) {
    if (word.length === 0) continue;
    if (SERBIAN_MARKERS.has(word)) serbian += 1;
    if (ENGLISH_MARKERS.has(word)) english += 1;
  }
  if (serbian > english) return { language: "sr", script: "latin" };
  if (english > serbian) return { language: "en", script: "latin" };
  return { language: fallback, script: "latin" };
}

/**
 * Lower-cased, with `đ` folded to `dj` and the combining marks stripped: the
 * one shape this module compares words in.
 *
 * The `đ` substitution has to come first. NFD decomposes `č ć š ž` into a base
 * letter and a mark and the strip removes the mark, but `đ` is a `d` with a
 * stroke and has no decomposition, so it would otherwise survive as a letter
 * English copy has no reason to contain.
 */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/đ/g, "dj")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** One Serbian letter pair, written out of the table `pro/tekst.ts` owns. */
const LATIN_MAP: ReadonlyMap<string, string> = new Map(
  CYRILLIC_TO_LATIN.map(([cyrillic, latin]) => [cyrillic, latin]),
);

/**
 * The answer's own Cyrillic, rewritten in Latin - the enforcement behind a
 * decided Latin script.
 *
 * **Per character, and deliberately dumber than `pro/tekst.ts`'s
 * transliteration.** That tool also decides the case of a digraph's second
 * letter from the letter after it (`Њ` before a capital is `NJ`, before a
 * lowercase letter `Nj`), which is a decision about a context this function does
 * not have: a token chunk arrives on its own, and the chunk after it has not
 * been written yet. A capital digraph therefore becomes `Nj` here, in the middle
 * of a word as well as at its start, and the property that matters holds instead
 * - transliterating each chunk on its own and joining the results is the same
 * text as transliterating the whole answer, which is what a page drawing `token`
 * events and a store holding the final `message` have to agree on.
 *
 * A character outside the table is copied through unchanged, which is the right
 * answer for a letter the Serbian alphabet does not have and not a gap in this
 * one: only the letters whose Latin spelling is unambiguous are rewritten.
 */
export function transliterateToLatin(text: string): string {
  if (!CYRILLIC_LETTER.test(text)) return text;
  let out = "";
  for (const character of text) {
    const lower = LATIN_MAP.get(character.toLowerCase());
    if (lower === undefined) {
      out += character;
      continue;
    }
    // Only the FIRST letter is capitalised: `Њ` is `Nj`, not `NJ`. The case of a
    // digraph's second letter is a question about the letters AROUND it, which
    // this per-character function deliberately cannot answer.
    out +=
      character === character.toLowerCase()
        ? lower
        : `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
  }
  return out;
}

/**
 * The content words of a piece of text: lower-cased, Cyrillic transliterated to
 * Latin, diacritics folded, split on anything that is not a letter or a digit,
 * and only the words of at least four characters.
 *
 * Four is the shortest word two texts can be said to share: below it, `na`/`an`
 * and `je`/`he` are accidents rather than evidence. Serbian inflection moves a
 * word's ending and not its first four letters, which is why two content words
 * are compared by that prefix rather than in full.
 */
export function contentWords(text: string): readonly string[] {
  return fold(transliterateToLatin(text))
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4);
}
