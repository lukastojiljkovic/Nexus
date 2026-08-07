import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FitRoutineNotFoundError,
  FitRoutineStore,
  FitRoutineValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";
import type { CreateFitRoutineInput } from "../index.js";

const NOW = "2026-08-01T08:00:00.000Z";
const LATER = "2026-08-02T09:00:00.000Z";

const PUSH_DAY: CreateFitRoutineInput = {
  name: "Push dan",
  notes: "",
  items: [
    { exerciseRef: "catalogue:bench-press", label: "Potisak sa klupe", targetSets: 4, targetRepsMin: 6, targetRepsMax: 10 },
    { exerciseRef: "user:abc123", label: "Moja varijanta razvlačenja" },
  ],
};

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-fit-routines-"));
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

function store(): FitRoutineStore {
  return new FitRoutineStore(db.raw, createProfile());
}

describe("FitRoutineStore.create/get", () => {
  it("inserts a routine with its items in stored position order", () => {
    const routines = store();
    const created = routines.create(PUSH_DAY, NOW);

    expect(created.name).toBe("Push dan");
    expect(created.items).toHaveLength(2);
    expect(created.items[0]).toMatchObject({
      exerciseRef: "catalogue:bench-press",
      label: "Potisak sa klupe",
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 10,
    });
    expect(created.items[1]).toMatchObject({ exerciseRef: "user:abc123", targetSets: null });
    expect(routines.get(created.id)).toEqual(created);
  });

  it("accepts an empty items list", () => {
    const routines = store();
    const created = routines.create({ name: "Prazan", items: [] }, NOW);
    expect(created.items).toEqual([]);
  });

  it("defaults notes when omitted", () => {
    const routines = store();
    const created = routines.create({ name: "X", items: [] }, NOW);
    expect(created.notes).toBe("");
  });

  it("writes the routine and its items in one transaction — nothing is left half-written", () => {
    const routines = store();
    expect(() =>
      routines.create({ name: "Loš", items: [{ exerciseRef: "user:x", label: "" }] }, NOW),
    ).toThrow(FitRoutineValidationError);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM fit_routines").get()).toEqual({ n: 0 });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM fit_routine_items").get()).toEqual({ n: 0 });
  });

  it("throws for another profile's id", () => {
    const mine = store();
    const theirs = new FitRoutineStore(db.raw, createProfile());
    const created = mine.create(PUSH_DAY, NOW);
    expect(() => theirs.get(created.id)).toThrow(FitRoutineNotFoundError);
  });
});

describe("FitRoutineStore validation", () => {
  it("refuses an empty name", () => {
    expect(() => store().create({ name: "  ", items: [] }, NOW)).toThrow(FitRoutineValidationError);
  });

  it("refuses more than 60 items", () => {
    const items = Array.from({ length: 61 }, (_, i) => ({
      exerciseRef: "catalogue:x", label: `Vežba ${i}`,
    }));
    expect(() => store().create({ name: "Ogroman", items }, NOW)).toThrow(FitRoutineValidationError);
  });

  it("refuses a malformed exerciseRef", () => {
    expect(() =>
      store().create({ name: "X", items: [{ exerciseRef: "bench-press", label: "L" }] }, NOW),
    ).toThrow(FitRoutineValidationError);
  });

  it("refuses an empty item label", () => {
    expect(() =>
      store().create({ name: "X", items: [{ exerciseRef: "user:1", label: "  " }] }, NOW),
    ).toThrow(FitRoutineValidationError);
  });

  it("refuses a rep range that runs backwards, with a clear message — not left to the schema CHECK", () => {
    expect(() =>
      store().create(
        {
          name: "X",
          items: [
            { exerciseRef: "user:1", label: "L", targetRepsMin: 10, targetRepsMax: 5 },
          ],
        },
        NOW,
      ),
    ).toThrow(FitRoutineValidationError);
  });

  it("refuses a non-positive target", () => {
    expect(() =>
      store().create(
        { name: "X", items: [{ exerciseRef: "user:1", label: "L", targetSets: 0 }] },
        NOW,
      ),
    ).toThrow(FitRoutineValidationError);
  });
});

