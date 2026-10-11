import { describe, expect, it } from "vitest";
import {
  groupByCreationDay,
  groupByDiaryDate,
  diaryMonthSummary,
  recordingStorageSummary,
  type RecorderEntry,
} from "./recordingGroups.js";

/**
 * Four recordings whose every total below is a hand calculation:
 *
 *   a  audio  2026-06-01T20:15Z  65 s      1 000 000 B   diary 2026-06-02
 *   b  video  2026-06-02T09:00Z   1 h    200 000 000 B   diary 2026-06-02
 *   c  audio  2026-06-01T07:30Z  10 s        100 000 B   memo
 *   d  video  2026-06-10T23:59Z   5 s      2 000 000 B   diary 2026-07-01
 *
 * `d` is the case the two groupings disagree about on purpose: created in June
 * and filed in July.
 */
const ENTRIES: readonly RecorderEntry[] = [
  {
    id: "a",
    kind: "audio",
    createdAt: "2026-06-01T20:15:00.000Z",
    durationMs: 65_000,
    sizeBytes: 1_000_000,
    isDiary: true,
    diaryDate: "2026-06-02",
  },
  {
    id: "b",
    kind: "video",
    createdAt: "2026-06-02T09:00:00.000Z",
    durationMs: 3_600_000,
    sizeBytes: 200_000_000,
    isDiary: true,
    diaryDate: "2026-06-02",
  },
  {
    id: "c",
    kind: "audio",
    createdAt: "2026-06-01T07:30:00.000Z",
    durationMs: 10_000,
    sizeBytes: 100_000,
    isDiary: false,
    diaryDate: null,
  },
  {
    id: "d",
    kind: "video",
    createdAt: "2026-06-10T23:59:00.000Z",
    durationMs: 5_000,
    sizeBytes: 2_000_000,
    isDiary: true,
    diaryDate: "2026-07-01",
  },
];

/** Ids only, so a failure names the order rather than reprinting four rows. */
function ids<T extends { id: string }>(group: readonly T[]): string[] {
  return group.map((entry) => entry.id);
}

describe("groupByCreationDay", () => {
  it("groups every recording by the day it was created, newest day first", () => {
    const groups = groupByCreationDay(ENTRIES);

    expect(groups.map((group) => group.day)).toEqual([
      "2026-06-10",
      "2026-06-02",
      "2026-06-01",
    ]);
    expect(groups.map((group) => ids(group.recordings))).toEqual([["d"], ["b"], ["a", "c"]]);
  });

  it("returns an empty list for no recordings — a day needs a recording to exist", () => {
    expect(groupByCreationDay([])).toEqual([]);
  });

  it("refuses a row whose creation instant carries no day, naming it", () => {
    const broken = [{ ...ENTRIES[0]!, id: "broken", createdAt: "yesterday" }];
    expect(() => groupByCreationDay(broken)).toThrow(/broken/);
  });
});

describe("groupByDiaryDate", () => {
  it("groups only the diary entries, by the date they were FILED under", () => {
    const groups = groupByDiaryDate(ENTRIES);

    expect(groups.map((group) => group.day)).toEqual(["2026-07-01", "2026-06-02"]);
    // Same diary day, newest created first.
    expect(groups.map((group) => ids(group.recordings))).toEqual([["d"], ["b", "a"]]);
  });

  it("leaves a memo out — a recording with no diary has no diary date to group by", () => {
    expect(groupByDiaryDate(ENTRIES).flatMap((group) => ids(group.recordings))).not.toContain("c");
  });

  it("refuses a diary entry with no diary date, naming it", () => {
    const broken = [{ ...ENTRIES[0]!, id: "broken", isDiary: true, diaryDate: null }];
    expect(() => groupByDiaryDate(broken)).toThrow(/broken/);
  });
});

describe("diaryMonthSummary", () => {
  it("names the days of the month that carry diary entries, and how many", () => {
    expect(diaryMonthSummary(ENTRIES, "2026-06")).toEqual({
      month: "2026-06",
      days: ["2026-06-02"],
      entries: 2,
    });
  });

  it("counts a July diary entry only in July, however it was created in June", () => {
    expect(diaryMonthSummary(ENTRIES, "2026-07")).toEqual({
      month: "2026-07",
      days: ["2026-07-01"],
      entries: 1,
    });
  });

  it("answers a month with no diary entries with empty days and a zero count", () => {
    expect(diaryMonthSummary(ENTRIES, "2026-05")).toEqual({
      month: "2026-05",
      days: [],
      entries: 0,
    });
  });

  it("orders days in calendar order, not in insertion order", () => {
    const summary = diaryMonthSummary(
      [
        { ...ENTRIES[0]!, id: "late", diaryDate: "2026-06-20" },
        { ...ENTRIES[0]!, id: "early", diaryDate: "2026-06-03" },
      ],
      "2026-06",
    );
    expect(summary.days).toEqual(["2026-06-03", "2026-06-20"]);
    expect(summary.entries).toBe(2);
  });
});

describe("recordingStorageSummary", () => {
  it("totals count, size and duration per kind, and across both", () => {
    expect(recordingStorageSummary(ENTRIES)).toEqual({
      audio: { count: 2, sizeBytes: 1_100_000, durationMs: 75_000 },
      video: { count: 2, sizeBytes: 202_000_000, durationMs: 3_605_000 },
      all: { count: 4, sizeBytes: 203_100_000, durationMs: 3_680_000 },
    });
  });

  it("answers zeroes for an empty recorder rather than an absent shape", () => {
    expect(recordingStorageSummary([])).toEqual({
      audio: { count: 0, sizeBytes: 0, durationMs: 0 },
      video: { count: 0, sizeBytes: 0, durationMs: 0 },
      all: { count: 0, sizeBytes: 0, durationMs: 0 },
    });
  });
});
