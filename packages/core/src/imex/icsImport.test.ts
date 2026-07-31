import { describe, expect, it } from "vitest";
import { buildIcsCalendar, type IcsEvent } from "./icsExport.js";
import {
  ICS_IMPORT_SKIP_CODES,
  parseIcsCalendar,
  translateIcsEvents,
  type IcsImportSkipCode,
  type IcsParsedCalendar,
  type IcsParsedEvent,
} from "./icsImport.js";

const CRLF = "\r\n";

/** One file around the given content lines — the wrapper every VEVENT test needs and none is about. */
function calendar(lines: readonly string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Test//SR", ...lines, "END:VCALENDAR", ""].join(
    CRLF,
  );
}

/** One VEVENT with the boilerplate an exporter always writes and no test is about. */
function vevent(lines: readonly string[]): string[] {
  return ["BEGIN:VEVENT", "UID:test@example.org", "DTSTAMP:20260731T000000Z", ...lines, "END:VEVENT"];
}

function parseOk(text: string): IcsParsedCalendar {
  const result = parseIcsCalendar(text);
  if (result.status !== "ok") throw new Error(`Expected an ok parse, got ${result.code}.`);
  return result.calendar;
}

/** The single event a test's file carries; fails loudly when the parse refused it. */
function only(text: string): IcsParsedEvent {
  const parsed = parseOk(text);
  expect(parsed.events).toHaveLength(1);
  const event = parsed.events[0];
  if (event === undefined) throw new Error("unreachable");
  return event;
}

function skipsOf(parsed: IcsParsedCalendar): Partial<Record<IcsImportSkipCode, number>> {
  return Object.fromEntries(parsed.skips.map((skip) => [skip.code, skip.count]));
}

