import { describe, expect, it } from "vitest";
import {
  EXERCISE_EQUIPMENT,
  EXERCISE_METRICS,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  validateExerciseEntry,
} from "./exercise.js";
import type { ExerciseEntry } from "./exercise.js";

/** „Potisak sa klupe" — the one entry every test below starts from. */
const BENCH: ExerciseEntry = {
  id: "potisak-sa-klupe",
  name: "Potisak sa klupe",
  nameEn: "Barbell bench press",
  primaryMuscles: ["grudi"],
  secondaryMuscles: ["triceps", "prednja-ramena"],
  equipment: "sipka",
  pattern: "horizontalni-potisak",
  unilateral: false,
  metric: "weight_reps",
};

function entry(patch: Partial<ExerciseEntry>): ExerciseEntry {
  return { ...BENCH, ...patch };
}

function codes(value: unknown): string[] {
  return validateExerciseEntry(value).map((problem) => `${problem.field}:${problem.code}`);
}

describe("validateExerciseEntry — shape", () => {
  it("accepts a well-formed entry", () => {
    expect(validateExerciseEntry(BENCH)).toEqual([]);
  });

  it("refuses anything that is not an object", () => {
    expect(codes(null)).toEqual(["<root>:shape"]);
    expect(codes("potisak")).toEqual(["<root>:shape"]);
    expect(codes([BENCH])).toEqual(["<root>:shape"]);
  });

  it("refuses a missing, blank or non-string name in either language", () => {
    expect(codes(entry({ name: "" }))).toEqual(["name:shape"]);
    expect(codes(entry({ name: "   " }))).toEqual(["name:shape"]);
    expect(codes(entry({ nameEn: "" }))).toEqual(["nameEn:shape"]);
    expect(codes({ ...BENCH, nameEn: 7 })).toEqual(["nameEn:shape"]);
  });

  it("refuses a non-boolean unilateral — it decides what one set MEANS, so a truthy string will not do", () => {
    expect(codes({ ...BENCH, unilateral: "true" })).toEqual(["unilateral:shape"]);
    expect(codes({ ...BENCH, unilateral: undefined })).toEqual(["unilateral:shape"]);
  });
});

describe("validateExerciseEntry — id", () => {
  it("accepts lower-case ASCII kebab-case with digits", () => {
    expect(validateExerciseEntry(entry({ id: "sklekovi-3-2-1" }))).toEqual([]);
  });

  it("refuses upper case, underscores, spaces and diacritics", () => {
    for (const id of ["Potisak", "potisak_sa_klupe", "potisak sa klupe", "čučanj"]) {
      expect(codes(entry({ id }))).toEqual(["id:id"]);
    }
  });

  it("refuses leading, trailing and doubled separators", () => {
    for (const id of ["-potisak", "potisak-", "potisak--sa-klupe", ""]) {
      expect(codes(entry({ id }))).toEqual(["id:id"]);
    }
  });
});

describe("validateExerciseEntry — the closed vocabularies", () => {
  it("accepts every declared muscle group in either list", () => {
    for (const muscle of MUSCLE_GROUPS) {
      expect(validateExerciseEntry(entry({ primaryMuscles: [muscle], secondaryMuscles: [] }))).toEqual([]);
    }
  });

  it("accepts every declared equipment, pattern and metric", () => {
    for (const equipment of EXERCISE_EQUIPMENT) {
      // The one cross-field rule has its own tests below; bodyweight is exercised there.
      if (equipment === "sopstvena-tezina") continue;
      expect(validateExerciseEntry(entry({ equipment }))).toEqual([]);
    }
    for (const pattern of MOVEMENT_PATTERNS) {
      expect(validateExerciseEntry(entry({ pattern }))).toEqual([]);
    }
    for (const metric of EXERCISE_METRICS) {
      expect(validateExerciseEntry(entry({ metric }))).toEqual([]);
    }
  });

  it("refuses anything outside each vocabulary, naming the value that was wrong", () => {
    expect(codes({ ...BENCH, primaryMuscles: ["chest"] })).toEqual(["primaryMuscles[0]:muscle"]);
    expect(codes({ ...BENCH, secondaryMuscles: ["triceps", 3] })).toEqual([
      "secondaryMuscles[1]:muscle",
    ]);
    expect(codes({ ...BENCH, equipment: "barbell" })).toEqual(["equipment:equipment"]);
    expect(codes({ ...BENCH, pattern: "horizontal-push" })).toEqual(["pattern:pattern"]);
    expect(codes({ ...BENCH, metric: "weight-reps" })).toEqual(["metric:metric"]);
  });

  it("refuses a non-array muscle list", () => {
    expect(codes({ ...BENCH, primaryMuscles: "grudi" })).toEqual(["primaryMuscles:shape"]);
    expect(codes({ ...BENCH, secondaryMuscles: null })).toEqual(["secondaryMuscles:shape"]);
  });
});

describe("validateExerciseEntry — the muscle lists", () => {
  it("refuses an empty primaryMuscles — an exercise that trains nothing is not an entry", () => {
    expect(codes(entry({ primaryMuscles: [] }))).toEqual(["primaryMuscles:empty"]);
  });

  it("accepts an empty secondaryMuscles — a leg extension assists nothing", () => {
    expect(
      validateExerciseEntry(entry({ primaryMuscles: ["kvadriceps"], secondaryMuscles: [] })),
    ).toEqual([]);
  });

  it("refuses the same muscle twice inside one list", () => {
    expect(codes(entry({ primaryMuscles: ["grudi", "grudi"] }))).toEqual([
      "primaryMuscles[1]:duplicate",
    ]);
    expect(codes(entry({ secondaryMuscles: ["triceps", "prednja-ramena", "triceps"] }))).toEqual([
      "secondaryMuscles[2]:duplicate",
    ]);
  });

  it("refuses a muscle in both lists — any per-muscle rollup would count it twice", () => {
    expect(codes(entry({ secondaryMuscles: ["grudi", "triceps"] }))).toEqual([
      "secondaryMuscles[0]:overlap",
    ]);
  });
});

describe("validateExerciseEntry — bodyweight is never weight_reps", () => {
  // The single cross-field rule. A movement whose resistance is the body has no
  // bar to load: the number a user would type into a weight column is their own
  // bodyweight, and it would then be summed into tonnage as though it were a
  // barbell.
  it("refuses sopstvena-tezina paired with weight_reps", () => {
    expect(codes(entry({ equipment: "sopstvena-tezina", metric: "weight_reps" }))).toEqual([
      "metric:metric",
    ]);
  });

  it("accepts every other metric on a bodyweight exercise", () => {
    for (const metric of EXERCISE_METRICS) {
      if (metric === "weight_reps") continue;
      expect(
        validateExerciseEntry(entry({ equipment: "sopstvena-tezina", metric })),
      ).toEqual([]);
    }
  });

  it("does not fire twice when the metric is unknown as well", () => {
    expect(codes({ ...BENCH, equipment: "sopstvena-tezina", metric: "kg-x-reps" })).toEqual([
      "metric:metric",
    ]);
  });
});
