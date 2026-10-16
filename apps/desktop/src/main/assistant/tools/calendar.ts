/**
 * The CALENDAR module: what is on in a stretch of days, and changing the events
 * on it — their fields, one occurrence of a series, their templates and the
 * semester's two dates.
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
 *
 * **Events are named, not numbered.** A tool that acts on an event accepts its
 * id or its exact title, as the notes and canvas tools do, so the model never
 * has to remember an id it was not shown. A deleted event is the one exception:
 * the store does not list deleted rows, so `calendar.restore` takes the id the
 * delete result reported.
 */

import {
  CalendarSettingsStore,
  EventStore,
  EventTemplateStore,
  MAX_EVENT_REMINDERS,
  MAX_EVENT_REMINDER_MINUTES,
  MAX_EVENT_TEMPLATE_NAME_LENGTH,
} from "@nexus/db";
import type { CreateEventInput, Event, EventTemplate, UpdateEventFields } from "@nexus/db";
import {
  MAX_ID_LENGTH,
  foldSearchText,
  isValidDayKey,
  occurrenceDatesInRange,
  shiftDayKey,
} from "@nexus/core";
import type {
  AssistantLocale,
  Citation,
  RecurrenceFreq,
  RecurrenceRule,
  RecurrenceWeekday,
  Tool,
  ToolResult,
} from "@nexus/core";
import {
  asArgs,
  asCount,
  asDay,
  asEnum,
  asIdentifier,
  asInstant,
  asOptionalBoolean,
  asOptionalDay,
  asOptionalEnum,
  asOptionalInstant,
  asOptionalText,
  asText,
} from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  formatDay,
  formatDayInSentence,
  formatDuration,
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
 * There is deliberately no `now()` the model can move: the day is always the
 * model's own argument, and the clock stamps the store's exception, split and
 * capture writes take are main's clock, read here the way the IPC handlers read
 * it, so a tool never takes a timestamp from a model.
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
/** A policy choice, not a measurement: a category is a short label in a list, and the store itself does not cap it. */
const MAX_CATEGORY_CHARS = 80;

/** How often a new event repeats, counted from its own start day. The model says one of these; `recurrenceOf` turns it into a rule. */
const REPEATS = ["daily", "weekdays", "weekly", "monthly", "yearly"] as const;
type Repeat = (typeof REPEATS)[number];

const OCCURRENCE_ACTIONS = ["skip", "split-here"] as const;
type OccurrenceAction = (typeof OCCURRENCE_ACTIONS)[number];

const TEMPLATE_ACTIONS = ["apply", "capture", "delete"] as const;

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

/** The noun a name lookup reports, in the form each sentence needs: genitive after „nema“ and „ima više“, the bare word in English. */
const NOUN: Record<"event" | "template", { readonly sr: string; readonly en: string }> = {
  event: { sr: "događaja", en: "event" },
  template: { sr: "šablona", en: "template" },
};

const NOT_FOUND: AssistantPhrase<[noun: string, wanted: string]> = {
  sr: (noun, wanted) => `Nema ${noun} „${wanted}“.`,
  en: (noun, wanted) => `No ${noun} named “${wanted}”.`,
};

const AMBIGUOUS: AssistantPhrase<[noun: string, wanted: string, candidates: string]> = {
  sr: (noun, wanted, candidates) => `Ima više ${noun} „${wanted}“: ${candidates}. Navedi id.`,
  en: (noun, wanted, candidates) => `More than one ${noun} is called “${wanted}”: ${candidates}. Use its id.`,
};

const CREATE_SUMMARY: AssistantPhrase<[title: string, when: string]> = {
  sr: (title, when) => `Napravi događaj „${title}“ — ${when}`,
  en: (title, when) => `Create event “${title}” — ${when}`,
};

const REPEATING: AssistantPhrase<[when: string, rule: string]> = {
  sr: (when, rule) => `${when}, ponavlja se ${rule}`,
  en: (when, rule) => `${when}, repeats ${rule}`,
};

/** How a repeat reads inside a confirmation: the rule's own word, in each language. */
const REPEAT_WORDS: Record<Repeat, { readonly sr: string; readonly en: string }> = {
  daily: { sr: "svakog dana", en: "daily" },
  weekdays: { sr: "radnim danima", en: "on weekdays" },
  weekly: { sr: "svake nedelje", en: "weekly" },
  monthly: { sr: "svakog meseca", en: "monthly" },
  yearly: { sr: "svake godine", en: "yearly" },
};

