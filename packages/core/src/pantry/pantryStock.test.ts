import { describe, expect, it } from "vitest";
import {
  PantryInputError,
  effectiveExpiry,
  shoppingList,
  stockStatus,
  wasteReport,
} from "./pantryStock.js";
import type {
  PantryLocationRef,
  PantryStockItem,
  PantryWasteEntry,
  PantryWasteItem,
} from "./pantryStock.js";

/** The reference „today“ the status boundaries below are written against. Nothing here reads a clock. */
const TODAY = "2026-08-10";

/** Seven days, the ordinary „istice uskoro“ ladder a caller passes in. */
const SOON = 7;

const BASE: PantryStockItem = {
  id: "i1",
  locationId: null,
  name: "Mleko",
  quantity: 2,
  unit: "l",
  minQuantity: null,
  expiryDate: null,
  openedDate: null,
  useWithinDays: null,
  archivedAt: null,
};

function stockItem(patch: Partial<PantryStockItem>): PantryStockItem {
  return { ...BASE, ...patch };
}

describe("effectiveExpiry", () => {
  it("answers the printed expiry when that is the only rule the item carries", () => {
    expect(effectiveExpiry(stockItem({ expiryDate: "2026-09-01" }))).toEqual({
      date: "2026-09-01",
      source: "printed",
    });
  });

  it("counts the use-within days from the day the item was OPENED", () => {
    // 2026-08-01 + 5 days = 2026-08-06.
    expect(
      effectiveExpiry(stockItem({ openedDate: "2026-08-01", useWithinDays: 5 })),
    ).toEqual({ date: "2026-08-06", source: "opened" });
  });

  it("takes the OPENED rule when it lands before the printed date", () => {
    // Opened 2026-08-01 + 30 = 2026-08-31, which is 92 days before 2026-12-01.
    expect(
      effectiveExpiry(
        stockItem({ expiryDate: "2026-12-01", openedDate: "2026-08-01", useWithinDays: 30 }),
      ),
    ).toEqual({ date: "2026-08-31", source: "opened" });
  });

  it("keeps the PRINTED date when it lands before the opened one", () => {
    // Opened 2026-08-01 + 30 = 2026-08-31, which is 21 days after 2026-08-10.
    expect(
      effectiveExpiry(
        stockItem({ expiryDate: "2026-08-10", openedDate: "2026-08-01", useWithinDays: 30 }),
      ),
    ).toEqual({ date: "2026-08-10", source: "printed" });
  });

  it("answers the PRINTED date when both rules land on the same day", () => {
    // Opened 2026-08-01 + 30 = 2026-08-31, exactly the printed date. The two
    // rules agree, and the day the product itself carries is the one reported.
    expect(
      effectiveExpiry(
        stockItem({ expiryDate: "2026-08-31", openedDate: "2026-08-01", useWithinDays: 30 }),
      ),
    ).toEqual({ date: "2026-08-31", source: "printed" });
  });

  it("answers nothing when neither rule can produce a day", () => {
    expect(effectiveExpiry(stockItem({}))).toBeNull();
    // A use-within with no opening date has nothing to count from.
    expect(effectiveExpiry(stockItem({ useWithinDays: 5 }))).toBeNull();
    // And an opened date with no use-within says nothing about when it expires.
    expect(effectiveExpiry(stockItem({ openedDate: "2026-08-01" }))).toBeNull();
  });

  it("crosses a month boundary and a leap February correctly", () => {
    expect(effectiveExpiry(stockItem({ openedDate: "2026-01-31", useWithinDays: 1 }))).toEqual({
      date: "2026-02-01",
      source: "opened",
    });
    // 2028 is a leap year, so its February has 29 days: 28 + 2 = 2028-03-01.
    expect(effectiveExpiry(stockItem({ openedDate: "2028-02-28", useWithinDays: 2 }))).toEqual({
      date: "2028-03-01",
      source: "opened",
    });
  });

  it("treats a date that is not a real calendar day as no date at all", () => {
    expect(effectiveExpiry(stockItem({ expiryDate: "2026-02-30" }))).toBeNull();
    // The printed date is corrupt, so the opened rule answers on its own.
    expect(
      effectiveExpiry(
        stockItem({
          expiryDate: "2026-02-30",
          openedDate: "2026-08-01",
          useWithinDays: 5,
        }),
      ),
    ).toEqual({ date: "2026-08-06", source: "opened" });
  });
});

