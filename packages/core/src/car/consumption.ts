/**
 * Fuel consumption by the FULL-TANK method, and the three ways it refuses to
 * produce a number.
 *
 * **The method, spelled out**, because every figure below is read off it:
 *
 *     per 100 km = (fuel added from full tank A to full tank B, inclusive of B)
 *                  / (odometer at B − odometer at A) × 100
 *
 * Two fills that both left the tank full bound a measured stretch: the fuel that
 * filled the tank at A is deliberately excluded — it is what put the car on the
 * road with a known amount in it — and every litre added afterwards, including
 * the one at B, is what the distance actually burned. That is why a partial fill
 * in the middle is SUMMED rather than skipped: it is fuel that was consumed no
 * matter how much of a tank it went into, and it is what lets the method survive
 * a driver who does not always brim the tank.
 *
 * **What it will not measure.** A pair is skipped when either end carries no
 * odometer (a distance cannot be read off a number that is not there), when the
 * odometer did not grow, or when an odometer replacement — a segment start —
 * falls between the two dates. That last one cannot be caught by the arithmetic:
 * an odometer that restarted at a higher number than it stopped at looks exactly
 * like ordinary driving, and a 20 000 km gap on 40 L of fuel is the most
 * confident wrong answer this module could give.
 *
 * **Unmeasured stretches are ABSENT, never guessed.** `overall` covers the
 * segments that were measured, so a fill nobody marked full leaves a gap that
 * shows up as a missing segment rather than as a diluted average.
 *
 * The metric figure is per 100 KILOMETRES even for a vehicle whose odometer
 * counts miles, because L/100 km is a specific figure rather than a shape;
 * the miles-per-gallon figure that vehicle's owner actually reads is `mpg`, and
 * it is non-null exactly when the unit is miles.
 *
 * Pure: no clock, no random source.
 */

import { toKilometres, type DistanceUnit } from "./vehicle.js";

/**
 * One fill as the arithmetic reads it. `odometer` is in the vehicle's own unit
 * and may be absent, and `fullTank` says the tank was brimmed — a claim about
 * the CAR rather than about the quantity, and therefore the only thing that can
 * bound a measurement.
 */
export interface FuelFill {
  readonly date: string;
  readonly quantity: number;
  readonly odometer: number | null;
  readonly fullTank: boolean;
}

/** One measured stretch: the two full tanks that bound it, what was burned, and the figures that follow. */
export interface ConsumptionSegment {
  readonly fromDate: string;
  readonly toDate: string;
  /** The distance between the two odometers, in the vehicle's own unit. */
  readonly distance: number;
  /** Litres, or kWh for an electric vehicle. */
  readonly quantity: number;
  /** How many partial fills were summed in — 0 means every fill in the stretch was a full tank. */
  readonly partialFills: number;
  /** Litres (or kWh) per 100 km. */
  readonly per100Km: number;
  /** US miles per gallon, or `null` unless the vehicle counts miles. */
  readonly mpg: number | null;
}

/** The same figures over every segment at once, or `null` when nothing was measurable. */
export interface OverallConsumption {
  readonly distance: number;
  readonly quantity: number;
  readonly per100Km: number;
  readonly mpg: number | null;
}

export interface FuelConsumption {
  readonly segments: readonly ConsumptionSegment[];
  readonly overall: OverallConsumption | null;
}

/**
 * One US gallon, exactly: 231 cubic inches. The mpg figure is derived from this
 * and from the mile's own definition rather than from a remembered conversion
 * constant, so the two cannot disagree about which gallon this is.
 */
const LITRES_PER_US_GALLON = 3.785411784;

/**
 * Every measurable stretch of the log, oldest first, plus the totals over them.
 *
 * `segmentStarts` is the dates on which a new odometer began — the readings with
 * `segment > 1` — so nothing here has to guess where the numbers stopped being
 * comparable. An empty list measures the log as one unbroken odometer, which is
 * the common case: a vehicle whose odometer was never replaced.
 */
export function fuelConsumption(
  fills: readonly FuelFill[],
  unit: DistanceUnit,
  options: { readonly segmentStarts?: readonly string[] } = {},
): FuelConsumption {
  const segmentStarts = options.segmentStarts ?? [];
  const ordered = [...fills].sort(compareFills);

  const segments: ConsumptionSegment[] = [];
  // The index of the last full tank, whether or not a measurement came out of
  // it: a pair that could not be measured still leaves its closing fill as the
  // opening end of the next one, which is how a stretch that carries no
  // odometer shortens the coverage without ending it.
  let opening: number | null = null;

  for (let index = 0; index < ordered.length; index += 1) {
    const fill = ordered[index];
    if (fill === undefined || !fill.fullTank) continue;
    const previousOpening = opening;
    opening = index;
    if (previousOpening === null) continue;

    const openedBy = ordered[previousOpening];
    if (openedBy === undefined || openedBy.odometer === null || fill.odometer === null) continue;
    if (spansSegmentStart(openedBy.date, fill.date, segmentStarts)) continue;

    // Fuel added strictly after the opening fill, up to and including this one.
    let burned = 0;
    let partialFills = 0;
    for (let each = previousOpening + 1; each <= index; each += 1) {
      const between = ordered[each];
      if (between === undefined) continue;
      burned += between.quantity;
      if (!between.fullTank) partialFills += 1;
    }

    const distance = fill.odometer - openedBy.odometer;
    if (distance <= 0 || burned <= 0) continue;

    segments.push({
      fromDate: openedBy.date,
      toDate: fill.date,
      distance,
      quantity: burned,
      partialFills,
      per100Km: (burned / toKilometres(distance, unit)) * 100,
      mpg: unit === "mi" ? distance / (burned / LITRES_PER_US_GALLON) : null,
    });
  }

  if (segments.length === 0) return { segments, overall: null };
  const distance = segments.reduce((sum, each) => sum + each.distance, 0);
  const quantity = segments.reduce((sum, each) => sum + each.quantity, 0);
  return {
    segments,
    overall: {
      distance,
      quantity,
      per100Km: (quantity / toKilometres(distance, unit)) * 100,
      mpg: unit === "mi" ? distance / (quantity / LITRES_PER_US_GALLON) : null,
    },
  };
}

/**
 * Chronological, and by odometer within a day — two fills on one day are ordered
 * by the number on the dashboard rather than by the order somebody typed them
 * in. A missing odometer sorts last within its day, which keeps the order TOTAL
 * without pretending the absent number is a zero.
 */
function compareFills(left: FuelFill, right: FuelFill): number {
  if (left.date !== right.date) return left.date < right.date ? -1 : 1;
  return (left.odometer ?? Number.POSITIVE_INFINITY) - (right.odometer ?? Number.POSITIVE_INFINITY);
}

/** True when an odometer replacement falls after the opening fill and at or before the closing one. */
function spansSegmentStart(from: string, to: string, segmentStarts: readonly string[]): boolean {
  return segmentStarts.some((start) => start > from && start <= to);
}
