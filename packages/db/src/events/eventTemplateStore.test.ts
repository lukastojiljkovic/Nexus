import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EventNotFoundError,
  EventTemplateNotFoundError,
  EventTemplateStore,
  EventTemplateValidationError,
  EventStore,
  MAX_EVENT_REMINDERS,
  MAX_EVENT_REMINDER_MINUTES,
  MAX_EVENT_TEMPLATE_NAME_LENGTH,
  MIN_EVENT_TEMPLATE_DURATION_MINUTES,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";
import type { EventTemplatePayload } from "../index.js";

let dir: string;
let db: NexusDatabase;
let profileId: string;
let store: EventTemplateStore;
let events: EventStore;

const NOW = "2026-07-30T10:00:00.000Z";
const LATER = "2026-07-30T12:00:00.000Z";
const DAY = "2026-09-14";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-event-templates-"));
  db = openDatabase({ path: join(dir, "templates.db") });
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "P", NOW);
  store = new EventTemplateStore(db.raw, profileId);
  events = new EventStore(db.raw, profileId);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The minimum a payload can be: a timed title at a time of day, nothing else set. */
function minimalPayload(overrides: Partial<EventTemplatePayload> = {}): EventTemplatePayload {
  return {
    title: "Trening",
    allDay: false,
    startTime: "18:30",
    durationMinutes: null,
    location: null,
    description: null,
    category: null,
    reminderOffsets: [],
    recurrence: null,
    ...overrides,
  };
}

/** Every field set to something non-default — what a full capture from a rich event looks like. */
function fullPayload(): EventTemplatePayload {
  return {
    title: "Trening",
    allDay: false,
    startTime: "18:30",
    durationMinutes: 90,
    location: "Teretana",
    description: "Noge i leđa",
    category: "zdravlje",
    reminderOffsets: [10, 60],
    recurrence: { freq: { kind: "weekly", interval: 1, days: [1, 3] }, end: { kind: "never" } },
  };
}

/** An all-day payload: no time of day and no duration, which is the only legal all-day shape. */
function allDayPayload(overrides: Partial<EventTemplatePayload> = {}): EventTemplatePayload {
  return minimalPayload({ allDay: true, startTime: null, durationMinutes: null, ...overrides });
}

describe("EventTemplateStore — saveByName", () => {
  it("inserts a new template and returns it with a fresh id and both stamps", () => {
    const saved = store.saveByName("Trening", fullPayload(), NOW);

    expect(saved.id).not.toBe("");
    expect(saved.profileId).toBe(profileId);
    expect(saved.name).toBe("Trening");
    expect(saved.payload).toEqual(fullPayload());
    expect(saved.createdAt).toBe(NOW);
    expect(saved.updatedAt).toBe(NOW);
  });

  it("REPLACES an existing template of the same name, keeping its id and created_at", () => {
    const first = store.saveByName("Trening", fullPayload(), NOW);
    const second = store.saveByName("Trening", minimalPayload({ title: "Drugi naslov" }), LATER);

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(NOW);
    expect(second.updatedAt).toBe(LATER);
    expect(second.payload.title).toBe("Drugi naslov");
    expect(store.list()).toHaveLength(1);
  });

  it("trims the name, and matches an existing template by the TRIMMED name", () => {
    const first = store.saveByName("Trening", minimalPayload(), NOW);
    const second = store.saveByName("   Trening  ", minimalPayload(), LATER);

    expect(second.name).toBe("Trening");
    expect(second.id).toBe(first.id);
    expect(store.list()).toHaveLength(1);
  });

  it("refuses an empty or over-long name", () => {
    expect(() => store.saveByName("   ", minimalPayload(), NOW)).toThrow(
      EventTemplateValidationError,
    );
    expect(() =>
      store.saveByName("x".repeat(MAX_EVENT_TEMPLATE_NAME_LENGTH + 1), minimalPayload(), NOW),
    ).toThrow(EventTemplateValidationError);
    expect(() =>
      store.saveByName("x".repeat(MAX_EVENT_TEMPLATE_NAME_LENGTH), minimalPayload(), NOW),
    ).not.toThrow();
  });

  it("refuses a `now` that is not an ISO-8601 date-time", () => {
    expect(() => store.saveByName("A", minimalPayload(), "2026-07-30")).toThrow(
      EventTemplateValidationError,
    );
  });

  it("keeps templates of different profiles apart even under the same name", () => {
    const otherProfile = uuidv7();
    db.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(otherProfile, "personal", "Q", NOW);
    const other = new EventTemplateStore(db.raw, otherProfile);

    store.saveByName("Isti naziv", minimalPayload({ title: "A" }), NOW);
    other.saveByName("Isti naziv", minimalPayload({ title: "B" }), NOW);

    expect(store.list().map((row) => row.payload.title)).toEqual(["A"]);
    expect(other.list().map((row) => row.payload.title)).toEqual(["B"]);
  });
});

