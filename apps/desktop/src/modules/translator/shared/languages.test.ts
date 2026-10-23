import { describe, expect, it } from "vitest";

import { NLLB_LANGUAGES, languageByCode, languageFromTag } from "./languages.js";

/**
 * The generated language table, checked for the shape the translator relies on.
 * The rows themselves are derived by `scripts/translator/languages.mjs` and tested
 * there; this asserts what the app reads: unique codes, and the BCP 47 tags the
 * page names languages and splits sentences by.
 */
describe("NLLB language table", () => {
  it("has unique, well-formed codes, sorted", () => {
    const codes = NLLB_LANGUAGES.map((language) => language.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^[a-z]{3}_[A-Z][a-z]{3}$/.test(code))).toBe(true);
    expect([...codes].sort()).toEqual(codes);
  });

  it("gives the Serbian, Croatian, Bosnian, English and Chinese codes their BCP 47 tags", () => {
    const expected = [
      ["srp_Cyrl", "sr-Cyrl"],
      ["hrv_Latn", "hr-Latn"],
      ["bos_Latn", "bs-Latn"],
      ["eng_Latn", "en-Latn"],
      ["zho_Hant", "zh-Hant"],
    ] as const;
    for (const [code, bcp47] of expected) {
      expect(languageByCode(code)?.bcp47).toBe(bcp47);
    }
  });

  // Electron's ICU names 52 of these languages nothing, so the page shows this name.
  it("carries a name for every language, whatever ICU knows", () => {
    expect(NLLB_LANGUAGES.filter((language) => language.fallbackName.trim() === "")).toEqual([]);
    expect(languageByCode("sat_Beng")?.fallbackName).toBe("Santali");
  });

  it("returns undefined for a code the table does not carry", () => {
    expect(languageByCode("xxx_Latn")).toBeUndefined();
  });
});

describe("languageFromTag", () => {
  it("takes an NLLB code as it is", () => {
    expect(languageFromTag("srp_Cyrl")?.code).toBe("srp_Cyrl");
  });

  it("takes a full BCP 47 tag, ignoring case", () => {
    expect(languageFromTag("zh-Hant")?.code).toBe("zho_Hant");
    expect(languageFromTag("zh-hant")?.code).toBe("zho_Hant");
  });

  it("takes a primary language subtag, ignoring case, as the first row in table order", () => {
    expect(languageFromTag("sr")?.code).toBe("srp_Cyrl");
    expect(languageFromTag("EN")?.code).toBe("eng_Latn");
    expect(languageFromTag("zh")?.code).toBe("zho_Hans");
  });

  it("returns undefined for a value the table does not carry, and for an empty one", () => {
    expect(languageFromTag("xx")).toBeUndefined();
    expect(languageFromTag("")).toBeUndefined();
  });
});
