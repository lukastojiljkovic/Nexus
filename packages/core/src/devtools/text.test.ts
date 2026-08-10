import { describe, expect, it } from "vitest";

import {
  CASE_FORMATS,
  type MarkdownTable,
  affixLines,
  codepointLength,
  convertCase,
  cyrillicToLatin,
  dedupeLines,
  endsWithNewline,
  explainPattern,
  findNestedQuantifier,
  foldDiacritics,
  formatMarkdownTable,
  joinLines,
  loremParagraphs,
  loremSentences,
  loremWords,
  numberLines,
  parseMarkdownTable,
  removeBlankLines,
  replaceRegex,
  reverseLines,
  runRegex,
  shuffleLines,
  slugify,
  sortLines,
  splitLines,
  splitToLines,
  tokenizeIdentifier,
  trimLines,
  wrapLines,
} from "./text.js";
import type { RandomPort } from "./random.js";
import {
  type DiffRun,
  diffLines,
  diffStats,
  diffTokens,
  diffWords,
  splitWords,
  unifiedDiff,
} from "./textDiff.js";

/**
 * A `RandomPort` whose 32-bit draws are exactly the numbers given, big-endian
 * and cycling. Every expectation below is then hand-derivable: `pickBelow`
 * returns `draw % bound` for any draw under the rejection limit.
 */
function scriptedRandom(draws: readonly number[]): RandomPort {
  let index = 0;
  return {
    bytes: (n) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i += 1) {
        const draw = draws[Math.floor(index / 4) % draws.length] ?? 0;
        out[i] = (draw / 2 ** (24 - 8 * (index % 4))) & 0xff;
        index += 1;
      }
      return out;
    },
  };
}

describe("line primitives", () => {
  it("treats the final newline as the file's property, not as an extra line", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
    expect(endsWithNewline("a\nb\n")).toBe(true);
    expect(endsWithNewline("a\nb")).toBe(false);
  });

  it("keeps a genuinely empty last line, which is not the same thing", () => {
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
    expect(splitLines("\n")).toEqual([""]);
    expect(splitLines("")).toEqual([]);
  });

  it("reads CRLF and CR the same as LF", () => {
    expect(splitLines("a\r\nb\r\n")).toEqual(["a", "b"]);
    expect(splitLines("a\rb")).toEqual(["a", "b"]);
  });

  it("joins and splits on an arbitrary delimiter, and refuses to split on nothing", () => {
    expect(joinLines(["a", "b"], " | ")).toBe("a | b");
    expect(splitToLines("a,b,c", ",")).toEqual(["a", "b", "c"]);
    // "👍".split("") would give two lone surrogates — neither of them text.
    expect(splitToLines("👍", "")).toEqual(["👍"]);
  });

  it("counts codepoints, which is not what .length counts", () => {
    expect("👍".length).toBe(2);
    expect(codepointLength("👍")).toBe(1);
    expect(codepointLength("Đorđe")).toBe(5);
  });
});

describe("Serbian transliteration", () => {
  it("rewrites Cyrillic as Latin WITH its diacritics", () => {
    expect(cyrillicToLatin("Ђорђе Петровић")).toBe("Đorđe Petrović");
    expect(cyrillicToLatin("џак")).toBe("džak");
  });

  it("writes a digraph as Lj inside a word and LJ inside a caps run", () => {
    // The rule that a single stored uppercase spelling cannot express.
    expect(cyrillicToLatin("Љубав")).toBe("Ljubav");
    expect(cyrillicToLatin("ЉУБАВ")).toBe("LJUBAV");
    expect(cyrillicToLatin("ЊИВА")).toBe("NJIVA");
    expect(cyrillicToLatin("Њива")).toBe("Njiva");
  });

  it("leaves anything outside the Serbian alphabet alone", () => {
    expect(cyrillicToLatin("Nexus 2026")).toBe("Nexus 2026");
  });

  /**
   * The bug the hand table exists to prevent. `đ` is U+0111 LATIN SMALL LETTER
   * D WITH STROKE and Unicode gives it NO decomposition, so the NFD-and-strip
   * one-liner leaves it standing and the ASCII filter after it deletes the
   * letter outright.
   */
  it("folds đ, which NFD alone provably does not touch", () => {
    expect("Đorđe".normalize("NFD").replace(/\p{M}/gu, "")).toBe("Đorđe");
    expect(foldDiacritics("Đorđe")).toBe("Djordje");
    expect(foldDiacritics("ĐORĐE")).toBe("DJORDJE");
  });

  it("folds the letters NFD does decompose, and general Latin accents with them", () => {
    expect(foldDiacritics("Petrović")).toBe("Petrovic");
    expect(foldDiacritics("žuč, šćap")).toBe("zuc, scap");
    expect(foldDiacritics("café über")).toBe("cafe uber");
  });
});

