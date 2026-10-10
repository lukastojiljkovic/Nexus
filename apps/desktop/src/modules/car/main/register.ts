import type Database from "better-sqlite3-multiple-ciphers";
import {
  DISTANCE_UNITS,
  FAULT_STATUSES,
  FUEL_TYPES,
  MIN_VEHICLE_YEAR,
  SERVICE_CATEGORIES,
  estimateOdometerForDate,
  fuelConsumption,
  fuelCostMinor,
  normalizeVin,
  totalsByCategory,
  totalsByMonth,
  vehicleCosts,
  whatIsDue,
  type DueItem,
  type ModuleText,
  type ServiceCategory,
} from "@nexus/core";
import {
  CarStore,
  MAX_DUE_SOON_DAYS,
  MAX_FAULT_FIX_NOTES_LENGTH,
  MAX_FAULT_SYMPTOM_LENGTH,
  MAX_FUEL_QUANTITY,
  MAX_INTERVAL_KM,
  MAX_INTERVAL_MONTHS,
  MAX_ODOMETER_READING,
  MAX_SERVICE_ATTACHMENT_BYTES,
  MAX_SERVICE_DESCRIPTION_LENGTH,
  MAX_SERVICE_PARTS_LENGTH,
  MAX_SERVICE_WORKSHOP_LENGTH,
  MAX_VEHICLE_MAKE_LENGTH,
  MAX_VEHICLE_MODEL_LENGTH,
  MAX_VEHICLE_NAME_LENGTH,
  MAX_VEHICLE_NOTES_LENGTH,
  MAX_VEHICLE_PLATE_LENGTH,
  NotificationStore,
  isBareDate,
  isCurrencyCode,
  isMinorUnits,
} from "@nexus/db";
import type { ModuleCall, ModuleHostSurface } from "../../../main/moduleIpc.js";
import {
  contract,
  type CarDetailView,
  type CarFaultView,
  type CarFuelView,
  type CarIntervalView,
  type CarNextDueView,
  type CarReadingView,
  type CarReceiptView,
  type CarReceiptsView,
  type CarServiceView,
  type CarVehicleView,
  type CarView,
} from "../shared/ipc.js";
import {
  buildCarExport,
  emptyCarExport,
  parseCarExportPayload,
  type CarExportPayload,
} from "./imex.js";

/**
 * CAR in the main process (ADR-090): its handlers, its one reminder, and its
 * archive section.
 *
 * **Main computes the module's figures.** Every number the page reads about a
 * vehicle -- what is due, the estimated odometer, the consumption, the totals --
 * is produced here with `@nexus/core`'s pure engines over rows this process has
 * just read, and crosses the wire finished. Main is not the UI thread, the
 * engines are one linear pass over a few dozen rows, and a worker would import
 * the same pure functions into a chunk of its own while changing nothing about
 * where they run. The renderer formats; it does not calculate.
 *
 * **Why main owns the reminder.** A due date arrives whether or not the page is
 * open, so something that outlives the page has to notice, and the only process
 * that does is this one: the same argument „Tajmeri" records for a countdown. One
 * timer per profile is armed through `ctx.armUntil` -- the host owns its
 * lifetime, so a locked profile's timer cannot survive the session that armed
 * it -- and it fires at the house's own day-granular instant, the profile's
 * `morningHour` (`@nexus/core`'s `notificationEngine` states that rule for every
 * day-granular source, from the scheduler this module deliberately does NOT join:
 * a `NotificationSource` is a global vocabulary and a kit module may not widen
 * it without editing the shell's tables and the scheduler's tests).
 *
 * **What is not reminded, and why.** A deadline measured in KILOMETRES has no
 * instant to fire at. It is shown on the page, in the due list, and in the
 * dashboard card; only the calendar half of an interval can be announced, and
 * pretending otherwise would mean inventing a date from a distance.
 *
 * **Nothing here computes arithmetic of its own.** Every state change is a store
 * method; the only arithmetic in this file is which day it is locally, which is
 * the one fact a clock is needed for.
 */

/** The heading a due reminder is announced under. The body names the car and the interval. */
const SERVICE_DUE: ModuleText = {
  sr: "Servis je dospeo",
  en: "A service is due",
};

/**
 * The two words each interval has in main's own language, for the reminder body
 * only.
 *
 * The page has its own copy table (`renderer/copy.sr.ts`), which is the right
 * place for everything a user reads on a screen -- but a notification is
 * composed by MAIN, at an hour when no renderer may exist, so the words it needs
 * live here, beside the code that uses them. Both locales in one record, which
 * is the shape the manifest uses for the same reason.
 */
const CATEGORY_TEXT: Readonly<Record<ServiceCategory, ModuleText>> = {
  oil: { sr: "Ulje", en: "Oil" },
  filters: { sr: "Filteri", en: "Filters" },
  tyres: { sr: "Gume", en: "Tyres" },
  brakes: { sr: "Kočnice", en: "Brakes" },
  battery: { sr: "Akumulator", en: "Battery" },
  "timing-belt": { sr: "Zupčasti kaiš", en: "Timing belt" },
  inspection: { sr: "Tehnički pregled", en: "Technical inspection" },
  registration: { sr: "Registracija", en: "Registration" },
  repair: { sr: "Popravka", en: "Repair" },
  other: { sr: "Ostalo", en: "Other" },
};

