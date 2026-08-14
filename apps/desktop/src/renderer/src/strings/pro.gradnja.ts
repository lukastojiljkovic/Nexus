/**
 * „Gradnja i projektovanje" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those live
 * in the `name` and `blurb` tables of `./pro.ts`, because the drawer's rail
 * needs them before any surface is opened.
 *
 * **A unit is copy, not a constant.** „mm" and „m" are written here rather than
 * concatenated in the surface, so the day this table has a second locale the
 * units move with it — and because a unit hard-coded in a component is a string
 * `check:strings` cannot see and a translator cannot find.
 *
 * **Nothing in here judges.** Every tool in this pack that touches a load, a
 * height or a fall is `life-safety`, so its copy may name a quantity and may
 * name the user's own limit, and may not say what the two mean together
 * (`toolForbidsVerdict`). Where a limit appears below it is always „granica koju
 * si uneo" — whose it is, said in the label.
 */
export const PRO_GRADNJA_SR = {
  "stair-geometry": {
    rise: "Spratna visina",
    riseHint: "Od gotovog poda do gotovog poda, u milimetrima.",
    risers: "Broj visina stepenika",
    risersHint:
      "Broj podizanja, ne broj gazišta — gazišta ima jedno manje kad krak izlazi u ravan poda.",
    going: "Gazište",
    goingHint: "Dubina gazišta u milimetrima.",
    top: "Izlaz kraka",
    topFlush: "U ravan gornjeg poda",
    topLanding: "Na podest u nivou poslednjeg podizanja",
    riserLimit: "Granična visina stepenika koju si uneo",
    goingLimit: "Granično gazište koje si uneo",
    limitHint: "Iz propisa koji primenjuješ. Nexus ne zna koji je to propis i ne nudi vrednost.",
    roundTo: "Korak zaokruživanja",
    roundToHint: "Na koliko se visina stepenika iscrtava na letvi. Podrazumevano 1 mm.",

    results: "Rezultat",
    riser: "Visina stepenika",
    goings: "Broj gazišta",
    run: "Ukupan hod",
    pitch: "Nagib",
    blondel: "2r + g",
    blondelNote:
      "Blondelov izraz iz 1675. je definisana veličina, ne propis — prikazuje se kao broj i ne " +
      "poredi se ni sa čim.",
    ratio: "Odnos prema tvojoj granici",
    riserRatio: "Visina ÷ tvoja granica",
    goingRatio: "Gazište ÷ tvoja granica",

    /**
     * The flight as it will actually be set out. Named „zaokruženo" rather than
     * „stvarno" on purpose: both numbers are real, and calling this one the real
     * one would say the exact riser above it was a draft.
     */
    rounded: "Zaokruženo na letvi",
    roundedRiser: "Zaokružena visina stepenika",
    roundedRise: "Dobijena spratna visina",
    remainder: "Ostatak na poslednjem stepeniku",
    /**
     * What the remainder IS, said as arithmetic. Not „pazi" and not „greška":
     * the number is the finding, and what to do with it — razvući ga, promeniti
     * broj podizanja, pomeriti kotu poda — is the designer's posao.
     */
    remainderNote:
      "Razlika između tražene i dobijene spratne visine. Ceo iznos pada na jedan stepenik, " +
      "obično poslednji uz gornji pod.",

    inputs: "Uneseno",
    formula: "r = H / n     θ = arctg(r / g)     B = 2r + g",

    /**
     * The refusals, keyed by the `reason` the core function returns. A surface
     * never composes its own: `stairFlight` names the input that made the answer
     * impossible, and this table is the only place that name becomes a sentence.
     */
    errorRise: "Spratna visina mora biti veća od nule.",
    errorRisers: "Broj visina stepenika je ceo broj od 1 do 60.",
    errorGoing: "Gazište mora biti veće od nule.",
    errorRoundTo: "Korak zaokruživanja mora biti veći od nule.",

    unitMm: "mm",
    unitM: "m",
    unitDeg: "°",
  },

  "angle-units": {
    unit: "Ulazna jedinica",
    unitDmsOpt: "Stepeni, minuti, sekunde",
    unitDegOpt: "Decimalni stepen",
    unitGonOpt: "Gon",
    unitRadOpt: "Radijan",
    sign: "Predznak",
    signPos: "Pozitivan",
    signNeg: "Negativan",
    degrees: "Stepeni",
    minutes: "Minuti",
    seconds: "Sekunde",
    value: "Vrednost ugla",
    normalize: "Svođenje na pun krug",
    normalizeHint: "Svedena vrednost se prikazuje uvek, i kad je ovo isključeno.",
    normalizeYes: "Uključeno",
    normalizeNo: "Isključeno",

    results: "Rezultat",
    resultDms: "Stepeni-minuti-sekunde",
    resultDeg: "Decimalni stepen",
    resultGon: "Gon",
    resultRad: "Radijan",
    resultNormDeg: "Svedeno na [0, 360)",
    resultNormGon: "Svedeno na [0, 400) gon",
    resultOppDeg: "Suprotan smer",
    resultOppGon: "Suprotan smer (gon)",

    inputs: "Uneseno",
    formula:
      "DMS: |x| = D + M/60 + S/3600     ° → rad: x·π/180     gon → rad: x·π/200     svođenje: x " +
      "− k·krug",

    errorDegrees: "Stepeni moraju biti nula ili više.",
    errorMinutes: "Minuti su broj u [0, 60).",
    errorSeconds: "Sekunde su broj u [0, 60).",
    errorValue: "Vrednost ugla mora biti realan broj.",

    unitDeg: "°",
    unitGon: "gon",
  },

  "bar-spacing": {
    length: "Ukupna dužina",
    lengthUnit: "Jedinica dužine",
    startCover: "Odstojanje od početka",
    endCover: "Odstojanje od kraja",
    mode: "Način zadavanja",
    modeMaxSpacing: "Najveći razmak",
    modeCount: "Zadat broj komada",
    modeMaxGap: "Najveći svetli razmak (ispuna)",
    maxSpacing: "Najveći razmak koji si uneo",
    maxGap: "Najveći svetli razmak koji si uneo",
    limitHint: "Iz propisa koji primenjuješ. Nexus ne zna koji je to propis i ne nudi vrednost.",
    countLabel: "Broj komada",
    layout: "Raspored",
    layoutEnds: "Komadi i na oba kraja",
    layoutField: "Komadi u sredini polja",
    pieceWidth: "Širina jednog komada",
    pieceWidthHint: "Opciono — potrebna za osovinski korak, obavezna za način sa svetlim razmakom.",

    results: "Rezultat",
    count: "Broj komada",
    spaces: "Broj razmaka",
    spacing: "Stvarni razmak",
    spacingRatio: "Razmak ÷ tvoja granica",
    usableLength: "Korisna dužina",
    axisPitch: "Osovinski korak",
    positions: "Pozicije od početka",

    inputs: "Uneseno",
    formula:
      "U = L − e₁ − e₂     k = ceil(U/s_max), n = k+1 (oba kraja)     n = ceil(U/s_max) (sredina " +
      "polja)     n = ceil((U−g)/(w+g)) (ispuna)     s = U/k ili U/n",

    errorLength: "Ukupna dužina mora biti veća od nule.",
    errorStartCover: "Odstojanje od početka ne sme biti negativno.",
    errorEndCover: "Odstojanje od kraja ne sme biti negativno.",
    errorUsableLength: "Korisna dužina (L − e₁ − e₂) mora biti veća od nule.",
    errorCount: "Broj komada mora biti ceo broj u dozvoljenom opsegu za izabrani raspored.",
    errorMaxSpacing: "Najveći razmak mora biti veći od nule.",
    errorPieceWidth: "Širina komada mora biti veća od nule.",
    errorMaxGap: "Najveći svetli razmak nije moguće ostvariti sa unetom širinom komada i dužinom.",

    unitM: "m",
    unitMm: "mm",
  },

  "beam-check": {
    scheme: "Statička šema",
    schemeSimpleUdl: "Prosta greda, jednako podeljeno opterećenje",
    schemeSimplePoint: "Prosta greda, sila u sredini",
    schemeCantileverUdl: "Konzola, jednako podeljeno opterećenje",
    schemeCantileverPoint: "Konzola, sila na kraju",
    span: "Raspon ili prepust L",
    load: "Opterećenje q",
    force: "Sila P",
    modulus: "Modul elastičnosti E",
    modulusHint: "Svojstvo materijala. Bez njega se ugib ne prikazuje.",
    inertiaMode: "Moment inercije preseka",
    inertiaModeDirect: "Unet direktno",
    inertiaModeSection: "Iz pravougaonog preseka b × h",
    inertia: "Moment inercije I",
    width: "Širina preseka b",
    widthHint: "Dimenzija poprečno na ravan savijanja.",
    height: "Visina preseka h",
    heightHint: "Dimenzija u ravni savijanja. Zamena sa širinom menja I kubno.",
    sectionModulus: "Otporni moment W",
    sectionModulusHint: "Opciono, kad presek nije pravougaon. Bez njega se napon ne prikazuje.",
    stressLimit: "Granični napon koji si uneo",
    deflectionRatioLimit: "Granični odnos L/f koji si uneo",
    limitHint: "Iz propisa koji primenjuješ. Nexus ne zna koji je to propis i ne nudi vrednost.",

    results: "Rezultat",
    reaction: "Reakcija oslonca",
    shear: "Maksimalna transverzalna sila",
    maxMoment: "Maksimalni moment savijanja",
    fixingMoment: "Moment uklještenja",
    stress: "Napon savijanja σ = M/W",
    stressRatio: "Napon ÷ tvoja granica",
    deflection: "Maksimalni ugib f",
    spanOverDeflection: "Odnos L/f",
    deflectionRatio: "Tvoja granica L/f ÷ L/f",

    inputs: "Uneseno",
    formula:
      "prosta+UDL: R=qL/2, M=qL²/8, f=5qL⁴/384EI     prosta+sila: R=P/2, M=PL/4, f=PL³/48EI     " +
      "konzola+UDL: R=qL, M=qL²/2, f=qL⁴/8EI     konzola+sila: R=P, M=PL, f=PL³/3EI",

    errorSpan: "Raspon ili prepust mora biti veći od nule.",
    errorLoad: "Opterećenje ne sme biti negativno.",
    errorForce: "Sila ne sme biti negativna.",
    errorModulus: "Modul elastičnosti mora biti veći od nule.",
    errorSection: "Širina i visina preseka moraju biti veće od nule.",
    errorSectionModulus: "Otporni moment mora biti veći od nule.",
    errorInertia: "Moment inercije mora biti veći od nule.",

    unitKn: "kN",
    unitKnm: "kNm",
    unitKnm2: "kN/m",
    unitMpa: "MPa",
    unitMm: "mm",
    unitM: "m",
  },

  "concrete-takeoff": {
    kind: "Tip elementa",
    kindSlab: "Ploča (a × b × d)",
    kindBeam: "Greda (b × h × L)",
    kindColumn: "Stub (a × b × h)",
    kindStripFooting: "Trakasti temelj (b × h × L)",
    kindPadFooting: "Temelj samac (a × b × h)",
    a: "Dimenzija a",
    b: "Dimenzija b",
    d: "Debljina d",
    h: "Visina h",
    length: "Dužina L",
    pieces: "Broj komada",
    openings: "Odbitak otvora",
    openingsHint:
      "Ukupna površina otvora u ploči. Umanjuje zapreminu, ne i oplatu — otvor se opšalva sa " +
      "strane.",
    waste: "Rastur",
    wasteHint: "Zavisi od gradilišta i načina ugradnje.",
    mixerVolume: "Zapremina mešalice",
    density: "Gustina betona",
    densityHint: "Materijalni podatak korisnikove mešavine.",
    rebarRate: "Količina armature po m³",
    rebarRateHint: "Projektni podatak. Masa armature se računa iz neto zapremine, bez rastura.",

    results: "Rezultat",
    netVolume: "Neto zapremina",
    grossVolume: "Zapremina sa rasturom",
    formwork: "Površina oplate",
    formworkNote:
      "Greda ispod ploče: oplata (2h + b)·L broji dve bočne strane i sopstveni plafon grede u " +
      "celini — ako je taj plafon deo trake koju već broji ploča, ne dodavati ga i tamo.",
    concreteMass: "Masa betona",
    rebarMass: "Masa armature",
    batches: "Broj tura mešalice",

    inputs: "Uneseno",
    formula:
      "ploča: V=(a·b−ΣA_otv)·d·n, opl=(a·b+2(a+b)d)·n     greda: V=bhLn, opl=(2h+b)Ln     " +
      "stub/samac: V=abhn, opl=2(a+b)hn     traka: V=bhLn, opl=2hLn     V_rastur=V·(1+r/100)",

    errorPieces: "Broj komada je ceo broj od 1 naviše.",
    errorWaste: "Rastur je broj od 0 do 100 %.",
    errorMixerVolume: "Zapremina mešalice mora biti veća od nule.",
    errorDensity: "Gustina betona je broj od 1000 do 3500 kg/m³.",
    errorRebarRate: "Količina armature mora biti veća od nule.",
    errorOpenings: "Odbitak otvora ne sme biti negativan niti veći ili jednak površini a × b.",
    errorA: "Dimenzija a mora biti veća od nule.",
    errorB: "Dimenzija b mora biti veća od nule.",
    errorD: "Debljina d mora biti veća od nule.",
    errorH: "Visina h mora biti veća od nule.",
    errorLength: "Dužina L mora biti veća od nule.",

    unitM3: "m³",
    unitM2: "m²",
    unitT: "t",
    unitKg: "kg",
    unitPercent: "%",
  },

  "drawing-scale": {
    denominator: "Razmera 1:M",
    denominatorHint: "Imenilac M. Ispod 1 je uvećanje po ISO 5455, npr. 2:1 je M = 0,5.",
    direction: "Smer",
    directionPaperToReal: "Papir → stvarno",
    directionRealToPaper: "Stvarno → papir",
    lengthOnPaper: "Dužina na papiru",
    lengthReal: "Stvarna dužina",

    results: "Rezultat",
    paperLength: "Dužina na papiru",
    realLength: "Stvarna dužina",

    paperArea: "Površina izmerena na papiru",
    paperAreaHint: "U cm², opciono. Faktor razmere se kvadrira za površinu.",
    areaResults: "Stvarna površina",
    realArea: "Stvarna površina",

    objectWidth: "Gabarit predmeta — širina",
    objectHeight: "Gabarit predmeta — visina",
    sheet: "Format lista",
    orientation: "Orijentacija",
    orientationPortrait: "Uspravno",
    orientationLandscape: "Položeno",
    margin: "Margina",
    marginHint: "Zaglavlje i ivice — stvar biroa, oduzima se sa obe strane obe ose.",

    fitResults: "Uklapanje u list",
    drawnWidth: "Nacrtana širina",
    drawnHeight: "Nacrtana visina",
    usableWidth: "Iskoristiva širina lista",
    usableHeight: "Iskoristiva visina lista",
    fits: "Uklapanje",
    fitsYes: "Staje u izabranoj orijentaciji",
    fitsRotated: "Staje samo okrenut za 90°",
    fitsNo: "Ne staje",
    seriesDenominator: "Najkrupnija razmera iz niza koja staje",
    seriesNone: "Nijedna iz niza",
    requiredDenominator: "Tačna razmera pri kojoj bi predmet upravo stao",

    inputs: "Uneseno",
    formula:
      "L_stvarno[m] = L_papir[mm]·M/1000     L_papir[mm] = L_stvarno[m]·1000/M     A_stvarno = " +
      "A_papir[cm²]·10⁻⁴·M²     w,h = W,H·1000/M",
    source: "Formati lista: ISO 216:2007, A-serija. Niz razmera: ISO 5455:1979.",

    errorDenominator: "Imenilac M mora biti veći od nule.",
    errorLength: "Dužina mora biti veća od nule.",
    errorPaperArea: "Površina na papiru mora biti veća od nule.",
    errorObjectWidth: "Širina gabarita mora biti veća od nule.",
    errorObjectHeight: "Visina gabarita mora biti veća od nule.",
    errorMargin: "Margina mora ostaviti pozitivnu iskoristivu površinu lista.",

    unitMm: "mm",
    unitM: "m",
    unitM2: "m²",
  },

  "earthwork-prismoidal": {
    profiles: "Profili",
    profilesHint:
      "Jedan red po profilu: stacionaža;površina iskopa;površina nasipa;srednja površina " +
      "iskopa;srednja površina nasipa. Poslednja dva su opciona i pripadaju segmentu koji ovaj " +
      "red počinje.",
    bulking: "Rastresitost",
    bulkingHint: "Osobina tla koju znaš sa terena. Primenjuje se samo na iskop koji se odvozi.",
    settlement: "Sleganje nasipa",

    results: "Rezultat po segmentima",
    colFrom: "Od (m)",
    colTo: "Do (m)",
    colLength: "Dužina (m)",
    colCut: "Iskop (m³)",
    colFill: "Nasip (m³)",
    colMethod: "Metoda",
    methodPrismoidal: "Prizmoidna",
    methodAverage: "Srednji preseci",

    totalCut: "Ukupan iskop",
    totalFill: "Ukupan nasip",
    balance: "Bilans (iskop − nasip), u tlu",
    cutLoose: "Iskop u rastresitom stanju",
    fillWithSettlement: "Nasip posle sleganja",
    balanceAdjusted: "Bilans u prilagođenim stanjima",
    balanceNote:
      "Rastresitost se primenjuje samo na iskop, sleganje samo na nasip — ove dve linije su u " +
      "različitim mernim stanjima i ne sabiraju se sa bilansom u tlu.",

    inputs: "Uneseno",
    formula:
      "srednji preseci: V=L(A₁+A₂)/2     prizmoidna (kad postoji A_m): V=(L/6)(A₁+4A_m+A₂)",

    errorRows: "Potrebna su bar dva profila sa strogo rastućom stacionažom.",
    errorBulking: "Rastresitost je broj od 0 do 100 %.",
    errorSettlement: "Sleganje je broj od 0 do 100 %.",
    errorStation: "Stacionaža mora strogo rasti od reda do reda.",
    errorCut: "Površina iskopa ne sme biti negativna.",
    errorFill: "Površina nasipa ne sme biti negativna.",
    errorMidCut: "Srednja površina iskopa ne sme biti negativna, i ne pripada poslednjem redu.",
    errorMidFill: "Srednja površina nasipa ne sme biti negativna, i ne pripada poslednjem redu.",

    unitM3: "m³",
  },

  "level-run": {
    startElevation: "Kota polaznog repera",
    readings: "Očitanja",
    readingsHint:
      "Jedan red po tački: naziv;nazad(BS);međuočitanje(IS);napred(FS);dužina viza. Prazna " +
      "ćelija znači da te vrste očitanja nema; dužina viza pripada stanici koju red otvara " +
      "backsightom.",
    closingElevation: "Kota završnog repera",
    closingElevationHint: "Opciono. Bez nje se ne prikazuje nezatvaranje.",

    results: "Rezultat",
    colPoint: "Tačka",
    colInstrument: "Visina instrumenta",
    colElevation: "Kota",
    colCorrection: "Popravka",
    colAdjusted: "Popravljena kota",

    firstElevation: "Kota početka",
    lastElevation: "Kota kraja",
    sumBacksights: "ΣBS",
    sumForesights: "ΣFS",
    checkDifference: "Kontrola: ΣBS − ΣFS − (kraj − početak)",
    misclosure: "Nezatvaranje",
    stations: "Broj stanica",
    checkNote:
      "Međuočitanja namerno ne ulaze u kontrolu — tačka viđena samo kao IS ne nosi visinu dalje.",
    readingCount: "Broj redova očitanja",

    inputs: "Uneseno",
    formula:
      "HI = H(BS) + BS     H = HI − IS     H = HI − FS     popravka_i = −f·(težina_i/težina_uk)",

    errorStartElevation: "Kota polaznog repera mora biti realan broj.",
    errorRows: "Potreban je bar jedan red očitanja.",
    errorClosingElevation: "Kota završnog repera mora biti realan broj.",
    errorRow: "Svaki red mora imati bar jedno od: nazad, međuočitanje, napred.",
    errorBacksight: "Nazad (BS) zahteva tačku sa već poznatom kotom.",
    errorIntermediate: "Međuočitanje (IS) zahteva otvorenu stanicu.",
    errorForesight: "Napred (FS) zahteva otvorenu stanicu.",
    errorDistance: "Dužina viza pripada redu koji ima nazad (BS), i mora biti veća od nule.",

    unitMm: "mm",
  },

  "rebar-weight": {
    diameter: "Prečnik šipke Ø",
    diameterHint: "Slobodan unos od 1 do 60 mm — prečica za kucanje, ne predlog profila.",
    direction: "Smer računa",
    directionToMass: "Iz metara u kilograme",
    directionToLength: "Iz kilograma u metre",
    barLength: "Dužina jedne šipke",
    bars: "Broj šipki",
    mass: "Masa",
    stockLength: "Dužina šipke na skladištu",
    stockLengthHint: "Opciono. Bez nje se prikazuje samo ukupna dužina, bez broja celih šipki.",

    results: "Rezultat",
    massPerMetre: "Masa po dužnom metru",
    totalLength: "Ukupna dužina",
    totalMass: "Ukupna masa",
    totalTonnes: "Ukupna masa (tone)",
    wholeBars: "Broj celih šipki",
    remainder: "Ostatak",
    densityNote:
      "ρ = 7850 kg/m³ je konvencija nominalne mase po EN 10080 i ISO 6935-2, ne izmerena gustina " +
      "neke šarže.",

    inputs: "Uneseno",
    formula: "m′ = (π/4)·(Ø/1000)²·7850     L = dužina·broj     M = m′·L     (obrnuto: L = M/m′)",

    errorDiameter: "Prečnik je broj od 1 do 60 mm.",
    errorBarLength: "Dužina šipke mora biti veća od nule.",
    errorBars: "Broj šipki je ceo broj, jedan ili više.",
    errorMass: "Masa mora biti veća od nule.",

    unitMm: "mm",
    unitM: "m",
    unitKg: "kg",
    unitT: "t",
    unitKgm: "kg/m",
  },

  "roof-pitch": {
    pitch: "Nagib",
    pitchUnit: "Jedinica nagiba",
    unitDegOpt: "Stepen",
    unitPercentOpt: "Procenat",
    unitRatioOpt: "Odnos 1:n",
    base: "Osnova b",
    eaves: "Prepust strehe",
    planArea: "Površina horizontalne projekcije",
    secondBase: "Druga osnova b₂ (za grbinu)",
    secondBaseHint: "Ista vrednost kao osnova daje grbinu pod 45° u osnovi.",

    results: "Rezultat",
    angle: "Ugao nagiba",
    height: "Visina do slemena",
    rafter: "Dužina roga",
    rafterWithEaves: "Dužina roga sa prepustom",
    slopeArea: "Stvarna površina krovne ravni",
    hipLength: "Dužina grbine",
    hipAngle: "Nagib grbine",

    inputs: "Uneseno",
    formula:
      "h = b·tanθ     rog = b/cosθ     površina = projekcija/cosθ     grbina: b_g=√(b₁²+b₂²), " +
      "dužina=√(b_g²+h²)",

    errorPitch: "Nagib mora biti u opsegu 0° do 90° (isključivo).",
    errorBase: "Osnova mora biti veća od nule.",
    errorEaves: "Prepust strehe ne sme biti negativan.",
    errorPlanArea: "Površina projekcije mora biti veća od nule.",
    errorSecondBase: "Druga osnova mora biti veća od nule.",

    unitDeg: "°",
    unitM: "m",
    unitM2: "m²",
  },

  "room-surfaces": {
    planMode: "Kako je osnova merena",
    planModeRectangle: "Pravougaona, dužina × širina",
    planModePerimeter: "Nepravilna, unet je obim",
    length: "Dužina prostorije",
    width: "Širina prostorije",
    perimeter: "Obim",
    height: "Svetla visina",
    openings: "Otvori",
    openingsHint:
      "Jedan red po otvoru: širina;visina;broj komada;vrata ili prozor;uključi parapet(da/ne, " +
      "opciono — prazno prati konvenciju: uključeno za prozor, isključeno za vrata).",
    deductOpenings: "Odbijanje otvora od zidne površine",
    yes: "Uključeno",
    no: "Isključeno",
    revealDepth: "Dubina špaletne",
    ceilingArea: "Površina plafona",
    ceilingAreaHint:
      "Obavezno kad je osnova uneta kao obim — obim ne određuje površinu koju zatvara.",
    includeWalls: "Uračunaj zidove u zbirnu površinu",
    includeReveals: "Uračunaj špaletne u zbirnu površinu",
    includeCeiling: "Uračunaj plafon u zbirnu površinu",
    coverage: "Izdašnost materijala",
    coverageHint:
      "Sa deklaracije proizvoda. Ista brojka znači različitu količinu u druga dva režima ispod.",
    coverageMode: "Vrsta izdašnosti",
    coverageAreaPerLitre: "m² po litru",
    coverageMassPerArea: "kg po m²",
    coats: "Broj premaza",

    results: "Rezultat",
    grossWall: "Bruto zidna površina",
    openingArea: "Ukupna površina otvora",
    netWall: "Neto zidna površina",
    revealLength: "Dužina otkrivke špaletni",
    revealArea: "Površina špaletni",
    ceiling: "Plafon",
    totalArea: "Zbirna površina za obradu",
    quantity: "Potrebna količina materijala",

    inputs: "Uneseno",
    formula:
      "O=2(L+Š) ili unet     bruto=O·H     A_otv=Σ(š·v·n)     neto=O·H−A_otv     špaletna: 2v+s " +
      "(bez parapeta) ili 2v+2s (sa parapetom)     količina=zbir·premazi/izdašnost ili " +
      "zbir·premazi·izdašnost",

    errorHeight: "Svetla visina mora biti veća od nule.",
    errorLength: "Dužina prostorije mora biti veća od nule.",
    errorWidth: "Širina prostorije mora biti veća od nule.",
    errorPerimeter: "Obim mora biti veći od nule.",
    errorRevealDepth:
      "Dubina špaletne je obavezna kad su špaletne uključene, i ne sme biti negativna.",
    errorOpening: "Svaki otvor mora imati širinu, visinu i ceo broj komada veći od nule.",
    errorCeilingArea:
      "Površina plafona je obavezna kad je plafon uključen i osnova je uneta kao obim.",
    errorCoverage: "Izdašnost mora biti veća od nule.",
    errorCoverageMode: "Vrsta izdašnosti mora biti izabrana kad je izdašnost uneta.",
    errorCoats: "Broj premaza je ceo broj od 1 do 20.",

    unitM: "m",
    unitM2: "m²",
    unitL: "l",
    unitKg: "kg",
  },

  "slope-grade": {
    known: "Koja dva podatka su poznata",
    knownRunRise: "Dužina i visinska razlika",
    knownRunSlope: "Dužina i nagib",
    knownRiseSlope: "Visinska razlika i nagib",
    knownSlantSlope: "Kosa dužina i nagib",
    knownSlantRise: "Kosa dužina i visinska razlika",
    knownSlantRun: "Kosa dužina i horizontalna dužina",
    run: "Horizontalna dužina L",
    rise: "Visinska razlika h",
    riseHint: "Negativno je pad u suprotnom smeru.",
    slant: "Kosa dužina s",
    slope: "Nagib",
    slopeUnit: "Jedinica nagiba",
    unitPercentOpt: "Procenat",
    unitPermilleOpt: "Promil",
    unitDegOpt: "Stepen",
    unitRatioOpt: "Odnos 1:n",

    results: "Rezultat",
    percent: "Nagib u procentima",
    permille: "Nagib u promilima",
    degrees: "Nagib u stepenima",
    ratio: "Nagib kao odnos",
    ratioNote: "Odnos 1:n je uvek visina : osnova — jedan metar visine na n metara osnove.",
    descending: "Smer",
    descendingYes: "Opada",
    descendingNo: "Raste ili je vodoravno",

    inputs: "Uneseno",
    formula:
      "p[%]=100h/L   p[‰]=1000h/L   θ=atan(h/L)   1:n=L/h   s=√(L²+h²)   obrnuto: h=L·p/100; " +
      "L=s·cosθ, h=s·sinθ; L=n·h; h=L/n",

    errorRun: "Horizontalna dužina mora biti veća od nule.",
    errorRise: "Visinska razlika mora biti realan broj.",
    errorSlant: "Kosa dužina mora biti veća od nule i veća od druge unete dužine.",
    errorSlope: "Nagib mora biti manji od 90° i u dozvoljenom opsegu za izabranu jedinicu.",

    unitPercent: "%",
    unitPermille: "‰",
    unitDeg: "°",
    unitM: "m",
  },

  "square-check": {
    sideA: "Stranica a",
    sideB: "Stranica b",
    measuredDiagonal: "Izmerena dijagonala",
    secondDiagonal: "Druga dijagonala",
    secondDiagonalHint:
      "Opciono, za proveru četvorougla. Predikcija važi samo ako je oblik paralelogram.",

    results: "Rezultat",
    expectedDiagonal: "Tražena dijagonala (pravougli ugao)",
    diagonalError: "Razlika izmereno − traženo",
    angle: "Stvarni ugao u temenu",
    angleError: "Odstupanje od pravog ugla",
    offsetAlongA: "Pomak kraja stranice b, paralelno stranici a",
    diagonalDifference: "Razlika izmereno − druga dijagonala",
    expectedSecondDiagonal: "Druga dijagonala za paralelogram (predikcija)",
    parallelogramSkew: "Izmerena druga dijagonala − predikcija",

    inputs: "Uneseno",
    formula:
      "d₀=√(a²+b²)     cosα=(a²+b²−d²)/(2ab)     α=acos(cosα)     pomak=b·cosα     " +
      "q=√(2(a²+b²)−p²) (samo paralelogram)",

    errorSideA: "Stranica a mora biti veća od nule.",
    errorSideB: "Stranica b mora biti veća od nule.",
    errorMeasuredDiagonal: "Izmerena dijagonala mora zadovoljiti nejednakost trougla sa a i b.",
    errorSecondDiagonal: "Druga dijagonala mora biti veća od nule.",

    unitM: "m",
    unitMm: "mm",
    unitDeg: "°",
  },

  "survey-bearing-distance": {
    direction: "Smer računa",
    directionInverse: "Iz koordinata (drugi geodetski zadatak)",
    directionForward: "Iz ugla i dužine (prvi geodetski zadatak)",
    pointAY: "Tačka A — Y (istok)",
    pointAX: "Tačka A — X (sever)",
    pointBY: "Tačka B — Y (istok)",
    pointBX: "Tačka B — X (sever)",
    bearingUnit: "Jedinica direkcionog ugla",
    unitGonOpt: "Gon",
    unitDegOpt: "Stepen",
    unitDmsOpt: "Stepeni-minuti-sekunde",
    sign: "Predznak",
    signPos: "Pozitivan",
    signNeg: "Negativan",
    degrees: "Stepeni",
    minutes: "Minuti",
    seconds: "Sekunde",
    bearing: "Direkcioni ugao ν",
    distance: "Dužina d",

    results: "Rezultat",
    deltaY: "ΔY",
    deltaX: "ΔX",
    bearingGon: "Direkcioni ugao (gon)",
    bearingDeg: "Direkcioni ugao (stepen)",
    oppositeGon: "Suprotan smer (gon)",
    oppositeDeg: "Suprotan smer (stepen)",
    newY: "Nova tačka — Y",
    newX: "Nova tačka — X",

    inputs: "Uneseno",
    formula:
      "drugi zadatak: ΔY=Yb−Ya, ΔX=Xb−Xa, d=√(ΔY²+ΔX²), ν=atan2(ΔY,ΔX)     prvi zadatak: " +
      "Yb=Ya+d·sinν, Xb=Xa+d·cosν     suprotno: ν±200 gon (±180°)",

    errorPointA: "Koordinate tačke A moraju biti realni brojevi.",
    errorPointB: "Koordinate tačke B moraju biti realni brojevi.",
    errorDistance: "Dužina d ne sme biti negativna.",
    errorBearing: "Direkcioni ugao mora biti unet.",

    unitM: "m",
  },

  "tile-count": {
    area: "Površina",
    tileWidth: "Format komada — širina a",
    tileHeight: "Format komada — visina b",
    joint: "Širina spojnice",
    waste: "Rastur",
    wasteHint: "Zavisi od formata, veze i geometrije prostorije.",
    boxMode: "Kutija zadata preko",
    boxModePerBox: "Komada u kutiji",
    boxModeAreaPerBox: "Površine po kutiji",
    perBox: "Komada u kutiji",
    areaPerBox: "Površina po kutiji",

    results: "Rezultat",
    perSquareMetre: "Komada po m²",
    areaWithWaste: "Potrebna površina sa rasturom",
    pieces: "Ukupan broj komada",
    boxes: "Broj kutija",
    surplusPieces: "Višak iz poslednje kutije (komada)",
    surplusArea: "Višak iz poslednje kutije (nominalna površina)",
    gridNote:
      "Formula (a+s)(b+s) važi za pravu mrežu. Pomereni i riblja-kost raspored ostavljaju istu " +
      "površinu, ali drugačiji otpad na rezanju — zato je rastur uvek tvoj unos.",

    inputs: "Uneseno",
    formula:
      "komad_eff=(a+s)(b+s)     kom/m²=10⁶/eff     A_rastur=A·(1+r/100)     " +
      "n=ceil(A_rastur·10⁶/eff)     kutije=ceil(n/perKutiji) ili ceil(A_rastur/pArKutiji)",

    errorArea: "Površina mora biti veća od nule.",
    errorTileWidth: "Širina komada mora biti veća od nule.",
    errorTileHeight: "Visina komada mora biti veća od nule.",
    errorJoint: "Širina spojnice ne sme biti negativna.",
    errorWaste: "Rastur je broj od 0 do 100 %.",
    errorPerBox: "Broj komada u kutiji je ceo broj, jedan ili više.",
    errorAreaPerBox: "Površina po kutiji mora biti veća od nule.",

    unitM2: "m²",
    unitMm: "mm",
  },

  "trench-volume": {
    length: "Dužina rova L",
    widthMode: "Širina dna zadata preko",
    widthModeDirect: "Direktan unos",
    widthModeFromPipe: "Prečnika cevi i radnog prostora",
    bottomWidth: "Širina dna b",
    workingSpace: "Radni prostor sa svake strane",
    workingSpaceHint: "Širina dna se izvodi kao prečnik cevi + 2 × radni prostor.",
    depth: "Dubina h",
    batter: "Nagib kosine m",
    limitHint:
      "Horizontalno po jedinici visine, na svakoj strani. Propisana i projektna veličina — nula " +
      "je vertikalna strana.",
    pipeDiameter: "Spoljni prečnik cevi",
    beddingThickness: "Debljina posteljice",
    bulking: "Rastresitost",
    bulkingHint: "Osobina tla sa terena. Primenjuje se samo na zemlju koja se odvozi.",
    returnsSpoil: "Iskopana zemlja se vraća kao zasip",
    returnsSpoilHint: "Kad je isključeno, ceo iskop je višak za odvoz — ništa se ne vraća u rov.",
    yes: "Da",
    no: "Ne",

    results: "Rezultat",
    crossSection: "Površina poprečnog preseka",
    topWidth: "Širina rova na vrhu",
    excavation: "Zapremina iskopa",
    bedding: "Zapremina posteljice",
    pipe: "Zapremina cevi",
    backfill: "Zapremina zasipanja",
    surplus: "Višak za odvoz, u tlu",
    surplusLoose: "Višak za odvoz, rastresito",

    inputs: "Uneseno",
    formula:
      "A=h(b+mh)     vrh=b+2mh     V=A·L     V_posteljice=b·t·L     V_cevi=(π/4)d²L     " +
      "zasip=V−posteljica−cev (ako se vraća) inače 0     višak(1+bulk/100)",

    errorLength: "Dužina rova mora biti veća od nule.",
    errorDepth: "Dubina mora biti veća od nule.",
    errorBatter: "Nagib kosine ne sme biti negativan.",
    errorBulking: "Rastresitost je broj od 0 do 100 %.",
    errorPipeDiameter: "Prečnik cevi mora biti veći od nule i ne veći od širine dna.",
    errorBottomWidth:
      "Širina dna mora biti veća od nule, ili je izvedena iz prečnika cevi i radnog prostora.",
    errorBeddingThickness:
      "Debljina posteljice ne sme biti negativna, i zajedno sa prečnikom cevi mora stati u " +
      "dubinu.",

    unitM: "m",
    unitM2: "m²",
    unitM3: "m³",
  },

  "wall-u-value": {
    layers: "Slojevi",
    layersHint:
      "Jedan red po sloju, iznutra ka spolja: naziv;debljina u cm;λ u W/(m·K);otpor u m²K/W. " +
      "Poslednja ćelija je za nevetreni vazdušni sloj — kad je popunjena, koristi se direktno i " +
      "pobeđuje debljinu i λ.",
    rsi: "Otpor prelaza toplote unutra Rsi",
    rsiHint: "Zavisi od smera toplotnog toka, iz standarda koji primenjuješ.",
    rse: "Otpor prelaza toplote spolja Rse",
    insideTemperature: "Unutrašnja temperatura",
    outsideTemperature: "Spoljna temperatura",

    results: "Rezultat",
    colLayer: "Sloj",
    colResistance: "Otpor (m²K/W)",
    colShare: "Udeo",
    colBoundaryTemp: "Temperatura na spoljnoj strani sloja",
    totalResistance: "Ukupan otpor R",
    uValue: "U-vrednost",
    innerSurfaceTemperature: "Unutrašnja površinska temperatura",
    outerSurfaceTemperature: "Spoljna površinska temperatura",
    scopeNote:
      "Jednodimenzionalno stacionarno stanje, samo homogeni slojevi. Bez toplotnih mostova, bez " +
      "ΔU za mehaničke spojnice, bez usrednjavanja nehomogenog sloja i bez dobro provetravanog " +
      "vazdušnog sloja.",

    inputs: "Uneseno",
    formula:
      "R_sloja=d/λ     R_uk=Rsi+ΣR+Rse     U=1/R_uk     udeo=R_sloja/R_uk     θ_k=θi−((Rsi+ΣR do " +
      "k)/R_uk)·(θi−θe)",

    errorLayers: "Potreban je bar jedan i najviše dvadeset slojeva.",
    errorRsi: "Rsi je broj od 0 do 1 m²K/W.",
    errorRse: "Rse je broj od 0 do 1 m²K/W.",
    errorResistance: "Otpor sloja mora biti veći od nule.",
    errorThickness: "Debljina sloja mora biti veća od nule.",
    errorConductivity: "Koeficijent provođenja λ mora biti veći od nule.",

    unitWm2k: "W/(m²K)",
    unitC: "°C",
  },
} as const;
