import type {
  CategoryTotal,
  ConsumptionSegment,
  DistanceUnit,
  DueItem,
  FaultStatus,
  FuelType,
  MonthlyTotal,
  OverallConsumption,
  ServiceCategory,
} from "@nexus/core";
import { defineModuleContract, type ModuleApiOf } from "../../../shared/moduleApi.js";

/**
 * CAR's contract (ADR-090): the channels it answers on, the payload each takes,
 * and the API its page calls.
 *
 * **Two result shapes, and the split is the module's own.** A mutation of the
 * GARAGE (a vehicle added, archived or removed; the thresholds saved) answers
 * with `CarView` -- the vehicle list and the settings. A mutation of ONE
 * VEHICLE'S BOOK (a reading, a service, a receipt, an interval, a fill, a fault)
 * answers with `CarDetailView` -- that vehicle's whole history and every figure
 * derived from it. One page draws both, so a single shape would mean shipping
 * every vehicle's whole history on every write, which is the shape „Tajmeri"
 * refused for the same reason one step down: main is the one that reads, and the
 * page renders what main says.
 *
 * **The arithmetic is main's.** `due`, `consumption` and `costs` in the detail
 * are computed in main with `@nexus/core`'s pure engines (`whatIsDue`,
 * `fuelConsumption`, `vehicleCosts`/`totalsByMonth`) over rows main has already
 * read, and cross the wire as finished figures. MAIN IS NOT THE UI THREAD, so a
 * module whose engines are a linear pass over a few dozen rows needs no worker
 * and no second copy of the arithmetic: a worker here would import the same pure
 * functions into a chunk of its own and change nothing about where they run.
 *
 * **A date is a bare local day** (`YYYY-MM-DD`) everywhere on this wire, exactly
 * as the store and the engines define it, and an instant is ISO-8601 with a
 * zone. Money is FIN's: an integer of minor units beside an ISO-4217 code, or
 * both absent, never a decimal.
 */

/**
 * One vehicle as the lists read it. Declared here rather than imported from
 * `@nexus/db`, which is where the row lives: no file under `shared/` may reach
 * that package (it is SQLite and therefore Node-only, and the renderer shares
 * this file). The two shapes are kept in step by `main/register.ts`, which is
 * the only thing that maps one onto the other -- and by the compiler, since the
 * store's row is what it maps FROM.
 *
 * The engine types (`DueItem`, `ConsumptionSegment`, ...) ARE imported from
 * `@nexus/core`: that package is pure, the renderer already depends on it, and
 * re-spelling a figure the engine owns would be the second definition of it.
 */
