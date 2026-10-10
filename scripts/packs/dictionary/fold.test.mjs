import { describe, expect, it } from "vitest";

import { compareDictionaryKeys, dictionaryKey, fold } from "./fold.mjs";
import { dictionaryKey as coreDictionaryKey } from "../../../packages/core/src/dictionary/keys.ts";

/**
 * The builder's fold, and the ONE thing that matters about it: the app folds
 * queries with `@nexus/core`'s `dictionaryKey`, and the pack's keys are folded
 * here. If the two ever disagree, every lookup in the pack misses — silently,
 * because a key that does not match is indistinguishable from a word the
 * dictionary does not have.
 *
 * So the last test in this file is the one that does the work: it folds a word
 * list through BOTH implementations. The pairs above it say what the rule IS, in
 * values a reader can check by eye.
 */

describe("fold", () => {
  it("lowers, strips the Serbian diacritics, and writes dj for the stroked d", () => {
    const pairs = [
      ["kafa", "kafa"],
      ["Kafa", "kafa"],
      ["ćevapčići", "cevapcici"],
      ["ĆEVAPČIĆI", "cevapcici"],
      ["đak", "djak"],
      ["Đorđe", "djordje"],
      ["šuma", "suma"],
      ["žena", "zena"],
      ["čačak", "cacak"],
      ["džep", "dzep"],
      ["ljubav", "ljubav"],
      ["njiva", "njiva"],
      ["café", "cafe"],
    ];
    for (const [input, expected] of pairs) {
      expect(dictionaryKey(input), input).toBe(expected);
    }
  });

  it("transliterates the Serbian Cyrillic alphabet into the same keys", () => {
    const pairs = [
      ["куца", "kuca"],
      ["жена", "zena"],
      ["сума", "suma"],
      ["ђак", "djak"],
      ["ћар", "car"],
      ["љубав", "ljubav"],
      ["њушка", "njuska"],
      ["џеп", "dzep"],
    ];
    for (const [input, expected] of pairs) {
      expect(dictionaryKey(input), input).toBe(expected);
    }
  });

  it("trims before folding, so a trailing space is not part of a key", () => {
    expect(dictionaryKey("  kafa  ")).toBe("kafa");
    expect(fold(" kafa ")).toBe(" kafa ");
  });
});

describe("compareDictionaryKeys", () => {
  it("orders by code unit, which is the order the index file is written in", () => {
    expect(["zdravo", "kafa", "cvet", "cvek"].sort(compareDictionaryKeys)).toEqual([
      "cvek",
      "cvet",
      "kafa",
      "zdravo",
    ]);
    expect(compareDictionaryKeys("kafa", "kafa")).toBe(0);
    expect(compareDictionaryKeys("kafa", "kafana")).toBeLessThan(0);
  });
});

describe("the builder's fold and the app's fold", () => {
  it("fold one word to the same key", () => {
    const words = [
      "kafa",
      "Kafa",
      "ćevapčići",
      "cevapcici",
      "Đorđe",
      "džep",
      "šuma",
      "žena",
      "čačak",
      "ljubav",
      "njiva",
      "café",
      "straße",
      "куца",
      "жена",
      "ђак",
      "љубав",
      "џеп",
      "ћар",
    ];
    for (const word of words) {
      expect(dictionaryKey(word), word).toBe(coreDictionaryKey(word));
    }
  });
});
