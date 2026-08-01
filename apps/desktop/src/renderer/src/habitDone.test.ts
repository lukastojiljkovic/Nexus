import { describe, expect, it } from "vitest";

import type { Habit, HabitEntry, HabitSchedule } from "../../shared/ipc.js";
import {
  countsAsDone,
  habitDayStates,
  habitWindowScore,
  indexHabitEntries,
  quotaWeekProgress,
  satisfiedDaysOf,
  valueOn,
} from "./habitDone.js";

/** A habit with only the fields this module reads; the rest of the wire row never reaches it. */
function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: "h1",
    profileId: "p1",
    name: "Voda",
    color: null,
    schedule: { kind: "days", weekdays: [1, 2, 3, 4, 5, 6, 7] },
    target: null,
    unit: null,
    reminderTime: null,
    archivedAt: null,
    createdAt: "2026-01-01T08:00:00.000Z",
    updatedAt: "2026-01-01T08:00:00.000Z",
    ...overrides,
  };
}

function entry(habitId: string, date: string, value: number): HabitEntry {
  return {
    id: `${habitId}@${date}`,
    habitId,
    date,
    value,
    createdAt: "2026-01-01T08:00:00.000Z",
    updatedAt: "2026-01-01T08:00:00.000Z",
  };
}

const DAILY: HabitSchedule = { kind: "days", weekdays: [1, 2, 3, 4, 5, 6, 7] };
/** Monday / Wednesday / Friday — the schedule every „gym" example in the module is about. */
const MON_WED_FRI: HabitSchedule = { kind: "days", weekdays: [1, 3, 5] };
const THREE_A_WEEK: HabitSchedule = { kind: "quota", perWeek: 3 };

/** Monday-first, `Date.getUTCDay()` terms — the device default the page passes in. */
const MONDAY_START = 1;

describe("countsAsDone", () => {
  it("counts any entry at all for a binary habit — its tick is worth one and that is the whole test", () => {
    expect(countsAsDone(null, 1)).toBe(true);
    expect(countsAsDone(null, 4)).toBe(true);
  });

  it("counts nothing when there is no entry, whatever the habit is", () => {
    expect(countsAsDone(null, 0)).toBe(false);
    expect(countsAsDone(8, 0)).toBe(false);
  });

  it("counts a measured habit only once its value REACHES the target", () => {
    expect(countsAsDone(8, 7)).toBe(false);
    expect(countsAsDone(8, 8)).toBe(true);
    expect(countsAsDone(8, 12)).toBe(true);
  });
});

describe("indexHabitEntries / valueOn", () => {
  it("groups the flat range read by habit and by day, so nothing walks the list per habit", () => {
    const index = indexHabitEntries([
      entry("h1", "2026-07-01", 3),
      entry("h2", "2026-07-01", 1),
      entry("h1", "2026-07-02", 8),
    ]);
    expect(valueOn(index, "h1", "2026-07-01")).toBe(3);
    expect(valueOn(index, "h1", "2026-07-02")).toBe(8);
    expect(valueOn(index, "h2", "2026-07-01")).toBe(1);
  });

  it("answers 0 for a day with no entry and for a habit with none at all — an absent tick is not an absent habit", () => {
    const index = indexHabitEntries([entry("h1", "2026-07-01", 3)]);
    expect(valueOn(index, "h1", "2026-07-09")).toBe(0);
    expect(valueOn(index, "nema", "2026-07-01")).toBe(0);
  });
});

describe("satisfiedDaysOf", () => {
  it("keeps the days that count and drops the ones that fell short of a target", () => {
    const index = indexHabitEntries([
      entry("h1", "2026-07-01", 8),
      entry("h1", "2026-07-02", 5),
      entry("h1", "2026-07-03", 9),
    ]);
    expect(satisfiedDaysOf(habit({ target: 8, unit: "čaša" }), index)).toEqual([
      "2026-07-01",
      "2026-07-03",
    ]);
  });

  it("keeps every ticked day for a binary habit", () => {
    const index = indexHabitEntries([entry("h1", "2026-07-01", 1), entry("h1", "2026-07-04", 1)]);
    expect(satisfiedDaysOf(habit(), index)).toEqual(["2026-07-01", "2026-07-04"]);
  });

  it("answers ascending days, whatever order the entries arrived in — the streak engine takes a list and this is the one that builds it", () => {
    const index = indexHabitEntries([entry("h1", "2026-07-04", 1), entry("h1", "2026-07-01", 1)]);
    expect(satisfiedDaysOf(habit(), index)).toEqual(["2026-07-01", "2026-07-04"]);
  });
});