export interface CarVehicleView {
  readonly id: string;
  readonly name: string;
  readonly make: string;
  readonly model: string;
  readonly year: number;
  readonly plate: string | null;
  /** Canonical ISO 3779 form, or null. */
  readonly vin: string | null;
  readonly fuelType: FuelType;
  /** The unit this vehicle's odometers and distances are counted in. */
  readonly distanceUnit: DistanceUnit;
  readonly notes: string | null;
  /** When the car was sold or retired. Its whole history stays readable. */
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One odometer reading; `segment` is which odometer it came off, so nothing is ever subtracted across a replacement. */
export interface CarReadingView {
  readonly id: string;
  readonly date: string;
  readonly reading: number;
  readonly segment: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One receipt: an index row. The bytes live in main's blob store and never cross this boundary. */
export interface CarReceiptView {
  readonly id: string;
  readonly fileName: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly createdAt: string;
}

/** One service entry with its receipts, which is how the log draws it. */
export interface CarServiceView {
  readonly id: string;
  readonly date: string;
  readonly odometer: number | null;
  readonly category: ServiceCategory;
  readonly description: string;
  readonly costMinor: number | null;
  readonly currency: string | null;
  readonly workshop: string | null;
  readonly parts: string | null;
  readonly receipts: readonly CarReceiptView[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One interval: a distance, a period, or both -- at least one, which the store refuses otherwise. */
export interface CarIntervalView {
  readonly id: string;
  readonly category: ServiceCategory;
  readonly everyKm: number | null;
  readonly everyMonths: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One fill. The price is one fact in two spellings; either may be the one the owner has. */
export interface CarFuelView {
  readonly id: string;
  readonly date: string;
  readonly odometer: number | null;
  /** Litres, or kWh for an electric vehicle (`fuelQuantityUnit`). */
  readonly quantity: number;
  readonly fullTank: boolean;
  readonly pricePerUnitMinor: number | null;
  readonly totalMinor: number | null;
  readonly currency: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One fault, and the service that fixed it when there was one. */
export interface CarFaultView {
  readonly id: string;
  readonly date: string;
  readonly symptom: string;
  readonly status: FaultStatus;
  readonly fixNotes: string | null;
  readonly serviceId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The module's one preference, as the settings card and the due list read it. */
export interface CarSettingsView {
  readonly dueSoonDays: number;
  readonly dueSoonDistance: number;
}

/** The garage: every live vehicle, archived ones included, and the module's preference. */
export interface CarView {
  readonly vehicles: readonly CarVehicleView[];
  readonly settings: CarSettingsView;
}

/** What a fill cost, derived rather than stored -- one per entry, `null` when no price was recorded. */
export interface CarFuelCostView {
  readonly fuelId: string;
  readonly costMinor: number;
  readonly currency: string;
}

/** One vehicle's whole book, with the engines' answers over it. */
export interface CarDetailView {
  readonly vehicle: CarVehicleView;
  readonly readings: readonly CarReadingView[];
  readonly services: readonly CarServiceView[];
  readonly intervals: readonly CarIntervalView[];
  readonly fuel: readonly CarFuelView[];
  readonly faults: readonly CarFaultView[];
  /** Every interval, most urgent first (`whatIsDue`'s own order). */
  readonly due: readonly DueItem[];
  /** Today's odometer as the estimate, or `null` when there is not enough history to fit one. */
  readonly estimatedOdometer: number | null;
  /** Full-tank to full-tank only; a stretch nobody bounded is absent rather than diluted. */
  readonly consumption: {
    readonly segments: readonly ConsumptionSegment[];
    readonly overall: OverallConsumption | null;
  };
  /** What the book cost, by category and by month. A total never crosses currencies. */
  readonly costs: {
    readonly byCategory: readonly CategoryTotal[];
    readonly byMonth: readonly MonthlyTotal[];
    readonly fuel: readonly CarFuelCostView[];
  };
}

/** The one thing due soonest in the whole garage, for the dashboard card and the reminder. */
export interface CarNextDueView {
  readonly vehicleId: string;
  readonly vehicleName: string;
  readonly item: DueItem;
}

/** The outcome of one „attach receipts" dialog. */
export type CarAttachResult =
  | { readonly canceled: true }
  | { readonly canceled: false; readonly added: number; readonly skippedTooLarge: number };

/** A garage mutation's answer: what the attach/remove dialog did, and the book it changed. */
export interface CarReceiptsView {
  readonly result: CarAttachResult;
  readonly detail: CarDetailView;
}

/** One read: whose garage is being asked for. */
interface ListPayload {
  profileId: string;
}

/** One vehicle's whole book. */
interface DetailPayload {
  profileId: string;
  vehicleId: string;
}

/**
 * Everything a vehicle is, as the form fills it.
 *
 * The whole set travels on an UPDATE as well as a create, and that is the honest
 * shape for this wire: the page owns one form that shows every field, so a
 * partial patch would be a second way to write the same row. The store's own
 * `UpdateVehicleFields` remains for callers that need a patch (the archive's
 * half does not: it reproduces rows directly).
 */
interface VehicleFieldsPayload {
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

interface CreateVehiclePayload extends VehicleFieldsPayload {
  profileId: string;
}

interface UpdateVehiclePayload {
  profileId: string;
  id: string;
  fields: VehicleFieldsPayload;
}

/** One row of this module's tables, by its own id and the vehicle it hangs off. The store scopes both. */
interface VehicleRowPayload {
  profileId: string;
  vehicleId: string;
  id: string;
}

/** One VEHICLE by its own id: a garage-level op, which needs no second key because the row IS the vehicle. */
interface VehicleIdPayload {
  profileId: string;
  id: string;
}

interface AddReadingPayload {
  profileId: string;
  vehicleId: string;
  date: string;
  reading: number;
  /** The replaced-odometer override: this reading opens a new segment, so a lower number is legitimate. */
  startsNewSegment?: boolean;
}

/** Everything a service entry is, as the form fills it. Money is the pair or nothing. */
interface ServiceFieldsPayload {
  date: string;
  odometer?: number | null;
  category: ServiceCategory;
  description: string;
  costMinor?: number | null;
  currency?: string | null;
  workshop?: string | null;
  parts?: string | null;
}

interface AddServicePayload extends ServiceFieldsPayload {
  profileId: string;
  vehicleId: string;
}

interface UpdateServicePayload {
  profileId: string;
  vehicleId: string;
  id: string;
  fields: ServiceFieldsPayload;
}

/** One interval's two bounds. At least one is set, which main refuses before the store does. */
interface SetIntervalPayload {
  profileId: string;
  vehicleId: string;
  category: ServiceCategory;
  everyKm: number | null;
  everyMonths: number | null;
}

interface ClearIntervalPayload {
  profileId: string;
  vehicleId: string;
  category: ServiceCategory;
}

interface FuelFieldsPayload {
  date: string;
  odometer?: number | null;
  quantity: number;
  fullTank: boolean;
  pricePerUnitMinor?: number | null;
  totalMinor?: number | null;
  currency?: string | null;
}

interface AddFuelPayload extends FuelFieldsPayload {
  profileId: string;
  vehicleId: string;
}

interface FaultFieldsPayload {
  date: string;
  symptom: string;
  status: FaultStatus;
  fixNotes?: string | null;
  serviceId?: string | null;
}

interface AddFaultPayload extends FaultFieldsPayload {
  profileId: string;
  vehicleId: string;
}

interface UpdateFaultPayload {
  profileId: string;
  vehicleId: string;
  id: string;
  fields: FaultFieldsPayload;
}

/** One receipt, by the service it hangs off. */
interface ReceiptPayload {
  profileId: string;
  vehicleId: string;
  serviceId: string;
  id: string;
}

interface AttachReceiptsPayload {
  profileId: string;
  vehicleId: string;
  serviceId: string;
}

interface ThresholdsPayload {
  profileId: string;
  dueSoonDays: number;
  dueSoonDistance: number;
}

/**
 * The declared ops, as a payload to result map. `ModuleApiOf` turns this into
 * the `nexus.modules.car.*` methods the page calls, and `defineModuleContract`
 * turns the keys into the channels main answers on.
 */
type CarOps = {
  list: { request: ListPayload; response: CarView };
  detail: { request: DetailPayload; response: CarDetailView };
  nextDue: { request: ListPayload; response: CarNextDueView | null };
  createVehicle: { request: CreateVehiclePayload; response: CarView };
  updateVehicle: { request: UpdateVehiclePayload; response: CarView };
  archiveVehicle: { request: VehicleIdPayload; response: CarView };
  unarchiveVehicle: { request: VehicleIdPayload; response: CarView };
  removeVehicle: { request: VehicleIdPayload; response: CarView };
  addReading: { request: AddReadingPayload; response: CarDetailView };
  removeReading: { request: VehicleRowPayload; response: CarDetailView };
  addService: { request: AddServicePayload; response: CarDetailView };
  updateService: { request: UpdateServicePayload; response: CarDetailView };
  removeService: { request: VehicleRowPayload; response: CarDetailView };
  attachReceipts: { request: AttachReceiptsPayload; response: CarReceiptsView };
  removeReceipt: { request: ReceiptPayload; response: CarDetailView };
  setInterval: { request: SetIntervalPayload; response: CarDetailView };
  clearInterval: { request: ClearIntervalPayload; response: CarDetailView };
  addFuel: { request: AddFuelPayload; response: CarDetailView };
  removeFuel: { request: VehicleRowPayload; response: CarDetailView };
  addFault: { request: AddFaultPayload; response: CarDetailView };
  updateFault: { request: UpdateFaultPayload; response: CarDetailView };
  removeFault: { request: VehicleRowPayload; response: CarDetailView };
  setThresholds: { request: ThresholdsPayload; response: CarView };
};

/** This module's renderer API: one method per op, named after the op. */
export type CarApi = ModuleApiOf<CarOps>;

/**
 * The contract the preload builds the bridge from and main refuses foreign ops
 * against. Exported as `contract` because that is the ONE name the kit's globs
 * agree on (`preload/moduleBridge.ts`).
 */
export const contract = defineModuleContract<"car", CarOps>("car", [
  "list",
  "detail",
  "nextDue",
  "createVehicle",
  "updateVehicle",
  "archiveVehicle",
  "unarchiveVehicle",
  "removeVehicle",
  "addReading",
  "removeReading",
  "addService",
  "updateService",
  "removeService",
  "attachReceipts",
  "removeReceipt",
  "setInterval",
  "clearInterval",
  "addFuel",
  "removeFuel",
  "addFault",
  "updateFault",
  "removeFault",
  "setThresholds",
]);

/**
 * The type-level half: this module's API joins `NexusApi.modules` from here,
 * which is what makes `window.nexus.modules.car.list(...)` typed in this
 * module's own page, in the dashboard widget and in the settings card without a
 * line in `shared/ipc.ts`.
 */
declare module "../../../shared/moduleApi.js" {
  interface ModuleApis {
    car: CarApi;
  }
}
