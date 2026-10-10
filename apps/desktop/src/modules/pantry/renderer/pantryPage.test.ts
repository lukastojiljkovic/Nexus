import { afterEach, describe, expect, it } from "vitest";
import type { PantryStockStatus } from "@nexus/core";
import { applyLocale } from "../../../renderer/src/strings.js";
import type { PantryItemView, PantryLocationView } from "../shared/ipc.js";
import { en } from "./copy.en.js";
import { sr } from "./copy.sr.js";
import {
  countedPhrase,
  expiryChipVariant,
  expiryLabel,
  formatDay,
  formatQuantity,
  groupItemsByLocation,
  parseQuantityInput,
  quantityInputValue,
  splitArchived,
  urgentItems,
} from "./pantryPage.js";

/**
 * The pantry page's pure half, against hand-computed answers.
 *
 * The two tables below are the module's REAL copy (`copy.sr.ts` / `copy.en.ts`),
 * not a fixture of invented words: what is pinned here is that a Serbian user
 * reads "Isteklo pre 2 dana" and an English one "Expired 2 days ago", and those
 * sentences only exist in those files. `dayUnit` agrees with the ACTIVE locale,
 * so the English cases switch it first and switch it back.
 *
 * Every number in an expectation is written out rather than derived: 1,5 l is
 * what `Intl` writes for twenty-five hundred millilitres' worth of Serbian, and
 * the plural forms 1 / 2 / 11 / 21 are CLDR's own table for sr-Latn (measured:
 * one / few / other / one).
 */

const SR_WORDS = { ...sr.expiring, ...sr.common };
const EN_WORDS = { ...en.expiring, ...en.common };

afterEach(() => {
  applyLocale("sr");
});

function status(partial: Partial<PantryStockStatus>): PantryStockStatus {
  return {
    expiry: "ok",
    effectiveExpiry: null,
    daysUntilExpiry: null,
    low: false,
    ...partial,
  };
}

function item(overrides: Partial<PantryItemView> & { id: string }): PantryItemView {
  return {
    locationId: null,
    name: overrides.id,
    category: "food",
    quantity: 1,
    unit: "pcs",
    minQuantity: null,
    expiryDate: null,
    openedDate: null,
    useWithinDays: null,
    notes: null,
    barcode: null,
    doseNote: null,
    archivedAt: null,
    status: status({}),
    needed: null,
    createdAt: "2026-06-01T08:00:00.000Z",
    updatedAt: "2026-06-01T08:00:00.000Z",
    ...overrides,
  };
}

describe("quantities and dates", () => {
  it("writes a quantity in the active locale's numbers, with the unit's own name", () => {
    // Serbian writes a decimal comma and a full stop for grouping.
    expect(formatQuantity(1.5, "l")).toBe("1,5 l");
    expect(formatQuantity(2500, "g")).toBe("2.500 g");
    applyLocale("en");
    expect(formatQuantity(1.5, "l")).toBe("1.5 l");
    expect(formatQuantity(2500, "g")).toBe("2,500 g");
  });

  it("reads a quantity under either decimal mark, and refuses anything else", () => {
    expect(parseQuantityInput("1,5")).toBe(1.5);
    expect(parseQuantityInput("1.5")).toBe(1.5);
    expect(parseQuantityInput(" 2 ")).toBe(2);
    expect(parseQuantityInput("0")).toBe(0);
    expect(parseQuantityInput("2,25")).toBe(2.25);
    // A fourth fraction digit, a sign, a unit typed into the box, an empty box
    // and a grouped number are all "the user is mid-edit" rather than a value.
    for (const text of ["1,2345", "-1", "2 kg", "", "1.234,5", "x"]) {
      expect(parseQuantityInput(text), text).toBeNull();
    }
  });

  it("writes a value back into a field with the locale's mark and no grouping", () => {
    expect(quantityInputValue(1.5)).toBe("1,5");
    expect(quantityInputValue(2500)).toBe("2500");
    applyLocale("en");
    expect(quantityInputValue(1.5)).toBe("1.5");
  });

  it("formats a bare day key in UTC, so the date never moves a day west of Greenwich", () => {
    // Measured ICU output for the two tag lists the app declares: sr-Latn
    // writes a day-first date with a trailing dot, en-GB is the English half.
    expect(formatDay("2026-06-01")).toBe("1. jun 2026.");
    applyLocale("en");
    expect(formatDay("2026-06-01")).toBe("1 Jun 2026");
  });

  it("returns a day key it cannot read as it stands rather than throwing at a screen", () => {
    expect(formatDay("nije-dan")).toBe("nije-dan");
    expect(formatDay("2026-13-01")).toBe("2026-13-01");
  });
});

describe("counted sentences", () => {
  it("agrees the noun with the count the way sr-Latn does: 1 and 21 singular, 2 and 11 plural", () => {
    const past = sr.expiring.past;
    expect(countedPhrase(past, 1, sr.common)).toBe("Isteklo pre 1 dan");
    expect(countedPhrase(past, 2, sr.common)).toBe("Isteklo pre 2 dana");
    expect(countedPhrase(past, 5, sr.common)).toBe("Isteklo pre 5 dana");
    // The teen exception: 11 takes the plural the way 5 does.
    expect(countedPhrase(past, 11, sr.common)).toBe("Isteklo pre 11 dana");
    // ...and 21 takes the singular the way 1 does.
    expect(countedPhrase(past, 21, sr.common)).toBe("Isteklo pre 21 dan");
  });

  it("lets the same sentence move its count in English", () => {
    applyLocale("en");
    expect(countedPhrase(en.expiring.past, 2, en.common)).toBe("Expired 2 days ago");
    expect(countedPhrase(en.expiring.past, 1, en.common)).toBe("Expired 1 day ago");
    expect(countedPhrase(en.expiring.soon, 3, en.common)).toBe("Expires in 3 days");
  });
});