const REPEAT_UNTIL_INVALID: { sr: string; en: string } = {
  sr: "Kraj ponavljanja („repeatUntil“) zahteva učestalost („repeat“) i ne sme biti pre početka.",
  en: "The repeat end (“repeatUntil”) needs a repeat (“repeat”) and must not fall before the start.",
};

const CREATED: AssistantPhrase<[title: string, id: string]> = {
  sr: (title, id) => `Napravljen događaj „${title}“ (${id}).`,
  en: (title, id) => `Created event “${title}” (${id}).`,
};

const UPDATED: AssistantPhrase<[title: string, id: string]> = {
  sr: (title, id) => `Izmenjen događaj „${title}“ (${id}).`,
  en: (title, id) => `Updated event “${title}” (${id}).`,
};

const DELETED: AssistantPhrase<[title: string, id: string]> = {
  sr: (title, id) => `Obrisan je događaj „${title}“ (${id}).`,
  en: (title, id) => `Deleted event “${title}” (${id}).`,
};

const RESTORED: AssistantPhrase<[title: string, id: string]> = {
  sr: (title, id) => `Vraćen je događaj „${title}“ (${id}).`,
  en: (title, id) => `Restored event “${title}” (${id}).`,
};

/** The field names a change is confirmed by, in the order the schema lists them. */
type FieldName = "title" | "start" | "end" | "allDay" | "location" | "description" | "category" | "reminders";

const FIELD: Record<FieldName, { readonly sr: string; readonly en: string }> = {
  title: { sr: "naslov", en: "title" },
  start: { sr: "početak", en: "start" },
  end: { sr: "kraj", en: "end" },
  allDay: { sr: "celi dan", en: "whole day" },
  location: { sr: "mesto", en: "location" },
  description: { sr: "opis", en: "description" },
  category: { sr: "kategorija", en: "category" },
  reminders: { sr: "podsetnici", en: "reminders" },
};

const UPDATE_SUMMARY: AssistantPhrase<[title: string, fields: string]> = {
  sr: (title, fields) => `Izmeni događaj „${title}“: ${fields}.`,
  en: (title, fields) => `Change event “${title}”: ${fields}.`,
};

const NOTHING_TO_CHANGE: { sr: string; en: string } = {
  sr: "Nema šta da se promeni: navedi bar jedno polje.",
  en: "There is nothing to change: give at least one field.",
};

const DELETE_SUMMARY: AssistantPhrase<[title: string]> = {
  sr: (title) => `Obriši događaj „${title}“.`,
  en: (title) => `Delete event “${title}”.`,
};

const RESTORE_SUMMARY: AssistantPhrase<[id: string]> = {
  sr: (id) => `Vrati obrisani događaj (${id}).`,
  en: (id) => `Restore the deleted event (${id}).`,
};

const NOT_A_SERIES: AssistantPhrase<[title: string]> = {
  sr: (title) => `„${title}“ nije ponavljajući događaj.`,
  en: (title) => `“${title}” is not a recurring event.`,
};

/** One occurrence is skipped, or the series ends before it. Both are said with the day as a sentence part, so the day carries no final full stop. */
const OCCURRENCE_SUMMARY: Record<OccurrenceAction, AssistantPhrase<[title: string, day: string]>> = {
  skip: {
    sr: (title, day) => `Ukloni termin ${day} iz serije „${title}“.`,
    en: (title, day) => `Remove the ${day} occurrence from the series “${title}”.`,
  },
  "split-here": {
    sr: (title, day) => `Prekini seriju „${title}“ pre ${day}: taj i kasniji termini se uklanjaju.`,
    en: (title, day) => `End the series “${title}” before ${day}: that occurrence and the later ones are removed.`,
  },
};

const OCCURRENCE_DONE: Record<OccurrenceAction, AssistantPhrase<[title: string, day: string]>> = {
  skip: {
    sr: (title, day) => `Termin ${day} je uklonjen iz serije „${title}“.`,
    en: (title, day) => `The ${day} occurrence was removed from the series “${title}”.`,
  },
  "split-here": {
    sr: (title, day) => `Serija „${title}“ završava se pre ${day}.`,
    en: (title, day) => `The series “${title}” ends before ${day}.`,
  },
};

const TEMPLATES_HEADING: AssistantPhrase<[count: number]> = {
  sr: (count) => `Šabloni (${count}):`,
  en: (count) => `Templates (${count}):`,
};

