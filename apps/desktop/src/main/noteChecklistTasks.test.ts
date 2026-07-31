import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  NexusDatabase,
  NoteNotFoundError,
  NoteStore,
  TaskListStore,
  TaskStore,
  TaskValidationError,
  openDatabase,
  uuidv7,
} from "@nexus/db";
import type { NoteMeta, Task } from "@nexus/db";

import { checklistToTasks, countNoteChecklistItems } from "./noteChecklistTasks.js";
import type { NoteChecklistTasksDeps } from "./noteChecklistTasks.js";

/**
 * „Pretvori u zadatke" over REAL stores on a real database: the whole value of
 * this action is in which task rows it writes — their status, their parent, and
 * the order they land in — so a doubled store would test nothing worth testing.
 * Only the Electron shell is absent.
 */

let dir: string;
let db: NexusDatabase;
let profileId: string;
let inboxId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nexus-note-checklist-"));
  db = openDatabase({ path: join(dir, "notes.db") });
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", new Date().toISOString());
  inboxId = new TaskListStore(db.raw, profileId).ensureInbox(now()).id;
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

function now(): string {
  return new Date().toISOString();
}

function noteStore(): NoteStore {
  return new NoteStore(db.raw, profileId);
}

/** The deps `main/index.ts` builds for this channel, minus Electron: real stores, a real transaction. */
function makeDeps(): NoteChecklistTasksDeps {
  return {
    notes: noteStore(),
    tasks: new TaskStore(db.raw, profileId),
    lists: new TaskListStore(db.raw, profileId),
    runInTransaction: (write) => db.raw.transaction(write)(),
  };
}

// --- Document builders ----------------------------------------------------

function item(text: string, checked: boolean, ...nested: Y.XmlElement[]): Y.XmlElement {
  const element = new Y.XmlElement("taskItem");
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  element.insert(0, [paragraph, ...nested]);
  element.setAttribute("checked", checked as unknown as string);
  return element;
}

function list(...items: Y.XmlElement[]): Y.XmlElement {
  const element = new Y.XmlElement("taskList");
  element.insert(0, items);
  return element;
}

function paragraph(text: string): Y.XmlElement {
  const element = new Y.XmlElement("paragraph");
  element.insert(0, [new Y.XmlText(text)]);
  return element;
}

/** A note carrying these blocks, created the way the editor creates one. */
function seedNote(...blocks: Y.XmlElement[]): NoteMeta {
  const notes = noteStore();
  const note = notes.create(now());
  const doc = new Y.Doc();
  doc.getXmlFragment("default").push(blocks);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  notes.appendUpdate(note.id, update, "Lista", now());
  return note;
}

/** Every active task of this profile, in the store's own placement order. */
function tasks(): Task[] {
  return new TaskStore(db.raw, profileId).listActive();
}

describe("countNoteChecklistItems", () => {
  it("counts only the rows that would become tasks", () => {
    const note = seedNote(list(item("Mleko", false), item("", false), item("Hleb", true)));
    expect(countNoteChecklistItems(noteStore(), note.id)).toBe(2);
  });

  it("counts nothing for a note with no checklist", () => {
    const note = seedNote(paragraph("Samo tekst."));
    expect(countNoteChecklistItems(noteStore(), note.id)).toBe(0);
  });

  it("refuses a note this profile cannot see", () => {
    const note = seedNote(list(item("Mleko", false)));
    noteStore().softDelete(note.id, now());
    expect(() => countNoteChecklistItems(noteStore(), note.id)).toThrow(NoteNotFoundError);
  });
});

