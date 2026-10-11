import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NexusDatabase, TaskListStore, TaskStore, openDatabase, uuidv7 } from "@nexus/db";
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
