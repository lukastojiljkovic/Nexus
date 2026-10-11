/**
 * The solar system: where the eight planets and Pluto are, how they turn, and
 * the path each of them draws.
 *
 * **Positions are JPL's approximation and this file is its transcription.** The
 * source is E. M. Standish's "Approximate Positions of the Planets"
 * (https://ssd.jpl.nasa.gov/planets/approx_pos.html, retrieved 2026-10-09):
 * Keplerian elements and their rates for 1800-2050 in its Table 1, and for
 * 3000 BC-3000 AD in its Table 2a with the extra mean-anomaly terms of Table 2b
 * for Jupiter through Neptune. Both are stated with respect to the mean ecliptic
 * and equinox of J2000, which is the frame `contract.ts` asks for, and the epoch
 * is the Julian Ephemeris Day that `julian.ts` already supplies.
 *
 * The two tables are not a refinement of one another: Table 1 is a short fit
 * that is better inside its window (Mercury's longitude error 15" against 20",
 * Uranus' distance error 1 000 000 km against 8 000 000), and Table 2a is the
 * only one that reaches outside it. The choice is therefore by date, at the
 * window's own edges, and crossing it changes accuracy rather than position.
 *
 * **The published error bounds are the table's, not this file's**; they are
 * quoted per body in `planets.test.ts`, which measures the engine against
 * Horizons and reports the largest error it found.
 *
 * **Earth is not the barycentre it is tabulated as.** Table 1's "EM Bary" row is
 * the Earth-Moon barycentre, a point about 4 700 km from the Earth's centre, so
 * the Earth's own position is that barycentre corrected by the geocentric Moon
 * this package already computes, and the Moon's heliocentric position is the
 * same correction added rather than subtracted. The Moon therefore inherits Meeus
 * ch. 47's accuracy rather than Table 1's.
 *
 * Radii, poles and prime-meridian angles are the IAU Working Group on
 * Cartographic Coordinates and Rotational Elements' 2015 report (Archinal et
 * al., Celestial Mechanics and Dynamical Astronomy 130:22, 2018), quoted per
 * body below. Its model's argument `d` is the interval in days from J2000.0, and
 * the report writes the Earth's rotation as a GMST relation rather than a `W`
 * polynomial; the table below carries the report's own equivalent `W` model
 * (`W0 = 190.147`, `Wdot = 360.9856235`), which is the same rotation to the
 * accuracy a globe texture needs.
 */
import { cosDeg, normalize360, sinDeg } from "./angles.js";
import { J2000_JULIAN_EPHEMERIS_DAY } from "./earth.js";
import type { BodyId, BodyState, OrbitPath, SolarSystemSnapshot, Vector3 } from "./contract.js";
import { julianEphemerisDay } from "./julian.js";
import { moonEcliptic } from "./moon.js";
import { bodyFrame, fromEcliptic, magnitude, subtract, type BodyFrame } from "./vector.js";

/** The Astronomical Unit, in kilometres: the value IAU 2012 fixed. */
const AU_KM = 149_597_870.7;

/** One body's Keplerian elements and their rates: Table 1 or Table 2a, as written. */
interface OrbitalElements {
  readonly semiMajorAxisAu: number;
  readonly semiMajorAxisPerCentury: number;
  readonly eccentricity: number;
  readonly eccentricityPerCentury: number;
  readonly inclinationDeg: number;
  readonly inclinationPerCentury: number;
  readonly meanLongitudeDeg: number;
  readonly meanLongitudePerCentury: number;
  readonly longitudeOfPerihelionDeg: number;
  readonly longitudeOfPerihelionPerCentury: number;
  readonly longitudeOfNodeDeg: number;
  readonly longitudeOfNodePerCentury: number;
  /**
   * Table 2b's extra mean-anomaly terms, `b T^2 + c cos(f T) + s sin(f T)`,
   * where `T` is the same argument the element table itself is written in.
   * Absent for the bodies that carry none.
   */
  readonly extra?: { readonly b: number; readonly c: number; readonly s: number; readonly f: number };
}

