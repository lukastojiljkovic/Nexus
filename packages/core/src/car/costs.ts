/**
 * What the car costs: per category, per month, and per distance unit driven.
 *
 * **Money is an integer in minor units, exactly as FIN defines it.** 450 000 in
 * an RSD total is 4 500,00 RSD; how many minor units a major unit has is a
 * DISPLAY fact and lives at the display edge. Every total here is therefore an
 * integer sum of integers, which is exact by construction — a float would start
 * losing the last para at the third fill and never say so.
 *
 * **A total never crosses currencies.** There is no exchange rate in this app,
 * so two currencies add up to two rows rather than to one invented number. That
 * is why every aggregate below is keyed by currency, and why `costPerDistance`
 * answers a list.
 *
 * **Cost per distance is over a PERIOD, not over the car's life.** The distance
 * is what the odometer covered inside the same window (`distanceCovered`), so
 * the figure answers the question a person asks — what did these months cost me,
 * per kilometre — rather than an average over years the driver no longer
 * remembers.
 *
 * Pure: no clock, no random source, no rounding of anything a caller will sum.
 */

import type { OdometerPoint } from "./odometer.js";
import { CAR_COST_CATEGORIES, type CarCostCategory, type ServiceCategory } from "./vehicle.js";

/** One priced thing, whatever it was: a service or a fill. */
export interface CarCost {
  readonly date: string;
  readonly category: CarCostCategory;
  readonly currency: string;
  readonly minorUnits: number;
}

/** Just enough of a service entry to read its cost — the store's own row satisfies this as it stands. */
export interface ServiceCostFields {
  readonly date: string;
  readonly category: ServiceCategory;
  readonly costMinor: number | null;
  readonly currency: string | null;
}

/** Just enough of a fuel entry to read its cost. Either the price per unit or the total is enough; the other is derived. */
export interface FuelCostFields {
  readonly date: string;
  readonly quantity: number;
  readonly currency: string | null;
  readonly pricePerUnitMinor: number | null;
  readonly totalMinor: number | null;
}

/** One category's total, in one currency. */
export interface CategoryTotal {
  readonly category: CarCostCategory;
  readonly currency: string;
  readonly minorUnits: number;
  readonly count: number;
}

/** One month's total, in one currency. `month` is `YYYY-MM`. */
export interface MonthlyTotal {
  readonly month: string;
  readonly currency: string;
  readonly minorUnits: number;
  readonly count: number;
}

/** One currency's cost per distance unit, over the window asked about. */
export interface DistanceCost {
  readonly currency: string;
  readonly minorUnits: number;
  /** The odometer's own span inside the window, in the vehicle's unit — or `null` when it cannot answer. */
  readonly distance: number | null;
  /** Minor units per distance unit, or `null` when there is no distance to divide by. NOT rounded: rounding belongs where the number is printed. */
  readonly perDistance: number | null;
}

/**
 * What a fill cost, in minor units, or `null` when neither the total nor a price
 * per unit was recorded.
 *
 * The derived side is rounded to the nearest minor unit, because the result IS
 * money: 42,35 L at 179,95 RSD is 7 620,8825 RSD, and a total of 762 088,25 para
 * is not a number any till could print. `Math.round` is half-up for the positive
 * values this module deals with.
 */
export function fuelCostMinor(fill: {
  readonly quantity: number;
  readonly pricePerUnitMinor: number | null;
  readonly totalMinor: number | null;
}): number | null {
  if (fill.totalMinor !== null) return fill.totalMinor;
  if (fill.pricePerUnitMinor === null) return null;
  return Math.round(fill.quantity * fill.pricePerUnitMinor);
}

/**
 * Every priced row of a vehicle as a cost, oldest first.
 *
 * Both kinds of row go through here rather than being mapped at the call site,
 * because the mapping has one rule each and both are easy to get subtly wrong: a
 * service with no cost has NO cost (not a zero, which would draw a bar in the
 * cheapest category), and a fill with no price at all likewise.
 */
