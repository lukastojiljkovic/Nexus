import { describe, expect, it } from "vitest";

import type { Event, Person, RunningFocusSession } from "../../shared/ipc.js";
import { buildCalendarItems, type CalendarItem, type CalendarSource } from "./calendarItems.js";
import type { ClockPreference } from "./calendarPrefs.js";
import { dayStripLine, nextStripEvent } from "./dashboardStrip.js";

/**
 * `dashboardStrip.ts` decides what the dashboard header says about the day, and
 * it is pure by construction: the clock arrives as `todayKey` / `nowMinutes` /
 * `nowMs` rather than being read. That is what lets these tests stand at 23:59,
 * at the exact minute an event starts, and at a minute past it — the three
 * readings the selection rule actually turns on.
 *
 * The items are built through `buildCalendarItems`, not hand-written: the strip
 * consumes the very stream „Danas" does, recurring expansion included, and a
 * test that fabricated items would pin the helper against a shape the page
 * never hands it.
 */

const PROFILE = "profile-1";
const T0 = "2026-01-01T00:00:00.000Z";
const TODAY = "2026-07-31";

function makeEvent(fields: Partial<Event> & Pick<Event, "id" | "startAt">): Event {
  return {
    profileId: PROFILE,
    title: `Event ${fields.id}`,
    description: null,
    endAt: null,
    allDay: false,
    location: null,
    category: null,
    createdAt: T0,
    updatedAt: T0,
    recurrence: null,
    recurrenceExdates: [],
    reminderOffsets: [],
    ...fields,
  };
}

/**
 * The merge the page runs, over today alone. Birthdays are enabled here even
 * though the page asks for events only: the helper's first rule is that it
 * reads nothing but events, and a stream that could never carry anything else
 * would not test it.
 */
function itemsOf(events: readonly Event[], people: readonly Person[] = []): CalendarItem[] {
  return buildCalendarItems(
    { events, tasks: [], exams: [], blocks: [], subjects: [], people, overlay: [], renewals: [] },
    new Set<CalendarSource>(["events", "birthdays"]),
    { from: TODAY, to: TODAY },
  );
}

/** Minutes from midnight, the reading the page derives from its own tick. */
function at(hours: number, minutes: number): number {
  return hours * 60 + minutes;
}

