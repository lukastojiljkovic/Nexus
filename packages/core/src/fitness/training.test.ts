import { describe, expect, it } from "vitest";
import { EXERCISE_METRICS } from "./exercise.js";
import type { ExerciseMetric } from "./exercise.js";
import {
  BODY_WEIGHT_MIN_SAMPLES,
  BODY_WEIGHT_WINDOW_DAYS,
  ONE_RM_FORMULAS,
  ONE_RM_MAX_REPS,
  SET_KINDS,
  countsTowardVolume,
  estimateOneRepMax,
  movingAverage,
  sessionTonnage,
  setTonnage,
  trendChange,
  workingSets,
} from "./training.js";
import type { LoggedSet } from "./training.js";

/**
 * One plausible working set per metric, carrying exactly the numbers that metric
 * says a set carries — the table every tonnage assertion below is driven from.
 */
const PER_METRIC: Record<ExerciseMetric, LoggedSet> = {
  weight_reps: { kind: "working", metric: "weight_reps", weightKg: 100, reps: 5 },
  reps: { kind: "working", metric: "reps", reps: 12 },
  weighted_reps: { kind: "working", metric: "weighted_reps", weightKg: 20, reps: 5 },
  assisted_reps: { kind: "working", metric: "assisted_reps", weightKg: 30, reps: 8 },
  time: { kind: "working", metric: "time", seconds: 60 },
  weight_time: { kind: "working", metric: "weight_time", weightKg: 64, seconds: 40 },
  distance_time: { kind: "working", metric: "distance_time", distanceM: 5000, seconds: 1500 },
};

/** A barbell set, patched — the shape most of these tests vary. */
function lift(patch: Partial<LoggedSet> = {}): LoggedSet {
  return { ...PER_METRIC.weight_reps, ...patch };
}

describe("set kinds", () => {
  it("counts everything but the warm-up", () => {
    expect(SET_KINDS.filter(countsTowardVolume)).toEqual(["working", "drop", "failure"]);
    expect(countsTowardVolume("warmup")).toBe(false);
  });

  it("filters a caller's own richer row type without stripping it down first", () => {
    const rows = [
      { id: "a", kind: "warmup" as const },
      { id: "b", kind: "working" as const },
      { id: "c", kind: "drop" as const },
    ];
    expect(workingSets(rows).map((row) => row.id)).toEqual(["b", "c"]);
  });
});

describe("setTonnage", () => {
  it("multiplies weight by reps for weight_reps", () => {
    expect(setTonnage(lift({ weightKg: 100, reps: 5 }))).toBe(500);
    expect(setTonnage(lift({ weightKg: 62.5, reps: 8 }))).toBe(500);
  });

  it("counts a warm-up's tonnage too — whether it belongs in a total is the aggregate's call", () => {
    expect(setTonnage(lift({ kind: "warmup", weightKg: 60, reps: 10 }))).toBe(600);
  });

  it("answers null — NOT zero — for every metric that has no tonnage", () => {
    for (const metric of EXERCISE_METRICS) {
      if (metric === "weight_reps") continue;
      expect(setTonnage(PER_METRIC[metric])).toBeNull();
    }
    // Exactly one metric has a tonnage, and this is the assertion that says so.
    const withTonnage = EXERCISE_METRICS.filter((metric) => setTonnage(PER_METRIC[metric]) !== null);
    expect(withTonnage).toEqual(["weight_reps"]);
  });

  it("answers null for a weight_reps set that is missing either number", () => {
    expect(setTonnage({ kind: "working", metric: "weight_reps", reps: 5 })).toBeNull();
    expect(setTonnage({ kind: "working", metric: "weight_reps", weightKg: 100 })).toBeNull();
  });

  it("answers null for a negative or non-finite number rather than a nonsense product", () => {
    expect(setTonnage(lift({ weightKg: -100 }))).toBeNull();
    expect(setTonnage(lift({ reps: -5 }))).toBeNull();
    expect(setTonnage(lift({ weightKg: Number.NaN }))).toBeNull();
    expect(setTonnage(lift({ reps: Number.POSITIVE_INFINITY }))).toBeNull();
  });

  it("accepts a genuine zero — an empty-bar rep is 0 kg of tonnage, not an unanswerable question", () => {
    expect(setTonnage(lift({ weightKg: 0, reps: 5 }))).toBe(0);
    expect(setTonnage(lift({ weightKg: 100, reps: 0 }))).toBe(0);
  });
});

