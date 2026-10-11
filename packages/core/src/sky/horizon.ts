/**
 * The day-scoped events: sunrise and sunset, the three twilights, moonrise and
 * moonset, the two upper transits, and how much daylight a day holds.
 *
 * **The conventions are ch. 15's ("Rising, Transit, and Setting"), the method is
 * not.** The chapter defines the events by the altitude at which a body's upper
 * limb touches the horizon — 34' of refraction at the horizon plus 16' of solar
 * semidiameter, so the Sun's centre at -0.8333 degrees, and for the Moon
 * `0.7275 pi - 34'` measured from the geocentre, which is `-34' - 0.2725 pi`
 * measured from the observer, since the parallax is already inside the altitude
 * this module computes. The chapter then solves for the times by interpolating
 * the day's right ascension and declination. This file instead finds the
 * crossings of its own altitude function, because that function is the one
 * `sunPosition` and `moonPosition` publish: the time this returns is the time
 * those functions say the body is at the limit, which is a property a caller can
 * check with the API they already have.
 *
 * **Nothing here can return a wrong time for a body that never crosses.**
 * Sampling the UTC day at fifteen-minute steps and deciding from the day's own
 * extremes — refined, so that an excursion shorter than a step is still found —
 * gives one of three states: `crosses`, `always-above`, `always-below`. Polar
 * day and polar night are the Sun's last two, and they are the reason a rise is
 * `null` rather than an invented instant.
 *
 * **A rise or a set belongs to the UTC day it happens in, not to the pair next
 * to it.** In the southern hemisphere the UTC day opens in daylight, so a set
 * can come before that day's rise (Sydney on 1 January sets at 09:09 UT and
 * rises at 18:48), and at a high latitude a Moon can rise and not set. Each of
 * the two is reported on its own, and `null` means exactly "no such event in
 * this UTC day".
 *
 * **Day length is the daylight inside the UTC day**, which is the same number as
 * the gap between a morning rise and an evening set, and stays meaningful when
 * only one of the two happens: 86 400 for polar day, 0 for polar night, and the
 * part of the day the Sun is up in between.
 */
import { ARCMINUTES_PER_DEGREE } from "./angles.js";
import type { SkyPlace } from "./horizontal.js";
import { MS_PER_DAY, utcDayStart, type SkyInstant } from "./julian.js";
import { moonPosition } from "./moon.js";
import { sunPosition } from "./sun.js";

/** Whether a day contains its crossing of some limit at all, and if not, which side it stayed on. */
export type SkyDayState = "crosses" | "always-above" | "always-below";

/** One UTC day's Sun. */
export interface SunDay {
  readonly state: SkyDayState;
  /** Sunrise, or `null` when no upward crossing happens inside the UTC day. */
  readonly rise: Date | null;
  /** Sunset, or `null` when no downward crossing happens inside the UTC day. */
  readonly set: Date | null;
  /**
   * Upper transit — local solar noon — or `null` on a UTC day that holds none.
   *
   * The solar day is not the civil one: measured over 2000-2100 it runs between
   * 86 378.4 and 86 429.9 seconds. Away from the date line that changes nothing
   * — all 36 525 days of that century hold exactly one noon at Belgrade, because
   * noon follows the equation of time and never comes within half an hour of the
   * day's own end. At longitude 180 the boundary lands on the noon instead (200
   * of the same 36 525 days hold two, and 200 hold none), which is why this is
   * nullable rather than asserted.
   */
  readonly transit: Date | null;
  /** Seconds of the UTC day with the Sun above the horizon: 0 to 86 400. */
  readonly dayLengthSeconds: number;
}

/** One dusk-to-dawn window of one twilight limit. */
export interface TwilightWindow {
  readonly state: SkyDayState;
  /** Dawn: the upward crossing, or `null` when there is none. */
  readonly dawn: Date | null;
  /** Dusk: the downward crossing, or `null` when there is none. */
  readonly dusk: Date | null;
}

/** The three twilights of one UTC day. */
export interface SkyTwilight {
  /** The Sun's centre 6 degrees below the horizon. */
  readonly civil: TwilightWindow;
  /** 12 degrees below. */
  readonly nautical: TwilightWindow;
  /** 18 degrees below. */
  readonly astronomical: TwilightWindow;
}

/** One UTC day's Moon. */
export interface MoonDay {
  readonly state: SkyDayState;
  readonly rise: Date | null;
  readonly set: Date | null;
  /** Upper transit, or `null`: the Moon's day runs about 24h50m, so a UTC day can hold none. */
  readonly transit: Date | null;
}

/** The Sun's standard rise/set altitude: 34' of refraction and 16' of semidiameter (ch. 15). */
const SUN_RISE_SET_ALTITUDE_DEGREES = -50 / ARCMINUTES_PER_DEGREE;

/** The Moon's semidiameter as a fraction of its horizontal parallax (ch. 47). */
const MOON_SEMIDIAMETER_PER_PARALLAX = 0.2725;

