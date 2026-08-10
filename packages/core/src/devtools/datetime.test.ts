import { describe, expect, it } from "vitest";

import {
  CRON_MACROS,
  type CronSpec,
  type Instant,
  MAX_EPOCH_MS,
  MIN_EPOCH_MS,
  civilFromDays,
  civilFromInstant,
  compareInstants,
  dayOfYear,
  daysFromCivil,
  daysInMonth,
  explainCronSr,
  formatDurationCompact,
  formatDurationSr,
  formatEpochValue,
  formatInZone,
  formatIso8601,
  formatOffset,
  formatRelativeSr,
  formatRfc2822,
  guessEpochUnit,
  isLeapYear,
  isoWeek,
  isoWeekday,
  makeInstant,
  nextFireTimes,
  parseCron,
  parseDuration,
  parseEpochValue,
  parseInstant,
  parseIso8601,
  parseRfc2822,
  relativeSpan,
  zoneOffsetMinutes,
  zonedFields,
} from "./datetime.js";

/**
 * Every epoch figure in this file is derived by counting days, not by running
 * the module and pasting the answer back. The two anchors everything else hangs
 * off:
 *
 * - 1970-01-01 → 2026-01-01 is 56 years of 365 days plus the 14 leap days of
 *   1972…2024, so 2026-01-01 is epoch day 20 454.
 * - 2026 is not a leap year, so its cumulative month offsets are 0, 31, 59, 90,
 *   120, 151, 181, 212, 243, 273, 304, 334.
 *
 * From those: 2026-08-09 is day-of-year 221 (212 + 9), epoch day 20 673 + 1 =
 * 20 674, and 20 674 × 86 400 = 1 786 233 600 seconds.
 */
const DAY_2026_01_01 = 20_454;
const MS_2026_08_09 = 1_786_233_600_000;

/** A helper that keeps the tests reading as arithmetic rather than as bookkeeping. */
function at(epochMs: number, subNs = 0): Instant {
  const instant = makeInstant(epochMs, subNs);
  if (instant === null) throw new Error(`not an instant: ${epochMs}`);
  return instant;
}

function specOf(text: string): CronSpec {
  const result = parseCron(text);
  if (!result.ok) throw new Error(`${text} → ${result.error.message}`);
  return result.spec;
}

function firedAt(text: string, afterMs: number, count: number, timeZone?: string): number[] {
  const times = nextFireTimes(
    specOf(text),
    at(afterMs),
    count,
    timeZone === undefined ? {} : { timeZone },
  );
  if (times === null) throw new Error(`unknown zone for ${text}`);
  return times.map((instant) => instant.epochMs);
}

// ---------------------------------------------------------------------------

describe("the calendar primitives", () => {
  it("applies the full Gregorian leap rule, including the century exceptions", () => {
    // The 400-year exception is the one a naive `% 4` gets wrong, and 1900 and
    // 2000 are the pair that shows it.
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
  });

  it("gives February its two lengths and refuses a month number that is not one", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2026, 13)).toBe(0);
    expect(daysInMonth(2026, 0)).toBe(0);
  });

  it("counts the day of the year past February in both kinds of year", () => {
    expect(dayOfYear(2026, 1, 1)).toBe(1);
    // 212 days through July in a common year, plus nine.
    expect(dayOfYear(2026, 8, 9)).toBe(221);
    expect(dayOfYear(2026, 12, 31)).toBe(365);
    // 31 + 29 + 1 — the leap day has to be inside the count.
    expect(dayOfYear(2024, 3, 1)).toBe(61);
    expect(dayOfYear(2024, 12, 31)).toBe(366);
  });

  it("puts the epoch on day zero and 2026-01-01 on the day the arithmetic says", () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(daysFromCivil(2026, 1, 1)).toBe(DAY_2026_01_01);
    expect(daysFromCivil(2026, 8, 9)).toBe(DAY_2026_01_01 + 220);
    // 1601-01-01 and 0001-01-01 — the FILETIME and .NET tick origins, and the
    // two day counts the epoch constants below are built from.
    expect(daysFromCivil(1601, 1, 1)).toBe(-134_774);
    expect(daysFromCivil(1, 1, 1)).toBe(-719_162);
  });

  it("inverts daysFromCivil exactly, including across the years Date.UTC would mangle", () => {
    for (const date of [
      { year: 1, month: 1, day: 1 },
      { year: 47, month: 6, day: 30 },
      { year: 99, month: 12, day: 31 },
      { year: 1601, month: 1, day: 1 },
      { year: 1969, month: 12, day: 31 },
      { year: 1970, month: 1, day: 1 },
      { year: 2024, month: 2, day: 29 },
      { year: 2026, month: 8, day: 9 },
    ]) {
      const back = civilFromDays(daysFromCivil(date.year, date.month, date.day));
      expect(back, JSON.stringify(date)).toEqual(date);
    }
  });

  it("floors the era ONCE, so the days before 0000-03-01 are not shifted by one", () => {
    /**
     * Hinnant's C++ writes the era as `(y >= 0 ? y : y - 399) / 400` because
     * integer division there TRUNCATES toward zero; the bias is what turns that
     * truncation into flooring. `Math.floor` already floors, so a translation
     * that keeps the bias subtracts a whole extra era — and the result comes out
     * exactly one day early for every negative input except the ones congruent
     * to −1 (mod 400), where the bias lands on a boundary and cancels. Year 0's
     * January is one of those, and year 1 never takes the branch at all — which
     * between them is why every date the older tests reached still looked right.
     *
     * Counted by hand from the algorithm's own origin: 0000-03-01 is epoch day
     * −719 468 (the constant in the source). January and February of year 0 are
     * 31 + 29 days — year 0 IS a leap year, 0 % 400 === 0 — so 0000-01-01 is 60
     * days earlier, and year −1 is a common year, so −000001-01-01 is 365 days
     * earlier again.
     */
    expect(daysFromCivil(0, 3, 1)).toBe(-719_468);
    expect(daysFromCivil(0, 1, 1)).toBe(-719_528);
    expect(daysFromCivil(-1, 1, 1)).toBe(-719_893);
    expect(civilFromDays(-719_528)).toEqual({ year: 0, month: 1, day: 1 });
    expect(civilFromDays(-719_893)).toEqual({ year: -1, month: 1, day: 1 });
    // The three days around where the doubled correction starts biting: day
    // −719 470 is the first one it reaches, and 0000-02-29 exists because year 0
    // is a leap year.
    expect(civilFromDays(-719_469)).toEqual({ year: 0, month: 2, day: 29 });
    expect(civilFromDays(-719_470)).toEqual({ year: 0, month: 2, day: 28 });
    expect(civilFromDays(-719_471)).toEqual({ year: 0, month: 2, day: 27 });
  });

  it("names the weekday, anchored on the Thursday the epoch fell on", () => {
    expect(isoWeekday(1970, 1, 1)).toBe(4);
    expect(isoWeekday(1970, 1, 4)).toBe(7);
    // Before the epoch the day count is negative, which is where a plain `%`
    // gives a negative weekday.
    expect(isoWeekday(1969, 12, 31)).toBe(3);
    expect(isoWeekday(1997, 11, 21)).toBe(5);
    expect(isoWeekday(2026, 8, 1)).toBe(6);
  });
});

