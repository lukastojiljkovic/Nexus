import { describe, expect, it } from "vitest";
import {
  LIBRARY_MAX_COUNT,
  LIBRARY_MAX_CREATORS,
  LIBRARY_MAX_CREATOR_LENGTH,
  LIBRARY_MAX_RATING,
  LIBRARY_MAX_TAGS,
  LIBRARY_MAX_TAG_LENGTH,
  LIBRARY_MAX_YEAR,
  deriveLibraryRatingFromPass,
  deriveLibraryStatusFromPass,
  isLibraryCount,
  isLibraryDay,
  isLibraryKind,
  isLibraryRating,
  isLibraryReadPages,
  isLibraryStatus,
  isLibraryTimestamp,
  isLibraryYear,
  isWikidataId,
  serializeLibraryList,
  validateLibraryCreators,
  validateLibraryProgress,
  validateLibraryTags,
} from "./item.js";
import type { LibraryProgress } from "./item.js";

/** All six fields null — „nothing recorded", the shape a film keeps for ever. */
const EMPTY: LibraryProgress = {
  pagesRead: null,
  pagesTotal: null,
  season: null,
  episode: null,
  seasonsTotal: null,
  episodesTotal: null,
};

describe("the closed vocabularies", () => {
  it("accepts exactly the three kinds and the four statuses", () => {
    expect(["book", "film", "series"].map(isLibraryKind)).toEqual([true, true, true]);
    expect([true, "Book", "game", null].map(isLibraryKind)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(
      ["planned", "in-progress", "done", "dropped"].map(isLibraryStatus),
    ).toEqual([true, true, true, true]);
    expect(["Planed", "", null, 3].map(isLibraryStatus)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("the numeric gates", () => {
  it("holds a rating to whole numbers inside 1..10", () => {
    expect(isLibraryRating(1)).toBe(true);
    expect(isLibraryRating(LIBRARY_MAX_RATING)).toBe(true);
    expect(isLibraryRating(0)).toBe(false);
    expect(isLibraryRating(11)).toBe(false);
    // A half point is not a rating on a ten-point scale with no halves.
    expect(isLibraryRating(7.5)).toBe(false);
    expect(isLibraryRating(Number.NaN)).toBe(false);
  });

  it("holds a year to 1..9999 and refuses a negative one", () => {
    expect(isLibraryYear(1)).toBe(true);
    expect(isLibraryYear(LIBRARY_MAX_YEAR)).toBe(true);
    expect(isLibraryYear(0)).toBe(false);
    expect(isLibraryYear(-44)).toBe(false);
    expect(isLibraryYear(2026.5)).toBe(false);
  });

  it("separates a count that must be positive from pages read, which may be zero", () => {
    expect(isLibraryCount(1)).toBe(true);
    expect(isLibraryCount(LIBRARY_MAX_COUNT)).toBe(true);
    expect(isLibraryCount(0)).toBe(false);
    expect(isLibraryCount(LIBRARY_MAX_COUNT + 1)).toBe(false);
    expect(isLibraryReadPages(0)).toBe(true);
    expect(isLibraryReadPages(LIBRARY_MAX_COUNT)).toBe(true);
    expect(isLibraryReadPages(-1)).toBe(false);
  });
});

describe("isLibraryDay", () => {
  it("accepts a real calendar day and refuses a rolled-over one", () => {
    expect(isLibraryDay("2026-03-14")).toBe(true);
    expect(isLibraryDay("2024-02-29")).toBe(true);
    // The three a naive `Date.parse` accepts by rolling them forward.
    expect(isLibraryDay("2026-02-30")).toBe(false);
    expect(isLibraryDay("2026-13-01")).toBe(false);
    expect(isLibraryDay("2026-04-31")).toBe(false);
    expect(isLibraryDay("2026-3-14")).toBe(false);
    expect(isLibraryDay("2026-03-14T00:00:00.000Z")).toBe(false);
    expect(isLibraryDay(20260314)).toBe(false);
  });
});

describe("isLibraryTimestamp", () => {
  it("accepts an ISO-8601 date-time and nothing looser", () => {
    expect(isLibraryTimestamp("2026-10-09T08:30:00.000Z")).toBe(true);
    expect(isLibraryTimestamp("2026-10-09T08:30Z")).toBe(true);
    expect(isLibraryTimestamp("2026-10-09")).toBe(false);
    expect(isLibraryTimestamp("2026-10-09 08:30:00")).toBe(false);
  });
});

describe("isWikidataId", () => {
  it("accepts Q plus a positive integer, and no leading zero", () => {
    expect(isWikidataId("Q42")).toBe(true);
    expect(isWikidataId("Q7243")).toBe(true);
    expect(isWikidataId("Q0")).toBe(false);
    expect(isWikidataId("Q042")).toBe(false);
    expect(isWikidataId("q42")).toBe(false);
    expect(isWikidataId("42")).toBe(false);
    expect(isWikidataId("Q42a")).toBe(false);
  });
});

describe("validateLibraryCreators", () => {
  it("trims, drops empty entries, and keeps the order given", () => {
    expect(validateLibraryCreators(["  Lav Tolstoj ", "", "  ", "Sofija Tolstaja"])).toEqual([
      "Lav Tolstoj",
      "Sofija Tolstaja",
    ]);
  });

  it("collapses an EXACT duplicate but keeps two people who share a surname", () => {
    expect(validateLibraryCreators(["Džonatan Franzen", "Džonatan Franzen"])).toEqual([
      "Džonatan Franzen",
    ]);
    expect(validateLibraryCreators(["Lav Tolstoj", "Sofija Tolstaja"])).toHaveLength(2);
  });

  it("refuses a name over the length bound, a bound-exceeding count, and non-strings", () => {
    expect(validateLibraryCreators(["x".repeat(LIBRARY_MAX_CREATOR_LENGTH + 1)])).toBeNull();
    expect(
      validateLibraryCreators(Array.from({ length: LIBRARY_MAX_CREATORS + 1 }, (_, i) => `A${i}`)),
    ).toBeNull();
    expect(validateLibraryCreators(["Lav Tolstoj", 3])).toBeNull();
    expect(validateLibraryCreators("Lav Tolstoj")).toBeNull();
  });

  it("accepts an empty list — an unknown author is not an error", () => {
    expect(validateLibraryCreators([])).toEqual([]);
  });
});

describe("validateLibraryTags", () => {
  it("folds case for the duplicate test and keeps the first spelling", () => {
    // „Teretana" and „teretana" are one tag to a person; two rows a filter would
    // treat as one is the „two spellings of one thing" defect.
    expect(validateLibraryTags(["Teretana", "teretana", "TERETANA"])).toEqual(["Teretana"]);
    expect(validateLibraryTags([" klasika ", "Klasika"])).toEqual(["klasika"]);
  });

  it("refuses a tag over the length bound, a bound-exceeding count, and a non-string", () => {
    expect(validateLibraryTags(["x".repeat(LIBRARY_MAX_TAG_LENGTH + 1)])).toBeNull();
    expect(
      validateLibraryTags(Array.from({ length: LIBRARY_MAX_TAGS + 1 }, (_, i) => `t${i}`)),
    ).toBeNull();
    expect(validateLibraryTags([null])).toBeNull();
  });

  it("drops the blank row a form leaves behind", () => {
    expect(validateLibraryTags(["", "  ", "klasika"])).toEqual(["klasika"]);
  });
});

describe("serializeLibraryList", () => {
  it("writes one JSON array in the order given, for creators and tags alike", () => {
    expect(serializeLibraryList(["a", "b"])).toBe('["a","b"]');
    expect(serializeLibraryList([])).toBe("[]");
  });
});

describe("validateLibraryProgress", () => {
  it("accepts a book with pages and no series fields", () => {
    expect(
      validateLibraryProgress("book", { ...EMPTY, pagesRead: 120, pagesTotal: 400 }),
    ).toEqual([]);
  });

  it("accepts a series whose season and episode sit inside their totals", () => {
    expect(
      validateLibraryProgress("series", {
        ...EMPTY,
        season: 3,
        episode: 7,
        seasonsTotal: 5,
        episodesTotal: 62,
      }),
    ).toEqual([]);
  });

  it("names every series field a book carries", () => {
    expect(
      validateLibraryProgress("book", { ...EMPTY, season: 1, episodesTotal: 10 }),
    ).toEqual(["season", "episodesTotal"]);
  });

  it("names both page fields on a film, which has no progress at all", () => {
    expect(validateLibraryProgress("film", { ...EMPTY, pagesRead: 3 })).toEqual(["pagesRead"]);
    expect(validateLibraryProgress("film", { ...EMPTY, pagesTotal: 3 })).toEqual(["pagesTotal"]);
  });

  it("names the COUNT, not the total, when a count passes its total", () => {
    expect(
      validateLibraryProgress("book", { ...EMPTY, pagesRead: 401, pagesTotal: 400 }),
    ).toEqual(["pagesRead"]);
    expect(
      validateLibraryProgress("series", { ...EMPTY, season: 6, seasonsTotal: 5 }),
    ).toEqual(["season"]);
    expect(
      validateLibraryProgress("series", { ...EMPTY, episode: 63, episodesTotal: 62 }),
    ).toEqual(["episode"]);
  });

  it("accepts a count with no total to compare it against", () => {
    expect(validateLibraryProgress("book", { ...EMPTY, pagesRead: 401 })).toEqual([]);
    expect(validateLibraryProgress("series", { ...EMPTY, episode: 63 })).toEqual([]);
  });
});

describe("deriveLibraryStatusFromPass", () => {
  it("marks a finished pass as done, whatever the item said before", () => {
    expect(
      deriveLibraryStatusFromPass(
        { startedOn: "2026-03-01", finishedOn: "2026-03-20", rating: 8 },
        "planned",
      ),
    ).toBe("done");
    expect(
      deriveLibraryStatusFromPass(
        { startedOn: null, finishedOn: "2026-03-20", rating: null },
        "dropped",
      ),
    ).toBe("done");
  });

  it("marks a started-but-unfinished pass as in-progress", () => {
    expect(
      deriveLibraryStatusFromPass(
        { startedOn: "2026-03-01", finishedOn: null, rating: null },
        "done",
      ),
    ).toBe("in-progress");
  });

  it("leaves the status alone when the latest pass records no date, or when there is no pass", () => {
    expect(
      deriveLibraryStatusFromPass({ startedOn: null, finishedOn: null, rating: 9 }, "planned"),
    ).toBe("planned");
    expect(deriveLibraryStatusFromPass(null, "dropped")).toBe("dropped");
  });
});

describe("deriveLibraryRatingFromPass", () => {
  it("takes the latest pass's rating when it carries one", () => {
    expect(
      deriveLibraryRatingFromPass({ startedOn: null, finishedOn: null, rating: 9 }, 4),
    ).toBe(9);
  });

  it("leaves the item's rating standing when the pass carries none, or there is no pass", () => {
    expect(
      deriveLibraryRatingFromPass({ startedOn: null, finishedOn: null, rating: null }, 7),
    ).toBe(7);
    expect(deriveLibraryRatingFromPass(null, 7)).toBe(7);
    expect(deriveLibraryRatingFromPass(null, null)).toBeNull();
  });
});
