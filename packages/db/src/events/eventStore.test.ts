import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RecurrenceRule } from "@nexus/core";
import {
  EventNotFoundError,
  EventStore,
  EventValidationError,
  MAX_EVENT_REMINDER_MINUTES,
  MAX_EVENT_REMINDERS,
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

describe("EventStore — recurrence (ADR-024)", () => {
  const NOW = "2026-07-15T12:00:00.000Z";
  const WEEKLY: RecurrenceRule = {
    freq: { kind: "weekly", interval: 1, days: [4] },
    end: { kind: "never" },
  };

  /** A recurring master starting Friday 2026-07-10, with `count` exdates already excepted. */
  function recurringEvent(events: EventStore, exdates: readonly string[] = []) {
    const created = events.create({
      title: "Petak",
      startAt: "2026-07-10T09:00:00Z",
      recurrence: WEEKLY,
    });
    let current = created;
    for (const date of exdates) current = events.addRecurrenceExdate(created.id, date, NOW);
    return current;
  }

  it("creates a series master and reads the canonical rule and an empty exdate list back", () => {
    const events = store();
    const created = events.create({
      title: "Sastanak",
      startAt: "2026-07-10T09:00:00Z",
      // Deliberately out of order: the store stores the canonical form.
      recurrence: { freq: { kind: "weekly", interval: 1, days: [4, 0] }, end: { kind: "never" } },
    });

    expect(created.recurrence).toEqual({
      freq: { kind: "weekly", interval: 1, days: [0, 4] },
      end: { kind: "never" },
    });
    expect(created.recurrenceExdates).toEqual([]);
    expect(events.listActive()[0]).toEqual(created);
  });

  it("defaults recurrence to null and round-trips a rule through an ordinary update", () => {
    const events = store();
    const created = events.create({ title: "x", startAt: "2026-07-10T09:00:00Z" });
    expect(created.recurrence).toBeNull();
    expect(created.recurrenceExdates).toEqual([]);

    const ruled = events.update(created.id, { recurrence: WEEKLY });
    expect(ruled.recurrence).toEqual(WEEKLY);
    expect(events.update(created.id, { title: "y" }).recurrence).toEqual(WEEKLY);
  });

  it("refuses a structurally invalid rule, and a rule on a start the engine cannot anchor on", () => {
    const events = store();
    expect(() =>
      events.create({
        title: "x",
        startAt: "2026-07-10T09:00:00Z",
        recurrence: { freq: { kind: "weekly", interval: 1, days: [] }, end: { kind: "never" } },
      }),
    ).toThrow(EventValidationError);
    // Shaped like a date, but not a day that exists — nothing to phase from.
    expect(() =>
      events.create({ title: "x", startAt: "2026-02-30T09:00:00Z", recurrence: WEEKLY }),
    ).toThrow(EventValidationError);
  });

  it("clears the exdates when the rule is cleared — exceptions without a series are meaningless", () => {
    const events = store();
    const master = recurringEvent(events, ["2026-07-17"]);
    expect(master.recurrenceExdates).toEqual(["2026-07-17"]);

    const cleared = events.update(master.id, { recurrence: null });
    expect(cleared.recurrence).toBeNull();
    expect(cleared.recurrenceExdates).toEqual([]);
    expect(events.listActive()[0]).toEqual(cleared);
  });

  it("keeps the exdates across an unrelated patch", () => {
    const events = store();
    const master = recurringEvent(events, ["2026-07-17"]);
    expect(events.update(master.id, { title: "Novi naslov" }).recurrenceExdates).toEqual([
      "2026-07-17",
    ]);
  });

  it("adds exdates, keeps them sorted, and is idempotent", () => {
    const events = store();
    const master = recurringEvent(events);

    const first = events.addRecurrenceExdate(master.id, "2026-07-24", NOW);
    expect(first.recurrenceExdates).toEqual(["2026-07-24"]);
    expect(first.updatedAt).toBe(NOW);

    const second = events.addRecurrenceExdate(master.id, "2026-07-17", NOW);
    expect(second.recurrenceExdates).toEqual(["2026-07-17", "2026-07-24"]); // ascending

    const again = events.addRecurrenceExdate(master.id, "2026-07-17", "2026-08-01T00:00:00.000Z");
    expect(again.recurrenceExdates).toEqual(["2026-07-17", "2026-07-24"]);
    expect(again.updatedAt).toBe(NOW); // a no-op does not restamp the row
    expect(events.listActive()[0]).toEqual(again);
  });

  it("refuses an exdate that is not a real calendar day, and one on an event with no rule", () => {
    const events = store();
    const master = recurringEvent(events);
    expect(() => events.addRecurrenceExdate(master.id, "2026-02-30", NOW)).toThrow(
      EventValidationError,
    );
    expect(() => events.addRecurrenceExdate(master.id, "2026-07-17T00:00:00Z", NOW)).toThrow(
      EventValidationError,
    );

    const oneOff = events.create({ title: "Jednokratno", startAt: "2026-07-10T09:00:00Z" });
    expect(() => events.addRecurrenceExdate(oneOff.id, "2026-07-17", NOW)).toThrow(
      EventValidationError,
    );
    expect(() => events.addRecurrenceExdate("missing", "2026-07-17", NOW)).toThrow(
      EventNotFoundError,
    );
  });

  it("splits a series by truncating the master to the day before the split occurrence", () => {
    const events = store();
    const master = recurringEvent(events, ["2026-07-17"]);

    const truncated = events.splitRecurrence(master.id, "2026-07-24", NOW);
    expect(truncated.recurrence).toEqual({
      freq: { kind: "weekly", interval: 1, days: [4] },
      end: { kind: "until", date: "2026-07-23" },
    });
    expect(truncated.recurrenceExdates).toEqual(["2026-07-17"]); // the past keeps its exceptions
    expect(truncated.updatedAt).toBe(NOW);
    expect(events.listActive()).toEqual([truncated]);
  });

  it("soft-deletes the master when the split lands on its own first occurrence", () => {
    const events = store();
    const master = recurringEvent(events);

    // until would be 2026-07-09, before the master's own 2026-07-10 anchor: a
    // series with no occurrences left should not linger as an unreachable row.
    const removed = events.splitRecurrence(master.id, "2026-07-10", NOW);
    expect(removed.updatedAt).toBe(NOW);
    expect(events.listActive()).toEqual([]);

    events.restore(master.id);
    // Splitting even earlier is the same case.
    events.splitRecurrence(master.id, "2026-07-01", NOW);
    expect(events.listActive()).toEqual([]);
  });

  it("refuses a split on an event with no rule, on a date that is not a real day, and on an unknown event", () => {
    const events = store();
    const oneOff = events.create({ title: "Jednokratno", startAt: "2026-07-10T09:00:00Z" });
    expect(() => events.splitRecurrence(oneOff.id, "2026-07-24", NOW)).toThrow(EventValidationError);

    const master = recurringEvent(events);
    expect(() => events.splitRecurrence(master.id, "2026-02-30", NOW)).toThrow(EventValidationError);
    expect(() => events.splitRecurrence("missing", "2026-07-24", NOW)).toThrow(EventNotFoundError);
  });

  it("throws when a stored rule or exdate list no longer validates — that is corruption, not input", () => {
    const events = store();
    const master = recurringEvent(events, ["2026-07-17"]);

    db.raw.prepare("UPDATE events SET recurrence = ? WHERE id = ?").run("{not json", master.id);
    expect(() => events.listActive()).toThrow(EventValidationError);

    db.raw
      .prepare("UPDATE events SET recurrence = ?, recurrence_exdates = ? WHERE id = ?")
      .run('{"freq":{"kind":"weekly","interval":1,"days":[4]},"end":{"kind":"never"}}', '["nope"]', master.id);
    expect(() => events.listActive()).toThrow(EventValidationError);

    db.raw.prepare("UPDATE events SET recurrence_exdates = ? WHERE id = ?").run('"2026-07-17"', master.id);
    expect(() => events.listActive()).toThrow(EventValidationError);
  });
});

describe("EventStore — reminder offsets (CAL-006)", () => {
  it("defaults to no reminders and stores a supplied ladder ascending", () => {
    const events = store();
    const plain = events.create({ title: "Bez podsetnika", startAt: "2026-07-10T09:00:00Z" });
    expect(plain.reminderOffsets).toEqual([]);

    // Deliberately out of order: the column keeps the canonical ascending form.
    // The later `startAt` is what makes the `listActive()` assertion below
    // deterministic: `ORDER BY start_at, id` would otherwise tie on the shared
    // instant and fall through to two same-millisecond uuidv7 ids, whose order
    // is decided by their random suffix — a coin flip on every run.
    const reminded = events.create({
      title: "Sa podsetnicima",
      startAt: "2026-07-10T10:00:00Z",
      reminderOffsets: [1440, 0, 15],
    });
    expect(reminded.reminderOffsets).toEqual([0, 15, 1440]);
    expect(events.listActive().map((event) => event.reminderOffsets)).toEqual([[], [0, 15, 1440]]);
  });

  it("patches the ladder through update, leaves it alone when omitted, and clears it with an empty array", () => {
    const events = store();
    const created = events.create({
      title: "x",
      startAt: "2026-07-10T09:00:00Z",
      reminderOffsets: [30],
    });

    expect(events.update(created.id, { title: "y" }).reminderOffsets).toEqual([30]);
    expect(events.update(created.id, { reminderOffsets: [120, 10] }).reminderOffsets).toEqual([10, 120]);
    expect(events.update(created.id, { reminderOffsets: [] }).reminderOffsets).toEqual([]);
    expect(events.listActive()[0]?.reminderOffsets).toEqual([]);
  });

  it("keeps reminders independent of recurrence — a one-off reminds, and clearing a rule does not clear them", () => {
    const events = store();
    const master = events.create({
      title: "Petkom",
      startAt: "2026-07-10T09:00:00Z",
      reminderOffsets: [15],
      recurrence: { freq: { kind: "weekly", interval: 1, days: [4] }, end: { kind: "never" } },
    });
    expect(master.reminderOffsets).toEqual([15]);

    const cleared = events.update(master.id, { recurrence: null });
    expect(cleared.recurrence).toBeNull();
    expect(cleared.recurrenceExdates).toEqual([]); // exceptions belong to the series...
    expect(cleared.reminderOffsets).toEqual([15]); // ...reminders do not
  });

  it("refuses a ladder that is not unique whole minutes within range, or that is too long", () => {
    const events = store();
    const bad: number[][] = [
      [-1], // negative lead time
      [1.5], // not whole minutes
      [MAX_EVENT_REMINDER_MINUTES + 1], // beyond the 30-day cap
      [10, 10], // the same lead time twice
      Array.from({ length: MAX_EVENT_REMINDERS + 1 }, (_, index) => index), // one too many
    ];
    for (const reminderOffsets of bad) {
      expect(() =>
        events.create({ title: "x", startAt: "2026-07-10T09:00:00Z", reminderOffsets }),
      ).toThrow(EventValidationError);
    }

    // The bounds themselves are inclusive, and a full ladder is fine.
    const created = events.create({
      title: "x",
      startAt: "2026-07-10T09:00:00Z",
      reminderOffsets: Array.from({ length: MAX_EVENT_REMINDERS }, (_, index) => index),
    });
    expect(created.reminderOffsets).toHaveLength(MAX_EVENT_REMINDERS);
    expect(
      events.update(created.id, { reminderOffsets: [0, MAX_EVENT_REMINDER_MINUTES] }).reminderOffsets,
    ).toEqual([0, MAX_EVENT_REMINDER_MINUTES]);
    // A rejected patch leaves the stored ladder untouched.
    expect(() => events.update(created.id, { reminderOffsets: [-5] })).toThrow(EventValidationError);
    expect(events.listActive()[0]?.reminderOffsets).toEqual([0, MAX_EVENT_REMINDER_MINUTES]);
  });

  it("throws when the stored ladder no longer validates — that is corruption, not input", () => {
    const events = store();
    const created = events.create({
      title: "x",
      startAt: "2026-07-10T09:00:00Z",
      reminderOffsets: [15],
    });

    const corrupt = ["{not json", '"15"', "[[15]]", '["15"]', "[-15]", "[1.5]", "[43201]"];
    for (const value of corrupt) {
      db.raw.prepare("UPDATE events SET reminder_offsets = ? WHERE id = ?").run(value, created.id);
      expect(() => events.listActive()).toThrow(EventValidationError);
    }
  });
});
