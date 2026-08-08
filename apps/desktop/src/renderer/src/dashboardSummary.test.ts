import { describe, expect, it } from "vitest";
import { dashboardSummary } from "./dashboardSummary.js";
import type { SummaryCalendarItem, SummaryFocusSession } from "./dashboardSummary.js";

const TODAY = "2026-08-08";

/** A merged-stream item; only the three fields the event count reads. */
function item(
  kind: string,
  startKey: string,
  endKey: string = startKey,
): SummaryCalendarItem {
  return { kind, startKey, endKey };
}

/** A task with every field the smart-list predicates read, and nothing more. */
function task(
  id: string,
  over: Partial<{
    done: boolean;
    dueDate: string | null;
    startDate: string | null;
    priority: "none" | "low" | "medium" | "high";
  }> = {},
) {
  return {
    id,
    done: false,
    dueDate: null,
    startDate: null,
    priority: "none" as const,
    createdAt: "2026-08-01T09:00:00.000Z",
    completedAt: null,
    ...over,
  };
}

/** A finished session of `minutes` whole minutes, with no paused time. */
function session(minutes: number, pausedSeconds = 0): SummaryFocusSession {
  const started = Date.UTC(2026, 7, 8, 9, 0, 0);
  return {
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(started + minutes * 60_000 + pausedSeconds * 1000).toISOString(),
    pausedSeconds,
  };
}

const ALL_OFF = { items: null, todayKey: TODAY, tasks: null, focusSessions: null };

describe("dashboardSummary", () => {
  it("answers null — never zero — for a module that was not read", () => {
    // The whole reason every input is nullable: „0 događaja danas" is a claim
    // about an empty calendar, and a calendar that is switched off has made no
    // claim at all. The band leaves a null figure out entirely.
    expect(dashboardSummary(ALL_OFF)).toEqual({
      eventsToday: null,
      tasksToday: null,
      tasksLate: null,
      focusMinutes: null,
    });
  });

  it("answers zero for a module that WAS read and had nothing in it", () => {
    expect(
      dashboardSummary({ items: [], todayKey: TODAY, tasks: [], focusSessions: [] }),
    ).toEqual({ eventsToday: 0, tasksToday: 0, tasksLate: 0, focusMinutes: 0 });
  });

  describe("eventsToday", () => {
    it("counts only events, and only those covering today", () => {
      const summary = dashboardSummary({
        ...ALL_OFF,
        items: [
          item("event", TODAY),
          // A span that began before today and has not ended still covers it.
          item("event", "2026-08-06", "2026-08-09"),
          // Yesterday's, tomorrow's: outside the day entirely.
          item("event", "2026-08-07"),
          item("event", "2026-08-09"),
          // The merge also carries birthdays, tasks, exams and renewals; each
          // of those has its own card, and none of them is an appointment.
          item("birthday", TODAY),
          item("task", TODAY),
        ],
      });
      expect(summary.eventsToday).toBe(2);
    });

    it("counts a span's every covered day, so a week-long trip is on today too", () => {
      const summary = dashboardSummary({
        ...ALL_OFF,
        items: [item("event", "2026-08-01", "2026-08-31")],
      });
      expect(summary.eventsToday).toBe(1);
    });
  });

  describe("tasksToday / tasksLate", () => {
    it("counts TASK's own „Danas“ and „Kasni“ predicates, and nothing of its own", () => {
      const summary = dashboardSummary({
        ...ALL_OFF,
        tasks: [
          task("due-today", { dueDate: TODAY }),
          task("due-today-2", { dueDate: `${TODAY}T18:00:00.000Z` }),
          task("late", { dueDate: "2026-08-01" }),
          task("late-2", { dueDate: "2026-07-30" }),
          task("later", { dueDate: "2026-08-20" }),
          task("undated"),
        ],
      });
      expect(summary.tasksToday).toBe(2);
      expect(summary.tasksLate).toBe(2);
    });

    it("leaves a finished task out of both figures, however late its rok was", () => {
      const summary = dashboardSummary({
        ...ALL_OFF,
        tasks: [
          task("done-today", { dueDate: TODAY, done: true }),
          task("done-late", { dueDate: "2026-07-01", done: true }),
        ],
      });
      expect(summary.tasksToday).toBe(0);
      expect(summary.tasksLate).toBe(0);
    });

    it("leaves a task that has not started out of „Danas“ — it is not actionable yet", () => {
      const summary = dashboardSummary({
        ...ALL_OFF,
        tasks: [task("not-yet", { dueDate: TODAY, startDate: "2026-08-20" })],
      });
      expect(summary.tasksToday).toBe(0);
    });

    it("never counts one task in both figures — the two lists are disjoint by construction", () => {
      const summary = dashboardSummary({
        ...ALL_OFF,
        tasks: [task("a", { dueDate: TODAY }), task("b", { dueDate: "2026-08-01" })],
      });
      expect((summary.tasksToday ?? 0) + (summary.tasksLate ?? 0)).toBe(2);
    });
  });

  describe("focusMinutes", () => {
    it("sums ATTENTION, not wall time — paused seconds do not count", () => {
      const summary = dashboardSummary({
        ...ALL_OFF,
        focusSessions: [session(25), session(15, 300)],
      });
      expect(summary.focusMinutes).toBe(40);
    });

    it("reads an unusable session as zero rather than poisoning the total", () => {
      const summary = dashboardSummary({
        ...ALL_OFF,
        focusSessions: [session(30), { startedAt: "nije datum", endedAt: "ni ovo", pausedSeconds: 0 }],
      });
      expect(summary.focusMinutes).toBe(30);
    });
  });
});