/**
 * Something that can open this module's store for a profile: the shape a
 * handler's `ModuleCall` and a session both have, so the code below is one
 * implementation rather than two that drift.
 */
interface StoreBearer {
  profileDb<T>(profileId: string, open: (db: Database.Database, profileId: string) => T): T;
}

/** What every validator helper below needs: the kit's shared payload validators and nothing else — the call object minus its store, clock and blob half. */
type ValidatorCall = Pick<ModuleCall, "as">;

/** The bearer that also has a clock -- what the handful of places needing "today" are handed. */
interface ClockBearer extends StoreBearer {
  now(): number;
}

/** One reminder main is holding for a profile, and how to stop it. */
interface ArmedReminder {
  cancel: () => void;
}

export function register(host: ModuleHostSurface): void {
  const ctx = host.adopt(contract);

  /** Every profile's armed reminder, by profile id -- module state, because it outlives the call that armed it. */
  const armed = new Map<string, ArmedReminder>();

  /**
   * The due dates already announced in THIS session, by
   * `profile|vehicle|category|date`.
   *
   * Without it, a session that re-arms on every write would announce the same
   * overdue interval again after each one: the due date of an unserviced
   * interval does not move, so "arm for it once more" is the same instant every
   * time. One announcement per due date per session is what a service book owes
   * -- and the set is cleared when the session ends, so the next launch says it
   * once again rather than never again.
   */
  const announced = new Set<string>();

  function carStore(bearer: StoreBearer, profileId: string): CarStore {
    return bearer.profileDb(profileId, (db, id) => new CarStore(db, id));
  }

  // --- Views ----------------------------------------------------------------

  /** The store's vehicle row as the wire declares it. One mapping, so a renamed column is a compile error here rather than `undefined` in the renderer. */
  function vehicleView(vehicle: {
    id: string;
    name: string;
    make: string;
    model: string;
    year: number;
    plate: string | null;
    vin: string | null;
    fuelType: CarVehicleView["fuelType"];
    distanceUnit: CarVehicleView["distanceUnit"];
    notes: string | null;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }): CarVehicleView {
    return {
      id: vehicle.id,
      name: vehicle.name,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      plate: vehicle.plate,
      vin: vehicle.vin,
      fuelType: vehicle.fuelType,
      distanceUnit: vehicle.distanceUnit,
      notes: vehicle.notes,
      archivedAt: vehicle.archivedAt,
      createdAt: vehicle.createdAt,
      updatedAt: vehicle.updatedAt,
    };
  }

  /** The garage: the vehicles and the preference, read in one place. */
  function garageView(bearer: StoreBearer, profileId: string): CarView {
    const store = carStore(bearer, profileId);
    return {
      vehicles: store.listVehicles().map(vehicleView),
      settings: store.settings(),
    };
  }

  /** The local calendar day main's clock says it is. The only clock read in this file, and the renderer's own `localTodayKey` spells the same rule. */
  function today(bearer: ClockBearer): string {
    const now = new Date(bearer.now());
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${String(now.getFullYear()).padStart(4, "0")}-${month}-${day}`;
  }

  /**
   * One vehicle's whole book, with every derived figure -- the read the page
   * draws and the read every vehicle-level mutation answers with.
   */
  function detailView(bearer: ClockBearer, profileId: string, vehicleId: string): CarDetailView {
    const store = carStore(bearer, profileId);
    // The store's own gate: a vehicle of another profile (or a deleted one) is
    // not found, and the child reads below would answer an empty book for it.
    const vehicle = store.listVehicles().find((row) => row.id === vehicleId);
    if (vehicle === undefined) {
      throw new Error(`No live vehicle "${vehicleId}" in this profile.`);
    }

    const readings: CarReadingView[] = store.listReadings(vehicleId).map((reading) => ({
      id: reading.id,
      date: reading.date,
      reading: reading.reading,
      segment: reading.segment,
      createdAt: reading.createdAt,
      updatedAt: reading.updatedAt,
    }));
    const services: CarServiceView[] = store.listServices(vehicleId).map((service) => ({
      id: service.id,
      date: service.date,
      odometer: service.odometer,
      category: service.category,
      description: service.description,
      costMinor: service.costMinor,
      currency: service.currency,
      workshop: service.workshop,
      parts: service.parts,
      receipts: store.listServiceAttachments(service.id).map(receiptView),
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
    }));
    const intervals: CarIntervalView[] = store.listIntervals(vehicleId).map((interval) => ({
      id: interval.id,
      category: interval.category,
      everyKm: interval.everyKm,
      everyMonths: interval.everyMonths,
      createdAt: interval.createdAt,
      updatedAt: interval.updatedAt,
    }));
    const fuel: CarFuelView[] = store.listFuelEntries(vehicleId).map((entry) => ({
      id: entry.id,
      date: entry.date,
      odometer: entry.odometer,
      quantity: entry.quantity,
      fullTank: entry.fullTank,
      pricePerUnitMinor: entry.pricePerUnitMinor,
      totalMinor: entry.totalMinor,
      currency: entry.currency,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));
    const faults: CarFaultView[] = store.listFaults(vehicleId).map((fault) => ({
      id: fault.id,
      date: fault.date,
      symptom: fault.symptom,
      status: fault.status,
      fixNotes: fault.fixNotes,
      serviceId: fault.serviceId,
      createdAt: fault.createdAt,
      updatedAt: fault.updatedAt,
    }));

    const dayKey = today(bearer);
    const points = readings.map((reading) => ({
      date: reading.date,
      reading: reading.reading,
      segment: reading.segment,
    }));
    const estimatedOdometer = estimateOdometerForDate(points, dayKey);
    const settings = store.settings();
    const due = whatIsDue({
      intervals: intervals.map((interval) => ({
        category: interval.category,
        everyKm: interval.everyKm,
        everyMonths: interval.everyMonths,
      })),
      services: services.map((service) => ({
        category: service.category,
        date: service.date,
        odometer: service.odometer,
      })),
      today: dayKey,
      estimatedOdometer,
      thresholds: { days: settings.dueSoonDays, distance: settings.dueSoonDistance },
    });

    const consumption = fuelConsumption(
      fuel.map((entry) => ({
        date: entry.date,
        quantity: entry.quantity,
        odometer: entry.odometer,
        fullTank: entry.fullTank,
      })),
      vehicle.distanceUnit,
      // The dates a new odometer began, taken from the readings themselves:
      // nothing else in the profile knows where the old one stopped.
      { segmentStarts: readings.filter((reading) => reading.segment > 1).map((r) => r.date) },
    );

    const costs = vehicleCosts(
      services.map((service) => ({
        date: service.date,
        category: service.category,
        costMinor: service.costMinor,
        currency: service.currency,
      })),
      fuel.map((entry) => ({
        date: entry.date,
        quantity: entry.quantity,
        currency: entry.currency,
        pricePerUnitMinor: entry.pricePerUnitMinor,
        totalMinor: entry.totalMinor,
      })),
    );

    return {
      vehicle: vehicleView(vehicle),
      readings,
      services,
      intervals,
      fuel,
      faults,
      due,
      estimatedOdometer,
      consumption: { segments: consumption.segments, overall: consumption.overall },
      costs: {
        byCategory: totalsByCategory(costs),
        byMonth: totalsByMonth(costs),
        // The derived cost of each FILL, so the page's own list can show what
        // each one cost without repeating `fuelCostMinor`'s rounding rule.
        fuel: fuel.flatMap((entry) => {
          const costMinor = entry.currency === null ? null : fuelCostMinor(entry);
          return costMinor === null || entry.currency === null
            ? []
            : [{ fuelId: entry.id, costMinor, currency: entry.currency }];
        }),
      },
    };
  }

  function receiptView(receipt: {
    id: string;
    fileName: string;
    mime: string;
    sizeBytes: number;
    sha256: string;
    createdAt: string;
  }): CarReceiptView {
    return {
      id: receipt.id,
      fileName: receipt.fileName,
      mime: receipt.mime,
      sizeBytes: receipt.sizeBytes,
      sha256: receipt.sha256,
      createdAt: receipt.createdAt,
    };
  }

  /**
   * Every DATED deadline in the garage, most urgent first, one row per (vehicle,
   * interval).
   *
   * **Archived vehicles are skipped, and that is a decision.** A car somebody has
   * sold is not a car whose oil is due: its history stays readable on the page,
   * which is what archiving is for, but no deadline of it is "next".
   *
   * **Only dated items are here, and that is the other decision.** A deadline
   * measured in kilometres has no instant to be next AT, so it is shown in the
   * due list and never claimed as "the next thing" -- inventing a date from a
   * distance is the one thing this module refuses to do anywhere.
   *
   * `whatIsDue` already orders each VEHICLE's own list. Ordering across vehicles
   * is the comparison that engine cannot make, because it never sees two
   * vehicles at once: a worse state first, then the earlier date, then the name
   * and category, so the order is total rather than merely deterministic.
   */
  function dueCandidates(bearer: ClockBearer, profileId: string): CarNextDueView[] {
    const store = carStore(bearer, profileId);
    const dayKey = today(bearer);
    const thresholds = store.settings();
    const found: CarNextDueView[] = [];
    for (const vehicle of store.listVehicles()) {
      if (vehicle.archivedAt !== null) continue;
      const readings = store.listReadings(vehicle.id).map((reading) => ({
        date: reading.date,
        reading: reading.reading,
        segment: reading.segment,
      }));
      const due = whatIsDue({
        intervals: store.listIntervals(vehicle.id),
        services: store.listServices(vehicle.id).map((service) => ({
          category: service.category,
          date: service.date,
          odometer: service.odometer,
        })),
        today: dayKey,
        estimatedOdometer: estimateOdometerForDate(readings, dayKey),
        thresholds: { days: thresholds.dueSoonDays, distance: thresholds.dueSoonDistance },
      });
      for (const item of due) {
        if (item.dueDate === null) continue;
        found.push({ vehicleId: vehicle.id, vehicleName: vehicle.name, item });
      }
    }
    return found.sort(compareDue);
  }

  /** The dashboard card's read: the one dated deadline the whole garage owes next, or `null` when none is dated. */
  function nextDueView(bearer: ClockBearer, profileId: string): CarNextDueView | null {
    return dueCandidates(bearer, profileId)[0] ?? null;
  }

  /** A worse state wins; then the earlier date; then the vehicle and category, so two cars' identical deadlines have one order. */
  function compareDue(left: CarNextDueView, right: CarNextDueView): number {
    const rank = (item: DueItem): number =>
      item.status === "overdue" ? 2 : item.status === "soon" ? 1 : 0;
    if (rank(left.item) !== rank(right.item)) return rank(right.item) - rank(left.item);
    const leftDate = left.item.dueDate ?? "";
    const rightDate = right.item.dueDate ?? "";
    if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
    if (left.vehicleName !== right.vehicleName) {
      return left.vehicleName < right.vehicleName ? -1 : 1;
    }
    return left.item.category < right.item.category
      ? -1
      : left.item.category > right.item.category
        ? 1
        : 0;
  }

  // --- The reminder ---------------------------------------------------------

  /**
   * The instant the next dated deadline should be announced at, and what to say
   * about it: the profile's own morning hour on that local day.
   *
   * `morningHour` comes from the notification settings the shell already keeps
   * (`ntf_settings`, migration 028): it is the house's answer to "when in the day
   * does a day-granular thing speak", it defaults to 08:00, and a module that
   * invented an hour of its own would be a second opinion about somebody's
   * morning.
   *
   * The first candidate this SESSION has not already spoken about wins, which is
   * what makes two intervals on one car both get announced rather than the same
   * one twice: it is the date, not the interval, that is announced once.
   */
  function reminderAt(
    bearer: ClockBearer,
    profileId: string,
  ): { atMs: number; body: ModuleText; key: string } | null {
    const next = dueCandidates(bearer, profileId).find(
      (candidate) => !announced.has(`${profileId}|${candidateKey(candidate)}`),
    );
    if (next === undefined || next.item.dueDate === null) return null;
    const morning = bearer.profileDb(
      profileId,
      (db, id) => new NotificationStore(db, id).getSettings().morningHour,
    );
    const atMs = Date.parse(`${next.item.dueDate}T${morning}:00`);
    if (Number.isNaN(atMs)) return null;
    const label = CATEGORY_TEXT[next.item.category];
    return {
      atMs,
      body: { sr: `${next.vehicleName} — ${label.sr}`, en: `${next.vehicleName} — ${label.en}` },
      key: candidateKey(next),
    };
  }

  /** What one deadline is called, whoever is asking: the vehicle, the interval and the day it falls on. */
  function candidateKey(candidate: CarNextDueView): string {
    return `${candidate.vehicleId}|${candidate.item.category}|${candidate.item.dueDate}`;
  }

  /**
   * Makes main's reminder for one profile match its book: one timer, at the next
   * dated deadline, replaced on every write. Called after a mutation and once per
   * profile when a session opens, which are the two moments the answer can move.
   */
  function rearm(bearer: ClockBearer, profileId: string): void {
    armed.get(profileId)?.cancel();
    armed.delete(profileId);
    const next = reminderAt(bearer, profileId);
    if (next === null) return;
    const entry: ArmedReminder = { cancel: () => undefined };
    armed.set(profileId, entry);
    entry.cancel = ctx.armUntil(next.atMs, () => {
      armed.delete(profileId);
      const key = `${profileId}|${next.key}`;
      // The instant may have arrived while the app was closed, and it may be a
      // deadline this session already spoke about; `armUntil` fires a passed
      // instant at once, which is exactly the case open here.
      if (announced.has(key)) return;
      announced.add(key);
      ctx.notify({ title: SERVICE_DUE, body: next.body });
      // The book has not changed, so the deadline after this one has to be armed
      // now: `reminderAt` answers the first candidate this session has not
      // announced, and the one just announced is now recorded.
      rearm(bearer, profileId);
    });
  }

  /** What every garage-level mutation answers with, and what every one of them re-arms. */
  function changedGarage(bearer: ClockBearer, profileId: string): CarView {
    const view = garageView(bearer, profileId);
    rearm(bearer, profileId);
    return view;
  }

  /** What every vehicle-level mutation answers with. */
  function changedDetail(bearer: ClockBearer, profileId: string, vehicleId: string): CarDetailView {
    const view = detailView(bearer, profileId, vehicleId);
    rearm(bearer, profileId);
    return view;
  }

  // --- Handlers -------------------------------------------------------------

  ctx.handle("list", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return garageView(call, profileId);
  });

  ctx.handle("detail", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    return detailView(call, profileId, vehicleId);
  });

  ctx.handle("nextDue", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    return nextDueView(call, profileId);
  });

  ctx.handle("createVehicle", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    carStore(call, profileId).createVehicle(vehicleFields(call, payload), instant(call.now()));
    return changedGarage(call, profileId);
  });

  ctx.handle("updateVehicle", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    carStore(call, profileId).updateVehicle(
      call.as.asId(payload.id, "id"),
      vehicleFields(call, payload.fields),
      instant(call.now()),
    );
    return changedGarage(call, profileId);
  });

  ctx.handle("archiveVehicle", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    carStore(call, profileId).archiveVehicle(call.as.asId(payload.id, "id"), instant(call.now()));
    return changedGarage(call, profileId);
  });

  ctx.handle("unarchiveVehicle", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    carStore(call, profileId).unarchiveVehicle(call.as.asId(payload.id, "id"), instant(call.now()));
    return changedGarage(call, profileId);
  });

  ctx.handle("removeVehicle", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    carStore(call, profileId).softDeleteVehicle(
      call.as.asId(payload.id, "id"),
      instant(call.now()),
    );
    return changedGarage(call, profileId);
  });

  ctx.handle("addReading", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    carStore(call, profileId).addReading(
      vehicleId,
      {
        date: day(call, payload.date, "date"),
        reading: call.as.asBoundedInteger(payload.reading, "reading", 0, MAX_ODOMETER_READING),
        startsNewSegment: optionalBoolean(call, payload.startsNewSegment, "startsNewSegment"),
      },
      instant(call.now()),
    );
    return changedDetail(call, profileId, vehicleId);
  });

  ctx.handle("removeReading", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    carStore(call, profileId).removeReading(vehicleId, call.as.asId(payload.id, "id"));
    return changedDetail(call, profileId, vehicleId);
  });

  ctx.handle("addService", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    carStore(call, profileId).createService(
      vehicleId,
      serviceFields(call, payload),
      instant(call.now()),
    );
    return changedDetail(call, profileId, vehicleId);
  });

  ctx.handle("updateService", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    carStore(call, profileId).updateService(
      vehicleId,
      call.as.asId(payload.id, "id"),
      serviceFields(call, payload.fields),
      instant(call.now()),
    );
    return changedDetail(call, profileId, vehicleId);
  });

  ctx.handle("removeService", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    carStore(call, profileId).softDeleteService(
      vehicleId,
      call.as.asId(payload.id, "id"),
      instant(call.now()),
    );
    return changedDetail(call, profileId, vehicleId);
  });

  ctx.handle("attachReceipts", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    const serviceId = call.as.asId(payload.serviceId, "serviceId");
    const store = carStore(call, profileId);
    // Refuses a service of another profile (or a deleted one) BEFORE the dialog
    // opens: a pick that could not be recorded must not cost the user a file
    // choice. `addServiceAttachment` would refuse it too, but only after the
    // dialog had taken its answer.
    if (!store.listServices(vehicleId).some((service) => service.id === serviceId)) {
      throw new Error(`No live service entry "${serviceId}" on vehicle "${vehicleId}".`);
    }
    const result = await call.attachFiles(MAX_SERVICE_ATTACHMENT_BYTES, (file) => {
      store.addServiceAttachment(serviceId, file, instant(call.now()));
    });
    const detail = detailView(call, profileId, vehicleId);
    const answer: CarReceiptsView = { result, detail };
    return answer;
  });

  ctx.handle("removeReceipt", async (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    const serviceId = call.as.asId(payload.serviceId, "serviceId");
    const removed = carStore(call, profileId).removeServiceAttachment(
      serviceId,
      call.as.asId(payload.id, "id"),
    );
    // The row is gone first, and the count the release consults is main's: a
    // blob another row still names survives (`attachFiles`'s own arrangement).
    await call.releaseBlob(removed.sha256);
    return changedDetail(call, profileId, vehicleId);
  });

  ctx.handle("setInterval", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    const everyKm = nullableBound(call, payload.everyKm, "everyKm", MAX_INTERVAL_KM);
    const everyMonths = nullableBound(
      call,
      payload.everyMonths,
      "everyMonths",
      MAX_INTERVAL_MONTHS,
    );
    if (everyKm === null && everyMonths === null) {
      throw new Error(
        'Invalid IPC payload: an interval needs "everyKm", "everyMonths", or both.',
      );
    }
    carStore(call, profileId).setInterval(
      vehicleId,
      oneOf(call, payload.category, "category", SERVICE_CATEGORIES),
      { everyKm, everyMonths },
      instant(call.now()),
    );
    return changedDetail(call, profileId, vehicleId);
  });

  ctx.handle("clearInterval", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    carStore(call, profileId).clearInterval(
      vehicleId,
      oneOf(call, payload.category, "category", SERVICE_CATEGORIES),
    );
    return changedDetail(call, profileId, vehicleId);
  });

  ctx.handle("addFuel", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    carStore(call, profileId).createFuelEntry(
      vehicleId,
      fuelFields(call, payload),
      instant(call.now()),
    );
    return changedDetail(call, profileId, vehicleId);
  });

  ctx.handle("removeFuel", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    carStore(call, profileId).softDeleteFuelEntry(
      vehicleId,
      call.as.asId(payload.id, "id"),
      instant(call.now()),
    );
    return changedDetail(call, profileId, vehicleId);
  });

  ctx.handle("addFault", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    carStore(call, profileId).createFault(
      vehicleId,
      faultFields(call, payload),
      instant(call.now()),
    );
    return changedDetail(call, profileId, vehicleId);
  });

  ctx.handle("updateFault", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    carStore(call, profileId).updateFault(
      vehicleId,
      call.as.asId(payload.id, "id"),
      faultFields(call, payload.fields),
      instant(call.now()),
    );
    return changedDetail(call, profileId, vehicleId);
  });

  ctx.handle("removeFault", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    const vehicleId = call.as.asId(payload.vehicleId, "vehicleId");
    carStore(call, profileId).softDeleteFault(
      vehicleId,
      call.as.asId(payload.id, "id"),
      instant(call.now()),
    );
    return changedDetail(call, profileId, vehicleId);
  });

  ctx.handle("setThresholds", (payload, call) => {
    const profileId = call.as.asId(payload.profileId, "profileId");
    carStore(call, profileId).setDueThresholds(
      {
        dueSoonDays: call.as.asBoundedInteger(
          payload.dueSoonDays,
          "dueSoonDays",
          1,
          MAX_DUE_SOON_DAYS,
        ),
        dueSoonDistance: call.as.asBoundedInteger(
          payload.dueSoonDistance,
          "dueSoonDistance",
          1,
          MAX_INTERVAL_KM,
        ),
      },
      instant(call.now()),
    );
    return changedGarage(call, profileId);
  });

  // --- The session ----------------------------------------------------------

  ctx.onSessionStart((session) => {
    // Every profile the session opened, not only the one on screen: a reminder
    // is about the user's own car and their own deadline, and dropping it
    // because another profile happens to be open would be a due date nobody
    // hears about. The locked case is the host's, and it is covered.
    for (const profileId of session.profileIds) {
      try {
        rearm(session, profileId);
      } catch (error) {
        console.error(
          `Nexus: Car could not arm its reminders for a profile — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  });

  ctx.onSessionEnd(() => {
    // The host has already cancelled every armed timer; this is the module
    // keeping its own bookkeeping in step, and forgetting what it announced so
    // the next launch says each due date once more.
    armed.clear();
    announced.clear();
  });

  // --- The archive (ADR-090 section imex) ------------------------------------

  ctx.exportData((session) => {
    const profileId = soleProfile(session.profileIds);
    if (profileId === null) return undefined;
    const store = carStore(session, profileId);
    return buildCarExport(store.exportData(), store.settings());
  });

  ctx.importData({
    // The pure half: it reads the whole payload -- the version first -- and
    // throws on anything it will not take, so a refused archive never reaches a
    // write. The rows' own validation is the store's, at the write below.
    parse: parseCarExportPayload,
    apply: (payload, session) => {
      const archive: CarExportPayload = payload ?? emptyCarExport();
      for (const profileId of session.profileIds) {
        const store = carStore(session, profileId);
        // The content first, then the preference: `importData` replaces the
        // seven collections whole, and the thresholds land in their own row --
        // the store's two halves, written inside the host's one transaction.
        // An archive that says nothing about CAR gets the DEFAULTS by DELETING
        // the row (`resetSettings`), so a profile that never chose a threshold
        // answers the store's own values rather than a copy this file wrote.
        store.importData(archive);
        if (payload === undefined) store.resetSettings();
        else store.setDueThresholds(archive.settings, instant(session.now()));
      }
    },
  });
}

