/**
 * Precession: an equatorial direction taken from one epoch to another (Meeus
 * ch. 21, "Precession").
 *
 * **Why the angles and not a matrix.** The chapter's reduction is three
 * rotation angles - zeta, z and theta - published for the IAU's 1976 model,
 * and the constants below are checked against the IAU's own implementation of
 * that model rather than against a retyping of the book: SOFA's `iauPrec76`
 * (`prec76.c`, `https://github.com/Starlink/sofa`, retrieved 2026-10-10) states
 * `w = 2306.2181 + (1.39656 - 0.000139 t0) t0` with the same three series this
 * file writes out. Meeus ch. 21 gives the same numbers.
 *
 * **What this is for, and how large it is.** A catalogue position is at J2000
 * and a sky is at the instant, and the difference between those two frames is
 * precession - the largest correction this module applies after the Earth's
 * rotation itself. The leading term, 2306.2181 arcseconds per century, is
 * 50.29 arcseconds a year, so the 26.8 years between J2000 and the epoch this
 * module is first asked about move a star by 1348 arcseconds: 0.37 degrees,
 * about three quarters of the Moon's width.
 *
 * **Where it sits in the chain, and what it deliberately is not.** Catalogue
 * direction -> {@link precessEquatorial} -> nutation -> aberration ->
 * horizontal (`stars.ts` runs the middle two). Proper motion is NOT applied
 * anywhere in this module: it is a property of one star rather than of the
 * frame, and the catalogue it reads carries positions, not velocities. Over
 * those 26.8 years that is under an arcsecond for almost every naked-eye star
 * and about a minute of arc for Arcturus, the fastest of them - stated in
 * `stars.ts`'s header rather than silently ignored.
 *
 * The interval is measured in Julian centuries of the same time argument the
 * rest of the engine uses, the Julian EPHEMERIS Day, because that is what the
 * series are functions of; over a quarter century the difference between the
 * two arguments is a thousandth of an arcsecond and does not matter, but the
 * moment UT becomes TT is stated here so nobody has to guess which one a
 * caller passed.
 */
import {
  ARCSECONDS_PER_DEGREE,
  asinDeg,
  atan2Deg,
  clampUnit,
  cosDeg,
  normalize360,
  sinDeg,
} from "./angles.js";
import { julianCenturies } from "./earth.js";

/** Days in a Julian century, the unit every `t` in Meeus's series is measured in. */
const DAYS_PER_JULIAN_CENTURY = 36_525;

/** A direction in the equatorial frame, right ascension in [0, 360) degrees. */
export interface EquatorialDirection {
  readonly rightAscension: number;
  readonly declination: number;
}

/** The three rotation angles of the 1976 precession, in degrees. */
export interface PrecessionAngles {
  /** Rotation about the ecliptic pole: the change in the equinox, east-positive. */
  readonly zeta: number;
  /** The same rotation applied after the frame has been tilted (`z`). */
  readonly z: number;
  /** The tilt between the two equators. */
  readonly theta: number;
}

/**
 * The 1976 precession angles for the interval between two Julian Ephemeris
 * Days, in degrees (Meeus eq. 21.2; SOFA's `iauPrec76`).
 *
 * `T` is the STARTING epoch's own distance from J2000 and `t` the interval
 * between the two, both in Julian centuries, which is the argument order the
 * series are published in - the reduction from 1980 to J2000 is not the
 * negative of the reduction from J2000 to 1980, and reading `T` off the wrong
 * end is how a precession routine ends up a thousandth of an arcsecond right
 * and a decade wrong.
 */
export function precessionAngles(fromJde: number, toJde: number): PrecessionAngles {
  const t0 = julianCenturies(fromJde);
  const t = (toJde - fromJde) / DAYS_PER_JULIAN_CENTURY;
  // The term every one of the three accumulates: the general precession in the
  // starting epoch's own frame.
  const w = 2306.2181 + (1.39656 - 0.000139 * t0) * t0;
  // The whole bracket is multiplied by the interval - the series is in powers
  // of `t`, and the leading term is `w t`, so an interval of zero is the
  // identity. Reading it as `w + ...` is a mistake that still looks plausible:
  // it turns the reduction from J2000 to J2000 into 0.64 degrees of rotation.
  return {
    zeta: ((w + ((0.30188 - 0.000344 * t0) + 0.017998 * t) * t) * t) / ARCSECONDS_PER_DEGREE,
    z: ((w + ((1.09468 + 0.000066 * t0) + 0.018203 * t) * t) * t) / ARCSECONDS_PER_DEGREE,
    theta:
      ((2004.3109 +
        (-0.8533 - 0.000217 * t0) * t0 +
        ((-0.42665 - 0.000217 * t0) - 0.041833 * t) * t) *
        t) /
      ARCSECONDS_PER_DEGREE,
  };
}

/**
 * A direction precessed from one epoch to another (Meeus eq. 21.4).
 *
 * The rotation is written the way the chapter writes it - three sines and
 * cosines composed into `A`, `B` and `C` and read back with `atan2`, which
 * carries the quadrant - rather than as a matrix product, so that a reader can
 * check it line by line against the book. The declination goes through
 * `clampUnit` because `asin` of a value a rounding step past 1 is NaN, and a
 * star at the pole is a star somebody will look at.
 */
export function precessEquatorial(
  position: EquatorialDirection,
  fromJde: number,
  toJde: number,
): EquatorialDirection {
  const { zeta, z, theta } = precessionAngles(fromJde, toJde);
  const rightAscension = position.rightAscension + zeta;
  const cosDec = cosDeg(position.declination);
  const sinDec = sinDeg(position.declination);
  const a = cosDec * sinDeg(rightAscension);
  const b = cosDeg(theta) * cosDec * cosDeg(rightAscension) - sinDeg(theta) * sinDec;
  const c = sinDeg(theta) * cosDeg(rightAscension) * cosDec + cosDeg(theta) * sinDec;
  return {
    rightAscension: normalize360(atan2Deg(a, b) + z),
    declination: asinDeg(clampUnit(c)),
  };
}
