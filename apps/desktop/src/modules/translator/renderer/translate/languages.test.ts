import { describe, expect, it } from "vitest";

import { languageEntries, matchLanguages } from "./languages.js";

const SERBIAN = ["sr-Latn", "sr"];
const ENGLISH = ["en-GB", "en"];

describe("languageEntries", () => {
  it("names each language in the page's locale, with its English name beside it", () => {
    const german = languageEntries(SERBIAN).find((entry) => entry.row.code === "deu_Latn");
    expect(german?.name).toBe("nemački");
    expect(german?.english).toBe("German");
  });

  it("names the script only where the table has the language in two", () => {
    const named = (code: string) => languageEntries(ENGLISH).find((entry) => entry.row.code === code)?.name;
    expect(named("arb_Arab")).toBe("Arabic");
    expect(named("jpn_Jpan")).toBe("Japanese");
    expect(named("zho_Hans")).toBe("Simplified Chinese");
    expect(named("zho_Hant")).toBe("Traditional Chinese");
    expect(named("kas_Arab")).toBe("Kashmiri (Arabic)");
    expect(named("kas_Deva")).toBe("Kashmiri (Devanagari)");
  });

  it("gives two languages that share a tag their own names, which ICU would merge", () => {
    const named = (code: string) => languageEntries(SERBIAN).find((entry) => entry.row.code === code)?.name;
    expect([named("aka_Latn"), named("twi_Latn")]).toEqual(["Akan", "Twi"]);
    expect([named("pes_Arab"), named("prs_Arab")]).toEqual(["Western Persian", "Dari"]);
    const names = languageEntries(ENGLISH).map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("falls back to the FLORES name where ICU names nothing", () => {
    const entry = languageEntries(ENGLISH).find((each) => each.row.code === "acq_Arab");
    expect(entry?.name).toBe("Ta’izzi-Adeni Arabic");
  });

  it("sorts by the name in the page's locale, with Latin š, č and ć in their own places", () => {
    const names = languageEntries(SERBIAN).map((entry) => entry.name);
    expect(names).toEqual([...names].sort(new Intl.Collator(SERBIAN).compare));
  });
});

describe("matchLanguages", () => {
  const entries = languageEntries(SERBIAN);

  it("answers every language for an empty query", () => {
    expect(matchLanguages(entries, "  ")).toHaveLength(entries.length);
  });

  it("matches the name in the page's locale, ignoring case and diacritics", () => {
    expect(matchLanguages(entries, "NEMACKI").map((entry) => entry.row.code)).toContain("deu_Latn");
    expect(matchLanguages(entries, "nemački").map((entry) => entry.row.code)).toContain("deu_Latn");
  });

  it("matches the English name, and the NLLB code", () => {
    expect(matchLanguages(entries, "german").map((entry) => entry.row.code)).toContain("deu_Latn");
    expect(matchLanguages(entries, "srp_cyr").map((entry) => entry.row.code)).toContain("srp_Cyrl");
  });

  it("answers nothing when no language matches", () => {
    expect(matchLanguages(entries, "qqqqzzz")).toEqual([]);
  });
});
