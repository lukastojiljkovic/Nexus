import { describe, expect, it } from "vitest";
import { deriveNotificationCandidates } from "./notificationEngine.js";

const ALL_SOURCES = ["document", "exam", "study-day"] as const;

describe("deriveNotificationCandidates", () => {
  describe("documents", () => {
    it("derives an occurrence per offset, keyed by the offset, firing at expiryDate - offset days", () => {
      const result = deriveNotificationCandidates({
        documents: [{ id: "doc1", expiryDate: "2026-08-10", reminderOffsets: [14] }],
        exams: [],
        studyDays: [],
        enabledSources: ALL_SOURCES,
        today: "2026-07-27", // 2026-08-10 - 14 days
        nowLocalTime: "08:00",
        morningHour: "08:00",
      });

      expect(result).toEqual([
        {
          source: "document",
          entityId: "doc1",
          occurrenceKey: "14",
          fireDate: "2026-07-27",
          priority: "max", // the only offset is trivially the ladder's smallest
        },
      ]);
    });

    it("marks the smallest offset in the ladder as max priority, the rest normal", () => {
      const result = deriveNotificationCandidates({
        documents: [{ id: "doc1", expiryDate: "2026-08-10", reminderOffsets: [30, 7] }],
        exams: [],
        studyDays: [],
        enabledSources: ALL_SOURCES,
        today: "2026-08-03", // offset 7's fire date; offset 30's (2026-07-11) is already past
        nowLocalTime: "08:00",
        morningHour: "08:00",
      });

      // Sorted by occurrenceKey ("30" < "7" lexically).
      expect(result).toEqual([
        { source: "document", entityId: "doc1", occurrenceKey: "30", fireDate: "2026-07-11", priority: "normal" },
        { source: "document", entityId: "doc1", occurrenceKey: "7", fireDate: "2026-08-03", priority: "max" },
      ]);
    });

    it("drops all of a document's occurrences once today is strictly after its expiry date", () => {
      const result = deriveNotificationCandidates({
        documents: [{ id: "doc1", expiryDate: "2026-08-10", reminderOffsets: [90] }],
        exams: [],
        studyDays: [],
        enabledSources: ALL_SOURCES,
        today: "2026-08-11", // the day after expiry; the offset-90 fire date is long past
        nowLocalTime: "08:00",
        morningHour: "08:00",
      });

      expect(result).toEqual([]);
    });
  });

  describe("exams", () => {
    it("derives d-1 due at/after the morning hour on its fire date, and not before it", () => {
      const before = deriveNotificationCandidates({
        documents: [],
        exams: [{ id: "exam1", examDate: "2026-09-01" }],
        studyDays: [],
        enabledSources: ALL_SOURCES,
        today: "2026-08-31", // d-1's fire date; d-0's (2026-09-01) is still in the future
        nowLocalTime: "07:59",
        morningHour: "08:00",
      });
      expect(before).toEqual([]);

      const atBoundary = deriveNotificationCandidates({
        documents: [],
        exams: [{ id: "exam1", examDate: "2026-09-01" }],
        studyDays: [],
        enabledSources: ALL_SOURCES,
        today: "2026-08-31",
        nowLocalTime: "08:00",
        morningHour: "08:00",
      });
      expect(atBoundary).toEqual([
        { source: "exam", entityId: "exam1", occurrenceKey: "d-1", fireDate: "2026-08-31", priority: "normal" },
      ]);
    });

    it("derives both d-1 (missed while off) and d-0 (on time) once today reaches the exam date", () => {
      const result = deriveNotificationCandidates({
        documents: [],
        exams: [{ id: "exam1", examDate: "2026-09-01" }],
        studyDays: [],
        enabledSources: ALL_SOURCES,
        today: "2026-09-01",
        nowLocalTime: "09:00",
        morningHour: "08:00",
      });

      // Sorted by occurrenceKey ("d-0" < "d-1").
      expect(result).toEqual([
        { source: "exam", entityId: "exam1", occurrenceKey: "d-0", fireDate: "2026-09-01", priority: "normal" },
        { source: "exam", entityId: "exam1", occurrenceKey: "d-1", fireDate: "2026-08-31", priority: "normal" },
      ]);
    });

    it("drops both occurrences once today is strictly after the exam date", () => {
      const result = deriveNotificationCandidates({
        documents: [],
        exams: [{ id: "exam1", examDate: "2026-09-01" }],
        studyDays: [],
        enabledSources: ALL_SOURCES,
        today: "2026-09-02",
        nowLocalTime: "09:00",
        morningHour: "08:00",
      });

      expect(result).toEqual([]);
    });
  });

  describe("study days", () => {
    it("derives a due occurrence for a study day when today matches it exactly", () => {
      const result = deriveNotificationCandidates({
        documents: [],
        exams: [],
        studyDays: [{ date: "2026-07-11", blockCount: 2, totalMinutes: 60 }],
        enabledSources: ALL_SOURCES,
        today: "2026-07-11",
        nowLocalTime: "08:00",
        morningHour: "08:00",
      });

      expect(result).toEqual([
        { source: "study-day", entityId: "2026-07-11", occurrenceKey: "day", fireDate: "2026-07-11", priority: "normal" },
      ]);
    });

    it("drops a stale study day once today has moved past it (no catch-up, unlike documents/exams)", () => {
      const result = deriveNotificationCandidates({
        documents: [],
        exams: [],
        studyDays: [{ date: "2026-07-11", blockCount: 2, totalMinutes: 60 }],
        enabledSources: ALL_SOURCES,
        today: "2026-07-12",
        nowLocalTime: "08:00",
        morningHour: "08:00",
      });

      expect(result).toEqual([]);
    });
  });

  describe("enabledSources", () => {
    it("omits every occurrence of a source absent from enabledSources", () => {
      const result = deriveNotificationCandidates({
        documents: [{ id: "doc1", expiryDate: "2026-08-10", reminderOffsets: [7] }],
        exams: [{ id: "exam1", examDate: "2026-08-04" }],
        studyDays: [{ date: "2026-08-03", blockCount: 1, totalMinutes: 30 }],
        enabledSources: ["exam"],
        today: "2026-08-03",
        nowLocalTime: "08:00",
        morningHour: "08:00",
      });

      expect(result).toEqual([
        { source: "exam", entityId: "exam1", occurrenceKey: "d-1", fireDate: "2026-08-03", priority: "normal" },
      ]);
    });
  });

  describe("ordering", () => {
    it("orders the combined output by source, then entity id, then occurrence key", () => {
      const result = deriveNotificationCandidates({
        documents: [
          { id: "doc-b", expiryDate: "2026-08-10", reminderOffsets: [7] },
          { id: "doc-a", expiryDate: "2026-08-10", reminderOffsets: [7] },
        ],
        exams: [{ id: "exam-1", examDate: "2026-08-04" }],
        studyDays: [{ date: "2026-08-03", blockCount: 1, totalMinutes: 30 }],
        enabledSources: ALL_SOURCES,
        today: "2026-08-03",
        nowLocalTime: "08:00",
        morningHour: "08:00",
      });

      expect(result).toEqual([
        { source: "document", entityId: "doc-a", occurrenceKey: "7", fireDate: "2026-08-03", priority: "max" },
        { source: "document", entityId: "doc-b", occurrenceKey: "7", fireDate: "2026-08-03", priority: "max" },
        { source: "exam", entityId: "exam-1", occurrenceKey: "d-1", fireDate: "2026-08-03", priority: "normal" },
        { source: "study-day", entityId: "2026-08-03", occurrenceKey: "day", fireDate: "2026-08-03", priority: "normal" },
      ]);
    });
  });
});
