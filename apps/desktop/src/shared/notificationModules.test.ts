import { describe, expect, it } from "vitest";
import type { NotificationSource } from "@nexus/core";
import { NOTIFICATION_SOURCE_MODULE, sourcesForEnabledModules } from "./notificationModules.js";

/** Every notification source there is — the `Record` type pins this at compile time, the first test pins it at run time. */
const ALL_SOURCES: NotificationSource[] = [
  "document",
  "exam",
  "study-day",
  "event",
  "task",
  "security",
  "subscription",
  "habit",
];

/** Every module a source can belong to — the "everything on" state. */
const ALL_MODULES = new Set(["calendar", "study", "tasks", "settings", "finance", "habits"]);

describe("NOTIFICATION_SOURCE_MODULE", () => {
  it("maps every source", () => {
    expect(Object.keys(NOTIFICATION_SOURCE_MODULE).sort()).toEqual([...ALL_SOURCES].sort());
  });

  it("agrees with the deep-link map the notification centre navigates by", () => {
    // The centre sends a row to the page that owns it; the scheduler decides
    // whether to derive it at all. Two questions, one answer — they were two
    // copies until this map existed.
    expect(NOTIFICATION_SOURCE_MODULE).toEqual({
      document: "calendar",
      exam: "study",
      "study-day": "study",
      event: "calendar",
      task: "tasks",
      security: "settings",
      subscription: "finance",
      habit: "habits",
    });
  });
});

describe("sourcesForEnabledModules", () => {
  it("keeps every appetite toggle while every module is on", () => {
    expect(sourcesForEnabledModules(ALL_SOURCES, ALL_MODULES)).toEqual(ALL_SOURCES);
  });

  it("drops exam and study-day when STUDY is off — the business-profile case this fixes", () => {
    const enabled = new Set([...ALL_MODULES].filter((id) => id !== "study"));
    expect(sourcesForEnabledModules(ALL_SOURCES, enabled)).toEqual([
      "document",
      "event",
      "task",
      "security",
      "subscription",
      "habit",
    ]);
  });

  it("drops habit when HABIT is off, and nothing else with it", () => {
    const enabled = new Set([...ALL_MODULES].filter((id) => id !== "habits"));
    expect(sourcesForEnabledModules(ALL_SOURCES, enabled)).not.toContain("habit");
    expect(sourcesForEnabledModules(ALL_SOURCES, enabled)).toContain("exam");
  });

  it("never narrows a security notice — it is about the account, not about a module anybody chose", () => {
    expect(sourcesForEnabledModules(["security"], new Set())).toEqual(["security"]);
  });

  it("narrows rather than widens: a toggle the user turned OFF stays off however many modules are on", () => {
    // The module gate is an intersection, not a second opinion. A source the
    // profile's appetite excluded is absent from the input and must stay absent.
    expect(sourcesForEnabledModules(["task"], ALL_MODULES)).toEqual(["task"]);
    expect(sourcesForEnabledModules([], ALL_MODULES)).toEqual([]);
  });
});
