import { afterEach, describe, expect, it } from "vitest";
import { applyLocale } from "../../../renderer/src/strings.js";
import {
  dateOfDayKey,
  dayKeyOf,
  formatCount,
  formatDay,
  formatHourMinute,
  formatPercent,
  formatSeconds,
  formatSpeed,
  formatStamp,
  intlLocale,
  todayKey,
  weekdayName,
} from "./format.js";

/**
 * The page's formatters (mini-apps).
 *
 * Every expected value below is CLDR's own output for the locale, measured on
 * this machine with the same `Intl` calls the module makes and written down
 * here: Serbian writes `12.345` where English writes `12,345`, and a percent
 * sign sits against the number in both. A test that only asked "is it a string"
 * would pass for a formatter that never consulted the locale at all, which is
 * the defect this file exists to catch.
 */
const SR = {
  count: "12.345",
  percent: "96,5%",
  speed: "41,5",
  day: "17. maj 2026.",
  weekday: "ponedeljak",
} as const;

const EN = {
  count: "12,345",
  percent: "96.5%",
  speed: "41.5",
  day: "May 17, 2026",
  weekday: "Monday",
} as const;

afterEach(() => {
  applyLocale("sr");
});

describe("the module's formatters", () => {
  it("reads a count, a percentage and a speed in the active language", () => {
    applyLocale("sr");
    expect(intlLocale()).toBe("sr-Latn");
    expect(formatCount(12_345)).toBe(SR.count);
    expect(formatPercent(0.965)).toBe(SR.percent);
    expect(formatSpeed(41.5)).toBe(SR.speed);

    applyLocale("en");
    expect(intlLocale()).toBe("en-US");
    expect(formatCount(12_345)).toBe(EN.count);
    expect(formatPercent(0.965)).toBe(EN.percent);
    expect(formatSpeed(41.5)).toBe(EN.speed);
  });

  it("reads a date and its weekday in the active language", () => {
    applyLocale("sr");
    expect(formatDay("2026-05-17")).toBe(SR.day);
    // 2026-05-18 is a Monday; the weekday is asked of the calendar, not of the
    // machine's own locale.
    expect(weekdayName("2026-05-18")).toBe(SR.weekday);

    applyLocale("en");
    expect(formatDay("2026-05-17")).toBe(EN.day);
    expect(weekdayName("2026-05-18")).toBe(EN.weekday);
  });

  it("rounds a span up to the next whole second", () => {
    expect(formatSeconds(12.1)).toBe("13 s");
    expect(formatSeconds(12)).toBe("12 s");
    expect(formatSeconds(-4)).toBe("0 s");
  });

  it("writes a clock reading as two digits on the hour and the minute", () => {
    // Built in local time on purpose: the formatter reads the clock in the
    // active locale's own zone, so an instant would depend on this machine's.
    expect(formatHourMinute(new Date(2026, 4, 18, 14, 5).getTime())).toBe("14:05");
  });

  it("refuses a date key the calendar does not have, rather than rolling it over", () => {
    expect(dateOfDayKey("2026-02-30")).toBeNull();
    expect(dateOfDayKey("17.5.2026")).toBeNull();
    expect(dayKeyOf(dateOfDayKey("2026-05-17") as Date)).toBe("2026-05-17");
  });

  it("answers today in the same key shape it parses", () => {
    const today = todayKey();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dateOfDayKey(today)).not.toBeNull();
  });

  it("stamps an instant as a short date and time", () => {
    const stamp = formatStamp(new Date(2026, 4, 18, 14, 5).getTime());
    expect(stamp).toContain("2026");
    expect(stamp).toContain("14:05");
  });
});
