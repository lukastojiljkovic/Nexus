/**
 * „Event i produkcija" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment spells the
 * registration. The tool's NAME and its one-line blurb are not here: those live
 * in a different table that another process owns.
 *
 * **A unit is copy, not a constant.** „m" and „kg" are written here rather than
 * concatenated in the surface, so a translation moves this table only.
 *
 * **Nothing in here judges.** `generator-sizing`, `led-wall-pitch-viewing`,
 * `rigging-sling-angle-force`, `stage-deck-layout`, `three-phase-load-balance`,
 * `truss-hoist-reactions`, `voltage-drop` and `venue-occupancy-area` are
 * `life-safety`; `ice-and-chilling` is `food-safety`. Their copy may name a
 * quantity and may name the user's own limit, and may never say what the two
 * mean together. Where a limit appears it is always „koju si uneo/uneta" —
 * whose it is, said in the label.
 */
export const PRO_EVENT_SR = {
  "beam-spot-diameter": {
    beamAngle: "Ugao snopa (beam, 50 % jačine)",
    beamAngleHint: "Sa kataloga reflektora.",
    fieldAngle: "Ugao polja (field, 10 % jačine)",
    fieldAngleHint:
      "Opciono, sa kataloga. Ne prikazuje se pri kosom upadu — vidi napomenu uz elipsu.",
    mode: "Način zadavanja rastojanja",
    modeNormal: "Upravno rastojanje D",
    modeOblique: "Visina vešanja h i horizontalno odstojanje mete",
    distance: "Upravno rastojanje D",
    height: "Visina vešanja h",
    offset: "Horizontalno odstojanje mete x",
    offsetHint: "Prazno polje znači metu tačno ispod reflektora.",
    intensity: "Jačina svetlosti I",
    intensityHint: "Opciono, iz kataloga (cd). Bez nje se osvetljenost ne prikazuje.",
    overlap: "Preklapanje susednih snopova",
    coverage: "Dužina koja se pokriva",

    results: "Rezultat",
    beamDiameter: "Prečnik snopa (upravno)",
    fieldDiameter: "Prečnik polja (upravno)",
    slantDistance: "Rastojanje do mete",
    minorAxis: "Mala osa elipse (tačan oblik)",
    majorAxis: "Velika osa elipse",
    tilt: "Nagib γ od normale",
    nearEdge: "Bliži rub mrlje (od tačke ispod reflektora)",
    farEdge: "Dalji rub mrlje (od tačke ispod reflektora)",
    illuminance: "Osvetljenost u tački gađanja",
    spacing: "Razmak susednih reflektora",
    fixtureCount: "Potreban broj reflektora",
    coveredLength: "Stvarno pokrivena dužina",
    axisNote:
      "Razmak i broj važe samo duž ose niza — dva susedna kružna snopa preklapaju se u " +
      "sočivastom preseku, pa je pokrivenost izvan te ose manja.",

    inputs: "Uneseno",
    formula:
      "upravno: d=2D·tan(θ/2)     kosi upad: β=atan(x/h), Ds=√(h²+x²), " +
      "b=2h·sin(θ/2)/√(cos(β−θ/2)cos(β+θ/2)), a=h(tan(β+θ/2)−tan(β−θ/2))     E=I·cosβ/Ds²     " +
      "s=d_eff(1−preklapanje/100), n=max(1, ceil((L−d_eff)/s)+1)",

    errorBeamAngle: "Ugao snopa je broj od 1° do 120°.",
    errorFieldAngle: "Ugao polja je broj od 1° do 160°, i ne prikazuje se uz kosi upad.",
    errorAmbiguousDistance:
      "Uneto je i upravno rastojanje i visina vešanja — izaberi jedan način, inače nije jasno " +
      "koje rastojanje koristi osvetljenost.",
    errorDistance: "Upravno rastojanje je broj od 0,5 do 200 m.",
    errorHeight: "Visina vešanja je broj od 0,5 do 60 m.",
    errorOffset: "Horizontalno odstojanje je broj od 0 do 100 m.",
    errorIntensity: "Jačina svetlosti je broj od 100 do 10 000 000 cd.",
    errorOverlap: "Preklapanje je broj od 0 do 90 %, i ide zajedno sa dužinom pokrivanja.",
    errorCoverage: "Dužina pokrivanja je broj od 0,5 do 200 m, i ide zajedno sa preklapanjem.",
    errorGrazing: "Pri ovom nagibu snop pada paralelno površini i nikad je ne dotiče.",

    unitM: "m",
    unitDeg: "°",
    unitLx: "lx",
  },

  "budget-per-guest": {
    guests: "Broj gostiju",
    tables: "Broj stolova",
    tablesHint: "Prazno polje se čita kao 0 — nema stavki po stolu.",
    lines: "Troškovi",
    linesHint:
      "Jedan red po stavci: naziv;tip;iznos;osnovica;oporezivo. Tip je fiksno, gost, sto ili " +
      "procenat. Osnovica važi samo za procenat — brojevi redova (od 1) razdvojeni zapetom na " +
      "koje se procenat primenjuje; prazno znači svi neprocentualni redovi. Oporezivo je da ili " +
      "ne, koristi se samo uz osnovicu poreza „samo označene stavke\".",
    reserve: "Rezerva",
    taxRate: "Poreska stopa",
    taxRateHint:
      "Korisnikov unos — Nexus ne drži nijednu poresku stopu i ne zna koja se primenjuje.",
    taxBaseMode: "Osnovica za porez",
    taxBaseModeHint:
      "Rezerva nikad ne ulazi u osnovicu „samo označene stavke\" — markup je na ceo budžet.",
    taxBaseModeTotal: "Ceo iznos",
    taxBaseModeMarked: "Samo označene stavke",
    revenueLines: "Prihodi",
    revenueLinesHint: "Jedan red po stavci: naziv;iznos. Opciono — sponzor, donacija i slično.",
    payingGuests: "Broj plativih gostiju",
    ticketPrice: "Cena karte",

    results: "Rezultat",
    colName: "Stavka",
    colType: "Tip",
    colAmount: "Iznos",
    colShare: "Udeo",
    colPercentBase: "Osnovica procenta",
    typeFixed: "Fiksno",
    typePerGuest: "Po gostu",
    typePerTable: "Po stolu",
    typePercent: "Procenat osnovice",
    base: "Osnovica (fiksno + po gostu + po stolu)",
    percentSum: "Zbir procentualnih stavki",
    subtotal: "Međuzbir",
    reserveAmount: "Rezerva",
    preTaxTotal: "Ukupno bez poreza",
    taxBaseAmount: "Osnovica na koju je stopa primenjena",
    tax: "Porez",
    grandTotal: "Ukupno sa porezom",
    costPerGuestWithTax: "Trošak po gostu, sa porezom",
    costPerGuestWithoutTax: "Trošak po gostu, bez poreza",
    costPerTableWithTax: "Trošak po stolu, sa porezom",
    costPerTableWithoutTax: "Trošak po stolu, bez poreza",
    revenueTotal: "Zbir prihoda",
    revenueDifference: "Razlika prihod − trošak",
    breakEvenTicketPrice: "Cena karte pri kojoj je razlika nula",
    ticketRevenue: "Prihod od karata",

    inputs: "Uneseno",
    formula:
      "osnovica=Σ(fiksno+gost·G+sto·T)     procenat_i=(%ᵢ/100)·osnovica_i     " +
      "međuzbir=osnovica+Σprocenat     rezerva=međuzbir·r/100     porez=osnovica_poreza·t/100    " +
      " ukupno=međuzbir+rezerva+porez     " +
      "cena_karte_na_nuli=ceil_na_cent((ukupno−ostali_prihodi)/plativih)",

    errorGuests: "Broj gostiju je ceo broj od 1 do 100 000.",
    errorTables: "Broj stolova je ceo broj od 0 do 10 000.",
    errorLines: "Potreban je bar jedan red troškova.",
    errorLineType: "Svaki red mora imati tip fiksno, gost, sto ili procenat.",
    errorLineAmount: "Iznos ili procenat u redu mora biti broj, nula ili veći.",
    errorPercentOfLines:
      "Osnovica procentualnog reda mora upućivati na postojeće neprocentualne redove.",
    errorReserve: "Rezerva je broj od 0 do 50 %.",
    errorTaxRate: "Poreska stopa je broj od 0 do 100 %.",

    rowLabel: "red",
  },

  "catering-per-guest": {
    guests: "Broj gostiju",
    lines: "Stavke",
    linesHint:
      "Jedan red po stavci: naziv;jedinica;količina po gostu;udeo koji uzima (%);rezerva " +
      "(%);veličina pakovanja;jedinica pakovanja;cena pakovanja;porcija za točenje (ml). " +
      "Jedinica je g, ml ili kom. Jedinica pakovanja je g, kg, ml, l ili kom — kg/l se čita kao " +
      "×1000. Cena i porcija su opcione.",
    packRounding: "Zaokruživanje pakovanja",
    packRoundingUp: "Naviše",
    packRoundingExact: "Tačno",

    results: "Rezultat",
    colName: "Stavka",
    colGross: "Bruto količina",
    colGrossBig: "Bruto (kg/l)",
    colPacks: "Pakovanja",
    colSurplus: "Višak",
    colPoursNeed: "Porcije iz potrebe",
    colPoursPurchased: "Porcije iz kupljenog",
    colCost: "Cena stavke",
    colCostPerGuest: "Cena po gostu",
    colCostPerTaking: "Cena po gostu koji uzima",
    colActualReserve: "Stvarna rezerva (posle zaokruživanja)",
    packs: "pakovanja:",
    surplus: "višak:",
    totalCost: "Zbir cena svih stavki",
    totalCostPerGuest: "Zbir po gostu",

    inputs: "Uneseno",
    formula:
      "neto=G·q·(udeo/100)     bruto=neto·(1+rezerva/100)     " +
      "pakovanja=ceil(bruto/veličina_pakovanja) (naviše) ili bruto/veličina_pakovanja (tačno)    " +
      " višak=pakovanja·veličina−bruto     porcije_potreba=floor(bruto/porcija)     " +
      "porcije_kupljeno=floor(pakovanja·veličina/porcija)",

    errorGuests: "Broj gostiju je ceo broj od 1 do 5000.",
    errorLines: "Potreban je bar jedan red stavki.",
    errorUnitToken:
      "Jedinica stavke mora biti g, ml ili kom, a jedinica pakovanja g, kg, ml, l ili kom, iste " +
      "dimenzije kao stavka.",
    errorQuantity: "Količina po gostu mora biti veća od nule.",
    errorUptake: "Udeo koji uzima je broj od 0 do 100 %.",
    errorReserve: "Rezerva je broj od 0 do 100 %.",
    errorPackSize: "Veličina pakovanja mora biti veća od nule.",
    errorPackUnit:
      "Jedinica pakovanja mora biti iste dimenzije (masa/zapremina/komad) kao jedinica stavke.",
    errorPourSize: "Porcija za točenje mora biti veća od nule, i važi samo za tečne stavke.",
    errorPrice: "Cena pakovanja ne sme biti negativna.",

    rowLabel: "red",
  },

  "generator-sizing": {
    consumers: "Potrošači",
    consumersHint:
      "Jedan red po potrošaču: naziv;snaga u kW;cos φ;istovremenost (%, prazno = 100);motor " +
      "(da/ne);startna kVA po kW (samo za motor, sa pločice);cos φ u polasku (samo za motor). " +
      "Negativan cos φ znači prednjačeći (kapacitivni) teret — LED napajanja, filteri.",
    reserve: "Rezerva",
    derate: "Smanjenje snage",
    derateHint: "Nadmorska visina i temperatura, iz tabele proizvođača agregata.",
    ratedPowerFactor: "Nazivni faktor snage agregata",
    ratedPowerFactorHint: "Sa natpisne pločice konkretnog agregata. Nema podrazumevanu vrednost.",
    ratedPowerKw: "Nazivna snaga agregata",
    ratedPowerKwHint: "Opciono — za procenat opterećenja i potrošnju u l/h.",
    fuelRate: "Specifična potrošnja goriva",
    fuelRateHint: "Iz kataloga agregata, po redu opterećenja. Opciono.",
    hours: "Trajanje rada",

    results: "Rezultat",
    runningActive: "Radna aktivna snaga",
    runningReactive: "Radna reaktivna snaga",
    runningApparent: "Radna prividna snaga",
    runningPowerFactor: "Rezultujući faktor snage",
    peakActive: "Aktivna snaga u vrhu polaska",
    peakReactive: "Reaktivna snaga u vrhu polaska",
    peakApparent: "Prividna snaga u vrhu polaska",
    designApparent: "Potrebna prividna snaga (posle rezerve i smanjenja)",
    designActive: "Odgovarajuća aktivna snaga",
    fuelPerHour: "Potrošnja goriva",
    fuelTotal: "Ukupna potrošnja za uneto trajanje",
    loadPct: "Procenat opterećenja agregata",
    fuelNote:
      "Model potrošnje je linearan po isporučenoj aktivnoj snazi i ne sadrži potrošnju u praznom " +
      "hodu.",

    inputs: "Uneseno",
    formula:
      "P=ΣkW·ist/100     Q=ΣP·tanφ (sa predznakom)     S=√(P²+Q²)     polazak: " +
      "S_start=kW_motor·kVA/kW     " +
      "S_vrh=√((P−P_motor+S_start·cosφ_p)²+(Q−Q_motor+S_start·sinφ_p)²)     " +
      "S_potrebno=max(S,S_vrh)·(1+rezerva/100)/(1−smanjenje/100)     " +
      "P_potrebno=S_potrebno·cosφ_agregata",

    errorConsumers: "Potreban je bar jedan red potrošača.",
    errorReserve: "Rezerva je broj od 0 do 100 %.",
    errorDerate: "Smanjenje snage je broj od 0 do 50 %.",
    errorRatedPowerFactor: "Nazivni faktor snage agregata je broj od 0,5 do 1,0.",
    errorRatedPowerKw: "Nazivna snaga agregata mora biti veća od nule.",
    errorFuelRate: "Specifična potrošnja goriva mora biti veća od nule.",
    errorHours: "Trajanje rada mora biti veće od nule.",
    errorKw: "Snaga potrošača mora biti veća od nule.",
    errorCosPhi: "Cos φ je broj čija je apsolutna vrednost od 0,1 do 1,0.",
    errorSimultaneity: "Istovremenost je broj od 0 do 100 %.",
    errorStartingKva: "Startna kVA po kW je broj od 1,0 do 10,0, obavezan za motor.",
    errorStartingCosPhi:
      "Cos φ u polasku je broj čija je apsolutna vrednost od 0,1 do 1,0, obavezan za motor.",

    unitKw: "kW",
    unitKvar: "kvar",
    unitKva: "kVA",
    unitLh: "l/h",
    unitL: "l",

    rowLabel: "red",
  },

  "ice-and-chilling": {
    quantityMode: "Kako je uneta količina pića",
    quantityModeMass: "Masa",
    quantityModeVolume: "Zapremina",
    drinkMass: "Masa pića",
    drinkVolume: "Zapremina pića",
    drinkDensity: "Gustina pića",
    drinkSpecificHeat: "Specifična toplota pića",
    drinkSpecificHeatHint: "Prazno polje koristi vrednost za vodenasta pića, 4,184 kJ/(kg·K).",
    packagingMass: "Masa ambalaže",
    packagingMassHint: "Staklo i limenke koje se hlade zajedno sa sadržajem. Prazno polje je 0.",
    packagingSpecificHeat: "Specifična toplota ambalaže",
    packagingSpecificHeatHint:
      "Prazno polje koristi vrednost za staklo, 0,84 kJ/(kg·K); za aluminijum 0,897.",
    startTemp: "Početna temperatura pića T1",
    targetTemp: "Ciljna temperatura T2",
    targetTempHint:
      "Ciljnu temperaturu bira korisnik — alatka ne kaže da li je nešto dovoljno rashlađeno.",
    iceTemp: "Temperatura leda Ti",
    iceTempHint: "Prazno polje je 0 °C. Za led iz zamrzivača unesi negativnu vrednost.",
    holdMode: "Dotok toplote pri držanju",
    holdModeNone: "Bez računa držanja",
    holdModeWatt: "Dotok u vatima",
    holdModeUa: "UA i temperatura okoline",
    ambientWatt: "Dotok toplote iz okoline",
    holdUa: "UA koeficijent kade",
    holdUaHint: "W/K, sa merenja ili deklaracije kade.",
    ambientTemp: "Temperatura okoline",
    holdHours: "Vreme držanja",
    bagMass: "Masa jednog pakovanja leda",
    bagMassHint: "Prazno polje je 5 kg.",
    bulkFraction: "Nasipni koeficijent leda",
    bulkFractionHint:
      "Udeo čvrstog leda u zapremini nasute kade, 0 do 1 — kocke i ljuspice nose 35 do 45 % " +
      "šupljina. Opciono; bez njega se prikazuje samo zapremina čvrstog leda.",
    meltsIntoDrink: "Led se topi direktno u piću",
    meltsIntoDrinkHint: "Uključi za bowlu i punč; isključi za hlađenje zatvorene ambalaže u kadi.",
    yes: "Da",
    no: "Ne",

    results: "Rezultat",
    heatToRemove: "Odvedena toplota",
    noCoolingNeededNote:
      "Ciljna temperatura je već dostignuta ili viša od početne — nema šta da se odvede, " +
      "pa su nule iznad tačan odgovor, a ne rezultat proračuna koji je pao na nulu.",
    icePulldown: "Masa leda za hlađenje (idealna donja granica)",
    iceHoldingMelt: "Dodatno istopljen led pri držanju (gornja granica)",
    totalIce: "Zbirna masa leda",
    solidVolume: "Zapremina čvrstog leda",
    bulkVolume: "Nasipna zapremina (kada/posuda)",
    bags: "Broj pakovanja",
    meltwaterMass: "Masa otopljene vode od hlađenja",
    dilution: "Razblaženje pića istopljenim ledom",
    iceToDrinkRatio: "Odnos kg leda po kg pića",
    boundsNote:
      "Masa za hlađenje je idealna donja granica pri potpunom topljenju sveg leda; dodatno " +
      "topljenje pri držanju računa samo latentnu toplotu i zato je gornja granica. Ovo je jedan " +
      "korak do ravnotežnog stanja, ne kriva hlađenja — nema vremensku osu i ne govori koliko " +
      "brzo piće dostiže temperaturu.",

    inputs: "Uneseno",
    formula:
      "Q=(m·c+m_amb·c_amb)·(T1−T2)     h=c_led·(0−Ti)+333,55+4,184·max(T2,0)     m_led=Q/h     " +
      "m_topi=Q̇·t·3600/1000/333,55     V_čvrsto=m_uk/917·1000",

    errorDrinkMass: "Masa pića mora biti veća od nule.",
    errorDrinkVolume: "Zapremina pića mora biti veća od nule.",
    errorDrinkDensity: "Gustina pića mora biti veća od nule.",
    errorDrinkSpecificHeat: "Specifična toplota pića je broj od 1,0 do 5,0 kJ/(kg·K).",
    errorPackagingMass: "Masa ambalaže ne sme biti negativna.",
    errorPackagingSpecificHeat: "Specifična toplota ambalaže je broj od 0,4 do 1,2 kJ/(kg·K).",
    errorStartTemp: "Početna temperatura je broj od −10 do 60 °C.",
    errorTargetTemp: "Ciljna temperatura je broj od 0 do 40 °C.",
    errorIceTemp: "Temperatura leda je broj od −30 do 0 °C.",
    errorBagMass: "Masa jednog pakovanja je broj od 0,5 do 25 kg.",
    errorBulkFraction: "Nasipni koeficijent je broj od 0,1 do 1.",
    errorAmbiguousHold: "Izaberi samo jedan način zadavanja dotoka toplote pri držanju.",
    errorHoldHours: "Vreme držanja mora biti veće od nule.",
    errorAmbientWatt: "Dotok toplote mora biti veći od nule.",
    errorHoldUa: "UA koeficijent mora biti veći od nule, uz realnu temperaturu okoline.",

    unitKj: "kJ",
    unitKg: "kg",
    unitL: "l",
    unitC: "°C",
  },

  "led-wall-pitch-viewing": {
    pitch: "Korak piksela",
    pitchHint: "Oznaka panela, npr. P2,5 znači 2,5 mm.",
    panelWidth: "Širina panela",
    panelDimHint: "Prazno polje je 500 mm.",
    panelHeight: "Visina panela",
    sizeMode: "Kako je zadata veličina zida",
    sizeModePanels: "Broj panela u širinu i visinu",
    sizeModeTarget: "Ciljna širina i visina zida",
    panelsWide: "Broj panela u širinu",
    panelsHigh: "Broj panela u visinu",
    targetWidth: "Ciljna širina zida",
    targetHeight: "Ciljna visina zida",
    acuity: "Ugao vidne oštrine",
    acuityHint: "Katalog ili referenca oštrine — obavezan unos, alatka ga ne nudi.",
    portCapacity: "Kapacitet porta procesora",
    portCapacityHint: "Piksela po portu, iz kataloga procesora. Opciono.",
    panelMaxW: "Maksimalna snaga panela",
    panelPowerHint: "Iz kataloga panela. Opciono — bez ovoga se snaga i struja ne prikazuju.",
    panelAvgW: "Prosečna snaga panela",
    voltage: "Napon napajanja",
    voltageHint: "Prazno polje je 230 V.",
    powerFactor: "Faktor snage napajanja",
    powerFactorHint: "Iz kataloga panela. Bez njega se struja ne prikazuje.",

    results: "Rezultat",
    panelResolution: "Rezolucija jednog panela",
    wallResolution: "Ukupna rezolucija zida",
    wallSize: "Fizička veličina zida",
    aspect: "Odnos stranica",
    pixelDensity: "Gustina piksela",
    viewingAtAcuity: "Daljina pri unetom uglu oštrine",
    viewingAt1: "Daljina za 1′",
    viewingAt2: "Daljina za 2′",
    ports: "Potreban broj portova procesora",
    powerMax: "Maksimalna snaga zida",
    powerAvg: "Prosečna snaga zida",
    apparentMax: "Maksimalna prividna snaga zida",
    apparentAvg: "Prosečna prividna snaga zida",
    currentMax: "Struja pri maksimalnoj snazi",
    currentAvg: "Struja pri prosečnoj snazi",
    inrushNote:
      "Struja i prividna snaga su ustaljeno (steady-state) opterećenje — udarna struja pri " +
      "uključenju zida nije modelirana.",

    inputs: "Uneseno",
    formula:
      "px=panel/korak     zid=broj_panela·panel/1000     d(θ)=korak/(θ·0,0002908882)/1000     " +
      "paneli_po_portu=floor(kapacitet/px_panela), portovi=ceil(broj_panela/paneli_po_portu)     " +
      "S=P/PF     I=P·1000/(U·PF)",

    errorPitch:
      "Korak piksela mora biti veći od nule, i mora deliti dimenzije panela na ceo broj piksela.",
    errorPanelWidth: "Širina panela je broj od 100 do 2000 mm.",
    errorPanelHeight: "Visina panela je broj od 100 do 2000 mm.",
    errorAcuity: "Ugao vidne oštrine je broj od 0,5 do 10 lučnih minuta.",
    errorPanelsWide:
      "Broj panela u širinu je ceo broj od 1 do 200 — unesi ili ovo, ili ciljnu veličinu, nikad " +
      "oboje.",
    errorPanelsHigh: "Broj panela u visinu je ceo broj od 1 do 100.",
    errorTargetWidth:
      "Ciljna širina zida mora biti veća od nule i dati broj panela u dozvoljenom opsegu.",
    errorTargetHeight:
      "Ciljna visina zida mora biti veća od nule i dati broj panela u dozvoljenom opsegu.",
    errorPortCapacity:
      "Kapacitet porta je broj od 10 000 do 2 000 000 piksela, dovoljan za bar jedan panel.",
    errorPanelMaxW: "Maksimalna snaga panela je broj od 10 do 2000 W.",
    errorPanelAvgW: "Prosečna snaga panela je broj od 5 do 2000 W.",
    errorVoltage: "Napon je broj od 100 do 400 V.",
    errorPowerFactor: "Faktor snage je broj od 0,5 do 1,0.",

    unitM: "m",
    unitMm: "mm",
    unitPxM: "px/m",
    unitKw: "kW",
    unitKva: "kVA",
    unitA: "A",
  },

  "parking-cloakroom": {
    guests: "Broj gostiju",
    carShare: "Udeo koji dolazi automobilom",
    occupancyPerCar: "Prosečno osoba po automobilu",
    busShare: "Udeo koji dolazi autobusom",
    seatsPerBus: "Mesta u autobusu",
    areaPerStall: "Površina po parking mestu",
    areaPerStallHint: "Sa manevarskim prostorom, iz propisa ili uslova objekta. Korisnikov unos.",
    availableStalls: "Raspoloživa parking mesta",
    coatShare: "Udeo gostiju sa garderobom",
    itemsPerGuest: "Komada po gostu",
    hangerPitch: "Razmak vešalica",
    railSegments: "Raspoložive šipke",
    railSegmentsHint:
      "Jedan red po fizičkoj šipki, dužina u m. Kapacitet se računa po šipki i sabira, ne po " +
      "zbirnoj dužini.",
    checkInWindow: "Prozor prijema",
    checkInRate: "Brzina usluge po radniku",
    rateHint: "Komada po minuti, po radniku — jedinica rada je komad, ne gost.",
    checkInAttendants: "Uneti broj radnika za prijem",
    hasCheckOut: "Poseban prozor za izdavanje na kraju",
    checkOutWindow: "Prozor izdavanja",
    checkOutRate: "Brzina izdavanja po radniku",
    checkOutAttendants: "Uneti broj radnika za izdavanje",
    yes: "Da",
    no: "Ne",

    results: "Rezultat",
    carGuests: "Gostiju koji dolaze automobilom",
    cars: "Broj automobila",
    parkingArea: "Potrebna površina parkinga",
    stallRatio: "Automobili ÷ raspoloživa mesta",
    buses: "Broj autobusa",
    busGuests: "gostiju:",
    coatGuests: "Gostiju sa garderobom",
    items: "Broj komada",
    railLengthNeeded: "Potrebna dužina šipki",
    railCapacity: "Kapacitet raspoloživih šipki",
    railRatio: "Potrebno ÷ kapacitet",
    pieces: "komada",
    checkInSection: "Prijem",
    checkInAttendantsNeeded: "Potreban broj radnika za prozor",
    checkInClearTime: "Vreme obrade sa unetim brojem radnika",
    checkInClearDiff: "Razlika prema prozoru",
    checkOutSection: "Izdavanje",
    checkOutAttendantsNeeded: "Potreban broj radnika za prozor",
    checkOutClearTime: "Vreme obrade sa unetim brojem radnika",
    checkOutClearDiff: "Razlika prema prozoru",
    throughputNote:
      "Protok pretpostavlja da dolasci ravnomerno pokrivaju ceo prozor — nagli navala u jednom " +
      "trenutku nije njime obuhvaćena.",

    inputs: "Uneseno",
    formula:
      "G_kolima=round(G·udeo/100)     automobila=ceil(G_kolima/popunjenost)     " +
      "komada=ceil(G_garderoba·kom/gostu)     dužina=komada·razmak     " +
      "radnika=ceil(komada/(prozor·brzina))     t=komada/(radnika·brzina)",

    errorGuests: "Broj gostiju je ceo broj od 1 do 100 000.",
    errorCarShare: "Udeo koji dolazi automobilom je broj od 0 do 100 %.",
    errorOccupancy: "Prosečno osoba po automobilu je broj od 1,0 do 8,0.",
    errorBusShare: "Udeo koji dolazi autobusom je broj od 0 do 100 %.",
    errorShareSum: "Zbir udela automobilom i autobusom ne sme preći 100 %.",
    errorAreaPerStall: "Površina po parking mestu je broj od 5 do 100 m².",
    errorCoatShare: "Udeo gostiju sa garderobom je broj od 0 do 100 %.",
    errorItemsPerGuest: "Komada po gostu je broj od 0,5 do 4,0.",
    errorHangerPitch: "Razmak vešalica je broj od 0,03 do 0,15 m.",
    errorSeatsPerBus: "Mesta u autobusu je broj od 10 do 100, obavezan uz udeo autobusom.",
    errorAvailableStalls: "Raspoloživa parking mesta ne smeju biti negativna.",
    errorRailSegments: "Svaka šipka mora biti dužine nula ili veće.",
    errorWindow: "Prozor mora biti veći od nule.",
    errorRate: "Brzina usluge mora biti veća od nule.",
    errorAttendants: "Broj radnika je ceo broj od 1 do 100.",

    unitM: "m",
    unitM2: "m²",
    unitMin: "min",
  },

  "projector-throw-screen": {
    lensMode: "Objektiv",
    lensModeSingle: "Fiksni, jedan projekcioni odnos",
    lensModeZoom: "Zum, opseg odnosa",
    throwRatio: "Projekcioni odnos TR",
    throwRatioHint: "Iz kataloga objektiva.",
    throwRatioMin: "Projekcioni odnos — donja vrednost",
    throwRatioMax: "Projekcioni odnos — gornja vrednost",
    known: "Poznata veličina",
    knownDistance: "Rastojanje D",
    knownWidth: "Širina slike W",
    knownDiagonal: "Dijagonala",
    knownZoomHint:
      "Uz zum objektiv poznata veličina ne sme biti rastojanje — opseg daje raspon rastojanja, " +
      "ne jedno.",
    knownValue: "Vrednost",
    aspect: "Odnos stranica",
    aspectCustom: "Proizvoljno",
    aspectCustomValue: "Odnos stranica (širina ÷ visina)",
    aspectCustomHint: "Decimalni broj, npr. za 1,85:1 unesi 1,85.",
    lumens: "Svetlosni fluks projektora",
    lumensHint: "ANSI lumeni, iz kataloga. Opciono — bez njega se osvetljenost ne prikazuje.",
    gain: "Pojačanje platna (gain)",
    gainHint: "Prazno polje je 1,0 — Lambertovo mat belo platno.",
    contrastRatio: "Kontrast projektora",
    ambientLux: "Ambijentalna osvetljenost na platnu",
    diffuseReflectance: "Difuzna refleksija platna za ambijentalno svetlo",
    diffuseReflectanceHint:
      "Poseban podatak od pojačanja (gain) — gain važi za usmereni snop projektora, ne za svetlo " +
      "koje pada sa svih strana. Bez ovoga se kontrast računa preko gain-a i precenjuje pri gain " +
      "> 1.",
    seatingDistance: "Rastojanje reda gledalaca",
    targetLuminanceFl: "Ciljna luminansa (obrnut smer)",
    targetLuminanceHint: "U fL — daje potreban fluks projektora za tu luminansu, umesto obrnuto.",

    results: "Rezultat",
    width: "Širina slike",
    height: "Visina slike",
    diagonal: "Dijagonala",
    area: "Površina slike",
    distance: "Rastojanje D",
    zoomRange: "Opseg rastojanja (zum)",
    avgIlluminance: "Osvetljenost platna (ANSI prosek devet tačaka)",
    avgLuminance: "Luminansa (ANSI prosek)",
    onScreenContrast: "Kontrast na platnu",
    requiredLumens: "Potreban fluks za ciljnu luminansu",
    viewingAngle: "Horizontalni ugao gledanja",
    gainApproxNote:
      "Difuzna refleksija platna nije uneta — kontrast je izračunat preko pojačanja (gain), koje " +
      "je usmerena veličina za snop projektora, pa je ovaj broj precenjen za platno sa gain > 1.",
    axisNote:
      "Geometrija pretpostavlja osu upravnu na sredinu platna, bez pomeraja objektiva — pod " +
      "trapeznim izobličenjem nijedna od ovih brojki više ne važi.",

    inputs: "Uneseno",
    formula:
      "TR=D/W     W=D/TR ili D=W·TR     H=W/a     dijagonala=W√(1+1/a²)     E=lm/(W·H)     " +
      "L=E·gain/π     L_fL=lm·gain/(W·H u ft²)     kontrast=(L_belo+L_amb)/(L_crno+L_amb)     " +
      "θ=2·atan((W/2)/D_reda)",

    errorGain: "Pojačanje platna je broj od 0,4 do 4,0.",
    errorAspectRatio: "Odnos stranica mora biti veći od nule.",
    errorKnownValue: "Poznata veličina mora biti veća od nule.",
    errorThrowRatio: "Projekcioni odnos mora biti veći od nule.",
    errorThrowRatioZoom: "Oba kraja opsega zum objektiva moraju biti veća od nule.",
    errorAmbiguousZoom: "Uz zum objektiv poznata veličina ne sme biti rastojanje.",
    errorLumens: "Svetlosni fluks je broj od 100 do 100 000 lm.",
    errorContrastRatio: "Kontrast projektora je broj od 100 do 2 000 000.",
    errorAmbientLux: "Ambijentalna osvetljenost je broj od 0 do 2000 lx.",
    errorDiffuseReflectance: "Difuzna refleksija platna je broj od 0 do 1.",
    errorSeatingDistance: "Rastojanje reda gledalaca je broj od 0,5 do 100 m.",
    errorTargetLuminance: "Ciljna luminansa mora biti veća od nule.",

    unitM: "m",
    unitM2: "m²",
    unitIn: "in",
    unitLx: "lx",
    unitCdm2: "cd/m²",
    unitFl: "fL",
    unitLm: "lm",
    unitDeg: "°",
  },

  "rigging-sling-angle-force": {
    mass: "Masa tereta",
    mode: "Način zahvata",
    modeSingle: "Jedan zajednički ugao (do 4 kraka)",
    modeTwoPoint: "Zahvat u dve tačke, jedan kuka iznad",
    legs: "Broj krakova",
    angleMode: "Način zadavanja ugla",
    angleModeFromVertical: "Od vertikale",
    angleModeFromHorizontal: "Od horizontale",
    angleModeIncluded: "Uključeni ugao između krakova",
    angleModeHeightRadius: "Visina i horizontalno odstojanje",
    angleValue: "Ugao",
    height: "Visina tačke vešanja h",
    radius: "Horizontalno odstojanje r",
    span: "Razmak tačaka zahvata L",
    cogFromA: "Odstojanje težišta od tačke A",
    hookHeight: "Visina kuke iznad tačaka zahvata h",
    hookHeightHint:
      "Oba ugla slede iz ove visine — nisu slobodan izbor, jer jedna kuka stoji iznad oba kraka.",
    dynamicFactor: "Dinamički faktor",
    dynamicFactorHint:
      "Iz pravila posla. Bez unosa se prikazuje samo statička (nefaktorisana) sila.",
    dynamicFactorNone: "nije unet",
    wllPerLeg: "Granica sa pločice (WLL) po kraku",
    wllHint: "Sa pločice ugice. Nexus ne drži nijednu tabelu nosivosti.",
    wllUnit: "Jedinica granice",

    results: "Rezultat",
    weight: "Težina tereta",
    weightFactored: "Težina tereta, sa dinamičkim faktorom",
    beta: "Ugao β od vertikale",
    forceLeg: "Sila po kraku",
    forceLegFactored: "Sila po kraku, sa dinamičkim faktorom",
    vertical: "Vertikalna komponenta po kraku",
    angleFactor: "Faktor ugla 1/cos β",
    fourLegShare: "Idealna podela na 4 kraka",
    twoLegShare: "Podela na 2 kraka (konzervativna)",
    fourLegNote:
      "Kruti teret na četiri kraka nije statički određen — idealna podela na sve 4 je jedna " +
      "moguća pretpostavka.",
    twoPointBetaA: "Ugao β u tački A",
    twoPointBetaB: "Ugao β u tački B",
    twoPointForceA: "Sila u tački A",
    twoPointForceB: "Sila u tački B",
    twoPointLegLengthA: "Dužina kraka do tačke A",
    twoPointLegLengthB: "Dužina kraka do tačke B",
    horizontal: "Horizontalna komponenta",
    horizontalNote:
      "Horizontalna komponenta pritiska teret ka unutra — brojčano jednaka sili pritiska koju bi " +
      "preuzela raspornica.",
    legLength: "Dužina kraka",
    wllRatio: "Sila po kraku (faktorisana) ÷ granica sa pločice",

    inputs: "Uneseno",
    formula:
      "W=m·g     β iz ugla, ili β=atan(r/h)     F=W/(n·cosβ)     H=F·sinβ     V=W/n     zahvat u " +
      "dve tačke: V_A=W(L−a)/L, V_B=Wa/L, β_A=atan(a/h), β_B=atan((L−a)/h), F=V/cosβ",

    errorMass: "Masa tereta je broj od 0,1 do 100 000 kg.",
    errorLegs: "Broj krakova je ceo broj od 1 do 4.",
    errorDynamicFactor: "Dinamički faktor je broj od 1,0 do 5,0.",
    errorSpan: "Razmak tačaka zahvata mora biti veći od nule.",
    errorCogFromA:
      "Odstojanje težišta od tačke A ne sme biti negativno niti veće od razmaka tačaka.",
    errorHookHeight: "Visina kuke mora biti veća od nule i dovoljna da oba ugla ostanu ispod 90°.",
    errorWllPerLeg: "Granica sa pločice mora biti veća od nule.",
    errorAngleValue: "Ugao mora biti unet za izabrani način zadavanja.",
    errorHeight: "Visina tačke vešanja mora biti veća od nule.",
    errorRadius: "Horizontalno odstojanje ne sme biti negativno.",
    errorAngle: "Ugao β od vertikale mora biti u opsegu 0° do 89,999°.",

    unitKn: "kN",
    unitKgf: "kgf",
    unitM: "m",
    unitDeg: "°",
  },

  "run-of-show": {
    start: "Vreme početka",
    startHint: "HH:MM, 00:00 do 23:59.",
    items: "Tačke satnice",
    itemsHint:
      "Po jedan red: naziv; trajanje u minutima ili H:MM (npr. 1:30 = 90 min); opciono fiksno " +
      "vreme HH:MM. U smeru „unazad\" fiksno vreme sme da nosi samo poslednji red.",
    changeover: "Prelaz između tačaka",
    changeoverHint: "Minuti, isti za sve tačke, 0 do 240.",
    curfew: "Krajnji rok",
    curfewHint: "HH:MM, po dogovoru sa objektom. Opciono.",
    direction: "Smer računanja",
    directionForward: "Unapred, od vremena početka",
    directionBackward: "Unazad, od poslednje (zakovane) tačke",
    buffer: "Rezerva pre poslednje tačke",
    bufferHint: "Minuti držani pre poslednje, zakovane tačke — smer „unazad\" jedini je koristi.",
    display: "Prikaz vremena u tabeli",
    displayAbsolute: "Apsolutna vremena",
    displayRelative: "Vreme od početka",

    results: "Satnica",
    colName: "Tačka",
    colStart: "Početak",
    colEnd: "Kraj",
    colDuration: "Trajanje",
    colShare: "Udeo",
    colGapCollision: "Praznina / preklapanje",
    gap: "praznina",
    collision: "preklapanje",
    totalDuration: "Ukupno trajanje tačaka",
    totalChangeover: "Ukupno prelaza",
    totalGap: "Ukupno praznina",
    totalCollision: "Ukupno preklapanja",
    span: "Ukupan raspon",
    curfewRemaining: "Preostalo do krajnjeg roka",
    requiredStart: "Potreban početak",
    slack: "Rezerva u odnosu na uneti početak",

    inputs: "Uneseno",
    formula:
      "napred: početak_i = kraj_{i−1} + prelaz (ili fiksno vreme); kraj_i = početak_i + " +
      "trajanje_i     unazad: potreban_početak = zakovano_vreme − Σ(trajanje + prelaz) − rezerva " +
      "    praznina = fiksno − kursor (> 0)     preklapanje = kursor − fiksno (> 0)",

    rowLabel: "red",
    errorItems: "Unesi bar jednu tačku, najviše 200.",
    errorStart: "Vreme početka mora biti u obliku HH:MM, između 00:00 i 23:59.",
    errorChangeover: "Prelaz između tačaka je broj minuta od 0 do 240.",
    errorCurfew: "Krajnji rok mora biti u obliku HH:MM, između 00:00 i 23:59.",
    errorBuffer: "Rezerva pre poslednje tačke ne sme biti negativna.",
    errorDuration: "Trajanje tačke mora biti veće od nule — broj minuta ili H:MM.",
    errorAnchorMissing: "U smeru „unazad\" poslednja tačka mora imati fiksno vreme.",
    errorAnchorNotLast: "U smeru „unazad\" fiksno vreme sme da nosi samo poslednja tačka.",
    errorAnchorFormat: "Fiksno vreme mora biti u obliku HH:MM, između 00:00 i 23:59.",

    unitMin: "min",
  },

  "seating-tables": {
    guests: "Broj gostiju",
    kind: "Tip stola",
    kindRound: "Okrugli",
    kindLong: "Dugački (banket)",
    diameter: "Prečnik ploče",
    length: "Dužina stola",
    width: "Širina stola",
    ends: "Sedenje na čelima",
    yes: "Da",
    no: "Ne",
    seatWidth: "Širina mesta po gostu",
    clearance: "Slobodan prostor oko stola",
    clearanceHint:
      "Korisnikova planska mera za stolice i prolaz, po strani stola. Nexus je ne nudi kao " +
      "preporuku — nije širina evakuacionog puta i alatka je tako ne imenuje.",
    availableArea: "Raspoloživa površina za stolove",
    availableAreaHint: "Opciono, samo za poređenje sa potrebnom površinom.",
    availableWidth: "Raspoloživ prostor — širina",
    availableSpaceHint:
      "Opciono, alternativa površini — daje broj stolova koji stanu u mrežu, ne u tečnost.",
    availableDepth: "Raspoloživ prostor — dubina",

    results: "Rezultat",
    seatsPerTable: "Mesta po stolu",
    tables: "Potreban broj stolova",
    lastTableGuests: "Gostiju za poslednjim stolom",
    cellArea: "Površina ćelije jednog stola",
    totalCellArea: "Zbirna površina svih stolova",
    totalCircularFootprint: "Zbirna kružna površina uticaja",
    continuousSegments: "Segmenata neprekidne table",
    continuousLength: "Dužina neprekidne table",
    continuousCapacity: "Mesta u neprekidnoj tabli",
    continuous: "Neprekidna tabla",
    guestsUnit: "gostiju",
    areaRatio: "Odnos potrebne i raspoložive površine",
    gridFitTables: "Stolova stane u raspoloživ prostor (mreža)",

    inputs: "Uneseno",
    formula:
      "okrugli: P=π·D, n=floor(P/s), A_ćelija=(D+2c)²     dugački: " +
      "n=2·floor(L/s)+2·floor(W/s)·[čela], A_ćelija=(L+2c)(W+2c)     T=ceil(G/n)     " +
      "A_ukupno=T·A_ćelija     mreža: floor(širina/(D+2c))·floor(dubina/(D+2c))",

    errorGuests: "Broj gostiju je ceo broj od 1 do 5000.",
    errorSeatWidth: "Širina mesta po gostu je broj od 0,45 do 1,00 m.",
    errorClearance: "Slobodan prostor oko stola je broj od 0,40 do 2,00 m.",
    errorDiameter: "Prečnik ploče je broj od 0,80 do 3,00 m.",
    errorLength: "Dužina stola je broj od 0,80 do 6,00 m.",
    errorWidth: "Širina stola je broj od 0,60 do 2,00 m.",
    errorTooFewSeats:
      "Sa ovom širinom mesta sto ne prima ni dva gosta — smanji širinu mesta ili poveći sto.",
    errorAvailableArea: "Raspoloživa površina ne sme biti negativna.",
    errorAvailableSpace: "Širina i dubina raspoloživog prostora moraju biti veće od nule.",

    unitM: "m",
    unitM2: "m²",
  },

  "stage-deck-layout": {
    width: "Širina bine",
    depth: "Dubina bine",
    moduleLength: "Dužina modula podesta",
    moduleLengthHint: "Iz kataloga podesta.",
    moduleWidth: "Širina modula podesta",
    moduleWidthHint: "Iz kataloga podesta.",
    stageHeight: "Visina bine",
    skirtSides: "Zavesa po obimu",
    skirtAll: "Sve strane",
    skirtThree: "Tri strane",
    skirtTwo: "Dve strane",
    skirtNone: "Bez zavese",
    totalMass: "Ukupna masa na bini",
    totalMassHint: "Ljudi, beklajn i oprema zajedno.",
    udlLimit: "Granica ravnomernog opterećenja iz tabele proizvođača podesta",
    occupancyDensity: "Gustina lica na podijumu",
    regulatedHint:
      "Iz propisa koji primenjuješ. Nexus ne zna koji je to propis i ne nudi vrednost.",

    results: "Rezultat",
    requiredArea: "Tražena površina bine",
    perimeter: "Obim bine",
    skirtArea: "Površina zavese",
    mixedNote:
      "Obe orijentacije modula su ispisane u celini — mešovita orijentacija nije razmatrana.",
    positionA: "Položaj A",
    positionB: "Položaj B",
    decksWide: "podesta po širini",
    decksDeep: "podesta po dubini",
    decks: "broj podesta",
    decksUnit: "podesta",
    coveredArea: "pokrivena površina",
    waste: "višak preko tražene površine",
    legs: "broj nogu",
    massPerLeg: "masa po nozi pri ravnomernoj raspodeli",
    fewerDecks: "Manje podesta koristi",
    fewerDecksEqual: "podjednako",
    udlAreaNote:
      "Opterećenje je izračunato nad nominalnom površinom bine (širina × dubina), ne nad većom " +
      "preklopljenom površinom koju podesti stvarno pokrivaju.",
    udl: "Izračunato ravnomerno opterećenje",
    udlRatio: "Izračunato opterećenje ÷ granica proizvođača",
    occupancyPersons: "Broj lica pri unetoj gustini",

    inputs: "Uneseno",
    formula:
      "A=Š·D     obim=2(Š+D)     položaj: n_š=ceil(Š/l), n_d=ceil(D/w), podesti=n_š·n_d, " +
      "pokriveno=n_š·l·n_d·w     noge=(n_š+1)(n_d+1)     opterećenje=masa/A     " +
      "lica=floor(A/gustina)",

    errorWidth: "Širina bine je broj od 0,5 do 100 m.",
    errorDepth: "Dubina bine je broj od 0,5 do 100 m.",
    errorModuleLength: "Dužina modula podesta je broj od 0,5 do 4,0 m.",
    errorModuleWidth: "Širina modula podesta je broj od 0,5 do 4,0 m.",
    errorStageHeight: "Visina bine je broj od 0,1 do 3,0 m.",
    errorTotalMass: "Ukupna masa na bini ne sme biti negativna.",
    errorUdlLimit: "Granica opterećenja mora biti veća od nule.",
    errorOccupancyDensity: "Gustina lica na podijumu mora biti veća od nule.",

    unitM: "m",
    unitM2: "m²",
    unitKg: "kg",
    unitKgM2: "kg/m²",
  },

  "tent-bay-layout": {
    sizeMode: "Način zadavanja veličine",
    sizeModeArea: "Potrebna površina",
    sizeModeLength: "Zadata dužina",
    requiredArea: "Potrebna natkrivena površina",
    requiredLength: "Zadata dužina umesto površine",
    width: "Širina šatora",
    bayLength: "Dužina polja (modul)",
    bayLengthHint:
      "Uobičajen modul proizvođača — proveri kod proizvođača pre nego što se osloniš na njega.",
    eaveHeight: "Visina strehe",
    roofPitch: "Nagib krova",
    margin: "Slobodan pojas oko šatora",
    marginHint: "Za zatege i sidrenje. Alatka ne predlaže broj ni raspored zatega ni sidara.",
    sides: "Stranice",
    sidesAll: "Sve",
    sidesNoEnds: "Bez čela",
    sidesNone: "Bez",
    requiredHeadHeight: "Tražena visina glave",
    requiredHeadHeightHint: "Opciono — korisna širina pod kosim krovom na ovoj visini.",

    results: "Rezultat",
    bays: "Broj polja",
    length: "Ukupna dužina",
    area: "Natkrivena površina",
    waste: "Višak preko tražene površine",
    lengthDiff: "Razlika ostvarene i zadate dužine",
    footprint: "Gabarit sa slobodnim pojasom",
    tentPerimeter: "Obim šatora",
    footprintPerimeter: "Obim gabarita (za zahtev prema objektu)",
    ridgeHeight: "Visina slemena",
    roofArea: "Površina krova",
    sideWallArea: "Površina bočnih stranica",
    gableEndsArea: "Površina čela",
    totalSheeting: "Zbirna površina cerada",
    sheetingNote:
      "Geometrijska neto površina — bez preklopa na šavovima, bez otvora za vrata, bez " +
      "isključenog čela. Nije količina za poručivanje materijala.",
    legs: "Broj nogu",
    usableWidth: "Korisna širina na traženoj visini glave",

    inputs: "Uneseno",
    formula:
      "n=ceil(A/(w·b)) ili ceil(L/b)     L=n·b     A=w·L     sleme: r=(w/2)tan α, " +
      "h_sleme=h_streha+r     krov=w·L/cos α     bočne=2·L·h     čela=2(w·h+w·r/2)     " +
      "noge=2(n+1)",

    errorRequiredArea:
      "Unesi tačno jedno od dvoje — traženu površinu ili zadatu dužinu, ne oboje niti nijedno.",
    errorRequiredLength: "Zadata dužina mora biti veća od nule.",
    errorWidth: "Širina šatora je broj od 3 do 60 m.",
    errorBayLength: "Dužina polja je broj od 1 do 10 m.",
    errorEaveHeight: "Visina strehe je broj od 1,5 do 8 m.",
    errorRoofPitch: "Nagib krova je broj od 5° do 45°.",
    errorMargin: "Slobodan pojas ne sme biti negativan.",
    errorRequiredHeadHeight:
      "Tražena visina glave mora biti veća od nule i manja od visine slemena.",

    unitM: "m",
    unitM2: "m²",
    unitDeg: "°",
  },

  "three-phase-load-balance": {
    lineVoltage: "Linijski napon",
    lineVoltageHint: "Nazivni napon instalacije. Prazno polje računa se kao 400 V.",
    phaseVoltage: "Fazni napon (direktno)",
    phaseVoltageHint:
      "Samo za jednofazni sistem gde se fazni napon ne izvodi iz linijskog (npr. 230 V). " +
      "Prepisuje ga i vraća linijski napon.",
    consumers: "Potrošači",
    consumersHint:
      "Po jedan red: naziv; snaga u W ili kW; priključak (L1 / L2 / L3 / trofazni / L1L2 / L2L3 " +
      "/ L3L1); faktor snage cos φ (0,1 do 1,0, negativan za potrošač koji prednjači); " +
      "istovremenost u % (podrazumevano 100).",
    ratedBreaker: "Nazivna struja osigurača po fazi",
    regulatedHint: "Prepisana sa razvodnog ormana. Nexus nema spisak osigurača i ne nudi vrednost.",

    results: "Rezultat po fazama",
    colPhase: "Faza",
    colActive: "Aktivna snaga",
    colReactive: "Reaktivna snaga",
    colApparent: "Prividna snaga",
    colCurrent: "Struja",
    phaseL1: "L1",
    phaseL2: "L2",
    phaseL3: "L3",
    breakerRatio: "Struja ÷ nazivna struja osigurača",
    totalActive: "Ukupna aktivna snaga",
    totalReactive: "Ukupna reaktivna snaga",
    totalApparent: "Ukupna prividna snaga (vektorski zbir)",
    sumPhaseApparent: "Zbir prividnih snaga po fazama",
    threeTimesMaxPhase: "3 × najopterećenija faza",
    powerFactor: "Rezultujući faktor snage",
    neutralCurrent: "Struja nule",
    avgCurrent: "Srednja struja po fazi",
    imbalance: "Nesimetrija",
    modelNote:
      "Harmonici i zaletni udar motora nisu modelirani — struja nule nelinearnog opterećenja " +
      "nije fazorski zbir osnovnih harmonika.",

    inputs: "Uneseno",
    formula:
      "U_LN=U/√3     P=P_nazivna·(istovremenost/100)     Q=P·tanφ     S_faza=√(P²+Q²)     " +
      "I_faza=S_faza/U_LN     I_N=|ΣI_faza (fazorski)|     nesimetrija=max|I_k−I_sr|/I_sr",

    rowLabel: "red",
    errorConsumers: "Unesi bar jednog potrošača.",
    errorLineVoltage: "Linijski napon je broj od 100 do 1000 V.",
    errorPhaseVoltage: "Fazni napon je broj od 60 do 600 V.",
    errorRatedBreaker: "Nazivna struja osigurača je broj od 1 do 630 A.",
    errorKw: "Snaga potrošača mora biti veća od nule.",
    errorCosPhi: "Faktor snage (po apsolutnoj vrednosti) je broj od 0,1 do 1,0.",
    errorSimultaneity: "Istovremenost je broj od 0 do 100%.",
    errorConnectionFormat: "Priključak nije prepoznat — L1, L2, L3, trofazni, L1L2, L2L3 ili L3L1.",
    errorConnectionRange:
      "Kod direktno unetog faznog napona (jednofazni sistem) priključak mora biti L1.",

    unitV: "V",
    unitA: "A",
    unitKw: "kW",
    unitKvar: "kvar",
    unitKva: "kVA",
  },

  "truss-hoist-reactions": {
    length: "Dužina trase",
    selfWeight: "Sopstvena težina trase",
    selfWeightHint: "Iz kataloga trase, kg/m.",
    pointA: "Položaj tačke A",
    pointB: "Položaj tačke B",
    loads: "Tereti",
    loadsHint: "Po jedan red: naziv; masa u kg; položaj u m od levog kraja trase.",
    extraDistributed: "Dodatno ravnomerno opterećenje",
    extraDistributedHint: "Kablovi, zavesa i slično, kg/m.",
    hoistCapacityA: "Nosivost motora u tački A",
    hoistCapacityB: "Nosivost motora u tački B",
    regulatedHint: "Sa pločice motora. Nexus nema spisak motora i ne nudi vrednost.",
    slingAngle: "Ugao zahvata (bridla) od vertikale",
    slingAngleHint: "Opciono — daje silu u kraku umesto same vertikalne reakcije.",

    results: "Rezultat",
    totalMass: "Ukupna masa na trasi",
    pointMass: "Masa tereta",
    distributedMass: "Sopstvena i dodatna ravnomerna masa",
    swappedNote:
      "Tačke A i B su zamenjene mestima jer je A uneta desno od B — proračun ide sa manjom " +
      "koordinatom kao A.",
    reactionA: "Sila u tački A",
    reactionB: "Sila u tački B",
    uplift: "podizanje",
    cogPosition: "Položaj težišta",
    checkResidual: "Kontrolni ostatak (mora biti ~0)",
    maxMoment: "Najveći moment savijanja",
    shearA: "Poprečna sila u tački A",
    shearB: "Poprečna sila u tački B",
    equivalentUdl: "Ekvivalentno ravnomerno opterećenje",
    ratioA: "Sila u A ÷ nosivost motora A",
    ratioB: "Sila u B ÷ nosivost motora B",
    legTensionNote:
      "Sila u kraku pod uglom zahvata — reakcija je vertikalna komponenta, a motor preko bridla " +
      "vuče veću silu.",
    legTensionA: "Sila u kraku, tačka A",
    legTensionB: "Sila u kraku, tačka B",

    inputs: "Uneseno",
    formula:
      "M=ΣM_i+M_w     R_B=[Σm_i(x_i−x_A)+M_w(L/2−x_A)]/(x_B−x_A)     R_A=M−R_B     " +
      "x_tg=[Σm_i·x_i+M_w·L/2]/M     q_ekv=8·M_max/raspon²     kraka=R/cosβ",

    rowLabel: "red",
    errorLength: "Dužina trase mora biti veća od nule.",
    errorSelfWeight: "Sopstvena težina trase ne sme biti negativna.",
    errorPointA: "Položaj tačke A mora biti između 0 i dužine trase, i različit od tačke B.",
    errorPointB: "Položaj tačke B mora biti između 0 i dužine trase.",
    errorExtraDistributed: "Dodatno ravnomerno opterećenje ne sme biti negativno.",
    errorNoLoad: "Trasa nema nikakvu masu — unesi sopstvenu težinu, dodatno opterećenje ili teret.",
    errorHoistCapacityA: "Nosivost motora u tački A mora biti veća od nule.",
    errorHoistCapacityB: "Nosivost motora u tački B mora biti veća od nule.",
    errorSlingAngle: "Ugao zahvata je broj od 0° do 89°.",
    errorMass: "Masa tereta mora biti veća od nule.",
    errorPosition: "Položaj tereta mora biti između 0 i dužine trase.",

    unitM: "m",
    unitKg: "kg",
    unitKn: "kN",
    unitKgm: "kg·m",
    unitKgPerM: "kg/m",
  },

  "venue-occupancy-area": {
    grossArea: "Bruto površina",
    zones: "Oduzete zone",
    zonesHint:
      "Po jedan red: naziv; površina u m² (bina, šank, plesni podijum, tehnika, prolazi). " +
      "Isključivo sa poljem „oduzeto kao procenat\".",
    deductPct: "Oduzeto kao procenat",
    deductPctHint: "Umesto pojedinačnih zona, ne uz njih.",
    layouts: "Rasporedi",
    layoutsHint:
      "Po jedan red: naziv rasporeda; gustina u m²/osobi; bruto ili neto (na koju površinu se " +
      "gustina primenjuje); opciono broj lica iz dokumentacije objekta.",
    guests: "Broj gostiju",
    guestsHint: "Opciono — za obrnut račun, površina po osobi i potrebna površina.",

    results: "Rezultat",
    netArea: "Neto površina",
    deductedArea: "Zbir oduzetih zona",
    areaPerGuest: "Površina po osobi za uneti broj gostiju",
    layoutFallback: "Raspored",
    basisUsed: "Gustina primenjena na",
    basisGross: "Bruto površinu",
    basisNet: "Neto površinu",
    personsAtDensity: "Broj osoba pri unetoj gustini",
    requiredAreaDiff: "Razlika neto površine i potrebne površine za goste",
    documented: "Broj lica iz dokumentacije objekta",
    ratio: "Odnos",
    personsUnit: "osoba",

    inputs: "Uneseno",
    formula:
      "A_neto=A_bruto−oduzeto (zone ili %)     N=floor(površina/gustina)     A_potrebno=G·gustina",

    rowLabel: "red",
    errorGrossArea: "Bruto površina je broj od 1 do 100 000 m².",
    errorDeduction: "Unesi ili zone, ili procenat oduzimanja — ne oboje.",
    errorNetArea:
      "Oduzete zone i procenat prevazilaze bruto površinu — neto površina mora biti veća od nule.",
    errorLayouts: "Unesi bar jedan raspored.",
    errorGuests: "Broj gostiju mora biti veći od nule.",
    errorDeductPct: "Oduzeto kao procenat je broj od 0 do 90%.",
    errorZoneArea: "Površina zone ne sme biti negativna.",
    errorDensity: "Gustina mora biti veća od nule.",
    errorDocumentedCount: "Broj lica iz dokumentacije objekta mora biti veći od nule.",
    errorBasisFormat: "Osnova gustine nije prepoznata — upiši „bruto\" ili „neto\".",

    unitM2: "m²",
    unitM2PerPerson: "m²/osobi",
  },

  "voltage-drop": {
    system: "Sistem",
    systemDc: "Jednosmerni",
    systemSinglePhase: "Jednofazni",
    systemThreePhase: "Trofazni",
    material: "Materijal provodnika",
    materialCopper: "Bakar",
    materialAluminium: "Aluminijum",
    mode: "Smer računa",
    modeForward: "Zadat presek → pad napona",
    modeReverse: "Zadat pad napona → potreban presek",
    crossSection: "Presek provodnika",
    crossSectionHint:
      "Prepisan sa kabla, mm². Obavezan osim ako je uneta otpornost sa deklaracije.",
    customResistance: "Otpornost sa deklaracije kabla",
    customResistanceHint:
      "Ω/km — kada je uneta, zaobilazi računanje iz preseka i materijala u potpunosti.",
    length: "Dužina trase u jednom smeru",
    current: "Struja",
    nominalVoltage: "Nazivni napon",
    nominalVoltageHint: "Potreban za procenat pada, napon na kraju voda i obrnut smer računa.",
    conductorTemp: "Temperatura provodnika",
    conductorTempHint: "Prazno polje računa se kao 20 °C, referentna temperatura otpornosti.",
    dropLimit: "Granica pada napona koju primenjuješ",
    regulatedHint:
      "Iz propisa, projekta ili uslova posla. Nexus je ne nudi ni kao podrazumevanu vrednost.",

    results: "Rezultat",
    resistance: "Otpornost voda",
    dropVolts: "Pad napona",
    perPhaseNote: "Trofazni pad iznad je MEĐUFAZNI. Pad po fazi (÷√3) je poseban red ispod.",
    dropVoltsPerPhase: "Pad napona po fazi",
    dropPct: "Pad napona u % nazivnog napona",
    farEndVoltage: "Napon na kraju voda",
    powerLoss: "Gubitak snage",
    dropRatio: "Izračunati pad ÷ granica",
    requiredSection: "Potreban presek (bez zaokruživanja na standardni niz)",
    selectedSection: "Odabran standardni presek (IEC 60228)",
    noStandardSection: "nema standardnog preseka u nizu",

    inputs: "Uneseno",
    formula:
      "ρ(θ)=ρ₂₀(1+α(θ−20))     R₁=ρ(θ)·L/S     jednosmerni/jednofazni: ΔU=2·I·R₁     trofazni: " +
      "ΔU=√3·I·R₁ (međufazni), ΔU_faza=ΔU/√3     ΔU%=ΔU/U·100     obrnuto: S=ρ(θ)·L/R₁_cilj, " +
      "R₁_cilj=ΔU_cilj/(k·I)",

    errorLength: "Dužina trase je broj od 0,1 do 5000 m.",
    errorCurrent: "Struja je broj od 0,01 do 2000 A.",
    errorConductorTemp: "Temperatura provodnika je broj od −20 do 120 °C.",
    errorNominalVoltage: "Nazivni napon je broj od 12 do 1000 V — obavezan u obrnutom smeru.",
    errorDropLimit: "Granica pada napona je broj od 0,1 do 20% — obavezna u obrnutom smeru.",
    errorCrossSection:
      "Presek provodnika je broj od 0,5 do 630 mm², ili unesi otpornost sa deklaracije kabla.",
    errorCustomResistance: "Otpornost sa deklaracije kabla mora biti veća od nule.",

    unitOhm: "Ω",
    unitV: "V",
    unitW: "W",
    unitMm2: "mm²",
    unitM: "m",
    unitA: "A",
  },
} as const;
