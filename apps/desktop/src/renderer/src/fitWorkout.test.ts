import { describe, expect, it } from "vitest";
import { countsTowardVolume, EXERCISE_METRICS, SET_KINDS } from "@nexus/core";
import type {
  ExerciseMetric,
  FitExerciseOption,
  FitRoutine,
  FitWorkoutSet,
  SetKind,
} from "../../shared/ipc.js";
import {
  elapsedMinutes,
  isWholeField,
  movedByOne,
  prefillSet,
  prefillValues,
  restRemainingSeconds,
  SET_FIELD_COLUMN,
  SET_FIELDS,
  sessionExercises,
  toLoggedSet,
  workingSetCount,
  workoutTonnage,
} from "./fitWorkout.js";
import type { SessionExercise, SessionTarget } from "./fitWorkout.js";

function set(over: Partial<FitWorkoutSet> & { exerciseRef: string }): FitWorkoutSet {
  return {
    id: `set-${over.exerciseRef}-${String(over.position ?? 0)}`,
    workoutId: "w1",
    position: 0,
    label: over.exerciseRef,
    metric: "weight_reps",
    primaryMuscles: [],
    kind: "working" as SetKind,
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

function routine(refs: readonly { ref: string; label?: string; metric?: ExerciseMetric }[]): FitRoutine {
  return {
    id: "r1",
    profileId: "p1",
    name: "Gornji dan",
    notes: "",
    items: refs.map((item, index) => ({
      id: `item-${String(index)}`,
      exerciseRef: item.ref,
      label: item.label ?? item.ref,
      metric: item.metric ?? "weight_reps",
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetSeconds: null,
      targetWeightKg: null,
      targetDistanceM: null,
      restSeconds: null,
    })),
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
  };
}

function option(ref: string, metric: ExerciseMetric = "reps"): FitExerciseOption {
  return {
    ref,
    name: ref,
    nameEn: "",
    primaryMuscles: [],
    secondaryMuscles: [],
    equipment: "sopstvena-tezina",
    pattern: "izolacija",
    unilateral: false,
    metric,
    catalogue: true,
  };
}

describe("SET_FIELDS", () => {
  it("covers every metric the core vocabulary declares", () => {
    for (const metric of EXERCISE_METRICS) {
      expect(SET_FIELDS[metric].length, metric).toBeGreaterThan(0);
    }
    expect(Object.keys(SET_FIELDS).sort()).toEqual([...EXERCISE_METRICS].sort());
  });

  it("gives assisted reps their own field rather than a negative weight", () => {
    expect(SET_FIELDS.assisted_reps).toEqual(["assist", "reps"]);
    expect(SET_FIELDS.weighted_reps).toEqual(["weight", "reps"]);
    // Two names, one column: the sign lives in the metric, never in the number.
    expect(SET_FIELD_COLUMN.assist).toBe("weightKg");
    expect(SET_FIELD_COLUMN.weight).toBe("weightKg");
  });

  it("counts everything but the load in whole units", () => {
    expect(isWholeField("weight")).toBe(false);
    expect(isWholeField("assist")).toBe(false);
    expect(isWholeField("reps")).toBe(true);
    expect(isWholeField("seconds")).toBe(true);
    expect(isWholeField("distance")).toBe(true);
  });
});

describe("toLoggedSet", () => {
  it("drops a null number and keeps a zero one", () => {
    const logged = toLoggedSet(
      set({ exerciseRef: "catalogue:zgibovi", metric: "weighted_reps", weightKg: 0, reps: 8 }),
    );
    expect(logged.weightKg).toBe(0);
    expect(logged.reps).toBe(8);
    expect("seconds" in logged).toBe(false);
    expect("distanceM" in logged).toBe(false);
  });
});

describe("workoutTonnage", () => {
  it("excludes warm-ups and reports what it could not count", () => {
    const total = workoutTonnage([
      set({ exerciseRef: "a", kind: "warmup", weightKg: 40, reps: 10 }),
      set({ exerciseRef: "a", weightKg: 60, reps: 10, position: 1 }),
      set({ exerciseRef: "a", weightKg: 60, reps: 8, position: 2 }),
      set({ exerciseRef: "b", metric: "time", seconds: 45, position: 3 }),
    ]);
    expect(total.kg).toBe(60 * 10 + 60 * 8);
    expect(total.counted).toBe(2);
    expect(total.uncounted).toBe(1);
    expect(total.warmup).toBe(1);
  });
});

describe("sessionExercises", () => {
  it("lists the routine's shape first, then what else happened, then what was only picked", () => {
    const list = sessionExercises(
      [
        set({ exerciseRef: "c", weightKg: 50, reps: 10 }),
        set({ exerciseRef: "a", weightKg: 60, reps: 10, position: 1 }),
      ],
      routine([{ ref: "a" }, { ref: "b" }]),
      [option("d")],
    );
    expect(list.map((entry) => entry.ref)).toEqual(["a", "b", "c", "d"]);
    expect(list[0]?.sets).toHaveLength(1);
    expect(list[1]?.sets).toHaveLength(0);
    expect(list[1]?.target).toEqual({
      sets: 3,
      repsMin: 8,
      repsMax: 12,
      seconds: null,
      weightKg: null,
      distanceM: null,
      metric: "weight_reps",
    });
    expect(list[2]?.target).toBeNull();
  });

  it("never repeats an exercise that is both in the routine and picked again", () => {
    const list = sessionExercises([], routine([{ ref: "a" }]), [option("a"), option("a")]);
    expect(list.map((entry) => entry.ref)).toEqual(["a"]);
  });

  it("takes the metric from the SET once one exists, and from the routine before that", () => {
    const withSet = sessionExercises(
      [set({ exerciseRef: "a", metric: "time", label: "Plank", seconds: 45 })],
      routine([{ ref: "a", label: "Stara oznaka", metric: "weight_reps" }]),
      [],
    );
    expect(withSet[0]?.metric).toBe("time");
    expect(withSet[0]?.label).toBe("Plank");

    const withoutSet = sessionExercises([], routine([{ ref: "a", metric: "reps" }]), []);
    expect(withoutSet[0]?.metric).toBe("reps");
  });

  it("carries a routine line whose exercise no longer resolves, with no metric", () => {
    // `metric: null` is exactly what main answers for a reference that resolves
    // to nothing, and it is what the page reads to draw the line as unusable
    // while still saying what it used to be.
    const stale = routine([{ ref: "user:gone", label: "Obrisana vežba" }]);
    const list = sessionExercises(
      [],
      { ...stale, items: stale.items.map((item) => ({ ...item, metric: null })) },
      [],
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.metric).toBeNull();
    expect(list[0]?.label).toBe("Obrisana vežba");
  });

  it("orders ad-hoc work by the set that started it", () => {
    const list = sessionExercises(
      [
        set({ exerciseRef: "z", weightKg: 20, reps: 10 }),
        set({ exerciseRef: "a", weightKg: 20, reps: 10, position: 1 }),
        set({ exerciseRef: "z", weightKg: 20, reps: 9, position: 2 }),
      ],
      null,
      [],
    );
    expect(list.map((entry) => entry.ref)).toEqual(["z", "a"]);
    expect(list[0]?.sets).toHaveLength(2);
  });
});

describe("prefillSet", () => {
  const exerciseWith = (sets: FitWorkoutSet[]) => ({
    ref: "a",
    label: "a",
    metric: "weight_reps" as ExerciseMetric,
    target: null,
    restSeconds: null,
    sets,
  });

  it("prefers this session's last set", () => {
    const last = set({ exerciseRef: "a", weightKg: 65, reps: 8, position: 1 });
    const prefill = prefillSet(exerciseWith([set({ exerciseRef: "a", weightKg: 60, reps: 10 }), last]), {
      exerciseRef: "a",
      day: "2026-07-30",
      workoutId: "w0",
      sets: [set({ exerciseRef: "a", weightKg: 100, reps: 5 })],
    });
    expect(prefill).toBe(last);
  });

  it("falls back to the last set of the last finished session", () => {
    const before = set({ exerciseRef: "a", weightKg: 100, reps: 5 });
    expect(
      prefillSet(exerciseWith([]), {
        exerciseRef: "a",
        day: "2026-07-30",
        workoutId: "w0",
        sets: [set({ exerciseRef: "a", weightKg: 90, reps: 5 }), before],
      }),
    ).toBe(before);
  });

  it("answers null when there is nothing to know", () => {
    expect(prefillSet(exerciseWith([]), undefined)).toBeNull();
  });
});

describe("prefillValues", () => {
  /** One session line with a full migration-061 prescription behind it. */
  const planned = (
    metric: ExerciseMetric,
    target: Partial<SessionTarget>,
    sets: FitWorkoutSet[] = [],
  ): SessionExercise => ({
    ref: "a",
    label: "a",
    metric,
    target: {
      sets: null,
      repsMin: null,
      repsMax: null,
      seconds: null,
      weightKg: null,
      distanceM: null,
      metric,
      ...target,
    },
    restSeconds: null,
    sets,
  });

  it("starts from the routine when nothing has been logged for the exercise", () => {
    expect(prefillValues(planned("weight_reps", { weightKg: 60, repsMin: 8, repsMax: 12 }), undefined)).toEqual(
      { weight: 60, reps: 8 },
    );
  });

  it("takes the LOWER bound of a rep range — a floor is an instruction, a ceiling is not", () => {
    expect(prefillValues(planned("reps", { repsMin: 8, repsMax: 12 }), undefined)).toEqual({ reps: 8 });
  });

  it("falls back to the ceiling when that is the only bound written", () => {
    expect(prefillValues(planned("reps", { repsMax: 12 }), undefined)).toEqual({ reps: 12 });
  });

  it("prefers what was actually logged over what was planned", () => {
    const done = set({ exerciseRef: "a", weightKg: 72.5, reps: 6 });
    expect(
      prefillValues(planned("weight_reps", { weightKg: 60, repsMin: 8 }, [done]), undefined),
    ).toEqual({ weight: 72.5, reps: 6 });
  });

  it("prefers the last finished session over the plan too", () => {
    expect(
      prefillValues(planned("weight_reps", { weightKg: 60, repsMin: 8 }), {
        exerciseRef: "a",
        day: "2026-07-30",
        workoutId: "w0",
        sets: [set({ exerciseRef: "a", weightKg: 80, reps: 5 })],
      }),
    ).toEqual({ weight: 80, reps: 5 });
  });

  it("falls back PER FIELD, so a half-recorded set still gets the plan's other half", () => {
    // A set logged before the exercise's metric was corrected: reps, no load.
    const half = set({ exerciseRef: "a", weightKg: null, reps: 6 });
    expect(
      prefillValues(planned("weight_reps", { weightKg: 60, repsMin: 8 }, [half]), undefined),
    ).toEqual({ weight: 60, reps: 6 });
  });

  it("treats a logged ZERO load as recorded, never as absent", () => {
    // A pull-up on a day the belt stayed off is `weightKg: 0`, and it must not
    // fall through to the plan's added weight.
    const beltOff = set({ exerciseRef: "a", metric: "weighted_reps", weightKg: 0, reps: 8 });
    expect(
      prefillValues(planned("weighted_reps", { weightKg: 20, repsMin: 5 }, [beltOff]), undefined),
    ).toEqual({ weight: 0, reps: 8 });
  });

  it("fills a hold and a distance, which the session used to ignore entirely", () => {
    expect(prefillValues(planned("time", { seconds: 45 }), undefined)).toEqual({ seconds: 45 });
    expect(prefillValues(planned("distance_time", { distanceM: 400, seconds: 90 }), undefined)).toEqual({
      distance: 400,
      seconds: 90,
    });
  });

  it("offers only the fields the metric declares, whatever the line prescribes", () => {
    // A line carrying a weight from before a metric correction must not put
    // kilograms into a form for an exercise that records reps alone.
    expect(prefillValues(planned("reps", { weightKg: 60, repsMin: 8 }), undefined)).toEqual({ reps: 8 });
  });

  it("answers nothing at all for a line whose exercise no longer resolves", () => {
    expect(
      prefillValues(
        { ref: "a", label: "a", metric: null, target: null, restSeconds: null, sets: [] },
        undefined,
      ),
    ).toEqual({});
  });

  it("answers nothing when there is neither a log nor a plan", () => {
    expect(
      prefillValues(
        { ref: "a", label: "a", metric: "weight_reps", target: null, restSeconds: null, sets: [] },
        undefined,
      ),
    ).toEqual({});
  });
});

describe("workingSetCount", () => {
  it("does not count the warm-up towards a prescription of three", () => {
    expect(
      workingSetCount([
        set({ exerciseRef: "a", kind: "warmup" }),
        set({ exerciseRef: "a", kind: "warmup", position: 1 }),
        set({ exerciseRef: "a", position: 2 }),
      ]),
    ).toBe(1);
  });

  it("counts drop sets and sets to failure — both are work", () => {
    expect(
      workingSetCount([
        set({ exerciseRef: "a", kind: "working" }),
        set({ exerciseRef: "a", kind: "drop", position: 1 }),
        set({ exerciseRef: "a", kind: "failure", position: 2 }),
      ]),
    ).toBe(3);
  });

  it("agrees with @nexus/core about what counts, at every kind", () => {
    // The one rule stated twice must stay one rule: a progress figure and a
    // volume figure disagreeing about what a set is would be worse than either
    // being wrong alone.
    for (const kind of SET_KINDS) {
      expect(workingSetCount([set({ exerciseRef: "a", kind })])).toBe(countsTowardVolume(kind) ? 1 : 0);
    }
  });
});

describe("a routine line's prescription reaches the session", () => {
  it("carries all six targets and the rest, not just sets and reps", () => {
    const plan = routine([{ ref: "a", metric: "time" }]);
    const line = plan.items[0];
    if (line === undefined) throw new Error("the fixture must have one item");
    const withTargets: FitRoutine = {
      ...plan,
      items: [{ ...line, targetSeconds: 45, targetWeightKg: 12, targetDistanceM: 400, restSeconds: 120 }],
    };
    const [exercise] = sessionExercises([], withTargets, []);
    expect(exercise?.target).toEqual({
      sets: 3,
      repsMin: 8,
      repsMax: 12,
      seconds: 45,
      weightKg: 12,
      distanceM: 400,
      metric: "time",
    });
    expect(exercise?.restSeconds).toBe(120);
  });

  it("keeps a prescribed ZERO rest distinct from no prescription at all", () => {
    const plan = routine([{ ref: "a" }]);
    const line = plan.items[0];
    if (line === undefined) throw new Error("the fixture must have one item");
    const [superset] = sessionExercises([], { ...plan, items: [{ ...line, restSeconds: 0 }] }, []);
    const [unstated] = sessionExercises([], plan, []);
    expect(superset?.restSeconds).toBe(0);
    expect(unstated?.restSeconds).toBeNull();
  });

  it("gives an exercise added by hand no prescription to meet", () => {
    const [added] = sessionExercises([], null, [option("b")]);
    expect(added?.target).toBeNull();
    expect(added?.restSeconds).toBeNull();
  });
});

describe("the rest countdown", () => {
  it("rounds up so a countdown never shows a second it has not finished", () => {
    const now = Date.parse("2026-08-07T10:00:00.000Z");
    expect(restRemainingSeconds("2026-08-07T10:01:30.000Z", now)).toBe(90);
    expect(restRemainingSeconds("2026-08-07T10:00:00.400Z", now)).toBe(1);
  });

  it("floors at zero rather than counting how overdue it is", () => {
    const now = Date.parse("2026-08-07T10:00:00.000Z");
    expect(restRemainingSeconds("2026-08-07T09:59:51.000Z", now)).toBe(0);
  });

  it("treats an unreadable instant as finished", () => {
    expect(restRemainingSeconds("juče", Date.now())).toBe(0);
  });

});

describe("movedByOne", () => {
  it("swaps with the neighbour in the given direction", () => {
    expect(movedByOne(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(movedByOne(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("leaves the ends alone rather than wrapping", () => {
    expect(movedByOne(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(movedByOne(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });

  it("answers a copy, never the same array", () => {
    const items = ["a", "b"];
    expect(movedByOne(items, 0, -1)).not.toBe(items);
  });

  it("refuses an index that is not in the list", () => {
    expect(movedByOne(["a", "b"], 5, -1)).toEqual(["a", "b"]);
    expect(movedByOne(["a", "b"], -1, 1)).toEqual(["a", "b"]);
  });
});

describe("elapsedMinutes", () => {
  it("counts whole minutes since the session opened", () => {
    expect(elapsedMinutes("2026-08-07T10:00:00.000Z", Date.parse("2026-08-07T11:07:30.000Z"))).toBe(67);
  });

  it("claims nothing when the clock is behind the start or the instant is unreadable", () => {
    expect(elapsedMinutes("2026-08-07T10:00:00.000Z", Date.parse("2026-08-07T09:00:00.000Z"))).toBeNull();
    expect(elapsedMinutes("nikad", Date.now())).toBeNull();
  });
});