describe("stockStatus", () => {
  it("reports no date, and no alarm, for an item that carries none", () => {
    expect(stockStatus(stockItem({}), TODAY, SOON)).toEqual({
      expiry: "none",
      effectiveExpiry: null,
      daysUntilExpiry: null,
      low: false,
    });
  });

  it("calls the day AFTER the expiry expired, by exactly one day", () => {
    expect(stockStatus(stockItem({ expiryDate: "2026-08-09" }), TODAY, SOON)).toEqual({
      expiry: "expired",
      effectiveExpiry: { date: "2026-08-09", source: "printed" },
      daysUntilExpiry: -1,
      low: false,
    });
  });

  it("does NOT call the expiry day itself expired — it is inside the ladder", () => {
    expect(stockStatus(stockItem({ expiryDate: TODAY }), TODAY, SOON)).toEqual({
      expiry: "soon",
      effectiveExpiry: { date: "2026-08-10", source: "printed" },
      daysUntilExpiry: 0,
      low: false,
    });
  });

  it("is soon on the last day of the ladder and ok on the first day past it", () => {
    // 2026-08-17 is exactly seven days away; 2026-08-18 is eight.
    expect(stockStatus(stockItem({ expiryDate: "2026-08-17" }), TODAY, SOON).expiry).toBe("soon");
    expect(stockStatus(stockItem({ expiryDate: "2026-08-17" }), TODAY, SOON).daysUntilExpiry).toBe(7);
    expect(stockStatus(stockItem({ expiryDate: "2026-08-18" }), TODAY, SOON).expiry).toBe("ok");
    expect(stockStatus(stockItem({ expiryDate: "2026-08-18" }), TODAY, SOON).daysUntilExpiry).toBe(8);
  });

  it("still calls the expiry day itself soon when the ladder is zero days", () => {
    expect(stockStatus(stockItem({ expiryDate: TODAY }), TODAY, 0).expiry).toBe("soon");
    expect(stockStatus(stockItem({ expiryDate: "2026-08-11" }), TODAY, 0).expiry).toBe("ok");
  });

  it("lets the OPENED rule decide, even when the printed date is far away", () => {
    // Opened 2026-08-05 + 3 = 2026-08-08, two days before the reference day —
    // and four months before the printed date.
    expect(
      stockStatus(
        stockItem({ expiryDate: "2026-12-01", openedDate: "2026-08-05", useWithinDays: 3 }),
        TODAY,
        SOON,
      ),
    ).toEqual({
      expiry: "expired",
      effectiveExpiry: { date: "2026-08-08", source: "opened" },
      daysUntilExpiry: -2,
      low: false,
    });
  });

  it("reports „low“ independently of the expiry verdict", () => {
    // Below the minimum while the expiry is fine.
    expect(stockStatus(stockItem({ quantity: 2, minQuantity: 3, expiryDate: "2026-12-01" }), TODAY, SOON)).toEqual({
      expiry: "ok",
      effectiveExpiry: { date: "2026-12-01", source: "printed" },
      daysUntilExpiry: 113,
      low: true,
    });
    // Exactly at the minimum is NOT below it.
    expect(stockStatus(stockItem({ quantity: 3, minQuantity: 3 }), TODAY, SOON).low).toBe(false);
    // No minimum means nothing to be low against.
    expect(stockStatus(stockItem({ quantity: 0 }), TODAY, SOON).low).toBe(false);
    // Empty, with a minimum, is low.
    expect(stockStatus(stockItem({ quantity: 0, minQuantity: 1 }), TODAY, SOON).low).toBe(true);
  });

  it("refuses a reference day that is not a real calendar day", () => {
    expect(() => stockStatus(stockItem({}), "danas", SOON)).toThrow(PantryInputError);
    expect(() => stockStatus(stockItem({}), "2026-02-30", SOON)).toThrow(PantryInputError);
  });

  it("refuses a ladder that is not a whole number of days", () => {
    expect(() => stockStatus(stockItem({}), TODAY, -1)).toThrow(PantryInputError);
    expect(() => stockStatus(stockItem({}), TODAY, 2.5)).toThrow(PantryInputError);
  });
});

