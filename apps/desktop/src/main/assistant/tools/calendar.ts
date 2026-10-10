/**
 * The CALENDAR module: what is on in a stretch of days, and adding one event.
 *
 * **A series is expanded here, with the core's own primitive.** Every calendar
 * surface in the app reads one expanded item stream built by the renderer's
 * `calendarItems.ts` (ADR-024) — and main cannot import the renderer, so this
 * tool expands a recurring master itself. The expansion is not a second rule
 * though: `occurrenceDatesInRange` is the same `@nexus/core` function the
 * renderer's builder and the calendar-overlay store both call, including its
 * handling of `recurrenceExdates`; what lives here is only the day arithmetic
 * around it (how long the master lasts, and which occurrence overlaps the
 * window).
 *
 * **A window, never „everything".** The range is required and bounded, because
 * a series can be infinite and because „what is on this week" is the question a
 * person actually asks. `MAX_RANGE_DAYS` is generous enough for a semester and
 * small enough that a malformed argument cannot make this read a decade of
 * rows.
 */

import { EventStore } from "@nexus/db";
import type { CreateEventInput, Event } from "@nexus/db";
import { isValidDayKey, occurrenceDatesInRange, shiftDayKey } from "@nexus/core";
import type { AssistantLocale, Citation, Tool } from "@nexus/core";
import {
  asArgs,
  asDay,
  asInstant,
  asOptionalBoolean,
  asOptionalInstant,
  asOptionalText,
  asText,
} from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  formatDay,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

/**
 * What this area needs: a way to open the profile's database, and nothing else.
 *
 * There is deliberately no `now()`: neither tool asks what day it is (the range
 * is the model's own argument), and `EventStore.create` stamps its own clock —
 * the one store in this folder that takes no `at`, so pretending otherwise here
 * would be a parameter nothing could honour.
 */
export interface CalendarToolDeps {
  readonly profileDb: ProfileDb;
}

/** How far one query may reach. A year: enough for „šta imam u narednih godinu dana", short enough that the answer stays readable. */
const MAX_RANGE_DAYS = 366;

/** The most rows one answer carries, before it says so rather than continuing. */
const MAX_ROWS = 60;

const MAX_TITLE_CHARS = 200;
const MAX_LOCATION_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 2_000;

/**
 * The heading names no dates. The range is the model's own argument and it
 * already knows it; repeating it would only be one more place to get Serbian's
 * date punctuation wrong.
 */
