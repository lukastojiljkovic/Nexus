import { describe, expect, it } from "vitest";
import {
  hiddenKanbanColumnCount,
  kanbanColumnRows,
  moveKanbanColumn,
  pruneStaleSectionColumns,
  toggleKanbanColumnHidden,
} from "./kanbanColumns.js";
import type { TaskKanbanViewSettings, TaskViewConfig } from "@nexus/core";

const KEYS = ["todo", "doing", "done"] as const;

describe("kanbanColumnRows", () => {
  it("lists EVERY column of the grouping, hidden ones included — a hidden column stays reachable", () => {
    const settings: TaskKanbanViewSettings = { hiddenColumns: ["doing"] };
    expect(kanbanColumnRows(KEYS, settings)).toEqual([
      { key: "todo", hidden: false },
      { key: "doing", hidden: true },
      { key: "done", hidden: false },
    ]);
  });

  it("orders the rows exactly as the board draws its columns", () => {
    const settings: TaskKanbanViewSettings = { columnOrder: ["done"], hiddenColumns: ["done"] };
    expect(kanbanColumnRows(KEYS, settings).map((row) => row.key)).toEqual([
      "done",
      "todo",
      "doing",
    ]);
  });

  it("ignores stale keys — a deleted section's id draws no row and hides nothing", () => {
    const settings: TaskKanbanViewSettings = {
      hiddenColumns: ["nema-vise"],
      columnOrder: ["nema-vise", "doing"],
    };
    expect(kanbanColumnRows(KEYS, settings)).toEqual([
      { key: "doing", hidden: false },
      { key: "todo", hidden: false },
      { key: "done", hidden: false },
    ]);
  });
});

describe("hiddenKanbanColumnCount", () => {
  it("counts only columns actually suppressed — the chip shows if and only if this is positive", () => {
    expect(hiddenKanbanColumnCount(KEYS, {})).toBe(0);
    expect(hiddenKanbanColumnCount(KEYS, { hiddenColumns: ["todo", "done"] })).toBe(2);
    // A stale section id suppresses nothing, so it must not put a chip up.
    expect(hiddenKanbanColumnCount(KEYS, { hiddenColumns: ["nema-vise"] })).toBe(0);
  });
});

describe("toggleKanbanColumnHidden", () => {
  it("hides a drawn column and re-shows a hidden one", () => {
    expect(toggleKanbanColumnHidden(KEYS, {}, "doing", false)).toEqual(["doing"]);
    expect(
      toggleKanbanColumnHidden(KEYS, { hiddenColumns: ["doing"] }, "doing", false),
    ).toEqual([]);
  });

  it("refuses to hide the last drawn column of a board with no fixed column", () => {
    expect(
      toggleKanbanColumnHidden(KEYS, { hiddenColumns: ["todo", "doing"] }, "done", false),
    ).toBeNull();
    expect(toggleKanbanColumnHidden(["jedina"], {}, "jedina", false)).toBeNull();
  });

  it("allows hiding every keyed column when a fixed column keeps the board a board", () => {
    expect(
      toggleKanbanColumnHidden(KEYS, { hiddenColumns: ["todo", "doing"] }, "done", true),
    ).toEqual(["todo", "doing", "done"]);
  });

  it("drops stale keys on the way through, so the stored set never grows dead ids", () => {
    expect(
      toggleKanbanColumnHidden(KEYS, { hiddenColumns: ["nema-vise", "todo"] }, "doing", false),
    ).toEqual(["todo", "doing"]);
  });
});

describe("pruneStaleSectionColumns", () => {
  it("drops a deleted section's keys before a write, so the store's refusal never sinks an unrelated change", () => {
    const config: TaskViewConfig = {
      kanban: {
        groupBy: "section",
        sort: { field: "title", direction: "asc" },
        hiddenColumns: ["ziva", "obrisana"],
        columnOrder: ["obrisana"],
      },
    };
    expect(pruneStaleSectionColumns(config, ["ziva"])).toEqual({
      kanban: { groupBy: "section", sort: { field: "title", direction: "asc" }, hiddenColumns: ["ziva"] },
    });
  });

  it("returns the very same config when nothing is stale, and for non-section groupings", () => {
    const sectioned: TaskViewConfig = {
      kanban: { groupBy: "section", hiddenColumns: ["ziva"] },
    };
    expect(pruneStaleSectionColumns(sectioned, ["ziva"])).toBe(sectioned);
    // A status board's keys are a closed vocabulary — never stale, never touched.
    const byStatus: TaskViewConfig = { kanban: { hiddenColumns: ["done"] } };
    expect(pruneStaleSectionColumns(byStatus, [])).toBe(byStatus);
    expect(pruneStaleSectionColumns({}, [])).toEqual({});
  });

  it("prunes a kanban section that ends up asking for nothing", () => {
    const config: TaskViewConfig = {
      list: { sort: { field: "title", direction: "asc" } },
      kanban: { groupBy: "section", hiddenColumns: ["obrisana"] },
    };
    expect(pruneStaleSectionColumns(config, [])).toEqual({
      list: { sort: { field: "title", direction: "asc" } },
      kanban: { groupBy: "section" },
    });
  });
});

describe("moveKanbanColumn", () => {
  it("steps a column one place and answers with the FULL drawn order, so the write is canonical", () => {
    expect(moveKanbanColumn(KEYS, {}, "done", -1)).toEqual(["todo", "done", "doing"]);
    expect(moveKanbanColumn(KEYS, { columnOrder: ["done"] }, "done", 1)).toEqual([
      "todo",
      "done",
      "doing",
    ]);
  });

  it("returns null at the edges and for a key the board does not draw", () => {
    expect(moveKanbanColumn(KEYS, {}, "todo", -1)).toBeNull();
    expect(moveKanbanColumn(KEYS, {}, "done", 1)).toBeNull();
    expect(moveKanbanColumn(KEYS, {}, "nema", 1)).toBeNull();
  });
});
