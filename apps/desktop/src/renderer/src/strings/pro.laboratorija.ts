/**
 * „Laboratorija" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment spells the
 * registration. The tool's NAME and its one-line blurb are not here: those live
 * in a different table another process owns.
 *
 * **Four of these tools carry an absolute discipline.** `molarity-to-mass`,
 * `dilution`, `ph-strong-acid-base` and `buffer-ph` may name a quantity and the
 * user's own figures, and may never say what they mean together — no „bezbedno",
 * no „ispravno", no verdict of any kind, anywhere in this file.
 *
 * **A unit is copy, not a constant.** „g", „mol/l" and „ppm" are written here
 * rather than concatenated in the surface, so a translator can find every one of
 * them.
 */
export const PRO_LABORATORIJA_SR = {
  "molar-mass": {
    formula: "Hemijska formula",
    formulaHint:
      "Npr. H2O, Ca(OH)2, Al2[SO4]3 ili CuSO4·5H2O. Zagrade i hidrat se čitaju, velika i " +
      "mala slova razlikuju elemente.",
    results: "Rezultat",
    molarMass: "Molarna masa",
    totalAtoms: "Ukupno atoma",
    colElement: "Element",
    colCount: "Atoma",
    colMass: "Masa",
    colShare: "Udeo",
    formulaLine: "M = Σ nᵢ·Arᵢ     Ar po standardnim atomskim masama (CIAAW 2021)",
    inputs: "Uneseno",
    unitGPerMol: "g/mol",
    errorFormula:
      "Formulu nije moguće pročitati. Proveri zagrade, indekse i tačku za hidrat " +
      "(CuSO4·5H2O).",
    errorElement:
      "Za element {symbol} nema standardne atomske mase u tabeli koju alatka koristi.",
  },

  "molarity-to-mass": {
    mode: "Režim",
    modeMassForSolution: "Masa za rastvor poznate koncentracije",
    modeConcentrationFromMass: "Koncentracija iz odmerene mase",
    concentration: "Koncentracija",
    volume: "Zapremina rastvora",
    molarMass: "Molarna masa",
    molarMassHint:
      "U gramima po molu. Uzmi je iz tabele ili je izračunaj u alatki Molarna masa.",
    mass: "Odmerena masa",
    results: "Rezultat",
    volumeL: "Zapremina",
    moles: "Količina supstance",
    massG: "Masa",
    concentrationOut: "Koncentracija rastvora",
    formulaLine: "n = c·V     m = n·M     V u litrima",
    inputs: "Uneseno",
    unitMl: "ml",
    unitL: "l",
    unitG: "g",
    unitMol: "mol",
    unitMolPerL: "mol/l",
    unitGPerMol: "g/mol",
    errorVolume: "Zapremina mora biti veća od nule.",
    errorMolarMass: "Molarna masa mora biti veća od nule.",
    errorConcentration: "Koncentracija mora biti veća od nule.",
    errorMass: "Masa mora biti veća od nule.",
  },

  "dilution": {
    mode: "Režim",
    modeSolveForVolume: "Iz poznate zapremine matičnog rastvora",
    modeSolveForStockVolume: "Iz željene ukupne zapremine",
    stockConcentration: "Koncentracija matičnog rastvora",
    stockVolume: "Zapremina matičnog rastvora",
    targetConcentration: "Ciljna koncentracija",
    targetVolume: "Ciljna ukupna zapremina",
    conventionNote:
      "Zapremine su zapremine gotovog rastvora — onoliko koliko staje u posudu, a ne količina " +
      "dodate tečnosti.",
    results: "Rezultat",
    stockVolumeOut: "Uzeti matični rastvor",
    targetVolumeOut: "Ukupna zapremina rastvora",
    solventToAdd: "Dodati rastvarača",
    dilutionFactor: "Faktor razblaženja",
    formulaLine: "C1·V1 = C2·V2     faktor = C1/C2",
    inputs: "Uneseno",
    unitMl: "ml",
    errorStockConcentration: "Koncentracija matičnog rastvora mora biti veća od nule.",
    errorStockVolume: "Zapremina matičnog rastvora mora biti veća od nule.",
    errorTargetConcentration: "Ciljna koncentracija mora biti veća od nule.",
    errorTargetVolume: "Ciljna ukupna zapremina mora biti veća od nule.",
    errorTargetOutOfRange:
      "Ciljna koncentracija je viša od koncentracije matičnog rastvora — dolivanjem " +
      "rastvarača se ne dobija jači rastvor.",
  },

  "concentration-units": {
    value: "Vrednost",
    unit: "Jedinica",
    molarMass: "Molarna masa",
    molarMassHint:
      "Potrebna je samo za mol/l i mmol/l. Bez nje alatka te redove ostavlja prazne.",
    unitMolPerL: "mol/l",
    unitMillimolPerL: "mmol/l",
    unitGramPerL: "g/l",
    unitMilligramPerMl: "mg/ml",
    unitPercent: "procenat (m/v)",
    unitPpm: "ppm",
    unitPpb: "ppb",
    notAvailable: "—",
    results: "Rezultat",
    colUnit: "Jedinica",
    colValue: "Vrednost",
    basisNote:
      "Procenat je procenat mase u zapremini (grami na 100 ml), a ppm i ppb su maseno-zapreminski " +
      "u razblaženom vodenom rastvoru, gde se litra vode uzima kao kilogram.",
    formulaLine: "osnova je g/l:     1 % = 10 g/l     1 ppm = 1 mg/l     1 ppb = 1 µg/l",
    inputs: "Uneseno",
    errorValue: "Vrednost mora biti broj, nula ili veći.",
    errorMolarMass: "Molarna masa mora biti veća od nule kad je jedinica mol/l ili mmol/l.",
  },

  "ph-strong-acid-base": {
    mode: "Režim",
    modeAcid: "Jaka kiselina",
    modeBase: "Jaka baza",
    concentration: "Analitička koncentracija",
    groups: "Broj grupa koje se jonizuju",
    groupsHint:
      "Po formuli supstance: 1 za HCl, 2 za H2SO4 i za Ca(OH)2, 3 za H3PO4. Nije unapred " +
      "postavljen nijedan broj.",
    idealisationNote:
      "Račun pretpostavlja potpunu disocijaciju i temperaturu od 25 °C. U vrlo razblaženim i " +
      "vrlo koncentrovanim rastvorima ta pretpostavka ne opisuje stanje.",
    results: "Rezultat",
    ph: "pH",
    poh: "pOH",
    ionConcentration: "Koncentracija jona",
    pIon: "p vrednost jona",
    formulaLine: "pH = −log₁₀(c·n)     pH = 14 − (−log₁₀(c·n)) za bazu",
    inputs: "Uneseno",
    unitMolPerL: "mol/l",
    errorConcentration: "Koncentracija mora biti broj veći od nule.",
    errorGroups: "Broj grupa koje se jonizuju je ceo broj od 1 do 3.",
  },

  "buffer-ph": {
    mode: "Režim",
    modePhFromRatio: "pH iz odnosa kiselina-baza",
    modeRatioForPh: "Odnos za željeni pH",
    pka: "pKa kiseline",
    pkaHint:
      "Iz tabele za kiselinu koju koristiš. Nexus ne zna koji je to podatak i ne nudi vrednost.",
    acidConcentration: "Koncentracija kiselinskog oblika",
    baseConcentration: "Koncentracija baznog oblika",
    targetPh: "Željeni pH",
    results: "Rezultat",
    ph: "pH",
    ratio: "Odnos baznog i kiselinskog oblika",
    logRatio: "log₁₀ odnosa",
    formulaLine: "pH = pKa + log₁₀([A⁻]/[HA])     [A⁻]/[HA] = 10^(pH − pKa)",
    inputs: "Uneseno",
    errorPka: "pKa mora biti broj između −10 i 30.",
    errorAcid: "Koncentracija kiselinskog oblika mora biti veća od nule.",
    errorBase: "Koncentracija baznog oblika mora biti veća od nule.",
    errorTargetPh: "Željeni pH je broj između 0 i 14.",
  },
} as const;
