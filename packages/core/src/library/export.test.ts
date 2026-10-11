import { describe, expect, it } from "vitest";
import {
  LIBRARY_EXPORT_VERSION,
  libraryExportVersion,
  validateLibraryExport,
} from "./export.js";

type Json = Record<string, unknown>;

/**
 * A whole profile's library, written by hand: two items (one with a cover, a
 * pass, a thought and a Q-id), one collection holding both, ordered. Every value
 * is already in the canonical form the writer produces — trimmed text, canonical
 * lists, ISO-8601 timestamps — because that is exactly what the validator
 * accepts and the round-trip test below asserts it comes back unchanged.
 */
function valid(): Json {
  return {
    version: LIBRARY_EXPORT_VERSION,
    items: [
      {
        id: "i1",
        profileId: "p1",
        kind: "book",
        title: "Na Drini ćuprija",
        originalTitle: "The Bridge on the Drina",
        creators: ["Ivo Andrić"],
        year: 1945,
        status: "done",
        rating: 9,
        pagesRead: 400,
        pagesTotal: 400,
        season: null,
        episode: null,
        seasonsTotal: null,
        episodesTotal: null,
        tags: ["klasika"],
        summary: "Most na Drini i tri veka uz njega.",
        wikidataId: "Q1138351",
        createdAt: "2026-03-01T10:00:00.000Z",
        updatedAt: "2026-03-20T20:00:00.000Z",
      },
      {
        id: "i2",
        profileId: "p1",
        kind: "film",
        title: "Ko to tamo peva",
        originalTitle: null,
        creators: ["Slobodan Šijan"],
        year: 1980,
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
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-01T10:00:00.000Z",
      },
    ],
    covers: [
      {
        itemId: "i1",
        fileName: "drina.jpg",
        mime: "image/jpeg",
        sizeBytes: 183_000,
        sha256: "a".repeat(64),
        createdAt: "2026-03-01T10:01:00.000Z",
        updatedAt: "2026-03-01T10:01:00.000Z",
      },
    ],
    passes: [
      {
        id: "x1",
        itemId: "i1",
        seq: 1,
        startedOn: "2026-03-01",
        finishedOn: "2026-03-20",
        rating: 9,
        createdAt: "2026-03-20T20:00:00.000Z",
        updatedAt: "2026-03-20T20:00:00.000Z",
      },
      {
        id: "x2",
        itemId: "i2",
        seq: 1,
        startedOn: null,
        finishedOn: null,
        rating: null,
        createdAt: "2026-04-01T10:00:00.000Z",
        updatedAt: "2026-04-01T10:00:00.000Z",
      },
    ],
    thoughts: [
      {
        id: "t1",
        itemId: "i1",
        entryDate: "2026-03-05",
        text: "Ćuprija je žena.",
        createdAt: "2026-03-05T21:00:00.000Z",
        updatedAt: "2026-03-05T21:00:00.000Z",
      },
    ],
    collections: [
      {
        id: "c1",
        profileId: "p1",
        name: "Srpski klasici",
        description: null,
        suggestedId: "sr-classics-1",
        createdAt: "2026-04-02T10:00:00.000Z",
        updatedAt: "2026-04-02T10:00:00.000Z",
      },
    ],
    collectionItems: [
      {
        id: "l1",
        collectionId: "c1",
        itemId: "i1",
        rank: "i0",
        createdAt: "2026-04-02T10:00:00.000Z",
        updatedAt: "2026-04-02T10:00:00.000Z",
      },
      {
        id: "l2",
        collectionId: "c1",
        itemId: "i2",
        rank: "i1",
        createdAt: "2026-04-02T10:01:00.000Z",
        updatedAt: "2026-04-02T10:01:00.000Z",
      },
    ],
  };
}

/** A deep copy, so a refusal case can break one field without touching the fixture. */
function broken(mutate: (value: Json) => void): unknown {
  const value = JSON.parse(JSON.stringify(valid())) as Json;
  mutate(value);
  return value;
}

describe("libraryExportVersion", () => {
  it("reads the declared version, and null for a value that declares none", () => {
    expect(libraryExportVersion({ version: 3 })).toBe(3);
    expect(libraryExportVersion({})).toBeNull();
    expect(libraryExportVersion({ version: "1" })).toBeNull();
    expect(libraryExportVersion(null)).toBeNull();
  });
});