const NO_TEMPLATES: { sr: string; en: string } = {
  sr: "Nema sačuvanih šablona.",
  en: "No saved templates.",
};

const TEMPLATE_APPLY_SUMMARY: AssistantPhrase<[name: string, day: string]> = {
  sr: (name, day) => `Postavi šablon „${name}“ na ${day}.`,
  en: (name, day) => `Lay the template “${name}” on ${day}.`,
};

const TEMPLATE_CAPTURE_SUMMARY: AssistantPhrase<[event: string, name: string]> = {
  sr: (event, name) => `Sačuvaj oblik događaja „${event}“ kao šablon „${name}“. Šablon s tim imenom, ako postoji, menja se.`,
  en: (event, name) => `Save the shape of “${event}” as template “${name}”. A template with that name, if there is one, is replaced.`,
};

const TEMPLATE_CAPTURED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Šablon „${name}“ je sačuvan.`,
  en: (name) => `The template “${name}” is saved.`,
};

const TEMPLATE_DELETE_SUMMARY: AssistantPhrase<[name: string]> = {
  sr: (name) => `Obriši šablon „${name}“.`,
  en: (name) => `Delete the template “${name}”.`,
};

const TEMPLATE_DELETED: AssistantPhrase<[name: string]> = {
  sr: (name) => `Šablon „${name}“ je obrisan.`,
  en: (name) => `The template “${name}” is deleted.`,
};

const TERM_SHAPE: { sr: string; en: string } = {
  sr: "Semestar se zadaje sa oba datuma (start i end) ili se briše sa clear: true, ali ne oboje.",
  en: "The term takes both dates (start and end), or clear: true to remove it, never both.",
};

const TERM_ORDER: { sr: string; en: string } = {
  sr: "Početak semestra ne sme biti posle kraja.",
  en: "The term cannot start after it ends.",
};

const TERM_SUMMARY: AssistantPhrase<[from: string, to: string]> = {
  sr: (from, to) => `Postavi semestar od ${from} do ${to}.`,
  en: (from, to) => `Set the term from ${from} to ${to}.`,
};

const TERM_CLEAR_SUMMARY: { sr: string; en: string } = {
  sr: "Obriši datume semestra.",
  en: "Clear the term dates.",
};

const TERM_SET: AssistantPhrase<[from: string, to: string]> = {
  sr: (from, to) => `Semestar je od ${from} do ${to}.`,
  en: (from, to) => `The term runs from ${from} to ${to}.`,
};

const TERM_CLEARED: { sr: string; en: string } = {
  sr: "Datumi semestra su obrisani.",
  en: "The term dates are cleared.",
};

/** A row's own words: the whole-day reading, and the word a continuing row carries in place of a clock time. */
const ROW_WORDS: {
  readonly allDay: { readonly sr: string; readonly en: string };
  readonly continued: { readonly sr: string; readonly en: string };
} = {
  allDay: { sr: "celi dan", en: "all day" },
  continued: { sr: "u toku", en: "ongoing" },
};

export function calendarTools(deps: CalendarToolDeps): readonly Tool[] {
  function eventStore(profileId: string): EventStore {
    return deps.profileDb(profileId, (db, id) => new EventStore(db, id));
  }

  function templateStore(profileId: string): EventTemplateStore {
    return deps.profileDb(profileId, (db, id) => new EventTemplateStore(db, id));
  }

  function termStore(profileId: string): CalendarSettingsStore {
    return deps.profileDb(profileId, (db, id) => new CalendarSettingsStore(db, id));
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
      sr: "Pravi događaj u kalendaru. Koristi ga kada korisnik kaže da nešto treba da se nađe u kalendaru. `start` je ISO datum ili datum i vreme; za ceo dan pošalji samo datum i `allDay`.",
      en: "Creates a calendar event. Use it when the user says something should be in the calendar. `start` is an ISO date or date-time; for a whole day send only the date and `allDay`.",
    },
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: MAX_TITLE_CHARS, description: "What the event is." },
        start: { type: "string", maxLength: 40, description: "ISO date (2026-10-12) or date-time (2026-10-12T18:00)." },
        end: { type: "string", maxLength: 40, description: "ISO end, if the user gave one." },
        allDay: { type: "boolean", description: "True for a whole-day event." },
        location: { type: "string", maxLength: MAX_LOCATION_CHARS, description: "Where, if the user said." },
        description: { type: "string", maxLength: MAX_DESCRIPTION_CHARS, description: "Extra detail, if given." },
        category: { type: "string", maxLength: MAX_CATEGORY_CHARS, description: "Its calendar category, if named." },
        repeat: {
          type: "string",
          enum: [...REPEATS],
          description: "Repeats from the start day: daily, weekdays, weekly, monthly or yearly.",
        },
        repeatUntil: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Last day of the repeat, YYYY-MM-DD." },
        remindMinutesBefore: reminderList(),
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
        const category = asOptionalText(args.category, "category", MAX_CATEGORY_CHARS);
        const repeat = asOptionalEnum(args.repeat, "repeat", REPEATS);
        const repeatUntil = asOptionalDay(args.repeatUntil, "repeatUntil");
        const reminders = asOptionalReminders(args.remindMinutesBefore, "remindMinutesBefore");
        if (repeatUntil !== undefined && (repeat === undefined || repeatUntil < dayOf(start))) {
          throw new Error(text(context.locale, REPEAT_UNTIL_INVALID));
        }

        const timing = when(context.locale, start, allDay ?? false);
        const declined = await confirmOrDecline(
          context,
          "calendar.create",
          "write",
          phrase(
            context.locale,
            CREATE_SUMMARY,
            title,
            repeat === undefined
              ? timing
              : phrase(context.locale, REPEATING, timing, text(context.locale, REPEAT_WORDS[repeat])),
          ),
        );
        if (declined !== null) return declined;

        const created = eventStore(context.profileId).create(
          createInput({ title, start, end, allDay, location, description, category, repeat, repeatUntil, reminders }),
        );
        return revealed(phrase(context.locale, CREATED, created.title, created.id), created);
      }),
  };

  const update: Tool = {
    name: "calendar.update",
    description: {
      sr: "Menja događaj: naslov, početak, kraj, celi dan, mesto, opis ili podsetnike. Navedi samo polja koja se menjaju. Koristi ga kada korisnik kaže da je termin pomeren ili da treba nešto u njemu promeniti.",
      en: "Changes an event: its title, start, end, whole-day flag, location, description or reminders. Send only the fields that change. Use it when the user moves an event or wants something in it changed.",
    },
    parameters: {
      type: "object",
      properties: {
        event: eventReference(),
        title: { type: "string", minLength: 1, maxLength: MAX_TITLE_CHARS, description: "The new title." },
        start: { type: "string", maxLength: 40, description: "The new start, as an ISO date or date-time." },
        end: { type: "string", maxLength: 40, description: "The new end, as an ISO date or date-time." },
        allDay: { type: "boolean", description: "Whether it now occupies the whole day." },
        location: { type: "string", maxLength: MAX_LOCATION_CHARS, description: "The new place." },
        description: { type: "string", maxLength: MAX_DESCRIPTION_CHARS, description: "The new detail." },
        category: { type: "string", maxLength: MAX_CATEGORY_CHARS, description: "The new calendar category." },
        remindMinutesBefore: reminderList(),
      },
      required: ["event"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const store = eventStore(context.profileId);
        const event = findNamed(
          store.listActive(),
          asText(args.event, "event", MAX_TITLE_CHARS),
          (row) => row.title,
          text(context.locale, NOUN.event),
          context.locale,
        );
        const edits = {
          title: asOptionalText(args.title, "title", MAX_TITLE_CHARS),
          start: asOptionalInstant(args.start, "start"),
          end: asOptionalInstant(args.end, "end"),
          allDay: asOptionalBoolean(args.allDay, "allDay"),
          location: asOptionalText(args.location, "location", MAX_LOCATION_CHARS),
          description: asOptionalText(args.description, "description", MAX_DESCRIPTION_CHARS),
          category: asOptionalText(args.category, "category", MAX_CATEGORY_CHARS),
          reminders: asOptionalReminders(args.remindMinutesBefore, "remindMinutesBefore"),
        };
        const changes = updateInput(edits);
        const changed = (Object.keys(edits) as FieldName[])
          .filter((key) => edits[key] !== undefined)
          .map((key) => text(context.locale, FIELD[key]));
        if (changed.length === 0) throw new Error(text(context.locale, NOTHING_TO_CHANGE));

        const declined = await confirmOrDecline(
          context,
          "calendar.update",
          "write",
          phrase(context.locale, UPDATE_SUMMARY, event.title, changed.join(", ")),
        );
        if (declined !== null) return declined;

        const updated = store.update(event.id, changes);
        return revealed(phrase(context.locale, UPDATED, updated.title, updated.id), updated);
      }),
  };

  const remove: Tool = {
    name: "calendar.delete",
    description: {
      sr: "Briše događaj iz kalendara; može se vratiti. Koristi ga kada korisnik kaže da neki termin treba izbrisati ili otkazati.",
      en: "Deletes an event from the calendar; it can be restored. Use it when the user says an event should be deleted or cancelled.",
    },
    parameters: {
      type: "object",
      properties: { event: eventReference() },
      required: ["event"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const store = eventStore(context.profileId);
        const event = findNamed(
          store.listActive(),
          asText(asArgs(rawArgs).event, "event", MAX_TITLE_CHARS),
          (row) => row.title,
          text(context.locale, NOUN.event),
          context.locale,
        );
        const declined = await confirmOrDecline(
          context,
          "calendar.delete",
          "write",
          phrase(context.locale, DELETE_SUMMARY, event.title),
        );
        if (declined !== null) return declined;

        store.softDelete(event.id);
        return okResult(phrase(context.locale, DELETED, event.title, event.id));
      }),
  };

  const restore: Tool = {
    name: "calendar.restore",
    description: {
      sr: "Vraća obrisani događaj po id-ju koji je brisanje prijavilo. Koristi ga kada korisnik kaže da vrati događaj koji je obrisao.",
      en: "Restores a deleted event by the id its deletion reported. Use it when the user asks to bring back an event they deleted.",
    },
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", minLength: 1, maxLength: MAX_ID_LENGTH, description: "The id the deletion reported." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const id = asIdentifier(asArgs(rawArgs).id, "id");
        const declined = await confirmOrDecline(
          context,
          "calendar.restore",
          "write",
          phrase(context.locale, RESTORE_SUMMARY, id),
        );
        if (declined !== null) return declined;

        const store = eventStore(context.profileId);
        store.restore(id);
        const restored = store.listActive().find((row) => row.id === id);
        if (restored === undefined) throw new Error(`No active event "${id}" after the restore.`);
        return revealed(phrase(context.locale, RESTORED, restored.title, restored.id), restored);
      }),
  };

  const occurrence: Tool = {
    name: "calendar.occurrence",
    description: {
      sr: "Menja jedno ponavljanje serije: preskače jedan termin ili prekida seriju od tog dana nadalje. Za promenu od tog dana nadalje posle prekida pozovi calendar.create sa novim vremenom.",
      en: "Changes one occurrence of a recurring event: skips one day, or ends the series from that day on. To change it from that day on, follow with calendar.create using the new details.",
    },
    parameters: {
      type: "object",
      properties: {
        event: eventReference(),
        action: {
          type: "string",
          enum: [...OCCURRENCE_ACTIONS],
          description: "skip removes that day only; split-here ends the series from that day on.",
        },
        day: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "The occurrence's day, as YYYY-MM-DD." },
      },
      required: ["event", "action", "day"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const action = asEnum(args.action, "action", OCCURRENCE_ACTIONS);
        const day = asDay(args.day, "day");
        const store = eventStore(context.profileId);
        const event = findNamed(
          store.listActive(),
          asText(args.event, "event", MAX_TITLE_CHARS),
          (row) => row.title,
          text(context.locale, NOUN.event),
          context.locale,
        );
        if (event.recurrence === null) throw new Error(phrase(context.locale, NOT_A_SERIES, event.title));

        const sentenceDay = formatDayInSentence(context.locale, day);
        const declined = await confirmOrDecline(
          context,
          "calendar.occurrence",
          "write",
          phrase(context.locale, OCCURRENCE_SUMMARY[action], event.title, sentenceDay),
        );
        if (declined !== null) return declined;

        const now = new Date().toISOString();
        if (action === "skip") {
          store.addRecurrenceExdate(event.id, day, now);
        } else {
          store.splitRecurrence(event.id, day, now);
        }
        return revealed(phrase(context.locale, OCCURRENCE_DONE[action], event.title, sentenceDay), event);
      }),
  };

  const templates: Tool = {
    name: "calendar.templates",
    description: {
      sr: "Izlistava sačuvane šablone događaja (oblik dana: vreme i trajanje). Koristi ga kada korisnik pita koje šablone ima, ili pre nego što primeni jedan.",
      en: "Lists the saved event templates, each a shape of a day: its time and length. Use it when the user asks which templates they have, or before applying one.",
    },
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
    effect: "read",
    run: (_rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const all = templateStore(context.profileId).list();
        if (all.length === 0) return okResult(text(context.locale, NO_TEMPLATES));
        const shown = all.slice(0, MAX_ROWS);
        const content = [
          phrase(context.locale, TEMPLATES_HEADING, all.length),
          ...shown.map((template) => `- ${template.id} ${template.name} [${templateShape(context.locale, template)}]`),
        ];
        if (shown.length < all.length) content.push(phrase(context.locale, MORE_ROWS, shown.length));
        return okResult(content.join("\n"));
      }),
  };

  const template: Tool = {
    name: "calendar.template",
    description: {
      sr: "Primenjuje šablon na dan, čuva oblik događaja kao šablon ili briše šablon. Koristi ga kada korisnik kaže da na dan stavi uobičajen raspored, da neki termin sačuva kao šablon ili da obriše šablon.",
      en: "Applies a template to a day, saves an event's shape as a template, or deletes a template. Use it when the user wants a usual shape laid on a day, an event kept as a template, or a template removed.",
    },
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [...TEMPLATE_ACTIONS],
          description: "apply lays the template on a day; capture saves an event as the template; delete removes it.",
        },
        template: {
          type: "string",
          minLength: 1,
          maxLength: MAX_EVENT_TEMPLATE_NAME_LENGTH,
          description: "The template's name, or its id. For capture, the name to save it under.",
        },
        event: { ...eventReference(), description: "For capture: the event to take the shape from, by its id or exact title." },
        day: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "For apply: the day to lay it on, as YYYY-MM-DD." },
      },
      required: ["action", "template"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const action = asEnum(args.action, "action", TEMPLATE_ACTIONS);
        const wanted = asText(args.template, "template", MAX_EVENT_TEMPLATE_NAME_LENGTH);
        const store = templateStore(context.profileId);

        if (action === "capture") {
          const event = findNamed(
            eventStore(context.profileId).listActive(),
            asText(args.event, "event", MAX_TITLE_CHARS),
            (row) => row.title,
            text(context.locale, NOUN.event),
            context.locale,
          );
          const declined = await confirmOrDecline(
            context,
            "calendar.template",
            "write",
            phrase(context.locale, TEMPLATE_CAPTURE_SUMMARY, event.title, wanted),
          );
          if (declined !== null) return declined;
          const saved = store.captureFromEvent(event.id, wanted, new Date().toISOString());
          return okResult(phrase(context.locale, TEMPLATE_CAPTURED, saved.name));
        }

        const found = findNamed(store.list(), wanted, (row) => row.name, text(context.locale, NOUN.template), context.locale);
        if (action === "delete") {
          const declined = await confirmOrDecline(
            context,
            "calendar.template",
            "write",
            phrase(context.locale, TEMPLATE_DELETE_SUMMARY, found.name),
          );
          if (declined !== null) return declined;
          store.delete(found.id);
          return okResult(phrase(context.locale, TEMPLATE_DELETED, found.name));
        }

        const day = asDay(args.day, "day");
        const declined = await confirmOrDecline(
          context,
          "calendar.template",
          "write",
          phrase(context.locale, TEMPLATE_APPLY_SUMMARY, found.name, formatDayInSentence(context.locale, day)),
        );
        if (declined !== null) return declined;
        const created = store.apply(found.id, day);
        return revealed(phrase(context.locale, CREATED, created.title, created.id), created);
      }),
  };

  const term: Tool = {
    name: "calendar.term",
    description: {
      sr: "Postavlja ili briše početak i kraj semestra, koji određuju prikaz Semestar u kalendaru. Koristi ga kada korisnik kaže kada semestar počinje ili se završava.",
      en: "Sets or clears the start and end of the semester, which the calendar's Semester view runs on. Use it when the user says when the semester starts or ends.",
    },
    parameters: {
      type: "object",
      properties: {
        start: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "First day of the term, as YYYY-MM-DD." },
        end: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Last day of the term, as YYYY-MM-DD." },
        clear: { type: "boolean", description: "True to remove the term's dates. Send it alone, without start and end." },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const start = asOptionalDay(args.start, "start");
        const end = asOptionalDay(args.end, "end");
        const clear = asOptionalBoolean(args.clear, "clear") === true;
        const store = termStore(context.profileId);

        if (clear) {
          if (start !== undefined || end !== undefined) throw new Error(text(context.locale, TERM_SHAPE));
          const declined = await confirmOrDecline(context, "calendar.term", "write", text(context.locale, TERM_CLEAR_SUMMARY));
          if (declined !== null) return declined;
          store.save({ semesterStart: null, semesterEnd: null });
          return okResult(text(context.locale, TERM_CLEARED), { navigateTo: { module: "calendar" } });
        }

        if (start === undefined || end === undefined) throw new Error(text(context.locale, TERM_SHAPE));
        if (start > end) throw new Error(text(context.locale, TERM_ORDER));
        const from = formatDayInSentence(context.locale, start);
        const to = formatDayInSentence(context.locale, end);
        const declined = await confirmOrDecline(context, "calendar.term", "write", phrase(context.locale, TERM_SUMMARY, from, to));
        if (declined !== null) return declined;
        store.save({ semesterStart: start, semesterEnd: end });
        return okResult(phrase(context.locale, TERM_SET, from, to), { navigateTo: { module: "calendar" } });
      }),
  };

  return [events, create, update, remove, restore, occurrence, templates, template, term];
}

/** The schema of an event argument: its id as `calendar.events` reports it, or its exact title. */
function eventReference(): { type: "string"; minLength: number; maxLength: number; description: string } {
  return {
    type: "string",
    minLength: 1,
    maxLength: MAX_TITLE_CHARS,
    description: "The event: its id as calendar.events reports it, or its exact title.",
  };
}

/** The schema of a reminder ladder: whole minutes before the start, at most the store's own count. */
function reminderList(): {
  type: "array";
  items: { type: "integer"; minimum: number; maximum: number };
  maxItems: number;
  description: string;
} {
  return {
    type: "array",
    items: { type: "integer", minimum: 0, maximum: MAX_EVENT_REMINDER_MINUTES },
    maxItems: MAX_EVENT_REMINDERS,
    description: "Minutes before the start to remind, e.g. 10 or 1440.",
  };
}

/** A reminder ladder the model may leave out; each lead time goes through the same bounded reader as any count. */
function asOptionalReminders(value: unknown, field: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`"${field}" must be a list of whole minutes.`);
  if (value.length > MAX_EVENT_REMINDERS) {
    throw new Error(`"${field}" may hold at most ${String(MAX_EVENT_REMINDERS)} entries.`);
  }
  return value.map((entry) => asCount(entry, field, 0, MAX_EVENT_REMINDER_MINUTES));
}

/** The store input a create call names: only the fields the model gave, and a repeat turned into the rule its start day anchors. */
function createInput(args: {
  readonly title: string;
  readonly start: string;
  readonly end: string | undefined;
  readonly allDay: boolean | undefined;
  readonly location: string | undefined;
  readonly description: string | undefined;
  readonly category: string | undefined;
  readonly repeat: Repeat | undefined;
  readonly repeatUntil: string | undefined;
  readonly reminders: readonly number[] | undefined;
}): CreateEventInput {
  const input: CreateEventInput = { title: args.title, startAt: args.start };
  if (args.end !== undefined) input.endAt = args.end;
  if (args.allDay !== undefined) input.allDay = args.allDay;
  if (args.location !== undefined) input.location = args.location;
  if (args.description !== undefined) input.description = args.description;
  if (args.category !== undefined) input.category = args.category;
  if (args.repeat !== undefined) {
    input.recurrence = recurrenceOf(args.repeat, asDay(dayOf(args.start), "start"), args.repeatUntil);
  }
  if (args.reminders !== undefined) input.reminderOffsets = [...args.reminders];
  return input;
}

/** The store patch an update names. An omitted field stays as it is; the store owns the rest. */
function updateInput(edits: {
  readonly title: string | undefined;
  readonly start: string | undefined;
  readonly end: string | undefined;
  readonly allDay: boolean | undefined;
  readonly location: string | undefined;
  readonly description: string | undefined;
  readonly category: string | undefined;
  readonly reminders: readonly number[] | undefined;
}): UpdateEventFields {
  const patch: UpdateEventFields = {};
  if (edits.title !== undefined) patch.title = edits.title;
  if (edits.start !== undefined) patch.startAt = edits.start;
  if (edits.end !== undefined) patch.endAt = edits.end;
  if (edits.allDay !== undefined) patch.allDay = edits.allDay;
  if (edits.location !== undefined) patch.location = edits.location;
  if (edits.description !== undefined) patch.description = edits.description;
  if (edits.category !== undefined) patch.category = edits.category;
  if (edits.reminders !== undefined) patch.reminderOffsets = [...edits.reminders];
  return patch;
}

/** The rule a repeat names, anchored on the new event's start day and ending on `until` when the user gave one. */
function recurrenceOf(repeat: Repeat, day: string, until: string | undefined): RecurrenceRule {
  return {
    freq: frequencyOf(repeat, day),
    end: until === undefined ? { kind: "never" } : { kind: "until", date: until },
  };
}

function frequencyOf(repeat: Repeat, day: string): RecurrenceFreq {
  switch (repeat) {
    case "daily":
      return { kind: "daily", interval: 1 };
    case "weekdays":
      return { kind: "weekdays" };
    case "weekly":
      return { kind: "weekly", interval: 1, days: [weekdayOf(day)] };
    case "monthly":
      return { kind: "monthly-date", interval: 1, day: Number(day.slice(8, 10)) };
    case "yearly":
      return { kind: "yearly", interval: 1 };
  }
}

/** Monday-first weekday index of a bare day, the way the recurrence engine counts them. */
function weekdayOf(day: string): RecurrenceWeekday {
  return ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) as RecurrenceWeekday;
}

/** The one item a reference names: the one with that id, else the one whose name matches ignoring case and diacritics, and an ambiguous name is refused with its candidates. */
function findNamed<T extends { readonly id: string }>(
  items: readonly T[],
  wanted: string,
  nameOf: (item: T) => string,
  noun: string,
  locale: AssistantLocale,
): T {
  const byId = items.find((item) => item.id === wanted);
  if (byId !== undefined) return byId;
  const needle = foldSearchText(wanted);
  const named = items.filter((item) => foldSearchText(nameOf(item).trim()) === needle);
  const [first] = named;
  if (first === undefined) throw new Error(phrase(locale, NOT_FOUND, noun, wanted));
  if (named.length > 1) {
    throw new Error(
      phrase(locale, AMBIGUOUS, noun, wanted, named.map((item) => `${nameOf(item)} (${item.id})`).join(", ")),
    );
  }
  return first;
}

/** A result that names the event it changed and reveals it on the calendar. */
function revealed(message: string, event: Event): ToolResult {
  return okResult(message, {
    citations: [
      {
        kind: "event",
        id: event.id,
        title: event.title,
        location: { module: "calendar", item: event.id },
      },
    ],
    navigateTo: { module: "calendar", item: event.id },
  });
}

/** A template's shape as a row reads it: its time and length, or the whole-day reading. */
function templateShape(locale: AssistantLocale, template: EventTemplate): string {
  const { payload } = template;
  if (payload.allDay) return text(locale, ROW_WORDS.allDay);
  if (payload.durationMinutes === null) return payload.startTime ?? "";
  const length = formatDuration(locale, payload.durationMinutes * 60);
  return `${payload.startTime ?? ""}, ${length}`;
}

/** One occurrence as a row of the expanded stream: which occurrence of which stored event, and the day it is listed on. */
interface Occurrence {
  readonly event: Event;
  readonly day: string;
  /** True when the occurrence began before the window and is listed on its first day, marked as continuing. */
  readonly continued: boolean;
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
 * as many days before `from` as the master lasts, so an occurrence that began
 * before the window still shows when it spills into it. The exdates are the
 * master's own removed days, honoured by the same call the renderer uses.
 */
function expand(rows: readonly Event[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  for (const event of rows) {
    const startDay = dayOf(event.startAt);
    if (!isValidDayKey(startDay)) continue;
    const endDay = dayOf(event.endAt ?? event.startAt);
    const spanDays = isValidDayKey(endDay) ? Math.max(0, daysBetween(startDay, endDay)) : 0;

    if (event.recurrence === null) {
      if (endDay >= from && startDay <= to) out.push(occurrenceOf(event, startDay, from));
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
      out.push(occurrenceOf(event, day, from));
    }
  }
  return out;
}

/**
 * One occurrence starting on `start`, as a row of the window. One that began
 * before the window is listed on the window's first day, marked as continuing,
 * with no clock time: its clock belongs to a day the answer does not show.
 */
function occurrenceOf(event: Event, start: string, from: string): Occurrence {
  const continued = start < from;
  return {
    event,
    day: continued ? from : start,
    continued,
    time: continued ? null : clockOf(event.startAt),
    endTime: continued ? null : clockOf(event.endAt ?? ""),
    allDay: event.allDay,
  };
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
  if (occurrence.continued) {
    parts.push(text(locale, ROW_WORDS.continued));
  } else if (occurrence.allDay) {
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
