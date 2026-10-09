/**
 * USNO "Complete Sun and Moon Data for One Day" responses, kept VERBATIM, as the
 * stage-1 sky engine's external oracle (the brief: an external oracle).
 *
 * Fetched 2026-10-09 from
 * https://aa.usno.navy.mil/api/rstt/oneday?date=DATE&coords=LAT,LON&tz=0
 * — one request per place and date below, each entry carrying its own URL.
 * `tz=0` is load-bearing: it makes USNO answer in Universal Time, the only
 * frame this engine works in. `properties.data.sundata` and `moondata` list
 * one entry per phenomenon with a `time` of "hh:mm" in UT, or `null` when the
 * body is continuously above or below the horizon — the `phen` string then
 * says which, in words ("Object continuously above the Horizon", "Object
 * continuously below the Twilight Limit"). `curphase` and `fracillum` are
 * USNO's phase name and illuminated percentage at 12:00 UT; `closestphase` is
 * the nearest principal phase.
 *
 * **`curphase`'s names are USNO's own and are not the engine's octants.** On ten
 * of these thirty rows the two disagree, and every one of the ten is a Moon
 * within a day and a half of a principal phase: USNO's named windows around a
 * phase are narrower than the 45-degree octants this package's `MOON_PHASE_NAMES`
 * describes: it prints "Waxing Crescent" at an elongation of 18.97 degrees,
 * where the octant is still `new`, and at 85.07 degrees, ten hours before first
 * quarter. The engine's names are therefore checked against USNO's fifty
 * published phase INSTANTS, where the two conventions cannot disagree, rather
 * than here.
 *
 * **How these were fetched, and why not with `curl.exe`.** The brief asks for
 * `curl.exe`; in this sandbox `curl.exe` fails before it sends anything
 * (`schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`), plain
 * `http` to the host times out, and `https` from Node is reset during the
 * handshake (`ECONNRESET`) while github.com, registry.npmjs.org and
 * example.com all answer normally — so the host is unreachable from here
 * rather than merely TLS-broken. Every response below was therefore fetched
 * through the public reader at https://r.jina.ai/ with `x-respond-with: text`,
 * which returns the body after a short plain-text preamble; the preamble is
 * stripped and what is stored is the body as returned, with newlines normalised
 * to LF and the final newline dropped, and nothing else touched (USNO's own
 * pretty-printing, including the trailing space it prints after a comma, is
 * intact — that is why these literals are flush left). Re-fetching any URL in
 * the list by hand is the independent check.
 */
export interface UsnoOneDayResponse {
  /** Which of {@link USNO_PLACES} this is for. */
  readonly place: string;
  /** The UTC day requested, "YYYY-MM-DD". */
  readonly date: string;
  /** The exact request that produced `body`. */
  readonly url: string;
  /** The response body, verbatim JSON. */
  readonly body: string;
}

/** The five places the brief names, with the coordinates sent to USNO. */
export const USNO_PLACES: readonly {
  readonly name: string;
  readonly label: string;
  readonly latitude: number;
  readonly longitude: number;
}[] = [
  { name: "belgrade", label: "Belgrade", latitude: 44.82, longitude: 20.46 },
  { name: "tromso", label: "Tromso", latitude: 69.65, longitude: 18.96 },
  { name: "quito", label: "Quito", latitude: -0.18, longitude: -78.47 },
  { name: "sydney", label: "Sydney", latitude: -33.87, longitude: 151.21 },
  { name: "reykjavik", label: "Reykjavik", latitude: 64.15, longitude: -21.94 },
];

/** The six days of 2026 the brief names: both equinoxes, both solstices, and two ordinary days. */
export const USNO_DATES_2026: readonly string[] = [
  "2026-01-01",
  "2026-03-20",
  "2026-06-21",
  "2026-09-23",
  "2026-10-15",
  "2026-12-21",
];

