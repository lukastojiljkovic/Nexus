import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FitTargetStore,
  FitTargetValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-08-01T08:00:00.000Z";
const LATER = "2026-08-02T09:00:00.000Z";

const NOTHING_SET = {
  kcal: null,
  proteinG: null,
  carbsG: null,
  fatG: null,
} as const;

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-fit-targets-"));
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

function store(): FitTargetStore {
  return new FitTargetStore(db.raw, createProfile());
}

describe("FitTargetStore.get", () => {
  it("answers four nulls and a null updatedAt when nothing was ever set, without writing", () => {
    const targets = store();
    expect(targets.get()).toEqual({ ...NOTHING_SET, updatedAt: null });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM fit_targets").get()).toEqual({ n: 0 });
  });
});

describe("FitTargetStore.save", () => {
  it("stores a calorie-only goal, leaving the other three unset", () => {
    const targets = store();
    const saved = targets.save({ ...NOTHING_SET, kcal: 2200 }, NOW);

    expect(saved).toEqual({ kcal: 2200, proteinG: null, carbsG: null, fatG: null, updatedAt: NOW });
    expect(targets.get()).toEqual(saved);
  });

  it("stores all four", () => {
    const targets = store();
    targets.save({ kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 }, NOW);
    expect(targets.get()).toEqual({
      kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70, updatedAt: NOW,
    });
  });

  it("keeps ZERO and NULL apart — they are different claims", () => {
    const targets = store();
    targets.save({ ...NOTHING_SET, kcal: 0 }, NOW);
    // A goal of zero is a goal. Coercing it to „no goal" would be the store
    // deciding the user did not mean what they typed.
    expect(targets.get().kcal).toBe(0);

    targets.save({ ...NOTHING_SET, kcal: null }, LATER);
    expect(targets.get().kcal).toBeNull();
  });

  it("upserts in place rather than accumulating rows", () => {
    const targets = store();
    targets.save({ ...NOTHING_SET, kcal: 2200 }, NOW);
    targets.save({ ...NOTHING_SET, kcal: 1800 }, LATER);

    expect(targets.get()).toEqual({ ...NOTHING_SET, kcal: 1800, updatedAt: LATER });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM fit_targets").get()).toEqual({ n: 1 });
  });

  it("clearing every goal LEAVES the row, so `updatedAt` still tells decided from never-looked", () => {
    const targets = store();
    targets.save({ kcal: 2200, proteinG: 160, carbsG: 220, fatG: 70 }, NOW);
    const cleared = targets.save(NOTHING_SET, LATER);

    expect(cleared).toEqual({ ...NOTHING_SET, updatedAt: LATER });
    expect(targets.get().updatedAt).toBe(LATER);
  });

  it("refuses a negative, non-finite or absurd goal", () => {
    const targets = store();
    for (const kcal of [-1, Number.NaN, Number.POSITIVE_INFINITY, 100_001]) {
      expect(() => targets.save({ ...NOTHING_SET, kcal }, NOW)).toThrow(FitTargetValidationError);
    }
    expect(() => targets.save({ ...NOTHING_SET, proteinG: -0.5 }, NOW)).toThrow(
      FitTargetValidationError,
    );
  });

  it("refuses a `now` that is not an ISO-8601 instant", () => {
    expect(() => store().save({ ...NOTHING_SET, kcal: 2200 }, "2026-08-01")).toThrow(
      FitTargetValidationError,
    );
  });

  it("never crosses profiles", () => {
    const mine = store();
    const theirs = new FitTargetStore(db.raw, createProfile());
    mine.save({ ...NOTHING_SET, kcal: 2200 }, NOW);
    expect(theirs.get()).toEqual({ ...NOTHING_SET, updatedAt: null });
  });
});
