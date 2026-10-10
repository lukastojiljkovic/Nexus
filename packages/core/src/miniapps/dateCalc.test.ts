import { describe, expect, it } from "vitest";
import {
  addToDate,
  dateDifference,
  isSerbianHoliday,
  orthodoxEaster,
  serbianHolidays,
  serbianNonWorkingDays,
  weekdayOf,
  workdaysBetween,
} from "./dateCalc.js";

describe("addToDate", () => {
  it("adds days, weeks, months and years", () => {
    expect(addToDate("2026-01-01", { days: 1 })).toBe("2026-01-02");
    expect(addToDate("2026-01-01", { weeks: 2 })).toBe("2026-01-15");
    expect(addToDate("2026-01-15", { months: 1 })).toBe("2026-02-15");
    expect(addToDate("2026-01-15", { years: 1 })).toBe("2027-01-15");
    expect(addToDate("2026-12-31", { days: 1 })).toBe("2027-01-01");
    expect(addToDate("2026-03-09", { days: -1 })).toBe("2026-03-08");
  });

  it("lands on the last day of the shorter month, as the brief requires", () => {
    // 31 January + 1 month has no 31 February to land on.
    expect(addToDate("2026-01-31", { months: 1 })).toBe("2026-02-28");
    expect(addToDate("2024-01-31", { months: 1 })).toBe("2024-02-29");
    expect(addToDate("2026-03-31", { months: -1 })).toBe("2026-02-28");
    expect(addToDate("2024-02-29", { years: 1 })).toBe("2025-02-28");
    expect(addToDate("2026-05-31", { months: -3 })).toBe("2026-02-28");
  });

  it("applies years, then months, then weeks, then days", () => {
    // 31 January + 1 month is 28 February, and + 1 day from there is 1 March.
    expect(addToDate("2026-01-31", { months: 1, days: 1 })).toBe("2026-03-01");
    expect(addToDate("2026-01-31", { days: 1, months: 1 })).toBe("2026-03-01");
  });

  it("refuses a date that is not on the calendar, or a unit that is not whole", () => {
    expect(() => addToDate("2026-02-30", { days: 1 })).toThrow(RangeError);
    expect(() => addToDate("2026-13-01", { days: 1 })).toThrow(RangeError);
    expect(() => addToDate("2026-1-1", { days: 1 })).toThrow(RangeError);
    expect(() => addToDate("2026-01-01", { days: 1.5 })).toThrow(RangeError);
    expect(() => addToDate("2026-01-01", { months: Number.NaN })).toThrow(RangeError);
  });
});

describe("dateDifference", () => {
  it("counts whole days and a calendar difference", () => {
    expect(dateDifference("2026-01-01", "2026-03-01")).toEqual({
      totalDays: 59, // 31 days of January + 28 of February
      years: 0,
      months: 2,
      days: 0,
    });
  });

  it("borrows when the day of month runs backwards", () => {
    // 31 January + 1 month is 28 February; one more day is 1 March.
    expect(dateDifference("2026-01-31", "2026-03-01")).toEqual({
      totalDays: 29,
      years: 0,
      months: 1,
      days: 1,
    });
    // 29 February 2024 clamps forward exactly one year to 28 February 2025,
    // which is why the greedy walk prefers it to "11 months and 30 days".
    expect(dateDifference("2024-02-29", "2025-02-28")).toEqual({
      totalDays: 365,
      years: 1,
      months: 0,
      days: 0,
    });
  });

  it("is signed when the second date is the earlier one", () => {
    expect(dateDifference("2026-01-01", "2025-01-01")).toEqual({
      totalDays: -365,
      years: -1,
      months: 0,
      days: 0,
    });
  });

  it("is zero against itself", () => {
    expect(dateDifference("2026-07-04", "2026-07-04")).toEqual({
      totalDays: 0,
      years: 0,
      months: 0,
      days: 0,
    });
  });

  it("reads back through addToDate, which is what makes both directions one rule", () => {
    const pairs: readonly (readonly [string, string])[] = [
      ["2026-01-01", "2026-03-01"],
      ["2026-01-31", "2026-03-01"],
      ["2024-02-29", "2025-02-28"],
      ["2020-02-29", "2024-02-29"],
      ["2026-11-30", "2027-03-01"],
      ["1999-12-31", "2000-03-01"],
    ];
    for (const [from, to] of pairs) {
      const { years, months, days } = dateDifference(from, to);
      expect(addToDate(from, { years, months, days })).toBe(to);
    }
  });
});

describe("orthodoxEaster", () => {
  it("matches the published table of Julian (Orthodox) Easter dates", () => {
    // Wikipedia, "List of dates for Easter", the "Julian Easter" column
    // (retrieved 2026-10-09), whose dates are Gregorian.
    const published: Readonly<Record<number, string>> = {
      2016: "2016-05-01",
      2017: "2017-04-16",
      2018: "2018-04-08",
      2019: "2019-04-28",
      2020: "2020-04-19",
      2021: "2021-05-02",
      2022: "2022-04-24",
      2023: "2023-04-16",
      2024: "2024-05-05",
      2025: "2025-04-20",
      2026: "2026-04-12",
      2027: "2027-05-02",
      2028: "2028-04-16",
      2029: "2029-04-08",
      2030: "2030-04-28",
    };
    for (const [year, date] of Object.entries(published)) {
      expect(orthodoxEaster(Number(year))).toBe(date);
    }
  });

  it("always lands on a Sunday, which is what Easter is", () => {
    for (let year = 1900; year <= 2100; year += 1) {
      expect(weekdayOf(orthodoxEaster(year))).toBe(7);
    }
  });
});

