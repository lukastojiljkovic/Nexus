import { describe, expect, it } from "vitest";
import type { EmergencyCardView, EmergencyContactView } from "../shared/ipc.js";
import {
  blankAllergy,
  blankMedication,
  blankToNull,
  cardFieldsOf,
  cardFormOf,
  cardFormProblem,
  contactName,
  emptyCardForm,
  isBareDay,
  moveNeighbours,
  todayKey,
} from "./card.js";

/**
 * The card form's arithmetic, and the day check under it.
 *
 * Every expectation below is written out by hand rather than taken from the
 * function: a test that repeats what the code does cannot catch the code being
 * wrong, and these are the two places the page decides something on its own -
 * what a draft means as a value, and whether a day is a day.
 */

/** A stored card, so each test can change the one field it is about. */
function card(overrides: Partial<EmergencyCardView> = {}): EmergencyCardView {
  return {
    id: "card-1",
    fullName: "Mila Petrović",
    dateOfBirth: "1988-04-12",
    bloodType: "A+",
    allergies: [{ label: "penicilin", severity: "anaphylaxis" }],
    conditions: [],
    medications: [{ name: "metformin", dose: "1 ujutru" }],
    organDonor: "yes",
    healthInsuranceNumber: "1234567890",
    doctorName: "dr Jovan Jović",
    doctorPhone: "+381 11 000 000",
    notes: "Nosim sobu za inhalaciju.",
    printLanguage: "both",
    createdAt: "2026-07-01T09:00:00.000Z",
    updatedAt: "2026-07-01T09:00:00.000Z",
    ...overrides,
  };
}

describe("isBareDay", () => {
  it("accepts the days a calendar has", () => {
    expect(isBareDay("1988-04-12")).toBe(true);
    expect(isBareDay("2026-01-01")).toBe(true);
    expect(isBareDay("2026-01-31")).toBe(true);
    expect(isBareDay("2026-04-30")).toBe(true);
    // 2024 is a leap year: February has 29 days in it.
    expect(isBareDay("2024-02-29")).toBe(true);
    // 1900 is not: it is divisible by 100 and not by 400. 2000 is.
    expect(isBareDay("2000-02-29")).toBe(true);
    expect(isBareDay("1900-02-29")).toBe(false);
  });

  it("refuses a day no calendar has, and anything that is not one at all", () => {
    expect(isBareDay("2026-02-29")).toBe(false);
    expect(isBareDay("2026-02-30")).toBe(false);
    expect(isBareDay("2026-04-31")).toBe(false);
    expect(isBareDay("2026-13-01")).toBe(false);
    expect(isBareDay("2026-00-10")).toBe(false);
    expect(isBareDay("2026-01-00")).toBe(false);
    expect(isBareDay("2026-1-1")).toBe(false);
    expect(isBareDay("12.04.1988.")).toBe(false);
    expect(isBareDay("")).toBe(false);
    expect(isBareDay("danas")).toBe(false);
  });
});

