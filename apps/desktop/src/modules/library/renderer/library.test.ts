import { describe, expect, it } from "vitest";
import type { LibraryItemView } from "../shared/ipc.js";
import {
  KIND_ICONS,
  NO_FILTER,
  blankToNull,
  formatDay,
  formatListField,
  formatProgress,
  formatRating,
  itemDraftOf,
  latestPass,
  latestPassDates,
  localDayKey,
  matchesFilter,
  moveNeighbours,
  parseListField,
  readCount,
  readItemDraft,
  suggestionItemMeta,
  suggestionTitle,
  visibleItems,
} from "./library.js";

/**
 * BIBLIOTEKA's page arithmetic, with exact expected values.
 *
 * The `Intl` expectations were MEASURED on this machine before they were
 * written down - `new Intl.DateTimeFormat(["sr-Latn","sr"], {...}).format(...)`
 * is `12. mar 2026.` and the English one is `12 Mar 2026`, and Serbian groups a
 * thousand as `1.000` where English writes `1,000` - because a test that asserts
 * what the author hoped the locale does is a test of the author, and the whole
 * point of routing every number and date through `Intl` is that these strings
 * are not ours to choose.
 */

/** One work, with everything the page reads - overridden field by field. */
function item(overrides: Partial<LibraryItemView> = {}): LibraryItemView {
  return {
    id: "item-1",
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
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-06-01T08:00:00.000Z",
    passes: [],
    thoughts: [],
    ...overrides,
  };
}

function pass(seq: number, startedOn: string | null, finishedOn: string | null) {
  return {
    id: `pass-${seq}`,
    seq,
    startedOn,
    finishedOn,
    rating: null,
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-06-01T08:00:00.000Z",
  };
}

const UNITS = { pages: "str.", episodes: "ep." };

describe("KIND_ICONS", () => {
  it("names a glyph for each of the three kinds, and the book is the module's own mark", () => {
    expect(KIND_ICONS).toEqual({ book: "book", film: "play", series: "list" });
  });
});

describe("the latest pass", () => {
  it("is the one with the greatest seq, not the last in the array", () => {
    // The store returns passes oldest first today; reading the array's last
    // element would be a second answer, and this pins that the two agree only
    // because seq is what decides.
    const work = item({
      passes: [pass(3, null, "2026-06-03"), pass(1, "2026-06-01", null), pass(2, "2026-06-02", null)],
    });
    expect(latestPass(work)?.seq).toBe(3);
    expect(latestPassDates(work)).toEqual({ startedOn: null, finishedOn: "2026-06-03" });
  });

  it("is null for a work nobody has read yet", () => {
    expect(latestPass(item())).toBeNull();
    expect(latestPassDates(item())).toEqual({ startedOn: null, finishedOn: null });
  });
});

describe("formatProgress", () => {
  it("writes a book's pages read against its total, and groups digits the Serbian way", () => {
    expect(formatProgress(item({ pagesRead: 120, pagesTotal: 320 }), "sr", UNITS)).toBe(
      "120 / 320 str.",
    );
    expect(
      formatProgress(item({ pagesRead: 120, pagesTotal: 320 }), "en", {
        pages: "p.",
        episodes: "ep.",
      }),
    ).toBe("120 / 320 p.");
    // 1 240 pages: Serbian groups with a full stop, English with a comma.
    expect(formatProgress(item({ pagesRead: 1000, pagesTotal: 1240 }), "sr", UNITS)).toBe(
      "1.000 / 1.240 str.",
    );
    expect(
      formatProgress(item({ pagesRead: 1000, pagesTotal: 1240 }), "en", {
        pages: "p.",
        episodes: "ep.",
      }),
    ).toBe("1,000 / 1,240 p.");
  });

  it("shows the half it has when only one number is recorded, and nothing when neither is", () => {
    expect(formatProgress(item({ pagesRead: 40 }), "sr", UNITS)).toBe("40 str.");
    expect(formatProgress(item({ pagesTotal: 320 }), "sr", UNITS)).toBe("320 str.");
    expect(formatProgress(item(), "sr", UNITS)).toBeNull();
  });

  it("writes a series' season and episode, with the total when it is known", () => {
    expect(formatProgress(item({ kind: "series", season: 2, episode: 5 }), "sr", UNITS)).toBe(
      "S2 E5",
    );
    expect(
      formatProgress(item({ kind: "series", season: 2, episode: 5, episodesTotal: 24 }), "sr", UNITS),
    ).toBe("S2 E5 / 24 ep.");
    expect(formatProgress(item({ kind: "series", episode: 5 }), "sr", UNITS)).toBe("E5");
    expect(formatProgress(item({ kind: "series" }), "sr", UNITS)).toBeNull();
  });

  it("is null for a film, which has no progress columns at all", () => {
    expect(formatProgress(item({ kind: "film", pagesRead: 10 }), "sr", UNITS)).toBeNull();
  });
});

