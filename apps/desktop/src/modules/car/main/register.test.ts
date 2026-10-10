import { afterAll, beforeEach, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, uuidv7, type NexusDatabase } from "@nexus/db";
import type { ModuleAttachmentFile, ModulePlatform } from "../../../main/moduleIpc.js";
import { ModuleHost } from "../../../main/moduleIpc.js";
import { contract, type CarDetailView, type CarView } from "../shared/ipc.js";
import { register } from "./register.js";

/**
 * The CAR module through the kit (ADR-090): its ops, the figures main computes,
 * the reminder it arms, its attach path, and its archive section.
 *
 * **Why these tests drive the HOST rather than calling the module directly.**
 * `register(host)` is the only entry point the discovery glue knows, and the
 * refusals, the sender check and the channel allowlist are all the host's. Going
 * through `dispatch` therefore tests what actually runs in the app -- a typo in
 * an op name or a payload the validators refuse is a rejected promise here, not a
 * surprise on the first click.
 *
 * The clock, the scheduler and the attach dialog are the harness's, so "a due
 * date arrives", "a timer fires" and "the user picked a file" are numbers and
 * values this test moves rather than waits for. Everything else is real: a real
 * database, the real migrations, the real store and the real engines.
 */

const TRUSTED = { trusted: true };

let db: NexusDatabase;
let clock = Date.parse("2026-06-01T09:00:00.000Z");

interface Harness {
  readonly host: ModuleHost;
  readonly toasts: { title: string; body: string; silent: boolean }[];
  readonly timers: { atMs: number; run: () => void; cancelled: boolean }[];
  /** The files the next attach dialog answers with; empty means the user cancelled. */
  readonly files: ModuleAttachmentFile[];
  /** Every hash a module gave back, in order. */
  readonly released: string[];
  advance(seconds: number): void;
  at(iso: string): void;
}

/**
 * The kit's host over one database.
 *
 * The database is a PARAMETER because the archive section's round trip needs a
 * second one: a car archive reproduces its ids byte for byte (every child row
 * references them), so it lands where those ids are not already taken -- another
 * account, or a profile whose rows are gone. Two profiles of ONE database would
 * collide on `vehicles.id`, exactly as the compiled-in restore does for notes and
 * tasks.
 */
function harnessFor(database: NexusDatabase): Harness {
  const toasts: Harness["toasts"] = [];
  const timers: Harness["timers"] = [];
  const files: ModuleAttachmentFile[] = [];
  const released: string[] = [];
  const platform: ModulePlatform = {
    assertTrustedSender: (event) => {
      if (event !== TRUSTED) throw new Error("Nexus: that message did not come from this app.");
    },
    database: () => database.raw,
    // The real path stores the bytes first and deletes them again if the row
    // fails (`moduleAttachments.ts`); the double has no blob store, so it hands
    // the module one file per open dialog and lets `record` do the rest.
    attachFiles: async (_maxBytes, record) => {
      const file = files.shift();
      if (file === undefined) return { canceled: true };
      record(file);
      return { canceled: false, added: 1, skippedTooLarge: 0 };
    },
    releaseBlob: async (sha256) => {
      released.push(sha256);
    },
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
    files,
    released,
    advance(seconds) {
      clock += seconds * 1000;
      drain();
    },
    at(iso) {
      clock = Date.parse(iso);
    },
  };
}

function harness(): Harness {
  return harnessFor(db);
}

function createProfile(): string {
  return createProfileIn(db);
}

function createProfileIn(database: NexusDatabase): string {
  const id = uuidv7();
  database.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "personal", "P", new Date(clock).toISOString());
  return id;
}

async function call<T>(host: ModuleHost, channel: string, payload: unknown): Promise<T> {
  return (await host.dispatch(channel, TRUSTED, payload)) as T;
}

beforeEach(() => {
  clock = Date.parse("2026-06-01T09:00:00.000Z");
});

/**
 * ONE database for the whole file, migrated once.
 *
 * The migrations are the expensive part of opening a database and this file does
 * not need a fresh one per test: every test works inside its own profile, and
 * every statement the module issues is scoped by `profile_id`. Nineteen fresh
 * migrations would cost more than the whole suite is allowed to take.
 */