describe("shoppingList", () => {
  const LOCATIONS: PantryLocationRef[] = [
    { id: "L2", name: "Ostava" },
    { id: "L1", name: "Frižider" },
  ];

  it("lists only what is below its minimum, in the location's group, with the quantity that reaches it", () => {
    const items: PantryStockItem[] = [
      stockItem({ id: "a1", locationId: "L1", name: "Mleko", quantity: 1, minQuantity: 2, unit: "l" }),
      // Exactly at the minimum: not below it, and so not on the list.
      stockItem({ id: "a2", locationId: "L1", name: "Jaja", quantity: 4, minQuantity: 4, unit: "pcs" }),
      stockItem({ id: "a3", locationId: "L2", name: "Brašno", quantity: 0.5, minQuantity: 2, unit: "kg" }),
      stockItem({ id: "a4", locationId: null, name: "So", quantity: 0.25, minQuantity: 1, unit: "kg" }),
      stockItem({ id: "a5", locationId: "L2", name: "Pirinač", quantity: 1, minQuantity: 2, unit: "kg", archivedAt: "2026-07-01T09:00:00.000Z" }),
      // No minimum at all: nothing to be below.
      stockItem({ id: "a6", locationId: "L1", name: "Voda", quantity: 1, minQuantity: null, unit: "l" }),
      stockItem({ id: "a7", locationId: "L2", name: "Ulje", quantity: 0, minQuantity: 1, unit: "kg" }),
    ];

    expect(shoppingList(items, LOCATIONS)).toEqual([
      {
        locationId: "L1",
        locationName: "Frižider",
        lines: [{ itemId: "a1", name: "Mleko", unit: "l", quantity: 1, minQuantity: 2, needed: 1 }],
      },
      {
        locationId: "L2",
        locationName: "Ostava",
        lines: [
          { itemId: "a3", name: "Brašno", unit: "kg", quantity: 0.5, minQuantity: 2, needed: 1.5 },
          { itemId: "a7", name: "Ulje", unit: "kg", quantity: 0, minQuantity: 1, needed: 1 },
        ],
      },
      {
        locationId: null,
        locationName: null,
        lines: [{ itemId: "a4", name: "So", unit: "kg", quantity: 0.25, minQuantity: 1, needed: 0.75 }],
      },
    ]);
  });

  it("sorts every group and every line with the Serbian Latin collator", () => {
    // The same five names, and therefore the same order, that
    // `HabitStore.listActive` already pins for `Intl.Collator(["sr-Latn", "sr"])`
    // — Č after C and Š after S, which `"sr"` alone mis-tailors.
    const items = ["Voda", "Trčanje", "Šetnja", "Čitanje", "Cveće"].map((name, index) =>
      stockItem({ id: `b${index}`, name, quantity: 0, minQuantity: 1, unit: "pcs" }),
    );

    expect(shoppingList(items, [])[0]?.lines.map((line) => line.name)).toEqual([
      "Cveće",
      "Čitanje",
      "Šetnja",
      "Trčanje",
      "Voda",
    ]);
  });

  it("puts an item whose location is no longer named among the unassigned", () => {
    const items = [
      stockItem({ id: "c1", locationId: "gone", name: "So", quantity: 0, minQuantity: 1 }),
    ];
    expect(shoppingList(items, LOCATIONS)).toEqual([
      { locationId: null, locationName: null, lines: [{ itemId: "c1", name: "So", unit: "l", quantity: 0, minQuantity: 1, needed: 1 }] },
    ]);
  });

  it("answers nothing at all when nothing is below its minimum", () => {
    const items = [
      stockItem({ id: "d1", quantity: 5, minQuantity: 2 }),
      stockItem({ id: "d2", quantity: 0, minQuantity: null }),
    ];
    expect(shoppingList(items, LOCATIONS)).toEqual([]);
  });
});