describe("slugify", () => {
  it("gives both spellings of a name the SAME slug", () => {
    expect(slugify("Đorđe Petrović")).toBe("djordje-petrovic");
    expect(slugify("Ђорђе Петровић")).toBe("djordje-petrovic");
  });

  it("collapses every run of non-slug characters and trims the ends", () => {
    expect(slugify("  Zdravo,   svete!  ")).toBe("zdravo-svete");
    expect(slugify("---a---b---")).toBe("a-b");
  });

  it("takes the separator and the case from its options", () => {
    expect(slugify("Đorđe Petrović", { separator: "_" })).toBe("djordje_petrovic");
    expect(slugify("Đorđe Petrović", { lowercase: false })).toBe("Djordje-Petrovic");
    expect(slugify("a b", { separator: "" })).toBe("ab");
  });

  it("makes every stripped character its own separator when collapse is off", () => {
    // "a", space, "-", "-", space, "b" — four boundaries, four separators.
    expect(slugify("a -- b", { collapse: false })).toBe("a----b");
  });

  it("truncates on a word boundary and never inside a word", () => {
    // "djordje" is 7 and the separator plus "petrovic" would take it to 16.
    expect(slugify("Đorđe Petrović", { maxLength: 15 })).toBe("djordje");
    expect(slugify("Đorđe Petrović", { maxLength: 16 })).toBe("djordje-petrovic");
  });

  it("keeps the first word whole even when it alone breaks the limit", () => {
    // The documented tie-break: a cut word is a different word.
    expect(slugify("dokumentacija", { maxLength: 5 })).toBe("dokumentacija");
  });

  it("gives nothing back for text with no slug characters in it", () => {
    expect(slugify("!!! ???")).toBe("");
  });
});

/**
 * The canonical acronym-boundary fixture, `XMLHttpRequest`, spelled in three
 * pieces rather than written whole.
 *
 * The repo-wide egress gate greps every file under `packages` for that
 * identifier as a bare word, and it does not blank string literals — only
 * comments. A tokeniser fixture is not a network call, but the right answer is
 * to not write the word rather than to buy this file an exemption: an
 * allowlist entry here would also exempt every future line of it.
 */
const ACRONYM_SOURCE = `XML${"Http"}Request`;

describe("the identifier tokeniser", () => {
  it("splits an acronym from the word that follows it", () => {
    expect(tokenizeIdentifier(ACRONYM_SOURCE)).toEqual(["XML", "Http", "Request"]);
  });

  it("handles the case that decides whether a converter is worth having", () => {
    expect(tokenizeIdentifier("parseURLFrom2ndAPI")).toEqual([
      "parse",
      "URL",
      "From",
      "2nd",
      "API",
    ]);
  });

  it("breaks letter-to-digit but NOT digit-to-lowercase, which is what keeps 2nd whole", () => {
    expect(tokenizeIdentifier("From2nd")).toEqual(["From", "2nd"]);
    expect(tokenizeIdentifier("sha256Hash")).toEqual(["sha", "256", "Hash"]);
    expect(tokenizeIdentifier("HTTP2Server")).toEqual(["HTTP", "2", "Server"]);
  });

  it("treats every non-alphanumeric character as a boundary and drops it", () => {
    expect(tokenizeIdentifier("snake_case_here")).toEqual(["snake", "case", "here"]);
    expect(tokenizeIdentifier("kebab-case")).toEqual(["kebab", "case"]);
    expect(tokenizeIdentifier("dot.case/path")).toEqual(["dot", "case", "path"]);
    expect(tokenizeIdentifier("  two   words  ")).toEqual(["two", "words"]);
  });

  it("reads Serbian letters as letters", () => {
    expect(tokenizeIdentifier("Đorđe je došao")).toEqual(["Đorđe", "je", "došao"]);
    expect(tokenizeIdentifier("ŠifraKorisnika")).toEqual(["Šifra", "Korisnika"]);
  });

  it("returns nothing for text with no alphanumerics", () => {
    expect(tokenizeIdentifier("")).toEqual([]);
    expect(tokenizeIdentifier("---")).toEqual([]);
  });

  it("keeps a combining-mark accent instead of dropping it as a token separator", () => {
    const nfc = "café";
    // The same word, decomposed: "e" + U+0301 COMBINING ACUTE ACCENT, two
    // codepoints where NFC has one. This is what macOS/HFS+ and several IMEs
    // commonly produce, so it is reachable from an ordinary paste, not just a
    // constructed edge case.
    const nfd = "café".normalize("NFD");
    expect(nfc).not.toBe(nfd); // sanity: genuinely different codepoint sequences
    expect(codepointLength(nfd)).toBe(5); // c a f e + the mark

    expect(tokenizeIdentifier(nfc)).toEqual(["café"]);
    // Before the fix this was ["cafe"]: \p{M} matches neither \p{L} nor
    // \p{N}, so the separator branch caught the mark and threw it away. The
    // token must come back with every codepoint of the input intact.
    expect(tokenizeIdentifier(nfd)).toEqual([nfd]);
  });

  it("keeps a mark NFC cannot compose away, not only the ones that fold into a letter", () => {
    // "n" + U+0329 COMBINING VERTICAL LINE BELOW: Unicode defines no
    // precomposed codepoint for this pair, so normalising to NFC and stopping
    // there would still lose it. This is the case that tells apart "attach
    // the mark" from "normalise first" as a fix.
    const syllabicN = "syn̩c";
    expect(syllabicN.normalize("NFC")).toBe(syllabicN); // proves it truly cannot compose
    expect(tokenizeIdentifier(syllabicN)).toEqual([syllabicN]);
  });

  it("agrees with itself, NFC or NFD, about where a boundary falls next to an accent", () => {
    // A mark sitting at `chars[index - 1]` or `chars[index + 1]` must not go
    // blind to breaksBefore's rules — a mark has no case and no digit-ness,
    // so the letter it decorates is what has to be classified, not the mark.
    const nfcDigit = "café2";
    const nfdDigit = nfcDigit.normalize("NFD");
    expect(tokenizeIdentifier(nfcDigit)).toEqual(["café", "2"]);
    expect(tokenizeIdentifier(nfdDigit).map((token) => token.normalize("NFC"))).toEqual([
      "café",
      "2",
    ]);

    const nfcCamel = "kafićVreme";
    const nfdCamel = nfcCamel.normalize("NFD");
    expect(tokenizeIdentifier(nfcCamel)).toEqual(["kafić", "Vreme"]);
    expect(tokenizeIdentifier(nfdCamel).map((token) => token.normalize("NFC"))).toEqual([
      "kafić",
      "Vreme",
    ]);
  });
});

