import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_NEW_PER_DAY,
  DEFAULT_TARGET_RETENTION,
  MAX_NEW_PER_DAY,
  MAX_REVIEWS_PER_DAY,
  MAX_TARGET_RETENTION,
  MIN_TARGET_RETENTION,
  NexusDatabase,
  openDatabase,
  StudySettingsStore,
  StudySettingsValidationError,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

const NOW = "2026-07-30T10:00:00.000Z";
const LATER = "2026-07-30T11:00:00.000Z";

function createProfile(name: string): string {
  const id = `profile-${name}`;
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, NOW);
  return id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-study-settings-"));
  db = openDatabase({ path: join(dir, "study-settings.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("StudySettingsStore.get", () => {
  it("answers with the defaults — retention 0.9, 20 new a day, no review cap — while no row exists", () => {
    const store = new StudySettingsStore(db.raw, createProfile("a"));
    expect(store.get()).toEqual({
      targetRetention: DEFAULT_TARGET_RETENTION,
      newPerDay: DEFAULT_NEW_PER_DAY,
      maxReviewsPerDay: null,
    });
  });

  it("never writes a row just by being read", () => {
    new StudySettingsStore(db.raw, createProfile("a")).get();
    const { n } = db.raw
      .prepare("SELECT count(*) AS n FROM study_settings")
      .get() as { n: number };
    expect(n).toBe(0);
  });
});

describe("StudySettingsStore.save", () => {
  it("materializes the row on first write and returns the resolved settings", () => {
    const store = new StudySettingsStore(db.raw, createProfile("a"));
    const saved = store.save({ targetRetention: 0.85, newPerDay: 5, maxReviewsPerDay: 40 }, NOW);
    expect(saved).toEqual({ targetRetention: 0.85, newPerDay: 5, maxReviewsPerDay: 40 });
    expect(store.get()).toEqual(saved);
  });

  it("updates the existing row rather than adding a second one", () => {
    const store = new StudySettingsStore(db.raw, createProfile("a"));
    store.save({ targetRetention: 0.8, newPerDay: 1, maxReviewsPerDay: null }, NOW);
    store.save({ targetRetention: 0.95, newPerDay: 30, maxReviewsPerDay: 200 }, LATER);

    expect(store.get()).toEqual({
      targetRetention: 0.95,
      newPerDay: 30,
      maxReviewsPerDay: 200,
    });
    const { n } = db.raw
      .prepare("SELECT count(*) AS n FROM study_settings")
      .get() as { n: number };
    expect(n).toBe(1);
  });

  it("keeps created_at from the first write while updated_at moves", () => {
    const store = new StudySettingsStore(db.raw, createProfile("a"));
    store.save({ targetRetention: 0.9, newPerDay: 20, maxReviewsPerDay: null }, NOW);
    store.save({ targetRetention: 0.9, newPerDay: 21, maxReviewsPerDay: null }, LATER);

    const row = db.raw
      .prepare("SELECT created_at, updated_at FROM study_settings WHERE profile_id = ?")
      .get("profile-a") as { created_at: string; updated_at: string };
    expect(row.created_at).toBe(NOW);
    expect(row.updated_at).toBe(LATER);
  });

  it("accepts both ends of the retention window", () => {
    const store = new StudySettingsStore(db.raw, createProfile("a"));
    expect(
      store.save(
        { targetRetention: MIN_TARGET_RETENTION, newPerDay: 20, maxReviewsPerDay: null },
        NOW,
      ).targetRetention,
    ).toBe(MIN_TARGET_RETENTION);
    expect(
      store.save(
        { targetRetention: MAX_TARGET_RETENTION, newPerDay: 20, maxReviewsPerDay: null },
        NOW,
      ).targetRetention,
    ).toBe(MAX_TARGET_RETENTION);
  });

  it("refuses a retention outside the window, or one that is not a finite number", () => {
    const store = new StudySettingsStore(db.raw, createProfile("a"));
    const save = (targetRetention: number) =>
      store.save({ targetRetention, newPerDay: 20, maxReviewsPerDay: null }, NOW);
    expect(() => save(MIN_TARGET_RETENTION - 0.01)).toThrow(StudySettingsValidationError);
    expect(() => save(MAX_TARGET_RETENTION + 0.01)).toThrow(StudySettingsValidationError);
    expect(() => save(Number.NaN)).toThrow(StudySettingsValidationError);
    expect(() => save(Number.POSITIVE_INFINITY)).toThrow(StudySettingsValidationError);
  });

  it("accepts both ends of the new-cards range, zero included", () => {
    const store = new StudySettingsStore(db.raw, createProfile("a"));
    const save = (newPerDay: number) =>
      store.save({ targetRetention: 0.9, newPerDay, maxReviewsPerDay: null }, NOW);
    expect(save(0).newPerDay).toBe(0);
    expect(save(MAX_NEW_PER_DAY).newPerDay).toBe(MAX_NEW_PER_DAY);
  });

  it("refuses a new-cards value outside the range, or one that is not a whole number", () => {
    const store = new StudySettingsStore(db.raw, createProfile("a"));
    const save = (newPerDay: number) =>
      store.save({ targetRetention: 0.9, newPerDay, maxReviewsPerDay: null }, NOW);
    expect(() => save(-1)).toThrow(StudySettingsValidationError);
    expect(() => save(MAX_NEW_PER_DAY + 1)).toThrow(StudySettingsValidationError);
    expect(() => save(2.5)).toThrow(StudySettingsValidationError);
  });

  it("takes null as 'uncapped' and refuses zero, which is a cap of nothing", () => {
    const store = new StudySettingsStore(db.raw, createProfile("a"));
    const save = (maxReviewsPerDay: number | null) =>
      store.save({ targetRetention: 0.9, newPerDay: 20, maxReviewsPerDay }, NOW);
    expect(save(null).maxReviewsPerDay).toBeNull();
    expect(save(1).maxReviewsPerDay).toBe(1);
    expect(save(MAX_REVIEWS_PER_DAY).maxReviewsPerDay).toBe(MAX_REVIEWS_PER_DAY);
    expect(() => save(0)).toThrow(StudySettingsValidationError);
    expect(() => save(MAX_REVIEWS_PER_DAY + 1)).toThrow(StudySettingsValidationError);
    expect(() => save(10.5)).toThrow(StudySettingsValidationError);
  });

  it("refuses a malformed timestamp", () => {
    const store = new StudySettingsStore(db.raw, createProfile("a"));
    expect(() =>
      store.save({ targetRetention: 0.9, newPerDay: 20, maxReviewsPerDay: null }, "juče"),
    ).toThrow(StudySettingsValidationError);
  });

  it("writes nothing at all when a field is refused", () => {
    const store = new StudySettingsStore(db.raw, createProfile("a"));
    expect(() =>
      store.save({ targetRetention: 0.9, newPerDay: 200, maxReviewsPerDay: null }, NOW),
    ).toThrow(StudySettingsValidationError);
    const { n } = db.raw
      .prepare("SELECT count(*) AS n FROM study_settings")
      .get() as { n: number };
    expect(n).toBe(0);
  });
});

describe("StudySettingsStore — profile scoping", () => {
  it("keeps one profile's preferences invisible to another's store", () => {
    const first = new StudySettingsStore(db.raw, createProfile("a"));
    const second = new StudySettingsStore(db.raw, createProfile("b"));

    first.save({ targetRetention: 0.8, newPerDay: 3, maxReviewsPerDay: 10 }, NOW);
    expect(second.get()).toEqual({
      targetRetention: DEFAULT_TARGET_RETENTION,
      newPerDay: DEFAULT_NEW_PER_DAY,
      maxReviewsPerDay: null,
    });
  });
});
