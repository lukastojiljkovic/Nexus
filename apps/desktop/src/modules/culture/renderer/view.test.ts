import { describe, expect, it } from "vitest";
import type { CultureArtWorkView, CulturePlanView, CultureVisitView } from "../shared/ipc.js";
import {
  EMPTY_ART_FILTER,
  EMPTY_VISIT_FILTER,
  artCenturyOf,
  bareDayOf,
  cellDay,
  distinctValues,
  filterArtWorks,
  filterVisits,
  monthGrid,
  parsePrice,
  parseRating,
  pastPlans,
  plansAwaitingAnswer,
  queueOrder,
  stepQueue,
  upcomingPlans,
  visitsPerDay,
  visitsPerVenue,
  yearOf,
} from "./view.js";

/**
 * The page's arithmetic, with every expected value worked out by hand.
 *
 * The calendars are the half worth stating: February 2026 begins on a Sunday, so
 * a Monday-first grid opens with SIX blanks and then the 28th falls on the last
 * cell of the fourth row - which the assertions below spell out rather than
 * describing as "some cells".
 */

function visit(overrides: Partial<CultureVisitView> = {}): CultureVisitView {
  return {
    id: "v1",
    kind: "museum",
    title: "Tesla",
    venue: "Narodni muzej",
    venueId: "m1",
    city: "Beograd",
    date: "2026-06-01",
    startTime: null,
    rating: null,
    notes: "",
    price: null,
    companions: null,
    photos: [],
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-06-01T08:00:00.000Z",
    ...overrides,
  };
}

function plan(overrides: Partial<CulturePlanView> = {}): CulturePlanView {
  return {
    id: "p1",
    kind: "theatre",
    title: "Hamlet",
    venue: "Narodno pozorište",
    venueId: null,
    city: "Beograd",
    date: "2026-07-01",
    startTime: null,
    link: null,
    notes: "",
    visitId: null,
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-06-01T08:00:00.000Z",
    ...overrides,
  };
}

function work(overrides: Partial<CultureArtWorkView> = {}): CultureArtWorkView {
  return {
    id: "w1",
    title: "Portret",
    artist: "Nepoznati autor",
    date: "1850",
    medium: null,
    museum: "Narodni muzej",
    credit: "Narodni muzej",
    licence: "CC0-1.0",
    packId: "art-test",
    version: "1.0.0",
    image: "images/portret.jpg",
    width: 800,
    height: 1000,
    ...overrides,
  };
}

describe("filterVisits", () => {
  const visits = [
    visit({ id: "a", date: "2026-06-01", kind: "museum", venueId: "m1" }),
    visit({ id: "b", date: "2026-06-05", kind: "theatre", venueId: "m2", title: "Hamlet" }),
    visit({ id: "c", date: "2026-06-05", kind: "opera", venueId: "m1", title: "Aida" }),
  ];

  it("leaves everything, newest first, with no filter at all", () => {
    expect(filterVisits(visits, EMPTY_VISIT_FILTER).map((row) => row.id)).toEqual(["c", "b", "a"]);
  });

  it("narrows by kind and by place", () => {
    expect(
      filterVisits(visits, { ...EMPTY_VISIT_FILTER, kind: "theatre" }).map((row) => row.id),
    ).toEqual(["b"]);
    expect(
      filterVisits(visits, { ...EMPTY_VISIT_FILTER, venueId: "m1" }).map((row) => row.id),
    ).toEqual(["c", "a"]);
  });

  it("folds the query, so a Serbian word may be typed without its diacritics", () => {
    expect(
      filterVisits(visits, { ...EMPTY_VISIT_FILTER, query: "pozoriste" }).map((row) => row.id),
    ).toEqual([]);
    expect(
      filterVisits(visits, { ...EMPTY_VISIT_FILTER, query: "beograd" }).map((row) => row.id),
    ).toEqual(["c", "b", "a"]);
    expect(
      filterVisits(visits, { ...EMPTY_VISIT_FILTER, query: "aida" }).map((row) => row.id),
    ).toEqual(["c"]);
  });

  it("searches the notes and the people, not only the title", () => {
    const withNote = [visit({ id: "n", notes: "Kustos je pričao o Nikoli Tesli." })];
    expect(filterVisits(withNote, { ...EMPTY_VISIT_FILTER, query: "kustos" })).toHaveLength(1);
    const withPeople = [visit({ id: "o", companions: "Ana i Marko" })];
    expect(filterVisits(withPeople, { ...EMPTY_VISIT_FILTER, query: "marko" })).toHaveLength(1);
  });
});

