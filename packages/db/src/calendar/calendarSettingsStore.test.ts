import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CalendarSettingsStore,
  CalendarSettingsValidationError,
  NexusDatabase,
  openDatabase,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

const NOW = "2026-07-30T10:00:00.000Z";

function createProfile(name: string): string {
  const id = `profile-${name}`;
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", name, NOW);
  return id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-calendar-settings-"));
  db = openDatabase({ path: join(dir, "calendar.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("CalendarSettingsStore.get", () => {
  it("answers both-null — no term set — while no row exists", () => {
    const store = new CalendarSettingsStore(db.raw, createProfile("a"));
    expect(store.get()).toEqual({ semesterStart: null, semesterEnd: null });
  });

  it("never writes a row just by being read", () => {
    new CalendarSettingsStore(db.raw, createProfile("a")).get();
    const { n } = db.raw
      .prepare("SELECT count(*) AS n FROM calendar_settings")
      .get() as { n: number };
    expect(n).toBe(0);
  });
});

describe("CalendarSettingsStore.save", () => {
  it("creates the row on first write and returns the stored pair", () => {
    const store = new CalendarSettingsStore(db.raw, createProfile("a"));
    const settings = store.save({ semesterStart: "2026-10-01", semesterEnd: "2027-01-31" });
    expect(settings).toEqual({ semesterStart: "2026-10-01", semesterEnd: "2027-01-31" });
    expect(store.get()).toEqual(settings);
  });

  it("overwrites an existing pair in place — one row per profile, ever", () => {
    const store = new CalendarSettingsStore(db.raw, createProfile("a"));
    store.save({ semesterStart: "2026-10-01", semesterEnd: "2027-01-31" });
    store.save({ semesterStart: "2027-02-16", semesterEnd: "2027-06-15" });
    expect(store.get()).toEqual({ semesterStart: "2027-02-16", semesterEnd: "2027-06-15" });
    const { n } = db.raw
      .prepare("SELECT count(*) AS n FROM calendar_settings")
      .get() as { n: number };
    expect(n).toBe(1);
  });

  it("clears the term with a both-null save, keeping the row semantics identical to no row", () => {
    const store = new CalendarSettingsStore(db.raw, createProfile("a"));
    store.save({ semesterStart: "2026-10-01", semesterEnd: "2027-01-31" });
    expect(store.save({ semesterStart: null, semesterEnd: null })).toEqual({
      semesterStart: null,
      semesterEnd: null,
    });
    expect(store.get()).toEqual({ semesterStart: null, semesterEnd: null });
  });

  it("accepts a one-day term — equality is inside the closed range", () => {
    const store = new CalendarSettingsStore(db.raw, createProfile("a"));
    expect(() =>
      store.save({ semesterStart: "2026-10-01", semesterEnd: "2026-10-01" }),
    ).not.toThrow();
  });

  it("refuses a half-set pair — a term with one edge means nothing", () => {
    const store = new CalendarSettingsStore(db.raw, createProfile("a"));
    expect(() => store.save({ semesterStart: "2026-10-01", semesterEnd: null })).toThrow(
      CalendarSettingsValidationError,
    );
    expect(() => store.save({ semesterStart: null, semesterEnd: "2027-01-31" })).toThrow(
      CalendarSettingsValidationError,
    );
  });

  it("refuses a start after its end", () => {
    const store = new CalendarSettingsStore(db.raw, createProfile("a"));
    expect(() =>
      store.save({ semesterStart: "2027-02-01", semesterEnd: "2026-10-01" }),
    ).toThrow(CalendarSettingsValidationError);
  });

  it("refuses a value that is not a real calendar day, shaped or not", () => {
    const store = new CalendarSettingsStore(db.raw, createProfile("a"));
    expect(() =>
      store.save({ semesterStart: "2026-02-30", semesterEnd: "2026-06-01" }),
    ).toThrow(CalendarSettingsValidationError);
    expect(() =>
      store.save({ semesterStart: "oktobar", semesterEnd: "2027-01-31" }),
    ).toThrow(CalendarSettingsValidationError);
    expect(() =>
      store.save({ semesterStart: "2026-10-01", semesterEnd: "2026-13-01" }),
    ).toThrow(CalendarSettingsValidationError);
  });

  it("writes nothing when the pair is refused", () => {
    const store = new CalendarSettingsStore(db.raw, createProfile("a"));
    expect(() => store.save({ semesterStart: "2026-10-01", semesterEnd: null })).toThrow();
    expect(store.get()).toEqual({ semesterStart: null, semesterEnd: null });
  });

  it("scopes reads and writes to its own profile", () => {
    const storeA = new CalendarSettingsStore(db.raw, createProfile("a"));
    const storeB = new CalendarSettingsStore(db.raw, createProfile("b"));
    storeA.save({ semesterStart: "2026-10-01", semesterEnd: "2027-01-31" });
    expect(storeB.get()).toEqual({ semesterStart: null, semesterEnd: null });
  });
});
