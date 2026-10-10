/**
 * „Geodezija i GIS" — the English copy of this toolkit's surfaces.
 *
 * The mirror of `pro.geodezija.ts`, key for key. The ellipsoid is named here
 * too: WGS84 (NIMA TR8350.2) is what every coordinate in this pack means, and a
 * latitude printed without it is ambiguous by about a hundred metres in Serbia.
 */
export const PRO_GEODEZIJA_EN = {
  "decimal-dms": {
    known: "Given as",
    knownDecimal: "Decimal degrees",
    knownDms: "Degrees, minutes, seconds",
    decimal: "Decimal degrees",
    decimalHint: "From −180 to 180. The degree carries the sign; minutes and seconds are magnitudes.",
    degrees: "Degrees",
    minutes: "Minutes",
    seconds: "Seconds",
    dmsHint: "Minutes and seconds run from 0 to 60; the sign goes on the degrees.",

    results: "Result",
    outDecimal: "Decimal degrees",
    outDms: "Degrees, minutes and seconds",

    formula:
      "decimal = degrees + minutes/60 + seconds/3600; degrees = floor(|v|), minutes = " +
      "floor(60·remainder), seconds = 60·remainder of the minutes.",

    errorDecimal: "The decimal degree is between −180 and 180.",
    errorDms: "Degrees are between −180 and 180, and minutes and seconds between 0 and 60.",

    unitDeg: "°",
  },

  "wgs84-utm": {
    direction: "Direction",
    directionToUtm: "From latitude and longitude to UTM",
    directionFromUtm: "From UTM to latitude and longitude",
    lat: "Latitude",
    lon: "Longitude",
    latHint: "Decimal degrees, from −80 to 84 — UTM does not exist beyond that.",
    lonHint: "Decimal degrees, from −180 to 180.",
    zone: "Zone",
    zoneHint: "From 1 to 60.",
    hemisphere: "Hemisphere",
    hemisphereNorth: "North",
    hemisphereSouth: "South",
    easting: "Easting",
    eastingHint: "In metres, from 100 000 to 900 000.",
    northing: "Northing",
    northingHint: "In metres; the southern hemisphere carries an added 10 000 000.",

    results: "Result",
    outZone: "Zone",
    outHemisphere: "Hemisphere",
    outCentralMeridian: "Central meridian",
    outEasting: "Easting",
    outNorthing: "Northing",
    outLat: "Latitude",
    outLon: "Longitude",
    outScale: "Scale factor",
    outConvergence: "Meridian convergence",

    formula:
      "The Gauss–Krüger series (Snyder 1987, §8-9 to §8-25): A = Δλ·cos φ, k₀ = 0.9996, false " +
      "easting 500 000 m. Convergence γ = atan(tan Δλ · sin φ). Ellipsoid WGS84.",

    errorPoint: "Latitude is between −80 and 84 and longitude between −180 and 180.",
    errorZone: "The zone is a whole number from 1 to 60.",
    errorEasting: "The easting is between 100 000 and 900 000 m.",
    errorNorthing: "The northing is between 0 and 10 000 000 m.",

    unitDeg: "°",
    unitM: "m",
  },

  "utm-mgrs": {
    direction: "Direction",
    directionToMgrs: "From latitude and longitude to MGRS",
    directionFromMgrs: "From MGRS to coordinates",
    lat: "Latitude",
    lon: "Longitude",
    latHint: "Decimal degrees, from −80 to 84.",
    lonHint: "Decimal degrees, from −180 to 180.",
    precision: "Precision",
    precision1m: "1 m",
    precision10m: "10 m",
    precision100m: "100 m",
    precision1km: "1 km",
    precision10km: "10 km",
    precision100km: "100 km (the square alone)",
    mgrs: "MGRS reference",
    mgrsHint: "For example 34TDQ1234567890. Spaces are ignored.",

    results: "Result",
    outMgrs: "MGRS reference",
    outZone: "Zone",
    outBand: "Band",
    outEasting: "Easting of the corner",
    outNorthing: "Northing of the corner",
    outSouthWest: "South-west corner",
    outCentre: "Centre of the square",
    outPrecision: "Precision",

    formula:
      "MGRS is a way of writing a UTM coordinate: the zone and band name the 6° × 8° cell, two " +
      "letters name the 100 km square, and the digits are the remainder inside it. The column " +
      "letters change with zone mod 3, and rows start at A in an odd zone and F in an even one.",

    errorPoint: "Latitude is between −80 and 84 and longitude between −180 and 180.",
    errorMgrs:
      "The reference is not valid: zone 1–60, a band from C to X, letters that zone allows, and " +
      "an even number of digits.",
    errorSquare: "The square's letters do not belong to the zone and band that were written.",

    unitDeg: "°",
    unitM: "m",
  },

  "geodesic-inverse": {
    fromLat: "Latitude of the first point",
    fromLon: "Longitude of the first point",
    toLat: "Latitude of the second point",
    toLon: "Longitude of the second point",
    latHint: "Decimal degrees, from −90 to 90.",
    lonHint: "Decimal degrees, from −180 to 180.",

    results: "Result",
    outDistance: "Distance on the ellipsoid",
    outDistanceKm: "Distance in kilometres",
    outInitialAzimuth: "Azimuth at the start",
    outFinalAzimuth: "Azimuth on arrival",

    formula:
      "Vincenty's 1975 inverse formulae on the WGS84 ellipsoid, iterating on the auxiliary " +
      "longitude to 10⁻¹³ rad. The control line: the meridian from the equator to the pole is " +
      "10 001 965.7293 m (the quarter meridian, NIMA TR8350.2).",

    errorFrom: "Check the latitude and longitude of the first point.",
    errorTo: "Check the latitude and longitude of the second point.",
    errorCoincident: "The two points are the same — there is no distance and no direction.",

    unitM: "m",
    unitKm: "km",
    unitDeg: "°",
  },

  "geodesic-direct": {
    fromLat: "Latitude of the start",
    fromLon: "Longitude of the start",
    latHint: "Decimal degrees, from −90 to 90.",
    lonHint: "Decimal degrees, from −180 to 180.",
    azimuth: "Azimuth",
    azimuthHint: "In degrees from 0 to 360, true.",
    distance: "Distance",
    distanceHint: "Along the ellipsoid, in metres.",

    results: "Result",
    outLat: "Latitude of arrival",
    outLon: "Longitude of arrival",
    outFinalAzimuth: "Azimuth on arrival",

    formula:
      "Vincenty's 1975 direct formulae on the WGS84 ellipsoid. The control line: 90° along the " +
      "equator is a·π/2 = 10 018 754.1714 m, which is exact arithmetic.",

    errorFrom: "Check the latitude and longitude of the start.",
    errorAzimuth: "The azimuth is a number of degrees.",
    errorDistance: "The distance is a positive number of metres.",

    unitDeg: "°",
    unitM: "m",
  },

  "grid-ground-ratio": {
    fromLat: "Latitude of the first point",
    fromLon: "Longitude of the first point",
    toLat: "Latitude of the second point",
    toLon: "Longitude of the second point",
    hint:
      "Both points must be in the same zone and the same hemisphere — across a zone boundary a " +
      "straight line between two projections is not a distance on any grid.",

    results: "Result",
    outGround: "Distance on the ellipsoid",
    outGrid: "Distance on the grid",
    outRatio: "Grid against ground",
    outScaleFrom: "Scale factor at the first point",
    outScaleTo: "Scale factor at the second point",

    formula:
      "ratio = (the straight line between the projected points) ÷ (the geodesic distance on the " +
      "ellipsoid). Along a zone's central meridian the ratio is exactly k₀ = 0.9996. The " +
      "elevation factor R/(R+h) is not in this ratio — that needs a height above the ellipsoid.",

    errorZone: "The points are in different zones — no grid distance exists between them.",
    errorHemisphere: "The points are in different hemispheres — no grid distance exists between them.",
    errorPoint: "Check the latitudes and longitudes of both points.",

    unitM: "m",
  },
} as const;
