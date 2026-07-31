import { describe, expect, it } from "vitest";

import { computeSnoozeUntil, resolveDefaultSnoozePreset, TONIGHT_HOUR } from "./snooze.js";

/**
 * Both helpers are clock-parameterized (`now: Date`), so every case here builds
 * its instants from LOCAL y/m/d fields and asserts local wall-clock components
 * of the result — the same discipline `notificationFormat.test.ts` uses, and
 * what makes these assertions hold whatever time zone the host is set to.
 */

const MORNING = "08:00";

/** 30 July 2026, local. */
function at(hour: number, minute = 0): Date {
  return new Date(2026, 6, 30, hour, minute, 0, 0);
}

function local(iso: string): Date {
  return new Date(iso);
}

describe("computeSnoozeUntil", () => {
  it("adds ten minutes for 10m", () => {
    const until = local(computeSnoozeUntil("10m", at(9, 55), MORNING));
    expect(until.getHours()).toBe(10);
    expect(until.getMinutes()).toBe(5);
  });

  it("adds an hour for 1h, crossing midnight when it must", () => {
    const until = local(computeSnoozeUntil("1h", at(23, 30), MORNING));
    expect(until.getDate()).toBe(31);
    expect(until.getHours()).toBe(0);
    expect(until.getMinutes()).toBe(30);
  });

  it("lands on today's evening hour for tonight", () => {
    const until = local(computeSnoozeUntil("tonight", at(9), MORNING));
    expect(until.getDate()).toBe(30);
    expect(until.getHours()).toBe(TONIGHT_HOUR);
    expect(until.getMinutes()).toBe(0);
  });

  it("lands on tomorrow at the profile's own morning hour", () => {
    const until = local(computeSnoozeUntil("tomorrow-morning", at(9), "07:30"));
    expect(until.getDate()).toBe(31);
    expect(until.getHours()).toBe(7);
    expect(until.getMinutes()).toBe(30);
  });

  it("carries tomorrow across a month boundary", () => {
    const until = local(computeSnoozeUntil("tomorrow-morning", new Date(2026, 6, 31, 9), MORNING));
    expect(until.getMonth()).toBe(7);
    expect(until.getDate()).toBe(1);
  });
});

/**
 * NTF-009: the plain „Odloži“ button uses the profile's default, and a default
 * of „Večeras“ has nothing left to offer once the evening hour has passed — the
 * store refuses a deadline that is not in the future. An explicit chip is hidden
 * by the UI in that window; the default has no chip to hide, so it falls
 * forward here instead of failing.
 */
describe("resolveDefaultSnoozePreset", () => {
  it("leaves every preset alone in the morning", () => {
    for (const preset of ["10m", "1h", "tonight", "tomorrow-morning"] as const) {
      expect(resolveDefaultSnoozePreset(preset, at(9))).toBe(preset);
    }
  });

  it("keeps tonight right up to the evening hour", () => {
    expect(resolveDefaultSnoozePreset("tonight", at(TONIGHT_HOUR - 1, 59))).toBe("tonight");
  });

  it("falls forward to tomorrow morning from the evening hour on", () => {
    expect(resolveDefaultSnoozePreset("tonight", at(TONIGHT_HOUR))).toBe("tomorrow-morning");
    expect(resolveDefaultSnoozePreset("tonight", at(23, 59))).toBe("tomorrow-morning");
  });

  it("never rewrites a preset that is still usable in the evening", () => {
    expect(resolveDefaultSnoozePreset("10m", at(23))).toBe("10m");
    expect(resolveDefaultSnoozePreset("1h", at(23))).toBe("1h");
    expect(resolveDefaultSnoozePreset("tomorrow-morning", at(23))).toBe("tomorrow-morning");
  });

  it("resolves to an instant the store will accept, which is the whole point", () => {
    const now = at(20);
    const preset = resolveDefaultSnoozePreset("tonight", now);
    expect(computeSnoozeUntil(preset, now, MORNING) > now.toISOString()).toBe(true);
  });
});
