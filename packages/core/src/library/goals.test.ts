import { describe, expect, it } from "vitest";
import {
  LIBRARY_MAX_GOAL_TARGET,
  LIBRARY_MIN_GOAL_TARGET,
  isLibraryGoalTarget,
  libraryGoalProgress,
} from "./goals.js";
import { libraryYearStats } from "./stats.js";
import type { LibraryStatsItem, LibraryStatsPass } from "./stats.js";

describe("isLibraryGoalTarget", () => {
  it("accepts whole numbers from one to one thousand", () => {
    expect(LIBRARY_MIN_GOAL_TARGET).toBe(1);
    expect(LIBRARY_MAX_GOAL_TARGET).toBe(1000);
    expect(isLibraryGoalTarget(1)).toBe(true);
    expect(isLibraryGoalTarget(1000)).toBe(true);
  });

  it("refuses zero, the values beyond the bounds, fractions, strings and unsafe integers", () => {
    expect(isLibraryGoalTarget(0)).toBe(false);
    expect(isLibraryGoalTarget(1001)).toBe(false);
    expect(isLibraryGoalTarget(12.5)).toBe(false);
    expect(isLibraryGoalTarget("12")).toBe(false);
    expect(isLibraryGoalTarget(Number.MAX_SAFE_INTEGER + 2)).toBe(false);
    expect(isLibraryGoalTarget(null)).toBe(false);
  });
});

const ITEMS: readonly LibraryStatsItem[] = [
  { id: "b1", kind: "book", pagesTotal: 300 },
  { id: "b2", kind: "book", pagesTotal: null },
  { id: "f1", kind: "film", pagesTotal: null },
];

const PASSES: readonly LibraryStatsPass[] = [
  // The last day of 2026 counts for 2026.
  { itemId: "b1", finishedOn: "2026-12-31", rating: null },
  // The first day of 2027 does not.
  { itemId: "b2", finishedOn: "2027-01-01", rating: null },
  { itemId: "f1", finishedOn: "2026-01-01", rating: null },
];

describe("libraryGoalProgress", () => {
  const stats2026 = libraryYearStats(ITEMS, PASSES, 2026);

  it("counts every kind for a goal over all kinds", () => {
    expect(libraryGoalProgress({ kind: null, target: 10 }, stats2026)).toEqual({
      done: 2,
      target: 10,
    });
  });

  it("counts only the goal's own kind for a per-kind goal", () => {
    expect(libraryGoalProgress({ kind: "book", target: 5 }, stats2026)).toEqual({
      done: 1,
      target: 5,
    });
    expect(libraryGoalProgress({ kind: "series", target: 5 }, stats2026).done).toBe(0);
  });

  it("moves a year-edge finish with the year it is read against", () => {
    const stats2027 = libraryYearStats(ITEMS, PASSES, 2027);
    expect(libraryGoalProgress({ kind: null, target: 3 }, stats2027).done).toBe(1);
  });

  it("can pass its target without being capped", () => {
    expect(libraryGoalProgress({ kind: null, target: 1 }, stats2026).done).toBe(2);
  });
});
