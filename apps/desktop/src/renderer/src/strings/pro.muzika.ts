/**
 * „Muzika i produkcija" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those
 * live in the `name` and `blurb` tables of `./pro.ts`.
 *
 * **A unit is copy, not a constant.** Written here rather than concatenated
 * in the surface, so a unit hard-coded in a component is not a string
 * `check:strings` cannot see and a translator cannot find.
 *
 * **`speaker-load` and `spl-distance` are `life-safety`.** Their copy may
 * name a quantity and may name the user's own limit, and may not say what
 * the two mean together. No verdict word appears anywhere in this file for
 * either tool, on purpose — see `toolForbidsVerdict`.
 *
 * **`cents-ratio` kept its own entry, against this file's first draft.** That
 * draft retired it as absorbed by `note-frequency` (a second frequency, a
 * cents shift) and `varispeed-repitch` (a cents entry point). Two things make
 * that wrong. `note-frequency` can only reach the identity through a NOTE —
 * there is no way in it to ask what ratio 700 cents is, or how many cents 3:2
 * is, because both of `centsRatio`'s other entry kinds need no pitch at all.
 * And `varispeed-repitch`, which does cover the bare conversion, is
 * `packs: ["muzika"]` while this tool is `["muzika", "prosveta"]` — so for a
 * teacher the identity would have been unreachable, and even for an engineer
 * it would have meant opening a tape-speed screen to look up an interval.
 * Nothing is duplicated by keeping it: all three call the same `centsRatio`.
 */
