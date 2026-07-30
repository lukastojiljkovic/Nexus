import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_TASK_TAG_NAME_LENGTH,
  MAX_TASK_TEMPLATE_NAME_LENGTH,
  MAX_TASK_TEMPLATE_DUE_OFFSET_DAYS,
  MAX_TASK_TEMPLATE_SUBTASKS,
  MAX_TASK_TEMPLATE_TAGS,
  NexusDatabase,
  TaskTemplateNotFoundError,
  TaskTemplateStore,
  TaskTemplateValidationError,
  openDatabase,
  uuidv7,
} from "../index.js";
import type { TaskTemplatePayload } from "../index.js";

let dir: string;
let db: NexusDatabase;
let profileId: string;
let store: TaskTemplateStore;

const NOW = "2026-07-30T10:00:00.000Z";
const LATER = "2026-07-30T12:00:00.000Z";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-task-templates-"));
  db = openDatabase({ path: join(dir, "templates.db") });
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "P", NOW);
  store = new TaskTemplateStore(db.raw, profileId);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The minimum a payload can be: a title and nothing else set. */
function minimalPayload(overrides: Partial<TaskTemplatePayload> = {}): TaskTemplatePayload {
  return {
    title: "Nedeljni pregled",
    description: null,
    priority: "none",
    dueOffsetDays: null,
    reminderOffsets: [],
    recurrence: null,
    tagNames: [],
    subtaskTitles: [],
    ...overrides,
  };
}

/** Every field set to something non-default — what a full capture from a rich task looks like. */
function fullPayload(): TaskTemplatePayload {
  return {
    title: "Nedeljni pregled",
    description: "Prođi kroz sve liste",
    priority: "high",
    dueOffsetDays: 7,
    reminderOffsets: [0, 1],
    recurrence: { freq: { kind: "weekly", interval: 1, days: [1] }, end: { kind: "never" } },
    tagNames: ["posao", "važno"],
    subtaskTitles: ["Inbox na nulu", "Pregledaj kalendar"],
  };
}

describe("TaskTemplateStore — saveByName", () => {
  it("inserts a new template and returns it with a fresh id and both stamps", () => {
    const saved = store.saveByName("Nedeljni pregled", fullPayload(), NOW);

    expect(saved.id).not.toBe("");
    expect(saved.profileId).toBe(profileId);
    expect(saved.name).toBe("Nedeljni pregled");
    expect(saved.payload).toEqual(fullPayload());
    expect(saved.createdAt).toBe(NOW);
    expect(saved.updatedAt).toBe(NOW);
  });

  it("REPLACES an existing template of the same name, keeping its id and created_at", () => {
    const first = store.saveByName("Nedeljni pregled", fullPayload(), NOW);
    const second = store.saveByName(
      "Nedeljni pregled",
      minimalPayload({ title: "Drugi naslov" }),
      LATER,
    );

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(NOW);
    expect(second.updatedAt).toBe(LATER);
    expect(second.payload.title).toBe("Drugi naslov");
    expect(store.list()).toHaveLength(1);
  });

  it("trims the name, and matches an existing template by the TRIMMED name", () => {
    const first = store.saveByName("Nedeljni pregled", minimalPayload(), NOW);
    const second = store.saveByName("   Nedeljni pregled  ", minimalPayload(), LATER);

    expect(second.name).toBe("Nedeljni pregled");
    expect(second.id).toBe(first.id);
    expect(store.list()).toHaveLength(1);
  });

  it("refuses an empty or over-long name", () => {
    expect(() => store.saveByName("   ", minimalPayload(), NOW)).toThrow(TaskTemplateValidationError);
    expect(() =>
      store.saveByName("x".repeat(MAX_TASK_TEMPLATE_NAME_LENGTH + 1), minimalPayload(), NOW),
    ).toThrow(TaskTemplateValidationError);
    expect(() =>
      store.saveByName("x".repeat(MAX_TASK_TEMPLATE_NAME_LENGTH), minimalPayload(), NOW),
    ).not.toThrow();
  });

  it("refuses a `now` that is not an ISO-8601 date-time", () => {
    expect(() => store.saveByName("A", minimalPayload(), "2026-07-30")).toThrow(
      TaskTemplateValidationError,
    );
  });

  it("keeps templates of different profiles apart even under the same name", () => {
    const otherProfile = uuidv7();
    db.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(otherProfile, "personal", "Q", NOW);
    const other = new TaskTemplateStore(db.raw, otherProfile);

    store.saveByName("Isti naziv", minimalPayload({ title: "A" }), NOW);
    other.saveByName("Isti naziv", minimalPayload({ title: "B" }), NOW);

    expect(store.list().map((row) => row.payload.title)).toEqual(["A"]);
    expect(other.list().map((row) => row.payload.title)).toEqual(["B"]);
  });
});