describe("nextStripEvent", () => {
  it("picks the earliest timed event still ahead of now", () => {
    const items = itemsOf([
      makeEvent({ id: "b", startAt: `${TODAY}T16:00`, title: "Kasnije" }),
      makeEvent({ id: "a", startAt: `${TODAY}T14:00`, title: "Sastanak" }),
      makeEvent({ id: "c", startAt: `${TODAY}T09:00`, title: "Prošlo" }),
    ]);
    const next = nextStripEvent(items, TODAY, at(10, 0));
    expect(next?.item.event.title).toBe("Sastanak");
    expect(next?.startMinutes).toBe(14 * 60);
  });

  it("keeps an event for the minute it starts in, and drops it the minute after", () => {
    const items = itemsOf([makeEvent({ id: "a", startAt: `${TODAY}T14:00`, title: "Sastanak" })]);
    expect(nextStripEvent(items, TODAY, at(13, 59))?.item.event.title).toBe("Sastanak");
    expect(nextStripEvent(items, TODAY, at(14, 0))?.item.event.title).toBe("Sastanak");
    expect(nextStripEvent(items, TODAY, at(14, 1))).toBeNull();
  });

  it("does not name an event already under way, even one still running", () => {
    const items = itemsOf([
      makeEvent({
        id: "a",
        startAt: `${TODAY}T13:00`,
        endAt: `${TODAY}T15:00`,
        title: "U toku",
      }),
    ]);
    expect(nextStripEvent(items, TODAY, at(14, 0))).toBeNull();
  });

  it("counts an all-day event as current until midnight, with no time of its own", () => {
    const items = itemsOf([
      makeEvent({ id: "a", startAt: `${TODAY}T00:00`, allDay: true, title: "Godišnjica" }),
    ]);
    for (const minutes of [at(0, 0), at(14, 0), at(23, 59)]) {
      const next = nextStripEvent(items, TODAY, minutes);
      expect(next?.item.event.title).toBe("Godišnjica");
      expect(next?.startMinutes).toBeNull();
    }
  });

  it("prefers a timed event still ahead over an all-day one, and falls back to it once none is left", () => {
    const items = itemsOf([
      makeEvent({ id: "a", startAt: `${TODAY}T00:00`, allDay: true, title: "Godišnjica" }),
      makeEvent({ id: "b", startAt: `${TODAY}T14:00`, title: "Sastanak" }),
    ]);
    expect(nextStripEvent(items, TODAY, at(10, 0))?.item.event.title).toBe("Sastanak");
    expect(nextStripEvent(items, TODAY, at(15, 0))?.item.event.title).toBe("Godišnjica");
  });

  it("reads a multi-day span that began earlier as a day-long entry", () => {
    const items = itemsOf([
      makeEvent({
        id: "a",
        startAt: "2026-07-29T09:00",
        endAt: `${TODAY}T18:00`,
        title: "Konferencija",
      }),
    ]);
    const next = nextStripEvent(items, TODAY, at(14, 0));
    expect(next?.item.event.title).toBe("Konferencija");
    // Its start time belongs to a day that has already gone; only the day is left to say.
    expect(next?.startMinutes).toBeNull();
  });

  it("ignores events that do not cover today at all", () => {
    const items = itemsOf([
      makeEvent({ id: "a", startAt: "2026-08-01T09:00", title: "Sutra" }),
      makeEvent({ id: "b", startAt: "2026-07-30T09:00", title: "Juče" }),
    ]);
    expect(nextStripEvent(items, TODAY, at(8, 0))).toBeNull();
  });

  it("names today's occurrence of a recurring series, at the time it happens", () => {
    const items = itemsOf([
      makeEvent({
        id: "a",
        startAt: "2026-07-01T08:30",
        title: "Trening",
        recurrence: { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } },
      }),
    ]);
    const next = nextStripEvent(items, TODAY, at(7, 0));
    expect(next?.item.event.title).toBe("Trening");
    expect(next?.startMinutes).toBe(8 * 60 + 30);
    expect(next?.item.event.startAt.slice(0, 10)).toBe(TODAY);
  });

  it("reads nothing but events — a birthday falling today is „Danas“'s business", () => {
    const people: Person[] = [
      {
        id: "p1",
        profileId: PROFILE,
        name: "Ana",
        kind: "birthday",
        month: 7,
        day: 31,
        year: 1996,
        note: null,
        createdAt: T0,
        updatedAt: T0,
      },
    ];
    expect(nextStripEvent(itemsOf([], people), TODAY, at(9, 0))).toBeNull();
  });

  it("breaks a tie at the same minute on sortKey, then id", () => {
    const items = itemsOf([
      makeEvent({ id: "b", startAt: `${TODAY}T14:00`, title: "Drugi" }),
      makeEvent({ id: "a", startAt: `${TODAY}T14:00`, title: "Prvi" }),
    ]);
    expect(nextStripEvent(items, TODAY, at(10, 0))?.item.event.title).toBe("Prvi");
  });

  it("breaks a tie between two day-long entries the same way", () => {
    const items = itemsOf([
      makeEvent({ id: "b", startAt: `${TODAY}T00:00`, allDay: true, title: "Drugi" }),
      makeEvent({ id: "a", startAt: `${TODAY}T00:00`, allDay: true, title: "Prvi" }),
    ]);
    expect(nextStripEvent(items, TODAY, at(10, 0))?.item.event.title).toBe("Prvi");
  });

  it("has nothing to say once the day's last event has started", () => {
    const items = itemsOf([makeEvent({ id: "a", startAt: `${TODAY}T09:00`, title: "Jutarnji" })]);
    expect(nextStripEvent(items, TODAY, at(23, 59))).toBeNull();
  });
});

