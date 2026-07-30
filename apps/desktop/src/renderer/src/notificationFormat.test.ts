import { afterEach, describe, expect, it, vi } from "vitest";

import { ALL_NOTIFICATION_SOURCES, bellCountLabel, formatNotificationWhen } from "./notificationFormat.js";

/**
 * `formatNotificationWhen` branches on "is this instant on TODAY's local
 * calendar day", so every case here pins the clock with fake timers and builds
 * its instants from LOCAL y/m/d fields — that way the same assertions hold in
 * any host time zone. What is asserted is the two SHAPES the module promises
 * ("HH:MM" vs "<day>, HH:MM"), never a locale-rendered day or month name.
 */

afterEach(() => {
  vi.useRealTimers();
});

/** Pins "now" to local noon on 30 July 2026 — noon so no host offset can push it onto a neighbouring day. */
function pinNoon(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 30, 12, 0, 0));
}

describe("ALL_NOTIFICATION_SOURCES", () => {
  it("is the five NTF sources, in their fixed order and without duplicates", () => {
    expect(ALL_NOTIFICATION_SOURCES).toEqual(["document", "exam", "study-day", "event", "task"]);
    expect(new Set(ALL_NOTIFICATION_SOURCES).size).toBe(ALL_NOTIFICATION_SOURCES.length);
  });
});

describe("bellCountLabel", () => {
  it("is null at or below zero — the badge is never drawn empty", () => {
    expect(bellCountLabel(0)).toBeNull();
    expect(bellCountLabel(-3)).toBeNull();
  });

  it("counts up to nine and caps beyond it", () => {
    expect(bellCountLabel(1)).toBe("1");
    expect(bellCountLabel(9)).toBe("9");
    expect(bellCountLabel(10)).toBe("9+");
    expect(bellCountLabel(1_000)).toBe("9+");
  });
});

describe("formatNotificationWhen", () => {
  it("returns the raw input unchanged when it is not a date", () => {
    expect(formatNotificationWhen("not-a-date")).toBe("not-a-date");
    expect(formatNotificationWhen("")).toBe("");
  });

  it("is a bare clock for an instant on today's local day", () => {
    pinNoon();
    const earlierToday = new Date(2026, 6, 30, 9, 5, 0).toISOString();
    expect(formatNotificationWhen(earlierToday)).toMatch(/^\d{2}:\d{2}$/);
  });

  it("prefixes a day for any other local day, in both directions", () => {
    pinNoon();
    const past = new Date(2026, 0, 5, 9, 30, 0).toISOString();
    const future = new Date(2026, 11, 24, 18, 45, 0).toISOString();
    expect(formatNotificationWhen(past)).toMatch(/^.+,\s\d{2}:\d{2}$/);
    expect(formatNotificationWhen(future)).toMatch(/^.+,\s\d{2}:\d{2}$/);
    expect(formatNotificationWhen(past)).not.toBe(formatNotificationWhen(future));
  });

  it("treats the same instant identically however it is spelled", () => {
    pinNoon();
    expect(formatNotificationWhen("2026-01-05T10:00:00.000Z")).toBe(
      formatNotificationWhen("2026-01-05T12:00:00.000+02:00"),
    );
  });
});
