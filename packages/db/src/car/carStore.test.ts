import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DISTANCE_UNITS,
  FUEL_TYPES,
  SERVICE_CATEGORIES,
  estimateOdometerForDate,
  fuelConsumption,
  totalsByCategory,
  vehicleCosts,
  whatIsDue,
} from "@nexus/core";
import {
  CarNotFoundError,
  CarStore,
  CarValidationError,
  NexusDatabase,
  openDatabase,
  uuidv7,
} from "../index.js";

const NOW = "2026-06-01T08:00:00.000Z";
const LATER = "2026-06-02T09:00:00.000Z";

/** A plain vehicle: the five fields the brief requires and nothing else. */
const PASAT = {
  name: "Pasat",
  make: "Volkswagen",
  model: "Passat",
  year: 2015,
  fuelType: "diesel",
  distanceUnit: "km",
} as const;

let dir: string;
let db: NexusDatabase;
/** Databases opened by `otherStore` — an archive is a file that travels, so a round trip crosses one. */
let extraDatabases: NexusDatabase[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nexus-car-"));
  db = openDatabase({ path: join(dir, "car.db") });
  extraDatabases = [];
});

afterEach(() => {
  for (const extra of extraDatabases) extra.close();
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

function store(profileId: string = createProfile()): CarStore {
  return new CarStore(db.raw, profileId);
}

/**
 * A store in a second database file with a profile of its own — where an
 * archive actually lands. Ids are primary keys of their whole table rather than
 * of one profile, so an archive is restored into a database that does not
 * already carry the same rows, which is exactly a restore from a file.
 */
function otherStore(): CarStore {
  const extra = openDatabase({ path: join(dir, `car-${extraDatabases.length + 2}.db`) });
  extraDatabases.push(extra);
  const profileId = uuidv7();
  extra.raw
    .prepare("INSERT INTO profiles (id, kind, name, created_at) VALUES (?, ?, ?, ?)")
    .run(profileId, "personal", "P2", NOW);
  return new CarStore(extra.raw, profileId);
}

describe("CarStore.createVehicle", () => {
  it("stores a vehicle and returns the row, plate and VIN absent", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);

    expect(vehicle).toMatchObject({
      name: "Pasat",
      make: "Volkswagen",
      model: "Passat",
      year: 2015,
      plate: null,
      vin: null,
      fuelType: "diesel",
      distanceUnit: "km",
      notes: null,
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(cars.listVehicles()).toEqual([vehicle]);
  });

  it("trims every text field, and an empty optional one collapses to null", () => {
    const cars = store();
    const vehicle = cars.createVehicle(
      {
        ...PASAT,
        name: "  Pasat  ",
        plate: "  BG-123-AB ",
        vin: " wvwzzz1jzxw000001 ",
        notes: "   ",
      },
      NOW,
    );

    expect(vehicle).toMatchObject({
      name: "Pasat",
      plate: "BG-123-AB",
      vin: "WVWZZZ1JZXW000001",
      notes: null,
    });
  });

  it("refuses an empty name, an over-long one, and an unknown fuel type or unit", () => {
    const cars = store();
    expect(() => cars.createVehicle({ ...PASAT, name: "   " }, NOW)).toThrow(CarValidationError);
    expect(() => cars.createVehicle({ ...PASAT, name: "x".repeat(61) }, NOW)).toThrow(
      CarValidationError,
    );
    expect(() => cars.createVehicle({ ...PASAT, plate: "x".repeat(21) }, NOW)).toThrow(
      CarValidationError,
    );
    expect(() =>
      cars.createVehicle({ ...PASAT, fuelType: "steam" as never }, NOW),
    ).toThrow(CarValidationError);
    expect(() =>
      cars.createVehicle({ ...PASAT, distanceUnit: "nmi" as never }, NOW),
    ).toThrow(CarValidationError);
  });

  it("refuses a VIN that is not 17 characters of the ISO 3779 alphabet", () => {
    const cars = store();
    for (const vin of [
      "1HGCM82633A00435",
      "1HGCM82633A0043529",
      "1HGCM82633A00435I",
      "1HGCM82633A00435O",
      "1HGCM82633A00435Q",
      "1HGCM826-3A004352",
    ]) {
      expect(() => cars.createVehicle({ ...PASAT, vin }, NOW)).toThrow(CarValidationError);
    }
    // The North-American check digit is not recomputed, so a VIN whose ninth
    // character is not a valid digit for the rest of it is still accepted.
    expect(
      cars.createVehicle({ ...PASAT, vin: "1HGCM82633A004352" }, NOW).vin,
    ).toBe("1HGCM82633A004352");
  });

  it("bounds the model year below by the first automobile and above by next year", () => {
    const cars = store();
    // `NOW` is 2026, so 2027 is the next model year and 2028 is not yet one.
    expect(cars.createVehicle({ ...PASAT, year: 1886 }, NOW).year).toBe(1886);
    expect(cars.createVehicle({ ...PASAT, year: 2027 }, NOW).year).toBe(2027);
    expect(() => cars.createVehicle({ ...PASAT, year: 1885 }, NOW)).toThrow(CarValidationError);
    expect(() => cars.createVehicle({ ...PASAT, year: 2028 }, NOW)).toThrow(CarValidationError);
    expect(() => cars.createVehicle({ ...PASAT, year: 2015.5 }, NOW)).toThrow(CarValidationError);
  });

  it("lists vehicles in Serbian Latin order, whatever order they were created in", () => {
    const cars = store();
    for (const name of ["Škoda", "Žuti", "Suzuki"]) {
      cars.createVehicle({ ...PASAT, name }, NOW);
    }
    expect(cars.listVehicles().map((each) => each.name)).toEqual(["Suzuki", "Škoda", "Žuti"]);
  });

  it("keeps one profile's vehicles out of another's store", () => {
    const mine = store();
    const theirs = store();
    const vehicle = mine.createVehicle(PASAT, NOW);

    expect(theirs.listVehicles()).toEqual([]);
    expect(() => theirs.updateVehicle(vehicle.id, { name: "Ukraden" }, NOW)).toThrow(
      CarNotFoundError,
    );
  });
});

describe("CarStore.updateVehicle / archive / delete", () => {
  it("patches only the fields given, and an explicit null clears an optional one", () => {
    const cars = store();
    const vehicle = cars.createVehicle({ ...PASAT, plate: "BG-123-AB", notes: "kupljen polovan" }, NOW);

    const renamed = cars.updateVehicle(vehicle.id, { name: "Pasat 2.0" }, LATER);
    expect(renamed).toMatchObject({ name: "Pasat 2.0", plate: "BG-123-AB", updatedAt: LATER });

    const cleared = cars.updateVehicle(vehicle.id, { plate: null, notes: null }, LATER);
    expect(cleared).toMatchObject({ plate: null, notes: null, name: "Pasat 2.0" });
    expect(cars.listVehicles()[0]).toEqual(cleared);
  });

  it("refuses an update that would break a rule on the way in", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    expect(() => cars.updateVehicle(vehicle.id, { name: " " }, LATER)).toThrow(CarValidationError);
    expect(() => cars.updateVehicle(vehicle.id, { vin: "kratak" }, LATER)).toThrow(
      CarValidationError,
    );
    // The row is untouched by a refused update.
    expect(cars.listVehicles()[0]?.name).toBe("Pasat");
  });

  it("archives a sold car without losing it, and unarchives it again", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);

    cars.archiveVehicle(vehicle.id, LATER);
    // Archived is still LISTED — the history is the point — and carries the flag.
    expect(cars.listVehicles()).toHaveLength(1);
    expect(cars.listVehicles()[0]?.archivedAt).toBe(LATER);
    // And it is still EDITABLE: archiving says „I sold it", never „stop letting
    // me correct it", and the store reads a paper-trail mistake long after the
    // car is gone.
    expect(cars.updateVehicle(vehicle.id, { plate: "BG-999-ZZ" }, LATER).plate).toBe("BG-999-ZZ");
    expect(() => cars.archiveVehicle(vehicle.id, LATER)).toThrow(CarNotFoundError);

    cars.unarchiveVehicle(vehicle.id, LATER);
    expect(cars.listVehicles()[0]?.archivedAt).toBeNull();
    expect(() => cars.unarchiveVehicle(vehicle.id, LATER)).toThrow(CarNotFoundError);
  });

  it("soft-deletes a vehicle, its history untouched, and restores it", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    cars.createService(vehicle.id, { date: "2026-05-01", category: "oil", description: "Mali servis" }, NOW);

    cars.softDeleteVehicle(vehicle.id, LATER);
    expect(cars.listVehicles()).toEqual([]);
    expect(() => cars.listServices(vehicle.id)).toThrow(CarNotFoundError);
    // The history is exactly where it was: a soft delete is an UPDATE.
    expect(countRows("service_entries")).toBe(1);

    cars.restoreVehicle(vehicle.id, LATER);
    expect(cars.listServices(vehicle.id)).toHaveLength(1);
  });

  it("refuses a delete or a restore aimed at the wrong state, or at a stranger's car", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    expect(() => cars.restoreVehicle(vehicle.id, NOW)).toThrow(CarNotFoundError);
    cars.softDeleteVehicle(vehicle.id, LATER);
    expect(() => cars.softDeleteVehicle(vehicle.id, LATER)).toThrow(CarNotFoundError);
    expect(() => cars.softDeleteVehicle("nema-me", LATER)).toThrow(CarNotFoundError);
  });
});

