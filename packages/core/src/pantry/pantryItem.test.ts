import { describe, expect, it } from "vitest";
import { MAX_ID_LENGTH } from "../ids.js";
import {
  MAX_PANTRY_DOSE_NOTE_LENGTH,
  MAX_PANTRY_LOCATION_NAME_LENGTH,
  MAX_PANTRY_NAME_LENGTH,
  MAX_PANTRY_NOTES_LENGTH,
  MAX_PANTRY_QUANTITY,
  MAX_PANTRY_USE_WITHIN_DAYS,
  PANTRY_BARCODE_LENGTHS,
  PANTRY_CATEGORIES,
  PANTRY_LOG_REASONS,
  PANTRY_UNITS,
  isPantryBarcode,
  isPantryCategory,
  isPantryLogReason,
  isPantryUnit,
  validatePantryChange,
  validatePantryItem,
  validatePantryLocation,
} from "./pantryItem.js";
import type { PantryItemFields } from "./pantryItem.js";

/** The reference „today“ a future opening date is judged against. Nothing here reads a clock. */
const TODAY = "2026-08-01";

const ITEM: PantryItemFields = {
  locationId: null,
  name: "Mleko",
  category: "food",
  quantity: 2,
  unit: "l",
  minQuantity: null,
  expiryDate: null,
  openedDate: null,
  useWithinDays: null,
  notes: null,
  barcode: null,
  doseNote: null,
};

function item(patch: Partial<PantryItemFields>): PantryItemFields {
  return { ...ITEM, ...patch };
}

/** `${field}:${code}` per problem — what makes a failure name the rule rather than the array. */
function itemCodes(value: unknown): string[] {
  return validatePantryItem(value, TODAY).map((problem) => `${problem.field}:${problem.code}`);
}

function changeCodes(value: unknown): string[] {
  return validatePantryChange(value).map((problem) => `${problem.field}:${problem.code}`);
}

function locationCodes(value: unknown): string[] {
  return validatePantryLocation(value).map((problem) => `${problem.field}:${problem.code}`);
}

describe("the pantry vocabularies", () => {
  it("carries the five categories the brief names, in that order", () => {
    expect(PANTRY_CATEGORIES).toEqual(["food", "medicine", "hygiene", "emergency", "other"]);
  });

  it("carries the six units the brief names, in that order", () => {
    expect(PANTRY_UNITS).toEqual(["pcs", "g", "kg", "ml", "l", "pack"]);
  });

  it("carries the four log reasons the brief names, in that order", () => {
    expect(PANTRY_LOG_REASONS).toEqual(["bought", "used", "expired", "correction"]);
  });

  it("offers exactly the four EAN lengths — 8, 12, 13 and 14 digits, and no other", () => {
    expect(PANTRY_BARCODE_LENGTHS).toEqual([8, 12, 13, 14]);
  });

  it("recognizes every member and refuses everything else", () => {
    expect(PANTRY_CATEGORIES.every(isPantryCategory)).toBe(true);
    expect(isPantryCategory("drink")).toBe(false);
    expect(isPantryCategory(1)).toBe(false);
    expect(PANTRY_UNITS.every(isPantryUnit)).toBe(true);
    expect(isPantryUnit("kom")).toBe(false);
    expect(PANTRY_LOG_REASONS.every(isPantryLogReason)).toBe(true);
    expect(isPantryLogReason("thrown")).toBe(false);
  });
});

describe("isPantryBarcode", () => {
  const CASES: [string, string, boolean][] = [
    ["8 digits", "12345678", true],
    ["12 digits", "123456789012", true],
    ["13 digits", "1234567890128", true],
    ["14 digits", "12345678901283", true],
    ["7 digits — a length no barcode has", "1234567", false],
    ["9 digits — between two real lengths", "123456789", false],
    ["11 digits", "12345678901", false],
    ["15 digits", "123456789012345", false],
    ["a letter among digits", "12345678a", false],
    ["spaces around a valid code — the column holds digits, not a padded string", " 12345678 ", false],
    ["empty", "", false],
  ];

  it.each(CASES)("answers %s", (_label, value, expected) => {
    expect(isPantryBarcode(value)).toBe(expected);
  });
});

