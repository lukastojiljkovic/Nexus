/**
 * „Fotografija i video" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment spells it. The
 * tool's NAME and its one-line blurb are not here — those live in a
 * different table another process owns.
 *
 * **Nothing in here judges.** Every tool in this pack is `riskClass: "none"`,
 * so none of them ever needed the „tvoja granica" phrasing `gradnja` uses —
 * there is no regulated limit in this pack for a value to sit beside.
 *
 * **A unit is copy, not a constant** — „mm", „m", „°" are written here rather
 * than concatenated in the surface.
 */
export const PRO_FOTO_SR = {
  "angle-of-view": {
    sensorWidth: "Širina senzora",
    sensorWidthHint: "Stvarna širina slikovnog polja senzora, ne naziv formata.",
    sensorHeight: "Visina senzora",
    focalLength: "Žižna daljina",
    subjectDistance: "Rastojanje do subjekta",
    subjectDistanceHint:
      "Opciono. Kad je uneto, prikazuje se i koliko kadar obuhvata na tom rastojanju.",

    results: "Rezultat",
    horizontal: "Vodoravni ugao",
    vertical: "Uspravni ugao",
    diagonal: "Dijagonalni ugao",
    sensorDiagonal: "Dijagonala senzora",
    fieldWidth: "Obuhvaćena širina",
    fieldHeight: "Obuhvaćena visina",
    fieldDiagonal: "Obuhvaćena dijagonala",
    modelNote:
      "Računato za pravolinijsku (gnomonsku) projekciju i objektiv fokusiran na beskonačno. " +
      "Riblje oko i makro rastojanja ne poštuju ovaj model.",

    inputs: "Uneseno",
    formula: "α = 2·arctg(d / 2f)     polje = D·d / f",

    errorSensorWidth: "Širina senzora mora biti između 0,5 i 200 mm.",
    errorSensorHeight: "Visina senzora mora biti između 0,5 i 200 mm.",
    errorFocalLength: "Žižna daljina mora biti između 0,5 i 5000 mm.",
    errorSubjectDistance: "Rastojanje do subjekta mora biti između 0,01 i 100000 m.",

    unitMm: "mm",
    unitM: "m",
    unitDeg: "°",
  },

  "crop-factor": {
    sensorWidth: "Širina senzora",
    sensorHeight: "Visina senzora",
    focalLength: "Žižna daljina",
    focalLengthHint: "Opciono — preračunava se u ekvivalent za format 135.",
    fNumber: "Otvor blende",
    fNumberHint: "Opciono, nezavisno od žižne daljine — preračunava se u ekvivalent za format 135.",

    results: "Rezultat",
    cropFactor: "Crop faktor",
    sensorDiagonal: "Dijagonala senzora",
    equivalentFocalLength: "Ekvivalentna žižna daljina (135)",
    equivalentAperture: "Ekvivalentna blenda (135)",
    apertureNote:
      "Ekvivalencija je po dubinskoj oštrini i ukupnoj količini svetla kroz otvor, ne po " +
      "ekspoziciji po površini — N·crop nije merni otvor blende.",

    inputs: "Uneseno",
    formula: "crop = 43,2666 mm / dijagonala     f' = f·crop     N' = N·crop",

    errorSensorWidth: "Širina senzora mora biti između 0,5 i 200 mm.",
    errorSensorHeight: "Visina senzora mora biti između 0,5 i 200 mm.",
    errorFocalLength: "Žižna daljina mora biti između 0,5 i 5000 mm.",
    errorFNumber: "Otvor blende mora biti između 0,5 i 256.",

    unitMm: "mm",
  },

  "depth-of-field": {
    focalLength: "Žižna daljina",
    fNumber: "Otvor blende",
    focusDistance: "Rastojanje fokusa",
    circleOfConfusion: "Krug rasipanja",
    circleOfConfusionHint:
      "Konvenciju gledanja biraš ti, ne alat — bez podrazumevane vrednosti. Pomoć ispod " +
      "predlaže broj koji možeš da preneseš ovde.",

    results: "Rezultat",
    hyperfocal: "Hiperfokalna daljina",
    nearLimit: "Bliža granica oštrine",
    farLimit: "Dalja granica oštrine",
    totalDepth: "Ukupna dubinska oštrina",
    infinite: "beskonačno",
    modelNote:
      "Model tankog sočiva, rastojanja od prednje glavne ravni. Krug rasipanja je vrednost " +
      "koju uneseš, ne izbor alata.",

    inputs: "Uneseno",
    formula: "H = f²/(N·c) + f     near = s·(H−f)/(H+s−2f)     far = s·(H−f)/(H−s)",

    helperTitle: "Pomoć: krug rasipanja iz dijagonale",
    helperHint:
      "Konvencija „dijagonala / delilac“ — jedna od više mogućih. Rezultat je predlog, ne " +
      "popunjava se sam u polje iznad.",
    helperDiagonal: "Dijagonala senzora",
    helperDivisor: "Delilac",
    helperResult: "Predloženi krug rasipanja",

    errorFocalLength: "Žižna daljina mora biti između 1 i 2000 mm.",
    errorFNumber: "Otvor blende mora biti između 0,5 i 256.",
    errorCircleOfConfusion: "Krug rasipanja mora biti između 0,001 i 0,2 mm.",
    errorFocusDistance:
      "Rastojanje fokusa mora biti veće od žižne daljine i unutar 0,01–100000 m.",
    errorHelperDiagonal: "Dijagonala senzora mora biti između 1 i 200 mm.",
    errorHelperDivisor: "Delilac mora biti između 200 i 5000.",

    unitMm: "mm",
    unitM: "m",
  },

  "diffraction-limit": {
    fNumber: "Otvor blende",
    wavelengthNm: "Talasna dužina",
    wavelengthNmHint:
      "Fizički izbor svetlosti koja se ispituje — uređivo, rezultat se menja s njom. 550 nm " +
      "je zeleno, polazna vrednost.",
    sensorWidth: "Širina senzora",
    pixelCount: "Broj piksela po širini",

    results: "Rezultat",
    pixelPitch: "Korak piksela",
    airyDiameter: "Prečnik Erijevog diska",
    ratio: "Disk ÷ korak piksela",
    fNumberAtOnePitch: "Blenda na kojoj je disk jednak koraku piksela",
    modelNote:
      "Alat ispisuje brojeve i ne izriče sud o oštrini — prag na kome difrakcija postaje " +
      "vidljiva je procena, ne veličina.",

    inputs: "Uneseno",
    formula: "korak = w/P     d = 2·(j₁₁/π)·λ·N     N₁ = korak / (2·(j₁₁/π)·λ)",

    errorFNumber: "Otvor blende mora biti između 0,5 i 256.",
    errorWavelengthNm: "Talasna dužina mora biti između 380 i 780 nm.",
    errorSensorWidth: "Širina senzora mora biti između 0,5 i 200 mm.",
    errorPixelCount: "Broj piksela mora biti ceo broj između 1 i 1000000.",

    unitMm: "mm",
    unitUm: "μm",
    unitNm: "nm",
  },

  "exposure-equivalent": {
    n1: "Referentna blenda N1",
    t1: "Referentno vreme zatvarača t1",
    s1: "Referentna osetljivost S1",
    shutterHint: "Sekunde ili oblik 1/x, na primer 1/125.",
    n2: "Ciljna blenda N2",
    targetHint:
      "Ostavi tačno jedno od tri ciljna polja prazno — ono se izračunava. Dva prazna ili sva " +
      "tri popunjena se odbijaju.",
    t2: "Ciljno vreme zatvarača t2",
    s2: "Ciljna osetljivost S2",

    results: "Rezultat",
    solvedField: "Izračunato polje",
    referenceEv100: "EV pri ISO 100 (referenca)",
    targetEv100: "EV pri ISO 100 (cilj)",
    givenShiftStops: "Pomak unetih ciljnih polja (blende)",
    solvedMarker: "— izračunato —",

    inputs: "Uneseno",
    formula: "N²/(t·S) = const     EV100 = log2(N²/t) − log2(S/100)",

    errorReferenceFNumber: "Referentna blenda mora biti između 0,5 i 256.",
    errorReferenceShutter: "Referentno vreme zatvarača mora biti između 1 μs i 3600 s.",
    errorReferenceIso: "Referentna osetljivost mora biti između 6 i 4194304 ISO.",
    errorTargetFNumber: "Ciljna blenda mora biti između 0,5 i 256.",
    errorTargetShutter: "Ciljno vreme zatvarača mora biti između 1 μs i 3600 s.",
    errorTargetIso: "Ciljna osetljivost mora biti između 6 i 4194304 ISO.",
    errorTargets: "Tačno jedno od tri ciljna polja mora ostati prazno.",

    unitS: "s",
  },

  "flash-guide-number": {
    guideNumber: "Vodeći broj (pri ISO 100)",
    guideNumberHint:
      "Sa uputstva tvog blica, za određen položaj zum-glave i reflektor — dva vodeća broja " +
      "istog blica pri drugom zumu nisu ista veličina.",
    guideNumberUnit: "Jedinica vodećeg broja",
    distance: "Rastojanje blic–subjekt",
    iso: "Osetljivost",
    secondDistance: "Drugo rastojanje",
    secondDistanceHint: "Opciono — za poređenje osvetljenja između dva rastojanja.",

    results: "Rezultat",
    guideNumberAtIso: "Vodeći broj pri unetom ISO",
    fNumber: "Potrebna blenda",
    secondFNumber: "Blenda na drugom rastojanju",
    distanceStops: "Promena osvetljenja (blende)",
    modelNote:
      "Model je goli tačkasti izvor u slobodnom prostoru. Reflektori, modifikatori, zum-glava i " +
      "odbijena svetlost menjaju stvarni broj — vodeći broj je tvoj, alat ga ne bira i ne " +
      "proverava.",

    inputs: "Uneseno",
    formula: "N = GN_S / d     GN_S = GN₁₀₀·√(S/100)     Δstops = 2·log2(d₂/d₁)",

    errorGuideNumber: "Vodeći broj mora biti između 1 i 200 (u unetoj jedinici).",
    errorDistance: "Rastojanje mora biti između 0,05 i 200 m.",
    errorIso: "Osetljivost mora biti između 6 i 4194304 ISO.",
    errorSecondDistance: "Drugo rastojanje mora biti između 0,05 i 200 m.",

    unitM: "m",
    unitFt: "ft",
  },

  "frame-rate-conform": {
    captureFps: "Brzina snimanja",
    timelineFps: "Brzina tajmlajna",
    fpsHint:
      "Kadrova u sekundi. Za NTSC brzine piši decimalni zarez (23,976 — ne tačku, koja se " +
      "čita kao razdvajač hiljada).",
    sourceDuration: "Dužina snimka (sekunde)",
    clipLengthHint: "Ostavi prazno ako umesto toga unosiš broj kadrova ispod.",
    frameCount: "Broj kadrova",
    slowMotionFactor: "Ciljni faktor usporenja",
    slowMotionFactorHint:
      "Opciono — koliko puta sporije od realnog vremena. 5 znači pet puta sporije, i traži " +
      "brzinu snimanja umesto da je pretpostavi.",

    results: "Rezultat",
    speedPercent: "Brzina reprodukcije",
    speedFactor: "Brzina reprodukcije (faktor)",
    conformedDuration: "Konformisano trajanje",
    drift: "Pomeraj u odnosu na original",
    requiredCaptureFps: "Potrebna brzina snimanja",
    modelNote: "Konform ne menja broj kadrova — menja se samo trajanje na tajmlajnu.",

    inputs: "Uneseno",
    formula: "Nf = round(fps_snim·L)     brzina = fps_tajml/fps_snim     trajanje' = Nf/fps_tajml",

    errorCaptureFps: "Brzina snimanja mora biti između 0,1 i 10000 fps.",
    errorTimelineFps: "Brzina tajmlajna mora biti između 0,1 i 10000 fps.",
    errorSourceDuration: "Dužina snimka mora biti između 0,001 i 864000 s.",
    errorFrameCount: "Broj kadrova mora biti ceo broj između 1 i 100000000.",
    errorSlowMotionFactor: "Ciljni faktor usporenja mora biti između 0,01 i 100.",
    errorClipLength: "Unesi tačno jedno od dužine snimka ili broja kadrova.",

    unitS: "s",
    unitFps: "fps",
  },

  "illuminance-to-aperture": {
    illuminance: "Osvetljenost",
    unit: "Jedinica",
    iso: "Osetljivost",
    isoShutterHint: "Potrebno samo za blendu ispod — pretvaranje lx ↔ fc ne zavisi od njih.",
    shutter: "Vreme zatvarača",
    calibrationConstant: "Konstanta kalibracije merača C",
    calibrationConstantHint:
      "Sa uputstva tvog svetlomera — oko 250 za ravan prijemnik, oko 340 za poluloptasti. " +
      "Nexus ne bira ovu vrednost i ne nudi podrazumevanu.",

    results: "Rezultat",
    lux: "Luks",
    footCandles: "Fut-kandele",
    fNumber: "Potrebna blenda",
    nearestThirdStop: "Najbliža trećinska oznaka",
    modelNote:
      "Jednačina je za upadnu (incident) meru, ravan ili poluloptasti prijemnik — konstanta K " +
      "za reflektovanu meru je druga veličina i ovde se ne prihvata. Alat pretvara jedinice i " +
      "računa blendu; ne izriče sud o osvetljenju prostora.",

    inputs: "Uneseno",
    formula: "1 fc = 10,763910417 lx     N = √(E·S·t / C)",

    errorIlluminance: "Osvetljenost mora biti između 0,001 i 1000000.",
    errorCalibrationConstant: "Konstanta kalibracije mora biti između 100 i 800.",
    errorIso: "Osetljivost mora biti između 6 i 4194304 ISO.",
    errorShutter: "Vreme zatvarača mora biti između 1 μs i 3600 s.",

    unitLx: "lx",
    unitFc: "fc",
  },

  "mired-shift": {
    sourceTemperature: "Izvorna temperatura boje",
    targetTemperature: "Ciljna temperatura",
    targetTemperatureHint:
      "Koliko su dve temperature udaljene u miredima — koristi ovo ili pomak ispod.",
    shift: "Mired pomak",
    shiftHint:
      "Gde pomak od unetog broja mireda dovodi izvornu temperaturu. Negativno hladi, pozitivno " +
      "greje.",

    results: "Rezultat",
    sourceMired: "Izvor u miredima",
    resultMired: "Rezultat u miredima",
    resultTemperature: "Rezultujuća temperatura",

    inputs: "Uneseno",
    formula: "M = 10⁶/T     ΔM = M₂ − M₁     T' = 10⁶/(M₁ + ΔM)",

    errorSourceTemperature: "Izvorna temperatura mora biti između 1000 i 40000 K.",
    errorTargetTemperature: "Ciljna temperatura mora biti između 1000 i 40000 K.",
    errorShift: "Mired pomak mora biti između −500 i 500.",
    errorTarget: "Unesi ciljnu temperaturu ili mired pomak.",

    unitMired: "MK⁻¹",
    unitK: "K",
  },

  "motion-blur": {
    speed: "Brzina subjekta",
    speedUnit: "Jedinica brzine",
    subjectDistance: "Rastojanje do subjekta",
    focalLength: "Žižna daljina",
    shutter: "Vreme zatvarača",
    shutterHint: "Ostavi prazno da se izračuna vreme zatvarača za dozvoljeno zamućenje ispod.",
    sensorWidth: "Širina senzora",
    pixelCount: "Broj piksela po širini",
    acceptableBlurPixels: "Dozvoljeno zamućenje",
    acceptableBlurPixelsHint: "Koristi se samo kada je polje vremena zatvarača prazno.",

    results: "Rezultat",
    blurMillimetres: "Zamućenje na senzoru",
    blurPixels: "Zamućenje u pikselima",
    solvedShutter: "Potrebno vreme zatvarača",
    modelNote:
      "Model tankog sočiva, rastojanje od prednje glavne ravni, kretanje popreko na optičku " +
      "osu. Kretanje ka kameri menja veličinu, ne položaj, i nije obuhvaćeno.",
    roundingNote:
      "Imenilac je zaokružen NAGORE, na brži zatvarač — ispisana vrednost nikad ne dopušta " +
      "više zamućenja nego što je traženo.",

    inputs: "Uneseno",
    formula: "Δx = v·t     dSlike = Δx·f/(D−f)     blurPx = dSlike·P/w",

    errorFocalLength: "Žižna daljina mora biti između 0,5 i 5000 mm.",
    errorSensorWidth: "Širina senzora mora biti između 0,5 i 200 mm.",
    errorPixelCount: "Broj piksela mora biti ceo broj između 1 i 1000000.",
    errorSubjectDistance: "Rastojanje mora biti veće od žižne daljine i unutar 0,05–100000 m.",
    errorSpeed: "Brzina mora biti veća od nule i unutar dozvoljenog opsega.",
    errorShutter: "Vreme zatvarača mora biti između 1 μs i 3600 s.",
    errorAcceptableBlurPixels: "Dozvoljeno zamućenje mora biti između 0,1 i 1000 px.",
    errorMode: "Unesi vreme zatvarača ili dozvoljeno zamućenje.",

    unitMm: "mm",
    unitM: "m",
    unitS: "s",
    unitMs: "m/s",
    unitKmh: "km/h",
  },

  "nd-filter-exposure": {
    baseShutter: "Vreme zatvarača bez filtera",
    shutterHint: "Sekunde ili oblik 1/x, na primer 1/125.",
    filterSlot: "Filter",
    slotHint:
      "Unesi tačno jedno od tri polja po filteru — blende, gustinu ili faktor. Prazan filter " +
      "se ne računa u niz. Spisak filtera postoji samo dok je ekran otvoren.",
    stops: "Blende",
    density: "Optička gustina D",
    factor: "Faktor F",

    results: "Rezultat",
    shutter: "Vreme ekspozicije posle filtera",

    inputs: "Uneseno",
    formula: "stops = Σ stopsᵢ     F = 2^stops     D = stops·log10(2)     t' = t·F",

    errorBaseShutter: "Vreme zatvarača bez filtera mora biti između 1 μs i 3600 s.",
    errorFilters: "Unesi bar jedan filter.",
    errorFilterForm: "Unesi tačno jedno od blendi, gustine ili faktora po filteru.",
    errorStops: "Blende po filteru moraju biti između 0 i 24.",
    errorDensity: "Optička gustina po filteru mora biti između 0 i 7,5.",
    errorFactor: "Faktor po filteru mora biti između 1 i 16777216.",

    unitS: "s",
  },

  "pq-nits": {
    signal: "Normalizovani PQ signal",
    targetHint:
      "Unesi tačno jedno od signala, kod-vrednosti ili luminancije — preostala dva se " +
      "izračunavaju iz njega.",
    code: "Kod-vrednost",
    luminance: "Luminancija",
    range: "Opseg",
    rangeNarrow: "Sužen (video)",
    rangeFull: "Pun",
    bitDepth: "Bitna dubina",

    results: "Rezultat",
    codeNarrow: "Kod (sužen opseg)",
    codeFull: "Kod (pun opseg)",
    modelNote:
      "Alat prevodi brojeve po ST 2084 krivoj i ne tvrdi ništa o tome da li je neki materijal " +
      "usklađen sa bilo kojim standardom isporuke.",

    inputs: "Uneseno",
    formula: "Y = 10000·(max(N^(1/m2)−c1,0)/(c2−c3·N^(1/m2)))^(1/m1)",

    errorSignal: "PQ signal mora biti između 0 i 1.",
    errorLuminance: "Luminancija mora biti između 0 i 10000 cd/m².",
    errorCode: "Kod-vrednost mora biti ceo broj u opsegu za izabranu dubinu i opseg.",
    errorTarget: "Unesi tačno jedno od signala, kod-vrednosti ili luminancije.",

    unitNits: "cd/m²",
  },

  "raster-image-size": {
    width: "Širina",
    height: "Visina",
    channels: "Broj kanala",
    channelsHint: "1 sivi tonovi, 3 RGB, 4 RGBA, više za dopunske kanale.",
    bitDepth: "Bitna dubina po kanalu",
    layers: "Broj slojeva ili kadrova",
    capacityValue: "Dostupan prostor",
    capacityHint: "Opciono — koliko ovakvih fajlova staje na dati prostor.",
    capacityUnit: "Jedinica prostora",
    averageFileSizeMb: "Poznata prosečna veličina fajla (MB)",
    averageFileSizeMbHint:
      "Opciono — koristi se umesto izračunate veličine pri brojanju koliko staje.",

    results: "Rezultat",
    bytes: "Bajtova",
    megabytes: "Megabajta",
    mebibytes: "Mebibajta",
    gigabytes: "Gigabajta",
    gibibytes: "Gibibajta",
    filesThatFit: "Koliko ovakvih fajlova staje",
    modelNote:
      "Ovo je veličina samih piksel-podataka, bez zaglavlja kontejnera, minijatura i bilo " +
      "kakve kompresije — nije predviđanje veličine RAW ili JPEG fajla.",

    inputs: "Uneseno",
    formula: "bajtovaPoRedu = ⌈širina·kanala·dubina/8⌉     bajtova = bajtovaPoRedu·visina·slojeva",

    errorWidth: "Širina mora biti ceo broj između 1 i 1000000 px.",
    errorHeight: "Visina mora biti ceo broj između 1 i 1000000 px.",
    errorChannels: "Broj kanala mora biti ceo broj između 1 i 16.",
    errorBitDepth: "Bitna dubina mora biti 1, 8, 16 ili 32.",
    errorLayers: "Broj slojeva mora biti ceo broj između 1 i 10000.",
    errorCapacity: "Dostupan prostor mora biti veći od nule.",
    errorAverageFileSizeMb: "Prosečna veličina fajla mora biti veća od nule.",

    unitMb: "MB",
    unitMib: "MiB",
    unitGb: "GB",
    unitGib: "GiB",
  },

  "smpte-timecode": {
    rate: "Brzina kadrova",
    rate23976: "23,976",
    rate24: "24",
    rate25: "25",
    rate2997Ndf: "29,97 (bez ispuštanja)",
    rate2997Df: "29,97 (sa ispuštanjem)",
    rate30: "30",
    rate50: "50",
    rate5994Ndf: "59,94 (bez ispuštanja)",
    rate5994Df: "59,94 (sa ispuštanjem)",
    rate60: "60",
    operation: "Radnja",
    operationAdd: "Sabiranje",
    operationSubtract: "Oduzimanje",

    timecodeA: "Tajmkod A",
    timecodeB: "Tajmkod B ili broj kadrova",
    timecodeBHint:
      "Opciono. Ako je tajmkod B popunjen, koristi se on; u suprotnom broj kadrova ispod. " +
      "Kad ništa od ovoga nije uneto, prikazuje se samo pretvaranje tajmkoda A.",
    hours: "Sati",
    minutes: "Minuti",
    seconds: "Sekunde",
    frames: "Kadrovi",
    frameCountB: "Broj kadrova (umesto tajmkoda B)",

    results: "Rezultat",
    timecodeHours: "Sati (oznaka)",
    timecodeMinutes: "Minuti (oznaka)",
    timecodeSeconds: "Sekunde (oznaka)",
    timecodeFrames: "Kadrovi (oznaka)",
    elapsedSeconds: "Stvarno proteklo vreme",
    realSeconds: "Stvarno proteklo vreme",
    nominalSeconds: "Nominalno vreme (čitanje oznake)",
    driftSeconds: "Odstupanje oznake od stvarnog vremena",
    wrapNote:
      "Oznaka je prikazana na 24-časovnom brojaču (24:00:00;00 postaje 00:00:00;00) — broj " +
      "kadrova iz polja „Kadrovi“ iznad je pravi, neomotan zbir.",

    inputs: "Uneseno",
    formula:
      "slike = ((H·60+M)·60+S)·N + F     drop-frame oduzima D·(minuti − ⌊minuti/10⌋) po ST 12-1",

    errorHours: "Sati moraju biti ceo broj između 0 i 23.",
    errorMinutes: "Minuti moraju biti ceo broj između 0 i 59.",
    errorSeconds: "Sekunde moraju biti ceo broj između 0 i 59.",
    errorFrames: "Kadrovi moraju biti ceo broj manji od nominalne brzine.",
    errorDroppedLabel: "Ova oznaka ne postoji u drop-frame notaciji na izabranoj brzini.",
    errorOperand: "Unesi tajmkod B ili broj kadrova, ne oba istovremeno kao dva odvojena uslova.",
    errorOperandFrames: "Broj kadrova mora biti ceo broj u opsegu jednog 24-časovnog kruga.",

    unitS: "s",
  },

  "timelapse-planner": {
    interval: "Interval između kadrova",
    fps: "Brzina tajmlajna",
    clipLength: "Dužina klipa",
    targetHint: "Ostavi tačno jedno od dužine klipa, trajanja snimanja ili broja kadrova prazno.",
    shootingDuration: "Trajanje snimanja",
    frameCount: "Broj kadrova",
    shutter: "Vreme zatvarača po kadru",
    shutterHint: "Opciono — samo se poredi sa intervalom, bez preporuke.",

    results: "Rezultat",
    speedUpFactor: "Faktor ubrzanja",
    shutterOverIntervalRatio: "Zatvarač ÷ interval",
    fencepostNote: "N kadrova na intervalu i pokriva (N − 1) intervala, ne N.",

    inputs: "Uneseno",
    formula: "Nf = round(L·fps)     T = (Nf − 1)·i     L = Nf/fps     ubrzanje = i·fps",

    errorInterval: "Interval mora biti između 0,05 i 86400 s.",
    errorClipLength: "Dužina klipa mora biti između 0,04 i 86400 s.",
    errorShootingDuration: "Trajanje snimanja mora biti između 1 i 8640000 s.",
    errorFrameCount: "Broj kadrova mora biti ceo broj između 1 i 1000000.",
    errorShutter: "Vreme zatvarača mora biti između 1 μs i 3600 s.",
    errorTarget: "Unesi tačno jedno od dužine klipa, trajanja snimanja ili broja kadrova.",

    unitS: "s",
  },

  "video-bitrate-storage": {
    videoBitrateMbps: "Video bitrejt",
    audioBitrateMbps: "Audio bitrejt",
    duration: "Trajanje",
    targetHint: "Ostavi tačno jedno od trajanja, veličine fajla ili kapaciteta prazno.",
    sizeValue: "Veličina fajla",
    sizeUnit: "Jedinica veličine",
    capacityGb: "Kapacitet kartice ili diska (GB, kao na deklaraciji)",
    cardCount: "Broj kartica ili kopija",

    results: "Rezultat",
    totalBitrateMbps: "Ukupan bitrejt",
    gigabytes: "Gigabajta",
    gibibytes: "Gibibajta",
    recordableSecondsPerCard: "Vreme snimanja po kartici",
    recordableSecondsTotal: "Ukupno vreme snimanja (sve kartice)",
    modelNote:
      "Čista aritmetika bitrejta — ne obuhvata zaglavlja kontejnera ni promenljiv bitrejt. " +
      "Oba načina brojanja bajtova (GB i GiB) prikazana su jedno pored drugog.",

    inputs: "Uneseno",
    formula:
      "ukupno = video + audio     bajtova = ukupno·trajanje/8     trajanje = bajtova·8/ukupno",

    errorVideoBitrateMbps: "Video bitrejt mora biti između 0,01 i 20000 Mbit/s.",
    errorAudioBitrateMbps: "Audio bitrejt mora biti između 0 i 100 Mbit/s.",
    errorCardCount: "Broj kartica mora biti ceo broj između 1 i 1000.",
    errorDuration: "Trajanje mora biti između 0,04 i 864000 s.",
    errorSize: "Veličina fajla mora biti veća od nule.",
    errorCapacityGb: "Kapacitet mora biti između 0,001 i 1000000 GB.",
    errorTarget: "Unesi tačno jedno od trajanja, veličine fajla ili kapaciteta.",

    unitS: "s",
    unitMbps: "Mbit/s",
    unitGb: "GB",
    unitGib: "GiB",
  },
} as const;
