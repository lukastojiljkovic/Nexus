/**
 * The Earth's day, night and twilight at one instant: what the "day and night
 * map" draws.
 *
 * **The subsolar and sublunar points are the two places where the body's hour
 * angle is zero**, which is a difference of two angles in the same frame:
 * `lon = siderealAngle - RA`, folded to (-180, 180]. The sidereal angle is the
 * Greenwich apparent sidereal time `earth.ts` supplies.
 *
 * **The subsolar point is GEOMETRIC**, and that is a correction rather than a
 * detail: it is the point the Sun is physically overhead of, so it uses the
 * Sun's true (unaberrated) place (Meeus ch. 25, eq. 25.5) rather than the
 * apparent place `sunEquatorial` publishes, whose 20.5 arcseconds of aberration
 * and eight minutes of the Sun's own motion are what an observer sees and what a
 * rise time is measured against. JPL Horizons' `SunSub-LON`/`SunSub-LAT` are the
 * geometric pair, and `earthView.test.ts` measures this engine against them.
 *
 * **The circles are stated, because "the terminator" is three different curves.**
 * The line drawn here is the Sun's CENTRE on the geometric horizon: every point
 * on it is exactly 90 degrees of arc from the subsolar point. That is the
 * convention `contract.ts` fixes ("the Sun's centre on the horizon"), and it is
 * 50 arcminutes from the two others in common use: a sunset is defined by the
 * Sun's upper limb 34' of refraction above the geometric horizon, which is a
 * 90.8333-degree circle, and the horizon the fully-refracted centre is seen at is
 * 90.5667 degrees. The three twilight edges are the same construction at 96, 102
 * and 108 degrees — the Sun's centre 6, 12 and 18 degrees below the geometric
 * horizon, which is how `horizon.ts` already defines civil, nautical and
 * astronomical twilight.
 *
 * **Each circle is closed and runs west to east.** It is `samples + 1` points,
 * the last repeating the first, and the points are spaced by the bearing around
 * the subsolar point rather than by longitude, so a polar circle is sampled as
 * evenly as an equatorial one. The repeat is there because an SVG `path` that
 * ends one step short of its start shows a wedge of nothing exactly at the date
 * line.
 */
import { asinDeg, atan2Deg, clampUnit, cosDeg, normalize360, sinDeg, tanDeg } from "./angles.js";
import {
  apparentSiderealTimeDegrees,
  meanObliquityDegrees,
  nutationDegrees,
} from "./earth.js";
import type { DayNight, LatLon } from "./contract.js";
import { julianDay, julianEphemerisDay, type SkyInstant } from "./julian.js";
import { moonEcliptic } from "./moon.js";
import { sunGeometricEclipticLongitudeDegrees } from "./sun.js";

/** The terminator's own spherical radius: the Sun's centre on the geometric horizon. */
export const TERMINATOR_ANGULAR_RADIUS_DEG = 90;

/**
 * The twilight edges, in degrees of arc from the subsolar point: the Sun's centre
 * 6, 12 and 18 degrees below the geometric horizon.
 */
export const TWILIGHT_ANGULAR_RADII_DEG = { civil: 96, nautical: 102, astronomical: 108 } as const;

/** The result's own `samples` default, named so the doc comment can point at it. */
const DEFAULT_SAMPLES = 360;

/** Sunlight's travel time to one astronomical unit, in days (IAU's c and au). */
const LIGHT_TIME_DAYS = 149_597_870.7 / 299_792.458 / 86_400;

/** A longitude in (-180, 180], the frame the contract's `LatLon` is read in. */
function wrapSignedLongitude(degrees: number): number {
  const normalized = normalize360(degrees);
  return normalized > 180 ? normalized - 360 : normalized;
}

/**
 * The Sun's geometric geocentric right ascension and declination, degrees, in the
 * equinox and obliquity of date.
 *
 * Meeus ch. 25 eq. 25.5 gives the Sun's true longitude; the light-time pass
 * evaluates it at `jde` less one light-time, which is the geometry that actually
 * holds for the sub-solar point (the Sun was there when the light now arriving
 * left it). The obliquity is the date's, because this pair is referred to the
 * equinox of date, the same frame the sidereal time arrives in.
 */
function geometricSunEquatorial(jde: number): { readonly rightAscension: number; readonly declination: number } {
  const longitude = normalize360(sunGeometricEclipticLongitudeDegrees(jde - LIGHT_TIME_DAYS));
  const obliquity = meanObliquityDegrees(jde);
  return {
    rightAscension: normalize360(atan2Deg(cosDeg(obliquity) * sinDeg(longitude), cosDeg(longitude))),
    declination: asinDeg(sinDeg(obliquity) * sinDeg(longitude)),
  };
}

/**
 * A point `angularDistanceDeg` of arc from `centre` along `bearingDeg` (Meeus
 * ch. 13's spherical trigonometry, written for a small circle rather than for a
 * coordinate change).
 *
 * The bearing runs clockwise from north, the same convention as
 * `SkyPosition.azimuth`: 0 increases the latitude, 90 increases the longitude.
 * The meridian convergence is inside the divided cosine, so a circle at a high
 * latitude is a true small circle off the pole rather than a loxodrome.
 */
