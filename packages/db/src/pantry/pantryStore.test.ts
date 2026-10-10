import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NexusDatabase,
  PANTRY_EXPORT_VERSION,
  PantryNotFoundError,
  PantryStore,
  PantryValidationError,
  openDatabase,
  uuidv7,
} from "../index.js";
import type { CreatePantryItemInput, PantryExport } from "../index.js";

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:00:00.000Z";
const AUGUST = "2026-08-01T10:00:00.000Z";

let dir: string;
let db: NexusDatabase;
/** Databases a test opened for itself — a second device an archive travels to. */
let extras: { db: NexusDatabase; dir: string }[];

beforeEach(() => {
  extras = [];
  dir = mkdtempSync(join(tmpdir(), "nexus-pantry-"));
  db = openDatabase({ path: join(dir, "pantry.db") });
});

afterEach(() => {
  for (const extra of extras) {
    extra.db.close();
    rmSync(extra.dir, { recursive: true, force: true });
  }
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", NOW);
  return id;
}

function store(): PantryStore {
  return new PantryStore(db.raw, createProfile());
}

const MILK: CreatePantryItemInput = {
  name: "Mleko",
  category: "food",
  quantity: 2,
  unit: "l",
};

describe("PantryStore locations", () => {
  it("appends each new location after the ones already there", () => {
    const pantry = store();
    const first = pantry.createLocation({ name: "Ostava" }, NOW);
    const second = pantry.createLocation({ name: "Frižider" }, LATER);

    expect(first).toMatchObject({
      name: "Ostava",
      rank: "i0",
      createdAt: NOW,
      updatedAt: NOW,
    });
    // An append is an integer increment off the last rank (migration 062's
    // representation), which is why the second one is `i1`.
    expect(second.rank).toBe("i1");
    expect(pantry.listLocations().map((location) => location.name)).toEqual([
      "Ostava",
      "Frižider",
    ]);
  });

  it("trims the name, and refuses an empty or over-long one", () => {
    const pantry = store();
    expect(pantry.createLocation({ name: "  Ostava  " }, NOW).name).toBe("Ostava");
    expect(() => pantry.createLocation({ name: "   " }, NOW)).toThrow(PantryValidationError);
    expect(() => pantry.createLocation({ name: "x".repeat(61) }, NOW)).toThrow(
      PantryValidationError,
    );
  });

  it("renames a location without changing its place", () => {
    const pantry = store();
    const first = pantry.createLocation({ name: "Ostava" }, NOW);
    pantry.createLocation({ name: "Frižider" }, NOW);

    expect(pantry.renameLocation(first.id, "Šupa", LATER)).toMatchObject({
      name: "Šupa",
      rank: first.rank,
      updatedAt: LATER,
    });
    expect(pantry.listLocations().map((location) => location.name)).toEqual(["Šupa", "Frižider"]);
  });

  it("moves a location between two neighbours, to the start and to the end", () => {
    const pantry = store();
    const a = pantry.createLocation({ name: "A" }, NOW);
    const b = pantry.createLocation({ name: "B" }, NOW);
    const c = pantry.createLocation({ name: "C" }, NOW);

    // C in front of A.
    pantry.moveLocation(c.id, null, a.id, LATER);
    expect(pantry.listLocations().map((location) => location.name)).toEqual(["C", "A", "B"]);

    // B between A and its successor: the end of the list.
    pantry.moveLocation(b.id, a.id, null, LATER);
    expect(pantry.listLocations().map((location) => location.name)).toEqual(["C", "A", "B"]);

    // A in front of C.
    pantry.moveLocation(a.id, null, c.id, LATER);
    expect(pantry.listLocations().map((location) => location.name)).toEqual(["A", "C", "B"]);
  });

  it("refuses a reorder whose neighbours are not a gap, and a neighbouring id it cannot see", () => {
    const pantry = store();
    const theirs = store();
    const a = pantry.createLocation({ name: "A" }, NOW);
    const b = pantry.createLocation({ name: "B" }, NOW);
    const theirsLocation = theirs.createLocation({ name: "Njihova" }, NOW);

    expect(() => pantry.moveLocation(a.id, b.id, a.id, LATER)).toThrow(PantryValidationError);
    expect(() => pantry.moveLocation(a.id, "nema", null, LATER)).toThrow(PantryNotFoundError);
    expect(() => pantry.moveLocation(a.id, theirsLocation.id, null, LATER)).toThrow(
      PantryNotFoundError,
    );
  });

  it("refuses to remove a location that still holds items, and removes it once they leave", () => {
    const pantry = store();
    const shelf = pantry.createLocation({ name: "Ostava" }, NOW);
    const item = pantry.createItem({ ...MILK, locationId: shelf.id }, NOW);

    expect(() => pantry.softDeleteLocation(shelf.id, LATER)).toThrow(PantryValidationError);
    expect(pantry.listLocations()).toHaveLength(1);

    pantry.updateItem(item.id, { locationId: null }, LATER);
    pantry.softDeleteLocation(shelf.id, LATER);
    expect(pantry.listLocations()).toEqual([]);

    pantry.restoreLocation(shelf.id, LATER);
    expect(pantry.listLocations().map((location) => location.id)).toEqual([shelf.id]);
  });

  it("refuses to delete twice, to restore what is not deleted, and a location it cannot see", () => {
    const pantry = store();
    const shelf = pantry.createLocation({ name: "Ostava" }, NOW);
    expect(() => pantry.restoreLocation(shelf.id, LATER)).toThrow(PantryNotFoundError);
    expect(() => pantry.softDeleteLocation("nema", LATER)).toThrow(PantryNotFoundError);
    pantry.softDeleteLocation(shelf.id, LATER);
    expect(() => pantry.softDeleteLocation(shelf.id, LATER)).toThrow(PantryNotFoundError);
  });

  it("shows one profile nothing of another's locations", () => {
    const mine = store();
    const theirs = store();
    mine.createLocation({ name: "Ostava" }, NOW);
    expect(theirs.listLocations()).toEqual([]);
  });
});

describe("PantryStore items", () => {
  it("stores an item with every optional field absent, and returns the row", () => {
    const pantry = store();
    const item = pantry.createItem(MILK, NOW);

    expect(item).toMatchObject({
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
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(pantry.listItems()).toEqual([item]);
  });

  it("stores every field, in the units the caller typed", () => {
    const pantry = store();
    const shelf = pantry.createLocation({ name: "Prva pomoć" }, NOW);
    const item = pantry.createItem(
      {
        name: "  Brufen  ",
        category: "medicine",
        quantity: 12,
        unit: "pcs",
        locationId: shelf.id,
        minQuantity: 4,
        expiryDate: "2027-04-30",
        openedDate: "2026-05-20",
        useWithinDays: 90,
        notes: "  za glavobolju  ",
        barcode: "1234567890128",
        doseNote: "  1 tableta uz obrok  ",
      },
      NOW,
    );

    expect(item).toMatchObject({
      name: "Brufen",
      locationId: shelf.id,
      minQuantity: 4,
      expiryDate: "2027-04-30",
      openedDate: "2026-05-20",
      useWithinDays: 90,
      notes: "za glavobolju",
      barcode: "1234567890128",
      doseNote: "1 tableta uz obrok",
    });
    expect(pantry.listItems()).toEqual([item]);
  });

  const REFUSALS: [string, unknown][] = [
    ["an empty name", { ...MILK, name: "  " }],
    ["an over-long name", { ...MILK, name: "x".repeat(81) }],
    ["a category outside the five", { ...MILK, category: "drink" }],
    ["a unit outside the six", { ...MILK, unit: "kom" }],
    ["a negative quantity", { ...MILK, quantity: -1 }],
    ["a quantity past the ceiling", { ...MILK, quantity: 1_000_001 }],
    ["a zero minimum", { ...MILK, minQuantity: 0 }],
    ["a barcode of seven digits", { ...MILK, barcode: "1234567" }],
    ["a barcode with a letter in it", { ...MILK, barcode: "12345678a" }],
    ["a padded barcode", { ...MILK, barcode: " 12345678 " }],
    ["an expiry that is not a real day", { ...MILK, expiryDate: "2026-02-30" }],
    ["an opening date in the future", { ...MILK, openedDate: "2026-08-09" }],
    ["a fractional use-within", { ...MILK, useWithinDays: 2.5 }],
    ["over-long notes", { ...MILK, notes: "x".repeat(501) }],
    ["an over-long dose note", { ...MILK, doseNote: "x".repeat(301) }],
    ["no name at all", { category: "food", quantity: 2, unit: "l" }],
  ];

  it.each(REFUSALS)("refuses %s", (_label, input) => {
    const pantry = store();
    expect(() => pantry.createItem(input as CreatePantryItemInput, NOW)).toThrow(
      PantryValidationError,
    );
  });

  it("refuses a location that is unknown, deleted or another profile's", () => {
    const pantry = store();
    const theirs = store();
    const theirsShelf = theirs.createLocation({ name: "Njihova ostava" }, NOW);
    const mine = pantry.createLocation({ name: "Ostava" }, NOW);

    expect(() => pantry.createItem({ ...MILK, locationId: "nema" }, NOW)).toThrow(
      PantryNotFoundError,
    );
    expect(() => pantry.createItem({ ...MILK, locationId: theirsShelf.id }, NOW)).toThrow(
      PantryNotFoundError,
    );
    pantry.softDeleteLocation(mine.id, LATER);
    expect(() => pantry.createItem({ ...MILK, locationId: mine.id }, NOW)).toThrow(
      PantryNotFoundError,
    );
  });

  it("sorts sr-Latn alphabetically", () => {
    const pantry = store();
    for (const name of ["Voda", "Trčanje", "Šetnja", "Čitanje", "Cveće"]) {
      pantry.createItem({ ...MILK, name }, NOW);
    }
    expect(pantry.listItems().map((item) => item.name)).toEqual([
      "Cveće",
      "Čitanje",
      "Šetnja",
      "Trčanje",
      "Voda",
    ]);
  });

  it("shows one profile nothing of another's items", () => {
    const mine = store();
    const theirs = store();
    mine.createItem(MILK, NOW);
    expect(theirs.listItems()).toEqual([]);
  });

  it("applies a partial patch, and clears a nullable field on an explicit null", () => {
    const pantry = store();
    const item = pantry.createItem({ ...MILK, minQuantity: 3, notes: "otvoreno" }, NOW);

    expect(pantry.updateItem(item.id, { name: "Mleko 2.8%" }, LATER)).toMatchObject({
      name: "Mleko 2.8%",
      minQuantity: 3,
      notes: "otvoreno",
      updatedAt: LATER,
    });
    expect(pantry.updateItem(item.id, { notes: null }, LATER)).toMatchObject({ notes: null });
  });

  it("refuses a patch that sets the quantity, and says where quantity moves", () => {
    const pantry = store();
    const item = pantry.createItem(MILK, NOW);

    expect(() => pantry.updateItem(item.id, { quantity: 5 } as never, LATER)).toThrow(
      /changeQuantity/,
    );
    expect(pantry.listItems()[0]?.quantity).toBe(2);
  });

  it("refuses a patch on an unknown, deleted or foreign item", () => {
    const pantry = store();
    const theirs = store();
    const item = pantry.createItem(MILK, NOW);

    expect(() => pantry.updateItem("nema", { name: "X" }, LATER)).toThrow(PantryNotFoundError);
    expect(() => pantry.updateItem(item.id, { name: "X", barcode: "nope" }, LATER)).toThrow(
      PantryValidationError,
    );
    expect(() => theirs.updateItem(item.id, { name: "X" }, LATER)).toThrow(PantryNotFoundError);
    pantry.softDeleteItem(item.id, LATER);
    expect(() => pantry.updateItem(item.id, { name: "X" }, LATER)).toThrow(PantryNotFoundError);
  });

  it("keeps archiving and deleting independent in both directions", () => {
    const pantry = store();
    const item = pantry.createItem(MILK, NOW);

    pantry.archiveItem(item.id, LATER);
    expect(pantry.listItems()).toEqual([{ ...item, archivedAt: LATER, updatedAt: LATER }]);

    pantry.softDeleteItem(item.id, LATER);
    expect(pantry.listItems()).toEqual([]);

    pantry.restoreItem(item.id, LATER);
    expect(pantry.listItems()[0]?.archivedAt).toBe(LATER);
    pantry.unarchiveItem(item.id, LATER);
    expect(pantry.listItems()[0]?.archivedAt).toBeNull();
  });

  it("still edits an ARCHIVED item", () => {
    const pantry = store();
    const item = pantry.createItem(MILK, NOW);
    pantry.archiveItem(item.id, LATER);
    expect(pantry.updateItem(item.id, { name: "Mleko 3.2%" }, LATER).name).toBe("Mleko 3.2%");
  });

  it.each([
    ["archiveItem", (pantry: PantryStore, id: string) => pantry.archiveItem(id, LATER)],
    ["unarchiveItem", (pantry: PantryStore, id: string) => pantry.unarchiveItem(id, LATER)],
    ["softDeleteItem", (pantry: PantryStore, id: string) => pantry.softDeleteItem(id, LATER)],
    ["restoreItem", (pantry: PantryStore, id: string) => pantry.restoreItem(id, LATER)],
  ])("%s refuses an item it cannot see", (_label, act) => {
    const pantry = store();
    expect(() => act(pantry, "nema")).toThrow(PantryNotFoundError);
  });

  it("keeps an item's LOG through a delete, so undo brings it back with the item", () => {
    const pantry = store();
    const item = pantry.createItem(MILK, NOW);
    pantry.changeQuantity(item.id, 3, "bought", NOW);
    expect(pantry.listLog()).toHaveLength(1);

    pantry.softDeleteItem(item.id, LATER);
    // The rows are still THERE — the soft delete is an UPDATE, and a hard delete
    // would be the only thing that reaches them.
    expect(
      db.raw.prepare("SELECT COUNT(*) AS n FROM pantry_log WHERE item_id = ?").get(item.id),
    ).toEqual({ n: 1 });
    // But they are out of every read this store makes.
    expect(pantry.listLog()).toEqual([]);

    pantry.restoreItem(item.id, LATER);
    expect(pantry.listLog()).toHaveLength(1);
  });
});

describe("PantryStore.quantity changes", () => {
  it("moves the quantity and writes the log row in the same call", () => {
    const pantry = store();
    const item = pantry.createItem(MILK, NOW);

    expect(pantry.changeQuantity(item.id, 3, "bought", AUGUST)).toMatchObject({
      quantity: 5,
      updatedAt: AUGUST,
    });
    expect(pantry.listLog()).toEqual([
      {
        id: expect.any(String),
        itemId: item.id,
        changedAt: AUGUST,
        delta: 3,
        reason: "bought",
      },
    ]);

    pantry.changeQuantity(item.id, -1, "used", AUGUST);
    pantry.changeQuantity(item.id, -2, "expired", AUGUST);
    expect(pantry.changeQuantity(item.id, 0.5, "correction", AUGUST).quantity).toBe(2.5);
    expect(pantry.listLog().map((entry) => [entry.delta, entry.reason])).toEqual([
      [3, "bought"],
      [-1, "used"],
      [-2, "expired"],
      [0.5, "correction"],
    ]);
  });

  it("refuses a change that would leave the quantity below zero, without writing EITHER half", () => {
    const pantry = store();
    const item = pantry.createItem({ ...MILK, quantity: 2 }, NOW);

    expect(() => pantry.changeQuantity(item.id, -3, "used", AUGUST)).toThrow(
      PantryValidationError,
    );
    // Neither the shelf nor the history moved: the guard runs before either
    // statement, and the two statements themselves are one transaction.
    expect(pantry.listItems()[0]?.quantity).toBe(2);
    expect(pantry.listLog()).toEqual([]);
  });

  it.each([
    ["a purchase that subtracts", -3, "bought"],
    ["a use that adds", 1, "used"],
    ["an expiry that adds", 1, "expired"],
    ["a change of zero", 0, "correction"],
    ["an unknown reason", 1, "thrown"],
  ])("refuses %s", (_label, delta, reason) => {
    const pantry = store();
    const item = pantry.createItem({ ...MILK, quantity: 4 }, NOW);
    expect(() => pantry.changeQuantity(item.id, delta, reason as never, AUGUST)).toThrow(
      PantryValidationError,
    );
    expect(pantry.listLog()).toEqual([]);
    expect(pantry.listItems()[0]?.quantity).toBe(4);
  });

  it("refuses a change on an unknown, deleted or foreign item", () => {
    const pantry = store();
    const theirs = store();
    const item = pantry.createItem(MILK, NOW);

    expect(() => pantry.changeQuantity("nema", 1, "bought", LATER)).toThrow(PantryNotFoundError);
    expect(() => theirs.changeQuantity(item.id, 1, "bought", LATER)).toThrow(PantryNotFoundError);
    pantry.softDeleteItem(item.id, LATER);
    expect(() => pantry.changeQuantity(item.id, 1, "bought", LATER)).toThrow(PantryNotFoundError);
  });

  it("reads every change of the profile's live items, oldest first", () => {
    const pantry = store();
    const milk = pantry.createItem({ ...MILK, name: "Mleko" }, NOW);
    const flour = pantry.createItem({ ...MILK, name: "Brašno", unit: "kg" }, NOW);

    pantry.changeQuantity(flour.id, 2, "bought", AUGUST);
    pantry.changeQuantity(milk.id, 4, "bought", LATER);

    expect(pantry.listLog().map((entry) => [entry.itemId, entry.changedAt])).toEqual([
      [milk.id, LATER],
      [flour.id, AUGUST],
    ]);
  });

  it("shows one profile nothing of another's log", () => {
    const mine = store();
    const theirs = store();
    const item = mine.createItem(MILK, NOW);
    mine.changeQuantity(item.id, 1, "bought", NOW);
    expect(theirs.listLog()).toEqual([]);
  });

  it("has the schema behind it: a raw UPDATE to a negative quantity is refused", () => {
    const pantry = store();
    const item = pantry.createItem(MILK, NOW);
    expect(() =>
      db.raw.prepare("UPDATE pantry_items SET quantity = -1 WHERE id = ?").run(item.id),
    ).toThrow(/CHECK/);
  });

  it("refuses a malformed `now` — main stamps the clock, the renderer never does", () => {
    const pantry = store();
    const item = pantry.createItem(MILK, NOW);
    expect(() => pantry.changeQuantity(item.id, 1, "bought", "juče")).toThrow(
      PantryValidationError,
    );
    expect(() => pantry.createLocation({ name: "Ostava" }, "juče")).toThrow(
      PantryValidationError,
    );
  });
});

describe("PantryStore export and import", () => {
  /**
   * A second, empty database — the OTHER DEVICE an archive travels to, which is
   * what a profile restore is. A row id is unique across a whole database, so an
   * import into a profile of the very database the archive came from is a
   * different question, and has its own test below.
   */
  function otherStore(): PantryStore {
    const otherDir = mkdtempSync(join(tmpdir(), "nexus-pantry-other-"));
    const otherDb = openDatabase({ path: join(otherDir, "other.db") });
    extras.push({ db: otherDb, dir: otherDir });
    const id = uuidv7();
    otherDb.raw
      .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
      .run(id, "personal", "Q", NOW);
    return new PantryStore(otherDb.raw, id);
  }

  /** A pantry with an order of its own, an archived item, a deleted one, and history. */
  function seeded(): { pantry: PantryStore; exported: PantryExport } {
    const pantry = store();
    const ostava = pantry.createLocation({ name: "Ostava" }, NOW);
    const frizider = pantry.createLocation({ name: "Frižider" }, NOW);
    // The user's own order: Frižider first.
    pantry.moveLocation(frizider.id, null, ostava.id, LATER);

    const milk = pantry.createItem(
      {
        ...MILK,
        locationId: frizider.id,
        quantity: 2,
        minQuantity: 3,
        expiryDate: "2026-08-31",
        openedDate: "2026-08-01",
        useWithinDays: 5,
        barcode: "1234567890128",
      },
      AUGUST,
    );
    pantry.changeQuantity(milk.id, 3, "bought", AUGUST);
    pantry.changeQuantity(milk.id, -1, "used", AUGUST);

    const archived = pantry.createItem({ ...MILK, name: "So", unit: "kg" }, NOW);
    pantry.archiveItem(archived.id, LATER);

    const deleted = pantry.createItem({ ...MILK, name: "Bačeno" }, NOW);
    pantry.softDeleteItem(deleted.id, LATER);

    return { pantry, exported: pantry.exportData() };
  }

  it("round-trips the whole pantry into another database, ids, order and history included", () => {
    const source = seeded();
    const target = otherStore();

    target.importData(source.exported);

    // Byte-for-byte the same value, which is what makes the round trip a round
    // trip rather than a resemblance.
    expect(target.exportData()).toEqual(source.exported);
    expect(source.exported.version).toBe(PANTRY_EXPORT_VERSION);
    expect(target.listLocations().map((location) => location.name)).toEqual([
      "Frižider",
      "Ostava",
    ]);
    // The archived item travelled; the deleted one did not.
    expect(target.listItems().map((item) => item.name)).toEqual(["Mleko", "So"]);
    expect(target.listLog().map((entry) => entry.delta)).toEqual([3, -1]);
    // The rows carry the archive's own ids and belong to the TARGET profile:
    // that, and not a copy, is what a restore is.
    expect(new Set(target.listItems().map((item) => item.profileId)).size).toBe(1);
    expect(target.listItems()[0]?.id).toBe(source.exported.items[0]?.id);
    expect(target.listItems()[0]?.profileId).not.toBe(source.pantry.listItems()[0]?.profileId);
  });

  it("replaces the profile's OWN pantry on a re-import, so importing twice is one pantry", () => {
    const source = seeded();

    source.pantry.importData(source.exported);
    source.pantry.importData(source.exported);

    expect(source.pantry.exportData()).toEqual(source.exported);
  });

  it("refuses ids this database already holds under ANOTHER profile, and writes nothing", () => {
    const source = seeded();
    const target = store();

    expect(() => target.importData(source.exported)).toThrow(/another profile/);
    expect(target.listLocations()).toEqual([]);
    expect(target.listItems()).toEqual([]);
    expect(target.listLog()).toEqual([]);
  });

  it("refuses an unknown version, and refuses it without touching what is there", () => {
    const source = seeded();
    const target = store();
    const existing = target.createItem({ ...MILK, name: "Postojeći" }, NOW);

    expect(() => target.importData({ ...source.exported, version: 2 })).toThrow(
      /Unsupported pantry export version/,
    );
    expect(() => target.importData({ ...source.exported, version: "1" })).toThrow(
      PantryValidationError,
    );
    expect(target.listItems().map((item) => item.name)).toEqual([existing.name]);
  });

  const CORRUPTIONS: [string, (exported: PantryExport) => unknown][] = [
    ["a value that is not an object", () => null],
    ["a value with an extra key", (exported) => ({ ...exported, extra: 1 })],
    [
      "a duplicated location id",
      (exported) => ({
        ...exported,
        locations: [...exported.locations, exported.locations[0]],
      }),
    ],
    [
      "a duplicated item id",
      (exported) => ({ ...exported, items: [...exported.items, exported.items[0]] }),
    ],
    [
      "a duplicated change id",
      (exported) => ({ ...exported, log: [...exported.log, exported.log[0]] }),
    ],
    [
      "an item naming a location the value does not carry",
      (exported) => ({
        ...exported,
        items: exported.items.map((item) => ({ ...item, locationId: "nema" })),
      }),
    ],
    [
      "a change naming an item the value does not carry",
      (exported) => ({
        ...exported,
        log: exported.log.map((entry) => ({ ...entry, itemId: "nema" })),
      }),
    ],
    [
      "a location with a rank that is not one",
      (exported) => ({
        ...exported,
        locations: exported.locations.map((location) => ({ ...location, rank: "!!" })),
      }),
    ],
    [
      "an item whose barcode is not a barcode",
      (exported) => ({
        ...exported,
        items: exported.items.map((item) => ({ ...item, barcode: "123" })),
      }),
    ],
    [
      "a change whose sign contradicts its reason",
      (exported) => ({
        ...exported,
        log: exported.log.map((entry) => ({ ...entry, delta: 5 })),
      }),
    ],
    [
      "a value whose log is not an array",
      (exported) => ({ ...exported, log: null }),
    ],
  ];

  it.each(CORRUPTIONS)("refuses %s, leaving the pantry as it stood", (_label, corrupt) => {
    const source = seeded();
    const target = otherStore();
    const existing = target.createItem({ ...MILK, name: "Postojeći" }, NOW);

    expect(() => target.importData(corrupt(source.exported))).toThrow(PantryValidationError);
    expect(target.listItems().map((item) => item.name)).toEqual([existing.name]);
    expect(target.listLocations()).toEqual([]);
    expect(target.listLog()).toEqual([]);
  });

  it("refuses an opening date after the row's own last-write day", () => {
    const source = seeded();
    const target = otherStore();
    const milk = source.exported.items.find((item) => item.name === "Mleko");
    expect(milk).toBeDefined();
    const others = source.exported.items.filter((item) => item !== milk);
    // The seeded milk was last written on 2026-08-01, so the 2nd is a future it
    // cannot have been given by this store — and the 1st is the day itself.
    const day = (milk?.updatedAt ?? "").slice(0, 10);

    expect(() =>
      target.importData({
        ...source.exported,
        items: [{ ...milk, openedDate: shift(day, 1) }, ...others],
      }),
    ).toThrow(/openedDate/);
    expect(() =>
      target.importData({
        ...source.exported,
        items: [{ ...milk, openedDate: day }, ...others],
      }),
    ).not.toThrow();
  });
});

describe("the schema behind the store", () => {
  /**
   * A raw item row, bypassing the store entirely — the point of this block. The
   * store refuses these values before any statement runs, so the only way to ask
   * SQLite whether migration 075's CHECKs really exist is to send them straight
   * at the table.
   */
  function rawItem(profileId: string, patch: Record<string, unknown> = {}): void {
    const row = {
      id: uuidv7(),
      location_id: null,
      name: "Mleko",
      category: "food",
      quantity: 1,
      unit: "l",
      min_quantity: null,
      expiry_date: null,
      opened_date: null,
      use_within_days: null,
      notes: null,
      barcode: null,
      dose_note: null,
      archived_at: null,
      ...patch,
    };
    db.raw
      .prepare(
        `INSERT INTO pantry_items
           (id, profile_id, location_id, name, category, quantity, unit, min_quantity,
            expiry_date, opened_date, use_within_days, notes, barcode, dose_note,
            archived_at, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        row.id, profileId, row.location_id, row.name, row.category, row.quantity, row.unit,
        row.min_quantity, row.expiry_date, row.opened_date, row.use_within_days, row.notes,
        row.barcode, row.dose_note, row.archived_at, NOW, NOW,
      );
  }

  it("refuses a barcode that is not 8, 12, 13 or 14 digits", () => {
    const profileId = createProfile();
    expect(() => rawItem(profileId, { barcode: "123" })).toThrow(/CHECK/);
    expect(() => rawItem(profileId, { barcode: "1234567a" })).toThrow(/CHECK/);
    expect(() => rawItem(profileId, { barcode: " 12345678" })).toThrow(/CHECK/);
    expect(() => rawItem(profileId, { barcode: "00000000" })).not.toThrow();
  });

  it("refuses a quantity outside its bounds, which is what backs the store's own refusal", () => {
    const profileId = createProfile();
    expect(() => rawItem(profileId, { quantity: -1 })).toThrow(/CHECK/);
    expect(() => rawItem(profileId, { quantity: 1_000_001 })).toThrow(/CHECK/);
    expect(() => rawItem(profileId, { min_quantity: 0 })).toThrow(/CHECK/);
  });

  it("refuses a fractional use-within, on the typeof test migration 055 taught this schema", () => {
    const profileId = createProfile();
    expect(() => rawItem(profileId, { use_within_days: 2.5 })).toThrow(/CHECK/);
    expect(() => rawItem(profileId, { use_within_days: 30 })).not.toThrow();
  });

  it("refuses a change whose sign contradicts its reason, and a change of zero", () => {
    const profileId = createProfile();
    rawItem(profileId);
    const itemId = (db.raw.prepare("SELECT id FROM pantry_items").get() as { id: string }).id;
    const log = (delta: number, reason: string): void => {
      db.raw
        .prepare(
          "INSERT INTO pantry_log (id, item_id, changed_at, delta, reason) VALUES (?, ?, ?, ?, ?)",
        )
        .run(uuidv7(), itemId, NOW, delta, reason);
    };

    expect(() => log(-1, "bought")).toThrow(/CHECK/);
    expect(() => log(1, "used")).toThrow(/CHECK/);
    expect(() => log(0, "correction")).toThrow(/CHECK/);
    expect(() => log(-1, "thrown")).toThrow(/CHECK/);
    expect(() => log(-1, "correction")).not.toThrow();
  });
});

/** The next day after a bare `YYYY-MM-DD`, for the one test that needs a day it cannot have. */
function shift(day: string, days: number): string {
  const ms = Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
  );
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}