/**
 * The one profile a session is about, or `null` when it names none or several.
 *
 * An archive is written one profile at a time (`main/imex.ts` gathers one
 * profile's `ProfileData`), so "several" is not a shape the exporter meets.
 * Answering `null` rather than guessing keeps that true: if a session ever did
 * name several, this module has no single garage its vehicles belong to, and the
 * honest payload is none at all rather than the first profile's cars written
 * under someone else's name.
 */
function soleProfile(profileIds: readonly string[]): string | null {
  return profileIds.length === 1 ? (profileIds[0] ?? null) : null;
}

/** The instant the store writes, from the clock the kit injected. */
function instant(atMs: number): string {
  return new Date(atMs).toISOString();
}

/** A bare local day off the wire, refused unless it is a real calendar day. */
function day(call: ValidatorCall, value: unknown, field: string): string {
  const text = call.as.asString(value, field);
  if (!isBareDate(text)) {
    throw new Error(`Invalid IPC payload: "${field}" must be a real calendar day (YYYY-MM-DD).`);
  }
  return text;
}

/** One member of a closed vocabulary, refused by name before the store sees it. */
function oneOf<T extends string>(
  call: ValidatorCall,
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  const text = call.as.asString(value, field);
  const found = allowed.find((candidate) => candidate === text);
  if (found === undefined) {
    throw new Error(`Invalid IPC payload: "${field}" is not one of ${allowed.join(", ")}.`);
  }
  return found;
}