beforeAll(() => {
  db = openDatabase({ path: ":memory:" });
});

afterAll(() => {
  db.close();
});

/** Adds one vehicle through the real handler and answers its id. */
async function addVehicle(
  host: ModuleHost,
  profileId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const view = await call<CarView>(host, "car:createVehicle", {
    profileId,
    name: "Golf",
    make: "Volkswagen",
    model: "Golf 7",
    year: 2016,
    fuelType: "diesel",
    distanceUnit: "km",
    ...overrides,
  });
  const id = view.vehicles[0]?.id;
  if (id === undefined) throw new Error("the vehicle was not created");
  return id;
}

describe("the car handler surface", () => {
  it("registers exactly the ops its contract declares", () => {
    const { host } = harness();
    expect(host.channels()).toEqual(contract.ops.map((op) => `car:${op}`));
  });

  it("answers a read with the garage and the module's two thresholds", async () => {
    const { host } = harness();
    const profileId = createProfile();
    await addVehicle(host, profileId);

    const view = await call<CarView>(host, "car:list", { profileId });
    expect(view.vehicles.map((vehicle) => vehicle.name)).toEqual(["Golf"]);
    // A profile that never opened the settings card answers the store's own
    // defaults, read from the store rather than restated here.
    expect(view.settings).toEqual({ dueSoonDays: 30, dueSoonDistance: 500 });
  });

  it("refuses a payload the wire should never carry, before the store sees it", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const sample = {
      profileId,
      name: "Golf",
      make: "VW",
      model: "Golf",
      year: 2016,
      fuelType: "diesel",
      distanceUnit: "km",
    };

    await expect(
      call(host, "car:createVehicle", { ...sample, name: "" }),
    ).rejects.toThrow(/must be a non-empty string/);
    await expect(
      call(host, "car:createVehicle", { ...sample, year: "2016" }),
    ).rejects.toThrow(/must be an integer/);
    await expect(
      call(host, "car:createVehicle", { ...sample, year: 2600 }),
    ).rejects.toThrow(/"year" must be between/);
    await expect(
      call(host, "car:createVehicle", { ...sample, fuelType: "nuclear" }),
    ).rejects.toThrow(/not one of/);
    await expect(
      call(host, "car:createVehicle", { ...sample, vin: "NOTAVIN" }),
    ).rejects.toThrow(/"vin" must be 17 characters/);

    const vehicleId = await addVehicle(host, profileId);
    // An interval that names neither bound is a row that could say nothing.
    await expect(
      call(host, "car:setInterval", {
        profileId,
        vehicleId,
        category: "oil",
        everyKm: null,
        everyMonths: null,
      }),
    ).rejects.toThrow(/needs "everyKm", "everyMonths", or both/);
    // A price without its currency is a number nobody can read.
    await expect(
      call(host, "car:addService", {
        profileId,
        vehicleId,
        date: "2026-06-01",
        category: "oil",
        description: "Mali servis",
        costMinor: 450_000,
        currency: null,
      }),
    ).rejects.toThrow(/together/);
    // 2026-02-30 parses happily into March, which is exactly what a service
    // history must refuse.
    await expect(
      call(host, "car:addService", {
        profileId,
        vehicleId,
        date: "2026-02-30",
        category: "oil",
        description: "Mali servis",
      }),
    ).rejects.toThrow(/real calendar day/);
  });

  it("refuses the whole call when a vehicle is not in this profile", async () => {
    const { host } = harness();
    const mine = createProfile();
    const other = createProfile();
    const vehicleId = await addVehicle(host, mine);

    await expect(
      call(host, "car:addReading", {
        profileId: other,
        vehicleId,
        date: "2026-06-01",
        reading: 1_000,
      }),
    ).rejects.toThrow(/No live vehicle/);
  });
});