function countRows(table: string): number {
  return (db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe("the schema's closed sets against the module's own vocabulary", () => {
  it("takes every fuel type and distance unit the module knows, and nothing else", () => {
    const profileId = createProfile();
    const insert = db.raw.prepare(
      `INSERT INTO vehicles (id, profile_id, name, make, model, year, fuel_type, distance_unit,
                             created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    let index = 0;
    for (const fuelType of FUEL_TYPES) {
      for (const unit of DISTANCE_UNITS) {
        index += 1;
        insert.run(`v-${index}`, profileId, "x", "y", "z", 2000, fuelType, unit, NOW, NOW);
      }
    }
    expect(countRows("vehicles")).toBe(FUEL_TYPES.length * DISTANCE_UNITS.length);
    expect(() => insert.run("bad", profileId, "x", "y", "z", 2000, "steam", "km", NOW, NOW)).toThrow(
      /CHECK/,
    );
    expect(() => insert.run("bad2", profileId, "x", "y", "z", 2000, "diesel", "nmi", NOW, NOW)).toThrow(
      /CHECK/,
    );
  });

  it("takes every service category the module knows, and nothing else", () => {
    const profileId = createProfile();
    const vehicleId = new CarStore(db.raw, profileId).createVehicle(PASAT, NOW).id;
    const insert = db.raw.prepare(
      `INSERT INTO service_entries (id, vehicle_id, service_date, category, description,
                                    created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const category of SERVICE_CATEGORIES) {
      insert.run(uuidv7(), vehicleId, "2026-05-01", category, "x", NOW, NOW);
    }
    expect(countRows("service_entries")).toBe(SERVICE_CATEGORIES.length);
    expect(() => insert.run(uuidv7(), vehicleId, "2026-05-01", "klima", "x", NOW, NOW)).toThrow(
      /CHECK/,
    );
  });

  it("refuses a year before the automobile, a wrong-length VIN and a half-priced service", () => {
    const profileId = createProfile();
    const insertVehicle = db.raw.prepare(
      `INSERT INTO vehicles (id, profile_id, name, make, model, year, fuel_type, distance_unit,
                             created_at, updated_at, vin)
       VALUES (?, ?, 'x', 'y', 'z', ?, 'petrol', 'km', ?, ?, ?)`,
    );
    expect(() => insertVehicle.run("year", profileId, 1885, NOW, NOW, null)).toThrow(/CHECK/);
    expect(() => insertVehicle.run("vin", profileId, 2000, NOW, NOW, "1234567890123456")).toThrow(
      /CHECK/,
    );
    // The alphabet is the DB's rule too, not only the store's: an I and a lower
    // case letter are both refused by the CHECK itself.
    expect(() => insertVehicle.run("vin", profileId, 2000, NOW, NOW, "1HGCM82633A00435I")).toThrow(
      /CHECK/,
    );
    expect(() => insertVehicle.run("vin", profileId, 2000, NOW, NOW, "wvwzzz1jzxw000001")).toThrow(
      /CHECK/,
    );
    insertVehicle.run("vin-ok", profileId, 2000, NOW, NOW, "WVWZZZ1JZXW000001");
    insertVehicle.run("ok", profileId, 2000, NOW, NOW, null);

    const insertService = db.raw.prepare(
      `INSERT INTO service_entries (id, vehicle_id, service_date, category, description,
                                    cost_minor, currency, created_at, updated_at)
       VALUES (?, 'ok', '2026-05-01', 'oil', 'x', ?, ?, ?, ?)`,
    );
    expect(() => insertService.run("half", 450_000, null, NOW, NOW)).toThrow(/CHECK/);
    expect(() => insertService.run("half", null, "RSD", NOW, NOW)).toThrow(/CHECK/);
    insertService.run("whole", 450_000, "RSD", NOW, NOW);
    insertService.run("free", null, null, NOW, NOW);
    expect(countRows("service_entries")).toBe(2);
  });

  /**
   * The price triple's rule, asked of SQLite rather than of the store: all three
   * columns travel together, or the currency is present with at least one of the
   * two numbers. Pinned through raw SQL because the CHECK is written as two
   * parenthesised groups compared with `=`, and a statement about precedence is
   * one to have the database answer.
   */
  it("refuses a fuel price with no currency, and a currency with no price", () => {
    const profileId = createProfile();
    const vehicleId = new CarStore(db.raw, profileId).createVehicle(PASAT, NOW).id;
    const insert = db.raw.prepare(
      `INSERT INTO fuel_entries
         (id, vehicle_id, fuel_date, quantity, full_tank, price_per_unit_minor, total_minor,
          currency, created_at, updated_at)
       VALUES (?, ?, '2026-05-01', 40, 1, ?, ?, ?, ?, ?)`,
    );
    expect(() => insert.run("a", vehicleId, 18_000, null, null, NOW, NOW)).toThrow(/CHECK/);
    expect(() => insert.run("b", vehicleId, null, null, "RSD", NOW, NOW)).toThrow(/CHECK/);
    expect(() => insert.run("c", vehicleId, null, 715_000, null, NOW, NOW)).toThrow(/CHECK/);
    insert.run("price", vehicleId, 18_000, null, "RSD", NOW, NOW);
    insert.run("total", vehicleId, null, 715_000, "RSD", NOW, NOW);
    insert.run("both", vehicleId, 18_000, 715_000, "RSD", NOW, NOW);
    insert.run("free", vehicleId, null, null, null, NOW, NOW);
    expect(countRows("fuel_entries")).toBe(4);
  });
});

describe("CarStore odometer readings", () => {
  it("records readings in date order and lists them oldest first", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    cars.addReading(vehicle.id, { date: "2026-01-01", reading: 10_000 }, NOW);
    cars.addReading(vehicle.id, { date: "2026-03-01", reading: 11_000 }, LATER);

    expect(cars.listReadings(vehicle.id).map((each) => [each.date, each.reading, each.segment])).toEqual([
      ["2026-01-01", 10_000, 1],
      ["2026-03-01", 11_000, 1],
    ]);
  });

  it("refuses a reading that falls below an earlier one, naming the way out", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    cars.addReading(vehicle.id, { date: "2026-01-01", reading: 10_000 }, NOW);

    expect(() => cars.addReading(vehicle.id, { date: "2026-03-01", reading: 9_000 }, LATER)).toThrow(
      /startsNewSegment/,
    );
    expect(cars.listReadings(vehicle.id)).toHaveLength(1);
  });

  it("opens a new segment for a replaced odometer, and takes the lower reading", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    cars.addReading(vehicle.id, { date: "2026-01-01", reading: 100_000 }, NOW);
    const replaced = cars.addReading(
      vehicle.id,
      { date: "2026-06-01", reading: 40, startsNewSegment: true },
      LATER,
    );

    expect(replaced.segment).toBe(2);
    // And the new segment has its own floor: 20 km is a decrease.
    expect(() => cars.addReading(vehicle.id, { date: "2026-06-05", reading: 20 }, LATER)).toThrow(
      CarValidationError,
    );
    expect(cars.addReading(vehicle.id, { date: "2026-06-05", reading: 120 }, LATER).segment).toBe(2);
  });

  it("refuses a replaced odometer recorded behind a reading that is already there", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    cars.addReading(vehicle.id, { date: "2026-05-01", reading: 100_000 }, NOW);

    expect(() =>
      cars.addReading(vehicle.id, { date: "2026-01-01", reading: 40, startsNewSegment: true }, LATER),
    ).toThrow(/newest/);
  });

  it("refuses a negative reading, a bad day, and a reading on a stranger's car", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    expect(() => cars.addReading(vehicle.id, { date: "2026-01-01", reading: -1 }, NOW)).toThrow(
      CarValidationError,
    );
    expect(() => cars.addReading(vehicle.id, { date: "2026-02-30", reading: 5 }, NOW)).toThrow(
      CarValidationError,
    );
    expect(() => cars.addReading(vehicle.id, { date: "2026-01-01", reading: 5.5 }, NOW)).toThrow(
      CarValidationError,
    );
    expect(() => cars.addReading("nema-me", { date: "2026-01-01", reading: 5 }, NOW)).toThrow(
      CarNotFoundError,
    );
  });

  it("removes a reading, and treats removing one that is gone as done", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    const reading = cars.addReading(vehicle.id, { date: "2026-01-01", reading: 10_000 }, NOW);

    cars.removeReading(vehicle.id, reading.id);
    expect(cars.listReadings(vehicle.id)).toEqual([]);
    expect(() => cars.removeReading(vehicle.id, reading.id)).not.toThrow();
    expect(() => cars.removeReading("nema-me", reading.id)).toThrow(CarNotFoundError);
  });

  it("carries the readings away with the vehicle when the profile is deleted", () => {
    const profileId = createProfile();
    const cars = new CarStore(db.raw, profileId);
    const vehicle = cars.createVehicle(PASAT, NOW);
    cars.addReading(vehicle.id, { date: "2026-01-01", reading: 10_000 }, NOW);

    db.raw.prepare("DELETE FROM profiles WHERE id = ?").run(profileId);
    expect(countRows("odometer_readings")).toBe(0);
  });
});