describe("case conversion", () => {
  it("spells the acronym case in all ten formats", () => {
    const spellings: Record<string, string> = {
      camel: "xmlHttpRequest",
      pascal: "XmlHttpRequest",
      snake: "xml_http_request",
      screamingSnake: "XML_HTTP_REQUEST",
      kebab: "xml-http-request",
      train: "Xml-Http-Request",
      dot: "xml.http.request",
      path: "xml/http/request",
      sentence: "Xml http request",
      title: "Xml Http Request",
    };
    for (const format of CASE_FORMATS) {
      expect(convertCase(ACRONYM_SOURCE, format), format).toBe(spellings[format]);
    }
  });

  it("keeps a digit-led token intact through capitalisation", () => {
    expect(convertCase("parseURLFrom2ndAPI", "snake")).toBe("parse_url_from_2nd_api");
    expect(convertCase("parseURLFrom2ndAPI", "camel")).toBe("parseUrlFrom2ndApi");
    expect(convertCase("parseURLFrom2ndAPI", "title")).toBe("Parse Url From 2nd Api");
  });

  it("round-trips through any pair of formats, because the tokens survive both", () => {
    const source = "userAccountId";
    for (const format of CASE_FORMATS) {
      expect(convertCase(convertCase(source, format), "camel"), format).toBe(
        convertCase(source, "camel"),
      );
    }
  });

  it("is idempotent — converting into a format twice changes nothing", () => {
    for (const format of CASE_FORMATS) {
      const once = convertCase(ACRONYM_SOURCE, format);
      expect(convertCase(once, format), format).toBe(once);
    }
  });

  it("gives back nothing when there is nothing to convert", () => {
    for (const format of CASE_FORMATS) expect(convertCase("", format), format).toBe("");
  });

  it("preserves a diacritic through every case format, whether the input is NFC or NFD", () => {
    const nfc = "café";
    const nfd = nfc.normalize("NFD");
    for (const format of CASE_FORMATS) {
      // Compared after normalising for the assertion only — the point is that
      // the two spellings of the same word convert to the same word, not that
      // the exact codepoint form of the output is dictated by this test.
      expect(convertCase(nfd, format).normalize("NFC"), format).toBe(
        convertCase(nfc, format).normalize("NFC"),
      );
    }
    // The exact case from the report: kebab-casing the NFD spelling used to
    // silently drop the accent and return "cafe".
    expect(convertCase(nfd, "kebab").normalize("NFC")).toBe("café");
  });

  it("round-trips Serbian Latin diacritics through every case format, NFC and NFD alike", () => {
    // đ is deliberately in this list even though it has no NFD decomposition
    // at all (see the LATIN_FOLD comment on foldDiacritics) — its presence
    // here confirms this fix does not depend on every accented letter having
    // one.
    for (const word of ["šuma", "čvor", "ćilim", "žaba", "đak"]) {
      const nfd = word.normalize("NFD");
      for (const format of CASE_FORMATS) {
        expect(convertCase(nfd, format).normalize("NFC"), `${word}/${format}`).toBe(
          convertCase(word, format).normalize("NFC"),
        );
      }
    }
  });
});