describe("the counts a row and a calendar cell read", () => {
  it("counts visits per place, and none for a visit with no link", () => {
    const counts = visitsPerVenue([
      visit({ id: "a", venueId: "m1" }),
      visit({ id: "b", venueId: "m1" }),
      visit({ id: "c", venueId: null }),
    ]);
    expect([...counts]).toEqual([["m1", 2]]);
  });

  it("counts visits per day", () => {
    const counts = visitsPerDay([
      visit({ id: "a", date: "2026-06-01" }),
      visit({ id: "b", date: "2026-06-01" }),
      visit({ id: "c", date: "2026-06-02" }),
    ]);
    expect(counts.get("2026-06-01")).toBe(2);
    expect(counts.get("2026-06-02")).toBe(1);
    expect(counts.get("2026-06-03")).toBeUndefined();
  });
});

describe("the calendar's arithmetic", () => {
  it("reads a bare day, and today in the machine's own zone", () => {
    expect(yearOf("2026-06-01")).toBe(2026);
    expect(yearOf("2026-6-1")).toBeNull();
    expect(yearOf("")).toBeNull();
    expect(bareDayOf(new Date(2026, 5, 1, 23, 30))).toBe("2026-06-01");
    expect(bareDayOf(new Date(2026, 0, 9, 0, 0))).toBe("2026-01-09");
  });

  it("draws February 2026 Monday-first: six blanks, then 1..28", () => {
    // 2026-02-01 is a Sunday, so the first six cells (Mon..Sat) are empty.
    expect(monthGrid(2026, 2).slice(0, 8)).toEqual([null, null, null, null, null, null, 1, 2]);
    expect(monthGrid(2026, 2).filter((cell) => cell !== null)).toHaveLength(28);
    expect(monthGrid(2026, 2)).toHaveLength(35);
    expect(monthGrid(2026, 2).at(-1)).toBeNull();
  });

  it("draws June 2026 starting on the first cell, because the 1st is a Monday", () => {
    expect(monthGrid(2026, 6).slice(0, 3)).toEqual([1, 2, 3]);
    expect(monthGrid(2026, 6).filter((cell) => cell !== null)).toHaveLength(30);
    expect(monthGrid(2026, 6)).toHaveLength(35);
  });

  it("names the day a cell stands for, zero-padded", () => {
    expect(cellDay(2026, 6, 1)).toBe("2026-06-01");
    expect(cellDay(2026, 12, 31)).toBe("2026-12-31");
    expect(cellDay(2026, 6, null)).toBeNull();
  });
});

describe("the programme's lists", () => {
  const plans = [
    plan({ id: "past", date: "2026-05-30" }),
    plan({ id: "today", date: "2026-06-01" }),
    plan({ id: "next", date: "2026-07-01" }),
    plan({ id: "answered", date: "2026-05-01", visitId: "v9" }),
  ];

  it("splits ahead from past, each in the order it is read in", () => {
    expect(upcomingPlans(plans, "2026-06-01").map((row) => row.id)).toEqual(["today", "next"]);
    // Past, most recent first; the day itself counts as ahead, not past.
    expect(pastPlans(plans, "2026-06-01").map((row) => row.id)).toEqual(["past", "answered"]);
  });

  it("asks only about past plans that have not answered", () => {
    expect(plansAwaitingAnswer(plans, "2026-06-01").map((row) => row.id)).toEqual(["past"]);
  });
});

