/**
 * „Nautika i jedrenje" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment and
 * `@nexus/core/pro/nautika.ts` spell it. The tool's NAME and its one-line blurb
 * are not here — those live in `./pro.ts`, owned by another process.
 *
 * **Every tool in this pack carries `notForNavigation`**, and it is a per-tool
 * key rather than one line shared by the whole pack: the notice belongs beside
 * the figure it is about, and a shared leaf is one edit away from disappearing
 * from eight screens at once.
 *
 * **Nothing here is a decided number.** The riding scope, the reserved part of
 * the tank, the tide's own interval and the current are all the user's own
 * figures, typed with no default, and the hint under each field says so.
 */
export const PRO_NAUTIKA_SR = {
  "speed-run": {
    notForNavigation:
      "Račun je informativan i nije za navigaciju — za plovidbu koristi ovlašćene karte i " +
      "publikacije.",

    speed: "Brzina",
    speedHint: "U čvorovima. Ostavi prazno ako je tražiš.",
    distance: "Rastojanje",
    distanceHint: "U nautičkim miljama. Ostavi prazno ako ga tražiš.",
    time: "Vreme",
    timeHint: "U satima. Ostavi prazno ako ga tražiš.",

    results: "Rezultat",
    outSpeed: "Brzina",
    outSpeedKmh: "Brzina u km/h",
    outSpeedMs: "Brzina u m/s",
    outDistance: "Rastojanje",
    outDistanceKm: "Rastojanje u km",
    outTime: "Vreme",
    outTimeMinutes: "Vreme u minutima",

    formula: "v = s/t za ravnomerno kretanje — unesi tačno dve od tri veličine.",

    errorPair: "Unesi tačno dve od tri veličine — brzinu, rastojanje ili vreme.",
    errorSpeed: "Brzina je pozitivan broj do 200 čvorova.",
    errorDistance: "Rastojanje je nenegativan broj nautičkih milja.",
    errorTime: "Vreme je pozitivan broj sati.",

    unitKn: "kn",
    unitNm: "NM",
    unitKm: "km",
    unitH: "h",
    unitMinutes: "min",
    unitMs: "m/s",
  },

  "great-circle": {
    notForNavigation:
      "Račun je informativan i nije za navigaciju — za plovidbu koristi ovlašćene karte i " +
      "publikacije.",

    fromLat: "Širina polazišta",
    fromLon: "Dužina polazišta",
    toLat: "Širina odredišta",
    toLon: "Dužina odredišta",
    latHint: "Decimalni stepeni, od −90 do 90. Sever je pozitivan.",
    lonHint: "Decimalni stepeni, od −180 do 180. Istok je pozitivan.",

    results: "Rezultat",
    outDistanceNm: "Ortodroma",
    outDistanceKm: "Ortodroma u km",
    outCentralAngle: "Centralni ugao",
    outInitialBearing: "Početni azimut",
    outFinalBearing: "Azimut na dolasku",
    outRhumbDistance: "Loksodroma",
    outRhumbBearing: "Azimut loksodrome",
    outRhumbExcess: "Loksodroma je duža za",
    bearingNone: "nema ga (iste koordinate)",

    formula:
      "haversine: a = sin²(Δφ/2) + cosφ₁·cosφ₂·sin²(Δλ/2), d = 2R·asin(√a); azimut = " +
      "atan2(sinΔλ·cosφ₂, cosφ₁·sinφ₂ − sinφ₁·cosφ₂·cosΔλ); loksodroma po Mercatoru, " +
      "Δψ = ln tan(45° + φ/2). Sfera R₁ = 6371,0088 km.",

    errorFrom: "Proveri širinu i dužinu polazišta.",
    errorTo: "Proveri širinu i dužinu odredišta.",

    unitNm: "NM",
    unitKm: "km",
    unitDeg: "°",
    unitPercent: "%",
  },

  "anchor-rode": {
    notForNavigation:
      "Račun je informativan i nije za navigaciju — za plovidbu koristi ovlašćene karte i " +
      "publikacije.",

    depth: "Dubina",
    depthHint: "Pod pramcem, u metrima.",
    bowHeight: "Visina pramca",
    bowHeightHint: "Od vodene linije do valjka, u metrima. Prazno znači nula.",
    scope: "Uže po dubini",
    scopeHint: "Odnos koji sam biraš — na primer 5 za 5:1. Nema podrazumevane vrednosti.",

    results: "Rezultat",
    outDepthUsed: "Dubina po kojoj se računa",
    outRode: "Potrebno uže",
    outRodeFt: "Potrebno uže u stopama",

    formula: "uže = odnos × (dubina + visina pramca)",

    errorDepth: "Dubina je pozitivan broj metara do 200.",
    errorBowHeight: "Visina pramca je nenegativan broj metara do 20.",
    errorScope: "Odnos je pozitivan broj do 30.",

    unitM: "m",
    unitFt: "ft",
  },

  "fuel-range": {
    notForNavigation:
      "Račun je informativan i nije za navigaciju — za plovidbu koristi ovlašćene karte i " +
      "publikacije.",

    tank: "Rezervoar",
    tankHint: "Zapremina u litrima.",
    usable: "Iskoristivo",
    usableHint: "Deo rezervoara koji pumpa stvarno dohvata, u procentima.",
    burn: "Potrošnja",
    burnHint: "Litara na sat pri izabranoj brzini.",
    speed: "Brzina",
    speedHint: "U čvorovima.",
    reserve: "Rezerva",
    reserveHint: "Deo iskoristivog goriva koji čuvaš za sebe, u procentima.",

    results: "Rezultat",
    outUsable: "Iskoristivo gorivo",
    outReserve: "Rezerva",
    outBurnable: "Za plovidbu",
    outHours: "Trajanje",
    outHoursWithoutReserve: "Trajanje bez rezerve",
    outRange: "Domet",
    outRangeKm: "Domet u km",

    formula: "t = V/P i s = v·t, pri stalnoj potrošnji i stalnoj brzini.",

    errorTank: "Zapremina rezervoara je pozitivan broj litara.",
    errorUsable: "Iskoristivi deo je između 0 i 100 %.",
    errorBurn: "Potrošnja je pozitivan broj litara na sat.",
    errorSpeed: "Brzina je pozitivan broj do 200 čvorova.",
    errorReserve: "Rezerva je između 0 i 100 %.",

    unitL: "l",
    unitH: "h",
    unitNm: "NM",
    unitKm: "km",
    unitKn: "kn",
    unitPercent: "%",
  },

  "hull-speed": {
    notForNavigation:
      "Račun je informativan i nije za navigaciju — za plovidbu koristi ovlašćene karte i " +
      "publikacije.",

    length: "Dužina vodene linije",
    lengthHint: "U metrima — ne ukupna dužina broda.",
    froude: "Frudov broj",
    froudeHint: "Podrazumevano 0,40. Prihvata se od 0,1 do 1,5.",

    results: "Rezultat",
    outHullSpeed: "Brzina trupa",
    outHullSpeedKmh: "Brzina trupa u km/h",
    outHullSpeedMs: "Brzina trupa u m/s",
    outLengthFt: "Vodena linija u stopama",
    outFroude: "Frudov broj",
    outSpeedLength: "Odnos brzina–dužina",

    formula:
      "v = Fr·√(g·L); sa Fr = 0,40 to je klasičnih 1,34·√L(ft) u čvorovima, a granica je " +
      "talasanja, ne dozvoljena brzina.",

    errorLength: "Dužina vodene linije je pozitivan broj metara do 200.",
    errorFroude: "Frudov broj je između 0,1 i 1,5.",

    unitKn: "kn",
    unitKmh: "km/h",
    unitMs: "m/s",
    unitFt: "ft",
    unitM: "m",
  },

  "rule-of-twelfths": {
    notForNavigation:
      "Račun je informativan i nije za navigaciju — za plovidbu koristi ovlašćene karte i " +
      "publikacije.",

    range: "Raspon plime",
    rangeHint: "Od visoke do niske vode, u metrima.",
    hours: "Vreme od okretanja",
    hoursHint: "Sati od okretanja plime — može i razlomak.",
    duration: "Trajanje plime",
    durationHint: "Sati od visoke do niske vode. Često je šest, ali unosi svoje.",

    results: "Rezultat",
    outFraction: "Pomeraj",
    outMoved: "Pomeraj nivoa",
    outHeightAboveLow: "Nivo iznad niske vode",
    tableHour: "Sat",
    tableTwelfths: "Dvanaestina",
    tableFraction: "Deo raspona",
    tableMoved: "Pomeraj",

    formula:
      "1, 2, 3, 3, 2, 1 dvanaestina raspona; unutar sata linearna interpolacija, a dvanaestine " +
      "se dele na trajanje koje uneseš.",

    errorRange: "Raspon je pozitivan broj metara do 30.",
    errorDuration: "Trajanje je pozitivan broj sati do 12.",
    errorHours: "Vreme od okretanja je između 0 i trajanja plime.",

    unitM: "m",
    unitH: "h",
    unitPercent: "%",
  },

  vmg: {
    notForNavigation:
      "Račun je informativan i nije za navigaciju — za plovidbu koristi ovlašćene karte i " +
      "publikacije.",

    boatSpeed: "Brzina broda",
    boatSpeedHint: "Kroz vodu, u čvorovima.",
    windAngle: "Ugao pravog vetra",
    windAngleHint: "0° je u vetar, 180° niz vetar. Od 0 do 180°.",

    results: "Rezultat",
    outVmg: "VMG",
    outVmgKmh: "VMG u km/h",
    outFraction: "Deo brzine",
    outDirection: "Smer",
    upwind: "Uz vetar",
    downwind: "Niz vetar",

    formula:
      "VMG = V·cos θ, gde je θ ugao između kursa i smera iz kog vetar duva. Koliko je od toga " +
      "stvarno najbrže zavisi od polara broda, ne od ovog računa.",

    errorSpeed: "Brzina je pozitivan broj do 60 čvorova.",
    errorAngle: "Ugao je između 0 i 180°.",

    unitKn: "kn",
    unitKmh: "km/h",
    unitPercent: "%",
    unitDeg: "°",
  },

  "course-to-steer": {
    notForNavigation:
      "Račun je informativan i nije za navigaciju — za plovidbu koristi ovlašćene karte i " +
      "publikacije.",

    track: "Kurs preko zemlje",
    trackHint: "Željeni kurs, u stepenima od 0 do 360.",
    boatSpeed: "Brzina kroz vodu",
    boatSpeedHint: "U čvorovima.",
    set: "Smer struje",
    setHint: "Smer u kome struja teče (ka), u stepenima od 0 do 360.",
    drift: "Brzina struje",
    driftHint: "U čvorovima.",

    results: "Rezultat",
    outHeading: "Kurs za kormilo",
    outDriftAngle: "Ugao zanošenja",
    outGroundSpeed: "Brzina preko zemlje",
    outGroundSpeedKmh: "Brzina preko zemlje u km/h",

    formula:
      "sin θ = −(c/b)·sin(S − T), pa V = b·cos θ + c·cos(S − T); S je smer u koji struja teče.",

    errorTrack: "Kurs je između 0 i 360°.",
    errorSet: "Smer struje je između 0 i 360°.",
    errorSpeed: "Brzina kroz vodu je pozitivan broj do 60 čvorova.",
    errorDrift: "Brzina struje je nenegativan broj do 20 čvorova.",
    errorCurrent:
      "Struja je poprečno jača od brzine broda — nijedan kurs ne drži ovu putanju.",

    unitDeg: "°",
    unitKn: "kn",
    unitKmh: "km/h",
  },
} as const;
