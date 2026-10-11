import { describe, expect, it } from "vitest";

import type {
  CardContactSource,
  CardDocument,
  CardDocumentSource,
  CardPerson,
  EmergencyCardFields,
} from "./cardModel.js";
import { buildCardModel } from "./cardModel.js";

/**
 * The names below carry Serbian diacritics spelled as escapes, so this file
 * stays ASCII while the model is still held to passing stored text through
 * VERBATIM: a model that folded a plain `s` onto its caron would print a name a
 * hospital cannot match against an identity card.
 */
const MILA = "Mila Petrovi\u0107";
const MARKO = "Marko Petrovi\u0107";
const DOCTOR = "Dr Jovan Jovanovi\u0107";
const PASOS = "Paso\u0161";
const NEIGHBOUR = "Kom\u0161ija Zoran";

const FIELDS: EmergencyCardFields = {
  fullName: MILA,
  dateOfBirth: "1985-03-17",
  bloodType: "A-",
  allergies: [
    { label: "Penicilin", severity: "anaphylaxis" },
    { label: "Polen", severity: null },
  ],
  conditions: ["Astma", "Hipertenzija"],
  medications: [{ name: "Ventolin", dose: "2 udaha po potrebi" }],
  organDonor: "yes",
  healthInsuranceNumber: "0123456789",
  doctorName: DOCTOR,
  doctorPhone: "+381 11 234 5678",
  notes: "Alergija na kontrast.",
  printLanguage: "sr",
};

const CONTACTS: readonly CardContactSource[] = [
  { id: "c1", personId: "p1", name: null, phone: "+381 64 111 222", relation: "suprug" },
  { id: "c2", personId: "p-gone", name: null, phone: "+381 60 333 444", relation: "brat" },
  { id: "c3", personId: null, name: NEIGHBOUR, phone: null, relation: "kom\u0161ija" },
];

const PEOPLE: readonly CardPerson[] = [{ id: "p1", name: MARKO }];

const DOCUMENT_LINKS: readonly CardDocumentSource[] = [
  { id: "d1", documentId: "doc1", mode: "number" },
  { id: "d2", documentId: "doc-gone", mode: "number_image" },
];

const DOCUMENTS: readonly CardDocument[] = [{ id: "doc1", label: PASOS, expiryDate: "2030-05-01" }];

/** Every block of the full card, in the order the printed page lays them out. */
const EXPECTED_BLOCKS = [
  { key: "identity", fullName: MILA, dateOfBirth: "1985-03-17" },
  { key: "bloodType", bloodType: "A-" },
  {
    key: "allergies",
    allergies: [
      { label: "Penicilin", severity: "anaphylaxis" },
      { label: "Polen", severity: null },
    ],
  },
  { key: "conditions", conditions: ["Astma", "Hipertenzija"] },
  { key: "medications", medications: [{ name: "Ventolin", dose: "2 udaha po potrebi" }] },
  { key: "organDonor", organDonor: "yes" },
  {
    key: "contacts",
    contacts: [
      {
        id: "c1",
        personId: "p1",
        name: MARKO,
        phone: "+381 64 111 222",
        relation: "suprug",
        missing: false,
      },
      {
        id: "c2",
        personId: "p-gone",
        name: null,
        phone: "+381 60 333 444",
        relation: "brat",
        missing: true,
      },
      {
        id: "c3",
        personId: null,
        name: NEIGHBOUR,
        phone: null,
        relation: "kom\u0161ija",
        missing: false,
      },
    ],
  },
  { key: "doctor", name: DOCTOR, phone: "+381 11 234 5678" },
  { key: "insurance", number: "0123456789" },
  {
    key: "documents",
    documents: [
      {
        id: "d1",
        documentId: "doc1",
        mode: "number",
        label: PASOS,
        expiryDate: "2030-05-01",
        missing: false,
      },
      {
        id: "d2",
        documentId: "doc-gone",
        mode: "number_image",
        label: null,
        expiryDate: null,
        missing: true,
      },
    ],
  },
  { key: "notes", notes: "Alergija na kontrast." },
];

function fullCard(printLanguage: EmergencyCardFields["printLanguage"]) {
  return { ...FIELDS, printLanguage, contacts: CONTACTS, documents: DOCUMENT_LINKS };
}

