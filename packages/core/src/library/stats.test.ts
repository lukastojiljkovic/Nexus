import { describe, expect, it } from "vitest";
import { libraryYearStats } from "./stats.js";
import type { LibraryStatsItem, LibraryStatsPass } from "./stats.js";

const ITEMS: readonly LibraryStatsItem[] = [
  { id: "b1", kind: "book", pagesTotal: 400 },
  { id: "b2", kind: "book", pagesTotal: null },
  { id: "f1", kind: "film", pagesTotal: null },
  { id: "s1", kind: "series", pagesTotal: null },
];

const PASSES: readonly LibraryStatsPass[] = [
  // b1 finished twice in 2026 — a re-read — so it counts once as an item while
  // both finishes carry a rating.
  { itemId: "b1", finishedOn: "2026-03-20", rating: 9 },
  { itemId: "b1", finishedOn: "2026-09-01", rating: 6 },
  // b2 has no page total to contribute, and was rated.
  { itemId: "b2", finishedOn: "2026-05-01", rating: 7 },
  // f1 finished in 2026 without a rating.
  { itemId: "f1", finishedOn: "2026-01-10", rating: null },
  // s1 finished in a DIFFERENT year, and must not appear in 2026's report.
  { itemId: "s1", finishedOn: "2025-12-31", rating: 10 },
];

describe("libraryYearStats", () => {
  /**
   * The 2026 figures, worked out by hand from the two fixtures above:
   *   finished   b1 (book) + b2 (book) + f1 (film)  ⇒ book 2, film 1, series 0
   *   pagesRead  only b1 has a total (400)          ⇒ 400 over 1 book
   *   ratings    9, 6 (both b1 passes) and 7        ⇒ 22 / 3
   */
  it("reports the year's figures from the passes and the items", () => {
    const stats = libraryYearStats(ITEMS, PASSES, 2026);
    expect(stats.finished).toEqual({ book: 2, film: 1, series: 0 });
    expect(stats.pagesRead).toBe(400);
    expect(stats.pagesCounted).toBe(1);
    expect(stats.ratedPasses).toBe(3);
    expect(stats.averageRating).toBe(22 / 3);
  });

  it("counts an item finished in another year not at all", () => {
    const stats = libraryYearStats(ITEMS, PASSES, 2025);
    expect(stats.finished).toEqual({ book: 0, film: 0, series: 1 });
    expect(stats.pagesRead).toBe(0);
    expect(stats.averageRating).toBe(10);
    expect(stats.ratedPasses).toBe(1);
  });

  it("answers zeros and a null average for a year nothing finished in", () => {
    const stats = libraryYearStats(ITEMS, PASSES, 2024);
    expect(stats).toEqual({
      year: 2024,
      finished: { book: 0, film: 0, series: 0 },
      pagesRead: 0,
      pagesCounted: 0,
      averageRating: null,
      ratedPasses: 0,
    });
  });

  it("leaves out a pass whose item the caller did not put in scope", () => {
    const stats = libraryYearStats([], PASSES, 2026);
    expect(stats.finished).toEqual({ book: 0, film: 0, series: 0 });
    expect(stats.averageRating).toBeNull();
  });

  it("counts an unfinished pass nowhere", () => {
    const unfinished: readonly LibraryStatsPass[] = [
      { itemId: "b1", finishedOn: null, rating: 9 },
    ];
    expect(libraryYearStats(ITEMS, unfinished, 2026).finished.book).toBe(0);
  });

  it("refuses a year that is not a year, rather than reporting zeros", () => {
    expect(() => libraryYearStats(ITEMS, PASSES, 2026.5)).toThrow(RangeError);
    expect(() => libraryYearStats(ITEMS, PASSES, 0)).toThrow(RangeError);
    expect(() => libraryYearStats(ITEMS, PASSES, 10_000)).toThrow(RangeError);
  });
});
