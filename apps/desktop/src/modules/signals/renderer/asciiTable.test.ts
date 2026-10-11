import type { AsciiChar } from "@nexus/core";
import { describe, expect, it } from "vitest";

import {
  asciiCodesFromText,
  asciiTextFromCodes,
  formattedAsciiCodes,
  searchAsciiRows,
  sortAsciiRows,
} from "./asciiTable.js";

/**
 * The ASCII tab's pure half.
 *
 * The expected values are the standard's: ASCII is ANSI X3.4-1986, so `A` is 65,
 * `a` is 97, `0` is 48, `TAB` is 9, and the control names are the ones
 * `UnicodeData.txt` records for U+0000–U+001F, which are the standard's own
 * spelled out.
 */

describe("searchAsciiRows", () => {
  it("answers the whole table for nothing typed", () => {
    expect(searchAsciiRows("").length).toBe(128);
    expect(searchAsciiRows("   ").length).toBe(128);
  });

  it("finds a code by its written form in any of the three bases the table draws", () => {
    // 65 is the decimal code 65 (A) and the HEX code 65, which is decimal 101.
    expect(searchAsciiRows("65").map((entry) => entry.code)).toEqual([65, 101]);
    // 41 is the decimal code 41 (a quotation mark) and the hex code 41, which is 65.
    expect(searchAsciiRows("41").map((entry) => entry.code)).toEqual([41, 65]);
    // The binary column, exactly as it is drawn (zero-padded to eight): 01000001
    // is 65. A search that matched the engine's unpadded "1000001" would fail the
    // one query a person actually types — what they just copied off the screen.
    expect(searchAsciiRows("01000001").map((entry) => entry.code)).toEqual([65]);
    // Octal is deliberately NOT one of the three, so `41` does not also answer
    // 33, whose octal form it is: the table has no octal column to explain it.
    expect(searchAsciiRows("41").map((entry) => entry.code)).not.toContain(33);
  });

  it("finds a code by name read in words, and by the character itself", () => {
    // Two rows whose names begin with those letters: CHARACTER TABULATION (9) and
    // LINE TABULATION (11). Both are what somebody typing `tab` wants, and the
    // name column beside each row says which is which.
    expect(searchAsciiRows("tab").map((entry) => entry.code)).toEqual([9, 11]);
    expect(searchAsciiRows("line feed").map((entry) => entry.code)).toEqual([10]);
    // A name is matched from the START of a word, so `escape` finds the two rows
    // the standard names with that word: „DATA LINK ESCAPE" (16) and „ESCAPE"
    // (27) — both, which is what a query for a word should give.
    expect(searchAsciiRows("escape").map((entry) => entry.code)).toEqual([16, 27]);
    // …and a word INSIDE a name adds its row rather than replacing it:
    // `control` finds the four DEVICE CONTROL rows and nothing else.
    expect(searchAsciiRows("control").map((entry) => entry.code)).toEqual([17, 18, 19, 20]);
    // …and a single letter is a CHARACTER query: it finds only the rows whose own
    // character it is, never the names that letter sits inside.
    expect(searchAsciiRows("a").map((entry) => entry.code)).toEqual([65, 97]);
    // A printable character's name IS the character, so a commercial at is found
    // twice over — by the name rule and by the character rule — and the answer
    // is one row.
    expect(searchAsciiRows("@").map((entry) => entry.code)).toEqual([64]);
  });

  it("answers nothing rather than everything for a miss", () => {
    expect(searchAsciiRows("zzz")).toEqual([]);
  });
});

describe("sortAsciiRows", () => {
  /** A plain comparator, so the sort depends on nothing but the order it is given. */
  const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

  const three: readonly AsciiChar[] = [
    { code: 7, char: "\u0007", name: "BELL" },
    { code: 6, char: "\u0006", name: "ACKNOWLEDGE" },
    { code: 0, char: "\u0000", name: "NULL" },
  ];

  it("leaves the table in code order unless asked otherwise", () => {
    expect(sortAsciiRows(three, "code", byName)).toBe(three);
    expect(sortAsciiRows(three, "code", byName).map((entry) => entry.code)).toEqual([7, 6, 0]);
  });

  it("orders by name through the comparator it is given, breaking ties by code", () => {
    expect(sortAsciiRows(three, "name", byName).map((entry) => entry.name)).toEqual([
      "ACKNOWLEDGE",
      "BELL",
      "NULL",
    ]);
    // Two rows whose names the collator calls equal keep their code order, so a
    // sort can never shuffle the table between two renders.
    const tied: readonly AsciiChar[] = [
      { code: 9, char: "\t", name: "SAME" },
      { code: 2, char: "\u0002", name: "SAME" },
    ];
    expect(sortAsciiRows(tied, "name", byName).map((entry) => entry.code)).toEqual([2, 9]);
  });
});

describe("asciiCodesFromText", () => {
  it("reads plain ASCII", () => {
    expect(asciiCodesFromText("A Z")).toEqual({ ok: true, codes: [65, 32, 90] });
    expect(asciiCodesFromText("")).toEqual({ ok: true, codes: [] });
  });

  it("names the Unicode code points that are not ASCII", () => {
    // U+010D is č and U+0110 is Đ — refused rather than folded into c and D,
    // which is the garbling the engine's own refusal exists to prevent.
    expect(asciiCodesFromText("č")).toEqual({ ok: false, codePoints: [0x010d] });
    expect(asciiCodesFromText("AĐč")).toEqual({ ok: false, codePoints: [0x0110, 0x010d] });
  });

  it("writes the codes in whichever base was asked for", () => {
    // Lower case is the engine's `toString(16)`, and it is what the table's hex
    // column draws too — one spelling of a code in the whole module.
    expect(formattedAsciiCodes("AZ", 16)).toEqual({ ok: true, written: "41 5a" });
    expect(formattedAsciiCodes("AZ", 2)).toEqual({
      ok: true,
      written: "01000001 01011010",
    });
    expect(formattedAsciiCodes("č", 16)).toEqual({ ok: false, codePoints: [0x010d] });
  });
});

describe("asciiTextFromCodes", () => {
  it("reads codes separated by any of the three separators a person pastes", () => {
    expect(asciiTextFromCodes("72 69 76 76 79", 10)).toEqual({ ok: true, text: "HELLO" });
    expect(asciiTextFromCodes("72,69;76  76,79", 10)).toEqual({ ok: true, text: "HELLO" });
    // Base sixteen: 0x48 = 72 is H, 0x49 = 73 is I, 0x41 = 65 is A, 0x5A = 90 is Z.
    // An upper-case digit is the parser's business (`[0-9a-fA-F]`), not its input
    // contract: a person pastes either.
    expect(asciiTextFromCodes("48 49 41 5A", 16)).toEqual({ ok: true, text: "HIAZ" });
    expect(asciiTextFromCodes("   ", 10)).toEqual({ ok: true, text: "" });
  });

  it("names the token it could not read rather than reading part of it", () => {
    // `parseInt("0x41", 10)` would answer 0; the engine refuses the token instead.
    expect(asciiTextFromCodes("0x41 42", 10)).toEqual({ ok: false, token: "0x41" });
    // 9 is not a digit in base eight.
    expect(asciiTextFromCodes("9", 8)).toEqual({ ok: false, token: "9" });
    // 128 is outside ASCII, so there is no row it could be a code for.
    expect(asciiTextFromCodes("65 128", 10)).toEqual({ ok: false, token: "128" });
  });
});
