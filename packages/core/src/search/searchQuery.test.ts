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

  it("gives every SEARCH_KINDS member at least one prefix", () => {
    // The OTHER direction, and the one nothing enforced until 2026-09-22. The
    // renderer's `KIND_QUERY_PREFIX` (searchShared.tsx) picks the shortest alias
    // per kind and CASTS the result to `Record<SearchKind, string>`; a comment
    // beside that cast says „core's own invariant" guarantees every key is
    // populated, and no test in the repository ever said so. A kind that lost
    // its alias would splice the literal text `undefined:` into the query,
    // which parses as an ordinary search TERM — so a chip click would quietly
    // search for the word „undefined" and return nothing.
    const aliased = new Set(Object.values(SEARCH_KIND_PREFIXES));
    for (const kind of SEARCH_KINDS) {
      expect(aliased).toContain(kind);
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

describe("parseSearchQuery — tag tokens", () => {
  it("reads a '#' token as a tag filter, folded, and keeps it out of the terms", () => {
    const parsed = parseSearchQuery("#posao hitno");
    expect(parsed.tags).toEqual(["posao"]);
    expect(parsed.terms).toEqual(["hitno"]);
  });

  it("folds a tag the same way it folds text (case, diacritics, Cyrillic)", () => {
    expect(parseSearchQuery("#Đorđe").tags).toEqual(["djordje"]);
    expect(parseSearchQuery("#Ђорђе").tags).toEqual(["djordje"]);
  });

  it("ANDs several '#' tokens, deduped, in the order typed", () => {
    const parsed = parseSearchQuery("#posao #kuca #posao");
    expect(parsed.tags).toEqual(["posao", "kuca"]);
  });

  it("drops a bare '#'", () => {
    const parsed = parseSearchQuery("#");
    expect(parsed.tags).toEqual([]);
    expect(parsed.terms).toEqual([]);
  });

  it("does not count tag tokens toward MAX_SEARCH_TERMS", () => {
    const words = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const parsed = parseSearchQuery(`#oznaka ${words.join(" ")}`);
    expect(parsed.tags).toEqual(["oznaka"]);
    expect(parsed.terms).toEqual(words);
    expect(parsed.terms).toHaveLength(MAX_SEARCH_TERMS);
  });

  it("is empty for a query with no '#' token", () => {
    expect(parseSearchQuery("obican upit").tags).toEqual([]);
  });

  it("parses uniformly in command mode (commands simply ignore the field)", () => {
    const parsed = parseSearchQuery(">#posao");
    expect(parsed.commandsOnly).toBe(true);
    expect(parsed.tags).toEqual(["posao"]);
  });
});

describe("parseSearchQuery — due filters", () => {
  it("reads the Serbian presets", () => {
    expect(parseSearchQuery("rok:danas").due).toEqual({ kind: "preset", preset: "today" });
    expect(parseSearchQuery("rok:sutra").due).toEqual({ kind: "preset", preset: "tomorrow" });
    expect(parseSearchQuery("rok:nedelja").due).toEqual({ kind: "preset", preset: "week" });
  });

  it("reads the English presets, under either prefix", () => {
    expect(parseSearchQuery("due:today").due).toEqual({ kind: "preset", preset: "today" });
    expect(parseSearchQuery("rok:tomorrow").due).toEqual({ kind: "preset", preset: "tomorrow" });
    expect(parseSearchQuery("due:week").due).toEqual({ kind: "preset", preset: "week" });
  });

  it("keeps the token out of the terms when it resolves", () => {
    const parsed = parseSearchQuery("rok:danas kupovina");
    expect(parsed.terms).toEqual(["kupovina"]);
  });

  it("reads a bare real date", () => {
    expect(parseSearchQuery("due:2026-08-15").due).toEqual({ kind: "date", date: "2026-08-15" });
    expect(parseSearchQuery("rok:2024-02-29").due).toEqual({ kind: "date", date: "2024-02-29" });
  });

  it("leaves an UNREAL date as plain search text rather than guessing", () => {
    const parsed = parseSearchQuery("rok:2026-02-30");
    expect(parsed.due).toBeNull();
    expect(parsed.terms).toEqual(["rok", "2026", "02", "30"]);
  });

  it("leaves an impossible month as plain search text", () => {
    expect(parseSearchQuery("rok:2026-13-01").due).toBeNull();
    expect(parseSearchQuery("rok:2026-02-29").due).toBeNull();
  });

  it("leaves an unknown value as plain search text", () => {
    const parsed = parseSearchQuery("rok:mesec");
    expect(parsed.due).toBeNull();
    expect(parsed.terms).toEqual(["rok", "mesec"]);
  });

  it("leaves an empty value as plain search text", () => {
    const parsed = parseSearchQuery("rok:");
    expect(parsed.due).toBeNull();
    expect(parsed.terms).toEqual(["rok"]);
  });

  it("lets the LAST date filter win", () => {
    expect(parseSearchQuery("rok:danas rok:sutra").due).toEqual({
      kind: "preset",
      preset: "tomorrow",
    });
    expect(parseSearchQuery("rok:sutra due:2026-08-15").due).toEqual({
      kind: "date",
      date: "2026-08-15",
    });
  });

  it("is null without a date filter", () => {
    expect(parseSearchQuery("obican upit").due).toBeNull();
  });

  it("combines with a kind prefix and ordinary terms", () => {
    const parsed = parseSearchQuery("z: rok:sutra #posao kupovina");
    expect(parsed.kinds).toEqual(["task"]);
    expect(parsed.due).toEqual({ kind: "preset", preset: "tomorrow" });
    expect(parsed.tags).toEqual(["posao"]);
    expect(parsed.terms).toEqual(["kupovina"]);
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
