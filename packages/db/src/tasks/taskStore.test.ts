import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecurrenceRule } from "@nexus/core";
import {
  NexusDatabase,
  TaskNotFoundError,
  TaskStore,
  TaskValidationError,
  openDatabase,
  uuidv7,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tasks-"));
  db = openDatabase({ path: join(dir, "tasks.db") });
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date().toISOString());
  return id;
}

function store(): TaskStore {
  return new TaskStore(db.raw, createProfile());
}

describe("TaskStore", () => {
  it("creates a task, applies defaults, and lists it back", () => {
    const tasks = store();
    const created = tasks.create({ title: "Buy milk" });

    expect(created.title).toBe("Buy milk");
    expect(created.status).toBe("todo");
    expect(created.priority).toBe("none");
    expect(created.done).toBe(false);
    expect(created.description).toBeNull();
    expect(created.dueDate).toBeNull();
    expect(created.startDate).toBeNull();
    expect(created.parentId).toBeNull();
    expect(created.completedAt).toBeNull();
    expect(created.createdAt).toBe(created.updatedAt);

    const listed = tasks.listActive();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(created);
  });

  it("persists all supplied fields on create", () => {
    const tasks = store();
    const created = tasks.create({
      title: "  Draft plan  ",
      description: "## heading",
      status: "doing",
      priority: "high",
      dueDate: "2026-07-10T09:00:00+02:00",
      startDate: "2026-07-08",
    });

    expect(created.title).toBe("Draft plan"); // trimmed
    expect(created.description).toBe("## heading");
    expect(created.status).toBe("doing");
    expect(created.priority).toBe("high");
    expect(created.dueDate).toBe("2026-07-10T09:00:00+02:00");
    expect(created.startDate).toBe("2026-07-08");
  });

  it("rejects an empty or whitespace-only title (TASK-001)", () => {
    const tasks = store();
    expect(() => tasks.create({ title: "" })).toThrow(TaskValidationError);
    expect(() => tasks.create({ title: "   " })).toThrow(TaskValidationError);
  });

  it("rejects a malformed due date", () => {
    const tasks = store();
    expect(() => tasks.create({ title: "x", dueDate: "not-a-date" })).toThrow(
      TaskValidationError,
    );
  });

  it("updates fields, clears optionals with null, and bumps updated_at", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
    const tasks = store();
    const created = tasks.create({ title: "Old", description: "keep" });

    vi.setSystemTime(new Date("2026-07-06T10:05:00.000Z"));
    const updated = tasks.update(created.id, { title: "New", description: null });

    expect(updated.title).toBe("New");
    expect(updated.description).toBeNull();
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    expect(tasks.listActive()[0]).toEqual(updated);
  });

  it("sets and clears done, stamping completed_at (TASK-008 / PRD §7)", () => {
    const tasks = store();
    const created = tasks.create({ title: "x", status: "doing" });

    const done = tasks.setDone(created.id, true);
    expect(done.done).toBe(true);
    expect(done.status).toBe("done");
    expect(done.completedAt).not.toBeNull();

    const reopened = tasks.setDone(created.id, false);
    expect(reopened.done).toBe(false);
    expect(reopened.status).toBe("todo");
    expect(reopened.completedAt).toBeNull();
  });

  it("completes via a direct status change too (kanban drag path)", () => {
    const tasks = store();
    const created = tasks.create({ title: "x" });

    const done = tasks.update(created.id, { status: "done" });
    expect(done.done).toBe(true);
    expect(done.completedAt).not.toBeNull();

    // dragging back out of the done column clears the completion stamp.
    const back = tasks.update(created.id, { status: "todo" });
    expect(back.completedAt).toBeNull();
  });

  it("preserves the original completed_at when a done task is edited", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
    const tasks = store();
    const created = tasks.create({ title: "x", status: "done" });
    const firstStamp = created.completedAt;

    vi.setSystemTime(new Date("2026-07-06T11:00:00.000Z"));
    const edited = tasks.update(created.id, { title: "y" });
    expect(edited.status).toBe("done");
    expect(edited.completedAt).toBe(firstStamp);
  });

  it("excludes soft-deleted tasks from the active list and restores them", () => {
    const tasks = store();
    const created = tasks.create({ title: "x" });

    tasks.softDelete(created.id);
    expect(tasks.listActive()).toHaveLength(0);

    tasks.restore(created.id);
    const listed = tasks.listActive();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
  });

  it("throws TaskNotFoundError for operations on an unknown or wrong-state task", () => {
    const tasks = store();
    const created = tasks.create({ title: "x" });

    expect(() => tasks.update("missing", { title: "y" })).toThrow(TaskNotFoundError);
    expect(() => tasks.setDone("missing", true)).toThrow(TaskNotFoundError);
    expect(() => tasks.softDelete("missing")).toThrow(TaskNotFoundError);
    // not currently deleted -> nothing to restore.
    expect(() => tasks.restore(created.id)).toThrow(TaskNotFoundError);
    // double delete -> the second finds no active row.
    tasks.softDelete(created.id);
    expect(() => tasks.softDelete(created.id)).toThrow(TaskNotFoundError);
  });

  it("isolates tasks between profiles", () => {
    const a = new TaskStore(db.raw, createProfile());
    const b = new TaskStore(db.raw, createProfile());
    const owned = a.create({ title: "A only" });

    expect(b.listActive()).toHaveLength(0);
    expect(() => b.update(owned.id, { title: "hijack" })).toThrow(TaskNotFoundError);
    expect(() => b.setDone(owned.id, true)).toThrow(TaskNotFoundError);
    expect(() => b.softDelete(owned.id)).toThrow(TaskNotFoundError);
    expect(a.listActive()).toHaveLength(1);
  });

  it("links subtasks and rejects a cross-profile parent", () => {
    const a = new TaskStore(db.raw, createProfile());
    const parent = a.create({ title: "Project" });
    const child = a.create({ title: "Step", parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
    expect(a.listActive()).toHaveLength(2);

    const b = new TaskStore(db.raw, createProfile());
    expect(() => b.create({ title: "Foreign child", parentId: parent.id })).toThrow(
      TaskValidationError,
    );
  });

  it("lists active tasks in stable creation order", () => {
    vi.useFakeTimers();
    const tasks = store();
    vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
    const first = tasks.create({ title: "1" });
    vi.setSystemTime(new Date("2026-07-06T10:00:01.000Z"));
    const second = tasks.create({ title: "2" });
    vi.setSystemTime(new Date("2026-07-06T10:00:02.000Z"));
    const third = tasks.create({ title: "3" });

    expect(tasks.listActive().map((t) => t.id)).toEqual([first.id, second.id, third.id]);
  });
});

