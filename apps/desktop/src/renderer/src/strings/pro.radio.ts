/**
 * „Radio-amaterizam" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment and
 * `@nexus/core/pro/radio.ts` spell it. The tool's NAME and its one-line blurb
 * are not here — those live in `./pro.ts`.
 *
 * **No band plan, no licence class and no power limit is quoted anywhere in
 * this file.** Those are the regulator's table, and copy that paraphrased one
 * would be a claim that goes stale at the next rule change; the tools compute
 * and the operator reads their own conditions.
 *
 * **The velocity factor, the datasheet's dB/100 m and the path loss are the
 * user's own figures**, typed with no default, and the hint under each field
 * says whose number it is.
 */
export const PRO_RADIO_SR = {
  "frequency-wavelength": {
    known: "Zadato je",
    knownFrequency: "Frekvencija",
    knownWavelength: "Talasna dužina",
    frequency: "Frekvencija",
    frequencyHint: "U hercima. Ostavi prazno ako nju tražiš.",
    wavelength: "Talasna dužina",
    wavelengthHint: "U metrima, u slobodnom prostoru. Ostavi prazno ako je tražiš.",

    results: "Rezultat",
    outFrequency: "Frekvencija",
    outFrequencyKhz: "Frekvencija u kHz",
    outFrequencyMhz: "Frekvencija u MHz",
    outWavelength: "Talasna dužina",
    outHalf: "Polovina talasne dužine",
    outQuarter: "Četvrtina talasne dužine",

    formula:
      "λ = c/f, c = 299 792 458 m/s (tačna vrednost po SI). Ovo je dužina u slobodnom prostoru — " +
      "fizička antena je kraća i za to služi alatka za dužine antena, gde se unosi faktor skraćenja.",

    errorPair: "Unesi tačno jedno od dva polja — frekvenciju ili talasnu dužinu.",
    errorFrequency: "Frekvencija je između 1 Hz i 1 THz.",
    errorWavelength: "Talasna dužina je pozitivan broj metara.",

    unitHz: "Hz",
    unitKhz: "kHz",
    unitMhz: "MHz",
    unitM: "m",
  },

  "antenna-lengths": {
    frequency: "Frekvencija",
    frequencyHint: "U hercima.",
    velocityFactor: "Faktor skraćenja",
    velocityFactorHint:
      "0,1–1. U vazduhu je 1, žica je oko 0,95, koaksijalni kabl oko 0,66. Nema podrazumevane " +
      "vrednosti — to je osobina provodnika koji sečeš.",

    results: "Rezultat",
    outWavelength: "Talasna dužina u slobodnom prostoru",
    outConductor: "Talasna dužina u provodniku",
    outDipole: "Polutalasni dipol",
    outQuarter: "Četvrtvalni element",
    outDipoleFt: "Dipol u stopama",
    outQuarterFt: "Četvrtvalni element u stopama",

    formula:
      "λ = VF·c/f; dipol = λ/2, četvrtvalni element = λ/4. Skraćenje zbog debljine provodnika i " +
      "visine nad tlom nije uračunato — antena se štimuje na instrumentu.",

    errorFrequency: "Frekvencija je između 1 Hz i 1 THz.",
    errorVelocityFactor: "Faktor skraćenja je između 0,1 i 1.",

    unitHz: "Hz",
    unitM: "m",
    unitFt: "ft",
  },

  "swr-match": {
    known: "Zadato je",
    knownSwr: "SWR",
    knownReturnLoss: "Povratni gubitak",
    knownReflection: "Koeficijent refleksije",
    knownMismatchLoss: "Gubitak zbog neprilagođenja",
    value: "Vrednost",
    valueHint:
      "SWR od 1 naviše, povratni gubitak u dB, koeficijent refleksije od 0 do 1, ili gubitak u dB.",

    results: "Rezultat",
    outSwr: "SWR",
    outReturnLoss: "Povratni gubitak",
    outReflection: "Koeficijent refleksije",
    outReflectedPercent: "Reflektovano",
    outPowerDelivered: "Predata snaga",
    outMismatchLoss: "Gubitak zbog neprilagođenja",
    returnLossNone: "nema ga (savršeno prilagođenje)",

    formula:
      "|Γ| = (SWR − 1)/(SWR + 1); povratni gubitak = −20·log₁₀|Γ|; predata snaga = 1 − |Γ|²; " +
      "gubitak = −10·log₁₀(1 − |Γ|²).",

    errorKind: "Izaberi veličinu koja je zadata.",
    errorValue:
      "Vrednost ne može biti takva: SWR je 1 ili više, koeficijent refleksije 0–1, a gubici " +
      "nenegativni.",

    unitDb: "dB",
    unitPercent: "%",
  },

  "path-loss": {
    distance: "Rastojanje",
    distanceHint: "Između antena, u kilometrima.",
    frequency: "Frekvencija",
    frequencyHint: "U hercima.",

    results: "Rezultat",
    outLoss: "Slabljenje u slobodnom prostoru",
    outFraction: "Deo snage koji stiže",
    outWavelength: "Talasna dužina",

    formula:
      "L = 20·log₁₀(4πd/λ) — Friisova jednačina (Friis 1946; ITU-R P.525). Slobodan prostor znači " +
      "bez odbijanja od tla, difrakcije, apsorpcije u atmosferi i kiše.",

    errorDistance: "Rastojanje je pozitivan broj kilometara.",
    errorFrequency: "Frekvencija je između 1 Hz i 1 THz.",

    unitDb: "dB",
    unitKm: "km",
    unitM: "m",
    unitPercent: "%",
    unitHz: "Hz",
  },

  "fresnel-zone": {
    path: "Dužina puta",
    pathHint: "Ukupno rastojanje između antena, u kilometrima.",
    fromEnd: "Rastojanje od jednog kraja",
    fromEndHint: "Od prve antene do prepreke, u kilometrima.",
    frequency: "Frekvencija",
    frequencyHint: "U hercima.",

    results: "Rezultat",
    outRadius: "Poluprečnik prve Frenelove zone",
    outClearance: "Prohodnost od 60 %",
    outWavelength: "Talasna dužina",
    outToEnd: "Do drugog kraja",

    formula:
      "r₁ = √(λ·d₁·d₂/(d₁ + d₂)) — prva zona (ITU-R P.530). Poluprečnik je najveći na sredini puta; " +
      "prohodnost od 60 % je uobičajeno pravilo, ne granica koju ova alatka postavlja.",

    errorPath: "Dužina puta je pozitivan broj kilometara.",
    errorFromEnd: "Rastojanje do prepreke mora biti manje od cele dužine puta.",
    errorFrequency: "Frekvencija je između 1 Hz i 1 THz.",

    unitKm: "km",
    unitM: "m",
    unitHz: "Hz",
  },

  "coax-loss": {
    dbPer100m: "Slabljenje kabla",
    dbPer100mHint:
      "Iz podataka proizvođača, u dB na 100 m — na frekvenciji na kojoj radiš. Nema tabele kablova.",
    length: "Dužina kabla",
    lengthHint: "U metrima.",
    inputWatts: "Snaga na ulazu",
    inputWattsHint: "U vatima. Prazno znači da se prikazuje samo gubitak.",

    results: "Rezultat",
    outLoss: "Gubitak u kablu",
    outFraction: "Deo snage koji stiže",
    outLossPercent: "Izgubljeno",
    outOutputWatts: "Snaga na kraju kabla",

    formula:
      "gubitak = (dB/100 m)·L/100; deo snage = 10^(−gubitak/10). Podatak proizvođača važi za " +
      "određenu frekvenciju.",

    errorDbPer100m: "Slabljenje kabla je između 0 i 100 dB na 100 m.",
    errorLength: "Dužina kabla je pozitivan broj metara.",
    errorPower: "Snaga je pozitivan broj vati.",

    unitDb: "dB",
    unitM: "m",
    unitPercent: "%",
    unitW: "W",
  },

  "link-budget": {
    txPower: "Snaga predajnika",
    txPowerHint: "U dBm.",
    txLoss: "Gubitak do antene",
    txLossHint: "Kabl i konektori na predaji, u dB.",
    txGain: "Dobitak predajne antene",
    txGainHint: "U dBi.",
    rxLoss: "Gubitak od antene",
    rxLossHint: "Kabl i konektori na prijemu, u dB.",
    rxGain: "Dobitak prijemne antene",
    rxGainHint: "U dBi.",
    pathLoss: "Slabljenje na putu",
    pathLossHint: "U dB — uzmi ga iz alatke za slabljenje na putu ili iz svog proračuna.",

    results: "Rezultat",
    outEirp: "EIRP",
    outReceived: "Snaga na prijemu",
    outReceivedW: "Snaga na prijemu u vatima",
    outReceivedUv: "Napon na 50 Ω",
    outNetGain: "Neto dobitak sistema",

    formula:
      "EIRP = P − gubitak + dobitak; prijem = EIRP + dobitak − gubitak − slabljenje na putu; " +
      "napon na 50 Ω je √(P·R). Prag prijema zavisi od prijemnika i ovde se ne ocenjuje.",

    errorTxPower: "Snaga predajnika je između −100 i 100 dBm.",
    errorLoss: "Gubici su između 0 i 100 dB.",
    errorGain: "Dobici su između −20 i 60 dBi.",
    errorPathLoss: "Slabljenje na putu je između 0 i 400 dB.",

    unitDbm: "dBm",
    unitDbi: "dBi",
    unitDb: "dB",
    unitW: "W",
    unitUv: "µV",
  },
} as const;
