import { describe, expect, it } from "vitest";

import { SEARCH_DUE_WEEK_DAYS } from "../search/searchOperators.js";
import {
  matchesSmartList,
  selectSmartList,
  SMART_LIST_IDS,
  type SmartListContext,
  type SmartListId,
  type SmartListTask,
} from "./taskSmartLists.js";

/**
 * The five smart lists are pure queries, so "today" is always spelled out and
 * every fixture carries an EXPLICIT id: the orderings all end in the id, and an
 * order pinned against ids minted by the store (same-millisecond uuidv7) would
 * be pinning the generator rather than the rule.
 */

const TODAY = "2026-07-15";
const YESTERDAY = "2026-07-14";
const TOMORROW = "2026-07-16";
/** The last day „Sledećih 7 dana“ reaches, and the first it does not. */
const DAY_6 = "2026-07-21";
const DAY_7 = "2026-07-22";

function task(id: string, fields: Partial<Omit<SmartListTask, "id">> = {}): SmartListTask {
  return {
    id,
    done: false,
    dueDate: null,
    startDate: null,
    priority: "none",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    ...fields,
  };
}

/** A finished task: `completedAt` is non-null exactly when `done` is, which the store's CHECK guarantees. */
function doneTask(id: string, completedAt: string, fields: Partial<Omit<SmartListTask, "id">> = {}): SmartListTask {
  return task(id, { ...fields, done: true, completedAt });
}

const NOTHING_BLOCKED = (): boolean => false;

function context(overrides: Partial<SmartListContext> = {}): SmartListContext {
  return { today: TODAY, isBlocked: NOTHING_BLOCKED, includeBlocked: false, ...overrides };
}

/** Ids of the rows one list keeps, in the order it puts them. */
function idsOf(
  tasks: readonly SmartListTask[],
  listId: SmartListId,
  overrides: Partial<SmartListContext> = {},
): string[] {
  return selectSmartList(tasks, listId, context(overrides)).map((row) => row.id);
}

/** Table driver: one fixture per row, asserted for membership of ONE list. */
function expectMembership(
  listId: SmartListId,
  rows: readonly (readonly [SmartListTask, boolean])[],
  overrides: Partial<SmartListContext> = {},
): void {
  for (const [row, expected] of rows) {
    expect(matchesSmartList(row, listId, context(overrides)), row.id).toBe(expected);
  }
}

describe("SMART_LIST_IDS", () => {
  it("is the five lists in the rail's own order, without duplicates", () => {
    expect(SMART_LIST_IDS).toEqual(["danas", "sledecih7", "hitno", "kasni", "zavrseno"]);
    expect(new Set(SMART_LIST_IDS).size).toBe(SMART_LIST_IDS.length);
  });
});

// --- danas ------------------------------------------------------------------

