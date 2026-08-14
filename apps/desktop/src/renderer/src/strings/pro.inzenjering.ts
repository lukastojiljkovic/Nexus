/**
 * „Inženjering i elektrotehnika" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those
 * live in the `name` and `blurb` tables of `./pro.ts`.
 *
 * **Almost everything in this pack is `life-safety`.** A conductor, a
 * fastener, a pressure vessel, a belt guard — a wrong number here is not a
 * cosmetic bug. So this file never writes a verdict word: no „zadovoljava",
 * „bezbedno", „ispravno", „u skladu", „dozvoljeno". Where a limit appears it
 * is always „granica koju si uneo" — whose it is, said in the label — and
 * the number beside it is left to speak for itself.
 */
export const PRO_INZENJERING_SR = {
  "awg-to-mm2": {
    direction: "Smer",
    directionToMetric: "AWG → metrički",
    directionToAwg: "Metrički → AWG",
    material: "Materijal",
    materialHint: "Utiče samo na red Ω/km — geometrija ne zavisi od materijala.",
    materialCopper: "bakar",
    materialAluminium: "aluminijum",
    gauge: "AWG broj n",
    gaugeHint: "Ceo broj 40 do 0000, gde je 00 = −1, 000 = −2, 0000 = −3.",
    known: "Poznato",
    knownDiameter: "prečnik",
    knownArea: "presek",
    value: "Vrednost",
    diameterMm: "Prečnik",
    diameterIn: "Prečnik u inčima",
    areaMm2: "Presek",
    resistance: "Otpornost punog provodnika na 20 °C",
    resistanceNote:
      "Ovo je otpornost PUNOG provodnika tačno te geometrije. Uže istog AWG broja ide oko 2 % " +
      "više, i stvarna vrednost za uže dolazi sa deklaracije proizvođača.",
    tableNote:
      "Ovo je definišuća formula AWG niza, izračunata direktno. Objavljene tablice su ista " +
      "formula zaokružena na četiri decimale inča, pa se poslednja cifra ponekad razlikuje — to " +
      "je formula tačnija od zaokružene tablice, ne greška.",
    fractionalGauge: "Razlomljeni AWG broj",
    nearestGauge: "Najbliži ceo AWG broj",
    nearestDiameter: "Prečnik najbližeg celog broja",
    nearestArea: "Presek najbližeg celog broja",
    // „4/0" and not „#0000" — the same gauge in the other standard notation.
    // Four zeroes behind a hash is also a four-digit hex colour, so `check:colours`
    // reads it as a raw literal; this is the second time the collision has come up.
    outsideSeriesNote: "Najbliži ceo AWG broj pada van opsega 40 … 4/0, pa nije prikazan.",
    results: "Rezultat",
    formula:
      "d(n) = 0,127 · 92^((36−n)/39) mm     S = πd²/4     R/km = 1000·ρ₂₀/S     (obrnuto: n = 36 " +
      "− 39·ln(d/0,127)/ln 92)",
    inputs: "Uneseno",
    errorGauge: "AWG broj je ceo broj od 40 do 0000 (unesi 00, 000 i 0000 kao −1, −2, −3).",
    errorDiameter: "Prečnik mora biti između 0 i 20 mm.",
    errorArea: "Presek mora biti između 0 i 300 mm².",
    errorKnown: "Unesi tačno jedno od dvoje — prečnik ili presek.",
    unitMm: "mm",
    unitIn: "in",
    unitMm2: "mm²",
    unitOhmKm: "Ω/km",
  },

  "battery-bank-runtime": {
    cellCapacity: "Kapacitet ćelije ili baterije",
    cellCapacityHint: "Kapacitet JEDNE ćelije, pre množenja brojem u paraleli.",
    cellVoltage: "Nazivni napon ćelije ili baterije",
    series: "Broj u seriji",
    seriesHint: "Prazno polje znači 1.",
    parallel: "Broj u paraleli",
    parallelHint: "Prazno polje znači 1.",
    depthOfDischarge: "Dozvoljena dubina pražnjenja",
    depthOfDischargeHint:
      "Podatak o hemiji ćelije i garanciji proizvođača — Nexus ga ne pogađa. Bez unosa nema " +
      "rezultata.",
    loadKind: "Vrsta opterećenja",
    loadPower: "snaga [W]",
    loadCurrent: "struja [A]",
    load: "Opterećenje",
    efficiency: "Stepen korisnosti pretvarača",
    efficiencyHint:
      "Prazno polje znači 100 % — dok ne kažeš da pretvarač postoji, gubitak se ne pretpostavlja.",
    efficiencyNote:
      "Stepen korisnosti ulazi u račun samo kada je opterećenje uneto u vatima — struja izmerena " +
      "na priključcima baterije već ga sadrži, pa se tu ne primenjuje drugi put.",
    peukert: "Pojkertov eksponent k",
    peukertHint:
      "Od 1 do 2. Prazno polje znači 1, što je bez korekcije — neutralna vrednost, ne " +
      "pretpostavka o ćeliji.",
    peukertNote:
      "Pojkertova korekcija je primenjena na puno pražnjenje, a dubina pražnjenja je zatim " +
      "primenjena na to vreme linearno — to je uobičajena konvencija, ne posledica samog " +
      "Pojkertovog zakona.",
    ratedHours: "Nazivni režim pražnjenja H",
    ratedHoursHint: "Broj sati na koji se uneti kapacitet odnosi. Obavezno samo kada je k > 1.",
    results: "Rezultat",
    packVoltage: "Napon paketa",
    packCapacity: "Kapacitet paketa",
    energy: "Energija",
    usableEnergy: "Iskoristiva energija",
    packCurrent: "Struja iz paketa",
    hours: "Vreme rada",
    hoursWithoutPeukert: "Vreme rada bez Pojkertove korekcije",
    modelNote:
      "Model je konstantno opterećenje na nazivnoj temperaturi, bez starenja ćelije i bez pada " +
      "napona.",
    formula:
      "U = s·U_ćelije     C = p·C_ćelije     E = U·C     E_isk = E·DoD·η     t = E_isk/P  ili  t " +
      "= C·DoD/I",
    inputs: "Uneseno",
    errorCapacity: "Kapacitet mora biti veći od nule.",
    errorVoltage: "Napon ćelije mora biti veći od nule.",
    errorSeries: "Broj u seriji je ceo broj od 1 do 1000.",
    errorParallel: "Broj u paraleli je ceo broj od 1 do 1000.",
    errorDepthOfDischarge: "Dubina pražnjenja mora biti između 0 i 100 %.",
    errorEfficiency: "Stepen korisnosti mora biti između 0 i 100 %.",
    errorPeukert: "Pojkertov eksponent je između 1 i 2.",
    errorLoad: "Opterećenje mora biti veće od nule.",
    errorRatedHours:
      "Nazivni režim pražnjenja je obavezan kada je k > 1, i mora biti između 0 i 100 h.",
    unitV: "V",
    unitAh: "Ah",
    unitWh: "Wh",
    unitA: "A",
    unitH: "h",
  },

  "belt-and-gear-drive": {
    regime: "Režim",
    regimeBelt: "kaišni prenos",
    regimeGear: "zupčasti par",
    drivingDiameter: "Prečnik pogonske remenice",
    drivenDiameter: "Prečnik gonjene remenice",
    pitchDiameterHint: "Diobeni (računski) prečnik, ne spoljni prečnik izmeren pomičnim merilom.",
    drivingSpeed: "Broj obrtaja pogonske",
    centreDistance: "Osno rastojanje",
    drivingTorque: "Moment na pogonskoj",
    efficiency: "Stepen korisnosti prenosa",
    efficiencyHint: "Prazno polje znači 100 % — neutralna vrednost dok gubitak nije poznat.",
    errorDrivingDiameter: "Prečnik pogonske remenice mora biti između 0 i 10000 mm.",
    errorDrivenDiameter: "Prečnik gonjene remenice mora biti između 0 i 10000 mm.",
    errorSpeed: "Broj obrtaja mora biti u opsegu 0 do 1 000 000 min⁻¹.",
    errorCentreDistance:
      "Osno rastojanje mora biti veće od nule i dovoljno veliko da male remenice ne upadnu jedna " +
      "u drugu.",
    errorEfficiency: "Stepen korisnosti mora biti između 0 i 100 %.",
    errorTorque: "Moment mora biti u opsegu 0 do 1e9 N·m.",
    errorDrivingTeeth: "Broj zuba pogonskog zupčanika je ceo broj od 1 do 10000.",
    errorDrivenTeeth: "Broj zuba gonjenog zupčanika je ceo broj od 1 do 10000.",
    errorModule: "Modul mora biti između 0 i 100 mm.",
    results: "Rezultat",
    ratio: "Prenosni odnos i",
    drivenSpeed: "Broj obrtaja gonjene",
    beltSpeed: "Brzina kaiša",
    beltLength: "Dužina otvorenog kaiša",
    wrapSmall: "Ugao obuhvata male remenice",
    wrapLarge: "Ugao obuhvata velike remenice",
    drivenTorque: "Moment na gonjenoj",
    beltPitchNote:
      "Prečnici u ovom računu su diobeni (računski). Kod klinastog kaiša to nisu spoljni " +
      "prečnici koje meriš pomičnim merilom.",
    beltFormula: "i = d₂/d₁     v = πd₁n₁/60000     L = √(4C²−(D−d)²) + (D/2)(π+2γ) + (d/2)(π−2γ)",
    inputs: "Uneseno",
    drivingTeeth: "Broj zuba pogonskog",
    drivenTeeth: "Broj zuba gonjenog",
    module: "Modul m",
    moduleHint: "Bez modula nema podeonih prečnika ni osnog rastojanja.",
    drivingPitchDiameter: "Podeoni prečnik pogonskog",
    drivenPitchDiameter: "Podeoni prečnik gonjenog",
    gearCentreDistance: "Osno rastojanje",
    gearCentreDistanceNote:
      "Osno rastojanje a = m·(z₁+z₂)/2 važi samo za standardan SPOLJAŠNJI par cilindričnih " +
      "zupčanika bez pomeraja profila. Za unutrašnji par ili pomeren profil ova formula ne važi.",
    gearFormula: "i = z₂/z₁     d = m·z     a = m·(z₁+z₂)/2",
    unitRpm: "min⁻¹",
    unitMs: "m/s",
    unitMm: "mm",
    unitDeg: "°",
    unitNm: "N·m",
  },

  "cable-cross-section": {
    system: "Sistem",
    material: "Materijal",
    materialCopper: "bakar",
    materialAluminium: "aluminijum",
    length: "Dužina trase L",
    lengthHint:
      "Dužina u JEDNOM smeru. Faktor k već sadrži povratni provodnik — ne udvostručuj ovde.",
    current: "Struja I",
    voltage: "Nazivni napon U",
    voltageHint:
      "U trofaznom sistemu ovo je LINIJSKI napon uravnoteženog opterećenja. Jednofazni potrošač " +
      "sa trofazne table računa se u jednofaznom sistemu, faznim naponom.",
    permittedDrop: "Dozvoljeni pad napona ΔU_dop",
    permittedDropHint:
      "Iz propisa koji primenjuješ. Nexus ne zna koji je to propis i ne nudi vrednost.",
    temperature: "Temperatura provodnika θ",
    temperatureHint:
      "Temperatura PROVODNIKA pod opterećenjem, ne okoline. Prazno polje znači 20 °C, referentna " +
      "temperatura na kojoj je otpornost definisana — daje najmanji mogući rezultat.",
    temperatureNote:
      "Na 70 °C je otpornost bakra veća 1,1965 puta nego na 20 °C, i potreban presek raste za " +
      "isti činilac.",
    chosenArea: "Presek koji si sam izabrao",
    chosenAreaHint: "Opciono — za red o padu napona na tom preseku.",
    errorLength: "Dužina trase mora biti između 0 i 100000 m.",
    errorCurrent: "Struja mora biti između 0 i 100000 A.",
    errorVoltage: "Napon mora biti veći od nule.",
    errorPermittedDrop: "Dozvoljeni pad napona mora biti između 0 i 100 %.",
    errorTemperature: "Temperatura provodnika je van opsega −60 … 250 °C.",
    errorChosenArea: "Izabrani presek mora biti između 0 i 5000 mm².",
    resistivity: "Upotrebljena otpornost ρ(θ)",
    loopFactor: "Upotrebljeni činilac k",
    maxDrop: "Dozvoljeni pad ΔU_max",
    minimumArea: "Potreban presek S_min",
    roundUpNote:
      "S_min je najmanji presek koji drži pad unutar granice. Pri izboru stvarnog kabla ovaj " +
      "broj se zaokružuje NAVIŠE na najbliži standardni presek, nikad naniže.",
    dropAtChosenPct: "Pad na izabranom preseku",
    dropAtChosenV: "Pad na izabranom preseku, u voltima",
    dropRatio: "Pad ÷ tvoja granica",
    reactanceNote:
      "Model je čisto omski (X = 0, cos φ = 1). Kod velikih preseka induktivna reaktansa postaje " +
      "uporediva sa otporom, pa je stvarni pad VEĆI od izračunatog i S_min može biti manji nego " +
      "što je potrebno.",
    lengthNote:
      "S_min je presek PO JEDNOM provodniku. Račun ne poznaje paralelne provodnike po fazi.",
    systemNote:
      "Ista trasa uneta kao trofazna umesto jednofazna daje drugačiji presek — jednofazni " +
      "potrošač sa trofazne table treba jednofaznu granu.",
    formula:
      "S_min = k·ρ(θ)·L·I/ΔU_max     ρ(θ) = ρ₂₀·(1+α₂₀·(θ−20))     k = 2 (DC/1-fazno) ili √3 " +
      "(3-fazno)",
    results: "Rezultat",
    inputs: "Uneseno",
    unitOhmMmM: "Ω·mm²/m",
    unitV: "V",
    unitMm2: "mm²",
    unitM: "m",
    unitA: "A",
    unitDeg: "°C",
  },

  "induction-motor-rating": {
    system: "Sistem",
    shaftPower: "Snaga na vratilu P",
    shaftPowerHint: "Sa natpisne pločice.",
    voltageSingle: "Napon napajanja U",
    voltageThree: "Linijski napon U",
    powerFactor: "Faktor snage cos φ",
    plateHint: "Sa natpisne pločice — Nexus ga ne pogađa iz razreda IE ni iz bilo čega drugog.",
    efficiency: "Stepen korisnosti η",
    poles: "Broj polova",
    polesHint: "Paran ceo broj, najmanje 2.",
    frequency: "Frekvencija f",
    measuredSpeed: "Izmereni broj obrtaja n",
    measuredSpeedHint:
      "Opciono — bez njega nema klizanja, a moment se računa pri sinhronoj brzini.",
    errorPower: "Snaga mora biti veća od nule.",
    errorVoltage: "Napon mora biti veći od nule.",
    errorPowerFactor: "Faktor snage mora biti između 0 i 1.",
    errorEfficiency: "Stepen korisnosti mora biti između 0 i 100 %.",
    errorPoles: "Broj polova je paran ceo broj, najmanje 2.",
    errorFrequency: "Frekvencija mora biti veća od nule.",
    errorSpeed: "Izmereni broj obrtaja mora biti veći od nule.",
    results: "Rezultat",
    current: "Nazivna struja I",
    inputPower: "Ulazna snaga P₁",
    synchronousSpeed: "Sinhrona brzina n_s",
    slip: "Klizanje s",
    generating: "generatorski rad",
    torque: "Obrtni moment M",
    atSynchronous: "pri sinhronoj brzini",
    atMeasured: "pri izmerenoj brzini",
    currentNote:
      "Struja je ULAZNA struja motora — stepen korisnosti je u njoj, jer je nazivna snaga na " +
      "pločici snaga na vratilu, a motor iz mreže vuče više od toga.",
    formula: "I = 1000P/(f₃·U·cos φ·η)     n_s = 120f/p     s = (n_s−n)/n_s     M = 30000P/(πn)",
    inputs: "Uneseno",
    unitA: "A",
    unitKw: "kW",
    unitRpm: "min⁻¹",
    unitNm: "N·m",
    unitV: "V",
    unitHz: "Hz",
  },

  "junction-temperature": {
    regime: "Smer",
    regimeJunction: "temperatura spoja",
    regimeSink: "potreban Rth hladnjaka",
    regimePower: "dozvoljena snaga",
    ambient: "Temperatura okoline T_a",
    junctionToCase: "Rth spoj–kućište",
    junctionToCaseHint: "Iz kataloškog lista.",
    caseToSink: "Rth kućište–hladnjak",
    caseToSinkHint: "Podatak o montaži, pasti i podlošci.",
    sinkToAmbient: "Rth hladnjak–okolina",
    sinkToAmbientHint:
      "Potreban u pravom smeru; u obrnutim smerovima je ono što se traži ili proverava.",
    dissipation: "Disipirana snaga P",
    maxJunction: "Najviša temperatura spoja T_j_max",
    maxJunctionHint: "Iz kataloškog lista.",
    errorDissipation: "Snaga mora biti veća od nule.",
    errorAmbient: "Temperatura okoline je van opsega −60 … 200 °C.",
    errorJunctionToCase: "Rth spoj–kućište mora biti između 0 i 1000 K/W.",
    errorCaseToSink: "Rth kućište–hladnjak mora biti između 0 i 1000 K/W.",
    errorSinkToAmbient: "Rth hladnjak–okolina mora biti između 0 i 1000 K/W.",
    errorMaxJunction: "Najviša temperatura spoja je van opsega 0 … 400 °C.",
    errorAmbientAtOrAboveLimit:
      "Temperatura okoline je već na nivou najviše temperature spoja ili iznad nje.",
    errorChainOverBudget:
      "Zbir postojećih otpora (spoj–kućište, kućište–hladnjak) sam po sebi premašuje raspoloživi " +
      "temperaturni budžet — nijedan hladnjak te montaže ne može da to nadoknadi.",
    results: "Rezultat",
    totalRth: "Ukupan Rth",
    junctionTemp: "Temperatura spoja T_j",
    caseTemp: "Temperatura kućišta",
    sinkTemp: "Temperatura hladnjaka",
    modelNote:
      "Statički jednodimenzionalni model: ustaljeno stanje, jedan toplotni put, bez sprege sa " +
      "susednim delovima i bez prelaznog režima.",
    formula:
      "T_j = T_a + P·ΣRth     T_kućišta = T_j − P·Rth(j-c)     T_hladnjaka = T_j − " +
      "P·(Rth(j-c)+Rth(c-h))",
    sinkFormula: "Rth(h-a) = (T_j_max−T_a)/P − Rth(j-c) − Rth(c-h)",
    powerFormula: "P_max = (T_j_max−T_a)/ΣRth",
    inputs: "Uneseno",
    availableRise: "Raspoloživ temperaturni budžet",
    requiredSink: "Potreban Rth(h-a)",
    maxDissipation: "Dozvoljena snaga P_max",
    unitKW: "K/W",
    unitDeg: "°C",
    unitW: "W",
  },

  "metric-thread-strength": {
    nominalDiameter: "Nominalni prečnik d",
    pitch: "Korak navoja P",
    pitchHint: "Krupan ili sitan korak — bira ga korisnik, tablica koraka nije potrebna.",
    strength: "Granica tečenja ili zatezna čvrstoća R",
    strengthHint:
      "Vrednost razreda čvrstoće kojim je spojni element kupljen (npr. 8.8 → R_p0,2 = 640 MPa). " +
      "Nexus razred ne bira.",
    drill: "Prečnik burgije",
    drillHint:
      "Za red o procentu zahvata navoja. Mora biti između unutrašnjeg prečnika D₁ i nominalnog d.",
    errorDiameter: "Nominalni prečnik mora biti između 0 i 200 mm.",
    errorPitch: "Korak mora biti veći od nule i manji od prečnika podeljenog sa 1,226869.",
    errorStrength: "Čvrstoća mora biti između 0 i 3000 MPa.",
    errorDrill:
      "Prečnik burgije mora biti između unutrašnjeg prečnika navrtke D₁ i nominalnog prečnika d.",
    results: "Rezultat",
    fundamentalHeight: "Visina osnovnog trougla H",
    pitchDiameter: "Srednji prečnik d₂",
    minorDiameterBolt: "Jezgreni prečnik vijka d₃",
    minorDiameterNut: "Unutrašnji prečnik navrtke D₁",
    stressArea: "Presek napona A_s",
    force: "Sila F = A_s·R",
    forceNote:
      "Ovo je sila pri kojoj napon u preseku A_s dostiže unetu čvrstoću — ne dozvoljeno " +
      "opterećenje spoja. Bez prednaprezanja, trenja, ekscentričnosti, dužine zahvata, zamora i " +
      "broja vijaka.",
    engagement: "Procenat zahvata (prema H₁ = 5/8·H)",
    engagementNote:
      "Konvencija ISO 898-1: 100 % znači pun oblik unutrašnjeg navoja prema H₁ = (5/8)H.",
    engagementWorkshop: "Procenat zahvata (radionička konvencija)",
    engagementWorkshopNote:
      "Starija konvencija sa radioničke tablice, merena prema drugoj referentnoj dubini. Za isti " +
      "prečnik burgije daje drugačiji broj od reda iznad — obe su tačne u svom sistemu.",
    formula:
      "H = P·√3/2     d₂ = d−(3/4)H     d₃ = d−(17/12)H     D₁ = d−(5/4)H     A_s = " +
      "(π/4)((d₂+d₃)/2)²",
    inputs: "Uneseno",
    unitMm: "mm",
    unitMm2: "mm²",
    unitKn: "kN",
    unitMpa: "MPa",
  },

  "ohms-law-power": {
    voltage: "Napon U",
    current: "Struja I",
    resistance: "Otpornost R",
    power: "Snaga P",
    pairHint: "Unesi tačno dve od četiri veličine — preostale dve se računaju.",
    errorPair: "Unesi tačno dve od četiri veličine.",
    errorVoltage: "Napon mora biti u opsegu 0 do 1e9 V.",
    errorCurrent: "Struja mora biti u opsegu 0 do 1e6 A, i ne sme biti nula uz uneti napon.",
    errorResistance:
      "Otpornost mora biti u opsegu 0 do 1e12 Ω, i ne sme biti nula uz uneti napon ili snagu.",
    errorPower: "Snaga mora biti u opsegu 0 do 1e9 W, i ne sme biti nula uz uneti napon.",
    results: "Rezultat",
    entered: "uneto",
    computed: "izračunato",
    formula: "U = IR     P = UI     (iz bilo koje dve veličine)",
    inputs: "Uneseno",
    unitV: "V",
    unitA: "A",
    unitOhm: "Ω",
    unitW: "W",
  },

  "pipe-flow-velocity": {
    innerDiameter: "Unutrašnji prečnik D",
    innerDiameterHint: "Ništa u ovom računu ne važi za nekružni kanal.",
    known: "Poznato",
    knownFlow: "protok Q",
    knownVelocity: "brzina v",
    flow: "Protok Q",
    flowUnit: "Jedinica protoka",
    velocity: "Brzina v",
    velocityNote: "Srednja brzina preko celog preseka — ne lokalna ni osna vrednost.",
    viscosity: "Kinematička viskoznost ν",
    viscosityHint:
      "Svojstvo fluida na temperaturi koju stvarno imaš — bez toga nema Rejnoldsovog broja.",
    density: "Gustina ρ",
    densityHint: "Bez nje nema masenog protoka.",
    errorDiameter: "Prečnik mora biti između 0 i 10000 mm.",
    errorFlow: "Protok ne sme biti negativan.",
    errorVelocity: "Brzina ne sme biti negativna.",
    errorViscosity: "Viskoznost mora biti između 0 i 1e6 mm²/s.",
    errorDensity: "Gustina mora biti između 0 i 25000 kg/m³.",
    errorKnown: "Unesi tačno jedno od dvoje — protok ili brzinu.",
    results: "Rezultat",
    areaMm2: "Površina preseka",
    flowLs: "Protok",
    flowLmin: "Protok u l/min",
    flowM3h: "Protok u m³/h",
    flowM3s: "Protok u m³/s",
    reynolds: "Rejnoldsov broj Re",
    reynoldsHint: "Bez unete viskoznosti Rejnoldsov broj se ne prikazuje.",
    massFlowKgS: "Maseni protok",
    massFlowKgH: "Maseni protok u kg/h",
    roundDuctNote:
      "Prečnik je UNUTRAŠNJI prečnik kružne cevi — ništa ovde ne važi za nekružni kanal.",
    formula: "A = πD²/4     v = Q/A     Re = vD/ν     ṁ = ρQ",
    inputs: "Uneseno",
    unitMm: "mm",
    unitMm2: "mm²",
    unitM2: "m²",
    unitMs: "m/s",
    unitLs: "l/s",
    unitLmin: "l/min",
    unitM3h: "m³/h",
    unitM3s: "m³/s",
    unitKgS: "kg/s",
    unitKgH: "kg/h",
  },

  "power-factor-correction": {
    activePower: "Aktivna snaga P",
    presentPowerFactor: "Postojeći faktor snage cos φ₁",
    targetPowerFactor: "Ciljani faktor snage cos φ₂",
    lineVoltage: "Linijski napon U",
    frequency: "Frekvencija mreže f",
    system: "Sistem",
    connection: "Sprega baterije",
    connectionHint:
      "Baterija u zvezdi traži TRI PUTA veću kapacitivnost od baterije u trouglu za isti Qc.",
    connectionDelta: "trougao",
    connectionStar: "zvezda",
    errorPower: "Aktivna snaga mora biti veća od nule.",
    errorPresentPowerFactor: "Postojeći faktor snage mora biti između 0 i 1.",
    errorTargetPowerFactor:
      "Ciljani faktor snage mora biti između 0 i 1 i ne sme biti manji od postojećeg — to ne bi " +
      "bila kompenzacija.",
    errorVoltage: "Napon mora biti veći od nule.",
    errorFrequency: "Frekvencija mora biti veća od nule.",
    results: "Rezultat",
    reactiveBefore: "Reaktivna snaga pre kompenzacije Q₁",
    reactiveAfter: "Reaktivna snaga posle kompenzacije Q₂",
    correction: "Potrebna reaktivna snaga Qc",
    capacitance: "Kapacitivnost po fazi C",
    currentBefore: "Struja pre kompenzacije I₁",
    currentAfter: "Struja posle kompenzacije I₂",
    starDeltaNote:
      "Baterija u zvezdi traži tri puta veću kapacitivnost od baterije u trouglu za isti Qc.",
    harmonicsNote:
      "Ovo je proračun na osnovnom harmoniku, uz uravnoteženo opterećenje. Viši harmonici i " +
      "rezonansa sa mrežnim transformatorom nisu obuhvaćeni.",
    formula:
      "tan φ = √(1−cos²φ)/cos φ     Qc = P(tan φ₁−tan φ₂)     C = Qc/(3ωU²) trougao, Qc/(ωU²) " +
      "zvezda",
    inputs: "Uneseno",
    unitKvar: "kvar",
    unitUf: "µF",
    unitA: "A",
    unitKw: "kW",
    unitV: "V",
  },

  "pressure-and-piston-force": {
    value: "Vrednost",
    unit: "Jedinica",
    kind: "Vrsta",
    kindGauge: "nadpritisak",
    kindAbsolute: "apsolutni",
    atmospheric: "Atmosferski pritisak",
    atmosphericHint:
      "Prazno polje znači standardnu atmosferu (101325 Pa). Na nadmorskoj visini ili pri drugom " +
      "vremenu unesi očitanje barometra.",
    bore: "Prečnik cilindra",
    rod: "Prečnik klipnjače",
    rodHint:
      "Opciono. Prazno polje ili nula znači plunžer (cela površina klipa radi u oba smera osim " +
      "uvlačenja).",
    errorAtmospheric: "Atmosferski pritisak mora biti između 0 i 200000 Pa.",
    errorValue:
      "Uneta vrednost pritiska je van dozvoljenog opsega, ili bi apsolutni pritisak ispao " +
      "negativan.",
    errorBore: "Prečnik cilindra mora biti između 0 i 5000 mm.",
    errorRod: "Prečnik klipnjače mora biti nenegativan i manji od prečnika cilindra.",
    results: "Pritisak u svim jedinicama",
    forceResults: "Sila na klipu",
    gauge: "Nadpritisak",
    absolute: "Apsolutni",
    boreArea: "Površina klipa",
    annulusArea: "Površina prstena (strana klipnjače)",
    extendForce: "Sila pri izvlačenju",
    retractForce: "Sila pri uvlačenju",
    theoreticalForceNote:
      "Ovo je TEORIJSKA sila — proizvod pritiska i površine, bez trenja zaptivki i bez " +
      "protivpritiska na suprotnoj strani. Stvarna isporučena sila je nekoliko procenata manja.",
    formula: "p_apsolutno = p_nadpritisak + p_atm",
    forceFormula: "A = πD²/4     A' = π(D²−d²)/4     F = p_nadpritisak·A",
    inputs: "Uneseno",
    unitMm2: "mm²",
    unitN: "N",
    unitKn: "kN",
    unitMm: "mm",
  },

  "resistor-colour-code": {
    direction: "Smer",
    directionToValue: "boje → vrednost",
    directionToBands: "vrednost → boje",
    bandCount: "Broj prstenova",
    series: "E-niz",
    seriesHint: "Za red o najbližoj preferiranoj vrednosti.",
    band1: "1. prsten (cifra)",
    band2: "2. prsten (cifra)",
    band3digit: "3. prsten (cifra)",
    multiplierBand: "Prsten množioca",
    toleranceBand: "Prsten tolerancije",
    tempCoefficientBand: "6. prsten (temperaturni koeficijent)",
    tempCoefficientHint: "ppm/K — samo za šestopojasni otpornik.",
    colourBlack: "crna",
    colourBrown: "braon",
    colourRed: "crvena",
    colourOrange: "narandžasta",
    colourYellow: "žuta",
    colourGreen: "zelena",
    colourBlue: "plava",
    colourViolet: "ljubičasta",
    colourGrey: "siva",
    colourWhite: "bela",
    colourGold: "zlatna",
    colourSilver: "srebrna",
    errorBandCount: "Broj prstenova je 3, 4, 5 ili 6.",
    errorDigitBand: "Izabrana boja nema značenje kao cifra u ovoj poziciji.",
    errorMultiplierBand: "Izabrana boja nema značenje kao množilac.",
    errorToleranceBand: "Izabrana boja nema značenje kao tolerancija.",
    errorTempCoefficientBand: "Izabrana boja nema značenje kao temperaturni koeficijent.",
    errorValue: "Vrednost mora biti veća od nule.",
    errorMultiplierRange:
      "Vrednost se ne može zapisati ovim brojem prstenova — množilac pada van opsega 10⁻² … 10⁹.",
    errorPrecision:
      "Vrednost se ne može zapisati tačno ovim brojem prstenova bez prećutnog zaokruživanja na " +
      "drugu vrednost.",
    errorToleranceValue: "Uneta tolerancija ne odgovara nijednoj boji iz IEC 60062 tabele.",
    errorTempCoefficientValue:
      "Uneti temperaturni koeficijent ne odgovara nijednoj boji iz IEC 60062 tabele.",
    results: "Rezultat",
    value: "Vrednost",
    valueHint: "U omima, bez prefiksa (npr. 4700, ne 4,7k).",
    tolerance: "Tolerancija",
    toleranceInput: "Tolerancija",
    toleranceInputHint: "U procentima (npr. 5 za ±5 %). Obavezno od 4 prstena naviše.",
    unmarkedToleranceNote: "Tropojasni otpornik nema prsten tolerancije i po konvenciji je ±20 %.",
    range: "Opseg",
    tempCoefficient: "Temperaturni koeficijent",
    tempCoefficientInput: "Temperaturni koeficijent",
    preferred: "Najbliža vrednost izabranog niza",
    bands: "Prstenovi",
    formula: "vrednost = cifre · množilac",
    reverseFormula:
      "cifre i množilac iz vrednosti normalizovane na broj prstenova; boja iz IEC 60062 tabele",
    inputs: "Uneseno",
    unitOhm: "Ω",
    unitPpmK: "ppm/K",
  },

  "rlc-impedance": {
    frequency: "Frekvencija f",
    resistance: "Otpornost R",
    inductance: "Induktivnost L",
    inductanceHint:
      "U henrijima. Za milihenrije podeli sa 1000, za mikrohenrije sa 1 000 000. Prazno polje " +
      "znači da kalema nema.",
    capacitance: "Kapacitivnost C",
    capacitanceHint:
      "U faradima. Za mikrofarade podeli sa 1e6, za nanofarade sa 1e9, za pikofarade sa 1e12. " +
      "Prazno polje znači da kondenzatora nema.",
    connection: "Veza",
    connectionSeries: "redna",
    connectionParallel: "paralelna",
    errorFrequency: "Frekvencija mora biti veća od nule.",
    errorResistance: "Otpornost mora biti između 0 i 1e12 Ω.",
    errorInductance: "Induktivnost mora biti između 0 i 1e6 H.",
    errorCapacitance: "Kapacitivnost mora biti između 0 i 1 F.",
    results: "Rezultat",
    reactanceInductive: "Induktivna reaktansa X_L",
    reactanceCapacitive: "Kapacitivna reaktansa X_C",
    netReactance: "Ukupna reaktansa X",
    conductance: "Konduktansa G",
    susceptance: "Susceptansa B",
    impedance: "Impedansa |Z|",
    phase: "Fazni ugao φ",
    phaseSignNote:
      "Pozitivan ugao znači induktivno opterećenje — to je jedina oznaka karaktera u ovom " +
      "rezultatu.",
    resonance: "Rezonantna frekvencija f₀",
    qualityFactor: "Faktor dobrote Q",
    bandwidth: "Širina propusnog opsega",
    cornerRc: "Granična frekvencija RC grane",
    cornerRl: "Granična frekvencija RL grane",
    absentNote:
      "Prikazuju se samo veličine koje uneti elementi definišu — ništa se ne popunjava " +
      "pretpostavkom.",
    formulaSeries:
      "X = X_L−X_C     |Z| = √(R²+X²)     φ = atan2(X,R)     f₀ = 1/(2π√(LC))     Q = (1/R)√(L/C)",
    formulaParallel:
      "B = ωC−1/(ωL)     |Z| = 1/√(G²+B²)     φ = −atan2(B,G)     Q = R√(C/L)     ŠPO = f₀/Q = " +
      "1/(2πRC)",
    inputs: "Uneseno",
    unitOhm: "Ω",
    unitS: "S",
    unitDeg: "°",
    unitHz: "Hz",
    unitH: "H",
    unitF: "F",
    unitS2: "s",
  },

  "section-modulus": {
    shape: "Oblik",
    shapeRectangle: "pravougaonik",
    shapeCircle: "krug",
    shapeTube: "cev",
    shapeRectangularTube: "pravougaona cev",
    shapeISection: "I-profil",
    width: "Širina b",
    height: "Visina h",
    diameter: "Prečnik d",
    outerDiameter: "Spoljni prečnik D",
    innerDiameter: "Unutrašnji prečnik d",
    outerWidth: "Spoljna širina B",
    outerHeight: "Spoljna visina H",
    innerWidth: "Unutrašnja širina b",
    innerHeight: "Unutrašnja visina h",
    flangeWidth: "Širina pojasa b",
    depth: "Ukupna visina h",
    flangeThickness: "Debljina pojasa t_f",
    webThickness: "Debljina rebra t_r",
    iSectionNote:
      "Pretpostavljeni su pravi uglovi između pojasa i rebra, bez zaobljenja korena — valjani " +
      "profil ima nešto veću površinu i I od ovog računa.",
    allowableStress: "Dozvoljeni napon σ_dop",
    allowableStressHint:
      "Bira ga standard materijala i propis po kom se računa. Nexus ga ne predlaže.",
    bendingMoment: "Moment savijanja M",
    torsionMoment: "Moment torzije T",
    torsionHint:
      "Samo za krug i cev — kod ostalih oblika torziona konstanta nije 2I i ovaj račun je ne " +
      "daje.",
    errorDimensions: "Unete dimenzije nisu geometrijski moguće za izabrani oblik.",
    errorAllowableStress: "Dozvoljeni napon mora biti između 0 i 3000 MPa.",
    errorBendingMoment: "Moment savijanja mora biti u opsegu 0 do 1e9 N·m.",
    errorTorsionMoment: "Moment torzije mora biti u opsegu 0 do 1e9 N·m.",
    results: "Rezultat",
    area: "Površina A",
    momentOfInertiaX: "Moment inercije I_x",
    momentOfInertiaY: "Moment inercije I_y",
    sectionModulusX: "Otporni moment W_x",
    sectionModulusY: "Otporni moment W_y",
    radiusOfGyrationX: "Poluprečnik inercije i_x",
    radiusOfGyrationY: "Poluprečnik inercije i_y",
    polarMoment: "Polarni moment inercije I_p",
    polarModulus: "Polarni otporni moment W_p",
    noPolarNote:
      "Polarne veličine se prikazuju samo za krug i cev. Kod pravougaonika, pravougaone cevi i " +
      "I-profila torziona konstanta zavisi od oblika i I_p = 2I ovde ne važi, pa se taj red ne " +
      "prikazuje.",
    allowableMoment: "Moment pri dozvoljenom naponu M_dop",
    bendingStress: "Napon savijanja σ",
    stressRatio: "Napon ÷ tvoja granica",
    torsionalStress: "Napon torzije τ",
    modelNote:
      "Model ne obuhvata izvijanje, bočno-torziono izvijanje, lokalnu stabilnost ni zamor.",
    formulaRectangle: "A = bh     I_x = bh³/12     I_y = hb³/12     W_x = bh²/6     W_y = hb²/6",
    formulaCircle:
      "A = πd²/4     I_x = I_y = πd⁴/64     W_x = W_y = πd³/32     I_p = 2I     W_p = 2W",
    formulaTube: "A = π(D²−d²)/4     I = π(D⁴−d⁴)/64     W = 2I/D     I_p = 2I     W_p = 2W",
    formulaRectangularTube:
      "A = BH−bh     I_x = (BH³−bh³)/12     W_x = 2I_x/H     I_y = (HB³−hb³)/12     W_y = 2I_y/B",
    formulaISection:
      "A = 2bt_f+(h−2t_f)t_r     I_x = [bh³−(b−t_r)(h−2t_f)³]/12     W_x = 2I_x/h     I_y = " +
      "[2t_fb³+(h−2t_f)t_r³]/12     W_y = 2I_y/b",
    inputs: "Uneseno",
    unitMm: "mm",
    unitMm2: "mm²",
    unitMm3: "mm³",
    unitMm4: "mm⁴",
    unitNm: "N·m",
    unitMpa: "MPa",
  },

  "series-parallel-network": {
    regime: "Režim",
    regimeNetwork: "mreža elemenata",
    regimeDivider: "naponski delilac",
    element: "Tip elementa",
    elementResistor: "otpornik",
    elementInductor: "kalem",
    elementCapacitor: "kondenzator",
    connection: "Veza",
    connectionSeries: "redna",
    connectionParallel: "paralelna",
    values: "Vrednosti",
    valuesHint:
      "Jedna vrednost po redu, u Ω, H ili F bez prefiksa (npr. 470, ne 470k). Od 1 do 32 unosa.",
    errorValues: "Svaka vrednost mora biti nenegativna, i mora postojati bar jedna.",
    errorTooMany: "Najviše 32 vrednosti.",
    errorInputVoltage: "Ulazni napon mora biti u opsegu 0 do 1e6 V.",
    errorUpper: "Gornji otpornik ne sme biti negativan.",
    errorLower: "Donji otpornik ne sme biti negativan.",
    errorTotal: "Zbir R1 i R2 ne sme biti nula.",
    results: "Rezultat",
    equivalent: "Ekvivalentna vrednost",
    zeroNote:
      "Nula u paralelnoj grupi otpornika ili kalemova kratko spaja mrežu (rezultat je tačno 0). " +
      "Nula u rednom nizu kondenzatora blokira mrežu (rezultat je tačno 0). Van tih slučajeva " +
      "nula prosto ne doprinosi ničim.",
    formula:
      "redno: zbir     paralelno: recipročni zbir recipročnih vrednosti     (kondenzatori " +
      "obrnuto)",
    inputs: "Uneseno",
    inputVoltage: "Ulazni napon U_ul",
    upper: "Gornji otpornik R1",
    lower: "Donji otpornik R2",
    outputVoltage: "Izlazni napon U_izl",
    unloadedNote:
      "Ovo je NEOPTEREĆEN napon — čim nešto povuče struju sa izlaza, ova vrednost više ne važi.",
    current: "Struja kroz delilac",
    upperPower: "Snaga na R1",
    lowerPower: "Snaga na R2",
    totalPower: "Ukupna snaga",
    theveninResistance: "Tevenenov otpor delioca R1‖R2",
    dividerFormula:
      "U_izl = U_ul·R2/(R1+R2)     I = U_ul/(R1+R2)     P_i = I²·R_i     R_th = R1·R2/(R1+R2)",
    unitV: "V",
    unitA: "A",
    unitW: "W",
    unitOhm: "Ω",
  },

  "three-phase-power": {
    system: "Sistem",
    voltageSingle: "Napon napajanja U",
    voltageThree: "Linijski napon U",
    known: "Poznata veličina",
    knownCurrent: "struja I",
    knownActivePower: "aktivna snaga P",
    knownApparentPower: "prividna snaga S",
    powerFactor: "Faktor snage cos φ",
    connection: "Sprega potrošača",
    connectionHint:
      "Utiče samo na fazni napon i faznu struju — linijske vrednosti su iste u oba slučaja.",
    connectionStar: "zvezda",
    connectionDelta: "trougao",
    errorVoltage: "Napon mora biti veći od nule.",
    errorPowerFactor: "Faktor snage mora biti između 0 i 1.",
    errorCurrent: "Struja mora biti u opsegu 0 do 1e6 A.",
    errorActivePower: "Aktivna snaga mora biti u opsegu 0 do 1e6 kW.",
    errorApparentPower: "Prividna snaga mora biti u opsegu 0 do 1e6 kVA.",
    errorKnown: "Unesi tačno jednu od tri veličine — struju, aktivnu ili prividnu snagu.",
    results: "Rezultat",
    apparent: "Prividna snaga S",
    active: "Aktivna snaga P",
    reactive: "Reaktivna snaga Q",
    current: "Linijska struja I",
    phase: "Fazni ugao φ",
    tanPhi: "tan φ",
    phaseVoltage: "Fazni napon U_f",
    phaseCurrent: "Fazna struja I_f",
    inductiveNote:
      "sin φ je uzet nenegativno — pretpostavlja se induktivno (zaostalo) opterećenje.",
    balancedNote: "Pretpostavlja se uravnotežena simetrična mreža i sinusni oblik napona i struje.",
    formula: "S = f₃·U·I     P = S·cos φ     Q = S·sin φ     U_f zvezda = U/√3, trougao = U",
    inputs: "Uneseno",
    unitKva: "kVA",
    unitKw: "kW",
    unitKvar: "kvar",
    unitA: "A",
    unitDeg: "°",
    unitV: "V",
  },

  "torque-speed-power": {
    torque: "Obrtni moment M",
    speed: "Broj obrtaja n",
    speedOmegaHint: "n i ω su ISTA veličina u dve jedinice — popuni samo jedno od njih, ne oba.",
    angularVelocity: "Ugaona brzina ω",
    power: "Snaga P",
    pairHint: "Unesi tačno dve od tri veličine (moment, brzina, snaga) — treća se računa.",
    errorSpeed:
      "Popuni ili broj obrtaja ili ugaonu brzinu, ne oba, i vrednost mora biti veća od nule.",
    errorTorque: "Moment mora biti u opsegu 0 do 1e9 N·m.",
    errorPower: "Snaga mora biti u opsegu 0 do 1e9 W.",
    errorPair: "Unesi tačno dve od tri veličine — moment, brzinu (n ili ω) i snagu.",
    results: "Rezultat",
    hpNote:
      "KS je metrička konjska snaga (735,49875 W), hp je mehanička/imperijalna konjska snaga " +
      "(745,69987 W).",
    formula: "P = M·ω     ω = 2πn/60     M = 30000·P[kW]/(πn)",
    inputs: "Uneseno",
    computed: "izračunato",
    unitNm: "N·m",
    unitKgfM: "kgf·m",
    unitLbfFt: "lbf·ft",
    unitRpm: "min⁻¹",
    unitRadS: "rad/s",
    unitW: "W",
    unitKw: "kW",
    unitKs: "KS",
    unitHp: "hp",
  },
} as const;