/**
 * Migration 061 — the targets a rep range cannot express. Before it, a routine
 * could prescribe sets and reps and nothing else, which left three of the seven
 * exercise metrics (`time`, `weight_time`, `distance_time`) unable to state the
 * only number they have: a plank could be told „3×12 reps" and could not be told
 * how long to hold.
 */
describe("FitRoutineStore — the non-rep targets", () => {
  const withTargets: CreateFitRoutineInput = {
    name: "Core",
    items: [
      {
        exerciseRef: "catalogue:plank",
        label: "Plank",
        targetSets: 3,
        targetSeconds: 45.5,
        restSeconds: 60,
      },
      {
        exerciseRef: "catalogue:farmers-walk",
        label: "Farmer's walk",
        targetDistanceM: 40,
        targetWeightKg: 32,
        restSeconds: 0,
      },
    ],
  };

  it("round-trips all four through a write and a read", () => {
    const routines = store();
    const created = routines.create(withTargets, NOW);
    const read = routines.get(created.id);
    expect(read?.items[0]).toMatchObject({
      targetSets: 3,
      targetSeconds: 45.5,
      restSeconds: 60,
      targetWeightKg: null,
      targetDistanceM: null,
    });
    expect(read?.items[1]).toMatchObject({
      targetDistanceM: 40,
      targetWeightKg: 32,
      restSeconds: 0,
      targetSeconds: null,
    });
  });

  it("keeps a rest of zero distinct from an unstated one", () => {
    // Zero is „straight into the next set" — a superset. `null` is „this
    // routine has no opinion, use the session default". Collapsing the two
    // would silently turn every superset into a normal rest.
    const routines = store();
    const created = routines.create(
      {
        name: "Superset",
        items: [
          { exerciseRef: "user:a", label: "A", restSeconds: 0 },
          { exerciseRef: "user:b", label: "B" },
        ],
      },
      NOW,
    );
    const read = routines.get(created.id);
    expect(read?.items[0]?.restSeconds).toBe(0);
    expect(read?.items[1]?.restSeconds).toBeNull();
  });

  it("accepts a bodyweight target of zero added kilograms", () => {
    const routines = store();
    const created = routines.create(
      { name: "BW", items: [{ exerciseRef: "user:a", label: "A", targetWeightKg: 0 }] },
      NOW,
    );
    expect(routines.get(created.id)?.items[0]?.targetWeightKg).toBe(0);
  });

  it("refuses a hold of zero seconds, which is not a prescription", () => {
    expect(() =>
      store().create(
        { name: "X", items: [{ exerciseRef: "user:1", label: "L", targetSeconds: 0 }] },
        NOW,
      ),
    ).toThrow(FitRoutineValidationError);
  });

  it("refuses a rest beyond what the rest timer will actually run", () => {
    // 600 is MAX_FIT_REST_SECONDS. A routine allowed to store more could
    // prescribe a rest the app then refuses, and the refusal would land a full
    // session later, on the set where it mattered.
    expect(() =>
      store().create(
        { name: "X", items: [{ exerciseRef: "user:1", label: "L", restSeconds: 601 }] },
        NOW,
      ),
    ).toThrow(FitRoutineValidationError);
    expect(() =>
      store().create(
        { name: "X", items: [{ exerciseRef: "user:1", label: "L", restSeconds: 90.5 }] },
        NOW,
      ),
    ).toThrow(FitRoutineValidationError);
  });

  it("normalises a target to two decimals, so the form can always type it back", () => {
    // The editor's numeric fields parse at most two fraction digits. Nothing
    // the form writes exceeds that — but an ARCHIVE IMPORT can, and a routine
    // carrying 45.567 would open for editing and then refuse to save, blocking
    // a save the user made for an entirely unrelated reason.
    const routines = store();
    const created = routines.create(
      {
        name: "Import",
        items: [
          {
            exerciseRef: "user:a",
            label: "A",
            targetSeconds: 45.567,
            targetWeightKg: 32.499,
            targetDistanceM: 40.001,
          },
        ],
      },
      NOW,
    );
    expect(routines.get(created.id)?.items[0]).toMatchObject({
      targetSeconds: 45.57,
      targetWeightKg: 32.5,
      targetDistanceM: 40,
    });
  });

  it("refuses a target that is positive only before rounding", () => {
    // 0.001 rounds to 0, which the column's own CHECK would reject as a raw
    // SQL error naming no field. It has to fail as a validation error instead.
    expect(() =>
      store().create(
        { name: "X", items: [{ exerciseRef: "user:1", label: "L", targetSeconds: 0.001 }] },
        NOW,
      ),
    ).toThrow(FitRoutineValidationError);
  });

  it("refuses NaN and Infinity, which SQLite would take without complaint", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        store().create(
          { name: "X", items: [{ exerciseRef: "user:1", label: "L", targetSeconds: value }] },
          NOW,
        ),
      ).toThrow(FitRoutineValidationError);
    }
  });

  it("clears a target when an update omits it, because items are replaced wholesale", () => {
    const routines = store();
    const created = routines.create(withTargets, NOW);
    routines.update(
      created.id,
      { items: [{ exerciseRef: "catalogue:plank", label: "Plank" }] },
      LATER,
    );
    expect(routines.get(created.id)?.items[0]).toMatchObject({
      targetSeconds: null,
      restSeconds: null,
    });
  });
});

