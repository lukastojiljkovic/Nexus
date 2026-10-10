import { describe, expect, it } from "vitest";

import {
  ASCII_CODES,
  ASCII_RADICES,
  asciiEntry,
  asciiFromCode,
  codeFromAscii,
  codesFromText,
  formatAsciiCode,
  formatAsciiString,
  formatCodePoint,
  isAsciiCode,
  isAsciiText,
  parseAsciiCode,
  textFromCodes,
  textToCodePoints,
} from "./ascii.js";

describe("the 128-code table", () => {
  it("holds every code once, in order, with the standard's own name", () => {
    expect(ASCII_CODES.length).toBe(128);
    ASCII_CODES.forEach((entry, code) => {
      expect(entry.code).toBe(code);
      expect(entry.char).toBe(String.fromCharCode(code));
      expect(entry.name.length).toBeGreaterThan(0);
    });
    // ANSI X3.4-1986's names, as UnicodeData.txt spells them for U+0000–U+001F,
    // plus the two the printable range adds of its own.
    expect(asciiEntry(0)?.name).toBe("NULL");
    expect(asciiEntry(7)?.name).toBe("BELL");
    expect(asciiEntry(9)?.name).toBe("CHARACTER TABULATION");
    expect(asciiEntry(10)?.name).toBe("LINE FEED (LF)");
    expect(asciiEntry(13)?.name).toBe("CARRIAGE RETURN (CR)");
    expect(asciiEntry(27)?.name).toBe("ESCAPE");
    expect(asciiEntry(31)?.name).toBe("INFORMATION SEPARATOR ONE");
    expect(asciiEntry(32)?.name).toBe("SPACE");
    expect(asciiEntry(65)?.name).toBe("A");
    expect(asciiEntry(126)?.name).toBe("~");
    expect(asciiEntry(127)?.name).toBe("DELETE");
  });

  it("refuses a code outside 0…127 rather than folding it in", () => {
    for (const code of [-1, 128, 233, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isAsciiCode(code), `code ${code}`).toBe(false);
      expect(asciiEntry(code), `code ${code}`).toBeNull();
      expect(asciiFromCode(code), `code ${code}`).toBeNull();
      for (const radix of ASCII_RADICES) {
        expect(formatAsciiCode(code, radix), `code ${code} base ${radix}`).toBeNull();
      }
    }
  });
});

describe("conversions", () => {
  it("round-trips every code through every radix, padded and unpadded", () => {
    for (let code = 0; code < 128; code += 1) {
      for (const radix of ASCII_RADICES) {
        for (const pad of [false, true]) {
          const text = formatAsciiCode(code, radix, pad) as string;
          expect(parseAsciiCode(text, radix), `${text} base ${radix} padded ${pad}`).toBe(code);
        }
      }
    }
  });

  it("pads to the width the base is written in, and never pads decimal", () => {
    expect(formatAsciiCode(65, 2, true)).toBe("01000001");
    expect(formatAsciiCode(65, 8, true)).toBe("101");
    expect(formatAsciiCode(65, 16, true)).toBe("41");
    expect(formatAsciiCode(65, 10, true)).toBe("65");
    expect(formatAsciiCode(65, 10)).toBe("65");
    expect(formatAsciiCode(0, 2, true)).toBe("00000000");
    expect(formatAsciiCode(0, 8, true)).toBe("000");
    expect(formatAsciiCode(0, 16, true)).toBe("00");
  });

  it("converts a string to codes and codes back", () => {
    expect(codesFromText("Hi!")).toEqual([72, 105, 33]);
    expect(textFromCodes([72, 105, 33])).toBe("Hi!");
    expect(codesFromText("")).toEqual([]);
    expect(textFromCodes([])).toBe("");
    expect(formatAsciiString("Hi", 2)).toBe("1001000 1101001");
    expect(formatAsciiString("Hi", 2, " ", true)).toBe("01001000 01101001");
    expect(formatAsciiString("Hi", 16, ":")).toBe("48:69");
    expect(codeFromAscii("A")).toBe(65);
    expect(codeFromAscii("AB")).toBeNull();
    expect(asciiFromCode(10)).toBe("\n");
  });

  it("reports a character that is not ASCII with its Unicode code point", () => {
    expect(codeFromAscii("č")).toBeNull();
    expect(isAsciiText("č")).toBe(false);
    expect(isAsciiText("AB")).toBe(false);
    expect(isAsciiText("A")).toBe(true);
    expect(codesFromText("ač")).toBeNull();
    expect(textFromCodes([97, 269])).toBeNull();
    expect(formatAsciiString("ač", 16)).toBeNull();
    expect(textToCodePoints("č")).toEqual([0x010d]);
    expect(formatCodePoint(0x010d)).toBe("U+010D");
    expect(formatCodePoint(0)).toBe("U+0000");
  });

  it("reads an emoji as one code point, never as two UTF-16 halves", () => {
    // The surrogate pair is two code units and NOT two characters: reporting
    // 0xD83D and 0xDE00 is the garbling this module exists to avoid.
    expect("😀".length).toBe(2);
    expect(codeFromAscii("😀")).toBeNull();
    expect(textToCodePoints("😀")).toEqual([0x1f600]);
    expect(formatCodePoint(0x1f600)).toBe("U+1F600");
    expect(textToCodePoints("a😀č")).toEqual([0x61, 0x1f600, 0x010d]);
  });

  it("refuses a number that is not written in the base it is read as", () => {
    expect(parseAsciiCode("0x41", 16)).toBeNull();
    expect(parseAsciiCode("0x41", 10)).toBeNull();
    expect(parseAsciiCode("08", 8)).toBeNull(); // 8 is not an octal digit
    expect(parseAsciiCode("9", 8)).toBeNull();
    expect(parseAsciiCode("", 10)).toBeNull();
    expect(parseAsciiCode("   ", 10)).toBeNull();
    expect(parseAsciiCode("-1", 10)).toBeNull();
    expect(parseAsciiCode("1 1", 2)).toBeNull();
    expect(parseAsciiCode(",", 10)).toBeNull();
    expect(parseAsciiCode("128", 10)).toBeNull();
    expect(parseAsciiCode("10000000", 2)).toBeNull();
    expect(parseAsciiCode("200", 8)).toBeNull();
    expect(parseAsciiCode("80", 16)).toBeNull();
    // And reads the ones that are, whatever the case and the surrounding space.
    expect(parseAsciiCode(" 41 ", 16)).toBe(65);
    expect(parseAsciiCode("7F", 16)).toBe(127);
    expect(parseAsciiCode("101", 8)).toBe(65);
    expect(parseAsciiCode("01000001", 2)).toBe(65);
  });
});