describe("dayStripLine", () => {
  const noon = Date.UTC(2026, 6, 31, 12, 0, 0);

  function line(
    events: readonly Event[],
    nowMinutes: number,
    focus: RunningFocusSession | null,
    nowMs = noon,
    clock: ClockPreference = "24h",
  ): string | null {
    return dayStripLine({
      items: itemsOf(events),
      todayKey: TODAY,
      nowMinutes,
      nowMs,
      clock,
      focus,
    });
  }

  it("is absent entirely when there is nothing to say", () => {
    expect(line([], at(10, 0), null)).toBeNull();
  });

  it("names the next event with its time", () => {
    const events = [makeEvent({ id: "a", startAt: `${TODAY}T14:00`, title: "Sastanak sa mentorom" })];
    expect(line(events, at(10, 0), null)).toBe("14:00 · Sastanak sa mentorom");
  });

  // CAL §5. The clock arrives in the input rather than being read here, which
  // is exactly what keeps this module pure — and what lets one assertion pin
  // that the strip and every calendar surface draw the same label.
  it("writes that time on whichever clock the device reads", () => {
    const events = [makeEvent({ id: "a", startAt: `${TODAY}T14:00`, title: "Sastanak sa mentorom" })];
    expect(line(events, at(10, 0), null, noon, "12h")).toBe("2:00 PM · Sastanak sa mentorom");
  });

  it("leaves „danas“ alone on the 12-hour clock — there is no hour in it to convert", () => {
    const events = [
      makeEvent({ id: "a", startAt: `${TODAY}T00:00`, allDay: true, title: "Godišnjica" }),
    ];
    expect(line(events, at(10, 0), null, noon, "12h")).toBe("danas · Godišnjica");
  });

  it("says „danas“ in place of an hour for a day-long entry", () => {
    const events = [
      makeEvent({ id: "a", startAt: `${TODAY}T00:00`, allDay: true, title: "Godišnjica" }),
    ];
    expect(line(events, at(10, 0), null)).toBe("danas · Godišnjica");
  });

  /** A running phase in STUDY's own shape — open-ended, subject-scoped, never paused. */
  function started(ms: number, extra: Partial<RunningFocusSession> = {}): RunningFocusSession {
    return {
      subjectId: "s1",
      startedAt: new Date(noon - ms).toISOString(),
      kind: "work",
      plannedMinutes: null,
      cycleIndex: 0,
      taskId: null,
      label: null,
      pausedAt: null,
      pausedSeconds: 0,
      ...extra,
    };
  }

  it("carries the running focus timer on its own, in whole elapsed minutes", () => {
    expect(line([], at(12, 0), started(45 * 60_000))).toBe("Fokus u toku: 45 min");
  });

  it("leaves the duration off under the first minute, and floors it after", () => {
    expect(line([], at(12, 0), started(30_000))).toBe("Fokus u toku");
    expect(line([], at(12, 0), started(119_000))).toBe("Fokus u toku: 1 min");
    expect(line([], at(12, 0), started(3_660_000))).toBe("Fokus u toku: 1 h 1 min");
  });

  // UTIL slice b: the phase can be PAUSED now, and its clock is frozen at
  // `pausedAt`. The strip says „pauziran" rather than „u toku" because the
  // figure beside it has stopped moving — a growing number under the word
  // „u toku" is the one lie a still header can tell.
  it("says a paused phase is paused, and freezes its figure at the pause", () => {
    const paused = started(45 * 60_000, {
      pausedAt: new Date(noon - 20 * 60_000).toISOString(),
    });
    expect(line([], at(12, 0), paused)).toBe("Fokus je pauziran: 25 min");
    // An hour later it still reads 25 — the pause is not attention.
    expect(line([], at(13, 0), paused, noon + 3_600_000)).toBe("Fokus je pauziran: 25 min");
  });

  it("takes finished pauses off the elapsed figure", () => {
    expect(line([], at(12, 0), started(45 * 60_000, { pausedSeconds: 900 }))).toBe(
      "Fokus u toku: 30 min",
    );
  });

  it("still says the timer is on when its start instant is unreadable", () => {
    expect(line([], at(12, 0), { ...started(0), startedAt: "not-a-date" })).toBe("Fokus u toku");
  });

  it("joins both segments with the house separator", () => {
    const events = [makeEvent({ id: "a", startAt: `${TODAY}T14:00`, title: "Sastanak" })];
    expect(line(events, at(10, 0), started(25 * 60_000))).toBe(
      "14:00 · Sastanak · Fokus u toku: 25 min",
    );
  });
});
