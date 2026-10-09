import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CardBloodType, CardPrintLanguage } from "@nexus/core";
import {
  EmergencyCardNotFoundError,
  EmergencyCardStore,
  EmergencyCardValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:00:00.000Z";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-emergency-"));
  db = openDatabase({ path: join(dir, "emergency.db") });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfileIn(target: NexusDatabase): string {
  const id = uuidv7();
  target.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

function createProfile(): string {
  return createProfileIn(db);
}

function store(): EmergencyCardStore {
  return new EmergencyCardStore(db.raw, createProfile());
}

/** A live person in the People module - what a linked contact is checked against. */
function insertPerson(profileId: string, name: string, deletedAt: string | null = null): string {
  const id = uuidv7();
  db.raw
    .prepare(
      `INSERT INTO people (id, profile_id, name, kind, month, day, year, note,
                           created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, 'birthday', 1, 1, NULL, NULL, ?, ?, ?)`,
    )
    .run(id, profileId, name, NOW, NOW, deletedAt);
  return id;
}

/** A tracked document in the Documents module. */
function insertDocument(profileId: string, label: string, deletedAt: string | null = null): string {
  const id = uuidv7();
  db.raw
    .prepare(
      `INSERT INTO tracked_documents (id, profile_id, doc_type, label, expiry_date,
                                      reminder_offsets, notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, 'pasos', ?, '2030-05-01', '[]', NULL, ?, ?, ?)`,
    )
    .run(id, profileId, label, NOW, NOW, deletedAt);
  return id;
}

/** A card with the profile id the store was built around - the tests below need it. */
function seeded(): { store: EmergencyCardStore; profileId: string } {
  const profileId = createProfile();
  return { store: new EmergencyCardStore(db.raw, profileId), profileId };
}

describe("EmergencyCardStore.create and get", () => {
  it("stores an empty card, printing in Serbian by default", () => {
    const cards = store();
    const card = cards.create({}, NOW);

    expect(card).toMatchObject({
      fullName: null,
      dateOfBirth: null,
      bloodType: null,
      allergies: null,
      conditions: null,
      medications: null,
      organDonor: null,
      healthInsuranceNumber: null,
      doctorName: null,
      doctorPhone: null,
      notes: null,
      printLanguage: "sr",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(cards.get()).toEqual(card);
  });

  it("stores a full card, trimming the free text and canonicalising the lists", () => {
    const cards = store();
    const card = cards.create(
      {
        fullName: "  Mila Petrovic  ",
        dateOfBirth: "1985-03-17",
        bloodType: "A-",
        allergies: [{ label: " Polen ", severity: "mild" }],
        conditions: [" Astma "],
        medications: [{ name: " Ventolin ", dose: "  " }],
        organDonor: "yes",
        healthInsuranceNumber: " 0123456789 ",
        doctorName: " Dr Jovan ",
        doctorPhone: "+381 11 234 5678",
        notes: " Alergija na kontrast. ",
        printLanguage: "both",
      },
      NOW,
    );

    expect(card).toMatchObject({
      fullName: "Mila Petrovic",
      allergies: [{ label: "Polen", severity: "mild" }],
      conditions: ["Astma"],
      medications: [{ name: "Ventolin", dose: null }],
      healthInsuranceNumber: "0123456789",
      doctorName: "Dr Jovan",
      notes: "Alergija na kontrast.",
      printLanguage: "both",
    });
  });

  it("answers null for a profile that has no card at all", () => {
    expect(store().get()).toBeNull();
  });

  it("refuses a second card for the same profile", () => {
    const cards = store();
    cards.create({ fullName: "First" }, NOW);

    expect(() => cards.create({ fullName: "Second" }, LATER)).toThrow(
      EmergencyCardValidationError,
    );
    expect(cards.get()?.fullName).toBe("First");
  });

  const REFUSED_FIELDS: readonly (readonly [string, Record<string, unknown>])[] = [
    ["a blood type that is not one of the nine answers", { bloodType: "a-" }],
    ["an organ-donor answer that is not yes or no", { organDonor: "maybe" }],
    ["a print language nobody prints in", { printLanguage: "de" }],
    ["a date of birth that is no calendar day", { dateOfBirth: "1985-02-30" }],
    ["a date of birth that is not a bare day", { dateOfBirth: "1985-03-17T00:00:00Z" }],
    ["a date of birth in the future", { dateOfBirth: "2027-01-01" }],
    ["an over-long name", { fullName: "x".repeat(121) }],
    ["an over-long note", { notes: "x".repeat(2001) }],
    ["an over-long insurance number", { healthInsuranceNumber: "x".repeat(61) }],
    ["an over-long doctor phone", { doctorPhone: "x".repeat(41) }],
    ["an unknown allergy severity", { allergies: [{ label: "Polen", severity: "deadly" }] }],
    ["an allergy list that is not a list", { medications: { name: "x" } }],
  ];

  it.each(REFUSED_FIELDS)("refuses %s", (_label, fields) => {
    const cards = store();
    const input = fields as Parameters<EmergencyCardStore["create"]>[0];

    expect(() => cards.create(input, NOW)).toThrow(EmergencyCardValidationError);
    expect(cards.get()).toBeNull();
  });

  it("refuses a moment that is not an ISO-8601 date-time", () => {
    expect(() => store().create({}, "yesterday")).toThrow(EmergencyCardValidationError);
  });
});

describe("EmergencyCardStore.update", () => {
  it("applies a partial patch and leaves every other field where it was", () => {
    const cards = store();
    cards.create({ fullName: "Mila", bloodType: "A-", notes: "keep me" }, NOW);
    const updated = cards.update({ bloodType: "O+" }, LATER);

    expect(updated).toMatchObject({
      fullName: "Mila",
      bloodType: "O+",
      notes: "keep me",
      createdAt: NOW,
      updatedAt: LATER,
    });
    expect(cards.get()).toEqual(updated);
  });

  it("clears a nullable field on an explicit null", () => {
    const cards = store();
    cards.create({ doctorName: "Dr Jovan", doctorPhone: "+381 11 234 5678" }, NOW);
    const updated = cards.update({ doctorName: null }, LATER);

    expect(updated.doctorName).toBeNull();
    expect(updated.doctorPhone).toBe("+381 11 234 5678");
  });

  it("refuses when this profile has no card to update", () => {
    expect(() => store().update({ fullName: "Mila" }, NOW)).toThrow(EmergencyCardNotFoundError);
  });

  it("refuses a date of birth in the future of the moment being stamped", () => {
    const cards = store();
    cards.create({}, NOW);

    expect(() => cards.update({ dateOfBirth: "2026-06-02" }, NOW)).toThrow(
      EmergencyCardValidationError,
    );
  });
});

describe("EmergencyCardStore contacts", () => {
  it("appends contacts in the order they are added and reads them back in that order", () => {
    const cards = store();
    cards.create({}, NOW);
    const first = cards.addContact({ name: "Marko", phone: "+381 64 111 222" }, NOW);
    const second = cards.addContact({ name: "Jelena", relation: "sestra" }, NOW);

    expect(cards.listContacts().map((contact) => contact.id)).toEqual([first.id, second.id]);
    expect(cards.listContacts()).toEqual([
      {
        id: first.id,
        cardId: cards.get()!.id,
        personId: null,
        name: "Marko",
        phone: "+381 64 111 222",
        relation: null,
        rank: "i0",
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        id: second.id,
        cardId: cards.get()!.id,
        personId: null,
        name: "Jelena",
        phone: null,
        relation: "sestra",
        rank: "i1",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
  });

  it("links a person, storing no name of its own - the live name is the only name", () => {
    const { store: cards, profileId } = seeded();
    cards.create({}, NOW);
    const personId = insertPerson(profileId, "Marko Petrovic");
    const contact = cards.addContact({ personId, phone: "+381 64 111 222" }, NOW);

    expect(contact).toMatchObject({ personId, name: null, phone: "+381 64 111 222" });
  });

  const REFUSED_CONTACTS: readonly (readonly [string, Record<string, unknown>])[] = [
    ["a contact with neither a person nor a name", { phone: "+381 64 111 222" }],
    ["a contact with both a person and its own name", { personId: "p", name: "Marko" }],
    ["a name that is only whitespace", { name: "   " }],
    ["an over-long name", { name: "x".repeat(121) }],
    ["an over-long relation", { relation: "x".repeat(61) }],
    ["an over-long phone", { phone: "x".repeat(41) }],
  ];

  it.each(REFUSED_CONTACTS)("refuses %s", (_label, fields) => {
    const cards = store();
    cards.create({}, NOW);
    const input = fields as Parameters<EmergencyCardStore["addContact"]>[0];

    expect(() => cards.addContact(input, NOW)).toThrow(EmergencyCardValidationError);
    expect(cards.listContacts()).toEqual([]);
  });

  it("refuses a person this profile does not carry, live or at all", () => {
    const { store: cards, profileId } = seeded();
    cards.create({}, NOW);
    const deleted = insertPerson(profileId, "Gone", LATER);

    expect(() => cards.addContact({ personId: uuidv7() }, NOW)).toThrow(
      EmergencyCardValidationError,
    );
    expect(() => cards.addContact({ personId: deleted }, NOW)).toThrow(
      EmergencyCardValidationError,
    );
  });

  it("refuses a contact write while there is no live card to hang it on", () => {
    const cards = store();

    expect(() => cards.addContact({ name: "Marko" }, NOW)).toThrow(EmergencyCardNotFoundError);
  });

  it("moves a contact between two neighbours, one row at a time", () => {
    const cards = store();
    cards.create({}, NOW);
    const a = cards.addContact({ name: "A" }, NOW);
    const b = cards.addContact({ name: "B" }, NOW);
    const c = cards.addContact({ name: "C" }, NOW);

    cards.moveContact(c.id, null, a.id, LATER);
    expect(cards.listContacts().map((contact) => contact.name)).toEqual(["C", "A", "B"]);

    cards.moveContact(c.id, b.id, null, LATER);
    expect(cards.listContacts().map((contact) => contact.name)).toEqual(["A", "B", "C"]);
  });

  it("refuses to order a contact against itself, or into a gap that does not exist", () => {
    const cards = store();
    cards.create({}, NOW);
    const a = cards.addContact({ name: "A" }, NOW);
    const b = cards.addContact({ name: "B" }, NOW);

    expect(() => cards.moveContact(a.id, a.id, null, LATER)).toThrow(
      EmergencyCardValidationError,
    );
    expect(() => cards.moveContact(a.id, b.id, a.id, LATER)).toThrow(
      EmergencyCardValidationError,
    );
    expect(() => cards.moveContact(uuidv7(), null, null, LATER)).toThrow(
      EmergencyCardNotFoundError,
    );
  });

  it("patches a contact, re-checking the person-or-name pair as a pair", () => {
    const cards = store();
    cards.create({}, NOW);
    const contact = cards.addContact({ name: "Marko", phone: null }, NOW);

    expect(cards.updateContact(contact.id, { phone: "+381 64 111 222" }, LATER)).toMatchObject({
      name: "Marko",
      phone: "+381 64 111 222",
      updatedAt: LATER,
    });
    // Naming a person while the row still carries a name is the ambiguous contact
    // the schema refuses, so the patch is refused rather than silently resolved.
    expect(() => cards.updateContact(contact.id, { personId: uuidv7() }, LATER)).toThrow(
      EmergencyCardValidationError,
    );
  });

  it("removes a contact, and refuses to remove one that is not there", () => {
    const cards = store();
    cards.create({}, NOW);
    const contact = cards.addContact({ name: "Marko" }, NOW);

    cards.removeContact(contact.id);
    expect(cards.listContacts()).toEqual([]);
    expect(() => cards.removeContact(contact.id)).toThrow(EmergencyCardNotFoundError);
  });
});

describe("EmergencyCardStore documents", () => {
  it("appends documents with the print mode the user chose, defaulting to the number alone", () => {
    const { store: cards, profileId } = seeded();
    cards.create({}, NOW);
    const passport = insertDocument(profileId, "Pasos");
    const licence = insertDocument(profileId, "Vozacka");

    const first = cards.addDocument({ documentId: passport, mode: "number_image" }, NOW);
    const second = cards.addDocument({ documentId: licence }, NOW);

    expect(cards.listDocuments().map((link) => link.id)).toEqual([first.id, second.id]);
    expect(cards.listDocuments().map((link) => link.mode)).toEqual(["number_image", "number"]);
    expect(cards.listDocuments().map((link) => link.documentId)).toEqual([passport, licence]);
  });

  it("refuses a document this profile does not carry, live or at all", () => {
    const { store: cards, profileId } = seeded();
    cards.create({}, NOW);
    const deleted = insertDocument(profileId, "Gone", LATER);

    expect(() => cards.addDocument({ documentId: uuidv7() }, NOW)).toThrow(
      EmergencyCardValidationError,
    );
    expect(() => cards.addDocument({ documentId: deleted }, NOW)).toThrow(
      EmergencyCardValidationError,
    );
  });

  it("refuses to put the same document on the card twice", () => {
    const { store: cards, profileId } = seeded();
    cards.create({}, NOW);
    const documentId = insertDocument(profileId, "Pasos");
    cards.addDocument({ documentId }, NOW);

    expect(() => cards.addDocument({ documentId }, NOW)).toThrow(EmergencyCardValidationError);
    expect(cards.listDocuments()).toHaveLength(1);
  });

  it("refuses a print mode that is neither of the two", () => {
    const { store: cards, profileId } = seeded();
    cards.create({}, NOW);
    const documentId = insertDocument(profileId, "Pasos");

    expect(() =>
      cards.addDocument({ documentId, mode: "image" as unknown as "number" }, NOW),
    ).toThrow(EmergencyCardValidationError);
  });

  it("reorders documents and removes them", () => {
    const { store: cards, profileId } = seeded();
    cards.create({}, NOW);
    const first = cards.addDocument({ documentId: insertDocument(profileId, "A") }, NOW);
    const second = cards.addDocument({ documentId: insertDocument(profileId, "B") }, NOW);

    cards.moveDocument(second.id, null, first.id, LATER);
    expect(cards.listDocuments().map((link) => link.id)).toEqual([second.id, first.id]);

    cards.removeDocument(second.id);
    expect(cards.listDocuments().map((link) => link.id)).toEqual([first.id]);
    expect(() => cards.removeDocument(second.id)).toThrow(EmergencyCardNotFoundError);
  });

  it("refuses a document write while there is no live card to hang it on", () => {
    expect(() => store().addDocument({ documentId: uuidv7() }, NOW)).toThrow(
      EmergencyCardNotFoundError,
    );
  });
});

describe("EmergencyCardStore soft delete", () => {
  it("takes the card and its rows out of every read, and brings them back on restore", () => {
    const { store: cards, profileId } = seeded();
    cards.create({ fullName: "Mila" }, NOW);
    const contact = cards.addContact({ name: "Marko" }, NOW);
    const link = cards.addDocument({ documentId: insertDocument(profileId, "Pasos") }, NOW);

    cards.softDelete(LATER);
    expect(cards.get()).toBeNull();
    expect(cards.listContacts()).toEqual([]);
    expect(cards.listDocuments()).toEqual([]);
    expect(() => cards.addContact({ name: "Jelena" }, LATER)).toThrow(EmergencyCardNotFoundError);

    cards.restore(LATER);
    expect(cards.get()?.fullName).toBe("Mila");
    expect(cards.listContacts().map((row) => row.id)).toEqual([contact.id]);
    expect(cards.listDocuments().map((row) => row.id)).toEqual([link.id]);
  });

  it("refuses to delete a card that is not live, or to restore one that is", () => {
    const cards = store();

    expect(() => cards.softDelete(NOW)).toThrow(EmergencyCardNotFoundError);
    cards.create({}, NOW);
    expect(() => cards.restore(NOW)).toThrow(EmergencyCardNotFoundError);
  });

  it("refuses to restore while a live card stands, even with a cleared one behind it", () => {
    const cards = store();
    cards.create({ fullName: "Cleared" }, NOW);
    cards.softDelete(LATER);
    cards.create({ fullName: "Fresh" }, LATER);

    expect(() => cards.restore(LATER)).toThrow(EmergencyCardNotFoundError);
    expect(cards.get()?.fullName).toBe("Fresh");
  });

  it("takes the card and the rows it owns with the profile, through the schema's own cascade", () => {
    const { store: cards, profileId } = seeded();
    cards.create({ fullName: "Mila" }, NOW);
    cards.addContact({ name: "Marko" }, NOW);
    cards.addDocument({ documentId: insertDocument(profileId, "Pasos") }, NOW);

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);

    const count = (table: string): number =>
      (db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count("emergency_cards")).toBe(0);
    expect(count("emergency_contacts")).toBe(0);
    expect(count("emergency_documents")).toBe(0);
  });
});

describe("EmergencyCardStore export and import", () => {
  function populated(): { store: EmergencyCardStore; profileId: string } {
    const { store: cards, profileId } = seeded();
    cards.create(
      {
        fullName: "Mila Petrovic",
        dateOfBirth: "1985-03-17",
        bloodType: "A-",
        allergies: [{ label: "Polen", severity: "mild" }],
        conditions: ["Astma"],
        medications: [{ name: "Ventolin", dose: "2 udaha" }],
        organDonor: "no",
        healthInsuranceNumber: "0123456789",
        doctorName: "Dr Jovan",
        doctorPhone: "+381 11 234 5678",
        notes: "note",
        printLanguage: "both",
      },
      NOW,
    );
    const personId = insertPerson(profileId, "Marko Petrovic");
    cards.addContact({ personId, phone: "+381 64 111 222", relation: "suprug" }, NOW);
    cards.addContact({ name: "Komsija Zoran" }, LATER);
    cards.addDocument(
      { documentId: insertDocument(profileId, "Pasos"), mode: "number_image" },
      NOW,
    );
    cards.addDocument({ documentId: insertDocument(profileId, "Vozacka") }, LATER);
    return { store: cards, profileId };
  }

  it("exports a profile that never made a card as an empty, versioned value", () => {
    expect(store().exportData()).toEqual({
      version: 1,
      card: null,
      contacts: [],
      documents: [],
    });
  });

  it("round-trips a whole card through plain JSON into another profile", () => {
    const source = populated().store;
    // A SECOND database, because that is what an archive is: a file this machine
    // did not write. The rows are reproduced with the ids they were exported with.
    const otherDir = mkdtempSync(join(tmpdir(), "nexus-emergency-other-"));
    const other = openDatabase({ path: join(otherDir, "other.db") });
    try {
      const otherProfileId = createProfileIn(other);
      const target = new EmergencyCardStore(other.raw, otherProfileId);

      // Through a JSON round trip on purpose: the value is a plain JSON value, so
      // nothing in it may be a Map, a Date or an undefined.
      const wire = JSON.parse(JSON.stringify(source.exportData())) as unknown;
      target.importData(wire);

      expect(target.get()).toEqual({ ...source.get()!, profileId: otherProfileId });
      expect(target.listContacts()).toEqual(source.listContacts());
      expect(target.listDocuments()).toEqual(source.listDocuments());
    } finally {
      other.close();
      rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it("replaces whatever the profile already had rather than merging into it", () => {
    const cards = populated().store;
    const exported = cards.exportData();
    cards.update({ fullName: "Changed", bloodType: null }, LATER);
    cards.addContact({ name: "Someone else" }, LATER);
    cards.addDocument({ documentId: insertDocument(cards.profileId, "Licna karta") }, LATER);

    cards.importData(exported);

    expect(cards.get()?.fullName).toBe("Mila Petrovic");
    expect(cards.get()?.bloodType).toBe("A-");
    expect(cards.listContacts()).toHaveLength(exported.contacts.length);
    expect(cards.listDocuments()).toHaveLength(exported.documents.length);
  });

  it("refuses an archive this file already carries under the same id, naming the collision", () => {
    const source = populated().store;
    const target = store();

    expect(() => target.importData(source.exportData())).toThrow(EmergencyCardValidationError);
    // The refusal is complete: the target profile's own card is exactly as it was.
    expect(target.get()).toBeNull();
    expect(target.listContacts()).toEqual([]);
  });

  it("imports an empty module over a populated card", () => {
    const cards = store();
    cards.create({ fullName: "Mila" }, NOW);
    cards.addContact({ name: "Marko" }, NOW);

    cards.importData({ version: 1, card: null, contacts: [], documents: [] });

    expect(cards.get()).toBeNull();
    expect(cards.listContacts()).toEqual([]);
  });

  it("refuses an unknown version and writes nothing", () => {
    const cards = store();
    cards.create({ fullName: "Mila" }, NOW);

    expect(() => cards.importData({ version: 2, card: null, contacts: [], documents: [] })).toThrow(
      EmergencyCardValidationError,
    );
    expect(cards.get()?.fullName).toBe("Mila");
  });

  const REFUSED_IMPORTS: readonly (readonly [string, unknown])[] = [
    ["a value that is not an object", "card"],
    ["a value with no version", { card: null, contacts: [], documents: [] }],
    ["a card with an unknown blood type", { version: 1, card: { bloodType: "a-" }, contacts: [], documents: [] }],
    [
      "a contact that names a person AND carries a name",
      {
        version: 1,
        card: null,
        contacts: [
          {
            id: "c1",
            personId: "p1",
            name: "Marko",
            phone: null,
            relation: null,
            rank: "i0",
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        documents: [],
      },
    ],
    [
      "a contact whose rank is not a rank",
      {
        version: 1,
        card: null,
        contacts: [
          {
            id: "c1",
            personId: null,
            name: "Marko",
            phone: null,
            relation: null,
            rank: "not a rank",
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        documents: [],
      },
    ],
    [
      "a document link with a print mode nobody prints",
      {
        version: 1,
        card: null,
        contacts: [],
        documents: [
          {
            id: "d1",
            documentId: "doc1",
            mode: "scan",
            rank: "i0",
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      },
    ],
  ];

  it.each(REFUSED_IMPORTS)("refuses %s, writing nothing at all", (_label, value) => {
    const cards = store();
    cards.create({ fullName: "Mila" }, NOW);

    expect(() => cards.importData(value)).toThrow(EmergencyCardValidationError);
    expect(cards.get()?.fullName).toBe("Mila");
    expect(cards.listContacts()).toEqual([]);
  });
});

describe("the field vocabulary the store shares with the wire", () => {
  it("refuses the same print languages core does", () => {
    const cards = store();

    expect(() =>
      cards.create({ printLanguage: "fr" as unknown as CardPrintLanguage }, NOW),
    ).toThrow(EmergencyCardValidationError);
    expect(() =>
      cards.create({ bloodType: "A" as unknown as CardBloodType }, NOW),
    ).toThrow(EmergencyCardValidationError);
  });
});
