import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  bcp47Tag,
  buildLanguages,
  languageTags,
  mmsRepoFor,
  nextLink,
  namesFor,
  parseFloresNames,
  parseMmsModelIds,
  parseNllbCodes,
  parseWhisperCodes,
  renderModule,
  splitNllbCode,
  uromanFlag,
  voiceWritesScript,
  whisperCodeFor,
} from "./languages.mjs";

/**
 * The language table's rules, tested against cut copies of the real upstream
 * files (see `fixtures/README.md`). Nothing here touches the network: the CLI's
 * fetch is the only code that does, and it is not imported by these tests.
 */

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const specialTokens = JSON.parse(fixture("special_tokens_map.json"));
const whisperConfig = JSON.parse(fixture("whisper-generation_config.json"));
const floresMarkdown = fixture("flores-languages.md");
const mmsModels = JSON.parse(fixture("mms-api-models.json"));
const tokenizerConfigs = JSON.parse(fixture("mms-tokenizer-configs.json"));

const mmsIds = parseMmsModelIds(mmsModels);
const whisperCodes = new Set(parseWhisperCodes(whisperConfig));
const uromanByRepo = new Map(
  Object.entries(tokenizerConfigs).map(([repo, config]) => [repo, uromanFlag(config, repo)]),
);

// Cut vocabularies, as the voices' `vocab.json` keys: a Latin one and a Tifinagh one.
const LATIN_VOCAB = ["<pad>", "<unk>", "a", "b", "e", "k", "n", "s", "|"];
const TIFINAGH_VOCAB = ["<pad>", "<unk>", "ⴰ", "ⴱ", "ⴳ", "ⴷ", "|"];

describe("NLLB codes", () => {
  it("takes the language tokens and nothing else, sorted and unique", () => {
    const codes = parseNllbCodes(specialTokens);
    // Measured: the real `special_tokens_map.json` lists 202 additional special
    // tokens, every one a language code; the `<mask>`-style tokens are absent.
    expect(codes).toHaveLength(202);
    expect(new Set(codes).size).toBe(202);
    expect([...codes].sort()).toEqual(codes);
    expect(codes).toContain("srp_Cyrl");
    expect(codes.every((code) => /^[a-z]{3}_[A-Z][a-z]{3}$/.test(code))).toBe(true);
  });

  it("splits a code into its ISO 639-3 and script parts", () => {
    expect(splitNllbCode("srp_Cyrl")).toEqual({ iso3: "srp", script: "Cyrl" });
    expect(() => splitNllbCode("srp-Cyrl")).toThrow(/srp-Cyrl/);
  });

  it("refuses a tokenizer config whose language list is null instead of returning none", () => {
    expect(() => parseNllbCodes({ additional_special_tokens: null })).toThrow(/additional_special_tokens/);
  });

  it("canonicalises 639-3 to the BCP 47 tag with the script appended", () => {
    expect(bcp47Tag("srp_Cyrl")).toBe("sr-Cyrl");
    expect(bcp47Tag("hrv_Latn")).toBe("hr-Latn");
    expect(bcp47Tag("bos_Latn")).toBe("bs-Latn");
    expect(bcp47Tag("zho_Hant")).toBe("zh-Hant");
    expect(bcp47Tag("tgl_Latn")).toBe("fil-Latn");
    // No 639-1 form exists, so the 639-3 code stands.
    expect(bcp47Tag("ace_Latn")).toBe("ace-Latn");
  });
});