describe("fuel consumption, by the full-tank method", () => {
  it("sums the partial fills inside a stretch and never lets one close it", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const vehicleId = await addVehicle(host, profileId);

    // A hand-calculated log, in the vehicle's own unit (km):
    //
    //   #1  2026-01-01  40 L  10 000 km  full     opens the first stretch
    //   #2  2026-01-15  20 L  10 300 km  PARTIAL  counted, does not close
    //   #3  2026-02-01  30 L  10 700 km  full     closes: 20 + 30 = 50 L
    //   #4  2026-02-20  10 L  10 800 km  PARTIAL  counted, does not close
    //   #5  2026-03-01  25 L  11 000 km  full     closes: 10 + 25 = 35 L
    //
    //   stretch 1: 700 km on 50 L gives 50 / 700 * 100 = 7.142857142857143
    //   stretch 2: 300 km on 35 L gives 35 / 300 * 100 = 11.666666666666666
    //   overall:  1000 km on 85 L gives 85 / 1000 * 100 = 8.5, exactly
    const log: [string, number, number, boolean][] = [
      ["2026-01-01", 40, 10_000, true],
      ["2026-01-15", 20, 10_300, false],
      ["2026-02-01", 30, 10_700, true],
      ["2026-02-20", 10, 10_800, false],
      ["2026-03-01", 25, 11_000, true],
    ];
    for (const [date, quantity, odometer, fullTank] of log) {
      await call(host, "car:addFuel", {
        profileId,
        vehicleId,
        date,
        quantity,
        odometer,
        fullTank,
      });
    }

    const detail = await call<CarDetailView>(host, "car:detail", { profileId, vehicleId });
    expect(detail.consumption.segments).toHaveLength(2);
    expect(detail.consumption.segments[0]).toMatchObject({
      fromDate: "2026-01-01",
      toDate: "2026-02-01",
      distance: 700,
      quantity: 50,
      partialFills: 1,
    });
    expect(detail.consumption.segments[0]?.per100Km).toBeCloseTo(50 / 700 * 100, 12);
    expect(detail.consumption.segments[1]).toMatchObject({
      fromDate: "2026-02-01",
      toDate: "2026-03-01",
      distance: 300,
      quantity: 35,
      partialFills: 1,
    });
    expect(detail.consumption.segments[1]?.per100Km).toBeCloseTo(35 / 300 * 100, 12);
    // The first fill's own 40 L are deliberately excluded: it is what put the car
    // on the road with a known amount in it.
    expect(detail.consumption.overall).toEqual({
      distance: 1_000,
      quantity: 85,
      per100Km: 8.5,
      mpg: null,
    });
  });

  it("measures nothing when no stretch is bounded by two full tanks", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const vehicleId = await addVehicle(host, profileId);

    await call(host, "car:addFuel", {
      profileId,
      vehicleId,
      date: "2026-01-01",
      quantity: 40,
      odometer: 10_000,
      fullTank: true,
    });
    await call(host, "car:addFuel", {
      profileId,
      vehicleId,
      date: "2026-01-15",
      quantity: 20,
      odometer: 10_300,
      fullTank: false,
    });

    const detail = await call<CarDetailView>(host, "car:detail", { profileId, vehicleId });
    expect(detail.consumption).toEqual({ segments: [], overall: null });
  });

  it("reads miles per gallon for a vehicle whose odometer counts miles", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const vehicleId = await addVehicle(host, profileId, { distanceUnit: "mi" });

    // Two full tanks 300 mi apart on 30 US gallons: 300 / 30 = 10 mpg. One US
    // gallon is 3.785411784 L exactly, so 30 gal is 113.56235352 L.
    await call(host, "car:addFuel", {
      profileId,
      vehicleId,
      date: "2026-01-01",
      quantity: 113.56235352,
      odometer: 1_000,
      fullTank: true,
    });
    await call(host, "car:addFuel", {
      profileId,
      vehicleId,
      date: "2026-02-01",
      quantity: 113.56235352,
      odometer: 1_300,
      fullTank: true,
    });

    const detail = await call<CarDetailView>(host, "car:detail", { profileId, vehicleId });
    expect(detail.consumption.overall?.distance).toBe(300);
    expect(detail.consumption.overall?.mpg).toBeCloseTo(10, 9);
    expect(detail.consumption.overall?.per100Km).toBeCloseTo(
      (113.56235352 / (300 * 1.609344)) * 100,
      9,
    );
  });
});

