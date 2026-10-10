import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shiftDayKey, type DayKey } from "@nexus/core";
import { openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import { ModuleHost, type ModulePlatform } from "../../../main/moduleIpc.js";
import { register } from "./register.js";

/**
 * The PANTRY module through the kit (ADR-090): its ops, the expiry ladder it
 * computes, the derived shopping list, the tick that puts quantity back into
 * stock, its reminder, and its archive section.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals, the sender check and the channel allowlist are all the host's. Going
 * through `dispatch` therefore tests what actually runs in the app — a typo in an
 * op name or a payload the validators refuse is a rejected promise here, not a
 * surprise on the first click.
 *
 * The clock is the harness's, so "three days after the expiry" is a number this
 * test moves rather than three days it waits for, and the scheduler is a list of
 * armed timers it drives by hand. Everything else is real: a real encrypted
 * database, the real migrations, the real store, and `@nexus/core`'s own expiry
 * ladder and shopping list.
 *
 * The day every verdict is computed against is LOCAL (main stamps the clock the
 * way the renderer's `localTodayKey` does), so the tests never restate it: they
 * read `view.today` and shift from there. That keeps them true on a machine in
 * any timezone, which a hard-coded "today" would not be.
 */

const TRUSTED = { trusted: true };

let dir: string;
let db: NexusDatabase;
/** A second device an archive travels to, opened by the tests that need one. */
let extra: { db: NexusDatabase; dir: string } | null;
/** 08:00 on a Monday: before `REMINDER_HOUR`, so an unlock reminds today. */
let clock = Date.parse("2026-06-01T08:00:00.000Z");

interface Harness {
  readonly host: ModuleHost;
  readonly toasts: { title: string; body: string; silent: boolean }[];
  readonly timers: { atMs: number; run: () => void; cancelled: boolean }[];
  /** Moves the clock forward by `hours` and runs every armed timer whose instant has passed — the one thing a wall clock would do. */
  advance(hours: number): void;
}

function harness(): Harness {
  const toasts: Harness["toasts"] = [];
  const timers: Harness["timers"] = [];
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => db.raw,
    notify: (copy) => toasts.push(copy),
    schedule: (atMs, run) => {
      const entry = { atMs, run, cancelled: false };
      timers.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    now: () => clock,
  };
  const host = new ModuleHost(platform);
  register(host);

  function drain(): void {
    for (let step = 0; step < 1_000; step += 1) {
      const due = timers.find((timer) => !timer.cancelled && timer.atMs <= clock);
      if (due === undefined) return;
      due.cancelled = true;
      due.run();
    }
  }

  return {
    host,
    toasts,
    timers,
    advance(hours) {
      clock += hours * 3_600_000;
      drain();
    },
  };
}

function createProfile(): string {
  const id = uuidv7();
  db.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date(clock).toISOString());
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

/** One item as the view carries it, narrowed to what a test reads. */
interface ItemView {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  locationId: string | null;
  archivedAt: string | null;
  needed: number | null;
  status: {
    expiry: string;
    daysUntilExpiry: number | null;
    effectiveExpiry: { date: string; source: string } | null;
    low: boolean;
  };
}

interface View {
  today: string;
  locations: { id: string; name: string }[];
  items: ItemView[];
  autoShopping: {
    locationId: string | null;
    locationName: string | null;
    lines: { itemId: string; name: string; needed: number }[];
  }[];
  shopping: { id: string; name: string; quantity: number; unit: string; itemId: string | null }[];
  settings: { expiryWindowDays: number };
}

/** The fields every create call carries; a test overrides what it is about. */
function itemFields(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Mleko",
    category: "food",
    quantity: 1,
    unit: "l",
    locationId: null,
    minQuantity: null,
    expiryDate: null,
    openedDate: null,
    useWithinDays: null,
    notes: null,
    barcode: null,
    doseNote: null,
    ...overrides,
  };
}

beforeEach(() => {
  extra = null;
  dir = mkdtempSync(join(tmpdir(), "nexus-pantry-module-"));
  db = openDatabase({ path: join(dir, "pantry.db") });
  clock = Date.parse("2026-06-01T08:00:00.000Z");
});

