import { describe, expect, it } from "vitest";
import {
  distributeBacklog,
  distributeBacklogCapped,
  planBlockDates,
  planDayCapacity,
  type PlanBlockDate,
  type PlanTopic,
} from "./planEngine.js";

/** A v1-era block literal: the undifferentiated fields every zero-topic block carries. */
function plain(date: string, minutes: number): PlanBlockDate {
  return { date, minutes, topicId: null, kind: "coverage" };
}

describe("planBlockDates", () => {
  it("returns one block per day from startDate through the day before examDate", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-10",
      startDate: "2026-08-05",
      dailyMinutes: 30,
      examWeekBoost: false,
      today: "2026-08-01",
    });

    expect(blocks).toEqual([
      plain("2026-08-05", 30),
      plain("2026-08-06", 30),
      plain("2026-08-07", 30),
      plain("2026-08-08", 30),
      plain("2026-08-09", 30),
    ]);
  });

  it("doubles minutes for blocks within the final 7 days when examWeekBoost is true", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-20",
      startDate: "2026-08-01",
      dailyMinutes: 30,
      examWeekBoost: true,
      today: "2026-08-01",
    });

    const boosted = blocks.filter((b) => b.minutes === 60).map((b) => b.date);
    const notBoosted = blocks.filter((b) => b.minutes === 30).map((b) => b.date);

    // The final 7 days before the exam (2026-08-20 - 7 = 2026-08-13) are boosted.
    expect(boosted).toEqual([
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
    ]);
    expect(notBoosted).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
      "2026-08-10",
      "2026-08-11",
      "2026-08-12",
    ]);
  });

  it("boosts every block when the whole span is shorter than 7 days", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-20",
      startDate: "2026-08-18",
      dailyMinutes: 40,
      examWeekBoost: true,
      today: "2026-08-01",
    });

    expect(blocks).toEqual([
      plain("2026-08-18", 80),
      plain("2026-08-19", 80),
    ]);
  });

  it("does not double minutes when examWeekBoost is false, even inside the final week", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-20",
      startDate: "2026-08-18",
      dailyMinutes: 40,
      examWeekBoost: false,
      today: "2026-08-01",
    });

    expect(blocks).toEqual([
      plain("2026-08-18", 40),
      plain("2026-08-19", 40),
    ]);
  });

  it("starts from today when startDate is before today", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-10",
      startDate: "2026-07-01",
      dailyMinutes: 20,
      examWeekBoost: false,
      today: "2026-08-08",
    });

    expect(blocks).toEqual([
      plain("2026-08-08", 20),
      plain("2026-08-09", 20),
    ]);
  });

  it("starts from startDate when startDate is after today", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-10",
      startDate: "2026-08-08",
      dailyMinutes: 20,
      examWeekBoost: false,
      today: "2026-08-01",
    });

    expect(blocks).toEqual([
      plain("2026-08-08", 20),
      plain("2026-08-09", 20),
    ]);
  });

  it("returns an empty array once the exam is today or already past", () => {
    expect(
      planBlockDates({
        examDate: "2026-08-08",
        startDate: "2026-08-01",
        dailyMinutes: 20,
        examWeekBoost: false,
        today: "2026-08-08",
      }),
    ).toEqual([]);

    expect(
      planBlockDates({
        examDate: "2026-08-01",
        startDate: "2026-07-20",
        dailyMinutes: 20,
        examWeekBoost: false,
        today: "2026-08-08",
      }),
    ).toEqual([]);
  });

  it("returns a single block when startDate is exactly the day before the exam", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-10",
      startDate: "2026-08-09",
      dailyMinutes: 25,
      examWeekBoost: false,
      today: "2026-08-01",
    });

    expect(blocks).toEqual([plain("2026-08-09", 25)]);
  });

  it("returns an empty array when the effective start is on/after the exam date", () => {
    // startDate == examDate.
    expect(
      planBlockDates({
        examDate: "2026-08-10",
        startDate: "2026-08-10",
        dailyMinutes: 20,
        examWeekBoost: false,
        today: "2026-08-01",
      }),
    ).toEqual([]);

    // today == examDate (effective start clamps to today, which is on the exam date).
    expect(
      planBlockDates({
        examDate: "2026-08-10",
        startDate: "2026-08-01",
        dailyMinutes: 20,
        examWeekBoost: false,
        today: "2026-08-10",
      }),
    ).toEqual([]);
  });
});

