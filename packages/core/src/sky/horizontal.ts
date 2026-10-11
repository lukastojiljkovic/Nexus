/**
 * From a direction in the equatorial frame to a direction in the sky overhead:
 * the observer (ch. 11), the topocentric correction (ch. 40, "Topocentric
 * Correction for the Moon" — applied to the Sun as well, where it is 8.8
 * arcseconds), the conversion to altitude and azimuth (ch. 13, "Equatorial to
 * Horizontal Coordinates"), and the refraction that lifts what you actually see
 * (ch. 16, "Atmospheric Refraction").
 *
 * **The engine reports two altitudes and they are both real.** `altitude` is the
 * geometric one — where the body's centre is, measured from the observer, with
 * the Earth's atmosphere taken out of the picture; it is what a rise or a set is
 * solved against, and what USNO's own `hc` means. `apparentAltitude` is what the
 * eye sees, that first number plus {@link refractionDegrees}. A caller drawing a
 * horizon is asking a different question from a caller solving for sunrise, and
 * this is the seam between them.
 *
 * **The topocentric step is done in rectangular coordinates**, not through
 * Meeus's two trigonometric expressions for Δα and δ′. It is the same
 * correction — put the observer on the ellipsoid rather than at the centre, and
 * re-read the direction to the body — and doing it as one vector subtraction
 * rather than three nested formulae is what keeps a degree-sized parallax from
 * depending on a sign convention nobody can check by reading. The parallax
 * enters and leaves in the same units (degrees of horizontal parallax), so the
 * whole effect is legible in the result: with the Moon overhead the observer is
 * a full Earth radius closer to it, so its parallax comes back 1.7% larger
 * (0.951 degrees geocentric against 0.967 topocentric at the mean distance).
 */
import { asinDeg, atan2Deg, clampUnit, cosDeg, normalize360, sinDeg, tanDeg, wrap180 } from "./angles.js";
import { observerFigure } from "./earth.js";

/** A place on the Earth's surface. North and east are positive; the engine is at sea level. */
export interface SkyPlace {
  readonly latitude: number;
  readonly longitude: number;
}

/** Where a body is in the sky overhead. Degrees; azimuth is clockwise from true north. */
export interface SkyPosition {
  /** Degrees clockwise from true north. */
  readonly azimuth: number;
  /** Degrees above the horizon of the body's centre, geometric (no refraction). */
  readonly altitude: number;
  /** The same, as the atmosphere makes it look — see {@link refractionDegrees}. */
  readonly apparentAltitude: number;
}

/** A direction in the equatorial frame. Right ascension is in [0, 360). */
export interface EquatorialPosition {
  readonly rightAscension: number;
  readonly declination: number;
}

/** An equatorial direction with the body's distance, expressed as horizontal parallax. */
export interface ParallaxedPosition extends EquatorialPosition {
  /**
   * The angle the Earth's equatorial radius subtends at the body (ch. 40, eq.
   * 40.1): 8.8" for the Sun, about 1 degree for the Moon.
   */
  readonly horizontalParallax: number;
}

/** The Earth's equatorial radius in kilometres, the constant ch. 11 and 40 both use. */
export const EARTH_EQUATORIAL_RADIUS_KM = 6378.14;

/**
 * How much the atmosphere lifts a body that is truly at `trueAltitude` (ch. 16,
 * Saemundsson's formula): `R = 1.02 / tan(h + 10.3/(h + 5.11))` arcminutes.
 *
 * The expression is fitted for altitudes from the horizon to the zenith, and
 * under the horizon it leaves its own range — at -5.11 degrees the argument's
 * pole is reached and the tangent runs away to infinity. Below the horizon this
 * therefore reports zero rather than a number from outside the fit, which is
 * honest about which side of the fit a caller is on and costs nothing: nothing
 * in this module's answers depends on it, because a rise and a set are solved
 * against ch. 15's fixed 34 arcminutes at the horizon, not against this curve.
 * Note also which way the fit runs — true altitude in, apparent altitude out —
 * so at the horizon it reads 29', not the 34' of the conventional table, which
 * is the same curve read from the other end. The difference is a few arcminutes
 * of altitude and a handful of seconds of rise time.
 */
export function refractionDegrees(trueAltitude: number): number {
  if (trueAltitude < 0) return 0;
  return 1.02 / tanDeg(trueAltitude + 10.3 / (trueAltitude + 5.11)) / 60;
}

/**
 * Where the body is as seen from a point on the Earth's surface rather than from
 * its centre (ch. 40). `siderealDegrees` is the observer's own apparent sidereal
 * time, so the longitude is already in it.
 */
export function topocentricEquatorial(
  equatorial: ParallaxedPosition,
  place: SkyPlace,
  siderealDegrees: number,
): ParallaxedPosition {
  const figure = observerFigure(place.latitude);
  const distanceEarthRadii = 1 / sinDeg(equatorial.horizontalParallax);
  const body = [
    distanceEarthRadii * cosDeg(equatorial.declination) * cosDeg(equatorial.rightAscension),
    distanceEarthRadii * cosDeg(equatorial.declination) * sinDeg(equatorial.rightAscension),
    distanceEarthRadii * sinDeg(equatorial.declination),
  ] as const;
  const observer = [
    figure.rhoCos * cosDeg(siderealDegrees),
    figure.rhoCos * sinDeg(siderealDegrees),
    figure.rhoSin,
  ] as const;
  const seen = [body[0] - observer[0], body[1] - observer[1], body[2] - observer[2]] as const;
  const distance = Math.hypot(seen[0], seen[1], seen[2]);
  return {
    rightAscension: normalize360(atan2Deg(seen[1], seen[0])),
    declination: asinDeg(clampUnit(seen[2] / distance)),
    horizontalParallax: asinDeg(clampUnit(1 / distance)),
  };
}

/**
 * Altitude and azimuth of a direction, for an observer whose own sidereal time
 * is `siderealDegrees` (ch. 13, eq. 13.5 and 13.6).
 *
 * Meeus's azimuth is measured from the south and positive westward; the azimuth
 * handed back here is the navigational one, from true north and clockwise,
 * because that is the number that answers „where is south", and the one
 * `northFromSun` subtracts.
 */
export function horizontalFromEquatorial(
  place: SkyPlace,
  equatorial: EquatorialPosition,
  siderealDegrees: number,
): { readonly azimuth: number; readonly altitude: number } {
  const hourAngle = wrap180(siderealDegrees - equatorial.rightAscension);
  const altitude = asinDeg(
    clampUnit(
      sinDeg(place.latitude) * sinDeg(equatorial.declination) +
        cosDeg(place.latitude) * cosDeg(equatorial.declination) * cosDeg(hourAngle),
    ),
  );
  const fromSouth = atan2Deg(
    sinDeg(hourAngle),
    cosDeg(hourAngle) * sinDeg(place.latitude) - tanDeg(equatorial.declination) * cosDeg(place.latitude),
  );
  return { azimuth: normalize360(fromSouth + 180), altitude };
}
