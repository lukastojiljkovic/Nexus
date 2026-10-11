import type Database from "better-sqlite3-multiple-ciphers";
import {
  MAX_CARD_ALLERGY_LABEL_LENGTH,
  MAX_CARD_CONDITION_LENGTH,
  MAX_CARD_CONTACT_NAME_LENGTH,
  MAX_CARD_CONTACT_RELATION_LENGTH,
  MAX_CARD_DOCTOR_NAME_LENGTH,
  MAX_CARD_FULL_NAME_LENGTH,
  MAX_CARD_INSURANCE_NUMBER_LENGTH,
  MAX_CARD_LIST_ITEMS,
  MAX_CARD_MEDICATION_DOSE_LENGTH,
  MAX_CARD_MEDICATION_NAME_LENGTH,
  MAX_CARD_NOTES_LENGTH,
  MAX_CARD_PHONE_LENGTH,
  buildCardModel,
  isAllergySeverity,
  isBloodType,
  isCardPrintLanguage,
  isOrganDonor,
} from "@nexus/core";
import type {
  CardAllergy,
  CardBloodType,
  CardMedication,
  CardPrintLanguage,
  EmergencyCardSource,
  OrganDonor,
} from "@nexus/core";
import { DocumentStore, EmergencyCardStore, PeopleStore } from "@nexus/db";
import { mainLocale } from "../../../main/locale.js";
import type { ModuleHostSurface, ModuleValidators } from "../../../main/moduleIpc.js";
import { CARD_PRINT_FORMATS, contract } from "../shared/ipc.js";
import type {
  CardFieldsPayload,
  CardPrintFormat,
  EmergencyView,
} from "../shared/ipc.js";
import { MODULE_NAME } from "../shared/manifest.js";
import { applyEmergencyExport, buildEmergencyExport, parseEmergencyExport } from "./imex.js";
import { CARD_PRINT_LAYOUTS, buildCardPrintDocument, cardFileName } from "./print.js";

/**
 * EMERGENCY in the main process (ADR-090): its handlers, the card it reads out
 * of the database, and its archive section.
 *
 * **Where the decisions live.** Nothing in this file decides what a card IS. The
 * store owns the card's fields, its person-or-text pair and its list order; the
 * core owns the vocabularies and the bounds; `buildCardModel` owns the print
 * order and the missing-reference rule. This file validates the wire (SEC-EL-02),
 * maps store rows onto the wire's shapes, and asks for one thing the kit does not
 * otherwise give a module: a PDF.
 *
 * **Why the card POINTS at People and Documents and never copies them.** A
 * contact that names a person prints that person's live name, so renaming
 * somebody in People renames them on the card. The price is a reference that can
 * dangle, and the model reports one rather than dropping the row - which is why
 * this file reads BOTH libraries into every view: the page, the card it draws and
 * the sheet it prints then all resolve a reference the same way, and a card can
 * never show a shorter list than the user named.
 *
 * **A read never writes.** `list` is a pure read of three stores, and every
 * mutation answers with the same view, so the page has exactly one way to learn
 * anything: what main just said.
 */

/** Something that can open a store for a profile: the shape a handler's `ModuleCall` and a session both have. */
interface StoreBearer {
  profileDb<T>(profileId: string, open: (db: Database.Database, profileId: string) => T): T;
}

/**
 * The two libraries the card points into, in the profile's own Serbian order.
 *
 * `listActive()` orders by SQLite's binary collation, which does not tailor Latin
 * `š`/`č`/`ć` (`PeopleStore`'s own comment says so), so the sort happens here, on
 * the one list a person picks from by name.
 */
const SERBIAN_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

function byName<T extends { readonly name: string }>(left: T, right: T): number {
  return SERBIAN_COLLATOR.compare(left.name, right.name);
}

