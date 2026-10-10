/**
 * Vector and frame plumbing for the solar-system engine, in the ecliptic J2000
 * frame every position in `contract.ts` is expressed in.
 *
 * Two rotations live here and nowhere else, because both are easy to invert by
 * accident and impossible to see in a number: the ecliptic-to-equatorial
 * obliquity rotation of the pole directions (IAU's rotation models are written
 * in the ICRF, the contract asks for the ecliptic), and the vector arithmetic
 * that turns spherical ecliptic coordinates into a position. Nothing in this
 * file is exported from the package.
 */
import { cosDeg, sinDeg } from "./angles.js";
import type { Vector3 } from "./contract.js";

/**
 * The inclination of the ecliptic at J2000.0, degrees: JPL's own value in
 * arcseconds (84381.448", quoted on the "Reference frame and coordinates" page
 * that `approx_pos.html` and the Horizons ecliptic output both name).
 */
export const OBLIQUITY_AT_J2000_DEGREES = 84381.448 / 3600;

/** The cross product, in the order that keeps a right-handed frame right-handed. */
export function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** The Euclidean length. */
export function magnitude(v: Vector3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/** `a - b`, the one operation the Earth-Moon barycentre correction is. */
export function subtract(a: Vector3, b: Vector3): Vector3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** `a + b`. */
export function add(a: Vector3, b: Vector3): Vector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** `v` scaled by `factor`. */
export function scaled(v: Vector3, factor: number): Vector3 {
  return [v[0] * factor, v[1] * factor, v[2] * factor];
}

/**
 * A unit vector from right ascension and declination, in the EQUATORIAL
 * J2000/ICRF frame â€” the frame the IAU rotation models publish a pole in.
 */
export function fromRightAscensionDeclination(rightAscensionDeg: number, declinationDeg: number): Vector3 {
  const cosDec = cosDeg(declinationDeg);
  return [
    cosDec * cosDeg(rightAscensionDeg),
    cosDec * sinDeg(rightAscensionDeg),
    sinDeg(declinationDeg),
  ];
}

/**
 * The same unit vector in the ecliptic J2000 frame: a rotation about the
 * equinox by the ecliptic's own tilt. The equatorial X axis IS the ecliptic
 * frame's X axis (both are the J2000 equinox), so only Y and Z move.
 */
export function equatorialToEcliptic(v: Vector3): Vector3 {
  const cos = cosDeg(OBLIQUITY_AT_J2000_DEGREES);
  const sin = sinDeg(OBLIQUITY_AT_J2000_DEGREES);
  return [v[0], v[1] * cos + v[2] * sin, -v[1] * sin + v[2] * cos];
}

/** A unit vector from ecliptic longitude (`x`), latitude and distance in au. */
export function fromEcliptic(longitudeDeg: number, latitudeDeg: number, distanceAu: number): Vector3 {
  const cosLat = cosDeg(latitudeDeg);
  return [
    distanceAu * cosLat * cosDeg(longitudeDeg),
    distanceAu * cosLat * sinDeg(longitudeDeg),
    distanceAu * sinDeg(latitudeDeg),
  ];
}

/**
 * The body-fixed frame of a globe, as the three directions the contract needs:
 * `northPole` is the rotation axis, and `primeMeridian` is the body-fixed
 * x-axis, the direction of `W = 0`'s reference meridian rotated by `W` itself.
 *
 * IAU's model publishes a pole as a right ascension and declination, so the
 * body frame's z axis is that direction and its x axis lies in the body's
 * equator at W degrees from the node of that equator on the ICRF equator. The
 * Euler sequence that produces it is `Rz(W) Rx(90 - dec) Rz(90 + ra)`, carried
 * out here as explicit single-axis rotations so that a reader can check each
 * step against the report rather than trusting a multiplied matrix: `W` around
 * the body's pole, and `90 - dec` around the equator's node axis.
 */
export interface BodyFrame {
  readonly northPole: Vector3;
  readonly primeMeridian: Vector3;
}

export function bodyFrame(
  poleRightAscensionDeg: number,
  poleDeclinationDeg: number,
  primeMeridianDeg: number,
): BodyFrame {
  // The ICRF pole, then one 90-degree step to the equator's own node axis.
  const pole = fromRightAscensionDeclination(poleRightAscensionDeg, poleDeclinationDeg);
  const nodeLongitude = poleRightAscensionDeg + 90;
  const reference = fromRightAscensionDeclination(nodeLongitude, 0);
  // The node axis is where the body's equator cuts the ICRF equator: the
  // direction perpendicular to both poles. Rotating the reference vector by
  // the pole's co-declination about it swings the reference into the body's
  // own equator, which is what `Rx(90 - dec)` does in the report's sequence.
  const nodeAxis = cross([0, 0, 1], pole);
  const coDeclination = 90 - poleDeclinationDeg;
  const meridianBeforeW = [
    reference[0] * cosDeg(coDeclination) + cross(nodeAxis, reference)[0] * sinDeg(coDeclination),
    reference[1] * cosDeg(coDeclination) + cross(nodeAxis, reference)[1] * sinDeg(coDeclination),
    reference[2] * cosDeg(coDeclination) + cross(nodeAxis, reference)[2] * sinDeg(coDeclination),
  ] as Vector3;
  // Rodrigues about the pole by W; the axis is a unit vector and the vector is
  // perpendicular to it, so the simplified form is exact.
  const sinW = sinDeg(primeMeridianDeg);
  const cosW = cosDeg(primeMeridianDeg);
  const rotatedByW = cross(pole, meridianBeforeW);
  const primeMeridian = [
    meridianBeforeW[0] * cosW + rotatedByW[0] * sinW,
    meridianBeforeW[1] * cosW + rotatedByW[1] * sinW,
    meridianBeforeW[2] * cosW + rotatedByW[2] * sinW,
  ] as Vector3;
  return {
    northPole: equatorialToEcliptic(pole),
    primeMeridian: equatorialToEcliptic(primeMeridian),
  };
}
