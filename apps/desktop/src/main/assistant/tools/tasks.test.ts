import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  NexusDatabase,
  TaskDependencyStore,
  TaskListStore,
  TaskStore,
  TaskTagStore,
  TaskTemplateStore,
  openDatabase,
  uuidv7,
} from "@nexus/db";
import type { Task } from "@nexus/db";
import type { AssistantLocale, ConfirmRequest, Tool, ToolContext, ToolResult } from "@nexus/core";
import { taskTools } from "./tasks.js";

/**
 * The TASK tools over a REAL database: every assertion here is about rows the
 * app's own store wrote, because that is the whole value of a tool — which task
 * landed where, with which due date, and what a refusal left behind.
 *
 * The clock is a fixed LOCAL instant rather than a UTC string: `tasks.list`'s
 * due windows are read off the local calendar (main's clock), so a fixture built
 * from local parts is the same day on any machine the suite runs on, while an
 * ISO string with a `Z` would move a day in some of them.
 */

/** 10 October 2026, 09:00 local — a Saturday, and the day every case below is „today" on. */
const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;
let inboxId: string;
let studyId: string;

/**
 * ONE database for the whole file, and a fresh PROFILE per case.
 *
 * Opening a migrated file costs more than every assertion below put together
 * (eighty-two migrations per open), and the suite's budget is wall-clock: a
 * profile id isolates one case from another just as well, because every store
 * this file touches is scoped by `profile_id`.
 */
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-tasks-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
  const lists = new TaskListStore(db.raw, profileId);
  inboxId = lists.ensureInbox(NOW_ISO).id;
  studyId = lists.createList({ name: "Fakultet" }, NOW_ISO).id;
});

function tools(): readonly Tool[] {
  return taskTools({ profileDb: (id, open) => open(db.raw, id), now: () => NOW_MS });
}

