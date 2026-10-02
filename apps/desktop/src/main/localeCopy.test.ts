import { afterEach, describe, expect, it } from "vitest";

import { setMainLocale } from "./locale.js";
import {
  catchUpDigestCopy,
  documentNotificationCopy,
  emptyDigestCounts,
  examNotificationCopy,
  eventNotificationCopy,
  focusPhaseEndCopy,
  habitNotificationCopy,
  restEndCopy,
  securityNotificationCopy,
  studyDayNotificationCopy,
  subscriptionNotificationCopy,
  taskNotificationCopy,
  windowDigestCopy,
} from "./notificationStrings.js";
import { shellStrings } from "./shellStrings.js";

/**
 * Main's copy is composed from a locale variable rather than from the
 * renderer's table, so the switch is only proven by reading the composers back
 * in the new language. Each test therefore pins the same call in both
 * languages, which is also what catches a helper that captured the language at
 * import instead of reading it per call.
 */

afterEach(() => {
  setMainLocale("sr");
});

describe("main's native chrome", () => {
  it("writes Serbian by default and English after the renderer reports", () => {
    expect(shellStrings().defaultAccountLabel).toBe("Moj nalog");
    expect(shellStrings().noteCopySuffix).toBe(" (kopija)");

    setMainLocale("en");
    expect(shellStrings().defaultAccountLabel).toBe("My account");
    expect(shellStrings().noteCopySuffix).toBe(" (copy)");
    expect(shellStrings().backupProfileSlugFallback).toBe("profile");
    expect(shellStrings().calendarFilterName).toBe("Calendar (iCalendar)");
    expect(shellStrings().rosWorkspaceDialogButton).toBe("Create here");
  });
});

describe("main's notification copy follows the reported locale", () => {
  it("documents: the Serbian day ladder becomes English one/other", () => {
    setMainLocale("en");
    expect(documentNotificationCopy("Passport", "2026-08-10", "2026-07-31", false)).toEqual({
      title: "Document expires soon",
      body: "“Passport” expires in 10 days (10/08/2026)",
    });
    expect(documentNotificationCopy("Passport", "2026-07-31", "2026-07-31", true)).toEqual({
      title: "Last warning: document expires",
      body: "“Passport” expires today (31/07/2026)",
    });
    // One day is the singular; zero takes the plural, as English requires.
    expect(documentNotificationCopy("Passport", "2026-08-01", "2026-07-31", false).body).toContain(
      "expires in 1 day",
    );
  });

  it("exams name the type in English", () => {
    setMainLocale("en");
    expect(examNotificationCopy("Analiza 1", "kolokvijum", "d-1")).toEqual({
      title: "Exam tomorrow",
      body: "Analiza 1 — Midterm",
    });
    expect(examNotificationCopy("Analiza 1", "usmeni", "d-0")).toEqual({
      title: "Exam is today",
      body: "Analiza 1 — Oral",
    });
  });

  it("tasks and events date themselves the English way", () => {
    setMainLocale("en");
    expect(taskNotificationCopy("Submit report", "2026-08-01", "2026-07-31", 1)).toEqual({
      title: "Task: Submit report",
      body: "Due tomorrow · 1 day earlier",
    });
    expect(eventNotificationCopy("Dentist", "2026-08-05", "2026-07-31", "14:30", 30)).toEqual({
      title: "Event: Dentist",
      body: "Starts 05/08/2026 at 14:30 · 30 min earlier",
    });
    expect(eventNotificationCopy("Holiday", "2026-08-01", "2026-07-31", null, 0)).toEqual({
      title: "Event: Holiday",
      body: "All day · tomorrow",
    });
  });

  it("subscriptions format money with a point, not a comma", () => {
    setMainLocale("en");
    expect(subscriptionNotificationCopy("Netflix", "2026-08-05", "2026-08-01", 1190, "EUR", 2)).toEqual(
      {
        title: "Subscription: Netflix",
        body: "Charge: 05/08/2026 · 11.90 EUR · 2 days earlier",
      },
    );
  });

  it("security notices keep their tone and their instant", () => {
    setMainLocale("en");
    const lockedUntil = new Date(2026, 6, 31, 14, 32, 0).toISOString();
    expect(
      securityNotificationCopy({ kind: "unlock-throttle", at: "2026-07-31T09:00:00.000Z", failedAttempts: 1, lockedUntil }),
    ).toEqual({
      title: "Several failed unlock attempts",
      body: "1 failed attempt before this unlock · locked until 31/07/2026 at 14:32",
    });
    expect(securityNotificationCopy({ kind: "passcode-changed", at: "2026-07-31T09:00:00.000Z" })).toEqual({
      title: "PIN changed",
      body: "Unlocking now requires the new PIN.",
    });
    expect(
      securityNotificationCopy({ kind: "account-deleted", at: "2026-07-31T09:00:00.000Z", label: "Posao" }),
    ).toEqual({ title: "Account deleted", body: "The account “Posao” was deleted from this device." });
  });

  it("habits, focus, rest and study days", () => {
    setMainLocale("en");
    expect(habitNotificationCopy("Water", { kind: "quota", perWeek: 3 }, 8, "glass")).toEqual({
      title: "Habit: Water",
      body: "3× a week · goal: 8 glass",
    });
    expect(habitNotificationCopy("Stretch", { kind: "days", weekdays: [1, 3, 5] }, null, null)).toEqual({
      title: "Habit: Stretch",
      body: "Mon · Wed · Fri",
    });
    expect(focusPhaseEndCopy("work", 25, null)).toEqual({ title: "Focus is done", body: "25 min" });
    expect(focusPhaseEndCopy("long_break", 15, null).title).toBe("Long break is over");
    expect(restEndCopy(90).title).toBe("Rest is over");
    expect(studyDayNotificationCopy(3, 90)).toEqual({
      title: "Study today",
      body: "3 blocks · 90 min",
    });
    expect(studyDayNotificationCopy(1, 45).body).toBe("1 block · 45 min");
  });

  it("digests count in English", () => {
    setMainLocale("en");
    const counts = { ...emptyDigestCounts(), document: 2, task: 1 };
    expect(windowDigestCopy(3, counts)).toEqual({
      title: "3 new notifications",
      body: "2 documents · 1 task",
    });
    expect(catchUpDigestCopy(1, counts).title).toBe("While you were away: 1 notification");
  });
});
