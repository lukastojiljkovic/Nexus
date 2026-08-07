import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BodyMeasurement } from "@nexus/core";
import { NO_CIRCUMFERENCES } from "@nexus/core";
import {
  FitMeasurementStore,
  FitMeasurementValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-08-01T08:00:00.000Z";
const LATER = "2026-08-02T09:00:00.000Z";
const MUCH_LATER = "2026-08-05T09:00:00.000Z";

function measurement(day: string, overrides: Partial<BodyMeasurement> = {}): BodyMeasurement {
  return {
    day,
    weightKg: 82.4,
    bodyFatPercent: null,
    muscle: null,
    waterPercent: null,
    circumferences: NO_CIRCUMFERENCES,
    ...overrides,
  };
}

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-fit-measurements-"));
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

function store(): FitMeasurementStore {
  return new FitMeasurementStore(db.raw, createProfile());
}

describe("FitMeasurementStore.save/get", () => {
  it("stores and reads back a measurement", () => {
    const measurements = store();
    const saved = measurements.save(measurement("2026-08-01"), NOW);
    expect(saved).toEqual({
      day: "2026-08-01",
      weightKg: 82.4,
      bodyFatPercent: null,
      muscle: null,
      waterPercent: null,
      circumferences: NO_CIRCUMFERENCES,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(measurements.get("2026-08-01")).toEqual(saved);
  });

  it("round-trips a full reading — body fat, muscle, water, circumferences", () => {
    const measurements = store();
    const full = measurement("2026-08-01", {
      bodyFatPercent: 18.5,
      muscle: { unit: "kg", value: 35.2 },
      waterPercent: 55,
      circumferences: { neck: 40, chest: 105, upperArm: 36, waist: 88, hip: 100, thigh: 58 },
    });
    measurements.save(full, NOW);
    expect(measurements.get("2026-08-01")).toMatchObject({
      bodyFatPercent: 18.5,
      muscle: { unit: "kg", value: 35.2 },
      waterPercent: 55,
      circumferences: { neck: 40, chest: 105, upperArm: 36, waist: 88, hip: 100, thigh: 58 },
    });
  });

  it("upserts on (profile, day) — a second save the same day replaces it, not duplicates it", () => {
    const measurements = store();
    measurements.save(measurement("2026-08-01", { weightKg: 82 }), NOW);
    const updated = measurements.save(measurement("2026-08-01", { weightKg: 81.5 }), LATER);

    expect(updated.weightKg).toBe(81.5);
    expect(updated.createdAt).toBe(NOW);
    expect(updated.updatedAt).toBe(LATER);
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM fit_measurements").get()).toEqual({ n: 1 });
  });

  it("answers null for a day with no reading", () => {
    expect(store().get("2026-08-01")).toBeNull();
  });

  it("refuses a day in the future relative to `now`", () => {
    const measurements = store();
    expect(() => measurements.save(measurement("2026-08-02"), NOW)).toThrow(
      FitMeasurementValidationError,
    );
  });

  it("refuses a weight outside its bound", () => {
    const measurements = store();
    expect(() => measurements.save(measurement("2026-08-01", { weightKg: 0 }), NOW)).toThrow(
      FitMeasurementValidationError,
    );
    expect(() => measurements.save(measurement("2026-08-01", { weightKg: 501 }), NOW)).toThrow(
      FitMeasurementValidationError,
    );
  });

  it("refuses a muscle reading heavier than the same day's weight", () => {
    const measurements = store();
    expect(() =>
      measurements.save(
        measurement("2026-08-01", { weightKg: 80, muscle: { unit: "kg", value: 90 } }),
        NOW,
      ),
    ).toThrow(FitMeasurementValidationError);
  });

  it("refuses a `now` that is not an ISO-8601 instant", () => {
    expect(() => store().save(measurement("2026-08-01"), "2026-08-01")).toThrow(
      FitMeasurementValidationError,
    );
  });
});

describe("FitMeasurementStore.listRange", () => {
  it("answers every reading in an inclusive span, ascending by day", () => {
    const measurements = store();
    measurements.save(measurement("2026-08-03"), MUCH_LATER);
    measurements.save(measurement("2026-08-01"), MUCH_LATER);
    measurements.save(measurement("2026-08-05"), MUCH_LATER);

    const days = measurements.listRange("2026-08-01", "2026-08-03").map((m) => m.day);
    expect(days).toEqual(["2026-08-01", "2026-08-03"]);
  });

  it("refuses a range given backwards", () => {
    expect(() => store().listRange("2026-08-05", "2026-08-01")).toThrow(
      FitMeasurementValidationError,
    );
  });
});

describe("FitMeasurementStore.latest", () => {
  it("answers the most recent day's reading", () => {
    const measurements = store();
    measurements.save(measurement("2026-08-01"), MUCH_LATER);
    measurements.save(measurement("2026-08-05"), MUCH_LATER);
    measurements.save(measurement("2026-08-03"), MUCH_LATER);

    expect(measurements.latest()?.day).toBe("2026-08-05");
  });

  it("answers null when nothing was ever recorded", () => {
    expect(store().latest()).toBeNull();
  });
});

describe("FitMeasurementStore.remove", () => {
  it("hard-deletes a reading", () => {
    const measurements = store();
    measurements.save(measurement("2026-08-01"), NOW);
    measurements.remove("2026-08-01");

    expect(measurements.get("2026-08-01")).toBeNull();
    expect(db.raw.prepare("SELECT COUNT(*) AS n FROM fit_measurements").get()).toEqual({ n: 0 });
  });

  it("is a silent no-op for a day with nothing recorded", () => {
    expect(() => store().remove("2026-08-01")).not.toThrow();
  });
});

describe("FitMeasurementStore profile scoping", () => {
  it("never crosses profiles", () => {
    const mine = store();
    const theirs = new FitMeasurementStore(db.raw, createProfile());
    mine.save(measurement("2026-08-01"), NOW);
    expect(theirs.get("2026-08-01")).toBeNull();
    expect(theirs.listRange("2026-01-01", "2026-12-31")).toEqual([]);
  });
});
