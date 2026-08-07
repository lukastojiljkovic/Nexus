import { describe, it, expect } from "vitest";
import {
  MAX_SPAN_DAYS,
  MIN_TIMED_MINUTES,
  MINUTES_PER_DAY,
  daySpanKeys,
  isoWeekNumber,
  layoutMonthBars,
  layoutTimedColumns,
  monthGridDays,
  monthKeyOf,
  shiftDayKey,
  shiftMonthKey,
  weekDayKeys,
  weekOpeningDayKey,
  type SpanItem,
  type TimedItem,
} from "./calendarGrid.js";

describe("monthKeyOf", () => {
  it("takes the year-month prefix of a day key", () => {
    expect(monthKeyOf("2026-08-14")).toBe("2026-08");
  });

  it("throws TypeError on a malformed day key", () => {
    expect(() => monthKeyOf("2026-13-01")).toThrow(TypeError);
    expect(() => monthKeyOf("2026-02-30")).toThrow(TypeError);
    expect(() => monthKeyOf("26-01-01")).toThrow(TypeError);
    expect(() => monthKeyOf("2026-01")).toThrow(TypeError);
  });
});

describe("monthGridDays", () => {
  it("Aug 2026: leading Monday through trailing Sunday, whole weeks, 31 in-month days", () => {
    const grid = monthGridDays("2026-08", 1);
    expect(grid.length % 7).toBe(0);
    expect(grid[0]?.key).toBe("2026-07-27");
    expect(grid.at(-1)?.key).toBe("2026-09-06");
    const inMonth = grid.filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0]?.key).toBe("2026-08-01");
    expect(inMonth.at(-1)?.key).toBe("2026-08-31");
  });

  it("Feb 2027 starts on a Monday: exactly 28 entries, all in-month", () => {
    const grid = monthGridDays("2027-02", 1);
    expect(grid).toHaveLength(28);
    expect(grid.every((d) => d.inMonth)).toBe(true);
    expect(grid[0]?.key).toBe("2027-02-01");
    expect(grid.at(-1)?.key).toBe("2027-02-28");
  });

  it("firstDayOfWeek changes the grid for the same month", () => {
    const mondayFirst = monthGridDays("2026-08", 1);
    const sundayFirst = monthGridDays("2026-08", 0);
    expect(mondayFirst[0]?.key).not.toBe(sundayFirst[0]?.key);
  });

  it("includes the leap day for Feb 2028", () => {
    const grid = monthGridDays("2028-02", 1);
    expect(grid.some((d) => d.key === "2028-02-29" && d.inMonth)).toBe(true);
  });

  it("throws TypeError on a malformed month key", () => {
    expect(() => monthGridDays("2026-13", 1)).toThrow(TypeError);
    expect(() => monthGridDays("2026-8", 1)).toThrow(TypeError);
    expect(() => monthGridDays("2026-08-01", 1)).toThrow(TypeError);
  });
});

describe("weekOpeningDayKey", () => {
  it("answers the day itself when the week opens on it", () => {
    // 2026-08-03 is a Monday.
    expect(weekOpeningDayKey("2026-08-03", 1)).toBe("2026-08-03");
    // 2026-08-02 is a Sunday.
    expect(weekOpeningDayKey("2026-08-02", 0)).toBe("2026-08-02");
  });

  it("reads the same day into two different weeks under the two preferences", () => {
    // The whole reason the preference is a parameter: a Sunday belongs to the
    // week ENDING on it under a Monday-first calendar and to the week STARTING
    // on it under a Sunday-first one, and a figure that guessed would be a week
    // out for half the world.
    expect(weekOpeningDayKey("2026-08-02", 1)).toBe("2026-07-27");
    expect(weekOpeningDayKey("2026-08-02", 0)).toBe("2026-08-02");
  });

  it("crosses a month and a year boundary", () => {
    expect(weekOpeningDayKey("2026-08-01", 1)).toBe("2026-07-27");
    // 2026-01-01 is a Thursday.
    expect(weekOpeningDayKey("2026-01-01", 1)).toBe("2025-12-29");
  });

  it("survives a spring-forward day, because the arithmetic is UTC", () => {
    // 2026-03-29 is the European DST switch; a local-time step lands on the
    // same calendar day twice and silently loses one.
    expect(weekOpeningDayKey("2026-03-29", 1)).toBe("2026-03-23");
  });

  it("is exactly the first day `weekDayKeys` lays out, at both preferences", () => {
    // The two must never drift: `weekDayKeys` is built on this function
    // precisely so there is one definition, and this pins that.
    for (const day of ["2026-08-02", "2026-01-01", "2026-03-29", "2026-12-31"]) {
      for (const start of [0, 1] as const) {
        expect(weekOpeningDayKey(day, start)).toBe(weekDayKeys(day, start)[0]);
      }
    }
  });
});