/** An optional boolean: absent and `false` are the same answer, which is what the store's own default means. */
function optionalBoolean(call: ValidatorCall, value: unknown, field: string): boolean {
  return value === undefined ? false : call.as.asBoolean(value, field);
}

/** Text that is absent, empty or whitespace is `null` -- which is what the nullable columns mean by "nobody wrote one". */
function nullableText(
  call: ValidatorCall,
  value: unknown,
  field: string,
  max: number,
): string | null {
  // An omitted optional field is the same answer as an explicit `null` -- the
  // module's own payload types declare these as optional, so the wire may carry
  // either, and both mean "nobody wrote one".
  if (value === undefined) return null;
  const text = call.as.asNullableString(value, field);
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) {
    throw new Error(`Invalid IPC payload: "${field}" must be at most ${max} characters.`);
  }
  return trimmed;
}

/** A whole number in `min..max`, or `null` -- the shape an optional odometer or an interval's bound takes. */
function nullableBound(
  call: ValidatorCall,
  value: unknown,
  field: string,
  max: number,
  min = 1,
): number | null {
  if (value === undefined || value === null) return null;
  return call.as.asBoundedInteger(value, field, min, max);
}

/**
 * One half of a money pair, as a nullable amount and the currency that belongs
 * to it.
 *
 * The pair's own rule -- an amount without its currency is a number nobody can
 * read, and a currency on nothing is a label -- is enforced by the CALLER, once,
 * because a form has two spellings of one price (`pricePerUnitMinor`,
 * `totalMinor`) and either may be the one the user has. THIS function validates
 * one column's worth: the currency's ISO-4217 shape and the amount's.
 */
