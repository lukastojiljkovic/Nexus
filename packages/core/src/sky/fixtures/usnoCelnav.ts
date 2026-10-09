/**
 * USNO "Celestial Navigation Data for Assumed Position and Time" — the oracle for
 * the engine's horizontal positions, and the only USNO service that publishes an
 * ALTITUDE (`hc`), an AZIMUTH (`zn`) and the refraction it applied (`refr`) as
 * numbers rather than as a rise time.
 *
 * Fetched 2026-10-09 from
 * https://aa.usno.navy.mil/api/celnav?date=DATE&time=TIME&coords=LAT,LON
 * (same sandbox routing as {@link USNO_ONE_DAY_2026}). The service answers for
 * every navigational body it carries — and, which cost one round of fetches to
 * learn, ONLY for those above the horizon: a request at Reykjavík midnight in
 * October came back with twenty-nine stars and no Sun or Moon at all.
 * `bodies` records which of the two this instant actually published, and the
 * engine is expected to answer for exactly those.
 *
 * Each body was TRUNCATED mechanically to its `Sun` and `Moon` entries
 * (`type_trim` records that), because the other thirty are 10 kB of the same
 * file. Inside one object: `dec` and `gha` are the body's apparent geocentric
 * declination and Greenwich hour angle in degrees, `hc` its GEOCENTRIC
 * altitude, `zn` its azimuth measured clockwise from true north, and
 * `altitude_corrections.pa` the parallax in altitude — so `hc - pa` is the
 * topocentric altitude the engine is expected to produce, and `refr` the
 * refraction USNO subtracted from it.
 *
 * The ten instants are chosen for shape rather than for spread: both transits
 * (the body due south or due north, `zn` near 0 or 180) and near-horizon
 * positions for the refraction, a polar-day Sun at Tromsø, the equator, and the
 * southern hemisphere.
 */
export interface UsnoCelnavResponse {
  /** Which of {@link USNO_PLACES} this is for. */
  readonly place: string;
  readonly date: string;
  /** "hh:mm" in UT. */
  readonly time: string;
  /** The exact request that produced `body`. */
  readonly url: string;
  /** The Sun and/or Moon entries USNO published for this instant, in its own order. */
  readonly bodies: readonly string[];
  /** The response body: USNO's JSON with `properties.data` reduced to Sun and Moon. */
  readonly body: string;
}

