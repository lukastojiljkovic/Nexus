/**
 * „Nautika i jedrenje" — the English copy of this toolkit's surfaces.
 *
 * The mirror of `pro.nautika.ts`, key for key; the compiler refuses a leaf that
 * exists in one table and not the other. The same rules hold here: every tool
 * carries its own `notForNavigation` line, and no figure in this pack is
 * decided for the reader.
 */
export const PRO_NAUTIKA_EN = {
  "speed-run": {
    notForNavigation:
      "An informational calculation, not for navigation — use official charts and publications " +
      "for passage planning.",

    speed: "Speed",
    speedHint: "In knots. Leave it empty if that is the answer you want.",
    distance: "Distance",
    distanceHint: "In nautical miles. Leave it empty if that is the answer you want.",
    time: "Time",
    timeHint: "In hours. Leave it empty if that is the answer you want.",

    results: "Result",
    outSpeed: "Speed",
    outSpeedKmh: "Speed in km/h",
    outSpeedMs: "Speed in m/s",
    outDistance: "Distance",
    outDistanceKm: "Distance in km",
    outTime: "Time",
    outTimeMinutes: "Time in minutes",

    formula: "v = s/t for uniform motion — enter exactly two of the three quantities.",

    errorPair: "Enter exactly two of the three quantities — speed, distance or time.",
    errorSpeed: "Speed is a positive number of knots, up to 200.",
    errorDistance: "Distance is a non-negative number of nautical miles.",
    errorTime: "Time is a positive number of hours.",

    unitKn: "kn",
    unitNm: "NM",
    unitKm: "km",
    unitH: "h",
    unitMinutes: "min",
    unitMs: "m/s",
  },

  "great-circle": {
    notForNavigation:
      "An informational calculation, not for navigation — use official charts and publications " +
      "for passage planning.",

    fromLat: "Latitude of the start",
    fromLon: "Longitude of the start",
    toLat: "Latitude of the destination",
    toLon: "Longitude of the destination",
    latHint: "Decimal degrees, from −90 to 90. North is positive.",
    lonHint: "Decimal degrees, from −180 to 180. East is positive.",

    results: "Result",
    outDistanceNm: "Great circle",
    outDistanceKm: "Great circle in km",
    outCentralAngle: "Central angle",
    outInitialBearing: "Initial bearing",
    outFinalBearing: "Bearing on arrival",
    outRhumbDistance: "Rhumb line",
    outRhumbBearing: "Rhumb-line bearing",
    outRhumbExcess: "The rhumb line is longer by",
    bearingNone: "none (the same coordinates)",

    formula:
      "haversine: a = sin²(Δφ/2) + cosφ₁·cosφ₂·sin²(Δλ/2), d = 2R·asin(√a); bearing = " +
      "atan2(sinΔλ·cosφ₂, cosφ₁·sinφ₂ − sinφ₁·cosφ₂·cosΔλ); rhumb line by Mercator sailing, " +
      "Δψ = ln tan(45° + φ/2). Sphere R₁ = 6371.0088 km.",

    errorFrom: "Check the latitude and longitude of the start.",
    errorTo: "Check the latitude and longitude of the destination.",

    unitNm: "NM",
    unitKm: "km",
    unitDeg: "°",
    unitPercent: "%",
  },

  "anchor-rode": {
    notForNavigation:
      "An informational calculation, not for navigation — use official charts and publications " +
      "for passage planning.",

    depth: "Depth",
    depthHint: "Under the bow, in metres.",
    bowHeight: "Height of the bow",
    bowHeightHint: "From the waterline to the roller, in metres. Empty means zero.",
    scope: "Rode per metre of depth",
    scopeHint: "The ratio you choose yourself — 5 for 5:1, for example. There is no default.",

    results: "Result",
    outDepthUsed: "Depth the calculation uses",
    outRode: "Rode needed",
    outRodeFt: "Rode needed in feet",

    formula: "rode = ratio × (depth + height of the bow)",

    errorDepth: "Depth is a positive number of metres, up to 200.",
    errorBowHeight: "The bow height is a non-negative number of metres, up to 20.",
    errorScope: "The ratio is a positive number, up to 30.",

    unitM: "m",
    unitFt: "ft",
  },

  "fuel-range": {
    notForNavigation:
      "An informational calculation, not for navigation — use official charts and publications " +
      "for passage planning.",

    tank: "Tank",
    tankHint: "Capacity in litres.",
    usable: "Usable",
    usableHint: "The part of the tank the pick-up actually reaches, in percent.",
    burn: "Burn rate",
    burnHint: "Litres per hour at the speed you entered.",
    speed: "Speed",
    speedHint: "In knots.",
    reserve: "Reserve",
    reserveHint: "The part of the usable fuel you hold back, in percent.",

    results: "Result",
    outUsable: "Usable fuel",
    outReserve: "Reserve",
    outBurnable: "Available for the passage",
    outHours: "Endurance",
    outHoursWithoutReserve: "Endurance without the reserve",
    outRange: "Range",
    outRangeKm: "Range in km",

    formula: "t = V/P and s = v·t, at a constant burn and a constant speed.",

    errorTank: "Tank capacity is a positive number of litres.",
    errorUsable: "The usable part is between 0 and 100 %.",
    errorBurn: "The burn rate is a positive number of litres per hour.",
    errorSpeed: "Speed is a positive number of knots, up to 200.",
    errorReserve: "The reserve is between 0 and 100 %.",

    unitL: "l",
    unitH: "h",
    unitNm: "NM",
    unitKm: "km",
    unitKn: "kn",
    unitPercent: "%",
  },

  "hull-speed": {
    notForNavigation:
      "An informational calculation, not for navigation — use official charts and publications " +
      "for passage planning.",

    length: "Waterline length",
    lengthHint: "In metres — not the length overall.",
    froude: "Froude number",
    froudeHint: "0.40 by default. Anything from 0.1 to 1.5 is read.",

    results: "Result",
    outHullSpeed: "Hull speed",
    outHullSpeedKmh: "Hull speed in km/h",
    outHullSpeedMs: "Hull speed in m/s",
    outLengthFt: "Waterline in feet",
    outFroude: "Froude number",
    outSpeedLength: "Speed–length ratio",

    formula:
      "v = Fr·√(g·L); at Fr = 0.40 this is the traditional 1.34·√L(ft) in knots, and it is a " +
      "wave-making limit rather than a permitted speed.",

    errorLength: "Waterline length is a positive number of metres, up to 200.",
    errorFroude: "The Froude number is between 0.1 and 1.5.",

    unitKn: "kn",
    unitKmh: "km/h",
    unitMs: "m/s",
    unitFt: "ft",
    unitM: "m",
  },

  "rule-of-twelfths": {
    notForNavigation:
      "An informational calculation, not for navigation — use official charts and publications " +
      "for passage planning.",

    range: "Tidal range",
    rangeHint: "From high to low water, in metres.",
    hours: "Time since the turn",
    hoursHint: "Hours since the tide turned — a fraction is fine.",
    duration: "Duration of the tide",
    durationHint: "Hours from high to low water. It is often six, but enter your own.",

    results: "Result",
    outFraction: "Movement",
    outMoved: "Movement of the level",
    outHeightAboveLow: "Level above low water",
    tableHour: "Hour",
    tableTwelfths: "Twelfths",
    tableFraction: "Share of the range",
    tableMoved: "Movement",

    formula:
      "1, 2, 3, 3, 2, 1 twelfths of the range, interpolated linearly inside an hour and spread " +
      "over the duration you enter.",

    errorRange: "The range is a positive number of metres, up to 30.",
    errorDuration: "The duration is a positive number of hours, up to 12.",
    errorHours: "The time since the turn is between 0 and the duration of the tide.",

    unitM: "m",
    unitH: "h",
    unitPercent: "%",
  },

  vmg: {
    notForNavigation:
      "An informational calculation, not for navigation — use official charts and publications " +
      "for passage planning.",

    boatSpeed: "Boat speed",
    boatSpeedHint: "Through the water, in knots.",
    windAngle: "True wind angle",
    windAngleHint: "0° is head to wind, 180° dead downwind. From 0 to 180°.",

    results: "Result",
    outVmg: "VMG",
    outVmgKmh: "VMG in km/h",
    outFraction: "Share of boat speed",
    outDirection: "Direction",
    upwind: "Upwind",
    downwind: "Downwind",

    formula:
      "VMG = V·cos θ, where θ is the angle between the course and the direction the wind comes " +
      "from. Which angle is actually fastest is the boat's polars, not this calculation.",

    errorSpeed: "Speed is a positive number of knots, up to 60.",
    errorAngle: "The angle is between 0 and 180°.",

    unitKn: "kn",
    unitKmh: "km/h",
    unitPercent: "%",
    unitDeg: "°",
  },

  "course-to-steer": {
    notForNavigation:
      "An informational calculation, not for navigation — use official charts and publications " +
      "for passage planning.",

    track: "Course over the ground",
    trackHint: "The track you want, in degrees from 0 to 360.",
    boatSpeed: "Speed through the water",
    boatSpeedHint: "In knots.",
    set: "Set of the current",
    setHint: "The direction the current flows towards, in degrees from 0 to 360.",
    drift: "Drift of the current",
    driftHint: "In knots.",

    results: "Result",
    outHeading: "Heading to steer",
    outDriftAngle: "Drift angle",
    outGroundSpeed: "Speed over the ground",
    outGroundSpeedKmh: "Speed over the ground in km/h",

    formula:
      "sin θ = −(c/b)·sin(S − T), then V = b·cos θ + c·cos(S − T); S is the direction the " +
      "current flows towards.",

    errorTrack: "The course is between 0 and 360°.",
    errorSet: "The set of the current is between 0 and 360°.",
    errorSpeed: "Speed through the water is a positive number of knots, up to 60.",
    errorDrift: "The drift is a non-negative number of knots, up to 20.",
    errorCurrent:
      "The current is stronger across the track than the boat's whole speed — no heading can " +
      "hold this course.",

    unitDeg: "°",
    unitKn: "kn",
    unitKmh: "km/h",
  },
} as const;
