/**
 * The Earth's own orientation and figure, which is what turns a direction among
 * the stars into a direction in somebody's sky:
 *
 *  - the obliquity of the ecliptic and the nutation (ch. 22, "Nutation and the
 *    Obliquity of the Ecliptic"), in the 0.5-arcsecond abridgement the same
 *    chapter gives for work of this precision;
 *  - Greenwich sidereal time (ch. 12, "Sidereal Time at Greenwich"), apparent
 *    rather than mean, because the hour angle this module hands to ch. 13 has to
 *    be measured from the true equinox;
 *  - the observer's geocentric radius and reduced latitude (ch. 11, "The
 *    Figure of the Earth"), which is the whole of what makes the Moon's
 *    parallax computable outside the geocentre.
 *
 * The ephemeris functions take a Julian Ephemeris Day. The two exceptions are
 * the ones whose argument is not an ephemeris time at all:
 * {@link apparentSiderealTimeDegrees} takes the day in UT, because the Earth's
 * rotation is what it reads (its own comment says why that is not a detail), and
 * {@link observerFigure} takes a latitude, being a fact about a place — at sea
 * level, with no height above the ellipsoid, exactly as USNO's own one-day
 * answer assumes and as this engine's answers are compared against.
 */
import { ARCSECONDS_PER_DEGREE, cosDeg, normalize360, sinDeg, tanDeg, toDegrees } from "./angles.js";

/** JDE of the standard epoch J2000.0, the origin every T in this module is measured from. */
export const J2000_JULIAN_EPHEMERIS_DAY = 2_451_545;

/** Julian centuries of 36 525 days since J2000.0. */
export function julianCenturies(jde: number): number {
  return (jde - J2000_JULIAN_EPHEMERIS_DAY) / 36_525;
}

/** 23 degrees 26 minutes 21.448 seconds — the obliquity at J2000.0 (ch. 22). */
const OBLIQUITY_AT_J2000_DEGREES = 23 + 26 / 60 + 21.448 / ARCSECONDS_PER_DEGREE;

/**
 * The mean obliquity of the ecliptic (ch. 22, eq. 22.2): the arcsecond terms are
 * the published ones, so a reader can check the constants against the chapter
 * rather than against this file.
 */
export function meanObliquityDegrees(jde: number): number {
  const t = julianCenturies(jde);
  return (
    OBLIQUITY_AT_J2000_DEGREES +
    (-46.815 * t - 0.00059 * t * t + 0.001813 * t * t * t) / ARCSECONDS_PER_DEGREE
  );
}

/** The two nutation angles, in degrees: in longitude (Δψ, east-positive) and in obliquity (Δε). */
export interface Nutation {
  readonly longitude: number;
  readonly obliquity: number;
}

/**
 * Nutation in longitude and obliquity (ch. 22's abridged series, accurate to
 * about 0.5" and 0.1"): four terms each, enough that the apparent sidereal time
 * and the apparent longitude carry it to the arcsecond this module's arithmetic
 * works at. The full 63-term table buys the last half arcsecond and nothing a
 * rise time can see.
 */
export function nutationDegrees(jde: number): Nutation {
  const t = julianCenturies(jde);
  const ascendingNode = 125.04452 - 1934.136261 * t;
  const sunMeanLongitude = 280.4665 + 36000.7698 * t;
  const moonMeanLongitude = 218.3165 + 481267.8813 * t;
  const longitudeArcseconds =
    -17.2 * sinDeg(ascendingNode) -
    1.32 * sinDeg(2 * sunMeanLongitude) -
    0.23 * sinDeg(2 * moonMeanLongitude) +
    0.21 * sinDeg(2 * ascendingNode);
  const obliquityArcseconds =
    9.2 * cosDeg(ascendingNode) +
    0.57 * cosDeg(2 * sunMeanLongitude) +
    0.1 * cosDeg(2 * moonMeanLongitude) -
    0.09 * cosDeg(2 * ascendingNode);
  return {
    longitude: longitudeArcseconds / ARCSECONDS_PER_DEGREE,
    obliquity: obliquityArcseconds / ARCSECONDS_PER_DEGREE,
  };
}

/**
 * Apparent sidereal time at the observer's meridian, in degrees — Greenwich's,
 * plus the longitude (east-positive), plus the nutation's own 1.1" of rotation.
 *
 * **The argument is UT, not TT.** A sidereal time is a reading of the Earth's
 * rotation, and the Earth's rotation is what UT1 measures; Meeus's ch. 12 works
 * from the day's UT for that reason. Feeding it {@link julianEphemerisDay}
 * instead is 75 seconds of rotation in 2026, which is 0.31 degrees of hour
 * angle, which is 1.2 minutes of rise time — the same size as the tolerance this
 * module's whole product is judged at, so the two arguments are not
 * interchangeable even though the nutation term inside is negligible either way.
 *
 * Meeus works ch. 12 in hours at 0h UT and then adds 1.002 737 909 35 times the
 * UT interval; the equivalent single expression in degrees is used here, because
 * this module has an arbitrary instant in hand rather than a day plus a
 * remainder.
 */
export function apparentSiderealTimeDegrees(julianDay: number, longitudeEast = 0): number {
  const t = julianCenturies(julianDay);
  const days = julianDay - J2000_JULIAN_EPHEMERIS_DAY;
  const mean =
    280.46061837 + 360.98564736629 * days + 0.000387933 * t * t - (t * t * t) / 38_710_000;
  const nutation = nutationDegrees(julianDay);
  const trueObliquity = meanObliquityDegrees(julianDay) + nutation.obliquity;
  return normalize360(mean + longitudeEast + nutation.longitude * cosDeg(trueObliquity));
}

/** The observer, as ch. 11's two numbers. */
export interface ObserverFigure {
  /** Geocentric radius in equatorial radii, times the sine of the reduced latitude. */
  readonly rhoSin: number;
  /** The same radius times the cosine. */
  readonly rhoCos: number;
}

/** The ratio of the Earth's polar to equatorial radius, WGS-84 (ch. 11 uses it as 0.996 647 19). */
const POLAR_TO_EQUATORIAL_RADIUS = 0.99664719;

/**
 * An observer's geocentric radius and reduced latitude (ch. 11, eq. 11.1): what
 * the Moon's parallax is measured from, and the reason two observers on the same
 * meridian see it half a degree apart.
 *
 * At sea level, so the two closure checks are exact and hand-checkable: on the
 * equator cos φ' is 1 and sin φ' is 0, and at a pole sin φ' is exactly the
 * flattening ratio above and cos φ' is 0.
 */
export function observerFigure(latitudeDegrees: number): ObserverFigure {
  const reducedLatitude = toDegrees(Math.atan(POLAR_TO_EQUATORIAL_RADIUS * tanDeg(latitudeDegrees)));
  return {
    rhoSin: POLAR_TO_EQUATORIAL_RADIUS * sinDeg(reducedLatitude),
    rhoCos: cosDeg(reducedLatitude),
  };
}
