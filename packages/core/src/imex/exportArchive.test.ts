import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  ARCHIVE_MODULE_IDS,
  buildExportArchive,
  countProfileModules,
  filterProfileData,
  type ArchiveModuleId,
  type ExportArchiveInput,
  type ExportCard,
  type ExportNote,
  type ExportNoteAttachment,
  type ExportNoteFolder,
  type ExportSubjectNoteLink,
  type ExportTaskList,
  type ProfileData,
} from "./exportArchive.js";

/** The test's own sha256 hex — mirrors the shape `main` injects, kept out of `@nexus/core`. */
function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function emptyInput(): ExportArchiveInput {
  return {
    profile: { id: "profile1", name: "Luka", kind: "personal", picture: null },
    appVersion: "0.1.0",
    createdAt: "2026-07-11T10:00:00.000Z",
    settings: {
      flags: { tasks: true, notes: false },
      notifications: {
        quietFrom: null,
        quietTo: null,
        morningHour: "08:00",
        enabledSources: ["document", "exam"],
        snoozeDefault: "1h",
      },
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
      eventTemplates: [],
      documents: [],
      renewals: [],
      people: [],
      calendarSettings: [],
      subjects: [],
      subjectAttachments: [],
      subjectNoteLinks: [],
      exams: [],
      decks: [],
      cards: [],
      reviewLog: [],
      examTopics: [],
      plans: [],
      blocks: [],
      focusSessions: [],
      studySettings: [],
      notifications: [],
      notes: [],
      noteFolders: [],
      noteTags: [],
      noteCategories: [],
      noteTagLinks: [],
      noteTemplates: [],
      noteAttachments: [],
      noteVersions: [],
      dashboardSettings: [],
      dashboardSets: [],
      dashboardWidgets: [],
      finAccounts: [],
      finCategories: [],
      finTransactions: [],
      finBudgets: [],
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
  categoryId?: string | null;
  snapshot?: Uint8Array | null;
}): ExportNote {
  return {
    id: overrides.id,
    profileId: "profile1",
    title: overrides.title,
    folderId: overrides.folderId ?? null,
    categoryId: overrides.categoryId ?? null,
    pinned: false,
    cardDeckId: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    snapshot: overrides.snapshot ?? null,
  };
}

/** A minimal `ExportNoteFolder` row. `defaultView` is optional (NOTE-002), so it is only set when a test is about it. */
function folderRow(overrides: {
  id: string;
  name: string;
  parentId?: string | null;
  defaultView?: "list" | "cards";
}): ExportNoteFolder {
  return {
    id: overrides.id,
    profileId: "profile1",
    parentId: overrides.parentId ?? null,
    name: overrides.name,
    color: null,
    defaultTemplateId: null,
    isCaptureDefault: false,
    ...(overrides.defaultView === undefined ? {} : { defaultView: overrides.defaultView }),
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
          "data/private-notes.ndjson",
          "data/finance.ndjson",
          "data/calendar.ics",
          "tables/tasks.csv",
          "tables/events.csv",
          "tables/documents.csv",
          "tables/subjects.csv",
          "tables/exams.csv",
          "tables/exam-topics.csv",
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
      // ADR-057 §6: an absent `privateNotes` input writes the empty file —
      // indistinguishable from a profile with no private notes, on purpose.
      expect(archive.files.get("data/private-notes.ndjson")).toBe("");
      // FIN (migration 051): the empty file a profile with no ledger writes.
      expect(archive.files.get("data/finance.ndjson")).toBe("");

      // CSV mirrors still carry their header row.
      expect(archive.files.get("tables/tasks.csv")).toMatch(/^id,/);
      expect(archive.files.get("tables/tasks.csv")?.split("\r\n")).toEqual(
        expect.arrayContaining([expect.stringMatching(/^id,/)]),
      );

      expect(archive.totalRecords).toBe(0);
      expect(archive.byModule).toEqual({
        tasks: 0, calendar: 0, study: 0, notifications: 0, notes: 0, dashboard: 0, finance: 0,
      });
      expect(archive.binaries).toEqual([]);
    });
  });

  describe("manifest.json", () => {
    it("carries schemaVersion, appVersion, createdAt, profile, settings, module counts and checksums", () => {
      const input = emptyInput();
      const archive = buildExportArchive(input);
      const manifest = JSON.parse(archive.files.get("manifest.json") ?? "") as Record<string, unknown>;

      expect(manifest.schemaVersion).toBe("1.29.0");
      expect(manifest.appVersion).toBe("0.1.0");
      expect(manifest.createdAt).toBe("2026-07-11T10:00:00.000Z");
      // `picture: null` is written out loud rather than omitted: the manifest is
      // the archive's own statement of what the profile IS, and "this profile
      // has no picture" is a fact worth stating (SET-001, `1.18.0`). `kind` is
      // ALWAYS written on the same reasoning (ADR-058, `1.22.0`) — what kind of
      // profile an archive is OF is never something a reader should infer.
      expect(manifest.profile).toEqual({ id: "profile1", name: "Luka", kind: "personal", picture: null });

      const businessInput = emptyInput();
      businessInput.profile.kind = "business";
      const businessManifest = JSON.parse(
        buildExportArchive(businessInput).files.get("manifest.json") ?? "",
      ) as { profile: { kind: string } };
      expect(businessManifest.profile.kind).toBe("business");
      // `snoozeDefault` (NTF-009, `1.19.0`) rides here beside the quiet hours,
      // written out loud like every other resolved preference in this object.
      expect(manifest.settings).toEqual({
        flags: { tasks: true, notes: false },
        notifications: {
          quietFrom: null,
          quietTo: null,
          morningHour: "08:00",
          enabledSources: ["document", "exam"],
          snoozeDefault: "1h",
        },
      });
      expect(manifest.modules).toEqual([
        { id: "tasks", records: 0 },
        { id: "calendar", records: 0 },
        { id: "study", records: 0 },
        { id: "notifications", records: 0 },
        { id: "notes", records: 0 },
        { id: "dashboard", records: 0 },
        { id: "finance", records: 0 },
      ]);
      expect(manifest.checksums).toEqual({
        "data/tasks.ndjson": sha256(""),
        "data/calendar.ndjson": sha256(""),
        "data/study.ndjson": sha256(""),
        "data/notifications.ndjson": sha256(""),
        "data/notes.ndjson": sha256(""),
        "data/dashboard.ndjson": sha256(""),
        "data/private-notes.ndjson": sha256(""),
        "data/finance.ndjson": sha256(""),
      });
      expect(manifest.blobs).toEqual([]);
      // The private inventory (ADR-057 §6), beside the blob list it mirrors —
      // always written, empty whenever no private notes ride.
      expect(manifest.privateBlobs).toEqual([]);
    });

    it("is pretty-printed (indented) JSON", () => {
      const archive = buildExportArchive(emptyInput());
      const raw = archive.files.get("manifest.json") ?? "";
      expect(raw).toContain("\n  ");
    });

    // SET-001 (`1.18.0`): the picture is a MANIFEST fact, so these four cover the
    // whole of it — it is written where the profile's name is, its blob joins the
    // same `blobs/` union every attachment travels in, it deduplicates against an
    // attachment naming the same bytes, and it rides with a module subset that
    // carries no dashboard at all.
    describe("the profile picture", () => {
      const PICTURE = { hash: "c".repeat(64), mime: "image/png", sizeBytes: 4096 };

      it("is written into the manifest's profile object", () => {
        const input = emptyInput();
        input.profile.picture = PICTURE;
        const manifest = JSON.parse(
          buildExportArchive(input).files.get("manifest.json") ?? "",
        ) as Record<string, unknown>;
        expect(manifest.profile).toEqual({
          id: "profile1",
          name: "Luka",
          kind: "personal",
          picture: PICTURE,
        });
      });

      it("declares its blob in the manifest inventory and as a binary entry", () => {
        const input = emptyInput();
        input.profile.picture = PICTURE;
        const archive = buildExportArchive(input);
        const manifest = JSON.parse(archive.files.get("manifest.json") ?? "") as {
          blobs: { sha256: string; sizeBytes: number }[];
        };
        expect(manifest.blobs).toEqual([{ sha256: PICTURE.hash, sizeBytes: PICTURE.sizeBytes }]);
        expect(archive.binaries).toContainEqual({
          kind: "attachment",
          path: `blobs/${PICTURE.hash}`,
          sha256: PICTURE.hash,
          sizeBytes: PICTURE.sizeBytes,
        });
      });

      it("travels once when a note attachment names the same bytes", () => {
        const input = emptyInput();
        input.profile.picture = PICTURE;
        input.data.notes = [noteRow({ id: "n1", title: "Beleška" })];
        input.data.noteAttachments = [
          attachmentRow({ id: "na1", noteId: "n1", sha256: PICTURE.hash, sizeBytes: PICTURE.sizeBytes }),
        ];
        const archive = buildExportArchive(input);
        expect(
          archive.binaries.filter((entry) => entry.path === `blobs/${PICTURE.hash}`),
        ).toHaveLength(1);
      });

      it("rides with a module subset that carries no dashboard at all", () => {
        const input = emptyInput();
        input.profile.picture = PICTURE;
        input.modules = new Set<ArchiveModuleId>(["tasks"]);
        const manifest = JSON.parse(
          buildExportArchive(input).files.get("manifest.json") ?? "",
        ) as { profile: { picture: unknown }; blobs: unknown[] };
        expect(manifest.profile.picture).toEqual(PICTURE);
        expect(manifest.blobs).toEqual([{ sha256: PICTURE.hash, sizeBytes: PICTURE.sizeBytes }]);
      });
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

    // ADR-054: the term's fixed dates, one line, FIRST — the settings the rest
    // of the module is read under, exactly as `study-settings` leads its file —
    // and counted into CALENDAR like every row the module owns.
    it("writes the calendar-settings row as one type-discriminated line ahead of the events", () => {
      const input = emptyInput();
      input.data.calendarSettings = [
        { profileId: "profile1", semesterStart: "2026-10-01", semesterEnd: "2027-01-31" },
      ];
      input.data.events = [
        {
          id: "e1", profileId: "profile1", title: "Sastanak", description: null,
          startAt: "2026-10-05T10:00:00.000Z", endAt: null, allDay: false, location: null,
          category: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
          recurrence: null, recurrenceExdates: [], reminderOffsets: [],
        },
      ];
      const archive = buildExportArchive(input);

      const rows = parseNdjson(archive.files.get("data/calendar.ndjson") ?? "") as Array<{ type: string }>;
      expect(rows.map((row) => row.type)).toEqual(["calendar-settings", "event"]);
      expect(rows[0]).toEqual({
        type: "calendar-settings", profileId: "profile1",
        semesterStart: "2026-10-01", semesterEnd: "2027-01-31",
      });
      expect(archive.byModule.calendar).toBe(2);
    });

    // Both-null is a real row saying "no term set" out loud — the resolved
    // value the gatherer always writes, exactly as `dashboard-settings` writes
    // its no-background row.
    it("writes an unset term as a both-null calendar-settings row", () => {
      const input = emptyInput();
      input.data.calendarSettings = [
        { profileId: "profile1", semesterStart: null, semesterEnd: null },
      ];
      const archive = buildExportArchive(input);
      expect(parseNdjson(archive.files.get("data/calendar.ndjson") ?? "")).toEqual([
        { type: "calendar-settings", profileId: "profile1", semesterStart: null, semesterEnd: null },
      ]);
      expect(archive.byModule.calendar).toBe(1);
      expect(archive.totalRecords).toBe(1);
    });
  });

  describe("data/calendar.ics", () => {
    it("carries a valid, empty RFC 5545 calendar when the profile has no events", () => {
      const archive = buildExportArchive(emptyInput());
      const ics = archive.files.get("data/calendar.ics") ?? "";
      expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
      expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
      expect(ics).not.toContain("BEGIN:VEVENT");
    });

    it("writes one VEVENT per event, stamped with the archive's own createdAt", () => {
      const input = emptyInput();
      input.data.events = [
        {
          id: "e1", profileId: "profile1", title: "Sastanak", description: null,
          startAt: "2026-07-15T10:00", endAt: "2026-07-15T11:00", allDay: false,
          location: null, category: null,
          createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
          recurrence: null, recurrenceExdates: [], reminderOffsets: [],
        },
      ];

      const ics = buildExportArchive(input).files.get("data/calendar.ics") ?? "";
      expect(ics).toContain("UID:e1@nexus.stojiljkovic.rs\r\n");
      // `createdAt` is the manifest's own stamp — the archive reads no clock.
      expect(ics).toContain("DTSTAMP:20260711T100000Z\r\n");
      expect(ics).toContain("DTSTART:20260715T100000\r\n");
    });

    it("is NOT checksummed — it is a convenience copy, not part of the interchange", () => {
      const archive = buildExportArchive(emptyInput());
      const manifest = JSON.parse(archive.files.get("manifest.json") ?? "") as {
        checksums: Record<string, string>;
      };
      expect(Object.keys(manifest.checksums)).not.toContain("data/calendar.ics");
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

      input.data.studySettings = [
        { profileId: "profile1", targetRetention: 0.85, newPerDay: 10, maxReviewsPerDay: 150 },
      ];

      const archive = buildExportArchive(input);
      const rows = parseNdjson(archive.files.get("data/study.ndjson") ?? "") as Array<{ type: string }>;
      expect(rows.map((row) => row.type)).toEqual([
        "study-settings", "subject", "exam", "deck", "card", "review", "plan", "block", "focus-session",
      ]);
      expect(archive.byModule.study).toBe(9);
    });

    // STUDY-007: the scheduling preferences, one line, and counted into STUDY
    // like every row the module owns.
    it("writes the study-settings row as one type-discriminated line", () => {
      const input = emptyInput();
      input.data.studySettings = [
        { profileId: "profile1", targetRetention: 0.93, newPerDay: 0, maxReviewsPerDay: null },
      ];
      const archive = buildExportArchive(input);

      expect(parseNdjson(archive.files.get("data/study.ndjson") ?? "")).toEqual([
        {
          type: "study-settings", profileId: "profile1", targetRetention: 0.93,
          newPerDay: 0, maxReviewsPerDay: null,
        },
      ]);
      expect(archive.byModule.study).toBe(1);
      expect(archive.totalRecords).toBe(1);
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
        tasks: 1, calendar: 0, study: 0, notifications: 1, notes: 0, dashboard: 0, finance: 0,
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
        eventTemplates: [
          {
            id: "etpl1", profileId: "p1", name: "Šablon", createdAt: t, updatedAt: t,
            payload: {
              title: "E", allDay: false, startTime: "18:30", durationMinutes: 90,
              location: null, description: null, category: null,
              reminderOffsets: [], recurrence: null,
            },
          },
        ],
        documents: [
          { id: "d1", profileId: "p1", docType: "licna_karta", label: "D", expiryDate: "2030-01-01", reminderOffsets: [], notes: null, createdAt: t, updatedAt: t },
        ],
        renewals: [{ id: "r1", documentId: "d1", previousExpiry: "2020-01-01", renewedAt: t }],
        people: [
          { id: "pe1", profileId: "p1", name: "Marko", kind: "birthday", month: 3, day: 14, year: 1990, note: null, createdAt: t, updatedAt: t },
        ],
        calendarSettings: [
          { profileId: "p1", semesterStart: "2026-10-01", semesterEnd: "2027-01-31" },
        ],
        subjects: [
          { id: "s1", profileId: "p1", name: "S", color: "jade", semester: null, archived: false, createdAt: t, updatedAt: t },
        ],
        subjectAttachments: [
          { id: "satt1", subjectId: "s1", fileName: "skripta.pdf", mime: "application/pdf", sizeBytes: 40, sha256: "d".repeat(64), createdAt: t },
        ],
        subjectNoteLinks: [{ subjectId: "s1", noteId: "note1", createdAt: t }],
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
        examTopics: [
          { id: "top1", profileId: "p1", examId: "ex1", name: "Grafovi", sortOrder: 0, confidence: 40, deckId: "dk1", cut: false, createdAt: t, updatedAt: t },
        ],
        plans: [
          { id: "pl1", profileId: "p1", examId: "ex1", dailyMinutes: 30, startDate: "2026-01-01", examWeekBoost: false, weekdayMinutes: [30, 30, 30, 30, 30, 0, 60], createdAt: t, updatedAt: t },
        ],
        blocks: [
          { id: "b1", planId: "pl1", profileId: "p1", blockDate: "2026-01-02", minutes: 30, status: "planned", topicId: "top1", kind: "coverage", pinned: true, createdAt: t, updatedAt: t },
        ],
        focusSessions: [
          { id: "f1", profileId: "p1", subjectId: "s1", startedAt: t, endedAt: t, createdAt: t, updatedAt: t },
        ],
        studySettings: [
          { profileId: "p1", targetRetention: 0.95, newPerDay: 15, maxReviewsPerDay: 120 },
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
        noteCategories: [
          { id: "cat1", profileId: "p1", name: "sastanak", color: "zlato", createdAt: t, updatedAt: t },
        ],
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
            backgroundSizeBytes: 32, backgroundDim: 40, activeSetId: "set1",
          },
        ],
        dashboardSets: [
          { id: "set1", profileId: "p1", name: "Fakultet", position: 1024, createdAt: t, updatedAt: t },
        ],
        dashboardWidgets: [
          {
            instanceId: "dw1", profileId: "p1", widgetId: "calendar:danas", size: "M",
            position: 1024, config: null, createdAt: t, updatedAt: t, setId: "set1",
          },
        ],
        // TWO accounts rather than one, because a transfer names both sides —
        // a fixture whose counter account dangled would be counting something
        // the exporter could never write, exactly as the two tasks above are.
        finAccounts: [
          { id: "fa1", profileId: "p1", name: "Tekući", kind: "current", currency: "RSD", openingBalance: 100_00, archived: false, createdAt: t, updatedAt: t },
          { id: "fa2", profileId: "p1", name: "Štednja", kind: "savings", currency: "RSD", openingBalance: 0, archived: false, createdAt: t, updatedAt: t },
        ],
        finCategories: [
          { id: "fc1", profileId: "p1", name: "Hrana", kind: "expense", createdAt: t, updatedAt: t },
        ],
        finTransactions: [
          { id: "ftx1", profileId: "p1", accountId: "fa1", counterAccountId: null, categoryId: "fc1", date: "2026-01-02", amount: -12_00, payee: "Maxi", note: null, importKey: '["2026-01-02",-1200,"Maxi","",1]', createdAt: t, updatedAt: t },
          // The transfer: ONE row, both sides, no category.
          { id: "ftx2", profileId: "p1", accountId: "fa1", counterAccountId: "fa2", categoryId: null, date: "2026-01-03", amount: -50_00, payee: null, note: null, importKey: null, createdAt: t, updatedAt: t },
        ],
        finBudgets: [
          { id: "fb1", profileId: "p1", categoryId: "fc1", currency: "RSD", amount: 300_00, createdAt: t, updatedAt: t },
        ],
      };
    }

    it("groups exactly as the manifest does, field by field", () => {
      const data = populatedData();
      expect(countProfileModules(data)).toEqual({
        tasks: 9, // 2 tasks + 1 list + 1 section + 1 tag + 1 tag link + 1 attachment + 1 template + 1 dependency
        calendar: 6, // 1 event + 1 event template + 1 document + 1 renewal + 1 person + the settings row
        study: 12, // 1 each of subject/material/note-link/exam/deck/card/review/topic/plan/block/focus-session + the settings row
        notifications: 1,
        notes: 8, // 1 each of note/folder/tag/category/tag-link/template/attachment/version
        dashboard: 3, // the one settings row a profile can ever have + 1 named board + 1 placed widget
        finance: 6, // 2 accounts + 1 category + 2 transactions (one of them the transfer) + 1 budget
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
        tasks: 0, calendar: 0, study: 0, notifications: 0, notes: 0, dashboard: 0, finance: 0,
      });
    });
  });

  describe("data/study.ndjson — exam topics (ADR-063)", () => {
    const t = "2026-01-01T00:00:00.000Z";

    function studyInput(): ExportArchiveInput {
      const input = emptyInput();
      input.data.subjects = [
        { id: "s1", profileId: "profile1", name: "S", color: "jade", semester: null, archived: false, createdAt: t, updatedAt: t },
      ];
      input.data.exams = [
        { id: "ex1", profileId: "profile1", subjectId: "s1", examType: "pismeni", examDate: "2030-01-01", scope: null, createdAt: t, updatedAt: t },
      ];
      input.data.decks = [
        { id: "dk1", profileId: "profile1", subjectId: "s1", name: "Dk", createdAt: t, updatedAt: t },
      ];
      input.data.examTopics = [
        { id: "top1", profileId: "profile1", examId: "ex1", name: "Grafovi", sortOrder: 0, confidence: null, deckId: "dk1", cut: false, createdAt: t, updatedAt: t },
      ];
      input.data.plans = [
        { id: "pl1", profileId: "profile1", examId: "ex1", dailyMinutes: 30, startDate: "2026-01-01", examWeekBoost: false, weekdayMinutes: null, createdAt: t, updatedAt: t },
      ];
      input.data.blocks = [
        { id: "b1", planId: "pl1", profileId: "profile1", blockDate: "2026-01-02", minutes: 30, status: "planned", topicId: "top1", kind: "recall", pinned: false, createdAt: t, updatedAt: t },
      ];
      return input;
    }

    it("writes exam-topic rows AHEAD of the plans, after the decks they may link", () => {
      const archive = buildExportArchive(studyInput());
      const types = parseNdjson(archive.files.get("data/study.ndjson") ?? "").map(
        (row) => (row as { type: string }).type,
      );
      expect(types.indexOf("deck")).toBeLessThan(types.indexOf("exam-topic"));
      expect(types.indexOf("exam-topic")).toBeLessThan(types.indexOf("plan"));
      expect(types.indexOf("plan")).toBeLessThan(types.indexOf("block"));
    });

    it("mirrors the topics into tables/exam-topics.csv beside the other study tables", () => {
      const archive = buildExportArchive(studyInput());
      const csv = archive.files.get("tables/exam-topics.csv") ?? "";
      expect(csv).toMatch(/^id,examId,name,sortOrder,confidence,deckId,cut,createdAt,updatedAt/);
      expect(csv).toContain("Grafovi");
    });

    it("drops the topics with the rest of the STUDY module under a subset export (IMEX-003)", () => {
      const input = studyInput();
      input.modules = new Set<ArchiveModuleId>(["tasks"]);
      const archive = buildExportArchive(input);
      expect(archive.files.get("data/study.ndjson")).toBe("");
      expect(archive.byModule.study).toBe(0);
    });
  });

  describe("data/finance.ndjson (FIN slice a, migration 051)", () => {
    const t = "2026-01-01T00:00:00.000Z";

    function financeInput(): ExportArchiveInput {
      const input = emptyInput();
      input.data.finAccounts = [
        { id: "fa1", profileId: "profile1", name: "Tekući", kind: "current", currency: "RSD", openingBalance: 100_00, archived: false, createdAt: t, updatedAt: t },
        { id: "fa2", profileId: "profile1", name: "Štednja", kind: "savings", currency: "RSD", openingBalance: 0, archived: false, createdAt: t, updatedAt: t },
      ];
      input.data.finCategories = [
        { id: "fc1", profileId: "profile1", name: "Hrana", kind: "expense", createdAt: t, updatedAt: t },
      ];
      input.data.finTransactions = [
        { id: "ftx1", profileId: "profile1", accountId: "fa1", counterAccountId: null, categoryId: "fc1", date: "2026-01-02", amount: -12_00, payee: "Maxi", note: null, importKey: null, createdAt: t, updatedAt: t },
        { id: "ftx2", profileId: "profile1", accountId: "fa1", counterAccountId: "fa2", categoryId: null, date: "2026-01-03", amount: -50_00, payee: null, note: null, importKey: null, createdAt: t, updatedAt: t },
      ];
      input.data.finBudgets = [
        { id: "fb1", profileId: "profile1", categoryId: "fc1", currency: "RSD", amount: 300_00, createdAt: t, updatedAt: t },
      ];
      return input;
    }

    it("writes the four types in dependency order: accounts and categories before the rows that name them", () => {
      const archive = buildExportArchive(financeInput());
      const types = parseNdjson(archive.files.get("data/finance.ndjson") ?? "").map(
        (row) => (row as { type: string }).type,
      );
      expect(types).toEqual([
        "fin-account",
        "fin-account",
        "fin-category",
        "fin-transaction",
        "fin-transaction",
        "fin-budget",
      ]);
    });

    it("carries a transfer as ONE row naming both sides, with no category", () => {
      const archive = buildExportArchive(financeInput());
      const rows = parseNdjson(archive.files.get("data/finance.ndjson") ?? "") as {
        type: string;
        counterAccountId?: string | null;
        categoryId?: string | null;
      }[];
      const transfers = rows.filter(
        (row) => row.type === "fin-transaction" && row.counterAccountId !== null,
      );
      expect(transfers).toHaveLength(1);
      expect(transfers[0]?.categoryId).toBeNull();
    });

    it("carries every amount as an INTEGER of minor units, never a decimal", () => {
      const archive = buildExportArchive(financeInput());
      const text = archive.files.get("data/finance.ndjson") ?? "";
      // Serialized as bare integers — 12,00 RSD is `-1200`, not `-12.00`.
      expect(text).toContain('"openingBalance":10000');
      expect(text).toContain('"amount":-1200');
      expect(text).toContain('"amount":30000');
      for (const row of parseNdjson(text) as Record<string, unknown>[]) {
        for (const field of ["openingBalance", "amount"]) {
          const value = row[field];
          if (value === undefined) continue;
          expect({ field, integer: Number.isInteger(value) }).toEqual({ field, integer: true });
        }
      }
    });

    it("counts the whole ledger into byModule.finance", () => {
      const archive = buildExportArchive(financeInput());
      expect(archive.byModule.finance).toBe(6);
    });

    it("drops the whole ledger under a subset export that does not name it (IMEX-003)", () => {
      const input = financeInput();
      input.modules = new Set<ArchiveModuleId>(["tasks"]);
      const archive = buildExportArchive(input);
      expect(archive.files.get("data/finance.ndjson")).toBe("");
      expect(archive.byModule.finance).toBe(0);
    });

    it("keeps the ledger whole under a finance-only export — no FIN reference crosses a module", () => {
      const input = financeInput();
      input.modules = new Set<ArchiveModuleId>(["finance"]);
      const archive = buildExportArchive(input);
      expect(archive.byModule.finance).toBe(6);
      expect(archive.files.get("data/tasks.ndjson")).toBe("");
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

    // DASH-008 / ADR-055: named boards ride between the settings row and the
    // widgets — after the preferences that lead the file, before the rows that
    // reference them — and count into the dashboard bucket like any other row.
    it("writes dashboard sets between the settings row and the widgets, and counts them", () => {
      const input = emptyInput();
      const t = "2026-07-31T09:00:00.000Z";
      input.data.dashboardSettings = [
        {
          profileId: "profile1", backgroundHash: null, backgroundMime: null,
          backgroundSizeBytes: null, backgroundDim: 40, activeSetId: "set1",
        },
      ];
      input.data.dashboardSets = [
        { id: "set1", profileId: "profile1", name: "Fakultet", position: 1024, createdAt: t, updatedAt: t },
      ];
      input.data.dashboardWidgets = [
        {
          instanceId: "dw1", profileId: "profile1", widgetId: "calendar:danas", size: "M",
          position: 1024, config: null, createdAt: t, updatedAt: t, setId: "set1",
        },
      ];
      const archive = buildExportArchive(input);

      expect(parseNdjson(archive.files.get("data/dashboard.ndjson") ?? "")).toEqual([
        {
          type: "dashboard-settings", profileId: "profile1", backgroundHash: null,
          backgroundMime: null, backgroundSizeBytes: null, backgroundDim: 40, activeSetId: "set1",
        },
        {
          type: "dashboard-set", id: "set1", profileId: "profile1", name: "Fakultet",
          position: 1024, createdAt: t, updatedAt: t,
        },
        {
          type: "dashboard-widget", instanceId: "dw1", profileId: "profile1",
          widgetId: "calendar:danas", size: "M", position: 1024, config: null,
          createdAt: t, updatedAt: t, setId: "set1",
        },
      ]);
      expect(archive.byModule.dashboard).toBe(3);
      expect(archive.totalRecords).toBe(3);
    });
  });

  describe("notes", () => {
    it("writes type-discriminated rows in dependency order and counts them into byModule.notes", () => {
      const input = emptyInput();
      input.data.noteFolders = [folderRow({ id: "f1", name: "Fascikla" })];
      input.data.noteTags = [{ id: "tag1", profileId: "profile1", name: "posao", createdAt: "2026-07-01T00:00:00.000Z" }];
      input.data.noteCategories = [
        { id: "cat1", profileId: "profile1", name: "sastanak", color: null, createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" },
      ];
      input.data.notes = [
        noteRow({ id: "n1", title: "Prva beleska", folderId: "f1", categoryId: "cat1", snapshot: emptyNoteSnapshot() }),
      ];
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
        // Before the notes whose `categoryId` names it (NOTE-002 / 1.27.0).
        "note-category",
        "note",
        "note-tag-link",
        "note-attachment",
        "note-version",
        "note-template",
      ]);
      expect(archive.byModule.notes).toBe(8);
      expect(archive.totalRecords).toBe(8);
    });

    // NOTE-002 / 1.27.0: what KIND a note is travels on the note's own row,
    // beside the folder that says where it lives.
    it("carries a note's categoryId, null when the note is uncategorized", () => {
      const input = emptyInput();
      input.data.noteCategories = [
        { id: "cat1", profileId: "profile1", name: "recept", color: "suma", createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z" },
      ];
      input.data.notes = [
        noteRow({ id: "n1", title: "Sa kategorijom", categoryId: "cat1" }),
        noteRow({ id: "n2", title: "Bez kategorije" }),
      ];

      const rows = parseNdjson(
        buildExportArchive(input).files.get("data/notes.ndjson") ?? "",
      ) as Array<Record<string, unknown>>;
      const category = rows.find((row) => row.type === "note-category");
      expect(category).toEqual({
        type: "note-category", id: "cat1", profileId: "profile1", name: "recept", color: "suma",
        createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z",
      });
      expect(rows.filter((row) => row.type === "note").map((row) => row.categoryId)).toEqual([
        "cat1",
        null,
      ]);
    });

    // NOTE-002 / 1.17.0: the shape a folder's notes are drawn in travels with
    // the folder, and a folder that expressed no preference writes no key —
    // which is what a 1.16 reader would have seen anyway.
    it("carries a folder's defaultView, and omits the key when the row has none", () => {
      const input = emptyInput();
      input.data.noteFolders = [
        folderRow({ id: "f1", name: "Recepti", defaultView: "cards" }),
        folderRow({ id: "f2", name: "Posao", defaultView: "list" }),
        folderRow({ id: "f3", name: "Bez izbora" }),
      ];

      const rows = parseNdjson(
        buildExportArchive(input).files.get("data/notes.ndjson") ?? "",
      ) as Array<Record<string, unknown>>;
      expect(rows.map((row) => row.defaultView)).toEqual(["cards", "list", undefined]);
      expect(Object.keys(rows[2] ?? {})).not.toContain("defaultView");
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

  // --- IMEX-003: per-module export subsets ---------------------------------

  describe("module subsets", () => {
    it("omitting `modules` carries every module, exactly as before", () => {
      const populated = everyModuleInput();
      const chosen = everyModuleInput();
      chosen.modules = new Set(ARCHIVE_MODULE_IDS);

      const all = buildExportArchive(populated);
      const explicit = buildExportArchive(chosen);

      expect([...all.files.entries()]).toEqual([...explicit.files.entries()]);
      expect(all.binaries).toEqual(explicit.binaries);
    });

    it("writes only the chosen modules' rows and empties the rest", () => {
      const input = everyModuleInput();
      input.modules = new Set<ArchiveModuleId>(["tasks"]);
      const archive = buildExportArchive(input);

      expect(parseNdjson(archive.files.get("data/tasks.ndjson") ?? "")).not.toEqual([]);
      expect(archive.files.get("data/calendar.ndjson")).toBe("");
      expect(archive.files.get("data/study.ndjson")).toBe("");
      expect(archive.files.get("data/notifications.ndjson")).toBe("");
      expect(archive.files.get("data/notes.ndjson")).toBe("");
      expect(archive.files.get("data/dashboard.ndjson")).toBe("");
    });

    // The archive's shape is a property of the FORMAT, not of the choice: every
    // NDJSON file is still written (empty is the honest "no such rows" shape a
    // profile without them produces), and the manifest still declares all six
    // modules — with counts that say zero out loud.
    it("keeps every data file and every manifest module id, counted honestly", () => {
      const input = everyModuleInput();
      input.modules = new Set<ArchiveModuleId>(["notes", "dashboard"]);
      const archive = buildExportArchive(input);
      const manifest = JSON.parse(archive.files.get("manifest.json") ?? "") as Record<string, unknown>;

      for (const path of ["data/tasks.ndjson", "data/calendar.ndjson", "data/study.ndjson",
        "data/notifications.ndjson", "data/notes.ndjson", "data/dashboard.ndjson"]) {
        expect(archive.files.has(path)).toBe(true);
      }
      expect(manifest.modules).toEqual([
        { id: "tasks", records: 0 },
        { id: "calendar", records: 0 },
        { id: "study", records: 0 },
        { id: "notifications", records: 0 },
        { id: "notes", records: archive.byModule.notes },
        { id: "dashboard", records: archive.byModule.dashboard },
        { id: "finance", records: 0 },
      ]);
      expect(archive.byModule.notes).toBeGreaterThan(0);
      expect(archive.totalRecords).toBe(archive.byModule.notes + archive.byModule.dashboard);
      expect((manifest.checksums as Record<string, string>)["data/tasks.ndjson"]).toBe(sha256(""));
    });

    it("mirrors the filtered reality in the CSV tables", () => {
      const input = everyModuleInput();
      input.modules = new Set<ArchiveModuleId>(["calendar"]);
      const archive = buildExportArchive(input);

      // Header-only: `toCsv` still writes the column row for an empty table.
      expect(archive.files.get("tables/tasks.csv")?.split("\n").length).toBe(2);
      expect(archive.files.get("tables/cards.csv")?.split("\n").length).toBe(2);
      expect(archive.files.get("tables/events.csv")).toContain("Sastanak");
    });

    it("omits data/calendar.ics when the calendar is not chosen, and keeps it when it is", () => {
      const without = everyModuleInput();
      without.modules = new Set<ArchiveModuleId>(["tasks"]);
      expect(buildExportArchive(without).files.has("data/calendar.ics")).toBe(false);

      const with_ = everyModuleInput();
      with_.modules = new Set<ArchiveModuleId>(["calendar"]);
      expect(buildExportArchive(with_).files.get("data/calendar.ics")).toContain("BEGIN:VEVENT");
    });

    it("carries only the blobs the chosen modules' rows name", () => {
      const input = everyModuleInput();
      input.modules = new Set<ArchiveModuleId>(["study"]);
      const archive = buildExportArchive(input);
      const manifest = JSON.parse(archive.files.get("manifest.json") ?? "") as Record<string, unknown>;

      expect(manifest.blobs).toEqual([{ sha256: SUBJECT_BLOB, sizeBytes: 30 }]);
      expect(archive.binaries).toEqual([
        { kind: "attachment", path: `blobs/${SUBJECT_BLOB}`, sha256: SUBJECT_BLOB, sizeBytes: 30 },
      ]);
    });

    it("drops the notes' Markdown mirror and ydocs when notes are not chosen", () => {
      const input = everyModuleInput();
      input.modules = new Set<ArchiveModuleId>(["tasks", "calendar", "study", "notifications", "dashboard"]);
      const archive = buildExportArchive(input);

      expect([...archive.files.keys()].some((path) => path.endsWith(".md"))).toBe(false);
      expect(archive.binaries.some((entry) => entry.kind === "bytes")).toBe(false);
    });

    it("carries the dashboard background blob only with the dashboard", () => {
      const input = everyModuleInput();
      input.modules = new Set<ArchiveModuleId>(["dashboard"]);
      const archive = buildExportArchive(input);
      expect(archive.binaries).toEqual([
        { kind: "attachment", path: `blobs/${BACKGROUND_BLOB}`, sha256: BACKGROUND_BLOB, sizeBytes: 40 },
      ]);
    });
  });
});

/**
 * IMEX-003's whole subject: what a module choice does to the rows that point
 * ACROSS a module boundary. Three edges exist in the archive's reference graph
 * (`importArchive.ts`'s `referenceRules`) — `subject-note-link.noteId` and
 * `card.sourceNoteId`, both STUDY→NOTES, and `note.cardDeckId`, NOTES→STUDY —
 * and each is repaired here rather than left to dangle, because the reader
 * refuses a dangling reference outright in restore mode.
 */
describe("filterProfileData", () => {
  const ALL = new Set(ARCHIVE_MODULE_IDS);

  it("changes nothing when every module is chosen", () => {
    const data = everyModuleInput().data;
    expect(filterProfileData(data, ALL)).toEqual(data);
  });

  it("empties every array of a module that is not chosen", () => {
    const data = everyModuleInput().data;
    const filtered = filterProfileData(data, new Set<ArchiveModuleId>(["notifications"]));

    expect(filtered.notifications).toEqual(data.notifications);
    expect(filtered.tasks).toEqual([]);
    expect(filtered.taskLists).toEqual([]);
    expect(filtered.taskSections).toEqual([]);
    expect(filtered.taskTags).toEqual([]);
    expect(filtered.taskTagLinks).toEqual([]);
    expect(filtered.taskAttachments).toEqual([]);
    expect(filtered.taskTemplates).toEqual([]);
    expect(filtered.taskDependencies).toEqual([]);
    expect(filtered.events).toEqual([]);
    expect(filtered.eventTemplates).toEqual([]);
    expect(filtered.documents).toEqual([]);
    expect(filtered.renewals).toEqual([]);
    expect(filtered.people).toEqual([]);
    expect(filtered.calendarSettings).toEqual([]);
    expect(filtered.subjects).toEqual([]);
    expect(filtered.subjectAttachments).toEqual([]);
    expect(filtered.subjectNoteLinks).toEqual([]);
    expect(filtered.exams).toEqual([]);
    expect(filtered.decks).toEqual([]);
    expect(filtered.cards).toEqual([]);
    expect(filtered.reviewLog).toEqual([]);
    expect(filtered.plans).toEqual([]);
    expect(filtered.blocks).toEqual([]);
    expect(filtered.focusSessions).toEqual([]);
    expect(filtered.studySettings).toEqual([]);
    expect(filtered.notes).toEqual([]);
    expect(filtered.noteFolders).toEqual([]);
    expect(filtered.noteTags).toEqual([]);
    expect(filtered.noteTagLinks).toEqual([]);
    expect(filtered.noteTemplates).toEqual([]);
    expect(filtered.noteAttachments).toEqual([]);
    expect(filtered.noteVersions).toEqual([]);
    expect(filtered.dashboardSettings).toEqual([]);
    expect(filtered.dashboardSets).toEqual([]);
    expect(filtered.dashboardWidgets).toEqual([]);
  });

  it("drops a subject-note link whose note is not carried", () => {
    const data = everyModuleInput().data;
    expect(data.subjectNoteLinks).toHaveLength(1);

    const filtered = filterProfileData(data, new Set<ArchiveModuleId>(["study"]));
    expect(filtered.subjectNoteLinks).toEqual([]);
    // The other direction needs no rule of its own: dropping STUDY drops the
    // links with it, since the link row belongs to the STUDY module.
    expect(filterProfileData(data, new Set<ArchiveModuleId>(["notes"])).subjectNoteLinks).toEqual([]);
  });

  it("detaches a note-derived card from its note rather than dropping the card", () => {
    const data = everyModuleInput().data;
    const filtered = filterProfileData(data, new Set<ArchiveModuleId>(["study"]));

    expect(filtered.cards).toHaveLength(2);
    const derived = filtered.cards.find((card) => card.id === "c2");
    expect(derived).toMatchObject({ id: "c2", sourceNoteId: null, sourceBlockKey: null });
    // The FSRS history of that card is study data and stays untouched.
    expect(derived?.reps).toBe(4);
    expect(filtered.reviewLog).toHaveLength(1);
  });

  it("keeps a note-derived card attached when notes ride too", () => {
    const data = everyModuleInput().data;
    const filtered = filterProfileData(data, new Set<ArchiveModuleId>(["study", "notes"]));
    expect(filtered.cards.find((card) => card.id === "c2")).toMatchObject({
      sourceNoteId: "n1",
      sourceBlockKey: "blok-1",
    });
  });

  it("nulls a note's cardDeckId when the deck's module is not carried", () => {
    const data = everyModuleInput().data;
    const filtered = filterProfileData(data, new Set<ArchiveModuleId>(["notes"]));

    expect(filtered.notes).toHaveLength(1);
    expect(filtered.notes[0]).toMatchObject({ id: "n1", cardDeckId: null });
    // Everything else about the note survives — the deck is decoration on it.
    expect(filtered.notes[0]?.title).toBe("Beleška");
    expect(filtered.noteVersions).toHaveLength(1);
  });

  it("keeps a note's cardDeckId when study rides too", () => {
    const data = everyModuleInput().data;
    const filtered = filterProfileData(data, new Set<ArchiveModuleId>(["notes", "study"]));
    expect(filtered.notes[0]?.cardDeckId).toBe("dk1");
  });

  // A category and the `categoryId` that names it are ONE module, so the pair
  // never straddles the filter — unlike the three edges this suite exists for,
  // it needs no repair rule, and this pins that.
  it("drops a note's category WITH the note, and keeps the two together", () => {
    const data = everyModuleInput().data;

    const withoutNotes = filterProfileData(data, new Set<ArchiveModuleId>(["study"]));
    expect(withoutNotes.noteCategories).toEqual([]);
    expect(withoutNotes.notes).toEqual([]);

    const withNotes = filterProfileData(data, new Set<ArchiveModuleId>(["notes"]));
    expect(withNotes.noteCategories.map((row) => row.id)).toEqual(["nc1"]);
    expect(withNotes.notes[0]?.categoryId).toBe("nc1");
  });

  it("leaves an archive whose every cross-module edge is repaired countable", () => {
    const data = everyModuleInput().data;
    const filtered = filterProfileData(data, new Set<ArchiveModuleId>(["study"]));
    expect(countProfileModules(filtered)).toEqual({
      tasks: 0,
      calendar: 0,
      // 1 subject + 1 material + 0 links + 1 exam + 1 deck + 2 cards + 1 review
      // + 1 plan + 1 block + 1 focus session + 1 settings row.
      study: 11,
      notifications: 0,
      notes: 0,
      dashboard: 0,
      finance: 0,
    });
  });
});

/** The two blobs `everyModuleInput` hangs off a subject and off the dashboard — named so the subset tests can assert which one rode. */
const SUBJECT_BLOB = "5".repeat(64);
const BACKGROUND_BLOB = "6".repeat(64);

/**
 * One row in every module, wired up so that all three cross-module edges are
 * live: a subject↔note link, a note-derived card, and a note whose generated
 * cards go into a deck. Blobs hang off two different modules, so a subset can
 * be asked which of them rode.
 */
function everyModuleInput(): ExportArchiveInput {
  const input = emptyInput();
  const at = "2026-07-01T00:00:00.000Z";

  input.data.taskLists = [taskListRow({ id: LIST_ID, name: "Inbox" })];
  input.data.tasks = [
    {
      id: "t1", profileId: "profile1", parentId: null, title: "Zadatak", description: null,
      status: "todo", priority: "none", done: false, dueDate: null, startDate: null,
      createdAt: at, updatedAt: at, completedAt: null, recurrence: null, reminderOffsets: [],
      ...PLACED,
    },
  ];
  input.data.events = [
    {
      id: "e1", profileId: "profile1", title: "Sastanak", description: null,
      startAt: "2026-07-02T09:00:00.000Z", endAt: "2026-07-02T10:00:00.000Z", allDay: false,
      location: null, category: null, createdAt: at, updatedAt: at,
      recurrence: null, recurrenceExdates: [], reminderOffsets: [],
    },
  ];
  input.data.subjects = [
    {
      id: "s1", profileId: "profile1", name: "Analiza", color: "jade", semester: null,
      archived: false, createdAt: at, updatedAt: at,
    },
  ];
  input.data.subjectAttachments = [
    { id: "sa1", subjectId: "s1", fileName: "skripta.pdf", mime: "application/pdf", sizeBytes: 30, sha256: SUBJECT_BLOB, createdAt: at },
  ];
  input.data.subjectNoteLinks = [{ subjectId: "s1", noteId: "n1", createdAt: at } satisfies ExportSubjectNoteLink];
  input.data.exams = [
    { id: "ex1", profileId: "profile1", subjectId: "s1", examType: "pismeni", examDate: "2026-08-01", scope: null, createdAt: at, updatedAt: at },
  ];
  input.data.decks = [
    { id: "dk1", profileId: "profile1", subjectId: "s1", name: "Glava 1", createdAt: at, updatedAt: at },
  ];
  const card = (overrides: Pick<ExportCard, "id" | "sourceNoteId" | "sourceBlockKey" | "reps">): ExportCard => ({
    profileId: "profile1", deckId: "dk1", front: "Q", back: "A",
    due: "2026-07-02T00:00:00.000Z", stability: 1, difficulty: 2, elapsedDays: 0,
    scheduledDays: 1, learningSteps: 0, lapses: 0, state: 0, lastReview: null,
    createdAt: at, updatedAt: at, ...overrides,
  });
  input.data.cards = [
    card({ id: "c1", sourceNoteId: null, sourceBlockKey: null, reps: 0 }),
    card({ id: "c2", sourceNoteId: "n1", sourceBlockKey: "blok-1", reps: 4 }),
  ];
  input.data.reviewLog = [
    {
      id: "rl1", profileId: "profile1", cardId: "c2", rating: 3, state: 2, due: "2026-07-03T00:00:00.000Z",
      stability: 1, difficulty: 2, elapsedDays: 1, lastElapsedDays: 0, scheduledDays: 1, learningSteps: 0,
      review: "2026-07-02T00:00:00.000Z", createdAt: "2026-07-02T00:00:00.000Z",
    },
  ];
  input.data.plans = [
    { id: "p1", profileId: "profile1", examId: "ex1", dailyMinutes: 60, startDate: "2026-07-01", examWeekBoost: true, createdAt: at, updatedAt: at },
  ];
  input.data.blocks = [
    { id: "b1", planId: "p1", profileId: "profile1", blockDate: "2026-07-02", minutes: 60, status: "planned", createdAt: at, updatedAt: at },
  ];
  input.data.focusSessions = [
    { id: "f1", profileId: "profile1", subjectId: "s1", startedAt: "2026-07-01T10:00:00.000Z", endedAt: "2026-07-01T11:00:00.000Z", createdAt: at, updatedAt: at },
  ];
  input.data.studySettings = [
    { profileId: "profile1", targetRetention: 0.9, newPerDay: 20, maxReviewsPerDay: null },
  ];
  input.data.calendarSettings = [
    { profileId: "profile1", semesterStart: "2026-10-01", semesterEnd: "2027-01-31" },
  ];
  input.data.notifications = [
    {
      id: "ntf1", profileId: "profile1", source: "task", entityId: "t1", occurrenceKey: "d-1",
      title: "Rok", body: "Zadatak", status: "delivered", snoozedUntil: null,
      deliveredAt: at, createdAt: at, updatedAt: at,
    },
  ];
  input.data.noteCategories = [
    { id: "nc1", profileId: "profile1", name: "sastanak", color: null, createdAt: at, updatedAt: at },
  ];
  input.data.notes = [
    { ...noteRow({ id: "n1", title: "Beleška", categoryId: "nc1", snapshot: emptyNoteSnapshot() }), cardDeckId: "dk1" },
  ];
  input.data.noteVersions = [
    { noteId: "n1", coveredSeq: 1, title: "Beleška", createdAt: at, snapshot: emptyNoteSnapshot() },
  ];
  input.data.dashboardSettings = [
    { profileId: "profile1", backgroundHash: BACKGROUND_BLOB, backgroundMime: "image/png", backgroundSizeBytes: 40, backgroundDim: 40, activeSetId: "set1" },
  ];
  input.data.dashboardSets = [
    { id: "set1", profileId: "profile1", name: "Fakultet", position: 1024, createdAt: at, updatedAt: at },
  ];
  input.data.dashboardWidgets = [
    { instanceId: "w1", profileId: "profile1", widgetId: "tasks:danas", size: "M", position: 1024, config: null, createdAt: at, updatedAt: at, setId: "set1" },
  ];
  return input;
}

// --- Private notes (PRIV v1, ADR-057 §6) -------------------------------------

/** Encodes a doc whose "default" fragment holds one paragraph of `text` — a real, decodable Yjs state for a private envelope. */
function privateTextSnapshot(text: string): Uint8Array {
  const doc = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment("default").push([paragraph]);
  const snapshot = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return snapshot;
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** A lowercase UUID, the one shape `main` ever names a sealed blob file by. */
const PRIVATE_ATT_A = "0a1b2c3d-1111-4222-8333-abcdefabcdef";
const PRIVATE_ATT_B = "ffffffff-2222-4333-8444-000000000001";

/** One live note carrying two attachments, one bare note, and one version of the first note still referencing the SAME first attachment — the dedup's case. */
function privateNotesInput() {
  const T0 = "2026-07-01T00:00:00.000Z";
  const T1 = "2026-07-02T00:00:00.000Z";
  return {
    notes: [
      {
        id: "pn-1", title: "Tajni plan", yjsState: b64(privateTextSnapshot("Sadržaj")),
        plaintext: "Sadržaj",
        attachments: [
          { id: PRIVATE_ATT_A, fileName: "slika.png", mime: "image/png", sizeBytes: 3 },
          { id: PRIVATE_ATT_B, fileName: "ugovor.pdf", mime: "application/pdf", sizeBytes: 5 },
        ],
        createdAt: T0, updatedAt: T1,
      },
      {
        id: "pn-2", title: "", yjsState: b64(privateTextSnapshot("Druga")), plaintext: "Druga",
        attachments: [], createdAt: T0, updatedAt: T0,
      },
    ],
    versions: [
      {
        noteId: "pn-1", seq: 1, title: "Tajni plan (staro)",
        yjsState: b64(privateTextSnapshot("Staro")), plaintext: "Staro",
        attachments: [{ id: PRIVATE_ATT_A, fileName: "slika.png", mime: "image/png", sizeBytes: 3 }],
        createdAt: T0,
      },
    ],
  };
}

describe("private notes in the archive (PRIV v1, ADR-057 §6)", () => {
  it("writes the decrypted rows into data/private-notes.ndjson — notes first, then versions — and checksums the file", () => {
    const input = emptyInput();
    input.privateNotes = privateNotesInput();
    const archive = buildExportArchive(input);

    const rows = parseNdjson(archive.files.get("data/private-notes.ndjson") ?? "") as {
      type: string;
      id?: string;
      noteId?: string;
    }[];
    expect(rows.map((row) => [row.type, row.id ?? row.noteId])).toEqual([
      ["private-note", "pn-1"],
      ["private-note", "pn-2"],
      ["private-note-version", "pn-1"],
    ]);
    const manifest = JSON.parse(archive.files.get("manifest.json") ?? "") as {
      checksums: Record<string, string>;
    };
    expect(manifest.checksums["data/private-notes.ndjson"]).toBe(
      sha256(archive.files.get("data/private-notes.ndjson") ?? ""),
    );
  });

  it("mirrors each note under notes-private/<id>.md — the ID, never the title, anywhere in the entry listing", () => {
    const input = emptyInput();
    input.privateNotes = privateNotesInput();
    const archive = buildExportArchive(input);

    expect(archive.files.get("notes-private/pn-1.md")).toContain("Sadržaj");
    expect(archive.files.get("notes-private/pn-2.md")).toContain("Druga");
    // The title must not leak into a zip listing even inside the sealed
    // container — the whole reason the path diverges from public notes'.
    expect([...archive.files.keys()].every((path) => !path.includes("Tajni"))).toBe(true);
    // Versions get no mirror, exactly as note versions get none.
    expect([...archive.files.keys()].filter((path) => path.startsWith("notes-private/"))).toHaveLength(2);
  });

  it("declares each attachment ONCE as a private-blob entry — its own namespace, never the blobs/ union — and lists it in the manifest", () => {
    const input = emptyInput();
    input.privateNotes = privateNotesInput();
    const archive = buildExportArchive(input);

    const privateEntries = archive.binaries.filter((entry) => entry.kind === "private-blob");
    // ATT_A is referenced by the live envelope AND the version — one entry.
    expect(privateEntries.map((entry) => entry.path).sort()).toEqual([
      `private-blobs/${PRIVATE_ATT_A}`,
      `private-blobs/${PRIVATE_ATT_B}`,
    ]);
    const manifest = JSON.parse(archive.files.get("manifest.json") ?? "") as {
      blobs: unknown[];
      privateBlobs: { id: string; sizeBytes: number }[];
    };
    expect(manifest.privateBlobs).toEqual([
      { id: PRIVATE_ATT_A, sizeBytes: 3 },
      { id: PRIVATE_ATT_B, sizeBytes: 5 },
    ]);
    // NOT the content-addressed union: no sha256 identity exists for them.
    expect(manifest.blobs).toEqual([]);
  });

  it("rides OUTSIDE the module choice — a tasks-only subset still carries the whole private section", () => {
    const input = emptyInput();
    input.modules = new Set<ArchiveModuleId>(["tasks"]);
    input.privateNotes = privateNotesInput();
    const archive = buildExportArchive(input);

    expect(parseNdjson(archive.files.get("data/private-notes.ndjson") ?? "")).toHaveLength(3);
    // And counts into no module: the manifest's arithmetic is untouched.
    expect(archive.totalRecords).toBe(0);
  });
});
