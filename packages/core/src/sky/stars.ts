/**
 * The star map's data and its geometry: the catalogue `starCatalogue.ts`
 * ships, the reduction of a catalogue direction to where a star actually
 * appears, and the search the map's own field runs.
 *
 * **The chain, in one place, in this order.** A catalogue position is at J2000
 * and a sky is at an instant, so a star is drawn after four steps:
 *
 *   1. precession to the date (Meeus ch. 21 - {@link precessEquatorial});
 *   2. nutation in longitude and obliquity (ch. 22, whose two angles `earth.ts`
 *      already computes for the Sun's own place);
 *   3. annual aberration, 20.49552 arcseconds of it, from the Sun's longitude
 *      of date (ch. 23);
 *   4. the rotation to altitude and azimuth (ch. 13,
 *      {@link horizontalFromEquatorial}).
 *
 * The order is not a preference. Each step's argument is the frame the step
 * before it produced: aberration is defined against the Sun's longitude in the
 * frame of date, so applying it before precession would rotate a vector in a
 * frame that no longer exists, and the answer would be wrong by the amount the
 * two frames differ - a third of a degree, which is not a rounding error.
 *
 * **The three steps are two orders of magnitude apart and all three are
 * needed.** Precession is 0.37 degrees over a quarter century, nutation reaches
 * 17 arcseconds, aberration 20.5 - and the map is accepted at one arcminute,
 * which is 60 arcseconds. Precession alone spends three quarters of the budget;
 * precession and nutation spend four fifths; all three leave about an
 * arcsecond, which the oracle test in this module's suite measures rather than
 * promises (1.05 arcseconds of altitude, 1.74 of azimuth, 0.10 of declination
 * over its ten cases).
 *
 * **A {@link SkyFrame} is what does not depend on the star.** Sidereal time,
 * the two Julian days and the Sun's longitude are the same for all 5,080
 * stars, so they are computed once per place and instant and handed to the
 * per-star calls: a renderer looping over the catalogue recomputing them would
 * be doing the trigonometry of the Earth's rotation 5,080 times a frame.
 *
 * **Both altitudes are reported, exactly as the Sun's are.** `altitude` is the
 * geometric one and is what the oracle is compared against - USNO publishes
 * `hc`, a geometric altitude, and JPL's answers are geometric too.
 * `apparentAltitude` adds {@link refractionDegrees}, which is what the eye
 * sees, and is what a map of the horizon should draw: the atmosphere lifts a
 * body near the horizon by about half a degree, which is the whole width of the
 * Moon.
 *
 * **Proper motion is deliberately not applied**, so a star is drawn where its
 * J2000 catalogue position puts it in the frame of date and not where the star
 * has since drifted. It is a property of one star rather than of the frame, the
 * catalogue carries no velocities, and over the quarter century between J2000
 * and this engine's first decades the omission is under an arcsecond for almost
 * every naked-eye star. Arcturus, the fastest of them, is the exception at about
 * a minute of arc; it is named here rather than left for somebody to discover
 * by pointing the map at it.
 */
import {
  ARCSECONDS_PER_DEGREE,
  asinDeg,
  atan2Deg,
  clampUnit,
  cosDeg,
  normalize360,
  sinDeg,
  tanDeg,
} from "./angles.js";
import type { Constellation, LatLon, Star } from "./contract.js";
import {
  J2000_JULIAN_EPHEMERIS_DAY,
  apparentSiderealTimeDegrees,
  meanObliquityDegrees,
  nutationDegrees,
} from "./earth.js";
import { horizontalFromEquatorial, refractionDegrees, type SkyPlace } from "./horizontal.js";
import { instantMilliseconds, julianDay, julianEphemerisDay, type SkyInstant } from "./julian.js";
import { precessEquatorial, type EquatorialDirection } from "./precession.js";
import {
  CONSTELLATION_ANCHORS,
  CONSTELLATIONS,
  STAR_NAMES,
  STAR_TABLE,
} from "./starCatalogue.js";
import { sunGeometricEclipticLongitudeDegrees } from "./sun.js";

export { precessEquatorial, precessionAngles } from "./precession.js";
export type { EquatorialDirection, PrecessionAngles } from "./precession.js";
export {
  HORIZON_RADIUS,
  ZENITH,
  projectStereographic,
  unprojectStereographic,
} from "./starProjection.js";
export type { HorizontalDirection, PlanePoint } from "./starProjection.js";

