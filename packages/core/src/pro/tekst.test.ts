import { describe, expect, it } from "vitest";

import {
  bracketBalance,
  FRAME_RATES,
  glossaryCheck,
  hiddenCharacters,
  isbnCheck,
  mojibakeRepair,
  numberCheck,
  numberToSerbianWords,
  parseTimecode,
  readingTime,
  sentenceLength,
  subtitleAudit,
  subtitleRetime,
  transliterate,
  translationVolume,
  typographyCleanup,
  unwrapParagraphs,
  wordFrequency,
} from "./tekst.js";

/**
 * Every expectation here was worked by hand from the inputs before the test
 * was run, exactly as `gradnja.test.ts` does. Where a hand derivation
 * disagreed with the catalogue's own worked vector, the arithmetic wins and
 * the disagreement is called out in the comment — see the notes on
 * `hiddenCharacters`, `mojibakeRepair` and `typographyCleanup` below.
 */

// A string past the shared 500 000 code point paste ceiling every text field
// in this pack refuses at — built once, used by every "too long" case.
const TOO_LONG = "a".repeat(500001);

describe("bracketBalance", () => {
  it("reports an excess closer without eating the opener still on the stack — Tekst (a [b) c]", () => {
    // Columns, 1-indexed, code points: T1 e2 k3 s4 t5 _6 (7 a8 _9 [10 b11 )12 _13 c14 ]15
    // Stack: ( pushed (h1), [ pushed (h2, maxDepth2), ) does not match top [
    //   -> reported, stack untouched, ] then matches the [ still on top (h1),
    // leaving ( as the sole unclosed opener.
    const result = bracketBalance({ text: "Tekst (a [b) c]" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unclosed).toEqual([{ char: "(", line: 1, column: 7 }]);
    expect(result.unmatched).toEqual([{ char: ")", line: 1, column: 12, openOnTop: "[" }]);
    expect(result.maxDepth).toBe(2);
    expect(result.oddQuoteParagraphs).toEqual([]);
  });

  it("resolves U+201C as a closer off the stack when U+201E is on top — „Zdravo“, rekao je.", () => {
    // „1 Z2 d3 r4 a5 v6 o7 “8 — „ opens (pushed), “ finds „ on top of the
    // stack and closes it by the deterministic rule, so nothing is left open.
    const result = bracketBalance({ text: "„Zdravo“, rekao je." });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unclosed).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.maxDepth).toBe(1);
    expect(result.oddQuoteParagraphs).toEqual([]);
  });

  it("resolves U+201C as an opener of the English pair when nothing is on top — “hi”", () => {
    // With no „ on the stack, “ is the OTHER role the same code point plays:
    // an opener expecting ”. „Zdravo“ above and “hi” here are the same stack
    // rule read from its two branches, and neither needs a separate input —
    // the assignment's own computation paragraph says as much ("bez ijednog
    // dodatnog unosa"), which is why no "quote style" field was added despite
    // the ISPRAVKE clause proposing one: the deterministic rule it worries
    // about breaking is the one already implemented, and it already passes
    // both of the catalogue's own vectors.
    const result = bracketBalance({ text: "“hi”" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unclosed).toEqual([]);
    expect(result.unmatched).toEqual([]);
    expect(result.maxDepth).toBe(1);
  });

  it("counts straight-quote parity per paragraph and excludes an apostrophe between two letters", () => {
    // Paragraph 1: one unpaired straight double quote -> odd, reported.
    // Paragraph 2: "ne'š" has ' between two letters (n/e and š are both
    // \p{L}) so it is an apostrophe, not counted -> even (zero), not reported.
    const result = bracketBalance({ text: 'He said "hi.\n\nne\'š' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.oddQuoteParagraphs).toEqual([
      { paragraph: 1, startLine: 1, doubleQuotes: 1, singleQuotes: 0 },
    ]);
  });

  it("reaches maxDepth 0 for a text with no bracket at all — the named edge case", () => {
    const empty = bracketBalance({ text: "" });
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.maxDepth).toBe(0);

    const plain = bracketBalance({ text: "Nema zagrada ovde." });
    expect(plain.ok).toBe(true);
    if (plain.ok) expect(plain.maxDepth).toBe(0);
  });

  it("refuses a paste over the shared 500 000 code point ceiling", () => {
    expect(bracketBalance({ text: TOO_LONG })).toEqual({ ok: false, reason: "text" });
  });
});

