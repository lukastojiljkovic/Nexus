import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  buildExportArchive,
  countProfileModules,
  type ExportArchiveInput,
  type ExportNote,
  type ExportNoteAttachment,
  type ExportNoteFolder,
  type ExportTaskList,
  type ProfileData,
} from "./exportArchive.js";

/** The test's own sha256 hex — mirrors the shape `main` injects, kept out of `@nexus/core`. */
function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function emptyInput(): ExportArchiveInput {
  return {
    profile: { id: "profile1", name: "Luka" },
    appVersion: "0.1.0",
    createdAt: "2026-07-11T10:00:00.000Z",
    settings: {
      flags: { tasks: true, notes: false },
      notifications: { quietFrom: null, quietTo: null, morningHour: "08:00", enabledSources: ["document", "exam"] },
    },
    data: {
      tasks: [],
      taskLists: [],
      taskSections: [],
      taskTags: [],
      taskTagLinks: [],
      taskAttachments: [],
      taskTemplates: [],
      taskDependencies: [],
      events: [],
      documents: [],
      renewals: [],
      people: [],
      subjects: [],
      exams: [],
      decks: [],
      cards: [],
      reviewLog: [],
      plans: [],
      blocks: [],
      focusSessions: [],
      notifications: [],
      notes: [],
      noteFolders: [],
      noteTags: [],
      noteTagLinks: [],
      noteTemplates: [],
      noteAttachments: [],
      noteVersions: [],
      dashboardSettings: [],
      dashboardWidgets: [],
    },
    hash: sha256,
  };
}

/** The list and placement every task row below carries (TASK-004) — spelled once so a task fixture states only what its own test is about. */
const LIST_ID = "tl1";
const PLACED = { listId: LIST_ID, sectionId: null, position: 1024 } as const;

