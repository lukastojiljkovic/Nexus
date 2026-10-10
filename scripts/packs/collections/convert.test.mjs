// The converter's own tests, on responses saved from the Wikidata Query Service.
//
// TWO KINDS OF EXPECTED VALUE, and the difference matters. Where the whole
// response is a fixture, the expected items are the RESEARCH'S OWN extract for
// that collection (`research/wikidata/extract/library-collections.json`, whose
// measurement is `out/extract-stats.json`) — an oracle built by other code on
// another day, mapped from its `kind`/`wikidataId` names into the layout's
// `type`/`wikidata`. Everywhere else the expectation is a hand calculation on
// the fixture's own rows, written out in the comment above it.
//
// The fixtures are cut from responses fetched from WDQS on 2026-10-09 and are
// CC0-1.0 like everything the service returns. The rows a cut fixture leaves out
// are left out for size and nothing else, and the indices it keeps are named in
// the test that uses it, so a reader can put the rest back.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ATTRIBUTION,
  COLLECTIONS,
  LAYOUT,
  buildPayload,
  collectionOf,
  countRows,
  itemsOfResponse,
  layoutProblems,
  metaFor,
  sourcesDocument,
  versionOf,
} from "./build.mjs";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** One saved WDQS response. */
function fixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

/** One collection spec by id, exactly as the pack lists it. */
function specOf(id) {
  const spec = COLLECTIONS.find((collection) => collection.id === id);
  expect(spec, `COLLECTIONS has no "${id}"`).toBeDefined();
  return spec;
}

/**
 * One hand-written row in the shape WDQS returns, for the rules the real
 * responses never exercise: no saved response holds two rows for one item (the
 * query groups by item and language), and none holds a label, a year or a credit
 * that breaks the layout's bounds.
 */
function row(qid, fields) {
  const binding = {};
  if (qid !== null) binding.item = { type: "uri", value: `http://www.wikidata.org/entity/${qid}` };
  for (const [name, value] of Object.entries(fields)) {
    binding[name] = { type: "literal", value };
  }
  return binding;
}

/** A response holding exactly these rows. */
function response(bindings) {
  return { head: { vars: ["item", "en", "sr", "year", "creators"] }, results: { bindings } };
}

