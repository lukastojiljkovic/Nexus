import { describe, expect, it } from "vitest";
import type { ExerciseMetric, MuscleGroup } from "./exercise.js";
import type { SetKind } from "./training.js";
import {
  exerciseRecords,
  mondayOf,
  oneRepMaxTrend,
  weeklyVolume,
  type ProgressSet,
} from "./progress.js";

function set(over: Partial<ProgressSet> & { day: string }): ProgressSet {
  return {
    exerciseRef: "catalogue:potisak-sa-klupe",
    label: "Potisak sa klupe",
    kind: "working" as SetKind,
    metric: "weight_reps" as ExerciseMetric,
    primaryMuscles: ["grudi"] as MuscleGroup[],
    weightKg: null,
    reps: null,
    seconds: null,
    ...over,
  };
}

describe("exerciseRecords", () => {
  it("keeps the heaviest set and the day it happened on", () => {
    const [record] = exerciseRecords([
      set({ day: "2026-07-01", weightKg: 80, reps: 5 }),
      set({ day: "2026-07-08", weightKg: 90, reps: 3 }),
      set({ day: "2026-07-15", weightKg: 85, reps: 5 }),
    ]);
    expect(record?.heaviest).toEqual({ value: { weightKg: 90, reps: 3 }, day: "2026-07-08" });
  });

  it("never counts a warm-up, and drops an exercise that was only warm-ups", () => {
    const records = exerciseRecords([
      set({ day: "2026-07-01", kind: "warmup", weightKg: 200, reps: 1 }),
      set({ day: "2026-07-01", weightKg: 80, reps: 5 }),
      set({ day: "2026-07-01", exerciseRef: "catalogue:cucanj", kind: "warmup", weightKg: 60, reps: 5 }),
    ]);
    expect(records).toHaveLength(1);
    expect(records[0]?.heaviest?.value.weightKg).toBe(80);
    expect(records[0]?.sets).toBe(1);
  });

  it("refuses a heaviest set for assisted reps, where a bigger number is LESS work", () => {
    const [record] = exerciseRecords([
      set({ day: "2026-07-01", metric: "assisted_reps", weightKg: 30, reps: 8 }),
      set({ day: "2026-07-08", metric: "assisted_reps", weightKg: 20, reps: 8 }),
    ]);
    expect(record?.heaviest).toBeNull();
    // The record that DOES apply: the least help you needed.
    expect(record?.leastAssistance).toEqual({ value: { weightKg: 20, reps: 8 }, day: "2026-07-08" });
  });

  it("breaks an assistance tie on the reps done with it", () => {
    const [record] = exerciseRecords([
      set({ day: "2026-07-01", metric: "assisted_reps", weightKg: 10, reps: 5 }),
      set({ day: "2026-07-08", metric: "assisted_reps", weightKg: 10, reps: 9 }),
    ]);
    expect(record?.leastAssistance?.value.reps).toBe(9);
  });

  it("estimates a one-rep max only where the estimate is defensible", () => {
    const [record] = exerciseRecords([
      // Fifteen reps: past ONE_RM_MAX_REPS, so no estimate at all.
      set({ day: "2026-07-01", weightKg: 60, reps: 15 }),
      set({ day: "2026-07-08", weightKg: 100, reps: 3 }),
    ]);
    expect(record?.bestOneRm?.day).toBe("2026-07-08");
    expect(record?.bestOneRm?.value.reps).toBe(3);
    // Epley: 100 × (1 + 3/30) = 110.
    expect(record?.bestOneRm?.value.kg).toBeCloseTo(110, 10);
  });

  it("gives a weighted pull-up no one-rep max, because the body is the load", () => {
    const [record] = exerciseRecords([
      set({ day: "2026-07-01", metric: "weighted_reps", weightKg: 20, reps: 5 }),
    ]);
    expect(record?.bestOneRm).toBeNull();
    expect(record?.heaviest?.value.weightKg).toBe(20);
  });

  it("records a hold only where seconds are recorded", () => {
    const [record] = exerciseRecords([
      set({ day: "2026-07-01", metric: "time", seconds: 45, primaryMuscles: ["trbusnjaci"] }),
      set({ day: "2026-07-08", metric: "time", seconds: 70, primaryMuscles: ["trbusnjaci"] }),
    ]);
    expect(record?.longestHold).toEqual({ value: 70, day: "2026-07-08" });
    expect(record?.heaviest).toBeNull();
    expect(record?.mostReps).toBeNull();
  });

  it("names the exercise as its LATEST set called it, and orders by that set", () => {
    const records = exerciseRecords([
      set({ day: "2026-07-01", exerciseRef: "user:a", label: "Staro ime", weightKg: 50, reps: 5 }),
      set({ day: "2026-07-20", exerciseRef: "user:a", label: "Novo ime", weightKg: 55, reps: 5 }),
      set({ day: "2026-07-10", exerciseRef: "user:b", label: "Druga", weightKg: 40, reps: 5 }),
    ]);
    expect(records.map((entry) => entry.exerciseRef)).toEqual(["user:a", "user:b"]);
    expect(records[0]?.label).toBe("Novo ime");
  });
});

