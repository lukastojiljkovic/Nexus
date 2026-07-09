import { describe, expect, it } from "vitest";
import { planBlockDates } from "./planEngine.js";

describe("planBlockDates", () => {
  it("returns one block per day from startDate through the day before examDate", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-10",
      startDate: "2026-08-05",
      dailyMinutes: 30,
      examWeekBoost: false,
      today: "2026-08-01",
    });

    expect(blocks).toEqual([
      { date: "2026-08-05", minutes: 30 },
      { date: "2026-08-06", minutes: 30 },
      { date: "2026-08-07", minutes: 30 },
      { date: "2026-08-08", minutes: 30 },
      { date: "2026-08-09", minutes: 30 },
    ]);
  });

  it("doubles minutes for blocks within the final 7 days when examWeekBoost is true", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-20",
      startDate: "2026-08-01",
      dailyMinutes: 30,
      examWeekBoost: true,
      today: "2026-08-01",
    });

    const boosted = blocks.filter((b) => b.minutes === 60).map((b) => b.date);
    const notBoosted = blocks.filter((b) => b.minutes === 30).map((b) => b.date);

    // The final 7 days before the exam (2026-08-20 - 7 = 2026-08-13) are boosted.
    expect(boosted).toEqual([
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
    ]);
    expect(notBoosted).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
    ]);
  });

  it("boosts every block when the whole span is shorter than 7 days", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-20",
      startDate: "2026-08-18",
      dailyMinutes: 40,
      examWeekBoost: true,
      today: "2026-08-01",
    });

    expect(blocks).toEqual([
      { date: "2026-08-18", minutes: 80 },
      { date: "2026-08-19", minutes: 80 },
    ]);
  });

  it("does not double minutes when examWeekBoost is false, even inside the final week", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-20",
      startDate: "2026-08-18",
      dailyMinutes: 40,
      examWeekBoost: false,
      today: "2026-08-01",
    });

    expect(blocks).toEqual([
      { date: "2026-08-18", minutes: 40 },
      { date: "2026-08-19", minutes: 40 },
    ]);
  });

  it("starts from today when startDate is before today", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-10",
      startDate: "2026-07-01",
      dailyMinutes: 20,
      examWeekBoost: false,
      today: "2026-08-08",
    });

    expect(blocks).toEqual([
      { date: "2026-08-08", minutes: 20 },
      { date: "2026-08-09", minutes: 20 },
    ]);
  });

  it("starts from startDate when startDate is after today", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-10",
      startDate: "2026-08-08",
      dailyMinutes: 20,
      examWeekBoost: false,
      today: "2026-08-01",
    });

    expect(blocks).toEqual([
      { date: "2026-08-08", minutes: 20 },
      { date: "2026-08-09", minutes: 20 },
    ]);
  });

  it("returns an empty array once the exam is today or already past", () => {
    expect(
      planBlockDates({
        examDate: "2026-08-08",
        startDate: "2026-08-01",
        dailyMinutes: 20,
        examWeekBoost: false,
        today: "2026-08-08",
      }),
    ).toEqual([]);

    expect(
      planBlockDates({
        examDate: "2026-08-01",
        startDate: "2026-07-20",
        dailyMinutes: 20,
        examWeekBoost: false,
        today: "2026-08-08",
      }),
    ).toEqual([]);
  });

  it("returns a single block when startDate is exactly the day before the exam", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-10",
      startDate: "2026-08-09",
      dailyMinutes: 25,
      examWeekBoost: false,
      today: "2026-08-01",
    });

    expect(blocks).toEqual([{ date: "2026-08-09", minutes: 25 }]);
  });

  it("returns an empty array when the effective start is on/after the exam date", () => {
    // startDate == examDate.
    expect(
      planBlockDates({
        examDate: "2026-08-10",
        startDate: "2026-08-10",
        dailyMinutes: 20,
        examWeekBoost: false,
        today: "2026-08-01",
      }),
    ).toEqual([]);

    // today == examDate (effective start clamps to today, which is on the exam date).
    expect(
      planBlockDates({
        examDate: "2026-08-10",
        startDate: "2026-08-01",
        dailyMinutes: 20,
        examWeekBoost: false,
        today: "2026-08-10",
      }),
    ).toEqual([]);
  });
});
