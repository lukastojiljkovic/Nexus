import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NexusDatabase,
  TaskListStore,
  TaskNotFoundError,
  TaskStore,
  TaskTagNotFoundError,
  TaskTagStore,
  TaskTagValidationError,
  openDatabase,
  uuidv7,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-task-tags-"));
  db = openDatabase({ path: join(dir, "task-tags.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const T0 = "2026-07-30T10:00:00.000Z";
const T1 = "2026-07-30T10:01:00.000Z";

/**
 * A profile with the Inbox every profile has (TASK-004) — `TaskStore.create`
 * refuses a profile without one, so a fixture that skipped it would be testing
 * a database state the app cannot reach (`taskStore.test.ts`'s own helper).
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
  tags: TaskTagStore;
  tasks: TaskStore;
  profileId: string;
}

function fixture(): Fixture {
  const profileId = createProfile();
  return {
    tags: new TaskTagStore(db.raw, profileId),
    tasks: new TaskStore(db.raw, profileId),
    profileId,
  };
}

describe("TaskTagStore — tags", () => {
  it("createTag trims and is get-or-create for an existing name", () => {
    const { tags } = fixture();
    const first = tags.createTag("  važno  ", T0);
    expect(first.name).toBe("važno");

    const again = tags.createTag("važno", T1);
    expect(again.id).toBe(first.id); // same trimmed name -> same tag
    expect(tags.listTags()).toHaveLength(1);
  });

  it("createTag returns the stored row shape", () => {
    const { tags, profileId } = fixture();
    expect(tags.createTag("posao", T0)).toEqual({
      id: expect.any(String),
      profileId,
      name: "posao",
      createdAt: T0,
    });
  });

  it("createTag rejects an empty or over-50-character name and a malformed now", () => {
    const { tags } = fixture();
    expect(() => tags.createTag("   ", T0)).toThrow(TaskTagValidationError);
    expect(() => tags.createTag("x".repeat(51), T0)).toThrow(TaskTagValidationError);
    expect(() => tags.createTag("x".repeat(50), T0)).not.toThrow();
    expect(() => tags.createTag("ok", "nope")).toThrow(TaskTagValidationError);
  });

  it("listTags returns the profile's tags, alphabetical by name", () => {
    const { tags } = fixture();
    tags.createTag("b", T0);
    tags.createTag("a", T1);
    expect(tags.listTags().map((tag) => tag.name)).toEqual(["a", "b"]);
  });

  it("renameTag changes the name and allows renaming to its own name", () => {
    const { tags } = fixture();
    const tag = tags.createTag("staro", T0);
    tags.renameTag(tag.id, "novo");
    expect(tags.listTags()[0]?.name).toBe("novo");
    // renaming a tag to its current name is a no-op, not a collision.
    expect(() => tags.renameTag(tag.id, "novo")).not.toThrow();
  });

  it("renameTag rejects a collision with another tag's name", () => {
    const { tags } = fixture();
    const a = tags.createTag("a", T0);
    tags.createTag("b", T1);
    expect(() => tags.renameTag(a.id, "b")).toThrow(TaskTagValidationError);
  });

  it("renameTag trims, validates the name and requires the tag", () => {
    const { tags } = fixture();
    const tag = tags.createTag("a", T0);
    tags.renameTag(tag.id, "  b  ");
    expect(tags.listTags()[0]?.name).toBe("b");
    expect(() => tags.renameTag(tag.id, "   ")).toThrow(TaskTagValidationError);
    expect(() => tags.renameTag("missing", "x")).toThrow(TaskTagNotFoundError);
  });

  it("deleteTag removes the tag and cascades its links", () => {
    const { tags, tasks } = fixture();
    const tag = tags.createTag("a", T0);
    const task = tasks.create({ title: "Zadatak" });
    tags.attachTag(task.id, tag.id);

    tags.deleteTag(tag.id);
    expect(tags.listTags()).toHaveLength(0);
    expect(tags.listTagLinks()).toHaveLength(0);
    expect(() => tags.deleteTag("missing")).toThrow(TaskTagNotFoundError);
  });
});

describe("TaskTagStore — tag links", () => {
  it("attachTag links a task to a tag and is idempotent", () => {
    const { tags, tasks } = fixture();
    const tag = tags.createTag("a", T0);
    const task = tasks.create({ title: "Zadatak" });

    tags.attachTag(task.id, tag.id);
    tags.attachTag(task.id, tag.id); // second attach is a no-op
    expect(tags.listTagLinks()).toEqual([{ taskId: task.id, tagId: tag.id }]);
  });

  it("attachTag rejects an unknown task or tag", () => {
    const { tags, tasks } = fixture();
    const tag = tags.createTag("a", T0);
    const task = tasks.create({ title: "Zadatak" });
    expect(() => tags.attachTag("missing", tag.id)).toThrow(TaskNotFoundError);
    expect(() => tags.attachTag(task.id, "missing")).toThrow(TaskTagNotFoundError);
  });

  it("attachTag rejects a soft-deleted task", () => {
    const { tags, tasks } = fixture();
    const tag = tags.createTag("a", T0);
    const task = tasks.create({ title: "Zadatak" });
    tasks.softDelete(task.id);
    expect(() => tags.attachTag(task.id, tag.id)).toThrow(TaskNotFoundError);
  });

  it("attachTag rejects a task or tag owned by another profile", () => {
    const a = fixture();
    const b = fixture();
    const taskA = a.tasks.create({ title: "A" });
    const tagA = a.tags.createTag("a", T0);
    const taskB = b.tasks.create({ title: "B" });
    const tagB = b.tags.createTag("b", T0);

    expect(() => a.tags.attachTag(taskB.id, tagA.id)).toThrow(TaskNotFoundError);
    expect(() => a.tags.attachTag(taskA.id, tagB.id)).toThrow(TaskTagNotFoundError);
  });

  it("detachTag removes a link and is a silent no-op when none exists", () => {
    const { tags, tasks } = fixture();
    const tag = tags.createTag("a", T0);
    const task = tasks.create({ title: "Zadatak" });
    tags.attachTag(task.id, tag.id);

    tags.detachTag(task.id, tag.id);
    expect(tags.listTagLinks()).toHaveLength(0);
    // detaching a link that does not exist throws nothing.
    expect(() => tags.detachTag(task.id, tag.id)).not.toThrow();
    expect(() => tags.detachTag("missing", tag.id)).not.toThrow();
  });

  it("detachTag cannot reach another profile's link", () => {
    const a = fixture();
    const b = fixture();
    const taskA = a.tasks.create({ title: "A" });
    const tagA = a.tags.createTag("a", T0);
    a.tags.attachTag(taskA.id, tagA.id);

    b.tags.detachTag(taskA.id, tagA.id);
    expect(a.tags.listTagLinks()).toEqual([{ taskId: taskA.id, tagId: tagA.id }]);
  });

  it("listTagLinks excludes soft-deleted tasks, whose links survive the delete", () => {
    const { tags, tasks } = fixture();
    const tag = tags.createTag("a", T0);
    const live = tasks.create({ title: "Živ" });
    const gone = tasks.create({ title: "Obrisan" });
    tags.attachTag(live.id, tag.id);
    tags.attachTag(gone.id, tag.id);

    tasks.softDelete(gone.id);
    expect(tags.listTagLinks()).toEqual([{ taskId: live.id, tagId: tag.id }]);
    // The link itself is still there — restoring the task brings its tag back
    // (the `note_tag_links` rule), which a wiped link could not do.
    tasks.restore(gone.id);
    expect(tags.listTagLinks()).toEqual(
      [
        { taskId: live.id, tagId: tag.id },
        { taskId: gone.id, tagId: tag.id },
      ].sort((x, y) => (x.taskId < y.taskId ? -1 : 1)),
    );
  });

  it("isolates tags and links between profiles", () => {
    const a = fixture();
    const b = fixture();
    const tagA = a.tags.createTag("a-tag", T0);
    const taskA = a.tasks.create({ title: "A" });
    a.tags.attachTag(taskA.id, tagA.id);

    expect(b.tags.listTags()).toHaveLength(0);
    expect(b.tags.listTagLinks()).toHaveLength(0);
    // and B still cannot reach A's rows through the mutators.
    expect(() => b.tags.attachTag(taskA.id, tagA.id)).toThrow(TaskNotFoundError);
    expect(() => b.tags.renameTag(tagA.id, "x")).toThrow(TaskTagNotFoundError);
    expect(() => b.tags.deleteTag(tagA.id)).toThrow(TaskTagNotFoundError);
    expect(a.tags.listTags()).toHaveLength(1);
    expect(a.tags.listTagLinks()).toHaveLength(1);
    // The same NAME in two profiles is two tags, never a collision.
    expect(() => b.tags.createTag("a-tag", T0)).not.toThrow();
  });
});