describe("FitRoutineStore.update", () => {
  it("patches name/notes without touching items when items is omitted", () => {
    const routines = store();
    const created = routines.create(PUSH_DAY, NOW);
    const updated = routines.update(created.id, { notes: "sutra ponoviti" }, LATER);

    expect(updated.notes).toBe("sutra ponoviti");
    expect(updated.items).toEqual(created.items);
  });

  it("replaces items wholesale when given, renumbering positions from the new array order", () => {
    const routines = store();
    const created = routines.create(PUSH_DAY, NOW);
    const updated = routines.update(
      created.id,
      { items: [{ exerciseRef: "catalogue:overhead-press", label: "Potisak iznad glave" }] },
      LATER,
    );

    expect(updated.items).toHaveLength(1);
    expect(updated.items[0]).toMatchObject({ exerciseRef: "catalogue:overhead-press" });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM fit_routine_items").get()).toEqual({ n: 1 });
  });

  it("throws for another profile's id", () => {
    const mine = store();
    const theirs = new FitRoutineStore(db.raw, createProfile());
    const created = mine.create(PUSH_DAY, NOW);
    expect(() => theirs.update(created.id, { notes: "x" }, NOW)).toThrow(FitRoutineNotFoundError);
  });
});

describe("FitRoutineStore.list", () => {
  it("lists live routines, sr-Latn alphabetical", () => {
    const routines = store();
    routines.create({ name: "Zadnji dan", items: [] }, NOW);
    routines.create({ name: "Čučanj dan", items: [] }, NOW);
    expect(routines.list().map((r) => r.name)).toEqual(["Čučanj dan", "Zadnji dan"]);
  });

  it("excludes soft-deleted routines", () => {
    const routines = store();
    const created = routines.create(PUSH_DAY, NOW);
    routines.remove(created.id, NOW);
    expect(routines.list()).toEqual([]);
  });
});

describe("FitRoutineStore.remove/restore", () => {
  it("soft-deletes and restores, items intact", () => {
    const routines = store();
    const created = routines.create(PUSH_DAY, NOW);

    routines.remove(created.id, NOW);
    expect(() => routines.get(created.id)).toThrow(FitRoutineNotFoundError);

    routines.restore(created.id, LATER);
    expect(routines.get(created.id).items).toHaveLength(2);
  });

  it("throws removing an id that is not live", () => {
    expect(() => store().remove(uuidv7(), NOW)).toThrow(FitRoutineNotFoundError);
  });

  it("throws restoring an id that is not deleted", () => {
    const routines = store();
    const created = routines.create(PUSH_DAY, NOW);
    expect(() => routines.restore(created.id, NOW)).toThrow(FitRoutineNotFoundError);
  });
});
