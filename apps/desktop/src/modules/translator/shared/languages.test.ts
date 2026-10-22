import { describe, expect, it } from "vitest";

import { NLLB_LANGUAGES, languageByCode } from "./languages.js";

/**
 * The generated language table, checked for the shape the translator relies on.
 * The rows themselves are derived by `scripts/translator/languages.mjs` and tested
 * there; this asserts what the app reads: unique codes, the Whisper codes the
 * speech-in path needs, and voices that are MMS-TTS repos and nothing else.
 */
describe("NLLB language table", () => {
  it("has unique, well-formed codes, sorted", () => {
    const codes = NLLB_LANGUAGES.map((language) => language.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^[a-z]{3}_[A-Z][a-z]{3}$/.test(code))).toBe(true);
    expect([...codes].sort()).toEqual(codes);
  });

  it("gives the Serbian, Croatian, Bosnian, English and German codes their Whisper codes", () => {
    const expected = [
      ["srp_Cyrl", "sr"],
      ["hrv_Latn", "hr"],
      ["bos_Latn", "bs"],
      ["eng_Latn", "en"],
      ["deu_Latn", "de"],
    ] as const;
    for (const [code, whisper] of expected) {
      expect(languageByCode(code)?.whisper).toBe(whisper);
    }
  });

  it("points every voice at an MMS-TTS repo", () => {
    const voices = NLLB_LANGUAGES.flatMap((language) => (language.tts === null ? [] : [language.tts]));
    expect(voices.length).toBeGreaterThan(0);
    expect(voices.every((voice) => voice.repo.startsWith("facebook/mms-tts-"))).toBe(true);
  });

  it("returns undefined for a code the table does not carry", () => {
    expect(languageByCode("xxx_Latn")).toBeUndefined();
  });
});
