import { describe, expect, it } from "vitest";

import { detectLanguage, languageForFrancCode } from "./detect.js";

/**
 * The guess the page makes about the text's language. The sentences are long
 * enough for franc to decide on, and the expected rows are what franc answered
 * with when this was written, mapped onto the NLLB table.
 */
describe("detectLanguage", () => {
  it("names the language of a sentence in each script the table covers", () => {
    expect(detectLanguage("Ich bin heute sehr müde und möchte nach Hause gehen.")?.code).toBe("deu_Latn");
    expect(detectLanguage("The quick brown fox jumps over the lazy dog every single morning.")?.code).toBe(
      "eng_Latn",
    );
    expect(detectLanguage("Данас је лепо време, па идемо у шетњу поред реке и парка у центру града.")?.code).toBe("srp_Cyrl");
    expect(detectLanguage("ذهبت إلى السوق لأشتري الخبز والحليب في الصباح الباكر.")?.code).toBe("arb_Arab");
    expect(detectLanguage("今日はとても暑いので、家で冷たい水を飲みたいです。")?.code).toBe("jpn_Jpan");
    expect(detectLanguage("我今天很忙，所以没有时间去公园散步。")?.code).toBe("zho_Hans");
  });

  it("reads Serbian written in Latin as the one Serbian row, which is Cyrillic", () => {
    expect(detectLanguage("Danas je lepo vreme, pa idemo u šetnju pored reke i parka u centru grada.")?.code).toBe(
      "srp_Cyrl",
    );
  });

  it("makes no guess for text under the minimum, or for text franc cannot name", () => {
    expect(detectLanguage("Hej")).toBeNull();
    expect(detectLanguage("Ja sam")).toBeNull();
    expect(detectLanguage("12345 67890 12345")).toBeNull();
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