describe("glossaryCheck", () => {
  it("counts a term that was translated inconsistently — a = 2, b = 1, status differs", () => {
    // "ugovor" occurs twice in the original; "contract" occurs once in the
    // translation because the second occurrence became "agreement" instead.
    const result = glossaryCheck({
      original: "Ovaj ugovor i onaj ugovor.",
      translation: "This contract and that agreement.",
      glossary: "ugovor|contract",
      caseSensitive: false,
      wholeWord: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { source: "ugovor", target: "contract", inOriginal: 2, inTranslation: 1, status: "differs" },
    ]);
    expect(result.invalidRows).toEqual([]);
  });

  it("requires a word boundary when asked, catching a term that never made it into the translation", () => {
    // Whole-word "rok" matches at the start of "Rok je kratak." (text start
    // is a boundary, the next code point is a space); "kratak" does not
    // contain the string "rok" at all, so b = 0 either way.
    const result = glossaryCheck({
      original: "Rok je kratak.",
      translation: "The term is short.",
      glossary: "rok|deadline",
      caseSensitive: false,
      wholeWord: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { source: "rok", target: "deadline", inOriginal: 1, inTranslation: 0, status: "missing" },
    ]);
  });

  it("produces every status the (a, b) pair can imply", () => {
    const result = glossaryCheck({
      original: "alfa alfa beta",
      translation: "alpha alpha gama",
      // match: alfa/alpha both 2. extra: beta not in original's count 0 but
      // "extra" needs a = 0 and b > 0, so use a term absent from the
      // original and present in the translation; absent: neither side has it.
      glossary: "alfa|alpha\nzeta|gama\nomega|omega",
      caseSensitive: false,
      wholeWord: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([
      { source: "alfa", target: "alpha", inOriginal: 2, inTranslation: 2, status: "match" },
      { source: "zeta", target: "gama", inOriginal: 0, inTranslation: 1, status: "extra" },
      { source: "omega", target: "omega", inOriginal: 0, inTranslation: 0, status: "absent" },
    ]);
  });

  it("skips a blank glossary line silently but reports a line with no tab and no pipe, 1-indexed", () => {
    const result = glossaryCheck({
      original: "ugovor",
      translation: "contract",
      glossary: "ugovor|contract\n\nbadrow\nrok|deadline",
      caseSensitive: false,
      wholeWord: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Line 2 is blank and skipped without a report; line 3 has neither
    // separator and is invalid; line 4 is read normally.
    expect(result.rows.map((row) => row.source)).toEqual(["ugovor", "rok"]);
    expect(result.invalidRows).toEqual([3]);
  });

  it("refuses each paste over the shared ceiling by its own name", () => {
    expect(
      glossaryCheck({
        original: TOO_LONG,
        translation: "x",
        glossary: "a|b",
        caseSensitive: false,
        wholeWord: false,
      }),
    ).toEqual({ ok: false, reason: "original" });
    expect(
      glossaryCheck({
        original: "x",
        translation: TOO_LONG,
        glossary: "a|b",
        caseSensitive: false,
        wholeWord: false,
      }),
    ).toEqual({ ok: false, reason: "translation" });
    expect(
      glossaryCheck({ original: "x", translation: "y", glossary: TOO_LONG, caseSensitive: false, wholeWord: false }),
    ).toEqual({ ok: false, reason: "glossary" });
  });

  it("refuses an empty or entirely blank glossary rather than reporting zero rows", () => {
    expect(
      glossaryCheck({ original: "x", translation: "y", glossary: "", caseSensitive: false, wholeWord: false }),
    ).toEqual({ ok: false, reason: "glossary" });
    expect(
      glossaryCheck({ original: "x", translation: "y", glossary: "\n\n", caseSensitive: false, wholeWord: false }),
    ).toEqual({ ok: false, reason: "glossary" });
  });
});

describe("hiddenCharacters", () => {
  it("finds a lone NBSP by name and position — Naslov\\u00A0i tekst", () => {
    // Columns: N1 a2 s3 l4 o5 v6 NBSP7. Re-derived length disagrees with the
    // catalogue vector: "Naslov i tekst" is N-a-s-l-o-v-SP-i-SP-t-e-k-s-t,
    // 14 code points, not the 16 the vector claims — counted twice by hand
    // and confirmed with a scan. The "same length before and after" CLAIM is
    // right; the number attached to it is not, and 14 is what is asserted.
    const text = "Naslov\u00a0i tekst";
    const found = hiddenCharacters({
      text,
      removeInvisible: false,
      normalizeSpaces: false,
      removeSoftHyphen: false,
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.findings).toEqual([
      { kind: "space", codePoint: 0x00a0, label: "U+00A0", name: "NO-BREAK SPACE", line: 1, column: 7 },
    ]);
    expect(found.mixedScriptWords).toEqual([]);
    expect(found.codePointsBefore).toBe(14);

    const cleaned = hiddenCharacters({
      text,
      removeInvisible: false,
      normalizeSpaces: true,
      removeSoftHyphen: false,
    });
    expect(cleaned.ok).toBe(true);
    if (!cleaned.ok) return;
    expect(cleaned.cleaned).toBe("Naslov i tekst");
    expect(cleaned.codePointsAfter).toBe(14);
  });

  it("normalizes every unusual space, not only NBSP, when normalizeSpaces is on — EM SPACE and IDEOGRAPHIC SPACE", () => {
    // ISPRAVKE (1), the completeness half: before the fix only U+00A0 answered
    // to the space switch, so U+2003 EM SPACE and U+3000 IDEOGRAPHIC SPACE were
    // found and counted under kind "space" but no combination of switches could
    // clean them. Both are kind "space" in HIDDEN_TABLE, exactly like NBSP.
    // "a\u2003b\u3000c" is 5 code points: a, EM SPACE, b, IDEOGRAPHIC SPACE, c.
    const text = "a\u2003b\u3000c";
    const untouched = hiddenCharacters({
      text,
      removeInvisible: false,
      normalizeSpaces: false,
      removeSoftHyphen: false,
    });
    expect(untouched.ok).toBe(true);
    if (untouched.ok) {
      expect(untouched.cleaned).toBe(text);
      expect(untouched.countByKind.space).toBe(2);
    }

    const normalized = hiddenCharacters({
      text,
      removeInvisible: false,
      normalizeSpaces: true,
      removeSoftHyphen: false,
    });
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.cleaned).toBe("a b c");
      expect(normalized.codePointsAfter).toBe(5);
    }
  });

  it("flags a word that silently mixes Cyrillic and Latin letters — Сrno", () => {
    // С is U+0421 (Cyrillic), r/n/o are Latin: two scripts in one word that
    // looks identical to the honest "Crno" at a glance.
    const result = hiddenCharacters({
      text: "Сrno",
      removeInvisible: false,
      normalizeSpaces: false,
      removeSoftHyphen: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.findings).toEqual([]);
    expect(result.mixedScriptWords).toEqual([
      { word: "Сrno", scripts: ["Cyrillic", "Latin"], line: 1, column: 1 },
    ]);
  });

  it("removes a zero-width and a control code point but leaves an unusual space alone", () => {
    // The ISPRAVKE fix: U+2003 EM SPACE is kind "space", not one of
    // control/zeroWidth/bidi, so "removeInvisible" must NOT delete it —
    // deleting it would glue two words together, a new defect rather than a
    // cleanup. U+200B ZERO WIDTH SPACE (kind zeroWidth) IS deleted.
    const result = hiddenCharacters({
      text: "a\u200bb\u2003c",
      removeInvisible: true,
      normalizeSpaces: false,
      removeSoftHyphen: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cleaned).toBe("ab\u2003c");
    expect(result.countByKind).toEqual({ control: 0, space: 1, zeroWidth: 1, softHyphen: 0, bidi: 0 });
  });

  it("answers only to its own switch for the soft hyphen, independent of removeInvisible", () => {
    const kept = hiddenCharacters({
      text: "co\u00adoperate",
      removeInvisible: true,
      normalizeSpaces: false,
      removeSoftHyphen: false,
    });
    expect(kept.ok).toBe(true);
    if (kept.ok) expect(kept.cleaned).toBe("co\u00adoperate");

    const stripped = hiddenCharacters({
      text: "co\u00adoperate",
      removeInvisible: false,
      normalizeSpaces: false,
      removeSoftHyphen: true,
    });
    expect(stripped.ok).toBe(true);
    if (stripped.ok) {
      expect(stripped.cleaned).toBe("cooperate");
      expect(stripped.countByKind.softHyphen).toBe(1);
    }
  });

  it("refuses a paste over the shared 500 000 code point ceiling", () => {
    expect(
      hiddenCharacters({ text: TOO_LONG, removeInvisible: false, normalizeSpaces: false, removeSoftHyphen: false }),
    ).toEqual({ ok: false, reason: "text" });
  });
});

describe("isbnCheck", () => {
  it("checks an ISBN-10 and converts it to ISBN-13 — 0-306-40615-2", () => {
    // Sum d_i x (11-i): 0x10+3x9+0x8+6x7+4x6+0x5+6x4+1x3+5x2+2x1
    //   = 0+27+0+42+24+0+24+3+10+2 = 132 = 12x11 -> 132 mod 11 = 0, matches.
    // ISBN-13: "978"+"030640615", GS1 sum over 978030640615 with weights 1,3:
    //   9x1+7x3+8x1+0x3+3x1+0x3+6x1+4x3+0x1+6x3+1x1+5x3
    //   = 9+21+8+0+3+0+6+12+0+18+1+15 = 93 -> check = (10-3)%10 = 7.
    const result = isbnCheck({ number: "0-306-40615-2", kind: "auto" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("isbn10");
    expect(result.digits).toBe("0306406152");
    expect(result.checkDigit).toBe("2");
    expect(result.expectedCheckDigit).toBe("2");
    expect(result.checkDigitMatches).toBe(true);
    expect(result.isbn13).toBe("9780306406157");
    expect(result.isbn10).toBeUndefined();
    expect(result.issn8).toBeUndefined();
  });

  it("reports a mismatched ISBN-13 check digit and still converts it, per the review's own correction", () => {
    // Same 12-digit body as above (93), so the expected check digit is still
    // 7; the number as typed carries 8, which is the transcription error the
    // tool exists to catch. Conversion runs anyway: isbn10Body = digits 4..12
    // = "030640615", and its own check digit is computed independently.
    // isbn10 sum: 0x10+3x9+0x8+6x7+4x6+0x5+6x4+1x3+5x2 = 130;
    //   (11 - 130%11)%11 = (11-9)%11 = 2.
    const result = isbnCheck({ number: "9780306406158", kind: "auto" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("isbn13");
    expect(result.checkDigit).toBe("8");
    expect(result.expectedCheckDigit).toBe("7");
    expect(result.checkDigitMatches).toBe(false);
    expect(result.isbn13).toBeUndefined();
    expect(result.isbn10).toBe("0306406152");
  });

  it("checks an ISSN — 0378-5955", () => {
    // Sum d_i x (9-i), i=1..7: 0x8+3x7+7x6+8x5+5x4+9x3+5x2
    //   = 0+21+42+40+20+27+10 = 160 = 14x11+6 -> 160 mod 11 = 6.
    // Expected = (11-6)%11 = 5, matches the written 5.
    const result = isbnCheck({ number: "0378-5955", kind: "auto" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("issn");
    expect(result.digits).toBe("03785955");
    expect(result.checkDigitMatches).toBe(true);
    expect(result.expectedCheckDigit).toBe("5");
  });

  it("recovers ISSN-8 from a 977-prefixed 13-digit number, per the review's own correction", () => {
    // Built to embed the very ISSN just checked above (0378595-5) as digits
    // 4..10, with issue code "00" and its own GS1 check digit.
    // First 12 digits 977037859500, weights 1,3 alternating:
    //  9x1+7x3+7x1+0x3+3x1+7x3+8x1+5x3+9x1+5x3+0x1+0x3
    //  = 9+21+7+0+3+21+8+15+9+15+0+0 = 108 -> check = (10-8)%10 = 2.
    const result = isbnCheck({ number: "9770378595002", kind: "auto" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("issn13");
    expect(result.checkDigitMatches).toBe(true);
    // digits 4..10 = "0378595", plus a freshly computed ISSN check digit —
    // the same 160/6/5 arithmetic as the standalone ISSN vector above.
    expect(result.issn8).toBe("03785955");
    expect(result.isbn13).toBeUndefined();
    expect(result.isbn10).toBeUndefined();
  });

  it("refuses a number with no digit or X at all, and one whose length fits no kind", () => {
    expect(isbnCheck({ number: "abc-def", kind: "auto" })).toEqual({ ok: false, reason: "number" });
    // 7 digits fits none of {8, 10, 13}.
    expect(isbnCheck({ number: "1234567", kind: "auto" })).toEqual({ ok: false, reason: "number" });
  });

  it("refuses an X that is not the last character, and an X on a kind that has none", () => {
    // X at index 1 of 10, not index 9 (the last).
    expect(isbnCheck({ number: "0X06406152", kind: "auto" })).toEqual({ ok: false, reason: "number" });
    // A 13-digit number ending in X forced to isbn13, which never carries one.
    expect(isbnCheck({ number: "978030640614X", kind: "isbn13" })).toEqual({ ok: false, reason: "number" });
  });

  it("refuses a forced kind whose length the number does not have", () => {
    // The 10-digit ISBN from the first vector, forced to isbn13 (needs 13).
    expect(isbnCheck({ number: "0306406152", kind: "isbn13" })).toEqual({ ok: false, reason: "kind" });
  });

  it("blames the forced kind, not the number, when the length fits NO kind at all", () => {
    // 11 digits fits none of {8, 10, 13} — detectIsbnKind alone would refuse
    // this as "number", but "kind" was forced to isbn13, so the wrong field
    // is the one the user actually got wrong: they told the tool how to read
    // the number, and 11 digits does not fit THAT reading, forced-kind or not.
    expect(isbnCheck({ number: "12345678901", kind: "isbn13" })).toEqual({ ok: false, reason: "kind" });
  });

  it("reports a wrong ISBN-10 check digit through the general formula, not the sum-is-0-mod-11 shortcut", () => {
    // 0306406153: the last digit is 3, not the correct 2. Full-sum shortcut:
    // sum d_i x (11-i) = 0x10+3x9+0x8+6x7+4x6+0x5+6x4+1x3+5x2+3x1
    //   = 0+27+0+42+24+0+24+3+10+3 = 133; 133 mod 11 = 1 (11x12=132), not 0,
    // so isbn10Check falls to the general formula over the first 9 digits:
    // sum = 0x10+3x9+0x8+6x7+4x6+0x5+6x4+1x3+5x2 = 0+27+0+42+24+0+24+3+10 = 130.
    // (11 - 130%11)%11 = (11 - 9)%11 = 2 -> expected "2", written "3", mismatch.
    const result = isbnCheck({ number: "0306406153", kind: "auto" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("isbn10");
    expect(result.checkDigit).toBe("3");
    expect(result.expectedCheckDigit).toBe("2");
    expect(result.checkDigitMatches).toBe(false);
  });

  it("prints an X for an ISSN whose computed check value is 10 — 0020000X", () => {
    // Digits 1..7 = 0,0,2,0,0,0,0. Sum d_i x (8-i), i=1..7:
    //   0x8+0x7+2x6+0x5+0x4+0x3+0x2 = 12. 12 mod 11 = 1. (11-1)%11 = 10,
    // which prints as "X" — the value neither the standalone ISSN vector nor
    // the ISBN-10 vectors above ever reach.
    const result = isbnCheck({ number: "0020000X", kind: "auto" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.kind).toBe("issn");
    expect(result.digits).toBe("0020000X");
    expect(result.checkDigit).toBe("X");
    expect(result.expectedCheckDigit).toBe("X");
    expect(result.checkDigitMatches).toBe(true);
  });
});

describe("mojibakeRepair", () => {
  it("undoes UTF-8 written, CP1252 read — Å¡ -> š, Ä‡ -> ć", () => {
    // Å = U+00C5 -> byte 0xC5 in CP1252; ¡ = U+00A1 -> byte 0xA1. Bytes C5 A1
    // as UTF-8: 0xC5 = 110 00101 (leads 5 bits 00101), 0xA1 = 10 100001
    // (continuation carries 100001) -> 00101 100001 = 0x161 = U+0161 = š.
    const first = mojibakeRepair({ text: "Å¡", writtenAs: "utf-8", readAs: "windows-1252" });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.repaired).toBe("š");
      expect(first.unmappableCount).toBe(0);
      expect(first.invalidByteCount).toBe(0);
      expect(first.resolvedWrittenAs).toBe("utf-8");
      expect(first.resolvedReadAs).toBe("windows-1252");
    }

    // Ä = U+00C4 -> 0xC4; ‡ = U+2021 -> 0x87 in CP1252 (the row where CP1252
    // differs from plain Latin-1). C4 87 -> 00100 000111 = 0x107 = U+0107 = ć.
    const second = mojibakeRepair({ text: "Ä‡", writtenAs: "utf-8", readAs: "windows-1252" });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.repaired).toBe("ć");
  });

  it("reports every character with no byte in the target encoding — corrected vector", () => {
    // The catalogue's own vector claims exactly ONE unmappable character
    // (¡, U+00A1) when reading "Å¡" as ISO-8859-2, but ISO-8859-2 has no byte
    // for EITHER U+00C5 (Å) or U+00A1 (¡) — checked against the platform's
    // own table, which is the tool's actual source of truth (it builds no
    // table of its own). Both positions are unmappable, not one.
    const result = mojibakeRepair({ text: "Å¡", writtenAs: "utf-8", readAs: "iso-8859-2" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repaired).toBeUndefined();
    expect(result.unmappableCount).toBe(2);
    expect(result.unmappable).toEqual([
      { index: 0, char: "Å" },
      { index: 1, char: "¡" },
    ]);
  });

  it("reports an invalid UTF-8 byte sequence rather than substituting U+FFFD", () => {
    // ÿ = U+00FF -> byte 0xFF in CP1252. 0xFF is not a legal UTF-8 lead byte
    // (leads run 0xC2..0xF4), so the write-side decode fails at byte 0.
    const result = mojibakeRepair({ text: "ÿ", writtenAs: "utf-8", readAs: "windows-1252" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.repaired).toBeUndefined();
    expect(result.invalidByteCount).toBe(1);
    expect(result.invalidBytes).toEqual([{ index: 0, byte: 0xff }]);
  });

  it("treats an unpaired surrogate as unmappable when the reading encoding is UTF-8", () => {
    const result = mojibakeRepair({ text: "\uD800", writtenAs: "windows-1252", readAs: "utf-8" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.unmappableCount).toBe(1);
    expect(result.unmappable).toEqual([{ index: 0, char: "\uD800" }]);
  });

  it("refuses before any arithmetic when the paste already contains U+FFFD", () => {
    expect(mojibakeRepair({ text: "a�b", writtenAs: "utf-8", readAs: "windows-1252" })).toEqual({
      ok: false,
      reason: "replacementCharacter",
    });
  });

  it("refuses a paste over the shared 500 000 code point ceiling", () => {
    expect(mojibakeRepair({ text: TOO_LONG, writtenAs: "utf-8", readAs: "windows-1252" })).toEqual({
      ok: false,
      reason: "text",
    });
  });
});

describe("numberCheck", () => {
  it("pairs two typographic renderings of the same digit string", () => {
    // "1.500,00" and "1,500.00" both reduce to digit string "150000"; "30"
    // appears unchanged on both sides.
    const result = numberCheck({
      original: "Ugovor na 1.500,00 EUR, rok 30 dana.",
      translation: "Contract for 1,500.00 EUR, term 30 days.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paired).toEqual([
      { digits: "150000", formsInOriginal: ["1.500,00"], formsInTranslation: ["1,500.00"], count: 1 },
      { digits: "30", formsInOriginal: ["30"], formsInTranslation: ["30"], count: 1 },
    ]);
    expect(result.onlyInOriginal).toEqual([]);
    expect(result.onlyInTranslation).toEqual([]);
    expect(result.differentLength).toEqual([]);
    expect(result.pairedCount).toBe(2);
  });

  it("catches a transposed digit as a genuine mismatch — 12.345 vs 12.354", () => {
    const result = numberCheck({
      original: "Cena je 12.345 dinara, popust 15%.",
      translation: "The price is 12.354 dinars, discount 15%.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paired).toEqual([{ digits: "15", formsInOriginal: ["15"], formsInTranslation: ["15"], count: 1 }]);
    expect(result.onlyInOriginal).toEqual([
      { digits: "12345", formsInOriginal: ["12.345"], formsInTranslation: [], count: 1 },
    ]);
    expect(result.onlyInTranslation).toEqual([
      { digits: "12354", formsInOriginal: [], formsInTranslation: ["12.354"], count: 1 },
    ]);
    expect(result.onlyInOriginalCount).toBe(1);
    expect(result.onlyInTranslationCount).toBe(1);
  });

  it("flags a dropped decimal comma the digit-only key alone would miss — 1,5 vs 15", () => {
    // Both reduce to digit string "15" and pair, but "1,5" is 3 code points
    // and "15" is 2 — a length no common set catches, which is exactly the
    // ISPRAVKE correction this table exists to surface.
    const result = numberCheck({
      original: "Iznos je 1,5 kilograma.",
      translation: "Iznos je 15 kilograma.",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paired).toEqual([
      { digits: "15", formsInOriginal: ["1,5"], formsInTranslation: ["15"], count: 1 },
    ]);
    expect(result.differentLength).toEqual(result.paired);
  });

  it("reports no numbers at all for text that has none", () => {
    const result = numberCheck({ original: "Nema brojeva ovde.", translation: "Ni ovde nema." });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.paired).toEqual([]);
    expect(result.pairedCount).toBe(0);
    expect(result.onlyInOriginalCount).toBe(0);
    expect(result.onlyInTranslationCount).toBe(0);
  });

  it("refuses each paste over the shared ceiling by its own name", () => {
    expect(numberCheck({ original: TOO_LONG, translation: "x" })).toEqual({ ok: false, reason: "original" });
    expect(numberCheck({ original: "x", translation: TOO_LONG })).toEqual({ ok: false, reason: "translation" });
  });
});

describe("numberToSerbianWords", () => {
  it("uses the chosen form for exactly 1000 and skips the zero units group — 1234", () => {
    // Groups from the right: [234, 1]. Highest group is 1 (thousands) = 1,
    // with nothing above it -> the chosen thousandForm wins outright.
    // 234 -> hundreds "dvesta", tens "trideset", units "četiri".
    const result = numberToSerbianWords({
      value: "1234",
      script: "latin",
      thousandForm: "hiljadu",
      decimals: "none",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("hiljadu dvesta trideset četiri");
    expect(result.decimalsTruncated).toBe(false);
  });

  it("agrees the thousands group in the feminine and paucal — 21000", () => {
    // Group 21: 21 mod 100 = 21 (not 11..14); 21 mod 10 = 1 -> singular
    // "hiljada" with the feminine unit word "jedna", preceded by "dvadeset".
    const result = numberToSerbianWords({
      value: "21000",
      script: "latin",
      thousandForm: "hiljadu",
      decimals: "none",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("dvadeset jedna hiljada");
  });

  it("reads the second plural from mod 100, not the paucal a naive last-digit rule would pick — 112000", () => {
    // Group 112: 112 mod 100 = 12, which IS in 11..14 -> second plural
    // "hiljada", never the paucal "hiljade" that group mod 10 = 2 would
    // suggest on its own. 112 itself reads as "sto" + the 10..19 table entry
    // for 12, "dvanaest" (11..19 is read as a whole, no separate tens word).
    const result = numberToSerbianWords({
      value: "112000",
      script: "latin",
      thousandForm: "hiljadu",
      decimals: "none",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("sto dvanaest hiljada");
  });

  it("agrees two different scales in the same number, each in its own gender — 2500000", () => {
    // Group 2 (millions, masculine): mod 10 = 2 -> paucal "miliona" with "dva".
    // Group 500 (thousands, feminine): mod 100 = 0, mod 10 = 0 -> second
    // plural "hiljada". The zero units group is skipped entirely.
    const result = numberToSerbianWords({
      value: "2500000",
      script: "latin",
      thousandForm: "hiljadu",
      decimals: "none",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("dva miliona petsto hiljada");
  });

  it("speaks the sign only once and renders the fraction all three ways — -1234,56", () => {
    // Whole part identical to the first vector: "hiljadu dvesta trideset
    // četiri". Fraction "56" has 2 digits -> denominator 10^2 = 100.
    const fraction = numberToSerbianWords({
      value: "-1234,56",
      script: "latin",
      thousandForm: "hiljadu",
      decimals: "fraction",
    });
    expect(fraction.ok).toBe(true);
    if (fraction.ok) expect(fraction.text).toBe("minus hiljadu dvesta trideset četiri i 56/100");

    const words = numberToSerbianWords({
      value: "-1234,56",
      script: "latin",
      thousandForm: "hiljadu",
      decimals: "words",
    });
    expect(words.ok).toBe(true);
    if (words.ok) expect(words.text).toBe("minus hiljadu dvesta trideset četiri zapeta pet šest");

    const none = numberToSerbianWords({
      value: "-1234,56",
      script: "latin",
      thousandForm: "hiljadu",
      decimals: "none",
    });
    expect(none.ok).toBe(true);
    if (none.ok) {
      expect(none.text).toBe("minus hiljadu dvesta trideset četiri");
      expect(none.decimalsTruncated).toBe(true);
    }
  });

  it("keeps a trailing zero in the fraction's numerator rather than reading it as a shorter one", () => {
    // ISPRAVKE (3): "1234,50" must give "i 50/100", never "i 5/10" — the
    // value is read as the STRING "50" (length 2 -> denominator 100), never
    // parsed through a double that would drop the trailing zero.
    const result = numberToSerbianWords({
      value: "1234,50",
      script: "latin",
      thousandForm: "hiljadu",
      decimals: "fraction",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("hiljadu dvesta trideset četiri i 50/100");
  });

  it("writes an all-zero fraction as typed rather than omitting it — 5,00", () => {
    const result = numberToSerbianWords({
      value: "5,00",
      script: "latin",
      thousandForm: "hiljadu",
      decimals: "fraction",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("pet i 00/100");
  });

  it("reaches bilijarda (10^15), the scale the 18-digit whole-part ceiling exists to make reachable", () => {
    const result = numberToSerbianWords({
      value: "1000000000000000",
      script: "latin",
      thousandForm: "hiljadu",
      decimals: "none",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("jedna bilijarda");
  });

  it("converts the finished Latin words to Cyrillic through the digraph, not letter by letter", () => {
    // "hiljada" contains the digraph "lj" (х-и-љ-а-д-а), which the shared
    // transliteration table folds into a single љ — proof the words feed
    // through the SAME digraph-aware conversion used by "Preslovljavanje",
    // rather than a naive per-letter map that would produce "лј".
    const result = numberToSerbianWords({
      value: "1000",
      script: "cyrillic",
      thousandForm: "jednaHiljada",
      decimals: "none",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("једна хиљада");
  });

  it("refuses a period, a space or a non-breaking space in the whole part rather than guessing which separator it is", () => {
    // ISPRAVKE (1): only a comma is ever read as the decimal separator.
    expect(numberToSerbianWords({ value: "1234.56", script: "latin", thousandForm: "hiljadu", decimals: "fraction" }))
      .toEqual({ ok: false, reason: "value" });
    expect(numberToSerbianWords({ value: "1 234", script: "latin", thousandForm: "hiljadu", decimals: "none" }))
      .toEqual({ ok: false, reason: "value" });
  });

  it("refuses text that is not a signed decimal at all, and one whose whole part overflows 18 digits", () => {
    expect(numberToSerbianWords({ value: "abc", script: "latin", thousandForm: "hiljadu", decimals: "none" })).toEqual(
      { ok: false, reason: "value" },
    );
    expect(
      numberToSerbianWords({ value: "1".repeat(19), script: "latin", thousandForm: "hiljadu", decimals: "none" }),
    ).toEqual({ ok: false, reason: "value" });
  });
});

describe("readingTime", () => {
  it("times a single 300-word paragraph at 150 words per minute — 300/150x60 = 120.0 s", () => {
    const result = readingTime({ text: Array.from({ length: 300 }, () => "reč").join(" "), pace: 150, pause: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.words).toBe(300);
    expect(result.totalSeconds).toBeCloseTo(120, 9);
    expect(result.totalClock).toBe("02:00");
    expect(result.paragraphs).toEqual([
      {
        index: 1,
        words: 300,
        seconds: 120,
        displaySeconds: 120,
        clock: "02:00",
        entrySeconds: 0,
        entryDisplaySeconds: 0,
        entryClock: "00:00",
      },
    ]);
  });

  it("carries the pause between paragraphs into the entry time of the next one", () => {
    // Paragraph 1: 5 words (billing convention counts the punctuation-glued
    // token) -> 5/60x60 = 5.0 s. Paragraph 2: 2 words -> 2/60x60 = 2.0 s.
    // Total = 5.0 + 2.0 + 2x(2-1) = 9 s. Entry of paragraph 2 = floor(0+5+2) = 7 s.
    const result = readingTime({
      text: "Dobro veče. Ovo je vest.\n\nSledi izveštaj.",
      pace: 60,
      pause: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.words).toBe(7);
    expect(result.totalDisplaySeconds).toBe(9);
    expect(result.totalClock).toBe("00:09");
    expect(result.paragraphs[0]?.words).toBe(5);
    expect(result.paragraphs[0]?.entryClock).toBe("00:00");
    expect(result.paragraphs[1]?.words).toBe(2);
    expect(result.paragraphs[1]?.entryDisplaySeconds).toBe(7);
    expect(result.paragraphs[1]?.entryClock).toBe("00:07");
  });

  it("lets the sum of rounded durations diverge from the rounded total by about a second", () => {
    // Three one-word paragraphs at pace 120: each is 1/120x60 = 0.5 s exactly.
    // Math.round(0.5) rounds half up to 1, three times -> displayed sum 3.
    // The exact total is 1.5 s, which rounds to 2 -> the two numbers differ.
    const result = readingTime({ text: "reč\n\nreč\n\nreč", pace: 120, pause: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalDisplaySeconds).toBe(2);
    expect(result.displayedSumSeconds).toBe(3);
  });

  it("refuses text over the ceiling, a non-positive or too-fast pace, and a pause outside 0..600", () => {
    expect(readingTime({ text: TOO_LONG, pace: 150, pause: 0 })).toEqual({ ok: false, reason: "text" });
    expect(readingTime({ text: "x", pace: 0, pause: 0 })).toEqual({ ok: false, reason: "pace" });
    expect(readingTime({ text: "x", pace: 1001, pause: 0 })).toEqual({ ok: false, reason: "pace" });
    expect(readingTime({ text: "x", pace: 150, pause: -1 })).toEqual({ ok: false, reason: "pause" });
    expect(readingTime({ text: "x", pace: 150, pause: 601 })).toEqual({ ok: false, reason: "pause" });
  });
});

describe("sentenceLength", () => {
  it("ends a sentence at a period followed by a capital, and at the end of the text — two short sentences", () => {
    const result = sentenceLength({ text: "Ovo je kratka rečenica. Ovo je druga.", threshold: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(2);
    expect(result.sentences.map((s) => s.words)).toEqual([4, 3]);
    expect(result.totalWords).toBe(7);
    expect(result.averageWords).toBeCloseTo(3.5, 6);
    expect(result.longestIndex).toBe(1);
    expect(result.longestWords).toBe(4);
    expect(result.sentences.every((s) => !s.overThreshold)).toBe(true);
  });

  it("does not end a sentence between two digits, but does after an abbreviation's period", () => {
    // The period after "12" is followed by a space then "mesecu", lowercase
    // -> not a sentence end at all (fails the "next visible is not lowercase"
    // test before the digit rule is even reached). The period after
    // "mesecu" is followed by "Tako", uppercase -> ends the sentence.
    const result = sentenceLength({ text: "Došao je u 12. mesecu. Tako je rekao dr Petrović.", threshold: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(2);
    expect(result.sentences.map((s) => s.words)).toEqual([5, 5]);
    expect(result.averageWords).toBeCloseTo(5, 6);
    expect(result.sentences.every((s) => s.overThreshold)).toBe(true);
  });

  it("does not end a sentence after a lone initial letter — J. Jovanović", () => {
    // Before the first "." is "J" (a letter) and before THAT is the start of
    // the text (not a letter) -> the lone-initial rule keeps it from ending
    // the sentence, so the whole line reads as one.
    const result = sentenceLength({ text: "J. Jovanović došao je.", threshold: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(1);
    expect(result.totalWords).toBe(4);
    expect(result.sentences[0]?.overThreshold).toBe(false);
  });

  it("reports 0 sentences and no average for empty text, rather than an average of 0", () => {
    const result = sentenceLength({ text: "", threshold: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(0);
    expect(result.averageWords).toBeUndefined();
    expect(result.longestIndex).toBeUndefined();
    expect(result.longestWords).toBeUndefined();
  });

  it("refuses text over the ceiling and a threshold outside the integer range 1..200", () => {
    expect(sentenceLength({ text: TOO_LONG, threshold: 10 })).toEqual({ ok: false, reason: "text" });
    expect(sentenceLength({ text: "x.", threshold: 0 })).toEqual({ ok: false, reason: "threshold" });
    expect(sentenceLength({ text: "x.", threshold: 201 })).toEqual({ ok: false, reason: "threshold" });
    expect(sentenceLength({ text: "x.", threshold: 3.5 })).toEqual({ ok: false, reason: "threshold" });
  });
});

describe("transliterate", () => {
  it("converts Cyrillic to Latin unambiguously, choosing the digraph's case from context — Његош", () => {
    // Њ is capital and the next letter е is lowercase -> "Nj", not "NJ".
    const mixed = transliterate({ text: "Његош", direction: "cyrillicToLatin" });
    expect(mixed.ok).toBe(true);
    if (mixed.ok) {
      expect(mixed.text).toBe("Njegoš");
      expect(mixed.ambiguities).toEqual([]);
    }

    // Њ is capital and the next letter Е is ALSO capital -> "NJ".
    const allCaps = transliterate({ text: "ЊЕГОШ", direction: "cyrillicToLatin" });
    expect(allCaps.ok).toBe(true);
    if (allCaps.ok) expect(allCaps.text).toBe("NJEGOŠ");
  });

  it("keeps a digraph's case full when it ends a run of capitals with nothing after it — КОЊ", () => {
    // ISPRAVKE (1): a digraph at the end of a word has no NEXT letter to
    // consult, so the rule falls back to the PRECEDING letter — О is
    // capital, so Њ becomes "NJ" and the word reads "KONJ", never "KONj".
    const result = transliterate({ text: "КОЊ", direction: "cyrillicToLatin" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe("KONJ");
  });

  it("reports the digraph ambiguity going the other way rather than guessing — nadživeti", () => {
    // n(0) a(1) d(2) ž(3) ... — "dž" starts at code point index 2, column 3.
    const result = transliterate({ text: "nadživeti", direction: "latinToCyrillic" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("наџивети");
    expect(result.ambiguities).toEqual([
      { sequence: "dž", index: 2, line: 1, column: 3, word: "nadživeti", reason: "digraph" },
    ]);
  });

  it("never turns dj into đ, only reports the place — nadjačati", () => {
    const result = transliterate({ text: "nadjačati", direction: "latinToCyrillic" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("надјачати");
    expect(result.ambiguities).toEqual([
      { sequence: "dj", index: 2, line: 1, column: 3, word: "nadjačati", reason: "dj" },
    ]);
  });

  it("maps the three precomposed digraph letters straight through, never as an ambiguity", () => {
    // ISPRAVKE (3): U+01C6 (ǆ) is one code point with one reading.
    const result = transliterate({ text: "ǆuka", direction: "latinToCyrillic" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("џука");
    expect(result.ambiguities).toEqual([]);
  });

  it("refuses a paste over the shared 500 000 code point ceiling", () => {
    expect(transliterate({ text: TOO_LONG, direction: "cyrillicToLatin" })).toEqual({ ok: false, reason: "text" });
  });
});

describe("parseTimecode", () => {
  it("reads an explicit sign and a full HH:MM:SS,mmm reading", () => {
    // ((0x60+0)x60+2)x1000+500 = 2500.
    expect(parseTimecode({ text: "+00:00:02,500" })).toEqual({ ok: true, ms: 2500 });
  });

  it("reads a bare, possibly negative, count of milliseconds", () => {
    expect(parseTimecode({ text: "-500" })).toEqual({ ok: true, ms: -500 });
    expect(parseTimecode({ text: "2500" })).toEqual({ ok: true, ms: 2500 });
  });

  it("refuses text that is neither a timecode nor a bare millisecond count", () => {
    expect(parseTimecode({ text: "abc" })).toEqual({ ok: false, reason: "text" });
  });

  // A digit run long enough to leave the range of a double is not an exotic
  // input — it is what a truncated or mis-encoded paste looks like. The digit
  // groups used to be unbounded, and `Number("9".repeat(400))` is `Infinity`,
  // which was returned as an offset in milliseconds on an `ok: true` result.
  it("refuses a digit run too long to be a number, rather than answering Infinity", () => {
    expect(Number("9".repeat(400))).toBe(Number.POSITIVE_INFINITY); // the premise
    expect(parseTimecode({ text: "9".repeat(400) })).toEqual({ ok: false, reason: "text" });
    expect(parseTimecode({ text: `${"9".repeat(400)}:00:00,000` })).toEqual({
      ok: false,
      reason: "text",
    });
    // The bound is far above any real reading, so nothing legitimate moved:
    // 999999 hours is 114 years, and a bare offset may still carry 12 digits.
    expect(parseTimecode({ text: "999999:00:00,000" })).toEqual({ ok: true, ms: 3599996400000 });
    expect(parseTimecode({ text: "999999999999" })).toEqual({ ok: true, ms: 999999999999 });
  });
});

describe("subtitleAudit", () => {
  const SUBTITLE =
    "1\n00:00:01,000 --> 00:00:03,000\nZdravo svete!\n\n" +
    "2\n00:00:05,000 --> 00:00:06,000\nOvo je mnogo dugačak red teksta za jedan sekund.\n";
  const LIMITS = {
    maxLineChars: 42,
    maxLines: 2,
    minDurationMs: 700,
    maxDurationMs: 6000,
    maxCharsPerSecond: 17,
    minGapMs: 40,
  } as const;

  it("measures both blocks against the user's own limits and returns the ratio, never a verdict", () => {
    const result = subtitleAudit({ subtitle: SUBTITLE, ...LIMITS, countTags: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [first, second] = result.blocks;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    // Block 1: duration 3000-1000 = 2000 ms; 13 code points / (2000/1000 s) = 6.5.
    expect(first.durationMs).toBe(2000);
    expect(first.characters).toBe(13);
    expect(first.charactersPerSecond).toBeCloseTo(6.5, 6);
    expect(first.longestLine).toBe(13);
    expect(first.lines).toBe(1);
    // Gap to block 2: 5000 - 3000 = 2000 ms.
    expect(first.gapMs).toBe(2000);
    expect(first.longestLineRatio).toBeCloseTo(13 / 42, 9);
    expect(first.linesRatio).toBeCloseTo(0.5, 9);
    expect(first.charactersPerSecondRatio).toBeCloseTo(6.5 / 17, 9);
    // Minimum duration ratio is inverted: limit / measurement = 700/2000.
    expect(first.minDurationRatio).toBeCloseTo(0.35, 9);
    expect(first.maxDurationRatio).toBeCloseTo(2000 / 6000, 9);
    expect(first.gapRatio).toBeCloseTo(2000 / 40, 9);

    // Block 2: duration 6000-5000 = 1000 ms; 48 code points / 1 s = 48.00.
    expect(second.durationMs).toBe(1000);
    expect(second.characters).toBe(48);
    expect(second.charactersPerSecond).toBeCloseTo(48, 6);
    expect(second.longestLine).toBe(48);
    expect(second.charactersPerSecondRatio).toBeCloseTo(48 / 17, 9);
    // Last block: no next cue, so the gap is genuinely absent, not zero.
    expect(second.gapMs).toBeUndefined();
    expect(second.gapRatio).toBeUndefined();
  });

  it("names a non-positive duration, an out-of-order start and a negative gap without ranking them", () => {
    const subtitle =
      "1\n00:00:01,000 --> 00:00:02,000\nA\n\n" +
      "2\n00:00:05,000 --> 00:00:04,000\nB\n\n" +
      "3\n00:00:03,000 --> 00:00:06,000\nC\n";
    const result = subtitleAudit({ subtitle, countTags: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Block 2 ends before it starts (4000 < 5000) -> duration <= 0.
    expect(result.nonPositiveDuration).toEqual([2]);
    // Block 3 starts (3000) before block 2's start (5000).
    expect(result.outOfOrder).toEqual([3]);
    // Block 2's gap to block 3: 3000 - 4000 = -1000, a genuine overlap.
    expect(result.overlapping).toEqual([2]);
  });

  it("counts a tag as characters only when asked to, per its own switch", () => {
    const subtitle = "1\n00:00:01,000 --> 00:00:02,000\n<i>Hi</i>\n";
    const stripped = subtitleAudit({ subtitle, countTags: false });
    expect(stripped.ok).toBe(true);
    if (stripped.ok) expect(stripped.blocks[0]?.characters).toBe(2);

    const kept = subtitleAudit({ subtitle, countTags: true });
    expect(kept.ok).toBe(true);
    if (kept.ok) expect(kept.blocks[0]?.characters).toBe(9);
  });

  it("refuses a malformed subtitle and each limit outside its own declared range", () => {
    expect(subtitleAudit({ subtitle: "not a subtitle at all", countTags: false })).toEqual({
      ok: false,
      reason: "subtitle",
    });
    expect(subtitleAudit({ subtitle: SUBTITLE, maxLineChars: 0, countTags: false })).toEqual({
      ok: false,
      reason: "maxLineChars",
    });
    expect(subtitleAudit({ subtitle: SUBTITLE, maxLines: 11, countTags: false })).toEqual({
      ok: false,
      reason: "maxLines",
    });
    expect(subtitleAudit({ subtitle: SUBTITLE, minDurationMs: -1, countTags: false })).toEqual({
      ok: false,
      reason: "minDurationMs",
    });
    expect(subtitleAudit({ subtitle: SUBTITLE, maxDurationMs: 600001, countTags: false })).toEqual({
      ok: false,
      reason: "maxDurationMs",
    });
    expect(subtitleAudit({ subtitle: SUBTITLE, maxCharsPerSecond: 101, countTags: false })).toEqual({
      ok: false,
      reason: "maxCharsPerSecond",
    });
    expect(subtitleAudit({ subtitle: SUBTITLE, minGapMs: 10001, countTags: false })).toEqual({
      ok: false,
      reason: "minGapMs",
    });
  });

  // The same unbounded digit run as `parseTimecode`, reached through the shared
  // `TIME_PATTERN`: a cue whose hour field is four hundred nines used to parse,
  // giving `endMs` and `durationMs` of `Infinity` on an `ok: true` audit. The
  // bound lives in the pattern, so the cue no longer matches and the file reads
  // as having no cues at all — which is the truthful answer about that text.
  it("does not read a cue whose hour field is too long to be a number", () => {
    const bad = `1\n00:00:00,000 --> ${"9".repeat(400)}:00:00,000\nZdravo\n`;
    const result = subtitleAudit({ subtitle: bad, countTags: false });
    expect(result.ok && result.blocks.some((b) => !Number.isFinite(b.durationMs))).toBe(false);
    // A six-digit hour is still a cue: the bound is far above any real subtitle.
    const long = `1\n00:00:00,000 --> 999999:00:00,000\nZdravo\n`;
    const ok = subtitleAudit({ subtitle: long, countTags: false });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.blocks[0]?.durationMs).toBe(3599996400000);
  });
});

describe("subtitleRetime", () => {
  it("shifts every cue by a fixed offset — +2500 ms", () => {
    const result = subtitleRetime({
      subtitle: "1\n00:00:10,000 --> 00:00:12,000\nText\n",
      offsetMs: 2500,
      renumber: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("00:00:12,500 --> 00:00:14,500");
    expect(result.blocks).toBe(1);
    expect(result.clamped).toBe(0);
    expect(result.endBeforeStart).toEqual([]);
  });

  it("converts 25 fps to 24000/1001 fps in exact integer arithmetic — 01:00:00,000 -> 01:02:33,750", () => {
    // scale = reduce(25x1001, 1x24000) = reduce(25025, 24000); gcd = 25, so
    // scale = 1001/960. ms=3 600 000: whole = floor(3600000/960) = 3750
    // exactly (remainder 0) -> 3750 x 1001 = 3 753 750 ms, no rounding at all.
    // 3 753 750 ms = 1 h 2 min 33.750 s.
    const result = subtitleRetime({
      subtitle: "1\n01:00:00,000 --> 01:00:01,000\nText\n",
      offsetMs: 0,
      fromFps: FRAME_RATES["25"],
      toFps: FRAME_RATES["24000/1001"],
      renumber: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("01:02:33,750");
  });

  it("parses WebVTT with an omitted hour and preserves the header untouched", () => {
    const result = subtitleRetime({
      subtitle: "WEBVTT\n\n00:00.500 --> 00:02.000\nHi\n",
      offsetMs: 0,
      renumber: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("WEBVTT");
    expect(result.text).toContain("00:00:00.500 --> 00:00:02.000");
    expect(result.text).toContain("Hi");
    expect(result.blocks).toBe(1);
  });

  it("renumbers a leading index line only when asked", () => {
    const subtitle = "5\n00:00:01,000 --> 00:00:02,000\nA\n\n7\n00:00:03,000 --> 00:00:04,000\nB\n";
    const renumbered = subtitleRetime({ subtitle, offsetMs: 0, renumber: true });
    expect(renumbered.ok).toBe(true);
    if (renumbered.ok) {
      expect(renumbered.text.startsWith("1\n")).toBe(true);
      expect(renumbered.text).toContain("\n2\n");
    }

    const untouched = subtitleRetime({ subtitle, offsetMs: 0, renumber: false });
    expect(untouched.ok).toBe(true);
    if (untouched.ok) expect(untouched.text.startsWith("5\n")).toBe(true);
  });

  it("clamps a shift that would go before the start of the file and counts each clamp", () => {
    const result = subtitleRetime({
      subtitle: "1\n00:00:01,000 --> 00:00:02,000\nText\n",
      offsetMs: -5000,
      renumber: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("00:00:00,000 --> 00:00:00,000");
    expect(result.clamped).toBe(2);
  });

  it("refuses a malformed subtitle, an offset outside +/-86400000 ms, and one frame rate given without the other", () => {
    expect(subtitleRetime({ subtitle: "not a subtitle", offsetMs: 0, renumber: false })).toEqual({
      ok: false,
      reason: "subtitle",
    });
    expect(
      subtitleRetime({ subtitle: "1\n00:00:01,000 --> 00:00:02,000\nA\n", offsetMs: 86400001, renumber: false }),
    ).toEqual({ ok: false, reason: "offsetMs" });
    expect(
      subtitleRetime({
        subtitle: "1\n00:00:01,000 --> 00:00:02,000\nA\n",
        offsetMs: 0,
        fromFps: FRAME_RATES["25"],
        renumber: false,
      }),
    ).toEqual({ ok: false, reason: "toFps" });
  });
});

describe("translationVolume", () => {
  it("counts a short paste and shows no amount at all when no price was given", () => {
    // P-r-e-v-o-d- -j-e- -g-o-t-o-v-. = 16 code points, 2 of them spaces.
    const result = translationVolume({ text: "Prevod je gotov.", charsPerPage: 1800, unit: "page" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.charactersWithSpaces).toBe(16);
    expect(result.charactersWithoutSpaces).toBe(14);
    expect(result.wordsBySpaces).toBe(3);
    expect(result.wordsByLetters).toBe(3);
    // 16 / 1800 = 0.00888...
    expect(result.pagesExact).toBeCloseTo(16 / 1800, 9);
    expect(result.pagesRoundedUp).toBe(1);
    expect(result.amountExact).toBeUndefined();
    expect(result.amountRoundedUp).toBeUndefined();
  });

  it("prices from the UNROUNDED page count, never from the page count already rounded for display", () => {
    // 4321 / 1800 = 2.400555... repeating; ceil = 3.
    // 1000 x 2.400555... = 2400.555...; 1000 x 3 = 3000 exactly. Multiplying
    // the DISPLAYED 2.4006 instead would give 2400.60, the wrong money this
    // rule exists to prevent.
    const result = translationVolume({ text: "a".repeat(4321), charsPerPage: 1800, price: 1000, unit: "page" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.charactersWithSpaces).toBe(4321);
    expect(result.pagesExact).toBeCloseTo(4321 / 1800, 9);
    expect(result.pagesRoundedUp).toBe(3);
    expect(result.amountExact).toBeCloseTo(2400.5556, 3);
    expect(result.amountRoundedUp).toBe(3000);
  });

  it("excludes the line break from the billing count, differing from the raw length by exactly the number of breaks", () => {
    // ISPRAVKE: MS Word's own character count does not count a paragraph
    // mark. "A\nB\nC" is 5 code points including 2 line breaks; the billing
    // count (charactersWithSpaces) is 5 - 2 = 3.
    const result = translationVolume({ text: "A\nB\nC", charsPerPage: 1800, unit: "character" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.charactersWithLineBreaks).toBe(5);
    expect(result.charactersWithSpaces).toBe(3);
  });

  it("gives all zeros and no amount for empty text", () => {
    const result = translationVolume({ text: "", charsPerPage: 1800, unit: "word" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.charactersWithSpaces).toBe(0);
    expect(result.wordsBySpaces).toBe(0);
    expect(result.pagesExact).toBe(0);
    expect(result.pagesRoundedUp).toBe(0);
    expect(result.amountExact).toBeUndefined();
  });

  it("refuses text over the ceiling, charsPerPage outside 100..20000, and price outside 0..100000000", () => {
    expect(translationVolume({ text: TOO_LONG, charsPerPage: 1800, unit: "page" })).toEqual({
      ok: false,
      reason: "text",
    });
    expect(translationVolume({ text: "x", charsPerPage: 99, unit: "page" })).toEqual({
      ok: false,
      reason: "charsPerPage",
    });
    expect(translationVolume({ text: "x", charsPerPage: 20001, unit: "page" })).toEqual({
      ok: false,
      reason: "charsPerPage",
    });
    expect(translationVolume({ text: "x", charsPerPage: 1800, price: -1, unit: "page" })).toEqual({
      ok: false,
      reason: "price",
    });
  });
});

describe("typographyCleanup", () => {
  it("straightens quotes, collapses an ellipsis, fixes two kinds of dash and tidies spaces, all rules together", () => {
    // Trace: quotes -> ellipses -> dashes -> spaces -> nbsp, in that fixed order.
    // Quotes: the straight quote after a space opens ("„"); the one after the
    //   letter "o" closes. The catalogue's own vector prints the closer as a
    //   straight `"`, which is inconsistent with style "„…" (its own closer
    //   is U+201C, "“") and with its own paragraph one line above, so the
    //   corrected closer "“" is what is asserted here.
    // Ellipses: the run of three dots becomes one … (count 1).
    // Dashes: "10-15" (digit-digit, no spaces) and " - " (space-dash-space)
    //   each become – (count 2, both length-1 runs). "COVID-19"-style runs
    //   are not present in this vector.
    // Spaces: the double space after … collapses to one, and the space
    //   before the final "." is deleted (count 2).
    const result = typographyCleanup({
      text: 'Rekao je "zdravo"...  Sutra 10-15 sati - dolazim .',
      style: "curly",
      quotes: true,
      ellipses: true,
      dashes: true,
      spaces: true,
      nbsp: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("Rekao je „zdravo“… Sutra 10–15 sati – dolazim.");
    expect(result.quotes).toBe(2);
    expect(result.ellipses).toBe(1);
    expect(result.dashes).toBe(2);
    expect(result.spaces).toBe(2);
    expect(result.nbsp).toBe(0);
    expect(result.total).toBe(7);
  });

  it("changes a dash run only by its length and its neighbours, with every other rule off", () => {
    const doubled = typographyCleanup({
      text: "Naslov -- podnaslov",
      style: "curly",
      quotes: false,
      ellipses: false,
      dashes: true,
      spaces: false,
      nbsp: false,
    });
    expect(doubled.ok).toBe(true);
    if (doubled.ok) {
      expect(doubled.text).toBe("Naslov – podnaslov");
      expect(doubled.dashes).toBe(1);
    }

    const digits = typographyCleanup({
      text: "1998-2004",
      style: "curly",
      quotes: false,
      ellipses: false,
      dashes: true,
      spaces: false,
      nbsp: false,
    });
    expect(digits.ok).toBe(true);
    if (digits.ok) {
      expect(digits.text).toBe("1998–2004");
      expect(digits.dashes).toBe(1);
    }

    // Left neighbour is a letter, not a digit, and there is no space either
    // side -> the single hyphen survives untouched.
    const covid = typographyCleanup({
      text: "COVID-19",
      style: "curly",
      quotes: false,
      ellipses: false,
      dashes: true,
      spaces: false,
      nbsp: false,
    });
    expect(covid.ok).toBe(true);
    if (covid.ok) {
      expect(covid.text).toBe("COVID-19");
      expect(covid.dashes).toBe(0);
    }
  });

  it("never inserts a space around a period or comma between two digits — the ISPRAVKE fix", () => {
    // Without the fix, "1.500,00" would become "1. 500, 00" and "12.5.2020."
    // would become "12. 5. 2020.". With it, a digit on either side of the
    // mark suppresses the insertion entirely.
    const result = typographyCleanup({
      text: "Cena je 1.500,00 dinara, popust 12.5.2020.",
      style: "straight",
      quotes: false,
      ellipses: false,
      dashes: false,
      spaces: true,
      nbsp: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("Cena je 1.500,00 dinara, popust 12.5.2020.");
    expect(result.spaces).toBe(0);
  });

  it("refuses a paste over the shared 500 000 code point ceiling", () => {
    expect(
      typographyCleanup({
        text: TOO_LONG,
        style: "curly",
        quotes: true,
        ellipses: true,
        dashes: true,
        spaces: true,
        nbsp: true,
      }),
    ).toEqual({ ok: false, reason: "text" });
  });
});

describe("unwrapParagraphs", () => {
  it("joins a line broken mid-sentence with a single space, and leaves a real paragraph break alone", () => {
    const result = unwrapParagraphs({
      text: "Ovo je prvi red teksta koji je\nprelomljen na dva reda.\n\nDrugi pasus.",
      joinHyphenated: true,
      respectListItems: false,
      splitOnSentenceEnd: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("Ovo je prvi red teksta koji je prelomljen na dva reda.\n\nDrugi pasus.");
    expect(result.joinedLines).toBe(1);
    expect(result.joinedWords).toBe(0);
    expect(result.paragraphs).toBe(2);
  });

  it("stitches a hyphen-broken word back together, dropping the hyphen and the break", () => {
    // "Neophodno je proveriti." = 9 + 1 + 2 + 1 + 9 + 1 = 23 code points.
    const result = unwrapParagraphs({
      text: "Neophod-\nno je proveriti.",
      joinHyphenated: true,
      respectListItems: false,
      splitOnSentenceEnd: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("Neophodno je proveriti.");
    expect([...result.text].length).toBe(23);
    expect(result.joinedWords).toBe(1);
    expect(result.joinedLines).toBe(0);
    expect(result.paragraphs).toBe(1);
  });

  it("keeps a list item on its own line rather than folding it into the line above", () => {
    const result = unwrapParagraphs({
      text: "Prvo\n- stavka jedan\n- stavka dva",
      joinHyphenated: false,
      respectListItems: true,
      splitOnSentenceEnd: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("Prvo\n- stavka jedan\n- stavka dva");
    expect(result.joinedLines).toBe(0);
  });

  it("starts a new paragraph after a finished sentence when asked to, for text whose blank lines were lost", () => {
    const result = unwrapParagraphs({
      text: "Ovo je prva rečenica.\nOvo je nastavak u sledećem redu",
      joinHyphenated: false,
      respectListItems: false,
      splitOnSentenceEnd: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe("Ovo je prva rečenica.\n\nOvo je nastavak u sledećem redu");
    expect(result.paragraphs).toBe(2);
    expect(result.joinedLines).toBe(0);
  });

  it("refuses a paste over the shared 500 000 code point ceiling", () => {
    expect(
      unwrapParagraphs({ text: TOO_LONG, joinHyphenated: false, respectListItems: false, splitOnSentenceEnd: false }),
    ).toEqual({ ok: false, reason: "text" });
  });
});

describe("wordFrequency", () => {
  it("counts single words case-insensitively and breaks ties with the Serbian collator", () => {
    // Tokens: Kuća, je, bela, Kuća, je, velika = 6, 4 distinct case-folded
    // keys. je and Kuća each occur twice (2/6x100 = 33.33...%); bela and
    // velika once each (1/6x100 = 16.66...%). Ties sort by the collator:
    // "je" < "Kuća" (j < k) and "bela" < "velika" (b < v).
    const result = wordFrequency({
      text: "Kuća je bela. Kuća je velika.",
      n: 1,
      minCount: 1,
      minWordLength: 1,
      caseSensitive: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalWords).toBe(6);
    expect(result.totalNgrams).toBe(6);
    expect(result.distinctPhrases).toBe(4);
    expect(result.rows).toEqual([
      { phrase: "je", count: 2, share: 33.33 },
      { phrase: "Kuća", count: 2, share: 33.33 },
      { phrase: "bela", count: 1, share: 16.67 },
      { phrase: "velika", count: 1, share: 16.67 },
    ]);
  });

  it("counts 2-word phrases within a paragraph, including one that crosses a sentence but not a paragraph", () => {
    // 6 tokens -> 6-2+1 = 5 bigrams: (Kuća je) (je bela) (bela Kuća)
    // (Kuća je) (je velika). Only "kuća je" repeats (2), so it is the only
    // row shown; the denominator stays 5 regardless of the minCount filter.
    const result = wordFrequency({
      text: "Kuća je bela. Kuća je velika.",
      n: 2,
      minCount: 2,
      minWordLength: 1,
      caseSensitive: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalNgrams).toBe(5);
    expect(result.rows).toEqual([{ phrase: "Kuća je", count: 2, share: 40 }]);
  });

  it("keeps the denominator over every n-gram even when a threshold hides every row", () => {
    // ISPRAVKE: minCount and minWordLength filter the TABLE only.
    const hiddenByCount = wordFrequency({
      text: "Kuća je bela. Kuća je velika.",
      n: 1,
      minCount: 3,
      minWordLength: 1,
      caseSensitive: false,
    });
    expect(hiddenByCount.ok).toBe(true);
    if (hiddenByCount.ok) {
      expect(hiddenByCount.rows).toEqual([]);
      expect(hiddenByCount.totalNgrams).toBe(6);
    }

    // minWordLength applies only at n = 1: "bela"(4) and "kuća"(4) drop out,
    // "je"(2) drops out, "velika"(6) survives — but totalWords/totalNgrams
    // still count every token, filtered words included.
    const hiddenByLength = wordFrequency({
      text: "Kuća je bela. Kuća je velika.",
      n: 1,
      minCount: 1,
      minWordLength: 5,
      caseSensitive: false,
    });
    expect(hiddenByLength.ok).toBe(true);
    if (hiddenByLength.ok) {
      expect(hiddenByLength.rows).toEqual([{ phrase: "velika", count: 1, share: 16.67 }]);
      expect(hiddenByLength.totalWords).toBe(6);
      expect(hiddenByLength.totalNgrams).toBe(6);
    }
  });

  it("refuses text over the ceiling, and n, minCount, minWordLength outside their declared ranges", () => {
    expect(wordFrequency({ text: TOO_LONG, n: 1, minCount: 1, minWordLength: 1, caseSensitive: false })).toEqual({
      ok: false,
      reason: "text",
    });
    expect(wordFrequency({ text: "x", n: 0, minCount: 1, minWordLength: 1, caseSensitive: false })).toEqual({
      ok: false,
      reason: "n",
    });
    expect(wordFrequency({ text: "x", n: 11, minCount: 1, minWordLength: 1, caseSensitive: false })).toEqual({
      ok: false,
      reason: "n",
    });
    expect(wordFrequency({ text: "x", n: 1, minCount: 0, minWordLength: 1, caseSensitive: false })).toEqual({
      ok: false,
      reason: "minCount",
    });
    expect(wordFrequency({ text: "x", n: 1, minCount: 1001, minWordLength: 1, caseSensitive: false })).toEqual({
      ok: false,
      reason: "minCount",
    });
    expect(wordFrequency({ text: "x", n: 1, minCount: 1, minWordLength: 0, caseSensitive: false })).toEqual({
      ok: false,
      reason: "minWordLength",
    });
    expect(wordFrequency({ text: "x", n: 1, minCount: 1, minWordLength: 51, caseSensitive: false })).toEqual({
      ok: false,
      reason: "minWordLength",
    });
  });
});
