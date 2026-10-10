/**
 * The Moon: its ecliptic position (Meeus ch. 47, "Position of the Moon", the
 * abridged ELP-2000/82 series of Table 47.A and Table 47.B), its topocentric
 * place in the sky (ch. 40), and what the Sun does to its disk (ch. 48,
 * "Illuminated Fraction of the Moon's Disk").
 *
 * **The tables are the algorithm and they are transcribed whole.** Sixty
 * longitude and distance terms, sixty latitude terms, in the chapter's own
 * order, with the arguments as row [D, M, M', F] — the mean elongation, the
 * Sun's mean anomaly, the Moon's mean anomaly and the Moon's argument of
 * latitude. Meeus's Σl and Σb are sums of SINES of those arguments and Σr is a
 * sum of COSINES, which is the one detail in the transcription that a reader
 * cannot check by eye; the distance it produces for his example 47.a
 * (368 409.7 km) is what the test holds it to. That test earns its keep: the
 * first pass of this file had six of the sixty distance coefficients wrong, and
 * the chapter's own number is what refused them.
 *
 * The terms with the Sun's mean anomaly carry the eccentricity factor E, and E
 * is applied once for M = ±1 and twice for M = ±2 — the reason the rows are
 * walked rather than unrolled into two hand-written sums.
 */
import { acosDeg, asinDeg, atan2Deg, clampUnit, cosDeg, normalize360, sinDeg, tanDeg, wrap180 } from "./angles.js";
import {
  apparentSiderealTimeDegrees,
  julianCenturies,
  meanObliquityDegrees,
  nutationDegrees,
} from "./earth.js";
import {
  EARTH_EQUATORIAL_RADIUS_KM,
  horizontalFromEquatorial,
  refractionDegrees,
  topocentricEquatorial,
  type SkyPlace,
  type SkyPosition,
} from "./horizontal.js";
import { julianDay, julianEphemerisDay, type SkyInstant } from "./julian.js";
import { sunGeometricEclipticLongitudeDegrees } from "./sun.js";

/** The Moon's geocentric ecliptic place: the three numbers ch. 47 works out. */
export interface MoonEcliptic {
  /** Geometric geocentric ecliptic longitude, degrees in [0, 360). Nutation is not in it. */
  readonly longitude: number;
  /** Geocentric ecliptic latitude, degrees (small: the orbit is within 5.2 degrees). */
  readonly latitude: number;
  /** Geocentric distance in kilometres. */
  readonly distanceKm: number;
}

/** Where the Moon is, as seen from a place on the surface. */
export interface MoonPosition extends SkyPosition {
  /** Apparent GEOCENTRIC right ascension, degrees — what an almanac prints. */
  readonly rightAscension: number;
  /** Apparent geocentric declination, degrees. */
  readonly declination: number;
  /** Geocentric distance in kilometres, the distance almanacs quote. */
  readonly distanceKm: number;
  /** Geocentric horizontal parallax, degrees — about 1 degree. */
  readonly horizontalParallax: number;
  /** Local hour angle of the geocentric Moon, degrees in (-180, 180]: 0 at upper transit. */
  readonly hourAngle: number;
  /** Fraction of the disk lit, 0 (new) to 1 (full) (eq. 48.1). */
  readonly illuminatedFraction: number;
  /** The Sun-Moon-Earth angle, degrees: 0 at full moon, 180 at new (eq. 48.2). */
  readonly phaseAngle: number;
}

/** Table 47.A, as [D, M, M', F, longitude coefficient, distance coefficient]. */
const LONGITUDE_AND_DISTANCE_TERMS: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950],
  [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0],
  [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616],
  [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117],
  [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423],
  [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571],
  [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0],
  [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0],
  [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0],
  [2, 0, -1, -2, 0, 8752],
];

