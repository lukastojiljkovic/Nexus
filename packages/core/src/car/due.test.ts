import { describe, expect, it } from "vitest";

import { addMonthsClamped, daysBetween } from "./dates.js";
import { whatIsDue, type ServiceIntervalSpec, type ServiceRecord } from "./due.js";

const SOON = { days: 30, distance: 1_000 };

function interval(
  category: ServiceIntervalSpec["category"],
  everyKm: number | null,
  everyMonths: number | null,
): ServiceIntervalSpec {
  return { category, everyKm, everyMonths };
}

function service(
  category: ServiceRecord["category"],
  date: string,
  odometer: number | null,
): ServiceRecord {
  return { category, date, odometer };
}

describe("addMonthsClamped", () => {
  it("adds whole months", () => {
    expect(addMonthsClamped("2026-01-15", 1)).toBe("2026-02-15");
    expect(addMonthsClamped("2025-06-01", 12)).toBe("2026-06-01");
    expect(addMonthsClamped("2026-06-01", 18)).toBe("2027-12-01");
  });

  it("clamps a month-end to the last day of a shorter month", () => {
    // 31 January + 1 month is 28 February in 2026 and 29 February in 2028.
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamped("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsClamped("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonthsClamped("2026-08-31", 6)).toBe("2027-02-28");
  });

  it("answers null for a day that does not exist", () => {
    expect(addMonthsClamped("2026-02-30", 1)).toBeNull();
    expect(addMonthsClamped("2026-1-1", 1)).toBeNull();
  });
});

describe("daysBetween", () => {
  it("counts whole days, signed", () => {
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
    expect(daysBetween("2026-01-31", "2026-01-01")).toBe(-30);
    expect(daysBetween("2026-01-31", "2026-03-01")).toBe(29);
    expect(daysBetween("2026-05-20", "2026-06-01")).toBe(12);
  });
});

