import { describe, expect, it } from "vitest";
import {
  capTodayGroups,
  expiringDocumentRows,
  horizonWindowDays,
  upcomingTaskRows,
  urgentTaskRows,
} from "./dashboardWidgetRows.js";

const TODAY = "2026-07-31";

/** A minimal upcoming-card task; every field the selectors read, nothing more. */
function task(
  id: string,
  over: Partial<{
    done: boolean;
    dueDate: string | null;
    startDate: string | null;
    priority: "none" | "low" | "medium" | "high";
    createdAt: string;
    listId: string;
  }> = {},
) {
  return {
    id,
    done: false,
    dueDate: null,
    startDate: null,
    priority: "none" as const,
    createdAt: "2026-07-01T10:00:00.000Z",
    completedAt: null,
    listId: "inbox",
    ...over,
  };
}

describe("upcomingTaskRows", () => {
  const defaults = { cap: 5, period: "svi", listIds: [] as readonly string[] };

  it("pins today's shipped behaviour under the default config: active tasks by rok (undated last), then age, capped at five", () => {
    const tasks = [
      task("undated-old", { createdAt: "2026-07-01T10:00:00.000Z" }),
      task("done", { done: true, dueDate: "2026-08-01" }),
      task("later", { dueDate: "2026-08-05" }),
      task("soon", { dueDate: "2026-08-01" }),
      task("undated-new", { createdAt: "2026-07-02T10:00:00.000Z" }),
      task("soonest", { dueDate: "2026-07-30" }),
      task("far", { dueDate: "2026-12-31" }),
    ];
    expect(upcomingTaskRows(tasks, TODAY, defaults).map((row) => row.id)).toEqual([
      "soonest",
      "soon",
      "later",
      "far",
      "undated-old",
    ]);
  });

  it("applies the row cap to the sorted rows", () => {
    const tasks = [task("a", { dueDate: "2026-08-01" }), task("b"), task("c")];
    expect(upcomingTaskRows(tasks, TODAY, { ...defaults, cap: 2 }).map((r) => r.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("windows „danas“ through TASK's own smart-list predicate — due today, not started later", () => {
    const tasks = [
      task("today", { dueDate: TODAY }),
      task("later-start", { dueDate: TODAY, startDate: "2026-08-02" }),
      task("tomorrow", { dueDate: "2026-08-01" }),
      task("undated"),
    ];
    expect(
      upcomingTaskRows(tasks, TODAY, { ...defaults, period: "danas" }).map((r) => r.id),
    ).toEqual(["today"]);
  });

  it("windows „sledecih7“ to today plus the next six days, undated excluded", () => {
    const tasks = [
      task("today", { dueDate: TODAY }),
      task("sixth", { dueDate: "2026-08-06" }),
      task("seventh", { dueDate: "2026-08-07" }),
      task("late", { dueDate: "2026-07-30" }),
      task("undated"),
    ];
    expect(
      upcomingTaskRows(tasks, TODAY, { ...defaults, period: "sledecih7" }).map((r) => r.id),
    ).toEqual(["today", "sixth"]);
  });

  it("filters by the selected lists; an empty selection means every list", () => {
    const tasks = [
      task("a", { listId: "posao", dueDate: "2026-08-01" }),
      task("b", { listId: "kuca", dueDate: "2026-08-02" }),
    ];
    expect(
      upcomingTaskRows(tasks, TODAY, { ...defaults, listIds: ["posao"] }).map((r) => r.id),
    ).toEqual(["a"]);
    expect(upcomingTaskRows(tasks, TODAY, defaults).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("urgentTaskRows", () => {
  it("pins today's shipped union: every late task longest-overdue first, then high-priority not already among them, capped", () => {
    const tasks = [
      task("late-high", { dueDate: "2026-07-20", priority: "high" }),
      task("late", { dueDate: "2026-07-25" }),
      task("high-ahead", { dueDate: "2026-08-05", priority: "high" }),
      task("high-undated", { priority: "high" }),
      task("plain", { dueDate: "2026-08-01" }),
    ];
    expect(urgentTaskRows(tasks, TODAY, 5).map((row) => row.id)).toEqual([
      "late-high",
      "late",
      "high-ahead",
      "high-undated",
    ]);
  });

  it("caps the union, not each half", () => {
    const tasks = [
      task("l1", { dueDate: "2026-07-01" }),
      task("l2", { dueDate: "2026-07-02" }),
      task("h1", { priority: "high", dueDate: "2026-08-01" }),
    ];
    expect(urgentTaskRows(tasks, TODAY, 2).map((row) => row.id)).toEqual(["l1", "l2"]);
  });
});

describe("horizonWindowDays", () => {
  it("maps the three day options and answers null for a per-widget default („prag“, „svi“)", () => {
    expect(horizonWindowDays("30")).toBe(30);
    expect(horizonWindowDays("60")).toBe(60);
    expect(horizonWindowDays("90")).toBe(90);
    expect(horizonWindowDays("prag")).toBeNull();
    expect(horizonWindowDays("svi")).toBeNull();
  });
});

describe("expiringDocumentRows", () => {
  const docs = [
    { id: "d-ok", status: "ok", daysUntilExpiry: 120 },
    { id: "d-uskoro", status: "uskoro", daysUntilExpiry: 20 },
    { id: "d-istekao", status: "istekao", daysUntilExpiry: -3 },
    { id: "d-daleko-ok", status: "ok", daysUntilExpiry: 45 },
  ];

  it("pins today's shipped behaviour under „prag“: everything past its own reminder threshold, soonest first", () => {
    expect(expiringDocumentRows(docs, "prag").map((doc) => doc.id)).toEqual([
      "d-istekao",
      "d-uskoro",
    ]);
  });

  it("windows a day horizon over daysUntilExpiry, expired included, ignoring the per-document threshold", () => {
    expect(expiringDocumentRows(docs, "30").map((doc) => doc.id)).toEqual([
      "d-istekao",
      "d-uskoro",
    ]);
    expect(expiringDocumentRows(docs, "60").map((doc) => doc.id)).toEqual([
      "d-istekao",
      "d-uskoro",
      "d-daleko-ok",
    ]);
  });
});

describe("capTodayGroups", () => {
  const groups = { events: ["e1", "e2"], birthdays: ["b1"], tasks: ["t1", "t2"] };

  it("caps the three groups JOINTLY, in draw order: events, then birthdays, then tasks", () => {
    expect(capTodayGroups(3, groups.events, groups.birthdays, groups.tasks)).toEqual({
      events: ["e1", "e2"],
      birthdays: ["b1"],
      tasks: [],
    });
    expect(capTodayGroups(4, groups.events, groups.birthdays, groups.tasks)).toEqual({
      events: ["e1", "e2"],
      birthdays: ["b1"],
      tasks: ["t1"],
    });
  });

  it("keeps everything under the shipped uncapped default (infinity)", () => {
    expect(
      capTodayGroups(Number.POSITIVE_INFINITY, groups.events, groups.birthdays, groups.tasks),
    ).toEqual(groups);
  });
});
