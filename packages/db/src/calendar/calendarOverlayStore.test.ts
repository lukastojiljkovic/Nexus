import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CalendarOverlayStore,
  CalendarOverlayValidationError,
  EventStore,
  MAX_OVERLAY_RANGE_DAYS,
  NexusDatabase,
  openDatabase,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

const NOW = "2026-07-30T10:00:00.000Z";

function createProfile(name: string, kind: "personal" | "business" = "personal"): string {
  const id = `profile-${name}`;
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, kind, name, NOW);
  return id;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-calendar-overlay-"));
  db = openDatabase({ path: join(dir, "overlay.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The store under test: `viewer` looking at `foreign`'s events. */
function overlay(viewer: string, foreign: string): CalendarOverlayStore {
  return new CalendarOverlayStore(db.raw, viewer, foreign);
}

describe("CalendarOverlayStore construction", () => {
  it("refuses viewer === foreign — an overlay of yourself is a caller bug, not a query", () => {
    const viewer = createProfile("a");
    expect(() => overlay(viewer, viewer)).toThrow(CalendarOverlayValidationError);
  });

  it("refuses an empty profile id on either side", () => {
    const viewer = createProfile("a");
    expect(() => overlay(viewer, "")).toThrow(CalendarOverlayValidationError);
    expect(() => overlay("", viewer)).toThrow(CalendarOverlayValidationError);
  });
});

describe("CalendarOverlayStore.listRange input validation", () => {
  it("refuses a malformed or impossible day key on either bound", () => {
    const store = overlay(createProfile("a"), createProfile("b", "business"));
    expect(() => store.listRange("2026-7-01", "2026-07-31")).toThrow(
      CalendarOverlayValidationError,
    );
    expect(() => store.listRange("2026-07-01", "2026-02-30")).toThrow(
      CalendarOverlayValidationError,
    );
  });

  it("refuses a reversed range", () => {
    const store = overlay(createProfile("a"), createProfile("b", "business"));
    expect(() => store.listRange("2026-08-01", "2026-07-01")).toThrow(
      CalendarOverlayValidationError,
    );
  });

  it(`refuses a span wider than ${MAX_OVERLAY_RANGE_DAYS} days — the DoS bound on expansion`, () => {
    const store = overlay(createProfile("a"), createProfile("b", "business"));
    expect(() => store.listRange("2026-01-01", "2028-01-01")).toThrow(
      CalendarOverlayValidationError,
    );
    // The widest allowed span still answers.
    expect(store.listRange("2026-01-01", "2027-02-05")).toEqual([]);
  });
});

describe("CalendarOverlayStore two-profile isolation", () => {
  it("returns ONLY the foreign profile's events — never the viewer's, never a third profile's", () => {
    const viewer = createProfile("viewer");
    const foreign = createProfile("foreign", "business");
    const third = createProfile("third", "business");
    new EventStore(db.raw, viewer).create({ title: "Mine", startAt: "2026-07-10T09:00" });
    new EventStore(db.raw, third).create({ title: "Third", startAt: "2026-07-10T10:00" });
    const theirs = new EventStore(db.raw, foreign).create({
      title: "Theirs",
      startAt: "2026-07-10T11:00",
    });

    const rows = overlay(viewer, foreign).listRange("2026-07-01", "2026-07-31");
    expect(rows.map((row) => row.id)).toEqual([theirs.id]);
  });

  it("excludes the foreign profile's soft-deleted events", () => {
    const viewer = createProfile("viewer");
    const foreign = createProfile("foreign", "business");
    const store = new EventStore(db.raw, foreign);
    const gone = store.create({ title: "Gone", startAt: "2026-07-10T09:00" });
    store.softDelete(gone.id);

    expect(overlay(viewer, foreign).listRange("2026-07-01", "2026-07-31")).toEqual([]);
  });
});

describe("CalendarOverlayStore minimization", () => {
  it("carries EXACTLY { id, title, startAt, endAt, allDay, foreign } — no description, location or category, however rich the row", () => {
    const viewer = createProfile("viewer");
    const foreign = createProfile("foreign", "business");
    const theirs = new EventStore(db.raw, foreign).create({
      title: "Sastanak",
      startAt: "2026-07-10T09:00",
      endAt: "2026-07-10T10:30",
      description: "poverljivo",
      location: "kancelarija",
      category: "posao",
    });

    const rows = overlay(viewer, foreign).listRange("2026-07-01", "2026-07-31");
    expect(rows).toEqual([
      {
        id: theirs.id,
        title: "Sastanak",
        startAt: "2026-07-10T09:00",
        endAt: "2026-07-10T10:30",
        allDay: false,
        foreign: true,
      },
    ]);
    // The key SET is pinned, not just the values: a later column must never
    // ride along unnoticed across the trust boundary.
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "allDay",
      "endAt",
      "foreign",
      "id",
      "startAt",
      "title",
    ]);
  });

  it("decodes the all-day flag", () => {
    const viewer = createProfile("viewer");
    const foreign = createProfile("foreign", "business");
    new EventStore(db.raw, foreign).create({
      title: "Slava",
      startAt: "2026-07-12",
      allDay: true,
    });

    const [row] = overlay(viewer, foreign).listRange("2026-07-01", "2026-07-31");
    expect(row).toMatchObject({ allDay: true, startAt: "2026-07-12", endAt: null });
  });
});

describe("CalendarOverlayStore range behaviour", () => {
  it("keeps one-offs inside the range and drops those entirely before or after it", () => {
    const viewer = createProfile("viewer");
    const foreign = createProfile("foreign", "business");
    const store = new EventStore(db.raw, foreign);
    store.create({ title: "Before", startAt: "2026-06-30T09:00" });
    const inside = store.create({ title: "Inside", startAt: "2026-07-15T09:00" });
    store.create({ title: "After", startAt: "2026-08-01T09:00" });

    const rows = overlay(viewer, foreign).listRange("2026-07-01", "2026-07-31");
    expect(rows.map((row) => row.title)).toEqual([inside.title]);
  });

  it("keeps a multi-day event that starts before the range but spans into it", () => {
    const viewer = createProfile("viewer");
    const foreign = createProfile("foreign", "business");
    new EventStore(db.raw, foreign).create({
      title: "Odmor",
      startAt: "2026-06-28",
      endAt: "2026-07-03",
      allDay: true,
    });

    const rows = overlay(viewer, foreign).listRange("2026-07-01", "2026-07-31");
    expect(rows.map((row) => row.title)).toEqual(["Odmor"]);
  });

  it("orders rows by start then id — deterministic however they were written", () => {
    const viewer = createProfile("viewer");
    const foreign = createProfile("foreign", "business");
    const store = new EventStore(db.raw, foreign);
    store.create({ title: "Later", startAt: "2026-07-20T09:00" });
    store.create({ title: "Earlier", startAt: "2026-07-05T09:00" });

    const rows = overlay(viewer, foreign).listRange("2026-07-01", "2026-07-31");
    expect(rows.map((row) => row.title)).toEqual(["Earlier", "Later"]);
  });
});

describe("CalendarOverlayStore recurrence expansion", () => {
  it("expands a series into one concrete row per occurrence in the range, day-shifted with its time preserved", () => {
    const viewer = createProfile("viewer");
    const foreign = createProfile("foreign", "business");
    const master = new EventStore(db.raw, foreign).create({
      title: "Nedeljni sastanak",
      startAt: "2026-07-06T09:00",
      endAt: "2026-07-06T10:00",
      recurrence: { freq: { kind: "weekly", interval: 1, days: [0] }, end: { kind: "never" } },
    });

    const rows = overlay(viewer, foreign).listRange("2026-07-06", "2026-07-26");
    expect(rows.map((row) => row.startAt)).toEqual([
      "2026-07-06T09:00",
      "2026-07-13T09:00",
      "2026-07-20T09:00",
    ]);
    expect(rows.map((row) => row.endAt)).toEqual([
      "2026-07-06T10:00",
      "2026-07-13T10:00",
      "2026-07-20T10:00",
    ]);
    // Occurrences of one master share its row id — the day tells them apart,
    // exactly as the viewer's own calendar reads a series.
    expect(new Set(rows.map((row) => row.id))).toEqual(new Set([master.id]));
  });

  it("honours the series' exception dates", () => {
    const viewer = createProfile("viewer");
    const foreign = createProfile("foreign", "business");
    const store = new EventStore(db.raw, foreign);
    const master = store.create({
      title: "Dnevni",
      startAt: "2026-07-06T08:00",
      recurrence: { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } },
    });
    store.addRecurrenceExdate(master.id, "2026-07-07", NOW);

    const rows = overlay(viewer, foreign).listRange("2026-07-06", "2026-07-08");
    expect(rows.map((row) => row.startAt)).toEqual(["2026-07-06T08:00", "2026-07-08T08:00"]);
  });

  it("expands a master anchored before the range into the range's own occurrences only", () => {
    const viewer = createProfile("viewer");
    const foreign = createProfile("foreign", "business");
    new EventStore(db.raw, foreign).create({
      title: "Stari niz",
      startAt: "2026-01-05T18:00",
      recurrence: { freq: { kind: "weekly", interval: 1, days: [0] }, end: { kind: "never" } },
    });

    const rows = overlay(viewer, foreign).listRange("2026-07-06", "2026-07-12");
    expect(rows.map((row) => row.startAt)).toEqual(["2026-07-06T18:00"]);
  });
});