describe("expiryLabel", () => {
  it("names every rung of the ladder, at its own boundary days", () => {
    // Two days PAST the date: the day after the expiry is the first `expired`
    // day, so the count shown is two.
    expect(
      expiryLabel(status({ expiry: "expired", daysUntilExpiry: -2 }), SR_WORDS),
    ).toBe("Isteklo pre 2 dana");
    // The expiry day itself is inside the ladder and so `soon`; there is no
    // rung between it and "expired", which is why the page says "today".
    expect(expiryLabel(status({ expiry: "soon", daysUntilExpiry: 0 }), SR_WORDS)).toBe(
      "Ističe danas",
    );
    expect(expiryLabel(status({ expiry: "soon", daysUntilExpiry: 3 }), SR_WORDS)).toBe(
      "Ističe za 3 dana",
    );
    expect(expiryLabel(status({ expiry: "ok", daysUntilExpiry: 8 }), SR_WORDS)).toBe("U roku");
    expect(expiryLabel(status({}), SR_WORDS)).toBe("Bez roka");
  });

  it("reads the same in English", () => {
    applyLocale("en");
    expect(expiryLabel(status({ expiry: "expired", daysUntilExpiry: -1 }), EN_WORDS)).toBe(
      "Expired 1 day ago",
    );
    expect(expiryLabel(status({ expiry: "soon", daysUntilExpiry: 0 }), EN_WORDS)).toBe(
      "Expires today",
    );
    expect(expiryLabel(status({ expiry: "ok", daysUntilExpiry: 30 }), EN_WORDS)).toBe("In date");
  });

  it("wears a chip that never carries the state by colour alone", () => {
    expect(expiryChipVariant(status({ expiry: "expired", daysUntilExpiry: -1 }))).toBe("danger");
    expect(expiryChipVariant(status({ expiry: "soon", daysUntilExpiry: 1 }))).toBe("accent");
    expect(expiryChipVariant(status({ expiry: "ok", daysUntilExpiry: 30 }))).toBe("neutral");
  });
});

describe("the lists the page draws", () => {
  it("puts what is already past first, then what expires soonest, names breaking a tie", () => {
    const urgent = urgentItems([
      item({ id: "Sok", status: status({ expiry: "ok", daysUntilExpiry: 30 }) }),
      item({ id: "Šećer", status: status({ expiry: "soon", daysUntilExpiry: 3 }) }),
      item({ id: "Čaj", status: status({ expiry: "soon", daysUntilExpiry: 3 }) }),
      item({ id: "Mleko", status: status({ expiry: "expired", daysUntilExpiry: -2 }) }),
      item({ id: "Hleb", status: status({ expiry: "soon", daysUntilExpiry: 0 }) }),
      item({ id: "So", status: status({}) }),
    ]);

    // -2, then the expiry day itself (0), then the day three days off; the two
    // of that age read Čaj before Šećer, which is the Serbian Latin order.
    expect(urgent.map((each) => each.id)).toEqual(["Mleko", "Hleb", "Čaj", "Šećer"]);
  });

  it("groups the stock by shelf in the user's order, and puts the unassigned last", () => {
    const locations: PantryLocationView[] = [
      { id: "L1", name: "Frižider", rank: "i0", createdAt: "", updatedAt: "" },
      { id: "L2", name: "Ostava", rank: "i1", createdAt: "", updatedAt: "" },
      { id: "L3", name: "Prazno", rank: "i2", createdAt: "", updatedAt: "" },
    ];
    const items = [
      item({ id: "A", locationId: "L2" }),
      item({ id: "B", locationId: null }),
      item({ id: "C", locationId: "L1" }),
      item({ id: "D", locationId: "nema" }),
    ];

    const groups = groupItemsByLocation(items, locations);
    // L3 holds nothing, so it draws no heading; the shelf with no name holds
    // BOTH the item with no location and the one whose location is gone.
    expect(groups.map((group) => group.locationId)).toEqual(["L1", "L2", null]);
    expect(groups.map((group) => group.items.map((each) => each.id))).toEqual([
      ["C"],
      ["A"],
      ["B", "D"],
    ]);
  });

  it("draws archived items after the current ones rather than losing them", () => {
    const { current, archived } = splitArchived([
      item({ id: "A" }),
      item({ id: "B", archivedAt: "2026-06-02T09:00:00.000Z" }),
      item({ id: "C" }),
    ]);
    expect(current.map((each) => each.id)).toEqual(["A", "C"]);
    expect(archived.map((each) => each.id)).toEqual(["B"]);
  });

  it("never calls an archived item urgent — the user is done with it", () => {
    const urgent = urgentItems([
      item({ id: "Mleko", status: status({ expiry: "expired", daysUntilExpiry: -3 }) }),
      item({
        id: "Bačeno",
        archivedAt: "2026-06-02T09:00:00.000Z",
        status: status({ expiry: "expired", daysUntilExpiry: -9 }),
      }),
    ]);
    // The archived item is the more overdue of the two and still not on the
    // list: a shelf that kept announcing something somebody has finished with
    // would be the app arguing with them about their own kitchen.
    expect(urgent.map((each) => each.id)).toEqual(["Mleko"]);
  });
});
