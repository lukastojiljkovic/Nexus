import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  bcp47Tag,
  buildLanguages,
  parseFloresNames,
  parseNllbCodes,
  renderModule,
  splitNllbCode,
} from "./languages.mjs";

/**
 * The language table's rules, tested against cut copies of the real upstream
 * files (see `fixtures/README.md`). Nothing here touches the network: the CLI's
 * fetch is the only code that does, and it is not imported by these tests.
 */

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const specialTokens = JSON.parse(fixture("special_tokens_map.json"));
const floresMarkdown = fixture("flores-languages.md");
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

describe("buildLanguages", () => {
  const languages = buildLanguages({
    codes: ["srp_Cyrl", "eng_Latn", "kmr_Latn", "ace_Latn", "bzd_Latn"],
    flores: new Map([
      ["srp_Cyrl", "Serbian"],
      ["eng_Latn", "English"],
      ["kmr_Latn", "Northern Kurdish"],
      ["ace_Latn", "Acehnese (Latin script)"],
      ["bzd_Latn", "Test Language"],
    ]),
  });
  const byCode = (code) => languages.find((language) => language.code === code);

  it("fills one row per code with its codes and its FLORES name", () => {
    expect(byCode("srp_Cyrl")).toEqual({
      code: "srp_Cyrl",
      iso3: "srp",
      script: "Cyrl",
      bcp47: "sr-Cyrl",
      fallbackName: "Serbian",
    });
  });

  // The app names a language through Electron's ICU, which named 52 of the 202
  // NLLB languages nothing at all where Node's ICU, which ran this script, named
  // them; the table cannot tell which, so every row carries its name.
  it("carries the FLORES name on every row, ICU's name or not", () => {
    expect(byCode("eng_Latn").fallbackName).toBe("English");
    expect(byCode("bzd_Latn").fallbackName).toBe("Test Language");
  });

  it("names a language by FLORES when its BCP 47 tag is shared, since ICU would give the other name", () => {
    const shared = buildLanguages({
      codes: ["aka_Latn", "twi_Latn"],
      flores: parseFloresNames(floresMarkdown),
    });
    expect(shared.map((language) => [language.bcp47, language.fallbackName])).toEqual([
      ["ak-Latn", "Akan"],
      ["ak-Latn", "Twi"],
    ]);
  });

  // Measured: NLLB's tokenizer has `sat_Beng`, the FLORES README `sat_Olck`.
  it("names a code FLORES spells in another script after that language's one row", () => {
    const santali = buildLanguages({ codes: ["sat_Beng"], flores: new Map([["sat_Olck", "Santali"]]) });
    expect(santali[0]?.fallbackName).toBe("Santali");
  });

  it("refuses a code FLORES does not name", () => {
    expect(() =>
      buildLanguages({
        codes: ["eng_Latn"],
        flores: new Map(),
      }),
    ).toThrow(/eng_Latn/);
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
  });
});
