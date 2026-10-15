/**
 * Grade 1 (uncontracted) English Braille: letters, digits and the space, encoded
 * to Unicode Braille cells and decoded back.
 *
 * **The cells are the Unicode Braille Patterns block, U+2800–U+28FF.** A cell is
 * six dots, and the code point is `0x2800` plus the sum of the dots' values:
 * dot 1 is 1, dot 2 is 2, dot 3 is 4, dot 4 is 8, dot 5 is 16 and dot 6 is 32.
 * The dot pattern of every letter is the standard Grade 1 pattern, written here as the
 * dots 1 to 6 in order, `1` for a raised dot. The space is the blank cell,
 * U+2800.
 *
 * **Two indicators, and both are the standard's.** The capital sign is dot 6
 * (U+2820) before a capital letter. The numeric sign is dots 3-4-5-6 (U+283C)
 * before a run of digits. Digits are the letters a–j with the numeric sign in
 * front, so 1 is a, 2 is b, and 0 is j. The numeric mode ends at the next space
 * or at a character that is not a–j, which is the rule the decoder follows.
 *
 * **A letter directly after digits, in the same word, is not encoded.** The
 * standard sends it with a letter indicator, and an indicator this table has not
 * been checked against is not added from memory. Such a character is reported as
 * unsupported rather than sent as a digit.
 *
 * **Serbian letters are transliterated, and the transliteration is reported**
 * (`serbianLatin.ts`). Serbian Braille has its own cells for them, and they are
 * not encoded here.
 */

import { SERBIAN_TRANSLITERATIONS } from "./serbianLatin.js";

/** The blank cell, which is the space. */
export const BRAILLE_SPACE = "⠀";
/** Dot 6: the next letter is a capital. */
export const BRAILLE_CAPITAL = "⠠";
/** Dots 3-4-5-6: what follows is a number, until a space or a character that is not a–j. */
export const BRAILLE_NUMERIC = "⠼";

/** The dots of each letter, dots 1 to 6, with `1` for a raised dot. */
const LETTER_DOTS: Readonly<Record<string, string>> = {
  a: "100000",
  b: "110000",
  c: "100100",
  d: "100110",
  e: "100010",
  f: "110100",
  g: "110110",
  h: "110010",
  i: "010100",
  j: "010110",
  k: "101000",
  l: "111000",
  m: "101100",
  n: "101110",
  o: "101010",
  p: "111100",
  q: "111110",
  r: "111010",
  s: "011100",
  t: "011110",
  u: "101001",
  v: "111001",
  w: "010111",
  x: "101101",
  y: "101111",
  z: "101011",
};

/** The cell for a dot pattern, as its Unicode Braille Patterns character. */
function cellFor(dots: string): string {
  const value = [...dots].reduce((sum, dot, index) => sum + (dot === "1" ? 2 ** index : 0), 0);
  return String.fromCodePoint(0x2800 + value);
}

const CELL_FOR_LETTER: ReadonlyMap<string, string> = new Map(
  Object.entries(LETTER_DOTS).map(([letter, dots]) => [letter, cellFor(dots)]),
);

const LETTER_FOR_CELL: ReadonlyMap<string, string> = new Map(
  [...CELL_FOR_LETTER].map(([letter, cell]) => [cell, letter] as const),
);

/** In numeric mode the letters a–j stand for the digits 1 to 9 and then 0. */
const NUMERIC_LETTERS = "abcdefghij";
const CELL_FOR_DIGIT: ReadonlyMap<string, string> = new Map(
  [...NUMERIC_LETTERS].map((letter, index) => [String((index + 1) % 10), CELL_FOR_LETTER.get(letter) ?? ""] as const),
);
const DIGIT_FOR_LETTER: ReadonlyMap<string, string> = new Map(
  [...NUMERIC_LETTERS].map((letter, index) => [letter, String((index + 1) % 10)] as const),
);

/** What `encodeBraille` answers: the cells and what it could not send. */
export interface BrailleEncoding {
  readonly cells: string;
  /** Each Serbian letter that was sent as other letters, in the order first met. */
  readonly transliterated: readonly string[];
  /** Each character that has no cell, in the order first met. */
  readonly unsupported: readonly string[];
}

export function encodeBraille(text: string): BrailleEncoding {
  const transliterated: string[] = [];
  const unsupported: string[] = [];
  const note = (list: string[], char: string): void => {
    if (!list.includes(char)) list.push(char);
  };

  let cells = "";
  let inNumber = false;
  for (const char of text) {
    if (/\s/.test(char)) {
      cells += BRAILLE_SPACE;
      inNumber = false;
      continue;
    }
    const lower = char.toLowerCase();
    const sent = SERBIAN_TRANSLITERATIONS[lower] ?? lower;
    if (sent !== lower) note(transliterated, char);
    let capital = char !== lower;
    for (const piece of sent) {
      if (/[0-9]/.test(piece)) {
        if (!inNumber) cells += BRAILLE_NUMERIC;
        cells += CELL_FOR_DIGIT.get(piece) ?? "";
        inNumber = true;
        continue;
      }
      // A letter a–j straight after digits would be read back as a digit, and
      // the standard sends it behind a letter indicator this table does not carry.
      const cell = CELL_FOR_LETTER.get(piece);
      if (cell === undefined || (inNumber && DIGIT_FOR_LETTER.has(piece))) {
        note(unsupported, char);
        continue;
      }
      if (capital) cells += BRAILLE_CAPITAL;
      capital = false;
      cells += cell;
      inNumber = false;
    }
  }
  return { cells, transliterated, unsupported };
}

/** What `decodeBraille` answers: the text, with `?` for a cell that is not a letter, a digit or a space. */
export interface BrailleDecoding {
  readonly text: string;
  readonly unknown: readonly string[];
}

export function decodeBraille(cells: string): BrailleDecoding {
  const unknown: string[] = [];
  let text = "";
  let capital = false;
  let numeric = false;
  for (const cell of cells) {
    if (cell === BRAILLE_SPACE) {
      text += " ";
      numeric = false;
      continue;
    }
    if (cell === BRAILLE_CAPITAL) {
      capital = true;
      continue;
    }
    if (cell === BRAILLE_NUMERIC) {
      numeric = true;
      continue;
    }
    const letter = LETTER_FOR_CELL.get(cell);
    if (letter === undefined) {
      unknown.push(cell);
      text += "?";
    } else if (numeric && DIGIT_FOR_LETTER.has(letter)) {
      text += DIGIT_FOR_LETTER.get(letter) ?? "?";
    } else {
      numeric = false;
      text += capital ? letter.toUpperCase() : letter;
    }
    capital = false;
  }
  return { text, unknown };
}
