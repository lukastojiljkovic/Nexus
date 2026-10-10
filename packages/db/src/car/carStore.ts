import type Database from "better-sqlite3-multiple-ciphers";
import {
  DISTANCE_UNITS,
  FAULT_STATUSES,
  FUEL_TYPES,
  MAX_ID_LENGTH,
  MIN_VEHICLE_YEAR,
  SERVICE_CATEGORIES,
  checkOdometerReading,
  dayNumber,
  normalizeVin,
  type DistanceUnit,
  type FaultStatus,
  type FuelType,
  type OdometerPoint,
  type ServiceCategory,
} from "@nexus/core";
import { CarNotFoundError, CarValidationError } from "../errors.js";
import { isBareDate, isCurrencyCode, isDateTime, isMinorUnits } from "../finance/money.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** The longest a name, make or model may be. A car is named in a word or two, and the ceiling is the list's own line. */
export const MAX_VEHICLE_NAME_LENGTH = 60;
export const MAX_VEHICLE_MAKE_LENGTH = 60;
export const MAX_VEHICLE_MODEL_LENGTH = 60;
/** Plates are short; 20 covers the longest formats in use and refuses a paragraph typed into the field. */
export const MAX_VEHICLE_PLATE_LENGTH = 20;
export const MAX_VEHICLE_NOTES_LENGTH = 2_000;

/**
 * The ceiling on an odometer reading. Not a semantic limit — a car that has
 * driven a million kilometres still reads six digits — but an untrusted
 * caller's number goes into a column every estimate subtracts, and 10 000 000 is
 * two hundred and fifty times around the Earth. A bound is cheaper than
 * discovering the absence of one (`HabitStore`'s `MAX_HABIT_COUNT` reasoning).
 */
export const MAX_ODOMETER_READING = 10_000_000;

export const MAX_SERVICE_DESCRIPTION_LENGTH = 500;
export const MAX_SERVICE_WORKSHOP_LENGTH = 120;
export const MAX_SERVICE_PARTS_LENGTH = 500;
export const MAX_FAULT_SYMPTOM_LENGTH = 300;
export const MAX_FAULT_FIX_NOTES_LENGTH = 2_000;

/** Interval bounds, both sanity ceilings rather than opinions: a million kilometres and fifty years are past any service schedule a person keeps. */
export const MAX_INTERVAL_KM = 1_000_000;
export const MAX_INTERVAL_MONTHS = 600;

/**
 * The ceiling on one fill, in the vehicle's own quantity unit. The largest car
 * tanks are under 150 L and the largest car batteries under 200 kWh, so 500 is a
 * ceiling nothing legitimate approaches — `MAX_ODOMETER_READING`'s reasoning.
 */
export const MAX_FUEL_QUANTITY = 500;

/** The wire/store cap on one receipt's byte size (SEC-FILE-02). `MAX_TASK_ATTACHMENT_BYTES`' own value, copied rather than reinvented: it is the same blob store on the other side. */
export const MAX_SERVICE_ATTACHMENT_BYTES = 52_428_800; // 50 MB

/**
 * What "due soon" means before the owner says otherwise: a month, or five
 * hundred of the vehicle's own distance units.
 *
 * `DueThresholds` is passed in rather than fixed because the two belong to the
 * owner's appetite, and these are the values a profile that has never opened the
 * settings card answers -- a service interval's own order of magnitude, so the
 * module is useful on the first run and still says nothing on the owner's
 * behalf once they change it.
 */
export const DEFAULT_DUE_SOON_DAYS = 30;
export const DEFAULT_DUE_SOON_DISTANCE = 500;

/** The ceiling on a "due soon" window, in days. Migration 074's `car_settings` says why a year. */
export const MAX_DUE_SOON_DAYS = 365;

const MAX_FILE_NAME_LENGTH = 255;
const MAX_MIME_LENGTH = 100;
const MIME_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Serbian Latin ordering for the vehicle list, on `FIN_COLLATOR`'s terms: plain
 * `"sr"` mis-tailors the Latin digraphs and diacritics, and SQLite's BINARY
 * collation would put „Škoda" after „Toyota".
 */
const CAR_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** One vehicle, as every screen and every engine call reads it. */
export interface Vehicle {
  id: string;
  profileId: string;
  name: string;
  make: string;
  model: string;
  /** The model year. Bounded below by the first automobile and above by next year, which only the store can check (it is handed the clock). */
  year: number;
  plate: string | null;
  /** Canonical upper-case ISO 3779 form, or null. Never lower-case, never a non-VIN. */
  vin: string | null;
  /** Decides whether a fill is litres or kWh — see `fuelQuantityUnit`. */
  fuelType: FuelType;
  /** The unit this vehicle's odometers, intervals and distances are counted in. */
  distanceUnit: DistanceUnit;
  notes: string | null;
  /** When the car was sold or retired. Independent of `deleted_at`: an archived car keeps its whole history. */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateVehicleInput {
  name: string;
  make: string;
  model: string;
  year: number;
  plate?: string | null;
  vin?: string | null;
  fuelType: FuelType;
  distanceUnit: DistanceUnit;
  notes?: string | null;
}

/** A partial patch. An omitted key is left untouched; an explicit `null` clears a nullable field. */
export interface UpdateVehicleFields {
  name?: string;
  make?: string;
  model?: string;
  year?: number;
  plate?: string | null;
  vin?: string | null;
  fuelType?: FuelType;
  distanceUnit?: DistanceUnit;
  notes?: string | null;
}

/**
 * One odometer reading. `segment` is which odometer it came off: 1 for the one
 * the car was built with, and each replacement opens the next. Nothing is ever
 * subtracted across a boundary, and `checkOdometerReading` is what refuses a
 * candidate that would cross it.
 */
export interface OdometerReading {
  id: string;
  vehicleId: string;
  date: string;
  reading: number;
  segment: number;
  createdAt: string;
  updatedAt: string;
}

export interface AddOdometerReadingInput {
  date: string;
  reading: number;
  /** The replaced-odometer override: this reading opens a new segment, so a lower number is legitimate. */
  startsNewSegment?: boolean;
}

/** One service entry. `costMinor` and `currency` are a pair: either both or neither. */
export interface ServiceEntry {
  id: string;
  vehicleId: string;
  date: string;
  /** Absent when nobody wrote the number down — a real case, and one the countdown skips rather than guesses. */
  odometer: number | null;
  category: ServiceCategory;
  description: string;
  /** Money in minor units (FIN's rule), or null. */
  costMinor: number | null;
  currency: string | null;
  workshop: string | null;
  parts: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceInput {
  date: string;
  odometer?: number | null;
  category: ServiceCategory;
  description: string;
  costMinor?: number | null;
  currency?: string | null;
  workshop?: string | null;
  parts?: string | null;
}

export interface UpdateServiceFields {
  date?: string;
  odometer?: number | null;
  category?: ServiceCategory;
  description?: string;
  costMinor?: number | null;
  currency?: string | null;
  workshop?: string | null;
  parts?: string | null;
}

/** One receipt: an index row only, the bytes content-addressed in the blob store `main` owns (migration 074). */
export interface ServiceAttachment {
  id: string;
  serviceId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface AddServiceAttachmentInput {
  fileName: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
}

/** One category's interval for one vehicle. At least one of the two bounds is set; the schema says so as well. */
export interface ServiceInterval {
  id: string;
  vehicleId: string;
  category: ServiceCategory;
  everyKm: number | null;
  everyMonths: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SetServiceIntervalInput {
  everyKm: number | null;
  everyMonths: number | null;
}

/** One fill. The price is one fact in two spellings, and either may be the one the user has. */
export interface FuelEntry {
  id: string;
  vehicleId: string;
  date: string;
  odometer: number | null;
  /** Litres, or kWh for an electric vehicle (`fuelQuantityUnit`). */
  quantity: number;
  fullTank: boolean;
  pricePerUnitMinor: number | null;
  totalMinor: number | null;
  currency: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFuelEntryInput {
  date: string;
  odometer?: number | null;
  quantity: number;
  fullTank: boolean;
  pricePerUnitMinor?: number | null;
  totalMinor?: number | null;
  currency?: string | null;
}

export interface UpdateFuelEntryFields {
  date?: string;
  odometer?: number | null;
  quantity?: number;
  fullTank?: boolean;
  pricePerUnitMinor?: number | null;
  totalMinor?: number | null;
  currency?: string | null;
}

/** One fault, and the service entry that fixed it when there was one. */
export interface Fault {
  id: string;
  vehicleId: string;
  date: string;
  symptom: string;
  status: FaultStatus;
  fixNotes: string | null;
  /** The service entry that fixed it. Must be a live entry of the SAME vehicle. */
  serviceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFaultInput {
  date: string;
  symptom: string;
  status?: FaultStatus;
  fixNotes?: string | null;
  serviceId?: string | null;
}

export interface UpdateFaultFields {
  date?: string;
  symptom?: string;
  status?: FaultStatus;
  fixNotes?: string | null;
  serviceId?: string | null;
}

/**
 * The module's whole data as one versioned plain JSON value, ready for stage 2
 * to put inside the profile archive.
 *
 * **No `profileId` anywhere**, and that is the point: an archive is restored
 * INTO a profile the user picks, so which profile a row belonged to is decided
 * at import rather than carried from wherever it was exported. The ids and the
 * timestamps ARE carried, byte for byte, because every child row's `vehicleId`
 * and a fault's `serviceId` are references to them.
 *
 * Soft-deleted rows are ABSENT: the archive is what the user has, and a deleted
 * row is not something they have any more. Receipts ride with their service
 * entries, so a restored receipt still names the blob it came from.
 */
export interface CarExport {
  readonly version: 1;
  readonly vehicles: readonly Omit<Vehicle, "profileId">[];
  readonly readings: readonly OdometerReading[];
  readonly services: readonly ServiceEntry[];
  readonly serviceAttachments: readonly ServiceAttachment[];
  readonly intervals: readonly ServiceInterval[];
  readonly fuel: readonly FuelEntry[];
  readonly faults: readonly Fault[];
}

/**
 * The module's one preference, as the settings card and `whatIsDue` read it:
 * the two thresholds "due soon" is judged against.
 *
 * Not part of `CarExport`, deliberately -- that value is the store's CONTENT,
 * and this is what the module serialises beside it (the module's own
 * `main/imex.ts` carries both in one archive payload).
 */
export interface CarSettings {
  readonly dueSoonDays: number;
  readonly dueSoonDistance: number;
}

interface VehicleRow {
  id: string;
  profile_id: string;
  name: string;
  make: string;
  model: string;
  year: number;
  plate: string | null;
  vin: string | null;
  fuel_type: string;
  distance_unit: string;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ReadingRow {
  id: string;
  vehicle_id: string;
  reading_date: string;
  reading: number;
  segment: number;
  created_at: string;
  updated_at: string;
}

interface ServiceRow {
  id: string;
  vehicle_id: string;
  service_date: string;
  odometer: number | null;
  category: string;
  description: string;
  cost_minor: number | null;
  currency: string | null;
  workshop: string | null;
  parts: string | null;
  created_at: string;
  updated_at: string;
}

interface AttachmentRow {
  id: string;
  service_id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

interface IntervalRow {
  id: string;
  vehicle_id: string;
  category: string;
  every_km: number | null;
  every_months: number | null;
  created_at: string;
  updated_at: string;
}

interface FuelRow {
  id: string;
  vehicle_id: string;
  fuel_date: string;
  odometer: number | null;
  quantity: number;
  full_tank: number;
  price_per_unit_minor: number | null;
  total_minor: number | null;
  currency: string | null;
  created_at: string;
  updated_at: string;
}

interface FaultRow {
  id: string;
  vehicle_id: string;
  fault_date: string;
  symptom: string;
  status: string;
  fix_notes: string | null;
  service_id: string | null;
  created_at: string;
  updated_at: string;
}

/** The module's one preference row (migration 074's `car_settings`, added with stage 2). */
interface SettingsRow {
  profile_id: string;
  due_soon_days: number;
  due_soon_distance: number;
  updated_at: string;
}

const VEHICLE_COLUMNS =
  "id, profile_id, name, make, model, year, plate, vin, fuel_type, distance_unit, notes, " +
  "archived_at, created_at, updated_at";
const READING_COLUMNS = "id, vehicle_id, reading_date, reading, segment, created_at, updated_at";
const SERVICE_COLUMNS =
  "id, vehicle_id, service_date, odometer, category, description, cost_minor, currency, " +
  "workshop, parts, created_at, updated_at";
const ATTACHMENT_COLUMNS = "id, service_id, file_name, mime, size_bytes, sha256, created_at";
const INTERVAL_COLUMNS = "id, vehicle_id, category, every_km, every_months, created_at, updated_at";
const FUEL_COLUMNS =
  "id, vehicle_id, fuel_date, odometer, quantity, full_tank, price_per_unit_minor, total_minor, " +
  "currency, created_at, updated_at";
const FAULT_COLUMNS =
  "id, vehicle_id, fault_date, symptom, status, fix_notes, service_id, created_at, updated_at";

/**
 * The archive's seven reads, each column aliased by hand.
 *
 * Spelled out rather than built by rewriting `COLUMNS`, because an alias list
 * assembled at runtime is a thing to run before it can be read, and the archive's
 * SELECTs are the two places in this file a wrong column name would be a silent
 * `undefined` rather than an error.
 */
const READING_EXPORT_COLUMNS =
  "r.id, r.vehicle_id, r.reading_date, r.reading, r.segment, r.created_at, r.updated_at";
const SERVICE_EXPORT_COLUMNS =
  "s.id, s.vehicle_id, s.service_date, s.odometer, s.category, s.description, s.cost_minor, " +
  "s.currency, s.workshop, s.parts, s.created_at, s.updated_at";
const ATTACHMENT_EXPORT_COLUMNS =
  "a.id, a.service_id, a.file_name, a.mime, a.size_bytes, a.sha256, a.created_at";
const INTERVAL_EXPORT_COLUMNS =
  "i.id, i.vehicle_id, i.category, i.every_km, i.every_months, i.created_at, i.updated_at";
const FUEL_EXPORT_COLUMNS =
  "f.id, f.vehicle_id, f.fuel_date, f.odometer, f.quantity, f.full_tank, f.price_per_unit_minor, " +
  "f.total_minor, f.currency, f.created_at, f.updated_at";
const FAULT_EXPORT_COLUMNS =
  "t.id, t.vehicle_id, t.fault_date, t.symptom, t.status, t.fix_notes, t.service_id, " +
  "t.created_at, t.updated_at";

/** The tables an import wipes before it writes, children first and never leaning on `ON DELETE CASCADE` (`restoreStore.ts`'s rule). */
const CAR_TABLES = [
  "service_attachments",
  "odometer_readings",
  "service_entries",
  "service_intervals",
  "fuel_entries",
  "faults",
  "vehicles",
] as const;

/**
 * The CAR module's storage for a single profile: vehicles and everything that
 * hangs off one. Construct one per profile and reuse it, over prepared,
 * parameterized statements (SEC-API-03), every value bound, never interpolated.
 *
 * **One gate stands in front of every statement that names a child row:** the
 * vehicle is resolved in THIS profile first (`requireVehicle`), and every child
 * statement is scoped by `vehicle_id` from there. Nothing here can write a row
 * for another profile's car, because nothing here can name one.
 *
 * **An ARCHIVED vehicle is not a missing one.** `requireVehicle` filters on
 * `deleted_at` alone, exactly as `HabitStore.requireHabit` does: archiving a sold
 * car is how its history stays reachable, so the history must stay correctable
 * and its receipts still listable. The soft delete is what takes the car away,
 * and it is reversible — a car thrown away comes back with everything it had,
 * because no delete here touches a child row.
 *
 * **Nothing here computes consumption, an odometer estimate, a due date or a
 * total.** Those are pure and live in `@nexus/core` (`fuelConsumption`,
 * `estimateOdometerForDate`, `whatIsDue`, `vehicleCosts`), and this store's rows
 * are their input as they stand — `carStore.test.ts` pins that by feeding real
 * stored rows to them. What DOES live here is every refusal, because stage 2's
 * IPC layer hands this store untrusted input and a store is never the place that
 * assumes its caller validated anything (SEC-EL-02).
 *
 * `now` is supplied by the caller and validated here — main stamps the clock,
 * the renderer never does.
 */
export class CarStore {
  private readonly insertVehicle: Database.Statement;
  private readonly selectVehicles: Database.Statement;
  private readonly selectVehicleById: Database.Statement;
  private readonly writeVehicle: Database.Statement;
  private readonly markVehicleArchived: Database.Statement;
  private readonly markVehicleUnarchived: Database.Statement;
  private readonly markVehicleDeleted: Database.Statement;
  private readonly markVehicleRestored: Database.Statement;

