import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecurrenceRule } from "@nexus/core";
import {
  MAX_TASK_REMINDERS,
  MAX_TASK_REMINDER_DAYS,
  NexusDatabase,
  TASK_ORDER_GAP,
  TaskListStore,
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

const NOW_ISO = "2026-01-01T00:00:00.000Z";

/**
 * A profile with the Inbox every profile has (TASK-004): migration 022
 * backfills the ones that predate ADR-029, `main` seeds it for the ones it
 * creates, and `TaskStore.create` refuses a profile without one — so a fixture
 * that skipped it would be testing a database state the app cannot reach.
 */
function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date().toISOString());
  new TaskListStore(db.raw, id).ensureInbox(NOW_ISO);
  return id;
}

function store(): TaskStore {
  return new TaskStore(db.raw, createProfile());
}

function inboxOf(profileId: string): string {
  const inbox = new TaskListStore(db.raw, profileId).listActive().find((list) => list.isInbox);
  if (!inbox) throw new Error("Test setup: profile has no Inbox.");
  return inbox.id;
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

describe("TaskStore — reminder offsets (ADR-028)", () => {
  const NOW = "2026-07-10T12:00:00.000Z";
  const DAILY: RecurrenceRule = { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } };

  it("defaults to no reminders and stores a supplied ladder ascending", () => {
    const tasks = store();
    const plain = tasks.create({ title: "Bez podsetnika" });
    expect(plain.reminderOffsets).toEqual([]);

    // Deliberately out of order: the column keeps the canonical ascending form.
    const reminded = tasks.create({
      title: "Sa podsetnicima",
      dueDate: "2026-08-10",
      reminderOffsets: [7, 0, 1],
    });
    expect(reminded.reminderOffsets).toEqual([0, 1, 7]);
    // Keyed rather than positional: `listActive` ties on `created_at` within a
    // millisecond and falls through to two random uuidv7 suffixes.
    const stored = new Map(tasks.listActive().map((task) => [task.id, task.reminderOffsets]));
    expect(stored.get(plain.id)).toEqual([]);
    expect(stored.get(reminded.id)).toEqual([0, 1, 7]);
  });

  it("patches the ladder through update, leaves it alone when omitted, and clears it with an empty array", () => {
    const tasks = store();
    const created = tasks.create({ title: "x", dueDate: "2026-08-10", reminderOffsets: [3] });

    expect(tasks.update(created.id, { title: "y" }).reminderOffsets).toEqual([3]);
    expect(tasks.update(created.id, { reminderOffsets: [14, 1] }).reminderOffsets).toEqual([1, 14]);
    expect(tasks.update(created.id, { reminderOffsets: [] }).reminderOffsets).toEqual([]);
    expect(tasks.listActive()[0]?.reminderOffsets).toEqual([]);
    // With the ladder gone the due date is free again.
    expect(tasks.update(created.id, { dueDate: null }).dueDate).toBeNull();
  });

  it("refuses a ladder without a bare-date due date, in both directions", () => {
    const tasks = store();
    expect(() => tasks.create({ title: "x", reminderOffsets: [3] })).toThrow(TaskValidationError);
    // A ladder counts whole days back, so a timestamped due date has no anchor.
    expect(() =>
      tasks.create({ title: "x", dueDate: "2026-08-10T09:00:00Z", reminderOffsets: [3] }),
    ).toThrow(TaskValidationError);
    // Shaped like a date, but not a day that exists.
    expect(() => tasks.create({ title: "x", dueDate: "2026-02-30", reminderOffsets: [3] })).toThrow(
      TaskValidationError,
    );

    const dateless = tasks.create({ title: "dateless" });
    expect(() => tasks.update(dateless.id, { reminderOffsets: [3] })).toThrow(TaskValidationError);

    const reminded = tasks.create({ title: "reminded", dueDate: "2026-08-10", reminderOffsets: [3] });
    expect(() => tasks.update(reminded.id, { dueDate: null })).toThrow(TaskValidationError);
    // and the refused update wrote nothing.
    expect(tasks.listActive().find((t) => t.id === reminded.id)?.dueDate).toBe("2026-08-10");
    // Clearing the ladder is always allowed, whatever the date is.
    expect(tasks.update(reminded.id, { reminderOffsets: [] }).reminderOffsets).toEqual([]);
  });

  it("refuses a ladder that is not unique whole days within range, or that is too long", () => {
    const tasks = store();
    const bad: number[][] = [
      [-1], // negative
      [1.5], // not whole days
      [MAX_TASK_REMINDER_DAYS + 1], // beyond the one-year cap
      [3, 3], // the same lead time twice
      Array.from({ length: MAX_TASK_REMINDERS + 1 }, (_, index) => index), // one too many
    ];
    for (const reminderOffsets of bad) {
      expect(() => tasks.create({ title: "x", dueDate: "2026-08-10", reminderOffsets })).toThrow(
        TaskValidationError,
      );
    }

    // The bounds themselves are inclusive, and a full ladder is fine.
    const created = tasks.create({
      title: "x",
      dueDate: "2026-08-10",
      reminderOffsets: Array.from({ length: MAX_TASK_REMINDERS }, (_, index) => index),
    });
    expect(created.reminderOffsets).toHaveLength(MAX_TASK_REMINDERS);
    expect(
      tasks.update(created.id, { reminderOffsets: [0, MAX_TASK_REMINDER_DAYS] }).reminderOffsets,
    ).toEqual([0, MAX_TASK_REMINDER_DAYS]);
    // A rejected patch leaves the stored ladder untouched.
    expect(() => tasks.update(created.id, { reminderOffsets: [-5] })).toThrow(TaskValidationError);
    expect(tasks.listActive()[0]?.reminderOffsets).toEqual([0, MAX_TASK_REMINDER_DAYS]);
  });

  it("throws when the stored ladder no longer validates — that is corruption, not input", () => {
    const tasks = store();
    const created = tasks.create({ title: "x", dueDate: "2026-08-10", reminderOffsets: [3] });

    const corrupt = ["{not json", '"3"', "[[3]]", '["3"]', "[-3]", "[1.5]", "[366]"];
    for (const value of corrupt) {
      db.raw.prepare("UPDATE tasks SET reminder_offsets = ? WHERE id = ?").run(value, created.id);
      expect(() => tasks.listActive()).toThrow(TaskValidationError);
    }
  });

  it("carries the ladder through a recurring task's advance untouched — the moved due date re-anchors it", () => {
    const tasks = store();
    const created = tasks.create({
      title: "Svakog dana",
      dueDate: "2026-07-10",
      recurrence: DAILY,
      reminderOffsets: [0, 2],
    });

    const advanced = tasks.completeOccurrence(created.id, NOW);
    expect(advanced.dueDate).toBe("2026-07-11");
    expect(advanced.reminderOffsets).toEqual([0, 2]);
    expect(tasks.listActive().find((t) => t.id === created.id)?.reminderOffsets).toEqual([0, 2]);
  });

  it("keeps the ladder through the completion paths a one-off takes", () => {
    const tasks = store();
    const created = tasks.create({ title: "Jednokratno", dueDate: "2026-08-10", reminderOffsets: [1] });

    expect(tasks.setDone(created.id, true).reminderOffsets).toEqual([1]);
    expect(tasks.setDone(created.id, false).reminderOffsets).toEqual([1]);
    expect(tasks.completeOccurrence(created.id, NOW).reminderOffsets).toEqual([1]);
  });
});

