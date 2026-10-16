/**
 * The PEOPLE and DOCUMENTS the calendar keeps: the birthdays and anniversaries
 * its agenda reads, and the tracked documents (passport, licence, registration)
 * whose expiry it warns about.
 *
 * **Every read and write is the store the IPC channel calls.** `people:*` and
 * `documents:*` in `main/index.ts` call `PeopleStore` and `DocumentStore`, and so
 * does this file, with the same field names. The stores own the rules that
 * matter here — the year window, the reminder ladder a document takes from its
 * type, the renewal row written with the new expiry — and a tool that restated
 * one would be a second copy that disagrees the first time a rule moves. The one
 * check repeated here is the month/day pair, and only because it must run BEFORE
 * the confirmation: a day that cannot exist is never offered to the user.
 *
 * **Where they show.** Both live on the calendar page, in its „Ljudi" and
 * „Dokumenta" views. A `navigateTo` names a module, not a view, and the shell maps
 * an item onto the calendar's EVENT reveal, which is the wrong target for a person
 * or a document. So the answer lands on the calendar, and no item is named.
 *
 * **Names are how a person refers to a row.** A person or a document is given by
 * its id or its name (label), folded for case and diacritics; a name shared by
 * several rows is refused with the candidates and their ids, never guessed.
 */

import {
  DOCUMENT_TYPES,
  DocumentStore,
  PERSON_KINDS,
  PeopleStore,
  type CreateDocumentInput,
  type CreatePersonInput,
  type DocumentType,
  type Person,
  type PersonKind,
  type TrackedDocument,
  type UpdateDocumentFields,
  type UpdatePersonFields,
} from "@nexus/db";
import { foldSearchText, type AssistantLocale, type AssistantText, type Tool } from "@nexus/core";
import { asCappedChars } from "../../ipcValidators.js";
import {
  asArgs,
  asCount,
  asDay,
  asEnum,
  asOptionalCount,
  asOptionalEnum,
  asText,
} from "./args.js";
import {
  assertLive,
  collator,
  confirmOrDecline,
  failResult,
  formatDayInSentence,
  formatDayShort,
  formatNumber,
  guard,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface DirectoryToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
  /** See `ToolDeps.now`; a person's stamps are taken from it, as the IPC handler takes them. */
  readonly now: () => number;
}

/**
 * Policy caps, not measurements: how many rows one read answers with (it says
 * when more exist), and the longest text a model may write into a row. The stores
 * set no length of their own, so these bound what an argument may carry.
 */
const MAX_ROWS = 50;
const MAX_NAME_CHARS = 120;
const MAX_NOTE_CHARS = 500;
const MAX_LADDER_STEPS = 10;
/** A reminder more than a year ahead of an expiry is not one anybody asked for. */
const MAX_REMINDER_DAYS = 365;

/** The window `PeopleStore` checks a birth or start year against, restated so a bad year is refused before the question. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/** The leap year `PeopleStore` checks a month/day pair against, so 29 February is a day. */
const LEAP_YEAR = 2024;

/** The shape of a calendar day in a schema; `asDay` checks that it is a real day. */
const DAY_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

const PERSON_REFUSALS: Refusals = {
  unknown: {
    sr: (wanted, known) => `Nema osobe „${wanted}“. Poznate osobe: ${known}.`,
    en: (wanted, known) => `No person “${wanted}”. Known people: ${known}.`,
  },
  ambiguous: {
    sr: (wanted, candidates) => `Ima više osoba „${wanted}“: ${candidates}. Navedi id.`,
    en: (wanted, candidates) => `Several people are called “${wanted}”: ${candidates}. Give the id.`,
  },
};

const DOCUMENT_REFUSALS: Refusals = {
  unknown: {
    sr: (wanted, known) => `Nema dokumenta „${wanted}“. Praćeni dokumenti: ${known}.`,
    en: (wanted, known) => `No document “${wanted}”. Tracked documents: ${known}.`,
  },
  ambiguous: {
    sr: (wanted, candidates) => `Ima više dokumenata „${wanted}“: ${candidates}. Navedi id.`,
    en: (wanted, candidates) => `Several documents are called “${wanted}”: ${candidates}. Give the id.`,
  },
};