describe("the ISO week", () => {
  /**
   * The definition: week 1 is the week containing the first Thursday of January.
   * 2026-01-01 IS a Thursday, so it opens 2026-W01 and the week reaches back to
   * Monday 2025-12-29.
   */
  it("puts a date in the week its own Thursday belongs to", () => {
    expect(isoWeek(2026, 1, 1)).toEqual({ year: 2026, week: 1, weekday: 4 });
    expect(isoWeek(2025, 12, 29)).toEqual({ year: 2026, week: 1, weekday: 1 });
  });

  it("gives a year 53 weeks exactly when it should, and lends days across the boundary", () => {
    // 2026 opens on a Thursday, which is one of the two conditions for a
    // 53-week year; 2026-12-31 is itself that 53rd Thursday.
    expect(isoWeek(2026, 12, 31)).toEqual({ year: 2026, week: 53, weekday: 4 });
    // 2021-01-01 is a Friday, so its week's Thursday is 2020-12-31 — the date
    // belongs to 2020-W53 even though its calendar year is 2021.
    expect(isoWeek(2021, 1, 1)).toEqual({ year: 2020, week: 53, weekday: 5 });
  });
});

describe("the magnitude ladder", () => {
  it("splits the four Unix units at the digit counts the rule states", () => {
    expect(guessEpochUnit("9".repeat(11))).toBe("seconds");
    expect(guessEpochUnit(`1${"0".repeat(11)}`)).toBe("milliseconds");
    expect(guessEpochUnit("9".repeat(14))).toBe("milliseconds");
    expect(guessEpochUnit(`1${"0".repeat(14)}`)).toBe("microseconds");
    expect(guessEpochUnit("9".repeat(17))).toBe("microseconds");
    expect(guessEpochUnit(`1${"0".repeat(17)}`)).toBe("nanoseconds");
    expect(guessEpochUnit("9".repeat(20))).toBe("nanoseconds");
    expect(guessEpochUnit(`1${"0".repeat(20)}`)).toBeNull();
  });

  it("reads a small number as seconds, so zero is the epoch rather than a refusal", () => {
    expect(guessEpochUnit("0")).toBe("seconds");
    expect(guessEpochUnit("1000000000")).toBe("seconds");
  });

  it("ignores the sign, the leading zeros and the fraction, which say nothing about the unit", () => {
    expect(guessEpochUnit("-1786278896")).toBe("seconds");
    expect(guessEpochUnit("0000001786278896")).toBe("seconds");
    expect(guessEpochUnit("1786278896.5")).toBe("seconds");
    expect(guessEpochUnit("1786278896,5")).toBe("seconds");
  });

  it("refuses text that is not a bare number", () => {
    expect(guessEpochUnit("")).toBeNull();
    expect(guessEpochUnit("2026-08-09")).toBeNull();
    expect(guessEpochUnit("0x10")).toBeNull();
  });
});

describe("numeric epochs", () => {
  it("reads the four Unix ladders against one hand-counted instant", () => {
    // 2001-09-09T01:46:40Z: epoch day 11 574 (11 323 to 2001-01-01, plus 251),
    // times 86 400 is 999 993 600, plus 6 400 seconds.
    expect(parseEpochValue("1000000000", "seconds")).toEqual({
      epochMs: 1_000_000_000_000,
      subNs: 0,
    });
    expect(parseEpochValue("1000000000000", "milliseconds")).toEqual({
      epochMs: 1_000_000_000_000,
      subNs: 0,
    });
    expect(parseEpochValue("1000000000000000", "microseconds")).toEqual({
      epochMs: 1_000_000_000_000,
      subNs: 0,
    });
    expect(parseEpochValue("1000000000000000000", "nanoseconds")).toEqual({
      epochMs: 1_000_000_000_000,
      subNs: 0,
    });
  });

  it("places the FILETIME origin at 1601-01-01, 11 644 473 600 seconds before the epoch", () => {
    expect(parseEpochValue("0", "filetime")).toEqual({ epochMs: -11_644_473_600_000, subNs: 0 });
    // The constant every Win32 codebase carries: 116 444 736 × 10⁹ hundred-
    // nanosecond intervals is exactly the Unix epoch.
    expect(parseEpochValue("116444736000000000", "filetime")).toEqual({ epochMs: 0, subNs: 0 });
  });

  it("places the .NET tick origin at 0001-01-01, 62 135 596 800 seconds before the epoch", () => {
    expect(parseEpochValue("0", "ticks")).toEqual({ epochMs: -62_135_596_800_000, subNs: 0 });
    expect(parseEpochValue("621355968000000000", "ticks")).toEqual({ epochMs: 0, subNs: 0 });
  });

  it("keeps every digit of a nanosecond timestamp, which a double cannot hold", () => {
    // 1 786 278 896 789 123 456 ns is 2026-08-09T12:34:56.789123456Z. The gap
    // between neighbouring doubles at 1.8e18 is 256, so this value has no exact
    // double and a Number-based parser rewrites its last three digits.
    const text = "1786278896789123456";
    const instant = parseEpochValue(text, "nanoseconds");
    expect(instant).toEqual({ epochMs: 1_786_278_896_789, subNs: 123_456 });
    expect(instant === null ? "" : formatEpochValue(instant, "nanoseconds")).toBe(text);
  });

  it("accepts a fraction that lands on the encoding's tick and refuses one that does not", () => {
    expect(parseEpochValue("1.5", "seconds")).toEqual({ epochMs: 1500, subNs: 0 });
    expect(parseEpochValue("1,5", "seconds")).toEqual({ epochMs: 1500, subNs: 0 });
    // 0.000 000 5 s is 500 ns — under a millisecond, so it lives in the remainder.
    expect(parseEpochValue("0.0000005", "seconds")).toEqual({ epochMs: 0, subNs: 500 });
    // Half a nanosecond is not a quantity this can hold, and halving it would be
    // a silent change to the value the user typed.
    expect(parseEpochValue("1.5", "nanoseconds")).toBeNull();
  });

  it("reads the hexadecimal form Windows tooling prints", () => {
    expect(parseEpochValue("0xFF", "seconds")).toEqual({ epochMs: 255_000, subNs: 0 });
    expect(parseEpochValue("0x0", "filetime")).toEqual({ epochMs: -11_644_473_600_000, subNs: 0 });
  });

  it("refuses text that is not a number, and an instant off the end of the timeline", () => {
    expect(parseEpochValue("", "seconds")).toBeNull();
    expect(parseEpochValue("1e9", "seconds")).toBeNull();
    expect(parseEpochValue("1 000", "seconds")).toBeNull();
    expect(parseEpochValue("9".repeat(20), "seconds")).toBeNull();
  });

  it("round-trips every encoding through format and back", () => {
    const instant = at(MS_2026_08_09 + 45_296_789, 123_456);
    const sources = [
      "seconds",
      "milliseconds",
      "microseconds",
      "nanoseconds",
      "filetime",
      "ticks",
    ] as const;
    for (const source of sources) {
      const text = formatEpochValue(instant, source);
      expect(parseEpochValue(text, source), source).toEqual(instant);
    }
  });

  it("shows surplus precision as a fraction rather than cutting a FILETIME short", () => {
    // One nanosecond past the epoch: a FILETIME tick is 100 ns, so the value is
    // a hundredth of a tick and the encoding has to say so.
    expect(formatEpochValue(at(0, 1), "filetime")).toBe("116444736000000000.01");
    expect(formatEpochValue(at(0, 0), "seconds")).toBe("0");
    expect(formatEpochValue(at(-1500, 0), "seconds")).toBe("-1.5");
  });
});