function money(
  call: ValidatorCall,
  amount: unknown,
  currency: unknown,
  amountField: string,
): { minorUnits: number | null; currency: string | null } {
  const rawCurrency =
    currency === undefined ? null : call.as.asNullableString(currency, "currency");
  const code = rawCurrency === null || rawCurrency.trim() === "" ? null : rawCurrency.trim();
  if (code !== null && !isCurrencyCode(code)) {
    throw new Error(
      `Invalid IPC payload: "currency" must be a three-letter ISO-4217 code in upper case.`,
    );
  }
  if (amount === undefined || amount === null) {
    return { minorUnits: null, currency: code };
  }
  if (typeof amount !== "number" || !isMinorUnits(amount) || amount <= 0) {
    throw new Error(`Invalid IPC payload: "${amountField}" must be whole minor units above zero.`);
  }
  return { minorUnits: amount, currency: code };
}

/** A VIN off the wire, in the one canonical spelling the column holds, or `null`. */
function vin(call: ValidatorCall, value: unknown): string | null {
  if (value === undefined) return null;
  const text = call.as.asNullableString(value, "vin");
  if (text === null || text.trim() === "") return null;
  const canonical = normalizeVin(text);
  if (canonical === null) {
    throw new Error(
      'Invalid IPC payload: "vin" must be 17 characters of A-Z and 0-9, without I, O or Q.',
    );
  }
  return canonical;
}