/** The kinds of person, as the calendar's agenda writes them. */
const KIND_WORDS: Record<PersonKind, AssistantText> = {
  birthday: { sr: "rođendan", en: "birthday" },
  anniversary: { sr: "godišnjica", en: "anniversary" },
};

/** The document types, as the Documents view names them. */
const TYPE_WORDS: Record<DocumentType, AssistantText> = {
  licna_karta: { sr: "lična karta", en: "ID card" },
  pasos: { sr: "pasoš", en: "passport" },
  vozacka: { sr: "vozačka dozvola", en: "driving licence" },
  registracija: { sr: "registracija vozila", en: "vehicle registration" },
  kartica: { sr: "bankovna kartica", en: "bank card" },
  polisa: { sr: "polisa osiguranja", en: "insurance policy" },
  custom: { sr: "ostalo", en: "other" },
};

/** The field names a change summary lists, so the user sees which parts of a row will move. */
const FIELD_WORDS = {
  name: { sr: "ime", en: "name" },
  kind: { sr: "vrsta", en: "kind" },
  date: { sr: "datum", en: "date" },
  year: { sr: "godina", en: "year" },
  note: { sr: "beleška", en: "note" },
  type: { sr: "tip", en: "type" },
  expiry: { sr: "rok", en: "expiry" },
  reminders: { sr: "podsetnici", en: "reminders" },
};

const NONE: AssistantText = { sr: "nijedna", en: "none" };
const NO_PEOPLE: AssistantText = {
  sr: "Nema sačuvanih rođendana ni godišnjica.",
  en: "No birthdays or anniversaries are saved.",
};
const NO_DOCUMENTS: AssistantText = {
  sr: "Nema praćenih dokumenata.",
  en: "No documents are tracked.",
};
const NOTHING_TO_CHANGE: AssistantText = {
  sr: "Nema šta da se promeni.",
  en: "There is nothing to change.",
};
const DUE_TODAY: AssistantText = { sr: "rok ističe danas", en: "expires today" };
const INVALID_DAY: AssistantText = {
  sr: "Taj datum ne postoji.",
  en: "That day does not exist.",
};

const MORE: AssistantPhrase<[count: string]> = {
  sr: (count) => `… i još ${count}.`,
  en: (count) => `… and ${count} more.`,
};

const EXPIRY_IN: AssistantPhrase<[amount: string]> = {
  sr: (amount) => `rok ističe za ${amount}`,
  en: (amount) => `expires in ${amount}`,
};
const EXPIRY_AGO: AssistantPhrase<[amount: string]> = {
  sr: (amount) => `rok je istekao pre ${amount}`,
  en: (amount) => `expired ${amount} ago`,
};

const PERSON_SAVED: AssistantPhrase<[name: string, id: string]> = {
  sr: (name, id) => `Sačuvana je osoba „${name}“ (${id}).`,
  en: (name, id) => `Saved “${name}” (${id}).`,
};
const PERSON_UPDATED: AssistantPhrase<[name: string, id: string]> = {
  sr: (name, id) => `Izmenjena je osoba „${name}“ (${id}).`,
  en: (name, id) => `Updated “${name}” (${id}).`,
};
const PERSON_DELETED: AssistantPhrase<[name: string, id: string]> = {
  sr: (name, id) => `Osoba „${name}“ je obrisana (${id}).`,
  en: (name, id) => `Deleted “${name}” (${id}).`,
};
const DOCUMENT_SAVED: AssistantPhrase<[label: string, id: string, expiry: string]> = {
  sr: (label, id, expiry) => `Dokument „${label}“ je sačuvan (${id}); ${expiry}.`,
  en: (label, id, expiry) => `Saved “${label}” (${id}); ${expiry}.`,
};
const DOCUMENT_UPDATED: AssistantPhrase<[label: string, id: string, expiry: string]> = {
  sr: (label, id, expiry) => `Izmenjen je dokument „${label}“ (${id}); ${expiry}.`,
  en: (label, id, expiry) => `Updated “${label}” (${id}); ${expiry}.`,
};
const DOCUMENT_DELETED: AssistantPhrase<[label: string, id: string]> = {
  sr: (label, id) => `Dokument „${label}“ je obrisan (${id}).`,
  en: (label, id) => `Deleted “${label}” (${id}).`,
};
const DOCUMENT_RENEWED: AssistantPhrase<[label: string, id: string, expiry: string]> = {
  sr: (label, id, expiry) => `Dokument „${label}“ je obnovljen (${id}); ${expiry}.`,
  en: (label, id, expiry) => `Renewed “${label}” (${id}); ${expiry}.`,
};

