import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FitSetNotFoundError,
  FitWorkoutNotFoundError,
  FitWorkoutStore,
  FitWorkoutValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";
import type { LogFitSetInput, StartFitWorkoutInput } from "../index.js";

const NOW = "2026-08-01T08:00:00.000Z";
const LATER = "2026-08-01T09:00:00.000Z";
const EVEN_LATER = "2026-08-01T10:00:00.000Z";

const BENCH_SET: LogFitSetInput = {
  exerciseRef: "catalogue:bench-press",
  label: "Potisak sa klupe",
  metric: "weight_reps",
  primaryMuscles: ["grudi"],
  kind: "working",
  weightKg: 80,
  reps: 8,
};

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-fit-workouts-"));
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

function store(profileId = createProfile()): FitWorkoutStore {
  return new FitWorkoutStore(db.raw, profileId);
}

function startInput(day: string): StartFitWorkoutInput {
  return { day };
}

describe("FitWorkoutStore.start/open/get", () => {
  it("opens a session and answers it from open()", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);

    expect(started).toMatchObject({
      day: "2026-08-01", startedAt: NOW, endedAt: null,
      routineRef: null, routineLabel: "", notes: "", sets: [],
    });
    expect(workouts.open()).toEqual(started);
    expect(workouts.get(started.id)).toEqual(started);
  });

  it("open() answers null when nothing is open", () => {
    expect(store().open()).toBeNull();
  });

  it("carries a routine reference and label", () => {
    const workouts = store();
    const started = workouts.start(
      { day: "2026-08-01", routineRef: "routine-1", routineLabel: "Push dan" },
      NOW,
    );
    expect(started.routineRef).toBe("routine-1");
    expect(started.routineLabel).toBe("Push dan");
  });

  it("refuses a second open session with a readable error", () => {
    const workouts = store();
    workouts.start(startInput("2026-08-01"), NOW);
    expect(() => workouts.start(startInput("2026-08-02"), LATER)).toThrow(FitWorkoutValidationError);
  });

  it("the UNIQUE partial index itself refuses a second open row, independent of the store", () => {
    const profileId = createProfile();
    const workouts = store(profileId);
    workouts.start(startInput("2026-08-01"), NOW);

    // Bypass the store entirely: the schema itself must be what makes this
    // impossible, not merely a JS-level check this store happens to run first.
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO fit_workouts
             (id, profile_id, workout_date, started_at, ended_at, routine_ref, routine_label, notes,
              created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, NULL, NULL, '', '', ?, ?, NULL)`,
        )
        .run(uuidv7(), profileId, "2026-08-02", LATER, LATER, LATER),
    ).toThrow(/UNIQUE/i);
  });

  it("throws for another profile's id", () => {
    const mine = store();
    const theirs = store();
    const started = mine.start(startInput("2026-08-01"), NOW);
    expect(() => theirs.get(started.id)).toThrow(FitWorkoutNotFoundError);
  });
});

describe("FitWorkoutStore.finish/reopen", () => {
  it("finishes an open session", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    const finished = workouts.finish(started.id, LATER);

    expect(finished.endedAt).toBe(LATER);
    expect(workouts.open()).toBeNull();
  });

  it("refuses finishing a session that is already finished", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    workouts.finish(started.id, LATER);
    expect(() => workouts.finish(started.id, EVEN_LATER)).toThrow(FitWorkoutValidationError);
  });

  it("reopens a finished session", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    workouts.finish(started.id, LATER);
    const reopened = workouts.reopen(started.id, EVEN_LATER);

    expect(reopened.endedAt).toBeNull();
    expect(workouts.open()?.id).toBe(started.id);
  });

  it("refuses reopening a session that is already open", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    expect(() => workouts.reopen(started.id, LATER)).toThrow(FitWorkoutValidationError);
  });

  it("refuses reopening while a DIFFERENT session is open, via the same schema index", () => {
    const workouts = store();
    const first = workouts.start(startInput("2026-08-01"), NOW);
    workouts.finish(first.id, LATER);
    workouts.start(startInput("2026-08-02"), EVEN_LATER);

    expect(() => workouts.reopen(first.id, "2026-08-01T11:00:00.000Z")).toThrow(
      FitWorkoutValidationError,
    );
  });
});

describe("FitWorkoutStore.updateWorkout/remove/restore", () => {
  it("corrects day and notes", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    const updated = workouts.updateWorkout(started.id, { day: "2026-07-31", notes: "back-dated" }, LATER);
    expect(updated.day).toBe("2026-07-31");
    expect(updated.notes).toBe("back-dated");
  });

  it("soft-deletes and restores, sets intact", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    workouts.logSet(started.id, BENCH_SET, NOW);
    workouts.finish(started.id, LATER);

    workouts.remove(started.id, EVEN_LATER);
    expect(() => workouts.get(started.id)).toThrow(FitWorkoutNotFoundError);

    workouts.restore(started.id, "2026-08-01T11:00:00.000Z");
    expect(workouts.get(started.id).sets).toHaveLength(1);
  });

  it("refuses restoring an OPEN soft-deleted workout while another is open", () => {
    const workouts = store();
    const first = workouts.start(startInput("2026-08-01"), NOW);
    workouts.remove(first.id, LATER);
    workouts.start(startInput("2026-08-02"), EVEN_LATER);

    expect(() => workouts.restore(first.id, "2026-08-01T11:00:00.000Z")).toThrow(
      FitWorkoutValidationError,
    );
  });

  it("throws removing an id that is not live", () => {
    expect(() => store().remove(uuidv7(), NOW)).toThrow(FitWorkoutNotFoundError);
  });
});

describe("FitWorkoutStore.listRange", () => {
  it("lists live workouts of one day, ordered by start time", () => {
    const workouts = store();
    const a = workouts.start(startInput("2026-08-01"), NOW);
    workouts.finish(a.id, LATER);
    const b = workouts.start(startInput("2026-08-01"), EVEN_LATER);
    workouts.finish(b.id, "2026-08-01T11:00:00.000Z");

    expect(workouts.listRange("2026-08-01", "2026-08-01").map((w) => w.id)).toEqual([a.id, b.id]);
  });

  it("lists an inclusive range, ascending by day", () => {
    const workouts = store();
    const a = workouts.start(startInput("2026-08-01"), NOW);
    workouts.finish(a.id, LATER);
    const b = workouts.start(startInput("2026-08-05"), EVEN_LATER);
    workouts.finish(b.id, "2026-08-05T11:00:00.000Z");

    const days = workouts.listRange("2026-08-01", "2026-08-05").map((w) => w.day);
    expect(days).toEqual(["2026-08-01", "2026-08-05"]);
  });

  it("refuses a range given backwards", () => {
    expect(() => store().listRange("2026-08-05", "2026-08-01")).toThrow(FitWorkoutValidationError);
  });
});

describe("FitWorkoutStore.logSet/updateSet/removeSet", () => {
  it("appends sets at the end, position 0-based", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    const first = workouts.logSet(started.id, BENCH_SET, NOW);
    const second = workouts.logSet(started.id, { ...BENCH_SET, weightKg: 82.5 }, LATER);

    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
    expect(workouts.get(started.id).sets.map((s) => s.id)).toEqual([first.id, second.id]);
  });

  it("snapshots metric and muscles at logging time", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    const set = workouts.logSet(started.id, BENCH_SET, NOW);
    expect(set.metric).toBe("weight_reps");
    expect(set.primaryMuscles).toEqual(["grudi"]);
  });

  it("refuses logging into a workout that does not exist in this profile", () => {
    const mine = store();
    const theirs = store();
    const started = mine.start(startInput("2026-08-01"), NOW);
    expect(() => theirs.logSet(started.id, BENCH_SET, NOW)).toThrow(FitWorkoutNotFoundError);
  });

  it("refuses an out-of-range rir", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    expect(() => workouts.logSet(started.id, { ...BENCH_SET, rir: 6 }, NOW)).toThrow(
      FitWorkoutValidationError,
    );
  });

  it("refuses a negative weight or a non-integer reps", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    expect(() => workouts.logSet(started.id, { ...BENCH_SET, weightKg: -1 }, NOW)).toThrow(
      FitWorkoutValidationError,
    );
    expect(() => workouts.logSet(started.id, { ...BENCH_SET, reps: 8.5 }, NOW)).toThrow(
      FitWorkoutValidationError,
    );
  });

  it("patches only the given set fields", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    const set = workouts.logSet(started.id, BENCH_SET, NOW);
    const updated = workouts.updateSet(set.id, { weightKg: 85, reps: 6 }, LATER);

    expect(updated.weightKg).toBe(85);
    expect(updated.reps).toBe(6);
    expect(updated.exerciseRef).toBe(BENCH_SET.exerciseRef);
    expect(updated.label).toBe(BENCH_SET.label);
  });

  it("throws updating a set id that is not this profile's", () => {
    expect(() => store().updateSet(uuidv7(), { reps: 5 }, NOW)).toThrow(FitSetNotFoundError);
  });

  it("hard-deletes a set and closes the position gap", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    const first = workouts.logSet(started.id, BENCH_SET, NOW);
    const second = workouts.logSet(started.id, BENCH_SET, NOW);
    const third = workouts.logSet(started.id, BENCH_SET, NOW);

    workouts.removeSet(second.id);

    const remaining = workouts.get(started.id).sets;
    expect(remaining.map((s) => s.id)).toEqual([first.id, third.id]);
    expect(remaining.map((s) => s.position)).toEqual([0, 1]);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM fit_workout_sets").get()).toEqual({ n: 2 });
  });

  it("throws removing a set that is not this profile's", () => {
    expect(() => store().removeSet(uuidv7())).toThrow(FitSetNotFoundError);
  });

  it("throws for a set whose owning workout was soft-deleted", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    const set = workouts.logSet(started.id, BENCH_SET, NOW);
    workouts.finish(started.id, LATER);
    workouts.remove(started.id, EVEN_LATER);

    expect(() => workouts.updateSet(set.id, { reps: 3 }, EVEN_LATER)).toThrow(FitSetNotFoundError);
  });
});

describe("FitWorkoutStore set corruption on read", () => {
  it("throws when a set's primary_muscles_json no longer parses to known muscles", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    const set = workouts.logSet(started.id, BENCH_SET, NOW);
    db.raw
      .prepare("UPDATE fit_workout_sets SET primary_muscles_json = ? WHERE id = ?")
      .run(JSON.stringify(["ne-postoji"]), set.id);

    expect(() => workouts.get(started.id)).toThrow(FitWorkoutValidationError);
  });
});

describe("FitWorkoutStore.lastPerformed", () => {
  it("answers [] for [] with no query run", () => {
    expect(store().lastPerformed([])).toEqual([]);
  });

  it("refuses more than 200 refs", () => {
    const refs = Array.from({ length: 201 }, (_, i) => `catalogue:x${i}`);
    expect(() => store().lastPerformed(refs)).toThrow(FitWorkoutValidationError);
  });

  it("is empty for a ref never logged", () => {
    expect(store().lastPerformed(["catalogue:never-done"])).toEqual([]);
  });

  it("answers the most recent FINISHED session's sets for the ref, across two sessions", () => {
    const workouts = store();
    const first = workouts.start(startInput("2026-08-01"), NOW);
    workouts.logSet(first.id, { ...BENCH_SET, weightKg: 70 }, NOW);
    workouts.finish(first.id, LATER);

    const second = workouts.start(startInput("2026-08-03"), EVEN_LATER);
    workouts.logSet(second.id, { ...BENCH_SET, weightKg: 75 }, EVEN_LATER);
    workouts.logSet(second.id, { ...BENCH_SET, weightKg: 77.5 }, EVEN_LATER);
    workouts.finish(second.id, "2026-08-03T11:00:00.000Z");

    const [result] = workouts.lastPerformed([BENCH_SET.exerciseRef]);
    expect(result?.day).toBe("2026-08-03");
    expect(result?.workoutId).toBe(second.id);
    expect(result?.sets).toHaveLength(2);
    expect(result?.sets.map((s) => s.weightKg)).toEqual([75, 77.5]);
  });

  it("does not count a currently open session as last time", () => {
    const workouts = store();
    const finished = workouts.start(startInput("2026-08-01"), NOW);
    workouts.logSet(finished.id, BENCH_SET, NOW);
    workouts.finish(finished.id, LATER);

    const open = workouts.start(startInput("2026-08-02"), EVEN_LATER);
    workouts.logSet(open.id, { ...BENCH_SET, weightKg: 999 }, EVEN_LATER);

    const [result] = workouts.lastPerformed([BENCH_SET.exerciseRef]);
    expect(result?.workoutId).toBe(finished.id);
  });

  it("ignores sets of a soft-deleted workout", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    workouts.logSet(started.id, BENCH_SET, NOW);
    workouts.finish(started.id, LATER);
    workouts.remove(started.id, EVEN_LATER);

    expect(workouts.lastPerformed([BENCH_SET.exerciseRef])).toEqual([]);
  });

  it("resolves every ref given in ONE call, deduplicated", () => {
    const workouts = store();
    const started = workouts.start(startInput("2026-08-01"), NOW);
    workouts.logSet(started.id, BENCH_SET, NOW);
    workouts.logSet(started.id, { ...BENCH_SET, exerciseRef: "catalogue:squat", primaryMuscles: ["kvadriceps"] }, NOW);
    workouts.finish(started.id, LATER);

    const results = workouts.lastPerformed([
      BENCH_SET.exerciseRef, "catalogue:squat", BENCH_SET.exerciseRef, "catalogue:never-done",
    ]);
    expect(results.map((r) => r.exerciseRef).sort()).toEqual(["catalogue:bench-press", "catalogue:squat"]);
  });

  it("never crosses profiles", () => {
    const mine = store();
    const theirs = store();
    const started = mine.start(startInput("2026-08-01"), NOW);
    mine.logSet(started.id, BENCH_SET, NOW);
    mine.finish(started.id, LATER);

    expect(theirs.lastPerformed([BENCH_SET.exerciseRef])).toEqual([]);
  });
});
