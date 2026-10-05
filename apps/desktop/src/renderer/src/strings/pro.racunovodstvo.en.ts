/**
 * Accounting and finance - the English copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as `shared/modules.ts` spells the
 * registration. The tool's NAME and its one-line blurb are not here: those live
 * in the `name` and `blurb` tables of `./pro.en.ts`, because the drawer's
 * rail needs them before any surface is opened.
 *
 * **A unit is copy, not a constant.** "%" and the day unit are written here
 * rather than concatenated in the surface, so a translator can find every one
 * of them and a unit hard-coded in a component is a string `check:strings`
 * cannot see.
 *
 * **Nothing in here judges.** Every tool in this pack is `riskClass:
 * "financial"` except `benford-first-digit` (`"none"`) - none of the
 * seventeen may say a number is good, bad, over a threshold or a finding. A
 * refusal names the input that made the answer impossible, never a verdict on
 * the user's business. Where the assignment's own corrections insist on a
 * distinction (necessary vs. sufficient, booked vs. exact, computed vs.
 * verified), that distinction is carried into the copy, not silently dropped.
 */
export const PRO_RACUNOVODSTVO_EN = {
  "allocation-remainder": {
    total: "Total amount",
    mode: "Mode",
    modeHint:
      "Splits by key in proportion to the entered keys; into equal parts ignores the keys and divides into the entered number of parts.",
    modeByKey: "By key",
    modeEqual: "Into equal parts",
    items: "Items",
    itemsHint:
      "One row per item: name and key separated by a semicolon. The name may be left empty.",
    itemsHintEqual:
      "In this mode a name per row is enough — the key is not used, the number of parts is set separately.",
    itemsPlaceholder: "Customer A; 3\nCustomer B; 5\nCustomer C; 2",
    parts: "Number of parts",
    partsHint: "How many equal parts. A whole number from 1 to 200.",
    decimals: "Number of currency decimals",
    decimalsHint: "0 to 4. Default 2.",

    results: "Result",
    colName: "Item",
    colKey: "Key",
    colKeyShare: "Share of the key",
    colExact: "Exact amount",
    colAllocated: "Allocated amount",
    colAllocatedShare: "Share of the allocated",
    colRounding: "Rounding correction",
    colRank: "Rank by remainder",
    allocatedTotal: "Sum of the allocated amounts",
    adjustedCount: "Number of items with a correction of 1 minor unit",
    key: "key",
    allocated: "allocated",
    bumped: "received a correction",

    inputs: "Entered",
    formula:
      "Largest-remainder method: Tu = round(T·10^d); ei = Tu·wi/W; bi = floor(ei); the remainder R = Tu − Σbi goes to the first R items by descending remainder.",

    errorTotal: "The total amount must be a real number.",
    errorDecimals: "The number of decimals is a whole number from 0 to 4.",
    errorParts: "The number of parts is a whole number from 1 to 200.",
    errorItems:
      "At least one item with a key greater than zero is needed; a key may not be negative.",
  },

  "amount-in-words": {
    amount: "Amount",
    amountHint: "At most two decimals. The third decimal is refused, not rounded.",
    mode: "Mode",
    modeWithCurrency: "With currency",
    modePlain: "Without currency (just a number in words)",
    currencySingular: "Currency — singular",
    currencySingularHint:
      "For example “dinar”, “euro”. The form for a number that agrees with the singular (1, 21, 31…).",
    currencyPaucal: "Currency — paucal",
    currencyPlural: "Currency — plural",
    currencyGender: "Grammatical gender of the currency noun",
    paraStyle: "Subunit notation",
    paraStyleWords: "In words",
    paraStyleFraction: "Fraction xx/100",
    subunitSingular: "Subunit — singular",
    subunitSingularHint:
      "For example “para”, “cent”. Used only when the subunit is written in words.",
    subunitPaucal: "Subunit — paucal",
    subunitPlural: "Subunit — plural",
    subunitGender: "Grammatical gender of the subunit noun",
    plainGender: "Gender with the number",
    plainGenderHint: "Without a currency the number itself carries the gender (one, two).",
    genderMasculine: "masculine",
    genderFeminine: "feminine",
    genderNeuter: "neuter",
    letterCase: "Letter case",
    letterCaseLower: "lowercase",
    letterCaseUpper: "UPPERCASE",
    letterCaseSentence: "Capitalised first",

    results: "Result",
    resultText: "Amount in words",
    resultWhole: "Whole unit",
    resultSubunits: "Subunit",

    inputs: "Entered",
    formula:
      "cents = whole minor amount; D = floor(cents/100), P = cents mod 100; agreement by singular/paucal/plural from u = n mod 10, l = n mod 100.",
    source:
      "Number words and agreement by gender and number: Pravopis srpskoga jezika, Matica srpska, revised and expanded edition (2010).",

    errorAmountDecimals: "The amount may have at most two decimals.",
    errorCurrency: "All three forms of the currency name (singular, paucal, plural) must be filled in.",
    errorCurrencyGender: "The grammatical gender of the currency noun was not recognised.",
    errorSubunit: "All three forms of the subunit name must be filled in when the notation is in words.",
    errorSubunitGender: "The grammatical gender of the subunit noun was not recognised.",
    errorCents: "The amount must be zero or greater, and within the allowed range.",
  },

  "financial-ratios": {
    groupBalance: "Balance sheet",
    currentAssets: "Current assets",
    inventory: "Inventory",
    inventoryHint:
      "A balance on a date or an average — enter what you have, and the note beside the result says which.",
    cash: "Cash and cash equivalents",
    receivables: "Trade receivables",
    currentLiabilities: "Current liabilities",
    payables: "Trade payables",
    totalLiabilities: "Total liabilities",
    totalAssets: "Total assets",
    equity: "Equity",
    groupIncome: "Income statement",
    revenue: "Operating revenue",
    cogs: "Cost of goods sold (COGS)",
    ebit: "Operating profit (EBIT)",
    interestExpense: "Interest expense",
    netProfit: "Net profit",
    days: "Days in the year",
    daysHint: "The basis for DIO, DSO, DPO and the cash conversion cycle.",
    days365: "365",
    days360: "360 (banking convention)",

    results: "Result",
    currentRatio: "Current ratio",
    quickRatio: "Quick ratio",
    cashRatio: "Cash ratio",
    workingCapital: "Net working capital",
    debtRatio: "Debt ratio",
    debtToEquity: "Debt-to-equity ratio",
    interestCoverage: "Interest coverage",
    inventoryTurnover: "Inventory turnover",
    dio: "Days inventory outstanding (DIO)",
    unitDays: "days",
    dso: "Days sales outstanding (DSO)",
    dpo: "Days payables outstanding (DPO)",
    cashConversionCycle: "Cash conversion cycle",
    assetTurnover: "Total asset turnover",
    roaPercent: "ROA",
    roePercent: "ROE",
    netMarginPercent: "Net margin",
    ebitMarginPercent: "Operating (EBIT) margin",

    averageNote:
      "A position that was not entered leaves its ratio blank; division by zero also leaves a blank instead of a number. The tool does not make averages itself — it uses exactly the figures you enter.",
    inputs: "Entered",
    formula:
      "Liquidity = current assets/current liabilities (quick: without inventory, cash: cash only). DIO = days/inventory turnover. DSO = receivables/revenue·days. DPO = payables/COGS·days. CCC = DIO + DSO − DPO. ROA = net profit/assets. ROE = net profit/equity.",

    errorDays: "Days in the year are 365 or 360.",
  },

  "fx-difference": {
    amount: "Amount in foreign currency",
    rateOrigin: "Rate on the date of origin",
    rateSettlement: "Rate on the date of settlement or payment",
    rateUnit: "Rate unit",
    rateUnitHint:
      "Some rates are published per 100 or 1,000 units of foreign currency — choose exactly the one you enter.",
    rateUnit1: "per 1 unit",
    rateUnit100: "per 100 units",
    rateUnit1000: "per 1,000 units",
    side: "Item kind",
    sideReceivable: "Receivable (asset)",
    sidePayable: "Liability",
    amountDecimals: "Number of decimals of the amount",
    originDay: "Date of origin — day",
    originMonth: "Date of origin — month",
    originYear: "Date of origin — year",
    settlementDay: "Date of settlement/payment — day",
    settlementMonth: "Date of settlement/payment — month",
    settlementYear: "Date of settlement/payment — year",

    results: "Result",
    valueOrigin: "Countervalue on the date of origin",
    valueSettlement: "Countervalue on the settlement date",
    bookedDifference: "Exchange difference for posting",
    exactDifference: "Unrounded exchange difference",
    exactDifferenceRaw: "Unrounded difference (full precision)",
    roundingNote:
      "For posting, the difference of the ROUNDED countervalues is used — it may differ from the unrounded difference shown beside it.",
    magnitude: "Amount (absolute value)",
    effect: "Effect",
    effectIncome: "Positive exchange difference (income)",
    effectExpense: "Negative exchange difference (expense)",
    effectNone: "No exchange difference",
    rateChangePercent: "Change in rate",

    inputs: "Entered",
    formula:
      "V1 = amount·rate1, V2 = amount·rate2; posted difference = round(V2) − round(V1). Receivable: a rising rate is income. Liability: a rising rate is expense (same amount, opposite label).",

    errorAmount: "The amount must be a real number.",
    errorRateOrigin: "The rate on the date of origin must be greater than zero.",
    errorRateSettlement: "The rate on the settlement date must be greater than zero.",
    errorAmountDecimals: "The number of decimals is a whole number from 0 to 4.",
    errorDateOrigin: "The date of origin is not a valid date.",
    errorDateSettlement: "The date of settlement/payment is not a valid date.",

    crossResults: "Cross rate",
    rateAB: "Rate of currency X (units of Y per 1 X)",
    rateABHint: "For example EUR/RSD — how many RSD per 1 EUR.",
    rateSecond: "Rate of currency Z",
    rateSecondHint:
      "Against the same base Y (e.g. USD/RSD), or the reverse (RSD/USD) — choose the direction beside it.",
    crossDirection: "Direction of the second rate",
    crossDirectionSameBase: "Against the same base (Z/Y)",
    crossDirectionInverse: "Reversed (Y/Z)",
    crossDecimals: "Number of decimals of the cross rate",
    crossRate: "Cross rate (X/Z)",
    crossFormula:
      "Same base: (Y per X)/(Y per Z) = Z per X. Reversed second rate: (Y per X)·(Y per Z) = Z per X.",

    errorRateAB: "The rate of currency X must be greater than zero.",
    errorRateSecond: "The rate of currency Z must be greater than zero.",
    errorRateDecimals: "The number of decimals of the cross rate is a whole number from 0 to 6.",
  },

  "check-digits-id": {
    kind: "Kind",
    kindPib: "PIB (9 digits)",
    kindMaticni: "Company number (8 digits)",
    kindJmbg: "JMBG (13 digits)",
    mode: "Mode",
    modeHint:
      "Checking needs the whole number with the check digit; calculating needs only the base, without it.",
    modeVerify: "Check a whole number",
    modeCompute: "Calculating the check digit",
    value: "Number",
    valueHint: "Digits only — spaces and hyphens are ignored.",

    results: "Result",
    computed: "Calculated check digit",
    given: "Entered check digit",
    matches: "They match",
    matchesYes: "yes",
    matchesNo: "no",
    corrected: "Number with the calculated check digit",
    jmbgRawRemainder: "Raw remainder m (before the rule m > 9 → 0)",
    jmbgTenBranch: "Branch m = 10",
    jmbgNote:
      "The tool only says whether the check digit matches the rest of the number — it does not claim the number exists in any register, whom it belongs to, or that it is active. The JMBG has a blind spot: swapping the digits at positions i and i+6 does not change the check digit.",

    inputs: "Entered",
    formulaMod1110:
      "ISO 7064 MOD 11,10: p = 10; for each digit d: s = (p+d) mod 10 (0 → 10); p = 2s mod 11; k = (11 − p) mod 10.",
    formulaJmbg:
      "S = 7(a1+a7) + 6(a2+a8) + 5(a3+a9) + 4(a4+a10) + 3(a5+a11) + 2(a6+a12); m = 11 − (S mod 11); m > 9 → 0.",

    errorLength: "The number of digits does not match the chosen kind and mode.",
    errorValue: "The number may contain only digits, spaces and hyphens.",
  },

  "depreciation-schedule": {
    cost: "Acquisition cost",
    residual: "Residual value",
    usefulLife: "Useful life (years)",
    method: "Method",
    methodLinear: "Linear",
    methodDeclining: "Declining balance with a coefficient",
    methodSyd: "Sum of years (SYD)",
    methodUnits: "Units of production",
    decliningFactor: "Declining coefficient",
    decliningFactorHint: "Greater than 1 up to 5 — for example 2 for the double-declining method.",
    displayYears: "Number of years shown",
    displayYearsHint:
      "The declining method never reaches the residual exactly — set how many rows the plan shows.",
    usage: "Output per year",
    usageHint: "One row per year, in units of output.",
    usagePlaceholder: "1200\n1500\n1100",
    capacity: "Total capacity",
    activationDay: "Date put into service — day",
    activationMonth: "Date put into service — month",
    activationYear: "Date put into service — year",
    proration: "Pro-rata for the first year",
    prorationHint: "Without pro-rata it calculates whole years from the date put into service onward.",
    prorationNone: "None",
    prorationMonths: "By months",
    prorationDays: "By days",

    results: "Result",
    colYear: "Year",
    colCalendarYear: "Calendar year",
    colBasis: "Base",
    colOpening: "Opening value",
    colCharge: "Annual depreciation",
    colAccumulated: "Accumulated depreciation",
    colClosing: "Present value",
    depreciableBase: "Depreciable base",
    firstYearFactor: "Pro-rata factor for the first year",
    writtenOff: "Total depreciated",
    noRateNote:
      "The useful life and the declining coefficient are your choice — the tool knows no tax depreciation group and no prescribed rate.",

    inputs: "Entered",
    formula:
      "Straight-line: A = (C−S)/n. SYD: A_k = (C−S)·(n−k+1)/(n(n+1)/2). Declining: A_k = min(B_(k−1)·f/n, B_(k−1)−S). Units of production: A_k = (C−S)·u_k/U.",

    errorCost: "The acquisition cost must be greater than zero.",
    errorResidual: "The residual must be from zero to the acquisition cost.",
    errorActivation: "The date put into service is not a valid date.",
    errorUsefulLife: "The useful life is a whole number from 1 to 100 years.",
    errorDecliningFactor: "The declining coefficient is a number greater than 1 up to 5.",
    errorDisplayYears: "The number of years shown is a positive whole number.",
    errorUsage: "The output per year must be a positive number in every row.",
    errorCapacity: "The total capacity must be greater than zero and not less than the sum of the output.",
    errorProration: "The first-year pro-rata was not recognised.",
  },

  "benford-first-digit": {
    text: "Amounts",
    textHint: "Paste a column of numbers, one per line (or separated by semicolons or tabs).",
    test: "Test",
    testFirst: "First digit (1–9)",
    testFirstTwo: "First two digits (10–99)",
    negatives: "Treatment of negative values",
    negativesAbsolute: "Absolute value",
    negativesSkip: "Skip",
    separator: "Input decimal separator",
    separatorComma: "Comma",
    separatorDot: "Point",

    results: "Result",
    colDigit: "Digit",
    colObserved: "Observed frequency",
    colObservedShare: "Observed share",
    colExpectedShare: "Expected share",
    colExpected: "Expected frequency",
    colDifference: "Deviation",
    colZ: "Z-value",
    usable: "Usable records",
    skipped: "Skipped records",
    chiSquare: "Chi-square",
    mad: "MAD",
    minExpected: "Smallest expected frequency",

    inputs: "Entered",
    formula:
      "p_d = log10(1 + 1/d). Chi-square = Σ(n_d − e_d)²/e_d. MAD = (1/k)Σ|n_d/N − p_d|. z_d = (|n_d/N − p_d| − 1/(2N))/√(p_d(1−p_d)/N).",

    errorTooManyRows: "At most 100,000 rows.",
    errorValues: "No usable number was found.",
  },

  "breakeven-cvp": {
    fixedCost: "Fixed costs for the period",
    price: "Selling price per unit",
    variableCost: "Variable cost per unit",
    targetProfit: "Target profit",
    plannedVolume: "Planned volume",
    plannedVolumeHint: "Optional — without it there is no margin of safety or operating leverage.",

    results: "Result",
    contributionMargin: "Contribution margin per unit",
    contributionMarginPercent: "Contribution margin ratio",
    breakevenUnits: "Break-even point (exact)",
    breakevenUnitsWhole: "Break-even point (rounded up to a whole unit)",
    breakevenRevenue: "Break-even revenue (exact)",
    breakevenRevenueAtWholeUnits: "Break-even revenue at the rounded unit count",
    revenueNote:
      "The break-even revenue and unit count are calculated from different numbers — the exact values and the rounded unit count — so both are shown, each labelled.",
    targetUnits: "Volume for the target profit",
    targetRevenue: "Revenue for the target profit",
    marginOfSafetyPercent: "Margin of safety",
    operatingLeverage: "Degree of operating leverage",
    singleProductNote:
      "The calculation is for ONE product. With several items the break-even point depends on the sales mix.",

    inputs: "Entered",
    formula:
      "CM = P − V. Q0 = FC/CM. R0 = FC/(CM/P). Qd = (FC+D)/CM. MS = 100·(Qp−Q0)/Qp. DOL = (Qp·CM)/(Qp·CM−FC).",

    errorFixedCost: "Fixed costs may not be negative.",
    errorPrice: "The selling price must be greater than zero.",
    errorVariableCost: "The variable cost may not be negative.",
    errorTargetProfit: "The target profit may not be negative.",
    errorPlannedVolume: "The planned volume must be greater than zero.",
    errorContribution:
      "The contribution margin must be greater than zero — the selling price must exceed the variable cost.",
  },

  "bank-account-iban": {
    kind: "Kind",
    kindDomestic: "Domestic current account",
    kindIban: "IBAN",
    subMode: "Mode",
    subModeHint: "Checking needs the check digits too; calculating returns them from the base.",
    subModeVerify: "Check",
    subModeCompute: "Calculating",
    bank: "Bank code",
    bankHint: "3 digits.",
    party: "Part number",
    partyHint: "1 to 13 digits — padded with zeros on the left to 13.",
    domesticCheck: "Check digits",
    iban: "IBAN",
    ibanHintVerify: "Letters and digits, 5 to 34 characters. Spaces are ignored.",
    ibanHintCompute:
      "Country code (2 letters) + BBAN. Check digits 3–4 are ignored if entered.",

    results: "Result",
    formatted: "Formatted notation",
    checkDigits: "Check digits",
    matches: "The check digit matches",
    matchesYes: "yes",
    matchesNo: "no",
    remainder: "Remainder modulo 97",

    inputs: "Entered",
    formulaDomestic:
      "N = 3 bank digits + 13 part digits; K = 98 − ((N·100) mod 97); valid iff (N·100+K) mod 97 = 1.",
    formulaIban:
      "Move the first 4 characters to the end, letters A=10…Z=35; n mod 97 = 1 is valid; K = 98 − (n mod 97) for calculating.",

    errorBank: "The bank code must have exactly 3 digits.",
    errorPartyNumber: "The part number must have 1 to 13 digits.",
    errorCheckDigits: "The check digits must have exactly 2 digits.",
    errorConfusable:
      "Cyrillic characters (e.g. РС, ВА) do not map the same as Latin ones — enter the IBAN in Latin letters.",
    errorLength: "The IBAN length must be 5 to 34 characters.",
    errorAlreadyIban: "A whole IBAN was entered, not a country code and BBAN for calculating.",
    errorIban: "The IBAN may contain only letters A–Z and digits.",
  },

  "gross-up": {
    net: "Net amount",
    model: "Model",
    modelHint:
      "A: tax on the base reduced by the tax-free amount, contributions on the gross. B: tax and contributions on the gross reduced by standard costs.",
    modelA: "A (tax-free amount)",
    modelB: "B (standard costs)",
    taxPercent: "Tax rate",
    contributionPercent: "Contribution rate borne by the recipient",
    rateHint: "%, your input — the tool knows no prescribed rate.",
    nonTaxableHint: "An amount, not a percentage — your input. The tool knows no prescribed amount.",
    nonTaxable: "Tax-free amount (model A)",
    standardCostPercent: "Standard costs (model B)",
    employerPercent: "Contribution rate borne by the payer",
    employerPercentHint: "Optional — left empty, the total cost is not shown.",

    results: "Result",
    gross: "Gross amount",
    taxBase: "Tax base",
    tax: "Tax",
    contributions: "Contributions borne by the recipient",
    netCheck: "Check net",
    totalCost: "Total cost to the payer",
    rateNote:
      "All rates and the tax-free amount are your input — the tool knows no rate, chooses no model and does not claim the calculation follows any regulation.",

    inputs: "Entered",
    formulaA:
      "Branch without tax: gross = net/(1−d/100), accepted if gross ≤ A. Branch with tax: gross = (net − (p/100)A)/(1 − d/100 − p/100).",
    formulaB: "gross = net/(1 − ((p+d)/100)·(1 − k/100)).",

    errorNet: "The net amount must be greater than zero.",
    errorTaxPercent: "The tax rate is from 0 to 100%.",
    errorContributionPercent: "The contribution rate is from 0 to 100%.",
    errorEmployerPercent: "The payer's contribution rate is from 0 to 100%.",
    errorNonTaxable: "The tax-free amount may not be negative.",
    errorStandardCostPercent: "Standard costs are from 0 to 100%.",
    errorRates: "The sum of the tax and contribution rates reaches or exceeds 100% — the equation has no solution.",
  },

  "rate-conversion": {
    ratePercent: "Rate",
    kind: "Kind of the entered rate",
    kindHint:
      "Determines how the rate is read — as a nominal rate with m compounds, an effective annual rate, or a periodic rate.",
    kindNominal: "Nominal annual (m compounds)",
    kindEffective: "Effective annual",
    kindPeriodic: "Periodic",
    compoundingsPerYear: "Number of compounding periods per year (m)",
    compoundingsPerYearHint:
      "12 monthly, 4 quarterly, 365 daily — the compounding convention of the rate, not the target period.",
    target: "Target period",
    targetHint: "The period for which the periodic rate is wanted.",
    targetYear: "Year",
    targetHalf: "Half-year",
    targetQuarter: "Quarter",
    targetMonth: "Month",
    targetDay: "Day",

    results: "Result",
    effectivePercent: "Effective annual rate",
    nominalPercent: "Nominal annual rate",
    proportionalPeriodicPercent: "Proportional periodic rate",
    conformalPeriodicPercent: "Conformal periodic rate",
    periodicNote:
      "The proportional and conformal periodic rates are two different numbers for the same period — the difference is the whole point of this tool.",
    continuousEffectivePercent: "Limit under continuous compounding (m → ∞)",
    periodsPerYear: "Number of target periods per year (k)",

    inputs: "Entered",
    formula:
      "EAR = (1 + r/(100m))^m − 1. i_prop = r/(100k). i_conf = (1+EAR)^(1/k) − 1. Limit: EAR = e^(r/100) − 1.",

    errorRatePercent: "The rate must be greater than −100%.",
    errorCompoundingsPerYear: "The number of compounding periods per year is a whole number from 1 to 365.",
    errorTarget: "The target period was not recognised.",
  },

  "interest-periods": {
    principal: "Principal",
    periods: "Periods",
    periodsHint:
      "One row per period: date from; date to; annual rate in %. Date in the form DD.MM.YYYY.",
    periodsPlaceholder: "01.01.2025; 01.04.2025; 10\n01.04.2025; 01.07.2025; 12",
    dayCount: "Day basis",
    dayCountAct365: "ACT/365",
    dayCountAct360: "ACT/360",
    dayCountActActIsda: "ACT/ACT (ISDA)",
    dayCountBond30360: "30/360 (bond)",
    dayCountEuro30E360: "30E/360",
    method: "Method",
    methodSimple: "Simple (linear)",
    methodCompound: "Conformal",
    capitalize: "Add interest to the principal at the end of the period",
    capitalizeHint:
      "Without compounding each period is calculated on the same principal; with it the interest is added to the principal of the next period.",
    capitalizeYes: "Yes",
    capitalizeNo: "No",
    decimals: "Number of decimals shown",

    results: "Result",
    colIndex: "Period",
    colDays: "Days",
    colDcf: "Year fraction (DCF)",
    colRate: "Rate",
    colInterest: "Interest",
    totalDays: "Sum of days of all periods",
    totalInterestRows: "Total interest (sum of the displayed rows)",
    totalInterestExact: "Total interest (unrounded)",
    totalsNote:
      "Both totals are shown, each labelled — a table whose column does not add up to its own rounded total would be a printing error.",
    totalDue: "Total owed (principal + interest)",
    earliestFrom: "Earliest “from” date",
    latestTo: "Latest “to” date",
    overlapDays: "Days of overlap between periods",
    uncoveredDays: "Uncovered days",
    coverageNote: "The tool does not fix overlaps and gaps between periods — it shows them as entered.",

    inputs: "Entered",
    formula:
      "DCF: ACT/365 → d/365; ACT/360 → d/360; ACT/ACT (ISDA) splits the interval on 1 January; 30/360 and 30E/360 by ISDA 4.16(f)/(g). Simple: I = P·(r/100)·DCF. Conformal: I = P·((1+r/100)^DCF − 1).",

    errorPrincipal: "The principal must be greater than zero.",
    errorDecimals: "The number of decimals shown is a whole number from 0 to 6.",
    errorPeriod: "The date to must be after the date from in every period.",
    errorRatePercent:
      "The rate in every period must be greater than −100% (and different from −100% in the conformal method).",
    errorPeriods: "At least one period is needed.",
  },

  "inventory-costing": {
    openingQuantity: "Opening quantity",
    openingUnitCost: "Opening unit price",
    movements: "Movements",
    movementsHint:
      "One row per movement: type (in/out); quantity; unit price (only for an in).",
    movementsPlaceholder: "in; 100; 100\nin; 100; 120\nout; 150",
    averageMode: "Average method",
    averageModeHint:
      "Continuous recalculates the average after every in; periodic calculates one average for the whole period (the weighted average price at the end of the period).",
    averageModeMoving: "Continuous",
    averageModePeriodic: "Periodic",
    decimals: "Number of decimals shown",

    results: "Result",
    groupFifo: "FIFO",
    groupAverage: "Average cost",
    colType: "Type",
    typeIn: "in",
    typeOut: "out",
    colQuantity: "Quantity",
    colUnitCost: "Unit price",
    colValue: "Value",
    colBalanceQuantity: "Balance — quantity",
    colBalanceValue: "Balance — value",
    cogs: "Cost of goods sold (COGS)",
    closingQuantity: "Closing quantity",
    closingValue: "Closing value",
    fifoCogs: "COGS (FIFO)",
    fifoClosingValue: "Closing value (FIFO)",
    averageCogs: "COGS (average)",
    averageClosingValue: "Closing value (average)",
    costDifference: "Difference in COGS (average − FIFO)",
    closingDifference: "Difference in closing balance (average − FIFO)",
    purchaseValue: "Total purchases of the period",
    policyNote:
      "The methods are not ranked — both are shown with their difference; the choice of method is your accounting policy.",

    inputs: "Entered",
    formula:
      "FIFO consumes the oldest layers first. Continuous average: price = V/Q after every in. Periodic average: price = (opening value + Σins)/(opening quantity + Σins), applied to all outs.",

    errorMovementType: "The movement type must be “in” or “out”.",
    errorOpeningQuantity: "The opening quantity may not be negative.",
    errorOpeningUnitCost: "The opening unit price may not be negative.",
    errorUnitCost: "The unit price of an in must be zero or greater.",
    errorDecimals: "The number of decimals shown is a whole number from 0 to 6.",
    errorMovements: "An out is larger than the available quantity — check the input row by row.",
  },

  "loan-schedule": {
    principal: "Loan amount",
    annualRatePercent: "Nominal annual rate",
    instalments: "Number of instalments",
    frequency: "Number of instalments per year",
    frequency12: "12 (monthly)",
    frequency4: "4 (quarterly)",
    frequency2: "2 (semi-annual)",
    frequency1: "1 (annual)",
    plan: "Plan type",
    planAnnuity: "Annuity",
    planEqualPrincipal: "Equal principal",
    rateMethod: "Periodic rate calculation",
    rateMethodHint: "Proportional: r/100/m. Conformal: (1+r/100)^(1/m) − 1.",
    rateMethodProportional: "Proportional",
    rateMethodConformal: "Conformal",
    decimals: "Number of decimals",

    results: "Result",
    colIndex: "Instalment",
    colOpening: "Debt balance — opening",
    colInterest: "Interest",
    colPrincipal: "Principal repayment",
    colPayment: "Instalment",
    colClosing: "Debt balance — closing",
    annuity: "Annuity",
    periodicRate: "Periodic rate",
    totalPaid: "Total paid",
    totalInterest: "Total interest",
    notAprNote:
      "The plan is a plain calculation under the entered terms — no fees, grace, currency clause or insurance, so this is not an APR.",

    inputs: "Entered",
    formula:
      "i = r/(100m) or (1+r/100)^(1/m) − 1. Annuity: A = P·i/(1 − (1+i)^(−n)); for i = 0, A = P/n. The last instalment carries the rounding difference so the closing balance is exactly zero.",

    errorPrincipal: "The loan amount must be greater than zero.",
    errorAnnualRatePercent: "The nominal annual rate is from 0 to 1000%.",
    errorInstalments: "The number of instalments is a whole number from 1 to 600.",
    errorFrequency: "The number of instalments per year is 12, 4, 2 or 1.",
    errorDecimals: "The number of decimals is a whole number from 0 to 4.",
  },

  "rebate-chain": {
    groupMargin: "Margin and markup",
    purchasePrice: "Purchase price",
    landedCosts: "Ancillary purchase costs",
    pair: "Known pair",
    pairCostAndPrice: "Purchase + selling price",
    pairCostAndMarginOnPrice: "Purchase price + margin on the selling price",
    pairCostAndMarginOnCost: "Purchase price + markup on the purchase price",
    pairPriceAndMarginOnPrice: "Selling price + margin on the selling price",
    pairPriceAndMarginOnCost: "Selling price + markup on the purchase price",
    sellingPrice: "Selling price",
    marginOnPricePercent: "Margin on the selling price",
    marginOnPricePercentHint: "% — less than 100.",
    marginOnCostPercent: "Markup on the purchase price",
    marginOnCostPercentHint: "% — greater than −100.",
    cost: "Acquisition cost (with ancillary costs)",
    difference: "Markup",
    formulaMargin:
      "m = 100(P−C)/P on the selling price; u = 100(P−C)/C on the purchase price. Conversions: u = 100m/(100−m); m = 100u/(100+u).",

    groupChain: "Chain discounts",
    listPrice: "List price (gross price before discounts)",
    rebates: "Chain discounts",
    rebatesHint: "A list of percentages, in the order they are granted (e.g. 10; 5).",
    rebatesPlaceholder: "10\n5",
    colStep: "Step",
    colBasis: "Base",
    colRebatePercent: "Discount",
    colRebateAmount: "Discount amount",
    colRemaining: "Remainder after the step",
    netPrice: "Net price after all discounts",
    effectiveRebatePercent: "Effective discount",
    effectiveNote:
      "The effective discount is a product, never the sum of the individual discounts — 10% then 5% is 14.5%, not 15%.",
    formulaChain: "net = list·Π(1 − d_i/100). effective discount = 100·(1 − Π(1 − d_i/100)).",

    inputs: "Entered",

    errorPurchasePrice: "The purchase price may not be negative.",
    errorLandedCosts: "The ancillary purchase costs may not be negative.",
    errorSellingPrice: "The selling price may not be negative.",
    errorMarginOnPricePercent: "The margin on the selling price must be less than 100%.",
    errorMarginOnCostPercent: "The markup on the purchase price must be greater than −100%.",
    errorListPrice: "The list price may not be negative.",
    errorRebatePercents: "Every discount in the chain is from 0 to 100%, at most 20 discounts.",
  },

  "trial-balance-check": {
    mode: "Input mode",
    modeHint:
      "The columns sum both sides; one amount is for diagnosis when the difference is already known.",
    modeColumns: "Debit and credit columns",
    modeDifferenceOnly: "Difference only",
    debits: "Debit side",
    credits: "Credit side",
    listHint:
      "A pasted column of amounts, one per line (or separated by semicolons or tabs). Up to 5,000 rows.",
    differenceAmount: "Difference",
    decimals: "Number of currency decimals",

    results: "Result",
    debitTotal: "Total debit",
    creditTotal: "Total credit",
    debitCount: "Number of items — debit",
    creditCount: "Number of items — credit",
    difference: "Difference",
    magnitude: "Difference amount (absolute value)",
    balancedNote: "The sides are balanced — no diagnosis is shown.",
    necessaryNote:
      "These are arithmetically possible causes, not findings — the tool does not choose among them and does not claim to have found the cause.",
    reversedItem: "Item on the wrong side (posted reversed)",
    shiftedByTen: "Amount entered ten times too large",
    shiftedByHundred: "Amount entered a hundred times too large",
    colLowerPosition: "Lower position",
    colUpperPosition: "Higher position",
    colDigitGap: "Digit difference",
    colStep: "Step",
    colPairs: "Possible digit pairs",

    inputs: "Entered",
    formula:
      "R = Σdebit − Σcredit, in whole minor units. Swapping digits a,b at positions i<j changes the amount by (a−b)(10^j−10^i); divisibility by 9 is a necessary condition. Shifted decimal: m/9 or m/99.",

    errorDecimals: "The number of currency decimals is a whole number from 0 to 4.",
    errorDifference: "The difference must be a number, with at most as many decimals as chosen.",
    errorDebits: "The debit side contains a value that is not a number.",
    errorCredits: "The credit side contains a value that is not a number.",
    errorTooManyRows: "At most 5,000 rows per side.",
  },

  "tvm-solver": {
    solveFor: "Quantity sought",
    unknownPv: "Present value (PV)",
    unknownFv: "Future value (FV)",
    unknownPmt: "Payment (PMT)",
    unknownPeriods: "Number of periods (n)",
    unknownRate: "Periodic rate (i)",
    pv: "Present value (PV)",
    pvHint: "An inflow is positive, an outflow negative. Ignored when this is the quantity sought.",
    fv: "Future value (FV)",
    fvHint: "The same sign convention as PV. Ignored when this is the quantity sought.",
    pmt: "Payment (PMT)",
    pmtHint:
      "Currency units per period, same sign convention. Ignored when this is the quantity sought.",
    periods: "Number of periods (n)",
    ratePercent: "Periodic rate (i)",
    ratePercentHint: "% per period, greater than −100%. Ignored when this is the quantity sought.",
    timing: "Payment type",
    timingEnd: "At the end of the period (ordinary)",
    timingBegin: "At the start of the period (annuity due)",

    results: "Result",
    solved: "Quantity sought",
    residual: "Residual of the basic equation",

    inputs: "Entered",
    formula:
      "PV + PMT·k·(1 − (1+i)^(−n))/i + FV·(1+i)^(−n) = 0, k = 1 at the end of the period, k = 1+i at the start. For i = 0: PV + PMT·n + FV = 0.",

    errorPv: "The present value must be a real number.",
    errorFv: "The future value must be a real number.",
    errorPmt: "The payment must be a real number.",
    errorPeriods: "The number of periods is from 0 to 1200.",
    errorRate: "The periodic rate must be greater than −100%.",
    errorRateOutOfRange:
      "The solution for the rate is not in the searched range (−99.9999% to 1000% per period).",
    errorCashflows:
      "No solution exists or it is not unique — the flows must change sign exactly once.",
  },
} as const;
