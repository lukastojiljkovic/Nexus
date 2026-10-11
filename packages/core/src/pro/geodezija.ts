/**
 * „Geodezija i GIS" — the arithmetic behind the surveying toolkit's tools.
 *
 * **One file per PACK, not per category**, exactly as `pro/gradnja.ts` explains.
 *
 * **These are pure functions and they refuse rather than repair.** No clock, no
 * I/O, no locale, no formatting: the surface owns its state and asks here for
 * every number it prints.
 *
 * **The ellipsoid is WGS84 and it is named, not implied.** `a = 6378137 m` and
 * `1/f = 298,257223563` are the defining parameters of the World Geodetic
 * System 1984 (NIMA TR8350.2, third edition 2000), and everything here that is
 * not plane geometry answers on that surface. `pro/nautika.ts` deliberately
 * answers on a SPHERE instead: a navigator wants a sphere and a surveyor wants
 * the ellipsoid, and merging the two files would give each trade the other's
 * answer.
 *
 * **No national grid is here, and the omission is deliberate.** MGI 1901 /
 * Balkans zone 7 (EPSG:31277) is a seven-parameter transformation away from
 * WGS84, and those parameters are a published authority's to state — a file
 * carrying a half-remembered set would move every point in the country by a
 * hundred metres and look exactly like a correct answer.
 */

import {
  fail,
  isInRange,
  isIntegerIn,
  isPositive,
  quotient,
  snap,
  type ProResult,
} from "./result.js";

/** WGS84 semi-major axis, m — NIMA TR8350.2. */
const WGS84_A = 6378137;

/** WGS84 inverse flattening — NIMA TR8350.2. */
const WGS84_INV_F = 298.257223563;

/** WGS84 flattening, from the inverse above. */
const WGS84_F = 1 / WGS84_INV_F;

/** WGS84 first eccentricity squared, `e² = 2f − f²`. */
const WGS84_E2 = 2 * WGS84_F - WGS84_F ** 2;

/** The second eccentricity squared, `e′² = e²/(1 − e²)`. */
const WGS84_E2_PRIME = WGS84_E2 / (1 - WGS84_E2);

/** The transverse Mercator scale factor at the central meridian, by UTM definition. */
const UTM_K0 = 0.9996;

/** The UTM false easting, m — the definition puts the central meridian at 500 000. */
const UTM_FALSE_EASTING = 500000;

/** The UTM false northing of the southern hemisphere, m — the definition. */
const UTM_FALSE_NORTHING_SOUTH = 10000000;

const RAD_PER_DEG = Math.PI / 180;
const DEG_PER_RAD = 180 / Math.PI;

/** A latitude and longitude in decimal degrees, north and east positive. */
export interface GeoPoint {
  readonly lat: number;
  readonly lon: number;
}

function isLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

/**
 * A bearing in degrees, clockwise from north, folded into [0, 360).
 *
 * It is applied BEFORE the sine and cosine as well as reported folded: a
 * traverse that has been summing turning angles arrives at 470° quite
 * legitimately, and a fold applied only to the printed value would compute the
 * two from different angles.
 */
function foldDegrees(degrees: number): number {
  const folded = degrees % 360;
  return folded < 0 ? folded + 360 : folded;
}

/*
 * decimal-dms — „Decimalni stepeni i DMS"
 * ------------------------------------------------------------------------ */

export interface Dms {
  /** Signed whole degrees. The minutes and seconds are MAGNITUDES. */
  readonly degrees: number;
  readonly minutes: number;
  readonly seconds: number;
}

export interface DmsResult {
  readonly decimal: number;
  readonly dms: Dms;
}

/**
 * Degrees, minutes and seconds as a decimal degree.
 *
 * **The sign lives on the degrees and nowhere else.** `−0,5°` is 0° 30′ 00″
 * *south*, not −0° 30′ 00″; a DMS triple carrying a sign in three places is a
 * triple whose parts can disagree, and −44° −30′ −30″ has no reading at all.
 * Which is also why the two smaller fields are refused at 60 or more rather
 * than carried: `44° 70′` means 45° 10′ to nobody who wrote it, and normalising
 * it silently hides the arithmetic error that put it there.
 */
