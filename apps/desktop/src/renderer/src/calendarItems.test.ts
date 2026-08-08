import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CalendarOverlayEvent,
  Event,
  Exam,
  Person,
  StudyBlockWithExam,
  Subject,
  Task,
} from "../../shared/ipc.js";
import {
  buildCalendarItems,
  CALENDAR_SOURCES,
  daysBetweenKeys,
  formatClock,
  isMutedItem,
  isSpanItem,
  isTimedEventItem,
  isTimedForeignItem,
  LAST_MINUTE_OF_DAY,
  parseClock,
  persistSources,
  readStoredSources,
  type CalendarItem,
  type CalendarRange,
  type CalendarSource,
  type CalendarSourceRows,
} from "./calendarItems.js";
import { memoryStorage } from "./testStorage.js";

/**
 * `calendarItems.ts` is the one place four raw row sources become the single
 * stream every calendar surface reads, and the one place a malformed day key
 * is stopped before `@nexus/core`'s grid math throws on it. Every assertion
 * here works off explicit UTC instants: the module slices day keys and "HH:MM"
 * fragments out of the stored strings rather than parsing them into `Date`s,
 * so the results are host-time-zone independent by construction and the tests
 * pin exactly that.
 *
 * The source-toggle helpers at the bottom read `localStorage`, stubbed with an
 * in-memory `Storage` — no DOM library involved.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const PROFILE = "profile-1";
const T0 = "2026-01-01T00:00:00.000Z";

// --- Row factories ------------------------------------------------------------

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

function makeTask(fields: Partial<Task> & Pick<Task, "id">): Task {
  return {
    profileId: PROFILE,
    parentId: null,
    title: `Task ${fields.id}`,
    description: null,
    status: "todo",
    priority: "none",
    done: false,
    dueDate: null,
    startDate: null,
    createdAt: T0,
    updatedAt: T0,
    completedAt: null,
    recurrence: null,
    reminderOffsets: [],
    listId: "list-1",
    sectionId: null,
    rank: "i0",
    ...fields,
  };
}

function makeSubject(id: string): Subject {
  return {
    id,
    profileId: PROFILE,
    name: `Subject ${id}`,
    color: "jade",
    semester: null,
    archived: false,
    createdAt: T0,
    updatedAt: T0,
  };
}

function makeExam(fields: Pick<Exam, "id" | "subjectId" | "examDate">): Exam {
  return {
    profileId: PROFILE,
    examType: "pismeni",
    scope: null,
    createdAt: T0,
    updatedAt: T0,
    ...fields,
  };
}

function makeBlock(
  fields: Partial<StudyBlockWithExam> & Pick<StudyBlockWithExam, "id" | "examId" | "blockDate">,
): StudyBlockWithExam {
  return {
    planId: "plan-1",
    profileId: PROFILE,
    minutes: 60,
    status: "planned",
    topicId: null,
    kind: "coverage",
    pinned: false,
    createdAt: T0,
    updatedAt: T0,
    ...fields,
  };
}

function makePerson(fields: Partial<Person> & Pick<Person, "id" | "month" | "day">): Person {
  return {
    profileId: PROFILE,
    name: `Person ${fields.id}`,
    kind: "birthday",
    year: null,
    note: null,
    createdAt: T0,
    updatedAt: T0,
    ...fields,
  };
}

function makeOverlay(
  fields: Partial<CalendarOverlayEvent> & Pick<CalendarOverlayEvent, "id" | "startAt">,
): CalendarOverlayEvent {
  return {
    title: `Foreign ${fields.id}`,
    endAt: null,
    allDay: false,
    foreign: true,
    ...fields,
  };
}

const EMPTY_ROWS: CalendarSourceRows = {
  events: [],
  tasks: [],
  exams: [],
  blocks: [],
  subjects: [],
  people: [],
  overlay: [],
  renewals: [],
};

const JULY: CalendarRange = { from: "2026-07-01", to: "2026-07-31" };

function build(
  rows: Partial<CalendarSourceRows>,
  enabled: readonly CalendarSource[] = CALENDAR_SOURCES,
  range: CalendarRange = JULY,
): CalendarItem[] {
  return buildCalendarItems({ ...EMPTY_ROWS, ...rows }, new Set(enabled), range);
}

// --- Bare helpers -------------------------------------------------------------

describe("daysBetweenKeys", () => {
  it("counts whole days in either direction, zero for the same day", () => {
    expect(daysBetweenKeys("2026-07-01", "2026-07-01")).toBe(0);
    expect(daysBetweenKeys("2026-07-01", "2026-07-08")).toBe(7);
    expect(daysBetweenKeys("2026-07-08", "2026-07-01")).toBe(-7);
  });

  it("crosses month, year and leap boundaries, and does not drift over a DST switch", () => {
    expect(daysBetweenKeys("2026-07-31", "2026-08-01")).toBe(1);
    expect(daysBetweenKeys("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetweenKeys("2024-02-28", "2024-03-01")).toBe(2);
    expect(daysBetweenKeys("2026-03-28", "2026-03-30")).toBe(2); // spring forward
    expect(daysBetweenKeys("2026-10-24", "2026-10-26")).toBe(2); // fall back
  });
});

describe("formatClock", () => {
  it("renders minutes-since-midnight as a zero-padded 24-hour clock", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(9)).toBe("00:09");
    expect(formatClock(90)).toBe("01:30");
    expect(formatClock(720)).toBe("12:00");
    expect(formatClock(1439)).toBe("23:59");
  });

  // CAL §5 puts a 12-hour clock behind a device preference, and this function
  // is what serializes `startAt`/`endAt` and fills the time fields — so it
  // must stay 24-hour regardless of what the labels read. `formatClockLabel`
  // (calendarPrefs) is the one that follows the preference.
  it("is a serializer, so `LAST_MINUTE_OF_DAY` round-trips as the day's last time", () => {
    expect(formatClock(LAST_MINUTE_OF_DAY)).toBe("23:59");
  });
});

describe("parseClock", () => {
  it("is formatClock's inverse across the whole day", () => {
    for (let minutes = 0; minutes <= LAST_MINUTE_OF_DAY; minutes += 1) {
      expect(parseClock(formatClock(minutes)), String(minutes)).toBe(minutes);
    }
  });

  it("accepts the un-padded hour a hand-typed value can carry", () => {
    expect(parseClock("9:05")).toBe(9 * 60 + 5);
  });

  it("returns null for anything that is not a time of day", () => {
    for (const value of ["", "  ", "9", "09:5", "24:00", "23:60", "12:00:00", "1200", "aa:bb"]) {
      expect(parseClock(value), JSON.stringify(value)).toBeNull();
    }
  });
});

// --- Source selection ---------------------------------------------------------

describe("buildCalendarItems — source selection", () => {
  const rows: Partial<CalendarSourceRows> = {
    events: [makeEvent({ id: "e1", startAt: "2026-07-10T09:00:00.000Z" })],
    tasks: [makeTask({ id: "t1", dueDate: "2026-07-10" })],
    exams: [makeExam({ id: "x1", subjectId: "s1", examDate: "2026-07-10" })],
    blocks: [makeBlock({ id: "b1", examId: "x1", blockDate: "2026-07-09" })],
    subjects: [makeSubject("s1")],
    people: [makePerson({ id: "p1", month: 7, day: 10 })],
    overlay: [makeOverlay({ id: "f1", startAt: "2026-07-10T11:00" })],
    renewals: [
      {
        recurringId: "r1",
        date: "2026-07-05",
        name: "Netflix",
        accountId: "a1",
        currency: "RSD",
        categoryId: null,
        amount: -11_90,
      },
    ],
  };

  it("builds only the requested sources", () => {
    expect(build(rows, []).map((item) => item.source)).toEqual([]);
    expect(build(rows, ["tasks"]).map((item) => item.source)).toEqual(["tasks"]);
    expect(new Set(build(rows).map((item) => item.source))).toEqual(new Set(CALENDAR_SOURCES));
  });

  it("appends new sources rather than slotting them in, so a stored toggle set keeps its meaning", () => {
    expect(CALENDAR_SOURCES).toEqual([
      "events",
      "tasks",
      "exams",
      "blocks",
      "birthdays",
      "overlay",
      "subscriptions",
    ]);
  });

  it("gives every item an id unique across sources", () => {
    const ids = build(rows).map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// --- Subscriptions (FIN slice d) ----------------------------------------------

describe("buildCalendarItems — subscription renewals", () => {
  const renewal = (date: string, recurringId = "r1") => ({
    recurringId,
    date,
    name: "Netflix",
    accountId: "a1",
    currency: "RSD",
    categoryId: null,
    amount: -11_90,
  });

  it("draws one all-day item per renewal, keyed by the day that separates them", () => {
    const items = build({ renewals: [renewal("2026-07-05"), renewal("2026-07-20")] }, [
      "subscriptions",
    ]);
    expect(items.map((item) => [item.id, item.startKey, item.startMinutes])).toEqual([
      ["subscription-r1@2026-07-05", "2026-07-05", null],
      ["subscription-r1@2026-07-20", "2026-07-20", null],
    ]);
    expect(items.every((item) => item.kind === "subscription")).toBe(true);
  });

  it("carries the renewal itself, amount and currency included — the row has no other source for them", () => {
    const [item] = build({ renewals: [renewal("2026-07-05")] }, ["subscriptions"]);
    expect(item?.kind === "subscription" ? item.renewal : null).toEqual(renewal("2026-07-05"));
  });

  it("skips a malformed day rather than throwing — one bad row never costs the calendar", () => {
    expect(build({ renewals: [renewal("juli")] }, ["subscriptions"])).toEqual([]);
  });

  it("contributes nothing while its chip is off", () => {
    expect(build({ renewals: [renewal("2026-07-05")] }, ["events"])).toEqual([]);
  });

  it("takes main's rows verbatim — the range bounds the EXPANSION, which already happened", () => {
    // Main answered for the visible range; this builder never re-filters, the
    // same contract the overlay's rows arrive under.
    const items = build({ renewals: [renewal("2027-01-05")] }, ["subscriptions"]);
    expect(items).toHaveLength(1);
  });
});

// --- Events -------------------------------------------------------------------

describe("buildCalendarItems — one-off events", () => {
  it("reads a single-day timed event's minutes off the stored strings, and sorts on the raw instant", () => {
    const event = makeEvent({
      id: "e1",
      startAt: "2026-07-10T09:15:00.000Z",
      endAt: "2026-07-10T10:45:00.000Z",
    });
    const [item] = build({ events: [event] }, ["events"]);

    expect(item).toMatchObject({
      id: "event-e1",
      source: "events",
      kind: "event",
      startKey: "2026-07-10",
      endKey: "2026-07-10",
      startMinutes: 9 * 60 + 15,
      endMinutes: 10 * 60 + 45,
      sortKey: "2026-07-10T09:15:00.000Z",
      occurrence: null,
    });
  });

  it("gives an all-day event no minutes and sorts it on the bare day", () => {
    const [item] = build(
      { events: [makeEvent({ id: "e1", startAt: "2026-07-10T09:15:00.000Z", allDay: true })] },
      ["events"],
    );
    expect(item).toMatchObject({ startMinutes: null, endMinutes: null, sortKey: "2026-07-10" });
  });

  it("keeps a multi-day span but drops the end minutes — they belong to another day", () => {
    const [item] = build(
      {
        events: [
          makeEvent({
            id: "e1",
            startAt: "2026-07-10T09:00:00.000Z",
            endAt: "2026-07-12T17:00:00.000Z",
          }),
        ],
      },
      ["events"],
    );
    expect(item).toMatchObject({
      startKey: "2026-07-10",
      endKey: "2026-07-12",
      startMinutes: 540,
      endMinutes: null,
    });
  });

  it("collapses a missing, malformed or backwards end to a single-day span", () => {
    const cases: readonly (string | null)[] = [null, "garbage", "2026-07-08T10:00:00.000Z"];
    for (const endAt of cases) {
      const [item] = build(
        { events: [makeEvent({ id: "e1", startAt: "2026-07-10T09:00:00.000Z", endAt })] },
        ["events"],
      );
      expect(item?.endKey, String(endAt)).toBe("2026-07-10");
    }
  });

  it("drops an event whose start is not a usable day rather than feeding it to the grid math", () => {
    expect(build({ events: [makeEvent({ id: "e1", startAt: "not-a-date" })] }, ["events"])).toEqual([]);
    expect(build({ events: [makeEvent({ id: "e1", startAt: "" })] }, ["events"])).toEqual([]);
  });

  it("nulls a start time it cannot parse instead of producing NaN minutes", () => {
    const [item] = build({ events: [makeEvent({ id: "e1", startAt: "2026-07-10" })] }, ["events"]);
    expect(item?.startMinutes).toBeNull();

    const [outOfRange] = build(
      { events: [makeEvent({ id: "e2", startAt: "2026-07-10T99:99:00.000Z" })] },
      ["events"],
    );
    expect(outOfRange?.startMinutes).toBeNull();
  });
});

describe("buildCalendarItems — recurring events (ADR-024)", () => {
  const master = makeEvent({
    id: "e-rec",
    startAt: "2026-07-01T09:00:00.000Z",
    recurrence: { freq: { kind: "daily", interval: 2 }, end: { kind: "never" } },
  });

  it("expands one item per occurrence in the range, each keyed by its own day", () => {
    const items = build({ events: [master] }, ["events"], { from: "2026-07-01", to: "2026-07-06" });
    expect(items.map((item) => item.id)).toEqual([
      "event-e-rec@2026-07-01",
      "event-e-rec@2026-07-03",
      "event-e-rec@2026-07-05",
    ]);
    expect(items.map((item) => item.startKey)).toEqual([
      "2026-07-01",
      "2026-07-03",
      "2026-07-05",
    ]);
  });

  it("shifts the day parts only — the time of day rides along untouched", () => {
    const [, second] = build({ events: [master] }, ["events"], {
      from: "2026-07-01",
      to: "2026-07-06",
    });
    expect(second).toMatchObject({ startMinutes: 540, sortKey: "2026-07-03T09:00:00.000Z" });
    if (second?.kind !== "event") throw new Error("Test setup: expected an event item.");
    expect(second.event.startAt).toBe("2026-07-03T09:00:00.000Z");
  });

  it("carries the stored master alongside every occurrence, by reference", () => {
    const items = build({ events: [master] }, ["events"], { from: "2026-07-01", to: "2026-07-06" });
    for (const item of items) {
      if (item.kind !== "event") throw new Error("Test setup: expected an event item.");
      expect(item.occurrence?.master).toBe(master);
      expect(item.occurrence?.date).toBe(item.startKey);
    }
  });

  it("keeps a multi-day series as long as its master, both endpoints moving together", () => {
    const multiDay = makeEvent({
      id: "e-span",
      startAt: "2026-07-01T09:00:00.000Z",
      endAt: "2026-07-02T17:00:00.000Z",
      recurrence: { freq: { kind: "daily", interval: 3 }, end: { kind: "never" } },
    });
    const [, second] = build({ events: [multiDay] }, ["events"], {
      from: "2026-07-01",
      to: "2026-07-07",
    });
    expect(second).toMatchObject({ startKey: "2026-07-04", endKey: "2026-07-05" });
  });

  it("skips an excluded occurrence and nothing else", () => {
    const withExdate: Event = { ...master, recurrenceExdates: ["2026-07-03"] };
    const items = build({ events: [withExdate] }, ["events"], {
      from: "2026-07-01",
      to: "2026-07-06",
    });
    expect(items.map((item) => item.startKey)).toEqual(["2026-07-01", "2026-07-05"]);
  });

  it("honours a count end, and produces nothing when the range precedes the series", () => {
    const bounded: Event = {
      ...master,
      recurrence: { freq: { kind: "daily", interval: 2 }, end: { kind: "count", total: 2 } },
    };
    expect(
      build({ events: [bounded] }, ["events"], { from: "2026-07-01", to: "2026-07-31" }).map(
        (item) => item.startKey,
      ),
    ).toEqual(["2026-07-01", "2026-07-03"]);
    expect(build({ events: [master] }, ["events"], { from: "2026-06-01", to: "2026-06-30" })).toEqual(
      [],
    );
  });

  it("falls back to showing the master as a one-off when the range is unusable", () => {
    const items = build({ events: [master] }, ["events"], { from: "nope", to: "2026-07-31" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "event-e-rec", occurrence: null, startKey: "2026-07-01" });
  });

  it("leaves a one-off event untouched however far outside the range it falls", () => {
    const items = build(
      { events: [makeEvent({ id: "e1", startAt: "2030-01-01T09:00:00.000Z" })] },
      ["events"],
      JULY,
    );
    expect(items.map((item) => item.id)).toEqual(["event-e1"]);
  });
});

// --- Tasks, exams, blocks -----------------------------------------------------

describe("buildCalendarItems — tasks", () => {
  it("keeps a dated task, done or not, as a day-granular item", () => {
    const items = build(
      {
        tasks: [
          makeTask({ id: "t1", dueDate: "2026-07-10" }),
          makeTask({ id: "t2", dueDate: "2026-07-11", done: true, status: "done" }),
        ],
      },
      ["tasks"],
    );
    expect(items.map((item) => item.id)).toEqual(["task-t1", "task-t2"]);
    expect(items.every((item) => item.startMinutes === null && item.sortKey === item.startKey)).toBe(
      true,
    );
  });

  it("skips an undated task and one whose due date is not a usable day", () => {
    expect(
      build({ tasks: [makeTask({ id: "t1" }), makeTask({ id: "t2", dueDate: "garbage" })] }, [
        "tasks",
      ]),
    ).toEqual([]);
  });
});

describe("buildCalendarItems — exams and study blocks", () => {
  const subject = makeSubject("s1");
  const exam = makeExam({ id: "x1", subjectId: "s1", examDate: "2026-07-10" });

  it("joins an exam to its subject and a block to its exam's subject", () => {
    const items = build(
      {
        exams: [exam],
        blocks: [makeBlock({ id: "b1", examId: "x1", blockDate: "2026-07-09" })],
        subjects: [subject],
      },
      ["exams", "blocks"],
    );
    expect(items.map((item) => item.id)).toEqual(["exam-x1", "block-b1"]);
    for (const item of items) {
      if (item.kind !== "exam" && item.kind !== "block") throw new Error("Test setup: wrong kind.");
      expect(item.subject).toBe(subject);
    }
  });

  it("skips an exam whose subject is gone, and a block whose exam or subject is gone", () => {
    expect(build({ exams: [exam] }, ["exams"])).toEqual([]);
    expect(
      build({ blocks: [makeBlock({ id: "b1", examId: "x1", blockDate: "2026-07-09" })] }, ["blocks"]),
    ).toEqual([]);
    expect(
      build(
        {
          exams: [exam],
          blocks: [makeBlock({ id: "b1", examId: "x1", blockDate: "2026-07-09" })],
        },
        ["blocks"],
      ),
    ).toEqual([]);
  });

  it("skips an exam or block whose own date is not a usable day", () => {
    expect(
      build(
        { exams: [makeExam({ id: "x2", subjectId: "s1", examDate: "garbage" })], subjects: [subject] },
        ["exams"],
      ),
    ).toEqual([]);
    expect(
      build(
        {
          exams: [exam],
          subjects: [subject],
          blocks: [makeBlock({ id: "b2", examId: "x1", blockDate: "garbage" })],
        },
        ["blocks"],
      ),
    ).toEqual([]);
  });
});

// --- Birthdays ----------------------------------------------------------------

describe("buildCalendarItems — birthdays (ADR-026)", () => {
  it("celebrates once per year of the range, keyed by person and day", () => {
    const items = build({ people: [makePerson({ id: "p1", month: 3, day: 14, year: 2000 })] }, [
      "birthdays",
    ], { from: "2026-01-01", to: "2027-12-31" });
    expect(items.map((item) => item.id)).toEqual(["person-p1@2026-03-14", "person-p1@2027-03-14"]);
    expect(items.map((item) => (item.kind === "birthday" ? item.age : null))).toEqual([26, 27]);
  });

  it("celebrates a 29 February person on the 28th in a non-leap year", () => {
    const items = build({ people: [makePerson({ id: "p1", month: 2, day: 29, year: 1992 })] }, [
      "birthdays",
    ], { from: "2026-01-01", to: "2028-12-31" });
    expect(items.map((item) => item.startKey)).toEqual([
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
  });

  it("reports no age when the year is unknown", () => {
    const [item] = build({ people: [makePerson({ id: "p1", month: 3, day: 14 })] }, ["birthdays"], {
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(item?.kind === "birthday" ? item.age : "not a birthday").toBeNull();
  });

  it("is all-day, spanning one day, and sorts on that day", () => {
    const [item] = build({ people: [makePerson({ id: "p1", month: 7, day: 10 })] }, ["birthdays"]);
    expect(item).toMatchObject({
      source: "birthdays",
      startKey: "2026-07-10",
      endKey: "2026-07-10",
      startMinutes: null,
      endMinutes: null,
      sortKey: "2026-07-10",
    });
  });

  it("shows nothing at all when the range is unusable — unlike an event, a person has no one-off reading", () => {
    expect(
      build({ people: [makePerson({ id: "p1", month: 7, day: 10 })] }, ["birthdays"], {
        from: "nope",
        to: "2026-12-31",
      }),
    ).toEqual([]);
  });
});

// --- Cross-profile overlay (CAL-005 / ADR-058 §5) -----------------------------

describe("buildCalendarItems — foreign overlay items", () => {
  it("derives keys and minutes exactly as for own events, prefixing the id with its source", () => {
    const [item] = build(
      {
        overlay: [
          makeOverlay({ id: "f1", startAt: "2026-07-10T09:15", endAt: "2026-07-10T10:45" }),
        ],
      },
      ["overlay"],
    );
    expect(item).toMatchObject({
      id: "foreign-f1@2026-07-10",
      source: "overlay",
      kind: "foreign",
      startKey: "2026-07-10",
      endKey: "2026-07-10",
      startMinutes: 9 * 60 + 15,
      endMinutes: 10 * 60 + 45,
      sortKey: "2026-07-10T09:15",
    });
  });

  it("keeps two occurrences of one foreign master apart by their day — main pre-expands series", () => {
    const items = build(
      {
        overlay: [
          makeOverlay({ id: "f1", startAt: "2026-07-06T09:00" }),
          makeOverlay({ id: "f1", startAt: "2026-07-13T09:00" }),
        ],
      },
      ["overlay"],
    );
    expect(items.map((item) => item.id)).toEqual([
      "foreign-f1@2026-07-06",
      "foreign-f1@2026-07-13",
    ]);
  });

  it("treats an all-day foreign row as day-granular and a multi-day one as a span", () => {
    const [allDay, span] = build(
      {
        overlay: [
          makeOverlay({ id: "f1", startAt: "2026-07-10", allDay: true }),
          makeOverlay({ id: "f2", startAt: "2026-07-12T09:00", endAt: "2026-07-14T10:00" }),
        ],
      },
      ["overlay"],
    );
    expect(allDay).toMatchObject({ startMinutes: null, endMinutes: null, sortKey: "2026-07-10" });
    expect(span).toMatchObject({ startKey: "2026-07-12", endKey: "2026-07-14", endMinutes: null });
    expect(isSpanItem(allDay as CalendarItem)).toBe(true);
    expect(isSpanItem(span as CalendarItem)).toBe(true);
  });

  it("drops a foreign row whose start is not a usable day, and collapses a backwards end", () => {
    expect(build({ overlay: [makeOverlay({ id: "f1", startAt: "garbage" })] }, ["overlay"])).toEqual(
      [],
    );
    const [item] = build(
      {
        overlay: [
          makeOverlay({ id: "f2", startAt: "2026-07-10T09:00", endAt: "2026-07-08T10:00" }),
        ],
      },
      ["overlay"],
    );
    expect(item?.endKey).toBe("2026-07-10");
  });

  it("contributes nothing while the overlay chip is off", () => {
    expect(
      build({ overlay: [makeOverlay({ id: "f1", startAt: "2026-07-10T09:00" })] }, ["events"]),
    ).toEqual([]);
  });
});

// --- Item predicates ----------------------------------------------------------

describe("isSpanItem / isTimedEventItem / isMutedItem", () => {
  function only(rows: Partial<CalendarSourceRows>, source: CalendarSource): CalendarItem {
    const [item] = build(rows, [source]);
    if (!item) throw new Error("Test setup: expected exactly one item.");
    return item;
  }

  const timed = () =>
    only({ events: [makeEvent({ id: "e1", startAt: "2026-07-10T09:00:00.000Z" })] }, "events");
  const allDay = () =>
    only(
      { events: [makeEvent({ id: "e2", startAt: "2026-07-10T09:00:00.000Z", allDay: true })] },
      "events",
    );
  const multiDay = () =>
    only(
      {
        events: [
          makeEvent({
            id: "e3",
            startAt: "2026-07-10T09:00:00.000Z",
            endAt: "2026-07-12T10:00:00.000Z",
          }),
        ],
      },
      "events",
    );

  it("treats a single-day timed event as the only non-span item", () => {
    expect(isSpanItem(timed())).toBe(false);
    expect(isSpanItem(allDay())).toBe(true);
    expect(isSpanItem(multiDay())).toBe(true);
    expect(isSpanItem(only({ tasks: [makeTask({ id: "t1", dueDate: "2026-07-10" })] }, "tasks"))).toBe(
      true,
    );
  });

  it("makes isTimedEventItem the exact complement of isSpanItem over the profile's OWN items", () => {
    for (const item of [
      timed(),
      allDay(),
      multiDay(),
      only({ tasks: [makeTask({ id: "t1", dueDate: "2026-07-10" })] }, "tasks"),
      only({ people: [makePerson({ id: "p1", month: 7, day: 10 })] }, "birthdays"),
    ]) {
      expect(isTimedEventItem(item), item.id).toBe(!isSpanItem(item));
    }
  });

  it("keeps foreign timed items in the hour grid WITHOUT the event affordances (CAL-005)", () => {
    const foreignTimed = only(
      { overlay: [makeOverlay({ id: "f1", startAt: "2026-07-10T09:00" })] },
      "overlay",
    );
    // In the hour grid's geometry, but never in its gestures: not a span, not
    // a TimedEventItem — the guard every drag/edit path narrows through.
    expect(isSpanItem(foreignTimed)).toBe(false);
    expect(isTimedEventItem(foreignTimed)).toBe(false);
    expect(isTimedForeignItem(foreignTimed)).toBe(true);
    // And a day-granular foreign row stays out of the hour grid entirely.
    const foreignAllDay = only(
      { overlay: [makeOverlay({ id: "f2", startAt: "2026-07-10", allDay: true })] },
      "overlay",
    );
    expect(isTimedForeignItem(foreignAllDay)).toBe(false);
  });

  it("quietens a done task and a missed block, and nothing else", () => {
    expect(isMutedItem(only({ tasks: [makeTask({ id: "t1", dueDate: "2026-07-10" })] }, "tasks"))).toBe(
      false,
    );
    expect(
      isMutedItem(
        only({ tasks: [makeTask({ id: "t2", dueDate: "2026-07-10", done: true })] }, "tasks"),
      ),
    ).toBe(true);

    const blockRows = (status: StudyBlockWithExam["status"]): Partial<CalendarSourceRows> => ({
      subjects: [makeSubject("s1")],
      exams: [makeExam({ id: "x1", subjectId: "s1", examDate: "2026-07-10" })],
      blocks: [makeBlock({ id: "b1", examId: "x1", blockDate: "2026-07-09", status })],
    });
    expect(isMutedItem(only(blockRows("planned"), "blocks"))).toBe(false);
    expect(isMutedItem(only(blockRows("done"), "blocks"))).toBe(false);
    expect(isMutedItem(only(blockRows("missed"), "blocks"))).toBe(true);
    expect(isMutedItem(timed())).toBe(false);
  });
});

// --- Stored source toggles ----------------------------------------------------

describe("readStoredSources / persistSources", () => {
  const KEY = `nexus.calendar.sources.${PROFILE}`;

  function stubStorage(seed: Readonly<Record<string, string>> = {}): Storage {
    const storage = memoryStorage(seed);
    vi.stubGlobal("localStorage", storage);
    return storage;
  }

  it("enables every source when nothing is stored", () => {
    stubStorage();
    expect(readStoredSources(PROFILE)).toEqual(new Set(CALENDAR_SOURCES));
  });

  it("reads an explicitly empty string as every source OFF — a choice, not a missing value", () => {
    stubStorage({ [KEY]: "" });
    expect(readStoredSources(PROFILE)).toEqual(new Set());
  });

  it("keeps exactly the sources a stored set names, ignoring unknown ones", () => {
    stubStorage({ [KEY]: "tasks,exams" });
    expect(readStoredSources(PROFILE)).toEqual(new Set(["tasks", "exams"]));

    // A set stored before `birthdays` existed keeps its meaning: the new source
    // starts off rather than being silently re-enabled.
    stubStorage({ [KEY]: "events,tasks,exams,blocks" });
    expect(readStoredSources(PROFILE)).toEqual(new Set(["events", "tasks", "exams", "blocks"]));

    // The same CAL-007 rule carries the overlay chip (CAL-005/ADR-058): a
    // profile that stored toggles before it existed starts it OFF, while a
    // fresh profile — nothing stored, the all-on default above — starts it ON.
    stubStorage({ [KEY]: "events,tasks,exams,blocks,birthdays" });
    expect(readStoredSources(PROFILE).has("overlay")).toBe(false);

    stubStorage({ [KEY]: "tasks,ufo" });
    expect(readStoredSources(PROFILE)).toEqual(new Set(["tasks"]));
  });

  it("falls back to every source when nothing stored is recognizable", () => {
    stubStorage({ [KEY]: "ufo,zeppelin" });
    expect(readStoredSources(PROFILE)).toEqual(new Set(CALENDAR_SOURCES));
  });

  it("writes in the canonical chip order, whatever order the set was built in", () => {
    const storage = stubStorage();
    persistSources(PROFILE, new Set<CalendarSource>(["birthdays", "events", "exams"]));
    expect(storage.getItem(KEY)).toBe("events,exams,birthdays");
  });

  it("round-trips every subset, including the empty one", () => {
    const storage = stubStorage();
    for (const subset of [
      [],
      ["tasks"],
      ["events", "birthdays"],
      [...CALENDAR_SOURCES],
    ] as readonly CalendarSource[][]) {
      persistSources(PROFILE, new Set(subset));
      expect(readStoredSources(PROFILE), subset.join("|")).toEqual(new Set(subset));
    }
    expect(storage.getItem(KEY)).toBe(CALENDAR_SOURCES.join(","));
  });

  it("scopes the key per profile — two profiles never share a toggle set", () => {
    const storage = stubStorage();
    persistSources("profile-a", new Set<CalendarSource>(["tasks"]));
    persistSources("profile-b", new Set<CalendarSource>(["events"]));
    expect(readStoredSources("profile-a")).toEqual(new Set(["tasks"]));
    expect(readStoredSources("profile-b")).toEqual(new Set(["events"]));
    expect(storage.getItem("nexus.calendar.sources.profile-a")).toBe("tasks");
  });
});
