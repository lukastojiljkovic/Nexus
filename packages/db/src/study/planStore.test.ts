import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExamStore,
  ExamTopicNotFoundError,
  NexusDatabase,
  openDatabase,
  PlanNotFoundError,
  PlanStore,
  PlanValidationError,
  SubjectStore,
  TopicStore,
  uuidv7,
  type StudyBlockStatus,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

const T0 = "2026-07-08T10:00:00.000Z";
const TODAY = "2026-07-08";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-plans-"));
  db = openDatabase({ path: join(dir, "plans.db") });
});

afterEach(() => {
  vi.useRealTimers();
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

/** A profile with one subject and one exam a month out, plus the stores scoped to it. */
function fixture(): {
  plans: PlanStore;
  exams: ExamStore;
  subjects: SubjectStore;
  topics: TopicStore;
  examId: string;
  subjectId: string;
} {
  const profileId = createProfile();
  const subjects = new SubjectStore(db.raw, profileId);
  const subjectId = subjects.create({ name: "Analiza 1" }).id;
  const exams = new ExamStore(db.raw, profileId);
  const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-08-10" }).id;
  return {
    plans: new PlanStore(db.raw, profileId),
    exams,
    subjects,
    topics: new TopicStore(db.raw, profileId),
    examId,
    subjectId,
  };
}

describe("PlanStore", () => {
  describe("createPlan", () => {
    it("creates a plan and generates its blocks via the planning engine", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-05", examWeekBoost: false },
        T0,
        TODAY,
      );

      expect(created.examId).toBe(examId);
      expect(created.dailyMinutes).toBe(30);
      expect(created.startDate).toBe("2026-08-05");
      expect(created.examWeekBoost).toBe(false);
      expect(created.createdAt).toBe(T0);
      expect(created.updatedAt).toBe(T0);

      const blocks = plans.listBlocks(created.id);
      expect(blocks.map((b) => b.blockDate)).toEqual([
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
        "2026-08-08",
        "2026-08-09",
      ]);
      expect(blocks.every((b) => b.minutes === 30 && b.status === "planned")).toBe(true);
    });

    it("doubles minutes for the exam-week boost window", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 20, startDate: "2026-07-20", examWeekBoost: true },
        T0,
        TODAY,
      );

      const boosted = plans.listBlocks(created.id).filter((b) => b.minutes === 40);
      expect(boosted.map((b) => b.blockDate)).toEqual([
        "2026-08-03",
        "2026-08-04",
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
        "2026-08-08",
        "2026-08-09",
      ]);
    });

    it("rejects an examId that does not resolve to an active exam in this profile", () => {
      const { plans } = fixture();
      expect(() =>
        plans.createPlan(
          { examId: "missing", dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
          T0,
          TODAY,
        ),
      ).toThrow(PlanValidationError);
    });

    it("rejects an examId belonging to another profile", () => {
      const { plans } = fixture();
      const other = fixture();
      expect(() =>
        plans.createPlan(
          { examId: other.examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
          T0,
          TODAY,
        ),
      ).toThrow(PlanValidationError);
    });

    it("rejects an examId referencing a soft-deleted exam", () => {
      const { plans, exams, examId } = fixture();
      exams.softDelete(examId);
      expect(() =>
        plans.createPlan(
          { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
          T0,
          TODAY,
        ),
      ).toThrow(PlanValidationError);
    });

    it("rejects an exam date that is not strictly after today", () => {
      const { plans, exams, subjectId } = fixture();
      const pastExamId = exams.create({
        subjectId,
        examType: "pismeni",
        examDate: TODAY, // exam is today -> rejected
      }).id;

      expect(() =>
        plans.createPlan(
          { examId: pastExamId, dailyMinutes: 30, startDate: "2026-07-01", examWeekBoost: false },
          T0,
          TODAY,
        ),
      ).toThrow(PlanValidationError);
    });

    it("rejects a startDate on/after the exam date", () => {
      const { plans, examId } = fixture();
      expect(() =>
        plans.createPlan(
          { examId, dailyMinutes: 30, startDate: "2026-08-10", examWeekBoost: false },
          T0,
          TODAY,
        ),
      ).toThrow(PlanValidationError);
      expect(() =>
        plans.createPlan(
          { examId, dailyMinutes: 30, startDate: "2026-08-15", examWeekBoost: false },
          T0,
          TODAY,
        ),
      ).toThrow(PlanValidationError);
    });

    it("rejects a dailyMinutes outside 15..480 or non-integer", () => {
      const { plans, examId } = fixture();
      expect(() =>
        plans.createPlan(
          { examId, dailyMinutes: 14, startDate: "2026-08-01", examWeekBoost: false },
          T0,
          TODAY,
        ),
      ).toThrow(PlanValidationError);
      expect(() =>
        plans.createPlan(
          { examId, dailyMinutes: 481, startDate: "2026-08-01", examWeekBoost: false },
          T0,
          TODAY,
        ),
      ).toThrow(PlanValidationError);
      expect(() =>
        plans.createPlan(
          { examId, dailyMinutes: 30.5, startDate: "2026-08-01", examWeekBoost: false },
          T0,
          TODAY,
        ),
      ).toThrow(PlanValidationError);
    });

    it("rejects a malformed now, today, or startDate", () => {
      const { plans, examId } = fixture();
      expect(() =>
        plans.createPlan(
          { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
          "not-a-date",
          TODAY,
        ),
      ).toThrow(PlanValidationError);
      expect(() =>
        plans.createPlan(
          { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
          T0,
          "not-a-date",
        ),
      ).toThrow(PlanValidationError);
      expect(() =>
        plans.createPlan(
          { examId, dailyMinutes: 30, startDate: "2026-08-01T10:00", examWeekBoost: false },
          T0,
          TODAY,
        ),
      ).toThrow(PlanValidationError);
    });

    it("rejects a second active plan for the same exam", () => {
      const { plans, examId } = fixture();
      plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      expect(() =>
        plans.createPlan(
          { examId, dailyMinutes: 20, startDate: "2026-08-02", examWeekBoost: false },
          T0,
          TODAY,
        ),
      ).toThrow(PlanValidationError);
    });

    it("allows a new active plan for an exam whose only plan was soft-deleted", () => {
      const { plans, examId } = fixture();
      const first = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      plans.softDelete(first.id, T0);
      expect(() =>
        plans.createPlan(
          { examId, dailyMinutes: 20, startDate: "2026-08-02", examWeekBoost: false },
          T0,
          TODAY,
        ),
      ).not.toThrow();
    });
  });

  describe("listActive", () => {
    it("lists active plans for this profile ordered by start_date then id", () => {
      const { plans, exams, subjectId } = fixture();
      const examA = exams.create({ subjectId, examType: "pismeni", examDate: "2026-09-01" }).id;
      const examB = exams.create({ subjectId, examType: "usmeni", examDate: "2026-08-20" }).id;
      const planA = plans.createPlan(
        { examId: examA, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      const planB = plans.createPlan(
        { examId: examB, dailyMinutes: 30, startDate: "2026-07-25", examWeekBoost: false },
        T0,
        TODAY,
      );

      expect(plans.listActive().map((p) => p.id)).toEqual([planB.id, planA.id]);
    });

    it("excludes soft-deleted plans", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      plans.softDelete(created.id, T0);
      expect(plans.listActive()).toHaveLength(0);
    });
  });

  describe("updatePlan", () => {
    it("updates a plan's own fields and regenerates only future blocks", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );

      const updated = plans.updatePlan(
        created.id,
        { dailyMinutes: 45, startDate: "2026-08-03" },
        "2026-07-09T10:00:00.000Z",
        "2026-07-09",
      );

      expect(updated.dailyMinutes).toBe(45);
      expect(updated.startDate).toBe("2026-08-03");

      const blocks = plans.listBlocks(created.id);
      expect(blocks.map((b) => b.blockDate)).toEqual([
        "2026-08-03",
        "2026-08-04",
        "2026-08-05",
        "2026-08-06",
        "2026-08-07",
        "2026-08-08",
        "2026-08-09",
      ]);
      expect(blocks.every((b) => b.minutes === 45)).toBe(true);
    });

    it("leaves a done block untouched and does not duplicate its date", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      const firstBlock = plans.listBlocks(created.id)[0]!;
      plans.setBlockStatus(firstBlock.id, "done", T0);

      plans.updatePlan(created.id, { dailyMinutes: 50 }, T0, TODAY);

      const blocks = plans.listBlocks(created.id);
      const stillDone = blocks.find((b) => b.id === firstBlock.id);
      expect(stillDone?.status).toBe("done");
      expect(stillDone?.minutes).toBe(30); // untouched, not regenerated to 50

      const others = blocks.filter((b) => b.id !== firstBlock.id);
      expect(others.every((b) => b.minutes === 50)).toBe(true);
      expect(blocks).toHaveLength(9); // same 9 dates, no duplicate for firstBlock's date
    });

    it("throws PlanNotFoundError for an unknown or soft-deleted plan", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      plans.softDelete(created.id, T0);
      expect(() => plans.updatePlan(created.id, { dailyMinutes: 40 }, T0, TODAY)).toThrow(
        PlanNotFoundError,
      );
      expect(() => plans.updatePlan("missing", { dailyMinutes: 40 }, T0, TODAY)).toThrow(
        PlanNotFoundError,
      );
    });

    it("revalidates changed fields the same way as create", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      expect(() => plans.updatePlan(created.id, { dailyMinutes: 1000 }, T0, TODAY)).toThrow(
        PlanValidationError,
      );
      expect(() => plans.updatePlan(created.id, { startDate: "2026-08-10" }, T0, TODAY)).toThrow(
        PlanValidationError,
      );
    });

    it("applies the plan's current missed-minutes backlog when regenerating", () => {
      const { plans, exams, subjectId } = fixture();
      const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-07-14" }).id;
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-07-08", examWeekBoost: false },
        T0,
        TODAY,
      );

      // 07-08 and 07-09 fall behind "today" and become missed (60 backlog).
      plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10");

      // Changing dailyMinutes regenerates the 4 remaining future blocks from
      // the new base, then spreads the unchanged 60-minute backlog over them.
      plans.updatePlan(created.id, { dailyMinutes: 20 }, "2026-07-10T11:00:00.000Z", "2026-07-10");

      const future = plans
        .listBlocks(created.id)
        .filter((b) => b.status === "planned")
        .map((b) => b.minutes);
      expect(future).toEqual([35, 35, 35, 35]); // 20 + 60/4
    });
  });

  describe("softDelete / restore", () => {
    it("throws PlanNotFoundError for operations on an unknown or wrong-state plan", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      expect(() => plans.softDelete("missing", T0)).toThrow(PlanNotFoundError);
      expect(() => plans.restore(created.id, T0)).toThrow(PlanNotFoundError); // not deleted yet
      plans.softDelete(created.id, T0);
      expect(() => plans.softDelete(created.id, T0)).toThrow(PlanNotFoundError);
    });

    it("restores a soft-deleted plan", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      plans.softDelete(created.id, T0);
      plans.restore(created.id, T0);
      expect(plans.listActive().map((p) => p.id)).toEqual([created.id]);
    });

    it("surfaces a restore that would collide with a newer active plan as PlanValidationError", () => {
      const { plans, examId } = fixture();
      const first = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      plans.softDelete(first.id, T0);
      plans.createPlan(
        { examId, dailyMinutes: 20, startDate: "2026-08-02", examWeekBoost: false },
        T0,
        TODAY,
      );

      expect(() => plans.restore(first.id, T0)).toThrow(PlanValidationError);
    });
  });

  describe("listBlocks", () => {
    it("orders blocks by date then id", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-05", examWeekBoost: false },
        T0,
        TODAY,
      );
      const dates = plans.listBlocks(created.id).map((b) => b.blockDate);
      expect(dates).toEqual([...dates].sort());
    });

    it("throws PlanNotFoundError for an unknown, soft-deleted, or cross-profile plan", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      expect(() => plans.listBlocks("missing")).toThrow(PlanNotFoundError);

      const other = fixture();
      expect(() => other.plans.listBlocks(created.id)).toThrow(PlanNotFoundError);
    });
  });

  describe("listBlocksInRange", () => {
    it("returns blocks in range carrying planId and examId, ordered by date then id", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );

      const range = plans.listBlocksInRange("2026-08-03", "2026-08-05");
      expect(range.map((b) => b.blockDate)).toEqual(["2026-08-03", "2026-08-04", "2026-08-05"]);
      expect(range.every((b) => b.planId === created.id && b.examId === examId)).toBe(true);
    });

    it("excludes blocks whose plan is soft-deleted", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      plans.softDelete(created.id, T0);
      expect(plans.listBlocksInRange("2026-08-01", "2026-08-09")).toHaveLength(0);
    });

    it("excludes blocks whose exam is soft-deleted", () => {
      const { plans, exams, examId } = fixture();
      plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      exams.softDelete(examId);
      expect(plans.listBlocksInRange("2026-08-01", "2026-08-09")).toHaveLength(0);
    });

    it("isolates the range query between profiles", () => {
      const a = fixture();
      const b = fixture();
      a.plans.createPlan(
        { examId: a.examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      expect(b.plans.listBlocksInRange("2026-08-01", "2026-08-09")).toHaveLength(0);
    });
  });

  describe("setBlockStatus", () => {
    it("marks a block done and back to planned", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      const block = plans.listBlocks(created.id)[0]!;

      const done = plans.setBlockStatus(block.id, "done", T0);
      expect(done.status).toBe("done");

      const planned = plans.setBlockStatus(block.id, "planned", T0);
      expect(planned.status).toBe("planned");
    });

    it("rejects a status other than done/planned", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      const block = plans.listBlocks(created.id)[0]!;
      expect(() =>
        plans.setBlockStatus(block.id, "missed" as StudyBlockStatus, T0),
      ).toThrow(PlanValidationError);
    });

    it("throws PlanNotFoundError for an unknown or cross-profile block", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      const block = plans.listBlocks(created.id)[0]!;
      expect(() => plans.setBlockStatus("missing", "done", T0)).toThrow(PlanNotFoundError);

      const other = fixture();
      expect(() => other.plans.setBlockStatus(block.id, "done", T0)).toThrow(PlanNotFoundError);
    });
  });

  describe("sync", () => {
    it("marks past planned blocks as missed and leaves done blocks alone", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-07-08", examWeekBoost: false },
        T0,
        TODAY,
      );
      const blocks = plans.listBlocks(created.id);
      const doneBlock = blocks[0]!; // 2026-07-08
      plans.setBlockStatus(doneBlock.id, "done", T0);

      plans.sync(created.id, "2026-07-15T10:00:00.000Z", "2026-07-15");

      const after = plans.listBlocks(created.id);
      const stillDone = after.find((b) => b.id === doneBlock.id);
      expect(stillDone?.status).toBe("done");

      const pastOthers = after.filter((b) => b.blockDate < "2026-07-15" && b.id !== doneBlock.id);
      expect(pastOthers.length).toBeGreaterThan(0);
      expect(pastOthers.every((b) => b.status === "missed")).toBe(true);
    });

    it("regenerates future blocks and is idempotent for the same today", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-07-08", examWeekBoost: false },
        T0,
        TODAY,
      );

      plans.sync(created.id, "2026-07-15T10:00:00.000Z", "2026-07-15");
      const firstPass = plans
        .listBlocks(created.id)
        .map((b) => ({ date: b.blockDate, minutes: b.minutes, status: b.status }));

      plans.sync(created.id, "2026-07-15T10:00:00.000Z", "2026-07-15");
      const secondPass = plans
        .listBlocks(created.id)
        .map((b) => ({ date: b.blockDate, minutes: b.minutes, status: b.status }));

      expect(secondPass).toEqual(firstPass);
    });

    it("regenerates nothing once the exam date is on/before today, but still marks past-planned as missed", () => {
      const { plans, examId } = fixture(); // exam 2026-08-10
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-05", examWeekBoost: false },
        T0,
        TODAY,
      );

      plans.sync(created.id, "2026-08-10T10:00:00.000Z", "2026-08-10"); // exam day itself
      const after = plans.listBlocks(created.id);
      expect(after).toHaveLength(5); // no new blocks added
      expect(after.every((b) => b.status === "missed")).toBe(true);
    });

    it("throws PlanNotFoundError for an unknown or soft-deleted plan", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );
      plans.softDelete(created.id, T0);
      expect(() => plans.sync(created.id, T0, TODAY)).toThrow(PlanNotFoundError);
      expect(() => plans.sync("missing", T0, TODAY)).toThrow(PlanNotFoundError);
    });

    describe("catch-up replan (missed-minutes backlog)", () => {
      it("redistributes the missed-minutes backlog evenly across future blocks, no daily cap", () => {
        const { plans, exams, subjectId } = fixture();
        const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-07-14" }).id;
        const created = plans.createPlan(
          { examId, dailyMinutes: 30, startDate: "2026-07-08", examWeekBoost: false },
          T0,
          TODAY,
        );

        plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10");

        const blocks = plans.listBlocks(created.id);
        const missed = blocks.filter((b) => b.status === "missed");
        expect(missed.map((b) => b.blockDate)).toEqual(["2026-07-08", "2026-07-09"]);
        expect(missed.every((b) => b.minutes === 30)).toBe(true); // the backlog source itself is untouched

        const future = blocks.filter((b) => b.status === "planned");
        expect(future.map((b) => ({ date: b.blockDate, minutes: b.minutes }))).toEqual([
          { date: "2026-07-10", minutes: 45 }, // 30 + 60/4
          { date: "2026-07-11", minutes: 45 },
          { date: "2026-07-12", minutes: 45 },
          { date: "2026-07-13", minutes: 45 },
        ]);
      });

      it("gives the remainder minute to the earliest future blocks when the backlog does not divide evenly", () => {
        const { plans, exams, subjectId } = fixture();
        const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-07-14" }).id;
        const created = plans.createPlan(
          { examId, dailyMinutes: 25, startDate: "2026-07-08", examWeekBoost: false },
          T0,
          TODAY,
        );

        plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10");

        const future = plans
          .listBlocks(created.id)
          .filter((b) => b.status === "planned")
          .map((b) => b.minutes);
        // Backlog 50 (2 x 25) over 4 future days: 50/4 = 12 base, remainder 2.
        expect(future).toEqual([38, 38, 37, 37]); // 25 + 13, 25 + 13, 25 + 12, 25 + 12
      });

      it("stays idempotent for the same today while a backlog is being redistributed", () => {
        const { plans, exams, subjectId } = fixture();
        const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-07-14" }).id;
        const created = plans.createPlan(
          { examId, dailyMinutes: 30, startDate: "2026-07-08", examWeekBoost: false },
          T0,
          TODAY,
        );

        plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10");
        const firstPass = plans
          .listBlocks(created.id)
          .map((b) => ({ date: b.blockDate, minutes: b.minutes, status: b.status }));

        plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10");
        const secondPass = plans
          .listBlocks(created.id)
          .map((b) => ({ date: b.blockDate, minutes: b.minutes, status: b.status }));

        expect(secondPass).toEqual(firstPass);
      });

      it("shrinks the redistributed backlog on the next sync once a missed block is completed late", () => {
        const { plans, exams, subjectId } = fixture();
        const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-07-14" }).id;
        const created = plans.createPlan(
          { examId, dailyMinutes: 40, startDate: "2026-07-08", examWeekBoost: false },
          T0,
          TODAY,
        );

        plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10");
        const beforeFuture = plans
          .listBlocks(created.id)
          .filter((b) => b.status === "planned")
          .map((b) => b.minutes);
        expect(beforeFuture).toEqual([60, 60, 60, 60]); // 40 + 80/4 (2 missed days x 40)

        const firstMissed = plans.listBlocks(created.id).find((b) => b.blockDate === "2026-07-08")!;
        plans.setBlockStatus(firstMissed.id, "done", "2026-07-10T12:00:00.000Z"); // late completion

        plans.sync(created.id, "2026-07-10T13:00:00.000Z", "2026-07-10"); // same today: no new misses

        const afterFuture = plans
          .listBlocks(created.id)
          .filter((b) => b.status === "planned")
          .map((b) => b.minutes);
        // Backlog dropped from 80 to 40 (one missed day left) over the same 4 days: 40/4 = 10 each.
        expect(afterFuture).toEqual([50, 50, 50, 50]);
      });

      it("keeps boosted days' doubled base plus their share of the redistributed backlog", () => {
        const { plans, exams, subjectId } = fixture();
        const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-07-14" }).id;
        const created = plans.createPlan(
          { examId, dailyMinutes: 20, startDate: "2026-07-01", examWeekBoost: true },
          "2026-07-01T09:00:00.000Z",
          "2026-07-01",
        );

        plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10");

        const future = plans
          .listBlocks(created.id)
          .filter((b) => b.status === "planned")
          .map((b) => ({ date: b.blockDate, minutes: b.minutes }));
        // Missed: 07-01..06 unboosted (6 x 20 = 120) + 07-07..09 boosted (3 x 40 = 120) = 240 backlog.
        // Future 07-10..13 are all within the boosted final week: 40 base + 240/4 = 60 extra = 100 each.
        expect(future).toEqual([
          { date: "2026-07-10", minutes: 100 },
          { date: "2026-07-11", minutes: 100 },
          { date: "2026-07-12", minutes: 100 },
          { date: "2026-07-13", minutes: 100 },
        ]);
      });

      it("leaves missed blocks alone with no error when no future blocks remain to absorb the backlog", () => {
        const { plans, examId } = fixture(); // exam 2026-08-10
        const created = plans.createPlan(
          { examId, dailyMinutes: 30, startDate: "2026-08-05", examWeekBoost: false },
          T0,
          TODAY,
        );

        expect(() =>
          plans.sync(created.id, "2026-08-10T10:00:00.000Z", "2026-08-10"),
        ).not.toThrow();

        const after = plans.listBlocks(created.id);
        expect(after).toHaveLength(5);
        expect(after.every((b) => b.status === "missed" && b.minutes === 30)).toBe(true);
      });
    });
  });

  describe("syncAll", () => {
    it("syncs every active plan whose exam is still active and returns one PlanHealth per plan", () => {
      const { plans, exams, subjectId } = fixture();
      const examA = exams.create({ subjectId, examType: "pismeni", examDate: "2026-08-10" }).id;
      const examB = exams.create({ subjectId, examType: "usmeni", examDate: "2026-08-20" }).id;
      const planA = plans.createPlan(
        { examId: examA, dailyMinutes: 30, startDate: "2026-08-05", examWeekBoost: false },
        T0,
        TODAY,
      );
      plans.createPlan(
        { examId: examB, dailyMinutes: 30, startDate: "2026-08-15", examWeekBoost: false },
        T0,
        TODAY,
      );
      exams.softDelete(examB);

      const health = plans.syncAll("2026-07-15T10:00:00.000Z", "2026-07-15");
      expect(health).toEqual([
        { planId: planA.id, overflowMinutes: 0, examPassedBacklogMinutes: 0 },
      ]); // only examA's plan is synced
    });

    it("isolates syncAll between profiles", () => {
      const a = fixture();
      const b = fixture();
      a.plans.createPlan(
        { examId: a.examId, dailyMinutes: 30, startDate: "2026-08-05", examWeekBoost: false },
        T0,
        TODAY,
      );
      expect(b.plans.syncAll(T0, TODAY)).toEqual([]);
    });
  });

  describe("cross-profile isolation", () => {
    it("keeps one profile's plans invisible to another's store for mutations", () => {
      const a = fixture();
      const b = fixture();
      const owned = a.plans.createPlan(
        { examId: a.examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false },
        T0,
        TODAY,
      );

      expect(() => b.plans.updatePlan(owned.id, { dailyMinutes: 40 }, T0, TODAY)).toThrow(
        PlanNotFoundError,
      );
      expect(() => b.plans.softDelete(owned.id, T0)).toThrow(PlanNotFoundError);
      expect(a.plans.listActive().map((p) => p.id)).toEqual([owned.id]);
    });
  });

  // --- ADR-063: the weekday vector -----------------------------------------

  describe("weekdayMinutes (the capacity vector)", () => {
    it("stores, returns and applies a Mon..Sun vector; null stays 'every day = dailyMinutes'", () => {
      const { plans, examId } = fixture();
      const plain = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-05", examWeekBoost: false },
        T0,
        TODAY,
      );
      expect(plain.weekdayMinutes).toBeNull();

      // 2026-08-03 is a Monday; Wednesdays and the weekend are free.
      const updated = plans.updatePlan(
        plain.id,
        { startDate: "2026-08-03", weekdayMinutes: [60, 30, 0, 30, 0, 0, 0] },
        T0,
        TODAY,
      );
      expect(updated.weekdayMinutes).toEqual([60, 30, 0, 30, 0, 0, 0]);
      expect(plans.listActive()[0]?.weekdayMinutes).toEqual([60, 30, 0, 30, 0, 0, 0]);

      const blocks = plans.listBlocks(plain.id);
      expect(blocks.map((b) => [b.blockDate, b.minutes])).toEqual([
        ["2026-08-03", 60],
        ["2026-08-04", 30],
        ["2026-08-06", 30],
      ]);

      // null clears the vector back to the scalar.
      const cleared = plans.updatePlan(plain.id, { weekdayMinutes: null }, T0, TODAY);
      expect(cleared.weekdayMinutes).toBeNull();
      expect(plans.listBlocks(plain.id)).toHaveLength(7);
    });

    it("rejects a malformed vector: wrong length, non-integers, out of range, or all-zero", () => {
      const { plans, examId } = fixture();
      const bad = (weekdayMinutes: number[]) => () =>
        plans.createPlan(
          { examId, dailyMinutes: 30, startDate: "2026-08-01", examWeekBoost: false, weekdayMinutes },
          T0,
          TODAY,
        );
      expect(bad([30, 30, 30])).toThrow(PlanValidationError);
      expect(bad([30, 30, 30, 30, 30, 30, 30, 30])).toThrow(PlanValidationError);
      expect(bad([30, 30, 30, 30, 30, 30, 30.5])).toThrow(PlanValidationError);
      expect(bad([30, 30, 30, 30, 30, 30, -1])).toThrow(PlanValidationError);
      expect(bad([30, 30, 30, 30, 30, 30, 481])).toThrow(PlanValidationError);
      expect(bad([0, 0, 0, 0, 0, 0, 0])).toThrow(PlanValidationError);
    });
  });

  // --- ADR-063: topic-aware generation, health, pins and the scope cut ------

  describe("topic-aware generation", () => {
    it("creates topic blocks in rank order under the vector, revisions and recall included", () => {
      const { plans, topics, examId } = fixture(); // exam 2026-08-10
      topics.create({ examId, name: "A" }, T0); // confidence unknown
      const b = topics.create({ examId, name: "B", confidence: 50 }, T0);
      expect(b.rank).toBe(1);

      const created = plans.createPlan(
        {
          examId,
          dailyMinutes: 60,
          startDate: "2026-08-03",
          examWeekBoost: false,
          weekdayMinutes: [60, 30, 0, 30, 0, 0, 0],
        },
        T0,
        TODAY,
      );

      const [a] = topics.listByExam(examId);
      // Sorted in the TEST (date, kind, topic): within one date the store
      // orders by id, and same-millisecond UUIDv7s carry no order.
      const rows = plans
        .listBlocks(created.id)
        .map((row) => [row.blockDate, row.minutes, row.topicId === a!.id ? "A" : "B", row.kind] as const)
        .sort((x, y) => x[0].localeCompare(y[0]) || x[3].localeCompare(y[3]) || x[2].localeCompare(y[2]));
      // The engine's own pinned scenario, written through the store: budgets
      // A 72 (pass 15, coverage 27) and B 48 (pure coverage).
      expect(rows).toEqual([
        ["2026-08-03", 27, "A", "coverage"],
        ["2026-08-03", 33, "B", "coverage"],
        ["2026-08-04", 15, "B", "coverage"],
        ["2026-08-04", 15, "A", "revision"],
        ["2026-08-06", 15, "A", "recall"],
        ["2026-08-06", 15, "A", "revision"],
      ]);
      expect(plans.listBlocks(created.id).every((row) => !row.pinned && row.status === "planned")).toBe(
        true,
      );
    });

    it("sync is idempotent for the same today on a topic-aware plan", () => {
      const { plans, topics, exams, subjectId } = fixture();
      const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-07-14" }).id;
      topics.create({ examId, name: "T", confidence: 0 }, T0);
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-07-08", examWeekBoost: false },
        T0,
        TODAY,
      );

      // Sorted in the TEST: within one date the store orders by id, and two
      // passes mint fresh ids — the pinned fact is the SET of slots.
      const snapshot = () =>
        plans
          .listBlocks(created.id)
          .map((b) => ({ date: b.blockDate, minutes: b.minutes, status: b.status, topicId: b.topicId, kind: b.kind }))
          .sort((x, y) => x.date.localeCompare(y.date) || x.kind.localeCompare(y.kind));

      plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10");
      const first = snapshot();

      plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10");
      const second = snapshot();

      expect(second).toEqual(first);
    });
  });

  describe("PlanHealth (overflow is a return value, never a silent stretch)", () => {
    it("reports zero overflow while the backlog still fits", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-05", examWeekBoost: false },
        T0,
        TODAY,
      );
      expect(plans.sync(created.id, T0, TODAY)).toEqual({
        planId: created.id,
        overflowMinutes: 0,
        examPassedBacklogMinutes: 0,
      });
    });

    it("reports the capped distributor's overflow on a topic-aware plan whose days are full", () => {
      const { plans, topics, exams, subjectId } = fixture();
      const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-07-14" }).id;
      topics.create({ examId, name: "T", confidence: 0 }, T0);
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-07-08", examWeekBoost: false },
        T0,
        TODAY,
      );

      // Two missed days (60 min) and every remaining day already at capacity:
      // nothing absorbs the backlog, so ALL of it is overflow.
      const health = plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10");
      expect(health).toEqual({
        planId: created.id,
        overflowMinutes: 60,
        examPassedBacklogMinutes: 0,
      });
      // And capacity stayed law: no day exceeds 30 minutes.
      const byDate = new Map<string, number>();
      for (const b of plans.listBlocks(created.id).filter((b) => b.status === "planned")) {
        byDate.set(b.blockDate, (byDate.get(b.blockDate) ?? 0) + b.minutes);
      }
      for (const minutes of byDate.values()) expect(minutes).toBeLessThanOrEqual(30);
    });

    it("still reports overflow past the plan's own capacity on the zero-topic no-cap path", () => {
      const { plans, exams, subjectId } = fixture();
      const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-07-14" }).id;
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-07-08", examWeekBoost: false },
        T0,
        TODAY,
      );

      // 60 missed minutes spread over 4 future days of 30: each becomes 45 —
      // the old no-cap stretch survives, and the 15-over-capacity on each of
      // the 4 days is REPORTED.
      const health = plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10");
      expect(health.overflowMinutes).toBe(60);
      expect(health.examPassedBacklogMinutes).toBe(0);
      const future = plans
        .listBlocks(created.id)
        .filter((b) => b.status === "planned")
        .map((b) => b.minutes);
      expect(future).toEqual([45, 45, 45, 45]);
    });

    it("reports a passed exam's unabsorbed backlog as examPassedBacklogMinutes", () => {
      const { plans, examId } = fixture(); // exam 2026-08-10
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-05", examWeekBoost: false },
        T0,
        TODAY,
      );
      const health = plans.sync(created.id, "2026-08-10T10:00:00.000Z", "2026-08-10");
      expect(health).toEqual({
        planId: created.id,
        overflowMinutes: 0,
        examPassedBacklogMinutes: 150, // all five 30-minute blocks went missed
      });
    });
  });

  describe("pinned blocks", () => {
    it("marks a block pinned and back, and refuses an unknown or cross-profile block", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-05", examWeekBoost: false },
        T0,
        TODAY,
      );
      const block = plans.listBlocks(created.id)[0]!;
      expect(block.pinned).toBe(false);

      expect(plans.setBlockPinned(block.id, true, T0).pinned).toBe(true);
      expect(plans.setBlockPinned(block.id, false, T0).pinned).toBe(false);
      expect(() => plans.setBlockPinned("missing", true, T0)).toThrow(PlanNotFoundError);

      const other = fixture();
      expect(() => other.plans.setBlockPinned(block.id, true, T0)).toThrow(PlanNotFoundError);
    });

    it("regeneration keeps a pinned future block exactly as it keeps done rows, without duplicating its slot", () => {
      const { plans, examId } = fixture();
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-05", examWeekBoost: false },
        T0,
        TODAY,
      );
      const pinnedBlock = plans.listBlocks(created.id)[0]!; // 2026-08-05
      plans.setBlockPinned(pinnedBlock.id, true, T0);

      plans.updatePlan(created.id, { dailyMinutes: 50 }, T0, TODAY);

      const blocks = plans.listBlocks(created.id);
      const survived = blocks.find((b) => b.id === pinnedBlock.id);
      expect(survived?.minutes).toBe(30); // untouched, not regenerated to 50
      expect(survived?.pinned).toBe(true);
      expect(blocks.filter((b) => b.blockDate === "2026-08-05")).toHaveLength(1);
      expect(blocks.filter((b) => b.id !== pinnedBlock.id).every((b) => b.minutes === 50)).toBe(true);
    });
  });

  describe("scope cut (STUDY-004)", () => {
    it("proposes nothing while the load fits the capacity", () => {
      const { plans, topics, examId } = fixture();
      topics.create({ examId, name: "T", confidence: 0 }, T0);
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-08-05", examWeekBoost: false },
        T0,
        TODAY,
      );
      const proposal = plans.scopeCutProposal(created.id, TODAY);
      expect(proposal.planId).toBe(created.id);
      expect(proposal.topicIds).toEqual([]);
      expect(proposal.freedMinutes).toBe(0);
      expect(proposal.loadMinutes).toBeLessThanOrEqual(proposal.capacityMinutes);
    });

    it("walks topics from the bottom of the rank list, dropping remaining non-done minutes until the load fits — without writing", () => {
      const { plans, topics, exams, subjectId } = fixture();
      const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-07-14" }).id;
      const t = topics.create({ examId, name: "T", confidence: 0 }, T0);
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-07-08", examWeekBoost: false },
        T0,
        TODAY,
      );
      plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10"); // 60 min missed, days full

      const before = plans.listBlocks(created.id);
      const proposal = plans.scopeCutProposal(created.id, "2026-07-10");
      expect(proposal).toEqual({
        planId: created.id,
        capacityMinutes: 120, // 4 remaining days x 30
        loadMinutes: 180, // 120 planned + 60 missed
        topicIds: [t.id],
        freedMinutes: 180, // every non-done minute belongs to T
      });
      // Pure computation: nothing was written.
      expect(plans.listBlocks(created.id)).toEqual(before);
      expect(topics.listByExam(examId)[0]?.cut).toBe(false);
    });

    it("acceptScopeCut is the one path that sets cut, and the next sync excludes the topic", () => {
      const { plans, topics, exams, subjectId } = fixture();
      const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-07-14" }).id;
      const t = topics.create({ examId, name: "T", confidence: 0 }, T0);
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-07-08", examWeekBoost: false },
        T0,
        TODAY,
      );

      plans.acceptScopeCut([t.id], T0);
      expect(topics.listByExam(examId)[0]?.cut).toBe(true);

      plans.sync(created.id, T0, TODAY);
      // With its only topic cut, the plan regenerates undifferentiated blocks.
      const future = plans.listBlocks(created.id).filter((b) => b.status === "planned");
      expect(future.every((b) => b.topicId === null && b.kind === "coverage")).toBe(true);
    });

    it("acceptScopeCut refuses an unknown or cross-profile topic id", () => {
      const { plans } = fixture();
      const other = fixture();
      const foreign = other.topics.create({ examId: other.examId, name: "X" }, T0);
      expect(() => plans.acceptScopeCut(["missing"], T0)).toThrow(ExamTopicNotFoundError);
      expect(() => plans.acceptScopeCut([foreign.id], T0)).toThrow(ExamTopicNotFoundError);
    });
  });

  describe("restoreScopeCut (the un-cut path)", () => {
    it("clears cut and the next sync generates over the restored scope again", () => {
      const { plans, topics, exams, subjectId } = fixture();
      const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-07-14" }).id;
      const t = topics.create({ examId, name: "T", confidence: 0 }, T0);
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-07-08", examWeekBoost: false },
        T0,
        TODAY,
      );

      plans.acceptScopeCut([t.id], T0);
      plans.sync(created.id, T0, TODAY);
      expect(
        plans.listBlocks(created.id).every((block) => block.topicId === null),
      ).toBe(true);

      plans.restoreScopeCut([t.id], "2026-07-09T10:00:00.000Z");
      expect(topics.listByExam(examId)[0]?.cut).toBe(false);
      expect(topics.listByExam(examId)[0]?.updatedAt).toBe("2026-07-09T10:00:00.000Z");

      plans.sync(created.id, T0, TODAY);
      const future = plans.listBlocks(created.id).filter((block) => block.status === "planned");
      expect(future.length).toBeGreaterThan(0);
      expect(future.every((block) => block.topicId === t.id)).toBe(true);
    });

    it("restores several topics in one transaction", () => {
      const { plans, topics, examId } = fixture();
      const a = topics.create({ examId, name: "A" }, T0);
      const b = topics.create({ examId, name: "B" }, T0);
      plans.acceptScopeCut([a.id, b.id], T0);

      plans.restoreScopeCut([a.id, b.id], T0);
      expect(topics.listByExam(examId).map((topic) => topic.cut)).toEqual([false, false]);
    });

    it("refuses an unknown or cross-profile topic id, leaving the whole restore unwritten", () => {
      const { plans, topics, examId } = fixture();
      const other = fixture();
      const mine = topics.create({ examId, name: "Moja" }, T0);
      const foreign = other.topics.create({ examId: other.examId, name: "X" }, T0);
      plans.acceptScopeCut([mine.id], T0);
      other.plans.acceptScopeCut([foreign.id], T0);

      expect(() => plans.restoreScopeCut(["missing"], T0)).toThrow(ExamTopicNotFoundError);
      expect(() => plans.restoreScopeCut([foreign.id], T0)).toThrow(ExamTopicNotFoundError);
      // The valid id beside the refused one stays cut — one transaction.
      expect(() => plans.restoreScopeCut([mine.id, "missing"], T0)).toThrow(
        ExamTopicNotFoundError,
      );
      expect(topics.listByExam(examId)[0]?.cut).toBe(true);
    });

    it("refuses a topic that is not cut, and an exam with no cut topics at all", () => {
      const { plans, topics, examId } = fixture();
      const a = topics.create({ examId, name: "A" }, T0);
      const b = topics.create({ examId, name: "B" }, T0);

      // Nothing on this exam was ever cut.
      expect(() => plans.restoreScopeCut([a.id], T0)).toThrow(PlanValidationError);
      expect(() => plans.restoreScopeCut([a.id, b.id], T0)).toThrow(PlanValidationError);

      // And an already-restored topic cannot be restored twice.
      plans.acceptScopeCut([a.id], T0);
      plans.restoreScopeCut([a.id], T0);
      expect(() => plans.restoreScopeCut([a.id], T0)).toThrow(PlanValidationError);
    });

    it("refuses an empty restore and a malformed now", () => {
      const { plans, topics, examId } = fixture();
      const a = topics.create({ examId, name: "A" }, T0);
      plans.acceptScopeCut([a.id], T0);
      expect(() => plans.restoreScopeCut([], T0)).toThrow(PlanValidationError);
      expect(() => plans.restoreScopeCut([a.id], "not-a-date")).toThrow(PlanValidationError);
      expect(topics.listByExam(examId)[0]?.cut).toBe(true);
    });

    it("brings the cut topic's load back: over capacity, cut, restored, over capacity again", () => {
      const { plans, topics, exams, subjectId } = fixture();
      const examId = exams.create({ subjectId, examType: "pismeni", examDate: "2026-07-14" }).id;
      topics.create({ examId, name: "Gore", confidence: 0 }, T0);
      const bottom = topics.create({ examId, name: "Dole", confidence: 0 }, T0);
      const created = plans.createPlan(
        { examId, dailyMinutes: 30, startDate: "2026-07-08", examWeekBoost: false },
        T0,
        TODAY,
      );

      // Two missed days (60 min) against four remaining days already at capacity.
      const over = plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10");
      expect(over.overflowMinutes).toBe(60);
      const proposal = plans.scopeCutProposal(created.id, "2026-07-10");
      expect(proposal.topicIds[0]).toBe(bottom.id); // the walk starts at the bottom rank
      expect(proposal.loadMinutes).toBeGreaterThan(proposal.capacityMinutes);

      plans.acceptScopeCut([bottom.id], "2026-07-10T10:00:00.000Z");
      const cut = plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10");
      const cutFuture = plans
        .listBlocks(created.id)
        .filter((block) => block.status === "planned" && block.blockDate >= "2026-07-10");
      expect(cutFuture.some((block) => block.topicId === bottom.id)).toBe(false);
      // With the bottom topic out, it is no longer a candidate to cut.
      expect(plans.scopeCutProposal(created.id, "2026-07-10").topicIds).not.toContain(bottom.id);
      // The narrower scope does NOT absorb the missed backlog: the survivors'
      // budgets simply grow to fill the same capacity, so the honest overflow
      // still reports every missed minute (ADR-063 invariant 5).
      expect(cut.overflowMinutes).toBe(60);

      plans.restoreScopeCut([bottom.id], "2026-07-10T10:00:00.000Z");
      const back = plans.sync(created.id, "2026-07-10T10:00:00.000Z", "2026-07-10");
      const restoredFuture = plans
        .listBlocks(created.id)
        .filter((block) => block.status === "planned" && block.blockDate >= "2026-07-10");
      expect(restoredFuture.some((block) => block.topicId === bottom.id)).toBe(true);
      // The redistribution consequence, reported rather than hidden: the plan is
      // over capacity again and the proposal names the restored topic once more.
      expect(back.overflowMinutes).toBe(60);
      const again = plans.scopeCutProposal(created.id, "2026-07-10");
      expect(again.topicIds[0]).toBe(bottom.id);
      expect(again.loadMinutes).toBeGreaterThan(again.capacityMinutes);
    });
  });
});