export function dmsToDecimal(dms: Dms): ProResult<DmsResult> {
  const { degrees, minutes, seconds } = dms;
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return fail("dms");
  }
  if (Math.abs(degrees) > 180) return fail("degrees");
  if (!isInRange(minutes, 0, 59.9999999999)) return fail("minutes");
  if (!isInRange(seconds, 0, 59.9999999999)) return fail("seconds");
  const magnitude = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  const decimal = degrees < 0 ? -magnitude : magnitude;
  return { ok: true, decimal, dms: { degrees, minutes, seconds } };
}

/**
 * A decimal degree as degrees, minutes and seconds.
 *
 * The seconds stay a decimal number of arcseconds: a surveyor reads `12,3456″`,
 * and a fourth field would be a unit nobody writes.
 *
 * The whole-degree part is taken from a value snapped first, for `snap`'s
 * reason — 43,99999999 must not come out as 43° 59′ 59,9999″, which is a
 * correct answer to a question nobody asked and a wrong-looking one on a plan.
 */
export function decimalToDms(decimal: number): ProResult<DmsResult> {
  if (!Number.isFinite(decimal) || decimal < -180 || decimal > 180) return fail("decimal");
  const negative = decimal < 0;
  const magnitude = Math.abs(decimal);
  const snapped = snap(magnitude);
  const degrees = Math.floor(snapped);
  const minutesFull = (snapped - degrees) * 60;
  const minutes = Math.floor(minutesFull);
  const seconds = (minutesFull - minutes) * 60;
  return {
    ok: true,
    decimal,
    dms: { degrees: negative ? -degrees : degrees, minutes, seconds },
  };
}

/*
 * wgs84-utm — „WGS84 i UTM"
 * ------------------------------------------------------------------------ */

export interface UtmCoordinate {
  readonly zone: number;
  /** True for the northern hemisphere. A UTM coordinate without it is ambiguous. */
  readonly north: boolean;
  readonly easting: number;
  readonly northing: number;
}

export interface UtmForwardResult extends UtmCoordinate {
  readonly centralMeridianDeg: number;
  /** Point scale factor — 0,9996 exactly on the central meridian, rising to either side. */
  readonly scaleFactor: number;
  /** Grid convergence, degrees: the angle from grid north to true north, positive east. */
  readonly convergenceDeg: number;
}

export interface UtmInverseResult extends GeoPoint {
  readonly zone: number;
  readonly centralMeridianDeg: number;
  readonly scaleFactor: number;
  readonly convergenceDeg: number;
}

/** The UTM zone a longitude falls in — the definition's 6° belts from 180°W. */
export function utmZoneForLongitude(lon: number): number {
  if (!isLongitude(lon)) return Number.NaN;
  const zone = Math.floor((lon + 180) / 6) + 1;
  return zone > 60 ? 60 : zone;
}

/** The central meridian of a zone, degrees east. */
function centralMeridian(zone: number): number {
  return (zone - 1) * 6 - 180 + 3;
}

/** The meridional arc from the equator to a latitude, m — the standard series (Snyder 3-21). */
function meridionalArc(latRad: number): number {
  const e2 = WGS84_E2;
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  return (
    WGS84_A *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latRad -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * latRad) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * latRad) -
      ((35 * e6) / 3072) * Math.sin(6 * latRad))
  );
}

/**
 * A latitude and longitude as UTM — the forward transverse Mercator (Snyder,
 * *Map Projections — A Working Manual*, 1987, §8-9 to §8-17).
 *
 * **The series and its limits are stated rather than hidden.** Snyder's forms
 * are truncated expansions in `A = Δλ·cosφ`, quoted as accurate to a
 * millimetre inside a zone and to better than a decimetre at its edge — which
 * is exactly why the ellipsoidal distance, not this, is what a boundary is
 * measured with. A point outside its zone's own width is still accepted,
 * because a coordinate pair does not stop existing for being badly chosen.
 *
 * Convergence is `γ = atan(tanΔλ·sinφ)` (Snyder §8-18) and the point scale
 * factor is the series in `A²` (Snyder §8-15), which is `k₀` to the last place
 * on the central meridian. The northings use the hemisphere's false northing,
 * so a southern coordinate is a positive number up to 10 000 000 m.
 */
