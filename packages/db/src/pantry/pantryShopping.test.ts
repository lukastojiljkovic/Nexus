import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_PANTRY_EXPIRY_WINDOW_DAYS,
  NexusDatabase,
  PantryNotFoundError,
  PantryStore,
  PantryValidationError,
  openDatabase,
  uuidv7,
} from "../index.js";

/**
 * The PANTRY store's stage-2 half (migration 075's two added tables): the
 * hand-written shopping list and the module's one preference.
 *
 * **Why these live in a file of their own.** `pantryStore.test.ts` pins the
 * pantry proper -- locations, items, the log, the archive round trip -- which is
 * stage 1's subject and stays exactly as it was. These two tables are stage 2's
 * and were added to the same (unreleased) migration rather than to a second one,
 * so the tests that cover them belong beside the code that writes them and not
 * inside a file neither stage owns.
 *
 * Every expected number below is a hand calculation: quantities are REAL
 * columns, so `2 + 1.5` is 3.5 and not a string, and the log's own row is read
 * back rather than assumed.
 */

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:00:00.000Z";

let dir: string;
let db: NexusDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-pantry-shopping-"));
  db = openDatabase({ path: join(dir, "pantry.db") });
});

afterEach(() => {
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

describe("PantryStore's hand-written shopping list", () => {
  it("trims the name and keeps the quantity the user typed", () => {
    const pantry = store();
    const line = pantry.addShoppingLine(
      { name: "  Mleko  ", quantity: 1.5, unit: "l" },
      NOW,
    );

    expect(line).toMatchObject({
      name: "Mleko",
      quantity: 1.5,
      unit: "l",
      itemId: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(pantry.listShoppingLines()).toEqual([line]);
  });

  it("refuses a blank or over-long name, and a quantity that is not a positive bounded number", () => {
    const pantry = store();

    for (const name of ["", "   ", "M".repeat(81)]) {
      expect(() => pantry.addShoppingLine({ name, quantity: 1, unit: "pcs" }, NOW)).toThrow(
        /"name"/,
      );
    }
    // Zero is the derived list's own floor turned around: a line asking for
    // nothing is not a line. Negative and NaN are refused with it, and a
    // million-and-one is past the ceiling migration 075's CHECK states.
    for (const quantity of [0, -1, Number.NaN, 1_000_001]) {
      expect(() =>
        pantry.addShoppingLine({ name: "Mleko", quantity, unit: "l" }, NOW),
      ).toThrow(/"quantity"/);
    }
    expect(() =>
      pantry.addShoppingLine(
        { name: "Mleko", quantity: 1, unit: "kila" as unknown as "kg" },
        NOW,
      ),
    ).toThrow(/"unit"/);
  });

  it("refuses an item link that is not this profile's live item", () => {
    const mine = store();
    const theirs = store();
    const foreign = theirs.createItem({ name: "Mleko", category: "food", quantity: 1, unit: "l" }, NOW);
    const stale = theirs.createItem({ name: "Hleb", category: "food", quantity: 1, unit: "pack" }, NOW);
    theirs.softDeleteItem(stale.id, NOW);

    expect(() =>
      mine.addShoppingLine({ name: "Mleko", quantity: 1, unit: "l", itemId: foreign.id }, NOW),
    ).toThrow(PantryNotFoundError);
    expect(() =>
      mine.addShoppingLine({ name: "Hleb", quantity: 1, unit: "pack", itemId: stale.id }, NOW),
    ).toThrow(PantryNotFoundError);
    // And a link that is not an id at all is refused before the row is written.
    expect(() =>
      mine.addShoppingLine({ name: "Mleko", quantity: 1, unit: "l", itemId: "  x  " }, NOW),
    ).toThrow(/"itemId"/);
  });

  it("sorts the lines sr-Latn alphabetically, and shows one profile nothing of another's", () => {
    const pantry = store();
    for (const name of ["Voda", "Šećer", "Čaj"]) {
      pantry.addShoppingLine({ name, quantity: 1, unit: "pcs" }, NOW);
    }

    expect(pantry.listShoppingLines().map((line) => line.name)).toEqual([
      "Čaj",
      "Šećer",
      "Voda",
    ]);
    expect(store().listShoppingLines()).toEqual([]);
  });

  it("ticks a line off by writing its quantity back into the item, and logs it as a purchase", () => {
    const pantry = store();
    const milk = pantry.createItem(
      { name: "Mleko", category: "food", quantity: 0, unit: "l", minQuantity: 2 },
      NOW,
    );
    const line = pantry.addShoppingLine(
      { name: "Mleko", quantity: 2, unit: "l", itemId: milk.id },
      NOW,
    );

    pantry.tickShoppingLine(line.id, LATER);

    expect(pantry.listShoppingLines()).toEqual([]);
    // 0 + 2 = 2, which is exactly the minimum, so the item leaves the derived
    // list too -- the round trip the brief asks for, in one write.
    expect(pantry.listItems()[0]?.quantity).toBe(2);
    expect(pantry.listLog()).toMatchObject([
      { itemId: milk.id, delta: 2, reason: "bought", changedAt: LATER },
    ]);
  });

  it("ticks a line with no link off without touching any item", () => {
    const pantry = store();
    const milk = pantry.createItem({ name: "Mleko", category: "food", quantity: 1, unit: "l" }, NOW);
    const line = pantry.addShoppingLine({ name: "Baterije", quantity: 4, unit: "pcs" }, NOW);

    pantry.tickShoppingLine(line.id, LATER);

    expect(pantry.listShoppingLines()).toEqual([]);
    expect(pantry.listItems()[0]).toMatchObject({ id: milk.id, quantity: 1, updatedAt: NOW });
    expect(pantry.listLog()).toEqual([]);
  });

  it("still ticks a line whose item was deleted underneath it, and restocks nothing", () => {
    const pantry = store();
    const milk = pantry.createItem({ name: "Mleko", category: "food", quantity: 0, unit: "l" }, NOW);
    const line = pantry.addShoppingLine(
      { name: "Mleko", quantity: 2, unit: "l", itemId: milk.id },
      NOW,
    );
    pantry.softDeleteItem(milk.id, NOW);

    pantry.tickShoppingLine(line.id, LATER);

    expect(pantry.listShoppingLines()).toEqual([]);
    expect(pantry.listItems()).toEqual([]);
    expect(pantry.listLog()).toEqual([]);
  });

  it("refuses a tick or a removal of a line this profile does not have", () => {
    const pantry = store();
    expect(() => pantry.tickShoppingLine("nema", NOW)).toThrow(PantryNotFoundError);
    expect(() => pantry.removeShoppingLine("nema")).toThrow(PantryNotFoundError);
  });

  it("replaces every line from an archive, minting ids, and does it idempotently", () => {
    const pantry = store();
    pantry.addShoppingLine({ name: "Staro", quantity: 1, unit: "pcs" }, NOW);

    const carried = [
      { name: "Mleko", quantity: 2, unit: "l" as const, itemId: null },
      { name: "Hleb", quantity: 1, unit: "pack" as const, itemId: null },
    ];
    pantry.replaceShoppingFromArchive(carried, LATER);

    const first = pantry.listShoppingLines();
    expect(first.map((line) => line.name)).toEqual(["Hleb", "Mleko"]);
    expect(first.every((line) => line.createdAt === LATER)).toBe(true);
    expect(first.some((line) => line.name === "Staro")).toBe(false);

    // The same value twice: the ids move (they are this database's own keys),
    // and everything the user can see stays put.
    pantry.replaceShoppingFromArchive(carried, LATER);
    expect(pantry.listShoppingLines().map((line) => line.name)).toEqual(["Hleb", "Mleko"]);
    expect(pantry.listShoppingLines()[0]?.id).not.toBe(first[0]?.id);
  });
});

describe("PantryStore's expiry window", () => {
  it("answers the shipped default until a row is written", () => {
    const pantry = store();
    expect(DEFAULT_PANTRY_EXPIRY_WINDOW_DAYS).toBe(7);
    expect(pantry.settings()).toEqual({ expiryWindowDays: 7 });
  });

  it("stores a window and a null deletes it, so the default answers again", () => {
    const pantry = store();

    expect(pantry.setExpiryWindow(14, NOW)).toEqual({ expiryWindowDays: 14 });
    expect(pantry.settings()).toEqual({ expiryWindowDays: 14 });
    expect(pantry.setExpiryWindow(14, LATER)).toEqual({ expiryWindowDays: 14 });

    expect(pantry.setExpiryWindow(null, LATER)).toEqual({ expiryWindowDays: 7 });
    // Two profiles never share a window.
    expect(store().settings()).toEqual({ expiryWindowDays: 7 });
  });

  it("refuses a window that is not a whole number of days in 1..3650", () => {
    const pantry = store();
    for (const days of [0, -1, 1.5, 3_651, Number.NaN]) {
      expect(() => pantry.setExpiryWindow(days, NOW)).toThrow(PantryValidationError);
    }
    expect(pantry.settings()).toEqual({ expiryWindowDays: 7 });
  });
});
