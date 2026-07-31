/**
 * All timestamps in this file are mid-day UTC (e.g. "...T12:00:00.000Z") —
 * never near midnight. `StatsStore` buckets every day-range query by
 * `date(x, 'localtime')`, which depends on the host machine's timezone;
 * mid-day UTC maps to the same calendar date in every timezone from UTC-11 to
 * UTC+11, so these tests pass identically on the founder's UTC+2 machine and
 * on UTC CI.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FocusValidationError,
  NexusDatabase,
  openDatabase,
  StatsStore,
  SubjectStore,
  uuidv7,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-stats-"));
  db = openDatabase({ path: join(dir, "stats.db") });
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

function insertFocusSession(
  profileId: string,
  subjectId: string,
  startedAt: string,
  endedAt: string,
  deletedAt: string | null = null,
): string {
  const id = uuidv7();
  const now = new Date().toISOString();
  db.raw
    .prepare(
      `INSERT INTO focus_sessions
         (id, profile_id, subject_id, started_at, ended_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, profileId, subjectId, startedAt, endedAt, now, now, deletedAt);
  return id;
}

function insertDeck(profileId: string, subjectId: string): string {
  const id = uuidv7();
  const now = new Date().toISOString();
  db.raw
    .prepare(
      `INSERT INTO decks (id, profile_id, subject_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, profileId, subjectId, "Deck", now, now);
  return id;
}

function insertCard(profileId: string, deckId: string): string {
  const id = uuidv7();
  const now = new Date().toISOString();
  db.raw
    .prepare(
      `INSERT INTO cards
         (id, profile_id, deck_id, front, back, due, stability, difficulty,
          elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, profileId, deckId, "front", "back", now, 0, 0, 0, 0, 0, 0, 0, 2, now, now);
  return id;
}

function insertReview(profileId: string, cardId: string, review: string): void {
  const now = new Date().toISOString();
  db.raw
    .prepare(
      `INSERT INTO review_log
         (id, profile_id, card_id, rating, state, due, stability, difficulty,
          elapsed_days, last_elapsed_days, scheduled_days, learning_steps,
          review, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(uuidv7(), profileId, cardId, 3, 2, now, 1, 1, 0, 0, 1, 0, review, now);
}

function insertExam(
  profileId: string,
  subjectId: string,
  examDate: string,
  // Explicit where the ORDER of the returned ids is what a test asserts (two
  // exams on one day tie-break by id); generated everywhere else.
  id: string = uuidv7(),
  deletedAt: string | null = null,
): string {
  const now = new Date().toISOString();
  db.raw
    .prepare(
      `INSERT INTO exams
         (id, profile_id, subject_id, exam_type, exam_date, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, profileId, subjectId, "pismeni", examDate, now, now, deletedAt);
  return id;
}

function insertPlan(profileId: string, examId: string, deletedAt: string | null = null): string {
  const id = uuidv7();
  const now = new Date().toISOString();
  db.raw
    .prepare(
      `INSERT INTO study_plans
         (id, profile_id, exam_id, daily_minutes, start_date, exam_week_boost,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, profileId, examId, 30, "2026-07-01", 1, now, now, deletedAt);
  return id;
}

function insertBlock(
  profileId: string,
  planId: string,
  blockDate: string,
  status: string,
  updatedAt: string,
  minutes = 30,
): void {
  const now = new Date().toISOString();
  db.raw
    .prepare(
      `INSERT INTO study_blocks
         (id, plan_id, profile_id, block_date, minutes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(uuidv7(), planId, profileId, blockDate, minutes, status, now, updatedAt);
}

/** A profile with one subject, plus the stats store scoped to it. */
function fixture(): {
  stats: StatsStore;
  subjects: SubjectStore;
  profileId: string;
  subjectId: string;
} {
  const profileId = createProfile();
  const subjects = new SubjectStore(db.raw, profileId);
  const subjectId = subjects.create({ name: "Analiza 1" }).id;
  return { stats: new StatsStore(db.raw, profileId), subjects, profileId, subjectId };
}