describe("validatePantryItem", () => {
  it("passes a complete item", () => {
    expect(
      itemCodes(
        item({
          name: "Brufen",
          category: "medicine",
          quantity: 12,
          unit: "pcs",
          minQuantity: 4,
          expiryDate: "2027-04-30",
          openedDate: "2026-07-20",
          useWithinDays: 90,
          notes: "za glavobolju",
          barcode: "1234567890128",
          doseNote: "1 tableta uz obrok",
        }),
      ),
    ).toEqual([]);
  });

  it("passes an item that carries nothing optional at all", () => {
    expect(itemCodes(ITEM)).toEqual([]);
  });

  it("refuses anything that is not a record, naming the root", () => {
    expect(itemCodes(null)).toEqual(["<root>:shape"]);
    expect(itemCodes([])).toEqual(["<root>:shape"]);
    expect(itemCodes("Mleko")).toEqual(["<root>:shape"]);
  });

  const REFUSALS: [string, unknown, string[]][] = [
    ["a missing name", { ...ITEM, name: undefined }, ["name:shape"]],
    ["a whitespace-only name", item({ name: "   " }), ["name:shape"]],
    ["a name one character past the bound", item({ name: "x".repeat(MAX_PANTRY_NAME_LENGTH + 1) }), ["name:range"]],
    ["a category outside the five", item({ category: "drink" as never }), ["category:category"]],
    ["a missing category", { ...ITEM, category: undefined }, ["category:shape"]],
    ["a unit outside the six", item({ unit: "kom" as never }), ["unit:unit"]],
    ["a missing unit", { ...ITEM, unit: undefined }, ["unit:shape"]],
    ["a negative quantity", item({ quantity: -1 }), ["quantity:range"]],
    ["a quantity past the bound", item({ quantity: MAX_PANTRY_QUANTITY + 1 }), ["quantity:range"]],
    ["a quantity that is not a number", item({ quantity: "2" as never }), ["quantity:shape"]],
    ["a zero minimum", item({ minQuantity: 0 }), ["minQuantity:range"]],
    ["a negative minimum", item({ minQuantity: -0.5 }), ["minQuantity:range"]],
    ["an expiry that is not a real day", item({ expiryDate: "2026-02-30" }), ["expiryDate:day"]],
    ["an opening date that is not a real day", item({ openedDate: "2026-13-01" }), ["openedDate:day"]],
    ["an opening date in the future", item({ openedDate: "2026-08-02" }), ["openedDate:future"]],
    ["a zero use-within", item({ useWithinDays: 0 }), ["useWithinDays:range"]],
    ["a fractional use-within", item({ useWithinDays: 2.5 }), ["useWithinDays:range"]],
    [
      "a use-within past the ten-year bound",
      item({ useWithinDays: MAX_PANTRY_USE_WITHIN_DAYS + 1 }),
      ["useWithinDays:range"],
    ],
    ["over-long notes", item({ notes: "x".repeat(MAX_PANTRY_NOTES_LENGTH + 1) }), ["notes:range"]],
    [
      "an over-long dose note",
      item({ doseNote: "x".repeat(MAX_PANTRY_DOSE_NOTE_LENGTH + 1) }),
      ["doseNote:range"],
    ],
    ["an over-long location id", item({ locationId: "x".repeat(MAX_ID_LENGTH + 1) }), ["locationId:range"]],
  ];

  it.each(REFUSALS)("refuses %s", (_label, value, codes) => {
    expect(itemCodes(value)).toEqual(codes);
  });

  it("accepts the day itself as an opening date — only tomorrow is a future", () => {
    expect(itemCodes(item({ openedDate: TODAY }))).toEqual([]);
  });

  it("accepts a name and a location id exactly at their bounds", () => {
    expect(
      itemCodes(item({ name: "x".repeat(MAX_PANTRY_NAME_LENGTH), locationId: "x".repeat(MAX_ID_LENGTH) })),
    ).toEqual([]);
  });

  it("accepts an empty optional text as an absent one, never as an over-long one", () => {
    expect(itemCodes(item({ notes: "   ", doseNote: "" }))).toEqual([]);
  });

  it("names EVERY problem at once rather than stopping at the first", () => {
    expect(itemCodes(item({ name: "", unit: "kom" as never, quantity: -1 }))).toEqual([
      "name:shape",
      "unit:unit",
      "quantity:range",
    ]);
  });
});

describe("validatePantryLocation", () => {
  it("passes a named location", () => {
    expect(locationCodes({ name: "Ostava" })).toEqual([]);
  });

  it("refuses a missing record, an empty name and an over-long one", () => {
    expect(locationCodes(null)).toEqual(["<root>:shape"]);
    expect(locationCodes({ name: "  " })).toEqual(["name:shape"]);
    expect(locationCodes({ name: "x".repeat(MAX_PANTRY_LOCATION_NAME_LENGTH + 1) })).toEqual([
      "name:range",
    ]);
  });

  it("accepts a name exactly at the bound", () => {
    expect(locationCodes({ name: "x".repeat(MAX_PANTRY_LOCATION_NAME_LENGTH) })).toEqual([]);
  });
});

describe("validatePantryChange", () => {
  it("passes a purchase, a use and a expiry removal, and a correction in either direction", () => {
    expect(changeCodes({ delta: 3, reason: "bought" })).toEqual([]);
    expect(changeCodes({ delta: -1, reason: "used" })).toEqual([]);
    expect(changeCodes({ delta: -0.5, reason: "expired" })).toEqual([]);
    expect(changeCodes({ delta: 2, reason: "correction" })).toEqual([]);
    expect(changeCodes({ delta: -2, reason: "correction" })).toEqual([]);
  });

  it("refuses a purchase that subtracts and a use or an expiry that adds", () => {
    expect(changeCodes({ delta: -3, reason: "bought" })).toEqual(["delta:range"]);
    expect(changeCodes({ delta: 1, reason: "used" })).toEqual(["delta:range"]);
    expect(changeCodes({ delta: 1, reason: "expired" })).toEqual(["delta:range"]);
  });

  it("refuses a change of zero — a log row that records nothing is not a change", () => {
    expect(changeCodes({ delta: 0, reason: "correction" })).toEqual(["delta:range"]);
  });

  it("refuses an unknown reason, a missing delta and anything that is not a record", () => {
    expect(changeCodes({ delta: 1, reason: "thrown" })).toEqual(["reason:reason"]);
    expect(changeCodes({ reason: "used" })).toEqual(["delta:shape"]);
    expect(changeCodes({ delta: Number.NaN, reason: "used" })).toEqual(["delta:range"]);
    expect(changeCodes(null)).toEqual(["<root>:shape"]);
  });
});