describe("weekDayKeys", () => {
  it("crosses a month boundary", () => {
    // 2026-08-02 is a Sunday; the Monday-first week starts in July.
    expect(weekDayKeys("2026-08-02", 1)).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
      "2026-08-02",
    ]);
  });

  it("crosses a year boundary", () => {
    // 2026-01-01 is a Thursday; the Monday-first week starts in December 2025.
    expect(weekDayKeys("2026-01-01", 1)).toEqual([
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
  });

  it("throws TypeError on a malformed day key", () => {
    expect(() => weekDayKeys("2026-02-30", 1)).toThrow(TypeError);
  });
});

describe("isoWeekNumber", () => {
  // The seven ways a year can open. ISO week 1 is the week holding the first
  // Thursday, so 1 January belongs to week 1 only from Monday through Thursday;
  // Friday, Saturday and Sunday hand it back to the previous year's last week.
  it("Jan 1 on Monday through Thursday is week 1", () => {
    expect(isoWeekNumber("2024-01-01")).toBe(1); // Monday
    expect(isoWeekNumber("2030-01-01")).toBe(1); // Tuesday
    expect(isoWeekNumber("2025-01-01")).toBe(1); // Wednesday
    expect(isoWeekNumber("2026-01-01")).toBe(1); // Thursday
  });

  it("Jan 1 on Friday, Saturday or Sunday belongs to the previous year's last week", () => {
    expect(isoWeekNumber("2021-01-01")).toBe(53); // Friday — 2020 was a 53-week year
    expect(isoWeekNumber("2022-01-01")).toBe(52); // Saturday
    expect(isoWeekNumber("2023-01-01")).toBe(52); // Sunday
  });

  it("counts week 53 in the years that have one", () => {
    expect(isoWeekNumber("2015-12-31")).toBe(53); // Thursday — 2015 has 53 weeks
    expect(isoWeekNumber("2020-12-31")).toBe(53); // Thursday — so does 2020
    expect(isoWeekNumber("2026-12-31")).toBe(53); // Thursday — and 2026
    expect(isoWeekNumber("2021-01-03")).toBe(53); // still 2020's week 53
    expect(isoWeekNumber("2021-01-04")).toBe(1); // the Monday that opens 2021
  });

  it("counts a 52-week year's last week as 52", () => {
    expect(isoWeekNumber("2027-12-31")).toBe(52); // Friday, in 2027's last week
    expect(isoWeekNumber("2025-12-28")).toBe(52); // the Sunday that closes 2025
  });

  it("late December can already belong to next year's week 1", () => {
    expect(isoWeekNumber("2019-12-31")).toBe(1); // Tuesday, in 2020's week 1
    expect(isoWeekNumber("2024-12-30")).toBe(1); // the Monday that opens 2025
    expect(isoWeekNumber("2024-12-31")).toBe(1);
  });

  it("numbers a whole week identically, Monday through Sunday", () => {
    const week = weekDayKeys("2026-07-29", 1);
    expect(week.map(isoWeekNumber)).toEqual([31, 31, 31, 31, 31, 31, 31]);
  });

  it("is Monday-based whatever the display week start is: a Sunday closes its week, never opens one", () => {
    // A `weekStart: sunday` user sees 2026-08-02 first in the row; ISO still
    // reads it as the last day of week 31, and the Monday after it as week 32.
    expect(isoWeekNumber("2026-08-02")).toBe(31);
    expect(isoWeekNumber("2026-08-03")).toBe(32);
  });

  it("steps by exactly one across a week boundary mid-year", () => {
    expect(isoWeekNumber("2026-03-08")).toBe(10); // Sunday
    expect(isoWeekNumber("2026-03-09")).toBe(11); // Monday
  });

  it("throws TypeError on a malformed day key", () => {
    expect(() => isoWeekNumber("2026-02-30")).toThrow(TypeError);
    expect(() => isoWeekNumber("2026-01")).toThrow(TypeError);
  });
});