describe("checklistToTasks", () => {
  it("writes one task per row, in document order, in the chosen list", () => {
    const note = seedNote(list(item("Mleko", false), item("Hleb", false), item("Kafa", false)));

    expect(checklistToTasks(makeDeps(), note.id, inboxId)).toEqual({
      created: 3,
      completed: 0,
      skipped: 0,
    });
    const rows = tasks();
    expect(rows.map((task) => task.title)).toEqual(["Mleko", "Hleb", "Kafa"]);
    expect(rows.every((task) => task.listId === inboxId && task.status === "todo")).toBe(true);
  });

  it("carries a ticked box across as a completed task, stamped", () => {
    const note = seedNote(list(item("Gotovo", true), item("Nije", false)));

    expect(checklistToTasks(makeDeps(), note.id, inboxId)).toEqual({
      created: 2,
      completed: 1,
      skipped: 0,
    });
    const [done, open] = tasks();
    expect(done?.status).toBe("done");
    expect(done?.done).toBe(true);
    expect(done?.completedAt).not.toBeNull();
    expect(open?.status).toBe("todo");
    expect(open?.completedAt).toBeNull();
  });

  it("makes an indented row a subtask of the row above it", () => {
    const note = seedNote(
      list(
        item("Roditelj", false, list(item("Prvo dete", false), item("Drugo dete", true))),
        item("Drugi roditelj", false),
      ),
    );

    expect(checklistToTasks(makeDeps(), note.id, inboxId)).toEqual({
      created: 4,
      completed: 1,
      skipped: 0,
    });
    const rows = tasks();
    const byTitle = new Map(rows.map((task) => [task.title, task]));
    expect(byTitle.get("Prvo dete")?.parentId).toBe(byTitle.get("Roditelj")?.id);
    expect(byTitle.get("Drugo dete")?.parentId).toBe(byTitle.get("Roditelj")?.id);
    expect(byTitle.get("Roditelj")?.parentId).toBeNull();
    expect(byTitle.get("Drugi roditelj")?.parentId).toBeNull();
  });

  it("flattens a row indented deeper than one level onto the same parent", () => {
    const note = seedNote(
      list(item("Roditelj", false, list(item("Dete", false, list(item("Unuk", false)))))),
    );

    checklistToTasks(makeDeps(), note.id, inboxId);
    const byTitle = new Map(tasks().map((task) => [task.title, task]));
    // `TaskStore` models one level of subtask, so the grandchild joins the
    // child's own parent rather than being lost.
    expect(byTitle.get("Unuk")?.parentId).toBe(byTitle.get("Roditelj")?.id);
  });

  it("skips a row with no text and says how many it skipped", () => {
    const note = seedNote(list(item("Mleko", false), item("", false), item("   ", true)));

    expect(checklistToTasks(makeDeps(), note.id, inboxId)).toEqual({
      created: 1,
      completed: 0,
      skipped: 2,
    });
    expect(tasks().map((task) => task.title)).toEqual(["Mleko"]);
  });

  it("promotes the children of a skipped blank row rather than reparenting them", () => {
    const note = seedNote(
      list(item("Mleko", false), item("", false, list(item("Siroče", false)))),
    );

    expect(checklistToTasks(makeDeps(), note.id, inboxId)).toEqual({
      created: 2,
      completed: 0,
      skipped: 1,
    });
    expect(tasks().find((task) => task.title === "Siroče")?.parentId).toBeNull();
  });

  it("finds a checklist nested inside a callout, and puts it in the named list", () => {
    const other = new TaskListStore(db.raw, profileId).createList(
      { name: "Kupovina", parentId: null },
      now(),
    );
    const callout = new Y.XmlElement("callout");
    callout.setAttribute("variant", "tip");
    callout.insert(0, [list(item("U okviru", false))]);
    const note = seedNote(callout);

    expect(checklistToTasks(makeDeps(), note.id, other.id).created).toBe(1);
    expect(tasks()[0]?.listId).toBe(other.id);
  });

  it("reports nothing done for a note with no checklist, and writes nothing", () => {
    const note = seedNote(paragraph("Samo tekst."));

    expect(checklistToTasks(makeDeps(), note.id, inboxId)).toEqual({
      created: 0,
      completed: 0,
      skipped: 0,
    });
    expect(tasks()).toEqual([]);
  });

  it("leaves the note itself untouched — the checklist stays where it is", () => {
    const note = seedNote(list(item("Mleko", false), item("Hleb", true)));
    const before = noteStore().readForCompaction(note.id);

    checklistToTasks(makeDeps(), note.id, inboxId);

    const after = noteStore().readForCompaction(note.id);
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.updates.length).toBe(before.updates.length);
  });

  it("refuses a list this profile does not have, writing nothing", () => {
    const note = seedNote(list(item("Mleko", false)));

    expect(() => checklistToTasks(makeDeps(), note.id, uuidv7())).toThrow(TaskValidationError);
    expect(tasks()).toEqual([]);
  });

  it("refuses an unknown list even when the note has nothing to convert", () => {
    const note = seedNote(paragraph("Samo tekst."));
    expect(() => checklistToTasks(makeDeps(), note.id, uuidv7())).toThrow(TaskValidationError);
  });

  it("refuses a note this profile cannot see", () => {
    const note = seedNote(list(item("Mleko", false)));
    noteStore().softDelete(note.id, now());

    expect(() => checklistToTasks(makeDeps(), note.id, inboxId)).toThrow(NoteNotFoundError);
    expect(tasks()).toEqual([]);
  });
});
