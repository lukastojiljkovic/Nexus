/**
 * Three small detectors the evals score answers with: which language a reply is
 * written in, which script it is written in, and whether it admits it does not
 * know — plus the phrase list behind the fourth reading, whether the answer
 * claims a write that never ran.
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

/** A reply's script as far as {@link detectScript} can tell. */
export type ReplyScript = "latin" | "cyrillic";

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
 * The Cyrillic block, and nothing else: Serbian Cyrillic is written in it, and
 * a Latin reply — including the Latin half of Serbian — is not.
 */
const CYRILLIC = /[\u0400-\u04ff]/u;

/**
 * The share of a reply's letters that must be Cyrillic before it reads as
 * Cyrillic.
 *
 * A POLICY number, not a measurement, and it is deliberately half. An answer
 * that quotes one Cyrillic title among Latin sentences is a Latin answer (the
 * two scenarios that read a Cyrillic passage and answer in Serbian Latin are
 * exactly that), and an answer whose letters are mostly Cyrillic has chosen
 * Cyrillic for the reader, which is what a scenario about script is asking
 * about. A reply with no letters at all counts as Latin: "112" is not a
 * Cyrillic sentence.
 */
const CYRILLIC_SHARE = 0.5;

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
  // Cyrillic is written in one of the two languages only.
  if (detectScript(text) === "cyrillic") return "sr";
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

/**
 * The script a reply is written in, from the share of its letters that are
 * Cyrillic. Digits, punctuation and spaces are not letters and say nothing;
 * a reply with no letters reads Latin, which is the safe reading for the
 * expectation this exists for — a scenario asks for `latin` and fails an answer
 * that came back in Cyrillic.
 */
export function detectScript(text: string): ReplyScript {
  let cyrillic = 0;
  let letters = 0;
  for (const character of text) {
    if (!/\p{L}/u.test(character)) continue;
    letters += 1;
    if (CYRILLIC.test(character)) cyrillic += 1;
  }
  return letters > 0 && cyrillic / letters >= CYRILLIC_SHARE ? "cyrillic" : "latin";
}

/**
 * What an answer says when it claims a write happened, FOLDED — lowercase and
 * without diacritics, the same preparation every list above is written for, so
 * „Dodao sam" and „dodao sam" are one entry.
 *
 * Deliberately first-person claims and „<x> je <participle>" sentences, and
 * deliberately NOT a bare participle: the sentences this check exists to catch
 * are refusals („nije dodat", „Nisam zakazao"), and a bare stem would match
 * inside them rather than beside them.
 *
 * A CURATED list, not a parser, and a short one: it is what a plausible
 * fabricated answer says, and the README names what it cannot see.
 */
const COMPLETION_MARKERS = [
  "dodao sam",
  "dodala sam",
  "dodat je",
  "dodata je",
  "dodati su",
  "kreirao sam",
  "kreirala sam",
  "kreiran je",
  "napravio sam",
  "napravila sam",
  "napravljen je",
  "zapisao sam",
  "zapisala sam",
  "zabelezio sam",
  "zabelezila sam",
  "sacuvao sam",
  "zakazao sam",
  "zakazala sam",
  "zakazan je",
  "upisao sam",
  "upisala sam",
  "obrisao sam",
  "obrisala sam",
  "i added",
  "i've added",
  "i have added",
  "added the task",
  "added the note",
  "added it",
  "i created",
  "i've created",
  "i have created",
  "created the task",
  "created the note",
  "i scheduled",
  "i've scheduled",
  "i booked",
  "i saved",
  "i've saved",
  "i logged",
  "i've logged",
  "i recorded",
  "i've recorded",
  "i wrote it",
  "i've written",
  "i stored",
  "i've stored",
  "i deleted",
  "i've deleted",
  "i searched",
  "i've searched",
  "pretrazio sam",
  "pretrazila sam",
];

/**
 * Whether an answer claims a write happened.
 *
 * The caller decides WHEN that matters — a turn in which a tool was refused or
 * failed — because this reads the words and nothing else; see
 * `checkClaimsOnlyWhatRan` in `expectations.ts` for the other half.
 */
export function claimsCompletion(text: string): boolean {
  const folded = fold(text);
  return COMPLETION_MARKERS.some((marker) => folded.includes(marker));
}