describe("habitDayStates — the history grid's cells", () => {
  it("marks an expected day satisfied, and an expected day with nothing as missed", () => {
    // 2026-07-01 is a Wednesday, 2026-07-02 a Thursday, 2026-07-03 a Friday.
    const index = indexHabitEntries([entry("h1", "2026-07-01", 1)]);
    const states = habitDayStates(
      habit({ schedule: MON_WED_FRI, createdAt: "2026-06-01T00:00:00.000Z" }),
      index,
      ["2026-07-01", "2026-07-02", "2026-07-03"],
      "2026-07-10",
    );
    expect(states).toEqual(["satisfied", "unexpected", "missed"]);
  });

  it("marks a day the schedule never asked for as unexpected, ticked or not — a Tuesday must cost a Mon/Sre/Pet habit nothing", () => {
    const index = indexHabitEntries([entry("h1", "2026-07-02", 1)]);
    const states = habitDayStates(
      habit({ schedule: MON_WED_FRI, createdAt: "2026-06-01T00:00:00.000Z" }),
      index,
      ["2026-07-02"],
      "2026-07-10",
    );
    // A tick on an unexpected day still counts as done — the streak reads the
    // same derivation — but the CELL says the schedule did not ask for it.
    expect(states).toEqual(["satisfied"]);
  });

  it("judges nothing before the habit existed — a habit made yesterday must not show eleven weeks of misses", () => {
    const states = habitDayStates(
      habit({ schedule: DAILY, createdAt: "2026-07-08T09:00:00.000Z" }),
      indexHabitEntries([]),
      ["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09"],
      "2026-07-10",
    );
    expect(states).toEqual(["unjudged", "unjudged", "missed", "missed"]);
  });

  it("judges nothing after today, and nothing about TODAY until it is done — the day is not over", () => {
    const untouched = habitDayStates(
      habit({ schedule: DAILY, createdAt: "2026-06-01T00:00:00.000Z" }),
      indexHabitEntries([]),
      ["2026-07-09", "2026-07-10", "2026-07-11"],
      "2026-07-10",
    );
    expect(untouched).toEqual(["missed", "unjudged", "unjudged"]);
    // …and the tick is what fills it in, which is exactly the reward „Danas" offers.
    const ticked = habitDayStates(
      habit({ schedule: DAILY, createdAt: "2026-06-01T00:00:00.000Z" }),
      indexHabitEntries([entry("h1", "2026-07-10", 1)]),
      ["2026-07-10"],
      "2026-07-10",
    );
    expect(ticked).toEqual(["satisfied"]);
  });

  it("gives a QUOTA habit no missed day at all — no single day was ever expected of it, so a blank one accuses nobody", () => {
    const index = indexHabitEntries([entry("h1", "2026-07-01", 1)]);
    const states = habitDayStates(
      habit({ schedule: THREE_A_WEEK, createdAt: "2026-06-01T00:00:00.000Z" }),
      index,
      ["2026-07-01", "2026-07-02"],
      "2026-07-10",
    );
    expect(states).toEqual(["satisfied", "unexpected"]);
  });
});

describe("quotaWeekProgress — „2/3 ove nedelje“", () => {
  it("counts the satisfying days inside the week TODAY falls in, under the device's first-day preference", () => {
    // 2026-07-06 is a Monday; 2026-07-09 a Thursday. Both are in the same
    // Monday-first week as 2026-07-10.
    const index = indexHabitEntries([
      entry("h1", "2026-07-05", 1), // the Sunday BEFORE — the previous Monday-first week
      entry("h1", "2026-07-06", 1),
      entry("h1", "2026-07-09", 1),
    ]);
    expect(
      quotaWeekProgress(habit({ schedule: THREE_A_WEEK }), index, "2026-07-10", MONDAY_START),
    ).toEqual({ done: 2, perWeek: 3 });
  });

  it("moves the boundary with the preference — the same three ticks read differently Sunday-first", () => {
    const index = indexHabitEntries([
      entry("h1", "2026-07-05", 1),
      entry("h1", "2026-07-06", 1),
      entry("h1", "2026-07-09", 1),
    ]);
    expect(quotaWeekProgress(habit({ schedule: THREE_A_WEEK }), index, "2026-07-10", 0)).toEqual({
      done: 3,
      perWeek: 3,
    });
  });

  it("counts only the days that COUNT — a measured habit's half-done day is not one of them", () => {
    const index = indexHabitEntries([entry("h1", "2026-07-06", 4), entry("h1", "2026-07-07", 8)]);
    expect(
      quotaWeekProgress(
        habit({ schedule: THREE_A_WEEK, target: 8, unit: "čaša" }),
        index,
        "2026-07-10",
        MONDAY_START,
      ),
    ).toEqual({ done: 1, perWeek: 3 });
  });

  it("answers null for a habit that is not a quota — there is no week to be part-way through", () => {
    expect(
      quotaWeekProgress(habit({ schedule: MON_WED_FRI }), indexHabitEntries([]), "2026-07-10", 1),
    ).toBeNull();
  });
});