afterEach(() => {
  if (extra !== null) {
    extra.db.close();
    rmSync(extra.dir, { recursive: true, force: true });
  }
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the pantry handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = harness();
    expect(host.channels()).toEqual([
      "pantry:list",
      "pantry:createItem",
      "pantry:updateItem",
      "pantry:changeQuantity",
      "pantry:archiveItem",
      "pantry:unarchiveItem",
      "pantry:removeItem",
      "pantry:createLocation",
      "pantry:renameLocation",
      "pantry:moveLocation",
      "pantry:removeLocation",
      "pantry:addShoppingLine",
      "pantry:tickShoppingLine",
      "pantry:removeShoppingLine",
      "pantry:setExpiryWindow",
    ]);
  });

  it("refuses a payload the wire should never carry, before the store sees it", async () => {
    const { host } = harness();
    const profileId = createProfile();

    for (const fields of [
      { name: "", category: "food", quantity: 1, unit: "l" },
      { name: "Mleko", category: "hrana", quantity: 1, unit: "l" },
      { name: "Mleko", category: "food", quantity: -1, unit: "l" },
      { name: "Mleko", category: "food", quantity: 1, unit: "kila" },
      { name: "Mleko", category: "food", quantity: 1, unit: "l", expiryDate: "2026-02-30" },
      { name: "Mleko", category: "food", quantity: 1, unit: "l", barcode: "123" },
      { name: "Mleko", category: "food", quantity: 1, unit: "l", useWithinDays: 0 },
      { name: "Mleko", category: "food", quantity: 1, unit: "l", locationId: "  x  " },
      { name: "Mleko", category: "food", quantity: 1, unit: "l", minQuantity: 0 },
    ]) {
      await expect(
        call(host, "pantry:createItem", { profileId, ...itemFields(fields) }),
        JSON.stringify(fields),
      ).rejects.toThrow(/Invalid IPC payload/);
    }

    // A quantity move carries its own rules: a zero delta changes nothing, and a
    // reason the vocabulary does not have is refused by name.
    await expect(
      call(host, "pantry:changeQuantity", { profileId, id: "x", delta: 0, reason: "used" }),
    ).rejects.toThrow(/non-zero/);
    await expect(
      call(host, "pantry:changeQuantity", { profileId, id: "x", delta: -1, reason: "pojedeno" }),
    ).rejects.toThrow(/reason/);
    // And a window outside the store's own CHECK is refused at the wire.
    await expect(call(host, "pantry:setExpiryWindow", { profileId, days: 0 })).rejects.toThrow(
      /between 1 and 3650/,
    );
  });

  it("answers a read with the rows, the derived lists and the day they were judged against", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const shelf = await call<View>(host, "pantry:createLocation", { profileId, name: "Frižider" });
    const shelfId = shelf.locations[0]?.id ?? "";

    const view = await call<View>(host, "pantry:createItem", {
      profileId,
      ...itemFields({ name: "Mleko", locationId: shelfId, quantity: 0, minQuantity: 2 }),
    });

    // The item as a person reads it: nothing on the shelf, two litres short.
    expect(view.items[0]).toMatchObject({
      name: "Mleko",
      quantity: 0,
      minQuantity: 2,
      needed: 2,
      locationId: shelfId,
      status: { expiry: "none", daysUntilExpiry: null, low: true },
    });
    // ...and the shopping list said the same thing, grouped by the shelf it is
    // filed under, with the quantity that reaches the minimum.
    expect(view.autoShopping).toMatchObject([
      {
        locationId: shelfId,
        locationName: "Frižider",
        lines: [{ itemId: view.items[0]?.id, name: "Mleko", needed: 2 }],
      },
    ]);
    // The clock is main's, and the day it stamped is the machine's own.
    expect(view.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(view.settings).toEqual({ expiryWindowDays: 7 });
  });

  it("draws the expiry ladder at its boundary days, each one day apart", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const first = await call<View>(host, "pantry:createItem", {
      profileId,
      ...itemFields({ name: "A", expiryDate: "2026-06-30" }),
    });
    // The window is seven days by default, so the ladder is: the day after the
    // expiry is `expired`, the expiry day and the six after it are `soon`, and
    // the seventh day past it is `ok`.
    const today = first.today;
    const at = (offset: number): string => shiftDayKey(today as DayKey, offset);

    const view = await call<View>(host, "pantry:createItem", {
      profileId,
      ...itemFields({ name: "B", expiryDate: at(0) }),
    });
    const created = view.items.find((item) => item.name === "B");
    expect(created?.status).toMatchObject({ expiry: "soon", daysUntilExpiry: 0 });

    for (const [offset, expiry] of [
      [1, "soon"],
      [7, "soon"],
      [8, "ok"],
      [-1, "expired"],
    ] as const) {
      const edited = await call<View>(host, "pantry:updateItem", {
        profileId,
        id: created?.id ?? "",
        name: "B",
        category: "food",
        unit: "l",
        locationId: null,
        minQuantity: null,
        expiryDate: at(offset),
        openedDate: null,
        useWithinDays: null,
        notes: null,
        barcode: null,
        doseNote: null,
      });
      const item = edited.items.find((one) => one.id === created?.id);
      expect({ offset, expiry: item?.status.expiry, days: item?.status.daysUntilExpiry }).toEqual({
        offset,
        expiry,
        days: offset,
      });
    }
  });

  it("lets the OPENED rule decide, and says so, rather than trusting the packet's own date", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const seeded = await call<View>(host, "pantry:createItem", {
      profileId,
      ...itemFields({ name: "Jogurt", expiryDate: "2030-01-01" }),
    });
    const id = seeded.items[0]?.id ?? "";
    const today = seeded.today;

    const view = await call<View>(host, "pantry:updateItem", {
      profileId,
      id,
      name: "Jogurt",
      category: "food",
      unit: "l",
      locationId: null,
      minQuantity: null,
      expiryDate: "2030-01-01",
      openedDate: today,
      useWithinDays: 3,
      notes: null,
      barcode: null,
      doseNote: null,
    });

    // Three days from opening beats a date five years away, and the source says
    // which rule answered so a screen can explain the date it prints.
    expect(view.items[0]?.status).toMatchObject({
      expiry: "soon",
      daysUntilExpiry: 3,
      effectiveExpiry: { date: shiftDayKey(today as DayKey, 3), source: "opened" },
    });
  });

  it("takes an item below its minimum onto the shopping list, and ticking it puts the quantity back", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const created = await call<View>(host, "pantry:createItem", {
      profileId,
      ...itemFields({ name: "Mleko", quantity: 0, minQuantity: 2 }),
    });
    const id = created.items[0]?.id ?? "";
    expect(created.autoShopping[0]?.lines).toHaveLength(1);

    // The round trip: buying the missing two litres IS the tick.
    const bought = await call<View>(host, "pantry:changeQuantity", {
      profileId,
      id,
      delta: 2,
      reason: "bought",
    });

    expect(bought.items[0]).toMatchObject({ quantity: 2, needed: null, status: { low: false } });
    expect(bought.autoShopping).toEqual([]);
  });

  it("restocks the item a hand-written line names, and simply removes a line that names none", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const seeded = await call<View>(host, "pantry:createItem", {
      profileId,
      ...itemFields({ name: "Mleko", quantity: 0, minQuantity: 2 }),
    });
    const itemId = seeded.items[0]?.id ?? "";

    const linked = await call<View>(host, "pantry:addShoppingLine", {
      profileId,
      name: "Mleko",
      quantity: 2,
      unit: "l",
      itemId,
    });
    const linkedLine = linked.shopping[0];
    expect(linkedLine).toMatchObject({ name: "Mleko", quantity: 2, unit: "l", itemId });

    const ticked = await call<View>(host, "pantry:tickShoppingLine", {
      profileId,
      id: linkedLine?.id ?? "",
    });
    expect(ticked.shopping).toEqual([]);
    expect(ticked.items[0]?.quantity).toBe(2);

    const loose = await call<View>(host, "pantry:addShoppingLine", {
      profileId,
      name: "Baterije",
      quantity: 4,
      unit: "pcs",
      itemId: null,
    });
    const removed = await call<View>(host, "pantry:removeShoppingLine", {
      profileId,
      id: loose.shopping[0]?.id ?? "",
    });
    expect(removed.shopping).toEqual([]);
    expect(removed.items[0]?.quantity).toBe(2);
  });

  it("refuses a shopping line linked to an item this profile does not have", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await expect(
      call(host, "pantry:addShoppingLine", {
        profileId,
        name: "Mleko",
        quantity: 1,
        unit: "l",
        itemId: "nema",
      }),
    ).rejects.toThrow();
  });

  it("moves a shelf between the neighbours a step lands between", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await call(host, "pantry:createLocation", { profileId, name: "A" });
    await call(host, "pantry:createLocation", { profileId, name: "B" });
    const seeded = await call<View>(host, "pantry:createLocation", { profileId, name: "C" });
    const [a, b, c] = seeded.locations.map((location) => location.id);

    // C in front of A: the same call the page's "move up" makes from the end.
    const moved = await call<View>(host, "pantry:moveLocation", {
      profileId,
      id: c,
      beforeId: null,
      afterId: a,
    });
    expect(moved.locations.map((location) => location.name)).toEqual(["C", "A", "B"]);

    // ...and one step down from the front puts it back between A and B.
    const back = await call<View>(host, "pantry:moveLocation", {
      profileId,
      id: c,
      beforeId: a,
      afterId: b,
    });
    expect(back.locations.map((location) => location.name)).toEqual(["A", "C", "B"]);
  });

  it("refuses to remove a shelf that still holds items", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const seeded = await call<View>(host, "pantry:createLocation", {
      profileId,
      name: "Ostava",
    });
    const shelfId = seeded.locations[0]?.id ?? "";
    await call(host, "pantry:createItem", {
      profileId,
      ...itemFields({ name: "Brašno", locationId: shelfId }),
    });

    await expect(
      call(host, "pantry:removeLocation", { profileId, id: shelfId }),
    ).rejects.toThrow(/still holds/);
    const after = await call<View>(host, "pantry:list", { profileId });
    expect(after.locations).toHaveLength(1);
  });
});