const ADD_PERSON: AssistantPhrase<[name: string, kind: string, date: string]> = {
  sr: (name, kind, date) => `Dodati osobu „${name}“: ${kind}, ${date}.`,
  en: (name, kind, date) => `Add “${name}”: ${kind}, ${date}.`,
};
const UPDATE_PERSON: AssistantPhrase<[name: string, changes: string]> = {
  sr: (name, changes) => `Izmeniti osobu „${name}“: ${changes}.`,
  en: (name, changes) => `Change “${name}”: ${changes}.`,
};
const DELETE_PERSON: AssistantPhrase<[name: string, kind: string, date: string]> = {
  sr: (name, kind, date) => `Obrisati osobu „${name}“ (${kind}, ${date}).`,
  en: (name, kind, date) => `Delete “${name}” (${kind}, ${date}).`,
};
const ADD_DOCUMENT: AssistantPhrase<[label: string, type: string, expiry: string]> = {
  sr: (label, type, expiry) => `Dodati dokument „${label}“ (${type}), rok ${expiry}.`,
  en: (label, type, expiry) => `Add “${label}” (${type}), expiring ${expiry}.`,
};
const UPDATE_DOCUMENT: AssistantPhrase<[label: string, changes: string]> = {
  sr: (label, changes) => `Izmeniti dokument „${label}“: ${changes}.`,
  en: (label, changes) => `Change “${label}”: ${changes}.`,
};
const DELETE_DOCUMENT: AssistantPhrase<[label: string, type: string, expiry: string]> = {
  sr: (label, type, expiry) => `Obrisati dokument „${label}“ (${type}, rok ${expiry}).`,
  en: (label, type, expiry) => `Delete “${label}” (${type}, expiring ${expiry}).`,
};
const RENEW_DOCUMENT: AssistantPhrase<[label: string, expiry: string]> = {
  sr: (label, expiry) => `Obnoviti dokument „${label}“: novi rok ${expiry}.`,
  en: (label, expiry) => `Renew “${label}”: new expiry ${expiry}.`,
};

/** A refusal for a name that matches no row, or several. */
interface Refusals {
  readonly unknown: AssistantPhrase<[wanted: string, known: string]>;
  readonly ambiguous: AssistantPhrase<[wanted: string, candidates: string]>;
}

/** Serbian nouns take „dan" for one day and „dana" for any other count, which `Intl` knows as the „one" category. */
const SR_PLURAL = new Intl.PluralRules("sr-Latn");