function componentsOf(parsed: IcsParsedCalendar): Record<string, number> {
  return Object.fromEntries(parsed.components.map((component) => [component.name, component.count]));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The machine's own local wall clock at instant `ms` — the test-side statement
 * of what "convert to the local wall clock" MEANS, written over the local
 * `Date` getters so the expectation holds on any machine in any zone.
 */
function localWallClock(ms: number): string {
  const at = new Date(ms);
  const base = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return at.getSeconds() === 0 ? base : `${base}:${pad(at.getSeconds())}`;
}

describe("parseIcsCalendar — the file itself", () => {
  it("refuses text with no VCALENDAR in it, by code", () => {
    expect(parseIcsCalendar("")).toEqual({ status: "failed", code: "not-a-calendar" });
    expect(parseIcsCalendar("ovo nije kalendar")).toEqual({
      status: "failed",
      code: "not-a-calendar",
    });
  });

  it("reads an empty calendar as zero events, zero skips", () => {
    const parsed = parseOk(calendar([]));
    expect(parsed).toEqual({ sourceEvents: 0, events: [], components: [], skips: [] });
  });

  it("accepts bare LF where the RFC writes CRLF", () => {
    const crlf = calendar(vevent(["SUMMARY:Sastanak", "DTSTART:20260715T093000"]));
    const lf = crlf.replace(/\r\n/g, "\n");
    expect(parseOk(lf)).toEqual(parseOk(crlf));
  });

  it("strips a leading BOM rather than reading it into the first property name", () => {
    const text = `\uFEFF${calendar(vevent(["SUMMARY:Sastanak", "DTSTART:20260715"]))}`;
    expect(parseOk(text).events).toHaveLength(1);
  });

  it("unfolds a folded line, whether the continuation begins with a space or a tab", () => {
    const spaceFolded = calendar(vevent(["SUMMARY:Sasta", " nak", "DTSTART:20260715"]));
    const tabFolded = calendar(vevent(["SUMMARY:Sasta", "\tnak", "DTSTART:20260715"]));
    expect(only(spaceFolded).title).toBe("Sastanak");
    expect(only(tabFolded).title).toBe("Sastanak");
  });

  it("round-trips the export's own folding of a multi-byte Serbian summary", () => {
    const title = "Čas čitanja ćiriličnih šifara u đačkoj čitaonici — ".repeat(4).trim();
    const exported = buildIcsCalendar(
      [
        {
          id: "fold-1",
          title,
          description: null,
          startAt: "2026-07-15T09:30",
          endAt: null,
          allDay: false,
          location: null,
          category: null,
          recurrence: null,
          recurrenceExdates: [],
        },
      ],
      { now: "2026-07-31T10:00:00Z" },
    );
    expect(exported.text).toContain(`${CRLF} `);
    expect(only(exported.text).title).toBe(title);
  });

  it("reads property and parameter names case-insensitively", () => {
    const text = calendar(vevent(["summary:Sastanak", "dtstart;value=date:20260715"]));
    expect(only(text)).toMatchObject({ title: "Sastanak", startAt: "2026-07-15", allDay: true });
  });

  it("counts every VEVENT the file carried, refused ones included", () => {
    const text = calendar([
      ...vevent(["SUMMARY:Dobar", "DTSTART:20260715"]),
      ...vevent(["SUMMARY:Bez početka"]),
    ]);
    const parsed = parseOk(text);
    expect(parsed.sourceEvents).toBe(2);
    expect(parsed.events).toHaveLength(1);
  });
});

describe("parseIcsCalendar — components other than VEVENT", () => {
  it("counts a VTODO and a VJOURNAL by name and still imports the event beside them", () => {
    const text = calendar([
      "BEGIN:VTODO",
      "SUMMARY:Obaveza",
      "END:VTODO",
      ...vevent(["SUMMARY:Sastanak", "DTSTART:20260715"]),
      "BEGIN:VTODO",
      "SUMMARY:Druga",
      "END:VTODO",
      "BEGIN:VJOURNAL",
      "SUMMARY:Dnevnik",
      "END:VJOURNAL",
    ]);
    const parsed = parseOk(text);
    expect(componentsOf(parsed)).toEqual({ VTODO: 2, VJOURNAL: 1 });
    expect(parsed.events).toHaveLength(1);
  });

  it("counts a VALARM inside an event by name; the event itself imports", () => {
    const text = calendar(
      vevent([
        "SUMMARY:Sastanak",
        "DTSTART:20260715T093000",
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "ACTION:DISPLAY",
        "END:VALARM",
      ]),
    );
    const parsed = parseOk(text);
    expect(componentsOf(parsed)).toEqual({ VALARM: 1 });
    expect(parsed.events).toHaveLength(1);
  });

  it("counts VTIMEZONE and an unknown component by name", () => {
    const text = calendar([
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Belgrade",
      "END:VTIMEZONE",
      "BEGIN:X-CUSTOM",
      "END:X-CUSTOM",
      ...vevent(["SUMMARY:Sastanak", "DTSTART:20260715"]),
    ]);
    expect(componentsOf(parseOk(text))).toEqual({ VTIMEZONE: 1, "X-CUSTOM": 1 });
  });

  it("does not double-count a component nested inside one it already skipped", () => {
    const text = calendar([
      "BEGIN:VTODO",
      "BEGIN:VALARM",
      "TRIGGER:-PT5M",
      "END:VALARM",
      "END:VTODO",
    ]);
    expect(componentsOf(parseOk(text))).toEqual({ VTODO: 1 });
  });
});

describe("parseIcsCalendar — text values", () => {
  it("unescapes \\n, \\N, \\;, \\, and \\\\ exactly as §3.3.11 defines them", () => {
    const text = calendar(
      vevent([
        "SUMMARY:C:\\\\Users\\; pola\\, pola",
        "DESCRIPTION:prvi\\ndrugi\\Ntreći",
        "DTSTART:20260715",
      ]),
    );
    const event = only(text);
    expect(event.title).toBe("C:\\Users; pola, pola");
    expect(event.description).toBe("prvi\ndrugi\ntreći");
  });

  it("refuses an event with no SUMMARY, and one whose SUMMARY is blank, by name", () => {
    const missing = parseOk(calendar(vevent(["DTSTART:20260715"])));
    expect(missing.events).toEqual([]);
    expect(skipsOf(missing)).toEqual({ "empty-summary": 1 });
    const blank = parseOk(calendar(vevent(["SUMMARY:   ", "DTSTART:20260715"])));
    expect(skipsOf(blank)).toEqual({ "empty-summary": 1 });
  });

  it("carries LOCATION on the event's own location field — the honest inverse of what the export writes", () => {
    const text = calendar(
      vevent(["SUMMARY:Sastanak", "DTSTART:20260715T093000", "LOCATION:RAF\\, sala 3"]),
    );
    expect(only(text).location).toBe("RAF, sala 3");
  });

  it("takes the first CATEGORIES value and counts the dropped rest", () => {
    const single = only(
      calendar(vevent(["SUMMARY:S", "DTSTART:20260715", "CATEGORIES:posao"])),
    );
    expect(single.category).toBe("posao");

    const multi = parseOk(
      calendar(vevent(["SUMMARY:S", "DTSTART:20260715", "CATEGORIES:posao,hitno,privatno"])),
    );
    expect(multi.events[0]?.category).toBe("posao");
    expect(skipsOf(multi)).toEqual({ "categories-dropped": 1 });

    // An escaped comma is part of ONE value, not a separator between two.
    const escaped = parseOk(
      calendar(vevent(["SUMMARY:S", "DTSTART:20260715", "CATEGORIES:pola\\, pola"])),
    );
    expect(escaped.events[0]?.category).toBe("pola, pola");
    expect(skipsOf(escaped)).toEqual({});
  });
});

describe("parseIcsCalendar — DTSTART", () => {
  it("maps a floating local date-time VERBATIM onto the zone-less wall clock", () => {
    expect(only(calendar(vevent(["SUMMARY:S", "DTSTART:20260715T093000"])))).toMatchObject({
      startAt: "2026-07-15T09:30",
      allDay: false,
    });
  });

  it("keeps seconds when they are not zero, and drops them when they are", () => {
    expect(only(calendar(vevent(["SUMMARY:S", "DTSTART:20260715T093045"]))).startAt).toBe(
      "2026-07-15T09:30:45",
    );
    expect(only(calendar(vevent(["SUMMARY:S", "DTSTART:20260715T093000"]))).startAt).toBe(
      "2026-07-15T09:30",
    );
  });

  it("reads VALUE=DATE as an all-day event", () => {
    expect(only(calendar(vevent(["SUMMARY:S", "DTSTART;VALUE=DATE:20260715"])))).toMatchObject({
      startAt: "2026-07-15",
      allDay: true,
      endAt: null,
    });
  });

  it("reads a bare-date value without VALUE=DATE as the DATE it actually is", () => {
    expect(only(calendar(vevent(["SUMMARY:S", "DTSTART:20260715"])))).toMatchObject({
      startAt: "2026-07-15",
      allDay: true,
    });
  });

  it("converts a UTC instant to the MACHINE's local wall clock", () => {
    const expected = localWallClock(Date.UTC(2026, 6, 15, 9, 30));
    expect(only(calendar(vevent(["SUMMARY:S", "DTSTART:20260715T093000Z"]))).startAt).toBe(expected);
  });

  it("converts TZID=UTC exactly as it converts the Z form", () => {
    const viaZ = only(calendar(vevent(["SUMMARY:S", "DTSTART:20260715T093000Z"])));
    const viaTzid = only(calendar(vevent(["SUMMARY:S", "DTSTART;TZID=UTC:20260715T093000"])));
    expect(viaTzid.startAt).toBe(viaZ.startAt);
  });

  it("converts a named zone through its own offset — Belgrade in July is UTC+2", () => {
    const viaZ = only(calendar(vevent(["SUMMARY:S", "DTSTART:20260715T073000Z"])));
    const viaBelgrade = only(
      calendar(vevent(["SUMMARY:S", "DTSTART;TZID=Europe/Belgrade:20260715T093000"])),
    );
    expect(viaBelgrade.startAt).toBe(viaZ.startAt);
  });

  it("refuses a TZID this machine cannot resolve, by name", () => {
    const parsed = parseOk(
      calendar(vevent(["SUMMARY:S", "DTSTART;TZID=Nigde/Nikad:20260715T093000"])),
    );
    expect(parsed.events).toEqual([]);
    expect(skipsOf(parsed)).toEqual({ "unknown-timezone": 1 });
  });

  it("refuses a missing, malformed or impossible DTSTART, by name", () => {
    for (const lines of [
      vevent(["SUMMARY:S"]),
      vevent(["SUMMARY:S", "DTSTART:sutra"]),
      vevent(["SUMMARY:S", "DTSTART:20260230"]),
      vevent(["SUMMARY:S", "DTSTART:20260715T256000"]),
    ]) {
      const parsed = parseOk(calendar(lines));
      expect(parsed.events).toEqual([]);
      expect(skipsOf(parsed)).toEqual({ "invalid-start": 1 });
    }
  });
});

describe("parseIcsCalendar — the event's end", () => {
  it("maps DTEND after the start onto endAt, and DTEND equal to the start onto a point event", () => {
    expect(
      only(calendar(vevent(["SUMMARY:S", "DTSTART:20260715T093000", "DTEND:20260715T104500"]))),
    ).toMatchObject({ endAt: "2026-07-15T10:45" });
    expect(
      only(calendar(vevent(["SUMMARY:S", "DTSTART:20260715T093000", "DTEND:20260715T093000"]))),
    ).toMatchObject({ endAt: null });
    expect(only(calendar(vevent(["SUMMARY:S", "DTSTART:20260715T093000"])))).toMatchObject({
      endAt: null,
    });
  });

  it("drops a DTEND before the start and says so — the event imports as a point", () => {
    const parsed = parseOk(
      calendar(vevent(["SUMMARY:S", "DTSTART:20260715T093000", "DTEND:20260715T080000"])),
    );
    expect(parsed.events[0]?.endAt).toBeNull();
    expect(skipsOf(parsed)).toEqual({ "invalid-end": 1 });
  });

  it("converts a UTC DTEND exactly as it converts a UTC start", () => {
    const expected = localWallClock(Date.UTC(2026, 6, 15, 10, 45));
    expect(
      only(
        calendar(vevent(["SUMMARY:S", "DTSTART:20260715T093000Z", "DTEND:20260715T104500Z"])),
      ).endAt,
    ).toBe(expected);
  });

  it("computes the end from a DURATION, across midnight included", () => {
    expect(
      only(calendar(vevent(["SUMMARY:S", "DTSTART:20260715T093000", "DURATION:PT1H30M"]))).endAt,
    ).toBe("2026-07-15T11:00");
    expect(
      only(calendar(vevent(["SUMMARY:S", "DTSTART:20260715T233000", "DURATION:PT2H"]))).endAt,
    ).toBe("2026-07-16T01:30");
  });

  it("drops a malformed or negative DURATION and says so", () => {
    for (const duration of ["DURATION:sat vremena", "DURATION:-PT1H", "DURATION:P"]) {
      const parsed = parseOk(calendar(vevent(["SUMMARY:S", "DTSTART:20260715T093000", duration])));
      expect(parsed.events[0]?.endAt).toBeNull();
      expect(skipsOf(parsed)).toEqual({ "invalid-end": 1 });
    }
  });

  it("turns an all-day event's EXCLUSIVE DTEND back into the INCLUSIVE last day", () => {
    // A single-day event's DTEND is the following day — and its stored end is null.
    expect(
      only(calendar(vevent(["SUMMARY:S", "DTSTART;VALUE=DATE:20260715", "DTEND;VALUE=DATE:20260716"])))
        .endAt,
    ).toBeNull();
    expect(
      only(calendar(vevent(["SUMMARY:S", "DTSTART;VALUE=DATE:20260715", "DTEND;VALUE=DATE:20260718"])))
        .endAt,
    ).toBe("2026-07-17");
  });

  it("reads an all-day DURATION in days and weeks", () => {
    expect(
      only(calendar(vevent(["SUMMARY:S", "DTSTART;VALUE=DATE:20260715", "DURATION:P3D"]))).endAt,
    ).toBe("2026-07-17");
    expect(
      only(calendar(vevent(["SUMMARY:S", "DTSTART;VALUE=DATE:20260715", "DURATION:P1W"]))).endAt,
    ).toBe("2026-07-21");
    expect(
      only(calendar(vevent(["SUMMARY:S", "DTSTART;VALUE=DATE:20260715", "DURATION:P1D"]))).endAt,
    ).toBeNull();
  });
});

describe("parseIcsCalendar — RRULE onto the six shapes (ADR-024)", () => {
  function ruleOf(lines: readonly string[]): IcsParsedEvent["recurrence"] {
    return only(calendar(vevent(lines))).recurrence;
  }

  it("maps DAILY, with and without INTERVAL", () => {
    expect(ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=DAILY"])).toEqual({
      freq: { kind: "daily", interval: 1 },
      end: { kind: "never" },
    });
    expect(ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=DAILY;INTERVAL=3"])).toEqual({
      freq: { kind: "daily", interval: 3 },
      end: { kind: "never" },
    });
  });

  it("maps WEEKLY with the workweek BYDAY at interval 1 onto the weekdays shape — what the export writes for it", () => {
    expect(
      ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"]),
    ).toEqual({ freq: { kind: "weekdays" }, end: { kind: "never" } });
  });

  it("maps WEEKLY with a BYDAY list, canonicalizing order and duplicates", () => {
    expect(
      ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR,WE,FR"]),
    ).toEqual({ freq: { kind: "weekly", interval: 2, days: [2, 4] }, end: { kind: "never" } });
  });

  it("defaults a WEEKLY without BYDAY to the anchor's own weekday, as §3.3.10 does", () => {
    // 2026-07-15 is a Wednesday (index 2, Monday-first).
    expect(ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=WEEKLY"])).toEqual({
      freq: { kind: "weekly", interval: 1, days: [2] },
      end: { kind: "never" },
    });
  });

  it("maps MONTHLY by date, defaulting the day to the anchor's", () => {
    expect(ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=MONTHLY;BYMONTHDAY=15"])).toEqual({
      freq: { kind: "monthly-date", interval: 1, day: 15 },
      end: { kind: "never" },
    });
    expect(ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=MONTHLY;INTERVAL=2"])).toEqual({
      freq: { kind: "monthly-date", interval: 2, day: 15 },
      end: { kind: "never" },
    });
  });

  it("maps MONTHLY by ordinal weekday, in both spellings the format has", () => {
    const expected = {
      freq: { kind: "monthly-ordinal", interval: 1, ordinal: 3, weekday: 2 },
      end: { kind: "never" },
    };
    expect(ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=MONTHLY;BYDAY=3WE"])).toEqual(expected);
    expect(
      ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=MONTHLY;BYDAY=WE;BYSETPOS=3"]),
    ).toEqual(expected);
    expect(ruleOf(["SUMMARY:S", "DTSTART:20260731", "RRULE:FREQ=MONTHLY;BYDAY=-1FR"])).toEqual({
      freq: { kind: "monthly-ordinal", interval: 1, ordinal: -1, weekday: 4 },
      end: { kind: "never" },
    });
  });

  it("maps YEARLY, plain or restating the anchor's own month and day", () => {
    const expected = { freq: { kind: "yearly", interval: 1 }, end: { kind: "never" } };
    expect(ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=YEARLY"])).toEqual(expected);
    expect(
      ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=15"]),
    ).toEqual(expected);
  });

  it("maps COUNT and UNTIL, in every form UNTIL legally takes", () => {
    expect(
      ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=DAILY;COUNT=10"])?.end,
    ).toEqual({ kind: "count", total: 10 });
    expect(
      ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=DAILY;UNTIL=20260831"])?.end,
    ).toEqual({ kind: "until", date: "2026-08-31" });
    // A floating date-time UNTIL at or past the series' own time of day still
    // covers that day...
    expect(
      ruleOf(["SUMMARY:S", "DTSTART:20260715T093000", "RRULE:FREQ=DAILY;UNTIL=20260831T235959"])?.end,
    ).toEqual({ kind: "until", date: "2026-08-31" });
    // ...while one BEFORE it ends on the previous day: the last occurrence the
    // instant actually admits is the honest inclusive day.
    expect(
      ruleOf(["SUMMARY:S", "DTSTART:20260715T093000", "RRULE:FREQ=DAILY;UNTIL=20260831T080000"])?.end,
    ).toEqual({ kind: "until", date: "2026-08-30" });
  });

  it("converts a UTC UNTIL like any UTC instant before taking its day", () => {
    // Belgrade in August is UTC+2: 21:59:59Z is 23:59:59 local — the machine
    // running this test may sit elsewhere, so the expectation is computed the
    // same way the start conversion's is.
    const untilLocal = localWallClock(Date.UTC(2026, 7, 31, 21, 59, 59)).slice(0, 10);
    const rule = ruleOf([
      "SUMMARY:S",
      "DTSTART;VALUE=DATE:20260715",
      "RRULE:FREQ=DAILY;UNTIL=20260831T215959Z",
    ]);
    expect(rule?.end).toEqual({ kind: "until", date: untilLocal });
  });

  it("imports the master as a ONE-OFF and says so for every rule that outgrows the six shapes", () => {
    const unmappable = [
      "RRULE:FREQ=HOURLY",
      "RRULE:FREQ=MINUTELY",
      "RRULE:FREQ=WEEKLY;BYDAY=2MO",
      "RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15",
      "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1",
      "RRULE:FREQ=MONTHLY;BYDAY=5TU",
      "RRULE:FREQ=MONTHLY;BYDAY=TU",
      "RRULE:FREQ=MONTHLY;BYDAY=TU;BYSETPOS=1,2",
      "RRULE:FREQ=YEARLY;BYMONTH=3",
      "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;WKST=SU",
      "RRULE:FREQ=DAILY;BYWEEKNO=20",
      "RRULE:FREQ=DAILY;INTERVAL=100",
      "RRULE:FREQ=DAILY;COUNT=1000",
      "RRULE:FREQ=DAILY;COUNT=5;UNTIL=20260831",
      "RRULE:FREQ=DAILY;UNTIL=jednom",
    ];
    for (const rrule of unmappable) {
      const parsed = parseOk(calendar(vevent(["SUMMARY:S", "DTSTART:20260715", rrule])));
      expect(parsed.events).toHaveLength(1);
      expect(parsed.events[0]?.recurrence).toBeNull();
      expect(parsed.events[0]?.recurrenceExdates).toEqual([]);
      expect(skipsOf(parsed)).toEqual({ "recurrence-unmappable": 1 });
    }
  });

  it("tolerates WKST at its default and at interval 1, where it changes nothing", () => {
    expect(
      ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;WKST=MO"]),
    ).toEqual({ freq: { kind: "weekly", interval: 2, days: [0] }, end: { kind: "never" } });
    expect(
      ruleOf(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=WEEKLY;BYDAY=MO;WKST=SU"]),
    ).toEqual({ freq: { kind: "weekly", interval: 1, days: [0] }, end: { kind: "never" } });
  });
});

describe("parseIcsCalendar — EXDATE and detached overrides", () => {
  it("collects exdates across properties and values, sorted and deduplicated, timed ones by their day", () => {
    const event = only(
      calendar(
        vevent([
          "SUMMARY:S",
          "DTSTART:20260715T093000",
          "RRULE:FREQ=DAILY",
          "EXDATE:20260720T093000,20260717T093000",
          "EXDATE:20260717T093000",
          "EXDATE;VALUE=DATE:20260716",
        ]),
      ),
    );
    expect(event.recurrenceExdates).toEqual(["2026-07-16", "2026-07-17", "2026-07-20"]);
  });

  it("converts a UTC exdate before taking its day", () => {
    const day = localWallClock(Date.UTC(2026, 6, 17, 7, 30)).slice(0, 10);
    const event = only(
      calendar(
        vevent(["SUMMARY:S", "DTSTART:20260715T093000Z", "RRULE:FREQ=DAILY", "EXDATE:20260717T073000Z"]),
      ),
    );
    expect(event.recurrenceExdates).toEqual([day]);
  });

  it("drops an exdate it cannot read and says so, keeping the readable rest", () => {
    const parsed = parseOk(
      calendar(
        vevent([
          "SUMMARY:S",
          "DTSTART:20260715",
          "RRULE:FREQ=DAILY",
          "EXDATE:20260230,20260717",
          "EXDATE;TZID=Nigde/Nikad:20260718T093000",
        ]),
      ),
    );
    expect(parsed.events[0]?.recurrenceExdates).toEqual(["2026-07-17"]);
    expect(skipsOf(parsed)).toEqual({ "invalid-exdate": 2 });
  });

  it("drops EXDATEs on an event with no series — an exclusion from nothing excludes nothing", () => {
    const parsed = parseOk(calendar(vevent(["SUMMARY:S", "DTSTART:20260715", "EXDATE:20260717"])));
    expect(parsed.events[0]?.recurrenceExdates).toEqual([]);
    expect(skipsOf(parsed)).toEqual({});
  });

  it("imports a detached override (RECURRENCE-ID) as its own one-off, counted by name", () => {
    const parsed = parseOk(
      calendar(
        vevent([
          "SUMMARY:Pomereni termin",
          "DTSTART:20260722T110000",
          "RECURRENCE-ID:20260722T093000",
          "RRULE:FREQ=DAILY",
        ]),
      ),
    );
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      title: "Pomereni termin",
      startAt: "2026-07-22T11:00",
      recurrence: null,
      recurrenceExdates: [],
    });
    expect(skipsOf(parsed)).toEqual({ "detached-override": 1 });
  });

  it("lists skips in the declared order, refusals before trims", () => {
    const text = calendar([
      ...vevent(["SUMMARY:S", "DTSTART:20260715", "RRULE:FREQ=HOURLY"]),
      ...vevent(["DTSTART:20260715"]),
    ]);
    const parsed = parseOk(text);
    const codes = parsed.skips.map((skip) => skip.code);
    expect(codes).toEqual(
      ICS_IMPORT_SKIP_CODES.filter((code) => codes.includes(code)),
    );
  });
});