/** Ten instants across 2026, at the five places. */
export const USNO_CELNAV_2026: readonly UsnoCelnavResponse[] = [
  {
    place: "belgrade",
    date: "2026-06-21",
    time: "10:40",
    url:
      "https://aa.usno.navy.mil/api/celnav?date=2026-06-21&time=10:40&coords=44.82,20.46",
    bodies: ["Sun", "Moon"],
    body:
`{
  "apiversion": "4.0.1",
  "geometry": {
    "coordinates": [
      20.46,
      44.82
    ],
    "type": "Point"
  },
  "properties": {
    "data": [
      {
        "almanac_data": {
          "dec": 23.437899,
          "gha": 339.548594,
          "hc": 68.617898,
          "zn": 180.021627
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.000867,
          "refr": -0.006574,
          "sd": 0.262329,
          "sum": 0.256623
        },
        "object": "Sun"
      },
      {
        "almanac_data": {
          "dec": 0.38744,
          "gha": 255.47192,
          "hc": 4.477703,
          "zn": 93.913903
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.944028,
          "refr": -0.215602,
          "sd": 0.258362,
          "sum": 0.986788
        },
        "object": "Moon"
      }
    ],
    "day": 21,
    "month": 6,
    "moon_illum": 45,
    "moon_phase": "Waxing Crescent",
    "time": "10:40",
    "tz": 0,
    "year": 2026
  },
  "type": "Feature",
  "type_trim": "properties.data reduced to the Sun and Moon"
}`,
  },
  {
    place: "belgrade",
    date: "2026-06-21",
    time: "03:05",
    url:
      "https://aa.usno.navy.mil/api/celnav?date=2026-06-21&time=03:05&coords=44.82,20.46",
    bodies: ["Sun"],
    body:
`{
  "apiversion": "4.0.1",
  "geometry": {
    "coordinates": [
      20.46,
      44.82
    ],
    "type": "Point"
  },
  "properties": {
    "data": [
      {
        "almanac_data": {
          "dec": 23.43777,
          "gha": 225.815854,
          "hc": 1.061748,
          "zn": 57.150937
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.0024,
          "refr": -0.382992,
          "sd": 0.262324,
          "sum": -0.118269
        },
        "object": "Sun"
      }
    ],
    "day": 21,
    "month": 6,
    "moon_illum": "",
    "moon_phase": "",
    "time": "03:05",
    "tz": 0,
    "year": 2026
  },
  "type": "Feature",
  "type_trim": "properties.data reduced to the Sun and Moon"
}`,
  },
  {
    place: "belgrade",
    date: "2026-01-01",
    time: "21:07",
    url:
      "https://aa.usno.navy.mil/api/celnav?date=2026-01-01&time=21:07&coords=44.82,20.46",
    bodies: ["Moon"],
    body:
`{
  "apiversion": "4.0.1",
  "geometry": {
    "coordinates": [
      20.46,
      44.82
    ],
    "type": "Point"
  },
  "properties": {
    "data": [
      {
        "almanac_data": {
          "dec": 28.042078,
          "gha": 339.644016,
          "hc": 73.221874,
          "zn": 180.318034
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.293979,
          "refr": -0.005173,
          "sd": 0.281005,
          "sum": 0.569811
        },
        "object": "Moon"
      }
    ],
    "day": 1,
    "month": 1,
    "moon_illum": 96,
    "moon_phase": "Waxing Gibbous",
    "time": "21:07",
    "tz": 0,
    "year": 2026
  },
  "type": "Feature",
  "type_trim": "properties.data reduced to the Sun and Moon"
}`,
  },
  {
    place: "tromso",
    date: "2026-06-21",
    time: "10:46",
    url:
      "https://aa.usno.navy.mil/api/celnav?date=2026-06-21&time=10:46&coords=69.65,18.96",
    bodies: ["Sun", "Moon"],
    body:
`{
  "apiversion": "4.0.1",
  "geometry": {
    "coordinates": [
      18.96,
      69.65
    ],
    "type": "Point"
  },
  "properties": {
    "data": [
      {
        "almanac_data": {
          "dec": 23.437896,
          "gha": 341.048366,
          "hc": 43.787896,
          "zn": 180.010633
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.001727,
          "refr": -0.017432,
          "sd": 0.262326,
          "sum": 0.24662
        },
        "object": "Sun"
      },
      {
        "almanac_data": {
          "dec": 0.361993,
          "gha": 256.928211,
          "hc": 2.384091,
          "zn": 95.397642
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.944259,
          "refr": -0.345434,
          "sd": 0.25819,
          "sum": 0.857015
        },
        "object": "Moon"
      }
    ],
    "day": 21,
    "month": 6,
    "moon_illum": 45,
    "moon_phase": "Waxing Crescent",
    "time": "10:46",
    "tz": 0,
    "year": 2026
  },
  "type": "Feature",
  "type_trim": "properties.data reduced to the Sun and Moon"
}`,
  },
  {
    place: "tromso",
    date: "2026-06-21",
    time: "00:00",
    url:
      "https://aa.usno.navy.mil/api/celnav?date=2026-06-21&time=00:00&coords=69.65,18.96",
    bodies: ["Sun"],
    body:
`{
  "apiversion": "4.0.1",
  "geometry": {
    "coordinates": [
      18.96,
      69.65
    ],
    "type": "Point"
  },
  "properties": {
    "data": [
      {
        "almanac_data": {
          "dec": 23.437521,
          "gha": 179.572878,
          "hc": 4.03739,
          "zn": 16.998699
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.002391,
          "refr": -0.196585,
          "sd": 0.262326,
          "sum": 0.068133
        },
        "object": "Sun"
      }
    ],
    "day": 21,
    "month": 6,
    "moon_illum": "",
    "moon_phase": "",
    "time": "00:00",
    "tz": 0,
    "year": 2026
  },
  "type": "Feature",
  "type_trim": "properties.data reduced to the Sun and Moon"
}`,
  },
  {
    place: "quito",
    date: "2026-06-21",
    time: "17:16",
    url:
      "https://aa.usno.navy.mil/api/celnav?date=2026-06-21&time=17:16&coords=-0.18,-78.47",
    bodies: ["Sun", "Moon"],
    body:
`{
  "apiversion": "4.0.1",
  "geometry": {
    "coordinates": [
      -78.47,
      -0.18
    ],
    "type": "Point"
  },
  "properties": {
    "data": [
      {
        "almanac_data": {
          "dec": 23.437451,
          "gha": 78.53359,
          "hc": 66.382468,
          "zn": 359.85437
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.000963,
          "refr": -0.007335,
          "sd": 0.262324,
          "sum": 0.255952
        },
        "object": "Sun"
      },
      {
        "almanac_data": {
          "dec": -1.284934,
          "gha": 351.599704,
          "hc": 3.132943,
          "zn": 91.27701
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.942847,
          "refr": -0.286769,
          "sd": 0.257204,
          "sum": 0.913282
        },
        "object": "Moon"
      }
    ],
    "day": 21,
    "month": 6,
    "moon_illum": 48,
    "moon_phase": "First Quarter",
    "time": "17:16",
    "tz": 0,
    "year": 2026
  },
  "type": "Feature",
  "type_trim": "properties.data reduced to the Sun and Moon"
}`,
  },
  {
    place: "quito",
    date: "2026-10-15",
    time: "21:01",
    url:
      "https://aa.usno.navy.mil/api/celnav?date=2026-10-15&time=21:01&coords=-0.18,-78.47",
    bodies: ["Sun", "Moon"],
    body:
`{
  "apiversion": "4.0.1",
  "geometry": {
    "coordinates": [
      -78.47,
      -0.18
    ],
    "type": "Point"
  },
  "properties": {
    "data": [
      {
        "almanac_data": {
          "dec": -8.764723,
          "gha": 138.824693,
          "hc": 29.29652,
          "zn": 260.039863
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.002137,
          "refr": -0.029709,
          "sd": 0.267346,
          "sum": 0.239773
        },
        "object": "Sun"
      },
      {
        "almanac_data": {
          "dec": -27.857959,
          "gha": 78.557263,
          "hc": 62.321915,
          "zn": 180.166092
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.426205,
          "refr": -0.008943,
          "sd": 0.249928,
          "sum": 0.66719
        },
        "object": "Moon"
      }
    ],
    "day": 15,
    "month": 10,
    "moon_illum": 25,
    "moon_phase": "Waxing Crescent",
    "time": "21:01",
    "tz": 0,
    "year": 2026
  },
  "type": "Feature",
  "type_trim": "properties.data reduced to the Sun and Moon"
}`,
  },
  {
    place: "sydney",
    date: "2026-01-01",
    time: "01:59",
    url:
      "https://aa.usno.navy.mil/api/celnav?date=2026-01-01&time=01:59&coords=-33.87,151.21",
    bodies: ["Sun"],
    body:
`{
  "apiversion": "4.0.1",
  "geometry": {
    "coordinates": [
      151.21,
      -33.87
    ],
    "type": "Point"
  },
  "properties": {
    "data": [
      {
        "almanac_data": {
          "dec": -23.010537,
          "gha": 208.907652,
          "hc": 79.140047,
          "zn": 359.425225
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.00046,
          "refr": -0.00325,
          "sd": 0.2711,
          "sum": 0.26831
        },
        "object": "Sun"
      }
    ],
    "day": 1,
    "month": 1,
    "moon_illum": "",
    "moon_phase": "",
    "time": "01:59",
    "tz": 0,
    "year": 2026
  },
  "type": "Feature",
  "type_trim": "properties.data reduced to the Sun and Moon"
}`,
  },
  {
    place: "reykjavik",
    date: "2026-03-20",
    time: "13:35",
    url:
      "https://aa.usno.navy.mil/api/celnav?date=2026-03-20&time=13:35&coords=64.15,-21.94",
    bodies: ["Sun", "Moon"],
    body:
`{
  "apiversion": "4.0.1",
  "geometry": {
    "coordinates": [
      -21.94,
      64.15
    ],
    "type": "Point"
  },
  "properties": {
    "data": [
      {
        "almanac_data": {
          "dec": -0.019356,
          "gha": 21.895642,
          "hc": 25.830636,
          "zn": 179.950718
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.002199,
          "refr": -0.034393,
          "sd": 0.267669,
          "sum": 0.235475
        },
        "object": "Sun"
      },
      {
        "almanac_data": {
          "dec": 10.925755,
          "gha": 4.882143,
          "hc": 35.440106,
          "zn": 159.29727
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.811657,
          "refr": -0.024171,
          "sd": 0.272584,
          "sum": 1.06007
        },
        "object": "Moon"
      }
    ],
    "day": 20,
    "month": 3,
    "moon_illum": 3,
    "moon_phase": "Waxing Crescent",
    "time": "13:35",
    "tz": 0,
    "year": 2026
  },
  "type": "Feature",
  "type_trim": "properties.data reduced to the Sun and Moon"
}`,
  },
  {
    place: "reykjavik",
    date: "2026-06-21",
    time: "13:30",
    url:
      "https://aa.usno.navy.mil/api/celnav?date=2026-06-21&time=13:30&coords=64.15,-21.94",
    bodies: ["Sun", "Moon"],
    body:
`{
  "apiversion": "4.0.1",
  "geometry": {
    "coordinates": [
      -21.94,
      64.15
    ],
    "type": "Point"
  },
  "properties": {
    "data": [
      {
        "almanac_data": {
          "dec": 23.437771,
          "gha": 22.042151,
          "hc": 49.287715,
          "zn": 180.143689
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.001559,
          "refr": -0.014389,
          "sd": 0.262325,
          "sum": 0.249495
        },
        "object": "Sun"
      },
      {
        "almanac_data": {
          "dec": -0.332343,
          "gha": 296.735872,
          "hc": 1.789808,
          "zn": 94.462471
        },
        "altitude_corrections": {
          "isCorrected": true,
          "pa": 0.943062,
          "refr": -0.405863,
          "sd": 0.257704,
          "sum": 0.794903
        },
        "object": "Moon"
      }
    ],
    "day": 21,
    "month": 6,
    "moon_illum": 46,
    "moon_phase": "Waxing Crescent",
    "time": "13:30",
    "tz": 0,
    "year": 2026
  },
  "type": "Feature",
  "type_trim": "properties.data reduced to the Sun and Moon"
}`,
  },
];
