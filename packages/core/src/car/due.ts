/**
 * What is due: for each interval, the next deadline and how close it is.
 *
 * **Two deadlines per interval, and whichever comes first wins.** An interval
 * measured in kilometres and months at once — oil every 10 000 km or every year,
 * whichever comes first — is two questions, and a service is due when the first
 * of them says so. So each is judged on its own and the worse verdict is the
 * answer; `by` says which side produced it, because the sentence the user needs
 * differs (500 km left, against twelve days left) and a single status cannot say
 * both.
 *
 * **A distance deadline with no odometer estimate cannot be judged.** The
 * odometer for today is an ESTIMATE (`estimateOdometerForDate`) and is passed in;
 * when there is none — fewer than two readings, nobody recorded any — the
 * distance half goes quiet and the status comes from the calendar alone, rather
 * than from a number this module would have to invent.
 *
 * **No baseline is not the same as ok, and it is not an error either.** An
 * interval whose category was never serviced produces two nulls: there is no
 * last service to measure from. Both-null is therefore the honest spelling of
 * nothing-to-measure-yet, and it is unambiguous, because a date-only interval
 * always carries a date and a distance-only one always carries an odometer.
 *
 * Pure: `today` is passed in and is never read off a clock.
 */

import { addMonthsClamped, daysBetween } from "./dates.js";
import type { ServiceCategory } from "./vehicle.js";

/** How urgent a deadline is. Exactly three answers: it is fine, it is close, it has passed. */
export type DueStatus = "ok" | "soon" | "overdue";

/** One category's interval for one vehicle: a distance, a period, or both. At least one is set — the store refuses otherwise. */
export interface ServiceIntervalSpec {
  readonly category: ServiceCategory;
  readonly everyKm: number | null;
  readonly everyMonths: number | null;
}

/** One service entry, cut to what the countdown reads. `odometer` is null when nobody wrote the number down. */
export interface ServiceRecord {
  readonly category: ServiceCategory;
  readonly date: string;
  readonly odometer: number | null;
}

/** What "soon" means for one vehicle: days and distance. Passed in rather than fixed, because the two belong to the owner's appetite, not to the module. */
export interface DueThresholds {
  readonly days: number;
  readonly distance: number;
}

/** One interval's answer, as a page draws it. */
export interface DueItem {
  readonly category: ServiceCategory;
  /** The calendar deadline, or `null` when the interval has no period — and also when there is no history to measure it from. */
  readonly dueDate: string | null;
  /** The odometer the next service falls at, or `null` for the same two reasons the date is. */
  readonly dueOdometer: number | null;
  /** Whole days until `dueDate`; negative once it has passed. `null` when there is no date deadline. */
  readonly remainingDays: number | null;
  /** Whole distance units until `dueOdometer`, from today's ESTIMATED odometer. `null` when either the deadline or the estimate is missing. */
  readonly remainingDistance: number | null;
  readonly status: DueStatus;
  /** Which half decided the status — a calendar deadline outranks a distance one on a tie, because the date is a fact and the odometer is an estimate. `null` while both halves say `ok`. */
  readonly by: "date" | "distance" | null;
}

export interface DueInput {
  readonly intervals: readonly ServiceIntervalSpec[];
  /** Every service entry of the vehicle; this picks the last one per category itself. */
  readonly services: readonly ServiceRecord[];
  readonly today: string;
  readonly estimatedOdometer: number | null;
  readonly thresholds: DueThresholds;
}

const RANK: Readonly<Record<DueStatus, number>> = { ok: 0, soon: 1, overdue: 2 };

/** Every interval's answer, most urgent first — see `compareDue` for what that order means exactly. */
export function whatIsDue(input: DueInput): DueItem[] {
  return input.intervals
    .map((interval) =>
      judge(
        interval,
        latestService(input.services, interval.category),
        input.today,
        input.estimatedOdometer,
        input.thresholds,
      ),
    )
    .sort(compareDue);
}

/**
 * The most recent service of one category — by date, and by odometer within a
 * day, so two entries from the same day describe the later state of the car
 * rather than whichever the store happened to list first.
 */
function latestService(
  services: readonly ServiceRecord[],
  category: ServiceCategory,
): ServiceRecord | null {
  let best: ServiceRecord | null = null;
  for (const service of services) {
    if (service.category !== category) continue;
    if (best === null || service.date > best.date) {
      best = service;
    } else if (service.date === best.date && (service.odometer ?? -1) >= (best.odometer ?? -1)) {
      best = service;
    }
  }
  return best;
}

function judge(
  interval: ServiceIntervalSpec,
  last: ServiceRecord | null,
  today: string,
  estimatedOdometer: number | null,
  thresholds: DueThresholds,
): DueItem {
  const dueDate =
    last !== null && interval.everyMonths !== null
      ? addMonthsClamped(last.date, interval.everyMonths)
      : null;
  const dueOdometer =
    last !== null && interval.everyKm !== null && last.odometer !== null
      ? last.odometer + interval.everyKm
      : null;

  const remainingDays = dueDate === null ? null : daysBetween(today, dueDate);
  const remainingDistance =
    dueOdometer === null || estimatedOdometer === null ? null : dueOdometer - estimatedOdometer;

  const dateStatus = verdict(remainingDays, thresholds.days);
  const distanceStatus = verdict(remainingDistance, thresholds.distance);
  const byDate = RANK[dateStatus] >= RANK[distanceStatus];
  const status = byDate ? dateStatus : distanceStatus;

  return {
    category: interval.category,
    dueDate,
    dueOdometer,
    remainingDays,
    remainingDistance,
    status,
    by: status === "ok" ? null : byDate ? "date" : "distance",
  };
}

/** `null` when there is no deadline on this side, which is never urgent and never soon. */
function verdict(remaining: number | null, soonWithin: number): DueStatus {
  if (remaining === null) return "ok";
  if (remaining < 0) return "overdue";
  return remaining <= soonWithin ? "soon" : "ok";
}

/**
 * Urgent first, then the soonest deadline.
 *
 * A calendar deadline and an odometer one cannot be interleaved honestly — days
 * and kilometres have no exchange rate this module is entitled to invent — so
 * inside a status the dated rows come first in date order and the undated ones
 * follow in odometer order. The category name is the last word, which keeps the
 * order total rather than merely deterministic-looking.
 */
function compareDue(left: DueItem, right: DueItem): number {
  if (left.status !== right.status) return RANK[right.status] - RANK[left.status];
  if (left.dueDate !== right.dueDate) {
    if (left.dueDate === null) return 1;
    if (right.dueDate === null) return -1;
    return left.dueDate < right.dueDate ? -1 : 1;
  }
  const leftOdometer = left.dueOdometer ?? Number.POSITIVE_INFINITY;
  const rightOdometer = right.dueOdometer ?? Number.POSITIVE_INFINITY;
  if (leftOdometer !== rightOdometer) return leftOdometer - rightOdometer;
  return left.category < right.category ? -1 : left.category > right.category ? 1 : 0;
}
