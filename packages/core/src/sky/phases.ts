/**
 * The Moon's phases: the cyclic names and the four instants that divide them
 * (Meeus ch. 49, "Phases of the Moon", for what a principal phase IS; ch. 48 for
 * what the disk looks like from here).
 *
 * **A principal phase is a longitude, not a time.** The Moon is new when its
 * apparent geocentric ecliptic longitude equals the Sun's, first quarter at 90
 * degrees from it, full at 180 and last at 270 — the Astronomical Almanac's
 * definition, and the quantity ch. 49's own series is a shortcut to. This file
 * instead finds the instants numerically, from the longitudes ch. 25 and 47
 * already compute, because a second implementation of the same quantity is a
 * second thing that can disagree with the positions the rest of the module
 * reports; the price is a root-find per phase, the reward is that
 * `moonPosition` and `moonPhase` cannot drift apart.
 *
 * **The eight names change at the 45-degree octant boundaries** — `new` for
 * elongations in [337.5, 22.5), `waxing-crescent` for [22.5, 67.5), and so on
 * round the cycle. Those are the boundaries this module states and holds to.
 * USNO's own `curphase` uses narrower windows than an octant — measured against
 * it on 2026-10-09, it printed "Waxing Crescent" at an elongation of 19 degrees
 * and again at 85 — so these names are held to the fifty published phase
 * INSTANTS in the tests, where the two conventions cannot disagree, rather than
 * to `curphase`.
 */
import { wrap180 } from "./angles.js";
import { instantFromJulianEphemerisDay, julianEphemerisDay, type SkyInstant } from "./julian.js";
import { moonApparentEclipticLongitudeDegrees, moonIllumination } from "./moon.js";
import { sunApparentEclipticLongitudeDegrees } from "./sun.js";

/** The eight names, in order round the cycle from new moon. */
export const MOON_PHASE_NAMES = [
  "new",
  "waxing-crescent",
  "first-quarter",
  "waxing-gibbous",
  "full",
  "waning-gibbous",
  "last-quarter",
  "waning-crescent",
] as const;

export type MoonPhaseName = (typeof MOON_PHASE_NAMES)[number];

/** The four instants of the next principal phases, at or after the instant asked about. */
export interface NextMoonPhases {
  readonly newMoon: Date;
  readonly firstQuarter: Date;
  readonly fullMoon: Date;
  readonly lastQuarter: Date;
}

/** What the Moon looks like from anywhere on the Earth at one instant. */
export interface MoonPhaseReading {
  readonly phase: MoonPhaseName;
  /**
   * The Moon's elongation: its apparent ecliptic longitude less the Sun's,
   * degrees in [0, 360). 0 is new, 180 is full, and values below 180 are waxing.
   */
  readonly elongation: number;
  /** Fraction of the disk lit, 0 to 1. */
  readonly illuminatedFraction: number;
  /** The Sun-Moon-Earth angle, degrees: 0 at full moon, 180 at new. */
  readonly phaseAngle: number;
  /** Days since the last new moon, 0 to about 29.8. */
  readonly ageDays: number;
}

/** The name an elongation falls in. Exported for the boundary it has to state. */
export function moonPhaseName(elongation: number): MoonPhaseName {
  const octant = Math.floor((((elongation % 360) + 360) % 360) / 45 + 0.5) % 8;
  return MOON_PHASE_NAMES[octant]!;
}

/** The Moon's elongation at a Julian Ephemeris Day, degrees in [0, 360). */
function elongationDegrees(jde: number): number {
  const elongation =
    moonApparentEclipticLongitudeDegrees(jde) - sunApparentEclipticLongitudeDegrees(jde);
  return ((elongation % 360) + 360) % 360;
}

/** How far the elongation is from a target, in (-180, 180] — zero exactly at the phase. */
function gapTo(target: number, jde: number): number {
  return wrap180(elongationDegrees(jde) - target);
}

/**
 * The next instant at or after `fromJde` at which the elongation equals
 * `target`, by scanning a day at a time and then bisecting the bracket that
 * straddles it. The elongation gains 12.19 degrees a day, so a one-day step
 * cannot stride over the crossing, and the sawtooth wrap 360 degrees away is a
 * downward step and is skipped rather than bisected.
 */
function nextPhaseJde(target: number, fromJde: number): number {
  let low = fromJde;
  let lowGap = gapTo(target, low);
  for (let day = 0; day < 45; day += 1) {
    const high = low + 1;
    const highGap = gapTo(target, high);
    if (lowGap <= 0 && highGap > 0) return bisectGap(target, low, high);
    low = high;
    lowGap = highGap;
  }
  // Unreachable for a well-defined phase: the synodic month is 29.53 days, so a
  // 45-day scan cannot miss one. A wrong answer here would be a silent forty
  // days of error, which is why the scan is this long rather than barely long
  // enough.
  throw new Error("no principal phase found within 45 days");
}

function bisectGap(target: number, low: number, high: number): number {
  let below = low;
  let above = high;
  let belowGap = gapTo(target, below);
  for (let step = 0; step < 60 && above - below > 1e-6; step += 1) {
    const middle = (below + above) / 2;
    const middleGap = gapTo(target, middle);
    if ((belowGap <= 0) === (middleGap <= 0)) {
      below = middle;
      belowGap = middleGap;
    } else {
      above = middle;
    }
  }
  return (below + above) / 2;
}

/** The most recent new moon at or before a Julian Ephemeris Day. */
function previousNewMoonJde(fromJde: number): number {
  let high = fromJde;
  let highGap = gapTo(0, high);
  for (let day = 0; day < 45; day += 1) {
    const low = high - 1;
    const lowGap = gapTo(0, low);
    if (lowGap <= 0 && highGap > 0) return bisectGap(0, low, high);
    high = low;
    highGap = lowGap;
  }
  throw new Error("no new moon found within 45 days");
}

/** The Moon's phase, illumination and age at an instant. */
export function moonPhase(at: SkyInstant): MoonPhaseReading {
  const jde = julianEphemerisDay(at);
  const elongation = elongationDegrees(jde);
  const illumination = moonIllumination(jde);
  return {
    phase: moonPhaseName(elongation),
    elongation,
    illuminatedFraction: illumination.illuminatedFraction,
    phaseAngle: illumination.phaseAngle,
    ageDays: jde - previousNewMoonJde(jde),
  };
}

/** The next new moon, first quarter, full moon and last quarter at or after an instant. */
export function nextMoonPhases(at: SkyInstant): NextMoonPhases {
  const jde = julianEphemerisDay(at);
  const instantOf = (target: number): Date => instantFromJulianEphemerisDay(nextPhaseJde(target, jde));
  return {
    // The four targets are the definition of the four phases, stated once.
    newMoon: instantOf(0),
    firstQuarter: instantOf(90),
    fullMoon: instantOf(180),
    lastQuarter: instantOf(270),
  };
}