describe("CarStore service entries", () => {
  it("stores a service with its money as minor units and its currency beside them", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    const entry = cars.createService(
      vehicle.id,
      {
        date: "2026-05-01",
        odometer: 120_000,
        category: "oil",
        description: "  Mali servis  ",
        costMinor: 450_000,
        currency: "RSD",
        workshop: " Auto kuća ",
        parts: "filter ulja, ulje 5W-30",
      },
      NOW,
    );

    expect(entry).toMatchObject({
      date: "2026-05-01",
      odometer: 120_000,
      category: "oil",
      description: "Mali servis",
      costMinor: 450_000,
      currency: "RSD",
      workshop: "Auto kuća",
      parts: "filter ulja, ulje 5W-30",
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(cars.listServices(vehicle.id)).toEqual([entry]);
  });

  it("lists services newest first and keeps a caught-up older entry in its place", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    cars.createService(vehicle.id, { date: "2026-05-01", category: "oil", description: "Mali servis" }, NOW);
    cars.createService(vehicle.id, { date: "2026-01-15", category: "tyres", description: "Zimske gume" }, NOW);
    cars.createService(vehicle.id, { date: "2026-09-01", category: "registration", description: "Registracija" }, NOW);

    expect(cars.listServices(vehicle.id).map((each) => each.date)).toEqual([
      "2026-09-01",
      "2026-05-01",
      "2026-01-15",
    ]);
  });

  it("refuses an unknown category, an empty description, a half price and a bad currency", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    expect(() =>
      cars.createService(vehicle.id, { date: "2026-05-01", category: "klima" as never, description: "x" }, NOW),
    ).toThrow(CarValidationError);
    expect(() =>
      cars.createService(vehicle.id, { date: "2026-05-01", category: "oil", description: "  " }, NOW),
    ).toThrow(CarValidationError);
    expect(() =>
      cars.createService(
        vehicle.id,
        { date: "2026-05-01", category: "oil", description: "x", costMinor: 450_000 },
        NOW,
      ),
    ).toThrow(CarValidationError);
    expect(() =>
      cars.createService(
        vehicle.id,
        { date: "2026-05-01", category: "oil", description: "x", currency: "RSD" },
        NOW,
      ),
    ).toThrow(CarValidationError);
    expect(() =>
      cars.createService(
        vehicle.id,
        { date: "2026-05-01", category: "oil", description: "x", costMinor: 450_000, currency: "rsd" },
        NOW,
      ),
    ).toThrow(CarValidationError);
    expect(() =>
      cars.createService(
        vehicle.id,
        { date: "2026-05-01", category: "oil", description: "x", costMinor: -5, currency: "RSD" },
        NOW,
      ),
    ).toThrow(CarValidationError);
  });

  it("patches, soft-deletes and restores an entry", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    const entry = cars.createService(
      vehicle.id,
      { date: "2026-05-01", category: "oil", description: "Mali servis" },
      NOW,
    );

    expect(cars.updateService(vehicle.id, entry.id, { costMinor: 500_000, currency: "RSD" }, LATER)).toMatchObject({
      costMinor: 500_000,
      currency: "RSD",
      description: "Mali servis",
      updatedAt: LATER,
    });
    expect(cars.updateService(vehicle.id, entry.id, { costMinor: null, currency: null }, LATER)).toMatchObject({
      costMinor: null,
      currency: null,
    });

    cars.softDeleteService(vehicle.id, entry.id, LATER);
    expect(cars.listServices(vehicle.id)).toEqual([]);
    cars.restoreService(vehicle.id, entry.id, LATER);
    expect(cars.listServices(vehicle.id)).toHaveLength(1);
    expect(() => cars.restoreService(vehicle.id, entry.id, LATER)).toThrow(CarNotFoundError);
  });

  it("refuses a service on a stranger's vehicle", () => {
    const mine = store();
    const theirs = store();
    const vehicle = mine.createVehicle(PASAT, NOW);
    expect(() =>
      theirs.createService(vehicle.id, { date: "2026-05-01", category: "oil", description: "x" }, NOW),
    ).toThrow(CarNotFoundError);
  });
});