describe("buildCardModel", () => {
  it("lays the whole card out in print order, resolving both libraries", () => {
    const model = buildCardModel(fullCard("sr"), PEOPLE, DOCUMENTS, "sr");

    expect(model.passes).toEqual([{ language: "sr", blocks: EXPECTED_BLOCKS }]);
  });

  it("reports a person the People module no longer carries as missing, and keeps the row", () => {
    const blocks = buildCardModel(fullCard("sr"), PEOPLE, DOCUMENTS, "sr").passes[0]!.blocks;

    expect(blocks.find((block) => block.key === "contacts")).toEqual({
      key: "contacts",
      contacts: [
        expect.objectContaining({ id: "c1", missing: false }),
        {
          id: "c2",
          personId: "p-gone",
          name: null,
          phone: "+381 60 333 444",
          relation: "brat",
          missing: true,
        },
        expect.objectContaining({ id: "c3", missing: false }),
      ],
    });
  });

  it("reports a document the Documents module no longer carries as missing, and keeps the row", () => {
    const blocks = buildCardModel(fullCard("sr"), PEOPLE, DOCUMENTS, "sr").passes[0]!.blocks;

    expect(blocks.find((block) => block.key === "documents")).toEqual({
      key: "documents",
      documents: [
        expect.objectContaining({ documentId: "doc1", missing: false, label: PASOS }),
        {
          id: "d2",
          documentId: "doc-gone",
          mode: "number_image",
          label: null,
          expiryDate: null,
          missing: true,
        },
      ],
    });
  });

  it("prints a phone number exactly as stored, never reformatted", () => {
    const blocks = buildCardModel(fullCard("sr"), PEOPLE, DOCUMENTS, "sr").passes[0]!.blocks;
    const contacts = blocks.find((block) => block.key === "contacts");

    expect(contacts?.key === "contacts" ? contacts.contacts[0]?.phone : null).toBe(
      "+381 64 111 222",
    );
  });

  it("keeps an unstated list out of the page and prints an explicitly empty one", () => {
    const card = {
      ...fullCard("sr"),
      allergies: null,
      conditions: [] as string[],
      medications: null,
      contacts: [] as CardContactSource[],
      documents: [] as CardDocumentSource[],
    };
    const blocks = buildCardModel(card, PEOPLE, DOCUMENTS, "sr").passes[0]!.blocks;

    expect(blocks).toEqual([
      { key: "identity", fullName: MILA, dateOfBirth: "1985-03-17" },
      { key: "bloodType", bloodType: "A-" },
      { key: "conditions", conditions: [] },
      { key: "organDonor", organDonor: "yes" },
      { key: "doctor", name: DOCTOR, phone: "+381 11 234 5678" },
      { key: "insurance", number: "0123456789" },
      { key: "notes", notes: "Alergija na kontrast." },
    ]);
  });

  it("prints the identity block even for a card that answers nothing", () => {
    const empty: EmergencyCardFields = {
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
    };
    const model = buildCardModel({ ...empty, contacts: [], documents: [] }, [], [], "sr");

    expect(model.passes).toEqual([
      { language: "sr", blocks: [{ key: "identity", fullName: null, dateOfBirth: null }] },
    ]);
  });

  it("prints one pass for a single-language card, whatever the render locale is", () => {
    expect(buildCardModel(fullCard("en"), PEOPLE, DOCUMENTS, "sr").passes.map((p) => p.language)).toEqual([
      "en",
    ]);
    expect(buildCardModel(fullCard("sr"), PEOPLE, DOCUMENTS, "en").passes.map((p) => p.language)).toEqual([
      "sr",
    ]);
  });

  it("orders the two passes of a both-language card by the render locale", () => {
    const serbianFirst = buildCardModel(fullCard("both"), PEOPLE, DOCUMENTS, "sr");
    const englishFirst = buildCardModel(fullCard("both"), PEOPLE, DOCUMENTS, "en");

    expect(serbianFirst.passes.map((pass) => pass.language)).toEqual(["sr", "en"]);
    expect(englishFirst.passes.map((pass) => pass.language)).toEqual(["en", "sr"]);
    // One page, read in either order: the two passes carry identical blocks.
    expect(serbianFirst.passes[0]!.blocks).toEqual(serbianFirst.passes[1]!.blocks);
    expect(englishFirst.passes[0]!.blocks).toEqual(EXPECTED_BLOCKS);
  });
});
