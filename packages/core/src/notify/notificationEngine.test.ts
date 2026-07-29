import { describe, expect, it } from "vitest";
import { deriveNotificationCandidates } from "./notificationEngine.js";

const ALL_SOURCES = ["document", "exam", "study-day", "event"] as const;

describe("deriveNotificationCandidates", () => {
  describe("documents", () => {
    it("derives an occurrence per offset, keyed by the offset, firing at expiryDate - offset days", () => {
      const result = deriveNotificationCandidates({
        documents: [{ id: "doc1", expiryDate: "2026-08-10", reminderOffsets: [14] }],
        exams: [],
        events: [],
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
        events: [],
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
        events: [],
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
        events: [],
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
        events: [],
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
        events: [],
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
        events: [],
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
        events: [],
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
        events: [],
        studyDays: [{ date: "2026-07-11", blockCount: 2, totalMinutes: 60 }],
        enabledSources: ALL_SOURCES,
        today: "2026-07-12",
        nowLocalTime: "08:00",
        morningHour: "08:00",
      });

      expect(result).toEqual([]);
    });
  });

  describe("events", () => {
    /** One timed occurrence of an event, plus the clock, in the shape every case below varies. */
    function timed(
      reminderOffsets: readonly number[],
      today: string,
      nowLocalTime: string,
      occurrenceDate = "2026-08-01",
      startTime: string | null = "10:00",
    ) {
      return deriveNotificationCandidates({
        documents: [],
        exams: [],
        events: [{ id: "ev1", occurrenceDate, startTime, reminderOffsets }],
        studyDays: [],
        enabledSources: ALL_SOURCES,
        today,
        nowLocalTime,
        morningHour: "08:00",
      });
    }

    const AT_0945 = {
      source: "event",
      entityId: "ev1",
      occurrenceKey: "2026-08-01 15",
      fireDate: "2026-08-01",
      priority: "normal",
    };

    it("fires a timed reminder from its fire instant until the occurrence starts, minute by minute", () => {
      expect(timed([15], "2026-08-01", "09:44")).toEqual([]); // one minute early
      expect(timed([15], "2026-08-01", "09:45")).toEqual([AT_0945]); // exactly at the fire instant
      expect(timed([15], "2026-08-01", "09:59")).toEqual([AT_0945]);
      expect(timed([15], "2026-08-01", "10:00")).toEqual([AT_0945]); // exactly at the start, still relevant
      expect(timed([15], "2026-08-01", "10:01")).toEqual([]); // the occurrence has begun; nothing left to warn about
    });

    it("treats offset 0 as 'at the start': due exactly then, not a minute before", () => {
      expect(timed([0], "2026-08-01", "09:59")).toEqual([]);
      expect(timed([0], "2026-08-01", "10:00")).toEqual([
        { ...AT_0945, occurrenceKey: "2026-08-01 0" },
      ]);
    });

    it("carries a lead time backwards across midnight, and catches up any time before the start", () => {
      // 10:00 minus 720 minutes lands on the previous day at 22:00.
      const yesterday = {
        source: "event",
        entityId: "ev1",
        occurrenceKey: "2026-08-01 720",
        fireDate: "2026-07-31", // the bare date of the fire INSTANT, not of the occurrence
        priority: "normal",
      };
      expect(timed([720], "2026-07-31", "21:59")).toEqual([]);
      expect(timed([720], "2026-07-31", "22:00")).toEqual([yesterday]);
      // Missed while the app was closed: it still fires the next morning, because
      // the occurrence it warns about has not happened yet.
      expect(timed([720], "2026-08-01", "09:00")).toEqual([yesterday]);
      expect(timed([720], "2026-08-01", "10:01")).toEqual([]);
    });

    it("degrades an all-day occurrence to the day-granular model: whole days back, firing at the morning hour", () => {
      const key = (offset: number) => ({
        source: "event",
        entityId: "ev1",
        occurrenceKey: `2026-08-01 ${offset}`,
        priority: "normal",
      });

      // 2880 minutes = 2 days back -> 2026-07-30, and not before the morning hour.
      expect(timed([0, 1440, 2880], "2026-07-30", "07:59", "2026-08-01", null)).toEqual([]);
      expect(timed([0, 1440, 2880], "2026-07-30", "08:00", "2026-08-01", null)).toEqual([
        { ...key(2880), fireDate: "2026-07-30" },
      ]);
      // On the day itself all three are due — the two earlier ones as catch-up.
      expect(timed([0, 1440, 2880], "2026-08-01", "08:00", "2026-08-01", null)).toEqual([
        { ...key(0), fireDate: "2026-08-01" },
        { ...key(1440), fireDate: "2026-07-31" },
        { ...key(2880), fireDate: "2026-07-30" },
      ]);
      // An all-day occurrence stays relevant for its whole day, and no longer.
      expect(timed([0], "2026-08-01", "23:59", "2026-08-01", null)).toEqual([
        { ...key(0), fireDate: "2026-08-01" },
      ]);
      expect(timed([0], "2026-08-02", "08:00", "2026-08-01", null)).toEqual([]);
      // A partial day of lead time cannot move a day-granular fire date.
      expect(timed([30], "2026-08-01", "08:00", "2026-08-01", null)).toEqual([
        { ...key(30), fireDate: "2026-08-01" },
      ]);
    });

    it("contributes nothing when the event source is disabled", () => {
      const result = deriveNotificationCandidates({
        documents: [],
        exams: [],
        events: [{ id: "ev1", occurrenceDate: "2026-08-01", startTime: "10:00", reminderOffsets: [15] }],
        studyDays: [],
        enabledSources: ["document", "exam", "study-day"],
        today: "2026-08-01",
        nowLocalTime: "09:50",
        morningHour: "08:00",
      });
      expect(result).toEqual([]);
    });

    it("orders one occurrence per (row, offset) deterministically, and sits between documents and exams", () => {
      const result = deriveNotificationCandidates({
        documents: [{ id: "doc-1", expiryDate: "2026-08-10", reminderOffsets: [7] }],
        exams: [{ id: "exam-1", examDate: "2026-08-04" }],
        // A recurring series is expanded by the CALLER: two occurrences of one
        // master arrive as two rows sharing an id, told apart by their date.
        events: [
          { id: "ev-b", occurrenceDate: "2026-08-03", startTime: "10:00", reminderOffsets: [30, 5] },
          { id: "ev-a", occurrenceDate: "2026-08-10", startTime: null, reminderOffsets: [10080] },
        ],
        studyDays: [{ date: "2026-08-03", blockCount: 1, totalMinutes: 30 }],
        enabledSources: ALL_SOURCES,
        today: "2026-08-03",
        nowLocalTime: "09:56", // past both of ev-b's fire instants (09:30 and 09:55), before its 10:00 start
        morningHour: "08:00",
      });

      expect(result).toEqual([
        { source: "document", entityId: "doc-1", occurrenceKey: "7", fireDate: "2026-08-03", priority: "max" },
        // "2026-08-10 10080" sorts before "2026-08-03 …" only across entity ids;
        // within one row, the offsets order lexically ("30" < "5").
        { source: "event", entityId: "ev-a", occurrenceKey: "2026-08-10 10080", fireDate: "2026-08-03", priority: "normal" },
        { source: "event", entityId: "ev-b", occurrenceKey: "2026-08-03 30", fireDate: "2026-08-03", priority: "normal" },
        { source: "event", entityId: "ev-b", occurrenceKey: "2026-08-03 5", fireDate: "2026-08-03", priority: "normal" },
        { source: "exam", entityId: "exam-1", occurrenceKey: "d-1", fireDate: "2026-08-03", priority: "normal" },
        { source: "study-day", entityId: "2026-08-03", occurrenceKey: "day", fireDate: "2026-08-03", priority: "normal" },
      ]);
    });
  });

  describe("enabledSources", () => {
    it("omits every occurrence of a source absent from enabledSources", () => {
      const result = deriveNotificationCandidates({
        documents: [{ id: "doc1", expiryDate: "2026-08-10", reminderOffsets: [7] }],
        exams: [{ id: "exam1", examDate: "2026-08-04" }],
        events: [],
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
        events: [],
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