describe("CarStore service receipts", () => {
  const RECEIPT = {
    fileName: "racun.pdf",
    mime: "application/pdf",
    sizeBytes: 40_112,
    sha256: "9f2b1c".padEnd(64, "0"),
  };

  it("indexes a receipt against its service and lists it oldest first", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    const entry = cars.createService(
      vehicle.id,
      { date: "2026-05-01", category: "oil", description: "Mali servis" },
      NOW,
    );
    const receipt = cars.addServiceAttachment(entry.id, RECEIPT, NOW);

    expect(receipt).toMatchObject({ ...RECEIPT, serviceId: entry.id, createdAt: NOW });
    expect(cars.listServiceAttachments(entry.id)).toEqual([receipt]);
    // The bytes never live here — only the reference count, which main's blob
    // store uses to decide whether a file is still named by anything.
    expect(cars.attachmentRefCount(RECEIPT.sha256)).toBe(1);
    expect(cars.attachmentMimeForHash(RECEIPT.sha256)).toBe("application/pdf");
  });

  it("counts references across profiles, because the blob store is content-addressed", () => {
    const mine = store();
    const theirs = store();
    const myEntry = carsService(mine, mine.createVehicle(PASAT, NOW).id, NOW);
    const theirEntry = carsService(
      theirs,
      theirs.createVehicle({ ...PASAT, name: "Tudji" }, NOW).id,
      NOW,
    );

    mine.addServiceAttachment(myEntry.id, RECEIPT, NOW);
    theirs.addServiceAttachment(theirEntry.id, RECEIPT, NOW);
    expect(mine.attachmentRefCount(RECEIPT.sha256)).toBe(2);
  });

  it("refuses a bad file name, mime, size or hash, and a service that is not live", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    const entry = cars.createService(
      vehicle.id,
      { date: "2026-05-01", category: "oil", description: "Mali servis" },
      NOW,
    );
    expect(() => cars.addServiceAttachment(entry.id, { ...RECEIPT, fileName: "a/b.pdf" }, NOW)).toThrow(
      CarValidationError,
    );
    expect(() => cars.addServiceAttachment(entry.id, { ...RECEIPT, mime: "PDF" }, NOW)).toThrow(
      CarValidationError,
    );
    expect(() => cars.addServiceAttachment(entry.id, { ...RECEIPT, sizeBytes: 0 }, NOW)).toThrow(
      CarValidationError,
    );
    expect(() =>
      cars.addServiceAttachment(entry.id, { ...RECEIPT, sizeBytes: 52_428_801 }, NOW),
    ).toThrow(CarValidationError);
    expect(() => cars.addServiceAttachment(entry.id, { ...RECEIPT, sha256: "ABC" }, NOW)).toThrow(
      CarValidationError,
    );
    expect(() => cars.addServiceAttachment("nema-me", RECEIPT, NOW)).toThrow(CarNotFoundError);

    cars.softDeleteService(vehicle.id, entry.id, LATER);
    expect(() => cars.addServiceAttachment(entry.id, RECEIPT, LATER)).toThrow(CarNotFoundError);
  });

  it("removes a receipt and answers with its hash so main can collect the blob", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    const entry = cars.createService(
      vehicle.id,
      { date: "2026-05-01", category: "oil", description: "Mali servis" },
      NOW,
    );
    const receipt = cars.addServiceAttachment(entry.id, RECEIPT, NOW);

    expect(cars.removeServiceAttachment(entry.id, receipt.id)).toEqual(receipt);
    expect(cars.attachmentRefCount(RECEIPT.sha256)).toBe(0);
    expect(cars.attachmentMimeForHash(RECEIPT.sha256)).toBeNull();
    expect(() => cars.removeServiceAttachment(entry.id, receipt.id)).toThrow(CarNotFoundError);
  });
});