/** Table 1, "valid for the time-interval 1800 AD - 2050 AD". */
const ELEMENTS_1800_2050: readonly (readonly [BodyId, OrbitalElements])[] = [
  [
    "mercury",
    {
      semiMajorAxisAu: 0.38709927, semiMajorAxisPerCentury: 0.00000037,
      eccentricity: 0.20563593, eccentricityPerCentury: 0.00001906,
      inclinationDeg: 7.00497902, inclinationPerCentury: -0.00594749,
      meanLongitudeDeg: 252.2503235, meanLongitudePerCentury: 149472.67411175,
      longitudeOfPerihelionDeg: 77.45779628, longitudeOfPerihelionPerCentury: 0.16047689,
      longitudeOfNodeDeg: 48.33076593, longitudeOfNodePerCentury: -0.12534081,
    },
  ],
  [
    "venus",
    {
      semiMajorAxisAu: 0.72333566, semiMajorAxisPerCentury: 0.0000039,
      eccentricity: 0.00677672, eccentricityPerCentury: -0.00004107,
      inclinationDeg: 3.39467605, inclinationPerCentury: -0.0007889,
      meanLongitudeDeg: 181.9790995, meanLongitudePerCentury: 58517.81538729,
      longitudeOfPerihelionDeg: 131.60246718, longitudeOfPerihelionPerCentury: 0.00268329,
      longitudeOfNodeDeg: 76.67984255, longitudeOfNodePerCentury: -0.27769418,
    },
  ],
  [
    "earth",
    {
      semiMajorAxisAu: 1.00000261, semiMajorAxisPerCentury: 0.00000562,
      eccentricity: 0.01671123, eccentricityPerCentury: -0.00004392,
      inclinationDeg: -0.00001531, inclinationPerCentury: -0.01294668,
      meanLongitudeDeg: 100.46457166, meanLongitudePerCentury: 35999.37244981,
      longitudeOfPerihelionDeg: 102.93768193, longitudeOfPerihelionPerCentury: 0.32327364,
      longitudeOfNodeDeg: 0, longitudeOfNodePerCentury: 0,
    },
  ],
  [
    "mars",
    {
      semiMajorAxisAu: 1.52371034, semiMajorAxisPerCentury: 0.00001847,
      eccentricity: 0.0933941, eccentricityPerCentury: 0.00007882,
      inclinationDeg: 1.84969142, inclinationPerCentury: -0.00813131,
      meanLongitudeDeg: -4.55343205, meanLongitudePerCentury: 19140.30268499,
      longitudeOfPerihelionDeg: -23.94362959, longitudeOfPerihelionPerCentury: 0.44441088,
      longitudeOfNodeDeg: 49.55953891, longitudeOfNodePerCentury: -0.29257343,
    },
  ],
  [
    "jupiter",
    {
      semiMajorAxisAu: 5.202887, semiMajorAxisPerCentury: -0.00011607,
      eccentricity: 0.04838624, eccentricityPerCentury: -0.00013253,
      inclinationDeg: 1.30439695, inclinationPerCentury: -0.00183714,
      meanLongitudeDeg: 34.39644051, meanLongitudePerCentury: 3034.74612775,
      longitudeOfPerihelionDeg: 14.72847983, longitudeOfPerihelionPerCentury: 0.21252668,
      longitudeOfNodeDeg: 100.47390909, longitudeOfNodePerCentury: 0.20469106,
    },
  ],
  [
    "saturn",
    {
      semiMajorAxisAu: 9.53667594, semiMajorAxisPerCentury: -0.0012506,
      eccentricity: 0.05386179, eccentricityPerCentury: -0.00050991,
      inclinationDeg: 2.48599187, inclinationPerCentury: 0.00193609,
      meanLongitudeDeg: 49.95424423, meanLongitudePerCentury: 1222.49362201,
      longitudeOfPerihelionDeg: 92.59887831, longitudeOfPerihelionPerCentury: -0.41897216,
      longitudeOfNodeDeg: 113.66242448, longitudeOfNodePerCentury: -0.28867794,
    },
  ],
  [
    "uranus",
    {
      semiMajorAxisAu: 19.18916464, semiMajorAxisPerCentury: -0.00196176,
      eccentricity: 0.04725744, eccentricityPerCentury: -0.00004397,
      inclinationDeg: 0.77263783, inclinationPerCentury: -0.00242939,
      meanLongitudeDeg: 313.23810451, meanLongitudePerCentury: 428.48202785,
      longitudeOfPerihelionDeg: 170.9542763, longitudeOfPerihelionPerCentury: 0.40805281,
      longitudeOfNodeDeg: 74.01692503, longitudeOfNodePerCentury: 0.04240589,
    },
  ],
  [
    "neptune",
    {
      semiMajorAxisAu: 30.06992276, semiMajorAxisPerCentury: 0.00026291,
      eccentricity: 0.00859048, eccentricityPerCentury: 0.00005105,
      inclinationDeg: 1.77004347, inclinationPerCentury: 0.00035372,
      meanLongitudeDeg: -55.12002969, meanLongitudePerCentury: 218.45945325,
      longitudeOfPerihelionDeg: 44.96476227, longitudeOfPerihelionPerCentury: -0.32241464,
      longitudeOfNodeDeg: 131.78422574, longitudeOfNodePerCentury: -0.00508664,
    },
  ],
];