describe("what is due, at both kinds of boundary", () => {
  it("judges the kilometre half against the estimated odometer, inclusive of the threshold", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const vehicleId = await addVehicle(host, profileId);

    // Oil every 10 000 km, last done at 10 000, so the next is due at 20 000.
    await call(host, "car:addService", {
      profileId,
      vehicleId,
      date: "2026-01-01",
      odometer: 10_000,
      category: "oil",
      description: "Mali servis",
    });
    await call(host, "car:setInterval", {
      profileId,
      vehicleId,
      category: "oil",
      everyKm: 10_000,
      everyMonths: null,
    });
    // Two readings 151 days apart put the estimate exactly on the later one when
    // today IS that day: the least-squares fit is exact through two points.
    await call(host, "car:addReading", {
      profileId,
      vehicleId,
      date: "2026-01-01",
      reading: 10_000,
    });
    const first = await call<CarDetailView>(host, "car:addReading", {
      profileId,
      vehicleId,
      date: "2026-06-01",
      reading: 19_500,
    });

    const read = async (): Promise<CarDetailView> =>
      call<CarDetailView>(host, "car:detail", { profileId, vehicleId });
    const oil = (view: CarDetailView) => view.due.find((item) => item.category === "oil");
    /** Moves the LATER reading, so the fit stays exact through two points -- a third point would tilt the line. */
    const moveLatestReading = async (reading: number): Promise<void> => {
      const latest = (await read()).readings.at(-1);
      await call(host, "car:removeReading", {
        profileId,
        vehicleId,
        id: latest?.id ?? first.readings.at(-1)?.id ?? "",
      });
      await call(host, "car:addReading", {
        profileId,
        vehicleId,
        date: "2026-06-01",
        reading,
      });
    };

    // 20 000 - 19 500 = 500, which the default threshold calls soon: "within 500"
    // includes 500 itself.
    expect(oil(await read())).toMatchObject({
      dueOdometer: 20_000,
      remainingDistance: 500,
      status: "soon",
      by: "distance",
      dueDate: null,
    });

    // Exactly due is still "soon" rather than overdue, and one kilometre past it
    // is overdue.
    await moveLatestReading(20_000);
    expect(oil(await read())).toMatchObject({
      remainingDistance: 0,
      status: "soon",
      by: "distance",
    });
    await moveLatestReading(20_001);
    expect(oil(await read())).toMatchObject({
      remainingDistance: -1,
      status: "overdue",
      by: "distance",
    });
  });

  it("judges the date half by whole days, inclusive of the threshold and of the due day", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const vehicleId = await addVehicle(host, profileId);

    // Registration every 12 months from 2025-06-30, so the next is 2026-06-30:
    // 29 whole days after today (2026-06-01).
    await call(host, "car:addService", {
      profileId,
      vehicleId,
      date: "2025-06-30",
      category: "registration",
      description: "Registracija",
    });
    await call(host, "car:setInterval", {
      profileId,
      vehicleId,
      category: "registration",
      everyKm: null,
      everyMonths: 12,
    });

    const read = async (): Promise<CarDetailView> =>
      call<CarDetailView>(host, "car:detail", { profileId, vehicleId });
    const registration = (view: CarDetailView) =>
      view.due.find((item) => item.category === "registration");

    expect(registration(await read())).toMatchObject({
      dueDate: "2026-06-30",
      remainingDays: 29,
      status: "soon",
      by: "date",
    });
    // The threshold is inclusive: 29 days away is soon in a 29-day window.
    await call(host, "car:setThresholds", { profileId, dueSoonDays: 29, dueSoonDistance: 500 });
    expect(registration(await read())).toMatchObject({ status: "soon", by: "date" });
    // One day tighter and the same deadline is fine again.
    await call(host, "car:setThresholds", { profileId, dueSoonDays: 28, dueSoonDistance: 500 });
    expect(registration(await read())).toMatchObject({ status: "ok", by: null });

    // A date that has passed is overdue by exactly its whole days. The archive's
    // own 30-day window is back in place for the second half of this test.
    await call(host, "car:setThresholds", { profileId, dueSoonDays: 30, dueSoonDistance: 500 });
    await call(host, "car:updateService", {
      profileId,
      vehicleId,
      id: (await read()).services[0]?.id ?? "",
      fields: { date: "2025-05-30", category: "registration", description: "Registracija" },
    });
    expect(registration(await read())).toMatchObject({
      dueDate: "2026-05-30",
      remainingDays: -2,
      status: "overdue",
      by: "date",
    });
  });

  it("says nothing about a distance half it cannot estimate, rather than inventing one", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const vehicleId = await addVehicle(host, profileId);

    await call(host, "car:addService", {
      profileId,
      vehicleId,
      date: "2026-01-01",
      odometer: 10_000,
      category: "brakes",
      description: "Pločice",
    });
    await call(host, "car:setInterval", {
      profileId,
      vehicleId,
      category: "brakes",
      everyKm: 50_000,
      everyMonths: null,
    });

    const detail = await call<CarDetailView>(host, "car:detail", { profileId, vehicleId });
    // One reading is not a line: the estimate is null, so the distance half has
    // nothing to be judged against -- and this interval has no calendar half
    // either, so the honest answer is "ok" with nothing remaining rather than a
    // number nobody measured.
    expect(detail.estimatedOdometer).toBeNull();
    expect(detail.due.find((item) => item.category === "brakes")).toMatchObject({
      dueOdometer: 60_000,
      remainingDistance: null,
      remainingDays: null,
      status: "ok",
      by: null,
    });
  });
});

