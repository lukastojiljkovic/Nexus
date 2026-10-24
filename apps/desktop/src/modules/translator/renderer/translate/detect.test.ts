import { eld } from "eld/small";
import { describe, expect, it } from "vitest";

import { detectLanguage, languageForEldCode, languageForFrancCode } from "./detect.js";

/**
 * The guess the page makes about the text's language. The expected rows are what
 * eld, or franc where eld is unsure, answered with when this was written, mapped
 * onto the NLLB table.
 */
describe("detectLanguage", () => {
  it("names the language of a sentence in each script the table covers", () => {
    expect(detectLanguage("Ich bin heute sehr müde und möchte nach Hause gehen.", "en")?.code).toBe("deu_Latn");
    expect(detectLanguage("The quick brown fox jumps over the lazy dog every single morning.", "en")?.code).toBe(
      "eng_Latn",
    );
    expect(detectLanguage("Данас је лепо време, па идемо у шетњу поред реке и парка у центру града.", "en")?.code).toBe(
      "srp_Cyrl",
    );
    expect(detectLanguage("ذهبت إلى السوق لأشتري الخبز والحليب في الصباح الباكر.", "en")?.code).toBe("arb_Arab");
    expect(detectLanguage("今日はとても暑いので、家で冷たい水を飲みたいです。", "en")?.code).toBe("jpn_Jpan");
    expect(detectLanguage("我今天很忙，所以没有时间去公园散步。", "en")?.code).toBe("zho_Hans");
  });

  it("names the language of a short everyday sentence, where trigrams alone guess wrong", () => {
    expect(detectLanguage("I would like a cup of coffee, please.", "en")?.code).toBe("eng_Latn");
    expect(detectLanguage("Guten Tag, wo ist der Bahnhof?", "en")?.code).toBe("deu_Latn");
    expect(detectLanguage("Добрий день, де знаходиться вокзал?", "en")?.code).toBe("ukr_Cyrl");
    expect(detectLanguage("Merhaba, tren istasyonu nerede?", "en")?.code).toBe("tur_Latn");
  });

  it("names a language eld does not carry through franc", () => {
    expect(detectLanguage("Habari za asubuhi, kituo cha treni kiko wapi?", "en")?.code).toBe("swh_Latn");
  });

  it("reads Serbian, Croatian and Bosnian in Latin as Serbian when the app is in Serbian", () => {
    expect(detectLanguage("Dobar dan, gde je železnička stanica?", "sr")?.code).toBe("srp_Cyrl");
    expect(detectLanguage("Koliko košta karta do Novog Sada?", "sr")?.code).toBe("srp_Cyrl");
    expect(detectLanguage("Gdje je najbliža ljekarna?", "sr")?.code).toBe("srp_Cyrl");
  });

  it("keeps the detector's answer within those three when the app is in English", () => {
    expect(detectLanguage("Gdje je najbliža ljekarna?", "en")?.code).toBe("hrv_Latn");
  });

  it("makes no guess for text under the minimum, or for text no detector can name", () => {
    expect(detectLanguage("Hej", "sr")).toBeNull();
    expect(detectLanguage("Ja sam", "sr")).toBeNull();
    expect(detectLanguage("12345 67890 12345", "sr")).toBeNull();
  });
});

describe("languageForEldCode", () => {
  it("maps every language eld can name onto a row", () => {
    const unmapped = Object.values(eld.info().Languages).filter((code) => languageForEldCode(code) === null);
    expect(unmapped).toEqual([]);
  });

  it("maps the codes whose row is not the one row with that language subtag", () => {
    expect(languageForEldCode("fa")?.code).toBe("pes_Arab");
    expect(languageForEldCode("ku")?.code).toBe("ckb_Arab");
    expect(languageForEldCode("no")?.code).toBe("nob_Latn");
    expect(languageForEldCode("tl")?.code).toBe("tgl_Latn");
    expect(languageForEldCode("zh")?.code).toBe("zho_Hans");
  });
});

describe("languageForFrancCode", () => {
  it("maps the three codes whose NLLB code differs from franc's", () => {
    expect(languageForFrancCode("cmn", "我今天很忙")?.code).toBe("zho_Hans");
    expect(languageForFrancCode("ekk", "Tere, kuidas läheb?")?.code).toBe("est_Latn");
    expect(languageForFrancCode("zlm", "Apa khabar, saya sihat.")?.code).toBe("zsm_Latn");
  });

  it("maps a code with several rows to the row whose script the text is written in", () => {
    expect(languageForFrancCode("ace", "Ini adalah contoh kalimat.")?.code).toBe("ace_Latn");
    expect(languageForFrancCode("ace", "ئەمە نموونەیەکە")?.code).toBe("ace_Arab");
  });

  it("answers nothing for a code the table does not carry", () => {
    expect(languageForFrancCode("xyz", "anything")).toBeNull();
  });
});