describe("translateIcsEvents", () => {
  it("stamps every event with a deterministic source id, the target profile and the injected now — and plans every other member empty", () => {
    const parsed = parseOk(
      calendar([
        ...vevent(["SUMMARY:Prvi", "DTSTART:20260715T093000"]),
        ...vevent(["SUMMARY:Drugi", "DTSTART;VALUE=DATE:20260716"]),
      ]),
    );
    const data = translateIcsEvents(parsed, {
      profileId: "profil-1",
      now: "2026-07-31T12:00:00.000Z",
    });
    expect(data.events).toHaveLength(2);
    expect(data.events.map((event) => event.id)).toEqual(["ics:event:0", "ics:event:1"]);
    for (const event of data.events) {
      expect(event.profileId).toBe("profil-1");
      expect(event.createdAt).toBe("2026-07-31T12:00:00.000Z");
      expect(event.updatedAt).toBe("2026-07-31T12:00:00.000Z");
      // The named asymmetry: a reminder ladder does not travel in ICS, so an
      // imported event starts with the default (none).
      expect(event.reminderOffsets).toEqual([]);
    }
    const { events, ...rest } = data;
    void events;
    for (const rows of Object.values(rest)) expect(rows).toEqual([]);
  });
});

describe("icsExport → icsImport round trip", () => {
  /** Start-then-id, exactly the exporter's own event order, so expectations line up positionally. */
  function compareEvents(a: IcsEvent, b: IcsEvent): number {
    if (a.startAt !== b.startAt) return a.startAt < b.startAt ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
  }

  /** What must survive the crossing — everything a calendar file can carry. */
  function comparable(event: IcsEvent | IcsParsedEvent) {
    return {
      title: event.title,
      description: event.description,
      startAt: event.startAt,
      endAt: event.endAt,
      allDay: event.allDay,
      location: event.location,
      category: event.category,
      recurrence: event.recurrence,
      recurrenceExdates: [...event.recurrenceExdates],
    };
  }

  it("re-imports every exportable event as an equivalent row — all six recurrence shapes included", () => {
    // Anchors sit ON their own pattern (2026-07-15 is a Wednesday, 2026-07-31 a
    // Friday), so the exporter adds no phantom-anchor EXDATE; that asymmetry
    // has its own test below.
    const events: IcsEvent[] = [
      {
        id: "rt-01",
        title: "Jednokratan sastanak",
        description: "Kod dekana;\nponeti indeks, obavezno",
        startAt: "2026-07-15T09:30",
        endAt: "2026-07-15T10:45",
        allDay: false,
        location: "RAF, sala 3",
        category: "posao",
        recurrence: null,
        recurrenceExdates: [],
      },
      {
        id: "rt-02",
        title: "Rođendan",
        description: null,
        startAt: "2026-03-02",
        endAt: null,
        allDay: true,
        location: null,
        category: null,
        recurrence: null,
        recurrenceExdates: [],
      },
      {
        id: "rt-03",
        title: "Odmor",
        description: null,
        startAt: "2026-07-20",
        endAt: "2026-07-24",
        allDay: true,
        location: "Kopaonik",
        category: null,
        recurrence: null,
        recurrenceExdates: [],
      },
      {
        id: "rt-04",
        title: "Trening",
        description: null,
        startAt: "2026-07-15T08:00",
        endAt: "2026-07-15T09:00",
        allDay: false,
        location: null,
        category: "zdravlje",
        recurrence: { freq: { kind: "daily", interval: 3 }, end: { kind: "count", total: 10 } },
        recurrenceExdates: ["2026-07-18"],
      },
      {
        id: "rt-05",
        title: "Stendap",
        description: null,
        startAt: "2026-07-15",
        endAt: null,
        allDay: true,
        location: null,
        category: null,
        recurrence: { freq: { kind: "weekdays" }, end: { kind: "until", date: "2026-08-31" } },
        recurrenceExdates: [],
      },
      {
        id: "rt-06",
        title: "Vežbe",
        description: null,
        startAt: "2026-07-15T12:00",
        endAt: null,
        allDay: false,
        location: null,
        category: null,
        recurrence: {
          freq: { kind: "weekly", interval: 2, days: [2, 4] },
          end: { kind: "never" },
        },
        recurrenceExdates: ["2026-07-17"],
      },
      {
        id: "rt-07",
        title: "Plata",
        description: null,
        startAt: "2026-07-15",
        endAt: null,
        allDay: true,
        location: null,
        category: null,
        recurrence: {
          freq: { kind: "monthly-date", interval: 1, day: 15 },
          end: { kind: "count", total: 6 },
        },
        recurrenceExdates: [],
      },
      {
        id: "rt-08",
        title: "Sastanak stanara",
        description: null,
        startAt: "2026-07-15T18:00",
        endAt: null,
        allDay: false,
        location: null,
        category: null,
        recurrence: {
          freq: { kind: "monthly-ordinal", interval: 1, ordinal: 3, weekday: 2 },
          end: { kind: "never" },
        },
        recurrenceExdates: [],
      },
      {
        id: "rt-09",
        title: "Zatvaranje meseca",
        description: null,
        startAt: "2026-07-31",
        endAt: null,
        allDay: true,
        location: null,
        category: null,
        recurrence: {
          freq: { kind: "monthly-ordinal", interval: 1, ordinal: -1, weekday: 4 },
          end: { kind: "never" },
        },
        recurrenceExdates: [],
      },
      {
        id: "rt-10",
        title: "Godišnjica",
        description: null,
        startAt: "2026-07-15T20:00",
        endAt: null,
        allDay: false,
        location: null,
        category: null,
        recurrence: {
          freq: { kind: "yearly", interval: 2 },
          end: { kind: "until", date: "2032-07-15" },
        },
        recurrenceExdates: [],
      },
    ];

    const exported = buildIcsCalendar(events, { now: "2026-07-31T10:00:00Z" });
    expect(exported.skipped).toEqual([]);

    const parsed = parseOk(exported.text);
    expect(parsed.sourceEvents).toBe(events.length);
    expect(parsed.components).toEqual([]);
    expect(parsed.skips).toEqual([]);

    const expected = [...events].sort(compareEvents).map(comparable);
    expect(parsed.events.map(comparable)).toEqual(expected);

    // Through the translator, the one asymmetry is the reminder ladder: ICS
    // does not carry Nexus's reminder offsets, so every event re-imports with
    // the default (none). Everything else above already matched field for field.
    const data = translateIcsEvents(parsed, { profileId: "p", now: "2026-07-31T10:00:00Z" });
    expect(data.events.every((event) => event.reminderOffsets.length === 0)).toBe(true);
  });

  it("brings the exporter's phantom-anchor EXDATE back as an exdate — the same silent day, named here once", () => {
    // A Monday-only series anchored on a Wednesday: Nexus's engine never
    // yields the anchor, so the export EXDATEs it for every other consumer.
    // Re-importing keeps that exclusion; the recurrence engine ignores an
    // exdate on a day the pattern never fires, so the series is unchanged.
    const exported = buildIcsCalendar(
      [
        {
          id: "anchor-1",
          title: "Ponedeljkom",
          description: null,
          startAt: "2026-07-15",
          endAt: null,
          allDay: true,
          location: null,
          category: null,
          recurrence: { freq: { kind: "weekly", interval: 1, days: [0] }, end: { kind: "never" } },
          recurrenceExdates: [],
        },
      ],
      { now: "2026-07-31T10:00:00Z" },
    );
    const event = only(exported.text);
    expect(event.recurrence).toEqual({
      freq: { kind: "weekly", interval: 1, days: [0] },
      end: { kind: "never" },
    });
    expect(event.recurrenceExdates).toEqual(["2026-07-15"]);
  });
});