/** Table 47.B, as [D, M, M', F, latitude coefficient]. */
const LATITUDE_TERMS: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065],
  [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828],
  [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565],
  [1, 0, 0, 1, -1491],
  [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344],
  [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021],
  [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777],
  [4, 0, -2, 1, 671],
  [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596],
  [2, -1, 1, -1, 491],
  [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439],
  [2, 0, 2, 1, 422],
  [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366],
  [2, 1, 0, 1, -351],
  [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315],
  [2, -2, 0, -1, 302],
  [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229],
  [1, 1, 0, -1, 223],
  [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220],
  [2, 1, -1, -1, -220],
  [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181],
  [0, 1, 2, 1, -177],
  [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166],
  [1, 0, 1, -1, -164],
  [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119],
  [4, -1, 0, -1, 115],
  [2, -2, 0, 1, 107],
];

/** The Moon's geocentric ecliptic place at a Julian Ephemeris Day (ch. 47). */
export function moonEcliptic(jde: number): MoonEcliptic {
  const t = julianCenturies(jde);
  const meanLongitude =
    218.3164477 + 481267.88123421 * t - 0.0015786 * t * t + cube(t) / 538_841 - fourth(t) / 65_194_000;
  const elongation =
    297.8501921 + 445267.1114034 * t - 0.0018819 * t * t + cube(t) / 545_868 - fourth(t) / 113_065_000;
  const sunAnomaly = 357.5291092 + 35999.0502909 * t - 0.0001536 * t * t + cube(t) / 24_490_000;
  const moonAnomaly =
    134.9633964 + 477198.8675055 * t + 0.0087414 * t * t + cube(t) / 69_699 - fourth(t) / 14_712_000;
  const argumentOfLatitude =
    93.272095 + 483202.0175233 * t - 0.0036539 * t * t - cube(t) / 3_526_000 + fourth(t) / 863_310_000;
  const eccentricity = 1 - 0.002516 * t - 0.0000074 * t * t;

  let sumLongitude = 0;
  let sumDistance = 0;
  for (const [d, m, moon, f, longitudeCoefficient, distanceCoefficient] of LONGITUDE_AND_DISTANCE_TERMS) {
    const argument = d * elongation + m * sunAnomaly + moon * moonAnomaly + f * argumentOfLatitude;
    const eccentricityFactor = m === 0 ? 1 : Math.abs(m) === 1 ? eccentricity : eccentricity * eccentricity;
    sumLongitude += longitudeCoefficient * eccentricityFactor * sinDeg(argument);
    sumDistance += distanceCoefficient * eccentricityFactor * cosDeg(argument);
  }
  let sumLatitude = 0;
  for (const [d, m, moon, f, latitudeCoefficient] of LATITUDE_TERMS) {
    const argument = d * elongation + m * sunAnomaly + moon * moonAnomaly + f * argumentOfLatitude;
    const eccentricityFactor = m === 0 ? 1 : Math.abs(m) === 1 ? eccentricity : eccentricity * eccentricity;
    sumLatitude += latitudeCoefficient * eccentricityFactor * sinDeg(argument);
  }

  // The additive terms: the Moon's orbit's own precession and the Venus/Jupiter
  // perturbations, which the 60+60 sums above do not carry (ch. 47's eq. 47.4).
  const a1 = 119.75 + 131.849 * t;
  const a2 = 53.09 + 479264.29 * t;
  const a3 = 313.45 + 481266.484 * t;
  sumLongitude += 3958 * sinDeg(a1) + 1962 * sinDeg(meanLongitude - argumentOfLatitude) + 318 * sinDeg(a2);
  sumLatitude +=
    -2235 * sinDeg(meanLongitude) +
    382 * sinDeg(a3) +
    175 * sinDeg(a1 - argumentOfLatitude) +
    175 * sinDeg(a1 + argumentOfLatitude) +
    127 * sinDeg(meanLongitude - moonAnomaly) -
    115 * sinDeg(meanLongitude + moonAnomaly);

  return {
    longitude: normalize360(meanLongitude + sumLongitude / 1_000_000),
    latitude: sumLatitude / 1_000_000,
    distanceKm: 385000.56 + sumDistance / 1000,
  };
}

