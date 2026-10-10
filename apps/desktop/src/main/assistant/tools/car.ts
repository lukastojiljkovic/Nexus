/**
 * The CAR module: what the service book says is coming due, and logging a fill.
 *
 * **The arithmetic is `@nexus/core`'s and main does it, exactly as the page
 * does.** The page never computes a figure (`modules/car/renderer/Page.tsx` says
 * so), and neither does this file: `whatIsDue` answers which interval is due and
 * by how much, `estimateOdometerForDate` answers today's odometer from the
 * readings, and the thresholds are the profile's own settings. The one thing
 * this file decides is which of those answers a model needs, and in what order.
 *
 * **An odometer that nobody measured is never invented.** A read answers with
 * the same "there is no history to measure from" the page prints when a category
 * has no service logged, because an interval measured from a zero would report a
 * car as due on the day it was entered.
 *
 * **A partial fill stays a partial fill.** A fill the user did not describe as a
 * full tank is stored with `fullTank: false`, which is what keeps the
 * consumption engine honest: a full-tank claim the user never made would make
 * `fuelConsumption` measure a stretch it cannot measure, and the page would show
 * a number nobody earned.
 */

import { CarStore, MAX_FUEL_QUANTITY, MAX_ODOMETER_READING, type Vehicle } from "@nexus/db";
import {
  estimateOdometerForDate,
  foldSearchText,
  fuelQuantityUnit,
  whatIsDue,
  type AssistantLocale,
  type DueItem,
  type ServiceCategory,
  type Tool,
} from "@nexus/core";
import {
  asArgs,
  asNumber,
  asOptionalBoolean,
  asOptionalCount,
  asOptionalDay,
  asOptionalText,
} from "./args.js";
import {
  assertLive,
  confirmOrDecline,
  formatDayInSentence,
  formatNumber,
  guard,
  localDay,
  okResult,
  phrase,
  text,
  type AssistantPhrase,
  type ProfileDb,
} from "./support.js";

export interface CarToolDeps {
  /** See `ToolDeps.profileDb`. */
  readonly profileDb: ProfileDb;
  /** Main's wall clock: the day every countdown is measured from, and the stamp a fill carries. */
  readonly now: () => number;
}

/** How many due lines one read answers with when the model names no cap, and the ceiling it may ask for. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

/** The ten kinds of service as the page names them (`modules/car/renderer/copy.sr.ts`). */
const CATEGORY_WORDS: Readonly<
  Record<ServiceCategory, { readonly sr: string; readonly en: string }>