/** Everything a vehicle is, validated field by field before the store sees it (SEC-EL-02). */
function vehicleFields(
  call: ValidatorCall & { now(): number },
  raw: {
    name?: unknown;
    make?: unknown;
    model?: unknown;
    year?: unknown;
    plate?: unknown;
    vin?: unknown;
    fuelType?: unknown;
    distanceUnit?: unknown;
    notes?: unknown;
  },
): {
  name: string;
  make: string;
  model: string;
  year: number;
  plate: string | null;
  vin: string | null;
  fuelType: (typeof FUEL_TYPES)[number];
  distanceUnit: (typeof DISTANCE_UNITS)[number];
  notes: string | null;
} {
  const name = call.as.asCappedChars(
    call.as.asNonEmptyString(raw.name, "name"),
    "name",
    MAX_VEHICLE_NAME_LENGTH,
  );
  const make = call.as.asCappedChars(
    call.as.asNonEmptyString(raw.make, "make"),
    "make",
    MAX_VEHICLE_MAKE_LENGTH,
  );
  const model = call.as.asCappedChars(
    call.as.asNonEmptyString(raw.model, "model"),
    "model",
    MAX_VEHICLE_MODEL_LENGTH,
  );
  // The lower bound is the first automobile and the upper one is the store's own
  // rule (`this year or next`, because a next-year model is sold today): the
  // clock is the only way to state it, and the wire has the same clock.
  const nextYear = new Date(call.now()).getFullYear() + 1;
  const year = call.as.asInteger(raw.year, "year");
  if (year < MIN_VEHICLE_YEAR || year > nextYear) {
    throw new Error(
      `Invalid IPC payload: "year" must be between ${MIN_VEHICLE_YEAR} and ${nextYear}.`,
    );
  }
  return {
    name,
    make,
    model,
    year,
    plate: nullableText(call, raw.plate, "plate", MAX_VEHICLE_PLATE_LENGTH),
    vin: vin(call, raw.vin),
    fuelType: oneOf(call, raw.fuelType, "fuelType", FUEL_TYPES),
    distanceUnit: oneOf(call, raw.distanceUnit, "distanceUnit", DISTANCE_UNITS),
    notes: nullableText(call, raw.notes, "notes", MAX_VEHICLE_NOTES_LENGTH),
  };
}