/** Table 2a, "valid for the time-interval 3000 BC -- 3000 AD", with Table 2b's extra terms. */
const ELEMENTS_3000_BC_3000_AD: readonly (readonly [BodyId, OrbitalElements])[] = [
  [
    "mercury",
    {
      semiMajorAxisAu: 0.38709843, semiMajorAxisPerCentury: 0,
      eccentricity: 0.20563661, eccentricityPerCentury: 0.00002123,
      inclinationDeg: 7.00559432, inclinationPerCentury: -0.00590158,
      meanLongitudeDeg: 252.25166724, meanLongitudePerCentury: 149472.67486623,
      longitudeOfPerihelionDeg: 77.45771895, longitudeOfPerihelionPerCentury: 0.15940013,
      longitudeOfNodeDeg: 48.33961819, longitudeOfNodePerCentury: -0.12214182,
    },
  ],
  [
    "venus",
    {
      semiMajorAxisAu: 0.72332102, semiMajorAxisPerCentury: -0.00000026,
      eccentricity: 0.00676399, eccentricityPerCentury: -0.00005107,
      inclinationDeg: 3.39777545, inclinationPerCentury: 0.00043494,
      meanLongitudeDeg: 181.9797085, meanLongitudePerCentury: 58517.8156026,
      longitudeOfPerihelionDeg: 131.76755713, longitudeOfPerihelionPerCentury: 0.05679648,
      longitudeOfNodeDeg: 76.67261496, longitudeOfNodePerCentury: -0.27274174,
    },
  ],
  [
    "earth",
    {
      semiMajorAxisAu: 1.00000018, semiMajorAxisPerCentury: -0.00000003,
      eccentricity: 0.01673163, eccentricityPerCentury: -0.00003661,
      inclinationDeg: -0.00054346, inclinationPerCentury: -0.01337178,
      meanLongitudeDeg: 100.46691572, meanLongitudePerCentury: 35999.37306329,
      longitudeOfPerihelionDeg: 102.93005885, longitudeOfPerihelionPerCentury: 0.3179526,
      longitudeOfNodeDeg: -5.11260389, longitudeOfNodePerCentury: -0.24123856,
    },
  ],
  [
    "mars",
    {
      semiMajorAxisAu: 1.52371243, semiMajorAxisPerCentury: 0.00000097,
      eccentricity: 0.09336511, eccentricityPerCentury: 0.00009149,
      inclinationDeg: 1.85181869, inclinationPerCentury: -0.00724757,
      meanLongitudeDeg: -4.56813164, meanLongitudePerCentury: 19140.29934243,
      longitudeOfPerihelionDeg: -23.91744784, longitudeOfPerihelionPerCentury: 0.45223625,
      longitudeOfNodeDeg: 49.71320984, longitudeOfNodePerCentury: -0.26852431,
    },
  ],
  [
    "jupiter",
    {
      semiMajorAxisAu: 5.20248019, semiMajorAxisPerCentury: -0.00002864,
      eccentricity: 0.0485359, eccentricityPerCentury: 0.00018026,
      inclinationDeg: 1.29861416, inclinationPerCentury: -0.00322699,
      meanLongitudeDeg: 34.33479152, meanLongitudePerCentury: 3034.90371757,
      longitudeOfPerihelionDeg: 14.27495244, longitudeOfPerihelionPerCentury: 0.18199196,
      longitudeOfNodeDeg: 100.29282654, longitudeOfNodePerCentury: 0.13024619,
      extra: { b: -0.00012452, c: 0.0606406, s: -0.35635438, f: 38.35125 },
    },
  ],
  [
    "saturn",
    {
      semiMajorAxisAu: 9.54149883, semiMajorAxisPerCentury: -0.00003065,
      eccentricity: 0.05550825, eccentricityPerCentury: -0.00032044,
      inclinationDeg: 2.49424102, inclinationPerCentury: 0.00451969,
      meanLongitudeDeg: 50.07571329, meanLongitudePerCentury: 1222.11494724,
      longitudeOfPerihelionDeg: 92.86136063, longitudeOfPerihelionPerCentury: 0.54179478,
      longitudeOfNodeDeg: 113.63998702, longitudeOfNodePerCentury: -0.25015002,
      extra: { b: 0.00025899, c: -0.13434469, s: 0.87320147, f: 38.35125 },
    },
  ],
  [
    "uranus",
    {
      semiMajorAxisAu: 19.18797948, semiMajorAxisPerCentury: -0.00020455,
      eccentricity: 0.0468574, eccentricityPerCentury: -0.0000155,
      inclinationDeg: 0.77298127, inclinationPerCentury: -0.00180155,
      meanLongitudeDeg: 314.20276625, meanLongitudePerCentury: 428.49512595,
      longitudeOfPerihelionDeg: 172.43404441, longitudeOfPerihelionPerCentury: 0.09266985,
      longitudeOfNodeDeg: 73.96250215, longitudeOfNodePerCentury: 0.05739699,
      extra: { b: 0.00058331, c: -0.97731848, s: 0.17689245, f: 7.67025 },
    },
  ],
  [
    "neptune",
    {
      semiMajorAxisAu: 30.06952752, semiMajorAxisPerCentury: 0.00006447,
      eccentricity: 0.00895439, eccentricityPerCentury: 0.00000818,
      inclinationDeg: 1.7700552, inclinationPerCentury: 0.000224,
      meanLongitudeDeg: 304.22289287, meanLongitudePerCentury: 218.46515314,
      longitudeOfPerihelionDeg: 46.68158724, longitudeOfPerihelionPerCentury: 0.01009938,
      longitudeOfNodeDeg: 131.78635853, longitudeOfNodePerCentury: -0.00606302,
      extra: { b: -0.00041348, c: 0.68346318, s: -0.10162547, f: 7.67025 },
    },
  ],
];