describe("Whisper codes", () => {
  it("reads the language ids out of lang_to_id", () => {
    const codes = parseWhisperCodes(whisperConfig);
    // Measured: whisper-small's generation_config.json has 99 language entries.
    expect(codes).toHaveLength(99);
    expect(codes).toContain("sr");
    expect(codes).not.toContain("<|sr|>");
  });

  it("uses the primary subtag when Whisper has it", () => {
    expect(whisperCodeFor("sr-Cyrl", whisperCodes)).toBe("sr");
    expect(whisperCodeFor("hr-Latn", whisperCodes)).toBe("hr");
    expect(whisperCodeFor("bs-Latn", whisperCodes)).toBe("bs");
  });

  it("applies the override table where Whisper's code differs", () => {
    expect(whisperCodeFor("jv-Latn", whisperCodes)).toBe("jw");
    expect(whisperCodeFor("fil-Latn", whisperCodes)).toBe("tl");
    expect(whisperCodeFor("nb-Latn", whisperCodes)).toBe("no");
  });

  it("is null for a language Whisper lacks", () => {
    expect(whisperCodeFor("ace-Latn", whisperCodes)).toBeNull();
    expect(whisperCodeFor("ak-Latn", whisperCodes)).toBeNull();
  });
});

describe("FLORES names", () => {
  it("reads the name table and ignores the code-to-ISO table beside it", () => {
    const names = parseFloresNames(floresMarkdown);
    // Measured: the first table of the README (lines 71-274) holds 204 rows.
    expect(names.size).toBe(204);
    expect(names.get("eng_Latn")).toBe("English");
    expect(names.get("acm_Arab")).toBe("Mesopotamian Arabic");
    expect(names.has("bul_Cyrl")).toBe(true);
    expect([...names.values()].includes("bul")).toBe(false);
  });
});

describe("language tags", () => {
  const tags = (codes) => {
    const list = languageTags(codes);
    return new Map(codes.map((code, index) => [code, list[index]]));
  };

  it("gives a bare language subtag where the table has one row of that language", () => {
    const byCode = tags(parseNllbCodes(specialTokens));
    expect(byCode.get("deu_Latn")).toBe("de");
    expect(byCode.get("eng_Latn")).toBe("en");
    expect(byCode.get("srp_Cyrl")).toBe("sr");
  });

  it("adds the script where several rows share a language subtag", () => {
    const byCode = tags(["zho_Hans", "zho_Hant", "ace_Arab", "ace_Latn"]);
    expect(byCode.get("zho_Hans")).toBe("zh-Hans");
    expect(byCode.get("zho_Hant")).toBe("zh-Hant");
    expect(byCode.get("ace_Arab")).toBe("ace-Arab");
    expect(byCode.get("ace_Latn")).toBe("ace-Latn");
  });

  it("spells a tag two rows would share with each row's ISO 639-3 code", () => {
    const byCode = tags(["aka_Latn", "twi_Latn", "pes_Arab", "prs_Arab", "ajp_Arab", "apc_Arab"]);
    expect(byCode.get("aka_Latn")).toBe("aka");
    expect(byCode.get("twi_Latn")).toBe("twi");
    expect(byCode.get("pes_Arab")).toBe("pes");
    expect(byCode.get("prs_Arab")).toBe("prs");
    expect(byCode.get("ajp_Arab")).toBe("ajp");
    expect(byCode.get("apc_Arab")).toBe("apc");
  });

  it("gives every row of the real table a unique, well-formed tag", () => {
    const codes = parseNllbCodes(specialTokens);
    const all = languageTags(codes);
    expect(new Set(all).size).toBe(codes.length);
    expect(all.every((tag) => /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/.test(tag))).toBe(true);
  });
});

describe("voice scripts", () => {
  it("accepts a voice whose single-letter vocabulary is in the row's script", () => {
    expect(voiceWritesScript(LATIN_VOCAB, "Latn")).toBe(true);
    expect(voiceWritesScript(TIFINAGH_VOCAB, "Tfng")).toBe(true);
  });

  it("refuses a voice written in another script", () => {
    expect(voiceWritesScript(LATIN_VOCAB, "Arab")).toBe(false);
    expect(voiceWritesScript(TIFINAGH_VOCAB, "Latn")).toBe(false);
  });

  it("reads Hans and Hant as Han characters", () => {
    expect(voiceWritesScript(["<unk>", "中", "国", "人"], "Hans")).toBe(true);
    expect(voiceWritesScript(["<unk>", "中", "国", "人"], "Latn")).toBe(false);
  });

  it("looks at the majority of the letters, and ignores keys that are not single letters", () => {
    expect(voiceWritesScript(["ab", "ⴰ", "a", "b", "c", "<pad>"], "Latn")).toBe(true);
    expect(voiceWritesScript(["ab", "ⴰ", "ⴱ", "a", "<pad>"], "Latn")).toBe(false);
    expect(voiceWritesScript(["<pad>", "<unk>", "|"], "Latn")).toBe(false);
  });
});