describe("weeklyVolume", () => {
  it("bills one hard set to each PRIMARY muscle and nothing to a secondary", () => {
    const [week] = weeklyVolume([
      set({ day: "2026-08-05", weightKg: 80, reps: 5, primaryMuscles: ["grudi", "triceps"] }),
      set({ day: "2026-08-05", weightKg: 80, reps: 5, primaryMuscles: ["grudi", "triceps"] }),
    ]);
    expect(week?.hardSets).toEqual({ grudi: 2, triceps: 2 });
    expect(week?.sets).toBe(2);
  });

  it("groups by the Monday of the week, whichever day the session fell on", () => {
    // 2026-08-03 is a Monday; 2026-08-09 is the Sunday of the same week.
    const weeks = weeklyVolume([
      set({ day: "2026-08-03", weightKg: 60, reps: 5 }),
      set({ day: "2026-08-09", weightKg: 60, reps: 5 }),
      set({ day: "2026-08-10", weightKg: 60, reps: 5 }),
    ]);
    expect(weeks.map((week) => week.weekStart)).toEqual(["2026-08-03", "2026-08-10"]);
    expect(weeks[0]?.days).toBe(2);
    expect(weeks[1]?.days).toBe(1);
  });

  it("keeps tonnage apart from the sets it could not weigh", () => {
    const [week] = weeklyVolume([
      set({ day: "2026-08-05", weightKg: 60, reps: 10 }),
      set({ day: "2026-08-05", metric: "reps", reps: 12, primaryMuscles: ["latovi"] }),
      set({ day: "2026-08-05", metric: "time", seconds: 60, primaryMuscles: ["trbusnjaci"] }),
    ]);
    expect(week?.tonnageKg).toBe(600);
    expect(week?.tonnageSets).toBe(1);
    expect(week?.sets).toBe(3);
  });

  it("has no row at all for a week nobody trained", () => {
    const weeks = weeklyVolume([
      set({ day: "2026-08-03", weightKg: 60, reps: 5 }),
      set({ day: "2026-08-17", weightKg: 60, reps: 5 }),
    ]);
    expect(weeks.map((week) => week.weekStart)).toEqual(["2026-08-03", "2026-08-17"]);
  });

  it("excludes warm-ups from every figure", () => {
    const [week] = weeklyVolume([
      set({ day: "2026-08-05", kind: "warmup", weightKg: 40, reps: 10 }),
      set({ day: "2026-08-05", weightKg: 60, reps: 10 }),
    ]);
    expect(week?.sets).toBe(1);
    expect(week?.tonnageKg).toBe(600);
    expect(week?.hardSets).toEqual({ grudi: 1 });
  });
});

describe("mondayOf", () => {
  it("puts Sunday at the END of its week, not the start of the next", () => {
    expect(mondayOf("2026-08-09")).toBe("2026-08-03");
    expect(mondayOf("2026-08-03")).toBe("2026-08-03");
    expect(mondayOf("2026-08-04")).toBe("2026-08-03");
  });

  it("refuses a day that does not exist", () => {
    expect(mondayOf("2026-02-30")).toBeNull();
    expect(mondayOf("juce")).toBeNull();
  });
});

describe("oneRepMaxTrend", () => {
  it("keeps one point per day — the best estimate that day", () => {
    const trend = oneRepMaxTrend(
      [
        set({ day: "2026-07-01", weightKg: 100, reps: 3 }),
        set({ day: "2026-07-01", weightKg: 90, reps: 5 }),
        set({ day: "2026-07-08", weightKg: 105, reps: 3 }),
      ],
      "catalogue:potisak-sa-klupe",
    );
    expect(trend).toHaveLength(2);
    expect(trend[0]?.day).toBe("2026-07-01");
    expect(trend[0]?.estimate.kg).toBeCloseTo(110, 10);
  });

  it("skips a day whose sets produced no defensible estimate rather than carrying one forward", () => {
    const trend = oneRepMaxTrend(
      [
        set({ day: "2026-07-01", weightKg: 100, reps: 3 }),
        set({ day: "2026-07-08", weightKg: 60, reps: 20 }),
      ],
      "catalogue:potisak-sa-klupe",
    );
    expect(trend.map((point) => point.day)).toEqual(["2026-07-01"]);
  });

  it("answers about ONE exercise and ignores the rest of the log", () => {
    const trend = oneRepMaxTrend(
      [
        set({ day: "2026-07-01", weightKg: 100, reps: 3 }),
        set({ day: "2026-07-02", exerciseRef: "catalogue:cucanj", weightKg: 140, reps: 3 }),
      ],
      "catalogue:cucanj",
    );
    expect(trend).toHaveLength(1);
    expect(trend[0]?.estimate.kg).toBeCloseTo(154, 10);
  });

  it("takes the formula it is given", () => {
    const trend = oneRepMaxTrend(
      [set({ day: "2026-07-01", weightKg: 100, reps: 5 })],
      "catalogue:potisak-sa-klupe",
      "brzycki",
    );
    // Brzycki: 100 × 36/32 = 112.5.
    expect(trend[0]?.estimate.kg).toBeCloseTo(112.5, 10);
    expect(trend[0]?.estimate.formula).toBe("brzycki");
  });
});