/**
 * Pluto, from the table `approx_pos.html`'s own reference carries and the
 * reformatted page has since dropped: Standish & Williams' 1992 JPL IOM
 * 343R-92-001 elements, which are a 1800-2050 set and carry Table 2b's
 * `b, c, s, f` for Pluto. It is the only JPL approximation of Pluto's orbit
 * rather than a fit to its own mean elements, and the page names it as the
 * source of the formulae above.
 */
const PLUTO_ELEMENTS: OrbitalElements = {
  semiMajorAxisAu: 39.48211675, semiMajorAxisPerCentury: -0.00031596,
  eccentricity: 0.2488273, eccentricityPerCentury: 0.0000517,
  inclinationDeg: 17.14001206, inclinationPerCentury: 0.00004818,
  meanLongitudeDeg: 238.92903833, meanLongitudePerCentury: 145.20780515,
  longitudeOfPerihelionDeg: 224.06891629, longitudeOfPerihelionPerCentury: -0.04062942,
  longitudeOfNodeDeg: 110.30393684, longitudeOfNodePerCentury: -0.01183482,
  extra: { b: -0.01262724, c: 0, s: 0, f: 0 },
};

/** Table 1's window, as the page states it: 1800 AD to 2050 AD. */
const TABLE_1_FIRST_YEAR = 1800;
const TABLE_1_LAST_YEAR = 2050;

