/**
 * „Zanat" — the English copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those
 * live in the `name` and `blurb` tables of `./pro.en.ts`.
 *
 * **A unit is copy, not a constant.** „mm", „cm", „kg" are written here rather
 * than concatenated in the surface.
 *
 * **`glass-pane-weight` and `shelf-deflection` are `life-safety`.** Their copy
 * names a quantity and, where the assignment makes a limit an input, the
 * user's own limit — and never what the two mean together
 * (`toolForbidsVerdict`). No „zadovoljava", no „bezbedno", no colour word.
 */
export const PRO_ZANAT_EN = {
  "fabric-yardage-repeat": {
    rows: "List of pieces",
    rowsHint: "Row by row: width;height;count, in centimetres, before the seam allowance.",
    rollWidth: "Roll width",
    rollWidthHint: "The usable width of the fabric roll, in centimetres.",
    seamAllowance: "Seam allowance per edge",
    verticalRepeat: "Vertical repeat",
    verticalRepeatHint: "The pattern step along the roll, in centimetres. Enter 0 for fabric without a pattern.",
    horizontalRepeat: "Horizontal repeat",
    horizontalRepeatHint:
      "The pattern step across the roll width, in centimetres. Enter 0 when the pattern has no cross repeat.",
    waste: "Wastage",
    grainMandatory: "Required grain direction",
    grainHint: "When on, the piece may not be turned by 90° to fit the roll.",
    grainYes: "Yes",
    grainNo: "No",

    results: "Result",
    colPiece: "Piece",
    colCut: "Cut size",
    colOrientation: "Position",
    colCentered: "Centred on the repeat",
    colAcross: "Across the roll width",
    colRows: "Cutting rows",
    colRowLength: "Row length",
    colAlignment: "Alignment at the start of the roll",
    colUsage: "Usage",
    colPerPiece: "Per piece",
    orientationNormal: "normal",
    orientationRotated: "turned",
    centeredWidth: "width",
    centeredHeight: "height",

    totalLength: "Total length",
    orderLength: "Length to order",
    usedArea: "Area used",
    usefulArea: "Usable area",
    wasteArea: "Waste area",

    inputs: "Entered",
    formula:
      "w_c = w+2d   h_c = h+2d   w_c′ = ceil(w_c/R_h)·R_h   n_a = floor(W_r/w_c′)   rows = ceil(count/n_a)   l = ceil(h_c/R_v)·R_v   L = Σ(rows·l + R_v)·(1+waste/100)",

    errorRows:
      "The list of pieces is row by row, 1 to 500 rows; every row carries a width, a height and a count.",
    errorRollWidth: "The roll width is a number from 50 to 320 cm.",
    errorSeamAllowance: "The seam allowance is a number from 0 to 20 cm.",
    errorVerticalRepeat: "The vertical repeat is a number from 0 to 120 cm.",
    errorHorizontalRepeat: "The horizontal repeat is a number from 0 to 160 cm.",
    errorWaste: "Wastage is a number from 0 to 30%.",
    errorWidth: "The piece width must be greater than zero.",
    errorHeight: "The piece height must be greater than zero.",
    errorCount: "The count per row is a whole number from 1 to 500.",
    errorAcrossRoll:
      "The piece is wider than the roll in both possible positions — compare the cut size with the roll width.",

    unitCm: "cm",
    unitM: "m",
    unitM2: "m²",
    unitPercent: "%",
  },

  "glass-pane-weight": {
    width: "Glass width",
    height: "Glass height",
    composition: "Composition",
    compositionMonolithic: "Monolithic",
    compositionLaminated: "Laminated",
    compositionInsulated: "Insulated glass",
    plyThicknesses: "Thicknesses of the glass panes in the unit",
    plyThicknessesHint:
      "Row by row, the thickness of each pane in the unit, in millimetres. For insulated glass the cavity is not entered.",
    pvbLayers: "Number of PVB interlayers",
    pvbLayerThickness: "Thickness of one PVB interlayer",
    pvbLayerThicknessHint: "In millimetres. Default 0.38 mm.",
    pieces: "Number of pieces",
    density: "Glass density",
    densityHint:
      "In kg/m³. Default 2500 (float glass); for special glasses enter your own value.",

    results: "Result",
    area: "Area of one piece",
    totalArea: "Total area",
    massPerArea: "Mass per m²",
    massPerPiece: "Mass of one piece",
    totalMass: "Total mass",
    perimeter: "Perimeter of one piece",
    densityUsed: "Density used",
    glassThicknessSum: "Sum of glass thicknesses (Σ t_glass)",
    pvbThicknessSum: "Sum of PVB thicknesses (Σ t_PVB)",
    temperingNote:
      "The thicknesses above are nominal. Tempering does not change the density of glass, so the mass is the same for tempered and untempered glass of the same size. The tool estimates no mass limit, handling class or number of people.",

    inputs: "Entered",
    formula:
      "A = (w/1000)·(h/1000)   m_A = ρ_glass·10⁻³·Σt_glass + ρ_PVB·10⁻³·Σt_PVB   m = A·m_A   P = 2·(w+h)/1000",

    errorWidth: "The width is a number from 50 to 6000 mm.",
    errorHeight: "The height is a number from 50 to 6000 mm.",
    errorDensity: "The density is a number from 2200 to 3000 kg/m³.",
    errorPieces: "The count is a whole number from 1 to 1000.",
    errorPlyThicknesses:
      "Glass thicknesses: each value 2–25 mm, the list may not be empty or all zeros, and for monolithic glass exactly one value is entered.",
    errorPvbLayers: "The number of PVB interlayers is a whole number from 0 to 8, and is possible only for laminated glass.",
    errorPvbLayerThickness: "The thickness of one PVB interlayer is a number from 0.1 to 2 mm.",

    unitMm: "mm",
    unitM: "m",
    unitM2: "m²",
    unitKg: "kg",
    unitKgM2: "kg/m²",
    unitKgM3: "kg/m³",
  },

  "iso-286-fits": {
    nominalSize: "Nominal size",
    nominalSizeHint: "In millimetres, from 1 to 500.",
    holeMode: "Hole — method",
    holeModeGrade: "Standard designation (H)",
    holeModeManual: "Custom deviations",
    holeGrade: "Hole tolerance grade",
    holeGradeHint: "IT5 to IT12. An empty field means IT7 (H7).",
    holeUpper: "Upper hole deviation",
    holeLower: "Lower hole deviation",
    shaftMode: "Shaft — method",
    shaftModeLetter: "Letter and grade",
    shaftModeManual: "Custom deviations",
    shaftLetter: "Shaft letter",
    shaftGrade: "Shaft tolerance grade",
    shaftUpper: "Upper shaft deviation",
    shaftLower: "Lower shaft deviation",

    results: "Result",
    fitDesignation: "Fit designation",
    range: "Nominal size range",
    colPart: "Part",
    colUpper: "Upper deviation",
    colLower: "Lower deviation",
    colMax: "Maximum size",
    colMin: "Minimum size",
    colWidth: "Tolerance width",
    colMean: "Mid size",
    hole: "Hole",
    shaft: "Shaft",
    holeMax: "Hole — maximum size",
    holeMin: "Hole — minimum size",
    shaftMax: "Shaft — maximum size",
    shaftMin: "Shaft — minimum size",
    maxClearance: "Maximum clearance",
    minClearance: "Minimum clearance",
    meanClearance: "Mean clearance",
    signedNote:
      "The clearance is shown with its sign. For custom deviations a negative value means an interference, not a clearance — the tool passes no judgement on that.",

    inputs: "Entered",
    formula:
      "ES = +IT(hole)   ei(shaft) = es − IT(shaft)   D_max/min = D + ES/EI÷1000   C_max = ES − ei   C_min = EI − es",

    errorNominalSize: "The nominal size is a number from 1 to 500 mm.",
    errorHoleGrade: "The hole tolerance grade is a whole number from IT5 to IT12.",
    errorHoleDeviations:
      "Custom hole deviations: the upper must be greater than or equal to the lower, both real numbers.",
    errorShaftLetter: "The shaft letter must be chosen (d, e, f, g or h).",
    errorShaftGrade: "The shaft tolerance grade is a whole number from IT5 to IT12.",
    errorShaftDeviations:
      "Custom shaft deviations: the upper must be greater than or equal to the lower, both real numbers.",

    unitMm: "mm",
    unitUm: "µm",
  },

  "linear-cutting-stock": {
    items: "List of required pieces",
    itemsHint: "Row by row: length;count, in millimetres.",
    barLength: "Bar length in stock",
    kerf: "Cut width",
    kerfHint: "Depends on the saw blade on the machine, in millimetres.",
    startWaste: "Trim at the start of the bar",
    endWaste: "Trim at the end of the bar",
    minUsableRemnant: "Smallest remainder worth keeping",
    minUsableRemnantHint:
      "A remainder shorter than this is shown as waste, not as a usable piece.",

    results: "Result",
    colBar: "Bar",
    colPieces: "Layout (length, position)",
    colUsed: "Length used",
    colRemainder: "Remainder",
    colUsable: "Usable remainder",
    usableYes: "yes",
    usableNo: "no",

    barCount: "Number of bars",
    usableLength: "Usable bar length",
    totalCutLength: "Total piece length",
    totalPurchasedLength: "Total purchased",
    cutCount: "Number of cuts",
    kerfLength: "Length the cut consumes",
    wasteIncludingUsable: "Total waste (with usable remainders)",
    wasteIncludingUsablePercent: "Total waste, % of purchase",
    wasteExcludingUsable: "Waste without usable remainders",
    wasteExcludingUsablePercent: "Waste without usable remainders, % of purchase",
    usableRemnantLength: "Total usable remainders",
    lowerBoundBars: "Lower bound on the number of bars",
    lowerBoundNote:
      "The lower bound holds within this model — every piece consumes its length plus one cut, and every bar offers the usable length. When the number of bars equals the lower bound, the layout is optimal within the model.",

    inputs: "Entered",
    formula: "cost(d) = d + w   order first-fit-decreasing   LB = ceil(Σ(d+w) / U)",

    errorItems: "The list of pieces has 1 to 500 rows; every row carries a length and a count.",
    errorBarLength: "The bar length is a number from 100 to 24000 mm.",
    errorKerf: "The cut width is a number from 0 to 15 mm.",
    errorStartWaste: "The trim at the start of the bar is a number from 0 to 500 mm.",
    errorEndWaste: "The trim at the end of the bar is a number from 0 to 500 mm.",
    errorMinUsableRemnant: "The smallest usable remainder is a number from 0 to 5000 mm.",
    errorUsableLength: "The usable bar length (length minus trims) must be greater than zero.",
    errorLength: "The piece length must be greater than zero and less than the usable bar length.",
    errorCount: "The count per row is a whole number from 1 to 999.",

    unitMm: "mm",
  },

  "mitre-angles": {
    angleMode: "Angle — method",
    angleModeSides: "Number of sides",
    angleModeBaseAngle: "Base angle (θ)",
    sides: "Number of sides N",
    baseAngleField: "Base angle θ",
    slopeMode: "Slope — method",
    slopeModeSlope: "Slope from vertical (B)",
    slopeModeSpring: "Spring angle (S)",
    slope: "Side slope from vertical (B)",
    slopeHint: "0 is a plumb side, i.e. a flat frame.",
    springAngle: "Spring angle of the moulding (S)",
    springAngleHint: "Measured from the wall. B = 90 − S.",
    pieceWidth: "Piece width w",
    pieceWidthHint: "Optional, only for the side lengths — entered together with the internal length.",
    insideLength: "Internal clear side length",

    results: "Result",
    baseAngle: "Base angle (θ)",
    /** B as the arithmetic used it — S is converted before anything is cut. */
    slopeUsed: "Applied slope from vertical (B)",
    m0: "Auxiliary angle m₀",
    simpleMitre: "Simple mitre per piece (θ/2)",
    sawMitreAngle: "Saw setting — mitre (from a right angle)",
    sawMitreComplement: "Supplementary reading (90° − mitre)",
    sawBevelAngle: "Saw setting — blade tilt",
    scaleConventionNote: "Scale convention: 0° is a right angle (a plumb, untwisted side).",
    // Both names on one row: the long point of a mitre IS the outside corner,
    // so „spoljašnja mera" and „mera do duge tačke" were the same figure shown
    // twice, which reads as two measurements that happen to agree.
    lengthToLongPoint: "Size to the long point (outer)",
    lengthToShortPoint: "Size to the short point (inner)",
    centeredMeasureNote: "The formula centres the size:",
    centeredOutsideWidth: "outer width of the piece",
    lengthsCautionNote:
      "m₀ is 85° or more — tan m₀ grows quickly, so the resulting length is sensitive to a small measurement error. The number is exact, but read it with that in mind.",
    tanM0: "tan m₀",

    inputs: "Entered",
    formula:
      "θ = (N−2)·180/N   m₀ = 90 − θ/2   M = atan(cos B · tan m₀)   T = asin(sin B · cos m₀)   s_o = s_i + 2·w·cos B·tan m₀",

    errorSides: "The number of sides is a whole number from 3 to 48.",
    errorBaseAngle: "The base angle is a number from 1 to 179°.",
    errorSlope: "The slope from vertical is a number from 0 to 89°.",
    errorSpringAngle: "The spring angle is a number from 1 to 89°.",
    errorPieceWidth:
      "The piece width is a number from 5 to 500 mm — entered together with the internal length.",
    errorInsideLength:
      "The internal clear length is a number from 10 to 10000 mm — entered together with the piece width.",

    unitDeg: "°",
    unitMm: "mm",
  },

  "mortar-mix-quantity": {
    mode: "Mode",
    modePremixed: "Ready-mixed",
    modeOnsite: "Site mixing",

    area: "Area",
    thickness: "Layer thickness",
    volume: "Volume of fresh mortar",
    waste: "Wastage",
    consumptionUnit: "Consumption unit",
    consumptionUnitPerM2mm: "kg/(m²·mm)",
    consumptionUnitPerM3: "kg/m³",
    consumption: "Consumption of ready-mixed mortar",
    consumptionHint: "A datum from the product label, in the unit chosen above.",
    bagMass: "Bag mass",
    waterPerKg: "Water per kilogram of mix",
    waterPerKgHint: "In l/kg. A datum from the label.",

    onsiteVolumeMode: "Volume — method",
    onsiteVolumeModeArea: "From area and thickness",
    onsiteVolumeModeVolume: "Volume directly",
    packingFactor: "Compaction factor",
    packingFactorHint:
      "The sum of the ingredient volumes relative to the fresh mortar volume. Cement paste fills the voids in the sand, so the factor is always greater than 1 — the user enters it.",
    ratio: "Binder : aggregate ratio (1 : n)",
    ratioHint: "A ratio by volume. The tool does not suggest it.",
    binderDensity: "Bulk density of the binder",
    aggregateDensity: "Bulk density of the aggregate",
    waterCementRatio: "Water-binder ratio",
    aggregateMoisture: "Aggregate moisture",
    aggregateMoistureHint: "In percent. It is subtracted from the water needed — never below zero.",
    mixerVolume: "Mixer volume",
    mixerVolumeHint: "In litres, to convert to the number of batches.",

    results: "Result",
    freshVolume: "Volume of fresh mortar",
    compactedVolume: "Sum of ingredient volumes",
    binderVolume: "Binder volume",
    aggregateVolume: "Aggregate volume",
    binderMass: "Binder mass",
    aggregateMass: "Aggregate mass",
    mass: "Mass of the mix",
    bags: "Number of bags",
    bagSurplus: "Surplus from the last bag",
    binderBags: "Number of binder bags",
    binderBagSurplus: "Surplus from the last binder bag",
    waterTheoretical: "Water by the water-binder ratio",
    aggregateMoistureWater: "Water already in the aggregate",
    water: "Water to add",
    batches: "Number of batches",
    batchBinderMass: "Binder per batch",
    batchAggregateMass: "Aggregate per batch",
    // The whole-job block above gives the aggregate in both volume and mass;
    // the per-batch block gave only the mass, so the one figure a worker
    // measures at the mixer — buckets of sand — was the one missing.
    batchAggregateVolume: "Aggregate volume per batch",
    batchWater: "Water per batch",
    consumptionUnitUsed: "Consumption used",

    inputs: "Entered",
    formulaPremixed: "m = A·(1+waste/100)·q·d   bags = ceil(m / m_bag)   water = m·v",
    formulaOnsite:
      "V_s = V·k   V_binder = V_s/(1+n)   V_aggregate = V_s·n/(1+n)   water = w_b·m_binder − m_aggregate·moisture/100 (≥ 0)",

    errorWaste: "Wastage is a number from 0 to 30%.",
    errorVolume: "The volume must be greater than zero.",
    errorArea: "The area is a number from 0.1 to 10000 m².",
    errorThickness: "The layer thickness is a number from 1 to 200 mm.",
    errorConsumption: "The consumption of ready-mixed mortar is a number from 0.5 to 3 kg/(m²·mm).",
    errorBagMass: "The bag mass is a number from 0 to 50 kg.",
    errorWaterPerKg: "The water per kilogram of mix is a number from 0.05 to 0.5 l/kg.",
    errorPackingFactor: "The compaction factor is a number from 1.0 to 1.6.",
    errorRatio: "The ratio n is a number from 1 to 10.",
    errorBinderDensity: "The bulk density of the binder is a number from 800 to 2000 kg/m³.",
    errorAggregateDensity: "The bulk density of the aggregate is a number from 1200 to 2000 kg/m³.",
    errorWaterCementRatio: "The water-binder ratio is a number from 0.3 to 1.0.",
    errorAggregateMoisture: "The aggregate moisture is a number from 0 to 100%.",
    errorMixerVolume: "The mixer volume must be greater than zero.",

    unitM2: "m²",
    unitM3: "m³",
    unitMm: "mm",
    unitKg: "kg",
    unitL: "l",
    unitKgM2mm: "kg/(m²·mm)",
  },

  "panel-cutting-yield": {
    panelWidth: "Sheet format — width (A)",
    panelHeight: "Sheet format — height (B)",
    pieceWidth: "Piece format — width (a)",
    pieceHeight: "Piece format — height (b)",
    piecesNeeded: "Required number of pieces",
    kerf: "Cut width",
    kerfHint: "A datum about the saw blade, in millimetres.",
    edgeTrim: "Sheet edge trimming",
    grainMandatory: "Grain direction required",
    grainHint: "When on, the piece may not be turned by 90°.",
    grainYes: "Yes",
    grainNo: "No",

    results: "Result",
    piecesPerPanel: "Pieces per sheet",
    panelsNeeded: "Number of sheets",
    leftoverOnLastPanel: "Unused on the last sheet",
    yieldPercent: "Utilisation",
    wasteArea: "Waste per sheet",
    totalWasteArea: "Total waste",
    rightStrip: "Right strip",
    bottomStrip: "Bottom strip",
    cutCount: "Number of cuts per sheet",
    cutLength: "Cut length per sheet",
    totalCutLength: "Total cut length",
    guillotineNote:
      "This is a guillotine cut of a single piece format. The utilisation is calculated against the full sheet format, because the edge trimming is paid for.",

    inputs: "Entered",
    formula:
      "A′ = A−2t   B′ = B−2t   n = floor((A′+w)/(a+w))   m = floor((B′+w)/(b+w))   N = max over both positions and both strips",

    errorPanelWidth: "Sheet format — width is a number from 100 to 6000 mm.",
    errorPanelHeight: "Sheet format — height is a number from 100 to 6000 mm.",
    errorPieceWidth:
      "Piece format — width is a number from 10 to 6000 mm, or the piece does not fit the usable sheet in either position.",
    errorPieceHeight: "Piece format — height is a number from 10 to 6000 mm.",
    errorPiecesNeeded: "The required number of pieces is a whole number from 1 to 100000.",
    errorKerf: "The cut width is a number from 0 to 15 mm.",
    errorEdgeTrim:
      "The edge trimming is a number from 0 to 100 mm per side, and must leave a usable sheet.",

    unitMm: "mm",
    unitM: "m",
    unitM2: "m²",
  },

  "sheet-metal-bend": {
    thickness: "Sheet thickness T",
    radius: "Inside bend radius R",
    radiusHint: "The radius the tool gives, not the sheet thickness.",
    angle: "Bend angle A (change of direction)",
    kFactor: "K-factor",
    kFactorHint: "Depends on the material and the tool. It is most reliably obtained by measuring the sample below.",
    legsAs: "Method of setting the legs",
    legsAsOuter: "Outside dimensions",
    legsAsTangent: "Tangent dimensions",
    legs: "Legs",
    legsHint: "Row by row, one dimension per leg, in millimetres — in the form chosen above.",

    results: "Result",
    bendAllowance: "Bend allowance (BA)",
    bendDeduction: "Bend deduction (BD)",
    setback: "Outside setback (OSSB)",
    developedLength: "Developed length of the sheet",
    colBend: "Bend",
    colStart: "Start of the line",
    colEnd: "End of the line",
    colStartOpposite: "Start from the opposite edge",
    colEndOpposite: "End from the opposite edge",

    measuredLength: "Measured developed length of the sample",
    measuredLengthHint:
      "Optional, for the reverse K-factor calculation — a sample cut with the same outside legs as above.",
    measuredLengthDisabledHint:
      "The reverse K-factor calculation works only when the legs are given as outside dimensions.",
    reverseResults: "K-factor from the sample",
    kFactorFromSample: "Calculated K-factor",
    radiusToThickness: "R/T ratio",
    kFactorScopeNote:
      "The measured K-factor holds only for this combination of tool and material (T, R and A above) — it does not carry over to another job.",

    inputs: "Entered",
    formula: "BA = (π/180)·A·(R+K·T)   OSSB = (R+T)·tan(A/2)   BD = 2·OSSB − BA",
    reverseFormula: "K = ((L_measured − Σtangent)/number_of_bends/((π/180)·A) − R)/T",

    errorThickness: "The sheet thickness is a number from 0.1 to 20 mm.",
    errorRadius: "The inside radius is a number from 0.1 to 200 mm.",
    errorAngle: "The bend angle is a number from 1 to 179°.",
    errorKFactor: "The K-factor is a number from 0 to 0.5.",
    errorLegs:
      "There must be 2 to 50 legs, each greater than zero, and each must give a tangent length greater than zero (the outside dimension must exceed its setback).",
    errorMeasuredLength: "The measured developed length of the sample is a number from 1 to 6000 mm.",

    unitMm: "mm",
    unitDeg: "°",
  },

  "shelf-deflection": {
    span: "Span L (clear between supports)",
    width: "Shelf width b",
    thickness: "Shelf thickness h",
    udlMass: "Uniformly distributed load",
    pointLoadMass: "Central point load",
    modulus: "Modulus of elasticity E",
    modulusHint:
      "A datum from the board's label. For the same thickness it differs severalfold between products.",
    weightMode: "Self-weight of the shelf",
    weightModeHint:
      "The shelf also carries itself. If neither a density nor a mass is entered, the self-weight is not calculated.",
    weightModeNone: "Not calculated",
    weightModeDensity: "From the board density",
    weightModeMass: "Shelf mass directly",
    shelfDensity: "Board density",
    shelfMass: "Shelf mass",
    limitMode: "Deflection limit — method",
    limitModeValue: "In millimetres",
    limitModeRatio: "As L/x",
    deflectionLimit: "Custom deflection limit",
    deflectionLimitDivisor: "Custom deflection limit as L/x",
    stressLimit: "Custom stress limit",
    limitHint: "From the regulation you apply. Nexus does not know which regulation that is and offers no value.",

    results: "Result",
    inertia: "Second moment of area I (mm⁴)",
    sectionModulus: "Section modulus W (mm³)",
    selfWeightMass: "Shelf mass (from density or entered)",
    selfWeightDeflection: "Deflection from self-weight",
    distributedDeflection: "Deflection from the uniformly distributed load",
    pointDeflection: "Deflection from the point load",
    totalDeflection: "Total deflection",
    spanOverDeflection: "Deflection as L/x",
    maxMoment: "Maximum bending moment",
    stress: "Stress",
    reaction: "Reaction per support",
    deflectionRatio: "Deflection ÷ your limit",
    stressRatio: "Stress ÷ your limit",
    modelNote:
      "The model is a simply supported beam on two supports. A shelf fixed into the sides or supported along its whole length is not this model. The deflection shown is instantaneous — creep under long-term load is not covered.",

    inputs: "Entered",
    formula:
      "q = m·g/L   δ_q = 5·q·L⁴/(384·E·I)   δ_F = F·L³/(48·E·I)   M = q·L²/8 + F·L/4   σ = M/W   R = (q·L+F)/2",

    errorSpan: "The span is a number from 50 to 5000 mm.",
    errorWidth: "The shelf width is a number from 10 to 2000 mm.",
    errorThickness: "The shelf thickness is a number from 3 to 200 mm.",
    errorUdlMass: "The uniformly distributed load is a number from 0 to 2000 kg.",
    errorPointLoadMass: "The point load is a number from 0 to 2000 kg.",
    errorModulus: "The modulus of elasticity is a number from 100 to 20000 N/mm².",
    errorShelfDensity: "The board density must be greater than zero.",
    errorShelfMass: "The shelf mass must be zero or greater.",
    errorDeflectionLimitDivisor: "The divisor x (in L/x) must be greater than zero.",
    errorDeflectionLimit: "The deflection limit must be greater than zero.",
    errorStressLimit: "The stress limit must be greater than zero.",

    unitMm: "mm",
    unitKg: "kg",
    unitN: "N",
    unitNmm: "N·mm",
    unitMpa: "N/mm²",
  },

  "shelf-spacing": {
    innerHeight: "Internal carcass height H",
    innerHeightHint: "The clear space between the bottom and top panels, in millimetres.",
    countMode: "Number of shelves — method",
    countModeCount: "Given count",
    countModeMaxOpening: "From the largest allowed opening",
    shelfCount: "Number of shelves n",
    maxClearOpening: "Largest allowed clear opening",
    maxClearOpeningHint: "The user chooses the dimension — the tool does not suggest it.",
    thickness: "Shelf thickness t",
    mode: "Layout method",
    modeEqualClear: "Equal clear openings",
    modeEqualAxis: "Equal axis spacings",
    modeGivenFirst: "Given height of the bottom opening",
    firstOpeningHeight: "Height of the bottom opening",
    raster: "Shelf hole grid",
    rasterHint: "Default 32 mm (System 32). The value is an editable field.",
    snap: "Snap to the drilling grid",
    snapYes: "On",
    snapNo: "Off",
    firstHoleFromBottom: "First hole from the bottom edge",
    firstHoleFromBottomHint:
      "It differs by jig and hardware — there is no default, check on your jig.",

    results: "Result",
    usableHeight: "Usable height (without shelf thicknesses)",
    colShelf: "Shelf",
    colBottomEdge: "Bottom edge",
    colTopDistance: "From the top edge",
    colHoleIndex: "Hole ordinal",
    colSnapped: "Actual position",
    colSnappedTopDistance: "Actual from the top edge",
    colDeviation: "Deviation",
    shelf: "Shelf",
    bottomEdge: "bottom edge",
    snappedBottomEdge: "actual",
    deviation: "deviation",
    clearOpenings: "Clear openings",
    snappedClearOpenings: "Actual clear openings (after snapping)",

    inputs: "Entered",
    formula:
      "U = H − n·t   s = U/(n+1)   y_i = i·s + (i−1)·t   [axis: p = H/(n+1), y_i = i·p − t/2]   snap: j = round((y−o)/R)",

    errorInnerHeight: "The internal height is a number from 50 to 5000 mm.",
    errorThickness: "The shelf thickness is a number from 3 to 100 mm.",
    errorShelfCount: "The number of shelves is a whole number from 0 to 30.",
    errorMaxClearOpening:
      "The largest clear opening must be greater than zero and give a number of shelves in the range 0–30.",
    errorUsableHeight:
      "The shelves do not fit — the sum of their thicknesses is greater than or equal to the internal height.",
    errorFirstOpeningHeight:
      "The height of the bottom opening must be greater than zero and less than the total clear height.",
    errorFirstHoleFromBottom: "The first hole from the bottom edge is a number from 0 to 200 mm.",
    errorRaster: "The hole grid is a number from 1 to 100 mm.",
    errorSnap:
      "After snapping two shelves fall on the same hole or outside the carcass — move the first hole or the grid.",

    unitMm: "mm",
  },

  "tap-drill-size": {
    nominalDiameter: "Nominal diameter D",
    nominalDiameterHint: "In millimetres — a thread designation is chosen, e.g. M8.",
    pitch: "Pitch P",
    pitchHint:
      "An empty field takes the coarse pitch from ISO 261 for the entered diameter. A fine pitch is entered by hand.",
    desiredEngagement: "Required percentage of engagement",
    desiredEngagementHint: "A workshop convention, not a standard requirement. An empty field means 75%.",
    ownDrillDiameter: "Diameter of the existing drill",
    ownDrillDiameterHint: "Optional, for the reverse calculation of the engagement percentage.",
    passHoleSeries: "Clearance-hole series",
    passHoleSeriesFine: "Fine",
    passHoleSeriesMedium: "Medium",
    passHoleSeriesCoarse: "Coarse",
    chamferedThreads: "Number of thread-cutting chamfer threads on the tap",
    chamferedThreadsHint:
      "Optional, with the thread depth, for the minimum blind-hole depth. Depends on the tap.",
    threadDepth: "Thread depth (axial)",

    results: "Result",
    drillDiameter: "Drill diameter for the required engagement",
    coreDiameter: "Thread minor diameter D₁",
    threadDepthPerSide: "Thread depth per side",
    ownDrillEngagement: "Engagement percentage of your drill",
    ownDrillThreadDepth: "Thread depth per side (your drill)",
    passHoleDiameter: "Clearance hole diameter",
    minBlindHoleDepth: "Minimum blind-hole depth",
    pitchUsed: "Pitch used",
    engagementUsed: "Engagement percentage used",
    pitchSourceCoarseAuto: "coarse, ISO 261",
    pitchSourceCoarseEntered: "coarse, entered by hand",
    pitchSourceFine: "fine, ISO 261",
    pitchSourceCustom: "entered by hand, not in the table",

    inputs: "Entered",
    formula:
      "D₁ = D − 1.082532·P   d = D − (h/100)·1.299038·P   h(d) = 100·(D−d)/(1.299038·P)   depth/side = (D−d)/2",

    errorNominalDiameter: "The nominal diameter is a number from 1.6 to 30 mm.",
    errorPitch:
      "The pitch is a number from 0.2 to 3.5 mm; if the field is empty and the diameter has no coarse pitch in the table, the pitch must be entered.",
    errorDesiredEngagement: "The required engagement percentage is a number from 50 to 100.",
    errorOwnDrillDiameter:
      "The drill diameter is a number from 0.5 to 30 mm and must be smaller than the nominal diameter.",
    errorChamferedThreads:
      "The number of chamfer threads must be greater than zero — entered together with the thread depth.",
    errorThreadDepth:
      "The thread depth must be greater than zero — entered together with the number of chamfer threads.",

    unitMm: "mm",
  },

  "timber-volume": {
    mode: "Calculation method",
    modeHuber: "Huber's formula (mid-diameter)",
    modeSmalian: "Smalian's formula (two end diameters)",
    modeHuberSmalian: "Huber and Smalian side by side",
    modeSawn: "Sawn timber — from the number of pieces",
    modeSawnFromVolume: "Sawn timber — from the required volume",
    modeStackedToSolid: "Stacked cubic metre → solid volume",
    modeSolidToStacked: "Solid volume → stacked cubic metre",

    meanDiameter: "Mid-diameter of the log",
    meanDiameterHint: "Measured at the middle of the log's length, without bark if the bark thickness is entered.",
    d1: "Diameter at the thicker end (d1)",
    d2: "Diameter at the thinner end (d2)",
    length: "Log length",
    logCount: "Number of logs",
    barkThickness: "Bark thickness",

    sawnThickness: "Board thickness",
    sawnWidth: "Board width",
    pieceLength: "Piece length",
    pieces: "Number of pieces",
    targetVolume: "Required volume",
    section: "Cross-section",
    sectionRough: "rough sawn",
    sectionPlaned: "planed",

    stackedVolume: "Stacked volume",
    solidVolume: "Solid volume",
    packingCoefficient: "Stacking solidity coefficient",
    packingCoefficientHint: "The ratio of solid wood volume to stacked volume — a number between 0 and 1.",

    density: "Wood density",
    densityHint: "For the mass; if empty, the mass is not shown.",

    results: "Result",
    huberVolume: "Volume by Huber",
    smalianVolume: "Volume by Smalian",
    volumeDifference: "Difference Huber − Smalian",
    taper: "Taper",
    totalLogVolume: "Total log volume",
    totalLogVolumeHuber: "Total log volume (Huber)",
    totalLogVolumeSmalian: "Total log volume (Smalian)",
    pieceVolume: "Volume of one piece",
    pieceCount: "Number of pieces",
    totalVolume: "Total volume",
    surfaceArea: "Area",
    mass: "Mass",
    massHuber: "Mass (Huber)",
    massSmalian: "Mass (Smalian)",

    inputs: "Entered",
    formula:
      "Huber: V = L·π·(Dmid/2)²   Smalian: V = L·π·((d1²+d2²)/2)/4   sawn: V = t·w·L·count   stacked → solid: V = stacked·coefficient",

    errorBarkThickness: "The bark thickness is a number, smaller than the mid-diameter.",
    errorDensity: "The density is a number greater than zero.",
    errorLength: "The log length is a number greater than zero.",
    errorLogCount: "The number of logs is a whole number greater than zero.",
    errorMeanDiameter: "The mid-diameter is a number greater than zero.",
    errorD1: "Diameter d1 is a number greater than zero.",
    errorD2: "Diameter d2 is a number greater than zero.",
    errorSawnThickness: "The board thickness is a number greater than zero.",
    errorSawnWidth: "The board width is a number greater than zero.",
    errorPieceLength: "The piece length is a number greater than zero.",
    errorPieces: "The number of pieces is a whole number greater than zero.",
    errorTargetVolume: "The required volume is a number greater than zero.",
    errorStackedVolume: "The stacked volume is a number greater than zero.",
    errorPackingCoefficient: "The stacking solidity coefficient is a number between 0 and 1.",
    errorSolidVolume: "The solid volume is a number greater than zero.",

    unitM3: "m³",
    unitM2: "m²",
    unitKg: "kg",
    unitCmM: "cm/m",
  },

  "wallpaper-rolls": {
    walls: "Walls (width;full-height opening — one wall per row)",
    wallsHint:
      "One wall per row, width and, separated by a semicolon, the width of the full-height opening (door) to deduct; without an opening enter 0.",
    height: "Pasting height",
    rollWidth: "Roll width",
    rollLength: "Roll length",
    repeat: "Vertical pattern repeat",
    repeatHint: "0 for wallpaper without a pattern.",
    matching: "Match type",
    matchingStraight: "straight match",
    matchingHalfDrop: "offset match",
    allowance: "Reserve per strip",
    allowanceHint: "Top and bottom together.",
    reserveStrips: "Spare strips",
    reserveStripsHint: "Extra strips beyond the calculated ones, for waste and cutting errors.",
    spareStripHeight: "Height of the pieces above the opening",
    spareStripHeightHint: "To estimate how many such pieces come out of the roll remainders.",

    results: "Result",
    stripCount: "Number of strips",
    stripLength: "Length of one strip",
    stripsPerRollCheck: "Strips per roll (check, closed form)",
    rollCount: "Number of rolls",
    totalPatternWaste: "Total for pattern matching",
    sparePiecesFromRemnants: "Pieces above the opening from the roll remainders",
    colRoll: "Roll",
    colStripsOnRoll: "Strips per roll",
    colRemainder: "Remainder",
    colPatternWaste: "For pattern matching",

    inputs: "Entered",
    formula:
      "n per wall = ⌈(width − full-height openings)/roll width⌉ + spare strips; each strip is cut sequentially from the current roll, at the pattern phase the layout requires",

    errorWalls: "Enter at least one wall, its width and, if needed, a full-height opening.",
    errorHeight: "The pasting height is a number from 0.5 to 10 m.",
    errorRollWidth: "The roll width is a number from 0.3 to 1.6 m.",
    errorRollLength: "The roll length is a number from 1 to 100 m.",
    errorRepeat: "The repeat is a number from 0 to 1.5 m.",
    errorAllowance: "The reserve per strip is a number from 0 to 0.5 m.",
    errorReserveStrips: "The spare strips are a whole number from 0 to 20.",
    errorSpareStripHeight: "The height of the pieces above the opening is a number greater than zero.",

    unitM: "m",
  },

  "weld-consumable": {
    seamType: "Weld type",
    seamTypeFillet: "fillet",
    seamTypeButtV: "butt, V groove",
    seamTypeButtX: "butt, X groove",

    filletMode: "Fillet weld size",
    filletModeLeg: "leg",
    filletModeThroat: "weld thickness (throat)",
    leg: "Fillet weld leg z",
    throat: "Weld thickness a",

    plateThickness: "Plate thickness t",
    grooveAngle: "Groove angle α",
    rootGap: "Root gap b",
    rootFaceHeight: "Root face height c",
    rootFaceHeightHint: "Must be smaller than the plate thickness.",

    reinforcement: "Weld reinforcement",
    reinforcementHint: "As a percentage of the cross-section.",
    weldLength: "Weld length",
    seamCount: "Number of identical welds",
    density: "Metal density",
    densityHint: "Default 7850 kg/m³ for unalloyed steel; for aluminium the user enters it.",
    efficiency: "Filler utilisation",
    efficiencyHint:
      "A manufacturer's datum for the process and diameter — the part of the melted filler that stays in the weld.",
    waste: "Wastage",

    wireDiameter: "Wire diameter",
    wireDiameterHint: "For the wire length; leave empty if the consumption is not expressed in metres of wire.",
    electrodeMass: "Mass of one electrode",
    electrodeMassHint: "With the usable part, for the number of electrodes.",
    electrodeUsableFraction: "Usable part of the electrode",
    spoolMass: "Mass of a wire coil",
    spoolMassHint: "For the number of coils — the wire is ordered by the coil, not the metre.",

    results: "Result",
    legUsed: "Leg used",
    crossSectionArea: "Weld cross-sectional area (with reinforcement)",
    weldMassPerMetre: "Weld metal mass per running metre",
    weldVolume: "Weld metal volume",
    weldMass: "Weld metal mass",
    consumableMass: "Filler mass",
    wireLength: "Wire length",
    electrodeCount: "Number of electrodes",
    spoolCount: "Number of wire coils",

    inputs: "Entered",
    formula:
      "fillet: A = z²/2   V groove: A = b·t + (t−c)²·tan(α/2)   X groove: A = b·t + 2·((t−c)/2)²·tan(α/2)   m_weld = V·ρ   m_filler = m_weld/η·(1+waste)",

    errorReinforcement: "The weld reinforcement is a number from 0 to 30%.",
    errorWeldLength: "The weld length is a number from 0.01 to 10000 m.",
    errorSeamCount: "The number of identical welds is a whole number from 1 to 10000.",
    errorDensity: "The metal density is a number from 2000 to 9000 kg/m³.",
    errorEfficiency: "The filler utilisation is a number from 0.3 to 1.",
    errorWaste: "Wastage is a number from 0 to 20%.",
    errorThroat: "The weld thickness a is a number greater than zero.",
    errorLeg: "The fillet weld leg is a number from 2 to 30 mm.",
    errorPlateThickness: "The plate thickness is a number from 1 to 100 mm.",
    errorGrooveAngle: "The groove angle is a number from 30 to 90 degrees.",
    errorRootGap: "The root gap is a number from 0 to 10 mm.",
    errorRootFaceHeight:
      "The root face height is a number from 0 to 10 mm and must be smaller than the plate thickness.",
    errorWireDiameter: "The wire diameter is a number from 0.6 to 2.4 mm.",
    errorElectrodeMass:
      "The electrode mass is a number from 10 to 500 g — entered together with the usable part.",
    errorElectrodeUsableFraction:
      "The electrode's usable part is a number from 50 to 95% — entered together with the electrode mass.",
    errorSpoolMass: "The wire coil mass is a number greater than zero.",

    unitMm: "mm",
    unitMm2: "mm²",
    unitCm3: "cm³",
    unitKg: "kg",
    unitKgM: "kg/m",
    unitM: "m",
  },

  "wood-moisture-movement": {
    initialDimension: "Initial dimension D₀",
    initialMoisture: "Initial wood moisture",
    initialMoistureHint: "Measured with a moisture meter, the wood's moisture percentage — not the humidity of the air.",
    finalMoisture: "Final wood moisture",
    grainDirection: "Grain direction",
    grainRadial: "radial",
    grainTangential: "tangential",
    grainLongitudinal: "longitudinal",

    shrinkageMode: "Method of entering the coefficient",
    shrinkageModeCoefficient: "shrinkage coefficient directly",
    shrinkageModeTotalShrinkage: "total shrinkage green → oven-dry",
    shrinkageCoefficient: "Shrinkage coefficient c",
    shrinkageCoefficientHint:
      "The percentage change in dimension per 1% moisture, for that species and direction — radial and tangential differ by up to a factor of two.",
    totalShrinkage: "Total shrinkage S (green → oven-dry)",
    totalShrinkageHint:
      "The coefficient is derived as S / fibre saturation point, assuming linearity.",

    fiberSaturationPoint: "Fibre saturation point",
    fiberSaturationPointHint:
      "Above this moisture the dimension no longer changes. Default 30%.",

    elementWidth: "Width of the clearance element W",
    installMoisture: "Wood moisture at installation",
    installMoistureHint: "A wood moisture percentage, not air humidity.",
    roomMoistureMin: "Expected room moisture, minimum",
    roomMoistureHint:
      "The wood moisture percentage in equilibrium with the room, not relative air humidity.",
    roomMoistureMax: "Expected room moisture, maximum",

    results: "Result",
    clampedInitialMoisture: "Initial moisture (clamped to FSP)",
    clampedFinalMoisture: "Final moisture (clamped to FSP)",
    dimensionChange: "Change in dimension",
    finalDimension: "Final dimension",
    derivedCoefficient: "Derived shrinkage coefficient",
    swellToMax: "Swelling travel to the maximum",
    shrinkToMin: "Shrinkage travel to the minimum",
    totalSwing: "Total going",

    inputs: "Entered",
    formula:
      "MC* = min(MC, FSP)   ΔD = D₀·(c/100)·(MC*₁−MC*₀)   ΔW⁺ = W·(c/100)·(MC*max−MC*install)   ΔW⁻ = W·(c/100)·(MC*install−MC*min)",

    errorInitialDimension: "The initial dimension is a number from 1 to 5000 mm.",
    errorInitialMoisture: "The initial moisture is a number from 0 to 40%.",
    errorFinalMoisture: "The final moisture is a number from 0 to 40%.",
    errorFiberSaturationPoint: "The fibre saturation point is a number from 25 to 35%.",
    errorShrinkageCoefficient:
      "The shrinkage coefficient is a number from 0.01 to 0.6 — enter either it or the total shrinkage, not both.",
    errorTotalShrinkage: "The total shrinkage is a number from 1 to 20%.",
    errorElementWidth: "The element width is a number greater than zero.",
    errorInstallMoisture: "The moisture at installation is a number from 3 to 25%.",
    errorRoomMoistureMin: "The minimum room moisture is a number from 3 to 25%.",
    errorRoomMoistureMax: "The maximum room moisture is a number from 3 to 25%.",

    unitMm: "mm",
    unitPercentPerPercent: "%/%",
  },
} as const;