function byLabel<T extends { readonly label: string }>(left: T, right: T): number {
  return SERBIAN_COLLATOR.compare(left.label, right.label);
}

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  function cardStore(bearer: StoreBearer, profileId: string): EmergencyCardStore {
    return bearer.profileDb(profileId, (db, id) => new EmergencyCardStore(db, id));
  }

  function peopleStore(bearer: StoreBearer, profileId: string): PeopleStore {
    return bearer.profileDb(profileId, (db, id) => new PeopleStore(db, id));
  }

  function documentStore(bearer: StoreBearer, profileId: string): DocumentStore {
    return bearer.profileDb(profileId, (db, id) => new DocumentStore(db, id));
  }

  /** The two libraries, read once per view - the same two lists the card model resolves against. */
  function libraries(bearer: StoreBearer, profileId: string): {
    people: { id: string; name: string }[];
    documents: { id: string; label: string; expiryDate: string }[];
  } {
    const people = peopleStore(bearer, profileId)
      .listActive()
      .map((person) => ({ id: person.id, name: person.name }))
      .sort(byName);
    const documents = documentStore(bearer, profileId)
      .listActive()
      .map((document) => ({
        id: document.id,
        label: document.label,
        expiryDate: document.expiryDate,
      }))
      .sort(byLabel);
    return { people, documents };
  }

  /**
   * The rows as the wire declares them. One mapping, so the store's shape and the
   * wire's cannot drift field by field: a column renamed in a migration is a
   * compile error here rather than `undefined` in the renderer.
   */
  function viewOf(bearer: StoreBearer, profileId: string): EmergencyView {
    const store = cardStore(bearer, profileId);
    const card = store.get();
    const { people, documents } = libraries(bearer, profileId);
    return {
      card:
        card === null
          ? null
          : {
              id: card.id,
              fullName: card.fullName,
              dateOfBirth: card.dateOfBirth,
              bloodType: card.bloodType,
              allergies: card.allergies,
              conditions: card.conditions,
              medications: card.medications,
              organDonor: card.organDonor,
              healthInsuranceNumber: card.healthInsuranceNumber,
              doctorName: card.doctorName,
              doctorPhone: card.doctorPhone,
              notes: card.notes,
              printLanguage: card.printLanguage,
              createdAt: card.createdAt,
              updatedAt: card.updatedAt,
            },
      contacts: store.listContacts().map((contact) => ({
        id: contact.id,
        personId: contact.personId,
        name: contact.name,
        phone: contact.phone,
        relation: contact.relation,
        rank: contact.rank,
      })),
      documents: store.listDocuments().map((link) => ({
        id: link.id,
        documentId: link.documentId,
        mode: link.mode,
        rank: link.rank,
      })),
      people,
      documentChoices: documents,
    };
  }

  /** What every mutation answers with: the rows read back. */
  function changed(bearer: StoreBearer, profileId: string): EmergencyView {
    return viewOf(bearer, profileId);
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return viewOf(call, profileId);
  });

  ctx.handle("createCard", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    cardStore(call, profileId).create(cardFields(call.as, payload.fields), instant(call.now()));
    return changed(call, profileId);
  });

  ctx.handle("updateCard", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    cardStore(call, profileId).update(cardFields(call.as, payload.fields), instant(call.now()));
    return changed(call, profileId);
  });

  ctx.handle("removeCard", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    cardStore(call, profileId).softDelete(instant(call.now()));
    return changed(call, profileId);
  });

  ctx.handle("addContact", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    cardStore(call, profileId).addContact(contactIdentity(call.as, payload), instant(call.now()));
    return changed(call, profileId);
  });

  ctx.handle("updateContact", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    cardStore(call, profileId).updateContact(
      call.as.asId(payload.id, "id"),
      contactIdentity(call.as, payload),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  ctx.handle("removeContact", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    cardStore(call, profileId).removeContact(call.as.asId(payload.id, "id"));
    return changed(call, profileId);
  });

  ctx.handle("moveContact", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    cardStore(call, profileId).moveContact(
      call.as.asId(payload.id, "id"),
      optionalId(call.as, payload.beforeId, "beforeId"),
      optionalId(call.as, payload.afterId, "afterId"),
      instant(call.now()),
    );
    return changed(call, profileId);
  });

  /**
   * Prints the card and saves it where the user says.
   *
   * Everything in the document is read from the database here rather than
   * accepted from the renderer: the payload carries a profile and a page format,
   * and nothing else. `mainLocale()` decides which of the two languages leads a
   * card that prints in both - the card's own `printLanguage` decides whether
   * there are two at all (`cardModel.ts`).
   */
  ctx.handle("printCard", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const format = printFormat(payload.format);
    const store = cardStore(call, profileId);
    const card = store.get();
    if (card === null) {
      // A refusal rather than an empty page: the page cannot offer to print a
      // card that does not exist, and a blank PDF would be the app pretending
      // otherwise.
      throw new Error("This profile has no emergency card to print.");
    }
    const { people, documents } = libraries(call, profileId);
    const source: EmergencyCardSource = {
      fullName: card.fullName,
      dateOfBirth: card.dateOfBirth,
      bloodType: card.bloodType,
      allergies: card.allergies,
      conditions: card.conditions,
      medications: card.medications,
      organDonor: card.organDonor,
      healthInsuranceNumber: card.healthInsuranceNumber,
      doctorName: card.doctorName,
      doctorPhone: card.doctorPhone,
      notes: card.notes,
      printLanguage: card.printLanguage,
      contacts: store.listContacts().map((contact) => ({
        id: contact.id,
        personId: contact.personId,
        name: contact.name,
        phone: contact.phone,
        relation: contact.relation,
      })),
      documents: store.listDocuments().map((link) => ({
        id: link.id,
        documentId: link.documentId,
        mode: link.mode,
      })),
    };
    const html = buildCardPrintDocument({
      model: buildCardModel(source, people, documents, mainLocale()),
      title: MODULE_NAME,
      format,
    });
    const layout = CARD_PRINT_LAYOUTS[format];
    const path = await ctx.savePdf({
      html,
      defaultPath: cardFileName(card.fullName),
      pageSize: layout.pageSize,
      margins: layout.margins,
    });
    return path === null ? { saved: false } : { saved: true, path };
  });

  // --- The archive (ADR-090 §imex) -----------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    return buildEmergencyExport(cardStore(session, profileId));
  });

  ctx.importData({
    // The pure half, run by the host at the preview and again before any module
    // writes: it reads the whole payload - the version first - and throws on
    // anything it will not take, so a refused archive never reaches a write.
    parse: parseEmergencyExport,
    // The writing half. `undefined` is an archive that says nothing about the
    // card, which for a restore that replaces a profile whole means empty: the
    // store replaces its own three tables, and the module's rows are NOT on
    // `RESTORE_WIPE_TABLES` (ADR-090 §6).
    apply: (parsed, session) => {
      for (const profileId of session.profileIds) {
        applyEmergencyExport(cardStore(session, profileId), parsed);
      }
    },
  });
}