export function utmForward(point: GeoPoint): ProResult<UtmForwardResult> {
  const { lat, lon } = point;
  if (!isLatitude(lat) || !isLongitude(lon)) return fail("point");
  // The UTM belts stop at 84°N and 80°S: a polar coordinate is the UPS
  // projection, not a UTM one with a strange number in it.
  if (lat > 84 || lat < -80) return fail("latitude");

  const phi = lat * RAD_PER_DEG;
  const zone = utmZoneForLongitude(lon);
  const deltaLambda = (lon - centralMeridian(zone)) * RAD_PER_DEG;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const t = tanPhi * tanPhi;
  const c = WGS84_E2_PRIME * cosPhi * cosPhi;
  const a = deltaLambda * cosPhi;

  const easting =
    UTM_FALSE_EASTING +
    UTM_K0 *
      n *
      (a +
        ((1 - t + c) * a ** 3) / 6 +
        ((5 - 18 * t + t * t + 72 * c - 58 * WGS84_E2_PRIME) * a ** 5) / 120);
  const meridional =
    UTM_K0 *
    (meridionalArc(phi) +
      n *
        tanPhi *
        (a ** 2 / 2 +
          ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 +
          ((61 - 58 * t + t * t + 600 * c - 330 * WGS84_E2_PRIME) * a ** 6) / 720));
  const northing = lat < 0 ? meridional + UTM_FALSE_NORTHING_SOUTH : meridional;
  const scaleFactor =
    UTM_K0 *
    (1 +
      ((1 + c) * a ** 2) / 2 +
      ((5 - 4 * t + 42 * c + 13 * c * c - 28 * WGS84_E2_PRIME) * a ** 4) / 24);

  return {
    ok: true,
    zone,
    north: lat >= 0,
    easting,
    northing,
    centralMeridianDeg: centralMeridian(zone),
    scaleFactor,
    convergenceDeg: Math.atan(Math.tan(deltaLambda) * sinPhi) * DEG_PER_RAD,
  };
}

/**
 * A UTM coordinate back as latitude and longitude (Snyder §8-18 to §8-25).
 *
 * The inverse runs through the footpoint latitude `φ₁`, obtained from the
 * meridional arc by the standard `e₁` series rather than by iteration — the
 * series is the exact pair of the forward one, so a point projected and
 * unprojected returns where it started, which is what a traverse crossing a
 * zone boundary depends on.
 */
export function utmInverse(coordinate: UtmCoordinate): ProResult<UtmInverseResult> {
  const { zone, north, easting, northing } = coordinate;
  if (!isIntegerIn(zone, 1, 60)) return fail("zone");
  if (!isInRange(easting, 100000, 900000)) return fail("easting");
  if (!isInRange(northing, 0, 10000000)) return fail("northing");

  const m = (northing - (north ? 0 : UTM_FALSE_NORTHING_SOUTH)) / UTM_K0;
  const root = Math.sqrt(1 - WGS84_E2);
  const e1 = (1 - root) / (1 + root);
  const mu =
    m /
    (WGS84_A *
      (1 - WGS84_E2 / 4 - (3 * WGS84_E2 ** 2) / 64 - (5 * WGS84_E2 ** 3) / 256));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const n1 = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi1 * sinPhi1);
  const t1 = tanPhi1 * tanPhi1;
  const c1 = WGS84_E2_PRIME * cosPhi1 * cosPhi1;
  const r1 = (WGS84_A * (1 - WGS84_E2)) / (1 - WGS84_E2 * sinPhi1 * sinPhi1) ** 1.5;
  const d = quotient(easting - UTM_FALSE_EASTING, n1 * UTM_K0);
  if (d === undefined) return fail("easting");

  const latRad =
    phi1 -
    ((n1 * tanPhi1) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * WGS84_E2_PRIME) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * WGS84_E2_PRIME - 3 * c1 * c1) *
          d ** 6) /
          720);
  const deltaLonRad =
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * WGS84_E2_PRIME + 24 * t1 * t1) * d ** 5) / 120) /
    cosPhi1;
  const lat = latRad * DEG_PER_RAD;
  const lon = centralMeridian(zone) + deltaLonRad * DEG_PER_RAD;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fail("northing");

  return {
    ok: true,
    lat,
    lon,
    zone,
    centralMeridianDeg: centralMeridian(zone),
    scaleFactor:
      UTM_K0 *
      (1 +
        ((1 + c1) * d * d) / 2 +
        ((5 - 4 * t1 + 42 * c1 + 13 * c1 * c1 - 28 * WGS84_E2_PRIME) * d ** 4) / 24),
    convergenceDeg:
      Math.atan(Math.tan(deltaLonRad) * Math.sin(latRad)) * DEG_PER_RAD,
  };
}