/** The catalogue's magnitude limit: 6.0, the faintest a good naked eye reaches. */
export const NAKED_EYE_MAGNITUDE_LIMIT = 6;

/** Numbers per star in the shipped table: `[hr, raDeg, decDeg, magnitude, colourIndex]`. */
const STAR_STRIDE = 5;

/** How many stars the table carries. Derived from the table, never restated. */
export const STAR_COUNT = STAR_TABLE.length / STAR_STRIDE;

/** How many search matches a caller is offered before it stops being a list. */
export const SKY_SEARCH_LIMIT = 20;

/** The constant of annual aberration (Meeus ch. 23, the 1976 value he prints). */
const ABERRATION_ARCSECONDS = 20.49552;

/** The language a constellation's own name is read in - the app's two, and the contract's two. */
export type SkyLabelLocale = "sr" | "en";

/** Everything about an instant and a place that the geometry needs and that no star changes. */
export interface SkyFrame {
  readonly place: SkyPlace;
  readonly instantMs: number;
  readonly julianDay: number;
  readonly julianEphemerisDay: number;
  /** The observer's own apparent sidereal time, degrees: the longitude is already in it. */
  readonly siderealDegrees: number;
  /** The Sun's geometric ecliptic longitude of date, degrees - what annual aberration is built from. */
  readonly sunLongitude: number;
}

/** One star, where it appears, and where that is in the sky overhead. */
export interface StarPlacement {
  readonly star: Star;
  /** The apparent place of date: precessed, nutated and aberrated. */
  readonly direction: EquatorialDirection;
  /** Degrees clockwise from true north. */
  readonly azimuth: number;
  /** Degrees above the horizon, geometric. */
  readonly altitude: number;
  /** The same as the atmosphere makes it look. */
  readonly apparentAltitude: number;
}

/** What the search field offers: one star, or one constellation, and the word it is found by. */
export type SkySearchMatch =
  | { readonly kind: "star"; readonly label: string; readonly star: Star }
  | {
      readonly kind: "constellation";
      readonly label: string;
      readonly constellation: Constellation;
    };

/**
 * A number out of the flat table, refusing a read past its end.
 *
 * `noUncheckedIndexedAccess` is why this exists at all, and the refusal is
 * deliberate rather than a `?? 0`: a missing field would otherwise become a
 * star at right ascension zero, which draws fine and is wrong. The table's own
 * test pins its length as a multiple of the stride, so this can never fire in a
 * tree that is green.
 */
function tableNumber(index: number): number {
  const value = STAR_TABLE[index];
  if (value === undefined) throw new Error(`the star table has no field ${index}`);
  return value;
}

/** The IAU's proper names, keyed by HR number, built once. */
const NAME_BY_HR = new Map<number, string>(STAR_NAMES);

/**
 * One row of the table as the contract's `Star`.
 *
 * The two optional fields are spread rather than assigned `undefined`, because
 * `exactOptionalPropertyTypes` is on: a star with no IAU name is a star without
 * the property, which is what a caller testing `star.name !== undefined` reads.
 */
function starFromTable(index: number): Star {
  const base = index * STAR_STRIDE;
  const hr = tableNumber(base);
  const name = NAME_BY_HR.get(hr);
  const colourIndex = tableNumber(base + STAR_STRIDE - 1);
  const colour = Number.isNaN(colourIndex) ? {} : { colourIndex };
  return {
    hr,
    ...(name === undefined ? {} : { name }),
    raDeg: tableNumber(base + 1),
    decDeg: tableNumber(base + 2),
    magnitude: tableNumber(base + 3),
    ...colour,
  };
}

let starCache: readonly Star[] | null = null;

/** Every star in the catalogue, in HR order, built once and kept. */
export function allStars(): readonly Star[] {
  starCache ??= Array.from({ length: STAR_COUNT }, (_, index) => starFromTable(index));
  return starCache;
}

/** The stars at or brighter than `limit`, in HR order. The map's usual call is the default. */
export function starsBrighterThan(limit: number = NAKED_EYE_MAGNITUDE_LIMIT): readonly Star[] {
  return allStars().filter((star) => star.magnitude <= limit);
}