export function directoryTools(deps: DirectoryToolDeps): readonly Tool[] {
  const peopleList: Tool = {
    name: "people.list",
    description: {
      sr: "Čita osobe sa rođendanima i godišnjicama iz kalendara: ime, datum i godinu ako je poznata. Koristi ga kada korisnik pita čiji je rođendan ili godišnjica.",
      en: "Reads the people with birthdays and anniversaries in the calendar: name, date and year when known. Use it when the user asks whose birthday or anniversary it is.",
    },
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: [...PERSON_KINDS],
          description: "Only this kind: birthday or anniversary.",
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const kind = asOptionalEnum(args.kind, "kind", PERSON_KINDS);
        const people = deps
          .profileDb(context.profileId, (db, id) => new PeopleStore(db, id).listActive())
          .filter((person) => kind === undefined || person.kind === kind)
          .sort((left, right) => collator().compare(left.name, right.name));
        if (people.length === 0) return okResult(text(context.locale, NO_PEOPLE));
        return okResult(listed(context.locale, people, (person) => personLine(context.locale, person)));
      }),
  };

  const peopleCreate: Tool = {
    name: "people.create",
    description: {
      sr: "Upisuje osobu sa rođendanom ili godišnjicom u kalendar. Koristi ga kada korisnik traži da zapamti nečiji rođendan ili godišnjicu.",
      en: "Saves a person's birthday or anniversary in the calendar. Use it when the user asks to remember someone's birthday or anniversary.",
    },
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The person's name." },
        kind: { type: "string", enum: [...PERSON_KINDS], description: "birthday or anniversary." },
        month: { type: "integer", minimum: 1, maximum: 12, description: "The month, 1 to 12." },
        day: { type: "integer", minimum: 1, maximum: 31, description: "The day of the month." },
        year: {
          type: "integer",
          minimum: MIN_YEAR,
          maximum: MAX_YEAR,
          description: "The birth or start year, only when the user gives it.",
        },
        note: { type: "string", maxLength: MAX_NOTE_CHARS, description: "A short note." },
      },
      required: ["name", "kind", "month", "day"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const name = asText(args.name, "name", MAX_NAME_CHARS);
        const kind = asEnum(args.kind, "kind", PERSON_KINDS);
        const month = asCount(args.month, "month", 1, 12);
        const day = asCount(args.day, "day", 1, 31);
        const year = asOptionalCount(args.year, "year", MIN_YEAR, MAX_YEAR);
        const note = asOptionalNote(args.note, "note");
        assertCalendarDay(context.locale, month, day);

        const input: CreatePersonInput = { name, kind, month, day };
        if (year !== undefined) input.year = year;
        if (note !== undefined) input.note = note;

        const declined = await confirmOrDecline(
          context,
          "people.create",
          "write",
          phrase(context.locale, ADD_PERSON, name, text(context.locale, KIND_WORDS[kind]), dateText(context.locale, month, day, year ?? null)),
        );
        if (declined !== null) return declined;

        const person = deps.profileDb(context.profileId, (db, id) =>
          new PeopleStore(db, id).create(input, new Date(deps.now()).toISOString()),
        );
        return okResult(phrase(context.locale, PERSON_SAVED, person.name, person.id), {
          navigateTo: { module: "calendar" },
        });
      }),
  };

  const peopleUpdate: Tool = {
    name: "people.update",
    description: {
      sr: "Menja ime, vrstu, datum, godinu ili belešku osobe iz kalendara. Osobu navodi id ili ime. Koristi ga kada korisnik ispravi nečiji datum ili podatak.",
      en: "Changes a person's name, kind, date, year or note in the calendar. Name the person by id or name. Use it when the user corrects someone's date or details.",
    },
    parameters: {
      type: "object",
      properties: {
        person: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The person's id or name." },
        name: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS },
        kind: { type: "string", enum: [...PERSON_KINDS] },
        month: { type: "integer", minimum: 1, maximum: 12 },
        day: { type: "integer", minimum: 1, maximum: 31 },
        year: { type: "integer", minimum: MIN_YEAR, maximum: MAX_YEAR },
        note: { type: "string", maxLength: MAX_NOTE_CHARS, description: "An empty note clears it." },
      },
      required: ["person"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const wanted = asText(args.person, "person", MAX_NAME_CHARS);
        const patch: UpdatePersonFields = {};
        if (args.name !== undefined) patch.name = asText(args.name, "name", MAX_NAME_CHARS);
        if (args.kind !== undefined) patch.kind = asEnum(args.kind, "kind", PERSON_KINDS);
        if (args.month !== undefined) patch.month = asCount(args.month, "month", 1, 12);
        if (args.day !== undefined) patch.day = asCount(args.day, "day", 1, 31);
        if (args.year !== undefined) patch.year = asCount(args.year, "year", MIN_YEAR, MAX_YEAR);
        const note = asOptionalNote(args.note, "note");
        if (note !== undefined) patch.note = note;

        const people = deps.profileDb(context.profileId, (db, id) => new PeopleStore(db, id).listActive());
        const target = resolveRow(people, wanted, (person) => person.name, context.locale, PERSON_REFUSALS);
        const month = patch.month ?? target.month;
        const day = patch.day ?? target.day;
        if (patch.month !== undefined || patch.day !== undefined) {
          assertCalendarDay(context.locale, month, day);
        }

        const changes: string[] = [];
        if (patch.name !== undefined) changes.push(change(context.locale, FIELD_WORDS.name, patch.name));
        if (patch.kind !== undefined) {
          changes.push(change(context.locale, FIELD_WORDS.kind, text(context.locale, KIND_WORDS[patch.kind])));
        }
        if (patch.month !== undefined || patch.day !== undefined) {
          changes.push(change(context.locale, FIELD_WORDS.date, dateText(context.locale, month, day, null)));
        }
        if (patch.year !== undefined) changes.push(change(context.locale, FIELD_WORDS.year, String(patch.year)));
        if (patch.note !== undefined) changes.push(change(context.locale, FIELD_WORDS.note, patch.note || text(context.locale, NONE)));
        if (changes.length === 0) return failResult(context.locale, text(context.locale, NOTHING_TO_CHANGE));

        const declined = await confirmOrDecline(
          context,
          "people.update",
          "write",
          phrase(context.locale, UPDATE_PERSON, target.name, changes.join(", ")),
        );
        if (declined !== null) return declined;

        const person = deps.profileDb(context.profileId, (db, id) =>
          new PeopleStore(db, id).update(target.id, patch, new Date(deps.now()).toISOString()),
        );
        return okResult(phrase(context.locale, PERSON_UPDATED, person.name, person.id), {
          navigateTo: { module: "calendar" },
        });
      }),
  };

  const peopleDelete: Tool = {
    name: "people.delete",
    description: {
      sr: "Briše osobu iz kalendara. Koristi ga kada korisnik kaže da nekoga treba ukloniti iz kalendara rođendana.",
      en: "Deletes a person from the calendar. Use it when the user says someone should be removed from the birthday calendar.",
    },
    parameters: {
      type: "object",
      properties: {
        person: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The person's id or name." },
      },
      required: ["person"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const wanted = asText(asArgs(rawArgs).person, "person", MAX_NAME_CHARS);
        const people = deps.profileDb(context.profileId, (db, id) => new PeopleStore(db, id).listActive());
        const target = resolveRow(people, wanted, (person) => person.name, context.locale, PERSON_REFUSALS);

        const declined = await confirmOrDecline(
          context,
          "people.delete",
          "write",
          phrase(
            context.locale,
            DELETE_PERSON,
            target.name,
            text(context.locale, KIND_WORDS[target.kind]),
            dateText(context.locale, target.month, target.day, target.year),
          ),
        );
        if (declined !== null) return declined;

        deps.profileDb(context.profileId, (db, id) =>
          new PeopleStore(db, id).softDelete(target.id, new Date(deps.now()).toISOString()),
        );
        return okResult(phrase(context.locale, PERSON_DELETED, target.name, target.id), {
          navigateTo: { module: "calendar" },
        });
      }),
  };

  const documentsList: Tool = {
    name: "documents.list",
    description: {
      sr: "Čita praćene dokumente (lična karta, pasoš, vozačka, registracija, kartica, polisa) i koliko dana ostaje do isteka. Koristi ga kada korisnik pita kada mu ističe neki dokument.",
      en: "Reads the tracked documents (ID card, passport, driving licence, registration, bank card, policy) and the days left until each expires. Use it when the user asks when a document expires.",
    },
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...DOCUMENT_TYPES], description: "Only this type." },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const type = asOptionalEnum(asArgs(rawArgs).type, "type", DOCUMENT_TYPES);
        // The store orders by expiry already, so the list reads soonest first.
        const documents = deps
          .profileDb(context.profileId, (db, id) => new DocumentStore(db, id).listActive())
          .filter((document) => type === undefined || document.docType === type);
        if (documents.length === 0) return okResult(text(context.locale, NO_DOCUMENTS));
        return okResult(listed(context.locale, documents, (document) => documentLine(context.locale, document)));
      }),
  };

  const documentsCreate: Tool = {
    name: "documents.create",
    description: {
      sr: "Upisuje dokument sa rokom isteka u praćenje. Ako korisnik ne kaže podsetnike, uzimaju se oni za tip dokumenta. Koristi ga kada korisnik traži da prati rok nekog dokumenta.",
      en: "Saves a document with its expiry date for tracking. Without reminders from the user, the reminders of its type are used. Use it when the user asks to track a document's expiry.",
    },
    parameters: {
      type: "object",
      properties: {
        docType: { type: "string", enum: [...DOCUMENT_TYPES], description: "The document type." },
        label: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "What it is called, e.g. the holder's name." },
        expiryDate: { type: "string", pattern: DAY_PATTERN, description: "The expiry day, YYYY-MM-DD." },
        reminderOffsets: {
          type: "array",
          maxItems: MAX_LADDER_STEPS,
          items: { type: "integer", minimum: 0, maximum: MAX_REMINDER_DAYS },
          description: "Days before expiry to warn on, e.g. [90, 30, 7].",
        },
        notes: { type: "string", maxLength: MAX_NOTE_CHARS },
      },
      required: ["docType", "label", "expiryDate"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const docType = asEnum(args.docType, "docType", DOCUMENT_TYPES);
        const label = asText(args.label, "label", MAX_NAME_CHARS);
        const expiryDate = asDay(args.expiryDate, "expiryDate");
        const reminderOffsets = asOptionalDayCounts(args.reminderOffsets, "reminderOffsets");
        const notes = asOptionalNote(args.notes, "notes");

        const input: CreateDocumentInput = { docType, label, expiryDate };
        if (reminderOffsets !== undefined) input.reminderOffsets = reminderOffsets;
        if (notes !== undefined) input.notes = notes;

        const declined = await confirmOrDecline(
          context,
          "documents.create",
          "write",
          phrase(
            context.locale,
            ADD_DOCUMENT,
            label,
            text(context.locale, TYPE_WORDS[docType]),
            formatDayInSentence(context.locale, expiryDate),
          ),
        );
        if (declined !== null) return declined;

        const document = deps.profileDb(context.profileId, (db, id) => new DocumentStore(db, id).create(input));
        return okResult(
          phrase(context.locale, DOCUMENT_SAVED, document.label, document.id, expiryText(context.locale, document.daysUntilExpiry)),
          { navigateTo: { module: "calendar" } },
        );
      }),
  };

  const documentsUpdate: Tool = {
    name: "documents.update",
    description: {
      sr: "Menja tip, naziv, rok, podsetnike ili belešku praćenog dokumenta. Dokument navodi id ili naziv. Koristi ga kada korisnik ispravi rok ili podatak o dokumentu.",
      en: "Changes a tracked document's type, name, expiry, reminders or note. Name the document by id or name. Use it when the user corrects an expiry or a detail.",
    },
    parameters: {
      type: "object",
      properties: {
        document: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The document's id or name." },
        docType: { type: "string", enum: [...DOCUMENT_TYPES] },
        label: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS },
        expiryDate: { type: "string", pattern: DAY_PATTERN },
        reminderOffsets: {
          type: "array",
          maxItems: MAX_LADDER_STEPS,
          items: { type: "integer", minimum: 0, maximum: MAX_REMINDER_DAYS },
          description: "The whole new list; an empty list clears the reminders.",
        },
        notes: { type: "string", maxLength: MAX_NOTE_CHARS, description: "An empty note clears it." },
      },
      required: ["document"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const wanted = asText(args.document, "document", MAX_NAME_CHARS);
        const fields: UpdateDocumentFields = {};
        if (args.docType !== undefined) fields.docType = asEnum(args.docType, "docType", DOCUMENT_TYPES);
        if (args.label !== undefined) fields.label = asText(args.label, "label", MAX_NAME_CHARS);
        if (args.expiryDate !== undefined) fields.expiryDate = asDay(args.expiryDate, "expiryDate");
        const reminderOffsets = asOptionalDayCounts(args.reminderOffsets, "reminderOffsets");
        if (reminderOffsets !== undefined) fields.reminderOffsets = reminderOffsets;
        const notes = asOptionalNote(args.notes, "notes");
        if (notes !== undefined) fields.notes = notes;

        const documents = deps.profileDb(context.profileId, (db, id) => new DocumentStore(db, id).listActive());
        const target = resolveRow(documents, wanted, (document) => document.label, context.locale, DOCUMENT_REFUSALS);

        const changes: string[] = [];
        if (fields.docType !== undefined) {
          changes.push(change(context.locale, FIELD_WORDS.type, text(context.locale, TYPE_WORDS[fields.docType])));
        }
        if (fields.label !== undefined) changes.push(change(context.locale, FIELD_WORDS.name, fields.label));
        if (fields.expiryDate !== undefined) {
          changes.push(change(context.locale, FIELD_WORDS.expiry, formatDayInSentence(context.locale, fields.expiryDate)));
        }
        if (fields.reminderOffsets !== undefined) {
          changes.push(change(context.locale, FIELD_WORDS.reminders, offsetsText(context.locale, fields.reminderOffsets)));
        }
        if (fields.notes !== undefined) {
          changes.push(change(context.locale, FIELD_WORDS.note, fields.notes || text(context.locale, NONE)));
        }
        if (changes.length === 0) return failResult(context.locale, text(context.locale, NOTHING_TO_CHANGE));

        const declined = await confirmOrDecline(
          context,
          "documents.update",
          "write",
          phrase(context.locale, UPDATE_DOCUMENT, target.label, changes.join(", ")),
        );
        if (declined !== null) return declined;

        const document = deps.profileDb(context.profileId, (db, id) => new DocumentStore(db, id).update(target.id, fields));
        return okResult(
          phrase(context.locale, DOCUMENT_UPDATED, document.label, document.id, expiryText(context.locale, document.daysUntilExpiry)),
          { navigateTo: { module: "calendar" } },
        );
      }),
  };

  const documentsDelete: Tool = {
    name: "documents.delete",
    description: {
      sr: "Briše praćeni dokument. Koristi ga kada korisnik kaže da neki dokument ne treba više da se prati.",
      en: "Deletes a tracked document. Use it when the user says a document should no longer be tracked.",
    },
    parameters: {
      type: "object",
      properties: {
        document: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The document's id or name." },
      },
      required: ["document"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const wanted = asText(asArgs(rawArgs).document, "document", MAX_NAME_CHARS);
        const documents = deps.profileDb(context.profileId, (db, id) => new DocumentStore(db, id).listActive());
        const target = resolveRow(documents, wanted, (document) => document.label, context.locale, DOCUMENT_REFUSALS);

        const declined = await confirmOrDecline(
          context,
          "documents.delete",
          "write",
          phrase(
            context.locale,
            DELETE_DOCUMENT,
            target.label,
            text(context.locale, TYPE_WORDS[target.docType]),
            formatDayInSentence(context.locale, target.expiryDate),
          ),
        );
        if (declined !== null) return declined;

        deps.profileDb(context.profileId, (db, id) => new DocumentStore(db, id).softDelete(target.id));
        return okResult(phrase(context.locale, DOCUMENT_DELETED, target.label, target.id), {
          navigateTo: { module: "calendar" },
        });
      }),
  };

  const documentsRenew: Tool = {
    name: "documents.renew",
    description: {
      sr: "Produžava rok praćenog dokumenta na novi datum i beleži prethodni rok. Koristi ga kada korisnik kaže da je dokument obnovljen ili produžen.",
      en: "Moves a tracked document's expiry to a new date and records the old one. Use it when the user says a document has been renewed or extended.",
    },
    parameters: {
      type: "object",
      properties: {
        document: { type: "string", minLength: 1, maxLength: MAX_NAME_CHARS, description: "The document's id or name." },
        newExpiryDate: { type: "string", pattern: DAY_PATTERN, description: "The new expiry day, YYYY-MM-DD." },
      },
      required: ["document", "newExpiryDate"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const wanted = asText(args.document, "document", MAX_NAME_CHARS);
        const newExpiryDate = asDay(args.newExpiryDate, "newExpiryDate");
        const documents = deps.profileDb(context.profileId, (db, id) => new DocumentStore(db, id).listActive());
        const target = resolveRow(documents, wanted, (document) => document.label, context.locale, DOCUMENT_REFUSALS);

        const declined = await confirmOrDecline(
          context,
          "documents.renew",
          "write",
          phrase(context.locale, RENEW_DOCUMENT, target.label, formatDayInSentence(context.locale, newExpiryDate)),
        );
        if (declined !== null) return declined;

        const renewed = deps.profileDb(context.profileId, (db, id) => new DocumentStore(db, id).renew(target.id, newExpiryDate));
        return okResult(
          phrase(context.locale, DOCUMENT_RENEWED, renewed.label, renewed.id, expiryText(context.locale, renewed.daysUntilExpiry)),
          { navigateTo: { module: "calendar" } },
        );
      }),
  };

  return [
    peopleList,
    peopleCreate,
    peopleUpdate,
    peopleDelete,
    documentsList,
    documentsCreate,
    documentsUpdate,
    documentsDelete,
    documentsRenew,
  ];
}

