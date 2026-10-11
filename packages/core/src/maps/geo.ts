/**
 * The map's own arithmetic: a great-circle distance, the two ways coordinates
 * are written, and the scale bar's conversion of pixels to metres.
 *
 * **Why this is `@nexus/core` rather than the module's folder.** The same four
 * functions are needed on both sides of the map: the page draws a scale bar and
 * writes coordinates into a clip field, while a future Archiver or an export
 * writes the same pair into a document. None of it touches the DOM, so it lives
 * with the rest of the platform-free domain layer and is tested without one.
 *
 * **Every number here is either a published constant or a derived value.** The
 * two radii are the ones geodesy names (the IUGG mean radius for a sphere, the
 * Web Mercator sphere's own radius for the projection), the distance is the
 * haversine over the first, and the scale bar is the second one's arithmetic.
 * Nothing is a "nice" number chosen to make a test read well: the tests state
 * the intermediate values they were computed from.
 */

/** A position on the ellipsoid, in degrees. */
export interface GeoPoint {
  readonly lat: number;
  readonly lon: number;
}

/**
 * The radius the great-circle distance is computed on: the Earth's arithmetic
 * mean radius, published by the IUGG and the NGA as 6 371.0087714 km
 * (`https://en.wikipedia.org/wiki/Earth_radius#Arithmetic_mean_radius`, read
 * 2026-10-10: "the arithmetic mean radius is published by IUGG and NGA as
 * 6,371.0087714 km").
 *
 * **This is a sphere, and the Earth is not one.** The haversine over a mean
 * radius is the classic spherical answer, and the ellipsoidal one is Vincenty's
 * (`https://en.wikipedia.org/wiki/Haversine_formula`, read 2026-10-10: "More
 * accurate methods that consider the Earth's ellipticity are given by Vincenty's
 * formulae"). The sphere is the right trade HERE - the ruler in this app
 * measures a walk between two pins, where the two answers differ by well under
 * a hundred metres over the distances a person paces out, and a Vincenty solve
 * per pointer move is a cost with nothing to show for it.
 */
export const EARTH_MEAN_RADIUS_M = 6371008.7714;

/**
 * The Web Mercator sphere's equatorial circumference, in metres.
 *
 * Derived rather than quoted, from the projection's own definition: it is
 * defined on a sphere of radius 6 378 137 m, which is the WGS 84 semi-major
 * axis the EPSG:3857 definition names
 * (`https://en.wikipedia.org/wiki/Web_Mercator_projection`, read 2026-10-10,
 * whose EPSG:3857 WKT carries `ELLIPSOID["WGS 84", 6378137, ...]`). So
 * `2 * π * 6378137 = 40075016.68557849` m, and that is what turns a zoom level
 * into a ground distance per pixel.
 */
export const WEB_MERCATOR_CIRCUMFERENCE_M = 40075016.68557849;

/**
 * The great-circle distance between two points, in metres.
 *
 * The haversine: `hav(θ) = hav(Δφ) + cosφ₁ cosφ₂ hav(Δλ)`, with
 * `hav(x) = sin²(x/2)`, and the angle recovered through `atan2` rather than
 * `asin`. Both recoveries are algebraically identical; `atan2` is the one that
 * stays conditioned as `a` approaches 1, and its `sqrt(1 - a)` is exact enough
 * at the short distances this app measures that the choice costs nothing.
 * `Math.min(1, a)` guards the other end: a pair of coincident points can
 * produce an `a` a hair above 1 in floating point, and `sqrt(1 - a)` of that is
 * `NaN`.
 */
export function haversineMetres(a: GeoPoint, b: GeoPoint): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const halfLat = ((b.lat - a.lat) * Math.PI) / 360;
  const halfLon = ((b.lon - a.lon) * Math.PI) / 360;
  const a1 = Math.sin(halfLat) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(halfLon) ** 2;
  const clamped = Math.min(1, a1);
  return 2 * EARTH_MEAN_RADIUS_M * Math.atan2(Math.sqrt(clamped), Math.sqrt(1 - clamped));
}

/** The two shapes a coordinate pair is written in. */
export type CoordinateStyle = "decimal" | "dms";

/** Five decimal places is ~1.1 m of latitude, which is finer than a hand-placed pin. */
const DECIMAL_DIGITS = 5;

/**
 * One hemisphere letter per sign, in the notation every map uses — including
 * Serbian, whose Latin form keeps `N`/`S`/`E`/`W` and whose Cyrillic form is
 * not what this app is written in. They are symbols rather than prose, so they
 * are the same in both locales and are not copy.
 */
function hemisphere(value: number, positive: string, negative: string): string {
  return value < 0 ? negative : positive;
}

/**
 * A coordinate pair written in decimal degrees, in the active locale:
 * `44,81781° N, 20,45690° E` in Serbian, `44.81781° N, 20.45690° E` in English.
 *
 * The pair is one string because it is one fact: a copy field that handed the
 * user two lines would be two pastes into somebody else's map.
 */
export function formatDecimalCoordinates(point: GeoPoint, locale: string): string {
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: DECIMAL_DIGITS,
    maximumFractionDigits: DECIMAL_DIGITS,
    // A grouped degree is meaningless and would be a promise of precision the
    // number does not carry ("44,817,81" reads as a hundred thousand).
    useGrouping: false,
  });
  const lat = `${number.format(Math.abs(point.lat))}° ${hemisphere(point.lat, "N", "S")}`;
  const lon = `${number.format(Math.abs(point.lon))}° ${hemisphere(point.lon, "E", "W")}`;
  return `${lat}, ${lon}`;
}