describe("the converter, on the research's own saved responses", () => {
  it("carries the 25 collections the research recommends, and marks the four it calls thin", () => {
    expect(COLLECTIONS.map((collection) => collection.id)).toEqual([
      "booker-prize",
      "international-booker-prize",
      "pulitzer-prize-fiction",
      "hugo-award-best-novel",
      "nebula-award-best-novel",
      "prix-goncourt",
      "womens-prize-fiction",
      "german-book-prize",
      "harvard-classics",
      "nin-prize-winners-books",
      "works-of-ivo-andric",
      "isidora-sekulic-books",
      "kresnik-books",
      "academy-award-best-picture",
      "palme-dor",
      "golden-lion",
      "golden-bear",
      "studio-ghibli-films",
      "films-by-emir-kusturica",
      "yugoslav-black-wave-films",
      "serbian-films",
      "big-golden-arena-best-film",
      "emmy-outstanding-drama-series",
      "emmy-outstanding-comedy-series",
      "golden-globe-drama-series",
    ]);
    expect(COLLECTIONS.filter((collection) => collection.small === true).map((collection) => collection.id)).toEqual([
      "womens-prize-fiction",
      "isidora-sekulic-books",
      "kresnik-books",
      "big-golden-arena-best-film",
    ]);
    for (const collection of COLLECTIONS) {
      expect(["book", "film", "series"]).toContain(collection.kind);
      // Both halves are non-empty and trimmed, and the Serbian half is the app's
      // Latin script: the research wrote it in Cyrillic, and it is carried here
      // transliterated letter for letter (see `docs/packs/collections.md`).
      expect(collection.title.sr.trim()).toBe(collection.title.sr);
      expect(collection.title.en.trim()).toBe(collection.title.en);
      expect(collection.title.sr.length).toBeGreaterThan(0);
      expect(collection.title.en.length).toBeGreaterThan(0);
      expect(collection.title.sr).not.toMatch(/[\u0400-\u04FF]/);
    }
    expect(COLLECTIONS.find((collection) => collection.id === "nin-prize-winners-books").title.en).toBe(
      "Novels by NIN Prize winners",
    );
  });

  it("reproduces the research's extract for every saved big-golden-arena response", () => {
    // Oracle: `extract/library-collections.json`'s `big-golden-arena-best-film`,
    // 5 items, mapped from {kind, wikidataId} to {type, wikidata}. The research
    // built it with its own builder from the same 5-row response.
    expect(itemsOfResponse(fixture("wdqs-big-golden-arena-best-film.json"), "film")).toEqual([
      {
        type: "film",
        title: { sr: "Трофеј", en: "Trophy" },
        year: 1979,
        creators: ["Karolj Vicek"],
        wikidata: "Q12760244",
      },
      {
        type: "film",
        title: { en: "Pismo ćaći" },
        year: 2012,
        creators: ["Damir Čučić"],
        wikidata: "Q67175000",
      },
      {
        type: "film",
        title: { en: "Kratki izlet" },
        year: 2017,
        creators: ["Igor Bezinovic"],
        wikidata: "Q67202798",
      },
      {
        type: "film",
        title: { sr: "Дневник Диане Будисављевић", en: "The Diary of Diana B" },
        year: 2019,
        creators: ["Dana Budisavljevic"],
        wikidata: "Q67202845",
      },
      {
        type: "film",
        title: { sr: "Тереза 37", en: "Tereza37" },
        year: 2020,
        creators: ["Danilo Šerbedžija"],
        wikidata: "Q100980095",
      },
    ]);
  });

  it("reproduces the research's extract for every saved womens-prize-fiction response", () => {
    // Oracle: the same file's `womens-prize-fiction`, 8 items over 8 rows.
    expect(itemsOfResponse(fixture("wdqs-womens-prize-fiction.json"), "book")).toEqual([
      { type: "book", title: { en: "The House Gun" }, year: 1997, creators: ["Nadine Gordimer"], wikidata: "Q1472202" },
      {
        type: "book",
        title: { sr: "Пола жутог сунца", en: "Half of a Yellow Sun" },
        year: 2006,
        creators: ["Chimamanda Ngozi Adichie"],
        wikidata: "Q3235393",
      },
      {
        type: "book",
        title: { sr: "Ахилов пев", en: "The Song of Achilles" },
        year: 2011,
        creators: ["Madeline Miller"],
        wikidata: "Q21189971",
      },
      {
        type: "book",
        title: { en: "The Glorious Heresies" },
        year: 2015,
        creators: ["Lisa McInerney"],
        wikidata: "Q95189997",
      },
      {
        type: "book",
        title: { sr: "Пиранези (роман)", en: "Piranesi" },
        year: 2020,
        creators: ["Susanna Clarke"],
        wikidata: "Q99434216",
      },
      {
        type: "book",
        title: { en: "The Book of Form and Emptiness" },
        year: 2021,
        creators: ["Ruth Ozeki"],
        wikidata: "Q113468597",
      },
      {
        type: "book",
        title: { en: "Demon Copperhead" },
        year: 2022,
        creators: ["Barbara Kingsolver"],
        wikidata: "Q115526836",
      },
      {
        type: "book",
        title: { en: "The Persians" },
        year: 2025,
        creators: ["Sanam Mahloudji"],
        wikidata: "Q132638069",
      },
    ]);
  });

  it("keeps a year Wikidata does not state last, and sorts a year's works by title", () => {
    // Hand calculation over the six rows cut from `harvard-classics` (indices
    // 0, 4, 5, 6, 11, 13 of the saved response): five rows carry P577 = 1909 and
    // one carries none, so the yearless row sorts last, and the five are ordered
    // by their English label ("Vol. 1" < "Vol. 10" < "Vol. 11" < "Vol. 16" <
    // "Vol. 18" under the collator, digits and all). Row 11's creators
    // GROUP_CONCAT is the empty string, so that item carries no `creators`; row
    // 13's six names are sorted here, which is not the order WDQS returned them.
    expect(itemsOfResponse(fixture("wdqs-harvard-classics-cut.json"), "book")).toEqual([
      {
        type: "book",
        title: { en: "The Harvard Classics, Vol. 1" },
        year: 1909,
        creators: ["Benjamin Franklin", "John Woolman", "William Penn"],
        wikidata: "Q136031498",
      },
      {
        type: "book",
        title: { en: "The Harvard Classics, Vol. 10. The Wealth of Nations" },
        year: 1909,
        creators: ["Adam Smith"],
        wikidata: "Q136048287",
      },
      {
        type: "book",
        title: { en: "The Harvard Classics, Vol. 11. The Origin of Species" },
        year: 1909,
        creators: ["Charles Darwin"],
        wikidata: "Q136052183",
      },
      {
        type: "book",
        title: { en: "The Harvard Classics, Vol. 16. Stories from The Thousand and One Nights" },
        year: 1909,
        wikidata: "Q136084471",
      },
      {
        type: "book",
        title: { en: "The Harvard Classics, Vol. 18. Modern English Drama" },
        year: 1909,
        creators: [
          "John Dryden",
          "Lord Byron",
          "Oliver Goldsmith",
          "Percy Bysshe Shelley",
          "Richard Brinsley Sheridan",
          "Robert Browning",
        ],
        wikidata: "Q136085974",
      },
      {
        type: "book",
        title: { en: "English Essays from Sir Philip Sidney to Macaulay" },
        wikidata: "Q21127574",
      },
    ]);
  });

  it("keeps a Serbian-only work, and breaks a year's tie by the Serbian title first", () => {
    // Hand calculation over the seven rows cut from `works-of-ivo-andric`
    // (indices 0, 42, 46, 48, 49, 55, 62): two rows carry an `sr` label and no
    // `en` one, two carry year 1945 (Q13408045 "Gospođica" before Q1247865
    // "Na Drini ćuprija"), and the two without a year come last, by title.
    expect(itemsOfResponse(fixture("wdqs-works-of-ivo-andric-cut.json"), "book")).toEqual([
      {
        type: "book",
        title: { sr: "Most na Žepi", en: "Most na Žepi" },
        year: 1925,
        creators: ["Ivo Andrić"],
        wikidata: "Q25468693",
      },
      {
        type: "book",
        title: { sr: "Gospođica", en: "The Woman from Sarajevo" },
        year: 1945,
        creators: ["Ivo Andrić"],
        wikidata: "Q13408045",
      },
      {
        type: "book",
        title: { sr: "Na Drini ćuprija", en: "The Bridge on the Drina" },
        year: 1945,
        creators: ["Ivo Andrić"],
        wikidata: "Q1247865",
      },
      {
        type: "book",
        title: { sr: "Letovanje na jugu" },
        year: 1959,
        creators: ["Ivo Andrić"],
        wikidata: "Q57610191",
      },
      {
        type: "book",
        title: { sr: "Anikina vremena", en: "Legends of Anika" },
        year: 2012,
        creators: ["Ivo Andrić"],
        wikidata: "Q61133860",
      },
      {
        type: "book",
        title: { sr: "Bajron u Sintri" },
        creators: ["Ivo Andrić"],
        wikidata: "Q124001582",
      },
      {
        type: "book",
        title: { sr: "Mara milosnica" },
        creators: ["Ivo Andrić"],
        wikidata: "Q61119599",
      },
    ]);
  });
});