let constellationCache: readonly Constellation[] | null = null;

/**
 * The 88 IAU constellations in the contract's shape.
 *
 * `lines` is empty for every one of them, and that is a decision rather than an
 * omission: the IAU defines no stick figures, every published figure set is
 * somebody's creative work under its own licence, and the sets whose licences
 * the research cleared are share-alike - see `starCatalogue.ts`'s header. The
 * map draws names against the anchors below and no figures.
 */
export function constellations(): readonly Constellation[] {
  constellationCache ??= CONSTELLATIONS.map((row) => ({
    id: row.id,
    name: { latin: row.latin, sr: row.sr, en: row.en },
    lines: [],
  }));
  return constellationCache;
}

/** One constellation by its IAU abbreviation, or `null`. */
export function constellationById(id: string): Constellation | null {
  return constellations().find((constellation) => constellation.id === id) ?? null;
}

const ANCHOR_BY_ID = new Map<string, EquatorialDirection>(
  CONSTELLATION_ANCHORS.map(([id, raDeg, decDeg]) => [id, { rightAscension: raDeg, declination: decDeg }]),
);

/**
 * Where a constellation's name is drawn, as a catalogue direction: the mean
 * direction of that region's IAU boundary vertices. `null` for an id the
 * catalogue does not carry.
 *
 * It is a direction at J2000 like any other, so it goes through exactly the
 * same reduction as a star does: the name moves with the sky it belongs to.
 */
export function constellationAnchor(id: string): EquatorialDirection | null {
  return ANCHOR_BY_ID.get(id) ?? null;
}

/** The contract's `LatLon` as the engine's own place. */
export function skyPlace(latLon: LatLon): SkyPlace {
  return { latitude: latLon.latDeg, longitude: latLon.lonDeg };
}

/** Everything about this place and instant that no star changes. */
export function skyFrame(place: SkyPlace, at: SkyInstant): SkyFrame {
  const julianDayNumber = julianDay(at);
  const ephemerisDay = julianEphemerisDay(at);
  return {
    place,
    instantMs: instantMilliseconds(at),
    julianDay: julianDayNumber,
    julianEphemerisDay: ephemerisDay,
    // The sidereal time is read at the instant in UT, not in TT - the Earth's
    // rotation is what it measures, which `earth.ts` argues at length.
    siderealDegrees: apparentSiderealTimeDegrees(julianDayNumber, place.longitude),
    sunLongitude: sunGeometricEclipticLongitudeDegrees(ephemerisDay),
  };
}

/** A star's catalogue position as a direction. */
export function starDirection(star: Star): EquatorialDirection {
  return { rightAscension: star.raDeg, declination: star.decDeg };
}

/**
 * Where a J2000 direction appears at the frame's instant: precessed, nutated,
 * then aberrated (Meeus ch. 21, 22 and 23).
 *
 * The right ascension of a direction exactly at a celestial pole is genuinely
 * undefined, and the nutation term in right ascension grows without bound
 * there; nothing in this catalogue is closer to a pole than Polaris's 0.74
 * degrees, where the term is worth a fortieth of an arcsecond.
 */
export function apparentDirection(
  direction: EquatorialDirection,
  frame: SkyFrame,
): EquatorialDirection {
  const jde = frame.julianEphemerisDay;
  const precessed = precessEquatorial(direction, J2000_JULIAN_EPHEMERIS_DAY, jde);
  const nutation = nutationDegrees(jde);
  const meanObliquity = meanObliquityDegrees(jde);
  const obliquity = meanObliquity + nutation.obliquity;
  const nutated = nutate(precessed, nutation.longitude, meanObliquity, obliquity);
  const kappa = ABERRATION_ARCSECONDS / ARCSECONDS_PER_DEGREE;
  const sun = frame.sunLongitude;
  const ra = nutated.rightAscension;
  const dec = nutated.declination;
  const deltaRightAscension =
    (-kappa * (cosDeg(ra) * cosDeg(sun) * cosDeg(obliquity) + sinDeg(ra) * sinDeg(sun))) /
    cosDeg(dec);
  const deltaDeclination =
    -kappa *
    (cosDeg(sun) * cosDeg(obliquity) * (tanDeg(obliquity) * cosDeg(dec) - sinDeg(ra) * sinDeg(dec)) +
      cosDeg(ra) * sinDeg(dec) * sinDeg(sun));
  return {
    rightAscension: normalize360(ra + deltaRightAscension),
    declination: dec + deltaDeclination,
  };
}

