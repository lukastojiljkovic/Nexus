import { describe, expect, it } from "vitest";

import { decodeNato, encodeNato, natoWordFor } from "./nato.js";

describe("encodeNato", () => {
  it("spells a word one ICAO word per letter", () => {
    expect(encodeNato("SOS").spoken).toBe("Sierra Oscar Sierra");
    expect(encodeNato("sos").spoken).toBe("Sierra Oscar Sierra");
  });

  it("separates the words of a text with a slash, and a digit is its own spoken word", () => {
    expect(encodeNato("Hi  there").spoken).toBe("Hotel India / Tango Hotel Echo Romeo Echo");
    expect(encodeNato("A1").spoken).toBe("Alfa One");
    expect(encodeNato("93").spoken).toBe("Niner Tree");
    expect(encodeNato("4 5").spoken).toBe("Fower / Fife");
  });

  it("sends a Serbian letter as its base letters and reports each one once", () => {
    const result = encodeNato("čaršija đ đ");
    expect(result.spoken).toBe("Charlie Alfa Romeo Sierra India Juliett Alfa / Delta Juliett / Delta Juliett");
    expect(result.transliterated).toEqual(["č", "š", "đ"]);
    expect(result.unsupported).toEqual([]);
  });

  it("reports a character with no word and sends nothing for it", () => {
    const result = encodeNato("A€B");
    expect(result.spoken).toBe("Alfa Bravo");
    expect(result.unsupported).toEqual(["€"]);
  });

  it("answers an empty string for an empty text", () => {
    expect(encodeNato("   ")).toEqual({ spoken: "", transliterated: [], unsupported: [] });
  });
});

describe("decodeNato", () => {
  it("reads the words back, in both the ICAO and the common spelling", () => {
    expect(decodeNato("Sierra Oscar Sierra")).toEqual({ text: "SOS", unknown: [] });
    expect(decodeNato("Alpha juliet")).toEqual({ text: "AJ", unknown: [] });
    expect(decodeNato("Niner Tree Fife")).toEqual({ text: "935", unknown: [] });
  });

  it("puts a slash back as a space and names a word it does not know", () => {
    expect(decodeNato("Hotel India / Zebra")).toEqual({ text: "HI ?", unknown: ["Zebra"] });
  });

  it("round-trips every letter and digit", () => {
    const all = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    expect(decodeNato(encodeNato(all).spoken).text).toBe(all);
  });
});

describe("natoWordFor", () => {
  it("answers the word for a letter or a digit, and null for anything else", () => {
    expect(natoWordFor("x")).toBe("X-ray");
    expect(natoWordFor("0")).toBe("Zero");
    expect(natoWordFor("!")).toBeNull();
  });
});
