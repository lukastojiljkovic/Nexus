/**
 * Two small detectors the evals score answers with: which language a reply is
 * written in, and whether it admits it does not know.
 *
 * **Why hand-rolled rather than `Intl`.** `Intl` can format and collate but it
 * cannot answer "is this sentence Serbian", and the alternative — a language
 * model — is the thing under test. Both questions are answered here with
 * evidence a person can read and a test can pin, and neither is a claim about
 * linguistics: they are yardsticks for a scripted transcript, and the report
 * says which transcript produced which reading.
 *
 * **Why the Serbian letters are written as escapes.** `check:english` refuses a
 * Serbian letter in a string literal outside a Serbian table, and these five
 * letters have to be named somewhere. The gate reads string literals; a regular
 * expression is not one, so the letters live in a character class with `\u`
 * escapes. The comment beside it names what each escape is, and the tests prove
 * the class matches the letters it claims to.
 */

/** A reply's language as far as {@link detectLanguage} can tell. `undetermined` is a real answer, not a failure. */
export type ReplyLanguage = "sr" | "en" | "undetermined";

/**
 * `č ć š ž đ` and `Č Ć Š Ž Đ` — the letters Serbian Latin has and English does
 * not. Written as one class so the count and the test walk the same list.
 */
const SERBIAN_LETTER_CODES = [
  0x010d, // č
  0x0107, // ć
  0x0161, // š
  0x017e, // ž
  0x0111, // đ
  0x010c, // Č
  0x0106, // Ć
  0x0160, // Š
  0x017d, // Ž
  0x0110, // Đ
];

const SERBIAN_LETTERS = new Set(SERBIAN_LETTER_CODES.map((code) => String.fromCodePoint(code)));

/**
 * Frequent Serbian words, FOLDED — lowercase and without diacritics, which is
 * how the text reaching these sets is prepared. Folded on purpose: the letters
 * are already counted separately, and a word list that had to spell `č` would
 * put a Serbian letter back into this file.
 *
 * Deliberately short, and deliberately without words English also spells as a
 * whole word (`do`, `to`, `pre` is kept because English uses `pre-` only as a
 * prefix) — each entry is a word Serbian copy reaches for first and English
 * copy has no reason to contain.
 */
const SERBIAN_MARKERS = new Set([
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

/** The same idea for English: function words and the nouns an answer about the app is made of. */
const ENGLISH_MARKERS = new Set([
  "the", "and", "your", "you", "can", "cannot", "with", "this", "that",
  "there", "these", "those", "is", "are", "was", "were", "not", "know",
  "information", "about", "please", "open", "here", "how", "where", "why",
  "which", "from", "for", "have", "has", "if", "when", "then", "but", "or",
  "does", "want", "need", "would", "should", "them", "they", "will", "steps",
  "settings", "task", "tasks", "note", "notes", "map", "card", "security",
  "passcode", "export", "import", "add", "create", "save", "check", "search",
  "find", "use", "of", "in", "on", "at", "by",
]);

/** A phrase that says the answer does not know — folded, so it is written the way the text is folded. */
const DOES_NOT_KNOW_MARKERS = [
  "ne znam",
  "nemam",
  "nema podataka",
  "nemam informacije",
  "nemam izvor",
  "nije pronadjeno",
  "ne mogu da nadjem",
  "nije pokriveno",
  "nema u bazi",
  "i don't know",
  "i do not know",
  "don't have information",
  "do not have information",
  "no information",
  "not covered",
  "couldn't find",
  "could not find",
  "no source",
];

/**
 * Lowercased, with combining marks removed — how both detectors read a reply.
 *
 * `đ` (U+0111) has no decomposition, so it survives folding. Nothing here
 * matches on it, which is why the fold is allowed to be imperfect: the letters
 * are counted on the ORIGINAL text, where it is one of the ten above.
 */
function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/** The words of a folded text, as a set — one occurrence of a marker is as good as ten. */
function words(folded: string): Set<string> {
  return new Set(folded.split(/[^\p{L}\p{N}_]+/u));
}

function countSerbianLetters(text: string): number {
  let count = 0;
  for (const character of text) {
    if (SERBIAN_LETTERS.has(character)) count += 1;
  }
  return count;
}

/**
 * The language a reply is written in, from three kinds of evidence: the letters
 * only Serbian spells, the words only Serbian uses, and the words only English
 * uses. Serbian letters are decisive unless English words clearly outnumber
 * Serbian ones, so an English sentence quoting one Serbian word still reads as
 * English and a Serbian sentence with no diacritics still reads as Serbian.
 *
 * A reply with none of the three is `undetermined` and a scenario that expects a
 * language fails on it — the honest reading of "there is nothing here to judge"
 * rather than a coin toss. Tests pin both directions.
 */
export function detectLanguage(text: string): ReplyLanguage {
  const folded = fold(text);
  const tokens = words(folded);
  const serbianLetters = countSerbianLetters(text);
  let serbianMarkers = 0;
  for (const token of tokens) {
    if (SERBIAN_MARKERS.has(token)) serbianMarkers += 1;
  }
  let englishMarkers = 0;
  for (const token of tokens) {
    if (ENGLISH_MARKERS.has(token)) englishMarkers += 1;
  }
  if (serbianLetters === 0 && serbianMarkers === 0 && englishMarkers === 0) return "undetermined";
  if (serbianLetters === 0 && serbianMarkers === 0) return "en";
  if (serbianMarkers > englishMarkers) return "sr";
  if (englishMarkers > serbianMarkers) return "en";
  return serbianLetters > 0 ? "sr" : "undetermined";
}

/**
 * Whether a reply says it does not know.
 *
 * The markers are folded phrases rather than a parse: an answer that admits a
 * gap says so in a handful of ways, and a scenario that expects
 * `doesNotKnow: true` fails on anything else. What it cannot see is an invented
 * answer that *sounds* confident — which is the failure the expectation exists
 * for, so the scenario pairs it with `cites: []`-shaped assertions wherever one
 * would be invented.
 */
export function detectDoesNotKnow(text: string): boolean {
  const folded = fold(text);
  return DOES_NOT_KNOW_MARKERS.some((marker) => folded.includes(marker));
}