/**
 * The classical nutation rotation, applied as a rotation of the vector rather
 * than through the chapter's linearised scalars:
 * `R1(-(eps + dEps)) R3(-dPsi) R1(eps)`, which is the matrix Meeus ch. 22
 * describes and SOFA's `iauNutm80` states.
 *
 * **Why the matrix and not ch. 23's two expressions.** The scalars
 * (`dAlpha = (cos eps + sin eps sin alpha tan delta) dPsi - cos alpha dEps` and
 * its declination twin) are the first-order form of this rotation, and the
 * declination half of them is exact to a thousandth of an arcsecond. The right
 * ascension half is not: measured against an independent implementation of the
 * IAU 2000A models on 2026-10-10, it is out by **4.5 arcseconds** at the
 * declination of Arcturus and 2.2 at Sirius's, against a 60-arcsecond bar -
 * because the second term carries a `tan delta` the remembered form of the
 * formula drops, so the error grows with the star's distance from the pole.
 * The matrix has no such failure mode and no approximation to get wrong: it is
 * three rotations, each of which is a line of arithmetic.
 *
 * The obliquity arguments are the mean one and the same plus the nutation in
 * obliquity, in that order - the rotation enters the ecliptic of DATE and comes
 * back to the true equator of date, and swapping the two would rotate into the
 * wrong plane.
 */
function nutate(
  direction: EquatorialDirection,
  longitude: number,
  meanObliquity: number,
  trueObliquity: number,
): EquatorialDirection {
  const cosDeclination = cosDeg(direction.declination);
  const vector: readonly [number, number, number] = [
    cosDeclination * cosDeg(direction.rightAscension),
    cosDeclination * sinDeg(direction.rightAscension),
    sinDeg(direction.declination),
  ];
  // The three rotations of the matrix, in its own order: into the ecliptic of
  // date, along it by the nutation in longitude, and back to the true equator.
  const tilted = aboutX(vector, meanObliquity);
  const swung = aboutZ(tilted, -longitude);
  const back = aboutX(swung, -trueObliquity);
  return {
    rightAscension: normalize360(atan2Deg(back[1], back[0])),
    declination: asinDeg(clampUnit(back[2])),
  };
}

/** A rotation about the x axis of the equatorial frame: the frame `R1` of the classical matrix. */
function aboutX(
  vector: readonly [number, number, number],
  degrees: number,
): readonly [number, number, number] {
  const cos = cosDeg(degrees);
  const sin = sinDeg(degrees);
  return [vector[0], vector[1] * cos + vector[2] * sin, -vector[1] * sin + vector[2] * cos];
}

/** A rotation about the z axis, which is the pole the nutation in longitude swings about. */
function aboutZ(
  vector: readonly [number, number, number],
  degrees: number,
): readonly [number, number, number] {
  const cos = cosDeg(degrees);
  const sin = sinDeg(degrees);
  return [vector[0] * cos + vector[1] * sin, -vector[0] * sin + vector[1] * cos, vector[2]];
}

/** Where a direction is in the sky overhead, geometric and as the eye sees it. */
export function horizontalOf(
  direction: EquatorialDirection,
  frame: SkyFrame,
): { readonly azimuth: number; readonly altitude: number; readonly apparentAltitude: number } {
  const { azimuth, altitude } = horizontalFromEquatorial(
    frame.place,
    direction,
    frame.siderealDegrees,
  );
  return { azimuth, altitude, apparentAltitude: altitude + refractionDegrees(altitude) };
}

/** One star's whole answer for one frame: where it appears and where that is overhead. */
export function starPlacement(star: Star, frame: SkyFrame): StarPlacement {
  const direction = apparentDirection(starDirection(star), frame);
  return { star, direction, ...horizontalOf(direction, frame) };
}

/**
 * The whole naked-eye sky for a place and instant, in HR order.
 *
 * It reports every star at or brighter than the limit, above the horizon or
 * not: which of them a view draws is the view's question, and a caller asking
 * for a star's altitude through the horizon is asking something legitimate -
 * that is how a rise is solved.
 */
