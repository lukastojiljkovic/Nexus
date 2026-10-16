import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CalendarSettingsStore,
  EventStore,
  EventTemplateStore,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "@nexus/db";
import type { Event } from "@nexus/db";
import type { ConfirmRequest, RecurrenceRule, Tool, ToolContext } from "@nexus/core";
import { calendarTools } from "./calendar.js";

/**
 * The CALENDAR tools over a real database.
 *
 * The load-bearing case is the recurring one: a series is ONE stored row
 * (ADR-024) and the tool has to expand it for a range, honouring the days the
 * user removed from it — so the assertion is a whole week's worth of lines,
 * derived from the ids the store minted.
 */

const NOW_MS = new Date(2026, 9, 10, 9, 0, 0).getTime();
const NOW_ISO = new Date(NOW_MS).toISOString();

/** Every day for ever — enough to prove the range is what bounds the expansion. */
const DAILY: RecurrenceRule = { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } };

let dir: string;
let db: NexusDatabase;
let profileId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-tool-calendar-"));
  db = openDatabase({ path: join(dir, "profile.db") });
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  profileId = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "Test", NOW_ISO);
});

function store(): EventStore {
  return new EventStore(db.raw, profileId);
}

function tools(): readonly Tool[] {
  return calendarTools({ profileDb: (id, open) => open(db.raw, id) });
}

function toolOf(name: string): Tool {
  const found = tools().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`Test setup: no tool "${name}".`);
  return found;
}

function contextFor(locale: "sr" | "en", allow: boolean): {
  readonly context: ToolContext;
  readonly confirms: ConfirmRequest[];
} {
  const confirms: ConfirmRequest[] = [];
  return {
    confirms,
    context: {
      profileId,
      locale,
      signal: new AbortController().signal,
      confirm: (request) => {
        confirms.push(request);
        return Promise.resolve(allow);
      },
    },
  };
}

function allEvents(): readonly Event[] {
  return store().listActive();
}

function templateStore(): EventTemplateStore {
  return new EventTemplateStore(db.raw, profileId);
}

function termStore(): CalendarSettingsStore {
  return new CalendarSettingsStore(db.raw, profileId);
}

describe("calendar.events", () => {
  it("expands a series across the range and honours the days removed from it", async () => {
    const series = store().create({
      title: "Jutarnje vežbe",
      startAt: "2026-10-12T09:00:00",
      recurrence: DAILY,
    });
    store().addRecurrenceExdate(series.id, "2026-10-14", NOW_ISO);
    const allDay = store().create({ title: "Praznik", startAt: "2026-10-13", allDay: true });
    const meeting = store().create({
      title: "Sastanak",
      startAt: "2026-10-14T18:00:00",
      endAt: "2026-10-14T19:30:00",
      location: "Kancelarija",
    });

    const result = await toolOf("calendar.events").run(
      { from: "2026-10-12", to: "2026-10-14" },
      contextFor("sr", true).context,
    );

    expect(result.ok).toBe(true);
    expect(result.content).toBe(
      [
        "Događaji (4):",
        `- ${series.id} Jutarnje vežbe [12. oktobar 2026., 09:00]`,
        `- ${allDay.id} Praznik [13. oktobar 2026., celi dan]`,
        `- ${series.id} Jutarnje vežbe [13. oktobar 2026., 09:00]`,
        `- ${meeting.id} Sastanak [14. oktobar 2026., 18:00—19:30, Kancelarija]`,
      ].join("\n"),
    );
    // The master's id appears twice — one row, two occurrences — and the
    // citation says which day each one was.
    expect(result.citations).toEqual([
      {
        kind: "event",
        id: series.id,
        title: "Jutarnje vežbe",
        locator: "2026-10-12",
        location: { module: "calendar", item: series.id },
      },
      {
        kind: "event",
        id: allDay.id,
        title: "Praznik",
        locator: "2026-10-13",
        location: { module: "calendar", item: allDay.id },
      },
      {
        kind: "event",
        id: series.id,
        title: "Jutarnje vežbe",
        locator: "2026-10-13",
        location: { module: "calendar", item: series.id },
      },
      {
        kind: "event",
        id: meeting.id,
        title: "Sastanak",
        locator: "2026-10-14",
        location: { module: "calendar", item: meeting.id },
      },
    ]);
  });

  it("says so when the window is empty", async () => {
    const result = await toolOf("calendar.events").run(
      { from: "2026-10-12", to: "2026-10-14" },
      contextFor("en", true).context,
    );
    expect(result).toEqual({
      ok: true,
      content: "No events in that range.",
    });
  });

  it("refuses a range that runs backwards and one that is too long", async () => {
    const backwards = await toolOf("calendar.events").run(
      { from: "2026-10-14", to: "2026-10-12" },
      contextFor("en", true).context,
    );
    expect(backwards.ok).toBe(false);
    expect(backwards.content).toBe(
      "Failed: The range starts after it ends: 2026-10-14 is after 2026-10-12.",
    );

    const tooLong = await toolOf("calendar.events").run(
      { from: "2026-01-01", to: "2027-01-02" },
      contextFor("en", true).context,
    );
    expect(tooLong.ok).toBe(false);
    expect(tooLong.content).toBe("Failed: The range is too long: at most 366 days per query.");
  });
});