/** Everything a service entry is. The cost pair is FIN's, and the odometer is optional because nobody wrote it down. */
function serviceFields(
  call: ValidatorCall,
  raw: {
    date?: unknown;
    odometer?: unknown;
    category?: unknown;
    description?: unknown;
    costMinor?: unknown;
    currency?: unknown;
    workshop?: unknown;
    parts?: unknown;
  },
): {
  date: string;
  odometer: number | null;
  category: ServiceCategory;
  description: string;
  costMinor: number | null;
  currency: string | null;
  workshop: string | null;
  parts: string | null;
} {
  const paid = money(call, raw.costMinor, raw.currency, "costMinor");
  if ((paid.minorUnits === null) !== (paid.currency === null)) {
    throw new Error(
      'Invalid IPC payload: a cost is stored with its currency or not at all ("costMinor" and "currency" together).',
    );
  }
  return {
    date: day(call, raw.date, "date"),
    // Zero is a real odometer (a service at handover), so the bound starts there.
    odometer: nullableBound(call, raw.odometer, "odometer", MAX_ODOMETER_READING, 0),
    category: oneOf(call, raw.category, "category", SERVICE_CATEGORIES),
    description: call.as.asCappedChars(
      call.as.asNonEmptyString(raw.description, "description"),
      "description",
      MAX_SERVICE_DESCRIPTION_LENGTH,
    ),
    costMinor: paid.minorUnits,
    currency: paid.currency,
    workshop: nullableText(call, raw.workshop, "workshop", MAX_SERVICE_WORKSHOP_LENGTH),
    parts: nullableText(call, raw.parts, "parts", MAX_SERVICE_PARTS_LENGTH),
  };
}

