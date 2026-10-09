/**
 * Degree/radian plumbing. Meeus writes every formula here in degrees, and so
 * does the rest of this module: the conversions happen at the trigonometric
 * call and nowhere else. Nothing in this file is exported from the package.
 */

const DEGREES_PER_RADIAN = 180 / Math.PI;
export const ARCSECONDS_PER_DEGREE = 3600;
export const ARCMINUTES_PER_DEGREE = 60;

export function toRadians(degrees: number): number {
  return degrees / DEGREES_PER_RADIAN;
}

export function toDegrees(radians: number): number {
  return radians * DEGREES_PER_RADIAN;
}

export function sinDeg(degrees: number): number {
  return Math.sin(toRadians(degrees));
}

export function cosDeg(degrees: number): number {
  return Math.cos(toRadians(degrees));
}

export function tanDeg(degrees: number): number {
  return Math.tan(toRadians(degrees));
}

export function asinDeg(value: number): number {
  return toDegrees(Math.asin(value));
}

export function acosDeg(value: number): number {
  return toDegrees(Math.acos(value));
}

export function atan2Deg(y: number, x: number): number {
  return toDegrees(Math.atan2(y, x));
}

/** The same angle, in [0, 360). */
export function normalize360(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * The same angle, in (-180, 180] — the frame a difference of two angles is read
 * in, and therefore the frame an hour angle is in. It deliberately keeps 180 as
 * 180 rather than folding it to -180: "the Moon is exactly opposite the Sun" is
 * pressable in degrees, and a reader comparing a phase angle against this
 * should not have to know which of the two ends the implementation picked.
 */
export function wrap180(degrees: number): number {
  const normalized = normalize360(degrees);
  return normalized > 180 ? normalized - 360 : normalized;
}

/** Clamps into [-1, 1], so a value a hair outside it by rounding does not turn `asin` into NaN. */
export function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}