describe("MMS-TTS repositories", () => {
  it("keeps the per-language and per-script repos, and drops dialect splits and the bare repo", () => {
    expect(mmsIds).toContain("facebook/mms-tts-eng");
    expect(mmsIds).toContain("facebook/mms-tts-kmr-script_latin");
    expect(mmsIds.some((id) => id.includes("dialect"))).toBe(false);
    expect(mmsIds).not.toContain("facebook/mms-tts");
  });

  it("chooses the per-language repo when one exists", () => {
    expect(mmsRepoFor("eng_Latn", mmsIds)).toBe("facebook/mms-tts-eng");
  });

  it("chooses the script split whose script matches the NLLB code", () => {
    expect(mmsRepoFor("kmr_Latn", mmsIds)).toBe("facebook/mms-tts-kmr-script_latin");
    expect(mmsRepoFor("kmr_Cyrl", mmsIds)).toBe("facebook/mms-tts-kmr-script_cyrillic");
    expect(mmsRepoFor("urd_Arab", mmsIds)).toBe("facebook/mms-tts-urd-script_arabic");
  });

  it("is null when no repo matches the script, or only a dialect split exists", () => {
    expect(mmsRepoFor("azj_Cyrl", mmsIds)).toBeNull();
    expect(mmsRepoFor("mam_Latn", mmsIds)).toBeNull();
    expect(mmsRepoFor("srp_Cyrl", mmsIds)).toBeNull();
  });

  it("reads is_uroman from each tokenizer config, and refuses one that does not state it", () => {
    expect(uromanByRepo.get("facebook/mms-tts-kor")).toBe(true);
    expect(uromanByRepo.get("facebook/mms-tts-eng")).toBe(false);
    expect(() => uromanFlag({}, "facebook/mms-tts-xyz")).toThrow(/mms-tts-xyz/);
  });

  it("follows the rel=next link of the API listing", () => {
    const header = '<https://huggingface.co/api/models?author=facebook&cursor=abc>; rel="next"';
    expect(nextLink(header)).toBe("https://huggingface.co/api/models?author=facebook&cursor=abc");
    expect(nextLink(null)).toBeUndefined();
  });
});

describe("display names", () => {
  it("returns ICU's English and Serbian Latin names for a known tag", () => {
    expect(namesFor("sr-Cyrl")).toEqual({ en: "Serbian (Cyrillic)", srLatn: "srpski (ćirilica)" });
  });

  it("returns undefined where ICU has no name for the tag", () => {
    expect(namesFor("bzd-Latn")).toEqual({ en: undefined, srLatn: undefined });
  });
});