describe("ISO 8601", () => {
  it("reads a full timestamp against a hand-counted epoch value", () => {
    // 2026-08-09 is epoch day 20 674 → 1 786 233 600 s; 12:34:56 adds 45 296 s.
    const parsed = parseIso8601("2026-08-09T12:34:56.789Z");
    expect(parsed?.instant).toEqual({ epochMs: 1_786_278_896_789, subNs: 0 });
    expect(parsed?.kind).toBe("iso8601");
    expect(parsed?.offsetMinutes).toBe(0);
  });

  it("applies the offset rather than storing it, so the same instant has many spellings", () => {
    const utc = parseIso8601("2026-08-09T12:34:56Z")?.instant;
    for (const text of [
      "2026-08-09T14:34:56+02:00",
      "2026-08-09T14:34:56+0200",
      "2026-08-09T13:34:56+01",
      "2026-08-09T07:04:56-05:30",
    ]) {
      expect(parseIso8601(text)?.instant, text).toEqual(utc);
    }
    expect(parseIso8601("2026-08-09T14:34:56+02:00")?.offsetMinutes).toBe(120);
  });

  it("reads a date-time with no offset as UTC, and reports that none was given", () => {
    const parsed = parseIso8601("2026-08-09T12:34:56");
    expect(parsed?.instant.epochMs).toBe(1_786_278_896_000);
    expect(parsed?.offsetMinutes).toBeNull();
  });

  it("reads a bare date as midnight UTC", () => {
    expect(parseIso8601("2026-08-09")?.instant).toEqual({ epochMs: MS_2026_08_09, subNs: 0 });
  });

  it("keeps a nine-digit fraction, splitting it across the millisecond boundary", () => {
    expect(parseIso8601("2026-08-09T12:34:56.789123456Z")?.instant).toEqual({
      epochMs: 1_786_278_896_789,
      subNs: 123_456,
    });
    // ISO 8601 itself prefers the comma; both are the decimal point.
    expect(parseIso8601("2026-08-09T12:34:56,5Z")?.instant).toEqual({
      epochMs: 1_786_278_896_500,
      subNs: 0,
    });
  });

  it("refuses rather than repairs", () => {
    expect(parseIso8601("2026-02-30")).toBeNull();
    expect(parseIso8601("2026-13-01")).toBeNull();
    expect(parseIso8601("2025-02-29")).toBeNull();
    // Legal ISO end-of-day, but it would print back as the next day's 00:00.
    expect(parseIso8601("2026-08-09T24:00:00Z")).toBeNull();
    // A leap second has no representation here.
    expect(parseIso8601("2016-12-31T23:59:60Z")).toBeNull();
    // Basic format collides with an epoch-seconds figure of the same digits.
    expect(parseIso8601("20260809T120000Z")).toBeNull();
    expect(parseIso8601("2026-08-09T12:34:56+25:00")).toBeNull();
    expect(parseIso8601("nije datum")).toBeNull();
  });

  it("renders back exactly what it read, at every fraction width auto can pick", () => {
    for (const text of [
      "2026-08-09T12:34:56Z",
      "2026-08-09T12:34:56.789Z",
      "2026-08-09T12:34:56.789123Z",
      "2026-08-09T12:34:56.789123456Z",
      "1969-12-31T23:59:59.999Z",
      "0001-01-03T00:00:00Z",
    ]) {
      const parsed = parseIso8601(text);
      expect(parsed, text).not.toBeNull();
      expect(parsed === null ? "" : formatIso8601(parsed.instant), text).toBe(text);
    }
  });

  it("renders at a chosen offset, and reads its own output back to the same instant", () => {
    const instant = at(1_786_278_896_000);
    const text = formatIso8601(instant, { offsetMinutes: 120 });
    expect(text).toBe("2026-08-09T14:34:56+02:00");
    expect(parseIso8601(text)?.instant).toEqual(instant);
    expect(formatIso8601(instant, { offsetMinutes: -330 })).toBe("2026-08-09T07:04:56-05:30");
  });

  it("pads a fixed fraction width and truncates to it, which auto never does", () => {
    const instant = at(1_786_278_896_789, 123_456);
    expect(formatIso8601(instant, { fractionDigits: 0 })).toBe("2026-08-09T12:34:56Z");
    expect(formatIso8601(instant, { fractionDigits: 3 })).toBe("2026-08-09T12:34:56.789Z");
    expect(formatIso8601(instant, { fractionDigits: 9 })).toBe("2026-08-09T12:34:56.789123456Z");
    expect(formatIso8601(at(1_786_278_896_000), { fractionDigits: 3 })).toBe(
      "2026-08-09T12:34:56.000Z",
    );
  });

  it("uses the expanded year form outside 0000–9999, and reads it back", () => {
    const far = at(300_000_000_000_000);
    const text = formatIso8601(far);
    expect(text.startsWith("+011476-")).toBe(true);
    expect(parseIso8601(text)?.instant).toEqual(far);
  });

  /**
   * The independent oracle, and the one place this suite uses one.
   *
   * `Date.UTC` is unusable as a reference — it maps years 0–99 onto 1900–1999,
   * which is precisely why the civil arithmetic is hand-rolled — but
   * `Date.prototype.toISOString` carries no such quirk: it renders the same
   * proleptic Gregorian calendar in the same expanded-year notation, so it is a
   * second implementation of exactly this conversion. The sweep is deterministic
   * (4 001 evenly spaced instants, step 4 320 000 000 000 ms) rather than random,
   * so a failure is the same failure tomorrow.
   */
  it("agrees with Date.prototype.toISOString at 4 001 instants across the whole timeline", () => {
    const steps = 4000;
    const step = (MAX_EPOCH_MS - MIN_EPOCH_MS) / steps;
    const mismatches: string[] = [];
    for (let index = 0; index <= steps; index += 1) {
      const ms = MIN_EPOCH_MS + index * step;
      const ours = formatIso8601(at(ms), { fractionDigits: 3 });
      const oracle = new Date(ms).toISOString();
      if (ours !== oracle) mismatches.push(`${ms}: ${ours} vs ${oracle}`);
    }
    // Both assertions on purpose: the first names the instants that disagree,
    // the second is the one that cannot be satisfied by a short slice.
    expect(mismatches.slice(0, 4)).toEqual([]);
    expect(mismatches.length).toBe(0);
  });

  it("reads back its own output at negative years, where it once wrote an impossible date", () => {
    // With the era correction applied twice the formatter wrote „-000002-02-29"
    // for the instant below — a 29 February in a year that has none — and
    // `parseIso8601` then refused its own formatter's output, so the pair was
    // broken in both directions at once.
    expect(formatIso8601(at(-62_162_208_000_000), { fractionDigits: 3 })).toBe(
      "0000-02-28T00:00:00.000Z",
    );
    for (const ms of [
      MIN_EPOCH_MS,
      -100_000_000_000_000,
      -62_167_219_200_001,
      -62_162_208_000_000,
    ]) {
      const text = formatIso8601(at(ms), { fractionDigits: 3 });
      expect(text, String(ms)).toBe(new Date(ms).toISOString());
      expect(parseIso8601(text)?.instant, text).toEqual({ epochMs: ms, subNs: 0 });
    }
  });
});