describe("formatRating", () => {
  it("writes the rating out of ten, and nothing when there is none", () => {
    expect(formatRating(8, "sr")).toBe("8/10");
    expect(formatRating(10, "en")).toBe("10/10");
    expect(formatRating(null, "sr")).toBeNull();
  });
});

describe("formatDay", () => {
  it("reads a bare day in the active locale, in UTC", () => {
    expect(formatDay("2026-03-12", "sr")).toBe("12. mar 2026.");
    expect(formatDay("2026-03-12", "en")).toBe("12 Mar 2026");
    expect(formatDay(null, "sr")).toBeNull();
  });

  it("hands back what it cannot read rather than a wrong date", () => {
    expect(formatDay("nije-dan", "sr")).toBe("nije-dan");
  });
});

describe("localDayKey", () => {
  it("writes today as the local calendar day, which is what the store's day columns hold", () => {
    // 2026-06-01T23:30 local time: the day is the 1st, however UTC sees it - a
    // `toISOString()` would be the 1st here and the 31st for a machine east of
    // UTC, which is the bug this exists to avoid.
    expect(localDayKey(new Date(2026, 5, 1, 23, 30))).toBe("2026-06-01");
    expect(localDayKey(new Date(2026, 0, 9, 0, 5))).toBe("2026-01-09");
  });
});

describe("the form's field readings", () => {
  it("splits a names field on commas and semicolons, trimming and dropping the blanks", () => {
    expect(parseListField(" Ivo Andrić , Slobodan Šijan ")).toEqual([
      "Ivo Andrić",
      "Slobodan Šijan",
    ]);
    expect(parseListField("a;b,,c,")).toEqual(["a", "b", "c"]);
    expect(parseListField("   ")).toEqual([]);
    expect(formatListField(["a", "b"])).toBe("a, b");
  });

  it("turns an empty field into null, which is how the wire says „clear this“", () => {
    expect(blankToNull("   ")).toBeNull();
    expect(blankToNull(" Tekst ")).toBe("Tekst");
  });

  it("keeps „cleared“ and „typed wrong“ apart", () => {
    expect(readCount("", 1, 10)).toEqual({ ok: true, value: null });
    expect(readCount(" 7 ", 1, 10)).toEqual({ ok: true, value: 7 });
    expect(readCount("0", 0, 100_000)).toEqual({ ok: true, value: 0 });
    expect(readCount("11", 1, 10)).toEqual({ ok: false });
    expect(readCount("-1", 0, 100_000)).toEqual({ ok: false });
    expect(readCount("3.5", 1, 10)).toEqual({ ok: false });
    expect(readCount("abc", 1, 10)).toEqual({ ok: false });
    expect(readCount("7a", 1, 10)).toEqual({ ok: false });
  });
});

describe("the item form", () => {
  it("opens on the stored values, spelled as the fields show them", () => {
    const draft = itemDraftOf(
      item({
        title: "Na Drini ćuprija",
        originalTitle: "The Bridge on the Drina",
        creators: ["Ivo Andrić"],
        year: 1945,
        status: "done",
        rating: 9,
        pagesRead: 320,
        pagesTotal: 320,
        tags: ["klasik"],
        summary: "Most.",
      }),
    );
    expect(draft).toEqual({
      title: "Na Drini ćuprija",
      originalTitle: "The Bridge on the Drina",
      creators: "Ivo Andrić",
      year: "1945",
      status: "done",
      rating: "9",
      pagesRead: "320",
      pagesTotal: "320",
      season: "",
      episode: "",
      seasonsTotal: "",
      episodesTotal: "",
      tags: "klasik",
      summary: "Most.",
    });
  });

  it("reads a complete draft into the wire's fields, and empties what was left blank", () => {
    const reading = readItemDraft({
      title: "  Na Drini ćuprija  ",
      originalTitle: "",
      creators: "Ivo Andrić, ",
      year: "1945",
      status: "done",
      rating: "",
      pagesRead: "320",
      pagesTotal: "320",
      season: "",
      episode: "",
      seasonsTotal: "",
      episodesTotal: "",
      tags: "klasik; lektira",
      summary: "   ",
    });
    expect(reading).toEqual({
      ok: true,
      fields: {
        title: "Na Drini ćuprija",
        originalTitle: null,
        creators: ["Ivo Andrić"],
        year: 1945,
        status: "done",
        rating: null,
        pagesRead: 320,
        pagesTotal: 320,
        season: null,
        episode: null,
        seasonsTotal: null,
        episodesTotal: null,
        tags: ["klasik", "lektira"],
        summary: null,
      },
    });
  });

  it("refuses the WHOLE draft when one number cannot be read, rather than clearing it", () => {
    const base = {
      title: "A",
      originalTitle: "",
      creators: "",
      year: "",
      status: "planned" as const,
      rating: "",
      pagesRead: "",
      pagesTotal: "",
      season: "",
      episode: "",
      seasonsTotal: "",
      episodesTotal: "",
      tags: "",
      summary: "",
    };
    expect(readItemDraft(base)).toEqual({
      ok: true,
      fields: {
        title: "A",
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
      },
    });
    expect(readItemDraft({ ...base, pagesRead: "mnogo" })).toEqual({ ok: false });
    expect(readItemDraft({ ...base, title: "   " })).toEqual({ ok: false });
    expect(readItemDraft({ ...base, rating: "11" })).toEqual({ ok: false });
  });
});

