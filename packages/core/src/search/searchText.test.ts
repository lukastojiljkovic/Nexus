import { describe, expect, it } from "vitest";
import { buildSearchSnippet, foldSearchText, foldWithOffsets } from "./searchText.js";

describe("foldWithOffsets / foldSearchText invariant", () => {
  it("foldSearchText always equals foldWithOffsets(x).folded", () => {
    for (const input of ["Đorđe", "Šta čekaš, Ćiro?", "Rešenje", "Ђорђе", "", "plain text 123"]) {
      expect(foldSearchText(input)).toBe(foldWithOffsets(input).folded);
    }
  });

  it("offsets.length always equals folded.length", () => {
    for (const input of ["Đorđe", "Šta čekaš, Ćiro?", "š", "ađb", ""]) {
      const { folded, offsets } = foldWithOffsets(input);
      expect(offsets.length).toBe(folded.length);
    }
  });
});

describe("foldSearchText — Serbian diacritics and Cyrillic", () => {
  it("folds Đorđe, ĐORĐE (Latin, any case) and Ђорђе (Cyrillic) to the same string", () => {
    expect(foldSearchText("Đorđe")).toBe("djordje");
    expect(foldSearchText("ĐORĐE")).toBe("djordje");
    expect(foldSearchText("Ђорђе")).toBe("djordje");
  });

  it("does NOT fold a plain diacritic-free 'dordje' to 'djordje' — that is expected to differ", () => {
    expect(foldSearchText("dordje")).toBe("dordje");
    expect(foldSearchText("dordje")).not.toBe("djordje");
  });

  it("folds š č ć ž via NFD stripping", () => {
    expect(foldSearchText("Rešenje")).toBe("resenje");
  });

  it("folds a full sentence mixing punctuation and diacritics", () => {
    expect(foldSearchText("Šta čekaš, Ćiro?")).toBe("sta cekas, ciro?");
  });

  it("folds a precomposed š (single code point)", () => {
    const { folded, offsets } = foldWithOffsets("š");
    expect(folded).toBe("s");
    expect(offsets).toEqual([0]);
  });

  it("folds an explicitly decomposed 's' + combining caron (two code points) the same as precomposed š", () => {
    const decomposed = "s" + "̌";
    const { folded, offsets } = foldWithOffsets(decomposed);
    expect(folded).toBe("s");
    expect(offsets).toEqual([0]);
  });

  it("tracks offsets correctly across a đ expansion (one source char -> two folded chars)", () => {
    const { folded, offsets } = foldWithOffsets("ađb");
    expect(folded).toBe("adjb");
    expect(offsets).toEqual([0, 1, 1, 2]);
  });

  it("a bare combining mark with no base character contributes nothing", () => {
    const input = "́b";
    const { folded, offsets } = foldWithOffsets(input);
    expect(folded).toBe("b");
    expect(offsets).toEqual([1]);
  });
});

describe("buildSearchSnippet", () => {
  it("highlights the word at a token boundary, not a substring inside a longer word", () => {
    const source = "Gradovi i radovi su lepi.";
    const result = buildSearchSnippet(source, ["rad"]);
    expect(result.text).toBe(source);
    expect(result.ranges).toHaveLength(1);
    const [start, end] = result.ranges[0]!;
    expect(result.text.slice(start, end)).toBe("rad");
    // the match is inside "radovi" (the second word), not "Gradovi"
    expect(result.text.slice(0, start).endsWith(" ")).toBe(true);
  });

  it("returns the source unchanged with no ranges when nothing matches and it fits the fallback window", () => {
    const source = "Kratak tekst bez podudaranja.";
    const result = buildSearchSnippet(source, ["nepostojeca"]);
    expect(result.text).toBe(source);
    expect(result.ranges).toEqual([]);
  });

  it("falls back to a truncated prefix with an ellipsis when nothing matches and the source is long", () => {
    const source = "x".repeat(200);
    const result = buildSearchSnippet(source, ["nepostojeca"]);
    expect(result.ranges).toEqual([]);
    expect(result.text.endsWith("…")).toBe(true);
    expect(result.text.length).toBe(2 * 60 + 1); // default radius 60
  });

  it("produces a window with an ellipsis on both sides whose ranges land on the matched word", () => {
    const before = "Ovo je jedna prilicno duga recenica koja postoji samo da bi popunila prostor ispred. ";
    const after = " I ovde ide dosta teksta posle kljucne reci kako bi se popunio prostor iza takodje.";
    const source = before + "biciklizam" + after;
    const result = buildSearchSnippet(source, ["biciklizam"], { radius: 20 });

    expect(result.text.startsWith("…")).toBe(true);
    expect(result.text.endsWith("…")).toBe(true);
    expect(result.ranges).toHaveLength(1);
    const [start, end] = result.ranges[0]!;
    expect(result.text.slice(start, end)).toBe("biciklizam");
  });

  it("merges overlapping ranges from two terms matching at the same position", () => {
    const source = "cats and dogs";
    const result = buildSearchSnippet(source, ["cat", "cats"]);
    expect(result.ranges).toHaveLength(1);
    const [start, end] = result.ranges[0]!;
    expect(result.text.slice(start, end)).toBe("cats");
  });

  it("maps ranges back through a đ expansion, where one source char produced two folded ones", () => {
    const source = "Pozvao je Đorđa na kafu.";
    const result = buildSearchSnippet(source, ["djordja"]);
    expect(result.ranges).toHaveLength(1);
    const [start, end] = result.ranges[0]!;
    // The highlight must cover the ORIGINAL spelling, two characters shorter
    // than the folded term that found it.
    expect(result.text.slice(start, end)).toBe("Đorđa");
  });

  it("ignores an empty term instead of matching everywhere", () => {
    const source = "Nista posebno ovde.";
    const result = buildSearchSnippet(source, [""]);
    expect(result.ranges).toEqual([]);
    expect(result.text).toBe(source);
  });
});