export function starSky(
  place: SkyPlace,
  at: SkyInstant,
  limit: number = NAKED_EYE_MAGNITUDE_LIMIT,
): readonly StarPlacement[] {
  const frame = skyFrame(place, at);
  return starsBrighterThan(limit).map((star) => starPlacement(star, frame));
}

/**
 * Fold a word for searching: lower case, and without the diacritics that
 * `Intl`'s own case folding leaves in place. `Č` and `C` are the same key here
 * for the same reason the app's search folds Serbian: a reader typing `skorpija`
 * on a keyboard without the letters means Škorpija.
 */
export function foldSkyText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Serbian sorting for the names this module hands back, as everywhere else in
 * the app: `sr-Latn` first, because plain `sr` carries the Cyrillic tailoring
 * and sorts Latin č, ć, š and ž wrongly.
 */
const SKY_COLLATOR = new Intl.Collator(["sr-Latn", "sr"]);

/** 0 for a word that IS the query, 1 for one that starts with it, 2 for one that contains it, `null` for none. */
function matchRank(candidate: string, needle: string): number | null {
  if (candidate === needle) return 0;
  if (candidate.startsWith(needle)) return 1;
  return candidate.includes(needle) ? 2 : null;
}

/**
 * The star map's own search: a word against every proper name and every
 * constellation name in the language being read, or a number against every HR
 * number.
 *
 * Ranking, once, because "which of these twenty does the reader mean" is a
 * question with an answer: an exact match first, then a word starting with the
 * query, then one containing it; within a rank the brighter star comes first,
 * stars come before constellations, and the constellations are in the
 * collator's order because that is the order Serbian sorts in.
 *
 * **What a star is found by is its IAU name, not its Bayer letter.** The
 * catalogue ships the names the IAU gave the stars and the HR numbers V/50
 * gave them, so `Sirius` and `2491` both find the same star and `α CMa` finds
 * nothing - a search that answered for designations the data does not carry
 * would be inventing them.
 */
export function searchSky(query: string, locale: SkyLabelLocale): readonly SkySearchMatch[] {
  const needle = foldSkyText(query);
  if (needle === "") return [];
  const hrQuery = /^(?:hr)?(\d{1,5})$/.exec(needle)?.[1];
  const ranked: { readonly rank: number; readonly match: SkySearchMatch }[] = [];
  for (const star of allStars()) {
    const name = star.name;
    if (name !== undefined) {
      const rank = matchRank(foldSkyText(name), needle);
      if (rank !== null) ranked.push({ rank, match: { kind: "star", label: name, star } });
    }
    if (hrQuery !== undefined && String(star.hr) === hrQuery) {
      ranked.push({ rank: 0, match: { kind: "star", label: `HR ${star.hr}`, star } });
    }
  }
  for (const constellation of constellations()) {
    const label = constellation.name[locale];
    const rank = matchRank(foldSkyText(label), needle);
    if (rank !== null) {
      ranked.push({ rank, match: { kind: "constellation", label, constellation } });
    }
  }
  return ranked
    .sort(
      (a, b) =>
        a.rank - b.rank || kindOrder(a.match) - kindOrder(b.match) || compareWithinKind(a.match, b.match),
    )
    .slice(0, SKY_SEARCH_LIMIT)
    .map((entry) => entry.match);
}

/** Stars before constellations: a word that names both kinds should be read brightness-first. */
function kindOrder(match: SkySearchMatch): number {
  return match.kind === "star" ? 0 : 1;
}

/**
 * Two matches of the same kind, in the order a reader scans them: brighter
 * stars first, constellations in the collator's order.
 *
 * The magnitudes are compared here rather than folded into the key above,
 * because a constellation has no magnitude and `Infinity - Infinity` is `NaN`,
 * which is a comparator that sorts differently every run.
 */
function compareWithinKind(a: SkySearchMatch, b: SkySearchMatch): number {
  if (a.kind === "star" && b.kind === "star") return a.star.magnitude - b.star.magnitude;
  if (a.kind === "constellation" && b.kind === "constellation") {
    return SKY_COLLATOR.compare(a.label, b.label);
  }
  return 0;
}