describe("the filter", () => {
  const works = [
    item({ id: "1", title: "Čića Gorio", creators: ["Ivo Andrić"], status: "done" }),
    item({ id: "2", kind: "film", title: "The Great Gatsby", year: 1974, status: "planned" }),
    item({ id: "3", title: "Otpisani", tags: ["retro"], status: "dropped" }),
  ];

  it("matches a title the way the store's own adoption matches one", () => {
    // No diacritics, lower case, and the English article dropped: all three are
    // `normalizeLibraryTitle`'s own folds, so the page's search and the pack
    // adoption cannot disagree about whether two titles are the same.
    expect(works.filter((work) => matchesFilter(work, { ...NO_FILTER, query: "cica gorio" }))).toEqual([
      works[0],
    ]);
    expect(works.filter((work) => matchesFilter(work, { ...NO_FILTER, query: "great gatsby" }))).toEqual([
      works[1],
    ]);
    expect(works.filter((work) => matchesFilter(work, { ...NO_FILTER, query: "andric" }))).toEqual([
      works[0],
    ]);
    expect(works.filter((work) => matchesFilter(work, { ...NO_FILTER, query: "retro" }))).toEqual([
      works[2],
    ]);
  });

  it("treats a punctuation-only query as no query at all, and filters by kind and status", () => {
    expect(works.filter((work) => matchesFilter(work, { ...NO_FILTER, query: "!!!" }))).toEqual(works);
    expect(works.filter((work) => matchesFilter(work, { ...NO_FILTER, kind: "film" }))).toEqual([
      works[1],
    ]);
    expect(works.filter((work) => matchesFilter(work, { ...NO_FILTER, status: "dropped" }))).toEqual([
      works[2],
    ]);
    expect(works.filter((work) => matchesFilter(work, { ...NO_FILTER, kind: "film", status: "done" }))).toEqual(
      [],
    );
  });

  it("orders the filtered list with the store's own comparator", () => {
    // Ascending, sr-Latn: the collator places Č with C rather than after Z, so
    // the order is Čića, Otpisani, The Great Gatsby - which is the whole reason
    // `Intl.Collator(["sr-Latn", "sr"])` is the one comparator here.
    expect(visibleItems(works, NO_FILTER, "title").map((work) => work.title)).toEqual([
      "Čića Gorio",
      "Otpisani",
      "The Great Gatsby",
    ]);
    // And „by activity“ is descending on `updatedAt`, which every fixture shares.
    expect(visibleItems(works, NO_FILTER, "activity").map((work) => work.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(visibleItems(works, { ...NO_FILTER, query: "otpisani" }, "title")).toHaveLength(1);
  });
});

describe("moveNeighbours", () => {
  const ids = ["a", "b", "c"];

  it("names the two neighbours a row moves between, either of them null at an end", () => {
    expect(moveNeighbours(ids, "c", -1)).toEqual({ beforeId: "a", afterId: "b" });
    expect(moveNeighbours(ids, "a", 1)).toEqual({ beforeId: "b", afterId: "c" });
    expect(moveNeighbours(ids, "b", -1)).toEqual({ beforeId: null, afterId: "a" });
    expect(moveNeighbours(ids, "b", 1)).toEqual({ beforeId: "c", afterId: null });
  });

  it("answers null for a row already at that end, or not in the collection at all", () => {
    expect(moveNeighbours(ids, "a", -1)).toBeNull();
    expect(moveNeighbours(ids, "c", 1)).toBeNull();
    expect(moveNeighbours(ids, "ghost", 1)).toBeNull();
  });
});

describe("a suggested collection's titles", () => {
  it("shows the language being read, and the other one where that half is missing", () => {
    expect(suggestionTitle({ sr: "Otpisani", en: "The Written Off" }, "sr")).toBe("Otpisani");
    expect(suggestionTitle({ sr: "Otpisani", en: "The Written Off" }, "en")).toBe("The Written Off");
    expect(suggestionTitle({ sr: null, en: "Who's Singin' Over There?" }, "sr")).toBe(
      "Who's Singin' Over There?",
    );
    expect(suggestionTitle({ sr: "Otpisani", en: null }, "en")).toBe("Otpisani");
  });

  it("writes a suggested work's line as its year and then its creators", () => {
    const entry = { kind: "book" as const, title: { sr: "X", en: "X" }, year: 1945, creators: ["Ivo Andrić"], wikidataId: null };
    expect(suggestionItemMeta(entry, "sr", "godina nepoznata")).toBe("1945 · Ivo Andrić");
    expect(suggestionItemMeta({ ...entry, year: null }, "sr", "godina nepoznata")).toBe(
      "godina nepoznata · Ivo Andrić",
    );
    expect(suggestionItemMeta({ ...entry, creators: [] }, "sr", "godina nepoznata")).toBe("1945");
  });
});
