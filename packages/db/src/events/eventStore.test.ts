import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EventNotFoundError,
  EventStore,
  EventValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-events-"));
  db = openDatabase({ path: join(dir, "events.db") });
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date().toISOString());
  return id;
}

function store(): EventStore {
  return new EventStore(db.raw, createProfile());
}

describe("EventStore", () => {
  it("creates an event, applies defaults, and lists it back", () => {
    const events = store();
    const created = events.create({ title: "Standup", startAt: "2026-07-08T09:00:00Z" });

    expect(created.title).toBe("Standup");
    expect(created.startAt).toBe("2026-07-08T09:00:00Z");
    expect(created.endAt).toBeNull();
    expect(created.allDay).toBe(false);
    expect(created.description).toBeNull();
    expect(created.location).toBeNull();
    expect(created.category).toBeNull();
    expect(created.createdAt).toBe(created.updatedAt);

    const listed = events.listActive();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(created);
  });

  it("persists all supplied fields on create", () => {
    const events = store();
    const created = events.create({
      title: "  Sprint review  ",
      startAt: "2026-07-10T09:00:00+02:00",
      endAt: "2026-07-10T10:00:00+02:00",
      location: "  Room 4  ",
      description: "## agenda",
      category: "work",
    });

    expect(created.title).toBe("Sprint review"); // trimmed
    expect(created.startAt).toBe("2026-07-10T09:00:00+02:00");
    expect(created.endAt).toBe("2026-07-10T10:00:00+02:00");
    expect(created.location).toBe("  Room 4  "); // preserved verbatim (only empty collapses to null)
    expect(created.description).toBe("## agenda");
    expect(created.category).toBe("work");
    expect(created.allDay).toBe(false);
  });

  it("creates an all-day event on a bare date", () => {
    const events = store();
    const created = events.create({
      title: "Public holiday",
      startAt: "2026-07-12",
      allDay: true,
    });

    expect(created.allDay).toBe(true);
    expect(created.startAt).toBe("2026-07-12");
    expect(events.listActive()[0]?.allDay).toBe(true); // round-trips through the 0/1 column
  });

  it("lists active events ordered by start_at then id", () => {
    vi.useFakeTimers();
    const events = store();
    vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
    const later = events.create({ title: "Later", startAt: "2026-07-10T09:00:00Z" });
    vi.setSystemTime(new Date("2026-07-06T10:00:01.000Z"));
    const earlyA = events.create({ title: "Early A", startAt: "2026-07-08T09:00:00Z" });
    vi.setSystemTime(new Date("2026-07-06T10:00:02.000Z"));
    const earlyB = events.create({ title: "Early B", startAt: "2026-07-08T09:00:00Z" });

    // earlyA/earlyB share a start_at, so the id tiebreak (creation order) settles them.
    expect(events.listActive().map((e) => e.id)).toEqual([earlyA.id, earlyB.id, later.id]);
  });

  it("updates fields, clears location with null, and bumps updated_at", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T10:00:00.000Z"));
    const events = store();
    const created = events.create({
      title: "Old",
      startAt: "2026-07-08T09:00:00Z",
      location: "Room 1",
    });

    vi.setSystemTime(new Date("2026-07-06T10:05:00.000Z"));
    const updated = events.update(created.id, { title: "New", location: null, allDay: true });

    expect(updated.title).toBe("New");
    expect(updated.location).toBeNull();
    expect(updated.allDay).toBe(true);
    expect(updated.startAt).toBe(created.startAt); // untouched
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
    expect(events.listActive()[0]).toEqual(updated);
  });

  it("rejects an end before its start on create", () => {
    const events = store();
    expect(() =>
      events.create({
        title: "Backwards",
        startAt: "2026-07-10T10:00:00Z",
        endAt: "2026-07-10T09:00:00Z",
      }),
    ).toThrow(EventValidationError);
  });

  it("rejects an end before its start on update", () => {
    const events = store();
    const created = events.create({
      title: "Meeting",
      startAt: "2026-07-10T10:00:00Z",
      endAt: "2026-07-10T11:00:00Z",
    });
    // moving only the end before the (unchanged) start must be caught against the merged pair.
    expect(() => events.update(created.id, { endAt: "2026-07-10T09:00:00Z" })).toThrow(
      EventValidationError,
    );
  });

  it("rejects a malformed start date", () => {
    const events = store();
    expect(() => events.create({ title: "x", startAt: "not-a-date" })).toThrow(
      EventValidationError,
    );
  });

  it("rejects a malformed end date", () => {
    const events = store();
    expect(() =>
      events.create({ title: "x", startAt: "2026-07-10", endAt: "not-a-date" }),
    ).toThrow(EventValidationError);
  });

  it("rejects an empty or whitespace-only title", () => {
    const events = store();
    expect(() => events.create({ title: "", startAt: "2026-07-10" })).toThrow(
      EventValidationError,
    );
    expect(() => events.create({ title: "   ", startAt: "2026-07-10" })).toThrow(
      EventValidationError,
    );
  });

  it("excludes soft-deleted events from the active list and restores them", () => {
    const events = store();
    const created = events.create({ title: "x", startAt: "2026-07-10T09:00:00Z" });

    events.softDelete(created.id);
    expect(events.listActive()).toHaveLength(0);

    events.restore(created.id);
    const listed = events.listActive();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
  });

  it("throws EventNotFoundError for operations on an unknown or wrong-state event", () => {
    const events = store();
    const created = events.create({ title: "x", startAt: "2026-07-10T09:00:00Z" });

    expect(() => events.update("missing", { title: "y" })).toThrow(EventNotFoundError);
    expect(() => events.softDelete("missing")).toThrow(EventNotFoundError);
    // not currently deleted -> nothing to restore.
    expect(() => events.restore(created.id)).toThrow(EventNotFoundError);
    // double delete -> the second finds no active row.
    events.softDelete(created.id);
    expect(() => events.softDelete(created.id)).toThrow(EventNotFoundError);
  });

  it("isolates events between profiles", () => {
    const a = new EventStore(db.raw, createProfile());
    const b = new EventStore(db.raw, createProfile());
    const owned = a.create({ title: "A only", startAt: "2026-07-10T09:00:00Z" });

    expect(b.listActive()).toHaveLength(0);
    expect(() => b.update(owned.id, { title: "hijack" })).toThrow(EventNotFoundError);
    expect(() => b.softDelete(owned.id)).toThrow(EventNotFoundError);
    expect(a.listActive()).toHaveLength(1);
  });
});
