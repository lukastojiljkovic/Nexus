/**
 * The oracle for the star map's geometry: five named stars, for Belgrade, at
 * two instants.
 *
 * **What produced these numbers, exactly.** Skyfield 1.55 (MIT, from PyPI)
 * with the JPL DE421 ephemeris (`de421.bsp`, downloaded from
 * `https://ssd.jpl.nasa.gov/ftp/eph/planets/bsp/de421.bsp`, retrieved
 * 2026-10-10) on Python 3.13: an implementation of the IAU 2000A/2006 models
 * that shares no code and no formula with this package. The whole script:
 *
 *     ts = load.timescale(); eph = load("de421.bsp")
 *     observer = eph["earth"] + wgs84.latlon(44.82, 20.46)
 *     star = Star(ra_hours=ra / 15, dec_degrees=dec, epoch=2000.0)
 *     apparent = observer.at(t).observe(star).apparent()
 *     alt, az, _ = apparent.altaz()        # geometric: no refraction asked for
 *     ra, dec, _ = apparent.radec(epoch="date")
 *
 * **Each star is given the position the shipped catalogue carries**, not
 * Skyfield's own catalogue position for that star. That is deliberate: it makes
 * the comparison a measurement of the coordinate chain - precession, nutation,
 * aberration, sidereal time, and the rotation to the horizon - rather than a
 * measurement of two star catalogues against each other, where a difference
 * between V/50 and Hipparcos would hide inside the arcminute the test judges.
 * `stars.test.ts` checks the catalogue against its own source.
 *
 * **USNO would have been the first choice, and could not be reached.** Its
 * "Celestial Navigation Data" service - the one the Sun and Moon fixtures in
 * this directory use, and which publishes `hc` and `zn` for the navigational
 * stars as well - answered with a connection reset and then a timeout on every
 * attempt from this sandbox on 2026-10-10, on both the celnav and the one-day
 * endpoints. So the oracle is an independent implementation rather than the
 * USNO's own answer; the report says so rather than quietly swapping one for
 * the other.
 *
 * The place is the same Belgrade point the USNO fixtures use, 44.82 N and
 * 20.46 E, so the two oracles in this directory describe the same observer.
 */
import type { SkyPlace } from "../horizontal.js";

/** One star's expected place at one instant. */
export interface StarOracleRow {
  /** HR number, the key the shipped catalogue is sorted and looked up by. */
  readonly hr: number;
  /** The IAU name, for a reader of this table rather than for the test. */
  readonly name: string;
  /** The catalogue position the oracle was given: the same numbers the shipped table carries. */
  readonly raDeg: number;
  readonly decDeg: number;
  /** Apparent place of date, degrees. */
  readonly apparentRaDeg: number;
  readonly apparentDecDeg: number;
  /** Topocentric altitude, degrees, GEOMETRIC - Skyfield applies refraction only when asked to. */
  readonly altitude: number;
  /** Topocentric azimuth, degrees clockwise from true north. */
  readonly azimuth: number;
}

/** One instant, and what the oracle says about the five stars then. */
export interface StarOracleInstant {
  /** The instant as UTC, to the second. */
  readonly instant: string;
  readonly rows: readonly StarOracleRow[];
}

/** Belgrade, spelled as the USNO fixtures in this directory already spell it. */
export const STAR_ORACLE_PLACE: SkyPlace = { latitude: 44.82, longitude: 20.46 };

export const STAR_ORACLE: readonly StarOracleInstant[] = [
  {
    instant: "2026-10-09T19:00:00Z",
    rows: [
      {
        hr: 1457,
        name: "Aldebaran",
        raDeg: 68.98,
        decDeg: 16.50917,
        apparentRaDeg: 69.3699691,
        apparentDecDeg: 16.56552548,
        altitude: 1.10505057,
        azimuth: 67.48939149,
      },
      {
        hr: 1708,
        name: "Capella",
        raDeg: 79.1725,
        decDeg: 45.99806,
        apparentRaDeg: 79.6735508,
        apparentDecDeg: 46.02599289,
        altitude: 17.03129934,
        azimuth: 40.82687577,
      },
      {
        hr: 2491,
        name: "Sirius",
        raDeg: 101.28708,
        decDeg: -16.71611,
        apparentRaDeg: 101.5885357,
        apparentDecDeg: -16.73999961,
        altitude: -44.87604616,
        azimuth: 65.39076386,
      },
      {
        hr: 5340,
        name: "Arcturus",
        raDeg: 213.91542,
        decDeg: 19.1825,
        apparentRaDeg: 214.226667,
        apparentDecDeg: 19.05953127,
        altitude: 0.27478752,
        azimuth: 297.10401733,
      },
      {
        hr: 7001,
        name: "Vega",
        raDeg: 279.23458,
        decDeg: 38.78361,
        apparentRaDeg: 279.45941119,
        apparentDecDeg: 38.81067188,
        altitude: 56.78415195,
        azimuth: 275.46941392,
      },
    ],
  },
  {
    instant: "2026-10-10T02:00:00Z",
    rows: [
      {
        hr: 1457,
        name: "Aldebaran",
        raDeg: 68.98,
        decDeg: 16.50917,
        apparentRaDeg: 69.37007708,
        apparentDecDeg: 16.56554178,
        altitude: 61.74497814,
        azimuth: 179.5706208,
      },
      {
        hr: 1708,
        name: "Capella",
        raDeg: 79.1725,
        decDeg: 45.99806,
        apparentRaDeg: 79.67371749,
        apparentDecDeg: 46.02602938,
        altitude: 82.52723035,
        azimuth: 76.9947984,
      },
      {
        hr: 2491,
        name: "Sirius",
        raDeg: 101.28708,
        decDeg: -16.71611,
        apparentRaDeg: 101.58867008,
        apparentDecDeg: -16.74000842,
        altitude: 21.73416229,
        azimuth: 146.43702664,
      },
      {
        hr: 5340,
        name: "Arcturus",
        raDeg: 213.91542,
        decDeg: 19.1825,
        apparentRaDeg: 214.22662396,
        apparentDecDeg: 19.05948964,
        altitude: -18.63106355,
        azimuth: 34.82945091,
      },
      {
        hr: 7001,
        name: "Vega",
        raDeg: 279.23458,
        decDeg: 38.78361,
        apparentRaDeg: 279.45924715,
        apparentDecDeg: 38.81066257,
        altitude: -2.03023797,
        azimuth: 336.83376585,
      },
    ],
  },
];