describe("the converter's fallback rules", () => {
  it("drops a work with neither an English nor a Serbian label, and keeps one with either", () => {
    expect(
      itemsOfResponse(
        response([
          row("Q1", { en: "English only" }),
          row("Q2", { sr: "Само српски" }),
          row("Q3", { creators: "Ivo Andrić" }),
          row("Q4", {}),
        ]),
        "book",
      ),
    ).toEqual([
      { type: "book", title: { en: "English only" }, wikidata: "Q1" },
      { type: "book", title: { sr: "Само српски" }, wikidata: "Q2" },
    ]);
  });

  it("drops a language whose label is over the layout's bound, and the work when both are", () => {
    const long = "L".repeat(301);
    expect(
      itemsOfResponse(
        response([row("Q1", { en: long, sr: "Кратко" }), row("Q2", { en: long, sr: long })]),
        "book",
      ),
    ).toEqual([{ type: "book", title: { sr: "Кратко" }, wikidata: "Q1" }]);
  });

  it("trims a label rather than shipping a value the reader refuses", () => {
    // The reader's `text()` refuses a value that is not already trimmed, and it
    // refuses the WHOLE file for one such value, so the trim happens here.
    expect(itemsOfResponse(response([row("Q1", { en: "  Padded  " })]), "book")).toEqual([
      { type: "book", title: { en: "Padded" }, wikidata: "Q1" },
    ]);
    expect(itemsOfResponse(response([row("Q1", { en: "   " })]), "book")).toEqual([]);
  });

  it("omits a year the layout cannot hold, rather than rounding it", () => {
    // `isLibraryYear` is a whole 1..9999; a date before the common era is
    // negative in WDQS and a typo can be anything. Neither becomes a number here.
    expect(
      itemsOfResponse(
        response([
          row("Q1", { en: "Negative", year: "-500" }),
          row("Q2", { en: "Zero", year: "0" }),
          row("Q3", { en: "Too large", year: "10000" }),
          row("Q4", { en: "Not a year", year: "1900-01-01" }),
          row("Q5", { en: "Fine", year: "2026" }),
        ]),
        "book",
      ),
    ).toEqual([
      { type: "book", title: { en: "Fine" }, year: 2026, wikidata: "Q5" },
      // The four without a year are last, ordered by title: "Negative" <
      // "Not a year" < "Too large" < "Zero".
      { type: "book", title: { en: "Negative" }, wikidata: "Q1" },
      { type: "book", title: { en: "Not a year" }, wikidata: "Q4" },
      { type: "book", title: { en: "Too large" }, wikidata: "Q3" },
      { type: "book", title: { en: "Zero" }, wikidata: "Q2" },
    ]);
  });

  it("drops a credit the layout cannot hold, de-duplicates the rest and sorts them", () => {
    // `validateLibraryCreators` refuses the whole list for one name over 120
    // characters, so the name is dropped here and the list survives.
    expect(
      itemsOfResponse(response([row("Q1", { en: "One", creators: `Žika; Ana; Ana; ${"x".repeat(121)}` })]), "book"),
    ).toEqual([{ type: "book", title: { en: "One" }, creators: ["Ana", "Žika"], wikidata: "Q1" }]);
  });

  it("caps a credit list at the layout's twenty, in a stable order", () => {
    const names = Array.from({ length: 25 }, (_, index) => `Name ${String(index).padStart(2, "0")}`);
    const items = itemsOfResponse(response([row("Q1", { en: "One", creators: names.join("; ") })]), "book");
    expect(items[0].creators).toEqual(names.slice(0, 20));
  });

  it("ignores a row that is not a Wikidata entity, and a response with no rows", () => {
    expect(itemsOfResponse(response([row(null, { en: "No entity" })]), "book")).toEqual([]);
    expect(
      itemsOfResponse(
        response([
          { item: { type: "uri", value: "https://example.org/Q1" }, en: { type: "literal", value: "Elsewhere" } },
        ]),
        "book",
      ),
    ).toEqual([]);
    expect(itemsOfResponse({ head: { vars: [] }, results: {} }, "book")).toEqual([]);
    expect(itemsOfResponse(undefined, "book")).toEqual([]);
  });
});