describe("RFC 2822", () => {
  /**
   * The vector is RFC 5322's own example, §A.1.1. Counted by hand: 1997-01-01
   * is epoch day 9 862 (27 years plus 7 leap days), 21 November is day-of-year
   * 325 so 324 days further, giving epoch day 10 186 → 880 070 400 s. The local
   * time 09:55:06 adds 35 706 s and the −0600 offset adds 21 600 s back.
   */
  const RFC_EXAMPLE_MS = 880_127_706_000;

  it("reads the RFC's own example to the second", () => {
    const parsed = parseRfc2822("Fri, 21 Nov 1997 09:55:06 -0600");
    expect(parsed?.instant).toEqual({ epochMs: RFC_EXAMPLE_MS, subNs: 0 });
    expect(parsed?.kind).toBe("rfc2822");
    expect(parsed?.offsetMinutes).toBe(-360);
  });

  it("strips the trailing zone comment mail agents append", () => {
    expect(parseRfc2822("Fri, 21 Nov 1997 09:55:06 -0600 (CST)")?.instant.epochMs).toBe(
      RFC_EXAMPLE_MS,
    );
  });

  it("accepts the obsolete alphabetic zones §4.3 defines, at their stated offsets", () => {
    expect(parseRfc2822("21 Nov 1997 15:55:06 GMT")?.instant.epochMs).toBe(RFC_EXAMPLE_MS);
    expect(parseRfc2822("21 Nov 1997 09:55:06 CST")?.instant.epochMs).toBe(RFC_EXAMPLE_MS);
    expect(parseRfc2822("21 Nov 1997 10:55:06 EST")?.instant.epochMs).toBe(RFC_EXAMPLE_MS);
    // A military single-letter zone is defined with the wrong sign in the older
    // RFC, so it is not admitted at all.
    expect(parseRfc2822("21 Nov 1997 09:55:06 A")).toBeNull();
  });

  it("applies the obsolete two- and three-digit year rule from §4.3", () => {
    expect(parseRfc2822("21 Nov 97 09:55:06 -0600")?.instant.epochMs).toBe(RFC_EXAMPLE_MS);
    // 00–49 mean the 2000s: 21 Nov 2026 is a Saturday, which the weekday check
    // then has to agree with.
    expect(parseRfc2822("Sat, 21 Nov 26 00:00:00 +0000")?.instant.epochMs).toBe(
      (DAY_2026_01_01 + 324) * 86_400_000,
    );
  });

  it("refuses a day-of-week that contradicts the date, where the RFC would ignore it", () => {
    // 1997-11-21 was a Friday. „Thu" is a header disagreeing with itself, and
    // that is information a developer tool should surface rather than swallow.
    expect(parseRfc2822("Thu, 21 Nov 1997 09:55:06 -0600")).toBeNull();
    expect(parseRfc2822("Pet, 21 Nov 1997 09:55:06 -0600")).toBeNull();
  });

  it("renders as a valid Date header, in ASCII rather than Serbian", () => {
    expect(formatRfc2822(at(RFC_EXAMPLE_MS), -360)).toBe("Fri, 21 Nov 1997 09:55:06 -0600");
    expect(formatRfc2822(at(RFC_EXAMPLE_MS))).toBe("Fri, 21 Nov 1997 15:55:06 +0000");
  });

  it("round-trips its own output", () => {
    for (const offset of [0, 120, -330, -360]) {
      const instant = at(RFC_EXAMPLE_MS);
      expect(parseRfc2822(formatRfc2822(instant, offset))?.instant, String(offset)).toEqual(
        instant,
      );
    }
  });

  it("refuses a year the grammar cannot spell instead of emitting a malformed one", () => {
    // `pad(year, 4)` is `padStart`, which keeps a minus sign in front of the
    // zeros: year −1 came out as „00-1", a `Date:` header no parser reads. Above
    // 9999 the year came out five digits long and this module's own parser —
    // two to four digits, per the obsolete-year rule — refused it.
    // −000001-12-31T23:59:59.999Z, one millisecond before year 0 begins.
    expect(formatRfc2822(at(-62_167_219_200_001))).toBe("");
    expect(formatRfc2822(at(MIN_EPOCH_MS))).toBe("");
    // +011476-08-15T05:20:00Z.
    expect(formatRfc2822(at(300_000_000_000_000))).toBe("");
    // The year the guard reads is the CIVIL one, so the offset moves it: an
    // instant still inside 9999 in UTC is already in 10000 two hours east, and
    // one just inside 0000 is in −000001 an hour west.
    const endOf9999 = (daysFromCivil(10_000, 1, 1) * 86_400 - 1) * 1000;
    expect(formatRfc2822(at(endOf9999))).toBe("Fri, 31 Dec 9999 23:59:59 +0000");
    expect(formatRfc2822(at(endOf9999 + 1000))).toBe("");
    expect(formatRfc2822(at(endOf9999 - 3_600_000), 120)).toBe("");
    expect(formatRfc2822(at(-719_528 * 86_400_000), -60)).toBe("");
  });

  it("spells and reads back every year it does accept, down to 0000-01-01", () => {
    // The two edges of the accepted range's lower end, hand-checked against the
    // day counts in „the calendar primitives": epoch day −719 528 is 0000-01-01
    // (a Saturday) and −719 470 is 0000-02-28 (a Monday).
    expect(formatRfc2822(at(-719_528 * 86_400_000))).toBe("Sat, 01 Jan 0000 00:00:00 +0000");
    expect(formatRfc2822(at(-719_470 * 86_400_000))).toBe("Mon, 28 Feb 0000 00:00:00 +0000");
    expect(formatRfc2822(at(-719_528 * 86_400_000), 60)).toBe("Sat, 01 Jan 0000 01:00:00 +0100");
    for (const ms of [
      -719_528 * 86_400_000,
      -719_470 * 86_400_000,
      0,
      RFC_EXAMPLE_MS,
      (daysFromCivil(10_000, 1, 1) * 86_400 - 1) * 1000,
    ]) {
      const text = formatRfc2822(at(ms));
      expect(parseRfc2822(text)?.instant, text).toEqual({ epochMs: ms, subNs: 0 });
    }
  });
});

describe("the one-field parser", () => {
  it("takes each grammar in turn and says which one answered", () => {
    expect(parseInstant("1786278896")).toEqual({
      instant: { epochMs: 1_786_278_896_000, subNs: 0 },
      kind: "epoch",
      unit: "seconds",
      offsetMinutes: null,
    });
    expect(parseInstant("2026-08-09T12:34:56Z")?.kind).toBe("iso8601");
    expect(parseInstant("Fri, 21 Nov 1997 09:55:06 -0600")?.kind).toBe("rfc2822");
    expect(parseInstant("  2026-08-09  ")?.kind).toBe("iso8601");
    expect(parseInstant("")).toBeNull();
    expect(parseInstant("nista")).toBeNull();
  });

  it("never guesses FILETIME, because nothing in the digits separates it from nanoseconds", () => {
    // The same 18 digits are the FILETIME of the Unix epoch AND a nanosecond
    // count of 116 444 736 000 ms — 1973-09-09T17:45:36Z, epoch day 1 347. The
    // ladder takes the nanosecond reading; the FILETIME reading is only
    // reachable by naming it.
    expect(parseInstant("116444736000000000")?.instant).toEqual({
      epochMs: 116_444_736_000,
      subNs: 0,
    });
    expect(formatIso8601(at(116_444_736_000))).toBe("1973-09-09T17:45:36Z");
    expect(parseEpochValue("116444736000000000", "filetime")).toEqual({ epochMs: 0, subNs: 0 });
  });
});

describe("instants", () => {
  it("refuses parts that do not describe one", () => {
    expect(makeInstant(1.5)).toBeNull();
    expect(makeInstant(0, -1)).toBeNull();
    expect(makeInstant(0, 1_000_000)).toBeNull();
    expect(makeInstant(8_640_000_000_000_001)).toBeNull();
    expect(makeInstant(-8_640_000_000_000_001)).toBeNull();
    expect(makeInstant(8_640_000_000_000_000)).not.toBeNull();
  });

  it("keeps one spelling per instant, flooring the millisecond before the epoch", () => {
    // One nanosecond before the epoch: floored, that is epochMs −1 with a
    // remainder of 999 999 ns, never epochMs 0 with a negative remainder.
    expect(parseEpochValue("-1", "nanoseconds")).toEqual({ epochMs: -1, subNs: 999_999 });
    expect(compareInstants(at(-1, 999_999), at(0, 0))).toBeLessThan(0);
    expect(compareInstants(at(0, 1), at(0, 0))).toBeGreaterThan(0);
    expect(compareInstants(at(5, 5), at(5, 5))).toBe(0);
  });

  it("breaks an instant into civil fields, before the epoch as well as after", () => {
    expect(civilFromInstant(at(MS_2026_08_09 + 45_296_789))).toEqual({
      year: 2026,
      month: 8,
      day: 9,
      hour: 12,
      minute: 34,
      second: 56,
      nanosecond: 789_000_000,
    });
    expect(civilFromInstant(at(-1))).toEqual({
      year: 1969,
      month: 12,
      day: 31,
      hour: 23,
      minute: 59,
      second: 59,
      nanosecond: 999_000_000,
    });
  });
});