describe("the garage and the book", () => {
  it("archives a car without touching its history, and skips it when asking what is next", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const vehicleId = await addVehicle(host, profileId);
    await call(host, "car:addService", {
      profileId,
      vehicleId,
      date: "2025-06-30",
      category: "registration",
      description: "Registracija",
    });
    await call(host, "car:setInterval", {
      profileId,
      vehicleId,
      category: "registration",
      everyKm: null,
      everyMonths: 12,
    });

    expect(await call(host, "car:nextDue", { profileId })).toMatchObject({
      vehicleId,
      item: { category: "registration", dueDate: "2026-06-30", status: "soon" },
    });

    const garage = await call<CarView>(host, "car:archiveVehicle", { profileId, id: vehicleId });
    expect(garage.vehicles[0]?.archivedAt).not.toBeNull();
    const detail = await call<CarDetailView>(host, "car:detail", { profileId, vehicleId });
    expect(detail.services).toHaveLength(1);
    // A sold car is not a car whose registration is about to lapse.
    expect(await call(host, "car:nextDue", { profileId })).toBeNull();
  });

  it("marks a fault fixed, keeping the service that fixed it", async () => {
    const { host } = harness();
    const profileId = createProfile();
    const vehicleId = await addVehicle(host, profileId);
    const withService = await call<CarDetailView>(host, "car:addService", {
      profileId,
      vehicleId,
      date: "2026-03-01",
      category: "brakes",
      description: "Zamena pločica",
    });
    const serviceId = withService.services[0]?.id ?? "";

    const opened = await call<CarDetailView>(host, "car:addFault", {
      profileId,
      vehicleId,
      date: "2026-02-20",
      symptom: "Škripi pri kočenju",
    });
    const fault = opened.faults[0];
    expect(fault).toMatchObject({ status: "open", serviceId: null });

    const fixed = await call<CarDetailView>(host, "car:updateFault", {
      profileId,
      vehicleId,
      id: fault?.id ?? "",
      fields: {
        date: "2026-02-20",
        symptom: "Škripi pri kočenju",
        status: "fixed",
        serviceId,
      },
    });
    expect(fixed.faults[0]).toMatchObject({ status: "fixed", serviceId });
  });
});