describe("buildLanguages", () => {
  const vocabKeysByRepo = new Map([
    ["facebook/mms-tts-eng", LATIN_VOCAB],
    ["facebook/mms-tts-kmr-script_latin", LATIN_VOCAB],
  ]);
  const languages = buildLanguages({
    vocabKeysByRepo,
    codes: ["srp_Cyrl", "eng_Latn", "kmr_Latn", "ace_Latn", "bzd_Latn"],
    flores: new Map([
      ["srp_Cyrl", "Serbian"],
      ["eng_Latn", "English"],
      ["kmr_Latn", "Northern Kurdish"],
      ["ace_Latn", "Acehnese (Latin script)"],
      ["bzd_Latn", "Test Language"],
    ]),
    whisperCodes,
    mmsIds,
    uromanByRepo,
  });
  const byCode = (code) => languages.find((language) => language.code === code);

  it("fills one row per code with the Whisper, MMS and name fields", () => {
    expect(byCode("srp_Cyrl")).toEqual({
      code: "srp_Cyrl",
      iso3: "srp",
      script: "Cyrl",
      bcp47: "sr-Cyrl",
      tag: "sr",
      whisper: "sr",
      tts: null,
      fallbackName: null,
    });
    expect(byCode("eng_Latn").tts).toEqual({ repo: "facebook/mms-tts-eng", uroman: false });
    expect(byCode("kmr_Latn").tts).toEqual({
      repo: "facebook/mms-tts-kmr-script_latin",
      uroman: false,
    });
    expect(byCode("ace_Latn")).toMatchObject({ whisper: null, tts: null });
  });

  it("drops a voice whose vocabulary is written in another script than the row", () => {
    const withAce = buildLanguages({
      codes: ["ace_Arab", "ace_Latn"],
      flores: new Map(),
      whisperCodes,
      mmsIds: [...mmsIds, "facebook/mms-tts-ace"],
      uromanByRepo: new Map([...uromanByRepo, ["facebook/mms-tts-ace", false]]),
      vocabKeysByRepo: new Map([["facebook/mms-tts-ace", LATIN_VOCAB]]),
    });
    expect(withAce.map((language) => [language.code, language.tts])).toEqual([
      ["ace_Arab", null],
      ["ace_Latn", { repo: "facebook/mms-tts-ace", uroman: false }],
    ]);
  });

  it("keeps a uroman voice for a non-Latin row, since its text is romanised first", () => {
    const korean = buildLanguages({
      codes: ["kor_Hang"],
      flores: new Map(),
      whisperCodes,
      mmsIds,
      uromanByRepo,
      vocabKeysByRepo: new Map([["facebook/mms-tts-kor", LATIN_VOCAB]]),
    });
    expect(korean[0].tts).toEqual({ repo: "facebook/mms-tts-kor", uroman: true });
  });

  it("uses the FLORES name for both locales only when ICU has none", () => {
    expect(byCode("eng_Latn").fallbackName).toBeNull();
    expect(byCode("bzd_Latn").fallbackName).toBe("Test Language");
  });

  it("names a language by FLORES when its BCP 47 tag is shared, since ICU would give the other name", () => {
    const shared = buildLanguages({
      codes: ["aka_Latn", "twi_Latn"],
      flores: parseFloresNames(floresMarkdown),
      whisperCodes,
      mmsIds,
      uromanByRepo,
    });
    expect(shared.map((language) => [language.bcp47, language.fallbackName])).toEqual([
      ["ak-Latn", "Akan"],
      ["ak-Latn", "Twi"],
    ]);
  });

  it("refuses a code that neither ICU nor FLORES can name", () => {
    expect(() =>
      buildLanguages({
        codes: ["bzd_Latn"],
        flores: new Map(),
        whisperCodes,
        mmsIds,
        uromanByRepo,
      }),
    ).toThrow(/bzd_Latn/);
  });

  it("sorts the rows by code", () => {
    const codes = languages.map((language) => language.code);
    expect(codes).toEqual([...codes].sort());
  });
});

describe("renderModule", () => {
  const source = renderModule({
    languages: buildLanguages({
      codes: ["srp_Cyrl"],
      flores: new Map([["srp_Cyrl", "Serbian"]]),
      whisperCodes,
      mmsIds,
      uromanByRepo,
    }),
    sources: ["https://example.test/languages.json"],
    date: "2026-10-22",
  });

  it("writes a header that says the file is generated and where from", () => {
    expect(source.startsWith("// Generated by scripts/translator/languages.mjs. Do not edit.\n")).toBe(
      true,
    );
    expect(source).toContain("// Generated: 2026-10-22");
    expect(source).toContain("//   https://example.test/languages.json");
  });

  it("exports the typed table and the lookup", () => {
    expect(source).toContain("export const NLLB_LANGUAGES: readonly NllbLanguage[] = [");
    expect(source).toContain("export function languageByCode(code: string): NllbLanguage | undefined");
    expect(source).toContain("code: \"srp_Cyrl\"");
    expect(source).toContain("tag: \"sr\",");
  });
});
