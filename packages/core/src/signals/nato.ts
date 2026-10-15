/**
 * The NATO (ICAO) spelling alphabet: letters and digits as the words a radio
 * operator says them, encoded and decoded.
 *
 * **The words are ICAO's.** Annex 10, Volume II spells the letter words, and
 * this table uses its spellings where they differ from the common ones: Alfa,
 * not Alpha, and Juliett, not Juliet. The digit words are ICAO's pronunciations
 * (Tree, Fower, Fife, Niner), which are what is said on the air. Decoding also
 * takes the common spellings,
 * because a reader who typed what they heard should not be refused for spelling
 * a word the way a dictionary does.
 *
 * **Serbian letters are transliterated, and the transliteration is reported**
 * (`serbianLatin.ts`), so č is sent as Charlie and đ as Delta Juliett.
 *
 * **Encoding is one word per character, with a slash between words of the text.**
 * The slash is what a radio operator says as a pause, and it keeps a decode from
 * having to guess where one word ends and the next begins.
 */

import { SERBIAN_TRANSLITERATIONS } from "./serbianLatin.js";

const LETTER_WORDS: Readonly<Record<string, string>> = {
  A: "Alfa",
  B: "Bravo",
  C: "Charlie",
  D: "Delta",
  E: "Echo",
  F: "Foxtrot",
  G: "Golf",
  H: "Hotel",
  I: "India",
  J: "Juliett",
  K: "Kilo",
  L: "Lima",
  M: "Mike",
  N: "November",
  O: "Oscar",
  P: "Papa",
  Q: "Quebec",
  R: "Romeo",
  S: "Sierra",
  T: "Tango",
  U: "Uniform",
  V: "Victor",
  W: "Whiskey",
  X: "X-ray",
  Y: "Yankee",
  Z: "Zulu",
};

const DIGIT_WORDS: Readonly<Record<string, string>> = {
  "0": "Zero",
  "1": "One",
  "2": "Two",
  "3": "Tree",
  "4": "Fower",
  "5": "Fife",
  "6": "Six",
  "7": "Seven",
  "8": "Eight",
  "9": "Niner",
};

/** The spellings a decode accepts beside ICAO's, keyed by the word in capitals. */
const ALTERNATIVE_WORDS: Readonly<Record<string, string>> = {
  ALPHA: "A",
  JULIET: "J",
};

const CHAR_FOR_WORD: ReadonlyMap<string, string> = new Map([
  ...Object.entries(LETTER_WORDS).map(([char, word]) => [word.toUpperCase(), char] as const),
  ...Object.entries(DIGIT_WORDS).map(([char, word]) => [word.toUpperCase(), char] as const),
  ...Object.entries(ALTERNATIVE_WORDS).map(([word, char]) => [word, char] as const),
]);

/** What `encodeNato` answers: the spoken words and what it could not send. */
export interface NatoEncoding {
  /** The words, one per character, with a slash between the words of the text. */
  readonly spoken: string;
  /** Each Serbian letter that was sent as another one, in the order first met. */
  readonly transliterated: readonly string[];
  /** Each character that has no word and no transliteration, in the order first met. */
  readonly unsupported: readonly string[];
}

/** The NATO word for one letter or digit, or null when it has none. */
export function natoWordFor(char: string): string | null {
  const key = char.toUpperCase();
  return LETTER_WORDS[key] ?? DIGIT_WORDS[key] ?? null;
}

export function encodeNato(text: string): NatoEncoding {
  const transliterated: string[] = [];
  const unsupported: string[] = [];
  const note = (list: string[], char: string): void => {
    if (!list.includes(char)) list.push(char);
  };

  const groups: string[] = [];
  for (const word of text.trim().split(/\s+/)) {
    if (word === "") continue;
    const spoken: string[] = [];
    for (const char of word.toLowerCase()) {
      const sent = SERBIAN_TRANSLITERATIONS[char] ?? char;
      const words = [...sent].map(natoWordFor);
      if (words.some((spelled) => spelled === null)) {
        note(unsupported, char);
        continue;
      }
      if (sent !== char) note(transliterated, char);
      spoken.push(...(words as string[]));
    }
    if (spoken.length > 0) groups.push(spoken.join(" "));
  }
  return { spoken: groups.join(" / "), transliterated, unsupported };
}

/** What `decodeNato` answers: the text, with `?` where a word was not one of the alphabet's, and those words. */
export interface NatoDecoding {
  readonly text: string;
  readonly unknown: readonly string[];
}

export function decodeNato(spoken: string): NatoDecoding {
  const unknown: string[] = [];
  const groups = spoken.split("/").map((group) =>
    group
      .trim()
      .split(/\s+/)
      .filter((word) => word !== "")
      .map((word) => {
        const char = CHAR_FOR_WORD.get(word.toUpperCase());
        if (char !== undefined) return char;
        unknown.push(word);
        return "?";
      })
      .join(""),
  );
  return { text: groups.filter((group) => group !== "").join(" "), unknown };
}
