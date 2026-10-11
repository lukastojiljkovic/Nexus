/**
 * The Sun's apparent position (Meeus ch. 25, "Solar Coordinates" — the
 * low-accuracy method, which the chapter itself rates at 0.01 degrees).
 *
 * That rating needs translating into this module's currency: the Sun moves
 * about a degree a day, so a hundredth of a degree is fifteen seconds of rise
 * time, well inside the minute a rise is published to. The chapter's
 * high-accuracy VSOP87 route buys two more decimal places and none of that
 * currency.
 *
 * Two longitudes come out of this file and the difference between them is
 * deliberate. The APPARENT longitude (eq. 25.8) carries aberration and nutation,
 * and is what a principal phase is measured against, because that is how the
 * Astronomical Almanac defines one; the GEOMETRIC one (eq. 25.5) is the Sun's
 * true place on the ecliptic, and is what ch. 48's phase angle — an angle
 * between three bodies, not a comparison of two clocks — is built from. They
 * differ by 20 arcseconds, which is forty seconds of phase instant.
 */
import { asinDeg, atan2Deg, cosDeg, normalize360, sinDeg, wrap180 } from "./angles.js";
import { apparentSiderealTimeDegrees, julianCenturies, meanObliquityDegrees, nutationDegrees } from "./earth.js";
import {
  horizontalFromEquatorial,
  refractionDegrees,
  topocentricEquatorial,
  type SkyPlace,
  type SkyPosition,
} from "./horizontal.js";
import { julianDay, julianEphemerisDay, type SkyInstant } from "./julian.js";

/** The solar parallax at one astronomical unit, in arcseconds (ch. 25). */
const SOLAR_PARALLAX_AT_ONE_AU_ARCSECONDS = 8.794;

/** The Sun's apparent geocentric place, with the quantities the phases are built from. */
export interface SunEquatorial {
  /** Degrees in [0, 360). */
  readonly rightAscension: number;
  /** Degrees. */
  readonly declination: number;
  /** Apparent geocentric ecliptic longitude, degrees in [0, 360) (eq. 25.8). */
  readonly apparentLongitude: number;
  /** Distance in astronomical units (eq. 25.5). */
  readonly distanceAu: number;
}

/** Where the Sun is in the sky, with the geocentric place it came from. */
export interface SunPosition extends SkyPosition {
  /** Apparent geocentric right ascension, degrees. */
  readonly rightAscension: number;
  /** Apparent geocentric declination, degrees. */
  readonly declination: number;
  /** Local hour angle of the geocentric Sun, degrees in (-180, 180]: 0 at upper transit. */
  readonly hourAngle: number;
}

/**
 * The quantities ch. 25 builds the Sun out of, computed together because every
 * public function below needs at least two of them, and because recomputing the
 * equation of the centre by subtracting two longitudes is how a rounding
 * artefact becomes a distance that is wrong in the fourth decimal.
 */
interface SunTerms {
  readonly centuries: number;
  readonly meanAnomaly: number;
  readonly eccentricity: number;
  readonly equationOfCentre: number;
  /** The true longitude (eq. 25.5): mean longitude plus equation of the centre. */
  readonly trueLongitude: number;
}

function sunTerms(jde: number): SunTerms {
  const t = julianCenturies(jde);
  const meanLongitude = 280.46646 + 36000.76983 * t + 0.0003032 * t * t;
  const meanAnomaly = 357.52911 + 35999.05029 * t - 0.0001537 * t * t;
  const equationOfCentre =
    (1.914602 - 0.004817 * t - 0.000014 * t * t) * sinDeg(meanAnomaly) +
    (0.019993 - 0.000101 * t) * sinDeg(2 * meanAnomaly) +
    0.000289 * sinDeg(3 * meanAnomaly);
  return {
    centuries: t,
    meanAnomaly,
    eccentricity: 0.016708634 - 0.000042037 * t - 0.0000001267 * t * t,
    equationOfCentre,
    trueLongitude: meanLongitude + equationOfCentre,
  };
}

/** The Sun's true (geometric) geocentric ecliptic longitude, degrees (eq. 25.5). */
export function sunGeometricEclipticLongitudeDegrees(jde: number): number {
  return normalize360(sunTerms(jde).trueLongitude);
}

/**
 * The Sun's apparent ecliptic longitude (eq. 25.8): the true longitude less
 * 20.5" of aberration and 17.2" of nutation, which the chapter folds into one
 * expression in the Moon's ascending node.
 */
export function sunApparentEclipticLongitudeDegrees(jde: number): number {
  return apparentLongitudeOf(sunTerms(jde));
}

function apparentLongitudeOf(terms: SunTerms): number {
  const ascendingNode = 125.04 - 1934.136 * terms.centuries;
  return normalize360(terms.trueLongitude - 0.00569 - 0.00478 * sinDeg(ascendingNode));
}

/**
 * The apparent geocentric Sun (ch. 25, then ch. 13's ecliptic-to-equatorial
 * rotation).
 *
 * The obliquity here is ch. 22's — {@link meanObliquityDegrees} plus the
 * nutation in obliquity — rather than eq. 25.8's own
 * `epsilon = epsilon0 + 0.00256 cos Omega` shortcut. Those are the same number
 * to a thousandth of an arcsecond (the shortcut is the nutation's leading term
 * written out), and the general one keeps a single definition of the obliquity
 * in this module.
 */
export function sunEquatorial(jde: number): SunEquatorial {
  const terms = sunTerms(jde);
  const apparentLongitude = apparentLongitudeOf(terms);
  const trueObliquity = meanObliquityDegrees(jde) + nutationDegrees(jde).obliquity;
  const trueAnomaly = terms.meanAnomaly + terms.equationOfCentre;
  return {
    rightAscension: normalize360(
      atan2Deg(cosDeg(trueObliquity) * sinDeg(apparentLongitude), cosDeg(apparentLongitude)),
    ),
    declination: asinDeg(sinDeg(trueObliquity) * sinDeg(apparentLongitude)),
    apparentLongitude,
    distanceAu:
      (1.000001018 * (1 - terms.eccentricity * terms.eccentricity)) /
      (1 + terms.eccentricity * cosDeg(trueAnomaly)),
  };
}

/** Where the Sun is in the sky, for a place and an instant. */
export function sunPosition(place: SkyPlace, at: SkyInstant): SunPosition {
  const jde = julianEphemerisDay(at);
  const sun = sunEquatorial(jde);
  // The sidereal time is read at the instant itself, in UT — see earth.ts.
  const sidereal = apparentSiderealTimeDegrees(julianDay(at), place.longitude);
  const seen = topocentricEquatorial(
    {
      rightAscension: sun.rightAscension,
      declination: sun.declination,
      // The parallax shrinks as the Sun's distance grows; 8.794" is quoted at 1 AU.
      horizontalParallax: SOLAR_PARALLAX_AT_ONE_AU_ARCSECONDS / sun.distanceAu / 3600,
    },
    place,
    sidereal,
  );
  const { azimuth, altitude } = horizontalFromEquatorial(place, seen, sidereal);
  return {
    azimuth,
    altitude,
    apparentAltitude: altitude + refractionDegrees(altitude),
    rightAscension: sun.rightAscension,
    declination: sun.declination,
    hourAngle: wrap180(sidereal - sun.rightAscension),
  };
}
