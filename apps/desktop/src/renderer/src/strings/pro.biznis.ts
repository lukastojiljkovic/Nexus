/**
 * „Biznis i kancelarija" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment and
 * `@nexus/core/pro/biznis.ts` spell it. The tool's NAME and its one-line blurb
 * are not here — those live in `./pro.ts`, owned by another process.
 *
 * **A unit is copy, not a constant.** Money, minutes, percent, days — every one
 * of them is a string written here and passed to `proUnit` at the call site,
 * never concatenated by hand in the surface.
 *
 * **This pack knows no rate, no term, no holiday and no tariff — and says so.**
 * A statutory interest rate, a payment term, a public holiday, a commission
 * scale: every one of them is the user's own number, typed with no default, and
 * the hint under the field is what says whose number it is. None of these tools
 * is `life-safety` or `food-safety`, but the same discipline applies by choice
 * throughout: a quantity is printed, never a judgement about it.
 */
export const PRO_BIZNIS_SR = {
  "billable-hours": {
    entries: "Stavke vremena",
    entriesHint:
      "Jedna stavka po redu — „1:45“, „1h 45min“ ili decimalno „1,75“ (sat i tri četvrtine).",
    intervalMinutes: "Interval zaokruživanja",
    intervalHint: "U minutima, 1–120. Prazno ili 0 znači bez zaokruživanja.",
    rule: "Pravilo zaokruživanja",
    ruleUp: "Naviše",
    ruleNearest: "Na najbliži",
    ruleDown: "Naniže",
    place: "Gde se zaokružuje",
    placePerItem: "Po stavci",
    placeTotal: "Na ukupan zbir",
    rate: "Satnica",
    rateHint: "Novčana jedinica po satu.",

    results: "Rezultat",
    tableIndex: "Br.",
    tableActual: "Stvarno",
    tableBilled: "Zaokruženo",
    actualTotal: "Stvarno ukupno",
    actualDecimal: "Stvarno u decimalnim satima",
    billedTotal: "Zaokruženo ukupno",
    billedDecimal: "Zaokruženo u decimalnim satima",
    amount: "Iznos",
    actualAmount: "Iznos bez zaokruživanja",
    deltaMinutes: "Razlika (zaokruženo − stvarno)",
    deltaAmount: "Razlika u iznosu",

    inputs: "Uneseno",
    formula:
      "m = 60·H + MM (ili round(x·60) za decimalni zapis)     zaokruženo po izabranom pravilu i " +
      "mestu     iznos = zaokruženo/60 · satnica",

    errorEntries:
      "Svaka stavka mora biti vreme u obliku „1:45“, „1h 45min“ ili decimalno „1,75“ — bez " +
      "praznih redova između stavki.",
    errorInterval: "Interval zaokruživanja je ceo broj minuta od 1 do 120, ili prazno.",
    errorRate: "Satnica ne sme biti negativna.",

    unitMinutes: "min",
    unitH: "h",
  },

  "break-even": {
    fixedCosts: "Fiksni troškovi za period",
    price: "Prodajna cena po komadu",
    variableCost: "Varijabilni trošak po komadu",
    targetProfit: "Željena dobit za period",
    targetProfitHint:
      "Za ISTI period za koji su uneti fiksni troškovi — inače se sabiraju dve različite " +
      "vremenske osnove. Prazno znači da cilj nije postavljen.",
    plannedUnits: "Planirana prodaja",
    plannedUnitsHint: "Neobavezno, samo za sigurnosnu marginu — u komadima.",

    results: "Rezultat",
    contributionMargin: "Kontribuciona marža po komadu",
    contributionMarginPercent: "Kontribuciona marža u procentima",
    exactUnits: "Tačka pokrića, nezaokrugli broj komada",
    units: "Tačka pokrića, komada (naviše)",
    breakEvenRevenue: "Prihod pri nezaokrugloj tački pokrića",
    revenueAtUnits: "Prihod pri celom broju komada",
    surplusAtUnits: "Višak koji taj ceo broj komada donosi",
    exactUnitsForProfit: "Za željenu dobit, nezaokrugli broj komada",
    unitsForProfit: "Za željenu dobit, komada (naviše)",
    revenueForProfit: "Prihod pri tom broju komada",
    marginOfSafetyPercent: "Sigurnosna margina, procenat",
    marginOfSafetyUnits: "Sigurnosna margina, komada",
    marginOfSafetyAmount: "Sigurnosna margina, novčano",

    inputs: "Uneseno",
    formula:
      "km = cena − varijabilni trošak     komada = ⌈fiksni / km⌉     prihod = komada · cena     " +
      "sigurnosna margina = (planirano − fiksni/km) / planirano",

    errorFixedCosts: "Fiksni troškovi ne smeju biti negativni.",
    errorPrice: "Prodajna cena mora biti veća od nule.",
    errorVariableCost: "Varijabilni trošak ne sme biti negativan.",
    errorTargetProfit: "Željena dobit ne sme biti negativna.",
    errorPlannedUnits: "Planirana prodaja mora biti broj.",
    errorMarginZero:
      "Kontribuciona marža je tačno nula — svaki dodatni komad ostavlja gubitak jednak fiksnim " +
      "troškovima, tačka pokrića ne postoji.",
    errorMarginNegative:
      "Kontribuciona marža je negativna — svaki dodatni komad povećava gubitak, tačka pokrića ne " +
      "postoji.",

    unitPieces: "kom",
  },

  "chained-discount": {
    basePrice: "Osnovna cena",
    steps: "Niz popusta",
    stepsHint:
      "Procenat po stavci, jedan po redu ili razdvojeno zarezom. Negativna stavka je doplata i " +
      "nema donju granicu; nijedna stavka ne sme preći 100 %.",

    results: "Rezultat",
    tableStep: "Korak",
    tablePrice: "Cena posle koraka",
    tableDelta: "Šta je taj korak promenio",
    finalPrice: "Konačna cena",
    totalDiscount: "Ukupno oduzeto",
    totalSurcharge: "Ukupno dodato",
    equivalent: "Ekvivalentan jedinstven popust",
    equivalentSurcharge: "Ekvivalentna jedinstvena doplata",
    orderNote:
      "Konačna cena ne zavisi od redosleda stavki — proizvod činilaca je komutativan. Cena posle " +
      "svakog POJEDINAČNOG koraka zavisi.",
    fullStepNote:
      "Stavka od 100 % svodi cenu na 0 — nijedna naredna stavka, popust ili doplata, više nema " +
      "dejstvo.",

    inputs: "Uneseno",
    formula:
      "f = ∏ (1 − dᵢ)     konačna cena = osnovna · f     ekvivalentan popust = 1 − f",

    errorBasePrice: "Osnovna cena ne sme biti negativna.",
    errorSteps: "Nijedna stavka ne sme preći 100 %; svaka mora biti broj.",

    unitPercent: "%",
  },

  "deposit-instalments": {
    contractValue: "Ugovorena vrednost",
    depositKind: "Avans se unosi kao",
    depositKindPercent: "Procenat",
    depositKindAmount: "Iznos",
    deposit: "Avans",
    depositHint: "Procenat ugovorene vrednosti (0–100) ili novčani iznos, zavisno od izbora levo.",
    instalments: "Broj rata",
    firstDateDay: "Datum prve rate — dan",
    firstDateMonth: "Datum prve rate — mesec",
    firstDateYear: "Datum prve rate — godina",
    stepMonths: "Razmak između rata",
    stepMonthsHint: "U mesecima.",
    unit: "Najmanja jedinica zaokruživanja",
    unit001: "0,01",
    unit1: "1",

    results: "Rezultat",
    depositAmount: "Avans",
    tableIndex: "Br.",
    tableDate: "Datum",
    tableAmount: "Iznos rate",
    tableRemaining: "Preostali dug",
    checkSum: "Kontrolni zbir (avans + sve rate)",

    inputs: "Uneseno",
    formula:
      "N = round(ostatak / jedinica)     osnovna = ⌊N / broj rata⌋     prve R rata dobijaju po " +
      "jednu jedinicu više, R = N − osnovna · broj rata     datum(i) = prva rata + (i−1) · " +
      "razmak, meren od PRVOG datuma",

    errorContractValue:
      "Ugovorena vrednost mora biti veća od nule i mora biti ceo umnožak jedinice zaokruživanja.",
    errorUnit: "Jedinica zaokruživanja mora biti veća od nule.",
    errorDeposit: "Avans mora biti u dozvoljenom opsegu — 0 do 100 % ili 0 do ugovorene vrednosti.",
    errorInstalments: "Broj rata je ceo broj od 1 do 600.",
    errorFirstDate: "Datum prve rate mora biti ispravan kalendarski datum.",
    errorStepMonths: "Razmak između rata je ceo broj meseci od 1 do 120.",
    errorSchedule:
      "Ovim brojem rata i razmakom raspored izlazi van kalendara koji alatka podržava.",
  },

  "hourly-rate-target": {
    targetEarnings: "Željena godišnja zarada pre poreza",
    targetEarningsHint:
      "Ovo je prihod koji treba fakturisati, a ne zarada koja ostaje posle poreza i doprinosa — " +
      "alatka nijednu poresku stopu ne poznaje.",
    businessCosts: "Godišnji poslovni troškovi",
    workWeeks: "Radnih nedelja godišnje",
    workWeeksHint: "1–53. Godišnji odmor i praznici su tvoj izbor, ne pretpostavka alatke.",
    hoursPerWeek: "Radnih sati nedeljno",
    billablePercent: "Naplativost",
    billablePercentHint: "Procenat radnog vremena koje se zaista fakturiše.",
    hoursPerDay: "Sati u radnom danu",

    results: "Rezultat",
    billableHoursPerYear: "Naplativi sati godišnje",
    requiredRevenue: "Potreban godišnji prihod",
    hourlyRate: "Cena sata",
    dayRate: "Cena dana",
    monthlyRevenue: "Potreban prihod po mesecu",
    revenueNote:
      "Ovo je prihod koji treba fakturisati, a ne zarada koja ostaje posle poreza i doprinosa.",

    inputs: "Uneseno",
    formula:
      "naplativi sati = nedelja · sati/nedeljno · naplativost     cena sata = (zarada + " +
      "troškovi) / naplativi sati     cena dana = cena sata · sati/dan",

    errorTargetEarnings: "Željena zarada ne sme biti negativna.",
    errorBusinessCosts: "Poslovni troškovi ne smeju biti negativni.",
    errorWorkWeeks: "Radnih nedelja godišnje je broj od 1 do 53.",
    errorHoursPerWeek: "Radnih sati nedeljno mora biti veće od nule.",
    errorBillablePercent: "Naplativost je procenat veći od nule i najviše 100.",
    errorHoursPerDay: "Sati u radnom danu mora biti veće od nule.",
    errorBillableHours: "Naplativih sati godišnje ispada nula uz ove brojeve.",

    unitH: "h",
  },

  "iban-check": {
    mode: "Režim",
    modeVerify: "Proveri uneti IBAN",
    modeCompose: "Sastavi IBAN",
    iban: "IBAN",
    ibanHint: "Slova su dozvoljena malim slovima, pretvaraju se u velika. Razmaci se uklanjaju.",
    countryCode: "Oznaka države",
    countryCodeHint: "Dva slova, A–Z. Nexus nema ugrađen spisak država.",
    bban: "BBAN",
    bbanHint: "Domaći broj računa — cifre i velika slova.",

    results: "Rezultat",
    normalized: "Uneto, normalizovano",
    length: "Dužina",
    lengthChars: "znakova",
    countryCode2: "Oznaka države",
    checkDigits: "Unete kontrolne cifre",
    bban2: "BBAN",
    remainder: "Ostatak pri deljenju sa 97",
    remainderIsOne: "Ostatak je jednak 1",
    yes: "da",
    no: "ne",
    expectedCheckDigits: "Kontrolne cifre koje bi ovaj BBAN i država tražili",
    correctedIban: "Ceo IBAN sa tim kontrolnim ciframa",
    correctedPaperFormat: "Papirni oblik",
    paperFormat: "Papirni oblik unetog IBAN-a",
    composedIban: "Sastavljen IBAN",

    inputs: "Uneseno",
    formula:
      "premesti prva 4 znaka na kraj, slova A=10…Z=35, r = niz mod 97     provera: r = 1     " +
      "sastavljanje: K = 98 − (BBAN + država + „00“) mod 97",

    errorIban:
      "IBAN mora imati 5–34 znaka, prva dva slova A–Z, sledeća dva cifre, i samo cifre i velika " +
      "slova posle toga.",
    errorCountryCode: "Oznaka države su tačno dva slova, A–Z.",
    errorBban: "BBAN je 1–30 cifara i velikih slova.",
  },

  "margin-markup": {
    cost: "Nabavna cena",
    price: "Prodajna cena",
    marginPercent: "Marža — % prodajne cene",
    markupPercent: "Markup (RUC) — % nabavne cene",
    minMarginPercent: "Najmanja marža koju treba zadržati — % prodajne cene",
    minMarginHint: "Popuni ovo polje, uz nabavnu i prodajnu cenu, za najveći dozvoljeni popust.",
    fieldsHint:
      "Popuni tačno DVA od četiri polja iznad (nabavna cena, prodajna cena, marža, markup) — " +
      "treće i četvrto se izvode. Za najveći popust popuni nabavnu cenu, prodajnu cenu i " +
      "najmanju maržu.",

    results: "Rezultat",
    resultCost: "Nabavna cena",
    resultPrice: "Prodajna cena",
    profit: "Zarada po komadu",
    resultMargin: "Marža",
    resultMarkup: "Markup (RUC)",

    maxDiscountPercent: "Najveći popust (naniže)",
    exactDiscountPercent: "Najveći popust, nezaokrugla vrednost",
    priceAfterDiscount: "Cena posle tog popusta",
    marginAfterDiscountPercent: "Marža koja ostaje posle tog popusta",
    belowNote:
      "Prodajna cena je već ispod zadate najmanje marže — nezaokrugla vrednost popusta izlazi " +
      "negativna, pa je prikazani popust 0,00 %.",

    inputs: "Uneseno",
    formula:
      "Z = P − C     markup = Z/C     marža = Z/P     najveći popust: d = 1 − C / (P · (1 − " +
      "g_min))",

    errorCost: "Nabavna cena mora biti veća od nule.",
    errorPrice: "Prodajna cena mora biti veća od nule.",
    errorMarginPercent: "Marža mora biti manja od 100 %.",
    errorMarkupPercent: "Markup mora biti veći od −100 %.",
    errorMinMarginPercent: "Najmanja marža mora biti manja od 100 %.",
    errorAmbiguous:
      "Popuni tačno dva od polja nabavna cena / prodajna cena / marža / markup, ili nabavnu " +
      "cenu, prodajnu cenu i najmanju maržu za najveći popust.",

    unitPercent: "%",
  },

  "payment-due-date": {
    issueDateDay: "Datum izdavanja — dan",
    issueDateMonth: "Datum izdavanja — mesec",
    issueDateYear: "Datum izdavanja — godina",
    mode: "Način računanja",
    modeDaysFromDate: "N dana od datuma",
    modeDaysFromEndOfMonth: "N dana od kraja meseca",
    modeMonthsFromDate: "N meseci od datuma",
    term: "Rok N",
    termHint: "Dana ili meseci, zavisno od načina računanja. Koji rok važi biraš ti.",
    countIssueDate: "Dan izdavanja se računa u rok",
    countIssueDateYes: "Računa se (dan izdavanja je dan jedan)",
    countIssueDateNo: "Ne računa se (rok počinje sledećeg dana)",
    shiftEnabled: "Pomeranje sa neradnog dana",
    shiftOn: "Uključeno",
    shiftOff: "Isključeno",
    shiftDirection: "Smer pomeranja",
    shiftForward: "Napred, na sledeći radni dan",
    shiftBackward: "Nazad, na prethodni radni dan",
    weekendDays: "Neradni dani u nedelji",
    weekendDaysHint:
      "Brojevi 0–6 razdvojeni zarezom; 0 je ponedeljak, 6 je nedelja. Prazno znači da nijedan " +
      "dan u nedelji nije neradan po ovom pravilu.",
    nonWorkingDays: "Neradni dani (praznici)",
    nonWorkingDaysHint:
      "Po jedan datum u redu, u obliku DD.MM.GGGG. Nexus nema ugrađen kalendar praznika.",
    referenceDateDay: "Referentni datum — dan",
    referenceDateMonth: "Referentni datum — mesec",
    referenceDateYear: "Referentni datum — godina",
    referenceDateHint: "„Danas“ se upisuje ovde, ne čita se sa sata.",

    results: "Rezultat",
    dueDate: "Datum dospeća",
    dueWeekday: "Dan u nedelji",
    dueDateBeforeShift: "Datum dospeća pre pomeranja",
    shiftedDays: "Koliko dana je pomeranje dodalo",
    capReachedNote:
      "Pomeranje je dostiglo granicu od 30 uzastopnih koraka bez radnog dana; prikazani datum je " +
      "poslednji ispitani.",
    totalDays: "Ukupno dana od izdavanja do dospeća",
    daysLate: "Dana kašnjenja prema referentnom datumu",
    daysUntilDue: "Dana do dospeća prema referentnom datumu",
    note:
      "Rok, pravilo pomeranja i spisak neradnih dana su tvoji uneti podaci — Nexus ne zna koji " +
      "rok važi ni da li je neko pravo isteklo.",

    weekdayNames: [
      "ponedeljak",
      "utorak",
      "sreda",
      "četvrtak",
      "petak",
      "subota",
      "nedelja",
    ],

    inputs: "Uneseno",
    formula:
      "dospeće = izdato + N (dana, od kraja meseca, ili meseci uz zadržan dan i pravilo za kraj " +
      "meseca)     pomeranje: dok je dospeće neradno, +1/−1 dan, najviše 30 koraka",

    errorIssueDate: "Datum izdavanja mora biti ispravan kalendarski datum.",
    errorReferenceDate: "Referentni datum mora biti ispravan kalendarski datum.",
    errorTerm: "Rok N je ceo broj od 0 do 100000.",
    errorWeekendDays: "Neradni dani u nedelji su brojevi od 0 do 6.",
    errorNonWorkingDays:
      "Svaki neradni dan mora biti ispravan kalendarski datum u obliku DD.MM.GGGG.",
    errorGeneric: "Ovim brojevima dospeće ne može da se izračuna.",
  },

  "payment-reference-97": {
    mode: "Režim",
    modeCompute: "Izračunaj kontrolnu dvocifru",
    modeVerify: "Proveri postojeći poziv na broj",
    reference: "Referenca",
    referenceHint: "1–40 cifara, bez kontrolne dvocifre. Crtice i razmaci se uklanjaju.",
    value: "Poziv na broj za proveru",
    valueHint: "Kontrolna dvocifra na početku, pa referenca.",

    results: "Rezultat",
    checkDigits: "Kontrolna dvocifra",
    formatted: "Složen poziv na broj",
    enteredCheckDigits: "Uneta dvocifra",
    computedCheckDigits: "Izračunata dvocifra",
    matches: "Dvocifre se poklapaju",
    yes: "da",
    no: "ne",
    overTwentyNote:
      "Referenca ima više od 20 cifara — preko polja koje dozvoljava NBS-ov obrazac naloga za " +
      "plaćanje. MOD 97-10 sam po sebi nema ograničenje dužine.",

    inputs: "Uneseno",
    formula: "r = referenca mod 97 (cifra po cifru)     K = 98 − ((r · 100) mod 97)",

    errorReference: "Referenca je 1–40 cifara.",
    errorValue: "Poziv na broj za proveru je 3–42 cifre, kontrolna dvocifra pa referenca.",
  },

  "share-allocation": {
    total: "Ukupan iznos",
    shares: "Udeli",
    sharesHint:
      "Brojevi ili procenti, jedan po redu — svaki ≥ 0, bar jedan veći od nule. Ne moraju se " +
      "sabirati u 100.",
    unit: "Najmanja jedinica",
    unit001: "0,01",
    unit1: "1",
    unit10: "10",

    results: "Rezultat",
    tableIndex: "Br.",
    tableShare: "Udeo",
    tablePercent: "Udeo u %",
    tableAmount: "Iznos",
    tableExtra: "Dodatna jedinica",
    extraYes: "da",
    extraNo: "ne",
    shareSum: "Zbir unetih udela (osnovica za procente)",
    checkSum: "Kontrolni zbir",

    inputs: "Uneseno",
    formula:
      "N = round(ukupno / jedinica)     osnovni deo = ⌊N · udeoᵢ / zbir udela⌋     najveći " +
      "ostaci dobijaju po jednu jedinicu više, ranije uneta stavka ima prednost kod izjednačenog " +
      "ostatka",

    errorTotal: "Ukupan iznos ne sme biti negativan.",
    errorUnit: "Najmanja jedinica mora biti veća od nule.",
    errorShares:
      "Mora postojati bar jedan udeo, svaki ≥ 0 i bar jedan veći od nule; nijedan ne sme biti " +
      "negativan.",
  },

  "simple-interest-days": {
    principal: "Glavnica",
    annualRatePercent: "Godišnja stopa",
    annualRatePercentHint:
      "Zakonska ili ugovorena stopa koju biraš i unosiš ti — Nexus nijednu stopu ne poznaje i " +
      "nijednu ne nudi.",
    fromDay: "Datum od — dan",
    fromMonth: "Datum od — mesec",
    fromYear: "Datum od — godina",
    toDay: "Datum do — dan",
    toMonth: "Datum do — mesec",
    toYear: "Datum do — godina",
    basis: "Osnova brojanja dana",
    basisAct365: "ACT/365 Fixed",
    basisAct360: "ACT/360",
    basisE30360: "30E/360 (Eurobond Basis)",
    countBothEnds: "Brojanje dana",
    countBothEndsNo: "Uobičajeno — uračunat dan „od“, neuračunat dan „do“",
    countBothEndsYes: "Uračunata oba kraja",
    countBothEndsHint: "Ne utiče na 30E/360, koja svoje brojanje dana već ima ugrađeno u D1/D2.",

    results: "Rezultat",
    days: "Broj dana po izabranoj osnovi",
    calendarDays: "Stvarni kalendarski broj dana",
    divisor: "Delilac",
    interest: "Kamata",
    dailyInterest: "Dnevna kamata",
    total: "Glavnica + kamata",
    note:
      "Kamata je PROSTA, bez kapitalisanja. Stopa je ona koju uneseš — Nexus je ne bira i ne " +
      "izriče da li potraživanje postoji.",

    inputs: "Uneseno",
    formula:
      "ACT/365, ACT/360: dani = JDN(do) − JDN(od) (+1 ako se broje oba kraja)     30E/360: dani " +
      "= 360·Δgodina + 30·Δmesec + (D2−D1), D = min(dan, 30)     kamata = glavnica · stopa/100 · " +
      "dani / delilac",

    errorPrincipal: "Glavnica ne sme biti negativna.",
    errorAnnualRatePercent: "Godišnja stopa ne sme biti negativna.",
    errorFrom: "Datum „od“ mora biti ispravan kalendarski datum.",
    errorTo: "Datum „do“ mora biti ispravan kalendarski datum i ne sme biti pre datuma „od“.",

    unitPercent: "%",
    unitDays: "dana",
  },

  "tax-id-check": {
    mode: "Režim",
    modeVerify: "Proveri ceo broj",
    modeCompute: "Izračunaj kontrolnu cifru iz prefiksa",
    totalDigits: "Ukupan broj cifara",
    totalDigitsHint:
      "Za PIB se kuca 9, za matični broj pravnog lica 8. Nexus ne pretpostavlja nijednu dužinu. " +
      "U režimu izračunavanja ovo je ukupna dužina GOTOVOG broja, dakle prefiks ima jednu cifru " +
      "manje.",
    value: "Broj",
    valueHint: "Onoliko cifara koliko je uneto gore. Razmaci se uklanjaju.",
    prefix: "Prefiks",
    prefixHint:
      "Za jednu cifru kraći od ukupnog broja cifara — kontrolna cifra se dopisuje na kraj.",

    results: "Rezultat",
    checkDigit: "Izračunata kontrolna cifra",
    enteredCheckDigit: "Uneta poslednja cifra",
    matches: "Poklapaju se",
    yes: "da",
    no: "ne",
    prefixOut: "Prefiks",
    correctedNumber: "Ceo broj sa izračunatom kontrolnom cifrom",
    number: "Ceo broj",

    inputs: "Uneseno",
    formula:
      "p = 10; za svaku cifru d: s = (p+d) mod 10, s=0 → s=10, p = 2s mod 11     kontrolna cifra " +
      "= (11 − p) mod 10",

    errorTotalDigits: "Ukupan broj cifara je od 2 do 40.",
    errorNumber: "Broj mora sadržati samo cifre, tačno onoliko koliko je uneto kao ukupna dužina.",
    errorPrefix: "Prefiks mora sadržati samo cifre, tačno za jednu manje od ukupne dužine.",
    errorLength: "Uneti broj nema onoliko cifara koliko je navedeno kao ukupna dužina.",
  },

  "tiered-commission": {
    base: "Osnovica",
    tiers: "Pragovi i stope",
    tiersHint:
      "Jedan red po pragu, u obliku „donja granica; stopa %“. Prva donja granica mora biti 0, " +
      "granice se ne smeju ponavljati.",
    mode: "Način",
    modeMarginal: "Marginalno (po tranšama)",
    modeFlat: "Ravno (jedna stopa na ceo iznos)",
    minCommission: "Najmanja provizija",
    maxCommission: "Najveća provizija",

    results: "Rezultat",
    tableFrom: "Od",
    tableTo: "Do",
    tableOpenEnd: "naviše",
    tableRate: "Stopa",
    tableAmount: "Iznos u tranši",
    tableCommission: "Provizija iz tranše",
    commissionBeforeLimits: "Provizija pre ograničenja",
    commission: "Provizija",
    appliedTier: "Primenjen prag",
    effectiveRatePercent: "Efektivna stopa",
    remainder: "Ostatak posle provizije",

    inputs: "Uneseno",
    formula:
      "marginalno: provizija = Σ (deo osnovice u tranši) · stopa/100     ravno: provizija = " +
      "osnovica · stopa poslednjeg praga ≤ osnovica     zatim: max(., najmanja), pa min(., " +
      "najveća)",

    errorBase: "Osnovica ne sme biti negativna.",
    errorTiers:
      "Skala mora imati bar jedan red, prva donja granica mora biti 0, granice se ne smeju " +
      "ponavljati i ne smeju biti negativne.",
    errorMinCommission: "Najmanja provizija ne sme biti negativna.",
    errorMaxCommission:
      "Najveća provizija ne sme biti negativna i ne sme biti manja od najmanje provizije.",

    unitPercent: "%",
  },
} as const;