> = {
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

const STATUS_WORDS = {
  ok: { sr: "U redu", en: "Fine" },
  soon: { sr: "Uskoro", en: "Due soon" },
  overdue: { sr: "Dospelo", en: "Overdue" },
} as const;

const VEHICLE_HEADING: AssistantPhrase<[name: string]> = {
  sr: (name) => `${name}:`,
  en: (name) => `${name}:`,
};

const GARAGE_EMPTY: { readonly sr: string; readonly en: string } = {
  sr: "Još nema vozila u garaži.",
  en: "There is no vehicle in the garage yet.",
};

const NOTHING_DUE: { readonly sr: string; readonly en: string } = {
  sr: "Ništa ne dospeva.",
  en: "Nothing is coming due.",
};

const NO_INTERVALS: { readonly sr: string; readonly en: string } = {
  sr: "Nijedan interval nije upisan, pa nema šta da dospe.",
  en: "No interval is set, so nothing can come due.",
};

const DAYS_LEFT: AssistantPhrase<[days: number]> = {
  sr: (days) => `još ${days} dana`,
  en: (days) => `${days} days left`,
};

const DAYS_PASSED: AssistantPhrase<[days: number]> = {
  sr: (days) => `${days} dana je prošlo`,
  en: (days) => `${days} days overdue`,
};

const DISTANCE_LEFT: AssistantPhrase<[distance: string, unit: string]> = {
  sr: (distance, unit) => `još ${distance} ${unit}`,
  en: (distance, unit) => `${distance} ${unit} left`,
};

const UNKNOWN_VEHICLE: AssistantPhrase<[name: string, known: string]> = {
  sr: (name, known) => `Nema vozila „${name}“ u garaži. Vozila: ${known}.`,
  en: (name, known) => `No vehicle “${name}” in the garage. The vehicles: ${known}.`,
};

const NEEDS_VEHICLE: AssistantPhrase<[known: string]> = {
  sr: (known) => `U garaži je više vozila, pa navedi koje. Vozila: ${known}.`,
  en: (known) => `The garage holds more than one vehicle, so name one. The vehicles: ${known}.`,
};

const ADD_FUEL_SUMMARY: AssistantPhrase<[quantity: string, name: string]> = {
  sr: (quantity, name) => `Zabeleži ${quantity} za vozilo „${name}“`,
  en: (quantity, name) => `Log ${quantity} for “${name}”`,
};

const FUEL_LOGGED: AssistantPhrase<[quantity: string, name: string, day: string, id: string]> = {
  sr: (quantity, name, day, id) =>
    `Zabeleženo gorivo za „${name}“: ${quantity}, ${day} (${id}).`,
  en: (quantity, name, day, id) => `Fuel logged for “${name}”: ${quantity}, ${day} (${id}).`,
};

export function carTools(deps: CarToolDeps): readonly Tool[] {
  const due: Tool = {
    name: "car.due",
    description: {
      sr: "Čita servisnu knjigu i kaže šta dospeva: koji servis je na redu, koliko je dana ili kilometara ostalo i šta je već dospelo. Koristi ga kada korisnik pita kada mu je sledeći servis ili šta treba da radi na autu.",
      en: "Reads the service book and says what is coming due: which service is next, how many days or kilometres are left, and what is already overdue. Use it when the user asks when the next service is or what the car needs.",
    },
    parameters: {
      type: "object",
      properties: {
        vehicle: {
          type: "string",
          maxLength: 120,
          description: "One vehicle, by the name the garage uses. Left out, every vehicle is read.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `How many due items to list per vehicle. Defaults to ${String(DEFAULT_LIMIT)}.`,
        },
      },
      required: [],
      additionalProperties: false,
    },
    effect: "read",
    run: (rawArgs, context) =>
      guard(context, () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const wanted = asOptionalText(args.vehicle, "vehicle", 120);
        const limit = asOptionalCount(args.limit, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
        const today = localDay(deps.now());

        const read = deps.profileDb(context.profileId, (db, id) => {
          const store = new CarStore(db, id);
          const settings = store.settings();
          return {
            vehicles: store.listVehicles().filter((vehicle) => vehicle.archivedAt === null),
            book: (vehicle: Vehicle) => {
              const readings = store.listReadings(vehicle.id);
              return {
                intervals: store.listIntervals(vehicle.id),
                services: store.listServices(vehicle.id),
                estimatedOdometer: estimateOdometerForDate(
                  readings.map((reading) => ({
                    date: reading.date,
                    reading: reading.reading,
                    segment: reading.segment,
                  })),
                  today,
                ),
              };
            },
            thresholds: { days: settings.dueSoonDays, distance: settings.dueSoonDistance },
          };
        });

        const vehicles =
          wanted === undefined
            ? read.vehicles
            : [resolveVehicle(read.vehicles, wanted, context.locale)];
        if (vehicles.length === 0) return okResult(text(context.locale, GARAGE_EMPTY));

        const blocks: string[] = [];
        for (const vehicle of vehicles) {
          const book = read.book(vehicle);
          blocks.push(phrase(context.locale, VEHICLE_HEADING, vehicle.name));
          if (book.intervals.length === 0) {
            blocks.push(text(context.locale, NO_INTERVALS));
            continue;
          }
          const answers = whatIsDue({
            intervals: book.intervals.map((interval) => ({
              category: interval.category,
              everyKm: interval.everyKm,
              everyMonths: interval.everyMonths,
            })),
            services: book.services.map((service) => ({
              category: service.category,
              date: service.date,
              odometer: service.odometer,
            })),
            today,
            estimatedOdometer: book.estimatedOdometer,
            thresholds: read.thresholds,
          });
          const urgent = answers.filter((entry) => entry.status !== "ok").slice(0, limit);
          if (urgent.length === 0) {
            blocks.push(text(context.locale, NOTHING_DUE));
            continue;
          }
          blocks.push(...urgent.map((entry) => dueLine(context.locale, entry, vehicle.distanceUnit)));
        }
        return okResult(blocks.join("\n"));
      }),
  };

  const fill: Tool = {
    name: "car.fill",
    description: {
      sr: "Upisuje točenje u servisnu knjigu: količinu u litrima (ili kWh za električni auto), a po želji datum, kilometražu i cenu. Koristi ga kada korisnik kaže da je sipao gorivo.",
      en: "Logs a fill in the service book: the quantity in litres (or kWh for an electric car), and optionally the date, the odometer and the price. Use it when the user says they filled up.",
    },
    parameters: {
      type: "object",
      properties: {
        vehicle: {
          type: "string",
          maxLength: 120,
          description: "The vehicle, by the name the garage uses. Left out, the only vehicle in the garage is used.",
        },
        quantity: {
          type: "number",
          exclusiveMinimum: 0,
          maximum: MAX_FUEL_QUANTITY,
          description: "Litres (or kWh), as the pump printed them. 38.5 is allowed.",
        },
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "The day of the fill, YYYY-MM-DD. Left out, today." },
        odometer: {
          type: "integer",
          minimum: 0,
          maximum: MAX_ODOMETER_READING,
          description: "The odometer at the pump, in the vehicle's own unit.",
        },
        totalMinor: {
          type: "integer",
          minimum: 1,
          description: "What it cost, in the currency's smallest unit (para, cents). Needs \"currency\".",
        },
        currency: { type: "string", pattern: "^[A-Za-z]{3}$", description: 'The currency of "totalMinor", e.g. "RSD" or "EUR".' },
        fullTank: {
          type: "boolean",
          description: "True only when the user said the tank was filled to the top.",
        },
      },
      required: ["quantity"],
      additionalProperties: false,
    },
    effect: "write",
    run: (rawArgs, context) =>
      guard(context, async () => {
        assertLive(context);
        const args = asArgs(rawArgs);
        const quantity = asNumber(args.quantity, "quantity", 0, MAX_FUEL_QUANTITY);
        if (quantity <= 0) throw new Error('"quantity" must be above zero.');
        const wanted = asOptionalText(args.vehicle, "vehicle", 120);
        const day = asOptionalDay(args.date, "date") ?? localDay(deps.now());
        const odometer = asOptionalCount(args.odometer, "odometer", 0, MAX_ODOMETER_READING);
        const totalMinor = asOptionalCount(args.totalMinor, "totalMinor", 1, Number.MAX_SAFE_INTEGER);
        const currency = asOptionalText(args.currency, "currency", 3);
        const fullTank = asOptionalBoolean(args.fullTank, "fullTank") ?? false;
        // The store's pair rule, refused here so the model reads which half is
        // missing rather than the row's CHECK refusing an amount with no currency.
        if (totalMinor !== undefined && currency === undefined) {
          throw new Error('"totalMinor" needs the "currency" it is in.');
        }

        const read = deps.profileDb(context.profileId, (db, id) => {
          const store = new CarStore(db, id);
          return {
            vehicles: store.listVehicles().filter((vehicle) => vehicle.archivedAt === null),
          };
        });
        if (read.vehicles.length === 0) throw new Error(text(context.locale, GARAGE_EMPTY));
        const vehicle =
          wanted === undefined
            ? onlyVehicle(read.vehicles, context.locale)
            : resolveVehicle(read.vehicles, wanted, context.locale);
        const unit = fuelQuantityUnit(vehicle.fuelType);

        const declined = await confirmOrDecline(
          context,
          "car.fill",
          "write",
          phrase(context.locale, ADD_FUEL_SUMMARY, quantityText(context.locale, quantity, unit), vehicle.name),
        );
        if (declined !== null) return declined;

        const created = deps.profileDb(context.profileId, (db, id) =>
          new CarStore(db, id).createFuelEntry(
            vehicle.id,
            {
              date: day,
              quantity,
              fullTank,
              ...(odometer === undefined ? {} : { odometer }),
              ...(totalMinor === undefined ? {} : { totalMinor }),
              ...(currency === undefined ? {} : { currency: currency.toUpperCase() }),
            },
            new Date(deps.now()).toISOString(),
          ),
        );
        return okResult(
          phrase(
            context.locale,
            FUEL_LOGGED,
            quantityText(context.locale, created.quantity, unit),
            vehicle.name,
            formatDayInSentence(context.locale, created.date),
            created.id,
          ),
          { navigateTo: { module: "car" } },
        );
      }),
  };

  return [due, fill];
}

