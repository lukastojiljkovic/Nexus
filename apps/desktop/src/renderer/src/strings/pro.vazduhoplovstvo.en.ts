/**
 * „Vazduhoplovstvo" — the English copy of this toolkit's surfaces.
 *
 * The mirror of `pro.vazduhoplovstvo.ts`, key for key. The same rules hold:
 * every tool carries its own `notForFlightPlanning` line, and every tool that
 * leans on the standard atmosphere names it (ICAO Doc 7488) rather than
 * implying it.
 */
export const PRO_VAZDUHOPLOVSTVO_EN = {
  "isa-atmosphere": {
    notForFlightPlanning:
      "An informational calculation, not for flight planning — use the flight manual, charts, " +
      "forecast and NOTAMs for a flight.",

    altitude: "Geopotential altitude",
    altitudeHint: "In feet, up to 65 616 ft (20 km).",

    results: "Result",
    outAltitude: "Altitude",
    outLayer: "Layer",
    layerTroposphere: "Troposphere",
    layerIsothermal: "Isothermal layer",
    outTemperature: "Temperature",
    outTemperatureK: "Temperature in kelvin",
    outPressure: "Pressure",
    outPressurePa: "Pressure in pascals",
    outDensity: "Density",
    outSpeedOfSound: "Speed of sound",
    outSpeedOfSoundKt: "Speed of sound in knots",
    outDensityRatio: "Density against mean sea level",
    outPressureRatio: "Pressure against mean sea level",

    formula:
      "troposphere: T = T₀ − 0.0065·h and p = p₀·(T/T₀)^5.255876; isothermal layer: T = 216.65 K " +
      "and p = p₁₁·exp(−g·Δh/(R·T₁₁)); ρ = p/(R·T); a = √(γ·R·T). ICAO Doc 7488.",

    errorAltitude: "The altitude is between −1000 and 65 616 ft.",

    unitFt: "ft",
    unitM: "m",
    unitC: "°C",
    unitK: "K",
    unitHpa: "hPa",
    unitPa: "Pa",
    unitKgM3: "kg/m³",
    unitMs: "m/s",
    unitKt: "kt",
  },

  "pressure-altitude": {
    notForFlightPlanning:
      "An informational calculation, not for flight planning — use the flight manual, charts, " +
      "forecast and NOTAMs for a flight.",

    pressure: "Pressure at the place",
    pressureHint: "The actual air pressure, in hectopascals.",
    temperature: "Outside air temperature",
    temperatureHint: "In degrees Celsius.",

    results: "Result",
    outPressureAltitude: "Pressure altitude",
    outIsaTemperature: "ISA temperature at that altitude",
    outDeviation: "Deviation from the standard",
    outDensity: "Air density",
    outDensityAltitude: "Density altitude",

    formula:
      "h = (T₀/L)·(1 − (p/p₀)^(1/5.255876)); ρ = p/(R·T); the density altitude is the one where " +
      "the standard atmosphere has exactly this density.",

    errorPressure: "The pressure is between 100 and 1100 hPa.",
    errorTemperature: "The temperature is between −80 and 60 °C.",

    unitFt: "ft",
    unitM: "m",
    unitC: "°C",
    unitK: "K",
    unitHpa: "hPa",
    unitKgM3: "kg/m³",
  },

  "true-airspeed": {
    notForFlightPlanning:
      "An informational calculation, not for flight planning — use the flight manual, charts, " +
      "forecast and NOTAMs for a flight.",

    cas: "Indicated airspeed",
    casHint: "Calibrated airspeed, in knots.",
    pressureAltitude: "Pressure altitude",
    pressureAltitudeHint: "In feet, up to 50 000 ft.",
    temperature: "Outside air temperature",
    temperatureHint: "In degrees Celsius.",

    results: "Result",
    outTas: "True airspeed",
    outTasKmh: "True airspeed in km/h",
    outTasMs: "True airspeed in m/s",
    outDensity: "Air density",
    outDensityRatio: "Density ratio",
    outIsaTemperature: "ISA temperature at that altitude",

    formula:
      "TAS = CAS·√(ρ₀/ρ), with the density from the ideal gas law at the standard pressure of that " +
      "altitude and your own temperature. That is the low-speed approximation: compressibility is " +
      "ignored, so the error grows with speed and altitude.",

    errorCas: "Calibrated airspeed is a positive number of knots, up to 1000.",
    errorAltitude: "The pressure altitude is between −1000 and 50 000 ft.",
    errorTemperature: "The temperature is between −80 and 60 °C.",

    unitKt: "kt",
    unitKmh: "km/h",
    unitMs: "m/s",
    unitKgM3: "kg/m³",
    unitC: "°C",
    unitFt: "ft",
  },

  "wind-triangle": {
    notForFlightPlanning:
      "An informational calculation, not for flight planning — use the flight manual, charts, " +
      "forecast and NOTAMs for a flight.",

    course: "Course to be made good",
    courseHint: "In degrees from 0 to 360, true.",
    tas: "True airspeed",
    tasHint: "In knots.",
    windFrom: "Wind direction",
    windFromHint: "The direction the wind blows from, in degrees from 0 to 360.",
    wind: "Wind speed",
    windHint: "In knots.",

    results: "Result",
    outWca: "Wind correction angle",
    outHeading: "Heading to fly",
    outGroundSpeed: "Speed over the ground",
    outGroundSpeedKmh: "Speed over the ground in km/h",
    outHeadwind: "Headwind component",
    outCrosswind: "Crosswind component",
    signNote:
      "The correction angle is positive to the right, the headwind component is positive on the " +
      "nose, and the crosswind is positive when the wind comes from the right.",

    formula:
      "sin(WCA) = (W/V)·sin(wind direction − course); heading = course + WCA; " +
      "GS = V·cos(WCA) − W·cos(wind direction − course).",

    errorCourse: "The course is between 0 and 360°.",
    errorWindFrom: "The wind direction is between 0 and 360°.",
    errorTas: "True airspeed is a positive number of knots, up to 1000.",
    errorWind: "The wind speed is between 0 and 300 kt.",
    errorNoSolution:
      "The wind's crosswind component is stronger than the whole true airspeed — no heading can " +
      "hold this course.",

    unitDeg: "°",
    unitKt: "kt",
    unitKmh: "km/h",
  },

  "wind-components": {
    notForFlightPlanning:
      "An informational calculation, not for flight planning — use the flight manual, charts, " +
      "forecast and NOTAMs for a flight.",

    windFrom: "Wind direction",
    windFromHint: "The direction the wind blows from, in degrees from 0 to 360.",
    wind: "Wind speed",
    windHint: "In knots.",
    runway: "Runway or course",
    runwayHint: "In degrees from 0 to 360, the direction you land or take off towards.",

    results: "Result",
    outAngle: "Angle between the wind and the runway",
    outHeadwind: "Headwind component",
    outCrosswind: "Crosswind component",
    outReciprocalHeadwind: "Headwind, opposite direction",
    outReciprocalCrosswind: "Crosswind, opposite direction",
    signNote:
      "The headwind component is positive on the nose and negative behind; the crosswind is " +
      "positive when the wind comes from the right. No manual's limit is judged here.",

    formula:
      "head = W·cos(wind direction − runway); cross = W·sin(wind direction − runway). On the same " +
      "runway the other way round, both components change sign.",

    errorWindFrom: "The wind direction is between 0 and 360°.",
    errorWind: "The wind speed is between 0 and 300 kt.",
    errorRunway: "The runway is between 0 and 360°.",

    unitDeg: "°",
    unitKt: "kt",
  },

  "fuel-reserve": {
    notForFlightPlanning:
      "An informational calculation, not for flight planning — use the flight manual, charts, " +
      "forecast and NOTAMs for a flight.",

    fuel: "Fuel on board",
    fuelHint: "In litres.",
    burn: "Burn rate",
    burnHint: "Litres per hour.",
    speed: "Speed for the range",
    speedHint: "The speed the range is quoted at, in knots.",
    reserve: "Reserve",
    reserveHint:
      "In minutes of flight at that burn rate — a reserve is a time, not a share of the tank. " +
      "There is no default.",

    results: "Result",
    outReserve: "Reserve",
    outBurnable: "Available for the flight",
    outEndurance: "Endurance",
    outEnduranceMinutes: "Endurance in minutes",
    outRange: "Range",
    outRangeKm: "Range in km",
    outHoursWithoutReserve: "Endurance without the reserve",
    outRangeWithoutReserve: "Range without the reserve",

    formula:
      "t = (F − P·r/60)/P and s = v·t, at a constant burn and a constant speed; a climb burns " +
      "more than a cruise.",

    errorFuel: "Fuel is a positive number of litres.",
    errorBurn: "The burn rate is a positive number of litres per hour.",
    errorSpeed: "The speed is a positive number of knots, up to 1000.",
    errorReserve: "The reserve is between 0 and 600 minutes and must leave fuel for the flight.",

    unitL: "l",
    unitH: "h",
    unitMinutes: "min",
    unitNm: "NM",
    unitKm: "km",
    unitKt: "kt",
  },

  "altimeter-units": {
    notForFlightPlanning:
      "An informational calculation, not for flight planning — use the flight manual, charts, " +
      "forecast and NOTAMs for a flight.",

    value: "Value",
    valueHint: "The pressure being set on the altimeter.",
    unit: "Unit",
    unitInhg: "inHg",
    unitHpa: "hPa",
    unitMb: "mbar",

    results: "Result",
    outInhg: "inHg",
    outHpa: "hPa",
    outMb: "mbar",
    outPa: "Pa",

    formula:
      "1 inHg = 25.4 mm × 133.322387415 Pa = 3386.388640341 Pa; 1 mbar is 1 hPa. Feet, kilometres " +
      "and knots live in the everyday drawer's length and speed converters.",

    errorValue: "The value is a positive number — up to 60 inHg or 2000 hPa.",
    errorUnit: "Choose the unit.",
  },
} as const;