const EVENTS_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Događaji (${count}):`,
  en: (count) => `Events (${count}):`,
};

const NO_EVENTS: { sr: string; en: string } = {
  sr: "U tom rasponu nema događaja.",
  en: "No events in that range.",
};

const RANGE_BACKWARDS: AssistantPhrase<[from: string, to: string]> = {
  sr: (from, to) => `Početak prekida kraja: ${from} je posle ${to}.`,
  en: (from, to) => `The range starts after it ends: ${from} is after ${to}.`,
};

const RANGE_TOO_LONG: AssistantPhrase<[days: number]> = {
  sr: (days) => `Raspon je predugačak: najviše ${days} dana u jednom upitu.`,
  en: (days) => `The range is too long: at most ${days} days per query.`,
};

const MORE_ROWS: AssistantPhrase<[count: number]> = {
  sr: (count) => `Prikazani su samo prvi redovi (${count}).`,
  en: (count) => `Showing only the first ${count} rows.`,
};

const CREATE_SUMMARY: AssistantPhrase<[title: string, when: string]> = {
  sr: (title, when) => `Napravi događaj „${title}“ — ${when}`,
  en: (title, when) => `Create event “${title}” — ${when}`,
};

const CREATED: AssistantPhrase<[title: string, id: string]> = {
  sr: (title, id) => `Napravljen događaj „${title}“ (${id}).`,
  en: (title, id) => `Created event “${title}” (${id}).`,
};

/** A row's own words: the whole-day reading, and the arrow a timed range reads with. */
const ROW_WORDS: {
  readonly allDay: { readonly sr: string; readonly en: string };
} = {
  allDay: { sr: "celi dan", en: "all day" },
};

export function calendarTools(deps: CalendarToolDeps): readonly Tool[] {
  function eventStore(profileId: string): EventStore {
    return deps.profileDb(profileId, (db, id) => new EventStore(db, id));
  }

  const events: Tool = {
    name: "calendar.events",
    description: {
      sr: "Izlistava događaje u zadatom rasponu dana, uključujući ponavljanja serije. Koristi ga kada korisnik pita šta ima danas, sutra, ove nedelje ili u nekom periodu.",
      en: "Lists events in a range of days, including the occurrences of a recurring series. Use it when the user asks what is on today, tomorrow, this week or in some period.",
    },
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "First day of the range, inclusive, as YYYY-MM-DD." },
        to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Last day of the range, inclusive, as YYYY-MM-DD." },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const from = asDay(args.from, "from");
        const to = asDay(args.to, "to");
        if (to < from) throw new Error(phrase(context.locale, RANGE_BACKWARDS, from, to));
        if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
          throw new Error(phrase(context.locale, RANGE_TOO_LONG, MAX_RANGE_DAYS));
        }

        const occurrences = expand(eventStore(context.profileId).listActive(), from, to).sort(
          (left, right) =>
            left.day === right.day ? compareClock(left, right) : left.day < right.day ? -1 : 1,
        );

        if (occurrences.length === 0) {
          return okResult(text(context.locale, NO_EVENTS));
        }
        const shown = occurrences.slice(0, MAX_ROWS);
        const content = [
          phrase(context.locale, EVENTS_HEADING, shown.length),
          ...shown.map((occurrence) => occurrenceLine(context.locale, occurrence)),
        ];
        if (shown.length < occurrences.length) {
          content.push(phrase(context.locale, MORE_ROWS, shown.length));
        }
        return okResult(content.join("\n"), {
          citations: shown.map(eventCitation),
        });
      }),
  };

  const create: Tool = {
    name: "calendar.create",
    description: {
      sr: "Pravi jedan događaj u kalendaru. Koristi ga kada korisnik kaže da nešto treba da se nađe u kalendaru. `start` je datum ili datum sa vremenom u ISO obliku („2026-10-12“ ili „2026-10-12T18:00“); za događaj koji traje celi dan pošalji samo datum i `allDay`.",
      en: "Creates one calendar event. Use it when the user says something should be in the calendar. `start` is an ISO date or date-time (\"2026-10-12\" or \"2026-10-12T18:00\"); for a whole-day event send the date alone with `allDay`.",
    },
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: MAX_TITLE_CHARS, description: "What the event is." },
        start: {
          type: "string",
          maxLength: 40,
          description: "ISO-8601 date (\"2026-10-12\") or date-time (\"2026-10-12T18:00\").",
        },
        end: {
          type: "string",
          maxLength: 40,
          description: "ISO-8601 end, when the user gave one. Omitted means the calendar's own default duration.",
        },
        allDay: { type: "boolean", description: "True for an event that occupies the whole day." },
        location: { type: "string", maxLength: MAX_LOCATION_CHARS, description: "Where it happens, when the user said." },
        description: { type: "string", maxLength: MAX_DESCRIPTION_CHARS, description: "Extra detail, when the user gave some." },
      },
      required: ["title", "start"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const title = asText(args.title, "title", MAX_TITLE_CHARS);
        const start = asInstant(args.start, "start");
        const end = asOptionalInstant(args.end, "end");
        const allDay = asOptionalBoolean(args.allDay, "allDay");
        const location = asOptionalText(args.location, "location", MAX_LOCATION_CHARS);
        const description = asOptionalText(args.description, "description", MAX_DESCRIPTION_CHARS);

        const declined = await confirmOrDecline(
          context,
          "calendar.create",
          "write",
          phrase(context.locale, CREATE_SUMMARY, title, when(context.locale, start, allDay ?? false)),
        );
        if (declined !== null) return declined;

        const created = deps.profileDb(context.profileId, (db, id) => {
          const store = new EventStore(db, id);
          const input: CreateEventInput = { title, startAt: start };
          if (end !== undefined) input.endAt = end;
          if (allDay !== undefined) input.allDay = allDay;
          if (location !== undefined) input.location = location;
          if (description !== undefined) input.description = description;
          return store.create(input);
        });
        return okResult(phrase(context.locale, CREATED, created.title, created.id), {
          citations: [
            {
              kind: "event",
              id: created.id,
              title: created.title,
              location: { module: "calendar", item: created.id },
            },
          ],
          navigateTo: { module: "calendar", item: created.id },
        });
      }),
  };

  return [events, create];
}

/** One row of the expanded stream: which occurrence of which stored event, and the day it falls on. */
interface Occurrence {
  readonly event: Event;
  readonly day: string;
  /** The master's clock time, repeated on every occurrence, or null for a day-granular row. */
  readonly time: string | null;
  readonly endTime: string | null;
  readonly allDay: boolean;
}

/**
 * Every event row's occurrences inside `[from, to]`.
 *
 * A one-off is included when its own span (start..end) overlaps the window; a
 * series master is expanded with core's `occurrenceDatesInRange`, searched from
 * as many days before `from` as the master lasts, so a multi-day occurrence
 * that began before the window still shows on the day it spills into it. The
 * exdates are the master's own removed days, honoured by the same call the
 * renderer uses.
 */
function expand(rows: readonly Event[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const event of rows) {
    const startDay = dayOf(event.startAt);
    if (!isValidDayKey(startDay)) continue;
    const endDay = dayOf(event.endAt ?? event.startAt);
    const spanDays = isValidDayKey(endDay) ? Math.max(0, daysBetween(startDay, endDay)) : 0;
    const time = clockOf(event.startAt);
    const endTime = clockOf(event.endAt ?? "");

    if (event.recurrence === null) {
      if (endDay >= from && startDay <= to) {
        out.push({ event, day: startDay, time, endTime, allDay: event.allDay });
      }
      continue;
    }

    const searchFrom = shiftDayKey(from, -spanDays);
    const dates = occurrenceDatesInRange(
      event.recurrence,
      startDay,
      { from: searchFrom, to },
      new Set(event.recurrenceExdates),
    );
    for (const day of dates) {
      const closes = shiftDayKey(day, spanDays);
      if (closes < from || day > to) continue;
      out.push({ event, day, time, endTime, allDay: event.allDay });
    }
  }
  return out;
}

/** A day-granular row sorts before a timed one on the same day; two timed rows sort by their clocks. */
function compareClock(left: Occurrence, right: Occurrence): number {
  const leftTime = left.time ?? "";
  const rightTime = right.time ?? "";
  if (leftTime === rightTime) return left.event.title.localeCompare(right.event.title, ["sr-Latn", "sr"]);
  if (leftTime === "") return -1;
  if (rightTime === "") return 1;
  return leftTime < rightTime ? -1 : 1;
}

/**
 * One occurrence as a line. The id is the STORED event's, never the occurrence's
 * — a series is one row (ADR-024), and an id the assistant could not act on
 * would be worse than none.
 */
function occurrenceLine(locale: AssistantLocale, occurrence: Occurrence): string {
  const parts: string[] = [formatDay(locale, occurrence.day)];
  if (occurrence.allDay) {
    parts.push(text(locale, ROW_WORDS.allDay));
  } else if (occurrence.time !== null) {
    parts.push(
      occurrence.endTime === null
        ? occurrence.time
        : `${occurrence.time}—${occurrence.endTime}`,
    );
  }
  if (occurrence.event.location !== null && occurrence.event.location.trim().length > 0) {
    parts.push(occurrence.event.location.trim());
  }
  return `- ${occurrence.event.id} ${occurrence.event.title} [${parts.join(", ")}]`;
}

/** An event the answer drew on; the locator names the day, so a series occurrence is distinguishable from its master. */
function eventCitation(occurrence: Occurrence): Citation {
  return {
    kind: "event",
    id: occurrence.event.id,
    title: occurrence.event.title,
    locator: occurrence.day,
    location: { module: "calendar", item: occurrence.event.id },
  };
}

/** How a confirmation names when something happens: the day alone for a whole-day event or a time-less start, the day and the clock otherwise. */
function when(locale: AssistantLocale, start: string, allDay: boolean): string {
  const day = dayOf(start);
  const time = allDay ? null : clockOf(start);
  if (time === null) return formatDay(locale, day);
  return `${formatDay(locale, day)} ${time}`;
}

/** The `YYYY-MM-DD` an ISO start or end names. A bare day is its own, and a date-time's is the day the user typed (no timezone shift: the string is what they wrote). */
function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

/** The `HH:MM` of an ISO date-time, or null when the value is a bare day. */
function clockOf(iso: string): string | null {
  return iso.length >= 16 && iso[10] === "T" ? iso.slice(11, 16) : null;
}

/** Whole days between two bare day keys, on UTC midnights. */
function daysBetween(from: string, to: string): number {
  const at = (day: string) =>
    Date.UTC(
      Number(day.slice(0, 4)),
      Number(day.slice(5, 7)) - 1,
      Number(day.slice(8, 10)),
    );
  return Math.round((at(to) - at(from)) / 86_400_000);
}