/**
 * ADR-063 invariant 6 — the zero-topic COMPATIBILITY PIN, written against the
 * v1 engine BEFORE any v2 work and kept green ever since: a plan with no
 * topics must reproduce the v1 engine's output byte for byte. The assertions
 * project each block onto its v1 fields (`date`, `minutes`) so the pin states
 * exactly the v1 contract — the v2-only fields are pinned separately by the
 * v2 suites below.
 */
describe("planBlockDates — zero-topic compatibility pin (ADR-063 invariant 6)", () => {
  const v1 = (blocks: readonly { date: string; minutes: number }[]) =>
    blocks.map((block) => ({ date: block.date, minutes: block.minutes }));

  it("pins the plain span: one block per day at dailyMinutes", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-10",
      startDate: "2026-08-05",
      dailyMinutes: 30,
      examWeekBoost: false,
      today: "2026-08-01",
    });
    expect(v1(blocks)).toEqual([
      { date: "2026-08-05", minutes: 30 },
      { date: "2026-08-06", minutes: 30 },
      { date: "2026-08-07", minutes: 30 },
      { date: "2026-08-08", minutes: 30 },
      { date: "2026-08-09", minutes: 30 },
    ]);
  });

  it("pins the boosted span: the final 7 days doubled, the rest plain", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-20",
      startDate: "2026-08-10",
      dailyMinutes: 30,
      examWeekBoost: true,
      today: "2026-08-01",
    });
    expect(v1(blocks)).toEqual([
      { date: "2026-08-10", minutes: 30 },
      { date: "2026-08-11", minutes: 30 },
      { date: "2026-08-12", minutes: 30 },
      { date: "2026-08-13", minutes: 60 },
      { date: "2026-08-14", minutes: 60 },
      { date: "2026-08-15", minutes: 60 },
      { date: "2026-08-16", minutes: 60 },
      { date: "2026-08-17", minutes: 60 },
      { date: "2026-08-18", minutes: 60 },
      { date: "2026-08-19", minutes: 60 },
    ]);
  });

  it("pins the clamped start and the empty spans", () => {
    expect(
      v1(
        planBlockDates({
          examDate: "2026-08-10",
          startDate: "2026-07-01",
          dailyMinutes: 20,
          examWeekBoost: false,
          today: "2026-08-08",
        }),
      ),
    ).toEqual([
      { date: "2026-08-08", minutes: 20 },
      { date: "2026-08-09", minutes: 20 },
    ]);
    expect(
      planBlockDates({
        examDate: "2026-08-08",
        startDate: "2026-08-01",
        dailyMinutes: 20,
        examWeekBoost: false,
        today: "2026-08-08",
      }),
    ).toEqual([]);
  });
});

