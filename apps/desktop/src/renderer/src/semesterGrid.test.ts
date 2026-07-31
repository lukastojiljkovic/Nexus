import { describe, expect, it } from "vitest";

import {
  SEMESTER_MONTHS,
  buildDayDensity,
  densityLevel,
  semesterMonthKeys,
  semesterRange,
  type DensitySource,
} from "./semesterGrid.js";

/**
 * `semesterGrid.ts` is the whole of the Semestar view's maths: which four
 * months it covers, the single range those months are merged over, and how
 * many items each day ends up holding. The mini-month component draws that and
 * nothing else, so everything worth pinning is pinned here — no DOM involved.
 */

function span(startKey: string, endKey: string, kind: DensitySource["kind"] = "event"): DensitySource {
  return { startKey, endKey, kind };
}

function day(dayKey: string, kind: DensitySource["kind"] = "event"): DensitySource {
  return span(dayKey, dayKey, kind);
}

describe("semesterMonthKeys", () => {
  it("is the anchor month plus the next three", () => {
    expect(semesterMonthKeys("2026-07")).toEqual(["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(semesterMonthKeys("2026-07")).toHaveLength(SEMESTER_MONTHS);
  });

  it("crosses a year end", () => {
    expect(semesterMonthKeys("2026-11")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });

  it("throws TypeError on a malformed month key", () => {
    expect(() => semesterMonthKeys("2026-13")).toThrow(TypeError);
    expect(() => semesterMonthKeys("2026-7")).toThrow(TypeError);
  });
});

describe("semesterRange", () => {
  it("opens on the first day of the anchor month and closes on the last day of the fourth", () => {
    expect(semesterRange("2026-07")).toEqual({ from: "2026-07-01", to: "2026-10-31" });
  });

  it("closes on a 30-day month's real last day", () => {
    expect(semesterRange("2026-06")).toEqual({ from: "2026-06-01", to: "2026-09-30" });
  });

  it("closes on 29 February in a leap year", () => {
    expect(semesterRange("2027-11")).toEqual({ from: "2027-11-01", to: "2028-02-29" });
  });

  it("closes on 28 February otherwise", () => {
    expect(semesterRange("2026-11")).toEqual({ from: "2026-11-01", to: "2027-02-28" });
  });
});

describe("buildDayDensity", () => {
  it("has no entry for a day nothing lands on", () => {
    expect(buildDayDensity([day("2026-07-08")]).get("2026-07-09")).toBeUndefined();
  });

  it("counts every item that lands on a day", () => {
    const density = buildDayDensity([day("2026-07-08"), day("2026-07-08", "task"), day("2026-07-09")]);
    expect(density.get("2026-07-08")?.count).toBe(2);
    expect(density.get("2026-07-09")?.count).toBe(1);
  });

  it("counts a multi-day item on every day it covers, both ends included", () => {
    const density = buildDayDensity([span("2026-07-08", "2026-07-10")]);
    expect([...density.keys()]).toEqual(["2026-07-08", "2026-07-09", "2026-07-10"]);
    expect(density.get("2026-07-09")?.count).toBe(1);
  });

  it("marks a day holding an exam, and only that day", () => {
    const density = buildDayDensity([day("2026-07-08", "exam"), day("2026-07-09", "block")]);
    expect(density.get("2026-07-08")?.hasExam).toBe(true);
    expect(density.get("2026-07-09")?.hasExam).toBe(false);
  });

  it("keeps the exam mark when other items share the day, whatever the order", () => {
    const before = buildDayDensity([day("2026-07-08", "exam"), day("2026-07-08", "task")]);
    const after = buildDayDensity([day("2026-07-08", "task"), day("2026-07-08", "exam")]);
    expect(before.get("2026-07-08")).toEqual({ count: 2, hasExam: true });
    expect(after.get("2026-07-08")).toEqual({ count: 2, hasExam: true });
  });

  it("is empty for an empty stream", () => {
    expect(buildDayDensity([]).size).toBe(0);
  });
});

describe("densityLevel", () => {
  it("draws nothing at all for a day holding nothing", () => {
    expect(densityLevel(0)).toBe(0);
  });

  it("steps once, twice, then stays at the top", () => {
    expect(densityLevel(1)).toBe(1);
    expect(densityLevel(2)).toBe(2);
    expect(densityLevel(3)).toBe(2);
    expect(densityLevel(4)).toBe(3);
    expect(densityLevel(40)).toBe(3);
  });
});