/** One service entry on a vehicle, for the tests that only need a live receipt owner. */
function carsService(cars: CarStore, vehicleId: string, now: string) {
  return cars.createService(
    vehicleId,
    { date: "2026-05-01", category: "oil", description: "Mali servis" },
    now,
  );
}

describe("CarStore service intervals", () => {
  it("sets one interval per category, replacing it rather than accumulating", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);

    const first = cars.setInterval(vehicle.id, "oil", { everyKm: 10_000, everyMonths: 12 }, NOW);
    expect(first).toMatchObject({ category: "oil", everyKm: 10_000, everyMonths: 12 });

    const replaced = cars.setInterval(vehicle.id, "oil", { everyKm: 15_000, everyMonths: null }, LATER);
    expect(replaced.id).toBe(first.id);
    expect(replaced).toMatchObject({ everyKm: 15_000, everyMonths: null, updatedAt: LATER });
    expect(cars.listIntervals(vehicle.id)).toHaveLength(1);
  });

  it("lists intervals in the module's category order, not alphabetically", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    cars.setInterval(vehicle.id, "registration", { everyKm: null, everyMonths: 12 }, NOW);
    cars.setInterval(vehicle.id, "oil", { everyKm: 10_000, everyMonths: null }, NOW);
    cars.setInterval(vehicle.id, "tyres", { everyKm: 40_000, everyMonths: null }, NOW);

    expect(cars.listIntervals(vehicle.id).map((each) => each.category)).toEqual([
      "oil",
      "tyres",
      "registration",
    ]);
  });

  it("refuses an interval that names neither bound, a non-positive bound and a bad category", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    expect(() => cars.setInterval(vehicle.id, "oil", { everyKm: null, everyMonths: null }, NOW)).toThrow(
      CarValidationError,
    );
    expect(() => cars.setInterval(vehicle.id, "oil", { everyKm: 0, everyMonths: null }, NOW)).toThrow(
      CarValidationError,
    );
    expect(() => cars.setInterval(vehicle.id, "oil", { everyKm: null, everyMonths: -1 }, NOW)).toThrow(
      CarValidationError,
    );
    expect(() =>
      cars.setInterval(vehicle.id, "klima" as never, { everyKm: 1_000, everyMonths: null }, NOW),
    ).toThrow(CarValidationError);
    expect(() =>
      cars.setInterval(vehicle.id, "oil", { everyKm: 1_000_001, everyMonths: null }, NOW),
    ).toThrow(CarValidationError);
  });

  it("clears an interval, and clearing one that is not there is done rather than an error", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    cars.setInterval(vehicle.id, "oil", { everyKm: 10_000, everyMonths: null }, NOW);

    cars.clearInterval(vehicle.id, "oil");
    expect(cars.listIntervals(vehicle.id)).toEqual([]);
    expect(() => cars.clearInterval(vehicle.id, "oil")).not.toThrow();
    expect(() => cars.clearInterval("nema-me", "oil")).toThrow(CarNotFoundError);
  });
});

describe("CarStore fuel entries", () => {
  it("stores a fill with a total, with a price per unit, or with neither", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    cars.createFuelEntry(
      vehicle.id,
      { date: "2026-01-20", odometer: 10_500, quantity: 42.35, fullTank: true, totalMinor: 715_000, currency: "RSD" },
      NOW,
    );
    cars.createFuelEntry(
      vehicle.id,
      { date: "2026-02-20", odometer: 11_000, quantity: 40, fullTank: false, pricePerUnitMinor: 18_000, currency: "RSD" },
      NOW,
    );
    const unpriced = cars.createFuelEntry(
      vehicle.id,
      { date: "2026-03-20", quantity: 30, fullTank: false },
      NOW,
    );

    expect(unpriced).toMatchObject({
      odometer: null,
      quantity: 30,
      fullTank: false,
      pricePerUnitMinor: null,
      totalMinor: null,
      currency: null,
    });
    // Newest first.
    expect(cars.listFuelEntries(vehicle.id).map((each) => each.date)).toEqual([
      "2026-03-20",
      "2026-02-20",
      "2026-01-20",
    ]);
    // The fraction survived the round trip through a REAL column.
    expect(cars.listFuelEntries(vehicle.id)[2]?.quantity).toBe(42.35);
  });

  it("refuses a quantity that is not a positive number, and a bad odometer", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    for (const quantity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 501]) {
      expect(() =>
        cars.createFuelEntry(vehicle.id, { date: "2026-01-20", quantity, fullTank: false }, NOW),
      ).toThrow(CarValidationError);
    }
    expect(() =>
      cars.createFuelEntry(
        vehicle.id,
        { date: "2026-01-20", odometer: -5, quantity: 40, fullTank: false },
        NOW,
      ),
    ).toThrow(CarValidationError);
    expect(() =>
      cars.createFuelEntry(vehicle.id, { date: "2026-13-01", quantity: 40, fullTank: false }, NOW),
    ).toThrow(CarValidationError);
  });

  it("refuses money without its currency, and a currency without any money", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    expect(() =>
      cars.createFuelEntry(
        vehicle.id,
        { date: "2026-01-20", quantity: 40, fullTank: true, totalMinor: 715_000 },
        NOW,
      ),
    ).toThrow(CarValidationError);
    expect(() =>
      cars.createFuelEntry(
        vehicle.id,
        { date: "2026-01-20", quantity: 40, fullTank: true, currency: "RSD" },
        NOW,
      ),
    ).toThrow(CarValidationError);
    expect(() =>
      cars.createFuelEntry(
        vehicle.id,
        { date: "2026-01-20", quantity: 40, fullTank: true, totalMinor: 0, currency: "RSD" },
        NOW,
      ),
    ).toThrow(CarValidationError);
  });

  it("patches a fill, clears its price, soft-deletes and restores it", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    const fill = cars.createFuelEntry(
      vehicle.id,
      { date: "2026-01-20", odometer: 10_500, quantity: 40, fullTank: true, totalMinor: 715_000, currency: "RSD" },
      NOW,
    );

    expect(cars.updateFuelEntry(vehicle.id, fill.id, { fullTank: false }, LATER)).toMatchObject({
      fullTank: false,
      quantity: 40,
      totalMinor: 715_000,
    });
    expect(
      cars.updateFuelEntry(
        vehicle.id,
        fill.id,
        { totalMinor: null, pricePerUnitMinor: 18_000 },
        LATER,
      ),
    ).toMatchObject({ totalMinor: null, pricePerUnitMinor: 18_000, currency: "RSD" });
    expect(
      cars.updateFuelEntry(vehicle.id, fill.id, { totalMinor: null, pricePerUnitMinor: null, currency: null }, LATER),
    ).toMatchObject({ totalMinor: null, pricePerUnitMinor: null, currency: null });

    cars.softDeleteFuelEntry(vehicle.id, fill.id, LATER);
    expect(cars.listFuelEntries(vehicle.id)).toEqual([]);
    cars.restoreFuelEntry(vehicle.id, fill.id, LATER);
    expect(cars.listFuelEntries(vehicle.id)).toHaveLength(1);
  });
});

