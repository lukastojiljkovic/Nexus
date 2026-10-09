import { describe, expect, it } from "vitest";

import { cardCompleteness } from "./cardCompleteness.js";
import type { CardContactSource, EmergencyCardFields } from "./cardModel.js";

const CONTACT: CardContactSource = {
  id: "c1",
  personId: null,
  name: "Marko",
  phone: null,
  relation: null,
};

const ANSWERED: EmergencyCardFields = {
  fullName: null,
  dateOfBirth: null,
  bloodType: "A-",
  allergies: [],
  conditions: null,
  medications: null,
  organDonor: null,
  healthInsuranceNumber: null,
  doctorName: null,
  doctorPhone: null,
  notes: null,
  printLanguage: "sr",
};

describe("cardCompleteness", () => {
  it("is complete when the three recommended fields are answered", () => {
    expect(
      cardCompleteness({ ...ANSWERED, contacts: [CONTACT] }),
    ).toEqual([]);
  });

  it("names every unanswered field, in the order the card prints them", () => {
    expect(
      cardCompleteness({
        ...ANSWERED,
        bloodType: null,
        allergies: null,
        contacts: [],
      }),
    ).toEqual(["bloodType", "allergies", "contacts"]);
  });

  it("counts an explicitly empty allergies list as stated", () => {
    expect(cardCompleteness({ ...ANSWERED, allergies: [], contacts: [CONTACT] })).toEqual([]);
  });

  it("counts the blood type the user does not know as answered", () => {
    expect(
      cardCompleteness({ ...ANSWERED, bloodType: "unknown", contacts: [CONTACT] }),
    ).toEqual([]);
  });

  it("still asks for a contact when the card has only the field itself filled", () => {
    expect(cardCompleteness({ ...ANSWERED, contacts: [] })).toEqual(["contacts"]);
  });
});
