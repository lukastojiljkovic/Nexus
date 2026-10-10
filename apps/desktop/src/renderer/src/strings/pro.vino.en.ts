/**
 * "Wine & spirits" - the English copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. Calculations only: nothing here says how much to drink or what
 * a wine should contain.
 */
export const PRO_VINO_EN = {
  "must-sugar": {
    brix: "Brix (refractometer)",
    brixHint: "The refractometer reading, in °Bx.",
    sg: "Specific gravity (hydrometer)",
    sgHint: "The hydrometer reading - for example 1,090, not 90.",
    volume: "Volume of must",
    volumeHint: "In litres. Without it only concentrations are given.",
    yieldFactor: "Fermentation yield",
    yieldFactorHint:
      "Grams of ethanol per gram of sugar. The theoretical maximum is 0,511; in practice " +
      "0,46 to 0,47. Leave empty for the theoretical one.",
    results: "Result",
    oechsle: "Oechsle",
    sugarPer100g: "Sugar in the must",
    sugarPerL: "Sugar per litre",
    sugarKg: "Total sugar",
    potentialAbv: "Potential alcohol",
    yieldUsed: "Yield used",
    yieldTheoretical: "theoretical",
    yieldGiven: "entered",
    perPercent: "Sugar for 1 % of alcohol",
    formula:
      "°Oe = (SG − 1)·1000     c = Bx·10·SG     ABV = c·y / 7,893     y = yield, g/g",
    note:
      "The concentration in g/L needs both readings: the refractometer gives the mass " +
      "fraction and the hydrometer the density. Brix is not converted to specific gravity.",
    inputs: "Entered",
    errorBrix: "Brix is a number from 0 to 60.",
    errorSg: "Specific gravity is a number from 0,9 to 1,3.",
    errorVolume: "The volume is a number above zero.",
    errorYield: "The yield is a number from 0,3 to 0,55 g/g.",
    errorEmpty: "Give at least one reading - Brix or specific gravity.",
    unitBrix: "°Bx",
    unitOe: "°Oe",
    unitGPerL: "g/L",
    unitGPer100g: "g/100 g",
    unitKg: "kg",
    unitPercent: "% v/v",
  },

  "sugar-addition": {
    volume: "Volume of must",
    volumeHint: "In litres.",
    current: "Sugar already in the must",
    currentHint: "In g/L. For a dry must leave 0, or empty.",
    target: "Target alcohol",
    targetHint: "The potential alcohol wanted, in % v/v.",
    yieldFactor: "Fermentation yield",
    yieldFactorHint:
      "Grams of ethanol per gram of sugar. Leave empty for the theoretical 0,511; in " +
      "practice 0,46 to 0,47.",
    results: "Result",
    required: "Sugar needed per litre",
    additionPerL: "Addition per litre",
    additionKg: "Total sugar to add",
    totalKg: "Total sugar in the must",
    negativeNote:
      "A negative value means the must already carries more sugar than the target asks for.",
    formula: "c_target = ABV·7,893 / y     addition = c_target − c_current     m = addition·V/1000",
    inputs: "Entered",
    errorVolume: "The volume is a number above zero.",
    errorCurrent: "The sugar in the must is a number from 0 to 500 g/L.",
    errorTarget: "The target alcohol is a number from 0,1 to 25 % v/v.",
    errorYield: "The yield is a number from 0,3 to 0,55 g/g.",
    unitL: "l",
    unitGPerL: "g/L",
    unitKg: "kg",
    unitPercent: "% v/v",
  },

  "abv-gravity": {
    og: "Original gravity (OG)",
    ogHint: "Specific gravity before fermentation, for example 1,050.",
    fg: "Final gravity (FG)",
    fgHint: "Specific gravity after fermentation, for example 1,010.",
    results: "Result",
    drop: "Gravity drop",
    abv: "Alcohol by volume",
    abw: "Alcohol by weight",
    attenuation: "Apparent attenuation",
    formula:
      "ABV = (OG − FG)·131,25     ABW = (OG − FG)·105     attenuation = (OG − FG)/(OG − 1)·100",
    note:
      "Both are linear rules from the Balling/Plato scale: accurate over the ordinary brewing " +
      "range and drifting at the extremes.",
    inputs: "Entered",
    errorOg: "Original gravity is a number from 1 to 1,3.",
    errorFg: "Final gravity is a number from 0,98 to 1,3 and not above the original.",
    unitPercent: "% v/v",
    unitPercentW: "% w/w",
    unitPercentAtten: "%",
  },

  "spirit-dilution": {
    direction: "Direction",
    directionDilute: "diluting",
    directionFortify: "fortifying",
    current: "Current strength",
    currentHint: "In % v/v.",
    target: "Target strength",
    targetHint: "In % v/v.",
    volume: "Volume in the vessel",
    volumeHint: "In litres.",
    addedStrength: "Strength of what is added",
    addedStrengthHint: "Leave 0 for water. For a spirit enter its own strength, in % v/v.",
    results: "Result",
    addedVolume: "To add",
    finalVolume: "Volume after the addition",
    alcohol: "Alcohol in the vessel",
    formula: "V₁·C₁ + V_a·C_a = (V₁ + V_a)·C₂",
    note:
      "This is the simple mixing equation and the contraction is not applied - ethanol and " +
      "water do not add volumes linearly, and the OIML tables for that are not in Nexus.",
    inputs: "Entered",
    errorDirection: "Choose a direction.",
    errorCurrent: "The current strength is a number from 0 to 96 % v/v.",
    errorTarget: "The target strength is a number from 0 to 96 % v/v.",
    errorVolume: "The volume is a number above zero.",
    errorAdded: "The added strength is a number from 0 to 96 % v/v.",
    errorTargetDilute: "To dilute, the target has to be below the current strength.",
    errorTargetFortify: "To fortify, the target has to be above the current strength.",
    errorAddedBelowTarget: "The addition has to be weaker than the target - otherwise it is unreachable.",
    errorAddedAboveTarget: "The addition has to be stronger than the target - otherwise it is unreachable.",
    unitL: "l",
    unitPercent: "% v/v",
  },

  "sulfite": {
    mode: "What is given",
    modeFromMetabisulfite: "an amount of metabisulfite",
    modeFromSo2: "an amount of SO₂",
    metabisulfite: "Potassium metabisulfite",
    metabisulfiteHint: "Mass, in grams.",
    so2: "Sulfur dioxide SO₂",
    so2Hint: "Mass, in grams.",
    volume: "Volume",
    volumeHint: "In litres. Without it only the masses are given.",
    results: "Result",
    so2Mass: "SO₂ from this amount",
    metabisulfiteMass: "Metabisulfite for this amount",
    so2PerL: "SO₂ per litre",
    metabisulfitePerL: "Metabisulfite per litre",
    fraction: "SO₂ share of the metabisulfite",
    formula: "K₂S₂O₅ → 2 SO₂     m(SO₂) = m(K₂S₂O₅) · 2·M(SO₂) / M(K₂S₂O₅)",
    note:
      "This is the mass of SO₂ added, not the free SO₂ in the wine: part of it binds, and how " +
      "much stays free depends on the wine and its acidity.",
    inputs: "Entered",
    errorMode: "Choose what is given.",
    errorMetabisulfite: "The metabisulfite mass is a number of 0 g or more.",
    errorSo2: "The SO₂ mass is a number of 0 g or more.",
    errorVolume: "The volume is a number above zero.",
    errorKnown: "Give either the metabisulfite or the SO₂ - not both.",
    unitG: "g",
    unitMgPerL: "mg/L",
    unitL: "l",
  },
} as const;
