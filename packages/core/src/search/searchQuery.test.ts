import { describe, expect, it } from "vitest";
import {
  MAX_SEARCH_TERMS,
  MAX_TERM_LENGTH,
  parseSearchQuery,
  SEARCH_KINDS,
  SEARCH_KIND_PREFIXES,
  toFtsMatchExpression,
} from "./searchQuery.js";

describe("parseSearchQuery — kind prefixes", () => {
  it("recognizes a short prefix", () => {
    const parsed = parseSearchQuery("z: kupovina");
    expect(parsed.kinds).toEqual(["task"]);
    expect(parsed.terms).toEqual(["kupovina"]);
  });

  it("recognizes a plural prefix", () => {
    const parsed = parseSearchQuery("zadaci: kupovina");
    expect(parsed.kinds).toEqual(["task"]);
    expect(parsed.terms).toEqual(["kupovina"]);
  });

  it("recognizes a prefix spelled with a diacritic once folded", () => {
    const parsed = parseSearchQuery("beleška: nešto");
    expect(parsed.kinds).toEqual(["note"]);
    expect(parsed.terms).toEqual(["nesto"]);
  });

  it("leaves an unknown prefix as ordinary text (the colon just separates two terms)", () => {
    const parsed = parseSearchQuery("xyz:abc");
    expect(parsed.kinds).toEqual([]);
    expect(parsed.terms).toEqual(["xyz", "abc"]);
  });

  it("dedupes repeated kind filters and orders them per SEARCH_KINDS", () => {
    const parsed = parseSearchQuery("i: ispit p: predmet i: ponovo");
    expect(parsed.kinds).toEqual(["subject", "exam"]);
  });

  it("every SEARCH_KIND_PREFIXES value is one of SEARCH_KINDS", () => {
    for (const kind of Object.values(SEARCH_KIND_PREFIXES)) {
      expect(SEARCH_KINDS).toContain(kind);
    }
  });
});

describe("parseSearchQuery — command mode", () => {
  it("sets commandsOnly and strips only the leading '>' character", () => {
    const parsed = parseSearchQuery(">novi zadatak");
    expect(parsed.commandsOnly).toBe(true);
    expect(parsed.terms).toEqual(["novi", "zadatak"]);
  });

  it("strips leading whitespace before checking for '>'", () => {
    const parsed = parseSearchQuery("   > pokreni");
    expect(parsed.commandsOnly).toBe(true);
    expect(parsed.terms).toEqual(["pokreni"]);
  });

  it("is false without a leading '>'", () => {
    expect(parseSearchQuery("obican upit").commandsOnly).toBe(false);
  });
});

describe("parseSearchQuery — prefixLast", () => {
  it("is false when the raw query ends in whitespace", () => {
    expect(parseSearchQuery("zadatak ").prefixLast).toBe(false);
  });

  it("is true when the raw query does not end in whitespace", () => {
    expect(parseSearchQuery("zadatak").prefixLast).toBe(true);
  });

  it("is true for an empty query (no terms to treat as a finished word)", () => {
    expect(parseSearchQuery("").prefixLast).toBe(true);
  });
});

describe("parseSearchQuery — tokenizing", () => {
  it("splits terms on punctuation the same way unicode61 would", () => {
    const parsed = parseSearchQuery("hitno!!! sutra??? e-mail");
    expect(parsed.terms).toEqual(["hitno", "sutra", "e", "mail"]);
  });

  it("caps the term count at MAX_SEARCH_TERMS, keeping the first-typed terms", () => {
    const words = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const parsed = parseSearchQuery(words.join(" "));
    expect(parsed.terms).toHaveLength(MAX_SEARCH_TERMS);
    expect(parsed.terms).toEqual(words.slice(0, MAX_SEARCH_TERMS));
  });

  it("caps each term's length at MAX_TERM_LENGTH", () => {
    const longWord = "x".repeat(100);
    const parsed = parseSearchQuery(longWord);
    expect(parsed.terms).toEqual([longWord.slice(0, MAX_TERM_LENGTH)]);
    expect(parsed.terms[0]).toHaveLength(MAX_TERM_LENGTH);
  });

  it("dedupes terms, keeping the first occurrence and its position", () => {
    const parsed = parseSearchQuery("ispit ispit predmet ispit");
    expect(parsed.terms).toEqual(["ispit", "predmet"]);
  });

  it("builds text by joining terms with a single space", () => {
    const parsed = parseSearchQuery("prvi   drugi");
    expect(parsed.text).toBe("prvi drugi");
  });
});

describe("toFtsMatchExpression", () => {
  it("quotes every term and prefix-stars only the last one by default", () => {
    expect(toFtsMatchExpression(["res", "zad"])).toBe('"res" "zad"*');
  });

  it("omits the trailing star when prefixLast is false", () => {
    expect(toFtsMatchExpression(["res", "zad"], { prefixLast: false })).toBe('"res" "zad"');
  });

  it("returns null when there is no usable term", () => {
    expect(toFtsMatchExpression([])).toBeNull();
    expect(toFtsMatchExpression([""])).toBeNull();
  });

  it("strips quotes out of a term defensively", () => {
    expect(toFtsMatchExpression(['a"b'])).toBe('"ab"*');
  });

  it("does not let an unquotable malformed term leak FTS syntax like AND/NOT/NEAR/*", () => {
    expect(toFtsMatchExpression(["AND"])).toBe('"AND"*');
    expect(toFtsMatchExpression(["*"])).toBe('"*"*');
  });
});
