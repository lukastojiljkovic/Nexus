import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { EventStore, NexusDatabase, openDatabase, uuidv7 } from "@nexus/db";
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
});
