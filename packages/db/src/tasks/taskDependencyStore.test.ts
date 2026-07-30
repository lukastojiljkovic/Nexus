import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NexusDatabase,
  TaskDependencyStore,
  TaskDependencyValidationError,
  TaskListStore,
  TaskNotFoundError,
  TaskStore,
  openDatabase,
  uuidv7,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-task-deps-"));
  db = openDatabase({ path: join(dir, "task-deps.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-07-30T10:00:00.000Z";

/**
 * A profile with the Inbox every profile has (TASK-004) — `TaskStore.create`
 * refuses a profile without one, so a fixture that skipped it would be testing
 * a database state the app cannot reach (`taskTagStore.test.ts`'s own helper).
 */
function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date().toISOString());
  new TaskListStore(db.raw, id).ensureInbox(T0);
  return id;
}

interface Fixture {
  deps: TaskDependencyStore;
  tasks: TaskStore;
  profileId: string;
}

function fixture(): Fixture {
  const profileId = createProfile();
  return {
    deps: new TaskDependencyStore(db.raw, profileId),
    tasks: new TaskStore(db.raw, profileId),
    profileId,
  };
}

describe("TaskDependencyStore — adding", () => {
  it("addDependency records the pair and is idempotent", () => {
    const { deps, tasks } = fixture();
    const blocker = tasks.create({ title: "Prvo" });
    const blocked = tasks.create({ title: "Drugo" });

    deps.addDependency(blocker.id, blocked.id);
    deps.addDependency(blocker.id, blocked.id); // second add is a no-op
    expect(deps.listLinks()).toEqual([{ blockerId: blocker.id, blockedId: blocked.id }]);
  });

  it("addDependency rejects an unknown task on either end", () => {
    const { deps, tasks } = fixture();
    const task = tasks.create({ title: "Zadatak" });
    expect(() => deps.addDependency("missing", task.id)).toThrow(TaskNotFoundError);
    expect(() => deps.addDependency(task.id, "missing")).toThrow(TaskNotFoundError);
  });

  it("addDependency rejects a soft-deleted task on either end", () => {
    const { deps, tasks } = fixture();
    const live = tasks.create({ title: "Živ" });
    const gone = tasks.create({ title: "Obrisan" });
    tasks.softDelete(gone.id);
    expect(() => deps.addDependency(gone.id, live.id)).toThrow(TaskNotFoundError);
    expect(() => deps.addDependency(live.id, gone.id)).toThrow(TaskNotFoundError);
  });

  it("addDependency rejects a task owned by another profile", () => {
    const a = fixture();
    const b = fixture();
    const taskA = a.tasks.create({ title: "A" });
    const taskB = b.tasks.create({ title: "B" });

    expect(() => a.deps.addDependency(taskA.id, taskB.id)).toThrow(TaskNotFoundError);
    expect(() => a.deps.addDependency(taskB.id, taskA.id)).toThrow(TaskNotFoundError);
    expect(a.deps.listLinks()).toEqual([]);
  });

  it("addDependency refuses a task blocking itself", () => {
    const { deps, tasks } = fixture();
    const task = tasks.create({ title: "Zadatak" });
    expect(() => deps.addDependency(task.id, task.id)).toThrow(TaskDependencyValidationError);
    expect(deps.listLinks()).toEqual([]);
  });

  it("addDependency refuses the edge that would close a two-task loop", () => {
    const { deps, tasks } = fixture();
    const a = tasks.create({ title: "A" });
    const b = tasks.create({ title: "B" });
    deps.addDependency(a.id, b.id);

    expect(() => deps.addDependency(b.id, a.id)).toThrow(TaskDependencyValidationError);
    expect(deps.listLinks()).toEqual([{ blockerId: a.id, blockedId: b.id }]);
  });

  it("addDependency refuses the edge that would close a longer loop", () => {
    const { deps, tasks } = fixture();
    const a = tasks.create({ title: "A" });
    const b = tasks.create({ title: "B" });
    const c = tasks.create({ title: "C" });
    deps.addDependency(a.id, b.id);
    deps.addDependency(b.id, c.id);

    // c already depends (transitively) on a, so making c block a would loop.
    expect(() => deps.addDependency(c.id, a.id)).toThrow(TaskDependencyValidationError);
    expect(deps.listLinks()).toHaveLength(2);
  });

  it("addDependency accepts a diamond — two paths to one task are not a cycle", () => {
    const { deps, tasks } = fixture();
    const a = tasks.create({ title: "A" });
    const b = tasks.create({ title: "B" });
    const c = tasks.create({ title: "C" });
    const d = tasks.create({ title: "D" });
    deps.addDependency(a.id, b.id);
    deps.addDependency(a.id, c.id);
    deps.addDependency(b.id, d.id);

    expect(() => deps.addDependency(c.id, d.id)).not.toThrow();
    expect(deps.listLinks()).toHaveLength(4);
  });

  it("addDependency accepts one task blocking several and several blocking one", () => {
    const { deps, tasks } = fixture();
    const hub = tasks.create({ title: "Čvor" });
    const one = tasks.create({ title: "Jedan" });
    const two = tasks.create({ title: "Dva" });

    deps.addDependency(hub.id, one.id);
    deps.addDependency(hub.id, two.id);
    deps.addDependency(one.id, two.id);
    expect(deps.listLinks()).toHaveLength(3);
  });

  it("the cycle walk sees through a SOFT-DELETED link, so undo can never restore a loop", () => {
    const { deps, tasks } = fixture();
    const a = tasks.create({ title: "A" });
    const b = tasks.create({ title: "B" });
    const c = tasks.create({ title: "C" });
    deps.addDependency(a.id, b.id);
    deps.addDependency(b.id, c.id);

    // With b hidden, `listLinks` shows nothing of the a->b->c chain…
    tasks.softDelete(b.id);
    expect(deps.listLinks()).toEqual([]);
    // …but c->a would still close a loop the moment b came back, so it is
    // refused now rather than restored into the table later.
    expect(() => deps.addDependency(c.id, a.id)).toThrow(TaskDependencyValidationError);
  });

  it("the cycle walk cannot be misled by another profile's edges", () => {
    // Two profiles whose graphs are separate: an edge in one must never make an
    // edge in the other look like a loop, and must never be walked at all.
    const a = fixture();
    const b = fixture();
    const a1 = a.tasks.create({ title: "A1" });
    const a2 = a.tasks.create({ title: "A2" });
    a.deps.addDependency(a1.id, a2.id);

    const b1 = b.tasks.create({ title: "B1" });
    const b2 = b.tasks.create({ title: "B2" });
    expect(() => b.deps.addDependency(b1.id, b2.id)).not.toThrow();
    expect(() => b.deps.addDependency(b2.id, b1.id)).toThrow(TaskDependencyValidationError);
    expect(a.deps.listLinks()).toEqual([{ blockerId: a1.id, blockedId: a2.id }]);
  });
});

describe("TaskDependencyStore — removing", () => {
  it("removeDependency removes an edge and is a silent no-op when none exists", () => {
    const { deps, tasks } = fixture();
    const blocker = tasks.create({ title: "Prvo" });
    const blocked = tasks.create({ title: "Drugo" });
    deps.addDependency(blocker.id, blocked.id);

    deps.removeDependency(blocker.id, blocked.id);
    expect(deps.listLinks()).toEqual([]);
    // removing an edge that does not exist throws nothing.
    expect(() => deps.removeDependency(blocker.id, blocked.id)).not.toThrow();
    expect(() => deps.removeDependency("missing", blocked.id)).not.toThrow();
    expect(() => deps.removeDependency(blocker.id, "missing")).not.toThrow();
  });

  it("removeDependency is directed — removing the reverse pair changes nothing", () => {
    const { deps, tasks } = fixture();
    const blocker = tasks.create({ title: "Prvo" });
    const blocked = tasks.create({ title: "Drugo" });
    deps.addDependency(blocker.id, blocked.id);

    deps.removeDependency(blocked.id, blocker.id);
    expect(deps.listLinks()).toEqual([{ blockerId: blocker.id, blockedId: blocked.id }]);
  });

  it("removeDependency cannot reach another profile's edge", () => {
    const a = fixture();
    const b = fixture();
    const a1 = a.tasks.create({ title: "A1" });
    const a2 = a.tasks.create({ title: "A2" });
    a.deps.addDependency(a1.id, a2.id);

    b.deps.removeDependency(a1.id, a2.id);
    expect(a.deps.listLinks()).toEqual([{ blockerId: a1.id, blockedId: a2.id }]);
  });
});

describe("TaskDependencyStore — reading", () => {
  it("listLinks hides a soft-deleted task's edges, which survive the delete", () => {
    const { deps, tasks } = fixture();
    const blocker = tasks.create({ title: "Prvo" });
    const blocked = tasks.create({ title: "Drugo" });
    const third = tasks.create({ title: "Treće" });
    deps.addDependency(blocker.id, blocked.id);
    deps.addDependency(blocker.id, third.id);

    tasks.softDelete(blocked.id);
    expect(deps.listLinks()).toEqual([{ blockerId: blocker.id, blockedId: third.id }]);
    // The edge itself is still there — restoring the task brings the dependency
    // back (the `task_tag_links` rule), which a wiped edge could not do.
    tasks.restore(blocked.id);
    expect(deps.listLinks()).toHaveLength(2);
  });

  it("listLinks hides an edge whose BLOCKER is soft-deleted too", () => {
    const { deps, tasks } = fixture();
    const blocker = tasks.create({ title: "Prvo" });
    const blocked = tasks.create({ title: "Drugo" });
    deps.addDependency(blocker.id, blocked.id);

    tasks.softDelete(blocker.id);
    expect(deps.listLinks()).toEqual([]);
    tasks.restore(blocker.id);
    expect(deps.listLinks()).toEqual([{ blockerId: blocker.id, blockedId: blocked.id }]);
  });

  it("listLinks is ordered and isolated between profiles", () => {
    const a = fixture();
    const b = fixture();
    const a1 = a.tasks.create({ title: "A1" });
    const a2 = a.tasks.create({ title: "A2" });
    a.deps.addDependency(a1.id, a2.id);

    expect(b.deps.listLinks()).toEqual([]);
    expect(a.deps.listLinks()).toEqual([{ blockerId: a1.id, blockedId: a2.id }]);
  });

  it("hard-deleting a task takes its edges with it (the schema's CASCADE)", () => {
    const { deps, tasks, profileId } = fixture();
    const blocker = tasks.create({ title: "Prvo" });
    const blocked = tasks.create({ title: "Drugo" });
    deps.addDependency(blocker.id, blocked.id);

    db.raw.prepare("DELETE FROM tasks WHERE id = ? AND profile_id = ?").run(blocker.id, profileId);
    expect(deps.listLinks()).toEqual([]);
    expect(
      (db.raw.prepare("SELECT count(*) AS n FROM task_dependencies").get() as { n: number }).n,
    ).toBe(0);
  });

  it("completing a task changes no edge — being blocked is derived by the reader", () => {
    // The store deliberately does NOT intercept completion (ADR-037 section 3):
    // an edge is a statement about order, not a lock, and the single completion
    // path from ADR-024 stays the single completion path.
    const { deps, tasks } = fixture();
    const blocker = tasks.create({ title: "Prvo" });
    const blocked = tasks.create({ title: "Drugo" });
    deps.addDependency(blocker.id, blocked.id);

    expect(() => tasks.setDone(blocked.id, true)).not.toThrow();
    expect(deps.listLinks()).toEqual([{ blockerId: blocker.id, blockedId: blocked.id }]);
  });
});
