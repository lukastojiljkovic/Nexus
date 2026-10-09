/**
 * The odometer: which segment a reading belongs to, whether a reading may be
 * recorded at all, and what a date's reading probably was.
 *
 * **A SEGMENT is the unit of honesty here.** An odometer is replaced, and the
 * number on the dashboard starts again from something small; from that day the
 * readings belong to a new segment. Comparing across the boundary is
 * meaningless — 100 000 followed by 300 is not a distance of negative 99 700 km
 * — so nothing in this module ever mixes two segments: `checkOdometerReading`
 * measures a candidate against its OWN segment, and `estimateOdometerForDate`
 * fits only the current one. The store is what decides a new segment begins
 * (`startsNewSegment`, the user's explicit override), and every reading carries
 * its segment number in its own row, so nothing has to re-derive the history
 * later.
 *
 * **The rule the override exists for.** Readings must not decrease over time.
 * The only legitimate way to record a number lower than the one before it is a
 * replaced odometer, which is exactly what the flag says — so the refusal names
 * the flag rather than accepting a reading that would silently corrupt every
 * consumption figure computed afterwards.
 *
 * Pure: no clock, no random source. `date` is always a bare local day.
 */

import { dayNumber } from "./dates.js";

/** One odometer reading as this module reads it: the day it was taken, the number, and which odometer it is. */
export interface OdometerPoint {
  readonly date: string;
  readonly reading: number;
  readonly segment: number;
}

/**
 * What `checkOdometerReading` decided. `ok` carries the segment the reading
 * belongs to, so a caller never has to work it out a second way; the two
 * refusals name what they saw, because the store turns them into two different
 * sentences for the user.
 */
export type OdometerVerdict =
  | { readonly ok: true; readonly segment: number }
  | { readonly ok: false; readonly reason: "decreases"; readonly against: OdometerPoint }
  | { readonly ok: false; readonly reason: "not-newest" };

/** Ascending by date — the order every walk below wants, done once. */
function byDate(points: readonly OdometerPoint[]): OdometerPoint[] {
  return [...points].sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));
}

/** The segment the vehicle's newest odometer is in — the one a reading taken today belongs to. 1 for a vehicle with no readings. */
export function currentSegment(readings: readonly OdometerPoint[]): number {
  let segment = 1;
  for (const reading of readings) segment = Math.max(segment, reading.segment);
  return segment;
}

/**
 * The segment a reading dated `date` belongs to: the highest segment among the
 * readings on or before it.
 *
 * That is what makes a reading CATCH-UP-ABLE. A user who remembers last March's
 * number types it in June, after the odometer was replaced in April; it belongs
 * to March's segment, not to today's, and it is measured against March's
 * neighbours. A date earlier than every reading belongs to the first segment,
 * which is where the vehicle's history began.
 */
export function segmentForDate(readings: readonly OdometerPoint[], date: string): number {
  let segment = 1;
  for (const reading of readings) {
    if (reading.date <= date) segment = Math.max(segment, reading.segment);
  }
  return segment;
}

/**
 * Whether a reading may be recorded, and which segment it lands in.
 *
 * `startsNewSegment` is the replaced-odometer override, and it is a promise
 * about the FUTURE as well as the past: a new odometer begins at the newest
 * point of the history, so a reading that opens one is refused when something
 * is already dated after it. Without that refusal an older reading would sit on
 * the far side of the boundary and be read as the new odometer's own number.
 *
 * Two readings of the SAME day constrain each other in neither direction: a day
 * is not an instant, and a morning reading of 100 000 followed by an evening one
 * of 100 050 is two honest entries rather than a decrease.
 */
export function checkOdometerReading(
  readings: readonly OdometerPoint[],
  candidate: { readonly date: string; readonly reading: number; readonly startsNewSegment?: boolean },
): OdometerVerdict {
  if (candidate.startsNewSegment === true) {
    const newest = byDate(readings).at(-1);
    if (newest !== undefined && newest.date > candidate.date) {
      return { ok: false, reason: "not-newest" };
    }
    return { ok: true, segment: currentSegment(readings) + 1 };
  }

  const segment = segmentForDate(readings, candidate.date);
  const sameSegment = readings.filter((reading) => reading.segment === segment);

  let before: OdometerPoint | null = null;
  let after: OdometerPoint | null = null;
  for (const reading of sameSegment) {
    if (reading.date < candidate.date) {
      if (before === null || reading.reading > before.reading) before = reading;
    } else if (reading.date > candidate.date) {
      if (after === null || reading.reading < after.reading) after = reading;
    }
  }

  if (before !== null && candidate.reading < before.reading) {
    return { ok: false, reason: "decreases", against: before };
  }
  if (after !== null && candidate.reading > after.reading) {
    return { ok: false, reason: "decreases", against: after };
  }
  return { ok: true, segment };
}

/**
 * What the odometer probably read on `date`, by least squares over the CURRENT
 * segment's readings — or `null` when the data cannot answer.
 *
 * **Which readings, and why those.** The current segment only, all of it. The
 * old odometer's numbers are a different odometer, so mixing them would tilt the
 * line by however far the numbers happened to jump. Within the segment, every
 * reading counts rather than the last few: the series is monotone and very
 * nearly linear, so dropping the older half would throw away the steadier part
 * of the slope and make the answer depend on a window size nobody could
 * justify. A vehicle whose driving really did change keeps that in the fit, which
 * is the honest thing for an estimate to do.
 *
 * The fit is
 *
 *     slope = Σ(x−x̄)(y−ȳ) / Σ(x−x̄)²,   estimate = ȳ + slope·(x−x̄)
 *
 * with `x` the day offset from the segment's first reading and `y` the reading.
 * Three refusals, each a case where a number would be a fabrication:
 *
 * - fewer than two readings in the segment (no line exists),
 * - a date before the segment's first reading (never extrapolating backwards —
 *   the vehicle may not even have existed then),
 * - every reading on one day, where the denominator is zero: the answer is then
 *   the highest reading, because an odometer only goes up.
 *
 * The result is NOT rounded. Rounding is a display decision, and a caller that
 * compared a rounded estimate against a threshold would be comparing a rounded
 * number with one that was not.
 */
export function estimateOdometerForDate(
  readings: readonly OdometerPoint[],
  date: string,
): number | null {
  const segment = currentSegment(readings);
  const points = byDate(readings.filter((reading) => reading.segment === segment));
  const first = points[0];
  const target = dayNumber(date);
  if (points.length < 2 || first === undefined || target === null) return null;

  const origin = dayNumber(first.date);
  if (origin === null || target < origin) return null;

  const xs = points.map((point) => {
    const day = dayNumber(point.date);
    return day === null ? 0 : day - origin;
  });
  const ys = points.map((point) => point.reading);
  const meanX = xs.reduce((sum, each) => sum + each, 0) / xs.length;
  const meanY = ys.reduce((sum, each) => sum + each, 0) / ys.length;

  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < xs.length; index += 1) {
    const dx = (xs[index] ?? 0) - meanX;
    numerator += dx * ((ys[index] ?? 0) - meanY);
    denominator += dx * dx;
  }
  if (denominator === 0) return Math.max(...ys);

  const slope = numerator / denominator;
  return meanY + slope * (target - origin - meanX);
}
