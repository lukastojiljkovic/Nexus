import { describe, expect, it } from "vitest";
import { computeStreak } from "./studyStats.js";

describe("computeStreak", () => {
  it("returns zero for both current and best on empty input", () => {
    expect(computeStreak([], "2026-07-10")).toEqual({ current: 0, best: 0 });
  });

  it("counts a single day of activity on today", () => {
    expect(computeStreak(["2026-07-10"], "2026-07-10")).toEqual({ current: 1, best: 1 });
  });

  it("gently preserves current for a single day of activity on yesterday", () => {
    expect(computeStreak(["2026-07-09"], "2026-07-10")).toEqual({ current: 1, best: 1 });
  });

  it("zeroes current for a single day of activity older than yesterday", () => {
    expect(computeStreak(["2026-07-01"], "2026-07-10")).toEqual({ current: 0, best: 1 });
  });

  it("counts a run ending today", () => {
    const days = ["2026-07-08", "2026-07-09", "2026-07-10"];
    expect(computeStreak(days, "2026-07-10")).toEqual({ current: 3, best: 3 });
  });

  it("preserves current for a run ending yesterday when today has no activity yet", () => {
    const days = ["2026-07-07", "2026-07-08", "2026-07-09"];
    expect(computeStreak(days, "2026-07-10")).toEqual({ current: 3, best: 3 });
  });

  it("breaks current at a gap but remembers the best run", () => {
    const days = [
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      // gap: 07-06, 07-07, 07-08 missing
      "2026-07-09",
    ];
    expect(computeStreak(days, "2026-07-10")).toEqual({ current: 1, best: 5 });
  });

  it("zeroes current when neither today nor yesterday has activity, but keeps best", () => {
    const days = ["2026-07-01", "2026-07-02"];
    expect(computeStreak(days, "2026-07-10")).toEqual({ current: 0, best: 2 });
  });

  it("dedupes and sorts unordered, duplicated input", () => {
    const days = ["2026-07-10", "2026-07-08", "2026-07-09", "2026-07-09", "2026-07-10"];
    expect(computeStreak(days, "2026-07-10")).toEqual({ current: 3, best: 3 });
  });

  it("ignores days strictly after today", () => {
    const days = ["2026-07-10", "2026-07-11", "2026-07-12"];
    expect(computeStreak(days, "2026-07-10")).toEqual({ current: 1, best: 1 });
  });
});