describe("EventTemplateStore — payload validation", () => {
  it("trims the title and refuses an empty one", () => {
    expect(store.saveByName("A", minimalPayload({ title: "  Naslov  " }), NOW).payload.title).toBe(
      "Naslov",
    );
    expect(() => store.saveByName("A", minimalPayload({ title: "   " }), NOW)).toThrow(
      EventTemplateValidationError,
    );
  });

  it("collapses a blank location/description/category to null, exactly as EventStore does", () => {
    const saved = store.saveByName(
      "A",
      minimalPayload({ location: "  ", description: "  ", category: "  " }),
      NOW,
    );
    expect(saved.payload.location).toBeNull();
    expect(saved.payload.description).toBeNull();
    expect(saved.payload.category).toBeNull();
  });

  it("requires a well-formed HH:MM startTime on a TIMED template", () => {
    expect(() => store.saveByName("A", minimalPayload({ startTime: null }), NOW)).toThrow(
      EventTemplateValidationError,
    );
    expect(() => store.saveByName("B", minimalPayload({ startTime: "24:00" }), NOW)).toThrow(
      EventTemplateValidationError,
    );
    expect(() => store.saveByName("C", minimalPayload({ startTime: "9:00" }), NOW)).toThrow(
      EventTemplateValidationError,
    );
    expect(() => store.saveByName("D", minimalPayload({ startTime: "00:00" }), NOW)).not.toThrow();
    expect(() => store.saveByName("E", minimalPayload({ startTime: "23:59" }), NOW)).not.toThrow();
  });

  it("refuses a time of day or a duration on an ALL-DAY template", () => {
    expect(() => store.saveByName("A", allDayPayload({ startTime: "09:00" }), NOW)).toThrow(
      EventTemplateValidationError,
    );
    expect(() => store.saveByName("B", allDayPayload({ durationMinutes: 60 }), NOW)).toThrow(
      EventTemplateValidationError,
    );
    expect(() => store.saveByName("C", allDayPayload(), NOW)).not.toThrow();
  });

  it("bounds durationMinutes to whole minutes that still end inside the template's own day", () => {
    expect(() =>
      store.saveByName(
        "A",
        minimalPayload({ durationMinutes: MIN_EVENT_TEMPLATE_DURATION_MINUTES }),
        NOW,
      ),
    ).not.toThrow();
    expect(() =>
      store.saveByName(
        "B",
        minimalPayload({ durationMinutes: MIN_EVENT_TEMPLATE_DURATION_MINUTES - 1 }),
        NOW,
      ),
    ).toThrow(EventTemplateValidationError);
    expect(() => store.saveByName("C", minimalPayload({ durationMinutes: 90.5 }), NOW)).toThrow(
      EventTemplateValidationError,
    );
    // 23:00 + 60 min would land at 24:00, which the app cannot write down.
    expect(() =>
      store.saveByName("D", minimalPayload({ startTime: "23:00", durationMinutes: 60 }), NOW),
    ).toThrow(EventTemplateValidationError);
    // 23:00 + 59 min lands exactly on 23:59, the last representable end.
    expect(() =>
      store.saveByName("E", minimalPayload({ startTime: "23:00", durationMinutes: 59 }), NOW),
    ).not.toThrow();
  });

  it("canonicalizes the reminder ladder ascending and refuses duplicates or out-of-range leads", () => {
    const saved = store.saveByName("A", minimalPayload({ reminderOffsets: [60, 0, 10] }), NOW);
    expect(saved.payload.reminderOffsets).toEqual([0, 10, 60]);

    expect(() => store.saveByName("B", minimalPayload({ reminderOffsets: [10, 10] }), NOW)).toThrow(
      EventTemplateValidationError,
    );
    expect(() =>
      store.saveByName(
        "C",
        minimalPayload({ reminderOffsets: [MAX_EVENT_REMINDER_MINUTES + 1] }),
        NOW,
      ),
    ).toThrow(EventTemplateValidationError);
    expect(() =>
      store.saveByName(
        "D",
        minimalPayload({
          reminderOffsets: Array.from({ length: MAX_EVENT_REMINDERS + 1 }, (_, i) => i),
        }),
        NOW,
      ),
    ).toThrow(EventTemplateValidationError);
  });

  it("keeps a reminder ladder on an ALL-DAY template — an all-day event reminds too", () => {
    const saved = store.saveByName("A", allDayPayload({ reminderOffsets: [1440] }), NOW);
    expect(saved.payload.reminderOffsets).toEqual([1440]);
  });

  it("refuses a recurrence rule the engine's own validator rejects", () => {
    const bad = {
      ...minimalPayload(),
      recurrence: { freq: { kind: "daily", interval: 0 }, end: { kind: "never" } },
    };
    expect(() => store.saveByName("A", bad as unknown as EventTemplatePayload, NOW)).toThrow(
      EventTemplateValidationError,
    );
  });

  it("accepts a recurrence rule with NO date to anchor it — the applied day is the anchor", () => {
    const saved = store.saveByName(
      "A",
      minimalPayload({
        recurrence: { freq: { kind: "daily", interval: 2 }, end: { kind: "never" } },
      }),
      NOW,
    );
    expect(saved.payload.recurrence).toEqual({
      freq: { kind: "daily", interval: 2 },
      end: { kind: "never" },
    });
  });
});

