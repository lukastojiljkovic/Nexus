/**
 * „Laboratorija" — the English copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment spells the
 * registration. The tool's NAME and its one-line blurb are not here: those live
 * in a different table another process owns.
 *
 * **Four of these tools carry an absolute discipline.** `molarity-to-mass`,
 * `dilution`, `ph-strong-acid-base` and `buffer-ph` may name a quantity and the
 * user's own figures, and may never say what they mean together — no „safe", no
 * „correct", no verdict of any kind, anywhere in this file.
 *
 * **A unit is copy, not a constant.** „g", „mol/L" and „ppm" are written here
 * rather than concatenated in the surface.
 */
export const PRO_LABORATORIJA_EN = {
  "molar-mass": {
    formula: "Chemical formula",
    formulaHint:
      "e.g. H2O, Ca(OH)2, Al2[SO4]3 or CuSO4·5H2O. Brackets and the hydrate dot are read, and " +
      "letter case separates the elements.",
    results: "Result",
    molarMass: "Molar mass",
    totalAtoms: "Total atoms",
    colElement: "Element",
    colCount: "Atoms",
    colMass: "Mass",
    colShare: "Share",
    formulaLine: "M = Σ nᵢ·Arᵢ     Ar from the standard atomic weights (CIAAW 2021)",
    inputs: "Entered",
    unitGPerMol: "g/mol",
    errorFormula:
      "The formula cannot be read. Check the brackets, the subscripts and the hydrate dot " +
      "(CuSO4·5H2O).",
    errorElement:
      "There is no standard atomic weight for {symbol} in the table this tool uses.",
  },

  "molarity-to-mass": {
    mode: "Mode",
    modeMassForSolution: "Mass for a solution of known concentration",
    modeConcentrationFromMass: "Concentration from a weighed mass",
    concentration: "Concentration",
    volume: "Volume of solution",
    molarMass: "Molar mass",
    molarMassHint: "In grams per mole. Take it from a table or work it out with Molar mass.",
    mass: "Weighed mass",
    results: "Result",
    volumeL: "Volume",
    moles: "Amount of substance",
    massG: "Mass",
    concentrationOut: "Concentration of the solution",
    formulaLine: "n = c·V     m = n·M     V in litres",
    inputs: "Entered",
    unitMl: "ml",
    unitL: "l",
    unitG: "g",
    unitMol: "mol",
    unitMolPerL: "mol/L",
    unitGPerMol: "g/mol",
    errorVolume: "The volume must be greater than zero.",
    errorMolarMass: "The molar mass must be greater than zero.",
    errorConcentration: "The concentration must be greater than zero.",
    errorMass: "The mass must be greater than zero.",
  },

  "dilution": {
    mode: "Mode",
    modeSolveForVolume: "From a known volume of stock",
    modeSolveForStockVolume: "From the final volume wanted",
    stockConcentration: "Concentration of the stock",
    stockVolume: "Volume of stock",
    targetConcentration: "Target concentration",
    targetVolume: "Target final volume",
    conventionNote:
      "The volumes are the volumes of the finished solution — what fits in the flask, not how " +
      "much liquid was poured in.",
    results: "Result",
    stockVolumeOut: "Stock to measure out",
    targetVolumeOut: "Final volume of solution",
    solventToAdd: "Solvent to add",
    dilutionFactor: "Dilution factor",
    formulaLine: "C1·V1 = C2·V2     factor = C1/C2",
    inputs: "Entered",
    unitMl: "ml",
    errorStockConcentration: "The concentration of the stock must be greater than zero.",
    errorStockVolume: "The volume of stock must be greater than zero.",
    errorTargetConcentration: "The target concentration must be greater than zero.",
    errorTargetVolume: "The target final volume must be greater than zero.",
    errorTargetOutOfRange:
      "The target concentration is above the stock's — adding solvent never makes a solution " +
      "stronger.",
  },

  "concentration-units": {
    value: "Value",
    unit: "Unit",
    molarMass: "Molar mass",
    molarMassHint:
      "Needed for mol/L and mmol/L only. Without it the tool leaves those rows blank.",
    unitMolPerL: "mol/L",
    unitMillimolPerL: "mmol/L",
    unitGramPerL: "g/L",
    unitMilligramPerMl: "mg/mL",
    unitPercent: "percent (w/v)",
    unitPpm: "ppm",
    unitPpb: "ppb",
    notAvailable: "—",
    results: "Result",
    colUnit: "Unit",
    colValue: "Value",
    basisNote:
      "Percent is mass over volume (grams per 100 ml), and ppm and ppb are mass over volume in a " +
      "dilute aqueous solution, where a litre of water is taken as a kilogram.",
    formulaLine: "the base is g/L:     1% = 10 g/L     1 ppm = 1 mg/L     1 ppb = 1 µg/L",
    inputs: "Entered",
    errorValue: "The value must be a number, zero or greater.",
    errorMolarMass: "The molar mass must be greater than zero when the unit is mol/L or mmol/L.",
  },

  "ph-strong-acid-base": {
    mode: "Mode",
    modeAcid: "Strong acid",
    modeBase: "Strong base",
    concentration: "Analytical concentration",
    groups: "Ionisable groups per formula unit",
    groupsHint:
      "From the substance's formula: 1 for HCl, 2 for H2SO4 and for Ca(OH)2, 3 for H3PO4. No " +
      "number is entered for you.",
    idealisationNote:
      "The calculation assumes complete dissociation and a temperature of 25 °C. In very dilute " +
      "and very concentrated solutions that assumption does not describe the state.",
    results: "Result",
    ph: "pH",
    poh: "pOH",
    ionConcentration: "Ion concentration",
    pIon: "p of the ion",
    formulaLine: "pH = −log₁₀(c·n)     pH = 14 − (−log₁₀(c·n)) for a base",
    inputs: "Entered",
    unitMolPerL: "mol/L",
    errorConcentration: "The concentration must be a number greater than zero.",
    errorGroups: "The number of ionisable groups is a whole number from 1 to 3.",
  },

  "buffer-ph": {
    mode: "Mode",
    modePhFromRatio: "pH from the acid-base ratio",
    modeRatioForPh: "Ratio for a wanted pH",
    pka: "pKa of the acid",
    pkaHint: "From the table for the acid you are using. Nexus does not know it and offers no figure.",
    acidConcentration: "Concentration of the acid form",
    baseConcentration: "Concentration of the base form",
    targetPh: "Wanted pH",
    results: "Result",
    ph: "pH",
    ratio: "Base-to-acid ratio",
    logRatio: "log₁₀ of the ratio",
    formulaLine: "pH = pKa + log₁₀([A⁻]/[HA])     [A⁻]/[HA] = 10^(pH − pKa)",
    inputs: "Entered",
    errorPka: "pKa must be a number between −10 and 30.",
    errorAcid: "The concentration of the acid form must be greater than zero.",
    errorBase: "The concentration of the base form must be greater than zero.",
    errorTargetPh: "The wanted pH is a number between 0 and 14.",
  },
} as const;