describe("todayKey", () => {
  it("reads the DEVICE's own calendar rather than UTC", () => {
    // Constructed from local components, which is what a person means by today.
    expect(todayKey(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
    expect(todayKey(new Date(2026, 11, 31, 0, 5))).toBe("2026-12-31");
    expect(todayKey(new Date(988, 6, 4))).toBe("0988-07-04");
  });
});

describe("cardFieldsOf", () => {
  it("turns blanks into nulls and keeps both answers to a list question apart", () => {
    const empty = emptyCardForm();
    expect(cardFieldsOf(empty)).toEqual({
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
    });

    // The tick says „there are none", and the empty list travels as itself.
    expect(cardFieldsOf({ ...empty, allergiesAnswered: true }).allergies).toEqual([]);
    // No tick, no rows: the question is unanswered, which is a different answer.
    expect(cardFieldsOf({ ...empty, allergiesAnswered: false }).allergies).toBeNull();
  });

  it("drops a row nobody filled in, and reads a blank dose as no dose", () => {
    const fields = cardFieldsOf({
      ...emptyCardForm(),
      allergies: [blankAllergy(), { label: "  penicilin  ", severity: "severe" }],
      conditions: ["  astma ", "   "],
      medications: [blankMedication(), { name: " metformin ", dose: "   " }],
    });
    expect(fields.allergies).toEqual([{ label: "penicilin", severity: "severe" }]);
    expect(fields.conditions).toEqual(["astma"]);
    expect(fields.medications).toEqual([{ name: "metformin", dose: null }]);
  });

  it("round-trips a stored card through the form", () => {
    const stored = card({ allergies: [{ label: "penicilin", severity: "severe" }] });
    const fields = cardFieldsOf(cardFormOf(stored));
    expect(fields).toEqual({
      fullName: "Mila Petrović",
      dateOfBirth: "1988-04-12",
      bloodType: "A+",
      allergies: [{ label: "penicilin", severity: "severe" }],
      // An empty stored list was an ANSWER, and comes back as one.
      conditions: [],
      medications: [{ name: "metformin", dose: "1 ujutru" }],
      organDonor: "yes",
      healthInsuranceNumber: "1234567890",
      doctorName: "dr Jovan Jović",
      doctorPhone: "+381 11 000 000",
      notes: "Nosim sobu za inhalaciju.",
      printLanguage: "both",
    });
  });
});

describe("cardFormProblem", () => {
  it("refuses a future day and a day that does not exist, and passes an ordinary one", () => {
    const form = emptyCardForm();
    expect(cardFormProblem({ ...form, dateOfBirth: "1988-04-12" }, "2026-07-01")).toBeNull();
    expect(cardFormProblem({ ...form, dateOfBirth: "2026-07-01" }, "2026-07-01")).toBeNull();
    expect(cardFormProblem({ ...form, dateOfBirth: "2026-07-02" }, "2026-07-01")).toBe(
      "dateOfBirth",
    );
    expect(cardFormProblem({ ...form, dateOfBirth: "2026-02-30" }, "2026-07-01")).toBe(
      "dateOfBirth",
    );
  });

  it("refuses a name over the store's own cap and passes one at it", () => {
    const form = emptyCardForm();
    expect(cardFormProblem({ ...form, fullName: "a".repeat(120) }, "2026-07-01")).toBeNull();
    expect(cardFormProblem({ ...form, fullName: "a".repeat(121) }, "2026-07-01")).toBe("fullName");
    // The name is trimmed before it is measured, exactly as the store trims it.
    expect(cardFormProblem({ ...form, fullName: `  ${"a".repeat(120)}  ` }, "2026-07-01")).toBeNull();
  });
});

describe("moveNeighbours", () => {
  const ids = ["a", "b", "c"];

  it("names the pair a moved row lands between, in the order the store takes them", () => {
    // Moving „b" up puts it above „a", so nothing is above it and „a" is below.
    expect(moveNeighbours(ids, 1, "up")).toEqual({ beforeId: null, afterId: "a" });
    // Moving „c" up puts it between „a" and „b".
    expect(moveNeighbours(ids, 2, "up")).toEqual({ beforeId: "a", afterId: "b" });
    // Moving „a" down puts it between „b" and „c".
    expect(moveNeighbours(ids, 0, "down")).toEqual({ beforeId: "b", afterId: "c" });
    // Moving „b" down puts it below „c", so nothing is below it.
    expect(moveNeighbours(ids, 1, "down")).toEqual({ beforeId: "c", afterId: null });
  });

  it("answers null at the ends of a list, which is what the arrows are disabled on", () => {
    expect(moveNeighbours(ids, 0, "up")).toBeNull();
    expect(moveNeighbours(ids, 2, "down")).toBeNull();
    expect(moveNeighbours(["only"], 0, "up")).toBeNull();
    expect(moveNeighbours(["only"], 0, "down")).toBeNull();
  });
});

describe("contactName", () => {
  const text: EmergencyContactView = {
    id: "c1",
    personId: null,
    name: "Ana",
    phone: "064",
    relation: null,
    rank: "i0",
  };
  const linked: EmergencyContactView = { ...text, personId: "p1", name: null };
  const people = [{ id: "p1", name: "Ana Petrović" }];

  it("reads the contact's own text, or the live name of the person it points at", () => {
    expect(contactName(text, people)).toBe("Ana");
    expect(contactName(linked, people)).toBe("Ana Petrović");
  });

  it("answers null for a person who has left the address book, rather than invent one", () => {
    expect(contactName({ ...linked, personId: "gone" }, people)).toBeNull();
  });
});

describe("blankToNull", () => {
  it("trims, and reads a blank as nothing said", () => {
    expect(blankToNull("  Marko  ")).toBe("Marko");
    expect(blankToNull("   ")).toBeNull();
    expect(blankToNull("")).toBeNull();
  });
});
