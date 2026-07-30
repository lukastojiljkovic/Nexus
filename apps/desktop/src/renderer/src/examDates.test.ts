import { afterEach, describe, expect, it, vi } from "vitest";

import {
  daysUntilExam,
  examCountdownLabel,
  examCountdownVariant,
  formatExamDate,
  localTodayKey,
  shiftDayKey,
} from "./examDates.js";
import { strings } from "./strings.js";

/**
 * The two clock-reading helpers (`daysUntilExam`, `localTodayKey`) read LOCAL
 * wall-clock y/m/d, so every case pins "now" with fake timers built from local
 * fields — including the two edges of a day, which is exactly where a
 * negative-offset host would shift the answer if the module's UTC-midnight
 * arithmetic were wrong.
 *
 * `formatExamDate` renders through `Intl` and is asserted at the shape level
 * only; the countdown copy is asserted against `strings.ts` rather than
 * re-spelled here, so the test also pins the Serbian singular/plural agreement
 * without duplicating the words.
 */

afterEach(() => {
  vi.useRealTimers();
});

/** Pins "now" to a local wall-clock moment — local fields on purpose, so the host's zone cannot move the day. */
function pinLocal(year: number, monthIndex: number, day: number, hour: number, minute = 0): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(year, monthIndex, day, hour, minute, 0));
}

describe("daysUntilExam", () => {
  it("counts whole days forward and backward from today", () => {
    pinLocal(2026, 6, 30, 12);
    expect(daysUntilExam("2026-07-30")).toBe(0);
    expect(daysUntilExam("2026-07-31")).toBe(1);
    expect(daysUntilExam("2026-08-02")).toBe(3);
    expect(daysUntilExam("2026-07-29")).toBe(-1);
    expect(daysUntilExam("2026-06-30")).toBe(-30);
  });

  it("gives the same answer at both edges of the local day", () => {
    pinLocal(2026, 6, 30, 0, 0);
    expect(daysUntilExam("2026-07-30")).toBe(0);
    expect(daysUntilExam("2026-08-01")).toBe(2);

    pinLocal(2026, 6, 30, 23, 59);
    expect(daysUntilExam("2026-07-30")).toBe(0);
    expect(daysUntilExam("2026-08-01")).toBe(2);
  });

  it("ignores a time part on the exam date", () => {
    pinLocal(2026, 6, 30, 12);
    expect(daysUntilExam("2026-08-02T23:45:00.000Z")).toBe(3);
  });

  it("is NaN for a date whose parts are not numbers", () => {
    pinLocal(2026, 6, 30, 12);
    expect(daysUntilExam("not-a-date")).toBeNaN();
    expect(daysUntilExam("")).toBeNaN();
  });
});

describe("localTodayKey", () => {
  it("is the local calendar day, zero-padded, at both edges of that day", () => {
    pinLocal(2026, 6, 30, 0, 0);
    expect(localTodayKey()).toBe("2026-07-30");

    pinLocal(2026, 6, 30, 23, 59);
    expect(localTodayKey()).toBe("2026-07-30");

    pinLocal(2026, 0, 5, 12);
    expect(localTodayKey()).toBe("2026-01-05");
  });

  it("agrees with daysUntilExam about which day today is", () => {
    pinLocal(2026, 6, 30, 23, 59);
    expect(daysUntilExam(localTodayKey())).toBe(0);
  });
});

describe("shiftDayKey", () => {
  it("moves whole days in either direction", () => {
    expect(shiftDayKey("2026-07-30", 0)).toBe("2026-07-30");
    expect(shiftDayKey("2026-07-30", 1)).toBe("2026-07-31");
    expect(shiftDayKey("2026-07-30", -1)).toBe("2026-07-29");
    expect(shiftDayKey("2026-07-30", 7)).toBe("2026-08-06");
  });

  it("crosses month, year and leap-day boundaries", () => {
    expect(shiftDayKey("2026-07-31", 1)).toBe("2026-08-01");
    expect(shiftDayKey("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDayKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDayKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDayKey("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftDayKey("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("does not drift across a daylight-saving transition (UTC-midnight math)", () => {
    // Last Sunday of March / October — the two European DST switches.
    expect(shiftDayKey("2026-03-28", 2)).toBe("2026-03-30");
    expect(shiftDayKey("2026-10-24", 2)).toBe("2026-10-26");
  });
});

describe("formatExamDate", () => {
  it("returns the raw input unchanged when it is not a date", () => {
    expect(formatExamDate("not-a-date")).toBe("not-a-date");
  });

  it("renders a bare day, and ignores any time part on the way in", () => {
    const rendered = formatExamDate("2026-07-08");
    expect(rendered).not.toBe("2026-07-08");
    expect(rendered).toContain("2026");
    expect(rendered).toContain("8");
    // Pinned to UTC inside the module, so a time part cannot move the day.
    expect(formatExamDate("2026-07-08T23:45:00.000Z")).toBe(rendered);
  });
});

describe("examCountdownLabel", () => {
  const c = strings.study.countdown;

  it("names today, tomorrow and the past without a number", () => {
    expect(examCountdownLabel(0)).toBe(c.today);
    expect(examCountdownLabel(1)).toBe(c.tomorrow);
    expect(examCountdownLabel(-1)).toBe(c.past);
    expect(examCountdownLabel(-100)).toBe(c.past);
  });

  it("agrees in Serbian number: -1 takes the singular unless it ends in 11", () => {
    expect(examCountdownLabel(2)).toBe(`${c.future} 2 ${c.unitMany}`);
    expect(examCountdownLabel(11)).toBe(`${c.future} 11 ${c.unitMany}`);
    expect(examCountdownLabel(21)).toBe(`${c.future} 21 ${c.unitOne}`);
    expect(examCountdownLabel(101)).toBe(`${c.future} 101 ${c.unitOne}`);
    expect(examCountdownLabel(111)).toBe(`${c.future} 111 ${c.unitMany}`);
  });
});

describe("examCountdownVariant", () => {
  it("is urgent within a day, informational further out, quiet once past", () => {
    expect(examCountdownVariant(0)).toBe("accent");
    expect(examCountdownVariant(1)).toBe("accent");
    expect(examCountdownVariant(2)).toBe("data");
    expect(examCountdownVariant(365)).toBe("data");
    expect(examCountdownVariant(-1)).toBe("neutral");
  });
});
