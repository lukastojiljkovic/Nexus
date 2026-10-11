/**
 * What a vehicle IS: the closed vocabularies every other file in this module
 * speaks, the one identifier the law shapes rather than us, and the two unit
 * conversions.
 *
 * **The vocabularies live here rather than in the store** because they are the
 * module's language: the SQL CHECK in migration 074, the store's refusal of an
 * unknown value, the engine's switches and — later — the pickers on the page all
 * have to mean the same set, so there is one list and everything else reads it.
 * The migration spells its IN-lists out literally, deliberately (a migration
 * must keep producing the same schema a year from now), and the store's own test
 * walks these arrays through raw SQL inserts so the two cannot drift apart.
 *
 * Everything here is pure: no clock, no random source, no I/O.
 */

/** How a vehicle is fuelled. One list, and `other` is a real answer rather than a hole. */
export const FUEL_TYPES = [
  "petrol",
  "diesel",
  "lpg",
  "cng",
  "hybrid",
  "electric",
  "other",
] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

/**
 * The unit the odometers, intervals and fuel distances are counted in — the
 * VEHICLE's unit, never the locale's: a car bought and driven in miles keeps
 * reading miles after its owner switches the app to Serbian.
 */
export const DISTANCE_UNITS = ["km", "mi"] as const;
export type DistanceUnit = (typeof DISTANCE_UNITS)[number];

/**
 * What a service entry was. Ten members and no eleventh, because a service log
 * is read back by category — „when were the brakes last done" is the question
 * the list exists to answer — and a free-text type would make every such
 * question a spelling exercise.
 */
export const SERVICE_CATEGORIES = [
  "oil",
  "filters",
  "tyres",
  "brakes",
  "battery",
  "timing-belt",
  "inspection",
  "registration",
  "repair",
  "other",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

/** A fault's state. Two members: a fault is open until somebody says it is fixed. */
export const FAULT_STATUSES = ["open", "fixed"] as const;
export type FaultStatus = (typeof FAULT_STATUSES)[number];

/**
 * A cost's category: every service category, plus fuel. Fuel is a cost without
 * being a service — nothing was repaired and nothing was replaced, which is why
 * it is not a `ServiceCategory` — and leaving it out of the cost totals would
 * report the smallest part of what a car costs to run.
 */
export const CAR_COST_CATEGORIES = [...SERVICE_CATEGORIES, "fuel"] as const;
export type CarCostCategory = (typeof CAR_COST_CATEGORIES)[number];

/** What a fill is measured in, which follows from what the car burns. */
export type FuelQuantityUnit = "l" | "kWh";

/**
 * The quantity unit for a vehicle's fuel type. Only `electric` is kWh:
 * everything else — including a hybrid, whose tank is a tank — is litres.
 */
export function fuelQuantityUnit(fuelType: FuelType): FuelQuantityUnit {
  return fuelType === "electric" ? "kWh" : "l";
}

/** Every VIN is 17 characters — ISO 3779 — and the store's length bound is this one. */
export const VIN_LENGTH = 17;

/**
 * The VIN alphabet: A-Z and 0-9 with I, O and Q removed, because they are one
 * stroke away from 1 and 0 in a hand-copied number.
 */
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

/**
 * A VIN in canonical form (upper case, trimmed), or `null` when the value is not
 * one. Upper-casing is normalisation rather than invention — the number is the
 * same number — and it is what lets the store store one spelling of it.
 *
 * **The North-American check digit is deliberately NOT enforced.** Nine VIN
 * positions carry a check digit in the US and Canada and mean nothing
 * elsewhere, so enforcing it would refuse every European vehicle; the brief says
 * so outright, and this is where that decision is.
 */
export function normalizeVin(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  return VIN_PATTERN.test(trimmed) ? trimmed : null;
}

/** One mile is exactly 1 609.344 m by definition, so this factor is exact and not a rounded table. */
export const KM_PER_MILE = 1.609344;

/**
 * The earliest year a vehicle can be, as a sanity bound rather than a claim:
 * the Benz Patent-Motorwagen was patented on 29 January 1886 and is the first
 * automobile. A typo'd `1186` is refused by it; the UPPER bound is the store's,
 * because only the store is given the clock to compare against.
 */
export const MIN_VEHICLE_YEAR = 1886;

/** A distance in `unit` expressed in kilometres — the one unit the consumption figures are computed in. */
export function toKilometres(value: number, unit: DistanceUnit): number {
  return unit === "km" ? value : value * KM_PER_MILE;
}

/** Kilometres expressed in `unit` — the inverse, used to put a cost per kilometre back into the vehicle's own unit. */
export function fromKilometres(km: number, unit: DistanceUnit): number {
  return unit === "km" ? km : km / KM_PER_MILE;
}
