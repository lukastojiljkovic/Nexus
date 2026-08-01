import { describe, expect, it } from "vitest";

import type { WeekStart } from "../calendar/calendarGrid.js";
import { computeHabitStreak } from "./habitStreak.js";
import type { HabitSchedule } from "./habitSchedule.js";

// 2026-06-01 is a Monday, so every date below reads off a clean five-week grid:
// weeks open 06-01, 06-08, 06-15, 06-22 and 06-29 (Monday start).
const EVERY_DAY: HabitSchedule = { kind: "days", weekdays: [1, 2, 3, 4, 5, 6, 7] };
const MON_WED_FRI: HabitSchedule = { kind: "days", weekdays: [1, 3, 5] };
const MONDAY_START: WeekStart = 1;
const SUNDAY_START: WeekStart = 0;

describe("computeHabitStreak — days habits", () => {
  it.each([
    [
      "counts every consecutive expected day up to today",
      EVERY_DAY,
      ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"],
      "2026-06-05",
      { current: 5, best: 5 },
    ],
    [
      "leaves the streak standing while today is untouched — the day is not over",
      EVERY_DAY,
      ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"],
      "2026-06-05",
      { current: 4, best: 4 },
    ],
    [
      "breaks only after a FULL missed day",
      EVERY_DAY,
      ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"],
      "2026-06-06",
      { current: 0, best: 4 },
    ],
    [
      "makes unscheduled days invisible — a Tuesday costs a Mon/Wed/Fri habit nothing",
      MON_WED_FRI,
      ["2026-06-01", "2026-06-03", "2026-06-05"],
      "2026-06-06",
      { current: 3, best: 3 },
    ],
    [
      "forgives an expected TODAY that has not been ticked yet",
      MON_WED_FRI,
      ["2026-06-01", "2026-06-03", "2026-06-05"],
      "2026-06-08",
      { current: 3, best: 3 },
    ],
    [
      "counts an expected today that HAS been ticked",
      MON_WED_FRI,
      ["2026-06-01", "2026-06-03", "2026-06-05", "2026-06-08"],
      "2026-06-08",
      { current: 4, best: 4 },
    ],
    [
      "breaks on an expected day that closed unsatisfied, even while today is open",
      MON_WED_FRI,
      ["2026-06-01", "2026-06-03", "2026-06-05"],
      "2026-06-10",
      { current: 0, best: 3 },
    ],
    [
      "keeps the best run when a middle expected day was missed",
      MON_WED_FRI,
      ["2026-06-01", "2026-06-05", "2026-06-08"],
      "2026-06-08",
      { current: 2, best: 2 },
    ],
    [
      "reports a long-past best beside a freshly restarted current",
      MON_WED_FRI,
      ["2026-06-01", "2026-06-03", "2026-06-05", "2026-06-08", "2026-06-22"],
      "2026-06-22",
      { current: 1, best: 4 },
    ],
    [
      "tolerates unsorted input, duplicates and days after today",
      MON_WED_FRI,
      ["2026-06-05", "2026-06-01", "2026-06-03", "2026-06-03", "2026-06-12"],
      "2026-06-05",
      { current: 3, best: 3 },
    ],
    [
      "has no streak before the habit was ever satisfied",
      MON_WED_FRI,
      [],
      "2026-06-05",
      { current: 0, best: 0 },
    ],
    [
      "has no streak when every satisfied day is still ahead",
      MON_WED_FRI,
      ["2026-06-10", "2026-06-12"],
      "2026-06-05",
      { current: 0, best: 0 },
    ],
    [
      "drops a day key that is not a real bare date rather than poisoning the run",
      EVERY_DAY,
      ["2026-06-04", "not-a-day", "2026-06-05"],
      "2026-06-05",
      { current: 2, best: 2 },
    ],
  ])("%s", (_label, schedule, satisfiedDays, today, expected) => {
    expect(computeHabitStreak(schedule, satisfiedDays, today, MONDAY_START)).toEqual(expected);
  });

  it("ignores the week start entirely — a days habit has no week in it", () => {
    const satisfied = ["2026-06-01", "2026-06-03", "2026-06-05", "2026-06-08"];
    expect(computeHabitStreak(MON_WED_FRI, satisfied, "2026-06-08", MONDAY_START)).toEqual(
      computeHabitStreak(MON_WED_FRI, satisfied, "2026-06-08", SUNDAY_START),
    );
  });
});

describe("computeHabitStreak — quota habits", () => {
  const threePerWeek: HabitSchedule = { kind: "quota", perWeek: 3 };
  const twicePerWeek: HabitSchedule = { kind: "quota", perWeek: 2 };
  const oncePerWeek: HabitSchedule = { kind: "quota", perWeek: 1 };

  it.each([
    [
      "counts consecutive weeks that reached the quota",
      threePerWeek,
      ["2026-06-01", "2026-06-03", "2026-06-05", "2026-06-08", "2026-06-09", "2026-06-10"],
      "2026-06-14",
      { current: 2, best: 2 },
    ],
    [
      "leaves the streak standing while THIS week's quota is still unmet",
      threePerWeek,
      ["2026-06-01", "2026-06-03", "2026-06-05", "2026-06-08", "2026-06-09"],
      "2026-06-10",
      { current: 1, best: 1 },
    ],
    [
      "breaks once the unmet week has closed",
      threePerWeek,
      ["2026-06-01", "2026-06-03", "2026-06-05", "2026-06-08", "2026-06-09"],
      "2026-06-15",
      { current: 0, best: 1 },
    ],
    [
      "forgives WHICH days — any two in the week satisfy a quota of two",
      twicePerWeek,
      ["2026-06-06", "2026-06-07"],
      "2026-06-07",
      { current: 1, best: 1 },
    ],
    [
      "counts a repeated day once towards the quota",
      twicePerWeek,
      ["2026-06-01", "2026-06-01", "2026-06-02"],
      "2026-06-07",
      { current: 1, best: 1 },
    ],
    [
      "reports a long-past best beside a freshly restarted current",
      oncePerWeek,
      ["2026-06-01", "2026-06-08", "2026-06-22"],
      "2026-06-22",
      { current: 1, best: 2 },
    ],
    [
      "has no streak before the habit was ever satisfied",
      threePerWeek,
      [],
      "2026-06-10",
      { current: 0, best: 0 },
    ],
  ])("%s", (_label, schedule, satisfiedDays, today, expected) => {
    expect(computeHabitStreak(schedule, satisfiedDays, today, MONDAY_START)).toEqual(expected);
  });

  it("draws its week boundaries from the device preference, never from a guess", () => {
    // Sunday 07 June and Monday 08 June are one week apart under a Monday start
    // and the SAME week under a Sunday one — so the very same two days either
    // miss a quota of two twice or meet it once.
    const satisfied = ["2026-06-07", "2026-06-08"];
    expect(computeHabitStreak(twicePerWeek, satisfied, "2026-06-08", MONDAY_START)).toEqual({
      current: 0,
      best: 0,
    });
    expect(computeHabitStreak(twicePerWeek, satisfied, "2026-06-08", SUNDAY_START)).toEqual({
      current: 1,
      best: 1,
    });
  });
});
