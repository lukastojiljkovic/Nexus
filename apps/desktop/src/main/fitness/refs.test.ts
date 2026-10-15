import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FitExerciseStore, FitFoodStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
import { catalogueFood } from "@nexus/core";
import {
  exerciseCandidates,
  fitExerciseLookup,
  foodCandidates,
  resolveLoggedExercise,
  resolveLoggedFood,
} from "./refs.js";

/**
 * The trusted side of a logged food or set, over a real database. These are the
 * cases the module's security boundary exists for: a catalogue reference takes
 * the numbers the app ships, a user reference takes the profile's own row, and a
 * reference that names nothing live is refused rather than logged as a name with
 * no meaning.
 */

const NOW_ISO = new Date(2026, 9, 10, 9, 0, 0).toISOString();

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-fitness-refs-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

const per100g = { kcal: 200, protein: 10, carbs: 20, fat: 5, fiber: 1, sugar: 2, sodiumMg: 100 };

describe("resolveLoggedFood", () => {
  it("takes a catalogue food's numbers from the app's own data", () => {
    const food = catalogueFood("jogurt-punomasni");
    expect(food).toBeDefined();
    const resolved = resolveLoggedFood(new FitFoodStore(db.raw, profileId), "catalogue:jogurt-punomasni");
    expect(resolved.foodRef).toBe("catalogue:jogurt-punomasni");
    expect(resolved.per100g).toEqual(food?.per100g);
  });

  it("takes a user food's numbers from the profile's own row", () => {
    const foods = new FitFoodStore(db.raw, profileId);
    const own = foods.create({ name: "Domaća pita", category: "pekarsko", per100g }, NOW_ISO);
    const resolved = resolveLoggedFood(foods, `user:${own.id}`);
    expect(resolved).toEqual({ foodRef: `user:${own.id}`, label: "Domaća pita", per100g });
  });

  it("refuses a soft-deleted user food, while the rest of the pool stays", () => {
    const foods = new FitFoodStore(db.raw, profileId);
    const gone = foods.create({ name: "Stara pita", category: "pekarsko", per100g }, NOW_ISO);
    foods.softDelete(gone.id, NOW_ISO);
    expect(() => resolveLoggedFood(foods, `user:${gone.id}`)).toThrow();
    expect(foodCandidates(foods).map((candidate) => candidate.id)).not.toContain(`user:${gone.id}`);
  });

  it("refuses a catalogue id this build does not ship, and a malformed reference", () => {
    const foods = new FitFoodStore(db.raw, profileId);
    expect(() => resolveLoggedFood(foods, "catalogue:nema-takve")).toThrow(
      'names no food this build ships',
    );
    expect(() => resolveLoggedFood(foods, "nekako")).toThrow('must be "catalogue:<id>" or "user:<id>"');
    expect(() => resolveLoggedFood(foods, 42)).toThrow('must be a string');
  });
});

describe("resolveLoggedExercise", () => {
  it("takes a catalogue exercise's metric and muscles from the catalogue", () => {
    const resolved = resolveLoggedExercise(new FitExerciseStore(db.raw, profileId), "catalogue:vis-na-sipci");
    expect(resolved.exerciseRef).toBe("catalogue:vis-na-sipci");
    expect(resolved.metric).toBe("time");
  });

  it("takes a user exercise's metric from the profile's own row", () => {
    const exercises = new FitExerciseStore(db.raw, profileId);
    const own = exercises.create(
      {
        name: "Plank na loptici",
        nameEn: "",
        primaryMuscles: ["grudi"],
        equipment: "sopstvena-tezina",
        pattern: "horizontalni-potisak",
        metric: "time",
      },
      NOW_ISO,
    );
    const resolved = resolveLoggedExercise(exercises, `user:${own.id}`);
    expect(resolved.metric).toBe("time");
    expect(resolved.label).toBe("Plank na loptici");
  });

  it("refuses a soft-deleted user exercise, and the lookup answers null for it", () => {
    const exercises = new FitExerciseStore(db.raw, profileId);
    const own = exercises.create(
      {
        name: "Stari potisak",
        nameEn: "",
        primaryMuscles: ["grudi"],
        equipment: "bucice",
        pattern: "horizontalni-potisak",
        metric: "weight_reps",
      },
      NOW_ISO,
    );
    exercises.remove(own.id, NOW_ISO);
    expect(() => resolveLoggedExercise(exercises, `user:${own.id}`)).toThrow();
    expect(fitExerciseLookup(exercises)(`user:${own.id}`)).toBeNull();
    expect(exerciseCandidates(exercises).map((candidate) => candidate.id)).not.toContain(`user:${own.id}`);
  });

  it("refuses a catalogue id this build does not ship", () => {
    expect(() =>
      resolveLoggedExercise(new FitExerciseStore(db.raw, profileId), "catalogue:nema-takve"),
    ).toThrow('names no exercise this build ships');
  });
});