describe("sessionTonnage", () => {
  it("adds the counting sets and reports what it left out", () => {
    expect(
      sessionTonnage([
        lift({ kind: "warmup", weightKg: 60, reps: 10 }),
        lift({ kind: "warmup", weightKg: 80, reps: 5 }),
        lift({ weightKg: 100, reps: 5 }),
        lift({ kind: "failure", weightKg: 100, reps: 4 }),
        lift({ kind: "drop", weightKg: 80, reps: 6 }),
        PER_METRIC.reps,
        PER_METRIC.time,
      ]),
    ).toEqual({ kg: 500 + 400 + 480, counted: 3, uncounted: 2, warmup: 2 });
  });

  it("leaves the warm-up out of the total — a ramp-up is not volume", () => {
    const warmed = sessionTonnage([
      lift({ kind: "warmup", weightKg: 60, reps: 10 }),
      lift({ weightKg: 100, reps: 5 }),
    ]);
    expect(warmed.kg).toBe(500);
    expect(warmed.warmup).toBe(1);
  });

  it("answers a zero total with zero counts for an empty session", () => {
    expect(sessionTonnage([])).toEqual({ kg: 0, counted: 0, uncounted: 0, warmup: 0 });
  });

  it("reports a session it can say NOTHING about, rather than printing a confident zero", () => {
    // Two planks and a run: `kg: 0` is true only because nothing was counted, and
    // `counted: 0` is what stops a surface from drawing that as „0 kg lifted".
    expect(sessionTonnage([PER_METRIC.time, PER_METRIC.time, PER_METRIC.distance_time])).toEqual({
      kg: 0,
      counted: 0,
      uncounted: 3,
      warmup: 0,
    });
  });
});

describe("estimateOneRepMax", () => {
  it("computes Epley as w × (1 + r/30)", () => {
    expect(estimateOneRepMax(100, 5, "epley")).toEqual({
      kg: 100 * (1 + 5 / 30),
      formula: "epley",
      reps: 5,
    });
  });

  it("computes Brzycki as w × 36/(37 − r)", () => {
    expect(estimateOneRepMax(100, 5, "brzycki")).toEqual({
      kg: (100 * 36) / 32,
      formula: "brzycki",
      reps: 5,
    });
  });

  it("defaults to Epley, and says which formula it used either way", () => {
    expect(estimateOneRepMax(100, 5)?.formula).toBe("epley");
    for (const formula of ONE_RM_FORMULAS) {
      expect(estimateOneRepMax(100, 3, formula)?.formula).toBe(formula);
    }
  });

  it("answers the weight itself for a single rep, whichever formula was asked for", () => {
    // Epley's own arithmetic would say 144.67 for a 140 kg single — an ESTIMATE
    // of a number that was actually measured. The one input where the true answer
    // is known exactly is the last place to hand back a figure nobody lifted.
    for (const formula of ONE_RM_FORMULAS) {
      expect(estimateOneRepMax(140, 1, formula)).toEqual({ kg: 140, formula, reps: 1 });
    }
  });

  it("has the two formulas AGREE at exactly ten reps, which is why the cap is there", () => {
    expect(estimateOneRepMax(100, ONE_RM_MAX_REPS, "epley")?.kg).toBeCloseTo(400 / 3, 10);
    expect(estimateOneRepMax(100, ONE_RM_MAX_REPS, "brzycki")?.kg).toBeCloseTo(400 / 3, 10);
  });

  it("keeps them within four percent of each other across the whole accepted range", () => {
    for (let reps = 1; reps <= ONE_RM_MAX_REPS; reps += 1) {
      const epley = estimateOneRepMax(100, reps, "epley");
      const brzycki = estimateOneRepMax(100, reps, "brzycki");
      expect(Math.abs(epley!.kg - brzycki!.kg) / epley!.kg).toBeLessThan(0.04);
    }
  });

  it("REFUSES above ten reps rather than extrapolating", () => {
    expect(estimateOneRepMax(100, ONE_RM_MAX_REPS)).not.toBeNull();
    expect(estimateOneRepMax(100, ONE_RM_MAX_REPS + 1)).toBeNull();
    expect(estimateOneRepMax(60, 20)).toBeNull();
    // Brzycki's denominator is zero at 37 reps and negative past it, so a set of
    // fifty push-ups would be handed a NEGATIVE one-rep max by a version of this
    // function without the cap. That is the refusal, stated as a test.
    expect(estimateOneRepMax(60, 37, "brzycki")).toBeNull();
    expect(estimateOneRepMax(60, 50, "brzycki")).toBeNull();
  });

  it("refuses a rep count that is not a whole number of at least one", () => {
    expect(estimateOneRepMax(100, 0)).toBeNull();
    expect(estimateOneRepMax(100, -3)).toBeNull();
    expect(estimateOneRepMax(100, 2.5)).toBeNull();
    expect(estimateOneRepMax(100, Number.NaN)).toBeNull();
  });

  it("refuses a non-positive or non-finite weight — there is nothing to extrapolate from", () => {
    expect(estimateOneRepMax(0, 5)).toBeNull();
    expect(estimateOneRepMax(-100, 5)).toBeNull();
    expect(estimateOneRepMax(Number.POSITIVE_INFINITY, 5)).toBeNull();
  });
});