describe("EventTemplateStore — list / get / delete", () => {
  it("lists this profile's templates and parses each payload back", () => {
    store.saveByName("B naziv", fullPayload(), NOW);
    store.saveByName("A naziv", minimalPayload(), NOW);

    const rows = store.list();
    expect(rows.map((row) => row.name)).toEqual(["A naziv", "B naziv"]);
    expect(rows[1]?.payload).toEqual(fullPayload());
  });

  it("gets one template by id", () => {
    const saved = store.saveByName("A", fullPayload(), NOW);
    expect(store.get(saved.id)).toEqual(saved);
  });

  it("refuses a get for an id in another profile", () => {
    const otherProfile = uuidv7();
    db.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(otherProfile, "personal", "Q", NOW);
    const saved = new EventTemplateStore(db.raw, otherProfile).saveByName(
      "A",
      minimalPayload(),
      NOW,
    );

    expect(() => store.get(saved.id)).toThrow(EventTemplateNotFoundError);
  });

  it("hard-deletes a template, and refuses to delete one twice", () => {
    const saved = store.saveByName("A", minimalPayload(), NOW);
    store.delete(saved.id);
    expect(store.list()).toEqual([]);
    expect(() => store.delete(saved.id)).toThrow(EventTemplateNotFoundError);
  });

  it("reports a stored payload that no longer parses as corruption rather than coercing it", () => {
    const saved = store.saveByName("A", minimalPayload(), NOW);
    db.raw.prepare("UPDATE event_templates SET payload = ? WHERE id = ?").run("{not json", saved.id);

    expect(() => store.get(saved.id)).toThrow(EventTemplateValidationError);
    expect(() => store.list()).toThrow(EventTemplateValidationError);
  });

  it("reports a stored payload whose FIELDS are wrong as corruption too", () => {
    const saved = store.saveByName("A", minimalPayload(), NOW);
    db.raw
      .prepare("UPDATE event_templates SET payload = ? WHERE id = ?")
      .run('{"title":"x","allDay":false,"startTime":"25:00"}', saved.id);

    expect(() => store.get(saved.id)).toThrow(EventTemplateValidationError);
  });
});

describe("EventTemplateStore — apply", () => {
  it("creates a timed event on the named day, at the template's own time and duration", () => {
    const saved = store.saveByName("Trening", fullPayload(), NOW);
    const created = store.apply(saved.id, DAY);

    expect(created.title).toBe("Trening");
    expect(created.allDay).toBe(false);
    expect(created.startAt).toBe(`${DAY}T18:30`);
    expect(created.endAt).toBe(`${DAY}T20:00`);
    expect(created.location).toBe("Teretana");
    expect(created.description).toBe("Noge i leđa");
    expect(created.category).toBe("zdravlje");
    expect(created.reminderOffsets).toEqual([10, 60]);
    expect(created.recurrence).toEqual(fullPayload().recurrence);
    // And it is a real row of this profile, not just a returned object.
    expect(events.listActive().map((row) => row.id)).toEqual([created.id]);
  });

  it("leaves a template with no duration open-ended", () => {
    const saved = store.saveByName("A", minimalPayload(), NOW);
    const created = store.apply(saved.id, DAY);
    expect(created.startAt).toBe(`${DAY}T18:30`);
    expect(created.endAt).toBeNull();
  });

  it("creates an ALL-DAY event whose start is the bare day key", () => {
    const saved = store.saveByName("A", allDayPayload(), NOW);
    const created = store.apply(saved.id, DAY);
    expect(created.allDay).toBe(true);
    expect(created.startAt).toBe(DAY);
    expect(created.endAt).toBeNull();
  });

  it("anchors the recurrence rule on the APPLIED day, not on the day it was captured", () => {
    const saved = store.saveByName(
      "A",
      minimalPayload({
        recurrence: { freq: { kind: "weekly", interval: 1, days: [1] }, end: { kind: "never" } },
      }),
      NOW,
    );
    const created = store.apply(saved.id, DAY);
    expect(created.startAt.slice(0, 10)).toBe(DAY);
    expect(created.recurrence).not.toBeNull();
  });

  it("refuses a dayKey that is not a real calendar day", () => {
    const saved = store.saveByName("A", minimalPayload(), NOW);
    expect(() => store.apply(saved.id, "2026-02-30")).toThrow(EventTemplateValidationError);
    expect(() => store.apply(saved.id, "14.09.2026")).toThrow(EventTemplateValidationError);
  });

  it("refuses to apply a template of another profile", () => {
    const otherProfile = uuidv7();
    db.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(otherProfile, "personal", "Q", NOW);
    const saved = new EventTemplateStore(db.raw, otherProfile).saveByName(
      "A",
      minimalPayload(),
      NOW,
    );
    expect(() => store.apply(saved.id, DAY)).toThrow(EventTemplateNotFoundError);
  });
});