describe("receipts", () => {
  it("records what main stored, and gives the hash back when the row goes", async () => {
    const kit = harness();
    const profileId = createProfile();
    const vehicleId = await addVehicle(kit.host, profileId);
    const withService = await call<CarDetailView>(kit.host, "car:addService", {
      profileId,
      vehicleId,
      date: "2026-04-01",
      category: "oil",
      description: "Mali servis",
    });
    const serviceId = withService.services[0]?.id ?? "";

    kit.files.push({
      fileName: "racun.pdf",
      mime: "application/pdf",
      sizeBytes: 12_345,
      sha256: "a".repeat(64),
    });
    const answer = await call<{ result: unknown; detail: CarDetailView }>(
      kit.host,
      "car:attachReceipts",
      { profileId, vehicleId, serviceId },
    );
    expect(answer.result).toEqual({ canceled: false, added: 1, skippedTooLarge: 0 });
    // The bytes never cross the wire: a receipt is the four facts main derived,
    // and nothing else.
    expect(answer.detail.services[0]?.receipts).toEqual([
      expect.objectContaining({
        fileName: "racun.pdf",
        mime: "application/pdf",
        sizeBytes: 12_345,
        sha256: "a".repeat(64),
      }),
    ]);

    const receiptId = answer.detail.services[0]?.receipts?.[0]?.id ?? "";
    const after = await call<CarDetailView>(kit.host, "car:removeReceipt", {
      profileId,
      vehicleId,
      serviceId,
      id: receiptId,
    });
    expect(after.services[0]?.receipts).toEqual([]);
    // The row goes first, then the hash: the count the release consults is
    // main's, and it has to see this row gone.
    expect(kit.released).toEqual(["a".repeat(64)]);
  });

  it("refuses a service of another profile before the dialog opens", async () => {
    const kit = harness();
    const mine = createProfile();
    const other = createProfile();
    const vehicleId = await addVehicle(kit.host, mine);
    const withService = await call<CarDetailView>(kit.host, "car:addService", {
      profileId: mine,
      vehicleId,
      date: "2026-04-01",
      category: "oil",
      description: "Mali servis",
    });
    const serviceId = withService.services[0]?.id ?? "";
    kit.files.push({
      fileName: "racun.pdf",
      mime: "application/pdf",
      sizeBytes: 100,
      sha256: "b".repeat(64),
    });

    await expect(
      call(kit.host, "car:attachReceipts", { profileId: other, vehicleId, serviceId }),
      // The first gate the pre-check meets is the vehicle's own scope: a profile
      // that does not hold the car holds none of its services either.
    ).rejects.toThrow(/No live vehicle|No live service entry/);
    // The file is still there: a pick that could not be recorded must not cost
    // the user a file choice.
    expect(kit.files).toHaveLength(1);
  });
});

describe("the reminder main owns", () => {
  it("announces the day an interval comes due, at the profile's own morning hour, once", async () => {
    const kit = harness();
    const profileId = createProfile();
    const vehicleId = await addVehicle(kit.host, profileId);
    await call(kit.host, "car:addService", {
      profileId,
      vehicleId,
      date: "2026-05-02",
      category: "inspection",
      description: "Tehnički pregled",
    });
    // 2026-05-02 plus one month is 2026-06-02, so the deadline is tomorrow and
    // the reminder is armed for 08:00 local on that day -- the house's own
    // day-granular instant (`ntf_settings.morning_hour`, default 08:00).
    await call(kit.host, "car:setInterval", {
      profileId,
      vehicleId,
      category: "inspection",
      everyKm: null,
      everyMonths: 1,
    });

    expect(kit.timers.some((timer) => !timer.cancelled)).toBe(true);
    kit.at("2026-06-02T07:59:00");
    kit.advance(30);
    expect(kit.toasts).toEqual([]);

    // 08:00 local, the house's own day-granular instant.
    kit.advance(30);
    expect(kit.toasts).toEqual([
      { title: "Servis je dospeo", body: "Golf — Tehnički pregled", silent: false },
    ]);

    // A write re-arms from the same book: the same due date is NOT announced a
    // second time in one session.
    await call(kit.host, "car:addReading", {
      profileId,
      vehicleId,
      date: "2026-06-02",
      reading: 20_000,
    });
    kit.advance(3_600);
    expect(kit.toasts).toHaveLength(1);
  });
});