describe("StatsStore", () => {
  describe("subjectMinutes", () => {
    it("sums active focus-session minutes across multiple sessions of a subject", () => {
      const { stats, profileId, subjectId } = fixture();
      insertFocusSession(profileId, subjectId, "2026-07-08T12:00:00.000Z", "2026-07-08T12:20:00.000Z"); // 20 min
      insertFocusSession(profileId, subjectId, "2026-07-08T14:00:00.000Z", "2026-07-08T14:25:00.000Z"); // 25 min

      expect(stats.subjectMinutes("2026-07-08", "2026-07-08")).toEqual([
        { subjectId, minutes: 45 },
      ]);
    });

    it("rounds a fractional total to the nearest integer minute", () => {
      const { stats, profileId, subjectId } = fixture();
      // 45 minutes 40 seconds = 45.667 min -> rounds to 46.
      insertFocusSession(profileId, subjectId, "2026-07-08T12:00:00.000Z", "2026-07-08T12:45:40.000Z");

      expect(stats.subjectMinutes("2026-07-08", "2026-07-08")).toEqual([
        { subjectId, minutes: 46 },
      ]);
    });

    it("groups by subject and orders by minutes desc then subjectId", () => {
      const { stats, subjects, profileId } = fixture();
      const subjectA = subjects.create({ name: "A" }).id;
      const subjectB = subjects.create({ name: "B" }).id;
      insertFocusSession(profileId, subjectA, "2026-07-08T12:00:00.000Z", "2026-07-08T12:10:00.000Z"); // 10
      insertFocusSession(profileId, subjectB, "2026-07-08T12:00:00.000Z", "2026-07-08T13:00:00.000Z"); // 60

      expect(stats.subjectMinutes("2026-07-08", "2026-07-08")).toEqual([
        { subjectId: subjectB, minutes: 60 },
        { subjectId: subjectA, minutes: 10 },
      ]);
    });

    it("filters by the local-day range; subjects with zero time in range are absent", () => {
      const { stats, profileId, subjectId } = fixture();
      insertFocusSession(profileId, subjectId, "2026-07-01T12:00:00.000Z", "2026-07-01T13:00:00.000Z");
      expect(stats.subjectMinutes("2026-07-08", "2026-07-09")).toEqual([]);
    });

    it("excludes soft-deleted sessions", () => {
      const { stats, profileId, subjectId } = fixture();
      insertFocusSession(
        profileId,
        subjectId,
        "2026-07-08T12:00:00.000Z",
        "2026-07-08T13:00:00.000Z",
        "2026-07-08T13:00:00.000Z",
      );
      expect(stats.subjectMinutes("2026-07-08", "2026-07-08")).toEqual([]);
    });

    it("isolates between profiles", () => {
      const a = fixture();
      const b = fixture();
      insertFocusSession(a.profileId, a.subjectId, "2026-07-08T12:00:00.000Z", "2026-07-08T13:00:00.000Z");
      expect(b.stats.subjectMinutes("2026-07-08", "2026-07-08")).toEqual([]);
    });

    it("rejects a malformed fromDate or toDate", () => {
      const { stats } = fixture();
      expect(() => stats.subjectMinutes("not-a-date", "2026-07-08")).toThrow(FocusValidationError);
      expect(() => stats.subjectMinutes("2026-07-08", "not-a-date")).toThrow(FocusValidationError);
    });
  });

  describe("activityDays", () => {
    it("unions review_log, focus_sessions, and done study_blocks, deduplicated and sorted", () => {
      const { stats, profileId, subjectId } = fixture();
      const deckId = insertDeck(profileId, subjectId);
      const cardId = insertCard(profileId, deckId);
      insertReview(profileId, cardId, "2026-07-08T12:00:00.000Z");
      insertFocusSession(profileId, subjectId, "2026-07-09T12:00:00.000Z", "2026-07-09T13:00:00.000Z");
      // A second review on the same day as the focus session must not duplicate the day.
      insertReview(profileId, cardId, "2026-07-09T18:00:00.000Z");
      const examId = insertExam(profileId, subjectId, "2026-08-01");
      const planId = insertPlan(profileId, examId);
      insertBlock(profileId, planId, "2026-07-10", "done", "2026-07-10T12:00:00.000Z");

      expect(stats.activityDays("2026-07-01", "2026-07-31")).toEqual([
        "2026-07-08",
        "2026-07-09",
        "2026-07-10",
      ]);
    });

    it("excludes blocks whose plan is soft-deleted", () => {
      const { stats, profileId, subjectId } = fixture();
      const examId = insertExam(profileId, subjectId, "2026-08-01");
      const planId = insertPlan(profileId, examId, "2026-07-10T12:00:00.000Z");
      insertBlock(profileId, planId, "2026-07-10", "done", "2026-07-10T12:00:00.000Z");
      expect(stats.activityDays("2026-07-01", "2026-07-31")).toEqual([]);
    });

    it("ignores planned/missed blocks (only done counts as activity)", () => {
      const { stats, profileId, subjectId } = fixture();
      const examId = insertExam(profileId, subjectId, "2026-08-01");
      const planId = insertPlan(profileId, examId);
      insertBlock(profileId, planId, "2026-07-10", "planned", "2026-07-10T12:00:00.000Z");
      insertBlock(profileId, planId, "2026-07-11", "missed", "2026-07-11T12:00:00.000Z");
      expect(stats.activityDays("2026-07-01", "2026-07-31")).toEqual([]);
    });

    it("excludes soft-deleted focus sessions", () => {
      const { stats, profileId, subjectId } = fixture();
      insertFocusSession(
        profileId,
        subjectId,
        "2026-07-08T12:00:00.000Z",
        "2026-07-08T13:00:00.000Z",
        "2026-07-08T13:00:00.000Z",
      );
      expect(stats.activityDays("2026-07-01", "2026-07-31")).toEqual([]);
    });

    it("filters by range", () => {
      const { stats, profileId, subjectId } = fixture();
      insertFocusSession(profileId, subjectId, "2026-06-01T12:00:00.000Z", "2026-06-01T13:00:00.000Z");
      expect(stats.activityDays("2026-07-01", "2026-07-31")).toEqual([]);
    });

    it("isolates between profiles", () => {
      const a = fixture();
      const b = fixture();
      insertFocusSession(a.profileId, a.subjectId, "2026-07-08T12:00:00.000Z", "2026-07-08T13:00:00.000Z");
      expect(b.stats.activityDays("2026-07-01", "2026-07-31")).toEqual([]);
    });

    it("rejects a malformed fromDate or toDate", () => {
      const { stats } = fixture();
      expect(() => stats.activityDays("not-a-date", "2026-07-08")).toThrow(FocusValidationError);
    });
  });

  describe("reviewCounts", () => {
    it("counts reviews per local day ascending, plus the total", () => {
      const { stats, profileId, subjectId } = fixture();
      const deckId = insertDeck(profileId, subjectId);
      const cardId = insertCard(profileId, deckId);
      insertReview(profileId, cardId, "2026-07-09T12:00:00.000Z");
      insertReview(profileId, cardId, "2026-07-08T12:00:00.000Z");
      insertReview(profileId, cardId, "2026-07-08T18:00:00.000Z");

      const result = stats.reviewCounts("2026-07-01", "2026-07-31");
      expect(result.total).toBe(3);
      expect(result.perDay).toEqual([
        { day: "2026-07-08", count: 2 },
        { day: "2026-07-09", count: 1 },
      ]);
    });

    it("filters by range", () => {
      const { stats, profileId, subjectId } = fixture();
      const deckId = insertDeck(profileId, subjectId);
      const cardId = insertCard(profileId, deckId);
      insertReview(profileId, cardId, "2026-06-01T12:00:00.000Z");

      expect(stats.reviewCounts("2026-07-01", "2026-07-31")).toEqual({ total: 0, perDay: [] });
    });

    it("isolates between profiles", () => {
      const a = fixture();
      const b = fixture();
      const deckId = insertDeck(a.profileId, a.subjectId);
      const cardId = insertCard(a.profileId, deckId);
      insertReview(a.profileId, cardId, "2026-07-08T12:00:00.000Z");

      expect(b.stats.reviewCounts("2026-07-01", "2026-07-31")).toEqual({ total: 0, perDay: [] });
    });

    it("rejects a malformed fromDate or toDate", () => {
      const { stats } = fixture();
      expect(() => stats.reviewCounts("2026-07-01", "not-a-date")).toThrow(FocusValidationError);
    });
  });

  describe("blockTotals", () => {
    it("counts done and missed blocks joined through active plans", () => {
      const { stats, profileId, subjectId } = fixture();
      const examId = insertExam(profileId, subjectId, "2026-08-01");
      const planId = insertPlan(profileId, examId);
      insertBlock(profileId, planId, "2026-07-08", "done", "2026-07-08T12:00:00.000Z");
      insertBlock(profileId, planId, "2026-07-09", "missed", "2026-07-09T12:00:00.000Z");
      insertBlock(profileId, planId, "2026-07-10", "planned", "2026-07-10T12:00:00.000Z");

      expect(stats.blockTotals("2026-07-01", "2026-07-31")).toEqual({ done: 1, missed: 1 });
    });

    it("excludes blocks whose plan is soft-deleted", () => {
      const { stats, profileId, subjectId } = fixture();
      const examId = insertExam(profileId, subjectId, "2026-08-01");
      const planId = insertPlan(profileId, examId, "2026-07-10T12:00:00.000Z");
      insertBlock(profileId, planId, "2026-07-08", "done", "2026-07-08T12:00:00.000Z");

      expect(stats.blockTotals("2026-07-01", "2026-07-31")).toEqual({ done: 0, missed: 0 });
    });

    it("filters on the block_date range", () => {
      const { stats, profileId, subjectId } = fixture();
      const examId = insertExam(profileId, subjectId, "2026-08-01");
      const planId = insertPlan(profileId, examId);
      insertBlock(profileId, planId, "2026-06-01", "done", "2026-06-01T12:00:00.000Z");

      expect(stats.blockTotals("2026-07-01", "2026-07-31")).toEqual({ done: 0, missed: 0 });
    });

    it("returns zeros when there are no blocks", () => {
      const { stats } = fixture();
      expect(stats.blockTotals("2026-07-01", "2026-07-31")).toEqual({ done: 0, missed: 0 });
    });

    it("isolates between profiles", () => {
      const a = fixture();
      const b = fixture();
      const examId = insertExam(a.profileId, a.subjectId, "2026-08-01");
      const planId = insertPlan(a.profileId, examId);
      insertBlock(a.profileId, planId, "2026-07-08", "done", "2026-07-08T12:00:00.000Z");

      expect(b.stats.blockTotals("2026-07-01", "2026-07-31")).toEqual({ done: 0, missed: 0 });
    });

    it("rejects a malformed fromDate or toDate", () => {
      const { stats } = fixture();
      expect(() => stats.blockTotals("not-a-date", "2026-07-31")).toThrow(FocusValidationError);
    });
  });

  describe("studyLogForSubject", () => {
    /** One card of this subject, ready to be reviewed against. */
    function cardOf(profileId: string, subjectId: string): string {
      return insertCard(profileId, insertDeck(profileId, subjectId));
    }

    /** An active plan of this subject, via a (necessarily active) exam of it. */
    function planOf(profileId: string, subjectId: string, examDate = "2026-08-01"): string {
      return insertPlan(profileId, insertExam(profileId, subjectId, examDate));
    }

    it("returns an empty log with nothing older for a subject that has no history", () => {
      const { stats, subjectId } = fixture();
      expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31")).toEqual({
        days: [],
        hasOlder: false,
      });
    });

    it("buckets this subject's reviews per local day, newest day first", () => {
      const { stats, profileId, subjectId } = fixture();
      const cardId = cardOf(profileId, subjectId);
      insertReview(profileId, cardId, "2026-07-08T12:00:00.000Z");
      insertReview(profileId, cardId, "2026-07-08T18:00:00.000Z");
      insertReview(profileId, cardId, "2026-07-09T12:00:00.000Z");

      const log = stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31");
      expect(log.days).toEqual([
        { day: "2026-07-09", reviews: 1, focusMinutes: 0, plannedMinutes: 0, examIds: [] },
        { day: "2026-07-08", reviews: 2, focusMinutes: 0, plannedMinutes: 0, examIds: [] },
      ]);
    });

    it("counts only reviews of cards in THIS subject's decks", () => {
      const { stats, subjects, profileId, subjectId } = fixture();
      const otherSubjectId = subjects.create({ name: "Fizika" }).id;
      insertReview(profileId, cardOf(profileId, otherSubjectId), "2026-07-08T12:00:00.000Z");

      expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").days).toEqual([]);
    });

    it("sums focus minutes per day, rounding the day's total once", () => {
      const { stats, profileId, subjectId } = fixture();
      // 20 min + 25 min 40 s = 45.667 min for the day -> 46, not 20 + 26.
      insertFocusSession(profileId, subjectId, "2026-07-08T12:00:00.000Z", "2026-07-08T12:20:00.000Z");
      insertFocusSession(profileId, subjectId, "2026-07-08T14:00:00.000Z", "2026-07-08T14:25:40.000Z");

      expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").days).toEqual([
        { day: "2026-07-08", reviews: 0, focusMinutes: 46, plannedMinutes: 0, examIds: [] },
      ]);
    });

    it("gives no day of its own to focus time that rounds to zero minutes", () => {
      const { stats, profileId, subjectId } = fixture();
      insertFocusSession(profileId, subjectId, "2026-07-08T12:00:00.000Z", "2026-07-08T12:00:20.000Z");

      expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").days).toEqual([]);
    });

    it("excludes soft-deleted focus sessions and another subject's sessions", () => {
      const { stats, subjects, profileId, subjectId } = fixture();
      const otherSubjectId = subjects.create({ name: "Fizika" }).id;
      insertFocusSession(
        profileId,
        subjectId,
        "2026-07-08T12:00:00.000Z",
        "2026-07-08T13:00:00.000Z",
        "2026-07-08T13:00:00.000Z",
      );
      insertFocusSession(profileId, otherSubjectId, "2026-07-08T12:00:00.000Z", "2026-07-08T13:00:00.000Z");

      expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").days).toEqual([]);
    });

    it("sums a day's planned block minutes whatever each block's status is", () => {
      const { stats, profileId, subjectId } = fixture();
      // Two plans, because a plan holds at most one block per date (migration
      // 007's unique index) — a day only accumulates minutes when the subject
      // is being studied for two exams at once, which is exactly the case worth
      // summing.
      const planId = planOf(profileId, subjectId, "2026-08-01");
      const secondPlanId = planOf(profileId, subjectId, "2026-08-15");
      insertBlock(profileId, planId, "2026-07-08", "done", "2026-07-08T12:00:00.000Z", 30);
      insertBlock(profileId, secondPlanId, "2026-07-08", "missed", "2026-07-08T12:00:00.000Z", 20);
      insertBlock(profileId, planId, "2026-07-09", "planned", "2026-07-09T12:00:00.000Z", 45);

      expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").days).toEqual([
        { day: "2026-07-09", reviews: 0, focusMinutes: 0, plannedMinutes: 45, examIds: [] },
        { day: "2026-07-08", reviews: 0, focusMinutes: 0, plannedMinutes: 50, examIds: [] },
      ]);
    });

    it("excludes blocks of a soft-deleted plan and blocks of another subject's plan", () => {
      const { stats, subjects, profileId, subjectId } = fixture();
      const deletedPlanId = insertPlan(
        profileId,
        insertExam(profileId, subjectId, "2026-08-01"),
        "2026-07-10T12:00:00.000Z",
      );
      insertBlock(profileId, deletedPlanId, "2026-07-08", "planned", "2026-07-08T12:00:00.000Z");
      const otherPlanId = planOf(profileId, subjects.create({ name: "Fizika" }).id);
      insertBlock(profileId, otherPlanId, "2026-07-08", "planned", "2026-07-08T12:00:00.000Z");

      expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").days).toEqual([]);
    });

    it("marks each exam day with its exam ids, ordered by date then id", () => {
      const { stats, profileId, subjectId } = fixture();
      // Two exams on ONE day: explicit ids, because their order is the assertion.
      const second = insertExam(profileId, subjectId, "2026-07-08", "exam-b");
      const first = insertExam(profileId, subjectId, "2026-07-08", "exam-a");
      const later = insertExam(profileId, subjectId, "2026-07-09");

      expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").days).toEqual([
        { day: "2026-07-09", reviews: 0, focusMinutes: 0, plannedMinutes: 0, examIds: [later] },
        {
          day: "2026-07-08",
          reviews: 0,
          focusMinutes: 0,
          plannedMinutes: 0,
          examIds: [first, second],
        },
      ]);
    });

    it("reads an exam date that carries a time part as its calendar day", () => {
      const { stats, profileId, subjectId } = fixture();
      const examId = insertExam(profileId, subjectId, "2026-07-08T09:30");

      expect(stats.studyLogForSubject(subjectId, "2026-07-08", "2026-07-08").days).toEqual([
        { day: "2026-07-08", reviews: 0, focusMinutes: 0, plannedMinutes: 0, examIds: [examId] },
      ]);
    });

    it("excludes soft-deleted exams", () => {
      const { stats, profileId, subjectId } = fixture();
      insertExam(profileId, subjectId, "2026-07-08", uuidv7(), "2026-07-09T12:00:00.000Z");

      expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").days).toEqual([]);
    });

    it("composes all four sources onto one day", () => {
      const { stats, profileId, subjectId } = fixture();
      const cardId = cardOf(profileId, subjectId);
      insertReview(profileId, cardId, "2026-07-08T12:00:00.000Z");
      insertFocusSession(profileId, subjectId, "2026-07-08T12:00:00.000Z", "2026-07-08T12:45:00.000Z");
      const examId = insertExam(profileId, subjectId, "2026-07-08");
      insertBlock(profileId, insertPlan(profileId, examId), "2026-07-08", "done", "2026-07-08T12:00:00.000Z");

      expect(stats.studyLogForSubject(subjectId, "2026-07-08", "2026-07-08").days).toEqual([
        { day: "2026-07-08", reviews: 1, focusMinutes: 45, plannedMinutes: 30, examIds: [examId] },
      ]);
    });

    it("keeps a day out of the log when it falls outside the range", () => {
      const { stats, profileId, subjectId } = fixture();
      const cardId = cardOf(profileId, subjectId);
      insertReview(profileId, cardId, "2026-07-07T12:00:00.000Z");
      insertReview(profileId, cardId, "2026-07-11T12:00:00.000Z");
      insertFocusSession(profileId, subjectId, "2026-07-09T12:00:00.000Z", "2026-07-09T13:00:00.000Z");

      expect(stats.studyLogForSubject(subjectId, "2026-07-08", "2026-07-10").days).toEqual([
        { day: "2026-07-09", reviews: 0, focusMinutes: 60, plannedMinutes: 0, examIds: [] },
      ]);
    });

    it("isolates between profiles", () => {
      const a = fixture();
      const b = fixture();
      insertReview(a.profileId, cardOf(a.profileId, a.subjectId), "2026-07-08T12:00:00.000Z");
      insertFocusSession(a.profileId, a.subjectId, "2026-07-08T12:00:00.000Z", "2026-07-08T13:00:00.000Z");

      // The same subject id, asked of the other profile's store: no rows, and
      // nothing older either.
      expect(b.stats.studyLogForSubject(a.subjectId, "2026-07-01", "2026-07-31")).toEqual({
        days: [],
        hasOlder: false,
      });
    });

    describe("hasOlder", () => {
      it("is false when the subject's whole history sits inside the range", () => {
        const { stats, profileId, subjectId } = fixture();
        insertReview(profileId, cardOf(profileId, subjectId), "2026-07-08T12:00:00.000Z");

        expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").hasOlder).toBe(false);
      });

      it("is true for a review before the range", () => {
        const { stats, profileId, subjectId } = fixture();
        insertReview(profileId, cardOf(profileId, subjectId), "2026-06-30T12:00:00.000Z");

        expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").hasOlder).toBe(true);
      });

      it("is true for a focus session before the range", () => {
        const { stats, profileId, subjectId } = fixture();
        insertFocusSession(profileId, subjectId, "2026-06-30T12:00:00.000Z", "2026-06-30T13:00:00.000Z");

        expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").hasOlder).toBe(true);
      });

      it("is true for a study block before the range", () => {
        const { stats, profileId, subjectId } = fixture();
        insertBlock(
          profileId,
          planOf(profileId, subjectId),
          "2026-06-30",
          "done",
          "2026-06-30T12:00:00.000Z",
        );

        expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").hasOlder).toBe(true);
      });

      it("is true for an exam before the range", () => {
        const { stats, profileId, subjectId } = fixture();
        insertExam(profileId, subjectId, "2026-06-30");

        expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").hasOlder).toBe(true);
      });

      it("ignores a soft-deleted focus session, plan and exam", () => {
        const { stats, profileId, subjectId } = fixture();
        insertFocusSession(
          profileId,
          subjectId,
          "2026-06-30T12:00:00.000Z",
          "2026-06-30T13:00:00.000Z",
          "2026-06-30T13:00:00.000Z",
        );
        const examId = insertExam(profileId, subjectId, "2026-06-29", uuidv7(), "2026-06-30T12:00:00.000Z");
        insertBlock(
          profileId,
          insertPlan(profileId, examId, "2026-06-30T12:00:00.000Z"),
          "2026-06-28",
          "done",
          "2026-06-28T12:00:00.000Z",
        );

        expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").hasOlder).toBe(false);
      });

      it("ignores another subject's older history", () => {
        const { stats, subjects, profileId, subjectId } = fixture();
        const otherSubjectId = subjects.create({ name: "Fizika" }).id;
        insertReview(profileId, cardOf(profileId, otherSubjectId), "2026-06-30T12:00:00.000Z");
        insertFocusSession(profileId, otherSubjectId, "2026-06-30T12:00:00.000Z", "2026-06-30T13:00:00.000Z");

        expect(stats.studyLogForSubject(subjectId, "2026-07-01", "2026-07-31").hasOlder).toBe(false);
      });
    });

    it("rejects a malformed fromDay or toDay", () => {
      const { stats, subjectId } = fixture();
      expect(() => stats.studyLogForSubject(subjectId, "not-a-date", "2026-07-31")).toThrow(
        FocusValidationError,
      );
      expect(() => stats.studyLogForSubject(subjectId, "2026-07-01", "not-a-date")).toThrow(
        FocusValidationError,
      );
    });
  });
});
