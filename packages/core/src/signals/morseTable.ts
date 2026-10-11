/**
 * The ITU Morse alphabet, as data.
 *
 * One row per signal, in the order Annex 1 of ITU-R M.1677-1 prints them:
 * letters, figures, punctuation and miscellaneous signs, then the procedural
 * signals that are not characters at all. The table is kept apart from the
 * engine so that every reader of Morse in this product — the encoder, the
 * decoder, and stage 2's alphabet legend — reads one list.
 *
 * A `char` of `null` marks a procedural signal: it is transmitted as a run of
 * marks with no gaps inside it, and it is not a character of any text, so it
 * has `symbol` (how it is printed) and `name` (what it means) instead. `symbol`
 * on the punctuation rows is what stage 2 puts on a key, and on the rows that
 * end a transmission it is the mark itself; treating the two the same is what
 * lets one table drive both the legend and the keyboard.
 */

export interface MorseCharacter {
  /**
   * The character this signal stands for, or null for a procedural signal.
   * Rows with a character are unique by it; procedural signals are looked up by
   * `code` because two of them share a character's code.
   */
  readonly char: string | null;
  /** The signal, dots and dashes only. */
  readonly code: string;
  /** The printed sign: the character itself, or the prosign. */
  readonly symbol: string;
  /** The name the Recommendation gives this signal. */
  readonly name: string;
}

const letters: readonly MorseCharacter[] = [
  ["A", ".-"],
  ["B", "-..."],
  ["C", "-.-."],
  ["D", "-.."],
  ["E", "."],
  ["F", "..-."],
  ["G", "--."],
  ["H", "...."],
  ["I", ".."],
  ["J", ".---"],
  ["K", "-.-"],
  ["L", ".-.."],
  ["M", "--"],
  ["N", "-."],
  ["O", "---"],
  ["P", ".--."],
  ["Q", "--.-"],
  ["R", ".-."],
  ["S", "..."],
  ["T", "-"],
  ["U", "..-"],
  ["V", "...-"],
  ["W", ".--"],
  ["X", "-..-"],
  ["Y", "-.--"],
  ["Z", "--.."],
].map(([char, code]) => ({ char, code, symbol: char, name: char } as MorseCharacter));

const figures: readonly MorseCharacter[] = [
  ["1", ".----"],
  ["2", "..---"],
  ["3", "...--"],
  ["4", "....-"],
  ["5", "....."],
  ["6", "-...."],
  ["7", "--..."],
  ["8", "---.."],
  ["9", "----."],
  ["0", "-----"],
].map(([char, code]) => ({ char, code, symbol: char, name: char } as MorseCharacter));

/**
 * §1.1.3 — punctuation marks and miscellaneous signs. `char` is the ASCII
 * character the sign stands for; the quotation mark is the straight ASCII one
 * even though the Recommendation prints a curly pair, because a keyboard
 * produces the straight one and one of two spellings is already one too many.
 * „Multiplication sign" is `-..-.` and the fraction bar is `-..-.`; the two are
 * distinct in the standard, which is worth saying because they differ by one
 * mark at the end and a table copied from an amateur list has them the same.
 */
const punctuation: readonly MorseCharacter[] = [
  { char: ".", code: ".-.-.-", symbol: ".", name: "Full stop (period)" },
  { char: ",", code: "--..--", symbol: ",", name: "Comma" },
  { char: ":", code: "---...", symbol: ":", name: "Colon or division sign" },
  { char: "?", code: "..--..", symbol: "?", name: "Question mark" },
  { char: "'", code: ".----.", symbol: "'", name: "Apostrophe" },
  { char: "-", code: "-....-", symbol: "-", name: "Hyphen, dash or subtraction sign" },
  { char: "/", code: "-..-.", symbol: "/", name: "Fraction bar or division sign" },
  { char: "(", code: "-.--.", symbol: "(", name: "Left-hand bracket" },
  { char: ")", code: "-.--.-", symbol: ")", name: "Right-hand bracket" },
  { char: "\"", code: ".-..-.", symbol: "\"", name: "Inverted commas (quotation marks)" },
  { char: "=", code: "-...-", symbol: "=", name: "Double hyphen" },
  { char: "+", code: ".-.-.", symbol: "+", name: "Cross or addition sign" },
  { char: "@", code: ".--.-.", symbol: "@", name: "Commercial at" },
];

/**
 * The procedural signals. They are sent as one run of marks, so `.*` and the
 * letters it is built from share a code — the receiver knows which one was meant
 * from its position, and the decoder below therefore reads them as the letters.
 */
const prosigns: readonly MorseCharacter[] = [
  { char: null, code: "...-.", symbol: "SN", name: "Understood" },
  { char: null, code: "........", symbol: "HH", name: "Error" },
  { char: null, code: ".-.-.", symbol: "+", name: "Invitation to transmit" },
  { char: null, code: ".-...", symbol: "AS", name: "Wait" },
  { char: null, code: "...-.-", symbol: "SK", name: "End of work" },
  { char: null, code: "-.-.-", symbol: "KA", name: "Starting signal" },
];

/** Every signal, in Annex 1's order. */
export const MORSE_ALPHABET: readonly MorseCharacter[] = [
  ...letters,
  ...figures,
  ...punctuation,
  ...prosigns,
];

/**
 * Lookup by character. Built here rather than in the engine so the two cannot
 * disagree about what a character's code is; the prosigns are absent because
 * they have no character to be keyed by.
 */
export const MORSE_BY_CHARACTER: ReadonlyMap<string, MorseCharacter> = new Map(
  MORSE_ALPHABET.filter((entry) => entry.char !== null).map((entry) => [entry.char as string, entry]),
);

/**
 * Lookup by code. A CHARACTER wins over the procedural signal that shares its
 * code — `.-.-.` is `+` before it is „invitation to transmit" — because the
 * signals are written as a character's marks on purpose and the receiver's
 * position is what says which was meant, never the marks. The table is
 * therefore walked with the signals first and the characters second, so a
 * character overwrites the signal whose code it holds; `........` is the one
 * code no character has, and it comes back as the error signal.
 *
 * No two characters share a code. The multiplication sign has no row of its
 * own: §3.2.1 sends it as the letter X, so it is a transliteration
 * (`MORSE_TRANSLITERATIONS`), like `%` and `‰` (§3.3.1).
 */
export const MORSE_BY_CODE: ReadonlyMap<string, MorseCharacter> = new Map(
  [
    ...MORSE_ALPHABET.filter((entry) => entry.char === null),
    ...MORSE_ALPHABET.filter((entry) => entry.char !== null),
  ].map((entry) => [entry.code, entry]),
);