describe("wasteReport", () => {
  const ITEMS: PantryWasteItem[] = [
    { id: "i1", category: "food" },
    { id: "i2", category: "medicine" },
    { id: "i3", category: "hygiene" },
    { id: "i4", category: "food" },
  ];

  const ENTRIES: PantryWasteEntry[] = [
    // Inside the period, two items of the same category and one of another.
    { itemId: "i1", changedAt: "2026-08-05T08:00:00.000Z", delta: -2, reason: "expired" },
    { itemId: "i1", changedAt: "2026-08-20T08:00:00.000Z", delta: -0.5, reason: "expired" },
    // The LAST day of the period, inclusive.
    { itemId: "i4", changedAt: "2026-08-31T21:00:00.000Z", delta: -1, reason: "expired" },
    // The FIRST day of the period, inclusive.
    { itemId: "i2", changedAt: "2026-08-01T06:30:00.000Z", delta: -3, reason: "expired" },
    // The day before it starts, and the day after it ends: not in it.
    { itemId: "i3", changedAt: "2026-07-31T23:59:59.000Z", delta: -1, reason: "expired" },
    { itemId: "i2", changedAt: "2026-09-01T00:00:00.000Z", delta: -5, reason: "expired" },
    // Other reasons are not waste, however big the number.
    { itemId: "i1", changedAt: "2026-08-10T08:00:00.000Z", delta: -1, reason: "used" },
    { itemId: "i1", changedAt: "2026-08-02T08:00:00.000Z", delta: 4, reason: "bought" },
    { itemId: "i1", changedAt: "2026-08-03T08:00:00.000Z", delta: -0.25, reason: "correction" },
    // An entry naming an item that is not in the caller's set contributes nothing.
    { itemId: "nema", changedAt: "2026-08-06T08:00:00.000Z", delta: -9, reason: "expired" },
  ];

  it("adds up the expired quantity per category over the period, both ends inclusive", () => {
    // food: 2 + 0,5 + 1 = 3,5. medicine: 3. hygiene: nothing inside the period,
    // and so absent rather than present with a zero.
    expect(wasteReport({ entries: ENTRIES, items: ITEMS, from: "2026-08-01", to: "2026-08-31" })).toEqual([
      { category: "food", quantity: 3.5 },
      { category: "medicine", quantity: 3 },
    ]);
  });

  it("narrows to a single day when the period is one day", () => {
    expect(wasteReport({ entries: ENTRIES, items: ITEMS, from: "2026-08-05", to: "2026-08-05" })).toEqual([
      { category: "food", quantity: 2 },
    ]);
  });

  it("answers nothing for a period nothing was thrown away in", () => {
    expect(wasteReport({ entries: ENTRIES, items: ITEMS, from: "2026-10-01", to: "2026-10-31" })).toEqual([]);
  });

  it("refuses a period that is not two real days, or that runs backwards", () => {
    expect(() => wasteReport({ entries: ENTRIES, items: ITEMS, from: "avgust", to: "2026-08-31" })).toThrow(
      PantryInputError,
    );
    expect(() => wasteReport({ entries: ENTRIES, items: ITEMS, from: "2026-09-01", to: "2026-08-01" })).toThrow(
      PantryInputError,
    );
  });
});