  private readonly insertReading: Database.Statement;
  private readonly selectReadings: Database.Statement;
  private readonly selectReadingById: Database.Statement;
  private readonly deleteReading: Database.Statement;

  private readonly insertService: Database.Statement;
  private readonly selectServices: Database.Statement;
  private readonly selectServiceById: Database.Statement;
  private readonly writeService: Database.Statement;
  private readonly markServiceDeleted: Database.Statement;
  private readonly markServiceRestored: Database.Statement;
  private readonly selectLiveServiceOfVehicle: Database.Statement;
  private readonly selectLiveServiceById: Database.Statement;

  private readonly insertAttachment: Database.Statement;
  private readonly selectAttachments: Database.Statement;
  private readonly selectAttachmentById: Database.Statement;
  private readonly deleteAttachment: Database.Statement;
  private readonly countAttachmentsBySha: Database.Statement;
  private readonly selectAttachmentMimeBySha: Database.Statement;

  private readonly insertInterval: Database.Statement;
  private readonly upsertInterval: Database.Statement;
  private readonly selectIntervals: Database.Statement;
  private readonly selectIntervalByCategory: Database.Statement;
  private readonly deleteInterval: Database.Statement;

  private readonly insertFuel: Database.Statement;
  private readonly selectFuel: Database.Statement;
  private readonly selectFuelById: Database.Statement;
  private readonly writeFuel: Database.Statement;
  private readonly markFuelDeleted: Database.Statement;
  private readonly markFuelRestored: Database.Statement;

  private readonly insertFault: Database.Statement;
  private readonly selectFaults: Database.Statement;
  private readonly selectFaultsByStatus: Database.Statement;
  private readonly selectFaultById: Database.Statement;
  private readonly writeFault: Database.Statement;
  private readonly markFaultDeleted: Database.Statement;
  private readonly markFaultRestored: Database.Statement;

  private readonly selectSettings: Database.Statement;
  private readonly upsertSettings: Database.Statement;
  private readonly deleteSettings: Database.Statement;

