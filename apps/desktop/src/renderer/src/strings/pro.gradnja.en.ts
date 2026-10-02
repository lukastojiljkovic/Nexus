/**
 * Construction and design - the English copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those live
 * in the `name` and `blurb` tables of `./pro.en.ts`, because the drawer's
 * rail needs them before any surface is opened.
 *
 * **A unit is copy, not a constant.** "mm" and "m" are written here rather than
 * concatenated in the surface, so a translator can find every one of them and a
 * unit hard-coded in a component is a string `check:strings` cannot see.
 *
 * **Nothing in here judges.** Every tool in this pack that touches a load, a
 * height or a fall is `life-safety`, so its copy may name a quantity and may
 * name the user's own limit, and may not say what the two mean together
 * (`toolForbidsVerdict`). Where a limit appears below it is always "your
 * limit" - whose it is, said in the label - and never a verdict word such as
 * "satisfies", "safe" or "within regulation".
 */
export const PRO_GRADNJA_EN = {
  "stair-geometry": {
    rise: "Storey height",
    riseHint: "From finished floor to finished floor, in millimetres.",
    risers: "Number of risers",
    risersHint:
      "The number of rises, not the number of treads — there is one tread fewer when the flight ends at floor level.",
    going: "Tread",
    goingHint: "Tread depth in millimetres.",
    top: "End of the flight",
    topFlush: "Into the plane of the upper floor",
    topLanding: "Onto a landing level with the last rise",
    riserLimit: "Your limit for the riser height",
    goingLimit: "Your limit for the tread",
    limitHint: "From the regulation you apply. Nexus does not know which regulation that is and offers no value.",
    roundTo: "Rounding step",
    roundToHint: "At what riser height the marks are drawn on the rod. Default 1 mm.",

    results: "Result",
    riser: "Riser height",
    goings: "Number of treads",
    run: "Total going",
    pitch: "Pitch",
    blondel: "2r + g",
    blondelNote:
      "Blondel's 1675 expression is a defined quantity, not a regulation — it is shown as a number and compared with nothing.",
    ratio: "Ratio to your limit",
    riserRatio: "Height ÷ your limit",
    goingRatio: "Tread ÷ your limit",

    /**
     * The flight as it will actually be set out. Named „zaokruženo" rather than
     * „stvarno" on purpose: both numbers are real, and calling this one the real
     * one would say the exact riser above it was a draft.
     */
    rounded: "Rounded on the rod",
    roundedRiser: "Rounded riser height",
    roundedRise: "Resulting storey height",
    remainder: "Remainder on the last step",
    /**
     * What the remainder IS, said as arithmetic. Not „pazi" and not „greška":
     * the number is the finding, and what to do with it — razvući ga, promeniti
     * broj podizanja, pomeriti kotu poda — is the designer's posao.
     */
    remainderNote:
      "The difference between the requested and the resulting storey height. The whole amount falls on one step, usually the last one at the upper floor.",

    inputs: "Entered",
    formula: "r = H / n     θ = arctan(r / g)     B = 2r + g",

    /**
     * The refusals, keyed by the `reason` the core function returns. A surface
     * never composes its own: `stairFlight` names the input that made the answer
     * impossible, and this table is the only place that name becomes a sentence.
     */
    errorRise: "The storey height must be greater than zero.",
    errorRisers: "The number of risers is a whole number from 1 to 60.",
    errorGoing: "The tread must be greater than zero.",
    errorRoundTo: "The rounding step must be greater than zero.",

    unitMm: "mm",
    unitM: "m",
    unitDeg: "°",
  },

  "angle-units": {
    unit: "Input unit",
    unitDmsOpt: "Degrees, minutes, seconds",
    unitDegOpt: "Decimal degree",
    unitGonOpt: "Gradian",
    unitRadOpt: "Radian",
    sign: "Sign",
    signPos: "Positive",
    signNeg: "Negative",
    degrees: "Degrees",
    minutes: "Minutes",
    seconds: "Seconds",
    value: "Angle value",
    normalize: "Reduction to a full circle",
    normalizeHint: "The reduced value is shown always, even when this is off.",
    normalizeYes: "On",
    normalizeNo: "Off",

    results: "Result",
    resultDms: "Degrees-minutes-seconds",
    resultDeg: "Decimal degree",
    resultGon: "Gradian",
    resultRad: "Radian",
    resultNormDeg: "Reduced to [0, 360)",
    resultNormGon: "Reduced to [0, 400) gradians",
    resultOppDeg: "Opposite direction",
    resultOppGon: "Opposite direction (gradians)",

    inputs: "Entered",
    formula:
      "DMS: |x| = D + M/60 + S/3600     ° → rad: x·π/180     gon → rad: x·π/200     reduction: x − k·circle",

    errorDegrees: "Degrees must be zero or more.",
    errorMinutes: "Minutes is a number in [0, 60).",
    errorSeconds: "Seconds is a number in [0, 60).",
    errorValue: "The angle value must be a real number.",

    unitDeg: "°",
    unitGon: "gon",
  },

  "bar-spacing": {
    length: "Total length",
    lengthUnit: "Length unit",
    startCover: "Offset from the start",
    endCover: "Offset from the end",
    mode: "Method",
    modeMaxSpacing: "Largest spacing",
    modeCount: "Given number of pieces",
    modeMaxGap: "Largest clear spacing (infill)",
    maxSpacing: "Your largest spacing",
    maxGap: "Your largest clear spacing",
    limitHint: "From the regulation you apply. Nexus does not know which regulation that is and offers no value.",
    countLabel: "Number of pieces",
    layout: "Layout",
    layoutEnds: "Pieces at both ends",
    layoutField: "Pieces in the middle of the field",
    pieceWidth: "Width of one piece",
    pieceWidthHint: "Optional — needed for the axis spacing, required for the clear-spacing method.",

    results: "Result",
    count: "Number of pieces",
    spaces: "Number of spacings",
    spacing: "Actual spacing",
    spacingRatio: "Gap ÷ your limit",
    usableLength: "Usable length",
    axisPitch: "Axis spacing",
    positions: "Positions from the start",

    inputs: "Entered",
    formula:
      "U = L − e₁ − e₂     k = ceil(U/s_max), n = k+1 (both ends)     n = ceil(U/s_max) (middle of the field)     n = ceil((U−g)/(w+g)) (infill)     s = U/k or U/n",

    errorLength: "The total length must be greater than zero.",
    errorStartCover: "The offset from the start may not be negative.",
    errorEndCover: "The offset from the end may not be negative.",
    errorUsableLength: "The usable length (L − e₁ − e₂) must be greater than zero.",
    errorCount: "The number of pieces must be a whole number in the allowed range for the chosen layout.",
    errorMaxSpacing: "The largest spacing must be greater than zero.",
    errorPieceWidth: "The piece width must be greater than zero.",
    errorMaxGap: "The largest clear spacing cannot be achieved with the entered piece width and length.",

    unitM: "m",
    unitMm: "mm",
  },

  "beam-check": {
    scheme: "Static scheme",
    schemeSimpleUdl: "Simply supported beam, uniformly distributed load",
    schemeSimplePoint: "Simply supported beam, central point load",
    schemeCantileverUdl: "Cantilever, uniformly distributed load",
    schemeCantileverPoint: "Cantilever, end point load",
    span: "Span or overhang L",
    load: "Load q",
    force: "Force P",
    modulus: "Modulus of elasticity E",
    modulusHint: "A material property. Without it the deflection is not shown.",
    inertiaMode: "Second moment of area",
    inertiaModeDirect: "Entered directly",
    inertiaModeSection: "From a rectangular section b × h",
    inertia: "Second moment of area I",
    width: "Section width b",
    widthHint: "The dimension perpendicular to the plane of bending.",
    height: "Section height h",
    heightHint: "The dimension in the plane of bending. Swapping it with the width changes I cubically.",
    sectionModulus: "Section modulus W",
    sectionModulusHint: "Optional, when the section is not rectangular. Without it the stress is not shown.",
    stressLimit: "Your stress limit",
    deflectionRatioLimit: "Your limit for the L/f ratio",
    limitHint: "From the regulation you apply. Nexus does not know which regulation that is and offers no value.",

    results: "Result",
    reaction: "Support reaction",
    shear: "Maximum shear force",
    maxMoment: "Maximum bending moment",
    fixingMoment: "Fixing moment",
    stress: "Bending stress σ = M/W",
    stressRatio: "Stress ÷ your limit",
    deflection: "Maximum deflection f",
    spanOverDeflection: "L/f ratio",
    deflectionRatio: "Your L/f limit ÷ L/f",

    inputs: "Entered",
    formula:
      "simple+UDL: R=qL/2, M=qL²/8, f=5qL⁴/384EI     simple+point: R=P/2, M=PL/4, f=PL³/48EI     cantilever+UDL: R=qL, M=qL²/2, f=qL⁴/8EI     cantilever+point: R=P, M=PL, f=PL³/3EI",

    errorSpan: "The span or overhang must be greater than zero.",
    errorLoad: "The load may not be negative.",
    errorForce: "The force may not be negative.",
    errorModulus: "The modulus of elasticity must be greater than zero.",
    errorSection: "The section width and height must be greater than zero.",
    errorSectionModulus: "The section modulus must be greater than zero.",
    errorInertia: "The second moment of area must be greater than zero.",

    unitKn: "kN",
    unitKnm: "kNm",
    unitKnm2: "kN/m",
    unitMpa: "MPa",
    unitMm: "mm",
    unitM: "m",
  },

  "concrete-takeoff": {
    kind: "Element type",
    kindSlab: "Slab (a × b × d)",
    kindBeam: "Beam (b × h × L)",
    kindColumn: "Column (a × b × h)",
    kindStripFooting: "Strip footing (b × h × L)",
    kindPadFooting: "Pad footing (a × b × h)",
    a: "Dimension a",
    b: "Dimension b",
    d: "Thickness d",
    h: "Height h",
    length: "Length L",
    pieces: "Number of pieces",
    openings: "Opening deduction",
    openingsHint:
      "Total opening area in the slab. It reduces the volume, not the formwork — an opening is shuttered from the side.",
    waste: "Wastage",
    wasteHint: "Depends on the site and the method of placing.",
    mixerVolume: "Mixer volume",
    density: "Concrete density",
    densityHint: "A material datum for the user's mix.",
    rebarRate: "Reinforcement per m³",
    rebarRateHint: "A design datum. The reinforcement mass is calculated from the net volume, without wastage.",

    results: "Result",
    netVolume: "Net volume",
    grossVolume: "Volume with wastage",
    formwork: "Formwork area",
    formworkNote:
      "Beam under a slab: the formwork (2h + b)·L counts two sides and the beam's own soffit in full — if that soffit is part of a strip the slab already counts, do not add it there too.",
    concreteMass: "Mass of concrete",
    rebarMass: "Rebar mass",
    batches: "Number of mixer loads",

    inputs: "Entered",
    formula:
      "slab: V=(a·b−ΣA_open)·d·n, form=(a·b+2(a+b)d)·n     beam: V=bhLn, form=(2h+b)Ln     column/pad: V=abhn, form=2(a+b)hn     strip: V=bhLn, form=2hLn     V_wastage=V·(1+r/100)",

    errorPieces: "The number of pieces is a whole number of 1 or more.",
    errorWaste: "Wastage is a number from 0 to 100%.",
    errorMixerVolume: "The mixer volume must be greater than zero.",
    errorDensity: "The concrete density is a number from 1000 to 3500 kg/m³.",
    errorRebarRate: "The reinforcement quantity must be greater than zero.",
    errorOpenings: "The opening deduction may not be negative or greater than or equal to the a × b area.",
    errorA: "Dimension a must be greater than zero.",
    errorB: "Dimension b must be greater than zero.",
    errorD: "Thickness d must be greater than zero.",
    errorH: "Height h must be greater than zero.",
    errorLength: "Length L must be greater than zero.",

    unitM3: "m³",
    unitM2: "m²",
    unitT: "t",
    unitKg: "kg",
    unitPercent: "%",
  },

  "drawing-scale": {
    denominator: "Scale 1:M",
    denominatorHint: "The denominator M. Below 1 is an enlargement by ISO 5455, e.g. 2:1 is M = 0.5.",
    direction: "Direction",
    directionPaperToReal: "Paper → real",
    directionRealToPaper: "Real → paper",
    lengthOnPaper: "Length on paper",
    lengthReal: "Real length",

    results: "Result",
    paperLength: "Length on paper",
    realLength: "Real length",

    paperArea: "Area measured on paper",
    paperAreaHint: "In cm², optional. The scale factor is squared for area.",
    areaResults: "Real area",
    realArea: "Real area",

    objectWidth: "Object size — width",
    objectHeight: "Object size — height",
    sheet: "Sheet format",
    orientation: "Orientation",
    orientationPortrait: "Portrait",
    orientationLandscape: "Landscape",
    margin: "Margin",
    marginHint: "Header and edges — the office's choice, deducted on both sides of both axes.",

    fitResults: "Fitting on the sheet",
    drawnWidth: "Drawn width",
    drawnHeight: "Drawn height",
    usableWidth: "Usable sheet width",
    usableHeight: "Usable sheet height",
    fits: "Fit",
    fitsYes: "Fits in the chosen orientation",
    fitsRotated: "Fits only turned by 90°",
    fitsNo: "Does not fit",
    seriesDenominator: "The largest scale from the series that fits",
    seriesNone: "None from the series",
    requiredDenominator: "The exact scale at which the object would just fit",

    inputs: "Entered",
    formula:
      "L_real[m] = L_paper[mm]·M/1000     L_paper[mm] = L_real[m]·1000/M     A_real = A_paper[cm²]·10⁻⁴·M²     w,h = W,H·1000/M",
    source: "Sheet formats: ISO 216:2007, A series. Scale series: ISO 5455:1979.",

    errorDenominator: "The denominator M must be greater than zero.",
    errorLength: "The length must be greater than zero.",
    errorPaperArea: "The area on paper must be greater than zero.",
    errorObjectWidth: "The object width must be greater than zero.",
    errorObjectHeight: "The object height must be greater than zero.",
    errorMargin: "The margin must leave a positive usable sheet area.",

    unitMm: "mm",
    unitM: "m",
    unitM2: "m²",
  },

  "earthwork-prismoidal": {
    profiles: "Profiles",
    profilesHint:
      "One row per profile: station;excavation area;fill area;mean excavation area;mean fill area. The last two are optional and belong to the segment this row starts.",
    bulking: "Bulking",
    bulkingHint: "A soil property you know from the site. Applied only to the excavation being removed.",
    settlement: "Fill settlement",

    results: "Result per segment",
    colFrom: "From (m)",
    colTo: "To (m)",
    colLength: "Length (m)",
    colCut: "Excavation (m³)",
    colFill: "Fill (m³)",
    colMethod: "Method",
    methodPrismoidal: "Prismoidal",
    methodAverage: "Average end areas",

    totalCut: "Total excavation",
    totalFill: "Total fill",
    balance: "Balance (excavation − fill), in situ",
    cutLoose: "Excavation in a bulked state",
    fillWithSettlement: "Fill after settlement",
    balanceAdjusted: "Balance in adjusted states",
    balanceNote:
      "Bulking is applied only to excavation, settlement only to fill — these two lines are in different measurement states and are not added to the in-situ balance.",

    inputs: "Entered",
    formula:
      "average end areas: V=L(A₁+A₂)/2     prismoidal (when A_m exists): V=(L/6)(A₁+4A_m+A₂)",

    errorRows: "At least two profiles with strictly increasing stations are needed.",
    errorBulking: "Bulking is a number from 0 to 100%.",
    errorSettlement: "Settlement is a number from 0 to 100%.",
    errorStation: "The station must strictly increase from row to row.",
    errorCut: "The excavation area may not be negative.",
    errorFill: "The fill area may not be negative.",
    errorMidCut: "The mean excavation area may not be negative, and does not belong to the last row.",
    errorMidFill: "The mean fill area may not be negative, and does not belong to the last row.",

    unitM3: "m³",
  },

  "level-run": {
    startElevation: "Elevation of the start benchmark",
    readings: "Readings",
    readingsHint:
      "One row per point: name;backsight(BS);intermediate(IS);foresight(FS);sight length. An empty cell means that kind of reading is absent; the sight length belongs to the station the row opens with a backsight.",
    closingElevation: "Elevation of the end benchmark",
    closingElevationHint: "Optional. Without it the misclosure is not shown.",

    results: "Result",
    colPoint: "Point",
    colInstrument: "Height of instrument",
    colElevation: "Elevation",
    colCorrection: "Correction",
    colAdjusted: "Corrected elevation",

    firstElevation: "Start elevation",
    lastElevation: "End elevation",
    sumBacksights: "ΣBS",
    sumForesights: "ΣFS",
    checkDifference: "Check: ΣBS − ΣFS − (end − start)",
    misclosure: "Misclosure",
    stations: "Number of stations",
    checkNote:
      "Intermediate sights deliberately do not enter the check — a point seen only as an IS does not carry the height onward.",
    readingCount: "Number of reading rows",

    inputs: "Entered",
    formula:
      "HI = H(BS) + BS     H = HI − IS     H = HI − FS     correction_i = −f·(weight_i/total weight)",

    errorStartElevation: "The elevation of the start benchmark must be a real number.",
    errorRows: "At least one reading row is needed.",
    errorClosingElevation: "The elevation of the end benchmark must be a real number.",
    errorRow: "Every row must have at least one of: backsight, intermediate, foresight.",
    errorBacksight: "A backsight (BS) requires a point with an already known elevation.",
    errorIntermediate: "An intermediate sight (IS) requires an open station.",
    errorForesight: "A foresight (FS) requires an open station.",
    errorDistance: "The sight length belongs to a row with a backsight (BS), and must be greater than zero.",

    unitMm: "mm",
  },

  "rebar-weight": {
    diameter: "Bar diameter Ø",
    diameterHint: "Free entry from 1 to 60 mm — a typing shortcut, not a suggested bar.",
    direction: "Direction of calculation",
    directionToMass: "From metres to kilograms",
    directionToLength: "From kilograms to metres",
    barLength: "Length of one bar",
    bars: "Number of bars",
    mass: "Mass",
    stockLength: "Bar length in stock",
    stockLengthHint: "Optional. Without it only the total length is shown, without the number of whole bars.",

    results: "Result",
    massPerMetre: "Mass per running metre",
    totalLength: "Total length",
    totalMass: "Total mass",
    totalTonnes: "Total mass (tonnes)",
    wholeBars: "Number of whole bars",
    remainder: "Remainder",
    densityNote:
      "ρ = 7850 kg/m³ is the nominal-mass convention of EN 10080 and ISO 6935-2, not a measured density of any batch.",

    inputs: "Entered",
    formula: "m′ = (π/4)·(Ø/1000)²·7850     L = length·count     M = m′·L     (reverse: L = M/m′)",

    errorDiameter: "The diameter is a number from 1 to 60 mm.",
    errorBarLength: "The bar length must be greater than zero.",
    errorBars: "The number of bars is a whole number, one or more.",
    errorMass: "The mass must be greater than zero.",

    unitMm: "mm",
    unitM: "m",
    unitKg: "kg",
    unitT: "t",
    unitKgm: "kg/m",
  },

  "roof-pitch": {
    pitch: "Pitch",
    pitchUnit: "Slope unit",
    unitDegOpt: "Degree",
    unitPercentOpt: "Percentage",
    unitRatioOpt: "Ratio 1:n",
    base: "Base b",
    eaves: "Eaves overhang",
    planArea: "Horizontal projection area",
    secondBase: "Second base b₂ (for the hip)",
    secondBaseHint: "The same value as the base gives a hip at 45° in plan.",

    results: "Result",
    angle: "Pitch angle",
    height: "Height to the ridge",
    rafter: "Rafter length",
    rafterWithEaves: "Rafter length with the overhang",
    slopeArea: "Actual roof-plane area",
    hipLength: "Hip length",
    hipAngle: "Hip pitch",

    inputs: "Entered",
    formula:
      "h = b·tanθ     rafter = b/cosθ     area = projection/cosθ     hip: b_g=√(b₁²+b₂²), length=√(b_g²+h²)",

    errorPitch: "The pitch must be in the range 0° to 90° (exclusive).",
    errorBase: "The base must be greater than zero.",
    errorEaves: "The eaves overhang may not be negative.",
    errorPlanArea: "The projection area must be greater than zero.",
    errorSecondBase: "The second base must be greater than zero.",

    unitDeg: "°",
    unitM: "m",
    unitM2: "m²",
  },

  "room-surfaces": {
    planMode: "How the base was measured",
    planModeRectangle: "Rectangular, length × width",
    planModePerimeter: "Irregular, a perimeter was entered",
    length: "Room length",
    width: "Room width",
    perimeter: "Scope",
    height: "Clear height",
    openings: "Openings",
    openingsHint:
      "One row per opening: width;height;count;door or window;include the sill(yes/no, optional — empty follows the convention: on for a window, off for a door).",
    deductOpenings: "Deducting openings from the wall area",
    yes: "On",
    no: "Off",
    revealDepth: "Reveal depth",
    ceilingArea: "Ceiling area",
    ceilingAreaHint:
      "Required when the base was entered as a perimeter — a perimeter does not determine the area it encloses.",
    includeWalls: "Include the walls in the total area",
    includeReveals: "Include the reveals in the total area",
    includeCeiling: "Include the ceiling in the total area",
    coverage: "Material coverage",
    coverageHint:
      "From the product label. The same figure means a different quantity in the other two modes below.",
    coverageMode: "Coverage kind",
    coverageAreaPerLitre: "m² per litre",
    coverageMassPerArea: "kg per m²",
    coats: "Number of coats",

    results: "Result",
    grossWall: "Gross wall area",
    openingArea: "Total opening area",
    netWall: "Net wall area",
    revealLength: "Exposed length of the reveals",
    revealArea: "Reveal area",
    ceiling: "Ceiling",
    totalArea: "Total area to be finished",
    quantity: "Quantity of material needed",

    inputs: "Entered",
    formula:
      "P=2(L+W) or entered     gross=P·H     A_open=Σ(w·h·n)     net=P·H−A_open     reveal: 2h+s (without a sill) or 2h+2s (with a sill)     quantity=total·coats/coverage or total·coats·coverage",

    errorHeight: "The clear height must be greater than zero.",
    errorLength: "The room length must be greater than zero.",
    errorWidth: "The room width must be greater than zero.",
    errorPerimeter: "The perimeter must be greater than zero.",
    errorRevealDepth:
      "The reveal depth is required when the reveals are included, and may not be negative.",
    errorOpening: "Every opening must have a width, a height and a whole count greater than zero.",
    errorCeilingArea:
      "The ceiling area is required when the ceiling is included and the base was entered as a perimeter.",
    errorCoverage: "The coverage must be greater than zero.",
    errorCoverageMode: "The coverage kind must be chosen when the coverage is entered.",
    errorCoats: "The number of coats is a whole number from 1 to 20.",

    unitM: "m",
    unitM2: "m²",
    unitL: "l",
    unitKg: "kg",
  },

  "slope-grade": {
    known: "Which two data are known",
    knownRunRise: "Length and height difference",
    knownRunSlope: "Length and slope",
    knownRiseSlope: "Height difference and slope",
    knownSlantSlope: "Slant length and slope",
    knownSlantRise: "Slant length and height difference",
    knownSlantRun: "Slant length and horizontal length",
    run: "Horizontal length L",
    rise: "Height difference h",
    riseHint: "Negative is a fall in the opposite direction.",
    slant: "Slant length s",
    slope: "Pitch",
    slopeUnit: "Slope unit",
    unitPercentOpt: "Percentage",
    unitPermilleOpt: "Permille",
    unitDegOpt: "Degree",
    unitRatioOpt: "Ratio 1:n",

    results: "Result",
    percent: "Slope in percent",
    permille: "Slope in permille",
    degrees: "Slope in degrees",
    ratio: "Slope as a ratio",
    ratioNote: "The ratio 1:n is always height : base — one metre of height to n metres of base.",
    descending: "Direction",
    descendingYes: "Falls",
    descendingNo: "Rises or is level",

    inputs: "Entered",
    formula:
      "p[%]=100h/L   p[‰]=1000h/L   θ=atan(h/L)   1:n=L/h   s=√(L²+h²)   reverse: h=L·p/100; L=s·cosθ, h=s·sinθ; L=n·h; h=L/n",

    errorRun: "The horizontal length must be greater than zero.",
    errorRise: "The height difference must be a real number.",
    errorSlant: "The slant length must be greater than zero and greater than the other entered length.",
    errorSlope: "The slope must be less than 90° and in the allowed range for the chosen unit.",

    unitPercent: "%",
    unitPermille: "‰",
    unitDeg: "°",
    unitM: "m",
  },

  "square-check": {
    sideA: "Side a",
    sideB: "Side b",
    measuredDiagonal: "Measured diagonal",
    secondDiagonal: "Second diagonal",
    secondDiagonalHint:
      "Optional, to check the quadrilateral. The prediction holds only if the shape is a parallelogram.",

    results: "Result",
    expectedDiagonal: "Required diagonal (right angle)",
    diagonalError: "Difference measured − required",
    angle: "Actual angle at the vertex",
    angleError: "Deviation from a right angle",
    offsetAlongA: "Displacement of the end of side b, parallel to side a",
    diagonalDifference: "Difference measured − second diagonal",
    expectedSecondDiagonal: "Second diagonal for a parallelogram (prediction)",
    parallelogramSkew: "Measured second diagonal − prediction",

    inputs: "Entered",
    formula:
      "d₀=√(a²+b²)     cosα=(a²+b²−d²)/(2ab)     α=acos(cosα)     displacement=b·cosα     q=√(2(a²+b²)−p²) (parallelogram only)",

    errorSideA: "Side a must be greater than zero.",
    errorSideB: "Side b must be greater than zero.",
    errorMeasuredDiagonal: "The measured diagonal must satisfy the triangle inequality with a and b.",
    errorSecondDiagonal: "The second diagonal must be greater than zero.",

    unitM: "m",
    unitMm: "mm",
    unitDeg: "°",
  },

  "survey-bearing-distance": {
    direction: "Direction of calculation",
    directionInverse: "From coordinates (second surveying task)",
    directionForward: "From angle and length (first surveying task)",
    pointAY: "Point A — Y (east)",
    pointAX: "Point A — X (north)",
    pointBY: "Point B — Y (east)",
    pointBX: "Point B — X (north)",
    bearingUnit: "Bearing unit",
    unitGonOpt: "Gradian",
    unitDegOpt: "Degree",
    unitDmsOpt: "Degrees-minutes-seconds",
    sign: "Sign",
    signPos: "Positive",
    signNeg: "Negative",
    degrees: "Degrees",
    minutes: "Minutes",
    seconds: "Seconds",
    bearing: "Bearing ν",
    distance: "Length d",

    results: "Result",
    deltaY: "ΔY",
    deltaX: "ΔX",
    bearingGon: "Bearing (gradians)",
    bearingDeg: "Bearing (degrees)",
    oppositeGon: "Opposite direction (gradians)",
    oppositeDeg: "Opposite direction (degrees)",
    newY: "New point — Y",
    newX: "New point — X",

    inputs: "Entered",
    formula:
      "second task: ΔY=Yb−Ya, ΔX=Xb−Xa, d=√(ΔY²+ΔX²), ν=atan2(ΔY,ΔX)     first task: Yb=Ya+d·sinν, Xb=Xa+d·cosν     reverse: ν±200 gon (±180°)",

    errorPointA: "The coordinates of point A must be real numbers.",
    errorPointB: "The coordinates of point B must be real numbers.",
    errorDistance: "Length d may not be negative.",
    errorBearing: "The bearing must be entered.",

    unitM: "m",
  },

  "tile-count": {
    area: "Area",
    tileWidth: "Piece format — width a",
    tileHeight: "Piece format — height b",
    joint: "Joint width",
    waste: "Wastage",
    wasteHint: "Depends on the format, the bond and the geometry of the room.",
    boxMode: "Box given by",
    boxModePerBox: "Pieces per box",
    boxModeAreaPerBox: "Area per box",
    perBox: "Pieces per box",
    areaPerBox: "Area per box",

    results: "Result",
    perSquareMetre: "Pieces per m²",
    areaWithWaste: "Area needed with wastage",
    pieces: "Total number of pieces",
    boxes: "Number of boxes",
    surplusPieces: "Surplus from the last box (pieces)",
    surplusArea: "Surplus from the last box (nominal area)",
    gridNote:
      "The formula (a+s)(b+s) holds for a straight grid. Offset and herringbone layouts leave the same area but different cutting waste — that is why wastage is always your input.",

    inputs: "Entered",
    formula:
      "piece_eff=(a+s)(b+s)     pieces/m²=10⁶/eff     A_wastage=A·(1+r/100)     n=ceil(A_wastage·10⁶/eff)     boxes=ceil(n/perBox) or ceil(A_wastage/areaPerBox)",

    errorArea: "The area must be greater than zero.",
    errorTileWidth: "The piece width must be greater than zero.",
    errorTileHeight: "The piece height must be greater than zero.",
    errorJoint: "The joint width may not be negative.",
    errorWaste: "Wastage is a number from 0 to 100%.",
    errorPerBox: "The number of pieces per box is a whole number, one or more.",
    errorAreaPerBox: "The area per box must be greater than zero.",

    unitM2: "m²",
    unitMm: "mm",
  },

  "trench-volume": {
    length: "Trench length L",
    widthMode: "Bottom width given by",
    widthModeDirect: "Direct entry",
    widthModeFromPipe: "Pipe diameter and working space",
    bottomWidth: "Bottom width b",
    workingSpace: "Working space on each side",
    workingSpaceHint: "The bottom width is derived as the pipe diameter + 2 × the working space.",
    depth: "Depth h",
    batter: "Side slope m",
    limitHint:
      "Horizontal per unit of height, on each side. A regulated and design figure — zero is a vertical side.",
    pipeDiameter: "Outer pipe diameter",
    beddingThickness: "Bedding thickness",
    bulking: "Bulking",
    bulkingHint: "A soil property from the site. Applied only to the soil being removed.",
    returnsSpoil: "Excavated soil is returned as backfill",
    returnsSpoilHint: "When off, the whole excavation is surplus for removal — nothing is returned to the trench.",
    yes: "Yes",
    no: "No",

    results: "Result",
    crossSection: "Cross-sectional area",
    topWidth: "Trench width at the top",
    excavation: "Excavation volume",
    bedding: "Bedding volume",
    pipe: "Pipe volume",
    backfill: "Backfill volume",
    surplus: "Surplus for removal, in situ",
    surplusLoose: "Surplus for removal, bulked",

    inputs: "Entered",
    formula:
      "A=h(b+mh)     top=b+2mh     V=A·L     V_bedding=b·t·L     V_pipe=(π/4)d²L     backfill=V−bedding−pipe (if returned) otherwise 0     surplus(1+bulk/100)",

    errorLength: "The trench length must be greater than zero.",
    errorDepth: "The depth must be greater than zero.",
    errorBatter: "The side slope may not be negative.",
    errorBulking: "Bulking is a number from 0 to 100%.",
    errorPipeDiameter: "The pipe diameter must be greater than zero and not greater than the bottom width.",
    errorBottomWidth:
      "The bottom width must be greater than zero, or derived from the pipe diameter and the working space.",
    errorBeddingThickness:
      "The bedding thickness may not be negative, and together with the pipe diameter must fit within the depth.",

    unitM: "m",
    unitM2: "m²",
    unitM3: "m³",
  },

  "wall-u-value": {
    layers: "Layers",
    layersHint:
      "One row per layer, inside to outside: name;thickness in cm;λ in W/(m·K);resistance in m²K/W. The last cell is for an unventilated air layer — when filled it is used directly and beats the thickness and λ.",
    rsi: "Internal surface resistance Rsi",
    rsiHint: "Depends on the direction of heat flow, from the standard you apply.",
    rse: "External surface resistance Rse",
    insideTemperature: "Internal temperature",
    outsideTemperature: "External temperature",

    results: "Result",
    colLayer: "Layer",
    colResistance: "Resistance (m²K/W)",
    colShare: "Weight",
    colBoundaryTemp: "Temperature on the outer side of the layer",
    totalResistance: "Total resistance R",
    uValue: "U-value",
    innerSurfaceTemperature: "Internal surface temperature",
    outerSurfaceTemperature: "External surface temperature",
    scopeNote:
      "One-dimensional steady state, homogeneous layers only. Without thermal bridges, without ΔU for mechanical fixings, without averaging a non-homogeneous layer and without a well-ventilated air layer.",

    inputs: "Entered",
    formula:
      "R_layer=d/λ     R_total=Rsi+ΣR+Rse     U=1/R_total     share=R_layer/R_total     θ_k=θi−((Rsi+ΣR to k)/R_total)·(θi−θe)",

    errorLayers: "At least one and at most twenty layers are needed.",
    errorRsi: "Rsi is a number from 0 to 1 m²K/W.",
    errorRse: "Rse is a number from 0 to 1 m²K/W.",
    errorResistance: "The layer resistance must be greater than zero.",
    errorThickness: "The layer thickness must be greater than zero.",
    errorConductivity: "The thermal conductivity λ must be greater than zero.",

    unitWm2k: "W/(m²K)",
    unitC: "°C",
  },
} as const;