/**
 * The element set for a body and the argument its table is written in: Julian
 * centuries for EVERY row, Table 2a's included: its header states its rates in
 * degrees per CENTURY ("deg, deg/Cy") even though its window spans three
 * millennia, and Table 2b is written in the same argument as the table it
 * augments. The Horizons vectors in `planets.test.ts` are what settles it: with
 * the extra terms evaluated per century Jupiter's longitude at 2020 comes out
 * 275.84 degrees against Horizons' 275.86; evaluated per millennium it is 100.6,
 * which is 175 degrees wrong and cannot be a rounding. The window is decided on
 * the instant's decimal year, as the page bounds it.
 */
function elementsFor(id: BodyId, jde: number): readonly [OrbitalElements, number] {
  const centuries = (jde - J2000_JULIAN_EPHEMERIS_DAY) / 36_525;
  const year = 2000 + centuries * 100;
  const useTable1 = year >= TABLE_1_FIRST_YEAR && year < TABLE_1_LAST_YEAR;
  const found = id === "pluto" ? PLUTO_ELEMENTS : (useTable1 ? ELEMENTS_1800_2050 : ELEMENTS_3000_BC_3000_AD)
    .find(([candidate]) => candidate === id)?.[1];
  if (found === undefined) throw new Error(`no orbital elements for ${id}`);
  return [found, centuries];
}

/**
 * The heliocentric ecliptic J2000 position of one of the eight planets or Pluto,
 * in au, at a Julian Ephemeris Day: the source's own Keplerian route — elements,
 * mean anomaly, Kepler's equation, then the orbit-to-ecliptic rotation, whose
 * three rows are the article's matrix written out.
 */
function planetPosition(id: BodyId, jde: number): Vector3 {
  const [elements, argument] = elementsFor(id, jde);
  const semiMajorAxis = elements.semiMajorAxisAu + elements.semiMajorAxisPerCentury * argument;
  const eccentricity = elements.eccentricity + elements.eccentricityPerCentury * argument;
  const inclination = elements.inclinationDeg + elements.inclinationPerCentury * argument;
  const meanLongitude = elements.meanLongitudeDeg + elements.meanLongitudePerCentury * argument;
  const longitudeOfPerihelion =
    elements.longitudeOfPerihelionDeg + elements.longitudeOfPerihelionPerCentury * argument;
  const longitudeOfNode = elements.longitudeOfNodeDeg + elements.longitudeOfNodePerCentury * argument;

  const extra = elements.extra;
  const extraAnomaly =
    extra === undefined
      ? 0
      : extra.b * argument * argument +
        extra.c * cosDeg(extra.f * argument) +
        extra.s * sinDeg(extra.f * argument);
  const meanAnomaly = normalize360(meanLongitude - longitudeOfPerihelion + extraAnomaly + 180) - 180;
  const eccentricAnomaly = solveKepler(meanAnomaly, eccentricity);

  // The planet in its orbital plane, x' toward perihelion (the article's r').
  const xOrbital = semiMajorAxis * (cosDeg(eccentricAnomaly) - eccentricity);
  const yOrbital = semiMajorAxis * Math.sqrt(1 - eccentricity * eccentricity) * sinDeg(eccentricAnomaly);
  const argumentOfPerihelion = longitudeOfPerihelion - longitudeOfNode;

  const cosNode = cosDeg(longitudeOfNode);
  const sinNode = sinDeg(longitudeOfNode);
  const cosArgument = cosDeg(argumentOfPerihelion);
  const sinArgument = sinDeg(argumentOfPerihelion);
  const cosInclination = cosDeg(inclination);
  const sinInclination = sinDeg(inclination);
  return [
    (cosArgument * cosNode - sinArgument * sinNode * cosInclination) * xOrbital +
      (-sinArgument * cosNode - cosArgument * sinNode * cosInclination) * yOrbital,
    (cosArgument * sinNode + sinArgument * cosNode * cosInclination) * xOrbital +
      (-sinArgument * sinNode + cosArgument * cosNode * cosInclination) * yOrbital,
    sinArgument * sinInclination * xOrbital + cosArgument * sinInclination * yOrbital,
  ];
}