/**
 * The one profile a session is about, or `null` when it names none or several.
 *
 * An archive is written ONE profile at a time (`main/imex.ts` gathers one
 * profile's data), so "several" is not a shape the exporter meets. Answering
 * `null` rather than guessing is what keeps that true.
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** One of the two page formats, or a refusal naming what was sent. */
function printFormat(value: unknown): CardPrintFormat {
  if (!(CARD_PRINT_FORMATS as readonly unknown[]).includes(value)) {
    throw new Error('Invalid IPC payload: "format" must be "a6" or "card-a4".');
  }
  return value as CardPrintFormat;
}

/** An id that may be absent: `null` and `undefined` are both "no neighbour", anything else is checked as an id. */
function optionalId(as: ModuleValidators, value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return as.asId(value, field);
}

/** A nullable piece of text with the store's own character bound applied before the store sees it. */
function nullableFilled(as: ModuleValidators, value: unknown, max: number, field: string): string | null {
  const text = as.asNullableString(value, field);
  return text === null ? null : as.asCappedChars(text, field, max);
}

/** A piece of text a row cannot be without - a condition, a medication's name - bounded by the store's own cap. */
function filled(as: ModuleValidators, value: unknown, max: number, field: string): string {
  return as.asCappedChars(as.asNonEmptyString(value, field), field, max);
}

/** A person-or-text contact, structurally: the pair's rule is the store's, and its refusal is the store's sentence. */
function contactIdentity(
  as: ModuleValidators,
  payload: {
    readonly personId: unknown;
    readonly name: unknown;
    readonly phone: unknown;
    readonly relation: unknown;
  },
): {
  personId: string | null;
  name: string | null;
  phone: string | null;
  relation: string | null;
} {
  return {
    personId: optionalId(as, payload.personId, "personId"),
    name: nullableFilled(as, payload.name, MAX_CARD_CONTACT_NAME_LENGTH, "name"),
    phone: nullableFilled(as, payload.phone, MAX_CARD_PHONE_LENGTH, "phone"),
    relation: nullableFilled(as, payload.relation, MAX_CARD_CONTACT_RELATION_LENGTH, "relation"),
  };
}

/**
 * The card's whole field set off the wire (SEC-EL-02).
 *
 * Structural only: a field is the shape the store's column is, inside the bound
 * the STORE enforces (`MAX_CARD_*`, which is why those constants rather than new
 * numbers). A date of birth is checked as a ten-character string here and as a
 * real day by the store, which is the boundary that owns the calendar.
 */