describe("CarStore faults", () => {
  it("stores a fault with the service that fixed it, and lists newest first", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    const repair = cars.createService(
      vehicle.id,
      { date: "2026-05-01", category: "repair", description: "Zamena senzora" },
      NOW,
    );
    cars.createFault(
      vehicle.id,
      { date: "2026-04-20", symptom: "  Pali se lampica motora  " },
      NOW,
    );
    const fixed = cars.createFault(
      vehicle.id,
      {
        date: "2026-05-02",
        symptom: "Lampica motora",
        status: "fixed",
        fixNotes: "Senzor pritiska",
        serviceId: repair.id,
      },
      LATER,
    );

    expect(fixed).toMatchObject({
      date: "2026-05-02",
      symptom: "Lampica motora",
      status: "fixed",
      fixNotes: "Senzor pritiska",
      serviceId: repair.id,
    });
    expect(cars.listFaults(vehicle.id).map((each) => each.status)).toEqual(["fixed", "open"]);
    expect(cars.listFaults(vehicle.id, { status: "open" })).toHaveLength(1);
    expect(cars.listFaults(vehicle.id, { status: "fixed" })[0]?.symptom).toBe("Lampica motora");
  });

  it("refuses an unknown status, an empty symptom, and a link to a service of another vehicle", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    const other = cars.createVehicle({ ...PASAT, name: "Drugi" }, NOW);
    const otherService = carsService(cars, other.id, NOW);

    expect(() =>
      cars.createFault(vehicle.id, { date: "2026-04-20", symptom: "x", status: "open " as never }, NOW),
    ).toThrow(CarValidationError);
    expect(() => cars.createFault(vehicle.id, { date: "2026-04-20", symptom: "  " }, NOW)).toThrow(
      CarValidationError,
    );
    expect(() =>
      cars.createFault(vehicle.id, { date: "2026-04-20", symptom: "x", serviceId: otherService.id }, NOW),
    ).toThrow(CarNotFoundError);
    expect(() =>
      cars.createFault(vehicle.id, { date: "2026-04-20", symptom: "x", serviceId: "nema-me" }, NOW),
    ).toThrow(CarNotFoundError);
  });

  it("patches a fault to fixed, soft-deletes and restores it", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    const fault = cars.createFault(vehicle.id, { date: "2026-04-20", symptom: "Lampica" }, NOW);

    expect(
      cars.updateFault(vehicle.id, fault.id, { status: "fixed", fixNotes: "Senzor" }, LATER),
    ).toMatchObject({ status: "fixed", fixNotes: "Senzor", symptom: "Lampica" });
    expect(cars.updateFault(vehicle.id, fault.id, { fixNotes: null }, LATER).fixNotes).toBeNull();

    cars.softDeleteFault(vehicle.id, fault.id, LATER);
    expect(cars.listFaults(vehicle.id)).toEqual([]);
    cars.restoreFault(vehicle.id, fault.id, LATER);
    expect(cars.listFaults(vehicle.id)).toHaveLength(1);
  });

  it("keeps the fault when the service entry it named is hard-deleted", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    const repair = carsService(cars, vehicle.id, NOW);
    const fault = cars.createFault(
      vehicle.id,
      { date: "2026-04-20", symptom: "Lampica", serviceId: repair.id },
      NOW,
    );

    db.raw.prepare("DELETE FROM service_entries WHERE id = ?").run(repair.id);
    expect(cars.listFaults(vehicle.id)[0]).toMatchObject({ id: fault.id, serviceId: null });
  });
});

/**
 * The two halves of this module are written apart — pure logic in `@nexus/core`,
 * storage here — so these tests exist to prove the store's rows ARE the engine's
 * input rather than to re-test the arithmetic. Each figure below is the same one
 * the engine's own suite computes, taken here from rows that really came out of
 * SQLite.
 */