/*
 * utm-mgrs — „UTM i MGRS"
 * ------------------------------------------------------------------------ */

/** The 20 latitude bands MGRS uses, I and O omitted. The first is C, at 80°S. */
const MGRS_BANDS = "CDEFGHJKLMNPQRSTUVWX";

/** The 24 column letters MGRS uses, I and O omitted — one zone's columns in order. */
const MGRS_COLUMN_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/** The 20 row letters, I and O omitted — the northing repeats them every 2 000 km. */
const MGRS_ROW_LETTERS = "ABCDEFGHJKLMNPQRSTUV";

/** The digits per axis MGRS allows: 10⁵ m down to 1 m, and none at all. */
export const MGRS_PRECISIONS = [5, 4, 3, 2, 1, 0] as const;

export type MgrsPrecision = (typeof MGRS_PRECISIONS)[number];

export interface MgrsInput {
  readonly point: GeoPoint;
  /** Digits per axis — 5 is one metre, 0 is the 100 km square alone. */
  readonly precision: MgrsPrecision;
}

export interface MgrsResult {
  readonly mgrs: string;
  readonly zone: number;
  readonly band: string;
  readonly north: boolean;
  /** The 100 km square's south-west corner, as UTM metres. */
  readonly squareEasting: number;
  readonly squareNorthing: number;
  readonly precision: MgrsPrecision;
  readonly easting: number;
  readonly northing: number;
}

export interface MgrsToUtmResult extends MgrsResult {
  /** The centre of the square the string names — the point a map pin wants. */
  readonly centre: GeoPoint;
  /** The square's south-west corner read back, which is what a bare square means. */
  readonly southWest: GeoPoint;
}

/**
 * A point as an MGRS reference (Snyder §8; NGA, *Universal Grids and Grid
 * Reference Systems*).
 *
 * **MGRS is a way of writing a UTM coordinate, not a second projection.** The
 * zone and band name the 6° × 8° cell, two letters name the 100 km square
 * inside it, and the digits after them are the remainder within that square —
 * so a 1 m reference is a ten-digit suffix and a 100 km one has none. The band
 * letter carries the hemisphere on its own (A–M south, N–Z north), which is why
 * an MGRS string needs no hemisphere field and a bare UTM coordinate does.
 *
 * **The two letter sets are the trap.** Columns cycle in three sets keyed to
 * `zone mod 3`, and rows begin at `A` in an odd zone and at `F` in an even one;
 * a reader who carries the letters over from the next zone along gets a square
 * a hundred kilometres away that still reads as a valid reference. Both rules
 * live here once, and the test walks all three column sets.
 */
export function mgrsFromGeo(input: MgrsInput): ProResult<MgrsResult> {
  const { point, precision } = input;
  if (!MGRS_PRECISIONS.includes(precision)) return fail("precision");
  const projected = utmForward(point);
  if (!projected.ok) return projected;
  const { zone, easting, northing } = projected;
  const band = MGRS_BANDS[Math.floor((point.lat + 80) / 8)];
  if (band === undefined) return fail("latitude");

  const columnIndex = Math.floor(easting / 100000) - 1;
  if (columnIndex < 0 || columnIndex > 7) return fail("easting");
  const columnLetter = MGRS_COLUMN_LETTERS[((zone - 1) % 3) * 8 + columnIndex];
  const rowIndex = Math.floor(northing / 100000) % 20;
  const rowLetter = MGRS_ROW_LETTERS[(rowIndex + (zone % 2 === 1 ? 0 : 5)) % 20];
  if (columnLetter === undefined || rowLetter === undefined) return fail("northing");

  const squareEasting = Math.floor(easting / 100000) * 100000;
  const squareNorthing = Math.floor(northing / 100000) * 100000;
  const step = 10 ** (5 - precision);
  const digits = (value: number, square: number): string =>
    String(Math.floor((value - square) / step)).padStart(precision, "0");

  return {
    ok: true,
    mgrs: `${String(zone).padStart(2, "0")}${band}${columnLetter}${rowLetter}${digits(easting, squareEasting)}${digits(northing, squareNorthing)}`,
    zone,
    band,
    north: point.lat >= 0,
    squareEasting,
    squareNorthing,
    precision,
    easting,
    northing,
  };
}