describe("validateLibraryExport", () => {
  it("accepts the whole value unchanged — the round trip at the validator's level", () => {
    expect(validateLibraryExport(valid())).toEqual(valid());
  });

  it("refuses a version this build does not know", () => {
    expect(validateLibraryExport(broken((value) => (value["version"] = 2)))).toBeNull();
    expect(validateLibraryExport(broken((value) => delete value["version"]))).toBeNull();
  });

  it("refuses an unknown key, because the format is versioned", () => {
    expect(
      validateLibraryExport(broken((value) => (value["study_settings"] = {}))),
    ).toBeNull();
    expect(
      validateLibraryExport(
        broken((value) => ((value["items"] as Json[])[0]!["mood"] = "good")),
      ),
    ).toBeNull();
  });

  it("refuses a pass, a thought or a link whose parent is not in the same value", () => {
    expect(
      validateLibraryExport(
        broken((value) => ((value["passes"] as Json[])[0]!["itemId"] = "missing")),
      ),
    ).toBeNull();
    expect(
      validateLibraryExport(
        broken((value) => ((value["thoughts"] as Json[])[0]!["itemId"] = "missing")),
      ),
    ).toBeNull();
    expect(
      validateLibraryExport(
        broken((value) => ((value["collectionItems"] as Json[])[0]!["collectionId"] = "missing")),
      ),
    ).toBeNull();
    expect(
      validateLibraryExport(
        broken((value) => ((value["covers"] as Json[])[0]!["itemId"] = "missing")),
      ),
    ).toBeNull();
  });

  it("refuses a second cover for one item and a second link for one pair", () => {
    expect(
      validateLibraryExport(
        broken((value) => {
          const covers = value["covers"] as Json[];
          covers.push({ ...covers[0], sha256: "b".repeat(64) });
        }),
      ),
    ).toBeNull();
    expect(
      validateLibraryExport(
        broken((value) => {
          const links = value["collectionItems"] as Json[];
          links.push({ ...links[0], id: "l3", rank: "i2" });
        }),
      ),
    ).toBeNull();
  });

  it("refuses two passes with the same sequence for one item, and two items sharing a Q-id", () => {
    expect(
      validateLibraryExport(
        broken((value) => {
          const passes = value["passes"] as Json[];
          passes.push({ ...passes[0], id: "x3" });
        }),
      ),
    ).toBeNull();
    expect(
      validateLibraryExport(
        broken((value) => {
          const items = value["items"] as Json[];
          (items[1] as Json)["wikidataId"] = "Q1138351";
        }),
      ),
    ).toBeNull();
  });

  it("refuses progress that is impossible for the item's kind", () => {
    expect(
      validateLibraryExport(
        broken((value) => ((value["items"] as Json[])[1]!["pagesTotal"] = 120)),
      ),
    ).toBeNull();
    // And a count past its total.
    expect(
      validateLibraryExport(
        broken((value) => ((value["items"] as Json[])[0]!["pagesRead"] = 401)),
      ),
    ).toBeNull();
  });

  it("refuses text that is not trimmed, and a list that is not canonical", () => {
    expect(
      validateLibraryExport(
        broken((value) => ((value["items"] as Json[])[0]!["title"] = " Na Drini ćuprija ")),
      ),
    ).toBeNull();
    expect(
      validateLibraryExport(
        broken(
          (value) =>
            ((value["items"] as Json[])[0]!["creators"] = ["Ivo Andrić", "Ivo Andrić"]),
        ),
      ),
    ).toBeNull();
    expect(
      validateLibraryExport(
        broken((value) => ((value["thoughts"] as Json[])[0]!["text"] = "")),
      ),
    ).toBeNull();
  });

  it("refuses a bare date that is no calendar day and a rank that is not a rank", () => {
    expect(
      validateLibraryExport(
        broken((value) => ((value["passes"] as Json[])[0]!["finishedOn"] = "2026-02-30")),
      ),
    ).toBeNull();
    expect(
      validateLibraryExport(
        broken((value) => ((value["passes"] as Json[])[0]!["startedOn"] = "2026-04-01")),
      ),
    ).toBeNull();
    expect(
      validateLibraryExport(
        broken((value) => ((value["collectionItems"] as Json[])[0]!["rank"] = "0")),
      ),
    ).toBeNull();
  });

  it("refuses an oversized cover and a malformed hash or mime", () => {
    expect(
      validateLibraryExport(
        broken((value) => ((value["covers"] as Json[])[0]!["sizeBytes"] = 52_428_801)),
      ),
    ).toBeNull();
    expect(
      validateLibraryExport(
        broken((value) => ((value["covers"] as Json[])[0]!["sha256"] = "A".repeat(64))),
      ),
    ).toBeNull();
    expect(
      validateLibraryExport(
        broken((value) => ((value["covers"] as Json[])[0]!["mime"] = "image")),
      ),
    ).toBeNull();
  });

  it("refuses two live collections adopted from one suggested list", () => {
    expect(
      validateLibraryExport(
        broken((value) => {
          const collections = value["collections"] as Json[];
          collections.push({ ...collections[0], id: "c2", name: "Srpski klasici II" });
        }),
      ),
    ).toBeNull();
  });
});