describe("TaskTemplateStore — payload validation", () => {
  it("trims the title and refuses an empty one", () => {
    expect(store.saveByName("A", minimalPayload({ title: "  Naslov  " }), NOW).payload.title).toBe(
      "Naslov",
    );
    expect(() => store.saveByName("A", minimalPayload({ title: "   " }), NOW)).toThrow(
      TaskTemplateValidationError,
    );
  });

  it("collapses a blank description to null, exactly as TaskStore does", () => {
    expect(
      store.saveByName("A", minimalPayload({ description: "   " }), NOW).payload.description,
    ).toBeNull();
  });

  it("refuses a priority outside the closed set", () => {
    const bad = { ...minimalPayload(), priority: "urgent" };
    expect(() => store.saveByName("A", bad as unknown as TaskTemplatePayload, NOW)).toThrow(
      TaskTemplateValidationError,
    );
  });

  it("bounds dueOffsetDays to whole days within 0..365", () => {
    expect(() => store.saveByName("A", minimalPayload({ dueOffsetDays: 0 }), NOW)).not.toThrow();
    expect(() =>
      store.saveByName("B", minimalPayload({ dueOffsetDays: MAX_TASK_TEMPLATE_DUE_OFFSET_DAYS }), NOW),
    ).not.toThrow();
    expect(() => store.saveByName("C", minimalPayload({ dueOffsetDays: -1 }), NOW)).toThrow(
      TaskTemplateValidationError,
    );
    expect(() =>
      store.saveByName("D", minimalPayload({ dueOffsetDays: MAX_TASK_TEMPLATE_DUE_OFFSET_DAYS + 1 }), NOW),
    ).toThrow(TaskTemplateValidationError);
    expect(() => store.saveByName("E", minimalPayload({ dueOffsetDays: 1.5 }), NOW)).toThrow(
      TaskTemplateValidationError,
    );
  });

  it("canonicalizes the reminder ladder ascending and refuses duplicates or out-of-range days", () => {
    const saved = store.saveByName(
      "A",
      minimalPayload({ dueOffsetDays: 3, reminderOffsets: [7, 0, 1] }),
      NOW,
    );
    expect(saved.payload.reminderOffsets).toEqual([0, 1, 7]);

    expect(() =>
      store.saveByName("B", minimalPayload({ dueOffsetDays: 3, reminderOffsets: [1, 1] }), NOW),
    ).toThrow(TaskTemplateValidationError);
    expect(() =>
      store.saveByName("C", minimalPayload({ dueOffsetDays: 3, reminderOffsets: [366] }), NOW),
    ).toThrow(TaskTemplateValidationError);
  });

  it("refuses a reminder ladder with no dueOffsetDays to count back from", () => {
    expect(() =>
      store.saveByName("A", minimalPayload({ dueOffsetDays: null, reminderOffsets: [1] }), NOW),
    ).toThrow(TaskTemplateValidationError);
  });

  it("refuses a recurrence rule with no dueOffsetDays to phase from", () => {
    expect(() =>
      store.saveByName(
        "A",
        minimalPayload({
          dueOffsetDays: null,
          recurrence: { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } },
        }),
        NOW,
      ),
    ).toThrow(TaskTemplateValidationError);
  });

  it("refuses a recurrence rule the engine's own validator rejects", () => {
    const bad = {
      ...minimalPayload({ dueOffsetDays: 1 }),
      recurrence: { freq: { kind: "daily", interval: 0 }, end: { kind: "never" } },
    };
    expect(() => store.saveByName("A", bad as unknown as TaskTemplatePayload, NOW)).toThrow(
      TaskTemplateValidationError,
    );
  });

  it("trims, de-duplicates and bounds tag names", () => {
    const saved = store.saveByName(
      "A",
      minimalPayload({ tagNames: ["  posao ", "posao", "važno"] }),
      NOW,
    );
    expect(saved.payload.tagNames).toEqual(["posao", "važno"]);

    expect(() =>
      store.saveByName("B", minimalPayload({ tagNames: ["   "] }), NOW),
    ).toThrow(TaskTemplateValidationError);
    expect(() =>
      store.saveByName(
        "C",
        minimalPayload({ tagNames: ["x".repeat(MAX_TASK_TAG_NAME_LENGTH + 1)] }),
        NOW,
      ),
    ).toThrow(TaskTemplateValidationError);
    expect(() =>
      store.saveByName(
        "D",
        minimalPayload({
          tagNames: Array.from({ length: MAX_TASK_TEMPLATE_TAGS + 1 }, (_, i) => `t${i}`),
        }),
        NOW,
      ),
    ).toThrow(TaskTemplateValidationError);
  });

  it("trims subtask titles, refuses an empty one, and bounds how many there may be", () => {
    const saved = store.saveByName("A", minimalPayload({ subtaskTitles: ["  Prvi  "] }), NOW);
    expect(saved.payload.subtaskTitles).toEqual(["Prvi"]);

    expect(() => store.saveByName("B", minimalPayload({ subtaskTitles: ["  "] }), NOW)).toThrow(
      TaskTemplateValidationError,
    );
    expect(() =>
      store.saveByName(
        "C",
        minimalPayload({
          subtaskTitles: Array.from({ length: MAX_TASK_TEMPLATE_SUBTASKS + 1 }, (_, i) => `s${i}`),
        }),
        NOW,
      ),
    ).toThrow(TaskTemplateValidationError);
  });

  it("keeps two subtasks that happen to share a title — unlike tags, they are not a set", () => {
    const saved = store.saveByName(
      "A",
      minimalPayload({ subtaskTitles: ["Pozovi", "Pozovi"] }),
      NOW,
    );
    expect(saved.payload.subtaskTitles).toEqual(["Pozovi", "Pozovi"]);
  });
});