/**
 * An MGRS reference back as a UTM coordinate and a latitude and longitude.
 *
 * **A bare 100 km square names a square, not a place, so both readings come
 * back.** The corner is what the string literally says and the centre is what a
 * reader usually wants for a pin; printing only the corner would put every
 * truncated reference half a square from where it looks, and printing only the
 * centre would hide that the string never said which point it meant.
 *
 * **The row letter alone is ambiguous and the band is what resolves it.** Row
 * letters repeat every 2 000 km, so a row letter and a northing suffix leave
 * five candidate squares up the zone; the standard's rule — the square the band
 * names, nearest that band's southern edge — is what picks one, and it is
 * applied by projecting the band's edge and taking the candidate within a
 * square of it rather than by a lookup table nobody could check.
 *
 * Every field is validated: the zone, the band, both letters against the sets
 * their zone and parity allow, and an even number of digits split evenly. A
 * mis-transcribed reference that still parses is the failure this tool exists
 * inside.
 */
export function mgrsToUtm(mgrs: string): ProResult<MgrsToUtmResult> {
  const match = /^(\d{1,2})([A-Z])([A-Z])([A-Z])(\d*)$/.exec(mgrs.trim().toUpperCase().replace(/\s+/g, ""));
  if (match === null) return fail("mgrs");
  const [text, zoneText, band, columnLetter, rowLetter, digits] = match;
  if (
    text === undefined ||
    zoneText === undefined ||
    band === undefined ||
    columnLetter === undefined ||
    rowLetter === undefined ||
    digits === undefined
  ) {
    return fail("mgrs");
  }
  const zone = Number(zoneText);
  if (!isIntegerIn(zone, 1, 60)) return fail("zone");
  if (!MGRS_BANDS.includes(band)) return fail("band");
  if (digits.length % 2 !== 0 || digits.length > 10) return fail("digits");
  const precision = (digits.length / 2) as MgrsPrecision;

  const columnIndex = MGRS_COLUMN_LETTERS.indexOf(columnLetter) - ((zone - 1) % 3) * 8;
  if (columnIndex < 0 || columnIndex > 7) return fail("square");
  const rowLetterIndex = MGRS_ROW_LETTERS.indexOf(rowLetter);
  if (rowLetterIndex === -1) return fail("square");
  const rowIndex = ((rowLetterIndex - (zone % 2 === 1 ? 0 : 5)) % 20 + 20) % 20;
  const north = band >= "N";

  const squareEasting = (columnIndex + 1) * 100000;
  const bandSouthLat = MGRS_BANDS.indexOf(band) * 8 - 80;
  const bandSouthArc = meridionalArc(bandSouthLat * RAD_PER_DEG) * UTM_K0;
  // The candidate squares are the row's repetitions up the zone; the one MGRS
  // means is the first at or below the band's own south edge.
  let squareNorthing = rowIndex * 100000;
  while (squareNorthing > bandSouthArc + 100000) squareNorthing -= 2000000;
  while (squareNorthing + 100000 <= bandSouthArc) squareNorthing += 2000000;

  const step = 10 ** (5 - precision);
  const easting = squareEasting + (precision === 0 ? 0 : Number(digits.slice(0, precision)) * step);
  const northing = squareNorthing + (precision === 0 ? 0 : Number(digits.slice(precision)) * step);

  // The corner and the centre are the corner and centre of the square the
  // string NAMES — a one-metre square at five digits, the whole 100 km square
  // when no digits were written — and not of the 100 km cell the letters give.
  const southWest = utmInverse({ zone, north, easting, northing });
  if (!southWest.ok) return southWest;
  const centre = utmInverse({
    zone,
    north,
    easting: easting + step / 2,
    northing: northing + step / 2,
  });
  if (!centre.ok) return centre;

  return {
    ok: true,
    mgrs: `${zoneText}${band}${columnLetter}${rowLetter}${digits}`,
    zone,
    band,
    north,
    squareEasting,
    squareNorthing,
    precision,
    easting,
    northing,
    southWest: { lat: southWest.lat, lon: southWest.lon },
    centre: { lat: centre.lat, lon: centre.lon },
  };
}