describe("time zones", () => {
  const summer = at(1_786_278_896_000); // 2026-08-09T12:34:56Z
  const winter = at(1_768_478_400_000); // 2026-01-15T12:00:00Z

  it("reads the offset in force at the instant, not a fixed one per zone", () => {
    expect(zoneOffsetMinutes(summer, "Europe/Belgrade")).toBe(120);
    expect(zoneOffsetMinutes(winter, "Europe/Belgrade")).toBe(60);
    expect(zoneOffsetMinutes(summer, "UTC")).toBe(0);
    // The half-hour and three-quarter-hour zones a fixed table of hours misses.
    expect(zoneOffsetMinutes(summer, "Asia/Kolkata")).toBe(330);
    expect(zoneOffsetMinutes(summer, "Australia/Eucla")).toBe(525);
  });

  it("refuses an unknown zone instead of throwing at the user", () => {
    expect(zoneOffsetMinutes(summer, "Evropa/Beograd")).toBeNull();
    expect(zonedFields(summer, "Evropa/Beograd")).toBeNull();
    expect(formatInZone(summer, "Evropa/Beograd")).toBeNull();
    expect(nextFireTimes(specOf("0 0 * * *"), summer, 1, { timeZone: "Evropa/Beograd" })).toBeNull();
  });

  it("gives the wall-clock fields a clock in that zone would show", () => {
    expect(zonedFields(summer, "Europe/Belgrade")).toEqual({
      year: 2026,
      month: 8,
      day: 9,
      hour: 14,
      minute: 34,
      second: 56,
      nanosecond: 0,
      timeZone: "Europe/Belgrade",
      offsetMinutes: 120,
    });
    // Midnight has to come back as hour 0; `hour12: false` is the option that
    // historically returned 24 here and would have moved the date back a day.
    expect(zonedFields(at(0), "UTC")?.hour).toBe(0);
    expect(zonedFields(at(0), "UTC")?.day).toBe(1);
  });

  it("formats in a zone with the offset spelled out", () => {
    expect(formatInZone(summer, "Europe/Belgrade")).toBe("2026-08-09T14:34:56+02:00");
    expect(formatInZone(winter, "Europe/Belgrade")).toBe("2026-01-15T13:00:00+01:00");
    expect(formatInZone(summer, "Asia/Kolkata")).toBe("2026-08-09T18:04:56+05:30");
    expect(formatInZone(summer, "UTC")).toBe("2026-08-09T12:34:56Z");
  });

  it("writes an offset as ±HH:MM", () => {
    expect(formatOffset(0)).toBe("+00:00");
    expect(formatOffset(120)).toBe("+02:00");
    expect(formatOffset(-330)).toBe("-05:30");
    expect(formatOffset(525)).toBe("+08:45");
  });
});

describe("relative time in Serbian", () => {
  const now = at(1_786_278_896_000); // 2026-08-09T12:34:56Z
  const ago = (ms: number): string => formatRelativeSr(at(now.epochMs - ms), now);
  const ahead = (ms: number): string => formatRelativeSr(at(now.epochMs + ms), now);

  it("says nothing at all for a difference under a second", () => {
    expect(formatRelativeSr(now, now)).toBe("upravo sada");
    expect(ago(999)).toBe("upravo sada");
  });

  it("inflects the noun by the CLDR rule for Serbian, which is three forms and not one", () => {
    expect(ago(1000)).toBe("pre 1 sekunde");
    expect(ago(2000)).toBe("pre 2 sekunde");
    expect(ago(5000)).toBe("pre 5 sekundi");
    expect(ago(2 * 3_600_000)).toBe("pre 2 sata");
    expect(ago(5 * 3_600_000)).toBe("pre 5 sati");
    // 21 ends in 1 and is not 11, so it takes the singular; 22 takes the paucal;
    // 12–14 take the plural despite ending in 2–4.
    expect(ago(21 * 3_600_000)).toBe("pre 21 sata");
    expect(ago(22 * 3_600_000)).toBe("pre 22 sata");
    expect(ago(12 * 3_600_000)).toBe("pre 12 sati");
  });

  it('declines the noun for the preposition, so „pre" and „za" do not share a word', () => {
    // „pre" governs the genitive and „za" the accusative. One shared table gives
    // „pre 1 sat" and „pre 1 sekunda", which are the nominative leaking through.
    expect(ago(3_600_000)).toBe("pre 1 sata");
    expect(ahead(3_600_000)).toBe("za 1 sat");
    expect(ago(1000)).toBe("pre 1 sekunde");
    expect(ahead(1000)).toBe("za 1 sekundu");
    expect(ago(86_400_000)).toBe("pre 1 dana");
    expect(ahead(86_400_000)).toBe("za 1 dan");
    // The paucal and the genitive plural are shared between the two directions,
    // which is why the difference is invisible until a count of one turns up.
    expect(ago(5 * 3_600_000)).toBe("pre 5 sati");
    expect(ahead(5 * 3_600_000)).toBe("za 5 sati");
  });

  it('says „pre 3 dana" and „za 3 dana" from the same span', () => {
    expect(ago(3 * 86_400_000)).toBe("pre 3 dana");
    expect(ahead(3 * 86_400_000)).toBe("za 3 dana");
  });

  it("truncates rather than rounds, so a count never overstates", () => {
    // 47 hours is one day, not two; 90 minutes is one hour, not two.
    expect(ago(47 * 3_600_000)).toBe("pre 1 dana");
    expect(ago(90 * 60_000)).toBe("pre 1 sata");
    expect(ago(59_999)).toBe("pre 59 sekundi");
  });

  it("counts months and years on the calendar rather than off an average month", () => {
    // 2026-08-09 back to 2026-07-09 is one whole month by the calendar.
    expect(relativeSpan(at(now.epochMs - 31 * 86_400_000), now)).toEqual({
      direction: "past",
      unit: "month",
      count: 1,
    });
    // A day short of a month is not a month, and weeks are what fills the gap.
    expect(relativeSpan(at(now.epochMs - 29 * 86_400_000), now)).toEqual({
      direction: "past",
      unit: "week",
      count: 4,
    });
    expect(relativeSpan(at(now.epochMs - 10 * 86_400_000), now)).toEqual({
      direction: "past",
      unit: "week",
      count: 1,
    });
    expect(relativeSpan(at(now.epochMs - 400 * 86_400_000), now)).toEqual({
      direction: "past",
      unit: "year",
      count: 1,
    });
  });
});

