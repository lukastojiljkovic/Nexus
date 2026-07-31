import { describe, it, expect } from "vitest";
import {
  isEmptyTaskViewConfig,
  normalizeTaskViewConfig,
  parseStoredTaskViewConfig,
  serializeTaskViewConfig,
  taskViewFilterSpecs,
  validateTaskViewConfig,
} from "./taskViewConfig.js";
import type { TaskViewConfig } from "./taskViewConfig.js";

const full: TaskViewConfig = {
  list: { sort: { field: "dueDate", direction: "asc" }, filters: { status: "todo" } },
  kanban: { groupBy: "section", filters: { priority: "high" } },
  cards: { sort: { field: "title", direction: "desc" } },
  calendar: { filters: { status: "doing" } },
};

describe("validateTaskViewConfig", () => {
  it("accepts every knob of the four views and returns a fresh object", () => {
    const validated = validateTaskViewConfig(full);
    expect(validated).toEqual(full);
    expect(validated).not.toBe(full);
    expect(validated?.list).not.toBe(full.list);
  });

  it("reads an absent config as the empty one, which is not the same answer as invalid", () => {
    expect(validateTaskViewConfig(null)).toEqual({});
    expect(validateTaskViewConfig(undefined)).toEqual({});
    expect(validateTaskViewConfig({})).toEqual({});
  });

  it("refuses a value that is not a plain object", () => {
    expect(validateTaskViewConfig("{}")).toBeNull();
    expect(validateTaskViewConfig(7)).toBeNull();
    expect(validateTaskViewConfig([])).toBeNull();
  });

  it("refuses an unknown key at every level", () => {
    expect(validateTaskViewConfig({ gantt: {} })).toBeNull();
    expect(validateTaskViewConfig({ list: { group: "x" } })).toBeNull();
    expect(validateTaskViewConfig({ list: { sort: { field: "title", direction: "asc", nulls: "last" } } })).toBeNull();
    expect(validateTaskViewConfig({ list: { filters: { tag: "x" } } })).toBeNull();
    // The calendar's order is the calendar's — a sort there is not a knob it has.
    expect(validateTaskViewConfig({ calendar: { sort: { field: "dueDate", direction: "asc" } } })).toBeNull();
  });

  it("refuses a value outside a closed set", () => {
    expect(validateTaskViewConfig({ list: { sort: { field: "listId", direction: "asc" } } })).toBeNull();
    expect(validateTaskViewConfig({ list: { sort: { field: "title", direction: "up" } } })).toBeNull();
    expect(validateTaskViewConfig({ kanban: { groupBy: "tag" } })).toBeNull();
    expect(validateTaskViewConfig({ list: { filters: { status: "arhiva" } } })).toBeNull();
    expect(validateTaskViewConfig({ list: { filters: { priority: "urgent" } } })).toBeNull();
  });

  it("refuses a half-stated sort rather than inventing the missing half", () => {
    expect(validateTaskViewConfig({ cards: { sort: { field: "title" } } })).toBeNull();
    expect(validateTaskViewConfig({ cards: { sort: { direction: "asc" } } })).toBeNull();
  });

  it("prunes sections that ask for nothing, so one config has one canonical form", () => {
    expect(validateTaskViewConfig({ list: {}, kanban: { filters: {} }, calendar: {} })).toEqual({});
    expect(validateTaskViewConfig({ kanban: { groupBy: "priority", filters: {} } })).toEqual({
      kanban: { groupBy: "priority" },
    });
  });

  it("reads an explicit null knob as absent — cleared and never set mean the same thing", () => {
    expect(validateTaskViewConfig({ list: { sort: null, filters: null } })).toEqual({});
    expect(validateTaskViewConfig({ kanban: { groupBy: null } })).toEqual({});
  });
});

describe("normalizeTaskViewConfig", () => {
  it("keeps what it recognizes and drops the rest", () => {
    expect(
      normalizeTaskViewConfig({
        gantt: { groupBy: "status" },
        list: { sort: { field: "dueDate", direction: "asc" }, filters: { tag: "x" }, group: 1 },
        kanban: { groupBy: "tag" },
        cards: { sort: { field: "title", direction: "sideways" } },
      }),
    ).toEqual({ list: { sort: { field: "dueDate", direction: "asc" } } });
  });

  it("answers the empty config for anything unsalvageable, never null and never a throw", () => {
    expect(normalizeTaskViewConfig("nonsense")).toEqual({});
    expect(normalizeTaskViewConfig(null)).toEqual({});
    expect(normalizeTaskViewConfig({ list: 5, kanban: [] })).toEqual({});
  });

  it("agrees with the strict reading on a config that is already valid", () => {
    expect(normalizeTaskViewConfig(full)).toEqual(validateTaskViewConfig(full));
  });
});

describe("parseStoredTaskViewConfig / serializeTaskViewConfig", () => {
  it("round-trips a config through the column", () => {
    const text = serializeTaskViewConfig(full);
    expect(text).not.toBeNull();
    expect(parseStoredTaskViewConfig(text)).toEqual(full);
  });

  it("stores nothing for a config that asks for nothing", () => {
    expect(serializeTaskViewConfig(null)).toBeNull();
    expect(serializeTaskViewConfig({})).toBeNull();
    expect(isEmptyTaskViewConfig({})).toBe(true);
  });

  it("reads a damaged column as no config at all rather than throwing", () => {
    expect(parseStoredTaskViewConfig(null)).toBeNull();
    expect(parseStoredTaskViewConfig("{not json")).toBeNull();
    expect(parseStoredTaskViewConfig("[]")).toBeNull();
    expect(parseStoredTaskViewConfig('{"kanban":{"groupBy":"gantt"}}')).toBeNull();
  });

  it("keeps the salvageable half of a partly damaged column", () => {
    expect(
      parseStoredTaskViewConfig('{"kanban":{"groupBy":"gantt"},"cards":{"sort":{"field":"title","direction":"desc"}}}'),
    ).toEqual({ cards: { sort: { field: "title", direction: "desc" } } });
  });
});

describe("taskViewFilterSpecs", () => {
  it("renders the filters as engine specs in a fixed order", () => {
    expect(taskViewFilterSpecs({ priority: "high", status: "doing" })).toEqual([
      { field: "status", equals: "doing" },
      { field: "priority", equals: "high" },
    ]);
  });

  it("renders nothing for no filters, which the engine reads as no filtering", () => {
    expect(taskViewFilterSpecs(undefined)).toEqual([]);
    expect(taskViewFilterSpecs({})).toEqual([]);
  });
});