function toolOf(name: string): Tool {
  const found = tools().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

interface Recorder {
  readonly context: ToolContext;
  readonly confirms: ConfirmRequest[];
}

/** A tool context whose confirmation answers `allow`, remembering every request so a summary can be asserted word for word. */
function contextFor(locale: AssistantLocale, allow: boolean): Recorder {
  const confirms: ConfirmRequest[] = [];
  return {
    confirms,
    context: {
      profileId,
      locale,
      signal: new AbortController().signal,
      confirm: (request) => {
        confirms.push(request);
        return Promise.resolve(allow);
      },
    },
  };
}

/** A task written straight through the store, so a read has something true to read. */
function seedTask(fields: {
  title: string;
  dueDate?: string | null;
  status?: Task["status"];
  listId?: string;
}): Task {
  return new TaskStore(db.raw, profileId).create(
    {
      title: fields.title,
      dueDate: fields.dueDate ?? null,
      status: fields.status ?? "todo",
      listId: fields.listId ?? inboxId,
    },
    NOW_ISO,
  );
}

function allTasks(): readonly Task[] {
  return new TaskStore(db.raw, profileId).listActive();
}

describe("tasks.list", () => {
  it("lists every active task, open work first, then the nearest deadline, and undated last", async () => {
    const later = seedTask({ title: "Kupiti vodu", dueDate: "2026-10-14", listId: studyId });
    const undated = seedTask({ title: "Pozvati mamu", dueDate: null });
    const done = seedTask({ title: "Platiti račun", dueDate: "2026-10-01", status: "done" });

    const result = await toolOf("tasks.list").run({}, contextFor("sr", true).context);

    expect(result.ok).toBe(true);
    expect(result.content).toBe(
      [
        "Zadaci (3):",
        `- ${later.id} Kupiti vodu [todo, rok 14. oktobar 2026, lista Fakultet]`,
        `- ${undated.id} Pozvati mamu [todo, bez roka, lista Inbox]`,
        `- ${done.id} Platiti račun [done, rok 1. oktobar 2026, lista Inbox]`,
      ].join("\n"),
    );
    expect(result.citations?.map((citation) => citation.id)).toEqual([
      later.id,
      undated.id,
      done.id,
    ]);
  });

  it("narrows by status, by due window and by project", async () => {
    const overdue = seedTask({ title: "Kasni", dueDate: "2026-10-01" });
    const today = seedTask({ title: "Danas", dueDate: "2026-10-10" });
    const nextWeek = seedTask({ title: "Sledeće nedelje", dueDate: "2026-10-15" });
    seedTask({ title: "Bez roka", dueDate: null, listId: studyId });

    const overdueHits = await toolOf("tasks.list").run(
      { due: "overdue", status: "todo" },
      contextFor("en", true).context,
    );
    expect(overdueHits.content).toBe(
      ["Tasks (1):", `- ${overdue.id} Kasni [todo, due 1 October 2026, list Inbox]`].join("\n"),
    );

    const todayHits = await toolOf("tasks.list").run(
      { due: "today" },
      contextFor("en", true).context,
    );
    expect(todayHits.content).toContain(today.id);
    expect(todayHits.content).not.toContain(nextWeek.id);

    const weekHits = await toolOf("tasks.list").run(
      { due: "week" },
      contextFor("en", true).context,
    );
    expect(weekHits.content).toContain(nextWeek.id);
    expect(weekHits.content).not.toContain(overdue.id);

    const projectHits = await toolOf("tasks.list").run(
      { project: "Fakultet" },
      contextFor("en", true).context,
    );
    expect(projectHits.content).toMatch(/^Tasks \(1\):/);
    expect(projectHits.content).toContain("Bez roka");
  });

  it("reads „any“ as every list, the way status and due do", async () => {
    seedTask({ title: "Bilo šta" });
    const result = await toolOf("tasks.list").run(
      { status: "any", due: "any", project: "any" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(/^Tasks \(1\):/);
  });

  it("refuses a project nobody has, naming the ones the profile has", async () => {
    seedTask({ title: "Bilo šta" });
    const result = await toolOf("tasks.list").run(
      { project: "Nepostojeca" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toBe(
      'Failed: No list named “Nepostojeca”. This profile\'s lists: Inbox, Fakultet.',
    );
  });

  it("says so when the filter matches nothing", async () => {
    seedTask({ title: "Bilo šta" });
    const result = await toolOf("tasks.list").run(
      { due: "overdue" },
      contextFor("sr", true).context,
    );
    expect(result).toEqual({
      ok: true,
      content: "Nema zadataka koji odgovaraju filteru „overdue“.",
    });
  });

  it("refuses a due window that is not in the vocabulary", async () => {
    const result = await toolOf("tasks.list").run(
      { due: "yesterday" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain('"due" must be one of: any, overdue, today, week, none.');
  });
});

describe("tasks.create", () => {
  it("asks first, and writes the task the summary named", async () => {
    const recorder = contextFor("en", true);
    const result = await toolOf("tasks.create").run(
      { title: "Buy water", due: "2026-10-14", priority: "high", project: "Fakultet" },
      recorder.context,
    );

    expect(recorder.confirms).toEqual([
      {
        tool: "tasks.create",
        summary: "Create task “Buy water” — due 14 Oct",
        effect: "write",
      },
    ]);
    const written = allTasks();
    expect(written).toHaveLength(1);
    const task = written[0];
    if (task === undefined) throw new Error("no task was written");
    expect(task).toMatchObject({
      title: "Buy water",
      dueDate: "2026-10-14",
      priority: "high",
      status: "todo",
      listId: studyId,
    });
    expect(result).toEqual({
      ok: true,
      content: `Created task “Buy water” (${task.id}).`,
      citations: [
        {
          kind: "task",
          id: task.id,
          title: "Buy water",
          location: { module: "tasks", item: task.id },
        },
      ],
      navigateTo: { module: "tasks", item: task.id },
    });
  });

  it("asks in Serbian, naming the day the way a Serbian reader writes it", async () => {
    const recorder = contextFor("sr", true);
    await toolOf("tasks.create").run(
      { title: "Kupiti vodu", due: "2026-10-14" },
      recorder.context,
    );
    expect(recorder.confirms[0]?.summary).toBe("Napravi zadatak „Kupiti vodu“ — rok 14. okt");
  });

  it("changes nothing when the user declines", async () => {
    const recorder = contextFor("en", false);
    const result = await toolOf("tasks.create").run(
      { title: "Buy water" },
      recorder.context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(allTasks()).toEqual([]);
  });

  it("refuses an empty title before it asks anything", async () => {
    const recorder = contextFor("en", true);
    const result = await toolOf("tasks.create").run({ title: "  " }, recorder.context);
    expect(result.ok).toBe(false);
    expect(result.content).toBe('Failed: "title" must be a non-empty string.');
    expect(recorder.confirms).toEqual([]);
    expect(allTasks()).toEqual([]);
  });
});

describe("tasks.complete", () => {
  it("asks, then finishes the task", async () => {
    const task = seedTask({ title: "Kupiti vodu" });
    const recorder = contextFor("sr", true);
    const result = await toolOf("tasks.complete").run({ id: task.id }, recorder.context);

    expect(recorder.confirms[0]?.summary).toBe("Označi zadatak „Kupiti vodu“ kao završen");
    expect(result.ok).toBe(true);
    expect(allTasks()[0]?.status).toBe("done");
    expect(allTasks()[0]?.completedAt).toBe(NOW_ISO);
  });

  it("answers without asking when the task is already done", async () => {
    const task = seedTask({ title: "Kupiti vodu", status: "done" });
    const recorder = contextFor("en", true);
    const result = await toolOf("tasks.complete").run({ id: task.id }, recorder.context);
    expect(result).toEqual({
      ok: true,
      content: "The task “Kupiti vodu” is already done.",
      citations: [
        {
          kind: "task",
          id: task.id,
          title: "Kupiti vodu",
          location: { module: "tasks", item: task.id },
        },
      ],
    });
    expect(recorder.confirms).toEqual([]);
  });

  it("leaves the task alone when the user declines", async () => {
    const task = seedTask({ title: "Kupiti vodu" });
    const recorder = contextFor("en", false);
    const result = await toolOf("tasks.complete").run({ id: task.id }, recorder.context);
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(allTasks()[0]?.status).toBe("todo");
  });

  it("refuses an id this profile does not have", async () => {
    const result = await toolOf("tasks.complete").run(
      { id: uuidv7() },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toContain("No active task has the id");
  });
});

describe("tasks.reschedule", () => {
  it("moves the due date", async () => {
    const task = seedTask({ title: "Kupiti vodu", dueDate: "2026-10-14" });
    const recorder = contextFor("en", true);
    const result = await toolOf("tasks.reschedule").run(
      { id: task.id, due: "2026-10-20" },
      recorder.context,
    );
    expect(recorder.confirms[0]?.summary).toBe("Reschedule the task “Kupiti vodu” to 20 Oct");
    expect(result.ok).toBe(true);
    expect(allTasks()[0]?.dueDate).toBe("2026-10-20");
  });

  it("clears the due date when the model says null", async () => {
    const task = seedTask({ title: "Kupiti vodu", dueDate: "2026-10-14" });
    const recorder = contextFor("sr", true);
    const result = await toolOf("tasks.reschedule").run(
      { id: task.id, due: null },
      recorder.context,
    );
    expect(recorder.confirms[0]?.summary).toBe("Obriši rok zadatka „Kupiti vodu“");
    expect(result.ok).toBe(true);
    expect(allTasks()[0]?.dueDate).toBeNull();
  });

  it("changes nothing when the user declines", async () => {
    const task = seedTask({ title: "Kupiti vodu", dueDate: "2026-10-14" });
    const recorder = contextFor("en", false);
    const result: ToolResult = await toolOf("tasks.reschedule").run(
      { id: task.id, due: "2026-10-20" },
      recorder.context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(allTasks()[0]?.dueDate).toBe("2026-10-14");
  });

  it("refuses a due date that is not a real day", async () => {
    const task = seedTask({ title: "Kupiti vodu" });
    const result = await toolOf("tasks.reschedule").run(
      { id: task.id, due: "2026-02-30" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toBe('Failed: "due" must be a calendar day in YYYY-MM-DD form.');
  });
});

/** Runs one tool by name and returns what it answered and every confirmation it asked. */
async function call(
  name: string,
  args: Record<string, unknown>,
  locale: AssistantLocale = "en",
  allow = true,
): Promise<{ result: ToolResult; confirms: ConfirmRequest[] }> {
  const recorder = contextFor(locale, allow);
  const result = await toolOf(name).run(args, recorder.context);
  return { result, confirms: recorder.confirms };
}

function listsNow() {
  return new TaskListStore(db.raw, profileId).listActive();
}

function taskTitled(title: string): Task {
  const found = allTasks().find((task) => task.title === title);
  if (found === undefined) throw new Error(`Test setup: no task "${title}".`);
  return found;
}

describe("tasks.complete on a recurring task", () => {
  it("completes this occurrence and moves the task to its next due date", async () => {
    const series = seedRecurring({
      title: "Platiti struju",
      dueDate: "2026-10-14",
      recurrence: { freq: { kind: "monthly-date", interval: 1, day: 14 }, end: { kind: "never" } },
    });

    const { result, confirms } = await call("tasks.complete", { id: series.id }, "sr");

    expect(result.ok).toBe(true);
    expect(result.content).toContain("Završeno je ovo ponavljanje zadatka „Platiti struju“");
    expect(result.content).toContain("sledeći rok je");
    expect(confirms[0]?.summary).toBe("Završi ovo ponavljanje zadatka „Platiti struju“");
    const advanced = taskTitled("Platiti struju");
    expect(advanced.done).toBe(false);
    expect(advanced.dueDate).toBe("2026-11-14");
  });

  it("finishes the task when its rule has no occurrence left", async () => {
    const last = seedRecurring({
      title: "Poslednji račun",
      dueDate: "2026-10-14",
      recurrence: { freq: { kind: "monthly-date", interval: 1, day: 14 }, end: { kind: "count", total: 1 } },
    });

    const { result } = await call("tasks.complete", { id: last.id });

    expect(result.content).toBe(`Completed task “Poslednji račun” (${last.id}).`);
    expect(taskTitled("Poslednji račun").done).toBe(true);
  });
});

describe("tasks.create with the store's own fields", () => {
  it("makes a subtask that lands in its parent's list", async () => {
    const parent = seedTask({ title: "Predavanje", listId: studyId });

    const { result } = await call("tasks.create", { title: "Slajdovi", parent: "Predavanje" });

    expect(result.ok).toBe(true);
    const child = taskTitled("Slajdovi");
    expect(child.parentId).toBe(parent.id);
    expect(child.listId).toBe(studyId);
  });

  it("repeats weekly on the named days, with reminders, and says so before asking", async () => {
    const { result, confirms } = await call("tasks.create", {
      title: "Vežbe",
      due: "2026-10-12",
      repeat: { every: "week", weekdays: ["mon", "wed"] },
      remindDaysBefore: [3, 1],
    }, "sr");

    expect(result.ok).toBe(true);
    expect(confirms[0]?.summary).toContain("ponavlja se");
    expect(confirms[0]?.summary).toContain("podsetnik 3, 1 d. pre roka");
    const made = taskTitled("Vežbe");
    expect(made.recurrence).toEqual({ freq: { kind: "weekly", interval: 1, days: [0, 2] }, end: { kind: "never" } });
    expect(made.reminderOffsets).toEqual([1, 3]);
  });

  it("refuses a repeat with no due date, before it asks, and writes nothing", async () => {
    const { result, confirms } = await call("tasks.create", { title: "Bez roka", repeat: { every: "day" } });

    expect(result.ok).toBe(false);
    expect(result.content).toBe("Failed: A repeat needs a due date. Add the due date with the repeat.");
    expect(confirms).toEqual([]);
    expect(allTasks().some((task) => task.title === "Bez roka")).toBe(false);
  });

  it("refuses weekdays on a repeat that is not weekly", async () => {
    const { result } = await call("tasks.create", {
      title: "Dan",
      due: "2026-10-12",
      repeat: { every: "day", weekdays: ["mon"] },
    });

    expect(result.ok).toBe(false);
    expect(result.content).toBe("Failed: Weekdays apply only to a weekly repeat.");
  });

  it("refuses a title that two tasks share, naming both ids", async () => {
    const first = seedTask({ title: "Kupiti vodu" });
    const second = seedTask({ title: "Kupiti vodu", listId: studyId });

    const { result } = await call("tasks.complete", { id: "Kupiti vodu" });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("matches more than one item");
    expect(result.content).toContain(`${first.id} (Kupiti vodu)`);
    expect(result.content).toContain(`${second.id} (Kupiti vodu)`);
  });
});

describe("tasks.update", () => {
  it("changes only the fields named, and says which", async () => {
    seedTask({ title: "Kupiti mleko" });

    const { result, confirms } = await call("tasks.update", { id: "Kupiti mleko", priority: "high", title: "Kupiti mleko i hleb" });

    expect(result.ok).toBe(true);
    expect(confirms[0]?.summary).toBe("Change the task “Kupiti mleko” — title → “Kupiti mleko i hleb”, priority → high");
    expect(result.content).toContain("priority → high");
    const updated = taskTitled("Kupiti mleko i hleb");
    expect(updated.priority).toBe("high");
    expect(updated.status).toBe("todo");
  });

  it("clears a field on null and leaves an absent one alone", async () => {
    const withNote = new TaskStore(db.raw, profileId).create(
      { title: "Pozvati mamu", description: "Posle ručka", dueDate: "2026-10-14" },
      NOW_ISO,
    );

    const { result } = await call("tasks.update", { id: withNote.id, description: null });

    expect(result.ok).toBe(true);
    const after = taskTitled("Pozvati mamu");
    expect(after.description).toBeNull();
    expect(after.dueDate).toBe("2026-10-14");
  });

  it("changes nothing when the user declines", async () => {
    seedTask({ title: "Platiti račun" });

    const { result } = await call("tasks.update", { id: "Platiti račun", status: "doing" }, "en", false);

    expect(result.content).toBe("The user declined.");
    expect(taskTitled("Platiti račun").status).toBe("todo");
  });

  it("answers without asking when the values already hold", async () => {
    seedTask({ title: "Spavati" });

    const { result, confirms } = await call("tasks.update", { id: "Spavati", priority: "none" });

    expect(result.content).toBe(`The task “Spavati” (${taskTitled("Spavati").id}) already has those values; nothing changed.`);
    expect(confirms).toEqual([]);
  });

  it("refuses to clear the due date of a recurring task, and writes nothing", async () => {
    const series = seedRecurring({
      title: "Teretana",
      dueDate: "2026-10-14",
      recurrence: { freq: { kind: "daily", interval: 2 }, end: { kind: "never" } },
    });

    const { result } = await call("tasks.update", { id: series.id, due: null });

    expect(result.ok).toBe(false);
    expect(taskTitled("Teretana").dueDate).toBe("2026-10-14");
  });
});

describe("tasks.delete and tasks.restore", () => {
  it("soft-deletes one task, which restores by the id the deletion reported", async () => {
    const task = seedTask({ title: "Stari podsetnik" });

    const deleted = await call("tasks.delete", { id: task.id });
    expect(deleted.result.content).toBe(`Deleted task “Stari podsetnik” (${task.id}). It can be restored.`);
    expect(deleted.result.navigateTo).toEqual({ module: "tasks" });
    expect(allTasks().some((row) => row.id === task.id)).toBe(false);

    const restored = await call("tasks.restore", { id: task.id });
    expect(restored.result.ok).toBe(true);
    expect(restored.result.navigateTo).toEqual({ module: "tasks", item: task.id });
    expect(allTasks().some((row) => row.id === task.id)).toBe(true);
  });

  it("refuses an id this profile does not have", async () => {
    const { result } = await call("tasks.delete", { id: uuidv7() });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("No active task has the id or title");
  });
});

describe("tasks.project", () => {
  it("creates a list under another and renames it", async () => {
    const created = await call("tasks.project", { action: "create", name: "Ispiti", parent: "Fakultet" });
    expect(created.result.ok).toBe(true);
    const ispiti = listsNow().find((list) => list.name === "Ispiti");
    expect(ispiti?.parentId).toBe(studyId);

    const renamed = await call("tasks.project", { action: "rename", project: "Ispiti", name: "Rokovi" });
    expect(renamed.result.content).toBe(`The list “Ispiti” is now “Rokovi” (${ispiti?.id}).`);
    expect(listsNow().some((list) => list.name === "Rokovi")).toBe(true);
  });

  it("deletes a list and moves its tasks to the Inbox by default", async () => {
    seedTask({ title: "Vežbe za kolokvijum", listId: studyId });

    const { result } = await call("tasks.project", { action: "delete", project: "Fakultet" });

    expect(result.ok).toBe(true);
    expect(listsNow().some((list) => list.name === "Fakultet")).toBe(false);
    expect(taskTitled("Vežbe za kolokvijum").listId).toBe(inboxId);
  });

  it("names the task count when the delete takes the tasks with it", async () => {
    seedTask({ title: "Prvi", listId: studyId });
    seedTask({ title: "Drugi", listId: studyId });

    const { confirms } = await call("tasks.project", { action: "delete", project: "Fakultet", mode: "delete-tasks" });

    expect(confirms[0]?.summary).toBe("Delete the list “Fakultet” with its 2 tasks");
  });

  it("refuses to delete the Inbox", async () => {
    const { result } = await call("tasks.project", { action: "delete", project: "Inbox" });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("The Inbox cannot be deleted.");
  });

  it("adds, renames and deletes a section in a list", async () => {
    await call("tasks.project", { action: "section-add", project: "Fakultet", name: "Ispiti" });
    const section = new TaskListStore(db.raw, profileId).listSections(studyId).find((row) => row.name === "Ispiti");
    expect(section).toBeDefined();

    await call("tasks.project", { action: "section-rename", project: "Fakultet", section: "Ispiti", name: "Kolokvijumi" });
    expect(new TaskListStore(db.raw, profileId).listSections(studyId).map((row) => row.name)).toEqual(["Kolokvijumi"]);

    const removed = await call("tasks.project", { action: "section-delete", project: "Fakultet", section: "Kolokvijumi" });
    expect(removed.result.ok).toBe(true);
    expect(new TaskListStore(db.raw, profileId).listSections(studyId)).toEqual([]);
  });

  it("refuses a list name nobody has, naming the profile's lists", async () => {
    const { result } = await call("tasks.project", { action: "rename", project: "Nepostoji", name: "X" });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("No list named “Nepostoji”");
  });
});

describe("tasks.tag and tasks.tags", () => {
  it("attaches a tag that does not exist yet, detaches it and keeps the tag", async () => {
    const task = seedTask({ title: "Prijava ispita" });

    const attached = await call("tasks.tag", { action: "attach", task: "Prijava ispita", tag: "Hitno" }, "sr");
    expect(attached.result.content).toBe(`Zadatak „Prijava ispita“ (${task.id}) ima oznaku „Hitno“.`);
    const tag = new TaskTagStore(db.raw, profileId).listTags().find((row) => row.name === "Hitno");
    expect(tag).toBeDefined();

    const detached = await call("tasks.tag", { action: "detach", task: task.id, tag: "hitno" });
    expect(detached.result.ok).toBe(true);
    expect(new TaskTagStore(db.raw, profileId).listTagLinks()).toEqual([]);
    expect(new TaskTagStore(db.raw, profileId).listTags().map((row) => row.name)).toEqual(["Hitno"]);
  });

  it("renames and deletes a tag by its name", async () => {
    seedTask({ title: "Čitanje" });
    await call("tasks.tag", { action: "attach", task: "Čitanje", tag: "Lično" });

    const renamed = await call("tasks.tag", { action: "rename", tag: "lično", name: "Privatno" });
    expect(renamed.result.content).toBe(`The tag “Lično” is now “Privatno” (${new TaskTagStore(db.raw, profileId).listTags()[0]?.id}).`);

    const deleted = await call("tasks.tag", { action: "delete", tag: "Privatno" });
    expect(deleted.result.content).toBe("Deleted the tag “Privatno”.");
    expect(new TaskTagStore(db.raw, profileId).listTags()).toEqual([]);
  });

  it("lists the tags, or says there are none", async () => {
    const none = await call("tasks.tags", {});
    expect(none.result.content).toBe("This profile has no tags.");

    await call("tasks.tag", { action: "create", tag: "Fakultet" });
    const listed = await call("tasks.tags", {});
    expect(listed.result.content.split("\n")[0]).toBe("Tags (1):");
  });
});

describe("tasks.template", () => {
  it("saves a task with its subtasks and tags, and applies it to make the task again", async () => {
    const parent = seedTask({ title: "Predavanje", listId: studyId });
    new TaskStore(db.raw, profileId).create({ title: "Slajdovi", parentId: parent.id }, NOW_ISO);
    new TaskTagStore(db.raw, profileId).attachTag(parent.id, new TaskTagStore(db.raw, profileId).createTag("Fakultet", NOW_ISO).id);

    const saved = await call("tasks.template", { action: "save", template: "Nedeljni pregled", task: "Predavanje" });
    expect(saved.result.ok).toBe(true);
    expect(new TaskTemplateStore(db.raw, profileId).list()[0]?.payload.subtaskTitles).toEqual(["Slajdovi"]);

    const applied = await call("tasks.template", { action: "apply", template: "Nedeljni pregled", project: "Fakultet" });
    expect(applied.result.ok).toBe(true);
    const made = allTasks().filter((task) => task.title === "Predavanje");
    expect(made).toHaveLength(2);
    const fresh = made.find((task) => task.id !== parent.id);
    expect(fresh?.listId).toBe(studyId);
    expect(allTasks().filter((task) => task.parentId === fresh?.id).map((task) => task.title)).toEqual(["Slajdovi"]);
  });

  it("refuses an unknown template, naming the ones the profile has", async () => {
    const { result } = await call("tasks.template", { action: "apply", template: "Ništa" });

    expect(result.ok).toBe(false);
    expect(result.content).toBe("Failed: No template named “Ništa”. This profile's templates: none.");
  });
});

describe("tasks.depend", () => {
  it("makes one task wait on another, refuses a loop, and removes the wait", async () => {
    seedTask({ title: "Nacrt" });
    seedTask({ title: "Recenzija" });

    const added = await call("tasks.depend", { action: "add", task: "Recenzija", on: "Nacrt" });
    expect(added.result.content).toBe("The task “Recenzija” now waits on “Nacrt”.");
    const again = await call("tasks.depend", { action: "add", task: "Recenzija", on: "Nacrt" });
    expect(again.result.content).toBe("The task “Recenzija” already waits on “Nacrt”; nothing changed.");

    const loop = await call("tasks.depend", { action: "add", task: "Nacrt", on: "Recenzija" });
    expect(loop.result.ok).toBe(false);
    expect(loop.result.content).toContain("would close a cycle");

    const listed = await call("tasks.dependencies", {});
    expect(listed.result.content).toContain("waits on");

    const removed = await call("tasks.depend", { action: "remove", task: "Recenzija", on: "Nacrt" });
    expect(removed.result.content).toBe("The task “Recenzija” no longer waits on “Nacrt”.");
    expect(new TaskDependencyStore(db.raw, profileId).listLinks()).toEqual([]);
  });
});

describe("tasks.view", () => {
  it("opens a list as a board, and says so when it already does", async () => {
    const first = await call("tasks.view", { project: "Fakultet", view: "kanban" });
    expect(first.result.navigateTo).toEqual({ module: "tasks", item: studyId });
    expect(listsNow().find((list) => list.id === studyId)?.defaultView).toBe("kanban");

    const second = await call("tasks.view", { project: "Fakultet", view: "kanban" });
    expect(second.result.content).toBe("The list “Fakultet” already opens as: board (kanban); nothing changed.");
    expect(second.confirms).toHaveLength(0);
  });
});

describe("tasks.bulk", () => {
  it("moves a batch in one confirmation, and writes all of it", async () => {
    const first = seedTask({ title: "Prvi zadatak" });
    const second = seedTask({ title: "Drugi zadatak" });

    const { result, confirms } = await call(
      "tasks.bulk",
      { action: "move", ids: [first.id, second.id], project: "Fakultet" },
      "sr",
    );

    expect(result.content).toBe("Izmenjeno: 2 zadatka.");
    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.summary).toBe("Premesti 2 zadatka u listu „Fakultet“");
    expect(taskTitled("Prvi zadatak").listId).toBe(studyId);
    expect(taskTitled("Drugi zadatak").listId).toBe(studyId);
  });

  it("refuses the whole batch when one id is not an active task", async () => {
    const real = seedTask({ title: "Ostaje" });

    const { result } = await call("tasks.bulk", {
      action: "priority",
      ids: [real.id, uuidv7()],
      priority: "high",
    });

    expect(result.ok).toBe(false);
    expect(result.content).toContain("Nothing was changed.");
    expect(taskTitled("Ostaje").priority).toBe("none");
  });

  it("refuses a due change with no due argument, rather than clearing every date", async () => {
    const task = seedTask({ title: "Ne diraj", dueDate: "2026-10-14" });

    const { result } = await call("tasks.bulk", { action: "due", ids: [task.id] });

    expect(result.ok).toBe(false);
    expect(taskTitled("Ne diraj").dueDate).toBe("2026-10-14");
  });
});

/** A recurring task written straight through the store. */
function seedRecurring(fields: {
  title: string;
  dueDate: string;
  recurrence: NonNullable<Parameters<TaskStore["create"]>[0]["recurrence"]>;
}): Task {
  return new TaskStore(db.raw, profileId).create(
    { title: fields.title, dueDate: fields.dueDate, recurrence: fields.recurrence, listId: inboxId },
    NOW_ISO,
  );
}