describe("movingAverage", () => {
  const reading = (day: string, value: number) => ({ day, value });

  it("averages over a CALENDAR window, so a gap thins the window instead of widening it", () => {
    // Four readings across fifteen days. A „last 7 entries" window would average
    // all four into every point and still call itself a weekly mean; the calendar
    // window sees one day, then one, then two, then two — the 1st is seven days
    // behind the 8th and so already outside it, while the 8th is six days behind
    // the 14th and still inside.
    const sparse = [
      reading("2026-08-01", 80),
      reading("2026-08-08", 82),
      reading("2026-08-14", 84),
      reading("2026-08-15", 86),
    ];
    expect(movingAverage(sparse, 7, 1)).toEqual([
      { day: "2026-08-01", value: 80, average: 80, samples: 1 },
      { day: "2026-08-08", value: 82, average: 82, samples: 1 },
      { day: "2026-08-14", value: 84, average: 83, samples: 2 },
      { day: "2026-08-15", value: 86, average: 85, samples: 2 },
    ]);
  });

  it("includes both ends of the window — seven days means today and the six before it", () => {
    const daily = [1, 2, 3, 4, 5, 6, 7, 8].map((day) =>
      reading(`2026-08-0${day}`, day),
    );
    const points = movingAverage(daily, 7, 1);
    expect(points.at(-2)).toEqual({ day: "2026-08-07", value: 7, average: 4, samples: 7 });
    // The 1st has fallen out by the 8th: the window is the 2nd through the 8th.
    expect(points.at(-1)).toEqual({ day: "2026-08-08", value: 8, average: 5, samples: 7 });
  });

  it("withholds an average until the window holds minSamples days", () => {
    const points = movingAverage(
      [reading("2026-08-01", 80), reading("2026-08-02", 82), reading("2026-08-03", 84)],
      7,
      2,
    );
    expect(points.map((point) => point.average)).toEqual([null, 81, 82]);
    expect(points.map((point) => point.samples)).toEqual([1, 2, 3]);
  });

  it("ships a seven-day window and a two-day floor for body weight", () => {
    expect(BODY_WEIGHT_WINDOW_DAYS).toBe(7);
    expect(BODY_WEIGHT_MIN_SAMPLES).toBe(2);
    // A single reading has no trend: an average through it would be the reading
    // drawn twice, and a chart would present that as a line the user could read.
    expect(
      movingAverage([reading("2026-08-01", 80)], BODY_WEIGHT_WINDOW_DAYS, BODY_WEIGHT_MIN_SAMPLES),
    ).toEqual([{ day: "2026-08-01", value: 80, average: null, samples: 1 }]);
  });

  it("sorts an unsorted series and collapses a day read twice to its mean", () => {
    const points = movingAverage(
      [
        reading("2026-08-03", 84),
        reading("2026-08-01", 80),
        reading("2026-08-01", 82),
        reading("2026-08-02", 83),
      ],
      7,
      1,
    );
    expect(points.map((point) => point.day)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
    // Two readings on the 1st become one point at their mean, and the day still
    // weighs once — which is what makes `samples` a count of DAYS.
    expect(points[0]).toEqual({ day: "2026-08-01", value: 81, average: 81, samples: 1 });
    expect(points[2]?.samples).toBe(3);
  });

  it("emits a point only for days that HAVE a reading", () => {
    const points = movingAverage([reading("2026-08-01", 80), reading("2026-08-05", 82)], 7, 1);
    expect(points.map((point) => point.day)).toEqual(["2026-08-01", "2026-08-05"]);
  });

  it("drops a row it cannot read rather than refusing the whole series", () => {
    const points = movingAverage(
      [
        reading("2026-08-01", 80),
        reading("nije-datum", 81),
        // A day that does not exist: the regex admits it and `Date.UTC` would
        // roll it into March, labelling the point one day and placing it another.
        reading("2026-02-30", 81),
        reading("2026-08-02", Number.NaN),
        reading("2026-08-03", 84),
      ],
      7,
      1,
    );
    expect(points.map((point) => point.day)).toEqual(["2026-08-01", "2026-08-03"]);
    expect(points[1]?.average).toBe(82);
  });

  it("crosses a month and a year boundary correctly", () => {
    const points = movingAverage([reading("2025-12-29", 80), reading("2026-01-02", 84)], 7, 1);
    expect(points[1]).toEqual({ day: "2026-01-02", value: 84, average: 82, samples: 2 });
  });

  it("answers an empty series with an empty list", () => {
    expect(movingAverage([], 7, 1)).toEqual([]);
  });

  it("throws on a window that is not a whole number of at least one day", () => {
    expect(() => movingAverage([], 0, 1)).toThrow(RangeError);
    expect(() => movingAverage([], 2.5, 1)).toThrow(RangeError);
    expect(() => movingAverage([], 7, 0)).toThrow(RangeError);
    expect(() => movingAverage([], 7, Number.NaN)).toThrow(RangeError);
  });
});

describe("trendChange", () => {
  const reading = (day: string, value: number) => ({ day, value });

  /** Seven consecutive days at a steady weight, then seven at another — two clean trend blocks. */
  function series(start: string, values: readonly number[]) {
    const base = Date.parse(`${start}T00:00:00Z`);
    return values.map((value, index) =>
      reading(new Date(base + index * 86_400_000).toISOString().slice(0, 10), value),
    );
  }

  it("compares two AVERAGES rather than two readings", () => {
    // A series that drifts down 200 g a day, with a 2 kg spike on the last day.
    // The raw comparison would report a GAIN; the trend reports the loss.
    const values = [82, 81.8, 81.6, 81.4, 81.2, 81, 80.8, 80.6, 80.4, 80.2, 80, 79.8, 79.6, 81.6];
    const points = movingAverage(series("2026-07-01", values), 7, 2);
    const change = trendChange(points, 7);
    expect(change).not.toBeNull();
    expect(change?.delta).toBeLessThan(0);
    expect(change?.days).toBe(7);
  });

  it("reaches back only as far as the series goes, and says how far that was", () => {
    const points = movingAverage(series("2026-07-01", [80, 80.2, 80.4, 80.6]), 7, 2);
    // The FIRST day carries no average at all (one reading is not a trend), so
    // four days of readings give three trend points spanning two days. A
    // thirty-day question is answered with the two days that exist, and `days`
    // says so rather than letting a caller label it a month.
    expect(trendChange(points, 30)?.days).toBe(2);
  });

  it("refuses a series with fewer than two trend values", () => {
    expect(trendChange(movingAverage([reading("2026-07-01", 80)], 7, 2), 7)).toBeNull();
    expect(trendChange([], 7)).toBeNull();
  });

  it("refuses when both ends land on the same day", () => {
    // Two readings on ONE day collapse to a single point (`movingAverage`), so
    // there is nothing to measure a change across.
    const points = movingAverage([reading("2026-07-01", 80), reading("2026-07-01", 81)], 7, 1);
    expect(points).toHaveLength(1);
    expect(trendChange(points, 7)).toBeNull();
  });

  it("throws on a window that is not a whole number of at least one day", () => {
    expect(() => trendChange([], 0)).toThrow(RangeError);
    expect(() => trendChange([], 1.5)).toThrow(RangeError);
  });
});
