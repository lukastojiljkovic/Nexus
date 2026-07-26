import { describe, it, expect } from "vitest";
import {
  MAX_SPAN_DAYS,
  MIN_TIMED_MINUTES,
  MINUTES_PER_DAY,
  daySpanKeys,
  layoutMonthBars,
  layoutTimedColumns,
  monthGridDays,
  monthKeyOf,
  shiftDayKey,
  shiftMonthKey,
  weekDayKeys,
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
