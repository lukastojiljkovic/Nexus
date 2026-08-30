/**
 * „Prosveta i nastava" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those
 * live in the `name` and `blurb` tables of `./pro.ts`.
 *
 * **A unit is copy, not a constant** — written here rather than concatenated
 * in the surface. **A regulated figure's hint always says the same thing**:
 * Nexus does not know the rulebook and does not guess a value for it.
 */
export const PRO_PROSVETA_SR = {
  "average-to-target": {
    mode: "Način unosa",
    modeGrades: "Spisak ocena",
    modeTally: "Broj i zbir ocena",
    grades: "Postojeće ocene",
    gradesHint: "Jedna ili više ocena, razdvojene razmakom, tačkom-zarezom ili novim redom.",
    tallyCount: "Broj ocena n",
    tallySum: "Zbir ocena S",
    target: "Ciljni prosek",
    targetHint: "Prosek koji se želi dostići, na istoj skali kao ocene.",
    extraGrade: "Vrednost dodatne ocene",
    extraGradeHint:
      "Skalu ocenjivanja propisuje ustanova (1–5, 5–10, procenti); nema podrazumevane vrednosti.",

    results: "Rezultat",
    currentAverage: "Trenutni prosek",
    outcome: "Ishod",
    extraGrades: "Broj dodatnih ocena",
    resultingAverage: "Prosek posle njih",
    outcomeNeeded: "Toliko ocena te vrednosti dostiže cilj",
    outcomeAnyCount: "Cilj je već dostignut; ocene te vrednosti ga ne pomeraju",
    outcomeUnreachable: "Nedostižno ocenama te vrednosti",
    outcomeAlreadyBelow: "Prosek je već ispod cilja, a ocene te vrednosti ga samo udaljavaju",
    outcomeTolerated: "Najveći broj takvih ocena posle kojih prosek još nije ispod cilja",

    inputs: "Uneseno",
    formula: "D = T·n − S     E = v − T     j·(v − T) ≥ T·n − S",

    errorGrades: "Unesi bar jednu ocenu.",
    errorTooManyValues: "Previše ocena u jednom unosu.",
    errorCount: "Broj ocena mora biti ceo broj, bar 1.",
    errorSum: "Zbir ocena nije čitljiv broj.",
    errorTarget: "Ciljni prosek nije čitljiv broj.",
    errorExtraGrade: "Vrednost dodatne ocene nije čitljiv broj.",
  },

  "child-age": {
    birth: "Datum rođenja",
    on: "Datum na koji se računa",
    dateHint: "Format DD.MM.GGGG, npr. 13.08.2020.",
    onHint: "Format DD.MM.GGGG. Prazno polje računa na današnji dan.",
    milestoneYears: "Broj godina za rođendan",
    milestoneYearsHint: "Opciono — ceo broj godina za koji se traži datum rođendana.",

    results: "Rezultat",
    age: "Uzrast",
    years: "godina",
    months: "meseci",
    days: "dana",
    totalMonths: "Ukupno navršenih meseci",
    totalDays: "Ukupno dana",
    daysUntilNextBirthday: "Dana do sledećeg rođendana",
    milestoneDate: "Datum navršenja",
    milestoneShifted: "29. februar ne postoji te godine — primenjen 1. mart",
    borrowNote: "Pozajmljeno iz meseca",
    borrowedMonth: "mesec",
    borrowClamped: "dan rođenja skraćen na dužinu tog meseca",
    daysUnit: "dana",

    inputs: "Uneseno",
    formula: "d, m, g = razlika dana/meseci/godina, uz pozajmicu iz prethodnog meseca kad je d < 0",

    errorBirth: "Datum rođenja nije ispravan datum gregorijanskog kalendara.",
    errorOn: "Referentni datum nije ispravan ili je raniji od datuma rođenja.",
    errorMilestoneYears: "Broj godina za rođendan mora biti ceo broj, 0 ili više.",
  },

  combinatorics: {
    n: "n",
    nHint: "Ceo broj ≥ 0. Praktičan zid je 100.000 zbog dužine ispisa.",
    k: "k",
    kHint: "Ceo broj ≥ 0.",
    repeats: "Brojevi ponavljanja (za permutacije sa ponavljanjem)",
    repeatsHint:
      "Opciono — celi brojevi ≥ 1 čiji je zbir ≤ n, razdvojeni razmakom ili zarezom. U ovom " +
      "režimu se k zanemaruje.",

    results: "Rezultat",
    factorial: "n!",
    variations: "Varijacije bez ponavljanja V(n,k)",
    combinations: "Kombinacije bez ponavljanja C(n,k)",
    variationsWithRepetition: "Varijacije sa ponavljanjem n^k",
    combinationsWithRepetition: "Kombinacije sa ponavljanjem C(n+k−1,k)",
    permutationsWithRepetition: "Permutacije sa ponavljanjem",
    factorialDigits: "Broj cifara n!",

    inputs: "Uneseno",
    formula: "n! = Π i     V(n,k) = n!/(n−k)!     C(n,k) = n!/(k!(n−k)!)     n^k     C(n+k−1,k)",

    errorN: "n mora biti ceo broj od 0 do 100.000.",
    errorK: "k mora biti ceo broj od 0 do 100.000.",
    errorRepeats: "Brojevi ponavljanja moraju biti celi brojevi ≥ 1 čiji je zbir ≤ n.",
  },

  "fractions-decimals": {
    mode: "Vrsta rada",
    modeCompute: "Računanje",
    modeConvert: "Pretvaranje decimale",
    a: "Brojilac a",
    b: "Imenilac b",
    operation: "Operacija",
    c: "Brojilac c",
    d: "Imenilac d",
    decimalInput: "Decimalni zapis",
    decimalInputHint:
      "Ceo deo, zapeta, neperiodične cifre, period u zagradi — npr. 0,1(6) ili 3,75.",

    results: "Rezultat",
    reducedFraction: "Skraćen razlomak",
    mixedNumber: "Mešovit broj",
    decimalResult: "Decimalni zapis",
    decimalLengths: "Dužina neperiodičnog / periodičnog dela",
    decimalTooLong: "Predugačak za prikaz (preko 2000 cifara).",
    percent: "Procenat",
    percentApprox: "Procenat je zaokružen na šest decimala, nije tačna vrednost.",

    inputs: "Uneseno",
    formulaCompute: "a/b + c/d = (ad + cb)/(bd)     a/b × c/d = ac/(bd)     a/b ÷ c/d = ad/(bc)",
    formulaConvert: "vrednost = (I·10^(n+r) + N·10^r + R − (I·10^n + N)) / (10^(n+r) − 10^n)",

    errorA: "Brojilac a mora biti ceo broj.",
    errorB: "Imenilac b mora biti ceo broj različit od nule.",
    errorC: "Brojilac c mora biti ceo broj (i različit od nule za deljenje).",
    errorD: "Imenilac d mora biti ceo broj različit od nule.",
    errorOperation: "Operacija nije prepoznata.",
    errorDecimalNotation: "Zapis nije čitljiv — koristi oblik 0,1(6) ili 3,75.",
  },

  "grade-scale-points": {
    maxPoints: "Maksimalan broj bodova B",
    step: "Korak bodovanja k",
    stepHint: "Tipično 1 ili 0,5. Prazno polje računa sa korakom 1.",
    thresholds: "Pragovi (oznaka; prag u %)",
    thresholdsHint:
      "Jedan red po pragu — oznaka i procenat razdvojeni tačkom-zarezom, npr. „5; 91\". Pragove " +
      "propisuje pravilnik ustanove ili ministarstva; Nexus nema ugrađenu skalu.",
    scoredPoints: "Osvojeni bodovi",
    scoredPointsHint: "Opciono — bodovi za koje se traži oznaka iz skale.",

    results: "Rezultat",
    colLabel: "Oznaka",
    colThreshold: "Prag %",
    colMinPoints: "Minimum bodova",
    colMinPercent: "Stvaran %",
    colRange: "Opseg bodova",
    unreachableRow: "nedostižno pri zadatom B i k",
    unlabelled: "Bez oznake",
    scoredPercent: "Procenat osvojenih bodova",
    scoredLabel: "Oznaka iz skale",
    noLabel: "bez oznake (ispod najnižeg praga)",
    unitPoints: "bod.",

    inputs: "Uneseno",
    formula:
      "m = ceilDiv(prag·B, 100·k)     minBodovi = m·k     procenat minimuma = 100·minBodovi/B",

    errorMaxPoints: "Maksimalan broj bodova mora biti veći od nule.",
    errorStep: "Korak bodovanja mora biti veći od nule i ne veći od maksimuma.",
    errorThresholds:
      "Pragovi moraju biti brojevi iz [0, 100], svaki upisan kao „oznaka; procenat\".",
    errorTooManyRows: "Previše redova pragova u jednom unosu.",
    errorDuplicateThreshold: "Dva praga imaju istu vrednost — opseg između njih ne postoji.",
    errorScoredPoints: "Osvojeni bodovi moraju biti iz [0, B].",
  },

  "grade-statistics": {
    values: "Vrednosti",
    valuesHint:
      "Ocene ili bodovi, razdvojeni razmakom, tačkom-zarezom ili novim redom. Zarez je decimalni " +
      "znak — „3,5\" je jedna vrednost.",
    passThreshold: "Prag prolaznosti",
    passThresholdHint:
      "Opciono. Granicu propisuje ustanova ili ministarstvo; Nexus je ne pretpostavlja.",

    results: "Rezultat",
    count: "n",
    sum: "Zbir",
    mean: "Aritmetička sredina",
    min: "Minimum",
    max: "Maksimum",
    range: "Raspon",
    median: "Medijana",
    q1: "Q1",
    q3: "Q3",
    iqr: "IQR",
    quartilesAbsentNote: "Kvartili se ne računaju — jedna vrednost nema ni donju ni gornju polovinu.",
    quartilesDegenerateNote:
      "n < 4: isključiva metoda ovde ostavlja po jednu vrednost sa svake strane, " +
      "pa ove brojeve ne treba čitati kao pravu meru raspona.",
    quartileMethodNote: "Kvartili: isključiva metoda (Moore–McCabe).",
    populationVariance: "Populaciona varijansa",
    populationDeviation: "Populaciona standardna devijacija",
    sampleVariance: "Uzoračka varijansa",
    sampleDeviation: "Uzoračka standardna devijacija",
    modes: "Moda",
    noMode: "nema modu",
    colValue: "Vrednost",
    colCount: "Broj",
    colShare: "Udeo",
    shareRoundingNote: "Udeli se zaokružuju nezavisno pa njihov zbir ne mora biti tačno 100,00 %.",
    atOrAbove: "Broj vrednosti ≥ prag",

    inputs: "Uneseno",
    formula: "sredina = Σx/n     σ² = Σ(x−sredina)²/n     s² = Σ(x−sredina)²/(n−1)",

    errorValues: "Unesi bar jednu vrednost.",
    errorTooManyValues: "Previše vrednosti u jednom unosu.",
    errorPassThreshold: "Prag prolaznosti nije čitljiv broj.",
    errorToken: "Vrednost broj {index} nije čitljiv broj.",
  },

  "guessing-correction": {
    questions: "Ukupan broj pitanja Q",
    right: "Broj tačnih odgovora R",
    wrong: "Broj netačnih odgovora W",
    unanswered: "Broj neodgovorenih U",
    options: "Broj ponuđenih odgovora po pitanju k",
    optionsHint: "Ceo broj ≥ 2.",
    points: "Bodova po pitanju",
    pointsHint: "Prazno polje računa sa 1 bodom po pitanju.",

    results: "Rezultat",
    corrected: "Korigovan rezultat (u pitanjima)",
    percentOfMax: "Procenat maksimuma",
    expectedBefore: "Očekivano tačnih pre korekcije (Q/k)",
    expectedAfter: "Očekivano posle korekcije (čist pogađač)",
    answeredMismatch: "Razlika R+W+U − Q",

    inputs: "Uneseno",
    formula: "S = R − W/(k−1)     bodovi = S · bodova po pitanju     procenat = 100·S/Q",

    errorQuestions: "Ukupan broj pitanja mora biti ceo broj veći od nule.",
    errorRight: "Broj tačnih odgovora mora biti ceo broj ≥ 0.",
    errorWrong: "Broj netačnih odgovora mora biti ceo broj ≥ 0.",
    errorUnanswered: "Broj neodgovorenih mora biti ceo broj ≥ 0.",
    errorOptions: "Broj ponuđenih odgovora mora biti ceo broj ≥ 2.",
    errorPoints: "Bodova po pitanju mora biti veće od nule.",
  },

  "item-analysis": {
    correct: "Broj tačnih odgovora C",
    students: "Broj učenika N",
    studentsHint: "Učenici koji su radili zadatak — ovaj broj ulazi u p = C/N.",
    unanswered: "Neodgovoreni (van N)",
    unansweredHint: "Opciono — učenici koji zadatak uopšte nisu radili.",
    treatment: "Kako se neodgovoreni računaju",
    treatmentAsIncorrect: "Kao netačni (uvećavaju N)",
    treatmentExcluded: "Izuzeti (N ostaje isto)",
    upperCorrect: "Tačni u boljoj grupi C_g",
    upperSize: "Veličina bolje grupe N_g",
    lowerCorrect: "Tačni u slabijoj grupi C_s",
    lowerSize: "Veličina slabije grupe N_s",

    results: "Rezultat",
    facility: "Indeks lakoće p (veće = lakše)",
    n: "N upotrebljeno u p",
    upperRate: "Uspešnost bolje grupe",
    lowerRate: "Uspešnost slabije grupe",
    discrimination: "Indeks diskriminacije D",
    groupCoverage: "Udeo odeljenja koji grupe pokrivaju",

    inputs: "Uneseno",
    formula: "p = C/N     D = C_g/N_g − C_s/N_s",

    errorStudents: "Broj učenika mora biti ceo broj veći od nule.",
    errorCorrect: "Broj tačnih odgovora mora biti ceo broj od 0 do N.",
    errorUnansweredTreatment: "Izaberi kako se neodgovoreni računaju.",
    errorUnanswered: "Broj neodgovorenih mora biti ceo broj ≥ 0.",
    errorUpper:
      "Bolja grupa: tačni i veličina moraju biti celi brojevi, tačni ≤ veličina i ≤ N, C.",
    errorLower:
      "Slabija grupa: tačni i veličina moraju biti celi brojevi, tačni ≤ veličina i ≤ N, C.",
    errorGroups: "Zbir grupa ne sme premašiti ukupan broj učenika ni tačnih odgovora.",
  },

  "lesson-count-period": {
    start: "Početni datum",
    end: "Krajnji datum",
    dateHint: "Format DD.MM.GGGG.",
    weekdays: "Dani u nedelji sa brojem časova",
    weekdaysHint:
      "Jedan red po danu: broj dana u nedelji (1 = ponedeljak … 7 = nedelja, ISO 8601) i broj " +
      "časova, razdvojeni tačkom-zarezom — npr. „2; 1\".",
    excludedDates: "Izuzeti datumi",
    excludedDatesHint:
      "Jedan datum po redu, format DD.MM.GGGG. Nexus nema ugrađen kalendar praznika — računaju " +
      "se samo datumi upisani ovde.",
    makeupDays: "Dani koji rade po rasporedu drugog dana",
    makeupDaysHint:
      "Jedan red po danu: datum i dan u nedelji čiji se raspored primenjuje, razdvojeni " +
      "tačkom-zarezom — npr. „15.10.2026; 1\".",
    lessonMinutes: "Trajanje časa (minuta)",
    prescribedHours: "Propisan fond časova",
    prescribedHoursHint: "Opciono — godišnji fond iz nastavnog plana; Nexus ga ne zna.",

    results: "Rezultat",
    colWeekday: "Dan",
    colLessons: "Časova/dan",
    colOccurrences: "Pojavljivanja",
    colExcluded: "Izuzeto",
    colMakeupAway: "Nadoknada iz",
    colMakeupInto: "Nadoknada u",
    colSessions: "Termina",
    colDate: "Datum",
    colWeekdayName: "Dan u nedelji",
    colReason: "Razlog",
    totalSessions: "Ukupno termina",
    totalLessons: "Ukupno časova",
    totalExcluded: "Ukupno oduzetih termina",
    totalTime: "Ukupno trajanje",
    ignoredOffWeekday: "Zanemareno — dan bez nastave",
    ignoredOffPeriod: "Zanemareno — van perioda ili duplikat",
    reasonOffPeriod: "van perioda",
    reasonDuplicate: "duplikat",
    reasonOffWeekday: "dan bez nastave",
    prescribedHoursLabel: "Propisan fond časova",
    hoursDifferenceLabel: "Razlika izračunato − propisano",
    hoursRatioLabel: "Odnos izračunato/propisano",
    noHolidayNote:
      "Nexus nema ugrađen kalendar praznika — oduzeti su samo datumi koje uneseš.",
    weekdayNames: ["Ponedeljak", "Utorak", "Sreda", "Četvrtak", "Petak", "Subota", "Nedelja"],

    inputs: "Uneseno",
    formula:
      "prvi = start + ((w − isoDan(start)+7) mod 7)     termini = max(0, broj − izuzeto − nadU + " +
      "nadIz)",

    errorStart: "Početni datum nije ispravan datum gregorijanskog kalendara.",
    errorEnd: "Krajnji datum nije ispravan ili je raniji od početnog.",
    errorLessonMinutes: "Trajanje časa mora biti ceo broj od 1 do 600 minuta.",
    errorWeekdays: "Dani u nedelji moraju biti celi brojevi 1–7, bez ponavljanja, bar jedan red.",
    errorLessons: "Broj časova po danu mora biti ceo broj od 1 do 10.",
    errorPrescribedHours: "Propisan fond časova mora biti veći od nule.",
    errorTooManyRows: "Previše redova u jednom unosu.",
    errorExcludedDates: "Svaki izuzeti datum mora biti ispravan datum gregorijanskog kalendara.",
    errorMakeupDays:
      "Svaki red nadoknade mora imati ispravan datum unutar perioda i dan u nedelji 1–7, bez " +
      "sudara sa izuzetim ili drugim nadoknadama.",
  },

  "lesson-timeline": {
    start: "Vreme početka",
    startHint: "Format HH:MM, 24-časovni zapis, npr. 08:00.",
    activities: "Aktivnosti (naziv; trajanje u minutima)",
    activitiesHint:
      "Jedan red po aktivnosti, naziv i trajanje razdvojeni tačkom-zarezom — npr. „Uvod; 5\".",
    lessonMinutes: "Trajanje časa (minuta)",
    lessonMinutesHint: "Opciono — okvir u koji se aktivnosti smeštaju.",
    dayUnit: "dan",

    results: "Rezultat",
    colName: "Aktivnost",
    colStart: "Početak",
    colEnd: "Kraj",
    colDuration: "Trajanje",
    colShare: "Udeo",
    shareRoundingNote: "Udeli se zaokružuju nezavisno pa njihov zbir ne mora biti tačno 100,00 %.",
    totalMinutes: "Ukupno trajanje (minuta)",
    end: "Kraj poslednje aktivnosti",
    slack: "Preostalo (+) ili prekoračeno (−) vreme",

    inputs: "Uneseno",
    formula: "kraj_i = t0 + Σ_{j≤i} d_j     udeo_i = 100·d_i/Σd     ostatak = trajanje časa − Σd",

    errorStart: "Vreme početka mora biti u obliku HH:MM, 00:00–23:59.",
    errorDurations: "Unesi bar jednu aktivnost sa trajanjem ≥ 0 minuta i zbirom većim od nule.",
    errorTooManyRows: "Previše redova u jednom unosu.",
    errorLessonMinutes: "Trajanje časa mora biti ceo broj od 1 do 600 minuta.",
  },

  "split-into-groups": {
    students: "Broj učenika N",
    mode: "Način podele",
    modeByGroups: "Na k grupa",
    modeBySize: "Grupe po g učenika",
    valueByGroups: "Broj grupa k",
    valueBySize: "Veličina grupe g",
    minGroupSize: "Najmanja dozvoljena grupa",
    minGroupSizeHint: "Opciono — podela u kojoj bi neka grupa bila manja od ovog broja se odbija.",

    results: "Rezultat",
    groups: "Broj grupa",
    colCount: "Broj grupa",
    colSize: "Veličina",
    checkSum: "Provera zbira (∑ veličina · broj)",
    emptyGroups: "Prazne grupe",
    groupsWithMembers: "Grupe sa članovima",
    fullGroups: "Pune grupe (bez izjednačavanja)",
    remainder: "Ostatak učenika",
    fullCheckSum: "Provera zbira (pune grupe + ostatak)",
    largestGroupWithinSize: "Najveća grupa ≤ tražena veličina",
    yes: "Da",
    no: "Ne",

    inputs: "Uneseno",
    formula: "q = floor(N/k)     r = N mod k     r grupa od (q+1), (k−r) grupa od q",

    errorStudents: "Broj učenika mora biti ceo broj veći od nule.",
    errorGroups: "Broj grupa mora biti ceo broj veći od nule.",
    errorSize: "Veličina grupe mora biti ceo broj veći od nule.",
    errorMinGroupSize: "Najmanja grupa koju bi ova podela dala je manja od upisanog minimuma.",
  },

  "standard-score": {
    raw: "Sirov bod x",
    mean: "Aritmetička sredina μ",
    deviation: "Standardna devijacija σ",
    deviationKind: "Vrsta devijacije",
    deviationPopulation: "Populaciona (deljeno sa n)",
    deviationSample: "Uzoračka (deljeno sa n−1)",
    targetMean: "Ciljna sredina M",
    targetHint:
      "Opciono — proizvoljna skala, npr. sredina 100, devijacija 15. Oba polja se upisuju " +
      "zajedno.",
    targetDeviation: "Ciljna devijacija S",
    zForRaw: "z-vrednost za obrnut račun",
    reverseHint: "Opciono — vraća sirov bod iz z, T-boda ili vrednosti na ciljnoj skali.",
    tScoreForRaw: "T-bod za obrnut račun",
    targetScoreForRaw: "Vrednost na ciljnoj skali za obrnut račun",

    results: "Rezultat",
    z: "z",
    tScore: "T-bod",
    tScoreSource:
      "T-skala (sredina 50, standardna devijacija 10) po: W. A. McCall, How to Measure in " +
      "Education, 1922.",
    targetScore: "Vrednost na ciljnoj skali",
    rawFromZ: "Sirov bod iz z",
    rawFromTScore: "Sirov bod iz T-boda",
    rawFromTargetScore: "Sirov bod iz ciljne skale",

    inputs: "Uneseno",
    formula: "z = (x − μ)/σ     T = 50 + 10·z     y = M + S·z     x = μ + z·σ",

    errorRaw: "Sirov bod nije čitljiv broj.",
    errorMean: "Aritmetička sredina nije čitljiv broj.",
    errorDeviation: "Standardna devijacija mora biti veća od nule.",
    errorDeviationKind: "Izaberi vrstu devijacije.",
    errorTargetMean: "Ciljna sredina nije čitljiv broj — upiši i ciljnu devijaciju.",
    errorTargetDeviation: "Ciljna devijacija mora biti veća od nule — upiši i ciljnu sredinu.",
    errorZForRaw: "z-vrednost za obrnut račun nije čitljiv broj.",
    errorTScoreForRaw: "T-bod za obrnut račun nije čitljiv broj.",
    errorTargetScoreForRaw:
      "Za obrnut račun sa ciljne skale prvo upiši ciljnu sredinu i devijaciju.",
  },

  "test-printing": {
    pages: "Broj strana po primerku",
    copies: "Broj primeraka",
    duplex: "Dvostrano štampanje",
    duplexYes: "Da",
    duplexNo: "Ne",
    sheetsPerPack: "Listova u pakovanju",
    sheetsPerPackHint: "Pročita se sa pakovanja papira.",
    price: "Cena po listu",
    priceHint: "Opciono — tržišna cena; Nexus je ne zna i ne pamti.",

    results: "Rezultat",
    sheetsPerCopy: "Listova po primerku",
    totalPages: "Ukupno strana",
    totalSheets: "Ukupno listova",
    blankBacks: "Praznih poleđina",
    packs: "Broj pakovanja",
    leftInLastPack: "Preostalo u poslednjem pakovanju",
    amount: "Iznos",
    impositionNote:
      "Pretpostavka: jedna strana testa po odštampanoj strani lista (bez brošure/imposicije). " +
      "Iznos je prost proizvod broja listova i upisane cene, bez poreza i bez konverzije valuta.",

    inputs: "Uneseno",
    formula:
      "listova/primerku = dvostrano ? ceil(strana/2) : strana     pakovanja = " +
      "ceil(listova/pakovanje)",

    errorPages: "Broj strana po primerku mora biti ceo broj veći od nule.",
    errorCopies: "Broj primeraka mora biti ceo broj veći od nule.",
    errorSheetsPerPack: "Listova u pakovanju mora biti ceo broj veći od nule.",
    errorPrice: "Cena po listu mora biti broj veći ili jednak nuli.",
  },

  "topic-hour-allocation": {
    totalHours: "Ukupan broj časova T",
    topics: "Teme (naziv; težina)",
    topicsHint:
      "Jedan red po temi, naziv i težina razdvojeni tačkom-zarezom — npr. „Uvod; 20\". Težine ne " +
      "moraju da daju 100.",

    results: "Rezultat",
    colName: "Tema",
    colQuota: "Tačna kvota",
    colHours: "Časova",
    colShare: "Stvaran udeo",
    colExtraHour: "Dodatni čas",
    extraHourMark: "dodatni čas",
    checkSum: "Provera zbira (= T)",
    extraHourCount: "Broj tema sa dodatnim časom",
    methodNote: "Raspodela: pravilo najvećeg ostatka (Hamiltonov metod).",
    yes: "Da",
    no: "Ne",

    inputs: "Uneseno",
    formula:
      "kvota_i = T·w_i/Σw     a_i = floor(kvota_i)     preostalih T−Σa_i časova ide najvećim " +
      "ostacima",

    errorTotalHours: "Ukupan broj časova mora biti ceo broj veći od nule.",
    errorWeights: "Unesi bar jedan red sa težinom > 0; sve težine moraju biti ≥ 0.",
    errorTooManyRows: "Previše redova u jednom unosu.",
  },

  "weighted-grade": {
    components: "Komponente (naziv; osvojeno; maksimum; težina)",
    componentsHint:
      "Jedan red po komponenti, razdvojeno tačkom-zarezom — npr. „Kolokvijum 1; 18; 25; 20\". " +
      "Bar jedan red mora imati težinu > 0.",
    totalPoints: "Ukupan broj bodova T",
    totalPointsHint: "Opciono — skala na koju se rezultat preslikava.",
    targetPercent: "Ciljni ukupan procenat",
    pendingName: "Naziv preostale komponente",
    pendingMax: "Maksimum preostale komponente",
    pendingWeight: "Težina preostale komponente",

    results: "Rezultat",
    colName: "Komponenta",
    colPercent: "Procenat",
    colWeight: "Normalizovana težina",
    weight: "težina",
    totalPercent: "Ponderisan procenat",
    lowerBoundNote:
      "Preostala komponenta još nema ocenu — ovo je donja granica, ne konačan rezultat.",
    mappedPoints: "Preslikano na T bodova",
    targetOutcome: "Ishod",
    outcomeReachable: "Potrebno bodova na preostaloj komponenti",
    outcomeAlreadyMet: "Cilj je već dostignut — potrebno 0 bodova",
    outcomeUnreachable: "Nedostižno na preostaloj komponenti",
    requiredPoints: "Potreban broj bodova",

    inputs: "Uneseno",
    formula: "ukupno = 100·(Σ w_i·r_i)/Σw     a_t = ((P/100)·Σw − Σ_{i≠t} w_i·r_i)·m_t/w_t",

    errorComponents: "Unesi bar jednu komponentu.",
    errorTooManyRows: "Previše redova u jednom unosu.",
    errorComponentMax: "Maksimum svake komponente mora biti veći od nule.",
    errorComponentScored: "Osvojeni bodovi moraju biti iz [0, maksimum].",
    errorComponentWeight: "Težina komponente mora biti ≥ 0.",
    errorPendingMax: "Maksimum preostale komponente mora biti veći od nule.",
    errorPendingWeight: "Težina preostale komponente mora biti veća od nule.",
    errorWeights: "Zbir svih težina (uključujući preostalu komponentu) mora biti veći od nule.",
    errorTotalPoints: "Ukupan broj bodova mora biti veći od nule.",
    errorTargetPercent: "Ciljni procenat mora biti iz [0, 100].",
  },
} as const;