describe("the pantry reminder", () => {
  it("says nothing when nothing is expiring, and one thing when something is", async () => {
    const kit = harness();
    const quiet = createProfile();
    await call(kit.host, "pantry:createItem", {
      profileId: quiet,
      ...itemFields({ name: "Brašno", expiryDate: "2030-01-01" }),
    });
    kit.host.sessionStart([quiet]);
    expect(kit.toasts).toEqual([]);

    const due = createProfile();
    const seeded = await call<View>(kit.host, "pantry:createItem", {
      profileId: due,
      ...itemFields({ name: "Jogurt", expiryDate: "2030-01-01" }),
    });
    await call(kit.host, "pantry:updateItem", {
      profileId: due,
      id: seeded.items[0]?.id ?? "",
      name: "Jogurt",
      category: "food",
      unit: "l",
      locationId: null,
      minQuantity: null,
      expiryDate: shiftDayKey(seeded.today as DayKey, -1),
      openedDate: null,
      useWithinDays: null,
      notes: null,
      barcode: null,
      doseNote: null,
    });

    kit.host.sessionStart([due]);
    expect(kit.toasts).toEqual([
      { title: "Ostava — ističe uskoro", body: "Isteklo: 1. Ističe uskoro: 0.", silent: true },
    ]);

    // A lock and an unlock an hour later is the same day: one reminder a day is
    // the promise, so the second session says nothing.
    kit.host.sessionEnd();
    kit.advance(1);
    kit.host.sessionStart([due]);
    expect(kit.toasts).toHaveLength(1);

    // The next day, the armed timer is what speaks — with no page open at all.
    kit.advance(24);
    expect(kit.toasts).toHaveLength(2);
  });

  it("stops reminding about an item once the user has finished with it", async () => {
    const kit = harness();
    const profileId = createProfile();
    const seeded = await call<View>(kit.host, "pantry:createItem", {
      profileId,
      ...itemFields({ name: "Jogurt" }),
    });
    const id = seeded.items[0]?.id ?? "";
    // Tomorrow's date puts it inside the window, so the first unlock says so.
    await call(kit.host, "pantry:updateItem", {
      profileId,
      id,
      name: "Jogurt",
      category: "food",
      unit: "l",
      locationId: null,
      minQuantity: null,
      expiryDate: shiftDayKey(seeded.today as DayKey, 1),
      openedDate: null,
      useWithinDays: null,
      notes: null,
      barcode: null,
      doseNote: null,
    });
    kit.host.sessionStart([profileId]);
    expect(kit.toasts).toHaveLength(1);

    // Nothing is left to say once the row is archived — the page's own expiring
    // list drops it too (`urgentItems`), and the two must agree, or a toast would
    // name an item the card does not show.
    await call(kit.host, "pantry:archiveItem", { profileId, id });
    kit.advance(24);
    expect(kit.toasts).toHaveLength(1);
  });
});

