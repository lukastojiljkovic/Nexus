import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