describe("the converter's merge by Wikidata id", () => {
  it("folds two rows for one work into one item, filling what the first lacked", () => {
    // No saved response holds two rows for one item, because the query groups by
    // item and language; the rule exists for the refresh that adds a label, and
    // for a query that grows a UNION. Hand-written: the second row's `sr` label
    // fills the first's, the EARLIER year wins, and the two credit lists unite
    // and sort.
    expect(
      itemsOfResponse(
        response([
          row("Q1", { en: "One", year: "1954", creators: "B; A" }),
          row("Q1", { sr: "Један", year: "1899", creators: "C; B" }),
        ]),
        "book",
      ),
    ).toEqual([
      { type: "book", title: { en: "One", sr: "Један" }, year: 1899, creators: ["A", "B", "C"], wikidata: "Q1" },
    ]);
  });

  it("counts the rows it could not use, so a shrinking collection is visible in the build log", () => {
    const counts = countRows(response([row("Q1", { en: "One" }), row("Q2", {}), row(null, { en: "Two" })]), "book");
    expect(counts).toEqual({ rows: 3, kept: 1, dropped: 2 });
  });
});

describe("the layout the Library module reads", () => {
  /**
   * A payload built from every fixture, with a cut fixture standing in for the
   * collection it was cut from and a one-row placeholder for the twenty-one
   * collections no fixture covers — the guard below is about the LAYOUT, and a
   * build supplies a response for every collection in the list.
   */
  function payloadFromFixtures() {
    const responses = new Map();
    responses.set("big-golden-arena-best-film", fixture("wdqs-big-golden-arena-best-film.json"));
    responses.set("womens-prize-fiction", fixture("wdqs-womens-prize-fiction.json"));
    responses.set("harvard-classics", fixture("wdqs-harvard-classics-cut.json"));
    responses.set("works-of-ivo-andric", fixture("wdqs-works-of-ivo-andric-cut.json"));
    for (const spec of COLLECTIONS) {
      if (!responses.has(spec.id)) responses.set(spec.id, response([row("Q1", { en: "Placeholder" })]));
    }
    return buildPayload(responses);
  }

  it("writes version 1, both languages of copy, and the courtesy attribution as the description", () => {
    const payload = payloadFromFixtures();
    expect(payload.layout).toBe(LAYOUT);
    expect(payload.collections).toHaveLength(25);
    const andric = payload.collections.find((collection) => collection.id === "works-of-ivo-andric");
    expect(andric).toEqual({
      id: "works-of-ivo-andric",
      title: { sr: "Dela Ive Andrića", en: "Works by Ivo Andrić" },
      description: { sr: ATTRIBUTION.sr, en: ATTRIBUTION.en },
      items: itemsOfResponse(fixture("wdqs-works-of-ivo-andric-cut.json"), "book"),
    });
    // A collection that is not thin carries no `small` key at all: the layout's
    // spelling is `small?: true`, and the reader refuses a value that says otherwise.
    expect(Object.hasOwn(andric, "small")).toBe(false);
    const small = collectionOf(specOf("kresnik-books"), { results: { bindings: [row("Q1", { en: "One" })] } });
    expect(small.small).toBe(true);
  });

  it("accepts what a build writes, and refuses a payload the reader would refuse", () => {
    expect(layoutProblems(payloadFromFixtures())).toEqual([]);

    const payload = payloadFromFixtures();
    const items = payload.collections[0].items;
    expect(items.length).toBeGreaterThan(0);
    // An item with no title language at all is the one shape the reader refuses
    // WHOLE-FILE, which would leave the pack offering none of its lists.
    payload.collections[0].items = [...items, { type: "book", title: {}, wikidata: "Q1" }];
    const problems = layoutProblems(payload);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"title" must carry at least one of "sr"/"en"');
  });

  it("refuses an over-long description, an item the layout does not define, and a repeated id", () => {
    const long = payloadFromFixtures();
    long.collections[0].description.en = "D".repeat(501);
    expect(layoutProblems(long)[0]).toContain('"description.en" must be a trimmed, non-empty string of at most 500');

    const extra = payloadFromFixtures();
    extra.collections[0].items[0] = { ...extra.collections[0].items[0], kind: "book" };
    expect(layoutProblems(extra)[0]).toContain("an item's keys must be");

    const duplicated = payloadFromFixtures();
    duplicated.collections[1].id = duplicated.collections[0].id;
    expect(layoutProblems(duplicated)[0]).toContain('"id" is used twice');
  });
});