/** One due interval as a line: what, how urgent, and how far off — a distance only when the car has a unit for it. */
function dueLine(locale: AssistantLocale, entry: DueItem, unit: string): string {
  const parts = [text(locale, STATUS_WORDS[entry.status])];
  if (entry.remainingDays !== null) {
    parts.push(
      entry.remainingDays >= 0
        ? phrase(locale, DAYS_LEFT, entry.remainingDays)
        : phrase(locale, DAYS_PASSED, -entry.remainingDays),
    );
  }
  if (entry.remainingDistance !== null) {
    parts.push(phrase(locale, DISTANCE_LEFT, String(entry.remainingDistance), unit));
  }
  if (entry.dueDate !== null) parts.push(formatDayInSentence(locale, entry.dueDate));
  return `- ${text(locale, CATEGORY_WORDS[entry.category])}: ${parts.join(", ")}`;
}

/** „38,5 l" in Serbian, "38.5 l" in English — the unit is the vehicle's fuel's own. */
function quantityText(locale: AssistantLocale, quantity: number, unit: string): string {
  return `${formatNumber(locale, quantity)} ${unit}`;
}

/** The vehicle a name means: its id, its exact name folded, or a refusal listing the names that exist. */
function resolveVehicle(
  vehicles: readonly Vehicle[],
  name: string,
  locale: AssistantLocale,
): Vehicle {
  const needle = foldSearchText(name.trim());
  const found =
    vehicles.find((vehicle) => vehicle.id === name) ??
    vehicles.find((vehicle) => foldSearchText(vehicle.name) === needle);
  if (found !== undefined) return found;
  throw new Error(
    phrase(
      locale,
      UNKNOWN_VEHICLE,
      name,
      vehicles.map((vehicle) => vehicle.name).join(", "),
    ),
  );
}

/** The one vehicle in the garage, or a refusal saying which one to name. */
function onlyVehicle(vehicles: readonly Vehicle[], locale: AssistantLocale): Vehicle {
  const first = vehicles[0];
  if (first === undefined) throw new Error(text(locale, GARAGE_EMPTY));
  if (vehicles.length === 1) return first;
  throw new Error(
    phrase(locale, NEEDS_VEHICLE, vehicles.map((vehicle) => vehicle.name).join(", ")),
  );
}