describe("the car archive section", () => {
  it("round-trips the garage, the history, the receipts and the thresholds", async () => {
    const kit = harness();
    const source = createProfile();
    const vehicleId = await addVehicle(kit.host, source, { plate: "BG-123-AB", fuelType: "petrol" });
    const withService = await call<CarDetailView>(kit.host, "car:addService", {
      profileId: source,
      vehicleId,
      date: "2026-04-01",
      odometer: 12_000,
      category: "oil",
      description: "Mali servis",
      costMinor: 890_000,
      currency: "RSD",
    });
    const serviceId = withService.services[0]?.id ?? "";
    kit.files.push({
      fileName: "racun.pdf",
      mime: "application/pdf",
      sizeBytes: 4_096,
      sha256: "c".repeat(64),
    });
    await call(kit.host, "car:attachReceipts", { profileId: source, vehicleId, serviceId });
    await call(kit.host, "car:setThresholds", {
      profileId: source,
      dueSoonDays: 45,
      dueSoonDistance: 800,
    });

    const [section] = kit.host.collectExports([source]);
    expect(section?.moduleId).toBe("car");

    // The archive is restored into ANOTHER DATABASE -- see `harnessFor` for why
    // that is the honest shape of the exchange rather than a convenience.
    const other = openDatabase({ path: ":memory:" });
    try {
      const targetKit = harnessFor(other);
      const target = createProfileIn(other);
      targetKit.host.applyImports([section!], [target]);
      await assertRoundTrip(targetKit.host, target, vehicleId);
    } finally {
      other.close();
    }
  });

  /** The whole restored book, asked through the host bound to the target database. */
  async function assertRoundTrip(
    targetHost: ModuleHost,
    target: string,
    vehicleId: string,
  ): Promise<void> {
    const restored = await call<CarView>(targetHost, "car:list", { profileId: target });
    expect(restored.settings).toEqual({ dueSoonDays: 45, dueSoonDistance: 800 });
    const restoredId = restored.vehicles[0]?.id ?? "";
    // Ids are reproduced byte for byte, because every child row references them.
    expect(restoredId).toBe(vehicleId);
    const book = await call<CarDetailView>(targetHost, "car:detail", {
      profileId: target,
      vehicleId: restoredId,
    });
    expect(book.services[0]).toMatchObject({
      description: "Mali servis",
      odometer: 12_000,
      costMinor: 890_000,
      currency: "RSD",
    });
    expect(book.services[0]?.receipts).toEqual([
      expect.objectContaining({
        fileName: "racun.pdf",
        sizeBytes: 4_096,
        sha256: "c".repeat(64),
      }),
    ]);
    // The derived figures come back too, because they are computed on every read.
    expect(book.costs.byCategory).toEqual([
      { category: "oil", currency: "RSD", minorUnits: 890_000, count: 1 },
    ]);
  }

  it("refuses a payload it does not understand, leaving the profile exactly as it found it", async () => {
    const kit = harness();
    const profileId = createProfile();
    await addVehicle(kit.host, profileId);
    const empty = {
      vehicles: [],
      readings: [],
      services: [],
      serviceAttachments: [],
      intervals: [],
      fuel: [],
      faults: [],
      settings: { dueSoonDays: 30, dueSoonDistance: 500 },
    };

    for (const payload of [
      { version: 99, ...empty },
      { version: 1, ...empty, vehicles: {} },
      { version: 1, ...empty, settings: { dueSoonDays: 0, dueSoonDistance: 500 } },
    ]) {
      expect(() => kit.host.applyImports([{ moduleId: "car", payload }], [profileId])).toThrow();
      const after = await call<CarView>(kit.host, "car:list", { profileId });
      expect(after.vehicles).toHaveLength(1);
    }
  });

  it("empties the garage and the thresholds when the section names no CAR entry", async () => {
    const kit = harness();
    const profileId = createProfile();
    const vehicleId = await addVehicle(kit.host, profileId);
    await call(kit.host, "car:addReading", {
      profileId,
      vehicleId,
      date: "2026-05-01",
      reading: 1_000,
    });
    await call(kit.host, "car:setThresholds", {
      profileId,
      dueSoonDays: 60,
      dueSoonDistance: 900,
    });
    // What a profile with no preference row answers, read from the store rather
    // than restated in this test.
    const rowless = await call<CarView>(kit.host, "car:list", { profileId: createProfile() });

    // An archive that says nothing about Car is what a restore of an older
    // archive hands over, and a restore replaces the profile whole.
    kit.host.applyImports([], [profileId]);

    const after = await call<CarView>(kit.host, "car:list", { profileId });
    expect(after.vehicles).toEqual([]);
    expect(after.settings).toEqual(rowless.settings);
  });

  it("writes nothing for a session that names more than one profile, rather than guess", () => {
    const kit = harness();
    expect(kit.host.collectExports(["profile-1", "profile-2"])).toEqual([]);
  });
});