function cardFields(as: ModuleValidators, value: unknown): CardFieldsPayload {
  const payload = as.asRecord(value);
  return {
    fullName: nullableFilled(as, payload["fullName"], MAX_CARD_FULL_NAME_LENGTH, "fullName"),
    dateOfBirth: nullableFilled(as, payload["dateOfBirth"], 10, "dateOfBirth"),
    bloodType: nullableBloodType(as, payload["bloodType"]),
    allergies: nullableAllergies(as, payload["allergies"]),
    conditions: nullableConditions(as, payload["conditions"]),
    medications: nullableMedications(as, payload["medications"]),
    organDonor: nullableOrganDonor(as, payload["organDonor"]),
    healthInsuranceNumber: nullableFilled(
      as,
      payload["healthInsuranceNumber"],
      MAX_CARD_INSURANCE_NUMBER_LENGTH,
      "healthInsuranceNumber",
    ),
    doctorName: nullableFilled(as, payload["doctorName"], MAX_CARD_DOCTOR_NAME_LENGTH, "doctorName"),
    doctorPhone: nullableFilled(as, payload["doctorPhone"], MAX_CARD_PHONE_LENGTH, "doctorPhone"),
    notes: nullableFilled(as, payload["notes"], MAX_CARD_NOTES_LENGTH, "notes"),
    printLanguage: printLanguage(as, payload["printLanguage"]),
  };
}

function nullableBloodType(as: ModuleValidators, value: unknown): CardBloodType | null {
  if (value === null || value === undefined) return null;
  if (!isBloodType(value)) {
    throw new Error('Invalid IPC payload: "bloodType" is not a blood type.');
  }
  return value;
}

function nullableOrganDonor(as: ModuleValidators, value: unknown): OrganDonor | null {
  if (value === null || value === undefined) return null;
  if (!isOrganDonor(value)) {
    throw new Error('Invalid IPC payload: "organDonor" must be "yes" or "no".');
  }
  return value;
}

function printLanguage(as: ModuleValidators, value: unknown): CardPrintLanguage {
  if (!isCardPrintLanguage(value)) {
    throw new Error('Invalid IPC payload: "printLanguage" must be "sr", "en" or "both".');
  }
  return value;
}

/** An allergies list: `null` is "not answered", an empty list is "there are none", and both travel as themselves. */
function nullableAllergies(as: ModuleValidators, value: unknown): CardAllergy[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new Error('Invalid IPC payload: "allergies" must be a list or null.');
  }
  if (value.length > MAX_CARD_LIST_ITEMS) {
    throw new Error(`Invalid IPC payload: "allergies" holds at most ${MAX_CARD_LIST_ITEMS} items.`);
  }
  return value.map((entry) => {
    const item = as.asRecord(entry);
    const label = filled(as, item["label"], MAX_CARD_ALLERGY_LABEL_LENGTH, "allergies[].label");
    const severity = item["severity"];
    if (severity === null || severity === undefined) return { label, severity: null };
    if (!isAllergySeverity(severity)) {
      throw new Error('Invalid IPC payload: "allergies[].severity" is not a severity.');
    }
    return { label, severity };
  });
}

function nullableConditions(as: ModuleValidators, value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new Error('Invalid IPC payload: "conditions" must be a list or null.');
  }
  if (value.length > MAX_CARD_LIST_ITEMS) {
    throw new Error(`Invalid IPC payload: "conditions" holds at most ${MAX_CARD_LIST_ITEMS} items.`);
  }
  return value.map((entry) => {
    return filled(as, entry, MAX_CARD_CONDITION_LENGTH, "conditions[]");
  });
}

/** Medications: a name is required, a dose is optional - a row with no name is a line that prints empty. */
function nullableMedications(as: ModuleValidators, value: unknown): CardMedication[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new Error('Invalid IPC payload: "medications" must be a list or null.');
  }
  if (value.length > MAX_CARD_LIST_ITEMS) {
    throw new Error(`Invalid IPC payload: "medications" holds at most ${MAX_CARD_LIST_ITEMS} items.`);
  }
  return value.map((entry) => {
    const item = as.asRecord(entry);
    const name = filled(as, item["name"], MAX_CARD_MEDICATION_NAME_LENGTH, "medications[].name");
    return {
      name,
      dose: nullableFilled(as, item["dose"], MAX_CARD_MEDICATION_DOSE_LENGTH, "medications[].dose"),
    };
  });
}
