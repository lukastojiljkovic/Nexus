import { describe, expect, it } from "vitest";

import { lowerBound, matchDictionaryKeys } from "./search.js";

/**
 * The pure half of the search, against a key list a test can read.
 *
 * The list has the shape the pack writes — FOLDED keys, sorted by
 * `compareDictionaryKeys` — so the properties here are the ones the module
 * leans on: an exact hit is the word that was typed, a prefix hit is its
 * neighbourhood, a query typed without its Serbian diacritics finds the word
 * that has them, and a walk that would run to thousands of keys stops at the
 * cap and says so.
 */

const KEYS: readonly string[] = [
  "cvece",
  "cvek",
  "cvet",
  "kafa",
  "kafana",
  "kafanski",
  "kafic",
  "reka",
  "rekao",
  "zdravo",
];

describe("lowerBound", () => {
  it("answers the first key that is not smaller than the query", () => {
    expect(lowerBound(KEYS, "cvet")).toBe(2);
    expect(lowerBound(KEYS, "cvek")).toBe(1);
    expect(lowerBound(KEYS, "kafa")).toBe(3);
    expect(lowerBound(KEYS, "kafanb")).toBe(5);
    expect(lowerBound(KEYS, "zzz")).toBe(KEYS.length);
    expect(lowerBound([], "kafa")).toBe(0);
  });
});

describe("matchDictionaryKeys", () => {
  it("finds the exact key and its prefix neighbourhood", () => {
    const match = matchDictionaryKeys(KEYS, "kafa", 10);
    expect(match.key).toBe("kafa");
    expect(KEYS[match.exact]).toBe("kafa");
    expect(match.prefixed.map((index) => KEYS[index])).toEqual(["kafana", "kafanski"]);
    expect(match.truncated).toBe(false);
  });

  it("answers a partial query with what starts that way, and no exact hit", () => {
    const match = matchDictionaryKeys(KEYS, "kaf", 10);
    expect(match.exact).toBe(-1);
    expect(match.prefixed.map((index) => KEYS[index])).toEqual([
      "kafa",
      "kafana",
      "kafanski",
      "kafic",
    ]);
  });

  it("finds the word through a query typed without its Serbian diacritics", () => {
    // The property the whole key exists for. The index holds FOLDED keys — that
    // is the writer's contract — and `cvece` is what `cveće` folds to.
    const keys = ["cvece", "kuca"];
    const latin = matchDictionaryKeys(keys, "cvece", 5);
    expect(keys[latin.exact]).toBe("cvece");
    const cyrillic = matchDictionaryKeys(keys, "КУЦА", 5);
    expect(keys[cyrillic.exact]).toBe("kuca");
  });

  it("stops at the cap and says it stopped", () => {
    const match = matchDictionaryKeys(KEYS, "kaf", 2);
    expect(match.prefixed).toHaveLength(2);
    expect(match.truncated).toBe(true);
  });

  it("treats an empty query as no query rather than as every key", () => {
    for (const query of ["", "   "]) {
      const match = matchDictionaryKeys(KEYS, query, 10);
      expect(match.exact).toBe(-1);
      expect(match.prefixed).toEqual([]);
      expect(match.truncated).toBe(false);
    }
    expect(matchDictionaryKeys(KEYS, "kafa", 0).prefixed).toEqual([]);
  });

  it("answers nothing at all when the index has no such key", () => {
    const match = matchDictionaryKeys(KEYS, "zzzz", 10);
    expect(match.exact).toBe(-1);
    expect(match.prefixed).toEqual([]);
    expect(match.truncated).toBe(false);
  });
});