/** Refraction at the horizon, in arcminutes: the same 34' as above (ch. 15). */
const HORIZON_REFRACTION_ARCMINUTES = 34;

/**
 * The scan step for a UTC day: fifteen minutes, so ninety-seven samples. Meeus's
 * events are minutes apart in the worst case and never seconds, and the extremes
 * below are what covers an excursion shorter than a step, so this is a
 * resolution choice rather than a precision one — it is also the only thing that
 * decides how long a day-scoped call takes, and the Moon's position is the
 * expensive one (about 0.01 ms each, so a day costs under two).
 */
const SCAN_STEP_MS = 15 * 60_000;
const SAMPLES_PER_DAY = MS_PER_DAY / SCAN_STEP_MS;

/** The Sun's twilight limits, in degrees below the horizon — geometric centre, no refraction. */
const TWILIGHT_ALTITUDES = { civil: -6, nautical: -12, astronomical: -18 } as const;

interface Crossing {
  readonly ms: number;
  readonly rising: boolean;
}

interface DaySolution {
  readonly state: SkyDayState;
  readonly crossings: readonly Crossing[];
}

/**
 * When a function crosses zero inside one UTC day.
 *
 * The fifteen-minute scan finds every crossing wider than its step; whatever is
 * narrower than that is caught by refining the day's own maximum and minimum,
 * which is the only shape a missed pair of crossings can have — a body that
 * pokes above a limit for two minutes and comes back down has an extremum there,
 * and an extremum is what this looks at next. Refining costs about forty extra
 * evaluations and only on days that have no crossing at all, which is exactly
 * the polar case where being wrong would be inventing an event.
 */
function solveDay(target: (ms: number) => number, start: number, end: number): DaySolution {
  const samples: number[] = [];
  for (let index = 0; index <= SAMPLES_PER_DAY; index += 1) {
    samples.push(target(start + index * SCAN_STEP_MS));
  }
  const crossings: Crossing[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    if (previous <= 0 && current > 0) {
      crossings.push({
        ms: bisect(target, start + (index - 1) * SCAN_STEP_MS, start + index * SCAN_STEP_MS),
        rising: true,
      });
    } else if (previous > 0 && current <= 0) {
      crossings.push({
        ms: bisect(target, start + (index - 1) * SCAN_STEP_MS, start + index * SCAN_STEP_MS),
        rising: false,
      });
    }
  }
  const above = samples[0]! > 0;
  if (crossings.length > 0) return { state: "crosses", crossings };

  const highest = samples.indexOf(Math.max(...samples));
  const lowest = samples.indexOf(Math.min(...samples));
  const peak = refineExtremum(
    target,
    Math.max(start, start + (highest - 1) * SCAN_STEP_MS),
    Math.min(end, start + (highest + 1) * SCAN_STEP_MS),
    true,
  );
  const trough = refineExtremum(
    target,
    Math.max(start, start + (lowest - 1) * SCAN_STEP_MS),
    Math.min(end, start + (lowest + 1) * SCAN_STEP_MS),
    false,
  );
  if (above && target(trough) <= 0) {
    // A dip the scan stepped over: down before the trough, up after it. The
    // samples either side of the trough bound it and every sample is above the
    // limit on this branch, so each bracket straddles zero by construction
    // rather than by a guess about how wide the dip is.
    return {
      state: "crosses",
      crossings: [
        { ms: bisect(target, Math.max(start, start + (lowest - 1) * SCAN_STEP_MS), trough), rising: false },
        { ms: bisect(target, trough, Math.min(end, start + (lowest + 1) * SCAN_STEP_MS)), rising: true },
      ],
    };
  }
  if (!above && target(peak) > 0) {
    // The mirror image: a Moon that clears the horizon for a few minutes.
    return {
      state: "crosses",
      crossings: [
        { ms: bisect(target, Math.max(start, start + (highest - 1) * SCAN_STEP_MS), peak), rising: true },
        { ms: bisect(target, peak, Math.min(end, start + (highest + 1) * SCAN_STEP_MS)), rising: false },
      ],
    };
  }
  return { state: above ? "always-above" : "always-below", crossings: [] };
}

/** The instant a continuous function crosses zero between two points that straddle it. */
function bisect(target: (ms: number) => number, low: number, high: number): number {
  let below = low;
  let above = high;
  let belowValue = target(below);
  for (let step = 0; step < 60 && above - below > 1; step += 1) {
    const middle = (below + above) / 2;
    const middleValue = target(middle);
    if ((belowValue <= 0) === (middleValue <= 0)) {
      below = middle;
      belowValue = middleValue;
    } else {
      above = middle;
    }
  }
  return (below + above) / 2;
}

