import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_TASK_ATTACHMENT_BYTES,
  NexusDatabase,
  TaskAttachmentNotFoundError,
  TaskAttachmentStore,
  TaskAttachmentValidationError,
  TaskListStore,
  TaskNotFoundError,
  TaskStore,
  openDatabase,
  uuidv7,
  type AddTaskAttachmentInput,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-task-attachments-"));
  db = openDatabase({ path: join(dir, "task-attachments.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  const created = new Date().toISOString();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", created);
  // Every profile has an Inbox (TASK-004): `TaskStore` refuses to place a task
  // without one, so a fixture missing it is a state the app cannot reach.
  new TaskListStore(db.raw, id).ensureInbox(created);
  return id;
}

interface Fixture {
  attachments: TaskAttachmentStore;
  tasks: TaskStore;
  profileId: string;
}

function fixture(): Fixture {
  const profileId = createProfile();
  return {
    attachments: new TaskAttachmentStore(db.raw, profileId),
    tasks: new TaskStore(db.raw, profileId),
    profileId,
  };
}

const T1 = "2026-07-30T10:01:00.000Z";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function validInput(overrides: Partial<AddTaskAttachmentInput> = {}): AddTaskAttachmentInput {
  return { fileName: "ugovor.pdf", mime: "application/pdf", sizeBytes: 1024, sha256: SHA_A, ...overrides };
}

describe("TaskAttachmentStore — add", () => {
  it("adds an attachment, trims the file name, and returns the full row", () => {
    const { attachments, tasks } = fixture();
    const task = tasks.create({ title: "Zadatak" });

    const result = attachments.add(
      task.id,
      { fileName: "  ugovor.pdf  ", mime: "application/pdf", sizeBytes: 1024, sha256: SHA_A },
      T1,
    );

    expect(result.fileName).toBe("ugovor.pdf");
    expect(result.taskId).toBe(task.id);
    expect(result.mime).toBe("application/pdf");
    expect(result.sizeBytes).toBe(1024);
    expect(result.sha256).toBe(SHA_A);
    expect(result.createdAt).toBe(T1);
    expect(result.id).toBeTruthy();
  });

  it("rejects adding to an unknown, soft-deleted, or cross-profile task", () => {
    const a = fixture();
    const b = fixture();
    const task = a.tasks.create({ title: "A" });
    const deleted = a.tasks.create({ title: "Obrisan" });
    a.tasks.softDelete(deleted.id);

    expect(() => a.attachments.add("missing", validInput(), T1)).toThrow(TaskNotFoundError);
    expect(() => a.attachments.add(deleted.id, validInput(), T1)).toThrow(TaskNotFoundError);
    expect(() => b.attachments.add(task.id, validInput(), T1)).toThrow(TaskNotFoundError);
  });

  it("rejects an empty, over-255-character, or path-separator-carrying file name", () => {
    const { attachments, tasks } = fixture();
    const task = tasks.create({ title: "A" });

    expect(() => attachments.add(task.id, validInput({ fileName: "   " }), T1)).toThrow(
      TaskAttachmentValidationError,
    );
    expect(() => attachments.add(task.id, validInput({ fileName: "x".repeat(256) }), T1)).toThrow(
      TaskAttachmentValidationError,
    );
    expect(() =>
      attachments.add(task.id, validInput({ fileName: "x".repeat(255) }), T1),
    ).not.toThrow();
    expect(() => attachments.add(task.id, validInput({ fileName: "a/b.pdf" }), T1)).toThrow(
      TaskAttachmentValidationError,
    );
    expect(() => attachments.add(task.id, validInput({ fileName: "a\\b.pdf" }), T1)).toThrow(
      TaskAttachmentValidationError,
    );
  });

  it("rejects a malformed mime type", () => {
    const { attachments, tasks } = fixture();
    const task = tasks.create({ title: "A" });

    expect(() => attachments.add(task.id, validInput({ mime: "not-a-mime" }), T1)).toThrow(
      TaskAttachmentValidationError,
    );
    expect(() => attachments.add(task.id, validInput({ mime: "IMAGE/PNG" }), T1)).toThrow(
      TaskAttachmentValidationError,
    );
    expect(() => attachments.add(task.id, validInput({ mime: `a/${"x".repeat(100)}` }), T1)).toThrow(
      TaskAttachmentValidationError,
    );
    expect(() =>
      attachments.add(task.id, validInput({ mime: "application/zip" }), T1),
    ).not.toThrow();
  });

  it("rejects a sizeBytes that is zero, negative, non-integer, or over the cap", () => {
    const { attachments, tasks } = fixture();
    const task = tasks.create({ title: "A" });

    expect(() => attachments.add(task.id, validInput({ sizeBytes: 0 }), T1)).toThrow(
      TaskAttachmentValidationError,
    );
    expect(() => attachments.add(task.id, validInput({ sizeBytes: -1 }), T1)).toThrow(
      TaskAttachmentValidationError,
    );
    expect(() => attachments.add(task.id, validInput({ sizeBytes: 1.5 }), T1)).toThrow(
      TaskAttachmentValidationError,
    );
    expect(() =>
      attachments.add(task.id, validInput({ sizeBytes: MAX_TASK_ATTACHMENT_BYTES + 1 }), T1),
    ).toThrow(TaskAttachmentValidationError);
    expect(() =>
      attachments.add(task.id, validInput({ sizeBytes: MAX_TASK_ATTACHMENT_BYTES }), T1),
    ).not.toThrow();
  });

  it("rejects a malformed sha256", () => {
    const { attachments, tasks } = fixture();
    const task = tasks.create({ title: "A" });

    expect(() => attachments.add(task.id, validInput({ sha256: "abc" }), T1)).toThrow(
      TaskAttachmentValidationError,
    );
    // uppercase hex is rejected — the stored form is always lowercase.
    expect(() => attachments.add(task.id, validInput({ sha256: "A".repeat(64) }), T1)).toThrow(
      TaskAttachmentValidationError,
    );
  });

  it("rejects a malformed now", () => {
    const { attachments, tasks } = fixture();
    const task = tasks.create({ title: "A" });
    expect(() => attachments.add(task.id, validInput(), "nope")).toThrow(
      TaskAttachmentValidationError,
    );
  });
});

describe("TaskAttachmentStore — list", () => {
  it("is empty for a task with no attachments, and orders by created_at then id", () => {
    const { attachments, tasks } = fixture();
    const task = tasks.create({ title: "A" });
    expect(attachments.list(task.id)).toEqual([]);

    const first = attachments.add(task.id, validInput({ sha256: SHA_A }), "2026-07-30T10:00:00.000Z");
    const second = attachments.add(task.id, validInput({ sha256: SHA_B }), T1);
    expect(attachments.list(task.id).map((a) => a.id)).toEqual([first.id, second.id]);
  });

  it("rejects listing an unknown, soft-deleted, or cross-profile task", () => {
    const a = fixture();
    const b = fixture();
    const task = a.tasks.create({ title: "A" });
    const deleted = a.tasks.create({ title: "Obrisan" });
    a.tasks.softDelete(deleted.id);

    expect(() => a.attachments.list("missing")).toThrow(TaskNotFoundError);
    expect(() => a.attachments.list(deleted.id)).toThrow(TaskNotFoundError);
    expect(() => b.attachments.list(task.id)).toThrow(TaskNotFoundError);
  });
});

describe("TaskAttachmentStore — remove", () => {
  it("removes an attachment and returns the removed row", () => {
    const { attachments, tasks } = fixture();
    const task = tasks.create({ title: "A" });
    const added = attachments.add(task.id, validInput(), T1);

    const removed = attachments.remove(task.id, added.id);
    expect(removed).toEqual(added);
    expect(attachments.list(task.id)).toEqual([]);
  });

  it("rejects removing an unknown attachment id", () => {
    const { attachments, tasks } = fixture();
    const task = tasks.create({ title: "A" });
    expect(() => attachments.remove(task.id, "missing")).toThrow(TaskAttachmentNotFoundError);
  });

  it("rejects removing an attachment via the wrong task id, without deleting it", () => {
    const { attachments, tasks } = fixture();
    const taskA = tasks.create({ title: "A" });
    const taskB = tasks.create({ title: "B" });
    const added = attachments.add(taskA.id, validInput(), T1);

    expect(() => attachments.remove(taskB.id, added.id)).toThrow(TaskAttachmentNotFoundError);
    expect(attachments.list(taskA.id)).toHaveLength(1);
  });

  it("rejects removing from an unknown, soft-deleted, or cross-profile task", () => {
    const a = fixture();
    const b = fixture();
    const task = a.tasks.create({ title: "A" });
    const added = a.attachments.add(task.id, validInput(), T1);
    const deleted = a.tasks.create({ title: "Obrisan" });
    a.tasks.softDelete(deleted.id);

    expect(() => a.attachments.remove("missing", added.id)).toThrow(TaskNotFoundError);
    expect(() => a.attachments.remove(deleted.id, added.id)).toThrow(TaskNotFoundError);
    expect(() => b.attachments.remove(task.id, added.id)).toThrow(TaskNotFoundError);
  });
});

describe("TaskAttachmentStore — refCount / mimeForHash (profile-agnostic)", () => {
  it("counts references to a hash across tasks and across profiles", () => {
    const a = fixture();
    const b = fixture();
    const taskA1 = a.tasks.create({ title: "A1" });
    const taskA2 = a.tasks.create({ title: "A2" });
    const taskB1 = b.tasks.create({ title: "B1" });

    expect(a.attachments.refCount(SHA_A)).toBe(0);
    a.attachments.add(taskA1.id, validInput({ sha256: SHA_A }), T1);
    expect(a.attachments.refCount(SHA_A)).toBe(1);
    a.attachments.add(taskA2.id, validInput({ sha256: SHA_A }), T1);
    expect(a.attachments.refCount(SHA_A)).toBe(2);
    b.attachments.add(taskB1.id, validInput({ sha256: SHA_A }), T1);
    // Deliberately profile-agnostic: B's store reports the same total as A's.
    expect(a.attachments.refCount(SHA_A)).toBe(3);
    expect(b.attachments.refCount(SHA_A)).toBe(3);
  });

  it("resolves a hash's stored mime across profiles, and null for an unknown hash", () => {
    const a = fixture();
    const b = fixture();
    expect(a.attachments.mimeForHash(SHA_A)).toBeNull();

    const taskA = a.tasks.create({ title: "A" });
    a.attachments.add(taskA.id, validInput({ sha256: SHA_A, mime: "image/png" }), T1);
    expect(a.attachments.mimeForHash(SHA_A)).toBe("image/png");
    // Deliberately profile-agnostic: B's store resolves the same hash too.
    expect(b.attachments.mimeForHash(SHA_A)).toBe("image/png");
  });
});

describe("TaskAttachmentStore — countsByTask", () => {
  it("returns one entry per live task that carries at least one attachment", () => {
    const { attachments, tasks } = fixture();
    const withTwo = tasks.create({ title: "Dva" });
    const withOne = tasks.create({ title: "Jedan" });
    tasks.create({ title: "Bez priloga" });

    expect(attachments.countsByTask()).toEqual([]);

    attachments.add(withTwo.id, validInput({ sha256: SHA_A }), T1);
    attachments.add(withTwo.id, validInput({ sha256: SHA_B }), T1);
    attachments.add(withOne.id, validInput({ sha256: SHA_A }), T1);

    const counts = attachments.countsByTask();
    expect(new Map(counts.map((row) => [row.taskId, row.count]))).toEqual(
      new Map([
        [withTwo.id, 2],
        [withOne.id, 1],
      ]),
    );
  });

  it("hides a soft-deleted task's count and never counts another profile's", () => {
    const a = fixture();
    const b = fixture();
    const kept = a.tasks.create({ title: "Ostaje" });
    const deleted = a.tasks.create({ title: "Obrisan" });
    const other = b.tasks.create({ title: "Tuđi" });
    a.attachments.add(kept.id, validInput(), T1);
    a.attachments.add(deleted.id, validInput(), T1);
    b.attachments.add(other.id, validInput(), T1);

    a.tasks.softDelete(deleted.id);

    expect(a.attachments.countsByTask()).toEqual([{ taskId: kept.id, count: 1 }]);
    expect(b.attachments.countsByTask()).toEqual([{ taskId: other.id, count: 1 }]);
  });
});

describe("TaskAttachmentStore — soft-delete / hard-delete interaction", () => {
  it("keeps rows (and refCount) through a soft delete, and list works again after restore", () => {
    const { attachments, tasks } = fixture();
    const task = tasks.create({ title: "A" });
    attachments.add(task.id, validInput(), T1);
    expect(attachments.refCount(SHA_A)).toBe(1);

    tasks.softDelete(task.id);
    expect(attachments.refCount(SHA_A)).toBe(1); // unchanged by soft-delete

    tasks.restore(task.id);
    expect(attachments.list(task.id)).toHaveLength(1);
  });

  it("cascades rows away on a hard delete of the task, reflected in refCount", () => {
    const { attachments, tasks } = fixture();
    const task = tasks.create({ title: "A" });
    attachments.add(task.id, validInput(), T1);
    expect(attachments.refCount(SHA_A)).toBe(1);

    db.raw.prepare("DELETE FROM tasks WHERE id = ?").run(task.id);
    expect(attachments.refCount(SHA_A)).toBe(0);
  });
});
