import { describe, expect, it } from "vitest";
import { buildIcsCalendar, type IcsEvent } from "./icsExport.js";

const NOW = "2026-07-31T10:15:30.500Z";
const STAMP = "20260731T101530Z";
const HEADER = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nexus//Nexus Desktop//SR", "CALSCALE:GREGORIAN"];

/** One event with every field at its emptiest, so a test names only what it is about. */
function event(overrides: Partial<IcsEvent> & { id: string }): IcsEvent {
  return {
    title: "Sastanak",
    description: null,
    startAt: "2026-07-15",
    endAt: null,
    allDay: true,
    location: null,
    category: null,
    recurrence: null,
    recurrenceExdates: [],
    ...overrides,
  };
}

function build(events: readonly IcsEvent[], now: string = NOW) {
  return buildIcsCalendar(events, { now });
}

/** RFC 5545 unfolding: a CRLF followed by one space is not a line break at all. */
function unfold(text: string): string[] {
  return text.replace(/\r\n /g, "").split("\r\n");
}

/** Every content line of the file, unfolded, with the trailing empty string the final CRLF leaves. */
function lines(text: string): string[] {
  const all = unfold(text);
  expect(all.at(-1)).toBe("");
  return all.slice(0, -1);
}

/** The one line whose property name is `name`; fails loudly when a test asks for a property that was not emitted. */
function property(text: string, name: string): string {
  const found = lines(text).filter((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));
  expect(found).toHaveLength(1);
  return found[0] ?? "";
}