describe("whatIsDue", () => {
  it("counts down a distance interval and calls it soon inside the threshold", () => {
    // Due at 10 000 + 10 000 = 20 000 km; the estimate for today is 19 500, so
    // 500 km are left of a 1 000 km warning.
    const [due] = whatIsDue({
      intervals: [interval("oil", 10_000, null)],
      services: [service("oil", "2026-01-01", 10_000)],
      today: "2026-02-01",
      estimatedOdometer: 19_500,
      thresholds: SOON,
    });
    expect(due).toEqual({
      category: "oil",
      dueDate: null,
      dueOdometer: 20_000,
      remainingDays: null,
      remainingDistance: 500,
      status: "soon",
      by: "distance",
    });
  });

  it("puts the distance status on its exact boundaries", () => {
    const remaining = (estimatedOdometer: number): string | undefined =>
      whatIsDue({
        intervals: [interval("tyres", 10_000, null)],
        services: [service("tyres", "2026-01-01", 10_000)],
        today: "2026-02-01",
        estimatedOdometer,
        thresholds: SOON,
      })[0]?.status;
    // Due at 20 000: 1 001 km left is still fine, 1 000 is the edge of the
    // warning, the day it is due is still soon rather than late, and a
    // kilometre past it is overdue.
    expect(remaining(18_999)).toBe("ok");
    expect(remaining(19_000)).toBe("soon");
    expect(remaining(20_000)).toBe("soon");
    expect(remaining(20_001)).toBe("overdue");
  });

  it("counts down a time interval and puts its status on the exact boundaries", () => {
    const remaining = (today: string): string | undefined =>
      whatIsDue({
        intervals: [interval("registration", null, 12)],
        services: [service("registration", "2025-06-01", null)],
        today,
        estimatedOdometer: null,
        thresholds: SOON,
      })[0]?.status;
    // Due 2026-06-01: 31 days before it is still fine, 30 days before it is
    // soon, on the day itself it is soon, and the day after it is overdue.
    expect(remaining("2026-05-01")).toBe("ok");
    expect(remaining("2026-05-02")).toBe("soon");
    expect(remaining("2026-06-01")).toBe("soon");
    expect(remaining("2026-06-02")).toBe("overdue");
  });

  it("gives whichever of distance and time comes first the deciding vote", () => {
    const input = {
      intervals: [interval("oil", 10_000, 12)],
      services: [service("oil", "2026-01-01", 10_000)],
      thresholds: SOON,
    };
    // 500 km to go against a year of calendar: the odometer decides.
    expect(
      whatIsDue({ ...input, today: "2026-02-01", estimatedOdometer: 19_500 }),
    ).toEqual([
      {
        category: "oil",
        dueDate: "2027-01-01",
        dueOdometer: 20_000,
        remainingDays: 334,
        remainingDistance: 500,
        status: "soon",
        by: "distance",
      },
    ]);
    // Same interval, a year later: the calendar decides while 8 000 km remain.
    expect(
      whatIsDue({ ...input, today: "2026-12-20", estimatedOdometer: 12_000 }),
    ).toEqual([
      {
        category: "oil",
        dueDate: "2027-01-01",
        dueOdometer: 20_000,
        remainingDays: 12,
        remainingDistance: 8_000,
        status: "soon",
        by: "date",
      },
    ]);
  });

  it("lets the worse of the two decide when both are due", () => {
    expect(
      whatIsDue({
        intervals: [interval("oil", 10_000, 12)],
        services: [service("oil", "2026-01-01", 10_000)],
        today: "2027-02-01",
        estimatedOdometer: 21_000,
        thresholds: SOON,
      }),
    ).toEqual([
      {
        category: "oil",
        dueDate: "2027-01-01",
        dueOdometer: 20_000,
        remainingDays: -31,
        remainingDistance: -1_000,
        status: "overdue",
        by: "date",
      },
    ]);
  });

  it("answers with two nulls and no opinion for a category never serviced", () => {
    expect(
      whatIsDue({
        intervals: [interval("timing-belt", 120_000, 60)],
        services: [service("oil", "2026-01-01", 10_000)],
        today: "2026-02-01",
        estimatedOdometer: 19_500,
        thresholds: SOON,
      }),
    ).toEqual([
      {
        category: "timing-belt",
        dueDate: null,
        dueOdometer: null,
        remainingDays: null,
        remainingDistance: null,
        status: "ok",
        by: null,
      },
    ]);
  });

  it("measures a distance interval from the LAST service of that category", () => {
    const [due] = whatIsDue({
      intervals: [interval("oil", 10_000, null)],
      services: [
        service("oil", "2025-01-01", 10_000),
        service("oil", "2026-01-01", 30_500),
        service("brakes", "2026-01-15", 31_000),
      ],
      today: "2026-02-01",
      estimatedOdometer: 31_000,
      thresholds: SOON,
    });
    expect(due?.dueOdometer).toBe(40_500);
  });

  it("cannot count distance from a service recorded without an odometer", () => {
    expect(
      whatIsDue({
        intervals: [interval("oil", 10_000, 12)],
        services: [service("oil", "2026-01-01", null)],
        today: "2026-02-01",
        estimatedOdometer: 19_500,
        thresholds: SOON,
      })[0],
    ).toMatchObject({ dueOdometer: null, remainingDistance: null, dueDate: "2027-01-01" });
  });

  it("judges the time half alone when there is no odometer estimate", () => {
    expect(
      whatIsDue({
        intervals: [interval("inspection", 20_000, 24)],
        services: [service("inspection", "2025-01-15", 10_000)],
        today: "2026-12-20",
        estimatedOdometer: null,
        thresholds: SOON,
      })[0],
    ).toEqual({
      category: "inspection",
      dueDate: "2027-01-15",
      dueOdometer: 30_000,
      remainingDays: 26,
      remainingDistance: null,
      status: "soon",
      by: "date",
    });
  });

  /**
   * The order, and why it is this one: the most urgent status first, then the
   * soonest deadline. A distance deadline has no date and a date has no
   * odometer, so the two cannot be interleaved honestly — dated rows come first
   * inside a status, the undated ones follow in odometer order, and a category
   * name is the last word. Nothing here invents a conversion between days and
   * kilometres, which is the only way the alternative could work.
   */
  it("lists the most urgent first, then by the deadline, then by category", () => {
    const due = whatIsDue({
      intervals: [
        interval("oil", 10_000, null),
        interval("tyres", 5_000, null),
        interval("registration", null, 12),
        interval("brakes", 8_000, null),
      ],
      services: [
        service("oil", "2026-01-01", 10_000),
        service("tyres", "2026-01-01", 10_000),
        service("registration", "2025-09-01", null),
        service("brakes", "2026-01-01", 10_000),
      ],
      today: "2026-02-01",
      estimatedOdometer: 15_500,
      thresholds: SOON,
    });
    // tyres: 15 000 due, 500 past → overdue. registration: due 2026-09-01, 212
    // days away → ok, and the only ok row with a date, so it leads that group.
    // Then brakes (18 000 due, 2 500 left) before oil (20 000 due, 4 500 left).
    expect(due.map((each) => [each.category, each.status, each.by])).toEqual([
      ["tyres", "overdue", "distance"],
      ["registration", "ok", null],
      ["brakes", "ok", null],
      ["oil", "ok", null],
    ]);
  });

  it("breaks a tie between two distance deadlines by odometer, not by name", () => {
    const due = whatIsDue({
      intervals: [interval("oil", 10_000, null), interval("brakes", 8_000, null)],
      services: [service("oil", "2026-01-01", 10_000), service("brakes", "2026-01-01", 10_000)],
      today: "2026-02-01",
      estimatedOdometer: 10_500,
      thresholds: SOON,
    });
    // brakes is due at 18 000 and oil at 20 000, so brakes comes first even
    // though both are `ok` and neither has a date.
    expect(due.map((each) => [each.category, each.dueOdometer])).toEqual([
      ["brakes", 18_000],
      ["oil", 20_000],
    ]);
  });
});