/** Everything a fill is. `quantity` is a real number: 42,35 L is an ordinary fill (`MAX_FUEL_QUANTITY`'s own note). */
function fuelFields(
  call: ValidatorCall,
  raw: {
    date?: unknown;
    odometer?: unknown;
    quantity?: unknown;
    fullTank?: unknown;
    pricePerUnitMinor?: unknown;
    totalMinor?: unknown;
    currency?: unknown;
  },
): {
  date: string;
  odometer: number | null;
  quantity: number;
  fullTank: boolean;
  pricePerUnitMinor: number | null;
  totalMinor: number | null;
  currency: string | null;
} {
  const price = money(call, raw.pricePerUnitMinor, raw.currency, "pricePerUnitMinor");
  // The second spelling of the same fact. It is checked against the SAME
  // currency the first one supplied (or supplies it when only the total is
  // there, which the store's CHECK allows: both numbers, one currency).
  const total = money(call, raw.totalMinor, raw.currency, "totalMinor");
  const currency = price.currency ?? total.currency;
  const hasAmount = price.minorUnits !== null || total.minorUnits !== null;
  if (hasAmount === (currency === null)) {
    throw new Error(
      'Invalid IPC payload: a fill\'s price is stored with its currency or not at all.',
    );
  }
  if (typeof raw.quantity !== "number" || !(raw.quantity > 0) || raw.quantity > MAX_FUEL_QUANTITY) {
    throw new Error(
      `Invalid IPC payload: "quantity" must be a number between 0 and ${MAX_FUEL_QUANTITY}.`,
    );
  }
  return {
    date: day(call, raw.date, "date"),
    odometer: nullableBound(call, raw.odometer, "odometer", MAX_ODOMETER_READING, 0),
    quantity: raw.quantity,
    fullTank: optionalBoolean(call, raw.fullTank, "fullTank"),
    pricePerUnitMinor: price.minorUnits,
    totalMinor: total.minorUnits,
    currency,
  };
}

/** Everything a fault is, including the service that fixed it. */
function faultFields(
  call: ValidatorCall,
  raw: {
    date?: unknown;
    symptom?: unknown;
    status?: unknown;
    fixNotes?: unknown;
    serviceId?: unknown;
  },
): {
  date: string;
  symptom: string;
  status: (typeof FAULT_STATUSES)[number];
  fixNotes: string | null;
  serviceId: string | null;
} {
  return {
    date: day(call, raw.date, "date"),
    symptom: call.as.asCappedChars(
      call.as.asNonEmptyString(raw.symptom, "symptom"),
      "symptom",
      MAX_FAULT_SYMPTOM_LENGTH,
    ),
    // An omitted status is a fault somebody just wrote down, which is `open` --
    // the same default the store applies, stated here so the wire can omit it.
    status:
      raw.status === undefined ? "open" : oneOf(call, raw.status, "status", FAULT_STATUSES),
    fixNotes: nullableText(call, raw.fixNotes, "fixNotes", MAX_FAULT_FIX_NOTES_LENGTH),
    // `asId` rather than `asString`: this is a row id on the way to a foreign
    // key, which is the shape `check:ids` exists to keep from being read as a
    // mere string (`ipcValidators.ts`'s own note on it).
    serviceId:
      raw.serviceId === undefined || raw.serviceId === null
        ? null
        : call.as.asId(raw.serviceId, "serviceId"),
  };
}
