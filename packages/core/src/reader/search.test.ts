import { describe, expect, it } from "vitest";

import {
  makeSearchable,
  readerQueryTerms,
  searchReaderIndex,
  type ReaderIndexedArticle,
  type ReaderSearchablePack,
} from "./search.js";

/**
 * The Reader's search over one fixture pack of four articles (ADR-100).
 *
 * The fixture is spelled out here rather than read from a folder: what this
 * suite asserts is an exact hit list, and a fixture on disk would make "the
 * index found the right articles" a statement about the filesystem. The pack, in
 * its own reading order, and with the word each case reaches for in capitals:
 *
 *   1. uvod.md        "VODA i elektroliti"  - the title carries it
 *   2. suma.md        "Šuma i senka"        - a title that needs the fold
 *   3. opekotine.md   "Opekotine"           - the body carries MINUTA, not the title
 *   4. krvarenje.md   "Krvarenje"           - the body carries VODA in a sentence
 */

const ARTICLES: readonly ReaderIndexedArticle[] = [
  {
    path: "uvod.md",
    title: "Voda i elektroliti",
    text: "Voda i elektroliti\n\nTelo bez vode ne izdrži dugo.",
  },
  {
    path: "suma.md",
    title: "Šuma i senka",
    text: "Šuma i senka\n\nŠuma daje hlad i sklonište.",
  },
  {
    path: "opekotine.md",
    title: "Opekotine",
    text: "Opekotine\n\nHladi opekotinu vodom dvadeset minuta.",
  },
  {
    path: "krvarenje.md",
    title: "Krvarenje",
    text: "Krvarenje\n\nPritisni ranu i drži pritisak. Voda pomaže.",
  },
];

const PACK: ReaderSearchablePack = {
  packId: "prva-pomoc",
  articles: ARTICLES.map(makeSearchable),
};

/** Where a word sits in a source string - an oracle rather than a count by hand. */
function at(text: string, word: string): [number, number] {
  const start = text.indexOf(word);
  return [start, start + word.length];
}

describe("readerQueryTerms", () => {
  it("folds the terms, drops one-letter ones and keeps the order typed", () => {
    expect(readerQueryTerms("Voda OPEKOTINE voda")).toEqual(["voda", "opekotine"]);
    // One letter matches nearly every article in a pack, so it is not a term.
    expect(readerQueryTerms("i u")).toEqual([]);
    expect(readerQueryTerms("   ")).toEqual([]);
  });

  it("folds the Serbian diacritics away, so a keyboard without them still finds the word", () => {
    expect(readerQueryTerms("Đorđe")).toEqual(["djordje"]);
    expect(readerQueryTerms("šuma")).toEqual(["suma"]);
    expect(readerQueryTerms("suma")).toEqual(["suma"]);
  });
});

describe("searchReaderIndex", () => {
  it("puts the title match first and the body match after it", () => {
    const outcome = searchReaderIndex("voda", [PACK], 10);
    expect(outcome.hits.map((hit) => hit.path)).toEqual(["uvod.md", "krvarenje.md"]);
    expect(outcome.hits.map((hit) => hit.titleMatch)).toEqual([true, false]);
    expect(outcome.truncated).toBe(false);
  });

  it("highlights the matched word in the title and in the body excerpt", () => {
    const [titled, body] = searchReaderIndex("voda", [PACK], 10).hits;
    expect(titled?.title.text).toBe("Voda i elektroliti");
    expect(titled?.title.ranges).toEqual([[0, 4]]);
    expect(titled?.snippet).toBeNull();

    // The excerpt carries ranges into the ORIGINAL text, which is the only shape
    // a renderer can paint without a mapping of its own.
    const excerpt = body?.snippet;
    const text = "Krvarenje\n\nPritisni ranu i drži pritisak. Voda pomaže.";
    expect(excerpt?.text).toBe(text);
    expect(excerpt?.ranges).toEqual([at(text, "Voda")]);
  });

  it("finds a word whose title is written with Serbian letters, whichever way it is typed", () => {
    for (const query of ["šuma", "suma", "SUMA"]) {
      const outcome = searchReaderIndex(query, [PACK], 10);
      expect(outcome.hits.map((hit) => hit.path), query).toEqual(["suma.md"]);
      expect(outcome.hits[0]?.titleMatch, query).toBe(true);
    }
  });

  it("matches a body word the title does not carry", () => {
    const [hit] = searchReaderIndex("minuta", [PACK], 10).hits;
    expect(hit?.path).toBe("opekotine.md");
    expect(hit?.titleMatch).toBe(false);
    // The body's own line breaks are kept: the excerpt is a slice of the article,
    // not a paragraph the search re-typeset.
    expect(hit?.snippet?.text).toBe("Opekotine\n\nHladi opekotinu vodom dvadeset minuta.");
  });

  it("requires every term in the title OR every term in the text", () => {
    // "hlad" is in one article's text and "senka" in its title: both are present,
    // so it hits - but not as a title match, which is the distinction the first
    // group is made of.
    const [hit] = searchReaderIndex("hlad senka", [PACK], 10).hits;
    expect(hit?.path).toBe("suma.md");
    expect(hit?.titleMatch).toBe(false);
    // No single article carries both, so neither group has an entry.
    expect(searchReaderIndex("voda minuta", [PACK], 10).hits).toEqual([]);
  });

  it("matches a word inside a longer one, which is a decision rather than an accident", () => {
    // "vodom" carries "voda", so a body sentence phrased in another case still
    // answers the query: Serbian inflects, and recall is what a reader wants.
    expect(searchReaderIndex("vodom", [PACK], 10).hits.map((hit) => hit.path)).toEqual([
      "opekotine.md",
    ]);
  });

  it("says when the cap cut the answer short rather than pretending it listed everything", () => {
    const outcome = searchReaderIndex("voda", [PACK], 1);
    expect(outcome.hits.map((hit) => hit.path)).toEqual(["uvod.md"]);
    expect(outcome.truncated).toBe(true);
  });

  it("answers nothing for a query of no usable terms, and nothing for a word no article carries", () => {
    expect(searchReaderIndex("i", [PACK], 10)).toEqual({ hits: [], truncated: false });
    expect(searchReaderIndex("helikopter", [PACK], 10)).toEqual({ hits: [], truncated: false });
  });

  it("walks the packs in the order it was given, so a cross-pack search keeps each pack's own order", () => {
    const second: ReaderSearchablePack = {
      packId: "zakoni",
      articles: [
        makeSearchable({ path: "ustav.md", title: "Ustav", text: "Ustav\n\nVoda je javno dobro." }),
      ],
    };
    expect(searchReaderIndex("voda", [PACK, second], 10).hits.map((hit) => hit.packId)).toEqual([
      "prva-pomoc",
      "prva-pomoc",
      "zakoni",
    ]);
  });
});
