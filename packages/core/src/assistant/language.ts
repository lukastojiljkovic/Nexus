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

/** What {@link detectAnswerLanguage} could tell about a text. */
export type AnswerLanguage = AssistantLocale | "undetermined";

/** What {@link detectAnswerScript} could tell about a text. English has one script; Serbian has two. */
export type AnswerScript = "latin" | "cyrillic";

/**
 * The words the answer check reads a LANGUAGE from, folded. These are the lists
 * the evals have always scored a reply with (`evals/language.ts` re-exports the
 * detector they feed), so a scenario and a turn read an answer the same way.
 */
const ANSWER_SERBIAN_MARKERS: ReadonlySet<string> = new Set([
  "ne", "nije", "nisam", "nemam", "znam", "mogu", "mozes", "moze", "mozemo",
  "treba", "korak", "koraka", "koraci", "prvo", "zatim", "posle", "pre",
  "kada", "ako", "ukoliko", "jer", "ali", "ili", "ovde", "tamo", "sada",
  "tvoj", "tvoja", "tvoje", "vas", "vasa", "vase", "nas", "nase", "sto",
  "kako", "gde", "zasto", "koji", "koja", "koje", "ovaj", "ova", "ovo",
  "postoji", "postoje", "otvori", "otvorite", "izaberi", "proveri", "podesi",
  "podesavanja", "podesavanje", "obavestenje", "zadatak", "zadatke", "lista",
  "listu", "kartica", "karticu", "mapa", "mapi", "pozovi", "slucaju", "hitno",
  "pomoc", "informacije", "korisnik", "korisnika", "bezbednost", "sifra",
  "sifru", "izvoz", "izvezi", "uvoz", "dodaj", "dodajte", "napravi",
  "napravite", "sacuvaj", "unesi", "unesite", "podaci", "vreme", "vremena",
  "lokacija", "adresa", "greska", "mreza", "mrezu", "uredjaj",
]);

const ANSWER_ENGLISH_MARKERS: ReadonlySet<string> = new Set([
  "the", "and", "your", "you", "can", "cannot", "with", "this", "that",
  "there", "these", "those", "is", "are", "was", "were", "not", "know",
  "information", "about", "please", "open", "here", "how", "where", "why",
  "which", "from", "for", "have", "has", "if", "when", "then", "but", "or",
  "does", "want", "need", "would", "should", "them", "they", "will", "steps",
  "settings", "task", "tasks", "note", "notes", "map", "card", "security",
  "passcode", "export", "import", "add", "create", "save", "check", "search",
  "find", "use", "of", "in", "on", "at", "by",
]);

/**
 * The share of an answer's letters that must be Cyrillic before it reads as
 * Cyrillic.
 *
 * A POLICY number, not a measurement, and deliberately half: an answer quoting
 * one Cyrillic title among Latin sentences is a Latin answer, and an answer
 * whose letters are mostly Cyrillic has chosen Cyrillic for this reader. A text
 * with no letters at all reads Latin.
 */
const ANSWER_CYRILLIC_SHARE = 0.5;

/**
 * The language an answer is written in.
 *
 * Cyrillic is Serbian: the app has no other Cyrillic reply. Otherwise the three
 * kinds of evidence, strongest first: a Serbian letter English does not have
 * (`č ć š ž đ`), then the word lists. A Serbian letter decides only when no
 * English word outnumbers the Serbian ones, so an English answer quoting one
 * Serbian title (`Preživljavanje`) still reads as English. A text with no
 * evidence either way is `undetermined`, which the loop does not treat as a
 * mismatch: the check is for a sentence that is clearly in the other language.
 *
 * This is the detector the evals score answers with (`evals/language.ts`) and the
 * loop compares a reply against, so the two read an answer the same way.
 */
export function detectAnswerLanguage(text: string): AnswerLanguage {
  if (detectAnswerScript(text) === "cyrillic") return "sr";
  const serbianLetters = SERBIAN_LETTERS.test(text);
  let serbianMarkers = 0;
  let englishMarkers = 0;
  for (const word of new Set(fold(text).split(/[^\p{L}\p{N}_]+/u))) {
    if (ANSWER_SERBIAN_MARKERS.has(word)) serbianMarkers += 1;
    if (ANSWER_ENGLISH_MARKERS.has(word)) englishMarkers += 1;
  }
  if (!serbianLetters && serbianMarkers === 0 && englishMarkers === 0) return "undetermined";
  if (!serbianLetters && serbianMarkers === 0) return "en";
  if (serbianMarkers > englishMarkers) return "sr";
  if (englishMarkers > serbianMarkers) return "en";
  return serbianLetters ? "sr" : "undetermined";
}

/**
 * The script an answer is written in, from the share of its letters that are
 * Cyrillic. Digits, punctuation and spaces are not letters and say nothing, and
 * a text with no letters at all reads Latin.
 */
