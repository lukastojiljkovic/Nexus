import { describe, expect, it } from "vitest";
import {
  emptyRowState,
  hlcSend,
  hlcZero,
  rowFields,
  type Hlc,
  type JsonValue,
} from "@nexus/sync-crypto";
import { classify } from "./collections.js";
import type { SyncCollection } from "./collections.js";
import {
  COLLECTION_DERIVED,
  UNIVERSAL_DERIVED,
  fieldColumns,
  projectRow,
  sweepRow,
} from "./projection.js";

const TASKS = classify("tasks") as SyncCollection;
const SETTINGS = classify("calendar_settings") as SyncCollection;

/** The columns `tasks` actually has, in schema order (migration 002 onward). */
const TASK_COLUMNS = [
  "id",
  "profile_id",
  "parent_id",
  "title",
  "description",
  "status",
  "priority",
  "due_date",
  "start_date",
  "created_at",
  "updated_at",
  "completed_at",
  "deleted_at",
  "recurrence",
  "reminder_offsets",
  "list_id",
  "section_id",
  "rank",
];

function clock(ms: number): Hlc {
  return hlcSend(hlcZero("device-a"), ms);
}

const T1 = clock(1_000);
const T2 = clock(2_000);
const T3 = clock(3_000);

function taskRow(overrides: Record<string, JsonValue> = {}): Record<string, JsonValue> {
  return {
    id: "t1",
    profile_id: "p1",
    parent_id: null,
    title: "Prijava",
    description: null,
    status: "todo",
    priority: "none",
    due_date: null,
    start_date: null,
    created_at: "2026-08-08T10:00:00.000Z",
    updated_at: "2026-08-08T10:00:00.000Z",
    completed_at: null,
    deleted_at: null,
    recurrence: null,
    reminder_offsets: "[]",
    list_id: "l1",
    section_id: null,
    rank: "i0",
    ...overrides,
  };
}

describe("fieldColumns", () => {
  it("drops the identity, the profile and everything something else decides", () => {
    const fields = fieldColumns(TASKS, TASK_COLUMNS);
    expect(fields).not.toContain("id");
    expect(fields).not.toContain("profile_id");
    expect(fields).not.toContain("updated_at");
    expect(fields).not.toContain("deleted_at");
    expect(fields).not.toContain("completed_at");
    expect(fields).toContain("title");
    expect(fields).toContain("status");
    expect(fields).toContain("rank");
  });

  it("keeps a singleton's every column, since its identity is the profile it is scoped by", () => {
    const columns = ["profile_id", "week_starts_on", "day_start_minutes", "updated_at"];
    expect(fieldColumns(SETTINGS, columns)).toEqual(["week_starts_on", "day_start_minutes"]);
  });

  it("explains every derived column it subtracts", () => {
    for (const reason of Object.values(UNIVERSAL_DERIVED)) {
      expect(reason.length).toBeGreaterThan(60);
    }
    for (const table of Object.values(COLLECTION_DERIVED)) {
      for (const reason of Object.values(table)) expect(reason.length).toBeGreaterThan(60);
    }
  });
});

describe("projectRow", () => {
  it("reads a missing column as null rather than dropping the field", () => {
    // A field that vanished from the map would merge as „the other device knows
    // and I do not", which is exactly wrong: this device knows it is empty.
    const projected = projectRow(TASKS, TASK_COLUMNS, taskRow());
    expect(projected["description"]).toBeNull();
    expect(Object.keys(projected)).toContain("description");
  });
});

describe("sweepRow", () => {
  it("stamps every field of a row it has never seen", () => {
    const next = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: taskRow(),
      previous: null,
      now: T1,
    });
    expect(next).not.toBeNull();
    expect(rowFields(next!)["title"]).toBe("Prijava");
    expect(next!.deleted.value).toBe(false);
    for (const state of Object.values(next!.fields)) expect(state.at).toEqual(T1);
  });

  it("says nothing at all when the row is byte-for-byte what it already was", () => {
    // The case that makes the diff necessary: a trigger fires on ANY update,
    // including a bulk re-save that changed nothing. Stamping there would let a
    // no-op beat a real edit made on another device a second earlier.
    const first = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: taskRow(),
      previous: null,
      now: T1,
    });
    const again = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: taskRow(),
      previous: first,
      now: T2,
    });
    expect(again).toBeNull();
  });

  it("stamps only what changed, and leaves the rest on their old clocks", () => {
    const first = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: taskRow(),
      previous: null,
      now: T1,
    });
    const next = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: taskRow({ title: "Prijava ispita" }),
      previous: first,
      now: T2,
    });
    expect(next).not.toBeNull();
    expect(next!.fields["title"]?.at).toEqual(T2);
    expect(next!.fields["status"]?.at).toEqual(T1);
    expect(next!.fields["rank"]?.at).toEqual(T1);
  });

  it("ignores `updated_at` moving on its own — the column the trigger always touches", () => {
    const first = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: taskRow(),
      previous: null,
      now: T1,
    });
    const next = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: taskRow({ updated_at: "2026-08-08T11:00:00.000Z" }),
      previous: first,
      now: T2,
    });
    expect(next).toBeNull();
  });

  it("tombstones a row that is gone, keeping its fields for whoever restores it", () => {
    const first = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: taskRow(),
      previous: null,
      now: T1,
    });
    const gone = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: null,
      previous: first,
      now: T2,
    });
    expect(gone).not.toBeNull();
    expect(gone!.deleted).toEqual({ value: true, at: T2 });
    expect(rowFields(gone!)["title"]).toBe("Prijava");
  });

  it("says nothing for a row that is gone and was never known", () => {
    // Created and deleted between two sweeps. A tombstone for an object no other
    // device has a record of is noise they would have to keep forever.
    expect(
      sweepRow({ collection: TASKS, columns: TASK_COLUMNS, row: null, previous: null, now: T1 }),
    ).toBeNull();
  });

  it("resolves a journal entry twice without saying anything the second time", () => {
    const first = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: taskRow(),
      previous: null,
      now: T1,
    });
    const gone = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: null,
      previous: first,
      now: T2,
    });
    const again = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: null,
      previous: gone,
      now: T3,
    });
    expect(again).toBeNull();
  });

  it("clears the tombstone on an undelete without re-asserting every field", () => {
    const first = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: taskRow(),
      previous: null,
      now: T1,
    });
    const gone = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: null,
      previous: first,
      now: T2,
    });
    const back = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: taskRow(),
      previous: gone,
      now: T3,
    });
    expect(back).not.toBeNull();
    expect(back!.deleted).toEqual({ value: false, at: T3 });
    // Restoring is not editing: the fields keep the clocks they had, so an edit
    // made elsewhere while the row was deleted still wins.
    expect(back!.fields["title"]?.at).toEqual(T1);
  });

  it("compares a JSON-valued field by what it means, not by how it was spelled", () => {
    const base = emptyRowState(T1);
    const previous = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: taskRow({ reminder_offsets: '{"a":1,"b":2}' }),
      previous: null,
      now: T1,
    });
    expect(base.version).toBe(0);
    // The same TEXT column, byte-identical, must not restamp.
    const same = sweepRow({
      collection: TASKS,
      columns: TASK_COLUMNS,
      row: taskRow({ reminder_offsets: '{"a":1,"b":2}' }),
      previous,
      now: T2,
    });
    expect(same).toBeNull();
  });
});