/*
 * geodesic-inverse, geodesic-direct — „Rastojanje i azimut na elipsoidu"
 * ------------------------------------------------------------------------ */

export interface GeodesicInput {
  readonly from: GeoPoint;
  readonly to: GeoPoint;
}

export interface GeodesicInverseResult {
  /** The geodesic's length on the ellipsoid, m. */
  readonly distanceM: number;
  /** The azimuth at the start, degrees true, clockwise from north. */
  readonly initialAzimuthDeg: number;
  /**
   * The azimuth AT the destination, in the direction of travel — the same
   * convention Vincenty published, so his worked examples read across.
   */
  readonly finalAzimuthDeg: number;
  /** The same length in kilometres, for a plan. */
  readonly distanceKm: number;
}

export interface GeodesicDirectInput {
  readonly from: GeoPoint;
  /** The azimuth to set off on, degrees true. */
  readonly azimuthDeg: number;
  readonly distanceM: number;
}

export interface GeodesicDirectResult {
  readonly to: GeoPoint;
  readonly finalAzimuthDeg: number;
}

/**
 * The inverse geodetic problem on WGS84 — Vincenty's 1975 formulae.
 *
 * **Vincenty and not a plane approximation**, because the whole point of the
 * tool is the difference: over 10 km the ellipsoid and a sphere agree to about
 * a metre, over 100 km to about a hundred, and a boundary is measured in
 * metres. The iteration is on the auxiliary longitude `λ` and stops at 10⁻¹³
 * rad, which is below the 0,001 mm the formulae themselves are accurate to;
 * it also carries the standard cap on iterations, because the near-antipodal
 * case converges slowly and a loop that cannot end is worse than a refusal.
 *
 * **The published control line is the meridian.** Vincenty's own test lines are
 * on other ellipsoids, so the control this file is tested against is the WGS84
 * one: the distance from the equator to the pole along a meridian is the
 * quarter meridian, 10 001 965,7293 m, published with the ellipsoid's defining
 * parameters (NIMA TR8350.2) and independently reproduced in the test by
 * Simpson quadrature of the meridional arc.
 */