/** Five places x six days = thirty responses. */
export const USNO_ONE_DAY_2026: readonly UsnoOneDayResponse[] = [
  {
    place: "belgrade",
    date: "2026-01-01",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-01-01&coords=44.82,20.46&tz=0",
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
    "data": {
      "closestphase": {
        "day": 3, 
        "month": 1, 
        "phase": "Full Moon", 
        "time": "10:03", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 1, 
      "day_of_week": "Thursday", 
      "fracillum": "94%", 
      "isdst": false, 
      "label": null, 
      "month": 1, 
      "moondata": [
        {
          "phen": "Set", 
          "time": "04:22"
        }, 
        {
          "phen": "Rise", 
          "time": "12:40"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "21:07"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "05:42"
        }, 
        {
          "phen": "Rise", 
          "time": "06:16"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "10:42"
        }, 
        {
          "phen": "Set", 
          "time": "15:08"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "15:41"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "belgrade",
    date: "2026-03-20",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-03-20&coords=44.82,20.46&tz=0",
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
    "data": {
      "closestphase": {
        "day": 19, 
        "month": 3, 
        "phase": "New Moon", 
        "time": "01:23", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 20, 
      "day_of_week": "Friday", 
      "fracillum": "3%", 
      "isdst": false, 
      "label": null, 
      "month": 3, 
      "moondata": [
        {
          "phen": "Rise", 
          "time": "05:03"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "11:50"
        }, 
        {
          "phen": "Set", 
          "time": "18:54"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "04:12"
        }, 
        {
          "phen": "Rise", 
          "time": "04:42"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "10:46"
        }, 
        {
          "phen": "Set", 
          "time": "16:50"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "17:20"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "belgrade",
    date: "2026-06-21",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-06-21&coords=44.82,20.46&tz=0",
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
    "data": {
      "closestphase": {
        "day": 21, 
        "month": 6, 
        "phase": "First Quarter", 
        "time": "21:55", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 21, 
      "day_of_week": "Sunday", 
      "fracillum": "46%", 
      "isdst": false, 
      "label": null, 
      "month": 6, 
      "moondata": [
        {
          "phen": "Rise", 
          "time": "10:14"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "16:26"
        }, 
        {
          "phen": "Set", 
          "time": "22:26"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "02:15"
        }, 
        {
          "phen": "Rise", 
          "time": "02:52"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "10:40"
        }, 
        {
          "phen": "Set", 
          "time": "18:28"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "19:05"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "belgrade",
    date: "2026-09-23",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-09-23&coords=44.82,20.46&tz=0",
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
    "data": {
      "closestphase": {
        "day": 26, 
        "month": 9, 
        "phase": "Full Moon", 
        "time": "16:49", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 23, 
      "day_of_week": "Wednesday", 
      "fracillum": "89%", 
      "isdst": false, 
      "label": null, 
      "month": 9, 
      "moondata": [
        {
          "phen": "Set", 
          "time": "00:33"
        }, 
        {
          "phen": "Rise", 
          "time": "15:11"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "20:22"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "03:57"
        }, 
        {
          "phen": "Rise", 
          "time": "04:26"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "10:31"
        }, 
        {
          "phen": "Set", 
          "time": "16:34"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "17:03"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "belgrade",
    date: "2026-10-15",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-10-15&coords=44.82,20.46&tz=0",
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
    "data": {
      "closestphase": {
        "day": 18, 
        "month": 10, 
        "phase": "First Quarter", 
        "time": "16:12", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 15, 
      "day_of_week": "Thursday", 
      "fracillum": "22%", 
      "isdst": false, 
      "label": null, 
      "month": 10, 
      "moondata": [
        {
          "phen": "Rise", 
          "time": "10:08"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "14:11"
        }, 
        {
          "phen": "Set", 
          "time": "18:12"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "04:24"
        }, 
        {
          "phen": "Rise", 
          "time": "04:53"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "10:24"
        }, 
        {
          "phen": "Set", 
          "time": "15:54"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "16:23"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "belgrade",
    date: "2026-12-21",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-12-21&coords=44.82,20.46&tz=0",
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
    "data": {
      "closestphase": {
        "day": 24, 
        "month": 12, 
        "phase": "Full Moon", 
        "time": "01:28", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 21, 
      "day_of_week": "Monday", 
      "fracillum": "90%", 
      "isdst": false, 
      "label": null, 
      "month": 12, 
      "moondata": [
        {
          "phen": "Set", 
          "time": "03:10"
        }, 
        {
          "phen": "Rise", 
          "time": "12:16"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "20:17"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "05:39"
        }, 
        {
          "phen": "Rise", 
          "time": "06:12"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "10:36"
        }, 
        {
          "phen": "Set", 
          "time": "15:00"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "15:34"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "tromso",
    date: "2026-01-01",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-01-01&coords=69.65,18.96&tz=0",
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
    "data": {
      "closestphase": {
        "day": 3, 
        "month": 1, 
        "phase": "Full Moon", 
        "time": "10:03", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 1, 
      "day_of_week": "Thursday", 
      "fracillum": "94%", 
      "isdst": false, 
      "label": null, 
      "month": 1, 
      "moondata": [
        {
          "phen": "Object continuously above the Horizon", 
          "time": null
        }, 
        {
          "phen": "Lower Transit", 
          "time": "08:40"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "21:13"
        }
      ], 
      "sundata": [
        {
          "phen": "Object continuously below the Horizon", 
          "time": null
        }, 
        {
          "phen": "Begin Civil Twilight", 
          "time": "08:27"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "13:09"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "tromso",
    date: "2026-03-20",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-03-20&coords=69.65,18.96&tz=0",
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
    "data": {
      "closestphase": {
        "day": 19, 
        "month": 3, 
        "phase": "New Moon", 
        "time": "01:23", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 20, 
      "day_of_week": "Friday", 
      "fracillum": "3%", 
      "isdst": false, 
      "label": null, 
      "month": 3, 
      "moondata": [
        {
          "phen": "Rise", 
          "time": "04:09"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "11:56"
        }, 
        {
          "phen": "Set", 
          "time": "20:43"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "03:44"
        }, 
        {
          "phen": "Rise", 
          "time": "04:44"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "10:52"
        }, 
        {
          "phen": "Set", 
          "time": "17:01"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "18:02"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "tromso",
    date: "2026-06-21",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-06-21&coords=69.65,18.96&tz=0",
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
    "data": {
      "closestphase": {
        "day": 21, 
        "month": 6, 
        "phase": "First Quarter", 
        "time": "21:55", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 21, 
      "day_of_week": "Sunday", 
      "fracillum": "46%", 
      "isdst": false, 
      "label": null, 
      "month": 6, 
      "moondata": [
        {
          "phen": "Rise", 
          "time": "10:18"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "16:33"
        }, 
        {
          "phen": "Set", 
          "time": "22:14"
        }
      ], 
      "sundata": [
        {
          "phen": "Object continuously above the Horizon", 
          "time": null
        }, 
        {
          "phen": "Object continuously above the Twilight Limit", 
          "time": null
        }, 
        {
          "phen": "Upper Transit", 
          "time": "10:46"
        }, 
        {
          "phen": "Lower Transit", 
          "time": "22:46"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "tromso",
    date: "2026-09-23",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-09-23&coords=69.65,18.96&tz=0",
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
    "data": {
      "closestphase": {
        "day": 26, 
        "month": 9, 
        "phase": "Full Moon", 
        "time": "16:49", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 23, 
      "day_of_week": "Wednesday", 
      "fracillum": "89%", 
      "isdst": false, 
      "label": null, 
      "month": 9, 
      "moondata": [
        {
          "phen": "Rise", 
          "time": "17:09"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "20:28"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "03:27"
        }, 
        {
          "phen": "Rise", 
          "time": "04:28"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "10:37"
        }, 
        {
          "phen": "Set", 
          "time": "16:43"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "17:43"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "tromso",
    date: "2026-10-15",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-10-15&coords=69.65,18.96&tz=0",
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
    "data": {
      "closestphase": {
        "day": 18, 
        "month": 10, 
        "phase": "First Quarter", 
        "time": "16:12", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 15, 
      "day_of_week": "Thursday", 
      "fracillum": "22%", 
      "isdst": false, 
      "label": null, 
      "month": 10, 
      "moondata": [
        {
          "phen": "Object continuously below the Horizon", 
          "time": null
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "04:53"
        }, 
        {
          "phen": "Rise", 
          "time": "05:55"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "10:30"
        }, 
        {
          "phen": "Set", 
          "time": "15:03"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "16:05"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "tromso",
    date: "2026-12-21",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-12-21&coords=69.65,18.96&tz=0",
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
    "data": {
      "closestphase": {
        "day": 24, 
        "month": 12, 
        "phase": "Full Moon", 
        "time": "01:28", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 21, 
      "day_of_week": "Monday", 
      "fracillum": "90%", 
      "isdst": false, 
      "label": null, 
      "month": 12, 
      "moondata": [
        {
          "phen": "Object continuously above the Horizon", 
          "time": null
        }, 
        {
          "phen": "Lower Transit", 
          "time": "07:53"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "20:24"
        }
      ], 
      "sundata": [
        {
          "phen": "Object continuously below the Horizon", 
          "time": null
        }, 
        {
          "phen": "Begin Civil Twilight", 
          "time": "08:31"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "12:53"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "quito",
    date: "2026-01-01",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-01-01&coords=-0.18,-78.47&tz=0",
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
    "data": {
      "closestphase": {
        "day": 3, 
        "month": 1, 
        "phase": "Full Moon", 
        "time": "10:03", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 1, 
      "day_of_week": "Thursday", 
      "fracillum": "94%", 
      "isdst": false, 
      "label": null, 
      "month": 1, 
      "moondata": [
        {
          "phen": "Upper Transit", 
          "time": "02:54"
        }, 
        {
          "phen": "Set", 
          "time": "09:10"
        }, 
        {
          "phen": "Rise", 
          "time": "21:45"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "10:51"
        }, 
        {
          "phen": "Rise", 
          "time": "11:13"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "17:18"
        }, 
        {
          "phen": "Set", 
          "time": "23:22"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "23:44"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "quito",
    date: "2026-03-20",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-03-20&coords=-0.18,-78.47&tz=0",
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
    "data": {
      "closestphase": {
        "day": 19, 
        "month": 3, 
        "phase": "New Moon", 
        "time": "01:23", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 20, 
      "day_of_week": "Friday", 
      "fracillum": "3%", 
      "isdst": false, 
      "label": null, 
      "month": 3, 
      "moondata": [
        {
          "phen": "Set", 
          "time": "00:02"
        }, 
        {
          "phen": "Rise", 
          "time": "12:28"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "18:40"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "10:57"
        }, 
        {
          "phen": "Rise", 
          "time": "11:18"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "17:21"
        }, 
        {
          "phen": "Set", 
          "time": "23:25"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "23:45"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "quito",
    date: "2026-06-21",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-06-21&coords=-0.18,-78.47&tz=0",
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
    "data": {
      "closestphase": {
        "day": 21, 
        "month": 6, 
        "phase": "First Quarter", 
        "time": "21:55", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 21, 
      "day_of_week": "Sunday", 
      "fracillum": "46%", 
      "isdst": false, 
      "label": null, 
      "month": 6, 
      "moondata": [
        {
          "phen": "Set", 
          "time": "04:41"
        }, 
        {
          "phen": "Rise", 
          "time": "17:04"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "23:14"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "10:50"
        }, 
        {
          "phen": "Rise", 
          "time": "11:12"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "17:16"
        }, 
        {
          "phen": "Set", 
          "time": "23:19"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "23:42"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "quito",
    date: "2026-09-23",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-09-23&coords=-0.18,-78.47&tz=0",
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
    "data": {
      "closestphase": {
        "day": 26, 
        "month": 9, 
        "phase": "Full Moon", 
        "time": "16:49", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 23, 
      "day_of_week": "Wednesday", 
      "fracillum": "89%", 
      "isdst": false, 
      "label": null, 
      "month": 9, 
      "moondata": [
        {
          "phen": "Upper Transit", 
          "time": "02:25"
        }, 
        {
          "phen": "Set", 
          "time": "08:36"
        }, 
        {
          "phen": "Rise", 
          "time": "20:59"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "10:42"
        }, 
        {
          "phen": "Rise", 
          "time": "11:03"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "17:06"
        }, 
        {
          "phen": "Set", 
          "time": "23:09"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "23:30"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "quito",
    date: "2026-10-15",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-10-15&coords=-0.18,-78.47&tz=0",
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
    "data": {
      "closestphase": {
        "day": 18, 
        "month": 10, 
        "phase": "First Quarter", 
        "time": "16:12", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 15, 
      "day_of_week": "Thursday", 
      "fracillum": "22%", 
      "isdst": false, 
      "label": null, 
      "month": 10, 
      "moondata": [
        {
          "phen": "Set", 
          "time": "02:22"
        }, 
        {
          "phen": "Rise", 
          "time": "14:48"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "21:01"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "10:35"
        }, 
        {
          "phen": "Rise", 
          "time": "10:56"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "17:00"
        }, 
        {
          "phen": "Set", 
          "time": "23:03"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "23:24"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "quito",
    date: "2026-12-21",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-12-21&coords=-0.18,-78.47&tz=0",
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
    "data": {
      "closestphase": {
        "day": 24, 
        "month": 12, 
        "phase": "Full Moon", 
        "time": "01:28", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 21, 
      "day_of_week": "Monday", 
      "fracillum": "90%", 
      "isdst": false, 
      "label": null, 
      "month": 12, 
      "moondata": [
        {
          "phen": "Upper Transit", 
          "time": "02:09"
        }, 
        {
          "phen": "Set", 
          "time": "08:23"
        }, 
        {
          "phen": "Rise", 
          "time": "20:56"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "10:45"
        }, 
        {
          "phen": "Rise", 
          "time": "11:08"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "17:12"
        }, 
        {
          "phen": "Set", 
          "time": "23:16"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "23:39"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "sydney",
    date: "2026-01-01",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-01-01&coords=-33.87,151.21&tz=0",
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
    "data": {
      "closestphase": {
        "day": 3, 
        "month": 1, 
        "phase": "Full Moon", 
        "time": "10:03", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 1, 
      "day_of_week": "Thursday", 
      "fracillum": "94%", 
      "isdst": false, 
      "label": null, 
      "month": 1, 
      "moondata": [
        {
          "phen": "Rise", 
          "time": "07:08"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "11:59"
        }, 
        {
          "phen": "Set", 
          "time": "16:48"
        }
      ], 
      "sundata": [
        {
          "phen": "Upper Transit", 
          "time": "01:59"
        }, 
        {
          "phen": "Set", 
          "time": "09:09"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "09:38"
        }, 
        {
          "phen": "Begin Civil Twilight", 
          "time": "18:19"
        }, 
        {
          "phen": "Rise", 
          "time": "18:48"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "sydney",
    date: "2026-03-20",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-03-20&coords=-33.87,151.21&tz=0",
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
    "data": {
      "closestphase": {
        "day": 19, 
        "month": 3, 
        "phase": "New Moon", 
        "time": "01:23", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 20, 
      "day_of_week": "Friday", 
      "fracillum": "3%", 
      "isdst": false, 
      "label": null, 
      "month": 3, 
      "moondata": [
        {
          "phen": "Upper Transit", 
          "time": "02:49"
        }, 
        {
          "phen": "Set", 
          "time": "08:34"
        }, 
        {
          "phen": "Rise", 
          "time": "22:05"
        }
      ], 
      "sundata": [
        {
          "phen": "Upper Transit", 
          "time": "02:03"
        }, 
        {
          "phen": "Set", 
          "time": "08:07"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "08:32"
        }, 
        {
          "phen": "Begin Civil Twilight", 
          "time": "19:34"
        }, 
        {
          "phen": "Rise", 
          "time": "19:59"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "sydney",
    date: "2026-06-21",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-06-21&coords=-33.87,151.21&tz=0",
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
    "data": {
      "closestphase": {
        "day": 21, 
        "month": 6, 
        "phase": "First Quarter", 
        "time": "21:55", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 21, 
      "day_of_week": "Sunday", 
      "fracillum": "46%", 
      "isdst": false, 
      "label": null, 
      "month": 6, 
      "moondata": [
        {
          "phen": "Rise", 
          "time": "01:25"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "07:28"
        }, 
        {
          "phen": "Set", 
          "time": "13:39"
        }
      ], 
      "sundata": [
        {
          "phen": "Upper Transit", 
          "time": "01:57"
        }, 
        {
          "phen": "Set", 
          "time": "06:54"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "07:22"
        }, 
        {
          "phen": "Begin Civil Twilight", 
          "time": "20:32"
        }, 
        {
          "phen": "Rise", 
          "time": "21:00"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "sydney",
    date: "2026-09-23",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-09-23&coords=-33.87,151.21&tz=0",
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
    "data": {
      "closestphase": {
        "day": 26, 
        "month": 9, 
        "phase": "Full Moon", 
        "time": "16:49", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 23, 
      "day_of_week": "Wednesday", 
      "fracillum": "89%", 
      "isdst": false, 
      "label": null, 
      "month": 9, 
      "moondata": [
        {
          "phen": "Rise", 
          "time": "04:25"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "11:23"
        }, 
        {
          "phen": "Set", 
          "time": "18:12"
        }
      ], 
      "sundata": [
        {
          "phen": "Upper Transit", 
          "time": "01:48"
        }, 
        {
          "phen": "Set", 
          "time": "07:52"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "08:17"
        }, 
        {
          "phen": "Begin Civil Twilight", 
          "time": "19:18"
        }, 
        {
          "phen": "Rise", 
          "time": "19:43"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "sydney",
    date: "2026-10-15",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-10-15&coords=-33.87,151.21&tz=0",
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
    "data": {
      "closestphase": {
        "day": 18, 
        "month": 10, 
        "phase": "First Quarter", 
        "time": "16:12", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 15, 
      "day_of_week": "Thursday", 
      "fracillum": "22%", 
      "isdst": false, 
      "label": null, 
      "month": 10, 
      "moondata": [
        {
          "phen": "Upper Transit", 
          "time": "05:09"
        }, 
        {
          "phen": "Set", 
          "time": "12:47"
        }, 
        {
          "phen": "Rise", 
          "time": "22:22"
        }
      ], 
      "sundata": [
        {
          "phen": "Upper Transit", 
          "time": "01:41"
        }, 
        {
          "phen": "Set", 
          "time": "08:08"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "08:34"
        }, 
        {
          "phen": "Begin Civil Twilight", 
          "time": "18:48"
        }, 
        {
          "phen": "Rise", 
          "time": "19:13"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "sydney",
    date: "2026-12-21",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-12-21&coords=-33.87,151.21&tz=0",
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
    "data": {
      "closestphase": {
        "day": 24, 
        "month": 12, 
        "phase": "Full Moon", 
        "time": "01:28", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 21, 
      "day_of_week": "Monday", 
      "fracillum": "90%", 
      "isdst": false, 
      "label": null, 
      "month": 12, 
      "moondata": [
        {
          "phen": "Rise", 
          "time": "06:06"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "11:12"
        }, 
        {
          "phen": "Set", 
          "time": "16:13"
        }
      ], 
      "sundata": [
        {
          "phen": "Upper Transit", 
          "time": "01:53"
        }, 
        {
          "phen": "Set", 
          "time": "09:05"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "09:35"
        }, 
        {
          "phen": "Begin Civil Twilight", 
          "time": "18:12"
        }, 
        {
          "phen": "Rise", 
          "time": "18:41"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "reykjavik",
    date: "2026-01-01",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-01-01&coords=64.15,-21.94&tz=0",
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
    "data": {
      "closestphase": {
        "day": 3, 
        "month": 1, 
        "phase": "Full Moon", 
        "time": "10:03", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 1, 
      "day_of_week": "Thursday", 
      "fracillum": "94%", 
      "isdst": false, 
      "label": null, 
      "month": 1, 
      "moondata": [
        {
          "phen": "Object continuously above the Horizon", 
          "time": null
        }, 
        {
          "phen": "Lower Transit", 
          "time": "11:31"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "10:03"
        }, 
        {
          "phen": "Rise", 
          "time": "11:19"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "13:31"
        }, 
        {
          "phen": "Set", 
          "time": "15:44"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "17:00"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "reykjavik",
    date: "2026-03-20",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-03-20&coords=64.15,-21.94&tz=0",
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
    "data": {
      "closestphase": {
        "day": 19, 
        "month": 3, 
        "phase": "New Moon", 
        "time": "01:23", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 20, 
      "day_of_week": "Friday", 
      "fracillum": "3%", 
      "isdst": false, 
      "label": null, 
      "month": 3, 
      "moondata": [
        {
          "phen": "Rise", 
          "time": "07:14"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "14:46"
        }, 
        {
          "phen": "Set", 
          "time": "22:58"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "06:41"
        }, 
        {
          "phen": "Rise", 
          "time": "07:29"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "13:35"
        }, 
        {
          "phen": "Set", 
          "time": "19:43"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "20:31"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "reykjavik",
    date: "2026-06-21",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-06-21&coords=64.15,-21.94&tz=0",
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
    "data": {
      "closestphase": {
        "day": 21, 
        "month": 6, 
        "phase": "First Quarter", 
        "time": "21:55", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 21, 
      "day_of_week": "Sunday", 
      "fracillum": "46%", 
      "isdst": false, 
      "label": null, 
      "month": 6, 
      "moondata": [
        {
          "phen": "Set", 
          "time": "01:11"
        }, 
        {
          "phen": "Rise", 
          "time": "13:14"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "19:21"
        }
      ], 
      "sundata": [
        {
          "phen": "Object continuously above the Twilight Limit", 
          "time": null
        }, 
        {
          "phen": "Set", 
          "time": "00:04"
        }, 
        {
          "phen": "Rise", 
          "time": "02:55"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "13:30"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "reykjavik",
    date: "2026-09-23",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-09-23&coords=64.15,-21.94&tz=0",
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
    "data": {
      "closestphase": {
        "day": 26, 
        "month": 9, 
        "phase": "Full Moon", 
        "time": "16:49", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 23, 
      "day_of_week": "Wednesday", 
      "fracillum": "89%", 
      "isdst": false, 
      "label": null, 
      "month": 9, 
      "moondata": [
        {
          "phen": "Set", 
          "time": "02:01"
        }, 
        {
          "phen": "Rise", 
          "time": "19:07"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "23:17"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "06:26"
        }, 
        {
          "phen": "Rise", 
          "time": "07:14"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "13:20"
        }, 
        {
          "phen": "Set", 
          "time": "19:25"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "20:13"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "reykjavik",
    date: "2026-10-15",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-10-15&coords=64.15,-21.94&tz=0",
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
    "data": {
      "closestphase": {
        "day": 18, 
        "month": 10, 
        "phase": "First Quarter", 
        "time": "16:12", 
        "year": 2026
      }, 
      "curphase": "Waxing Crescent", 
      "day": 15, 
      "day_of_week": "Thursday", 
      "fracillum": "22%", 
      "isdst": false, 
      "label": null, 
      "month": 10, 
      "moondata": [
        {
          "phen": "Object continuously below the Horizon", 
          "time": null
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "07:29"
        }, 
        {
          "phen": "Rise", 
          "time": "08:18"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "13:14"
        }, 
        {
          "phen": "Set", 
          "time": "18:08"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "18:56"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
  {
    place: "reykjavik",
    date: "2026-12-21",
    url: "https://aa.usno.navy.mil/api/rstt/oneday?date=2026-12-21&coords=64.15,-21.94&tz=0",
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
    "data": {
      "closestphase": {
        "day": 24, 
        "month": 12, 
        "phase": "Full Moon", 
        "time": "01:28", 
        "year": 2026
      }, 
      "curphase": "Waxing Gibbous", 
      "day": 21, 
      "day_of_week": "Monday", 
      "fracillum": "90%", 
      "isdst": false, 
      "label": null, 
      "month": 12, 
      "moondata": [
        {
          "phen": "Set", 
          "time": "08:42"
        }, 
        {
          "phen": "Rise", 
          "time": "12:32"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "23:14"
        }
      ], 
      "sundata": [
        {
          "phen": "Begin Civil Twilight", 
          "time": "10:03"
        }, 
        {
          "phen": "Rise", 
          "time": "11:22"
        }, 
        {
          "phen": "Upper Transit", 
          "time": "13:26"
        }, 
        {
          "phen": "Set", 
          "time": "15:29"
        }, 
        {
          "phen": "End Civil Twilight", 
          "time": "16:49"
        }
      ], 
      "tz": 0.0, 
      "year": 2026
    }
  }, 
  "type": "Feature"
}`,
  },
];