describe("distributeBacklog", () => {
  it("splits the backlog evenly across blocks with no remainder", () => {
    const blocks: PlanBlockDate[] = [
      plain("2026-08-05", 30),
      plain("2026-08-06", 30),
      plain("2026-08-07", 30),
      plain("2026-08-08", 30),
    ];

    expect(distributeBacklog(blocks, 60)).toEqual([
      plain("2026-08-05", 45),
      plain("2026-08-06", 45),
      plain("2026-08-07", 45),
      plain("2026-08-08", 45),
    ]);
  });

  it("gives the remainder minute to the earliest blocks, ascending date order", () => {
    const blocks: PlanBlockDate[] = [
      plain("2026-08-05", 30),
      plain("2026-08-06", 30),
      plain("2026-08-07", 30),
      plain("2026-08-08", 30),
    ];

    // 50 / 4 = 12 base, remainder 2 -> first two blocks get +13, the rest +12.
    expect(distributeBacklog(blocks, 50)).toEqual([
      plain("2026-08-05", 43),
      plain("2026-08-06", 43),
      plain("2026-08-07", 42),
      plain("2026-08-08", 42),
    ]);
  });

  it("returns the blocks unchanged for a zero or negative backlog", () => {
    const blocks: PlanBlockDate[] = [
      plain("2026-08-05", 30),
      plain("2026-08-06", 30),
    ];

    expect(distributeBacklog(blocks, 0)).toEqual(blocks);
    expect(distributeBacklog(blocks, -15)).toEqual(blocks);
  });

  it("returns an empty array unchanged regardless of backlog", () => {
    expect(distributeBacklog([], 100)).toEqual([]);
  });

  it("puts the entire backlog onto a single block", () => {
    const blocks: PlanBlockDate[] = [plain("2026-08-05", 30)];
    expect(distributeBacklog(blocks, 25)).toEqual([plain("2026-08-05", 55)]);
  });

  it("preserves each block's own base minutes, including boosted ones, beneath the extra", () => {
    const blocks: PlanBlockDate[] = [
      plain("2026-08-05", 30),
      plain("2026-08-06", 60), // a boosted, doubled day
    ];

    // 11 / 2 = 5 base, remainder 1 -> the earliest block gets +6, the other +5.
    expect(distributeBacklog(blocks, 11)).toEqual([
      plain("2026-08-05", 36),
      plain("2026-08-06", 65),
    ]);
  });

  it("returns a new array rather than mutating the input", () => {
    const blocks: PlanBlockDate[] = [plain("2026-08-05", 30)];
    const result = distributeBacklog(blocks, 10);
    expect(result).not.toBe(blocks);
    expect(blocks[0]!.minutes).toBe(30); // input untouched
  });
});

// --- Engine v2 (ADR-063): topics, the weekday vector, and the exam week -----

function topic(id: string, rank: number, confidence: number | null, cut = false): PlanTopic {
  return { id, rank, confidence, cut };
}

describe("planDayCapacity", () => {
  const spec = {
    examDate: "2026-08-31",
    dailyMinutes: 30,
    examWeekBoost: false,
  };

  it("answers dailyMinutes for every day when no vector is set", () => {
    expect(planDayCapacity(spec, "2026-08-03")).toBe(30);
    expect(planDayCapacity(spec, "2026-08-30")).toBe(30);
  });

  it("reads the Mon..Sun vector by the day's own weekday", () => {
    const vector = [60, 30, 0, 30, 0, 0, 15];
    const withVector = { ...spec, weekdayMinutes: vector };
    expect(planDayCapacity(withVector, "2026-08-03")).toBe(60); // Monday
    expect(planDayCapacity(withVector, "2026-08-04")).toBe(30); // Tuesday
    expect(planDayCapacity(withVector, "2026-08-05")).toBe(0); // Wednesday
    expect(planDayCapacity(withVector, "2026-08-09")).toBe(15); // Sunday
  });

  it("doubles the vector inside the final 7 days exactly as it doubled the scalar", () => {
    const boosted = { ...spec, examWeekBoost: true, weekdayMinutes: [60, 30, 0, 30, 0, 0, 15] };
    expect(planDayCapacity(boosted, "2026-08-24")).toBe(120); // boosted Monday
    expect(planDayCapacity(boosted, "2026-08-23")).toBe(15); // Sunday before the window, unboosted
    expect(planDayCapacity(boosted, "2026-08-17")).toBe(60); // Monday before the window
  });

  it("answers zero on and after the exam date", () => {
    expect(planDayCapacity(spec, "2026-08-31")).toBe(0);
    expect(planDayCapacity(spec, "2026-09-01")).toBe(0);
  });
});