/**
 * Kepler's equation `M = E - e* sin E`, solved by Newton's method exactly as the
 * article's "Solution of Kepler's Equation" prescribes: start from
 * `E = M + e* sin M`, then `dE = dM / (1 - e cos E)` until `|dE| <= 1e-6`
 * degrees. The pass limit is a guard rather than a rule — Pluto's e of 0.249
 * converges in four passes from that start.
 */
function solveKepler(meanAnomalyDeg: number, eccentricity: number): number {
  const eccentricityDegrees = (180 / Math.PI) * eccentricity;
  let eccentricAnomaly = meanAnomalyDeg + eccentricityDegrees * sinDeg(meanAnomalyDeg);
  for (let pass = 0; pass < 20; pass += 1) {
    const delta =
      (meanAnomalyDeg - (eccentricAnomaly - eccentricityDegrees * sinDeg(eccentricAnomaly))) /
      (1 - eccentricity * cosDeg(eccentricAnomaly));
    eccentricAnomaly += delta;
    if (Math.abs(delta) <= 1e-6) break;
  }
  return eccentricAnomaly;
}

/**
 * Earth's share of the Earth-Moon system: `GM_Earth / (GM_Earth + GM_Moon)`.
 * The Moon's mass is the Earth's divided by IAU's 81.3005682, so the Earth's
 * share is `1 / (1 + 1/81.3005682)` and the Moon's is what is left.
 */
const EARTH_SHARE_OF_BARYCENTRE = 1 / (1 + 1 / 81.3005682);
const MOON_SHARE_OF_BARYCENTRE = 1 - EARTH_SHARE_OF_BARYCENTRE;

/**
 * The geocentric Moon's ecliptic J2000 vector, in au.
 *
 * `moonEcliptic` returns the geocentric position referred to the MEAN EQUINOX OF
 * DATE, because Meeus ch. 47's arguments carry no precession; the frame every
 * comparison here is made in is J2000, which is that frame rotated by the
 * accumulated general precession since J2000. The correction is `p = 1.396971 T
 * + 0.00031 T^2` degrees subtracted from the longitude, with `T` in centuries
 * (Meeus ch. 21's general precession in longitude).
 */
function moonGeocentricVector(jde: number): Vector3 {
  const moon = moonEcliptic(jde);
  const centuries = (jde - J2000_JULIAN_EPHEMERIS_DAY) / 36_525;
  const precession = 1.396971 * centuries + 0.00031 * centuries * centuries;
  return fromEcliptic(moon.longitude - precession, moon.latitude, moon.distanceKm / AU_KM);
}

/** One body's physical row: mean radius, pole and `W` in the form the report prints them. */
interface PhysicalRow {
  readonly radiusKm: number;
  readonly poleRightAscensionDeg: number;
  readonly poleDeclinationDeg: number;
  readonly primeMeridianDeg: number;
  readonly primeMeridianRateDeg: number;
  /** The report's optional `T` terms on the pole, omitted where it prints none. */
  readonly poleRightAscensionPerCentury?: number;
  readonly poleDeclinationPerCentury?: number;
}

/**
 * The IAU 2015 report's mean radii and rotation models (Archinal et al. 2018,
 * its Table 3 and eqs. 1-2): `alpha_0, delta_0, W_0, Wdot`, with the pole's
 * precession terms where the report gives them. `W` is the angle from the node
 * of the body's equator on the ICRF equator to the body's prime meridian.
 */