describe("TaskStore — recurrence (ADR-024)", () => {
  const NOW = "2026-07-10T12:00:00.000Z";
  const DAILY: RecurrenceRule = { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } };

  it("creates a recurring task and reads the canonical rule back through the column", () => {
    const tasks = store();
    const created = tasks.create({
      title: "Weekly review",
      dueDate: "2026-07-10",
      // Deliberately out of order: the store stores the canonical form.
      recurrence: { freq: { kind: "weekly", interval: 2, days: [3, 1] }, end: { kind: "count", total: 5 } },
    });

    expect(created.recurrence).toEqual({
      freq: { kind: "weekly", interval: 2, days: [1, 3] },
      end: { kind: "count", total: 5 },
    });
    expect(tasks.listActive()[0]).toEqual(created);
  });

  it("defaults recurrence to null and round-trips a rule through an ordinary update", () => {
    const tasks = store();
    const created = tasks.create({ title: "x", dueDate: "2026-07-10" });
    expect(created.recurrence).toBeNull();

    const ruled = tasks.update(created.id, { recurrence: DAILY });
    expect(ruled.recurrence).toEqual(DAILY);

    const renamed = tasks.update(created.id, { title: "y" });
    expect(renamed.recurrence).toEqual(DAILY); // untouched by an unrelated patch

    const cleared = tasks.update(created.id, { recurrence: null });
    expect(cleared.recurrence).toBeNull();
    // With the rule gone the due date is free again.
    expect(tasks.update(created.id, { dueDate: null }).dueDate).toBeNull();
  });

  it("refuses a rule without a due date, in both directions", () => {
    const tasks = store();
    expect(() => tasks.create({ title: "x", recurrence: DAILY })).toThrow(TaskValidationError);

    const dateless = tasks.create({ title: "dateless" });
    expect(() => tasks.update(dateless.id, { recurrence: DAILY })).toThrow(TaskValidationError);

    const ruled = tasks.create({ title: "ruled", dueDate: "2026-07-10", recurrence: DAILY });
    expect(() => tasks.update(ruled.id, { dueDate: null })).toThrow(TaskValidationError);
    // and the refused update wrote nothing.
    expect(tasks.listActive().find((t) => t.id === ruled.id)?.dueDate).toBe("2026-07-10");
  });

  it("refuses a rule whose due date is not a bare calendar day", () => {
    const tasks = store();
    // A rule phases from day to day, so a timestamped due date has no anchor.
    expect(() =>
      tasks.create({ title: "x", dueDate: "2026-07-10T09:00:00Z", recurrence: DAILY }),
    ).toThrow(TaskValidationError);
    // Shaped like a date, but not a day that exists.
    expect(() => tasks.create({ title: "x", dueDate: "2026-02-30", recurrence: DAILY })).toThrow(
      TaskValidationError,
    );
  });

  it("refuses a structurally invalid rule", () => {
    const tasks = store();
    expect(() =>
      tasks.create({
        title: "x",
        dueDate: "2026-07-10",
        recurrence: { freq: { kind: "daily", interval: 0 }, end: { kind: "never" } },
      }),
    ).toThrow(TaskValidationError);
  });

  it("throws when a stored rule no longer validates — the store only ever wrote canonical JSON, so that is corruption", () => {
    const tasks = store();
    const created = tasks.create({ title: "x", dueDate: "2026-07-10", recurrence: DAILY });

    db.raw.prepare("UPDATE tasks SET recurrence = ? WHERE id = ?").run("{not json", created.id);
    expect(() => tasks.listActive()).toThrow(TaskValidationError);

    // Valid JSON, but not a rule this build's engine accepts.
    db.raw
      .prepare("UPDATE tasks SET recurrence = ? WHERE id = ?")
      .run('{"freq":{"kind":"daily","interval":0},"end":{"kind":"never"}}', created.id);
    expect(() => tasks.listActive()).toThrow(TaskValidationError);
  });

  it("advances the due date instead of completing, resets every subtask, and keeps the rule", () => {
    const tasks = store();
    const parent = tasks.create({ title: "Weekly shop", dueDate: "2026-07-10", recurrence: DAILY });
    const doneChild = tasks.create({ title: "Milk", parentId: parent.id, status: "done" });
    const startedChild = tasks.create({ title: "Bread", parentId: parent.id, status: "doing" });

    const advanced = tasks.completeOccurrence(parent.id, NOW);

    expect(advanced.dueDate).toBe("2026-07-11");
    expect(advanced.status).toBe("todo");
    expect(advanced.done).toBe(false);
    expect(advanced.completedAt).toBeNull();
    expect(advanced.recurrence).toEqual(DAILY);
    expect(advanced.updatedAt).toBe(NOW);
    expect(tasks.listActive().find((t) => t.id === parent.id)).toEqual(advanced);

    // Recurrence copies structure, never completion state.
    for (const childId of [doneChild.id, startedChild.id]) {
      const child = tasks.listActive().find((t) => t.id === childId);
      expect({ id: childId, status: child?.status, completedAt: child?.completedAt }).toEqual({
        id: childId,
        status: "todo",
        completedAt: null,
      });
      expect(child?.updatedAt).toBe(NOW);
    }
  });

  it("re-anchors on each advance, so a moved task moves its whole series", () => {
    const tasks = store();
    const created = tasks.create({
      title: "Every other day",
      dueDate: "2026-07-10",
      recurrence: { freq: { kind: "daily", interval: 2 }, end: { kind: "never" } },
    });

    expect(tasks.completeOccurrence(created.id, NOW).dueDate).toBe("2026-07-12");
    // Dragged forward by hand; the next occurrence phases from where it now sits.
    tasks.update(created.id, { dueDate: "2026-07-20" });
    expect(tasks.completeOccurrence(created.id, NOW).dueDate).toBe("2026-07-22");
  });

  it("ticks a count end down by one per advance and completes for real when it runs out", () => {
    const tasks = store();
    const created = tasks.create({
      title: "Three times",
      dueDate: "2026-07-10",
      recurrence: { freq: { kind: "daily", interval: 1 }, end: { kind: "count", total: 2 } },
    });

    const advanced = tasks.completeOccurrence(created.id, NOW);
    expect(advanced.dueDate).toBe("2026-07-11");
    expect(advanced.recurrence).toEqual({
      freq: { kind: "daily", interval: 1 },
      end: { kind: "count", total: 1 },
    });

    const finished = tasks.completeOccurrence(created.id, "2026-07-11T12:00:00.000Z");
    expect(finished.status).toBe("done");
    expect(finished.done).toBe(true);
    expect(finished.completedAt).toBe("2026-07-11T12:00:00.000Z");
    expect(finished.dueDate).toBe("2026-07-11"); // the last occurrence stays where it was
    // The exhausted rule stays on the row as inert history.
    expect(finished.recurrence).toEqual({
      freq: { kind: "daily", interval: 1 },
      end: { kind: "count", total: 1 },
    });
  });

  it("completes for real once an until end has passed, without touching subtasks", () => {
    const tasks = store();
    const parent = tasks.create({
      title: "Until today",
      dueDate: "2026-07-10",
      recurrence: { freq: { kind: "daily", interval: 1 }, end: { kind: "until", date: "2026-07-10" } },
    });
    const child = tasks.create({ title: "Sub", parentId: parent.id, status: "done" });

    const finished = tasks.completeOccurrence(parent.id, NOW);
    expect(finished.status).toBe("done");
    expect(finished.completedAt).toBe(NOW);
    expect(tasks.listActive().find((t) => t.id === child.id)?.status).toBe("done");
  });

  it("delegates to setDone for a task carrying no rule", () => {
    const tasks = store();
    const created = tasks.create({ title: "One-off", dueDate: "2026-07-10" });

    const done = tasks.completeOccurrence(created.id, NOW);
    expect(done.done).toBe(true);
    expect(done.status).toBe("done");
    expect(done.completedAt).not.toBeNull();
  });

  it("refuses setDone(true) on a recurring task, and still reopens one", () => {
    const tasks = store();
    const created = tasks.create({ title: "x", dueDate: "2026-07-10", recurrence: DAILY });

    expect(() => tasks.setDone(created.id, true)).toThrow(TaskValidationError);
    expect(tasks.listActive().find((t) => t.id === created.id)?.status).toBe("todo");
    // Reopening is never ambiguous, so it stays available.
    expect(tasks.setDone(created.id, false).status).toBe("todo");
  });

  it("refuses update({ status: 'done' }) on a recurring task — the kanban drag's write path", () => {
    const tasks = store();
    const created = tasks.create({ title: "x", dueDate: "2026-07-10", recurrence: DAILY });

    expect(() => tasks.update(created.id, { status: "done" })).toThrow(TaskValidationError);
    // Even bundled with other edits — the merged pair decides, not the patch shape.
    expect(() => tasks.update(created.id, { status: "done", title: "renamed" })).toThrow(
      TaskValidationError,
    );
    expect(tasks.listActive().find((t) => t.id === created.id)?.status).toBe("todo");
    // Ordinary edits (and a status change that is not the done transition) stay open.
    expect(tasks.update(created.id, { status: "doing" }).status).toBe("doing");

    // An exhausted series keeps its rule as inert history; edits on the
    // already-done row must not trip the transition guard.
    const lastRun = tasks.create({
      title: "last",
      dueDate: "2026-07-10",
      recurrence: { freq: { kind: "daily", interval: 1 }, end: { kind: "count", total: 1 } },
    });
    const finished = tasks.completeOccurrence(lastRun.id, NOW);
    expect(finished.status).toBe("done");
    expect(tasks.update(lastRun.id, { title: "renamed after the series ended" }).title).toBe(
      "renamed after the series ended",
    );
  });

  it("resets only this task's live subtasks", () => {
    const tasks = store();
    const parent = tasks.create({ title: "Parent", dueDate: "2026-07-10", recurrence: DAILY });
    const deletedChild = tasks.create({ title: "Gone", parentId: parent.id, status: "done" });
    tasks.softDelete(deletedChild.id);

    const otherParent = tasks.create({ title: "Other" });
    const otherChild = tasks.create({ title: "Other sub", parentId: otherParent.id, status: "done" });

    tasks.completeOccurrence(parent.id, NOW);

    const deletedRow = db.raw
      .prepare("SELECT status, deleted_at FROM tasks WHERE id = ?")
      .get(deletedChild.id) as { status: string; deleted_at: string | null };
    expect(deletedRow.status).toBe("done"); // a deleted subtask is not resurrected
    expect(deletedRow.deleted_at).not.toBeNull();
    expect(tasks.listActive().find((t) => t.id === otherChild.id)?.status).toBe("done");
  });

  it("throws TaskNotFoundError when completing an occurrence of an unknown task", () => {
    const tasks = store();
    expect(() => tasks.completeOccurrence("missing", NOW)).toThrow(TaskNotFoundError);
  });
});
