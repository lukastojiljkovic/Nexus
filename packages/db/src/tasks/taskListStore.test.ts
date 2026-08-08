import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskViewConfig } from "@nexus/core";
import { FIRST_RANK, isRank } from "@nexus/core";
import {
  MAX_TASK_LIST_NAME_LENGTH,
  NexusDatabase,
  TaskListNotFoundError,
  TaskListStore,
  TaskListValidationError,
  TaskSectionNotFoundError,
  TaskStore,
  openDatabase,
  placeBetween,
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

/** Every rank in `ranks` is strictly ascending by plain string comparison — `rankBetween`'s whole promise. */
function expectRanksAscending(ranks: readonly string[]): void {
  for (let index = 1; index < ranks.length; index += 1) {
    expect(ranks[index - 1]! < ranks[index]!).toBe(true);
  }
}

/** The raw column, so a test can tell "stored `{}`" from "stored nothing". */
function storedViewConfig(listId: string): string | null {
  const row = db.raw.prepare("SELECT view_config FROM task_lists WHERE id = ?").get(listId) as
    | { view_config: string | null }
    | undefined;
  return row?.view_config ?? null;
}

describe("placeBetween", () => {
  it("places a row between two live neighbours, reading their ranks through rankOf", () => {
    const ranksById = new Map<string, string>([
      ["a", "i0"],
      ["b", "i1"],
    ]);
    const rankOf = (id: string): string => {
      const found = ranksById.get(id);
      if (found === undefined) throw new Error(`no ${id}`);
      return found;
    };

    const placed = placeBetween(rankOf, "a", "b");
    expect(placed).not.toBeNull();
    expect(isRank(placed as string)).toBe(true);
    expect(rankOf("a") < (placed as string)).toBe(true);
    expect((placed as string) < rankOf("b")).toBe(true);

    // The same row twice describes no gap at all — no `rankOf` lookup can change that.
    expect(placeBetween(rankOf, "a", "a")).toBeNull();
  });

  it("opens an empty scope at the first rank without ever consulting rankOf", () => {
    const rankOf = (id: string): string => {
      throw new Error(`rankOf must not be called for a null neighbour (got "${id}")`);
    };
    expect(placeBetween(rankOf, null, null)).toBe(FIRST_RANK);
  });

  it(
    "never runs out of room — placing between the same two neighbours 200 times running, each " +
      "time promoting the row just placed into the tightening gap, always succeeds and always " +
      "leaves the scope strictly ordered (migration 062: a rank has no gap to exhaust, so unlike " +
      "the sparse integer this replaced, placeBetween itself never needs a renumber-and-retry path)",
    () => {
      const ranksById = new Map<string, string>([
        ["lo", "i0"],
        ["hi", "i1"],
      ]);
      const rankOf = (id: string): string => {
        const found = ranksById.get(id);
        if (found === undefined) throw new Error(`no ${id}`);
        return found;
      };

      let beforeId = "lo";
      const placedIds: string[] = [];
      for (let round = 0; round < 200; round += 1) {
        const rank = placeBetween(rankOf, beforeId, "hi");
        expect(rank).not.toBeNull();
        const id = `row-${round}`;
        ranksById.set(id, rank as string);
        placedIds.push(id);
        beforeId = id; // the tightest possible next gap: right up against "hi"
      }

      const ranks = placedIds.map((id) => rankOf(id));
      for (const rank of ranks) expect(isRank(rank)).toBe(true);
      expectRanksAscending(ranks);
      expect(rankOf("lo") < ranks[0]!).toBe(true);
      expect(ranks[ranks.length - 1]! < rankOf("hi")).toBe(true);
    },
  );
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

    // The Inbox took the root scope's first rank; each further root append walks
    // the integer part forward by one, exactly what rankAfter promises.
    expect(work.rank).toBe("i1");
    expect(home.rank).toBe("i2");
    expect(sub.rank).toBe(FIRST_RANK); // its own (parentId) scope starts fresh
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

  it("switches a list's default view to any of the four shapes and refuses one outside the closed set", () => {
    const { lists, inboxId } = scope();
    for (const view of ["kanban", "cards", "calendar", "list"] as const) {
      lists.setDefaultView(inboxId, view, LATER);
      expect(lists.listActive()[0]).toMatchObject({ defaultView: view, updatedAt: LATER });
    }
    // The renderer is untrusted, so the store re-checks what the type already says.
    expect(() =>
      lists.setDefaultView(inboxId, "gantt" as unknown as "kanban", LATER),
    ).toThrow(TaskListValidationError);
  });

  describe("setViewConfig", () => {
    it("stores what a list remembers about its views and reads it back whole", () => {
      const { lists, inboxId } = scope();
      expect(lists.listActive()[0]).toMatchObject({ viewConfig: null });

      const config: TaskViewConfig = {
        list: { sort: { field: "dueDate", direction: "asc" }, filters: { status: "todo" } },
        kanban: { groupBy: "section" },
        cards: { sort: { field: "title", direction: "desc" } },
        calendar: { filters: { priority: "high" } },
      };
      lists.setViewConfig(inboxId, config, LATER);
      expect(lists.listActive()[0]).toMatchObject({ viewConfig: config, updatedAt: LATER });
    });

    it("stores nothing at all for null and for a config that asks for nothing", () => {
      const { lists, inboxId } = scope();
      lists.setViewConfig(inboxId, { kanban: { groupBy: "priority" } }, LATER);
      expect(lists.listActive()[0]?.viewConfig).toEqual({ kanban: { groupBy: "priority" } });

      lists.setViewConfig(inboxId, {}, LATER);
      expect(lists.listActive()[0]?.viewConfig).toBeNull();
      expect(storedViewConfig(inboxId)).toBeNull();

      lists.setViewConfig(inboxId, { cards: {} }, LATER);
      expect(storedViewConfig(inboxId)).toBeNull();

      lists.setViewConfig(inboxId, null, LATER);
      expect(lists.listActive()[0]?.viewConfig).toBeNull();
    });

    it("refuses a shape that is not a config — the write is where a mistake is still fixable", () => {
      const { lists, inboxId } = scope();
      const refused: unknown[] = [
        "{}",
        { gantt: {} },
        { kanban: { groupBy: "tag" } },
        { list: { sort: { field: "listId", direction: "asc" } } },
        { list: { filters: { status: "arhiva" } } },
        { calendar: { sort: { field: "dueDate", direction: "asc" } } },
      ];
      for (const value of refused) {
        expect(() =>
          lists.setViewConfig(inboxId, value as TaskViewConfig, LATER),
        ).toThrow(TaskListValidationError);
      }
      expect(storedViewConfig(inboxId)).toBeNull();
    });

    it("refuses an unknown or deleted list, and a malformed now", () => {
      const { lists, inboxId } = scope();
      expect(() => lists.setViewConfig(uuidv7(), {}, LATER)).toThrow(TaskListNotFoundError);
      expect(() => lists.setViewConfig(inboxId, {}, "danas")).toThrow(TaskListValidationError);
    });

    it("stores a kanban column arrangement whose keys the grouping actually has (ADR-060)", () => {
      const { lists, inboxId } = scope();
      const a = lists.createSection(inboxId, "Faza 1", NOW);
      const b = lists.createSection(inboxId, "Faza 2", NOW);

      const config: TaskViewConfig = {
        kanban: { groupBy: "section", hiddenColumns: [b.id], columnOrder: [b.id, a.id] },
      };
      lists.setViewConfig(inboxId, config, LATER);
      expect(lists.listActive()[0]?.viewConfig).toEqual(config);

      const byStatus: TaskViewConfig = {
        kanban: { hiddenColumns: ["done"], columnOrder: ["doing", "todo"] },
      };
      lists.setViewConfig(inboxId, byStatus, LATER);
      expect(lists.listActive()[0]?.viewConfig).toEqual(byStatus);
    });

    it("refuses a section-grouped column key that is not a section of THIS list (ADR-060)", () => {
      const { lists, inboxId } = scope();
      const other = lists.createList({ name: "Druga", parentId: null }, NOW);
      const foreign = lists.createSection(other.id, "Tuđa", NOW);

      for (const key of [uuidv7(), foreign.id]) {
        expect(() =>
          lists.setViewConfig(
            inboxId,
            { kanban: { groupBy: "section", hiddenColumns: [key] } },
            LATER,
          ),
        ).toThrow(TaskListValidationError);
        expect(() =>
          lists.setViewConfig(
            inboxId,
            { kanban: { groupBy: "section", columnOrder: [key] } },
            LATER,
          ),
        ).toThrow(TaskListValidationError);
      }
      expect(storedViewConfig(inboxId)).toBeNull();
    });

    it("refuses a hidden set that would hide the whole board (ADR-060)", () => {
      const { lists, inboxId } = scope();
      expect(() =>
        lists.setViewConfig(
          inboxId,
          { kanban: { hiddenColumns: ["todo", "doing", "done"] } } as TaskViewConfig,
          LATER,
        ),
      ).toThrow(TaskListValidationError);
      // Hiding every SECTION is not that: the list body column has no key and
      // is always drawn, so the board keeps a column.
      const section = lists.createSection(inboxId, "Jedina", NOW);
      lists.setViewConfig(
        inboxId,
        { kanban: { groupBy: "section", hiddenColumns: [section.id] } },
        LATER,
      );
      expect(lists.listActive()[0]?.viewConfig).toEqual({
        kanban: { groupBy: "section", hiddenColumns: [section.id] },
      });
    });

    it("reads a damaged column leniently — a config can cost a fallback, never the list", () => {
      const { lists, inboxId } = scope();
      const write = (text: string) =>
        db.raw.prepare("UPDATE task_lists SET view_config = ? WHERE id = ?").run(text, inboxId);

      write("{not json");
      expect(lists.listActive()[0]?.viewConfig).toBeNull();

      write('{"kanban":{"groupBy":"gantt"}}');
      expect(lists.listActive()[0]?.viewConfig).toBeNull();

      // Whatever a future build (or a hand-edited archive) put there, the half
      // this build understands still opens.
      write('{"gantt":{},"cards":{"sort":{"field":"title","direction":"desc"}}}');
      expect(lists.listActive()[0]?.viewConfig).toEqual({
        cards: { sort: { field: "title", direction: "desc" } },
      });
    });
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
      // A's scope had no children yet, so C — its only one — opens it at the
      // first rank, same as any other fresh scope.
      expect(moved).toMatchObject({ parentId: a.id, rank: FIRST_RANK, updatedAt: LATER });
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

    it(
      "never needs to renumber — moving into the same shrinking gap 200 times running always " +
        "finds room and leaves the whole scope strictly ordered (migration 062 deleted the " +
        "renumber path outright: a rank has no gap to exhaust, so there is no state a repeated " +
        "insert at the same spot can converge on that this move would fail against)",
      () => {
        const { lists } = scope();
        const lo = lists.createList({ name: "Lo" }, NOW);
        const hi = lists.createList({ name: "Hi" }, NOW);

        let beforeId = lo.id;
        for (let round = 0; round < 200; round += 1) {
          // Created at the scope's END for now; `moveList` immediately relocates
          // it into the tightening gap against `hi`, which is the interesting part.
          const row = lists.createList({ name: `Row ${round}` }, NOW);
          lists.moveList(row.id, null, beforeId, hi.id, LATER);
          beforeId = row.id;
        }

        const active = lists.listActive();
        expect(active).toHaveLength(203); // Inbox, Lo, 200 rows, Hi
        expectRanksAscending(active.map((list) => list.rank));
        expect(active[0]?.name).toBe("Inbox");
        expect(active[1]?.name).toBe("Lo");
        expect(active[active.length - 1]?.name).toBe("Hi");
        expect(active[active.length - 2]?.name).toBe("Row 199"); // last-placed sits right before Hi
      },
    );
  });
});

describe("TaskListStore — sections", () => {
  it("creates, lists, renames and re-orders sections within one list", () => {
    const { lists, inboxId } = scope();
    const a = lists.createSection(inboxId, "A", NOW);
    const b = lists.createSection(inboxId, "B", NOW);
    const c = lists.createSection(inboxId, "C", NOW);

    expect(lists.listSections(inboxId).map((section) => section.name)).toEqual(["A", "B", "C"]);
    expect(a.rank).toBe(FIRST_RANK);
    expect(c.rank).toBe("i2");

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
    // The promoted rows landed strictly after `body` (unmoved, still leading),
    // one rank-step apart in the order they were promoted — the same property
    // the title-order assertion above pins down, restated in terms of the
    // column the store actually orders by.
    expect(listed[0]?.rank).toBe(body.rank);
    expectRanksAscending(listed.map((task) => task.rank));
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
    // Appended one rank-step apart behind `existing` (unmoved, still leading) —
    // the same order the title assertion above already pins down.
    expect(listed[0]?.rank).toBe(existing.rank);
    expectRanksAscending(listed.map((task) => task.rank));
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
      (byId.get(inBody.id)?.rank ?? "") < (byId.get(inSection.id)?.rank ?? ""),
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
      expect((byId.get(leafA.id)?.rank ?? "") < (byId.get(leafB.id)?.rank ?? "")).toBe(true);
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
