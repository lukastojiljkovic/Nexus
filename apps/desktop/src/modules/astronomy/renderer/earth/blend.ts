/**
 * Where it is day and where it is night, as arithmetic: the Sun's height at a
 * place, and how the day and night images are mixed there.
 *
 * **One fact, one file.** The map draws two layers and crossfades them, and the
 * crossfade is the only thing on it that could be wrong without looking wrong:
 * a bad ramp still produces a plausible picture. So the ramp is a pure function
 * of one number — the Sun's altitude above the horizon — with its anchors
 * stated here, and the raster below it in `EarthDayNightMap` calls it per pixel
 * rather than re-deriving it.
 *
 * **The altitude.** The Sun is directly overhead the subsolar point
 * (`DayNight.subsolar`, whose latitude is the Sun's declination), so the angle
 * between the Sun's direction and the vertical at a place is simply the place's
 * great-circle distance from that point, and the Sun's altitude is 90 degrees
 * less it. On a sphere that is exact and needs no ephemeris: the only input is
 * `dayNight`, which the engine computed. It ignores refraction and the Sun's
 * semi-diameter, exactly as `DayNight.terminator`'s own definition does ("the
 * Sun's centre on the horizon").
 *
 * **The bands.** Civil twilight ends when the Sun's centre is 6 degrees below
 * the horizon, nautical at 12 and astronomical at 18 — the three limits
 * `horizon.ts` solves its own twilight crossings against, restated here so the
 * picture and the panel's times are the same three lines. {@link twilightBand}
 * names the band a place is in; {@link dayNightWeights} is the crossfade: fully
 * day at the horizon, fully night once the Sun is 18 degrees down, and the three
 * bands in between as its three equal steps, so the civil band is where the city
 * lights first show and the astronomical one is where they are all there is. A
 * step per band rather than one long ramp is what makes each of the three
 * visible as its own transition, which is the thing the twilight bands ARE.
 */
import type { LatLon } from "@nexus/core";

/** The three twilight limits, in degrees of the Sun's centre below the horizon (Meeus ch. 15). */
export const TWILIGHT_LIMITS = {
  civil: -6,
  nautical: -12,
  astronomical: -18,
} as const;

/** Which of the five bands a place is in, at one instant. */
export type TwilightBand = "day" | "civil" | "nautical" | "astronomical" | "night";

/** How much of each layer a place shows. Both are in [0, 1] and they sum to 1. */
export interface DayNightWeights {
  readonly day: number;
  readonly night: number;
}

const DEGREES_PER_RADIAN = 180 / Math.PI;

/** The horizon: the altitude the Sun's centre has on the terminator `DayNight` carries. */
const HORIZON_ALTITUDE = 0;

/**
 * The four band boundaries as altitudes, high to low, in the order the ramp
 * walks them. The horizon is the top one and is not one of the three twilight
 * limits: it is where day ends and civil twilight begins, which is the line the
 * terminator itself is drawn on.
 */
const BAND_DEPTHS = [
  HORIZON_ALTITUDE,
  TWILIGHT_LIMITS.civil,
  TWILIGHT_LIMITS.nautical,
  TWILIGHT_LIMITS.astronomical,
];

/**
 * The Sun's altitude at a place, in degrees, given where it is overhead.
 *
 * `90 - distance(point, subsolar)`, the spherical law of cosines: a place 90
 * degrees from the subsolar point has the Sun on its horizon, and the subsolar
 * point itself has it in the zenith.
 */
export function solarAltitudeDegrees(point: LatLon, subsolar: LatLon): number {
  const lat = point.latDeg / DEGREES_PER_RADIAN;
  const subLat = subsolar.latDeg / DEGREES_PER_RADIAN;
  const hourAngle = (point.lonDeg - subsolar.lonDeg) / DEGREES_PER_RADIAN;
  const cosZenith =
    Math.sin(lat) * Math.sin(subLat) + Math.cos(lat) * Math.cos(subLat) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) * DEGREES_PER_RADIAN;
}

/**
 * The band an altitude falls in.
 *
 * A limit belongs to the band that ENDS there: the Sun at exactly -6 degrees is
 * at the last instant of civil twilight, so that is the band's name for it, and
 * the same at the horizon and at the other two limits. Every band therefore
 * includes its upper limit and excludes its lower one, no altitude lands in two
 * of them, and this naming sits beside {@link dayNightWeights} rather than
 * inside it: the weights are continuous across a limit (at -6 exactly a third of
 * the night image is there), while the name says which of the five stretches of
 * sky the place is in.
 */
export function twilightBand(altitudeDegrees: number): TwilightBand {
  if (altitudeDegrees >= BAND_DEPTHS[0]!) return "day";
  if (altitudeDegrees >= BAND_DEPTHS[1]!) return "civil";
  if (altitudeDegrees >= BAND_DEPTHS[2]!) return "nautical";
  if (altitudeDegrees >= BAND_DEPTHS[3]!) return "astronomical";
  return "night";
}

/**
 * The crossfade at an altitude: fully day at the horizon, one third of the way
 * to night at -6 degrees, two thirds at -12 and fully night at -18, linear
 * inside each band and constant outside the outermost.
 */
export function dayNightWeights(altitudeDegrees: number): DayNightWeights {
  // Each band contributes a third of the crossfade, in proportion to how far
  // into it the place has sunk; a band the Sun is still above contributes
  // nothing, because the clamp to that band's own ceiling makes its term zero.
  let night = 0;
  for (let step = 0; step < 3; step += 1) {
    const upper = BAND_DEPTHS[step]!;
    const lower = BAND_DEPTHS[step + 1]!;
    const depth = Math.min(Math.max(altitudeDegrees, lower), upper);
    night += (upper - depth) / (upper - lower) / 3;
  }
  // Three thirds of a double do not quite add to one, so the sum is pinned at
  // the end the ramp reaches: fully night is exactly 1 and exactly no day, which
  // is what a caller reading "is this place in the night image" needs.
  const nightWeight = Math.min(1, night);
  return { day: 1 - nightWeight, night: nightWeight };
}