describe("serbianHolidays", () => {
  it("lists the state and religious holidays of 2026 with the days they cover", () => {
    expect(serbianHolidays(2026)).toEqual([
      {
        id: "nova-godina",
        kind: "state",
        dates: ["2026-01-01", "2026-01-02"],
        nonWorking: true,
      },
      { id: "bozic", kind: "religious", dates: ["2026-01-07"], nonWorking: true },
      {
        id: "sretenje",
        kind: "state",
        dates: ["2026-02-15", "2026-02-16"],
        nonWorking: true,
      },
      {
        id: "vaskrs",
        kind: "religious",
        dates: ["2026-04-10", "2026-04-11", "2026-04-12", "2026-04-13"],
        nonWorking: true,
      },
      {
        id: "praznik-rada",
        kind: "state",
        dates: ["2026-05-01", "2026-05-02"],
        nonWorking: true,
      },
      { id: "dan-pobede", kind: "state", dates: ["2026-05-09"], nonWorking: false },
      { id: "dan-primirja", kind: "state", dates: ["2026-11-11"], nonWorking: true },
    ]);
  });

  it("runs Vaskrs from Good Friday through the second day of Easter", () => {
    const vaskrs = serbianHolidays(2021).find((holiday) => holiday.id === "vaskrs");
    // Orthodox Easter 2021 was Sunday 2 May, so Good Friday is 30 April.
    expect(vaskrs?.dates).toEqual(["2021-04-30", "2021-05-01", "2021-05-02", "2021-05-03"]);
  });
});

describe("serbianNonWorkingDays", () => {
  it("adds the substitute day when a state holiday falls on a Sunday", () => {
    // 15 February 2026 is a Sunday and 16 February is already Sretenje, so the
    // first following working day, Tuesday 17 February, is the day off. The
    // published calendar for 2026 lists exactly that ("Sretenje ... +").
    expect(serbianNonWorkingDays(2026)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-07",
      "2026-02-15",
      "2026-02-16",
      "2026-02-17",
      "2026-04-10",
      "2026-04-11",
      "2026-04-12",
      "2026-04-13",
      "2026-05-01",
      "2026-05-02",
      "2026-11-11",
    ]);
  });

  it("moves Praznik rada's Sunday past the Easter holidays, as 2021 did", () => {
    // 2 May 2021 was a Sunday, but Monday 3 May was already Vaskrsni ponedeljak,
    // so the first following working day was Tuesday 4 May. The Ministry of
    // Labour's opinion for 2021 says exactly that ("drugi dan Praznika rada ...
    // se prenosi na prvi naredni radni dan, utorak - 4. maj"), and it is the
    // second day of Praznik rada that moves, not the first.
    expect(serbianNonWorkingDays(2021)).toEqual([
      "2021-01-01",
      "2021-01-02",
      "2021-01-07",
      "2021-02-15",
      "2021-02-16",
      "2021-04-30",
      "2021-05-01",
      "2021-05-02",
      "2021-05-03",
      "2021-05-04",
      "2021-11-11",
    ]);
  });

  it("does not move a Sunday for a religious holiday", () => {
    // 7 January 2024 was a Sunday, and Monday 8 January was a working day: the
    // law's substitute rule names state holidays only.
    expect(serbianNonWorkingDays(2024)).not.toContain("2024-01-08");
    expect(isSerbianHoliday("2024-01-07")).toBe(true);
    expect(isSerbianHoliday("2024-01-08")).toBe(false);
  });

  it("does not move Dan pobede, which the law says is celebrated working", () => {
    // 9 May 2021 was a Sunday and Monday 10 May was a working day: Dan pobede is
    // in the law's list of state holidays but is not a day off, so the
    // substitute rule has nothing to move.
    expect(serbianNonWorkingDays(2021)).not.toContain("2021-05-10");
    expect(isSerbianHoliday("2026-05-09")).toBe(false);
  });

  it("refuses a date that is not one", () => {
    expect(() => isSerbianHoliday("09.10.2026")).toThrow(RangeError);
    expect(() => isSerbianHoliday("2026-02-30")).toThrow(RangeError);
    expect(serbianNonWorkingDays(2026)).not.toContain("2026-02-30");
  });
});

describe("workdaysBetween", () => {
  it("counts a plain week from Monday to the next Monday", () => {
    // 1-5 June 2026 are Monday to Friday and no holiday falls in the window.
    expect(weekdayOf("2026-06-01")).toBe(1);
    expect(workdaysBetween("2026-06-01", "2026-06-08")).toBe(5);
  });

  it("skips weekends and holidays alike", () => {
    // 1-7 January 2026: Thursday 1 and Friday 2 are Nova godina, Wednesday 7 is
    // Bozic, 3-4 are the weekend, so only Monday 5 and Tuesday 6 count.
    expect(workdaysBetween("2026-01-01", "2026-01-08")).toBe(2);
    // The window is half-open, so "2026-04-06" to "2026-04-14" holds the 6th to
    // the 13th: Good Friday 10, Holy Saturday 11, Easter 12 and Easter Monday 13
    // are all holidays, and the 11th and 12th are the weekend anyway.
    expect(workdaysBetween("2026-04-06", "2026-04-14")).toBe(4);
    expect(workdaysBetween("2026-04-06", "2026-04-15")).toBe(5);
  });

  it("counts the half-open window, so adjacent windows join", () => {
    const whole = workdaysBetween("2026-06-01", "2026-06-15");
    const joined =
      workdaysBetween("2026-06-01", "2026-06-08") + workdaysBetween("2026-06-08", "2026-06-15");
    expect(joined).toBe(whole);
    expect(workdaysBetween("2026-06-01", "2026-06-01")).toBe(0);
  });

  it("goes negative when the second date is the earlier one", () => {
    expect(workdaysBetween("2026-06-08", "2026-06-01")).toBe(-5);
  });
});