describe("durations", () => {
  it("reads the three spellings of ninety minutes as the same number", () => {
    expect(parseDuration("1h30m")).toBe(5_400_000);
    expect(parseDuration("90m")).toBe(5_400_000);
    expect(parseDuration("5400s")).toBe(5_400_000);
    expect(parseDuration("1.5h")).toBe(5_400_000);
    expect(parseDuration("1,5h")).toBe(5_400_000);
    expect(parseDuration("1h 30m")).toBe(5_400_000);
  });

  it('does not read „500ms" as five hundred minutes', () => {
    expect(parseDuration("500ms")).toBe(500);
    expect(parseDuration("1s500ms")).toBe(1500);
    expect(parseDuration("500m")).toBe(30_000_000);
  });

  it("covers every unit it accepts", () => {
    expect(parseDuration("1w")).toBe(604_800_000);
    expect(parseDuration("1d")).toBe(86_400_000);
    expect(parseDuration("1h")).toBe(3_600_000);
    expect(parseDuration("1m")).toBe(60_000);
    expect(parseDuration("1s")).toBe(1000);
    expect(parseDuration("1ms")).toBe(1);
    expect(parseDuration("-2h")).toBe(-7_200_000);
  });

  it("accepts a fraction that IS a whole number of milliseconds, whatever the double says", () => {
    // 1.1 × 3 600 000 is 3960000.0000000005 as a double, so an integrality test
    // taken on the product refuses a duration that is exactly 3 960 000 ms. The
    // written digits settle it and the binary expansion never gets a vote. „1.5h"
    // only ever passed because it happens to land on a double exactly.
    expect(parseDuration("1.1h")).toBe(3_960_000);
    expect(parseDuration("1,1h")).toBe(3_960_000);
    expect(parseDuration("2.2h")).toBe(7_920_000);
    expect(parseDuration("1.1d")).toBe(95_040_000);
    expect(parseDuration("1.1m")).toBe(66_000);
    expect(parseDuration("2.3h1.1m")).toBe(8_346_000);
    // A fraction the millisecond cannot hold is still refused, and on the same
    // digits: 0.001 s is exactly one millisecond, 1.0001 s is 1000.1 of them and
    // 0.5 ms is half of one.
    expect(parseDuration("0.001s")).toBe(1);
    expect(parseDuration("1.0001s")).toBeNull();
    expect(parseDuration("0.5ms")).toBeNull();
  });

  it("refuses what it cannot read one way only", () => {
    expect(parseDuration("1h1h")).toBeNull();
    // 5:30 is five and a half hours to one reader and five and a half minutes to
    // another, and nothing in the string settles it.
    expect(parseDuration("5:30")).toBeNull();
    // A bare number does not name a unit.
    expect(parseDuration("90")).toBeNull();
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("h")).toBeNull();
    expect(parseDuration("1h junk")).toBeNull();
    // 0,000 000 1 s is a tenth of a millisecond, which this cannot hold.
    expect(parseDuration("0,0000001s")).toBeNull();
  });

  it("formats to text its own parser reads back to the same number", () => {
    for (const ms of [0, 1, 999, 1500, 5_400_000, 90_061_001, -7_200_000, 604_800_000]) {
      const text = formatDurationCompact(ms);
      expect(parseDuration(text), text).toBe(ms);
    }
    expect(formatDurationCompact(5_400_000)).toBe("1h30m");
    expect(formatDurationCompact(0)).toBe("0s");
    // 1 d + 1 h + 1 m + 1 s + 1 ms, decomposed largest-first.
    expect(formatDurationCompact(90_061_001)).toBe("1d1h1m1s1ms");
    expect(formatDurationCompact(-7_200_000)).toBe("-2h");
    expect(formatDurationCompact(1.5)).toBe("");
  });

  it("normalises rather than echoes: format(parse(x)) says the same duration once", () => {
    expect(formatDurationCompact(parseDuration("90m") ?? -1)).toBe("1h30m");
    expect(formatDurationCompact(parseDuration("1h30m") ?? -1)).toBe("1h30m");
    // A week is read but never written, so it comes back in days.
    expect(formatDurationCompact(parseDuration("1w") ?? -1)).toBe("7d");
  });

  it("says the same duration in Serbian words, inflected", () => {
    expect(formatDurationSr(5_400_000)).toBe("1 sat 30 minuta");
    expect(formatDurationSr(0)).toBe("0 sekundi");
    expect(formatDurationSr(2 * 3_600_000 + 2000)).toBe("2 sata 2 sekunde");
    expect(formatDurationSr(90_061_001)).toBe("1 dan 1 sat 1 minut 1 sekunda 1 milisekunda");
  });
});

// ---------------------------------------------------------------------------