const PHYSICAL: readonly (readonly [BodyId, PhysicalRow])[] = [
  ["sun", { radiusKm: 695700, poleRightAscensionDeg: 286.13, poleDeclinationDeg: 63.87, primeMeridianDeg: 84.176, primeMeridianRateDeg: 14.1844 }],
  ["mercury", { radiusKm: 2439.4, poleRightAscensionDeg: 281.0103, poleDeclinationDeg: 61.4155, poleRightAscensionPerCentury: -0.0328, poleDeclinationPerCentury: -0.0049, primeMeridianDeg: 329.5988, primeMeridianRateDeg: 6.1385108 }],
  ["venus", { radiusKm: 6051.8, poleRightAscensionDeg: 272.76, poleDeclinationDeg: 67.16, primeMeridianDeg: 160.2, primeMeridianRateDeg: -1.4813688 }],
  ["earth", { radiusKm: 6371.0084, poleRightAscensionDeg: 0, poleDeclinationDeg: 90, primeMeridianDeg: 190.147, primeMeridianRateDeg: 360.9856235 }],
  ["moon", { radiusKm: 1737.4, poleRightAscensionDeg: 269.9949, poleDeclinationDeg: 66.5392, poleRightAscensionPerCentury: 0.0031, poleDeclinationPerCentury: 0.013, primeMeridianDeg: 38.3213, primeMeridianRateDeg: 13.17635815 }],
  ["mars", { radiusKm: 3389.5, poleRightAscensionDeg: 317.68143, poleDeclinationDeg: 52.8865, poleRightAscensionPerCentury: -0.1061, poleDeclinationPerCentury: -0.0609, primeMeridianDeg: 176.63, primeMeridianRateDeg: 350.89198226 }],
  ["jupiter", { radiusKm: 69911, poleRightAscensionDeg: 268.056595, poleDeclinationDeg: 64.495303, primeMeridianDeg: 284.95, primeMeridianRateDeg: 870.536 }],
  ["saturn", { radiusKm: 58232, poleRightAscensionDeg: 40.589, poleDeclinationDeg: 83.537, primeMeridianDeg: 38.9, primeMeridianRateDeg: 810.7939024 }],
  ["uranus", { radiusKm: 25362, poleRightAscensionDeg: 257.311, poleDeclinationDeg: -15.175, primeMeridianDeg: 203.81, primeMeridianRateDeg: -501.1600928 }],
  ["neptune", { radiusKm: 24622, poleRightAscensionDeg: 299.36, poleDeclinationDeg: 43.46, poleRightAscensionPerCentury: 0.7, poleDeclinationPerCentury: -0.51, primeMeridianDeg: 253.18, primeMeridianRateDeg: 536.3128492 }],
  ["pluto", { radiusKm: 1188.3, poleRightAscensionDeg: 132.993, poleDeclinationDeg: -6.163, primeMeridianDeg: 302.695, primeMeridianRateDeg: 56.3625225 }],
];

/** The IAU rotation model's argument `d`: days from J2000.0. */
function daysFromJ2000(jde: number): number {
  return jde - J2000_JULIAN_EPHEMERIS_DAY;
}

/** The pole and prime meridian of one body at one instant. */
function frameOf(row: PhysicalRow, d: number): { readonly frame: BodyFrame; readonly rotationDeg: number } {
  const centuries = d / 36_525;
  const rightAscension = row.poleRightAscensionDeg + (row.poleRightAscensionPerCentury ?? 0) * centuries;
  const declination = row.poleDeclinationDeg + (row.poleDeclinationPerCentury ?? 0) * centuries;
  const rotationDeg = row.primeMeridianDeg + row.primeMeridianRateDeg * d;
  return { frame: bodyFrame(rightAscension, declination, rotationDeg), rotationDeg };
}

function physicalOf(id: BodyId): PhysicalRow {
  const row = PHYSICAL.find(([candidate]) => candidate === id)?.[1];
  if (row === undefined) throw new Error(`no physical model for ${id}`);
  return row;
}

