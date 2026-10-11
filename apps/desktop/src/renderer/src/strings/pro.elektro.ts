/**
 * „Elektro" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment spells the
 * registration. The tool's NAME and its one-line blurb are not here: those live
 * in a different table another process owns.
 *
 * **Three tools carry an absolute discipline.** `transformer-current`,
 * `conduit-fill` and `motor-starting-current` may name a quantity and the user's
 * own limit, and may never say what they mean together — no „bezbedno", no
 * „ispravno", no verdict of any kind, anywhere in this file.
 *
 * **A unit is copy, not a constant.** „A", „mm²", „lm" and „kWh" are written
 * here rather than concatenated in the surface.
 */
export const PRO_ELEKTRO_SR = {
  "energy-cost": {
    power: "Snaga uređaja",
    hoursPerDay: "Radnih sati dnevno",
    days: "Broj dana",
    price: "Cena kilovat-časa",
    priceHint: "Iz tvog računa za struju. Nexus ne zna tarifu i ne nudi je.",
    duty: "Udeo vremena pod punim opterećenjem",
    dutyHint:
      "U procentima. Prazno polje znači 100 % — da uređaj sve vreme radi punom snagom.",
    results: "Rezultat",
    effectivePower: "Snaga posle režima rada",
    hoursTotal: "Ukupno radnih sati",
    energyPerDay: "Energija dnevno",
    energy: "Ukupna energija",
    cost: "Ukupna cena",
    costPerDay: "Cena po danu",
    formulaLine: "E = P·t/1000     cena = E × cena kilovat-časa",
    inputs: "Uneseno",
    unitW: "W",
    unitH: "h",
    unitKwh: "kWh",
    unitCurrency: "din",
    errorPower: "Snaga mora biti veća od nule.",
    errorHours: "Broj radnih sati dnevno je između 0 i 24.",
    errorDays: "Broj dana je ceo broj od 1 do 3660.",
    errorDuty: "Udeo vremena je između 0 i 100 procenata.",
    errorPrice: "Cena kilovat-časa ne može biti negativna.",
  },

  "lighting-count": {
    area: "Površina prostorije",
    targetLux: "Ciljna osvetljenost",
    targetLuxHint:
      "U luksima, iz standarda ili preporuke po kojoj radiš. Nexus ne bira nivo i ne nudi ga.",
    luminaireLumens: "Svetlosni tok jedne svetiljke",
    luminaireLumensHint: "U lumenima, iz podataka proizvođača.",
    utilisationFactor: "Faktor iskorišćenja",
    utilisationHint: "Deo toka koji stigne do radne površine, iz podataka svetiljke ili proračuna.",
    maintenanceFactor: "Faktor održavanja",
    maintenanceHint: "Koliko od toka ostane posle prljanja i starenja.",
    results: "Rezultat",
    requiredLumens: "Potreban svetlosni tok",
    luminaireCount: "Broj svetiljki",
    installedLumens: "Ugrađeni svetlosni tok",
    achievedLux: "Postignuta osvetljenost",
    luxRatio: "Odnos prema ciljnoj osvetljenosti",
    formulaLine: "N = E·A/(Φ·UF·MF)     osvetljenost = N·Φ·UF·MF/A",
    inputs: "Uneseno",
    unitLm: "lm",
    unitLx: "lx",
    unitM2: "m²",
    errorArea: "Površina mora biti veća od nule.",
    errorLux: "Ciljna osvetljenost mora biti broj veći od nule.",
    errorLumens: "Svetlosni tok svetiljke mora biti veći od nule.",
    errorUtilisation: "Faktor iskorišćenja je između 0,1 i 1.",
    errorMaintenance: "Faktor održavanja je između 0,1 i 1.",
  },

  "luminaire-spacing": {
    spacingToHeightRatio: "Odnos razmak-visina",
    ratioHint: "Iz fotometrijskih podataka svetiljke. Nije unapred postavljen nijedan broj.",
    mountingHeight: "Visina vešanja",
    workPlaneHeight: "Visina radne površine",
    workPlaneHint: "Odnos se meri od radne površine, a ne od poda. Prazno polje znači 0.",
    roomLength: "Dužina prostorije",
    roomWidth: "Širina prostorije",
    results: "Rezultat",
    heightAboveWorkPlane: "Visina iznad radne površine",
    maxSpacing: "Najveći razmak svetiljki",
    countAlong: "Broj po dužini",
    countAcross: "Broj po širini",
    totalCount: "Ukupno svetiljki",
    formulaLine: "S = SHR·(h − h_rp)     broj = ceil(dužina/S) po svakoj osi",
    inputs: "Uneseno",
    unitM: "m",
    errorRatio: "Odnos razmak-visina je između 0,1 i 3.",
    errorHeight: "Visina vešanja mora biti veća od visine radne površine.",
    errorLength: "Dužina prostorije mora biti veća od nule.",
    errorWidth: "Širina prostorije mora biti veća od nule.",
  },

  "transformer-current": {
    apparentPower: "Nazivna snaga",
    phases: "Broj faza",
    phaseSingle: "Monofazno",
    phaseThree: "Trofazno",
    primaryVoltage: "Napon primara",
    secondaryVoltage: "Napon sekundara",
    results: "Rezultat",
    primaryCurrent: "Struja primara",
    secondaryCurrent: "Struja sekundara",
    phaseFactor: "Fazni faktor",
    formulaLine: "I = S/(√3·U) za trofazno     I = S/U za monofazno",
    inputs: "Uneseno",
    unitA: "A",
    unitKva: "kVA",
    errorPower: "Nazivna snaga mora biti veća od nule.",
    errorPrimary: "Napon primara mora biti veći od nule.",
    errorSecondary: "Napon sekundara mora biti veći od nule.",
  },

  "conduit-fill": {
    conduitDiameter: "Unutrašnji prečnik cevi",
    conduitDiameterHint: "Unutrašnji prečnik, a ne nazivna mera cevi.",
    conductorDiameter: "Prečnik jednog provodnika",
    conductorCount: "Broj provodnika",
    fillLimit: "Granica ispune",
    fillLimitHint: "Iz propisa po kojem radiš. Nexus je ne zna i ne nudi vrednost.",
    results: "Rezultat",
    conduitArea: "Površina poprečnog preseka cevi",
    conductorsArea: "Površina provodnika",
    fillPercent: "Ispuna",
    fillRatio: "Odnos prema granici",
    remainingArea: "Slobodna površina",
    formulaLine: "ispuna = Σ(π·d²/4)/(π·D²/4) = Σd²/D²",
    inputs: "Uneseno",
    unitMm: "mm",
    unitMm2: "mm²",
    errorConduit: "Unutrašnji prečnik cevi mora biti veći od nule.",
    errorConductor: "Prečnik provodnika mora biti veći od nule i manji od prečnika cevi.",
    errorCount: "Broj provodnika je ceo broj od 1 do 500.",
    errorLimit: "Granica ispune je između 1 i 100 procenata.",
  },

  "motor-starting-current": {
    ratedCurrent: "Nazivna struja motora",
    ratedCurrentHint: "Sa natpisne pločice, struja na punom opterećenju.",
    startingRatio: "Odnos polazne i nazivne struje",
    startingRatioHint:
      "Oznaka k sa natpisne pločice ili iz podataka motora — 4 i 8 opisuju različite mašine.",
    method: "Način pokretanja",
    methodDol: "Direktan start",
    methodStarDelta: "Zvezda-trougao",
    methodSoft: "Soft starter",
    softStartPercent: "Početni napon soft startera",
    softStartHint: "U procentima nazivnog napona.",
    estimateNote:
      "Račun je procena iz podataka sa pločice — impedansa mreže, karakteristika motora i " +
      "otpor tereta nisu u njemu.",
    results: "Rezultat",
    lockedRotorCurrent: "Struja zaglavljenog rotora",
    startingCurrent: "Struja pokretanja",
    startingRatioOut: "Polazna struja / nazivna struja",
    torqueShare: "Deo polaznog momenta",
    formulaLine:
      "I_p = k·I_N     zvezda-trougao: I/3 i M/3     soft: I·p/100 i M·(p/100)²",
    inputs: "Uneseno",
    unitA: "A",
    errorRated: "Nazivna struja mora biti veća od nule.",
    errorRatio: "Odnos polazne i nazivne struje je između 1 i 20.",
    errorSoft: "Početni napon soft startera je između 10 i 100 procenata.",
  },
} as const;
