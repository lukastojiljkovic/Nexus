import { describe, expect, it } from "vitest";

import { BRAILLE_CAPITAL, BRAILLE_NUMERIC, BRAILLE_SPACE, decodeBraille, encodeBraille } from "./braille.js";

describe("encodeBraille", () => {
  it("sends each letter as the cell of its dots, U+2800 plus the dot values", () => {
    // a is dot 1 (U+2801), b is dots 1-2 (U+2803), c is dots 1-4 (U+2809).
    expect(encodeBraille("abc").cells).toBe("⠁⠃⠉");
    // z is dots 1, 3, 5 and 6: 1 + 4 + 16 + 32 = 53, which is U+2835.
    expect(encodeBraille("z").cells).toBe("⠵");
  });

  it("sends a capital with the capital sign and a space as the blank cell", () => {
    expect(encodeBraille("Ab c").cells).toBe(`${BRAILLE_CAPITAL}⠁⠃${BRAILLE_SPACE}⠉`);
  });

  it("sends digits behind the numeric sign, as the letters a to j with 0 as j", () => {
    expect(encodeBraille("12").cells).toBe(`${BRAILLE_NUMERIC}⠁⠃`);
    expect(encodeBraille("10").cells).toBe(`${BRAILLE_NUMERIC}⠁⠚`);
    // A new run of digits after a space gets its own sign.
    expect(encodeBraille("1 2").cells).toBe(`${BRAILLE_NUMERIC}⠁${BRAILLE_SPACE}${BRAILLE_NUMERIC}⠃`);
  });

  it("sends a Serbian letter as its base letters and reports it", () => {
    const result = encodeBraille("Đč");
    expect(result.cells).toBe(`${BRAILLE_CAPITAL}⠙⠚⠉`);
    expect(result.transliterated).toEqual(["Đ", "č"]);
  });

  it("refuses a letter straight after digits and a character with no cell", () => {
    const result = encodeBraille("1a€");
    expect(result.unsupported).toEqual(["a", "€"]);
    expect(result.cells).toBe(`${BRAILLE_NUMERIC}⠁`);
  });
});

describe("decodeBraille", () => {
  it("reads letters, capitals, spaces and numbers back", () => {
    expect(decodeBraille(encodeBraille("Abc 12").cells)).toEqual({ text: "Abc 12", unknown: [] });
    expect(decodeBraille(encodeBraille("10 kg").cells)).toEqual({ text: "10 kg", unknown: [] });
  });

  it("ends a number at a letter outside a–j, and marks a cell it cannot read", () => {
    expect(decodeBraille(`${BRAILLE_NUMERIC}⠁⠅`)).toEqual({ text: "1k", unknown: [] });
    expect(decodeBraille("⠀⠀⠿")).toEqual({ text: "  ?", unknown: ["⠿"] });
  });
});