/** The rotation, pole and radius of one body, in the contract's own fields. */
function bodyStateOf(id: BodyId, jde: number, position: Vector3, earthPosition: Vector3): BodyState {
  const row = physicalOf(id);
  const { frame, rotationDeg } = frameOf(row, daysFromJ2000(jde));
  return {
    id,
    position,
    radiusKm: row.radiusKm,
    rotationDeg,
    northPole: frame.northPole,
    distanceFromEarthAu: id === "earth" ? 0 : magnitude(subtract(position, earthPosition)),
  };
}

/** A heliocentric body's position at a JDE, with the Earth-Moon split applied. */
function heliocentricAt(id: BodyId, jde: number): Vector3 {
  if (id === "sun") return [0, 0, 0];
  const barycentre = planetPosition("earth", jde);
  const geocentric = moonGeocentricVector(jde);
  if (id === "earth") {
    return [
      barycentre[0] - MOON_SHARE_OF_BARYCENTRE * geocentric[0],
      barycentre[1] - MOON_SHARE_OF_BARYCENTRE * geocentric[1],
      barycentre[2] - MOON_SHARE_OF_BARYCENTRE * geocentric[2],
    ];
  }
  if (id === "moon") {
    return [
      barycentre[0] + EARTH_SHARE_OF_BARYCENTRE * geocentric[0],
      barycentre[1] + EARTH_SHARE_OF_BARYCENTRE * geocentric[1],
      barycentre[2] + EARTH_SHARE_OF_BARYCENTRE * geocentric[2],
    ];
  }
  return planetPosition(id, jde);
}

/**
 * Every body's heliocentric position and orientation at one instant.
 *
 * The Sun is the origin by definition; the Earth is Table 1's barycentre
 * corrected by the geocentric Moon, and the Moon is that correction carried
 * outward, so the pair closes on the barycentre by construction. Distances from
 * the Earth are read off the same vectors, so `moon` and `earth` are never in
 * two different places.
 */
export function solarSystemAt(instantMs: number): SolarSystemSnapshot {
  const jde = julianEphemerisDay(instantMs);
  const earthPosition = heliocentricAt("earth", jde);
  const ids: readonly BodyId[] = [
    "sun",
    "mercury",
    "venus",
    "earth",
    "moon",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
    "pluto",
  ];
  const bodies = ids.map((id) => bodyStateOf(id, jde, heliocentricAt(id, jde), earthPosition));
  return { instantMs, bodies };
}

/**
 * One body's orbit, sampled at `samples` points evenly spaced over one orbital
 * period from `instantMs`, with the first point repeated at the end.
 *
 * The period is {@link orbitalPeriodDays}: the mean longitude's rate in the
 * table the instant falls in, which is the article's own mean motion. The Sun
 * has no path to draw and is answered with the single point it is.
 */
export function orbitPath(id: BodyId, instantMs: number, samples: number): OrbitPath {
  if (!Number.isInteger(samples) || samples < 2) throw new Error("samples must be an integer >= 2");
  if (id === "sun") return { id, points: [[0, 0, 0]] };
  const start = julianEphemerisDay(instantMs);
  const periodDays = orbitalPeriodDays(id, start);
  const points: Vector3[] = [];
  for (let index = 0; index <= samples; index += 1) {
    points.push(heliocentricAt(id, start + (periodDays * index) / samples));
  }
  return { id, points };
}

/**
 * The days one body takes for one turn, from the mean longitude's rate in the
 * table the instant falls in: `P = 360 * 36525 / (dL/dt)` days, the article's
 * rates being per Julian century. That is the period the fitted mean longitude
 * itself repeats over, which is the strongest closure the approximation has:
 * the mean anomaly's rate would be a slightly different number, and the two are
 * compared in `planets.test.ts`.
 *
 * Not part of `contract.ts`; exported because `orbitPath`'s closure test has to
 * name the period its path closes over.
 */
export function orbitalPeriodDays(id: BodyId, jde: number): number {
  if (id === "sun") return 0;
  return (360 * 36_525) / elementsFor(id, jde)[0].meanLongitudePerCentury;
}
