import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FitExerciseNotFoundError,
  FitExerciseStore,
  FitExerciseValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";
import type { CreateFitExerciseInput } from "../index.js";

const NOW = "2026-08-01T08:00:00.000Z";
const LATER = "2026-08-02T09:00:00.000Z";

const BENCH: CreateFitExerciseInput = {
  name: "Potisak sa klupe",
  nameEn: "Bench press",
  primaryMuscles: ["grudi"],
  secondaryMuscles: ["triceps", "prednja-ramena"],
  equipment: "sipka",
  pattern: "horizontalni-potisak",
  unilateral: false,
  metric: "weight_reps",
  notes: "",
};

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-fit-exercises-"));
  db = openDatabase({ path: join(dir, "fit.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

function store(): FitExerciseStore {
  return new FitExerciseStore(db.raw, createProfile());
}

describe("FitExerciseStore.create/get", () => {
  it("inserts an exercise and reads it back", () => {
    const exercises = store();
    const created = exercises.create(BENCH, NOW);

    expect(created).toMatchObject({
      name: "Potisak sa klupe",
      nameEn: "Bench press",
      primaryMuscles: ["grudi"],
      secondaryMuscles: ["triceps", "prednja-ramena"],
      equipment: "sipka",
      pattern: "horizontalni-potisak",
      unilateral: false,
      metric: "weight_reps",
      notes: "",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(exercises.get(created.id)).toEqual(created);
  });

  it("defaults nameEn, secondaryMuscles, unilateral and notes when omitted", () => {
    const exercises = store();
    const created = exercises.create(
      { name: "Čučanj", primaryMuscles: ["kvadriceps"], equipment: "sipka", pattern: "cucanj", metric: "weight_reps" },
      NOW,
    );
    expect(created).toMatchObject({
      nameEn: "",
      secondaryMuscles: [],
      unilateral: false,
      notes: "",
    });
  });

  it("de-duplicates muscles, preserving first-occurrence order", () => {
    const exercises = store();
    const created = exercises.create(
      { ...BENCH, primaryMuscles: ["grudi", "triceps", "grudi"] },
      NOW,
    );
    expect(created.primaryMuscles).toEqual(["grudi", "triceps"]);
  });

  it("trims name and nameEn", () => {
    const exercises = store();
    const created = exercises.create({ ...BENCH, name: "  Čučanj  ", nameEn: "  Squat  " }, NOW);
    expect(created.name).toBe("Čučanj");
    expect(created.nameEn).toBe("Squat");
  });

  it("throws for another profile's id", () => {
    const mine = store();
    const theirs = new FitExerciseStore(db.raw, createProfile());
    const created = mine.create(BENCH, NOW);
    expect(() => theirs.get(created.id)).toThrow(FitExerciseNotFoundError);
  });

  it("throws for an unknown id", () => {
    expect(() => store().get(uuidv7())).toThrow(FitExerciseNotFoundError);
  });
});

describe("FitExerciseStore validation", () => {
  it("refuses an empty name after trimming", () => {
    expect(() => store().create({ ...BENCH, name: "   " }, NOW)).toThrow(FitExerciseValidationError);
  });

  it("refuses a name over 80 characters", () => {
    expect(() => store().create({ ...BENCH, name: "a".repeat(81) }, NOW)).toThrow(
      FitExerciseValidationError,
    );
  });

  it("refuses a nameEn over 80 characters", () => {
    expect(() => store().create({ ...BENCH, nameEn: "a".repeat(81) }, NOW)).toThrow(
      FitExerciseValidationError,
    );
  });

  it("refuses notes over 500 characters", () => {
    expect(() => store().create({ ...BENCH, notes: "a".repeat(501) }, NOW)).toThrow(
      FitExerciseValidationError,
    );
  });

  it("refuses an empty primaryMuscles list", () => {
    expect(() => store().create({ ...BENCH, primaryMuscles: [] }, NOW)).toThrow(
      FitExerciseValidationError,
    );
  });

  it("accepts an empty secondaryMuscles list", () => {
    expect(() =>
      store().create({ ...BENCH, secondaryMuscles: [] }, NOW),
    ).not.toThrow();
  });

  it("refuses an unknown muscle in either list", () => {
    expect(() =>
      store().create({ ...BENCH, primaryMuscles: ["nepostojeci" as never] }, NOW),
    ).toThrow(FitExerciseValidationError);
    expect(() =>
      store().create({ ...BENCH, secondaryMuscles: ["nepostojeci" as never] }, NOW),
    ).toThrow(FitExerciseValidationError);
  });

  it("refuses an unknown equipment, pattern or metric", () => {
    expect(() => store().create({ ...BENCH, equipment: "nesto" as never }, NOW)).toThrow(
      FitExerciseValidationError,
    );
    expect(() => store().create({ ...BENCH, pattern: "nesto" as never }, NOW)).toThrow(
      FitExerciseValidationError,
    );
    expect(() => store().create({ ...BENCH, metric: "nesto" as never }, NOW)).toThrow(
      FitExerciseValidationError,
    );
  });

  it("refuses a `now` that is not an ISO-8601 instant", () => {
    expect(() => store().create(BENCH, "2026-08-01")).toThrow(FitExerciseValidationError);
  });
});

describe("FitExerciseStore corruption on read", () => {
  it("throws when primary_muscles_json no longer parses", () => {
    const exercises = store();
    const created = exercises.create(BENCH, NOW);
    db.raw
      .prepare("UPDATE fit_exercises SET primary_muscles_json = ? WHERE id = ?")
      .run("{not json", created.id);
    expect(() => exercises.get(created.id)).toThrow(FitExerciseValidationError);
  });

  it("throws when the stored JSON is not an array of known muscle groups", () => {
    const exercises = store();
    const created = exercises.create(BENCH, NOW);
    db.raw
      .prepare("UPDATE fit_exercises SET secondary_muscles_json = ? WHERE id = ?")
      .run(JSON.stringify(["ne-postoji"]), created.id);
    expect(() => exercises.get(created.id)).toThrow(FitExerciseValidationError);
  });
});

describe("FitExerciseStore.list", () => {
  it("lists only live exercises, sr-Latn alphabetical", () => {
    const exercises = store();
    exercises.create({ ...BENCH, name: "Zgibovi" }, NOW);
    exercises.create({ ...BENCH, name: "Čučanj" }, NOW);
    exercises.create({ ...BENCH, name: "Ashtanga" }, NOW);

    expect(exercises.list().map((e) => e.name)).toEqual(["Ashtanga", "Čučanj", "Zgibovi"]);
  });

  it("excludes soft-deleted exercises", () => {
    const exercises = store();
    const created = exercises.create(BENCH, NOW);
    exercises.remove(created.id, NOW);
    expect(exercises.list()).toEqual([]);
  });
});

describe("FitExerciseStore.update", () => {
  it("patches only the given fields, leaving the rest untouched", () => {
    const exercises = store();
    const created = exercises.create(BENCH, NOW);
    const updated = exercises.update(created.id, { notes: "levi lakat boli" }, LATER);

    expect(updated.notes).toBe("levi lakat boli");
    expect(updated.name).toBe(BENCH.name);
    expect(updated.updatedAt).toBe(LATER);
  });

  it("replaces a muscle list wholesale when given", () => {
    const exercises = store();
    const created = exercises.create(BENCH, NOW);
    const updated = exercises.update(created.id, { primaryMuscles: ["latovi"] }, LATER);
    expect(updated.primaryMuscles).toEqual(["latovi"]);
  });

  it("throws for another profile's id", () => {
    const mine = store();
    const theirs = new FitExerciseStore(db.raw, createProfile());
    const created = mine.create(BENCH, NOW);
    expect(() => theirs.update(created.id, { notes: "x" }, NOW)).toThrow(FitExerciseNotFoundError);
  });
});

describe("FitExerciseStore.remove/restore", () => {
  it("soft-deletes and restores", () => {
    const exercises = store();
    const created = exercises.create(BENCH, NOW);

    exercises.remove(created.id, NOW);
    expect(() => exercises.get(created.id)).toThrow(FitExerciseNotFoundError);

    exercises.restore(created.id, LATER);
    expect(exercises.get(created.id).id).toBe(created.id);
  });

  it("throws removing an id that is not live", () => {
    expect(() => store().remove(uuidv7(), NOW)).toThrow(FitExerciseNotFoundError);
  });

  it("throws restoring an id that is not deleted", () => {
    const exercises = store();
    const created = exercises.create(BENCH, NOW);
    expect(() => exercises.restore(created.id, NOW)).toThrow(FitExerciseNotFoundError);
  });
});
