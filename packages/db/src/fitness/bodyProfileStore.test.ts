import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FitBodyProfileStore,
  FitBodyProfileValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-08-01T08:00:00.000Z";
const LATER = "2026-08-02T09:00:00.000Z";

const VALID_PROFILE = {
  sex: "male" as const,
  birthDate: "1996-03-14",
  heightCm: 181,
  activity: "moderate" as const,
};

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-fit-body-profile-"));
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

function store(): FitBodyProfileStore {
  return new FitBodyProfileStore(db.raw, createProfile());
}

describe("FitBodyProfileStore.get", () => {
  it("answers null when no row exists — never a default-shaped guess", () => {
    expect(store().get()).toBeNull();
  });
});

describe("FitBodyProfileStore.save", () => {
  it("stores and returns a profile", () => {
    const profiles = store();
    const saved = profiles.save(VALID_PROFILE, NOW);
    expect(saved).toEqual({ ...VALID_PROFILE, createdAt: NOW, updatedAt: NOW });
    expect(profiles.get()).toEqual({ ...VALID_PROFILE, createdAt: NOW, updatedAt: NOW });
  });

  it("round-trips sex: null as null, never coerced to a value", () => {
    const profiles = store();
    profiles.save({ ...VALID_PROFILE, sex: null }, NOW);
    expect(profiles.get()).toEqual({ ...VALID_PROFILE, sex: null, createdAt: NOW, updatedAt: NOW });
  });

  it("upserts in place — a second save replaces the one row, keeping the original createdAt", () => {
    const profiles = store();
    profiles.save(VALID_PROFILE, NOW);
    const updated = profiles.save({ ...VALID_PROFILE, heightCm: 182 }, LATER);
    expect(updated.heightCm).toBe(182);
    expect(updated.createdAt).toBe(NOW);
    expect(updated.updatedAt).toBe(LATER);
    expect(profiles.get()).toEqual({
      ...VALID_PROFILE, heightCm: 182, createdAt: NOW, updatedAt: LATER,
    });
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM fit_body_profile").get()).toEqual({ n: 1 });
  });

  it("refuses an unknown sex", () => {
    const profiles = store();
    expect(() =>
      profiles.save({ ...VALID_PROFILE, sex: "other" as unknown as "male" }, NOW),
    ).toThrow(FitBodyProfileValidationError);
  });

  it("refuses a birth date in the future relative to `now`", () => {
    const profiles = store();
    expect(() => profiles.save({ ...VALID_PROFILE, birthDate: "2026-08-02" }, NOW)).toThrow(
      FitBodyProfileValidationError,
    );
  });

  it("refuses a birth date that is not a real calendar day", () => {
    const profiles = store();
    expect(() => profiles.save({ ...VALID_PROFILE, birthDate: "2026-02-30" }, NOW)).toThrow(
      FitBodyProfileValidationError,
    );
  });

  it("refuses a height outside the plausibility bounds", () => {
    const profiles = store();
    expect(() => profiles.save({ ...VALID_PROFILE, heightCm: 10 }, NOW)).toThrow(
      FitBodyProfileValidationError,
    );
    expect(() => profiles.save({ ...VALID_PROFILE, heightCm: 999 }, NOW)).toThrow(
      FitBodyProfileValidationError,
    );
  });

  it("refuses an unknown activity level", () => {
    const profiles = store();
    expect(() =>
      profiles.save({ ...VALID_PROFILE, activity: "extreme" as unknown as "moderate" }, NOW),
    ).toThrow(FitBodyProfileValidationError);
  });

  it("refuses a `now` that is not an ISO-8601 instant", () => {
    expect(() => store().save(VALID_PROFILE, "2026-08-01")).toThrow(FitBodyProfileValidationError);
  });

  it("never crosses profiles", () => {
    const mine = store();
    const theirs = new FitBodyProfileStore(db.raw, createProfile());
    mine.save(VALID_PROFILE, NOW);
    expect(theirs.get()).toBeNull();
  });
});