describe("the pantry archive section", () => {
  it("round-trips the shelves, the items, the log, the shopping list and the window", async () => {
    const kit = harness();
    const source = createProfile();
    const shelf = await call<View>(kit.host, "pantry:createLocation", {
      profileId: source,
      name: "Frižider",
    });
    const seeded = await call<View>(kit.host, "pantry:createItem", {
      profileId: source,
      ...itemFields({
        name: "Mleko",
        locationId: shelf.locations[0]?.id ?? null,
        quantity: 0,
        minQuantity: 2,
        expiryDate: "2026-06-30",
      }),
    });
    const itemId = seeded.items[0]?.id ?? "";
    await call(kit.host, "pantry:changeQuantity", {
      profileId: source,
      id: itemId,
      delta: 1.5,
      reason: "bought",
    });
    await call(kit.host, "pantry:addShoppingLine", {
      profileId: source,
      name: "Mleko",
      quantity: 2,
      unit: "l",
      itemId,
    });
    await call(kit.host, "pantry:setExpiryWindow", { profileId: source, days: 14 });

    const [section] = kit.host.collectExports([source]);
    expect(section?.moduleId).toBe("pantry");

    // A SECOND device: a row id is unique across the whole database rather than
    // per profile (the store says why), so an archive restores into another
    // database, never into a second profile of the one it was read from.
    const otherDir = mkdtempSync(join(tmpdir(), "nexus-pantry-other-"));
    extra = { db: openDatabase({ path: join(otherDir, "other.db") }), dir: otherDir };
    const here = db;
    db = extra.db;
    const target = createProfile();
    kit.host.applyImports([section!], [target]);
    const restored = await call<View>(kit.host, "pantry:list", { profileId: target });
    db = here;

    // The store writes the archive's own ids back, because the rest of the
    // archive references them — a shopping line's link among them.
    expect(restored.locations.map((location) => location.id)).toEqual([
      shelf.locations[0]?.id,
    ]);
    expect(restored.items[0]).toMatchObject({ id: itemId, name: "Mleko", quantity: 1.5 });
    expect(restored.items[0]?.status.daysUntilExpiry).toBe(
      daysBetween(restored.today, "2026-06-30"),
    );
    expect(restored.shopping).toMatchObject([{ name: "Mleko", quantity: 2, itemId }]);
    expect(restored.settings).toEqual({ expiryWindowDays: 14 });
  });

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {
    const kit = harness();
    const profileId = createProfile();
    const seeded = await call<View>(kit.host, "pantry:createItem", {
      profileId,
      ...itemFields({ name: "Mleko" }),
    });
    const itemId = seeded.items[0]?.id ?? "";
    const [section] = kit.host.collectExports([profileId]);
    const payload = section?.payload as { data: { items: unknown[] }; shopping: unknown[] };

    const wrongVersion = { ...(payload as object), version: 99 };
    const noArray = { ...(payload as object), shopping: null };
    const emptyName = { ...payload, shopping: [{ name: "", quantity: 1, unit: "l", itemId: null }] };
    const danglingLink = {
      ...payload,
      shopping: [{ name: "Mleko", quantity: 1, unit: "l", itemId: "nema" }],
    };
    const badItem = {
      ...payload,
      data: { ...payload.data, items: [{ ...(payload.data.items[0] as object), barcode: "123" }] },
    };

    for (const bad of [wrongVersion, noArray, emptyName, danglingLink, badItem]) {
      expect(() => kit.host.applyImports([{ moduleId: "pantry", payload: bad }], [profileId])).toThrow();
      const after = await call<View>(kit.host, "pantry:list", { profileId });
      expect(after.items.map((item) => item.id)).toEqual([itemId]);
    }
  });

  it("empties the pantry when the section names no Pantry entry", async () => {
    const kit = harness();
    const profileId = createProfile();
    await call(kit.host, "pantry:createItem", { profileId, ...itemFields({ name: "Mleko" }) });
    await call(kit.host, "pantry:addShoppingLine", {
      profileId,
      name: "Baterije",
      quantity: 4,
      unit: "pcs",
      itemId: null,
    });
    await call(kit.host, "pantry:setExpiryWindow", { profileId, days: 30 });

    // An archive with no Pantry entry is what a restore of a build before this
    // module hands over, and a restore replaces the profile whole.
    kit.host.applyImports([], [profileId]);

    const after = await call<View>(kit.host, "pantry:list", { profileId });
    expect(after.items).toEqual([]);
    expect(after.shopping).toEqual([]);
    expect(after.autoShopping).toEqual([]);
    expect(after.settings).toEqual({ expiryWindowDays: 7 });
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const kit = harness();
    expect(kit.host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});

/** Whole days from one bare day key to another — the same UTC arithmetic `@nexus/core` uses, written out here so the expectation is not the code under test. */
function daysBetween(from: string, to: string): number {
  const at = (key: string): number =>
    Date.UTC(
      Number(key.slice(0, 4)),
      Number(key.slice(5, 7)) - 1,
      Number(key.slice(8, 10)),
    );
  return Math.round((at(to) - at(from)) / 86_400_000);
}