export function vehicleCosts(
  services: readonly ServiceCostFields[],
  fills: readonly FuelCostFields[],
): CarCost[] {
  const costs: CarCost[] = [];
  for (const service of services) {
    if (service.costMinor === null || service.currency === null) continue;
    costs.push({
      date: service.date,
      category: service.category,
      currency: service.currency,
      minorUnits: service.costMinor,
    });
  }
  for (const fill of fills) {
    const minorUnits = fuelCostMinor(fill);
    if (minorUnits === null || fill.currency === null) continue;
    costs.push({ date: fill.date, category: "fuel", currency: fill.currency, minorUnits });
  }
  return costs.sort((left, right) =>
    left.date !== right.date
      ? left.date < right.date
        ? -1
        : 1
      : compareCategories(left.category, right.category),
  );
}

/** Totals per category and currency, in the module's own category order — which is what a picker shows, so the list and the picker agree. */
export function totalsByCategory(costs: readonly CarCost[]): CategoryTotal[] {
  const totals = new Map<string, CategoryTotal>();
  for (const cost of costs) {
    const key = `${cost.category}\u001f${cost.currency}`;
    const existing = totals.get(key);
    if (existing === undefined) {
      totals.set(key, {
        category: cost.category,
        currency: cost.currency,
        minorUnits: cost.minorUnits,
        count: 1,
      });
    } else {
      totals.set(key, {
        ...existing,
        minorUnits: existing.minorUnits + cost.minorUnits,
        count: existing.count + 1,
      });
    }
  }
  return [...totals.values()].sort(
    (left, right) =>
      compareCategories(left.category, right.category) ||
      compareStrings(left.currency, right.currency),
  );
}

/** Totals per calendar month and currency, oldest month first. A month nobody spent anything in is ABSENT rather than a row of zeroes: the caller drawing a continuous axis fills its own gaps. */
export function totalsByMonth(costs: readonly CarCost[]): MonthlyTotal[] {
  const totals = new Map<string, MonthlyTotal>();
  for (const cost of costs) {
    const month = cost.date.slice(0, 7);
    const key = `${month}\u001f${cost.currency}`;
    const existing = totals.get(key);
    if (existing === undefined) {
      totals.set(key, { month, currency: cost.currency, minorUnits: cost.minorUnits, count: 1 });
    } else {
      totals.set(key, {
        ...existing,
        minorUnits: existing.minorUnits + cost.minorUnits,
        count: existing.count + 1,
      });
    }
  }
  return [...totals.values()].sort(
    (left, right) =>
      compareStrings(left.month, right.month) || compareStrings(left.currency, right.currency),
  );
}

/**
 * The odometer's own span over an inclusive window, or `null` when it cannot
 * answer for it.
 *
 * Three nulls, and each is a case where a number would be a lie: fewer than two
 * readings (nothing to subtract), and a window that spans an odometer
 * replacement (the two numbers are different odometers, so the difference is
 * not a distance however tempting it looks).
 */
export function distanceCovered(
  readings: readonly OdometerPoint[],
  from: string,
  to: string,
): number | null {
  const inside = readings.filter((reading) => reading.date >= from && reading.date <= to);
  if (inside.length < 2) return null;
  const segment = inside[0]?.segment;
  if (inside.some((reading) => reading.segment !== segment)) return null;
  const values = inside.map((reading) => reading.reading);
  return Math.max(...values) - Math.min(...values);
}

/**
 * What each currency cost per distance unit over the window — one row per
 * currency, because the distances are the same and the money is not.
 */
export function costPerDistance(input: {
  readonly costs: readonly CarCost[];
  readonly readings: readonly OdometerPoint[];
  readonly from: string;
  readonly to: string;
}): DistanceCost[] {
  const distance = distanceCovered(input.readings, input.from, input.to);
  const perCurrency = new Map<string, number>();
  for (const cost of input.costs) {
    if (cost.date < input.from || cost.date > input.to) continue;
    perCurrency.set(cost.currency, (perCurrency.get(cost.currency) ?? 0) + cost.minorUnits);
  }
  return [...perCurrency.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([currency, minorUnits]) => ({
      currency,
      minorUnits,
      distance,
      perDistance: distance === null || distance === 0 ? null : minorUnits / distance,
    }));
}

/** The module's own category order, then alphabetical — the comparisons above all end here. */
function compareCategories(left: CarCostCategory, right: CarCostCategory): number {
  return CAR_COST_CATEGORIES.indexOf(left) - CAR_COST_CATEGORIES.indexOf(right);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
