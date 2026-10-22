import { describe, expect, it } from "vitest";

import { languageEntries, matchLanguages } from "./languages.js";

const SERBIAN = ["sr-Latn", "sr"];
const ENGLISH = ["en-GB", "en"];

describe("languageEntries", () => {
  it("names each language in the page's locale, with its English name beside it", () => {
    const german = languageEntries(SERBIAN).find((entry) => entry.row.code === "deu_Latn");
    expect(german?.name).toBe("nemački (latinica)");
    expect(german?.english).toBe("German (Latin)");
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