describe("habitWindowScore — the honest 30-day figure", () => {
  it("counts the EXPECTED days of the window and how many of them were satisfied", () => {
    // 2026-06-11 .. 2026-07-10 inclusive. Mondays, Wednesdays and Fridays in
    // that span: 12/06, 15/06, 17/06, 19/06, 22/06, 24/06, 26/06, 29/06, 01/07,
    // 03/07, 06/07, 08/07, 10/07 — thirteen days, the last of them today.
    const index = indexHabitEntries([entry("h1", "2026-06-12", 1), entry("h1", "2026-07-08", 1)]);
    expect(
      habitWindowScore(
        habit({ schedule: MON_WED_FRI, createdAt: "2026-01-01T00:00:00.000Z" }),
        index,
        "2026-07-10",
        MONDAY_START,
      ),
    ).toEqual({ kind: "days", done: 2, expected: 12 });
  });

  it("does not count TODAY against a habit that has not been done yet — the day is not over, exactly as the streak engine has it", () => {
    // Today (2026-07-10) is a Friday and therefore expected; unsatisfied, it is
    // skipped rather than counted as a miss.
    const empty = habitWindowScore(
      habit({ schedule: MON_WED_FRI, createdAt: "2026-01-01T00:00:00.000Z" }),
      indexHabitEntries([]),
      "2026-07-10",
      MONDAY_START,
    );
    const done = habitWindowScore(
      habit({ schedule: MON_WED_FRI, createdAt: "2026-01-01T00:00:00.000Z" }),
      indexHabitEntries([entry("h1", "2026-07-10", 1)]),
      "2026-07-10",
      MONDAY_START,
    );
    expect(empty).toEqual({ kind: "days", done: 0, expected: 12 });
    // …and once it IS done, today joins both halves of the fraction.
    expect(done).toEqual({ kind: "days", done: 1, expected: 13 });
  });

  it("never counts a day before the habit existed", () => {
    expect(
      habitWindowScore(
        habit({ schedule: DAILY, createdAt: "2026-07-08T09:00:00.000Z" }),
        indexHabitEntries([entry("h1", "2026-07-08", 1), entry("h1", "2026-07-09", 1)]),
        "2026-07-10",
        MONDAY_START,
      ),
      // 08/07 and 09/07 are expected and done; today is expected and not, so it
      // is skipped. Nothing before 08/07 was ever asked of this habit.
    ).toEqual({ kind: "days", done: 2, expected: 2 });
  });

  it("states a QUOTA habit's window in WEEKS, counting only the weeks that closed", () => {
    // Monday-first weeks opening 15/06, 22/06, 29/06 and 06/07 fall inside the
    // window; the last is still running, so it is not judged unless it is
    // already satisfied.
    const index = indexHabitEntries([
      entry("h1", "2026-06-15", 1),
      entry("h1", "2026-06-16", 1),
      entry("h1", "2026-06-17", 1),
      entry("h1", "2026-06-29", 1),
    ]);
    expect(
      habitWindowScore(
        habit({ schedule: THREE_A_WEEK, createdAt: "2026-01-01T00:00:00.000Z" }),
        index,
        "2026-07-10",
        MONDAY_START,
      ),
    ).toEqual({ kind: "weeks", done: 1, expected: 3 });
  });

  it("counts the RUNNING week for a quota habit that has already met it", () => {
    const index = indexHabitEntries([
      entry("h1", "2026-07-06", 1),
      entry("h1", "2026-07-07", 1),
      entry("h1", "2026-07-08", 1),
    ]);
    expect(
      habitWindowScore(
        habit({ schedule: THREE_A_WEEK, createdAt: "2026-01-01T00:00:00.000Z" }),
        index,
        "2026-07-10",
        MONDAY_START,
      ),
    ).toEqual({ kind: "weeks", done: 1, expected: 4 });
  });

  it("never counts a week that opened before the habit did — a habit made on Wednesday is not judged on its first partial week", () => {
    expect(
      habitWindowScore(
        habit({ schedule: THREE_A_WEEK, createdAt: "2026-07-08T09:00:00.000Z" }),
        indexHabitEntries([]),
        "2026-07-10",
        MONDAY_START,
      ),
    ).toEqual({ kind: "weeks", done: 0, expected: 0 });
  });
});