describe("the player's queue", () => {
  it("plays the playlist's own order when one is chosen, the library's otherwise", () => {
    expect(queueOrder(["a", "b", "c"], null)).toEqual(["a", "b", "c"]);
    expect(queueOrder(["a", "b", "c"], ["c", "a"])).toEqual(["c", "a"]);
  });

  it("steps forward and back, stops at the end, and wraps only when told to", () => {
    expect(stepQueue(["a", "b", "c"], "a", 1, false)).toBe("b");
    expect(stepQueue(["a", "b", "c"], "c", 1, false)).toBeNull();
    expect(stepQueue(["a", "b", "c"], "c", 1, true)).toBe("a");
    expect(stepQueue(["a", "b", "c"], "a", -1, false)).toBeNull();
    expect(stepQueue(["a", "b", "c"], "a", -1, true)).toBe("c");
    // A track that has just been deleted starts the queue from its near end.
    expect(stepQueue(["a", "b", "c"], "gone", 1, false)).toBe("a");
    expect(stepQueue(["a", "b", "c"], "gone", -1, false)).toBe("c");
    expect(stepQueue([], "a", 1, false)).toBeNull();
  });
});

describe("the arts guide", () => {
  const works = [
    work({ id: "a", artist: "Nepoznati autor", date: "1850", museum: "Narodni muzej" }),
    work({ id: "b", artist: "Paja Jovanović", date: "1900", museum: "Narodni muzej" }),
    work({ id: "c", artist: "Paja Jovanović", date: "17th century", museum: "Galerija" }),
  ];

  it("reads a century out of a date that carries a year, and refuses to guess otherwise", () => {
    expect(artCenturyOf("1850")).toBe(19);
    // 1900 is the 19th century and 2001 the 21st: the rule is not `year / 100`.
    expect(artCenturyOf("1900")).toBe(19);
    expect(artCenturyOf("2001")).toBe(21);
    expect(artCenturyOf("c. 1650")).toBe(17);
    expect(artCenturyOf("1650-1660")).toBe(17);
    expect(artCenturyOf("17th century")).toBeNull();
    expect(artCenturyOf("")).toBeNull();
  });

  it("narrows by artist, museum, century and a folded query", () => {
    expect(filterArtWorks(works, EMPTY_ART_FILTER).map((each) => each.id)).toEqual(["a", "b", "c"]);
    expect(
      filterArtWorks(works, { ...EMPTY_ART_FILTER, artist: "Paja Jovanović" }).map((each) => each.id),
    ).toEqual(["b", "c"]);
    expect(
      filterArtWorks(works, { ...EMPTY_ART_FILTER, museum: "Galerija" }).map((each) => each.id),
    ).toEqual(["c"]);
    expect(
      filterArtWorks(works, { ...EMPTY_ART_FILTER, century: 19 }).map((each) => each.id),
    ).toEqual(["a", "b"]);
    // `null` is the bucket for the works with no year at all, not "any".
    expect(
      filterArtWorks(works, { ...EMPTY_ART_FILTER, century: null }).map((each) => each.id),
    ).toEqual(["c"]);
    expect(
      filterArtWorks(works, { ...EMPTY_ART_FILTER, query: "paja" }).map((each) => each.id),
    ).toEqual(["b", "c"]);
  });

  it("collects the distinct values and orders them the way a Serbian reader reads them", () => {
    const collator = new Intl.Collator(["sr-Latn", "sr"]);
    expect(distinctValues(works, (each) => each.artist, collator)).toEqual([
      "Nepoznati autor",
      "Paja Jovanović",
    ]);
  });
});

describe("the two fields a form has to turn into a value", () => {
  it("reads a rating, and refuses anything that is not one to ten", () => {
    expect(parseRating("8")).toBe(8);
    expect(parseRating(" 10 ")).toBe(10);
    expect(parseRating("")).toBeNull();
    expect(parseRating("0")).toBeNull();
    expect(parseRating("11")).toBeNull();
    expect(parseRating("8,5")).toBeNull();
    expect(parseRating("osam")).toBeNull();
  });

  it("reads a price the way the Serbian form writes it, and refuses half a price", () => {
    expect(parsePrice("12,50", "rsd")).toEqual({ minorUnits: 1250, currency: "RSD" });
    expect(parsePrice("12.5", "EUR")).toEqual({ minorUnits: 1250, currency: "EUR" });
    expect(parsePrice("1200", "RSD")).toEqual({ minorUnits: 120_000, currency: "RSD" });
    expect(parsePrice("", "")).toBeNull();
    expect(parsePrice("12", "")).toBeNull();
    expect(parsePrice("", "RSD")).toBeNull();
    expect(parsePrice("12,555", "RSD")).toBeNull();
    expect(parsePrice("besplatno", "RSD")).toBeNull();
  });
});