/** Golden-section search for the day's local extreme of a smooth function. */
function refineExtremum(
  target: (ms: number) => number,
  low: number,
  high: number,
  maximum: boolean,
): number {
  const ratio = 0.6180339887498949;
  let below = low;
  let above = high;
  let left = above - ratio * (above - below);
  let right = below + ratio * (above - below);
  let leftValue = target(left);
  let rightValue = target(right);
  for (let step = 0; step < 60 && above - below > 1; step += 1) {
    const keepLeft = maximum ? leftValue >= rightValue : leftValue <= rightValue;
    if (keepLeft) {
      above = right;
      right = left;
      rightValue = leftValue;
      left = above - ratio * (above - below);
      leftValue = target(left);
    } else {
      below = left;
      left = right;
      leftValue = rightValue;
      right = below + ratio * (above - below);
      rightValue = target(right);
    }
  }
  return (below + above) / 2;
}

/**
 * The instant inside the UTC day when the body's hour angle passes zero. The
 * hour angle advances about 15 degrees an hour, so the same fifteen-minute scan
 * cannot step across it — it moves 3.8 degrees a step, which is also why
 * bisecting the wrapped angle inside one step is safe.
 */
function transitOf(hourAngleAt: (ms: number) => number, start: number): number | null {
  let previousMs = start;
  let previousAngle = hourAngleAt(start);
  for (let index = 1; index <= SAMPLES_PER_DAY; index += 1) {
    const ms = start + index * SCAN_STEP_MS;
    const angle = hourAngleAt(ms);
    if (previousAngle <= 0 && angle > 0) return bisect(hourAngleAt, previousMs, ms);
    previousMs = ms;
    previousAngle = angle;
  }
  return null;
}

/** The seconds of the UTC day the target function spends above zero. */
function aboveSeconds(target: (ms: number) => number, start: number, end: number, crossings: readonly Crossing[]): number {
  let above = target(start) > 0;
  let cursor = start;
  let total = 0;
  for (const crossing of crossings) {
    if (above) total += crossing.ms - cursor;
    cursor = crossing.ms;
    above = crossing.rising;
  }
  if (above) total += end - cursor;
  return total / 1000;
}

function dateOf(ms: number | null): Date | null {
  return ms === null ? null : new Date(ms);
}

/** One UTC day's Sun: rise, set, upper transit, state and daylight. */
export function sunDay(place: SkyPlace, at: SkyInstant): SunDay {
  const start = utcDayStart(at);
  const end = start + MS_PER_DAY;
  const target = (ms: number): number => sunPosition(place, ms).altitude - SUN_RISE_SET_ALTITUDE_DEGREES;
  const solution = solveDay(target, start, end);
  const transit = transitOf((ms) => sunPosition(place, ms).hourAngle, start);
  return {
    state: solution.state,
    rise: dateOf(solution.crossings.find((crossing) => crossing.rising)?.ms ?? null),
    set: dateOf(solution.crossings.find((crossing) => !crossing.rising)?.ms ?? null),
    transit: dateOf(transit),
    dayLengthSeconds: aboveSeconds(target, start, end, solution.crossings),
  };
}

/** One UTC day's civil, nautical and astronomical twilight. */
export function sunTwilight(place: SkyPlace, at: SkyInstant): SkyTwilight {
  const start = utcDayStart(at);
  const end = start + MS_PER_DAY;
  const window = (limit: number): TwilightWindow => {
    const target = (ms: number): number => sunPosition(place, ms).altitude - limit;
    const solution = solveDay(target, start, end);
    return {
      state: solution.state,
      dawn: dateOf(solution.crossings.find((crossing) => crossing.rising)?.ms ?? null),
      dusk: dateOf(solution.crossings.find((crossing) => !crossing.rising)?.ms ?? null),
    };
  };
  return {
    civil: window(TWILIGHT_ALTITUDES.civil),
    nautical: window(TWILIGHT_ALTITUDES.nautical),
    astronomical: window(TWILIGHT_ALTITUDES.astronomical),
  };
}

/** One UTC day's Moon: rise, set, upper transit and state. */
export function moonDay(place: SkyPlace, at: SkyInstant): MoonDay {
  const start = utcDayStart(at);
  const end = start + MS_PER_DAY;
  const target = (ms: number): number => {
    const position = moonPosition(place, ms);
    return position.altitude - moonHorizonAltitudeDegrees(position.horizontalParallax);
  };
  const solution = solveDay(target, start, end);
  return {
    state: solution.state,
    rise: dateOf(solution.crossings.find((crossing) => crossing.rising)?.ms ?? null),
    set: dateOf(solution.crossings.find((crossing) => !crossing.rising)?.ms ?? null),
    transit: dateOf(transitOf((ms) => moonPosition(place, ms).hourAngle, start)),
  };
}

/**
 * The altitude the Moon's centre has when its upper limb is on the horizon, as
 * seen from the observer: Meeus's `0.7275 pi - 34'` is this same condition
 * written from the geocentre, and the difference between the two is exactly the
 * parallax that {@link moonPosition} has already applied.
 */
function moonHorizonAltitudeDegrees(horizontalParallax: number): number {
  return (
    -HORIZON_REFRACTION_ARCMINUTES / ARCMINUTES_PER_DEGREE -
    MOON_SEMIDIAMETER_PER_PARALLAX * horizontalParallax
  );
}