function atAngularDistance(centre: LatLon, angularDistanceDeg: number, bearingDeg: number): LatLon {
  const distanceSin = sinDeg(angularDistanceDeg);
  const distanceCos = cosDeg(angularDistanceDeg);
  const latitudeSin = sinDeg(centre.latDeg);
  const latitudeCos = cosDeg(centre.latDeg);
  const bearingCos = cosDeg(bearingDeg);
  return {
    latDeg: asinDeg(clampUnit(latitudeSin * distanceCos + latitudeCos * distanceSin * bearingCos)),
    lonDeg: wrapSignedLongitude(
      centre.lonDeg +
        atan2Deg(distanceSin * sinDeg(bearingDeg), latitudeCos * distanceCos - latitudeSin * distanceSin * bearingCos),
    ),
  };
}

/**
 * The circle `angularDistanceDeg` from a point, `samples + 1` points long and
 * closed. Bearings run west to east, the direction the terminator itself travels
 * as the Earth turns under it.
 */
function circleAround(centre: LatLon, angularDistanceDeg: number, samples: number): readonly LatLon[] {
  const points: LatLon[] = [];
  const first = atAngularDistance(centre, angularDistanceDeg, 0);
  for (let index = 0; index < samples; index += 1) {
    points.push(atAngularDistance(centre, angularDistanceDeg, (360 * index) / samples));
  }
  // The last point IS the first, assigned rather than recomputed: the bearing at
  // both ends is the same angle and `360 * samples / samples` is not bit-identical
  // to `0`, so a recomputation would leave a closing point a few ulps away that
  // compares unequal and draws a one-pixel seam.
  points.push(first);
  return points;
}

/** The Moon's apparent geocentric right ascension and declination, degrees. */
function moonEquatorial(jde: number): { readonly rightAscension: number; readonly declination: number } {
  const ecliptic = moonEcliptic(jde);
  const nutation = nutationDegrees(jde);
  const trueObliquity = meanObliquityDegrees(jde) + nutation.obliquity;
  const longitude = ecliptic.longitude + nutation.longitude;
  const latitude = ecliptic.latitude;
  return {
    rightAscension: normalize360(
      atan2Deg(
        sinDeg(longitude) * cosDeg(trueObliquity) - tanDeg(latitude) * sinDeg(trueObliquity),
        cosDeg(longitude),
      ),
    ),
    declination: asinDeg(
      sinDeg(latitude) * cosDeg(trueObliquity) + cosDeg(latitude) * sinDeg(trueObliquity) * sinDeg(longitude),
    ),
  };
}

/**
 * The Earth's day and night at one instant. Sources: Meeus ch. 25 for the Sun's
 * place, ch. 47 and ch. 13 for the Moon's, ch. 12 for the sidereal time that
 * turns either into a longitude, and ch. 13's spherical geometry for the circles.
 *
 * The subsolar point is the geometric one (the header says why); the sublunar
 * point is the Moon's apparent geocentric place by the same relation. The circles
 * are the geometric ones the header states: the terminator is the Sun's centre on
 * the horizon (90 degrees), so the sunset a user's clock reports is within the 50
 * arcminutes the header lists of the line drawn here.
 */
export function dayNightAt(at: SkyInstant, samples = DEFAULT_SAMPLES): DayNight {
  const instantMs = at instanceof Date ? at.getTime() : at;
  const jde = julianEphemerisDay(instantMs);
  // The sidereal time is read at the instant in UT, as `sunPosition` reads it:
  // the Earth's rotation is what it measures, and earth.ts says why.
  const siderealDegrees = apparentSiderealTimeDegrees(julianDay(instantMs));
  const sun = geometricSunEquatorial(jde);
  const subsolar: LatLon = {
    latDeg: sun.declination,
    lonDeg: wrapSignedLongitude(siderealDegrees - sun.rightAscension),
  };
  const moon = moonEquatorial(jde);
  const sublunar: LatLon = {
    latDeg: moon.declination,
    lonDeg: wrapSignedLongitude(siderealDegrees - moon.rightAscension),
  };
  // The step count is the caller's, floored so a caller asking for a three-point
  // terminator gets a triangle rather than an error.
  const stepCount = Math.max(8, Math.floor(samples));
  return {
    instantMs,
    subsolar,
    sublunar,
    terminator: circleAround(subsolar, TERMINATOR_ANGULAR_RADIUS_DEG, stepCount),
    twilight: {
      civil: circleAround(subsolar, TWILIGHT_ANGULAR_RADII_DEG.civil, stepCount),
      nautical: circleAround(subsolar, TWILIGHT_ANGULAR_RADII_DEG.nautical, stepCount),
      astronomical: circleAround(subsolar, TWILIGHT_ANGULAR_RADII_DEG.astronomical, stepCount),
    },
  };
}
