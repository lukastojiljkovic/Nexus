import { describe, expect, it } from "vitest";
import { catalogueExercise, EXERCISE_CATALOGUE } from "./catalogue.js";
import {
  EXERCISE_EQUIPMENT,
  EXERCISE_METRICS,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  validateExerciseEntry,
} from "./exercise.js";

/**
 * THE gate on `data/exercises.json`.
 *
 * That file is replaced wholesale as the dataset grows, and nothing else between
 * it and a shipped build looks at a single field in it. So this suite is not a
 * formality: it is the reason `EXERCISE_CATALOGUE` may assert its type instead of
 * parsing at startup, and the reason dropping a revised dataset in here is a safe
 * thing to do. It is `catalogue.test.ts` for the other half of FIT.
 *
 * It deliberately asserts NOTHING about which exercises are present. A test that
 * expected „Mrtvo dizanje" would fail the next time somebody reorganised the
 * dataset, and would be teaching the file to hold still rather than to be right.
 */
describe("the shipped exercise catalogue", () => {
  it("is a non-empty array", () => {
    expect(Array.isArray(EXERCISE_CATALOGUE)).toBe(true);
    expect(EXERCISE_CATALOGUE.length).toBeGreaterThan(0);
  });

  it("carries no entry that fails validateExerciseEntry", () => {
    const failures = EXERCISE_CATALOGUE.flatMap((exercise, index) =>
      validateExerciseEntry(exercise).map(
        (problem) =>
          `[${index}] ${String((exercise as { id?: unknown }).id)} — ${problem.field}: ${problem.code}`,
      ),
    );
    expect(failures).toEqual([]);
  });

  it("carries no duplicate id — the reference a logged set keeps must resolve to one exercise", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const exercise of EXERCISE_CATALOGUE) {
      if (seen.has(exercise.id)) duplicates.push(exercise.id);
      seen.add(exercise.id);
    }
    expect(duplicates).toEqual([]);
  });

  it("carries no duplicate Serbian name — two identical rows in a picker are two rows nobody can choose between", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const exercise of EXERCISE_CATALOGUE) {
      if (seen.has(exercise.name)) duplicates.push(exercise.name);
      seen.add(exercise.name);
    }
    expect(duplicates).toEqual([]);
  });

  it("carries no duplicate English name either — both names are searched, so both must discriminate", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const exercise of EXERCISE_CATALOGUE) {
      if (seen.has(exercise.nameEn)) duplicates.push(exercise.nameEn);
      seen.add(exercise.nameEn);
    }
    expect(duplicates).toEqual([]);
  });

  it("uses only declared muscles, equipment, patterns and metrics", () => {
    const unknown: string[] = [];
    for (const exercise of EXERCISE_CATALOGUE) {
      for (const muscle of [...exercise.primaryMuscles, ...exercise.secondaryMuscles]) {
        if (!(MUSCLE_GROUPS as readonly string[]).includes(muscle)) {
          unknown.push(`${exercise.id}: muscle ${muscle}`);
        }
      }
      if (!(EXERCISE_EQUIPMENT as readonly string[]).includes(exercise.equipment)) {
        unknown.push(`${exercise.id}: equipment ${exercise.equipment}`);
      }
      if (!(MOVEMENT_PATTERNS as readonly string[]).includes(exercise.pattern)) {
        unknown.push(`${exercise.id}: pattern ${exercise.pattern}`);
      }
      if (!(EXERCISE_METRICS as readonly string[]).includes(exercise.metric)) {
        unknown.push(`${exercise.id}: metric ${exercise.metric}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  // The other direction, and the one a „closed vocabulary" usually forgets: a
  // value nothing uses is a value nobody has checked. It would sit in a filter
  // bar as a chip that returns an empty list, and it is how a vocabulary drifts
  // away from the dataset it was written for.
  it("leaves no declared value unused", () => {
    const muscles = new Set(
      EXERCISE_CATALOGUE.flatMap((exercise) => [
        ...exercise.primaryMuscles,
        ...exercise.secondaryMuscles,
      ]),
    );
    const equipment = new Set(EXERCISE_CATALOGUE.map((exercise) => exercise.equipment));
    const patterns = new Set(EXERCISE_CATALOGUE.map((exercise) => exercise.pattern));
    const metrics = new Set(EXERCISE_CATALOGUE.map((exercise) => exercise.metric));

    expect(MUSCLE_GROUPS.filter((muscle) => !muscles.has(muscle))).toEqual([]);
    expect(EXERCISE_EQUIPMENT.filter((item) => !equipment.has(item))).toEqual([]);
    expect(MOVEMENT_PATTERNS.filter((pattern) => !patterns.has(pattern))).toEqual([]);
    expect(EXERCISE_METRICS.filter((metric) => !metrics.has(metric))).toEqual([]);
  });

  // `assisted_reps` exists because an assisted pull-up improves DOWNWARD, and it
  // would be a dead value the moment somebody re-filed those entries under
  // `weighted_reps` with a negative number. The catalogue shipping both is what
  // keeps the distinction real rather than theoretical.
  it("ships both directions of bodyweight loading", () => {
    const byMetric = (metric: string) =>
      EXERCISE_CATALOGUE.filter((exercise) => exercise.metric === metric);
    expect(byMetric("weighted_reps").length).toBeGreaterThan(0);
    expect(byMetric("assisted_reps").length).toBeGreaterThan(0);
  });

  it("resolves every one of its own ids, and nothing else", () => {
    for (const exercise of EXERCISE_CATALOGUE) {
      expect(catalogueExercise(exercise.id)).toBe(exercise);
    }
    expect(catalogueExercise("nema-ovoga")).toBeUndefined();
  });
});
