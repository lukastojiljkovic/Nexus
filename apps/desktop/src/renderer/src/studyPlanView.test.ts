import { describe, expect, it } from "vitest";
import {
  blockKindChipLabel,
  isExamWeekDay,
  parseWeekdayMinutes,
  planHealthLine,
  scopeCutRows,
  weekdayMinutesForSave,
} from "./studyPlanView.js";

describe("parseWeekdayMinutes", () => {
  it("parses seven whole-number inputs, trimming whitespace", () => {
    expect(parseWeekdayMinutes(["60", " 45", "60 ", "60", "60", "0", "0"])).toEqual([
      60, 45, 60, 60, 60, 0, 0,
    ]);
  });

  it("accepts the bounds themselves (0 and 480)", () => {
    expect(parseWeekdayMinutes(["480", "0", "0", "0", "0", "0", "0"])).toEqual([
      480, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it("rejects a vector that is not exactly seven entries", () => {
    expect(parseWeekdayMinutes(["60", "60", "60", "60", "60", "60"])).toBeNull();
    expect(parseWeekdayMinutes(["60", "60", "60", "60", "60", "60", "60", "60"])).toBeNull();
  });

  it("rejects empty, non-numeric, fractional, negative and out-of-range entries", () => {
    const base = ["60", "60", "60", "60", "60", "60"];
    expect(parseWeekdayMinutes([...base, ""])).toBeNull();
    expect(parseWeekdayMinutes([...base, "6a"])).toBeNull();
    expect(parseWeekdayMinutes([...base, "1.5"])).toBeNull();
    expect(parseWeekdayMinutes([...base, "-5"])).toBeNull();
    expect(parseWeekdayMinutes([...base, "481"])).toBeNull();
  });

  it("rejects a week of nothing (all zero) — the store's own rule, mirrored", () => {
    expect(parseWeekdayMinutes(["0", "0", "0", "0", "0", "0", "0"])).toBeNull();
  });
});

describe("weekdayMinutesForSave", () => {
  it("collapses an all-equal week onto the scalar (null vector = svaki dan isto)", () => {
    expect(weekdayMinutesForSave([60, 60, 60, 60, 60, 60, 60], 60)).toBeNull();
  });

  it("keeps a vector that differs from the scalar anywhere", () => {
    expect(weekdayMinutesForSave([60, 60, 60, 60, 60, 0, 0], 60)).toEqual([
      60, 60, 60, 60, 60, 0, 0,
    ]);
  });

  it("keeps an all-equal week that does not match the scalar — the vector is what the user typed", () => {
    expect(weekdayMinutesForSave([90, 90, 90, 90, 90, 90, 90], 60)).toEqual([
      90, 90, 90, 90, 90, 90, 90,
    ]);
  });
});

describe("isExamWeekDay", () => {
  it("marks the final seven days strictly before the exam", () => {
    expect(isExamWeekDay("2026-08-10", "2026-08-09")).toBe(true);
    expect(isExamWeekDay("2026-08-10", "2026-08-03")).toBe(true);
  });

  it("excludes the day before the window, the exam day itself, and later days", () => {
    expect(isExamWeekDay("2026-08-10", "2026-08-02")).toBe(false);
    expect(isExamWeekDay("2026-08-10", "2026-08-10")).toBe(false);
    expect(isExamWeekDay("2026-08-10", "2026-08-11")).toBe(false);
  });

  it("ignores a time part on the exam date (bare-day arithmetic)", () => {
    expect(isExamWeekDay("2026-08-10T09:00", "2026-08-04")).toBe(true);
  });

  it("crosses a month boundary without drift", () => {
    expect(isExamWeekDay("2026-09-03", "2026-08-28")).toBe(true);
    expect(isExamWeekDay("2026-09-03", "2026-08-26")).toBe(false);
  });
});

describe("planHealthLine", () => {
  it("is null without a health row or with an all-zero one", () => {
    expect(planHealthLine(undefined)).toBeNull();
    expect(planHealthLine({ overflowMinutes: 0, examPassedBacklogMinutes: 0 })).toBeNull();
  });

  it("spells the overflow out with its minutes count", () => {
    expect(planHealthLine({ overflowMinutes: 120, examPassedBacklogMinutes: 0 })).toBe(
      "U preostale dane ne staje još 120 min učenja.",
    );
  });

  it("spells a passed exam's unabsorbed backlog out", () => {
    expect(planHealthLine({ overflowMinutes: 0, examPassedBacklogMinutes: 90 })).toBe(
      "Ispit je prošao — 90 min učenja je ostalo propušteno.",
    );
  });
});

describe("blockKindChipLabel", () => {
  it("keeps coverage plain and labels revision/recall", () => {
    expect(blockKindChipLabel("coverage")).toBeNull();
    expect(blockKindChipLabel("revision")).toBe("obnavljanje");
    expect(blockKindChipLabel("recall")).toBe("prisećanje");
  });
});

describe("scopeCutRows", () => {
  const topics = [
    { id: "t1", name: "Integrali", rank: 0 },
    { id: "t2", name: "Redovi", rank: 1 },
    { id: "t3", name: "Furije", rank: 2 },
  ];
  const blocks = [
    { topicId: "t3", minutes: 45, status: "planned", blockDate: "2026-08-05" },
    { topicId: "t3", minutes: 30, status: "missed", blockDate: "2026-07-30" },
    { topicId: "t3", minutes: 60, status: "done", blockDate: "2026-08-06" },
    { topicId: "t3", minutes: 25, status: "planned", blockDate: "2026-07-29" },
    { topicId: "t2", minutes: 40, status: "planned", blockDate: "2026-08-07" },
    { topicId: null, minutes: 15, status: "planned", blockDate: "2026-08-07" },
  ] as const;

  it("joins each proposed topic with its rank and remaining non-done minutes (missed anywhere + planned from today)", () => {
    expect(scopeCutRows(["t3", "t2"], topics, blocks, "2026-08-01")).toEqual([
      { id: "t3", name: "Furije", rank: 2, remainingMinutes: 75 },
      { id: "t2", name: "Redovi", rank: 1, remainingMinutes: 40 },
    ]);
  });

  it("keeps the proposal's own order and skips an id no topic resolves", () => {
    expect(scopeCutRows(["t2", "ghost"], topics, blocks, "2026-08-01")).toEqual([
      { id: "t2", name: "Redovi", rank: 1, remainingMinutes: 40 },
    ]);
  });
});