/** A minimal `ExportTaskList` row — the Inbox unless a test says otherwise. */
function taskListRow(overrides: {
  id: string;
  name: string;
  parentId?: string | null;
  isInbox?: boolean;
  defaultView?: string;
  position?: number;
}): ExportTaskList {
  return {
    id: overrides.id,
    profileId: "profile1",
    parentId: overrides.parentId ?? null,
    name: overrides.name,
    isInbox: overrides.isInbox ?? true,
    defaultView: overrides.defaultView ?? "list",
    position: overrides.position ?? 1024,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

/** A minimal `ExportNote` row, defaulting to an unfiled, never-edited note — override just the fields a test cares about. */
function noteRow(overrides: {
  id: string;
  title: string;
  folderId?: string | null;
  snapshot?: Uint8Array | null;
}): ExportNote {
  return {
    id: overrides.id,
    profileId: "profile1",
    title: overrides.title,
    folderId: overrides.folderId ?? null,
    pinned: false,
    cardDeckId: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    snapshot: overrides.snapshot ?? null,
  };
}

/** A minimal `ExportNoteFolder` row. */
function folderRow(overrides: {
  id: string;
  name: string;
  parentId?: string | null;
}): ExportNoteFolder {
  return {
    id: overrides.id,
    profileId: "profile1",
    parentId: overrides.parentId ?? null,
    name: overrides.name,
    color: null,
    defaultTemplateId: null,
    isCaptureDefault: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

/** A minimal `ExportNoteAttachment` row. */
function attachmentRow(overrides: {
  id: string;
  noteId: string;
  sha256: string;
  sizeBytes?: number;
}): ExportNoteAttachment {
  return {
    id: overrides.id,
    noteId: overrides.noteId,
    fileName: "slika.png",
    mime: "image/png",
    sizeBytes: overrides.sizeBytes ?? 10,
    sha256: overrides.sha256,
    createdAt: "2026-07-01T00:00:00.000Z",
  };
}

/**
 * A validly-encoded (empty) Yjs update — placeholder content for a test where
 * a note merely needs SOME non-null snapshot to exercise the "has been
 * edited" path. `renderNoteMarkdown` decodes it via `Y.applyUpdate`, so an
 * arbitrary byte array (e.g. `new Uint8Array([1, 2, 3])`) is not a valid
 * stand-in — it is not a real encoded Yjs update and fails to decode.
 */
function emptyNoteSnapshot(): Uint8Array {
  const doc = new Y.Doc();
  const snapshot = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return snapshot;
}

/** Encodes a doc whose "default" fragment holds a single `attachmentImage` node referencing `attachmentId`, as a note snapshot. */
function snapshotWithAttachmentImage(attachmentId: string): Uint8Array {
  const doc = new Y.Doc();
  const el = new Y.XmlElement("attachmentImage");
  el.setAttribute("attachmentId", attachmentId);
  doc.getXmlFragment("default").push([el]);
  const snapshot = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return snapshot;
}

function parseNdjson(content: string): unknown[] {
  if (content === "") return [];
  return content
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

describe("buildExportArchive", () => {
  describe("empty data", () => {
    it("still produces every file with the predictable empty shape", () => {
      const archive = buildExportArchive(emptyInput());

      expect([...archive.files.keys()].sort()).toEqual(
        [
          "manifest.json",
          "data/tasks.ndjson",
          "data/calendar.ndjson",
          "data/study.ndjson",
          "data/notifications.ndjson",
          "data/notes.ndjson",
          "data/dashboard.ndjson",
          "tables/tasks.csv",
          "tables/events.csv",
          "tables/documents.csv",
          "tables/subjects.csv",
          "tables/exams.csv",
          "tables/cards.csv",
          "tables/study-plans.csv",
          "tables/study-blocks.csv",
          "tables/focus-sessions.csv",
        ].sort(),
      );

      expect(archive.files.get("data/tasks.ndjson")).toBe("");
      expect(archive.files.get("data/calendar.ndjson")).toBe("");
      expect(archive.files.get("data/study.ndjson")).toBe("");
      expect(archive.files.get("data/notifications.ndjson")).toBe("");
      expect(archive.files.get("data/notes.ndjson")).toBe("");
      expect(archive.files.get("data/dashboard.ndjson")).toBe("");

      // CSV mirrors still carry their header row.
      expect(archive.files.get("tables/tasks.csv")).toMatch(/^id,/);
      expect(archive.files.get("tables/tasks.csv")?.split("\r\n")).toEqual(
        expect.arrayContaining([expect.stringMatching(/^id,/)]),
      );

      expect(archive.totalRecords).toBe(0);
      expect(archive.byModule).toEqual({
        tasks: 0, calendar: 0, study: 0, notifications: 0, notes: 0, dashboard: 0,
      });
      expect(archive.binaries).toEqual([]);
    });
  });

  describe("manifest.json", () => {
    it("carries schemaVersion, appVersion, createdAt, profile, settings, module counts and checksums", () => {
      const input = emptyInput();
      const archive = buildExportArchive(input);
      const manifest = JSON.parse(archive.files.get("manifest.json") ?? "") as Record<string, unknown>;

      expect(manifest.schemaVersion).toBe("1.11.0");
      expect(manifest.appVersion).toBe("0.1.0");
      expect(manifest.createdAt).toBe("2026-07-11T10:00:00.000Z");
      expect(manifest.profile).toEqual({ id: "profile1", name: "Luka" });
      expect(manifest.settings).toEqual({
        flags: { tasks: true, notes: false },
        notifications: { quietFrom: null, quietTo: null, morningHour: "08:00", enabledSources: ["document", "exam"] },
      });
      expect(manifest.modules).toEqual([
        { id: "tasks", records: 0 },
        { id: "calendar", records: 0 },
        { id: "study", records: 0 },
        { id: "notifications", records: 0 },
        { id: "notes", records: 0 },
        { id: "dashboard", records: 0 },
      ]);
      expect(manifest.checksums).toEqual({
        "data/tasks.ndjson": sha256(""),
        "data/calendar.ndjson": sha256(""),
        "data/study.ndjson": sha256(""),
        "data/notifications.ndjson": sha256(""),
        "data/notes.ndjson": sha256(""),
        "data/dashboard.ndjson": sha256(""),
      });
      expect(manifest.blobs).toEqual([]);
    });

    it("is pretty-printed (indented) JSON", () => {
      const archive = buildExportArchive(emptyInput());
      const raw = archive.files.get("manifest.json") ?? "";
      expect(raw).toContain("\n  ");
    });
  });

  describe("data/tasks.ndjson", () => {
    it("writes one type-discriminated line per task, fields in fixed order", () => {
      const input = emptyInput();
      input.data.tasks = [
        {
          id: "t1",
          profileId: "profile1",
          parentId: null,
          title: "Prvi zadatak",
          description: null,
          status: "todo",
          priority: "none",
          done: false,
          dueDate: null,
          startDate: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
          completedAt: null,
          recurrence: null,
          reminderOffsets: [],
          ...PLACED,
        },
      ];
      const archive = buildExportArchive(input);
      const rows = parseNdjson(archive.files.get("data/tasks.ndjson") ?? "");
      expect(rows).toEqual([
        {
          type: "task",
          id: "t1",
          profileId: "profile1",
          parentId: null,
          title: "Prvi zadatak",
          description: null,
          status: "todo",
          priority: "none",
          done: false,
          dueDate: null,
          startDate: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
          completedAt: null,
          recurrence: null,
          reminderOffsets: [],
          listId: LIST_ID,
          sectionId: null,
          position: 1024,
        },
      ]);
      expect(Object.keys(rows[0] as object)[0]).toBe("type");
      expect(archive.byModule.tasks).toBe(1);
      expect(archive.totalRecords).toBe(1);
    });

    it("writes lists and sections ahead of the tasks that reference them, and counts all three into byModule.tasks (TASK-004)", () => {
      const input = emptyInput();
      input.data.taskLists = [
        taskListRow({ id: LIST_ID, name: "Inbox" }),
        taskListRow({ id: "tl2", name: "Posao", isInbox: false, defaultView: "kanban", position: 2048 }),
      ];
      input.data.taskSections = [
        {
          id: "ts1",
          listId: "tl2",
          name: "U toku",
          position: 1024,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ];
      input.data.tasks = [
        {
          id: "t1", profileId: "profile1", parentId: null, title: "U sekciji", description: null,
          status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
          createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
          completedAt: null, recurrence: null, reminderOffsets: [],
          listId: "tl2", sectionId: "ts1", position: -1024,
        },
      ];

      const archive = buildExportArchive(input);
      const rows = parseNdjson(archive.files.get("data/tasks.ndjson") ?? "") as Array<{
        type: string;
        id: string;
      }>;
      expect(rows.map((row) => row.type)).toEqual([
        "task-list",
        "task-list",
        "task-section",
        "task",
      ]);
      expect(rows[0]).toEqual({
        type: "task-list",
        id: LIST_ID,
        profileId: "profile1",
        parentId: null,
        name: "Inbox",
        isInbox: true,
        defaultView: "list",
        position: 1024,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      });
      expect(rows[2]).toEqual({
        type: "task-section",
        id: "ts1",
        listId: "tl2",
        name: "U toku",
        position: 1024,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      });
      // A negative position is legitimate — prepending walks below zero — so it
      // travels verbatim rather than being normalized on the way out.
      expect(rows[3]).toMatchObject({ listId: "tl2", sectionId: "ts1", position: -1024 });
      expect(archive.byModule.tasks).toBe(4);
      expect(archive.totalRecords).toBe(4);
    });

    it("writes tags ahead of the tasks that carry them and links behind both, counting all of them into byModule.tasks (migration 023)", () => {
      const input = emptyInput();
      input.data.taskLists = [taskListRow({ id: LIST_ID, name: "Inbox" })];
      input.data.taskTags = [
        { id: "ttag1", profileId: "profile1", name: "posao", createdAt: "2026-07-01T00:00:00.000Z" },
      ];
      input.data.tasks = [
        {
          id: "t1", profileId: "profile1", parentId: null, title: "Označen", description: null,
          status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
          createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
          completedAt: null, recurrence: null, reminderOffsets: [], ...PLACED,
        },
      ];
      input.data.taskTagLinks = [{ taskId: "t1", tagId: "ttag1" }];

      const archive = buildExportArchive(input);
      const rows = parseNdjson(archive.files.get("data/tasks.ndjson") ?? "") as Array<{ type: string }>;
      // The join comes last: it is the one row that needs BOTH of the others.
      expect(rows.map((row) => row.type)).toEqual(["task-list", "task-tag", "task", "task-tag-link"]);
      expect(rows[1]).toEqual({
        type: "task-tag",
        id: "ttag1",
        profileId: "profile1",
        name: "posao",
        createdAt: "2026-07-01T00:00:00.000Z",
      });
      expect(rows[3]).toEqual({ type: "task-tag-link", taskId: "t1", tagId: "ttag1" });
      expect(archive.byModule.tasks).toBe(4);
      expect(archive.totalRecords).toBe(4);
    });

    it("writes task attachments behind their tasks, declares one blob entry each, and counts them into byModule.tasks (migration 024)", () => {
      const input = emptyInput();
      const sha = "f".repeat(64);
      input.data.taskLists = [taskListRow({ id: LIST_ID, name: "Inbox" })];
      input.data.tasks = [
        {
          id: "t1", profileId: "profile1", parentId: null, title: "Sa prilogom", description: null,
          status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
          createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
          completedAt: null, recurrence: null, reminderOffsets: [], ...PLACED,
        },
      ];
      input.data.taskAttachments = [
        {
          id: "tatt1", taskId: "t1", fileName: "ugovor.pdf", mime: "application/pdf",
          sizeBytes: 30, sha256: sha, createdAt: "2026-07-01T00:00:00.000Z",
        },
      ];

      const archive = buildExportArchive(input);
      const rows = parseNdjson(archive.files.get("data/tasks.ndjson") ?? "") as Array<{ type: string }>;
      expect(rows.map((row) => row.type)).toEqual(["task-list", "task", "task-attachment"]);
      expect(rows[2]).toEqual({
        type: "task-attachment",
        id: "tatt1",
        taskId: "t1",
        fileName: "ugovor.pdf",
        mime: "application/pdf",
        sizeBytes: 30,
        sha256: sha,
        createdAt: "2026-07-01T00:00:00.000Z",
      });
      expect(archive.binaries).toEqual([
        { kind: "attachment", path: `blobs/${sha}`, sha256: sha, sizeBytes: 30 },
      ]);
      expect(archive.byModule.tasks).toBe(3);
      expect(archive.totalRecords).toBe(3);
    });

    // One `blobs/` namespace over one on-disk store: a file attached to both a
    // note and a task must travel exactly once, or the zip would carry the same
    // bytes twice under the same path.
    it("declares ONE blob entry for a hash a note attachment and a task attachment share", () => {
      const input = emptyInput();
      const sha = "e".repeat(64);
      input.data.notes = [noteRow({ id: "n1", title: "Beleška" })];
      input.data.noteAttachments = [attachmentRow({ id: "natt1", noteId: "n1", sha256: sha, sizeBytes: 10 })];
      input.data.taskLists = [taskListRow({ id: LIST_ID, name: "Inbox" })];
      input.data.tasks = [
        {
          id: "t1", profileId: "profile1", parentId: null, title: "Isti fajl", description: null,
          status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
          createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
          completedAt: null, recurrence: null, reminderOffsets: [], ...PLACED,
        },
      ];
      input.data.taskAttachments = [
        {
          id: "tatt1", taskId: "t1", fileName: "slika.png", mime: "image/png",
          sizeBytes: 10, sha256: sha, createdAt: "2026-07-01T00:00:00.000Z",
        },
      ];

      const archive = buildExportArchive(input);
      expect(archive.binaries.filter((entry) => entry.kind === "attachment")).toEqual([
        { kind: "attachment", path: `blobs/${sha}`, sha256: sha, sizeBytes: 10 },
      ]);
      const manifest = JSON.parse(archive.files.get("manifest.json") ?? "") as { blobs: unknown };
      expect(manifest.blobs).toEqual([{ sha256: sha, sizeBytes: 10 }]);
    });

    it("writes dependency edges last of all and counts them into byModule.tasks (migration 029 / ADR-037)", () => {
      const input = emptyInput();
      input.data.taskLists = [taskListRow({ id: LIST_ID, name: "Inbox" })];
      const base = {
        profileId: "profile1", parentId: null, description: null, status: "todo" as const,
        priority: "none" as const, done: false, dueDate: null, startDate: null,
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
        completedAt: null, recurrence: null, reminderOffsets: [], ...PLACED,
      };
      input.data.tasks = [
        { ...base, id: "t1", title: "Prvo" },
        { ...base, id: "t2", title: "Drugo" },
      ];
      input.data.taskDependencies = [{ blockerId: "t1", blockedId: "t2" }];

      const archive = buildExportArchive(input);
      const rows = parseNdjson(archive.files.get("data/tasks.ndjson") ?? "") as Array<{ type: string }>;
      // Both joins need BOTH ends resolved, so both come after the tasks.
      expect(rows.map((row) => row.type)).toEqual(["task-list", "task", "task", "task-dependency"]);
      expect(rows[3]).toEqual({ type: "task-dependency", blockerId: "t1", blockedId: "t2" });
      expect(archive.byModule.tasks).toBe(4);
      expect(archive.totalRecords).toBe(4);
    });

    it("carries a recurring task's whole rule (ADR-024)", () => {
      const input = emptyInput();
      input.data.tasks = [
        {
          id: "t1", profileId: "profile1", parentId: null, title: "Ponedeljkom", description: null,
          status: "todo", priority: "none", done: false, dueDate: "2026-07-13", startDate: null,
          createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
          completedAt: null,
          recurrence: { freq: { kind: "weekly", interval: 1, days: [0] }, end: { kind: "count", total: 10 } },
          reminderOffsets: [], ...PLACED,
        },
      ];
      const archive = buildExportArchive(input);
      const rows = parseNdjson(archive.files.get("data/tasks.ndjson") ?? "") as Array<{
        recurrence: unknown;
      }>;
      expect(rows[0]?.recurrence).toEqual({
        freq: { kind: "weekly", interval: 1, days: [0] },
        end: { kind: "count", total: 10 },
      });
    });

    it("carries a task's reminder ladder (ADR-028)", () => {
      const input = emptyInput();
      input.data.tasks = [
        {
          id: "t1", profileId: "profile1", parentId: null, title: "Prijava ispita", description: null,
          status: "todo", priority: "none", done: false, dueDate: "2026-08-10", startDate: null,
          createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
          completedAt: null, recurrence: null, reminderOffsets: [0, 3, 7], ...PLACED,
        },
      ];
      const archive = buildExportArchive(input);
      const rows = parseNdjson(archive.files.get("data/tasks.ndjson") ?? "") as Array<{
        reminderOffsets: unknown;
      }>;
      expect(rows[0]?.reminderOffsets).toEqual([0, 3, 7]);
    });
  });

  describe("data/calendar.ndjson", () => {
    it("interleaves events, documents, renewals and people as type-discriminated records, in that order", () => {
      const input = emptyInput();
      input.data.events = [
        {
          id: "e1",
          profileId: "profile1",
          title: "Sastanak",
          description: null,
          startAt: "2026-07-11T10:00:00.000Z",
          endAt: null,
          allDay: false,
          location: null,
          category: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
          recurrence: { freq: { kind: "weekly", interval: 1, days: [5] }, end: { kind: "never" } },
          recurrenceExdates: ["2026-07-18"],
          reminderOffsets: [15, 1440],
        },
      ];
      input.data.documents = [
        {
          id: "d1",
          profileId: "profile1",
          docType: "licna_karta",
          label: "Lična karta",
          expiryDate: "2030-01-01",
          reminderOffsets: [90, 30, 7],
          notes: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ];
      input.data.renewals = [
        { id: "r1", documentId: "d1", previousExpiry: "2020-01-01", renewedAt: "2026-01-01T00:00:00.000Z" },
      ];
      input.data.people = [
        {
          id: "pe1",
          profileId: "profile1",
          name: "Marko",
          kind: "birthday",
          month: 3,
          day: 14,
          year: 1990,
          note: null,
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ];

      const archive = buildExportArchive(input);
      const rows = parseNdjson(archive.files.get("data/calendar.ndjson") ?? "") as Array<{
        type: string;
        recurrence?: unknown;
        recurrenceExdates?: unknown;
        reminderOffsets?: unknown;
      }>;
      expect(rows.map((row) => row.type)).toEqual(["event", "document", "renewal", "person"]);
      expect(archive.byModule.calendar).toBe(4);
      // The yearless recurring fact travels as its two integers (ADR-026).
      expect(rows[3]).toEqual({
        type: "person",
        id: "pe1",
        profileId: "profile1",
        name: "Marko",
        kind: "birthday",
        month: 3,
        day: 14,
        year: 1990,
        note: null,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      });
      // A series master travels with both halves of its recurrence (ADR-024).
      expect(rows[0]?.recurrence).toEqual({
        freq: { kind: "weekly", interval: 1, days: [5] },
        end: { kind: "never" },
      });
      expect(rows[0]?.recurrenceExdates).toEqual(["2026-07-18"]);
      // ...and with its reminder ladder (CAL-006).
      expect(rows[0]?.reminderOffsets).toEqual([15, 1440]);
    });
  });

  describe("data/study.ndjson", () => {
    it("orders subject, exam, deck, card, review, plan, block, focus-session records", () => {
      const input = emptyInput();
      input.data.subjects = [
        {
          id: "s1", profileId: "profile1", name: "Analiza", color: "jade", semester: null,
          archived: false, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ];
      input.data.exams = [
        {
          id: "ex1", profileId: "profile1", subjectId: "s1", examType: "pismeni", examDate: "2026-08-01",
          scope: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ];
      input.data.decks = [
        { id: "dk1", profileId: "profile1", subjectId: "s1", name: "Glava 1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      ];
      input.data.cards = [
        {
          id: "c1", profileId: "profile1", deckId: "dk1", front: "Q", back: "A",
          sourceNoteId: null, sourceBlockKey: null, due: "2026-01-02T00:00:00.000Z",
          stability: 1, difficulty: 2, elapsedDays: 0, scheduledDays: 1, learningSteps: 0, reps: 0, lapses: 0,
          state: 0, lastReview: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ];
      input.data.reviewLog = [
        {
          id: "rl1", profileId: "profile1", cardId: "c1", rating: 3, state: 2, due: "2026-01-03T00:00:00.000Z",
          stability: 1, difficulty: 2, elapsedDays: 1, lastElapsedDays: 0, scheduledDays: 1, learningSteps: 0,
          review: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-02T00:00:00.000Z",
        },
      ];
      input.data.plans = [
        {
          id: "p1", profileId: "profile1", examId: "ex1", dailyMinutes: 60, startDate: "2026-07-01",
          examWeekBoost: true, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ];
      input.data.blocks = [
        {
          id: "b1", planId: "p1", profileId: "profile1", blockDate: "2026-07-02", minutes: 60,
          status: "planned", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ];
      input.data.focusSessions = [
        {
          id: "f1", profileId: "profile1", subjectId: "s1", startedAt: "2026-07-01T10:00:00.000Z",
          endedAt: "2026-07-01T11:00:00.000Z", createdAt: "2026-07-01T11:00:00.000Z", updatedAt: "2026-07-01T11:00:00.000Z",
        },
      ];

      const archive = buildExportArchive(input);
      const rows = parseNdjson(archive.files.get("data/study.ndjson") ?? "") as Array<{ type: string }>;
      expect(rows.map((row) => row.type)).toEqual([
        "subject", "exam", "deck", "card", "review", "plan", "block", "focus-session",
      ]);
      expect(archive.byModule.study).toBe(8);
    });
  });

  describe("data/notifications.ndjson", () => {
    it("writes one type-discriminated line per ledger row", () => {
      const input = emptyInput();
      input.data.notifications = [
        {
          id: "n1", profileId: "profile1", source: "exam", entityId: "ex1", occurrenceKey: "d-1",
          title: "Ispit sutra", body: "Analiza — pismeni", status: "delivered", snoozedUntil: null,
          deliveredAt: "2026-07-10T08:00:00.000Z", createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z",
        },
      ];
      const archive = buildExportArchive(input);
      const rows = parseNdjson(archive.files.get("data/notifications.ndjson") ?? "");
      expect(rows).toEqual([{ type: "notification", ...input.data.notifications[0] }]);
      expect(archive.byModule.notifications).toBe(1);
    });
  });

  describe("tables/*.csv", () => {
    it("mirrors tasks with a header row and matching field values", () => {
      const input = emptyInput();
      input.data.tasks = [
        {
          id: "t1", profileId: "profile1", parentId: null, title: "Sa, zarezom", description: null,
          status: "todo", priority: "high", done: false, dueDate: "2026-07-20", startDate: null,
          createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", completedAt: null,
          recurrence: null, reminderOffsets: [], ...PLACED,
        },
      ];
      const archive = buildExportArchive(input);
      const csv = archive.files.get("tables/tasks.csv") ?? "";
      const lines = csv.split("\r\n").filter((l) => l.length > 0);
      expect(lines[0]).toBe("id,parentId,title,description,status,priority,dueDate,startDate,completedAt,createdAt,updatedAt");
      expect(lines[1]).toBe('t1,,"Sa, zarezom",,todo,high,2026-07-20,,,2026-07-01T00:00:00.000Z,2026-07-01T00:00:00.000Z');
    });

    it("mirrors cards with front/back/state columns only, no FSRS internals", () => {
      const input = emptyInput();
      input.data.cards = [
        {
          id: "c1", profileId: "profile1", deckId: "dk1", front: "Q", back: "A",
          sourceNoteId: null, sourceBlockKey: null, due: "2026-01-02T00:00:00.000Z",
          stability: 1.2345, difficulty: 2, elapsedDays: 0, scheduledDays: 1, learningSteps: 0, reps: 0, lapses: 0,
          state: 0, lastReview: null, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ];
      const archive = buildExportArchive(input);
      const csv = archive.files.get("tables/cards.csv") ?? "";
      expect(csv).not.toContain("1.2345"); // stability is a FSRS internal, excluded
      expect(csv.split("\r\n")[0]).toBe("id,deckId,front,back,state,due,createdAt,updatedAt");
    });

    it("joins a document's reminderOffsets with semicolons", () => {
      const input = emptyInput();
      input.data.documents = [
        {
          id: "d1", profileId: "profile1", docType: "kartica", label: "Kartica", expiryDate: "2030-01-01",
          reminderOffsets: [30, 7], notes: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ];
      const archive = buildExportArchive(input);
      const csv = archive.files.get("tables/documents.csv") ?? "";
      expect(csv).toContain("30;7");
    });
  });

  describe("counts", () => {
    it("sums byModule into totalRecords", () => {
      const input = emptyInput();
      input.data.tasks = [
        {
          id: "t1", profileId: "profile1", parentId: null, title: "A", description: null, status: "todo",
          priority: "none", done: false, dueDate: null, startDate: null,
          createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", completedAt: null,
          recurrence: null, reminderOffsets: [], ...PLACED,
        },
      ];
      input.data.notifications = [
        {
          id: "n1", profileId: "profile1", source: "exam", entityId: "ex1", occurrenceKey: "d-1",
          title: "T", body: "B", status: "delivered", snoozedUntil: null,
          deliveredAt: "2026-07-10T08:00:00.000Z", createdAt: "2026-07-10T08:00:00.000Z", updatedAt: "2026-07-10T08:00:00.000Z",
        },
      ];
      const archive = buildExportArchive(input);
      expect(archive.byModule).toEqual({
        tasks: 1, calendar: 0, study: 0, notifications: 1, notes: 0, dashboard: 0,
      });
      expect(archive.totalRecords).toBe(2);
    });
  });

  describe("countProfileModules", () => {
    /**
     * One row in every one of `ProfileData`'s arrays, so each of the six
     * buckets sums more than one field. Two TASKS rather than one, because a
     * dependency needs both of its ends to be real rows — a fixture whose edge
     * dangled would be counting something the exporter could never write.
     */
    function populatedData(): ProfileData {
      const t = "2026-01-01T00:00:00.000Z";
      return {
        tasks: [
          { id: "t1", profileId: "p1", parentId: null, title: "T", description: null, status: "todo", priority: "none", done: false, dueDate: null, startDate: null, createdAt: t, updatedAt: t, completedAt: null, recurrence: null, reminderOffsets: [], listId: "tl1", sectionId: "ts1", position: 1024 },
          { id: "t2", profileId: "p1", parentId: null, title: "T2", description: null, status: "todo", priority: "none", done: false, dueDate: null, startDate: null, createdAt: t, updatedAt: t, completedAt: null, recurrence: null, reminderOffsets: [], listId: "tl1", sectionId: "ts1", position: 2048 },
        ],
        taskLists: [
          { id: "tl1", profileId: "p1", parentId: null, name: "Inbox", isInbox: true, defaultView: "list", position: 1024, createdAt: t, updatedAt: t },
        ],
        taskSections: [{ id: "ts1", listId: "tl1", name: "Danas", position: 1024, createdAt: t, updatedAt: t }],
        taskTags: [{ id: "ttag1", profileId: "p1", name: "posao", createdAt: t }],
        taskTagLinks: [{ taskId: "t1", tagId: "ttag1" }],
        taskAttachments: [
          { id: "tatt1", taskId: "t1", fileName: "ugovor.pdf", mime: "application/pdf", sizeBytes: 30, sha256: "f".repeat(64), createdAt: t },
        ],
        taskTemplates: [
          {
            id: "ttpl1", profileId: "p1", name: "Šablon", createdAt: t, updatedAt: t,
            payload: {
              title: "T", description: null, priority: "none", dueOffsetDays: null,
              reminderOffsets: [], recurrence: null, tagNames: [], subtaskTitles: [],
            },
          },
        ],
        taskDependencies: [{ blockerId: "t1", blockedId: "t2" }],
        events: [
          { id: "e1", profileId: "p1", title: "E", description: null, startAt: t, endAt: null, allDay: false, location: null, category: null, createdAt: t, updatedAt: t, recurrence: null, recurrenceExdates: [], reminderOffsets: [] },
        ],
        documents: [
          { id: "d1", profileId: "p1", docType: "licna_karta", label: "D", expiryDate: "2030-01-01", reminderOffsets: [], notes: null, createdAt: t, updatedAt: t },
        ],
        renewals: [{ id: "r1", documentId: "d1", previousExpiry: "2020-01-01", renewedAt: t }],
        people: [
          { id: "pe1", profileId: "p1", name: "Marko", kind: "birthday", month: 3, day: 14, year: 1990, note: null, createdAt: t, updatedAt: t },
        ],
        subjects: [
          { id: "s1", profileId: "p1", name: "S", color: "jade", semester: null, archived: false, createdAt: t, updatedAt: t },
        ],
        exams: [
          { id: "ex1", profileId: "p1", subjectId: "s1", examType: "pismeni", examDate: "2030-01-01", scope: null, createdAt: t, updatedAt: t },
        ],
        decks: [{ id: "dk1", profileId: "p1", subjectId: "s1", name: "Dk", createdAt: t, updatedAt: t }],
        cards: [
          {
            id: "c1", profileId: "p1", deckId: "dk1", front: "Q", back: "A", sourceNoteId: null, sourceBlockKey: null,
            due: t, stability: 1, difficulty: 2, elapsedDays: 0, scheduledDays: 1, learningSteps: 0, reps: 0, lapses: 0,
            state: 0, lastReview: null, createdAt: t, updatedAt: t,
          },
        ],
        reviewLog: [
          {
            id: "rl1", profileId: "p1", cardId: "c1", rating: 3, state: 2, due: t, stability: 1, difficulty: 2,
            elapsedDays: 1, lastElapsedDays: 0, scheduledDays: 1, learningSteps: 0, review: t, createdAt: t,
          },
        ],
        plans: [
          { id: "pl1", profileId: "p1", examId: "ex1", dailyMinutes: 30, startDate: "2026-01-01", examWeekBoost: false, createdAt: t, updatedAt: t },
        ],
        blocks: [
          { id: "b1", planId: "pl1", profileId: "p1", blockDate: "2026-01-02", minutes: 30, status: "planned", createdAt: t, updatedAt: t },
        ],
        focusSessions: [
          { id: "f1", profileId: "p1", subjectId: "s1", startedAt: t, endedAt: t, createdAt: t, updatedAt: t },
        ],
        notifications: [
          {
            id: "n1", profileId: "p1", source: "exam", entityId: "ex1", occurrenceKey: "occ", title: "T", body: "B",
            status: "delivered", snoozedUntil: null, deliveredAt: t, createdAt: t, updatedAt: t,
          },
        ],
        notes: [noteRow({ id: "note1", title: "N" })],
        noteFolders: [folderRow({ id: "f1", name: "F" })],
        noteTags: [{ id: "tag1", profileId: "p1", name: "Tag", createdAt: t }],
        noteTagLinks: [{ noteId: "note1", tagId: "tag1" }],
        noteTemplates: [
          { id: "tmpl1", profileId: "p1", name: "Tmpl", content: '{"type":"doc","content":[]}', createdAt: t, updatedAt: t },
        ],
        noteAttachments: [attachmentRow({ id: "att1", noteId: "note1", sha256: "e".repeat(64) })],
        noteVersions: [
          { noteId: "note1", coveredSeq: 1, title: "N", createdAt: t, snapshot: new Uint8Array([1]) },
        ],
        dashboardSettings: [
          {
            profileId: "p1", backgroundHash: "f".repeat(64), backgroundMime: "image/png",
            backgroundSizeBytes: 32, backgroundDim: 40,
          },
        ],
        dashboardWidgets: [
          {
            instanceId: "dw1", profileId: "p1", widgetId: "calendar:danas", size: "M",
            position: 1024, config: null, createdAt: t, updatedAt: t,
          },
        ],
      };
    }

    it("groups exactly as the manifest does, field by field", () => {
      const data = populatedData();
      expect(countProfileModules(data)).toEqual({
        tasks: 9, // 2 tasks + 1 list + 1 section + 1 tag + 1 tag link + 1 attachment + 1 template + 1 dependency
        calendar: 4, // 1 event + 1 document + 1 renewal + 1 person
        study: 8, // 1 each of subject/exam/deck/card/review/plan/block/focus-session
        notifications: 1,
        notes: 7, // 1 each of note/folder/tag/tag-link/template/attachment/version
        dashboard: 2, // the one settings row a profile can ever have + 1 placed widget
      });
    });

    it("agrees with buildExportArchive's own byModule for the same data", () => {
      const input = emptyInput();
      input.data = populatedData();
      const archive = buildExportArchive(input);
      expect(archive.byModule).toEqual(countProfileModules(input.data));
    });

    it("counts every bucket as zero for empty data", () => {
      expect(countProfileModules(emptyInput().data)).toEqual({
        tasks: 0, calendar: 0, study: 0, notifications: 0, notes: 0, dashboard: 0,
      });
    });
  });

  describe("data/dashboard.ndjson (SET-006 / ADR-041)", () => {
    const HASH = "d".repeat(64);

    it("writes the settings row as one type-discriminated line and counts it into byModule.dashboard", () => {
      const input = emptyInput();
      input.data.dashboardSettings = [
        {
          profileId: "profile1", backgroundHash: HASH, backgroundMime: "image/jpeg",
          backgroundSizeBytes: 4096, backgroundDim: 65,
        },
      ];
      const archive = buildExportArchive(input);

      expect(parseNdjson(archive.files.get("data/dashboard.ndjson") ?? "")).toEqual([
        {
          type: "dashboard-settings", profileId: "profile1", backgroundHash: HASH,
          backgroundMime: "image/jpeg", backgroundSizeBytes: 4096, backgroundDim: 65,
        },
      ]);
      expect(archive.byModule.dashboard).toBe(1);
      expect(archive.totalRecords).toBe(1);
    });

    it("declares the background in the same blobs/ union an attachment uses", () => {
      const input = emptyInput();
      input.data.dashboardSettings = [
        {
          profileId: "profile1", backgroundHash: HASH, backgroundMime: "image/png",
          backgroundSizeBytes: 4096, backgroundDim: 40,
        },
      ];
      const archive = buildExportArchive(input);

      expect(archive.binaries).toEqual([
        { kind: "attachment", path: `blobs/${HASH}`, sha256: HASH, sizeBytes: 4096 },
      ]);
      const manifest = JSON.parse(archive.files.get("manifest.json") ?? "") as {
        blobs: { sha256: string; sizeBytes: number }[];
      };
      expect(manifest.blobs).toEqual([{ sha256: HASH, sizeBytes: 4096 }]);
    });

    // Content-addressed means content-addressed: a background the user also
    // attached to a note is ONE file in the archive, declared once.
    it("declares a hash shared with an attachment exactly once", () => {
      const input = emptyInput();
      input.data.notes = [noteRow({ id: "note1", title: "N" })];
      input.data.noteAttachments = [attachmentRow({ id: "att1", noteId: "note1", sha256: HASH })];
      input.data.dashboardSettings = [
        {
          profileId: "profile1", backgroundHash: HASH, backgroundMime: "image/png",
          backgroundSizeBytes: 10, backgroundDim: 40,
        },
      ];
      const archive = buildExportArchive(input);

      expect(archive.binaries.filter((entry) => entry.path === `blobs/${HASH}`)).toHaveLength(1);
    });

    it("declares no blob for a profile that chose no background", () => {
      const input = emptyInput();
      input.data.dashboardSettings = [
        {
          profileId: "profile1", backgroundHash: null, backgroundMime: null,
          backgroundSizeBytes: null, backgroundDim: 20,
        },
      ];
      const archive = buildExportArchive(input);
      expect(archive.binaries).toEqual([]);
      expect(archive.byModule.dashboard).toBe(1);
    });

    // The layout (DASH-002 / ADR-045) rides the same file, after the settings
    // row — the two share a module and reference each other not at all.
    it("writes the layout after the settings row, one type-discriminated line each", () => {
      const input = emptyInput();
      const t = "2026-07-31T09:00:00.000Z";
      input.data.dashboardSettings = [
        {
          profileId: "profile1", backgroundHash: null, backgroundMime: null,
          backgroundSizeBytes: null, backgroundDim: 40,
        },
      ];
      input.data.dashboardWidgets = [
        {
          instanceId: "dw1", profileId: "profile1", widgetId: "calendar:danas", size: "M",
          position: 1024, config: null, createdAt: t, updatedAt: t,
        },
        {
          instanceId: "dw2", profileId: "profile1", widgetId: "study:ispiti", size: "L",
          position: 2048, config: '{"limit":3}', createdAt: t, updatedAt: t,
        },
      ];
      const archive = buildExportArchive(input);

      expect(parseNdjson(archive.files.get("data/dashboard.ndjson") ?? "")).toEqual([
        {
          type: "dashboard-settings", profileId: "profile1", backgroundHash: null,
          backgroundMime: null, backgroundSizeBytes: null, backgroundDim: 40,
        },
        {
          type: "dashboard-widget", instanceId: "dw1", profileId: "profile1",
          widgetId: "calendar:danas", size: "M", position: 1024, config: null,
          createdAt: t, updatedAt: t,
        },
        {
          type: "dashboard-widget", instanceId: "dw2", profileId: "profile1",
          widgetId: "study:ispiti", size: "L", position: 2048, config: '{"limit":3}',
          createdAt: t, updatedAt: t,
        },
      ]);
      expect(archive.byModule.dashboard).toBe(3);
    });

    // A profile on the default arrangement stores no rows at all, and the
    // archive says so by carrying none — which a restore reads as "leave the
    // target on the default", exactly where the source was.
    it("writes nothing for a profile that has never rearranged its dashboard", () => {
      const archive = buildExportArchive(emptyInput());
      expect(archive.files.get("data/dashboard.ndjson")).toBe("");
      expect(archive.byModule.dashboard).toBe(0);
    });
  });

  describe("notes", () => {
    it("writes type-discriminated rows in dependency order and counts them into byModule.notes", () => {
      const input = emptyInput();
      input.data.noteFolders = [folderRow({ id: "f1", name: "Fascikla" })];
      input.data.noteTags = [{ id: "tag1", profileId: "profile1", name: "posao", createdAt: "2026-07-01T00:00:00.000Z" }];
      input.data.notes = [noteRow({ id: "n1", title: "Prva beleska", folderId: "f1", snapshot: emptyNoteSnapshot() })];
      input.data.noteTagLinks = [{ noteId: "n1", tagId: "tag1" }];
      input.data.noteAttachments = [attachmentRow({ id: "att1", noteId: "n1", sha256: "a".repeat(64) })];
      input.data.noteVersions = [
        { noteId: "n1", coveredSeq: 3, title: "Prva beleska", createdAt: "2026-07-01T12:00:00.000Z", snapshot: new Uint8Array([9, 9]) },
      ];
      input.data.noteTemplates = [
        { id: "tmpl1", profileId: "profile1", name: "Sablon", content: '{"type":"doc","content":[]}', createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" },
      ];

      const archive = buildExportArchive(input);
      const rows = parseNdjson(archive.files.get("data/notes.ndjson") ?? "") as Array<{ type: string }>;
      expect(rows.map((row) => row.type)).toEqual([
        "note-folder",
        "note-tag",
        "note",
        "note-tag-link",
        "note-attachment",
        "note-version",
        "note-template",
      ]);
      expect(archive.byModule.notes).toBe(7);
      expect(archive.totalRecords).toBe(7);
    });

    it("never puts snapshot bytes in the NDJSON", () => {
      const input = emptyInput();
      input.data.notes = [noteRow({ id: "n1", title: "Beleska sa sadrzajem", snapshot: emptyNoteSnapshot() })];
      input.data.noteVersions = [
        {
          noteId: "n1",
          coveredSeq: 1,
          title: "Beleska sa sadrzajem",
          createdAt: "2026-07-01T00:00:00.000Z",
          snapshot: new Uint8Array([4, 5]), // version snapshots are never decoded — an opaque blob is fine here
        },
      ];
      const archive = buildExportArchive(input);
      // The word "snapshot" must not appear anywhere in the NDJSON — not as a
      // JSON key/value (it isn't) and not by coincidence in a title either.
      expect(archive.files.get("data/notes.ndjson") ?? "").not.toContain("snapshot");
    });

    it("declares a bytes binary entry per note snapshot and per version, at their archive paths", () => {
      const input = emptyInput();
      const noteSnapshot = emptyNoteSnapshot();
      input.data.notes = [noteRow({ id: "n1", title: "A", snapshot: noteSnapshot })];
      input.data.noteVersions = [
        { noteId: "n1", coveredSeq: 2, title: "A", createdAt: "2026-07-01T00:00:00.000Z", snapshot: new Uint8Array([8]) },
      ];
      const archive = buildExportArchive(input);
      expect(archive.binaries).toContainEqual({ kind: "bytes", path: "data/notes/n1.ydoc", bytes: noteSnapshot });
      expect(archive.binaries).toContainEqual({
        kind: "bytes",
        path: "data/note-versions/n1/2.ydoc",
        bytes: new Uint8Array([8]),
      });
    });

    it("emits no binary entry for a note that has never been edited", () => {
      const input = emptyInput();
      input.data.notes = [noteRow({ id: "n1", title: "Prazna", snapshot: null })];
      const archive = buildExportArchive(input);
      expect(archive.binaries).toEqual([]);
      expect(archive.files.get("notes/Prazna.md")).toBe("");
    });

    it("resolves a nested folder's Markdown mirror path and threads its rootPrefix into an attachment image link", () => {
      const input = emptyInput();
      input.data.noteFolders = [
        folderRow({ id: "root", name: "Posao" }),
        folderRow({ id: "child", name: "Projekti", parentId: "root" }),
      ];
      input.data.notes = [
        noteRow({
          id: "n1",
          title: "Plan",
          folderId: "child",
          snapshot: snapshotWithAttachmentImage("att1"),
        }),
      ];
      input.data.noteAttachments = [attachmentRow({ id: "att1", noteId: "n1", sha256: "b".repeat(64) })];

      const archive = buildExportArchive(input);
      expect(archive.files.has("notes/Posao/Projekti/Plan.md")).toBe(true);
      // "notes/Posao/Projekti/Plan.md" has 3 directory segments (notes, Posao, Projekti).
      expect(archive.files.get("notes/Posao/Projekti/Plan.md")).toBe(
        `![slika.png](../../../blobs/${"b".repeat(64)})\n`,
      );
    });

    it("numbers a second note with the same title in the same folder", () => {
      const input = emptyInput();
      input.data.notes = [
        noteRow({ id: "n1", title: "Plan" }),
        noteRow({ id: "n2", title: "Plan" }),
      ];
      const archive = buildExportArchive(input);
      expect(archive.files.has("notes/Plan.md")).toBe(true);
      expect(archive.files.has("notes/Plan (2).md")).toBe(true);
    });

    it("lands a note whose folderId references a missing folder directly under notes/", () => {
      const input = emptyInput();
      input.data.notes = [noteRow({ id: "n1", title: "Siroce", folderId: "ne-postoji" })];
      const archive = buildExportArchive(input);
      expect(archive.files.has("notes/Siroce.md")).toBe(true);
    });

    it("declares one attachment binary entry per distinct sha256, not one per row", () => {
      const input = emptyInput();
      const sha = "c".repeat(64);
      input.data.notes = [noteRow({ id: "n1", title: "A" }), noteRow({ id: "n2", title: "B" })];
      input.data.noteAttachments = [
        attachmentRow({ id: "att1", noteId: "n1", sha256: sha, sizeBytes: 10 }),
        attachmentRow({ id: "att2", noteId: "n2", sha256: sha, sizeBytes: 10 }),
      ];
      const archive = buildExportArchive(input);
      const attachmentBinaries = archive.binaries.filter((entry) => entry.kind === "attachment");
      expect(attachmentBinaries).toEqual([{ kind: "attachment", path: `blobs/${sha}`, sha256: sha, sizeBytes: 10 }]);
    });

    it("carries the notes module count and a sha256-sorted blobs inventory in the manifest", () => {
      const input = emptyInput();
      input.data.notes = [noteRow({ id: "n1", title: "A" })];
      input.data.noteAttachments = [
        attachmentRow({ id: "att2", noteId: "n1", sha256: "b".repeat(64), sizeBytes: 20 }),
        attachmentRow({ id: "att1", noteId: "n1", sha256: "a".repeat(64), sizeBytes: 10 }),
      ];
      const archive = buildExportArchive(input);
      const manifest = JSON.parse(archive.files.get("manifest.json") ?? "") as Record<string, unknown>;

      expect(manifest.modules).toContainEqual({ id: "notes", records: archive.byModule.notes });
      expect(manifest.blobs).toEqual([
        { sha256: "a".repeat(64), sizeBytes: 10 },
        { sha256: "b".repeat(64), sizeBytes: 20 },
      ]);
      expect((manifest.checksums as Record<string, string>)["data/notes.ndjson"]).toBe(
        sha256(archive.files.get("data/notes.ndjson") ?? ""),
      );
    });

    it("is deterministic: two builds of the same input produce identical files and binaries", () => {
      const input = emptyInput();
      input.data.noteFolders = [
        folderRow({ id: "f1", name: "Posao" }),
        folderRow({ id: "f2", name: "Licno" }),
      ];
      input.data.notes = [
        noteRow({ id: "n1", title: "Prva", folderId: "f1", snapshot: emptyNoteSnapshot() }),
        noteRow({ id: "n2", title: "Druga", folderId: "f2" }),
      ];
      input.data.noteVersions = [
        { noteId: "n1", coveredSeq: 1, title: "Prva", createdAt: "2026-07-01T00:00:00.000Z", snapshot: new Uint8Array([2]) },
      ];
      input.data.noteAttachments = [attachmentRow({ id: "att1", noteId: "n1", sha256: "d".repeat(64) })];

      const first = buildExportArchive(input);
      const second = buildExportArchive(input);

      expect([...first.files.entries()]).toEqual([...second.files.entries()]);
      expect(first.binaries).toEqual(second.binaries);
    });
  });
});