  private readonly exportStatements: Readonly<Record<"vehicles" | "readings" | "services" | "serviceAttachments" | "intervals" | "fuel" | "faults", Database.Statement>>;
  private readonly wipe: readonly Database.Statement[];

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertVehicle = db.prepare(
      `INSERT INTO vehicles
         (id, profile_id, name, make, model, year, plate, vin, fuel_type, distance_unit, notes,
          archived_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectVehicles = db.prepare(
      `SELECT ${VEHICLE_COLUMNS} FROM vehicles WHERE profile_id = ? AND deleted_at IS NULL`,
    );
    // The one gate every mutation and every child write passes: live in THIS
    // profile. Deliberately not filtered on `archived_at` — archiving is a fact
    // about today's garage, never about whether the row is here (migration 074).
    this.selectVehicleById = db.prepare(
      `SELECT ${VEHICLE_COLUMNS} FROM vehicles
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.writeVehicle = db.prepare(
      `UPDATE vehicles
          SET name = ?, make = ?, model = ?, year = ?, plate = ?, vin = ?, fuel_type = ?,
              distance_unit = ?, notes = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markVehicleArchived = db.prepare(
      `UPDATE vehicles SET archived_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL AND archived_at IS NULL`,
    );
    this.markVehicleUnarchived = db.prepare(
      `UPDATE vehicles SET archived_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL AND archived_at IS NOT NULL`,
    );
    this.markVehicleDeleted = db.prepare(
      `UPDATE vehicles SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // Neither archive flag is touched, deliberately: a car thrown away while
    // archived comes back archived, because the archiving was never about
    // whether the row was on screen.
    this.markVehicleRestored = db.prepare(
      `UPDATE vehicles SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );

    this.insertReading = db.prepare(
      `INSERT INTO odometer_readings
         (id, vehicle_id, reading_date, reading, segment, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectReadings = db.prepare(
      `SELECT ${READING_COLUMNS} FROM odometer_readings
        WHERE vehicle_id = ? ORDER BY reading_date, id`,
    );
    this.selectReadingById = db.prepare(
      `SELECT ${READING_COLUMNS} FROM odometer_readings WHERE id = ? AND vehicle_id = ?`,
    );
    this.deleteReading = db.prepare(
      `DELETE FROM odometer_readings WHERE id = ? AND vehicle_id = ?`,
    );

    this.insertService = db.prepare(
      `INSERT INTO service_entries
         (id, vehicle_id, service_date, odometer, category, description, cost_minor, currency,
          workshop, parts, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectServices = db.prepare(
      `SELECT ${SERVICE_COLUMNS} FROM service_entries
        WHERE vehicle_id = ? AND deleted_at IS NULL
        ORDER BY service_date DESC, id DESC`,
    );
    this.selectServiceById = db.prepare(
      `SELECT ${SERVICE_COLUMNS} FROM service_entries
        WHERE id = ? AND vehicle_id = ? AND deleted_at IS NULL`,
    );
    this.writeService = db.prepare(
      `UPDATE service_entries
          SET service_date = ?, odometer = ?, category = ?, description = ?, cost_minor = ?,
              currency = ?, workshop = ?, parts = ?, updated_at = ?
        WHERE id = ? AND vehicle_id = ? AND deleted_at IS NULL`,
    );
    this.markServiceDeleted = db.prepare(
      `UPDATE service_entries SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND vehicle_id = ? AND deleted_at IS NULL`,
    );
    this.markServiceRestored = db.prepare(
      `UPDATE service_entries SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND vehicle_id = ? AND deleted_at IS NOT NULL`,
    );
    this.selectLiveServiceOfVehicle = db.prepare(
      `SELECT id FROM service_entries
        WHERE id = ? AND vehicle_id = ? AND deleted_at IS NULL`,
    );
    // The same gate by service id ALONE, reaching the vehicle through the row
    // itself: a receipt method is handed a service id and no vehicle id, and the
    // join is what keeps it inside this profile.
    this.selectLiveServiceById = db.prepare(
      `SELECT s.id FROM service_entries s
         JOIN vehicles v ON v.id = s.vehicle_id
        WHERE s.id = ? AND v.profile_id = ? AND v.deleted_at IS NULL AND s.deleted_at IS NULL`,
    );

    this.insertAttachment = db.prepare(
      `INSERT INTO service_attachments
         (id, service_id, file_name, mime, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectAttachments = db.prepare(
      `SELECT ${ATTACHMENT_COLUMNS} FROM service_attachments
        WHERE service_id = ? ORDER BY created_at, id`,
    );
    this.selectAttachmentById = db.prepare(
      `SELECT ${ATTACHMENT_COLUMNS} FROM service_attachments WHERE id = ? AND service_id = ?`,
    );
    this.deleteAttachment = db.prepare(
      `DELETE FROM service_attachments WHERE id = ? AND service_id = ?`,
    );
    // Deliberately NOT scoped by profile — see the class doc comment: the blob
    // store is content-addressed across the whole database.
    this.countAttachmentsBySha = db.prepare(
      `SELECT count(*) AS n FROM service_attachments WHERE sha256 = ?`,
    );
    this.selectAttachmentMimeBySha = db.prepare(
      `SELECT mime FROM service_attachments WHERE sha256 = ? LIMIT 1`,
    );

    this.insertInterval = db.prepare(
      `INSERT INTO service_intervals
         (id, vehicle_id, category, every_km, every_months, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    // The conflict target names migration 074's unique index and ONLY it: a
    // second `setInterval` for one category updates the row it carries, while a
    // violated CHECK still throws (which a blanket `INSERT OR IGNORE` would have
    // swallowed). `created_at` stays at the first write's moment: the row is the
    // same interval, corrected.
    this.upsertInterval = db.prepare(
      `INSERT INTO service_intervals
         (id, vehicle_id, category, every_km, every_months, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (vehicle_id, category)
         DO UPDATE SET every_km = excluded.every_km, every_months = excluded.every_months,
                       updated_at = excluded.updated_at`,
    );
    this.selectIntervals = db.prepare(
      `SELECT ${INTERVAL_COLUMNS} FROM service_intervals WHERE vehicle_id = ?`,
    );
    this.selectIntervalByCategory = db.prepare(
      `SELECT ${INTERVAL_COLUMNS} FROM service_intervals WHERE vehicle_id = ? AND category = ?`,
    );
    this.deleteInterval = db.prepare(
      `DELETE FROM service_intervals WHERE vehicle_id = ? AND category = ?`,
    );

    this.insertFuel = db.prepare(
      `INSERT INTO fuel_entries
         (id, vehicle_id, fuel_date, odometer, quantity, full_tank, price_per_unit_minor,
          total_minor, currency, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectFuel = db.prepare(
      `SELECT ${FUEL_COLUMNS} FROM fuel_entries
        WHERE vehicle_id = ? AND deleted_at IS NULL
        ORDER BY fuel_date DESC, id DESC`,
    );
    this.selectFuelById = db.prepare(
      `SELECT ${FUEL_COLUMNS} FROM fuel_entries
        WHERE id = ? AND vehicle_id = ? AND deleted_at IS NULL`,
    );
    this.writeFuel = db.prepare(
      `UPDATE fuel_entries
          SET fuel_date = ?, odometer = ?, quantity = ?, full_tank = ?, price_per_unit_minor = ?,
              total_minor = ?, currency = ?, updated_at = ?
        WHERE id = ? AND vehicle_id = ? AND deleted_at IS NULL`,
    );
    this.markFuelDeleted = db.prepare(
      `UPDATE fuel_entries SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND vehicle_id = ? AND deleted_at IS NULL`,
    );
    this.markFuelRestored = db.prepare(
      `UPDATE fuel_entries SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND vehicle_id = ? AND deleted_at IS NOT NULL`,
    );

    this.insertFault = db.prepare(
      `INSERT INTO faults
         (id, vehicle_id, fault_date, symptom, status, fix_notes, service_id, created_at,
          updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectFaults = db.prepare(
      `SELECT ${FAULT_COLUMNS} FROM faults
        WHERE vehicle_id = ? AND deleted_at IS NULL ORDER BY fault_date DESC, id DESC`,
    );
    this.selectFaultsByStatus = db.prepare(
      `SELECT ${FAULT_COLUMNS} FROM faults
        WHERE vehicle_id = ? AND deleted_at IS NULL AND status = ?
        ORDER BY fault_date DESC, id DESC`,
    );
    this.selectFaultById = db.prepare(
      `SELECT ${FAULT_COLUMNS} FROM faults
        WHERE id = ? AND vehicle_id = ? AND deleted_at IS NULL`,
    );
    this.writeFault = db.prepare(
      `UPDATE faults
          SET fault_date = ?, symptom = ?, status = ?, fix_notes = ?, service_id = ?, updated_at = ?
        WHERE id = ? AND vehicle_id = ? AND deleted_at IS NULL`,
    );
    this.markFaultDeleted = db.prepare(
      `UPDATE faults SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND vehicle_id = ? AND deleted_at IS NULL`,
    );
    this.markFaultRestored = db.prepare(
      `UPDATE faults SET deleted_at = NULL, updated_at = ?
        WHERE id = ? AND vehicle_id = ? AND deleted_at IS NOT NULL`,
    );

    // The archive's seven reads. Every child one joins through `vehicles`, which
    // is both the profile scope and the reason a soft-deleted car's history
    // leaves with it.
    this.exportStatements = {
      vehicles: db.prepare(
        `SELECT ${VEHICLE_COLUMNS} FROM vehicles
          WHERE profile_id = ? AND deleted_at IS NULL`,
      ),
      readings: db.prepare(
        `SELECT ${READING_EXPORT_COLUMNS} FROM odometer_readings r
           JOIN vehicles v ON v.id = r.vehicle_id
          WHERE v.profile_id = ? AND v.deleted_at IS NULL`,
      ),
      services: db.prepare(
        `SELECT ${SERVICE_EXPORT_COLUMNS} FROM service_entries s
           JOIN vehicles v ON v.id = s.vehicle_id
          WHERE v.profile_id = ? AND v.deleted_at IS NULL AND s.deleted_at IS NULL`,
      ),
      serviceAttachments: db.prepare(
        `SELECT ${ATTACHMENT_EXPORT_COLUMNS} FROM service_attachments a
           JOIN service_entries s ON s.id = a.service_id
           JOIN vehicles v ON v.id = s.vehicle_id
          WHERE v.profile_id = ? AND v.deleted_at IS NULL AND s.deleted_at IS NULL`,
      ),
      intervals: db.prepare(
        `SELECT ${INTERVAL_EXPORT_COLUMNS} FROM service_intervals i
           JOIN vehicles v ON v.id = i.vehicle_id
          WHERE v.profile_id = ? AND v.deleted_at IS NULL`,
      ),
      fuel: db.prepare(
        `SELECT ${FUEL_EXPORT_COLUMNS} FROM fuel_entries f
           JOIN vehicles v ON v.id = f.vehicle_id
          WHERE v.profile_id = ? AND v.deleted_at IS NULL AND f.deleted_at IS NULL`,
      ),
      faults: db.prepare(
        `SELECT ${FAULT_EXPORT_COLUMNS} FROM faults t
           JOIN vehicles v ON v.id = t.vehicle_id
          WHERE v.profile_id = ? AND v.deleted_at IS NULL AND t.deleted_at IS NULL`,
      ),
    };

    // Children first, parents last, and never leaning on `ON DELETE CASCADE`
    // (`restoreStore.ts`'s rule). Every statement is scoped through `vehicles`,
    // which is where the profile lives.
    this.selectSettings = db.prepare(
      `SELECT profile_id, due_soon_days, due_soon_distance, updated_at
         FROM car_settings WHERE profile_id = ?`,
    );
    // One row per profile, corrected in place -- `timers_settings`'
    // arrangement, so the two thresholds can never be read half-updated.
    this.upsertSettings = db.prepare(
      `INSERT INTO car_settings (profile_id, due_soon_days, due_soon_distance, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (profile_id)
         DO UPDATE SET due_soon_days = excluded.due_soon_days,
                       due_soon_distance = excluded.due_soon_distance,
                       updated_at = excluded.updated_at`,
    );
    this.deleteSettings = db.prepare("DELETE FROM car_settings WHERE profile_id = ?");

    this.wipe = CAR_TABLES.map((table) => db.prepare(wipeSqlFor(table)));
  }

  /**
   * This profile's live vehicles, sr-Latn alphabetical — ARCHIVED ONES INCLUDED,
   * each carrying its own `archivedAt`. The caller decides what to show (a sold
   * car belongs in a picker and out of today's garage), and a store that had
   * already dropped them could not offer the second view at all.
   */
  listVehicles(): Vehicle[] {
    const rows = this.selectVehicles.all(this.profileId) as VehicleRow[];
    return sortVehicles(rows.map(toVehicle));
  }

  /** Inserts a vehicle and returns the stored row, with the VIN in canonical form. */
  createVehicle(input: CreateVehicleInput, now: string): Vehicle {
    const validNow = validateNow(now);
    const resolved = resolveVehicle(
      {
        name: input.name,
        make: input.make,
        model: input.model,
        year: input.year,
        plate: input.plate ?? null,
        vin: input.vin ?? null,
        fuelType: input.fuelType,
        distanceUnit: input.distanceUnit,
        notes: input.notes ?? null,
      },
      validNow,
    );
    const id = uuidv7();

    this.insertVehicle.run(
      id,
      this.profileId,
      resolved.name,
      resolved.make,
      resolved.model,
      resolved.year,
      resolved.plate,
      resolved.vin,
      resolved.fuelType,
      resolved.distanceUnit,
      resolved.notes,
      null,
      validNow,
      validNow,
    );
    return {
      id,
      profileId: this.profileId,
      ...resolved,
      archivedAt: null,
      createdAt: validNow,
      updatedAt: validNow,
    };
  }

  /**
   * Applies a partial patch to a vehicle that is still here. An ARCHIVED one is
   * edited on exactly these terms — `requireVehicle` filters on `deleted_at`
   * alone, and that is right: being unable to correct the plate of a car you have
   * sold would be a strange thing to enforce.
   */
  updateVehicle(id: string, fields: UpdateVehicleFields, now: string): Vehicle {
    const validNow = validateNow(now);
    const current = this.requireVehicle(id);
    const resolved = resolveVehicle(
      {
        name: fields.name ?? current.name,
        make: fields.make ?? current.make,
        model: fields.model ?? current.model,
        year: fields.year ?? current.year,
        plate: "plate" in fields ? (fields.plate ?? null) : current.plate,
        vin: "vin" in fields ? (fields.vin ?? null) : current.vin,
        fuelType: fields.fuelType ?? current.fuelType,
        distanceUnit: fields.distanceUnit ?? current.distanceUnit,
        notes: "notes" in fields ? (fields.notes ?? null) : current.notes,
      },
      validNow,
    );

    this.writeVehicle.run(
      resolved.name,
      resolved.make,
      resolved.model,
      resolved.year,
      resolved.plate,
      resolved.vin,
      resolved.fuelType,
      resolved.distanceUnit,
      resolved.notes,
      validNow,
      id,
      this.profileId,
    );
    return { ...current, ...resolved, updatedAt: validNow };
  }

  /** Marks a car as one the user no longer owns (sold, scrapped). Its whole history stays, and it stays editable. */
  archiveVehicle(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markVehicleArchived.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new CarNotFoundError(`No current vehicle "${id}" to archive in this profile.`);
    }
  }

  /** Puts an archived car back among the current ones. */
  unarchiveVehicle(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markVehicleUnarchived.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new CarNotFoundError(`No archived vehicle "${id}" to unarchive in this profile.`);
    }
  }

  /** Soft-deletes a car (reversible via `restoreVehicle`). Its history is UNTOUCHED — see the class comment. */
  softDeleteVehicle(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markVehicleDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new CarNotFoundError(`No live vehicle "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted car, with every reading, service, fill and fault it had. */
  restoreVehicle(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markVehicleRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new CarNotFoundError(`No deleted vehicle "${id}" to restore in this profile.`);
    }
  }

  /** This vehicle's odometer readings, oldest first — the order every estimate and every consumption walk wants. */
  listReadings(vehicleId: string): OdometerReading[] {
    this.requireVehicle(vehicleId);
    const rows = this.selectReadings.all(vehicleId) as ReadingRow[];
    return rows.map(toReading);
  }

  /**
   * Records an odometer reading, refusing one that would make the odometer go
   * backwards inside the segment it belongs to.
   *
   * `startsNewSegment` is the user's explicit override for a replaced odometer,
   * and the refusal below NAMES it, because the number is usually right and only
   * its segment is wrong — a message that merely said no would leave the user
   * with nothing to do.
   */
  addReading(vehicleId: string, input: AddOdometerReadingInput, now: string): OdometerReading {
    const validNow = validateNow(now);
    const validDate = validateDay(input.date, "date");
    const reading = validateOdometerReading(input.reading);
    this.requireVehicle(vehicleId);

    const existing = (this.selectReadings.all(vehicleId) as ReadingRow[]).map(toReading);
    const verdict = checkOdometerReading(existing, {
      date: validDate,
      reading,
      startsNewSegment: input.startsNewSegment === true,
    });
    if (!verdict.ok) {
      throw new CarValidationError(
        verdict.reason === "decreases"
          ? `Odometer reading ${reading} on ${validDate} is below the ${verdict.against.reading} ` +
              `of ${verdict.against.date}. Pass "startsNewSegment" when the odometer was replaced.`
          : `A replaced odometer must open at the newest reading, and ${validDate} is behind a ` +
              `reading this vehicle already has.`,
      );
    }

    const id = uuidv7();
    this.insertReading.run(id, vehicleId, validDate, reading, verdict.segment, validNow, validNow);
    return {
      id,
      vehicleId,
      date: validDate,
      reading,
      segment: verdict.segment,
      createdAt: validNow,
      updatedAt: validNow,
    };
  }

  /**
   * Removes a reading. Removing one that is not there is not an error —
   * the caller asked for a row with no reading and that is what stands
   * afterwards — but naming a vehicle this profile does not have still is,
   * because that is a question about somebody else's data.
   */
  removeReading(vehicleId: string, readingId: string): void {
    this.requireVehicle(vehicleId);
    this.deleteReading.run(readingId, vehicleId);
  }

  /** This vehicle's service entries, newest first. */
  listServices(vehicleId: string): ServiceEntry[] {
    this.requireVehicle(vehicleId);
    const rows = this.selectServices.all(vehicleId) as ServiceRow[];
    return rows.map(toService);
  }

  /** Records a service entry, validating every field (SEC-EL-02) and the money as a pair. */
  createService(vehicleId: string, input: CreateServiceInput, now: string): ServiceEntry {
    const validNow = validateNow(now);
    this.requireVehicle(vehicleId);
    const resolved = resolveService({
      date: input.date,
      odometer: input.odometer ?? null,
      category: input.category,
      description: input.description,
      costMinor: input.costMinor ?? null,
      currency: input.currency ?? null,
      workshop: input.workshop ?? null,
      parts: input.parts ?? null,
    });
    const id = uuidv7();

    this.insertService.run(
      id,
      vehicleId,
      resolved.date,
      resolved.odometer,
      resolved.category,
      resolved.description,
      resolved.costMinor,
      resolved.currency,
      resolved.workshop,
      resolved.parts,
      validNow,
      validNow,
    );
    return { id, vehicleId, ...resolved, createdAt: validNow, updatedAt: validNow };
  }

  /** Applies a partial patch to a live service entry. An omitted key is left untouched; an explicit `null` clears a nullable one. */
  updateService(
    vehicleId: string,
    id: string,
    fields: UpdateServiceFields,
    now: string,
  ): ServiceEntry {
    const validNow = validateNow(now);
    this.requireVehicle(vehicleId);
    const current = this.requireService(vehicleId, id);
    const resolved = resolveService({
      date: fields.date ?? current.date,
      odometer: "odometer" in fields ? (fields.odometer ?? null) : current.odometer,
      category: fields.category ?? current.category,
      description: fields.description ?? current.description,
      costMinor: "costMinor" in fields ? (fields.costMinor ?? null) : current.costMinor,
      currency: "currency" in fields ? (fields.currency ?? null) : current.currency,
      workshop: "workshop" in fields ? (fields.workshop ?? null) : current.workshop,
      parts: "parts" in fields ? (fields.parts ?? null) : current.parts,
    });

    this.writeService.run(
      resolved.date,
      resolved.odometer,
      resolved.category,
      resolved.description,
      resolved.costMinor,
      resolved.currency,
      resolved.workshop,
      resolved.parts,
      validNow,
      id,
      vehicleId,
    );
    return { ...current, ...resolved, updatedAt: validNow };
  }

  /** Soft-deletes a service entry (reversible via `restoreService`). Its receipts are untouched. */
  softDeleteService(vehicleId: string, id: string, now: string): void {
    const validNow = validateNow(now);
    this.requireVehicle(vehicleId);
    const { changes } = this.markServiceDeleted.run(validNow, validNow, id, vehicleId);
    if (changes === 0) {
      throw new CarNotFoundError(`No live service entry "${id}" on vehicle "${vehicleId}".`);
    }
  }

  /** Restores a soft-deleted service entry, with every receipt it had. */
  restoreService(vehicleId: string, id: string, now: string): void {
    const validNow = validateNow(now);
    this.requireVehicle(vehicleId);
    const { changes } = this.markServiceRestored.run(validNow, id, vehicleId);
    if (changes === 0) {
      throw new CarNotFoundError(`No deleted service entry "${id}" on vehicle "${vehicleId}".`);
    }
  }

  /** A live service entry's receipts, oldest first (id tiebreak). */
  listServiceAttachments(serviceId: string): ServiceAttachment[] {
    this.requireServiceById(serviceId);
    const rows = this.selectAttachments.all(serviceId) as AttachmentRow[];
    return rows.map(toAttachment);
  }

  /** Adds a receipt to a live service entry, validating every field (SEC-EL-02). The bytes themselves never come here. */
  addServiceAttachment(
    serviceId: string,
    input: AddServiceAttachmentInput,
    now: string,
  ): ServiceAttachment {
    const validNow = validateNow(now);
    this.requireServiceById(serviceId);
    const fileName = validateFileName(input.fileName);
    const mime = validateMime(input.mime);
    const sizeBytes = validateSizeBytes(input.sizeBytes);
    const sha256 = validateSha256(input.sha256);

    const id = uuidv7();
    this.insertAttachment.run(id, serviceId, fileName, mime, sizeBytes, sha256, validNow);
    return { id, serviceId, fileName, mime, sizeBytes, sha256, createdAt: validNow };
  }

  /**
   * Removes one receipt and returns it — the caller (main) uses the returned
   * `sha256` to decide whether the on-disk blob is now orphaned. An id that does
   * not resolve under THIS service throws, because the hash is what a
   * reference-counting caller is about to act on and a silent no-op would hand
   * it nothing to act on.
   */
  removeServiceAttachment(serviceId: string, attachmentId: string): ServiceAttachment {
    this.requireServiceById(serviceId);
    const row = this.selectAttachmentById.get(attachmentId, serviceId) as AttachmentRow | undefined;
    if (!row) {
      throw new CarNotFoundError(`No receipt "${attachmentId}" on service entry "${serviceId}".`);
    }
    this.deleteAttachment.run(attachmentId, serviceId);
    return toAttachment(row);
  }

  /** How many receipt rows (across every profile) name this hash — deliberately profile-agnostic; see the class doc comment. */
  attachmentRefCount(sha256: string): number {
    return (this.countAttachmentsBySha.get(sha256) as { n: number }).n;
  }

  /** Any row's stored mime for this hash (across profiles), or `null` when no receipt names it. */
  attachmentMimeForHash(sha256: string): string | null {
    const row = this.selectAttachmentMimeBySha.get(sha256) as { mime: string } | undefined;
    return row ? row.mime : null;
  }

  /** This vehicle's intervals, in the module's own category order — which is what a picker shows, so the two agree. */
  listIntervals(vehicleId: string): ServiceInterval[] {
    this.requireVehicle(vehicleId);
    const rows = this.selectIntervals.all(vehicleId) as IntervalRow[];
    return rows
      .map(toInterval)
      .sort((left, right) => categoryOrder(left.category) - categoryOrder(right.category));
  }

  /**
   * Sets (or replaces) one category's interval for a vehicle. A TOTAL
   * replacement rather than a patch, because one row IS the whole interval and
   * the form that fills it in sends both fields: passing `everyKm: null` means
   * „no distance bound", which is exactly the statement the omitted-versus-null
   * dance in the other methods cannot express here.
   */
  setInterval(
    vehicleId: string,
    category: ServiceCategory,
    interval: SetServiceIntervalInput,
    now: string,
  ): ServiceInterval {
    const validNow = validateNow(now);
    this.requireVehicle(vehicleId);
    const validCategory = validateCategory(category);
    const everyKm = validateInterval(interval.everyKm, MAX_INTERVAL_KM, "everyKm");
    const everyMonths = validateInterval(interval.everyMonths, MAX_INTERVAL_MONTHS, "everyMonths");
    if (everyKm === null && everyMonths === null) {
      throw new CarValidationError(`An interval needs "everyKm", "everyMonths", or both.`);
    }

    this.upsertInterval.run(
      uuidv7(),
      vehicleId,
      validCategory,
      everyKm,
      everyMonths,
      validNow,
      validNow,
    );
    // Read back rather than reconstructed: on a second write the row keeps the
    // FIRST write's id and `createdAt`, and only the row itself knows them.
    return toInterval(this.selectIntervalByCategory.get(vehicleId, validCategory) as IntervalRow);
  }

  /**
   * Removes one category's interval. Removing one that is not there is done
   * rather than an error (`removeReading`'s rule): a form that switches an
   * interval off and is submitted twice is not a mistake.
   */
  clearInterval(vehicleId: string, category: ServiceCategory): void {
    this.requireVehicle(vehicleId);
    this.deleteInterval.run(vehicleId, validateCategory(category));
  }

  /** This vehicle's fills, newest first. */
  listFuelEntries(vehicleId: string): FuelEntry[] {
    this.requireVehicle(vehicleId);
    const rows = this.selectFuel.all(vehicleId) as FuelRow[];
    return rows.map(toFuel);
  }

  /** Records a fill, with its price in whichever of the two spellings the user has. */
  createFuelEntry(vehicleId: string, input: CreateFuelEntryInput, now: string): FuelEntry {
    const validNow = validateNow(now);
    this.requireVehicle(vehicleId);
    const resolved = resolveFuel({
      date: input.date,
      odometer: input.odometer ?? null,
      quantity: input.quantity,
      fullTank: input.fullTank,
      pricePerUnitMinor: input.pricePerUnitMinor ?? null,
      totalMinor: input.totalMinor ?? null,
      currency: input.currency ?? null,
    });
    const id = uuidv7();

    this.insertFuel.run(
      id,
      vehicleId,
      resolved.date,
      resolved.odometer,
      resolved.quantity,
      resolved.fullTank ? 1 : 0,
      resolved.pricePerUnitMinor,
      resolved.totalMinor,
      resolved.currency,
      validNow,
      validNow,
    );
    return { id, vehicleId, ...resolved, createdAt: validNow, updatedAt: validNow };
  }

  /**
   * Applies a partial patch to a live fill. The pair rule is checked on the
   * MERGED row, so clearing the last price column takes clearing the currency in
   * the same call — which is the caller saying the price is gone, rather than
   * this store inferring it from a `null`.
   */
  updateFuelEntry(
    vehicleId: string,
    id: string,
    fields: UpdateFuelEntryFields,
    now: string,
  ): FuelEntry {
    const validNow = validateNow(now);
    this.requireVehicle(vehicleId);
    const current = this.requireFuel(vehicleId, id);
    const resolved = resolveFuel({
      date: fields.date ?? current.date,
      odometer: "odometer" in fields ? (fields.odometer ?? null) : current.odometer,
      quantity: fields.quantity ?? current.quantity,
      fullTank: fields.fullTank ?? current.fullTank,
      pricePerUnitMinor:
        "pricePerUnitMinor" in fields
          ? (fields.pricePerUnitMinor ?? null)
          : current.pricePerUnitMinor,
      totalMinor: "totalMinor" in fields ? (fields.totalMinor ?? null) : current.totalMinor,
      currency: "currency" in fields ? (fields.currency ?? null) : current.currency,
    });

    this.writeFuel.run(
      resolved.date,
      resolved.odometer,
      resolved.quantity,
      resolved.fullTank ? 1 : 0,
      resolved.pricePerUnitMinor,
      resolved.totalMinor,
      resolved.currency,
      validNow,
      id,
      vehicleId,
    );
    return { ...current, ...resolved, updatedAt: validNow };
  }

  /** Soft-deletes a fill (reversible via `restoreFuelEntry`) — the consumption walk simply stops seeing it. */
  softDeleteFuelEntry(vehicleId: string, id: string, now: string): void {
    const validNow = validateNow(now);
    this.requireVehicle(vehicleId);
    const { changes } = this.markFuelDeleted.run(validNow, validNow, id, vehicleId);
    if (changes === 0) {
      throw new CarNotFoundError(`No live fuel entry "${id}" on vehicle "${vehicleId}".`);
    }
  }

  restoreFuelEntry(vehicleId: string, id: string, now: string): void {
    const validNow = validateNow(now);
    this.requireVehicle(vehicleId);
    const { changes } = this.markFuelRestored.run(validNow, id, vehicleId);
    if (changes === 0) {
      throw new CarNotFoundError(`No deleted fuel entry "${id}" on vehicle "${vehicleId}".`);
    }
  }

  /** This vehicle's faults, newest first, optionally only the open (or only the fixed) ones. */
  listFaults(vehicleId: string, options: { readonly status?: FaultStatus } = {}): Fault[] {
    this.requireVehicle(vehicleId);
    const status = validateStatusFilter(options.status ?? null);
    const rows = (
      status === null
        ? this.selectFaults.all(vehicleId)
        : this.selectFaultsByStatus.all(vehicleId, status)
    ) as FaultRow[];
    return rows.map(toFault);
  }

  /** Records a fault, refusing a link to a service entry that is not a live one of THIS vehicle. */
  createFault(vehicleId: string, input: CreateFaultInput, now: string): Fault {
    const validNow = validateNow(now);
    this.requireVehicle(vehicleId);
    const resolved = resolveFault({
      date: input.date,
      symptom: input.symptom,
      status: input.status ?? "open",
      fixNotes: input.fixNotes ?? null,
      serviceId: input.serviceId ?? null,
    });
    const serviceId = this.resolveFaultLink(vehicleId, resolved.serviceId);
    const id = uuidv7();

    this.insertFault.run(
      id,
      vehicleId,
      resolved.date,
      resolved.symptom,
      resolved.status,
      resolved.fixNotes,
      serviceId,
      validNow,
      validNow,
    );
    return { id, vehicleId, ...resolved, serviceId, createdAt: validNow, updatedAt: validNow };
  }

  updateFault(vehicleId: string, id: string, fields: UpdateFaultFields, now: string): Fault {
    const validNow = validateNow(now);
    this.requireVehicle(vehicleId);
    const current = this.requireFault(vehicleId, id);
    const resolved = resolveFault({
      date: fields.date ?? current.date,
      symptom: fields.symptom ?? current.symptom,
      status: fields.status ?? current.status,
      fixNotes: "fixNotes" in fields ? (fields.fixNotes ?? null) : current.fixNotes,
      serviceId: "serviceId" in fields ? (fields.serviceId ?? null) : current.serviceId,
    });
    const serviceId = this.resolveFaultLink(vehicleId, resolved.serviceId);

    this.writeFault.run(
      resolved.date,
      resolved.symptom,
      resolved.status,
      resolved.fixNotes,
      serviceId,
      validNow,
      id,
      vehicleId,
    );
    return { ...current, ...resolved, serviceId, updatedAt: validNow };
  }

  softDeleteFault(vehicleId: string, id: string, now: string): void {
    const validNow = validateNow(now);
    this.requireVehicle(vehicleId);
    const { changes } = this.markFaultDeleted.run(validNow, validNow, id, vehicleId);
    if (changes === 0) {
      throw new CarNotFoundError(`No live fault "${id}" on vehicle "${vehicleId}".`);
    }
  }

  restoreFault(vehicleId: string, id: string, now: string): void {
    const validNow = validateNow(now);
    this.requireVehicle(vehicleId);
    const { changes } = this.markFaultRestored.run(validNow, id, vehicleId);
    if (changes === 0) {
      throw new CarNotFoundError(`No deleted fault "${id}" on vehicle "${vehicleId}".`);
    }
  }

  // --- Settings -------------------------------------------------------------

  /**
   * The module's one preference: what `whatIsDue` should call "soon".
   *
   * Read from the profile's own row when there is one and from the module's
   * shipped defaults when there is not -- `TimersStore.settings()`'s
   * arrangement, and for its reason: a profile that never opened the settings
   * card answers the same values as one that saved them, so nothing has to
   * write a row to make the module work.
   *
   * These are the OWNER's appetite, exactly as `DueThresholds` says, which is
   * why they are stored at all rather than fixed in `@nexus/core`: "soon" is a
   * judgement about somebody's car and their plans for the month, and the module
   * has no business holding an opinion about it.
   */
  settings(): CarSettings {
    const row = this.selectSettings.get(this.profileId) as SettingsRow | undefined;
    return {
      dueSoonDays: row?.due_soon_days ?? DEFAULT_DUE_SOON_DAYS,
      dueSoonDistance: row?.due_soon_distance ?? DEFAULT_DUE_SOON_DISTANCE,
    };
  }

  /** Writes both thresholds and answers the row as it now stands. */
  setDueThresholds(input: CarSettings, now: string): CarSettings {
    const validNow = validateNow(now);
    const dueSoonDays = validateThreshold(input.dueSoonDays, "dueSoonDays", MAX_DUE_SOON_DAYS);
    const dueSoonDistance = validateThreshold(
      input.dueSoonDistance,
      "dueSoonDistance",
      MAX_INTERVAL_KM,
    );
    this.upsertSettings.run(this.profileId, dueSoonDays, dueSoonDistance, validNow);
    return this.settings();
  }

  /**
   * Drops the preference row, so this profile answers the shipped defaults
   * again.
   *
   * A restore that carries no CAR section has to leave the profile with the
   * module's defaults rather than with whatever the previous profile's owner
   * had chosen -- `TimersStore.replaceFromArchive`'s `null` arm, spelled as its
   * own method because this store's `importData` replaces CONTENT and this is
   * not content: an archive carries the thresholds beside the rows (see
   * `main/imex.ts` in the module), and the two halves are applied by the two
   * methods that own them.
   */
  resetSettings(): void {
    this.deleteSettings.run(this.profileId);
  }

  /**
   * This profile's whole car history as one versioned plain JSON value, ready to
   * be sealed into a profile archive. See `CarExport` for what is left out and
   * why, and `importData` for the other half.
   */
  exportData(): CarExport {
    return {
      version: 1,
      vehicles: sortVehicles(
        (this.exportStatements.vehicles.all(this.profileId) as VehicleRow[]).map(withoutProfile),
      ),
      readings: (this.exportStatements.readings.all(this.profileId) as ReadingRow[]).map(toReading),
      services: (this.exportStatements.services.all(this.profileId) as ServiceRow[]).map(toService),
      serviceAttachments: (
        this.exportStatements.serviceAttachments.all(this.profileId) as AttachmentRow[]
      ).map(toAttachment),
      intervals: (this.exportStatements.intervals.all(this.profileId) as IntervalRow[]).map(
        toInterval,
      ),
      fuel: (this.exportStatements.fuel.all(this.profileId) as FuelRow[]).map(toFuel),
      faults: (this.exportStatements.faults.all(this.profileId) as FaultRow[]).map(toFault),
    };
  }

  /**
   * Replaces this profile's whole car history with a value `exportData` produced
   * (or an archive carrying one), refusing an unknown version.
   *
   * **The WHOLE value is validated before a single row is written**, and that is
   * not politeness: the write is a wipe followed by an insert, so a value
   * rejected halfway through would leave the profile with less car data than it
   * started with. Nothing here trusts the archive either — it is a file that may
   * have been edited, so ids are bounded, every enum, number and date is
   * re-checked through the same validators the live path uses, references are
   * resolved against the value's OWN rows, and readings are re-checked for the
   * one rule a single row cannot state (an odometer that goes backwards inside
   * its segment).
   *
   * A vehicle's year is bounded against the archive's OWN `updatedAt` rather
   * than against a clock this method does not have: the archive records when it
   * was written, and a 2027 model cannot be in an archive written in 2026.
   */
  importData(value: unknown): void {
    const archive = parseCarExport(value, this.profileId);

    this.db.transaction(() => {
      for (const statement of this.wipe) statement.run(this.profileId);
      for (const vehicle of archive.vehicles) {
        this.insertVehicle.run(
          vehicle.id,
          this.profileId,
          vehicle.name,
          vehicle.make,
          vehicle.model,
          vehicle.year,
          vehicle.plate,
          vehicle.vin,
          vehicle.fuelType,
          vehicle.distanceUnit,
          vehicle.notes,
          vehicle.archivedAt,
          vehicle.createdAt,
          vehicle.updatedAt,
        );
      }
      for (const reading of archive.readings) {
        this.insertReading.run(
          reading.id,
          reading.vehicleId,
          reading.date,
          reading.reading,
          reading.segment,
          reading.createdAt,
          reading.updatedAt,
        );
      }
      for (const service of archive.services) {
        this.insertService.run(
          service.id,
          service.vehicleId,
          service.date,
          service.odometer,
          service.category,
          service.description,
          service.costMinor,
          service.currency,
          service.workshop,
          service.parts,
          service.createdAt,
          service.updatedAt,
        );
      }
      for (const attachment of archive.serviceAttachments) {
        this.insertAttachment.run(
          attachment.id,
          attachment.serviceId,
          attachment.fileName,
          attachment.mime,
          attachment.sizeBytes,
          attachment.sha256,
          attachment.createdAt,
        );
      }
      for (const interval of archive.intervals) {
        // A plain INSERT, not the upsert `setInterval` uses: the archive carries
        // one row per (vehicle, category) already, and a second one in a
        // hand-edited file must fail loudly instead of quietly swallowing the
        // first row's id.
        this.insertInterval.run(
          interval.id,
          interval.vehicleId,
          interval.category,
          interval.everyKm,
          interval.everyMonths,
          interval.createdAt,
          interval.updatedAt,
        );
      }
      for (const fill of archive.fuel) {
        this.insertFuel.run(
          fill.id,
          fill.vehicleId,
          fill.date,
          fill.odometer,
          fill.quantity,
          fill.fullTank ? 1 : 0,
          fill.pricePerUnitMinor,
          fill.totalMinor,
          fill.currency,
          fill.createdAt,
          fill.updatedAt,
        );
      }
      for (const fault of archive.faults) {
        this.insertFault.run(
          fault.id,
          fault.vehicleId,
          fault.date,
          fault.symptom,
          fault.status,
          fault.fixNotes,
          fault.serviceId,
          fault.createdAt,
          fault.updatedAt,
        );
      }
    })();
  }

  /** Reads a live vehicle in this profile or throws — the gate every child statement runs first. */
  private requireVehicle(id: string): Vehicle {
    const row = this.selectVehicleById.get(id, this.profileId) as VehicleRow | undefined;
    if (!row) {
      throw new CarNotFoundError(`No live vehicle "${id}" in this profile.`);
    }
    return toVehicle(row);
  }

  /** Reads a live service entry of THIS vehicle or throws — the second gate, for everything that hangs off one. */
  private requireService(vehicleId: string, id: string): ServiceEntry {
    const row = this.selectServiceById.get(id, vehicleId) as ServiceRow | undefined;
    if (!row) {
      throw new CarNotFoundError(`No live service entry "${id}" on vehicle "${vehicleId}".`);
    }
    return toService(row);
  }

  /** A service entry named by id alone; the join through `vehicles` is what keeps it inside this profile. */
  private requireServiceById(id: string): void {
    if (!this.selectLiveServiceById.get(id, this.profileId)) {
      throw new CarNotFoundError(`No live service entry "${id}" in this profile.`);
    }
  }

  private requireFuel(vehicleId: string, id: string): FuelEntry {
    const row = this.selectFuelById.get(id, vehicleId) as FuelRow | undefined;
    if (!row) {
      throw new CarNotFoundError(`No live fuel entry "${id}" on vehicle "${vehicleId}".`);
    }
    return toFuel(row);
  }

  private requireFault(vehicleId: string, id: string): Fault {
    const row = this.selectFaultById.get(id, vehicleId) as FaultRow | undefined;
    if (!row) {
      throw new CarNotFoundError(`No live fault "${id}" on vehicle "${vehicleId}".`);
    }
    return toFault(row);
  }

  /**
   * Confirms a fault's optional service link is a live entry of the SAME
   * vehicle, or throws. A cross-vehicle link would be a dangling reference in
   * every read that resolves it, and no CHECK can hold a sub-query — the same
   * invariant `CircuitStore` guards for a wire's ends (migration 067).
   */
  private resolveFaultLink(vehicleId: string, serviceId: string | null): string | null {
    if (serviceId === null) return null;
    if (!this.selectLiveServiceOfVehicle.get(serviceId, vehicleId)) {
      throw new CarNotFoundError(
        `No live service entry "${serviceId}" on vehicle "${vehicleId}" to link this fault to.`,
      );
    }
    return serviceId;
  }
}

/** The vehicle's own fields, minus the ones the row rather than the caller decides. */
type ResolvedVehicle = Omit<Vehicle, "id" | "profileId" | "archivedAt" | "createdAt" | "updatedAt">;
type ResolvedService = Omit<ServiceEntry, "id" | "vehicleId" | "createdAt" | "updatedAt">;
type ResolvedFuel = Omit<FuelEntry, "id" | "vehicleId" | "createdAt" | "updatedAt">;
type ResolvedFault = Omit<Fault, "id" | "vehicleId" | "createdAt" | "updatedAt">;

/** The wipe statements, children first, every one of them scoped through `vehicles`. */
function wipeSqlFor(table: (typeof CAR_TABLES)[number]): string {
  if (table === "vehicles") return "DELETE FROM vehicles WHERE profile_id = ?";
  if (table === "service_attachments") {
    return `DELETE FROM service_attachments WHERE service_id IN (
              SELECT s.id FROM service_entries s
              JOIN vehicles v ON v.id = s.vehicle_id WHERE v.profile_id = ?)`;
  }
  if (table === "service_entries") {
    return `DELETE FROM service_entries
             WHERE vehicle_id IN (SELECT id FROM vehicles WHERE profile_id = ?)`;
  }
  // Every other child carries `vehicle_id` itself, so the scope needs no join.
  return `DELETE FROM ${table} WHERE vehicle_id IN (SELECT id FROM vehicles WHERE profile_id = ?)`;
}

/**
 * Validates and resolves a whole vehicle — the ONE place every refusal lives, so
 * `createVehicle` and `updateVehicle` cannot drift on what a vehicle is allowed
 * to be.
 */
function resolveVehicle(fields: ResolvedVehicle, now: string): ResolvedVehicle {
  return {
    name: validateBoundedText(fields.name, "name", MAX_VEHICLE_NAME_LENGTH),
    make: validateBoundedText(fields.make, "make", MAX_VEHICLE_MAKE_LENGTH),
    model: validateBoundedText(fields.model, "model", MAX_VEHICLE_MODEL_LENGTH),
    year: validateYear(fields.year, now),
    plate: validateOptionalText(fields.plate, "plate", MAX_VEHICLE_PLATE_LENGTH),
    vin: validateVin(fields.vin),
    fuelType: validateFuelType(fields.fuelType),
    distanceUnit: validateDistanceUnit(fields.distanceUnit),
    notes: validateOptionalText(fields.notes, "notes", MAX_VEHICLE_NOTES_LENGTH),
  };
}

function resolveService(fields: {
  date: string;
  odometer: number | null;
  category: ServiceCategory;
  description: string;
  costMinor: number | null;
  currency: string | null;
  workshop: string | null;
  parts: string | null;
}): ResolvedService {
  const costMinor = validateMoney(fields.costMinor, "costMinor");
  const currency = validateCurrency(fields.currency);
  // Migration 074's pair CHECK, refused here so it is a named domain error
  // rather than a raw constraint failure. REFUSED rather than repaired:
  // clearing a price while leaving its currency behind is an edit the caller got
  // wrong, and silently dropping one half would be this store deciding what they
  // meant (`HabitStore.resolve`'s rule about a unit with no target).
  if ((costMinor === null) !== (currency === null)) {
    throw new CarValidationError(`"costMinor" and "currency" are either both set or both null.`);
  }
  return {
    date: validateDay(fields.date, "date"),
    odometer: validateOdometer(fields.odometer, "odometer"),
    category: validateCategory(fields.category),
    description: validateBoundedText(
      fields.description,
      "description",
      MAX_SERVICE_DESCRIPTION_LENGTH,
    ),
    costMinor,
    currency,
    workshop: validateOptionalText(fields.workshop, "workshop", MAX_SERVICE_WORKSHOP_LENGTH),
    parts: validateOptionalText(fields.parts, "parts", MAX_SERVICE_PARTS_LENGTH),
  };
}

function resolveFuel(fields: {
  date: string;
  odometer: number | null;
  quantity: number;
  fullTank: boolean;
  pricePerUnitMinor: number | null;
  totalMinor: number | null;
  currency: string | null;
}): ResolvedFuel {
  const pricePerUnitMinor = validateMoney(fields.pricePerUnitMinor, "pricePerUnitMinor");
  const totalMinor = validateMoney(fields.totalMinor, "totalMinor");
  const currency = validateCurrency(fields.currency);
  if (pricePerUnitMinor !== null || totalMinor !== null) {
    if (currency === null) {
      throw new CarValidationError(
        `A fill's price needs the "currency" it is in. A fill with no price is recorded with neither.`,
      );
    }
  } else if (currency !== null) {
    throw new CarValidationError(
      `A fill's "currency" belongs beside a "pricePerUnitMinor" or a "totalMinor", and there is neither.`,
    );
  }
  if (typeof fields.fullTank !== "boolean") {
    throw new CarValidationError(`"fullTank" must be a boolean.`);
  }
  return {
    date: validateDay(fields.date, "date"),
    odometer: validateOdometer(fields.odometer, "odometer"),
    quantity: validateQuantity(fields.quantity),
    fullTank: fields.fullTank,
    pricePerUnitMinor,
    totalMinor,
    currency,
  };
}

function resolveFault(fields: {
  date: string;
  symptom: string;
  status: FaultStatus;
  fixNotes: string | null;
  serviceId: string | null;
}): ResolvedFault {
  return {
    date: validateDay(fields.date, "date"),
    symptom: validateBoundedText(fields.symptom, "symptom", MAX_FAULT_SYMPTOM_LENGTH),
    status: validateStatus(fields.status),
    fixNotes: validateOptionalText(fields.fixNotes, "fixNotes", MAX_FAULT_FIX_NOTES_LENGTH),
    serviceId: fields.serviceId === null ? null : validateId(fields.serviceId, "serviceId"),
  };
}

/** `listVehicles`' own order, reused by the export so the archive and the list read alike. Generic over the row, because the archive's rows carry no `profileId`. */
function sortVehicles<T extends { name: string; id: string }>(vehicles: readonly T[]): T[] {
  return [...vehicles].sort(
    (left, right) => CAR_COLLATOR.compare(left.name, right.name) || left.id.localeCompare(right.id),
  );
}

function toVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    make: row.make,
    model: row.model,
    year: row.year,
    plate: row.plate,
    vin: row.vin,
    fuelType: row.fuel_type as FuelType,
    distanceUnit: row.distance_unit as DistanceUnit,
    notes: row.notes,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function withoutProfile(row: VehicleRow): Omit<Vehicle, "profileId"> {
  const { profileId: _profileId, ...rest } = toVehicle(row);
  return rest;
}

function toReading(row: ReadingRow): OdometerReading {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    date: row.reading_date,
    reading: row.reading,
    segment: row.segment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toService(row: ServiceRow): ServiceEntry {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    date: row.service_date,
    odometer: row.odometer,
    category: row.category as ServiceCategory,
    description: row.description,
    costMinor: row.cost_minor,
    currency: row.currency,
    workshop: row.workshop,
    parts: row.parts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAttachment(row: AttachmentRow): ServiceAttachment {
  return {
    id: row.id,
    serviceId: row.service_id,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

function toInterval(row: IntervalRow): ServiceInterval {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    category: row.category as ServiceCategory,
    everyKm: row.every_km,
    everyMonths: row.every_months,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFuel(row: FuelRow): FuelEntry {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    date: row.fuel_date,
    odometer: row.odometer,
    quantity: row.quantity,
    fullTank: row.full_tank === 1,
    pricePerUnitMinor: row.price_per_unit_minor,
    totalMinor: row.total_minor,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFault(row: FaultRow): Fault {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    date: row.fault_date,
    symptom: row.symptom,
    status: row.status as FaultStatus,
    fixNotes: row.fix_notes,
    serviceId: row.service_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Where a category sits in the module's own vocabulary — the picker's order, reused as the list's. */
function categoryOrder(category: ServiceCategory): number {
  return SERVICE_CATEGORIES.indexOf(category);
}

function validateNow(value: string): string {
  if (!isDateTime(value)) {
    throw new CarValidationError(`"now" must be an ISO-8601 date-time.`);
  }
  return value;
}

function validateDay(value: string, field: string): string {
  if (!isBareDate(value)) {
    throw new CarValidationError(`"${field}" must be a real calendar day (YYYY-MM-DD).`);
  }
  return value;
}

/** One "due soon" threshold: a whole number the column's own CHECK accepts, refused by name before SQLite sees it. */
function validateThreshold(value: number, field: string, max: number): number {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new CarValidationError(`"${field}" must be a whole number between 1 and ${max}.`);
  }
  return value;
}

function validateBoundedText(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new CarValidationError(`"${field}" must be 1-${max} characters after trimming.`);
  }
  return trimmed;
}

/** Trims an optional text; absent, empty and whitespace-only all collapse to null, and an over-long one is refused rather than truncated. */
function validateOptionalText(value: string | null, field: string, max: number): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    throw new CarValidationError(`"${field}" must be at most ${max} characters after trimming.`);
  }
  return trimmed;
}

function validateFuelType(value: FuelType): FuelType {
  if (!(FUEL_TYPES as readonly string[]).includes(value)) {
    throw new CarValidationError(`"fuelType" must be one of: ${FUEL_TYPES.join(", ")}.`);
  }
  return value;
}

function validateDistanceUnit(value: DistanceUnit): DistanceUnit {
  if (!(DISTANCE_UNITS as readonly string[]).includes(value)) {
    throw new CarValidationError(`"distanceUnit" must be "km" or "mi".`);
  }
  return value;
}

function validateCategory(value: ServiceCategory): ServiceCategory {
  if (!(SERVICE_CATEGORIES as readonly string[]).includes(value)) {
    throw new CarValidationError(`"category" must be one of: ${SERVICE_CATEGORIES.join(", ")}.`);
  }
  return value;
}

function validateStatus(value: FaultStatus): FaultStatus {
  if (!(FAULT_STATUSES as readonly string[]).includes(value)) {
    throw new CarValidationError(`"status" must be "open" or "fixed".`);
  }
  return value;
}

/** The optional filter `listFaults` takes: absent means every status. */
function validateStatusFilter(value: FaultStatus | null): FaultStatus | null {
  return value === null ? null : validateStatus(value);
}

/**
 * The VIN in canonical form, or a refusal. `normalizeVin` owns the rule —
 * seventeen characters of an alphabet without I, O and Q — and this only turns
 * its `null` into a sentence.
 */
function validateVin(value: string | null): string | null {
  if (value === null) return null;
  const vin = normalizeVin(value);
  if (vin === null) {
    throw new CarValidationError(`"vin" must be 17 characters of A-Z and 0-9, without I, O or Q.`);
  }
  return vin;
}

/**
 * The model year: a whole number from the first automobile to NEXT year, which
 * is the bound a clock-free CHECK cannot state (next year's model is on sale in
 * the year before it, which is why the ceiling is not this year).
 */
function validateYear(value: number, now: string): number {
  if (!Number.isSafeInteger(value) || value < MIN_VEHICLE_YEAR) {
    throw new CarValidationError(
      `"year" must be a whole number no earlier than ${MIN_VEHICLE_YEAR}.`,
    );
  }
  const currentYear = Number(now.slice(0, 4));
  if (value > currentYear + 1) {
    throw new CarValidationError(`"year" must not be later than ${currentYear + 1}.`);
  }
  return value;
}

function validateOdometerReading(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ODOMETER_READING) {
    throw new CarValidationError(
      `"reading" must be a whole number between 0 and ${MAX_ODOMETER_READING}.`,
    );
  }
  return value;
}

function validateOdometer(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ODOMETER_READING) {
    throw new CarValidationError(
      `"${field}" must be a whole number between 0 and ${MAX_ODOMETER_READING}.`,
    );
  }
  return value;
}

function validateQuantity(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_FUEL_QUANTITY) {
    throw new CarValidationError(
      `"quantity" must be a number greater than 0 and at most ${MAX_FUEL_QUANTITY}.`,
    );
  }
  return value;
}

/** Money in minor units (FIN's rule: a safe INTEGER, never a float) or null. Zero is refused — „nothing" is said by null, and a zero in a total draws a bar in the cheapest category. */
function validateMoney(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (!isMinorUnits(value) || value <= 0) {
    throw new CarValidationError(`"${field}" must be a positive whole number of minor units.`);
  }
  return value;
}

function validateCurrency(value: string | null): string | null {
  if (value === null) return null;
  if (!isCurrencyCode(value)) {
    throw new CarValidationError(`"currency" must be a three-letter upper-case ISO-4217 code.`);
  }
  return value;
}

function validateInterval(value: number | null, max: number, field: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new CarValidationError(`"${field}" must be a whole number between 1 and ${max}.`);
  }
  return value;
}

function validateFileName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CarValidationError("A receipt's file name must not be empty.");
  }
  if (trimmed.length > MAX_FILE_NAME_LENGTH) {
    throw new CarValidationError(
      `A receipt's file name must not exceed ${MAX_FILE_NAME_LENGTH} characters after trimming.`,
    );
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new CarValidationError("A receipt's file name must not contain path separators.");
  }
  return trimmed;
}

function validateMime(value: string): string {
  if (value.length > MAX_MIME_LENGTH || !MIME_PATTERN.test(value)) {
    throw new CarValidationError(
      `"mime" must be a valid MIME type of at most ${MAX_MIME_LENGTH} characters.`,
    );
  }
  return value;
}

function validateSizeBytes(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_SERVICE_ATTACHMENT_BYTES) {
    throw new CarValidationError(
      `"sizeBytes" must be a positive integer of at most ${MAX_SERVICE_ATTACHMENT_BYTES} bytes.`,
    );
  }
  return value;
}

function validateSha256(value: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new CarValidationError('"sha256" must be a 64-character lowercase hex string.');
  }
  return value;
}

/** The one bound every id in an archive lives under (`@nexus/core`'s `MAX_ID_LENGTH`, the same rule the archive reader applies). */
function validateId(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new CarValidationError(
      `"${field}" must be a non-empty id of at most ${MAX_ID_LENGTH} characters.`,
    );
  }
  return value;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a value is a bare day this module will store — `validateDay`'s check, usable on an untyped field. */
function isDay(value: unknown): value is string {
  return typeof value === "string" && DAY_PATTERN.test(value) && dayNumber(value) !== null;
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CarValidationError(`${what} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new CarValidationError(`"${field}" must be an array.`);
  }
  return value;
}

function asText(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new CarValidationError(`"${field}" must be a string.`);
  }
  return value;
}

function asNullableText(value: unknown, field: string): string | null {
  return value === null ? null : asText(value, field);
}

function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number") {
    throw new CarValidationError(`"${field}" must be a number.`);
  }
  return value;
}

function asNullableNumber(value: unknown, field: string): number | null {
  return value === null ? null : asNumber(value, field);
}

function asDay(value: unknown, field: string): string {
  if (!isDay(value)) {
    throw new CarValidationError(`"${field}" must be a real calendar day (YYYY-MM-DD).`);
  }
  return value;
}

function asDateTime(value: unknown, field: string): string {
  const text = asText(value, field);
  if (!isDateTime(text)) {
    throw new CarValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return text;
}

/** An optional timestamp's check — `null` stays null, anything else must be an ISO date-time. */
function asNullableDateTime(value: unknown, field: string): string | null {
  return value === null ? null : asDateTime(value, field);
}

/** Every id of one table, checked for shape and for being unique — the identity an import relies on to keep a reference pointing at the same row. */
function collectIds(rows: readonly Record<string, unknown>[], field: string): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const id = validateId(row["id"] as string, field);
    if (ids.has(id)) {
      throw new CarValidationError(`"${field}" carries the id "${id}" twice.`);
    }
    ids.add(id);
  }
  return ids;
}

/**
 * Validates an untrusted archive value WHOLE and returns it as typed rows, or
 * refuses naming the field that is wrong. Nothing is written here: `importData`
 * calls this first and only then opens the transaction, which is what makes a
 * refusal a no-op rather than half an import.
 *
 * Five kinds of check, in the order a reader would ask for them: the version, the
 * shape of each table, each row's own fields (through the same validators the
 * live path uses), the uniqueness of every id, and finally the references —
 * including the one rule a single row cannot state, an odometer that goes
 * backwards inside a segment.
 */
function parseCarExport(
  value: unknown,
  profileId: string,
): {
  vehicles: Vehicle[];
  readings: OdometerReading[];
  services: ServiceEntry[];
  serviceAttachments: ServiceAttachment[];
  intervals: ServiceInterval[];
  fuel: FuelEntry[];
  faults: Fault[];
} {
  const root = asRecord(value, "The car archive");
  if (root["version"] !== 1) {
    throw new CarValidationError(
      `The car archive has version ${String(root["version"])}, which this build does not know.`,
    );
  }

  const vehicleRows = asArray(root["vehicles"], "vehicles").map((row) => asRecord(row, "A vehicle"));
  const readingRows = asArray(root["readings"], "readings").map((row) => asRecord(row, "A reading"));
  const serviceRows = asArray(root["services"], "services").map((row) =>
    asRecord(row, "A service entry"),
  );
  const attachmentRows = asArray(root["serviceAttachments"], "serviceAttachments").map((row) =>
    asRecord(row, "A receipt"),
  );
  const intervalRows = asArray(root["intervals"], "intervals").map((row) =>
    asRecord(row, "An interval"),
  );
  const fuelRows = asArray(root["fuel"], "fuel").map((row) => asRecord(row, "A fuel entry"));
  const faultRows = asArray(root["faults"], "faults").map((row) => asRecord(row, "A fault"));

  const vehicleIds = collectIds(vehicleRows, "vehicles");
  collectIds(readingRows, "readings");
  const serviceIds = collectIds(serviceRows, "services");
  collectIds(attachmentRows, "serviceAttachments");
  collectIds(intervalRows, "intervals");
  collectIds(fuelRows, "fuel");
  collectIds(faultRows, "faults");

  const vehicles = vehicleRows.map((row) => {
    const updatedAt = asDateTime(row["updatedAt"], "updatedAt");
    return {
      id: validateId(row["id"] as string, "id"),
      profileId,
      // The archive's own `updatedAt` is the clock its year bound is checked
      // against: a 2027 model cannot be in an archive written in 2026.
      ...resolveVehicle(
        {
          name: asText(row["name"], "name"),
          make: asText(row["make"], "make"),
          model: asText(row["model"], "model"),
          year: asNumber(row["year"], "year"),
          plate: asNullableText(row["plate"], "plate"),
          vin: asNullableText(row["vin"], "vin"),
          fuelType: asText(row["fuelType"], "fuelType") as FuelType,
          distanceUnit: asText(row["distanceUnit"], "distanceUnit") as DistanceUnit,
          notes: asNullableText(row["notes"], "notes"),
        },
        updatedAt,
      ),
      archivedAt: asNullableDateTime(row["archivedAt"], "archivedAt"),
      createdAt: asDateTime(row["createdAt"], "createdAt"),
      updatedAt,
    };
  });

  const readings = readingRows.map((row) => {
    const vehicleId = validateId(row["vehicleId"] as string, "vehicleId");
    if (!vehicleIds.has(vehicleId)) {
      throw new CarValidationError(
        `A reading names vehicle "${vehicleId}", which the archive does not carry.`,
      );
    }
    const segment = asNumber(row["segment"], "segment");
    if (!Number.isSafeInteger(segment) || segment < 1) {
      throw new CarValidationError(`"segment" must be a whole number of at least 1.`);
    }
    return {
      id: validateId(row["id"] as string, "id"),
      vehicleId,
      date: asDay(row["date"], "date"),
      reading: validateOdometerReading(asNumber(row["reading"], "reading")),
      segment,
      createdAt: asDateTime(row["createdAt"], "createdAt"),
      updatedAt: asDateTime(row["updatedAt"], "updatedAt"),
    };
  });

  // The rule a row cannot state on its own: within one odometer, readings never
  // decrease. A hand-edited archive is the one place a wrong history can enter
  // without passing `addReading`.
  const byVehicleSegment = new Map<string, OdometerPoint[]>();
  for (const reading of readings) {
    const key = `${reading.vehicleId}\u001f${reading.segment}`;
    const bucket = byVehicleSegment.get(key);
    if (bucket === undefined) byVehicleSegment.set(key, [reading]);
    else bucket.push(reading);
  }
  for (const points of byVehicleSegment.values()) {
    const ordered = [...points].sort((left, right) => (left.date < right.date ? -1 : 1));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous !== undefined && current !== undefined && current.reading < previous.reading) {
        throw new CarValidationError(
          `The archive's odometer goes backwards: ${current.reading} on ${current.date} ` +
            `after ${previous.reading} on ${previous.date}, within one segment.`,
        );
      }
    }
  }

  const services = serviceRows.map((row) => {
    const vehicleId = validateId(row["vehicleId"] as string, "vehicleId");
    if (!vehicleIds.has(vehicleId)) {
      throw new CarValidationError(
        `A service entry names vehicle "${vehicleId}", which the archive does not carry.`,
      );
    }
    return {
      id: validateId(row["id"] as string, "id"),
      vehicleId,
      ...resolveService({
        date: asText(row["date"], "date"),
        odometer: asNullableNumber(row["odometer"], "odometer"),
        category: asText(row["category"], "category") as ServiceCategory,
        description: asText(row["description"], "description"),
        costMinor: asNullableNumber(row["costMinor"], "costMinor"),
        currency: asNullableText(row["currency"], "currency"),
        workshop: asNullableText(row["workshop"], "workshop"),
        parts: asNullableText(row["parts"], "parts"),
      }),
      createdAt: asDateTime(row["createdAt"], "createdAt"),
      updatedAt: asDateTime(row["updatedAt"], "updatedAt"),
    };
  });

  const servicesById = new Map(services.map((service) => [service.id, service]));
  const serviceAttachments = attachmentRows.map((row) => {
    const serviceId = validateId(row["serviceId"] as string, "serviceId");
    if (!serviceIds.has(serviceId)) {
      throw new CarValidationError(
        `A receipt names service entry "${serviceId}", which the archive does not carry.`,
      );
    }
    return {
      id: validateId(row["id"] as string, "id"),
      serviceId,
      fileName: validateFileName(asText(row["fileName"], "fileName")),
      mime: validateMime(asText(row["mime"], "mime")),
      sizeBytes: validateSizeBytes(asNumber(row["sizeBytes"], "sizeBytes")),
      sha256: validateSha256(asText(row["sha256"], "sha256")),
      createdAt: asDateTime(row["createdAt"], "createdAt"),
    };
  });

  const intervals = intervalRows.map((row) => {
    const vehicleId = validateId(row["vehicleId"] as string, "vehicleId");
    if (!vehicleIds.has(vehicleId)) {
      throw new CarValidationError(
        `An interval names vehicle "${vehicleId}", which the archive does not carry.`,
      );
    }
    const everyKm = validateInterval(
      asNullableNumber(row["everyKm"], "everyKm"),
      MAX_INTERVAL_KM,
      "everyKm",
    );
    const everyMonths = validateInterval(
      asNullableNumber(row["everyMonths"], "everyMonths"),
      MAX_INTERVAL_MONTHS,
      "everyMonths",
    );
    if (everyKm === null && everyMonths === null) {
      throw new CarValidationError(`An interval needs "everyKm", "everyMonths", or both.`);
    }
    return {
      id: validateId(row["id"] as string, "id"),
      vehicleId,
      category: validateCategory(asText(row["category"], "category") as ServiceCategory),
      everyKm,
      everyMonths,
      createdAt: asDateTime(row["createdAt"], "createdAt"),
      updatedAt: asDateTime(row["updatedAt"], "updatedAt"),
    };
  });

  const fuel = fuelRows.map((row) => {
    const vehicleId = validateId(row["vehicleId"] as string, "vehicleId");
    if (!vehicleIds.has(vehicleId)) {
      throw new CarValidationError(
        `A fuel entry names vehicle "${vehicleId}", which the archive does not carry.`,
      );
    }
    if (typeof row["fullTank"] !== "boolean") {
      throw new CarValidationError(`"fullTank" must be a boolean.`);
    }
    return {
      id: validateId(row["id"] as string, "id"),
      vehicleId,
      ...resolveFuel({
        date: asText(row["date"], "date"),
        odometer: asNullableNumber(row["odometer"], "odometer"),
        quantity: asNumber(row["quantity"], "quantity"),
        fullTank: row["fullTank"],
        pricePerUnitMinor: asNullableNumber(row["pricePerUnitMinor"], "pricePerUnitMinor"),
        totalMinor: asNullableNumber(row["totalMinor"], "totalMinor"),
        currency: asNullableText(row["currency"], "currency"),
      }),
      createdAt: asDateTime(row["createdAt"], "createdAt"),
      updatedAt: asDateTime(row["updatedAt"], "updatedAt"),
    };
  });

  const faults = faultRows.map((row) => {
    const vehicleId = validateId(row["vehicleId"] as string, "vehicleId");
    if (!vehicleIds.has(vehicleId)) {
      throw new CarValidationError(
        `A fault names vehicle "${vehicleId}", which the archive does not carry.`,
      );
    }
    const resolved = resolveFault({
      date: asText(row["date"], "date"),
      symptom: asText(row["symptom"], "symptom"),
      status: asText(row["status"], "status") as FaultStatus,
      fixNotes: asNullableText(row["fixNotes"], "fixNotes"),
      serviceId: asNullableText(row["serviceId"], "serviceId"),
    });
    // A link must resolve to a service entry OF THE SAME VEHICLE — the rule the
    // live path enforces in `resolveFaultLink`, restated here because an archive
    // arrives whole rather than one write at a time.
    if (resolved.serviceId !== null) {
      const service = servicesById.get(resolved.serviceId);
      if (service === undefined || service.vehicleId !== vehicleId) {
        throw new CarValidationError(
          `A fault links service entry "${resolved.serviceId}", which is not one of its own vehicle's.`,
        );
      }
    }
    return {
      id: validateId(row["id"] as string, "id"),
      vehicleId,
      ...resolved,
      createdAt: asDateTime(row["createdAt"], "createdAt"),
      updatedAt: asDateTime(row["updatedAt"], "updatedAt"),
    };
  });

  return { vehicles, readings, services, serviceAttachments, intervals, fuel, faults };
}
