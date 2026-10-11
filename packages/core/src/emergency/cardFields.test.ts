import { describe, expect, it } from "vitest";

import {
  isAllergySeverity,
  isBloodType,
  isCardDocumentMode,
  isCardPrintLanguage,
  isOrganDonor,
  MAX_CARD_ALLERGY_LABEL_LENGTH,
  MAX_CARD_CONDITION_LENGTH,
  MAX_CARD_LIST_ITEMS,
  serializeCardAllergies,
  serializeCardConditions,
  serializeCardMedications,
  validateCardAllergies,
  validateCardConditions,
  validateCardMedications,
} from "./cardFields.js";

describe("the card's closed vocabularies", () => {
  const BLOOD_TYPE_CASES: readonly (readonly [string, boolean])[] = [
    ["O-", true],
    ["AB+", true],
    ["unknown", true],
    ["O", false],
    ["a-", false],
    ["", false],
    ["AB+-", false],
  ];

  it.each(BLOOD_TYPE_CASES)("isBloodType(%j) is %s", (value, expected) => {
    expect(isBloodType(value)).toBe(expected);
  });

  const SEVERITY_CASES: readonly (readonly [string, boolean])[] = [
    ["mild", true],
    ["severe", true],
    ["anaphylaxis", true],
    ["unknown", false],
    ["MILD", false],
  ];

  it.each(SEVERITY_CASES)("isAllergySeverity(%j) is %s", (value, expected) => {
    expect(isAllergySeverity(value)).toBe(expected);
  });

  const DONOR_CASES: readonly (readonly [string, boolean])[] = [
    ["yes", true],
    ["no", true],
    ["maybe", false],
  ];

  it.each(DONOR_CASES)("isOrganDonor(%j) is %s", (value, expected) => {
    expect(isOrganDonor(value)).toBe(expected);
  });

  const LANGUAGE_CASES: readonly (readonly [string, boolean])[] = [
    ["sr", true],
    ["en", true],
    ["both", true],
    ["de", false],
  ];

  it.each(LANGUAGE_CASES)("isCardPrintLanguage(%j) is %s", (value, expected) => {
    expect(isCardPrintLanguage(value)).toBe(expected);
  });

  const MODE_CASES: readonly (readonly [string, boolean])[] = [
    ["number", true],
    ["number_image", true],
    ["image", false],
  ];

  it.each(MODE_CASES)("isCardDocumentMode(%j) is %s", (value, expected) => {
    expect(isCardDocumentMode(value)).toBe(expected);
  });
});

describe("validateCardAllergies", () => {
  it("trims a label and keeps a stated severity, in the order given", () => {
    expect(
      validateCardAllergies([
        { label: "  Polen ", severity: null },
        { label: "Penicilin", severity: "anaphylaxis" },
      ]),
    ).toEqual([
      { label: "Polen", severity: null },
      { label: "Penicilin", severity: "anaphylaxis" },
    ]);
  });

  it("accepts an EMPTY list, which is the user stating there are none", () => {
    expect(validateCardAllergies([])).toEqual([]);
  });

  const REFUSED: readonly (readonly [string, unknown])[] = [
    ["a list that is not a list", "Penicilin"],
    ["a blank label", [{ label: "   ", severity: null }]],
    [
      "an over-long label",
      [{ label: "x".repeat(MAX_CARD_ALLERGY_LABEL_LENGTH + 1), severity: null }],
    ],
    ["an unknown severity", [{ label: "Polen", severity: "unknown" }]],
    ["a missing severity key", [{ label: "Polen" }]],
    ["an extra key", [{ label: "Polen", severity: null, note: "x" }]],
    [
      "more items than the cap",
      Array.from({ length: MAX_CARD_LIST_ITEMS + 1 }, () => ({ label: "x", severity: null })),
    ],
  ];

  it.each(REFUSED)("refuses %s", (_label, value) => {
    expect(validateCardAllergies(value)).toBeNull();
  });

  it("serializes exactly what the validator returned", () => {
    const validated = validateCardAllergies([{ label: " Polen ", severity: "mild" }]);
    expect(validated).not.toBeNull();
    expect(serializeCardAllergies(validated!)).toBe(JSON.stringify(validated));
  });
});

describe("validateCardConditions", () => {
  it("trims each condition and keeps the order", () => {
    expect(validateCardConditions([" Astma ", "Hipertenzija"])).toEqual(["Astma", "Hipertenzija"]);
  });

  it("accepts an EMPTY list, which is the user stating there are none", () => {
    expect(validateCardConditions([])).toEqual([]);
  });

  const REFUSED: readonly (readonly [string, unknown])[] = [
    ["a list that is not a list", "Astma"],
    ["a blank item", [" "]],
    ["an item that is not a string", [7]],
    ["an over-long item", ["x".repeat(MAX_CARD_CONDITION_LENGTH + 1)]],
  ];

  it.each(REFUSED)("refuses %s", (_label, value) => {
    expect(validateCardConditions(value)).toBeNull();
  });

  it("serializes exactly what the validator returned", () => {
    const validated = validateCardConditions([" Astma "]);
    expect(validated).not.toBeNull();
    expect(serializeCardConditions(validated!)).toBe(JSON.stringify(validated));
  });
});

describe("validateCardMedications", () => {
  it("trims the name and the free-text dose", () => {
    expect(
      validateCardMedications([{ name: " Ventolin ", dose: " 2 udaha po potrebi " }]),
    ).toEqual([{ name: "Ventolin", dose: "2 udaha po potrebi" }]);
  });

  it("collapses a blank dose to null, because a dose the user did not type is not stated", () => {
    expect(validateCardMedications([{ name: "Ventolin", dose: "   " }])).toEqual([
      { name: "Ventolin", dose: null },
    ]);
  });

  const REFUSED: readonly (readonly [string, unknown])[] = [
    ["a list that is not a list", { name: "Ventolin", dose: null }],
    ["a blank name", [{ name: " ", dose: null }]],
    ["a missing dose key", [{ name: "Ventolin" }]],
    ["an over-long name", [{ name: "x".repeat(1_000), dose: null }]],
    ["an over-long dose", [{ name: "Ventolin", dose: "x".repeat(1_000) }]],
  ];

  it.each(REFUSED)("refuses %s", (_label, value) => {
    expect(validateCardMedications(value)).toBeNull();
  });

  it("serializes exactly what the validator returned", () => {
    const validated = validateCardMedications([{ name: " Ventolin ", dose: " " }]);
    expect(validated).not.toBeNull();
    expect(serializeCardMedications(validated!)).toBe(JSON.stringify(validated));
  });
});
