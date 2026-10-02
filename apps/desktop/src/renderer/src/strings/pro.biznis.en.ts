/**
 * „Biznis i kancelarija" — the Serbian copy of this toolkit's surfaces.
 *
 * One entry per tool id, keyed exactly as the assignment and
 * `@nexus/core/pro/biznis.ts` spell it. The tool's NAME and its one-line blurb
 * are not here — those live in `./pro.ts`, owned by another process.
 *
 * **A unit is copy, not a constant.** Money, minutes, percent, days — every one
 * of them is a string written here and passed to `proUnit` at the call site,
 * never concatenated by hand in the surface.
 *
 * **This pack knows no rate, no term, no holiday and no tariff — and says so.**
 * A statutory interest rate, a payment term, a public holiday, a commission
 * scale: every one of them is the user's own number, typed with no default, and
 * the hint under the field is what says whose number it is. None of these tools
 * is `life-safety` or `food-safety`, but the same discipline applies by choice
 * throughout: a quantity is printed, never a judgement about it.
 */
export const PRO_BIZNIS_EN = {
  "billable-hours": {
    entries: "Time entries",
    entriesHint:
      "One entry per line — “1:45”, “1h 45min” or decimal “1.75” (one and three quarter hours).",
    intervalMinutes: "Rounding interval",
    intervalHint: "In minutes, 1–120. Empty or 0 means no rounding.",
    rule: "Rounding rule",
    ruleUp: "Up",
    ruleNearest: "To nearest",
    ruleDown: "Down",
    place: "Where it is rounded",
    placePerItem: "Per entry",
    placeTotal: "On the total",
    rate: "Hourly rate",
    rateHint: "Currency units per hour.",

    results: "Result",
    tableIndex: "No.",
    tableActual: "Actual",
    tableBilled: "Rounded",
    actualTotal: "Actual total",
    actualDecimal: "Actual in decimal hours",
    billedTotal: "Rounded total",
    billedDecimal: "Rounded in decimal hours",
    amount: "Amount",
    actualAmount: "Amount without rounding",
    deltaMinutes: "Difference (rounded − actual)",
    deltaAmount: "Difference in amount",

    inputs: "Entered",
    formula:
      "m = 60·H + MM (or round(x·60) for decimal notation)     rounded by the chosen rule and place     amount = rounded/60 · hourly rate",

    errorEntries:
      "Every entry must be a time in the form “1:45”, “1h 45min” or decimal “1.75” — with no empty lines between entries.",
    errorInterval: "The rounding interval is a whole number of minutes from 1 to 120, or empty.",
    errorRate: "The hourly rate may not be negative.",

    unitMinutes: "min",
    unitH: "h",
  },

  "break-even": {
    fixedCosts: "Fixed costs for the period",
    price: "Selling price per unit",
    variableCost: "Variable cost per unit",
    targetProfit: "Desired profit for the period",
    targetProfitHint:
      "For the SAME period the fixed costs were entered for — otherwise two different time bases get added. Empty means no target is set.",
    plannedUnits: "Planned sales",
    plannedUnitsHint: "Optional, only for the margin of safety — in units.",

    results: "Result",
    contributionMargin: "Contribution margin per unit",
    contributionMarginPercent: "Contribution margin as a percentage",
    exactUnits: "Break-even, unrounded units",
    units: "Break-even, units (up)",
    breakEvenRevenue: "Revenue at the unrounded break-even",
    revenueAtUnits: "Revenue at the whole number of units",
    surplusAtUnits: "Surplus that whole number of units brings",
    exactUnitsForProfit: "For the desired profit, unrounded units",
    unitsForProfit: "For the desired profit, units (up)",
    revenueForProfit: "Revenue at that number of units",
    marginOfSafetyPercent: "Margin of safety, percent",
    marginOfSafetyUnits: "Margin of safety, units",
    marginOfSafetyAmount: "Margin of safety, money",

    inputs: "Entered",
    formula:
      "cm = price − variable cost     units = ⌈fixed / cm⌉     revenue = units · price     margin of safety = (planned − fixed/cm) / planned",

    errorFixedCosts: "Fixed costs may not be negative.",
    errorPrice: "The selling price must be greater than zero.",
    errorVariableCost: "The variable cost may not be negative.",
    errorTargetProfit: "The desired profit may not be negative.",
    errorPlannedUnits: "Planned sales must be a number.",
    errorMarginZero:
      "The contribution margin is exactly zero — every extra unit leaves a loss equal to the fixed costs, so there is no break-even point.",
    errorMarginNegative:
      "The contribution margin is negative — every extra unit increases the loss, so there is no break-even point.",

    unitPieces: "pcs",
  },

  "chained-discount": {
    basePrice: "Base price",
    steps: "Discount series",
    stepsHint:
      "A percentage per entry, one per line or separated by commas. A negative entry is a surcharge and has no lower bound; no entry may exceed 100%.",

    results: "Result",
    tableStep: "Step",
    tablePrice: "Price after the step",
    tableDelta: "What that step changed",
    finalPrice: "Final price",
    totalDiscount: "Total deducted",
    totalSurcharge: "Total added",
    equivalent: "Equivalent single discount",
    equivalentSurcharge: "Equivalent single surcharge",
    orderNote:
      "The final price does not depend on the order of the entries — the product of the factors is commutative. The price after each INDIVIDUAL step does.",
    fullStepNote:
      "A 100% entry brings the price to 0 — no later entry, discount or surcharge, has any effect.",

    inputs: "Entered",
    formula:
      "f = ∏ (1 − dᵢ)     final price = base · f     equivalent discount = 1 − f",

    errorBasePrice: "The base price may not be negative.",
    errorSteps: "No entry may exceed 100%; each must be a number.",

    unitPercent: "%",
  },

  "deposit-instalments": {
    contractValue: "Contract value",
    depositKind: "The deposit is entered as",
    depositKindPercent: "Percentage",
    depositKindAmount: "Amount",
    deposit: "Deposit",
    depositHint: "A percentage of the contract value (0–100) or a monetary amount, depending on the choice on the left.",
    instalments: "Number of instalments",
    firstDateDay: "First instalment date — day",
    firstDateMonth: "First instalment date — month",
    firstDateYear: "First instalment date — year",
    stepMonths: "Interval between instalments",
    stepMonthsHint: "In months.",
    unit: "Smallest rounding unit",
    unit001: "0.01",
    unit1: "1",

    results: "Result",
    depositAmount: "Deposit",
    tableIndex: "No.",
    tableDate: "Date",
    tableAmount: "Instalment amount",
    tableRemaining: "Remaining debt",
    checkSum: "Check sum (deposit + all instalments)",

    inputs: "Entered",
    formula:
      "N = round(remainder / unit)     base = ⌊N / number of instalments⌋     the first R instalments get one unit more, R = N − base · number of instalments     date(i) = first instalment + (i−1) · interval, measured from the FIRST date",

    errorContractValue:
      "The contract value must be greater than zero and must be a whole multiple of the rounding unit.",
    errorUnit: "The rounding unit must be greater than zero.",
    errorDeposit: "The deposit must be within the allowed range — 0 to 100% or 0 to the contract value.",
    errorInstalments: "The number of instalments is a whole number from 1 to 600.",
    errorFirstDate: "The first instalment date must be a valid calendar date.",
    errorStepMonths: "The interval between instalments is a whole number of months from 1 to 120.",
    errorSchedule:
      "With this number of instalments and interval the schedule runs outside the calendar the tool supports.",
  },

  "hourly-rate-target": {
    targetEarnings: "Desired annual income before tax",
    targetEarningsHint:
      "This is the income that must be invoiced, not the pay that remains after tax and contributions — the tool knows no tax rate.",
    businessCosts: "Annual business costs",
    workWeeks: "Working weeks per year",
    workWeeksHint: "1–53. Annual leave and holidays are your choice, not the tool's assumption.",
    hoursPerWeek: "Working hours per week",
    billablePercent: "Billable share",
    billablePercentHint: "The percentage of working time that is actually invoiced.",
    hoursPerDay: "Hours in a working day",

    results: "Result",
    billableHoursPerYear: "Billable hours per year",
    requiredRevenue: "Required annual income",
    hourlyRate: "Hourly rate",
    dayRate: "Day rate",
    monthlyRevenue: "Required income per month",
    revenueNote:
      "This is the income that must be invoiced, not the pay that remains after tax and contributions.",

    inputs: "Entered",
    formula:
      "billable hours = weeks · hours/week · billable share     hourly rate = (income + costs) / billable hours     day rate = hourly rate · hours/day",

    errorTargetEarnings: "The desired income may not be negative.",
    errorBusinessCosts: "Business costs may not be negative.",
    errorWorkWeeks: "Working weeks per year is a number from 1 to 53.",
    errorHoursPerWeek: "Working hours per week must be greater than zero.",
    errorBillablePercent: "The billable share is a percentage greater than zero and at most 100.",
    errorHoursPerDay: "The hours in a working day must be greater than zero.",
    errorBillableHours: "Billable hours per year comes out as zero with these numbers.",

    unitH: "h",
  },

  "iban-check": {
    mode: "Mode",
    modeVerify: "Check an entered IBAN",
    modeCompose: "Build an IBAN",
    iban: "IBAN",
    ibanHint: "Letters may be lowercase; they are converted to uppercase. Spaces are removed.",
    countryCode: "Country code",
    countryCodeHint: "Two letters, A–Z. Neagle has no built-in list of countries.",
    bban: "BBAN",
    bbanHint: "The domestic account number — digits and uppercase letters.",

    results: "Result",
    normalized: "Entered, normalised",
    length: "Length",
    lengthChars: "characters",
    countryCode2: "Country code",
    checkDigits: "Entered check digits",
    bban2: "BBAN",
    remainder: "Remainder modulo 97",
    remainderIsOne: "The remainder equals 1",
    yes: "yes",
    no: "no",
    expectedCheckDigits: "The check digits this BBAN and country would require",
    correctedIban: "The full IBAN with those check digits",
    correctedPaperFormat: "Paper form",
    paperFormat: "Paper form of the entered IBAN",
    composedIban: "Built IBAN",

    inputs: "Entered",
    formula:
      "move the first 4 characters to the end, letters A=10…Z=35, r = number mod 97     check: r = 1     build: K = 98 − (BBAN + country + “00”) mod 97",

    errorIban:
      "The IBAN must be 5–34 characters, the first two letters A–Z, the next two digits, and only digits and uppercase letters after that.",
    errorCountryCode: "The country code is exactly two letters, A–Z.",
    errorBban: "The BBAN is 1–30 digits and uppercase letters.",
  },

  "margin-markup": {
    cost: "Purchase price",
    price: "Selling price",
    marginPercent: "Margin — % of the selling price",
    markupPercent: "Markup — % of the purchase price",
    minMarginPercent: "The smallest margin to keep — % of the selling price",
    minMarginHint: "Fill this in, with the purchase and selling price, for the largest allowed discount.",
    fieldsHint:
      "Fill in exactly TWO of the four fields above (purchase price, selling price, margin, markup) — the third and fourth are derived. For the largest discount, fill in the purchase price, the selling price and the smallest margin.",

    results: "Result",
    resultCost: "Purchase price",
    resultPrice: "Selling price",
    profit: "Profit per unit",
    resultMargin: "Margin",
    resultMarkup: "Markup",

    maxDiscountPercent: "Largest discount (down)",
    exactDiscountPercent: "Largest discount, unrounded",
    priceAfterDiscount: "Price after that discount",
    marginAfterDiscountPercent: "Margin remaining after that discount",
    belowNote:
      "The selling price is already below the given minimum margin — the unrounded discount comes out negative, so the discount shown is 0.00%.",

    inputs: "Entered",
    formula:
      "Z = P − C     markup = Z/C     margin = Z/P     largest discount: d = 1 − C / (P · (1 − m_min))",

    errorCost: "The purchase price must be greater than zero.",
    errorPrice: "The selling price must be greater than zero.",
    errorMarginPercent: "The margin must be less than 100%.",
    errorMarkupPercent: "The markup must be greater than −100%.",
    errorMinMarginPercent: "The minimum margin must be less than 100%.",
    errorAmbiguous:
      "Fill in exactly two of the fields purchase price / selling price / margin / markup, or the purchase price, selling price and minimum margin for the largest discount.",

    unitPercent: "%",
  },

  "payment-due-date": {
    issueDateDay: "Issue date — day",
    issueDateMonth: "Issue date — month",
    issueDateYear: "Issue date — year",
    mode: "Method",
    modeDaysFromDate: "N days from the date",
    modeDaysFromEndOfMonth: "N days from the end of the month",
    modeMonthsFromDate: "N months from the date",
    term: "Term N",
    termHint: "Days or months, depending on the method. Which term applies is your choice.",
    countIssueDate: "The issue day counts towards the term",
    countIssueDateYes: "It counts (the issue day is day one)",
    countIssueDateNo: "It does not count (the term starts the next day)",
    shiftEnabled: "Moving off a non-working day",
    shiftOn: "On",
    shiftOff: "Off",
    shiftDirection: "Direction of the move",
    shiftForward: "Forwards, to the next working day",
    shiftBackward: "Backwards, to the previous working day",
    weekendDays: "Non-working days of the week",
    weekendDaysHint:
      "Numbers 0–6 separated by commas; 0 is Monday, 6 is Sunday. Empty means no day of the week is non-working under this rule.",
    nonWorkingDays: "Non-working days (holidays)",
    nonWorkingDaysHint:
      "One date per line, in the form DD.MM.YYYY. Neagle has no built-in holiday calendar.",
    referenceDateDay: "Reference date — day",
    referenceDateMonth: "Reference date — month",
    referenceDateYear: "Reference date — year",
    referenceDateHint: "“Today” is entered here, not read from the clock.",

    results: "Result",
    dueDate: "Due date",
    dueWeekday: "Day of the week",
    dueDateBeforeShift: "Due date before the move",
    shiftedDays: "How many days the move added",
    capReachedNote:
      "The move reached the limit of 30 consecutive steps without a working day; the date shown is the last one examined.",
    totalDays: "Total days from issue to due date",
    daysLate: "Days late relative to the reference date",
    daysUntilDue: "Days to the due date relative to the reference date",
    note:
      "The term, the moving rule and the list of non-working days are data you enter — Neagle does not know which term applies or whether a right has expired.",

    weekdayNames: [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ],

    inputs: "Entered",
    formula:
      "due = issued + N (days, from the end of the month, or months keeping the day and with an end-of-month rule)     move: while the due date is non-working, +1/−1 day, at most 30 steps",

    errorIssueDate: "The issue date must be a valid calendar date.",
    errorReferenceDate: "The reference date must be a valid calendar date.",
    errorTerm: "The term N is a whole number from 0 to 100000.",
    errorWeekendDays: "The non-working days of the week are numbers from 0 to 6.",
    errorNonWorkingDays:
      "Every non-working day must be a valid calendar date in the form DD.MM.YYYY.",
    errorGeneric: "With these numbers the due date cannot be calculated.",
  },

  "payment-reference-97": {
    mode: "Mode",
    modeCompute: "Calculate the two-digit check number",
    modeVerify: "Check an existing reference number",
    reference: "Reference",
    referenceHint: "1–40 digits, without the check pair. Hyphens and spaces are removed.",
    value: "Reference number to check",
    valueHint: "The check pair first, then the reference.",

    results: "Result",
    checkDigits: "Check pair",
    formatted: "Composite reference number",
    enteredCheckDigits: "Entered pair",
    computedCheckDigits: "Calculated pair",
    matches: "The pairs match",
    yes: "yes",
    no: "no",
    overTwentyNote:
      "The reference has more than 20 digits — beyond the field the NBS payment order form allows. MOD 97-10 itself has no length limit.",

    inputs: "Entered",
    formula: "r = reference mod 97 (digit by digit)     K = 98 − ((r · 100) mod 97)",

    errorReference: "The reference is 1–40 digits.",
    errorValue: "The reference number to check is 3–42 digits, the check pair followed by the reference.",
  },

  "share-allocation": {
    total: "Total amount",
    shares: "Shares",
    sharesHint:
      "Numbers or percentages, one per line — each ≥ 0, at least one greater than zero. They do not have to add up to 100.",
    unit: "Smallest unit",
    unit001: "0.01",
    unit1: "1",
    unit10: "10",

    results: "Result",
    tableIndex: "No.",
    tableShare: "Share",
    tablePercent: "Share in %",
    tableAmount: "Amount",
    tableExtra: "Extra unit",
    extraYes: "yes",
    extraNo: "no",
    shareSum: "Sum of entered shares (basis for percentages)",
    checkSum: "Check sum",

    inputs: "Entered",
    formula:
      "N = round(total / unit)     base part = ⌊N · shareᵢ / sum of shares⌋     the largest remainders get one unit more; an earlier entry wins on an equal remainder",

    errorTotal: "The total amount may not be negative.",
    errorUnit: "The smallest unit must be greater than zero.",
    errorShares:
      "There must be at least one share, each ≥ 0 and at least one greater than zero; none may be negative.",
  },

  "simple-interest-days": {
    principal: "Principal",
    annualRatePercent: "Annual rate",
    annualRatePercentHint:
      "The statutory or contractual rate that you choose and enter — Neagle knows no rate and offers none.",
    fromDay: "Date from — day",
    fromMonth: "Date from — month",
    fromYear: "Date from — year",
    toDay: "Date to — day",
    toMonth: "Date to — month",
    toYear: "Date to — year",
    basis: "Day-count basis",
    basisAct365: "ACT/365 Fixed",
    basisAct360: "ACT/360",
    basisE30360: "30E/360 (Eurobond Basis)",
    countBothEnds: "Day count",
    countBothEndsNo: "Usual — the “from” day counted, the “to” day not",
    countBothEndsYes: "Both ends counted",
    countBothEndsHint: "Does not affect 30E/360, which already has its day count built into D1/D2.",

    results: "Result",
    days: "Number of days by the chosen basis",
    calendarDays: "Actual calendar number of days",
    divisor: "Divisor",
    interest: "Interest",
    dailyInterest: "Daily interest",
    total: "Principal + interest",
    note:
      "The interest is SIMPLE, with no compounding. The rate is the one you enter — Neagle does not choose it and does not say whether the claim exists.",

    inputs: "Entered",
    formula:
      "ACT/365, ACT/360: days = JDN(to) − JDN(from) (+1 if both ends count)     30E/360: days = 360·Δyears + 30·Δmonths + (D2−D1), D = min(day, 30)     interest = principal · rate/100 · days / divisor",

    errorPrincipal: "The principal may not be negative.",
    errorAnnualRatePercent: "The annual rate may not be negative.",
    errorFrom: "The “from” date must be a valid calendar date.",
    errorTo: "The “to” date must be a valid calendar date and may not be before the “from” date.",

    unitPercent: "%",
    unitDays: "days",
  },

  "tax-id-check": {
    mode: "Mode",
    modeVerify: "Check a whole number",
    modeCompute: "Calculate the check digit from the prefix",
    totalDigits: "Total number of digits",
    totalDigitsHint:
      "For a PIB enter 9, for a company registration number 8. Neagle assumes no length. In calculate mode this is the total length of the FINISHED number, so the prefix has one digit fewer.",
    value: "Number",
    valueHint: "As many digits as entered above. Spaces are removed.",
    prefix: "Prefix",
    prefixHint:
      "One digit shorter than the total number of digits — the check digit is appended at the end.",

    results: "Result",
    checkDigit: "Calculated check digit",
    enteredCheckDigit: "Entered last digit",
    matches: "They match",
    yes: "yes",
    no: "no",
    prefixOut: "Prefix",
    correctedNumber: "The whole number with the calculated check digit",
    number: "Whole number",

    inputs: "Entered",
    formula:
      "p = 10; for each digit d: s = (p+d) mod 10, s=0 → s=10, p = 2s mod 11     check digit = (11 − p) mod 10",

    errorTotalDigits: "The total number of digits is from 2 to 40.",
    errorNumber: "The number may contain only digits, exactly as many as entered as the total length.",
    errorPrefix: "The prefix may contain only digits, exactly one fewer than the total length.",
    errorLength: "The entered number does not have as many digits as stated as the total length.",
  },

  "tiered-commission": {
    base: "Base",
    tiers: "Thresholds and rates",
    tiersHint:
      "One row per threshold, in the form “lower bound; rate %”. The first lower bound must be 0, and bounds may not repeat.",
    mode: "Method",
    modeMarginal: "Marginal (by tranche)",
    modeFlat: "Flat (one rate on the whole amount)",
    minCommission: "Minimum commission",
    maxCommission: "Maximum commission",

    results: "Result",
    tableFrom: "From",
    tableTo: "To",
    tableOpenEnd: "up",
    tableRate: "Rate",
    tableAmount: "Amount in the tranche",
    tableCommission: "Commission from the tranche",
    commissionBeforeLimits: "Commission before limits",
    commission: "Commission",
    appliedTier: "Applied threshold",
    effectiveRatePercent: "Effective rate",
    remainder: "Remainder after commission",

    inputs: "Entered",
    formula:
      "marginal: commission = Σ (part of the base in the tranche) · rate/100     flat: commission = base · rate of the last threshold ≤ base     then: max(., minimum), then min(., maximum)",

    errorBase: "The base may not be negative.",
    errorTiers:
      "The scale must have at least one row, the first lower bound must be 0, bounds may not repeat and may not be negative.",
    errorMinCommission: "The minimum commission may not be negative.",
    errorMaxCommission:
      "The maximum commission may not be negative and may not be less than the minimum commission.",

    unitPercent: "%",
  },
} as const;
