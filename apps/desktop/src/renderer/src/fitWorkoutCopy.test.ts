import { describe, expect, it } from "vitest";
import type { ExerciseMetric, FitWorkoutSet } from "../../shared/ipc.js";
import { setCountText, setText, targetText, tonnageText } from "./fitWorkoutCopy.js";

function set(metric: ExerciseMetric, over: Partial<FitWorkoutSet> = {}): FitWorkoutSet {
  return {
    id: "s1",
    workoutId: "w1",
    position: 0,
    exerciseRef: "catalogue:x",
    label: "x",
    metric,
    primaryMuscles: [],
    kind: "working",
    weightKg: null,
    reps: null,
    seconds: null,
    distanceM: null,
    rir: null,
    createdAt: "2026-08-07T10:00:00.000Z",
    updatedAt: "2026-08-07T10:00:00.000Z",
    ...over,
  };
}

describe("setText", () => {
  it("reads a load and a rep count as a product", () => {
    expect(setText(set("weight_reps", { weightKg: 60, reps: 10 }))).toBe("60 kg × 10 pon.");
  });

  it("reads a rep-only set without inventing a load", () => {
    expect(setText(set("reps", { reps: 10 }))).toBe("10 pon.");
  });

  it("signs the two loads that point in opposite directions", () => {
    // +20 kg on the belt is a HARDER pull-up; 15 kg of machine help is an easier
    // one. Dropping the sign would let those two print identically.
    expect(setText(set("weighted_reps", { weightKg: 20, reps: 8 }))).toBe("+20 kg × 8 pon.");
    expect(setText(set("assisted_reps", { weightKg: 15, reps: 8 }))).toBe("−15 kg × 8 pon.");
  });

  it("keeps a zero added load, which is a real reading", () => {
    expect(setText(set("weighted_reps", { weightKg: 0, reps: 8 }))).toBe("+0 kg × 8 pon.");
  });

  it("joins two facts about the same set with a dot rather than a product", () => {
    expect(setText(set("time", { seconds: 45 }))).toBe("45 s");
    expect(setText(set("weight_time", { weightKg: 32, seconds: 40 }))).toBe("32 kg · 40 s");
    expect(setText(set("distance_time", { distanceM: 400, seconds: 95 }))).toBe("400 m · 95 s");
  });

  it("says a number was not recorded rather than printing a zero", () => {
    expect(setText(set("weight_reps", { reps: 10 }))).toBe("— kg × 10 pon.");
  });
});

describe("targetText", () => {
  it("reads sets and a rep range as a multiplier", () => {
    expect(targetText({ sets: 3, repsMin: 8, repsMax: 12 })).toBe("3 × 8–12");
  });

  it("gives sets alone their noun, agreed", () => {
    expect(targetText({ sets: 1, repsMin: null, repsMax: null })).toBe("1 serija");
    expect(targetText({ sets: 3, repsMin: null, repsMax: null })).toBe("3 serije");
    expect(targetText({ sets: 5, repsMin: null, repsMax: null })).toBe("5 serija");
  });

  it("draws each open-ended bound as the bound it is", () => {
    expect(targetText({ sets: null, repsMin: 8, repsMax: 12 })).toBe("8–12");
    expect(targetText({ sets: null, repsMin: 8, repsMax: null })).toBe("8+");
    expect(targetText({ sets: null, repsMin: null, repsMax: 12 })).toBe("≤12");
  });

  it("draws nothing at all when nothing was prescribed", () => {
    expect(targetText({ sets: null, repsMin: null, repsMax: null })).toBe("");
    expect(targetText(null)).toBe("");
  });

  it("reads a hold as its seconds rather than as nothing, given the metric", () => {
    // The whole point of migration 061: a plank has no reps at all, and
    // without a metric to read `SET_FIELDS` by the line used to say only
    // „3 serije" — true, but not what a plank needs.
    expect(
      targetText({ sets: 3, repsMin: null, repsMax: null, seconds: 45, metric: "time" }),
    ).toBe("3 × 45 s");
    expect(
      targetText({ sets: null, repsMin: null, repsMax: null, seconds: 45, metric: "time" }),
    ).toBe("45 s");
  });

  it("joins a load and a hold with a dot, exactly as the logged set would", () => {
    expect(
      targetText({
        sets: 3,
        repsMin: null,
        repsMax: null,
        seconds: 40,
        weightKg: 32,
        metric: "weight_time",
      }),
    ).toBe("3 × 32 kg · 40 s");
    expect(
      targetText({
        sets: 3,
        repsMin: null,
        repsMax: null,
        seconds: 95,
        distanceM: 400,
        metric: "distance_time",
      }),
    ).toBe("3 × 400 m · 95 s");
  });

  it("signs a target load exactly as a logged one would", () => {
    expect(
      targetText({ sets: 3, repsMin: 8, repsMax: 12, weightKg: 60, metric: "weight_reps" }),
    ).toBe("3 × 60 kg × 8–12");
    expect(
      targetText({ sets: 3, repsMin: 8, repsMax: 12, weightKg: 20, metric: "weighted_reps" }),
    ).toBe("3 × +20 kg × 8–12");
    expect(
      targetText({ sets: 3, repsMin: 8, repsMax: 12, weightKg: 15, metric: "assisted_reps" }),
    ).toBe("3 × −15 kg × 8–12");
  });

  it("keeps a zero weight target, which is a real bodyweight prescription", () => {
    expect(
      targetText({ sets: 3, repsMin: 8, repsMax: 12, weightKg: 0, metric: "weight_reps" }),
    ).toBe("3 × 0 kg × 8–12");
  });

  it("falls back to sets-and-reps when a resolved metric names no other target", () => {
    expect(targetText({ sets: 3, repsMin: 8, repsMax: 12, metric: "reps" })).toBe("3 × 8–12");
  });

  it("draws only sets for an unresolved reference, ignoring targets it has no metric to place", () => {
    // `metric: null` is exactly what an item with no live exercise carries —
    // there is no `SET_FIELDS` entry to read, so the line falls back to the
    // metric-less reading rather than guessing.
    expect(
      targetText({ sets: 3, repsMin: null, repsMax: null, seconds: 45, metric: null }),
    ).toBe("3 serije");
  });
});

describe("setCountText", () => {
  it("agrees the Serbian noun, teens included", () => {
    expect(setCountText(1)).toBe("1 serija");
    expect(setCountText(2)).toBe("2 serije");
    expect(setCountText(4)).toBe("4 serije");
    expect(setCountText(5)).toBe("5 serija");
    // 11–14 are the exception that takes `many` at every one of them.
    expect(setCountText(11)).toBe("11 serija");
    expect(setCountText(12)).toBe("12 serija");
    expect(setCountText(21)).toBe("21 serija");
    expect(setCountText(22)).toBe("22 serije");
  });
});

describe("tonnageText", () => {
  it("groups whole kilograms and rounds the noise off", () => {
    expect(tonnageText(4280)).toBe("4.280");
    expect(tonnageText(4279.6)).toBe("4.280");
    expect(tonnageText(0)).toBe("0");
  });
});
