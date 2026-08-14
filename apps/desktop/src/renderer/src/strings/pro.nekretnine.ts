/**
 * „Nekretnine" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment and `nekretnine.tsx`
 * spell it. The tool's NAME and its one-line blurb are not here: those live in
 * a table another process owns.
 *
 * **A unit is copy, not a constant** — written here, never concatenated raw in
 * the surface. **Nothing in here judges**: every regulated figure (a rate, an
 * index, a coefficient, a notice period) is „koje uneseš"/„koji uneseš", never
 * described as correct or permitted, and every comparison against the user's
 * own limit is a bare ratio with no sentence about what it means.
 */
export const PRO_NEKRETNINE_SR = {
  "cashflow-npv-irr": {
    flows: "Novčani tokovi",
    flowsHint:
      "Jedan tok po redu, po redosledu perioda počev od CF₀. Odliv sa minusom, npr. -1000 pa 600 pa 600.",
    discountRate: "Diskontna stopa po periodu",
    discountRateHint: "Tvoj zahtevani prinos po periodu, u procentima. Alatka nijedan ne pretpostavlja.",
    periodLabel: "Oznaka perioda",
    periodLabelHint: "Samo natpis iznad tabele — ne ulazi u račun.",
    periodYear: "godina",
    periodMonth: "mesec",
    periodQuarter: "kvartal",

    results: "Rezultat",
    colPeriod: "Period",
    colCashflow: "Tok",
    colDiscounted: "Diskontovano",
    npv: "NSV",
    undiscountedTotal: "Zbir nediskontovanih tokova",
    paybackPlain: "Period povraćaja (nediskontovano)",
    paybackDiscounted: "Period povraćaja (diskontovano)",
    paybackNone: "u unetom nizu povraćaja nema",
    irr: "ISP (IRR)",
    irrNoSignChange: "svi tokovi su istog znaka — ISP se ne prikazuje",
    irrNotUnique: "niz nema tačno jednu promenu znaka — ISP nije jedinstven i ne prikazuje se",
    irrOutsideRange: "koren nije u pretraživanom opsegu [−99,99%; 1000%]",
    signChanges: "Broj promena znaka",

    inputs: "Uneseno",
    formula: "NSV = Σ CF_t / (1+r)^t     ISP: NSV(x) = 0, samo ako niz ima tačno jednu promenu znaka",

    errorCashflows: "Unesi bar jedan novčani tok, po jedan broj u redu.",
    errorDiscountRate: "Diskontna stopa mora biti veća od −100%.",

    unitPercent: "%",
    unitPeriods: "perioda",
  },

  "cost-allocation": {
    total: "Ukupan iznos za raspodelu",
    totalHint: "Novčana jedinica se ne imenuje. Može biti i negativan (povraćaj).",
    rows: "Redovi",
    rowsHint: "Jedan red po stavci: naziv;ključ, npr. Stan A;45,50 — ključ je m² ili bilo koja pozitivna težina.",
    step: "Korak zaokruživanja",
    stepHint: "Novčana jedinica, npr. 0,01 ili 1. Podrazumevano 0,01.",

    results: "Rezultat",
    colName: "Naziv",
    colShare: "Udeo",
    colExact: "Tačan iznos",
    colUnits: "Jedinice",
    colAmount: "Konačan iznos",
    colRemainder: "Ostatak",
    checkSum: "Kontrolni zbir",
    remainderUnits: "Jedinica ostatka podeljeno",
    remainderRuleNote:
      "Ostatak ide redovima sa najvećim razlomljenim delom; kod jednakih ostataka prednost ima ranije unet red.",

    inputs: "Uneseno",
    formula: "iznos_i = ukupno × ključ_i / Σključ, u celim jedinicama koraka, ostatak po najvećem razlomku",

    errorTotal: "Ukupan iznos mora biti umnožak koraka zaokruživanja.",
    errorStep: "Korak zaokruživanja mora biti veći od nule.",
    errorWeights: "Svaki red mora imati naziv i ključ raspodele veći od nule.",

    yes: "da",
    no: "ne",
  },

  "late-payment-interest": {
    debt: "Iznos duga",
    annualRate: "Godišnja kamatna stopa",
    annualRateHint: "Iz ugovora ili iz propisa koji primenjuješ. Nexus nijednu ne zna i nijednu ne nudi.",
    dueDate: "Datum dospeća",
    dateHint: "Format dd.mm.gggg.",
    paymentDate: "Datum plaćanja",
    days: "Broj dana docnje (alternativno)",
    daysHint: "Popuni ovo umesto oba datuma, ili uz datum dospeća radi provere da se dva unosa poklapaju.",
    basis: "Osnovica godine",
    basis365: "365 dana",
    basis360: "360 dana",
    basisActual: "stvarni broj dana (ACT/ACT)",
    method: "Metod",
    methodProportional: "proporcionalni",
    methodConformal: "konformni",

    results: "Rezultat",
    countingRuleNote: "Dan dospeća se ne broji, dan plaćanja se broji.",
    days2: "Broj dana docnje",
    yearFraction: "Vremenski udeo f",
    interest: "Obračunata kamata",
    total: "Ukupno za plaćanje",
    ratioToDebt: "Odnos kamate prema dugu",
    interestPerDay: "Kamata po danu docnje",
    interestPerDayNone: "nema dana docnje",
    compoundsAnnuallyNote:
      "Konformni metod kapitalizuje kamatu godišnje na periodu dužem od godinu dana — da li je to dozvoljeno je pravno pitanje koje alatka ne odlučuje.",
    impliedPaymentDate: "Datum plaćanja koji sledi iz unetog broja dana",
    colYear: "Godina",
    colDaysInYear: "Dana u toj godini",
    colYearLength: "Delilac (dužina godine)",

    inputs: "Uneseno",
    formula:
      "proporcionalno: K = dug × stopa/100 × f     konformno: K = dug × ((1+stopa/100)^f − 1)     f = dani/osnovica",

    errorDebt: "Iznos duga mora biti veći od nule.",
    errorAnnualRate: "Godišnja kamatna stopa je od 0 do 1000%.",
    errorDueDate: "Datum dospeća nije ispravan datum, ili nedostaje za osnovicu 'stvarni broj dana'.",
    errorPaymentDate: "Datum plaćanja nije ispravan datum ili je pre datuma dospeća.",
    errorDays: "Broj dana docnje je ceo broj od 0 do 400000.",

    unitPercent: "%",
  },

  "lease-term-dates": {
    start: "Datum početka",
    dateHint: "Format dd.mm.gggg.",
    months: "Trajanje (meseci)",
    noticeAmount: "Otkazni rok",
    noticeHint: "Iz tvog ugovora. Nexus nijedan rok ne poznaje i nijedan ne predlaže.",
    noticeUnit: "Jedinica otkaznog roka",
    noticeUnitDays: "dani",
    noticeUnitMonths: "meseci",
    installmentDay: "Dan dospeća rate u mesecu",
    installmentDayHint: "Ceo broj od 1 do 31. Ostavi prazno da se spisak rata ne prikazuje.",

    results: "Rezultat",
    expiry: "Datum isteka",
    clamped: "dan skraćen na kraj kraćeg meseca",
    expiryDayClamped: "skraćeno",
    expiryClampedNote:
      "Dan je skraćen na poslednji dan kraćeg meseca. Ovo je izbor konvencije, ne činjenica o kojoj se ugovori uvek slažu.",
    lastValidDay: "Poslednji dan važenja",
    noticeDeadline: "Najkasniji datum otkaza",
    beforeStart: "pre datuma početka ugovora",
    noticeBeforeStartNote: "Uneti otkazni rok je duži od trajanja — ovaj datum pada pre početka ugovora.",
    totalDays: "Ukupno trajanje (dana)",
    colInstallmentNo: "Broj rate",
    colInstallmentDate: "Datum dospeća",
    installmentsAdvanceNote: "Spisak pretpostavlja zakupninu unapred — svaka rata dospeva na početku svog perioda.",

    inputs: "Uneseno",
    formula: "istek = početak + trajanje meseci (dan zaseca se na kraj kraćeg meseca)     otkaz = poslednji_dan − rok",

    errorStart: "Datum početka nije ispravan datum.",
    errorMonths: "Trajanje je ceo broj meseci od 1 do 600.",
    errorNoticeAmount: "Otkazni rok je ceo broj od 0 do 100000.",
    errorNoticeUnit: "Uz otkazni rok mora biti izabrana jedinica.",
    errorInstallmentDay: "Dan dospeća rate je ceo broj od 1 do 31.",
  },

  "loan-amortization": {
    principal: "Iznos kredita",
    annualRate: "Nominalna godišnja kamatna stopa",
    annualRateHint: "Ugovorna/tržišna veličina. Nexus nijednu ne pamti i nijednu ne nudi.",
    months: "Broj mesečnih rata",
    balanceMonth: "Mesec za koji se traži ostatak duga",
    balanceMonthHint: "Ceo broj od 0 do broja rata. Opciono.",
    prepayment: "Iznos prevremene uplate",
    prepaymentMonth: "Mesec prevremene uplate",
    prepaymentMonthHint: "Ceo broj od 0 do (broj rata − 1) — uplata odmah posle te rate. Opciono.",

    results: "Rezultat",
    conventionNote: "Mesečna stopa i = NKS/12 (proporcionalna konvencija). Konformna konvencija daje drugačije brojeve.",
    payment: "Mesečna rata",
    totalPaid: "Ukupno plaćeno",
    totalInterest: "Ukupna kamata",
    principalSum: "Kontrolni zbir glavnica",
    balanceAt: "Ostatak duga posle te rate",
    colMonth: "Rata",
    colPayment: "Iznos rate",
    colInterest: "Kamata",
    colPrincipal: "Otplata glavnice",
    colBalance: "Ostatak duga",
    payoff: "Iznos zatvaranja kredita",
    closesNote: "Uplata je jednaka ili veća od ostatka duga — kredit se zatvara odmah, bez preostalih rata.",
    balanceBefore: "Ostatak duga pre uplate",
    balanceAfter: "Ostatak duga posle uplate",
    shorterTerm: "Varijanta A — ista rata, kraći rok",
    lowerPayment: "Varijanta B — isti rok, niža rata",
    instalments: "Preostali broj rata",
    finalPayment: "Poslednja (umanjena) rata",
    interestSavings: "Ušteda na kamati u odnosu na plan bez uplate",

    inputs: "Uneseno",
    formula: "i = NKS/100/12     A = P·i / (1 − (1+i)^(−n))     tabela iz zaokružene rate i zaokružene kamate po mesecu",

    errorPrincipal: "Iznos kredita mora biti veći od nule.",
    errorAnnualRate: "Nominalna godišnja kamatna stopa je od 0 do 100%.",
    errorMonths: "Broj mesečnih rata je ceo broj od 1 do 600.",
    errorBalanceMonth: "Mesec za ostatak duga je ceo broj od 0 do broja rata.",
    errorPrepayment: "Iznos prevremene uplate mora biti veći od nule.",
    errorPrepaymentMonth: "Mesec prevremene uplate je ceo broj od 0 do (broj rata − 1).",

    unitPercent: "%",
  },

  "ownership-shares": {
    rows: "Udeli",
    rowsHint: "Jedan udeo po redu, kao razlomak brojilac/imenilac, npr. 1/3.",
    totalArea: "Ukupna površina",
    totalAreaHint: "m², opciono — dodaje površinu svakog udela u tabelu.",

    results: "Rezultat",
    colRow: "Red",
    colFraction: "Udeo (skraćeno)",
    colPercent: "Procenat",
    colAtCommonDenominator: "Nad zajedničkim imeniocem",
    colArea: "Površina",
    sum: "Zbir udela",
    comparison: "Odnos prema celini",
    comparisonExact: "zbir je tačno 1",
    comparisonShort: "do celine nedostaje",
    comparisonOver: "preko celine je",
    commonDenominator: "Zajednički imenilac",
    areaCheckSum: "Kontrolni zbir zaokruženih površina",

    reverseTitle: "Obrnuti smer: udeo iz dve površine",
    partArea: "Površina dela",
    wholeArea: "Ukupna površina",
    reverseFraction: "Udeo (skraćeno)",
    reversePercent: "Procenat",

    inputs: "Uneseno",
    formula: "a/b + c/d = (ad+cb)/(bd), skraćeno Euklidom     procenat = brojilac × 100 / imenilac, pola naviše",

    errorRows: "Unesi bar jedan udeo kao razlomak.",
    errorNumerator: "Brojilac je ceo broj od 0 do 10^15.",
    errorDenominator: "Imenilac je ceo broj veći od 0, do 10^15.",
    errorTotalArea: "Ukupna površina mora biti veća od nule.",
    errorPartArea: "Površina dela mora biti veća od nule, do dve decimale.",
    errorWholeArea: "Ukupna površina mora biti veća od nule, do dve decimale.",

    unitM2: "m²",
  },

  "parcel-polygon-area": {
    points: "Tačke",
    pointsHint:
      "Jedna tačka po redu, po redosledu obilaska: x;y, npr. 7459123,456;4876543,210. Pravougli (metarski) sistem — geografska širina/dužina u stepenima nije dozvoljen unos.",

    results: "Rezultat",
    area: "Površina",
    ares: "Površina u arima",
    hectares: "Površina u hektarima",
    perimeter: "Obim",
    orientation: "Smer obilaska",
    orientationCcw: "suprotno kazaljci",
    orientationCw: "u smeru kazaljke",
    orientationNote:
      "Zamena kolona x i y ne menja ni površinu ni obim, samo predznak ovog smera — nije provera ispravnosti unosa.",
    colEdge: "Stranica",
    colLength: "Dužina",

    inputs: "Uneseno",
    formula: "A = |Σ(xᵢyᵢ₊₁ − xᵢ₊₁yᵢ)| / 2     O = Σ √((xᵢ₊₁−xᵢ)² + (yᵢ₊₁−yᵢ)²)",

    errorPoints: "Unesi bar tri različite tačke, po redosledu obilaska.",
    errorSelfIntersecting: "Stranice se seku ili dodiruju — proveri redosled i vrednosti tačaka.",
    errorCollinear: "Sve tačke su na istoj pravoj — ovo nije poligon.",

    unitM2: "m²",
    unitAre: "a",
    unitHa: "ha",
    unitM: "m",
  },

  "plot-density-index": {
    plotArea: "Površina parcele",
    grossFloorArea: "Bruto razvijena građevinska površina (BRGP)",
    footprint: "Površina pod objektom",
    planRatio: "Indeks izgrađenosti iz plana",
    planLimitHint: "Iz planskog dokumenta za tu parcelu. Nexus nijedan indeks ne poznaje i nijedan ne nudi.",
    planCoverage: "Indeks zauzetosti iz plana",

    results: "Rezultat",
    brgpScopeNote:
      "Šta ulazi u BRGP (terase, lođe, garaže, podrum) određuje plan ili pravilnik koji primenjuješ — alatka samo deli uneti broj.",
    ratio: "Indeks izgrađenosti",
    coverage: "Zauzetost",
    freeArea: "Slobodna površina parcele",
    freeAreaPercent: "Slobodna površina, procenat parcele",
    floorAreaToFootprintRatio: "Odnos BRGP i površine pod objektom",
    grossFloorAreaAtPlanRatio: "BRGP pri unetom indeksu",
    grossFloorAreaDifference: "Razlika: BRGP pri unetom indeksu − uneta BRGP",
    ratioAgainstPlan: "Izračunati indeks ÷ indeks iz plana",
    footprintAtPlanCoverage: "Površina pod objektom pri unetoj zauzetosti",
    footprintDifference: "Razlika: površina pri unetoj zauzetosti − uneta površina pod objektom",
    coverageAgainstPlan: "Izračunata zauzetost ÷ zauzetost iz plana",

    inputs: "Uneseno",
    formula:
      "indeks = BRGP/parcela     zauzetost = pod_objektom/parcela × 100     BRGP_pri_indeksu = parcela × indeks",

    errorPlotArea: "Površina parcele mora biti veća od nule.",
    errorGrossFloorArea: "BRGP ne sme biti negativna.",
    errorFootprint: "Površina pod objektom ne sme biti negativna.",
    errorPlanRatio: "Indeks izgrađenosti iz plana mora biti veći od nule.",
    errorPlanCoverage: "Indeks zauzetosti iz plana je od 0 do 100%, veći od nule.",

    unitM2: "m²",
  },

  "pro-rata-days": {
    total: "Ukupan iznos za period",
    dateHint: "Format dd.mm.gggg.",
    periodStart: "Datum početka perioda",
    periodEnd: "Datum kraja perioda (uključivo)",
    handover: "Datum primopredaje",
    handoverHint: "Prvi dan koji pripada drugom korisniku. Od datuma početka do datuma kraja + 1 dan.",
    basis: "Osnovica brojanja",
    basisAct: "stvarni dani (ACT)",
    basisE30360: "30E/360",

    results: "Rezultat",
    daysFirst: "Dana prvog korisnika",
    daysSecond: "Dana drugog korisnika",
    totalDays: "Ukupno dana u periodu",
    amountFirst: "Iznos prvog korisnika",
    amountSecond: "Iznos drugog korisnika",
    checkSum: "Kontrolni zbir",

    inputs: "Uneseno",
    formula: "n_A = dani(početak, primopredaja)     iznos_A = ukupno × n_A / N     iznos_B = ukupno − iznos_A",

    errorTotal: "Ukupan iznos ne sme biti negativan.",
    errorPeriodStart: "Datum početka perioda nije ispravan datum.",
    errorPeriodEnd: "Datum kraja perioda nije ispravan datum ili je pre datuma početka.",
    errorHandover: "Datum primopredaje nije ispravan datum ili je van perioda (uz jedan dan posle kraja).",
  },

  "rent-escalation": {
    baseRent: "Početna zakupnina po periodu",
    periods: "Broj perioda",
    indexMode: "Način unosa indeksa",
    modeFixed: "fiksan procenat",
    modeList: "lista po periodu",
    fixedIndex: "Indeks po periodu",
    indexHint: "Procenat po periodu. Nexus nijedan indeks ne zna i nijedan ne pamti.",
    listMode: "Lista indeksa",
    listHint:
      "Jedan procenat po redu, onoliko redova koliko ima perioda. Prvi red se ne koristi (period 1 se ne indeksira) — upiši bilo šta, npr. crticu.",
    discountRate: "Diskontna stopa po periodu",

    results: "Rezultat",
    conventionNote: "Prvi period se ne indeksira; plaćanje je na početku perioda.",
    colPeriod: "Period",
    colRent: "Zakupnina",
    total: "Ukupno za ceo rok",
    average: "Prosečna zakupnina po periodu",
    closedFormTotal: "Kontrola zatvorenim oblikom",
    presentValue: "Sadašnja vrednost zakupa",

    inputs: "Uneseno",
    formula: "R_t = R_(t−1) × (1 + indeks_t/100)     SV = Σ R_t / (1 + diskontna/100)^(t−1)",

    errorBaseRent: "Početna zakupnina mora biti veća od nule.",
    errorPeriods: "Broj perioda je ceo broj od 1 do 600.",
    errorIndex: "Indeks nije ispravan — proveri fiksni procenat ili listu (mora imati onoliko redova koliko ima perioda).",
    errorDiscountRate: "Diskontna stopa mora biti veća od −100%.",

    unitPercent: "%",
    unitLines: "redova",
  },

  "rent-gross-net": {
    gross: "Bruto iznos (ugovoreni)",
    grossHint: "Unesi jedan od dva iznosa — bruto ili neto. Ako uneseš oba, računa se iz bruta.",
    net: "Neto iznos (koji ostaje)",
    costPercent: "Procenat priznatih (normiranih) troškova",
    costPercentHint: "Iz propisa koji primenjuješ. Nexus nijedan procenat ne zna i nijedan ne nudi.",
    taxRate: "Stopa",
    taxRateHint: "Iz propisa koji primenjuješ. Nexus nijednu stopu ne zna i nijednu ne nudi.",

    results: "Rezultat",
    base: "Osnovica",
    taxAmount: "Obračunati iznos po stopi (osnovica × stopa)",
    netRoundingResidual: "Kontrola: neto − (bruto − iznos po stopi), nezaokruženo",
    effectiveShare: "Efektivni udeo u odnosu na bruto",
    impliedEffectiveShare: "Efektivni udeo izveden iz oba unesena iznosa (1 − neto/bruto)",
    computedFrom: "Računato iz",
    fromGross: "bruto iznosa",
    fromNet: "neto iznosa",

    inputs: "Uneseno",
    formula: "osnovica = bruto × (1 − troškovi/100)     iznos po stopi = osnovica × stopa/100     neto = bruto − iznos",

    errorGross: "Bruto iznos mora biti veći od nule.",
    errorNet: "Neto iznos mora biti veći od nule.",
    errorCostPercent: "Procenat priznatih troškova je od 0 do 100% (isključivo).",
    errorTaxRate: "Stopa je od 0 do 100%, i takva da 1 − efektivni udeo ostane veći od nule.",

    unitPercent: "%",
  },

  "rental-yield": {
    price: "Cena / vrednost nekretnine",
    priceHint: "Ostavi prazno ako tražiš samo obrnuti smer (vrednost iz NOI i kapitalizacione stope).",
    monthlyRent: "Mesečna zakupnina",
    occupancy: "Popunjenost",
    occupancyHint: "Procenat, podrazumevano 100 — to je identitet „bez praznog hoda\", ne procena.",
    monthlyCosts: "Mesečni troškovi",
    costsHint: "Alatka ne pretpostavlja nijedan trošak — sabira samo ono što uneseš, u punom iznosu bez obzira na popunjenost.",
    annualCosts: "Godišnji troškovi",
    capRate: "Kapitalizaciona stopa za obrnuti smer",
    capRateHint: "Tvoja stopa. Nexus nijednu ne pretpostavlja.",

    results: "Rezultat",
    grossPotentialIncome: "Godišnji bruto potencijalni prihod (BPP)",
    effectiveGrossIncome: "Efektivni prihod po popunjenosti (EGI)",
    netOperatingIncome: "Neto poslovni prihod (NOI)",
    grossYield: "Bruto prinos (iz BPP)",
    netYield: "Neto prinos (iz NOI)",
    grossRentMultiplier: "Bruto multiplikator (cena / BPP)",
    paybackYears: "Period povraćaja",
    negativeNoiNote: "Uneti troškovi premašuju prihod — period povraćaja i obrnuti smer se ne prikazuju.",
    valueAtCapRate: "Vrednost pri unetoj kapitalizacionoj stopi (NOI / stopa)",
    costsAreYoursNote: "Svi troškovi su tvoji unosi — alatka nijedan ne dodaje sama.",

    inputs: "Uneseno",
    formula: "BPP = zakupnina × 12     EGI = BPP × popunjenost/100     NOI = EGI − troškovi     prinos = X / cena × 100",

    errorPrice: "Cena mora biti veća od nule.",
    errorMonthlyRent: "Mesečna zakupnina ne sme biti negativna.",
    errorOccupancy: "Popunjenost je od 0 do 100%.",
    errorMonthlyCosts: "Mesečni troškovi ne smeju biti negativni.",
    errorAnnualCosts: "Godišnji troškovi ne smeju biti negativni.",
    errorCapRate: "Kapitalizaciona stopa mora biti veća od nule.",
  },

  "room-quad-area": {
    a: "Stranica a (A→B)",
    b: "Stranica b (B→C)",
    c: "Stranica c (C→D)",
    d: "Stranica d (D→A)",
    e: "Dijagonala e (A→C)",
    eHint: "Mora biti izmerena unutar prostorije.",

    results: "Rezultat",
    area: "Površina",
    triangleAbc: "Površina trougla ABC",
    triangleAcd: "Površina trougla ACD",
    angleB: "Ugao kod temena B (između a i b)",
    deviationFrom90: "Odstupanje ugla B od 90°",
    angleD: "Ugao kod temena D (između c i d)",
    deviationFrom90AtD: "Odstupanje ugla D od 90°",
    reentrantNote:
      "Račun pretpostavlja da dijagonala AC leži unutar prostorije. Prostorija sa ulazećim uglom mora se podeliti na dva četvorougla i meriti dvaput.",

    inputs: "Uneseno",
    formula:
      "Heron: T = ¼√((a+(b+c))(c−(a−b))(c+(a−b))(a+(b−c)))     γ = arccos((a²+b²−e²)/(2ab))     P = T_ABC + T_ACD",

    errorA: "Stranica a mora biti veća od nule.",
    errorB: "Stranica b mora biti veća od nule.",
    errorC: "Stranica c mora biti veća od nule.",
    errorD: "Stranica d mora biti veća od nule.",
    errorE: "Dijagonala e mora biti veća od nule.",
    errorDiagonalTooLongAB: "Dijagonala e je preduga za stranice a i b — trougao ABC ne postoji.",
    errorDiagonalTooShortAB: "Dijagonala e je prekratka za stranice a i b — trougao ABC ne postoji.",
    errorDiagonalTooLongCD: "Dijagonala e je preduga za stranice c i d — trougao ACD ne postoji.",
    errorDiagonalTooShortCD: "Dijagonala e je prekratka za stranice c i d — trougao ACD ne postoji.",
    errorCollinearABC: "Tačke A, B i C su na istoj pravoj — trougao ABC nema površinu.",
    errorCollinearACD: "Tačke A, C i D su na istoj pravoj — trougao ACD nema površinu.",

    unitM: "m",
    unitM2: "m²",
    unitDeg: "°",
  },

  "wall-ceiling-area": {
    length: "Dužina prostorije",
    width: "Širina prostorije",
    height: "Visina prostorije",
    openings: "Otvori",
    openingsHint: "Jedan otvor po redu: širina;visina;komada, npr. 0,90;2,05;1.",
    includeCeiling: "Uključiti plafon",
    yes: "da",
    no: "ne",
    coverage: "Izdašnost materijala",
    coverageHint: "m² po litru ili po kilogramu, ZA JEDAN SLOJ, sa deklaracije proizvoda. Nexus nijednu ne pretpostavlja.",
    coats: "Broj slojeva",
    coatsHint: "Ceo broj od 1 do 10. Podrazumevano 1.",
    packageSize: "Pakovanje",
    packageSizeHint: "Veličina jednog pakovanja, u istoj jedinici kao izdašnost (l ili kg). Opciono.",
    perimeterOverride: "Obim (ručni unos)",
    perimeterOverrideHint:
      "Za prostoriju koja nije pravougaona (npr. u obliku slova L), gde 2×(dužina+širina) nije stvarni obim zida.",
    revealDepth: "Dubina špaletne",

    results: "Rezultat",
    perimeter: "Obim prostorije",
    wallsGross: "Bruto površina zidova",
    openingsArea: "Ukupna površina otvora",
    wallsNet: "Neto površina zidova",
    wallsNetRoundingGap: "Razlika zaokruživanja (bruto − otvori − neto, prikazano zaokruženo)",
    ceiling: "Površina plafona",
    notIncluded: "nije uračunato u ukupno",
    ceilingNotIncludedNote: "Plafon nije uključen u ukupnu površinu za obradu.",
    total: "Ukupna površina za obradu",
    material: "Količina materijala",
    materialNote: "U jedinici izdašnosti koju si uneo (l ili kg). Ne uključuje rasipanje ni gubitke.",
    packageCount: "Broj pakovanja",
    revealArea: "Površina špaletni",

    inputs: "Uneseno",
    formula: "obim = 2×(dužina+širina)     zidovi_neto = obim×visina − otvori     materijal = ukupno×slojevi/izdašnost",

    errorLength: "Dužina prostorije mora biti veća od nule.",
    errorWidth: "Širina prostorije mora biti veća od nule.",
    errorHeight: "Visina prostorije mora biti veća od nule.",
    errorCoats: "Broj slojeva je ceo broj od 1 do 10.",
    errorCoverage: "Izdašnost mora biti veća od nule.",
    errorPerimeterOverride: "Ručno uneti obim mora biti veći od nule.",
    errorRevealDepth: "Dubina špaletne mora biti veća od nule.",
    errorPackageSize: "Veličina pakovanja mora biti veća od nule.",
    errorOpeningWidth: "Širina otvora mora biti veća od nule i ne veća od širine dužeg zida.",
    errorOpeningHeight: "Visina otvora mora biti veća od nule i ne veća od visine prostorije.",
    errorOpeningCount: "Broj komada otvora je ceo broj od 1 do 1000.",
    errorOpenings: "Uneti otvori ne mogu stati u zidove.",

    unitM: "m",
    unitM2: "m²",
  },

  "weighted-area": {
    rows: "Prostorije",
    rowsHint:
      "Jedan red po prostoriji — naziv;površina;koeficijent — ili, sa četiri polja, naziv;dužina;širina;koeficijent. Koeficijent je od 0 do 5.",
    pricePerSquareMetre: "Cena po ponderisanom m²",
    priceHint: "Opciono — daje ukupnu cenu i cenu po neto kvadratu.",

    results: "Rezultat",
    coefficientNote:
      "Koeficijent je stvar ugovora, ne propisa — terasa se najčešće računa 0,5, a ostava sa nulom ulazi u neto a ne u ponderisanu površinu.",
    colName: "Prostorija",
    colArea: "Površina",
    colCoefficient: "Koeficijent",
    colContribution: "Ponderisano",
    netArea: "Neto površina",
    weightedArea: "Ponderisana površina",
    totalPrice: "Ukupna cena",
    pricePerNetSquareMetre: "Cena po neto m²",

    inputs: "Uneseno",
    formula: "ponderisano = Σ(površina×koeficijent)     neto = Σpovršina     cena = ponderisano×cena_po_m²",

    errorRows: "Unesi bar jednu prostoriju.",
    errorCoefficient: "Koeficijent je broj od 0 do 5.",
    errorArea: "Površina mora biti veća od nule.",
    errorLength: "Dužina mora biti veća od nule.",
    errorWidth: "Širina mora biti veća od nule.",
    errorPrice: "Cena po kvadratu ne sme biti negativna.",

    unitM2: "m²",
  },
} as const;