export function geodesicInverse(input: GeodesicInput): ProResult<GeodesicInverseResult> {
  const { from, to } = input;
  if (!isLatitude(from.lat) || !isLongitude(from.lon)) return fail("from");
  if (!isLatitude(to.lat) || !isLongitude(to.lon)) return fail("to");
  if (from.lat === to.lat && from.lon === to.lon) {
    // Coincident points have no azimuth to give, and a zero would read as due
    // north — a direction somebody could actually steer.
    return fail("coincident");
  }

  const u1 = Math.atan((1 - WGS84_F) * Math.tan(from.lat * RAD_PER_DEG));
  const u2 = Math.atan((1 - WGS84_F) * Math.tan(to.lat * RAD_PER_DEG));
  let lambda = (to.lon - from.lon) * RAD_PER_DEG;
  while (lambda > Math.PI) lambda -= 2 * Math.PI;
  while (lambda < -Math.PI) lambda += 2 * Math.PI;
  const l = lambda;

  const sinU1 = Math.sin(u1);
  const cosU1 = Math.cos(u1);
  const sinU2 = Math.sin(u2);
  const cosU2 = Math.cos(u2);

  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let cosSqAlpha = 0;
  let cos2SigmaM = 0;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    sinSigma = Math.hypot(
      cosU2 * Math.sin(lambda),
      cosU1 * sinU2 - sinU1 * cosU2 * Math.cos(lambda),
    );
    if (sinSigma === 0) return fail("coincident");
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * Math.cos(lambda);
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * Math.sin(lambda)) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    // The equatorial line has cos²α = 0 and no `cos2σm` at all; Vincenty's own
    // note is that the term is zero there rather than undefined.
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
    const c = (WGS84_F / 16) * cosSqAlpha * (4 + WGS84_F * (4 - 3 * cosSqAlpha));
    const previous = lambda;
    lambda =
      l +
      (1 - c) *
        WGS84_F *
        sinAlpha *
        (sigma + c * sinSigma * (cos2SigmaM + c * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - previous) < 1e-13) break;
    if (iteration === 199) return fail("convergence");
  }

  const uSq = (cosSqAlpha * (WGS84_A * WGS84_A - WGS84_B * WGS84_B)) / (WGS84_B * WGS84_B);
  const coefficientA =
    1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const coefficientB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    coefficientB *
    sinSigma *
    (cos2SigmaM +
      (coefficientB / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (coefficientB / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  const distanceM = WGS84_B * coefficientA * (sigma - deltaSigma);
  if (!Number.isFinite(distanceM)) return fail("convergence");

  return {
    ok: true,
    distanceM,
    distanceKm: distanceM / 1000,
    initialAzimuthDeg: foldDegrees(
      Math.atan2(
        cosU2 * Math.sin(lambda),
        cosU1 * sinU2 - sinU1 * cosU2 * Math.cos(lambda),
      ) * DEG_PER_RAD,
    ),
    finalAzimuthDeg: foldDegrees(
      Math.atan2(
        cosU1 * Math.sin(lambda),
        -sinU1 * cosU2 + cosU1 * sinU2 * Math.cos(lambda),
      ) * DEG_PER_RAD,
    ),
  };
}

/** WGS84 semi-minor axis, m — `a(1 − f)`, used by both geodesic functions. */
const WGS84_B = WGS84_A * (1 - WGS84_F);

/**
 * The direct geodetic problem on WGS84 — a point from a start, an azimuth and a
 * distance, by Vincenty's 1975 direct formulae.
 *
 * The pair of `geodesicInverse`, and it is here for the reason a traverse needs
 * both: an inverse computes what a measurement found, a direct lays out what a
 * plan requires. Its own control line is the equatorial one, where the geodesic
 * follows the equator and its length is `a·Δλ` exactly — 10 018 754,1714 m for
 * 90° — so a round trip through the two functions is checkable without a table.
 */
export function geodesicDirect(input: GeodesicDirectInput): ProResult<GeodesicDirectResult> {
  const { from, azimuthDeg, distanceM } = input;
  if (!isLatitude(from.lat) || !isLongitude(from.lon)) return fail("from");
  if (!Number.isFinite(azimuthDeg)) return fail("azimuth");
  if (!isPositive(distanceM)) return fail("distance");

  const alpha1 = foldDegrees(azimuthDeg) * RAD_PER_DEG;
  const tanU1 = (1 - WGS84_F) * Math.tan(from.lat * RAD_PER_DEG);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;
  const sigma1 = Math.atan2(tanU1, Math.cos(alpha1));
  const sinAlpha = cosU1 * Math.sin(alpha1);
  const cosSqAlpha = 1 - sinAlpha * sinAlpha;
  const uSq = (cosSqAlpha * (WGS84_A * WGS84_A - WGS84_B * WGS84_B)) / (WGS84_B * WGS84_B);
  const coefficientA =
    1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const coefficientB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

  let sigma = distanceM / (WGS84_B * coefficientA);
  let cos2SigmaM = 0;
  let sinSigma = 0;
  let cosSigma = 0;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    cos2SigmaM = Math.cos(2 * sigma1 + sigma);
    sinSigma = Math.sin(sigma);
    cosSigma = Math.cos(sigma);
    const deltaSigma =
      coefficientB *
      sinSigma *
      (cos2SigmaM +
        (coefficientB / 4) *
          (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
            (coefficientB / 6) *
              cos2SigmaM *
              (-3 + 4 * sinSigma * sinSigma) *
              (-3 + 4 * cos2SigmaM * cos2SigmaM)));
    const previous = sigma;
    sigma = distanceM / (WGS84_B * coefficientA) + deltaSigma;
    if (Math.abs(sigma - previous) < 1e-13) break;
    if (iteration === 199) return fail("convergence");
  }

  const temp = sinU1 * sinSigma - cosU1 * cosSigma * Math.cos(alpha1);
  const latRad = Math.atan2(
    sinU1 * cosSigma + cosU1 * sinSigma * Math.cos(alpha1),
    (1 - WGS84_F) * Math.sqrt(sinAlpha * sinAlpha + temp * temp),
  );
  const lambda = Math.atan2(
    sinSigma * Math.sin(alpha1),
    cosU1 * cosSigma - sinU1 * sinSigma * Math.cos(alpha1),
  );
  const c = (WGS84_F / 16) * cosSqAlpha * (4 + WGS84_F * (4 - 3 * cosSqAlpha));
  const l =
    lambda -
    (1 - c) *
      WGS84_F *
      sinAlpha *
      (sigma + c * sinSigma * (cos2SigmaM + c * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  const lat = latRad * DEG_PER_RAD;
  const lon = from.lon + l * DEG_PER_RAD;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fail("convergence");

  const finalAzimuth = Math.atan2(sinAlpha, -temp) * DEG_PER_RAD;
  return {
    ok: true,
    to: { lat, lon: ((lon + 540) % 360) - 180 },
    finalAzimuthDeg: foldDegrees(finalAzimuth),
  };
}

/*
 * grid-ground-ratio — „Mreža i teren"
 * ------------------------------------------------------------------------ */

export interface GridGroundInput {
  readonly from: GeoPoint;
  readonly to: GeoPoint;
}

export interface GridGroundResult {
  /** The geodesic length on the ellipsoid, m. */
  readonly groundDistanceM: number;
  /** The length of the straight line between the two projected points, m. */
  readonly gridDistanceM: number;
  /** Grid ÷ ground — the combined factor at this line, and what a plan needs. */
  readonly ratio: number;
  readonly fromUtm: UtmForwardResult;
  readonly toUtm: UtmForwardResult;
}

/**
 * The two distances between the same pair of points: on the ellipsoid, and on
 * the projected grid.
 *
 * **This is the ratio a surveyor measures a boundary with.** A distance
 * measured on the ground and a distance drawn on a UTM grid differ by the point
 * scale factor and by the height above the ellipsoid; the first is exactly
 * `k₀ = 0,9996` on a central meridian and rises towards the zone edge, and the
 * second is why a line measured at 1 500 m of altitude is longer on the ground
 * than on the grid of the same points. The tool prints both lengths and their
 * quotient, and it names the pair rather than asserting a correction — the
 * elevation factor needs a height this tool is not given, so the ratio it
 * reports is the grid-versus-ellipsoid one and says so.
 *
 * **Two zones or two hemispheres are refused.** A straight line between two
 * projected points in different zones is not a distance on any grid — it is two
 * different grids' numbers subtracted from each other, and it looks like an
 * ordinary answer.
 */
export function gridGroundRatio(input: GridGroundInput): ProResult<GridGroundResult> {
  const { from, to } = input;
  const fromUtm = utmForward(from);
  if (!fromUtm.ok) return fromUtm;
  const toUtm = utmForward(to);
  if (!toUtm.ok) return toUtm;
  if (fromUtm.zone !== toUtm.zone) return fail("zone");
  if (fromUtm.north !== toUtm.north) return fail("hemisphere");

  const geodesic = geodesicInverse({ from, to });
  if (!geodesic.ok) return geodesic;
  const gridDistanceM = Math.hypot(
    toUtm.easting - fromUtm.easting,
    toUtm.northing - fromUtm.northing,
  );
  const ratio = quotient(gridDistanceM, geodesic.distanceM);
  if (ratio === undefined) return fail("distance");
  return {
    ok: true,
    groundDistanceM: geodesic.distanceM,
    gridDistanceM,
    ratio,
    fromUtm,
    toUtm,
  };
}
