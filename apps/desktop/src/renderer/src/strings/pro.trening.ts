/**
 * „Trening i sport" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those
 * live in the `name` and `blurb` tables of `./pro.ts`, because the drawer's
 * rail needs them before any surface is opened.
 *
 * **A unit is copy, not a constant.** Written here rather than concatenated
 * in the surface, so a unit hard-coded in a component is not a string
 * `check:strings` cannot see.
 *
 * **Nothing in here judges.** None of these tools carry a normative band —
 * `packages/core/src/pro/trening.ts` returns quantities and nothing else, and
 * this table only ever names what a number IS, never whether it is good. The
 * two tools that carry a regulated figure — the symmetry target, the
 * weight-class limit — echo it back as „tvoja granica", never as a pass/fail.
 */
export const PRO_TRENING_SR = {
  "barbell-plate-loading": {
    target: "Željeno ukupno opterećenje",
    targetHint: "Ukupna masa sa šipkom i svim diskovima, u kilogramima.",
    bar: "Masa šipke",
    barHint:
      "Masa šipke koju imaš pred sobom. Muške šipke su obično 20 kg, ženske 15 kg — proveri " +
      "za svaki slučaj.",
    collar: "Masa jedne stezaljke",
    collarHint: "Masa jedne stezaljke — obe se računaju. Ostavi 0 ako ih ne koristiš.",
    plates: "Raspoloživi diskovi",
    platesHint:
      "Jedan disk po redu: masa u kilogramima, i opciono razmak pa broj raspoloživih pari " +
      "(npr. „25 4\"). Bez broja pari — neograničeno na raspolaganju.",

    results: "Rezultat",
    perSideTitle: "Diskovi za jednu stranu, od najtežeg ka najlakšem",
    headMass: "Masa",
    headCount: "Broj po strani",
    noPlates: "Nijedan disk ne ide na šipku pri ovom opterećenju.",
    barUsed: "Šipka korišćena u računu",
    perSideMass: "Masa po strani, bez stezaljki",
    plateCount: "Broj diskova po strani",
    achieved: "Postignuto ukupno opterećenje",
    difference: "Razlika u odnosu na traženo",

    formula:
      "R = cilj − šipka − 2·stezaljka     bira se s koje minimizuje |R − 2s|     ukupno = šipka " +
      "+ 2·stezaljka + 2s",
    inputs: "Uneseno",

    errorTarget: "Željeno ukupno opterećenje mora biti veće od nule.",
    errorBar: "Masa šipke ne sme biti negativna.",
    errorCollar: "Masa stezaljke ne sme biti negativna.",
    errorPlates:
      "Proveri spisak diskova — svaka masa mora biti veća od nule, a broj pari ceo broj nula ili " +
      "više.",
    errorBelowBar: "Traženo opterećenje je manje od same šipke sa stezaljkama — odgovora nema.",
    errorTooManyOperations:
      "Ovaj inventar je previše fin za ovo opterećenje da bi se pretražio u razumnom vremenu.",

    unitKg: "kg",
  },

  "body-fat-target-mass": {
    mass: "Telesna masa",
    massHint: "U kilogramima.",
    bodyFat: "Procenat masti",
    bodyFatHint:
      "Izmerena vrednost — kaliper, bioimpedansa ili DEXA. Alatka ne procenjuje procenat masti " +
      "sama.",
    target: "Ciljni procenat masti",
    targetHint: "Procenat masti koji želiš da dostigneš.",

    results: "Rezultat",
    condition: "Uslov računa",
    conditionNote:
      "Čista (nemasna) masa se drži nepromenjenom — ciljna masa je masa koju bi telo imalo pri " +
      "unetom procentu masti, uz istu čistu masu.",
    targetMass: "Ciljna telesna masa",
    change: "Promena mase",
    fatMass: "Masna masa",
    leanMass: "Čista masa",
    targetFatMass: "Masna masa na cilju",

    formula:
      "masna = m × p/100     čista = m − masna     cilj = čista / (1 − pT/100)     promena = " +
      "cilj − m",
    inputs: "Uneseno",

    errorMass: "Telesna masa mora biti veća od nule.",
    errorBodyFat: "Procenat masti mora biti između 0 i 100, isključivo.",
    errorTarget: "Ciljni procenat masti mora biti između 0 i 100, isključivo.",

    unitKg: "kg",
  },

  "body-indices": {
    mass: "Telesna masa",
    massHint: "U kilogramima.",
    height: "Telesna visina",
    heightHint: "U centimetrima.",
    waist: "Obim struka",
    waistHint: "U centimetrima. Opciono — polje prazno izostavlja redove koji ga koriste.",
    hip: "Obim kukova",
    hipHint: "U centimetrima. Opciono, potreban i za odnos struk/kuk.",

    results: "Rezultat",
    bmi: "BMI",
    ponderal: "Rohrerov indeks (masa / visina³)",
    waistToHeight: "Odnos struk / visina",
    waistToHip: "Odnos struk / kuk",

    formula:
      "BMI = m / v²     Rohrerov indeks = m / v³     struk/visina = struk / visina     struk/kuk " +
      "= struk / kuk",
    inputs: "Uneseno",

    errorMass: "Telesna masa mora biti veća od nule.",
    errorHeight: "Telesna visina mora biti veća od nule.",
    errorWaist: "Uneti obim struka mora biti veći od nule.",
    errorHip: "Uneti obim kukova mora biti veći od nule.",

    unitKg: "kg",
    unitCm: "cm",
    unitBmi: "kg/m²",
    unitPonderal: "kg/m³",
  },

  "cadence-stride-length": {
    cadence: "Kadenca",
    cadenceHint: "Koraci u minutu, obe noge. Ostavi prazno da se izračuna.",
    stepLength: "Dužina koraka",
    stepLengthHint:
      "Dužina JEDNOG koraka u metrima, ne celog ciklusa. Ostavi prazno da se izračuna.",
    speedUnit: "Jedinica brzine",
    speedUnitMps: "m/s",
    speedUnitKmh: "km/h",
    speedUnitPace: "tempo (mm:ss / km)",
    speedValue: "Brzina",
    speedValueHint:
      "Broj za m/s ili km/h, ili tempo kao mm:ss za sekunde po kilometru. Ostavi prazno da se " +
      "izračuna.",
    fieldsHint: "Popuni tačno dva od tri polja — kadencu, dužinu koraka i brzinu. Treće se računa.",

    results: "Rezultat",
    resolvedCadence: "Kadenca",
    resolvedStep: "Dužina koraka",
    stepNote: "Dužina koraka je dužina JEDNOG koraka, ne celog ciklusa (dva koraka).",
    speedMps: "Brzina",
    speedKmh: "Brzina",
    pacePerKm: "Tempo",
    stepsPerKm: "Koraka na kilometar",

    formula:
      "v = kadenca × korak / 60     kadenca = 60v/korak     korak = 60v/kadenca     koraka/km = " +
      "1000/korak",
    inputs: "Uneseno",

    errorFields: "Popuni tačno dva od tri polja — kadencu, dužinu koraka i brzinu.",
    errorCadence: "Kadenca mora biti veća od nule.",
    errorStepLength: "Dužina koraka mora biti veća od nule.",
    errorSpeed: "Brzina mora biti veća od nule.",

    unitStepsPerMin: "koraka/min",
    unitM: "m",
    unitMps: "m/s",
    unitKmh: "km/h",
    unitPerKm: "/km",
    unitStepsPerKm: "koraka/km",
  },

  "erg-split-watts": {
    split: "Split na 500 m",
    splitHint: "Kao m:ss,d (npr. 1:45,3). Ostavi prazno da se izračuna iz snage.",
    power: "Snaga",
    powerHint: "U vatima. Ostavi prazno da se izračuna iz splita.",
    distance: "Distanca za projektovano vreme",
    distanceHint: "Distanca na koju se projektuje vreme pri zadržanom splitu.",
    fieldsHint: "Unesi tačno jedno od dva polja — split ili snagu. Drugo se računa.",

    results: "Rezultat",
    power2: "Snaga",
    split2: "Split na 500 m",
    pace: "Tempo",
    projected: "Projektovano vreme na unetoj distanci",
    projectedNote:
      "Projektovano vreme nije prognoza rezultata, nego aritmetika zadržanog splita na celoj " +
      "distanci.",
    coefficientNote:
      "Koeficijent {coefficient} je Concept2-ova objavljena relacija za prikaz na monitoru, ne " +
      "merenje potrošnje.",
    referenceNote:
      "Split je na {reference} m — RowErg/SkiErg prikaz. Split sa monitora na 1000 m mora se " +
      "prvo prevesti u sekunde po metru.",

    formula:
      "vati = 2,80 / tempo³     tempo = split / 500     projektovano vreme = distanca × tempo",
    inputs: "Uneseno",

    errorFields: "Unesi tačno jedno od dva polja — split ili snagu.",
    errorDistance: "Distanca mora biti veća od nule.",
    errorSplit: "Split mora biti veći od nule.",
    errorPower: "Snaga mora biti veća od nule.",

    unitW: "W",
    unitSPerM: "s/m",
    unitM: "m",
  },

  "heart-rate-zones-karvonen": {
    hrMax: "Maksimalni puls",
    hrMaxHint:
      "Izmerena vrednost, otkucaja u minutu. Ovde nema formule iz godina — 220 minus godine i " +
      "slično su populacioni prosek, ne tvoj puls.",
    hrRest: "Puls u mirovanju",
    hrRestHint: "Otkucaja u minutu.",
    percents: "Procenti za tabelu",
    percentsHint:
      "Razdvoj tačka-zapetom (npr. „60; 70; 80\"). Prazno polje daje podrazumevanu lestvicu " +
      "50–100 % u koracima od 5 %.",
    measuredHr: "Izmereni puls, za obrnut smer",
    measuredHrHint: "Opciono. Puls čiji procenat rezerve i maksimuma želiš da vidiš.",

    results: "Rezultat",
    reserve: "Rezerva pulsa",
    tableTitle: "Ciljni puls po procentu",
    headPercent: "%",
    headKarvonen: "Karvonen",
    headPercentMax: "% maksimuma",
    measuredTitle: "Obrnuti smer za izmereni puls",
    measuredReserve: "Procenat rezerve",
    measuredMax: "Procenat maksimuma",

    formula:
      "rezerva = HRmax − HRrest     Karvonen = HRrest + p×rezerva     %HRmax = p×HRmax     " +
      "obrnuto: %rezerve = 100×(puls − HRrest)/rezerva",
    inputs: "Uneseno",

    errorHrRest: "Puls u mirovanju mora biti ceo broj veći od nule.",
    errorHrMax: "Maksimalni puls mora biti ceo broj veći od pulsa u mirovanju.",
    errorPercents: "Svaki procenat mora biti između 0 i 100.",
    errorMeasuredHr: "Izmereni puls mora biti veći od nule.",

    unitBpm: "otk/min",
  },

  "interval-session-timing": {
    workMode: "Način unosa rada",
    workModeSeconds: "Sekunde",
    workModeTempo: "Tempo (4 faze)",
    workSeconds: "Trajanje rada",
    workSecondsHint: "U sekundama.",
    eccentric: "Ekscentrična faza",
    pauseBottom: "Pauza dole",
    concentric: "Koncentrična faza",
    pauseTop: "Pauza gore",
    tempoHint:
      "Cele sekunde po fazi. Oznaka „X\" se ne prihvata — upiši broj sekundi na koji misliš.",
    restMode: "Način unosa odmora",
    restModeSeconds: "Sekunde",
    restModeRatio: "Odnos rad:odmor",
    restSeconds: "Odmor",
    restSecondsHint: "U sekundama.",
    ratioWork: "Odnos — rad",
    ratioRest: "Odnos — odmor",
    ratioHint: "Npr. za 1:2 upiši 1 i 2.",
    reps: "Ponavljanja u seriji",
    sets: "Broj serija",
    restBetweenSets: "Odmor između serija",
    warmup: "Zagrevanje",
    cooldown: "Smirivanje",
    secondsHint: "U sekundama.",

    results: "Rezultat",
    restResolved: "Odmor između ponavljanja",
    setDuration: "Trajanje jedne serije",
    totalWork: "Ukupno vreme rada",
    totalRest: "Ukupno vreme odmora",
    total: "Ukupno trajanje treninga",
    repRatio: "Zadati odnos rad:odmor",
    sessionRatio: "Odnos kroz ceo trening",
    ratioNote:
      "Zadati odnos važi za jedno ponavljanje. Odnos kroz ceo trening uključuje i odmor između " +
      "serija, pa je to druga veličina.",

    formula:
      "trajanje serije = ponavljanja×rad + (ponavljanja−1)×odmor     " +
      "ukupno = serije×trajanje serije + (serije−1)×odmor između serija + zagrevanje + smirivanje",
    inputs: "Uneseno",

    errorReps: "Ponavljanja u seriji je ceo broj veći od nule.",
    errorSets: "Broj serija je ceo broj veći od nule.",
    errorRestBetweenSets: "Odmor između serija ne sme biti negativan.",
    errorWarmup: "Zagrevanje ne sme biti negativno.",
    errorCooldown: "Smirivanje ne sme biti negativno.",
    errorTempo:
      "Svaka faza tempa je ceo broj sekundi nula ili više, a zbir mora biti veći od nule.",
    errorWork: "Trajanje rada mora biti veće od nule.",
    errorRest: "Odmor mora biti unet.",
    errorRestRatio: "Oba člana odnosa rad:odmor moraju biti veća od nule.",

    unitS: "s",
  },

  "jump-height-flight-time": {
    flightTime: "Vreme leta",
    flightTimeHint: "U sekundama. Ostavi prazno da se izračuna iz visine.",
    height: "Visina skoka",
    heightHint: "U centimetrima. Ostavi prazno da se izračuna iz vremena leta.",
    fieldsHint: "Unesi tačno jedno od dva polja — vreme leta ili visinu.",
    contactTime: "Vreme kontakta sa podlogom",
    contactTimeHint: "U sekundama. Opciono — dodaje indeks reaktivne snage (RSI).",
    gravity: "Gravitacija",
    gravityHint: "U m/s². Podrazumevano 9,80665 (standardna gravitacija).",

    results: "Rezultat",
    condition: "Uslov računa",
    conditionNote:
      "Let mora biti simetričan oko najviše tačke, sa odrazom i doskokom na istoj visini — inače " +
      "broj opisuje nešto drugo.",
    height2: "Visina skoka",
    flightTime2: "Vreme leta",
    takeoff: "Brzina u trenutku odraza",
    rsi: "Indeks reaktivne snage (visina ÷ vreme kontakta)",
    gravityUsed: "Korišćena gravitacija",

    formula: "h = g·t²/8     t = √(8h/g)     v = g·t/2     RSI = h/tk",
    inputs: "Uneseno",

    errorFields: "Unesi tačno jedno od dva polja — vreme leta ili visinu.",
    errorGravity: "Gravitacija mora biti veća od nule.",
    errorFlightTime: "Vreme leta mora biti veće od nule.",
    errorHeight: "Visina skoka mora biti veća od nule.",
    errorContactTime: "Vreme kontakta mora biti veće od nule.",

    unitCm: "cm",
    unitS: "s",
    unitMps: "m/s",
    unitG: "m/s²",
  },

  "limb-symmetry-index": {
    involved: "Vrednost na ispitivanoj strani",
    involvedHint: "U istoj jedinici kao referentna vrednost.",
    reference: "Vrednost na referentnoj strani",
    referenceHint: "U istoj jedinici kao ispitivana vrednost.",
    target: "Ciljni odnos",
    targetHint:
      "Iz kriterijuma koji primenjuješ. Nexus ne zna koji je to kriterijum i ne nudi vrednost.",
    unit: "Jedinica",
    unitHint:
      "Slobodan tekst (kg, cm, N, °…). Jedinice se ne pretvaraju — obe vrednosti moraju biti u " +
      "istoj.",

    results: "Rezultat",
    ratio: "Odnos ispitivana ÷ referentna",
    shortfall: "Razlika do 100 %",
    needed: "Potrebna vrednost na ispitivanoj strani, pri unetom cilju",
    gap: "Razlika između potrebne i izmerene vrednosti",
    unitNote:
      "Jedinice se ne pretvaraju — oba unosa se računaju kao goli brojevi u istoj jedinici.",

    formula:
      "odnos = 100×ispitivana/referentna     razlika do 100 = 100 − odnos     " +
      "potrebna = referentna×cilj/100     razlika = potrebna − ispitivana",
    inputs: "Uneseno",

    errorInvolved: "Vrednost na ispitivanoj strani ne sme biti negativna.",
    errorReference: "Vrednost na referentnoj strani mora biti veća od nule.",
    errorTarget: "Ciljni odnos mora biti veći od nule.",
  },

  "one-rep-max-table": {
    load: "Težina serije",
    loadHint: "U kilogramima.",
    reps: "Broj ponavljanja",
    repsHint: "Ceo broj od 1 do 10.",
    formula2: "Formula za tabelu",
    formulaEpley: "Epli",
    formulaBrzycki: "Bžicki",
    step: "Korak zaokruživanja",
    stepHint: "Najmanji par diskova koji imaš, u kilogramima.",
    known1Rm: "Poznat 1RM",
    known1RmHint: "Opciono. Kad je unet, tabela se računa iz njega i formule se ne koriste.",
    customPercent: "Dodatni procenat",
    customPercentHint: "Opciono — jedan procenat van lestvice 100 do 50 %, po tvom programu.",

    results: "Rezultat",
    epley: "Epli 1RM",
    brzycki: "Bžicki 1RM",
    singleRepNote: "Za jedno ponavljanje oba broja jednaka su unetoj težini.",
    knownNote: "Tabela je izračunata iz unetog 1RM — formule iznad se ne koriste za tabelu.",
    tableTitle: "Tabela opterećenja",
    headPercent: "%",
    headExact: "Tačno",
    headLoadable: "Zaokruženo na korak",

    formula:
      "Epli: w×(1 + r/30)     Bžicki: w×36/(37 − r)     tabela: baza × procenat, zaokruženo na " +
      "korak",
    inputs: "Uneseno",

    errorLoad: "Težina serije mora biti veća od nule.",
    errorReps: "Broj ponavljanja je ceo broj od 1 do 10.",
    errorStep: "Korak zaokruživanja mora biti veći od nule.",
    errorKnown1Rm: "Poznat 1RM mora biti veći od nule.",
    errorCustomPercent: "Dodatni procenat mora biti veći od nule.",

    unitKg: "kg",
  },

  "running-pace-splits": {
    distance: "Distanca",
    distanceUnit: "Jedinica distance",
    distanceUnitM: "m",
    distanceUnitKm: "km",
    distanceUnitMile: "međunarodna milja (1609,344 m)",
    time: "Vreme",
    timeHint: "Kao h:mm:ss ili mm:ss, decimale sekunde dozvoljene. Ostavi prazno da se izračuna.",
    pace: "Tempo",
    paceHint: "Kao mm:ss. Ostavi prazno da se izračuna.",
    paceUnit: "Jedinica tempa",
    paceUnitPerKm: "po kilometru",
    paceUnitPerMile: "po milji",
    fieldsHint: "Popuni tačno dva od tri polja — distancu, vreme i tempo. Treće se računa.",
    splitStep: "Korak tabele međuvremena",
    splitStepUnit: "Jedinica koraka",
    splitStepUnitM: "m",
    splitStepUnitKm: "km",

    results: "Rezultat",
    pacePerKm: "Tempo po kilometru",
    pacePerMile: "Tempo po milji",
    pacePer100m: "Tempo na 100 m",
    speedKmh: "Brzina",
    speedMps: "Brzina",
    splitsTitle: "Tabela međuvremena",
    headIndex: "Deonica",
    headDistance: "Kumulativna distanca",
    headTime: "Kumulativno vreme",

    formula:
      "tempo/km = 1000×t/d     tempo/milju = 1609,344×t/d     tempo/100m = 100×t/d     " +
      "v = d/t     međuvreme(k) = min(k×korak, d)×t/d",
    inputs: "Uneseno",

    errorFields: "Popuni tačno dva od tri polja — distancu, vreme i tempo.",
    errorStep: "Korak tabele mora biti veći od nule.",
    errorDistance: "Distanca mora biti veća od nule.",
    errorTime: "Vreme mora biti veće od nule.",
    errorPace: "Tempo mora biti veći od nule.",
    errorTooManyRows: "Korak je previše fin za ovu distancu — tabela bi imala previše redova.",

    unitM: "m",
    unitKmh: "km/h",
    unitMps: "m/s",
    unitPerKm: "/km",
    unitPerMile: "/milju",
    unitPer100m: "/100 m",
  },

  "set-tempo-tut": {
    eccentric: "Ekscentrična faza",
    pauseBottom: "Pauza dole",
    concentric: "Koncentrična faza",
    pauseTop: "Pauza gore",
    tempoHint:
      "Cele sekunde po fazi. Oznaka „X\" se ne prihvata — upiši broj sekundi na koji misliš.",
    reps: "Ponavljanja po seriji",
    sets: "Broj serija",
    restBetweenSets: "Pauza između serija",
    restBetweenSetsHint: "U sekundama.",

    results: "Rezultat",
    perRep: "Trajanje jednog ponavljanja",
    tutPerSet: "Vreme pod opterećenjem po seriji",
    totalTut: "Ukupno vreme pod opterećenjem",
    block: "Ukupno trajanje bloka",
    definitionNote:
      "Vreme pod opterećenjem je zbir sve četiri faze — obe koncentrične i obe pauze, ne samo " +
      "pokret.",

    formula:
      "ponavljanje = ekscentrična + pauza dole + koncentrična + pauza gore     " +
      "serija = ponavljanja×ponavljanje     blok = serije×serija + (serije−1)×pauza",
    inputs: "Uneseno",

    errorTempo: "Svaka faza je ceo broj sekundi nula ili više, a zbir mora biti veći od nule.",
    errorReps: "Ponavljanja po seriji je ceo broj veći od nule.",
    errorSets: "Broj serija je ceo broj veći od nule.",
    errorRestBetweenSets: "Pauza između serija je ceo broj sekundi nula ili više.",

    unitS: "s",
  },

  "split-times-fatigue": {
    times: "Spisak vremena",
    timesHint: "Jedno vreme po redu, kao mm:ss,cc ili sekunde sa decimalama. Najmanje dva reda.",

    results: "Rezultat",
    count: "Broj vremena",
    total: "Zbir",
    mean: "Prosek",
    median: "Medijana",
    best: "Najbolje",
    worst: "Najslabije",
    range: "Raspon",
    fatigueIndex: "Indeks zamora (pad u odnosu na najbolje vreme)",
    decrement: "Procenat pada (Sdec)",

    formula:
      "indeks zamora = 100×(najsporije − najbrže)/najbrže     Sdec = 100×(zbir/(n×najbrže) − 1)  " +
      "   medijana = srednja vrednost sortiranog spiska",
    inputs: "Uneseno",

    errorTimes: "Unesi najmanje dva vremena, svako veće od nule.",

    unitS: "s",
    unitPercent: "%",
  },

  "sweat-rate-hydration": {
    preMass: "Masa pre treninga",
    postMass: "Masa posle treninga",
    massHint: "U kilogramima.",
    drunk: "Popijena tečnost",
    drunkHint: "U mililitrima.",
    food: "Unesena hrana",
    foodHint:
      "Hrana i gelovi progutani tokom treninga, u gramima — ulaze u bilans isto kao tečnost.",
    urine: "Izmokreno i ostali izmereni gubitak",
    urineHint: "U mililitrima.",
    duration: "Trajanje treninga",
    durationHint: "U minutima.",
    replacementPercent: "Procenat nadoknade koji se planira",

    results: "Rezultat",
    conventionNote: "Konvencija: 1 g promene mase = 1 mL.",
    massLost: "Promena mase",
    percentBodyMass: "Izgubljena telesna masa",
    sweatGrams: "Ukupan gubitak znojem",
    sweatMl: "Isto, po konvenciji 1 g = 1 mL",
    ratePerHour: "Stopa znojenja",
    litresPerHour: "Stopa znojenja",
    replacementPerHour: "Stopa pri unetom procentu nadoknade",

    formula:
      "znoj = (masa pre − masa posle)×1000 + tečnost + hrana − izmokreno     " +
      "stopa = 60×znoj/trajanje     procenat mase = 100×(masa pre − masa posle)/masa pre",
    inputs: "Uneseno",

    errorPreMass: "Masa pre treninga mora biti veća od nule.",
    errorPostMass: "Masa posle treninga mora biti veća od nule.",
    errorDrunk: "Popijena tečnost ne sme biti negativna.",
    errorFood: "Unesena hrana ne sme biti negativna.",
    errorUrine: "Izmokreno ne sme biti negativno.",
    errorDuration: "Trajanje treninga mora biti veće od nule.",
    errorReplacementPercent: "Procenat nadoknade mora biti veći od nule.",

    unitKg: "kg",
    unitG: "g",
    unitMl: "mL",
    unitMlPerH: "mL/h",
    unitLPerH: "L/h",
    unitPercent: "%",
  },

  "training-volume-load": {
    rows: "Redovi programa",
    rowsHint:
      "Jedan red po liniji, kao serije×ponavljanja×opterećenje, opciono i ×1RM za taj red " +
      "(npr. „5x5x100\" ili „5x5x100x130\").",

    results: "Rezultat",
    rowsTitle: "Po redu",
    headReps: "Ponavljanja",
    headTonnage: "Tonaža",
    headIntensity: "Intenzitet",
    totalSets: "Ukupno serija",
    totalReps: "Ukupno ponavljanja",
    tonnage: "Ukupna tonaža",
    meanLoad: "Prosečno opterećenje po ponavljanju",
    groupsTitle: "Prosečan intenzitet po unetom 1RM",
    headOneRm: "1RM",
    headMeanIntensity: "Prosečan intenzitet (tonažom ponderisan)",

    formula:
      "ponavljanja reda = serije×ponavljanja po seriji     tonaža reda = ponavljanja×opterećenje " +
      "    prosečno opterećenje = ukupna tonaža/ukupna ponavljanja     intenzitet = 100×prosečno " +
      "opterećenje/1RM",
    inputs: "Uneseno",

    errorRows:
      "Svaki red mora imati cele serije i ponavljanja veće od nule, i opterećenje nula ili više.",

    unitKg: "kg",
    unitPercent: "%",
  },

  "weight-class-cut": {
    mass: "Trenutna telesna masa",
    massHint: "U kilogramima.",
    limit: "Granica kategorije",
    limitHint:
      "Iz propozicija takmičenja koje primenjuješ. Nexus ne zna koje su to propozicije i ne nudi " +
      "vrednost.",
    days: "Broj dana do vaganja",
    daysHint: "Ceo broj dana. Dan vaganja se ne računa u podelu.",

    results: "Rezultat",
    difference: "Razlika u odnosu na granicu",
    aboveNote: "Trenutna masa je iznad unete granice.",
    belowNote: "Trenutna masa je ispod unete granice (rezerva).",
    percentOfMass: "Isto, kao procenat trenutne mase",
    perDay: "Razlika po danu, ravnomerno do vaganja",
    perWeek: "Razlika po nedelji, ravnomerno do vaganja",
    daysUsed: "Broj dana korišćen u podeli",
    extrapolatedNote:
      "Nedeljna vrednost je preračun preko unetog horizonta — do vaganja ostaje manje od sedam " +
      "dana.",

    formula:
      "razlika = masa − granica     procenat = 100×razlika/masa     dnevno = razlika/dani     " +
      "nedeljno = 7×razlika/dani",
    inputs: "Uneseno",

    errorMass: "Trenutna telesna masa mora biti veća od nule.",
    errorLimit: "Granica kategorije mora biti veća od nule.",
    errorDays: "Broj dana do vaganja je ceo broj nula ili više.",

    unitKg: "kg",
  },
} as const;