describe("the store's rows as the engine's input", () => {
  it("measures consumption from stored fills, partials and a replaced odometer alike", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    cars.addReading(vehicle.id, { date: "2026-01-01", reading: 10_000 }, NOW);
    // The odometer is replaced on 2026-06-01, which is what makes the 100 000 →
    // 300 gap unmeasurable instead of an enormous distance.
    const replacement = cars.addReading(
      vehicle.id,
      { date: "2026-06-01", reading: 300, startsNewSegment: true },
      NOW,
    );
    cars.createFuelEntry(vehicle.id, { date: "2026-01-01", odometer: 10_000, quantity: 45, fullTank: true }, NOW);
    cars.createFuelEntry(vehicle.id, { date: "2026-01-08", odometer: 10_200, quantity: 20, fullTank: false }, NOW);
    cars.createFuelEntry(vehicle.id, { date: "2026-01-20", odometer: 10_500, quantity: 40, fullTank: true }, NOW);
    cars.createFuelEntry(vehicle.id, { date: "2026-06-01", odometer: 300, quantity: 30, fullTank: true }, NOW);
    cars.createFuelEntry(vehicle.id, { date: "2026-06-20", odometer: 800, quantity: 50, fullTank: true }, NOW);

    const readings = cars.listReadings(vehicle.id);
    const consumption = fuelConsumption(cars.listFuelEntries(vehicle.id), vehicle.distanceUnit, {
      segmentStarts: readings.filter((each) => each.segment > 1).map((each) => each.date),
    });

    // 10 000 → 10 500 km on 20 + 40 = 60 L is 12.00 L/100 km; the pair that
    // straddles the replacement is dropped, and 300 → 800 km on 50 L is 10.00.
    expect(consumption.segments.map((each) => [each.fromDate, each.distance, each.per100Km])).toEqual([
      ["2026-01-01", 500, 12],
      ["2026-06-01", 500, 10],
    ]);
    expect(replacement.segment).toBe(2);
  });

  it("estimates today's odometer from stored readings, and counts a service interval down", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    cars.addReading(vehicle.id, { date: "2026-01-01", reading: 10_000 }, NOW);
    cars.addReading(vehicle.id, { date: "2026-01-11", reading: 10_500 }, NOW);
    cars.createService(
      vehicle.id,
      { date: "2026-01-05", odometer: 10_200, category: "oil", description: "Mali servis" },
      NOW,
    );
    cars.setInterval(vehicle.id, "oil", { everyKm: 10_000, everyMonths: 12 }, NOW);

    // 50 km a day from 10 000 on 1 January: 20 January is 10 000 + 50 × 19.
    const readings = cars.listReadings(vehicle.id);
    const estimated = estimateOdometerForDate(readings, "2026-01-20");
    expect(estimated).toBeCloseTo(10_950, 9);

    const [due] = whatIsDue({
      intervals: cars.listIntervals(vehicle.id),
      services: cars.listServices(vehicle.id),
      today: "2026-01-20",
      estimatedOdometer: estimated,
      thresholds: { days: 30, distance: 1_000 },
    });
    // Due at 10 200 + 10 000 = 20 200 km, which is 9 250 km away: ok.
    expect(due).toMatchObject({
      category: "oil",
      dueDate: "2027-01-05",
      dueOdometer: 20_200,
      status: "ok",
      by: null,
    });
  });

  it("adds the year's costs up from stored services and fills", () => {
    const cars = store();
    const vehicle = cars.createVehicle(PASAT, NOW);
    cars.createService(
      vehicle.id,
      {
        date: "2026-01-05",
        category: "oil",
        description: "Mali servis",
        costMinor: 450_000,
        currency: "RSD",
      },
      NOW,
    );
    cars.createService(
      vehicle.id,
      { date: "2026-02-05", category: "repair", description: "Zamena kaiša" },
      NOW,
    );
    cars.createFuelEntry(
      vehicle.id,
      { date: "2026-01-20", quantity: 40, fullTank: true, pricePerUnitMinor: 18_000, currency: "RSD" },
      NOW,
    );

    const costs = vehicleCosts(cars.listServices(vehicle.id), cars.listFuelEntries(vehicle.id));
    expect(totalsByCategory(costs)).toEqual([
      { category: "oil", currency: "RSD", minorUnits: 450_000, count: 1 },
      { category: "fuel", currency: "RSD", minorUnits: 720_000, count: 1 },
    ]);
  });
});

/** Every table gets at least one row, so a round trip that loses one fails. */
function seedEverything(cars: CarStore): void {
  const vehicle = cars.createVehicle(
    { ...PASAT, plate: "BG-123-AB", vin: "WVWZZZ1JZXW000001", notes: "kupljen polovan" },
    NOW,
  );
  cars.createVehicle({ name: "Žuti", make: "Fiat", model: "Panda", year: 2009, fuelType: "petrol", distanceUnit: "km" }, NOW);
  cars.addReading(vehicle.id, { date: "2026-01-01", reading: 100_000 }, NOW);
  cars.addReading(vehicle.id, { date: "2026-06-01", reading: 40, startsNewSegment: true }, LATER);
  const service = cars.createService(
    vehicle.id,
    {
      date: "2026-05-01",
      odometer: 100_500,
      category: "oil",
      description: "Mali servis",
      costMinor: 450_000,
      currency: "RSD",
      workshop: "Auto kuća",
      parts: "filter ulja",
    },
    NOW,
  );
  cars.addServiceAttachment(
    service.id,
    { fileName: "racun.pdf", mime: "application/pdf", sizeBytes: 40_112, sha256: "9f2b".padEnd(64, "0") },
    NOW,
  );
  cars.setInterval(vehicle.id, "oil", { everyKm: 10_000, everyMonths: 12 }, NOW);
  cars.createFuelEntry(
    vehicle.id,
    { date: "2026-01-20", odometer: 100_200, quantity: 42.35, fullTank: true, totalMinor: 715_000, currency: "RSD" },
    NOW,
  );
  const fault = cars.createFault(
    vehicle.id,
    { date: "2026-04-20", symptom: "Lampica motora", status: "fixed", fixNotes: "Senzor", serviceId: service.id },
    NOW,
  );
  cars.softDeleteFault(vehicle.id, fault.id, LATER);
}

/** The row as the archive carries it: without the profile it happens to live in. */
function withoutProfile<T extends { profileId: string }>(row: T): Omit<T, "profileId"> {
  const { profileId: _profileId, ...rest } = row;
  return rest;
}

