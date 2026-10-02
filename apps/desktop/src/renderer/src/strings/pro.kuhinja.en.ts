/**
 * „Kuhinja i pekara" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment spells the
 * registration. The tool's NAME and its one-line blurb are not here: those
 * live in a different table another process owns.
 *
 * **Two tools in this pack carry an absolute discipline.** `brine-salt`
 * (food-safety) and `solution-concentration` (life-safety) may name a
 * quantity and the user's own limit, and may never say what the two mean
 * together — no „bezbedno", no „dovoljno", no „ispravno", no verdict of any
 * kind, anywhere in this file.
 *
 * **A unit is copy, not a constant.** „g" and „ml" are written here rather
 * than concatenated in the surface, so a translator can find every one of
 * them and a raw string never hides inside a component.
 */
export const PRO_KUHINJA_EN = {
  "backwards-timeline": {
    serviceTime: "Serving time",
    serviceTimeHint: "The hour the dish must be on the table, HH:MM, 24-hour.",
    serviceDate: "Serving date",
    serviceDateHint:
      "Optional — only so the day label is a concrete date rather than “−1 day”. Without this field today is not assumed.",
    steps: "Preparation steps",
    stepsHint:
      "One row per step, in the order they are performed: name;duration. A duration of “12” is 12 minutes, and “12:00” is 12 hours — a colon chooses hours and minutes, a bare number chooses minutes.",
    buffer: "Reserve before serving",
    bufferHint:
      "Minutes of free time between the last step and serving. An empty field means there is no reserve.",

    results: "Result",
    colStep: "Step",
    colStart: "Start",
    colEnd: "End",
    colMinutes: "Duration (min)",
    bufferRowName: "Reserve",
    totalLabel: "Total preparation duration",
    jobStart: "The whole job begins",
    wallClockNote:
      "The tool calculates in wall-clock time. It shifts nothing for daylight-saving changes.",
    dayWordOne: "day",
    dayWordMany: "days",

    inputs: "Entered",
    formula:
      "offset_i = −(reserve + Σd_j, j=i..n)     time = ((serving + offset) mod 1440), floor division",

    errorServiceTime: "The serving time must be in the form HH:MM, 24-hour.",
    errorServiceDate:
      "The serving date must be in the form YYYY-MM-DD and must exist in the calendar.",
    errorSteps: "Enter at least one step.",
    errorBuffer: "The reserve is a whole number of minutes, zero or more.",
    errorStepDuration:
      "The step duration was not recognised. A colon chooses hours and minutes (12:00 = 12 hours), a bare number chooses minutes (12 = 12 minutes).",
  },

  "bakers-percentage": {
    mode: "Mode",
    modeWeightsToPercent: "Weights → percentages",
    modePercentToWeights: "Percentages → weights",
    lines: "Recipe items",
    linesHint:
      "One row per ingredient: name;role;value. The role is one of the words “flour”, “water”, “other” or “pre-ferment” — the value is mass in grams (mode 1) or a percentage of the flour (mode 2). A pre-ferment is not split here: the tool refuses it and points to “Hydration and starter”.",
    targetMode: "Target",
    targetModeMass: "Target dough mass",
    targetModePieces: "Number of pieces",
    pieces: "Number of pieces",
    bakedPieceMass: "Mass of the baked piece",
    bakeLoss: "Baking loss",
    bakeLossHint: "The percentage of mass the piece loses in the oven, measured in your own oven.",

    results: "Result",
    colName: "Ingredient",
    colRole: "Role",
    colPercent: "%",
    colWeight: "Mass",
    roleFlour: "flour",
    roleWater: "water",
    roleOther: "other",
    rolePreferment: "pre-ferment",
    totalPercent: "Sum of percentages",
    flourWeight: "Flour mass",
    doughMass: "Dough mass",
    hydration: "Hydration",
    hydrationNote:
      "Only rows marked as water are counted — milk, eggs and oil enter only if marked as such.",
    rawPieceMass: "Mass of the raw piece",

    inputs: "Entered",
    formula:
      "mode 1: p_i = w_i/F·100, D=Σw_i     mode 2: F=D/(Σp/100), w_i=F·p_i/100     pieces: raw=baked/(1−L/100)",

    errorLines: "Enter at least one ingredient.",
    errorLineValue: "Every ingredient's value must be zero or more.",
    errorPreferment:
      "A pre-ferment is neither flour nor water — split it with the “Hydration and starter” tool, then enter the resulting flour and water as separate rows.",
    errorFlour: "At least one row must be marked as flour, with a mass or percentage greater than zero.",
    errorDoughMass: "The target dough mass must be greater than zero.",
    errorPieces: "The number of pieces is a whole number, 1 or more.",
    errorBakedPieceMass: "The mass of the baked piece must be greater than zero.",
    errorBakeLoss: "Baking loss is a percentage from 0 to below 100.",
    errorFlourPercentSum:
      "In the “percentages → weights” mode the rows marked as flour must sum to exactly 100%.",

    unitG: "g",
  },

  "brine-salt": {
    mode: "Mode",
    modeBrine: "Equilibrium brine",
    modeDryCure: "Dry curing",
    modeConcentration: "Concentration of an existing brine",
    basis: "Percentage basis",
    basisFoodAndWater: "% of meat and water",
    basisTotalWithSalt: "% of the total mass with salt",
    foodMass: "Mass of meat or vegetables",
    waterMass: "Mass of water",
    waterMassHint: "Entered as mass, not volume, so the density of water is not assumed.",
    saltPercent: "Target salt percentage",
    dissolvedSalt: "Salt already dissolved in the brine",
    sugarPercent: "Target sugar percentage",
    sugarPercentHint: "Optional, on the same basis as the salt. Calculated independently of the salt.",
    percentLimit: "Your limit",
    percentLimitHint:
      "From the regulation you apply. Neagle does not know which regulation that is and offers no value.",

    results: "Result",
    saltMass: "Mass of salt",
    sugarMass: "Mass of sugar",
    totalMass: "Total mass of the brine with the food",
    percentOfBase: "Salt as % of meat and water",
    percentOfTotal: "Salt as % of the total mass with salt",
    selectedPercent: "Salt on the chosen basis",
    percentRatio: "Ratio to your limit",

    inputs: "Entered",
    formula:
      "% of meat and water: S=(M+W)·p/100     % of the total with salt: S=(M+W)·p/(100−p)     concentration: p=S/(S+W)·100",

    errorWaterMass: "The mass of water must be greater than zero.",
    errorDissolvedSalt: "The salt already dissolved in the brine may not be negative.",
    errorFoodMass: "The mass of meat or vegetables must be greater than zero.",
    errorSaltPercent: "The target salt percentage is a number strictly between 0 and 100.",
    errorSugarPercent:
      "The target sugar percentage is a number from 0 to below 100, and the sum with the salt percentage may not reach 100 on the “% of the total” basis.",

    unitG: "g",
  },

  "coffee-extraction": {
    dose: "Dose of ground coffee",
    brewWater: "Brew water",
    brewWaterHint: "Optional in espresso, where it is not measured separately.",
    beverageMass: "Mass of the drink in the cup",
    tds: "TDS (dissolved solids)",
    tdsHint: "A percentage by mass, measured with a refractometer, already corrected by your instrument's factor.",
    targetRatio: "Target water-to-dose ratio (1:x)",

    results: "Result",
    waterRatio: "Ratio water ÷ dose",
    beverageRatio: "Ratio drink ÷ dose",
    extractionYield: "Extraction percentage",
    dissolved: "Dissolved solids in the cup",
    retained: "Water retained in the grounds",
    weighingShortfall: "Difference the measurements do not explain",
    weighingShortfallNote:
      "The drink is heavier than the brew water used — the two measurements do not agree, so the retained water is not shown.",
    waterForTarget: "Water for the given ratio",

    inputs: "Entered",
    formula:
      "water÷dose = water/dose     drink÷dose = drink/dose     extraction% = drink·TDS/dose     retained = water−drink",

    errorDose: "The dose of ground coffee must be greater than zero.",
    errorBeverageMass: "The mass of the drink in the cup must be greater than zero.",
    errorTds: "TDS is a percentage strictly between 0 and 100.",
    errorBrewWater: "The brew water must be greater than zero.",
    errorTargetRatio: "The target ratio must be greater than zero.",

    unitG: "g",
  },

  "dough-water-temp": {
    mode: "Mode",
    modeWaterTemperature: "Water temperature",
    modeFrictionFactor: "Friction factor from a measured batch",
    flourTemp: "Flour temperature",
    roomTemp: "Room temperature",
    hasPreferment: "Pre-ferment in the batch",
    hasPrefermentNo: "No pre-ferment",
    hasPrefermentYes: "Has a pre-ferment",
    prefermentTemp: "Pre-ferment temperature",
    desiredDoughTemp: "Desired dough temperature",
    frictionFactor: "Friction factor",
    frictionFactorHint: "The baker measures it for their own mixer, their own batch and their own mixing time.",
    frictionN: "N at which the friction factor was measured",
    frictionNHint:
      "The friction factor holds only for the N at which it was measured — with the same mixer, batch size and mixing time. N=3 is flour+room, N=4 adds the pre-ferment.",
    frictionN3: "N=3 (without pre-ferment)",
    frictionN4: "N=4 (with pre-ferment)",
    availableWaterTemp: "The highest water temperature you have",
    measuredDoughTemp: "Measured dough temperature",
    measuredWaterTemp: "Measured water temperature",

    results: "Result",
    multiplier: "Multiplier N",
    components: "Summed temperatures",
    waterTemp: "Required water temperature",
    belowFreezingNote:
      "Water at this temperature is not liquid at atmospheric pressure — this batch cannot be made with water alone.",
    availableDelta: "Difference (required − available)",

    inputs: "Entered",
    formula:
      "water = N·desired_temp − Σ(components + friction)     friction = N·measured_dough − Σ(components + measured_water)",

    errorFlourTemp: "The flour temperature is a number from −10 to 60 °C.",
    errorRoomTemp: "The room temperature is a number from −10 to 60 °C.",
    errorPrefermentTemp: "The pre-ferment temperature is a number from −10 to 60 °C.",
    errorDesiredDoughTemp: "The desired dough temperature is a number from −10 to 60 °C.",
    errorFrictionFactor: "The friction factor is a number from 0 to 40 °C.",
    errorFrictionFactorMeasuredAtN:
      "The N at which the friction factor was measured must match this batch — with a pre-ferment N=4, without it N=3.",
    errorAvailableWaterTemp: "The highest water temperature you have is a number from −10 to 60 °C.",
    errorMeasuredDoughTemp: "The measured dough temperature is a number from −10 to 60 °C.",
    errorMeasuredWaterTemp: "The measured water temperature is a number from −10 to 60 °C.",

    unitC: "°C",
  },

  "ice-cream-overrun": {
    mode: "Mode",
    modeFromWeighings: "From two measurements of the same container",
    modeFromTarget: "From a given overrun",
    grossMixMass: "Mass of the container with mix",
    grossFrozenMass: "Mass of the container with finished ice cream",
    tare: "Container tare",
    tareHint:
      "A required field — with the tare left in both masses the calculated overrun is silently smaller than the real one. Both fillings must reach the same level in the same container.",
    targetOverrun: "Target overrun",
    mixVolume: "Mix volume",
    mixDensity: "Mix density",
    tubVolume: "Package volume",

    results: "Result",
    overrun: "Overrun",
    netMixMass: "Net mass of the mix",
    netFrozenMass: "Net mass of the finished product",
    frozenVolume: "Volume of the finished ice cream",
    finishedMassPerLitre: "Mass of the finished product per litre",
    tubNetWeight: "Net weight of the package",

    inputs: "Entered",
    formula:
      "overrun% = (m_mix−m_frozen)/m_frozen·100     V_out = V_in·(1+OR/100)     density_finished = density_mix/(1+OR/100)",

    errorGrossMixMass: "The mass of the container with mix must be greater than zero.",
    errorGrossFrozenMass: "The mass of the container with finished ice cream must be greater than zero.",
    errorTare: "The tare may not be negative or greater than or equal to either of the two masses.",
    errorTargetOverrun: "The target overrun must be greater than −100%.",
    errorMixVolume: "The mix volume must be greater than zero.",
    errorMixDensity: "The mix density must be greater than zero.",
    errorTubVolume: "The package volume must be greater than zero, and the mix density must be entered.",

    unitG: "g",
    unitL: "l",
    unitGPerL: "g/l",
  },

  "lamination-layers": {
    folds: "Sequence of folds",
    foldsHint:
      "One row per fold, in the order they are performed: kind or kind;thickness after rolling in mm. The kind is one of the words “single” (×3), “book” (×4) or “half” (×2). The thickness after rolling is optional — without it the row stays only folded, without rolling.",
    startingFatLayers: "Initial number of fat layers",
    startingFatLayersHint: "An empty field means 1 — one block of fat enclosed in dough.",
    fatMass: "Mass of fat",
    doughMass: "Mass of dough around the fat",
    finalThickness: "Final thickness of the laminated dough",
    startThickness: "Initial thickness",
    startLength: "Initial length",

    results: "Result",
    fatLayers: "Number of fat layers",
    doughLayers: "Number of dough layers",
    fatLayerMicrons: "Thickness of one fat layer",
    doughLayerMicrons: "Thickness of one dough layer",
    colFold: "Fold",
    colFoldedThickness: "Thickness after folding",
    colFoldedLength: "Length after folding",
    colRolledThickness: "Thickness after rolling",
    colRolledLength: "Length after rolling",
    foldLetter: "single",
    foldBook: "book",
    foldHalf: "half",
    constantWidthNote: "The length-to-thickness relation in rolling holds only at constant strip width.",

    inputs: "Entered",
    formula:
      "B=B₀·Πf_i     D=B+1     φ=fat_mass/(fat_mass+dough_mass)     t_fat=t·φ/B     t_dough=t·(1−φ)/D",

    errorFolds:
      "Enter at least one fold, each recognised as “single”, “book” or “half”.",
    errorStartingFatLayers: "The initial number of fat layers is a whole number, 1 or more.",
    errorFinalThickness:
      "The final thickness must be greater than zero and not greater than the thickness reached at the end of the folding and rolling sequence.",
    errorFatMass: "The mass of fat must be greater than zero.",
    errorDoughMass: "The mass of dough around the fat must be greater than zero.",
    errorStartThickness: "The initial thickness must be greater than zero.",
    errorStartLength: "The initial length must be greater than zero.",
    errorRollThickness:
      "The thickness after rolling must be greater than zero and less than the thickness immediately after that fold.",

    unitMm: "mm",
    unitCm: "cm",
    unitUm: "µm",
    unitG: "g",
  },

  "levain-hydration": {
    mode: "Mode",
    modeCorrectDough: "Correct the dough",
    modeBuildLevain: "Make a starter",
    totalFlour: "Total flour in the finished dough",
    totalFlourHint: "Includes the flour the starter carries, not only the flour added later.",
    targetHydration: "Target overall hydration",
    levainMass: "Mass of the starter or pre-ferment",
    levainHydration: "Starter hydration",
    seedMass: "Seed mass",
    seedHydration: "Seed hydration",
    targetLevainMass: "Target starter mass",
    targetLevainHydration: "Target starter hydration",

    results: "Result",
    levainFlour: "Flour the starter contributes",
    levainWater: "Water the starter contributes",
    addedFlour: "Flour still to add",
    addedWater: "Water still to add",
    doughMass: "Total dough mass without salt and additions",
    achievedHydration: "Achieved overall hydration",

    inputs: "Entered",
    formula:
      "f=mass/(1+h/100), w=mass−f     added_flour=F_total−f_starter     added_water=W_total−w_starter",

    errorTotalFlour: "The total flour in the finished dough must be greater than zero.",
    errorTargetHydration: "The target overall hydration must be greater than zero.",
    errorLevainMass: "The starter mass may not be negative or greater than the total dough mass.",
    errorLevainHydration: "The starter hydration must be greater than zero.",
    errorSeedMass: "The seed mass may not be negative.",
    errorSeedHydration: "The seed hydration must be greater than zero.",
    errorTargetLevainMass: "The target starter mass must be greater than the seed mass.",
    errorTargetLevainHydration: "The target starter hydration must be greater than zero.",
    errorFlourOver:
      "The starter already carries more flour than the formula allows — reduce its mass or hydration.",
    errorWaterOver:
      "The starter already carries more water than the target hydration allows — reduce its mass or hydration.",

    unitG: "g",
  },

  "nutrition-per-portion": {
    direction: "Direction",
    directionPer100ToPortion: "Per 100 g → per serving",
    directionPortionToPer100: "Per serving → per 100 g",
    energy: "Energy",
    energyUnit: "Energy unit",
    fat: "Fat",
    satFat: "of which saturated fat",
    carbs: "Carbohydrate",
    sugars: "of which sugars",
    fiber: "Fibre",
    protein: "Protein",
    salt: "Salt",
    portionMass: "Serving mass",
    packageMass: "Package mass",
    packageMassHint:
      "Optional. If the number of servings per package is also entered, the two must agree.",
    portionsPerPackage: "Number of servings per package",
    referencePrefix: "Reference daily intake —",
    referenceHint: "From the regulation you apply. Neagle has no table and offers no value.",
    digits: "Number of decimals to show",
    digitsHint:
      "A display choice, not rounding of a legal declaration — what and how it must appear on the package is set by a regulation this tool does not know.",

    results: "Result",
    energyKJ: "Energy (kJ) — per 100 g / per serving",
    energyKcal: "Energy (kcal) — per 100 g / per serving",
    colNutrient: "Substance",
    colPer100: "Per 100 g",
    colPerPortion: "Per serving",
    colPerPackage: "Per package",
    colReferencePercent: "% of reference",
    notADeclarationNote:
      "This is an auxiliary conversion, not a finished declaration. No value comes from the tool — the user entered them all, and the tool only converts them. What must appear on the package is set by a regulation this tool does not know and does not check.",

    inputs: "Entered",
    formula:
      "per_serving = per_100g·serving_mass/100     kcal = kJ/4.184     % of reference = per_serving/reference·100",

    errorPortionMass: "The serving mass must be greater than zero.",
    errorEnergy: "Energy may not be negative.",
    errorNutrientValue: "Every substance value may not be negative.",
    errorReference: "The reference daily intake may not be negative.",
    errorPackageMass: "The package mass must be greater than zero.",
    errorPortionsPerPackage: "The number of servings per package is a whole number, 1 or more.",
    errorPackage: "The package mass and the number of servings per package do not agree with the serving mass.",

    unitG: "g",
    unitKj: "kJ",
    unitKcal: "kcal",
  },

  "pan-area-volume": {
    sectionA: "Mould or container A",
    sectionB: "Mould or container B",
    shapeKind: "Form",
    shapeCircle: "Circle (diameter)",
    shapeSquare: "Square (side)",
    shapeRect: "Rectangle (a × b)",
    shapeRing: "Ring (outer/inner diameter)",
    diameter: "Diameter",
    side: "Side",
    a: "Dimension a",
    b: "Dimension b",
    outer: "Outer diameter",
    inner: "Inner diameter",
    hasShapeB: "Conversion for the second mould",
    hasShapeBNo: "Not needed",
    hasShapeBYes: "Needed",
    batterMassA: "Mass of mix in mould A",
    fillHeight: "Filling height (mould A)",
    targetVolume: "Target volume (mould A)",

    results: "Result",
    areaA: "Area A",
    areaB: "Area B",
    swapFactor: "Substitution factor A_B/A_A",
    massB: "Mass of mix for mould B",
    massBNote: "The conversion holds only if the mix stands at the same height in both moulds.",
    volumeAtHeight: "Volume at the filling height",
    heightForVolume: "Filling height for the target volume",
    straightWalledNote:
      "Volume = area × height treats the container as straight-sided. For a ring it holds only if the tube runs the full height, and for a conical or tapered mould (bundt) use the frustum calculation below.",

    frustumTitle: "Frustum — a tapered mould",
    topDiameter: "Diameter at the top",
    bottomDiameter: "Diameter at the bottom",
    frustumHeight: "Height",
    frustumVolume: "Volume",
    frustumFormula: "V = π·h·(R²+R·r+r²)/3",

    inputs: "Entered",
    formula:
      "circle: A=π(d/2)²     square: A=a²     rectangle: A=a·b     ring: A=π((D/2)²−(d/2)²)     V=A·h     h=1000·V/A",

    errorDiameter: "The diameter must be greater than zero.",
    errorSide: "The side must be greater than zero.",
    errorA: "Dimension a must be greater than zero.",
    errorB: "Dimension b must be greater than zero.",
    errorRing: "The ring diameters must be greater than zero, and the inner smaller than the outer.",
    errorFillHeight: "The filling height must be greater than zero.",
    errorTargetVolume: "The target volume must be greater than zero.",
    errorBatterMassA: "The mass of mix in mould A must be greater than zero.",
    errorTopDiameter: "The diameter at the top must be greater than zero.",
    errorBottomDiameter: "The diameter at the bottom must be greater than zero.",
    errorFrustumHeight: "The height must be greater than zero.",

    unitCm: "cm",
    unitCm2: "cm²",
    unitG: "g",
    unitL: "l",
  },

  "plate-cost": {
    lines: "Dish items",
    linesHint:
      "One row per ingredient: name;quantity;unit;purchase price per kg/l/piece;yield %. The unit is g, ml or piece. The yield is the same combined yield (cleaning × thermal processing) that “Yield and loss” gives.",
    portions: "Number of servings the recipe gives",
    targetFoodCost: "Target food cost",
    extraPerPortion: "Extra cost per serving",
    extraPerPortionHint: "Optional — packaging, extras and the like.",

    results: "Result",
    colName: "Ingredient",
    colUsed: "Net quantity",
    colCost: "Cost",
    colShare: "Weight",
    total: "Total recipe cost",
    costPerPortion: "Cost per serving",
    sellingPrice: "Selling price",
    netPriceNote:
      "Net amount, without any tax. The tool applies no VAT or any other rate — rates are set by the state and change; if you want them in the calculation, enter them yourself in a separate percentage tool.",
    margin: "Margin per serving",

    inputs: "Entered",
    formula:
      "row_cost = (quantity/yield%)·price     serving_cost = Σrow_cost/servings+extra     selling=serving_cost/(fc/100)",

    errorLines: "Enter at least one item.",
    errorPortions: "The number of servings is a whole number, 1 or more.",
    errorTargetFoodCost: "The target food cost is a number strictly greater than 0 and up to 100%.",
    errorExtraPerPortion: "The extra cost per serving may not be negative.",
    errorQuantity: "Every item's quantity may not be negative.",
    errorUnitPrice: "Every item's purchase price may not be negative.",
    errorYieldPercent: "Every item's yield is a number strictly greater than 0 and up to 100%.",
    errorUnit: "Every item's unit is g, ml or piece.",

    unitCurrency: "RSD",
    unitG: "g",
    unitMl: "ml",
    unitPiece: "pcs",
  },

  "portions-from-pack": {
    packQuantity: "Quantity per package",
    packUnit: "Package unit",
    portionQuantity: "Serving size",
    portionUnit: "Serving unit",
    lossPercent: "Loss in the package",
    portionsNeeded: "Required number of servings",
    packPrice: "Package price",

    results: "Result",
    portionsPerPack: "Servings per package",
    leftover: "Remainder in the package",
    yieldPercent: "Yield (100 − loss)",
    packsNeeded: "Number of packages for the required number of servings",
    surplusPortions: "Surplus servings",
    totalCost: "Total package cost",
    pricePerPortion: "Price per serving",
    unitPrice: "Price per kg, l or piece",

    inputs: "Entered",
    formula:
      "usable=package·(1−loss/100)     servings=floor(usable/serving)     packages=ceil(required/servings)",

    errorPackUnit: "The package unit is g, kg, ml, l or piece.",
    errorPortionUnit: "The serving unit is g, kg, ml, l or piece.",
    errorUnitMismatch:
      "The package and the serving must be the same dimension — mass is not converted to volume or the reverse.",
    errorPackQuantity: "The quantity per package must be greater than zero.",
    errorPortionQuantity: "The serving size must be greater than zero.",
    errorLossPercent: "The loss in the package is a percentage from 0 to below 100.",
    errorPortionsNeeded: "The required number of servings is a whole number, 1 or more.",
    errorPackPrice: "The package price may not be negative.",
    errorPortionLargerThanPack:
      "The serving is larger than the usable package content — not one whole serving fits.",

    unitCurrency: "RSD",
    unitG: "g",
    unitKg: "kg",
    unitMl: "ml",
    unitL: "l",
    unitPiece: "pcs",
  },

  "ratio-split": {
    total: "Total quantity",
    unit: "Unit",
    unitHint: "Free text, e.g. g, kg, ml, l — printed beside every value.",
    ratio: "Ratio",
    ratioHint:
      "Two or more terms separated by a colon, e.g. 3:2:1. Every term ≥ 0, at least one > 0.",
    names: "Names of the parts",
    namesHint: "Optional, one name per line, in the same order as the ratio terms.",
    step: "Rounding step",
    stepHint: "In the unit above. An empty field means 0.01.",

    results: "Result",
    colName: "Part",
    colRatioPart: "Ratio term",
    colExact: "Exact",
    colAmount: "Rounded",
    colShare: "Weight",
    partPrefix: "Part",
    unallocated: "Unallocated remainder",

    inputs: "Entered",
    formula:
      "part_i = total·r_i/Σr, rounded by the largest remainder (Hare) to a number of steps = floor(total/step)",

    errorRatio:
      "The ratio must have at least two numbers separated by a colon, each zero or greater, at least one greater than zero.",
    errorTotal: "The total quantity must be greater than zero.",
    errorStep: "The rounding step must be greater than zero and not greater than the total quantity.",

    unitG: "g",
  },

  "recipe-scale": {
    mode: "Mode",
    modePortions: "Number of servings",
    modeFactor: "Factor",
    modeTargetMass: "Target total mass",
    lines: "Recipe items",
    linesHint:
      "One row per ingredient: quantity;unit;name;step (the last optional). The quantity may be decimal (“1.5”), a fraction (“1/2”) or mixed (“1 1/2”). The unit is g, kg, ml, l, piece or other.",
    originalPortions: "Starting number of servings",
    targetPortions: "Target number of servings",
    factor: "Factor",
    targetMass: "Target total mass",
    step: "Default rounding step",
    stepHint: "For rows without their own step. An empty field means 0.01, in that row's unit.",

    results: "Result",
    colName: "Ingredient",
    colScaled: "Scaled",
    colShare: "Share of mass",
    totalMass: "Sum of masses",

    inputs: "Entered",
    formula:
      "factor=target/starting or target_mass/Σmass     quantity'=quantity·factor, rounded by the largest remainder",

    errorLines: "Enter at least one item.",
    errorLineQuantity: "Every row's quantity may not be negative.",
    errorLineStep: "A row's own step must be greater than zero.",
    errorQuantityFormat: "The quantity was not recognised as a decimal, fraction or mixed number.",
    errorStep: "The default rounding step must be greater than zero.",
    errorOriginalPortions: "The starting number of servings is a whole number, 1 or more.",
    errorTargetPortions: "The target number of servings is a whole number, 1 or more.",
    errorFactor: "The factor must be greater than zero.",
    errorTargetMass:
      "The target total mass must be greater than zero, and all rows must be in mass units.",
    errorUnitMismatch:
      "The target total mass holds only when all rows are in mass units (g or kg).",

    unitG: "g",
    unitKg: "kg",
    unitMl: "ml",
    unitL: "l",
    unitPiece: "pcs",
    // The word `linesHint` above tells the user to type. It read „drugo" while
    // the hint asked for „ostalo" — one vocabulary, two spellings.
    unitOther: "other",
  },

  "solution-concentration": {
    mode: "Mode",
    modeBlend: "Mix two to a target mass",
    modeBlendAddSecond: "Add a second component to a target concentration",
    modeDilute: "Dilute with solvent",
    modeConcentrate: "Boil down (evaporate solvent)",
    modeAddSolute: "Add a pure ingredient",
    c1: "Concentration of component 1",
    c2: "Concentration of component 2",
    massBasisHint:
      "A percentage by mass. The tool refuses percentage by volume (e.g. ABV) — that needs a density the tool does not have.",
    targetConcentration: "Target concentration",
    mass: "Mass of component 1",
    targetMass: "Target total mass",
    concentrationLimit: "Regulatory maximum",
    limitHint: "From the regulation you apply. Neagle does not know which regulation that is and offers no value.",
    concentrateNote: "Assumption: only the solvent evaporates, the dissolved matter is not lost.",
    results: "Result",
    componentMass1: "Mass of component 1",
    componentMass2: "Mass of component 2",
    solventAdded: "Solvent added",
    massRemoved: "Mass removed (evaporation)",
    soluteAdded: "Pure ingredient added",
    totalMass: "Total mass",
    achievedConcentration: "Achieved concentration",
    concentrationRatio: "Ratio to the maximum",
    concentrationSpread: "Difference in component concentrations (c1 − c2)",
    formula:
      "conservation of dissolved matter, solved for the unknown of the chosen mode; check = total dissolved matter / total mass",
    inputs: "Entered",
    errorC1: "The concentration of component 1 must be between 0 and 100.",
    errorC2: "The concentration of component 2 must be between 0 and 100.",
    errorTargetConcentration: "The target concentration must be between 0 and 100.",
    errorMass: "The mass must be greater than zero.",
    errorTargetMass: "The target total mass must be greater than zero.",
    errorEqualConcentrations:
      "The component concentrations are equal — no mixture gives a different value.",
    errorTargetOutOfRange:
      "The target concentration is outside the range these components can reach.",
    unitG: "g",
  },

  "us-customary-kitchen-units": {
    value: "Value",
    from: "From unit",
    to: "To unit",
    usCupLegal: "US cup (legal, 240 ml)",
    usCupDeclared: "US cup (nutrition labelling, 236.588 ml)",
    auNzCup: "AU/NZ cup (250 ml)",
    usFlOz: "US fluid ounce",
    usTbsp: "US tablespoon",
    usTsp: "US teaspoon",
    usPint: "US pint",
    usQuart: "US quart",
    usGallon: "US gallon",
    impFlOz: "Imperial fluid ounce",
    impPint: "Imperial pint",
    impQuart: "Imperial quart",
    impGallon: "Imperial gallon",
    metricTbsp: "Metric tablespoon (manual entry in ml)",
    metricTsp: "Metric teaspoon (manual entry in ml)",
    ozAvoirdupois: "Ounce (mass)",
    pound: "Pound",
    degF: "Degree Fahrenheit",
    degC: "Degree Celsius",
    tablespoonMl: "Tablespoon volume",
    teaspoonMl: "Teaspoon volume",
    spoonHint: "In millilitres. Depends on the recipe you use.",
    targetMl: "millilitres",
    targetL: "litres",
    targetG: "grams",
    targetKg: "kilograms",
    results: "Result",
    result: "Result",
    relationPrefix: "Ratio:",
    relationTemperature:
      "A temperature scale has no single multiplier — the conversion goes by formula, not by a ratio.",
    formula: "volume→volume and mass→mass: a multiplier per unit     °F→°C: (°F − 32)·5/9",
    inputs: "Entered",
    errorFrom: "Choose the source unit.",
    errorTargetUnit:
      "This source unit cannot be converted to the chosen target unit — volume is not converted to mass without a density.",
    errorValue: "The value must be recognised as a number.",
    errorTablespoonMl: "The tablespoon volume must be greater than zero.",
    errorTeaspoonMl: "The teaspoon volume must be greater than zero.",
    unitMl: "ml",
    unitL: "l",
    unitG: "g",
    unitKg: "kg",
  },

  "yield-trim-cook": {
    mode: "Mode",
    modeForward: "From the gross purchase",
    modeInverse: "From the required number of servings",
    apMass: "Gross (purchase) mass",
    cleaningYield: "Cleaning yield",
    yieldHint: "Measured on your own raw material. No yield is pre-filled.",
    cookingYield: "Thermal-processing yield",
    cookingYieldHint: "It may even be over 100% — rice and pasta absorb water.",
    portionMass: "Serving mass, cooked",
    portionsNeeded: "Required number of servings",
    pricePerKgAp: "Price per kilogram of raw material",
    results: "Result",
    cleanedMass: "Cleaned mass",
    cookedMass: "Cooked mass",
    combinedYield: "Overall yield",
    combinedLossPercent: "Overall loss",
    yieldLossPairNote:
      "Yield and loss are the same measurement, shown as a bound pair — one is not entered into the other.",
    portions: "Number of servings",
    leftover: "Remainder",
    apNeeded: "Gross mass to buy",
    pricePerKgCooked: "Price per kilogram of the cooked product",
    pricePerPortion: "Portion price",
    formula:
      "yield=cleaning_yield·processing_yield     servings=floor(cooked/serving)     reverse: gross=servings·serving/yield",
    inputs: "Entered",
    errorApMass: "The gross mass must be greater than zero.",
    errorCleaningYield: "The cleaning yield must be greater than zero and not greater than 100%.",
    errorCookingYield: "The thermal-processing yield must be greater than zero.",
    errorPortionMass: "The serving mass must be greater than zero.",
    errorPortionsNeeded: "The required number of servings is a whole number, 1 or more.",
    errorPricePerKgAp: "The price per kilogram may not be negative.",
    unitG: "g",
    unitKg: "kg",
    unitCurrency: "RSD",
  },
} as const;