/**
 * The Moon's apparent geocentric ecliptic longitude — the ecliptic authority
 * the phase instants are solved against, the Moon's own longitude plus the same
 * nutation the Sun's apparent longitude carries, so that the nutation cancels
 * in their difference and the elongation keeps only the Sun's 20.5" of
 * aberration, which is the Almanac's definition of a phase.
 */
export function moonApparentEclipticLongitudeDegrees(jde: number): number {
  return normalize360(moonEcliptic(jde).longitude + nutationDegrees(jde).longitude);
}

/**
 * The illuminated fraction of the Moon's disk and the phase angle (ch. 48,
 * eq. 48.1 and 48.2), from the GEOMETRIC longitudes of the two bodies: this is
 * an angle between the Sun, the Moon and the Earth, so it is a construction of
 * the triangle and not a reading of two apparent places.
 */
export function moonIllumination(jde: number): { readonly illuminatedFraction: number; readonly phaseAngle: number } {
  return illuminationOf(moonEcliptic(jde), jde);
}

/**
 * The same, for a caller that already has the Moon's ecliptic place — which
 * `moonPosition` does, and which matters: the 120 periodic terms are the most
 * expensive thing in this module, and computing them twice per position (once
 * for the position, once for what the disk looks like) doubled the cost of
 * every sample of a day-long scan.
 */
function illuminationOf(
  moon: MoonEcliptic,
  jde: number,
): { readonly illuminatedFraction: number; readonly phaseAngle: number } {
  const cosPhaseAngle =
    -cosDeg(moon.latitude) * cosDeg(moon.longitude - sunGeometricEclipticLongitudeDegrees(jde));
  return {
    illuminatedFraction: (1 + cosPhaseAngle) / 2,
    phaseAngle: acosDeg(clampUnit(cosPhaseAngle)),
  };
}

/** Where the Moon is in the sky, for a place and an instant. */
export function moonPosition(place: SkyPlace, at: SkyInstant): MoonPosition {
  const jde = julianEphemerisDay(at);
  const ecliptic = moonEcliptic(jde);
  const nutation = nutationDegrees(jde);
  const trueObliquity = meanObliquityDegrees(jde) + nutation.obliquity;
  const longitude = ecliptic.longitude + nutation.longitude;
  const latitude = ecliptic.latitude;
  // Ch. 13's rotation of an ecliptic direction into the equatorial frame.
  const geocentric = {
    rightAscension: normalize360(
      atan2Deg(
        sinDeg(longitude) * cosDeg(trueObliquity) - tanDeg(latitude) * sinDeg(trueObliquity),
        cosDeg(longitude),
      ),
    ),
    declination: asinDeg(
      sinDeg(latitude) * cosDeg(trueObliquity) + cosDeg(latitude) * sinDeg(trueObliquity) * sinDeg(longitude),
    ),
    // Ch. 40's eq. 40.1: the equatorial radius is what the Moon's parallax is
    // measured with, and it is why 6378.14 km rather than 6371 km.
    horizontalParallax: asinDeg(clampUnit(EARTH_EQUATORIAL_RADIUS_KM / ecliptic.distanceKm)),
  };
  const sidereal = apparentSiderealTimeDegrees(julianDay(at), place.longitude);
  const seen = topocentricEquatorial(geocentric, place, sidereal);
  const { azimuth, altitude } = horizontalFromEquatorial(place, seen, sidereal);
  const illumination = illuminationOf(ecliptic, jde);
  return {
    azimuth,
    altitude,
    apparentAltitude: altitude + refractionDegrees(altitude),
    rightAscension: geocentric.rightAscension,
    declination: geocentric.declination,
    distanceKm: ecliptic.distanceKm,
    horizontalParallax: geocentric.horizontalParallax,
    hourAngle: wrap180(sidereal - geocentric.rightAscension),
    illuminatedFraction: illumination.illuminatedFraction,
    phaseAngle: illumination.phaseAngle,
  };
}

function cube(value: number): number {
  return value * value * value;
}

function fourth(value: number): number {
  const squared = value * value;
  return squared * squared;
}
