/**
 * „Nekretnine" — the English copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment and `nekretnine.tsx`
 * spell it. The tool's NAME and its one-line blurb are not here: those live in
 * a table another process owns.
 *
 * **A unit is copy, not a constant** — written here, never concatenated raw in
 * the surface. **Nothing in here judges**: every regulated figure (a rate, an
 * index, a coefficient, a notice period) is "the one you enter", never
 * described as correct or permitted, and every comparison against the user's
 * own limit is a bare ratio with no sentence about what it means.
 */
export const PRO_NEKRETNINE_EN = {
  "cashflow-npv-irr": {
    flows: "Cash flows",
    flowsHint:
      "One flow per line, in period order starting from CF₀. An outflow with a minus, e.g. -1000 then 600 then 600.",
    discountRate: "Discount rate per period",
    discountRateHint:
      "Your required return per period, in percent. The tool assumes none.",
    periodLabel: "Period label",
    periodLabelHint: "Just a caption above the table — it does not enter the calculation.",
    periodYear: "years",
    periodMonth: "month",
    periodQuarter: "quarter",

    results: "Result",
    colPeriod: "Period",
    colCashflow: "Flow",
    colDiscounted: "Discounted",
    npv: "NPV",
    undiscountedTotal: "Sum of undiscounted flows",
    paybackPlain: "Payback period (undiscounted)",
    paybackDiscounted: "Payback period (discounted)",
    paybackNone: "the entered series never pays back",
    irr: "IRR",
    irrNoSignChange: "all flows have the same sign — the IRR is not shown",
    irrNotUnique: "the series does not have exactly one sign change — the IRR is not unique and is not shown",
    irrOutsideRange: "the root is not in the searched range [−99.99%; 1000%]",
    signChanges: "Number of sign changes",

    inputs: "Entered",
    formula:
      "NPV = Σ CF_t / (1+r)^t     IRR: NPV(x) = 0, only when the series has exactly one sign change",

    errorCashflows: "Enter at least one cash flow, one number per line.",
    errorDiscountRate: "The discount rate must be greater than −100%.",

    unitPercent: "%",
    unitPeriods: "periods",
  },

  "cost-allocation": {
    total: "Total amount to allocate",
    totalHint: "The currency unit is not named. It may also be negative (a refund).",
    rows: "Lines",
    rowsHint:
      "One row per item: name;key, e.g. Flat A;45.50 — the key is m² or any positive weight.",
    step: "Rounding step",
    stepHint: "The currency unit, e.g. 0.01 or 1. Default 0.01.",

    results: "Result",
    colName: "Name",
    colShare: "Weight",
    colExact: "Exact amount",
    colUnits: "Units",
    colAmount: "Final amount",
    colRemainder: "Remainder",
    checkSum: "Check sum",
    remainderUnits: "Remainder units distributed",
    remainderRuleNote:
      "The remainder goes to the rows with the largest fractional part; on equal remainders the earlier row wins.",

    inputs: "Entered",
    formula:
      "amount_i = total × key_i / Σkey, in whole step units, remainder by the largest fraction",

    errorTotal: "The total amount must be a multiple of the rounding step.",
    errorStep: "The rounding step must be greater than zero.",
    errorWeights: "Every row must have a name and an allocation key greater than zero.",

    yes: "yes",
    no: "no",
  },

  "late-payment-interest": {
    debt: "Debt amount",
    annualRate: "Annual interest rate",
    annualRateHint:
      "From the contract or the regulation you apply. Nexus knows and offers none.",
    dueDate: "Due date",
    dateHint: "Format dd.mm.yyyy.",
    paymentDate: "Payment date",
    days: "Number of days late (alternative)",
    daysHint:
      "Fill this in instead of both dates, or with the due date to check that the two inputs agree.",
    basis: "Year basis",
    basis365: "365 days",
    basis360: "360 days",
    basisActual: "actual days (ACT/ACT)",
    method: "Method",
    methodProportional: "proportional",
    methodConformal: "conformal",

    results: "Result",
    countingRuleNote: "The due day is not counted, the payment day is.",
    days2: "Number of days late",
    yearFraction: "Time fraction f",
    interest: "Interest calculated",
    total: "Total to pay",
    ratioToDebt: "Interest-to-debt ratio",
    interestPerDay: "Interest per day late",
    interestPerDayNone: "no days late",
    compoundsAnnuallyNote:
      "The conformal method compounds interest annually over a period longer than a year — whether that is allowed is a legal question the tool does not decide.",
    impliedPaymentDate: "Payment date implied by the entered number of days",
    colYear: "Year",
    colDaysInYear: "Days in that year",
    colYearLength: "Divisor (year length)",

    inputs: "Entered",
    formula:
      "proportional: I = debt × rate/100 × f     conformal: I = debt × ((1+rate/100)^f − 1)     f = days/basis",

    errorDebt: "The debt amount must be greater than zero.",
    errorAnnualRate: "The annual interest rate is from 0 to 1000%.",
    errorDueDate:
      "The due date is not a valid date, or is missing for the “actual days” basis.",
    errorPaymentDate: "The payment date is not a valid date or is before the due date.",
    errorDays: "The number of days late is a whole number from 0 to 400000.",

    unitPercent: "%",
  },

  "lease-term-dates": {
    start: "Start date",
    dateHint: "Format dd.mm.yyyy.",
    months: "Duration (months)",
    noticeAmount: "Notice period",
    noticeHint: "From your contract. Nexus knows and suggests no period.",
    noticeUnit: "Unit of the notice period",
    noticeUnitDays: "days",
    noticeUnitMonths: "months",
    installmentDay: "Instalment due day of the month",
    installmentDayHint: "A whole number from 1 to 31. Leave empty so the list of instalments is not shown.",

    results: "Result",
    expiry: "Expiry date",
    clamped: "day shortened to the end of the shorter month",
    expiryDayClamped: "shortened",
    expiryClampedNote:
      "The day was shortened to the last day of the shorter month. This is a choice of convention, not a fact contracts always agree on.",
    lastValidDay: "Last day of validity",
    noticeDeadline: "Latest date of notice",
    beforeStart: "before the contract start date",
    noticeBeforeStartNote:
      "The entered notice period is longer than the duration — this date falls before the contract start.",
    totalDays: "Total duration (days)",
    colInstallmentNo: "Instalment number",
    colInstallmentDate: "Due date",
    installmentsAdvanceNote:
      "The list assumes rent in advance — each instalment falls due at the start of its period.",

    inputs: "Entered",
    formula:
      "expiry = start + duration months (the cut-off day is clamped to the end of the shorter month)     notice = last_day − period",

    errorStart: "The start date is not a valid date.",
    errorMonths: "The duration is a whole number of months from 1 to 600.",
    errorNoticeAmount: "The notice period is a whole number from 0 to 100000.",
    errorNoticeUnit: "A unit must be chosen with the notice period.",
    errorInstallmentDay: "The instalment due day is a whole number from 1 to 31.",
  },

  "loan-amortization": {
    principal: "Loan amount",
    annualRate: "Nominal annual interest rate",
    annualRateHint: "A contractual/market figure. Nexus remembers and offers none.",
    months: "Number of monthly instalments",
    balanceMonth: "Month for which the remaining debt is wanted",
    balanceMonthHint: "A whole number from 0 to the number of instalments. Optional.",
    prepayment: "Early repayment amount",
    prepaymentMonth: "Month of the early repayment",
    prepaymentMonthHint: "A whole number from 0 to (number of instalments − 1) — the payment immediately after that instalment. Optional.",

    results: "Result",
    conventionNote:
      "Monthly rate i = NAR/12 (proportional convention). The conformal convention gives different numbers.",
    payment: "Monthly instalment",
    totalPaid: "Total paid",
    totalInterest: "Total interest",
    principalSum: "Check sum of principal",
    balanceAt: "Remaining debt after that instalment",
    colMonth: "Instalment",
    colPayment: "Instalment amount",
    colInterest: "Interest",
    colPrincipal: "Principal repayment",
    colBalance: "Remaining debt",
    payoff: "Amount to close the loan",
    closesNote:
      "The payment is equal to or greater than the remaining debt — the loan closes immediately, with no remaining instalments.",
    balanceBefore: "Remaining debt before the payment",
    balanceAfter: "Remaining debt after the payment",
    shorterTerm: "Option A — same instalment, shorter term",
    lowerPayment: "Option B — same term, lower instalment",
    instalments: "Remaining number of instalments",
    finalPayment: "Last (reduced) instalment",
    interestSavings: "Interest saved compared with the plan without the payment",

    inputs: "Entered",
    formula:
      "i = NAR/100/12     A = P·i / (1 − (1+i)^(−n))     the table uses the rounded instalment and the rounded monthly interest",

    errorPrincipal: "The loan amount must be greater than zero.",
    errorAnnualRate: "The nominal annual interest rate is from 0 to 100%.",
    errorMonths: "The number of monthly instalments is a whole number from 1 to 600.",
    errorBalanceMonth: "The month for the remaining debt is a whole number from 0 to the number of instalments.",
    errorPrepayment: "The early repayment amount must be greater than zero.",
    errorPrepaymentMonth: "The month of the early repayment is a whole number from 0 to (number of instalments − 1).",

    unitPercent: "%",
  },

  "ownership-shares": {
    rows: "Shares",
    rowsHint: "One share per line, as a fraction numerator/denominator, e.g. 1/3.",
    totalArea: "Total area",
    totalAreaHint: "m², optional — adds each share's area to the table.",

    results: "Result",
    colRow: "Line",
    colFraction: "Share (reduced)",
    colPercent: "Percentage",
    colAtCommonDenominator: "Over the common denominator",
    colArea: "Area",
    sum: "Sum of shares",
    comparison: "Ratio to the whole",
    comparisonExact: "the sum is exactly 1",
    comparisonShort: "short of the whole by",
    comparisonOver: "over the whole by",
    commonDenominator: "Common denominator",
    areaCheckSum: "Check sum of the rounded areas",

    reverseTitle: "Reverse direction: the share from two areas",
    partArea: "Area of the part",
    wholeArea: "Total area",
    reverseFraction: "Share (reduced)",
    reversePercent: "Percentage",

    inputs: "Entered",
    formula:
      "a/b + c/d = (ad+cb)/(bd), reduced by Euclid     percentage = numerator × 100 / denominator, half up",

    errorRows: "Enter at least one share as a fraction.",
    errorNumerator: "The numerator is a whole number from 0 to 10^15.",
    errorDenominator: "The denominator is a whole number greater than 0, up to 10^15.",
    errorTotalArea: "The total area must be greater than zero.",
    errorPartArea: "The area of the part must be greater than zero, up to two decimals.",
    errorWholeArea: "The total area must be greater than zero, up to two decimals.",

    unitM2: "m²",
  },

  "parcel-polygon-area": {
    points: "Points",
    pointsHint:
      "One point per line, in traversal order: x;y, e.g. 7459123.456;4876543.210. A rectangular (metric) system — latitude/longitude in degrees is not an allowed input.",

    results: "Result",
    area: "Area",
    ares: "Area in ares",
    hectares: "Area in hectares",
    perimeter: "Scope",
    orientation: "Direction of traversal",
    orientationCcw: "counter-clockwise",
    orientationCw: "clockwise",
    orientationNote:
      "Swapping the x and y columns changes neither the area nor the perimeter, only the sign of this direction — it is not a check on the input.",
    colEdge: "Side",
    colLength: "Length",

    inputs: "Entered",
    formula: "A = |Σ(xᵢyᵢ₊₁ − xᵢ₊₁yᵢ)| / 2     P = Σ √((xᵢ₊₁−xᵢ)² + (yᵢ₊₁−yᵢ)²)",

    errorPoints: "Enter at least three distinct points, in traversal order.",
    errorSelfIntersecting: "The sides intersect or touch — check the order and the point values.",
    errorCollinear: "All the points are on the same line — this is not a polygon.",

    unitM2: "m²",
    unitAre: "a",
    unitHa: "ha",
    unitM: "m",
  },

  "plot-density-index": {
    plotArea: "Plot area",
    grossFloorArea: "Gross floor area (GFA)",
    footprint: "Footprint area",
    planRatio: "Building index from the plan",
    planLimitHint:
      "From the planning document for that plot. Nexus knows and offers no index.",
    planCoverage: "Coverage index from the plan",

    results: "Result",
    brgpScopeNote:
      "What counts towards the GFA (terraces, loggias, garages, basements) is set by the plan or regulation you apply — the tool only divides the entered number.",
    ratio: "Building index",
    coverage: "Coverage",
    freeArea: "Free plot area",
    freeAreaPercent: "Free area, percentage of the plot",
    floorAreaToFootprintRatio: "GFA-to-footprint ratio",
    grossFloorAreaAtPlanRatio: "GFA at the entered index",
    grossFloorAreaDifference: "Difference: GFA at the entered index − entered GFA",
    ratioAgainstPlan: "Calculated index ÷ index from the plan",
    footprintAtPlanCoverage: "Footprint area at the entered coverage",
    footprintDifference: "Difference: area at the entered coverage − entered footprint area",
    coverageAgainstPlan: "Calculated coverage ÷ coverage from the plan",

    inputs: "Entered",
    formula:
      "index = GFA/plot     coverage = footprint/plot × 100     GFA_at_index = plot × index",

    errorPlotArea: "The plot area must be greater than zero.",
    errorGrossFloorArea: "The GFA may not be negative.",
    errorFootprint: "The footprint area may not be negative.",
    errorPlanRatio: "The building index from the plan must be greater than zero.",
    errorPlanCoverage: "The coverage index from the plan is from 0 to 100%, greater than zero.",

    unitM2: "m²",
  },

  "pro-rata-days": {
    total: "Total amount for the period",
    dateHint: "Format dd.mm.yyyy.",
    periodStart: "Period start date",
    periodEnd: "Period end date (inclusive)",
    handover: "Handover date",
    handoverHint:
      "The first day belonging to the second user. From the start date to the end date + 1 day.",
    basis: "Counting basis",
    basisAct: "actual days (ACT)",
    basisE30360: "30E/360",

    results: "Result",
    daysFirst: "Days of the first user",
    daysSecond: "Days of the second user",
    totalDays: "Total days in the period",
    amountFirst: "Amount of the first user",
    amountSecond: "Amount of the second user",
    checkSum: "Check sum",

    inputs: "Entered",
    formula:
      "n_A = days(start, handover)     amount_A = total × n_A / N     amount_B = total − amount_A",

    errorTotal: "The total amount may not be negative.",
    errorPeriodStart: "The period start date is not a valid date.",
    errorPeriodEnd: "The period end date is not a valid date or is before the start date.",
    errorHandover:
      "The handover date is not a valid date or is outside the period (one day after the end is allowed).",
  },

  "rent-escalation": {
    baseRent: "Initial rent per period",
    periods: "Number of periods",
    indexMode: "Method of entering the index",
    modeFixed: "fixed percentage",
    modeList: "list per period",
    fixedIndex: "Index per period",
    indexHint: "Percentage per period. Nexus knows and remembers no index.",
    listMode: "List of indices",
    listHint:
      "One percentage per line, as many lines as there are periods. The first line is not used (period 1 is not indexed) — write anything, e.g. a dash.",
    discountRate: "Discount rate per period",

    results: "Result",
    conventionNote: "The first period is not indexed; payment is at the start of the period.",
    colPeriod: "Period",
    colRent: "Rent",
    total: "Total for the whole term",
    average: "Average rent per period",
    closedFormTotal: "Check by closed form",
    presentValue: "Present value of the lease",

    inputs: "Entered",
    formula: "R_t = R_(t−1) × (1 + index_t/100)     PV = Σ R_t / (1 + discount/100)^(t−1)",

    errorBaseRent: "The initial rent must be greater than zero.",
    errorPeriods: "The number of periods is a whole number from 1 to 600.",
    errorIndex:
      "The index is not valid — check the fixed percentage or the list (it must have as many lines as there are periods).",
    errorDiscountRate: "The discount rate must be greater than −100%.",

    unitPercent: "%",
    unitLines: "lines",
  },

  "rent-gross-net": {
    gross: "Gross amount (contractual)",
    grossHint: "Enter one of the two amounts — gross or net. If you enter both, it is calculated from the gross.",
    net: "Net amount (that remains)",
    costPercent: "Percentage of recognised (standard) costs",
    costPercentHint:
      "From the regulation you apply. Nexus knows and offers no percentage.",
    taxRate: "Rate",
    taxRateHint: "From the regulation you apply. Nexus knows and offers no rate.",

    results: "Result",
    base: "Base",
    taxAmount: "Amount at the rate (base × rate)",
    netRoundingResidual: "Check: net − (gross − amount at the rate), unrounded",
    effectiveShare: "Effective share of the gross",
    impliedEffectiveShare: "Effective share derived from both entered amounts (1 − net/gross)",
    computedFrom: "Calculated from",
    fromGross: "the gross amount",
    fromNet: "the net amount",

    inputs: "Entered",
    formula:
      "base = gross × (1 − costs/100)     amount at the rate = base × rate/100     net = gross − amount",

    errorGross: "The gross amount must be greater than zero.",
    errorNet: "The net amount must be greater than zero.",
    errorCostPercent: "The percentage of recognised costs is from 0 to 100% (exclusive).",
    errorTaxRate: "The rate is from 0 to 100%, and such that 1 − the effective share stays greater than zero.",

    unitPercent: "%",
  },

  "rental-yield": {
    price: "Price / value of the property",
    priceHint:
      "Leave empty if you only want the reverse direction (value from the NOI and cap rate).",
    monthlyRent: "Monthly rent",
    occupancy: "Occupancy",
    occupancyHint: "A percentage, default 100 — that is the identity “no vacancy”, not an estimate.",
    monthlyCosts: "Monthly costs",
    costsHint:
      "The tool assumes no cost — it adds only what you enter, in full regardless of occupancy.",
    annualCosts: "Annual costs",
    capRate: "Cap rate for the reverse direction",
    capRateHint: "Your rate. Nexus assumes none.",

    results: "Result",
    grossPotentialIncome: "Annual gross potential income (GPI)",
    effectiveGrossIncome: "Effective gross income by occupancy (EGI)",
    netOperatingIncome: "Net operating income (NOI)",
    grossYield: "Gross yield (from GPI)",
    netYield: "Net yield (from NOI)",
    grossRentMultiplier: "Gross multiplier (price / GPI)",
    paybackYears: "Payback period",
    negativeNoiNote:
      "The entered costs exceed the income — the payback period and the reverse direction are not shown.",
    valueAtCapRate: "Value at the entered cap rate (NOI / rate)",
    costsAreYoursNote: "All costs are your inputs — the tool adds none by itself.",

    inputs: "Entered",
    formula:
      "GPI = rent × 12     EGI = GPI × occupancy/100     NOI = EGI − costs     yield = X / price × 100",

    errorPrice: "The price must be greater than zero.",
    errorMonthlyRent: "The monthly rent may not be negative.",
    errorOccupancy: "Occupancy is from 0 to 100%.",
    errorMonthlyCosts: "The monthly costs may not be negative.",
    errorAnnualCosts: "The annual costs may not be negative.",
    errorCapRate: "The cap rate must be greater than zero.",
  },

  "room-quad-area": {
    a: "Side a (A→B)",
    b: "Side b (B→C)",
    c: "Side c (C→D)",
    d: "Side d (D→A)",
    e: "Diagonal e (A→C)",
    eHint: "Must be measured inside the room.",

    results: "Result",
    area: "Area",
    triangleAbc: "Area of triangle ABC",
    triangleAcd: "Area of triangle ACD",
    angleB: "Angle at vertex B (between a and b)",
    deviationFrom90: "Deviation of angle B from 90°",
    angleD: "Angle at vertex D (between c and d)",
    deviationFrom90AtD: "Deviation of angle D from 90°",
    reentrantNote:
      "The calculation assumes diagonal AC lies inside the room. A room with a re-entrant corner must be split into two quadrilaterals and measured twice.",

    inputs: "Entered",
    formula:
      "Heron: T = ¼√((a+(b+c))(c−(a−b))(c+(a−b))(a+(b−c)))     γ = arccos((a²+b²−e²)/(2ab))     A = T_ABC + T_ACD",

    errorA: "Side a must be greater than zero.",
    errorB: "Side b must be greater than zero.",
    errorC: "Side c must be greater than zero.",
    errorD: "Side d must be greater than zero.",
    errorE: "Diagonal e must be greater than zero.",
    errorDiagonalTooLongAB: "Diagonal e is too long for sides a and b — triangle ABC does not exist.",
    errorDiagonalTooShortAB:
      "Diagonal e is too short for sides a and b — triangle ABC does not exist.",
    errorDiagonalTooLongCD: "Diagonal e is too long for sides c and d — triangle ACD does not exist.",
    errorDiagonalTooShortCD:
      "Diagonal e is too short for sides c and d — triangle ACD does not exist.",
    errorCollinearABC: "Points A, B and C are on the same line — triangle ABC has no area.",
    errorCollinearACD: "Points A, C and D are on the same line — triangle ACD has no area.",

    unitM: "m",
    unitM2: "m²",
    unitDeg: "°",
  },

  "wall-ceiling-area": {
    length: "Room length",
    width: "Room width",
    height: "Room height",
    openings: "Openings",
    openingsHint: "One opening per line: width;height;count, e.g. 0.90;2.05;1.",
    includeCeiling: "Include the ceiling",
    yes: "yes",
    no: "no",
    coverage: "Material coverage",
    coverageHint:
      "m² per litre or per kilogram, FOR ONE COAT, from the product label. Nexus assumes none.",
    coats: "Number of coats",
    coatsHint: "A whole number from 1 to 10. Default 1.",
    packageSize: "Package",
    packageSizeHint:
      "The size of one package, in the same unit as the coverage (l or kg). Optional.",
    perimeterOverride: "Perimeter (manual entry)",
    perimeterOverrideHint:
      "For a room that is not rectangular (e.g. L-shaped), where 2×(length+width) is not the real wall perimeter.",
    revealDepth: "Reveal depth",

    results: "Result",
    perimeter: "Room perimeter",
    wallsGross: "Gross wall area",
    openingsArea: "Total opening area",
    wallsNet: "Net wall area",
    wallsNetRoundingGap: "Rounding difference (gross − openings − net, shown rounded)",
    ceiling: "Ceiling area",
    notIncluded: "not included in the total",
    ceilingNotIncludedNote: "The ceiling is not included in the total area to be finished.",
    total: "Total area to be finished",
    material: "Quantity of material",
    materialNote:
      "In the coverage unit you enter (l or kg). It does not include spillage or losses.",
    packageCount: "Number of packs",
    revealArea: "Reveal area",

    inputs: "Entered",
    formula:
      "perimeter = 2×(length+width)     walls_net = perimeter×height − openings     material = total×coats/coverage",

    errorLength: "The room length must be greater than zero.",
    errorWidth: "The room width must be greater than zero.",
    errorHeight: "The room height must be greater than zero.",
    errorCoats: "The number of coats is a whole number from 1 to 10.",
    errorCoverage: "The coverage must be greater than zero.",
    errorPerimeterOverride: "The manually entered perimeter must be greater than zero.",
    errorRevealDepth: "The reveal depth must be greater than zero.",
    errorPackageSize: "The package size must be greater than zero.",
    errorOpeningWidth: "The opening width must be greater than zero and not greater than the width of the longer wall.",
    errorOpeningHeight: "The opening height must be greater than zero and not greater than the room height.",
    errorOpeningCount: "The opening count is a whole number from 1 to 1000.",
    errorOpenings: "The entered openings cannot fit in the walls.",

    unitM: "m",
    unitM2: "m²",
  },

  "weighted-area": {
    rows: "Rooms",
    rowsHint:
      "One row per room — name;area;coefficient — or, with four fields, name;length;width;coefficient. The coefficient is from 0 to 5.",
    pricePerSquareMetre: "Price per weighted m²",
    priceHint: "Optional — gives the total price and the price per net square metre.",

    results: "Result",
    coefficientNote:
      "The coefficient is a matter of contract, not regulation — a terrace is usually counted at 0.5, and a storage room with zero enters the net area, not the weighted one.",
    colName: "Room",
    colArea: "Area",
    colCoefficient: "Coefficient",
    colContribution: "Weighted",
    netArea: "Net area",
    weightedArea: "Weighted area",
    totalPrice: "Total price",
    pricePerNetSquareMetre: "Price per net m²",

    inputs: "Entered",
    formula:
      "weighted = Σ(area×coefficient)     net = Σarea     price = weighted×price_per_m²",

    errorRows: "Enter at least one room.",
    errorCoefficient: "The coefficient is a number from 0 to 5.",
    errorArea: "The area must be greater than zero.",
    errorLength: "The length must be greater than zero.",
    errorWidth: "The width must be greater than zero.",
    errorPrice: "The price per square metre may not be negative.",

    unitM2: "m²",
  },
} as const;