describe("CarStore.exportData / importData", () => {
  it("round-trips every table through a versioned value and plain JSON", () => {
    const source = store();
    seedEverything(source);
    const exported = source.exportData();
    expect(exported.version).toBe(1);

    // Through a real JSON round trip: the archive is a file before it is a
    // value, and a Map/undefined/Date that survived in memory would not survive
    // this.
    const target = otherStore();
    target.importData(JSON.parse(JSON.stringify(exported)));

    expect(target.listVehicles().map(withoutProfile)).toEqual(exported.vehicles);
    const sourceVehicles = source.listVehicles();
    const targetVehicles = target.listVehicles();
    expect(targetVehicles.map((each) => each.name)).toEqual(sourceVehicles.map((each) => each.name));
    for (const [index, sourceVehicle] of sourceVehicles.entries()) {
      const targetVehicle = targetVehicles[index];
      const sourceId = sourceVehicle.id;
      const targetId = targetVehicle?.id ?? "";
      expect(target.listReadings(targetId)).toEqual(
        source.listReadings(sourceId).map((each) => ({ ...each, vehicleId: targetId })),
      );
      expect(target.listServices(targetId)).toEqual(
        source.listServices(sourceId).map((each) => ({ ...each, vehicleId: targetId })),
      );
      expect(target.listFuelEntries(targetId)).toEqual(
        source.listFuelEntries(sourceId).map((each) => ({ ...each, vehicleId: targetId })),
      );
      expect(target.listFaults(targetId)).toEqual(
        source.listFaults(sourceId).map((each) => ({ ...each, vehicleId: targetId })),
      );
      expect(target.listIntervals(targetId)).toEqual(
        source.listIntervals(sourceId).map((each) => ({ ...each, vehicleId: targetId })),
      );
    }
    // The receipts are keyed by service entry, which is keyed by vehicle: they
    // are compared through the target's own ids, as everything above is.
    const targetVehicle = targetVehicles[0];
    expect(targetVehicle).toBeDefined();
    const targetService = target.listServices(targetVehicle?.id ?? "")[0];
    expect(target.listServiceAttachments(targetService?.id ?? "")).toEqual(
      source.listServiceAttachments(source.listServices(sourceVehicles[0]?.id ?? "")[0]?.id ?? ""),
    );
    expect(exported.readings).toHaveLength(2);
    expect(exported.services).toHaveLength(1);
    expect(exported.serviceAttachments).toHaveLength(1);
    expect(exported.intervals).toHaveLength(1);
    expect(exported.fuel).toHaveLength(1);
    // A soft-deleted fault does not ride: the archive carries what the user has,
    // and a deleted row is not something they have any more.
    expect(exported.faults).toEqual([]);
  });

  it("keeps the attachment rows in the archive, so a restored receipt still finds its blob", () => {
    const source = store();
    seedEverything(source);
    const target = otherStore();
    target.importData(source.exportData());

    const targetVehicle = target.listVehicles()[0]!;
    const service = target.listServices(targetVehicle.id)[0]!;
    const receipts = target.listServiceAttachments(service.id);
    expect(receipts.map((each) => each.fileName)).toEqual(["racun.pdf"]);
    expect(target.attachmentRefCount(receipts[0]!.sha256)).toBe(1);
  });

  it("replaces whatever this profile had, rather than merging into it", () => {
    const source = store();
    seedEverything(source);
    const target = otherStore();
    target.createVehicle({ ...PASAT, name: "Stari auto" }, NOW);

    target.importData(source.exportData());
    expect(target.listVehicles().map((each) => each.name)).toEqual(["Pasat", "Žuti"]);
  });

  it("takes its own archive back unchanged — the restore-into-this-profile case", () => {
    const cars = store();
    seedEverything(cars);
    const before = cars.exportData();

    cars.importData(before);
    // Ids included: the archive carries them, so a re-import writes the same
    // rows rather than a fresh set that happens to describe the same car.
    expect(cars.exportData()).toEqual(before);
  });

  it("refuses a version it does not know, writing nothing", () => {
    const source = store();
    seedEverything(source);
    const target = otherStore();
    const kept = target.createVehicle(PASAT, NOW);

    const exported = source.exportData() as unknown as { version: number };
    exported.version = 2;
    expect(() => target.importData(exported)).toThrow(CarValidationError);
    expect(() => target.importData(exported)).toThrow(/version/);
    expect(target.listVehicles().map((each) => each.id)).toEqual([kept.id]);
  });

  it("refuses a value that is not a car archive at all", () => {
    const target = otherStore();
    for (const value of [null, 42, "arhiva", [], { version: 1 }]) {
      expect(() => target.importData(value)).toThrow(CarValidationError);
    }
  });

  it("validates the WHOLE value before writing any of it", () => {
    const source = store();
    seedEverything(source);
    const target = otherStore();
    const kept = target.createVehicle(PASAT, NOW);

    // Six independent ways the value can be wrong: an unknown enum in a child
    // table, a dangling service reference, a duplicate id, a reading that
    // decreases inside one segment, a row that is not an object, and a
    // cross-vehicle reference. Each must leave the target exactly as it was.
    const broken: readonly ((value: ReturnType<CarStore["exportData"]>) => unknown)[] = [
      (value) => ({ ...value, fuel: [{ ...value.fuel[0], fullTank: "yes" }] }),
      (value) => ({ ...value, faults: [{ ...faultRow(), serviceId: "nema-me" }] }),
      (value) => ({ ...value, vehicles: [...value.vehicles, value.vehicles[0]] }),
      (value) => ({
        ...value,
        readings: [
          { ...value.readings[0], id: "r1", date: "2026-01-01", reading: 100_000, segment: 1 },
          { ...value.readings[1], id: "r2", date: "2026-02-01", reading: 99_000, segment: 1 },
        ],
      }),
      (value) => ({ ...value, services: ["nije red"] }),
      (value) => ({
        ...value,
        faults: [{ ...faultRow(), vehicleId: "nema-me" }],
      }),
    ];

    for (const breakIt of broken) {
      expect(() => target.importData(breakIt(source.exportData()))).toThrow(CarValidationError);
      expect(target.listVehicles().map((each) => each.id)).toEqual([kept.id]);
      expect(target.listReadings(kept.id)).toEqual([]);
    }
  });

  it("takes a value whose fault names a service entry of the SAME vehicle", () => {
    const source = store();
    seedEverything(source);
    const vehicleId = source.listVehicles()[0]!.id;
    const serviceId = source.listServices(vehicleId)[0]!.id;
    const target = otherStore();

    target.importData({
      ...source.exportData(),
      faults: [
        {
          id: "fault-1",
          vehicleId,
          date: "2026-04-20",
          symptom: "Lampica",
          status: "fixed" as const,
          fixNotes: null,
          serviceId,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });
    expect(target.listFaults(vehicleId)[0]).toMatchObject({ id: "fault-1", serviceId });
  });
});

/** The shape of one fault row, for the cases that want to break exactly one field of one. */
function faultRow() {
  return {
    id: "fault-1",
    vehicleId: "nema-me",
    date: "2026-04-20",
    symptom: "Lampica",
    status: "open" as const,
    fixNotes: null,
    serviceId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