export function detectAnswerScript(text: string): AnswerScript {
  let cyrillic = 0;
  let letters = 0;
  for (const character of text) {
    if (!LETTER.test(character)) continue;
    letters += 1;
    if (CYRILLIC_LETTER.test(character)) cyrillic += 1;
  }
  return letters > 0 && cyrillic / letters >= ANSWER_CYRILLIC_SHARE ? "cyrillic" : "latin";
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

/**
 * One Latin letter or digraph of the Serbian alphabet, and the Cyrillic letter
 * it is written as - built by inverting the same table `pro/tekst.ts` owns, so
 * the two directions cannot disagree about a letter. Only the letters the
 * Serbian alphabet has are here; a letter it does not have (`q`, `w`, `x`, `y`)
 * is copied through unchanged, which is the right answer for a name rather than
 * a gap.
 */
const TO_CYRILLIC: ReadonlyMap<string, string> = new Map(
  CYRILLIC_TO_LATIN.map(([cyrillic, latin]) => [latin, cyrillic]),
);

/** The keys of {@link TO_CYRILLIC}, longest first, so `lj` is read before `l`. */
const LATIN_LETTERS: readonly string[] = [...TO_CYRILLIC.keys()].sort(
  (left, right) => right.length - left.length,
);

/** One word rewritten letter by letter, with the case it was written in. */
function wordToCyrillic(word: string): string {
  let out = "";
  let index = 0;
  while (index < word.length) {
    const key = LATIN_LETTERS.find(
      (candidate) =>
        word.startsWith(candidate, index) || word.startsWith(candidate.toUpperCase(), index),
    );
    if (key === undefined) {
      out += word[index];
      index += 1;
      continue;
    }
    const written = word.slice(index, index + key.length);
    const cyrillic = TO_CYRILLIC.get(key) ?? key;
    out += written === key ? cyrillic : cyrillic.toUpperCase();
    index += key.length;
  }
  return out;
}

/**
 * The runs of a text that are not prose and must survive transliteration
 * untouched: a code span (fenced by one, two or three backticks), a URL, an
 * email address, a thing named the way this app names its tools
 * (`tasks.create`), and a citation marker (`[1]`).
 *
 * Every alternative is linear on any input. The three fences are spelled out
 * rather than matched as a run and its back-reference, which backtracks over a
 * long run of backticks. The two that start with a repeated class are bounded,
 * because the search starts again at every character of a long run that never
 * reaches the `@` or the `.`: an email's local part at RFC 5321's 64, and an
 * identifier's first name at the same 64, a policy choice no tool name nears.
 */
const PROTECTED =
  /```[^`]*```|``[^`]*``|`[^`]*`|https?:\/\/[^\s]+|www\.[^\s]+|[\w.+-]{1,64}@[\w.-]+|[\p{L}\p{N}_]{1,64}(?:\.[\p{L}\p{N}_]+)+|\[\d+\]/gu;

/**
 * The answer's own Serbian Latin, rewritten in Cyrillic - the other half of
 * {@link transliterateToLatin}, and what `verify.ts` leans on when the model
 * answers a Serbian question in the wrong script.
 *
 * **A word is transliterated whole or not at all.** Mixed script inside one
 * word is worse than a word left in Latin, so the unit here is a word: a word
 * carrying a letter only Serbian Latin has (`č ć š ž đ`, either case) is
 * rewritten entirely, and every other word is left exactly as it was. That is
 * what keeps a product name, a hostname and an English word out of the rewrite
 * without a dictionary of names.
 *
 * **What is skipped, and why it is named here.** Four kinds of run are never
 * touched: a code span, a URL or an email address, a dot-joined identifier
 * (`tasks.create` - the app's own tool names), and a citation marker (`[1]`,
 * which a source is matched by). Each is something the reader is meant to read
 * literally, and a transliterated hostname is a link that no longer works.
 * Unlike `transliterateToLatin`, this direction is a REPAIR and not a mirror:
 * it runs on the model's answer, where a Latin word of the other language may
 * well be sitting beside a Serbian one.
 */
export function transliterateToCyrillic(text: string): string {
  if (!SERBIAN_LETTERS.test(text)) return text;
  let out = "";
  let index = 0;
  for (const match of text.matchAll(PROTECTED)) {
    const start = match.index;
    out += rewriteWords(text.slice(index, start));
    out += match[0];
    index = start + match[0].length;
  }
  return `${out}${rewriteWords(text.slice(index))}`;
}

/** One run of prose: every word carrying a Serbian letter rewritten, the rest kept. */
function rewriteWords(prose: string): string {
  return prose.replace(/[^\s]+/gu, (word) =>
    SERBIAN_LETTERS.test(word) ? wordToCyrillic(word) : word,
  );
}