describe("calendar.create", () => {
  it("asks in the user's language, then writes the event", async () => {
    const recorder = contextFor("sr", true);
    const result = await toolOf("calendar.create").run(
      {
        title: "Sastanak",
        start: "2026-10-14T18:00:00",
        end: "2026-10-14T19:30:00",
        location: "Kancelarija",
      },
      recorder.context,
    );

    expect(recorder.confirms).toEqual([
      {
        tool: "calendar.create",
        summary: "Napravi događaj „Sastanak“ — 14. oktobar 2026. 18:00",
        effect: "write",
      },
    ]);
    const written = allEvents();
    expect(written).toHaveLength(1);
    const event = written[0];
    if (event === undefined) throw new Error("no event was written");
    expect(event).toMatchObject({
      title: "Sastanak",
      startAt: "2026-10-14T18:00:00",
      endAt: "2026-10-14T19:30:00",
      allDay: false,
      location: "Kancelarija",
    });
    expect(result).toEqual({
      ok: true,
      content: `Napravljen događaj „Sastanak“ (${event.id}).`,
      citations: [
        {
          kind: "event",
          id: event.id,
          title: "Sastanak",
          location: { module: "calendar", item: event.id },
        },
      ],
      navigateTo: { module: "calendar", item: event.id },
    });
  });

  it("names a whole-day event by its day alone", async () => {
    const recorder = contextFor("en", true);
    await toolOf("calendar.create").run(
      { title: "Slava", start: "2026-10-14", allDay: true },
      recorder.context,
    );
    expect(recorder.confirms[0]?.summary).toBe("Create event “Slava” — 14 October 2026");
    expect(allEvents()[0]).toMatchObject({ allDay: true, endAt: null });
  });

  it("writes nothing when the user declines", async () => {
    const recorder = contextFor("en", false);
    const result = await toolOf("calendar.create").run(
      { title: "Sastanak", start: "2026-10-14T18:00:00" },
      recorder.context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(allEvents()).toEqual([]);
  });

  it("refuses a start that is not a date or a date-time", async () => {
    const result = await toolOf("calendar.create").run(
      { title: "Sastanak", start: "sledeći utorak" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
    expect(result.content).toBe('Failed: "start" must be an ISO-8601 date or date-time.');
    expect(allEvents()).toEqual([]);
  });

  it("repeats from its start day, until the day the user gave", async () => {
    const recorder = contextFor("en", true);
    const result = await toolOf("calendar.create").run(
      {
        title: "Vežbe",
        start: "2026-10-12T09:00",
        repeat: "weekly",
        repeatUntil: "2026-12-31",
        remindMinutesBefore: [60, 10],
      },
      recorder.context,
    );

    expect(recorder.confirms[0]?.summary).toBe(
      "Create event “Vežbe” — 12 October 2026 09:00, repeats weekly",
    );
    expect(allEvents()[0]).toMatchObject({
      recurrence: {
        freq: { kind: "weekly", interval: 1, days: [0] },
        end: { kind: "until", date: "2026-12-31" },
      },
      reminderOffsets: [10, 60],
    });
    expect(result.ok).toBe(true);
  });

  it("refuses an end of repeat with no repeat, or one before the start", async () => {
    const alone = await toolOf("calendar.create").run(
      { title: "Vežbe", start: "2026-10-12T09:00", repeatUntil: "2026-12-31" },
      contextFor("en", true).context,
    );
    expect(alone.content).toBe(
      "Failed: The repeat end (“repeatUntil”) needs a repeat (“repeat”) and must not fall before the start.",
    );

    const early = await toolOf("calendar.create").run(
      { title: "Vežbe", start: "2026-10-12T09:00", repeat: "daily", repeatUntil: "2026-10-01" },
      contextFor("en", true).context,
    );
    expect(early.ok).toBe(false);
    expect(allEvents()).toEqual([]);
  });
});

describe("calendar.events, a window that a one-off spills into", () => {
  it("lists a row that began before the window on its first day, as ongoing", async () => {
    const conference = store().create({
      title: "Konferencija",
      startAt: "2026-10-18T09:00:00",
      endAt: "2026-10-25T17:00:00",
    });

    const result = await toolOf("calendar.events").run(
      { from: "2026-10-20", to: "2026-10-22" },
      contextFor("en", true).context,
    );

    expect(result.content).toBe(
      ["Events (1):", `- ${conference.id} Konferencija [20 October 2026, ongoing]`].join("\n"),
    );
    expect(result.citations).toEqual([
      {
        kind: "event",
        id: conference.id,
        title: "Konferencija",
        locator: "2026-10-20",
        location: { module: "calendar", item: conference.id },
      },
    ]);
  });

  it("leaves a one-off that starts inside the window with its own day and clock", async () => {
    const meeting = store().create({
      title: "Sastanak",
      startAt: "2026-10-21T18:00:00",
      endAt: "2026-10-23T19:00:00",
    });

    const result = await toolOf("calendar.events").run(
      { from: "2026-10-20", to: "2026-10-22" },
      contextFor("en", true).context,
    );

    expect(result.content).toBe(
      ["Events (1):", `- ${meeting.id} Sastanak [21 October 2026, 18:00—19:00]`].join("\n"),
    );
  });
});

describe("calendar.update", () => {
  it("changes only the fields it names, and reveals the event", async () => {
    const meeting = store().create({
      title: "Sastanak",
      startAt: "2026-10-14T18:00:00",
      endAt: "2026-10-14T19:30:00",
      location: "Kancelarija",
    });
    const recorder = contextFor("sr", true);

    const result = await toolOf("calendar.update").run(
      { event: "sastanak", start: "2026-10-14T19:00:00" },
      recorder.context,
    );

    expect(recorder.confirms).toEqual([
      { tool: "calendar.update", summary: "Izmeni događaj „Sastanak“: početak.", effect: "write" },
    ]);
    expect(store().listActive()).toEqual([
      expect.objectContaining({
        id: meeting.id,
        startAt: "2026-10-14T19:00:00",
        endAt: "2026-10-14T19:30:00",
        location: "Kancelarija",
      }),
    ]);
    expect(result).toEqual({
      ok: true,
      content: `Izmenjen događaj „Sastanak“ (${meeting.id}).`,
      citations: [
        {
          kind: "event",
          id: meeting.id,
          title: "Sastanak",
          location: { module: "calendar", item: meeting.id },
        },
      ],
      navigateTo: { module: "calendar", item: meeting.id },
    });
  });

  it("sets the category on create and changes it on update", async () => {
    await toolOf("calendar.create").run(
      { title: "Predavanje", start: "2026-10-14T10:00", category: "Fakultet" },
      contextFor("en", true).context,
    );
    expect(allEvents()[0]?.category).toBe("Fakultet");

    await toolOf("calendar.update").run(
      { event: "Predavanje", category: "Posao" },
      contextFor("en", true).context,
    );
    expect(allEvents()[0]?.category).toBe("Posao");
  });

  it("keeps a reminder ladder in ascending order", async () => {
    store().create({ title: "Predaja", startAt: "2026-10-14T23:59:00" });

    await toolOf("calendar.update").run(
      { event: "Predaja", remindMinutesBefore: [1440, 10, 60] },
      contextFor("en", true).context,
    );

    expect(allEvents()[0]?.reminderOffsets).toEqual([10, 60, 1440]);
  });

  it("refuses an ambiguous title with the candidates, and a missing one by name", async () => {
    const first = store().create({ title: "Ručak", startAt: "2026-10-14T12:00:00" });
    const second = store().create({ title: "Ručak", startAt: "2026-10-15T12:00:00" });
    const recorder = contextFor("en", true);

    const ambiguous = await toolOf("calendar.update").run(
      { event: "Ručak", title: "Ručak u menzi" },
      recorder.context,
    );
    expect(ambiguous.content).toBe(
      `Failed: More than one event is called “Ručak”: Ručak (${first.id}), Ručak (${second.id}). Use its id.`,
    );

    const missing = await toolOf("calendar.update").run(
      { event: "Nepostojeći", title: "Nešto" },
      recorder.context,
    );
    expect(missing.content).toBe("Failed: No event named “Nepostojeći”.");
    expect(recorder.confirms).toEqual([]);
  });

  it("refuses a call that changes nothing, and a repeated lead time", async () => {
    store().create({ title: "Predaja", startAt: "2026-10-14T23:59:00" });

    const empty = await toolOf("calendar.update").run(
      { event: "Predaja" },
      contextFor("en", true).context,
    );
    expect(empty.content).toBe("Failed: There is nothing to change: give at least one field.");

    const repeated = await toolOf("calendar.update").run(
      { event: "Predaja", remindMinutesBefore: [10, 10] },
      contextFor("en", true).context,
    );
    expect(repeated.content).toBe(
      'Failed: "reminderOffsets" must not repeat the same lead time.',
    );
  });

  it("writes nothing when the user declines", async () => {
    const meeting = store().create({ title: "Sastanak", startAt: "2026-10-14T18:00:00" });

    const result = await toolOf("calendar.update").run(
      { event: meeting.id, title: "Ručak" },
      contextFor("en", false).context,
    );

    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(allEvents()[0]?.title).toBe("Sastanak");
  });
});

describe("calendar.delete and calendar.restore", () => {
  it("deletes an event, then restores it by the id the deletion reported", async () => {
    const checkup = store().create({ title: "Pregled", startAt: "2026-10-14T10:00:00" });

    const deleted = await toolOf("calendar.delete").run(
      { event: "Pregled" },
      contextFor("en", true).context,
    );
    expect(deleted).toEqual({ ok: true, content: `Deleted event “Pregled” (${checkup.id}).` });
    expect(allEvents()).toEqual([]);

    const recorder = contextFor("en", true);
    const restored = await toolOf("calendar.restore").run({ id: checkup.id }, recorder.context);
    expect(recorder.confirms[0]?.summary).toBe(`Restore the deleted event (${checkup.id}).`);
    expect(restored).toEqual({
      ok: true,
      content: `Restored event “Pregled” (${checkup.id}).`,
      citations: [
        {
          kind: "event",
          id: checkup.id,
          title: "Pregled",
          location: { module: "calendar", item: checkup.id },
        },
      ],
      navigateTo: { module: "calendar", item: checkup.id },
    });
    expect(allEvents()).toHaveLength(1);
  });

  it("refuses a restore of an event that is not deleted", async () => {
    const result = await toolOf("calendar.restore").run(
      { id: "00000000-0000-0000-0000-000000000000" },
      contextFor("en", true).context,
    );
    expect(result.ok).toBe(false);
  });
});

describe("calendar.occurrence", () => {
  it("skips one day of a series, and removes only that day", async () => {
    const series = store().create({
      title: "Vežbe",
      startAt: "2026-10-12T09:00:00",
      recurrence: DAILY,
    });
    const recorder = contextFor("en", true);

    const result = await toolOf("calendar.occurrence").run(
      { event: "Vežbe", action: "skip", day: "2026-10-14" },
      recorder.context,
    );

    expect(recorder.confirms[0]?.summary).toBe(
      "Remove the 14 October 2026 occurrence from the series “Vežbe”.",
    );
    expect(result.content).toBe(
      "The 14 October 2026 occurrence was removed from the series “Vežbe”.",
    );
    expect(allEvents()[0]).toMatchObject({ id: series.id, recurrenceExdates: ["2026-10-14"] });
  });

  it("ends the series from a day on, so the day before is its last", async () => {
    store().create({ title: "Vežbe", startAt: "2026-10-12T09:00:00", recurrence: DAILY });

    const result = await toolOf("calendar.occurrence").run(
      { event: "Vežbe", action: "split-here", day: "2026-10-14" },
      contextFor("en", true).context,
    );

    expect(result.content).toBe("The series “Vežbe” ends before 14 October 2026.");
    expect(allEvents()[0]?.recurrence).toEqual({
      freq: DAILY.freq,
      end: { kind: "until", date: "2026-10-13" },
    });
  });

  it("refuses a one-off, before asking anything", async () => {
    store().create({ title: "Sastanak", startAt: "2026-10-14T18:00:00" });
    const recorder = contextFor("en", true);

    const result = await toolOf("calendar.occurrence").run(
      { event: "Sastanak", action: "skip", day: "2026-10-14" },
      recorder.context,
    );

    expect(result.content).toBe("Failed: “Sastanak” is not a recurring event.");
    expect(recorder.confirms).toEqual([]);
  });

  it("writes nothing when the user declines", async () => {
    store().create({ title: "Vežbe", startAt: "2026-10-12T09:00:00", recurrence: DAILY });

    const result = await toolOf("calendar.occurrence").run(
      { event: "Vežbe", action: "skip", day: "2026-10-14" },
      contextFor("en", false).context,
    );

    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(allEvents()[0]?.recurrenceExdates).toEqual([]);
  });
});

describe("calendar.templates and calendar.template", () => {
  it("captures an event's shape, lists it, applies it to a day and deletes it", async () => {
    store().create({
      title: "Ručak",
      startAt: "2026-10-14T12:00:00",
      endAt: "2026-10-14T13:00:00",
      location: "Menza",
    });

    const captured = await toolOf("calendar.template").run(
      { action: "capture", template: "Ručak u menzi", event: "Ručak" },
      contextFor("en", true).context,
    );
    expect(captured).toEqual({ ok: true, content: "The template “Ručak u menzi” is saved." });
    expect(templateStore().list()[0]?.payload).toMatchObject({
      startTime: "12:00",
      durationMinutes: 60,
      location: "Menza",
    });

    const listed = await toolOf("calendar.templates").run({}, contextFor("en", true).context);
    const [template] = templateStore().list();
    expect(listed.content).toBe(
      ["Templates (1):", `- ${template?.id} Ručak u menzi [12:00, 60 min]`].join("\n"),
    );

    const recorder = contextFor("en", true);
    const applied = await toolOf("calendar.template").run(
      { action: "apply", template: "ručak u menzi", day: "2026-10-20" },
      recorder.context,
    );
    expect(recorder.confirms[0]?.summary).toBe(
      "Lay the template “Ručak u menzi” on 20 October 2026.",
    );
    const laid = allEvents().find((event) => event.startAt === "2026-10-20T12:00");
    expect(laid).toMatchObject({ title: "Ručak", endAt: "2026-10-20T13:00", location: "Menza" });
    expect(applied).toEqual({
      ok: true,
      content: `Created event “Ručak” (${laid?.id}).`,
      citations: [
        {
          kind: "event",
          id: laid?.id,
          title: "Ručak",
          location: { module: "calendar", item: laid?.id },
        },
      ],
      navigateTo: { module: "calendar", item: laid?.id },
    });

    const deleted = await toolOf("calendar.template").run(
      { action: "delete", template: "Ručak u menzi" },
      contextFor("en", true).context,
    );
    expect(deleted).toEqual({ ok: true, content: "The template “Ručak u menzi” is deleted." });
    expect(templateStore().list()).toEqual([]);
  });

  it("writes no template when the user declines a capture, and refuses an unknown one by name", async () => {
    store().create({ title: "Ručak", startAt: "2026-10-14T12:00:00" });

    const declined = await toolOf("calendar.template").run(
      { action: "capture", template: "Ručak", event: "Ručak" },
      contextFor("en", false).context,
    );
    expect(declined).toEqual({ ok: false, content: "The user declined." });
    expect(templateStore().list()).toEqual([]);

    const missing = await toolOf("calendar.template").run(
      { action: "apply", template: "Nepostojeći", day: "2026-10-20" },
      contextFor("en", true).context,
    );
    expect(missing.content).toBe("Failed: No template named “Nepostojeći”.");
  });
});

describe("calendar.term", () => {
  it("sets both dates of the semester, and reveals the calendar", async () => {
    const recorder = contextFor("en", true);

    const result = await toolOf("calendar.term").run(
      { start: "2026-10-01", end: "2026-12-20" },
      recorder.context,
    );

    expect(recorder.confirms[0]?.summary).toBe(
      "Set the term from 1 October 2026 to 20 December 2026.",
    );
    expect(termStore().get()).toEqual({ semesterStart: "2026-10-01", semesterEnd: "2026-12-20" });
    expect(result).toEqual({
      ok: true,
      content: "The term runs from 1 October 2026 to 20 December 2026.",
      navigateTo: { module: "calendar" },
    });
  });

  it("refuses one date alone, both dates with clear, and a term that starts after it ends", async () => {
    const shape = "Failed: The term takes both dates (start and end), or clear: true to remove it, never both.";

    const alone = await toolOf("calendar.term").run({ start: "2026-10-01" }, contextFor("en", true).context);
    expect(alone.content).toBe(shape);

    const both = await toolOf("calendar.term").run(
      { start: "2026-10-01", end: "2026-12-20", clear: true },
      contextFor("en", true).context,
    );
    expect(both.content).toBe(shape);

    const backwards = await toolOf("calendar.term").run(
      { start: "2026-12-20", end: "2026-10-01" },
      contextFor("en", true).context,
    );
    expect(backwards.content).toBe("Failed: The term cannot start after it ends.");

    expect(termStore().get()).toEqual({ semesterStart: null, semesterEnd: null });
  });

  it("clears the term when asked to, alone", async () => {
    termStore().save({ semesterStart: "2026-10-01", semesterEnd: "2026-12-20" });

    const result = await toolOf("calendar.term").run(
      { clear: true },
      contextFor("en", true).context,
    );

    expect(result).toEqual({
      ok: true,
      content: "The term dates are cleared.",
      navigateTo: { module: "calendar" },
    });
    expect(termStore().get()).toEqual({ semesterStart: null, semesterEnd: null });
  });

  it("writes nothing when the user declines", async () => {
    const result = await toolOf("calendar.term").run(
      { start: "2026-10-01", end: "2026-12-20" },
      contextFor("en", false).context,
    );
    expect(result).toEqual({ ok: false, content: "The user declined." });
    expect(termStore().get()).toEqual({ semesterStart: null, semesterEnd: null });
  });
});