/** An optional note: a string the store may clear with an empty one, bounded in characters. */
function asOptionalNote(value: unknown, field: string): string | undefined {
  return value === undefined ? undefined : asCappedChars(value, field, MAX_NOTE_CHARS);
}

/** A reminder ladder: a short list of whole day counts, each inside the range the schema states. */
function asOptionalDayCounts(value: unknown, field: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`"${field}" must be a list of day counts.`);
  if (value.length > MAX_LADDER_STEPS) {
    throw new Error(`"${field}" may hold at most ${String(MAX_LADDER_STEPS)} entries.`);
  }
  return value.map((entry) => asCount(entry, field, 0, MAX_REMINDER_DAYS));
}

/**
 * The store's own month/day check, run before a confirmation is asked. February
 * 29 is a day (the leap year stands in for "any year"), 30 February is not.
 */
function assertCalendarDay(locale: AssistantLocale, month: number, day: number): void {
  const probe = new Date(Date.UTC(LEAP_YEAR, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(text(locale, INVALID_DAY));
  }
}

/**
 * The one row a name means: its id, else its name or label folded for case and
 * diacritics. A shared name is refused with the candidates and their ids, and a
 * name that matches nothing with the names that exist.
 */
function resolveRow<T extends { readonly id: string }>(
  rows: readonly T[],
  wanted: string,
  label: (row: T) => string,
  locale: AssistantLocale,
  refusals: Refusals,
): T {
  const byId = rows.find((row) => row.id === wanted);
  if (byId !== undefined) return byId;
  const needle = foldSearchText(wanted.trim());
  const matches = rows.filter((row) => foldSearchText(label(row)) === needle);
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) return only;
  if (matches.length > 1) {
    throw new Error(
      phrase(locale, refusals.ambiguous, wanted, matches.map((row) => `${label(row)} (${row.id})`).join(", ")),
    );
  }
  const known = rows.map(label).sort((left, right) => collator().compare(left, right)).join(", ");
  throw new Error(phrase(locale, refusals.unknown, wanted, known.length === 0 ? text(locale, NONE) : known));
}