describe("shiftDayKey", () => {
  it("crosses a month end forward", () => {
    expect(shiftDayKey("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("crosses a year end forward", () => {
    expect(shiftDayKey("2025-12-31", 1)).toBe("2026-01-01");
  });

  it("shifts backwards across a year start", () => {
    expect(shiftDayKey("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("throws TypeError on a malformed day key or non-integer shift", () => {
    expect(() => shiftDayKey("2026-02-30", 1)).toThrow(TypeError);
    expect(() => shiftDayKey("2026-01-01", 1.5)).toThrow(TypeError);
  });
});

describe("shiftMonthKey", () => {
  it("crosses a year end forward", () => {
    expect(shiftMonthKey("2026-12", 1)).toBe("2027-01");
  });

  it("shifts backwards across a year start", () => {
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
  });

  it("throws TypeError on a malformed month key or non-integer shift", () => {
    expect(() => shiftMonthKey("2026-13", 1)).toThrow(TypeError);
    expect(() => shiftMonthKey("2026-01", 2.2)).toThrow(TypeError);
  });
});

describe("daySpanKeys", () => {
  it("returns a single key for a single day", () => {
    expect(daySpanKeys("2026-07-10", "2026-07-10")).toEqual(["2026-07-10"]);
  });

  it("returns inclusive keys for a three-day span", () => {
    expect(daySpanKeys("2026-07-10", "2026-07-12")).toEqual([
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ]);
  });

  it("defends against reversed input by returning just the start key", () => {
    expect(daySpanKeys("2026-07-12", "2026-07-10")).toEqual(["2026-07-12"]);
  });

  it("truncates a span longer than MAX_SPAN_DAYS", () => {
    const keys = daySpanKeys("2026-01-01", "2027-12-31");
    expect(keys).toHaveLength(MAX_SPAN_DAYS);
    expect(keys[0]).toBe("2026-01-01");
    expect(keys.at(-1)).toBe("2027-01-01");
  });

  it("throws TypeError on a malformed day key", () => {
    expect(() => daySpanKeys("2026-13-01", "2026-07-12")).toThrow(TypeError);
    expect(() => daySpanKeys("2026-07-10", "2026-02-30")).toThrow(TypeError);
    expect(() => daySpanKeys("26-01-01", "2026-07-12")).toThrow(TypeError);
    expect(() => daySpanKeys("2026-01", "2026-07-12")).toThrow(TypeError);
  });
});

describe("layoutMonthBars", () => {
  // Monday 2026-08-03 through Sunday 2026-08-09.
  const week = [
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
    "2026-08-08",
    "2026-08-09",
  ];

  it("throws TypeError for a week row that is not exactly 7 ascending keys", () => {
    expect(() => layoutMonthBars([], week.slice(0, 6))).toThrow(TypeError);
    expect(() => layoutMonthBars([], [...week].reverse())).toThrow(TypeError);
  });

  // Ascending is not enough: bar geometry is measured from the row's first day,
  // so a gap would place bars past the last column instead of failing.
  it("throws TypeError for a week row with a gap in it", () => {
    const gapped = [...week.slice(0, 6), "2026-08-10"];
    expect(() => layoutMonthBars([], gapped)).toThrow(TypeError);
  });

  it("places an item wholly inside the row without continuation flags", () => {
    const items: SpanItem[] = [
      { id: "a", startKey: "2026-08-04", endKey: "2026-08-05" },
    ];
    expect(layoutMonthBars(items, week)).toEqual([
      {
        id: "a",
        dayIndex: 1,
        span: 2,
        lane: 0,
        continuesBefore: false,
        continuesAfter: false,
      },
    ]);
  });

  it("clips an item that spans past both edges of the row", () => {
    const items: SpanItem[] = [
      { id: "a", startKey: "2026-08-01", endKey: "2026-08-31" },
    ];
    expect(layoutMonthBars(items, week)).toEqual([
      {
        id: "a",
        dayIndex: 0,
        span: 7,
        lane: 0,
        continuesBefore: true,
        continuesAfter: true,
      },
    ]);
  });

  it("omits an item that does not intersect the row", () => {
    const items: SpanItem[] = [
      { id: "a", startKey: "2026-07-01", endKey: "2026-07-31" },
    ];
    expect(layoutMonthBars(items, week)).toEqual([]);
  });

  it("assigns lanes 0/1/2 to three mutually overlapping items", () => {
    const items: SpanItem[] = [
      { id: "c", startKey: "2026-08-03", endKey: "2026-08-09" },
      { id: "a", startKey: "2026-08-03", endKey: "2026-08-09" },
      { id: "b", startKey: "2026-08-03", endKey: "2026-08-09" },
    ];
    const bars = layoutMonthBars(items, week);
    expect(bars.map((b) => [b.id, b.lane])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("shares lane 0 between two items that do not overlap", () => {
    const items: SpanItem[] = [
      { id: "a", startKey: "2026-08-03", endKey: "2026-08-04" },
      { id: "b", startKey: "2026-08-05", endKey: "2026-08-06" },
    ];
    const bars = layoutMonthBars(items, week);
    expect(bars.map((b) => [b.id, b.lane])).toEqual([
      ["a", 0],
      ["b", 0],
    ]);
  });

  it("treats an item ending where another starts as overlapping (same day column)", () => {
    const items: SpanItem[] = [
      { id: "a", startKey: "2026-08-03", endKey: "2026-08-05" },
      { id: "b", startKey: "2026-08-05", endKey: "2026-08-07" },
    ];
    const bars = layoutMonthBars(items, week);
    expect(bars.map((b) => [b.id, b.lane])).toEqual([
      ["a", 0],
      ["b", 1],
    ]);
  });

  it("orders output by startKey, then longer span first, then id", () => {
    const items: SpanItem[] = [
      { id: "z", startKey: "2026-08-04", endKey: "2026-08-04" },
      { id: "a", startKey: "2026-08-03", endKey: "2026-08-03" },
      { id: "b", startKey: "2026-08-03", endKey: "2026-08-09" },
    ];
    const bars = layoutMonthBars(items, week);
    expect(bars.map((b) => b.id)).toEqual(["b", "a", "z"]);
  });
});

describe("layoutTimedColumns", () => {
  it("gives both column 0 (columns 1) to two non-overlapping items", () => {
    const items: TimedItem[] = [
      { id: "a", startMinutes: 0, endMinutes: 60 },
      { id: "b", startMinutes: 120, endMinutes: 180 },
    ];
    expect(layoutTimedColumns(items)).toEqual([
      { id: "a", column: 0, columns: 1, startMinutes: 0, endMinutes: 60 },
      { id: "b", column: 0, columns: 1, startMinutes: 120, endMinutes: 180 },
    ]);
  });

  it("gives columns 0 and 1 to two overlapping items", () => {
    const items: TimedItem[] = [
      { id: "a", startMinutes: 0, endMinutes: 90 },
      { id: "b", startMinutes: 60, endMinutes: 150 },
    ];
    const cols = layoutTimedColumns(items);
    expect(cols.map((c) => [c.id, c.column, c.columns])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
    ]);
  });

  it("reports the same columns count for a chained cluster of three", () => {
    const items: TimedItem[] = [
      { id: "one", startMinutes: 0, endMinutes: 60 },
      { id: "two", startMinutes: 30, endMinutes: 90 },
      { id: "three", startMinutes: 80, endMinutes: 120 },
    ];
    const cols = layoutTimedColumns(items);
    const columnsCounts = new Set(cols.map((c) => c.columns));
    expect(columnsCounts.size).toBe(1);
    expect(cols.map((c) => c.id)).toEqual(["one", "two", "three"]);
  });

  it("treats touching items (end === start) as separate clusters", () => {
    const items: TimedItem[] = [
      { id: "a", startMinutes: 0, endMinutes: 60 },
      { id: "b", startMinutes: 60, endMinutes: 120 },
    ];
    expect(layoutTimedColumns(items)).toEqual([
      { id: "a", column: 0, columns: 1, startMinutes: 0, endMinutes: 60 },
      { id: "b", column: 0, columns: 1, startMinutes: 60, endMinutes: 120 },
    ]);
  });

  it("clamps a zero-length item to MIN_TIMED_MINUTES", () => {
    const items: TimedItem[] = [{ id: "a", startMinutes: 100, endMinutes: 100 }];
    expect(layoutTimedColumns(items)).toEqual([
      { id: "a", column: 0, columns: 1, startMinutes: 100, endMinutes: 100 + MIN_TIMED_MINUTES },
    ]);
  });

  it("clamps an item ending past midnight to MINUTES_PER_DAY", () => {
    const items: TimedItem[] = [{ id: "a", startMinutes: 1400, endMinutes: 1500 }];
    expect(layoutTimedColumns(items)).toEqual([
      { id: "a", column: 0, columns: 1, startMinutes: 1400, endMinutes: MINUTES_PER_DAY },
    ]);
  });

  it("pulls the start back when a near-midnight zero-length item would overflow", () => {
    const items: TimedItem[] = [
      { id: "a", startMinutes: MINUTES_PER_DAY, endMinutes: MINUTES_PER_DAY },
    ];
    expect(layoutTimedColumns(items)).toEqual([
      {
        id: "a",
        column: 0,
        columns: 1,
        startMinutes: MINUTES_PER_DAY - MIN_TIMED_MINUTES,
        endMinutes: MINUTES_PER_DAY,
      },
    ]);
  });

  it("is not affected by input order", () => {
    const a: TimedItem = { id: "a", startMinutes: 0, endMinutes: 90 };
    const b: TimedItem = { id: "b", startMinutes: 60, endMinutes: 150 };
    const c: TimedItem = { id: "c", startMinutes: 200, endMinutes: 260 };
    expect(layoutTimedColumns([a, b, c])).toEqual(layoutTimedColumns([c, b, a]));
  });

  it("throws TypeError on a non-finite or non-integer minute value", () => {
    expect(() =>
      layoutTimedColumns([{ id: "a", startMinutes: 0, endMinutes: Number.NaN }]),
    ).toThrow(TypeError);
    expect(() =>
      layoutTimedColumns([{ id: "a", startMinutes: 10.5, endMinutes: 60 }]),
    ).toThrow(TypeError);
  });
});
