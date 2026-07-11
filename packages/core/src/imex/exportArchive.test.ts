import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildExportArchive, type ExportArchiveInput } from "./exportArchive.js";

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
      events: [],
      documents: [],
      renewals: [],
      subjects: [],
      exams: [],
      decks: [],
      cards: [],
      reviewLog: [],
      plans: [],
      blocks: [],
      focusSessions: [],
      notifications: [],
    },
    hash: sha256,
  };
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

      // CSV mirrors still carry their header row.
      expect(archive.files.get("tables/tasks.csv")).toMatch(/^id,/);
      expect(archive.files.get("tables/tasks.csv")?.split("\r\n")).toEqual(
        expect.arrayContaining([expect.stringMatching(/^id,/)]),
      );

      expect(archive.totalRecords).toBe(0);
      expect(archive.byModule).toEqual({ tasks: 0, calendar: 0, study: 0, notifications: 0 });
    });
  });

  describe("manifest.json", () => {
    it("carries schemaVersion, appVersion, createdAt, profile, settings, module counts and checksums", () => {
      const input = emptyInput();
      const archive = buildExportArchive(input);
      const manifest = JSON.parse(archive.files.get("manifest.json") ?? "") as Record<string, unknown>;

      expect(manifest.schemaVersion).toBe("1.0.0");
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
      ]);
      expect(manifest.checksums).toEqual({
        "data/tasks.ndjson": sha256(""),
        "data/calendar.ndjson": sha256(""),
        "data/study.ndjson": sha256(""),
        "data/notifications.ndjson": sha256(""),
      });
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
        },
      ]);
      expect(Object.keys(rows[0] as object)[0]).toBe("type");
      expect(archive.byModule.tasks).toBe(1);
      expect(archive.totalRecords).toBe(1);
    });
  });

  describe("data/calendar.ndjson", () => {
    it("interleaves events, documents and renewals as type-discriminated records, in that order", () => {
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

      const archive = buildExportArchive(input);
      const rows = parseNdjson(archive.files.get("data/calendar.ndjson") ?? "") as Array<{ type: string }>;
      expect(rows.map((row) => row.type)).toEqual(["event", "document", "renewal"]);
      expect(archive.byModule.calendar).toBe(3);
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
          id: "c1", profileId: "profile1", deckId: "dk1", front: "Q", back: "A", due: "2026-01-02T00:00:00.000Z",
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
          id: "c1", profileId: "profile1", deckId: "dk1", front: "Q", back: "A", due: "2026-01-02T00:00:00.000Z",
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
      expect(archive.byModule).toEqual({ tasks: 1, calendar: 0, study: 0, notifications: 1 });
      expect(archive.totalRecords).toBe(2);
    });
  });
});