function has(text: string, name: string): boolean {
  return lines(text).some((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`));
}

function octets(line: string): number {
  return new TextEncoder().encode(line).length;
}

describe("buildIcsCalendar — the file itself", () => {
  it("wraps an empty calendar in the RFC 5545 header and footer, CRLF throughout", () => {
    expect(build([]).text).toBe(
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Nexus//Nexus Desktop//SR\r\nCALSCALE:GREGORIAN\r\nEND:VCALENDAR\r\n",
    );
  });

  it("contains no bare LF and no bare CR anywhere", () => {
    const { text } = build([
      event({ id: "ev-1", title: "Prva\nlinija", description: "a\r\nb", startAt: "2026-07-15T09:30", allDay: false }),
    ]);
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("pins a whole all-day file, property by property, in order", () => {
    const { text } = build([event({ id: "ev-1", title: "Rođendan" })]);
    expect(lines(text)).toEqual([
      ...HEADER,
      "BEGIN:VEVENT",
      "UID:ev-1@nexus.stojiljkovic.rs",
      `DTSTAMP:${STAMP}`,
      "DTSTART;VALUE=DATE:20260715",
      "DTEND;VALUE=DATE:20260716",
      "SUMMARY:Rođendan",
      "END:VEVENT",
      "END:VCALENDAR",
    ]);
  });

  it("pins a whole timed file", () => {
    const { text } = build([
      event({
        id: "ev-1",
        title: "Sastanak",
        startAt: "2026-07-15T09:30",
        endAt: "2026-07-15T10:45",
        allDay: false,
        description: "Kod dekana",
        location: "RAF, sala 3",
        category: "posao",
      }),
    ]);
    expect(lines(text)).toEqual([
      ...HEADER,
      "BEGIN:VEVENT",
      "UID:ev-1@nexus.stojiljkovic.rs",
      `DTSTAMP:${STAMP}`,
      "DTSTART:20260715T093000",
      "DTEND:20260715T104500",
      "SUMMARY:Sastanak",
      "DESCRIPTION:Kod dekana",
      "LOCATION:RAF\\, sala 3",
      "CATEGORIES:posao",
      "END:VEVENT",
      "END:VCALENDAR",
    ]);
  });

  it("never reads a clock — DTSTAMP is exactly the caller's `now`, to the second, in UTC", () => {
    expect(property(build([event({ id: "ev-1" })], "2026-01-02T03:04:05Z").text, "DTSTAMP")).toBe(
      "DTSTAMP:20260102T030405Z",
    );
    // A zoned instant is the same moment, so it stamps as that moment in UTC.
    expect(property(build([event({ id: "ev-1" })], "2026-01-02T03:04:05+02:00").text, "DTSTAMP")).toBe(
      "DTSTAMP:20260102T010405Z",
    );
  });

  it("refuses a `now` that is not an instant at all — a programmer error, like the recurrence engine's", () => {
    expect(() => build([], "juče")).toThrow(TypeError);
  });

  it("orders events by start then id, whatever order the caller passed them in", () => {
    const { text } = build([
      event({ id: "b", startAt: "2026-07-15T09:00", allDay: false }),
      event({ id: "c", startAt: "2026-07-14" }),
      event({ id: "a", startAt: "2026-07-15T09:00", allDay: false }),
    ]);
    expect(lines(text).filter((line) => line.startsWith("UID:"))).toEqual([
      "UID:c@nexus.stojiljkovic.rs",
      "UID:a@nexus.stojiljkovic.rs",
      "UID:b@nexus.stojiljkovic.rs",
    ]);
  });

  it("is deterministic: the same input yields byte-identical text", () => {
    const events = [
      event({ id: "ev-1", startAt: "2026-07-15T09:30", allDay: false, recurrence: { freq: { kind: "weekly", interval: 2, days: [4, 0] }, end: { kind: "count", total: 6 } }, recurrenceExdates: ["2026-07-27", "2026-07-20"] }),
      event({ id: "ev-2" }),
    ];
    expect(build(events).text).toBe(build([...events].reverse()).text);
  });
});

describe("buildIcsCalendar — all-day vs timed", () => {
  it("gives a single-day all-day event an EXCLUSIVE DTEND of the following day", () => {
    const { text } = build([event({ id: "ev-1", startAt: "2026-02-28" })]);
    expect(property(text, "DTSTART")).toBe("DTSTART;VALUE=DATE:20260228");
    expect(property(text, "DTEND")).toBe("DTEND;VALUE=DATE:20260301");
  });

  it("turns a multi-day all-day event's INCLUSIVE last day into the exclusive DTEND", () => {
    const { text } = build([event({ id: "ev-1", startAt: "2026-07-15", endAt: "2026-07-17" })]);
    expect(property(text, "DTEND")).toBe("DTEND;VALUE=DATE:20260718");
  });

  it("emits a timed start as a floating local date-time — no Z, no TZID", () => {
    const { text } = build([event({ id: "ev-1", startAt: "2026-07-15T09:30", allDay: false })]);
    expect(property(text, "DTSTART")).toBe("DTSTART:20260715T093000");
  });

  it("carries seconds when the stored value has them", () => {
    const { text } = build([event({ id: "ev-1", startAt: "2026-07-15T09:30:45", allDay: false })]);
    expect(property(text, "DTSTART")).toBe("DTSTART:20260715T093045");
  });

  it("omits DTEND for a timed event with no end", () => {
    const { text } = build([event({ id: "ev-1", startAt: "2026-07-15T09:30", allDay: false })]);
    expect(has(text, "DTEND")).toBe(false);
  });

  it("omits a DTEND that is not strictly later than DTSTART, as the RFC requires", () => {
    const { text } = build([
      event({ id: "ev-1", startAt: "2026-07-15T09:30", endAt: "2026-07-15T09:30", allDay: false }),
    ]);
    expect(has(text, "DTEND")).toBe(false);
  });

  it("spans midnight when the end lands on the next day", () => {
    const { text } = build([
      event({ id: "ev-1", startAt: "2026-07-15T23:30", endAt: "2026-07-16T00:30", allDay: false }),
    ]);
    expect(property(text, "DTEND")).toBe("DTEND:20260716T003000");
  });

  it("reads a timed row that carries no time of day as the DATE it actually is", () => {
    const { text } = build([event({ id: "ev-1", startAt: "2026-07-15", allDay: false })]);
    expect(property(text, "DTSTART")).toBe("DTSTART;VALUE=DATE:20260715");
  });

  it("refuses an event whose start is not a real calendar day, BY NAME, and emits nothing for it", () => {
    const result = build([event({ id: "ev-bad", startAt: "2026-02-30" }), event({ id: "ev-ok" })]);
    expect(result.skipped).toEqual([{ id: "ev-bad", reason: "invalid-start" }]);
    expect(result.text).not.toContain("ev-bad");
    expect(result.text).toContain("ev-ok");
  });
});

describe("buildIcsCalendar — escaping (RFC 5545 §3.3.11)", () => {
  it("escapes backslash, semicolon and comma, and turns every newline into \\n", () => {
    const { text } = build([
      event({ id: "ev-1", title: "C:\\Users; pola, pola\nnovi red", description: "prvi\r\ndrugi\rtreći" }),
    ]);
    expect(property(text, "SUMMARY")).toBe("SUMMARY:C:\\\\Users\\; pola\\, pola\\nnovi red");
    expect(property(text, "DESCRIPTION")).toBe("DESCRIPTION:prvi\\ndrugi\\ntreći");
  });

  it("drops control characters the TEXT grammar has no room for", () => {
    const { text } = build([event({ id: "ev-1", title: "pre\u0007post" })]);
    expect(property(text, "SUMMARY")).toBe("SUMMARY:prepost");
  });

  it("escapes the UID too, so an id can never break the line grammar", () => {
    const { text } = build([event({ id: "a;b" })]);
    expect(property(text, "UID")).toBe("UID:a\\;b@nexus.stojiljkovic.rs");
  });

  it("omits DESCRIPTION, LOCATION and CATEGORIES when they are null or blank", () => {
    const { text } = build([event({ id: "ev-1", description: "   ", location: null, category: "" })]);
    expect(has(text, "DESCRIPTION")).toBe(false);
    expect(has(text, "LOCATION")).toBe(false);
    expect(has(text, "CATEGORIES")).toBe(false);
  });
});

describe("buildIcsCalendar — line folding (RFC 5545 §3.1)", () => {
  it("keeps every line at or below 75 OCTETS, counting a Serbian summary's multi-byte letters", () => {
    // 60 two-octet letters = 120 octets of content behind an 8-octet name.
    const { text } = build([event({ id: "ev-1", title: "č".repeat(60) })]);
    for (const line of text.split("\r\n")) expect(octets(line)).toBeLessThanOrEqual(75);
  });

  it("folds with CRLF + exactly one space, and unfolds back to the original value", () => {
    const title = "Čćšđž ".repeat(30).trim();
    const { text } = build([event({ id: "ev-1", title })]);
    expect(text).toContain("\r\n ");
    expect(property(text, "SUMMARY")).toBe(`SUMMARY:${title}`);
  });

  it("never splits a multi-byte character across a fold", () => {
    // A 3-octet letter placed so a naive 75-BYTE cut would land inside it.
    const { text } = build([event({ id: "ev-1", title: `${"a".repeat(66)}\u4e2d${"b".repeat(20)}` })]);
    for (const line of text.split("\r\n")) expect(octets(line)).toBeLessThanOrEqual(75);
    expect(property(text, "SUMMARY")).toBe(`SUMMARY:${"a".repeat(66)}\u4e2d${"b".repeat(20)}`);
    expect(text).not.toContain("\uFFFD");
  });

  it("folds a 4-octet astral character whole", () => {
    const { text } = build([event({ id: "ev-1", title: `${"a".repeat(70)}\u{1f600}x` })]);
    for (const line of text.split("\r\n")) expect(octets(line)).toBeLessThanOrEqual(75);
    expect(property(text, "SUMMARY")).toBe(`SUMMARY:${"a".repeat(70)}\u{1f600}x`);
  });

  it("leaves a line that exactly fills 75 octets unfolded", () => {
    // "SUMMARY:" is 8 octets, so 67 ASCII letters make the line exactly 75.
    const { text } = build([event({ id: "ev-1", title: "a".repeat(67) })]);
    expect(text).toContain(`\r\nSUMMARY:${"a".repeat(67)}\r\n`);
  });
});

describe("buildIcsCalendar — RRULE", () => {
  function rruleOf(recurrence: IcsEvent["recurrence"], overrides: Partial<IcsEvent> = {}): string {
    const { text } = build([event({ id: "ev-1", recurrence, ...overrides })]);
    return property(text, "RRULE").slice("RRULE:".length);
  }

  it("maps every rule kind", () => {
    // The anchor is a Wednesday (weekday index 2) so no rule below leaves
    // DTSTART outside its own pattern; that case has its own test.
    const anchor = { startAt: "2026-07-15" };
    expect(rruleOf({ freq: { kind: "daily", interval: 1 }, end: { kind: "never" } }, anchor)).toBe("FREQ=DAILY");
    expect(rruleOf({ freq: { kind: "weekdays" }, end: { kind: "never" } }, anchor)).toBe(
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    );
    expect(rruleOf({ freq: { kind: "weekly", interval: 1, days: [2, 4] }, end: { kind: "never" } }, anchor)).toBe(
      "FREQ=WEEKLY;BYDAY=WE,FR",
    );
    expect(rruleOf({ freq: { kind: "monthly-date", interval: 1, day: 15 }, end: { kind: "never" } }, anchor)).toBe(
      "FREQ=MONTHLY;BYMONTHDAY=15",
    );
    expect(
      rruleOf({ freq: { kind: "monthly-ordinal", interval: 1, ordinal: 3, weekday: 2 }, end: { kind: "never" } }, anchor),
    ).toBe("FREQ=MONTHLY;BYDAY=3WE");
    expect(
      rruleOf({ freq: { kind: "monthly-ordinal", interval: 1, ordinal: -1, weekday: 4 }, end: { kind: "never" } }, { startAt: "2026-07-31" }),
    ).toBe("FREQ=MONTHLY;BYDAY=-1FR");
    expect(rruleOf({ freq: { kind: "yearly", interval: 1 }, end: { kind: "never" } }, anchor)).toBe("FREQ=YEARLY");
  });

  it("emits INTERVAL only when it is greater than one", () => {
    expect(rruleOf({ freq: { kind: "daily", interval: 3 }, end: { kind: "never" } })).toBe("FREQ=DAILY;INTERVAL=3");
    expect(rruleOf({ freq: { kind: "yearly", interval: 2 }, end: { kind: "never" } })).toBe("FREQ=YEARLY;INTERVAL=2");
    expect(
      rruleOf({ freq: { kind: "weekly", interval: 2, days: [2] }, end: { kind: "never" } }, { startAt: "2026-07-15" }),
    ).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=WE");
  });

  it("writes the weekday list in canonical Monday-first order, deduplicated", () => {
    expect(
      rruleOf({ freq: { kind: "weekly", interval: 1, days: [6, 2, 6, 0] }, end: { kind: "never" } }, { startAt: "2026-07-15" }),
    ).toBe("FREQ=WEEKLY;BYDAY=MO,WE,SU");
  });

  it("ends a series the three ways the rule model can: never, count, until", () => {
    expect(rruleOf({ freq: { kind: "daily", interval: 1 }, end: { kind: "never" } })).toBe("FREQ=DAILY");
    expect(rruleOf({ freq: { kind: "daily", interval: 1 }, end: { kind: "count", total: 10 } })).toBe(
      "FREQ=DAILY;COUNT=10",
    );
    expect(rruleOf({ freq: { kind: "daily", interval: 1 }, end: { kind: "until", date: "2026-08-31" } })).toBe(
      "FREQ=DAILY;UNTIL=20260831",
    );
  });

  it("matches UNTIL's value type to DTSTART's, as the RFC requires", () => {
    // Timed DTSTART is a date with LOCAL time, so UNTIL must be one too — and
    // it covers the whole inclusive last day the rule model means.
    expect(
      rruleOf(
        { freq: { kind: "daily", interval: 1 }, end: { kind: "until", date: "2026-08-31" } },
        { startAt: "2026-07-15T09:30", allDay: false },
      ),
    ).toBe("FREQ=DAILY;UNTIL=20260831T235959");
  });

  it("drops an UNTIL that is not a real calendar day rather than writing a bad one", () => {
    expect(rruleOf({ freq: { kind: "daily", interval: 1 }, end: { kind: "until", date: "2026-02-30" } })).toBe(
      "FREQ=DAILY",
    );
  });

  it("emits no RRULE at all for a one-off", () => {
    expect(has(build([event({ id: "ev-1" })]).text, "RRULE")).toBe(false);
  });
});

describe("buildIcsCalendar — EXDATE", () => {
  it("writes exdates as DATEs for an all-day series, sorted and deduplicated", () => {
    const { text } = build([
      event({
        id: "ev-1",
        startAt: "2026-07-15",
        recurrence: { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } },
        recurrenceExdates: ["2026-07-20", "2026-07-17", "2026-07-20"],
      }),
    ]);
    expect(property(text, "EXDATE")).toBe("EXDATE;VALUE=DATE:20260717,20260720");
  });

  it("writes exdates at the series' own time of day for a timed series", () => {
    const { text } = build([
      event({
        id: "ev-1",
        startAt: "2026-07-15T09:30",
        allDay: false,
        recurrence: { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } },
        recurrenceExdates: ["2026-07-17"],
      }),
    ]);
    expect(property(text, "EXDATE")).toBe("EXDATE:20260717T093000");
  });

  it("ignores an exdate that is not a real calendar day", () => {
    const { text } = build([
      event({
        id: "ev-1",
        recurrence: { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } },
        recurrenceExdates: ["2026-02-30"],
      }),
    ]);
    expect(has(text, "EXDATE")).toBe(false);
  });

  it("carries no EXDATE for a one-off, even if the row somehow holds dates", () => {
    const { text } = build([event({ id: "ev-1", recurrenceExdates: ["2026-07-17"] })]);
    expect(has(text, "EXDATE")).toBe(false);
  });

  it("excludes DTSTART's own day when the rule does not place an occurrence there", () => {
    // 2026-07-15 is a Wednesday; the series runs Mondays only, so Nexus's own
    // engine never yields the anchor — but every ICS consumer would show
    // DTSTART regardless unless it is excluded outright.
    const { text } = build([
      event({
        id: "ev-1",
        startAt: "2026-07-15",
        recurrence: { freq: { kind: "weekly", interval: 1, days: [0] }, end: { kind: "never" } },
      }),
    ]);
    expect(property(text, "EXDATE")).toBe("EXDATE;VALUE=DATE:20260715");
  });

  it("leaves DTSTART's day alone when the rule does place an occurrence there", () => {
    const { text } = build([
      event({
        id: "ev-1",
        startAt: "2026-07-15",
        recurrence: { freq: { kind: "weekly", interval: 1, days: [2] }, end: { kind: "never" } },
      }),
    ]);
    expect(has(text, "EXDATE")).toBe(false);
  });

  it("folds a long EXDATE list instead of writing an over-long line", () => {
    const exdates = Array.from({ length: 12 }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);
    const { text } = build([
      event({
        id: "ev-1",
        startAt: "2026-07-15",
        recurrence: { freq: { kind: "daily", interval: 1 }, end: { kind: "never" } },
        recurrenceExdates: exdates,
      }),
    ]);
    for (const line of text.split("\r\n")) expect(octets(line)).toBeLessThanOrEqual(75);
    expect(property(text, "EXDATE")).toBe(
      `EXDATE;VALUE=DATE:${exdates.map((day) => day.replace(/-/g, "")).join(",")}`,
    );
  });
});