describe("planBlockDates — topics (ADR-063)", () => {
  it("plans coverage in rank order under the vector's capacity, excludes cut topics, and fills leftovers with recall (invariants 1-3)", () => {
    // Mon 60 / Tue 30 / Thu 30, everything else 0; the whole span sits inside
    // the exam week, so coverage is ALLOWED there (nothing earlier exists).
    const blocks = planBlockDates({
      examDate: "2026-08-10",
      startDate: "2026-08-03",
      dailyMinutes: 60,
      examWeekBoost: false,
      today: "2026-08-01",
      weekdayMinutes: [60, 30, 0, 30, 0, 0, 0],
      topics: [
        topic("A", 0, null),
        topic("B", 1, 50),
        topic("C", 2, 0, true), // cut: excluded from generation entirely
      ],
    });

    // C = 120; weights A(null -> 25) = 75, B(50) = 50 -> budgets A 72, B 48.
    // A: pass 15, coverage 27; B under the revision minimum -> pure coverage.
    expect(blocks).toEqual([
      { date: "2026-08-03", minutes: 27, topicId: "A", kind: "coverage" },
      { date: "2026-08-03", minutes: 33, topicId: "B", kind: "coverage" },
      { date: "2026-08-04", minutes: 15, topicId: "B", kind: "coverage" },
      { date: "2026-08-04", minutes: 15, topicId: "A", kind: "revision" },
      { date: "2026-08-06", minutes: 15, topicId: "A", kind: "revision" },
      { date: "2026-08-06", minutes: 15, topicId: "A", kind: "recall" },
    ]);
  });

  it("keeps the exam week free of new coverage and fills it with recall over the weakest topics (invariants 3-4)", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-31",
      startDate: "2026-08-17",
      dailyMinutes: 30,
      examWeekBoost: true,
      today: "2026-08-01",
      topics: [topic("A", 0, 90), topic("B", 1, 10)],
    });

    // Early region 08-17..23 (7 x 30 = 210); window 08-24..30 boosted to 60.
    // Budgets: A 21 (pure coverage), B 189 -> pass 15, coverage 144,
    // completing 08-22 -> revisions at +1/+3/+7 = 08-23/25/29. Recall rotates
    // the weakest-first order [B, A] over every leftover slice.
    expect(blocks).toEqual([
      { date: "2026-08-17", minutes: 21, topicId: "A", kind: "coverage" },
      { date: "2026-08-17", minutes: 9, topicId: "B", kind: "coverage" },
      { date: "2026-08-18", minutes: 30, topicId: "B", kind: "coverage" },
      { date: "2026-08-19", minutes: 30, topicId: "B", kind: "coverage" },
      { date: "2026-08-20", minutes: 30, topicId: "B", kind: "coverage" },
      { date: "2026-08-21", minutes: 30, topicId: "B", kind: "coverage" },
      { date: "2026-08-22", minutes: 15, topicId: "B", kind: "coverage" },
      { date: "2026-08-22", minutes: 15, topicId: "B", kind: "recall" },
      { date: "2026-08-23", minutes: 15, topicId: "B", kind: "revision" },
      { date: "2026-08-23", minutes: 15, topicId: "A", kind: "recall" },
      { date: "2026-08-24", minutes: 60, topicId: "B", kind: "recall" },
      { date: "2026-08-25", minutes: 15, topicId: "B", kind: "revision" },
      { date: "2026-08-25", minutes: 45, topicId: "A", kind: "recall" },
      { date: "2026-08-26", minutes: 60, topicId: "B", kind: "recall" },
      { date: "2026-08-27", minutes: 60, topicId: "A", kind: "recall" },
      { date: "2026-08-28", minutes: 60, topicId: "B", kind: "recall" },
      { date: "2026-08-29", minutes: 15, topicId: "B", kind: "revision" },
      { date: "2026-08-29", minutes: 45, topicId: "A", kind: "recall" },
      { date: "2026-08-30", minutes: 60, topicId: "B", kind: "recall" },
    ]);
  });

  it("floors a fully-confident topic's weight, drops passes clamped onto the completion day, and skips revisions for a tiny topic", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-10",
      startDate: "2026-08-07",
      dailyMinutes: 60,
      examWeekBoost: false,
      today: "2026-08-01",
      topics: [topic("A", 0, 100), topic("B", 1, 0)],
    });

    // Weights A max(100-100, 10) = 10, B 100 -> budgets A 16, B 164 (largest
    // remainder). A is under the revision minimum; B completes on exam-eve, so
    // every pass clamps onto its own completion day and is dropped.
    expect(blocks).toEqual([
      { date: "2026-08-07", minutes: 16, topicId: "A", kind: "coverage" },
      { date: "2026-08-07", minutes: 44, topicId: "B", kind: "coverage" },
      { date: "2026-08-08", minutes: 60, topicId: "B", kind: "coverage" },
      { date: "2026-08-09", minutes: 15, topicId: "B", kind: "coverage" },
      { date: "2026-08-09", minutes: 45, topicId: "B", kind: "recall" },
    ]);
  });

  it("merges revision passes that clamp onto one exam-eve day into a single block (deterministic, capacity kept)", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-10",
      startDate: "2026-08-03",
      dailyMinutes: 60,
      examWeekBoost: false,
      today: "2026-08-01",
      topics: [topic("S", 0, 0)],
    });

    // One topic over 7 x 60: pass 28, coverage 336 completing 08-08; the +3
    // and +7 passes clamp onto exam-eve beside the +1 and merge there, capped
    // by the day's own capacity.
    expect(blocks).toEqual([
      { date: "2026-08-03", minutes: 60, topicId: "S", kind: "coverage" },
      { date: "2026-08-04", minutes: 60, topicId: "S", kind: "coverage" },
      { date: "2026-08-05", minutes: 60, topicId: "S", kind: "coverage" },
      { date: "2026-08-06", minutes: 60, topicId: "S", kind: "coverage" },
      { date: "2026-08-07", minutes: 60, topicId: "S", kind: "coverage" },
      { date: "2026-08-08", minutes: 36, topicId: "S", kind: "coverage" },
      { date: "2026-08-08", minutes: 24, topicId: "S", kind: "recall" },
      { date: "2026-08-09", minutes: 60, topicId: "S", kind: "revision" },
    ]);
  });

  it("never schedules a day past its capacity, whatever the topics (invariant 1, property check)", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-31",
      startDate: "2026-08-01",
      dailyMinutes: 45,
      examWeekBoost: true,
      today: "2026-08-01",
      weekdayMinutes: [45, 45, 20, 45, 20, 0, 90],
      topics: [topic("A", 0, 5), topic("B", 1, null), topic("C", 2, 70), topic("D", 3, 40)],
    });

    const byDate = new Map<string, number>();
    for (const block of blocks) {
      byDate.set(block.date, (byDate.get(block.date) ?? 0) + block.minutes);
    }
    for (const [date, minutes] of byDate) {
      const cap = planDayCapacity(
        {
          examDate: "2026-08-31",
          dailyMinutes: 45,
          examWeekBoost: true,
          weekdayMinutes: [45, 45, 20, 45, 20, 0, 90],
        },
        date,
      );
      expect(minutes, date).toBeLessThanOrEqual(cap);
    }
    // And every scheduled minute belongs to a non-cut topic with a kind.
    expect(blocks.every((b) => b.topicId !== null)).toBe(true);
  });

  it("is deterministic: the same input twice yields deep-equal output", () => {
    const input = {
      examDate: "2026-08-31",
      startDate: "2026-08-05",
      dailyMinutes: 40,
      examWeekBoost: true,
      today: "2026-08-02",
      weekdayMinutes: [40, 40, 40, 40, 40, 0, 60],
      topics: [topic("A", 0, null), topic("B", 1, 15), topic("C", 2, 60)],
    };
    expect(planBlockDates(input)).toEqual(planBlockDates(input));
  });

  it("treats an all-cut topic list exactly as a zero-topic plan (invariant 6)", () => {
    const base = {
      examDate: "2026-08-10",
      startDate: "2026-08-05",
      dailyMinutes: 30,
      examWeekBoost: false,
      today: "2026-08-01",
    };
    expect(planBlockDates({ ...base, topics: [topic("A", 0, 40, true)] })).toEqual(
      planBlockDates(base),
    );
  });

  it("skips zero-capacity vector days in the zero-topic path too", () => {
    const blocks = planBlockDates({
      examDate: "2026-08-10",
      startDate: "2026-08-03",
      dailyMinutes: 60,
      examWeekBoost: false,
      today: "2026-08-01",
      weekdayMinutes: [60, 30, 0, 30, 0, 0, 0],
    });
    expect(blocks).toEqual([
      plain("2026-08-03", 60),
      plain("2026-08-04", 30),
      plain("2026-08-06", 30),
    ]);
  });
});

