/**
 * „Pravo i pravna praksa" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those
 * live in the `name` and `blurb` tables of `./pro.ts`.
 *
 * **A unit is copy, not a constant**, and a currency amount in this pack
 * carries none — every tool works in „the currency the user typed the amount
 * in" and never assumes dinars unless the tool is explicitly about dinars
 * (`iznos-slovima`'s built-in wording).
 *
 * **Nothing here judges.** Several tools in this pack are `legal-procedure`:
 * their copy reports days, dates and amounts, and never what a party is
 * entitled to — the core module's own output specification says so, and the
 * copy here says no more than that.
 */
export const PRO_PRAVO_SR = {
  "anuitet-otplatni-plan": {
    principal: "Glavnica",
    rate: "Nominalna godišnja kamatna stopa",
    rateHint: "Ugovorena ili propisana stopa, u procentima. Nexus ne nudi vrednost.",
    instalments: "Broj rata",
    paymentsPerYear: "Rata godišnje",
    freqMonthly: "12 (mesečno)",
    freqQuarterly: "4 (kvartalno)",
    freqSemiannual: "2 (polugodišnje)",
    freqAnnual: "1 (godišnje)",
    conversion: "Konverzija stope",
    conversionProportional: "Proporcionalna (i = p/m)",
    conversionConformal: "Konformna (i = (1+p)^(1/m) − 1)",
    dueTiming: "Dospeće rate",
    dueTimingHint: "Da li rata dospeva na kraju ili na početku obračunskog perioda.",
    dueEnd: "Na kraju perioda",
    dueStart: "Na početku perioda",
    firstDate: "Datum prve rate",
    dateHint: "Format GGGG-MM-DD. Ostavi prazno ako datum plana nije potreban.",
    noDate: "nije unet",

    results: "Rezultat",
    periodicRate: "Periodična stopa (decimalno)",
    instalment: "Iznos anuiteta",
    totalPaid: "Ukupno plaćeno",
    totalInterest: "Ukupna kamata",
    lastAdjustment: "Korekcija poslednje rate",

    notice: "Napomena o zaokruživanju",
    noticeRow: "Prvi red u kome se javlja",
    noticeExact: "Tačan anuitet (6 decimala)",
    noticeShortfall: "Razlika prema kamati na stanje (6 decimala)",
    noticeNote:
      "Zaokruživanje na 2 decimale ne pokazuje ostatak koji dug stvarno otplaćuje. Dug se i " +
      "dalje otplaćuje — dva zaokružena broja su se samo poklopila.",

    colIndex: "#",
    colDate: "Datum",
    colInterest: "Kamata",
    colPrincipal: "Otplata glavnice",
    colInstalment: "Anuitet",
    colBalance: "Preostalo stanje",

    inputs: "Uneseno",
    formula:
      "i > 0: A = G·i / (1 − (1+i)^(−n))     i = 0: A = G/n     poslednja rata = preostalo " +
      "stanje + kamata",

    errorPrincipal: "Glavnica mora biti veća od nule, najviše 10^12.",
    errorRate: "Nominalna stopa mora biti između −99 % i 1000 %.",
    errorInstalments: "Broj rata je ceo broj od 1 do 1200.",
    errorFirstDate: "Datum prve rate nije ispravan kalendarski datum.",
    errorGeneral: "Uneti podaci ne daju ispravan otplatni plan.",
  },

  "iznos-slovima": {
    amount: "Iznos",
    amountHint: "Celi deo i decimale odvojene zapetom ili tačkom, npr. 1234,56.",
    currency: "Valuta",
    currencyDinar: "Dinar/para (ugrađeni oblici)",
    currencyCustom: "Sopstvena",
    mainUnitTitle: "Oblici glavne jedinice",
    subUnitTitle: "Oblici podjedinice",
    unitOne: "Jednina (1)",
    unitFew: "Paukal (2, 3, 4)",
    unitMany: "Množina (5 i više, i 11–14)",
    unitGender: "Rod",
    genderM: "Muški",
    genderF: "Ženski",
    subUnitsPerUnit: "Podjedinica po jedinici",
    subUnitsPerUnitHint:
      "Broj podjedinica u jednoj glavnoj jedinici — 100 za valutu sa dva decimalna mesta, 0 ako " +
      "valuta nema podjedinicu. Mora biti stepen broja deset.",
    style: "Način zapisa",
    styleSpaced: "Razdvojeno rečima",
    styleJoined: "Spojeno, bez razmaka",
    capitalise: "Veliko početno slovo",
    yes: "Da",
    no: "Ne",

    results: "Rezultat",
    words: "Iznos rečima",
    wholeUnits: "Celih jedinica (tačan broj)",
    subUnits: "Podjedinica",
    typedAmount: "Otkucani iznos",
    convertedAmount: "Pretvoreni iznos",
    rounded: "Otkucano je zaokruženo",
    subUnitFraction: "Podjedinica kao razlomak",

    inputs: "Uneseno",
    formula:
      "klasa(n): o=1 ∧ t≠11 → jednina; o∈{2,3,4} ∧ t∉{12,13,14} → paukal; inače množina (t = n " +
      "mod 100, o = n mod 10); grupa hiljada = 1 → „hiljadu\"; nulta grupa se preskače sa skalom",

    errorAmount:
      "Iznos mora biti nenegativan broj sa najviše 8 decimala i celim delom do 999 999 999 999 " +
      "999.",
    errorMainUnit: "Za sopstvenu valutu unesi sva tri oblika glavne jedinice.",
    errorSubUnitsPerUnit: "Podjedinica po jedinici mora biti 0 ili stepen broja deset.",
    errorSubUnit: "Za sopstvenu valutu sa podjedinicom unesi sva tri oblika podjedinice.",
  },

  "jmbg-provera": {
    digitsInput: "JMBG",
    digitsHint:
      "13 cifara za proveru, ili 12 cifara za izračun kontrolne cifre. Razmaci, crtice i tačke " +
      "se uklanjaju pre obrade.",
    mode: "Režim",
    modeCheck: "Proveri 13 cifara",
    modeCompute: "Izračunaj kontrolnu cifru iz 12",
    yes: "Da",
    no: "Ne",
    notApplicable: "nije primenjivo u ovom režimu",

    results: "Rezultat",
    weightedSum: "Ponderisani zbir s",
    remainder: "s mod 11",
    m: "m = 11 − (s mod 11)",
    checkDigit: "Izračunata kontrolna cifra",
    matches: "Kontrolna cifra se slaže sa unetom",
    matchesNote:
      "Slaganje kontrolne cifre znači samo da zapis odgovara sopstvenoj kontrolnoj aritmetici — " +
      "ne da je broj ikada izdat, ni kome.",
    digits: "Pun trinaestocifreni zapis",

    dateTitle: "Datum iz zapisa",
    date: "Datum",
    dateExists: "Datum postoji",
    weekday: "Dan u nedelji",
    weekday1: "ponedeljak",
    weekday2: "utorak",
    weekday3: "sreda",
    weekday4: "četvrtak",
    weekday5: "petak",
    weekday6: "subota",
    weekday7: "nedelja",
    centuryRule: "Vek je izveden po pravilu",
    centuryPast: "GGG ≥ 800 → 1000 + GGG",
    centuryPresent: "GGG < 800 → 2000 + GGG",
    centuryNote:
      "Pretvaranje trocifrene godine u zapisu je konvencija, ne podatak iz zapisa — pri niskom " +
      "GGG izvedena godina može pasti u budućnost.",

    otherTitle: "Ostali elementi zapisa",
    region: "Registarski broj (RR)",
    sequence: "Redni broj (BBB)",
    sexRange: "Opseg rednog broja",
    sexRangeMale: "muški (BBB ≤ 499)",
    sexRangeFemale: "ženski (BBB ≥ 500)",

    inputs: "Uneseno",
    formula:
      "s = Σ ponder·cifra (ponderi 7,6,5,4,3,2 dvaput preko prvih 12 cifara)     m = 11 − (s mod " +
      "11)     K = m ako je 1 ≤ m ≤ 9, inače 0",

    errorDigits: "Unos mora imati tačno 13 (odnosno 12) cifara, posle uklanjanja razmaka i crtica.",
  },

  "katastarska-povrsina": {
    direction: "Smer",
    directionToParts: "m² → ha/a/m²",
    directionToSquareMetres: "ha/a/m² → m²",
    squareMetres: "Površina u m²",
    hectares: "Hektara (ceo broj)",
    ares: "Ari (ceo broj)",
    remainder: "Ostatak u m²",

    results: "Rezultat",
    composed: "Zapis",
    total: "Ukupno u m²",
    unitHa: "ha",
    unitA: "a",
    unitM2: "m²",
    wasNormalisedNote:
      "Uneti zapis nije bio normalizovan (ari preko 99 ili ostatak preko 100 m²) — prikazani " +
      "zapis je normalizovan oblik iste površine.",
    roundedNote: "Uneta vrednost je imala više od 4 decimale i zaokružena je na 4 decimale.",

    inputs: "Uneseno",
    formula:
      "T = round(m² · 10000) [desethiljaditi deo m²]     ha = floor(T / 10⁸)     " +
      "a = floor((T mod 10⁸) / 10⁶)     ostatak = (T mod 10⁸) mod 10⁶",

    errorSquareMetres: "Površina u m² mora biti od 0 do 10^10, najviše 4 decimale.",
    errorHectares: "Broj hektara je ceo broj od 0 do 10^6.",
    errorAres: "Broj ari je ceo broj od 0 na više.",
    errorRemainder: "Ostatak u m² ne sme biti negativan.",
  },

  "kazna-i-pritvor": {
    startDate: "Datum početka",
    dateHint: "Format GGGG-MM-DD.",
    years: "Kazna — godina",
    months: "Kazna — meseci",
    days: "Kazna — dana",
    creditedDays: "Dani lišenja slobode koji se odbijaju",
    creditedDaysHint: "Broj dana koji se uračunavaju u kaznu.",
    creditRatio: "Odnos uračunavanja",
    creditRatioHint:
      "Koliko dana trajanja skida jedan dan lišenja slobode. Iz propisa koji primenjuješ — Nexus " +
      "ne zna koji je to propis i ne nudi vrednost.",
    countFirstDay: "Računaj prvi dan",
    countFirstDayHint: "Konvencija brojanja, ne propis — bira se izričito.",
    fracNum: "Razlomak za proveru — brojilac",
    fractionHint:
      "Deo trajanja koji se proverava, npr. 1/2 ili 2/3. Ostavi prazno ako nije potrebno.",
    fracDen: "Razlomak za proveru — imenilac",
    fraction: "Razlomak za proveru",
    noFraction: "nije unet",
    yes: "Da",
    no: "Ne",

    results: "Rezultat",
    endDate: "Kalendarski kraj trajanja (pre konvencije brojanja)",
    lastDay: "Poslednji dan pre odbijanja",
    totalDays: "Ukupno dana",
    exactCredit: "Tačan proizvod uračunatih dana i odnosa",
    creditedDaysApplied: "Odbijeno dana (zaokruženo naniže)",
    coversWholeTerm: "Uneti dani pokrivaju čitavo trajanje — datum pre odbijanja se ne prikazuje.",
    dateAfterCredit: "Poslednji dan posle odbijanja",
    fractionTitle: "Razlomak trajanja",
    fractionDays: "Dana koje razlomak nosi",
    fractionDate: "Datum na koji razlomak pada",
    remainingDays: "Preostalo dana od tog datuma do kraja",
    weekday1: "ponedeljak",
    weekday2: "utorak",
    weekday3: "sreda",
    weekday4: "četvrtak",
    weekday5: "petak",
    weekday6: "subota",
    weekday7: "nedelja",

    inputs: "Uneseno",
    formula:
      "kraj = početak + (godine·12 + meseci) meseci + dana     poslednji dan = kraj − " +
      "(računajPrviDan ? 1 : 0)     odbijeno = floor(uračunatiDani · odnos)     danaZaDeo = " +
      "ceil(ukupno · brojilac / imenilac)",

    errorStartDate: "Datum početka nije ispravan kalendarski datum.",
    errorYears: "Broj godina je ceo broj od 0 do 100.",
    errorMonths: "Broj meseci je ceo broj od 0 do 1200.",
    errorDays: "Broj dana je ceo broj od 0 do 36500.",
    errorCreditedDays: "Uračunati dani su ceo broj, 0 ili veći.",
    errorCreditRatio: "Odnos uračunavanja mora biti veći od nule.",
    errorFraction: "Razlomak mora imati brojilac ≥ 0, imenilac > 0, i ne sme biti veći od 1.",
  },

  "nominalna-efektivna-stopa": {
    direction: "Smer",
    directionNominalToEffective: "Nominalna → efektivna",
    directionEffectiveToNominal: "Efektivna → nominalna",
    directionEffectiveToPeriodic: "Efektivna → periodična",
    directionNominalToNominal: "Nominalna pri m₁ → nominalna pri m₂",
    ratePercent: "Godišnja stopa",
    rateHint: "U procentima, od −99 do 1000.",
    compoundings: "Broj obračuna godišnje (m)",
    targetCompoundings: "Ciljni broj obračuna godišnje (m₂)",

    results: "Rezultat",
    resultPercent: "Tražena stopa",
    periodicProportional: "Periodična stopa (p/m)",
    periodicConformal: "Periodična stopa (konformna)",
    periodicPercent: "Periodična stopa",
    effectivePercent: "Efektivna godišnja stopa",
    growthFactor: "Faktor rasta za godinu dana",
    continuousPercent: "Granica pri neprekidnom ukamaćivanju",
    continuousNote:
      "Ovo je m → ∞ međa, ne poseban režim — nijedan konačan broj obračuna je ne dostiže.",

    inputs: "Uneseno",
    formula:
      "nominalna→efektivna: e = (1+p/m)^m − 1     efektivna→nominalna: p = m·((1+e)^(1/m) − 1)" +
      "     efektivna→periodična: iₚ = (1+e)^(1/m) − 1",

    errorRate: "Godišnja stopa mora biti između −99 % i 1000 %.",
    errorCompoundings: "Broj obračuna godišnje je ceo broj od 1 do 366.",
    errorTargetCompoundings: "Ciljni broj obračuna godišnje je ceo broj od 1 do 366.",
  },

  "obracun-kamate": {
    principal: "Glavnica",
    rates: "Periodi i stope",
    ratesHint:
      "Jedan red po periodu, u obliku GGGG-MM-DD; stopa — datum od kog stopa važi i godišnja " +
      "stopa u procentima. Nijedna stopa nije ugrađena, sve su tvoj unos.",
    from: "Datum od",
    to: "Datum do",
    dateHint: "Format GGGG-MM-DD.",
    method: "Metoda",
    methodConformal: "Konformna",
    methodProportional: "Proporcionalna",
    dayBasis: "Osnova dana",
    dayBasis365: "365",
    dayBasis366: "366",
    dayBasisActual: "Stvarna (365 ili 366 po godini)",
    capitalisation: "Kapitalizacija",
    capitalisationNone: "Ne",
    capitalisationAnnual: "Godišnje",
    capBoundary: "Granica kapitalizacije",
    capBoundaryCalendar: "Kalendarska godina",
    capBoundaryAnniversary: "Godišnjica od datuma od",
    includeLastDay: "Uključi poslednji dan",
    yes: "Da",
    no: "Ne",

    results: "Rezultat",
    totalInterest: "Ukupna kamata",
    principalPlusInterest: "Glavnica + kamata",
    totalDays: "Ukupno dana",
    ignoredRows: "Ignorisanih redova stope (posle datuma do)",

    colFrom: "Od",
    colTo: "Do",
    colDays: "Dana",
    colRate: "Stopa",
    colBasis: "Osnova",
    colBalance: "Stanje",
    colInterest: "Kamata",
    colYear: "Godina",

    yearlyTitle: "Kamata po kalendarskoj godini",

    inputs: "Uneseno",
    formula:
      "konformna: k = G·((1+p)^(d/B) − 1)     proporcionalna: k = G·p·d/B     " +
      "(p = godišnja stopa/100, d = dana u segmentu, B = osnova dana)",

    errorPrincipal: "Glavnica mora biti veća od nule, najviše 10^12.",
    errorFrom: "Datum od nije ispravan kalendarski datum.",
    errorTo: "Datum do nije ispravan kalendarski datum, i mora biti posle datuma od.",
    errorRates:
      "Redovi stope moraju imati ispravan datum i stopu od −99 % do 1000 %, prvi red mora početi " +
      "na datumu od ili pre njega.",
    errorDayBasis: "Osnova dana nije prepoznata.",
    errorCapBoundary: "Za godišnju kapitalizaciju izaberi granicu kapitalizacije.",
  },

  "podela-iznosa": {
    totalAmount: "Ukupan iznos",
    weights: "Udeli",
    weightsHint:
      "Jedna težina po redu — ceo broj, razlomak b/i (npr. 1/3), ili procenat (npr. 25%). Zapisi " +
      "se mogu mešati.",
    smallestUnit: "Najmanja jedinica",
    unit001: "0,01",
    unit1: "1",
    unit100: "100",
    remainderRule: "Raspodela ostatka",
    ruleLargestRemainder: "Najveći ostatak (Hamilton)",
    ruleFirstFirst: "Redom od prvog",
    yes: "Da",
    no: "Ne",

    results: "Rezultat",
    share: "Lice",
    colIndex: "#",
    colUnits: "Jedinica",
    colAmount: "Iznos",
    colExact: "Tačan udeo (nezaokružen)",
    colRemainder: "Dodeljena jedinica ostatka",
    colDeviation: "Odstupanje od tačnog udela",
    checksum: "Kontrolni zbir",
    total: "Raspodeljeno ukupno (N × jedinica)",
    totalAmountEntered: "Otkucani ukupan iznos",
    roundingDifference: "Razlika (raspodeljeno − otkucano)",
    remainderUnits: "Broj jedinica ostatka",
    ruleApplied: "Primenjeno pravilo raspodele",

    inputs: "Uneseno",
    formula:
      "wᵢ = pᵢ·(Q/qᵢ), Q = NZS(qᵢ)     N = round(|iznos|/jedinica)     " +
      "bᵢ = floor(N·wᵢ/W)     ostatak R = N − Σbᵢ, deli se po pravilu raspodele",

    errorTotalAmount: "Ukupan iznos mora biti između −10^12 i 10^12.",
    errorWeights: "Udeli moraju biti 1 do 500 težina, svaka nenegativna, bar jedna veća od nule.",
    errorSmallestUnit: "Najmanja jedinica nije prepoznata.",
  },

  "racun-iban-provera": {
    regime: "Režim",
    regimeDomaci: "Domaći račun (3-13-2)",
    regimeIban: "IBAN",
    regimeMod97: "Kontrolni broj po modulu 97",
    mode: "Radnja",
    modeCheck: "Provera",
    modeCompute: "Izračunavanje kontrolnog broja",
    account: "Broj računa",
    accountHint: "18 cifara za proveru, 16 cifara (3 banka + 13 partija) za izračunavanje.",
    iban: "IBAN",
    ibanHint: "5 do 34 znaka, slova i cifre. Razmaci se uklanjaju, mala slova postaju velika.",
    bban: "BBAN",
    country: "Oznaka države",
    countryHint: "Dva slova, npr. RS. Dužina IBAN-a po državama se ne proverava.",
    digits: "Niz cifara",
    yes: "Da",
    no: "Ne",
    notApplicable: "nije primenjivo u ovom režimu",

    results: "Rezultat",
    grouped: "Zapis u grupama od po četiri",
    bank: "Banka",
    accountNumber: "Partija",
    digitsFull: "Pun niz sa kontrolnim brojem",
    checkDigits: "Kontrolni broj",
    remainder: "Ostatak pri deljenju sa 97",
    matches: "Kontrolni broj se slaže",
    matchesNote:
      "Slaganje po modulu 97 znači samo da se niz slaže sa sopstvenom kontrolnom aritmetikom — " +
      "ne da račun postoji, da je otvoren, ni čiji je.",

    inputs: "Uneseno",
    formula:
      "r = 0; za svaku cifru c: r = (r·10 + c) mod 97     kontrolni = 98 − mod97(niz ‖ „00\")",

    errorAccount: "Broj računa mora imati tačno 18 (provera) ili 16 (izračunavanje) cifara.",
    errorIban: "IBAN mora imati dva slova države, dve kontrolne cifre u opsegu 02–98, i BBAN.",
    errorBban: "Za izračunavanje unesi ispravan BBAN i dvoslovnu oznaku države.",
    errorDigits: "Niz mora imati 1 do 60 cifara (bar 3 za proveru).",
  },

  "radni-dani": {
    from: "Od datuma",
    to: "Do datuma",
    dateHint: "Format GGGG-MM-DD.",
    includeLastDay: "Uključi poslednji dan",
    weekdays: "Neradni dani u nedelji",
    weekdaysHint:
      "Brojevi 1–7 odvojeni zapetom (1 = ponedeljak … 7 = nedelja). Nijedan dan nije ugrađen kao " +
      "neradan.",
    dates: "Neradni datumi",
    datesHint:
      "Jedan datum po redu, GGGG-MM-DD. Alatka ne nosi nijedan datum — spisak je tvoj unos.",
    yes: "Da",
    no: "Ne",

    results: "Rezultat",
    calendarDays: "Kalendarskih dana",
    workingDays: "Radnih dana",
    weekdayNonWorking: "Neradnih po danu u nedelji",
    listedNonWorking: "Neradnih po unetom spisku",
    listedInRange: "Unetih datuma u opsegu",
    fullWeeks: "Punih sedmica",
    remainderDays: "Ostatak dana",
    reversedNote:
      "Uneti datumi su bili obrnuti — granice su zamenjene, broj dana je i dalje pozitivan.",
    effectiveLastDate: "Poslednji dan opsega posle eventualne zamene",
    firstWorkingDay: "Prvi radni dan",
    lastWorkingDay: "Poslednji radni dan",
    datesOutOfRange: "Uneti datumi van opsega",

    inputs: "Uneseno",
    formula:
      "za svaki dan x u opsegu: neradanPoNedelji || unetNeradan || radan — redosled je bitan, " +
      "dan se broji jednom",

    errorFrom: "Datum od nije ispravan kalendarski datum.",
    errorTo: "Datum do nije ispravan kalendarski datum.",
    errorWeekdays: "Neradni dani u nedelji moraju biti brojevi 1 do 7, bez ponavljanja.",
    errorDates: "Spisak neradnih datuma sme imati najviše 400 datuma, svi ispravni.",
  },

  "rok-poslednji-dan": {
    direction: "Smer",
    directionForward: "Unapred",
    directionBackward: "Unazad",
    startDate: "Početni datum",
    endDate: "Krajnji datum",
    dateHint: "Format GGGG-MM-DD.",
    length: "Dužina roka",
    unit: "Jedinica",
    unitDays: "Dani",
    unitMonths: "Meseci",
    unitYears: "Godine",
    countStartDay: "Računaj početni dan",
    countStartDayHint: "Izričit prekidač, ne skrivena pretpostavka.",
    weekdays: "Neradni dani u nedelji",
    weekdaysHint: "Brojevi 1–7 odvojeni zapetom (1 = ponedeljak … 7 = nedelja).",
    dates: "Neradni datumi",
    datesHint: "Jedan datum po redu, GGGG-MM-DD. Alatka ne nosi nijedan datum.",
    shift: "Pomeranje sa neradnog dana",
    shiftNone: "Bez pomeranja",
    shiftForward: "Na prvi naredni radni dan",
    shiftBackward: "Na prvi prethodni radni dan",
    yes: "Da",
    no: "Ne",

    results: "Rezultat",
    rawLastDay: "Poslednji dan pre pomeranja",
    lastDay: "Poslednji dan posle pomeranja",
    shiftedByDays: "Pomereno za (dana)",
    totalDays: "Ukupno kalendarskih dana do isteka (posle pomeranja)",
    totalDaysBeforeShift: "Ukupno kalendarskih dana do isteka (pre pomeranja)",
    expiredNote: "Rok nulte dužine sa uključenim početnim danom ističe pre nego što počne.",
    candidateStart: "Mogući početni datum",
    colStart: "Mogući početni datum",
    colRawLast: "Poslednji dan pre pomeranja",
    colLast: "Poslednji dan posle pomeranja",
    noCandidates: "Nijedan početni datum ne daje uneti krajnji datum uz uneto trajanje.",
    weekday1: "ponedeljak",
    weekday2: "utorak",
    weekday3: "sreda",
    weekday4: "četvrtak",
    weekday5: "petak",
    weekday6: "subota",
    weekday7: "nedelja",

    inputs: "Uneseno",
    formula:
      "dani: poslednji = početak + dužina − (računajPočetniDan ? 1 : 0)     " +
      "meseci/godine: min(dan, danaUMesecu(ciljnaGodina, ciljniMesec))     " +
      "pomeranje: +1/−1 dan dok je dan neradan",

    errorDate: "Datum nije ispravan kalendarski datum.",
    errorLength: "Dužina roka je ceo broj od 0 do 36500.",
    errorWeekdays: "Neradni dani u nedelji moraju biti brojevi 1 do 7, bez ponavljanja.",
    errorDates: "Spisak neradnih datuma sme imati najviše 400 datuma, svi ispravni.",
  },

  "strane-teksta": {
    text: "Tekst",
    textHint: "Nalepljen tekst, do 2 000 000 karaktera.",
    charactersPerPage: "Karaktera po obračunskoj strani",
    charactersPerPageHint: "Iz tarife koju primenjuješ. Nexus ne nudi vrednost.",
    countSpaces: "Računaj razmake",
    countSpacesHint: "Postoje dve prakse i razlika je velika.",
    yes: "Da",
    no: "Ne",
    rounding: "Zaokruživanje",
    roundingUp: "Naviše na celu stranu",
    roundingHalf: "Na pola strane",
    roundingExact: "Tačno",
    pricePerPage: "Cena po strani",
    priceHint: "Opciono. Iz tarife ili ugovora koji primenjuješ.",

    results: "Rezultat",
    charsBefore: "Karaktera pre NFC normalizacije",
    charsWith: "Karaktera sa razmacima",
    charsWithout: "Karaktera bez razmaka",
    words: "Reči",
    lines: "Redova",
    exactPages: "Strana tačno",
    pagesUp: "Strana naviše",
    pagesHalf: "Strana na pola",
    billedPages: "Naplaćeno strana (po izabranom zaokruživanju)",
    amount: "Iznos",

    inputs: "Uneseno",
    formula:
      "osnova = računajRazmake ? saRazmacima : bezRazmaka     straneTačno = osnova / " +
      "karakteraPoStrani     straneNaviše = ceil(straneTačno)     stranePola = " +
      "ceil(straneTačno·2)/2",

    errorText: "Tekst sme imati najviše 2 000 000 karaktera.",
    errorCharactersPerPage: "Karaktera po strani je ceo broj od 1 do 100000.",
    errorPrice: "Cena po strani ne sme biti negativna.",
  },

  "suvlasnicki-udeli": {
    shares: "Udeli",
    sharesHint: "Jedan razlomak brojilac/imenilac po redu, npr. 1/3.",
    totalArea: "Ukupna površina",
    totalAreaHint: "U m². Opciono — bez nje kolona površine se ne prikazuje.",
    targetDenominator: "Ciljni imenilac",
    targetDenominatorHint:
      "Opciono. Bez njega se koristi najmanji zajednički sadržalac unetih imenilaca.",
    yes: "Da",
    no: "Ne",

    results: "Rezultat",
    colIndex: "#",
    colFraction: "Skraćen oblik",
    colCommon: "Na zajedničkom imeniocu",
    colPercent: "Procenat",
    colArea: "Površina (m²)",
    colTarget: "Na ciljnom imeniocu",
    doesNotFit: "ne staje bez ostatka",
    isWhole: "Zbir jeste celina",
    commonDenominator: "Zajednički imenilac",
    sumNumerator: "Zbir brojilaca na zajedničkom imeniocu",
    difference: "Razlika do celine",

    inputs: "Uneseno",
    formula:
      "g = NZD(b, i); udeo = (b/g)/(i/g)     L = NZS svih skraćenih imenilaca     " +
      "Σ == L ⟺ zbir je celina, poređenje celih brojeva",

    errorShares: "Udeli su 1 do 200 razlomaka, brojilac ≥ 0, imenilac > 0.",
    errorTotalArea: "Ukupna površina mora biti veća od nule, najviše 10^9 m².",
    errorTargetDenominator: "Ciljni imenilac je ceo broj od 1 do 10^9.",
  },

  "troskovi-srazmerno-uspehu": {
    source: "Izvor srazmere uspeha",
    sourceAmounts: "Odnos traženog i usvojenog iznosa",
    sourcePercent: "Direktno unet procenat",
    claimed: "Traženi iznos",
    awarded: "Usvojeni iznos",
    successPercentLabel: "Srazmera uspeha",
    firstCosts: "Troškovi prve strane",
    secondCosts: "Troškovi druge strane",

    results: "Rezultat",
    successPercent: "Srazmera uspeha",
    complementPercent: "Dopuna do 100 %",
    firstShare: "Srazmerni deo troškova prve strane",
    secondShare: "Srazmerni deo troškova druge strane",
    difference: "Razlika",
    sideFirst: "na stranu prve",
    sideSecond: "na stranu druge",
    sideNone: "nema razlike",

    inputs: "Uneseno",
    formula:
      "u = usvojen/tražen (ili direktno uneta srazmera)     prva = troškoviPrve · u     " +
      "druga = troškoviDruge · (1 − u)",

    errorClaimed: "Traženi iznos mora biti veći od nule, najviše 10^12.",
    errorAwarded: "Usvojeni iznos mora biti između 0 i traženog iznosa.",
    errorSuccessPercent: "Srazmera uspeha mora biti između 0 % i 100 %.",
    errorFirstCosts: "Troškovi prve strane ne smeju biti negativni.",
    errorSecondCosts: "Troškovi druge strane ne smeju biti negativni.",
  },

  "ugovorna-kazna": {
    base: "Osnovica",
    dailyRate: "Dnevna stopa",
    dailyRateHint: "Procenat po danu, iz ugovora. Nexus ne nudi vrednost.",
    dataSource: "Izvor broja dana",
    dataSourceDays: "Broj dana",
    dataSourceDates: "Par datuma",
    delayDays: "Dana docnje",
    agreedDate: "Ugovoreni rok",
    actualDate: "Stvarno ispunjenje",
    dateHint: "Format GGGG-MM-DD.",
    capPercent: "Ograničenje (procenat osnovice)",
    capPercentHint:
      "Iz ugovora ili propisa. Opciono — bez njega penal nije ograničen. Nexus ne nudi vrednost.",
    includeCompletionDay: "Uključi dan ispunjenja",
    yes: "Da",
    no: "Ne",

    results: "Rezultat",
    dailyAmount: "Iznos po jednom danu docnje",
    amount: "Iznos posle primene ograničenja",
    uncappedAmount: "Penal bez ograničenja",
    capAmount: "Iznos ograničenja",
    capRatio: "Odnos",
    capDay: "Dan docnje na kome se dostiže ograničenje",
    noCapDayNote: "Pri dnevnoj stopi 0 % ograničenje se nikad ne dostiže — dan nije definisan.",

    inputs: "Uneseno",
    formula:
      "penal = osnovica·(dnevnaStopa/100)·danaDocnje     granica = osnovica·(ograničenje/100)    " +
      " danGranice = ceil(ograničenje/dnevnaStopa)",

    errorBase: "Osnovica mora biti veća od nule, najviše 10^12.",
    errorDailyRate: "Dnevna stopa mora biti između 0 % i 100 %.",
    errorCapPercent: "Ograničenje mora biti između 0 % i 1000 %.",
    errorAgreedDate: "Ugovoreni rok nije ispravan kalendarski datum.",
    errorActualDate: "Stvarno ispunjenje nije ispravan kalendarski datum.",
    errorDataSource: "Popuni ili broj dana ili par datuma, nikad oba.",
  },

  "zbir-perioda": {
    periods: "Periodi",
    periodsHint: "Jedan period po redu, GGGG-MM-DD do GGGG-MM-DD.",
    includeLastDay: "Uključi poslednji dan",
    convention: "Konvencija razlaganja",
    conventionHint: "Kalendarska konvencija je dostupna samo kad je unet tačno jedan period.",
    convention30360: "30/360",
    conventionCalendar: "Kalendarska",
    yes: "Da",
    no: "Ne",

    results: "Rezultat",
    totalDays: "Ukupno dana",
    decomposition: "Razlaganje",
    conventionApplied: "Primenjena konvencija",
    unitYears: "godina",
    unitMonths: "meseci",
    unitDays: "dana",

    rowsTitle: "Periodi",
    colIndex: "#",
    colDays: "Dana",
    colReversed: "Obrnut (nije sabran)",

    overlapsTitle: "Preklapanja",
    noOverlaps: "Nema preklapanja među unetim periodima.",
    overlapsNote:
      "Alatka preklapanje samo pokazuje — da li se dvostruko računa zavisi od toga šta se " +
      "sabira, a to alatka ne zna.",
    colFirst: "Prvi period",
    colSecond: "Drugi period",
    colFrom: "Od",
    colTo: "Do",
    colOverlapDays: "Dana preklapanja",

    inputs: "Uneseno",
    formula:
      "dₖ = redniDan(doₖ) − redniDan(odₖ) + uključiPoslednjiDan     30/360: godine=floor(D/360), " +
      "meseci=floor((D mod 360)/30), dani=(D mod 360) mod 30",

    errorPeriods: "Periodi su 1 do 200 parova datuma, svaki ispravan.",
    errorConvention: "Kalendarska konvencija zahteva tačno jedan period.",
  },
} as const;