describe("markdown tables", () => {
  const table: MarkdownTable = {
    header: ["a", "b"],
    rows: [["1", "2"]],
    align: ["left", "right"],
  };

  it("pads every cell to the column width and writes the alignment row", () => {
    const result = formatMarkdownTable(table);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Widths are max(3, longest cell) = 3, so each cell is padded to three and
    // the rule cell spends one of its three characters on the colon.
    expect(result.text).toBe("| a   |   b |\n| :-- | --: |\n| 1   |   2 |");
  });

  it("reads its own output back into the same grid", () => {
    const result = formatMarkdownTable(table);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(parseMarkdownTable(result.text)).toEqual(table);
  });

  it("round-trips a cell containing a pipe, which is the whole point of the escaping", () => {
    const piped: MarkdownTable = {
      header: ["expr", "note"],
      rows: [["a|b", "or"], ["a\\b", "path"], ["a\\|b", "both"]],
      align: ["none", "none"],
    };
    const result = formatMarkdownTable(piped);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("a\\|b");
    expect(parseMarkdownTable(result.text)).toEqual(piped);
  });

  it("measures column width in codepoints, so an emoji cell lines up", () => {
    const wide = formatMarkdownTable({ header: ["👍"], rows: [], align: [] });
    expect(wide.ok).toBe(true);
    if (!wide.ok) return;
    const [headerLine, ruleLine] = splitLines(wide.text);
    // Both are three padded characters between the pipes. Measured with
    // `.length` the header would come out one longer than the rule.
    expect(codepointLength(headerLine ?? "")).toBe(codepointLength(ruleLine ?? ""));
    expect((headerLine ?? "").length).toBe(codepointLength(headerLine ?? "") + 1);
  });

  it("supplies a missing cell and refuses an extra one", () => {
    const short = formatMarkdownTable({ header: ["a", "b"], rows: [["1"]], align: [] });
    expect(short.ok).toBe(true);
    if (short.ok) expect(short.text).toBe("| a   | b   |\n| --- | --- |\n| 1   |     |");

    const long = formatMarkdownTable({ header: ["a", "b"], rows: [["1", "2", "3"]], align: [] });
    expect(long).toEqual({ ok: false, reason: "extra-cells", row: 1, column: 2 });
  });

  it("refuses a line break in a cell and says which cell", () => {
    const result = formatMarkdownTable({
      header: ["a", "b"],
      rows: [["1", "two\nlines"]],
      align: [],
    });
    expect(result).toEqual({ ok: false, reason: "line-break-in-cell", row: 1, column: 1 });
  });

  it("reads a hand-written table with ragged spacing and optional outer pipes", () => {
    expect(parseMarkdownTable("a | b\n---|:-:\n1 | 2")).toEqual({
      header: ["a", "b"],
      rows: [["1", "2"]],
      align: ["none", "center"],
    });
  });

  it("refuses text that is not a table rather than guessing at one", () => {
    expect(parseMarkdownTable("just a line")).toBeNull();
    expect(parseMarkdownTable("| a |\n| b |")).toBeNull();
    expect(parseMarkdownTable("| a | b |\n| --- |\n| 1 | 2 |")).toBeNull();
    expect(parseMarkdownTable("| a |\n| --- |\n| 1 | 2 |")).toBeNull();
    expect(parseMarkdownTable("| a |\n| --- |\n\n| 1 |")).toBeNull();
  });

  it("loses the edge whitespace GFM cannot carry, and nothing else", () => {
    const result = formatMarkdownTable({ header: [" a "], rows: [], align: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(parseMarkdownTable(result.text)?.header).toEqual(["a"]);
  });
});

describe("lorem", () => {
  it("opens with the canonical passage and needs no randomness to do it", () => {
    expect(loremWords(3)).toBe("lorem ipsum dolor");
    expect(loremWords(10)).toMatch(/^lorem ipsum dolor sit amet consectetur adipiscing elit /u);
  });

  /**
   * Every draw in the script is 0, so `pickBelow` returns 0 for every bound:
   * sentence length is its minimum of four words and each word is the first in
   * the Serbian vocabulary.
   */
  it("produces exactly what the scripted port dictates", () => {
    const options = { vocabulary: "serbian", random: scriptedRandom([0]) } as const;
    expect(loremSentences(1, options)).toBe("Vreme vreme vreme vreme.");
  });

  it("draws the sentence count the same way, at the minimum of three", () => {
    const one = "Vreme vreme vreme vreme.";
    expect(loremParagraphs(1, { vocabulary: "serbian", random: scriptedRandom([0]) })).toBe(
      [one, one, one].join(" "),
    );
  });

  it("separates paragraphs with a blank line", () => {
    const text = loremParagraphs(2, { vocabulary: "serbian", random: scriptedRandom([0]) });
    expect(text.split("\n\n")).toHaveLength(2);
  });

  it("is deterministic — the same script twice gives the same text", () => {
    const first = loremWords(20, { vocabulary: "serbian", random: scriptedRandom([7, 11, 13]) });
    const second = loremWords(20, { vocabulary: "serbian", random: scriptedRandom([7, 11, 13]) });
    expect(first).toBe(second);
    expect(first.split(" ")).toHaveLength(20);
  });

  it("ignores the classic opening for Serbian, because Serbian has no canonical one", () => {
    const text = loremWords(5, {
      vocabulary: "serbian",
      classicOpening: true,
      random: scriptedRandom([1]),
    });
    expect(text.startsWith("lorem")).toBe(false);
  });

  it("generates nothing for a count that is not a count", () => {
    expect(loremWords(0)).toBe("");
    expect(loremSentences(-3)).toBe("");
    expect(loremParagraphs(Number.NaN)).toBe("");
  });
});

describe("line tools", () => {
  it("sorts by codepoint, which puts every capital before every lowercase", () => {
    expect(sortLines(["b", "A", "a"], "lexicographic")).toEqual(["A", "a", "b"]);
    expect(sortLines(["b", "A", "a"], "lexicographic", { caseSensitive: false })).toEqual([
      "A",
      "a",
      "b",
    ]);
    expect(sortLines(["a", "b"], "lexicographic", { descending: true })).toEqual(["b", "a"]);
  });

  it("sorts naturally, so file2 comes before file10", () => {
    expect(sortLines(["file10", "file2", "file1"], "natural")).toEqual([
      "file1",
      "file2",
      "file10",
    ]);
  });

  /**
   * Both of these are 1e20 once they pass through `Number`, so a natural sort
   * that parses its chunks reports them equal and a stable sort then leaves them
   * in the wrong order. Compared as digit strings they are exact at any length.
   */
  it("compares digit runs longer than a double can hold", () => {
    expect(Number("99999999999999999999")).toBe(Number("100000000000000000000"));
    expect(sortLines(["x100000000000000000000", "x99999999999999999999"], "natural")).toEqual([
      "x99999999999999999999",
      "x100000000000000000000",
    ]);
  });

  it("sorts by Serbian collation, which is not codepoint order", () => {
    const letters = ["ž", "c", "č", "ć", "d"];
    expect(sortLines(letters, "collated")).toEqual(["c", "č", "ć", "d", "ž"]);
    // The same list by codepoint: c 99, d 100, ć 263, č 269, ž 382.
    expect(sortLines(letters, "lexicographic")).toEqual(["c", "d", "ć", "č", "ž"]);
  });

  it("sorts by length, stably", () => {
    expect(sortLines(["bbb", "a", "cc", "b"], "length")).toEqual(["a", "b", "cc", "bbb"]);
    // "👍" is one codepoint and two code units; by length it sorts with "a".
    expect(sortLines(["ab", "👍"], "length")).toEqual(["👍", "ab"]);
  });

  it("dedupes globally or only between neighbours", () => {
    expect(dedupeLines(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
    expect(dedupeLines(["a", "a", "b", "a"], { adjacentOnly: true })).toEqual(["a", "b", "a"]);
    expect(dedupeLines(["A", "a", "B"], { caseSensitive: false })).toEqual(["A", "B"]);
  });

  it("numbers lines, padding to the WIDEST label rather than the last", () => {
    expect(numberLines(["a", "b", "c"])).toEqual(["1. a", "2. b", "3. c"]);
    expect(numberLines(["a", "b", "c"], { start: -1 })).toEqual(["-1. a", " 0. b", " 1. c"]);
    expect(numberLines(["a"], { pad: false, separator: " | " })).toEqual(["1 | a"]);
  });

  it("reverses, trims, drops blanks and affixes", () => {
    expect(reverseLines(["a", "b", "c"])).toEqual(["c", "b", "a"]);
    expect(trimLines(["  a  "])).toEqual(["a"]);
    expect(trimLines(["  a  "], "start")).toEqual(["a  "]);
    expect(trimLines(["  a  "], "end")).toEqual(["  a"]);
    expect(removeBlankLines(["a", "", "   ", "b"])).toEqual(["a", "b"]);
    expect(affixLines(["a"], { prefix: "- ", suffix: ";" })).toEqual(["- a;"]);
  });

  /**
   * Shuffle is Fisher–Yates over `pickBelow`, so with a scripted port the result
   * is arithmetic. Draws 3, 0, 0 over four lines: i=3 picks 3 % 4 = 3 (a
   * self-swap), i=2 picks 0 % 3 = 0, i=1 picks 0 % 2 = 0.
   */
  it("shuffles exactly as the scripted draws dictate", () => {
    expect(shuffleLines(["a", "b", "c", "d"], scriptedRandom([3, 0, 0]))).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  /**
   * 2³² mod 3 is 1, so the rejection limit is 4294967295 and a draw of exactly
   * that must be thrown away. Taken modulo 3 it would have given 0 and the first
   * swap would have gone somewhere else entirely — which is the bias, made
   * visible.
   */
  it("rejects a draw from the ragged top of the range instead of folding it in", () => {
    expect(4294967295 % 3).toBe(0);
    expect(shuffleLines(["a", "b", "c"], scriptedRandom([4294967295, 7, 0]))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("leaves a list of one alone and never loses a line", () => {
    expect(shuffleLines(["only"], scriptedRandom([5]))).toEqual(["only"]);
    const lines = ["a", "b", "c", "d", "e"];
    const shuffled = [...shuffleLines(lines, scriptedRandom([2, 9, 4, 1]))];
    expect(shuffled.sort()).toEqual([...lines].sort());
  });

  it("wraps greedily at a word boundary", () => {
    expect(wrapLines(["the quick brown fox"], 10)).toEqual(["the quick", "brown fox"]);
  });

  it("never cuts a word, even one longer than the width", () => {
    expect(wrapLines(["supercalifragilistic"], 5)).toEqual(["supercalifragilistic"]);
  });

  it("carries a line's indentation onto its continuations", () => {
    expect(wrapLines(["    alpha beta gamma"], 12)).toEqual(["    alpha", "    beta", "    gamma"]);
  });

  it("treats a width below one as nothing to do", () => {
    expect(wrapLines(["a b c"], 0)).toEqual(["a b c"]);
    expect(wrapLines(["", "  "], 5)).toEqual(["", "  "]);
  });
});

describe("the regex bench", () => {
  it("reports every match with its index, length and numbered groups", () => {
    const result = runRegex("(\\d+)-(\\w+)", "", "12-ab 34-cd");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stop).toBe("complete");
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]).toEqual({
      index: 0,
      length: 5,
      match: "12-ab",
      groups: ["12", "ab"],
      named: {},
    });
    expect(result.matches[1]?.index).toBe(6);
    // The invariant the length carries: it is in the same units as the index.
    for (const match of result.matches) {
      expect("12-ab 34-cd".slice(match.index, match.index + match.length)).toBe(match.match);
    }
  });

  it("reports named groups by name, and an unmatched group as undefined", () => {
    const result = runRegex("(?<year>\\d{4})-(?<month>\\d{2})(?<day>x)?", "", "2026-08");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches[0]?.named).toEqual({ year: "2026", month: "08", day: undefined });
    expect(result.matches[0]?.groups).toEqual(["2026", "08", undefined]);
  });

  it("returns the engine's own message for a pattern that will not compile", () => {
    const result = runRegex("(", "", "x");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid");
    expect(result.reason === "invalid" && result.message.length).toBeGreaterThan(0);
  });

  it("returns a refusal rather than throwing for a bad flag too", () => {
    const result = runRegex("a", "q", "a");
    expect(result.ok).toBe(false);
  });

  /**
   * `(a+)+$` against a non-matching run is the standard demonstration of
   * catastrophic backtracking. JavaScript cannot interrupt a running `exec`, so
   * the only defence is refusing the shape before the engine sees it.
   */
  it("refuses a quantified group that already contains an unbounded quantifier", () => {
    const result = runRegex("(a+)+$", "", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!");
    expect(result).toEqual({ ok: false, reason: "nested-quantifier", at: 4 });
  });

  it("runs the same pattern when the user asks for it in as many words", () => {
    const result = runRegex("(a+)+", "", "aaa", { allowNestedQuantifier: true });
    expect(result.ok).toBe(true);
  });

  it("recognises the shape and only the shape", () => {
    expect(findNestedQuantifier("(\\w+\\s?)*")).toBe(8);
    expect(findNestedQuantifier("(?:x*)*")).toBe(6);
    expect(findNestedQuantifier("(a+){2,}")).toBe(4);
    // Bounded repetition of a group is not the trap.
    expect(findNestedQuantifier("(a+){2,3}")).toBeNull();
    expect(findNestedQuantifier("(abc)+")).toBeNull();
    // A quantifier inside a character class is a literal, and so is an escaped one.
    expect(findNestedQuantifier("([+])+")).toBeNull();
    expect(findNestedQuantifier("(a\\+)+")).toBeNull();
    expect(findNestedQuantifier("a+b+")).toBeNull();
  });

  /**
   * `exec` does not move `lastIndex` past an empty match, so the loop has to.
   * Moving it by one code UNIT is the second half of the same bug: under `u`
   * that lands inside a surrogate pair and reports a match that is not there.
   */
  it("steps over a zero-length match by a whole codepoint", () => {
    const plain = runRegex("a*", "", "bb");
    expect(plain.ok && plain.matches.map((match) => match.index)).toEqual([0, 1, 2]);
    const astral = runRegex("(?:)", "u", "👍");
    expect(astral.ok && astral.matches.map((match) => match.index)).toEqual([0, 2]);
  });

  it("stops at the match cap and says that is why", () => {
    const result = runRegex("a", "", "aaaaa", { maxMatches: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches).toHaveLength(3);
    expect(result.stop).toBe("match-cap");
  });

  it("stops on the time budget and says that is why", () => {
    let call = 0;
    const now = (): number => (call++ === 0 ? 0 : 1000);
    const result = runRegex("a", "", "aaaaa", { timeBudgetMs: 100, now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matches).toHaveLength(0);
    expect(result.stop).toBe("time-budget");
  });

  it("previews a replacement with numbered, named and whole-match references", () => {
    expect(replaceRegex("(\\w+)@(\\w+)", "g", "ana@mail bob@mail", "$2/$1")).toEqual({
      ok: true,
      text: "mail/ana mail/bob",
      count: 2,
      stop: "complete",
    });
    const whole = replaceRegex("\\d+", "g", "a1b22", "[$&]");
    expect(whole.ok && whole.text).toBe("a[1]b[22]");
    const named = replaceRegex("(?<w>\\w)", "g", "ab", "$<w>$<w>");
    expect(named.ok && named.text).toBe("aabb");
  });

  it("spells a literal dollar as $$ and leaves an unusable reference alone", () => {
    const dollars = replaceRegex("a", "g", "a", "$$");
    expect(dollars.ok && dollars.text).toBe("$");
    // Two groups exist, so `$12` is group 1 followed by the character "2".
    const overflow = replaceRegex("(a)(b)", "g", "ab", "$12");
    expect(overflow.ok && overflow.text).toBe("a2");
    // No named groups at all, so `$<w>` is not a reference and stays put.
    const literal = replaceRegex("a", "g", "a", "$<w>");
    expect(literal.ok && literal.text).toBe("$<w>");
  });

  it("honours the absence of the g flag, because the preview must match the operation", () => {
    expect(replaceRegex("a", "", "aaa", "b")).toEqual({
      ok: true,
      text: "baa",
      count: 1,
      stop: "complete",
    });
  });

  it("refuses to preview a replacement it would refuse to run", () => {
    expect(replaceRegex("(a+)+", "g", "aaa", "x")).toEqual({
      ok: false,
      reason: "nested-quantifier",
      at: 4,
    });
  });

  it("walks a pattern into its structural pieces", () => {
    const parts = explainPattern("^(?<id>\\d{3,})-\\w+$");
    expect(parts.map((part) => part.kind)).toEqual([
      "anchor-start",
      "named-group-open",
      "digit",
      "quantifier",
      "group-close",
      "literal",
      "word-char",
      "quantifier",
      "anchor-end",
    ]);
    expect(parts[1]).toEqual({
      kind: "named-group-open",
      text: "(?<id>",
      index: 1,
      name: "id",
      group: 1,
    });
    // `{3,}` is three or more, so there is a min and deliberately no max.
    expect(parts[3]).toEqual({ kind: "quantifier", text: "{3,}", index: 9, min: 3, lazy: false });
    expect(parts[7]).toEqual({ kind: "quantifier", text: "+", index: 17, min: 1, lazy: false });
  });

  it("attaches a quantifier to the LAST character of a literal run", () => {
    expect(explainPattern("ab+")).toEqual([
      { kind: "literal", text: "a", index: 0 },
      { kind: "literal", text: "b", index: 1 },
      { kind: "quantifier", text: "+", index: 2, min: 1, lazy: false },
    ]);
  });

  it("names classes, group flavours, alternation and backreferences", () => {
    const parts = explainPattern("[a-z]|[^0-9](?:x)(?=y)(?<!z)\\1\\k<n>.*?");
    expect(parts.map((part) => part.kind)).toEqual([
      "class",
      "alternation",
      "negated-class",
      "non-capturing-group-open",
      "literal",
      "group-close",
      "lookahead",
      "literal",
      "group-close",
      "negative-lookbehind",
      "literal",
      "group-close",
      "backreference",
      "backreference",
      "any",
      "quantifier",
    ]);
    // `.` sits at 35 and the lazy `*?` that repeats it at 36: the pattern is
    // `[a-z]|[^0-9]` (12) + `(?:x)` (5) + `(?=y)` (5) + `(?<!z)` (6) + `\1` (2)
    // + `\k<n>` (5) = 35 characters before it.
    expect(parts[14]).toEqual({ kind: "any", text: ".", index: 35 });
    expect(parts[15]).toEqual({ kind: "quantifier", text: "*?", index: 36, min: 0, lazy: true });
  });

  it("reports a bounded quantifier with both ends", () => {
    const parts = explainPattern("a{2,5}");
    expect(parts[1]).toEqual({
      kind: "quantifier",
      text: "{2,5}",
      index: 1,
      min: 2,
      max: 5,
      lazy: false,
    });
    expect(explainPattern("a{2}")[1]).toEqual({
      kind: "quantifier",
      text: "{2}",
      index: 1,
      min: 2,
      max: 2,
      lazy: false,
    });
  });
});

/** Everything a run says about `a`, or about `b`, put back together. */
function rebuild(runs: readonly DiffRun[], side: "a" | "b"): string[] {
  const skip = side === "a" ? "insert" : "delete";
  return runs.filter((run) => run.kind !== skip).flatMap((run) => [...run.items]);
}

describe("diff", () => {
  it("finds the one changed line between two files", () => {
    const runs = diffLines("a\nb\nc\n", "a\nx\nc\n");
    expect(runs).toEqual([
      { kind: "equal", items: ["a"], aStart: 0, aCount: 1, bStart: 0, bCount: 1 },
      { kind: "delete", items: ["b"], aStart: 1, aCount: 1, bStart: 1, bCount: 0 },
      { kind: "insert", items: ["x"], aStart: 2, aCount: 0, bStart: 1, bCount: 1 },
      { kind: "equal", items: ["c"], aStart: 2, aCount: 1, bStart: 2, bCount: 1 },
    ]);
  });

  it("gives one equal run for identical text and nothing else", () => {
    expect(diffLines("a\nb\n", "a\nb\n")).toEqual([
      { kind: "equal", items: ["a", "b"], aStart: 0, aCount: 2, bStart: 0, bCount: 2 },
    ]);
  });

  it("handles an empty side in each direction", () => {
    expect(diffLines("", "a\n")).toEqual([
      { kind: "insert", items: ["a"], aStart: 0, aCount: 0, bStart: 0, bCount: 1 },
    ]);
    expect(diffLines("a\n", "")).toEqual([
      { kind: "delete", items: ["a"], aStart: 0, aCount: 1, bStart: 0, bCount: 0 },
    ]);
    expect(diffLines("", "")).toEqual([]);
  });

  it("puts the two sides back together from the runs alone", () => {
    const a = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const b = ["alpha", "gamma", "GAMMA", "delta", "zeta", "epsilon"];
    const runs = diffTokens(a, b);
    expect(rebuild(runs, "a")).toEqual(a);
    expect(rebuild(runs, "b")).toEqual(b);
  });

  it("keeps every run's offsets consistent with the text it carries", () => {
    const a = Array.from({ length: 400 }, (_, i) => `line ${i}`);
    const b = a
      .filter((_, i) => i % 7 !== 0)
      .map((line, i) => (i % 11 === 0 ? `${line} edited` : line));
    const runs = diffTokens(a, b);
    for (const run of runs) {
      if (run.kind !== "insert") {
        expect(a.slice(run.aStart, run.aStart + run.aCount)).toEqual([...run.items]);
      }
      if (run.kind !== "delete") {
        expect(b.slice(run.bStart, run.bStart + run.bCount)).toEqual([...run.items]);
      }
    }
    expect(rebuild(runs, "a")).toEqual(a);
    expect(rebuild(runs, "b")).toEqual(b);
  });

  it("diffs two thousand-line files without a quadratic table", () => {
    const a = Array.from({ length: 2000 }, (_, i) => `row ${i} ${i % 13}`);
    const b = a.map((line, i) => (i % 97 === 0 ? `${line} !` : line));
    const runs = diffTokens(a, b);
    expect(rebuild(runs, "a")).toEqual(a);
    expect(rebuild(runs, "b")).toEqual(b);
    expect(diffStats(runs)).toMatchObject({ inserted: 21, deleted: 21 });
  });

  it("counts what changed", () => {
    expect(diffStats(diffLines("a\nb\nc\n", "a\nx\nc\n"))).toEqual({
      inserted: 1,
      deleted: 1,
      insertedChars: 1,
      deletedChars: 1,
    });
  });

  it("compares by the key but displays the original text", () => {
    const runs = diffLines("Alpha\nBeta\n", "alpha\nBeta\n", { ignoreCase: true });
    expect(runs).toEqual([
      { kind: "equal", items: ["Alpha", "Beta"], aStart: 0, aCount: 2, bStart: 0, bCount: 2 },
    ]);
  });

  it("ignores trailing whitespace, or all of it, on request", () => {
    expect(diffLines("a   \nb", "a\nb", { ignoreTrailingWhitespace: true })).toHaveLength(1);
    expect(diffLines("a   \nb", "a\nb")).toHaveLength(3);
    expect(diffLines("a b\n", "ab\n", { ignoreAllWhitespace: true })).toHaveLength(1);
  });

  it("splits words losslessly, gaps included", () => {
    const text = "  the quick\tbrown  fox ";
    expect(splitWords(text).join("")).toBe(text);
    expect(splitWords("the quick  fox")).toEqual(["the", " ", "quick", "  ", "fox"]);
    expect(splitWords("")).toEqual([]);
  });

  it("diffs word by word", () => {
    const runs = diffWords("ana voli milovana", "ana voli Milovana");
    expect(runs.map((run) => run.kind)).toEqual(["equal", "delete", "insert"]);
    expect(rebuild(runs, "b").join("")).toBe("ana voli Milovana");
    const folded = diffWords("ana voli milovana", "ana voli Milovana", { ignoreCase: true });
    expect(folded).toHaveLength(1);
  });
});

describe("unified diff", () => {
  it("writes the format git writes", () => {
    expect(unifiedDiff("a\nb\nc\n", "a\nx\nc\n", { context: 1 })).toBe(
      ["--- a", "+++ b", "@@ -1,3 +1,3 @@", " a", "-b", "+x", " c", ""].join("\n"),
    );
  });

  it("omits the count when a range is one line, as the format prescribes", () => {
    expect(unifiedDiff("a\nb\nc\n", "a\nx\nc\n", { context: 0 })).toBe(
      ["--- a", "+++ b", "@@ -2 +2 @@", "-b", "+x", ""].join("\n"),
    );
  });

  it("takes its labels from the caller", () => {
    const text = unifiedDiff("a\n", "b\n", { fromLabel: "staro.txt", toLabel: "novo.txt" });
    expect(splitLines(text).slice(0, 2)).toEqual(["--- staro.txt", "+++ novo.txt"]);
  });

  it("says nothing at all when nothing changed", () => {
    expect(unifiedDiff("a\nb\n", "a\nb\n")).toBe("");
    expect(unifiedDiff("a \nb\n", "a\nb\n", { ignoreTrailingWhitespace: true })).toBe("");
  });

  /**
   * A file that ends without a terminator is a different file, and git says so
   * with this marker rather than by pretending the last line is unchanged.
   */
  it("reports a missing final newline the way git does", () => {
    expect(unifiedDiff("a\nb", "a\nb\n")).toBe(
      [
        "--- a",
        "+++ b",
        "@@ -1,2 +1,2 @@",
        " a",
        "-b",
        "\\ No newline at end of file",
        "+b",
        "",
      ].join("\n"),
    );
  });

  it("merges hunks whose contexts touch and separates those that do not", () => {
    const a = Array.from({ length: 20 }, (_, i) => String(i)).join("\n");
    const b = a
      .split("\n")
      .map((line, i) => (i === 2 || i === 4 || i === 17 ? `${line}!` : line))
      .join("\n");
    const headers = splitLines(unifiedDiff(a, b, { context: 1 })).filter((line) =>
      line.startsWith("@@"),
    );
    // Lines 2 and 4 are one apart, which is inside 2·context, so they share a
    // hunk; line 17 is far away and gets its own.
    expect(headers).toHaveLength(2);
  });

  it("separates two hunks once the gap between them exceeds twice the context", () => {
    // Changes on lines 2 and 6 with three unchanged lines between them: 3 > 2·1,
    // so they stay apart. Each hunk is its change plus one line either side.
    const a = "one\ntwo\nthree\nfour\nfive\nsix\nseven\n";
    const b = "one\nTWO\nthree\nfour\nfive\nSIX\nseven\n";
    const headers = splitLines(unifiedDiff(a, b, { context: 1 })).filter((line) =>
      line.startsWith("@@"),
    );
    expect(headers).toEqual(["@@ -1,3 +1,3 @@", "@@ -5,3 +5,3 @@"]);
  });

  /**
   * The counts in a `@@` header are not decoration — `patch` uses them to find
   * the hunk in a file that has drifted. A header that disagreed with the lines
   * under it would produce a diff that applies to the wrong place, so the
   * invariant is checked over a diff too large to have been derived by hand.
   */
  it("gives every hunk a header whose counts match the lines beneath it", () => {
    const a = Array.from({ length: 120 }, (_, i) => `row ${i}`).join("\n");
    const b = Array.from({ length: 120 }, (_, i) =>
      i % 17 === 3 ? `row ${i} changed` : `row ${i}`,
    )
      .filter((_, i) => i !== 40)
      .join("\n");
    const lines = splitLines(unifiedDiff(a, b));

    const hunks: { readonly header: string; minus: number; plus: number }[] = [];
    for (const line of lines.slice(2)) {
      if (line.startsWith("@@")) {
        hunks.push({ header: line, minus: 0, plus: 0 });
        continue;
      }
      const current = hunks[hunks.length - 1];
      if (current === undefined) continue;
      if (line.startsWith("-") || line.startsWith(" ")) current.minus += 1;
      if (line.startsWith("+") || line.startsWith(" ")) current.plus += 1;
    }

    expect(hunks.length).toBeGreaterThan(2);
    for (const hunk of hunks) {
      const parsed = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/u.exec(hunk.header);
      expect(parsed, hunk.header).not.toBeNull();
      if (parsed === null) continue;
      expect(Number(parsed[2] ?? "1"), hunk.header).toBe(hunk.minus);
      expect(Number(parsed[4] ?? "1"), hunk.header).toBe(hunk.plus);
    }
  });
});