describe("TaskTemplateStore — list / get / delete", () => {
  it("lists this profile's templates and parses each payload back", () => {
    store.saveByName("B naziv", fullPayload(), NOW);
    store.saveByName("A naziv", minimalPayload(), NOW);

    const rows = store.list();
    expect(rows.map((row) => row.name)).toEqual(["A naziv", "B naziv"]);
    expect(rows[1]?.payload).toEqual(fullPayload());
  });

  it("gets one template by id", () => {
    const saved = store.saveByName("A", fullPayload(), NOW);
    expect(store.get(saved.id)).toEqual(saved);
  });

  it("refuses a get for an id in another profile", () => {
    const otherProfile = uuidv7();
    db.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(otherProfile, "personal", "Q", NOW);
    const saved = new TaskTemplateStore(db.raw, otherProfile).saveByName("A", minimalPayload(), NOW);

    expect(() => store.get(saved.id)).toThrow(TaskTemplateNotFoundError);
  });

  it("hard-deletes a template, and refuses to delete one twice", () => {
    const saved = store.saveByName("A", minimalPayload(), NOW);
    store.delete(saved.id);
    expect(store.list()).toEqual([]);
    expect(() => store.delete(saved.id)).toThrow(TaskTemplateNotFoundError);
  });

  it("reports a stored payload that no longer parses as corruption rather than coercing it", () => {
    const saved = store.saveByName("A", minimalPayload(), NOW);
    db.raw.prepare("UPDATE task_templates SET payload = ? WHERE id = ?").run("{not json", saved.id);

    expect(() => store.get(saved.id)).toThrow(TaskTemplateValidationError);
    expect(() => store.list()).toThrow(TaskTemplateValidationError);
  });

  it("reports a stored payload whose FIELDS are wrong as corruption too", () => {
    const saved = store.saveByName("A", minimalPayload(), NOW);
    db.raw
      .prepare("UPDATE task_templates SET payload = ? WHERE id = ?")
      .run('{"title":"x","priority":"urgent"}', saved.id);

    expect(() => store.get(saved.id)).toThrow(TaskTemplateValidationError);
  });
});
