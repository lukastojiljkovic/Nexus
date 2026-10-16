import { describe, expect, it, vi } from "vitest";
import { deriveNotificationCandidates } from "@nexus/core";
import type { NotificationSchedulerDeps } from "./notifications.js";

// Electron is here only for the toast and the resume hook, neither under test.
vi.mock("electron", () => ({
  Notification: class {
    static isSupported(): boolean {
      return false;
    }
  },
  powerMonitor: { on: vi.fn(), removeListener: vi.fn() },
}));

vi.mock("./clock.js", () => ({
  localToday: () => "2026-08-07",
  localTime: () => "09:00",
}));

const { readReminderRows, upcomingReminders } = await import("./notifications.js");

const TODAY = "2026-08-07";

/** A task due in three days, with a reminder three days before its due date: that reminder fires today. */
const TASK = {
  id: "task-1",
  title: "Predaj seminarski",
  done: false,
  dueDate: "2026-08-10",
  reminderOffsets: [3],
};

/** A task whose only reminder fired before today (due 2026-08-09, five days before: 2026-08-04): it must not be listed. */
const OLD_TASK = {
  id: "task-2",
  title: "Stari zadatak",
  done: false,
  dueDate: "2026-08-09",
  reminderOffsets: [5],
};

const DOCUMENT = { id: "doc-1", label: "Pasoš", expiryDate: "2026-09-06", reminderOffsets: [30, 7] };

function makeDeps(): NotificationSchedulerDeps {
  const settings = {
    quietFrom: null,
    quietTo: null,
    morningHour: "08:00",
    enabledSources: ["document", "task", "exam", "event", "study-day", "subscription", "habit"],
    snoozeDefault: "1h",
    appetiteAsked: true,
  };
  return {
    listProfiles: () => [{ id: "personal" }],
    activeProfileId: () => "personal",
    planStore: () => ({ syncAll: () => undefined, listBlocksInRange: () => [] }),
    notificationStore: () => ({
      getSettings: () => settings,
      listLedgerKeys: () => [],
      dueSnoozed: () => [],
    }),
    documentStore: () => ({ listActive: () => [DOCUMENT] }),
    eventStore: () => ({ listActive: () => [] }),
    examStore: () => ({ listActive: () => [] }),
    subjectStore: () => ({ listActive: () => [] }),
    taskStore: () => ({ listActive: () => [TASK, OLD_TASK] }),
    finRecurringStore: () => ({ generateDue: () => 0, listActive: () => [], upcoming: () => [] }),
    finAccountStore: () => ({ listActive: () => [] }),
    habitStore: () => ({ listActive: () => [], listAllEntries: () => [] }),
    enabledModuleIds: () => new Set(["calendar", "study", "tasks", "settings", "finance", "habits"]),
    getMainWindow: () => null,
  } as unknown as NotificationSchedulerDeps;
}

describe("readReminderRows — the extraction derives the candidates the scheduler derived before it", () => {
  it("returns the same candidates as the derivation called inline with the same inputs", () => {
    const deps = makeDeps();
    const rows = readReminderRows(deps, "personal", TODAY, "09:00", "08:00");

    const expected = deriveNotificationCandidates({
      documents: [{ id: DOCUMENT.id, expiryDate: DOCUMENT.expiryDate, reminderOffsets: DOCUMENT.reminderOffsets }],
      exams: [],
      events: [],
      studyDays: [],
      tasks: [TASK, OLD_TASK].map((task) => ({ id: task.id, dueDate: task.dueDate, reminderOffsets: task.reminderOffsets })),
      subscriptions: [],
      habits: [],
      enabledSources: ["document", "exam", "study-day", "event", "task", "subscription", "habit", "security"],
      today: TODAY,
      nowLocalTime: "09:00",
      morningHour: "08:00",
    });

    expect(rows.candidates).toEqual(expected);
    expect(rows.candidates.some((candidate) => candidate.entityId === TASK.id)).toBe(true);
  });
});

describe("upcomingReminders", () => {
  it("lists a reminder on the day its ladder fires, with the scheduler's own text", () => {
    const upcoming = upcomingReminders(makeDeps(), "personal", 7);
    const task = upcoming.find((reminder) => reminder.source === "task");
    expect(task).toBeDefined();
    expect(task?.fireDate).toBe(TODAY);
    expect(task?.title).toContain("Predaj seminarski");
  });

  it("drops a reminder that fired before today", () => {
    const upcoming = upcomingReminders(makeDeps(), "personal", 7);
    expect(upcoming.some((reminder) => reminder.title.includes("Stari zadatak"))).toBe(false);
  });

  it("lists each reminder once across the window", () => {
    const upcoming = upcomingReminders(makeDeps(), "personal", 7);
    const titles = upcoming.map((reminder) => `${reminder.fireDate} ${reminder.title}`);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