describe("TaskStore — lists, sections and ordering (TASK-004 / ADR-029)", () => {
  const NOW = "2026-07-10T12:00:00.000Z";

  /** A profile, its `TaskStore`, its `TaskListStore` and its Inbox — what nearly every case below opens with. */
  function scope(): {
    profileId: string;
    tasks: TaskStore;
    lists: TaskListStore;
    inboxId: string;
  } {
    const profileId = createProfile();
    return {
      profileId,
      tasks: new TaskStore(db.raw, profileId),
      lists: new TaskListStore(db.raw, profileId),
      inboxId: inboxOf(profileId),
    };
  }

  it("defaults a new task into the profile's Inbox, appended at the body end", () => {
    const { tasks, inboxId } = scope();

    const first = tasks.create({ title: "Prvi" });
    const second = tasks.create({ title: "Drugi" });

    expect(first.listId).toBe(inboxId);
    expect(first.sectionId).toBeNull();
    expect(first.position).toBe(TASK_ORDER_GAP);
    expect(second.position).toBe(2 * TASK_ORDER_GAP);
    expect(tasks.listActive().map((task) => task.id)).toEqual([first.id, second.id]);
  });

  it("places a task in a named list and section, and refuses a section of another list", () => {
    const { tasks, lists, inboxId } = scope();
    const work = lists.createList({ name: "Posao" }, NOW);
    const doing = lists.createSection(work.id, "U toku", NOW);
    const inboxSection = lists.createSection(inboxId, "Danas", NOW);

    const placed = tasks.create({ title: "U sekciji", listId: work.id, sectionId: doing.id });
    expect(placed).toMatchObject({ listId: work.id, sectionId: doing.id, position: TASK_ORDER_GAP });

    expect(() =>
      tasks.create({ title: "Pogrešna sekcija", listId: work.id, sectionId: inboxSection.id }),
    ).toThrow(TaskValidationError);
    expect(() => tasks.create({ title: "Nepoznata lista", listId: uuidv7() })).toThrow(
      TaskValidationError,
    );
  });

  it("refuses a list belonging to another profile, and one that is soft-deleted", () => {
    const mine = scope();
    const theirs = scope();
    const foreign = theirs.lists.createList({ name: "Njihova" }, NOW);
    const deleted = mine.lists.createList({ name: "Obrisana" }, NOW);
    mine.lists.deleteList(deleted.id, "delete-tasks", NOW);

    expect(() => mine.tasks.create({ title: "x", listId: foreign.id })).toThrow(TaskValidationError);
    expect(() => mine.tasks.create({ title: "x", listId: deleted.id })).toThrow(TaskValidationError);
  });

  it("gives a subtask its parent's placement, ignoring any listId the caller passes", () => {
    const { tasks, lists } = scope();
    const work = lists.createList({ name: "Posao" }, NOW);
    const doing = lists.createSection(work.id, "U toku", NOW);
    const parent = tasks.create({ title: "Roditelj", listId: work.id, sectionId: doing.id });

    const child = tasks.create({ title: "Dete", parentId: parent.id, listId: uuidv7() });
    expect(child).toMatchObject({ listId: work.id, sectionId: doing.id });
    expect(child.position).toBe(parent.position + TASK_ORDER_GAP);
  });

  it("throws when the profile has no Inbox at all — seeding and migration 022 both guarantee one", () => {
    const profileId = createProfile();
    const tasks = new TaskStore(db.raw, profileId);
    db.raw.prepare("DELETE FROM task_lists WHERE profile_id = ?").run(profileId);

    expect(() => tasks.create({ title: "Nema gde" })).toThrow(TaskValidationError);
  });

  it("throws when a stored row carries no list — after migration 022 that is corruption, not 'unfiled'", () => {
    const { tasks } = scope();
    const created = tasks.create({ title: "x" });

    db.raw.prepare("UPDATE tasks SET list_id = NULL WHERE id = ?").run(created.id);
    expect(() => tasks.listActive()).toThrow(TaskValidationError);
  });

  it("orders the body before the sections, and each scope by position", () => {
    const { tasks, lists, inboxId } = scope();
    const section = lists.createSection(inboxId, "Danas", NOW);

    const inSection = tasks.create({ title: "U sekciji", sectionId: section.id });
    const body = tasks.create({ title: "U telu" });

    // Created section-first, listed body-first: the order is the scope's, never
    // the insertion's.
    expect(tasks.listActive().map((task) => task.id)).toEqual([body.id, inSection.id]);
  });

  describe("moveToList", () => {
    it("moves the whole live subtree, clearing sections and appending in order", () => {
      const { tasks, lists, inboxId } = scope();
      const work = lists.createList({ name: "Posao" }, NOW);
      const section = lists.createSection(inboxId, "Danas", NOW);
      const parent = tasks.create({ title: "Roditelj", sectionId: section.id });
      const child = tasks.create({ title: "Dete", parentId: parent.id });
      const grandchild = tasks.create({ title: "Unuk", parentId: child.id });
      const bystander = tasks.create({ title: "Neko drugi" });

      const moved = tasks.moveToList(parent.id, work.id, NOW);
      expect(moved).toMatchObject({ listId: work.id, sectionId: null, updatedAt: NOW });

      const byId = new Map(tasks.listActive().map((task) => [task.id, task]));
      for (const id of [parent.id, child.id, grandchild.id]) {
        expect({ id, listId: byId.get(id)?.listId, sectionId: byId.get(id)?.sectionId }).toEqual({
          id,
          listId: work.id,
          sectionId: null,
        });
      }
      // The bystander stayed exactly where it was.
      expect(byId.get(bystander.id)?.listId).toBe(inboxId);
      // And the subtree is spaced apart in the target list, parent first.
      const positions = [parent.id, child.id, grandchild.id].map((id) => byId.get(id)?.position ?? 0);
      expect(positions).toEqual([TASK_ORDER_GAP, 2 * TASK_ORDER_GAP, 3 * TASK_ORDER_GAP]);
    });

    it("leaves a soft-deleted subtask behind rather than resurrecting it into the new list", () => {
      const { tasks, lists, inboxId } = scope();
      const work = lists.createList({ name: "Posao" }, NOW);
      const parent = tasks.create({ title: "Roditelj" });
      const deletedChild = tasks.create({ title: "Obrisano dete", parentId: parent.id });
      tasks.softDelete(deletedChild.id);

      tasks.moveToList(parent.id, work.id, NOW);

      const row = db.raw
        .prepare("SELECT list_id AS listId, deleted_at AS deletedAt FROM tasks WHERE id = ?")
        .get(deletedChild.id) as { listId: string; deletedAt: string | null };
      expect(row.listId).toBe(inboxId);
      expect(row.deletedAt).not.toBeNull();
    });

    it("refuses an unknown list and a malformed now", () => {
      const { tasks } = scope();
      const created = tasks.create({ title: "x" });

      expect(() => tasks.moveToList(created.id, uuidv7(), NOW)).toThrow(TaskValidationError);
      expect(() => tasks.moveToList(created.id, inboxOf(createProfile()), NOW)).toThrow(
        TaskValidationError,
      );
      expect(() => tasks.moveToList("missing", inboxOf(createProfile()), NOW)).toThrow(
        TaskNotFoundError,
      );
      expect(() => tasks.moveToList(created.id, created.listId, "danas")).toThrow(
        TaskValidationError,
      );
    });
  });

  describe("moveToSection", () => {
    it("moves one task between its list's sections and back to the body", () => {
      const { tasks, lists, inboxId } = scope();
      const section = lists.createSection(inboxId, "Danas", NOW);
      const created = tasks.create({ title: "x" });
      const child = tasks.create({ title: "dete", parentId: created.id });

      const moved = tasks.moveToSection(created.id, section.id, NOW);
      expect(moved).toMatchObject({ listId: inboxId, sectionId: section.id, position: TASK_ORDER_GAP });
      // Only the task itself: sections are a within-list grouping, and the UI
      // renders a subtask under its parent whichever heading it carries.
      expect(tasks.listActive().find((task) => task.id === child.id)?.sectionId).toBeNull();

      expect(tasks.moveToSection(created.id, null, NOW).sectionId).toBeNull();
    });

    it("refuses a section of another list — changing list is moveToList's job", () => {
      const { tasks, lists } = scope();
      const work = lists.createList({ name: "Posao" }, NOW);
      const foreign = lists.createSection(work.id, "U toku", NOW);
      const created = tasks.create({ title: "x" });

      expect(() => tasks.moveToSection(created.id, foreign.id, NOW)).toThrow(TaskValidationError);
      expect(tasks.listActive()[0]?.sectionId).toBeNull();
    });
  });

  describe("reorder", () => {
    it("places a task between two neighbours, at either end, and refuses a foreign one", () => {
      const { tasks, lists } = scope();
      const a = tasks.create({ title: "A" });
      const b = tasks.create({ title: "B" });
      const c = tasks.create({ title: "C" });

      // C between A and B.
      tasks.reorder(c.id, a.id, b.id, NOW);
      expect(tasks.listActive().map((task) => task.title)).toEqual(["A", "C", "B"]);

      // C to the head, then to the tail.
      tasks.reorder(c.id, null, a.id, NOW);
      expect(tasks.listActive().map((task) => task.title)).toEqual(["C", "A", "B"]);
      tasks.reorder(c.id, b.id, null, NOW);
      expect(tasks.listActive().map((task) => task.title)).toEqual(["A", "B", "C"]);

      // A neighbour outside the task's own (list, section) scope describes a
      // move, not a reorder.
      const work = lists.createList({ name: "Posao" }, NOW);
      const elsewhere = tasks.create({ title: "Drugde", listId: work.id });
      expect(() => tasks.reorder(a.id, elsewhere.id, null, NOW)).toThrow(TaskValidationError);
      expect(() => tasks.reorder(a.id, a.id, null, NOW)).toThrow(TaskValidationError);
      expect(() => tasks.reorder(a.id, b.id, b.id, NOW)).toThrow(TaskValidationError);
    });

    it("renumbers the scope once and retries when the gap between two neighbours runs out", () => {
      const { tasks, profileId } = scope();
      const a = tasks.create({ title: "A" });
      const b = tasks.create({ title: "B" });
      const filler = tasks.create({ title: "Filler" });

      // Wedge A and B one apart by hand — exactly the state repeated inserts at
      // the same spot converge on, reached here in one step.
      db.raw.prepare("UPDATE tasks SET position = ? WHERE id = ?").run(100, a.id);
      db.raw.prepare("UPDATE tasks SET position = ? WHERE id = ?").run(101, b.id);
      db.raw.prepare("UPDATE tasks SET position = ? WHERE id = ?").run(102, filler.id);

      const moved = tasks.reorder(filler.id, a.id, b.id, NOW);

      // The whole scope was re-spaced at gap steps, and the moved row landed in
      // the middle of the room that made.
      const positions = new Map(tasks.listActive().map((task) => [task.title, task.position]));
      expect(positions.get("A")).toBe(TASK_ORDER_GAP);
      expect(positions.get("B")).toBe(2 * TASK_ORDER_GAP);
      expect(moved.position).toBe(TASK_ORDER_GAP + TASK_ORDER_GAP / 2);
      expect(tasks.listActive().map((task) => task.title)).toEqual(["A", "Filler", "B"]);

      // The renumber left every other scope alone.
      const inboxCount = db.raw
        .prepare("SELECT count(*) AS n FROM tasks WHERE profile_id = ?")
        .get(profileId) as { n: number };
      expect(inboxCount.n).toBe(3);
    });

    it("refuses neighbours given the wrong way round, even after a renumber", () => {
      const { tasks } = scope();
      const a = tasks.create({ title: "A" });
      const b = tasks.create({ title: "B" });
      const c = tasks.create({ title: "C" });

      // "after A" and "before B" describe no gap when B precedes A.
      expect(() => tasks.reorder(c.id, b.id, a.id, NOW)).toThrow(TaskValidationError);
    });
  });

  describe("restore", () => {
    it("puts a task whose list was deleted back into the Inbox body, subtree and all", () => {
      const { tasks, lists, inboxId } = scope();
      const work = lists.createList({ name: "Posao" }, NOW);
      const section = lists.createSection(work.id, "U toku", NOW);
      const parent = tasks.create({ title: "Roditelj", listId: work.id, sectionId: section.id });
      const child = tasks.create({ title: "Dete", parentId: parent.id });
      const anchor = tasks.create({ title: "U Inboxu" });

      lists.deleteList(work.id, "delete-tasks", NOW);
      expect(tasks.listActive().map((task) => task.id)).toEqual([anchor.id]);

      // The child first: its list is gone, so it lands in the Inbox body even
      // though the parent it belongs to is still deleted.
      tasks.restore(child.id);
      expect(tasks.listActive().find((task) => task.id === child.id)).toMatchObject({
        listId: inboxId,
        sectionId: null,
        position: anchor.position + TASK_ORDER_GAP,
      });

      // Then the parent: its own list is gone too, and the live subtree (itself
      // plus the child already restored above) travels with it in order.
      tasks.restore(parent.id);
      const byId = new Map(tasks.listActive().map((task) => [task.id, task]));
      expect(byId.get(parent.id)).toMatchObject({ listId: inboxId, sectionId: null });
      expect(byId.get(child.id)).toMatchObject({ listId: inboxId, sectionId: null });
      expect(byId.get(child.id)?.position).toBeGreaterThan(byId.get(parent.id)?.position ?? 0);
      expect(tasks.listActive().map((task) => task.id)).toEqual([
        anchor.id,
        parent.id,
        child.id,
      ]);
    });

    it("leaves a restored task exactly where it was when its list is still there", () => {
      const { tasks, lists } = scope();
      const work = lists.createList({ name: "Posao" }, NOW);
      const section = lists.createSection(work.id, "U toku", NOW);
      const created = tasks.create({ title: "x", listId: work.id, sectionId: section.id });
      const placement = {
        listId: created.listId,
        sectionId: created.sectionId,
        position: created.position,
      };

      tasks.softDelete(created.id);
      tasks.restore(created.id);

      expect(tasks.listActive().find((task) => task.id === created.id)).toMatchObject(placement);
    });

    it("refuses to restore at all when the fallback has no Inbox to fall back to", () => {
      const { tasks, lists, profileId } = scope();
      const work = lists.createList({ name: "Posao" }, NOW);
      const created = tasks.create({ title: "x", listId: work.id });
      lists.deleteList(work.id, "delete-tasks", NOW);
      db.raw
        .prepare("UPDATE task_lists SET deleted_at = ? WHERE profile_id = ? AND is_inbox = 1")
        .run(NOW, profileId);

      expect(() => tasks.restore(created.id)).toThrow(TaskValidationError);
      // Atomic: the un-delete is rolled back with the fallback that failed, so
      // the task is not left alive in a list nobody can see.
      expect(tasks.listActive()).toHaveLength(0);
    });
  });

  it("carries the placement untouched through an edit, a completion and a recurring advance", () => {
    const { tasks, lists, inboxId } = scope();
    const section = lists.createSection(inboxId, "Danas", NOW);
    const created = tasks.create({
      title: "Svakog dana",
      dueDate: "2026-07-10",
      sectionId: section.id,
      recurrence: { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } },
    });
    const placement = {
      listId: created.listId,
      sectionId: created.sectionId,
      position: created.position,
    };

    expect(tasks.update(created.id, { title: "Preimenovano" })).toMatchObject(placement);
    expect(tasks.completeOccurrence(created.id, NOW)).toMatchObject(placement);
    expect(tasks.setDone(created.id, false)).toMatchObject(placement);
    expect(tasks.listActive()[0]).toMatchObject(placement);
  });
});