describe("EventTemplateStore — captureFromEvent", () => {
  it("relativizes a timed event: the date is dropped, the time of day and duration are kept", () => {
    const event = events.create({
      title: "Trening",
      startAt: "2026-08-03T18:30",
      endAt: "2026-08-03T20:00",
      location: "Teretana",
      description: "Noge i leđa",
      category: "zdravlje",
      reminderOffsets: [60, 10],
      recurrence: { freq: { kind: "weekly", interval: 1, days: [1, 3] }, end: { kind: "never" } },
    });

    const saved = store.captureFromEvent(event.id, "Trening", NOW);

    expect(saved.name).toBe("Trening");
    expect(saved.payload).toEqual(fullPayload());
    // Nothing in the stored payload names a date.
    expect(JSON.stringify(saved.payload)).not.toContain("2026-08-03");
  });

  it("captures an all-day event as an all-day template with no clock at all", () => {
    const event = events.create({ title: "Praznik", startAt: "2026-08-03", allDay: true });
    const saved = store.captureFromEvent(event.id, "Praznik", NOW);

    expect(saved.payload.allDay).toBe(true);
    expect(saved.payload.startTime).toBeNull();
    expect(saved.payload.durationMinutes).toBeNull();
  });

  it("captures an open-ended timed event with no duration", () => {
    const event = events.create({ title: "Kafa", startAt: "2026-08-03T09:15" });
    const saved = store.captureFromEvent(event.id, "Kafa", NOW);

    expect(saved.payload.startTime).toBe("09:15");
    expect(saved.payload.durationMinutes).toBeNull();
  });

  it("drops the duration of an event whose end is on another day — a template is one day's shape", () => {
    const event = events.create({
      title: "Konferencija",
      startAt: "2026-08-03T09:00",
      endAt: "2026-08-05T17:00",
    });
    const saved = store.captureFromEvent(event.id, "Konferencija", NOW);
    expect(saved.payload.startTime).toBe("09:00");
    expect(saved.payload.durationMinutes).toBeNull();
  });

  it("clamps a sub-minimum span up to the shortest duration a template may carry", () => {
    const event = events.create({
      title: "Poziv",
      startAt: "2026-08-03T09:00",
      endAt: "2026-08-03T09:00",
    });
    const saved = store.captureFromEvent(event.id, "Poziv", NOW);
    expect(saved.payload.durationMinutes).toBe(MIN_EVENT_TEMPLATE_DURATION_MINUTES);
  });

  it("drops the duration when no legal one still fits inside the day", () => {
    const event = events.create({
      title: "Kasno",
      startAt: "2026-08-03T23:50",
      endAt: "2026-08-03T23:59",
    });
    const saved = store.captureFromEvent(event.id, "Kasno", NOW);
    expect(saved.payload.startTime).toBe("23:50");
    expect(saved.payload.durationMinutes).toBeNull();
  });

  it("saves under an existing name by REPLACING it — capture is the edit mechanism", () => {
    const first = events.create({ title: "A", startAt: "2026-08-03T09:00" });
    const second = events.create({ title: "B", startAt: "2026-08-04T10:00" });

    const one = store.captureFromEvent(first.id, "Isti naziv", NOW);
    const two = store.captureFromEvent(second.id, "Isti naziv", LATER);

    expect(two.id).toBe(one.id);
    expect(two.payload.title).toBe("B");
    expect(store.list()).toHaveLength(1);
  });

  it("refuses an event that is not active in this profile", () => {
    const event = events.create({ title: "A", startAt: "2026-08-03T09:00" });
    events.softDelete(event.id);
    expect(() => store.captureFromEvent(event.id, "A", NOW)).toThrow(EventNotFoundError);
    expect(() => store.captureFromEvent(uuidv7(), "A", NOW)).toThrow(EventNotFoundError);
  });
});