export const PRO_MUZIKA_SR = {
  "audio-level-reference": {
    entryKind: "Šta je uneto",
    entryDbu: "dBu",
    entryDbv: "dBV",
    entryVrms: "Efektivni napon (Vrms)",
    entryVpp: "Međuvršni napon (Vpp)",
    entryDbm: "dBm",
    entryDbfs: "dBFS",
    value: "Vrednost",
    impedance: "Referentna impedansa za dBm",
    impedanceHint: "600 Ω za klasičnu liniju, 50 Ω za RF. Bez nje se dBm ne prikazuje.",
    calibrationKind: "Poravnanje digitalne skale",
    calibrationNone: "Nije uneto",
    calibrationDbuAt0: "dBu pri 0 dBFS",
    calibrationDbfsAtPlus4: "dBFS pri +4 dBu",
    calibrationValue: "Vrednost poravnanja",
    calibrationHint:
      "Kućna konvencija: +4 dBu na −18 dBFS je EBU/SMPTE muzička konvencija, −20 dBFS je filmska " +
      "konvencija SMPTE. Nexus ne pretpostavlja nijednu.",

    results: "Rezultat",
    resultDbu: "dBu",
    resultDbv: "dBV",
    resultVrms: "Efektivni napon",
    resultVpeak: "Vršni napon",
    resultVpp: "Međuvršni napon",
    resultDbm: "dBm",
    resultDbfs: "dBFS",
    dbmNote: "dBm i dBu se poklapaju samo pri 600 Ω — van te impedanse su različite skale.",
    peakNote:
      "Vršne i međuvršne vrednosti važe za sinusni signal; kod programskog materijala krest " +
      "faktor je svojstvo samog signala.",

    inputs: "Uneseno",
    formula:
      "dBu = 20·log₁₀(Vrms / √0,6)     dBV = 20·log₁₀(Vrms)     dBm = 10·log₁₀((Vrms²/R) / " +
      "0,001)     Vpeak = Vrms·√2     dBFS = dBu − dBu(0 dBFS)",

    errorDbu: "dBu je broj od −100 do +60.",
    errorDbv: "dBV je broj od −100 do +60.",
    errorVrms: "Efektivni napon mora biti veći od nule.",
    errorVpp: "Međuvršni napon mora biti veći od nule.",
    errorDbm: "dBm je broj od −100 do +60.",
    errorImpedance: "Referentna impedansa mora biti veća od nule.",
    errorDbfs: "dBFS mora biti realan broj, a dobijeni dBu mora ostati u opsegu −100 do +60.",
    errorCalibration: "Poravnanje mora dati dBu u opsegu −100 do +60.",

    unitDbu: "dBu",
    unitDbv: "dBV",
    unitV: "V",
    unitDbm: "dBm",
    unitDbfs: "dBFS",
    unitOhm: "Ω",
  },

  "bar-duration": {
    bpm: "Tempo",
    bpmHint: "Otkucaji u minuti, prema izabranoj referenci ispod.",
    bpmReference: "Šta broji tempo",
    bpmRefQuarter: "Četvrtinu",
    bpmRefDottedQuarter: "Četvrtinu sa tačkom",
    bpmRefDenominatorUnit: "Notnu vrednost imenioca",
    bpmReferenceHint:
      "U složenim taktovima kao 6/8 tempo se često navodi u četvrtinama sa tačkom — ova alatka " +
      "to ne pretpostavlja.",
    numerator: "Brojilac takta",
    denominator: "Imenilac takta",
    bars: "Broj taktova",
    barsHint: "Poslednje uneto polje — ovo ili trajanje — vodi računicu; drugo postaje izračunato.",
    duration: "Trajanje",
    durationHint: "U sekundama. Poslednje uneto polje — ovo ili broj taktova — vodi računicu.",

    results: "Rezultat",
    resultSeconds: "Trajanje",
    resultFormatted: "Trajanje (mm:ss)",
    resultSecondsPerBar: "Sekundi po taktu",
    resultSecondsPerBeatUnit: "Sekundi po jedinici imenioca",
    resultBars: "Ceo broj taktova",
    resultRemainderSeconds: "Ostatak u sekundama",
    resultRemainderBeats: "Ostatak u jedinicama imenioca",
    resultRemainderMs: "Ostatak u milisekundama",

    inputs: "Uneseno",
    formula:
      "sekPoJedinici = (60/BPM)·(4/imenilac)   [ili /1,5 za četvrtinu sa tačkom, ili 60/BPM za " +
      "jedinicu imenioca]     sekPoTaktu = brojilac·sekPoJedinici     trajanje = " +
      "taktovi·sekPoTaktu     taktovi = floor(trajanje/sekPoTaktu)",

    errorBpm: "Tempo je broj od 1 do 999.",
    errorNumerator: "Brojilac takta je ceo broj od 1 do 64.",
    errorDenominator: "Imenilac takta mora biti 1, 2, 4, 8, 16 ili 32.",
    errorBpmReference: "Referenca tempa mora biti izabrana vrednost.",
    errorBars: "Broj taktova je broj od 0 do 100000.",
    errorSeconds: "Trajanje je broj od 0 do 10000000 sekundi.",

    unitS: "s",
    unitBpm: "BPM",
    unitDoba: "doba",
    unitMs: "ms",
  },

  "bpm-delay-times": {
    bpm: "Tempo",
    highlightDenominator: "Notna vrednost za isticanje",
    highlightModifier: "Modifikator za isticanje",
    modStraight: "Prava",
    modDotted: "Sa tačkom",
    modTriplet: "Triolska",

    resultsForward: "Tabela po tempu",
    colNote: "Nota",
    colStraightMs: "Prava (ms)",
    colStraightHz: "Prava (Hz)",
    colDottedMs: "Sa tačkom (ms)",
    colDottedHz: "Sa tačkom (Hz)",
    colTripletMs: "Triolska (ms)",
    colTripletHz: "Triolska (Hz)",
    beatMs: "Trajanje jedne četvrtine",

    measuredMs: "Izmereno kašnjenje",
    measuredMsHint: "Sa spoljnog delay uređaja ili nepoznatog stema, u milisekundama.",
    resultsInverse: "Tabela po izmerenom kašnjenju",
    colStraightBpm: "Prava (BPM)",
    colDottedBpm: "Sa tačkom (BPM)",
    colTripletBpm: "Triolska (BPM)",

    inputs: "Uneseno",
    formula:
      "ms = (60000/BPM)·(4/imenilac)·modifikator     modifikator: prava=1, sa tačkom=3/2, " +
      "triolska=2/3     Hz = 1000/ms     obrnuto: BPM = 240000·modifikator/(imenilac·izmerenoMs)",

    errorBpm: "Tempo je broj od 1 do 999.",
    errorDenominator: "Notna vrednost za isticanje mora biti 1, 2, 4, 8, 16, 32 ili 64.",
    errorMeasuredMs: "Izmereno kašnjenje mora biti veće od nule.",

    unitMs: "ms",
    unitHz: "Hz",
    unitBpm: "BPM",
  },

  "cents-ratio": {
    entryKind: "Šta je uneto",
    entryFrequencies: "Dve frekvencije",
    entryCents: "Centi",
    entryRatio: "Odnos",
    frequencyA: "Prva frekvencija (A)",
    frequencyB: "Druga frekvencija (B)",
    cents: "Centi",
    centsHint: "Sa znakom, od −12000 do +12000. Jedan poluton jednake temperacije je 100 centi.",
    ratio: "Odnos",
    ratioHint: "Kao broj: 1,5 za čistu kvintu 3:2, 1,25 za čistu tercu 5:4.",
    baseFrequency: "Osnovna frekvencija",
    baseFrequencyHint: "Opciono — daje rezultujuću frekvenciju i brzinu udara.",
    baseFrequencyFromA: "Kod dve frekvencije osnovna je A, pa se ovo polje ne unosi.",

    results: "Rezultat",
    resultCents: "Centi",
    resultSemitones: "Polutonovi (12-TET)",
    resultRatio: "Odnos",
    resultBaseFrequency: "Osnovna frekvencija",
    resultFrequency: "Rezultujuća frekvencija",
    resultBeatHz: "Brzina udara",
    beatNote:
      "Brzina udara je razlika u hercima, ne u centima — istih 7,85 centi je 3,6 Hz na 440 Hz i " +
      "90 Hz na 11 kHz.",
    signNote: "Znak se čuva: B ispod A daje negativne cente i odnos manji od jedan.",

    inputs: "Uneseno",
    formula: "centi = 1200·log₂(fB/fA)     odnos = 2^(centi/1200)     udari = |f·(odnos − 1)|",

    errorFrequencyA: "Prva frekvencija mora biti veća od nule.",
    errorFrequencyB: "Druga frekvencija mora biti veća od nule.",
    errorCents: "Centi su broj od −12000 do +12000.",
    errorRatio: "Odnos mora biti veći od nule.",
    errorBaseFrequency: "Osnovna frekvencija mora biti veća od nule.",

    unitHz: "Hz",
    unitCent: "centi",
    unitSemitone: "polutonova",
  },

  "compressor-curve": {
    threshold: "Prag T",
    thresholdHint: "U dBFS, od −80 do 0.",
    ratio: "Odnos n:1",
    knee: "Širina kolena",
    kneeHint: "0 je oštro koleno. Podrazumevano 0.",
    inputLevel: "Ulazni nivo x",
    inputLevelHint: "U dBFS, od −120 do +20.",
    makeup: "Makeup pojačanje",
    makeupHint: "Podrazumevano 0.",
    makeupReferenceLevel: "Referentni nivo za makeup",
    makeupReferenceLevelHint:
      "Programski nivo na koji se pojačanje vraća. Mastering se vraća na programski nivo, ne na " +
      "pun opseg, pa ovo nema podrazumevanu vrednost.",

    results: "Rezultat",
    resultOutputLevel: "Izlazni nivo y",
    resultGainReduction: "Redukcija pojačanja",
    resultOutputWithMakeup: "Izlaz posle makeup pojačanja",
    resultMakeupToReference: "Makeup koji referentni nivo vraća na sebe",
    scopeNote:
      "Ovo je samo statička prenosna kriva pojačanja — bez napada, otpuštanja, tipa detektora " +
      "(vršni ili RMS) i bez unapredne najave.",

    inputs: "Uneseno",
    formula:
      "ispod kolena: y=x     u kolenu: y = x + (1/n − 1)·(x − T + W/2)²/(2W)     iznad kolena: y " +
      "= T + (x − T)/n     GR = x − y",

    errorThreshold: "Prag je broj od −80 do 0 dBFS.",
    errorRatio: "Odnos je broj od 1 do 1000.",
    errorKnee: "Širina kolena je broj od 0 do 40 dB.",
    errorInputLevel: "Ulazni nivo je broj od −120 do +20 dBFS.",
    errorMakeup: "Makeup pojačanje je broj od −20 do +40 dB.",
    errorMakeupReferenceLevel: "Referentni nivo za makeup je broj od −120 do +20 dBFS.",

    unitDb: "dB",
    unitDbfs: "dBFS",
  },

  "decibel-ratio": {
    entryKind: "Šta je uneto",
    entryDecibels: "Decibeli",
    entryRatio: "Linearni odnos",
    value: "Vrednost",
    quantity: "Vrsta veličine",
    quantityAmplitude: "Amplituda / napon",
    quantityPower: "Snaga",

    results: "Rezultat",
    resultDecibels: "Decibeli",
    resultRatio: "Linearni odnos",
    resultPercent: "Odnos u procentima",

    levels: "Spisak nivoa za sabiranje",
    levelsHint: "Jedan nivo po redu, u decibelima. Do 64 reda.",
    resultsSum: "Nekoherentan zbir",
    resultSum: "Zbir",
    sumNote:
      "Zbir je nekoherentan (po snazi) bez obzira na izabranu vrstu veličine — koherentni izvori " +
      "se sabiraju po amplitudi, što je drugo pitanje.",
    colLevel: "Nivo (dB)",
    colShare: "Udeo u energiji (%)",

    inputs: "Uneseno",
    formula:
      "amplituda: dB = 20·log₁₀(odnos)     snaga: dB = 10·log₁₀(odnos)     zbir: Lsum = " +
      "10·log₁₀(Σ 10^(Li/10))",

    errorDecibels: "Decibeli su broj od −200 do +200.",
    errorRatio: "Linearni odnos mora biti veći od nule.",
    errorQuantity: "Vrsta veličine mora biti izabrana vrednost.",
    errorLevels: "Potreban je bar jedan i najviše 64 nivoa, svaki od −200 do +200 dB.",

    unitDb: "dB",
    unitPercent: "%",
  },

  "note-frequency": {
    entryKind: "Šta je uneto",
    entryMidi: "MIDI broj",
    entryName: "Ime note",
    entryFrequency: "Frekvencija",
    midi: "MIDI broj",
    midiHint: "Ceo broj od 0 do 127.",
    name: "Ime note",
    nameHint: "Naučna notacija: C, D#3, Bb-1, Fx2.",
    frequency: "Frekvencija",
    referencePitch: "Referentni ton A4",
    referencePitchHint:
      "Podrazumevano 440 Hz po ISO 16:1975. 415 Hz je barokni štim, 442/443 Hz su česti " +
      "orkestarski.",
    octaveConvention: "Numeracija oktava",
    octaveConventionScientific: "Naučna / MIDI (MIDI 60 = C4)",
    octaveConventionYamaha: "Yamaha (MIDI 60 = C3)",
    secondFrequency: "Druga frekvencija",
    secondFrequencyHint: "Opciono — ispisuje interval do ove frekvencije.",
    pitchShiftCents: "Pomak visine u centima",
    pitchShiftCentsHint: "Opciono, sa znakom — primenjuje se na izračunatu frekvenciju.",

    results: "Rezultat",
    resultName: "Ime (povisilice)",
    resultFlatName: "Ime (snizilice)",
    resultMidi: "MIDI broj",
    resultFrequency: "Frekvencija",
    outsideMidiRangeNote: "Izračunati MIDI broj je van opsega 0–127, prikazan onakav kakav jeste.",
    resultMidiExact: "Tačan MIDI broj (pre zaokruživanja)",
    resultCents: "Odstupanje od najbliže note",

    intervalTitle: "Interval do druge frekvencije",
    resultIntervalCents: "Centi",
    resultIntervalSemitones: "Polutonovi (12-TET)",
    resultIntervalRatio: "Odnos",
    resultIntervalResultFrequency: "Rezultujuća frekvencija",
    resultBeatHz: "Brzina udara",

    shiftedTitle: "Posle pomaka",
    resultShiftedName: "Nova nota",
    resultShiftedFrequency: "Nova frekvencija",
    resultShiftedCents: "Odstupanje nove note od najbliže",

    inputs: "Uneseno",
    formula:
      "f(m) = A4·2^((m−69)/12)     mTačno = 69 + 12·log₂(f/A4)     centi = 1200·log₂(fB/fA)     " +
      "pomak: f' = f·2^(centi/1200)",

    errorMidi: "MIDI broj je ceo broj od 0 do 127.",
    errorName: "Ime note nije prepoznato u naučnoj notaciji.",
    errorFrequency: "Frekvencija mora biti veća od nule.",
    errorReferencePitch: "Referentni ton je broj od 380 do 500 Hz.",
    errorOctaveConvention: "Numeracija oktava mora biti izabrana vrednost.",
    errorSecondFrequency: "Druga frekvencija mora biti veća od nule.",
    errorPitchShiftCents: "Pomak visine je broj od −12000 do +12000 centi.",

    unitHz: "Hz",
    unitCent: "centi",
    unitSemitone: "polutonova",
  },

  "pcm-file-size": {
    direction: "Smer",
    directionFromDuration: "Trajanje → veličina",
    directionFromSize: "Veličina → trajanje",
    duration: "Trajanje",
    durationHint: "U sekundama.",
    size: "Veličina",
    sizeUnit: "Jedinica veličine",
    sizeUnitMb: "MB",
    sizeUnitGb: "GB",
    sizeUnitMib: "MiB",
    sizeUnitGib: "GiB",
    sampleRate: "Frekvencija odabiranja",
    bitDepth: "Rezolucija",
    bitDepth32Note: "32-bitni ceo broj i 32-bitni pokretni zarez zauzimaju ista 4 bajta.",
    channels: "Broj kanala",
    tracks: "Broj traka (procena sesije)",
    tracksHint: "Podrazumevano 1. Zaglavlje se dodaje po traci, ne jednom za celu sesiju.",
    includeHeader: "Uračunaj WAV zaglavlje od 44 bajta",
    yes: "Da",
    no: "Ne",

    results: "Rezultat",
    resultBytes: "Bajtova",
    resultHeaderBytes: "Od toga zaglavlje",
    resultMegabytes: "MB (dekadno)",
    resultGigabytes: "GB (dekadno)",
    resultMebibytes: "MiB (binarno)",
    resultGibibytes: "GiB (binarno)",
    resultBytesPerSecond: "Protok (B/s)",
    resultBitrate: "Protok",
    exceedsNote:
      "Ukupna veličina prelazi ono što 32-bitno RIFF polje veličine može da adresira — potreban " +
      "je RF64 ili W64.",
    resultSeconds: "Trajanje",
    resultFormatted: "Trajanje (HH:MM:SS)",

    inputs: "Uneseno",
    formula:
      "bajtiPoSekundi = frekvencija·(rezolucija/8)·kanali     bajtovi = " +
      "bajtiPoSekundi·trajanje·trake + 44·trake (sa zaglavljem)     protok[kbit/s] = " +
      "frekvencija·rezolucija·kanali/1000",

    errorSampleRate: "Frekvencija odabiranja je broj od 1000 do 768000 Hz.",
    errorBitDepth: "Rezolucija mora biti 8, 16, 24 ili 32 bita.",
    errorChannels: "Broj kanala je ceo broj od 1 do 256.",
    errorTracks: "Broj traka je ceo broj od 1 do 1000.",
    errorSeconds: "Trajanje ne sme biti negativno.",
    errorBytes:
      "Veličina mora biti veća od nule i mora sadržati bar zaglavlje kad je ono uključeno.",

    unitB: "B",
    unitMb: "MB",
    unitGb: "GB",
    unitMib: "MiB",
    unitGib: "GiB",
    unitKbps: "kbit/s",
    unitS: "s",
    unitHz: "Hz",
  },

  "reverb-time": {
    volume: "Zapremina prostorije",
    temperature: "Temperatura vazduha",
    temperatureHint: "Podrazumevano 20 °C. Hrani brzinu zvuka.",
    surfaces: "Površine",
    surfacesHint:
      "Jedan red po površini: površina;α125;α250;α500;α1000;α2000;α4000. Koeficijenti su sa " +
      "deklaracije konkretnog proizvoda, po oktavnom pojasu, i važe za taj opseg — Nexus ih ne " +
      "ugrađuje.",
    airAbsorption: "Apsorpcija vazduha po pojasu (opciono)",
    airAbsorptionHint:
      "m po metru, po oktavnom pojasu — zavisi od vlažnosti i temperature. Iznad otprilike 2 kHz " +
      "u velikoj prostoriji preovlađuje.",
    air125: "125 Hz",
    air250: "250 Hz",
    air500: "500 Hz",
    air1000: "1000 Hz",
    air2000: "2000 Hz",
    air4000: "4000 Hz",

    results: "Rezultat po pojasu",
    colBand: "Pojas (Hz)",
    colAbsorption: "A (m² sabina)",
    colAverageAlpha: "ᾱ",
    colSabine: "Sabine (s)",
    colSabineWithAir: "Sabine sa vazduhom (s)",
    colEyring: "Eyring (s)",
    totalArea: "Ukupna površina",
    speedOfSound: "Brzina zvuka",
    noValue: "nema vrednosti",
    sabineLimitNote:
      "Sabin pretpostavlja difuzno polje i nepouzdan je iznad otprilike ᾱ = 0,2 — zato Eyring " +
      "stoji pored njega.",
    divergenceNote:
      "Pri ᾱ = 1 Sabine i dalje daje konačan broj, a Eyring nema vrednost — ta razlika je pošten " +
      "odgovor, ne greška.",

    inputs: "Uneseno",
    formula:
      "A = Σ(Sᵢ·αᵢ)     Sabine: RT60 = 24·ln(10)·V/(c·A)     Eyring: RT60 = " +
      "24·ln(10)·V/(−c·S·ln(1−ᾱ))     sa vazduhom: RT60 = 24·ln(10)·V/(c·(A + 4mV))",

    errorTemperature: "Temperatura je broj od −50 do +60 °C.",
    errorVolume: "Zapremina prostorije mora biti veća od nule.",
    errorSurfaces:
      "Potreban je bar jedan i najviše 64 reda; površina mora biti veća od nule, svaki α je broj " +
      "od 0 do 1.",
    errorAirAbsorption: "Apsorpcija vazduha ne sme biti negativna.",

    unitS: "s",
    unitM2: "m²",
    unitM3: "m³",
    unitM: "m",
    unitMps: "m/s",
    unitHz: "Hz",
    unitC: "°C",
  },

  "room-modes": {
    length: "Dužina prostorije",
    width: "Širina prostorije",
    height: "Visina prostorije",
    temperature: "Temperatura vazduha",
    temperatureHint: "Podrazumevano 20 °C.",
    frequencyLimit: "Gornja granica frekvencije",
    frequencyLimitHint:
      "Podrazumevano 300 Hz — modovi imaju značaj tamo gde prostorija nije difuzna.",
    maxOrder: "Najviši red moda po osi",
    maxOrderHint: "Podrazumevano 4.",

    results: "Modovi",
    colIndex: "(p, q, r)",
    colFrequency: "Frekvencija (Hz)",
    colType: "Vrsta",
    colSpacing: "Razmak do prethodnog (Hz)",
    typeAxial: "aksijalni",
    typeTangential: "tangencijalni",
    typeOblique: "kosi",
    speedOfSound: "Brzina zvuka",
    idealizationNote:
      "Modovi za pravougaonu prostoriju sa krutim zidovima — idealizacija, ne konkretna " +
      "prostorija sa vratima, prozorima i nameštajem.",

    inputs: "Uneseno",
    formula:
      "f(p,q,r) = (c/2)·√((p/L)² + (q/W)² + (r/H)²)     tip: 1 osa = aksijalni, 2 = " +
      "tangencijalni, 3 = kosi",

    errorLength: "Dužina prostorije je broj od 0,5 do 100 m.",
    errorWidth: "Širina prostorije je broj od 0,5 do 100 m.",
    errorHeight: "Visina prostorije je broj od 0,5 do 30 m.",
    errorTemperature: "Temperatura je broj od −50 do +60 °C.",
    errorFrequencyLimit: "Gornja granica frekvencije je broj od 20 do 1000 Hz.",
    errorMaxOrder: "Najviši red moda je ceo broj od 1 do 8.",

    unitHz: "Hz",
    unitM: "m",
    unitMps: "m/s",
  },

  "sample-buffer-latency": {
    sampleRate: "Frekvencija odabiranja",
    bufferSamples: "Veličina bafera",
    extraInMs: "Dodatno kašnjenje na ulazu (AD/drajver)",
    extraInMsHint: "Sa deklaracije interfejsa. Bez toga se ne pretpostavlja nula.",
    extraOutMs: "Dodatno kašnjenje na izlazu (DA/drajver)",
    extraOutMsHint: "Sa deklaracije interfejsa. Bez toga se ne pretpostavlja nula.",

    resultsBuffer: "Kašnjenje bafera",
    resultOneWayMs: "U jednom smeru (samo bafer)",
    resultBufferRoundTripMs: "U oba smera (samo bafer)",
    resultOneWayInMs: "U jednom smeru, ulaz",
    resultOneWayOutMs: "U jednom smeru, izlaz",
    resultRoundTripMs: "U oba smera, ukupno",
    theoreticalNote:
      "Ovo je teorijski minimum. Sigurnosni baferi drajvera i pomeraj USB/Thunderbolt prenosa se " +
      "ne izvode i ostaju van modela.",

    msToSamples: "Trajanje",
    msToSamplesHint:
      "U milisekundama. Poslednje uneto polje — ovo ili broj odbiraka — vodi računicu.",
    samplesInput: "Broj odbiraka",
    samplesInputHint: "Poslednje uneto polje — ovo ili trajanje — vodi računicu.",
    resultsConvert: "Odbirci i trajanje",
    resultSamples: "Odbiraka",
    wholeSamplesNote:
      "Trajanje ne pada tačno na granicu odbirka — prikazan je razlomljen broj, ne zaokružen.",
    resultMilliseconds: "Trajanje",

    inputs: "Uneseno",
    formula:
      "jednosmerno = bafer/frekvencija·1000     oba smera = 2·jednosmerno + dodatnoUlaz + " +
      "dodatnoIzlaz     odbirci = ms/1000·frekvencija     ms = odbirci/frekvencija·1000",

    errorSampleRate: "Frekvencija odabiranja je broj od 1000 do 768000 Hz.",
    errorBufferSamples: "Veličina bafera je ceo broj od 1 do 65536.",
    errorExtraInMs: "Dodatno kašnjenje na ulazu je broj od 0 do 100 ms.",
    errorExtraOutMs: "Dodatno kašnjenje na izlazu je broj od 0 do 100 ms.",
    errorMilliseconds: "Trajanje mora biti veće od nule.",
    errorSamples: "Broj odbiraka ne sme biti negativan.",

    unitMs: "ms",
    unitHz: "Hz",
    unitSamples: "odbiraka",
  },

  "scale-chord-speller": {
    root: "Osnovni ton",
    rootHint: "Slovo C–B, uz #, ##, b ili bb. Bez oktave.",
    kind: "Vrsta",
    kindScale: "Skala",
    kindChord: "Akord",
    scaleType: "Vrsta skale",
    scaleMajor: "Dur (jonski)",
    scaleNaturalMinor: "Prirodni mol (eolski)",
    scaleHarmonicMinor: "Harmonski mol",
    scaleMelodicMinor: "Melodijski mol (uzlazno)",
    scaleDorian: "Dorski",
    scalePhrygian: "Frigijski",
    scaleLydian: "Lidijski",
    scaleMixolydian: "Miksolidijski",
    scaleLocrian: "Lokrijski",
    scaleMajorPentatonic: "Dur pentatonika",
    scaleMinorPentatonic: "Mol pentatonika",
    scaleBlues: "Bluz",
    chordType: "Vrsta akorda",
    chordMaj: "dur",
    chordMin: "mol",
    chordDim: "umanjen",
    chordAug: "uvećan",
    chordSus2: "sus2",
    chordSus4: "sus4",
    chord6: "6",
    chordM6: "m6",
    chord7: "7 (dominantni)",
    chordMaj7: "maj7",
    chordM7: "m7",
    chordM7b5: "m7b5",
    chordDim7: "dim7",
    chord9: "9",
    chordM9: "m9",
    chordMaj9: "maj9",
    chord11: "11",
    chord13: "13",

    results: "Tonovi",
    colDegree: "Stupanj",
    colNote: "Ton",
    colSemitones: "Polustepeni od osnove",
    unspellableCell: "neispisivo",
    unspellableNote:
      "Neispisiv u ovom zapisu bez enharmonijske zamene — nije prikazan kao drugo ime.",

    keySignatureTitle: "Predznaci ključa",
    resultSharps: "Povisilica",
    resultFlats: "Snizilica",
    keyNone: "nema — skala nema svoj predznak",
    mixedNote: "Ovoj skali ne odgovara predznak ključa — mešoviti su predznaci, ispisani po tonu.",
    relativeNote: "Ovo je predznak matičnog dur tonaliteta, ne sopstveni predznak ove skale.",

    triadsTitle: "Trozvuci na stupnjevima",
    colTriadDegree: "Stupanj",
    colTriadNotes: "Tonovi",
    colTriadQuality: "Vrsta",
    qualityMajor: "dur",
    qualityMinor: "mol",
    qualityDiminished: "umanjen",
    qualityAugmented: "uvećan",
    qualityUnnamed: "bez imena",

    inputs: "Uneseno",
    formula:
      "pc = mod12(rootPc + polustepeni_i)     slovo_i = koren + korakSlova_i     predznak = " +
      "mod12(pc − prirodnaVK + 6) − 6     trozvuk: kvaliteti iz razmaka (4,3) dur, (3,4) mol, " +
      "(3,3) umanjen, (4,4) uvećan",

    errorRoot: "Osnovni ton nije prepoznat — slovo C–B, uz najviše dva #, ## ili b, bb.",
    errorScale: "Vrsta skale mora biti izabrana vrednost.",
    errorChord: "Vrsta akorda mora biti izabrana vrednost.",
  },

  "sound-wavelength": {
    entryKind: "Šta je uneto",
    entryFrequency: "Frekvencija",
    entryWavelength: "Talasna dužina",
    value: "Vrednost",
    temperature: "Temperatura vazduha",
    temperatureHint:
      "Podrazumevano 20 °C. Model je suv vazduh — vlažnost pomera brzinu zvuka za manje od 1 %.",
    distance: "Rastojanje",
    distanceHint: "Opciono — daje kašnjenje na tom rastojanju.",
    speedOverride: "Izmerena brzina zvuka",
    speedOverrideHint:
      "Opciono — zamenjuje model suvog vazduha, za onoga ko je izmerio svoju sredinu.",

    results: "Rezultat",
    resultSpeedOfSound: "Brzina zvuka",
    resultFrequency: "Frekvencija",
    resultWavelength: "Talasna dužina",
    resultWavelengthCm: "Talasna dužina (cm)",
    resultHalfWavelength: "Polovina talasne dužine",
    resultQuarterWavelength: "Četvrtina talasne dužine",
    resultDelayPerMetre: "Kašnjenje po metru",
    resultDelay: "Kašnjenje na rastojanju",

    inputs: "Uneseno",
    formula:
      "c(T) = 331,3·√(1 + T/273,15)     λ = c/f     f = c/λ     kašnjenje = rastojanje/c·1000",

    errorFrequency: "Frekvencija mora biti veća od nule.",
    errorWavelength: "Talasna dužina mora biti veća od nule.",
    errorTemperature: "Temperatura je broj od −50 do +60 °C.",
    errorDistance: "Rastojanje ne sme biti negativno.",
    errorSpeedOverride: "Izmerena brzina zvuka mora biti veća od nule.",

    unitM: "m",
    unitCm: "cm",
    unitMs: "ms",
    unitHz: "Hz",
    unitMps: "m/s",
    unitC: "°C",
  },

  "speaker-load": {
    cabinets: "Zvučnici",
    cabinetsHint:
      "Jedan red po zvučniku: impedansa;grupa. Grupa je obavezna samo za redno-paralelno " +
      "vezivanje, brojevi 1–8.",
    wiring: "Vezivanje",
    wiringParallel: "Paralelno",
    wiringSeries: "Redno",
    wiringSeriesParallel: "Redno-paralelno (po grupama)",
    power: "Snaga pojačavača u dobijeno opterećenje",
    powerHint: "Iz tabele snage pojačavača za dobijenu impedansu. Nikad se ne pretpostavlja.",
    minimumLoad: "Najmanja impedansa koju pojačavač trpi",
    minimumLoadHint:
      "Sa deklaracije tvog pojačavača. Nexus ne zna koji je to broj i ne nudi vrednost.",

    results: "Rezultat",
    resultTotalImpedance: "Ukupna impedansa",
    resultDriveVoltage: "Pogonski napon",
    colCabinet: "Zvučnik",
    colImpedance: "Impedansa",
    colShare: "Udeo snage (%)",
    colPower: "Snaga (W)",
    limitLabel: "Najmanja impedansa koju si uneo",
    ratioLabel: "Ukupna impedansa ÷ tvoja granica",
    modelNote:
      "Model je nominalna otporna impedansa sa deklaracije kutije, ne stvarna reaktivna kriva " +
      "zvučnika — koju niko ne može da otkuca.",

    inputs: "Uneseno",
    formula:
      "paralelno: 1/Zuk = Σ(1/Zᵢ)     redno: Zuk = ΣZᵢ     redno-paralelno: sabiranje unutar " +
      "grupe, pa paralelno preko grupa     V = √(P·Zuk)     paralelna grana: Pᵢ = V²/Zᵢ     " +
      "redna grana: Pᵢ = I²·Zᵢ, I = V/Zuk",

    errorCabinets: "Potreban je bar jedan i najviše 32 zvučnika.",
    errorImpedance: "Impedansa svakog zvučnika mora biti veća od nule.",
    errorGroup: "Grupa je obavezna za redno-paralelno vezivanje, ceo broj od 1 do 8.",
    errorPower: "Snaga mora biti veća od nule.",
    errorMinimumLoad: "Najmanja impedansa mora biti veća od nule.",

    unitOhm: "Ω",
    unitW: "W",
    unitV: "V",
    unitPercent: "%",
  },

  "spl-distance": {
    sensitivity: "Osetljivost",
    sensitivityReference: "Referenca osetljivosti",
    sensitivityReference1w: "1 W / 1 m",
    sensitivityReference283v: "2,83 V / 1 m",
    nominalImpedance: "Nominalna impedansa kutije",
    nominalImpedanceHint: "Obavezno kad je referenca 2,83 V — 2,83 V je 1 W samo na 8 Ω.",
    power: "Primenjena snaga",
    distance: "Rastojanje",
    referenceDistance: "Referentno rastojanje",
    referenceDistanceHint: "Podrazumevano 1 m — rastojanje na kome je osetljivost merena.",
    secondDistance: "Drugo rastojanje",
    secondDistanceHint: "Opciono — za razliku u odnosu na prvo rastojanje.",
    limit: "Granica nivoa koju si uneo",
    limitHint: "Iz propisa koji primenjuješ. Nexus ne zna koji je to propis i ne nudi vrednost.",

    results: "Rezultat",
    resultSensitivity1W: "Osetljivost svedena na 1 W/1 m",
    resultLevel: "Nivo na rastojanju",
    resultPowerTerm: "Doprinos snage",
    resultDistanceLoss: "Gubitak sa rastojanjem",
    resultSecondLevel: "Nivo na drugom rastojanju",
    resultSecondDifference: "Razlika između rastojanja",
    resultLimitDifference: "Razlika u dB",
    ratioLabel: "Odnos pritisaka",
    freeFieldNote:
      "Model je tačkasti izvor u slobodnom polju. Unutra reverberantno polje zaustavlja zakon " +
      "obrnutog kvadrata posle kritičnog rastojanja; usmerenost, sprega niza, apsorpcija vazduha " +
      "i kompresija snage kutije su van modela.",

    inputs: "Uneseno",
    formula:
      "SPL(d) = osetljivost + 10·log₁₀(P) − 20·log₁₀(d/dref)     razlika = −20·log₁₀(d2/d1)     " +
      "osetljivost_1W = osetljivost_2,83V − 10·log₁₀(8/Z)",

    errorSensitivity: "Osetljivost je broj od 70 do 120 dB SPL.",
    errorSensitivityReference: "Referenca osetljivosti mora biti izabrana vrednost.",
    errorNominalImpedance: "Nominalna impedansa mora biti veća od nule kad je referenca 2,83 V.",
    errorPower: "Primenjena snaga mora biti veća od nule.",
    errorDistance: "Rastojanje mora biti veće od nule.",
    errorReferenceDistance: "Referentno rastojanje mora biti veće od nule.",
    errorSecondDistance: "Drugo rastojanje mora biti veće od nule.",
    errorLimit: "Granica nivoa je broj od 0 do 140 dB.",

    unitDb: "dB",
  },

  transposition: {
    mode: "Vrsta unosa",
    modeText: "Tekst — tonovi i akordi bez oktave",
    modePitch: "Jedan ton sa oktavom",
    text: "Tekst",
    textHint:
      "Jedan ili više redova, do 5000 znakova. Razmaci i taktne crte (|) se čuvaju. Samo osnova " +
      "akorda i bas posle kose crte se transponuju — nastavak akorda (m7, sus4...) se prepisuje " +
      "bez izmene.",
    pitchName: "Ton",
    pitchNameHint: "Naučna notacija sa oktavom, npr. C4, Bb-1, F##3.",
    octaveShift: "Oktavni pomak",
    octaveShiftHint:
      "Podrazumevano 0. Za članove porodice pomerene za oktavu — kontrabasklarinet, bariton " +
      "saksofon i slično.",
    byKind: "Način transpozicije",
    byKindInterval: "Interval",
    byKindInstrument: "Par instrumenata",
    interval: "Interval",
    intervalUnison: "čista prima",
    intervalMinorSecond: "mala sekunda",
    intervalMajorSecond: "velika sekunda",
    intervalMinorThird: "mala terca",
    intervalMajorThird: "velika terca",
    intervalPerfectFourth: "čista kvarta",
    intervalAugmentedFourth: "uvećana kvarta",
    intervalDiminishedFifth: "umanjena kvinta",
    intervalPerfectFifth: "čista kvinta",
    intervalMinorSixth: "mala seksta",
    intervalMajorSixth: "velika seksta",
    intervalMinorSeventh: "mala septima",
    intervalMajorSeventh: "velika septima",
    intervalOctave: "oktava",
    direction: "Smer",
    directionUp: "Naviše",
    directionDown: "Naniže",
    instrument: "Instrument",
    instrumentBb: "B (in Bb)",
    instrumentA: "A (in A)",
    instrumentEbAlto: "Es alt/bariton (zvuči niže)",
    instrumentEbSopranino: "Es sopranino/kornet (zvuči više)",
    instrumentF: "F (in F)",
    instrumentDirection: "Smer",
    instrumentDirectionWrittenToSounding: "Zapisano → zvuči",
    instrumentDirectionSoundingToWritten: "Zvuči → zapisano",

    resultsText: "Transponovano",
    resultText: "Tekst",
    resultUnspellable: "Neispisivih tonova",
    unspellableNote:
      "Tonovi koji bi tražili više od dvostrukog predznaka ostaju zapisani kao u izvorniku.",

    resultsPitch: "Rezultat",
    resultName: "Nova nota",
    resultOctave: "Oktava",
    resultMidi: "MIDI broj",
    pitchUnspellableNote:
      "Traži više od dvostrukog predznaka — neispisivo bez enharmonijske zamene.",

    sourceKeyTitle: "Polazni tonalitet (opciono)",
    sourceKey: "Toničar",
    sourceKeyHint:
      "Bez oktave, npr. Es ili Fis. Samo kad je unet, prikazuje se dobijeni tonalitet.",
    sourceKeyMode: "Vrsta",
    sourceKeyModeMajor: "Dur",
    sourceKeyModeMinor: "Mol",
    enharmonicPreference: "Enharmonijsko pisanje rezultata",
    enharmonicSource: "Zadrži smer izvora",
    enharmonicSharps: "Radije povisilice",
    enharmonicFlats: "Radije snizilice",
    resultKeyTonic: "Dobijeni tonalitet",
    resultKeySharps: "Povisilica",
    resultKeyFlats: "Snizilica",
    keyUnspellableNote: "Dobijeni tonalitet nije moguće zapisati bez trostrukog predznaka.",

    inputs: "Uneseno",
    formula:
      "gore: novoSlovo = slovo + korakIntervala, novaVK = mod12(vk + polustepeni)     dole: " +
      "obrnuto     predznak = mod12(novaVK − prirodnaVK + 6) − 6     instrument: zapisano zvuči " +
      "niže ili više za interval instrumenta, zavisno od instrumenta",

    errorText: "Tekst mora imati od 1 do 5000 znakova.",
    errorInterval: "Interval mora biti izabrana vrednost.",
    errorDirection: "Smer mora biti izabrana vrednost.",
    errorInstrument: "Instrument mora biti izabrana vrednost.",
    errorName: "Ton nije prepoznat u naučnoj notaciji sa oktavom.",
    errorOctaveShift: "Oktavni pomak je ceo broj od −3 do +3.",
    errorTonic: "Toničar nije prepoznat.",
    errorMode: "Vrsta tonaliteta mora biti izabrana vrednost.",
    errorEnharmonicPreference: "Enharmonijsko pisanje mora biti izabrana vrednost.",
  },

  "varispeed-repitch": {
    entryKind: "Šta je uneto",
    entrySemitones: "Pomak u polustepenima",
    entryCents: "Pomak u centima",
    entryRatio: "Odnos brzine",
    entrySampleRates: "Par frekvencija odabiranja",
    value: "Vrednost",
    recordedAtHz: "Snimljeno na",
    playedBackAtHz: "Reprodukuje se na",
    recordedAtHzHint:
      "r = reprodukuje/snimljeno. Fajl snimljen na 48000 Hz pušten u sesiji od 44100 Hz je čest " +
      "studijski slučaj.",
    originalTempo: "Izvorni tempo",
    originalTempoHint: "Opciono — daje dobijeni tempo.",
    originalLength: "Izvorna dužina",
    originalLengthHint: "Opciono, u sekundama — daje dobijenu dužinu.",

    results: "Rezultat",
    resultRatio: "Odnos brzine",
    resultSemitones: "Pomak u polustepenima",
    resultCents: "Pomak u centima",
    resultTempo: "Dobijeni tempo",
    resultLength: "Dobijena dužina",
    resultLengthFormatted: "Dobijena dužina (mm:ss)",
    speedNote: "Visina i brzina idu zajedno — ovo je preuzorkovanje, ne vremensko rastezanje.",

    inputs: "Uneseno",
    formula:
      "r = 2^(polustepeni/12) = 2^(centi/1200) = reprodukuje/snimljeno     noviTempo = tempo·r   " +
      "  novaDužina = dužina/r",

    errorSemitones: "Pomak je broj od −48 do +48 polustepeni.",
    errorCents: "Pomak je broj od −12000 do +12000 centi.",
    errorRatio: "Odnos brzine mora biti veći od nule.",
    errorRecordedAtHz: "Frekvencija snimanja je broj od 1000 do 768000 Hz.",
    errorPlayedBackAtHz: "Frekvencija reprodukcije je broj od 1000 do 768000 Hz.",
    errorTempo: "Izvorni tempo je broj od 1 do 999 BPM.",
    errorLengthSeconds: "Izvorna dužina mora biti veća od nule.",

    unitSemitone: "polustepeni",
    unitCent: "centi",
    unitBpm: "BPM",
    unitS: "s",
    unitHz: "Hz",
  },
} as const;
