/**
 * „Vazduhoplovstvo" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment and
 * `@nexus/core/pro/vazduhoplovstvo.ts` spell it. The tool's NAME and its
 * one-line blurb are not here — those live in `./pro.ts`.
 *
 * **Every tool carries `notForFlightPlanning`.** The pack is `life-safety`, so
 * the host draws the general notice too; what a pilot needs to read before the
 * numbers is the narrower sentence, because a figure that looks like a
 * performance number is the one a hurried reader takes for one.
 *
 * **The standard atmosphere is named on the surface, never implied.** ICAO Doc
 * 7488 is the source of every constant behind these tools, and a real day is
 * never the standard day — the pressure, the temperature and the wind are the
 * user's own figures, typed with no default.
 */
export const PRO_VAZDUHOPLOVSTVO_SR = {
  "isa-atmosphere": {
    notForFlightPlanning:
      "Račun je informativan i nije za planiranje leta — za let koristi Letački priručnik, karte, " +
      "prognozu i NOTAM.",

    altitude: "Geopotencijalna visina",
    altitudeHint: "U stopama, do 65 616 ft (20 km).",

    results: "Rezultat",
    outAltitude: "Visina",
    outLayer: "Sloj",
    layerTroposphere: "Troposfera",
    layerIsothermal: "Izotermički sloj",
    outTemperature: "Temperatura",
    outTemperatureK: "Temperatura u kelvinima",
    outPressure: "Pritisak",
    outPressurePa: "Pritisak u paskalima",
    outDensity: "Gustina",
    outSpeedOfSound: "Brzina zvuka",
    outSpeedOfSoundKt: "Brzina zvuka u čvorovima",
    outDensityRatio: "Odnos gustine prema morskom nivou",
    outPressureRatio: "Odnos pritiska prema morskom nivou",

    formula:
      "troposfera: T = T₀ − 0,0065·h i p = p₀·(T/T₀)^5,255876; izotermički sloj: T = 216,65 K i " +
      "p = p₁₁·exp(−g·Δh/(R·T₁₁)); ρ = p/(R·T); a = √(γ·R·T). ICAO Doc 7488.",

    errorAltitude: "Visina je između −1000 i 65 616 ft.",

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
      "Račun je informativan i nije za planiranje leta — za let koristi Letački priručnik, karte, " +
      "prognozu i NOTAM.",

    pressure: "Pritisak na mestu",
    pressureHint: "Stvarni pritisak vazduha, u hektopaskalima.",
    temperature: "Spoljna temperatura",
    temperatureHint: "U stepenima Celzijusa.",

    results: "Rezultat",
    outPressureAltitude: "Visina po pritisku",
    outIsaTemperature: "ISA temperatura na toj visini",
    outDeviation: "Odstupanje od standarda",
    outDensity: "Gustina vazduha",
    outDensityAltitude: "Visina po gustini",

    formula:
      "h = (T₀/L)·(1 − (p/p₀)^(1/5,255876)); ρ = p/(R·T); visina po gustini je ona na kojoj " +
      "standardna atmosfera ima baš tu gustinu.",

    errorPressure: "Pritisak je između 100 i 1100 hPa.",
    errorTemperature: "Temperatura je između −80 i 60 °C.",

    unitFt: "ft",
    unitM: "m",
    unitC: "°C",
    unitK: "K",
    unitHpa: "hPa",
    unitKgM3: "kg/m³",
  },

  "true-airspeed": {
    notForFlightPlanning:
      "Račun je informativan i nije za planiranje leta — za let koristi Letački priručnik, karte, " +
      "prognozu i NOTAM.",

    cas: "Brzina po instrumentu",
    casHint: "Kalibrisana brzina, u čvorovima.",
    pressureAltitude: "Visina po pritisku",
    pressureAltitudeHint: "U stopama, do 50 000 ft.",
    temperature: "Spoljna temperatura",
    temperatureHint: "U stepenima Celzijusa.",

    results: "Rezultat",
    outTas: "Prava brzina",
    outTasKmh: "Prava brzina u km/h",
    outTasMs: "Prava brzina u m/s",
    outDensity: "Gustina vazduha",
    outDensityRatio: "Odnos gustine",
    outIsaTemperature: "ISA temperatura na toj visini",

    formula:
      "TAS = CAS·√(ρ₀/ρ), uz gustinu iz idealnog gasa na standardnom pritisku te visine i tvojoj " +
      "temperaturi. To je aproksimacija za male brzine: stišljivost se zanemaruje, pa greška " +
      "raste sa brzinom i visinom.",

    errorCas: "Kalibrisana brzina je pozitivan broj do 1000 kt.",
    errorAltitude: "Visina po pritisku je između −1000 i 50 000 ft.",
    errorTemperature: "Temperatura je između −80 i 60 °C.",

    unitKt: "kt",
    unitKmh: "km/h",
    unitMs: "m/s",
    unitKgM3: "kg/m³",
    unitC: "°C",
    unitFt: "ft",
  },

  "wind-triangle": {
    notForFlightPlanning:
      "Račun je informativan i nije za planiranje leta — za let koristi Letački priručnik, karte, " +
      "prognozu i NOTAM.",

    course: "Kurs koji se drži",
    courseHint: "U stepenima od 0 do 360, u odnosu na pravi sever.",
    tas: "Prava brzina",
    tasHint: "U čvorovima.",
    windFrom: "Smer vetra",
    windFromHint: "Smer iz kog vetar duva, u stepenima od 0 do 360.",
    wind: "Jačina vetra",
    windHint: "U čvorovima.",

    results: "Rezultat",
    outWca: "Korekcija kursa",
    outHeading: "Kurs za let",
    outGroundSpeed: "Brzina preko zemlje",
    outGroundSpeedKmh: "Brzina preko zemlje u km/h",
    outHeadwind: "Čeona komponenta",
    outCrosswind: "Poprečna komponenta",
    signNote:
      "Korekcija kursa je pozitivna udesno, čeona komponenta pozitivna u nos, a poprečna " +
      "pozitivna kad vetar duva s desne strane.",

    formula:
      "sin(WCA) = (W/V)·sin(smer vetra − kurs); kurs za let = kurs + WCA; " +
      "GS = V·cos(WCA) − W·cos(smer vetra − kurs).",

    errorCourse: "Kurs je između 0 i 360°.",
    errorWindFrom: "Smer vetra je između 0 i 360°.",
    errorTas: "Prava brzina je pozitivan broj do 1000 kt.",
    errorWind: "Jačina vetra je između 0 i 300 kt.",
    errorNoSolution:
      "Poprečna komponenta vetra je jača od cele prave brzine — nijedan kurs ne drži ovaj kurs.",

    unitDeg: "°",
    unitKt: "kt",
    unitKmh: "km/h",
  },

  "wind-components": {
    notForFlightPlanning:
      "Račun je informativan i nije za planiranje leta — za let koristi Letački priručnik, karte, " +
      "prognozu i NOTAM.",

    windFrom: "Smer vetra",
    windFromHint: "Smer iz kog vetar duva, u stepenima od 0 do 360.",
    wind: "Jačina vetra",
    windHint: "U čvorovima.",
    runway: "Pista ili kurs",
    runwayHint: "U stepenima od 0 do 360, za pravac u koji se sleće ili poleće.",

    results: "Rezultat",
    outAngle: "Ugao vetra prema pisti",
    outHeadwind: "Čeona komponenta",
    outCrosswind: "Poprečna komponenta",
    outReciprocalHeadwind: "Čeona, suprotni smer",
    outReciprocalCrosswind: "Poprečna, suprotni smer",
    signNote:
      "Čeona komponenta je pozitivna u nos, a negativna u leđa; poprečna je pozitivna kad vetar " +
      "duva s desne strane. Ograničenja iz priručnika se ne ocenjuju ovde.",

    formula:
      "čeono = W·cos(smer vetra − pista); poprečno = W·sin(smer vetra − pista). Za suprotan " +
      "smer iste piste obe komponente menjaju znak.",

    errorWindFrom: "Smer vetra je između 0 i 360°.",
    errorWind: "Jačina vetra je između 0 i 300 kt.",
    errorRunway: "Pista je između 0 i 360°.",

    unitDeg: "°",
    unitKt: "kt",
  },

  "fuel-reserve": {
    notForFlightPlanning:
      "Račun je informativan i nije za planiranje leta — za let koristi Letački priručnik, karte, " +
      "prognozu i NOTAM.",

    fuel: "Gorivo u avionu",
    fuelHint: "U litrima.",
    burn: "Potrošnja",
    burnHint: "Litara na sat.",
    speed: "Brzina za dolet",
    speedHint: "Brzina pri kojoj se navodi dolet, u čvorovima.",
    reserve: "Rezerva",
    reserveHint:
      "U minutama leta pri toj potrošnji — rezerva je vreme, ne deo rezervoara. Nema " +
      "podrazumevane vrednosti.",

    results: "Rezultat",
    outReserve: "Rezerva",
    outBurnable: "Za let",
    outEndurance: "Trajanje",
    outEnduranceMinutes: "Trajanje u minutima",
    outRange: "Dolet",
    outRangeKm: "Dolet u km",
    outHoursWithoutReserve: "Trajanje bez rezerve",
    outRangeWithoutReserve: "Dolet bez rezerve",

    formula:
      "t = (F − P·r/60)/P i s = v·t, pri stalnoj potrošnji i stalnoj brzini; penjanje troši više " +
      "od krstarenja.",

    errorFuel: "Gorivo je pozitivan broj litara.",
    errorBurn: "Potrošnja je pozitivan broj litara na sat.",
    errorSpeed: "Brzina je pozitivan broj do 1000 kt.",
    errorReserve: "Rezerva je između 0 i 600 minuta i mora da ostavi nešto goriva za let.",

    unitL: "l",
    unitH: "h",
    unitMinutes: "min",
    unitNm: "NM",
    unitKm: "km",
    unitKt: "kt",
  },

  "altimeter-units": {
    notForFlightPlanning:
      "Račun je informativan i nije za planiranje leta — za let koristi Letački priručnik, karte, " +
      "prognozu i NOTAM.",

    value: "Vrednost",
    valueHint: "Pritisak koji se postavlja na visinomeru.",
    unit: "Jedinica",
    unitInhg: "inHg",
    unitHpa: "hPa",
    unitMb: "mbar",

    results: "Rezultat",
    outInhg: "inHg",
    outHpa: "hPa",
    outMb: "mbar",
    outPa: "Pa",

    formula:
      "1 inHg = 25,4 mm × 133,322387415 Pa = 3386,388640341 Pa; 1 mbar je 1 hPa. Stopa i " +
      "kilometar i čvor su u „Alatkama“, u pretvaračima dužine i brzine.",

    errorValue: "Vrednost je pozitivan broj — do 60 inHg ili 2000 hPa.",
    errorUnit: "Izaberi jedinicu.",
  },
} as const;
