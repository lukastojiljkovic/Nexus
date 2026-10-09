/**
 * The orientation helper: where true north is, once you know where the Sun is.
 *
 * This is the module's answer to a phone with no compass and no GPS but a known
 * time and a known place — and to any reader standing in a field who can see the
 * Sun and knows the hour. The Sun's azimuth for the place and instant comes from
 * {@link sunPosition} (ch. 25 and 13); the rest is one subtraction, because a
 * bearing is measured clockwise from north and so is an azimuth.
 *
 * The input is a SIGHTING, not a bearing: you say where the Sun sits relative to
 * the direction you are facing — straight ahead, so many degrees to your right —
 * because that is the only thing a person without an instrument can report.
 * `sunOffsetDegrees` is positive clockwise, so +90 is "the Sun is off my right
 * shoulder" and -90 is the left.
 *
 * What comes back is deliberately both: the Sun's own azimuth, so a caller can
 * print "the Sun is 24 degrees south of east" without recomputing it, and the
 * clockwise angle from straight ahead to north, which is the number you turn.
 */
import { normalize360 } from "./angles.js";
import type { SkyPlace } from "./horizontal.js";
import type { SkyInstant } from "./julian.js";
import { sunPosition } from "./sun.js";

/** Which way to turn. All degrees clockwise; both are directions, not offsets. */
export interface SunOrientation {
  /** The Sun's azimuth for the place and instant, degrees clockwise from true north. */
  readonly sunAzimuth: number;
  /** Degrees clockwise from straight ahead to true north: turn this far and you face north. */
  readonly northFromStraightAhead: number;
}

/**
 * The pure geometry: given where the Sun is and where the Sun appears in your
 * view, how far north is from straight ahead.
 *
 * Facing `sunAzimuth - sunOffset`, so north is the negative of that. With the
 * Sun due south and straight ahead, north is 180 degrees behind; with the Sun
 * due east and straight ahead, north is 270 clockwise (a quarter turn to the
 * left), and the arithmetic is `0 - 90`.
 */
export function northFromSun(sunAzimuth: number, sunOffsetDegrees = 0): number {
  return normalize360(sunOffsetDegrees - sunAzimuth);
}

/** The Sun's azimuth and where north lies relative to where you are facing. */
export function sunOrientation(
  place: SkyPlace,
  at: SkyInstant,
  sunOffsetDegrees = 0,
): SunOrientation {
  const sunAzimuth = sunPosition(place, at).azimuth;
  return { sunAzimuth, northFromStraightAhead: northFromSun(sunAzimuth, sunOffsetDegrees) };
}
