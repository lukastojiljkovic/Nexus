/**
 * ASCII — the 128-code table and the conversions a developer tool needs.
 *
 * **Names for the control codes come from the standard, not from a hobby
 * list.** `ASCII_CODES` carries the official name of every code, and the 32
 * control names are the ones Unicode's `UnicodeData.txt` records for
 * U+0000–U+001F — which are the ANSI X3.4-1986 names, spelled out in full
 * („CHARACTER TABULATION", not „TAB"). The one deliberate shortening is
 * `LINE FEED (LF)` → kept as the standard prints it. Nothing here is a
 * colloquial alias, so a lookup key never disagrees with a scanner dump.
 *
 * **Non-ASCII input is reported, never garbled.** A character above U+007F has
 * no ASCII code, and the honest answer is its Unicode code point — which is
 * what `textToCodePoints` returns beside the refusal, so the surface can say
 * „this is not ASCII; U+010D is č" instead of printing a `?`.
 */

/** One row of the table. The code is the ASCII value, `name` its standard name. */
export interface AsciiChar {
  /** 0–127. */
  readonly code: number;
  /** The single-character string the code represents; the same code point for 0–127. */
  readonly char: string;
  /** The standard's name: a control code's full name, or the printable character itself. */
  readonly name: string;
}

/** The bases this module reads and writes. `2`, `8`, `10` and `16`. */
export const ASCII_RADICES = [2, 8, 10, 16] as const;

export type AsciiRadix = (typeof ASCII_RADICES)[number];

// The 32 control names, in code order, exactly as UnicodeData.txt spells them.
const CONTROL_NAMES = [
  "NULL",
  "START OF HEADING",
  "START OF TEXT",
  "END OF TEXT",
  "END OF TRANSMISSION",
  "ENQUIRY",
  "ACKNOWLEDGE",
  "BELL",
  "BACKSPACE",
  "CHARACTER TABULATION",
  "LINE FEED (LF)",
  "LINE TABULATION",
  "FORM FEED (FF)",
  "CARRIAGE RETURN (CR)",
  "SHIFT OUT",
  "SHIFT IN",
  "DATA LINK ESCAPE",
  "DEVICE CONTROL ONE",
  "DEVICE CONTROL TWO",
  "DEVICE CONTROL THREE",
  "DEVICE CONTROL FOUR",
  "NEGATIVE ACKNOWLEDGE",
  "SYNCHRONOUS IDLE",
  "END OF TRANSMISSION BLOCK",
  "CANCEL",
  "END OF MEDIUM",
  "SUBSTITUTE",
  "ESCAPE",
  "INFORMATION SEPARATOR FOUR",
  "INFORMATION SEPARATOR THREE",
  "INFORMATION SEPARATOR TWO",
  "INFORMATION SEPARATOR ONE",
] as const;

/**
 * The whole table, code order. Built once from the name list rather than typed
 * out 128 times: the printable half of ASCII is its own code point and needs no
 * data, and only the 32 controls (plus SPACE and DELETE) are names the
 * characters do not carry themselves.
 */
export const ASCII_CODES: readonly AsciiChar[] = Array.from({ length: 128 }, (_, code) => ({
  code,
  char: String.fromCharCode(code),
  name:
    code < 32
      ? (CONTROL_NAMES[code] as string)
      : code === 32
        ? "SPACE"
        : code === 127
          ? "DELETE"
          : String.fromCharCode(code),
}));

/** True for 0–127; a code outside that is not ASCII and is refused rather than folded. */
export function isAsciiCode(code: number): boolean {
  return Number.isInteger(code) && code >= 0 && code <= 127;
}

/** The table row for a code, or null. */
export function asciiEntry(code: number): AsciiChar | null {
  return isAsciiCode(code) ? (ASCII_CODES[code] as AsciiChar) : null;
}

/** True only for a string that is exactly one ASCII character. */
export function isAsciiText(text: string): boolean {
  return text.length === 1 && isAsciiCode(text.charCodeAt(0));
}

/**
 * A code as text in one of the four bases.
 *
 * `pad` left-pads to the width the base is conventionally written in — 8 bits,
 * 3 octal digits, 2 hex digits — which is what makes a column of codes align.
 * Decimal is never padded: leading zeroes on a number read as a different
 * number to everyone who is not looking at a bit pattern.
 */
export function formatAsciiCode(code: number, radix: AsciiRadix, pad = false): string | null {
  if (!isAsciiCode(code)) return null;
  const text = code.toString(radix);
  if (!pad || radix === 10) return text;
  const width = radix === 2 ? 8 : radix === 8 ? 3 : 2;
  return text.padStart(width, "0");
}

/**
 * Read a code written in one of the four bases, or null.
 *
 * The parser is per-base rather than `parseInt(text, radix)`, because
 * `parseInt("9", 8)` is `NaN` but `parseInt("08", 8)` is `8` and
 * `parseInt("0x1F", 10)` is `0`: `parseInt` stops at the first character it
 * cannot read and answers with what it got so far. A tool that silently turns
 * `0x41` into `0` is worse than one that refuses it.
 */
export function parseAsciiCode(text: string, radix: AsciiRadix): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const digits = radix === 16 ? /^[0-9a-fA-F]+$/ : radix === 10 ? /^[0-9]+$/ : radix === 8 ? /^[0-7]+$/ : /^[01]+$/;
  if (!digits.test(trimmed)) return null;
  const value = Number.parseInt(trimmed, radix);
  return isAsciiCode(value) ? value : null;
}

/**
 * A character as its code, or null when it is not one ASCII character.
 *
 * The upper half of Latin-1 is deliberately out: `é` is U+00E9 and not an
 * ASCII 233, and answering 233 would be the garbling this module exists to
 * avoid. `textToCodePoints` is where a caller goes to find out what it was.
 */
export function codeFromAscii(char: string): number | null {
  return isAsciiText(char) ? char.charCodeAt(0) : null;
}

/** The character for a code, or null when the code is not ASCII. */
export function asciiFromCode(code: number): string | null {
  return asciiEntry(code)?.char ?? null;
}

/** A string of ASCII characters as codes, or null if any character is not ASCII. */
export function codesFromText(text: string): number[] | null {
  const codes: number[] = [];
  for (const char of text) {
    const code = codeFromAscii(char);
    if (code === null) return null;
    codes.push(code);
  }
  return codes;
}

/** Codes as text, or null if any code is not ASCII. */
export function textFromCodes(codes: readonly number[]): string | null {
  let text = "";
  for (const code of codes) {
    const char = asciiFromCode(code);
    if (char === null) return null;
    text += char;
  }
  return text;
}

/** A string as codes joined by `separator`, or null if any character is not ASCII. */
export function formatAsciiString(text: string, radix: AsciiRadix, separator = " ", pad = false): string | null {
  const codes = codesFromText(text);
  if (codes === null) return null;
  return codes.map((code) => formatAsciiCode(code, radix, pad) as string).join(separator);
}

/**
 * The Unicode code points of a string, in order.
 *
 * This is the answer to „it is not ASCII — what is it?", and it exists because
 * the alternative every tool reaches for is `charCodeAt`, which is UTF-16 and
 * reports `č` as `269` and an emoji as two halves that are each not a code
 * point. Iterating the string yields whole code points, which is what a caller
 * can look up and print.
 */
export function textToCodePoints(text: string): number[] {
  return [...text].map((char) => (char.codePointAt(0) as number));
}

/** A Unicode code point as the `U+XXXX` everyone writes, at least four digits. */
export function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}