describe("the pack's metadata and its sources record", () => {
  it("dates the pack by the day its data was fetched, in a version grammar that has no leading zeros", () => {
    expect(versionOf([{ fetched: "2026-01-05" }, { fetched: "2025-12-31" }])).toBe("2026.1.5");
    expect(versionOf([{ fetched: "2026-10-10" }])).toBe("2026.10.10");
    // The grammar `parseVersion` accepts: digits, no leading zeros, dots only.
    expect(versionOf([{ fetched: "2026-01-05" }])).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  });

  it("describes the pack with the counts the build measured, in both languages", () => {
    const meta = metaFor({ collections: 25, entries: 1917, unique: 1836, version: "2026.10.10" });
    expect(Object.keys(meta)).toEqual([
      "format",
      "id",
      "version",
      "kind",
      "title",
      "description",
      "licence",
      "source",
      "minAppVersion",
    ]);
    expect(meta.id).toBe("collections-wikidata");
    expect(meta.kind).toBe("dataset");
    expect(meta.licence.spdx).toBe("CC0-1.0");
    expect(meta.source.url).toBe("https://query.wikidata.org/sparql");
    expect(meta.description.sr).toContain("25 predloženih zbirki");
    expect(meta.description.en).toContain("1917 titles in all, over 1836 unique works");
    // The counts are the build's own, so a description cannot claim a number the
    // file does not hold.
    expect(metaFor({ collections: 1, entries: 2, unique: 2, version: "2026.10.10" }).description.en).toContain(
      "2 titles in all, over 2 unique works",
    );
  });

  it("records every response with its licence evidence", () => {
    const document = sourcesDocument([
      {
        id: "booker-prize",
        queryFile: "queries/booker-prize.rq",
        url: "https://query.wikidata.org/sparql?format=json",
        fetched: "2026-10-10",
        sha256: "a".repeat(64),
        bytes: 23488,
        rows: 47,
        licence: "CC0-1.0",
        licenceEvidence: [],
      },
    ]);
    expect(document.pack).toBe("collections-wikidata");
    expect(document.generated).toBe("2026-10-10");
    expect(document.licence.spdx).toBe("CC0-1.0");
    expect(document.licence.evidence.length).toBe(2);
    for (const evidence of document.licence.evidence) {
      expect(evidence.url).toMatch(/^https:\/\/www\.wikidata\.org\/wiki\//);
      expect(evidence.quote.length).toBeGreaterThan(40);
      expect(evidence.quote.trim()).toBe(evidence.quote);
    }
    expect(document.sources[0].licence).toBe("CC0-1.0");
  });
});
