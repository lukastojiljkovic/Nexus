import { describe, expect, it } from "vitest";

import { compareDictionaryKeys, dictionaryKey, looksSerbian, serbianLatin } from "./keys.js";

/**
 * The dictionary key, pinned pair by pair.
 *
 * The expected values are `foldSearchText`'s own rule (ADR-021,
 * `search/searchText.ts`): lowercased, the Serbian Cyrillic alphabet mapped to
 * Latin, `đ` written `dj`, and the diacritics `č ć š ž`
 * removed. They are written out rather than computed, because a test that
 * folded the input with the function under test would agree with whatever that
 * function happened to do today.
 */

describe("dictionaryKey", () => {
  it("folds case, diacritics and script into one key", () => {
    const pairs: readonly (readonly [string, string])[] = [
      ["kafa", "kafa"],
      ["Kafa", "kafa"],
      ["  kafa  ", "kafa"],
      ["ćevapčići", "cevapcici"],
      ["cevapcici", "cevapcici"],
      ["Đorđe", "djordje"],
      ["djordje", "djordje"],
      ["Čačak", "cacak"],
      ["Šabac", "sabac"],
      ["Žabalj", "zabalj"],
      ["čađavac", "cadjavac"],
      // The Cyrillic spelling of the same words: Serbian is digraphic, and the
      // pack's Serbian side carries both spellings.
      ["ć", "c"],
      ["Đ", "dj"],
      ["Љ", "lj"],
      ["Њ", "nj"],
      ["Џ", "dz"],
      // Not Serbian, and folded the way the app folds every query: the acute on
      // `café` is a combining mark, so it goes.
      ["café", "cafe"],
    ];
    for (const [input, expected] of pairs) {
      expect(dictionaryKey(input), input).toBe(expected);
    }
  });

  it("leaves a letter with no decomposition alone rather than guessing", () => {
    // `ß` has no NFD form and is not in the fold's hand table, so it
    // survives as itself — `devtools/text.ts` makes the same call for every
    // letter whose spelling only holds for the languages somebody tested.
    expect(dictionaryKey("straße")).toBe("straße");
  });

  it("answers the empty key for text that holds nothing to look up", () => {
    expect(dictionaryKey("")).toBe("");
    expect(dictionaryKey("   ")).toBe("");
  });

  it("keeps two headwords that fold together as one key, not as none", () => {
    // The fold is lossy ON PURPOSE, and this is the property the pack's reader
    // leans on: `čamac` and `camac` share a key, and both entries stay
    // under it rather than one of them disappearing.
    expect(dictionaryKey("čamac")).toBe(dictionaryKey("camac"));
    expect(dictionaryKey("čamac")).toBe("camac");
  });
});

describe("compareDictionaryKeys", () => {
  it("orders by code unit, which is the order the pack's index is written in", () => {
    const keys = ["zdravo", "kafa", "cvet", "cvek"];
    expect([...keys].sort(compareDictionaryKeys)).toEqual(["cvek", "cvet", "kafa", "zdravo"]);
    expect(compareDictionaryKeys("kafa", "kafa")).toBe(0);
    expect(compareDictionaryKeys("kafa", "kafana")).toBeLessThan(0);
    expect(compareDictionaryKeys("kafana", "kafa")).toBeGreaterThan(0);
  });
});

describe("looksSerbian", () => {
  it("recognises the letters English does not have, and only those", () => {
    const serbian = ["ća", "čovek", "šuma", "žena", "đak", "kuća"];
    for (const word of serbian) {
      expect(looksSerbian(word), word).toBe(true);
    }
    for (const word of ["hello", "coffee", "strasse", "kafa", "zdravo"]) {
      expect(looksSerbian(word), word).toBe(false);
    }
  });

  it("treats a Cyrillic query as Serbian, because no English headword is spelled in it", () => {
    expect(looksSerbian("ЖЕНА")).toBe(true);
  });
});

describe("serbianLatin", () => {
  it("spells a Cyrillic word in Latin and keeps the diacritics", () => {
    const pairs: readonly (readonly [string, string])[] = [
      ["кућа", "kuća"],
      ["Ђорђе", "Đorđe"],
      ["жена", "žena"],
      ["ћар", "ćar"],
    ];
    for (const [input, expected] of pairs) {
      expect(serbianLatin(input), input).toBe(expected);
    }
  });

  it("restores case, including the digraphs that expand to two letters", () => {
    expect(serbianLatin("Љубав")).toBe("Ljubav");
    expect(serbianLatin("ЉУБАВ")).toBe("LJUBAV");
    expect(serbianLatin("Њујорк")).toBe("Njujork");
  });

  it("leaves text that is already Latin alone", () => {
    expect(serbianLatin("kafa")).toBe("kafa");
    expect(serbianLatin("hello")).toBe("hello");
  });
});
