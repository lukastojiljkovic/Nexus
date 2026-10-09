import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateLibraryExport } from "@nexus/core";
import type { SuggestedCollectionV1 } from "@nexus/core";
import {
  LibraryNotFoundError,
  LibraryStore,
  LibraryValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:00:00.000Z";
const LATER_STILL = "2026-06-03T10:00:00.000Z";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-library-"));
  db = openDatabase({ path: join(dir, "library.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

/** A store for a fresh profile — the usual shape, since most cases do not care which profile it is. */
function store(): LibraryStore {
  return new LibraryStore(db.raw, createProfile());
}

const COVER = {
  fileName: "korice.jpg",
  mime: "image/jpeg",
  sizeBytes: 21_504,
  sha256: "a".repeat(64),
};

/**
 * ONE hand-written fixture, three entries, for the adopt tests. The Q-ids are
 * deliberately synthetic („Q1000000nnn"): a real Wikidata id would make this
 * file look like the curated data the module ships none of, and the brief asks
 * for a fixture rather than a list. Nothing here asserts anything about
 * Wikidata itself — the titles are simply the three works such a list would
 * name.
 */
const SUGGESTION: SuggestedCollectionV1 = {
  id: "sr-classics-1",
  title: { sr: "Srpski klasici", en: "Serbian classics" },
  source: "Wikidata",
  licence: "CC0 1.0",
  items: [
    {
      wikidataId: "Q1000000001",
      kind: "book",
      title: { sr: "Na Drini ćuprija", en: "The Bridge on the Drina" },
      year: 1945,
      creators: ["Ivo Andrić"],
    },
    {
      wikidataId: "Q1000000002",
      kind: "film",
      title: { sr: "Ko to tamo peva", en: "Who's Singin' Over There?" },
      year: 1980,
      creators: ["Slobodan Šijan"],
    },
    {
      wikidataId: "Q1000000003",
      kind: "series",
      title: { sr: "Otpisani", en: "The Written Off" },
      year: 1974,
    },
  ],
};

describe("LibraryStore items", () => {
  it("creates a book with defaults and returns it in sr-Latn order", () => {
    const library = store();
    const book = library.createItem({ kind: "book", title: "  Na Drini ćuprija  " }, NOW);
    library.createItem({ kind: "film", title: "Ko to tamo peva" }, NOW);

    expect(book).toMatchObject({
      kind: "book",
      title: "Na Drini ćuprija",
      originalTitle: null,
      creators: [],
      year: null,
      status: "planned",
      rating: null,
      pagesRead: null,
      pagesTotal: null,
      season: null,
      episode: null,
      seasonsTotal: null,
      episodesTotal: null,
      tags: [],
      summary: null,
      wikidataId: null,
      cover: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(library.listItems().map((item) => item.title)).toEqual([
      "Ko to tamo peva",
      "Na Drini ćuprija",
    ]);
  });

  it("orders the list by sr-Latn, where a code-unit sort would differ", () => {
    const library = store();
    for (const title of ["Šuma", "Čačak", "Ćuprija", "Žito", "Ana"]) {
      library.createItem({ kind: "book", title }, NOW);
    }
    expect(library.listItems().map((item) => item.title)).toEqual([
      "Ana",
      "Čačak",
      "Ćuprija",
      "Šuma",
      "Žito",
    ]);
  });

  it("stores a series' progress and refuses progress of the wrong kind", () => {
    const library = store();
    const series = library.createItem(
      { kind: "series", title: "Otpisani", season: 2, episode: 7, seasonsTotal: 2 },
      NOW,
    );
    expect(series).toMatchObject({ season: 2, episode: 7, seasonsTotal: 2 });

    expect(() => library.createItem({ kind: "book", title: "Nešto", season: 1 }, NOW)).toThrow(
      /"season" is not a field a book has\./,
    );
    expect(() => library.createItem({ kind: "film", title: "Nešto", pagesTotal: 100 }, NOW)).toThrow(
      /"pagesTotal" is not a field a film has\./,
    );
  });

  it("refuses a count past its total, naming the count", () => {
    const library = store();
    expect(() =>
      library.createItem({ kind: "book", title: "Nešto", pagesRead: 401, pagesTotal: 400 }, NOW),
    ).toThrow(/"pagesRead" must not be greater than "pagesTotal"\./);
    expect(() =>
      library.createItem({ kind: "series", title: "Nešto", season: 6, seasonsTotal: 5 }, NOW),
    ).toThrow(/"season" must not be greater than "seasonsTotal"\./);
  });

  it("patches one field at a time, and an explicit null clears a nullable one", () => {
    const library = store();
    const item = library.createItem(
      { kind: "book", title: "Solaris", year: 1961, creators: ["Stanisław Lem"], tags: ["sf"] },
      NOW,
    );

    const updated = library.updateItem(item.id, { rating: 9, status: "done" }, LATER);
    expect(updated).toMatchObject({
      rating: 9,
      status: "done",
      year: 1961,
      creators: ["Stanisław Lem"],
      updatedAt: LATER,
    });

    const cleared = library.updateItem(item.id, { year: null, summary: "Nova beleška" }, LATER_STILL);
    expect(cleared.year).toBeNull();
    expect(cleared.creators).toEqual(["Stanisław Lem"]);
    expect(cleared.tags).toEqual(["sf"]);
    expect(cleared.summary).toBe("Nova beleška");
  });

  it("keeps a work's children through a soft delete and a restore", () => {
    const library = store();
    const item = library.createItem({ kind: "book", title: "Solaris" }, NOW);
    library.addPass(item.id, { finishedOn: "2026-05-01", rating: 8 }, NOW);
    library.addThought(item.id, { date: "2026-05-02", text: "Prva misao." }, NOW);
    library.setCover(item.id, COVER, NOW);
    const collection = library.createCollection({ name: "SF" }, NOW);
    library.addToCollection(collection.id, item.id, NOW);

    library.softDeleteItem(item.id, LATER);
    expect(library.listItems()).toEqual([]);
    expect(() => library.getItem(item.id)).toThrow(LibraryNotFoundError);
    // The link stays where it is while the work is in the trash, so the
    // collection does not count it and does not lose it either.
    expect(library.listCollectionItems(collection.id)).toEqual([]);
    expect(library.getCollection(collection.id).progress).toEqual({ done: 0, total: 0 });

    library.restoreItem(item.id, LATER_STILL);
    expect(library.getItem(item.id).cover?.sha256).toBe(COVER.sha256);
    expect(library.listPasses(item.id)).toHaveLength(1);
    expect(library.listThoughts(item.id)).toHaveLength(1);
    expect(library.listCollectionItems(collection.id).map((each) => each.id)).toEqual([item.id]);
  });

  it("refuses a work that belongs to another profile, and a delete of one already deleted", () => {
    const mine = store();
    const theirs = store();
    const foreign = theirs.createItem({ kind: "book", title: "Tuđe" }, NOW);

    expect(() => mine.getItem(foreign.id)).toThrow(LibraryNotFoundError);
    expect(() => mine.updateItem(foreign.id, { title: "Moje" }, NOW)).toThrow(LibraryNotFoundError);
    expect(() => mine.addPass(foreign.id, {}, NOW)).toThrow(LibraryNotFoundError);

    const item = mine.createItem({ kind: "book", title: "Moje" }, NOW);
    mine.softDeleteItem(item.id, LATER);
    expect(() => mine.softDeleteItem(item.id, LATER_STILL)).toThrow(LibraryNotFoundError);
    expect(() => mine.restoreItem(uuidv7(), LATER)).toThrow(LibraryNotFoundError);
  });

  it("refuses malformed fields with a sentence naming the field", () => {
    const library = store();
    expect(() => library.createItem({ kind: "book", title: "   " }, NOW)).toThrow(
      LibraryValidationError,
    );
    expect(() => library.createItem({ kind: "book", title: "X", year: 0 }, NOW)).toThrow(
      /"year" must be a whole year between 1 and 9999\./,
    );
    expect(() => library.createItem({ kind: "book", title: "X", rating: 11 }, NOW)).toThrow(
      /"rating" must be a whole number between 1 and 10\./,
    );
    expect(() => library.createItem({ kind: "book", title: "X", wikidataId: "Q042" }, NOW)).toThrow(
      /"wikidataId" must be a Wikidata id of the form Q123\./,
    );
    expect(() =>
      library.createItem({ kind: "book", title: "X", tags: ["a".repeat(41)] }, NOW),
    ).toThrow(LibraryValidationError);
    expect(() =>
      library.createItem({ kind: "book", title: "X", creators: ["a".repeat(121)] }, NOW),
    ).toThrow(LibraryValidationError);
    expect(() =>
      library.createItem({ kind: "book", title: "X", summary: "s".repeat(2_001) }, NOW),
    ).toThrow(LibraryValidationError);
    expect(() => library.createItem({ kind: "book", title: "X", pagesRead: 2.5 }, NOW)).toThrow(
      /"pagesRead" must be a whole number between 0 and 100000\./,
    );
    expect(() => library.createItem({ kind: "book", title: "X" }, "juče")).toThrow(
      LibraryValidationError,
    );
  });

  it("refuses a second live item carrying one Wikidata id, and allows one after a delete", () => {
    const library = store();
    const first = library.createItem(
      { kind: "book", title: "Solaris", wikidataId: "Q1000220" },
      NOW,
    );
    expect(() =>
      library.createItem({ kind: "film", title: "Solaris", wikidataId: "Q1000220" }, NOW),
    ).toThrow(LibraryValidationError);

    library.softDeleteItem(first.id, LATER);
    expect(
      library.createItem({ kind: "film", title: "Solaris", wikidataId: "Q1000220" }, NOW).id,
    ).not.toBe(first.id);
  });
});

describe("LibraryStore covers", () => {
  it("sets, replaces (keeping createdAt) and clears one cover, bumping the item's activity", () => {
    const library = store();
    const item = library.createItem({ kind: "book", title: "Solaris" }, NOW);

    const withCover = library.setCover(item.id, COVER, LATER);
    expect(withCover.cover).toEqual({
      itemId: item.id,
      fileName: "korice.jpg",
      mime: "image/jpeg",
      sizeBytes: 21_504,
      sha256: COVER.sha256,
      createdAt: LATER,
      updatedAt: LATER,
    });
    expect(withCover.updatedAt).toBe(LATER);

    const replaced = library.setCover(
      item.id,
      { ...COVER, fileName: "drugo.png", mime: "image/png", sha256: "b".repeat(64) },
      LATER_STILL,
    );
    expect(replaced.cover).toMatchObject({
      fileName: "drugo.png",
      sha256: "b".repeat(64),
      createdAt: LATER,
      updatedAt: LATER_STILL,
    });

    expect(library.clearCover(item.id, LATER_STILL).cover).toBeNull();
    // Clearing a cover that is not there is not an error.
    expect(library.clearCover(item.id, LATER_STILL).cover).toBeNull();
  });

  it("refuses a cover that is not an image blob's index", () => {
    const library = store();
    const item = library.createItem({ kind: "book", title: "Solaris" }, NOW);
    expect(() =>
      library.setCover(item.id, { ...COVER, fileName: "put\\do\\fajla.jpg" }, NOW),
    ).toThrow(/"fileName" must be/);
    expect(() => library.setCover(item.id, { ...COVER, mime: "image" }, NOW)).toThrow(
      /"mime" must be a MIME type/,
    );
    expect(() => library.setCover(item.id, { ...COVER, sizeBytes: 0 }, NOW)).toThrow(
      /"sizeBytes" must be a positive integer/,
    );
    expect(() => library.setCover(item.id, { ...COVER, sha256: "a".repeat(63) }, NOW)).toThrow(
      /"sha256" must be a 64-character/,
    );
    expect(() => library.setCover(uuidv7(), COVER, NOW)).toThrow(LibraryNotFoundError);
  });
});

describe("LibraryStore passes", () => {
  it("numbers passes per item and derives the item's status and rating from the latest", () => {
    const library = store();
    const item = library.createItem({ kind: "book", title: "Solaris" }, NOW);

    const first = library.addPass(item.id, { finishedOn: "2026-05-20", rating: 8 }, LATER);
    expect(first.seq).toBe(1);
    expect(library.getItem(item.id)).toMatchObject({ status: "done", rating: 8 });

    // A RE-READ: a second pass, which has started and is not finished yet.
    const second = library.addPass(item.id, { startedOn: "2026-06-01" }, LATER_STILL);
    expect(second.seq).toBe(2);
    expect(library.getItem(item.id)).toMatchObject({ status: "in-progress", rating: 8 });

    // Finishing it re-derives both, in one write.
    library.updatePass(item.id, second.id, { finishedOn: "2026-06-30", rating: 10 }, LATER_STILL);
    expect(library.getItem(item.id)).toMatchObject({ status: "done", rating: 10 });

    // Removing the LATEST pass puts the item back where the older one left it.
    library.removePass(item.id, second.id, LATER_STILL);
    expect(library.getItem(item.id)).toMatchObject({ status: "done", rating: 8 });
    expect(library.listPasses(item.id).map((pass) => pass.seq)).toEqual([1]);

    // ... and removing the last one leaves the item where it stood: deleting the
    // record of a reading is not „I never read it".
    library.removePass(item.id, first.id, LATER_STILL);
    expect(library.getItem(item.id)).toMatchObject({ status: "done", rating: 8 });
    expect(library.listPasses(item.id)).toEqual([]);
  });

  it("refuses a finish before the start, a bad day, a bad rating and a foreign pass id", () => {
    const library = store();
    const item = library.createItem({ kind: "book", title: "Solaris" }, NOW);
    expect(() =>
      library.addPass(item.id, { startedOn: "2026-05-20", finishedOn: "2026-05-01" }, NOW),
    ).toThrow(/"startedOn" must not be after "finishedOn"\./);
    expect(() => library.addPass(item.id, { startedOn: "2026-02-30" }, NOW)).toThrow(
      /"startedOn" must be a real bare date/,
    );
    expect(() => library.addPass(item.id, { rating: 0 }, NOW)).toThrow(
      /"rating" must be a whole number between 1 and 10\./,
    );
    expect(() => library.removePass(item.id, uuidv7(), NOW)).toThrow(LibraryNotFoundError);
    expect(() => library.updatePass(item.id, uuidv7(), { rating: 5 }, NOW)).toThrow(
      LibraryNotFoundError,
    );
  });
});

describe("LibraryStore thoughts", () => {
  it("keeps a dated journal in date order, patched and removed through the item", () => {
    const library = store();
    const item = library.createItem({ kind: "film", title: "Ko to tamo peva" }, NOW);
    const later = library.addThought(item.id, { date: "2026-06-02", text: "Drugi dan." }, LATER);
    const first = library.addThought(item.id, { date: "2026-05-30", text: "Prvi dan." }, LATER);

    expect(library.listThoughts(item.id).map((entry) => entry.text)).toEqual([
      "Prvi dan.",
      "Drugi dan.",
    ]);

    const corrected = library.updateThought(
      item.id,
      later.id,
      { text: "  Drugi dan, ispravljeno.  ", date: "2026-06-03" },
      LATER_STILL,
    );
    expect(corrected).toMatchObject({ text: "Drugi dan, ispravljeno.", entryDate: "2026-06-03" });
    expect(library.getItem(item.id).updatedAt).toBe(LATER_STILL);

    library.removeThought(item.id, first.id, LATER_STILL);
    expect(library.listThoughts(item.id).map((entry) => entry.text)).toEqual([
      "Drugi dan, ispravljeno.",
    ]);
    expect(() => library.removeThought(item.id, first.id, LATER_STILL)).toThrow(
      LibraryNotFoundError,
    );
  });

  it("refuses blank text and a day that is no calendar day", () => {
    const library = store();
    const item = library.createItem({ kind: "film", title: "X" }, NOW);
    expect(() => library.addThought(item.id, { date: "2026-06-01", text: "   " }, NOW)).toThrow(
      /"text" must be 1-4000 characters/,
    );
    expect(() => library.addThought(item.id, { date: "2026-04-31", text: "Nešto" }, NOW)).toThrow(
      /"date" must be a real bare date/,
    );
    expect(() =>
      library.addThought(item.id, { date: "2026-06-01", text: "t".repeat(4_001) }, NOW),
    ).toThrow(LibraryValidationError);
  });
});

describe("LibraryStore collections", () => {
  it("orders collections by sr-Latn name and computes progress from the live items' statuses", () => {
    const library = store();
    const zeta = library.createCollection({ name: "Žanr" }, NOW);
    const alfa = library.createCollection({ name: "Čitaonica", description: "  Klub  " }, NOW);
    expect(library.listCollections().map((each) => each.name)).toEqual(["Čitaonica", "Žanr"]);
    expect(library.getCollection(alfa.id).description).toBe("Klub");

    const done = library.createItem({ kind: "book", title: "Jedna", status: "done" }, NOW);
    const planned = library.createItem({ kind: "book", title: "Druga" }, NOW);
    const dropped = library.createItem({ kind: "book", title: "Treća" }, NOW);
    library.addToCollection(alfa.id, done.id, NOW);
    library.addToCollection(alfa.id, planned.id, NOW);
    library.addToCollection(alfa.id, dropped.id, NOW);

    // A dropped work is not a finished one, and the denominator counts the live
    // items only.
    expect(library.getCollection(alfa.id).progress).toEqual({ done: 1, total: 3 });
    expect(library.listCollections()[0]?.progress).toEqual({ done: 1, total: 3 });
    expect(library.getCollection(zeta.id).progress).toEqual({ done: 0, total: 0 });
  });

  it("appends, is idempotent, reorders between two neighbours, and removes", () => {
    const library = store();
    const collection = library.createCollection({ name: "Red" }, NOW);
    const a = library.createItem({ kind: "book", title: "A" }, NOW);
    const b = library.createItem({ kind: "book", title: "B" }, NOW);
    const c = library.createItem({ kind: "book", title: "C" }, NOW);

    library.addToCollection(collection.id, a.id, NOW);
    library.addToCollection(collection.id, b.id, NOW);
    library.addToCollection(collection.id, c.id, NOW);
    expect(library.listCollectionItems(collection.id).map((item) => item.title)).toEqual([
      "A",
      "B",
      "C",
    ]);

    // A double tap must not move it to the bottom.
    library.addToCollection(collection.id, a.id, LATER);
    expect(library.listCollectionItems(collection.id).map((item) => item.title)).toEqual([
      "A",
      "B",
      "C",
    ]);

    // C between A and B.
    library.moveCollectionItem(collection.id, c.id, a.id, b.id, LATER);
    expect(library.listCollectionItems(collection.id).map((item) => item.title)).toEqual([
      "A",
      "C",
      "B",
    ]);
    expect(library.listCollectionLinks(collection.id).map((link) => link.itemId)).toEqual([
      a.id,
      c.id,
      b.id,
    ]);

    library.moveCollectionItem(collection.id, c.id, null, a.id, LATER_STILL);
    expect(library.listCollectionItems(collection.id).map((item) => item.title)).toEqual([
      "C",
      "A",
      "B",
    ]);
    library.moveCollectionItem(collection.id, c.id, b.id, null, LATER_STILL);
    expect(library.listCollectionItems(collection.id).map((item) => item.title)).toEqual([
      "A",
      "B",
      "C",
    ]);

    library.removeFromCollection(collection.id, b.id, LATER_STILL);
    expect(library.listCollectionItems(collection.id).map((item) => item.title)).toEqual([
      "A",
      "C",
    ]);
    // Removing what is not there is not an error.
    library.removeFromCollection(collection.id, b.id, LATER_STILL);
    expect(library.listCollectionItems(collection.id)).toHaveLength(2);
  });

  it("refuses a pair that is not a gap, a foreign sibling and an unknown id", () => {
    const library = store();
    const collection = library.createCollection({ name: "Red" }, NOW);
    const a = library.createItem({ kind: "book", title: "A" }, NOW);
    const b = library.createItem({ kind: "book", title: "B" }, NOW);
    library.addToCollection(collection.id, a.id, NOW);

    expect(() => library.moveCollectionItem(collection.id, a.id, a.id, null, NOW)).toThrow(
      /"beforeId" and "afterId" must name other works/,
    );
    // b is not IN the collection, so naming it as a neighbour cannot be a gap —
    // and the refusal names the row that is missing.
    expect(() => library.moveCollectionItem(collection.id, a.id, null, b.id, NOW)).toThrow(
      LibraryNotFoundError,
    );
    expect(() => library.addToCollection(collection.id, uuidv7(), NOW)).toThrow(
      LibraryNotFoundError,
    );
    expect(() => library.addToCollection(uuidv7(), a.id, NOW)).toThrow(LibraryNotFoundError);
  });

  it("soft-deletes and restores a collection with its links untouched", () => {
    const library = store();
    const collection = library.createCollection({ name: "Red", description: "Opis" }, NOW);
    const a = library.createItem({ kind: "book", title: "A" }, NOW);
    library.addToCollection(collection.id, a.id, NOW);

    library.softDeleteCollection(collection.id, LATER);
    expect(library.listCollections()).toEqual([]);
    expect(() => library.getCollection(collection.id)).toThrow(LibraryNotFoundError);
    expect(() => library.listCollectionItems(collection.id)).toThrow(LibraryNotFoundError);

    library.restoreCollection(collection.id, LATER_STILL);
    expect(library.getCollection(collection.id).progress).toEqual({ done: 0, total: 1 });
    expect(library.listCollectionItems(collection.id).map((item) => item.id)).toEqual([a.id]);
    library.softDeleteCollection(collection.id, LATER_STILL);
    expect(() => library.softDeleteCollection(collection.id, LATER_STILL)).toThrow(
      LibraryNotFoundError,
    );
  });

  it("renames and re-describes, and refuses a nameless collection", () => {
    const library = store();
    const collection = library.createCollection({ name: "Red" }, NOW);
    expect(library.updateCollection(collection.id, { name: "Novi red" }, LATER).name).toBe(
      "Novi red",
    );
    expect(() => library.createCollection({ name: "  " }, NOW)).toThrow(
      /"name" must be 1-120 characters/,
    );
    expect(() =>
      library.createCollection({ name: "X", description: "d".repeat(501) }, NOW),
    ).toThrow(/"description" must be at most 500/);
  });
});

describe("LibraryStore.adoptSuggestedCollection", () => {
  /**
   * Two of the three entries already exist — one matchable only BY TITLE (no
   * Q-id, no diacritics, lower case) and one by Q-id — and a decoy shares a title
   * with the third entry but not its kind, so it must not match.
   */
  function seed(library: LibraryStore): { byTitle: string; byQid: string; decoy: string } {
    const byTitle = library.createItem(
      { kind: "book", title: "na drini cuprija", year: 1945 },
      NOW,
    );
    const byQid = library.createItem(
      { kind: "film", title: "Ko to tamo peva", year: 1980, wikidataId: "Q1000000002" },
      NOW,
    );
    const decoy = library.createItem({ kind: "film", title: "Otpisani", year: 1974 }, NOW);
    return { byTitle: byTitle.id, byQid: byQid.id, decoy: decoy.id };
  }

  it("reuses what exists, creates what does not, and links the list in its own order", () => {
    const library = store();
    const seedIds = seed(library);

    const adopted = library.adoptSuggestedCollection(SUGGESTION, LATER);
    expect(adopted.created).toBe(true);
    expect(adopted.createdItems).toBe(1);
    expect(adopted.reusedItems).toBe(2);
    expect(adopted.collection).toMatchObject({
      name: "Srpski klasici",
      description: null,
      suggestedId: "sr-classics-1",
    });
    expect(adopted.collection.progress).toEqual({ done: 0, total: 3 });

    const items = library.listCollectionItems(adopted.collection.id);
    expect(items.map((item) => item.id)).toEqual([seedIds.byTitle, seedIds.byQid, items[2]?.id]);
    expect(items.map((item) => item.id)).not.toContain(seedIds.decoy);
    expect(items[2]).toMatchObject({
      kind: "series",
      title: "Otpisani",
      originalTitle: "The Written Off",
      year: 1974,
      status: "planned",
      wikidataId: "Q1000000003",
      creators: [],
    });
    // Three works existed and one was added.
    expect(library.listItems()).toHaveLength(4);
  });

  it("is a no-op the second time — the same collection, and no second copy of anything", () => {
    const library = store();
    seed(library);
    const first = library.adoptSuggestedCollection(SUGGESTION, LATER);
    const again = library.adoptSuggestedCollection(SUGGESTION, LATER_STILL);

    expect(again.created).toBe(false);
    expect(again.createdItems).toBe(0);
    expect(again.reusedItems).toBe(0);
    expect(again.collection.id).toBe(first.collection.id);
    expect(library.listItems()).toHaveLength(4);
    expect(library.listCollections()).toHaveLength(1);
  });

  it("adopts an empty profile into three planned works, in Serbian with the English kept as the original title", () => {
    const library = store();
    const adopted = library.adoptSuggestedCollection(SUGGESTION, NOW);
    expect(adopted.createdItems).toBe(3);
    expect(adopted.reusedItems).toBe(0);
    const items = library.listItems();
    expect(items.map((item) => item.status)).toEqual(["planned", "planned", "planned"]);
    // sr-Latn order: „Ko to tamo peva", „Na Drini ćuprija", „Otpisani".
    expect(items.map((item) => item.title)).toEqual([
      "Ko to tamo peva",
      "Na Drini ćuprija",
      "Otpisani",
    ]);
    expect(items.map((item) => item.originalTitle)).toEqual([
      "Who's Singin' Over There?",
      "The Bridge on the Drina",
      "The Written Off",
    ]);
    expect(items.map((item) => item.creators)).toEqual([
      ["Slobodan Šijan"],
      ["Ivo Andrić"],
      [],
    ]);
  });

  it("links a work a list names twice only once", () => {
    const library = store();
    const twice: SuggestedCollectionV1 = {
      ...SUGGESTION,
      id: "twice-1",
      items: [SUGGESTION.items[0]!, { ...SUGGESTION.items[0]!, title: { sr: "Most na Drini", en: "The Bridge on the Drina" } }],
    };
    const adopted = library.adoptSuggestedCollection(twice, NOW);
    expect(adopted.createdItems).toBe(1);
    // The second entry matched the item the first one created.
    expect(adopted.reusedItems).toBe(1);
    expect(library.listCollectionItems(adopted.collection.id)).toHaveLength(1);
  });

  it("refuses a value that is not a valid suggested collection", () => {
    const library = store();
    expect(() => library.adoptSuggestedCollection({ ...SUGGESTION, items: [] }, NOW)).toThrow(
      LibraryValidationError,
    );
    expect(() =>
      library.adoptSuggestedCollection({ id: "x" } as SuggestedCollectionV1, NOW),
    ).toThrow(LibraryValidationError);
  });
});

describe("LibraryStore export and import", () => {
  /** One profile holding one of everything: a work with a cover, a pass, a thought, and a collection of two works. */
  function seedEverything(library: LibraryStore): void {
    const book = library.createItem(
      {
        kind: "book",
        title: "Na Drini ćuprija",
        originalTitle: "The Bridge on the Drina",
        creators: ["Ivo Andrić"],
        year: 1945,
        status: "done",
        rating: 9,
        pagesRead: 400,
        pagesTotal: 400,
        tags: ["klasika"],
        summary: "Most i tri veka.",
        wikidataId: "Q1000000001",
      },
      NOW,
    );
    const series = library.createItem({ kind: "series", title: "Otpisani", season: 1 }, LATER);
    library.addPass(series.id, {}, LATER_STILL);
    library.setCover(book.id, COVER, LATER);
    library.addPass(
      book.id,
      { startedOn: "2026-03-01", finishedOn: "2026-03-20", rating: 9 },
      LATER,
    );
    library.addThought(book.id, { date: "2026-03-05", text: "Ćuprija je žena." }, LATER);
    const collection = library.createCollection({ name: "Klasici" }, LATER);
    library.addToCollection(collection.id, book.id, LATER);
    library.addToCollection(collection.id, series.id, LATER_STILL);
  }

  it("exports a value the validator accepts, and imports it back unchanged", () => {
    const library = store();
    seedEverything(library);
    const exported = library.exportData();
    expect(validateLibraryExport(exported)).toEqual(exported);

    expect(library.importData(exported)).toEqual({
      items: 2,
      covers: 1,
      passes: 2,
      thoughts: 1,
      collections: 1,
      collectionItems: 2,
    });
    expect(library.exportData()).toEqual(exported);
  });

  it("writes rows under THIS store's profile, never the profile the value names", () => {
    const profileId = createProfile();
    const library = new LibraryStore(db.raw, profileId);
    // A minimal value whose rows claim another machine's profile — the archive
    // of a profile restored onto the profile it came from re-homes every row.
    library.importData({
      version: 1,
      items: [
        {
          id: "item-1",
          profileId: "profile-of-another-machine",
          kind: "book",
          title: "Solaris",
          originalTitle: null,
          creators: ["Stanisław Lem"],
          year: 1961,
          status: "planned",
          rating: null,
          pagesRead: null,
          pagesTotal: null,
          season: null,
          episode: null,
          seasonsTotal: null,
          episodesTotal: null,
          tags: [],
          summary: null,
          wikidataId: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
      covers: [],
      passes: [],
      thoughts: [],
      collections: [],
      collectionItems: [],
    });

    expect(library.listItems().map((item) => item.profileId)).toEqual([profileId]);
    expect(library.exportData().items[0]?.profileId).toBe(profileId);
  });

  it("replaces, rather than merges — a merge could not express a deletion", () => {
    const library = store();
    seedEverything(library);
    const exported = library.exportData();
    const extra = library.createItem({ kind: "film", title: "Višak" }, LATER_STILL);
    expect(library.listItems()).toHaveLength(3);

    library.importData(exported);
    expect(library.listItems().map((item) => item.id)).not.toContain(extra.id);
    expect(library.exportData()).toEqual(exported);
  });

  it("carries live content only — a soft-deleted work is not in the value", () => {
    const library = store();
    seedEverything(library);
    const gone = library.listItems()[0]!.id;
    library.softDeleteItem(gone, LATER_STILL);

    const exported = library.exportData();
    expect(exported.items.map((item) => item.id)).not.toContain(gone);
    expect(exported.passes.every((pass) => pass.itemId !== gone)).toBe(true);
    expect(exported.thoughts.every((thought) => thought.itemId !== gone)).toBe(true);
    // The link to it is gone too: a value that named a row it does not carry
    // would be one its own validator refuses.
    expect(exported.collectionItems.every((link) => link.itemId !== gone)).toBe(true);
  });

  it("refuses an unknown version, naming it", () => {
    const library = store();
    seedEverything(library);
    expect(() => library.importData({ ...library.exportData(), version: 2 })).toThrow(
      /Library export version 2 is not supported/,
    );
    expect(() => library.importData({ items: [] })).toThrow(/version \? is not supported/);
  });

  it("writes NOTHING when the value is invalid — a dangling reference leaves the library as it was", () => {
    const library = store();
    seedEverything(library);
    const before = library.exportData();
    expect(() =>
      library.importData({
        ...before,
        passes: [{ ...before.passes[0]!, itemId: "nema-ovog-rada" }],
      }),
    ).toThrow(LibraryValidationError);
    expect(library.exportData()).toEqual(before);
  });
});

describe("migration 072's schema", () => {
  it("refuses progress the item's kind cannot carry, and a count past its total", () => {
    const profileId = createProfile();
    const insert = db.raw.prepare(
      `INSERT INTO library_items
         (id, profile_id, kind, title, creators_json, tags_json, status,
          pages_read, pages_total, created_at, updated_at)
       VALUES (?, ?, ?, ?, '[]', '[]', 'planned', ?, ?, ?, ?)`,
    );
    // A film with pages, and a book whose read count passes its total.
    expect(() => insert.run("x1", profileId, "film", "X", 10, 100, NOW, NOW)).toThrow();
    expect(() => insert.run("x2", profileId, "book", "X", 401, 400, NOW, NOW)).toThrow();
    expect(() => insert.run("x3", profileId, "book", "X", 400, 400, NOW, NOW)).not.toThrow();
  });

  it("refuses two passes with one sequence, and two live items with one Q-id", () => {
    const profileId = createProfile();
    const item = new LibraryStore(db.raw, profileId).createItem(
      { kind: "book", title: "X", wikidataId: "Q1000220" },
      NOW,
    );
    const pass = db.raw.prepare(
      `INSERT INTO library_passes (id, item_id, seq, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?)`,
    );
    pass.run("p1", item.id, NOW, NOW);
    expect(() => pass.run("p2", item.id, NOW, NOW)).toThrow();

    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO library_items
             (id, profile_id, kind, title, creators_json, tags_json, status,
              wikidata_id, created_at, updated_at)
           VALUES (?, ?, 'film', 'X', '[]', '[]', 'planned', 'Q1000220', ?, ?)`,
        )
        .run("x9", profileId, NOW, NOW),
    ).toThrow();
  });
});