describe("distributeBacklogCapped", () => {
  const capacity60 = () => 60;

  it("fills headroom evenly, earlier days first, and returns the overflow instead of stretching (invariant 5)", () => {
    const blocks: PlanBlockDate[] = [
      { date: "2026-08-05", minutes: 30, topicId: "t1", kind: "coverage" },
      { date: "2026-08-06", minutes: 50, topicId: "t2", kind: "coverage" },
      { date: "2026-08-07", minutes: 60, topicId: "t1", kind: "recall" },
    ];

    const result = distributeBacklogCapped(blocks, 55, capacity60);

    expect(result.blocks).toEqual([
      { date: "2026-08-05", minutes: 60, topicId: "t1", kind: "coverage" },
      { date: "2026-08-06", minutes: 60, topicId: "t2", kind: "coverage" },
      { date: "2026-08-07", minutes: 60, topicId: "t1", kind: "recall" },
    ]);
    expect(result.overflowMinutes).toBe(15);
  });

  it("splits a fitting backlog with the earlier days absorbing the remainder", () => {
    const blocks: PlanBlockDate[] = [
      { date: "2026-08-05", minutes: 30, topicId: null, kind: "coverage" },
      { date: "2026-08-06", minutes: 30, topicId: null, kind: "coverage" },
    ];

    const result = distributeBacklogCapped(blocks, 11, capacity60);

    expect(result.blocks.map((b) => b.minutes)).toEqual([36, 35]);
    expect(result.overflowMinutes).toBe(0);
  });

  it("adds a day's extra onto its FIRST block only, never inventing rows", () => {
    const blocks: PlanBlockDate[] = [
      { date: "2026-08-05", minutes: 20, topicId: "a", kind: "coverage" },
      { date: "2026-08-05", minutes: 20, topicId: "b", kind: "revision" },
    ];

    const result = distributeBacklogCapped(blocks, 10, capacity60);

    expect(result.blocks).toEqual([
      { date: "2026-08-05", minutes: 30, topicId: "a", kind: "coverage" },
      { date: "2026-08-05", minutes: 20, topicId: "b", kind: "revision" },
    ]);
    expect(result.overflowMinutes).toBe(0);
  });

  it("reports the whole backlog as overflow when nothing has headroom", () => {
    const blocks: PlanBlockDate[] = [
      { date: "2026-08-05", minutes: 60, topicId: null, kind: "coverage" },
    ];
    const result = distributeBacklogCapped(blocks, 40, capacity60);
    expect(result.blocks).toEqual(blocks);
    expect(result.overflowMinutes).toBe(40);
  });

  it("reports the whole backlog as overflow over an empty block list", () => {
    const result = distributeBacklogCapped([], 25, capacity60);
    expect(result.blocks).toEqual([]);
    expect(result.overflowMinutes).toBe(25);
  });

  it("returns the blocks unchanged with zero overflow for a zero or negative backlog", () => {
    const blocks: PlanBlockDate[] = [
      { date: "2026-08-05", minutes: 30, topicId: null, kind: "coverage" },
    ];
    expect(distributeBacklogCapped(blocks, 0, capacity60)).toEqual({
      blocks,
      overflowMinutes: 0,
    });
    expect(distributeBacklogCapped(blocks, -5, capacity60)).toEqual({
      blocks,
      overflowMinutes: 0,
    });
  });

  it("never mutates its input", () => {
    const blocks: PlanBlockDate[] = [
      { date: "2026-08-05", minutes: 30, topicId: null, kind: "coverage" },
    ];
    const result = distributeBacklogCapped(blocks, 10, capacity60);
    expect(result.blocks).not.toBe(blocks);
    expect(blocks[0]!.minutes).toBe(30);
  });
});