/**
 * The degrees-minutes-seconds triple of one signed angle, as whole seconds.
 *
 * Rounded rather than truncated, and the carry is handled rather than ignored:
 * 44,9999999° is `45° 00′ 00″` and not `44° 59′ 60″`, which is what a naive
 * round of each field separately produces once a value sits a hair under a
 * whole minute.
 */
export function toDms(value: number): { degrees: number; minutes: number; seconds: number } {
  let degrees = Math.floor(Math.abs(value));
  const minutesFull = (Math.abs(value) - degrees) * 60;
  let minutes = Math.floor(minutesFull);
  let seconds = Math.round((minutesFull - minutes) * 60);
  if (seconds === 60) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes === 60) {
    minutes = 0;
    degrees += 1;
  }
  return { degrees, minutes, seconds };
}

/** A two-digit field, because a coordinate is read as a fixed-width triple. */
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A coordinate pair written in degrees, minutes and seconds:
 * `44°49′04″ N, 20°27′25″ E`.
 *
 * The primes are the typographic ones (U+2032, U+2033), which is what every
 * atlas prints; the digits are ASCII because there is no locale in which a
 * coordinate's numbers are grouped or spelled.
 */
export function formatDmsCoordinates(point: GeoPoint): string {
  const angle = (value: number, positive: string, negative: string): string => {
    const { degrees, minutes, seconds } = toDms(value);
    return `${String(degrees)}°${pad2(minutes)}′${pad2(seconds)}″ ${hemisphere(value, positive, negative)}`;
  };
  return `${angle(point.lat, "N", "S")}, ${angle(point.lon, "E", "W")}`;
}

/** Both writings of one pair, under the names the page draws them with. */
export function formatCoordinates(point: GeoPoint, locale: string): {
  readonly decimal: string;
  readonly dms: string;
} {
  return {
    decimal: formatDecimalCoordinates(point, locale),
    dms: formatDmsCoordinates(point),
  };
}

/**
 * Ground metres per screen pixel at a Web Mercator zoom level.
 *
 * `512` is MapLibre's tile size, and the cosine is the projection's own
 * shrinking of longitude towards the poles. The formula is the one MapLibre's
 * own `ScaleControl` uses; it is restated here because this app draws its own
 * scale bar out of the design tokens rather than adopting a control whose
 * colours come from the renderer's stylesheet.
 */
export function metresPerPixel(zoom: number, lat: number, tileSize = 512): number {
  return (
    (WEB_MERCATOR_CIRCUMFERENCE_M * Math.abs(Math.cos((lat * Math.PI) / 180))) /
    (tileSize * 2 ** zoom)
  );
}

/**
 * The distances a scale bar is allowed to show: 1, 2 and 5 of each power of ten,
 * in metres. A ladder rather than "whatever the width works out to" because a
 * bar labelled `3 741 m` asks the reader to do arithmetic to use it.
 */
const SCALE_LADDER_M = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000,
  500_000, 1_000_000, 2_000_000, 5_000_000,
] as const;

/** One scale bar: the distance it states, how wide it is drawn, and its label. */
export interface ScaleBar {
  /** The ground distance the bar states. */
  readonly metres: number;
  /** How wide the bar is drawn at this zoom, in pixels (never wider than `maxPx`). */
  readonly pixels: number;
  /** The same distance written the way the distance tool writes it. */
  readonly label: string;
}

/**
 * The widest ladder distance that fits in `maxPx`, with its width and label.
 *
 * The smallest rung is the fallback rather than an empty bar: a bar of zero
 * length is a control that says nothing, and at the deepest zoom this pack has
 * (15) one metre is under two pixels, so the bar is still honest.
 */
export function scaleBar(zoom: number, lat: number, maxPx: number, locale: string): ScaleBar {
  const perPixel = metresPerPixel(zoom, lat);
  // Typed `number` because the ladder is `as const`: without this the variable
  // would take the literal type of its first rung and the loop could not move it.
  let metres: number = SCALE_LADDER_M[0];
  for (const rung of SCALE_LADDER_M) {
    if (rung / perPixel <= maxPx) metres = rung;
  }
  return {
    metres,
    pixels: metres / perPixel,
    // A rung is a ROUND number by construction (1, 2 or 5 of a power of ten), so
    // it is printed round: "5 km", never "5,00 km". A measured distance is the
    // other case and keeps the magnitude's own precision.
    label:
      metres < 1000
        ? formatDistanceMetres(metres, locale)
        : formatDistanceKilometres(metres, locale, 0),
  };
}

/** Whole metres, through `Intl`: `1.234 m` in Serbian, `1,234 m` in English. */
export function formatDistanceMetres(metres: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "meter",
    unitDisplay: "short",
    maximumFractionDigits: 0,
  }).format(Math.round(metres));
}

/**
 * Kilometres, with the precision the magnitude deserves: two decimals under
 * 10 km (the range a person walks and reads to a hundred metres), one under
 * 100 km, none above it. `Intl` supplies the separator and the unit, so the
 * Serbian form is `1,23 km` and the English one `1.23 km`.
 */
export function formatDistanceKilometres(metres: number, locale: string, digits?: number): string {
  const km = metres / 1000;
  const places = digits ?? (km < 10 ? 2 : km < 100 ? 1 : 0);
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "kilometer",
    unitDisplay: "short",
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  }).format(km);
}

/** One distance the way a bar or a badge states it: metres below a kilometre, kilometres above. */
export function formatDistanceShort(metres: number, locale: string): string {
  return metres < 1000
    ? formatDistanceMetres(metres, locale)
    : formatDistanceKilometres(metres, locale);
}
