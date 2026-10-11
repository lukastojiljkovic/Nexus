/**
 * „Geodezija i GIS" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment and
 * `@nexus/core/pro/geodezija.ts` spell it. The tool's NAME and its one-line
 * blurb are not here — those live in `./pro.ts`.
 *
 * **The ellipsoid is named on the surface.** WGS84 (NIMA TR8350.2) is what
 * every coordinate here means, and a surface that prints a latitude without
 * saying which ellipsoid it is on is a surface whose number is ambiguous by
 * about a hundred metres in Serbia. The national grid is NOT here, and the
 * catalogue entry says so rather than shipping a transformation nobody can
 * check.
 */
export const PRO_GEODEZIJA_SR = {
  "decimal-dms": {
    known: "Zadato je",
    knownDecimal: "Decimalni stepeni",
    knownDms: "Stepeni, minute, sekunde",
    decimal: "Decimalni stepeni",
    decimalHint: "Od −180 do 180. Znak nosi stepen, minute i sekunde su veličine.",
    degrees: "Stepeni",
    minutes: "Minute",
    seconds: "Sekunde",
    dmsHint: "Minute i sekunde su od 0 do 60; znak ide na stepene.",

    results: "Rezultat",
    outDecimal: "Decimalni stepeni",
    outDms: "Stepeni, minute i sekunde",

    formula:
      "decimalno = stepeni + minute/60 + sekunde/3600; stepeni = floor(|v|), minute = floor(60·ostatak), " +
      "sekunde = 60·ostatak minuta.",

    errorDecimal: "Decimalni broj stepeni je između −180 i 180.",
    errorDms: "Stepeni su između −180 i 180, a minute i sekunde od 0 do 60.",

    unitDeg: "°",
  },

  "wgs84-utm": {
    direction: "Smer",
    directionToUtm: "Iz širine i dužine u UTM",
    directionFromUtm: "Iz UTM u širinu i dužinu",
    lat: "Širina",
    lon: "Dužina",
    latHint: "Decimalni stepeni, od −80 do 84 — van toga UTM ne postoji.",
    lonHint: "Decimalni stepeni, od −180 do 180.",
    zone: "Zona",
    zoneHint: "Od 1 do 60.",
    hemisphere: "Hemisfere",
    hemisphereNorth: "Severna",
    hemisphereSouth: "Južna",
    easting: "Istočna koordinata",
    eastingHint: "U metrima, od 100 000 do 900 000.",
    northing: "Severna koordinata",
    northingHint: "U metrima; južna hemisfera ima dodatih 10 000 000.",

    results: "Rezultat",
    outZone: "Zona",
    outHemisphere: "Hemisfere",
    outCentralMeridian: "Centralni meridijan",
    outEasting: "Istočna koordinata",
    outNorthing: "Severna koordinata",
    outLat: "Širina",
    outLon: "Dužina",
    outScale: "Faktor razmere",
    outConvergence: "Konvergencija meridijana",

    formula:
      "Gaus-Krigerov red (Snyder 1987, §8-9 do §8-25): A = Δλ·cos φ, k₀ = 0,9996, lažni istočni " +
      "pomeraj 500 000 m. Konvergencija γ = atan(tan Δλ · sin φ). Elipsoid WGS84.",

    errorPoint: "Širina je između −80 i 84, a dužina između −180 i 180.",
    errorZone: "Zona je ceo broj od 1 do 60.",
    errorEasting: "Istočna koordinata je između 100 000 i 900 000 m.",
    errorNorthing: "Severna koordinata je između 0 i 10 000 000 m.",

    unitDeg: "°",
    unitM: "m",
  },

  "utm-mgrs": {
    direction: "Smer",
    directionToMgrs: "Iz širine i dužine u MGRS",
    directionFromMgrs: "Iz MGRS u koordinate",
    lat: "Širina",
    lon: "Dužina",
    latHint: "Decimalni stepeni, od −80 do 84.",
    lonHint: "Decimalni stepeni, od −180 do 180.",
    precision: "Preciznost",
    precision1m: "1 m",
    precision10m: "10 m",
    precision100m: "100 m",
    precision1km: "1 km",
    precision10km: "10 km",
    precision100km: "100 km (samo kvadrat)",
    mgrs: "MGRS oznaka",
    mgrsHint: "Na primer 34TDQ1234567890. Razmaci se ignorišu.",

    results: "Rezultat",
    outMgrs: "MGRS oznaka",
    outZone: "Zona",
    outBand: "Pojas",
    outEasting: "Istočna koordinata ugla",
    outNorthing: "Severna koordinata ugla",
    outSouthWest: "Jugozapadni ugao",
    outCentre: "Središte kvadrata",
    outPrecision: "Preciznost",

    formula:
      "MGRS je zapis UTM koordinate: zona i pojas imenuju ćeliju od 6° × 8°, dva slova kvadrat od " +
      "100 km, a cifre ostatak u kvadratu. Skup slova kolona se menja sa zonom mod 3, a redovi " +
      "počinju od A u neparnoj i od F u parnoj zoni.",

    errorPoint: "Širina je između −80 i 84, a dužina između −180 i 180.",
    errorMgrs:
      "Oznaka nije ispravna: zona 1–60, pojas od C do X, slova koja ta zona dozvoljava i " +
      "paran broj cifara.",
    errorSquare: "Slova kvadrata ne pripadaju zoni i pojasu koji su napisani.",

    unitDeg: "°",
    unitM: "m",
  },

  "geodesic-inverse": {
    fromLat: "Širina prve tačke",
    fromLon: "Dužina prve tačke",
    toLat: "Širina druge tačke",
    toLon: "Dužina druge tačke",
    latHint: "Decimalni stepeni, od −90 do 90.",
    lonHint: "Decimalni stepeni, od −180 do 180.",

    results: "Rezultat",
    outDistance: "Rastojanje po elipsoidu",
    outDistanceKm: "Rastojanje u kilometrima",
    outInitialAzimuth: "Azimut na početku",
    outFinalAzimuth: "Azimut na dolasku",

    formula:
      "Vincentijeva inverzna formula na elipsoidu WGS84 (Vincenty 1975), iteracija na pomoćnoj " +
      "dužini do 10⁻¹³ rad. Kontrolna linija: meridijan od ekvatora do pola je 10 001 965,7293 m " +
      "(četvrtina meridijana, NIMA TR8350.2).",

    errorFrom: "Proveri širinu i dužinu prve tačke.",
    errorTo: "Proveri širinu i dužinu druge tačke.",
    errorCoincident: "Tačke su iste — rastojanja nema, a azimut nema smer.",

    unitM: "m",
    unitKm: "km",
    unitDeg: "°",
  },

  "geodesic-direct": {
    fromLat: "Širina polazišta",
    fromLon: "Dužina polazišta",
    latHint: "Decimalni stepeni, od −90 do 90.",
    lonHint: "Decimalni stepeni, od −180 do 180.",
    azimuth: "Azimut",
    azimuthHint: "U stepenima od 0 do 360, od pravog severa.",
    distance: "Rastojanje",
    distanceHint: "Duž elipsoida, u metrima.",

    results: "Rezultat",
    outLat: "Širina dolaska",
    outLon: "Dužina dolaska",
    outFinalAzimuth: "Azimut na dolasku",

    formula:
      "Vincentijeva direktna formula na elipsoidu WGS84 (Vincenty 1975). Kontrolna linija: 90° po " +
      "ekvatoru je a·π/2 = 10 018 754,1714 m, i to je tačna aritmetika.",

    errorFrom: "Proveri širinu i dužinu polazišta.",
    errorAzimuth: "Azimut je broj stepeni.",
    errorDistance: "Rastojanje je pozitivan broj metara.",

    unitDeg: "°",
    unitM: "m",
  },

  "grid-ground-ratio": {
    fromLat: "Širina prve tačke",
    fromLon: "Dužina prve tačke",
    toLat: "Širina druge tačke",
    toLon: "Dužina druge tačke",
    hint: "Obe tačke moraju biti u istoj zoni i istoj hemisferi — preko granice zone prava linija " +
      "između dve projekcije nije rastojanje ni na jednoj mreži.",

    results: "Rezultat",
    outGround: "Rastojanje po elipsoidu",
    outGrid: "Rastojanje na mreži",
    outRatio: "Odnos mreža/teren",
    outScaleFrom: "Faktor razmere prve tačke",
    outScaleTo: "Faktor razmere druge tačke",

    formula:
      "odnos = (prava linija između projektovanih tačaka) / (geodezijsko rastojanje po elipsoidu). " +
      "Na centralnom meridijanu zone odnos je tačno k₀ = 0,9996. Visinska korekcija (R/(R+h)) nije " +
      "u ovom odnosu — za nju treba visina iznad elipsoida.",

    errorZone: "Tačke su u različitim zonama — mrežno rastojanje između njih ne postoji.",
    errorHemisphere: "Tačke su u različitim hemisferama — mrežno rastojanje između njih ne postoji.",
    errorPoint: "Proveri širine i dužine obe tačke.",

    unitM: "m",
  },
} as const;