/** A read's answer: one line per row, capped at `MAX_ROWS`, saying how many were left out. */
function listed<T>(locale: AssistantLocale, rows: readonly T[], line: (row: T) => string): string {
  const shown = rows.slice(0, MAX_ROWS).map(line);
  if (rows.length > MAX_ROWS) shown.push(phrase(locale, MORE, formatNumber(locale, rows.length - MAX_ROWS)));
  return shown.join("\n");
}

function personLine(locale: AssistantLocale, person: Person): string {
  const kind = text(locale, KIND_WORDS[person.kind]);
  return `- ${person.id} ${person.name}: ${kind}, ${dateText(locale, person.month, person.day, person.year)}`;
}

function documentLine(locale: AssistantLocale, document: TrackedDocument): string {
  const type = text(locale, TYPE_WORDS[document.docType]);
  const expiry = formatDayInSentence(locale, document.expiryDate);
  return `- ${document.id} ${document.label} (${type}): ${expiry}, ${expiryText(locale, document.daysUntilExpiry)}`;
}

/** A month and day as the calendar writes them („12. maj" / "12 May"), with the year when there is one. */
function dateText(locale: AssistantLocale, month: number, day: number, year: number | null): string {
  const monthDay = formatDayShort(locale, `${LEAP_YEAR}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  return year === null ? monthDay : `${monthDay} ${String(year)}`;
}

/** Days left to an expiry, in words: „rok ističe za 3 dana", „rok je istekao pre 1 dan", „rok ističe danas". */
function expiryText(locale: AssistantLocale, daysUntilExpiry: number): string {
  if (daysUntilExpiry === 0) return text(locale, DUE_TODAY);
  const count = Math.abs(daysUntilExpiry);
  const unit = locale === "en" ? (count === 1 ? "day" : "days") : SR_PLURAL.select(count) === "one" ? "dan" : "dana";
  const amount = `${formatNumber(locale, count)} ${unit}`;
  return phrase(locale, daysUntilExpiry > 0 ? EXPIRY_IN : EXPIRY_AGO, amount);
}

/** The reminder days as a change summary lists them („90, 30, 7"), or „nijedna" when the ladder is cleared. */
function offsetsText(locale: AssistantLocale, offsets: readonly number[]): string {
  if (offsets.length === 0) return text(locale, NONE);
  return offsets.map((days) => formatNumber(locale, days)).join(", ");
}

function change(locale: AssistantLocale, field: AssistantText, value: string): string {
  return `${text(locale, field)}: ${value}`;
}
