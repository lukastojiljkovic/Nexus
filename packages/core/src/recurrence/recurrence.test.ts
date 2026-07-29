import { describe, it, expect } from "vitest";
import {
  DEFAULT_OCCURRENCE_LIMIT,
  MAX_RECURRENCE_COUNT,
  MAX_RECURRENCE_INTERVAL,
  nextOccurrenceDate,
  occurrenceDatesInRange,
  serializeRecurrenceRule,
  validateRecurrenceRule,
  type RecurrenceEnd,
  type RecurrenceFreq,
  type RecurrenceRule,
} from "./recurrence.js";

/** A rule that never ends — the default for every expansion test that is not about the end condition. */
function forever(freq: RecurrenceFreq): RecurrenceRule {
  return { freq, end: { kind: "never" } };
}

function ending(freq: RecurrenceFreq, end: RecurrenceEnd): RecurrenceRule {
  return { freq, end };
}

// Weekday indices used throughout, spelled out once (0 = Monday).
const MON = 0;
const THU = 3;
const FRI = 4;

describe("occurrenceDatesInRange — daily", () => {
  it("includes the anchor and every following day at interval 1", () => {
    const rule = forever({ kind: "daily", interval: 1 });
    expect(
      occurrenceDatesInRange(rule, "2026-03-01", { from: "2026-03-01", to: "2026-03-05" }),
    ).toEqual(["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]);
  });

  it("phases every third day from the anchor", () => {
    const rule = forever({ kind: "daily", interval: 3 });
    expect(
      occurrenceDatesInRange(rule, "2026-03-01", { from: "2026-03-01", to: "2026-03-10" }),
    ).toEqual(["2026-03-01", "2026-03-04", "2026-03-07", "2026-03-10"]);
  });

  it("keeps the anchor's phase when the range starts years later", () => {
    const rule = forever({ kind: "daily", interval: 7 });
    expect(
      occurrenceDatesInRange(rule, "2020-01-01", { from: "2026-03-01", to: "2026-03-31" }),
    ).toEqual(["2026-03-04", "2026-03-11", "2026-03-18", "2026-03-25"]);
  });

  it("crosses a month and a year boundary", () => {
    const rule = forever({ kind: "daily", interval: 1 });
    expect(
      occurrenceDatesInRange(rule, "2026-12-30", { from: "2026-12-30", to: "2027-01-02" }),
    ).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("returns nothing for a range that ends before the anchor", () => {
    const rule = forever({ kind: "daily", interval: 1 });
    expect(
      occurrenceDatesInRange(rule, "2026-03-01", { from: "2026-01-01", to: "2026-02-01" }),
    ).toEqual([]);
  });

  it("returns nothing for a reversed range", () => {
    const rule = forever({ kind: "daily", interval: 1 });
    expect(
      occurrenceDatesInRange(rule, "2026-03-01", { from: "2026-03-10", to: "2026-03-01" }),
    ).toEqual([]);
  });
});

describe("occurrenceDatesInRange — weekdays", () => {
  it("skips the weekend, so a Saturday anchor is not itself an occurrence", () => {
    // 2026-03-07 is a Saturday; the series opens on Monday the 9th.
    const rule = forever({ kind: "weekdays" });
    expect(
      occurrenceDatesInRange(rule, "2026-03-07", { from: "2026-03-07", to: "2026-03-15" }),
    ).toEqual([
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-13",
    ]);
  });

  it("runs Monday through Friday across two weeks", () => {
    const rule = forever({ kind: "weekdays" });
    expect(
      occurrenceDatesInRange(rule, "2026-03-02", { from: "2026-03-02", to: "2026-03-11" }),
    ).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
    ]);
  });
});

describe("occurrenceDatesInRange — weekly", () => {
  it("does not fire on an anchor whose weekday is not in `days`", () => {
    // 2026-01-01 is a Thursday; the rule only fires on Mondays, and the Monday
    // of the anchor's own week (2025-12-29) is before the anchor.
    const rule = forever({ kind: "weekly", interval: 1, days: [MON] });
    expect(
      occurrenceDatesInRange(rule, "2026-01-01", { from: "2025-12-01", to: "2026-01-20" }),
    ).toEqual(["2026-01-05", "2026-01-12", "2026-01-19"]);
  });

  it("measures the interval from the anchor's own week, not from the first of the month", () => {
    // Anchored mid-week on a Thursday: every second week is the anchor's week,
    // then the week starting 2026-01-12.
    const rule = forever({ kind: "weekly", interval: 2, days: [THU] });
    expect(
      occurrenceDatesInRange(rule, "2026-01-01", { from: "2026-01-01", to: "2026-02-15" }),
    ).toEqual(["2026-01-01", "2026-01-15", "2026-01-29", "2026-02-12"]);
  });

  it("orders multiple weekdays inside each week, crossing week boundaries", () => {
    const rule = forever({ kind: "weekly", interval: 1, days: [MON, FRI] });
    expect(
      occurrenceDatesInRange(rule, "2026-01-01", { from: "2026-01-01", to: "2026-01-17" }),
    ).toEqual([
      "2026-01-02",
      "2026-01-05",
      "2026-01-09",
      "2026-01-12",
      "2026-01-16",
    ]);
  });

  it("emits weekdays in ascending order even when `days` is given unsorted", () => {
    const rule = forever({ kind: "weekly", interval: 1, days: [FRI, MON] });
    expect(
      occurrenceDatesInRange(rule, "2026-01-05", { from: "2026-01-05", to: "2026-01-12" }),
    ).toEqual(["2026-01-05", "2026-01-09", "2026-01-12"]);
  });
});

describe("occurrenceDatesInRange — monthly-date", () => {
  it("skips months without the day instead of clamping (Jan 31 → Mar 31)", () => {
    const rule = forever({ kind: "monthly-date", interval: 1, day: 31 });
    expect(
      occurrenceDatesInRange(rule, "2026-01-31", { from: "2026-01-01", to: "2026-06-30" }),
    ).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("phases months from the anchor's month and still skips short ones", () => {
    // Jan, Mar, May, Jul, Sep (30 days — skipped), Nov (30 — skipped), Jan 2027.
    const rule = forever({ kind: "monthly-date", interval: 2, day: 31 });
    expect(
      occurrenceDatesInRange(rule, "2026-01-31", { from: "2026-01-01", to: "2027-02-28" }),
    ).toEqual(["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31", "2027-01-31"]);
  });

  it("does not fire on an anchor whose month lacks the day", () => {
    const rule = forever({ kind: "monthly-date", interval: 1, day: 31 });
    expect(
      occurrenceDatesInRange(rule, "2026-02-01", { from: "2026-02-01", to: "2026-05-31" }),
    ).toEqual(["2026-03-31", "2026-05-31"]);
  });

  it("does not fire on a day-of-month earlier than the anchor within the anchor's own month", () => {
    const rule = forever({ kind: "monthly-date", interval: 1, day: 5 });
    expect(
      occurrenceDatesInRange(rule, "2026-03-20", { from: "2026-03-01", to: "2026-05-31" }),
    ).toEqual(["2026-04-05", "2026-05-05"]);
  });

  it("hits the leap day only in leap years", () => {
    const rule = forever({ kind: "monthly-date", interval: 12, day: 29 });
    expect(
      occurrenceDatesInRange(rule, "2028-02-29", { from: "2028-01-01", to: "2033-12-31" }),
    ).toEqual(["2028-02-29", "2032-02-29"]);
  });
});

describe("occurrenceDatesInRange — monthly-ordinal", () => {
  it("expands the first Monday of every month", () => {
    const rule = forever({ kind: "monthly-ordinal", interval: 1, ordinal: 1, weekday: MON });
    expect(
      occurrenceDatesInRange(rule, "2026-01-05", { from: "2026-01-01", to: "2026-04-30" }),
    ).toEqual(["2026-01-05", "2026-02-02", "2026-03-02", "2026-04-06"]);
  });

  it("expands the last Friday of every month for ordinal -1", () => {
    const rule = forever({ kind: "monthly-ordinal", interval: 1, ordinal: -1, weekday: FRI });
    expect(
      occurrenceDatesInRange(rule, "2026-01-30", { from: "2026-01-01", to: "2026-04-30" }),
    ).toEqual(["2026-01-30", "2026-02-27", "2026-03-27", "2026-04-24"]);
  });

  it("distinguishes the 4th from the last weekday in a five-Monday month", () => {
    // February 2026 has four Mondays (2/9/16/23) so both rules pick the 23rd;
    // March 2026 has five (2/9/16/23/30) so they diverge.
    const fourth = forever({ kind: "monthly-ordinal", interval: 1, ordinal: 4, weekday: MON });
    const last = forever({ kind: "monthly-ordinal", interval: 1, ordinal: -1, weekday: MON });
    const range = { from: "2026-02-01", to: "2026-05-31" };
    expect(occurrenceDatesInRange(fourth, "2026-02-23", range)).toEqual([
      "2026-02-23",
      "2026-03-23",
      "2026-04-27",
      "2026-05-25",
    ]);
    expect(occurrenceDatesInRange(last, "2026-02-23", range)).toEqual([
      "2026-02-23",
      "2026-03-30",
      "2026-04-27",
      "2026-05-25",
    ]);
  });

  it("phases months from the anchor at interval 3", () => {
    const rule = forever({ kind: "monthly-ordinal", interval: 3, ordinal: 2, weekday: MON });
    expect(
      occurrenceDatesInRange(rule, "2026-01-12", { from: "2026-01-01", to: "2026-12-31" }),
    ).toEqual(["2026-01-12", "2026-04-13", "2026-07-13", "2026-10-12"]);
  });

  it("does not fire on an anchor later in the month than the ordinal date", () => {
    const rule = forever({ kind: "monthly-ordinal", interval: 1, ordinal: 1, weekday: MON });
    expect(
      occurrenceDatesInRange(rule, "2026-01-20", { from: "2026-01-01", to: "2026-03-31" }),
    ).toEqual(["2026-02-02", "2026-03-02"]);
  });
});

describe("occurrenceDatesInRange — yearly", () => {
  it("repeats the anchor's month and day", () => {
    const rule = forever({ kind: "yearly", interval: 1 });
    expect(
      occurrenceDatesInRange(rule, "2026-06-15", { from: "2026-01-01", to: "2028-12-31" }),
    ).toEqual(["2026-06-15", "2027-06-15", "2028-06-15"]);
  });

  it("phases years from the anchor at interval 2", () => {
    const rule = forever({ kind: "yearly", interval: 2 });
    expect(
      occurrenceDatesInRange(rule, "2026-06-15", { from: "2026-01-01", to: "2031-12-31" }),
    ).toEqual(["2026-06-15", "2028-06-15", "2030-06-15"]);
  });

  it("skips non-leap years for a Feb 29 anchor", () => {
    const rule = forever({ kind: "yearly", interval: 1 });
    expect(
      occurrenceDatesInRange(rule, "2028-02-29", { from: "2028-01-01", to: "2037-12-31" }),
    ).toEqual(["2028-02-29", "2032-02-29", "2036-02-29"]);
  });
});

describe("occurrenceDatesInRange — end conditions", () => {
  it("treats `until` as inclusive", () => {
    const rule = ending({ kind: "daily", interval: 1 }, { kind: "until", date: "2026-03-05" });
    expect(
      occurrenceDatesInRange(rule, "2026-03-01", { from: "2026-03-01", to: "2026-03-31" }),
    ).toEqual(["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]);
  });

  it("returns nothing when `until` falls before the anchor", () => {
    const rule = ending({ kind: "daily", interval: 1 }, { kind: "until", date: "2026-02-28" });
    expect(
      occurrenceDatesInRange(rule, "2026-03-01", { from: "2026-01-01", to: "2026-12-31" }),
    ).toEqual([]);
  });

  it("counts the anchor as occurrence 1", () => {
    const rule = ending({ kind: "daily", interval: 1 }, { kind: "count", total: 3 });
    expect(
      occurrenceDatesInRange(rule, "2026-03-01", { from: "2026-03-01", to: "2026-03-31" }),
    ).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
  });

  it("lets occurrences before the range consume the count", () => {
    const rule = ending({ kind: "daily", interval: 1 }, { kind: "count", total: 3 });
    expect(
      occurrenceDatesInRange(rule, "2026-03-01", { from: "2026-03-03", to: "2026-03-31" }),
    ).toEqual(["2026-03-03"]);
  });

  it("returns nothing when the count is exhausted before the range", () => {
    const rule = ending({ kind: "daily", interval: 1 }, { kind: "count", total: 3 });
    expect(
      occurrenceDatesInRange(rule, "2026-03-01", { from: "2026-03-10", to: "2026-03-31" }),
    ).toEqual([]);
  });

  it("counts skipped months' non-occurrences as nothing at all", () => {
    // Three occurrences means three real dates, not three months.
    const rule = ending({ kind: "monthly-date", interval: 1, day: 31 }, { kind: "count", total: 3 });
    expect(
      occurrenceDatesInRange(rule, "2026-01-31", { from: "2026-01-01", to: "2026-12-31" }),
    ).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });
});

describe("occurrenceDatesInRange — exdates and limits", () => {
  it("removes excluded dates without shifting the series", () => {
    const rule = forever({ kind: "daily", interval: 1 });
    expect(
      occurrenceDatesInRange(
        rule,
        "2026-03-01",
        { from: "2026-03-01", to: "2026-03-05" },
        new Set(["2026-03-02", "2026-03-04"]),
      ),
    ).toEqual(["2026-03-01", "2026-03-03", "2026-03-05"]);
  });

  it("lets an excluded occurrence still consume the count", () => {
    const rule = ending({ kind: "daily", interval: 1 }, { kind: "count", total: 3 });
    expect(
      occurrenceDatesInRange(
        rule,
        "2026-03-01",
        { from: "2026-03-01", to: "2026-03-31" },
        new Set(["2026-03-02"]),
      ),
    ).toEqual(["2026-03-01", "2026-03-03"]);
  });

  it("ignores exdates outside the series", () => {
    const rule = forever({ kind: "daily", interval: 2 });
    expect(
      occurrenceDatesInRange(
        rule,
        "2026-03-01",
        { from: "2026-03-01", to: "2026-03-07" },
        new Set(["2026-03-02", "2026-03-04"]),
      ),
    ).toEqual(["2026-03-01", "2026-03-03", "2026-03-05", "2026-03-07"]);
  });

  it("caps the result at `limit`", () => {
    const rule = forever({ kind: "daily", interval: 1 });
    expect(
      occurrenceDatesInRange(rule, "2026-03-01", { from: "2026-03-01", to: "2026-12-31" }, undefined, 5),
    ).toEqual(["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]);
  });

  it("returns nothing for a limit of 0", () => {
    const rule = forever({ kind: "daily", interval: 1 });
    expect(
      occurrenceDatesInRange(rule, "2026-03-01", { from: "2026-03-01", to: "2026-12-31" }, undefined, 0),
    ).toEqual([]);
  });

  it("caps at DEFAULT_OCCURRENCE_LIMIT when no limit is given", () => {
    const rule = forever({ kind: "daily", interval: 1 });
    const dates = occurrenceDatesInRange(rule, "2026-01-01", { from: "2026-01-01", to: "2031-12-31" });
    expect(dates).toHaveLength(DEFAULT_OCCURRENCE_LIMIT);
    expect(dates[0]).toBe("2026-01-01");
    expect(dates.at(-1)).toBe("2028-09-26");
  });

  it("throws TypeError on a malformed anchor or range bound", () => {
    const rule = forever({ kind: "daily", interval: 1 });
    expect(() =>
      occurrenceDatesInRange(rule, "2026-02-30", { from: "2026-03-01", to: "2026-03-05" }),
    ).toThrow(TypeError);
    expect(() =>
      occurrenceDatesInRange(rule, "2026-03-01", { from: "2026-13-01", to: "2026-03-05" }),
    ).toThrow(TypeError);
    expect(() =>
      occurrenceDatesInRange(rule, "2026-03-01", { from: "2026-03-01", to: "03-05" }),
    ).toThrow(TypeError);
    expect(() =>
      occurrenceDatesInRange(rule, "2026-03-01", { from: "2026-03-01", to: "2026-03-05" }, undefined, -1),
    ).toThrow(TypeError);
  });
});

describe("nextOccurrenceDate", () => {
  it("is strictly after: an occurrence date returns the following one", () => {
    const rule = forever({ kind: "daily", interval: 1 });
    expect(nextOccurrenceDate(rule, "2026-03-01", "2026-03-01")).toBe("2026-03-02");
  });

  it("returns the anchor when `after` precedes it", () => {
    const rule = forever({ kind: "daily", interval: 3 });
    expect(nextOccurrenceDate(rule, "2026-03-01", "2026-02-01")).toBe("2026-03-01");
  });

  it("keeps the anchor's phase from an arbitrary `after`", () => {
    const rule = forever({ kind: "daily", interval: 3 });
    expect(nextOccurrenceDate(rule, "2026-03-01", "2026-03-05")).toBe("2026-03-07");
  });

  it("jumps over the weekend for `weekdays`", () => {
    // 2026-03-06 is a Friday.
    const rule = forever({ kind: "weekdays" });
    expect(nextOccurrenceDate(rule, "2026-03-02", "2026-03-06")).toBe("2026-03-09");
  });

  it("finds the next listed weekday for a weekly rule", () => {
    const rule = forever({ kind: "weekly", interval: 1, days: [MON, FRI] });
    expect(nextOccurrenceDate(rule, "2026-01-05", "2026-01-05")).toBe("2026-01-09");
    expect(nextOccurrenceDate(rule, "2026-01-05", "2026-01-09")).toBe("2026-01-12");
  });

  it("skips months lacking the day for monthly-date", () => {
    const rule = forever({ kind: "monthly-date", interval: 1, day: 31 });
    expect(nextOccurrenceDate(rule, "2026-01-31", "2026-01-31")).toBe("2026-03-31");
  });

  it("skips non-leap years for a Feb 29 yearly rule", () => {
    const rule = forever({ kind: "yearly", interval: 1 });
    expect(nextOccurrenceDate(rule, "2028-02-29", "2028-02-29")).toBe("2032-02-29");
  });

  it("returns the last Monday for ordinal -1", () => {
    const rule = forever({ kind: "monthly-ordinal", interval: 1, ordinal: -1, weekday: MON });
    expect(nextOccurrenceDate(rule, "2026-02-23", "2026-02-23")).toBe("2026-03-30");
  });

  it("honours an inclusive `until` on both sides of the boundary", () => {
    const rule = ending({ kind: "daily", interval: 1 }, { kind: "until", date: "2026-03-05" });
    expect(nextOccurrenceDate(rule, "2026-03-01", "2026-03-04")).toBe("2026-03-05");
    expect(nextOccurrenceDate(rule, "2026-03-01", "2026-03-05")).toBeNull();
  });

  it("returns null once the count is spent", () => {
    const rule = ending({ kind: "daily", interval: 1 }, { kind: "count", total: 3 });
    expect(nextOccurrenceDate(rule, "2026-03-01", "2026-03-01")).toBe("2026-03-02");
    expect(nextOccurrenceDate(rule, "2026-03-01", "2026-03-02")).toBe("2026-03-03");
    expect(nextOccurrenceDate(rule, "2026-03-01", "2026-03-03")).toBeNull();
  });

  it("returns null for a single-occurrence series", () => {
    const rule = ending({ kind: "daily", interval: 1 }, { kind: "count", total: 1 });
    expect(nextOccurrenceDate(rule, "2026-03-01", "2026-02-01")).toBe("2026-03-01");
    expect(nextOccurrenceDate(rule, "2026-03-01", "2026-03-01")).toBeNull();
  });

  it("skips a week-0 weekday that falls before the anchor", () => {
    // Anchored on Thursday 2026-01-01, firing on Mondays: the anchor week's
    // Monday (2025-12-29) is behind the anchor and must not be returned.
    const rule = forever({ kind: "weekly", interval: 1, days: [MON] });
    expect(nextOccurrenceDate(rule, "2026-01-01", "2025-12-01")).toBe("2026-01-05");
  });

  it("throws TypeError on a malformed anchor or `after`", () => {
    const rule = forever({ kind: "daily", interval: 1 });
    expect(() => nextOccurrenceDate(rule, "2026-02-30", "2026-03-01")).toThrow(TypeError);
    expect(() => nextOccurrenceDate(rule, "2026-03-01", "not-a-date")).toThrow(TypeError);
  });
});

describe("validateRecurrenceRule — accepts", () => {
  const accepted: readonly [string, unknown, RecurrenceRule][] = [
    [
      "daily",
      { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } },
      { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } },
    ],
    [
      "weekdays",
      { freq: { kind: "weekdays" }, end: { kind: "never" } },
      { freq: { kind: "weekdays" }, end: { kind: "never" } },
    ],
    [
      "weekly with days sorted on the way out",
      { freq: { kind: "weekly", interval: 2, days: [4, 0, 6] }, end: { kind: "count", total: 10 } },
      { freq: { kind: "weekly", interval: 2, days: [0, 4, 6] }, end: { kind: "count", total: 10 } },
    ],
    [
      "monthly-date",
      { freq: { kind: "monthly-date", interval: 1, day: 31 }, end: { kind: "until", date: "2026-12-31" } },
      { freq: { kind: "monthly-date", interval: 1, day: 31 }, end: { kind: "until", date: "2026-12-31" } },
    ],
    [
      "monthly-ordinal with a negative ordinal",
      { freq: { kind: "monthly-ordinal", interval: 1, ordinal: -1, weekday: 4 }, end: { kind: "never" } },
      { freq: { kind: "monthly-ordinal", interval: 1, ordinal: -1, weekday: 4 }, end: { kind: "never" } },
    ],
    [
      "yearly at the interval bound",
      { freq: { kind: "yearly", interval: MAX_RECURRENCE_INTERVAL }, end: { kind: "count", total: MAX_RECURRENCE_COUNT } },
      { freq: { kind: "yearly", interval: MAX_RECURRENCE_INTERVAL }, end: { kind: "count", total: MAX_RECURRENCE_COUNT } },
    ],
    [
      "until on a leap day",
      { freq: { kind: "daily", interval: 1 }, end: { kind: "until", date: "2028-02-29" } },
      { freq: { kind: "daily", interval: 1 }, end: { kind: "until", date: "2028-02-29" } },
    ],
  ];

  for (const [label, input, expected] of accepted) {
    it(`accepts ${label}`, () => {
      expect(validateRecurrenceRule(input)).toEqual(expected);
    });
  }

  it("returns a fresh object, never the input", () => {
    const input = { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } };
    const rule = validateRecurrenceRule(input);
    expect(rule).not.toBe(input);
    expect(rule?.freq).not.toBe(input.freq);
    expect(rule?.end).not.toBe(input.end);
  });

  it("copies `days` rather than aliasing the input array", () => {
    const days = [2, 0];
    const rule = validateRecurrenceRule({
      freq: { kind: "weekly", interval: 1, days },
      end: { kind: "never" },
    });
    expect(rule?.freq).toEqual({ kind: "weekly", interval: 1, days: [0, 2] });
    expect(days).toEqual([2, 0]);
  });
});

describe("validateRecurrenceRule — rejects", () => {
  const rejected: readonly [string, unknown][] = [
    ["null", null],
    ["an array", []],
    ["a string", "daily"],
    ["a missing end", { freq: { kind: "daily", interval: 1 } }],
    ["a missing freq", { end: { kind: "never" } }],
    ["an unknown top-level key", { freq: { kind: "daily", interval: 1 }, end: { kind: "never" }, tz: "UTC" }],
    ["an unknown freq kind", { freq: { kind: "hourly", interval: 1 }, end: { kind: "never" } }],
    ["an unknown end kind", { freq: { kind: "daily", interval: 1 }, end: { kind: "forever" } }],
    ["an unknown freq key", { freq: { kind: "daily", interval: 1, days: [0] }, end: { kind: "never" } }],
    ["an unknown end key", { freq: { kind: "daily", interval: 1 }, end: { kind: "never", date: "2026-01-01" } }],
    ["an interval on weekdays", { freq: { kind: "weekdays", interval: 1 }, end: { kind: "never" } }],
    ["interval 0", { freq: { kind: "daily", interval: 0 }, end: { kind: "never" } }],
    ["a negative interval", { freq: { kind: "daily", interval: -2 }, end: { kind: "never" } }],
    ["a non-integer interval", { freq: { kind: "daily", interval: 1.5 }, end: { kind: "never" } }],
    ["a NaN interval", { freq: { kind: "daily", interval: Number.NaN }, end: { kind: "never" } }],
    ["a string interval", { freq: { kind: "daily", interval: "1" }, end: { kind: "never" } }],
    [
      "an interval past the bound",
      { freq: { kind: "daily", interval: MAX_RECURRENCE_INTERVAL + 1 }, end: { kind: "never" } },
    ],
    ["empty weekly days", { freq: { kind: "weekly", interval: 1, days: [] }, end: { kind: "never" } }],
    ["duplicate weekly days", { freq: { kind: "weekly", interval: 1, days: [1, 1] }, end: { kind: "never" } }],
    ["an out-of-range weekday", { freq: { kind: "weekly", interval: 1, days: [7] }, end: { kind: "never" } }],
    ["a non-integer weekday", { freq: { kind: "weekly", interval: 1, days: [1.5] }, end: { kind: "never" } }],
    ["days that are not an array", { freq: { kind: "weekly", interval: 1, days: 0 }, end: { kind: "never" } }],
    ["monthly day 0", { freq: { kind: "monthly-date", interval: 1, day: 0 }, end: { kind: "never" } }],
    ["monthly day 32", { freq: { kind: "monthly-date", interval: 1, day: 32 }, end: { kind: "never" } }],
    [
      "ordinal 5",
      { freq: { kind: "monthly-ordinal", interval: 1, ordinal: 5, weekday: 0 }, end: { kind: "never" } },
    ],
    [
      "ordinal 0",
      { freq: { kind: "monthly-ordinal", interval: 1, ordinal: 0, weekday: 0 }, end: { kind: "never" } },
    ],
    [
      "ordinal -2",
      { freq: { kind: "monthly-ordinal", interval: 1, ordinal: -2, weekday: 0 }, end: { kind: "never" } },
    ],
    [
      "an out-of-range ordinal weekday",
      { freq: { kind: "monthly-ordinal", interval: 1, ordinal: 1, weekday: -1 }, end: { kind: "never" } },
    ],
    ["count 0", { freq: { kind: "daily", interval: 1 }, end: { kind: "count", total: 0 } }],
    [
      "a count past the bound",
      { freq: { kind: "daily", interval: 1 }, end: { kind: "count", total: MAX_RECURRENCE_COUNT + 1 } },
    ],
    ["a non-integer count", { freq: { kind: "daily", interval: 1 }, end: { kind: "count", total: 2.5 } }],
    ["an unreal until date", { freq: { kind: "daily", interval: 1 }, end: { kind: "until", date: "2026-02-30" } }],
    ["a month-13 until date", { freq: { kind: "daily", interval: 1 }, end: { kind: "until", date: "2026-13-01" } }],
    ["a non-leap Feb 29 until", { freq: { kind: "daily", interval: 1 }, end: { kind: "until", date: "2027-02-29" } }],
    ["an until timestamp", { freq: { kind: "daily", interval: 1 }, end: { kind: "until", date: "2026-01-01T00:00:00Z" } }],
    ["a non-string until", { freq: { kind: "daily", interval: 1 }, end: { kind: "until", date: 20260101 } }],
  ];

  for (const [label, input] of rejected) {
    it(`rejects ${label}`, () => {
      expect(validateRecurrenceRule(input)).toBeNull();
    });
  }
});

describe("serializeRecurrenceRule", () => {
  it("round-trips through validateRecurrenceRule", () => {
    const rule: RecurrenceRule = {
      freq: { kind: "weekly", interval: 2, days: [0, 2, 4] },
      end: { kind: "count", total: 12 },
    };
    const parsed = validateRecurrenceRule(JSON.parse(serializeRecurrenceRule(rule)));
    expect(parsed).toEqual(rule);
    expect(parsed === null ? "" : serializeRecurrenceRule(parsed)).toBe(serializeRecurrenceRule(rule));
  });

  it("is identical for the same rule written with different member order", () => {
    const a: RecurrenceRule = {
      end: { kind: "count", total: 5 },
      freq: { interval: 2, days: [4, 0], kind: "weekly" },
    };
    const b: RecurrenceRule = {
      freq: { kind: "weekly", interval: 2, days: [0, 4] },
      end: { total: 5, kind: "count" },
    };
    expect(serializeRecurrenceRule(a)).toBe(serializeRecurrenceRule(b));
  });

  it("puts freq before end and kind first inside each", () => {
    const rule: RecurrenceRule = {
      freq: { kind: "monthly-ordinal", interval: 1, ordinal: -1, weekday: 4 },
      end: { kind: "until", date: "2026-12-31" },
    };
    expect(serializeRecurrenceRule(rule)).toBe(
      '{"freq":{"kind":"monthly-ordinal","interval":1,"ordinal":-1,"weekday":4},"end":{"kind":"until","date":"2026-12-31"}}',
    );
  });

  it("serializes every freq kind in canonical order", () => {
    expect(serializeRecurrenceRule({ freq: { kind: "weekdays" }, end: { kind: "never" } })).toBe(
      '{"freq":{"kind":"weekdays"},"end":{"kind":"never"}}',
    );
    expect(
      serializeRecurrenceRule({ freq: { kind: "monthly-date", interval: 3, day: 15 }, end: { kind: "never" } }),
    ).toBe('{"freq":{"kind":"monthly-date","interval":3,"day":15},"end":{"kind":"never"}}');
    expect(serializeRecurrenceRule({ freq: { kind: "yearly", interval: 1 }, end: { kind: "never" } })).toBe(
      '{"freq":{"kind":"yearly","interval":1},"end":{"kind":"never"}}',
    );
  });
});
