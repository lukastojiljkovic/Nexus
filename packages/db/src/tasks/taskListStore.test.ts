import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_TASK_LIST_NAME_LENGTH,
  NexusDatabase,
  TASK_ORDER_GAP,
  TaskListNotFoundError,
  TaskListStore,
  TaskListValidationError,
  TaskSectionNotFoundError,
  TaskStore,
  openDatabase,
  placeBetween,
  positionBetween,
  uuidv7,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

const NOW = "2026-07-10T12:00:00.000Z";
const LATER = "2026-07-11T12:00:00.000Z";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-task-lists-"));
  db = openDatabase({ path: join(dir, "lists.db") });
});

afterEach(() => {
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

/** A profile with its store and the Inbox `ensureInbox` mints for it — how nearly every case below opens. */
function scope(): { profileId: string; lists: TaskListStore; inboxId: string } {
  const profileId = createProfile();
  const lists = new TaskListStore(db.raw, profileId);
  return { profileId, lists, inboxId: lists.ensureInbox(NOW).id };
}

function names(lists: TaskListStore): string[] {
  return lists.listActive().map((list) => list.name);
}

describe("positionBetween", () => {
  it("steps a whole gap at either end and takes the midpoint between neighbours", () => {
    expect(positionBetween(null, null)).toBe(TASK_ORDER_GAP);
    expect(positionBetween(5000, null)).toBe(5000 + TASK_ORDER_GAP);
    expect(positionBetween(null, 5000)).toBe(5000 - TASK_ORDER_GAP);
    expect(positionBetween(1024, 2048)).toBe(1536);
  });

  it("walks below zero when prepending — a position is a sort key, never a count", () => {
    expect(positionBetween(null, 0)).toBe(-TASK_ORDER_GAP);
    expect(positionBetween(-2048, -1024)).toBe(-1536);
  });

  it("returns null exactly when the neighbours are less than two apart", () => {
    expect(positionBetween(10, 12)).toBe(11);
    expect(positionBetween(10, 11)).toBeNull();
    expect(positionBetween(10, 10)).toBeNull();
    // Given the wrong way round, there is no gap either.
    expect(positionBetween(20, 10)).toBeNull();
  });
});

describe("placeBetween", () => {
  it("renumbers once and retries, and gives up when the neighbours describe no gap at all", () => {
    const positions = new Map<string, number>([
      ["a", 10],
      ["b", 11],
    ]);
    let renumbers = 0;
    const renumber = (): void => {
      renumbers += 1;
      positions.set("a", TASK_ORDER_GAP);
      positions.set("b", 2 * TASK_ORDER_GAP);
    };
    const positionOf = (id: string): number => {
      const found = positions.get(id);
      if (found === undefined) throw new Error(`no ${id}`);
      return found;
    };

    expect(placeBetween(positionOf, renumber, "a", "b")).toBe(1536);
    expect(renumbers).toBe(1);

    // The same row twice describes no gap, and a renumber cannot make one.
    renumbers = 0;
    expect(placeBetween(positionOf, renumber, "a", "a")).toBeNull();
    expect(renumbers).toBe(1);
  });

  it("never renumbers when there is already room", () => {
    let renumbers = 0;
    const placed = placeBetween(
      () => 0,
      () => {
        renumbers += 1;
      },
      null,
      null,
    );
    expect(placed).toBe(TASK_ORDER_GAP);
    expect(renumbers).toBe(0);
  });
});

describe("TaskListStore — the Inbox", () => {
  it("ensureInbox is idempotent and returns the same row every time", () => {
    const profileId = createProfile();
    const lists = new TaskListStore(db.raw, profileId);

    const first = lists.ensureInbox(NOW);
    expect(first).toMatchObject({
      profileId,
      parentId: null,
      name: "Inbox",
      isInbox: true,
      defaultView: "list",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const second = lists.ensureInbox(LATER);
    expect(second).toEqual(first);
    expect(lists.listActive()).toEqual([first]);
  });

  it("renames — a founder may prefer 'Prijemno' — but refuses to be moved or deleted", () => {
    const { lists, inboxId } = scope();
    const other = lists.createList({ name: "Posao" }, NOW);

    lists.renameList(inboxId, "Prijemno", LATER);
    expect(lists.listActive().find((list) => list.id === inboxId)).toMatchObject({
      name: "Prijemno",
      isInbox: true,
      updatedAt: LATER,
    });

    expect(() => lists.moveList(inboxId, other.id, null, null, NOW)).toThrow(TaskListValidationError);
    expect(() => lists.deleteList(inboxId, "move-to-inbox", NOW)).toThrow(TaskListValidationError);
    expect(() => lists.deleteList(inboxId, "delete-tasks", NOW)).toThrow(TaskListValidationError);
    expect(lists.listActive().map((list) => list.id)).toContain(inboxId);
  });

  it("isolates one profile's lists from another's store", () => {
    const mine = scope();
    const theirs = scope();
    const owned = mine.lists.createList({ name: "Moja" }, NOW);

    expect(theirs.lists.listActive().map((list) => list.name)).toEqual(["Inbox"]);
    expect(() => theirs.lists.renameList(owned.id, "otmica", NOW)).toThrow(TaskListNotFoundError);
    expect(() => theirs.lists.listSections(owned.id)).toThrow(TaskListNotFoundError);
    expect(() => theirs.lists.deleteList(owned.id, "delete-tasks", NOW)).toThrow(
      TaskListNotFoundError,
    );
  });
});

describe("TaskListStore — lists", () => {
  it("creates lists appended at their scope end and lists roots before children", () => {
    const { lists, inboxId } = scope();
    const work = lists.createList({ name: "Posao" }, NOW);
    const home = lists.createList({ name: "Kuća" }, NOW);
    const sub = lists.createList({ name: "Podlista", parentId: work.id }, NOW);

    expect(work.position).toBe(2 * TASK_ORDER_GAP); // the Inbox took the first slot
    expect(home.position).toBe(3 * TASK_ORDER_GAP);
    expect(sub.position).toBe(TASK_ORDER_GAP); // its own scope starts fresh
    expect(sub.parentId).toBe(work.id);
    expect(lists.listActive().map((list) => list.id)).toEqual([inboxId, work.id, home.id, sub.id]);
  });

  it("trims a name and refuses an empty or over-long one, for lists and sections alike", () => {
    const { lists, inboxId } = scope();
    expect(lists.createList({ name: "  Posao  " }, NOW).name).toBe("Posao");
    expect(() => lists.createList({ name: "   " }, NOW)).toThrow(TaskListValidationError);
    expect(() =>
      lists.createList({ name: "x".repeat(MAX_TASK_LIST_NAME_LENGTH + 1) }, NOW),
    ).toThrow(TaskListValidationError);
    expect(() => lists.createSection(inboxId, "", NOW)).toThrow(TaskListValidationError);
    expect(lists.createSection(inboxId, "  Danas  ", NOW).name).toBe("Danas");
  });

  it("refuses a malformed now and an unknown parent", () => {
    const { lists } = scope();
    expect(() => lists.createList({ name: "x" }, "danas")).toThrow(TaskListValidationError);
    expect(() => lists.createList({ name: "x", parentId: uuidv7() }, NOW)).toThrow(
      TaskListNotFoundError,
    );
  });

  it("switches a list's default view and refuses one outside the closed set", () => {
    const { lists, inboxId } = scope();
    lists.setDefaultView(inboxId, "kanban", LATER);
    expect(lists.listActive()[0]).toMatchObject({ defaultView: "kanban", updatedAt: LATER });
    // The renderer is untrusted, so the store re-checks what the type already says.
    expect(() =>
      lists.setDefaultView(inboxId, "gantt" as unknown as "kanban", LATER),
    ).toThrow(TaskListValidationError);
  });

  describe("moveList", () => {
    it("re-parents and re-orders in one call", () => {
      const { lists, inboxId } = scope();
      const a = lists.createList({ name: "A" }, NOW);
      const b = lists.createList({ name: "B" }, NOW);
      const c = lists.createList({ name: "C" }, NOW);

      // C between A and B, in the root scope.
      lists.moveList(c.id, null, a.id, b.id, LATER);
      expect(names(lists)).toEqual(["Inbox", "A", "C", "B"]);

      // ...and then into A as its only child.
      lists.moveList(c.id, a.id, null, null, LATER);
      const moved = lists.listActive().find((list) => list.id === c.id);
      expect(moved).toMatchObject({ parentId: a.id, position: TASK_ORDER_GAP, updatedAt: LATER });
      expect(names(lists)).toEqual(["Inbox", "A", "B", "C"]);
      expect(lists.listActive()[0]?.id).toBe(inboxId);
    });

    it("refuses a cycle — into itself, into its own child, and into a deeper descendant", () => {
      const { lists } = scope();
      const root = lists.createList({ name: "Root" }, NOW);
      const child = lists.createList({ name: "Child", parentId: root.id }, NOW);
      const grandchild = lists.createList({ name: "Grandchild", parentId: child.id }, NOW);

      expect(() => lists.moveList(root.id, root.id, null, null, NOW)).toThrow(
        TaskListValidationError,
      );
      expect(() => lists.moveList(root.id, child.id, null, null, NOW)).toThrow(
        TaskListValidationError,
      );
      expect(() => lists.moveList(root.id, grandchild.id, null, null, NOW)).toThrow(
        TaskListValidationError,
      );
      // The refused moves wrote nothing.
      expect(lists.listActive().find((list) => list.id === root.id)?.parentId).toBeNull();
    });

    it("refuses neighbours from another scope, the list itself, and a pair describing no gap", () => {
      const { lists } = scope();
      const a = lists.createList({ name: "A" }, NOW);
      const b = lists.createList({ name: "B" }, NOW);
      const nested = lists.createList({ name: "Nested", parentId: a.id }, NOW);

      expect(() => lists.moveList(b.id, null, nested.id, null, NOW)).toThrow(TaskListNotFoundError);
      expect(() => lists.moveList(b.id, null, b.id, null, NOW)).toThrow(TaskListValidationError);
      expect(() => lists.moveList(b.id, null, a.id, a.id, NOW)).toThrow(TaskListValidationError);
    });

    it("renumbers the scope once when the gap between two neighbours runs out", () => {
      const { lists } = scope();
      const a = lists.createList({ name: "A" }, NOW);
      const b = lists.createList({ name: "B" }, NOW);
      const c = lists.createList({ name: "C" }, NOW);
      // Wedged one apart at the end of the scope — exactly the state repeated
      // inserts at the same spot converge on, reached here in one step.
      db.raw.prepare("UPDATE task_lists SET position = ? WHERE id = ?").run(5000, a.id);
      db.raw.prepare("UPDATE task_lists SET position = ? WHERE id = ?").run(5001, b.id);

      lists.moveList(c.id, null, a.id, b.id, LATER);

      const positions = new Map(lists.listActive().map((list) => [list.name, list.position]));
      // The WHOLE scope is re-spaced at gap steps in its own order (Inbox, C, A,
      // B), and C then lands in the room that made between A and B.
      expect(positions.get("Inbox")).toBe(TASK_ORDER_GAP);
      expect(positions.get("A")).toBe(3 * TASK_ORDER_GAP);
      expect(positions.get("B")).toBe(4 * TASK_ORDER_GAP);
      expect(positions.get("C")).toBe(3 * TASK_ORDER_GAP + TASK_ORDER_GAP / 2);
      expect(names(lists)).toEqual(["Inbox", "A", "C", "B"]);
    });
  });
});

describe("TaskListStore — sections", () => {
  it("creates, lists, renames and re-orders sections within one list", () => {
    const { lists, inboxId } = scope();
    const a = lists.createSection(inboxId, "A", NOW);
    const b = lists.createSection(inboxId, "B", NOW);
    const c = lists.createSection(inboxId, "C", NOW);

    expect(lists.listSections(inboxId).map((section) => section.name)).toEqual(["A", "B", "C"]);
    expect(a.position).toBe(TASK_ORDER_GAP);
    expect(c.position).toBe(3 * TASK_ORDER_GAP);

    lists.renameSection(b.id, "  Bravo  ", LATER);
    lists.moveSection(c.id, null, a.id, LATER);
    expect(lists.listSections(inboxId).map((section) => section.name)).toEqual(["C", "A", "Bravo"]);
    expect(lists.listSections(inboxId)[0]).toMatchObject({ updatedAt: LATER });
  });

  it("keeps each list's sections to itself", () => {
    const { lists, inboxId } = scope();
    const work = lists.createList({ name: "Posao" }, NOW);
    const inboxSection = lists.createSection(inboxId, "Danas", NOW);
    const workSection = lists.createSection(work.id, "U toku", NOW);

    expect(lists.listSections(work.id).map((section) => section.id)).toEqual([workSection.id]);
    // A neighbour from another list is not a neighbour.
    expect(() => lists.moveSection(workSection.id, inboxSection.id, null, NOW)).toThrow(
      TaskSectionNotFoundError,
    );
    expect(() => lists.moveSection(workSection.id, workSection.id, null, NOW)).toThrow(
      TaskListValidationError,
    );

    const foreign = new TaskListStore(db.raw, createProfile());
    expect(() => foreign.renameSection(workSection.id, "otmica", NOW)).toThrow(
      TaskSectionNotFoundError,
    );
  });

  it("deleting a section promotes its tasks to the list body, appended in order", () => {
    const { profileId, lists, inboxId } = scope();
    const tasks = new TaskStore(db.raw, profileId);
    const section = lists.createSection(inboxId, "Danas", NOW);

    const body = tasks.create({ title: "U telu" });
    const first = tasks.create({ title: "Prvi", sectionId: section.id });
    const second = tasks.create({ title: "Drugi", sectionId: section.id });

    lists.deleteSection(section.id, LATER);

    expect(lists.listSections(inboxId)).toEqual([]);
    const listed = tasks.listActive();
    expect(listed.map((task) => task.title)).toEqual(["U telu", "Prvi", "Drugi"]);
    for (const task of listed) expect(task.sectionId).toBeNull();
    expect(listed.map((task) => task.position)).toEqual([
      body.position,
      body.position + TASK_ORDER_GAP,
      body.position + 2 * TASK_ORDER_GAP,
    ]);
    // The promotion is a real move of those rows, so they carry its stamp.
    expect(listed.filter((task) => task.updatedAt === LATER).map((task) => task.title)).toEqual([
      "Prvi",
      "Drugi",
    ]);
    expect(first.sectionId).toBe(section.id); // the returned row from before the delete is untouched
    expect(second.sectionId).toBe(section.id);
  });

  it("promotes a soft-deleted task out of the section too — its row would otherwise block the delete", () => {
    const { profileId, lists, inboxId } = scope();
    const tasks = new TaskStore(db.raw, profileId);
    const section = lists.createSection(inboxId, "Danas", NOW);
    const deleted = tasks.create({ title: "Obrisan", sectionId: section.id });
    tasks.softDelete(deleted.id);

    // `task_sections` is hard-deleted and `tasks.section_id` carries no
    // `ON DELETE` clause, so a soft-deleted task left pointing at it fails the
    // whole delete on a foreign key.
    expect(() => lists.deleteSection(section.id, LATER)).not.toThrow();

    const row = db.raw
      .prepare("SELECT section_id AS sectionId, deleted_at AS deletedAt FROM tasks WHERE id = ?")
      .get(deleted.id) as { sectionId: string | null; deletedAt: string | null };
    expect(row.sectionId).toBeNull();
    expect(row.deletedAt).not.toBeNull(); // still deleted; only its heading is gone
  });
});

describe("TaskListStore — deleteList", () => {
  it("move-to-inbox: tasks land in the Inbox body in order, the list soft-deletes with its sections", () => {
    const { profileId, lists, inboxId } = scope();
    const tasks = new TaskStore(db.raw, profileId);
    const existing = tasks.create({ title: "Već u Inboxu" });

    const work = lists.createList({ name: "Posao" }, NOW);
    const section = lists.createSection(work.id, "U toku", NOW);
    const inBody = tasks.create({ title: "Telo", listId: work.id });
    const inSection = tasks.create({ title: "Sekcija", listId: work.id, sectionId: section.id });

    lists.deleteList(work.id, "move-to-inbox", LATER);

    expect(names(lists)).toEqual(["Inbox"]);
    const listed = tasks.listActive();
    expect(listed.map((task) => task.title)).toEqual(["Već u Inboxu", "Telo", "Sekcija"]);
    for (const task of listed) {
      expect({ id: task.id, listId: task.listId, sectionId: task.sectionId }).toEqual({
        id: task.id,
        listId: inboxId,
        sectionId: null,
      });
    }
    expect(listed.map((task) => task.position)).toEqual([
      existing.position,
      existing.position + TASK_ORDER_GAP,
      existing.position + 2 * TASK_ORDER_GAP,
    ]);
    expect(inBody.listId).toBe(work.id); // the pre-delete rows are unchanged values
    expect(inSection.sectionId).toBe(section.id);

    // The now-empty sections ride along with the soft-deleted list, so restoring
    // it brings its structure back.
    const { n } = db.raw
      .prepare("SELECT count(*) AS n FROM task_sections WHERE list_id = ?")
      .get(work.id) as { n: number };
    expect(n).toBe(1);
  });

  it("delete-tasks: the list and its live tasks go down together, and restoreList brings back exactly those", () => {
    const { profileId, lists } = scope();
    const tasks = new TaskStore(db.raw, profileId);
    const work = lists.createList({ name: "Posao" }, NOW);

    const kept = tasks.create({ title: "U Inboxu" });
    const withList = tasks.create({ title: "S listom", listId: work.id });
    const child = tasks.create({ title: "Podzadatak", parentId: withList.id });
    // Deleted BY HAND beforehand: it carries a different stamp, so the restore
    // below must leave it deleted.
    const deletedEarlier = tasks.create({ title: "Ranije obrisan", listId: work.id });
    tasks.softDelete(deletedEarlier.id);

    lists.deleteList(work.id, "delete-tasks", LATER);

    expect(names(lists)).toEqual(["Inbox"]);
    expect(tasks.listActive().map((task) => task.id)).toEqual([kept.id]);

    lists.restoreList(work.id, "2026-07-12T00:00:00.000Z");

    expect(names(lists)).toEqual(["Inbox", "Posao"]);
    const restored = tasks.listActive().map((task) => task.id);
    expect(restored).toContain(withList.id);
    expect(restored).toContain(child.id);
    // The equality trick in one assertion: the row whose own delete predates the
    // list's carries a different `deleted_at`, and stays gone.
    expect(restored).not.toContain(deletedEarlier.id);
  });

  it("move-to-inbox: restoreList brings exactly the moved tasks back, appended to the list body", () => {
    const { profileId, lists, inboxId } = scope();
    const tasks = new TaskStore(db.raw, profileId);
    const alreadyHome = tasks.create({ title: "Već u Inboxu" });

    const work = lists.createList({ name: "Posao" }, NOW);
    const section = lists.createSection(work.id, "U toku", NOW);
    const inBody = tasks.create({ title: "Telo", listId: work.id });
    const inSection = tasks.create({ title: "Sekcija", listId: work.id, sectionId: section.id });

    lists.deleteList(work.id, "move-to-inbox", LATER);
    lists.restoreList(work.id, "2026-07-12T00:00:00.000Z");

    const byId = new Map(tasks.listActive().map((task) => [task.id, task]));
    // Both come home, in the order they were moved out in, and neither carries a
    // heading: the move cleared `section_id`, so the sections it left standing
    // are empty ones the user re-files into.
    expect(byId.get(inBody.id)).toMatchObject({ listId: work.id, sectionId: null });
    expect(byId.get(inSection.id)).toMatchObject({ listId: work.id, sectionId: null });
    expect(
      (byId.get(inBody.id)?.position ?? 0) < (byId.get(inSection.id)?.position ?? 0),
    ).toBe(true);
    // A task that was in the Inbox all along is not one of the list's, whatever
    // the rest of the Inbox now holds.
    expect(byId.get(alreadyHome.id)).toMatchObject({ listId: inboxId });
    expect(lists.listSections(work.id).map((row) => row.id)).toEqual([section.id]);
  });

  it("move-to-inbox: a task the user moved again after the delete stays where they put it", () => {
    const { profileId, lists, inboxId } = scope();
    const tasks = new TaskStore(db.raw, profileId);
    const work = lists.createList({ name: "Posao" }, NOW);
    const other = lists.createList({ name: "Drugo" }, NOW);
    const stays = tasks.create({ title: "Ostaje", listId: work.id });
    const comesBack = tasks.create({ title: "Vraća se", listId: work.id });

    lists.deleteList(work.id, "move-to-inbox", LATER);
    // An explicit later action on one of them: its stamp is no longer the
    // delete's, so the undo must not fight it.
    tasks.moveToList(stays.id, other.id, "2026-07-11T18:00:00.000Z");

    lists.restoreList(work.id, "2026-07-12T00:00:00.000Z");

    const byId = new Map(tasks.listActive().map((task) => [task.id, task]));
    expect(byId.get(stays.id)?.listId).toBe(other.id);
    expect(byId.get(comesBack.id)?.listId).toBe(work.id);
    expect(byId.get(comesBack.id)?.listId).not.toBe(inboxId);
  });

  it("move-to-inbox: a restore that fails part-way through changes nothing", () => {
    const { profileId, lists, inboxId } = scope();
    const tasks = new TaskStore(db.raw, profileId);
    const work = lists.createList({ name: "Posao" }, NOW);
    const first = tasks.create({ title: "Prvi", listId: work.id });
    const second = tasks.create({ title: "Drugi", listId: work.id });

    lists.deleteList(work.id, "move-to-inbox", LATER);

    // Refuses the SECOND row of the batch, so the restore is interrupted after
    // the list itself and the first task have already been written. A trigger
    // body takes no parameters, hence the interpolated ids — the store's own
    // "always bind" rule is untouched, these are generated uuids in a test.
    db.raw.exec(
      `CREATE TRIGGER refuse_second BEFORE UPDATE ON tasks
       WHEN NEW.id = '${second.id}' AND NEW.list_id = '${work.id}'
       BEGIN SELECT RAISE(ABORT, 'refused'); END`,
    );
    try {
      expect(() => lists.restoreList(work.id, "2026-07-12T00:00:00.000Z")).toThrow();
    } finally {
      db.raw.exec("DROP TRIGGER refuse_second");
    }

    // One transaction: the list is still deleted and BOTH tasks are still in the
    // Inbox — a half-applied undo would be the worst of the two states.
    expect(names(lists)).toEqual(["Inbox"]);
    const byId = new Map(tasks.listActive().map((task) => [task.id, task]));
    expect(byId.get(first.id)?.listId).toBe(inboxId);
    expect(byId.get(second.id)?.listId).toBe(inboxId);

    // ...and with the refusal gone the same undo goes through in full.
    lists.restoreList(work.id, "2026-07-12T00:00:00.000Z");
    const after = new Map(tasks.listActive().map((task) => [task.id, task]));
    expect(after.get(first.id)?.listId).toBe(work.id);
    expect(after.get(second.id)?.listId).toBe(work.id);
  });

  it("delete-tasks: the undo restores its own tasks and never claims one from the Inbox", () => {
    const { profileId, lists, inboxId } = scope();
    const tasks = new TaskStore(db.raw, profileId);
    const work = lists.createList({ name: "Posao" }, NOW);
    const inInbox = tasks.create({ title: "U Inboxu" });
    const inList = tasks.create({ title: "S listom", listId: work.id });
    // Touched at the very instant the delete below stamps: the two halves of the
    // undo are mutually exclusive, so a delete that took its tasks DOWN must not
    // also go looking for tasks in the Inbox.
    db.raw.prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(LATER, inInbox.id);

    lists.deleteList(work.id, "delete-tasks", LATER);
    lists.restoreList(work.id, "2026-07-12T00:00:00.000Z");

    const byId = new Map(tasks.listActive().map((task) => [task.id, task]));
    expect(byId.get(inInbox.id)?.listId).toBe(inboxId);
    expect(byId.get(inList.id)?.listId).toBe(work.id);
  });

  it("promotes child lists to the deleted list's own parent, appended in order, in both modes", () => {
    for (const mode of ["move-to-inbox", "delete-tasks"] as const) {
      const { lists } = scope();
      const root = lists.createList({ name: "Root" }, NOW);
      const middle = lists.createList({ name: "Middle", parentId: root.id }, NOW);
      const leafA = lists.createList({ name: "LeafA", parentId: middle.id }, NOW);
      const leafB = lists.createList({ name: "LeafB", parentId: middle.id }, NOW);

      lists.deleteList(middle.id, mode, LATER);

      const byId = new Map(lists.listActive().map((list) => [list.id, list]));
      expect(byId.has(middle.id)).toBe(false);
      expect({ mode, a: byId.get(leafA.id)?.parentId, b: byId.get(leafB.id)?.parentId }).toEqual({
        mode,
        a: root.id,
        b: root.id,
      });
      // Appended at the end of the target scope, keeping their relative order.
      expect((byId.get(leafA.id)?.position ?? 0) < (byId.get(leafB.id)?.position ?? 0)).toBe(true);
    }
  });

  it("refuses an unknown mode, an unknown list, and restoring a list that is not deleted", () => {
    const { lists } = scope();
    const work = lists.createList({ name: "Posao" }, NOW);

    expect(() =>
      lists.deleteList(work.id, "burn-it" as unknown as "delete-tasks", NOW),
    ).toThrow(TaskListValidationError);
    expect(() => lists.deleteList(uuidv7(), "delete-tasks", NOW)).toThrow(TaskListNotFoundError);
    expect(() => lists.restoreList(work.id, NOW)).toThrow(TaskListNotFoundError);

    lists.deleteList(work.id, "delete-tasks", LATER);
    expect(() => lists.deleteList(work.id, "delete-tasks", LATER)).toThrow(TaskListNotFoundError);
    expect(() => lists.listSections(work.id)).toThrow(TaskListNotFoundError);
  });
});