describe("danas", () => {
  it("keeps exactly the open tasks whose rok is today", () => {
    expectMembership("danas", [
      [task("due-today", { dueDate: TODAY }), true],
      [task("due-yesterday", { dueDate: YESTERDAY }), false],
      [task("due-tomorrow", { dueDate: TOMORROW }), false],
      [task("undated"), false],
      [doneTask("finished", "2026-07-15T09:00:00.000Z", { dueDate: TODAY }), false],
    ]);
  });

  it("reads a date-time rok by its day key", () => {
    expectMembership("danas", [
      [task("timed", { dueDate: `${TODAY}T18:30:00.000Z` }), true],
      [task("timed-tomorrow", { dueDate: `${TOMORROW}T00:00:00.000Z` }), false],
    ]);
  });

  it("excludes a task that has not started, and includes one starting today", () => {
    expectMembership("danas", [
      [task("starts-tomorrow", { dueDate: TODAY, startDate: TOMORROW }), false],
      [task("starts-today", { dueDate: TODAY, startDate: TODAY }), true],
      [task("started-yesterday", { dueDate: TODAY, startDate: YESTERDAY }), true],
      [task("no-start", { dueDate: TODAY }), true],
    ]);
  });

  it("excludes a blocked task by default and keeps it when the caller asks", () => {
    const rows = [task("free", { dueDate: TODAY }), task("waiting", { dueDate: TODAY })];
    const isBlocked = (id: string): boolean => id === "waiting";

    expect(idsOf(rows, "danas", { isBlocked })).toEqual(["free"]);
    expect(idsOf(rows, "danas", { isBlocked, includeBlocked: true })).toEqual(["free", "waiting"]);
  });

  it("orders by priority descending, then by age, then by id", () => {
    const rows = [
      task("c", { dueDate: TODAY, priority: "low", createdAt: "2026-01-01T00:00:00.000Z" }),
      task("a", { dueDate: TODAY, priority: "high", createdAt: "2026-03-01T00:00:00.000Z" }),
      task("d", { dueDate: TODAY, priority: "none", createdAt: "2026-01-01T00:00:00.000Z" }),
      task("b", { dueDate: TODAY, priority: "medium", createdAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(idsOf(rows, "danas")).toEqual(["a", "b", "c", "d"]);
  });

  it("breaks an equal priority by the older task first, and an equal age by id", () => {
    const rows = [
      task("z", { dueDate: TODAY, priority: "high", createdAt: "2026-02-01T00:00:00.000Z" }),
      task("y", { dueDate: TODAY, priority: "high", createdAt: "2026-01-01T00:00:00.000Z" }),
      task("a", { dueDate: TODAY, priority: "high", createdAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(idsOf(rows, "danas")).toEqual(["y", "a", "z"]);
  });
});

// --- sledecih7 --------------------------------------------------------------

describe("sledecih7", () => {
  it("spans today through today+6 inclusive — the search operator's own week", () => {
    expect(SEARCH_DUE_WEEK_DAYS).toBe(7);
    expectMembership("sledecih7", [
      [task("yesterday", { dueDate: YESTERDAY }), false],
      [task("today", { dueDate: TODAY }), true],
      [task("tomorrow", { dueDate: TOMORROW }), true],
      [task("day-6", { dueDate: DAY_6 }), true],
      [task("day-7", { dueDate: DAY_7 }), false],
      [task("undated"), false],
      [doneTask("finished", "2026-07-16T09:00:00.000Z", { dueDate: TOMORROW }), false],
    ]);
  });

  it("applies the same start-date and blocked rules as danas", () => {
    const rows = [
      task("starts-later", { dueDate: DAY_6, startDate: DAY_7 }),
      task("starts-today", { dueDate: DAY_6, startDate: TODAY }),
      task("waiting", { dueDate: TOMORROW }),
    ];
    const isBlocked = (id: string): boolean => id === "waiting";

    expect(idsOf(rows, "sledecih7", { isBlocked })).toEqual(["starts-today"]);
    expect(idsOf(rows, "sledecih7", { isBlocked, includeBlocked: true })).toEqual([
      "waiting",
      "starts-today",
    ]);
  });

  it("orders by rok, then priority, then age, then id", () => {
    const rows = [
      task("late-high", { dueDate: DAY_6, priority: "high" }),
      task("soon-none", { dueDate: TODAY, priority: "none", createdAt: "2026-02-01T00:00:00.000Z" }),
      task("soon-high", { dueDate: TODAY, priority: "high" }),
      task("soon-none-older", {
        dueDate: TODAY,
        priority: "none",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    expect(idsOf(rows, "sledecih7")).toEqual([
      "soon-high",
      "soon-none-older",
      "soon-none",
      "late-high",
    ]);
  });
});

// --- hitno ------------------------------------------------------------------

describe("hitno", () => {
  it("keeps only the high priority — the one priority the row renders as an accent chip", () => {
    expectMembership("hitno", [
      [task("high", { priority: "high" }), true],
      [task("medium", { priority: "medium" }), false],
      [task("low", { priority: "low" }), false],
      [task("none"), false],
      [doneTask("finished", "2026-07-15T09:00:00.000Z", { priority: "high" }), false],
    ]);
  });

  it("ignores the start date and the blocked flag — it is a priority list, not a date one", () => {
    const rows = [
      task("blocked-high", { priority: "high" }),
      task("future-start", { priority: "high", startDate: DAY_7 }),
    ];
    expect(idsOf(rows, "hitno", { isBlocked: () => true })).toEqual([
      "blocked-high",
      "future-start",
    ]);
  });

  it("orders by rok ascending with the undated LAST, then age, then id", () => {
    const rows = [
      task("undated-b", { priority: "high", createdAt: "2026-02-01T00:00:00.000Z" }),
      task("late", { priority: "high", dueDate: DAY_7 }),
      task("undated-a", { priority: "high", createdAt: "2026-01-01T00:00:00.000Z" }),
      task("overdue", { priority: "high", dueDate: YESTERDAY }),
    ];
    expect(idsOf(rows, "hitno")).toEqual(["overdue", "late", "undated-a", "undated-b"]);
  });
});

// --- kasni ------------------------------------------------------------------

describe("kasni", () => {
  it("keeps the open tasks whose rok is already past", () => {
    expectMembership("kasni", [
      [task("yesterday", { dueDate: YESTERDAY }), true],
      [task("today", { dueDate: TODAY }), false],
      [task("tomorrow", { dueDate: TOMORROW }), false],
      [task("undated"), false],
      [doneTask("finished", "2026-07-15T09:00:00.000Z", { dueDate: YESTERDAY }), false],
    ]);
  });

  it("does not hide an overdue task because it is blocked or has not started", () => {
    const rows = [
      task("waiting", { dueDate: YESTERDAY }),
      task("starts-later", { dueDate: YESTERDAY, startDate: DAY_7 }),
    ];
    // Same rok, so the id is what orders them — see the ordering test below.
    expect(idsOf(rows, "kasni", { isBlocked: () => true })).toEqual(["starts-later", "waiting"]);
  });

  it("orders by rok ascending, then by id", () => {
    const rows = [
      task("b", { dueDate: YESTERDAY }),
      task("older", { dueDate: "2026-06-01" }),
      task("a", { dueDate: YESTERDAY }),
    ];
    expect(idsOf(rows, "kasni")).toEqual(["older", "a", "b"]);
  });
});

// --- zavrseno ---------------------------------------------------------------

describe("zavrseno", () => {
  it("keeps every finished task, dated or not", () => {
    expectMembership("zavrseno", [
      [doneTask("dated", "2026-07-15T09:00:00.000Z", { dueDate: YESTERDAY }), true],
      [doneTask("undated", "2026-07-15T09:00:00.000Z"), true],
      [task("open", { dueDate: TODAY }), false],
    ]);
  });

  it("orders by completion, most recent first, then by id", () => {
    const rows = [
      doneTask("b", "2026-07-10T08:00:00.000Z"),
      doneTask("newest", "2026-07-14T08:00:00.000Z"),
      doneTask("a", "2026-07-10T08:00:00.000Z"),
      doneTask("oldest", "2026-06-01T08:00:00.000Z"),
    ];
    expect(idsOf(rows, "zavrseno")).toEqual(["newest", "a", "b", "oldest"]);
  });
});

// --- the rules that hold ACROSS the lists ------------------------------------

describe("the smart lists as a set", () => {
  it("puts an undated open task in no date list at all", () => {
    const undated = task("undated");
    for (const listId of ["danas", "sledecih7", "kasni"] as const) {
      expect(matchesSmartList(undated, listId, context()), listId).toBe(false);
    }
  });

  it("keeps danas and kasni disjoint, whatever the rok", () => {
    const rows = [
      task("past", { dueDate: "2026-01-01" }),
      task("yesterday", { dueDate: YESTERDAY }),
      task("today", { dueDate: TODAY }),
      task("timed-today", { dueDate: `${TODAY}T23:59:00.000Z` }),
      task("tomorrow", { dueDate: TOMORROW }),
    ];
    const danas = new Set(idsOf(rows, "danas"));
    const kasni = new Set(idsOf(rows, "kasni"));
    expect([...danas].filter((id) => kasni.has(id))).toEqual([]);
  });

  it("keeps a stale recurring task in kasni once, at its un-advanced rok", () => {
    const rows = [task("weekly", { dueDate: "2026-07-01" })];
    expect(idsOf(rows, "kasni")).toEqual(["weekly"]);
    expect(idsOf(rows, "danas")).toEqual([]);
  });
});

describe("selectSmartList", () => {
  it("returns a new array and never reorders the caller's own", () => {
    const rows = [task("b", { dueDate: TODAY }), task("a", { dueDate: TODAY })];
    const selected = selectSmartList(rows, "danas", context());

    expect(selected).not.toBe(rows);
    expect(selected.map((row) => row.id)).toEqual(["a", "b"]);
    expect(rows.map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("carries the caller's own richer row type through, not a copy of the minimal shape", () => {
    const rows = [{ ...task("a", { dueDate: TODAY }), title: "Kupi mleko" }];
    const [first] = selectSmartList(rows, "danas", context());
    expect(first?.title).toBe("Kupi mleko");
  });
});
