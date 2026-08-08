import { describe, expect, it } from "vitest";
import {
  EXERCISE_EQUIPMENT,
  EXERCISE_METRICS,
  exerciseRefText,
  exercisesForMuscle,
  MAX_EXERCISE_REF_LENGTH,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  parseExerciseRef,
  searchExercises,
  validateExerciseEntry,
} from "./exercise.js";
import type { ExerciseEntry } from "./exercise.js";
import { EXERCISE_CATALOGUE } from "./catalogue.js";

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

describe("exerciseRefText / parseExerciseRef", () => {
  it("round-trips both kinds", () => {
    expect(exerciseRefText({ kind: "catalogue", id: "potisak-sa-klupe" })).toBe(
      "catalogue:potisak-sa-klupe",
    );
    expect(parseExerciseRef("catalogue:potisak-sa-klupe")).toEqual({
      kind: "catalogue",
      id: "potisak-sa-klupe",
    });
    expect(parseExerciseRef("user:0191f2c0-1234-7abc-8def-0123456789ab")).toEqual({
      kind: "user",
      id: "0191f2c0-1234-7abc-8def-0123456789ab",
    });
  });

  it("refuses a catalogue id that is not a catalogue slug", () => {
    // The half is checked by the rules ITS side uses, so a reference that could
    // never resolve is refused where it enters rather than where it is read.
    expect(parseExerciseRef("catalogue:Potisak Sa Klupe")).toBeNull();
    expect(parseExerciseRef("catalogue:")).toBeNull();
    expect(parseExerciseRef("catalogue:-leading")).toBeNull();
  });

  it("refuses an unknown kind, a missing separator and an over-long reference", () => {
    expect(parseExerciseRef("shipped:potisak")).toBeNull();
    expect(parseExerciseRef("potisak-sa-klupe")).toBeNull();
    expect(parseExerciseRef(":potisak")).toBeNull();
    expect(parseExerciseRef(`user:${"a".repeat(MAX_EXERCISE_REF_LENGTH)}`)).toBeNull();
  });
});

describe("searchExercises", () => {
  const pool = [
    { id: "a", name: "Mrtvo dizanje", nameEn: "Deadlift" },
    { id: "b", name: "Rumunsko mrtvo dizanje", nameEn: "Romanian deadlift" },
    { id: "c", name: "Potisak kukovima", nameEn: "Hip thrust" },
    { id: "d", name: "Sklekovi", nameEn: "" },
  ];

  it("ranks a Serbian prefix above a Serbian substring", () => {
    expect(searchExercises(pool, "mrtvo", 10).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("finds the English name, which is what the lifting world writes", () => {
    expect(searchExercises(pool, "hip thrust", 10).map((e) => e.id)).toEqual(["c"]);
    expect(searchExercises(pool, "deadlift", 10).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("puts a Serbian match ahead of an English one", () => {
    // „Potisak" is Serbian for c and appears nowhere in a's or b's Serbian name.
    expect(searchExercises(pool, "potisak", 10).map((e) => e.id)).toEqual(["c"]);
  });

  it("folds Serbian diacritics the way the rest of the app does", () => {
    const withDiacritics = [{ id: "e", name: "Čučanj", nameEn: "Squat" }];
    expect(searchExercises(withDiacritics, "cucanj", 10).map((e) => e.id)).toEqual(["e"]);
  });

  it("answers nothing for a blank query or a zero limit", () => {
    expect(searchExercises(pool, "   ", 10)).toEqual([]);
    expect(searchExercises(pool, "mrtvo", 0)).toEqual([]);
  });

  it("caps at the limit", () => {
    expect(searchExercises(pool, "dizanje", 1)).toHaveLength(1);
  });

  it("ignores an empty English name rather than matching everything against it", () => {
    expect(searchExercises(pool, "", 10)).toEqual([]);
    expect(searchExercises(pool, "squat", 10)).toEqual([]);
  });
});

describe("exercisesForMuscle", () => {
  const pool = [
    {
      name: "Potisak sa klupe",
      primaryMuscles: ["grudi"] as const,
      secondaryMuscles: ["triceps", "prednja-ramena"] as const,
    },
    {
      name: "Propadanja",
      primaryMuscles: ["grudi"] as const,
      secondaryMuscles: ["triceps"] as const,
    },
    {
      name: "Francuski potisak",
      primaryMuscles: ["triceps"] as const,
      secondaryMuscles: [] as const,
    },
    {
      name: "Čučanj",
      primaryMuscles: ["kvadriceps"] as const,
      secondaryMuscles: ["gluteusi"] as const,
    },
  ];

  it("keeps what an exercise is FOR apart from what it also works", () => {
    // One ranked list would put the close-grip bench among the triceps
    // exercises on the strength of a secondary billing.
    const result = exercisesForMuscle(pool, "triceps");
    expect(result.primary.map((entry) => entry.name)).toEqual(["Francuski potisak"]);
    expect(result.secondary.map((entry) => entry.name)).toEqual(["Potisak sa klupe", "Propadanja"]);
  });

  it("sorts each list sr-Latn, which a plain compare would get wrong at C/Ć/Č", () => {
    const collated = exercisesForMuscle(
      [
        { name: "Čučanj", primaryMuscles: ["kvadriceps"] as const, secondaryMuscles: [] as const },
        { name: "Cable krosover", primaryMuscles: ["kvadriceps"] as const, secondaryMuscles: [] as const },
        { name: "Ćuškanje sanki", primaryMuscles: ["kvadriceps"] as const, secondaryMuscles: [] as const },
      ],
      "kvadriceps",
    );
    // The Serbian Latin alphabet runs … C, Č, Ć, D … — so „Čučanj" precedes
    // „Ćuškanje", which is precisely the order a plain `localeCompare` on "sr"
    // (or on the default locale) gets wrong.
    expect(collated.primary.map((entry) => entry.name)).toEqual([
      "Cable krosover",
      "Čučanj",
      "Ćuškanje sanki",
    ]);
  });

  it("bills an entry to primary when it somehow claims both", () => {
    // `validateExerciseEntry` refuses this, so it can only reach here from a
    // user row written before that gate existed — and „what it is for" is the
    // honest of the two answers.
    const both = [
      { name: "Sporna", primaryMuscles: ["grudi"] as const, secondaryMuscles: ["grudi"] as const },
    ];
    const result = exercisesForMuscle(both, "grudi");
    expect(result.primary).toHaveLength(1);
    expect(result.secondary).toHaveLength(0);
  });

  it("answers two empty lists for a muscle nothing in the pool trains", () => {
    expect(exercisesForMuscle(pool, "listovi")).toEqual({ primary: [], secondary: [] });
  });

  it("finds something for every muscle group in the shipped catalogue", () => {
    // A group with no primary exercise anywhere is a hole in the catalogue, and
    // it would show up in the app as a muscle you can select and learn nothing
    // from. Checked against the vocabulary rather than a copy of it.
    const empty = MUSCLE_GROUPS.filter(
      (muscle) => exercisesForMuscle(EXERCISE_CATALOGUE, muscle).primary.length === 0,
    );
    expect(empty).toEqual([]);
  });
});