describe("the cron grammar", () => {
  it("expands the five-field shape and defaults its seconds to zero", () => {
    const spec = specOf("0 9 * * 1-5");
    expect(spec.fieldCount).toBe(5);
    expect(spec.seconds).toEqual([0]);
    expect(spec.minutes).toEqual([0]);
    expect(spec.hours).toEqual([9]);
    expect(spec.daysOfMonth.length).toBe(31);
    expect(spec.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(spec.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
  });

  it("takes a leading seconds field as the sixth shape", () => {
    const spec = specOf("15 0 9 * * *");
    expect(spec.fieldCount).toBe(6);
    expect(spec.seconds).toEqual([15]);
    expect(spec.minutes).toEqual([0]);
    expect(spec.hours).toEqual([9]);
  });

  it("expands steps from the field's own start, which is why a day step means ODD days", () => {
    // The day-of-month field starts at 1, not 0, so its step lands on 1, 3, 5 …
    expect(specOf("0 0 */2 * *").daysOfMonth).toEqual([
      1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31,
    ]);
    expect(specOf("*/15 * * * *").minutes).toEqual([0, 15, 30, 45]);
    expect(specOf("0 9-17/4 * * *").hours).toEqual([9, 13, 17]);
    // A bare value with a step runs to the end of the field.
    expect(specOf("0 5/6 * * *").hours).toEqual([5, 11, 17, 23]);
  });

  it("merges a list and sorts it, dropping the duplicates a list can carry", () => {
    expect(specOf("30,0,30 * * * *").minutes).toEqual([0, 30]);
    expect(specOf("0 0 1,15,30 * *").daysOfMonth).toEqual([1, 15, 30]);
  });

  it("answers to the three-letter names, in either case", () => {
    expect(specOf("0 0 * JAN-MAR *").months).toEqual([1, 2, 3]);
    expect(specOf("0 0 * dec *").months).toEqual([12]);
    expect(specOf("0 0 * * mon-fri").daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(specOf("0 0 * * SUN,SAT").daysOfWeek).toEqual([0, 6]);
  });

  it("normalises day-of-week 7 onto 0, since both are Sunday", () => {
    expect(specOf("0 0 * * 7").daysOfWeek).toEqual([0]);
    expect(specOf("0 0 * * 0,7").daysOfWeek).toEqual([0]);
    expect(specOf("0 0 * * 5-7").daysOfWeek).toEqual([0, 5, 6]);
  });

  it('treats ? as „no opinion", the same as a star, in the two day fields only', () => {
    const spec = specOf("0 0 13 * ?");
    expect(spec.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(spec.dayOfWeekStar).toBe(true);
    expect(spec.dayOfMonthStar).toBe(false);

    const inHour = parseCron("0 ? * * *");
    expect(inHour.ok).toBe(false);
    expect(inHour.ok ? null : inHour.error.field).toBe("hour");
    expect(parseCron("0 0 1,? * *").ok).toBe(false);
  });

  it("records the star flag from the FIRST CHARACTER, which is what Vixie tests", () => {
    // A step restricts the schedule to half the days and still counts as a star.
    expect(specOf("0 0 */2 * 5").dayOfMonthStar).toBe(true);
    expect(specOf("0 0 13 * 5").dayOfMonthStar).toBe(false);
    expect(specOf("0 0 13 * 5").dayOfWeekStar).toBe(false);
    expect(specOf("0 0 13 * *").dayOfWeekStar).toBe(true);
  });

  it("expands every macro and remembers which one was written", () => {
    for (const [macro, expansion] of Object.entries(CRON_MACROS)) {
      const fromMacro = specOf(macro);
      const fromText = specOf(expansion);
      expect({ ...fromMacro, macro: null }, macro).toEqual(fromText);
      expect(fromMacro.macro, macro).toBe(macro);
    }
    expect(specOf("@daily").hours).toEqual([0]);
    expect(specOf("@weekly").daysOfWeek).toEqual([0]);
    expect(specOf("@YEARLY").months).toEqual([1]);
    expect(specOf("@hourly").minutes).toEqual([0]);
  });

  it("refuses @reboot, which is a real line with no place on a timeline", () => {
    const result = parseCron("@reboot");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("reboot");
    expect(result.ok ? "" : result.error.message).toContain("@reboot");
  });
});

describe("the cron refusals", () => {
  const errorOf = (text: string): { code: string; field: string | null; message: string } => {
    const result = parseCron(text);
    if (result.ok) throw new Error(`${text} parsed when it should not have`);
    return { code: result.error.code, field: result.error.field, message: result.error.message };
  };

  it("names the field a value is out of range for, in Serbian", () => {
    expect(errorOf("60 * * * *")).toEqual({
      code: "range",
      field: "minute",
      message: 'Polje „minut" prihvata 0–59, a dobilo je „60".',
    });
    expect(errorOf("0 24 * * *").field).toBe("hour");
    expect(errorOf("0 0 32 * *").field).toBe("dayOfMonth");
    expect(errorOf("0 0 * 13 *").field).toBe("month");
    expect(errorOf("0 0 * * 8")).toEqual({
      code: "range",
      field: "dayOfWeek",
      message: 'Polje „dan u nedelji" prihvata 0–7, a dobilo je „8".',
    });
    // Six fields, so the leading one is the seconds — and „0 0 * * * 60" would
    // put the 60 in the day-of-week, which is a different refusal entirely.
    expect(errorOf("60 0 0 * * *").field).toBe("second");
    expect(errorOf("0 0 * * * 60").field).toBe("dayOfWeek");
  });

  it("refuses a range that runs backwards rather than wrapping it around", () => {
    expect(errorOf("0 17-9 * * *")).toEqual({
      code: "range-order",
      field: "hour",
      message: 'Opseg u polju „sat" ide unazad: „17-9".',
    });
    expect(errorOf("0 0 * * FRI-MON").code).toBe("range-order");
  });

  it("refuses a step that is not a whole number above zero", () => {
    expect(errorOf("*/0 * * * *").code).toBe("step");
    expect(errorOf("*/x * * * *").code).toBe("step");
    expect(errorOf("*/2/3 * * * *").code).toBe("syntax");
  });

  it("refuses a field count that is neither five nor six", () => {
    expect(errorOf("0 0 * *")).toEqual({
      code: "field-count",
      field: null,
      message: "Cron izraz mora imati 5 ili 6 polja, a ima 4.",
    });
    expect(errorOf("0 0 * * * * *").code).toBe("field-count");
    expect(errorOf("").code).toBe("empty");
  });

  it("refuses a token it cannot read, and an unknown macro", () => {
    expect(errorOf("0 0 * * MAYBE").code).toBe("syntax");
    expect(errorOf("0 0 * * 1,,2").code).toBe("syntax");
    expect(errorOf("@sometimes")).toEqual({
      code: "unknown-macro",
      field: null,
      message: 'Nepoznat makro „@sometimes".',
    });
  });
});

describe("the day-of-month / day-of-week union", () => {
  /**
   * August 2026 opens on a Saturday (2026-08-01 is epoch day 20 666, and
   * 20 666 mod 7 = 2 counting from the epoch's Thursday). So its Fridays are the
   * 7th, 14th, 21st and 28th, and the 13th is a Thursday.
   */
  const AUG_1 = (DAY_2026_01_01 + 212) * 86_400_000;
  const day = (dayOfMonth: number): number => (DAY_2026_01_01 + 211 + dayOfMonth) * 86_400_000;

  it("fires on the 13th AND on every Friday when neither day field is a star", () => {
    // This is the rule the whole cron half exists for. As an INTERSECTION this
    // expression would fire on Friday the 13th — twice in 2026, not five times
    // in August alone.
    expect(firedAt("0 0 13 * 5", AUG_1, 5)).toEqual([day(7), day(13), day(14), day(21), day(28)]);
  });

  it("flips to an intersection when a day field merely BEGINS with a star", () => {
    // „*/2" restricts the schedule to the odd days and still sets Vixie's star
    // flag, so this is odd days that are also Fridays: the 7th and the 21st, and
    // then 11 September.
    expect(firedAt("0 0 */2 * 5", AUG_1, 3)).toEqual([
      day(7),
      day(21),
      (DAY_2026_01_01 + 253) * 86_400_000,
    ]);
  });

  it("lets one restricted field govern alone when the other is a star", () => {
    expect(firedAt("0 0 13 * *", AUG_1, 2)).toEqual([day(13), (DAY_2026_01_01 + 255) * 86_400_000]);
    expect(firedAt("0 0 * * 5", AUG_1, 4)).toEqual([day(7), day(14), day(21), day(28)]);
  });

  it("treats ? as the star it stands in for", () => {
    expect(firedAt("0 0 13 * ?", AUG_1, 1)).toEqual(firedAt("0 0 13 * *", AUG_1, 1));
  });
});

describe("the next fire times", () => {
  const JAN_1 = DAY_2026_01_01 * 86_400_000;

  it("returns times strictly after the instant given, never the instant itself", () => {
    const midnight = specOf("0 0 * * *");
    expect(firedAt("0 0 * * *", JAN_1, 1)).toEqual([JAN_1 + 86_400_000]);
    expect(nextFireTimes(midnight, at(JAN_1 - 1), 1)?.[0]?.epochMs).toBe(JAN_1);
  });

  it("walks minutes, hours and months in order", () => {
    expect(firedAt("*/15 * * * *", JAN_1, 4)).toEqual([
      JAN_1 + 900_000,
      JAN_1 + 1_800_000,
      JAN_1 + 2_700_000,
      JAN_1 + 3_600_000,
    ]);
    // @yearly from 1 January 2026 is 1 January 2027 — 365 days on, 2026 being a
    // common year.
    expect(firedAt("@yearly", JAN_1, 1)).toEqual([JAN_1 + 365 * 86_400_000]);
  });

  it("walks the seconds field too, when one was given", () => {
    // Both shapes run through one matcher because a five-field expression is a
    // six-field one whose seconds are [0].
    expect(firedAt("*/30 * * * * *", JAN_1, 3)).toEqual([
      JAN_1 + 30_000,
      JAN_1 + 60_000,
      JAN_1 + 90_000,
    ]);
    expect(firedAt("15 0 9 * * *", JAN_1, 1)).toEqual([JAN_1 + 9 * 3_600_000 + 15_000]);
  });

  it("gives up rather than looping on an expression that can never fire", () => {
    // 30 February is a well-formed request and an impossible date.
    expect(firedAt("0 0 30 2 *", JAN_1, 1)).toEqual([]);
  });

  it("answers nothing at all for a count that is not a count", () => {
    expect(firedAt("0 0 * * *", JAN_1, 0)).toEqual([]);
    expect(firedAt("0 0 * * *", JAN_1, -3)).toEqual([]);
    expect(firedAt("0 0 * * *", JAN_1, 2.5)).toEqual([]);
  });

  it("runs on the wall clock of the zone it was given", () => {
    // Midnight in Belgrade in January is 23:00 UTC the day before.
    expect(firedAt("0 0 * * *", JAN_1, 1, "Europe/Belgrade")).toEqual([
      JAN_1 + 86_400_000 - 3_600_000,
    ]);
    expect(firedAt("0 0 * * *", JAN_1, 1, "UTC")).toEqual([JAN_1 + 86_400_000]);
  });

  it("skips a fire time daylight saving never lets happen", () => {
    // Belgrade springs forward on the last Sunday in March, which is the 29th in
    // 2026 — so 02:30 that day does not exist and the job does not run. The next
    // one is 2027-03-29, a Monday two days after the 2027 transition, at 02:30
    // CEST = 00:30 UTC. Epoch day 20 906 → 1 806 278 400 s, plus 1 800.
    expect(firedAt("30 2 29 3 *", JAN_1, 1, "Europe/Belgrade")).toEqual([1_806_280_200_000]);
  });

  it("fires once, at the earlier reading, when the clock repeats an hour", () => {
    // Belgrade falls back on the last Sunday in October, the 25th in 2026, so
    // 02:30 happens twice. The earlier is CEST (+02:00) — 00:30 UTC on epoch day
    // 20 751 → 1 792 886 400 s, plus 1 800 — and it fires there and not again.
    const OCT_1 = (DAY_2026_01_01 + 273) * 86_400_000;
    expect(firedAt("30 2 25 10 *", OCT_1, 1, "Europe/Belgrade")).toEqual([1_792_888_200_000]);
  });

  it("keeps the list strictly increasing across a transition", () => {
    const OCT_25 = (DAY_2026_01_01 + 297) * 86_400_000;
    const times = firedAt("0 * * * *", OCT_25 - 3_600_000, 6, "Europe/Belgrade");
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index] ?? 0, String(index)).toBeGreaterThan(times[index - 1] ?? 0);
    }
  });
});

describe("the cron explanation in Serbian", () => {
  const explain = (text: string): string => explainCronSr(specOf(text));

  it("spells out the clock times when there are few enough of them", () => {
    expect(explain("0 9 * * *")).toBe("u 09:00");
    expect(explain("30 8 * * 1")).toBe("u 08:30, ponedeljkom");
    expect(explain("0 0,12 * * *")).toBe("u 00:00 i 12:00");
    expect(explain("0 9-11 * * *")).toBe("u 09:00, 10:00 i 11:00");
    // A seconds field that is not the implicit zero has to reach the clock time,
    // or „u 09:00" would be describing a job that runs half a minute later.
    expect(explain("30 0 9 * * *")).toBe("u 09:00:30");
  });

  it("describes the fields once there are too many times to list", () => {
    expect(explain("*/15 * * * *")).toBe("svakih 15 minuta");
    expect(explain("*/30 9-17 * * 1-5")).toBe(
      "svakih 30 minuta, od 9 do 17 sati, od ponedeljka do petka",
    );
    expect(explain("0 * * * *")).toBe("svakog sata u :00");
    expect(explain("* * * * *")).toBe("svakog minuta");
    expect(explain("15,45 * * * *")).toBe("u minutima 15 i 45");
  });

  it("agrees the determiner with the noun's gender and number, as Serbian requires", () => {
    // „svakih" governs the genitive plural; the paucal takes „svaka" for a
    // masculine noun and „svake" for a feminine one.
    expect(explain("*/2 * * * *")).toBe("svaka 2 minuta");
    expect(explain("*/5 * * * *")).toBe("svakih 5 minuta");
    expect(explain("0 */2 * * *")).toBe("u 0. minutu, svaka 2 sata");
    expect(explain("*/2 * * * * *")).toBe("svake 2 sekunde");
    expect(explain("*/5 * * * * *")).toBe("svakih 5 sekundi");
  });

  it('says „ili" for the union and „i" for the intersection, which is the whole point', () => {
    expect(explain("0 0 13 * 5")).toBe("u 00:00, 13. u mesecu ili petkom");
    expect(explain("0 0 */2 * 5")).toBe("u 00:00, svaki 2. dan u mesecu i petkom");
  });

  it("names the months and the weekdays in the case the phrase puts them in", () => {
    expect(explain("@yearly")).toBe("u 00:00, 1. u mesecu, u januaru");
    expect(explain("0 0 1 1,4,11 *")).toBe("u 00:00, 1. u mesecu, u januaru, aprilu i novembru");
    // An evenly spaced list that spans the field IS a step and is worded as one:
    // 1,4,7,10 and a star with a step of three are the same twelve-month cycle.
    expect(explain("0 0 1 1,4,7,10 *")).toBe("u 00:00, 1. u mesecu, svaki 3. mesec");
    expect(explain("0 0 * 6-8 *")).toBe("u 00:00, od juna do avgusta");
    expect(explain("0 0 * * 1,3,5")).toBe("u 00:00, ponedeljkom, sredom i petkom");
    expect(explain("0 0 1,15 * *")).toBe("u 00:00, 1. i 15. u mesecu");
  });

  it('says „svakog dana" for a day field spelled out as a full range, which fires daily', () => {
    // „1-31" covers every day AND leaves Vixie's star flag clear, so `dayMatches`
    // takes the OR branch and the job runs every day. The explanation used to
    // drop the field — its VALUES are the whole range, which reads as „says
    // nothing" — and then said „petkom" about a schedule that is nothing of the
    // sort, stating the opposite of what the expression does.
    expect(explain("0 0 1-31 * 5")).toBe("u 00:00, svakog dana");
    expect(explain("0 0 13 * 0-6")).toBe("u 00:00, svakog dana");
    expect(explain("0 0 1-31 * *")).toBe("u 00:00, svakog dana");
    expect(explain("0 0 * * 0-7")).toBe("u 00:00, svakog dana");
    // Two literal stars still say nothing at all, which is the ordinary case.
    expect(explain("0 0 * * *")).toBe("u 00:00");
    // And the sentence is checked against the schedule it claims to describe:
    // three fire times one day apart is „svakog dana", not „petkom".
    const JAN_1 = DAY_2026_01_01 * 86_400_000;
    expect(firedAt("0 0 1-31 * 5", JAN_1, 3)).toEqual([
      JAN_1 + 86_400_000,
      JAN_1 + 2 * 86_400_000,
      JAN_1 + 3 * 86_400_000,
    ]);
  });

  it("never claims a daily schedule, over every shape of the two day fields", () => {
    /**
     * The equivalence the defect broke, checked rather than argued: the sentence
     * says „every day" — either by leaving the day clause out entirely, which is
     * what two literal stars earn, or by saying „svakog dana" — exactly when the
     * expression really does fire on all 31 days of the month. Both spellings of
     * a wide-open field are in the grid, and so is `?`, so the star flag and the
     * value set disagree in both directions somewhere in here.
     */
    const AUG_1 = (DAY_2026_01_01 + 212) * 86_400_000;
    const daysOfMonth = ["*", "?", "1-31", "1-31/1", "*/2", "13", "1,15", "1-15"];
    const daysOfWeek = ["*", "?", "0-6", "0-7", "*/2", "5", "1-5", "0,6"];
    const disagreements: string[] = [];
    for (const dayOfMonth of daysOfMonth) {
      for (const dayOfWeek of daysOfWeek) {
        const text = `0 0 ${dayOfMonth} * ${dayOfWeek}`;
        const fires = firedAt(text, AUG_1 - 1, 31).filter((ms) => ms < AUG_1 + 31 * 86_400_000);
        const sentence = explain(text);
        const saysEveryDay = sentence === "u 00:00" || sentence === "u 00:00, svakog dana";
        if (saysEveryDay !== (fires.length === 31)) {
          disagreements.push(`${text} → „${sentence}" for ${fires.length} of 31 days`);
        }
      }
    }
    expect(disagreements).toEqual([]);
  });

  it("says something for every macro rather than falling silent", () => {
    for (const macro of Object.keys(CRON_MACROS)) {
      expect(explain(macro), macro).not.toBe("");
    }
    expect(explain("@daily")).toBe("u 00:00");
    expect(explain("@weekly")).toBe("u 00:00, nedeljom");
    expect(explain("@hourly")).toBe("svakog sata u :00");
  });
});
